import { EventEmitter } from 'events';
import { DerivAPIService, DerivTickData } from './deriv-api.js';
import { storage } from '../storage.js';
import { microscopicAnalyzer } from './microscopic-technical-analysis.js';

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
  private isCollecting = false;
  
  // 🎯 SÍMBOLOS QUE SUPORTAM DIGITDIFF - Economia de RAM e processamento das IAs
  private readonly DIGITDIFF_SUPPORTED_SYMBOLS = [
    'R_10', 'R_25', 'R_50', 'R_75', 'R_100',  // Volatility indices
    // BOOM e CRASH não suportam DIGITDIFF
    // stpRNG não suporta DIGITDIFF
    // 1HZ não suporta DIGITDIFF
    // JD não suporta DIGITDIFF
  ];
  
  // Configurações do "Fluxo Natural de Análises Cooperativas de Inteligência Artificial" - análise microscópica contínua
  private readonly BUFFER_SIZE = 500; // Manter últimos 500 ticks por símbolo
  private readonly SAVE_INTERVAL_MS = 250; // Salvar a cada 250ms (otimizado)
  private readonly MAX_PRICE_HISTORY = 1000; // Histórico máximo por símbolo
  
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

    // Salvar dados periodicamente (análise microscópica contínua)
    this.saveInterval = setInterval(() => {
      this.saveBufferedData();
    }, this.SAVE_INTERVAL_MS);
  }

  /**
   * Configurar análise técnica microscópica em milissegundos
   */
  private setupMicroscopicAnalysis(): void {
    // Escutar análises microscópicas do singleton
    microscopicAnalyzer.on('analysis', (analysis) => {
      console.log(`🔬 [MICROSCOPIC] ${analysis.symbol}: ${analysis.cooperativeSignal.technicalDirection} (${analysis.cooperativeSignal.confidence.toFixed(1)}%)`);
    });
    
    console.log('🔬 [FNACIA] Sistema microscópico integrado - análises técnicas em milissegundos via singleton');
  }

  /**
   * Obter lista de símbolos que suportam DIGITDIFF
   */
  getSupportedSymbols(): string[] {
    return [...this.DIGITDIFF_SUPPORTED_SYMBOLS];
  }

  /**
   * Processar tick recebido da Deriv - operação do "Fluxo Natural de Análises Cooperativas de Inteligência Artificial"
   */
  private processTick(tickData: DerivTickData): void {
    const { symbol } = tickData;
    
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

    // Log apenas amostral para não sobrecarregar
    if (buffer.ticks.length % 10 === 0) {
      console.log(`📊 [FNACIA] Ticks: ${symbol} @ ${tickData.quote} (${buffer.ticks.length})`);    }
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

      console.log(`💾 [FNACIA] Dados salvos: ${symbol} (${buffer.ticks.length} ticks, ${priceHistory.length} histórico)`);

      // Limpar buffer após salvar
      buffer.ticks = [];

    } catch (error) {
      console.error(`❌ [FNACIA] Erro ao salvar ${symbol}:`, error);
    }
  }

  /**
   * Iniciar coleta contínua de dados (modo "Fluxo Natural de Análises Cooperativas de Inteligência Artificial")
   */
  async startCollection(symbols: string[]): Promise<void> {
    if (this.isCollecting) {
      console.log('🔄 [FNACIA] Coleta já está ativa');
      return;
    }

    try {
      // 🎯 FILTRAR: Apenas símbolos que suportam DIGITDIFF (economia de RAM e processamento)
      const supportedSymbols = symbols.filter(s => this.DIGITDIFF_SUPPORTED_SYMBOLS.includes(s));
      const blockedSymbols = symbols.filter(s => !this.DIGITDIFF_SUPPORTED_SYMBOLS.includes(s));
      
      if (blockedSymbols.length > 0) {
        console.log(`🚫 [FNACIA] Símbolos bloqueados (não suportam DIGITDIFF): ${blockedSymbols.length} símbolos`);
        console.log(`🎯 [FNACIA] Economia: ${blockedSymbols.length} símbolos removidos = mais RAM e processamento das IAs disponível`);
      }
      
      if (supportedSymbols.length === 0) {
        console.log('⚠️ [FNACIA] Nenhum símbolo suportado para DIGITDIFF');
        return;
      }
      
      console.log(`🚀 [FNACIA] Iniciando coleta APENAS para ${supportedSymbols.length} símbolos DIGITDIFF...`);
      
      // Conectar à Deriv (público, sem autenticação)
      await this.derivAPI.connectPublic();
      
      // Inscrever-se APENAS nos símbolos suportados
      for (const symbol of supportedSymbols) {
        await this.derivAPI.subscribeToTicks(symbol);
        console.log(`📈 [FNACIA] Inscrito em ${symbol} ✅`);
      }

      this.isCollecting = true;
      console.log(`✅ [FNACIA] Coleta ativa para ${supportedSymbols.length} símbolos DIGITDIFF`);
      console.log(`💰 [FNACIA] Economia de recursos: ${blockedSymbols.length} símbolos não analisados`);
      
    } catch (error) {
      console.error('❌ [FNACIA] Erro ao iniciar coleta:', error);
      throw error;
    }
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
      totalTicks: symbols.reduce((total, s) => total + s.ticks, 0),
      symbols
    };
  }

  /**
   * Destruir o coletor
   */
  async destroy(): Promise<void> {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }
    
    await this.stopCollection();
    this.removeAllListeners();
  }
}

// Singleton instance
export const marketDataCollector = new MarketDataCollector();