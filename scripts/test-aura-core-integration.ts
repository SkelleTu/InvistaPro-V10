import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const aura = readFileSync("public/downloads/InvistaPRO_V10_Aura_MT5_v1_50.mq5", "utf8");
const routes = readFileSync("server/routes/metatrader-routes.ts", "utf8");

assert.match(aura, /RequestCentralAIApproval\(g_setupDirection\)/,
  "Aura must require central approval immediately before order execution");
assert.match(aura, /\/api\/metatrader\/signal-with-indicators/,
  "Aura must call the central signal and AI consensus endpoint");
assert.match(aura, /priceActionUseAIReview\\\":true/,
  "Aura must require AI review, not strategy-only approval");
assert.match(aura, /clientStrategy\\\":\\\"AURA_PRICE_ACTION/,
  "Aura must identify its deterministic strategy to the backend");
assert.match(aura, /confidence<0\.70/,
  "Aura must reject central confidence below 70 percent");
assert.match(aura, /executionEnabled\\\":true/,
  "Aura must require explicit backend execution approval");
assert.match(aura, /accountType\\\":\\\"\+accountType/,
  "Aura must report the actual connected MT5 account mode");
assert.match(routes, /clientStrategy !== 'AURA_PRICE_ACTION'/,
  "Backend must scope the Aura Girassol-gate exception to the Aura strategy");
assert.match(routes, /generateSignal\(sym\)|generateSignal\(symbol/,
  "Central route must retain the core AI signal generation pipeline");

console.log("Aura central AI integration contract validated.");
