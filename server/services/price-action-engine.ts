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

type MarketTrend = 'bullish' | 'bearish' | 'range';
type PivotKind = 'high' | 'low';
interface Pivot { index: number; price: number }
interface PriceZone { low: number; high: number; touches: number }

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

/** Trend is classified from confirmed HH/HL or LH/LL structure, not candle-by-candle monotonicity. */
function trend(c: Candle[]): MarketTrend {
  const sample = c.slice(-60);
  const highs = pivots(sample, 'high');
  const lows = pivots(sample, 'low');
  if (highs.length < 2 || lows.length < 2) return 'range';
  const [oldHigh, lastHigh] = highs.slice(-2);
  const [oldLow, lastLow] = lows.slice(-2);
  if (lastHigh.price > oldHigh.price && lastLow.price > oldLow.price) return 'bullish';
  if (lastHigh.price < oldHigh.price && lastLow.price < oldLow.price) return 'bearish';
  return 'range';
}

function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function averageRange(c: Candle[]): number {
  return average(c.slice(-21, -1).map(x => x.high - x.low));
}

/** Group nearby confirmed pivots into zones; isolated levels do not count as repeated support/resistance. */
function repeatedStructureZone(c: Candle[], kind: PivotKind, price: number): PriceZone | null {
  const tolerance = Math.max(averageRange(c) * 0.25, Math.abs(price) * 0.00005);
  const levels = pivots(c.slice(0, -1), kind).map(p => p.price);
  const clusters: number[][] = [];
  for (const level of levels) {
    const cluster = clusters.find(items => Math.abs(average(items) - level) <= tolerance);
    if (cluster) cluster.push(level); else clusters.push([level]);
  }
  const valid = clusters.filter(items => items.length >= 2).map(items => ({
    low: Math.min(...items) - tolerance,
    high: Math.max(...items) + tolerance,
    touches: items.length,
  }));
  const near = valid.filter(zone => price >= zone.low - tolerance && price <= zone.high + tolerance);
  return near.sort((a, b) =>
    Math.abs(price - (a.low + a.high) / 2) - Math.abs(price - (b.low + b.high) / 2))[0] ?? null;
}

