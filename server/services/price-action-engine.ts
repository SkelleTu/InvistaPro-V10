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
  extraCostSpreadMultiplier?: number;
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

function trend(c: Candle[]): 'bullish' | 'bearish' | 'range' {
  if (c.length < 12) return 'range';
  const recent = c.slice(-20);
  const midpoint = Math.floor(recent.length / 2);
  const older = recent.slice(0, midpoint);
  const newer = recent.slice(midpoint);
  const olderHigh = Math.max(...older.map(x => x.high));
  const newerHigh = Math.max(...newer.map(x => x.high));
  const olderLow = Math.min(...older.map(x => x.low));
  const newerLow = Math.min(...newer.map(x => x.low));
  const first = recent[0].close;
  const last = recent[recent.length - 1].close;
  const move = (last - first) / Math.max(Math.abs(first), 1e-12);
  // Approximate confirmed HH/HL and LH/LL structure using separated swing windows,
  // with a minimum displacement to avoid classifying noise as a trend.
  const higherHighsHigherLows = newerHigh > olderHigh && newerLow > olderLow;
  const lowerHighsLowerLows = newerHigh < olderHigh && newerLow < olderLow;
  if (move > 0.002 && higherHighsHigherLows) return 'bullish';
  if (move < -0.002 && lowerHighsLowerLows) return 'bearish';
  return 'range';
}

