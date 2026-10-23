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
  v.every(c => c && finite(c.time) && finite(c.open) && finite(c.high) && finite(c.low) &&
    finite(c.close) && finite(c.volume) && c.high >= Math.max(c.open, c.close) &&
    c.low <= Math.min(c.open, c.close) && c.high >= c.low && c.volume >= 0);

function trend(c: Candle[]): 'bullish' | 'bearish' | 'range' {
  const recent = c.slice(-20);
  const first = recent[0].close;
  const last = recent[recent.length - 1].close;
  const highs = recent.map(x => x.high), lows = recent.map(x => x.low);
  const higher = highs.slice(-5).every((v, i, a) => i === 0 || v >= a[i - 1]) &&
    lows.slice(-5).every((v, i, a) => i === 0 || v >= a[i - 1]);
  const lower = highs.slice(-5).every((v, i, a) => i === 0 || v <= a[i - 1]) &&
    lows.slice(-5).every((v, i, a) => i === 0 || v <= a[i - 1]);
  const move = (last - first) / Math.max(Math.abs(first), 1e-12);
  if (move > 0.002 && (higher || move > 0.008)) return 'bullish';
  if (move < -0.002 && (lower || move < -0.008)) return 'bearish';
  return 'range';
}
function average(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
function trigger(c: Candle[]): TradeSide | null {
  const a = c[c.length - 2], b = c[c.length - 1];
  const body = Math.abs(b.close - b.open);
  const range = Math.max(b.high - b.low, 1e-12);
  const lowerWick = Math.min(b.open, b.close) - b.low;
  const upperWick = b.high - Math.max(b.open, b.close);
  const bullEngulf = b.close > b.open && a.close < a.open && b.open <= a.close && b.close >= a.open;
  const bearEngulf = b.close < b.open && a.close > a.open && b.open >= a.close && b.close <= a.open;
  if (bullEngulf || (lowerWick / range >= 0.55 && b.close > b.open && body / range >= 0.12)) return 'BUY';
  if (bearEngulf || (upperWick / range >= 0.55 && b.close < b.open && body / range >= 0.12)) return 'SELL';
  return null;
}
function hasFvg(c: Candle[], side: TradeSide): boolean {
  const n = c.length;
  return side === 'BUY' ? c[n - 1].low > c[n - 3].high : c[n - 1].high < c[n - 3].low;
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
  const entryFrame = validCandles(frames.M5) ? frames.M5 : frames.M1;
  checks.entry_data = validCandles(entryFrame);
  if (!checks.entry_data) reasons.push('Dados insuficientes em M5/M1 para confirmação de entrada');
  if (reasons.length) return { action: 'HOLD', approved: false, reasons, checks, features };

  const h4 = frames.H4!, h1 = frames.H1!, m15 = frames.M15!;
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

  if (side) {
    const fvg = hasFvg(entryFrame, side);
    const sweep = liquiditySweep(entryFrame, side);
    const volumes = entryFrame.slice(-21, -1).map(c => c.volume);
    const volumeOk = entryFrame[entryFrame.length - 1].volume >= average(volumes);
    features.fvg = fvg; features.liquiditySweep = sweep; features.volumeRatio =
      average(volumes) > 0 ? entryFrame[entryFrame.length - 1].volume / average(volumes) : null;
    checks.volume = volumeOk;
    // A setup needs at least one additional market-structure confirmation, not a pattern alone.
    checks.structure_confirmation = fvg || sweep || m15Trend === side.toLowerCase().replace('buy','bullish').replace('sell','bearish');
    if (!volumeOk) reasons.push('Volume do gatilho abaixo da referência histórica');
    if (!checks.structure_confirmation) reasons.push('Sem FVG, sweep de liquidez ou alinhamento estrutural M15');

    const recent = entryFrame.slice(-21, -1);
    const entry = entryFrame[entryFrame.length - 1].close;
    const swingLow = Math.min(...recent.map(c => c.low));
    const swingHigh = Math.max(...recent.map(c => c.high));
    const stop = side === 'BUY' ? swingLow : swingHigh;
    const risk = Math.abs(entry - stop);
    const costs = Math.max(0, context.estimatedRoundTripCost ?? 0);
    const targetDistance = risk * 2 + costs * 2;
    const target = side === 'BUY' ? entry + targetDistance : entry - targetDistance;
    const rr = risk > 0 ? Math.abs(target - entry) / (risk + costs) : 0;
    features.entry = entry; features.stop = stop; features.target = target; features.riskReward = rr;
    checks.risk_reward = risk > 0 && rr >= 2;
    if (!checks.risk_reward) reasons.push('Relação risco/retorno inferior a 1:2 após custos estimados');
    checks.spread = finite(context.spread) && finite(context.maxSpread) && context.spread >= 0 && context.maxSpread > 0 && context.spread <= context.maxSpread;
    if (!checks.spread) reasons.push('Spread ausente, inválido ou acima do limite configurado');
    checks.costs = finite(context.estimatedRoundTripCost) && context.estimatedRoundTripCost >= 0;
    if (!checks.costs) reasons.push('Custos totais estimados ausentes ou inválidos');
  } else {
    checks.volume = false; checks.structure_confirmation = false; checks.risk_reward = false; checks.spread = false; checks.costs = false;
  }
  checks.news_clear = context.highImpactNewsBlocked === false;
  if (!checks.news_clear) reasons.push('Janela de notícia de alto impacto bloqueada');
  checks.risk_limit = context.riskLimitOk === true;
  if (!checks.risk_limit) reasons.push('Limite de risco/circuit breaker bloqueia a operação');

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
