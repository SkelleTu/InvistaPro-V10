import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ea = readFileSync(new URL('../public/downloads/InvistaPRO_PriceAction_EA.mq5', import.meta.url), 'utf8');
const route = readFileSync(new URL('../server/routes/metatrader-routes.ts', import.meta.url), 'utf8');
const page = readFileSync(new URL('../client/src/pages/metatrader-page.tsx', import.meta.url), 'utf8');
const ai = readFileSync(new URL('../server/services/huggingface-ai.ts', import.meta.url), 'utf8');

assert.ok(ea.includes('#property version   "1.0"'), 'Price Action EA must have its own version');
assert.ok(ea.includes('_Symbol'), 'EA must operate on the selected chart symbol');
assert.ok(ea.includes('CopyRates(_Symbol, tf, 1, count, rates)'), 'EA must use closed candles only');
assert.ok(ea.includes('PERIOD_H4') && ea.includes('PERIOD_H1') && ea.includes('PERIOD_M15') && ea.includes('PERIOD_M5') && ea.includes('PERIOD_M1'), 'EA must implement top-down multi-timeframe analysis');
assert.ok(ea.includes('/api/mt5/price-action/review'), 'EA must request independent AI pre-trigger review');
assert.ok(ea.includes('g_approvedPatternTime>0'), 'EA must retain and revalidate AI-approved pre-trigger before final breakout');
assert.ok(ea.includes('InpRiskPercent>2.0'), 'EA must cap configurable risk at 2%');
assert.ok(ea.includes('InpMaxStopPercent>1.5'), 'EA must cap stop distance at 1.5%');
assert.ok(ea.includes('InpMinimumRR<2.0'), 'EA must enforce minimum net reward/risk of 1:2');
assert.ok(ea.includes('OrderCalcProfit'), 'Position size must use account-currency loss per lot');
assert.ok(ea.includes('SYMBOL_VOLUME_STEP') && ea.includes('SYMBOL_VOLUME_MIN') && ea.includes('SYMBOL_VOLUME_MAX'), 'Volume must respect broker contract steps and limits');
assert.ok(ea.includes('TRADE_RETCODE_DONE'), 'EA must validate execution return code');
assert.ok(ea.includes('PositionModify'), 'EA must manage protective stops');
assert.ok(ea.includes('PositionClosePartial'), 'EA must support partial exit');
assert.ok(ea.includes('if(!IsDemoAccount())'), 'This validation build must block non-DEMO accounts');
assert.ok(!ea.toLowerCase().includes('binance'), 'EA strategy must not depend on Binance');
assert.ok(!ea.toLowerCase().includes('deriv'), 'EA strategy must not depend on Deriv');
assert.ok(!ea.includes('Symbol_Override'), 'EA must use the chart symbol, not a broker-specific override');

assert.ok(route.includes("router.post('/price-action/review'"), 'Server must expose the protected broker-neutral AI review');
assert.ok(route.includes("router.get('/download-price-action-ea'"), 'Server must expose a separate Price Action EA download');
assert.ok(route.includes('mt5EaTokenAccess'), 'AI review must require the EA token');
assert.ok(route.includes('InvistaPRO_PriceAction_EA.mq5'), 'Download must serve the independent source file');
assert.ok(page.includes('button-download-price-action-ea'), 'Dashboard must expose a separate Price Action download button');
assert.ok(page.includes('/api/mt5/download-price-action-ea'), 'Dashboard must use the independent download route');
assert.ok(ai.includes('reviewPriceActionSnapshot'), 'Price Action AI provider must call the existing ensemble');

console.log('Broker-neutral Price Action EA static policy checks passed. MetaEditor compilation and DEMO execution remain separate gates.');
