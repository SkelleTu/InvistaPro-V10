import fetch from 'node-fetch';
import type { MT5Config, MT5Status } from './metatrader-bridge';
import type { Candle, MarketContext } from './price-action-engine';

export interface EconomicCalendarEvent {
  title?: unknown;
  country?: unknown;
  impact?: unknown;
  date?: unknown;
  timestamp?: unknown;
}

export interface NewsWindowResult {
  blocked: boolean;
  valid: boolean;
  reason: string;
  sourceUpdatedAt?: number;
  nextEventAt?: number;
}

const CALENDAR_URL = process.env.MT5_ECONOMIC_CALENDAR_URL?.trim()
  || 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const CALENDAR_CACHE_TTL_MS = 5 * 60_000;
const CALENDAR_MAX_STALE_MS = 10 * 60_000;
const NEWS_WINDOW_MS = 30 * 60_000;
let calendarCache: { events: EconomicCalendarEvent[]; fetchedAt: number } | null = null;
let calendarFetch: Promise<{ events: EconomicCalendarEvent[]; fetchedAt: number }> | null = null;
let calendarFailure: { failedAt: number; message: string } | null = null;

function eventTimestamp(event: EconomicCalendarEvent): number | null {
  if (typeof event.timestamp === 'number' && Number.isFinite(event.timestamp)) {
    return event.timestamp < 10_000_000_000 ? event.timestamp * 1000 : event.timestamp;
  }
  if (typeof event.date !== 'string') return null;
  const date = event.date.trim();
  // Calendar event times without an explicit timezone are ambiguous and must not be guessed.
  if (!/(Z|[+-]\d{2}:?\d{2})$/i.test(date)) return null;
  const timestamp = Date.parse(date);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function evaluateEconomicNewsWindow(
  events: EconomicCalendarEvent[],
  now = Date.now(),
  windowMs = NEWS_WINDOW_MS,
): NewsWindowResult {
  if (!Array.isArray(events) || events.length === 0) {
    return { blocked: true, valid: false, reason: 'Calendário econômico vazio ou inválido; entradas bloqueadas por segurança.' };
  }

  const highImpactEvents = events.filter(event =>
    String(event.impact ?? '').trim().toLowerCase() === 'high',
  );
  let nextEventAt: number | undefined;
  for (const event of highImpactEvents) {
    const timestamp = eventTimestamp(event);
    if (timestamp === null) {
      return {
        blocked: true,
        valid: false,
        reason: 'Evento de alto impacto sem horário/timezone verificável; entradas bloqueadas.',
      };
    }
    if (timestamp >= now && (nextEventAt === undefined || timestamp < nextEventAt)) nextEventAt = timestamp;
    if (Math.abs(timestamp - now) <= windowMs) {
      return {
        blocked: true,
        valid: true,
        reason: 'Janela de notícia de alto impacto: ' + String(event.title ?? 'evento econômico') + '.',
        nextEventAt: timestamp,
      };
    }
  }

  return {
    blocked: false,
    valid: true,
    reason: 'Calendário econômico válido; nenhuma notícia de alto impacto na janela de bloqueio.',
    nextEventAt,
  };
}

async function loadCalendar(now = Date.now()): Promise<{ events: EconomicCalendarEvent[]; fetchedAt: number }> {
  if (calendarCache && now - calendarCache.fetchedAt <= CALENDAR_CACHE_TTL_MS) return calendarCache;
  if (calendarFailure && now - calendarFailure.failedAt < 30_000) {
    if (calendarCache && now - calendarCache.fetchedAt <= CALENDAR_MAX_STALE_MS) return calendarCache;
    throw new Error(calendarFailure.message);
  }
  if (calendarFetch) return calendarFetch;
  calendarFetch = (async () => {
    const response = await fetch(CALENDAR_URL, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Calendário econômico HTTP ' + response.status);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload) || payload.length === 0) throw new Error('Formato do calendário econômico inválido');
    const events = payload as EconomicCalendarEvent[];
    if (!events.some(event => typeof event.country === 'string' && typeof event.impact === 'string')) {
      throw new Error('Calendário econômico sem campos de país/impacto');
    }
    const currentTime = Date.now();
    const hasCurrentWindow = events.some(event => {
      const timestamp = eventTimestamp(event);
      return timestamp !== null && timestamp >= currentTime - 7 * 24 * 60 * 60_000
        && timestamp <= currentTime + 7 * 24 * 60 * 60_000;
    });
    if (!hasCurrentWindow) throw new Error('Calendário econômico não contém eventos da semana atual');
    const cached = { events, fetchedAt: Date.now() };
    calendarCache = cached;
    calendarFailure = null;
    return cached;
  })();
  try {
    return await calendarFetch;
  } catch (error) {
    calendarFailure = {
      failedAt: Date.now(),
      message: error instanceof Error ? error.message : 'Falha desconhecida no calendário econômico',
    };
    if (calendarCache && now - calendarCache.fetchedAt <= CALENDAR_MAX_STALE_MS) return calendarCache;
    throw error;
  } finally {
    calendarFetch = null;
  }
}

export async function getHighImpactNewsStatus(now = Date.now()): Promise<NewsWindowResult> {
  try {
    const calendar = await loadCalendar(now);
    const result = evaluateEconomicNewsWindow(calendar.events, now);
    if (now - calendar.fetchedAt > CALENDAR_MAX_STALE_MS) {
      return { blocked: true, valid: false, reason: 'Calendário econômico desatualizado; entradas bloqueadas.' };
    }
    return { ...result, sourceUpdatedAt: calendar.fetchedAt };
  } catch (error) {
    return {
      blocked: true,
      valid: false,
      reason: 'Calendário econômico indisponível (' + (error instanceof Error ? error.message : 'erro desconhecido') + '); entradas bloqueadas.',
    };
  }
}

export function isAllowedBrasiliaTradingSession(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  const minute = Number(parts.find(part => part.type === 'minute')?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false;
  const time = hour * 60 + minute;
  return (time >= 4 * 60 && time < 7 * 60)
    || (time >= 9 * 60 + 30 && time < 12 * 60)
    || (time >= 14 * 60 && time < 17 * 60);
}

export function assessMt5RiskLimit(input: {
  config: MT5Config;
  status: MT5Status;
  observedAccountType: 'demo' | 'real' | 'contest' | null;
  accountHeartbeatAt: number;
  realTradingExplicitlyEnabled?: boolean;
  now?: number;
}): { ok: boolean; reasons: string[] } {
  const now = input.now ?? Date.now();
  const { config, status } = input;
  const reasons: string[] = [];
  if (!config.enabled) reasons.push('MT5 desativado no servidor');
  const demoConfirmed = config.accountType === 'demo' && input.observedAccountType === 'demo';
  const realConfirmed = config.accountType === 'real' && input.observedAccountType === 'real'
    && input.realTradingExplicitlyEnabled === true;
  if (!demoConfirmed && !realConfirmed) reasons.push('A conta MT5 não está confirmada no modo selecionado ou REAL não foi explicitamente autorizado');
  if (!input.accountHeartbeatAt || now - input.accountHeartbeatAt > 90_000) reasons.push('Heartbeat real da conta MT5 ausente ou desatualizado');
  if (!status.lastEquity || !Number.isFinite(status.lastEquity) || status.lastEquity <= 0) reasons.push('Equity real da conta indisponível');
  if (!Number.isFinite(config.riskPercent) || config.riskPercent < 1 || config.riskPercent > 2) reasons.push('Risco por operação fora do intervalo permitido de 1% a 2%');
  const unrealizedDrawdown = status.lastBalance && status.lastEquity
    ? Math.max(0, status.lastBalance - status.lastEquity)
    : Number.POSITIVE_INFINITY;
  const effectiveDailyLoss = Number.isFinite(status.dailyLoss) ? status.dailyLoss + unrealizedDrawdown : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(config.maxDailyLoss) || config.maxDailyLoss <= 0 || effectiveDailyLoss >= config.maxDailyLoss) reasons.push('Limite diário de perda atingido, inválido ou incluindo drawdown aberto');
  if (!Number.isFinite(config.maxDailyProfit) || config.maxDailyProfit <= 0
    || !Number.isFinite(status.dailyProfit) || status.dailyProfit < 0 || status.dailyProfit >= config.maxDailyProfit) reasons.push('Meta/limite diário de lucro atingido, indisponível ou inválido');
  if (status.circuitBreakerActive) reasons.push('Circuit breaker ativo');
  if (!Number.isFinite(config.maxOpenPositions) || config.maxOpenPositions < 1
    || !Number.isFinite(status.openPositions) || status.openPositions < 0
    || status.openPositions >= config.maxOpenPositions) reasons.push('Limite de posições abertas atingido, indisponível ou inválido');
  return { ok: reasons.length === 0, reasons };
}

function calculateAtr(candles: unknown): number | undefined {
  if (!Array.isArray(candles) || candles.length < 15) return undefined;
  const values = candles as Candle[];
  const recent = values.slice(-15);
  const ranges: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const current = recent[i];
    const previous = recent[i - 1];
    if (![current?.high, current?.low, previous?.close].every(value => typeof value === 'number' && Number.isFinite(value))
      || current.high < current.low) return undefined;
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    ));
  }
  const atr = ranges.slice(-14).reduce((sum, value) => sum + value, 0) / 14;
  return Number.isFinite(atr) && atr > 0 ? atr : undefined;
}

