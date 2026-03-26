/**
 * SYNTHETIC GIRASSOL — Servidor-lado
 * ──────────────────────────────────────────────────────────────────────────────
 * Implementa detecção de pivôs ZigZag em 3 níveis (Macro, Meso, Micro)
 * para simular o comportamento do Girassol Sunflower quando o EA não envia
 * os buffers do indicador MT5 (EA versão antiga ou sem indicador instalado).
 *
 * Níveis:
 *  Nível 1 — Girassol Extremo  : ZigZag deviation ≥ 1.5% (grandes swings)
 *  Nível 2 — Bolinha Média Pivot: ZigZag deviation ≥ 0.4% (pivôs médios)
 *  Nível 3 — Bolinha Micro      : últimas 8 barras — mínimo/máximo local
 *
 * Saída: bias (BUY | SELL | NEUTRAL) + levelCount (0-3) + descrição
 */

export interface SyntheticGirassolResult {
  bias: 'BUY' | 'SELL' | 'NEUTRAL';
  levelCount: number;
  description: string;
  levels: {
    name: string;
    signal: 'BUY' | 'SELL' | 'NEUTRAL';
    price: number;
    bar: number;
  }[];
  adx: number;
  trendStrength: 'strong' | 'moderate' | 'weak';
  supertrend: 'BUY' | 'SELL' | 'NEUTRAL';
}

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  time?: number;
}

/**
 * Detecta pivôs ZigZag com desvio mínimo dado.
 * Retorna array de pivôs: { bar (0=mais recente), price, type: 'HIGH'|'LOW' }
 */
function detectZigZagPivots(
  candles: Candle[],
  deviationPct: number,
  lookbackBars: number = candles.length
): { bar: number; price: number; type: 'HIGH' | 'LOW' }[] {
  const bars = Math.min(candles.length, lookbackBars);
  if (bars < 5) return [];

  const pivots: { bar: number; price: number; type: 'HIGH' | 'LOW' }[] = [];
  let lastPivotPrice = candles[bars - 1].close;
  let lastPivotType: 'HIGH' | 'LOW' | null = null;
  let lastPivotBar = bars - 1;

  for (let i = bars - 1; i >= 0; i--) {
    const bar = candles[i];
    const deviation = Math.abs(bar.high - bar.low) / lastPivotPrice;

    if (lastPivotType === null) {
      if (bar.close > lastPivotPrice * (1 + deviationPct / 100)) {
        lastPivotType = 'HIGH';
        lastPivotPrice = bar.high;
        lastPivotBar = i;
        pivots.push({ bar: i, price: bar.high, type: 'HIGH' });
      } else if (bar.close < lastPivotPrice * (1 - deviationPct / 100)) {
        lastPivotType = 'LOW';
        lastPivotPrice = bar.low;
        lastPivotBar = i;
        pivots.push({ bar: i, price: bar.low, type: 'LOW' });
      }
      continue;
    }

    if (lastPivotType === 'HIGH') {
      if (bar.high > lastPivotPrice) {
        lastPivotPrice = bar.high;
        lastPivotBar = i;
        if (pivots.length > 0) {
          pivots[pivots.length - 1] = { bar: i, price: bar.high, type: 'HIGH' };
        }
      } else if (bar.close < lastPivotPrice * (1 - deviationPct / 100)) {
        lastPivotType = 'LOW';
        lastPivotPrice = bar.low;
        lastPivotBar = i;
        pivots.push({ bar: i, price: bar.low, type: 'LOW' });
      }
    } else {
      if (bar.low < lastPivotPrice) {
        lastPivotPrice = bar.low;
        lastPivotBar = i;
        if (pivots.length > 0) {
          pivots[pivots.length - 1] = { bar: i, price: bar.low, type: 'LOW' };
        }
      } else if (bar.close > lastPivotPrice * (1 + deviationPct / 100)) {
        lastPivotType = 'HIGH';
        lastPivotPrice = bar.high;
        lastPivotBar = i;
        pivots.push({ bar: i, price: bar.high, type: 'HIGH' });
      }
    }
  }

  // Converte de índice antigo → bar relativo ao candle mais recente (bar 0)
  return pivots
    .map(p => ({ ...p, bar: p.bar }))
    .sort((a, b) => a.bar - b.bar);
}

/**
 * Determina sinal de um nível baseado nos pivôs mais recentes
 */
