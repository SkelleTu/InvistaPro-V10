import { and, desc, eq, sql } from "drizzle-orm";
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
    const [totals] = await tx.select({
      credit: sql<string>`COALESCE(SUM(amount_cents) FILTER (WHERE direction='credit'),0)::text`,
      debit: sql<string>`COALESCE(SUM(amount_cents) FILTER (WHERE direction='debit'),0)::text`,
    }).from(pgSchema.ledgerEntries).where(eq(pgSchema.ledgerEntries.accountId, available.id));
    const availableCents = Number(totals.credit) - Number(totals.debit);
    if (availableCents < input.amountCents) throw new Error("INSUFFICIENT_AVAILABLE_BALANCE");
    const [existing] = await tx.select().from(pgSchema.withdrawalRequests)
      .where(eq(pgSchema.withdrawalRequests.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existing) return { withdrawal: existing, duplicate: true };
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
