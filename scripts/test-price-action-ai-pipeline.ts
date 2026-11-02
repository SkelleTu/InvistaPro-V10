import assert from 'node:assert/strict';
import { detectPriceActionPreTrigger } from '../server/services/price-action-engine';
import { PriceActionAiCoordinator } from '../server/services/price-action-ai-coordinator';
import { PriceActionAiPipeline } from '../server/services/price-action-ai-pipeline';
import type { PriceActionAiProvider } from '../server/services/price-action-ai-coordinator';
import type { Candle } from '../server/services/price-action-engine';

function rising(count: number): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const open = 100 + i * 0.02;
    const close = open + 0.015;
    return { time: i * 60_000, open, high: close + 0.005, low: open - 0.005, close, volume: 100 };
  });
}
function flat(count: number): Candle[] {
  return Array.from({ length: count }, (_, i) => ({
    time: i * 900_000, open: 100.05, high: 100.2, low: 100, close: 100.1, volume: 100,
  }));
}
const entry = rising(32);
entry.push(
  { time: 32 * 60_000, open: 100.64, high: 100.65, low: 100.60, close: 100.61, volume: 100 },
  { time: 33 * 60_000, open: 100.61, high: 100.75, low: 100.53, close: 100.70, volume: 200 },
  { time: 34 * 60_000, open: 100.70, high: 100.74, low: 100.68, close: 100.72, volume: 100 },
);
const frames = { H4: rising(40), H1: rising(40), M15: flat(40), M5: entry };
const candidate = detectPriceActionPreTrigger(frames);
assert.ok(candidate, 'aligned trend, M15 zone, closed pattern and volume should produce a pre-trigger');
assert.equal(candidate?.side, 'BUY');
assert.equal(candidate?.triggerLevel, 100.75);

let calls = 0;
const provider: PriceActionAiProvider = {
  async reviewPreTrigger(input) {
    calls++;
    return { decision: 'APPROVE', direction: input.direction, confidence: 0.91, reasoning: 'independent review', risks: [] };
  },
  async reviewPosition() {
    return { action: 'HOLD', confidence: 0.9, reasoning: 'continue monitoring' };
  },
};
const coordinator = new PriceActionAiCoordinator(provider);
const pipeline = new PriceActionAiPipeline(coordinator);
const result = await pipeline.evaluate('BTCUSDT', frames, {});
assert.equal(result.state, 'WAITING_TRIGGER');
assert.equal(calls, 1);
const repeated = await pipeline.evaluate('BTCUSDT', frames, {});
assert.equal(repeated.state, 'WAITING_TRIGGER');
assert.equal(calls, 1, 'AI must not be called again while the approved candidate is awaiting breakout');
console.log('Price Action AI pipeline pre-trigger tests passed');
