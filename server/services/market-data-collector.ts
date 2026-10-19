import { EventEmitter } from 'events';
import { DerivAPIService, DerivTickData } from './deriv-api.js';
import { storage } from '../storage.js';
import { microscopicAnalyzer } from './microscopic-technical-analysis.js';
import { digitFrequencyAnalyzer } from './digit-frequency-analyzer.js';
import { supremeAnalyzer } from './supreme-market-analyzer.js';
import { isAllowedProductionSymbol, normalizeProductionMode, PRODUCTION_MODALITY_CONTRACT_TYPES } from './production-symbol-policy.js';

interface TickBuffer {
  symbol: string;
  ticks: DerivTickData[];
  lastUpdate: number;
}

/**
 * Serviço responsável por coletar e salvar dados de mercado em tempo real
 * Opera como "Fluxo Natural de Análises Cooperativas de Inteligência Artificial" - análise contínua sem limitações
 */
export class MarketDataCollector extends EventEmitter {
  private derivAPI: DerivAPIService;
  private tickBuffers: Map<string, TickBuffer> = new Map();
  private saveInterval: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isCollecting = false;
  private isDiscoveryComplete = false;
  private totalTicksReceived = 0;
  private lastPersistenceSuccessAt = 0;
  private persistenceFailures = 0;
  
  // No hard-coded symbol fallback: every collected symbol must be discovered live
  // and be eligible for at least one approved modality.

  // Limite rígido para produção no Render Free. Nunca abrir centenas/milhares de streams.
  private static readonly MAX_STREAM_SYMBOLS = 9;

  // Never subscribe to every Deriv symbol. Runtime discovery selects a small,
  // coverage-optimized union across every modality exposed by the trading UI.
  private static readonly BLOCKED_SYMBOLS_PATTERN = /\(1s\)|^1HZ|_1S/i;
  private DIGITDIFF_SUPPORTED_SYMBOLS: string[] = [];
  private supportedSymbolsByMode: Record<string, string[]> = {};
  private allDerivSymbols: Map<string, any> = new Map();
  private symbolsRefreshInterval: NodeJS.Timeout | null = null;
  private lastSymbolsUpdate: number = 0;
  
  // Configurações do "Fluxo Natural de Análises Cooperativas de Inteligência Artificial" - análise microscópica contínua
  private readonly BUFFER_SIZE = 250; // Buffer curto: dados em tempo real, sem acumular memória indefinidamente
  private readonly SAVE_INTERVAL_MS = 15000; // Persistência em lote a cada 15s
  private readonly MAX_PRICE_HISTORY = 500; // Histórico persistido limitado por símbolo
  
  constructor() {
    super();
    this.derivAPI = new DerivAPIService();
    this.setupEventListeners();
    this.setupMicroscopicAnalysis();
  }

  private setupEventListeners(): void {
    // Escutar ticks da Deriv em tempo real
    this.derivAPI.on('tick', (tickData: DerivTickData) => {
      this.processTick(tickData);
    });

    // 🔄 AUTO-RESUBSCRIBE: quando a conexão pública reconectar, resubscrever todos os ativos
    this.derivAPI.on('connected', async () => {
      if (!this.isCollecting || this.DIGITDIFF_SUPPORTED_SYMBOLS.length === 0) return;
      console.log(`🔄 [FNACIA] WebSocket reconectado — resubscrevendo ${this.DIGITDIFF_SUPPORTED_SYMBOLS.length} ativos...`);
      try {
        for (const symbol of this.DIGITDIFF_SUPPORTED_SYMBOLS) {
          await this.derivAPI.subscribeToTicks(symbol);
        }
        console.log(`✅ [FNACIA] Resubscrição completa: ${this.DIGITDIFF_SUPPORTED_SYMBOLS.length} ativos ativos`);
      } catch (err) {
        console.error('❌ [FNACIA] Erro ao resubscrever após reconexão:', err);
      }
    });

    // Salvar dados periodicamente (análise microscópica contínua)
    this.saveInterval = setInterval(() => {
      this.saveBufferedData();
    }, this.SAVE_INTERVAL_MS);

    // Heartbeat para ResilienceSupervisor (a cada 30s)
    // Envia heartbeat imediato na inicialização para evitar falso-alarme do supervisor
    const sendHeartbeat = async () => {
      try {
        await storage.updateSystemHeartbeat('market_collector', 'healthy', {
          isCollecting: this.isCollecting,
          activeSymbols: this.tickBuffers.size,
          timestamp: new Date().toISOString()
        });
      } catch {}
    };
    sendHeartbeat(); // imediato
    this.heartbeatInterval = setInterval(sendHeartbeat, 30000);
  }

