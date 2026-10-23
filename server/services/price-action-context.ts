import fetch from 'node-fetch';
import type { MT5Config, MT5Status } from './metatrader-bridge';
import type { MarketContext } from './price-action-engine';

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
const MAX_SPREAD_FRACTION = (() => {
  const raw = Number(process.env.MT5_PRICE_ACTION_MAX_SPREAD_PCT ?? 0.0005);
  return Number.isFinite(raw) && raw >= 0.00005 && raw <= 0.01 ? raw : 0.0005;
})();

let calendarCache: { events: EconomicCalendarEvent[]; fetchedAt: number } | null = null;
let calendarFetch: Promise<{ events: EconomicCalendarEvent[]; fetchedAt: number }> | null = null;

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

  const highImpactUsd = events.filter(event =>
    String(event.country ?? '').trim().toUpperCase() === 'USD' &&
    String(event.impact ?? '').trim().toLowerCase() === 'high',
  );
  let nextEventAt: number | undefined;
  for (const event of highImpactUsd) {
    const timestamp = eventTimestamp(event);
    if (timestamp === null) {
      return {
        blocked: true,
        valid: false,
        reason: 'Evento USD de alto impacto sem horário/timezone verificável; entradas bloqueadas.',
      };
    }
    if (timestamp >= now && (nextEventAt === undefined || timestamp < nextEventAt)) nextEventAt = timestamp;
    if (Math.abs(timestamp - now) <= windowMs) {
      return {
        blocked: true,
        valid: true,
        reason: 'Janela de notícia USD de alto impacto: ' + String(event.title ?? 'evento econômico') + '.',
        nextEventAt: timestamp,
      };
    }
  }

  return {
    blocked: false,
    valid: true,
    reason: 'Calendário econômico válido; nenhuma notícia USD de alto impacto na janela de bloqueio.',
    nextEventAt,
  };
}

async function loadCalendar(now = Date.now()): Promise<{ events: EconomicCalendarEvent[]; fetchedAt: number }> {
  if (calendarCache && now - calendarCache.fetchedAt <= CALENDAR_CACHE_TTL_MS) return calendarCache;
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
    const cached = { events, fetchedAt: Date.now() };
    calendarCache = cached;
    return cached;
  })();
  try {
    return await calendarFetch;
  } catch (error) {
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
  now?: number;
}): { ok: boolean; reasons: string[] } {
  const now = input.now ?? Date.now();
  const { config, status } = input;
  const reasons: string[] = [];
  if (!config.enabled) reasons.push('MT5 desativado no servidor');
  if (config.accountType !== 'demo' || input.observedAccountType !== 'demo') reasons.push('A conta MT5 não está confirmada em modo DEMO');
  if (!input.accountHeartbeatAt || now - input.accountHeartbeatAt > 90_000) reasons.push('Heartbeat real da conta MT5 ausente ou desatualizado');
  if (!status.lastEquity || !Number.isFinite(status.lastEquity) || status.lastEquity <= 0) reasons.push('Equity real da conta indisponível');
  if (!Number.isFinite(config.riskPercent) || config.riskPercent < 1 || config.riskPercent > 2) reasons.push('Risco por operação fora do intervalo permitido de 1% a 2%');
  const unrealizedDrawdown = status.lastBalance && status.lastEquity
    ? Math.max(0, status.lastBalance - status.lastEquity)
    : Number.POSITIVE_INFINITY;
  const effectiveDailyLoss = Number.isFinite(status.dailyLoss) ? status.dailyLoss + unrealizedDrawdown : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(config.maxDailyLoss) || config.maxDailyLoss <= 0 || effectiveDailyLoss >= config.maxDailyLoss) reasons.push('Limite diário de perda atingido, inválido ou incluindo drawdown aberto');
  if (!Number.isFinite(config.maxDailyProfit) || config.maxDailyProfit <= 0 || status.dailyProfit >= config.maxDailyProfit) reasons.push('Meta/limite diário de lucro atingido ou inválido');
  if (status.circuitBreakerActive) reasons.push('Circuit breaker ativo');
  if (!Number.isFinite(config.maxOpenPositions) || config.maxOpenPositions < 1 || status.openPositions >= config.maxOpenPositions) reasons.push('Limite de posições abertas atingido ou inválido');
  return { ok: reasons.length === 0, reasons };
}

export function buildTrustedPriceActionContext(input: {
  bid: unknown;
  ask: unknown;
  entryPrice: unknown;
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
  const maxSpread = mid !== undefined ? mid * MAX_SPREAD_FRACTION : undefined;
  return {
    spread,
    maxSpread,
    estimatedRoundTripCost: spread !== undefined ? spread * 2 : undefined,
    highImpactNewsBlocked: input.newsBlocked,
    riskLimitOk: input.riskLimitOk,
    tradingSessionOpen: input.sessionOpen,
  };
}

export function resetEconomicNewsCacheForTests(): void {
  calendarCache = null;
  calendarFetch = null;
}
