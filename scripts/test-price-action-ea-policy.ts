import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ea = readFileSync(new URL('../public/downloads/InvistaPRO_EA.mq5', import.meta.url), 'utf8');
const route = readFileSync(new URL('../server/routes/metatrader-routes.ts', import.meta.url), 'utf8');

assert.ok(ea.includes('PriceActionRiskPercent = 1.0'), 'EA must expose the bounded Price Action risk setting');
assert.ok(ea.includes('PriceActionUseAIReview = true'), 'EA must enable the strategy-mandated AI review by default');
assert.ok(ea.includes('PriceActionExtraRoundTripCostPerLot = 0.0'), 'EA must require an explicit broker cost estimate before Price Action sizing');
assert.ok(ea.includes('priceActionUseAIReview'), 'EA must transmit the selected Price Action mode to the server');
assert.ok(ea.includes('CopyRates(g_symbol, timeframe, 1, count, rates)'), 'EA must transmit closed candles, not the live unfinished candle');
assert.ok(route.includes('reviewPriceActionCandidate'), 'The approved deterministic candidate must receive an AI review');
assert.ok(route.includes('validateAIEntryReview'), 'The AI decision must be validated against the deterministic candidate');
assert.ok(route.includes('PRICE_ACTION_AI_REVIEW_REJECTED'), 'An AI rejection or direction mismatch must produce HOLD');
assert.ok(route.includes('PRICE_ACTION_ENDPOINT_REQUIRED'), 'Generic signal fallback must never bypass the Price Action checklist');
assert.ok(route.includes('priceActionSetup.checks,\n        priceActionSetup.features'), 'The reviewer must receive the actual deterministic checklist and structure');
assert.ok(!route.includes('diagnostic_only'), 'AI must not be treated as diagnostic-only when the source requires strategy validation');
assert.ok(route.includes('const stableSignalId ='), 'Repeated polls for the same closed trigger candle must reuse a stable signal id');
assert.ok(!route.includes('finalConfidence < 70'), 'The strategy route must not impose an undocumented 70% confidence veto');
const aiReviewSource = readFileSync(new URL('../server/services/huggingface-ai.ts', import.meta.url), 'utf8');
assert.ok(!aiReviewSource.includes('approvals.length <= validReviews.length / 2'), 'No undocumented multi-model majority quorum may veto the strategy');
assert.ok(aiReviewSource.includes('strategyChecks'), 'AI review must consume the server-computed mandatory checklist');
assert.ok(ea.includes('requestAccountType'), 'EA must transmit its actual terminal account mode on each signal request');
assert.ok(ea.includes('openPositionTickets'), 'EA heartbeat must send exact broker position tickets for reconciliation');
assert.ok(ea.includes('openPositionTicketsJson'), 'EA must build the actual open-position snapshot rather than reporting only a count');
assert.ok(ea.includes('if (IsPriceActionCryptoSymbol())'), 'Price Action positions must bypass legacy AI exit filters');
assert.ok(ea.includes('trailing estrutural M5'), 'The remaining position must receive a confirmed M5 structural trailing stop after the partial');
assert.ok(ea.includes('TRADE_RETCODE_DONE_PARTIAL'), 'Price Action execution must verify an actual broker fill');
assert.ok(ea.includes('positionFound') && ea.includes('protectionValid'), 'The EA must verify broker-side stop-loss/take-profit protection after fill');
assert.ok(ea.includes('CalculatePriceActionRiskLot'), 'EA must size Price Action orders from equity and structural stop');
assert.ok(ea.includes('riskDistance / entry > 0.015'), 'EA must reject stops wider than 1.5%');
assert.ok(ea.includes('planRiskReward < 2.0'), 'EA must enforce weighted partial-plus-target R:R of 1:2 after costs');
assert.ok(ea.includes('breakeven em +1R'), 'EA must manage deterministic breakeven at +1R');
assert.ok(ea.includes('parcial de 50% realizada em +1,5R'), 'EA must manage the 50% partial at +1.5R');
assert.ok(!ea.includes('trade.Buy(lotSize,  g_symbol, 0, 0, 0'), 'EA must not fall back to an unprotected BUY');
assert.ok(!ea.includes('trade.Sell(lotSize, g_symbol, 0, 0, 0'), 'EA must not fall back to an unprotected SELL');

console.log('Price Action EA safety invariants passed (static source check only; MetaEditor compilation is separate).');
