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
  /** Ambos os pivôs do padrão têm marcação Girassol confirmada (sinal de reversão de alta confiança) */
  bothPivotsMarked: boolean;
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
  /** Grupos onde ambos os pivôs do padrão têm marcação Girassol dupla confirmada */
  bothMarkedGroups: number;
  /** Todos os 3 grupos têm dupla marcação Girassol — reversão de certeza máxima */
  tripleBothMarked: boolean;
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

/**
 * Tipo de gatilho de entrada/saída do Girassol.
 *
 * HIERARQUIA OBRIGATÓRIA:
 *  girassol_flower → aparecimento do girassol (grupo macro ou confluência) — gatilho padrão
 *  bolinha_media   → aparecimento da bolinha média (grupo meso ativo)      — gatilho válido
 *  bolinha_menor   → aparecimento da bolinha menor (só grupo micro)        — RARISSIMO, altíssima certeza
 *  none            → sem gatilho Girassol — OPERAÇÃO BLOQUEADA
 *
 * A IA e os outros indicadores ajudam a CONFIRMAR a direção,
 * mas NUNCA disparam entrada/saída por si só. Só o Girassol abre o gate.
 */
export type GirassolTriggerType = 'girassol_flower' | 'bolinha_media' | 'bolinha_menor' | 'none';

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

  /**
   * Tipo de gatilho Girassol que disparou (ou não) esta análise.
   * REGRA CENTRAL: sem gatilho Girassol confirmado = sem operação.
   */
  girassolTriggerType: GirassolTriggerType;

  /**
   * Limiar de confiança mínima exigido para o gatilho atual.
   * Varia conforme o tipo: flower=55, media=65, menor=85, none=999.
   */
  entryConfidenceThreshold: number;

  /**
   * AutoFib validou o nível do pivô Girassol? Quando true, amplia a confiança.
   * Quando false na presença de bolinha_menor, pode bloquear a entrada.
   */
  autoFibValidatesGirassol: boolean;

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

/**
 * Conta quantos mínimos recentes (lows) estão dentro de uma banda percentual
 * do preço atual — detecta zonas de suporte testadas múltiplas vezes.
 *
 * Ex: se 2+ lows ficaram dentro de 0.3% do preço atual → zona de suporte forte.
 * Isso indica que os vendedores falharam repetidamente em romper esse nível.
 * Entrar SELL nessa zona é extremamente arriscado.
 */
function countNearLows(candles: any[], currentPrice: number, bandPct: number): number {
  if (candles.length < 10) return 0;
  const lows = candles.slice(-80).map((c: any) => c.low || c.close * 0.999);
  const band = currentPrice * bandPct;
  // Contar apenas lows que são ABAIXO ou no nível do preço atual (suporte real)
  return lows.filter(l => l <= currentPrice + band && l >= currentPrice - band).length;
}

/**
 * Conta quantos máximos recentes (highs) estão dentro de uma banda percentual
 * do preço atual — detecta zonas de resistência testadas múltiplas vezes.
 */