  /**
   * Configurar análise técnica microscópica em milissegundos
   */
  private setupMicroscopicAnalysis(): void {
    console.log('🔬 [FNACIA] Sistema microscópico integrado - análises técnicas em milissegundos via singleton');
  }

  /**
   * Obter lista de símbolos que suportam DIGITDIFF
   * Retorna fallback seguro se a lista estiver vazia
   */
  getSupportedSymbols(): string[] {
    return this.DIGITDIFF_SUPPORTED_SYMBOLS.filter((symbol) =>
      isAllowedProductionSymbol(symbol) && !MarketDataCollector.BLOCKED_SYMBOLS_PATTERN.test(symbol)
    );
  }

  getSupportedSymbolsByTradeMode(mode: string): string[] {
    const key = normalizeProductionMode(mode);
    return [...(this.supportedSymbolsByMode[key] ?? [])];
  }

  /**
   * Verificar se a descoberta dinâmica foi concluída
   */
  isDiscoveryDone(): boolean {
    return this.isDiscoveryComplete;
  }

  /**
   * Processar tick recebido da Deriv - operação do "Fluxo Natural de Análises Cooperativas de Inteligência Artificial"
   */
  private processTick(tickData: DerivTickData): void {
    const { symbol } = tickData;
    
    // 🚫 BLOQUEIO TOTAL: Ignorar ativos com "(1s)" - CAUSADORES DE LOSS
    if (MarketDataCollector.BLOCKED_SYMBOLS_PATTERN.test(symbol)) {
      // Ignorar silenciosamente para não poluir logs
      return;
    }
    
    // 🎯 FILTRO: Ignorar símbolos que não suportam DIGITDIFF (economia de RAM e processamento)
    if (!this.DIGITDIFF_SUPPORTED_SYMBOLS.includes(symbol)) {
      // Ignorar silenciosamente para não poluir logs
      return;
    }
    
    // Obter ou criar buffer para o símbolo
    let buffer = this.tickBuffers.get(symbol);
    if (!buffer) {
      buffer = {
        symbol,
        ticks: [],
        lastUpdate: Date.now()
      };
      this.tickBuffers.set(symbol, buffer);
    }

    // Count every real tick since the current Play; persistence flushes may empty buffers.
    this.totalTicksReceived += 1;
    // Adicionar tick ao buffer
    buffer.ticks.push(tickData);
    buffer.lastUpdate = Date.now();

    // Manter apenas os últimos N ticks para otimização
    if (buffer.ticks.length > this.BUFFER_SIZE) {
      buffer.ticks = buffer.ticks.slice(-this.BUFFER_SIZE);
    }

    // Emitir evento para análises em tempo real
    this.emit('tick_processed', {
      symbol,
      tick: tickData,
      bufferSize: buffer.ticks.length,
      timestamp: Date.now()
    });

    // Análise técnica microscópica em milissegundos via singleton
    if (microscopicAnalyzer && microscopicAnalyzer.addTick) {
      microscopicAnalyzer.addTick(symbol, tickData);
    } else {
      console.warn('⚠️ [FNACIA] microscopicAnalyzer não disponível:', microscopicAnalyzer);
    }

    // 🧠 SUPREME MARKET ANALYZER: alimentar com preço em tempo real
    supremeAnalyzer.addTick(symbol, tickData.quote, tickData.epoch ? tickData.epoch * 1000 : Date.now());

    // 🎯 DIGIT FREQUENCY ANALYZER: Alimentar com o último dígito do tick em tempo real
    try {
      const priceStr = (tickData as any).display_value || tickData.quote.toString();
      const lastDigit = digitFrequencyAnalyzer.extractLastDigit(priceStr);
      if (lastDigit !== null) {
        digitFrequencyAnalyzer.processTickDigit(symbol, lastDigit);
      }
    } catch (e) {
      // silencioso - não quebrar fluxo principal por causa do analisador
    }

  }

  /**
   * Salvar dados bufferizados no banco - análise microscópica contínua (FNACIA)
   */
  private async saveBufferedData(): Promise<void> {
    if (this.tickBuffers.size === 0) return;

    const savePromises: Promise<void>[] = [];

    const entries = Array.from(this.tickBuffers.entries());
    for (const entry of entries) {
      const [symbol, buffer] = entry;
      if (buffer.ticks.length === 0) continue;

      const savePromise = this.saveSymbolData(symbol, buffer);
      savePromises.push(savePromise);
    }

    try {
      await Promise.all(savePromises);
    } catch (error) {
      console.error('❌ [FNACIA] Erro ao salvar dados:', error);
    }
  }

