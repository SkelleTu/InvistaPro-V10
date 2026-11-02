/**
 * Deterministic, closed-candle Price Action engine for MT5.
 * Structure and execution gates are evaluated before any optional AI review.
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
  marketDataFresh?: boolean;
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

type Trend = 'bullish' | 'bearish' | 'range';
interface Pivot { index: number; price: number; }
interface Zone { low: number; high: number; index: number; }

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const validCandles = (value: unknown): value is Candle[] => {
  if (!Array.isArray(value) || value.length < 30) return false;
  let previousTime = -Infinity;
  for (const candle of value as Candle[]) {
    if (!candle || !finite(candle.time) || !finite(candle.open) || !finite(candle.high)
      || !finite(candle.low) || !finite(candle.close) || !finite(candle.volume)) return false;
    if (candle.time <= previousTime || candle.time <= 0) return false;
    if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0 || candle.volume < 0) return false;
    if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)
      || candle.high < candle.low) return false;
    previousTime = candle.time;
  }
  return true;
};

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function trueRange(candles: Candle[], index: number): number {
  const candle = candles[index];
  const previousClose = candles[index - 1]?.close ?? candle.close;
  return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
}
function atr(candles: Candle[], period = 14): number {
  const start = Math.max(1, candles.length - period);
  const ranges: number[] = [];
  for (let i = start; i < candles.length; i++) ranges.push(trueRange(candles, i));
  return average(ranges);
}

/** Confirmed pivots only: a pivot is unavailable until all right-hand candles have closed. */
function findPivots(candles: Candle[], wing = 2): { highs: Pivot[]; lows: Pivot[] } {
  const highs: Pivot[] = [];
  const lows: Pivot[] = [];
  for (let i = wing; i < candles.length - wing; i++) {
    const candidate = candles[i];
    const left = candles.slice(i - wing, i);
    const right = candles.slice(i + 1, i + wing + 1);
    if (left.every(c => candidate.high > c.high) && right.every(c => candidate.high >= c.high)) {
      highs.push({ index: i, price: candidate.high });
    }
    if (left.every(c => candidate.low < c.low) && right.every(c => candidate.low <= c.low)) {
      lows.push({ index: i, price: candidate.low });
    }
  }
  return { highs, lows };
}
function trend(candles: Candle[]): Trend {
  const { highs, lows } = findPivots(candles);
  if (highs.length < 2 || lows.length < 2) return 'range';
  const [previousHigh, latestHigh] = highs.slice(-2);
  const [previousLow, latestLow] = lows.slice(-2);
  const higherHigh = latestHigh.price > previousHigh.price;
  const higherLow = latestLow.price > previousLow.price;
  const lowerHigh = latestHigh.price < previousHigh.price;
  const lowerLow = latestLow.price < previousLow.price;
  if (higherHigh && higherLow && latestHigh.index > previousHigh.index && latestLow.index > previousLow.index) return 'bullish';
  if (lowerHigh && lowerLow && latestHigh.index > previousHigh.index && latestLow.index > previousLow.index) return 'bearish';
  return 'range';
}

function trigger(candles: Candle[]): TradeSide | null {
  if (candles.length < 3) return null;
  const prior = candles[candles.length - 3];
  const pattern = candles[candles.length - 2];
  const confirmation = candles[candles.length - 1];
  const range = pattern.high - pattern.low;
  if (range <= 0) return null;
  const body = Math.abs(pattern.close - pattern.open);
  const lowerWick = Math.min(pattern.open, pattern.close) - pattern.low;
  const upperWick = pattern.high - Math.max(pattern.open, pattern.close);
  const bullEngulf = pattern.close > pattern.open && prior.close < prior.open
    && pattern.open <= prior.close && pattern.close >= prior.open;
  const bearEngulf = pattern.close < pattern.open && prior.close > prior.open
    && pattern.open >= prior.close && pattern.close <= prior.open;
  const bullPin = lowerWick / range >= 0.55 && pattern.close > pattern.open && body / range >= 0.12;
  const bearPin = upperWick / range >= 0.55 && pattern.close < pattern.open && body / range >= 0.12;
  const insideBar = pattern.high < prior.high && pattern.low > prior.low;
  if ((bullEngulf || bullPin) && confirmation.close > pattern.high) return 'BUY';
  if ((bearEngulf || bearPin) && confirmation.close < pattern.low) return 'SELL';
  if (insideBar && confirmation.close > prior.high) return 'BUY';
  if (insideBar && confirmation.close < prior.low) return 'SELL';
  return null;
}

