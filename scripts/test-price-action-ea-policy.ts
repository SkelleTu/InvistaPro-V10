import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ea = readFileSync(new URL('../public/downloads/InvistaPRO_EA.mq5', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../server/routes/metatrader-routes.ts', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../server/services/metatrader-bridge.ts', import.meta.url), 'utf8');

assert.ok(ea.includes('PriceActionRiskPercent = 1.0'), 'EA must expose the bounded Price Action risk setting');
assert.ok(ea.includes('PriceActionUseAIReview = true'), 'EA must expose AI-reviewed and autonomous strategy modes');
assert.ok(ea.includes('priceActionUseAIReview'), 'EA must transmit the selected Price Action mode to the server');
assert.ok(ea.includes('requestAccountType'), 'EA must transmit its actual terminal account mode on each signal request');
assert.ok(ea.includes('if (IsPriceActionCryptoSymbol())'), 'All crypto Price Action positions must use deterministic management without an AI exit veto');
assert.ok(ea.includes('AIControlMode == AI_MANUAL && !isStrategyCrypto'), 'Manual mode must not replace the documented crypto strategy stops/targets');
assert.ok(ea.includes('AIControlMode == AI_PARTIAL && !isStrategyCrypto'), 'Partial mode must not replace the documented crypto strategy stops/targets');
assert.ok(routes.includes("strategyMode: 'AUTHORITATIVE_PRICE_ACTION'"), 'A valid strategy setup must determine the crypto entry');
assert.ok(routes.includes('estimatedRoundTripCost: priceActionSetup.features.estimatedRoundTripCost'), 'The EA must receive the same transaction-cost estimate used for RR and lot sizing');
assert.ok(routes.includes('strategyChecksPassed: true'), 'The route should report passed checks without claiming overall platform compliance');
assert.ok(routes.includes('MT5_PRICE_ACTION_EXTRA_COST_RATE'), 'The strategy must not assume commissions/slippage are zero');
assert.ok(routes.includes('zones: priceActionSetup.zones ?? []'), 'Rejected setups must expose their zone diagnostics');
assert.ok(!routes.includes('PRICE_ACTION_AI_REVIEW_REJECTED'), 'A fixed AI confidence/consensus gate must not veto a valid strategy setup');
assert.ok(ea.includes('CopyRates(g_symbol, timeframe, 1, count, rates)'), 'Strategy candles must exclude the unfinished bar');
assert.ok(ea.includes('CalculatePriceActionRiskLot'), 'EA must size Price Action orders from equity and structural stop');
assert.ok(ea.includes('riskCash / (lossPerLot + costPerLot)'), 'EA position size must reserve commission/slippage costs as well as stop loss');
assert.ok(ea.includes('ExtractJsonDouble(resp, "estimatedRoundTripCost")'), 'EA must receive the trusted cost estimate used by the server gate');
assert.ok(ea.includes('OrderCalcMargin(orderType, g_symbol, volume, entryPrice, requiredMargin)'), 'EA must validate broker-required margin before opening');
assert.ok(ea.includes('FindPriceActionStructuralStop(posType, curPrice)'), 'EA must trail stops from confirmed M5 swings after +1.5R');
assert.ok(bridge.includes('recentTrades: this.recentTrades.slice(0, 20)'), 'Risk controls must receive newest trades for daily limits/cooldown');
assert.ok(ea.includes('riskDistance / entry > 0.015'), 'EA must reject stops wider than 1.5%');
assert.ok(ea.includes('rewardDistance / riskDistance < 2.0'), 'EA must enforce minimum executable R:R of 1:2');
assert.ok(ea.includes('breakeven em +1R'), 'EA must manage deterministic breakeven at +1R');
assert.ok(ea.includes('parcial de 50% realizada em +1,5R'), 'EA must manage the 50% partial at +1.5R');
assert.ok(!ea.includes('trade.Buy(lotSize,  g_symbol, 0, 0, 0'), 'EA must not fall back to an unprotected BUY');
assert.ok(!ea.includes('trade.Sell(lotSize, g_symbol, 0, 0, 0'), 'EA must not fall back to an unprotected SELL');

console.log('Price Action EA safety invariants passed (static source check only; MetaEditor compilation is separate).');
