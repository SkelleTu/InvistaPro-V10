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
