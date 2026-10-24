/**
 * Deterministic Price Action gate implementing the written strategy as the normative rule set.
 * AI confidence/consensus is diagnostic and cannot add entry criteria or override risk controls.
 */
export type TradeSide = 'BUY' | 'SELL';
export type Timeframe = 'H4' | 'H1' | 'M15' | 'M5' | 'M1';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export interface MarketContext {
  spread?: number;
  maxSpread?: number;
  estimatedRoundTripCost?: number;
  highImpactNewsBlocked?: boolean;
  riskLimitOk?: boolean;
  tradingSessionOpen?: boolean;
}
export interface PriceActionZone {
  type: 'support' | 'resistance' | 'fvg' | 'order_block' | 'liquidity';
  low: number;
  high: number;
  timeframe: Timeframe;
  originTime: number;
  identifiedAt: number;
  reactions: number;
  invalidationPrice: number;
  state: 'valid' | 'mitigated' | 'invalidated';
  direction?: TradeSide;
}

export interface PriceActionSetup {
  action: TradeSide | 'HOLD';
  approved: boolean;
  reasons: string[];
  checks: Record<string, boolean>;
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  riskReward?: number;
  features: Record<string, number | string | boolean | null>;
  zones?: PriceActionZone[];
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const validCandles = (v: unknown): v is Candle[] => Array.isArray(v) && v.length >= 30 &&
  v.every((c, i) => c && finite(c.time) && finite(c.open) && finite(c.high) && finite(c.low) &&
    finite(c.close) && finite(c.volume) && c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close) && c.high >= c.low && c.volume >= 0 &&
    (i === 0 || c.time > v[i - 1].time));

const TIMEFRAME_SECONDS: Record<Timeframe, number> = {
  H4: 4 * 60 * 60,
  H1: 60 * 60,
  M15: 15 * 60,
  M5: 5 * 60,
  M1: 60,
};

/** Reject unfinished, future-dated, or stale latest bars; Candle.time is MT5 Unix seconds (or epoch ms). */
function validClosedCandles(v: unknown, timeframe: Timeframe, now = Date.now()): v is Candle[] {
  if (!validCandles(v)) return false;
  const last = v[v.length - 1];
  const lastOpenMs = last.time > 10_000_000_000 ? last.time : last.time * 1000;
  const expectedCloseMs = lastOpenMs + TIMEFRAME_SECONDS[timeframe] * 1000;
  return expectedCloseMs <= now && now - expectedCloseMs <= TIMEFRAME_SECONDS[timeframe] * 1000;
}

type MarketTrend = 'bullish' | 'bearish' | 'range' | 'unknown';
type PivotKind = 'high' | 'low';
interface Pivot { index: number; price: number }
interface PriceZone extends PriceActionZone { originIndex: number }

/** A pivot becomes usable only after two candles have closed to its right. */
function pivots(c: Candle[], kind: PivotKind, wing = 2): Pivot[] {
  const result: Pivot[] = [];
  for (let i = wing; i < c.length - wing; i++) {
    const price = kind === 'high' ? c[i].high : c[i].low;
    let isPivot = true;
    for (let j = i - wing; j <= i + wing; j++) {
      if (j === i) continue;
      const compared = kind === 'high' ? c[j].high : c[j].low;
      if (kind === 'high' ? compared >= price : compared <= price) { isPivot = false; break; }
    }
    if (isPivot) result.push({ index: i, price });
  }
  return result;
}

