import assert from "node:assert/strict";
import {
  getMt5ProductionBlock,
  isMt5ProductionTradingEnabled,
} from "../server/services/mt5-production-policy";

assert.equal(isMt5ProductionTradingEnabled({ MT5_PRODUCTION_TRADING_ENABLED: "true" }), true);
assert.equal(isMt5ProductionTradingEnabled({ MT5_PRODUCTION_TRADING_ENABLED: " TRUE " }), true);
assert.equal(isMt5ProductionTradingEnabled({ MT5_PRODUCTION_TRADING_ENABLED: "false" }), false);
assert.equal(isMt5ProductionTradingEnabled({ MT5_PRODUCTION_TRADING_ENABLED: undefined }), false);

assert.equal(getMt5ProductionBlock("", { NODE_ENV: "production" }, "demo")?.code, "MT5_API_TOKEN_NOT_CONFIGURED");
assert.equal(getMt5ProductionBlock("", { NODE_ENV: "production" }, "real")?.code, "MT5_API_TOKEN_NOT_CONFIGURED");

// DEMO and REAL are treated identically: neither needs a second authorization flag.
assert.equal(getMt5ProductionBlock("ea-token", { NODE_ENV: "production" }, "demo"), null);
assert.equal(getMt5ProductionBlock("ea-token", { NODE_ENV: "production" }, "real"), null);
assert.equal(getMt5ProductionBlock("ea-token", { NODE_ENV: "production", MT5_DEMO_TRADING_ENABLED: "false" }, "demo"), null,
  "The legacy DEMO-only flag must not create a different execution policy");
assert.equal(getMt5ProductionBlock("ea-token", { NODE_ENV: "production", MT5_PRODUCTION_TRADING_ENABLED: "false" }, "demo")?.code,
  "MT5_PRODUCTION_TRADING_DISABLED");
assert.equal(getMt5ProductionBlock("ea-token", { NODE_ENV: "production", MT5_PRODUCTION_TRADING_ENABLED: "false" }, "real")?.code,
  "MT5_PRODUCTION_TRADING_DISABLED",
  "The emergency stop must apply equally to DEMO and REAL");
assert.equal(getMt5ProductionBlock("ea-token", { NODE_ENV: "production" }, "contest")?.code,
  "MT5_ACCOUNT_MODE_BLOCKED");

console.log("✅ Política unificada DEMO/REAL validada.");
