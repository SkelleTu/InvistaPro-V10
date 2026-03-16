/**
 * METATRADER BRIDGE SERVICE - INVESTAPRO
 * Ponte entre o sistema de IAs e o MetaTrader 4/5
 * Gerencia sinais de trading, posições abertas e resultados
 * 
 * INTEGRAÇÃO REAL COM IAs: usa HuggingFaceAI + análise técnica avançada.
 * Limiar mínimo de consenso: 70% — sem sinal aleatório.
 */

import { EventEmitter } from 'events';
import { huggingFaceAI } from './huggingface-ai';
import { DerivTickData } from './deriv-api';

export interface MT5Signal {
  id: string;
  symbol: string;
  action: 'BUY' | 'SELL' | 'CLOSE_BUY' | 'CLOSE_SELL' | 'HOLD';
  lotSize: number;
  stopLoss: number;
  takeProfit: number;
  stopLossPips: number;
  takeProfitPips: number;
  entryPrice?: number;
  confidence: number;
  aiSources: string[];
  indicators: MT5Indicators;
  timestamp: number;
  expiresAt: number;
  reason: string;
}

export interface MT5Indicators {
  rsi: number;
  macd: number;
  macdSignal: number;
  ema20: number;
  ema50: number;
  ema200: number;
  bollingerUpper: number;
  bollingerLower: number;
  bollingerMid: number;
  atr: number;
  adx: number;
  stochK: number;
  stochD: number;
  volumeTrend: 'rising' | 'falling' | 'neutral';
  trend: 'bullish' | 'bearish' | 'sideways';
  momentum: number;
  volatility: number;
  support: number;
  resistance: number;
}

export interface MT5Position {
  ticket: number;
  symbol: string;
  type: 'BUY' | 'SELL';
  lots: number;
  openPrice: number;
  currentPrice: number;
  stopLoss: number;
  takeProfit: number;
  profit: number;
  openTime: number;
  signalId: string;
}

export interface MT5TradeResult {
  ticket: number;
  signalId: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  lots: number;
  openPrice: number;
  closePrice: number;
  profit: number;
  pips: number;
  openTime: number;
  closeTime: number;
  closeReason: 'TP' | 'SL' | 'MANUAL' | 'AI_SIGNAL' | 'TIMEOUT';
}

export interface MT5Config {
  enabled: boolean;
  accountId: string;
  broker: string;
  server: string;
  symbols: string[];
  defaultLotSize: number;
  maxLotSize: number;
  maxOpenPositions: number;
  maxDailyLoss: number;
  maxDailyProfit: number;
  stopLossPips: number;
  takeProfitPips: number;
  useAIStopLoss: boolean;
  useTrailingStop: boolean;
  trailingStopPips: number;
  signalTimeoutSeconds: number;
  pollingIntervalMs: number;
  enabledAIs: string[];
  riskPercent: number;
  apiToken: string;
}

export interface MT5Status {
  connected: boolean;
  accountId: string;
  broker: string;
  lastHeartbeat: number;
  totalSignalsGenerated: number;
  totalTradesExecuted: number;
  openPositions: number;
  dailyProfit: number;
  dailyLoss: number;
  dailyWins: number;
  dailyLosses: number;
  winRate: number;
  activeSignal: MT5Signal | null;
  recentTrades: MT5TradeResult[];
  systemHealth: 'excellent' | 'good' | 'warning' | 'critical';
}

const DEFAULT_CONFIG: MT5Config = {
  enabled: false,
  accountId: '',
  broker: '',
  server: '',
  symbols: ['EURUSD', 'GBPUSD', 'XAUUSD', 'USDJPY', 'BTCUSD'],
  defaultLotSize: 0.01,
  maxLotSize: 1.0,
  maxOpenPositions: 5,
  maxDailyLoss: 100,
  maxDailyProfit: 500,
  stopLossPips: 30,
  takeProfitPips: 60,
  useAIStopLoss: true,
  useTrailingStop: false,
  trailingStopPips: 15,
  signalTimeoutSeconds: 60,
  pollingIntervalMs: 5000,
  enabledAIs: ['quantum', 'advanced', 'microscopic', 'huggingface', 'supreme'],
  riskPercent: 1,
  apiToken: ''
};

export interface ConnectionEvent {
  timestamp: number;
  type: 'heartbeat_ok' | 'heartbeat_fail' | 'connected' | 'disconnected' | 'signal_fail' | 'signal_ok' | 'reconnect_attempt' | 'data_sent';
  code?: number;
  message: string;
  source?: string;
  latencyMs?: number;
}