/** Trend requires confirmed HH/HL or LH/LL. "Unknown" is not silently treated as a range. */
function trend(c: Candle[]): MarketTrend {
  const sample = c.slice(-60);
  const highs = pivots(sample, 'high');
  const lows = pivots(sample, 'low');
  if (highs.length < 2 || lows.length < 2) return 'unknown';
  const [oldHigh, lastHigh] = highs.slice(-2);
  const [oldLow, lastLow] = lows.slice(-2);
  if (lastHigh.price > oldHigh.price && lastLow.price > oldLow.price) return 'bullish';
  if (lastHigh.price < oldHigh.price && lastLow.price < oldLow.price) return 'bearish';

  // A range requires repeated highs AND lows within a volatility-scaled tolerance.
  const tolerance = Math.max(averageRange(sample) * 0.75, Math.abs(sample[sample.length - 1].close) * 0.0005);
  const stableHighs = Math.abs(lastHigh.price - oldHigh.price) <= tolerance;
  const stableLows = Math.abs(lastLow.price - oldLow.price) <= tolerance;
  if (stableHighs && stableLows) return 'range';
  return 'unknown';
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function averageRange(c: Candle[]): number {
  return average(c.slice(-21, -1).map(x => x.high - x.low));
}

/** Group repeated confirmed pivots into auditable support/resistance zones. */
function repeatedStructureZone(c: Candle[], kind: PivotKind, price: number, timeframe: Timeframe): PriceZone | null {
  const tolerance = Math.max(averageRange(c) * 0.25, Math.abs(price) * 0.00005);
  const pivotPoints = pivots(c.slice(0, -1), kind);
  const clusters: Pivot[][] = [];
  for (const point of pivotPoints) {
    const cluster = clusters.find(items => Math.abs(average(items.map(item => item.price)) - point.price) <= tolerance);
    if (cluster) cluster.push(point); else clusters.push([point]);
  }
  const valid: PriceZone[] = clusters.filter(items => items.length >= 2).map(items => {
    const low = Math.min(...items.map(item => item.price)) - tolerance;
    const high = Math.max(...items.map(item => item.price)) + tolerance;
    const originIndex = Math.min(...items.map(item => item.index));
    const latestTouchIndex = Math.max(...items.map(item => item.index));
    const invalidated = c.slice(latestTouchIndex + 1).some(candle =>
      kind === 'low' ? candle.close < low : candle.close > high);
    return {
      type: kind === 'low' ? 'support' : 'resistance',
      low, high, timeframe,
      originIndex,
      originTime: c[originIndex].time,
      identifiedAt: c[latestTouchIndex].time,
      reactions: items.length,
      invalidationPrice: kind === 'low' ? low : high,
      state: invalidated ? 'invalidated' : 'valid',
    };
  });
  const near = valid.filter(zone => zone.state === 'valid' &&
    price >= zone.low - tolerance && price <= zone.high + tolerance);
  return near.sort((a, b) =>
    Math.abs(price - (a.low + a.high) / 2) - Math.abs(price - (b.low + b.high) / 2))[0] ?? null;
}

/** Detect a three-candle FVG with a meaningful impulse; reject it if later closed candles invalidate it. */
function fairValueGapZone(c: Candle[], side: TradeSide, price: number, timeframe: Timeframe): PriceZone | null {
  const sample = c.slice(-40);
  const offset = c.length - sample.length;
  const impulseFloor = averageRange(sample) * 0.5;
  const tolerance = Math.max(averageRange(sample) * 0.2, Math.abs(price) * 0.00005);
  for (let i = sample.length - 1; i >= 2; i--) {
    const first = sample[i - 2], middle = sample[i - 1], third = sample[i];
    if (Math.abs(middle.close - middle.open) < impulseFloor) continue;
    const low = side === 'BUY' ? first.high : third.high;
    const high = side === 'BUY' ? third.low : first.low;
    const isGap = side === 'BUY' ? third.low > first.high : third.high < first.low;
    if (!isGap || high <= low) continue;

    let invalidated = false;
    let reactions = 0;
    for (let k = i + 1; k < sample.length; k++) {
      if ((side === 'BUY' && sample[k].close < low) || (side === 'SELL' && sample[k].close > high)) {
        invalidated = true;
        break;
      }
      if (sample[k].low <= high && sample[k].high >= low) reactions++;
    }
    if (invalidated) continue;
    if (price >= low - tolerance && price <= high + tolerance) {
      return {
        type: 'fvg', low, high, timeframe, direction: side,
        originIndex: offset + i - 2,
        originTime: third.time,
        identifiedAt: third.time,
        reactions,
        invalidationPrice: side === 'BUY' ? low : high,
        state: 'valid',
      };
    }
  }
  return null;
}

/** Find the nearest confirmed pivot beyond entry across H4, H1 and M15. */
function nearestBarrierDistance(frames: Candle[][], side: TradeSide, entry: number): number | null {
  const levels = frames.flatMap(frame => pivots(frame, side === 'BUY' ? 'high' : 'low').map(p => p.price));
  const beyond = levels.filter(level => side === 'BUY' ? level > entry : level < entry);
  if (!beyond.length) return null;
  const barrier = side === 'BUY' ? Math.min(...beyond) : Math.max(...beyond);
  return Math.abs(barrier - entry);
}
function trigger(c: Candle[]): TradeSide | null {
  if (c.length < 3) return null;
  const prior = c[c.length - 3];
  const pattern = c[c.length - 2];
  const confirmation = c[c.length - 1];
  const body = Math.abs(pattern.close - pattern.open);
  const range = Math.max(pattern.high - pattern.low, 1e-12);
  const lowerWick = Math.min(pattern.open, pattern.close) - pattern.low;
  const upperWick = pattern.high - Math.max(pattern.open, pattern.close);
  const bullEngulf = pattern.close > pattern.open && prior.close < prior.open &&
    pattern.open <= prior.close && pattern.close >= prior.open;
  const bearEngulf = pattern.close < pattern.open && prior.close > prior.open &&
    pattern.open >= prior.close && pattern.close <= prior.open;
  const bullPin = lowerWick / range >= 0.55 && pattern.close > pattern.open && body / range >= 0.12;
  const bearPin = upperWick / range >= 0.55 && pattern.close < pattern.open && body / range >= 0.12;
  const insideBar = pattern.high < prior.high && pattern.low > prior.low;
  // A pattern is only a setup. Entry requires a later candle to break its trigger level.
  if ((bullEngulf || bullPin || insideBar) && confirmation.close > pattern.high) return 'BUY';
  if ((bearEngulf || bearPin || insideBar) && confirmation.close < pattern.low) return 'SELL';
  return null;
}
function breakOfStructure(c: Candle[], side: TradeSide): boolean {
  const prior = c.slice(-11, -1);
  if (prior.length < 8) return false;
  const last = c[c.length - 1];
  return side === 'BUY'
    ? last.close > Math.max(...prior.map(x => x.high))
    : last.close < Math.min(...prior.map(x => x.low));
}
function changeOfCharacter(c: Candle[], side: TradeSide): boolean {
  if (c.length < 25) return false;
  const prior = trend(c.slice(0, -10));
  const recent = trend(c.slice(-10));
  return side === 'BUY' ? prior === 'bearish' && recent === 'bullish'
    : prior === 'bullish' && recent === 'bearish';
}
function orderBlockZone(c: Candle[], side: TradeSide, timeframe: Timeframe): PriceZone | null {
  if (c.length < 15) return null;
  const sample = c.slice(-21, -1);
  const avgRange = average(sample.map(x => x.high - x.low));
  if (!(avgRange > 0)) return null;
  const last = c[c.length - 1];
  for (let i = c.length - 2; i >= Math.max(1, c.length - 12); i--) {
    const candidate = c[i];
    const isOpposite = side === 'BUY' ? candidate.close < candidate.open : candidate.close > candidate.open;
    if (!isOpposite) continue;
    const impulse = c[i + 1];
    const impulseBody = Math.abs(impulse.close - impulse.open);
    const alignedImpulse = side === 'BUY' ? impulse.close > impulse.open : impulse.close < impulse.open;
    if (!alignedImpulse || impulseBody < avgRange * 1.5) continue;
    const low = Math.min(candidate.open, candidate.close);
    const high = Math.max(candidate.open, candidate.close);
    const tolerance = avgRange * 0.25;

    // An order block is invalid after a closed candle settles beyond its distal boundary.
    let invalidated = false;
    let reactions = 0;
    for (let k = i + 1; k < c.length; k++) {
      if ((side === 'BUY' && c[k].close < low) || (side === 'SELL' && c[k].close > high)) {
        invalidated = true;
        break;
      }
      if (c[k].low <= high && c[k].high >= low) reactions++;
    }
    if (invalidated) continue;
    if (last.close >= low - tolerance && last.close <= high + tolerance) {
      return {
        type: 'order_block', low, high, timeframe, direction: side,
        originIndex: i, originTime: candidate.time, identifiedAt: impulse.time,
        reactions, invalidationPrice: side === 'BUY' ? low : high, state: 'valid',
      };
    }
  }
  return null;
}
function liquiditySweep(c: Candle[], side: TradeSide): boolean {
  const recent = c.slice(-21, -1);
  const last = c[c.length - 1];
  if (recent.length < 10) return false;
  const priorHigh = Math.max(...recent.map(x => x.high));
  const priorLow = Math.min(...recent.map(x => x.low));
  return side === 'BUY' ? last.low < priorLow && last.close > priorLow : last.high > priorHigh && last.close < priorHigh;
}
export function evaluatePriceActionSetup(
  frames: Partial<Record<Timeframe, Candle[]>>,
  context: MarketContext = {},
): PriceActionSetup {
  const reasons: string[] = [];
  const checks: Record<string, boolean> = {};
  const features: PriceActionSetup['features'] = {};
  const zones: PriceActionZone[] = [];
  const required: Timeframe[] = ['H4', 'H1', 'M15'];
  for (const tf of required) {
    checks[`data_${tf}`] = validClosedCandles(frames[tf], tf);
    if (!checks[`data_${tf}`]) reasons.push(`Dados insuficientes, desordenados ou inválidos em ${tf}`);
  }
  const validM5 = validClosedCandles(frames.M5, 'M5') ? frames.M5 : undefined;
  const validM1 = validClosedCandles(frames.M1, 'M1') ? frames.M1 : undefined;
  const entryOptions: Candle[][] = [validM5, validM1].filter((frame): frame is Candle[] => frame !== undefined);
  let entryCandles: Candle[] | undefined = entryOptions[0];
  checks.entry_data = entryOptions.length > 0;
  if (!checks.entry_data) reasons.push('Dados insuficientes, desordenados ou inválidos em M5/M1');
  if (reasons.length) return { action: 'HOLD', approved: false, reasons, checks, features, zones };

  const h4 = frames.H4!;
  const h1 = frames.H1!;
  const m15 = frames.M15!;
  const initialEntryCandles = entryCandles!;
  const t4 = trend(h4), t1 = trend(h1), m15Trend = trend(m15);
  features.trendH4 = t4;
  features.trendH1 = t1;
  features.trendM15 = m15Trend;

  const directionalMode = (t4 === 'bullish' || t4 === 'bearish') && t4 === t1;
  const rangeMode = t4 === 'range' && t1 === 'range';
  checks.trend_alignment = directionalMode || rangeMode;
  features.marketMode = rangeMode ? 'range' : directionalMode ? t4 : 'conflict';
  if (!checks.trend_alignment) reasons.push('Tendências H4/H1 em conflito; operação bloqueada');

  checks.m15_alignment = rangeMode
    ? true
    : directionalMode && (m15Trend === 'range' || m15Trend === t4);
  if (!checks.m15_alignment) reasons.push('Estrutura de 15M conflita com a direção principal ou não confirma o range');

  let entrySide = trigger(initialEntryCandles);
  let entry = initialEntryCandles[initialEntryCandles.length - 1].close;
  let side: TradeSide | null = null;
  const triggerOptions = entryOptions.map(candles => ({
    candles,
    side: trigger(candles),
    entry: candles[candles.length - 1].close,
  }));

  if (directionalMode) {
    const expected: TradeSide = t4 === 'bullish' ? 'BUY' : 'SELL';
    const chosen = triggerOptions.find(option => option.side === expected);
    if (chosen && checks.m15_alignment) {
      entryCandles = chosen.candles;
      entrySide = chosen.side;
      entry = chosen.entry;
      side = expected;
    }
  } else if (rangeMode) {
    // Range trading is only allowed at an extreme, never in the middle of the interval.
    const rangeSample = m15.slice(-40, -1);
    const rangeLow = Math.min(...rangeSample.map(c => c.low));
    const rangeHigh = Math.max(...rangeSample.map(c => c.high));
    const baseTolerance = averageRange(m15) * 0.75;
    const chosen = triggerOptions.find(option => {
      if (!option.side) return false;
      const edgeTolerance = Math.max(baseTolerance, Math.abs(option.entry) * 0.0005);
      return option.side === 'BUY'
        ? option.entry <= rangeLow + edgeTolerance
        : option.entry >= rangeHigh - edgeTolerance;
    });
    features.rangeLow = rangeLow;
    features.rangeHigh = rangeHigh;
    if (chosen) {
      entryCandles = chosen.candles;
      entrySide = chosen.side;
      entry = chosen.entry;
      side = chosen.side;
      features.rangeEdgeTolerance = Math.max(baseTolerance, Math.abs(entry) * 0.0005);
    }
  }

  checks.entry_trigger = side !== null;
  features.trigger = entrySide;
  if (!side) reasons.push(rangeMode
    ? 'Sem gatilho confirmado em um extremo válido do range em M5 ou M1'
    : 'Sem gatilho M5/M1 confirmado na direção alinhada de H4/H1');

  if (side) {
    const selectedEntryCandles = entryCandles!;
    const selectedEntryTimeframe: Timeframe = entryCandles === validM5 ? 'M5' : 'M1';
    const supportResistance = repeatedStructureZone(m15, side === 'BUY' ? 'low' : 'high', entry, 'M15');
    const fvgOnM15 = fairValueGapZone(m15, side, entry, 'M15');
    const fvgZone = fvgOnM15 ?? fairValueGapZone(selectedEntryCandles, side, entry, selectedEntryTimeframe);
    const sweepOnM15 = liquiditySweep(m15, side);
    const sweepOnEntry = !sweepOnM15 && liquiditySweep(selectedEntryCandles, side);
    const sweep = sweepOnM15 || sweepOnEntry;
    const bos = breakOfStructure(m15, side) || breakOfStructure(selectedEntryCandles, side);
    const choch = changeOfCharacter(m15, side) || changeOfCharacter(selectedEntryCandles, side);
    const obOnM15 = orderBlockZone(m15, side, 'M15');
    const ob = obOnM15 ?? orderBlockZone(selectedEntryCandles, side, selectedEntryTimeframe);
    const rangeEdgeQualified = rangeMode && side !== null;
    const zoneNear = rangeEdgeQualified || supportResistance !== null || fvgZone !== null || ob !== null || sweep;

    if (supportResistance) zones.push(supportResistance);
    if (fvgZone) zones.push(fvgZone);
    if (ob) zones.push(ob);
    if (sweep) {
      const sweepCandles = sweepOnM15 ? m15 : selectedEntryCandles;
      const sweepTimeframe: Timeframe = sweepOnM15 ? 'M15' : selectedEntryTimeframe;
      const sweepSample = sweepCandles.slice(-21, -1);
      const sweepLevel = side === 'BUY'
        ? Math.min(...sweepSample.map(candle => candle.low))
        : Math.max(...sweepSample.map(candle => candle.high));
      const sweepWidth = Math.max(averageRange(sweepCandles) * 0.2, Math.abs(sweepLevel) * 0.00005);
      const sweepPivots = pivots(sweepCandles, side === 'BUY' ? 'low' : 'high')
        .filter(pivot => Math.abs(pivot.price - sweepLevel) <= sweepWidth)
        .sort((a, b) => b.index - a.index);
      const sweepOrigin = sweepPivots[0];
      zones.push({
        type: 'liquidity',
        low: sweepLevel - sweepWidth,
        high: sweepLevel + sweepWidth,
        timeframe: sweepTimeframe,
        originTime: sweepOrigin ? sweepCandles[sweepOrigin.index].time : sweepSample[0].time,
        identifiedAt: sweepCandles[sweepCandles.length - 1].time,
        reactions: 1,
        invalidationPrice: side === 'BUY' ? sweepLevel - sweepWidth : sweepLevel + sweepWidth,
        state: 'valid',
        direction: side,
      });
    }
    if (rangeEdgeQualified && finite(features.rangeLow) && finite(features.rangeHigh) && finite(features.rangeEdgeTolerance)) {
      const rangeEdge = side === 'BUY' ? Number(features.rangeLow) : Number(features.rangeHigh);
      const edgeTolerance = Number(features.rangeEdgeTolerance);
      const rangeSample = m15.slice(-40, -1);
      const reactions = rangeSample.filter(candle => Math.abs((side === 'BUY' ? candle.low : candle.high) - rangeEdge) <= edgeTolerance).length;
      zones.push({
        type: side === 'BUY' ? 'support' : 'resistance',
        low: rangeEdge - edgeTolerance,
        high: rangeEdge + edgeTolerance,
        timeframe: 'M15',
        originTime: rangeSample[0].time,
        identifiedAt: m15[m15.length - 1].time,
        reactions,
        invalidationPrice: side === 'BUY' ? rangeEdge - edgeTolerance : rangeEdge + edgeTolerance,
        state: 'valid',
        direction: side,
      });
    }

    const volumes = selectedEntryCandles.slice(-21, -1).map(c => c.volume);
    const volumeBaseline = average(volumes);
    const triggerVolume = selectedEntryCandles[selectedEntryCandles.length - 1].volume;
    const volumeOk = volumeBaseline > 0 && triggerVolume > volumeBaseline;
    features.fvg = fvgZone !== null;
    features.fvgLow = fvgZone?.low ?? null;
    features.fvgHigh = fvgZone?.high ?? null;
    features.fvgOriginTime = fvgZone?.originTime ?? null;
    features.fvgIdentifiedAt = fvgZone?.identifiedAt ?? null;
    features.fvgTimeframe = fvgZone?.timeframe ?? null;
    features.fvgInvalidationPrice = fvgZone?.invalidationPrice ?? null;
    features.fvgState = fvgZone?.state ?? null;
    features.liquiditySweep = sweep;
    features.bos = bos;
    features.choch = choch;
    features.orderBlockValid = ob !== null;
    features.orderBlockLow = ob?.low ?? null;
    features.orderBlockHigh = ob?.high ?? null;
    features.orderBlockOriginTime = ob?.originTime ?? null;
    features.orderBlockIdentifiedAt = ob?.identifiedAt ?? null;
    features.orderBlockTimeframe = ob?.timeframe ?? null;
    features.orderBlockInvalidationPrice = ob?.invalidationPrice ?? null;
    features.orderBlockState = ob?.state ?? null;
    features.supportResistanceZone = supportResistance !== null;
    features.supportResistanceTouches = supportResistance?.reactions ?? 0;
    features.supportResistanceLow = supportResistance?.low ?? null;
    features.supportResistanceHigh = supportResistance?.high ?? null;
    features.supportResistanceOriginTime = supportResistance?.originTime ?? null;
    features.supportResistanceIdentifiedAt = supportResistance?.identifiedAt ?? null;
    features.supportResistanceTimeframe = supportResistance?.timeframe ?? null;
    features.supportResistanceInvalidationPrice = supportResistance?.invalidationPrice ?? null;
    features.supportResistanceState = supportResistance?.state ?? null;
    features.rangeEdgeQualified = rangeEdgeQualified;
    features.zoneNear = zoneNear;
    features.volumeBaseline = volumeBaseline;
    features.volumeRatio = volumeBaseline > 0 ? triggerVolume / volumeBaseline : null;

    checks.volume = volumeOk;
    // A trend alone is not a confirmation pattern; the zone and trigger are independently mandatory.
    features.structuralEvidence = fvgZone !== null || sweep || bos || choch || ob !== null;
    checks.valid_zone = zoneNear;
    if (!volumeOk) reasons.push('Volume do gatilho não superou a média das 20 velas fechadas anteriores');
    if (!zoneNear) reasons.push('Preço fora de zona válida de suporte/resistência, FVG, Order Block ou liquidez');

    const recent = selectedEntryCandles.slice(-21, -1);
    const averageCandleRange = average(recent.map(c => c.high - c.low));
    const stopBuffer = Math.max(averageCandleRange * 0.1, entry * 0.00005);
    const structuralPivots = pivots(selectedEntryCandles, side === 'BUY' ? 'low' : 'high')
      .filter(pivot => pivot.index >= Math.max(2, selectedEntryCandles.length - 25) &&
        pivot.index <= selectedEntryCandles.length - 3)
      .sort((a, b) => b.index - a.index);
    const structuralPivot = structuralPivots.find(pivot =>
      side === 'BUY' ? pivot.price < entry : pivot.price > entry);
    const stop = structuralPivot
      ? (side === 'BUY' ? structuralPivot.price - stopBuffer : structuralPivot.price + stopBuffer)
      : Number.NaN;
    const risk = finite(stop) ? Math.abs(entry - stop) : 0;
    const costsCandidate = context.estimatedRoundTripCost;
    const costsValid = finite(costsCandidate) && costsCandidate >= 0;
    const costs = costsValid ? costsCandidate as number : 0;
    const targetDistance = risk * 2 + costs * 3;
    const target = risk > 0 ? (side === 'BUY' ? entry + targetDistance : entry - targetDistance) : Number.NaN;
    const rr = risk > 0 && costsValid ? (Math.abs(target - entry) - costs) / (risk + costs) : 0;
    const barrierDistance = nearestBarrierDistance([h4, h1, m15], side, entry);

    features.entry = entry;
    features.stop = finite(stop) ? stop : null;
    features.target = finite(target) ? target : null;
    features.riskReward = rr;
    features.stopBuffer = stopBuffer;
    features.structuralStopPivot = structuralPivot?.price ?? null;
    features.nearestBarrierDistance = barrierDistance;

    checks.structural_stop = structuralPivot !== undefined && finite(stop);
    if (!checks.structural_stop) reasons.push('Não existe pivô estrutural confirmado para posicionar o stop sem improvisação');

    checks.stop_direction = checks.structural_stop && entry > 0 &&
      (side === 'BUY' ? stop < entry : stop > entry);
    if (!checks.stop_direction) reasons.push('Stop estrutural ausente ou no lado incorreto da entrada');

    checks.risk_reward = risk > 0 && rr >= 2;
    if (!checks.risk_reward) reasons.push('Relação risco/retorno inferior a 1:2 após custos estimados');

    checks.stop_distance_limit = entry > 0 && risk > 0 && risk / entry <= 0.015;
    if (!checks.stop_distance_limit) reasons.push('Stop estrutural excede 1,5%; o stop não será comprimido artificialmente');

    checks.space = barrierDistance !== null && barrierDistance > targetDistance;
    if (!checks.space) reasons.push('Não foi comprovado espaço estrutural suficiente até a próxima barreira para o alvo planejado');

    checks.spread = finite(context.spread) && finite(context.maxSpread) && context.spread >= 0 &&
      context.maxSpread > 0 && context.spread <= context.maxSpread;
    if (!checks.spread) reasons.push('Spread ausente, inválido ou acima do limite configurado');

    checks.costs = costsValid;
    if (!checks.costs) reasons.push('Custos totais estimados ausentes ou inválidos');
  } else {
    checks.volume = false;
    checks.structural_stop = false;
    checks.valid_zone = false;
    checks.risk_reward = false;
    checks.stop_direction = false;
    checks.stop_distance_limit = false;
    checks.space = false;
    checks.spread = false;
    checks.costs = false;
  }

  checks.news_clear = context.highImpactNewsBlocked === false;
  if (!checks.news_clear) reasons.push('Janela de notícia de alto impacto bloqueada ou não validada');
  checks.risk_limit = context.riskLimitOk === true;
  if (!checks.risk_limit) reasons.push('Limite de risco/circuit breaker bloqueia a operação');
  checks.trading_session = context.tradingSessionOpen === true;
  if (!checks.trading_session) reasons.push('Fora das sessões operacionais autorizadas');

  const approved = Object.values(checks).every(Boolean) && side !== null;
  if (!approved) return { action: 'HOLD', approved: false, reasons, checks, features, zones };
  return {
    action: side!,
    approved: true,
    reasons: ['Setup validado por todos os critérios determinísticos obrigatórios'],
    checks,
    entry,
    stopLoss: Number(features.stop),
    takeProfit: Number(features.target),
    riskReward: Number(features.riskReward),
    features,
    zones,
  };
}

/** AI is a reviewer, never a signal generator or risk-policy owner. */
export function validateAIEntryReview(
  setup: PriceActionSetup,
  _review: { decision?: string; direction?: string; confidence?: number; riskOverride?: unknown },
): { approved: boolean; reason: string } {
  if (!setup.approved || setup.action === 'HOLD') {
    return { approved: false, reason: 'Nenhuma entrada válida foi gerada pela estratégia' };
  }
  return {
    approved: true,
    reason: 'O setup satisfez os critérios escritos; confiança/consenso da IA não acrescentam critérios de entrada.',
  };
}

/** An AI may only tighten protection, never widen risk or remove a stop. */
export function validateAIStopAdjustment(
  side: TradeSide, currentStop: number, proposedStop: number, entryPrice: number,
): boolean {
  if (![currentStop, proposedStop, entryPrice].every(finite) || currentStop <= 0 || proposedStop <= 0) return false;
  if (side === 'BUY') return proposedStop >= currentStop && proposedStop < entryPrice;
  return proposedStop <= currentStop && proposedStop > entryPrice;
}
