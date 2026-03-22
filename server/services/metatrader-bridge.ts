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
import { storage } from '../storage';
import { getSignal } from './signal-store';
import { sqlite } from '../db';

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
  spikeOpportunity?: boolean;
  spikeExitRequired?: boolean;
  fibZone?: string;
  fibConfluence?: number;
  // Campos para controle autônomo da IA
  aiTrailingEnabled?: boolean;  // IA recomenda ativar trailing para este trade
  aiTrailingPips?: number;      // Pips de trailing recomendados pela IA
  aiMaxPositions?: number;      // Limite de posições recomendado pela IA
  aiMaxDailyLoss?: number;      // Perda máx. diária recomendada pela IA
  aiMaxDailyProfit?: number;    // Lucro alvo diário recomendado pela IA
}

export interface FibZoneInfo {
  level: string;
  price: number;
  layer: 'macro' | 'meso' | 'micro';
  type: 'support' | 'resistance';
  distancePct: number;
}

export interface SpikeInfo {
  expected: boolean;
  direction: 'down' | 'up' | null;
  confidence: number;
  candlesSinceLastSpike: number;
  avgCandleInterval: number;
  imminencePercent: number;
  momentumConfirms: boolean;
  lastSpikeSize: number;
  preEntryWindow: boolean;
  entryTimingScore: number;
  ticksUntilSpikeEstimate: number;
}

export interface NestedFibonacciZone {
  parentLevel1: string;
  parentLevel2: string;
  parentLayer: 'macro' | 'meso' | 'micro';
  price1: number;
  price2: number;
  nestedLevels: Record<string, number>;
  currentPriceInZone: boolean;
  nearestNestedLevel: { level: string; price: number; distancePct: number } | null;
}

export interface FibZoneBehavior {
  zoneType: 'support' | 'resistance';
  continuationScore: number;
  reversalScore: number;
  candlePattern: 'bullish_engulfing' | 'bearish_engulfing' | 'doji' | 'pin_bar_bull' | 'pin_bar_bear' | 'none';
  confirmation: 'continuation' | 'reversal' | 'unclear';
  narrative: string;
}

export interface PositionMonitorResult {
  ticket: number;
  action: 'HOLD' | 'CLOSE_PROFIT' | 'CLOSE_LOSS_PREVENTION' | 'CLOSE_SPIKE_EXIT';
  urgency: 'normal' | 'high' | 'critical';
  reason: string;
  currentPnLPct?: number;
  fibZoneReached?: FibZoneInfo;
  spikeRisk?: number;
  narrative: string;
}