function findFvgRetest(candles: Candle[], side: TradeSide): Zone | null {
  const start = Math.max(2, candles.length - 16);
  const lastIndex = candles.length - 1;
  for (let i = lastIndex - 1; i >= start; i--) {
    const first = candles[i - 2];
    const third = candles[i];
    const zone = side === 'BUY'
      ? (third.low > first.high ? { low: first.high, high: third.low, index: i } : null)
      : (third.high < first.low ? { low: third.high, high: first.low, index: i } : null);
    if (!zone) continue;
    for (let j = i + 1; j <= lastIndex; j++) {
      const retest = candles[j];
      if (side === 'BUY' && retest.close < zone.low) break;
      if (side === 'SELL' && retest.close > zone.high) break;
      const touched = retest.low <= zone.high && retest.high >= zone.low;
      if (touched && j === lastIndex && (side === 'BUY' ? retest.close >= zone.low : retest.close <= zone.high)) return zone;
    }
  }
  return null;
}

/** Sweep candle must reclaim liquidity and the following closed candle must confirm displacement. */
function confirmedLiquiditySweep(candles: Candle[], side: TradeSide): boolean {
  if (candles.length < 12) return false;
  const confirmation = candles[candles.length - 1];
  const sweep = candles[candles.length - 2];
  const prior = candles.slice(-22, -2);
  if (prior.length < 8) return false;
  const priorHigh = Math.max(...prior.map(c => c.high));
  const priorLow = Math.min(...prior.map(c => c.low));
  return side === 'BUY'
    ? sweep.low < priorLow && sweep.close > priorLow && confirmation.close > sweep.high
    : sweep.high > priorHigh && sweep.close < priorHigh && confirmation.close < sweep.low;
}
function breakOfStructure(candles: Candle[], side: TradeSide): boolean {
  const closedBeforeLast = candles.slice(0, -1);
  const pivots = findPivots(closedBeforeLast);
  const last = candles[candles.length - 1];
  if (side === 'BUY') {
    const pivot = pivots.highs[pivots.highs.length - 1];
    return !!pivot && last.close > pivot.price;
  }
  const pivot = pivots.lows[pivots.lows.length - 1];
  return !!pivot && last.close < pivot.price;
}
function changeOfCharacter(candles: Candle[], side: TradeSide): boolean {
  if (candles.length < 35) return false;
  const previousTrend = trend(candles.slice(0, -8));
  const reversalBreak = breakOfStructure(candles, side);
  return reversalBreak && (side === 'BUY' ? previousTrend === 'bearish' : previousTrend === 'bullish');
}
function orderBlockRetest(candles: Candle[], side: TradeSide): Zone | null {
  if (candles.length < 20) return null;
  const lastIndex = candles.length - 1;
  const averageRange = atr(candles.slice(0, -1), 14);
  if (!(averageRange > 0)) return null;
  const pivots = findPivots(candles.slice(0, -3));
  const brokenLevel = side === 'BUY' ? pivots.highs[pivots.highs.length - 1]?.price : pivots.lows[pivots.lows.length - 1]?.price;
  if (!finite(brokenLevel)) return null;
  for (let i = lastIndex - 2; i >= Math.max(2, lastIndex - 12); i--) {
    const candidate = candles[i];
    const displacement = candles[i + 1];
    const opposite = side === 'BUY' ? candidate.close < candidate.open : candidate.close > candidate.open;
    const aligned = side === 'BUY' ? displacement.close > displacement.open : displacement.close < displacement.open;
    const body = Math.abs(displacement.close - displacement.open);
    const brokeStructure = side === 'BUY' ? displacement.close > brokenLevel : displacement.close < brokenLevel;
    if (!opposite || !aligned || body < averageRange * 1.5 || !brokeStructure) continue;
    const zone = { low: Math.min(candidate.open, candidate.close), high: Math.max(candidate.open, candidate.close), index: i };
    const retest = candles[lastIndex];
    const touched = retest.low <= zone.high && retest.high >= zone.low;
    const invalidated = side === 'BUY' ? retest.close < zone.low : retest.close > zone.high;
    if (touched && !invalidated) return zone;
  }
  return null;
}
function findClusteredStructureZone(candles: Candle[], side: TradeSide): (Zone & { reactions: number; center: number }) | null {
  const confirmed = candles.slice(0, -2);
  const pivots = findPivots(confirmed);
  const levels = (side === 'BUY' ? pivots.lows : pivots.highs).slice(-12);
  const volatility = atr(candles, 14);
  if (!(volatility > 0) || levels.length < 2) return null;
  const tolerance = volatility * 0.35;
  const current = candles[candles.length - 1].close;
  let best: { members: Pivot[]; distance: number } | null = null;
  for (const seed of levels) {
    const members = levels.filter(level => Math.abs(level.price - seed.price) <= tolerance);
    if (members.length < 2) continue;
    const center = average(members.map(member => member.price));
    const distance = Math.abs(current - center);
    if (!best || members.length > best.members.length || (members.length === best.members.length && distance < best.distance)) {
      best = { members, distance };
    }
  }
  if (!best || best.distance > volatility * 0.9) return null;
  const center = average(best.members.map(member => member.price));
  return {
    low: center - tolerance,
    high: center + tolerance,
    index: Math.max(...best.members.map(member => member.index)),
    reactions: best.members.length,
    center,
  };
}

