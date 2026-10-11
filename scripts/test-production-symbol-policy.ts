import assert from "node:assert/strict";
import {
  isAllowedProductionSymbol,
  normalizeDerivSymbol,
  isAllowedProductionContractType,
  minimumStakeForContract,
  isValidProductionStake,
} from "../server/services/production-symbol-policy";

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

for (const type of ["ACCU", "DIGITDIFF"]) {
  assert.equal(isAllowedProductionContractType(type), true, `Expected allowed contract type: ${type}`);
}
for (const type of ["DIGITMATCH", "DIGITEVEN", "DIGITODD", "DIGITOVER", "DIGITUNDER"]) {
  assert.equal(isAllowedProductionContractType(type), false, `Expected denied contract type: ${type}`);
}
for (const type of ["CALL", "PUT", "MULTUP", "MULTDOWN", "ONETOUCH", "LBFLOATCALL", ""]) {
  assert.equal(isAllowedProductionContractType(type), false, `Expected denied contract type: ${type}`);
}
assert.equal(minimumStakeForContract("DIGITDIFF"), 0.35);
assert.equal(minimumStakeForContract("ACCU"), 1);
for (const type of ["CALL", "PUT", "MULTUP", "UNKNOWN", "", null, undefined]) {
  assert.throws(
    () => minimumStakeForContract(type),
    /Blocked Deriv contract type/,
    `Unsupported contract must fail closed: ${String(type)}`,
  );
}

assert.equal(isValidProductionStake("DIGITDIFF", 0.35), true);
assert.equal(isValidProductionStake("DIGITDIFF", 0.34), false);
assert.equal(isValidProductionStake("ACCU", 1), true);
assert.equal(isValidProductionStake("ACCU", 0.99), false);
for (const amount of [NaN, Infinity, -Infinity, -1, 0, "1", null, undefined]) {
  assert.equal(isValidProductionStake("DIGITDIFF", amount), false, `Invalid stake must fail closed: ${String(amount)}`);
}
assert.equal(isValidProductionStake("CALL", 10), false);

console.log(`Production policy passed: ${allowed.length} canonical symbols, ${aliases.length} aliases, ${denied.length} denied symbols, ACCU/DIGITDIFF-only contract allowlist, and fail-closed minimum stakes.`);