  /**
   * Salvar dados de um símbolo específico
   */
  private async saveSymbolData(symbol: string, buffer: TickBuffer): Promise<void> {
    try {
      // Obter dados existentes
      const existingData = await storage.getMarketData(symbol);
      
      let priceHistory: number[] = [];
      
      if (existingData) {
        // Mesclar com histórico existente
        const existing = JSON.parse(existingData.priceHistory || '[]');
        priceHistory = [...existing, ...buffer.ticks.map(t => t.quote)];
      } else {
        // Criar novo histórico
        priceHistory = buffer.ticks.map(t => t.quote);
      }

      // Limitar histórico para não sobrecarregar
      if (priceHistory.length > this.MAX_PRICE_HISTORY) {
        priceHistory = priceHistory.slice(-this.MAX_PRICE_HISTORY);
      }

      // Preço atual (último tick)
      const currentPrice = buffer.ticks[buffer.ticks.length - 1].quote;

      // Salvar no banco
      await storage.upsertMarketData({
        symbol,
        currentPrice,
        priceHistory: JSON.stringify(priceHistory),
        isSimulated: false // Dados reais da Deriv
      });
      this.lastPersistenceSuccessAt = Date.now();

      // Dados salvos silenciosamente para evitar log flood

      // Limpar buffer após salvar
      buffer.ticks = [];

    } catch (error) {
      this.persistenceFailures += 1;
      console.error(`❌ [FNACIA] Erro ao salvar ${symbol}:`, error);
    }
  }

  /**
   * Descobrir e carregar todos os ativos DIGITDIFF disponíveis
   * Retorna fallback seguro se a descoberta falhar
   */
  async discoverAndLoadAllAssets(): Promise<string[]> {
    try {
      console.log('[DISCOVERY] Consultando ativos sintéticos disponíveis por modalidade...');
      if (!this.derivAPI.getIsConnected()) await this.derivAPI.connectPublic('MARKET_MODE_DISCOVERY');
      const allSymbols = await this.derivAPI.getActiveSymbolsCached();
      const modes = Object.keys(PRODUCTION_MODALITY_CONTRACT_TYPES);
      const availableByMode = await this.derivAPI.getAvailableSymbolsByTradeModes(modes);
      this.supportedSymbolsByMode = Object.fromEntries(
        modes.map((mode) => [
          mode,
          [...new Set((availableByMode[mode] ?? []).map((entry: any) => String(entry.symbol)))],
        ])
      );

      // Pick a small set of live streams that covers as many available modalities
      // as possible. This keeps Render Free within its stream budget without
      // hard-coding the collector to only Digit Differs and Accumulators.
      const coverageBySymbol = new Map<string, Set<string>>();
      for (const mode of modes) {
        for (const entry of availableByMode[mode] ?? []) {
          const symbol = String(entry.symbol);
          if (!isAllowedProductionSymbol(symbol) || MarketDataCollector.BLOCKED_SYMBOLS_PATTERN.test(symbol)) continue;
          if (!coverageBySymbol.has(symbol)) coverageBySymbol.set(symbol, new Set<string>());
          coverageBySymbol.get(symbol)!.add(mode);
        }
      }

      const selected: string[] = [];
      const uncovered = new Set(modes.filter((mode) => (availableByMode[mode] ?? []).length > 0));
      while (selected.length < MarketDataCollector.MAX_STREAM_SYMBOLS && uncovered.size > 0) {
        let bestSymbol: string | null = null;
        let bestGain = 0;
        for (const [symbol, coverage] of coverageBySymbol) {
          if (selected.includes(symbol)) continue;
          const gain = [...coverage].filter((mode) => uncovered.has(mode)).length;
          if (gain > bestGain) {
            bestSymbol = symbol;
            bestGain = gain;
          }
        }
        if (!bestSymbol || bestGain === 0) break;
        selected.push(bestSymbol);
        for (const mode of coverageBySymbol.get(bestSymbol) ?? []) uncovered.delete(mode);
      }

      const remaining = [...coverageBySymbol.entries()]
        .filter(([symbol]) => !selected.includes(symbol))
        .sort((a, b) => b[1].size - a[1].size)
        .map(([symbol]) => symbol);
      for (const symbol of remaining) {
        if (selected.length >= MarketDataCollector.MAX_STREAM_SYMBOLS) break;
        selected.push(symbol);
      }
      const candidates = selected;

      if (candidates.length === 0) {
        this.isDiscoveryComplete = true;
        this.DIGITDIFF_SUPPORTED_SYMBOLS = [];
        this.supportedSymbolsByMode = {};
        throw new Error('Deriv não retornou símbolos sintéticos compatíveis com as modalidades habilitadas; coleta não iniciada.');
      }
      this.DIGITDIFF_SUPPORTED_SYMBOLS = candidates;
      this.allDerivSymbols = new Map(allSymbols.map((entry: any) => [entry.symbol, entry]));
      this.lastSymbolsUpdate = Date.now();
      this.isDiscoveryComplete = true;
      const modeSummary = modes.map((mode) => `${mode}=${(availableByMode[mode] ?? []).length}`).join(', ');
      console.log(`[DISCOVERY] ${candidates.length} streams escolhidos por cobertura de modalidades: ${modeSummary}`);
      if (uncovered.size > 0) {
        console.warn(`[DISCOVERY] Modalidades sem cobertura nos ${candidates.length} streams limitados: ${[...uncovered].join(', ')}`);
      }
      return [...candidates];
    } catch (error) {
      console.error('[DISCOVERY] Não foi possível confirmar símbolos por modalidade:', error);
      throw error;
    }
  }

