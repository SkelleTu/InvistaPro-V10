import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { errorTracker } from './error-tracker';
import { dualStorage as storage } from '../storage-dual';
import { resilienceSupervisor } from './resilience-supervisor';
import { connectDerivAccount, type DerivAccountContext } from './deriv-account-gateway';
import { isAllowedProductionSymbol } from './production-symbol-policy';

// ☠️ PROTOCOLO DE EXECUÇÃO IMEDIATA — tolerância zero para ativos criminosos
// Qualquer símbolo que viole as regras é executado aqui: blacklistado, logado e morto.
const CRIME_PATTERN = /\(1s\)|^1HZ|_1S/i;

// Conjunto em memória de símbolos já executados nesta sessão (evita log duplicado)
const _executadosNestaSessao = new Set<string>();

async function executarCrime(symbol: string, contexto: string): Promise<null> {
  const timestamp = new Date().toISOString();
  console.error(`\n☠️ ══════════════════════════════════════════════════════`);
  console.error(`☠️  EXECUÇÃO IMEDIATA — CRIME DETECTADO`);
  console.error(`☠️  Símbolo criminoso : ${symbol}`);
  console.error(`☠️  Contexto          : ${contexto}`);
  console.error(`☠️  Timestamp         : ${timestamp}`);
  console.error(`☠️  Sentença          : TRADE ABORTADO + BLACKLIST PERMANENTE`);
  console.error(`☠️ ══════════════════════════════════════════════════════\n`);
  // Blacklist permanente no banco de dados (uma vez por símbolo por sessão)
  if (!_executadosNestaSessao.has(symbol)) {
    _executadosNestaSessao.add(symbol);
    try {
      await storage.createAssetBlacklist({
        userId: 'SYSTEM',
        assetPattern: symbol,
        patternType: 'exact',
        reason: `☠️ EXECUÇÃO AUTOMÁTICA: ativo 1s detectado em [${contexto}] às ${timestamp}`,
        isActive: true,
      } as any);
    } catch (_) {
      // fallback silencioso — bloqueio em memória e em código já protege
    }
  }
  return null;
}

export interface DerivTickData {
  symbol: string;
  quote: number;
  epoch: number;
  display_value?: string; // Raw string representation preserving trailing zeros
}

export interface DerivBalance {
  balance: number;
  currency: string;
  loginid: string;
}

export interface DerivContractInfo {
  contract_id: number;
  shortcode: string;
  status: string;
  entry_tick: number;
  exit_tick?: number;
  profit?: number;
  buy_price: number;
  sell_price?: number;
  entry_tick_time?: number;
  exit_tick_time?: number;
  contract_type?: string;
  barrier?: string;
  barrier2?: string;       // Segunda barreira (ENDS_OUTSIDE/EXPIRYRANGE — limite inferior)
  high_barrier?: string;   // Barreira alta (formato alternativo Deriv)
  low_barrier?: string;    // Barreira baixa (formato alternativo Deriv)
  payout?: number;
  is_valid_to_sell?: boolean;
  is_sold?: boolean;
  is_expired?: boolean;
  is_settleable?: boolean;
  date_start?: number;
  date_expiry?: number;
  current_spot?: number;
  current_spot_time?: number;
}

export interface DigitDifferContract {
  contract_type: 'DIGITDIFF';
  symbol: string;
  duration: number;
  duration_unit: 't'; // ticks
  barrier: string; // digit to predict difference from
  amount: number;
  currency: string;
}

export interface DerivActiveSymbol {
  symbol: string;
  display_name: string;
  market: string;
  market_display_name: string;
  submarket: string;
  submarket_display_name: string;
  exchange_is_open: number;
  is_trading_suspended: number;
}

export class DerivAPIService extends EventEmitter {
  private ws: WebSocket | null = null;
  private connectionId: number = 0;
  private isConnected: boolean = false;
  private isConnecting: boolean = false;
  private pendingConnectPromise: Promise<boolean> | null = null;
  private apiToken: string | null = null;
  private accountType: 'demo' | 'real' = 'demo';
  private accountContext: DerivAccountContext | null = null;
  private reconnectAttempts = 0;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000; // Max 30 seconds between retries
  private maxQueueSize = 100;
  private messageQueue: any[] = [];
  private activeSubscriptions = new Set<string>();
  private isShuttingDown = false;
  private connectionTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private supervisorHeartbeatInterval: NodeJS.Timeout | null = null;
  private operationId: string | null = null;
  
  // Sistema de descoberta dinâmica com cache
  private symbolsCache: DerivActiveSymbol[] = [];
  private digitDiffCache: string[] = [];
  private lastCacheUpdate: number = 0;
  private cacheExpireMs: number = 5 * 60 * 1000; // 5 minutos
  private keepAliveInterval: NodeJS.Timeout | null = null;

  // ⚡ CACHE DE PREÇO EM TEMPO REAL — elimina roundtrip extra antes de cada trade
  // Atualizado a cada tick recebido via subscription. Máx 3s de idade para ser usado.
  private lastTickCache: Map<string, { quote: number; epoch: number; receivedAt: number }> = new Map();
  private readonly TICK_CACHE_MAX_AGE_MS = 3000; // 3 segundos

  constructor(private readonly fixedAccountType: 'demo' | 'real' = 'demo') {
    super();
    this.accountType = fixedAccountType;
    
    // Configurar listeners para error recovery
    // 200 slots: 25 ativos × (proposta + compra) + subscrições + heartbeat + auth
    this.setMaxListeners(200);
    this.setupErrorRecovery();
  }

  private setupErrorRecovery(): void {
    // Capturar erros não tratados
    this.on('error', (error) => {
      const errorId = errorTracker.captureError(
        error,
        'ERROR',
        'WEBSOCKET',
        {
          requestPath: 'DERIV_API_SERVICE',
          requestMethod: 'EVENT_ERROR',
          requestBody: {
            operationId: this.operationId,
            isConnected: this.isConnected,
            reconnectAttempts: this.reconnectAttempts,
            wsReadyState: this.ws?.readyState
          }
        }
      );
      
      console.log(`🔥 DERIV API ERROR CAPTURED - ID: ${errorId}`);
      
      // Não propagar o erro para evitar crashes
      // O error handling será feito internamente
    });

    // Process-level shutdown is owned by the application server. Registering
    // SIGTERM/SIGINT listeners per DerivAPIService instance leaks listeners when
    // temporary validation/slot sessions are created.
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }

  /** Returns true only when this authenticated session belongs to the supplied token/environment. */
  isSessionFor(apiToken: string, accountType: 'demo' | 'real'): boolean {
    return Boolean(
      this.isConnected &&
      this.apiToken === String(apiToken ?? '').trim() &&
      this.accountType === accountType &&
      this.accountContext?.accountType === accountType
    );
  }

  async connectPublic(operationId?: string): Promise<boolean> {
    // Reuse the dedicated public socket instead of creating parallel sockets.
    if (this.isConnected && this.ws?.readyState === WebSocket.OPEN && !this.apiToken) {
      return true;
    }
    // Conexão pública sem autenticação para ticks
    this.operationId = operationId || `CONNECT_PUBLIC_${Date.now()}`;
    this.isShuttingDown = false;
    
    const endpoint = 'wss://api.derivws.com/trading/v1/options/ws/public';

    console.log(`🔌 Conectando Deriv (público) - Operation ID: ${this.operationId}`);

    return new Promise((resolve, reject) => {
      const connectionTimer = setTimeout(() => {
        const timeoutError = new Error('Connection timeout after 10 seconds');
        this.cleanup();
        reject(timeoutError);
      }, 10000);

      try {
        this.ws = new WebSocket(endpoint, {
          headers: {
            'Origin': 'https://app.deriv.com'
          }
        });

        this.ws.on('open', async () => {
          clearTimeout(connectionTimer);
          console.log(`🔗 Deriv WebSocket conectado (público) - Operation ID: ${this.operationId}`);
          this.isConnected = true;
          this.reconnectAttempts = 0;
          
          // Sem autenticação - só configurar listeners e heartbeat
          this.emit('connected');
          this.processMessageQueue();
          await this.resubscribeActiveSubscriptions();
          this.startHeartbeat();
          
          // Resubscrever todas as subscrições após reconexão
          // TEMPORARIAMENTE DESABILITADO: await this.resubscribeAll();
          // Motivo: 11,396 subscrições estão bloqueando a inicialização do servidor
          
          resolve(true);
        });

        this.setupWebSocketListeners(reject, connectionTimer, endpoint, 'demo');

      } catch (error) {
        clearTimeout(connectionTimer);
        console.error(`❌ Erro ao configurar conexão Deriv (público) - Operation ID: ${this.operationId}:`, error);
        reject(error);
      }
    });
  }

