import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ea = readFileSync(new URL('../public/downloads/InvistaPRO_EA.mq5', import.meta.url), 'utf8');

assert.ok(ea.includes('PriceActionRiskPercent = 1.0'), 'EA must expose the bounded Price Action risk setting');
assert.ok(ea.includes('PriceActionUseAIReview = true'), 'EA must expose AI-reviewed and autonomous strategy modes');
assert.ok(ea.includes('"priceActionUseAIReview"'), 'EA must transmit the selected Price Action mode to the server');
assert.ok(ea.includes('CalculatePriceActionRiskLot'), 'EA must size Price Action orders from equity and structural stop');
assert.ok(ea.includes('riskDistance / entry > 0.015'), 'EA must reject stops wider than 1.5%');
assert.ok(ea.includes('rewardDistance / riskDistance < 2.0'), 'EA must enforce minimum executable R:R of 1:2');
assert.ok(ea.includes('breakeven em +1R'), 'EA must manage deterministic breakeven at +1R');
assert.ok(ea.includes('parcial de 50% realizada em +1,5R'), 'EA must manage the 50% partial at +1.5R');
assert.ok(!ea.includes('trade.Buy(lotSize,  g_symbol, 0, 0, 0'), 'EA must not fall back to an unprotected BUY');
assert.ok(!ea.includes('trade.Sell(lotSize, g_symbol, 0, 0, 0'), 'EA must not fall back to an unprotected SELL');

console.log('Price Action EA safety invariants passed (static source check only; MetaEditor compilation is separate).');
