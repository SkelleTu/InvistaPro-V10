import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ea = readFileSync(new URL('../public/downloads/InvistaPRO_EA.mq5', import.meta.url), 'utf8');

assert.ok(ea.includes('PriceActionRiskPercent = 1.0'), 'EA must expose the bounded Price Action risk setting');
assert.ok(ea.includes('PriceActionUseAIReview = true'), 'EA must expose AI-reviewed and autonomous strategy modes');
assert.ok(ea.includes('priceActionUseAIReview'), 'EA must transmit the selected Price Action mode to the server');
assert.ok(ea.includes('requestAccountType'), 'EA must transmit its actual terminal account mode on each signal request');
assert.ok(ea.includes('if (IsPriceActionEnabled() && !PriceActionUseAIReview)'), 'Autonomous mode must not invoke the AI position monitor');
assert.ok(ea.includes('CalculatePriceActionRiskLot'), 'EA must size Price Action orders from equity and structural stop');
assert.ok(ea.includes('riskDistance / entry > 0.015'), 'EA must reject stops wider than 1.5%');
assert.ok(ea.includes('rewardDistance / riskDistance < 2.0'), 'EA must enforce minimum executable R:R of 1:2');
assert.ok(ea.includes('breakeven em +1R'), 'EA must manage deterministic breakeven at +1R');
assert.ok(ea.includes('parcial de 50% realizada em +1,5R'), 'EA must manage the 50% partial at +1.5R');
assert.ok(ea.includes('CountManagedPositions() < MaxPositions'), 'Unrelated/manual positions must not block this EA instance');
assert.ok(ea.includes('if (signalId != "") g_pendingSignalId = signalId;'), 'Failed order attempts must not permanently consume the signal ID');
assert.ok(ea.includes('ManagedSymbolDigits()'), 'Stops must use the selected symbol precision, including Symbol_Override');
assert.ok(!ea.includes('trade.Buy(lotSize,  g_symbol, 0, 0, 0'), 'EA must not fall back to an unprotected BUY');
assert.ok(!ea.includes('trade.Sell(lotSize, g_symbol, 0, 0, 0'), 'EA must not fall back to an unprotected SELL');

assert.ok(!ea.includes('SYMBOL_VOLUME_DIGITS'), 'EA must not use the nonexistent SYMBOL_VOLUME_DIGITS enum');
assert.ok(ea.includes('int VolumeDigitsFromStep()'), 'Volume precision must derive from SYMBOL_VOLUME_STEP');
assert.ok(ea.includes('#property version   "8.2"'), 'Downloadable EA source must expose the updated version');
assert.ok(ea.includes('bool IsPriceActionEnabled()'), 'Price Action must be available on any chart symbol, with eligibility decided by validated market data and execution conditions');
assert.ok(ea.split('\n').filter((line) => line.includes('eaVersion')).every((line) => line.includes('8.2')), 'All signal payloads must report the same EA version');
assert.ok(ea.includes('CopyRates(g_symbol, timeframe, 1, count, rates)'), 'Strategy must exclude the still-forming candle');
assert.ok(ea.includes('trade.ResultDeal() > 0'), 'EA must confirm broker execution instead of trusting local request validation');

const route = readFileSync(new URL('../server/routes/metatrader-routes.ts', import.meta.url), 'utf8');
assert.ok(route.includes("code: 'MT5_EA_SOURCE_NOT_CURRENT'"), 'Download must fail closed when the canonical EA is missing or stale');
assert.ok(route.includes("if (eaVersion !== '8.2' || missingEaMarkers.length > 0)"), 'Download must validate the EA version and current strategy markers');
assert.ok(route.includes('const isPriceActionInstrument = sym.trim().length > 0;'), 'Server must not restrict the Price Action engine to a fixed symbol allowlist');
assert.ok(route.includes("'CalculatePriceActionRiskLot'"), 'Download gate must require the Price Action risk sizing implementation');
assert.ok(route.includes("'no-store, no-cache, must-revalidate, max-age=0'"), 'EA downloads must not be cached');

console.log('Price Action EA safety and download-version invariants passed (static source check only; MetaEditor compilation is separate).');
