import assert from 'node:assert/strict';
import { evaluatePriceActionSetup, isValidPriceActionCandles, validateAIEntryReview, validateAIStopAdjustment, type Candle } from '../server/services/price-action-engine';

const candles = (count: number, start: number, step: number): Candle[] => Array.from({length:count},(_,i)=>{
 const open=start+i*step, close=open+step*0.7;
 return {time:i+1,open,close,high:Math.max(open,close)+Math.abs(step)*0.2,low:Math.min(open,close)-Math.abs(step)*0.2,volume:100+i};
});
const orderedCandles = candles(35, 100, 0.2);
assert.equal(isValidPriceActionCandles(orderedCandles), true, 'Closed candles in chronological order are valid');
assert.equal(isValidPriceActionCandles([...orderedCandles].reverse()), false, 'Out-of-order candles must be rejected');
const missing = evaluatePriceActionSetup({});
assert.equal(missing.action,'HOLD');
assert.equal(missing.approved,false);
assert.ok(missing.reasons.length>0);
const setup = evaluatePriceActionSetup({H4:candles(40,100,1),H1:candles(40,100,0.5),M15:candles(40,100,0.2),M5:candles(40,100,0.1)});
assert.equal(setup.approved,false,'No confirmed trigger must never be approved');
assert.equal(validateAIEntryReview(setup,{decision:'BUY',direction:'BUY',confidence:0.99}).approved,false,'AI cannot invent an entry');
const reviewableSetup = {...setup, action:'BUY' as const, approved:true};
assert.equal(validateAIEntryReview(reviewableSetup,{decision:'approve',direction:'BUY',confidence:35}).approved,true,'AI confidence is informational; no undocumented 70% floor');
assert.equal(validateAIEntryReview(reviewableSetup,{decision:'approve',direction:'SELL',confidence:95}).approved,false,'AI disagreement must reject the candidate');
assert.equal(validateAIEntryReview(reviewableSetup,{decision:'approve',direction:'BUY',confidence:95,riskOverride:true}).approved,false,'AI cannot override deterministic risk policy');
assert.equal(validateAIStopAdjustment('BUY',95,94,100),false,'BUY stop may not widen risk');
assert.equal(validateAIStopAdjustment('BUY',95,97,100),true,'BUY stop may tighten protection');
assert.equal(validateAIStopAdjustment('SELL',105,106,100),false,'SELL stop may not widen risk');
assert.equal(validateAIStopAdjustment('SELL',105,103,100),true,'SELL stop may tighten protection');
console.log('Price Action engine policy tests passed.');
