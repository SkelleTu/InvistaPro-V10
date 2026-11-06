import { and, desc, eq, sql } from "drizzle-orm";
import { reconcileVerifiedPayment } from "./payment-domain";
import { pgDb, pgSchema, isPostgresAvailable } from "../db-postgres";

export type ClientAccountKind = "client_available" | "client_reserved" | "client_capital" | "client_yield";
type LedgerLine = { accountId: string; direction: "debit" | "credit"; amountCents: number; currency?: "BRL" };
type PostLedgerInput = {
  idempotencyKey: string; eventType: string; description: string;
  referenceType?: string; referenceId?: string; createdBy?: string;
  metadata?: Record<string, unknown>; entries: LedgerLine[];
};

function requirePostgres() {
  if (!isPostgresAvailable || !pgDb) throw new Error("DURABLE_POSTGRES_REQUIRED");
  return pgDb;
}

function assertCents(value: number, name = "amountCents") {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`INVALID_${name.toUpperCase()}`);
}

export async function ensureClientFinancialAccounts(userId: string, txArg?: any) {
  if (!userId) throw new Error("USER_REQUIRED");
  const db = txArg || requirePostgres();
  const kinds: ClientAccountKind[] = ["client_available", "client_reserved", "client_capital", "client_yield"];
  for (const kind of kinds) {
    const code = `${userId}:${kind.toUpperCase()}`;
    await db.insert(pgSchema.financialAccounts).values({
      accountCode: code, ownerUserId: userId, accountKind: kind, currency: "BRL", status: "active",
    }).onConflictDoNothing();
  }
  const accounts = await db.select().from(pgSchema.financialAccounts)
    .where(eq(pgSchema.financialAccounts.ownerUserId, userId));
  return Object.fromEntries(accounts.map((account: any) => [account.accountKind, account]));
}

export async function postLedgerTransaction(input: PostLedgerInput) {
  const db = requirePostgres();
  if (!input.idempotencyKey || input.idempotencyKey.length > 160) throw new Error("INVALID_IDEMPOTENCY_KEY");
  if (input.entries.length < 2) throw new Error("LEDGER_REQUIRES_TWO_ENTRIES");
  let debit = 0, credit = 0;
  for (const line of input.entries) {
    assertCents(line.amountCents);
    if (line.direction === "debit") debit += line.amountCents;
    else if (line.direction === "credit") credit += line.amountCents;
    else throw new Error("INVALID_LEDGER_DIRECTION");
  }
  if (!Number.isSafeInteger(debit) || debit !== credit) throw new Error("LEDGER_NOT_BALANCED");

  return db.transaction(async (tx: any) => {
    const inserted = await tx.insert(pgSchema.ledgerTransactions).values({
      idempotencyKey: input.idempotencyKey, eventType: input.eventType,
      description: input.description, referenceType: input.referenceType || null,
      referenceId: input.referenceId || null, createdBy: input.createdBy || null,
      metadata: input.metadata || {},
    }).onConflictDoNothing().returning();
    if (!inserted.length) {
      const [existing] = await tx.select().from(pgSchema.ledgerTransactions)
        .where(eq(pgSchema.ledgerTransactions.idempotencyKey, input.idempotencyKey)).limit(1);
      return { transaction: existing, duplicate: true };
    }
    const transaction = inserted[0];
    await tx.insert(pgSchema.ledgerEntries).values(input.entries.map(line => ({
      transactionId: transaction.id, accountId: line.accountId, direction: line.direction,
      amountCents: line.amountCents, currency: line.currency || "BRL",
    })));
    return { transaction, duplicate: false };
  });
}

