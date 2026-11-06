import assert from "node:assert/strict";
import { parseAmountToCents, reconcileVerifiedPayment, type PaymentIntentSnapshot } from "../server/services/payment-domain";

const intent: PaymentIntentSnapshot = {
  id: "intent-123",
  userId: "user-123",
  amountCents: 35000,
  currency: "BRL",
  status: "pending",
};

assert.equal(parseAmountToCents("350,00"), 35000);
assert.equal(parseAmountToCents(130), 13000);
assert.throws(() => parseAmountToCents(0), /PAYMENT_AMOUNT_INVALID/);
assert.throws(() => parseAmountToCents(1.001), /PAYMENT_AMOUNT_PRECISION_INVALID/);

const approved = reconcileVerifiedPayment(intent, {
  providerPaymentId: "provider-payment-1",
  externalReference: intent.id,
  amountCents: 35000,
  currency: "BRL",
  status: "approved",
  webhookVerified: true,
  providerLookupVerified: true,
});
assert.deepEqual(approved, { status: "approved", shouldCredit: true, duplicate: false });

const duplicate = reconcileVerifiedPayment({
  ...intent, status: "approved", providerPaymentId: "provider-payment-1",
}, {
  providerPaymentId: "provider-payment-1",
  externalReference: intent.id,
  amountCents: 35000,
  currency: "BRL",
  status: "approved",
  webhookVerified: true,
  providerLookupVerified: true,
});
assert.deepEqual(duplicate, { status: "approved", shouldCredit: false, duplicate: true });

const pending = reconcileVerifiedPayment(intent, {
  providerPaymentId: "provider-payment-2",
  externalReference: intent.id,
  amountCents: 35000,
  currency: "BRL",
  status: "in_process",
  webhookVerified: true,
  providerLookupVerified: true,
});
assert.equal(pending.shouldCredit, false);
assert.equal(pending.status, "pending");

const unsafeBase = {
  providerPaymentId: "provider-payment-3",
  externalReference: intent.id,
  amountCents: 35000,
  currency: "BRL",
  status: "approved",
  webhookVerified: true,
  providerLookupVerified: true,
};
assert.throws(() => reconcileVerifiedPayment(intent, { ...unsafeBase, webhookVerified: false }), /PAYMENT_PROVIDER_VERIFICATION_REQUIRED/);
assert.throws(() => reconcileVerifiedPayment(intent, { ...unsafeBase, providerLookupVerified: false }), /PAYMENT_PROVIDER_VERIFICATION_REQUIRED/);
assert.throws(() => reconcileVerifiedPayment(intent, { ...unsafeBase, amountCents: 34999 }), /PAYMENT_AMOUNT_MISMATCH/);
assert.throws(() => reconcileVerifiedPayment(intent, { ...unsafeBase, externalReference: "other-intent" }), /PAYMENT_REFERENCE_MISMATCH/);
assert.throws(() => reconcileVerifiedPayment(intent, { ...unsafeBase, currency: "USD" }), /PAYMENT_CURRENCY_MISMATCH/);
assert.throws(() => reconcileVerifiedPayment({ ...intent, status: "rejected" }, unsafeBase), /PAYMENT_STATE_TRANSITION_INVALID/);

console.log("Provider-neutral payment reconciliation tests passed.");
