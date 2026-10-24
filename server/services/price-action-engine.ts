/**
 * Deterministic Price Action gate for the layered Invista Pro strategy.
 * No AI may create an entry; AI can only approve/reject a valid strategy setup.
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
}
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const validCandles = (v: unknown): v is Candle[] => Array.isArray(v) && v.length >= 30 &&
  v.every((c, i) => c && finite(c.time) && finite(c.open) && finite(c.high) && finite(c.low) &&
    finite(c.close) && finite(c.volume) && c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close) && c.high >= c.low && c.volume >= 0 &&
    (i === 0 || c.time > v[i - 1].time));

export function isValidPriceActionCandles(v: unknown): v is Candle[] {
  return validCandles(v);
}

type MarketTrend = 'bullish' | 'bearish' | 'range' | 'unknown';
type PivotKind = 'high' | 'low';
interface Pivot { index: number; price: number; time: number }
interface PriceZone { low: number; high: number; touches: number; identifiedAt?: number; invalidationPrice?: number }
interface RangeBounds { low: number; high: number; lowTouches: number; highTouches: number }

/** Swing points are used only after two candles have closed on their right. */
function pivots(c: Candle[], kind: PivotKind, wing = 2): Pivot[] {
  const result: Pivot[] = [];
  for (let i = wing; i < c.length - wing; i++) {
    const price = kind === 'high' ? c[i].high : c[i].low;
    let isPivot = true;
    for (let j = i - wing; j <= i + wing; j++) {
      if (j === i) continue;
      const compared = kind === 'high' ? c[j].high : c[j].low;
      if (kind === 'high' ? compared >= price : compared <= price) {
        isPivot = false;
        break;
      }
    }
    if (isPivot) result.push({ index: i, price, time: c[i].time });
  }
  return result;
}

function detectRangeBounds(c: Candle[]): RangeBounds | null {
  const sample = c.slice(-60);
  if (sample.length < 30) return null;
  const recentClose = sample[sample.length - 1].close;
  const rangeUnit = averageRange(sample);
  if (!(rangeUnit > 0) || !(recentClose > 0)) return null;
  const tolerance = Math.max(rangeUnit * 0.65, recentClose * 0.0003);

  const cluster = (kind: PivotKind): PriceZone[] => {
    const levels = pivots(sample.slice(0, -1), kind).slice(-10);
    const buckets: number[][] = [];
    for (const pivot of levels) {
      const group = buckets.find(items => Math.abs(average(items) - pivot.price) <= tolerance);
      if (group) group.push(pivot.price);
      else buckets.push([pivot.price]);
    }
    return buckets.filter(items => items.length >= 2).map(items => ({
      low: Math.min(...items) - tolerance,
      high: Math.max(...items) + tolerance,
      touches: items.length,
    }));
  };

  const highZones = cluster('high').sort((a, b) => b.high - a.high);
  const lowZones = cluster('low').sort((a, b) => a.low - b.low);
  if (!highZones.length || !lowZones.length) return null;

  const upper = highZones[0];
  const lower = lowZones[0];
  const width = upper.high - lower.low;
  // A genuine range has repeated reactions at both edges, meaningful width,
  // and a latest closed price that has not already broken out of the range.
  if (upper.high <= lower.low || width < rangeUnit * 4) return null;
  if (recentClose < lower.low - tolerance || recentClose > upper.high + tolerance) return null;

  return {
    low: lower.low,
    high: upper.high,
    lowTouches: lower.touches,
    highTouches: upper.touches,
  };
}

