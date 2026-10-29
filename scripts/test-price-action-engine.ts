import assert from 'node:assert/strict';
import { evaluatePriceActionSetup, hasRequiredStructuralConfluence, validateAIEntryReview, validateAIStopAdjustment, type Candle } from '../server/services/price-action-engine';

const candles = (count: number, start: number, step: number): Candle[] => Array.from({length:count},(_,i)=>{
 const open=start+i*step, close=open+step*0.7;
 return {time:i+1,open,close,high:Math.max(open,close)+Math.abs(step)*0.2,low:Math.min(open,close)-Math.abs(step)*0.2,volume:100+i};
});
const missing = evaluatePriceActionSetup({});
assert.equal(missing.action,'HOLD');
assert.equal(missing.approved,false);
assert.ok(missing.reasons.length>0);
const setup = evaluatePriceActionSetup({H4:candles(40,100,1),H1:candles(40,100,0.5),M15:candles(40,100,0.2),M5:candles(40,100,0.1)});
assert.equal(setup.approved,false,'No confirmed trigger must never be approved');
assert.equal(setup.checks.trend_m15_alignment, false, 'M15 direction must be an explicit mandatory gate when no valid aligned entry exists');

const bearishCandles = (count: number, start: number, step: number): Candle[] => Array.from({length:count},(_,i)=>{
 const open=start-i*step, close=open-step*0.7;
 return {time:i+1,open,close,high:open+Math.abs(step)*0.2,low:Math.min(open,close)-Math.abs(step)*0.2,volume:100+i};
});
const entryWithBullishBreakout = candles(40,100,0.5);
entryWithBullishBreakout[37] = {time:38,open:118.7,close:118.3,high:118.9,low:118.1,volume:180};
entryWithBullishBreakout[38] = {time:39,open:118.2,close:118.95,high:119.05,low:118.0,volume:190};
entryWithBullishBreakout[39] = {time:40,open:118.9,close:119.2,high:119.3,low:118.8,volume:220};
const conflictingM15 = evaluatePriceActionSetup({
 H4:candles(40,100,1),
 H1:candles(40,100,0.5),
 M15:bearishCandles(40,130,0.5),
 M5:entryWithBullishBreakout,
});
assert.equal(conflictingM15.checks.entry_trigger, true, 'Fixture must produce a valid bullish M5 trigger');
assert.equal(conflictingM15.checks.trend_m15_alignment, false, 'A bearish M15 trend must block a bullish H4/H1/M5 setup');
assert.equal(conflictingM15.approved, false, 'M15 disagreement must block execution even when a lower-timeframe trigger exists');
assert.equal(validateAIEntryReview(setup,{decision:'BUY',direction:'BUY',confidence:0.99}).approved,false,'AI cannot invent an entry');
assert.equal(validateAIStopAdjustment('BUY',95,94,100),false,'BUY stop may not widen risk');
assert.equal(validateAIStopAdjustment('BUY',95,97,100),true,'BUY stop may tighten protection');
assert.equal(validateAIStopAdjustment('SELL',105,106,100),false,'SELL stop may not widen risk');
assert.equal(validateAIStopAdjustment('SELL',105,103,100),true,'SELL stop may tighten protection');
console.log('Price Action engine policy tests passed.');

const approvedFixture = {
  action: 'BUY' as const, approved: true, reasons: [], checks: {},
  entry: 100, stopLoss: 99, takeProfit: 102, riskReward: 2,
  features: {},
};
assert.equal(validateAIEntryReview(approvedFixture, { decision: 'BUY', direction: 'BUY', confidence: 0.7 }).approved, true, 'AI review at 70% must pass only for a valid matching strategy setup');
assert.equal(validateAIEntryReview(approvedFixture, { decision: 'SELL', direction: 'SELL', confidence: 0.99 }).approved, false, 'Opposing AI review must be rejected');
assert.equal(validateAIEntryReview(approvedFixture, { decision: 'BUY', direction: 'BUY', confidence: 0.69 }).approved, false, 'AI review below threshold must be rejected');
assert.equal(validateAIEntryReview(approvedFixture, { decision: 'BUY', direction: 'BUY', confidence: 0.99, riskOverride: 2 }).approved, false, 'AI cannot override deterministic risk');

assert.equal(hasRequiredStructuralConfluence({ bos: true, choch: false, fvg: false, sweep: false, orderBlock: false }), false, 'BOS alone must not satisfy structural confluence');
assert.equal(hasRequiredStructuralConfluence({ bos: false, choch: false, fvg: true, sweep: true, orderBlock: false }), false, 'FVG and sweep without BOS/CHoCH must not satisfy structural confluence');
assert.equal(hasRequiredStructuralConfluence({ bos: true, choch: false, fvg: true, sweep: false, orderBlock: false }), true, 'BOS plus independent FVG must satisfy structural confluence');
assert.equal(hasRequiredStructuralConfluence({ bos: false, choch: true, fvg: false, sweep: false, orderBlock: true }), true, 'CHoCH plus Order Block must satisfy structural confluence');

const unordered = candles(40, 100, 0.5).reverse();
const unorderedResult = evaluatePriceActionSetup({
  H4: candles(40, 100, 1),
  H1: candles(40, 100, 0.5),
  M15: candles(40, 100, 0.2),
  M5: unordered,
});
assert.equal(unorderedResult.approved, false, 'Unordered or duplicate candle timestamps must never be accepted');
assert.equal(unorderedResult.checks.entry_data, false, 'Entry frame integrity includes strictly increasing timestamps');

const risingFrame = (count: number, start: number, step: number): Candle[] => Array.from({ length: count }, (_, i) => {
  const open = start + i * step;
  const close = open + step * 0.6;
  return { time: i + 1, open, close, high: Math.max(open, close) + step * 0.1, low: Math.min(open, close) - step * 0.1, volume: 100 + i };
});
const positiveEntry = risingFrame(40, 100, 0.01);
positiveEntry[37] = { time: 38, open: 100.75, close: 100.73, high: 100.752, low: 100.728, volume: 180 };
positiveEntry[38] = { time: 39, open: 100.72, close: 100.76, high: 100.765, low: 100.715, volume: 190 };
positiveEntry[39] = { time: 40, open: 100.76, close: 100.9, high: 100.91, low: 100.1, volume: 240 };
const positive = evaluatePriceActionSetup({
  H4: risingFrame(40, 100, 0.1),
  H1: risingFrame(40, 100, 0.05),
  M15: risingFrame(40, 100, 0.01),
  M5: positiveEntry,
}, {
  spread: 0.0001, maxSpread: 0.01, estimatedRoundTripCost: 0.0002,
  highImpactNewsBlocked: false, riskLimitOk: true, tradingSessionOpen: true,
});
assert.equal(positive.approved, true, 'Complete aligned setup with trigger, BOS+sweep, volume, valid costs and all safety gates must be approvable');
assert.equal(positive.action, 'BUY');
assert.ok(Number(positive.riskReward) >= 2, 'Approved setup must meet net R:R of at least 1:2');
