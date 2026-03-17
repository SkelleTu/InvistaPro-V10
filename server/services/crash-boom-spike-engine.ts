/**
 * CRASH/BOOM SPIKE ENGINE - INVESTAPRO
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * ARQUITETURA COOPERATIVA TRIPARTITE:
 *
 *  ┌─────────────────────────────────────────────────────────────────────┐
 *  │  1. GIRASSOL SUNFLOWER (3 grupos Fibonacci)                         │
 *  │     Parâmetros exatos do indicador MT5:                             │
 *  │     Grupo 1: Period=5,  Deviation=1,  Backstep=3  (micro)          │
 *  │     Grupo 2: Period=13, Deviation=8,  Backstep=5  (meso)           │
 *  │     Grupo 3: Period=34, Deviation=21, Backstep=12 (macro)          │
 *  │     → Detecta pivôs de reversão em 3 escalas de tempo              │
 *  │     → Duplo Topo/Fundo em qualquer grupo = gatilho de spike        │
 *  │     → Tri-confluência (3 grupos concordando) = sinal CRÍTICO       │
 *  ├─────────────────────────────────────────────────────────────────────┤
 *  │  2. AUTO FIBONACCI (calculado a partir dos pivôs do Girassol)      │
 *  │     → Fibonaccis são traçados entre os pivôs detectados            │
 *  │     → Níveis 0%, 23.6%, 38.2%, 50%, 61.8%, 78.6%, 100%            │
 *  │     → Quando o duplo pivô cai em zona Fib = amplificação máxima   │
 *  │     → Confluência multi-layer (micro+meso+macro) = força máxima    │
 *  ├─────────────────────────────────────────────────────────────────────┤
 *  │  3. IA COOPERATIVA (CÉREBRO OPERACIONAL)                            │
 *  │     → Analisa momentum, volatilidade, compressão, contagem         │
 *  │     → Processa RSI implícito, MACD, Bollinger, ATR                 │
 *  │     → Consenso entre todos os sistemas (quantum, neural, etc.)     │
 *  │     → Decisão final: score ponderado de TODAS as fontes            │
 *  │     → Pode operar mesmo sem Girassol (mas com menos força)         │
 *  └─────────────────────────────────────────────────────────────────────┘
 *
 * FLUXO: Girassol detecta pivôs → AutoFib valida níveis →
 *        IA analisa tudo + contexto adicional → sinal cooperativo final
 */

// ══════════════════════════════════════════════════════════════════════════════
// PARÂMETROS EXATOS DO GIRASSOL SUNFLOWER MT5 INDICATOR v1.70
// ══════════════════════════════════════════════════════════════════════════════
export const GIRASSOL_PARAMS = {
  group1: { period: 5,  deviation: 1,  backstep: 3  }, // micro — topos/fundos rápidos
  group2: { period: 13, deviation: 8,  backstep: 5  }, // meso  — topos/fundos médios
  group3: { period: 34, deviation: 21, backstep: 12 }, // macro — topos/fundos estruturais
} as const;

// Níveis Fibonacci padrão
const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.272, 1.618];

const FIB_SIGNIFICANCE: Record<number, 'critical' | 'major' | 'minor'> = {
  0:     'critical',
  0.236: 'major',
  0.382: 'major',
  0.5:   'critical',
  0.618: 'critical',
  0.786: 'major',
  1.0:   'critical',
  1.272: 'minor',
  1.618: 'major',
};

const SPIKE_FIB_MULTIPLIERS: Record<string, number> = {
  '0.0%':   2.5,
  '23.6%':  1.6,
  '38.2%':  1.4,
  '50.0%':  1.8,
  '61.8%':  2.2,
  '78.6%':  1.7,
  '100.0%': 2.5,
  '127.2%': 1.3,
  '161.8%': 1.5,
};

const AVG_SPIKE_INTERVALS: Record<string, number> = {
  '1000': 100,
  '500':  50,
  '300':  30,
  '200':  20,
};

// ══════════════════════════════════════════════════════════════════════════════
// INTERFACES
// ══════════════════════════════════════════════════════════════════════════════

export interface FibLevel {
  label: string;
  price: number;
  pct: number;
  distancePct: number;
  layer: 'macro' | 'meso' | 'micro';
  significance: 'critical' | 'major' | 'minor';
}

export interface FibZoneScore {
  level: string;
  layer: string;
  distancePct: number;
  significance: 'critical' | 'major' | 'minor';
  spikeMultiplier: number;
}

/** Resultado de um único grupo do Girassol */
export interface GirassolGroupResult {
  group: 1 | 2 | 3;
  groupLabel: 'micro' | 'meso' | 'macro';
  period: number;
  deviation: number;
  backstep: number;
  pivotsFound: number;
  doublePatternDetected: boolean;
  patternType: 'double_top' | 'double_bottom' | null;
  pivot1Price: number;
  pivot2Price: number;
  divergencePct: number;
  candlesBetween: number;
  fibAlignment: boolean;
  fibLevel: string | null;
  groupScore: number;
}

/** Resultado completo do sistema Girassol (3 grupos) */
export interface GirassolSystemResult {
  groupResults: GirassolGroupResult[];
  activeGroups: number;
  triConfluence: boolean;
  dualConfluence: boolean;
  singleSignal: boolean;
  dominantPattern: 'double_top' | 'double_bottom' | null;
  totalGirassolScore: number;
  fibAlignedGroups: number;
  confluenceLabel: 'nenhuma' | 'fraca' | 'moderada' | 'forte' | 'crítica';
  description: string;
  /** Pivôs externos enviados diretamente pelo EA com o Girassol carregado */
  externalPivots?: ExternalGirassolPivot[];
}