function trend(c: Candle[]): MarketTrend {
  const sample = c.slice(-60);
  const highs = pivots(sample, 'high');
  const lows = pivots(sample, 'low');
  // Missing confirmed pivots mean unknown structure, never an inferred range.
  if (highs.length < 2 || lows.length < 2) return 'unknown';

  const [oldHigh, lastHigh] = highs.slice(-2);
  const [oldLow, lastLow] = lows.slice(-2);
  const tolerance = Math.max(averageRange(sample) * 0.1, Math.abs(sample[sample.length - 1].close) * 0.00005);
  if (lastHigh.price > oldHigh.price + tolerance && lastLow.price > oldLow.price + tolerance) return 'bullish';
  if (lastHigh.price < oldHigh.price - tolerance && lastLow.price < oldLow.price - tolerance) return 'bearish';
  return detectRangeBounds(sample) ? 'range' : 'unknown';
}
function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
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
function findFairValueGapZone(c: Candle[], side: TradeSide, currentPrice: number): PriceZone | null {
  const sample = c.slice(-60);
  if (sample.length < 3 || !finite(currentPrice) || currentPrice <= 0) return null;
  const baseline = averageRange(sample);
  if (!(baseline > 0)) return null;
  const tolerance = Math.max(baseline * 0.15, currentPrice * 0.00005);

  for (let i = sample.length - 1; i >= 2; i--) {
    const first = sample[i - 2];
    const impulse = sample[i - 1];
    const third = sample[i];
    const impulseBody = Math.abs(impulse.close - impulse.open);
    if (impulseBody < baseline * 0.5) continue;

    const low = side === 'BUY' ? first.high : third.high;
    const high = side === 'BUY' ? third.low : first.low;
    const isGap = side === 'BUY'
      ? third.low > first.high && impulse.close > impulse.open
      : third.high < first.low && impulse.close < impulse.open;
    if (!isGap || high <= low) continue;

    // A later close beyond the far side invalidates the gap. The latest price
    // must actually return to the zone; a fresh, unmitigated gap is not a zone touch.
    let invalidated = false;
    for (let j = i + 1; j < sample.length; j++) {
      if ((side === 'BUY' && sample[j].close < low) ||
          (side === 'SELL' && sample[j].close > high)) {
        invalidated = true;
        break;
      }
    }
    const returnedToZone = currentPrice >= low - tolerance && currentPrice <= high + tolerance;
    if (!invalidated && returnedToZone) {
      return { low, high, touches: 1, identifiedAt: third.time, invalidationPrice: side === 'BUY' ? low : high };
    }
  }
  return null;
}
function breakOfStructure(c: Candle[], side: TradeSide): boolean {
  if (c.length < 30) return false;
  const closedBeforeTrigger = c.slice(0, -1);
  const swingLevels = pivots(closedBeforeTrigger, side === 'BUY' ? 'high' : 'low').slice(-3);
  const latest = swingLevels[swingLevels.length - 1];
  const triggerBar = c[c.length - 1];
  if (!latest || !finite(triggerBar.close)) return false;
  return side === 'BUY' ? triggerBar.close > latest.price : triggerBar.close < latest.price;
}
function changeOfCharacter(c: Candle[], side: TradeSide): boolean {
  if (c.length < 60) return false;
  const prior = trend(c.slice(-60, -30));
  const recent = trend(c.slice(-30));
  return side === 'BUY' ? prior === 'bearish' && recent === 'bullish'
    : prior === 'bullish' && recent === 'bearish';
}
function orderBlockZone(c: Candle[], side: TradeSide, currentPrice = c[c.length - 1]?.close): { low: number; high: number; touches: number; identifiedAt: number; invalidationPrice: number } | null {
  if (c.length < 15 || !finite(currentPrice) || currentPrice <= 0) return null;
  const baseline = averageRange(c);
  if (!(baseline > 0)) return null;
  for (let i = c.length - 3; i >= Math.max(1, c.length - 30); i--) {
    const candidate = c[i];
    const impulse = c[i + 1];
    const isOpposite = side === 'BUY' ? candidate.close < candidate.open : candidate.close > candidate.open;
    const impulseBody = Math.abs(impulse.close - impulse.open);
    const alignedImpulse = side === 'BUY' ? impulse.close > impulse.open : impulse.close < impulse.open;
    if (!isOpposite || !alignedImpulse || impulseBody < baseline * 1.5) continue;
    const low = Math.min(candidate.open, candidate.close);
    const high = Math.max(candidate.open, candidate.close);
    const tolerance = baseline * 0.25;
    const invalidated = side === 'BUY'
      ? c.slice(i + 2).some(bar => bar.close < candidate.low)
      : c.slice(i + 2).some(bar => bar.close > candidate.high);
    const priceInZone = currentPrice >= low - tolerance && currentPrice <= high + tolerance;
    if (!invalidated && priceInZone) {
      return {
        low,
        high,
        touches: 1,
        identifiedAt: candidate.time,
        invalidationPrice: side === 'BUY' ? candidate.low : candidate.high,
      };
    }
  }
  return null;
}
function averageRange(c: Candle[]): number {
  return average(c.slice(-21, -1).map(x => x.high - x.low));
}