export interface ConnectionDiagnostics {
  serverUrl: string;
  discoveryUrl: string | null;
  totalHeartbeats: number;
  failedHeartbeats: number;
  totalSignalRequests: number;
  failedSignalRequests: number;
  lastSuccessAt: number;
  lastFailAt: number;
  consecutiveFails: number;
  uptimePercent: number;
  avgLatencyMs: number;
  events: ConnectionEvent[];
}

export interface AIModelResult {
  model: string;
  prediction: 'up' | 'down' | 'neutral';
  confidence: number;
  reasoning: string;
}

export interface AIAnalysisEntry {
  id: string;
  timestamp: number;
  symbol: string;
  phase: 'circuit_breaker' | 'data_check' | 'huggingface' | 'technical' | 'decision';
  status: 'processing' | 'approved' | 'rejected' | 'waiting' | 'blocked';
  // HuggingFace AI
  aiConsensus?: number;
  aiDirection?: 'up' | 'down' | 'neutral';
  aiReasoning?: string;
  modelResults?: AIModelResult[];
  participatingModels?: number;
  // Technical analysis
  technicalAction?: 'BUY' | 'SELL' | 'HOLD';
  technicalAgrees?: boolean;
  technicalScore?: number;
  indicators?: MT5Indicators;
  // Decision
  finalDecision?: 'BUY' | 'SELL' | 'HOLD' | null;
  decisionReason: string;
  // Safety state
  circuitBreakerActive?: boolean;
  consecutiveLosses?: number;
  circuitBreakerRemainingMin?: number;
  candlesAvailable?: number;
}

class MetaTraderBridge extends EventEmitter {
  private config: MT5Config = { ...DEFAULT_CONFIG };
  private status: MT5Status;
  private pendingSignals: Map<string, MT5Signal> = new Map();
  private openPositions: Map<number, MT5Position> = new Map();
  private recentTrades: MT5TradeResult[] = [];
  private signalGenerationInterval: NodeJS.Timeout | null = null;
  private marketDataCache: Map<string, any[]> = new Map();
  private isGeneratingSignal = false;

  // Log de análises em tempo real
  private analysisLog: AIAnalysisEntry[] = [];
  private readonly MAX_ANALYSIS_LOG = 100;

  // Rastreamento de perdas consecutivas — circuit breaker
  private consecutiveLosses = 0;
  private circuitBreakerUntil = 0;
  private readonly MAX_CONSECUTIVE_LOSSES = 3;
  private readonly CIRCUIT_BREAKER_MS = 15 * 60 * 1000; // 15 min de pausa
  private readonly MIN_AI_CONSENSUS = 70; // 70% mínimo de consenso da IA

  private diagnostics: ConnectionDiagnostics = {
    serverUrl: '',
    discoveryUrl: null,
    totalHeartbeats: 0,
    failedHeartbeats: 0,
    totalSignalRequests: 0,
    failedSignalRequests: 0,
    lastSuccessAt: 0,
    lastFailAt: 0,
    consecutiveFails: 0,
    uptimePercent: 100,
    avgLatencyMs: 0,
    events: []
  };

  private latencyHistory: number[] = [];

  constructor() {
    super();
    this.status = this.initStatus();
  }

  private initStatus(): MT5Status {
    return {
      connected: false,
      accountId: '',
      broker: '',
      lastHeartbeat: 0,
      totalSignalsGenerated: 0,
      totalTradesExecuted: 0,
      openPositions: 0,
      dailyProfit: 0,
      dailyLoss: 0,
      dailyWins: 0,
      dailyLosses: 0,
      winRate: 0,
      activeSignal: null,
      recentTrades: [],
      systemHealth: 'good'
    };
  }

  private logAnalysis(entry: AIAnalysisEntry): void {
    this.analysisLog.unshift(entry);
    if (this.analysisLog.length > this.MAX_ANALYSIS_LOG) {
      this.analysisLog.pop();
    }
    this.emit('analysis', entry);
  }

  getAnalysisLog(): AIAnalysisEntry[] {
    return this.analysisLog.slice(0, 50);
  }

  getLatestAnalysis(): AIAnalysisEntry | null {
    return this.analysisLog[0] || null;
  }

  getConfig(): MT5Config {
    return { ...this.config };
  }