function levelSignalFromPivots(
  pivots: { bar: number; price: number; type: 'HIGH' | 'LOW' }[],
  maxBar: number = 10
): { signal: 'BUY' | 'SELL' | 'NEUTRAL'; price: number; bar: number } {
  if (pivots.length === 0) return { signal: 'NEUTRAL', price: 0, bar: 99 };

  const recent = pivots.filter(p => p.bar <= maxBar);
  if (recent.length === 0) return { signal: 'NEUTRAL', price: 0, bar: 99 };

  const lastPivot = recent[recent.length - 1];
  if (lastPivot.type === 'LOW') {
    return { signal: 'BUY', price: lastPivot.price, bar: lastPivot.bar };
  }
  return { signal: 'SELL', price: lastPivot.price, bar: lastPivot.bar };
}

/**
 * Calcula ADX simplificado (14 barras)
 */
function calculateADX(candles: Candle[], period: number = 14): number {
  if (candles.length < period + 1) return 20;

  const trs: number[] = [];
  const dmPlus: number[] = [];
  const dmMinus: number[] = [];

  for (let i = 0; i < period + 1 && i < candles.length - 1; i++) {
    const cur = candles[i];
    const prev = candles[i + 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close)
    );
    trs.push(tr);
    dmPlus.push(cur.high - prev.high > prev.low - cur.low && cur.high - prev.high > 0 ? cur.high - prev.high : 0);
    dmMinus.push(prev.low - cur.low > cur.high - prev.high && prev.low - cur.low > 0 ? prev.low - cur.low : 0);
  }

  const atr = trs.reduce((a, b) => a + b, 0) / trs.length;
  if (atr === 0) return 20;

  const diPlus = (dmPlus.reduce((a, b) => a + b, 0) / dmPlus.length) / atr * 100;
  const diMinus = (dmMinus.reduce((a, b) => a + b, 0) / dmMinus.length) / atr * 100;
  const diSum = diPlus + diMinus;
  if (diSum === 0) return 20;

  const dx = Math.abs(diPlus - diMinus) / diSum * 100;
  return Math.min(dx * 1.5, 100);
}

/**
 * Calcula Supertrend simplificado (ATR × multiplier)
 */
function calculateSupertrend(
  candles: Candle[],
  period: number = 10,
  multiplier: number = 3
): 'BUY' | 'SELL' | 'NEUTRAL' {
  if (candles.length < period + 2) return 'NEUTRAL';

  const atrs: number[] = [];
  for (let i = 0; i < period && i < candles.length - 1; i++) {
    const cur = candles[i];
    const prev = candles[i + 1];
    const tr = Math.max(cur.high - cur.low, Math.abs(cur.high - prev.close), Math.abs(cur.low - prev.close));
    atrs.push(tr);
  }

  const atr = atrs.reduce((a, b) => a + b, 0) / atrs.length;

  const hlAvg = (candles[0].high + candles[0].low) / 2;
  const upperBand = hlAvg + multiplier * atr;
  const lowerBand = hlAvg - multiplier * atr;

  const close = candles[0].close;
  if (close > upperBand) return 'BUY';
  if (close < lowerBand) return 'SELL';
  return 'NEUTRAL';
}

/**
 * Analisa candles e retorna sinal sintético do Girassol em 3 níveis.
 * Substitui o Girassol MT5 quando não há dados do EA.
 */