/** A valid supply/demand region needs at least two confirmed reactions. */
function repeatedStructureZone(c: Candle[], kind: PivotKind, price: number): PriceZone | null {
  if (!finite(price) || price <= 0) return null;
  const tolerance = Math.max(averageRange(c) * 0.35, Math.abs(price) * 0.00005);
  const levels = pivots(c.slice(0, -1), kind);
  const clusters: Pivot[][] = [];
  for (const pivot of levels) {
    const cluster = clusters.find(items =>
      Math.abs(average(items.map(item => item.price)) - pivot.price) <= tolerance
    );
    if (cluster) cluster.push(pivot);
    else clusters.push([pivot]);
  }
  const valid = clusters.filter(items => items.length >= 2).map(items => {
    const levelPrices = items.map(item => item.price);
    const low = Math.min(...levelPrices) - tolerance;
    const high = Math.max(...levelPrices) + tolerance;
    const identifiedAt = Math.max(...items.map(item => item.time));
    const invalidatedAfterIdentification = c.some(bar =>
      bar.time > identifiedAt &&
      (kind === 'low' ? bar.close < low : bar.close > high)
    );
    return {
      low,
      high,
      touches: items.length,
      identifiedAt,
      invalidationPrice: kind === 'low' ? low : high,
      invalidated: invalidatedAfterIdentification,
    };
  });
  const near = valid.filter(zone =>
    !zone.invalidated && price >= zone.low - tolerance && price <= zone.high + tolerance
  );
  return near.sort((a, b) =>
    Math.abs(price - (a.low + a.high) / 2) - Math.abs(price - (b.low + b.high) / 2)
  )[0] ?? null;
}

function nearStructureZone(c: Candle[], side: TradeSide, price = c[c.length - 1]?.close): boolean {
  return repeatedStructureZone(c, side === 'BUY' ? 'low' : 'high', price) !== null;
}

