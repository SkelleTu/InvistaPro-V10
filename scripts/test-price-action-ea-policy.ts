import assert from 'node:assert/strict';
import { isPriceActionCryptoSymbol } from '../server/services/price-action-symbol-policy';
import { readFileSync } from 'node:fs';

const ea = readFileSync(new URL('../public/downloads/InvistaPRO_EA.mq5', import.meta.url), 'utf8');

assert.ok(ea.includes('serverRiskPercent < 1.0 || serverRiskPercent > 2.0'), 'EA must enforce the server-configured 1% to 2% risk range');
assert.ok(ea.includes('#define PRICE_ACTION_SPREAD_ATR_M1_PERCENT 20.0'), 'EA M1 spread cap must match the server strategy policy');
assert.ok(ea.includes('#define PRICE_ACTION_SPREAD_ATR_M5_PERCENT 8.0'), 'EA M5 spread cap must match the server strategy policy');
assert.ok(ea.includes('#define PRICE_ACTION_SPREAD_PRICE_CAP_PERCENT 0.10'), 'EA hard spread cap must match the server strategy policy');
assert.ok(ea.includes('PriceActionUseAIReview = true'), 'EA must expose AI-reviewed and autonomous strategy modes');
assert.ok(ea.includes('priceActionUseAIReview'), 'EA must transmit the selected Price Action mode to the server');
assert.ok(ea.includes('requestAccountType'), 'EA must transmit its actual terminal account mode on each signal request');
assert.ok(ea.includes('if (IsPriceActionCryptoSymbol() && !PriceActionUseAIReview)'), 'Autonomous mode must not invoke the AI position monitor');
assert.ok(ea.includes('CalculatePriceActionRiskLot'), 'EA must size Price Action orders from equity and structural stop');
assert.ok(ea.includes('CalculatePriceActionRiskLot(entry, stopLoss, spreadCost, serverRiskPercent)'), 'EA must reserve round-trip spread cost when sizing risk');
assert.ok(ea.includes('MathMax(currentSpread * (2.0 + extraCostSpreadMultiplier), estimatedRoundTripCost)'), 'EA must include server round-trip commission/slippage estimate without understating live spread');
assert.ok(ea.includes('ExtractJsonDouble(resp, "estimatedRoundTripCost")'), 'EA must read server-side total cost estimate');
assert.ok(ea.includes('ExtractJsonDouble(resp, "extraCostSpreadMultiplier")'), 'EA must read the server cost multiplier');
assert.ok(ea.includes('ExtractJsonDouble(resp, "riskPercent")'), 'EA must read the server-configured risk percentage');
assert.ok(ea.includes('currentSpread * (2.0 + extraCostSpreadMultiplier)'), 'EA must reapply the cost multiplier to the live spread');
assert.ok(ea.includes('IsAdaptivePriceActionSpreadAcceptable(entry, currentSpread, maxAllowedSpread)'), 'EA must adapt spread limits to strategy conditions');
assert.ok(ea.includes('iATR(g_symbol, PERIOD_M1, 14)'), 'Adaptive spread filter must use M1 trigger volatility');
assert.ok(ea.includes('iATR(g_symbol, PERIOD_M5, 14)'), 'Adaptive spread filter must use M5 confirmation volatility');
assert.ok(ea.includes('MathMin(MathMin(m1Limit, m5Limit), priceCap)'), 'Adaptive spread limit must retain a hard price-based ceiling');
assert.ok(ea.includes('netRiskReward < 2.0'), 'EA must enforce net 1:2 R:R after estimated spread costs');
assert.ok(ea.includes('riskDistance / entry > 0.015'), 'EA must reject stops wider than 1.5%');
assert.ok(ea.includes('netRiskReward < 2.0'), 'EA must enforce net executable R:R of 1:2 after spread');
assert.ok(ea.includes('breakeven em +1R'), 'EA must manage deterministic breakeven at +1R');
assert.ok(ea.includes('parcial de 50% realizada em +1,5R'), 'EA must manage the 50% partial at +1.5R');
assert.ok(ea.includes('CountManagedPositions() < MaxPositions'), 'Unrelated/manual positions must not block this EA instance');
assert.ok(ea.includes('if (signalId != "") g_pendingSignalId = signalId;'), 'Failed order attempts must not permanently consume the signal ID');
assert.ok(ea.includes('ManagedSymbolDigits()'), 'Stops must use the selected symbol precision, including Symbol_Override');
assert.ok(!ea.includes('trade.Buy(lotSize,  g_symbol, 0, 0, 0'), 'EA must not fall back to an unprotected BUY');
assert.ok(!ea.includes('trade.Sell(lotSize, g_symbol, 0, 0, 0'), 'EA must not fall back to an unprotected SELL');