export function buildTrustedPriceActionContext(input: {
  bid: unknown;
  ask: unknown;
  entryPrice: unknown;
  m1Candles?: Candle[];
  m5Candles?: Candle[];
  riskLimitOk: boolean;
  newsBlocked: boolean;
  sessionOpen: boolean;
}): MarketContext {
  const bid = typeof input.bid === 'number' ? input.bid : Number.NaN;
  const ask = typeof input.ask === 'number' ? input.ask : Number.NaN;
  const entry = typeof input.entryPrice === 'number' ? input.entryPrice : Number.NaN;
  const pricesValid = Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask >= bid
    && Number.isFinite(entry) && entry > 0;
  const spread = pricesValid ? ask - bid : undefined;
  const mid = pricesValid ? (ask + bid) / 2 : undefined;
  const atrM1 = calculateAtr(input.m1Candles);
  const atrM5 = calculateAtr(input.m5Candles);
  // Match the EA's adaptive policy: both trigger and confirmation volatility must be available.
  // The tightest of the M1, M5 and price-based caps wins; missing ATR fails closed.
  const limits = mid !== undefined && atrM1 !== undefined && atrM5 !== undefined
    ? [atrM1 * 0.20, atrM5 * 0.08, mid * 0.001]
    : [];
  const maxSpread = limits.length ? Math.min(...limits) : undefined;
  // Spread is always observed automatically from the live MT5 bid/ask.
  // Configure only the additional cost as a multiplier of that live spread, not fixed price units.
  // Example: multiplier 1 means 2x spread for round-trip spread plus 1x spread as cost reserve.
  // Missing or invalid configuration blocks entries rather than silently ignoring commission/slippage.
  const extraCostMultiplierRaw = process.env.MT5_PRICE_ACTION_EXTRA_COST_SPREAD_MULTIPLIER;
  const extraCostMultiplier = extraCostMultiplierRaw !== undefined && extraCostMultiplierRaw.trim() !== ''
    ? Number(extraCostMultiplierRaw)
    : Number.NaN;
  const extraCostMultiplierValid = Number.isFinite(extraCostMultiplier) && extraCostMultiplier >= 0;
  return {
    spread,
    maxSpread,
    estimatedRoundTripCost: spread !== undefined && extraCostMultiplierValid
      ? spread * (2 + extraCostMultiplier)
      : undefined,
    extraCostSpreadMultiplier: extraCostMultiplierValid ? extraCostMultiplier : undefined,
    highImpactNewsBlocked: input.newsBlocked,
    riskLimitOk: input.riskLimitOk,
    tradingSessionOpen: input.sessionOpen,
  };
}

export function resetEconomicNewsCacheForTests(): void {
  calendarCache = null;
  calendarFetch = null;
  calendarFailure = null;
}
