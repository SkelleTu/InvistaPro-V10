/**
 * Provider-neutral payment rules.
 *
 * This module deliberately does not create charges or credit balances. A provider
 * adapter must first authenticate its webhook and fetch/verify the payment with
 * the provider, then pass the verified snapshot here before any ledger mutation.
 */
export type PaymentStatus = "pending" | "approved" | "rejected" | "cancelled" | "refunded";

export interface PaymentIntentSnapshot {
  id: string;
  userId: string;
  amountCents: number;
  currency: "BRL";
  status: PaymentStatus;
  providerPaymentId?: string | null;
}

export interface VerifiedProviderPayment {
  providerPaymentId: string;
  externalReference: string;
  amountCents: number;
  currency: string;
  status: string;
  webhookVerified: boolean;
  providerLookupVerified: boolean;
}

export interface PaymentReconciliation {
  status: PaymentStatus;
  shouldCredit: boolean;
  duplicate: boolean;
}

export function parseAmountToCents(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("PAYMENT_AMOUNT_INVALID");
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents < 1 || Math.abs(amount * 100 - cents) > 0.000001) {
    throw new Error("PAYMENT_AMOUNT_PRECISION_INVALID");
  }
  return cents;
}

function normalizeStatus(status: string): PaymentStatus {
  switch (String(status).trim().toLowerCase()) {
    case "approved": return "approved";
    case "pending":
    case "in_process":
    case "in_mediation": return "pending";
    case "rejected": return "rejected";
    case "cancelled":
    case "canceled": return "cancelled";
    case "refunded":
    case "charged_back": return "refunded";
    default: throw new Error("PAYMENT_STATUS_UNSUPPORTED");
  }
}

/**
 * Validates a provider-verified payment against the immutable intent.
 * Only the first verified transition from pending to approved may credit.
 */
export function reconcileVerifiedPayment(
  intent: PaymentIntentSnapshot,
  payment: VerifiedProviderPayment,
): PaymentReconciliation {
  if (!payment.webhookVerified || !payment.providerLookupVerified) {
    throw new Error("PAYMENT_PROVIDER_VERIFICATION_REQUIRED");
  }
  if (!payment.providerPaymentId || !payment.externalReference ||
      payment.externalReference !== intent.id) {
    throw new Error("PAYMENT_REFERENCE_MISMATCH");
  }
  if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents !== intent.amountCents) {
    throw new Error("PAYMENT_AMOUNT_MISMATCH");
  }
  if (payment.currency.toUpperCase() !== intent.currency) {
    throw new Error("PAYMENT_CURRENCY_MISMATCH");
  }

  const nextStatus = normalizeStatus(payment.status);
  const sameApprovedPayment = intent.status === "approved" &&
    intent.providerPaymentId === payment.providerPaymentId &&
    nextStatus === "approved";
  if (sameApprovedPayment) {
    return { status: "approved", shouldCredit: false, duplicate: true };
  }
  if (intent.status !== "pending") {
    throw new Error("PAYMENT_STATE_TRANSITION_INVALID");
  }
  return {
    status: nextStatus,
    shouldCredit: nextStatus === "approved",
    duplicate: false,
  };
}
