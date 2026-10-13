/**
 * Production policy for Deriv synthetic-index trading.
 *
 * Eligibility is modality-specific: a symbol is usable only after active_symbols
 * identifies it as a synthetic/derived market and contracts_for confirms the
 * requested contract. The only unconditional symbol exclusion is every 1-second
 * market, regardless of how Deriv formats its code or display name.
 */
const BLOCKED_1S_SYMBOL = /(?:\(\s*1s\s*\)|^1HZ|_1S$)/i;

export function normalizeDerivSymbol(symbol: unknown): string {
  return String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+INDEX$/i, "")
    .replace(/[^A-Z0-9_]/g, "");
}

export function isBlockedOneSecondSymbol(symbol: unknown): boolean {
  const raw = String(symbol ?? "").trim();
  const normalized = normalizeDerivSymbol(raw);
  return BLOCKED_1S_SYMBOL.test(raw) || BLOCKED_1S_SYMBOL.test(normalized);
}

/** Generic symbol safety gate; live modality support is checked separately. */
export function isAllowedProductionSymbol(symbol: unknown): boolean {
  const normalized = normalizeDerivSymbol(symbol);
  return normalized.length > 0 && /^[A-Z0-9_]+$/.test(normalized) && !isBlockedOneSecondSymbol(symbol);
}

export function assertAllowedProductionSymbol(symbol: unknown, operation: string): void {
  if (!isAllowedProductionSymbol(symbol)) {
    throw new Error(`Blocked Deriv symbol "${String(symbol ?? "")}" in ${operation}; 1-second symbols are prohibited.`);
  }
}

export const ALLOWED_PRODUCTION_CONTRACT_TYPES = new Set(["ACCU", "DIGITDIFF"]);

export function isAllowedProductionContractType(contractType: unknown): boolean {
  return ALLOWED_PRODUCTION_CONTRACT_TYPES.has(String(contractType ?? "").trim().toUpperCase());
}

/** Modality to Deriv contract mapping. Unknown modes fail closed. */
export function contractTypesForProductionMode(mode: unknown): string[] {
  const normalized = String(mode ?? "").trim().toLowerCase().replace(/[-\s]/g, "_");
  if (["digit_diff", "digit_differs", "digitdiff", "digit_differs_mode"].includes(normalized)) return ["DIGITDIFF"];
  if (["accumulator", "accu"].includes(normalized)) return ["ACCU"];
  return [];
}

/** Stake minimums are contract-specific; unknown contracts fail closed. */
export function minimumStakeForContract(contractType: unknown): number {
  const normalizedType = String(contractType ?? "").trim().toUpperCase();
  if (!ALLOWED_PRODUCTION_CONTRACT_TYPES.has(normalizedType)) {
    throw new Error(`Blocked Deriv contract type "${String(contractType ?? "")}"; no production minimum stake is defined.`);
  }
  return normalizedType === "ACCU" ? 1 : 0.35;
}

export function isValidProductionStake(contractType: unknown, amount: unknown): boolean {
  if (!isAllowedProductionContractType(contractType) || typeof amount !== "number" || !Number.isFinite(amount)) return false;
  return amount >= minimumStakeForContract(contractType);
}
