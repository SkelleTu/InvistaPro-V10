import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ea = readFileSync(new URL('../public/downloads/InvistaPRO_EA_PriceAction.mq5', import.meta.url), 'utf8');
const legacyEa = readFileSync(new URL('../public/downloads/InvistaPRO_EA.mq5', import.meta.url), 'utf8');

assert.ok(ea.includes('PriceActionRiskPercent = 1.0'), 'EA must expose the bounded Price Action risk setting');
assert.ok(ea.includes('strategyMode\\\":\\\"PRICE_ACTION'), 'Dedicated EA must explicitly select the Price Action backend path');
assert.ok(ea.includes('priceActionUseAIReview\\\":false'), 'Dedicated EA must run the deterministic strategy without legacy AI/Girassol review');
assert.ok(!ea.includes('SendMarketDataForSyntheticGirassol();'), 'Dedicated EA must not call the legacy Girassol market-data channel');
assert.ok(!ea.includes('ScanChartIndicators();'), 'Dedicated EA must not scan legacy chart indicators');
assert.ok(legacyEa.includes('#property version   "8.1"'), 'Legacy Girassol EA must retain its original downloadable source/version');
assert.ok(ea.includes('priceActionUseAIReview'), 'EA must transmit the selected Price Action mode to the server');
assert.ok(ea.includes('requestAccountType'), 'EA must transmit its actual terminal account mode on each signal request');
assert.ok(ea.includes('if (IsPriceActionEnabled())'), 'Dedicated Price Action EA must not invoke the legacy AI position monitor');
assert.ok(ea.includes('CalculatePriceActionRiskLot'), 'EA must size Price Action orders from equity and structural stop');
assert.ok(ea.includes('OrderCalcProfit(orderType, g_symbol, 1.0, entryPrice, stopLoss, oneLotProfit)'), 'Risk sizing must use broker contract economics in account currency');
assert.ok(ea.includes('OrderCalcMargin(orderType, g_symbol, volume, entryPrice, requiredMargin)'), 'Risk sizing must reject insufficient margin');
assert.ok(ea.includes('void OnTradeTransaction('), 'EA must reconcile broker deal events for closed-trade accounting');
assert.ok(ea.includes('SyncClosedTradeReports()'), 'EA must retry closed-trade reporting after temporary HTTP failures');
assert.ok(ea.includes('DEAL_COMMISSION') && ea.includes('DEAL_SWAP') && ea.includes('DEAL_FEE'), 'Daily risk statistics must use net P&L including trading costs');
assert.ok(ea.includes('CountSymbolPositions() == 0'), 'EA must not merge a new strategy order into an existing same-symbol position');
assert.ok(ea.includes('CalculatePriceActionSwingStop'), 'Open positions must trail only by confirmed M5 swing structure');
assert.ok(ea.includes('SymbolSelect(g_symbol, true)'), 'EA must select and validate the actual chart/override symbol before operating');
assert.ok(ea.includes('SetTypeFillingBySymbol(g_symbol)'), 'EA must use the broker-supported filling policy');
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
assert.ok(ea.includes('#property version   "1.0"'), 'Dedicated Price Action EA must expose its independent version');
assert.ok(ea.includes('bool IsPriceActionEnabled()'), 'Price Action must be available on any chart symbol, with eligibility decided by validated market data and execution conditions');
assert.ok(ea.split('\n').filter((line) => line.includes('eaVersion')).every((line) => line.includes('1.0')), 'All signal payloads must report the dedicated Price Action EA version');
assert.ok(ea.includes('CopyRates(g_symbol, timeframe, 1, count, rates)'), 'Strategy must exclude the still-forming candle');
assert.ok(ea.includes('trade.ResultDeal() > 0'), 'EA must confirm broker execution instead of trusting local request validation');

const route = readFileSync(new URL('../server/routes/metatrader-routes.ts', import.meta.url), 'utf8');
assert.ok(route.includes("code: 'MT5_EA_SOURCE_NOT_CURRENT'"), 'Download must fail closed when the canonical EA is missing or stale');
assert.ok(route.includes("if (eaVersion !== '8.1' || missingEaMarkers.length > 0)"), 'Legacy download must continue validating the original Girassol EA version');
assert.ok(route.includes("router.get('/download-ea-price-action'"), 'Dedicated Price Action EA must have its own authenticated download endpoint');
assert.ok(route.includes("if (eaVersion !== '1.0' || missingEaMarkers.length > 0)"), 'Dedicated Price Action download must validate its independent version and safety markers');
assert.ok(route.includes("const isPriceActionInstrument = String(strategyMode ?? '').trim().toUpperCase() === 'PRICE_ACTION' && sym.trim().length > 0;"), 'Server must apply the strategy to any explicitly selected chart symbol without a fixed symbol allowlist');
assert.ok(route.includes("'CalculatePriceActionRiskLot'"), 'Download gate must require the Price Action risk sizing implementation');
assert.ok(route.includes("'no-store, no-cache, must-revalidate, max-age=0'"), 'EA downloads must not be cached');

console.log('Price Action EA safety and download-version invariants passed (static source check only; MetaEditor compilation is separate).');
