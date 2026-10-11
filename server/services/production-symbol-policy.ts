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
  "DIGITMATCH",
  "DIGITEVEN",
  "DIGITODD",
  "DIGITOVER",
  "DIGITUNDER",
]);

export function isAllowedProductionContractType(contractType: unknown): boolean {
  return ALLOWED_PRODUCTION_CONTRACT_TYPES.has(String(contractType ?? "").trim().toUpperCase());
}

export function minimumStakeForContract(contractType: unknown): number {
  return String(contractType ?? "").trim().toUpperCase() === "ACCU" ? 1 : 0.35;
}