  /**
   * Iniciar coleta contínua de dados (modo "Fluxo Natural de Análises Cooperativas de Inteligência Artificial")
   */
  async startCollection(symbols?: string[]): Promise<void> {
    if (this.isCollecting && this.derivAPI.getIsConnected()) {
      console.log('🔄 [FNACIA] Coleta já está ativa e conectada');
      return;
    }

    let firstTickHandler: ((event: any) => void) | null = null;
    let firstTickTimer: NodeJS.Timeout | null = null;
    try {
      let supportedSymbols = (symbols && symbols.length > 0)
        ? symbols
        : await this.discoverAndLoadAllAssets();

      supportedSymbols = Array.from(new Set(supportedSymbols.map(s => String(s).trim().toUpperCase())))
        .filter(symbol => !MarketDataCollector.BLOCKED_SYMBOLS_PATTERN.test(symbol))
        .filter(symbol => isAllowedProductionSymbol(symbol))
        .slice(0, MarketDataCollector.MAX_STREAM_SYMBOLS);

      if (supportedSymbols.length === 0) {
        throw new Error('Nenhum símbolo elegível foi confirmado pela Deriv para as modalidades habilitadas; coleta bloqueada.');
      }
      this.DIGITDIFF_SUPPORTED_SYMBOLS = supportedSymbols;
      this.tickBuffers.clear();
      this.totalTicksReceived = 0;
      this.lastPersistenceSuccessAt = 0;
      this.persistenceFailures = 0;

      console.log(`🚀 [FNACIA] Iniciando coleta validada para ${supportedSymbols.length} ativos: ${supportedSymbols.join(', ')}`);

      // A "collecting" state is not considered ready until at least one real tick
      // has been received. This prevents the UI from reporting active with a dead socket.
      const firstTick = new Promise<void>((resolve, reject) => {
        firstTickHandler = (event: any) => {
          if (!supportedSymbols.includes(String(event?.symbol || '').toUpperCase())) return;
          if (firstTickTimer) clearTimeout(firstTickTimer);
          firstTickTimer = null;
          resolve();
        };
        this.on('tick_processed', firstTickHandler);
        firstTickTimer = setTimeout(() => {
          if (firstTickHandler) this.removeListener('tick_processed', firstTickHandler);
          firstTickHandler = null;
          reject(new Error(`No real Deriv tick received within 20s for allowlisted symbols: ${supportedSymbols.join(', ')}`));
        }, 20000);
      });

      await this.derivAPI.connectPublic('MARKET_DATA_COLLECTOR');
      for (const symbol of supportedSymbols) {
        await this.derivAPI.subscribeToTicks(symbol);
      }

      await firstTick;
      // Prove that the first real tick can be persisted through the same storage
      // path the analysis engine reads before acknowledging Play as ready.
      const firstSymbol = this.getCollectionStats().symbols
        .filter((entry) => Date.now() - entry.lastUpdate < 5000)
        .map((entry) => entry.symbol)[0];
      if (!firstSymbol) throw new Error('First Deriv tick was received but no active symbol buffer was created.');
      await this.saveBufferedData();
      const persisted = await storage.getMarketData(firstSymbol);
      const persistedAt = persisted?.lastUpdate ? new Date(persisted.lastUpdate).getTime() : 0;
      if (!persisted || !persistedAt || Date.now() - persistedAt > 30000 || this.lastPersistenceSuccessAt === 0) {
        throw new Error(`First real tick for ${firstSymbol} was not confirmed in persistent market storage.`);
      }
      if (firstTickHandler) this.removeListener('tick_processed', firstTickHandler);
      if (firstTickTimer) clearTimeout(firstTickTimer);
      firstTickHandler = null;
      firstTickTimer = null;

      this.isCollecting = true;
      console.log(`✅ [FNACIA] Coleta validada: recebeu tick real; ativos=${supportedSymbols.length}; totalTicks=${this.getCollectionStats().totalTicks}`);
      console.log(`🛡️ [FNACIA] Limite de segurança: máximo ${MarketDataCollector.MAX_STREAM_SYMBOLS} streams`);
    } catch (error) {
      if (firstTickHandler) this.removeListener('tick_processed', firstTickHandler);
      if (firstTickTimer) clearTimeout(firstTickTimer);
      this.isCollecting = false;
      try { await this.derivAPI.disconnect(); } catch {}
      this.tickBuffers.clear();
      console.error('❌ [FNACIA] Coleta não ficou pronta; ativação deve falhar em vez de reportar falso positivo:', error);
      throw error;
    }
  }