  updateConfig(newConfig: Partial<MT5Config>): void {
    this.config = { ...this.config, ...newConfig };
    if (this.config.enabled && !this.signalGenerationInterval) {
      this.startSignalGeneration();
    } else if (!this.config.enabled && this.signalGenerationInterval) {
      this.stopSignalGeneration();
    }
  }

  /**
   * Crash e Boom têm spikes que pulam qualquer stop — operar sem SL/TP.
   * Retorna true se o símbolo for um índice de spike.
   */
  private isSpikeIndex(symbol: string): boolean {
    const sym = symbol.toUpperCase();
    return sym.includes('CRASH') || sym.includes('BOOM');
  }

  /**
   * Retorna o lote mínimo correto para cada tipo de símbolo.
   * Índices sintéticos da Deriv (Crash/Boom) exigem lote mínimo de 1.0.
   * Índices de Volatilidade aceitam 0.01. Forex aceita 0.01.
   */
  private getValidLotSize(symbol: string): number {
    const sym = symbol.toUpperCase();

    // Crash Index (Crash 1000, Crash 500, Crash 300) — mínimo 1.0
    if (sym.includes('CRASH')) return Math.max(this.config.defaultLotSize, 1.0);

    // Boom Index (Boom 1000, Boom 500, Boom 300) — mínimo 1.0
    if (sym.includes('BOOM')) return Math.max(this.config.defaultLotSize, 1.0);

    // Step Index — mínimo 0.10
    if (sym.includes('STEP')) return Math.max(this.config.defaultLotSize, 0.10);

    // Jump Indices — mínimo 0.01
    if (sym.includes('JUMP')) return Math.max(this.config.defaultLotSize, 0.01);

    // Volatility Indices (R_10, R_25, R_50, R_75, R_100, 1HZ10V etc.) — mínimo 0.01
    if (sym.match(/^(R_|1HZ|V)\d/) || sym.includes('VOLATILITY')) {
      return Math.max(this.config.defaultLotSize, 0.01);
    }

    // Range Break — mínimo 0.10
    if (sym.includes('RANGE') || sym.includes('RDBEAR') || sym.includes('RDBULL')) {
      return Math.max(this.config.defaultLotSize, 0.10);
    }

    // Padrão (Forex, Metais, Crypto) — usa configuração
    return this.config.defaultLotSize;
  }

  getStatus(): MT5Status {
    const now = Date.now();
    const connected = (now - this.status.lastHeartbeat) < 120000 && this.status.lastHeartbeat > 0;

    let health: MT5Status['systemHealth'] = 'excellent';
    if (!connected) {
      if (this.status.lastHeartbeat === 0) {
        health = 'warning';
      } else {
        const secsSince = Math.floor((now - this.status.lastHeartbeat) / 1000);
        health = secsSince > 300 ? 'critical' : 'warning';
      }
    } else if (this.status.dailyLoss > this.config.maxDailyLoss * 0.8) {
      health = 'critical';
    } else if (this.status.dailyLoss > this.config.maxDailyLoss * 0.5) {
      health = 'warning';
    }

    return {
      ...this.status,
      connected,
      systemHealth: health,
      activeSignal: this.getLatestActiveSignal(),
      recentTrades: this.recentTrades.slice(-20),
      openPositions: this.openPositions.size
    };
  }

  recordHeartbeat(accountData: { accountId: string; broker: string; balance: number; equity: number; freeMargin: number }): void {
    this.status.lastHeartbeat = Date.now();
    this.status.accountId = accountData.accountId;
    this.status.broker = accountData.broker;
    if (!this.config.enabled) {
      this.config.enabled = true;
      this.startSignalGeneration();
      console.log(`[MT5Bridge] ✅ Sistema auto-habilitado via heartbeat do EA (${accountData.broker})`);
    }
  }

