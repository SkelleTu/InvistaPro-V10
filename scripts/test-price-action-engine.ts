import assert from 'node:assert/strict';
import { arePriceActionFramesFresh, evaluatePriceActionSetup, validateAIEntryReview, validateAIStopAdjustment, type Candle } from '../server/services/price-action-engine';

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

const now = Date.parse('2026-11-02T12:00:00Z');
const freshFrame = (seconds: number, count = 40): Candle[] => Array.from({ length: count }, (_, index) => {
 const close = 100 + Math.sin(index / 2) * 0.5;
 return { time: Math.floor(now / 1000) - seconds * (count - index), open: close - 0.1, high: close + 0.2, low: close - 0.2, close, volume: 100 + index };
});
const freshFrames = {
 H4: freshFrame(14_400), H1: freshFrame(3_600), M15: freshFrame(900),
 M5: freshFrame(300), M1: freshFrame(60),
};
assert.equal(arePriceActionFramesFresh(freshFrames, now), true, 'All closed timeframe candles inside the freshness window should pass');
assert.equal(arePriceActionFramesFresh({ ...freshFrames, H4: freshFrame(14_400).map((c, i, a) => ({ ...c, time: i === a.length - 1 ? Math.floor(now / 1000) - 24 * 3600 : c.time })) }, now), false, 'A stale H4 candle must block the setup');
assert.equal(arePriceActionFramesFresh({ H4: freshFrames.H4, H1: freshFrames.H1, M15: freshFrames.M15 }, now), false, 'Missing M5 and M1 data must block freshness validation');
const duplicateTime = freshFrame(300);
duplicateTime[duplicateTime.length - 1].time = duplicateTime[duplicateTime.length - 2].time;
assert.equal(evaluatePriceActionSetup({ H4: freshFrames.H4, H1: freshFrames.H1, M15: freshFrames.M15, M5: duplicateTime }).approved, false, 'Duplicate/out-of-order candle timestamps must be rejected');

const approvedFixture = {
 action: 'BUY' as const, approved: true, reasons: [], checks: {}, entry: 100, stopLoss: 99, takeProfit: 102,
 riskReward: 2, features: {},
};
assert.equal(validateAIEntryReview(approvedFixture, { decision: 'approved', direction: 'BUY', confidence: 0.8 }).approved, true, 'AI can approve a valid setup only with matching direction and >=70% confidence');
assert.equal(validateAIEntryReview(approvedFixture, { decision: 'approved', direction: 'SELL', confidence: 0.99 }).approved, false, 'AI cannot reverse a deterministic setup');
assert.equal(validateAIEntryReview(approvedFixture, { decision: 'approved', direction: 'BUY', confidence: 70 }).approved, false, 'AI confidence must be normalized to a 0-1 fraction');

console.log('Price Action engine policy tests passed.');