function nearStructureZone(candles: Candle[], side: TradeSide): boolean {
  const volatility = atr(candles, 14);
  if (!(volatility > 0)) return false;
  const current = candles[candles.length - 1].close;
  const cluster = findClusteredStructureZone(candles, side);
  if (cluster) return current >= cluster.low - volatility * 0.2 && current <= cluster.high + volatility * 0.2;
  const pivots = findPivots(candles.slice(0, -2));
  const pivot = side === 'BUY' ? pivots.lows[pivots.lows.length - 1] : pivots.highs[pivots.highs.length - 1];
  return !!pivot && Math.abs(current - pivot.price) <= volatility * 0.75;
}
function nearestOpposingBarrier(candles: Candle[], side: TradeSide, entry: number): number | null {
  const pivots = findPivots(candles.slice(0, -2));
  const candidates = side === 'BUY'
    ? pivots.highs.map(p => p.price).filter(price => price > entry)
    : pivots.lows.map(p => p.price).filter(price => price < entry);
  if (!candidates.length) return null;
  return side === 'BUY' ? Math.min(...candidates) : Math.max(...candidates);
}

export function arePriceActionFramesFresh(
  frames: Partial<Record<Timeframe, Candle[]>>,
  now = Date.now(),
): boolean {
  const secondsByTimeframe: Record<Timeframe, number> = { H4: 14_400, H1: 3_600, M15: 900, M5: 300, M1: 60 };
  for (const timeframe of ['H4', 'H1', 'M15'] as const) {
    const values = frames[timeframe];
    if (!validCandles(values)) return false;
    const rawTime = values[values.length - 1].time;
    const timestampMs = rawTime < 10_000_000_000 ? rawTime * 1000 : rawTime;
    const ageMs = now - timestampMs;
    if (ageMs < -30_000 || ageMs > secondsByTimeframe[timeframe] * 2_000 + 120_000) return false;
  }
  const entryFrames = (['M5', 'M1'] as const).filter(timeframe => validCandles(frames[timeframe]));
  if (!entryFrames.length) return false;
  return entryFrames.some(timeframe => {
    const values = frames[timeframe]!;
    const rawTime = values[values.length - 1].time;
    const timestampMs = rawTime < 10_000_000_000 ? rawTime * 1000 : rawTime;
    const ageMs = now - timestampMs;
    return ageMs >= -30_000 && ageMs <= secondsByTimeframe[timeframe] * 2_000 + 60_000;
  });
}