/** Pivô enviado diretamente pelo EA (indicador Girassol rodando no MT5) */
export interface ExternalGirassolPivot {
  type: 'high' | 'low';
  price: number;
  time: number;
  group: 1 | 2 | 3;
}

/** AutoFib calculado a partir dos pivôs do Girassol */
export interface AutoFibResult {
  source: 'girassol_pivots' | 'candle_range';
  swingHigh: number;
  swingLow: number;
  levels: FibLevel[];
  nearestLevel: FibLevel | null;
  confluenceCount: number;
  significance: 'critical' | 'major' | 'minor' | 'none';
  spikeMultiplier: number;
}

/** Análise da IA cooperativa (camada de inteligência adicional) */
export interface AIBrainAnalysis {
  momentumScore: number;
  volatilityScore: number;
  compressionScore: number;
  candleCountScore: number;
  impliedRsiScore: number;
  bollingerSqueezeScore: number;
  atrNormalized: number;
  trendExhaustionScore: number;
  overallAIScore: number;
  signals: string[];
}

/** Resultado final da detecção de spike */
export interface SpikeDetectionResult {
  symbol: string;
  isSpikeIndex: boolean;
  spikeType: 'crash' | 'boom' | null;
  averageInterval: number;

  candlesSinceLastSpike: number;
  imminencePercent: number;
  imminenceLabel: 'baixa' | 'moderada' | 'alta' | 'crítica';

  // Sistema Girassol
  girassolSystem: GirassolSystemResult;

  // Auto Fibonacci
  autoFib: AutoFibResult;

  // Fibonacci legado (compatibilidade)
  fibZoneScore: FibZoneScore | null;
  nearestFibLevels: FibLevel[];
  fibConfluence: number;
  fibSpikeMultiplier: number;

  // IA Cooperativa
  aiBrain: AIBrainAnalysis;
  momentumConfirms: boolean;
  momentumValue: number;
  volatilityCompressed: boolean;
  compressionScore: number;

  // Resultado final
  overallConfidence: number;
  spikeExpected: boolean;
  spikeDirection: 'down' | 'up' | null;
  preEntryWindow: boolean;
  entryTimingScore: number;
  ticksUntilEstimate: number;

  switchRecommendation: SwitchRecommendation | null;
  narrative: string;
  alerts: string[];
}

export interface SwitchRecommendation {
  action: 'EXIT_CONTINUITY_ENTER_SPIKE';
  urgency: 'warning' | 'high' | 'critical';
  exitDirection: 'CLOSE_BUY' | 'CLOSE_SELL';
  spikeDirection: 'BUY' | 'SELL';
  confidence: number;
  reasoning: string;
  secondsToAct: number;
}