export async function getClientFinancialSummary(userId: string) {
  const db = requirePostgres();
  const accounts = await ensureClientFinancialAccounts(userId);
  const rows = await db.select({
    accountId: pgSchema.ledgerEntries.accountId,
    direction: pgSchema.ledgerEntries.direction,
    total: sql<string>`COALESCE(SUM(${pgSchema.ledgerEntries.amountCents}),0)::text`,
  }).from(pgSchema.ledgerEntries)
    .where(sql`${pgSchema.ledgerEntries.accountId} IN (${sql.join(Object.values(accounts).map((a: any) => sql`${a.id}::uuid`), sql`,`)})`)
    .groupBy(pgSchema.ledgerEntries.accountId, pgSchema.ledgerEntries.direction);
  const balances: Record<string, number> = {};
  for (const [kind, account] of Object.entries(accounts) as [string, any][]) {
    const debit = Number(rows.find((r: any) => r.accountId === account.id && r.direction === "debit")?.total || 0);
    const credit = Number(rows.find((r: any) => r.accountId === account.id && r.direction === "credit")?.total || 0);
    balances[kind] = Math.round((credit - debit));
  }
  return { currency: "BRL", unit: "centavos", balances, legacyBalanceNotReconciled: true };
}

export async function reserveWithdrawal(input: {
  userId: string; amountCents: number; feeCents: number; idempotencyKey: string; actorUserId: string;
}) {
  assertCents(input.amountCents);
  if (!Number.isSafeInteger(input.feeCents) || input.feeCents < 0 || input.feeCents >= input.amountCents) throw new Error("INVALID_FEE");
  const db = requirePostgres();
  return db.transaction(async (tx: any) => {
    const accounts = await ensureClientFinancialAccounts(input.userId, tx);
    const available = accounts.client_available;
    const reserved = accounts.client_reserved;
    await tx.execute(sql`SELECT id FROM financial_accounts WHERE id = ${available.id}::uuid FOR UPDATE`);
    const [existing] = await tx.select().from(pgSchema.withdrawalRequests)
      .where(eq(pgSchema.withdrawalRequests.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existing) {
      if (existing.userId !== input.userId || Number(existing.amountCents) !== input.amountCents || Number(existing.feeCents) !== input.feeCents) {
        throw new Error("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST");
      }
      return { withdrawal: existing, duplicate: true };
    }
    const [totals] = await tx.select({
      credit: sql<string>`COALESCE(SUM(amount_cents) FILTER (WHERE direction='credit'),0)::text`,
      debit: sql<string>`COALESCE(SUM(amount_cents) FILTER (WHERE direction='debit'),0)::text`,
    }).from(pgSchema.ledgerEntries).where(eq(pgSchema.ledgerEntries.accountId, available.id));
    const availableCents = Number(totals.credit) - Number(totals.debit);
    if (availableCents < input.amountCents) throw new Error("INSUFFICIENT_AVAILABLE_BALANCE");
    const netAmountCents = input.amountCents - input.feeCents;
    const [withdrawal] = await tx.insert(pgSchema.withdrawalRequests).values({
      userId: input.userId, amountCents: input.amountCents, feeCents: input.feeCents,
      netAmountCents, status: "reserved", idempotencyKey: input.idempotencyKey,
    }).returning();
    const [transaction] = await tx.insert(pgSchema.ledgerTransactions).values({
      idempotencyKey: `withdrawal-reserve:${input.idempotencyKey}`,
      eventType: "withdrawal_reserved", referenceType: "withdrawal",
      referenceId: withdrawal.id, description: "Reserva de saldo para solicitação de saque",
      createdBy: input.actorUserId,
    }).returning();
    await tx.insert(pgSchema.ledgerEntries).values([
      { transactionId: transaction.id, accountId: available.id, direction: "debit", amountCents: input.amountCents, currency: "BRL" },
      { transactionId: transaction.id, accountId: reserved.id, direction: "credit", amountCents: input.amountCents, currency: "BRL" },
    ]);
    await tx.insert(pgSchema.financialAuditEvents).values({
      actorUserId: input.actorUserId, subjectUserId: input.userId,
      action: "withdrawal_reserved", entityType: "withdrawal_request", entityId: withdrawal.id,
      afterState: { amountCents: input.amountCents, feeCents: input.feeCents, netAmountCents },
    });
    return { withdrawal, duplicate: false };
  });
}

export async function listClientLedger(userId: string, limit = 500, offset = 0) {
  const db = requirePostgres();
  const accounts = await ensureClientFinancialAccounts(userId);
  const accountIds = Object.values(accounts).map((account: any) => account.id);
  return db.select({
    entry: pgSchema.ledgerEntries,
    transaction: pgSchema.ledgerTransactions,
    account: pgSchema.financialAccounts,
  }).from(pgSchema.ledgerEntries)
    .innerJoin(pgSchema.ledgerTransactions, eq(pgSchema.ledgerEntries.transactionId, pgSchema.ledgerTransactions.id))
    .innerJoin(pgSchema.financialAccounts, eq(pgSchema.ledgerEntries.accountId, pgSchema.financialAccounts.id))
    .where(sql`${pgSchema.ledgerEntries.accountId} IN (${sql.join(accountIds.map((id: string) => sql`${id}::uuid`), sql`,`)})`)
    .orderBy(desc(pgSchema.ledgerEntries.createdAt)).limit(Math.min(Math.max(limit, 1), 1000)).offset(Math.max(offset, 0));
}


export async function confirmVerifiedProviderPayment(input: {
  paymentIntentId: string; provider: string; providerPaymentId: string;
  externalReference: string; amountCents: number; providerStatus: string;
  rawSnapshot?: Record<string, unknown>; verifiedAt?: Date;
  webhookVerified: boolean; providerLookupVerified: boolean;
}) {
  assertCents(input.amountCents);
  if (!["approved", "paid", "accredited"].includes(String(input.providerStatus).toLowerCase())) throw new Error("PROVIDER_PAYMENT_NOT_APPROVED");
  if (!input.webhookVerified || !input.providerLookupVerified) throw new Error("PAYMENT_PROVIDER_VERIFICATION_REQUIRED");
  if (!input.provider || !input.providerPaymentId || !input.externalReference) throw new Error("INVALID_PROVIDER_PAYMENT_REFERENCE");
  const db = requirePostgres();
  return db.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT id FROM payment_intents WHERE id = ${input.paymentIntentId}::uuid FOR UPDATE`);
    const [intent] = await tx.select().from(pgSchema.paymentIntents)
      .where(eq(pgSchema.paymentIntents.id, input.paymentIntentId)).limit(1);
    if (!intent) throw new Error("PAYMENT_INTENT_NOT_FOUND");
    const reconciliation = reconcileVerifiedPayment({
      id: intent.id, userId: intent.userId, amountCents: Number(intent.amountCents),
      currency: "BRL", status: intent.status as any, providerPaymentId: intent.providerPaymentId,
    }, {
      providerPaymentId: input.providerPaymentId, externalReference: input.externalReference,
      amountCents: input.amountCents, currency: "BRL", status: input.providerStatus,
      webhookVerified: input.webhookVerified, providerLookupVerified: input.providerLookupVerified,
    });
    if (!reconciliation.shouldCredit && reconciliation.duplicate) return { intent, duplicate: true };
    if (!reconciliation.shouldCredit) throw new Error("PROVIDER_PAYMENT_NOT_CREDITABLE");
    if (intent.status === "approved") {
      if (intent.provider !== input.provider || intent.providerPaymentId !== input.providerPaymentId) throw new Error("PAYMENT_INTENT_ALREADY_SETTLED_BY_DIFFERENT_PAYMENT");
      return { intent, duplicate: true };
    }
    if (["cancelled", "expired", "rejected", "refunded"].includes(intent.status)) throw new Error("PAYMENT_INTENT_NOT_PAYABLE");

    const [existingProviderPayment] = await tx.select().from(pgSchema.providerPayments)
      .where(and(eq(pgSchema.providerPayments.provider, input.provider), eq(pgSchema.providerPayments.providerPaymentId, input.providerPaymentId))).limit(1);
    if (existingProviderPayment && existingProviderPayment.paymentIntentId !== intent.id) {
      throw new Error("PROVIDER_PAYMENT_ALREADY_LINKED");
    }
    if (!existingProviderPayment) {
      await tx.insert(pgSchema.providerPayments).values({
        paymentIntentId: intent.id, provider: input.provider, providerPaymentId: input.providerPaymentId,
        externalReference: input.externalReference, amountCents: input.amountCents, currency: "BRL",
        providerStatus: input.providerStatus, verifiedAt: input.verifiedAt || new Date(),
        rawSnapshot: input.rawSnapshot || {},
      });
    }

    const accounts = await ensureClientFinancialAccounts(intent.userId, tx);
    const [clearing] = await tx.select().from(pgSchema.financialAccounts)
      .where(eq(pgSchema.financialAccounts.accountCode, "PLATFORM:PROVIDER_CLEARING")).limit(1);
    if (!clearing) throw new Error("PROVIDER_CLEARING_ACCOUNT_MISSING");
    const idempotencyKey = `provider-payment-approved:${input.provider}:${input.providerPaymentId}`;
    const [ledgerTx] = await tx.insert(pgSchema.ledgerTransactions).values({
      idempotencyKey, eventType: "deposit_approved", referenceType: "payment_intent",
      referenceId: intent.id, description: "Aporte confirmado pelo provedor após verificação independente",
      metadata: { provider: input.provider, providerPaymentId: input.providerPaymentId },
    }).onConflictDoNothing().returning();
    if (ledgerTx) {
      await tx.insert(pgSchema.ledgerEntries).values([
        { transactionId: ledgerTx.id, accountId: clearing.id, direction: "debit", amountCents: input.amountCents, currency: "BRL" },
        { transactionId: ledgerTx.id, accountId: accounts.client_available.id, direction: "credit", amountCents: input.amountCents, currency: "BRL" },
      ]);
    }
    const [updated] = await tx.update(pgSchema.paymentIntents).set({
      status: "approved", provider: input.provider, providerPaymentId: input.providerPaymentId,
      approvedAt: new Date(), updatedAt: new Date(),
    }).where(eq(pgSchema.paymentIntents.id, intent.id)).returning();
    await tx.insert(pgSchema.financialAuditEvents).values({
      subjectUserId: intent.userId, action: "provider_payment_approved",
      entityType: "payment_intent", entityId: intent.id,
      afterState: { provider: input.provider, providerPaymentId: input.providerPaymentId, amountCents: input.amountCents },
    });
    return { intent: updated, duplicate: false };
  });
}

export async function markWithdrawalSubmitted(withdrawalId: string, provider: string, providerTransferId: string) {
  const db = requirePostgres();
  return db.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT id FROM withdrawal_requests WHERE id = ${withdrawalId}::uuid FOR UPDATE`);
    const [withdrawal] = await tx.select().from(pgSchema.withdrawalRequests)
      .where(eq(pgSchema.withdrawalRequests.id, withdrawalId)).limit(1);
    if (!withdrawal) throw new Error("WITHDRAWAL_NOT_FOUND");
    if (withdrawal.status === "submitted" && withdrawal.providerTransferId === providerTransferId) return withdrawal;
    if (withdrawal.status !== "reserved") throw new Error("WITHDRAWAL_NOT_RESERVED");
    const [updated] = await tx.update(pgSchema.withdrawalRequests).set({
      status: "submitted", provider, providerTransferId, updatedAt: new Date(),
    }).where(eq(pgSchema.withdrawalRequests.id, withdrawalId)).returning();
    await tx.insert(pgSchema.financialAuditEvents).values({
      subjectUserId: withdrawal.userId, action: "withdrawal_submitted",
      entityType: "withdrawal_request", entityId: withdrawalId,
      afterState: { provider, providerTransferId },
    });
    return updated;
  });
}

