import assert from "node:assert/strict";
import {
  getMt5ProductionBlock,
  isMt5ProductionTradingEnabled,
} from "../server/services/mt5-production-policy";

assert.equal(isMt5ProductionTradingEnabled({ MT5_PRODUCTION_TRADING_ENABLED: "true" }), true);
assert.equal(isMt5ProductionTradingEnabled({ MT5_PRODUCTION_TRADING_ENABLED: " TRUE " }), true);
assert.equal(isMt5ProductionTradingEnabled({ MT5_PRODUCTION_TRADING_ENABLED: "false" }), false);
assert.equal(isMt5ProductionTradingEnabled({ MT5_PRODUCTION_TRADING_ENABLED: undefined }), false);

assert.equal(getMt5ProductionBlock("", { NODE_ENV: "development", MT5_PRODUCTION_TRADING_ENABLED: "false" }), null);
assert.equal(
  getMt5ProductionBlock("ea-token", { NODE_ENV: "production", MT5_PRODUCTION_TRADING_ENABLED: "false" })?.code,
  "MT5_PRODUCTION_TRADING_DISABLED",
);
assert.equal(
  getMt5ProductionBlock("", { NODE_ENV: "production", MT5_PRODUCTION_TRADING_ENABLED: "true" })?.code,
  "MT5_API_TOKEN_NOT_CONFIGURED",
);
assert.equal(
  getMt5ProductionBlock("ea-token", { NODE_ENV: "production", MT5_PRODUCTION_TRADING_ENABLED: "true" }, "real", true),
  null,
);

assert.equal(
  getMt5ProductionBlock("ea-token", { NODE_ENV: "production", MT5_PRODUCTION_TRADING_ENABLED: "false" }, "demo"),
  null,
  "A confirmed DEMO account must be usable for operational validation without enabling REAL trading",
);
assert.equal(
  getMt5ProductionBlock("ea-token", { NODE_ENV: "production", MT5_DEMO_TRADING_ENABLED: "false" }, "demo")?.code,
  "MT5_DEMO_TRADING_DISABLED",
);
assert.equal(
  getMt5ProductionBlock("ea-token", { NODE_ENV: "production", MT5_PRODUCTION_TRADING_ENABLED: "false" }, "real", true)?.code,
  "MT5_PRODUCTION_TRADING_DISABLED",
);
assert.equal(
  getMt5ProductionBlock("ea-token", { NODE_ENV: "production" }, "real")?.code,
  "MT5_PRODUCTION_TRADING_DISABLED",
  "REAL must remain blocked until dashboard authorization is explicitly enabled",
);
assert.equal(
  getMt5ProductionBlock("ea-token", { NODE_ENV: "production" }, "real", true),
  null,
  "Explicit dashboard authorization may enable REAL when no global emergency block is set",
);
assert.equal(
  getMt5ProductionBlock("ea-token", { NODE_ENV: "production", MT5_PRODUCTION_TRADING_ENABLED: "true" }, "contest")?.code,
  "MT5_ACCOUNT_MODE_BLOCKED",
);

console.log("✅ Política de sinais de produção MT5 validada.");
