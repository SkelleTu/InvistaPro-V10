import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { pgDb, pgSchema, isPostgresAvailable } from "../db-postgres";
import { storePrivateReport, readPrivateReport, deletePrivateReport } from "./private-document-storage";
import { getClientFinancialSummary, getPlatformFinancialSummary } from "./financial-ledger";

function dbOrThrow() {
  if (!isPostgresAvailable || !pgDb) throw new Error("DURABLE_POSTGRES_REQUIRED");
  return pgDb;
}

function pdfEscape(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function buildPdf(lines: string[]): Buffer {
  const wrappedLines = lines.flatMap((line) => {
    const value = String(line ?? "");
    if (!value.length) return [""];
    const parts: string[] = [];
    for (let offset = 0; offset < value.length; offset += 105) parts.push(value.slice(offset, offset + 105));
    return parts;
  });
  const pages: string[][] = [];
  for (let i = 0; i < wrappedLines.length; i += 52) pages.push(wrappedLines.slice(i, i + 52));
  if (!pages.length) pages.push(["Relatorio sem registros no periodo consultado."]);
  const objects: string[] = [];
  const pageRefs: number[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (let i = 0; i < pages.length; i++) {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    pageRefs.push(pageId);
    const commands = [
      "BT", "/F1 9 Tf", "40 800 Td", "12 TL",
      ...pages[i].map((line, index) => `(${pdfEscape(line)}) Tj${index < pages[i].length - 1 ? " T*" : ""}`),
      "ET",
    ].join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(commands, "ascii")} >>\nstream\n${commands}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${pageRefs.map(id => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  let output = "%PDF-1.4\n%INVISTAPRO\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(output, "ascii"));
    output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, "ascii");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, "ascii");
}

function parsePeriod(from?: string, to?: string) {
  const start = from ? new Date(from) : null;
  const end = to ? new Date(to) : null;
  if ((from && (!start || Number.isNaN(start.getTime()))) || (to && (!end || Number.isNaN(end.getTime())))) {
    throw new Error("INVALID_REPORT_PERIOD");
  }
  if (start && end && start > end) throw new Error("INVALID_REPORT_PERIOD");
  return { start, end };
}

function periodConditions(column: any, start: Date | null, end: Date | null) {
  const conditions: any[] = [];
  if (start) conditions.push(gte(column, start));
  if (end) conditions.push(lte(column, end));
  return conditions;
}

function brlFromCents(value: number) {
  return (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export async function generateAdminFinancialReport(input: {
  requestedBy: string; scope: "client" | "platform"; userId?: string;
  from?: string; to?: string; reason?: string; requestId?: string; ip?: string; userAgent?: string;
}) {
  const db = dbOrThrow();
  if (input.scope === "client" && !input.userId) throw new Error("REPORT_CLIENT_REQUIRED");
  const { start, end } = parsePeriod(input.from, input.to);
  const conditionsFor = (column: any, userColumn?: any) => {
    const conditions: any[] = periodConditions(column, start, end);
    if (input.scope === "client" && userColumn) conditions.push(eq(userColumn, input.userId!));
    return conditions.length ? and(...conditions) : undefined;
  };
  const snapshot = await db.transaction(async (tx: any) => {
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`);
    const [requestedBy] = await tx.select({ id: pgSchema.users.id, email: pgSchema.users.email, name: pgSchema.users.nomeCompleto })
      .from(pgSchema.users).where(eq(pgSchema.users.id, input.requestedBy)).limit(1);
    if (!requestedBy) throw new Error("ADMIN_NOT_FOUND");

    const [users, movements, trades, documents, transactions, entries, paymentIntents, providerPayments, withdrawals, auditEvents, webhookEvents] = await Promise.all([
      input.scope === "client"
        ? tx.select().from(pgSchema.users).where(eq(pgSchema.users.id, input.userId!))
        : tx.select({ id: pgSchema.users.id, nomeCompleto: pgSchema.users.nomeCompleto, email: pgSchema.users.email, isAdmin: pgSchema.users.isAdmin, contaAprovada: pgSchema.users.contaAprovada, documentosVerificados: pgSchema.users.documentosVerificados, createdAt: pgSchema.users.createdAt }).from(pgSchema.users),
      tx.select().from(pgSchema.movimentos).where(conditionsFor(pgSchema.movimentos.createdAt, pgSchema.movimentos.userId)).orderBy(desc(pgSchema.movimentos.createdAt)),
      tx.select().from(pgSchema.tradeOperations).where(conditionsFor(pgSchema.tradeOperations.createdAt, pgSchema.tradeOperations.userId)).orderBy(desc(pgSchema.tradeOperations.createdAt)),
      tx.select().from(pgSchema.documentos).where(conditionsFor(pgSchema.documentos.createdAt, pgSchema.documentos.userId)).orderBy(desc(pgSchema.documentos.createdAt)),
      tx.select().from(pgSchema.ledgerTransactions).where(periodConditions(pgSchema.ledgerTransactions.createdAt, start, end).length ? and(...periodConditions(pgSchema.ledgerTransactions.createdAt, start, end)) : undefined).orderBy(desc(pgSchema.ledgerTransactions.createdAt)),
      tx.select().from(pgSchema.ledgerEntries).where(periodConditions(pgSchema.ledgerEntries.createdAt, start, end).length ? and(...periodConditions(pgSchema.ledgerEntries.createdAt, start, end)) : undefined).orderBy(desc(pgSchema.ledgerEntries.createdAt)),
      tx.select().from(pgSchema.paymentIntents).where(conditionsFor(pgSchema.paymentIntents.createdAt, pgSchema.paymentIntents.userId)).orderBy(desc(pgSchema.paymentIntents.createdAt)),
      tx.select().from(pgSchema.providerPayments).where(periodConditions(pgSchema.providerPayments.createdAt, start, end).length ? and(...periodConditions(pgSchema.providerPayments.createdAt, start, end)) : undefined).orderBy(desc(pgSchema.providerPayments.createdAt)),
      tx.select().from(pgSchema.withdrawalRequests).where(conditionsFor(pgSchema.withdrawalRequests.requestedAt, pgSchema.withdrawalRequests.userId)).orderBy(desc(pgSchema.withdrawalRequests.requestedAt)),
      tx.select().from(pgSchema.financialAuditEvents).where(conditionsFor(pgSchema.financialAuditEvents.createdAt, pgSchema.financialAuditEvents.subjectUserId)).orderBy(desc(pgSchema.financialAuditEvents.createdAt)),
      input.scope === "platform"
        ? tx.select().from(pgSchema.providerWebhookEvents).where(periodConditions(pgSchema.providerWebhookEvents.receivedAt, start, end).length ? and(...periodConditions(pgSchema.providerWebhookEvents.receivedAt, start, end)) : undefined).orderBy(desc(pgSchema.providerWebhookEvents.receivedAt))
        : Promise.resolve([]),
    ]);

    const user = input.scope === "client" ? users[0] as any : null;
    const clientUsers = (users as any[]).filter((item: any) => !item.isAdmin);
    if (input.scope === "client" && (!user || user.isAdmin)) throw new Error("REPORT_CLIENT_NOT_FOUND");
    const relevantAccounts = await tx.select().from(pgSchema.financialAccounts)
      .where(input.scope === "client" ? eq(pgSchema.financialAccounts.ownerUserId, input.userId!) : undefined);
    const paymentIntentIds = new Set(paymentIntents.map((intent: any) => intent.id));
    const relevantProviderPayments = providerPayments.filter((payment: any) => paymentIntentIds.has(payment.paymentIntentId));
    const relevantWebhookEvents = input.scope === "platform" ? webhookEvents : [];
    const clientBalanceSnapshot = (input.scope === "client" ? await getClientFinancialSummary(input.userId!, tx) : null) as Awaited<ReturnType<typeof getClientFinancialSummary>> | null;
    const platformBalanceSnapshot = (input.scope === "platform" ? await getPlatformFinancialSummary(clientUsers.map((item: any) => item.id), tx) : null) as Awaited<ReturnType<typeof getPlatformFinancialSummary>> | null;
    const relevantAccountIds = new Set(relevantAccounts.map((account: any) => account.id));
    const relevantEntries = entries.filter((entry: any) => {
      const timestamp = new Date(entry.createdAt as any).getTime();
      return relevantAccountIds.has(entry.accountId) && (!start || timestamp >= start.getTime()) && (!end || timestamp <= end.getTime());
    });
    const transactionIds = new Set(relevantEntries.map((entry: any) => entry.transactionId));
    const relevantTransactions = transactions.filter((item: any) => transactionIds.has(item.id));
    const audit = auditEvents.filter((event: any) => input.scope === "platform" || !event.subjectUserId || event.subjectUserId === input.userId);
    const userById = new Map<string, any>();
    for (const item of users as any[]) userById.set(item.id, item);
    const accountById = new Map<string, any>();
    for (const item of relevantAccounts as any[]) accountById.set(item.id, item);
    return {
      requestedBy, users, movements, trades, documents, transactions, entries, paymentIntents,
      providerPayments, withdrawals, auditEvents, webhookEvents, user, clientUsers,
      relevantAccounts, relevantProviderPayments, relevantWebhookEvents, relevantEntries,
      relevantTransactions, audit, clientBalanceSnapshot, platformBalanceSnapshot, userById, accountById,
    };
  }, { isolationLevel: "repeatable read" });

  const {
    requestedBy, users, movements, trades, documents, transactions, entries, paymentIntents,
    providerPayments, withdrawals, auditEvents, webhookEvents, user, clientUsers,
    relevantAccounts, relevantProviderPayments, relevantWebhookEvents, relevantEntries,
    relevantTransactions, audit, clientBalanceSnapshot, platformBalanceSnapshot, userById, accountById,
  } = snapshot;
  const generatedAt = new Date();
  const reportId = randomUUID();
  const title = input.scope === "client" ? "DOSSIÊ FINANCEIRO INDIVIDUAL" : "RELATÓRIO CONSOLIDADO DA PLATAFORMA";
  const lines: string[] = [
    "INVISTAPRO V10 — DOCUMENTO ADMINISTRATIVO",
    title,
    `Relatorio: ${reportId}`,
    `Gerado em UTC: ${generatedAt.toISOString()}`,
    `Solicitante: ${requestedBy.name} <${requestedBy.email}>`,
    `Periodo UTC: ${start?.toISOString() || "inicio do historico"} ate ${end?.toISOString() || "agora"}`,
    `Escopo: ${input.scope === "client" ? "cliente individual" : "plataforma consolidada"}`,
    `Registros listados: ${clientUsers.length + movements.length + trades.length + documents.length + relevantTransactions.length + relevantEntries.length + paymentIntents.length + relevantProviderPayments.length + withdrawals.length + audit.length + relevantWebhookEvents.length}`,
    " ",
  ];
  if (user) {
    const cpf = String(user.cpf || "");
    lines.push("IDENTIFICACAO DO CLIENTE", `Nome: ${user.nomeCompleto}`, `E-mail: ${user.email}`,
      `CPF: ${cpf.length >= 11 ? cpf.slice(0, 3) + ".***.***-" + cpf.slice(-2) : "nao informado"}`,
      `Telefone: ${user.telefone || "nao informado"}`, `Endereco: ${user.endereco || "nao informado"}`,
      `Cidade/UF: ${[user.cidade, user.estado].filter(Boolean).join("/") || "nao informado"}`, `CEP: ${user.cep || "nao informado"}`,
      `Cadastro criado: ${user.createdAt?.toISOString?.() || user.createdAt || "nao informado"}`,
      `Conta aprovada: ${user.contaAprovada ? "sim" : "nao"}`,
      `KYC verificado: ${user.documentosVerificados ? "sim" : "nao"}`, " ");
  } else {
    lines.push("RESUMO DA PLATAFORMA", `Clientes cadastrados: ${clientUsers.length}`,
      `Aportes legados registrados: ${movements.filter((m: any) => m.tipo === "deposito").length}`,
      `Saques legados registrados: ${movements.filter((m: any) => m.tipo === "saque").length}`,
      `Operacoes de trading: ${trades.length}`, `Lancamentos contabeis: ${relevantTransactions.length}`,
      `Solicitacoes de saque: ${withdrawals.length}`, " ");
  }
  const userById = new Map((users as any[]).map((item: any) => [item.id, item]));
  const accountById = new Map((relevantAccounts as any[]).map((item: any) => [item.id, item]));
  lines.push(" ", "SALDOS CONTABEIS ATUAIS (fonte: ledger PostgreSQL)");
  if (input.scope === "client") {
    lines.push(
      `Disponivel: ${brlFromCents(clientBalanceSnapshot!.availableBalanceCents)}`,
      `Reservado: ${brlFromCents(clientBalanceSnapshot!.reservedBalanceCents)}`,
      `Capital: ${brlFromCents(clientBalanceSnapshot!.capitalBalanceCents)}`,
      `Rendimentos: ${brlFromCents(clientBalanceSnapshot!.yieldBalanceCents)}`,
    );
  } else {
    for (const item of platformBalanceSnapshot!.clients) {
      const owner: any = userById.get(item.userId);
      const b: any = item.balancesCents;
      lines.push(`Cliente ${owner?.nomeCompleto || item.userId} (${item.userId}) | disponivel ${brlFromCents(b.client_available)} | reservado ${brlFromCents(b.client_reserved)} | capital ${brlFromCents(b.client_capital)} | rendimentos ${brlFromCents(b.client_yield)}`);
    }
    const totals: any = platformBalanceSnapshot!.totalsCents;
    lines.push(`TOTAL PLATAFORMA | disponivel ${brlFromCents(totals.client_available)} | reservado ${brlFromCents(totals.client_reserved)} | capital ${brlFromCents(totals.client_capital)} | rendimentos ${brlFromCents(totals.client_yield)}`);
  }
  lines.push("MOVIMENTACOES LEGADAS (nao equivalem a lancamentos conciliados)");
  for (const row of movements as any[]) {
    const owner: any = userById.get(row.userId);
    lines.push(`${row.createdAt?.toISOString?.() || row.createdAt || ""} | cliente ${owner?.nomeCompleto || row.userId} (${row.userId}) | ${row.tipo} | ${Number(row.valor || 0).toFixed(2)} BRL | ${row.id} | ${row.descricao || ""}`);
  }
  lines.push(" ", "OPERACOES DE TRADING (secao separada do fluxo de caixa)");
  for (const row of trades as any[]) {
    const owner: any = userById.get(row.userId);
    lines.push(`${row.createdAt?.toISOString?.() || row.createdAt || ""} | cliente ${owner?.nomeCompleto || row.userId} (${row.userId}) | ${row.symbol} | ${row.tradeType}/${row.direction} | stake ${Number(row.amount || 0).toFixed(2)} | status ${row.status} | PnL ${row.profit == null ? "pendente" : Number(row.profit).toFixed(2)} | ${row.id}`);
  }
  lines.push(" ", "CONTAS FINANCEIRAS");
  for (const account of relevantAccounts as any[]) lines.push(`${account.accountCode} | ${account.accountKind} | ${account.status} | ${account.currency}`);
  lines.push(" ", "LANCAMENTOS CONTABEIS (centavos)");
  const transactionById = new Map((relevantTransactions as any[]).map(tx => [tx.id, tx]));
  for (const entry of relevantEntries as any[]) {
    const tx: any = transactionById.get(entry.transactionId);
    const account: any = accountById.get(entry.accountId);
    const owner: any = account?.ownerUserId ? userById.get(account.ownerUserId) : null;
    lines.push(`${entry.createdAt?.toISOString?.() || entry.createdAt || ""} | cliente ${owner?.nomeCompleto || account?.ownerUserId || "plataforma"} | conta ${account?.accountCode || entry.accountId} | ${entry.direction} ${entry.amountCents} ${entry.currency} | ${tx?.eventType || ""} | ${tx?.idempotencyKey || ""}`);
  }
  lines.push(" ", "INTENCOES DE PAGAMENTO");
  for (const row of paymentIntents as any[]) {
    const owner: any = userById.get(row.userId);
    lines.push(`${row.createdAt?.toISOString?.() || row.createdAt || ""} | cliente ${owner?.nomeCompleto || row.userId} (${row.userId}) | ${brlFromCents(row.amountCents)} | ${row.status} | ${row.provider || "sem provedor"} | ${row.id}`);
  }
  lines.push(" ", "PAGAMENTOS CONFIRMADOS/OBSERVADOS PELO PROVEDOR");
  for (const row of relevantProviderPayments as any[]) lines.push(`${row.createdAt?.toISOString?.() || row.createdAt || ""} | ${row.provider} | ${row.providerPaymentId} | ${brlFromCents(row.amountCents)} | ${row.providerStatus} | intent ${row.paymentIntentId}`);
  if (input.scope === "platform") {
    lines.push(" ", "EVENTOS DE WEBHOOK DO PROVEDOR");
    for (const row of relevantWebhookEvents as any[]) lines.push(`${row.receivedAt?.toISOString?.() || row.receivedAt || ""} | ${row.provider} | ${row.eventType} | ${row.processingStatus} | assinatura verificada: ${row.signatureVerified ? "sim" : "nao"} | ${row.providerEventId}`);
  }
  lines.push(" ", "SOLICITACOES DE SAQUE");
  for (const row of withdrawals as any[]) {
    const owner: any = userById.get(row.userId);
    lines.push(`${row.requestedAt?.toISOString?.() || row.requestedAt || ""} | cliente ${owner?.nomeCompleto || row.userId} (${row.userId}) | bruto ${brlFromCents(row.amountCents)} | taxa ${brlFromCents(row.feeCents)} | liquido ${brlFromCents(row.netAmountCents)} | ${row.status} | ${row.id}`);
  }
  lines.push(" ", "DOCUMENTOS E REVISOES");
  for (const row of documents as any[]) {
    const owner: any = userById.get(row.userId);
    lines.push(`${row.createdAt?.toISOString?.() || row.createdAt || ""} | cliente ${owner?.nomeCompleto || row.userId} (${row.userId}) | ${row.tipo} | ${row.status} | aprovador ${row.aprovadoPor || "nao informado"} | ${row.id}`);
  }
  lines.push(" ", "EVENTOS DE AUDITORIA");
  for (const row of audit as any[]) lines.push(`${row.createdAt?.toISOString?.() || row.createdAt || ""} | cliente ${row.subjectUserId || "plataforma"} | ${row.action} | ${row.entityType}:${row.entityId} | ator ${row.actorUserId || "sistema"} | req ${row.requestId || ""} | ${row.reason || ""}`);
  lines.push(" ", "NOTAS DE INTEGRIDADE", "Este PDF e uma copia documental; a fonte oficial sao os registros persistidos no PostgreSQL.",
    "Movimentos legados e resultados de trading nao sao automaticamente conciliados com o ledger.",
    "A integridade do arquivo e verificada pelo hash SHA-256 registrado no banco.");
  const pdf = buildPdf(lines);
  const hash = createHash("sha256").update(pdf).digest("hex");
  const storageRef = await storePrivateReport(reportId, pdf);
  let storedPdf: Buffer;
  try {
    storedPdf = await readPrivateReport(storageRef);
  } catch (error) {
    await deletePrivateReport(storageRef).catch(() => {});
    throw error;
  }
  if (createHash("sha256").update(storedPdf).digest("hex") !== hash) {
    await deletePrivateReport(storageRef).catch(() => {});
    throw new Error("REPORT_STORAGE_HASH_MISMATCH");
  }
  const rowCount = clientUsers.length + movements.length + trades.length + documents.length + relevantTransactions.length + relevantEntries.length + paymentIntents.length + relevantProviderPayments.length + withdrawals.length + audit.length + relevantWebhookEvents.length;
  try {
    await db.transaction(async (tx: any) => {
      await tx.insert(pgSchema.adminReportExports).values({
        id: reportId, requestedBy: input.requestedBy, reportScope: input.scope,
        subjectUserId: input.scope === "client" ? input.userId! : null,
        periodStart: start, periodEnd: end, rowCount, contentSha256: hash, privateStorageRef: storageRef,
      });
      await tx.insert(pgSchema.financialAuditEvents).values({
        actorUserId: input.requestedBy, subjectUserId: input.userId || null,
        action: "admin_report_generated", entityType: "admin_report_export", entityId: reportId,
        afterState: { scope: input.scope, rowCount, contentSha256: hash, periodStart: start?.toISOString() || null, periodEnd: end?.toISOString() || null },
        reason: input.reason || "Relatorio administrativo solicitado",
        requestId: input.requestId || null, ipAddress: input.ip || null, userAgent: input.userAgent || null,
      });
    });
  } catch (error) {
    await deletePrivateReport(storageRef).catch(() => {});
    throw error;
  }
  return { id: reportId, rowCount, contentSha256: hash, createdAt: generatedAt.toISOString(), scope: input.scope };
}

export async function getAdminReport(reportId: string) {
  const db = dbOrThrow();
  const [report] = await db.select().from(pgSchema.adminReportExports)
    .where(eq(pgSchema.adminReportExports.id, reportId)).limit(1);
  return report || null;
}

export async function recordAdminReportDownload(report: any, actorUserId: string, request: { requestId?: string; ip?: string; userAgent?: string }) {
  const db = dbOrThrow();
  await db.insert(pgSchema.financialAuditEvents).values({
    actorUserId, subjectUserId: report.subjectUserId || null,
    action: "admin_report_downloaded", entityType: "admin_report_export", entityId: report.id,
    afterState: { contentSha256: report.contentSha256 },
    requestId: request.requestId || null, ipAddress: request.ip || null, userAgent: request.userAgent || null,
  });
  const buffer = await readPrivateReport(report.privateStorageRef);
  const hash = createHash("sha256").update(buffer).digest("hex");
  if (hash !== report.contentSha256) throw new Error("REPORT_HASH_MISMATCH");
  return buffer;
}

export async function listAdminReports(limit = 100) {
  const db = dbOrThrow();
  return db.select().from(pgSchema.adminReportExports)
    .orderBy(desc(pgSchema.adminReportExports.createdAt)).limit(Math.min(Math.max(limit, 1), 500));
}
