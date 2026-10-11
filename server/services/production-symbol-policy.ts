/**
 * Production symbol policy shared by market-data and order-execution paths.
 * Only these four Deriv synthetic indices are permitted in this deployment.
 */
export const ALLOWED_PRODUCTION_SYMBOLS = new Set([
  "BOOM500",
  "BOOM1000",
  "CRASH500",
  "CRASH1000",
]);

export function normalizeDerivSymbol(symbol: unknown): string {
  return String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+INDEX$/i, "")
    .replace(/[^A-Z0-9]/g, "");
}

export function isAllowedProductionSymbol(symbol: unknown): boolean {
  return ALLOWED_PRODUCTION_SYMBOLS.has(normalizeDerivSymbol(symbol));
}

export function assertAllowedProductionSymbol(symbol: unknown, operation: string): void {
  if (!isAllowedProductionSymbol(symbol)) {
    throw new Error(`Blocked Deriv symbol "${String(symbol ?? "")}" in ${operation}; production allowlist is BOOM500, BOOM1000, CRASH500, CRASH1000.`);
  }
}

export const ALLOWED_PRODUCTION_CONTRACT_TYPES = new Set([
  "ACCU",
  "DIGITDIFF",
]);

export function isAllowedProductionContractType(contractType: unknown): boolean {
  return ALLOWED_PRODUCTION_CONTRACT_TYPES.has(String(contractType ?? "").trim().toUpperCase());
}

/**
 * Return a stake only for a contract type explicitly allowed by production policy.
 * Unknown contract types must fail closed instead of inheriting the Digit minimum.
 */
export function minimumStakeForContract(contractType: unknown): number {
  const normalizedType = String(contractType ?? "").trim().toUpperCase();
  if (!ALLOWED_PRODUCTION_CONTRACT_TYPES.has(normalizedType)) {
    throw new Error(`Blocked Deriv contract type "${String(contractType ?? "")}"; no production minimum stake is defined.`);
  }
  return normalizedType === "ACCU" ? 1 : 0.35;
}

/** Validate stake shape and contract-specific minimum before any Deriv order is sent. */
export function isValidProductionStake(contractType: unknown, amount: unknown): boolean {
  if (!isAllowedProductionContractType(contractType) || typeof amount !== "number" || !Number.isFinite(amount)) {
    return false;
  }
  return amount >= minimumStakeForContract(contractType);
}
