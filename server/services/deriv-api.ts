import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { errorTracker } from './error-tracker';
import { storage } from '../storage';
import { resilienceSupervisor } from './resilience-supervisor';

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
  private apiToken: string | null = null;
  private accountType: 'demo' | 'real' = 'demo';
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

  constructor() {
    super();
    
    // Configurar listeners para error recovery
    this.setMaxListeners(20); // Evitar memory leaks
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

    // Setup graceful shutdown
    process.on('SIGTERM', () => this.gracefulShutdown());
    process.on('SIGINT', () => this.gracefulShutdown());
  }

  async connectPublic(operationId?: string): Promise<boolean> {
    // Conexão pública sem autenticação para ticks
    this.operationId = operationId || `CONNECT_PUBLIC_${Date.now()}`;
    this.isShuttingDown = false;
    
    const appId = process.env.DERIV_APP_ID || '1089';
    const endpoint = `wss://ws.binaryws.com/websockets/v3?app_id=${appId}`;

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

  async connect(apiToken: string, accountType: 'demo' | 'real' = 'demo', operationId?: string): Promise<boolean> {
    this.operationId = operationId || `CONNECT_${Date.now()}`;
    this.apiToken = apiToken;
    this.accountType = accountType;
    this.isShuttingDown = false;
    
    const appId = process.env.DERIV_APP_ID || '1089';
    const endpoint = accountType === 'demo' 
      ? `wss://ws.derivws.com/websockets/v3?app_id=${appId}`
      : `wss://ws.derivws.com/websockets/v3?app_id=${appId}`;

    console.log(`🔌 Iniciando conexão Deriv - Operation ID: ${this.operationId}`);

    return new Promise((resolve, reject) => {
      const connectionTimer = setTimeout(() => {
        const timeoutError = new Error('Connection timeout after 10 seconds');
        
        errorTracker.captureError(
          timeoutError,
          'ERROR',
          'WEBSOCKET',
          {
            requestPath: 'DERIV_CONNECTION_TIMEOUT',
            requestMethod: 'CONNECT',
            requestBody: {
              operationId: this.operationId,
              endpoint,
              accountType,
              timeout: '10s'
            }
          }
        );
        
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
          console.log(`🔗 Deriv WebSocket conectado - Operation ID: ${this.operationId}`);
          this.isConnected = true;
          this.reconnectAttempts = 0;
          
          try {
            // Authenticate
            const authResult = await this.authenticate();
            if (authResult) {
              this.emit('connected');
              this.processMessageQueue();
              this.startHeartbeat();
              
              // Resubscrever todas as subscrições após reconexão
              // TEMPORARIAMENTE DESABILITADO: await this.resubscribeAll();
              // Motivo: 11,396 subscrições estão bloqueando a inicialização do servidor
              
              resolve(true);
            } else {
              const authError = new Error('Authentication failed');
              
              errorTracker.captureError(
                authError,
                'ERROR',
                'AUTH',
                {
                  requestPath: 'DERIV_AUTHENTICATION',
                  requestMethod: 'AUTHENTICATE',
                  requestBody: {
                    operationId: this.operationId,
                    accountType
                  }
                }
              );
              
              this.cleanup();
              reject(authError);
            }
          } catch (authError) {
            clearTimeout(connectionTimer);
            
            errorTracker.captureError(
              authError as Error,
              'ERROR',
              'AUTH',
              {
                requestPath: 'DERIV_AUTHENTICATION_EXCEPTION',
                requestMethod: 'AUTHENTICATE',
                requestBody: {
                  operationId: this.operationId,
                  accountType
                }
              }
            );
            
            this.cleanup();
            reject(authError);
          }
        });

        this.ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (error) {
            errorTracker.captureError(
              error as Error,
              'WARNING',
              'WEBSOCKET',
              {
                requestPath: 'DERIV_MESSAGE_PARSE',
                requestMethod: 'MESSAGE',
                requestBody: {
                  operationId: this.operationId,
                  rawData: data.toString().substring(0, 200)
                }
              }
            );
          }
        });

        this.setupWebSocketListeners(reject, connectionTimer, endpoint, accountType);

      } catch (error) {
        clearTimeout(connectionTimer);
        
        errorTracker.captureError(
          error as Error,
          'ERROR',
          'WEBSOCKET',
          {
            requestPath: 'DERIV_CONNECTION_SETUP',
            requestMethod: 'CONNECT',
            requestBody: {
              operationId: this.operationId,
              endpoint,
              accountType
            }
          }
        );
        
        console.error(`❌ Erro ao configurar conexão Deriv - Operation ID: ${this.operationId}:`, error);
        reject(error);
      }
    });
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
    // Reportar saúde ao supervisor a cada 60 segundos
    this.supervisorHeartbeatInterval = setInterval(async () => {
      try {
        await resilienceSupervisor.reportHeartbeat('websocket', {
          isConnected: this.isConnected,
          wsReadyState: this.ws?.readyState,
          activeSubscriptions: this.activeSubscriptions.size,
          reconnectAttempts: this.reconnectAttempts,
          operationId: this.operationId,
        });
      } catch (error) {
        console.error('❌ Erro ao reportar heartbeat ao supervisor:', error);
      }
    }, 60000);
    console.log(`💓 Heartbeat do ResilienceSupervisor iniciado`);
  }

  private stopHeartbeat(): void {
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
    this.stopHeartbeat();
    this.isConnected = false;
    
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  private async gracefulShutdown(): Promise<void> {
    this.isShuttingDown = true;
    console.log(`🛑 Iniciando shutdown graceful do Deriv API - Operation ID: ${this.operationId}`);
    
    await this.disconnect();
    this.removeAllListeners();
    
    console.log(`✅ Shutdown graceful concluído - Operation ID: ${this.operationId}`);
  }

  private async authenticate(): Promise<boolean> {
    if (!this.apiToken) return false;

    return new Promise((resolve) => {
      const reqId = this.generateRequestId();
      
      const authMessage = {
        authorize: this.apiToken,
        req_id: reqId
      };

      // Store auth handler
      const authHandler = (message: any) => {
        if (message.req_id === reqId) {
          this.removeListener('message', authHandler);
          if (message.authorize) {
            console.log('✅ Deriv autenticação realizada com sucesso');
            console.log(`📊 Conta: ${message.authorize.loginid} (${message.authorize.currency})`);
            resolve(true);
          } else {
            console.error('❌ Falha na autenticação Deriv:', message.error);
            resolve(false);
          }
        }
      };

      this.on('message', authHandler);
      this.sendMessage(authMessage);
    });
  }

  async getBalance(): Promise<DerivBalance | null> {
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

  async subscribeToTicks(symbol: string): Promise<void> {
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
        const buyMessage = {
          buy: proposal.id,
          price: proposal.ask_price,
          req_id: reqId
        };

        console.log(`📝 Comprando contrato ${contractType} com proposta ID: ${proposal.id}`);
        this.sendMessage(buyMessage);
      });

    } catch (error) {
      console.error('❌ Erro no processo de compra CALL/PUT:', error);
      return null;
    }
  }

  async buyDigitDifferContract(params: DigitDifferContract): Promise<DerivContractInfo | null> {
    if (!this.isConnected) return null;

    try {
      // Passo 1: Criar proposta para validar o contrato
      const proposal = await this.createDigitDifferProposal(params);
      if (!proposal) {
        console.error('❌ Falha ao criar proposta para digit differs');
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

        // Comprar usando o ID da proposta (método correto da Deriv API)
        const buyMessage = {
          buy: proposal.id,
          price: proposal.ask_price,
          req_id: reqId
        };

        console.log(`📝 Comprando contrato digit differs com proposta ID: ${proposal.id}`);
        this.sendMessage(buyMessage);
      });

    } catch (error) {
      console.error('❌ Erro no processo de compra digit differs:', error);
      return null;
    }
  }

  private async createCallPutProposal(symbol: string, contractType: 'CALL' | 'PUT', duration: number, amount: number): Promise<{id: string, ask_price: number} | null> {
    return new Promise((resolve) => {
      const reqId = this.generateRequestId();
      
      const proposalHandler = (message: any) => {
        if (message.req_id === reqId) {
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
        symbol: symbol,
        duration: duration,
        duration_unit: 't',
        currency: 'USD',
        amount: amount,
        basis: 'stake',
        req_id: reqId
      };

      console.log(`📋 Criando proposta ${contractType}: ${symbol} | Duration: ${duration}t | Amount: $${amount}`);
      this.sendMessage(proposalMessage);
    });
  }

  private async createDigitDifferProposal(params: DigitDifferContract): Promise<{id: string, ask_price: number} | null> {
    return new Promise((resolve) => {
      const reqId = this.generateRequestId();
      
      const proposalHandler = (message: any) => {
        if (message.req_id === reqId) {
          this.removeListener('message', proposalHandler);
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

      this.on('message', proposalHandler);

      // Criar proposta de digit differs (método correto da Deriv API)
      const proposalMessage = {
        proposal: 1,
        contract_type: 'DIGITDIFF',
        symbol: params.symbol,
        duration: params.duration,
        duration_unit: 't',
        barrier: params.barrier,
        currency: params.currency,
        amount: params.amount,
        basis: 'stake',
        req_id: reqId
      };

      console.log(`📋 Criando proposta digit differs: ${params.symbol} | Barrier: ${params.barrier} | Duration: ${params.duration}t`);
      this.sendMessage(proposalMessage);
    });
  }

  async getContractInfo(contractId: number): Promise<DerivContractInfo | null> {
    if (!this.isConnected) return null;

    return new Promise((resolve) => {
      const reqId = this.generateRequestId();
      
      const contractHandler = (message: any) => {
        if (message.req_id === reqId) {
          this.removeListener('message', contractHandler);
          if (message.proposal_open_contract) {
            const contract = message.proposal_open_contract;
            resolve({
              contract_id: contract.contract_id,
              shortcode: contract.shortcode,
              status: contract.status,
              entry_tick: contract.entry_tick,
              exit_tick: contract.exit_tick,
              profit: contract.profit,
              buy_price: contract.buy_price,
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
      // Queue message with size limit to prevent memory issues
      if (this.messageQueue.length < this.maxQueueSize) {
        this.messageQueue.push(message);
      } else {
        console.warn('⚠️ Message queue full, dropping oldest message');
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

    setTimeout(() => {
      if (this.apiToken) {
        this.connect(this.apiToken, this.accountType);
      }
    }, delay);
  }

  private generateRequestId(): number {
    return ++this.connectionId;
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    this.activeSubscriptions.clear();
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
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
      try {
        this.ws.close();
      } catch (error) {
        console.warn('⚠️ Erro ao fechar WebSocket:', error);
      }
      this.ws = null;
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

// Singleton instance
export const derivAPI = new DerivAPIService();