  /**
   * Obter informações sobre um ativo específico
   */
  getAssetInfo(symbol: string): any {
    return this.allDerivSymbols.get(symbol) || null;
  }

  /**
   * Obter todos os ativos descobertos
   */
  getAllAssets(): any[] {
    return Array.from(this.allDerivSymbols.values());
  }

  /**
   * Obter estatísticas de descoberta
   */
  getDiscoveryStats(): {
    totalSymbols: number;
    digitDiffSupported: number;
    lastUpdate: number;
    timeAgoSeconds: number;
  } {
    return {
      totalSymbols: this.allDerivSymbols.size,
      digitDiffSupported: this.DIGITDIFF_SUPPORTED_SYMBOLS.length,
      lastUpdate: this.lastSymbolsUpdate,
      timeAgoSeconds: Math.floor((Date.now() - this.lastSymbolsUpdate) / 1000)
    };
  }

  /**
   * Parar coleta de dados
   */
  async stopCollection(): Promise<void> {
    if (!this.isCollecting) return;

    console.log('🛑 [FNACIA] Parando coleta de dados...');
    
    // Salvar dados pendentes
    await this.saveBufferedData();
    
    // Desconectar da Deriv
    await this.derivAPI.disconnect();
    
    // Nota: Não paramos o singleton microscópico aqui pois pode estar sendo usado por outros sistemas
    
    // Limpar buffers
    this.tickBuffers.clear();
    this.totalTicksReceived = 0;
    
    this.isCollecting = false;
    console.log('✅ [FNACIA] Coleta parada');
  }

  /**
   * Obter estatísticas da coleta
   */
  getCollectionStats(): {
    isCollecting: boolean;
    activeSymbols: number;
    totalTicks: number;
    symbols: { symbol: string; ticks: number; lastUpdate: number }[];
    persistenceReady: boolean;
    lastPersistenceSuccessAt: number;
    persistenceFailures: number;
  } {
    const symbols = Array.from(this.tickBuffers.entries()).map((entry) => {
      const [symbol, buffer] = entry;
      return ({
      symbol,
      ticks: buffer.ticks.length,
      lastUpdate: buffer.lastUpdate
      });
    });

    return {
      isCollecting: this.isCollecting,
      activeSymbols: this.tickBuffers.size,
      totalTicks: this.totalTicksReceived,
      symbols,
      persistenceReady: this.lastPersistenceSuccessAt > 0 && Date.now() - this.lastPersistenceSuccessAt < 60000,
      lastPersistenceSuccessAt: this.lastPersistenceSuccessAt,
      persistenceFailures: this.persistenceFailures
    };
  }

  /**
   * Retorna os últimos N ticks armazenados no buffer para um símbolo
   * Usado pelo contract-monitor para análise de saída com o Motor Supremo
   */
  getBufferedTicks(symbol: string, limit: number = 100): DerivTickData[] {
    const buffer = this.tickBuffers.get(symbol);
    if (!buffer || buffer.ticks.length === 0) return [];
    return buffer.ticks.slice(-Math.min(limit, buffer.ticks.length));
  }

  /**
   * Destruir o coletor
   */
  async destroy(): Promise<void> {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    await this.stopCollection();
    this.removeAllListeners();
  }
}

// Singleton instance
export const marketDataCollector = new MarketDataCollector();