export async function settleVerifiedWithdrawal(input: {
  withdrawalId: string; provider: string; providerTransferId: string; verifiedStatus: string;
  webhookVerified: boolean; providerLookupVerified: boolean;
}) {
  if (!input.webhookVerified || !input.providerLookupVerified) throw new Error("TRANSFER_PROVIDER_VERIFICATION_REQUIRED");
  if (!["paid", "approved", "completed", "success"].includes(String(input.verifiedStatus).toLowerCase())) throw new Error("PROVIDER_TRANSFER_NOT_SETTLED");
  const db = requirePostgres();
  return db.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT id FROM withdrawal_requests WHERE id = ${input.withdrawalId}::uuid FOR UPDATE`);
    const [withdrawal] = await tx.select().from(pgSchema.withdrawalRequests)
      .where(eq(pgSchema.withdrawalRequests.id, input.withdrawalId)).limit(1);
    if (!withdrawal) throw new Error("WITHDRAWAL_NOT_FOUND");
    if (withdrawal.status === "paid") {
      if (withdrawal.provider !== input.provider || withdrawal.providerTransferId !== input.providerTransferId) throw new Error("WITHDRAWAL_ALREADY_SETTLED_BY_DIFFERENT_TRANSFER");
      return { withdrawal, duplicate: true };
    }
    if (withdrawal.status !== "submitted" || withdrawal.provider !== input.provider ||
        withdrawal.providerTransferId !== input.providerTransferId) throw new Error("WITHDRAWAL_PROVIDER_REFERENCE_MISMATCH");
    const accounts = await ensureClientFinancialAccounts(withdrawal.userId, tx);
    const [clearing] = await tx.select().from(pgSchema.financialAccounts)
      .where(eq(pgSchema.financialAccounts.accountCode, "PLATFORM:PROVIDER_CLEARING")).limit(1);
    const [feeAccount] = await tx.select().from(pgSchema.financialAccounts)
      .where(eq(pgSchema.financialAccounts.accountCode, "PLATFORM:FEE_INCOME")).limit(1);
    if (!clearing || !feeAccount) throw new Error("PLATFORM_SETTLEMENT_ACCOUNT_MISSING");
    const [ledgerTx] = await tx.insert(pgSchema.ledgerTransactions).values({
      idempotencyKey: `withdrawal-paid:${input.provider}:${input.providerTransferId}`,
      eventType: "withdrawal_paid", referenceType: "withdrawal",
      referenceId: withdrawal.id, description: "Saque liquidado após confirmação verificada do provedor",
      metadata: { provider: input.provider, providerTransferId: input.providerTransferId, verifiedStatus: input.verifiedStatus },
    }).onConflictDoNothing().returning();
    if (ledgerTx) {
      const entries: any[] = [
        { transactionId: ledgerTx.id, accountId: accounts.client_reserved.id, direction: "debit", amountCents: Number(withdrawal.amountCents), currency: "BRL" },
        { transactionId: ledgerTx.id, accountId: clearing.id, direction: "credit", amountCents: Number(withdrawal.netAmountCents), currency: "BRL" },
      ];
      if (Number(withdrawal.feeCents) > 0) entries.push({
        transactionId: ledgerTx.id, accountId: feeAccount.id, direction: "credit",
        amountCents: Number(withdrawal.feeCents), currency: "BRL",
      });
      await tx.insert(pgSchema.ledgerEntries).values(entries);
    }
    const [updated] = await tx.update(pgSchema.withdrawalRequests).set({
      status: "paid", completedAt: new Date(), updatedAt: new Date(),
    }).where(eq(pgSchema.withdrawalRequests.id, withdrawal.id)).returning();
    await tx.insert(pgSchema.financialAuditEvents).values({
      subjectUserId: withdrawal.userId, action: "withdrawal_paid",
      entityType: "withdrawal_request", entityId: withdrawal.id,
      afterState: { provider: input.provider, providerTransferId: input.providerTransferId, verifiedStatus: input.verifiedStatus },
    });
    return { withdrawal: updated, duplicate: false };
  });
}

export async function releaseFailedWithdrawal(input: {
  withdrawalId: string; reason: string; provider?: string; providerTransferId?: string; providerLookupVerified?: boolean;
}) {
  const db = requirePostgres();
  return db.transaction(async (tx: any) => {
    await tx.execute(sql`SELECT id FROM withdrawal_requests WHERE id = ${input.withdrawalId}::uuid FOR UPDATE`);
    const [withdrawal] = await tx.select().from(pgSchema.withdrawalRequests)
      .where(eq(pgSchema.withdrawalRequests.id, input.withdrawalId)).limit(1);
    if (!withdrawal) throw new Error("WITHDRAWAL_NOT_FOUND");
    if (["failed", "cancelled"].includes(withdrawal.status)) return { withdrawal, duplicate: true };
    if (!["reserved", "submitted"].includes(withdrawal.status)) throw new Error("WITHDRAWAL_NOT_REVERSIBLE");
    if (withdrawal.status === "submitted" && !input.providerLookupVerified) throw new Error("TRANSFER_OUTCOME_MUST_BE_VERIFIED_BEFORE_RELEASE");
    if (input.provider && withdrawal.provider && input.provider !== withdrawal.provider) throw new Error("WITHDRAWAL_PROVIDER_MISMATCH");
    if (input.providerTransferId && withdrawal.providerTransferId && input.providerTransferId !== withdrawal.providerTransferId) throw new Error("WITHDRAWAL_TRANSFER_MISMATCH");
    const accounts = await ensureClientFinancialAccounts(withdrawal.userId, tx);
    const [ledgerTx] = await tx.insert(pgSchema.ledgerTransactions).values({
      idempotencyKey: `withdrawal-release:${withdrawal.id}`,
      eventType: "withdrawal_released", referenceType: "withdrawal",
      referenceId: withdrawal.id, description: "Reserva liberada após falha ou cancelamento confirmado",
      metadata: { reason: input.reason.slice(0, 500), provider: input.provider || null },
    }).onConflictDoNothing().returning();
    if (ledgerTx) await tx.insert(pgSchema.ledgerEntries).values([
      { transactionId: ledgerTx.id, accountId: accounts.client_reserved.id, direction: "debit", amountCents: Number(withdrawal.amountCents), currency: "BRL" },
      { transactionId: ledgerTx.id, accountId: accounts.client_available.id, direction: "credit", amountCents: Number(withdrawal.amountCents), currency: "BRL" },
    ]);
    const [updated] = await tx.update(pgSchema.withdrawalRequests).set({
      status: "failed", failureReason: input.reason.slice(0, 500), updatedAt: new Date(),
    }).where(eq(pgSchema.withdrawalRequests.id, withdrawal.id)).returning();
    await tx.insert(pgSchema.financialAuditEvents).values({
      subjectUserId: withdrawal.userId, action: "withdrawal_released",
      entityType: "withdrawal_request", entityId: withdrawal.id,
      reason: input.reason.slice(0, 500),
    });
    return { withdrawal: updated, duplicate: false };
  });
}


export async function recordVerifiedProviderWebhook(input: {
  provider: string; providerEventId: string; eventType: string;
  signatureVerified: boolean; payload: Record<string, unknown>;
}) {
  if (!input.signatureVerified) throw new Error("PROVIDER_WEBHOOK_SIGNATURE_INVALID");
  if (!input.provider || !input.providerEventId || !input.eventType) throw new Error("INVALID_PROVIDER_WEBHOOK");
  const db = requirePostgres();
  const [event] = await db.insert(pgSchema.providerWebhookEvents).values({
    provider: input.provider, providerEventId: input.providerEventId,
    eventType: input.eventType, signatureVerified: true, payload: input.payload,
  }).onConflictDoNothing().returning();
  if (event) return { event, duplicate: false };
  const [existing] = await db.select().from(pgSchema.providerWebhookEvents)
    .where(and(eq(pgSchema.providerWebhookEvents.provider, input.provider),
      eq(pgSchema.providerWebhookEvents.providerEventId, input.providerEventId))).limit(1);
  return { event: existing, duplicate: true };
}

export async function markProviderWebhookProcessed(eventId: string, status: "processed" | "ignored" | "failed", error?: string) {
  if (!["processed", "ignored", "failed"].includes(status)) throw new Error("INVALID_WEBHOOK_PROCESSING_STATUS");
  const db = requirePostgres();
  const [updated] = await db.update(pgSchema.providerWebhookEvents).set({
    processingStatus: status, processingError: error ? error.slice(0, 1000) : null,
    processedAt: new Date(),
  }).where(eq(pgSchema.providerWebhookEvents.id, eventId)).returning();
  return updated || null;
}