  async generateSignal(symbol: string): Promise<MT5Signal | null> {
    if (this.isGeneratingSignal) return null;
    if (!this.config.enabled) return null;

    const entryId = `analysis_${Date.now()}_${symbol}`;

    // Circuit breaker
    if (Date.now() < this.circuitBreakerUntil) {
      const remaining = Math.ceil((this.circuitBreakerUntil - Date.now()) / 60000);
      this.logAnalysis({
        id: entryId,
        timestamp: Date.now(),
        symbol,
        phase: 'circuit_breaker',
        status: 'blocked',
        circuitBreakerActive: true,
        consecutiveLosses: this.consecutiveLosses,
        circuitBreakerRemainingMin: remaining,
        decisionReason: `Circuit Breaker ativo: ${this.consecutiveLosses} perdas consecutivas. Aguardando ${remaining} min.`
      });
      console.log(`[MT5Bridge] ⛔ Circuit Breaker ativo — aguardando ${remaining} min após ${this.consecutiveLosses} perdas consecutivas`);
      return null;
    }

    this.isGeneratingSignal = true;
    try {
      const marketData = this.getMarketDataForSymbol(symbol);

      // Dados insuficientes
      if (marketData.length < 15) {
        this.logAnalysis({
          id: entryId,
          timestamp: Date.now(),
          symbol,
          phase: 'data_check',
          status: 'waiting',
          candlesAvailable: marketData.length,
          consecutiveLosses: this.consecutiveLosses,
          decisionReason: `Dados insuficientes: apenas ${marketData.length} candles disponíveis (mínimo: 15). Aguardando mais dados do EA.`
        });
        console.log(`[MT5Bridge] ⏳ Dados insuficientes para ${symbol} (${marketData.length} candles) — aguardando`);
        return null;
      }

      // Log fase de dados OK
      this.logAnalysis({
        id: `${entryId}_data`,
        timestamp: Date.now(),
        symbol,
        phase: 'data_check',
        status: 'processing',
        candlesAvailable: marketData.length,
        decisionReason: `${marketData.length} candles recebidos. Iniciando análise das IAs...`
      });

      // Converter candles do MT5 para formato DerivTickData
      const tickData: DerivTickData[] = marketData.map((candle, i) => ({
        symbol,
        quote: candle.close,
        epoch: candle.time ? Math.floor(candle.time) : Math.floor(Date.now() / 1000) - (marketData.length - i) * 60,
      }));

      // ============================================================
      // ANÁLISE REAL: HuggingFace AI (FinBERT + RoBERTa + modelos)
      // ============================================================
      let aiConsensus: number = 0;
      let aiDirection: 'up' | 'down' | 'neutral' = 'neutral';
      let aiReasoning = '';
      let modelResults: AIModelResult[] = [];
      let participatingModels = 0;

      try {
        const consensus = await huggingFaceAI.analyzeMarketData(tickData, symbol);
        aiConsensus = consensus.consensusStrength;
        aiDirection = consensus.finalDecision;
        aiReasoning = consensus.reasoning;
        participatingModels = consensus.participatingModels || 0;

        // Capturar resultados por modelo
        if (consensus.analyses && Array.isArray(consensus.analyses)) {
          modelResults = consensus.analyses.map((a: any) => ({
            model: a.modelName || 'Modelo IA',
            prediction: a.prediction as 'up' | 'down' | 'neutral',
            confidence: Math.round(a.confidence || 0),
            reasoning: a.reasoning || ''
          }));
        }

        this.logAnalysis({
          id: `${entryId}_hf`,
          timestamp: Date.now(),
          symbol,
          phase: 'huggingface',
          status: aiConsensus >= this.MIN_AI_CONSENSUS && aiDirection !== 'neutral' ? 'processing' : 'rejected',
          aiConsensus,
          aiDirection,
          aiReasoning,
          modelResults,
          participatingModels,
          decisionReason: aiConsensus < this.MIN_AI_CONSENSUS
            ? `Consenso insuficiente: ${aiConsensus.toFixed(1)}% < ${this.MIN_AI_CONSENSUS}% mínimo exigido`
            : aiDirection === 'neutral'
              ? `Mercado neutro — IAs não identificaram direção clara (${participatingModels} modelos)`
              : `Consenso aprovado: ${aiConsensus.toFixed(1)}% → ${aiDirection.toUpperCase()} | ${participatingModels} modelos participaram`
        });

        console.log(`[MT5Bridge] 🧠 IA HuggingFace: ${aiDirection.toUpperCase()} | Consenso: ${aiConsensus.toFixed(1)}% | ${symbol}`);
      } catch (aiErr) {
        this.logAnalysis({
          id: `${entryId}_hf_err`,
          timestamp: Date.now(),
          symbol,
          phase: 'huggingface',
          status: 'rejected',
          decisionReason: `Erro nas IAs HuggingFace: ${aiErr instanceof Error ? aiErr.message : String(aiErr)}. Sem sinal por segurança.`
        });
        console.warn(`[MT5Bridge] ⚠️ Falha na IA HuggingFace para ${symbol}:`, aiErr);
        return null;
      }

      if (aiConsensus < this.MIN_AI_CONSENSUS || aiDirection === 'neutral') {
        return null;
      }

      // ============================================================
      // VALIDAÇÃO TÉCNICA
      // ============================================================
      const technicalSignal = this.runTechnicalAnalysis(symbol, marketData);
      const technicalAgrees =
        (aiDirection === 'up' && technicalSignal.action === 'BUY') ||
        (aiDirection === 'down' && technicalSignal.action === 'SELL');

      // Build indicators for the log
      const prices = marketData.map((d: any) => d.close);
      const indicators = this.buildIndicators(prices, marketData);

      this.logAnalysis({
        id: `${entryId}_tech`,
        timestamp: Date.now(),
        symbol,
        phase: 'technical',
        status: (!technicalAgrees && aiConsensus < 80) ? 'rejected' : 'processing',
        technicalAction: technicalSignal.action as 'BUY' | 'SELL' | 'HOLD',
        technicalAgrees,
        technicalScore: Math.round(technicalSignal.confidence * 100),
        indicators,
        aiConsensus,
        aiDirection,
        decisionReason: !technicalAgrees && aiConsensus < 80
          ? `Divergência: IA diz ${aiDirection.toUpperCase()} mas análise técnica diz ${technicalSignal.action}. Consenso ${aiConsensus.toFixed(1)}% < 80% — sem trade`
          : technicalAgrees
            ? `Confirmação técnica: RSI=${indicators.rsi.toFixed(1)} | EMA20 ${indicators.ema20 > indicators.ema50 ? '>' : '<'} EMA50 | Tendência: ${indicators.trend} | ADX=${indicators.adx.toFixed(1)}`
            : `Alta confiança (${aiConsensus.toFixed(1)}% ≥ 80%) — override da análise técnica divergente`
      });

      if (!technicalAgrees && aiConsensus < 80) {
        return null;
      }

      // Decisão final
      const action: MT5Signal['action'] = aiDirection === 'up' ? 'BUY' : 'SELL';
      const finalConfidence = aiConsensus / 100;

      const signals = [
        { action, confidence: finalConfidence, source: 'huggingface_ai' },
        { action: technicalSignal.action, confidence: technicalSignal.confidence, source: 'technical' }
      ];

      const signal = this.fuseSignals(symbol, signals, marketData, aiReasoning, finalConfidence);

      // Log decisão final
      this.logAnalysis({
        id: `${entryId}_decision`,
        timestamp: Date.now(),
        symbol,
        phase: 'decision',
        status: signal.action !== 'HOLD' ? 'approved' : 'rejected',
        finalDecision: signal.action as 'BUY' | 'SELL' | 'HOLD',
        aiConsensus,
        aiDirection,
        technicalAction: technicalSignal.action as 'BUY' | 'SELL' | 'HOLD',
        technicalAgrees,
        indicators,
        modelResults,
        participatingModels,
        consecutiveLosses: this.consecutiveLosses,
        decisionReason: signal.action !== 'HOLD'
          ? `✅ SINAL APROVADO: ${signal.action} ${symbol} | Consenso IA: ${aiConsensus.toFixed(1)}% | Técnico: ${technicalSignal.action} | ${signal.reason}`
          : `❌ Sinal bloqueado na fusão final`
      });

      return signal;
    } catch (err) {
      console.error('[MT5Bridge] Erro ao gerar sinal:', err);
      return null;
    } finally {
      this.isGeneratingSignal = false;
    }
  }

