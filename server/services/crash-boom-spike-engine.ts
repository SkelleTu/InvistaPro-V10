/**
 * CRASH/BOOM SPIKE ENGINE - INVESTAPRO
 * Motor dedicado para detecção antecipada de spikes nos índices Crash e Boom
 *
 * Estratégia:
 * 1. Opera CONTINUIDADE enquanto mercado está em tendência tranquila
 * 2. Detecta iminência de spike via Fibonacci + contagem de candles + momentum + compressão de volatilidade
 * 3. SAI da operação de continuidade segundos antes do spike
 * 4. ENTRA imediatamente na operação de spike (direção do spike)
 * 5. Sai do spike assim que o movimento violento termina
 *
 * Bases de detecção:
 * - [PRIMÁRIO] Padrão Girassol Duplo Topo/Fundo: dois pivôs consecutivos no mesmo nível → spike confirmado
 * - Fibonacci multi-layer: preço em zona 0.0/0.236/0.618/0.786/1.0 = maior probabilidade
 * - Contagem de candles desde último spike vs intervalo médio do índice
 * - Momentum pré-spike: Crash sobe levemente antes de cair; Boom cai levemente antes de subir
 * - Compressão de volatilidade: velas muito pequenas por vários candles = tensão acumulada
 * - Confluência Fibonacci: quando micro + meso + macro convergem na mesma zona
 */

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

/** Resultado da detecção do padrão Girassol (pivô duplo) */
export interface GirassolPatternResult {
  detected: boolean;
  patternType: 'double_top' | 'double_bottom' | null;
  firstPivotPrice: number;
  secondPivotPrice: number;
  firstPivotIdx: number;
  secondPivotIdx: number;
  priceDivergencePct: number;
  candlesBetween: number;
  confirmationScore: number;
  fibAlignment: boolean;
  description: string;
}

export interface SpikeDetectionResult {
  symbol: string;
  isSpikeIndex: boolean;
  spikeType: 'crash' | 'boom' | null;
  averageInterval: number;

  candlesSinceLastSpike: number;
  imminencePercent: number;
  imminenceLabel: 'baixa' | 'moderada' | 'alta' | 'crítica';

  fibZoneScore: FibZoneScore | null;
  nearestFibLevels: FibLevel[];
  fibConfluence: number;
  fibSpikeMultiplier: number;

  momentumConfirms: boolean;
  momentumValue: number;
  volatilityCompressed: boolean;
  compressionScore: number;

  girassolPattern: GirassolPatternResult;

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
  '0.0%':    2.5,
  '23.6%':   1.6,
  '38.2%':   1.4,
  '50.0%':   1.8,
  '61.8%':   2.0,
  '78.6%':   1.7,
  '100.0%':  2.5,
  '127.2%':  1.3,
  '161.8%':  1.5,
};

const AVG_INTERVALS: Record<string, number> = {
  '1000': 100,
  '500':  50,
  '300':  30,
  '200':  20,
};

function getAvgInterval(symbol: string): number {
  for (const [key, val] of Object.entries(AVG_INTERVALS)) {
    if (symbol.includes(key)) return val;
  }
  return 75;
}

function calcFibLevels(high: number, low: number, layer: 'macro' | 'meso' | 'micro', currentPrice: number): FibLevel[] {
  const range = high - low;
  if (range <= 0) return [];
  return FIB_RATIOS.map(ratio => {
    const price = low + range * (1 - ratio);
    const distancePct = Math.abs(currentPrice - price) / currentPrice * 100;
    const label = `${(ratio * 100).toFixed(1)}%`;
    return {
      label,
      price,
      pct: ratio,
      distancePct,
      layer,
      significance: FIB_SIGNIFICANCE[ratio] || 'minor',
    };
  }).filter(l => l.distancePct < 3.0);
}