export function computeSyntheticGirassol(rawCandles: any[]): SyntheticGirassolResult {
  if (!rawCandles || rawCandles.length < 10) {
    return {
      bias: 'NEUTRAL',
      levelCount: 0,
      description: 'Dados insuficientes para análise sintética',
      levels: [],
      adx: 0,
      trendStrength: 'weak',
      supertrend: 'NEUTRAL'
    };
  }

  const candles: Candle[] = rawCandles.slice(0, 200).map((c: any) => ({
    open: Number(c.open) || 0,
    high: Number(c.high) || 0,
    low: Number(c.low) || 0,
    close: Number(c.close) || 0,
    time: c.time
  })).filter(c => c.close > 0);

  if (candles.length < 10) {
    return {
      bias: 'NEUTRAL',
      levelCount: 0,
      description: 'Candles inválidos',
      levels: [],
      adx: 0,
      trendStrength: 'weak',
      supertrend: 'NEUTRAL'
    };
  }

  const currentPrice = candles[0].close;

  // ── Nível 1: Girassol Extremo (desvio ≥ 1.5%, lookback 100 barras) ──
  const pivots1 = detectZigZagPivots(candles, 1.5, 100);
  const level1 = levelSignalFromPivots(pivots1, 15);

  // ── Nível 2: Bolinha Média Pivot (desvio ≥ 0.4%, lookback 50 barras) ──
  const pivots2 = detectZigZagPivots(candles, 0.4, 50);
  const level2 = levelSignalFromPivots(pivots2, 8);

  // ── Nível 3: Bolinha Micro (últimas 8 barras — mínimo/máximo local) ──
  const micro = candles.slice(0, 8);
  const microHigh = Math.max(...micro.map(c => c.high));
  const microLow = Math.min(...micro.map(c => c.low));
  const microMid = (microHigh + microLow) / 2;
  let level3Signal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  let level3Price = currentPrice;

  if (currentPrice > microMid) {
    const highBar = micro.findIndex(c => c.high === microHigh);
    if (highBar <= 3 && candles[0].close > microMid) {
      level3Signal = candles[0].close < candles[1]?.close ? 'SELL' : 'NEUTRAL';
    } else {
      level3Signal = currentPrice < microHigh * 0.998 ? 'BUY' : 'NEUTRAL';
    }
    level3Price = microLow;
  } else {
    const lowBar = micro.findIndex(c => c.low === microLow);
    if (lowBar <= 3 && candles[0].close < microMid) {
      level3Signal = candles[0].close > candles[1]?.close ? 'BUY' : 'NEUTRAL';
    } else {
      level3Signal = currentPrice > microLow * 1.002 ? 'SELL' : 'NEUTRAL';
    }
    level3Price = microHigh;
  }

  // ── ADX e Supertrend ──
  const adx = calculateADX(candles);
  const supertrend = calculateSupertrend(candles);
  const trendStrength: 'strong' | 'moderate' | 'weak' =
    adx >= 40 ? 'strong' : adx >= 25 ? 'moderate' : 'weak';

  // ── Fusão dos 3 níveis (prioridade: L1 > L2 > L3) ──
  const levels = [
    { name: 'girassol_extremo',       signal: level1.signal, price: level1.price, bar: level1.bar },
    { name: 'bolinha_media_pivot',     signal: level2.signal, price: level2.price, bar: level2.bar },
    { name: 'bolinha_pequena_micro',   signal: level3Signal,  price: level3Price,  bar: 0 }
  ];

  const buyLevels  = levels.filter(l => l.signal === 'BUY');
  const sellLevels = levels.filter(l => l.signal === 'SELL');

  let bias: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  let levelCount = 0;
  let description = '';

  // Se ADX forte e supertrend confirma, aumenta a confiança
  const supertrendBoost = supertrend !== 'NEUTRAL' ? 0.5 : 0;

  const buyScore  = buyLevels.length + (supertrend === 'BUY' ? supertrendBoost : 0);
  const sellScore = sellLevels.length + (supertrend === 'SELL' ? supertrendBoost : 0);

  if (buyScore > sellScore && buyScore >= 1) {
    bias = 'BUY';
    levelCount = buyLevels.length;
    const strongest = buyLevels[0];
    description = `Sintético: COMPRA (${levelCount}/3 níveis) — ${strongest.name} @ ${strongest.price.toFixed(5)} | ADX=${adx.toFixed(1)} (${trendStrength}) | Supertrend=${supertrend}`;
  } else if (sellScore > buyScore && sellScore >= 1) {
    bias = 'SELL';
    levelCount = sellLevels.length;
    const strongest = sellLevels[0];
    description = `Sintético: VENDA (${levelCount}/3 níveis) — ${strongest.name} @ ${strongest.price.toFixed(5)} | ADX=${adx.toFixed(1)} (${trendStrength}) | Supertrend=${supertrend}`;
  } else {
    bias = 'NEUTRAL';
    levelCount = 0;
    description = `Sintético: NEUTRO — níveis em conflito (${buyLevels.length} BUY vs ${sellLevels.length} SELL) | ADX=${adx.toFixed(1)} (${trendStrength})`;
  }

  return { bias, levelCount, description, levels, adx, trendStrength, supertrend };
}