/** An FVG is valid only when a three-candle gap exists and price has returned to that zone. */
function fairValueGapZone(c: Candle[], side: TradeSide, price: number): PriceZone | null {
  const sample = c.slice(-40);
  const impulseFloor = averageRange(sample) * 0.5;
  const tolerance = Math.max(averageRange(sample) * 0.2, Math.abs(price) * 0.00005);
  for (let i = sample.length - 1; i >= 2; i--) {
    const first = sample[i - 2], middle = sample[i - 1], third = sample[i];
    if (Math.abs(middle.close - middle.open) < impulseFloor) continue;
    const low = side === 'BUY' ? first.high : third.high;
    const high = side === 'BUY' ? third.low : first.low;
    const isGap = side === 'BUY' ? third.low > first.high : third.high < first.low;
    if (!isGap || high <= low) continue;
    if (price >= low - tolerance && price <= high + tolerance) return { low, high, touches: 1 };
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
function orderBlockZone(c: Candle[], side: TradeSide): { low: number; high: number } | null {
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
    if (last.close >= low - tolerance && last.close <= high + tolerance) return { low, high };
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
  const required: Timeframe[] = ['H4', 'H1', 'M15'];
  for (const tf of required) {
    checks[`data_${tf}`] = validCandles(frames[tf]);
    if (!checks[`data_${tf}`]) reasons.push(`Dados insuficientes, desordenados ou inválidos em ${tf}`);
  }
  const validM5 = validCandles(frames.M5) ? frames.M5 : undefined;
  const validM1 = validCandles(frames.M1) ? frames.M1 : undefined;
  const entryOptions: Candle[][] = [validM5, validM1].filter((frame): frame is Candle[] => frame !== undefined);
  let entryCandles: Candle[] | undefined = entryOptions[0];
  checks.entry_data = entryOptions.length > 0;
  if (!checks.entry_data) reasons.push('Dados insuficientes, desordenados ou inválidos em M5/M1');
  if (reasons.length) return { action: 'HOLD', approved: false, reasons, checks, features };

  const h4 = frames.H4!;
  const h1 = frames.H1!;
  const m15 = frames.M15!;
  const entryCandles = entryFrame!;
  const t4 = trend(h4), t1 = trend(h1), m15Trend = trend(m15);
  features.trendH4 = t4;
  features.trendH1 = t1;
  features.trendM15 = m15Trend;

  const directionalMode = t4 !== 'range' && t4 === t1;
  const rangeMode = t4 === 'range' && t1 === 'range';
  checks.trend_alignment = directionalMode || rangeMode;
  features.marketMode = rangeMode ? 'range' : directionalMode ? t4 : 'conflict';
  if (!checks.trend_alignment) reasons.push('Tendências H4/H1 em conflito; operação bloqueada');

  checks.m15_alignment = rangeMode
    ? m15Trend === 'range'
    : directionalMode && (m15Trend === 'range' || m15Trend === t4);
  if (!checks.m15_alignment) reasons.push('Estrutura de 15M conflita com a direção principal ou não confirma o range');

  let entrySide = trigger(entryCandles!);
  let entry = entryCandles![entryCandles!.length - 1].close;
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
    const supportResistance = repeatedStructureZone(m15, side === 'BUY' ? 'low' : 'high', entry);
    const fvgZone = fairValueGapZone(m15, side, entry) ?? fairValueGapZone(entryCandles, side, entry);
    const sweep = liquiditySweep(m15, side) || liquiditySweep(entryCandles, side);
    const bos = breakOfStructure(m15, side) || breakOfStructure(entryCandles, side);
    const choch = changeOfCharacter(m15, side) || changeOfCharacter(entryCandles, side);
    const ob = orderBlockZone(m15, side) ?? orderBlockZone(entryCandles, side);
    const rangeEdgeQualified = rangeMode && side !== null;
    const zoneNear = rangeEdgeQualified || supportResistance !== null || fvgZone !== null || ob !== null || sweep;

    const volumes = entryCandles.slice(-21, -1).map(c => c.volume);
    const volumeBaseline = average(volumes);
    const triggerVolume = entryCandles[entryCandles.length - 1].volume;
    const volumeOk = volumeBaseline > 0 && triggerVolume > volumeBaseline;
    features.fvg = fvgZone !== null;
    features.fvgLow = fvgZone?.low ?? null;
    features.fvgHigh = fvgZone?.high ?? null;
    features.liquiditySweep = sweep;
    features.bos = bos;
    features.choch = choch;
    features.orderBlockValid = ob !== null;
    features.orderBlockLow = ob?.low ?? null;
    features.orderBlockHigh = ob?.high ?? null;
    features.supportResistanceZone = supportResistance !== null;
    features.supportResistanceTouches = supportResistance?.touches ?? 0;
    features.rangeEdgeQualified = rangeEdgeQualified;
    features.zoneNear = zoneNear;
    features.volumeBaseline = volumeBaseline;
    features.volumeRatio = volumeBaseline > 0 ? triggerVolume / volumeBaseline : null;

    checks.volume = volumeOk;
    // A trend alone is not a confirmation pattern; the zone and trigger are independently mandatory.
    checks.structure_confirmation = fvgZone !== null || sweep || bos || choch || ob !== null;
    checks.valid_zone = zoneNear;
    if (!volumeOk) reasons.push('Volume do gatilho não superou a média das 20 velas fechadas anteriores');
    if (!checks.structure_confirmation) reasons.push('Sem FVG válido, varredura de liquidez, BOS, CHoCH ou Order Block');
    if (!zoneNear) reasons.push('Preço fora de zona válida de suporte/resistência, FVG, Order Block ou liquidez');

    const recent = entryCandles.slice(-21, -1);
    const swingLow = Math.min(...recent.map(c => c.low));
    const swingHigh = Math.max(...recent.map(c => c.high));
    const averageCandleRange = average(recent.map(c => c.high - c.low));
    const stopBuffer = Math.max(averageCandleRange * 0.1, entry * 0.00005);
    const stop = side === 'BUY' ? swingLow - stopBuffer : swingHigh + stopBuffer;
    const risk = Math.abs(entry - stop);
    const costsCandidate = context.estimatedRoundTripCost;
    const costsValid = finite(costsCandidate) && costsCandidate >= 0;
    const costs = costsValid ? costsCandidate as number : 0;
    const targetDistance = risk * 2 + costs * 3;
    const target = side === 'BUY' ? entry + targetDistance : entry - targetDistance;
    const rr = risk > 0 && costsValid ? (Math.abs(target - entry) - costs) / (risk + costs) : 0;
    const barrierDistance = nearestBarrierDistance([h4, h1, m15], side, entry);

    features.entry = entry;
    features.stop = stop;
    features.target = target;
    features.riskReward = rr;
    features.stopBuffer = stopBuffer;
    features.nearestBarrierDistance = barrierDistance;

    checks.stop_direction = entry > 0 && (side === 'BUY' ? stop < entry : stop > entry);
    if (!checks.stop_direction) reasons.push('Stop estrutural está no lado incorreto da entrada');

    checks.risk_reward = risk > 0 && rr >= 2;
    if (!checks.risk_reward) reasons.push('Relação risco/retorno inferior a 1:2 após custos estimados');

    checks.stop_distance_limit = entry > 0 && risk > 0 && risk / entry <= 0.015;
    if (!checks.stop_distance_limit) reasons.push('Stop estrutural excede 1,5%; o stop não será comprimido artificialmente');

    checks.space = barrierDistance === null || barrierDistance > targetDistance;
    if (!checks.space) reasons.push('A próxima barreira estrutural não deixa espaço suficiente para o alvo planejado');

    checks.spread = finite(context.spread) && finite(context.maxSpread) && context.spread >= 0 &&
      context.maxSpread > 0 && context.spread <= context.maxSpread;
    if (!checks.spread) reasons.push('Spread ausente, inválido ou acima do limite configurado');

    checks.costs = costsValid;
    if (!checks.costs) reasons.push('Custos totais estimados ausentes ou inválidos');
  } else {
    checks.volume = false;
    checks.structure_confirmation = false;
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
  if (!approved) return { action: 'HOLD', approved: false, reasons, checks, features };
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