function hold(reasons: string[], checks: Record<string, boolean>, features: PriceActionSetup['features']): PriceActionSetup {
  return { action: 'HOLD', approved: false, reasons, checks, features };
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
    if (!checks[`data_${timeframe}`]) reasons.push(`Dados insuficientes, desordenados ou inválidos em ${timeframe}`);
  }
  const m5Valid = validCandles(frames.M5);
  const m1Valid = validCandles(frames.M1);
  checks.entry_data = m5Valid || m1Valid;
  if (!checks.entry_data) reasons.push('Dados insuficientes em M5/M1 para confirmação de entrada');
  if (reasons.length) return hold(reasons, checks, features);

  const h4 = frames.H4!;
  const h1 = frames.H1!;
  const m15 = frames.M15!;
  const t4 = trend(h4);
  const t1 = trend(h1);
  features.trendH4 = t4;
  features.trendH1 = t1;
  checks.trend_alignment = t4 !== 'range' && t4 === t1;
  if (!checks.trend_alignment) reasons.push('Estrutura HH/HL ou LH/LL não confirmada/alinhada em H4 e H1');

  const expectedSide: TradeSide | null = t4 === 'bullish' ? 'BUY' : t4 === 'bearish' ? 'SELL' : null;
  const m15Trend = trend(m15);
  features.trendM15 = m15Trend;
  const m5Trigger = m5Valid ? trigger(frames.M5!) : null;
  const m1Trigger = m1Valid ? trigger(frames.M1!) : null;
  const entryFrame: Candle[] | undefined = expectedSide && m5Trigger === expectedSide
    ? frames.M5
    : expectedSide && m1Trigger === expectedSide ? frames.M1
    : m5Valid ? frames.M5 : m1Valid ? frames.M1 : undefined;
  const entryTrigger = entryFrame ? trigger(entryFrame) : null;
  const side: TradeSide | null = expectedSide && entryTrigger === expectedSide ? expectedSide : null;
  features.trigger = entryTrigger;
  features.entryTimeframe = entryFrame === frames.M1 ? 'M1' : 'M5';
  checks.entry_trigger = side !== null;
  if (!checks.entry_trigger) reasons.push('Sem padrão M5/M1 confirmado por rompimento de gatilho na direção da estrutura H4/H1');
  checks.trend_m15_alignment = side !== null && m15Trend === (side === 'BUY' ? 'bullish' : 'bearish');
  if (!checks.trend_m15_alignment) reasons.push('Estrutura M15 não confirma a direção operacional');

  if (side && entryFrame) {
    const fvgZone = findFvgRetest(m15, side) ?? findFvgRetest(entryFrame, side);
    const sweep = confirmedLiquiditySweep(m15, side) || confirmedLiquiditySweep(entryFrame, side);
    const bos = breakOfStructure(m15, side) || breakOfStructure(entryFrame, side);
    const choch = changeOfCharacter(m15, side) || changeOfCharacter(entryFrame, side);
    const obZone = orderBlockRetest(m15, side) ?? orderBlockRetest(entryFrame, side);
    const m15Cluster = findClusteredStructureZone(m15, side);
    const entryCluster = findClusteredStructureZone(entryFrame, side);
    const zoneNear = nearStructureZone(m15, side) || nearStructureZone(entryFrame, side) || !!fvgZone || !!obZone || sweep;
    const priorVolumes = entryFrame.slice(-21, -1).map(candle => candle.volume);
    const baselineVolume = average(priorVolumes);
    const latestVolume = entryFrame[entryFrame.length - 1].volume;
    const volumeOk = baselineVolume > 0 && latestVolume >= baselineVolume;
    features.fvgRetest = !!fvgZone;
    features.fvgLow = fvgZone?.low ?? null;
    features.fvgHigh = fvgZone?.high ?? null;
    features.liquiditySweepConfirmed = sweep;
    features.bos = bos;
    features.choch = choch;
    features.orderBlockRetest = !!obZone;
    features.orderBlockLow = obZone?.low ?? null;
    features.orderBlockHigh = obZone?.high ?? null;
    features.zoneNear = zoneNear;
    features.supportResistanceClusterReactions = Math.max(m15Cluster?.reactions ?? 0, entryCluster?.reactions ?? 0);
    features.supportResistanceZoneLow = m15Cluster?.low ?? entryCluster?.low ?? null;
    features.supportResistanceZoneHigh = m15Cluster?.high ?? entryCluster?.high ?? null;
    features.volumeRatio = baselineVolume > 0 ? latestVolume / baselineVolume : null;
    checks.volume = volumeOk;
    checks.structure_confirmation = !!fvgZone || sweep || bos || choch || !!obZone;
    checks.valid_zone = zoneNear;
    if (!volumeOk) reasons.push('Volume relativo do candle de confirmação abaixo da média das 20 barras fechadas');
    if (!checks.structure_confirmation) reasons.push('Sem FVG retestado, sweep confirmado, BOS/CHoCH ou Order Block retestado');
    if (!zoneNear) reasons.push('Preço distante de zona estrutural dinâmica de oferta/demanda');

    const entry = entryFrame[entryFrame.length - 1].close;
    const pivots = findPivots(entryFrame.slice(0, -2));
    const stopPivot = side === 'BUY'
      ? [...pivots.lows].reverse().find(pivot => pivot.price < entry)
      : [...pivots.highs].reverse().find(pivot => pivot.price > entry);
    const volatility = atr(entryFrame, 14);
    const stopBuffer = Math.max(volatility * 0.15, entry * 0.00005);
    const stop = stopPivot
      ? (side === 'BUY' ? stopPivot.price - stopBuffer : stopPivot.price + stopBuffer)
      : 0;
    const risk = Math.abs(entry - stop);
    const costs = context.estimatedRoundTripCost ?? Number.NaN;
    const costsValid = finite(costs) && costs >= 0;
    const minimumTargetDistance = costsValid ? risk * 2.1 + costs * 3.1 : Number.POSITIVE_INFINITY;
    const barrier = nearestOpposingBarrier(m15, side, entry) ?? nearestOpposingBarrier(entryFrame, side, entry);
    const barrierRoom = barrier === null ? Number.POSITIVE_INFINITY : Math.abs(barrier - entry);
    const targetDistance = Math.min(minimumTargetDistance, barrierRoom - volatility * 0.1);
    const target = side === 'BUY' ? entry + targetDistance : entry - targetDistance;
    const rr = risk > 0 && costsValid ? (targetDistance - costs) / (risk + costs) : 0;
    features.entry = entry;
    features.stop = stop;
    features.target = target;
    features.stopBuffer = stopBuffer;
    features.nearestOpposingBarrier = barrier;
    features.roomToBarrier = barrier === null ? null : barrierRoom;
    features.riskReward = rr;
    checks.stop_direction = !!stopPivot && entry > 0 && risk > 0 && (side === 'BUY' ? stop < entry : stop > entry);
    if (!checks.stop_direction) reasons.push('Não existe pivô estrutural confirmado para posicionar o stop sem adivinhação');
    checks.risk_reward = costsValid && risk > 0 && targetDistance > 0 && rr >= 2;
    if (!checks.risk_reward) reasons.push('Espaço até a barreira estrutural não permite R:R mínimo de 1:2 após custos');
    checks.stop_distance_limit = entry > 0 && risk > 0 && risk / entry <= 0.015;
    if (!checks.stop_distance_limit) reasons.push('Stop estrutural excede 1,5% do preço; stop não será comprimido artificialmente');
    checks.spread = finite(context.spread) && finite(context.maxSpread) && context.spread >= 0
      && context.maxSpread > 0 && context.spread <= context.maxSpread;
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
    checks.spread = false;
    checks.costs = finite(context.estimatedRoundTripCost) && context.estimatedRoundTripCost >= 0;
  }

  checks.news_clear = context.highImpactNewsBlocked === false;
  if (!checks.news_clear) reasons.push('Notícia de alto impacto bloqueada ou feed não validado');
  checks.risk_limit = context.riskLimitOk === true;
  if (!checks.risk_limit) reasons.push('Limite de risco/circuit breaker bloqueia a operação');
  checks.trading_session = context.tradingSessionOpen === true;
  if (!checks.trading_session) reasons.push('Fora das sessões operacionais autorizadas no horário de Brasília');
  checks.market_data_fresh = context.marketDataFresh === true;
  if (!checks.market_data_fresh) reasons.push('Dados de mercado não foram confirmados como recentes');

  const approved = Object.values(checks).every(Boolean) && side !== null;
  if (!approved) return hold(reasons, checks, features);
  return {
    action: side!,
    approved: true,
    reasons: ['Setup confirmado por estrutura, zona, gatilho, volume e gates de execução'],
    checks,
    entry: Number(features.entry),
    stopLoss: Number(features.stop),
    takeProfit: Number(features.target),
    riskReward: Number(features.riskReward),
    features,
  };
}

