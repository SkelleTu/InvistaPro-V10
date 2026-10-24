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

function parseSessionMinute(value: string | undefined, fallback: string): number | null {
  const input = (value ?? fallback).trim();
  const match = /^(\\d{2}):(\\d{2})$/.exec(input);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function zonedMinute(now: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const hour = Number(parts.find(part => part.type === 'hour')?.value);
    const minute = Number(parts.find(part => part.type === 'minute')?.value);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
  } catch {
    return null;
  }
}

function inConfiguredWindow(now: Date, timeZone: string, startEnv: string, endEnv: string, startDefault: string, endDefault: string): boolean | null {
  const start = parseSessionMinute(process.env[startEnv], startDefault);
  const end = parseSessionMinute(process.env[endEnv], endDefault);
  const current = zonedMinute(now, timeZone);
  if (start === null || end === null || current === null || start >= end) return null;
  return current >= start && current < end;
}

/**
 * London and New York windows are defined in each market's own IANA timezone,
 * so daylight-saving changes shift their Brasília equivalents automatically.
 * The third afternoon window remains a Brasília-local window. All boundaries
 * are configurable through MT5_LONDON_SESSION_*, MT5_NY_SESSION_* and
 * MT5_BRASILIA_SESSION_* environment variables.
 */
export function isAllowedBrasiliaTradingSession(now = new Date()): boolean {
  const london = inConfiguredWindow(
    now, 'Europe/London', 'MT5_LONDON_SESSION_START', 'MT5_LONDON_SESSION_END', '08:00', '11:00'
  );
  const newYork = inConfiguredWindow(
    now, 'America/New_York', 'MT5_NY_SESSION_START', 'MT5_NY_SESSION_END', '09:30', '12:00'
  );
  const brasilia = inConfiguredWindow(
    now, 'America/Sao_Paulo', 'MT5_BRASILIA_SESSION_START', 'MT5_BRASILIA_SESSION_END', '14:00', '17:00'
  );
  // Any malformed configured market window fails closed rather than silently
  // allowing a trade through a different, accidentally permissive window.
  if (london === null || newYork === null || brasilia === null) return false;
  return london || newYork || brasilia;
}

function localTradingDayKey(timestamp: number): string | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(timestamp));
    const value = (type: string) => parts.find(part => part.type === type)?.value;
    const year = value('year'), month = value('month'), day = value('day');
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

function tradeTimestamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value < 10_000_000_000 ? value * 1000 : value;
}

function configuredDailyTradeLimit(): number | null {
  const raw = process.env.MT5_PRICE_ACTION_MAX_DAILY_TRADES;
  if (raw === undefined || raw.trim() === '') return 5;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 3 && value <= 5 ? value : null;
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
  if (!input.accountHeartbeatAt || now - input.accountHeartbeatAt > 90_000 || now < input.accountHeartbeatAt) {
    reasons.push('Heartbeat real da conta MT5 ausente, futuro ou desatualizado');
  }
  if (!status.lastEquity || !Number.isFinite(status.lastEquity) || status.lastEquity <= 0) reasons.push('Equity real da conta indisponível');
  if (!Number.isFinite(config.riskPercent) || config.riskPercent < 1 || config.riskPercent > 2) reasons.push('Risco por operação fora do intervalo permitido de 1% a 2%');

  const unrealizedDrawdown = status.lastBalance && status.lastEquity
    ? Math.max(0, status.lastBalance - status.lastEquity)
    : Number.POSITIVE_INFINITY;
  const effectiveDailyLoss = Number.isFinite(status.dailyLoss)
    ? status.dailyLoss + unrealizedDrawdown : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(config.maxDailyLoss) || config.maxDailyLoss <= 0 || effectiveDailyLoss >= config.maxDailyLoss) {
    reasons.push('Limite monetário diário de perda atingido, inválido ou incluindo drawdown aberto');
  }
  if (!Number.isFinite(config.maxDailyProfit) || config.maxDailyProfit <= 0
    || !Number.isFinite(status.dailyProfit) || status.dailyProfit < 0 || status.dailyProfit >= config.maxDailyProfit) {
    reasons.push('Meta/limite diário de lucro atingido, indisponível ou inválido');
  }

  if (!Number.isInteger(status.dailyLosses) || status.dailyLosses < 0) {
    reasons.push('Contador diário de operações perdedoras indisponível ou inválido');
  } else if (status.dailyLosses >= 3) {
    reasons.push('Três operações perdedoras no dia: limite diário de perdas atingido');
  }

  const consecutiveLosses = status.consecutiveLosses;
  if (!Number.isInteger(consecutiveLosses) || (consecutiveLosses as number) < 0) {
    reasons.push('Contador de perdas consecutivas indisponível ou inválido');
  } else if ((consecutiveLosses as number) >= 2) {
    const recentLoss = Array.isArray(status.recentTrades)
      ? status.recentTrades.filter(trade => Number.isFinite(trade.profit) && trade.profit < 0)
        .sort((a, b) => (tradeTimestamp(b.closeTime) ?? 0) - (tradeTimestamp(a.closeTime) ?? 0))[0]
      : undefined;
    const closedAt = recentLoss ? tradeTimestamp(recentLoss.closeTime) : null;
    if (closedAt === null) {
      reasons.push('Duas ou mais perdas consecutivas sem horário de fechamento verificável; pausa de 1 hora não pode ser confirmada');
    } else if (now - closedAt < 60 * 60_000 || now < closedAt) {
      const remainingMinutes = Math.max(1, Math.ceil((60 * 60_000 - (now - closedAt)) / 60_000));
      reasons.push(`Duas perdas consecutivas: pausa obrigatória de 1 hora ainda ativa (${remainingMinutes} min restantes)`);
    }
  }

  const maxDailyTrades = configuredDailyTradeLimit();
  if (maxDailyTrades === null) {
    reasons.push('MT5_PRICE_ACTION_MAX_DAILY_TRADES inválido: configure um inteiro entre 3 e 5');
  } else {
    const todayKey = localTradingDayKey(now);
    const recentTrades = Array.isArray(status.recentTrades) ? status.recentTrades : [];
    const closedTradesToday = recentTrades.filter(trade => {
      const timestamp = tradeTimestamp(trade.openTime);
      return timestamp !== null && localTradingDayKey(timestamp) === todayKey;
    }).length;
    if (status.reportedOpenPositions === undefined || !Number.isInteger(status.reportedOpenPositions)
      || status.reportedOpenPositions < 0) {
      reasons.push('Quantidade de posições reportada pelo EA indisponível; reconciliação obrigatória');
    } else if (status.reportedOpenPositions !== status.openPositions) {
      reasons.push(`Divergência entre posições do EA (${status.reportedOpenPositions}) e estado interno (${status.openPositions}); entradas bloqueadas`);
    }
    if (status.positionsReconciled !== true) {
      reasons.push('Os tickets de posição do broker e do servidor não foram reconciliados exatamente após o último heartbeat');
    }
    const tradesStartedToday = closedTradesToday + Math.max(0, Math.floor(status.reportedOpenPositions ?? 0));
    if (tradesStartedToday >= maxDailyTrades) {
      reasons.push(`Limite configurado de ${maxDailyTrades} operações diárias atingido`);
    }
  }

  if (status.circuitBreakerActive) reasons.push('Circuit breaker ativo');
  if (!Number.isFinite(config.maxOpenPositions) || config.maxOpenPositions < 1
    || !Number.isFinite(status.openPositions) || status.openPositions < 0
    || status.openPositions >= config.maxOpenPositions) {
    reasons.push('Limite de posições abertas atingido, indisponível ou inválido');
  }
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