function countNearHighs(candles: any[], currentPrice: number, bandPct: number): number {
  if (candles.length < 10) return 0;
  const highs = candles.slice(-80).map((c: any) => c.high || c.close * 1.001);
  const band = currentPrice * bandPct;
  return highs.filter(h => h >= currentPrice - band && h <= currentPrice + band).length;
}

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
  pivotType: 'high' | 'low',
  fibLevels: FibLevel[]
): GirassolGroupResult {
  const groupLabel = groupNum === 1 ? 'micro' : groupNum === 2 ? 'meso' : 'macro';

  const empty: GirassolGroupResult = {
    group: groupNum, groupLabel,
    period: params.period, deviation: params.deviation, backstep: params.backstep,
    pivotsFound: 0, doublePatternDetected: false, patternType: null,
    pivot1Price: 0, pivot2Price: 0, divergencePct: 0, candlesBetween: 0,
    fibAlignment: false, fibLevel: null, groupScore: 0, bothPivotsMarked: false,
  };

  const pivots = detectGirassolPivots(candles, params.period, params.deviation, params.backstep, pivotType);

  if (pivots.length < 2) return { ...empty, pivotsFound: pivots.length };

  const p1 = pivots[pivots.length - 2];
  const p2 = pivots[pivots.length - 1];
  const divergencePct = Math.abs(p1.price - p2.price) / p1.price * 100;
  const candlesBetween = p2.idx - p1.idx;

  const priceTolerance = 0.4 + params.period * 0.02;
  const minCandlesBetween = params.backstep;
  const maxCandlesBetween = params.period * 5;

  const doubleDetected = divergencePct <= priceTolerance &&
                         candlesBetween >= minCandlesBetween &&
                         candlesBetween <= maxCandlesBetween;

  if (!doubleDetected) return { ...empty, pivotsFound: pivots.length };

  const patternType: 'double_top' | 'double_bottom' = pivotType === 'high' ? 'double_top' : 'double_bottom';
  const avgPivotPrice = (p1.price + p2.price) / 2;

  const nearestFib = fibLevels.find(f => Math.abs(f.price - avgPivotPrice) / avgPivotPrice * 100 < 0.6);
  const fibAlignment = !!nearestFib;

  // Dupla Marcação Girassol: ambos os pivôs são de alta qualidade
  // — divergência muito estreita (< 30% da tolerância) e timing ideal (dentro de period*2)
  const bothPivotsMarked =
    divergencePct <= priceTolerance * 0.3 &&
    candlesBetween >= params.backstep &&
    candlesBetween <= params.period * 2;

  let groupScore = 60;
  if (divergencePct <= priceTolerance * 0.4) groupScore += 15;
  if (candlesBetween <= params.period)       groupScore += 10;
  if (fibAlignment)                           groupScore += 20;
  // Boost significativo quando ambos os pivôs têm marcação Girassol confirmada
  if (bothPivotsMarked)                       groupScore += 25;
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
    bothPivotsMarked,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// MÓDULO 2: SISTEMA GIRASSOL COMPLETO (3 grupos cooperando)
// ══════════════════════════════════════════════════════════════════════════════

function scoreGirassolGroups(
  candles: any[],
  pivotType: 'high' | 'low',
  fibLevels: FibLevel[]
): { groups: GirassolGroupResult[]; totalScore: number; bothMarkedCount: number } {
  const g1 = analyzeGirassolGroup(candles, 1, GIRASSOL_PARAMS.group1, pivotType, fibLevels);
  const g2 = analyzeGirassolGroup(candles, 2, GIRASSOL_PARAMS.group2, pivotType, fibLevels);
  const g3 = analyzeGirassolGroup(candles, 3, GIRASSOL_PARAMS.group3, pivotType, fibLevels);
  const groups = [g1, g2, g3];
  const weights = [0.25, 0.35, 0.40];
  let totalScore = 0;
  groups.forEach((g, idx) => {
    if (g.doublePatternDetected) totalScore += g.groupScore * weights[idx];
  });
  const activeGroups = groups.filter(g => g.doublePatternDetected).length;
  const fibAlignedGroups = groups.filter(g => g.fibAlignment).length;
  const bothMarkedCount = groups.filter(g => g.bothPivotsMarked).length;

  if (activeGroups === 3) totalScore *= 1.6;
  else if (activeGroups === 2) totalScore *= 1.25;
  if (fibAlignedGroups >= 2) totalScore *= 1.3;
  else if (fibAlignedGroups === 1) totalScore *= 1.15;

  // Boost de Dupla Marcação Girassol: quando ambos os pivôs têm marcadores confirmados
  // é praticamente certeza de reversão — peso muito maior
  if (bothMarkedCount === 3) totalScore *= 1.8;       // todos 3 grupos marcados — máxima certeza
  else if (bothMarkedCount === 2) totalScore *= 1.45;  // 2 grupos marcados — alta certeza
  else if (bothMarkedCount === 1) totalScore *= 1.2;   // 1 grupo marcado — certeza moderada

  totalScore = Math.min(100, Math.round(totalScore));
  return { groups, totalScore, bothMarkedCount };
}

function runGirassolSystem(
  candles: any[],
  defaultSpikeType: 'crash' | 'boom',
  fibLevels: FibLevel[],
  externalPivots: ExternalGirassolPivot[]
): GirassolSystemResult & { detectedDirection: 'down' | 'up' } {
  // ══════════════════════════════════════════════════════════════════════
  // ANÁLISE BIDIRECIONAL — DETECTA DUPLO TOPO E DUPLO FUNDO
  //
  // O bot analisa os DOIS lados e escolhe o padrão que o Girassol
  // realmente identificou com maior força.
  //
  // Duplo Topo detectado  → SELL (spike de queda)
  // Duplo Fundo detectado → BUY  (spike de subida)
  //
  // Isso é válido tanto para Crash quanto para Boom, pois qualquer
  // um dos dois pode ter spikes para cima OU para baixo dependendo
  // do momento. O que importa é o padrão REAL formado no gráfico.
  // ══════════════════════════════════════════════════════════════════════
  const topResult    = scoreGirassolGroups(candles, 'high', fibLevels);
  const bottomResult = scoreGirassolGroups(candles, 'low',  fibLevels);

  let groups: GirassolGroupResult[];
  let dominantPattern: 'double_top' | 'double_bottom' | null;
  let detectedDirection: 'down' | 'up';
  let bothMarkedGroups: number;

  if (topResult.totalScore >= bottomResult.totalScore && topResult.totalScore > 0) {
    groups = topResult.groups;
    dominantPattern = 'double_top';
    detectedDirection = 'down';
    bothMarkedGroups = topResult.bothMarkedCount;
  } else if (bottomResult.totalScore > 0) {
    groups = bottomResult.groups;
    dominantPattern = 'double_bottom';
    detectedDirection = 'up';
    bothMarkedGroups = bottomResult.bothMarkedCount;
  } else {
    groups = topResult.groups;
    dominantPattern = null;
    detectedDirection = defaultSpikeType === 'crash' ? 'down' : 'up';
    bothMarkedGroups = 0;
  }

  const activeGroups = groups.filter(g => g.doublePatternDetected).length;
  const fibAlignedGroups = groups.filter(g => g.fibAlignment).length;
  const tripleBothMarked = bothMarkedGroups === 3;

  const triConfluence = activeGroups === 3;
  const dualConfluence = activeGroups === 2;
  const singleSignal = activeGroups === 1;

  // Score final (já calculado dentro de scoreGirassolGroups)
  const totalScore = dominantPattern === 'double_top' ? topResult.totalScore : bottomResult.totalScore;

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
    bothMarkedGroups,
    tripleBothMarked,
    externalPivots: externalPivots.length > 0 ? externalPivots : undefined,
    detectedDirection,
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
      layer: 'meso' as const,
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
  detectedDirection: 'down' | 'up',
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
  // Queda esperada (SELL): RSI alto (>50) = tensão de queda
  // Subida esperada (BUY): RSI baixo (<50) = tensão de alta
  const impliedRsiScore = detectedDirection === 'down'
    ? Math.max(0, (rsi - 50) * 2)
    : Math.max(0, (50 - rsi) * 2);

  // ── Momentum dos últimos 6 candles ──
  const recent6 = closes.slice(-6);
  const momentumValue = recent6.length > 1
    ? (recent6[recent6.length - 1] - recent6[0]) / recent6[0] * 100
    : 0;
  // Pré-spike de queda: momentum positivo (subida antes da queda)
  // Pré-spike de subida: momentum negativo (queda antes da recuperação)
  const momentumConfirms = (detectedDirection === 'down' && momentumValue > 0.008) ||
                           (detectedDirection === 'up'   && momentumValue < -0.008);
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
  // Pré-spike de queda: candles subindo consecutivamente = exaustão
  // Pré-spike de subida: candles caindo consecutivamente = exaustão
  let consecutiveSameDir = 0;
  for (let i = closes.length - 1; i > closes.length - 8 && i > 0; i--) {
    const dir = closes[i] > closes[i - 1] ? 'up' : 'down';
    const expected = detectedDirection === 'down' ? 'up' : 'down';
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
  if (impliedRsiScore > 40)         signals.push(`📊 RSI implícito: ${rsi.toFixed(1)} — pressão ${detectedDirection === 'down' ? 'de queda' : 'de alta'}`);
  if (momentumConfirms)             signals.push(`📈 Momentum ${detectedDirection === 'down' ? '+' : '-'}${Math.abs(momentumValue).toFixed(3)}% — confirmando pré-spike`);
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
  // spikeDirection será determinado pelo padrão detectado pelo Girassol (bidirecional)

  const emptyGirassol: GirassolSystemResult = {
    groupResults: [], activeGroups: 0, triConfluence: false, dualConfluence: false,
    singleSignal: false, dominantPattern: null, totalGirassolScore: 0,
    fibAlignedGroups: 0, confluenceLabel: 'nenhuma', description: 'Símbolo não é Crash/Boom.',
    bothMarkedGroups: 0, tripleBothMarked: false,
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
    girassolSystem: emptyGirassol,
    girassolTriggerType: 'none', entryConfidenceThreshold: 999, autoFibValidatesGirassol: false,
    autoFib: emptyAutoFib,
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

  // ── MÓDULO 1: Sistema Girassol (3 grupos Fibonacci) — BIDIRECIONAL ──
  const externalPivots = getExternalGirassolPivots(sym);
  const girassolSystem = runGirassolSystem(candles, spikeType, allFibLevels, externalPivots);

  // ── VERIFICAÇÃO DE ZONA DE SUPORTE / RESISTÊNCIA ──
  // Antes de aceitar a direção do Girassol, verificamos se o preço está
  // numa zona de suporte ou resistência já testada.
  //
  // Se o preço está em SUPORTE testado (2+ toques de mínimos próximos):
  //   → SELL é proibido (vendedores já falharam repetidamente)
  //   → Direção é forçada para UP (BUY), pois o suporte deve segurar
  //
  // Se o preço está em RESISTÊNCIA testada (2+ toques de máximos próximos):
  //   → BUY é proibido (compradores já falharam repetidamente)
  //   → Direção é forçada para DOWN (SELL), pois a resistência deve rejeitar
  const supportTouches    = countNearLows(candles, currentPrice, 0.003);   // 0.3% band
  const resistanceTouches = countNearHighs(candles, currentPrice, 0.003);  // 0.3% band

  const atTestedSupport    = supportTouches >= 2;
  const atTestedResistance = resistanceTouches >= 2;

  let effectiveSpikeDirection: 'down' | 'up' = girassolSystem.detectedDirection;
  let structuralOverrideAlert = '';

  if (atTestedSupport && effectiveSpikeDirection === 'down') {
    // Fundo Duplo/Triplo confirmado estruturalmente — forçar BUY
    effectiveSpikeDirection = 'up';
    structuralOverrideAlert = `🛡️ SUPORTE TESTADO ${supportTouches}× nos últimos candles — SELL bloqueado pelo contexto estrutural. Direção corrigida para BUY (spike de subida esperado).`;
    console.log(`[SpikeEngine] ${structuralOverrideAlert}`);
  } else if (atTestedResistance && effectiveSpikeDirection === 'up') {
    // Topo Duplo/Triplo confirmado estruturalmente — forçar SELL
    effectiveSpikeDirection = 'down';
    structuralOverrideAlert = `🧱 RESISTÊNCIA TESTADA ${resistanceTouches}× nos últimos candles — BUY bloqueado pelo contexto estrutural. Direção corrigida para SELL (spike de queda esperado).`;
    console.log(`[SpikeEngine] ${structuralOverrideAlert}`);
  }

  // Direção final determinada pelo padrão detectado (bidirecional) + correção estrutural
  const spikeDirection: 'down' | 'up' = effectiveSpikeDirection;

  // ── MÓDULO 2: Auto Fibonacci a partir dos pivôs ──
  const autoFib = calcAutoFib(candles, girassolSystem, currentPrice);

  // ── MÓDULO 3: IA Cooperativa (cérebro operacional) ──
  const aiBrain = runAIBrainAnalysis(candles, spikeDirection, imminencePercent, girassolSystem.totalGirassolScore);
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

  // ── Boost de Dupla Marcação Girassol ──
  // Quando ambos os pivôs têm marcadores Girassol confirmados, a reversão é de alta certeza
  if (girassolSystem.tripleBothMarked)          cooperativeScore *= 1.5;  // 3/3 grupos com dupla marcação — certeza máxima
  else if (girassolSystem.bothMarkedGroups >= 2) cooperativeScore *= 1.3;  // 2/3 grupos com dupla marcação — alta certeza
  else if (girassolSystem.bothMarkedGroups === 1) cooperativeScore *= 1.15; // 1 grupo marcado — certeza moderada

  const overallConfidence = Math.min(98, Math.round(cooperativeScore));

  // ════════════════════════════════════════════════════════════════════════════
  // REGRA CENTRAL: HIERARQUIA DE GATILHOS DO GIRASSOL
  //
  // O ÚNICO gatilho de entrada (e fechamento) é o APARECIMENTO do Girassol
  // ou das bolinhas no gráfico. A IA, o AutoFib e todos os outros
  // indicadores apenas CONFIRMAM a direção — nunca disparam por si sós.
  //
  // Mapeamento visual MT5 → grupos do engine:
  //   Girassol (flor)  = grupo 3 (macro) ativo OU confluência dupla/tri
  //   Bolinha média    = grupo 2 (meso) ativo SEM grupo 3
  //   Bolinha menor    = APENAS grupo 1 (micro) ativo — RARISSIMO
  //
  // Thresholds de confiança mínima por gatilho:
  //   girassol_flower = 55%  (padrão, entrada normal)
  //   bolinha_media   = 65%  (precisa mais confirmação)
  //   bolinha_menor   = 85%  (exige altíssima certeza + AutoFib obrigatório)
  //   none            = bloqueado — SEM OPERAÇÃO
  //
  // AutoFibonacci como validador complementar:
  //   Pivô Girassol coincide com nível Fib (<=0.6%) = confirmado
  //   Para bolinha_menor: AutoFib não confirmado = BLOQUEADO
  // ════════════════════════════════════════════════════════════════════════════

  const macroGroupActive = girassolSystem.groupResults.find(g => g.group === 3 && g.doublePatternDetected);
  const mesoGroupActive  = girassolSystem.groupResults.find(g => g.group === 2 && g.doublePatternDetected);
  const microGroupActive = girassolSystem.groupResults.find(g => g.group === 1 && g.doublePatternDetected);

  // Determinar tipo de gatilho pela hierarquia visual do indicador
  let girassolTriggerType: GirassolTriggerType;
  let confidenceThreshold: number;
  let imminenceThreshold: number;

  if (macroGroupActive || girassolSystem.dualConfluence || girassolSystem.triConfluence) {
    // Girassol (flor) apareceu — grupo macro ativo OU confluencia de grupos
    girassolTriggerType = 'girassol_flower';
    confidenceThreshold = 55;
    imminenceThreshold  = 30;
  } else if (mesoGroupActive) {
    // Bolinha media apareceu — meso ativo sem macro
    girassolTriggerType = 'bolinha_media';
    confidenceThreshold = 65;
    imminenceThreshold  = 40;
  } else if (microGroupActive) {
    // Bolinha menor apareceu — APENAS micro ativo, rarissimo, alta exigencia
    girassolTriggerType = 'bolinha_menor';
    confidenceThreshold = 85;
    imminenceThreshold  = 55;
  } else {
    // Nenhum gatilho Girassol visual — operacao bloqueada
    girassolTriggerType = 'none';
    confidenceThreshold = 999;
    imminenceThreshold  = 999;
  }

  // AutoFib valida o pivo do Girassol?
  // Verifica se o nivel Fib foi calculado a partir dos pivos do Girassol
  // e esta proximo do preco atual (zona de confluencia real)
  const autoFibValidatesGirassol = !!(
    autoFib.nearestLevel &&
    autoFib.nearestLevel.distancePct < 0.6 &&
    (autoFib.nearestLevel.significance === 'critical' || autoFib.nearestLevel.significance === 'major') &&
    autoFib.source === 'girassol_pivots'
  );

  // Para bolinha_menor: AutoFib e OBRIGATORIO para validar a entrada
  const bolinhasMenorBloqueada = girassolTriggerType === 'bolinha_menor' && !autoFibValidatesGirassol;

  const spikeExpected = girassolTriggerType !== 'none' &&
                        !bolinhasMenorBloqueada &&
                        imminencePercent >= imminenceThreshold &&
                        overallConfidence >= confidenceThreshold;

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

  // Alerta de correção estrutural (suporte/resistência testados)
  if (structuralOverrideAlert) {
    alerts.push(structuralOverrideAlert);
  }

  // Alerta principal do gatilho Girassol — PRIMEIRO e mais importante
  if (girassolTriggerType === 'none') {
    alerts.push(`🚫 SEM GATILHO GIRASSOL — Nenhum aparecimento do Girassol ou bolinha detectado. Operação bloqueada.`);
  } else if (girassolTriggerType === 'girassol_flower') {
    if (girassolSystem.triConfluence) {
      alerts.push(`🌻 GIRASSOL APARECEU — TRI-CONFLUÊNCIA: 3/3 grupos confirmam ${girassolSystem.dominantPattern === 'double_top' ? 'Duplo Topo' : 'Duplo Fundo'} — GATILHO MÁXIMO`);
    } else if (girassolSystem.dualConfluence) {
      alerts.push(`🌻 GIRASSOL APARECEU — Confluência dupla (macro + ${mesoGroupActive ? 'meso' : 'micro'}) — gatilho forte`);
    } else {
      alerts.push(`🌻 GIRASSOL APARECEU — Grupo macro detectou ${girassolSystem.dominantPattern === 'double_top' ? 'Duplo Topo' : 'Duplo Fundo'} — gatilho de entrada`);
    }
  } else if (girassolTriggerType === 'bolinha_media') {
    alerts.push(`🔵 BOLINHA MÉDIA APARECEU — Grupo meso ativo. Gatilho válido (confiança mínima ${confidenceThreshold}% exigida).`);
  } else if (girassolTriggerType === 'bolinha_menor') {
    if (bolinhasMenorBloqueada) {
      alerts.push(`🔴 BOLINHA MENOR APARECEU — MAS SEM validação AutoFib. Entrada BLOQUEADA (rarissimo sem Fib).`);
    } else {
      alerts.push(`🔴 BOLINHA MENOR APARECEU — AutoFib confirmado. Situação de altissima certeza (confiança ${overallConfidence}% >= ${confidenceThreshold}% exigido).`);
    }
  }

  // AutoFib como validador do Girassol
  if (autoFibValidatesGirassol) {
    alerts.push(`✅ AutoFib VALIDA o pivô Girassol — ${autoFib.nearestLevel!.label} a ${autoFib.nearestLevel!.distancePct.toFixed(2)}% (traçado dos pivôs) — confluência confirmada`);
  } else if (autoFib.nearestLevel && autoFib.significance !== 'none') {
    alerts.push(`📐 AutoFib ${autoFib.nearestLevel.label} a ${autoFib.nearestLevel.distancePct.toFixed(2)}% — ${autoFib.source === 'girassol_pivots' ? 'pivôs Girassol' : 'range de mercado'} — ×${autoFib.spikeMultiplier.toFixed(1)}`);
  }

  if (girassolSystem.tripleBothMarked) {
    alerts.push(`🌟 DUPLA MARCAÇÃO GIRASSOL TRIPLA — 3/3 grupos com marcadores nos 2 pivôs — REVERSÃO QUASE CERTA`);
  } else if (girassolSystem.bothMarkedGroups >= 2) {
    alerts.push(`⭐ DUPLA MARCAÇÃO GIRASSOL — ${girassolSystem.bothMarkedGroups}/3 grupos com marcadores nos 2 pivôs — reversão de alta certeza`);
  } else if (girassolSystem.bothMarkedGroups === 1) {
    const markedGroup = girassolSystem.groupResults.find(g => g.bothPivotsMarked);
    alerts.push(`🌻 Marcação dupla Girassol no grupo ${markedGroup?.groupLabel || ''} — reversão com suporte`);
  }

  if (girassolSystem.fibAlignedGroups > 0) {
    alerts.push(`✨ ${girassolSystem.fibAlignedGroups} grupo(s) Girassol alinhado(s) com AutoFib — força máxima`);
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
  // Fechamento de operação também exige gatilho Girassol/bolinha — mesma hierarquia
  let switchRecommendation: SwitchRecommendation | null = null;
  if (openPosition && preEntryWindow && overallConfidence >= 50 && girassolTriggerType !== 'none') {
    const exitDir: 'CLOSE_BUY' | 'CLOSE_SELL' = openPosition.type === 'BUY' ? 'CLOSE_BUY' : 'CLOSE_SELL';
    const spikeEntryDir: 'BUY' | 'SELL' = spikeDirection === 'down' ? 'SELL' : 'BUY';
    const isBadPosition = (openPosition.type === 'BUY' && spikeDirection === 'down') ||
                          (openPosition.type === 'SELL' && spikeDirection === 'up');
    const urgency = overallConfidence >= 80 ? 'critical' : overallConfidence >= 65 ? 'high' : 'warning';
    const secondsToAct = urgency === 'critical' ? 3 : urgency === 'high' ? 8 : 15;
    const triggerLabel =
      girassolTriggerType === 'girassol_flower' ? `Girassol apareceu (${girassolSystem.confluenceLabel}, ${girassolSystem.activeGroups}/3 grupos)` :
      girassolTriggerType === 'bolinha_media'   ? `Bolinha média apareceu (meso ativo)` :
      `Bolinha menor apareceu (micro + AutoFib confirmado)`;
    if (isBadPosition || urgency === 'critical') {
      switchRecommendation = {
        action: 'EXIT_CONTINUITY_ENTER_SPIKE', urgency, exitDirection: exitDir, spikeDirection: spikeEntryDir,
        confidence: overallConfidence,
        reasoning:
          `GATILHO: ${triggerLabel}. ` +
          (autoFibValidatesGirassol ? `AutoFib valida pivô Girassol (${autoFib.nearestLevel?.label}). ` : '') +
          `IA Score: ${aiBrain.overallAIScore}%. Iminência: ${imminencePercent}%. Confiança: ${overallConfidence}%.`,
        secondsToAct,
      };
    }
  }

  // ── Narrativa completa ──
  const triggerNarrative =
    girassolTriggerType === 'girassol_flower' ? `GATILHO: Girassol apareceu (${girassolSystem.confluenceLabel})` :
    girassolTriggerType === 'bolinha_media'   ? `GATILHO: Bolinha média (meso, confiança mín. ${confidenceThreshold}%)` :
    girassolTriggerType === 'bolinha_menor'   ? `GATILHO RARO: Bolinha menor (micro, ${bolinhasMenorBloqueada ? 'BLOQUEADO sem AutoFib' : 'AutoFib confirmado'})` :
    `SEM GATILHO — operação bloqueada`;

  const narrative =
    `${isCrash ? 'CRASH' : 'BOOM'} ${symbol} — ` +
    `${triggerNarrative} | ` +
    `${girassolSystem.description} | ` +
    (autoFibValidatesGirassol
      ? `AutoFib VALIDA pivô: ${autoFib.nearestLevel!.label} | `
      : autoFib.nearestLevel ? `AutoFib ${autoFib.nearestLevel.label} a ${autoFib.nearestLevel.distancePct.toFixed(2)}% | ` : '') +
    `IA: ${aiBrain.overallAIScore}% | ` +
    `Iminência: ${imminencePercent}% (${imminenceLabel}) | ` +
    `Confiança: ${overallConfidence}% (mín. ${confidenceThreshold}%). ` +
    (spikeExpected ? `SPIKE ${spikeDirection!.toUpperCase()} ESPERADO.` : 'Aguardando gatilho Girassol.');

  return {
    symbol, isSpikeIndex: true, spikeType, averageInterval: avgInterval,
    candlesSinceLastSpike, imminencePercent, imminenceLabel,
    girassolSystem,
    girassolTriggerType, entryConfidenceThreshold: confidenceThreshold, autoFibValidatesGirassol,
    autoFib,
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

  // ── REGRA: Fechamento também exige gatilho Girassol/bolinha ──
  // Sem aparecimento do Girassol ou bolinha no gráfico, a operação
  // não deve ser encerrada apenas por score de confiança da IA.
  // O mesmo gatilho visual que abre a operação deve sinalizá-la.
  //
  // Exceção: se o spike estiver na direção CONTRÁRIA à posição aberta
  // E o Girassol confirmou isso → sair imediatamente (abort).
  // Sem Girassol/bolinha → continuar (canContinue = true, apenas caution).
  const hasGirassolTrigger = spike.girassolTriggerType !== 'none';
  const spikeAgainstPosition =
    (positionType === 'BUY'  && spike.spikeDirection === 'down') ||
    (positionType === 'SELL' && spike.spikeDirection === 'up');

  let riskLevel: 'safe' | 'caution' | 'danger' | 'abort';
  if (!hasGirassolTrigger) {
    // Sem gatilho Girassol visual — IA sozinha não fecha operação
    riskLevel = spike.overallConfidence >= 70 ? 'caution' : 'safe';
  } else if (spike.girassolTriggerType === 'bolinha_menor') {
    // Bolinha menor: só abort em confiança muito alta E contra a posição
    riskLevel = (spike.overallConfidence >= 85 && spikeAgainstPosition) ? 'abort' :
                spike.overallConfidence >= 65 ? 'danger' : 'caution';
  } else if (spike.girassolTriggerType === 'bolinha_media') {
    // Bolinha média: hierarquia normal mas limiar mais alto
    riskLevel = (spike.overallConfidence >= 75 && spikeAgainstPosition) ? 'abort' :
                spike.overallConfidence >= 65 ? 'danger' :
                spike.overallConfidence >= 45 ? 'caution' : 'safe';
  } else {
    // Girassol (flor) apareceu: usar hierarquia completa de risco
    riskLevel = spike.overallConfidence >= 80 ? 'abort' :
                spike.overallConfidence >= 60 ? 'danger' :
                spike.overallConfidence >= 40 ? 'caution' : 'safe';
  }

  const exitNow = riskLevel === 'abort' || spike.switchRecommendation?.urgency === 'critical';
  const canContinue = riskLevel === 'safe' || riskLevel === 'caution';

  const triggerInfo = hasGirassolTrigger
    ? `Gatilho: ${spike.girassolTriggerType === 'girassol_flower' ? 'Girassol apareceu' : spike.girassolTriggerType === 'bolinha_media' ? 'Bolinha média' : 'Bolinha menor'}. `
    : `Sem gatilho Girassol visual (IA sozinha não fecha). `;

  const reasoning =
    riskLevel === 'abort'   ? `🚨 Sair imediatamente — ${triggerInfo}${spike.narrative}` :
    riskLevel === 'danger'  ? `⚠️ Alto risco — ${triggerInfo}${spike.narrative}` :
    riskLevel === 'caution' ? `⚡ Atenção — ${triggerInfo}${spike.narrative}` :
                              `✅ Continuar — ${triggerInfo}${spike.narrative}`;

  return { symbol, canContinue, direction: positionType, confidence: 100 - spike.overallConfidence, spikeRiskLevel: riskLevel, exitNow, reasoning };
}
