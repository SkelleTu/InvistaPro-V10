import type { VerifiedProviderPayment } from "./payment-domain";

export type ProviderWebhookVerification = {
  verified: true;
  eventId: string;
  eventType: string;
  resourceId: string;
  sanitizedPayload: Record<string, unknown>;
};

export type ProviderPixPayment = {
  providerPaymentId: string;
  externalReference: string;
  amountCents: number;
  status: string;
  qrCode: string;
  qrCodeBase64?: string;
  checkoutUrl?: string;
  expiresAt?: Date;
  sanitizedSnapshot: Record<string, unknown>;
};

export type ProviderPixTransfer = {
  providerTransferId: string;
  status: string;
  amountCents: number;
  sanitizedSnapshot: Record<string, unknown>;
};

export interface PaymentProviderAdapter {
  readonly name: string;
  createPixPayment(input: {
    intentId: string; amountCents: number; currency: "BRL";
    payerEmail: string; description: string; idempotencyKey: string;
  }): Promise<ProviderPixPayment>;
  fetchPayment(providerPaymentId: string): Promise<VerifiedProviderPayment>;
  verifyWebhook(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer;
  }): Promise<ProviderWebhookVerification>;
  createPixTransfer(input: {
    withdrawalId: string; amountCents: number; destination: string;
    idempotencyKey: string;
  }): Promise<ProviderPixTransfer>;
  fetchTransfer(providerTransferId: string): Promise<ProviderPixTransfer>;
  healthCheck(): Promise<{ ready: boolean; detail?: string }>;
}

let activeAdapter: PaymentProviderAdapter | null = null;

/** Register only a server-side adapter. Never accept provider credentials from a browser request. */
export function registerPaymentProviderAdapter(adapter: PaymentProviderAdapter) {
  if (!adapter?.name) throw new Error("PAYMENT_PROVIDER_ADAPTER_INVALID");
  activeAdapter = adapter;
}

export function getPaymentProviderAdapter(): PaymentProviderAdapter {
  if (!activeAdapter) throw new Error("PAYMENT_PROVIDER_NOT_CONFIGURED");
  return activeAdapter;
}

export function isPaymentProviderReady(): boolean {
  return activeAdapter !== null;
}