/** AI is a reviewer only. It cannot invent, reverse, or increase risk on a strategy signal. */
export function validateAIEntryReview(
  setup: PriceActionSetup,
  review: { decision?: string; direction?: string; confidence?: number; riskOverride?: unknown },
): { approved: boolean; reason: string } {
  if (!setup.approved || setup.action === 'HOLD') return { approved: false, reason: 'A estratégia não gerou uma entrada válida' };
  const decision = String(review.decision ?? '').trim().toUpperCase();
  if (!['APPROVE', 'APPROVED', setup.action].includes(decision)) return { approved: false, reason: 'IA não aprovou explicitamente o setup' };
  const direction = String(review.direction ?? setup.action).trim().toUpperCase();
  if (direction !== setup.action) return { approved: false, reason: 'Direção da IA diverge da estratégia' };
  if (!finite(review.confidence) || review.confidence < 0.7 || review.confidence > 1) {
    return { approved: false, reason: 'Confiança da revisão IA inválida ou abaixo de 70%' };
  }
  if (review.riskOverride !== undefined) return { approved: false, reason: 'IA não pode substituir a política determinística de risco' };
  return { approved: true, reason: 'IA aprovou o setup sem alterar direção ou risco' };
}

export function validateAIStopAdjustment(side: TradeSide, currentStop: number, proposedStop: number, entryPrice: number): boolean {
  if (![currentStop, proposedStop, entryPrice].every(finite) || currentStop <= 0 || proposedStop <= 0 || entryPrice <= 0) return false;
  return side === 'BUY'
    ? proposedStop >= currentStop && proposedStop < entryPrice
    : proposedStop <= currentStop && proposedStop > entryPrice;
}
