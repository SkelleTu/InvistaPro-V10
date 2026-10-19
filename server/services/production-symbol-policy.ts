/**
 * Production policy for Deriv synthetic-index trading.
 *
 * A modality is eligible only after active_symbols identifies a synthetic/derived
 * market and contracts_for confirms the contract type for that exact symbol.
 * Every one-second market remains blocked regardless of its API/display alias.
 */
const BLOCKED_1S_SYMBOL = /(?:\(\s*1s\s*\)|^1HZ|_1S$)/i;

export function normalizeDerivSymbol(symbol: unknown): string {
  return String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+INDEX$/i, "")
    .replace(/[^A-Z0-9_]/g, "")
    .replace(/^(BOOM|CRASH)_+(\d+)/, "$1$2");
}

export function isBlockedOneSecondSymbol(symbol: unknown): boolean {
  const raw = String(symbol ?? "").trim();
  const normalized = normalizeDerivSymbol(raw);
  return BLOCKED_1S_SYMBOL.test(raw) || BLOCKED_1S_SYMBOL.test(normalized);
}

/** Generic symbol safety gate; live modality support is checked separately. */
export function isAllowedProductionSymbol(symbol: unknown): boolean {
  const raw = String(symbol ?? "").trim();
  const normalized = normalizeDerivSymbol(raw);
  return raw.length > 0 &&
    !["undefined", "null", "none", "n/a"].includes(raw.toLowerCase()) &&
    /^[A-Z0-9_ ()-]+$/i.test(raw) &&
    normalized.length > 0 &&
    /^[A-Z0-9_]+$/.test(normalized) &&
    !isBlockedOneSecondSymbol(raw);
}

export function assertAllowedProductionSymbol(symbol: unknown, operation: string): void {
  if (!isAllowedProductionSymbol(symbol)) {
    throw new Error(`Blocked Deriv symbol "${String(symbol ?? "")}" in ${operation}; 1-second symbols are prohibited.`);
  }
}

/**
 * Canonical platform modality -> Deriv contract type.
 * This list reflects the modalities currently exposed in trading-system.tsx.
 * Availability is never assumed: contracts_for is checked before execution.
 */
export const PRODUCTION_MODALITY_CONTRACT_TYPES: Readonly<Record<string, string>> = {
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

const MODE_ALIASES: Readonly<Record<string, string>> = {
  digit_diff: "digit_differs",
  digitdiff: "digit_differs",
  digit_differs_mode: "digit_differs",
  digitmatch: "digit_matches",
  digit_matches_mode: "digit_matches",
  digiteven: "digit_even",
  digitodd: "digit_odd",
  digitover: "digit_over",
  digitunder: "digit_under",
  call: "rise",
  put: "fall",
  calle: "higher",
  pute: "lower",
  expiry_range: "ends_between",
  expiryrange: "ends_between",
  expiry_miss: "ends_outside",
  expirymiss: "ends_outside",
  stays_between: "stays_between",
  goes_outside: "goes_outside",
  one_touch: "touch",
  onetouch: "touch",
  notouch: "no_touch",
  multup: "multiplier_up",
  multdown: "multiplier_down",
  accu: "accumulator",
  turboslong: "turbo_up",
  turboshort: "turbo_down",
  vanillalongcall: "vanilla_call",
  vanillalongput: "vanilla_put",
  lbfloatput: "lookback_high_close",
  lbfloatcall: "lookback_close_low",
  lbhighlow: "lookback_high_low",
};

export function normalizeProductionMode(mode: unknown): string {
  const normalized = String(mode ?? "").trim().toLowerCase().replace(/[-\s]+/g, "_");
  return MODE_ALIASES[normalized] ?? normalized;
}

export const ALLOWED_PRODUCTION_CONTRACT_TYPES = new Set(
  Object.values(PRODUCTION_MODALITY_CONTRACT_TYPES)
);

export function isAllowedProductionContractType(contractType: unknown): boolean {
  return ALLOWED_PRODUCTION_CONTRACT_TYPES.has(String(contractType ?? "").trim().toUpperCase());
}

/** Modality to Deriv contract mapping. Unknown modes fail closed. */
export function contractTypesForProductionMode(mode: unknown): string[] {
  const canonicalMode = normalizeProductionMode(mode);
  const contractType = PRODUCTION_MODALITY_CONTRACT_TYPES[canonicalMode];
  return contractType ? [contractType] : [];
}

/** Conservative local floors; Deriv's proposal response remains authoritative. */
export function minimumStakeForContract(contractType: unknown): number {
  const normalizedType = String(contractType ?? "").trim().toUpperCase();
  if (!ALLOWED_PRODUCTION_CONTRACT_TYPES.has(normalizedType)) {
    throw new Error(`Blocked Deriv contract type "${String(contractType ?? "")}"; no production minimum stake is defined.`);
  }
  if (["ACCU", "MULTUP", "MULTDOWN"].includes(normalizedType)) return 1;
  return 0.35;
}

export function isValidProductionStake(contractType: unknown, amount: unknown): boolean {
  if (!isAllowedProductionContractType(contractType) || typeof amount !== "number" || !Number.isFinite(amount)) return false;
  return amount >= minimumStakeForContract(contractType);
}
