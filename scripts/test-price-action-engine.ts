import assert from 'node:assert/strict';
import { evaluatePriceActionSetup, validateAIEntryReview, validateAIStopAdjustment, type Candle } from '../server/services/price-action-engine';

const candles = (count: number, start: number, step: number, intervalSeconds = 60): Candle[] => {
 const nowSeconds = Math.floor(Date.now() / 1000);
 return Array.from({length:count},(_,i)=>{
  const open=start+i*step, close=open+step*0.7;
  return {time:nowSeconds-(count-i)*intervalSeconds,open,close,high:Math.max(open,close)+Math.abs(step)*0.2,low:Math.min(open,close)-Math.abs(step)*0.2,volume:100+i};
 });
};
const missing = evaluatePriceActionSetup({});
assert.equal(missing.action,'HOLD');
assert.equal(missing.approved,false);
assert.ok(missing.reasons.length>0);
const setup = evaluatePriceActionSetup({H4:candles(40,100,1,14400),H1:candles(40,100,0.5,3600),M15:candles(40,100,0.2,900),M5:candles(40,100,0.1,300)});
assert.equal(setup.approved,false,'No confirmed trigger must never be approved');
const invalidFreshness = evaluatePriceActionSetup({
 H4:candles(40,100,1,14400), H1:candles(40,100,0.5,3600), M15:candles(40,100,0.2,900),
 M5:candles(40,100,0.1,300).map((c,i,a)=>i===a.length-1?{...c,time:Math.floor(Date.now()/1000)}:c),
});
assert.equal(invalidFreshness.approved,false,'An unfinished current bar must fail closed');
assert.equal(invalidFreshness.checks.entry_data,false,'Unfinished M5 data must not be accepted as entry data');
assert.equal(validateAIEntryReview(setup,{decision:'BUY',direction:'BUY',confidence:0.99}).approved,false,'AI cannot invent an entry');
const strategyApproved = { action: 'BUY' as const, approved: true, reasons: [], checks: {}, features: {} };
assert.equal(validateAIEntryReview(strategyApproved,{decision:'reject',direction:'SELL',confidence:0.01}).approved,true,'AI opinion/confidence cannot add an undocumented veto to an already-valid strategy setup');
assert.equal(validateAIStopAdjustment('BUY',95,94,100),false,'BUY stop may not widen risk');
assert.equal(validateAIStopAdjustment('BUY',95,97,100),true,'BUY stop may tighten protection');
assert.equal(validateAIStopAdjustment('SELL',105,106,100),false,'SELL stop may not widen risk');
assert.equal(validateAIStopAdjustment('SELL',105,103,100),true,'SELL stop may tighten protection');
console.log('Price Action engine policy tests passed.');