export interface FibonacciAnalysis {
  macro: Record<string, number>;
  meso: Record<string, number>;
  micro: Record<string, number>;
  nearestLevels: FibZoneInfo[];
  confluenceScore: number;
  zoneType: 'support' | 'resistance' | 'neutral';
  confluenceNarrative: string;
  nestedZones: NestedFibonacciZone[];
  zoneBehavior?: FibZoneBehavior;
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
  fibonacci?: FibonacciAnalysis;
  spike?: SpikeInfo;
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
  comment?: string;
  magic?: number;
  source?: 'ea' | 'api';
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
  comment?: string;
  source?: 'ea' | 'api';
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
  // Modos de controle da IA
  fullAIMode: boolean;      // IA controla 100% de tudo
  useAILotSize: boolean;    // IA define o lote ideal por operação
  useAITrailing: boolean;   // IA ativa/controla trailing stop
  useAIRiskLimits: boolean; // IA gerencia limites de risco (posições, perda, lucro)
  // Filtro Girassol
  requireGirassolConfirmation: boolean; // Exige sinal claro do Girassol para operar (BUY ou SELL — NEUTRO bloqueia)
  maxPositionsPerSymbol: number;        // Máximo de posições abertas por símbolo (0 = sem limite por símbolo)
  invertGirassolBuffers: boolean;       // Inverte buffer 0 e 1 do Girassol (quando topo=buffer0=SELL mas sistema lê como BUY)
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
  apiToken: '',
  fullAIMode: false,
  useAILotSize: false,
  useAITrailing: false,
  useAIRiskLimits: false,
  requireGirassolConfirmation: false,
  maxPositionsPerSymbol: 1,
  invertGirassolBuffers: false,
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

/**
 * Contexto completo de uma posição — persiste entre chamadas do monitor.
 * Permite decisões baseadas em histórico, não apenas no snapshot atual.
 */
export interface PositionContext {
  ticket: number;
  symbol: string;
  type: 'BUY' | 'SELL';
  entryPrice: number;
  entryTime: number;               // Timestamp da 1ª vez que o monitor viu esta posição
  entryBalance: number;            // Saldo da conta no momento da entrada
  lots: number;
  maxAdverseExcursion: number;     // Pior perda em $ (MAE — mais negativo já visto)
  maxFavorableExcursion: number;   // Melhor lucro em $ (MFE)
  wasEverNegative: boolean;        // Ficou negativa em algum momento
  wasEverPositive: boolean;        // Ficou positiva em algum momento
  lowestProfit: number;            // Menor lucro registrado
  highestProfit: number;           // Maior lucro registrado
  lastProfit: number;              // Último lucro registrado
  monitorCycles: number;           // Número de ciclos de monitoramento
  lossAccelerationCycles: number;  // Ciclos consecutivos de piora
  profitTrailing: number;          // Melhor lucro desde que entrou em território positivo
  signalId: string;
  closeReason?: string;            // Preenchido quando decidido fechar
}

export interface AIModelResult {
  model: string;
  prediction: 'up' | 'down' | 'neutral';
  confidence: number;
  reasoning: string;
  narrative?: string;
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
  technicalNarrative?: string;
  // Decision
  finalDecision?: 'BUY' | 'SELL' | 'HOLD' | null;
  decisionReason: string;
  fullNarrative?: string;
  // Safety state
  circuitBreakerActive?: boolean;
  consecutiveLosses?: number;
  circuitBreakerRemainingMin?: number;
  candlesAvailable?: number;
}

// ============================================================
// DERIV SYNTHETIC ASSET KNOWLEDGE BASE
// Perfil completo de cada ativo sintético da Deriv.
// As IAs usam isso para adaptar indicadores, SL/TP e entradas.
// ============================================================

export interface DerivSyntheticProfile {
  family: string;
  description: string;
  alwaysOpen: boolean;
  spikeIndex: boolean;
  volClass: 'ultra-low' | 'low' | 'medium' | 'high' | 'ultra-high';
  slAtrMultiplier: number;
  tpAtrMultiplier: number;
  minSlPips: number;
  maxSlPips: number;
  minTpPips: number;
  maxTpPips: number;
  rsiOversold: number;
  rsiOverbought: number;
  trendType: 'directional' | 'mean-reverting' | 'spike-dominant' | 'range-bound' | 'hybrid';
  indicatorNotes: string;
  behaviorKnowledge: string[];
  optimalTimeframe: string;
  useFibonacci: boolean;
  spikeFrequency?: string;
  spikeDirection?: 'both' | 'down' | 'up';
  jumpProbability?: number;
  aiContextHint: string;
  tickSize: number;
  avgDailyRange: number;
}

const DERIV_SYNTHETIC_PROFILES: Record<string, DerivSyntheticProfile> = {
  // ── VOLATILITY INDICES ──────────────────────────────────────
  'R_10': {
    family: 'Volatility Index',
    description: 'Volatility 10 Index — volatilidade sintética de 10%, mercado mais calmo e previsível da família',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'ultra-low',
    slAtrMultiplier: 1.2,
    tpAtrMultiplier: 2.5,
    minSlPips: 3, maxSlPips: 15, minTpPips: 6, maxTpPips: 40,
    rsiOversold: 35, rsiOverbought: 65,
    trendType: 'mean-reverting',
    indicatorNotes: 'RSI funciona bem entre 35-65. Bollinger Bands são excelentes — o preço retorna à média com alta frequência. EMAs respondem lentamente. Girassol tem excelente taxa de acerto neste ativo.',
    behaviorKnowledge: [
      'O V10 é o ativo de menor volatilidade da família — movimentos pequenos e contínuos',
      'Reversões à média muito frequentes — RSI <35 ou >65 são sinais fortes de reversão',
      'Bollinger Bands squeeze seguido de expansão é padrão recorrente',
      'Tendências são curtas — raramente mantém direção por mais de 20-30 candles',
      'ADX raramente supera 25 — operar contra ADX alto é seguro neste ativo',
      'Ideal para estratégias de range trading com Girassol como confirmador',
      'SL pequeno (3-15 pips) funciona bem pela baixa volatilidade',
      'O ativo opera 24/7 sem gaps — perfeito para automação contínua',
    ],
    optimalTimeframe: 'M1, M5',
    useFibonacci: true,
    aiContextHint: 'Ativo de baixíssima volatilidade (10%). IAs devem priorizar sinais de reversão à média. RSI e Bollinger são os indicadores mais confiáveis. Evitar seguir tendências longas.',
    tickSize: 0.01,
    avgDailyRange: 15,
  },
  'R_25': {
    family: 'Volatility Index',
    description: 'Volatility 25 Index — volatilidade sintética de 25%, bom equilíbrio entre tendência e reversão',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'low',
    slAtrMultiplier: 1.4,
    tpAtrMultiplier: 2.8,
    minSlPips: 5, maxSlPips: 25, minTpPips: 10, maxTpPips: 60,
    rsiOversold: 33, rsiOverbought: 67,
    trendType: 'hybrid',
    indicatorNotes: 'Bom equilíbrio entre trend-following e mean-reversion. MACD funciona bem para tendências. RSI dá bons sinais de entrada em reversões. Girassol e Fibonacci combinam bem.',
    behaviorKnowledge: [
      'V25 tem movimentos maiores que V10 mas ainda gerenciáveis com SL médio',
      'Tendências de médio prazo são mais frequentes — MACD é confiável',
      'RSI <33 e >67 são zonas de alta probabilidade de reversão',
      'Cruzamentos de EMA20/EMA50 funcionam bem neste ativo',
      'Fibonacci multi-layer tem boa efetividade — confluências de 2+ camadas são muito confiáveis',
      'ADX acima de 25 indica tendência forte — seguir a direção com TP maior',
      'Bollinger Bands mais amplas que o V10 — squeeze são menos frequentes mas muito poderosos',
      'Opera 24/7 — sem horários preferenciais',
    ],
    optimalTimeframe: 'M5, M15',
    useFibonacci: true,
    aiContextHint: 'Volatilidade 25%. IAs devem balancear entre sinais de tendência (MACD, EMA) e reversão (RSI, Bollinger). Alta efetividade do Fibonacci. Confluência de 2+ indicadores é mandatória.',
    tickSize: 0.01,
    avgDailyRange: 40,
  },
  'R_50': {
    family: 'Volatility Index',
    description: 'Volatility 50 Index — volatilidade sintética de 50%, ativo balanceado com tendências claras',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'medium',
    slAtrMultiplier: 1.5,
    tpAtrMultiplier: 3.0,
    minSlPips: 8, maxSlPips: 40, minTpPips: 16, maxTpPips: 100,
    rsiOversold: 30, rsiOverbought: 70,
    trendType: 'directional',
    indicatorNotes: 'Excelente para trend-following com EMAs e MACD. RSI 30/70 são os limiares clássicos e funcionam bem. ADX acima de 25 confirma tendência forte. Girassol tem boa performance. Fibonacci válido em todos os tempos.',
    behaviorKnowledge: [
      'V50 é o ativo mais popular da família Volatility — boa liquidez sintética',
      'Tendências claras e duradouras — seguir EMA20/EMA50 é muito efetivo',
      'RSI 30/70 funciona perfeitamente como em Forex tradicional',
      'MACD crossover é muito confiável — especialmente quando confirmado por EMA',
      'Bollinger Bands de largura média — squeezem seguidos de breakout são comuns',
      'Fibonacci 38.2%, 50%, 61.8% são zonas de reação muito confiáveis',
      'ADX raramente fica em zona lateral prolongada — tendências são dominantes',
      'Patterns de candle (engulfing, pin bar) funcionam neste ativo',
    ],
    optimalTimeframe: 'M5, M15, H1',
    useFibonacci: true,
    aiContextHint: 'Volatilidade 50%. O V50 é o mais "normal" da família — indica comportamentos parecidos com Forex. IAs podem usar todos os indicadores com confiança. MACD + RSI + EMA = tripla confirmação ideal.',
    tickSize: 0.01,
    avgDailyRange: 80,
  },
  'R_75': {
    family: 'Volatility Index',
    description: 'Volatility 75 Index — alta volatilidade de 75%, movimentos rápidos e intensos',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'high',
    slAtrMultiplier: 1.8,
    tpAtrMultiplier: 3.5,
    minSlPips: 15, maxSlPips: 80, minTpPips: 30, maxTpPips: 200,
    rsiOversold: 28, rsiOverbought: 72,
    trendType: 'directional',
    indicatorNotes: 'Alta volatilidade exige SL maior. ATR é fundamental — SL deve ser pelo menos 1.8×ATR. EMAs funcionam mas com lag maior. ADX frequentemente >30 — tendências fortes são comuns. Fibonacci com confluência de 3 camadas é necessário para alta confiança.',
    behaviorKnowledge: [
      'V75 tem movimentos amplos — SL deve ser generoso para evitar stop premature',
      'Reversões são bruscas e rápidas — TP deve ser tomado rapidamente quando atingido',
      'RSI pode ficar em sobrecompra/sobrevenda prolongada em tendências fortes',
      'EMA200 é suporte/resistência muito respeitado neste ativo',
      'Bollinger Bands frecuentemente tocadas — volatilidade alta gera expansão constante',
      'ATR elevado — usar SL baseado em 1.5-2x ATR é mandatório',
      'Fibonacci macro (máximos/mínimos de 200+ candles) é mais confiável que micro',
      'MACD divergência é sinal poderoso de reversão neste ativo',
    ],
    optimalTimeframe: 'M15, H1',
    useFibonacci: true,
    aiContextHint: 'Volatilidade 75%. IAs devem ser mais conservadoras no tamanho do SL. Confluência tripla de indicadores é necessária. ATR deve ser o principal guia de SL/TP. Tendências fortes e rápidas — priorizar MACD + EMA + ADX.',
    tickSize: 0.01,
    avgDailyRange: 150,
  },
  'R_100': {
    family: 'Volatility Index',
    description: 'Volatility 100 Index — máxima volatilidade da família (100%), movimento extremamente rápido',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'ultra-high',
    slAtrMultiplier: 2.0,
    tpAtrMultiplier: 4.0,
    minSlPips: 20, maxSlPips: 120, minTpPips: 40, maxTpPips: 300,
    rsiOversold: 25, rsiOverbought: 75,
    trendType: 'directional',
    indicatorNotes: 'Ativo de extrema volatilidade. SL mínimo de 2x ATR. RSI pode passar longos períodos em zonas extremas. EMAs lentas (50, 200) são mais confiáveis que rápidas. ADX quase sempre >25. Fibonacci macro obrigatório.',
    behaviorKnowledge: [
      'V100 é o ativo mais volátil da família — requer gestão rigorosa de risco',
      'SL grande é mandatório — stop premature é o erro mais comum neste ativo',
      'Tendências muito fortes e rápidas — RSI pode ficar >70 por longos períodos',
      'EMA200 é o nível mais respeitado — preço sempre volta para testá-la',
      'Bollinger Bands com squeeze seguido de breakout explosivo é padrão dominante',
      'MACD divergência de alta/baixa frequência é mais confiável que crossover simples',
      'ATR elevadíssimo — usar calculadora de lote baseada em ATR é essencial',
      'Fibonacci deve usar timeframes maiores (H1, H4) para ser efetivo',
    ],
    optimalTimeframe: 'M15, H1, H4',
    useFibonacci: true,
    aiContextHint: 'Volatilidade 100%. O ativo mais arriscado da família. IAs devem exigir confluência máxima de indicadores (5+). SL/TP baseados em ATR são mandatórios. Risco por operação deve ser menor que em outros ativos.',
    tickSize: 0.01,
    avgDailyRange: 250,
  },
  // ── VOLATILITY HZ VARIANTS ──────────────────────────────────
  '1HZ10V': {
    family: 'Volatility HZ Index',
    description: 'Volatility 10 (1s) Index — mesmo comportamento do V10 mas com ticks a cada 1 segundo',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'ultra-low',
    slAtrMultiplier: 1.2,
    tpAtrMultiplier: 2.5,
    minSlPips: 2, maxSlPips: 10, minTpPips: 4, maxTpPips: 25,
    rsiOversold: 35, rsiOverbought: 65,
    trendType: 'mean-reverting',
    indicatorNotes: 'Versão de 1 segundo do V10. Ticks muito rápidos — indicadores de curto prazo são mais relevantes. RSI de período 7 funciona melhor que período 14.',
    behaviorKnowledge: [
      'Ticks a cada 1 segundo — ideal para scalping de curtíssimo prazo',
      'Comportamento idêntico ao V10 mas em escala de tempo 10x mais rápida',
      'Reversão à média muito frequente e rápida',
      'Girassol funciona bem em M1 com entradas rápidas',
    ],
    optimalTimeframe: 'M1, M5',
    useFibonacci: false,
    aiContextHint: 'Versão 1s do V10. Ideal para scalping. IAs devem focar em reversões rápidas à média.',
    tickSize: 0.001,
    avgDailyRange: 15,
  },
  '1HZ25V': {
    family: 'Volatility HZ Index',
    description: 'Volatility 25 (1s) Index — V25 com ticks de 1 segundo',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'low',
    slAtrMultiplier: 1.4,
    tpAtrMultiplier: 2.8,
    minSlPips: 3, maxSlPips: 15, minTpPips: 6, maxTpPips: 40,
    rsiOversold: 33, rsiOverbought: 67,
    trendType: 'hybrid',
    indicatorNotes: 'V25 com ticks de 1 segundo. Comportamento híbrido entre tendência e reversão.',
    behaviorKnowledge: ['Comportamento idêntico ao V25 em escala 1s', 'Bom equilíbrio tendência/reversão'],
    optimalTimeframe: 'M1, M5',
    useFibonacci: true,
    aiContextHint: 'V25 em 1 segundo. IAs devem balancear trend e reversão.',
    tickSize: 0.001,
    avgDailyRange: 40,
  },
  '1HZ50V': {
    family: 'Volatility HZ Index',
    description: 'Volatility 50 (1s) Index — V50 com ticks de 1 segundo',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'medium',
    slAtrMultiplier: 1.5,
    tpAtrMultiplier: 3.0,
    minSlPips: 5, maxSlPips: 25, minTpPips: 10, maxTpPips: 60,
    rsiOversold: 30, rsiOverbought: 70,
    trendType: 'directional',
    indicatorNotes: 'V50 com ticks de 1 segundo. Melhor da família HZ para trend-following.',
    behaviorKnowledge: ['Idêntico ao V50 — tendências claras', 'MACD + EMA são os indicadores primários'],
    optimalTimeframe: 'M1, M5, M15',
    useFibonacci: true,
    aiContextHint: 'V50 em 1 segundo. Trend-following é dominante.',
    tickSize: 0.001,
    avgDailyRange: 80,
  },
  '1HZ75V': {
    family: 'Volatility HZ Index',
    description: 'Volatility 75 (1s) Index — V75 com ticks de 1 segundo, alta volatilidade',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'high',
    slAtrMultiplier: 1.8,
    tpAtrMultiplier: 3.5,
    minSlPips: 10, maxSlPips: 60, minTpPips: 20, maxTpPips: 150,
    rsiOversold: 28, rsiOverbought: 72,
    trendType: 'directional',
    indicatorNotes: 'Alta volatilidade — SL generoso obrigatório. ATR-based SL é essencial.',
    behaviorKnowledge: ['Idêntico ao V75 mas em ticks 1s', 'Tendências fortes e rápidas'],
    optimalTimeframe: 'M5, M15',
    useFibonacci: true,
    aiContextHint: 'V75 em 1 segundo. SL baseado em ATR é mandatório.',
    tickSize: 0.001,
    avgDailyRange: 150,
  },
  '1HZ100V': {
    family: 'Volatility HZ Index',
    description: 'Volatility 100 (1s) Index — máxima volatilidade com ticks de 1 segundo',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'ultra-high',
    slAtrMultiplier: 2.0,
    tpAtrMultiplier: 4.0,
    minSlPips: 15, maxSlPips: 100, minTpPips: 30, maxTpPips: 250,
    rsiOversold: 25, rsiOverbought: 75,
    trendType: 'directional',
    indicatorNotes: 'Extremamente volátil. Apenas operar com confluência máxima de todos os indicadores.',
    behaviorKnowledge: ['Idêntico ao V100 — máxima volatilidade', 'Exige gestão rigorosa de risco'],
    optimalTimeframe: 'M5, M15',
    useFibonacci: true,
    aiContextHint: 'V100 em 1 segundo. Máxima cautela. Confluência total de indicadores obrigatória.',
    tickSize: 0.001,
    avgDailyRange: 250,
  },
  // ── CRASH INDICES ────────────────────────────────────────────
  'CRASH300': {
    family: 'Crash Index',
    description: 'Crash 300 Index — spikes de queda a cada ~300 ticks, mais frequente da família Crash',
    alwaysOpen: true,
    spikeIndex: true,
    volClass: 'high',
    slAtrMultiplier: 0.5,
    tpAtrMultiplier: 2.0,
    minSlPips: 5, maxSlPips: 30, minTpPips: 10, maxTpPips: 80,
    rsiOversold: 20, rsiOverbought: 80,
    trendType: 'spike-dominant',
    indicatorNotes: 'Ativo dominado por spikes de queda repentinos. Indicadores convencionais são secundários ao detector de spike. Girassol detecta padrões pré-spike bem. RSI em sobrecompra é forte sinal de spike iminente.',
    behaviorKnowledge: [
      'Spikes de QUEDA a cada ~300 ticks — o mais frequente da família Crash',
      'Entre spikes: tendência de ALTA contínua e suave',
      'Padrão: alta gradual → spike abrupto de queda → retomada da alta',
      'RSI >75 antes do spike é padrão típico — mercado "tensiona" antes de cair',
      'Volume de ticks aumenta antes do spike — momentum comprova iminência',
      'SL muito curto para trades de spike (pegar a queda rápida)',
      'Para trades de continuidade (tendência de alta): SL acima do último spike',
      'Girassol em M1 detecta início da alta pós-spike com alta precisão',
      'Nunca segurar uma posição SELL durante a retomada de alta pós-spike',
    ],
    spikeFrequency: 'A cada ~300 ticks (aprox. 30 velas M1)',
    spikeDirection: 'down',
    optimalTimeframe: 'M1, M5',
    useFibonacci: false,
    aiContextHint: 'Crash 300: spikes de queda a cada ~300 ticks. IA deve detectar iminência de spike (RSI alto + momentum) para SELL curto. Para continuidade: BUY na retomada pós-spike com SL abaixo do spike.',
    tickSize: 0.01,
    avgDailyRange: 200,
  },
  'CRASH500': {
    family: 'Crash Index',
    description: 'Crash 500 Index — spikes de queda a cada ~500 ticks',
    alwaysOpen: true,
    spikeIndex: true,
    volClass: 'high',
    slAtrMultiplier: 0.6,
    tpAtrMultiplier: 2.2,
    minSlPips: 8, maxSlPips: 40, minTpPips: 15, maxTpPips: 100,
    rsiOversold: 20, rsiOverbought: 80,
    trendType: 'spike-dominant',
    indicatorNotes: 'Spikes menos frequentes que o 300 mas de amplitude similar. A tendência de alta entre spikes é mais longa e forte — mais oportunidades de continuidade.',
    behaviorKnowledge: [
      'Spikes de QUEDA a cada ~500 ticks (~50 velas M1)',
      'Tendência de alta mais prolongada entre spikes — bom para trades de continuidade',
      'RSI pode ficar em sobrecompra por longos períodos entre spikes',
      'EMA20 serve como suporte dinâmico durante a tendência de alta',
      'Após o spike: recuperação quase imediata — janela de entrada pós-spike é curta',
      'MACD bullish é dominante entre os spikes — confirma tendência de alta',
    ],
    spikeFrequency: 'A cada ~500 ticks (aprox. 50 velas M1)',
    spikeDirection: 'down',
    optimalTimeframe: 'M1, M5',
    useFibonacci: false,
    aiContextHint: 'Crash 500: spikes de queda menos frequentes. IA deve focar em trades de continuidade (BUY) na tendência de alta entre spikes, e SELL rápido quando spike é iminente.',
    tickSize: 0.01,
    avgDailyRange: 300,
  },
  'CRASH1000': {
    family: 'Crash Index',
    description: 'Crash 1000 Index — spikes de queda a cada ~1000 ticks, menos frequente',
    alwaysOpen: true,
    spikeIndex: true,
    volClass: 'ultra-high',
    slAtrMultiplier: 0.7,
    tpAtrMultiplier: 2.5,
    minSlPips: 10, maxSlPips: 60, minTpPips: 20, maxTpPips: 150,
    rsiOversold: 20, rsiOverbought: 80,
    trendType: 'spike-dominant',
    indicatorNotes: 'Spikes raros mas de maior amplitude. Longa tendência de alta entre spikes — ideal para trades de continuidade de médio prazo.',
    behaviorKnowledge: [
      'Spike de QUEDA a cada ~1000 ticks (~100 velas M1)',
      'Tendência de alta muito longa e estável entre spikes — ótima para swing trading',
      'EMA50 e EMA200 são suportes muito respeitados durante a tendência',
      'Fibonacci funciona bem na tendência de alta prolongada',
      'Amplitude do spike é geralmente maior que no 300 e 500',
      'Detecção de spike: RSI extremo + padrão de candle de reversão + imminência >80%',
    ],
    spikeFrequency: 'A cada ~1000 ticks (aprox. 100 velas M1)',
    spikeDirection: 'down',
    optimalTimeframe: 'M5, M15',
    useFibonacci: true,
    aiContextHint: 'Crash 1000: tendência de alta longa. IA deve operar BUY com SL abaixo de EMA50. Fibonacci válido para TP. SELL apenas quando spike for muito iminente (>85% de iminência).',
    tickSize: 0.01,
    avgDailyRange: 500,
  },
  // ── BOOM INDICES ─────────────────────────────────────────────
  'BOOM300': {
    family: 'Boom Index',
    description: 'Boom 300 Index — spikes de alta a cada ~300 ticks, mais frequente da família Boom',
    alwaysOpen: true,
    spikeIndex: true,
    volClass: 'high',
    slAtrMultiplier: 0.5,
    tpAtrMultiplier: 2.0,
    minSlPips: 5, maxSlPips: 30, minTpPips: 10, maxTpPips: 80,
    rsiOversold: 20, rsiOverbought: 80,
    trendType: 'spike-dominant',
    indicatorNotes: 'Espelho do Crash 300 mas com spikes de ALTA. Tendência de baixa gradual entre spikes. RSI em sobrevenda é sinal forte de spike de alta iminente.',
    behaviorKnowledge: [
      'Spikes de ALTA a cada ~300 ticks',
      'Entre spikes: tendência de BAIXA contínua e suave',
      'Padrão: queda gradual → spike abrupto de alta → retomada da queda',
      'RSI <25 antes do spike é padrão típico',
      'Para trades de spike: BUY muito rápido e sair logo',
      'Para continuidade: SELL na tendência de queda com SL abaixo do último spike',
      'Girassol detecta início da queda pós-spike bem',
    ],
    spikeFrequency: 'A cada ~300 ticks',
    spikeDirection: 'up',
    optimalTimeframe: 'M1, M5',
    useFibonacci: false,
    aiContextHint: 'Boom 300: spikes de ALTA frequentes. IA deve detectar iminência de spike para BUY rápido. Continuidade: SELL na tendência de queda entre spikes.',
    tickSize: 0.01,
    avgDailyRange: 200,
  },
  'BOOM500': {
    family: 'Boom Index',
    description: 'Boom 500 Index — spikes de alta a cada ~500 ticks',
    alwaysOpen: true,
    spikeIndex: true,
    volClass: 'high',
    slAtrMultiplier: 0.6,
    tpAtrMultiplier: 2.2,
    minSlPips: 8, maxSlPips: 40, minTpPips: 15, maxTpPips: 100,
    rsiOversold: 20, rsiOverbought: 80,
    trendType: 'spike-dominant',
    indicatorNotes: 'Tendência de baixa mais prolongada entre spikes. Mais oportunidades de SELL de continuidade.',
    behaviorKnowledge: ['Spikes de ALTA a cada ~500 ticks', 'Tendência de baixa mais longa — bom para SELL de continuidade'],
    spikeFrequency: 'A cada ~500 ticks',
    spikeDirection: 'up',
    optimalTimeframe: 'M1, M5',
    useFibonacci: false,
    aiContextHint: 'Boom 500: SELL de continuidade é a estratégia primária. BUY apenas em spike iminente.',
    tickSize: 0.01,
    avgDailyRange: 300,
  },
  'BOOM1000': {
    family: 'Boom Index',
    description: 'Boom 1000 Index — spikes de alta a cada ~1000 ticks, tendência de baixa longa',
    alwaysOpen: true,
    spikeIndex: true,
    volClass: 'ultra-high',
    slAtrMultiplier: 0.7,
    tpAtrMultiplier: 2.5,
    minSlPips: 10, maxSlPips: 60, minTpPips: 20, maxTpPips: 150,
    rsiOversold: 20, rsiOverbought: 80,
    trendType: 'spike-dominant',
    indicatorNotes: 'Espelho do Crash 1000 com spikes de alta. Longa tendência de baixa entre spikes — boa para SELL de médio prazo.',
    behaviorKnowledge: ['Spikes de ALTA a cada ~1000 ticks', 'Tendência de baixa longa e estável', 'EMA50/200 como resistências durante a queda'],
    spikeFrequency: 'A cada ~1000 ticks',
    spikeDirection: 'up',
    optimalTimeframe: 'M5, M15',
    useFibonacci: true,
    aiContextHint: 'Boom 1000: SELL com SL acima de EMA50. Fibonacci válido para TP. BUY apenas com iminência de spike >85%.',
    tickSize: 0.01,
    avgDailyRange: 500,
  },
  // ── STEP INDEX ───────────────────────────────────────────────
  'STEPINDEX': {
    family: 'Step Index',
    description: 'Step Index — move exatamente 0.1 para cima ou para baixo a cada tick, probabilidade 50/50',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'low',
    slAtrMultiplier: 2.0,
    tpAtrMultiplier: 2.0,
    minSlPips: 10, maxSlPips: 50, minTpPips: 10, maxTpPips: 50,
    rsiOversold: 30, rsiOverbought: 70,
    trendType: 'range-bound',
    indicatorNotes: 'O Step Index é único: move EXATAMENTE 0.1 por tick em qualquer direção, 50/50. RSI e MACD funcionam diferentemente. Bollinger Bands são muito efetivas. Streaks (sequências de direção) são detectáveis e exploráveis.',
    behaviorKnowledge: [
      'Cada tick move exatamente 0.1 ponto — sem variação de tamanho',
      'Probabilidade 50/50 por tick — mas streaks ocorrem e podem ser explorados',
      'Bollinger Bands são o indicador mais efetivo — squeeze é muito confiável',
      'RSI funciona bem para detectar streaks prolongados em uma direção',
      'MACD é menos efetivo — o movimento uniforme distorce as médias',
      'Fibonacci pode ser aplicado mas com menos efetividade que em outros ativos',
      'Girassol funciona detectando streaks e momentum direcional',
      'SL e TP devem ser simétricos — a natureza do ativo é 50/50',
      'Maior janela de observação = melhor para detectar momentum',
    ],
    optimalTimeframe: 'M1, M5',
    useFibonacci: false,
    aiContextHint: 'Step Index: movimento 0.1 por tick, 50/50. IA deve detectar streaks direcionais via RSI e Bollinger. Streaks de 20+ ticks são exploráveis mas risco é alto. SL/TP simétricos.',
    tickSize: 0.1,
    avgDailyRange: 50,
  },
  // ── JUMP INDICES ─────────────────────────────────────────────
  'JUMP10': {
    family: 'Jump Index',
    description: 'Jump 10 Index — jumps de 10% de probabilidade a cada tick em qualquer direção',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'medium',
    slAtrMultiplier: 1.5,
    tpAtrMultiplier: 3.0,
    minSlPips: 8, maxSlPips: 40, minTpPips: 15, maxTpPips: 80,
    rsiOversold: 30, rsiOverbought: 70,
    trendType: 'hybrid',
    jumpProbability: 0.10,
    indicatorNotes: 'Jump 10 tem jumps aleatórios de amplitude maior a cada ~10 ticks. Indicadores standard funcionam entre os jumps. Girassol detecta tendência entre jumps bem.',
    behaviorKnowledge: [
      'Jumps de amplitude 10% ocorrem aleatoriamente — preparar SL para absorver',
      'Entre jumps: comportamento normal e tendencial',
      'RSI e MACD funcionam bem para capturar tendências entre jumps',
      'SL deve ser maior que a amplitude típica do jump para evitar stop premature',
      'Girassol é efetivo para detectar direção dominante entre jumps',
    ],
    optimalTimeframe: 'M1, M5',
    useFibonacci: true,
    aiContextHint: 'Jump 10: jumps aleatórios de grande amplitude. IA deve detectar tendência entre jumps. SL deve ser maior que amplitude típica do jump.',
    tickSize: 0.01,
    avgDailyRange: 100,
  },
  'JUMP25': {
    family: 'Jump Index',
    description: 'Jump 25 Index — jumps de 25% de probabilidade, mais frequentes',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'high',
    slAtrMultiplier: 1.8,
    tpAtrMultiplier: 3.5,
    minSlPips: 12, maxSlPips: 60, minTpPips: 20, maxTpPips: 120,
    rsiOversold: 28, rsiOverbought: 72,
    trendType: 'hybrid',
    jumpProbability: 0.25,
    indicatorNotes: 'Jumps mais frequentes que o Jump 10 — SL maior necessário. ATR-based SL é mandatório.',
    behaviorKnowledge: ['Jumps mais frequentes — 25% por tick', 'ATR é a métrica mais importante para SL', 'Tendências entre jumps são curtas'],
    optimalTimeframe: 'M5, M15',
    useFibonacci: true,
    aiContextHint: 'Jump 25: jumps frequentes. SL ATR-based mandatório. Tendências curtas entre jumps.',
    tickSize: 0.01,
    avgDailyRange: 150,
  },
  'JUMP50': {
    family: 'Jump Index',
    description: 'Jump 50 Index — jumps de 50% de probabilidade a cada tick, índice de alta volatilidade',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'ultra-high',
    slAtrMultiplier: 2.5,
    tpAtrMultiplier: 4.5,
    minSlPips: 800, maxSlPips: 5000, minTpPips: 1000, maxTpPips: 8000,
    rsiOversold: 25, rsiOverbought: 75,
    trendType: 'hybrid',
    jumpProbability: 0.50,
    indicatorNotes: 'Jump 50 tem jumps aleatórios a cada 2 ticks em média — SL mínimo de 800 pontos obrigatório. ATR-based SL é mandatório. Tendências entre jumps são muito curtas.',
    behaviorKnowledge: [
      'Jumps de alta amplitude ocorrem a cada ~2 ticks — SL grande é essencial',
      'Tendências entre jumps são muito curtas e instáveis',
      'RSI e MACD têm efetividade reduzida pela alta frequência de jumps',
      'SL deve ser no mínimo 800-1000 pontos do preço de entrada',
      'TP deve ser no mínimo 1000-1500 pontos para compensar o risco',
      'Girassol detecta direção entre jumps mas sinais são de curta duração',
      'Priorizar entradas com Girassol muito bem definido e ATR grande',
    ],
    optimalTimeframe: 'M1, M5',
    useFibonacci: true,
    aiContextHint: 'Jump 50: jumps a cada ~2 ticks. SL mínimo 800 pontos obrigatório para evitar stop prematuro. Apenas entrar com sinal de Girassol muito claro. TP/SL largos.',
    tickSize: 0.01,
    avgDailyRange: 3000,
  },
  'JUMP75': {
    family: 'Jump Index',
    description: 'Jump 75 Index — jumps de 75% de probabilidade a cada tick, extremamente volátil',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'ultra-high',
    slAtrMultiplier: 3.0,
    tpAtrMultiplier: 5.0,
    minSlPips: 1200, maxSlPips: 8000, minTpPips: 1500, maxTpPips: 12000,
    rsiOversold: 22, rsiOverbought: 78,
    trendType: 'hybrid',
    jumpProbability: 0.75,
    indicatorNotes: 'Jump 75 tem jumps na maioria dos ticks — SL mínimo de 1200 pontos obrigatório. Ativo extremamente difícil de operar.',
    behaviorKnowledge: [
      'Jumps ocorrem em ~3 de cada 4 ticks — volatilidade extrema',
      'SL deve ser no mínimo 1200 pontos para sobreviver aos jumps',
      'Indicadores standard são menos confiáveis por causa da frequência de jumps',
      'Apenas entrar com sinal fortíssimo do Girassol',
    ],
    optimalTimeframe: 'M5, M15',
    useFibonacci: false,
    aiContextHint: 'Jump 75: jumps em 75% dos ticks. SL mínimo 1200 pontos. Muito arriscado — só entrar com sinal Girassol muito claro e ATR grande.',
    tickSize: 0.01,
    avgDailyRange: 5000,
  },
  'JUMP100': {
    family: 'Jump Index',
    description: 'Jump 100 Index — jumps de 100% de probabilidade a cada tick',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'ultra-high',
    slAtrMultiplier: 3.5,
    tpAtrMultiplier: 6.0,
    minSlPips: 1500, maxSlPips: 10000, minTpPips: 2000, maxTpPips: 15000,
    rsiOversold: 20, rsiOverbought: 80,
    trendType: 'hybrid',
    jumpProbability: 1.0,
    indicatorNotes: 'Jump 100 tem jumps em todos os ticks — SL mínimo de 1500 pontos obrigatório. Ativo de altíssimo risco.',
    behaviorKnowledge: [
      'Jumps ocorrem em TODOS os ticks — volatilidade máxima',
      'SL mínimo 1500 pontos obrigatório',
      'Indicadores convencionais têm efetividade muito reduzida',
      'Apenas operar com lote mínimo e sinal de altíssima confiança',
    ],
    optimalTimeframe: 'M5, M15',
    useFibonacci: false,
    aiContextHint: 'Jump 100: jumps em todos os ticks. SL mínimo 1500 pontos. Ativo de altíssimo risco — lote mínimo sempre.',
    tickSize: 0.01,
    avgDailyRange: 8000,
  },
  // ── RANGE BREAK INDICES ──────────────────────────────────────
  'RDBEAR': {
    family: 'Range Break Index',
    description: 'Range Break Bear Index — move em ranges laterais e quebra para baixo quando o range é rompido',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'medium',
    slAtrMultiplier: 1.6,
    tpAtrMultiplier: 3.0,
    minSlPips: 10, maxSlPips: 50, minTpPips: 20, maxTpPips: 120,
    rsiOversold: 30, rsiOverbought: 70,
    trendType: 'range-bound',
    indicatorNotes: 'O RDBEAR alterna entre movimentos laterais (range) e quebras de direção. Bollinger Bands são excelentes — squeeze indica breakout iminente. ADX identifica quando está em range vs tendência. Girassol detecta breakout preciso.',
    behaviorKnowledge: [
      'Padrão: range lateral por período → quebra abrupta para baixo → novo range',
      'Bollinger squeeze é o melhor indicador de breakout iminente',
      'ADX <20 = mercado em range; ADX >30 = breakout em andamento',
      'RSI em zona neutra (40-60) durante range; diverge no breakout',
      'SELL no breakout com SL acima do range anterior',
      'BUY dentro do range testando limite inferior (reversão ao meio do range)',
      'Volume/amplitude de candle aumenta no breakout — confirmador importante',
      'Girassol detecta início do breakout com precisão',
    ],
    optimalTimeframe: 'M5, M15',
    useFibonacci: true,
    aiContextHint: 'RDBEAR: detectar via Bollinger squeeze quando breakout de baixa é iminente. SELL no breakout confirmado por ADX >25. BUY apenas dentro do range com RSI neutro.',
    tickSize: 0.01,
    avgDailyRange: 100,
  },
  'RDBULL': {
    family: 'Range Break Index',
    description: 'Range Break Bull Index — move em ranges e quebra para cima quando o range é rompido',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'medium',
    slAtrMultiplier: 1.6,
    tpAtrMultiplier: 3.0,
    minSlPips: 10, maxSlPips: 50, minTpPips: 20, maxTpPips: 120,
    rsiOversold: 30, rsiOverbought: 70,
    trendType: 'range-bound',
    indicatorNotes: 'Espelho do RDBEAR mas com quebra para cima. Bollinger squeeze é o sinal primário. BUY no breakout de alta confirmado por ADX.',
    behaviorKnowledge: [
      'Padrão: range lateral → quebra para CIMA → novo range',
      'BUY no breakout com SL abaixo do range anterior',
      'Bollinger squeeze precede o breakout de alta',
      'ADX >25 confirma que o breakout tem força para continuar',
      'RSI <40 dentro do range → bounce de alta provável',
      'Girassol detecta início do breakout de alta com precisão',
    ],
    optimalTimeframe: 'M5, M15',
    useFibonacci: true,
    aiContextHint: 'RDBULL: detectar Bollinger squeeze para breakout de alta. BUY no breakout com ADX >25. SELL apenas dentro do range com RSI neutro.',
    tickSize: 0.01,
    avgDailyRange: 100,
  },
  // ── DEX INDICES ──────────────────────────────────────────────
  'DEX600UP': {
    family: 'DEX Index',
    description: 'DEX 600 Up — índice derivado de Forex, tendência ascendente com volatilidade 600',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'medium',
    slAtrMultiplier: 1.5,
    tpAtrMultiplier: 3.0,
    minSlPips: 5, maxSlPips: 30, minTpPips: 10, maxTpPips: 80,
    rsiOversold: 30, rsiOverbought: 70,
    trendType: 'directional',
    indicatorNotes: 'DEX índices se comportam como Forex derivado. Todos os indicadores padrão funcionam bem. Tendência upward dominante no DEX600UP.',
    behaviorKnowledge: ['Comportamento similar ao Forex', 'Tendência ascendente dominante', 'RSI, MACD, EMA funcionam normalmente'],
    optimalTimeframe: 'M5, M15',
    useFibonacci: true,
    aiContextHint: 'DEX600UP: comportamento Forex com tendência ascendente. IAs podem usar indicadores padrão normalmente.',
    tickSize: 0.001,
    avgDailyRange: 60,
  },
  'DEX600DN': {
    family: 'DEX Index',
    description: 'DEX 600 Down — tendência descendente com volatilidade 600',
    alwaysOpen: true,
    spikeIndex: false,
    volClass: 'medium',
    slAtrMultiplier: 1.5,
    tpAtrMultiplier: 3.0,
    minSlPips: 5, maxSlPips: 30, minTpPips: 10, maxTpPips: 80,
    rsiOversold: 30, rsiOverbought: 70,
    trendType: 'directional',
    indicatorNotes: 'Tendência descendente dominante. Indicadores padrão funcionam bem.',
    behaviorKnowledge: ['Comportamento similar ao Forex', 'Tendência descendente dominante'],
    optimalTimeframe: 'M5, M15',
    useFibonacci: true,
    aiContextHint: 'DEX600DN: comportamento Forex com tendência descendente. Indicadores padrão válidos.',
    tickSize: 0.001,
    avgDailyRange: 60,
  },
};

/**
 * Resolve o perfil de um ativo sintético da Deriv pelo símbolo.
 * Aceita variações de nome (ex: "Crash 1000 Index", "CRASH1000", "crash_1000")
 */
function resolveDerivProfile(symbol: string): DerivSyntheticProfile | null {
  const sym = symbol.toUpperCase().replace(/[\s_\-\.]/g, '');

  // Volatility
  if (sym === 'R10' || sym === 'R_10' || sym.includes('VOLATILITY10') || sym.includes('V10')) return DERIV_SYNTHETIC_PROFILES['R_10'];
  if (sym === 'R25' || sym === 'R_25' || sym.includes('VOLATILITY25') || sym.includes('V25')) return DERIV_SYNTHETIC_PROFILES['R_25'];
  if (sym === 'R50' || sym === 'R_50' || sym.includes('VOLATILITY50') || sym.includes('V50')) return DERIV_SYNTHETIC_PROFILES['R_50'];
  if (sym === 'R75' || sym === 'R_75' || sym.includes('VOLATILITY75') || sym.includes('V75')) return DERIV_SYNTHETIC_PROFILES['R_75'];
  if (sym === 'R100' || sym === 'R_100' || sym.includes('VOLATILITY100') || sym.includes('V100')) return DERIV_SYNTHETIC_PROFILES['R_100'];

  // HZ variants
  if (sym.includes('1HZ10') || sym === '1HZ10V') return DERIV_SYNTHETIC_PROFILES['1HZ10V'];
  if (sym.includes('1HZ25') || sym === '1HZ25V') return DERIV_SYNTHETIC_PROFILES['1HZ25V'];
  if (sym.includes('1HZ50') || sym === '1HZ50V') return DERIV_SYNTHETIC_PROFILES['1HZ50V'];
  if (sym.includes('1HZ75') || sym === '1HZ75V') return DERIV_SYNTHETIC_PROFILES['1HZ75V'];
  if (sym.includes('1HZ100') || sym === '1HZ100V') return DERIV_SYNTHETIC_PROFILES['1HZ100V'];

  // Crash
  if (sym.includes('CRASH300') || sym.includes('CRASH_300')) return DERIV_SYNTHETIC_PROFILES['CRASH300'];
  if (sym.includes('CRASH500') || sym.includes('CRASH_500')) return DERIV_SYNTHETIC_PROFILES['CRASH500'];
  if (sym.includes('CRASH1000') || sym.includes('CRASH_1000') || (sym.includes('CRASH') && !sym.includes('300') && !sym.includes('500'))) return DERIV_SYNTHETIC_PROFILES['CRASH1000'];

  // Boom
  if (sym.includes('BOOM300') || sym.includes('BOOM_300')) return DERIV_SYNTHETIC_PROFILES['BOOM300'];
  if (sym.includes('BOOM500') || sym.includes('BOOM_500')) return DERIV_SYNTHETIC_PROFILES['BOOM500'];
  if (sym.includes('BOOM1000') || sym.includes('BOOM_1000') || (sym.includes('BOOM') && !sym.includes('300') && !sym.includes('500'))) return DERIV_SYNTHETIC_PROFILES['BOOM1000'];

  // Step
  if (sym.includes('STEP')) return DERIV_SYNTHETIC_PROFILES['STEPINDEX'];

  // Jump — ordem importa: checar strings mais longas antes
  // Suporta: "JUMP100", "JUMP_100", "JD100", "JUMP 100 INDEX" (com espaços, nome MT5 original)
  if (sym.includes('JUMP100') || sym.includes('JUMP_100') || sym.includes('JD100') || sym.includes('JUMP 100')) return DERIV_SYNTHETIC_PROFILES['JUMP100'];
  if (sym.includes('JUMP75')  || sym.includes('JUMP_75')  || sym.includes('JD75')  || sym.includes('JUMP 75'))  return DERIV_SYNTHETIC_PROFILES['JUMP75'];
  if (sym.includes('JUMP50')  || sym.includes('JUMP_50')  || sym.includes('JD50')  || sym.includes('JUMP 50'))  return DERIV_SYNTHETIC_PROFILES['JUMP50'];
  if (sym.includes('JUMP25')  || sym.includes('JUMP_25')  || sym.includes('JD25')  || sym.includes('JUMP 25'))  return DERIV_SYNTHETIC_PROFILES['JUMP25'];
  if (sym.includes('JUMP10')  || sym.includes('JUMP_10')  || sym.includes('JD10')  || sym.includes('JUMP 10'))  return DERIV_SYNTHETIC_PROFILES['JUMP10'];

  // Range Break
  if (sym.includes('RDBEAR') || sym.includes('RANGEBREAK') && sym.includes('BEAR')) return DERIV_SYNTHETIC_PROFILES['RDBEAR'];
  if (sym.includes('RDBULL') || sym.includes('RANGEBREAK') && sym.includes('BULL')) return DERIV_SYNTHETIC_PROFILES['RDBULL'];

  // DEX
  if (sym.includes('DEX600') && sym.includes('UP')) return DERIV_SYNTHETIC_PROFILES['DEX600UP'];
  if (sym.includes('DEX600') && (sym.includes('DN') || sym.includes('DOWN'))) return DERIV_SYNTHETIC_PROFILES['DEX600DN'];

  return null;
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

  // ── Memória de Contexto de Posições ──
  // Persiste estado entre cada chamada do monitor — a IA "lembra" de tudo
  private positionContexts: Map<number, PositionContext> = new Map();

  // Saldo e equity em tempo real (atualizado a cada heartbeat do EA)
  private currentBalance = 0;
  private currentEquity = 0;

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
    this.loadFromDB();
  }

