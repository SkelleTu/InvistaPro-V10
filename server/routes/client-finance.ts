import express from "express";
import { isAuthenticated } from "../auth";
import { createPaymentIntent, attachProviderPayment, getProviderPaymentForIntent, getClientFinancialSummary, listClientLedger, listClientWithdrawals, markWithdrawalSubmitted, reserveWithdrawal } from "../services/financial-ledger";
import { parseAmountToCents } from "../services/payment-domain";
import { getPaymentProviderAdapter, isPaymentProviderReady } from "../services/payment-provider-adapter";
import { dualStorage } from "../storage-dual";

const router = express.Router();

function sessionUserId(req: express.Request) {
  return String((req as any).session?.passport?.user || "");
}

// Read-only until the payment provider and financial activation gates are approved.
router.get("/summary", isAuthenticated, async (req, res) => {
  try {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ message: "Sessão inválida." });
    const summary = await getClientFinancialSummary(userId);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    return res.json(summary);
  } catch (error) {
    console.error("Client financial summary unavailable:", error);
    return res.status(503).json({ message: "Resumo financeiro contábil ainda indisponível." });
  }
});

router.get("/ledger", isAuthenticated, async (req, res) => {
  try {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ message: "Sessão inválida." });
    const limit = Number.parseInt(String(req.query.limit || "100"), 10);
    const offset = Number.parseInt(String(req.query.offset || "0"), 10);
    if (!Number.isFinite(limit) || !Number.isFinite(offset) || offset < 0) {
      return res.status(400).json({ message: "Paginação inválida." });
    }
    const entries = await listClientLedger(userId, limit, offset);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    return res.json({ entries, limit: Math.min(Math.max(limit, 1), 1000), offset });
  } catch (error) {
    console.error("Client ledger unavailable:", error);
    return res.status(503).json({ message: "Extrato contábil ainda indisponível." });
  }
});

router.get("/withdrawals", isAuthenticated, async (req, res) => {
  try {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ message: "Sessão inválida." });
    const limit = Number.parseInt(String(req.query.limit || "100"), 10);
    const withdrawals = await listClientWithdrawals(userId, Number.isFinite(limit) ? limit : 100);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    return res.json(withdrawals.map((item: any) => ({
      id: item.id, amountCents: item.amountCents, feeCents: item.feeCents,
      netAmountCents: item.netAmountCents, currency: item.currency,
      status: item.status, requestedAt: item.requestedAt, completedAt: item.completedAt,
      failureReason: item.failureReason,
    })));
  } catch (error) {
    console.error("Client withdrawals unavailable:", error);
    return res.status(503).json({ message: "Histórico de saques ainda indisponível." });
  }
});

router.post("/deposits", isAuthenticated, async (req, res) => {
  try {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ message: "Sessão inválida." });
    if (process.env.DEPOSITS_ENABLED !== "true") {
      return res.status(503).json({ code: "DEPOSITS_DISABLED", message: "Aportes reais estão bloqueados até a homologação e ativação explícita do provedor." });
    }
    if (!isPaymentProviderReady()) return res.status(503).json({ code: "PAYMENT_PROVIDER_NOT_CONFIGURED", message: "Provedor de pagamento não configurado." });
    const idempotencyKey = String(req.header("Idempotency-Key") || req.body?.idempotencyKey || "");
    if (!idempotencyKey || idempotencyKey.length > 160) return res.status(400).json({ message: "Chave Idempotency-Key obrigatória." });
    const amountCents = Number.isSafeInteger(req.body?.amountCents) ? Number(req.body.amountCents) : parseAmountToCents(req.body?.amount);
    const user = await dualStorage.getUser(userId);
    if (!user?.email) return res.status(404).json({ message: "Cadastro do cliente não encontrado." });
    const intentResult = await createPaymentIntent({ userId, amountCents, idempotencyKey });
    if (intentResult.intent.status === "pending" && intentResult.intent.providerPaymentId) {
      const existingPayment = await getProviderPaymentForIntent(intentResult.intent.id);
      if (existingPayment) {
        const snapshot = existingPayment.rawSnapshot as Record<string, unknown>;
        return res.status(200).json({
          intentId: intentResult.intent.id, status: intentResult.intent.status,
          provider: existingPayment.provider, qrCode: snapshot.qrCode || null,
          qrCodeBase64: snapshot.qrCodeBase64 || null, checkoutUrl: snapshot.checkoutUrl || null,
          expiresAt: intentResult.intent.expiresAt || null, duplicate: true,
        });
      }
      return res.status(409).json({ message: "A cobrança já existe; aguarde a reconciliação do provedor." });
    }
    if (intentResult.intent.status !== "created") {
      return res.status(409).json({ message: "Esta intenção já foi encerrada ou liquidada. Crie uma nova solicitação com outra chave de idempotência." });
    }
    const adapter = getPaymentProviderAdapter();
    const pix = await adapter.createPixPayment({
      intentId: intentResult.intent.id, amountCents, currency: "BRL",
      payerEmail: user.email, description: "Aporte InvistaPRO", idempotencyKey,
    });
    if (pix.externalReference !== intentResult.intent.id || pix.amountCents !== amountCents || !pix.providerPaymentId || !pix.qrCode) {
      return res.status(502).json({ message: "O provedor retornou dados incompatíveis; nenhum saldo foi creditado." });
    }
    await attachProviderPayment({
      paymentIntentId: intentResult.intent.id, provider: adapter.name,
      providerPaymentId: pix.providerPaymentId, amountCents: pix.amountCents,
      providerStatus: pix.status,
      rawSnapshot: { ...pix.sanitizedSnapshot, qrCode: pix.qrCode, qrCodeBase64: pix.qrCodeBase64 || null, checkoutUrl: pix.checkoutUrl || null },
    });
    return res.status(201).json({
      intentId: intentResult.intent.id, status: "pending", provider: adapter.name,
      qrCode: pix.qrCode, qrCodeBase64: pix.qrCodeBase64 || null,
      checkoutUrl: pix.checkoutUrl || null, expiresAt: pix.expiresAt || null,
      message: "Pagamento criado. O saldo só será atualizado após confirmação independente do provedor.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Client deposit intent failed:", message);
    if (message === "PAYMENT_AMOUNT_INVALID" || message === "PAYMENT_AMOUNT_PRECISION_INVALID" ||
        message === "INVALID_AMOUNT_CENTS" || message === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST") {
      return res.status(400).json({ message: "Valor ou chave de idempotência inválidos." });
    }
    return res.status(503).json({ message: "Não foi possível iniciar o aporte. Nenhum saldo foi creditado." });
  }
});