function calcVolatilityCompression(candles: any[]): { compressed: boolean; score: number } {
  if (candles.length < 10) return { compressed: false, score: 0 };
  const recent = candles.slice(-10);
  const ranges = recent.map((c: any) => (c.high || c.close * 1.001) - (c.low || c.close * 0.999));
  const avgRecent = ranges.reduce((a: number, b: number) => a + b, 0) / ranges.length;
  const all = candles.slice(-50);
  const allRanges = all.map((c: any) => (c.high || c.close * 1.001) - (c.low || c.close * 0.999));
  const avgAll = allRanges.reduce((a: number, b: number) => a + b, 0) / allRanges.length;
  const ratio = avgAll > 0 ? avgRecent / avgAll : 1;
  const score = Math.round(Math.max(0, (1 - ratio) * 100));
  return { compressed: ratio < 0.6, score };
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

/**
 * ESTRATÉGIA GIRASSOL — Detecção de Duplo Topo e Duplo Fundo
 *
 * O indicador Girassol (Sunflower) marca pivôs de reversão nos gráficos.
 * Quando dois pivôs consecutivos formam um duplo topo (Crash) ou duplo fundo (Boom)
 * em níveis próximos, isso é um sinal primário de spike iminente.
 *
 * Lógica:
 * - Duplo topo (Crash): dois topos locais com preços próximos (<= 0.8% de distância)
 *   → price rejeitado duas vezes no mesmo nível → spike de venda (crash)
 * - Duplo fundo (Boom): dois fundos locais com preços próximos (<= 0.8% de distância)
 *   → price sustentado duas vezes no mesmo nível → spike de compra (boom)
 *
 * Confluência com Fibonacci aumenta drasticamente o score (pivô em nível fib = sinal crítico)
 */
function detectGirassolPattern(
  candles: any[],
  spikeType: 'crash' | 'boom',
  fibLevels: FibLevel[]
): GirassolPatternResult {
  const empty: GirassolPatternResult = {
    detected: false, patternType: null,
    firstPivotPrice: 0, secondPivotPrice: 0,
    firstPivotIdx: -1, secondPivotIdx: -1,
    priceDivergencePct: 0, candlesBetween: 0,
    confirmationScore: 0, fibAlignment: false,
    description: 'Nenhum padrão Girassol detectado.',
  };

  if (candles.length < 15) return empty;

  const lookback = Math.min(80, candles.length - 1);
  const window = candles.slice(-lookback);
  const pivotWindow = 3;

  if (spikeType === 'crash') {
    // Detectar duplo topo (dois topos próximos → crash iminente)
    const tops: Array<{ idx: number; price: number }> = [];

    for (let i = pivotWindow; i < window.length - pivotWindow; i++) {
      const high = window[i].high || window[i].close * 1.001;
      let isTop = true;
      for (let j = i - pivotWindow; j <= i + pivotWindow; j++) {
        if (j === i) continue;
        const h = window[j].high || window[j].close * 1.001;
        if (h >= high) { isTop = false; break; }
      }
      if (isTop) tops.push({ idx: i, price: high });
    }

    // Buscar os dois topos mais recentes
    if (tops.length >= 2) {
      const t1 = tops[tops.length - 2];
      const t2 = tops[tops.length - 1];
      const divergencePct = Math.abs(t1.price - t2.price) / t1.price * 100;
      const candlesBetween = t2.idx - t1.idx;

      // Critérios: preços dentro de 0.8%, entre 3 e 30 candles de distância
      if (divergencePct <= 0.8 && candlesBetween >= 3 && candlesBetween <= 35) {
        const avgTopPrice = (t1.price + t2.price) / 2;
        const fibAlignment = fibLevels.some(f => Math.abs(f.price - avgTopPrice) / avgTopPrice * 100 < 0.5);

        let confirmationScore = 70;
        if (divergencePct <= 0.3) confirmationScore += 15;
        if (candlesBetween <= 10) confirmationScore += 10;
        if (fibAlignment) confirmationScore += 20;
        confirmationScore = Math.min(100, confirmationScore);

        return {
          detected: true,
          patternType: 'double_top',
          firstPivotPrice: t1.price,
          secondPivotPrice: t2.price,
          firstPivotIdx: t1.idx,
          secondPivotIdx: t2.idx,
          priceDivergencePct: Math.round(divergencePct * 100) / 100,
          candlesBetween,
          confirmationScore,
          fibAlignment,
          description:
            `🌻 GIRASSOL DUPLO TOPO detectado — ` +
            `Topo 1: ${t1.price.toFixed(4)} | Topo 2: ${t2.price.toFixed(4)} | ` +
            `Divergência: ${divergencePct.toFixed(2)}% | ${candlesBetween} candles entre pivôs` +
            (fibAlignment ? ' | ✨ CONFLUÊNCIA FIBONACCI' : ''),
        };
      }
    }
  } else {
    // Detectar duplo fundo (dois fundos próximos → boom iminente)
    const bottoms: Array<{ idx: number; price: number }> = [];

    for (let i = pivotWindow; i < window.length - pivotWindow; i++) {
      const low = window[i].low || window[i].close * 0.999;
      let isBottom = true;
      for (let j = i - pivotWindow; j <= i + pivotWindow; j++) {
        if (j === i) continue;
        const l = window[j].low || window[j].close * 0.999;
        if (l <= low) { isBottom = false; break; }
      }
      if (isBottom) bottoms.push({ idx: i, price: low });
    }

    if (bottoms.length >= 2) {
      const b1 = bottoms[bottoms.length - 2];
      const b2 = bottoms[bottoms.length - 1];
      const divergencePct = Math.abs(b1.price - b2.price) / b1.price * 100;
      const candlesBetween = b2.idx - b1.idx;

      if (divergencePct <= 0.8 && candlesBetween >= 3 && candlesBetween <= 35) {
        const avgBottomPrice = (b1.price + b2.price) / 2;
        const fibAlignment = fibLevels.some(f => Math.abs(f.price - avgBottomPrice) / avgBottomPrice * 100 < 0.5);

        let confirmationScore = 70;
        if (divergencePct <= 0.3) confirmationScore += 15;
        if (candlesBetween <= 10) confirmationScore += 10;
        if (fibAlignment) confirmationScore += 20;
        confirmationScore = Math.min(100, confirmationScore);

        return {
          detected: true,
          patternType: 'double_bottom',
          firstPivotPrice: b1.price,
          secondPivotPrice: b2.price,
          firstPivotIdx: b1.idx,
          secondPivotIdx: b2.idx,
          priceDivergencePct: Math.round(divergencePct * 100) / 100,
          candlesBetween,
          confirmationScore,
          fibAlignment,
          description:
            `🌻 GIRASSOL DUPLO FUNDO detectado — ` +
            `Fundo 1: ${b1.price.toFixed(4)} | Fundo 2: ${b2.price.toFixed(4)} | ` +
            `Divergência: ${divergencePct.toFixed(2)}% | ${candlesBetween} candles entre pivôs` +
            (fibAlignment ? ' | ✨ CONFLUÊNCIA FIBONACCI' : ''),
        };
      }
    }
  }

  return empty;
}

export function analyzeCrashBoomSpike(
  symbol: string,
  candles: any[],
  openPosition?: { type: 'BUY' | 'SELL'; profit: number } | null
): SpikeDetectionResult {
  const sym = symbol.toUpperCase();
  const isCrash = sym.includes('CRASH');
  const isBoom = sym.includes('BOOM');
  const isSpikeIndex = isCrash || isBoom;

  const emptyGirassol: GirassolPatternResult = {
    detected: false, patternType: null,
    firstPivotPrice: 0, secondPivotPrice: 0,
    firstPivotIdx: -1, secondPivotIdx: -1,
    priceDivergencePct: 0, candlesBetween: 0,
    confirmationScore: 0, fibAlignment: false,
    description: 'Nenhum padrão Girassol detectado.',
  };

  const empty: SpikeDetectionResult = {
    symbol, isSpikeIndex: false, spikeType: null, averageInterval: 0,
    candlesSinceLastSpike: 0, imminencePercent: 0, imminenceLabel: 'baixa',
    fibZoneScore: null, nearestFibLevels: [], fibConfluence: 0, fibSpikeMultiplier: 1.0,
    momentumConfirms: false, momentumValue: 0, volatilityCompressed: false, compressionScore: 0,
    girassolPattern: emptyGirassol,
    overallConfidence: 0, spikeExpected: false, spikeDirection: null,
    preEntryWindow: false, entryTimingScore: 0, ticksUntilEstimate: 0,
    switchRecommendation: null, narrative: 'Símbolo não é Crash/Boom.', alerts: [],
  };

  if (!isSpikeIndex || candles.length < 20) return empty;

  const spikeDirection = isCrash ? 'down' : 'up';
  const spikeType = isCrash ? 'crash' : 'boom';
  const avgInterval = getAvgInterval(sym);
  const currentPrice = candles[candles.length - 1].close;

  const { idx: lastSpikeIdx } = findLastSpike(candles);
  const candlesSinceLastSpike = lastSpikeIdx >= 0 ? candles.length - 1 - lastSpikeIdx : candles.length;
  const imminencePercent = Math.min(100, Math.round((candlesSinceLastSpike / avgInterval) * 100));

  const highs = candles.map((c: any) => c.high || c.close * 1.001);
  const lows  = candles.map((c: any) => c.low  || c.close * 0.999);
  const closes = candles.map((c: any) => c.close);

  const macroHigh = Math.max(...highs.slice(-100));
  const macroLow  = Math.min(...lows.slice(-100));
  const mesoHigh  = Math.max(...highs.slice(-30));
  const mesoLow   = Math.min(...lows.slice(-30));
  const microHigh = Math.max(...highs.slice(-10));
  const microLow  = Math.min(...lows.slice(-10));

  const macroLevels = calcFibLevels(macroHigh, macroLow, 'macro', currentPrice);
  const mesoLevels  = calcFibLevels(mesoHigh, mesoLow, 'meso', currentPrice);
  const microLevels = calcFibLevels(microHigh, microLow, 'micro', currentPrice);

  const allFibLevels = [...macroLevels, ...mesoLevels, ...microLevels]
    .sort((a, b) => a.distancePct - b.distancePct)
    .slice(0, 8);

  let fibConfluence = 0;
  let bestFibZone: FibZoneScore | null = null;
  let fibSpikeMultiplier = 1.0;

  if (allFibLevels.length > 0) {
    const nearest = allFibLevels[0];
    const multiplier = SPIKE_FIB_MULTIPLIERS[nearest.label] || 1.2;

    const sigWeight = nearest.significance === 'critical' ? 3 : nearest.significance === 'major' ? 2 : 1;
    const distScore = Math.max(0, 1 - nearest.distancePct / 3);
    const layerCount = new Set(allFibLevels.slice(0, 3).map(l => l.layer)).size;

    fibConfluence = Math.round(distScore * sigWeight * 20 * (0.7 + layerCount * 0.15));
    fibSpikeMultiplier = multiplier * (0.8 + layerCount * 0.1);

    bestFibZone = {
      level: nearest.label,
      layer: nearest.layer,
      distancePct: nearest.distancePct,
      significance: nearest.significance,
      spikeMultiplier: multiplier,
    };
  }

  // ── GIRASSOL: detecção de duplo topo/fundo ──────────────────────────────
  const girassolPattern = detectGirassolPattern(candles, spikeType, allFibLevels);

  const recentCloses = closes.slice(-6);
  const momentumValue = recentCloses.length > 1
    ? (recentCloses[recentCloses.length - 1] - recentCloses[0]) / recentCloses[0] * 100
    : 0;
  const momentumConfirms = (isCrash && momentumValue > 0.008) || (isBoom && momentumValue < -0.008);

  const { compressed: volatilityCompressed, score: compressionScore } = calcVolatilityCompression(candles);

  // ── CÁLCULO DE CONFIANÇA com peso primário do padrão Girassol ──────────
  let baseConfidence = imminencePercent * 0.5;
  if (momentumConfirms) baseConfidence *= 1.35;
  if (volatilityCompressed) baseConfidence *= (1 + compressionScore / 200);
  baseConfidence *= Math.min(2.0, fibSpikeMultiplier);
  if (bestFibZone?.significance === 'critical') baseConfidence *= 1.2;
  if (bestFibZone?.significance === 'major')    baseConfidence *= 1.1;

  // Girassol duplo pivô: boost fortíssimo (estratégia primária)
  if (girassolPattern.detected) {
    const girassolBoost = girassolPattern.confirmationScore / 100;
    baseConfidence = baseConfidence * (1 + girassolBoost * 1.8);
    // Se Girassol + Fibonacci juntos: sinal CRÍTICO
    if (girassolPattern.fibAlignment) {
      baseConfidence *= 1.35;
    }
  }

  const overallConfidence = Math.min(98, Math.round(baseConfidence));

  // Spike esperado: Girassol detectado reduz threshold de iminência necessário
  const imminenceThreshold = girassolPattern.detected ? 30 : 60;
  const confidenceThreshold = girassolPattern.detected ? 35 : 45;
  const spikeExpected = imminencePercent >= imminenceThreshold && overallConfidence >= confidenceThreshold;

  const timingBase = Math.max(0, imminencePercent - 50) * 2;
  const timingBoost = momentumConfirms ? 25 : 0;
  const compressionBoost = volatilityCompressed ? compressionScore * 0.3 : 0;
  const girassolTimingBoost = girassolPattern.detected ? girassolPattern.confirmationScore * 0.4 : 0;
  const entryTimingScore = Math.min(100, Math.round(timingBase + timingBoost + compressionBoost + girassolTimingBoost));
  const preEntryWindow = entryTimingScore >= 55 && spikeExpected;

  const remainingFraction = Math.max(0, 1 - candlesSinceLastSpike / avgInterval);
  const ticksUntilEstimate = Math.round(remainingFraction * avgInterval * 10);

  let imminenceLabel: SpikeDetectionResult['imminenceLabel'] = 'baixa';
  if (imminencePercent >= 90)      imminenceLabel = 'crítica';
  else if (imminencePercent >= 70) imminenceLabel = 'alta';
  else if (imminencePercent >= 45) imminenceLabel = 'moderada';

  const alerts: string[] = [];

  // Girassol sempre aparece primeiro (estratégia primária)
  if (girassolPattern.detected) {
    const patternLabel = girassolPattern.patternType === 'double_top' ? 'DUPLO TOPO' : 'DUPLO FUNDO';
    const urgencyIcon = girassolPattern.confirmationScore >= 90 ? '🚨' : '🌻';
    alerts.push(
      `${urgencyIcon} PADRÃO GIRASSOL — ${patternLabel} confirmado! ` +
      `Score: ${girassolPattern.confirmationScore}/100 | ` +
      `Divergência entre pivôs: ${girassolPattern.priceDivergencePct}%` +
      (girassolPattern.fibAlignment ? ' | ✨ ALINHADO COM FIBONACCI' : '')
    );
  }

  if (imminencePercent >= 90) alerts.push(`⚡ SPIKE IMINENTE — ${candlesSinceLastSpike} candles desde o último (média: ${avgInterval})`);
  if (volatilityCompressed && compressionScore >= 50) alerts.push(`🗜️ Volatilidade comprimida ${compressionScore}% — tensão acumulada`);
  if (momentumConfirms) alerts.push(`📈 Momentum ${isCrash ? 'alta' : 'queda'} confirmando pré-spike`);
  if (bestFibZone) alerts.push(`📐 Fibonacci ${bestFibZone.level} (${bestFibZone.layer}) a ${bestFibZone.distancePct.toFixed(2)}% — multiplicador ${bestFibZone.spikeMultiplier.toFixed(1)}x`);
  if (preEntryWindow) alerts.push(`🎯 JANELA DE ENTRADA PRÉ-SPIKE ATIVA — Score ${entryTimingScore}/100`);

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
        action: 'EXIT_CONTINUITY_ENTER_SPIKE',
        urgency,
        exitDirection: exitDir,
        spikeDirection: spikeEntryDir,
        confidence: overallConfidence,
        reasoning:
          `Fechar ${openPosition.type} de continuidade e abrir ${spikeEntryDir} para capturar spike ` +
          `${isCrash ? '↓ CRASH' : '↑ BOOM'}. ` +
          (girassolPattern.detected
            ? `Gatilho: Girassol ${girassolPattern.patternType === 'double_top' ? 'Duplo Topo' : 'Duplo Fundo'} (score ${girassolPattern.confirmationScore}%). `
            : '') +
          `Iminência: ${imminencePercent}%, Confiança: ${overallConfidence}%. ` +
          (bestFibZone ? `Zona Fibonacci ${bestFibZone.level} (${bestFibZone.significance}).` : ''),
        secondsToAct,
      };
    }
  }

  const girassolDesc = girassolPattern.detected
    ? `🌻 Girassol ${girassolPattern.patternType === 'double_top' ? 'Duplo Topo' : 'Duplo Fundo'} confirmado (score ${girassolPattern.confirmationScore}/100${girassolPattern.fibAlignment ? ', alinhado Fibonacci' : ''}). `
    : '';
  const fibDesc = bestFibZone
    ? `Preço próximo a Fib ${bestFibZone.level} (${bestFibZone.layer}, ${bestFibZone.significance}) — multiplicador ${bestFibZone.spikeMultiplier.toFixed(1)}x. `
    : '';
  const comprDesc = volatilityCompressed ? `Volatilidade comprimida (${compressionScore}% abaixo da média). ` : '';
  const momDesc = momentumConfirms
    ? `Momentum ${isCrash ? 'positivo' : 'negativo'} confirmando tensão pré-spike. `
    : '';

  const narrative =
    `${isCrash ? '🔴 CRASH' : '🟢 BOOM'} ${symbol} — ` +
    `${candlesSinceLastSpike} candles desde último spike (média: ${avgInterval}). ` +
    `Iminência: ${imminencePercent}% (${imminenceLabel}). ` +
    girassolDesc + fibDesc + comprDesc + momDesc +
    `Confiança total: ${overallConfidence}%. ` +
    (spikeExpected ? `⚡ SPIKE ${spikeDirection?.toUpperCase()} ESPERADO.` : 'Spike não iminente ainda.');

  return {
    symbol,
    isSpikeIndex: true,
    spikeType,
    averageInterval: avgInterval,
    candlesSinceLastSpike,
    imminencePercent,
    imminenceLabel,
    fibZoneScore: bestFibZone,
    nearestFibLevels: allFibLevels.slice(0, 5),
    fibConfluence,
    fibSpikeMultiplier,
    momentumConfirms,
    momentumValue: Math.round(momentumValue * 10000) / 10000,
    volatilityCompressed,
    compressionScore,
    girassolPattern,
    overallConfidence,
    spikeExpected,
    spikeDirection: spikeDirection as 'down' | 'up',
    preEntryWindow,
    entryTimingScore,
    ticksUntilEstimate,
    switchRecommendation,
    narrative,
    alerts,
  };
}

