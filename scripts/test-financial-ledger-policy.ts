import assert from "node:assert/strict";
import {
  assertPositiveCents, calculateLiabilityBalance, splitWithdrawal, validateBalancedLedgerLines,
} from "../server/services/financial-ledger-policy";

assert.doesNotThrow(() => assertPositiveCents(1));
for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN]) {
  assert.throws(() => assertPositiveCents(value));
}
assert.deepEqual(validateBalancedLedgerLines([
  { direction: "debit", amountCents: 1050 },
  { direction: "credit", amountCents: 1000 },
  { direction: "credit", amountCents: 50 },
]), { debitCents: 1050, creditCents: 1050 });
assert.throws(() => validateBalancedLedgerLines([
  { direction: "debit", amountCents: 1000 },
  { direction: "credit", amountCents: 999 },
]), /LEDGER_NOT_BALANCED/);
assert.throws(() => validateBalancedLedgerLines([
  { direction: "debit", amountCents: 1000, currency: "USD" },
  { direction: "credit", amountCents: 1000, currency: "USD" },
]), /LEDGER_CURRENCY_UNSUPPORTED/);
assert.equal(calculateLiabilityBalance(15000, 2500), 12500);
assert.equal(splitWithdrawal(10000, 250).netAmountCents, 9750);
assert.throws(() => splitWithdrawal(10000, 10000), /WITHDRAWAL_FEE_INVALID/);
console.log("✓ financial ledger policy: integer cents, BRL-only, balanced postings, liabilities and withdrawal split");
