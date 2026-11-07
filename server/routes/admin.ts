import express from "express";
import { dualStorage } from "../storage-dual";
import { isAuthenticated } from "../auth";
import { isAuthorizedEmail, ACCESS_DENIED_MESSAGE } from "../config/access";
import { getAffiliateAdminSummary, getAffiliateAdminNetwork } from "../services/affiliate-program";
import { readPrivateDocument } from "../services/private-document-storage";
import { generateAdminFinancialReport, getAdminReport, listAdminReports, recordAdminReportDownload } from "../services/admin-financial-reports";
import { getClientFinancialSummary, getPlatformFinancialSummary, listClientLedger, listClientWithdrawals } from "../services/financial-ledger";

// Extend session type
declare module 'express-session' {
  interface SessionData {
    userId: string;
  }
}

const router = express.Router();

// Endpoint para verificar se usuário tem acesso admin
router.get('/check-access', isAuthenticated, async (req, res) => {
  try {
    const userId = (req as any).session.passport?.user;
    const user = userId ? await dualStorage.getUser(String(userId)) : null;

    if (!user) {
      return res.json({
        hasAccess: false,
        userEmail: null,
        message: 'Usuário não encontrado'
      });
    }

    const userEmail = String(user.email || "");
    const normalizedEmail = userEmail.toLowerCase();
    const envAdminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const masterEmails = [
      process.env.MASTER_EMAIL,
      process.env.INVISTA_MASTER_EMAIL,
      process.env.INVISTAPRO_ACCOUNT_EMAIL,
    ].map(value => String(value || "").trim().toLowerCase()).filter(Boolean);

    const hasAccess = isAuthorizedEmail(userEmail) ||
      Boolean(envAdminEmail && normalizedEmail === envAdminEmail) ||
      masterEmails.includes(normalizedEmail);

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.json({
      hasAccess,
      userEmail,
      message: hasAccess ? 
        'Usuário autorizado para painel administrativo' : 
        'Acesso restrito a administradores autorizados'
    });
  } catch (error) {
    console.error('Error checking admin access:', error);
    res.status(500).json({ 
      hasAccess: false, 
      message: 'Erro interno do servidor' 
    });
  }
});

// Middleware to check admin privileges - Centralized access control
const isAdmin = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
  try {
    const userId = (req as any).session.passport?.user;
    const user = userId ? await dualStorage.getUser(String(userId)) : null;

    if (!user) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    // Use the durable user record for authorization, not only the local SQLite cache.
    const userEmail = String(user.email || "").toLowerCase();
    const envAdminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    const masterEmails = [
      process.env.MASTER_EMAIL,
      process.env.INVISTA_MASTER_EMAIL,
      process.env.INVISTAPRO_ACCOUNT_EMAIL,
    ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
    const isAdminUser = isAuthorizedEmail(userEmail) ||
      Boolean(envAdminEmail && userEmail === envAdminEmail) ||
      masterEmails.includes(userEmail);
    
    if (!isAdminUser) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    // Administrative responses include private customer and financial data.
    res.setHeader("Cache-Control", "no-store, max-age=0");
    next();
  } catch (error) {
    console.error('Error checking admin status:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
};

// Affiliate network and commission ledger summary.
router.get('/affiliates/summary', isAuthenticated, isAdmin, async (_req, res) => {
  try {
    const summary = await getAffiliateAdminSummary();
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.json(summary);
  } catch (error) {
    console.error("Error getting affiliate summary:", error instanceof Error ? error.message : String(error));
    return res.status(503).json({ message: "Não foi possível consultar o resumo de afiliados." });
  }
});

// Global parent-child affiliate links for authorized administrators.
router.get('/affiliates/network', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const requested = Number.parseInt(String(req.query.limit || "500"), 10);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 1000) : 500;
    const network = await getAffiliateAdminNetwork(limit);
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.json(network);
  } catch (error) {
    console.error("Error getting global affiliate network:", error);
    return res.status(500).json({ message: "Não foi possível consultar a rede global de afiliados." });
  }
});