function nearestBarrier(
  frames: Array<{ timeframe: Timeframe; candles: Candle[] }>,
  side: TradeSide,
  entry: number,
): { level: number; distance: number; timeframe: Timeframe } | null {
  const candidates = frames.flatMap(frame =>
    pivots(frame.candles, side === 'BUY' ? 'high' : 'low')
      .map(pivot => ({ level: pivot.price, timeframe: frame.timeframe }))
      .filter(item => side === 'BUY' ? item.level > entry : item.level < entry)
  );
  if (!candidates.length) return null;
  const selected = candidates.sort((a, b) =>
    side === 'BUY' ? a.level - b.level : b.level - a.level
  )[0];
  return { ...selected, distance: Math.abs(selected.level - entry) };
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
  const required: Timeframe[] = ['H4', 'H1', 'M15'];

  for (const timeframe of required) {
    checks[`data_${timeframe}`] = validCandles(frames[timeframe]);
    if (!checks[`data_${timeframe}`]) reasons.push(`Dados insuficientes ou inválidos em ${timeframe}`);
  }

  const validM5 = validCandles(frames.M5);
  const validM1 = validCandles(frames.M1);
  let entryTimeframe: 'M5' | 'M1' | null = validM5 ? 'M5' : validM1 ? 'M1' : null;

  // M5 is preferred, but M1 must remain a real alternative when only M1 confirms
  // the H4/H1 direction or the correctly triggered edge of a validated range.
  if (validM5 && validM1 && validCandles(frames.H4) && validCandles(frames.H1) && validCandles(frames.M15)) {
    const selectionH4 = trend(frames.H4);
    const selectionH1 = trend(frames.H1);
    const selectionM15 = frames.M15;
    const selectionM15Trend = trend(selectionM15);
    const selectionRange = detectRangeBounds(selectionM15);
    const directional = (selectionH4 === 'bullish' || selectionH4 === 'bearish') && selectionH4 === selectionH1;
    const ranged = selectionH4 === 'range' && selectionH1 === 'range' &&
      selectionM15Trend === 'range' && selectionRange !== null;
    const candidates: Array<{ timeframe: 'M5' | 'M1'; candles: Candle[] }> = [
      { timeframe: 'M5', candles: frames.M5! },
      { timeframe: 'M1', candles: frames.M1! },
    ];
    const matching = candidates.find(candidate => {
      const candidateSide = trigger(candidate.candles);
      const candidatePrice = candidate.candles[candidate.candles.length - 1].close;
      if (directional && selectionM15Trend !== 'range') {
        return candidateSide === (selectionH4 === 'bullish' ? 'BUY' : 'SELL');
      }
      if ((ranged || (directional && selectionM15Trend === 'range')) && selectionRange) {
        const edgeTolerance = Math.max(averageRange(selectionM15) * 0.75, Math.abs(candidatePrice) * 0.0005);
        const nearLowerEdge = candidatePrice <= selectionRange.low + edgeTolerance;
        const nearUpperEdge = candidatePrice >= selectionRange.high - edgeTolerance;
        if (directional) {
          return selectionH4 === 'bullish'
            ? candidateSide === 'BUY' && nearLowerEdge
            : candidateSide === 'SELL' && nearUpperEdge;
        }
        return (candidateSide === 'BUY' && nearLowerEdge) ||
          (candidateSide === 'SELL' && nearUpperEdge);
      }
      return false;
    });
    if (matching) entryTimeframe = matching.timeframe;
  }

  const entryFrame = entryTimeframe ? frames[entryTimeframe] : undefined;
  features.entryTimeframe = entryTimeframe ?? 'unknown';
  checks.entry_data = entryFrame !== undefined;
  if (!checks.entry_data) reasons.push('Dados insuficientes em M5/M1 para confirmação de entrada');

  if (reasons.length > 0) {
    return { action: 'HOLD', approved: false, reasons, checks, features };
  }

  const h4 = frames.H4!;
  const h1 = frames.H1!;
  const m15 = frames.M15!;
  const entry = entryFrame![entryFrame!.length - 1].close;
  const t4 = trend(h4);
  const t1 = trend(h1);
  const m15Trend = trend(m15);
  const m15Range = detectRangeBounds(m15);

  features.trendH4 = t4;
  features.trendH1 = t1;
  features.trendM15 = m15Trend;
  features.marketMode = t4 === t1 && (t4 === 'bullish' || t4 === 'bearish')
    ? t4 : t4 === 'range' && t1 === 'range' ? 'range' : 'conflict';

  const directionalMode = (t4 === 'bullish' || t4 === 'bearish') && t4 === t1;
  const rangeMode = t4 === 'range' && t1 === 'range';
  const m15DirectionalAlignment = directionalMode && m15Trend === t4;
  const m15RangeAlignment = (directionalMode || rangeMode) && m15Trend === 'range' && m15Range !== null;
  checks.trend_alignment = directionalMode || rangeMode;
  checks.m15_alignment = m15DirectionalAlignment || m15RangeAlignment;
  if (!checks.trend_alignment) {
    reasons.push('H4/H1 sem tendência alinhada ou sem range objetivamente confirmado; operação bloqueada');
  }
  if (!checks.m15_alignment) {
    reasons.push('Estrutura de 15M não confirma a direção principal nem um range validado');
  }

  const entrySide = trigger(entryFrame!);
  features.trigger = entrySide;
  let side: TradeSide | null = null;
  let atRangeExtreme = false;
  let rangeEdgeTolerance = 0;

  if (directionalMode && m15DirectionalAlignment && entrySide) {
    const expectedSide: TradeSide = t4 === 'bullish' ? 'BUY' : 'SELL';
    if (entrySide === expectedSide) side = entrySide;
  } else if (m15RangeAlignment && m15Range && entrySide) {
    rangeEdgeTolerance = Math.max(averageRange(m15) * 0.75, Math.abs(entry) * 0.0005);
    const nearLowerEdge = entry <= m15Range.low + rangeEdgeTolerance;
    const nearUpperEdge = entry >= m15Range.high - rangeEdgeTolerance;
    const allowedBuy = !directionalMode || t4 === 'bullish';
    const allowedSell = !directionalMode || t4 === 'bearish';
    if (entrySide === 'BUY' && nearLowerEdge && allowedBuy) {
      side = 'BUY';
      atRangeExtreme = true;
    } else if (entrySide === 'SELL' && nearUpperEdge && allowedSell) {
      side = 'SELL';
      atRangeExtreme = true;
    }
    features.rangeLow = m15Range.low;
    features.rangeHigh = m15Range.high;
    features.rangeLowTouches = m15Range.lowTouches;
    features.rangeHighTouches = m15Range.highTouches;
    features.rangeEdgeTolerance = rangeEdgeTolerance;
  }
  checks.entry_trigger = side !== null;
  checks.range_extreme = !(rangeMode || m15RangeAlignment) || atRangeExtreme;
  if (!side) {
    reasons.push(rangeMode
      ? 'Sem gatilho confirmado em um extremo do range de 15M; meio da faixa não autoriza entrada'
      : 'Sem gatilho M5/M1 confirmado na direção H4/H1');
  }

  // Diagnostics use only closed candles. A support/resistance zone is a region
  // with repeated reactions; a gap only qualifies after price returns to it.
  if (side) {
    const structureFrames: Array<{ timeframe: Timeframe; candles: Candle[] }> = [
      { timeframe: 'H4', candles: h4 },
      { timeframe: 'H1', candles: h1 },
      { timeframe: 'M15', candles: m15 },
      { timeframe: entryTimeframe!, candles: entryFrame! },
    ];
    const structureKind: PivotKind = side === 'BUY' ? 'low' : 'high';
    const structureZone = structureFrames
      .map(frame => ({
        timeframe: frame.timeframe,
        candles: frame.candles,
        zone: repeatedStructureZone(frame.candles, structureKind, entry),
      }))
      .filter(item => item.zone !== null)
      .sort((a, b) =>
        Math.abs(entry - (a.zone!.low + a.zone!.high) / 2) -
        Math.abs(entry - (b.zone!.low + b.zone!.high) / 2)
      )[0] ?? null;

    const fvgZone = structureFrames
      .map(frame => ({
        timeframe: frame.timeframe,
        candles: frame.candles,
        zone: findFairValueGapZone(frame.candles, side!, entry),
      }))
      .filter(item => item.zone !== null)
      .sort((a, b) =>
        Math.abs(entry - (a.zone!.low + a.zone!.high) / 2) -
        Math.abs(entry - (b.zone!.low + b.zone!.high) / 2)
      )[0] ?? null;

    const obZone = structureFrames
      .map(frame => ({
        timeframe: frame.timeframe,
        candles: frame.candles,
        zone: orderBlockZone(frame.candles, side!, entry),
      }))
      .filter(item => item.zone !== null)
      .sort((a, b) =>
        Math.abs(entry - (a.zone!.low + a.zone!.high) / 2) -
        Math.abs(entry - (b.zone!.low + b.zone!.high) / 2)
      )[0] ?? null;

    const sweep = liquiditySweep(m15, side) || liquiditySweep(entryFrame!, side);
    const bos = breakOfStructure(m15, side) || breakOfStructure(entryFrame!, side);
    const choch = changeOfCharacter(m15, side) || changeOfCharacter(entryFrame!, side);
    const validRangeEdge = m15RangeAlignment && atRangeExtreme && m15Range !== null;
    const zoneNear = structureZone !== null || fvgZone !== null || obZone !== null || validRangeEdge;
    const volumeHistory = entryFrame!.slice(-21, -1).map(candle => candle.volume);
    const volumeBaseline = average(volumeHistory);
    const triggerVolume = entryFrame![entryFrame!.length - 1].volume;
    const volumeOk = volumeBaseline > 0 && triggerVolume > volumeBaseline;

    features.fvg = fvgZone !== null;
    features.fvgLow = fvgZone?.zone?.low ?? null;
    features.fvgHigh = fvgZone?.zone?.high ?? null;
    features.fvgTimeframe = fvgZone?.timeframe ?? null;
    features.fvgIdentifiedAt = fvgZone?.zone?.identifiedAt ?? null;
    features.fvgInvalidationPrice = fvgZone?.zone?.invalidationPrice ?? null;
    features.liquiditySweep = sweep;
    features.bos = bos;
    features.choch = choch;
    features.orderBlockValid = obZone !== null;
    features.orderBlockLow = obZone?.zone?.low ?? null;
    features.orderBlockHigh = obZone?.zone?.high ?? null;
    features.orderBlockTimeframe = obZone?.timeframe ?? null;
    features.orderBlockIdentifiedAt = obZone?.zone?.identifiedAt ?? null;
    features.orderBlockInvalidationPrice = obZone?.zone?.invalidationPrice ?? null;
    features.supportResistanceZone = structureZone !== null;
    features.supportResistanceLow = structureZone?.zone?.low ?? null;
    features.supportResistanceHigh = structureZone?.zone?.high ?? null;
    features.supportResistanceTouches = structureZone?.zone?.touches ?? 0;
    features.supportResistanceTimeframe = structureZone?.timeframe ?? null;
    features.supportResistanceIdentifiedAt = structureZone?.zone?.identifiedAt ?? null;
    let auditZone: { type: string; timeframe: Timeframe; zone: PriceZone } | null = null;
    if (structureZone?.zone) {
      auditZone = {
        type: side === 'BUY' ? 'support_demand' : 'resistance_supply',
        timeframe: structureZone.timeframe,
        zone: structureZone.zone,
      };
    } else if (fvgZone?.zone) {
      auditZone = { type: 'fair_value_gap', timeframe: fvgZone.timeframe, zone: fvgZone.zone };
    } else if (obZone?.zone) {
      auditZone = {
        type: 'order_block',
        timeframe: obZone.timeframe,
        zone: { ...obZone.zone, touches: 1 },
      };
    } else if (validRangeEdge && m15Range) {
      auditZone = {
        type: side === 'BUY' ? 'range_demand' : 'range_supply',
        timeframe: 'M15',
        zone: {
          low: side === 'BUY' ? m15Range.low : m15Range.high - rangeEdgeTolerance,
          high: side === 'BUY' ? m15Range.low + rangeEdgeTolerance : m15Range.high,
          touches: side === 'BUY' ? m15Range.lowTouches : m15Range.highTouches,
          identifiedAt: m15[m15.length - 1].time,
          invalidationPrice: side === 'BUY' ? m15Range.low : m15Range.high,
        },
      };
    }
    features.zoneType = auditZone?.type ?? null;
    features.zoneLow = auditZone?.zone.low ?? null;
    features.zoneHigh = auditZone?.zone.high ?? null;
    features.zoneTimeframe = auditZone?.timeframe ?? null;
    features.zoneTouches = auditZone?.zone.touches ?? 0;
    features.zoneIdentifiedAt = auditZone?.zone.identifiedAt ?? null;
    features.zoneInvalidationPrice = auditZone?.zone.invalidationPrice ?? null;
    features.zoneState = auditZone ? 'valid' : 'missing';
    features.zoneNear = zoneNear;
    features.volumeBaseline = volumeBaseline;
    features.triggerVolume = triggerVolume;
    features.volumeRatio = volumeBaseline > 0 ? triggerVolume / volumeBaseline : null;
    checks.volume = volumeOk;
    // BOS/CHoCH/sweep/FVG/OB are recorded as evidence. None is a stand-alone
    // mandatory pattern if another valid structure zone and trigger exist.
    checks.structure_confirmation = checks.m15_alignment && zoneNear;
    checks.valid_zone = zoneNear;
    if (!volumeOk) reasons.push('Volume do gatilho não supera a média das 20 velas fechadas anteriores');
    if (!checks.structure_confirmation) reasons.push('Estrutura de 15M e zona operacional válida não foram confirmadas');
    if (!zoneNear) reasons.push('Preço não está em ou próximo de uma zona estrutural válida; sweep isolado não basta');

    const entryPivots = pivots(entryFrame!, side === 'BUY' ? 'low' : 'high').slice(-1);
    const structuralPivot = entryPivots[0];
    const averageEntryRange = averageRange(entryFrame!);
    const stopBuffer = Math.max(averageEntryRange * 0.1, entry * 0.00005);
    const stop = structuralPivot
      ? side === 'BUY' ? structuralPivot.price - stopBuffer : structuralPivot.price + stopBuffer
      : Number.NaN;
    const risk = Math.abs(entry - stop);
    const costsValid = finite(context.estimatedRoundTripCost) && context.estimatedRoundTripCost >= 0;
    const costs = costsValid ? context.estimatedRoundTripCost! : 0;

    // The plan includes 50% realization at +1.5R and the remainder at final TP.
    // The weighted realized reward must still achieve at least 2:1 after costs.
    // Exact minimum that makes 50% at 1.5R plus 50% at final TP
    // deliver 2:1 net of the modeled round-trip cost. Do not impose an extra 3R target.
    const targetDistance = risk > 0
      ? risk * 2.5 + costs * 6
      : Number.NaN;
    const target = side === 'BUY' ? entry + targetDistance : entry - targetDistance;
    const plannedReward = risk * 0.75 + targetDistance * 0.5 - costs;
    const plannedRisk = risk + costs;
    const planRR = plannedRisk > 0 ? plannedReward / plannedRisk : 0;

    features.entry = entry;
    features.stop = finite(stop) ? stop : null;
    features.target = finite(target) ? target : null;
    features.riskReward = finite(planRR) ? planRR : null;
    features.stopBuffer = stopBuffer;
    features.initialRiskDistance = finite(risk) ? risk : null;
    features.finalTargetR = finite(risk) && risk > 0 ? targetDistance / risk : null;
    features.partialTargetR = 1.5;
    features.partialClosePercent = 50;
    checks.structural_stop = structuralPivot !== undefined && finite(stop) && stop > 0 && risk > 0;
    if (!checks.structural_stop) reasons.push('Não há pivô confirmado suficiente para definir stop estrutural válido');
    checks.stop_direction = finite(stop) && entry > 0 && (side === 'BUY' ? stop < entry : stop > entry);
    if (!checks.stop_direction) reasons.push('Stop estrutural está no lado incorreto da entrada');
    checks.risk_reward = finite(planRR) && planRR >= 2;
    if (!checks.risk_reward) reasons.push('Plano completo de parcial + alvo final não alcança 1:2 após custos');

    checks.stop_distance_limit = entry > 0 && risk > 0 && risk / entry <= 0.015;
    if (!checks.stop_distance_limit) reasons.push('Stop estrutural excede 1,5% do preço; não será comprimido artificialmente');

    checks.spread = finite(context.spread) && finite(context.maxSpread) &&
      context.spread >= 0 && context.maxSpread > 0 && context.spread <= context.maxSpread;
    if (!checks.spread) reasons.push('Spread ausente, inválido ou acima do limite configurado');
    checks.costs = costsValid;
    if (!checks.costs) reasons.push('Custos totais estimados ausentes ou inválidos');

    const barrier = nearestBarrier(structureFrames, side, entry);
    features.nextBarrierLevel = barrier?.level ?? null;
    features.nextBarrierDistance = barrier?.distance ?? null;
    features.nextBarrierTimeframe = barrier?.timeframe ?? null;
    features.takeProfitDistance = finite(targetDistance) ? targetDistance : null;
    checks.space = barrier !== null && finite(targetDistance) && barrier.distance > targetDistance + costs;
    if (!checks.space) reasons.push('Espaço até a próxima barreira estrutural é insuficiente ou não verificável');
  } else {
    checks.volume = false;
    checks.structure_confirmation = false;
    checks.valid_zone = false;
    checks.structural_stop = false;
    checks.stop_direction = false;
    checks.risk_reward = false;
    checks.stop_distance_limit = false;
    checks.spread = false;
    checks.costs = false;
    checks.space = false;
  }

  checks.news_clear = context.highImpactNewsBlocked === false;
  if (!checks.news_clear) reasons.push('Janela de notícia de alto impacto bloqueada ou não validada');
  checks.risk_limit = context.riskLimitOk === true;
  if (!checks.risk_limit) reasons.push('Limite de risco/circuit breaker bloqueia a operação');
  checks.trading_session = context.tradingSessionOpen === true;
  if (!checks.trading_session) reasons.push('Fora das sessões operacionais autorizadas no horário de Brasília');

  const approved = Object.values(checks).every(Boolean) && side !== null;
  if (!approved) return { action: 'HOLD', approved: false, reasons, checks, features };
  return {
    action: side!,
    approved: true,
    reasons: ['Setup validado pelos gates determinísticos da estratégia'],
    checks,
    entry: Number(features.entry),
    stopLoss: Number(features.stop),
    takeProfit: Number(features.target),
    riskReward: Number(features.riskReward),
    features,
  };
}