router.post("/withdrawals", isAuthenticated, async (req, res) => {
  try {
    const userId = sessionUserId(req);
    if (!userId) return res.status(401).json({ message: "Sessão inválida." });
    if (process.env.WITHDRAWALS_ENABLED !== "true") {
      return res.status(503).json({ code: "WITHDRAWALS_DISABLED", message: "Saques reais estão bloqueados até a homologação e ativação explícita do provedor." });
    }
    if (!isPaymentProviderReady()) return res.status(503).json({ code: "PAYOUT_PROVIDER_NOT_CONFIGURED", message: "Provedor de transferências não configurado." });
    const idempotencyKey = String(req.header("Idempotency-Key") || req.body?.idempotencyKey || "");
    if (!idempotencyKey || idempotencyKey.length > 160) return res.status(400).json({ message: "Chave Idempotency-Key obrigatória." });
    const amountCents = Number.isSafeInteger(req.body?.amountCents) ? Number(req.body.amountCents) : parseAmountToCents(req.body?.amount);
    const user = await dualStorage.getUser(userId);
    if (!user) return res.status(404).json({ message: "Cadastro do cliente não encontrado." });
    if (!user.contaAprovada || !user.documentosVerificados) return res.status(403).json({ message: "Conta e documentação precisam estar aprovadas para solicitar saque." });
    const destinationKey = String(user.chavePix || "").trim();
    const destinationType = String(user.tipoChavePix || "").trim();
    if (!destinationKey || !destinationType) return res.status(400).json({ message: "Cadastre uma chave PIX válida antes de solicitar saque." });
    const feeCents = Number.parseInt(String(process.env.WITHDRAWAL_FEE_CENTS || "0"), 10);
    if (!Number.isSafeInteger(feeCents) || feeCents < 0 || feeCents >= amountCents) return res.status(503).json({ message: "Política de taxas de saque não configurada." });
    const reservation = await reserveWithdrawal({
      userId, amountCents, feeCents, idempotencyKey, actorUserId: userId,
      destinationKey, destinationType,
    });
    const withdrawal = reservation.withdrawal;
    if (withdrawal.status !== "reserved") {
      return res.status(200).json({ withdrawalId: withdrawal.id, status: withdrawal.status, duplicate: true });
    }
    const adapter = getPaymentProviderAdapter();
    const transfer = await adapter.createPixTransfer({
      withdrawalId: withdrawal.id, amountCents: Number(withdrawal.netAmountCents),
      destination: destinationKey, idempotencyKey: `withdrawal:${idempotencyKey}`,
    });
    if (!transfer.providerTransferId || transfer.amountCents !== Number(withdrawal.netAmountCents)) {
      return res.status(202).json({ withdrawalId: withdrawal.id, status: "reserved", message: "Reserva mantida para conciliação; não tente novamente com outra chave de idempotência." });
    }
    const submitted = await markWithdrawalSubmitted(withdrawal.id, adapter.name, transfer.providerTransferId);
    return res.status(202).json({
      withdrawalId: submitted.id, status: submitted.status,
      amountCents: submitted.amountCents, feeCents: submitted.feeCents,
      netAmountCents: submitted.netAmountCents,
      message: "Solicitação enviada. O saque só será concluído após confirmação independente do provedor.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Client withdrawal request failed:", message);
    if (message === "INSUFFICIENT_AVAILABLE_BALANCE") return res.status(409).json({ message: "Saldo disponível insuficiente." });
    if (message === "PAYMENT_AMOUNT_INVALID" || message === "PAYMENT_AMOUNT_PRECISION_INVALID" ||
        message === "INVALID_AMOUNT_CENTS" || message === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST") {
      return res.status(400).json({ message: "Valor ou chave de idempotência inválidos." });
    }
    return res.status(503).json({ message: "Não foi possível concluir a solicitação. Se houve reserva, ela permanecerá protegida até a conciliação." });
  }
});

export default router;
