import assert from 'node:assert/strict';
import { validatePositionReview } from '../server/services/price-action-ai-coordinator';

const p = { id: 'demo', symbol: 'BTCUSDT', direction: 'BUY' as const, currentPrice: 105, currentStop: 100, takeProfit: 115, lastMaterialEventAt: 1 };
assert.equal(validatePositionReview(p, { action: 'MOVE_STOP', confidence: 0.9, reasoning: 'tighten', proposedStop: 101 }).accepted, true);
assert.equal(validatePositionReview(p, { action: 'MOVE_STOP', confidence: 0.9, reasoning: 'widen', proposedStop: 99 }).accepted, false);
assert.equal(validatePositionReview(p, { action: 'CLOSE', confidence: 0.9, reasoning: 'exit' }).accepted, false);
assert.equal(validatePositionReview(p, { action: 'HOLD', confidence: 0.2, reasoning: 'weak' }).accepted, false);
console.log('Price Action AI coordinator tests passed');