// Aggregated trading activity across customer accounts (read-only).
router.get('/trading/summary', isAuthenticated, isAdmin, async (_req, res) => {
  try {
    const operations = await dualStorage.getAllTradeOperations();
    const openStatuses = new Set(["pending", "active", "open", "purchased", "in_progress"]);
    const completed = operations.filter(op => !openStatuses.has(String(op.status || "").toLowerCase()) && op.profit !== null && op.profit !== undefined);
    const summary = {
      totalOperations: operations.length,
      openOperations: operations.filter(op => openStatuses.has(String(op.status || "").toLowerCase())).length,
      winningOperations: completed.filter(op => Number(op.profit) > 0).length,
      losingOperations: completed.filter(op => Number(op.profit) < 0).length,
      netProfit: completed.reduce((sum, op) => sum + Number(op.profit || 0), 0),
      participatingUsers: new Set(operations.map(op => op.userId)).size,
    };
    res.setHeader("Cache-Control", "no-store, max-age=0");
    return res.json(summary);
  } catch (error) {
    console.error("Error getting global trading summary:", error);
    return res.status(500).json({ message: "Não foi possível consultar o resumo operacional." });
  }
});

// Get all users
router.get('/users', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const allUsers = (await dualStorage.getAllUsers()).filter((user: any) => !user.isAdmin);
    const ledger = await getPlatformFinancialSummary(allUsers.map(user => user.id));
    const ledgerByUser = new Map(ledger.clients.map((item: any) => [item.userId, item.balancesCents]));
    const safeUsers = allUsers
      .map(user => {
        const balances: any = ledgerByUser.get(user.id) || { client_available: 0, client_reserved: 0, client_capital: 0, client_yield: 0 };
        return ({
        id: user.id,
        nomeCompleto: user.nomeCompleto,
        email: user.email,
        cpf: user.cpf,
        telefone: user.telefone,
        saldoLegado: user.saldo,
        saldoDisponivel: Number(balances.client_available || 0) / 100,
        saldoReservado: Number(balances.client_reserved || 0) / 100,
        saldoCapital: Number(balances.client_capital || 0) / 100,
        saldoRendimentos: Number(balances.client_yield || 0) / 100,
        ledgerOfficial: true,
        documentosVerificados: user.documentosVerificados,
        contaAprovada: user.contaAprovada,
        createdAt: user.createdAt,
      });
      })
      .sort((a, b) => new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime());

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.json(safeUsers);
  } catch (error) {
    console.error('Error getting users:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Get pending documents for review
router.get('/documents/pending', isAuthenticated, isAdmin, async (_req, res) => {
  try {
    const [allDocuments, allUsers] = await Promise.all([
      dualStorage.getAllDocumentos(),
      dualStorage.getAllUsers(),
    ]);
    const usersById = new Map(allUsers.map(user => [user.id, user]));
    const pendingDocs = allDocuments
      .filter(document => document.status === "pendente")
      .map(document => {
        const user = usersById.get(document.userId);
        return {
          id: document.id, userId: document.userId, tipo: document.tipo,
          status: document.status, createdAt: document.createdAt,
          user: user ? { nomeCompleto: user.nomeCompleto, email: user.email, cpf: user.cpf } : null,
        };
      })
      .sort((a, b) => new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime());
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    return res.json(pendingDocs);
  } catch (error) {
    console.error("Error getting pending documents:", error);
    return res.status(500).json({ message: "Erro interno do servidor" });
  }
});

// Get all movements
router.get('/movements', isAuthenticated, isAdmin, async (_req, res) => {
  try {
    const [storedMovements, allUsers] = await Promise.all([
      dualStorage.getAllMovimentos(),
      dualStorage.getAllUsers(),
    ]);
    const usersById = new Map(allUsers.map(user => [user.id, user]));
    const safeMovements = storedMovements.map(movement => {
      const user = usersById.get(movement.userId);
      return {
        id: movement.id, tipo: movement.tipo, valor: Number(movement.valor || 0),
        descricao: movement.descricao, createdAt: movement.createdAt,
        user: user ? { nomeCompleto: user.nomeCompleto, email: user.email } : null,
      };
    });
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    return res.json(safeMovements);
  } catch (error) {
    console.error("Error getting movements:", error);
    return res.status(500).json({ message: "Erro interno do servidor" });
  }
});

// Serve KYC documents only to authenticated administrators; never expose disk paths.
router.get('/documents/:documentId/file', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const documentId = String(req.params.documentId || "");
    if (!documentId || documentId.length > 128) {
      return res.status(400).json({ message: "Documento inválido." });
    }
    const document = await dualStorage.getDocumento(documentId);
    if (!document?.arquivo) return res.status(404).json({ message: "Arquivo não encontrado." });

    const storedFile = await readPrivateDocument(String(document.arquivo));
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", storedFile.contentType);
    res.setHeader("Content-Length", String(storedFile.buffer.length));
    return res.status(200).send(storedFile.buffer);
  } catch (error) {
    console.error("Error serving KYC document:", error);
    return res.status(500).json({ message: "Não foi possível abrir o documento." });
  }
});