export function analyzeContinuitySafety(
  symbol: string,
  candles: any[],
  positionType: 'BUY' | 'SELL'
): ContinuityAnalysis {
  const spike = analyzeCrashBoomSpike(symbol, candles);

  if (!spike.isSpikeIndex) {
    return {
      symbol, canContinue: true, direction: positionType,
      confidence: 70, spikeRiskLevel: 'safe', exitNow: false,
      reasoning: 'Símbolo não é Crash/Boom — continuidade normal sem risco de spike.',
    };
  }

  const riskLevel =
    spike.overallConfidence >= 80 ? 'abort' :
    spike.overallConfidence >= 60 ? 'danger' :
    spike.overallConfidence >= 40 ? 'caution' : 'safe';

  const exitNow = riskLevel === 'abort' || spike.switchRecommendation?.urgency === 'critical';
  const canContinue = riskLevel === 'safe' || riskLevel === 'caution';

  const reasoning =
    riskLevel === 'abort'   ? `🚨 Sair imediatamente — spike ${spike.spikeDirection?.toUpperCase()} com ${spike.overallConfidence}% de confiança. ${spike.narrative}` :
    riskLevel === 'danger'  ? `⚠️ Alto risco de spike — monitorar de perto. ${spike.narrative}` :
    riskLevel === 'caution' ? `⚡ Atenção — iminência moderada. Continuar com stop apertado. ${spike.narrative}` :
                              `✅ Continuar — spike não iminente. ${spike.narrative}`;

  return {
    symbol, canContinue, direction: positionType,
    confidence: 100 - spike.overallConfidence,
    spikeRiskLevel: riskLevel,
    exitNow,
    reasoning,
  };
}
