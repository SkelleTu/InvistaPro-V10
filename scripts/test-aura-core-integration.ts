import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const aura = readFileSync("public/downloads/InvistaPRO_V10_Aura_MT5_v1_50.mq5", "utf8");
const routes = readFileSync("server/routes/metatrader-routes.ts", "utf8");
const bridge = readFileSync("server/services/metatrader-bridge.ts", "utf8");

assert.match(aura, /RequestCentralAIApproval\(g_setupDirection\)/);
assert.match(aura, /\/api\/metatrader\/signal-with-indicators/);
assert.match(aura, /priceActionUseAIReview\\\":true/);
assert.match(aura, /clientStrategy\\\":\\\"AURA_PRICE_ACTION/);
assert.match(aura, /confidence<70\.0/);
assert.match(aura, /executionEnabled\\\":true/);
assert.match(aura, /CurrentAccountType\(\)/);
assert.match(aura, /\/api\/mt5\/position\/monitor/);
assert.match(aura, /CLOSE_PROFIT/);
assert.match(aura, /CLOSE_SPIKE_EXIT/);
assert.match(aura, /CLOSE_LOSS_PREVENTION/);
assert.match(aura, /trade\.PositionClose\(ticket\)/);
assert.match(aura, /RequestCentralPositionManagement\(positionTicket\)/);
assert.match(aura, /void OnTradeTransaction\(/);
assert.match(aura, /ReportAuraPositionOpened\(/);
assert.match(aura, /ReportAuraPositionUpdated\(/);
assert.match(aura, /ReportAuraPositionClosed\(/);
assert.match(aura, /void RetryPendingAuraClose\(/);
assert.match(aura, /RetryPendingAuraClose\(\);/);
assert.match(aura, /\/api\/mt5\/trade\/open/);
assert.match(aura, /\/api\/mt5\/trade\/update/);
assert.match(aura, /\/api\/mt5\/trade\/close/);
assert.match(routes, /syncPositionFromEa\(normalizedPosition\)/);
assert.match(bridge, /syncPositionFromEa\(position: MT5Position\)/);
assert.match(bridge, /const alreadyTracked = this.openPositions.has\(position.ticket\)/);
assert.match(routes, /clientStrategy !== 'AURA_PRICE_ACTION'/);
assert.match(routes, /const requireGirassol = metaTraderBridge\.getConfig\(\)\.requireGirassolConfirmation && clientStrategy !== 'AURA_PRICE_ACTION'/);
assert.match(routes, /executionEnabled:\s+true/);
assert.match(routes, /generateSignal\(resolvedSymbol\)|generateSignal\(targetSymbol\)/);

console.log("Aura central AI integration contract validated.");
