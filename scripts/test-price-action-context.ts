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
assert.equal(evaluateEconomicNewsWindow([event(now + 10 * 60_000, 'EUR')], now).blocked, false, 'Non-USD news must not trigger the USD gate');
assert.equal(evaluateEconomicNewsWindow([{ country: 'USD', impact: 'High', date: '2026-10-23T12:10:00' }], now).valid, false, 'A high-impact event without timezone must fail closed');

assert.equal(isAllowedBrasiliaTradingSession(new Date('2026-10-23T07:00:00Z')), true, '04:00 Brasilia session start is included');
assert.equal(isAllowedBrasiliaTradingSession(new Date('2026-10-23T12:30:00Z')), true, '09:30 Brasilia session start is included');
assert.equal(isAllowedBrasiliaTradingSession(new Date('2026-10-23T15:00:00Z')), false, '12:00 Brasilia session end is excluded');
assert.equal(isAllowedBrasiliaTradingSession(new Date('2026-10-23T17:00:00Z')), true, '14:00 Brasilia session start is included');
assert.equal(isAllowedBrasiliaTradingSession(new Date('2026-10-23T20:00:00Z')), false, '17:00 Brasilia session end is excluded');

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
  lastEquity: 1000, dailyLoss: 0, dailyProfit: 0, openPositions: 0, circuitBreakerActive: false,
} as MT5Status;
assert.equal(assessMt5RiskLimit({
  config, status, observedAccountType: 'demo', accountHeartbeatAt: now - 1000, now,
}).ok, true, 'Fresh confirmed DEMO account within all limits should pass');
assert.equal(assessMt5RiskLimit({
  config, status, observedAccountType: 'real', accountHeartbeatAt: now - 1000, now,
}).ok, false, 'REAL account must fail closed');
assert.equal(assessMt5RiskLimit({
  config, status, observedAccountType: 'demo', accountHeartbeatAt: now - 31_000, now,
}).ok, false, 'Stale heartbeat must fail closed');
assert.equal(assessMt5RiskLimit({
  config, status: { ...status, dailyLoss: 100 }, observedAccountType: 'demo', accountHeartbeatAt: now - 1000, now,
}).ok, false, 'Daily loss limit must block entries');

console.log('Price Action context safety tests passed.');
