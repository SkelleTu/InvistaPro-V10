export type DerivAccountType = 'demo' | 'real';

export interface ModuleTokenCandidate {
  slotIndex: number | null;
  token: string;
  accountType: string;
  isActive: boolean | null;
}

/**
 * Resolve credentials only within the requested account environment.
 * Prefer this module's slot, then the primary token, then the lowest-numbered
 * active slot. Never fall back between Demo and Real.
 */
export function selectModuleTokenForAccount<T extends ModuleTokenCandidate>(
  tokens: T[],
  slotIndex: number,
  accountType: DerivAccountType,
): T | undefined {
  const matching = tokens.filter(
    token => token.isActive === true &&
      token.accountType === accountType &&
      typeof token.token === 'string' &&
      token.token.trim().length > 0,
  );
  return matching.find(token => token.slotIndex === slotIndex)
    ?? matching.find(token => token.slotIndex === null)
    ?? matching
      .filter(token => token.slotIndex !== null)
      .sort((a, b) => (a.slotIndex ?? Number.MAX_SAFE_INTEGER) - (b.slotIndex ?? Number.MAX_SAFE_INTEGER))[0];
}
