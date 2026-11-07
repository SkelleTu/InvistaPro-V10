export type LedgerDirection = "debit" | "credit";
export type LedgerPolicyLine = { direction: LedgerDirection; amountCents: number; currency?: string };

export function assertPositiveCents(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("INVALID_AMOUNT_CENTS");
}

export function validateBalancedLedgerLines(lines: LedgerPolicyLine[]): { debitCents: number; creditCents: number } {
  if (!Array.isArray(lines) || lines.length < 2) throw new Error("LEDGER_REQUIRES_TWO_ENTRIES");
  let debitCents = 0;
  let creditCents = 0;
  for (const line of lines) {
    assertPositiveCents(line.amountCents);
    if (line.currency && line.currency !== "BRL") throw new Error("LEDGER_CURRENCY_UNSUPPORTED");
    if (line.direction === "debit") debitCents += line.amountCents;
    else if (line.direction === "credit") creditCents += line.amountCents;
    else throw new Error("LEDGER_DIRECTION_INVALID");
  }
  if (!Number.isSafeInteger(debitCents) || !Number.isSafeInteger(creditCents) || debitCents !== creditCents) {
    throw new Error("LEDGER_NOT_BALANCED");
  }
  return { debitCents, creditCents };
}

export function calculateLiabilityBalance(creditCents: number, debitCents: number): number {
  if (!Number.isSafeInteger(creditCents) || creditCents < 0 ||
      !Number.isSafeInteger(debitCents) || debitCents < 0) throw new Error("LEDGER_TOTAL_INVALID");
  const balance = creditCents - debitCents;
  if (!Number.isSafeInteger(balance)) throw new Error("LEDGER_BALANCE_OVERFLOW");
  return balance;
}

export function splitWithdrawal(amountCents: number, feeCents: number) {
  assertPositiveCents(amountCents);
  if (!Number.isSafeInteger(feeCents) || feeCents < 0 || feeCents >= amountCents) throw new Error("WITHDRAWAL_FEE_INVALID");
  return { amountCents, feeCents, netAmountCents: amountCents - feeCents };
}