export interface ContinuityAnalysis {
  symbol: string;
  canContinue: boolean;
  direction: 'BUY' | 'SELL' | null;
  confidence: number;
  spikeRiskLevel: 'safe' | 'caution' | 'danger' | 'abort';
  exitNow: boolean;
  reasoning: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// ARMAZENAMENTO DE PIVÔS EXTERNOS DO EA
// ══════════════════════════════════════════════════════════════════════════════

const externalPivotsStore = new Map<string, ExternalGirassolPivot[]>();

export function storeExternalGirassolPivots(symbol: string, pivots: ExternalGirassolPivot[]): void {
  externalPivotsStore.set(symbol, pivots.slice(-50));
}

export function getExternalGirassolPivots(symbol: string): ExternalGirassolPivot[] {
  return externalPivotsStore.get(symbol) || [];
}

// ══════════════════════════════════════════════════════════════════════════════
// FUNÇÕES AUXILIARES
// ══════════════════════════════════════════════════════════════════════════════

function getAvgInterval(symbol: string): number {
  for (const [key, val] of Object.entries(AVG_SPIKE_INTERVALS)) {
    if (symbol.includes(key)) return val;
  }
  return 75;
}

function findLastSpike(candles: any[]): { idx: number; size: number } {
  if (candles.length < 10) return { idx: -1, size: 0 };
  const ranges = candles.map((c: any) => (c.high || c.close * 1.001) - (c.low || c.close * 0.999));
  const avgRange = ranges.slice(-50).reduce((a: number, b: number) => a + b, 0) / Math.min(50, ranges.length) || 1;
  const threshold = avgRange * 4;
  for (let i = candles.length - 2; i >= 0; i--) {
    if (ranges[i] > threshold) return { idx: i, size: ranges[i] };
  }
  return { idx: -1, size: 0 };
}

// ══════════════════════════════════════════════════════════════════════════════
// MÓDULO 1: DETECÇÃO DE PIVÔS — ALGORITMO GIRASSOL (ZigZag Fib)
// Replica a lógica do indicador Girassol Sunflower MT5 v1.70
// ══════════════════════════════════════════════════════════════════════════════

function detectGirassolPivots(
  candles: any[],
  period: number,
  deviation: number,
  backstep: number,
  type: 'high' | 'low'
): Array<{ idx: number; price: number }> {
  if (candles.length < period * 2) return [];
  const prices = type === 'high'
    ? candles.map((c: any) => c.high || c.close * 1.001)
    : candles.map((c: any) => c.low  || c.close * 0.999);

  const pivots: Array<{ idx: number; price: number }> = [];
  const halfPeriod = Math.max(backstep, Math.floor(period / 2));

  for (let i = halfPeriod; i < prices.length - halfPeriod; i++) {
    const window = prices.slice(Math.max(0, i - halfPeriod), i + halfPeriod + 1);
    const extreme = type === 'high' ? Math.max(...window) : Math.min(...window);
    const isExtreme = type === 'high' ? prices[i] >= extreme : prices[i] <= extreme;
    if (!isExtreme) continue;

    // Validação de desvio: o pivô deve desviar do preço médio pelo fator de desvio
    const windowAvg = window.reduce((a, b) => a + b, 0) / window.length;
    const devFactor = Math.abs(prices[i] - windowAvg) / (windowAvg || 1) * 1000;
    if (devFactor < deviation * 0.5) continue;

    // Backstep: não aceitar outro pivô muito próximo
    if (pivots.length > 0) {
      const lastPivot = pivots[pivots.length - 1];
      if (i - lastPivot.idx < backstep) {
        // Substituir se este for mais extremo
        if ((type === 'high' && prices[i] > lastPivot.price) ||
            (type === 'low'  && prices[i] < lastPivot.price)) {
          pivots[pivots.length - 1] = { idx: i, price: prices[i] };
        }
        continue;
      }
    }
    pivots.push({ idx: i, price: prices[i] });
  }

  return pivots;
}

/**
 * Analisa um grupo do Girassol e retorna se detectou duplo padrão
 */
function analyzeGirassolGroup(
  candles: any[],
  groupNum: 1 | 2 | 3,
  params: { period: number; deviation: number; backstep: number },
  spikeType: 'crash' | 'boom',
  fibLevels: FibLevel[]
): GirassolGroupResult {
  const groupLabel = groupNum === 1 ? 'micro' : groupNum === 2 ? 'meso' : 'macro';

  const empty: GirassolGroupResult = {
    group: groupNum, groupLabel,
    period: params.period, deviation: params.deviation, backstep: params.backstep,
    pivotsFound: 0, doublePatternDetected: false, patternType: null,
    pivot1Price: 0, pivot2Price: 0, divergencePct: 0, candlesBetween: 0,
    fibAlignment: false, fibLevel: null, groupScore: 0,
  };

  // Para Crash: procurar duplo topo (dois topos → SELL spike)
  // Para Boom:  procurar duplo fundo (dois fundos → BUY spike)
  const pivotType = spikeType === 'crash' ? 'high' : 'low';
  const pivots = detectGirassolPivots(candles, params.period, params.deviation, params.backstep, pivotType);

  if (pivots.length < 2) return { ...empty, pivotsFound: pivots.length };

  // Pegar os dois pivôs mais recentes
  const p1 = pivots[pivots.length - 2];
  const p2 = pivots[pivots.length - 1];
  const divergencePct = Math.abs(p1.price - p2.price) / p1.price * 100;
  const candlesBetween = p2.idx - p1.idx;

  // Tolerância de preço aumenta com o período (grupos maiores = pivôs mais distantes)
  const priceTolerance = 0.4 + params.period * 0.02; // ~0.5% micro, ~0.66% meso, ~1.08% macro
  const minCandlesBetween = params.backstep;
  const maxCandlesBetween = params.period * 5;

  const doubleDetected = divergencePct <= priceTolerance &&
                         candlesBetween >= minCandlesBetween &&
                         candlesBetween <= maxCandlesBetween;

  if (!doubleDetected) return { ...empty, pivotsFound: pivots.length };

  const patternType = spikeType === 'crash' ? 'double_top' : 'double_bottom';
  const avgPivotPrice = (p1.price + p2.price) / 2;

  // Verificar alinhamento com Fibonacci
  const nearestFib = fibLevels.find(f => Math.abs(f.price - avgPivotPrice) / avgPivotPrice * 100 < 0.6);
  const fibAlignment = !!nearestFib;

  // Score do grupo
  let groupScore = 60;
  if (divergencePct <= priceTolerance * 0.4) groupScore += 15; // muito próximos
  if (candlesBetween <= params.period)       groupScore += 10; // pivôs próximos no tempo
  if (fibAlignment)                           groupScore += 20; // alinhado com Fibonacci
  groupScore = Math.min(100, groupScore);

  return {
    group: groupNum, groupLabel,
    period: params.period, deviation: params.deviation, backstep: params.backstep,
    pivotsFound: pivots.length,
    doublePatternDetected: true,
    patternType,
    pivot1Price: p1.price,
    pivot2Price: p2.price,
    divergencePct: Math.round(divergencePct * 1000) / 1000,
    candlesBetween,
    fibAlignment,
    fibLevel: nearestFib?.label || null,
    groupScore,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// MÓDULO 2: SISTEMA GIRASSOL COMPLETO (3 grupos cooperando)
// ══════════════════════════════════════════════════════════════════════════════

function runGirassolSystem(
  candles: any[],
  spikeType: 'crash' | 'boom',
  fibLevels: FibLevel[],
  externalPivots: ExternalGirassolPivot[]
): GirassolSystemResult {
  const g1 = analyzeGirassolGroup(candles, 1, GIRASSOL_PARAMS.group1, spikeType, fibLevels);
  const g2 = analyzeGirassolGroup(candles, 2, GIRASSOL_PARAMS.group2, spikeType, fibLevels);
  const g3 = analyzeGirassolGroup(candles, 3, GIRASSOL_PARAMS.group3, spikeType, fibLevels);

  const groups = [g1, g2, g3];
  const activeGroups = groups.filter(g => g.doublePatternDetected).length;
  const fibAlignedGroups = groups.filter(g => g.fibAlignment).length;

  const triConfluence = activeGroups === 3;
  const dualConfluence = activeGroups === 2;
  const singleSignal = activeGroups === 1;

  const dominantPattern = activeGroups > 0
    ? (spikeType === 'crash' ? 'double_top' : 'double_bottom')
    : null;

  // Score total ponderado (grupos macro têm mais peso)
  const weights = [0.25, 0.35, 0.40]; // micro=25%, meso=35%, macro=40%
  let totalScore = 0;
  groups.forEach((g, idx) => {
    if (g.doublePatternDetected) totalScore += g.groupScore * weights[idx];
  });

  // Boost por confluência
  if (triConfluence)  totalScore *= 1.6;
  else if (dualConfluence) totalScore *= 1.25;

  // Boost adicional por alinhamento Fibonacci
  if (fibAlignedGroups >= 2) totalScore *= 1.3;
  else if (fibAlignedGroups === 1) totalScore *= 1.15;

  totalScore = Math.min(100, Math.round(totalScore));

  // Boost por pivôs externos do EA (indicador real rodando no MT5)
  const externalBonus = externalPivots.length > 0 ? 10 : 0;
  const finalScore = Math.min(100, totalScore + externalBonus);

  const confluenceLabel =
    triConfluence  ? 'crítica' :
    dualConfluence ? 'forte'   :
    singleSignal   ? (fibAlignedGroups > 0 ? 'moderada' : 'fraca') :
    'nenhuma';

  let description = activeGroups === 0
    ? 'Nenhum padrão Girassol detectado nos 3 grupos.'
    : `🌻 Girassol: ${activeGroups}/3 grupo(s) confirmam ${dominantPattern === 'double_top' ? 'Duplo Topo' : 'Duplo Fundo'}`;
  if (triConfluence)      description += ' — TRI-CONFLUÊNCIA MÁXIMA';
  else if (dualConfluence) description += ' — confluência dupla';
  if (fibAlignedGroups > 0) description += ` | ${fibAlignedGroups} grupo(s) alinhado(s) com Fibonacci`;

  return {
    groupResults: groups,
    activeGroups,
    triConfluence,
    dualConfluence,
    singleSignal,
    dominantPattern,
    totalGirassolScore: finalScore,
    fibAlignedGroups,
    confluenceLabel,
    description,
    externalPivots: externalPivots.length > 0 ? externalPivots : undefined,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// MÓDULO 3: AUTO FIBONACCI (calculado a partir dos pivôs do Girassol)
// ══════════════════════════════════════════════════════════════════════════════

function calcAutoFib(
  candles: any[],
  girassolSystem: GirassolSystemResult,
  currentPrice: number
): AutoFibResult {
  const emptyFib: AutoFibResult = {
    source: 'candle_range', swingHigh: 0, swingLow: 0,
    levels: [], nearestLevel: null, confluenceCount: 0,
    significance: 'none', spikeMultiplier: 1.0,
  };

  if (candles.length < 20) return emptyFib;

  let swingHigh: number;
  let swingLow: number;
  let source: 'girassol_pivots' | 'candle_range' = 'candle_range';

  // Preferência 1: usar os pivôs detectados pelo Girassol
  const activeMacroGroup = girassolSystem.groupResults.find(g => g.group === 3 && g.doublePatternDetected);
  const activeMesoGroup  = girassolSystem.groupResults.find(g => g.group === 2 && g.doublePatternDetected);

  if (activeMacroGroup) {
    // AutoFib traçado a partir do pivô macro (maior estrutura)
    const p1 = activeMacroGroup.pivot1Price;
    const p2 = activeMacroGroup.pivot2Price;
    const range = Math.abs(p1 - p2);
    swingHigh = Math.max(p1, p2) + range * 0.3;
    swingLow  = Math.min(p1, p2) - range * 0.3;
    source = 'girassol_pivots';
  } else if (activeMesoGroup) {
    const p1 = activeMesoGroup.pivot1Price;
    const p2 = activeMesoGroup.pivot2Price;
    const range = Math.abs(p1 - p2);
    swingHigh = Math.max(p1, p2) + range * 0.2;
    swingLow  = Math.min(p1, p2) - range * 0.2;
    source = 'girassol_pivots';
  } else {
    // Fallback: usar range dos últimos 50 candles
    const highs = candles.slice(-50).map((c: any) => c.high || c.close * 1.001);
    const lows  = candles.slice(-50).map((c: any) => c.low  || c.close * 0.999);
    swingHigh = Math.max(...highs);
    swingLow  = Math.min(...lows);
  }

  const range = swingHigh - swingLow;
  if (range <= 0) return emptyFib;

  const levels: FibLevel[] = FIB_RATIOS.map(ratio => {
    const price = swingLow + range * (1 - ratio);
    const distancePct = Math.abs(currentPrice - price) / currentPrice * 100;
    const label = `${(ratio * 100).toFixed(1)}%`;
    return {
      label, price, pct: ratio, distancePct,
      layer: 'meso',
      significance: FIB_SIGNIFICANCE[ratio] || 'minor',
    };
  }).filter(l => l.distancePct < 4.0).sort((a, b) => a.distancePct - b.distancePct);

  const nearestLevel = levels[0] || null;
  const confluenceCount = levels.filter(l => l.distancePct < 0.5).length;
  const significance = nearestLevel?.significance || 'none' as any;
  const spikeMultiplier = nearestLevel ? (SPIKE_FIB_MULTIPLIERS[nearestLevel.label] || 1.2) : 1.0;

  return { source, swingHigh, swingLow, levels, nearestLevel, confluenceCount, significance, spikeMultiplier };
}

// ══════════════════════════════════════════════════════════════════════════════
// MÓDULO 4: IA COOPERATIVA (CÉREBRO OPERACIONAL)
// Analisa tudo que os indicadores não capturam diretamente
// ══════════════════════════════════════════════════════════════════════════════

function runAIBrainAnalysis(
  candles: any[],
  spikeType: 'crash' | 'boom',
  imminencePercent: number,
  girassolScore: number
): AIBrainAnalysis {
  const closes = candles.map((c: any) => c.close);
  const highs  = candles.map((c: any) => c.high || c.close * 1.001);
  const lows   = candles.map((c: any) => c.low  || c.close * 0.999);

  const n = Math.min(14, closes.length - 1);

  // ── RSI implícito (momentum de fechamentos) ──
  let gains = 0, losses = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const rs = losses === 0 ? 100 : gains / losses;
  const rsi = 100 - 100 / (1 + rs);
  // Crash: RSI alto (>65) = tensão de queda; Boom: RSI baixo (<35) = tensão de subida
  const impliedRsiScore = spikeType === 'crash'
    ? Math.max(0, (rsi - 50) * 2)
    : Math.max(0, (50 - rsi) * 2);

  // ── Momentum dos últimos 6 candles ──
  const recent6 = closes.slice(-6);
  const momentumValue = recent6.length > 1
    ? (recent6[recent6.length - 1] - recent6[0]) / recent6[0] * 100
    : 0;
  const momentumConfirms = (spikeType === 'crash' && momentumValue > 0.008) ||
                           (spikeType === 'boom'  && momentumValue < -0.008);
  const momentumScore = momentumConfirms ? Math.min(100, Math.abs(momentumValue) * 5000) : 0;

  // ── Compressão de volatilidade (Bollinger squeeze implícito) ──
  const recent10Ranges = candles.slice(-10).map((c: any) =>
    (c.high || c.close * 1.001) - (c.low || c.close * 0.999));
  const recent50Ranges = candles.slice(-50).map((c: any) =>
    (c.high || c.close * 1.001) - (c.low || c.close * 0.999));
  const avgRecent = recent10Ranges.reduce((a: number, b: number) => a + b, 0) / recent10Ranges.length;
  const avgHistorical = recent50Ranges.reduce((a: number, b: number) => a + b, 0) / recent50Ranges.length;
  const compressionRatio = avgHistorical > 0 ? avgRecent / avgHistorical : 1;
  const bollingerSqueezeScore = Math.round(Math.max(0, (1 - compressionRatio) * 100));
  const volatilityCompressed = compressionRatio < 0.6;
  const volatilityScore = volatilityCompressed ? bollingerSqueezeScore : 0;

  // ── ATR normalizado (Average True Range) ──
  const trueRanges = candles.slice(-14).map((c: any, i: number, arr: any[]) => {
    if (i === 0) return (c.high || c.close * 1.001) - (c.low || c.close * 0.999);
    const prevClose = arr[i - 1].close;
    return Math.max(
      (c.high || c.close * 1.001) - (c.low || c.close * 0.999),
      Math.abs((c.high || c.close * 1.001) - prevClose),
      Math.abs((c.low  || c.close * 0.999) - prevClose)
    );
  });
  const atr = trueRanges.reduce((a: number, b: number) => a + b, 0) / trueRanges.length;
  const currentPrice = closes[closes.length - 1];
  const atrNormalized = atr / currentPrice * 100;

  // ── Exaustão de tendência ──
  // Sequência de candles todos na mesma direção = exaustão
  let consecutiveSameDir = 0;
  for (let i = closes.length - 1; i > closes.length - 8 && i > 0; i--) {
    const dir = closes[i] > closes[i - 1] ? 'up' : 'down';
    const expected = spikeType === 'crash' ? 'up' : 'down';
    if (dir === expected) consecutiveSameDir++;
    else break;
  }
  const trendExhaustionScore = Math.min(100, consecutiveSameDir * 15);

  // ── Contagem de candles desde último spike ──
  const candleCountScore = Math.min(100, imminencePercent);

  // ── Score geral da IA (ponderado) ──
  const overallAIScore = Math.min(100, Math.round(
    momentumScore     * 0.20 +
    impliedRsiScore   * 0.20 +
    volatilityScore   * 0.20 +
    trendExhaustionScore * 0.15 +
    candleCountScore  * 0.15 +
    bollingerSqueezeScore * 0.10
  ));

  const signals: string[] = [];
  if (impliedRsiScore > 40)         signals.push(`📊 RSI implícito: ${rsi.toFixed(1)} — pressão ${spikeType === 'crash' ? 'de queda' : 'de alta'}`);
  if (momentumConfirms)             signals.push(`📈 Momentum ${spikeType === 'crash' ? '+' : '-'}${Math.abs(momentumValue).toFixed(3)}% — confirmando pré-spike`);
  if (volatilityCompressed)         signals.push(`🗜️ Volatilidade comprimida ${bollingerSqueezeScore}% — tensão acumulada (Bollinger squeeze)`);
  if (trendExhaustionScore >= 30)   signals.push(`🔄 ${consecutiveSameDir} candles consecutivos na direção pré-spike — exaustão de tendência`);
  if (atrNormalized < 0.1)          signals.push(`📏 ATR mínimo (${atrNormalized.toFixed(3)}%) — mercado parado antes do spike`);

  return {
    momentumScore, volatilityScore, compressionScore: bollingerSqueezeScore,
    candleCountScore, impliedRsiScore, bollingerSqueezeScore,
    atrNormalized: Math.round(atrNormalized * 10000) / 10000,
    trendExhaustionScore,
    overallAIScore,
    signals,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// MÓDULO 5: FIBONACCI LEGADO (multi-layer, meso/micro/macro)
// ══════════════════════════════════════════════════════════════════════════════

function calcFibLevels(high: number, low: number, layer: 'macro' | 'meso' | 'micro', currentPrice: number): FibLevel[] {
  const range = high - low;
  if (range <= 0) return [];
  return FIB_RATIOS.map(ratio => {
    const price = low + range * (1 - ratio);
    const distancePct = Math.abs(currentPrice - price) / currentPrice * 100;
    const label = `${(ratio * 100).toFixed(1)}%`;
    return { label, price, pct: ratio, distancePct, layer, significance: FIB_SIGNIFICANCE[ratio] || 'minor' };
  }).filter(l => l.distancePct < 3.0);
}

// ══════════════════════════════════════════════════════════════════════════════
// FUNÇÃO PRINCIPAL — ANÁLISE COOPERATIVA COMPLETA
// ══════════════════════════════════════════════════════════════════════════════

export function analyzeCrashBoomSpike(
  symbol: string,
  candles: any[],
  openPosition?: { type: 'BUY' | 'SELL'; profit: number } | null
): SpikeDetectionResult {
  const sym = symbol.toUpperCase();
  const isCrash = sym.includes('CRASH');
  const isBoom  = sym.includes('BOOM');
  const isSpikeIndex = isCrash || isBoom;
  const spikeType = isCrash ? 'crash' : 'boom';
  const spikeDirection = isCrash ? 'down' : 'up';

  const emptyGirassol: GirassolSystemResult = {
    groupResults: [], activeGroups: 0, triConfluence: false, dualConfluence: false,
    singleSignal: false, dominantPattern: null, totalGirassolScore: 0,
    fibAlignedGroups: 0, confluenceLabel: 'nenhuma', description: 'Símbolo não é Crash/Boom.',
  };
  const emptyAutoFib: AutoFibResult = {
    source: 'candle_range', swingHigh: 0, swingLow: 0, levels: [],
    nearestLevel: null, confluenceCount: 0, significance: 'none', spikeMultiplier: 1.0,
  };
  const emptyAI: AIBrainAnalysis = {
    momentumScore: 0, volatilityScore: 0, compressionScore: 0, candleCountScore: 0,
    impliedRsiScore: 0, bollingerSqueezeScore: 0, atrNormalized: 0,
    trendExhaustionScore: 0, overallAIScore: 0, signals: [],
  };

  const empty: SpikeDetectionResult = {
    symbol, isSpikeIndex: false, spikeType: null, averageInterval: 0,
    candlesSinceLastSpike: 0, imminencePercent: 0, imminenceLabel: 'baixa',
    girassolSystem: emptyGirassol, autoFib: emptyAutoFib,
    fibZoneScore: null, nearestFibLevels: [], fibConfluence: 0, fibSpikeMultiplier: 1.0,
    aiBrain: emptyAI, momentumConfirms: false, momentumValue: 0,
    volatilityCompressed: false, compressionScore: 0,
    overallConfidence: 0, spikeExpected: false, spikeDirection: null,
    preEntryWindow: false, entryTimingScore: 0, ticksUntilEstimate: 0,
    switchRecommendation: null, narrative: 'Símbolo não é Crash/Boom.', alerts: [],
  };

  if (!isSpikeIndex || candles.length < 20) return empty;

  const avgInterval  = getAvgInterval(sym);
  const currentPrice = candles[candles.length - 1].close;

  // ── Contagem de candles desde último spike ──
  const { idx: lastSpikeIdx } = findLastSpike(candles);
  const candlesSinceLastSpike = lastSpikeIdx >= 0 ? candles.length - 1 - lastSpikeIdx : candles.length;
  const imminencePercent = Math.min(100, Math.round((candlesSinceLastSpike / avgInterval) * 100));

  // ── Fibonacci legado (multi-layer para compatibilidade) ──
  const highs = candles.map((c: any) => c.high || c.close * 1.001);
  const lows  = candles.map((c: any) => c.low  || c.close * 0.999);
  const macroLevels = calcFibLevels(Math.max(...highs.slice(-100)), Math.min(...lows.slice(-100)), 'macro', currentPrice);
  const mesoLevels  = calcFibLevels(Math.max(...highs.slice(-30)),  Math.min(...lows.slice(-30)),  'meso',  currentPrice);
  const microLevels = calcFibLevels(Math.max(...highs.slice(-10)),  Math.min(...lows.slice(-10)),  'micro', currentPrice);
  const allFibLevels = [...macroLevels, ...mesoLevels, ...microLevels]
    .sort((a, b) => a.distancePct - b.distancePct).slice(0, 8);

  let fibSpikeMultiplier = 1.0;
  let bestFibZone: FibZoneScore | null = null;
  let fibConfluence = 0;
  if (allFibLevels.length > 0) {
    const nearest = allFibLevels[0];
    const multiplier = SPIKE_FIB_MULTIPLIERS[nearest.label] || 1.2;
    const sigWeight = nearest.significance === 'critical' ? 3 : nearest.significance === 'major' ? 2 : 1;
    const distScore = Math.max(0, 1 - nearest.distancePct / 3);
    const layerCount = new Set(allFibLevels.slice(0, 3).map(l => l.layer)).size;
    fibConfluence = Math.round(distScore * sigWeight * 20 * (0.7 + layerCount * 0.15));
    fibSpikeMultiplier = multiplier * (0.8 + layerCount * 0.1);
    bestFibZone = { level: nearest.label, layer: nearest.layer, distancePct: nearest.distancePct, significance: nearest.significance, spikeMultiplier: multiplier };
  }

  // ── MÓDULO 1: Sistema Girassol (3 grupos Fibonacci) ──
  const externalPivots = getExternalGirassolPivots(sym);
  const girassolSystem = runGirassolSystem(candles, spikeType, allFibLevels, externalPivots);

  // ── MÓDULO 2: Auto Fibonacci a partir dos pivôs ──
  const autoFib = calcAutoFib(candles, girassolSystem, currentPrice);

  // ── MÓDULO 3: IA Cooperativa (cérebro operacional) ──
  const aiBrain = runAIBrainAnalysis(candles, spikeType, imminencePercent, girassolSystem.totalGirassolScore);
  const momentumConfirms = aiBrain.momentumScore > 20;
  const volatilityCompressed = aiBrain.volatilityScore > 30;
  const momentumValue = candles.slice(-6).length > 1
    ? (candles[candles.length-1].close - candles[candles.length-6].close) / candles[candles.length-6].close * 100
    : 0;

  // ══════════════════════════════════════════════════════════════════════════
  // SCORE FINAL COOPERATIVO
  // Pesos: Girassol 35% | AutoFib 20% | IA 30% | Iminência 15%
  // ══════════════════════════════════════════════════════════════════════════
  const girassolWeight  = 0.35;
  const autoFibWeight   = 0.20;
  const aiWeight        = 0.30;
  const imminenceWeight = 0.15;

  const autoFibScore = autoFib.nearestLevel
    ? Math.min(100, (autoFib.spikeMultiplier - 1) * 80 + (autoFib.confluenceCount * 20))
    : 0;

  let cooperativeScore =
    girassolSystem.totalGirassolScore * girassolWeight +
    autoFibScore                      * autoFibWeight  +
    aiBrain.overallAIScore            * aiWeight       +
    imminencePercent                  * imminenceWeight;

  // Amplificação por tri-confluência Girassol
  if (girassolSystem.triConfluence)  cooperativeScore *= 1.4;
  else if (girassolSystem.dualConfluence) cooperativeScore *= 1.2;

  // Amplificação por AutoFib em zona crítica
  if (autoFib.significance === 'critical') cooperativeScore *= 1.2;
  else if (autoFib.significance === 'major') cooperativeScore *= 1.1;

  // Boost adicional se Girassol + AutoFib alinhados
  if (girassolSystem.fibAlignedGroups >= 2 && autoFib.nearestLevel) cooperativeScore *= 1.15;

  const overallConfidence = Math.min(98, Math.round(cooperativeScore));

  // Thresholds adaptativos (mais baixos quando Girassol detectou algo)
  const imminenceThreshold  = girassolSystem.activeGroups >= 2 ? 20 : girassolSystem.activeGroups === 1 ? 35 : 60;
  const confidenceThreshold = girassolSystem.activeGroups >= 2 ? 30 : 45;
  const spikeExpected = imminencePercent >= imminenceThreshold && overallConfidence >= confidenceThreshold;

  // Score de timing de entrada
  const girassolTimingBoost = girassolSystem.totalGirassolScore * 0.4;
  const timingBase = Math.max(0, imminencePercent - 40) * 2;
  const aiTimingBoost = aiBrain.overallAIScore * 0.3;
  const entryTimingScore = Math.min(100, Math.round(timingBase + girassolTimingBoost + aiTimingBoost));
  const preEntryWindow = entryTimingScore >= 50 && spikeExpected;

  const remainingFraction = Math.max(0, 1 - candlesSinceLastSpike / avgInterval);
  const ticksUntilEstimate = Math.round(remainingFraction * avgInterval * 10);

  let imminenceLabel: SpikeDetectionResult['imminenceLabel'] = 'baixa';
  if (imminencePercent >= 90)      imminenceLabel = 'crítica';
  else if (imminencePercent >= 70) imminenceLabel = 'alta';
  else if (imminencePercent >= 45) imminenceLabel = 'moderada';

  // ── Alertas ordenados por prioridade ──
  const alerts: string[] = [];

  if (girassolSystem.triConfluence) {
    alerts.push(`🚨 GIRASSOL TRI-CONFLUÊNCIA — 3/3 grupos Fibonacci confirmam ${girassolSystem.dominantPattern === 'double_top' ? 'Duplo Topo' : 'Duplo Fundo'} — SINAL CRÍTICO`);
  } else if (girassolSystem.dualConfluence) {
    alerts.push(`🌻 GIRASSOL DUPLA CONFLUÊNCIA — 2/3 grupos confirmam padrão — sinal forte`);
  } else if (girassolSystem.singleSignal) {
    alerts.push(`🌻 Girassol Grupo ${girassolSystem.groupResults.find(g => g.doublePatternDetected)?.groupLabel} detectou padrão`);
  }

  if (girassolSystem.fibAlignedGroups > 0) {
    alerts.push(`✨ ${girassolSystem.fibAlignedGroups} grupo(s) Girassol alinhado(s) com AutoFib — força máxima`);
  }
  if (autoFib.nearestLevel && autoFib.significance !== 'none') {
    alerts.push(`📐 AutoFib ${autoFib.nearestLevel.label} a ${autoFib.nearestLevel.distancePct.toFixed(2)}% — ${autoFib.source === 'girassol_pivots' ? 'traçado dos pivôs Girassol' : 'range de mercado'} — ×${autoFib.spikeMultiplier.toFixed(1)}`);
  }
  if (imminencePercent >= 85) {
    alerts.push(`⚡ Iminência CRÍTICA — ${candlesSinceLastSpike}/${avgInterval} candles desde último spike`);
  }
  alerts.push(...aiBrain.signals.slice(0, 3));
  if (preEntryWindow) {
    alerts.push(`🎯 JANELA DE ENTRADA PRÉ-SPIKE — Score ${entryTimingScore}/100`);
  }
  if (externalPivots.length > 0) {
    alerts.push(`📡 ${externalPivots.length} pivô(s) recebidos diretamente do indicador Girassol (MT5)`);
  }

  // ── Recomendação de transição ──
  let switchRecommendation: SwitchRecommendation | null = null;
  if (openPosition && preEntryWindow && overallConfidence >= 50) {
    const exitDir: 'CLOSE_BUY' | 'CLOSE_SELL' = openPosition.type === 'BUY' ? 'CLOSE_BUY' : 'CLOSE_SELL';
    const spikeEntryDir: 'BUY' | 'SELL' = spikeDirection === 'down' ? 'SELL' : 'BUY';
    const isBadPosition = (openPosition.type === 'BUY' && spikeDirection === 'down') ||
                          (openPosition.type === 'SELL' && spikeDirection === 'up');
    const urgency = overallConfidence >= 80 ? 'critical' : overallConfidence >= 65 ? 'high' : 'warning';
    const secondsToAct = urgency === 'critical' ? 3 : urgency === 'high' ? 8 : 15;
    if (isBadPosition || urgency === 'critical') {
      switchRecommendation = {
        action: 'EXIT_CONTINUITY_ENTER_SPIKE', urgency, exitDirection: exitDir, spikeDirection: spikeEntryDir,
        confidence: overallConfidence,
        reasoning:
          (girassolSystem.activeGroups > 0
            ? `Gatilho Girassol ${girassolSystem.confluenceLabel} (${girassolSystem.activeGroups}/3 grupos). `
            : '') +
          (autoFib.nearestLevel ? `AutoFib ${autoFib.nearestLevel.label} (${autoFib.significance}). ` : '') +
          `IA Score: ${aiBrain.overallAIScore}%. Iminência: ${imminencePercent}%. Confiança: ${overallConfidence}%.`,
        secondsToAct,
      };
    }
  }

  // ── Narrativa completa ──
  const narrative =
    `${isCrash ? '🔴 CRASH' : '🟢 BOOM'} ${symbol} — ` +
    `${girassolSystem.description} | ` +
    (autoFib.nearestLevel ? `AutoFib ${autoFib.nearestLevel.label} a ${autoFib.nearestLevel.distancePct.toFixed(2)}% | ` : '') +
    `IA: ${aiBrain.overallAIScore}% | ` +
    `Iminência: ${imminencePercent}% (${imminenceLabel}) | ` +
    `Confiança cooperativa: ${overallConfidence}%. ` +
    (spikeExpected ? `⚡ SPIKE ${spikeDirection.toUpperCase()} ESPERADO.` : 'Aguardando confluência.');

  return {
    symbol, isSpikeIndex: true, spikeType, averageInterval: avgInterval,
    candlesSinceLastSpike, imminencePercent, imminenceLabel,
    girassolSystem, autoFib,
    fibZoneScore: bestFibZone, nearestFibLevels: allFibLevels.slice(0, 5),
    fibConfluence, fibSpikeMultiplier,
    aiBrain, momentumConfirms, momentumValue: Math.round(momentumValue * 10000) / 10000,
    volatilityCompressed, compressionScore: aiBrain.bollingerSqueezeScore,
    overallConfidence, spikeExpected, spikeDirection: spikeDirection as 'down' | 'up',
    preEntryWindow, entryTimingScore, ticksUntilEstimate,
    switchRecommendation, narrative, alerts,
  };
}

export function analyzeContinuitySafety(
  symbol: string,
  candles: any[],
  positionType: 'BUY' | 'SELL'
): ContinuityAnalysis {
  const spike = analyzeCrashBoomSpike(symbol, candles);
  if (!spike.isSpikeIndex) {
    return { symbol, canContinue: true, direction: positionType, confidence: 70, spikeRiskLevel: 'safe', exitNow: false, reasoning: 'Símbolo não é Crash/Boom — continuidade normal.' };
  }
  const riskLevel =
    spike.overallConfidence >= 80 ? 'abort' :
    spike.overallConfidence >= 60 ? 'danger' :
    spike.overallConfidence >= 40 ? 'caution' : 'safe';
  const exitNow = riskLevel === 'abort' || spike.switchRecommendation?.urgency === 'critical';
  const canContinue = riskLevel === 'safe' || riskLevel === 'caution';
  const reasoning =
    riskLevel === 'abort'   ? `🚨 Sair imediatamente — ${spike.narrative}` :
    riskLevel === 'danger'  ? `⚠️ Alto risco — ${spike.narrative}` :
    riskLevel === 'caution' ? `⚡ Atenção — ${spike.narrative}` :
                              `✅ Continuar — ${spike.narrative}`;
  return { symbol, canContinue, direction: positionType, confidence: 100 - spike.overallConfidence, spikeRiskLevel: riskLevel, exitNow, reasoning };
}