assert.ok(!ea.includes('SYMBOL_VOLUME_DIGITS'), 'EA must not use the nonexistent SYMBOL_VOLUME_DIGITS enum');
assert.ok(ea.includes('int VolumeDigitsFromStep()'), 'Volume precision must derive from SYMBOL_VOLUME_STEP');
assert.ok(ea.includes('#property version   "8.4"'), 'Downloadable EA source must expose the updated version');
assert.ok(ea.includes('string suffixes[9]'), 'EA must recognize only supported broker suffixes for crypto symbols');
assert.ok(ea.split('\\n').filter((line) => line.includes('eaVersion')).every((line) => line.includes('8.4')), 'All signal payloads must report the same EA version');
assert.ok(ea.includes('CopyRates(g_symbol, timeframe, 1, count, rates)'), 'Strategy must exclude the still-forming candle');
assert.ok(ea.includes('trade.ResultDeal() > 0'), 'EA must confirm broker execution instead of trusting local request validation');

const context = readFileSync(new URL('../server/services/price-action-context.ts', import.meta.url), 'utf8');
assert.ok(context.includes('atrM1 * 0.20'), 'Server spread policy must adapt to M1 ATR');
assert.ok(context.includes('atrM5 * 0.08'), 'Server spread policy must adapt to M5 ATR');
assert.ok(context.includes('mid * 0.001'), 'Server spread policy must retain the 0.10% price cap');
assert.ok(context.includes('limits.length ? Math.min(...limits) : undefined'), 'Server must fail closed when adaptive ATR limits are unavailable');
assert.ok(context.includes('MT5_PRICE_ACTION_EXTRA_COST_SPREAD_MULTIPLIER'), 'Server must require an extra-cost multiplier compatible with the automatically observed spread');

const route = readFileSync(new URL('../server/routes/metatrader-routes.ts', import.meta.url), 'utf8');
assert.ok(route.includes("code: 'MT5_EA_SOURCE_NOT_CURRENT'"), 'Download must fail closed when the canonical EA is missing or stale');
assert.ok(route.includes("if (eaVersion !== '8.4' || missingEaMarkers.length > 0)"), 'Download must validate the EA version and current strategy markers');
assert.ok(route.includes("'CalculatePriceActionRiskLot'"), 'Download gate must require the Price Action risk sizing implementation');
assert.ok(route.includes("'CalculatePriceActionRiskLot(entry, stopLoss, spreadCost, serverRiskPercent)'"), 'Download gate must require cost-aware risk sizing');
assert.ok(route.includes("'netRiskReward < 2.0'"), 'Download gate must require the net R:R check');
assert.ok(route.includes("'BuildMultiTimeframeJson()'"), 'Download gate must require multi-timeframe candle transmission');
assert.ok(route.includes("'modo PARCIAL não pode substituir ou remover SL/TP estruturais'"), 'Download gate must require immutable structural stops');
assert.ok(route.includes("'MathMax(currentSpread * (2.0 + extraCostSpreadMultiplier), estimatedRoundTripCost)'"), 'Download gate must require EA full round-trip cost handling');
assert.ok(route.includes("'ExtractJsonDouble(resp, \"estimatedRoundTripCost\")'"), 'Download gate must require EA to read server cost estimate');
assert.ok(route.includes("'ExtractJsonDouble(resp, \"extraCostSpreadMultiplier\")'"), 'Download gate must require EA to read server cost multiplier');
assert.ok(route.includes("'no-store, no-cache, must-revalidate, max-age=0'"), 'EA downloads must not be cached');

console.log('Price Action EA safety and download-version invariants passed (static source check only; MetaEditor compilation is separate).');

assert.ok(ea.includes('if (!IsPriceActionCryptoSymbol())'), 'Manual SL/TP overrides must be disabled for Price Action crypto');
assert.ok(ea.includes('modo PARCIAL não pode substituir ou remover SL/TP estruturais'), 'Partial mode must preserve server-approved structural stops');
assert.ok(route.includes("from '../services/price-action-symbol-policy'"), 'Route must import the shared bounded crypto symbol policy');
assert.ok(route.includes('const isStrategyCrypto = isPriceActionCryptoSymbol(sym)'), 'Route must apply the deterministic crypto-symbol policy');
assert.ok(!route.includes('balance: 0,\n      equity: 0,\n      freeMargin: 0'), 'Signal polling must not synthesize zero-value account heartbeats');

for (const symbol of ['BTCUSD', 'BTCUSDm', 'm.BTCUSD', 'BTCUSDT.r', 'XBTUSD', 'ETHUSD.a', 'SOLUSDT', 'BTCUSDpro']) {
  assert.equal(isPriceActionCryptoSymbol(symbol), true, `Supported crypto alias must be recognized: ${symbol}`);
}
for (const symbol of ['EURUSD', 'BTC', 'BTCJPY', 'NOTBTCUSD', 'BTCUSDXYZ', 'ETHGBP', 'SOLJPY']) {
  assert.equal(isPriceActionCryptoSymbol(symbol), false, `Unsupported symbol must not enter crypto strategy: ${symbol}`);
}
