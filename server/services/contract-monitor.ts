/**
 * MONITOR UNIVERSAL DE CONTRATOS — InvistaPRO
 * 
 * Acompanha cada operação aberta tick a tick como um trader humano expert,
 * com inteligência específica para cada modalidade da Deriv.
 * 
 * Modalidades suportadas:
 *   ACCU        — Accumulator: fecha no alvo de lucro ou reversão
 *   MULT        — Multiplier: gerencia stop/take_profit dinâmico  
 *   CALL/PUT    — Rise/Fall: venda antecipada no momento ideal
 *   TURBOSLONG/TURBOSSHORT — Turbo: evita breach de barreira
 *   VANILLACALL/VANILLAPUT — Vanilla: monitora moneyness e delta
 *   DIGITDIFF/OVER/UNDER/MATCH/EVEN/ODD — Digit: auto-fecha (monitora)
 *   LBFLOATPUT/LBFLOATCALL/LBHIGHLOW — Lookback: auto-expira (monitora)
 *   ONETOUCH/NOTOUCH/RANGE/EXPIRYRANGE — Barrier: vende se lucrativo
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { marketDataCollector } from './market-data-collector';
import { supremeAnalyzer, SupremeAnalysis, MarketRegime } from './supreme-market-analyzer';
import { dualStorage as storage } from '../storage-dual';

// ─────────────────────────── Tipos ───────────────────────────

export interface MonitoredContractInput {
  contractId: number;
  contractType: string;       // e.g., ACCU, CALL, PUT, TURBOSLONG, etc.
  symbol: string;
  buyPrice: number;
  amount: number;
  direction?: 'up' | 'down' | 'neutral';
  userId: string;
  openedAt: number;           // timestamp ms
  growthRate?: number;        // para ACCU
  multiplier?: number;        // para MULT
  barrier?: string;           // barreira do contrato
  highBarrier?: string;
  lowBarrier?: string;
  dateExpiry?: number;        // timestamp unix para contratos com prazo
  targetTicks?: number;       // ⚡ ACCU MODO-OPS: vender automaticamente após N ticks (1 ou 2)
}

interface AITickSnapshot {
  regime: string;
  hurst: number;
  entropy: number;
  volatilityZ: number;
  convergence: number;
  strength: number;
  trend: string;
  holdSignal: boolean;
  exitReason: string;
  urgency: string;
  reversalDetected: boolean;
  profitTarget: number;
  trailingStop: number;
  barrierDanger: number;
  currentDecision: string;
  decisionReason: string;
  confirmedReversal: boolean;
  ts: number;
}

interface ContractState {
  input: MonitoredContractInput;
  bidPrice: number;
  currentSpot: number;
  entrySpot: number;
  profit: number;
  profitPct: number;
  isValidToSell: boolean;
  isSold: boolean;
  isExpired: boolean;
  barrierValue?: number;
  barrierDistance?: number;   // % distância do barrier ao spot
  barrierDistanceHistory: number[]; // histórico de distância da barreira por tick
  tickCount: number;
  lastUpdate: number;
  subscriptionId?: string;
  aiSignalBuffer: Array<{ ts: number; direction: 'up' | 'down' | 'neutral'; strength: number }>;
  peakProfit: number;         // maior lucro já visto
  peakBidPrice: number;
  targetTicksReached: boolean; // ⚡ ACCU-AUTOSELL: flag ativado quando tickCount >= targetTicks (persiste até venda)
  status: 'monitoring' | 'closing' | 'closed';
  closingSince?: number;      // timestamp ms quando status mudou para 'closing' (para timeout de retry)
  aiSnapshot?: AITickSnapshot;
  openReason?: string;
  spotHistory: number[];      // histórico de spots do próprio contrato desde a entrada
  // CORREÇÃO: venda urgente enfileirada quando isValidToSell=false no momento da decisão
  // Executada imediatamente no próximo tick em que isValidToSell=true — evita perda de trailing stop
  pendingUrgentSell?: { reason: string; urgency: 'high' | 'emergency'; queuedAt: number };
}

interface SellDecision {
  shouldSell: boolean;
  reason: string;
  urgency: 'low' | 'medium' | 'high' | 'emergency';
}

// ─────────────────── Constantes por modalidade ───────────────────

const CONTRACT_CATEGORIES = {
  // Precisa fechamento manual — principal alvo do monitor
  MANUAL_CLOSE: ['ACCU', 'MULTUP', 'MULTDOWN'],

  // Pode vender antecipado mas também expira automaticamente
  EARLY_SELL: [
    'CALL', 'PUT', 'RISE', 'FALL',
    'TURBOSLONG', 'TURBOSSHORT',
    'VANILLACALL', 'VANILLAPUT',
    'ONETOUCH', 'NOTOUCH',
    'RANGE', 'EXPIRYRANGE', 'EXPIRYMISS', 'UPORDOWN',
    'CALLE', 'PUTE',
  ],

  // Auto-fecham: apenas monitora resultado
  AUTO_CLOSE: [
    'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER',
    'DIGITMATCH', 'DIGITEVEN', 'DIGITODD',
    'LBFLOATPUT', 'LBFLOATCALL', 'LBHIGHLOW',
  ],
};

function getCategory(contractType: string): 'MANUAL_CLOSE' | 'EARLY_SELL' | 'AUTO_CLOSE' {
  const t = contractType.toUpperCase();
  if (CONTRACT_CATEGORIES.MANUAL_CLOSE.includes(t)) return 'MANUAL_CLOSE';
  if (CONTRACT_CATEGORIES.AUTO_CLOSE.includes(t)) return 'AUTO_CLOSE';
  return 'EARLY_SELL';
}

// ─────────────────── Limiares por modalidade ───────────────────

interface ExitThresholds {
  profitTargetPct: number;      // fechar quando lucro atingir X%
  trailingStopPct: number;      // fechar se cair X% do pico
  barrierDangerPct: number;     // fechar se barreira < X% do spot
  maxDurationMin: number;       // fechar após N minutos independente
  earlyLossExitPct: number;     // fechar se perda > X% (corte de perda)
  aiReversalStrength: number;   // força mínima do sinal de reversão p/ fechar
  minTicksBeforeSell: number;   // ticks mínimos antes de poder fechar
}

function getThresholds(contractType: string): ExitThresholds {
  const t = contractType.toUpperCase();
  switch (t) {
    case 'ACCU':
      return {
        profitTargetPct: 15,      // 15% de lucro → fecha (barreira pode bater antes de chegar em 40%)
        trailingStopPct: 5,       // cair 5% do pico → fecha (trailing agressivo para proteger ganhos)
        barrierDangerPct: 0.8,    // barreira a <0.8% → urgente (margem maior de segurança)
        maxDurationMin: 10,       // máx 10 min (menos tempo para reduzir risco de barreira)
        earlyLossExitPct: 999,    // ACCU não tem perda negativa (perde o stake se cruzar)
        aiReversalStrength: 60,   // sinal mais sensível para saída antecipada
        minTicksBeforeSell: 5,
      };
    case 'MULTUP':
    case 'MULTDOWN':
      return {
        profitTargetPct: 60,
        trailingStopPct: 20,
        barrierDangerPct: 1.0,
        maxDurationMin: 20,
        earlyLossExitPct: 40,     // sai se perder 40% do stake
        aiReversalStrength: 65,
        minTicksBeforeSell: 3,
      };
    case 'TURBOSLONG':
    case 'TURBOSSHORT':
      return {
        profitTargetPct: 50,
        trailingStopPct: 25,
        barrierDangerPct: 1.5,    // turbos têm barreira próxima
        maxDurationMin: 10,
        earlyLossExitPct: 50,
        aiReversalStrength: 75,
        minTicksBeforeSell: 3,
      };
    case 'VANILLACALL':
    case 'VANILLAPUT':
      return {
        profitTargetPct: 80,
        trailingStopPct: 30,
        barrierDangerPct: 2.0,
        maxDurationMin: 60,
        earlyLossExitPct: 60,
        aiReversalStrength: 70,
        minTicksBeforeSell: 5,
      };
    case 'CALL':
    case 'PUT':
    case 'RISE':
    case 'FALL':
    case 'CALLE':
    case 'PUTE':
      return {
        profitTargetPct: 70,      // 70% de lucro sobre o payout
        trailingStopPct: 20,
        barrierDangerPct: 0,      // sem barreira física
        maxDurationMin: 30,
        earlyLossExitPct: 75,     // corta perda se bid cair 75%
        aiReversalStrength: 72,
        minTicksBeforeSell: 5,
      };
    case 'ONETOUCH':
      // Preço chegando perto da barreira = ÓTIMO (vai ganhar!) → barrierDangerPct=0 (não vender por proximidade)
      return {
        profitTargetPct: 65,
        trailingStopPct: 12,
        barrierDangerPct: 0,       // barreira próxima = vitória iminente — NUNCA vender por esse motivo
        maxDurationMin: 30,
        earlyLossExitPct: 70,
        aiReversalStrength: 70,
        minTicksBeforeSell: 4,
      };
    case 'NOTOUCH':
      // Barreira começa a ~0.3% — só vender se estiver a <0.08% (quase tocando)
      return {
        profitTargetPct: 65,
        trailingStopPct: 12,
        barrierDangerPct: 0.08,    // 0.3% inicial: só dispara quando spot está literalmente prestes a tocar
        maxDurationMin: 30,
        earlyLossExitPct: 70,
        aiReversalStrength: 70,
        minTicksBeforeSell: 4,
      };
    case 'RANGE':
    case 'EXPIRYRANGE':
    case 'EXPIRYMISS':
    case 'UPORDOWN':
      return {
        profitTargetPct: 65,
        trailingStopPct: 12,
        barrierDangerPct: 0.5,
        maxDurationMin: 30,
        earlyLossExitPct: 70,
        aiReversalStrength: 70,
        minTicksBeforeSell: 4,
      };
    default:
      return {
        profitTargetPct: 60,
        trailingStopPct: 20,
        barrierDangerPct: 1.0,
        maxDurationMin: 20,
        earlyLossExitPct: 50,
        aiReversalStrength: 70,
        minTicksBeforeSell: 5,
      };
  }
}

// ─────────── Sinal de Saída Supremo — 10 Dimensões Simultâneas ────────────

interface SupremeExitSignal {
  reversalDetected: boolean;
  strength: number;           // 0-100
  trend: 'up' | 'down' | 'neutral';
  urgency: 'low' | 'medium' | 'high' | 'emergency';
  holdSignal: boolean;        // motor diz AGUARDAR, não fechar
  exitReason: string;
  regime: MarketRegime | 'unknown';
  hurst: number;
  convergence: number;
}

function computeSupremeExitSignal(
  symbol: string,
  recentPrices: number[],
  direction: 'up' | 'down' | 'neutral',
  currentProfitPct: number,
): SupremeExitSignal {
  const DEFAULT: SupremeExitSignal = {
    reversalDetected: false, strength: 0, trend: 'neutral',
    urgency: 'low', holdSignal: false, exitReason: '',
    regime: 'unknown', hurst: 0.5, convergence: 50,
  };

  // ── Fallback local simples se o Motor Supremo ainda não tem dados ──────────
  const calcEma = (data: number[], period: number): number => {
    const k = 2 / (period + 1);
    let e = data[0];
    for (let i = 1; i < data.length; i++) e = data[i] * k + e * (1 - k);
    return e;
  };

  const sa: SupremeAnalysis | null = supremeAnalyzer.getLatestAnalysis(symbol);
  if (!sa) {
    // Usar lógica local básica como fallback
    if (recentPrices.length < 8) return DEFAULT;
    const prices = recentPrices.slice(-20);
    const n = prices.length;
    const emaFast = calcEma(prices, Math.min(5, n));
    const emaSlow = calcEma(prices, Math.min(15, n));
    const trend: 'up' | 'down' | 'neutral' = emaFast > emaSlow * 1.0001 ? 'up' : emaFast < emaSlow * 0.9999 ? 'down' : 'neutral';
    let gains = 0, losses = 0;
    for (let i = Math.max(1, n - 7); i < n; i++) {
      const d = prices[i] - prices[i - 1];
      if (d > 0) gains += d; else losses -= d;
    }
    const rsi = 100 - 100 / (1 + (losses === 0 ? 100 : gains / losses));
    const m3 = (prices[n - 1] - prices[Math.max(0, n - 4)]) / prices[Math.max(0, n - 4)];
    let strength = 0;
    let reversalDetected = false;
    if (direction === 'up') {
      strength = ((rsi > 65 ? (rsi - 65) / 35 : 0) * 30 + (m3 < -0.001 ? Math.min(1, Math.abs(m3) / 0.01) : 0) * 40 + (trend === 'down' ? 0.8 : 0) * 30);
      reversalDetected = strength > 50 && trend === 'down';
    } else if (direction === 'down') {
      strength = ((rsi < 35 ? (35 - rsi) / 35 : 0) * 30 + (m3 > 0.001 ? Math.min(1, m3 / 0.01) : 0) * 40 + (trend === 'up' ? 0.8 : 0) * 30);
      reversalDetected = strength > 50 && trend === 'up';
    }
    return { ...DEFAULT, reversalDetected, strength, trend };
  }

  // ══════════════════════════════════════════════════════════════
  //  MOTOR SUPREMO ATIVO — 10 DIMENSÕES ANALISANDO O CONTRATO
  // ══════════════════════════════════════════════════════════════

  const { statistics, multiTimeframe, microstructure, spectral, regime, regimeConfidence, opportunityDirection } = sa;
  const { hurstExponent, shannonEntropy, autocorrelation, zScoreVolatility, skewness, kurtosis } = statistics;
  const { convergence, dominantTrend, tf1s, tf5s, tf30s } = multiTimeframe;
  const { reversalProbability, tickClusterDirection, tickClusterStreak } = microstructure;

  // Determinar se os timeframes convergem CONTRA ou A FAVOR do contrato
  const tfsAgainst = [tf1s, tf5s, tf30s].filter(tf =>
    (direction === 'up' && tf.trend === 'down') ||
    (direction === 'down' && tf.trend === 'up')
  ).length;
  const tfsInFavor = [tf1s, tf5s, tf30s].filter(tf =>
    (direction === 'up' && tf.trend === 'up') ||
    (direction === 'down' && tf.trend === 'down')
  ).length;

  // Cluster de ticks opondo ao contrato
  const clusterOpposing = tickClusterStreak >= 4 && (
    (direction === 'up' && tickClusterDirection === 'down') ||
    (direction === 'down' && tickClusterDirection === 'up')
  );

  // Score de reversão supremo — ponderação das 10 dimensões
  let reversalScore = 0;

  // 1. Hurst: <0.4 = mean-reverting (reversão iminente) | >0.6 = tendência (segurar)
  if (hurstExponent < 0.35) reversalScore += 25;      // mercado muito mean-reverting
  else if (hurstExponent < 0.45) reversalScore += 12;
  else if (hurstExponent > 0.65) reversalScore -= 20; // tendência forte → aguardar

  // 2. Autocorrelação: negativa = reversão, positiva = continuação
  if (autocorrelation < -0.4) reversalScore += 20;
  else if (autocorrelation < -0.2) reversalScore += 10;
  else if (autocorrelation > 0.4) reversalScore -= 15; // continuação → aguardar

  // 3. Reversão micro-estrutural
  if (reversalProbability > 75) reversalScore += 25;
  else if (reversalProbability > 55) reversalScore += 12;
  else if (reversalProbability < 25) reversalScore -= 10;

  // 4. Cluster de ticks opondo
  if (clusterOpposing) reversalScore += 20;

  // 5. Multi-timeframe convergência CONTRA o contrato
  if (tfsAgainst >= 3) reversalScore += 30;
  else if (tfsAgainst === 2) reversalScore += 15;
  if (tfsInFavor >= 3) reversalScore -= 20; // forte convergência a favor → aguardar

  // 6. Regime de mercado
  if (regime === 'chaotic') reversalScore += 15;       // caótico → defensivo
  if (regime === 'ranging') reversalScore += 10;       // ranging → vai reverter
  if (regime === 'strong_trend') reversalScore -= 15;  // tendência forte → aguardar
  if (regime === 'calm') reversalScore -= 5;

  // 7. Volatilidade anômala (z-score alto = movimento brusco)
  if (zScoreVolatility > 2.5) reversalScore += 15;
  else if (zScoreVolatility > 1.5) reversalScore += 8;

  // 8. Entropia alta = caos, difícil prever → defensivo
  if (shannonEntropy > 0.75) reversalScore += 10;
  else if (shannonEntropy < 0.3) reversalScore -= 5;  // previsível → confiar na posição

  // 9. Kurtosis alta = caudas pesadas = movimento brusco iminente
  if (kurtosis > 5) reversalScore += 10;

  // 10. Ciclo espectral: se estamos em pico/trough adverso
  if (spectral.dominantCycle) {
    const phase = spectral.dominantCycle.phase;
    if ((direction === 'up' && phase === 'peak') ||
        (direction === 'down' && phase === 'trough')) {
      reversalScore += 15 * spectral.cyclePower / 100;
    }
    if ((direction === 'up' && phase === 'rising') ||
        (direction === 'down' && phase === 'falling')) {
      reversalScore -= 10 * spectral.cyclePower / 100;
    }
  }

  // Normalizar 0-100
  reversalScore = Math.max(0, Math.min(100, reversalScore));

  // Determinar tendência dominante atual
  const trend: 'up' | 'down' | 'neutral' = dominantTrend === 'sideways' ? 'neutral' : dominantTrend;

  // Decisão de HOLD: manter o contrato aberto
  const holdSignal = (
    (hurstExponent > 0.62 && tfsInFavor >= 2 && regime === 'strong_trend') ||
    (autocorrelation > 0.35 && reversalProbability < 30) ||
    (tfsInFavor >= 3 && reversalProbability < 40)
  );

  // Reversão detectada
  const reversalDetected = reversalScore >= 50 && !holdSignal;

  // Urgência baseada no score + regime
  let urgency: SupremeExitSignal['urgency'] = 'low';
  if (reversalScore >= 80 || (regime === 'chaotic' && tfsAgainst >= 2)) urgency = 'emergency';
  else if (reversalScore >= 65) urgency = 'high';
  else if (reversalScore >= 50) urgency = 'medium';

  // Motivo legível
  let exitReason = '';
  if (reversalDetected) {
    const reasons: string[] = [];
    if (hurstExponent < 0.4) reasons.push(`Hurst=${hurstExponent.toFixed(2)} mean-reverting`);
    if (autocorrelation < -0.3) reasons.push(`autocorr=${autocorrelation.toFixed(2)} reversão serial`);
    if (reversalProbability > 55) reasons.push(`prob.reversão=${reversalProbability.toFixed(0)}%`);
    if (clusterOpposing) reasons.push(`cluster ${tickClusterStreak} ticks opostos`);
    if (tfsAgainst >= 2) reasons.push(`${tfsAgainst}/3 timeframes contra`);
    if (regime === 'chaotic') reasons.push(`regime=caótico`);
    if (regime === 'ranging') reasons.push(`regime=ranging`);
    exitReason = `🧠 SUPREMO: ${reasons.join(' | ')} [score=${reversalScore.toFixed(0)}]`;
  }

  const holdReason = holdSignal
    ? ` [HOLD: H=${hurstExponent.toFixed(2)} tf_favor=${tfsInFavor}/3]`
    : '';

  return {
    reversalDetected,
    strength: reversalScore,
    trend,
    urgency,
    holdSignal,
    exitReason: exitReason + holdReason,
    regime,
    hurst: hurstExponent,
    convergence,
  };
}

// ── Limiares Adaptativos pelo Motor Supremo ──────────────────

function getAdaptiveThresholds(base: ExitThresholds, symbol: string, currentProfitPct: number): ExitThresholds {
  const sa: SupremeAnalysis | null = supremeAnalyzer.getLatestAnalysis(symbol);
  if (!sa) return base;

  const { hurstExponent, shannonEntropy, zScoreVolatility, autocorrelation } = sa.statistics;
  const { regime } = sa;

  let profitTargetPct   = base.profitTargetPct;
  let trailingStopPct   = base.trailingStopPct;
  let barrierDangerPct  = base.barrierDangerPct;
  let maxDurationMin    = base.maxDurationMin;
  let earlyLossExitPct  = base.earlyLossExitPct;
  let aiReversalStrength = base.aiReversalStrength;

  // ── Regime de mercado ────────────────────────────────────────
  if (regime === 'strong_trend') {
    // Tendência forte → aguardar mais lucro, mas trailing permanece firme para preservar ganhos
    profitTargetPct   *= 1.4;    // +40% alvo
    trailingStopPct   *= 1.0;    // trailing mantido: não abrir mão do lucro acumulado
    maxDurationMin    *= 1.3;    // mais tempo
    aiReversalStrength *= 1.1;   // exigir sinal mais forte para fechar
  } else if (regime === 'weak_trend') {
    profitTargetPct   *= 1.1;
    trailingStopPct   *= 1.05;
  } else if (regime === 'ranging') {
    // Mercado oscilando → realizar lucro mais cedo
    profitTargetPct   *= 0.75;   // -25% alvo (sair mais cedo)
    trailingStopPct   *= 0.80;   // trailing mais apertado
    maxDurationMin    *= 0.8;
    aiReversalStrength *= 0.9;
  } else if (regime === 'chaotic') {
    // Caótico → modo defensivo extremo
    profitTargetPct   *= 0.6;
    trailingStopPct   *= 0.65;
    maxDurationMin    *= 0.6;
    earlyLossExitPct  *= 0.7;
    aiReversalStrength *= 0.8;
  } else if (regime === 'calm') {
    // Calmo → segurar, baixo risco
    profitTargetPct   *= 1.15;
    trailingStopPct   *= 1.1;
  }

  // ── Hurst Exponent ──────────────────────────────────────────
  if (hurstExponent < 0.40) {
    // Mean-reverting: sair mais rápido
    profitTargetPct  *= 0.85;
    trailingStopPct  *= 0.80;
  } else if (hurstExponent > 0.65) {
    // Tendência forte: segurar mais
    profitTargetPct  *= 1.2;
    trailingStopPct  *= 1.15;
  }

  // ── Entropia de Shannon ─────────────────────────────────────
  if (shannonEntropy > 0.75) {
    // Alta entropia = caos = apertar proteções
    trailingStopPct  *= 0.85;
    aiReversalStrength *= 0.9;
  } else if (shannonEntropy < 0.30) {
    // Baixa entropia = previsível = confiar na posição
    trailingStopPct  *= 1.1;
  }

  // ── Volatilidade Anômala ────────────────────────────────────
  if (zScoreVolatility > 2.0) {
    // Spike de volatilidade → apertar tudo
    trailingStopPct  *= 0.80;
    maxDurationMin   *= 0.85;
  }

  // ── Autocorrelação ──────────────────────────────────────────
  if (autocorrelation < -0.35) {
    // Reversão serial confirmada → ser mais rápido a fechar
    profitTargetPct  *= 0.9;
    trailingStopPct  *= 0.85;
    aiReversalStrength *= 0.9;
  } else if (autocorrelation > 0.35) {
    // Continuação → aguardar mais
    profitTargetPct  *= 1.1;
  }

  return {
    ...base,
    profitTargetPct:   Math.max(8,  Math.min(150, profitTargetPct)),
    trailingStopPct:   Math.max(5,  Math.min(50,  trailingStopPct)),
    barrierDangerPct,
    maxDurationMin:    Math.max(3,  Math.min(90,  maxDurationMin)),
    earlyLossExitPct:  Math.max(10, Math.min(80,  earlyLossExitPct)),
    aiReversalStrength: Math.max(40, Math.min(90, aiReversalStrength)),
  };
}

// ─────────────────── Classe principal ───────────────────

interface RecentlyClosedEntry {
  state: ContractState;
  closedAt: number;
  finalResult: 'won' | 'lost' | 'sold';
  finalProfit: number;
}

class UniversalContractMonitor extends EventEmitter {
  private monitored = new Map<number, ContractState>();
  private recentlyClosed = new Map<number, RecentlyClosedEntry>();
  private ws: WebSocket | null = null;
  private apiToken: string | null = null;
  private connected = false;
  private reconnecting = false;
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private reqIdCounter = 1000000;
  private pendingSubAcks = new Map<number, number>(); // reqId → contractId
  private pendingSellReqs = new Map<number, number>(); // reqId → contractId (rastreia vendas em andamento)
  private isShuttingDown = false;
  private orphanScanTimer: NodeJS.Timeout | null = null;
  private readonly RECENTLY_CLOSED_TTL_MS = 120000; // 2 minutes

  constructor() {
    super();
    this.setMaxListeners(50);
    this.startOrphanScan();
  }

  // ── Recuperação de contratos órfãos (hibernação/reconexão) ──

  private startOrphanScan(): void {
    if (this.orphanScanTimer) return;
    // Varredura a cada 60s para recuperar rapidamente qualquer contrato perdido
    this.orphanScanTimer = setInterval(() => this.recoverOrphanedContracts(), 60 * 1000);
    // Execução imediata ao iniciar (após 5s para dar tempo ao WS conectar)
    setTimeout(() => this.recoverOrphanedContracts(), 5000);
    console.log('🔍 [MONITOR] Scanner de contratos órfãos iniciado (varredura a cada 60s + imediata ao iniciar)');
  }

  private async recoverOrphanedContracts(): Promise<void> {
    try {
      const allUsers = await storage.getAllUsers();
      let recovered = 0;
      for (const user of allUsers) {
        // ── CRÍTICO: garantir que o monitor tem token ANTES de tentar conectar ──
        // Sem token, o WebSocket não consegue autenticar e os contratos ficam sem monitoramento
        if (!this.apiToken) {
          try {
            const tokenData = await storage.getUserDerivToken(user.id);
            if (tokenData?.token) {
              this.apiToken = tokenData.token;
              console.log(`🔑 [MONITOR] Token inicializado para ${user.id} — monitor pode conectar WebSocket`);
            }
          } catch {
            // Token não encontrado para este usuário — continua para próximo
          }
        }

        // Buscar tanto 'active' quanto 'pending' — contratos novos começam como pending
        const activeOps = await storage.getActiveTradeOperations(user.id);
        const recentOps = await storage.getUserTradeOperations(user.id, 20);
        const pendingOps = recentOps.filter(op => op.status === 'pending');

        // Unificar sem duplicatas
        const seenIds = new Set<string>();
        const openOps = [...activeOps, ...pendingOps].filter(op => {
          if (!op.id || seenIds.has(op.id)) return false;
          seenIds.add(op.id);
          return true;
        });

        for (const op of openOps) {
          if (!op.derivContractId) continue;
          const contractId = Number(op.derivContractId);
          if (!contractId || this.monitored.has(contractId) || this.recentlyClosed.has(contractId)) continue;

          // Ignorar contratos muito antigos (mais de 2h sem fechar = provavelmente já expirou)
          const openedAt = op.entryEpoch ? op.entryEpoch * 1000 : (op.createdAt ? new Date(op.createdAt).getTime() : Date.now());
          const ageMs = Date.now() - openedAt;
          if (ageMs > 2 * 60 * 60 * 1000) {
            console.log(`⏭️ [MONITOR] Ignorando contrato antigo ${contractId} (${Math.round(ageMs / 60000)}min) — provavelmente já expirou`);
            continue;
          }

          // Buscar token específico do usuário deste contrato se ainda não temos
          if (!this.apiToken) {
            try {
              const tokenData = await storage.getUserDerivToken(op.userId || user.id);
              if (tokenData?.token) {
                this.apiToken = tokenData.token;
                console.log(`🔑 [MONITOR] Token inicializado via contrato ${contractId} do usuário ${op.userId || user.id}`);
              }
            } catch { /* sem token, monitor em standby para este contrato */ }
          }

          const contractTypeRaw = (op.contractType || op.tradeType || 'CALL').toUpperCase();
          console.log(`♻️ [MONITOR] Recuperando contrato órfão: ${contractId} | ${contractTypeRaw} | ${op.symbol} | status=${op.status}`);
          try {
            await this.startMonitoring({
              contractId,
              contractType: contractTypeRaw,
              symbol: op.symbol,
              buyPrice: op.buyPrice ?? op.amount ?? 1,
              amount: op.amount ?? 1,
              direction: (op.direction as 'up' | 'down' | 'neutral') ?? 'neutral',
              userId: user.id,
              openedAt,
            });
            recovered++;
          } catch (err: any) {
            console.warn(`⚠️ [MONITOR] Falha ao recuperar ${contractId}: ${err?.message}`);
          }
        }
      }
      if (recovered > 0) {
        console.log(`✅ [MONITOR] ${recovered} contrato(s) órfão(s) recuperado(s) e remonitorado(s)`);
      } else {
        console.log('🔍 [MONITOR] Nenhum contrato órfão encontrado nesta varredura');
      }
    } catch (err: any) {
      console.warn(`⚠️ [MONITOR] Erro na varredura de órfãos: ${err?.message}`);
    }
  }

  // ── API Pública ──────────────────────────────────────────

  setToken(token: string): void {
    this.apiToken = token;
  }

  async startMonitoring(input: MonitoredContractInput): Promise<void> {
    if (this.monitored.has(input.contractId)) {
      console.log(`📡 [MONITOR] Contrato ${input.contractId} já monitorado`);
      return;
    }

    const category = getCategory(input.contractType);
    console.log(`🔭 [MONITOR] Iniciando monitoramento: ${input.contractId} | ${input.contractType} | ${input.symbol} | Categoria: ${category}`);

    const state: ContractState = {
      input,
      bidPrice: input.buyPrice,
      currentSpot: 0,
      entrySpot: 0,
      profit: 0,
      profitPct: 0,
      isValidToSell: false,
      isSold: false,
      isExpired: false,
      tickCount: 0,
      lastUpdate: Date.now(),
      aiSignalBuffer: [],
      peakProfit: 0,
      peakBidPrice: input.buyPrice,
      targetTicksReached: false,
      status: 'monitoring',
      spotHistory: [],
      barrierDistanceHistory: [],
    };

    this.monitored.set(input.contractId, state);

    // Conectar se necessário e subscrever
    await this.ensureConnected();
    this.subscribeToContract(input.contractId);

    // Para contratos auto-close, agendar cleanup
    if (category === 'AUTO_CLOSE') {
      const thresholds = getThresholds(input.contractType);
      setTimeout(() => this.stopMonitoring(input.contractId), thresholds.maxDurationMin * 60 * 1000 + 30000);
    }
  }

  stopMonitoring(contractId: number): void {
    const state = this.monitored.get(contractId);
    if (!state) return;

    // Dessubscrever
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ forget: state.subscriptionId }));
    }

    this.monitored.delete(contractId);
    console.log(`🔭 [MONITOR] Monitoramento encerrado: ${contractId} | Status: ${state.status}`);
  }

  getMonitoredContracts(): Array<{ contractId: number; state: ContractState; finalResult?: string; finalProfit?: number; closedAt?: number }> {
    const active = Array.from(this.monitored.entries()).map(([id, s]) => ({ contractId: id, state: s }));
    const recent = Array.from(this.recentlyClosed.entries()).map(([id, entry]) => ({
      contractId: id,
      state: entry.state,
      finalResult: entry.finalResult,
      finalProfit: entry.finalProfit,
      closedAt: entry.closedAt,
    }));
    return [...active, ...recent];
  }

  getContractState(contractId: number): ContractState | undefined {
    return this.monitored.get(contractId);
  }

  /**
   * Retorna true se já existe um contrato ativo sendo monitorado no símbolo informado.
   * Usado pelo scheduler para BLOQUEAR a abertura de um segundo contrato no mesmo ativo.
   */
  hasActiveContractOnSymbol(symbol: string): boolean {
    for (const [, state] of this.monitored) {
      if (state.input.symbol === symbol && !state.isSold && !state.isExpired) {
        return true;
      }
    }
    return false;
  }

  /**
   * Retorna quantos contratos estão ativamente sendo monitorados (não encerrados).
   * Usado pelo scheduler para limitar o número de operações abertas simultâneas.
   */
  getOpenContractCount(): number {
    let count = 0;
    for (const [, state] of this.monitored) {
      if (!state.isSold && !state.isExpired) count++;
    }
    return count;
  }

  /**
   * Retorna o ID do contrato ativo no símbolo informado (para log).
   */
  getActiveContractIdOnSymbol(symbol: string): number | undefined {
    for (const [contractId, state] of this.monitored) {
      if (state.input.symbol === symbol && !state.isSold && !state.isExpired) {
        return contractId;
      }
    }
    return undefined;
  }

  // ── WebSocket interno ────────────────────────────────────

  private async ensureConnected(): Promise<void> {
    if (this.connected) return;
    if (this.reconnecting) {
      // Esperar conexão atual
      await new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (this.connected) { clearInterval(check); resolve(); }
        }, 200);
        setTimeout(() => { clearInterval(check); resolve(); }, 8000);
      });
      return;
    }
    await this.connect();
  }

  private async connect(): Promise<void> {
    if (!this.apiToken) {
      console.warn('⚠️ [MONITOR] Sem API token — monitor em modo standby');
      return;
    }

    this.reconnecting = true;
    console.log('🔌 [MONITOR] Conectando WebSocket dedicado...');

    return new Promise((resolve) => {
      const ws = new WebSocket('wss://ws.derivws.com/websockets/v3?app_id=1089');
      this.ws = ws;

      const timeout = setTimeout(() => {
        if (!this.connected) {
          ws.terminate();
          this.reconnecting = false;
          resolve();
        }
      }, 12000);

      ws.on('open', () => {
        // Autenticar
        ws.send(JSON.stringify({ authorize: this.apiToken, req_id: ++this.reqIdCounter }));
      });

      ws.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.handleMessage(msg, resolve, timeout);
        } catch (_) {}
      });

      ws.on('close', () => {
        clearTimeout(timeout);
        this.connected = false;
        this.stopKeepAlive();
        this.pendingSellReqs.clear(); // Limpar requests pendentes — respostas não chegarão mais
        this.pendingSubAcks.clear();  // Limpar acks de subscription pendentes
        console.log('🔌 [MONITOR] WebSocket fechado — reconectando em 3s...');
        if (!this.isShuttingDown) {
          setTimeout(() => this.reconnectAndResubscribe(), 3000);
        }
      });

      ws.on('error', (err: Error) => {
        console.warn(`⚠️ [MONITOR] WebSocket erro: ${err.message}`);
      });
    });
  }

  private handleMessage(msg: any, authResolve?: () => void, authTimeout?: NodeJS.Timeout): void {
    if (msg.msg_type === 'authorize' && msg.authorize) {
      clearTimeout(authTimeout!);
      this.connected = true;
      this.reconnecting = false;
      this.startKeepAlive();
      console.log(`✅ [MONITOR] Autenticado como ${msg.authorize.loginid}`);
      authResolve?.();
      // Resubscrever contratos em memória
      this.resubscribeAll();
      // Se a memória está vazia (restart do servidor), recuperar contratos órfãos do banco imediatamente
      if (this.monitored.size === 0) {
        console.log('♻️ [MONITOR] Memória vazia após autenticação — recuperando contratos ativos do banco...');
        setTimeout(() => this.recoverOrphanedContracts(), 1500);
      }
      return;
    }

    if (msg.msg_type === 'proposal_open_contract') {
      this.processContractUpdate(msg.proposal_open_contract);
      return;
    }

    if (msg.msg_type === 'sell') {
      if (msg.sell) {
        console.log(`💰 [MONITOR] Venda executada: contrato ${msg.sell.contract_id} | Vendido por: $${msg.sell.sold_for}`);
        // Limpar reqId pendente (venda confirmada)
        if (msg.req_id) this.pendingSellReqs.delete(msg.req_id);
        this.emit('contract_sold', {
          contractId: msg.sell.contract_id,
          soldFor: msg.sell.sold_for,
          referenceId: msg.sell.reference,
        });
      } else if (msg.error) {
        console.warn(`⚠️ [MONITOR] Erro na venda: ${msg.error.message} (code: ${msg.error.code})`);
        // Se havia um reqId pendente, reverter o estado do contrato para 'monitoring' se targetTicksReached
        // → permite retry automático no próximo tick (especialmente quando is_valid_to_sell=0 na Deriv)
        const reqId = msg.req_id;
        if (reqId && this.pendingSellReqs.has(reqId)) {
          const contractId = this.pendingSellReqs.get(reqId)!;
          this.pendingSellReqs.delete(reqId);
          const state = this.monitored.get(contractId);
          if (state && state.targetTicksReached && state.status === 'closing') {
            state.status = 'monitoring';
            console.log(`🔄 [ACCU-AUTOSELL] ${contractId} | Venda rejeitada pela Deriv — vai tentar novamente no próximo tick`);
          }
        }
        this.emit('sell_error', msg.error);
      }
      return;
    }

    if (msg.msg_type === 'error') {
      console.warn(`⚠️ [MONITOR] Erro Deriv: ${msg.error?.message}`);
    }
  }

  private subscribeToContract(contractId: number): void {
    if (!this.connected || !this.ws) return;
    const reqId = ++this.reqIdCounter;
    this.pendingSubAcks.set(reqId, contractId);
    this.ws.send(JSON.stringify({
      proposal_open_contract: 1,
      contract_id: contractId,
      subscribe: 1,
      req_id: reqId,
    }));
    console.log(`📡 [MONITOR] Subscrito para contrato ${contractId} (req ${reqId})`);
  }

  private resubscribeAll(): void {
    for (const [contractId, state] of Array.from(this.monitored.entries())) {
      if (state.status === 'monitoring') {
        this.subscribeToContract(contractId);
      }
    }
  }

  private async reconnectAndResubscribe(): Promise<void> {
    if (this.isShuttingDown || this.reconnecting) return;
    // Resetar contratos travados em 'closing' — a resposta da venda foi perdida na reconexão
    for (const [id, state] of Array.from(this.monitored.entries())) {
      if (state.status === 'closing' && state.targetTicksReached) {
        state.status = 'monitoring';
        state.closingSince = undefined;
        console.log(`🔄 [MONITOR] ${id} — reconectando: status 'closing' resetado para 'monitoring' (retry automático)`);
      }
    }
    await this.connect();
    // Após reconectar: recuperar contratos que ficaram órfãos durante a hibernação
    setTimeout(() => this.recoverOrphanedContracts(), 2000);
  }

  // ── Processamento de updates do contrato ─────────────────

  private async processContractUpdate(contract: any): Promise<void> {
    if (!contract || !contract.contract_id) return;
    const contractId = contract.contract_id;
    const state = this.monitored.get(contractId);
    if (!state) return;

    // Salvar subscription_id para poder fazer forget depois
    if (contract.id && !state.subscriptionId) {
      state.subscriptionId = contract.id;
    }

    // Atualizar estado
    state.bidPrice = parseFloat(contract.bid_price) || state.bidPrice;
    state.currentSpot = parseFloat(contract.current_spot) || state.currentSpot;
    state.entrySpot = parseFloat(contract.entry_spot || contract.entry_tick) || state.entrySpot;
    state.profit = parseFloat(contract.profit) || 0;
    state.profitPct = state.input.buyPrice > 0 ? (state.profit / state.input.buyPrice) * 100 : 0;
    state.isValidToSell = !!contract.is_valid_to_sell;
    state.isSold = !!contract.is_sold;
    state.isExpired = !!contract.is_expired;
    state.tickCount++;
    state.lastUpdate = Date.now();

    // Rastrear histórico de spots do próprio contrato (para análise IA tick a tick)
    if (state.currentSpot > 0) {
      state.spotHistory.push(state.currentSpot);
      if (state.spotHistory.length > 200) state.spotHistory.shift();
    }

    // Rastrear histórico de distância da barreira
    if (state.barrierDistance !== undefined) {
      state.barrierDistanceHistory.push(state.barrierDistance);
      if (state.barrierDistanceHistory.length > 30) state.barrierDistanceHistory.shift();
    }

    // Atualizar pico
    if (state.profit > state.peakProfit) state.peakProfit = state.profit;
    if (state.bidPrice > state.peakBidPrice) state.peakBidPrice = state.bidPrice;

    // ⚡ TIMEOUT DE VENDA: se o comando de venda foi enviado há >3s sem confirmação
    // (WebSocket desconectou antes da resposta), resetar para 'monitoring' e tentar novamente
    if (
      state.status === 'closing' &&
      state.closingSince !== undefined &&
      Date.now() - state.closingSince > 3000
    ) {
      console.log(`🔄 [MONITOR] ${contractId} — venda em 'closing' há ${((Date.now() - state.closingSince)/1000).toFixed(1)}s sem confirmação — resetando para retry`);
      state.status = 'monitoring';
      state.closingSince = undefined;
    }

    // ⚡ ACCU MODO-OPS: Venda automática após N ticks (1 ou 2) — sem delay de análise
    // Quando atingido o tick alvo, ativar flag e tentar vender a cada tick subsequente
    // NÃO bloquear em isValidToSell: é comum a Deriv retornar is_valid_to_sell=0 nos primeiros
    // ticks de ACCU (especialmente a 2%+ growth), mas devemos tentar a cada tick até conseguir.
    if (
      state.input.targetTicks !== undefined &&
      state.tickCount >= state.input.targetTicks &&
      state.status === 'monitoring'
    ) {
      state.targetTicksReached = true;
    }
    if (state.targetTicksReached && state.status === 'monitoring') {
      const gain = state.profitPct.toFixed(2);
      const validLabel = state.isValidToSell ? '' : ' [aguardando is_valid_to_sell]';
      console.log(`⚡ [ACCU-AUTOSELL] ${contractId} | Tick #${state.tickCount}/${state.input.targetTicks} atingido${validLabel} | lucro=${gain}% | Tentando vender...`);
      await this.executeSell(state, `ACCU-AUTOSELL: ${state.input.targetTicks} tick(s) alvo atingido | lucro=${gain}%`);
      return;
    }

    // ── VENDA URGENTE PENDENTE: executar imediatamente quando isValidToSell volta a true ──────
    // CORREÇÃO ESTRUTURAL: trailing stops e emergências detectados durante janela de indisponibilidade
    // (isValidToSell=false por 1-3 ticks) eram descartados — lucros acumulados podiam se dissipar.
    // Agora ficam enfileirados e executados no primeiro tick com liquidez disponível.
    if (state.pendingUrgentSell && state.isValidToSell && state.status === 'monitoring') {
      const elapsedSec = ((Date.now() - state.pendingUrgentSell.queuedAt) / 1000).toFixed(1);
      console.log(`🚨 [MONITOR] VENDA URGENTE DESBLOQUEADA após ${elapsedSec}s — ${contractId} | urgência=${state.pendingUrgentSell.urgency} | ${state.pendingUrgentSell.reason}`);
      const pendingReason = `[DESBLOQUEADA +${elapsedSec}s] ${state.pendingUrgentSell.reason}`;
      state.pendingUrgentSell = undefined;
      await this.executeSell(state, pendingReason);
      return;
    }

    // Calcular distância da barreira (se houver)
    if (state.currentSpot > 0) {
      const barrierStr = contract.barrier || state.input.barrier;
      if (barrierStr) {
        const barrierNum = parseFloat(barrierStr);
        if (!isNaN(barrierNum) && barrierNum > 0) {
          state.barrierValue = barrierNum;
          state.barrierDistance = Math.abs(state.currentSpot - barrierNum) / state.currentSpot * 100;
        }
      }
    }

    // Log de acompanhamento a cada 5 ticks para não poluir
    if (state.tickCount % 5 === 0) {
      this.logContractStatus(state, contract);
    }

    // Emitir evento de update para UI/WebSocket
    this.emit('contract_update', {
      contractId,
      contractType: state.input.contractType,
      symbol: state.input.symbol,
      bidPrice: state.bidPrice,
      buyPrice: state.input.buyPrice,
      profit: state.profit,
      profitPct: state.profitPct,
      peakProfit: state.peakProfit,
      currentSpot: state.currentSpot,
      barrierDistance: state.barrierDistance,
      isValidToSell: state.isValidToSell,
      tickCount: state.tickCount,
    });

    // Se já fechou, limpar
    if (state.isSold || state.isExpired) {
      this.handleContractClosed(state, contract);
      return;
    }

    // Se status=closed não monitorar mais
    if (contract.status === 'sold' || contract.status === 'won' || contract.status === 'lost') {
      this.handleContractClosed(state, contract);
      return;
    }

    // Contratos auto-close: apenas monitorar, não fechar
    const category = getCategory(state.input.contractType);
    if (category === 'AUTO_CLOSE') return;

    // Verificar se está pronto para decisão
    if (state.status !== 'monitoring') return;

    if (!state.isValidToSell) {
      // CORREÇÃO ESTRUTURAL: em vez de descartar silenciosamente, avaliar se há trailing stop
      // ou emergência pendente — enfileirar para execução imediata quando liquidez voltar.
      // Deriv bloqueia is_valid_to_sell por 1-5 ticks em condições de volatilidade alta.
      // Sem este mecanismo, um lucro de +70% pode reverter para +0% antes de podermos vender.
      const baseThresholds = getThresholds(state.input.contractType);
      if (state.tickCount >= baseThresholds.minTicksBeforeSell && !state.pendingUrgentSell) {
        const thresholds = getAdaptiveThresholds(baseThresholds, state.input.symbol, state.profitPct);
        const urgentDecision = this.shouldSell(state, thresholds, contract);
        if (
          urgentDecision.shouldSell &&
          (urgentDecision.urgency === 'emergency' ||
           (urgentDecision.urgency === 'high' && state.peakProfit > state.input.buyPrice * 0.05))
        ) {
          state.pendingUrgentSell = {
            reason: urgentDecision.reason,
            urgency: urgentDecision.urgency as 'high' | 'emergency',
            queuedAt: Date.now(),
          };
          console.log(`⚠️ [MONITOR] VENDA URGENTE ENFILEIRADA (isValidToSell=false) — ${contractId} | urgência=${urgentDecision.urgency} | ${urgentDecision.reason}`);
        }
      }
      return;
    }
    // Limpar venda urgente se o mercado voltou a condições normais sem necessidade de saída
    if (state.pendingUrgentSell) state.pendingUrgentSell = undefined;

    // Executar análise de saída com limiares adaptativos do Motor Supremo
    const baseThresholds = getThresholds(state.input.contractType);
    if (state.tickCount < baseThresholds.minTicksBeforeSell) return;

    const thresholds = getAdaptiveThresholds(baseThresholds, state.input.symbol, state.profitPct);

    const decision = this.shouldSell(state, thresholds, contract);

    if (decision.shouldSell) {
      console.log(`🎯 [MONITOR] DECISÃO DE VENDA — ${contractId} (${state.input.contractType}) | ${decision.reason} | Urgência: ${decision.urgency}`);
      await this.executeSell(state, decision.reason);
    }
  }

  // ── Motor de Decisão de Saída ─────────────────────────────

  private shouldSell(state: ContractState, thresholds: ExitThresholds, raw: any): SellDecision {
    const ct = state.input.contractType.toUpperCase();
    const dir = state.input.direction || 'neutral';
    const ageMin = (Date.now() - state.input.openedAt) / 60000;
    const symbol = state.input.symbol;

    // ── 1. TEMPO MÁXIMO (adaptativo pelo Motor Supremo) ─────────
    if (ageMin >= thresholds.maxDurationMin) {
      return {
        shouldSell: true,
        reason: `Tempo máximo atingido (${ageMin.toFixed(1)}min / ${thresholds.maxDurationMin.toFixed(1)}min)`,
        urgency: 'high',
      };
    }

    // ══════════════════════════════════════════════════════════════
    //  2. MOTOR SUPREMO — 10 DIMENSÕES DE MERCADO EM TEMPO REAL
    // ══════════════════════════════════════════════════════════════
    const recentPrices = this.getRecentPrices(symbol);
    const supreme = computeSupremeExitSignal(symbol, recentPrices, dir, state.profitPct);

    // Alimentar buffer de sinais (compatível com lógica existente)
    if (supreme.reversalDetected) {
      state.aiSignalBuffer.push({ ts: Date.now(), direction: supreme.trend, strength: supreme.strength });
      if (state.aiSignalBuffer.length > 10) state.aiSignalBuffer.shift();
    }

    // Confirmação dupla: 2 sinais supremos no buffer nos últimos 12s
    const recentReversals = state.aiSignalBuffer.filter(
      s => Date.now() - s.ts < 12000 && s.strength > thresholds.aiReversalStrength
    );
    const confirmedReversal = recentReversals.length >= 2;

    // Log periódico do estado do Motor Supremo (a cada 10 ticks)
    if (state.tickCount % 10 === 0 && supreme.regime !== 'unknown') {
      console.log(
        `🧠 [SUPREMO-MONITOR] ${ct} ${state.input.contractId} | ${symbol}` +
        ` | regime=${supreme.regime} | H=${supreme.hurst.toFixed(2)}` +
        ` | conv=${supreme.convergence.toFixed(0)}%` +
        ` | revScore=${supreme.strength.toFixed(0)}` +
        ` | HOLD=${supreme.holdSignal}` +
        ` | lucro=${state.profitPct.toFixed(1)}%` +
        ` | alvo=${thresholds.profitTargetPct.toFixed(0)}% trailing=${thresholds.trailingStopPct.toFixed(0)}%`
      );
    }

    // ── HOLD SUPREMO: Motor Supremo diz para AGUARDAR ────────────
    // (só bloqueia se o lucro estiver crescendo, para não segurar numa perda)
    const supremeHold = supreme.holdSignal && state.profitPct > 0;

    // ── SNAPSHOT DE IA: salva estado atual para análise ao vivo ──
    const baseThresholdsSnap = getThresholds(ct);
    const thresholdsSnap = getAdaptiveThresholds(baseThresholdsSnap, symbol, state.profitPct);
    state.aiSnapshot = {
      regime: supreme.regime,
      hurst: supreme.hurst,
      entropy: (supreme as any).statistics?.shannonEntropy ?? (supreme as any).entropy ?? 0,
      volatilityZ: (supreme as any).statistics?.zScoreVolatility ?? (supreme as any).volatilityZ ?? 0,
      convergence: supreme.convergence,
      strength: supreme.strength,
      trend: supreme.trend,
      holdSignal: supreme.holdSignal,
      exitReason: supreme.exitReason || '',
      urgency: supreme.urgency,
      reversalDetected: supreme.reversalDetected,
      profitTarget: thresholdsSnap.profitTargetPct,
      trailingStop: thresholdsSnap.trailingStopPct,
      barrierDanger: thresholdsSnap.barrierDangerPct,
      currentDecision: supremeHold ? 'AGUARDANDO' : (supreme.reversalDetected ? 'ALERTA_REVERSÃO' : 'MONITORANDO'),
      decisionReason: supreme.holdSignal
        ? `Tendência forte (H=${supreme.hurst.toFixed(2)}) → IA segurando posição`
        : supreme.reversalDetected
          ? `Reversão detectada: ${supreme.exitReason || 'sinal de saída'}`
          : `Mercado ${supreme.regime} — lucro ${state.profitPct.toFixed(1)}% / alvo ${thresholdsSnap.profitTargetPct.toFixed(0)}%`,
      confirmedReversal,
      ts: Date.now(),
    };

    // ── 3. EMERGÊNCIA SUPREMA: sinal urgente → fechar imediatamente ──
    if (supreme.urgency === 'emergency' && supreme.reversalDetected && !supremeHold && state.profitPct > 0) {
      return {
        shouldSell: true,
        reason: `🚨 EMERGÊNCIA SUPREMA: ${supreme.exitReason}`,
        urgency: 'emergency',
      };
    }

    // ── 4. PROTEÇÃO GLOBAL DE LUCRO (ignora holdSignal) ──────────
    // EXCEÇÃO CRÍTICA: NOTOUCH e ONETOUCH são contratos binários de vencimento fixo.
    // A bid price deles flutua muito mas o resultado final é binário (paga tudo ou nada).
    // Vender cedo por queda de bid significa trocar $0.39 de ganho por $0.08 — destroça o EV.
    // Eles têm sua própria lógica abaixo (apenas barreira crítica + corte de perda).
    const isBinaryBarrierContract = ['ONETOUCH', 'NOTOUCH', 'RANGE', 'EXPIRYRANGE', 'EXPIRYMISS', 'UPORDOWN'].includes(ct);
    if (!isBinaryBarrierContract && state.peakProfit > 0 && state.profit > 0) {
      const dropFromPeak = state.peakProfit - state.profit;
      const dropRatioPct = (dropFromPeak / state.peakProfit) * 100;
      if (dropRatioPct >= 50 && state.peakProfit > state.input.buyPrice * 0.03) {
        return {
          shouldSell: true,
          reason: `PRESERVAÇÃO DE LUCRO: caiu ${dropRatioPct.toFixed(0)}% do pico ($${state.peakProfit.toFixed(2)} → $${state.profit.toFixed(2)}) — fechando com lucro restante`,
          urgency: 'high',
        };
      }
    }

    // ── 5. ESTRATÉGIAS POR MODALIDADE ────────────────────────────

    // ── ACCUMULATOR — 100% DECISÃO IA EM TEMPO REAL ──────────────
    if (ct === 'ACCU') {
      const contractId = state.input.contractId;

      // ── ALVO DE LUCRO: fechar quando atingir meta de rentabilidade ──
      if (state.profitPct >= thresholds.profitTargetPct) {
        return {
          shouldSell: true,
          reason: `ACCU: alvo de lucro atingido ${state.profitPct.toFixed(2)}% ≥ ${thresholds.profitTargetPct.toFixed(0)}% | pico=$${state.peakProfit.toFixed(4)}`,
          urgency: 'high',
        };
      }

      // ── TRAILING STOP: protege ganhos acumulados ──
      if (state.peakProfit > state.input.buyPrice * 0.03 && state.profitPct > 0) {
        const peakPct = (state.peakProfit / state.input.buyPrice) * 100;
        const dropFromPeak = peakPct - state.profitPct;
        if (dropFromPeak >= thresholds.trailingStopPct) {
          return {
            shouldSell: true,
            reason: `ACCU trailing: lucro caiu de pico ${peakPct.toFixed(2)}% → ${state.profitPct.toFixed(2)}% (queda ${dropFromPeak.toFixed(2)}% > limiar ${thresholds.trailingStopPct.toFixed(0)}%)`,
            urgency: 'high',
          };
        }
      }

      // ── FLOOR DE SEGURANÇA MÁXIMA: protege pico excepcional (>50% do stake) ──────────────
      // CORREÇÃO ESTRUTURAL: ACCU pode knockout INSTANTANEAMENTE — um ganho excepcional pode
      // se converter em $0 em 1 tick. Este floor garante que nunca se entrega >60% de um pico
      // excepcional. Complementa o trailing stop (5%) com uma proteção de magnitude maior.
      // Ativado apenas quando peakProfit > 50% do stake — sem distorcer operações normais.
      if (state.peakProfit > state.input.buyPrice * 0.50 && state.profit > 0) {
        const securityFloorProfit = state.peakProfit * 0.40; // manter pelo menos 40% do pico
        if (state.profit < securityFloorProfit) {
          const peakPct = (state.peakProfit / state.input.buyPrice) * 100;
          const floorPct = (securityFloorProfit / state.input.buyPrice) * 100;
          return {
            shouldSell: true,
            reason: `ACCU FLOOR SEGURANÇA: pico=${peakPct.toFixed(1)}% | floor=40% do pico (${floorPct.toFixed(1)}%) | atual=${state.profitPct.toFixed(1)}% — preservando ganho excepcional`,
            urgency: 'high',
          };
        }
      }

      // ── EMERGÊNCIA: barreira muito próxima — fecha imediatamente ──
      if (state.barrierDistance !== undefined && state.barrierDistance < 0.5) {
        return { shouldSell: true, reason: `ACCU: BARREIRA CRÍTICA a ${state.barrierDistance.toFixed(3)}% — saída de emergência`, urgency: 'emergency' };
      }

      // ── TENDÊNCIA DA BARREIRA: barreira se aproximando rapidamente ──
      if (state.barrierDistanceHistory.length >= 5) {
        const hist = state.barrierDistanceHistory;
        const oldest = hist[0];
        const newest = hist[hist.length - 1];
        const barrierClosingFast = newest < oldest * 0.7 && newest < 1.5;
        if (barrierClosingFast && state.profitPct >= 0) {
          return { shouldSell: true, reason: `ACCU: barreira aproximando rápido (${oldest.toFixed(2)}%→${newest.toFixed(2)}%) | lucro=${state.profitPct.toFixed(1)}%`, urgency: 'high' };
        }
      }

      // ── ANÁLISE IA TICK A TICK ─────────────────────────────────
      const spots = state.spotHistory;
      if (spots.length >= 8) {
        const n = spots.length;

        // RSI local a partir dos spots do próprio contrato
        const rsiPeriod = Math.min(14, n - 1);
        let gains = 0, losses = 0;
        for (let i = n - rsiPeriod; i < n; i++) {
          const delta = spots[i] - spots[i - 1];
          if (delta > 0) gains += delta; else losses -= delta;
        }
        const avgGain = gains / rsiPeriod;
        const avgLoss = losses / rsiPeriod;
        const localRSI = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

        // Momentum dos últimos 5 e 3 spots
        const m5 = (spots[n-1] - spots[Math.max(0, n-6)]) / (spots[Math.max(0, n-6)] || 1);
        const m3 = (spots[n-1] - spots[Math.max(0, n-4)]) / (spots[Math.max(0, n-4)] || 1);
        const m3prev = n >= 7 ? (spots[n-4] - spots[Math.max(0, n-7)]) / (spots[Math.max(0, n-7)] || 1) : m3;
        const momentumDecelerating = Math.abs(m3) < Math.abs(m3prev) * 0.5 && Math.abs(m3prev) > 0.00001;

        // Ticks consecutivos adversos (preço caindo)
        let consecutiveAdverse = 0;
        for (let i = n - 1; i >= Math.max(1, n - 6); i--) {
          if (spots[i] < spots[i - 1]) consecutiveAdverse++;
          else break;
        }

        // Score de saída IA — combina todos os sinais
        let exitScore = 0;
        const reasons: string[] = [];

        if (localRSI > 70)            { exitScore += 30; reasons.push(`RSI=${localRSI.toFixed(0)} sobrecomprado`); }
        else if (localRSI > 62)       { exitScore += 15; reasons.push(`RSI=${localRSI.toFixed(0)} elevado`); }

        if (momentumDecelerating)     { exitScore += 25; reasons.push(`momentum desacelerando`); }
        if (m5 < 0)                   { exitScore += 20; reasons.push(`m5=${(m5*100).toFixed(3)}% negativo`); }
        if (m3 < 0 && m5 < 0)        { exitScore += 15; reasons.push(`m3+m5 negativos`); }

        if (consecutiveAdverse >= 4)  { exitScore += 35; reasons.push(`${consecutiveAdverse} ticks adversos`); }
        else if (consecutiveAdverse >= 3) { exitScore += 20; reasons.push(`${consecutiveAdverse} ticks adversos`); }

        if (supreme.reversalDetected && supreme.strength > 50) { exitScore += 30; reasons.push(`reversão suprema (${supreme.strength.toFixed(0)})`); }
        if (supreme.urgency === 'high')      { exitScore += 20; reasons.push(`urgência alta`); }
        if (supreme.urgency === 'emergency') { exitScore += 45; reasons.push(`EMERGÊNCIA suprema`); }

        // Motor supremo reduz score se tendência forte (aguardar)
        if (supremeHold && state.profitPct > 0) exitScore -= 20;
        if (supreme.hurst > 0.65)             exitScore -= 15;
        if (supreme.convergence > 70 && !supreme.reversalDetected) exitScore -= 10;

        // Limiar adaptativo: mais sensível quando já tem lucro
        const exitThreshold = state.profitPct > 5 ? 40 : state.profitPct > 0 ? 55 : 70;

        if (state.tickCount % 3 === 0) {
          console.log(`🤖 [ACCU-IA] ${contractId} | tick=${state.tickCount} | RSI=${localRSI.toFixed(1)} | m5=${(m5*100).toFixed(3)}% | adv=${consecutiveAdverse} | H=${supreme.hurst.toFixed(2)} | exitScore=${exitScore} | limiar=${exitThreshold} | lucro=${state.profitPct.toFixed(1)}%`);
        }

        if (exitScore >= exitThreshold) {
          return {
            shouldSell: true,
            reason: `ACCU-IA: ${reasons.join(' | ')} | score=${exitScore}/${exitThreshold} | lucro=${state.profitPct.toFixed(1)}%`,
            urgency: supreme.urgency === 'emergency' ? 'emergency' : 'high',
          };
        }
      }

      // ── SINAL SUPREMO ISOLADO (fallback se spotHistory < 8 ticks) ──
      if (!supremeHold && (confirmedReversal || supreme.urgency === 'high') && state.profitPct > 3) {
        return { shouldSell: true, reason: `ACCU: ${supreme.exitReason || 'reversão suprema'} | lucro=${state.profitPct.toFixed(1)}%`, urgency: supreme.urgency };
      }
    }

    // ── MULTIPLIER ────────────────────────────────────────────────
    if (ct === 'MULTUP' || ct === 'MULTDOWN') {
      if (state.profitPct >= thresholds.profitTargetPct) {
        return { shouldSell: true, reason: `MULT: alvo ${state.profitPct.toFixed(1)}% (regime=${supreme.regime})`, urgency: 'high' };
      }
      if (state.profitPct <= -thresholds.earlyLossExitPct) {
        return { shouldSell: true, reason: `MULT: corte de perda ${state.profitPct.toFixed(1)}%`, urgency: 'emergency' };
      }
      // Trailing stop NUNCA é bloqueado pelo holdSignal — proteger lucro é prioridade máxima
      if (state.peakProfit > state.input.buyPrice * 0.05 && state.profit < state.peakProfit * (1 - thresholds.trailingStopPct / 100)) {
        return { shouldSell: true, reason: `MULT: trailing (pico $${state.peakProfit.toFixed(2)} → $${state.profit.toFixed(2)}) | hold ignorado para preservar lucro | regime=${supreme.regime}`, urgency: 'high' };
      }
      if (!supremeHold && (confirmedReversal || supreme.urgency === 'high') && state.profitPct > 10) {
        return { shouldSell: true, reason: `MULT: ${supreme.exitReason || 'reversão suprema'} | lucro=${state.profitPct.toFixed(1)}%`, urgency: supreme.urgency };
      }
    }

    // ── TURBOS ────────────────────────────────────────────────────
    if (ct === 'TURBOSLONG' || ct === 'TURBOSSHORT') {
      if (state.barrierDistance !== undefined && state.barrierDistance < thresholds.barrierDangerPct) {
        return { shouldSell: true, reason: `TURBO: barreira PERIGOSA a ${state.barrierDistance.toFixed(3)}%`, urgency: 'emergency' };
      }
      if (state.profitPct >= thresholds.profitTargetPct) {
        return { shouldSell: true, reason: `TURBO: alvo ${state.profitPct.toFixed(1)}% (regime=${supreme.regime})`, urgency: 'high' };
      }
      if (state.profitPct <= -thresholds.earlyLossExitPct) {
        return { shouldSell: true, reason: `TURBO: corte de perda ${state.profitPct.toFixed(1)}%`, urgency: 'high' };
      }
      if (state.barrierDistance !== undefined && state.barrierDistance < thresholds.barrierDangerPct * 2 && (confirmedReversal || supreme.urgency !== 'low')) {
        return { shouldSell: true, reason: `TURBO: barreira próxima + ${supreme.exitReason || 'sinal supremo'}`, urgency: 'high' };
      }
    }

    // ── VANILLA ───────────────────────────────────────────────────
    if (ct === 'VANILLACALL' || ct === 'VANILLAPUT') {
      if (state.profitPct >= thresholds.profitTargetPct) {
        return { shouldSell: true, reason: `VANILLA: alvo ${state.profitPct.toFixed(1)}% (regime=${supreme.regime})`, urgency: 'high' };
      }
      if (state.profitPct <= -thresholds.earlyLossExitPct) {
        return { shouldSell: true, reason: `VANILLA: corte de perda ${state.profitPct.toFixed(1)}%`, urgency: 'high' };
      }
      if (!supremeHold && (confirmedReversal || supreme.urgency === 'high') && state.profitPct > 15) {
        return { shouldSell: true, reason: `VANILLA: ${supreme.exitReason || 'reversão suprema'} | lucro=${state.profitPct.toFixed(1)}%`, urgency: supreme.urgency };
      }
    }

    // ── CALL/PUT/RISE/FALL ────────────────────────────────────────
    if (['CALL', 'PUT', 'RISE', 'FALL', 'CALLE', 'PUTE'].includes(ct)) {
      const payout = parseFloat(raw.payout) || state.input.buyPrice * 1.8;
      const bidPct = (state.bidPrice / payout) * 100;

      if (bidPct >= thresholds.profitTargetPct) {
        return { shouldSell: true, reason: `CALL/PUT: bid ${bidPct.toFixed(1)}% do payout (regime=${supreme.regime})`, urgency: 'high' };
      }
      const bidDecline = (1 - state.bidPrice / state.input.buyPrice) * 100;
      if (bidDecline >= thresholds.earlyLossExitPct) {
        return { shouldSell: true, reason: `CALL/PUT: bid caiu ${bidDecline.toFixed(1)}% — saída preventiva`, urgency: 'medium' };
      }
      // Trailing stop por bid — arma quando bid sobe ≥10% acima do buy price
      // holdSignal NÃO bloqueia: preservar lucro tem prioridade sobre "aguardar tendência"
      if (state.peakBidPrice > state.input.buyPrice * 1.10) {
        const trailingThreshold = state.peakBidPrice * (1 - thresholds.trailingStopPct / 100);
        if (state.bidPrice < trailingThreshold && state.bidPrice > state.input.buyPrice) {
          return { shouldSell: true, reason: `CALL/PUT: trailing bid (pico $${state.peakBidPrice.toFixed(4)} → $${state.bidPrice.toFixed(4)}, queda ${thresholds.trailingStopPct.toFixed(0)}%) regime=${supreme.regime}`, urgency: 'high' };
        }
      }
      // Trailing stop por lucro % — protege qualquer pico de lucro positivo
      // holdSignal NÃO bloqueia: trailing stop é proteção de lucro, não entrada
      if (state.peakProfit > 0 && state.profitPct > 3) {
        const peakPct = (state.peakProfit / state.input.buyPrice) * 100;
        const dropFromPeak = peakPct - state.profitPct;
        if (dropFromPeak >= thresholds.trailingStopPct) {
          return { shouldSell: true, reason: `CALL/PUT trailing %: pico ${peakPct.toFixed(1)}% → ${state.profitPct.toFixed(1)}% (queda ${dropFromPeak.toFixed(1)}%) regime=${supreme.regime}`, urgency: 'high' };
        }
      }
      // Reversão de IA (reduziu limiar de 15% para 5% de lucro)
      if (!supremeHold && state.profitPct > 5 && (confirmedReversal || supreme.urgency !== 'low')) {
        return { shouldSell: true, reason: `CALL/PUT: ${supreme.exitReason || 'reversão suprema'} | lucro=${state.profitPct.toFixed(1)}%`, urgency: supreme.urgency };
      }
    }

    // ── ONETOUCH/NOTOUCH/RANGE/EXPIRYMISS ────────────────────────────────────
    // FILOSOFIA: contratos binários de barreira têm payout BINÁRIO (tudo ou nada no vencimento).
    // Vender cedo com base em flutuação de bid é matematicamente destrutivo:
    //   EV(venda antecipada) = ganhinho × WR - stakeTotal × (1-WR) → sempre negativo
    //   EV(vencimento natural) = payoutFull × WR - stakeTotal × (1-WR) → positivo se WR > 66%
    // Portanto: SEGURAR até o vencimento, exceto em emergências (barreira literal ou perda >80%).
    if (['ONETOUCH', 'NOTOUCH', 'RANGE', 'EXPIRYRANGE', 'EXPIRYMISS', 'UPORDOWN'].includes(ct)) {

      // NOTOUCH: barreira se aproximando CRITICAMENTE (< 0.05% → quase tocando = perda iminente)
      // Vender agora com o que tiver é melhor que perder 100% do stake em 1-2 ticks
      if (ct === 'NOTOUCH') {
        // Aproximação acelerada e muito próxima
        if (state.barrierDistanceHistory.length >= 5) {
          const hist = state.barrierDistanceHistory;
          const oldest = hist[0];
          const newest = hist[hist.length - 1];
          const approachingFast = (oldest - newest) > 0.04 && newest < 0.08; // muito perto E acelerando
          if (approachingFast) {
            return { shouldSell: true, reason: `NOTOUCH: barreira crítica se aproximando rápido (${oldest.toFixed(3)}%→${newest.toFixed(3)}%) — saída de emergência`, urgency: 'emergency' };
          }
        }
        // Distância literal da barreira abaixo do limiar de perigo
        if (state.barrierDistance !== undefined && thresholds.barrierDangerPct > 0 && state.barrierDistance < thresholds.barrierDangerPct) {
          return { shouldSell: true, reason: `NOTOUCH: barreira a ${state.barrierDistance.toFixed(3)}% — limite crítico ${thresholds.barrierDangerPct}% | lucro=${state.profitPct.toFixed(1)}%`, urgency: 'emergency' };
        }
      }

      // ONETOUCH: se o preço se afastou muito da barreira e não há momentum de volta → sair com o que tiver
      if (ct === 'ONETOUCH' && state.profitPct < -60) {
        return { shouldSell: true, reason: `ONETOUCH: perda >60% — recuperação improvável (lucro=${state.profitPct.toFixed(1)}%)`, urgency: 'high' };
      }

      // Perda profunda (bid caiu muito abaixo do preço de compra) — não há venda antecipada boa,
      // mas se perda ultrapassar 80% pode ser melhor recuperar o que resta ao invés de zero
      if (state.profitPct <= -80) {
        return { shouldSell: true, reason: `BARRIER: perda severa ${state.profitPct.toFixed(1)}% — recuperando valor residual`, urgency: 'high' };
      }

      // ONETOUCH: barreira de perigo não dispara (barreira próxima = VITÓRIA para ONETOUCH)
      // Para os demais (RANGE, EXPIRYRANGE etc.): verificar perigo de barreira se configurado
      if (!['ONETOUCH', 'NOTOUCH'].includes(ct)) {
        if (state.barrierDistance !== undefined && thresholds.barrierDangerPct > 0 && state.barrierDistance < thresholds.barrierDangerPct) {
          return { shouldSell: true, reason: `BARRIER: barreira crítica a ${state.barrierDistance.toFixed(3)}% | lucro=${state.profitPct.toFixed(1)}%`, urgency: 'emergency' };
        }
        // Alvo de lucro para contratos de range (mas não NOTOUCH/ONETOUCH que são hold-to-expiry)
        if (state.profitPct >= thresholds.profitTargetPct) {
          return { shouldSell: true, reason: `BARRIER: lucro ${state.profitPct.toFixed(1)}% atingiu alvo de ${thresholds.profitTargetPct.toFixed(0)}%`, urgency: 'high' };
        }
      }

      // Manter posição — deixar expirar naturalmente para receber o payout completo
      return { shouldSell: false, reason: 'BARRIER: aguardando vencimento natural para payout completo', urgency: 'low' };
    }

    return { shouldSell: false, reason: '', urgency: 'low' };
  }

  // ── Execução de Venda ─────────────────────────────────

  private async executeSell(state: ContractState, reason: string): Promise<void> {
    if (state.status !== 'monitoring') return;
    state.status = 'closing';
    state.closingSince = Date.now();

    const contractId = state.input.contractId;
    console.log(`\n🔴 [MONITOR] ═══ EXECUTANDO VENDA ═══`);
    console.log(`   Contrato : ${contractId} (${state.input.contractType})`);
    console.log(`   Ativo    : ${state.input.symbol}`);
    console.log(`   Motivo   : ${reason}`);
    console.log(`   Bid      : $${state.bidPrice.toFixed(4)}`);
    console.log(`   Buy      : $${state.input.buyPrice.toFixed(4)}`);
    console.log(`   Lucro    : $${state.profit.toFixed(4)} (${state.profitPct.toFixed(2)}%)`);
    console.log(`   Pico     : $${state.peakProfit.toFixed(4)}`);
    console.log(`   Ticks    : ${state.tickCount}`);
    console.log(`   Duração  : ${((Date.now() - state.input.openedAt) / 60000).toFixed(1)}min`);

    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('⚠️ [MONITOR] WebSocket não conectado — tentando reconectar para vender...');
      await this.ensureConnected();
    }

    if (this.connected && this.ws) {
      const reqId = ++this.reqIdCounter;
      this.pendingSellReqs.set(reqId, contractId);
      this.ws.send(JSON.stringify({ sell: contractId, price: 0, req_id: reqId }));
      // Não marcar como 'closed' aqui — aguardar resposta da Deriv.
      // handleMessage processará a resposta 'sell' e marcará o estado corretamente.
      // Status permanece 'closing' até confirmação ou erro da Deriv.

      this.emit('sell_initiated', {
        contractId,
        contractType: state.input.contractType,
        symbol: state.input.symbol,
        reason,
        bidPrice: state.bidPrice,
        buyPrice: state.input.buyPrice,
        profit: state.profit,
        profitPct: state.profitPct,
        peakProfit: state.peakProfit,
        duration: Date.now() - state.input.openedAt,
        tickCount: state.tickCount,
      });
    } else {
      state.status = 'monitoring'; // Reverter para tentar novamente
      console.error('❌ [MONITOR] Falha ao conectar para executar venda');
    }
  }

  // ── Contrato fechado (por expiry ou venda) ────────────────

  private handleContractClosed(state: ContractState, raw: any): void {
    const contractId = state.input.contractId;
    const finalResult: 'won' | 'lost' | 'sold' = raw.status === 'won' ? 'won' : raw.status === 'sold' ? 'sold' : 'lost';
    const result = finalResult === 'won' ? '✅ WON' : finalResult === 'sold' ? '💰 SOLD' : '❌ LOST';
    const finalProfit = parseFloat(raw.profit) || state.profit;

    console.log(`\n📊 [MONITOR] Contrato FECHADO: ${contractId} (${state.input.contractType})`);
    console.log(`   Resultado: ${result} | Lucro final: $${finalProfit.toFixed(4)}`);
    console.log(`   Ticks monitorados: ${state.tickCount} | Duração: ${((Date.now() - state.input.openedAt) / 60000).toFixed(1)}min`);

    // Atualizar estado final antes de mover para buffer
    state.status = 'closed';
    state.profit = finalProfit;
    state.lastUpdate = Date.now();

    // Mover para buffer "recentemente fechados" para exibição por 20s
    const closedEntry: RecentlyClosedEntry = {
      state,
      closedAt: Date.now(),
      finalResult,
      finalProfit,
    };
    this.recentlyClosed.set(contractId, closedEntry);

    // Agendar remoção do buffer após TTL
    setTimeout(() => {
      this.recentlyClosed.delete(contractId);
    }, this.RECENTLY_CLOSED_TTL_MS);

    this.emit('contract_closed', {
      contractId,
      contractType: state.input.contractType,
      symbol: state.input.symbol,
      status: raw.status,
      finalProfit,
      buyPrice: state.input.buyPrice,
      tickCount: state.tickCount,
      duration: Date.now() - state.input.openedAt,
      peakProfit: state.peakProfit,
    });

    this.monitored.delete(contractId);
  }

  // ── Log status ────────────────────────────────────────────

  private logContractStatus(state: ContractState, raw: any): void {
    const ct = state.input.contractType;
    const ageMin = ((Date.now() - state.input.openedAt) / 60000).toFixed(1);
    const barrierInfo = state.barrierDistance !== undefined
      ? ` | Barreira: ${state.barrierDistance.toFixed(3)}%`
      : '';
    const emoji = state.profitPct > 0 ? '📈' : state.profitPct < -5 ? '📉' : '➡️';

    console.log(
      `${emoji} [MONITOR] ${ct} ${state.input.contractId} | ${state.input.symbol}` +
      ` | Bid: $${state.bidPrice.toFixed(4)}` +
      ` | Lucro: ${state.profitPct >= 0 ? '+' : ''}${state.profitPct.toFixed(2)}%` +
      ` | Pico: $${state.peakProfit.toFixed(4)}` +
      `${barrierInfo}` +
      ` | ${ageMin}min | Tick#${state.tickCount}`
    );
  }

  // ── Preços recentes do market collector ──────────────────

  private getRecentPrices(symbol: string): number[] {
    try {
      const ticks = marketDataCollector.getBufferedTicks(symbol, 100);
      return ticks.map((t: any) => t.quote || t.price || 0).filter((p: number) => p > 0);
    } catch (_) {
      return [];
    }
  }

  // ── Keep-Alive ────────────────────────────────────────────

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ ping: 1 }));
      }
    }, 25000);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  getLiveAnalysis(): Array<{
    contractId: number;
    contractType: string;
    symbol: string;
    openedAt: number;
    ageMin: number;
    tickCount: number;
    buyPrice: number;
    currentSpot: number;
    entrySpot: number;
    bidPrice: number;
    profit: number;
    profitPct: number;
    peakProfit: number;
    barrierDistance?: number;
    barrierValue?: number;
    status: string;
    openReason?: string;
    aiSnapshot?: AITickSnapshot;
    finalResult?: string;
    finalProfit?: number;
    closedAt?: number;
  }> {
    const result = [];

    // Contratos ativos (em monitoramento)
    for (const [contractId, state] of Array.from(this.monitored.entries())) {
      result.push({
        contractId,
        contractType: state.input.contractType,
        symbol: state.input.symbol,
        openedAt: state.input.openedAt,
        ageMin: parseFloat(((Date.now() - state.input.openedAt) / 60000).toFixed(1)),
        tickCount: state.tickCount,
        buyPrice: state.input.buyPrice,
        currentSpot: state.currentSpot,
        entrySpot: state.entrySpot,
        bidPrice: state.bidPrice,
        profit: state.profit,
        profitPct: parseFloat(state.profitPct.toFixed(2)),
        peakProfit: state.peakProfit,
        barrierDistance: state.barrierDistance,
        barrierValue: state.barrierValue,
        status: state.status,
        openReason: state.openReason,
        aiSnapshot: state.aiSnapshot,
      });
    }

    // Contratos recentemente fechados (visíveis por 20s)
    for (const [contractId, entry] of Array.from(this.recentlyClosed.entries())) {
      const state = entry.state;
      result.push({
        contractId,
        contractType: state.input.contractType,
        symbol: state.input.symbol,
        openedAt: state.input.openedAt,
        ageMin: parseFloat(((Date.now() - state.input.openedAt) / 60000).toFixed(1)),
        tickCount: state.tickCount,
        buyPrice: state.input.buyPrice,
        currentSpot: state.currentSpot,
        entrySpot: state.entrySpot,
        bidPrice: state.bidPrice,
        profit: entry.finalProfit,
        profitPct: parseFloat(state.profitPct.toFixed(2)),
        peakProfit: state.peakProfit,
        barrierDistance: state.barrierDistance,
        barrierValue: state.barrierValue,
        status: 'closed',
        openReason: state.openReason,
        aiSnapshot: state.aiSnapshot,
        finalResult: entry.finalResult,
        finalProfit: entry.finalProfit,
        closedAt: entry.closedAt,
      });
    }

    return result;
  }

  setOpenReason(contractId: number, reason: string): void {
    const state = this.monitored.get(contractId);
    if (state) state.openReason = reason;
  }

  shutdown(): void {
    this.isShuttingDown = true;
    this.stopKeepAlive();
    this.ws?.terminate();
    this.monitored.clear();
    console.log('🔭 [MONITOR] Monitor universal encerrado');
  }
}

// Singleton global
export const contractMonitor = new UniversalContractMonitor();
