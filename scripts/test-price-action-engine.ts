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
const makeBullStructure = (seconds: number, withTrigger = false): Candle[] => {
 const candles: Candle[] = [];
 const base = 10_000;
 const push = (open: number, high: number, low: number, close: number, volume = 100) => {
  const index = candles.length;
  candles.push({ time: Math.floor(now / 1000) - seconds * (60 - index), open, high, low, close, volume });
 };
 for (let swing = 0; swing < 6; swing++) {
  const low = base + swing * 3;
  const high = base + 100 + swing * 3;
  push(low + 1, low + 2, low, low + 1);
  push(low + 2, low + 8, low + 1, low + 7);
  push(low + 7, high - 1, low + 6, high - 2);
  push(high - 3, high, high - 4, high - 2);
  push(high - 2, high - 1, low + 7, low + 8);
  push(low + 8, low + 9, low + 5, low + 6);
 }
 const finalLow = base + 18;
 push(finalLow + 1, finalLow + 2, finalLow, finalLow + 1);
 push(finalLow + 1, finalLow + 5, finalLow + 0.5, finalLow + 4);
 push(finalLow + 4, finalLow + 10, finalLow + 3, finalLow + 9);
 if (withTrigger) {
  push(finalLow + 5, finalLow + 12, finalLow + 3.5, finalLow + 4);
  push(finalLow + 3.5, finalLow + 8, finalLow - 15, finalLow + 7);
  push(finalLow + 7, finalLow + 11, finalLow + 6.5, finalLow + 9.5, 300);
 }
 return candles.map((candle, index) => ({
  ...candle,
  time: Math.floor(now / 1000) - seconds * (candles.length - index),
 }));
};
const positiveFrames = {
 H4: makeBullStructure(14_400),
 H1: makeBullStructure(3_600),
 M15: makeBullStructure(900),
 M5: makeBullStructure(300, true),
};
const approvedSetup = evaluatePriceActionSetup(positiveFrames, {
 spread: 0.01, maxSpread: 0.1, estimatedRoundTripCost: 0.02,
 highImpactNewsBlocked: false, riskLimitOk: true, tradingSessionOpen: true, marketDataFresh: true,
});
assert.equal(approvedSetup.approved, true, `A fully aligned confirmed Price Action fixture must be able to approve an entry: ${approvedSetup.reasons.join('; ')}`);
assert.equal(approvedSetup.action, 'BUY', 'The confirmed HH/HL fixture must approve a BUY setup');
assert.ok((approvedSetup.riskReward ?? 0) >= 2, 'Approved setup must retain at least 1:2 net R:R after costs');

assert.equal(arePriceActionFramesFresh({ ...freshFrames, H4: freshFrame(14_400).map((c, i, a) => ({ ...c, time: i === a.length - 1 ? Math.floor(now / 1000) - 24 * 3600 : c.time })) }, now), false, 'A stale H4 candle must block the setup');
assert.equal(arePriceActionFramesFresh({ H4: freshFrames.H4, H1: freshFrames.H1, M15: freshFrames.M15 }, now), false, 'Missing M5 and M1 data must block freshness validation');
assert.equal(arePriceActionFramesFresh({
 ...freshFrames,
 M5: freshFrame(300).map((c, i, a) => ({ ...c, time: i === a.length - 1 ? Math.floor(now / 1000) - 3600 : c.time })),
}, now), false, 'A stale supplied M5 frame must not be bypassed by fresh M1 candles');
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