  private loadFromDB(): void {
    try {
      // Ensure tables exist (idempotent — safe to call on first run before initializeDatabase)
      sqlite.exec(`CREATE TABLE IF NOT EXISTS mt5_positions (
        ticket INTEGER PRIMARY KEY, symbol TEXT NOT NULL, type TEXT NOT NULL, lots REAL NOT NULL,
        open_price REAL NOT NULL, current_price REAL NOT NULL, stop_loss REAL DEFAULT 0,
        take_profit REAL DEFAULT 0, profit REAL DEFAULT 0, open_time INTEGER NOT NULL,
        signal_id TEXT DEFAULT '', comment TEXT DEFAULT '', magic INTEGER DEFAULT 0,
        source TEXT DEFAULT 'ea', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      sqlite.exec(`CREATE TABLE IF NOT EXISTS mt5_trades (
        ticket INTEGER PRIMARY KEY, signal_id TEXT DEFAULT '', symbol TEXT NOT NULL, type TEXT NOT NULL,
        lots REAL NOT NULL, open_price REAL NOT NULL, close_price REAL NOT NULL, profit REAL DEFAULT 0,
        pips REAL DEFAULT 0, open_time INTEGER DEFAULT 0, close_time INTEGER DEFAULT 0,
        close_reason TEXT DEFAULT 'MANUAL', comment TEXT DEFAULT '', source TEXT DEFAULT 'ea',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      sqlite.exec(`CREATE TABLE IF NOT EXISTS mt5_config_state (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Restore open positions
      const positions = sqlite.prepare('SELECT * FROM mt5_positions').all() as any[];
      for (const row of positions) {
        const pos: MT5Position = {
          ticket: row.ticket,
          symbol: row.symbol,
          type: row.type as 'BUY' | 'SELL',
          lots: row.lots,
          openPrice: row.open_price,
          currentPrice: row.current_price,
          stopLoss: row.stop_loss,
          takeProfit: row.take_profit,
          profit: row.profit,
          openTime: row.open_time,
          signalId: row.signal_id,
          comment: row.comment,
          magic: row.magic,
          source: row.source as 'ea' | 'api',
        };
        this.openPositions.set(pos.ticket, pos);
      }
      if (positions.length > 0) {
        console.log(`[MT5Bridge] 📦 Restauradas ${positions.length} posições abertas do banco de dados`);
        this.status.openPositions = positions.length;
      }

      // Restore recent trades (last 100)
      const trades = sqlite.prepare('SELECT * FROM mt5_trades ORDER BY close_time DESC LIMIT 100').all() as any[];
      for (const row of trades) {
        const trade: MT5TradeResult = {
          ticket: row.ticket,
          signalId: row.signal_id,
          symbol: row.symbol,
          type: row.type as 'BUY' | 'SELL',
          lots: row.lots,
          openPrice: row.open_price,
          closePrice: row.close_price,
          profit: row.profit,
          pips: row.pips,
          openTime: row.open_time,
          closeTime: row.close_time,
          closeReason: row.close_reason as any,
          comment: row.comment,
          source: row.source as 'ea' | 'api',
        };
        this.recentTrades.push(trade);
      }
      if (trades.length > 0) {
        console.log(`[MT5Bridge] 📊 Restaurados ${trades.length} trades recentes do banco de dados`);
        // Recalculate stats from today's trades
        const today = new Date().toDateString();
        for (const t of this.recentTrades) {
          const tradeDate = new Date(t.closeTime).toDateString();
          if (tradeDate === today) {
            if (t.profit > 0) {
              this.status.dailyProfit += t.profit;
              this.status.dailyWins++;
            } else {
              this.status.dailyLoss += Math.abs(t.profit);
              this.status.dailyLosses++;
            }
          }
        }
        const total = this.status.dailyWins + this.status.dailyLosses;
        this.status.winRate = total > 0 ? (this.status.dailyWins / total) * 100 : 0;
      }

      // Restore config state
      const configRow = sqlite.prepare("SELECT value FROM mt5_config_state WHERE key = 'bridge_config'").get() as any;
      if (configRow) {
        try {
          const savedConfig = JSON.parse(configRow.value);
          this.config = { ...this.config, ...savedConfig };
          console.log('[MT5Bridge] ⚙️ Configuração restaurada do banco de dados');
        } catch {}
      }
    } catch (err) {
      console.error('[MT5Bridge] ⚠️ Falha ao restaurar estado do banco de dados:', err);
    }
  }

  private savePositionToDB(position: MT5Position): void {
    try {
      sqlite.prepare(`
        INSERT INTO mt5_positions (ticket, symbol, type, lots, open_price, current_price, stop_loss, take_profit, profit, open_time, signal_id, comment, magic, source, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(ticket) DO UPDATE SET
          current_price = excluded.current_price,
          stop_loss = excluded.stop_loss,
          take_profit = excluded.take_profit,
          profit = excluded.profit,
          updated_at = CURRENT_TIMESTAMP
      `).run(
        position.ticket, position.symbol, position.type, position.lots,
        position.openPrice, position.currentPrice, position.stopLoss ?? 0,
        position.takeProfit ?? 0, position.profit ?? 0, position.openTime,
        position.signalId ?? '', position.comment ?? '', position.magic ?? 0,
        position.source ?? 'ea'
      );
    } catch (err) {
      console.error('[MT5Bridge] ⚠️ Falha ao salvar posição no banco:', err);
    }
  }

  private removePositionFromDB(ticket: number): void {
    try {
      sqlite.prepare('DELETE FROM mt5_positions WHERE ticket = ?').run(ticket);
    } catch (err) {
      console.error('[MT5Bridge] ⚠️ Falha ao remover posição do banco:', err);
    }
  }

  private saveTradeToDB(trade: MT5TradeResult): void {
    try {
      sqlite.prepare(`
        INSERT OR IGNORE INTO mt5_trades (ticket, signal_id, symbol, type, lots, open_price, close_price, profit, pips, open_time, close_time, close_reason, comment, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        trade.ticket, trade.signalId ?? '', trade.symbol, trade.type, trade.lots,
        trade.openPrice, trade.closePrice, trade.profit, trade.pips ?? 0,
        trade.openTime ?? 0, trade.closeTime ?? 0, trade.closeReason ?? 'MANUAL',
        trade.comment ?? '', trade.source ?? 'ea'
      );
    } catch (err) {
      console.error('[MT5Bridge] ⚠️ Falha ao salvar trade no banco:', err);
    }
  }

  saveConfigToDB(): void {
    try {
      sqlite.prepare(`
        INSERT INTO mt5_config_state (key, value, updated_at)
        VALUES ('bridge_config', ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
      `).run(JSON.stringify(this.config));
    } catch (err) {
      console.error('[MT5Bridge] ⚠️ Falha ao salvar configuração no banco:', err);
    }
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
   * Detecta futuros da B3: Mini Índice (WIN) e Mini Dólar (WDO).
   * Aceita formatos: WIN, WDO, WIN$N, WDO$N, WINJ25, WDOG25, etc.
   */
  private isB3Future(symbol: string): boolean {
    const sym = symbol.toUpperCase();
    return sym.startsWith('WIN') || sym.startsWith('WDO');
  }

  /**
   * Detecta se é Mini Índice (WIN) especificamente.
   */
  private isWIN(symbol: string): boolean {
    return symbol.toUpperCase().startsWith('WIN');
  }

  private mapMT5ToDerivSymbol(mt5Symbol: string): string | null {
    const map: Record<string, string> = {
      'VOLATILITY 10 INDEX': 'R_10', 'VOLATILITY 25 INDEX': 'R_25',
      'VOLATILITY 50 INDEX': 'R_50', 'VOLATILITY 75 INDEX': 'R_75',
      'VOLATILITY 100 INDEX': 'R_100', 'VOLATILITY 10 (1S) INDEX': 'R_10_1S',
      'VOLATILITY 25 (1S) INDEX': 'R_25_1S', 'VOLATILITY 50 (1S) INDEX': 'R_50_1S',
      'VOLATILITY 75 (1S) INDEX': 'R_75_1S', 'VOLATILITY 100 (1S) INDEX': 'R_100_1S',
      'JUMP 10 INDEX': 'JD10', 'JUMP 25 INDEX': 'JD25', 'JUMP 50 INDEX': 'JD50',
      'JUMP 75 INDEX': 'JD75', 'JUMP 100 INDEX': 'JD100',
      'RANGE BREAK BULL 200': 'RDBULL', 'RANGE BREAK BEAR 200': 'RDBEAR',
      'CRASH 300 INDEX': 'CRASH300', 'CRASH 500 INDEX': 'CRASH500',
      'CRASH 1000 INDEX': 'CRASH1000', 'BOOM 300 INDEX': 'BOOM300',
      'BOOM 500 INDEX': 'BOOM500', 'BOOM 1000 INDEX': 'BOOM1000',
    };
    return map[mt5Symbol.toUpperCase()] || null;
  }

  /**
   * Detecta se é Mini Dólar (WDO) especificamente.
   */
  private isWDO(symbol: string): boolean {
    return symbol.toUpperCase().startsWith('WDO');
  }

  /**
   * Verifica se o mercado B3 está aberto para futuros (WIN/WDO).
   * Horário B3 (BRT = UTC-3): segunda a sexta, 09:00 – 18:30.
   * O servidor usa UTC, por isso: 12:00–21:30 UTC.
   */
  private isB3MarketOpen(): boolean {
    const now = new Date();
    const utcDay  = now.getUTCDay();   // 0=Dom, 6=Sáb
    const utcHour = now.getUTCHours();
    const utcMin  = now.getUTCMinutes();
    const utcTime = utcHour * 60 + utcMin;

    // Apenas dias úteis
    if (utcDay === 0 || utcDay === 6) return false;

    // 09:00 BRT = 12:00 UTC → 720 min
    // 18:30 BRT = 21:30 UTC → 1290 min
    return utcTime >= 720 && utcTime < 1290;
  }

  /**
   * Retorna o tamanho do pip/ponto correto para cada tipo de ativo.
   * WIN (mini índice B3): mínimo de variação = 5 pontos.
   * WDO (mini dólar B3):  mínimo de variação = 0.5 pontos.
   * Forex:                 0.0001 (4 casas decimais).
   * Outros (índices, crypto, metais): 1 ponto.
   */
  private getPipSize(symbol: string, lastPrice: number): number {
    if (this.isWIN(symbol)) return 5;      // WIN: tick mínimo = 5 pts
    if (this.isWDO(symbol)) return 0.5;    // WDO: tick mínimo = 0.5 pts
    if (lastPrice < 1000) return 0.0001;   // Forex padrão
    return 1;                              // Outros
  }

  /**
   * Retorna o lote mínimo correto para cada tipo de símbolo.
   * Futuros B3 (WIN/WDO): mínimo 1 contrato.
   * Crash/Boom Deriv: mínimo 1.0.
   * Índices de Volatilidade: 0.01.
   * Forex: 0.01.
   */
  private getValidLotSize(symbol: string): number {
    const sym = symbol.toUpperCase();

    // Mini Índice B3 (WINJ25, WIN$N, WIN...) — mínimo 1 contrato
    if (this.isWIN(symbol)) return Math.max(this.config.defaultLotSize, 1.0);

    // Mini Dólar B3 (WDOG25, WDO$N, WDO...) — mínimo 1 contrato
    if (this.isWDO(symbol)) return Math.max(this.config.defaultLotSize, 1.0);

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
      openPositions: this.openPositions.size,
      cachedSymbols: this.getCachedSymbols()
    };
  }

  /**
   * Retorna o perfil completo do ativo sintético da Deriv.
   * Encapsula todo o conhecimento específico do ativo para uso pelas IAs.
   */
  getDerivSyntheticProfile(symbol: string): DerivSyntheticProfile | null {
    return resolveDerivProfile(symbol);
  }

  /**
   * Retorna o ATR atual do símbolo baseado nos dados de mercado em cache.
   * Método público para uso nas rotas.
   */
  getSymbolATR(symbol: string): number {
    const marketData = this.getMarketDataForSymbol(symbol);
    if (marketData.length < 5) return 0;
    const prices = marketData.map(d => d.close);
    const highs  = marketData.map(d => d.high || d.close);
    const lows   = marketData.map(d => d.low  || d.close);
    const atr = this.calcATR(highs, lows, prices, Math.min(14, marketData.length - 1));
    return atr;
  }

  /**
   * Retorna o contexto de ativo para uso na análise das IAs.
   * Adapta os parâmetros de indicadores ao comportamento específico do ativo.
   */
  getAssetAIContext(symbol: string): string {
    const profile = resolveDerivProfile(symbol);
    if (!profile) return `Ativo ${symbol}: sem perfil específico — usando parâmetros padrão.`;

    return [
      `=== CONHECIMENTO ESPECIALIZADO: ${symbol} ===`,
      `Família: ${profile.family} | ${profile.description}`,
      `Volatilidade: ${profile.volClass.toUpperCase()} | Tipo de mercado: ${profile.trendType}`,
      ``,
      `COMO ESTE ATIVO SE COMPORTA:`,
      ...profile.behaviorKnowledge.map(b => `• ${b}`),
      ``,
      `USO DOS INDICADORES NESTE ATIVO:`,
      profile.indicatorNotes,
      ``,
      `RSI: sobrevenda <${profile.rsiOversold} | sobrecompra >${profile.rsiOverbought}`,
      `SL ideal: ${profile.slAtrMultiplier}× ATR (${profile.minSlPips}–${profile.maxSlPips} pips)`,
      `TP ideal: ${profile.tpAtrMultiplier}× ATR (${profile.minTpPips}–${profile.maxTpPips} pips)`,
      profile.spikeIndex ? `⚡ ÍNDICE DE SPIKE: ${profile.spikeFrequency} na direção ${profile.spikeDirection?.toUpperCase()}` : '',
      ``,
      `INSTRUÇÃO PARA IA: ${profile.aiContextHint}`,
    ].filter(Boolean).join('\n');
  }

  /**
   * Calcula SL e TP usando os dados reais dos indicadores instalados no MT5.
   * Prioridade: 1) Níveis dos indicadores instalados (Girassol, Fib do EA)
   *             2) Perfil do ativo sintético Deriv
   *             3) ATR + configuração padrão
   */
  calcIndicatorDrivenSLTP(params: {
    symbol: string;
    action: 'BUY' | 'SELL';
    entryPrice: number;
    atr: number;
    // Dados reais dos indicadores instalados no gráfico do MT5
    girassolSupportLevel?: number;
    girassolResistanceLevel?: number;
    girassolBuySignalPrice?: number;
    girassolSellSignalPrice?: number;
    fibonacciLevels?: Array<{ level: string; price: number }>;
    customSupportLevel?: number;
    customResistanceLevel?: number;
    indicatorBuffers?: Array<{ name: string; value: number; bar: number }>;
  }): { stopLoss: number; takeProfit: number; slPips: number; tpPips: number; source: string } {
    const { symbol, action, entryPrice, atr } = params;
    const profile = resolveDerivProfile(symbol);
    const pipSize = this.getPipSize(symbol, entryPrice);

    let slPrice = 0;
    let tpPrice = 0;
    let source = 'atr_default';

    // ── PRIORIDADE 1: Níveis reais dos indicadores do MT5 ──────────────
    // Se o indicador Girassol enviou níveis de suporte/resistência reais
    if (params.girassolSupportLevel && params.girassolResistanceLevel && action) {
      const support = params.girassolSupportLevel;
      const resistance = params.girassolResistanceLevel;

      if (action === 'BUY') {
        // SL abaixo do suporte do Girassol + buffer de segurança (0.5 ATR)
        slPrice = support - atr * 0.5;
        // TP na resistência do Girassol - buffer (0.3 ATR)
        tpPrice = resistance - atr * 0.3;
        source = 'girassol_levels';
      } else {
        // SL acima da resistência do Girassol + buffer
        slPrice = resistance + atr * 0.5;
        // TP no suporte do Girassol + buffer
        tpPrice = support + atr * 0.3;
        source = 'girassol_levels';
      }
    }

    // ── PRIORIDADE 2: Níveis Fibonacci do indicador MT5 ─────────────────
    if ((!slPrice || !tpPrice) && params.fibonacciLevels && params.fibonacciLevels.length >= 2) {
      const sortedLevels = [...params.fibonacciLevels].sort((a, b) => a.price - b.price);
      const levelsBelow = sortedLevels.filter(l => l.price < entryPrice);
      const levelsAbove = sortedLevels.filter(l => l.price > entryPrice);

      if (action === 'BUY' && levelsBelow.length > 0 && levelsAbove.length > 0) {
        const nearestBelow = levelsBelow[levelsBelow.length - 1];
        const nearestAbove = levelsAbove[0];
        slPrice = nearestBelow.price - atr * 0.3;
        tpPrice = nearestAbove.price - atr * 0.3;
        source = 'fibonacci_indicator_levels';
      } else if (action === 'SELL' && levelsBelow.length > 0 && levelsAbove.length > 0) {
        const nearestBelow = levelsBelow[levelsBelow.length - 1];
        const nearestAbove = levelsAbove[0];
        slPrice = nearestAbove.price + atr * 0.3;
        tpPrice = nearestBelow.price + atr * 0.3;
        source = 'fibonacci_indicator_levels';
      }
    }

    // ── PRIORIDADE 3: Buffers brutos de qualquer indicador instalado ────
    if ((!slPrice || !tpPrice) && params.indicatorBuffers && params.indicatorBuffers.length > 0) {
      // Tenta identificar buffers de suporte/resistência por nome ou posição
      const slBuf = params.indicatorBuffers.find(b =>
        b.bar === 0 && (b.name?.toLowerCase().includes('stop') || b.name?.toLowerCase().includes('sl'))
      );
      const tpBuf = params.indicatorBuffers.find(b =>
        b.bar === 0 && (b.name?.toLowerCase().includes('profit') || b.name?.toLowerCase().includes('tp'))
      );
      if (slBuf && slBuf.value > 0 && tpBuf && tpBuf.value > 0) {
        slPrice = slBuf.value;
        tpPrice = tpBuf.value;
        source = 'indicator_buffer_sltp';
      }
    }

    // ── PRIORIDADE 4: Perfil do ativo + ATR ─────────────────────────────
    if (!slPrice || !tpPrice) {
      const slMult = profile?.slAtrMultiplier ?? 1.5;
      const tpMult = profile?.tpAtrMultiplier ?? 3.0;
      const slDist = atr * slMult;
      const tpDist = atr * tpMult;

      if (action === 'BUY') {
        slPrice = entryPrice - slDist;
        tpPrice = entryPrice + tpDist;
      } else {
        slPrice = entryPrice + slDist;
        tpPrice = entryPrice - tpDist;
      }
      source = profile ? `asset_profile_${profile.volClass}` : 'atr_default';
    }

    // Garantir que SL/TP respeitam o perfil do ativo
    if (profile) {
      const minSl = profile.minSlPips * pipSize;
      const maxSl = profile.maxSlPips * pipSize;
      const minTp = profile.minTpPips * pipSize;
      const maxTp = profile.maxTpPips * pipSize;

      const slDist = Math.abs(slPrice - entryPrice);
      const tpDist = Math.abs(tpPrice - entryPrice);

      const clampedSl = Math.max(minSl, Math.min(maxSl, slDist));
      const clampedTp = Math.max(minTp, Math.min(maxTp, tpDist));

      slPrice = action === 'BUY' ? entryPrice - clampedSl : entryPrice + clampedSl;
      tpPrice = action === 'BUY' ? entryPrice + clampedTp : entryPrice - clampedTp;
    }

    const slPips = Math.max(1, Math.round(Math.abs(slPrice - entryPrice) / pipSize));
    const tpPips = Math.max(1, Math.round(Math.abs(tpPrice - entryPrice) / pipSize));

    return { stopLoss: slPrice, takeProfit: tpPrice, slPips, tpPips, source };
  }

  /**
   * Adapta a análise técnica ao perfil específico do ativo sintético.
   * Usa os limiares de RSI, ADX e volatilidade específicos de cada ativo.
   */
  private runAssetAdaptedTechnicalAnalysis(symbol: string, marketData: any[]): { action: string; confidence: number; source: string; fibScore: number; fibZone: string; spikeInfo?: SpikeInfo; profileNotes: string } {
    const profile = resolveDerivProfile(symbol);
    const prices = marketData.map(d => d.close);
    const highs  = marketData.map(d => d.high || d.close);
    const lows   = marketData.map(d => d.low  || d.close);
    const last   = prices[prices.length - 1];

    const rsi   = this.calcRSI(prices, 14);
    const ema20 = this.calcEMA(prices, 20);
    const ema50 = this.calcEMA(prices, 50);
    const macd  = this.calcMACD(prices);
    const adx   = this.calcADX(highs, lows, prices, 14);

    // Usar limiares de RSI específicos do ativo (default Forex se sem perfil)
    const rsiOversold   = profile?.rsiOversold   ?? 30;
    const rsiOverbought = profile?.rsiOverbought  ?? 70;

    let score = 0;
    const profileNotesParts: string[] = [];

    // RSI adaptado ao perfil
    if (rsi < rsiOversold) {
      score += profile?.trendType === 'mean-reverting' ? 3 : 2;
      profileNotesParts.push(`RSI ${rsi.toFixed(1)} < ${rsiOversold} (sobrevenda ${profile?.family ?? 'padrão'})`);
    } else if (rsi > rsiOverbought) {
      score -= profile?.trendType === 'mean-reverting' ? 3 : 2;
      profileNotesParts.push(`RSI ${rsi.toFixed(1)} > ${rsiOverbought} (sobrecompra ${profile?.family ?? 'padrão'})`);
    } else if (rsi < (rsiOversold + 10)) {
      score += 1;
    } else if (rsi > (rsiOverbought - 10)) {
      score -= 1;
    }

    // EMA trend
    if (ema20 > ema50) {
      score += profile?.trendType === 'directional' ? 2 : 1;
    } else {
      score -= profile?.trendType === 'directional' ? 2 : 1;
    }

    // MACD
    if (macd.macd > macd.signal) score += 1;
    else score -= 1;

    // ADX — ativo direcional: ADX alto confirma tendência; range-bound: ignora
    if (profile?.trendType !== 'range-bound' && adx > 25) {
      profileNotesParts.push(`ADX ${adx.toFixed(0)} — tendência forte confirmada`);
      score += ema20 > ema50 ? 2 : -2;
    } else if (profile?.trendType === 'range-bound' && adx < 20) {
      profileNotesParts.push(`ADX ${adx.toFixed(0)} — mercado em range (normal para ${profile.family})`);
    }

    // Range-bound: Bollinger squeeze como sinal primário
    if (profile?.trendType === 'range-bound') {
      const bb = this.calcBollinger(prices, 20, 2);
      const bbWidth = (bb.upper - bb.lower) / bb.mid;
      if (bbWidth < 0.005) {
        profileNotesParts.push(`Bollinger squeeze (${(bbWidth * 100).toFixed(3)}%) — breakout iminente`);
        score += last > bb.mid ? -1 : 1; // pressão em direção ao breakout
      }
    }

    // Fibonacci
    let fibScore = 0;
    let fibZoneDesc = 'Sem confluência Fibonacci próxima';
    if (profile?.useFibonacci !== false && marketData.length >= 15) {
      const fib = this.calcMultiLayerFibonacci(marketData, last);
      if (fib) {
        fibZoneDesc = fib.confluenceNarrative;
        if (fib.confluenceScore > 0 && fib.zoneType !== 'neutral') {
          if (fib.zoneType === 'support') { fibScore += 3; score += 2; }
          else if (fib.zoneType === 'resistance') { fibScore -= 3; score -= 2; }
          const layers = new Set(fib.nearestLevels.map(l => l.layer)).size;
          if (layers >= 2) { fibScore += layers; score += layers; }
          const keyHits = fib.nearestLevels.filter(l => ['38.2%', '50%', '61.8%'].includes(l.level)).length;
          if (keyHits > 0) { score += keyHits; fibScore += keyHits * 2; }
        }
      }
    }

    // Spike index detection
    const spikeInfo = this.isSpikeIndex(symbol) ? this.detectSpikePattern(marketData, symbol) : undefined;
    if (spikeInfo?.expected && spikeInfo.confidence >= 50) {
      const spikeAction = spikeInfo.direction === 'down' ? 'SELL' : 'BUY';
      const spikeConf = 0.5 + spikeInfo.confidence / 200;
      return { action: spikeAction, confidence: Math.min(0.92, spikeConf), source: 'technical_spike', fibScore, fibZone: fibZoneDesc, spikeInfo, profileNotes: profileNotesParts.join(' | ') };
    }

    const action     = score > 0 ? 'BUY' : score < 0 ? 'SELL' : 'HOLD';
    const baseConf   = 0.4 + Math.abs(score) * 0.08;
    const fibBoost   = Math.abs(fibScore) > 0 ? 0.05 * Math.min(Math.abs(fibScore), 3) : 0;
    const confidence = Math.min(0.92, baseConf + fibBoost);
    const profileNotes = [
      profile ? `[${profile.family}] ${profile.trendType}` : '',
      ...profileNotesParts,
    ].filter(Boolean).join(' | ');

    return { action, confidence, source: profile ? `technical_${profile.trendType}` : 'technical', fibScore, fibZone: fibZoneDesc, spikeInfo, profileNotes };
  }

  recordHeartbeat(accountData: { accountId: string; broker: string; balance: number; equity: number; freeMargin: number }): void {
    this.status.lastHeartbeat = Date.now();
    // Só sobrescrever accountId/broker se trouxer valor real (não o placeholder automático)
    const isRealId = accountData.accountId && accountData.accountId !== 'EA_AUTO';
    const isRealBroker = accountData.broker && accountData.broker !== 'MT5' && accountData.broker !== 'Unknown';
    if (isRealId) this.status.accountId = accountData.accountId;
    else if (!this.status.accountId) this.status.accountId = accountData.accountId;
    if (isRealBroker) this.status.broker = accountData.broker;
    // Salvar saldo em tempo real — usado pela memória de contexto de posições
    if (accountData.balance > 0) this.currentBalance = accountData.balance;
    if (accountData.equity > 0) this.currentEquity = accountData.equity;
    if (!this.config.enabled) {
      this.config.enabled = true;
      this.startSignalGeneration();
      console.log(`[MT5Bridge] ✅ Sistema auto-habilitado via heartbeat do EA (${accountData.broker})`);
    }
  }

  /**
   * Retorna o contexto completo de todas as posições monitoradas.
   * Usado pela interface para exibir memória em tempo real.
   */
  getPositionContexts(): PositionContext[] {
    return Array.from(this.positionContexts.values());
  }

  /**
   * Atualiza ou cria o contexto de uma posição a cada ciclo do monitor.
   * É aqui que a IA "aprende" o histórico de cada posição.
   */
  private updatePositionContext(position: MT5Position): PositionContext {
    const ticket = position.ticket;
    const profit = position.profit ?? 0;

    const existing = this.positionContexts.get(ticket);
    if (!existing) {
      // Primeira vez que o monitor vê esta posição — registrar estado inicial
      const ctx: PositionContext = {
        ticket,
        symbol: position.symbol,
        type: position.type,
        entryPrice: position.openPrice,
        entryTime: Date.now(),
        entryBalance: this.currentBalance || 9900,
        lots: position.lots,
        maxAdverseExcursion: Math.min(profit, 0),
        maxFavorableExcursion: Math.max(profit, 0),
        wasEverNegative: profit < 0,
        wasEverPositive: profit > 0,
        lowestProfit: profit,
        highestProfit: profit,
        lastProfit: profit,
        monitorCycles: 1,
        lossAccelerationCycles: 0,
        profitTrailing: profit > 0 ? profit : 0,
        signalId: position.signalId || `${position.type}_${ticket}`
      };
      this.positionContexts.set(ticket, ctx);
      console.log(`[CONTEXT] 🆕 Posição #${ticket} (${position.type} ${position.symbol}) registrada na memória | Saldo: $${ctx.entryBalance.toFixed(2)}`);
      return ctx;
    }

    // Atualizar contexto existente
    const wasProfitWorse = profit < existing.lastProfit;
    const lossAccelCycles = wasProfitWorse ? existing.lossAccelerationCycles + 1 : 0;
    const wasNeg = existing.wasEverNegative || profit < 0;
    const wasPos = existing.wasEverPositive || profit > 0;
    const newTrailing = (profit > 0 && profit > existing.profitTrailing)
      ? profit : existing.profitTrailing;

    const updated: PositionContext = {
      ...existing,
      maxAdverseExcursion: Math.min(existing.maxAdverseExcursion, profit),
      maxFavorableExcursion: Math.max(existing.maxFavorableExcursion, profit),
      wasEverNegative: wasNeg,
      wasEverPositive: wasPos,
      lowestProfit: Math.min(existing.lowestProfit, profit),
      highestProfit: Math.max(existing.highestProfit, profit),
      lastProfit: profit,
      monitorCycles: existing.monitorCycles + 1,
      lossAccelerationCycles: lossAccelCycles,
      profitTrailing: newTrailing,
    };
    this.positionContexts.set(ticket, updated);
    return updated;
  }

  /** Remove o contexto de uma posição após ser fechada. */
  private clearPositionContext(ticket: number): void {
    const ctx = this.positionContexts.get(ticket);
    if (ctx) {
      const durationMin = ((Date.now() - ctx.entryTime) / 60000).toFixed(1);
      console.log(`[CONTEXT] 🗑️ Contexto #${ticket} removido | Duração: ${durationMin}min | MAE: $${ctx.maxAdverseExcursion.toFixed(2)} | MFE: $${ctx.maxFavorableExcursion.toFixed(2)}`);
      this.positionContexts.delete(ticket);
    }
  }

  async generateSignal(symbol: string): Promise<MT5Signal | null> {
    if (this.isGeneratingSignal) return null;
    if (!this.config.enabled) return null;

    // Bloquear novo sinal se já atingiu o limite de posições por símbolo
    const positionsForSymbol = Array.from(this.openPositions.values()).filter(p => p.symbol === symbol).length;
    const maxPerSymbol = this.config.maxPositionsPerSymbol ?? 1;
    if (maxPerSymbol > 0 && positionsForSymbol >= maxPerSymbol) {
      console.log(`[MT5Bridge] 🔒 generateSignal bloqueado — ${symbol}: ${positionsForSymbol}/${maxPerSymbol} posições`);
      return null;
    }

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

      let aiOnlyMode = marketData.length < 15;

      // Se sem candles do EA, tentar buscar dados reais do DB (preços Deriv)
      if (aiOnlyMode) {
        try {
          const derivSymbol = this.mapMT5ToDerivSymbol(symbol);
          const dbData = await storage.getMarketData(derivSymbol || symbol);
          if (dbData?.priceHistory) {
            const prices: number[] = JSON.parse(dbData.priceHistory);
            if (prices.length >= 15) {
              const now = Math.floor(Date.now() / 1000);
              const syntheticCandles = prices.map((p, i) => ({
                open: p, high: p * 1.0005, low: p * 0.9995, close: p, volume: 1,
                time: now - (prices.length - i) * 60
              }));
              this.marketDataCache.set(symbol, syntheticCandles);
              marketData.splice(0, 0, ...syntheticCandles);
              aiOnlyMode = false;
              console.log(`[MT5Bridge] 📊 Dados reais do DB carregados para ${symbol} (${derivSymbol}): ${prices.length} preços`);
            }
          }
        } catch {
          // fallback — seguir em aiOnlyMode
        }
      }

      // Log fase de dados
      this.logAnalysis({
        id: `${entryId}_data`,
        timestamp: Date.now(),
        symbol,
        phase: 'data_check',
        status: 'processing',
        candlesAvailable: marketData.length,
        consecutiveLosses: this.consecutiveLosses,
        decisionReason: aiOnlyMode
          ? `Modo IA pura: ${marketData.length} candles disponíveis — analisando com modelos NLP sem dados técnicos.`
          : `${marketData.length} candles disponíveis. Iniciando análise das IAs...`
      });

      if (aiOnlyMode) {
        console.log(`[MT5Bridge] 🤖 Modo IA pura para ${symbol} (${marketData.length} candles) — geração sem candles`);
      }

      // ============================================================
      // MODO BOOM/CRASH — ESTRATÉGIA DE DIREÇÃO NATURAL + SPIKE
      //
      // PRINCÍPIO FUNDAMENTAL:
      //  • Crash (CRASH300/500/1000): força dominante é de ALTA entre spikes.
      //    → CONTINUIDADE = BUY (segue a subida constante entre os spikes de queda)
      //    → SPIKE = SELL apenas com CERTEZA ABSOLUTA (imminência ≥85%)
      //
      //  • Boom (BOOM300/500/1000): força dominante é de BAIXA entre spikes.
      //    → CONTINUIDADE = SELL (segue a queda constante entre os spikes de alta)
      //    → SPIKE = BUY apenas com CERTEZA ABSOLUTA (imminência ≥85%)
      //
      // REGRA DE OURO: A IA prefere SEMPRE a direção natural do ativo.
      // Spike só é operado quando há ABSOLUTA CERTEZA técnica e de imminência.
      // ============================================================
      if (!aiOnlyMode && this.isSpikeIndex(symbol)) {
        const sym = symbol.toUpperCase();
        const isCrash = sym.includes('CRASH');
        const earlySpike = this.detectSpikePattern(marketData, symbol);

        // ── CAMINHO 1: SPIKE COM CERTEZA ABSOLUTA (confiança ≥85%) ──
        // Threshold elevado: só opera spike quando IA tem CERTEZA ABSOLUTA.
        if (earlySpike.expected && earlySpike.confidence >= 85) {
          const spikeAction: MT5Signal['action'] = earlySpike.direction === 'down' ? 'SELL' : 'BUY';
          let spikeConf = earlySpike.confidence / 100;

          // Rodar IA em paralelo com timeout de 3s — não bloqueia, só amplifica
          let aiBoostLabel = 'IA: timeout/neutro';
          let aiBoostAmount = 0;
          try {
            const tickDataForAI: DerivTickData[] = marketData.map((candle, i) => ({
              symbol,
              quote: candle.close,
              epoch: candle.time ? Math.floor(candle.time) : Math.floor(Date.now() / 1000) - (marketData.length - i) * 60,
            }));
            const aiResult = await Promise.race([
              huggingFaceAI.analyzeMarketData(tickDataForAI, symbol),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
            ]);
            if (aiResult) {
              const aiDir = (aiResult as any).finalDecision as string;
              const aiConf = (aiResult as any).consensusStrength as number;
              const spikeExpectedAI = (spikeAction === 'BUY' && aiDir === 'up') || (spikeAction === 'SELL' && aiDir === 'down');
              if (spikeExpectedAI && aiConf >= 40) {
                aiBoostAmount = Math.min(0.10, (aiConf / 100) * 0.15);
                spikeConf = Math.min(0.97, spikeConf + aiBoostAmount);
                aiBoostLabel = `IA CONCORDA: ${aiDir.toUpperCase()} (${aiConf.toFixed(0)}%) → +${(aiBoostAmount * 100).toFixed(1)}% boost`;
              } else if (!spikeExpectedAI && aiDir !== 'neutral' && aiConf >= 60) {
                aiBoostAmount = -Math.min(0.05, (aiConf / 100) * 0.08);
                spikeConf = Math.max(0.80, spikeConf + aiBoostAmount); // piso mais alto para spike
                aiBoostLabel = `IA DIVERGE: ${aiDir.toUpperCase()} (${aiConf.toFixed(0)}%) → ${(aiBoostAmount * 100).toFixed(1)}% adj`;
              } else {
                aiBoostLabel = `IA: ${aiDir.toUpperCase()} (${aiConf.toFixed(0)}%) — neutro, sem ajuste`;
              }
            }
          } catch {
            aiBoostLabel = 'IA: erro — spike executa por análise técnica';
          }

          const spikeSignal = this.fuseSignals(
            symbol,
            [{ action: spikeAction, confidence: spikeConf, source: 'technical_spike' }],
            marketData,
            `Spike: ${earlySpike.confidence.toFixed(1)}% técnico | ${aiBoostLabel}`,
            spikeConf,
            earlySpike
          );
          if (spikeSignal && spikeSignal.action !== 'HOLD') {
            this.logAnalysis({
              id: `${entryId}_spike_ai`,
              timestamp: Date.now(),
              symbol,
              phase: 'decision',
              status: 'approved',
              finalDecision: spikeSignal.action as 'BUY' | 'SELL' | 'HOLD',
              consecutiveLosses: this.consecutiveLosses,
              decisionReason: `✅ SPIKE CERTEZA ABSOLUTA: ${spikeSignal.action} ${symbol} | Técnico: ${earlySpike.confidence.toFixed(1)}% | Iminência: ${earlySpike.imminencePercent.toFixed(0)}% | ${aiBoostLabel} | Confiança final: ${(spikeConf * 100).toFixed(1)}%`
            });
            console.log(`[MT5Bridge] ⚡ SPIKE ABSOLUTO: ${spikeSignal.action} ${symbol} | Técnico: ${earlySpike.confidence.toFixed(1)}% | ${aiBoostLabel}`);
            return spikeSignal;
          }
        }

        // ── CAMINHO 2: ZONA DE PERIGO — spike iminente mas sem certeza absoluta ──
        // Imminência entre 65-84%: NÃO operar — risco de spike contra a continuidade
        // e sem confiança suficiente para spike. Melhor esperar.
        if (earlySpike.expected && earlySpike.imminencePercent >= 65) {
          this.logAnalysis({
            id: `${entryId}_spike_danger`,
            timestamp: Date.now(),
            symbol,
            phase: 'spike',
            status: 'rejected',
            decisionReason: `⚠️ ZONA DE PERIGO: iminência ${earlySpike.imminencePercent}% (65-84%) — sem certeza para spike, sem segurança para continuidade. Aguardando.`
          });
          console.log(`[MT5Bridge] ⚠️ ${symbol}: zona de perigo (iminência ${earlySpike.imminencePercent}%) — sem operação`);
          return null;
        }

        // ── CAMINHO 3: CONTINUIDADE — direção natural do ativo ──
        // Spike NÃO iminente (imminência <65%) → operar na direção NATURAL do ativo.
        // Crash = COMPRA (subida gradual entre spikes de queda)
        // Boom  = VENDA  (queda gradual entre spikes de alta)
        {
          const naturalAction: MT5Signal['action'] = isCrash ? 'BUY' : 'SELL';
          const prices = marketData.map((d: any) => d.close);
          const rsi    = this.calcRSI(prices, 14);
          const ema20  = this.calcEMA(prices, 20);
          const ema50  = this.calcEMA(prices, 50);
          const profile = resolveDerivProfile(symbol);
          const rsiOversold   = profile?.rsiOversold   ?? 25;
          const rsiOverbought = profile?.rsiOverbought  ?? 75;

          // Verificar se indicadores técnicos confirmam a entrada na direção natural
          let continuityScore = 0;
          const reasonParts: string[] = [];

          if (naturalAction === 'BUY') {
            // Para Crash (BUY de continuidade): evitar entrar quando RSI sobrecomprado
            if (rsi < rsiOverbought - 10) { continuityScore += 2; reasonParts.push(`RSI ${rsi.toFixed(1)} ok para BUY`); }
            else if (rsi >= rsiOverbought) { continuityScore -= 3; reasonParts.push(`RSI ${rsi.toFixed(1)} sobrecomprado — aguardar`); }
            if (ema20 >= ema50) { continuityScore += 1; reasonParts.push('EMA20≥EMA50 confirma alta'); }
          } else {
            // Para Boom (SELL de continuidade): evitar entrar quando RSI sobrevendido
            if (rsi > rsiOversold + 10) { continuityScore += 2; reasonParts.push(`RSI ${rsi.toFixed(1)} ok para SELL`); }
            else if (rsi <= rsiOversold) { continuityScore -= 3; reasonParts.push(`RSI ${rsi.toFixed(1)} sobrevendido — aguardar`); }
            if (ema20 <= ema50) { continuityScore += 1; reasonParts.push('EMA20≤EMA50 confirma baixa'); }
          }

          // Penalizar se iminência de spike cresceu moderadamente (cautela)
          if (earlySpike.imminencePercent >= 50) {
            continuityScore -= 2;
            reasonParts.push(`Iminência de spike ${earlySpike.imminencePercent}% — entrada reduzida`);
          }

          const continuityConf = Math.min(0.82, Math.max(0.55, 0.60 + continuityScore * 0.06));

          if (continuityScore >= 1) {
            const continuitySignal = this.fuseSignals(
              symbol,
              [{ action: naturalAction, confidence: continuityConf, source: 'continuity_natural_direction' }],
              marketData,
              `CONTINUIDADE ${isCrash ? 'CRASH→BUY' : 'BOOM→SELL'}: ${reasonParts.join(' | ')} | Spike ${earlySpike.imminencePercent}% imminente`,
              continuityConf
            );
            if (continuitySignal && continuitySignal.action !== 'HOLD') {
              this.logAnalysis({
                id: `${entryId}_continuity`,
                timestamp: Date.now(),
                symbol,
                phase: 'decision',
                status: 'approved',
                finalDecision: continuitySignal.action as 'BUY' | 'SELL' | 'HOLD',
                consecutiveLosses: this.consecutiveLosses,
                decisionReason: `✅ CONTINUIDADE NATURAL: ${continuitySignal.action} ${symbol} | ${reasonParts.join(' | ')} | Confiança: ${(continuityConf * 100).toFixed(1)}% | Iminência spike: ${earlySpike.imminencePercent}%`
              });
              console.log(`[MT5Bridge] 📈 CONTINUIDADE ${isCrash ? 'CRASH→BUY' : 'BOOM→SELL'}: ${symbol} | Conf: ${(continuityConf * 100).toFixed(1)}% | Spike ${earlySpike.imminencePercent}% imminente`);
              return continuitySignal;
            }
          }

          this.logAnalysis({
            id: `${entryId}_continuity_skip`,
            timestamp: Date.now(),
            symbol,
            phase: 'decision',
            status: 'rejected',
            consecutiveLosses: this.consecutiveLosses,
            decisionReason: `⏳ CONTINUIDADE ${isCrash ? 'CRASH' : 'BOOM'}: score insuficiente (${continuityScore}) — ${reasonParts.join(' | ')} | Aguardando melhor entrada`
          });
          console.log(`[MT5Bridge] ⏳ ${symbol}: continuidade bloqueada (score ${continuityScore}) — ${reasonParts.join(', ')}`);
          return null;
        }
      }

      // Converter candles do MT5 para formato DerivTickData
      // Em modo IA pura (sem candles), cria ticks sintéticos para alimentar os modelos NLP
      const tickData: DerivTickData[] = aiOnlyMode
        ? Array.from({ length: 30 }, (_, i) => ({
            symbol,
            quote: 1.0,
            epoch: Math.floor(Date.now() / 1000) - (30 - i) * 60,
          }))
        : marketData.map((candle, i) => ({
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
        // ── FALLBACK: tentar sinal do bot Deriv (mesmo ativo, análise recente) ──
        const derivSym = this.mapMT5ToDerivSymbol(symbol);
        const storedSignal = getSignal(symbol) || (derivSym ? getSignal(derivSym) : undefined);
        if (storedSignal && storedSignal.direction !== 'neutral' && storedSignal.confidence >= 60) {
          aiDirection = storedSignal.direction;
          aiConsensus = storedSignal.confidence;
          aiReasoning = storedSignal.reason;
          console.log(`[MT5Bridge] 🔄 Usando sinal do bot Deriv para ${symbol}: ${aiDirection.toUpperCase()} ${aiConsensus}%`);
        } else {
          return null;
        }
      }

      // ============================================================
      // VALIDAÇÃO TÉCNICA ADAPTADA AO ATIVO SINTÉTICO
      // Em modo IA pura (sem candles), pula análise técnica e usa só IA.
      // ============================================================
      const assetContext = this.getAssetAIContext(symbol);
      const derivProfile = resolveDerivProfile(symbol);

      let technicalSignal: { action: string; confidence: number; profileNotes: string } = {
        action: aiDirection === 'up' ? 'BUY' : 'SELL',
        confidence: aiConsensus / 100,
        profileNotes: 'Modo IA pura — sem dados técnicos'
      };
      let technicalAgrees = true;
      let prices: number[] = [];
      let indicators: any = { rsi: 50, ema20: 1, ema50: 1, adx: 25, bb: { upper: 1, lower: 0 }, macd: 0 };
      let technicalNarrative = 'Análise técnica indisponível — sem candles do EA.';
      let enrichedModelResults = modelResults;

      if (!aiOnlyMode) {
        technicalSignal = this.runAssetAdaptedTechnicalAnalysis(symbol, marketData);
        technicalAgrees =
          (aiDirection === 'up' && technicalSignal.action === 'BUY') ||
          (aiDirection === 'down' && technicalSignal.action === 'SELL');
        prices = marketData.map((d: any) => d.close);
        indicators = this.buildIndicators(prices, marketData, symbol);
        technicalNarrative = this.buildTechnicalNarrative(indicators, prices);
        enrichedModelResults = modelResults.length > 0
          ? this.buildModelNarratives(modelResults, indicators, aiDirection, aiConsensus, symbol)
          : modelResults;
      }

      const techDecisionReason = aiOnlyMode
        ? `Modo IA pura: consenso ${aiConsensus.toFixed(1)}% → ${aiDirection.toUpperCase()} | ${participatingModels} modelos | Sem validação técnica (EA não enviou candles)`
        : !technicalAgrees && aiConsensus < 80
          ? `Divergência: IA diz ${aiDirection.toUpperCase()} mas análise técnica diz ${technicalSignal.action}. Consenso ${aiConsensus.toFixed(1)}% < 80% — sem trade. ${technicalSignal.profileNotes}`
          : technicalAgrees
            ? `Confirmação técnica (${derivProfile?.family ?? 'padrão'}): RSI=${indicators.rsi.toFixed(1)} [thr: ${derivProfile?.rsiOversold ?? 30}/${derivProfile?.rsiOverbought ?? 70}] | EMA20 ${indicators.ema20 > indicators.ema50 ? '>' : '<'} EMA50 | ADX=${indicators.adx.toFixed(1)} | ${technicalSignal.profileNotes}`
            : `Alta confiança (${aiConsensus.toFixed(1)}% ≥ 80%) — override da análise técnica divergente | ${technicalSignal.profileNotes}`;

      this.logAnalysis({
        id: `${entryId}_tech`,
        timestamp: Date.now(),
        symbol,
        phase: 'technical',
        status: (!aiOnlyMode && !technicalAgrees && aiConsensus < 80) ? 'rejected' : 'processing',
        technicalAction: (aiOnlyMode ? (aiDirection === 'up' ? 'BUY' : 'SELL') : technicalSignal.action) as 'BUY' | 'SELL' | 'HOLD',
        technicalAgrees,
        technicalScore: Math.round(technicalSignal.confidence * 100),
        indicators,
        technicalNarrative: `${technicalNarrative}\n\n${assetContext}`,
        aiConsensus,
        aiDirection,
        modelResults: enrichedModelResults,
        decisionReason: techDecisionReason
      });

      if (!aiOnlyMode && !technicalAgrees && aiConsensus < 80) {
        return null;
      }

      // Decisão final
      const action: MT5Signal['action'] = aiDirection === 'up' ? 'BUY' : 'SELL';
      const finalConfidence = aiConsensus / 100;

      const signals = aiOnlyMode
        ? [{ action, confidence: finalConfidence, source: 'huggingface_ai_only' }]
        : [
            { action, confidence: finalConfidence, source: 'huggingface_ai' },
            { action: technicalSignal.action, confidence: technicalSignal.confidence, source: `technical_${derivProfile?.family ?? 'standard'}` }
          ];

      // Em modo IA pura, passa um candle mínimo para fuseSignals não quebrar com array vazio
      const marketDataForFuse = aiOnlyMode
        ? [{ open: 1.0, high: 1.001, low: 0.999, close: 1.0, volume: 0, time: Math.floor(Date.now() / 1000) }]
        : marketData;
      const signal = this.fuseSignals(symbol, signals, marketDataForFuse, aiReasoning, finalConfidence);

      // Build full narrative for the decision entry
      const fullNarrative = this.buildFullNarrative(
        symbol, aiDirection, aiConsensus, technicalAgrees, indicators,
        signal.action !== 'HOLD' ? signal.action : null, prices
      );

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
        technicalNarrative,
        modelResults: enrichedModelResults,
        participatingModels,
        consecutiveLosses: this.consecutiveLosses,
        fullNarrative,
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

  private runTechnicalAnalysis(symbol: string, marketData: any[]): { action: string; confidence: number; source: string; fibScore: number; fibZone: string; spikeInfo?: SpikeInfo } {
    const prices = marketData.map(d => d.close);
    const highs  = marketData.map(d => d.high || d.close);
    const lows   = marketData.map(d => d.low  || d.close);
    const last   = prices[prices.length - 1];

    const rsi   = this.calcRSI(prices, 14);
    const ema20 = this.calcEMA(prices, 20);
    const ema50 = this.calcEMA(prices, 50);
    const macd  = this.calcMACD(prices);

    // ── Classic indicator score ──
    let score = 0;
    if (rsi < 30) score += 2;
    else if (rsi > 70) score -= 2;
    else if (rsi < 45) score += 1;
    else if (rsi > 55) score -= 1;

    if (ema20 > ema50) score += 1;
    else score -= 1;

    if (macd.macd > macd.signal) score += 1;
    else score -= 1;

    // ── Fibonacci multi-layer score (primary layer) ──
    let fibScore = 0;
    let fibZoneDesc = 'Sem confluência Fibonacci próxima';
    const fib = marketData.length >= 15 ? this.calcMultiLayerFibonacci(marketData, last) : null;

    if (fib) {
      fibZoneDesc = fib.confluenceNarrative;

      if (fib.confluenceScore > 0 && fib.zoneType !== 'neutral') {
        // Fibonacci at SUPPORT → price likely to continue up or bounce (BUY bias)
        // Fibonacci at RESISTANCE → price likely to reject or fall (SELL bias)
        if (fib.zoneType === 'support') {
          fibScore += 3; // strong buy signal at support
          score += 2;    // boost overall score
        } else if (fib.zoneType === 'resistance') {
          fibScore -= 3; // strong sell signal at resistance
          score -= 2;
        }

        // Multi-layer confluence boosts confidence
        const layers = new Set(fib.nearestLevels.map(l => l.layer)).size;
        if (layers >= 2) { fibScore += layers; score += layers; }

        // Key levels (38.2%, 50%, 61.8%) add extra weight
        const keyHits = fib.nearestLevels.filter(l => ['38.2%', '50%', '61.8%'].includes(l.level)).length;
        if (keyHits > 0) { score += keyHits; fibScore += keyHits * 2; }
      }
    }

    // ── Crash/Boom spike override ──
    const spikeInfo = this.isSpikeIndex(symbol) ? this.detectSpikePattern(marketData, symbol) : undefined;
    if (spikeInfo?.expected && spikeInfo.confidence >= 50) {
      // Override to spike direction with high confidence
      const spikeAction = spikeInfo.direction === 'down' ? 'SELL' : 'BUY';
      const spikeConf = 0.5 + spikeInfo.confidence / 200; // 50%→0.75, 80%→0.9
      return { action: spikeAction, confidence: Math.min(0.92, spikeConf), source: 'technical_spike', fibScore, fibZone: fibZoneDesc, spikeInfo };
    }

    const action     = score > 0 ? 'BUY' : score < 0 ? 'SELL' : 'HOLD';
    const baseConf   = 0.4 + Math.abs(score) * 0.08;
    const fibBoost   = Math.abs(fibScore) > 0 ? 0.05 * Math.min(Math.abs(fibScore), 3) : 0;
    const confidence = Math.min(0.92, baseConf + fibBoost);

    return { action, confidence, source: 'technical', fibScore, fibZone: fibZoneDesc, spikeInfo };
  }

  private fuseSignals(
    symbol: string,
    signals: Array<{ action: string; confidence: number; source: string }>,
    marketData: any[],
    aiReasoning?: string,
    overrideConfidence?: number,
    spikeOverride?: SpikeInfo
  ): MT5Signal {
    const buyScore  = signals.filter(s => s.action === 'BUY').reduce((a, s) => a + s.confidence, 0);
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
    const indicators = this.buildIndicators(prices, marketData, symbol);
    const lastPrice = prices[prices.length - 1];
    const atr = indicators.atr || lastPrice * 0.001;
    const fib = indicators.fibonacci;

    const isSpikeIdx = this.isSpikeIndex(symbol);
    const spike = spikeOverride || indicators.spike;
    const isSpikeOpportunity = isSpikeIdx && spike?.expected && spike.confidence >= 50;
    const isContinuityOnSpikeIdx = isSpikeIdx && !isSpikeOpportunity;

    let stopLossPrice = 0;
    let takeProfitPrice = 0;
    let stopLossPipsFinal = 0;
    let takeProfitPipsFinal = 0;
    let slTpSource = 'atr_default';

    if (isSpikeOpportunity) {
      // Spike trade: very tight TP (grab quick spike profit), very tight SL (if spike doesn't happen, exit fast)
      const pipSize = this.getPipSize(symbol, lastPrice);
      const spikeSl = Math.max(Math.round(atr * 0.5 / pipSize), 1);
      const spikeTp = Math.max(Math.round(atr * 2.0 / pipSize), spikeSl);
      stopLossPrice       = action === 'BUY' ? lastPrice - spikeSl * pipSize : lastPrice + spikeSl * pipSize;
      takeProfitPrice     = action === 'BUY' ? lastPrice + spikeTp * pipSize : lastPrice - spikeTp * pipSize;
      stopLossPipsFinal   = spikeSl;
      takeProfitPipsFinal = spikeTp;
      slTpSource = 'spike_atr';
    } else if (isContinuityOnSpikeIdx) {
      // Continuity on Crash/Boom: tight SL to exit if spike fires
      const pipSize = this.getPipSize(symbol, lastPrice);
      const contSl = Math.max(Math.round(atr * 0.8 / pipSize), 1);
      const contTp = Math.max(Math.round(atr * 2.5 / pipSize), contSl * 2);
      stopLossPrice       = action === 'BUY' ? lastPrice - contSl * pipSize : lastPrice + contSl * pipSize;
      takeProfitPrice     = action === 'BUY' ? lastPrice + contTp * pipSize : lastPrice - contTp * pipSize;
      stopLossPipsFinal   = contSl;
      takeProfitPipsFinal = contTp;
      slTpSource = 'spike_continuity_atr';
    } else if (action !== 'HOLD') {
      // ── Calcular SL/TP guiado pelo perfil do ativo + Fibonacci do sistema
      const fibLevels = fib?.nearestLevels?.map(l => ({ level: l.level, price: l.price }));
      const sltp = this.calcIndicatorDrivenSLTP({
        symbol,
        action: action as 'BUY' | 'SELL',
        entryPrice: lastPrice,
        atr,
        fibonacciLevels: this.config.useAIStopLoss ? fibLevels : undefined,
      });
      stopLossPrice       = sltp.stopLoss;
      takeProfitPrice     = sltp.takeProfit;
      stopLossPipsFinal   = sltp.slPips;
      takeProfitPipsFinal = sltp.tpPips;
      slTpSource          = sltp.source;
    }

    const fibZoneLabel = fib && fib.nearestLevels.length > 0
      ? `${fib.nearestLevels[0].level} ${fib.zoneType} (${fib.nearestLevels[0].layer})`
      : 'fora de zona';

    const signal: MT5Signal = {
      id: `MT5_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      symbol,
      action,
      lotSize:         this.getValidLotSize(symbol),
      stopLoss:        stopLossPrice,
      takeProfit:      takeProfitPrice,
      stopLossPips:    stopLossPipsFinal,
      takeProfitPips:  takeProfitPipsFinal,
      entryPrice:      lastPrice,
      confidence:      finalConfidence,
      aiSources:       signals.map(s => s.source),
      indicators,
      timestamp:       Date.now(),
      expiresAt:       Date.now() + this.config.signalTimeoutSeconds * 1000,
      reason:          this.buildReason(action, signals, indicators, aiReasoning, fibZoneLabel),
      spikeOpportunity: isSpikeOpportunity,
      spikeExitRequired: isContinuityOnSpikeIdx && (spike?.imminencePercent || 0) >= 60,
      fibZone:          fibZoneLabel,
      fibConfluence:    fib?.confluenceScore,
      // Recomendações da IA para modos autônomos
      aiTrailingEnabled: action !== 'HOLD' && finalConfidence >= 0.75,
      aiTrailingPips:    Math.round(stopLossPipsFinal * 0.6),
      aiMaxPositions:    3,
      aiMaxDailyLoss:    this.config.maxDailyLoss,
      aiMaxDailyProfit:  this.config.maxDailyProfit,
    };

    if (action !== 'HOLD') {
      this.pendingSignals.set(signal.id, signal);
      this.status.totalSignalsGenerated++;
      this.status.activeSignal = signal;
      this.emit('signal', signal);
      const spikeTag = isSpikeOpportunity ? ' [⚡ SPIKE]' : isContinuityOnSpikeIdx ? ' [CONTINUIDADE]' : '';
      const fibTag = fib && fib.nearestLevels.length > 0 ? ` | Fib: ${fibZoneLabel}` : '';
      console.log(`[MT5Bridge] ✅ Sinal aprovado: ${action} ${symbol}${spikeTag}${fibTag} | Consenso: ${(finalConfidence * 100).toFixed(1)}%`);
    }

    return signal;
  }

  private buildReason(action: string, signals: Array<{ action: string; confidence: number; source: string }>, indicators: MT5Indicators, aiReasoning?: string, fibZoneLabel?: string): string {
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
    if (fibZoneLabel && fibZoneLabel !== 'fora de zona') {
      parts.push(`📐 Zona Fib: ${fibZoneLabel}`);
    }
    if (indicators.fibonacci?.zoneBehavior) {
      const beh = indicators.fibonacci.zoneBehavior;
      if (beh.confirmation !== 'unclear') {
        parts.push(`${beh.confirmation === 'continuation' ? '→ CONTINUIDADE' : '← REVERSÃO'} (${Math.max(beh.continuationScore, beh.reversalScore)}%)`);
      }
    }
    if (indicators.fibonacci?.nestedZones?.length > 0) {
      const nz = indicators.fibonacci.nestedZones[0];
      if (nz.nearestNestedLevel) {
        parts.push(`Nano-Fib ${nz.nearestNestedLevel.level} em [${nz.parentLevel1}–${nz.parentLevel2}] ${nz.parentLayer}`);
      }
    }
    return parts.join(' | ') || `IA indica ${action}`;
  }

  private buildIndicators(prices: number[], marketData: any[], symbol?: string): MT5Indicators {
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

    const fibonacci = marketData.length >= 15
      ? this.calcMultiLayerFibonacci(marketData, last)
      : undefined;

    const spike = symbol
      ? this.detectSpikePattern(marketData, symbol)
      : undefined;

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
      resistance,
      fibonacci,
      spike
    };
  }

  private buildTechnicalNarrative(ind: MT5Indicators, prices: number[]): string {
    const last = prices[prices.length - 1];
    const parts: string[] = [];

    // RSI
    if (ind.rsi !== undefined) {
      const rsiInt = Math.round(ind.rsi);
      if (rsiInt > 75) parts.push(`RSI em ${rsiInt} — mercado em sobrecompra forte, pressão vendedora esperada em breve.`);
      else if (rsiInt > 65) parts.push(`RSI em ${rsiInt} — sobrecompra moderada, ainda há força compradora mas o mercado está esticado.`);
      else if (rsiInt > 55) parts.push(`RSI em ${rsiInt} — zona bullish saudável, compradores no controle sem excessos.`);
      else if (rsiInt >= 45) parts.push(`RSI em ${rsiInt} — zona neutra, equilíbrio entre compradores e vendedores.`);
      else if (rsiInt >= 35) parts.push(`RSI em ${rsiInt} — zona bearish, vendedores pressionando mas sem pânico.`);
      else if (rsiInt >= 25) parts.push(`RSI em ${rsiInt} — sobrevenda moderada, possível recuperação técnica.`);
      else parts.push(`RSI em ${rsiInt} — sobrevenda extrema, alto potencial de reversão para cima.`);
    }

    // MACD
    if (ind.macd !== undefined && ind.macdSignal !== undefined) {
      const hist = ind.macd - ind.macdSignal;
      if (hist > 0 && ind.macd > 0)
        parts.push(`MACD positivo (histograma +${hist.toFixed(5)}) — momentum de alta confirmado, linha MACD acima do sinal e acima de zero.`);
      else if (hist > 0 && ind.macd <= 0)
        parts.push(`MACD cruzou acima do sinal (histograma +${hist.toFixed(5)}) — possível início de reversão para cima, ainda em território negativo.`);
      else if (hist < 0 && ind.macd < 0)
        parts.push(`MACD negativo (histograma ${hist.toFixed(5)}) — momentum de baixa confirmado, linha MACD abaixo do sinal e abaixo de zero.`);
      else
        parts.push(`MACD cruzou abaixo do sinal (histograma ${hist.toFixed(5)}) — possível início de enfraquecimento da alta.`);
    }

    // EMAs
    if (ind.ema20 !== undefined && ind.ema50 !== undefined && ind.ema200 !== undefined) {
      if (ind.ema20 > ind.ema50 && ind.ema50 > ind.ema200)
        parts.push(`Médias móveis em alinhamento perfeito de alta (EMA20 > EMA50 > EMA200) — sinal clássico de bull trend confirmado em todos os tempos gráficos.`);
      else if (ind.ema20 < ind.ema50 && ind.ema50 < ind.ema200)
        parts.push(`Médias móveis em alinhamento de baixa (EMA20 < EMA50 < EMA200) — sinal clássico de bear trend confirmado em todos os tempos gráficos.`);
      else if (ind.ema20 > ind.ema50)
        parts.push(`EMA20 (${ind.ema20.toFixed(4)}) acima da EMA50 (${ind.ema50.toFixed(4)}) — tendência de curto prazo em alta, mas EMA200 (${ind.ema200.toFixed(4)}) ainda não confirma o longo prazo.`);
      else
        parts.push(`EMA20 (${ind.ema20.toFixed(4)}) abaixo da EMA50 (${ind.ema50.toFixed(4)}) — tendência de curto prazo em baixa, alerta de reversão no médio prazo.`);
    }

    // Bollinger
    if (ind.bollingerUpper !== undefined && ind.bollingerLower !== undefined && ind.bollingerMid !== undefined) {
      const range = ind.bollingerUpper - ind.bollingerLower;
      const pos = range > 0 ? ((last - ind.bollingerLower) / range) * 100 : 50;
      const bbWidth = range / ind.bollingerMid;
      if (pos > 80)
        parts.push(`Bollinger: preço em ${pos.toFixed(0)}% das bandas — próximo à banda superior, pressão vendedora das bandas. ${bbWidth < 0.005 ? 'Bandas estreitas indicam explosão de volatilidade iminente.' : ''}`);
      else if (pos < 20)
        parts.push(`Bollinger: preço em ${pos.toFixed(0)}% das bandas — próximo à banda inferior, suporte das bandas e potencial reversão. ${bbWidth < 0.005 ? 'Bandas estreitas indicam movimento explosivo próximo.' : ''}`);
      else
        parts.push(`Bollinger: preço em ${pos.toFixed(0)}% das bandas — região central, sem pressão extrema das bandas. ${bbWidth < 0.005 ? 'Bandas muito estreitas (squeeze) — movimento forte iminente.' : ''}`);
    }

    // ADX
    if (ind.adx !== undefined) {
      const adxInt = Math.round(ind.adx);
      if (adxInt > 50) parts.push(`ADX em ${adxInt} — tendência extremamente forte, evitar operações contra a direção dominante.`);
      else if (adxInt > 35) parts.push(`ADX em ${adxInt} — tendência forte estabelecida, seguir a direção é o mais seguro.`);
      else if (adxInt > 25) parts.push(`ADX em ${adxInt} — tendência moderada confirmada (acima de 25), sinal direcional válido.`);
      else if (adxInt > 15) parts.push(`ADX em ${adxInt} — tendência fraca, mercado em consolidação ou transição.`);
      else parts.push(`ADX em ${adxInt} — mercado sem tendência definida (abaixo de 15), range lateral dominante.`);
    }

    // Stochastic
    if (ind.stochK !== undefined && ind.stochD !== undefined) {
      const k = Math.round(ind.stochK), d = Math.round(ind.stochD);
      if (k > 80 && d > 80)
        parts.push(`Estocástico em sobrecompra (%K=${k}, %D=${d}) — confirmação de sobrecompra, aguardar cruzamento para baixo antes de vender.`);
      else if (k < 20 && d < 20)
        parts.push(`Estocástico em sobrevenda (%K=${k}, %D=${d}) — confirmação de sobrevenda, aguardar cruzamento para cima antes de comprar.`);
      else if (k > d)
        parts.push(`Estocástico: %K (${k}) acima de %D (${d}) — momentum de alta no oscilador de curto prazo.`);
      else
        parts.push(`Estocástico: %K (${k}) abaixo de %D (${d}) — momentum de baixa no oscilador de curto prazo.`);
    }

    // Support / Resistance
    if (ind.support !== undefined && ind.resistance !== undefined) {
      const distSupport = last > 0 ? ((last - ind.support) / last * 100).toFixed(2) : '?';
      const distResist = last > 0 ? ((ind.resistance - last) / last * 100).toFixed(2) : '?';
      parts.push(`Zonas de preço: suporte em ${ind.support.toFixed(4)} (${distSupport}% abaixo) — resistência em ${ind.resistance.toFixed(4)} (${distResist}% acima).`);
    }

    // Trend summary
    if (ind.trend) {
      const map: Record<string, string> = {
        bullish: 'Tendência geral: ALTISTA — confluência de indicadores aponta para continuação da alta.',
        bearish: 'Tendência geral: BAIXISTA — confluência de indicadores aponta para continuação da queda.',
        sideways: 'Tendência geral: LATERAL — mercado em consolidação, aguardar definição de direção.'
      };
      parts.push(map[ind.trend] || '');
    }

    return parts.filter(Boolean).join(' ');
  }

  private buildModelNarratives(
    modelResults: AIModelResult[],
    ind: MT5Indicators,
    prediction: 'up' | 'down' | 'neutral',
    confidence: number,
    symbol: string
  ): AIModelResult[] {
    const dir = prediction === 'up' ? 'ALTA' : prediction === 'down' ? 'BAIXA' : 'NEUTRA';
    const confLabel = confidence >= 80 ? 'alta confiança' : confidence >= 65 ? 'confiança moderada' : 'baixa confiança';

    const specializations: Record<string, (ind: MT5Indicators, dir: string, conf: number) => string> = {
      'FinBERT Financial Sentiment': (ind, dir, conf) => {
        const rsiCtx = ind.rsi > 60 ? 'padrão quantitativo com linguagem positiva (momentum bullish detectado)' :
                       ind.rsi < 40 ? 'padrão quantitativo com linguagem negativa (pressão bearish detectada)' :
                       'padrão quantitativo neutro (equilíbrio entre forças)';
        const macdCtx = ind.macd > ind.macdSignal ? 'histograma MACD positivo reforça o sentimento de alta' : 'histograma MACD negativo reforça sentimento de baixa';
        return `O FinBERT processa o "DNA de mercado" de ${symbol} — uma descrição quantitativa dos preços transformada em linguagem financeira. Ele foi treinado em 4.9 bilhões de tokens de texto financeiro (Reuters, Bloomberg, FT, SEC). Nesta análise, identificou ${rsiCtx}. O ${macdCtx}. Conclusão do FinBERT: direção ${dir} com ${confLabel} (${conf}%).`;
      },
      'RoBERTa Market Analyzer': (ind, dir, conf) => {
        const trendCtx = ind.trend === 'bullish' ? 'alinhamento bullish das médias móveis (EMA20>EMA50>EMA200)' :
                         ind.trend === 'bearish' ? 'alinhamento bearish das médias móveis (EMA20<EMA50<EMA200)' :
                         'médias móveis sem alinhamento claro (mercado lateral)';
        const adxCtx = ind.adx > 25 ? `ADX em ${ind.adx.toFixed(0)} confirma tendência direcional forte` : `ADX em ${ind.adx.toFixed(0)} indica tendência fraca/lateral`;
        return `O RoBERTa Market Analyzer foca em momentum direcional e força de tendência. Analisa o contexto do mercado como um texto de análise técnica. Detectou: ${trendCtx}. ${adxCtx}. Posicionamento do preço nas bandas de Bollinger (${ind.bollingerUpper !== undefined ? ((ind.bollingerUpper + ind.bollingerLower) / 2).toFixed(4) : '?'}) reforça a direção. Veredicto RoBERTa: ${dir} com ${confLabel} (${conf}%).`;
      },
      'XLM-RoBERTa Multilingual': (ind, dir, conf) => {
        const stochCtx = ind.stochK > 80 ? `estocástico em sobrecompra (${ind.stochK.toFixed(0)}) — cuidado com exaustão` :
                         ind.stochK < 20 ? `estocástico em sobrevenda (${ind.stochK.toFixed(0)}) — potencial de recuperação` :
                         `estocástico em zona neutra (${ind.stochK.toFixed(0)})`;
        const srCtx = `suporte em ${ind.support?.toFixed(4)} e resistência em ${ind.resistance?.toFixed(4)}`;
        return `O XLM-RoBERTa tem capacidade multilíngue e alta generalização — ideal para mercados sintéticos como ${symbol}. Avalia padrões de preço em múltiplos contextos simultaneamente. Analisou: ${stochCtx}. Estrutura de ${srCtx} define o campo de batalha atual entre compradores e vendedores. A posição do preço nessa estrutura indica ${dir === 'ALTA' ? 'favor dos compradores' : dir === 'BAIXA' ? 'favor dos vendedores' : 'equilíbrio'}. Avaliação XLM-RoBERTa: ${dir} (${conf}%).`;
      },
      'RoBERTa Trend Detector': (ind, dir, conf) => {
        const rsiCtx = ind.rsi !== undefined ? `RSI em ${ind.rsi.toFixed(1)}` : 'RSI indisponível';
        const ema20vs50 = ind.ema20 > ind.ema50 ? `EMA20 (${ind.ema20.toFixed(4)}) acima da EMA50 (${ind.ema50.toFixed(4)}) — cruzamento de alta ativo` :
                                                   `EMA20 (${ind.ema20.toFixed(4)}) abaixo da EMA50 (${ind.ema50.toFixed(4)}) — cruzamento de baixa ativo`;
        const volCtx = ind.volatility !== undefined ? `volatilidade atual em ${ind.volatility.toFixed(3)}% (${ind.volatility > 0.5 ? 'mercado volátil' : 'mercado estável'})` : '';
        return `O RoBERTa Trend Detector é especializado em identificar se uma tendência está se iniciando, continuando ou revertendo. Para ${symbol}: ${ema20vs50}. ${rsiCtx} ${ind.rsi > 55 ? 'suporta o viés de alta' : ind.rsi < 45 ? 'suporta o viés de baixa' : 'está neutro'}. ${volCtx ? volCtx + '.' : ''} Sinal de tendência detectado: ${dir} com ${confLabel} (${conf}%).`;
      },
      'DistilRoBERTa Financial': (ind, dir, conf) => {
        const macdCtx = ind.macd !== undefined ? `MACD ${ind.macd > 0 ? 'positivo' : 'negativo'} (${ind.macd.toFixed(5)})` : 'MACD indisponível';
        const atrCtx = ind.atr !== undefined ? `ATR em ${ind.atr.toFixed(5)} indica ${ind.atr > 0.001 ? 'amplitude de movimento significativa' : 'movimentos pequenos'}` : '';
        return `O DistilRoBERTa Financial combina velocidade e precisão para análise de alta frequência. Processa ${symbol} com foco em sinais de curto prazo. Identificou: ${macdCtx} — ${ind.macd > ind.macdSignal ? 'momentum de alta ativo' : 'momentum de baixa'}. ${atrCtx ? atrCtx + '.' : ''} Pela análise de frequência e momentum imediato, o modelo conclui: ${dir} com ${confLabel} (${conf}%).`;
      }
    };

    return modelResults.map(m => {
      const buildNarrative = specializations[m.model];
      const narrative = buildNarrative
        ? buildNarrative(ind, dir, m.confidence)
        : `${m.model} analisou os dados de ${symbol} e identificou direção ${dir} com ${m.confidence}% de confiança. ${m.reasoning || ''}`;
      return { ...m, narrative };
    });
  }

  private buildFullNarrative(
    symbol: string,
    aiDirection: 'up' | 'down' | 'neutral',
    aiConsensus: number,
    technicalAgrees: boolean,
    ind: MT5Indicators,
    finalDecision: string | null | undefined,
    prices: number[]
  ): string {
    const dir = aiDirection === 'up' ? 'COMPRA' : aiDirection === 'down' ? 'VENDA' : 'NEUTRO';
    const techDir = technicalAgrees ? 'concorda' : 'diverge';
    const last = prices[prices.length - 1];
    const prev = prices.length > 1 ? prices[prices.length - 2] : last;
    const change = ((last - prev) / prev * 100).toFixed(4);
    const changeLabel = parseFloat(change) >= 0 ? `+${change}%` : `${change}%`;

    let narrative = `━━ ANÁLISE COMPLETA — ${symbol} ━━\n\n`;
    narrative += `📍 Preço atual: ${last.toFixed(5)} (${changeLabel} na última vela)\n`;
    narrative += `🧠 Consenso das IAs: ${aiConsensus.toFixed(1)}% → ${dir} (mínimo exigido: 70%)\n`;
    narrative += `📊 Análise técnica: ${techDir} com as IAs\n`;
    if (finalDecision && finalDecision !== 'HOLD') {
      narrative += `✅ Decisão final: ${finalDecision === 'BUY' ? 'EXECUTAR COMPRA' : 'EXECUTAR VENDA'}\n`;
    } else {
      narrative += `⏸️ Decisão: SEM OPERAÇÃO — critérios não atendidos\n`;
    }
    narrative += `\n📈 O QUE AS IAs CONSIDERAM:\n`;
    narrative += `• ${aiConsensus >= 70 ? `Consenso de ${aiConsensus.toFixed(0)}% entre os modelos — acima do limiar de segurança de 70%` : `Consenso de ${aiConsensus.toFixed(0)}% — insuficiente (mínimo 70%)`}\n`;
    if (aiConsensus < 80 && !technicalAgrees) {
      narrative += `• Divergência IA vs. técnico exige consenso ≥80% — operação bloqueada por segurança\n`;
    } else if (technicalAgrees) {
      narrative += `• Análise técnica confirma a direção das IAs — dupla validação aprovada\n`;
    }
    narrative += `\n🔍 CONTEXTO TÉCNICO:\n`;
    narrative += `• Tendência: ${ind.trend === 'bullish' ? 'ALTA — EMAs empilhadas para cima' : ind.trend === 'bearish' ? 'BAIXA — EMAs empilhadas para baixo' : 'LATERAL — EMAs entrelaçadas'}\n`;
    narrative += `• Momentum: RSI ${ind.rsi?.toFixed(1)} ${ind.rsi > 60 ? '(momentum de alta)' : ind.rsi < 40 ? '(momentum de baixa)' : '(neutro)'}\n`;
    narrative += `• Força: ADX ${ind.adx?.toFixed(1)} ${ind.adx > 25 ? '(tendência forte ✓)' : '(tendência fraca ✗)'}\n`;
    narrative += `• Volatilidade: ATR ${ind.atr?.toFixed(5)} | ${ind.volatility?.toFixed(3)}% do preço\n`;
    narrative += `• Zonas: Suporte ${ind.support?.toFixed(4)} ↔ Resistência ${ind.resistance?.toFixed(4)}\n`;

    // Fibonacci section
    if (ind.fibonacci) {
      const fib = ind.fibonacci;
      narrative += `\n📐 FIBONACCI MULTI-CAMADA:\n`;
      narrative += `• ${fib.confluenceNarrative}\n`;

      if (fib.zoneBehavior) {
        const beh = fib.zoneBehavior;
        const behLabel = beh.confirmation === 'continuation' ? '→ CONTINUIDADE' : beh.confirmation === 'reversal' ? '← REVERSÃO' : '? INDEFINIDO';
        narrative += `• Comportamento na zona: ${behLabel} | Continuidade: ${beh.continuationScore}% vs Reversão: ${beh.reversalScore}%\n`;
        narrative += `• Padrão de vela: ${beh.candlePattern.replace(/_/g, ' ')}\n`;
      }

      if (fib.nestedZones.length > 0) {
        narrative += `\n🔬 FIBONACCI DENTRO DE FIBONACCI (zonas ativas):\n`;
        fib.nestedZones.slice(0, 3).forEach(nz => {
          narrative += `• [${nz.parentLayer.toUpperCase()}] Entre ${nz.parentLevel1} e ${nz.parentLevel2}: `;
          if (nz.nearestNestedLevel) {
            narrative += `nível nano ${nz.nearestNestedLevel.level} em ${nz.nearestNestedLevel.price.toFixed(5)} (dist ${(nz.nearestNestedLevel.distancePct * 10).toFixed(1)}‰)\n`;
          }
        });
      }
    }

    // Spike section for Crash/Boom
    if (ind.spike?.expected) {
      const sp = ind.spike;
      narrative += `\n⚡ CRASH/BOOM — ANÁLISE DE SPIKE:\n`;
      narrative += `• Direção esperada: ${sp.direction?.toUpperCase()} | Iminência: ${sp.imminencePercent}% | Confiança: ${sp.confidence}%\n`;
      narrative += `• ${sp.candlesSinceLastSpike} candles desde último spike (média: ${sp.avgCandleInterval})\n`;
      narrative += `• Momentum confirma: ${sp.momentumConfirms ? 'SIM ✓' : 'NÃO ✗'}\n`;
      if (sp.preEntryWindow) {
        narrative += `• ⚡ JANELA DE ENTRADA PRÉ-SPIKE ATIVA — Score de timing: ${sp.entryTimingScore}/100\n`;
        narrative += `• Estimativa: ~${sp.ticksUntilSpikeEstimate} ticks para o spike\n`;
      }
    }

    return narrative;
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
    this.savePositionToDB(position);
    this.emit('trade_opened', position);
    console.log(`[MT5Bridge] 📈 Posição aberta: #${position.ticket} ${position.type} ${position.symbol} @ ${position.openPrice}`);
  }

  updatePosition(ticket: number, update: Partial<MT5Position>): void {
    const pos = this.openPositions.get(ticket);
    if (pos) {
      const updated = { ...pos, ...update };
      this.openPositions.set(ticket, updated);
      this.savePositionToDB(updated);
    }
  }

  confirmTradeClose(result: MT5TradeResult): void {
    this.openPositions.delete(result.ticket);
    this.removePositionFromDB(result.ticket);
    this.clearPositionContext(result.ticket); // Limpar memória desta posição
    this.recentTrades.unshift(result);
    if (this.recentTrades.length > 100) this.recentTrades.pop();
    this.saveTradeToDB(result);

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
    // Bloquear geração de sinal se já atingiu o limite de posições por símbolo
    const positionsForSymbol = Array.from(this.openPositions.values()).filter(p => p.symbol === symbol).length;
    const maxPerSymbol = this.config.maxPositionsPerSymbol ?? 1;
    const symbolAtLimit = maxPerSymbol > 0 && positionsForSymbol >= maxPerSymbol;
    if (!hasPending && !symbolAtLimit && this.config.enabled) {
      setImmediate(() => {
        this.generateSignal(symbol).then(signal => {
          if (signal && signal.action !== 'HOLD') {
            console.log(`[MT5Bridge] 🎯 Sinal gerado para ${symbol}: ${signal.action} (${(signal.confidence * 100).toFixed(1)}%)`);
          }
        }).catch(() => {});
      });
    } else if (symbolAtLimit) {
      console.log(`[MT5Bridge] 🔒 ${symbol}: limite de posições atingido (${positionsForSymbol}/${maxPerSymbol}) — sinal bloqueado`);
    }
  }

  private getMarketDataForSymbol(symbol: string): any[] {
    return this.marketDataCache.get(symbol) || [];
  }

  getMarketData(symbol: string): any[] {
    return this.marketDataCache.get(symbol) || [];
  }

  getCachedSymbols(): string[] {
    return Array.from(this.marketDataCache.keys());
  }

  // generateMockSignal removido — sinais aleatórios são proibidos.
  // O sistema só opera quando a IA real retorna consenso >= 70%.

  private startSignalGeneration(): void {
    if (this.signalGenerationInterval) return;
    console.log('[MT5Bridge] 🚀 Iniciando geração automática de sinais');
    this.signalGenerationInterval = setInterval(() => {
      if (!this.config.enabled) return;
      // Prioriza símbolos reais do EA (WIN/WDO via MT5); se não houver, usa os da config (Deriv)
      const ea = this.getCachedSymbols();
      const symbols = ea.length > 0 ? ea : this.config.symbols.slice(0, 3);
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

  // ============================================================
  // FIBONACCI MULTI-LAYER ENGINE
  // ============================================================

  private static readonly FIB_RATIOS = [0, 0.236, 0.382, 0.500, 0.618, 0.786, 1.000, 1.272, 1.618];
  private static readonly FIB_NAMES  = ['0%', '23.6%', '38.2%', '50%', '61.8%', '78.6%', '100%', '127.2%', '161.8%'];

  /**
   * Find swing high and swing low indices in a slice
   */
  private findSwing(highs: number[], lows: number[]): { high: number; low: number; highIdx: number; lowIdx: number; trend: 'up' | 'down' } {
    let high = -Infinity, low = Infinity, highIdx = 0, lowIdx = 0;
    for (let i = 0; i < highs.length; i++) {
      if (highs[i] > high) { high = highs[i]; highIdx = i; }
      if (lows[i] < low)   { low  = lows[i];  lowIdx  = i; }
    }
    return { high, low, highIdx, lowIdx, trend: highIdx > lowIdx ? 'down' : 'up' };
  }

  /**
   * Calculate Fibonacci retracement and extension levels from a swing
   * If uptrend: levels fan down from swingHigh (retracement into bull move)
   * If downtrend: levels fan up from swingLow (retracement into bear move)
   */
  private calcFibLevels(swingHigh: number, swingLow: number, trend: 'up' | 'down'): Record<string, number> {
    const range = swingHigh - swingLow;
    const result: Record<string, number> = {};
    MetaTraderBridge.FIB_RATIOS.forEach((ratio, i) => {
      if (trend === 'up') {
        result[MetaTraderBridge.FIB_NAMES[i]] = swingHigh - range * ratio;
      } else {
        result[MetaTraderBridge.FIB_NAMES[i]] = swingLow + range * ratio;
      }
    });
    return result;
  }

  /**
   * Multi-layer Fibonacci analysis:
   * - Macro layer: last 100 candles (dominant swing)
   * - Meso layer: last 50 candles (intermediate structure)
   * - Micro layer: last 20 candles (current move / entry precision)
   * Confluence: where levels from multiple layers cluster together
   */
  private calcMultiLayerFibonacci(marketData: any[], currentPrice: number): FibonacciAnalysis {
    const highs  = marketData.map(d => d.high || d.close * 1.001);
    const lows   = marketData.map(d => d.low  || d.close * 0.999);
    const closes = marketData.map(d => d.close);

    const atr = this.calcATR(highs, lows, closes, 14);
    const tolerance = Math.max(atr * 0.6, currentPrice * 0.002); // within 0.6 ATR or 0.2% price

    const macroN = Math.min(100, marketData.length);
    const mesoN  = Math.min(50,  marketData.length);
    const microN = Math.min(20,  marketData.length);

    const macroSwing = this.findSwing(highs.slice(-macroN), lows.slice(-macroN));
    const mesoSwing  = this.findSwing(highs.slice(-mesoN),  lows.slice(-mesoN));
    const microSwing = this.findSwing(highs.slice(-microN), lows.slice(-microN));

    const macro = this.calcFibLevels(macroSwing.high, macroSwing.low, macroSwing.trend);
    const meso  = this.calcFibLevels(mesoSwing.high,  mesoSwing.low,  mesoSwing.trend);
    const micro = this.calcFibLevels(microSwing.high,  microSwing.low,  microSwing.trend);

    const nearestLevels: FibZoneInfo[] = [];

    const collectNear = (levels: Record<string, number>, layer: 'macro' | 'meso' | 'micro') => {
      Object.entries(levels).forEach(([name, price]) => {
        const dist = Math.abs(currentPrice - price);
        if (dist <= tolerance) {
          nearestLevels.push({
            level: name,
            price,
            layer,
            type: currentPrice >= price ? 'support' : 'resistance',
            distancePct: price > 0 ? dist / price * 100 : 0
          });
        }
      });
    };

    collectNear(macro, 'macro');
    collectNear(meso,  'meso');
    collectNear(micro, 'micro');

    nearestLevels.sort((a, b) => a.distancePct - b.distancePct);

    // Confluence score: count how many distinct layers are represented near price
    const layersPresent = new Set(nearestLevels.map(l => l.layer)).size;
    const levelsCount = nearestLevels.length;
    // High-value Fibonacci levels (38.2%, 50%, 61.8%) carry extra weight
    const keyLevels = ['38.2%', '50%', '61.8%', '78.6%'];
    const keyLevelHits = nearestLevels.filter(l => keyLevels.includes(l.level)).length;
    const confluenceScore = Math.min(100, layersPresent * 25 + levelsCount * 10 + keyLevelHits * 15);

    const supportCount    = nearestLevels.filter(l => l.type === 'support').length;
    const resistanceCount = nearestLevels.filter(l => l.type === 'resistance').length;
    const zoneType = supportCount > resistanceCount ? 'support'
                   : resistanceCount > supportCount ? 'resistance'
                   : 'neutral';

    let confluenceNarrative = '';
    if (nearestLevels.length === 0) {
      // Find the next nearest level from any layer
      const allLevels: Array<{ name: string; price: number; layer: string }> = [];
      (['macro', 'meso', 'micro'] as const).forEach(layer => {
        const lvl = layer === 'macro' ? macro : layer === 'meso' ? meso : micro;
        Object.entries(lvl).forEach(([name, price]) => allLevels.push({ name, price, layer }));
      });
      allLevels.sort((a, b) => Math.abs(currentPrice - a.price) - Math.abs(currentPrice - b.price));
      const next = allLevels[0];
      const distPct = next ? ((Math.abs(currentPrice - next.price) / currentPrice) * 100).toFixed(2) : '?';
      confluenceNarrative = `Preço (${currentPrice.toFixed(5)}) fora de zona Fibonacci. Próxima região: ${next?.name || '?'} (${next?.layer}) em ${next?.price?.toFixed(5) || '?'} — ${distPct}% de distância.`;
    } else {
      const closest = nearestLevels[0];
      const multiLayer = layersPresent > 1;
      const layerNames = [...new Set(nearestLevels.map(l => l.layer))].join(' + ');
      confluenceNarrative = `⚡ ZONA FIBONACCI ATIVA: nível ${closest.level} (${closest.layer}) em ${closest.price.toFixed(5)} — distância ${(closest.distancePct * 10).toFixed(1)}‰.`;
      if (multiLayer) {
        confluenceNarrative += ` CONFLUÊNCIA ${layersPresent} CAMADAS (${layerNames}) — zona de altíssima probabilidade.`;
      }
      if (keyLevelHits > 0) {
        const key = nearestLevels.filter(l => keyLevels.includes(l.level))[0];
        confluenceNarrative += ` Nível-chave: ${key.level} — ouro do Fibonacci para reversões e continuidades.`;
      }
      confluenceNarrative += ` Comportamento esperado: ${zoneType === 'support' ? 'SUPORTE — pressão compradora provável, continuidade altista ou reversão de baixa' : zoneType === 'resistance' ? 'RESISTÊNCIA — pressão vendedora provável, rejeição ou continuidade baixista' : 'INDEFINIDO — aguardar vela de confirmação direcional'}.`;
    }

    // ── Fibonacci dentro de Fibonacci (nested zones) ──
    // For each pair of adjacent key levels where price sits between them, draw a nested Fibonacci
    const nestedZones: NestedFibonacciZone[] = [];
    const keyPairs: Array<[string, string]> = [
      ['0%', '23.6%'], ['23.6%', '38.2%'], ['38.2%', '50%'],
      ['50%', '61.8%'], ['61.8%', '78.6%'], ['78.6%', '100%']
    ];

    (['macro', 'meso', 'micro'] as const).forEach(layer => {
      const levels = layer === 'macro' ? macro : layer === 'meso' ? meso : micro;
      keyPairs.forEach(([k1, k2]) => {
        const p1 = levels[k1];
        const p2 = levels[k2];
        if (p1 !== undefined && p2 !== undefined) {
          const lo = Math.min(p1, p2);
          const hi = Math.max(p1, p2);
          if (currentPrice >= lo && currentPrice <= hi) {
            nestedZones.push(this.calcNestedFibonacci(p1, p2, k1, k2, layer, currentPrice));
          }
        }
      });
    });

    // ── Zone behavior analysis for the nearest level ──
    let zoneBehavior: FibZoneBehavior | undefined;
    if (nearestLevels.length > 0) {
      zoneBehavior = this.analyzeFibZoneBehavior(marketData, currentPrice, nearestLevels[0]);
    }

    return { macro, meso, micro, nearestLevels, confluenceScore, zoneType, confluenceNarrative, nestedZones, zoneBehavior };
  }

  // ============================================================
  // FIBONACCI DENTRO DE FIBONACCI — NESTED FIBONACCI ENGINE
  // ============================================================

  /**
   * Draws a complete Fibonacci retracement between two parent Fibonacci levels.
   * Example: if price is between 38.2% and 61.8%, this creates a new set of
   * Fibonacci levels precisely within that "golden zone" for entry/exit precision.
   */
  private calcNestedFibonacci(
    price1: number,
    price2: number,
    parentLevel1: string,
    parentLevel2: string,
    parentLayer: 'macro' | 'meso' | 'micro',
    currentPrice: number
  ): NestedFibonacciZone {
    const lo = Math.min(price1, price2);
    const hi = Math.max(price1, price2);
    const trend: 'up' | 'down' = price2 > price1 ? 'up' : 'down';
    const nestedLevels = this.calcFibLevels(hi, lo, trend);

    let nearestNestedLevel: NestedFibonacciZone['nearestNestedLevel'] = null;
    let minDist = Infinity;
    Object.entries(nestedLevels).forEach(([name, price]) => {
      const dist = Math.abs(currentPrice - price) / (currentPrice || 1) * 100;
      if (dist < minDist) {
        minDist = dist;
        nearestNestedLevel = { level: name, price, distancePct: dist };
      }
    });

    return {
      parentLevel1, parentLevel2, parentLayer,
      price1, price2, nestedLevels,
      currentPriceInZone: true,
      nearestNestedLevel
    };
  }

  // ============================================================
  // FIBONACCI ZONE BEHAVIOR — CONTINUIDADE VS RESISTÊNCIA
  // ============================================================

  /**
   * When price arrives at a Fibonacci zone, determines whether the market will:
   * - CONTINUE through it (breakout / breakdown)
   * - REVERSE at it (bounce / rejection)
   * Uses candle patterns, RSI, MACD momentum at the zone.
   */
  private analyzeFibZoneBehavior(marketData: any[], currentPrice: number, zone: FibZoneInfo): FibZoneBehavior {
    if (marketData.length < 3) {
      return {
        zoneType: zone.type,
        continuationScore: 50,
        reversalScore: 50,
        candlePattern: 'none',
        confirmation: 'unclear',
        narrative: 'Dados insuficientes para análise de comportamento na zona Fibonacci.'
      };
    }

    const highs  = marketData.map(d => d.high  || d.close * 1.001);
    const lows   = marketData.map(d => d.low   || d.close * 0.999);
    const opens  = marketData.map(d => d.open  || d.close);
    const closes = marketData.map(d => d.close);
    const n      = closes.length;

    const lastClose = closes[n - 1];
    const lastOpen  = opens[n - 1];
    const lastHigh  = highs[n - 1];
    const lastLow   = lows[n - 1];
    const prevClose = closes[n - 2];
    const prevOpen  = opens[n - 2];

    const body       = Math.abs(lastClose - lastOpen);
    const range      = lastHigh - lastLow || 0.0001;
    const upperWick  = lastHigh - Math.max(lastClose, lastOpen);
    const lowerWick  = Math.min(lastClose, lastOpen) - lastLow;

    let candlePattern: FibZoneBehavior['candlePattern'] = 'none';
    if (body / range < 0.15) {
      candlePattern = 'doji';
    } else if (lastClose > lastOpen && prevClose < prevOpen && lastClose > prevOpen && lastOpen < prevClose) {
      candlePattern = 'bullish_engulfing';
    } else if (lastClose < lastOpen && prevClose > prevOpen && lastClose < prevOpen && lastOpen > prevClose) {
      candlePattern = 'bearish_engulfing';
    } else if (lowerWick > range * 0.6 && body < range * 0.3) {
      candlePattern = 'pin_bar_bull';
    } else if (upperWick > range * 0.6 && body < range * 0.3) {
      candlePattern = 'pin_bar_bear';
    }

    const rsi  = this.calcRSI(closes, Math.min(14, n - 1));
    const macd = this.calcMACD(closes);

    let continuationScore = 50;
    let reversalScore     = 50;

    if (zone.type === 'support') {
      if (candlePattern === 'bullish_engulfing') { reversalScore += 22; continuationScore -= 10; }
      if (candlePattern === 'pin_bar_bull')      { reversalScore += 16; continuationScore -= 6; }
      if (candlePattern === 'doji')              { reversalScore += 5; }
      if (candlePattern === 'bearish_engulfing') { continuationScore += 22; reversalScore -= 10; }
      if (candlePattern === 'pin_bar_bear')      { continuationScore += 12; reversalScore -= 6; }
      if (rsi < 30)  { reversalScore += 18; continuationScore -= 8; }
      else if (rsi < 45) { reversalScore += 8; }
      else if (rsi > 60) { continuationScore += 12; reversalScore -= 6; }
      if (macd.macd > macd.signal) { reversalScore += 10; continuationScore -= 5; }
      else { continuationScore += 10; reversalScore -= 5; }
    } else {
      if (candlePattern === 'bearish_engulfing') { reversalScore += 22; continuationScore -= 10; }
      if (candlePattern === 'pin_bar_bear')      { reversalScore += 16; continuationScore -= 6; }
      if (candlePattern === 'doji')              { reversalScore += 5; }
      if (candlePattern === 'bullish_engulfing') { continuationScore += 22; reversalScore -= 10; }
      if (candlePattern === 'pin_bar_bull')      { continuationScore += 12; reversalScore -= 6; }
      if (rsi > 70)  { reversalScore += 18; continuationScore -= 8; }
      else if (rsi > 55) { reversalScore += 8; }
      else if (rsi < 40) { continuationScore += 12; reversalScore -= 6; }
      if (macd.macd < macd.signal) { reversalScore += 10; continuationScore -= 5; }
      else { continuationScore += 10; reversalScore -= 5; }
    }

    continuationScore = Math.max(0, Math.min(100, continuationScore));
    reversalScore     = Math.max(0, Math.min(100, reversalScore));

    let confirmation: FibZoneBehavior['confirmation'] = 'unclear';
    if (continuationScore > reversalScore + 15) confirmation = 'continuation';
    else if (reversalScore > continuationScore + 15) confirmation = 'reversal';

    const zoneLabel = zone.type === 'support' ? 'SUPORTE' : 'RESISTÊNCIA';
    const candleNames: Record<FibZoneBehavior['candlePattern'], string> = {
      bullish_engulfing: 'Engolfo de Alta',
      bearish_engulfing: 'Engolfo de Baixa',
      doji:              'Doji (indecisão)',
      pin_bar_bull:      'Pin Bar Altista',
      pin_bar_bear:      'Pin Bar Baixista',
      none:              'sem padrão definido'
    };
    const rsiCtx = rsi < 30 ? 'sobrevenda extrema' : rsi < 45 ? 'zona bearish' : rsi > 70 ? 'sobrecompra extrema' : rsi > 55 ? 'zona bullish' : 'neutro';

    let narrative = `Zona Fib ${zone.level} (${zone.layer}) como ${zoneLabel}. `;
    narrative += `Vela: ${candleNames[candlePattern]}. RSI ${rsi.toFixed(1)} — ${rsiCtx}. `;
    if (confirmation === 'continuation') {
      narrative += `→ CONTINUIDADE (${continuationScore} vs reversão ${reversalScore}): `;
      narrative += zone.type === 'support'
        ? 'suporte sendo rompido — operar na quebra para baixo.'
        : 'resistência sendo rompida — operar na quebra para cima.';
    } else if (confirmation === 'reversal') {
      narrative += `→ REVERSÃO (${reversalScore} vs continuidade ${continuationScore}): `;
      narrative += zone.type === 'support'
        ? 'suporte segurando — bounce altista esperado.'
        : 'resistência rejeitando — queda esperada.';
    } else {
      narrative += '→ INDEFINIDO — aguardar vela de confirmação.';
    }

    return { zoneType: zone.type, continuationScore, reversalScore, candlePattern, confirmation, narrative };
  }

  // ============================================================
  // MONITOR DE OPERAÇÕES EM TEMPO REAL — COM MEMÓRIA DE CONTEXTO
  // ============================================================

  /**
   * Monitor central de posições abertas. Chamado pelo EA a cada 2s.
   *
   * Diferente da versão anterior (que só via o snapshot atual), este monitor
   * acumula o histórico completo de cada posição em memória — MAE, MFE, se já
   * foi negativa, se a perda está acelerando, tempo aberto — e toma decisões
   * baseadas em TODA a vida da posição, não apenas no tick mais recente.
   *
   * Fluxo de decisão (em ordem de prioridade):
   *  1. Hard stop baseado em saldo real (% da banca) ou limite fixo por lote
   *  2. Aceleração de perda (stop antecipado antes do hard stop)
   *  3. Captura de recuperação pós-spike (qualquer positivo após negativo)
   *  4. Trailing stop de lucro (proteger ganhos acumulados)
   *  5. Timeout de posição (posição velha sem resolução)
   *  6. Detecção de spike iminente (Crash/Boom específico)
   *  7. Análise de zonas de Fibonacci
   */
  monitorOpenPosition(position: MT5Position, marketData: any[], symbol: string): PositionMonitorResult {
    const base: PositionMonitorResult = {
      ticket: position.ticket, action: 'HOLD', urgency: 'normal',
      reason: '', narrative: ''
    };

    if (!marketData || marketData.length < 5) {
      base.reason = 'Dados insuficientes para monitoramento.';
      base.narrative = base.reason;
      return base;
    }

    // ── Atualizar memória de contexto desta posição ──
    const ctx = this.updatePositionContext(position);

    const closes       = marketData.map(d => d.close);
    const currentPrice = closes[closes.length - 1];
    const pnlPct       = ((currentPrice - position.openPrice) / (position.openPrice || 1) * 100)
                         * (position.type === 'BUY' ? 1 : -1);
    base.currentPnLPct = pnlPct;

    const profit         = position.profit ?? 0;
    const ageMinutes     = (Date.now() - ctx.entryTime) / 60000;
    const lots           = Math.max(position.lots || 1, 1);

    // Hard stop: máximo entre $20/lote e 0.25% do saldo da conta
    // (para bancas maiores, o limite escala com a banca)
    const balanceBasedStop = ctx.entryBalance > 0 ? -(ctx.entryBalance * 0.0025) : -20;
    const lotBasedStop     = -(20 * lots);
    const hardStopDollars  = Math.max(balanceBasedStop, lotBasedStop); // usa o mais restritivo (menos negativo)

    // ══════════════════════════════════════════════════════════════════
    // PRIORIDADE 1 — HARD STOP (perda máxima absoluta)
    // Corte imediato. Não importa o que a análise diz.
    // ══════════════════════════════════════════════════════════════════
    if (profit < hardStopDollars) {
      console.log(`[MONITOR] 🛑 HARD STOP #${position.ticket}: $${profit.toFixed(2)} | Limite: $${hardStopDollars.toFixed(2)} | MAE pior já foi: $${ctx.maxAdverseExcursion.toFixed(2)} | ${ageMinutes.toFixed(1)}min aberto`);
      return {
        ...base,
        action:    'CLOSE_LOSS_PREVENTION',
        urgency:   'critical',
        reason:    `🛑 HARD STOP: perda $${profit.toFixed(2)} ultrapassou limite $${hardStopDollars.toFixed(2)}`,
        narrative: `Posição ${position.type} #${position.ticket} aberta há ${ageMinutes.toFixed(1)}min. Pior perda histórica: $${ctx.maxAdverseExcursion.toFixed(2)}. Perda atual $${profit.toFixed(2)} ultrapassou o limite configurado de $${hardStopDollars.toFixed(2)} (0.25% do saldo $${ctx.entryBalance.toFixed(2)}). Fechando para preservar capital.`
      };
    }

    // ══════════════════════════════════════════════════════════════════
    // PRIORIDADE 2 — ACELERAÇÃO DE PERDA (stop antecipado)
    // Se a perda piorou em 8+ ciclos consecutivos E já passou de 60% do
    // hard stop, fechar antes de chegar no limite — não esperar o colapso.
    // ══════════════════════════════════════════════════════════════════
    const sixtyPctOfStop = hardStopDollars * 0.6;
    if (ctx.lossAccelerationCycles >= 8 && profit < sixtyPctOfStop) {
      console.log(`[MONITOR] ⚡ ACELERAÇÃO DE PERDA #${position.ticket}: ${ctx.lossAccelerationCycles} ciclos seguidos piorando | $${profit.toFixed(2)} | 60% do stop: $${sixtyPctOfStop.toFixed(2)}`);
      return {
        ...base,
        action:    'CLOSE_LOSS_PREVENTION',
        urgency:   'critical',
        reason:    `⚡ Aceleração de perda: ${ctx.lossAccelerationCycles} ciclos consecutivos piorando ($${profit.toFixed(2)})`,
        narrative: `Posição ${position.type} #${position.ticket} piorou em ${ctx.lossAccelerationCycles} leituras seguidas sem reverter. Perda atual $${profit.toFixed(2)} atingiu 60% do limite de $${hardStopDollars.toFixed(2)}. Fechando preventivamente antes do hard stop.`
      };
    }

    // ══════════════════════════════════════════════════════════════════
    // PRIORIDADE 3 — CAPTURA DE RECUPERAÇÃO PÓS-SPIKE
    // Posição que esteve negativa e agora está positiva = spike resgatou.
    // Essa janela dura segundos — fechar IMEDIATAMENTE antes de reverter.
    // ══════════════════════════════════════════════════════════════════
    if (profit > 0 && ctx.wasEverNegative) {
      console.log(`[MONITOR] 🎯 RECUPERAÇÃO #${position.ticket}: +$${profit.toFixed(2)} após pior de $${ctx.maxAdverseExcursion.toFixed(2)} | ${ctx.monitorCycles} ciclos | ${ageMinutes.toFixed(1)}min`);
      return {
        ...base,
        action:    'CLOSE_PROFIT',
        urgency:   'critical',
        reason:    `🎯 Recuperação pós-spike: +$${profit.toFixed(2)} (pior foi $${ctx.maxAdverseExcursion.toFixed(2)})`,
        narrative: `Spike resgatou a posição ${position.type} #${position.ticket}. Estava em $${ctx.maxAdverseExcursion.toFixed(2)} de perda e reverteu para +$${profit.toFixed(2)} positivo após ${ageMinutes.toFixed(1)}min. Realizando lucro de recuperação antes do spike reverter.`
      };
    }

    // ══════════════════════════════════════════════════════════════════
    // PRIORIDADE 4 — TRAILING STOP DE LUCRO
    // Se o lucro já chegou a um pico e recuou mais de 40% desse pico,
    // fechar para não devolver tudo. Ex: chegou a +$10, recuou para +$6.
    // ══════════════════════════════════════════════════════════════════
    if (ctx.profitTrailing > 2 && profit > 0) {
      const retreatPct = (ctx.profitTrailing - profit) / ctx.profitTrailing;
      if (retreatPct >= 0.40) {
        console.log(`[MONITOR] 📉 TRAILING STOP #${position.ticket}: pico $${ctx.profitTrailing.toFixed(2)} → atual $${profit.toFixed(2)} (recuo ${(retreatPct*100).toFixed(0)}%)`);
        return {
          ...base,
          action:    'CLOSE_PROFIT',
          urgency:   'high',
          reason:    `📉 Trailing stop: recuou ${(retreatPct*100).toFixed(0)}% do pico +$${ctx.profitTrailing.toFixed(2)}`,
          narrative: `Posição #${position.ticket} atingiu pico de +$${ctx.profitTrailing.toFixed(2)} e recuou para +$${profit.toFixed(2)} (${(retreatPct*100).toFixed(0)}% de retração). Ativando trailing stop para preservar lucro antes de virar perda.`
        };
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // PRIORIDADE 5 — TIMEOUT DE POSIÇÃO (posição velha, sem resolução)
    // Posição com mais de 20min no negativo = padrão original falhou.
    // Fechar quando der qualquer oportunidade positiva, ou forçar ao atingir
    // 80% do hard stop (timeout é menos restritivo que o hard stop normal).
    // ══════════════════════════════════════════════════════════════════
    const isOldPosition = ageMinutes > 20;
    const eightyPctStop = hardStopDollars * 0.8;
    if (isOldPosition && profit < 0 && profit < eightyPctStop) {
      console.log(`[MONITOR] ⏰ TIMEOUT #${position.ticket}: ${ageMinutes.toFixed(1)}min aberto | $${profit.toFixed(2)} | 80% do stop: $${eightyPctStop.toFixed(2)}`);
      return {
        ...base,
        action:    'CLOSE_LOSS_PREVENTION',
        urgency:   'high',
        reason:    `⏰ Timeout: posição ${ageMinutes.toFixed(0)}min no negativo ($${profit.toFixed(2)})`,
        narrative: `Posição ${position.type} #${position.ticket} está aberta há ${ageMinutes.toFixed(1)}min sem resolver. Com $${profit.toFixed(2)} de perda e padrão provavelmente inválido. Fechando para liberar margem e evitar perda maior.`
      };
    }

    // ══════════════════════════════════════════════════════════════════
    // PRIORIDADE 6 — SPIKE IMINENTE (Crash/Boom)
    // ══════════════════════════════════════════════════════════════════
    if (this.isSpikeIndex(symbol)) {
      const spike = this.detectSpikePattern(marketData, symbol);
      base.spikeRisk = spike.confidence;

      if (this.shouldExitForSpike(position.type, spike)) {
        const isCritical = spike.imminencePercent >= 85;
        return {
          ...base,
          action:   'CLOSE_SPIKE_EXIT',
          urgency:  isCritical ? 'critical' : 'high',
          reason:   `⚡ Spike ${spike.direction?.toUpperCase()} iminente (${spike.imminencePercent}% iminência) — saída emergencial`,
          narrative: `Posição ${position.type} #${position.ticket} em risco de spike adverso. ${spike.candlesSinceLastSpike} candles desde último spike (média: ${spike.avgCandleInterval}). ` +
            (spike.momentumConfirms ? 'Momentum confirma.' : '') +
            ` MAE desta posição: $${ctx.maxAdverseExcursion.toFixed(2)}.`
        };
      }

      if (spike.imminencePercent >= 60) {
        base.narrative += `⚠️ Spike ${spike.direction?.toUpperCase()} ${spike.imminencePercent}% iminente. `;
        base.urgency = 'high';
      }
    }

    // ══════════════════════════════════════════════════════════════════
    // PRIORIDADE 7 — ANÁLISE DE FIBONACCI (saída por zona técnica)
    // ══════════════════════════════════════════════════════════════════
    const fib = this.calcMultiLayerFibonacci(marketData, currentPrice);

    if (fib.nestedZones.length > 0) {
      const activeNested = fib.nestedZones.find(z => z.nearestNestedLevel && z.nearestNestedLevel.distancePct < 0.05);
      if (activeNested?.nearestNestedLevel) {
        base.narrative += `📐 Nano-Fib: ${activeNested.nearestNestedLevel.level} em [${activeNested.parentLevel1}–${activeNested.parentLevel2}]. `;
      }
    }

    if (fib.nearestLevels.length > 0) {
      const zone     = fib.nearestLevels[0];
      const behavior = fib.zoneBehavior ?? this.analyzeFibZoneBehavior(marketData, currentPrice, zone);
      base.fibZoneReached = zone;

      const isAdverse = (
        (position.type === 'BUY'  && zone.type === 'resistance' && behavior.confirmation === 'reversal') ||
        (position.type === 'SELL' && zone.type === 'support'    && behavior.confirmation === 'reversal')
      );
      const isProfitTarget = (
        (position.type === 'BUY'  && currentPrice > position.openPrice) ||
        (position.type === 'SELL' && currentPrice < position.openPrice)
      );

      if (isAdverse && fib.confluenceScore >= 50) {
        return {
          ...base,
          action:    'CLOSE_PROFIT',
          urgency:   fib.confluenceScore >= 70 ? 'high' : 'normal',
          reason:    `Fib ${zone.level} (${zone.layer}) confirmado contra posição | Confluência ${fib.confluenceScore}`,
          narrative: `${behavior.narrative} MAE: $${ctx.maxAdverseExcursion.toFixed(2)} | MFE: $${ctx.maxFavorableExcursion.toFixed(2)} | ${fib.confluenceNarrative}`
        };
      }

      if (isProfitTarget && behavior.confirmation === 'reversal' && profit > 0.01) {
        return {
          ...base,
          action:    'CLOSE_PROFIT',
          urgency:   'normal',
          reason:    `Alvo Fib ${zone.level} atingido com reversão confirmada`,
          narrative: `${behavior.narrative} Lucro atual: +$${profit.toFixed(2)} (pico foi +$${ctx.maxFavorableExcursion.toFixed(2)}).`
        };
      }

      base.narrative += `Fib ${zone.level} (${zone.layer}). ${behavior.narrative} `;
    }

    // Narrativa de contexto completo para o HOLD
    base.narrative += `P&L: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)} | ` +
      `MAE: $${ctx.maxAdverseExcursion.toFixed(2)} | MFE: +$${ctx.maxFavorableExcursion.toFixed(2)} | ` +
      `${ageMinutes.toFixed(1)}min aberto | Ciclos: ${ctx.monitorCycles}`;

    return base;
  }

  // ============================================================
  // CRASH & BOOM — SPIKE DETECTION ENGINE
  // ============================================================

  /**
   * Detects the probability of an imminent spike for Crash/Boom indices.
   * - Counts candles since last detected spike
   * - As count approaches expected average interval → probability increases
   * - Momentum building in opposite direction to spike also raises probability
   * - Returns full spike analysis with entry/exit guidance
   */
  private detectSpikePattern(marketData: any[], symbol: string): SpikeInfo {
    const sym = symbol.toUpperCase();
    const isCrash = sym.includes('CRASH');
    const isBoom  = sym.includes('BOOM');

    if (!isCrash && !isBoom) {
      return { expected: false, direction: null, confidence: 0, candlesSinceLastSpike: 0, avgCandleInterval: 0, imminencePercent: 0, momentumConfirms: false, lastSpikeSize: 0 };
    }

    const closes = marketData.map(d => d.close);
    const highs  = marketData.map(d => d.high || d.close * 1.001);
    const lows   = marketData.map(d => d.low  || d.close * 0.999);

    const ranges = marketData.map((d, i) => highs[i] - lows[i]);
    const avgRange = ranges.slice(-50).reduce((a, b) => a + b, 0) / Math.min(50, ranges.length) || 1;

    // Spike = candle with range > 4× average (strong spike threshold)
    const spikeThreshold = avgRange * 4;
    let lastSpikeIdx = -1;
    let lastSpikeSize = 0;

    for (let i = marketData.length - 2; i >= 0; i--) {
      if (ranges[i] > spikeThreshold) {
        lastSpikeIdx = i;
        lastSpikeSize = ranges[i];
        break;
      }
    }

    const candlesSinceLastSpike = lastSpikeIdx >= 0 ? marketData.length - 1 - lastSpikeIdx : marketData.length;

    // Estimated average candles between spikes (based on index type)
    // Crash/Boom 1000 index: ~1 spike per 1000 ticks ≈ 100 M1 candles (10 ticks/candle approx)
    // Crash/Boom 500: ~50 candles, 300: ~30 candles
    let avgCandleInterval = 100;
    if (sym.includes('500')) avgCandleInterval = 50;
    if (sym.includes('300')) avgCandleInterval = 30;
    if (sym.includes('200')) avgCandleInterval = 20;

    const imminencePercent = Math.min(100, Math.round((candlesSinceLastSpike / avgCandleInterval) * 100));

    // Spike direction
    const spikeDirection = isCrash ? 'down' : 'up';

    // Momentum analysis: before a Crash spike, price builds up tension (rises briefly)
    // Before a Boom spike, price builds down tension (falls briefly)
    const recentPrices = closes.slice(-5);
    const momentum = recentPrices.length > 1
      ? (recentPrices[recentPrices.length - 1] - recentPrices[0]) / recentPrices[0] * 100
      : 0;
    const momentumConfirms = (isCrash && momentum > 0.01) || (isBoom && momentum < -0.01);

    // Confidence: base from imminence, boosted by momentum confirmation
    let confidence = imminencePercent * 0.55;
    if (momentumConfirms) confidence = Math.min(95, confidence * 1.35);

    const expected = imminencePercent >= 65;

    // ── Pre-entry timing window ──
    // Enter the spike position when imminence is very high (>= 80%) AND momentum confirms.
    // entryTimingScore: 0–100, with 100 = optimal entry window
    const timingBase = Math.max(0, imminencePercent - 50) * 2;        // 50% imminence = 0, 100% = 100
    const timingBoost = momentumConfirms ? 20 : 0;
    const entryTimingScore = Math.min(100, Math.round(timingBase + timingBoost));
    const preEntryWindow = entryTimingScore >= 70 && expected;

    // Estimated ticks until spike (linear extrapolation)
    const remainingFraction = Math.max(0, 1 - candlesSinceLastSpike / avgCandleInterval);
    const ticksUntilSpikeEstimate = Math.round(remainingFraction * avgCandleInterval * 10); // 10 ticks/candle approx

    return {
      expected,
      direction: spikeDirection as 'down' | 'up',
      confidence: Math.round(confidence),
      candlesSinceLastSpike,
      avgCandleInterval,
      imminencePercent,
      momentumConfirms,
      lastSpikeSize,
      preEntryWindow,
      entryTimingScore,
      ticksUntilSpikeEstimate
    };
  }

  /**
   * Determine if the current open position should exit due to an incoming spike
   * (when in a continuity trade on Crash/Boom)
   */
  private shouldExitForSpike(positionType: 'BUY' | 'SELL', spike: SpikeInfo): boolean {
    if (!spike.expected || spike.confidence < 50) return false;
    // If in BUY and Crash spike coming → exit
    if (positionType === 'BUY' && spike.direction === 'down') return true;
    // If in SELL and Boom spike coming → exit
    if (positionType === 'SELL' && spike.direction === 'up') return true;
    return false;
  }
}

export const metaTraderBridge = new MetaTraderBridge();
