import express from "express";
import { getPaymentProviderAdapter } from "../services/payment-provider-adapter";
import {
  confirmVerifiedProviderPayment, findWithdrawalByProviderTransfer,
  markProviderWebhookProcessed, recordVerifiedProviderWebhook,
  releaseFailedWithdrawal, settleVerifiedWithdrawal,
} from "../services/financial-ledger";

const router = express.Router();

router.post("/:provider", async (req, res) => {
  let persistedEventId: string | null = null;
  try {
    const providerName = String(req.params.provider || "").toLowerCase();
    const adapter = getPaymentProviderAdapter();
    if (adapter.name.toLowerCase() !== providerName) {
      return res.status(404).json({ message: "Provedor não reconhecido." });
    }
    const rawBody = Buffer.isBuffer((req as any).rawBody) ? (req as any).rawBody as Buffer : null;
    if (!rawBody?.length) return res.status(400).json({ message: "Corpo original do webhook indisponível." });

    const verification = await adapter.verifyWebhook({ headers: req.headers, rawBody });
    if (!verification.verified || !verification.eventId || !verification.resourceId) {
      return res.status(401).json({ message: "Assinatura ou referência do webhook inválida." });
    }
    const saved = await recordVerifiedProviderWebhook({
      provider: adapter.name, providerEventId: verification.eventId,
      eventType: verification.eventType, signatureVerified: true,
      payload: verification.sanitizedPayload,
    });
    persistedEventId = saved.event?.id || null;
    if (saved.duplicate && saved.event?.processingStatus !== "failed") {
      return res.status(200).json({ received: true, duplicate: true });
    }

    const eventType = verification.eventType.toLowerCase();
    if (eventType.includes("payment")) {
      const payment = await adapter.fetchPayment(verification.resourceId);
      await confirmVerifiedProviderPayment({
        paymentIntentId: payment.externalReference,
        provider: adapter.name,
        providerPaymentId: payment.providerPaymentId,
        externalReference: payment.externalReference,
        amountCents: payment.amountCents,
        providerStatus: payment.status,
        webhookVerified: true,
        providerLookupVerified: true,
        rawSnapshot: { providerEventId: verification.eventId, providerStatus: payment.status },
      });
    } else if (eventType.includes("transfer") || eventType.includes("payout")) {
      const transfer = await adapter.fetchTransfer(verification.resourceId);
      const withdrawal = await findWithdrawalByProviderTransfer(adapter.name, transfer.providerTransferId);
      if (!withdrawal) throw new Error("WITHDRAWAL_FOR_PROVIDER_TRANSFER_NOT_FOUND");
      const status = String(transfer.status).toLowerCase();
      if (["paid", "approved", "completed", "success"].includes(status)) {
        if (Number(transfer.amountCents) !== Number(withdrawal.netAmountCents)) {
          throw new Error("PROVIDER_TRANSFER_AMOUNT_MISMATCH");
        }
        await settleVerifiedWithdrawal({
          withdrawalId: withdrawal.id, provider: adapter.name,
          providerTransferId: transfer.providerTransferId, verifiedStatus: status,
          webhookVerified: true, providerLookupVerified: true,
        });
      } else if (["failed", "rejected", "cancelled", "canceled"].includes(status)) {
        await releaseFailedWithdrawal({
          withdrawalId: withdrawal.id, reason: `Provedor confirmou status ${status}`,
          provider: adapter.name, providerTransferId: transfer.providerTransferId,
          providerLookupVerified: true,
        });
      }
      // Pending/unknown outcomes stay reserved/submitted and are not released.
    } else {
      await markProviderWebhookProcessed(saved.event.id, "ignored", "Evento não financeiro ou tipo ainda não suportado.");
      return res.status(200).json({ received: true, ignored: true });
    }

    if (persistedEventId) await markProviderWebhookProcessed(persistedEventId, "processed");
    return res.status(200).json({ received: true, processed: true });
  } catch (error) {
    if (persistedEventId) await markProviderWebhookProcessed(
      persistedEventId, "failed", error instanceof Error ? error.message : String(error),
    ).catch(() => {});
    console.error("Provider webhook processing failed:", error);
    return res.status(500).json({ message: "Webhook recebido, mas a conciliação não foi concluída; o provedor poderá reenviar." });
  }
});

export default router;