export function hasRequiredStructuralConfluence(input: {
  bos: boolean; choch: boolean; fvg: boolean; sweep: boolean; orderBlock: boolean;
}): boolean {
  return (input.bos || input.choch) && (input.fvg || input.sweep || input.orderBlock);
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
function hasFvg(c: Candle[], side: TradeSide): boolean {
  const n = c.length;
  return side === 'BUY' ? c[n - 1].low > c[n - 3].high : c[n - 1].high < c[n - 3].low;
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
function nearStructureZone(c: Candle[], side: TradeSide): boolean {
  const last = c[c.length - 1];
  const prior = c.slice(-21, -1);
  if (prior.length < 10 || last.close === 0) return false;
  const zone = side === 'BUY' ? Math.min(...prior.map(x => x.low)) : Math.max(...prior.map(x => x.high));
  return Math.abs(last.close - zone) / Math.abs(last.close) <= 0.0025;
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
    if (!checks[`data_${tf}`]) reasons.push(`Dados insuficientes ou inválidos em ${tf}`);
  }
  const entryFrame: Candle[] | undefined = validCandles(frames.M5)
    ? frames.M5
    : validCandles(frames.M1) ? frames.M1 : undefined;
  checks.entry_data = entryFrame !== undefined;
  if (!checks.entry_data) reasons.push('Dados insuficientes em M5/M1 para confirmação de entrada');
  if (reasons.length) return { action: 'HOLD', approved: false, reasons, checks, features };

  const h4 = frames.H4;
  const h1 = frames.H1;
  const m15 = frames.M15;
  if (!validCandles(h4) || !validCandles(h1) || !validCandles(m15) || !validCandles(entryFrame)) {
    return {
      action: 'HOLD', approved: false,
      reasons: ['Dados de timeframe mudaram ou são inválidos durante a validação'],
      checks: { ...checks, data_integrity: false }, features
    };
  }
  const t4 = trend(h4), t1 = trend(h1);
  features.trendH4 = t4; features.trendH1 = t1;
  const aligned = t4 !== 'range' && t4 === t1;
  checks.trend_alignment = aligned;
  if (!aligned) reasons.push('Tendência H4/H1 desalinhada ou indefinida');

  const m15Trend = trend(m15);
  const entrySide = trigger(entryFrame);
  const side: TradeSide | null = entrySide && entrySide === (t4 === 'bullish' ? 'BUY' : 'SELL') ? entrySide : null;
  checks.entry_trigger = side !== null;
  if (!side) reasons.push('Sem gatilho M5/M1 confirmado na direção H4/H1');
  features.trendM15 = m15Trend;
  features.trigger = entrySide;
  checks.trend_m15_alignment = side !== null && m15Trend === (side === 'BUY' ? 'bullish' : 'bearish');
  if (!checks.trend_m15_alignment) reasons.push('Tendência M15 não confirma a direção H4/H1 e do gatilho');

  if (side) {
    // M15 defines the operating zone; M5/M1 supplies the final trigger and microstructure.
    const fvg = hasFvg(m15, side) || hasFvg(entryFrame, side);
    const sweep = liquiditySweep(m15, side) || liquiditySweep(entryFrame, side);
    const bos = breakOfStructure(m15, side) || breakOfStructure(entryFrame, side);
    const choch = changeOfCharacter(m15, side) || changeOfCharacter(entryFrame, side);
    const ob = orderBlockZone(m15, side) ?? orderBlockZone(entryFrame, side);
    const zoneNear = nearStructureZone(m15, side) || ob !== null || sweep;
    const volumes = entryFrame.slice(-21, -1).map(c => c.volume);
    const volumeOk = average(volumes) > 0 && entryFrame[entryFrame.length - 1].volume >= average(volumes);
    features.fvg = fvg; features.liquiditySweep = sweep; features.bos = bos; features.choch = choch;
    features.orderBlockValid = ob !== null; features.zoneNear = zoneNear;
    features.orderBlockLow = ob?.low ?? null; features.orderBlockHigh = ob?.high ?? null;
    features.volumeRatio = average(volumes) > 0 ? entryFrame[entryFrame.length - 1].volume / average(volumes) : null;
    checks.volume = volumeOk;
    // Require confluence, not a single isolated pattern: a structural break/shift
    // plus at least one independent liquidity/imbalance/order-block confirmation.
    checks.structure_confirmation = hasRequiredStructuralConfluence({
      bos, choch, fvg, sweep, orderBlock: ob !== null,
    });
    checks.valid_zone = zoneNear;
    if (!volumeOk) reasons.push('Volume do gatilho abaixo da referência histórica ou sem baseline válido');
    if (!checks.structure_confirmation) reasons.push('Confluência estrutural incompleta: exige BOS/CHoCH e pelo menos FVG, sweep ou Order Block válido');
    if (!zoneNear) reasons.push('Preço não está próximo de zona estrutural válida de oferta/demanda');

    const recent = entryFrame.slice(-21, -1);
    const entry = entryFrame[entryFrame.length - 1].close;
    const swingLow = Math.min(...recent.map(c => c.low));
    const swingHigh = Math.max(...recent.map(c => c.high));
    const averageRange = average(recent.map(c => c.high - c.low));
    const stopBuffer = Math.max(averageRange * 0.1, entry * 0.00005);
    const stop = side === 'BUY' ? swingLow - stopBuffer : swingHigh + stopBuffer;
    const risk = Math.abs(entry - stop);
    const costs = Math.max(0, context.estimatedRoundTripCost ?? 0);
    const targetDistance = risk * 2 + costs * 3;
    const target = side === 'BUY' ? entry + targetDistance : entry - targetDistance;
    const rr = risk > 0 ? (Math.abs(target - entry) - costs) / (risk + costs) : 0;
    features.entry = entry; features.stop = stop; features.target = target; features.riskReward = rr; features.estimatedRoundTripCost = costs; features.extraCostSpreadMultiplier = finite(context.extraCostSpreadMultiplier) ? context.extraCostSpreadMultiplier : null;
    features.stopBuffer = stopBuffer;
    checks.stop_direction = entry > 0 && (side === 'BUY' ? stop < entry : stop > entry);
    if (!checks.stop_direction) reasons.push('Stop estrutural está no lado incorreto da entrada');
    checks.risk_reward = risk > 0 && rr >= 2;
    if (!checks.risk_reward) reasons.push('Relação risco/retorno inferior a 1:2 após custos estimados');
    checks.stop_distance_limit = entry > 0 && risk > 0 && risk / entry <= 0.015;
    if (!checks.stop_distance_limit) reasons.push('Stop estrutural excede o limite máximo de 1,5% do preço; não será comprimido artificialmente.');
    checks.spread = finite(context.spread) && finite(context.maxSpread) && context.spread >= 0 && context.maxSpread > 0 && context.spread <= context.maxSpread;
    if (!checks.spread) reasons.push('Spread ausente, inválido ou acima do limite configurado');
    checks.costs = finite(context.estimatedRoundTripCost) && context.estimatedRoundTripCost > 0 && finite(context.extraCostSpreadMultiplier) && context.extraCostSpreadMultiplier >= 0;
    if (!checks.costs) reasons.push('Custos totais ou multiplicador de custo ausentes ou inválidos');
  } else {
    checks.volume = false; checks.structure_confirmation = false; checks.valid_zone = false; checks.risk_reward = false; checks.spread = false; checks.costs = false;
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
    action: side!, approved: true, reasons: ['Setup validado pelos gates determinísticos'],
    checks, entry: Number(features.entry), stopLoss: Number(features.stop),
    takeProfit: Number(features.target), riskReward: Number(features.riskReward), features,
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
  if (!finite(review.confidence) || review.confidence < 0.7 || review.confidence > 1) {
    return { approved: false, reason: 'Confiança da revisão IA inválida ou abaixo de 70%' };
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