/** AI is a reviewer, never a signal generator or risk-policy owner. */
export function validateAIEntryReview(
  setup: PriceActionSetup,
  review: { decision?: string; direction?: string; confidence?: number; riskOverride?: unknown },
): { approved: boolean; reason: string } {
  if (!setup.approved || setup.action === 'HOLD') return { approved: false, reason: 'Nenhuma entrada válida foi gerada pela estratégia' };
  if (!['approve', 'approved', 'BUY', 'SELL'].includes(String(review.decision ?? '').toLowerCase()) &&
      !['BUY', 'SELL'].includes(String(review.decision ?? '').toUpperCase())) {
    return { approved: false, reason: 'IA não aprovou explicitamente o setup' };
  }
  const direction = String(review.direction ?? review.decision ?? '').toUpperCase();
  if (direction !== setup.action) return { approved: false, reason: 'Direção da IA diverge do sinal da estratégia' };
  // The strategy document has no numeric AI-confidence floor. Confidence is
  // descriptive; the reviewer must be valid and explicitly agree with the setup.
  if (!finite(review.confidence) || review.confidence <= 0 || review.confidence > 100) {
    return { approved: false, reason: 'Confiança da revisão IA ausente, inválida ou nula' };
  }
  if (review.riskOverride !== undefined) return { approved: false, reason: 'IA não pode substituir a política determinística de risco' };
  return { approved: true, reason: 'IA aprovou o sinal válido da estratégia' };
}

/** An AI may only tighten protection, never widen risk or remove a stop. */
export function validateAIStopAdjustment(
  side: TradeSide, currentStop: number, proposedStop: number, entryPrice: number,
): boolean {
  if (![currentStop, proposedStop, entryPrice].every(finite) || currentStop <= 0 || proposedStop <= 0) return false;
  if (side === 'BUY') return proposedStop >= currentStop && proposedStop < entryPrice;
  return proposedStop <= currentStop && proposedStop > entryPrice;
}