  async connect(apiToken: string, accountType: 'demo' | 'real' = this.fixedAccountType, operationId?: string): Promise<boolean> {
    if (accountType !== this.fixedAccountType) {
      throw new Error(`Deriv session is fixed to ${this.fixedAccountType}; cannot connect it as ${accountType}`);
    }
    const normalizedToken = String(apiToken ?? '').trim();
    if (!normalizedToken) throw new Error('Deriv authorization token is required');

    // A connection is account-scoped. Never reuse a Demo socket for Real or vice versa.
    if (
      this.isConnected &&
      this.ws &&
      this.ws.readyState === WebSocket.OPEN &&
      this.apiToken === normalizedToken &&
      this.accountType === accountType &&
      this.accountContext?.accountType === accountType
    ) {
      console.log(`⚡ [CONN REUSE] Deriv ${accountType} connection reused | account=${this.accountContext.accountId}`);
      return true;
    }

    if (this.isConnecting && this.pendingConnectPromise) {
      return this.pendingConnectPromise;
    }

    // If this persistent session belongs to a different token/context, close the old socket first.
    // Never leave an orphaned WebSocket alive while replacing the account context.
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      // A different token is a different security context. Do not carry
      // subscriptions/tick state from the previous account into the new one.
      if (this.apiToken !== normalizedToken || this.accountType !== accountType) {
        this.activeSubscriptions.clear();
        this.lastTickCache.clear();
      }
      this.cleanup();
    }

    this.isConnecting = true;
    this.operationId = operationId || `CONNECT_${Date.now()}`;
    this.apiToken = normalizedToken;
    this.accountType = accountType;
    this.isShuttingDown = false;

    this.pendingConnectPromise = new Promise((resolve, reject) => {
      let settled = false;
      const done = (result: boolean | Error) => {
        if (settled) return;
        settled = true;
        this.isConnecting = false;
        this.pendingConnectPromise = null;
        if (result instanceof Error) reject(result);
        else resolve(result);
      };

      const connectionTimer = setTimeout(() => {
        const timeoutError = new Error('Connection timeout after 15 seconds');
        this.cleanup();
        done(timeoutError);
      }, 15000);

      void (async () => {
        try {
          // New Deriv API architecture:
          // PAT/OAuth token -> GET accounts -> accountId -> POST OTP -> demo/real WebSocket URL.
          const { ws, context } = await connectDerivAccount(normalizedToken, accountType);
          clearTimeout(connectionTimer);
          this.ws = ws;
          this.accountContext = context;
          this.isConnected = true;
          this.reconnectAttempts = 0;

          console.log(
            `🔐 [DERIV] Authenticated ${context.accountType} session | account=${context.accountId} | endpoint=${new URL(context.websocketUrl).pathname}`
          );

          this.setupWebSocketListeners(
            (err: Error) => done(err),
            connectionTimer,
            context.websocketUrl,
            accountType
          );
          this.emit('connected');
          this.processMessageQueue();
          await this.resubscribeActiveSubscriptions();
          this.startHeartbeat();
          this.startKeepAlive();
          done(true);
        } catch (error) {
          clearTimeout(connectionTimer);
          this.accountContext = null;
          this.isConnected = false;
          this.cleanup();
          errorTracker.captureError(
            error as Error,
            'ERROR',
            'AUTH',
            {
              requestPath: 'DERIV_ACCOUNT_GATEWAY',
              requestMethod: 'CONNECT',
              requestBody: {
                operationId: this.operationId,
                accountType,
              },
            }
          );
          done(error as Error);
        }
      })();
    });