  private runTechnicalAnalysis(symbol: string, marketData: any[]): { action: string; confidence: number; source: string } {
    const prices = marketData.map(d => d.close);
    const highs = marketData.map(d => d.high || d.close);
    const lows = marketData.map(d => d.low || d.close);

    const rsi = this.calcRSI(prices, 14);
    const ema20 = this.calcEMA(prices, 20);
    const ema50 = this.calcEMA(prices, 50);
    const macd = this.calcMACD(prices);

    let score = 0;
    if (rsi < 30) score += 2;
    else if (rsi > 70) score -= 2;
    else if (rsi < 45) score += 1;
    else if (rsi > 55) score -= 1;

    if (ema20 > ema50) score += 1;
    else score -= 1;

    if (macd.macd > macd.signal) score += 1;
    else score -= 1;

    const action = score > 0 ? 'BUY' : score < 0 ? 'SELL' : 'HOLD';
    const confidence = 0.4 + Math.abs(score) * 0.1;

    return { action, confidence: Math.min(confidence, 0.9), source: 'technical' };
  }

  private fuseSignals(
    symbol: string,
    signals: Array<{ action: string; confidence: number; source: string }>,
    marketData: any[],
    aiReasoning?: string,
    overrideConfidence?: number
  ): MT5Signal {
    const buyScore = signals.filter(s => s.action === 'BUY').reduce((a, s) => a + s.confidence, 0);
    const sellScore = signals.filter(s => s.action === 'SELL').reduce((a, s) => a + s.confidence, 0);
    const holdScore = signals.filter(s => s.action === 'HOLD').reduce((a, s) => a + s.confidence, 0);

    let action: MT5Signal['action'] = 'HOLD';
    let finalConfidence = overrideConfidence ?? 0.5;

    const total = buyScore + sellScore + holdScore || 1;
    if (buyScore > sellScore && buyScore / total > 0.4) {
      action = 'BUY';
      if (!overrideConfidence) finalConfidence = buyScore / total;
    } else if (sellScore > buyScore && sellScore / total > 0.4) {
      action = 'SELL';
      if (!overrideConfidence) finalConfidence = sellScore / total;
    } else {
      action = 'HOLD';
      if (!overrideConfidence) finalConfidence = holdScore / total;
    }

    const prices = marketData.map(d => d.close);
    const indicators = this.buildIndicators(prices, marketData);
    const lastPrice = prices[prices.length - 1];
    const atr = indicators.atr || lastPrice * 0.001;

    const isForex = lastPrice < 1000;
    const pipSize = isForex ? 0.0001 : 1;
    const rawSlPips = this.config.useAIStopLoss ? Math.round(atr * 1.5 / pipSize) : this.config.stopLossPips;
    const rawTpPips = this.config.useAIStopLoss ? Math.round(atr * 3.0 / pipSize) : this.config.takeProfitPips;
    const slPips = Math.max(rawSlPips, 1);
    const tpPips = Math.max(rawTpPips, 1);

    const spike = this.isSpikeIndex(symbol);
    const signal: MT5Signal = {
      id: `MT5_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      symbol,
      action,
      lotSize: this.getValidLotSize(symbol),
      stopLoss: spike ? 0 : (action === 'BUY' ? lastPrice - slPips * pipSize : lastPrice + slPips * pipSize),
      takeProfit: spike ? 0 : (action === 'BUY' ? lastPrice + tpPips * pipSize : lastPrice - tpPips * pipSize),
      stopLossPips: spike ? 0 : slPips,
      takeProfitPips: spike ? 0 : tpPips,
      entryPrice: lastPrice,
      confidence: finalConfidence,
      aiSources: signals.map(s => s.source),
      indicators,
      timestamp: Date.now(),
      expiresAt: Date.now() + this.config.signalTimeoutSeconds * 1000,
      reason: this.buildReason(action, signals, indicators, aiReasoning)
    };

    if (action !== 'HOLD') {
      this.pendingSignals.set(signal.id, signal);
      this.status.totalSignalsGenerated++;
      this.status.activeSignal = signal;
      this.emit('signal', signal);
      console.log(`[MT5Bridge] ✅ Sinal aprovado pela IA: ${action} ${symbol} | Consenso: ${(finalConfidence * 100).toFixed(1)}%`);
    }

    return signal;
  }

  private buildReason(action: string, signals: Array<{ action: string; confidence: number; source: string }>, indicators: MT5Indicators, aiReasoning?: string): string {
    const parts: string[] = [];

    // Razão principal: IA
    if (aiReasoning) {
      parts.push(`IA: ${aiReasoning.slice(0, 120)}`);
    }

    if (action === 'BUY') {
      if (indicators.rsi < 40) parts.push(`RSI sobrevendido (${indicators.rsi.toFixed(1)})`);
      if (indicators.ema20 > indicators.ema50) parts.push('EMA20 > EMA50');
      if (indicators.macd > indicators.macdSignal) parts.push('MACD bullish');
      if (indicators.trend === 'bullish') parts.push('Tendência alta confirmada');
    } else if (action === 'SELL') {
      if (indicators.rsi > 60) parts.push(`RSI sobrecomprado (${indicators.rsi.toFixed(1)})`);
      if (indicators.ema20 < indicators.ema50) parts.push('EMA20 < EMA50');
      if (indicators.macd < indicators.macdSignal) parts.push('MACD bearish');
      if (indicators.trend === 'bearish') parts.push('Tendência baixa confirmada');
    }
    const aiCount = signals.filter(s => s.action === action).length;
    parts.push(`${aiCount}/${signals.length} módulos em consenso`);
    return parts.join(' | ') || `IA indica ${action}`;
  }

  private buildIndicators(prices: number[], marketData: any[]): MT5Indicators {
    const highs = marketData.map(d => d.high || d.close * 1.001);
    const lows = marketData.map(d => d.low || d.close * 0.999);
    const last = prices[prices.length - 1];

    const rsi = this.calcRSI(prices, 14);
    const ema20 = this.calcEMA(prices, 20);
    const ema50 = this.calcEMA(prices, 50);
    const ema200 = this.calcEMA(prices, Math.min(200, prices.length - 1));
    const macdData = this.calcMACD(prices);
    const bb = this.calcBollinger(prices, 20, 2);
    const atr = this.calcATR(highs, lows, prices, 14);
    const adx = this.calcADX(highs, lows, prices, 14);
    const stoch = this.calcStochastic(highs, lows, prices, 14, 3);

    const support = Math.min(...lows.slice(-20));
    const resistance = Math.max(...highs.slice(-20));

    const trend = ema20 > ema50 && ema50 > ema200 ? 'bullish' :
      ema20 < ema50 && ema50 < ema200 ? 'bearish' : 'sideways';

    return {
      rsi,
      macd: macdData.macd,
      macdSignal: macdData.signal,
      ema20,
      ema50,
      ema200,
      bollingerUpper: bb.upper,
      bollingerLower: bb.lower,
      bollingerMid: bb.mid,
      atr,
      adx,
      stochK: stoch.k,
      stochD: stoch.d,
      volumeTrend: 'neutral',
      trend,
      momentum: macdData.macd - macdData.signal,
      volatility: atr / last * 100,
      support,
      resistance
    };
  }

  getPendingSignal(symbol?: string): MT5Signal | null {
    const now = Date.now();
    for (const [id, signal] of this.pendingSignals) {
      if (signal.expiresAt < now) {
        this.pendingSignals.delete(id);
        continue;
      }
      if (!symbol || signal.symbol === symbol) {
        return signal;
      }
    }
    return null;
  }

  getLatestActiveSignal(): MT5Signal | null {
    return this.getPendingSignal();
  }

  confirmTradeOpen(position: MT5Position): void {
    this.openPositions.set(position.ticket, position);
    this.status.totalTradesExecuted++;
    if (this.pendingSignals.has(position.signalId)) {
      this.pendingSignals.delete(position.signalId);
    }
    this.emit('trade_opened', position);
    console.log(`[MT5Bridge] 📈 Posição aberta: #${position.ticket} ${position.type} ${position.symbol} @ ${position.openPrice}`);
  }

  updatePosition(ticket: number, update: Partial<MT5Position>): void {
    const pos = this.openPositions.get(ticket);
    if (pos) {
      this.openPositions.set(ticket, { ...pos, ...update });
    }
  }

  confirmTradeClose(result: MT5TradeResult): void {
    this.openPositions.delete(result.ticket);
    this.recentTrades.unshift(result);
    if (this.recentTrades.length > 100) this.recentTrades.pop();

    if (result.profit > 0) {
      this.status.dailyProfit += result.profit;
      this.status.dailyWins++;
      this.consecutiveLosses = 0; // Reset ao ganhar
    } else {
      this.status.dailyLoss += Math.abs(result.profit);
      this.status.dailyLosses++;
      this.consecutiveLosses++;

      // Circuit breaker: pausa após perdas consecutivas
      if (this.consecutiveLosses >= this.MAX_CONSECUTIVE_LOSSES) {
        this.circuitBreakerUntil = Date.now() + this.CIRCUIT_BREAKER_MS;
        console.log(`[MT5Bridge] 🛑 Circuit Breaker ativado após ${this.consecutiveLosses} perdas consecutivas — pausa de 15 min`);
      }
    }

    const total = this.status.dailyWins + this.status.dailyLosses;
    this.status.winRate = total > 0 ? (this.status.dailyWins / total) * 100 : 0;

    this.emit('trade_closed', result);
    console.log(`[MT5Bridge] 🔒 Posição fechada: #${result.ticket} | P&L: ${result.profit > 0 ? '+' : ''}${result.profit.toFixed(2)} | ${result.closeReason} | Perdas consecutivas: ${this.consecutiveLosses}`);
  }

  getOpenPositions(): MT5Position[] {
    return Array.from(this.openPositions.values());
  }

  getRecentTrades(): MT5TradeResult[] {
    return this.recentTrades.slice(0, 50);
  }

  addMarketData(symbol: string, candles: any[]): void {
    this.marketDataCache.set(symbol, candles);
    const hasPending = !!this.getPendingSignal(symbol);
    if (!hasPending && this.config.enabled) {
      setImmediate(() => {
        this.generateSignal(symbol).then(signal => {
          if (signal && signal.action !== 'HOLD') {
            console.log(`[MT5Bridge] 🎯 Sinal gerado para ${symbol}: ${signal.action} (${(signal.confidence * 100).toFixed(1)}%)`);
          }
        }).catch(() => {});
      });
    }
  }

  private getMarketDataForSymbol(symbol: string): any[] {
    return this.marketDataCache.get(symbol) || [];
  }

  // generateMockSignal removido — sinais aleatórios são proibidos.
  // O sistema só opera quando a IA real retorna consenso >= 70%.

  private startSignalGeneration(): void {
    if (this.signalGenerationInterval) return;
    console.log('[MT5Bridge] 🚀 Iniciando geração automática de sinais');
    this.signalGenerationInterval = setInterval(() => {
      if (!this.config.enabled) return;
      const symbols = this.config.symbols.slice(0, 3);
      symbols.forEach((symbol, i) => {
        setTimeout(() => {
          setImmediate(() => {
            this.generateSignal(symbol).catch(() => {});
          });
        }, i * 2000);
      });
    }, 30000);
  }

  private stopSignalGeneration(): void {
    if (this.signalGenerationInterval) {
      clearInterval(this.signalGenerationInterval);
      this.signalGenerationInterval = null;
      console.log('[MT5Bridge] ⏹️ Geração de sinais pausada');
    }
  }

  private calcEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] || 0;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
  }

  private calcRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  }

  private calcMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
    const ema12 = this.calcEMA(prices, 12);
    const ema26 = this.calcEMA(prices, 26);
    const macd = ema12 - ema26;
    const signalLine = macd * 0.9;
    return { macd, signal: signalLine, histogram: macd - signalLine };
  }

  private calcBollinger(prices: number[], period: number, stdDev: number): { upper: number; mid: number; lower: number } {
    const slice = prices.slice(-period);
    const mid = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mid, 2), 0) / slice.length;
    const std = Math.sqrt(variance) * stdDev;
    return { upper: mid + std, mid, lower: mid - std };
  }

  private calcATR(highs: number[], lows: number[], closes: number[], period: number): number {
    const trs: number[] = [];
    for (let i = 1; i < Math.min(period + 1, closes.length); i++) {
      const idx = closes.length - period + i;
      if (idx < 1) continue;
      const tr = Math.max(
        highs[idx] - lows[idx],
        Math.abs(highs[idx] - closes[idx - 1]),
        Math.abs(lows[idx] - closes[idx - 1])
      );
      trs.push(tr);
    }
    return trs.length > 0 ? trs.reduce((a, b) => a + b, 0) / trs.length : 0.001;
  }

  private calcADX(highs: number[], lows: number[], closes: number[], period: number): number {
    if (closes.length < period) return 25;
    const dxValues: number[] = [];
    for (let i = 1; i < Math.min(period, closes.length); i++) {
      const idx = closes.length - period + i;
      if (idx < 1) continue;
      const dmPlus = Math.max(highs[idx] - highs[idx - 1], 0);
      const dmMinus = Math.max(lows[idx - 1] - lows[idx], 0);
      if (dmPlus + dmMinus > 0) {
        const dx = Math.abs(dmPlus - dmMinus) / (dmPlus + dmMinus) * 100;
        dxValues.push(dx);
      }
    }
    return dxValues.length > 0 ? dxValues.reduce((a, b) => a + b, 0) / dxValues.length : 25;
  }

  private calcStochastic(highs: number[], lows: number[], closes: number[], kPeriod: number, dPeriod: number): { k: number; d: number } {
    const slice = closes.slice(-kPeriod);
    const highSlice = highs.slice(-kPeriod);
    const lowSlice = lows.slice(-kPeriod);
    const highest = Math.max(...highSlice);
    const lowest = Math.min(...lowSlice);
    const k = highest === lowest ? 50 : (closes[closes.length - 1] - lowest) / (highest - lowest) * 100;
    return { k, d: k };
  }
}

export const metaTraderBridge = new MetaTraderBridge();
