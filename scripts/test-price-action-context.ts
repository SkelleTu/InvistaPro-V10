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

assert.equal(isAllowedBrasiliaTradingSession(new Date('2026-10-23T07:00:00Z')), true, '04:00 Brasilia session start is included');
assert.equal(isAllowedBrasiliaTradingSession(new Date('2026-10-23T12:30:00Z')), true, '09:30 Brasilia session start is included');
assert.equal(isAllowedBrasiliaTradingSession(new Date('2026-10-23T15:00:00Z')), false, '12:00 Brasilia session end is excluded');
assert.equal(isAllowedBrasiliaTradingSession(new Date('2026-10-23T17:00:00Z')), true, '14:00 Brasilia session start is included');
assert.equal(isAllowedBrasiliaTradingSession(new Date('2026-10-23T20:00:00Z')), false, '17:00 Brasilia session end is excluded');

const makeCandles = (range: number) => Array.from({ length: 30 }, (_, i) => ({
  time: i + 1,
  open: 100,
  high: 100 + range,
  low: 100 - range,
  close: 100 + (i % 2 ? range / 4 : -range / 4),
  volume: 100 + i,
}));
process.env.MT5_PRICE_ACTION_EXTRA_COST_PRICE_UNITS = '0'; // Explicitly declare zero extra cost for this isolated unit fixture.
const trusted = buildTrustedPriceActionContext({
  bid: 100,
  ask: 100.1,
  entryPrice: 100.05,
  m1Candles: makeCandles(0.5),
  m5Candles: makeCandles(0.5),
  riskLimitOk: true,
  newsBlocked: false,
  sessionOpen: true,
});
assert.ok(Math.abs(Number(trusted.maxSpread) - 0.08) < 1e-9, 'Adaptive spread must use the tightest of M1 ATR, M5 ATR and the 0.10% price cap');
assert.equal(buildTrustedPriceActionContext({
  bid: 100, ask: 100.01, entryPrice: 100.005, m1Candles: makeCandles(0.5),
  riskLimitOk: true, newsBlocked: false, sessionOpen: true,
}).maxSpread, undefined, 'Adaptive spread must fail closed when M5 ATR is unavailable');
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
  lastBalance: 1000, lastEquity: 1000, dailyLoss: 0, dailyProfit: 0, openPositions: 0, circuitBreakerActive: false,
} as MT5Status;
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

delete process.env.MT5_PRICE_ACTION_EXTRA_COST_PRICE_UNITS;
const unconfiguredCosts = buildTrustedPriceActionContext({
  bid: 100, ask: 100.01, entryPrice: 100.005,
  m1Candles: makeCandles(0.5), m5Candles: makeCandles(0.5),
  riskLimitOk: true, newsBlocked: false, sessionOpen: true,
});
assert.equal(unconfiguredCosts.estimatedRoundTripCost, undefined, 'Missing commission/slippage estimate must fail closed rather than treating spread as total costs');
process.env.MT5_PRICE_ACTION_EXTRA_COST_PRICE_UNITS = '-1';
const invalidCosts = buildTrustedPriceActionContext({
  bid: 100, ask: 100.01, entryPrice: 100.005,
  m1Candles: makeCandles(0.5), m5Candles: makeCandles(0.5),
  riskLimitOk: true, newsBlocked: false, sessionOpen: true,
});
assert.equal(invalidCosts.estimatedRoundTripCost, undefined, 'Negative additional costs must fail closed');
delete process.env.MT5_PRICE_ACTION_EXTRA_COST_PRICE_UNITS;
