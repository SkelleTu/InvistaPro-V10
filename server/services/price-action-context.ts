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

interface TradingSessionWindow {
  timezone: string;
  start: string;
  end: string;
}

const DEFAULT_TRADING_SESSIONS: TradingSessionWindow[] = [
  // Use market-local times for London/New York so daylight-saving transitions are automatic.
  { timezone: 'Europe/London', start: '08:00', end: '11:00' },
  { timezone: 'America/New_York', start: '09:30', end: '12:00' },
  // The afternoon window is defined directly in Brasilia time.
  { timezone: 'America/Sao_Paulo', start: '14:00', end: '17:00' },
];

function parseClockMinutes(value: unknown): number | null {
  if (typeof value !== 'string' || !/^([01]\\d|2[0-3]):[0-5]\\d$/.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function configuredTradingSessions(): TradingSessionWindow[] {
  const raw = process.env.MT5_PRICE_ACTION_SESSIONS?.trim();
  if (!raw) return DEFAULT_TRADING_SESSIONS;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return [];
    const windows: TradingSessionWindow[] = [];
    for (const item of parsed) {
      if (!item || typeof item.timezone !== 'string') return [];
      const start = parseClockMinutes(item.start);
      const end = parseClockMinutes(item.end);
      if (start === null || end === null || start >= end) return [];
      // Validate IANA zone names before using configuration.
      new Intl.DateTimeFormat('en-GB', { timeZone: item.timezone });
      windows.push({ timezone: item.timezone, start: item.start, end: item.end });
    }
    return windows;
  } catch {
    // A malformed session configuration fails closed; it never silently widens trading hours.
    return [];
  }
}

function minutesInZone(now: Date, timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const hour = Number(parts.find(part => part.type === 'hour')?.value);
    const minute = Number(parts.find(part => part.type === 'minute')?.value);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

export function isAllowedBrasiliaTradingSession(now = new Date()): boolean {
  const sessions = configuredTradingSessions();
  if (!sessions.length) return false;
  return sessions.some(session => {
    const currentMinute = minutesInZone(now, session.timezone);
    const start = parseClockMinutes(session.start);
    const end = parseClockMinutes(session.end);
    return currentMinute !== null && start !== null && end !== null &&
      currentMinute >= start && currentMinute < end;
  });
}

export function assessMt5RiskLimit(input: {
  config: MT5Config;
  status: MT5Status;
  observedAccountType: 'demo' | 'real' | 'contest' | null;
  accountHeartbeatAt: number;
  realTradingExplicitlyEnabled?: boolean;
  maxDailyTrades?: number;
  openPositions?: Array<{ openTime?: number }>;
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
  const recentTrades = Array.isArray(status.recentTrades) ? status.recentTrades : [];
  const brasiliaDate = (timestamp: number) => {
    const normalizedTimestamp = timestamp < 100_000_000_000 ? timestamp * 1000 : timestamp;
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(normalizedTimestamp));
    const year = parts.find(part => part.type === 'year')?.value;
    const month = parts.find(part => part.type === 'month')?.value;
    const day = parts.find(part => part.type === 'day')?.value;
    return year && month && day ? `${year}-${month}-${day}` : 'INVALID_DATE';
  };
  const today = brasiliaDate(now);
  const tradesClosedToday = recentTrades.filter(trade =>
    Number.isFinite(trade.closeTime) && brasiliaDate(trade.closeTime) === today);
  const dailyLossCount = tradesClosedToday.filter(trade =>
    Number.isFinite(trade.profit) && trade.profit < 0).length;
  // Derive all daily monetary limits from the same Brasilia-day trade ledger.
  // This avoids mixing UTC/server-local counters with the strategy's operational day.
  const realizedDailyLoss = tradesClosedToday.reduce((sum, trade) =>
    sum + (Number.isFinite(trade.profit) ? Math.max(0, -trade.profit) : 0), 0);
  const realizedDailyProfit = tradesClosedToday.reduce((sum, trade) =>
    sum + (Number.isFinite(trade.profit) ? Math.max(0, trade.profit) : 0), 0);
  const unrealizedDrawdown = Number.isFinite(status.lastBalance) && Number.isFinite(status.lastEquity)
    ? Math.max(0, Number(status.lastBalance) - Number(status.lastEquity))
    : Number.POSITIVE_INFINITY;
  const effectiveDailyLoss = realizedDailyLoss + unrealizedDrawdown;
  if (!Number.isFinite(config.maxDailyLoss) || config.maxDailyLoss <= 0 ||
      !Number.isFinite(unrealizedDrawdown) || effectiveDailyLoss >= config.maxDailyLoss) {
    reasons.push('Limite diário de perda atingido, inválido ou incluindo drawdown aberto');
  }
  if (!Number.isFinite(config.maxDailyProfit) || config.maxDailyProfit <= 0 ||
      realizedDailyProfit >= config.maxDailyProfit) {
    reasons.push('Meta/limite diário de lucro atingido ou inválido');
  }
  if (status.circuitBreakerActive) reasons.push('Circuit breaker ativo');
  if (dailyLossCount >= 3) {
    reasons.push('Limite de três operações perdedoras no dia atingido');
  }

  // Stop for one hour after two consecutive losses, based on the recorded closing time.
  const consecutiveLosses = Number(status.consecutiveLosses ?? 0);
  if (consecutiveLosses >= 2) {
    const lastLoss = recentTrades
      .filter(trade => Number.isFinite(trade.profit) && trade.profit < 0 && Number.isFinite(trade.closeTime))
      .sort((a, b) => b.closeTime - a.closeTime)[0];
    const lossClosedAt = lastLoss
      ? (lastLoss.closeTime < 100_000_000_000 ? lastLoss.closeTime * 1000 : lastLoss.closeTime)
      : 0;
    if (!lossClosedAt || now - lossClosedAt < 60 * 60_000) {
      reasons.push('Duas perdas consecutivas: a pausa obrigatória de uma hora não foi comprovadamente encerrada');
    }
  }

  // The strategy permits a configured cap of 3, 4 or 5 operations per Brasilia day.
  const requestedDailyCap = input.maxDailyTrades ?? 5;
  const dailyCap = [3, 4, 5].includes(requestedDailyCap) ? requestedDailyCap : 5;
  const recentTradesToday = recentTrades
    .filter(trade => Number.isFinite(trade.openTime) && brasiliaDate(trade.openTime) === today).length;
  const openPositionsToday = (input.openPositions ?? [])
    .filter(position => Number.isFinite(position.openTime) && brasiliaDate(position.openTime!) === today).length;
  if (recentTradesToday + openPositionsToday >= dailyCap) {
    reasons.push('Limite diário configurado de ' + dailyCap + ' operações atingido');
  }
  if (!Number.isFinite(config.maxOpenPositions) || config.maxOpenPositions < 1
    || !Number.isFinite(status.openPositions) || status.openPositions < 0
    || status.openPositions >= config.maxOpenPositions) reasons.push('Limite de posições abertas atingido, indisponível ou inválido');
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
  calendarFailure = null;
}
