import assert from 'node:assert/strict';
import {
  assessMt5RiskLimit,
  buildTrustedPriceActionContext,
  evaluateEconomicNewsWindow,
  isAllowedBrasiliaTradingSession,
  type EconomicCalendarEvent,
} from '../server/services/price-action-context';
import type { MT5Config, MT5Status } from '../server/services/metatrader-bridge';

const now = Date.parse('2026-10-23T12:00:00Z');
const event = (timestamp: number, country = 'USD', impact = 'High'): EconomicCalendarEvent => ({
  title: 'Federal Reserve event',
  country,
  impact,
  timestamp,
});

assert.equal(evaluateEconomicNewsWindow([], now).blocked, true, 'An empty calendar must fail closed');
assert.equal(evaluateEconomicNewsWindow([event(now + 10 * 60_000)], now).blocked, true, 'High-impact USD news inside the window must block');
assert.equal(evaluateEconomicNewsWindow([event(now + 2 * 60 * 60_000)], now).blocked, false, 'High-impact USD news outside the window must not block');
assert.equal(evaluateEconomicNewsWindow([event(now + 10 * 60_000, 'EUR')], now).blocked, true, 'Any high-impact macro event inside the window must block');
assert.equal(evaluateEconomicNewsWindow([{ country: 'USD', impact: 'High', date: '2026-10-23T12:10:00' }], now).valid, false, 'A high-impact event without timezone must fail closed');

assert.equal(isAllowedBrasiliaTradingSession(new Date('2026-10-23T07:00:00Z')), true, '08:00 London local time is included during British summer time');
assert.equal(isAllowedBrasiliaTradingSession(new Date('2026-10-23T13:30:00Z')), true, '09:30 New York local time is included during US daylight time');
assert.equal(isAllowedBrasiliaTradingSession(new Date('2026-10-23T16:00:00Z')), false, 'All market sessions are closed after the New York window');
assert.equal(isAllowedBrasiliaTradingSession(new Date('2026-10-23T17:00:00Z')), true, '14:00 Brasilia afternoon session start is included');
assert.equal(isAllowedBrasiliaTradingSession(new Date('2026-10-23T20:00:00Z')), false, '17:00 Brasilia afternoon session end is excluded');
assert.equal(isAllowedBrasiliaTradingSession(new Date('2026-12-01T08:00:00Z')), true, 'London local open remains correct after the UK daylight-saving transition');

const trusted = buildTrustedPriceActionContext({
  bid: 100,
  ask: 100.1,
  entryPrice: 100.05,
  riskLimitOk: true,
  newsBlocked: false,
  sessionOpen: true,
});
assert.ok(Math.abs(Number(trusted.spread) - 0.1) < 1e-9, 'Spread calculation must preserve the expected price difference');
assert.ok(Math.abs(Number(trusted.estimatedRoundTripCost) - 0.2) < 1e-9, 'Round-trip cost must equal twice the observed spread');
assert.equal(trusted.highImpactNewsBlocked, false);
assert.equal(trusted.tradingSessionOpen, true);
assert.equal(buildTrustedPriceActionContext({
  bid: 0, ask: 0, entryPrice: 100, riskLimitOk: true, newsBlocked: false, sessionOpen: true,
}).spread, undefined, 'Invalid terminal prices must not produce a trusted spread');

const config = {
  enabled: true, accountType: 'demo', riskPercent: 1, maxDailyLoss: 100, maxDailyProfit: 500,
  maxOpenPositions: 5,
} as MT5Config;
const status = {
  lastBalance: 1000,
  lastEquity: 1000,
  dailyLoss: 0,
  dailyProfit: 0,
  dailyLosses: 0,
  consecutiveLosses: 0,
  openPositions: 0,
  reportedOpenPositions: 0,
  recentTrades: [],
  circuitBreakerActive: false,
} as unknown as MT5Status;
assert.equal(assessMt5RiskLimit({
  config, status, observedAccountType: 'demo', accountHeartbeatAt: now - 1000, now,
}).ok, true, 'Fresh confirmed DEMO account within all limits should pass');
assert.equal(assessMt5RiskLimit({
  config, status, observedAccountType: 'real', accountHeartbeatAt: now - 1000, now,
}).ok, false, 'REAL account must fail closed');
assert.equal(assessMt5RiskLimit({
  config, status, observedAccountType: 'demo', accountHeartbeatAt: now - 91_000, now,
}).ok, false, 'Stale heartbeat must fail closed');
assert.equal(assessMt5RiskLimit({
  config, status: { ...status, dailyLoss: 100 }, observedAccountType: 'demo', accountHeartbeatAt: now - 1000, now,
}).ok, false, 'Daily loss limit must block entries');
assert.equal(assessMt5RiskLimit({
  config, status: { ...status, dailyLosses: 3 }, observedAccountType: 'demo', accountHeartbeatAt: now - 1000, now,
}).ok, false, 'Three losing trades must block the rest of the day');
assert.equal(assessMt5RiskLimit({
  config, status: { ...status, consecutiveLosses: 2 }, observedAccountType: 'demo', accountHeartbeatAt: now - 1000, now,
}).ok, false, 'Two consecutive losses without a verifiable close time must fail closed');
assert.equal(assessMt5RiskLimit({
  config, status: { ...status, reportedOpenPositions: 1 }, observedAccountType: 'demo', accountHeartbeatAt: now - 1000, now,
}).ok, false, 'Broker/internal position mismatch must block new entries');

const realConfig = { ...config, accountType: 'real' } as MT5Config;
assert.equal(assessMt5RiskLimit({
  config: realConfig, status, observedAccountType: 'real', accountHeartbeatAt: now - 1000,
  realTradingExplicitlyEnabled: false, now,
}).ok, false, 'REAL account must remain blocked without explicit server authorization');
assert.equal(assessMt5RiskLimit({
  config: realConfig, status, observedAccountType: 'real', accountHeartbeatAt: now - 1000,
  realTradingExplicitlyEnabled: true, now,
}).ok, true, 'REAL risk gate can pass only when the separate explicit flag is enabled');


console.log('Price Action context safety tests passed.');
