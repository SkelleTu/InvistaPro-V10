import assert from "node:assert/strict";
import {
  isAllowedProductionSymbol,
  normalizeDerivSymbol,
  isAllowedProductionContractType,
  minimumStakeForContract,
  isValidProductionStake,
  isBlockedOneSecondSymbol,
  contractTypesForProductionMode,
  normalizeProductionMode,
  PRODUCTION_MODALITY_CONTRACT_TYPES,
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

const expectedMappings: Record<string, string> = {
  digit_differs: "DIGITDIFF",
  digit_matches: "DIGITMATCH",
  digit_even: "DIGITEVEN",
  digit_odd: "DIGITODD",
  digit_over: "DIGITOVER",
  digit_under: "DIGITUNDER",
  rise: "CALL",
  fall: "PUT",
  higher: "CALLE",
  lower: "PUTE",
  ends_between: "EXPIRYRANGE",
  ends_outside: "EXPIRYMISS",
  stays_between: "RANGE",
  goes_outside: "UPORDOWN",
  touch: "ONETOUCH",
  no_touch: "NOTOUCH",
  multiplier_up: "MULTUP",
  multiplier_down: "MULTDOWN",
  accumulator: "ACCU",
  turbo_up: "TURBOSLONG",
  turbo_down: "TURBOSSHORT",
  vanilla_call: "VANILLALONGCALL",
  vanilla_put: "VANILLALONGPUT",
  lookback_high_close: "LBFLOATPUT",
  lookback_close_low: "LBFLOATCALL",
  lookback_high_low: "LBHIGHLOW",
};

assert.deepEqual(PRODUCTION_MODALITY_CONTRACT_TYPES, expectedMappings);
for (const [mode, contractType] of Object.entries(expectedMappings)) {
  assert.deepEqual(contractTypesForProductionMode(mode), [contractType], `Mapping failed for ${mode}`);
  assert.equal(isAllowedProductionContractType(contractType), true, `Expected allowed contract type: ${contractType}`);
}
assert.deepEqual(contractTypesForProductionMode("digit-diff"), ["DIGITDIFF"]);
assert.deepEqual(contractTypesForProductionMode("accu"), ["ACCU"]);
assert.equal(normalizeProductionMode("MULTUP"), "multiplier_up");
assert.equal(normalizeProductionMode("CALL"), "rise");
assert.deepEqual(contractTypesForProductionMode("unsupported-mode"), []);
for (const type of ["UNKNOWN", "", null, undefined]) {
  assert.equal(isAllowedProductionContractType(type), false, `Unknown contract must fail closed: ${String(type)}`);
}

assert.equal(minimumStakeForContract("DIGITDIFF"), 0.35);
assert.equal(minimumStakeForContract("ACCU"), 1);
assert.equal(minimumStakeForContract("MULTUP"), 1);
for (const type of ["UNKNOWN", "", null, undefined]) {
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
assert.equal(isValidProductionStake("CALL", 0.35), true);
assert.equal(isValidProductionStake("CALL", 0.34), false);
assert.equal(isValidProductionStake("MULTUP", 1), true);
assert.equal(isValidProductionStake("MULTUP", 0.99), false);
for (const amount of [NaN, Infinity, -Infinity, -1, 0, "1", null, undefined]) {
  assert.equal(isValidProductionStake("DIGITDIFF", amount), false, `Invalid stake must fail closed: ${String(amount)}`);
}
assert.equal(isValidProductionStake("UNKNOWN", 100), false);

console.log(`Production policy passed: ${allowed.length} Deriv symbols, ${aliases.length} aliases, ${denied.length} invalid/1s symbols blocked, and all ${Object.keys(expectedMappings).length} platform modalities mapped to live-validated Deriv contracts.`);
