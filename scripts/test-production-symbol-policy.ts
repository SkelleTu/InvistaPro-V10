import assert from "node:assert/strict";
import {
  isAllowedProductionSymbol,
  normalizeDerivSymbol,
  isAllowedProductionContractType,
  minimumStakeForContract,
  isValidProductionStake,
  isBlockedOneSecondSymbol,
  contractTypesForProductionMode,
} from "../server/services/production-symbol-policy";

const allowed = ["BOOM500", "BOOM1000", "CRASH500", "CRASH1000", "R_10", "R_25", "R_50", "R_75", "R_100", "BOOM300", "CRASH300", "JD10", "RDBULL"];
const aliases = ["BOOM_500", "BOOM 1000 Index", "CRASH_500", "CRASH 1000 Index", "Volatility 50 Index"];
const denied = [
  "1HZ100V", "BOOM1000 (1s)", "CRASH500_1S", "R_100_1S", "WIN$", "", "undefined",
];

for (const symbol of allowed) assert.equal(isAllowedProductionSymbol(symbol), true, `Expected allow: ${symbol}`);
for (const symbol of aliases) assert.equal(isAllowedProductionSymbol(symbol), true, `Expected normalized alias allow: ${symbol}`);
for (const symbol of denied) assert.equal(isAllowedProductionSymbol(symbol), false, `Expected deny: ${symbol}`);
assert.equal(normalizeDerivSymbol("BOOM_1000"), "BOOM1000");
for (const symbol of ["1HZ10V", "Volatility 100 (1s) Index", "R_50_1S"]) {
  assert.equal(isBlockedOneSecondSymbol(symbol), true, `Every 1s alias must be blocked: ${symbol}`);
}
for (const symbol of ["R_10", "BOOM500", "JD10"]) {
  assert.equal(isBlockedOneSecondSymbol(symbol), false, `Regular symbol must not be treated as 1s: ${symbol}`);
}
assert.deepEqual(contractTypesForProductionMode("digit_differs"), ["DIGITDIFF"]);
assert.deepEqual(contractTypesForProductionMode("digit-diff"), ["DIGITDIFF"]);
assert.deepEqual(contractTypesForProductionMode("accumulator"), ["ACCU"]);
assert.deepEqual(contractTypesForProductionMode("accu"), ["ACCU"]);
assert.deepEqual(contractTypesForProductionMode("unsupported-mode"), []);

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
for (const type of ["DIGITMATCH", "DIGITEVEN", "DIGITODD", "DIGITOVER", "DIGITUNDER", "CALL", "PUT", "MULTUP"]) {
  assert.equal(isValidProductionStake(type, 100), false, `Disallowed contract must fail closed: ${type}`);
}

console.log(`Production policy passed: ${allowed.length} dynamic Deriv symbols, ${aliases.length} aliases, ${denied.length} invalid/1s symbols blocked, modality-to-contract mapping, ACCU/DIGITDIFF-only contract allowlist, and fail-closed minimum stakes.`);