    return this.pendingConnectPromise;
  }

  private setupWebSocketListeners(reject: any, connectionTimer: NodeJS.Timeout, endpoint: string, accountType: string): void {
    this.ws!.on('close', (code, reason) => {
      clearTimeout(connectionTimer);
      
      const closeInfo = {
        code,
        reason: reason?.toString(),
        operationId: this.operationId,
        wasConnected: this.isConnected
      };
      
      console.log(`⚠️ Deriv WebSocket desconectado - Code: ${code}, Reason: ${reason}, Operation ID: ${this.operationId}`);
      
      this.isConnected = false;
      this.stopHeartbeat();
      this.emit('disconnected', closeInfo);

      // A clean unexpected close can happen without an accompanying error event.
      // Restart the same authenticated/public context instead of waiting for a dead heartbeat.
      if (!this.isShuttingDown && !this.isConnecting) {
        this.handleConnectionLoss();
      }
    });

    this.ws!.on('error', (error) => {
      clearTimeout(connectionTimer);
      
      const errorId = errorTracker.captureError(
        error,
        'ERROR',
        'WEBSOCKET',
        {
          requestPath: 'DERIV_CONNECTION_ERROR',
          requestMethod: 'CONNECT',
          requestBody: {
            operationId: this.operationId,
            endpoint,
            accountType,
            wsReadyState: this.ws?.readyState
          }
        }
      );
      
      console.log(`❌ Erro na conexão Deriv - Error ID: ${errorId}, Operation ID: ${this.operationId}`);
      
      this.isConnected = false;
      this.cleanup();
      reject(error);

      // Erro de handshake (ex.: HTTP 520) não deve ser transformado em
      // reinicializações agressivas pelo supervisor. A própria conexão usa
      // backoff exponencial limitado para tentar novamente.
      if (!this.isShuttingDown) {
        const delay = Math.min(
          this.reconnectDelay * Math.pow(1.5, Math.min(this.reconnectAttempts, 10)),
          this.maxReconnectDelay
        );
        console.warn(`🔄 [DERIV] Falha de conexão ${error instanceof Error ? error.message : String(error)} — nova tentativa em ${Math.round(delay / 1000)}s`);
        setTimeout(() => {
          if (!this.isShuttingDown && !this.isConnected) this.attemptAutoReconnect();
        }, delay);
      }
    });

    this.ws!.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        console.error('❌ Erro ao processar mensagem Deriv:', error);
      }
    });
  }

  private startHeartbeat(): void {
    // Deriv API times out after 2 minutes of inactivity - send ping every 60 seconds para maior estabilidade
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected && this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.sendMessage({ ping: 1 });
          console.log(`💓 Ping enviado para manter conexão ativa - Operation ID: ${this.operationId}`);
        } catch (error) {
          console.error('❌ Erro ao enviar heartbeat:', error);
          // Tentar reconectar se heartbeat falhar
          this.handleConnectionLoss();
        }
      } else if (this.isConnected && this.ws?.readyState !== WebSocket.OPEN) {
        console.warn(`⚠️ Conexão perdida detectada via heartbeat - Status: ${this.ws?.readyState}`);
        this.handleConnectionLoss();
      }
    }, 60000); // Ping mais frequente (60s) para melhor estabilidade
    console.log(`💓 Sistema de heartbeat iniciado (ping a cada 60s) - Operation ID: ${this.operationId}`);
    
    // Iniciar heartbeat para ResilienceSupervisor
    this.startSupervisorHeartbeat();
  }

  private startSupervisorHeartbeat(): void {
    // Evitar múltiplos intervalos
    if (this.supervisorHeartbeatInterval) return;
    // Reportar saúde ao supervisor a cada 45 segundos (abaixo do timeout de 90s)
    this.supervisorHeartbeatInterval = setInterval(async () => {
      try {
        // Reportar mesmo quando desconectado — status reflete estado real
        const status = this.isConnected ? 'healthy' : 'reconnecting';
        await resilienceSupervisor.reportHeartbeat('websocket', {
          isConnected: this.isConnected,
          wsReadyState: this.ws?.readyState,
          activeSubscriptions: this.activeSubscriptions.size,
          reconnectAttempts: this.reconnectAttempts,
          operationId: this.operationId,
          status,
        });
      } catch (error) {
        console.error('❌ Erro ao reportar heartbeat ao supervisor:', error);
      }
    }, 45000);
    console.log(`💓 Heartbeat do ResilienceSupervisor iniciado`);
  }

  private stopHeartbeat(): void {
    // Para apenas o ping de WS — supervisor heartbeat continua rodando mesmo desconectado
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    // NÃO parar supervisorHeartbeatInterval aqui — ele deve continuar batendo (status reconnecting)
  }

  private stopAllHeartbeats(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.supervisorHeartbeatInterval) {
      clearInterval(this.supervisorHeartbeatInterval);
      this.supervisorHeartbeatInterval = null;
    }
  }

  private cleanup(): void {
    this.stopHeartbeat(); // mantém supervisor heartbeat ativo
    this.stopKeepAlive();
    this.isConnected = false;
    this.isConnecting = false;
    this.accountContext = null;
    
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    
    // Never replay stale proposals/buys after a disconnect.
    this.messageQueue = [];

    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.removeAllListeners();
      ws.on('error', () => {});
      try {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.terminate();
        } else if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      } catch (e) {
        // ignore
      }
    }
  }

  private async gracefulShutdown(): Promise<void> {
    this.isShuttingDown = true;
    console.log(`🛑 Iniciando shutdown graceful do Deriv API - Operation ID: ${this.operationId}`);
    
    await this.disconnect();
    this.removeAllListeners();
    
    console.log(`✅ Shutdown graceful concluído - Operation ID: ${this.operationId}`);
  }
  // Authentication is now performed by deriv-account-gateway.ts via REST OTP.\n
  private requireAuthenticatedAccountSession(operation: string): void {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Deriv ${operation} requires an active WebSocket connection`);
    }
    if (!this.accountContext) {
      throw new Error(`Deriv ${operation} requires an authenticated Demo/Real account session`);
    }
    if (this.accountContext.accountType !== this.accountType) {
      throw new Error(`Deriv ${operation} account context mismatch`);
    }
  }

  async getBalance(): Promise<DerivBalance | null> {
    this.requireAuthenticatedAccountSession('balance');
    if (!this.isConnected) return null;

    return new Promise((resolve) => {
      const reqId = this.generateRequestId();
      
      const balanceHandler = (message: any) => {
        if (message.req_id === reqId) {
          this.removeListener('message', balanceHandler);
          if (message.balance) {
            resolve({
              balance: message.balance.balance,
              currency: message.balance.currency,
              loginid: message.balance.loginid
            });
          } else {
            resolve(null);
          }
        }
      };

      this.on('message', balanceHandler);
      this.sendMessage({ balance: 1, req_id: reqId });
    });
  }

  async getActiveSymbols(): Promise<DerivActiveSymbol[]> {
    if (!this.isConnected) {
      console.warn('⚠️ Não conectado à Deriv - retornando lista vazia de símbolos');
      return [];
    }

    return new Promise((resolve) => {
      const reqId = this.generateRequestId();
      
      const symbolsHandler = (message: any) => {
        if (message.req_id === reqId) {
          this.removeListener('message', symbolsHandler);
          if (message.active_symbols) {
            const symbols = message.active_symbols
              .filter((s: any) => s.exchange_is_open === 1 && s.is_trading_suspended === 0)
              .map((s: any) => ({
                symbol: s.symbol,
                display_name: s.display_name,
                market: s.market,
                market_display_name: s.market_display_name,
                submarket: s.submarket,
                submarket_display_name: s.submarket_display_name,
                exchange_is_open: s.exchange_is_open,
                is_trading_suspended: s.is_trading_suspended
              }));
            
            console.log(`✅ Recuperados ${symbols.length} símbolos ativos da Deriv API`);
            resolve(symbols);
          } else {
            console.error('❌ Erro ao buscar símbolos ativos:', message.error);
            resolve([]);
          }
        }
      };

      this.on('message', symbolsHandler);
      this.sendMessage({ 
        active_symbols: 'brief',
        product_type: 'basic',
        req_id: reqId 
      });
    });
  }

  // Validar cache de ativos
  private isCacheValid(): boolean {
    return this.lastCacheUpdate > 0 && Date.now() - this.lastCacheUpdate < this.cacheExpireMs;
  }

  // 🔥 NOVO: Descobrir DINAMICAMENTE quais ativos suportam DIGITDIFF (conforme docs oficiais Deriv)
  async getDigitDiffSupportedSymbols(allSymbols?: DerivActiveSymbol[]): Promise<string[]> {
    // Se cache está válido, retornar do cache
    if (this.isCacheValid() && this.digitDiffCache.length > 0) {
      console.log(`⚡ [DIGITDIFF CACHE] Retornando ${this.digitDiffCache.length} ativos do cache`);
      return this.digitDiffCache;
    }

    // Se não passar símbolos e cache expirou, usar cache anterior se houver
    if (!allSymbols) {
      if (this.digitDiffCache.length > 0) {
        console.log(`⚡ [DIGITDIFF CACHE] Retornando ${this.digitDiffCache.length} ativos do cache antigo`);
        return this.digitDiffCache;
      }
      return [];
    }

    console.log(`🔍 [DIGITDIFF DISCOVERY] Iniciando descoberta com ${allSymbols.length} símbolos`);
    
    if (!this.isConnected) {
      console.warn('⚠️ [DIGITDIFF DISCOVERY] NÃO CONECTADO! Retornando array vazio');
      return [];
    }
    
    const supportedSymbols: string[] = [];
    let checked = 0;
    
    for (const symbolInfo of allSymbols) {
      const symbol = symbolInfo.symbol;
      if (!isAllowedProductionSymbol(symbol)) continue;
      checked++;
      
      // Log a cada 10 símbolos para rastreamento
      if (checked % 10 === 0) {
        console.log(`🔍 [DIGITDIFF DISCOVERY] Progresso: ${checked}/${allSymbols.length} símbolos verificados...`);
      }
      
      try {
        const contracts = await this.getContractsFor(symbol);
        
        // Verificar se DIGITDIFF está disponível
        const hasDigitDiff = contracts.some((c: any) => c.contract_type === 'DIGITDIFF');
        
        if (hasDigitDiff) {
          // 🚫 Nunca adicionar ativos 1s ao cache de DIGITDIFF
          if (/\(1s\)|^1HZ/i.test(symbol)) {
            console.log(`🚫 ${symbol} SUPORTA DIGITDIFF mas é ativo 1s — IGNORADO`);
          } else {
            supportedSymbols.push(symbol);
            console.log(`✅ ${symbol} SUPORTA DIGITDIFF`);
          }
        }
      } catch (error) {
        console.warn(`⚠️ [DIGITDIFF DISCOVERY] Erro ao verificar ${symbol}:`, error);
      }
    }
    
    // Atualizar cache
    this.digitDiffCache = supportedSymbols;
    this.lastCacheUpdate = Date.now();
    
    console.log(`🔥 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`🔥 [DIGITDIFF DESCOBERTA COMPLETA]`);
    console.log(`🔥 Símbolos verificados: ${checked}/${allSymbols.length}`);
    console.log(`🔥 Ativos com DIGITDIFF encontrados: ${supportedSymbols.length}`);
    console.log(`🔥 Símbolos: ${supportedSymbols.join(', ') || 'NENHUM'}`);
    console.log(`🔥 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    
    return supportedSymbols;
  }

  // Obter símbolos ativos com cache
  async getActiveSymbolsCached(): Promise<DerivActiveSymbol[]> {
    // Se cache está válido, retornar do cache
    if (this.isCacheValid() && this.symbolsCache.length > 0) {
      console.log(`⚡ [SYMBOLS CACHE] Retornando ${this.symbolsCache.length} símbolos do cache`);
      return this.symbolsCache;
    }

    // Buscar novos símbolos
    const symbols = await this.getActiveSymbols();
    
    // Atualizar cache
    this.symbolsCache = symbols;
    this.lastCacheUpdate = Date.now();
    
    return symbols;
  }

  async getAvailableSymbolsByTradeMode(mode: string) {
    console.log(`📡 [DerivAPI] Buscando símbolos para o modo: ${mode}`);
    
    // Public market-data traffic uses its own socket exclusively.
    // Never let symbol discovery share or overwrite an authenticated Demo/Real session.
    const marketApi = derivPublicAPI;
    if (!marketApi.isConnected) {
      await marketApi.connectPublic('GET_SYMBOLS_' + (mode || 'DEFAULT'));
    }

    // Se o modo for digit_diff, usar o sistema de descoberta especializado
    if (mode === 'digit_diff' || mode === 'undefined' || !mode) {
      try {
        console.log('🔍 [DerivAPI] Usando descoberta dinâmica para DIGITDIFF...');
        
        // 2. Obter símbolos ativos (com cache)
        const allSymbols = await marketApi.getActiveSymbolsCached();
        console.log(`📊 [DerivAPI] Total de símbolos ativos: ${allSymbols.length}`);
        
        // 3. Filtrar os que suportam DIGITDIFF (com cache)
        const digitDiffSymbols = await marketApi.getDigitDiffSupportedSymbols(allSymbols);
        
        // 4. Mapear para o formato esperado pelo frontend
        return digitDiffSymbols.map(symbol => {
          const info = allSymbols.find(s => s.symbol === symbol);
          return {
            symbol: symbol,
            display_name: info?.display_name || symbol,
            market: info?.market || 'unknown'
          };
        });
      } catch (error) {
        console.error('❌ Erro na descoberta dinâmica DIGITDIFF:', error);
        // Fallback básico se a descoberta falhar
        return [
          { symbol: 'BOOM500', display_name: 'Boom 500 Index', market: 'synthetic_index' },
          { symbol: 'BOOM1000', display_name: 'Boom 1000 Index', market: 'synthetic_index' },
          { symbol: 'CRASH500', display_name: 'Crash 500 Index', market: 'synthetic_index' },
          { symbol: 'CRASH1000', display_name: 'Crash 1000 Index', market: 'synthetic_index' }
        ];
      }
    }

    // Fallback para outros modos
    const symbols = await marketApi.getActiveSymbolsCached();
    return symbols.filter(s => isAllowedProductionSymbol(s.symbol)).map(s => ({
      symbol: s.symbol,
      display_name: s.display_name,
      market: s.market
    }));
  }

  // Helper method for generic requests
  private async wsRequest(payload: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const reqId = this.generateRequestId();
      const message = { ...payload, req_id: reqId };

      const handler = (msg: any) => {
        if (msg.req_id === reqId) {
          this.removeListener('message', handler);
          clearTimeout(timer); // Limpar timer ao resolver para evitar acúmulo
          resolve(msg);
        }
      };

      this.on('message', handler);
      this.sendMessage(message);

      // Timeout after 15 seconds (reduzido de 30s)
      const timer = setTimeout(() => {
        this.removeListener('message', handler);
        reject(new Error('WebSocket request timeout'));
      }, 15000);
    });
  }

  // 🔥 NOVO: Buscar contratos disponíveis para um símbolo (conforme docs Deriv)
  async getContractsFor(symbol: string): Promise<any[]> {
    if (!this.isConnected) return [];

    return new Promise((resolve) => {
      const reqId = this.generateRequestId();
      
      const contractsHandler = (message: any) => {
        if (message.req_id === reqId) {
          this.removeListener('message', contractsHandler);
          clearTimeout(timer);
          if (message.contracts_for) {
            const contracts = message.contracts_for.available || [];
            resolve(contracts);
          } else {
            resolve([]);
          }
        }
      };

      // Timeout de 10s — sem resposta a consulta de contratos não deve bloquear o sistema
      const timer = setTimeout(() => {
        this.removeListener('message', contractsHandler);
        console.warn(`⚠️ [TIMEOUT] getContractsFor ${symbol} — 10s sem resposta`);
        resolve([]);
      }, 10000);

      this.on('message', contractsHandler);
      this.sendMessage({
        contracts_for: symbol,
        currency: 'USD',
        req_id: reqId
      });
    });
  }

  async subscribeToTicks(symbol: string): Promise<void> {
    if (!isAllowedProductionSymbol(symbol)) {
      console.warn(`[DERIV_POLICY] Tick subscription blocked for disallowed symbol: ${symbol}`);
      return;
    }
    if (!this.isConnected) {
      this.sendMessage({ type: 'subscribe_ticks', symbol });
      return;
    }

    const subscriptionKey = `ticks_${symbol}`;
    if (this.activeSubscriptions.has(subscriptionKey)) {
      return; // Already subscribed
    }

    const reqId = this.generateRequestId();
    
    const subscribeMessage = {
      ticks: symbol,
      subscribe: 1,
      req_id: reqId
    };

    this.sendMessage(subscribeMessage);
    this.activeSubscriptions.add(subscriptionKey);
    
    // Persistir subscrição no banco de dados (verificar se já existe)
    try {
      const existing = await storage.getActiveWebSocketSubscriptions();
      const alreadyExists = existing.some(sub => sub.subscriptionId === subscriptionKey);
      
      if (!alreadyExists) {
        await storage.saveWebSocketSubscription({
          subscriptionId: subscriptionKey,
          subscriptionType: 'ticks',
          symbol,
          isActive: true,
        });
        console.log(`💾 Subscrição persistida: ${subscriptionKey}`);
      }
    } catch (error) {
      console.error('❌ Erro ao persistir subscrição:', error);
    }
    // console.log(`📈 Inscrito nos ticks de ${symbol}`); // Desabilitado para limpar logs
  }

  async buyCallPutContract(symbol: string, direction: 'up' | 'down', duration: number, amount: number): Promise<DerivContractInfo | null> {
    if (!isAllowedProductionSymbol(symbol)) { console.error(`[DERIV_POLICY] Order blocked for disallowed symbol: ${symbol}`); return null; }
    this.requireAuthenticatedAccountSession('buy');
    if (!this.isConnected) return null;

    try {
      // Determinar tipo de contrato baseado na direção
      const contractType = direction === 'up' ? 'CALL' : 'PUT';
      
      // Passo 1: Criar proposta para validar o contrato
      const proposal = await this.createCallPutProposal(symbol, contractType, duration, amount);
      if (!proposal) {
        console.error('❌ Falha ao criar proposta CALL/PUT');
        return null;
      }

      // Passo 2: Comprar usando o ID da proposta
      return new Promise((resolve) => {
        const reqId = this.generateRequestId();
        
        const buyHandler = (message: any) => {
          if (message.req_id === reqId) {
            this.removeListener('message', buyHandler);
            if (message.buy) {
              const contract: DerivContractInfo = {
                contract_id: message.buy.contract_id,
                shortcode: message.buy.shortcode,
                status: 'active',
                entry_tick: 0,
                buy_price: message.buy.buy_price,
              };
              
              console.log(`✅ Contrato ${contractType} comprado: ${contract.contract_id}`);
              console.log(`🎯 Parâmetros: ${symbol} | ${direction.toUpperCase()} | Duration: ${duration}t | Amount: $${amount}`);
              resolve(contract);
            } else {
              console.error(`❌ Erro ao comprar contrato ${contractType}:`, message.error);
              resolve(null);
            }
          }
        };

        this.on('message', buyHandler);

        // Comprar usando o ID da proposta
        // Tolerância de 5%: se o mercado moveu ligeiramente desde a proposta,
        // a Deriv não rejeita por preço obsoleto
        const maxPrice = parseFloat((proposal.ask_price * 1.05).toFixed(2));
        const buyMessage = {
          buy: proposal.id,
          price: maxPrice,
          req_id: reqId
        };

        console.log(`📝 Comprando contrato ${contractType} com proposta ID: ${proposal.id} | MaxPrice: $${maxPrice}`);
        this.sendMessage(buyMessage);
      });

    } catch (error) {
      console.error('❌ Erro no processo de compra CALL/PUT:', error);
      return null;
    }
  }

  async buyDigitDifferContract(params: DigitDifferContract): Promise<DerivContractInfo | null> {
    if (!isAllowedProductionSymbol(params.symbol)) { console.error(`[DERIV_POLICY] Order blocked for disallowed symbol: ${params.symbol}`); return null; }
    this.requireAuthenticatedAccountSession('buy');
    if (!this.isConnected) return null;

    console.log(`[DERIV_API] 🚀 Tentando abrir contrato: ${params.symbol}, Valor: ${params.amount}, Barreira: ${params.barrier}`);

    // ☠️ EXECUÇÃO IMEDIATA: CRIME = ativo 1s (formatos: "(1s)", "1HZ*", "_1S")
    if (CRIME_PATTERN.test(params.symbol)) {
      return executarCrime(params.symbol, 'buyDigitDifferContract');
    }

    const OPERATION_TIMEOUT = 15000; // 15 segundos timeout máximo

    try {
      // Passo 1: Criar proposta para validar o contrato (com timeout via Promise.race)
      const proposalPromise = this.createDigitDifferProposal(params);
      const timeoutPromise = new Promise<null>((_, reject) => {
        setTimeout(() => reject(new Error('Timeout ao criar proposta digit differs')), OPERATION_TIMEOUT);
      });
      
      let proposal: any;
      try {
        proposal = await Promise.race([proposalPromise, timeoutPromise]);
      } catch (timeoutError) {
        console.error(`⏱️ TIMEOUT ao criar proposta digit differs (${OPERATION_TIMEOUT}ms)`);
        return null;
      }
      
      if (!proposal) {
        console.error('❌ Falha ao criar proposta para digit differs');
        return null;
      }

      // Passo 2: Comprar usando o ID da proposta (com timeout e cleanup de listener)
      const reqId = this.generateRequestId();
      let buyHandler: ((message: any) => void) | null = null;
      let timeoutId: NodeJS.Timeout | null = null;
      
      const buyPromise = new Promise<DerivContractInfo | null>((resolve) => {
        buyHandler = (message: any) => {
          if (message.req_id === reqId) {
            // Limpar timeout e listener
            if (timeoutId) clearTimeout(timeoutId);
            this.removeListener('message', buyHandler!);
            buyHandler = null;
            
            if (message.buy) {
              const contract: DerivContractInfo = {
                contract_id: message.buy.contract_id,
                shortcode: message.buy.shortcode,
                status: 'active',
                entry_tick: 0, // Will be updated
                buy_price: message.buy.buy_price,
              };
              
              console.log(`✅ Contrato DIGIT DIFFERS comprado: ${contract.contract_id}`);
              console.log(`🎯 Parâmetros: ${params.symbol} | Barrier: ${params.barrier} | Amount: $${params.amount}`);
              resolve(contract);
            } else {
              console.error('❌ Erro ao comprar contrato digit differs:', message.error);
              resolve(null);
            }
          }
        };

        this.on('message', buyHandler);

        // Timeout com limpeza de listener
        timeoutId = setTimeout(() => {
          if (buyHandler) {
            this.removeListener('message', buyHandler);
            buyHandler = null;
          }
          console.error(`⏱️ TIMEOUT ao comprar contrato digit differs (${OPERATION_TIMEOUT}ms)`);
          resolve(null);
        }, OPERATION_TIMEOUT);

        // Comprar usando o ID da proposta (método correto da Deriv API)
        // Tolerância de 5%: evita rejeição quando preço se move entre proposta e compra
        const maxPriceDigitDiff = parseFloat((proposal.ask_price * 1.05).toFixed(2));
        const buyMessage = {
          buy: proposal.id,
          price: maxPriceDigitDiff,
          req_id: reqId
        };

        console.log(`📝 Comprando contrato digit differs com proposta ID: ${proposal.id} | MaxPrice: $${maxPriceDigitDiff}`);
        this.sendMessage(buyMessage);
      });

      return await buyPromise;

    } catch (error) {
      console.error('❌ Erro no processo de compra digit differs:', error);
      return null;
    }
  }

  private normalizeSymbol(symbol: string): string {
    // DIGITDIFF precisa com underscore: R_50, R_75, R_100
    // Manter como está para digit differs
    return symbol; // Nunca remover underscore para DIGITDIFF
  }

  private async createCallPutProposal(symbol: string, contractType: 'CALL' | 'PUT', duration: number, amount: number): Promise<{id: string, ask_price: number} | null> {    return new Promise((resolve) => {
      const reqId = this.generateRequestId();
      const normalizedSymbol = this.normalizeSymbol(symbol);
      
      const timer = setTimeout(() => {
        this.removeListener('message', proposalHandler);
        console.error(`⏰ Timeout ao criar proposta ${contractType} para ${normalizedSymbol}`);
        resolve(null);
      }, 15000);

      const proposalHandler = (message: any) => {
        if (message.req_id === reqId) {
          clearTimeout(timer);
          this.removeListener('message', proposalHandler);
          if (message.proposal) {
            console.log(`✅ Proposta ${contractType} criada: ID ${message.proposal.id} | Preço: $${message.proposal.ask_price}`);
            resolve({
              id: message.proposal.id,
              ask_price: message.proposal.ask_price
            });
          } else {
            console.error(`❌ Erro ao criar proposta ${contractType}:`, message.error);
            resolve(null);
          }
        }
      };

      this.on('message', proposalHandler);

      // Criar proposta CALL/PUT (Rise/Fall)
      const proposalMessage = {
        proposal: 1,
        contract_type: contractType,
        symbol: normalizedSymbol,
        duration: duration,
        duration_unit: 't',
        currency: 'USD',
        amount: amount,
        basis: 'stake',
        req_id: reqId
      };

      console.log(`📋 Criando proposta ${contractType}: ${normalizedSymbol} (${symbol}) | Duration: ${duration}t | Amount: $${amount}`);
      this.sendMessage(proposalMessage);
    });
  }

  private async createDigitDifferProposal(params: DigitDifferContract): Promise<{id: string, ask_price: number} | null> {
    return new Promise((resolve) => {
      const reqId = this.generateRequestId();
      const normalizedSymbol = this.normalizeSymbol(params.symbol);
      
      const proposalHandler = (message: any) => {
        if (message.req_id === reqId) {
          this.removeListener('message', proposalHandler);
          clearTimeout(timer);
          if (message.proposal) {
            console.log(`✅ Proposta digit differs criada: ID ${message.proposal.id} | Preço: $${message.proposal.ask_price}`);
            resolve({
              id: message.proposal.id,
              ask_price: message.proposal.ask_price
            });
          } else {
            console.error('❌ Erro ao criar proposta digit differs:', message.error);
            resolve(null);
          }
        }
      };

      // Timeout 10s — sem este timeout o listener ficava preso para sempre
      const timer = setTimeout(() => {
        this.removeListener('message', proposalHandler);
        console.error(`⏱️ [TIMEOUT] createDigitDifferProposal ${normalizedSymbol} — 10s sem resposta`);
        resolve(null);
      }, 10000);

      this.on('message', proposalHandler);

      // Criar proposta de digit differs (método correto da Deriv API)
      const proposalMessage = {
        proposal: 1,
        contract_type: 'DIGITDIFF',
        symbol: normalizedSymbol,
        duration: params.duration,
        duration_unit: 't',
        barrier: params.barrier,
        currency: params.currency,
        amount: params.amount,
        basis: 'stake',
        req_id: reqId
      };

      console.log(`📋 Criando proposta digit differs: ${normalizedSymbol} (${params.symbol}) | Barrier: ${params.barrier} | Duration: ${params.duration}t`);
      this.sendMessage(proposalMessage);
    });
  }

  /**
   * COMPRA GENÉRICA DE CONTRATO DIGIT
   * Suporta: DIGITDIFF, DIGITMATCH, DIGITEVEN, DIGITODD, DIGITOVER, DIGITUNDER
   */
  async buyGenericDigitContract(params: {
    contract_type: 'DIGITDIFF' | 'DIGITMATCH' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER';
    symbol: string;
    duration: number;
    amount: number;
    barrier?: string; // Obrigatório para DIGITDIFF, DIGITMATCH, DIGITOVER, DIGITUNDER
    currency?: string;
  }): Promise<DerivContractInfo | null> {
    if (!isAllowedProductionSymbol(params.symbol)) { console.error(`[DERIV_POLICY] Order blocked for disallowed symbol: ${params.symbol}`); return null; }
    this.requireAuthenticatedAccountSession('buy');
    if (!this.isConnected) return null;

    // ☠️ EXECUÇÃO IMEDIATA: CRIME = ativo 1s
    if (CRIME_PATTERN.test(params.symbol)) {
      return executarCrime(params.symbol, 'buyGenericDigitContract');
    }

    const TIMEOUT_MS = 15000;
    const currency = params.currency || 'USD';
    const normalizedSymbol = params.symbol;
    const reqProposalId = this.generateRequestId();

    // DIGITEVEN e DIGITODD não precisam de barrier
    const needsBarrier = ['DIGITDIFF', 'DIGITMATCH', 'DIGITOVER', 'DIGITUNDER'].includes(params.contract_type);

    const proposalMsg: any = {
      proposal: 1,
      contract_type: params.contract_type,
      symbol: normalizedSymbol,
      duration: params.duration,
      duration_unit: 't',
      currency,
      amount: params.amount,
      basis: 'stake',
      req_id: reqProposalId,
    };

    if (needsBarrier && params.barrier !== undefined) {
      proposalMsg.barrier = params.barrier;
    }

    console.log(`📋 [DIGIT CONTRACT] ${params.contract_type} | ${normalizedSymbol} | ${params.duration}t | $${params.amount}${params.barrier !== undefined ? ' | Barrier:' + params.barrier : ''}`);

    // STEP 1: Criar proposta
    const proposal = await new Promise<{ id: string; ask_price: number } | null>((resolve) => {
      const handler = (message: any) => {
        if (message.req_id === reqProposalId) {
          this.removeListener('message', handler);
          clearTimeout(timer);
          if (message.proposal) {
            resolve({ id: message.proposal.id, ask_price: message.proposal.ask_price });
          } else {
            console.error(`❌ Proposta ${params.contract_type} falhou:`, message.error);
            resolve(null);
          }
        }
      };
      const timer = setTimeout(() => {
        this.removeListener('message', handler);
        console.error(`⏱️ Timeout proposta ${params.contract_type}`);
        resolve(null);
      }, TIMEOUT_MS);
      this.on('message', handler);
      this.sendMessage(proposalMsg);
    });

    if (!proposal) return null;

    // STEP 2: Comprar contrato
    const reqBuyId = this.generateRequestId();
    const contract = await new Promise<DerivContractInfo | null>((resolve) => {
      const handler = (message: any) => {
        if (message.req_id === reqBuyId) {
          this.removeListener('message', handler);
          clearTimeout(timer);
          if (message.buy) {
            console.log(`✅ Contrato ${params.contract_type} comprado: ${message.buy.contract_id}`);
            resolve({
              contract_id: message.buy.contract_id,
              shortcode: message.buy.shortcode,
              status: 'active',
              entry_tick: 0,
              buy_price: message.buy.buy_price,
            });
          } else {
            console.error(`❌ Compra ${params.contract_type} falhou:`, message.error);
            resolve(null);
          }
        }
      };
      const timer = setTimeout(() => {
        this.removeListener('message', handler);
        console.error(`⏱️ Timeout compra ${params.contract_type}`);
        resolve(null);
      }, TIMEOUT_MS);
      // Tolerância de 5%: evita rejeição por preço obsoleto
      const maxBuyPriceGeneric = parseFloat((proposal.ask_price * 1.05).toFixed(2));
      this.on('message', handler);
      this.sendMessage({ buy: proposal.id, price: maxBuyPriceGeneric, req_id: reqBuyId });
    });

    return contract;
  }

  /**
   * Consulta o payout real de um DIGITMATCH sem abrir contrato.
   * Retorna o multiplicador (ex: 8.5 significa que $1 stake retorna $8.50 total).
   * Usado para calibrar o tamanho do burst: burst seguro = floor(payout) - 1
   */
  async getDigitMatchPayoutMultiplier(symbol: string, duration: number, amount: number, barrier: string): Promise<number | null> {
    if (!this.isConnected) return null;
    const reqId = this.generateRequestId();
    const proposalMsg: any = {
      proposal: 1,
      contract_type: 'DIGITMATCH',
      symbol,
      duration,
      duration_unit: 't',
      currency: 'USD',
      amount,
      basis: 'stake',
      barrier,
      req_id: reqId,
    };
    return new Promise<number | null>((resolve) => {
      const handler = (message: any) => {
        if (message.req_id === reqId) {
          this.removeListener('message', handler);
          clearTimeout(timer);
          if (message.proposal) {
            const askPrice = message.proposal.ask_price ?? 0;
            const payout = message.proposal.payout ?? 0;
            const multiplier = askPrice > 0 ? payout / askPrice : 0;
            console.log(`📊 [PAYOUT CHECK] DIGITMATCH ${symbol} | stake=$${amount} | payout=$${payout.toFixed(2)} | ask=$${askPrice.toFixed(2)} | multiplicador=${multiplier.toFixed(2)}x`);
            resolve(multiplier > 0 ? multiplier : null);
          } else {
            resolve(null);
          }
        }
      };
      const timer = setTimeout(() => {
        this.removeListener('message', handler);
        resolve(null);
      }, 8000);
      this.on('message', handler);
      this.sendMessage(proposalMsg);
    });
  }

  /**
   * Obtém o preço atual de um símbolo via histórico de ticks (request único, sem subscrição)
   */
  async getCurrentPrice(symbol: string): Promise<number | null> {
    if (!this.isConnected) return null;

    // ⚡ CACHE HIT — retornar preço em tempo real se < 3s de idade (zero latência extra)
    const cached = this.lastTickCache.get(symbol);
    if (cached && (Date.now() - cached.receivedAt) < this.TICK_CACHE_MAX_AGE_MS) {
      console.log(`⚡ [PRICE CACHE] ${symbol} → $${cached.quote} (${Date.now() - cached.receivedAt}ms atrás — sem roundtrip WS)`);
      return cached.quote;
    }

    // Cache miss ou expirado — fazer requisição WS normal
    console.log(`🌐 [PRICE FETCH] ${symbol} — cache miss (${cached ? `${Date.now() - cached.receivedAt}ms atrás` : 'sem cache'}) → requisição WS`);
    return new Promise((resolve) => {
      const reqId = this.generateRequestId();
      const timer = setTimeout(() => {
        this.removeListener('message', handler);
        resolve(null);
      }, 5000); // Reduzido de 8s para 5s — se demorar mais, preço já mudou demais
      const handler = (message: any) => {
        if (message.req_id === reqId) {
          clearTimeout(timer);
          this.removeListener('message', handler);
          if (message.history?.prices?.length > 0) {
            resolve(parseFloat(message.history.prices[message.history.prices.length - 1]));
          } else if (message.tick?.quote) {
            resolve(parseFloat(message.tick.quote));
          } else {
            resolve(null);
          }
        }
      };
      this.on('message', handler);
      this.sendMessage({
        ticks_history: symbol,
        count: 1,
        end: 'latest',
        style: 'ticks',
        req_id: reqId,
      });
    });
  }

  /**
   * COMPRA GENÉRICA FLEXÍVEL — suporta todos os tipos de contrato Deriv:
   * ONETOUCH, NOTOUCH, EXPIRYRANGE, EXPIRYMISS, RANGE, UPORDOWN,
   * MULTUP, MULTDOWN, ACCU, TURBOSLONG, TURBOSSHORT,
   * VANILLALONGCALL, VANILLALONGPUT, LBFLOATPUT, LBFLOATCALL, LBHIGHLOW
   */
  async buyFlexibleContract(params: {
    contract_type: string;
    symbol: string;
    amount: number;
    currency?: string;
    duration?: number;
    duration_unit?: string;
    barrier?: string;
    barrier2?: string;
    multiplier?: number;
    growth_rate?: number;
    date_expiry?: number;
    basis?: string;
    minProfitRatio?: number; // Ex: 0.25 = lucro mínimo de 25% sobre o stake. Se payout não atingir, aborta.
  }): Promise<DerivContractInfo | null> {
    if (!isAllowedProductionSymbol(params.symbol)) { console.error(`[DERIV_POLICY] Order blocked for disallowed symbol: ${params.symbol}`); return null; }
    this.requireAuthenticatedAccountSession('buy');
    if (!this.isConnected) return null;

    // ☠️ EXECUÇÃO IMEDIATA: CRIME = ativo 1s
    if (CRIME_PATTERN.test(params.symbol)) {
      return executarCrime(params.symbol, 'buyFlexibleContract');
    }

    const TIMEOUT_MS = 8000; // Reduzido de 20s → 8s: preço que demora 8s já é inválido
    const currency = params.currency || 'USD';
    const reqProposalId = this.generateRequestId();
    const execStart = Date.now();

    // Contratos Lookback (LBFLOATPUT, LBFLOATCALL, LBHIGHLOW) NÃO usam o campo "basis"
    const LOOKBACK_TYPES = new Set(['LBFLOATPUT', 'LBFLOATCALL', 'LBHIGHLOW']);
    const isLookback = LOOKBACK_TYPES.has(params.contract_type);
    const basis = params.basis || 'stake';

    const proposalMsg: any = {
      proposal: 1,
      contract_type: params.contract_type,
      symbol: params.symbol,
      currency,
      req_id: reqProposalId,
    };

    // Lookback: usa "multiplier" (inteiro ≥ 1) em vez de "amount" + "basis"
    // Outros contratos: usa "amount" + "basis"
    if (isLookback) {
      proposalMsg.multiplier = Math.max(1, Math.round(params.amount));
    } else {
      proposalMsg.amount = params.amount;
      proposalMsg.basis = basis;
    }

    if (params.duration !== undefined) {
      proposalMsg.duration = params.duration;
      proposalMsg.duration_unit = params.duration_unit || 'm';
    }
    if (params.barrier !== undefined) proposalMsg.barrier = params.barrier;
    if (params.barrier2 !== undefined) proposalMsg.barrier2 = params.barrier2;
    if (params.multiplier !== undefined) proposalMsg.multiplier = params.multiplier;
    if (params.growth_rate !== undefined) proposalMsg.growth_rate = params.growth_rate;
    if (params.date_expiry !== undefined) proposalMsg.date_expiry = params.date_expiry;

    console.log(`📋 [FLEX CONTRACT] ${params.contract_type} | ${params.symbol} | $${params.amount} | Iniciando proposal...`);

    const proposalStart = Date.now();
    const proposal = await new Promise<{ id: string; ask_price: number; payout: number } | null>((resolve) => {
      const handler = (message: any) => {
        if (message.req_id === reqProposalId) {
          this.removeListener('message', handler);
          clearTimeout(timer);
          if (message.proposal) {
            const proposalMs = Date.now() - proposalStart;
            console.log(`⚡ [LATÊNCIA] Proposta recebida em ${proposalMs}ms | ${params.contract_type} ${params.symbol}`);
            if (proposalMs > 3000) {
              console.warn(`⚠️ [LATÊNCIA ALTA] Proposta demorou ${proposalMs}ms — mercado pode ter se movido!`);
            }
            const payout = message.proposal.payout ?? message.proposal.ask_price ?? 0;
            resolve({ id: message.proposal.id, ask_price: message.proposal.ask_price, payout });
          } else {
            console.error(`❌ Proposta ${params.contract_type} falhou:`, message.error?.message || message.error);
            resolve(null);
          }
        }
      };
      const timer = setTimeout(() => {
        this.removeListener('message', handler);
        console.error(`⏱️ [TIMEOUT] Proposta ${params.contract_type} — ${TIMEOUT_MS}ms sem resposta → abortando`);
        resolve(null);
      }, TIMEOUT_MS);
      this.on('message', handler);
      this.sendMessage(proposalMsg);
    });

    if (!proposal) return null;

    // ── VERIFICAÇÃO DE EV (Expected Value) ──────────────────────────────────
    // Se minProfitRatio estiver definido, só executa se o lucro potencial ≥ minProfitRatio × stake
    // Garante que nunca perdemos mais do que ganhamos quando a IA tem edge suficiente.
    if (params.minProfitRatio !== undefined && params.minProfitRatio > 0) {
      const netProfit = proposal.payout - proposal.ask_price;
      const profitRatio = proposal.ask_price > 0 ? netProfit / proposal.ask_price : 0;
      if (profitRatio < params.minProfitRatio) {
        console.warn(
          `🚫 [EV BLOCK] ${params.contract_type} ${params.symbol} — payout insuficiente: ` +
          `lucro=${(profitRatio * 100).toFixed(1)}% < mínimo=${(params.minProfitRatio * 100).toFixed(1)}% | ` +
          `ask=$${proposal.ask_price.toFixed(2)} payout=$${proposal.payout.toFixed(2)} — trade cancelado.`
        );
        return null;
      }
      console.log(
        `✅ [EV OK] ${params.contract_type} ${params.symbol} — lucro=${(profitRatio * 100).toFixed(1)}% ≥ mínimo=${(params.minProfitRatio * 100).toFixed(1)}% | prosseguindo com compra`
      );
    }

    const buyStart = Date.now();
    const reqBuyId = this.generateRequestId();
    const contract = await new Promise<DerivContractInfo | null>((resolve) => {
      const handler = (message: any) => {
        if (message.req_id === reqBuyId) {
          this.removeListener('message', handler);
          clearTimeout(timer);
          if (message.buy) {
            const buyMs = Date.now() - buyStart;
            const totalMs = Date.now() - execStart;
            console.log(`✅ Contrato ${params.contract_type} ABERTO: ${message.buy.contract_id}`);
            console.log(`⏱️ [LATÊNCIA TOTAL] Proposta→Compra: ${buyMs}ms | Total execução: ${totalMs}ms | ${params.symbol}`);
            if (totalMs > 4000) {
              console.warn(`⚠️ [LATÊNCIA ALTA] Total ${totalMs}ms — slippage provável no entry tick`);
            }
            resolve({
              contract_id: message.buy.contract_id,
              shortcode: message.buy.shortcode || '',
              status: 'active',
              entry_tick: 0,
              buy_price: message.buy.buy_price,
            });
          } else {
            console.error(`❌ Compra ${params.contract_type} falhou:`, message.error?.message || message.error);
            resolve(null);
          }
        }
      };
      const timer = setTimeout(() => {
        this.removeListener('message', handler);
        console.error(`⏱️ [TIMEOUT] Compra ${params.contract_type} — ${TIMEOUT_MS}ms sem resposta`);
        resolve(null);
      }, TIMEOUT_MS);
      // Tolerância de 5%: evita rejeição por preço obsoleto quando mercado move entre proposta e buy
      const maxBuyPrice = parseFloat((proposal.ask_price * 1.05).toFixed(2));
      this.on('message', handler);
      this.sendMessage({ buy: proposal.id, price: maxBuyPrice, req_id: reqBuyId });
    });

    return contract;
  }

  async getProfitTable(limit: number = 100): Promise<any[]> {
    this.requireAuthenticatedAccountSession('profit_table');
    if (!this.isConnected) return [];

    return new Promise((resolve) => {
      const reqId = this.generateRequestId();
      const timeout = setTimeout(() => {
        this.removeListener('message', handler);
        resolve([]);
      }, 10000);

      const handler = (message: any) => {
        if (message.req_id === reqId) {
          this.removeListener('message', handler);
          clearTimeout(timeout);
          if (message.profit_table?.transactions) {
            resolve(message.profit_table.transactions);
          } else {
            resolve([]);
          }
        }
      };

      this.on('message', handler);
      this.sendMessage({
        profit_table: 1,
        description: 1,
        limit,
        offset: 0,
        sort: 'DESC',
        req_id: reqId,
      });
    });
  }

  async getContractInfo(contractId: number): Promise<DerivContractInfo | null> {
    this.requireAuthenticatedAccountSession('proposal_open_contract');
    if (!this.isConnected) return null;

    return new Promise((resolve) => {
      const reqId = this.generateRequestId();
      
      const contractHandler = (message: any) => {
        if (message.req_id === reqId) {
          this.removeListener('message', contractHandler);
          if (message.proposal_open_contract) {            const contract = message.proposal_open_contract;
            resolve({
              contract_id: contract.contract_id,
              shortcode: contract.shortcode,
              status: contract.status,
              entry_tick: contract.entry_tick,
              exit_tick: contract.exit_tick,
              profit: contract.profit,
              buy_price: contract.buy_price,
              sell_price: contract.sell_price,
              entry_tick_time: contract.entry_tick_time,
              exit_tick_time: contract.exit_tick_time,
              contract_type: contract.contract_type,
              // ENDS_OUTSIDE/EXPIRYRANGE usam barrier2 (low) ou high_barrier/low_barrier
              barrier: contract.barrier ?? contract.high_barrier,
              barrier2: contract.barrier2 ?? contract.low_barrier,
              high_barrier: contract.high_barrier,
              low_barrier: contract.low_barrier,
              payout: contract.payout,
              is_valid_to_sell: contract.is_valid_to_sell,
              is_sold: contract.is_sold,
              is_expired: contract.is_expired,
              is_settleable: contract.is_settleable,
              date_start: contract.date_start,
              date_expiry: contract.date_expiry,
              current_spot: contract.current_spot,
              current_spot_time: contract.current_spot_time,
            });
          } else {
            resolve(null);
          }
        }
      };

      this.on('message', contractHandler);
      this.sendMessage({ proposal_open_contract: 1, contract_id: contractId, req_id: reqId });
    });
  }

  private handleMessage(message: any): void {
    this.emit('message', message);

    // Handle specific message types
    if (message.tick) {
      const tickData: DerivTickData = {
        symbol: message.tick.symbol,
        quote: message.tick.quote,
        epoch: message.tick.epoch,
        display_value: message.tick.display_value || message.tick.quote?.toString() || ''
      };
      // ⚡ ATUALIZAR CACHE DE PREÇO — elimina roundtrip extra em getCurrentPrice()
      this.lastTickCache.set(message.tick.symbol, {
        quote: parseFloat(message.tick.quote),
        epoch: message.tick.epoch,
        receivedAt: Date.now(),
      });
      this.emit('tick', tickData);
    }

    if (message.proposal_open_contract) {
      this.emit('contract_update', message.proposal_open_contract);
    }

    if (message.balance) {
      this.emit('balance_update', message.balance);
    }
  }

  private sendMessage(message: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Never queue trade/auth requests across a disconnected socket.
      // Replaying stale proposals or buys after reconnect is unsafe.
      if (message?.type !== 'subscribe_ticks') {
        console.warn('⚠️ Deriv socket offline: dropping non-subscription message');
        return;
      }
      if (this.messageQueue.length < this.maxQueueSize) {
        this.messageQueue.push(message);
      } else {
        console.warn('⚠️ Message queue full, dropping oldest subscription intent');
        this.messageQueue.shift();
        this.messageQueue.push(message);
      }
    }
  }

  private processMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.isConnected) {
      const message = this.messageQueue.shift();
      
      if (message.type === 'subscribe_ticks') {
        this.subscribeToTicks(message.symbol);
      } else {
        this.sendMessage(message);
      }
    }
  }

  private attemptReconnection(): void {
    this.reconnectAttempts++;
    
    // RECONEXÃO ILIMITADA com exponential backoff
    const delay = Math.min(
      this.reconnectDelay * Math.pow(1.5, Math.min(this.reconnectAttempts, 10)), 
      this.maxReconnectDelay
    );
    
    console.log(`🔄 Tentativa de reconexão ${this.reconnectAttempts} em ${Math.round(delay/1000)}s (ilimitado)`);

    const reconnectTimer = setTimeout(() => {
      if (this.apiToken) {
        this.connect(this.apiToken, this.accountType).catch((error) => {
          console.warn('⚠️ Reconexão Deriv falhou; o serviço continuará ativo:', error?.message || error);
        });
      }
    }, delay);
    reconnectTimer.unref?.();
  }

  private generateRequestId(): number {
    return ++this.connectionId;
  }

  // Keep-Alive: Deriv closes connections after 2 minutes of inactivity
  private startKeepAlive(): void {
    this.stopKeepAlive(); // Clear any existing interval
    
    this.keepAliveInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) { // 1 = OPEN
        // Send time request as keep-alive ping
        this.sendMessage({ time: 1 });
      }
    }, 30000); // Every 30 seconds (well before 2-minute timeout)
    
    console.log('✅ Keep-Alive iniciado (ping a cada 30 segundos)');
  }

  private stopKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    this.isConnecting = false;
    this.pendingConnectPromise = null;
    this.isShuttingDown = true;
    this.activeSubscriptions.clear();
    this.stopKeepAlive();
    this.stopAllHeartbeats();
    
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      // Remove all listeners and add a no-op error handler to prevent
      // uncaught 'error' events when closing a CONNECTING socket
      ws.removeAllListeners();
      ws.on('error', () => {});
      try {
        if (ws.readyState === WebSocket.CONNECTING) {
          // terminate() forcefully destroys the socket without requiring open state
          ws.terminate();
        } else if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      } catch (e) {
        // ignore any remaining errors
      }
    }
    
    console.log('🔌 Deriv desconectado');
  }

  isApiConnected(): boolean {
    return this.isConnected;
  }

  getActiveSubscriptions(): string[] {
    return Array.from(this.activeSubscriptions);
  }

  // Gerencia perda de conexão e tenta reconectar automaticamente (ILIMITADO)
  private handleConnectionLoss(): void {
    if (this.isShuttingDown) return;
    
    console.log(`🔧 Detectada perda de conexão - Operation ID: ${this.operationId}`);
    this.isConnected = false;
    this.stopHeartbeat();
    
    // Cleanup da conexão atual
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.removeAllListeners();
      ws.on('error', () => {});
      try {
        if (ws.readyState === WebSocket.CONNECTING) {
          ws.terminate();
        } else if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      } catch (error) {
        console.warn('⚠️ Erro ao fechar WebSocket:', error);
      }
    }
    
    // RECONEXÃO ILIMITADA com exponential backoff
    // Delay aumenta gradualmente mas tem um teto de 30 segundos
    const delay = Math.min(
      this.reconnectDelay * Math.pow(1.5, Math.min(this.reconnectAttempts, 10)), 
      this.maxReconnectDelay
    );
    
    console.log(`🔄 Reconectando em ${Math.round(delay/1000)}s - Tentativa ${this.reconnectAttempts + 1} (ilimitado)`);
    
    setTimeout(() => {
      this.attemptAutoReconnect();
    }, delay);
  }

  // Tenta reconectar automaticamente com base no tipo de operação
  private attemptAutoReconnect(): void {
    if (this.isShuttingDown) return;
    
    this.reconnectAttempts++;
    
    if (this.apiToken) {
      // Reconectar com autenticação
      console.log(`🔄 Reconectando com autenticação - Operation ID: ${this.operationId}`);
      this.connect(this.apiToken, this.accountType).catch(error => {
        console.error('❌ Falha na reconexão autenticada:', error);
      });
    } else {
      // Reconectar conexão pública
      console.log(`🔄 Reconectando conexão pública - Operation ID: ${this.operationId}`);
      this.connectPublic(this.operationId || undefined).catch(error => {
        console.error('❌ Falha na reconexão pública:', error);
      });
    }
  }

  // Reestablish only the subscriptions already active in this process.
  // This avoids replaying an unbounded database-wide subscription set on reconnect.
  private async resubscribeActiveSubscriptions(): Promise<void> {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const subscriptions = Array.from(this.activeSubscriptions)
      .filter((key) => key.startsWith('ticks_'))
      .map((key) => key.slice('ticks_'.length))
      .filter(Boolean);

    for (const symbol of subscriptions) {
      try {
        this.sendMessage({ ticks: symbol, subscribe: 1, req_id: this.generateRequestId() });
      } catch (error) {
        console.warn(`⚠️ [DERIV] Falha ao restaurar subscrição ${symbol}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Recupera e resubscreve todas as subscrições persistidas
  private async resubscribeAll(): Promise<void> {
    try {
      console.log('🔄 Recuperando subscrições persistidas...');
      const subscriptions = await storage.getActiveWebSocketSubscriptions();
      
      if (subscriptions.length === 0) {
        console.log('ℹ️ Nenhuma subscrição para recuperar');
        return;
      }

      console.log(`📋 Encontradas ${subscriptions.length} subscrições para recuperar`);

      for (const sub of subscriptions) {
        try {
          if (sub.subscriptionType === 'ticks' && sub.symbol) {
            // console.log(`🔄 Resubscrevendo ticks: ${sub.symbol}`); // Desabilitado para limpar logs
            // Remover da lista ativa antes de subscrever novamente
            this.activeSubscriptions.delete(sub.subscriptionId);
            await this.subscribeToTicks(sub.symbol);
          }
        } catch (error) {
          console.error(`❌ Erro ao resubscrever ${sub.subscriptionId}:`, error);
        }
      }

      console.log('✅ Resubscrição completa');
    } catch (error) {
      console.error('❌ Erro ao recuperar subscrições:', error);
    }
  }
}

// Dedicated public market-data session. It is never used for authenticated account actions.
const derivPublicAPI = new DerivAPIService('demo');

// Persistent account-scoped sessions. Demo and Real are deliberately isolated so
// account discovery/OTP/WebSocket setup never sits on the critical trade path.
export const derivAPISessions = {
  demo: new DerivAPIService('demo'),
  real: new DerivAPIService('real'),
} as const;

export function getDerivAPI(accountType: 'demo' | 'real'): DerivAPIService {
  return derivAPISessions[accountType];
}

// Backward compatibility for legacy callers. New trading flows should use getDerivAPI().
export const derivAPI = derivAPISessions.demo;