// Get specific user details
router.get('/user/:userId', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    // User identity and account status come from the durable storage layer.
    const user = await dualStorage.getUser(userId);

    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Read the customer's complete history from the same durable source as their identity.
    const [storedMovements, storedTrades, storedDocuments, financialSummary, ledgerEntries, withdrawals] = await Promise.all([
      dualStorage.getUserMovimentos(userId, 100000),
      dualStorage.getUserTradeOperations(userId, 100000),
      dualStorage.getUserDocumentos(userId),
      getClientFinancialSummary(userId),
      listClientLedger(userId, 1000, 0),
      listClientWithdrawals(userId, 500),
    ]);
    const userMovements = storedMovements.map(mov => ({
      id: mov.id, tipo: mov.tipo, valor: Number(mov.valor || 0),
      descricao: mov.descricao, createdAt: mov.createdAt,
    }));

    const summary = userMovements.reduce(
      (acc, mov) => {
        if (mov.tipo === "deposito") acc.totalDeposited += mov.valor;
        if (mov.tipo === "saque") acc.totalWithdrawn += mov.valor;
        if (mov.tipo === "rendimento") acc.totalYield += mov.valor;
        return acc;
      },
      { totalDeposited: 0, totalWithdrawn: 0, totalYield: 0 }
    );

    const userTradeOperations = storedTrades.map(op => ({
      id: op.id, symbol: op.symbol, tradeType: op.tradeType, direction: op.direction,
      amount: op.amount, duration: op.duration, status: op.status, profit: op.profit,
      derivContractId: op.derivContractId, createdAt: op.createdAt, completedAt: op.completedAt,
    }));
    const userDocuments = storedDocuments.map(doc => ({
      id: doc.id, tipo: doc.tipo, status: doc.status, motivoRejeicao: doc.motivoRejeicao,
      createdAt: doc.createdAt, updatedAt: doc.updatedAt,
    }));

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.json({
      user: {
        id: user.id,
        nomeCompleto: user.nomeCompleto,
        email: user.email,
        cpf: user.cpf,
        telefone: user.telefone,
        endereco: user.endereco,
        cidade: user.cidade,
        estado: user.estado,
        cep: user.cep,
        saldoLegado: user.saldo,
        saldoDisponivel: Number(financialSummary.availableBalanceCents || 0) / 100,
        saldoReservado: Number(financialSummary.reservedBalanceCents || 0) / 100,
        saldoCapital: Number(financialSummary.capitalBalanceCents || 0) / 100,
        saldoRendimentos: Number(financialSummary.yieldBalanceCents || 0) / 100,
        contaAprovada: user.contaAprovada,
        documentosVerificados: user.documentosVerificados,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      financialSummary,
      ledgerEntries,
      withdrawals,
      movements: userMovements,
      tradeOperations: userTradeOperations,
      documents: userDocuments,
      summary
    });

  } catch (error) {
    console.error('Error getting user details:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Review document (approve/reject)
router.post('/documents/review', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { documentId, approved, reason } = req.body;

    if (!documentId || typeof approved !== 'boolean') {
      return res.status(400).json({ message: 'Dados inválidos' });
    }

    if (!approved && !reason?.trim()) {
      return res.status(400).json({ message: 'Motivo da rejeição é obrigatório' });
    }

    // Get admin user info
    const adminUserId = (req as any).session.passport?.user;
    const adminUser = adminUserId ? await dualStorage.getUser(String(adminUserId)) : null;
    if (!adminUser) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }

    const document = await dualStorage.getDocumento(String(documentId));
    if (!document) {
      return res.status(404).json({ message: "Documento não encontrado" });
    }

    const previousDecision = {
      status: document.status,
      motivoRejeicao: document.motivoRejeicao,
      aprovadoPor: document.aprovadoPor,
      aprovadoEm: document.aprovadoEm,
      updatedAt: document.updatedAt,
    };
    const updateData: any = {
      status: approved ? "aprovado" : "rejeitado",
      aprovadoPor: adminUser.email,
      aprovadoEm: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      motivoRejeicao: approved ? null : String(reason).trim(),
    };
    await dualStorage.updateDocumento(String(documentId), updateData);

    const userDocs = await dualStorage.getUserDocumentos(document.userId);
    const hasApprovedIdentity = userDocs.some(doc =>
      ["rg", "cnh"].includes(String(doc.tipo || "").toLowerCase()) && doc.status === "aprovado"
    );
    const hasApprovedAddress = userDocs.some(doc =>
      String(doc.tipo || "").toLowerCase() === "comprovante" && doc.status === "aprovado"
    );
    const documentsVerified = hasApprovedIdentity && hasApprovedAddress;

    try {
      await dualStorage.updateUser(document.userId, {
        documentosVerificados: documentsVerified,
        documentosAprovadosEm: documentsVerified ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString()
      });
    } catch (userUpdateError) {
      // Restore the durable document decision if the account-level KYC update fails.
      await dualStorage.updateDocumento(String(documentId), previousDecision);
      throw userUpdateError;
    }

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.json({
      message: approved 
        ? 'Documento aprovado com sucesso!' 
        : 'Documento rejeitado. O status e o motivo foram atualizados para consulta no perfil.',
      document: {
        id: documentId,
        status: approved ? 'aprovado' : 'rejeitado'
      }
    });

  } catch (error) {
    console.error('Error reviewing document:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Get admin dashboard statistics
router.get('/stats', isAuthenticated, isAdmin, async (_req, res) => {
  try {
    const [storedUsers, allDocuments, allMovements] = await Promise.all([
      dualStorage.getAllUsers(),
      dualStorage.getAllDocumentos(),
      dualStorage.getAllMovimentos(),
    ]);
    const allUsers = storedUsers.filter((user: any) => !user.isAdmin);
    const ledger = await getPlatformFinancialSummary(allUsers.map(user => user.id));
    const sumType = (type: string) => allMovements
      .filter(movement => movement.tipo === type)
      .reduce((sum, movement) => sum + Number(movement.valor || 0), 0);
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recent = allMovements.filter(movement => {
      const timestamp = new Date(String(movement.createdAt || "")).getTime();
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    });

    const breakdown = new Map<string, { tipo: string; total: number; count: number }>();
    for (const movement of allMovements) {
      const key = String(movement.tipo || "outro");
      const item = breakdown.get(key) || { tipo: key, total: 0, count: 0 };
      item.total += Number(movement.valor || 0);
      item.count++;
      breakdown.set(key, item);
    }

    const daily = new Map<string, { date: string; totalVolume: number; transactionCount: number }>();
    for (const movement of recent) {
      const date = new Date(String(movement.createdAt)).toISOString().slice(0, 10);
      const item = daily.get(date) || { date, totalVolume: 0, transactionCount: 0 };
      item.totalVolume += Number(movement.valor || 0);
      item.transactionCount++;
      daily.set(date, item);
    }

    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    return res.json({
      totalUsers: allUsers.length,
      verifiedUsers: allUsers.filter(user => Boolean(user.documentosVerificados)).length,
      pendingDocuments: allDocuments.filter(document => document.status === "pendente").length,
      totalBalance: Number(ledger.totalsCents.client_available || 0) / 100,
      totalReserved: Number(ledger.totalsCents.client_reserved || 0) / 100,
      totalCapital: Number(ledger.totalsCents.client_capital || 0) / 100,
      totalLedgerYields: Number(ledger.totalsCents.client_yield || 0) / 100,
      ledgerOfficial: true,
      totalInvested: sumType("deposito"),
      totalYields: sumType("rendimento"),
      totalWithdrawals: sumType("saque"),
      recentMovements: recent.length,
      movementBreakdown: Array.from(breakdown.values()),
      dailyVolume: Array.from(daily.values()).sort((x, y) => y.date.localeCompare(x.date)),
    });
  } catch (error) {
    console.error("Error getting admin stats:", error);
    return res.status(500).json({ message: "Erro interno do servidor" });
  }
});

// Get comprehensive dashboard data
router.get('/dashboard-data', isAuthenticated, isAdmin, async (_req, res) => {
  try {
    const [storedUsers, storedMovements] = await Promise.all([
      dualStorage.getAllUsers(),
      dualStorage.getAllMovimentos(),
    ]);
    const durableUsers = storedUsers.filter((user: any) => !user.isAdmin);
    const ledger = await getPlatformFinancialSummary(durableUsers.map(user => user.id));
    const ledgerByUser = new Map(ledger.clients.map((item: any) => [item.userId, item.balancesCents]));
    const usersWithFinancials = durableUsers
      .map(user => {
        const balances: any = ledgerByUser.get(user.id) || { client_available: 0, client_reserved: 0, client_capital: 0, client_yield: 0 };
        return ({
        id: user.id, nomeCompleto: user.nomeCompleto, email: user.email, cpf: user.cpf,
        saldoLegado: Number(user.saldo || 0),
        saldoDisponivel: Number(balances.client_available || 0) / 100,
        saldoReservado: Number(balances.client_reserved || 0) / 100,
        saldoCapital: Number(balances.client_capital || 0) / 100,
        saldoRendimentos: Number(balances.client_yield || 0) / 100,
        contaAprovada: Boolean(user.contaAprovada), createdAt: user.createdAt, updatedAt: user.updatedAt,
      });
      })
      .sort((a, b) => new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime());
    const usersById = new Map(usersWithFinancials.map(user => [user.id, user]));
    const allMovements = storedMovements
      .map(movement => {
        const user = usersById.get(movement.userId);
        return {
          id: movement.id, userId: movement.userId, tipo: movement.tipo,
          valor: Number(movement.valor || 0), descricao: movement.descricao,
          createdAt: movement.createdAt, userName: user?.nomeCompleto ?? "Conta não localizada",
          userEmail: user?.email ?? "",
        };
      })
      .sort((a, b) => new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime());

    const sumType = (type: string) => allMovements
      .filter(movement => movement.tipo === type)
      .reduce((sum, movement) => sum + movement.valor, 0);
    const totalInvested = sumType("deposito");
    const totalYields = sumType("rendimento");
    const totalWithdrawals = sumType("saque");
    const totalCurrentBalance = Number(ledger.totalsCents.client_available || 0) / 100;

    const movementTypes = new Map<string, { tipo: string; count: number; total: number }>();
    for (const movement of allMovements) {
      const item = movementTypes.get(movement.tipo) || { tipo: movement.tipo, count: 0, total: 0 };
      item.count++;
      item.total += movement.valor;
      movementTypes.set(movement.tipo, item);
    }

    const monthly = new Map<string, { month: string; deposits: number; yields: number; withdrawals: number; userCount: Set<string> }>();
    const monthCutoff = new Date();
    monthCutoff.setMonth(monthCutoff.getMonth() - 12);
    for (const movement of allMovements) {
      const timestamp = new Date(String(movement.createdAt || ""));
      if (!Number.isFinite(timestamp.getTime()) || timestamp < monthCutoff) continue;
      const month = timestamp.toISOString().slice(0, 7);
      const item = monthly.get(month) || { month, deposits: 0, yields: 0, withdrawals: 0, userCount: new Set<string>() };
      if (movement.tipo === "deposito") item.deposits += movement.valor;
      if (movement.tipo === "rendimento") item.yields += movement.valor;
      if (movement.tipo === "saque") item.withdrawals += movement.valor;
      item.userCount.add(movement.userId);
      monthly.set(month, item);
    }
    const monthlyGrowth = Array.from(monthly.values())
      .map(item => ({ month: item.month, deposits: item.deposits, yields: item.yields, withdrawals: item.withdrawals, userCount: item.userCount.size }))
      .sort((a, b) => b.month.localeCompare(a.month));

    const userSummaries = usersWithFinancials.map(user => {
      const userMovements = allMovements.filter(movement => movement.userId === user.id);
      const totalDeposited = userMovements.filter(movement => movement.tipo === "deposito").reduce((sum, movement) => sum + movement.valor, 0);
      const totalYield = userMovements.filter(movement => movement.tipo === "rendimento").reduce((sum, movement) => sum + movement.valor, 0);
      const totalWithdrawn = userMovements.filter(movement => movement.tipo === "saque").reduce((sum, movement) => sum + movement.valor, 0);
      const lastMovement = userMovements[0];
      return {
        ...user, totalDeposited, totalYield, totalWithdrawn,
        lastAccess: lastMovement ? lastMovement.createdAt : user.updatedAt,
        movementCount: userMovements.length,
      };
    });

    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    return res.json({
      platformTotals: {
        totalInvested, totalYields, totalWithdrawals, totalCurrentBalance,
        totalReserved: Number(ledger.totalsCents.client_reserved || 0) / 100,
        totalCapital: Number(ledger.totalsCents.client_capital || 0) / 100,
        totalLedgerYields: Number(ledger.totalsCents.client_yield || 0) / 100,
        ledgerOfficial: true,
        totalUsers: usersWithFinancials.length,
        verifiedUsers: usersWithFinancials.filter(user => user.documentosVerificados).length,
      },
      movementTypeStats: Array.from(movementTypes.values()),
      monthlyGrowth,
      userSummaries,
      recentMovements: allMovements.slice(0, 50),
    });
  } catch (error) {
    console.error("Error getting dashboard data:", error);
    return res.status(500).json({ message: "Erro interno do servidor" });
  }
});


// Generate a complete, archived PDF from the durable PostgreSQL source of truth.
router.post('/reports', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const actorUserId = String((req as any).session.passport?.user || "");
    const scope = req.body?.scope;
    if (scope !== "client" && scope !== "platform") {
      return res.status(400).json({ message: "Escopo de relatório inválido." });
    }
    const userId = scope === "client" ? String(req.body?.userId || "") : undefined;
    if (scope === "client" && (!userId || userId.length > 32)) {
      return res.status(400).json({ message: "Selecione um cliente válido." });
    }
    const report = await generateAdminFinancialReport({
      requestedBy: actorUserId,
      scope,
      userId,
      from: req.body?.from ? String(req.body.from) : undefined,
      to: req.body?.to ? String(req.body.to) : undefined,
      reason: req.body?.reason ? String(req.body.reason).slice(0, 500) : undefined,
      requestId: String(req.headers["x-request-id"] || ""),
      ip: req.ip,
      userAgent: String(req.headers["user-agent"] || ""),
    });
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    return res.status(201).json({ ...report, downloadUrl: `/api/admin/reports/${report.id}/download` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Admin financial report generation failed:", message);
    if (message === "REPORT_CLIENT_NOT_FOUND") return res.status(404).json({ message: "Cliente não encontrado." });
    if (message === "INVALID_REPORT_PERIOD") return res.status(400).json({ message: "Período inválido." });
    if (message === "DURABLE_POSTGRES_REQUIRED" || message.includes("PRIVATE_REPORT_STORAGE_NOT_CONFIGURED")) {
      return res.status(503).json({ message: "Relatórios arquivados indisponíveis: banco durável ou armazenamento privado não configurado." });
    }
    return res.status(500).json({ message: "Não foi possível gerar e arquivar o relatório." });
  }
});

// Report archive index; metadata only, never exposes storage references.
router.get('/reports', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const requested = Number.parseInt(String(req.query.limit || "100"), 10);
    const reports = await listAdminReports(Number.isFinite(requested) ? requested : 100);
    return res.json(reports.map((report: any) => ({
      id: report.id, scope: report.reportScope, subjectUserId: report.subjectUserId,
      periodStart: report.periodStart, periodEnd: report.periodEnd, rowCount: report.rowCount,
      contentSha256: report.contentSha256, createdAt: report.createdAt,
      downloadUrl: `/api/admin/reports/${report.id}/download`,
    })));
  } catch (error) {
    console.error("Admin report archive listing failed:", error);
    return res.status(503).json({ message: "Não foi possível consultar o arquivo de relatórios." });
  }
});

// Every report download is authorized and written to the financial audit trail.
router.get('/reports/:reportId/download', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const reportId = String(req.params.reportId || "");
    if (!/^[0-9a-f-]{36}$/i.test(reportId)) return res.status(400).json({ message: "Relatório inválido." });
    const report = await getAdminReport(reportId);
    if (!report) return res.status(404).json({ message: "Relatório não encontrado." });
    const actorUserId = String((req as any).session.passport?.user || "");
    const buffer = await recordAdminReportDownload(report, actorUserId, {
      requestId: String(req.headers["x-request-id"] || ""), ip: req.ip,
      userAgent: String(req.headers["user-agent"] || ""),
    });
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(buffer.length));
    res.setHeader("Content-Disposition", `attachment; filename="invistapro-relatorio-${report.id}.pdf"`);
    return res.status(200).send(buffer);
  } catch (error) {
    console.error("Admin report download failed:", error);
    return res.status(503).json({ message: "Não foi possível validar e recuperar o PDF arquivado." });
  }
});

export default router;