import assert from "node:assert/strict";
import { isAllowedProductionSymbol, normalizeDerivSymbol } from "../server/services/production-symbol-policy";

const allowed = ["BOOM500", "BOOM1000", "CRASH500", "CRASH1000"];
const aliases = ["BOOM_500", "BOOM 1000 Index", "CRASH_500", "CRASH 1000 Index"];
const denied = [
  "R_10", "R_100", "1HZ100V", "BOOM300", "CRASH300",
  "EURUSD", "WIN$", "", "undefined",
];

for (const symbol of allowed) assert.equal(isAllowedProductionSymbol(symbol), true, `Expected allow: ${symbol}`);
for (const symbol of aliases) assert.equal(isAllowedProductionSymbol(symbol), true, `Expected normalized alias allow: ${symbol}`);
for (const symbol of denied) assert.equal(isAllowedProductionSymbol(symbol), false, `Expected deny: ${symbol}`);
assert.equal(normalizeDerivSymbol("BOOM_1000"), "BOOM1000");

console.log(`Production symbol policy passed: ${allowed.length} canonical symbols, ${aliases.length} normalized aliases, ${denied.length} denied symbols.`);
