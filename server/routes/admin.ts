import express from "express";
import { db } from "../db";
import { eq, desc, sql } from "drizzle-orm";
import { users, movimentos, documentos } from "@shared/schema";
import { isAuthenticated } from "../auth";
import { isAuthorizedEmail, ACCESS_DENIED_MESSAGE } from "../config/access";

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
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    
    if (user.length === 0) {
      return res.json({
        hasAccess: false,
        userEmail: null,
        message: 'Usuário não encontrado'
      });
    }
    
    const userEmail = user[0].email;
    const envAdminEmail = process.env.ADMIN_EMAIL;
    
    const hasAccess = isAuthorizedEmail(userEmail) || 
                      (envAdminEmail && userEmail.toLowerCase() === envAdminEmail.toLowerCase());
    
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
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    
    if (user.length === 0) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }
    
    // Verificar se o usuário está na lista de autorizados ou é admin via env
    const userEmail = user[0].email;
    const envAdminEmail = process.env.ADMIN_EMAIL;
    
    const hasAccess = isAuthorizedEmail(userEmail) || 
                      (envAdminEmail && userEmail.toLowerCase() === envAdminEmail.toLowerCase());
    
    if (!hasAccess) {
      return res.status(403).json({ message: ACCESS_DENIED_MESSAGE });
    }
    
    next();
  } catch (error) {
    console.error('Error checking admin status:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
};

// Get all users
router.get('/users', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const allUsers = await db
      .select({
        id: users.id,
        nomeCompleto: users.nomeCompleto,
        email: users.email,
        cpf: users.cpf,
        telefone: users.telefone,
        saldo: users.saldo,
        documentosVerificados: users.documentosVerificados,
        contaAprovada: users.contaAprovada,
        createdAt: users.createdAt
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    res.json(allUsers);
  } catch (error) {
    console.error('Error getting users:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Get pending documents for review
router.get('/documents/pending', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const pendingDocs = await db
      .select({
        id: documentos.id,
        userId: documentos.userId,
        tipo: documentos.tipo,
        status: documentos.status,
        createdAt: documentos.createdAt,
        user: {
          nomeCompleto: users.nomeCompleto,
          email: users.email,
          cpf: users.cpf
        }
      })
      .from(documentos)
      .innerJoin(users, eq(documentos.userId, users.id))
      .where(eq(documentos.status, 'pendente'))
      .orderBy(desc(documentos.createdAt));

    res.json(pendingDocs);
  } catch (error) {
    console.error('Error getting pending documents:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Get all movements
router.get('/movements', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const allMovements = await db
      .select({
        id: movimentos.id,
        tipo: movimentos.tipo,
        valor: movimentos.valor,
        descricao: movimentos.descricao,
        createdAt: movimentos.createdAt,
        user: {
          nomeCompleto: users.nomeCompleto,
          email: users.email
        }
      })
      .from(movimentos)
      .innerJoin(users, eq(movimentos.userId, users.id))
      .orderBy(desc(movimentos.createdAt))
      .limit(100); // Limit to last 100 movements

    res.json(allMovements);
  } catch (error) {
    console.error('Error getting movements:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Get specific user details
router.get('/user/:userId', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    // Get user details
    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (user.length === 0) {
      return res.status(404).json({ message: 'Usuário não encontrado' });
    }

    // Get user movements
    const userMovements = await db
      .select()
      .from(movimentos)
      .where(eq(movimentos.userId, userId))
      .orderBy(desc(movimentos.createdAt));

    // Calculate financial summary
    const summary = userMovements.reduce(
      (acc, mov) => {
        switch (mov.tipo) {
          case 'deposito':
            acc.totalDeposited += mov.valor;
            break;
          case 'saque':
            acc.totalWithdrawn += mov.valor;
            break;
          case 'rendimento':
            acc.totalYield += mov.valor;
            break;
        }
        return acc;
      },
      { totalDeposited: 0, totalWithdrawn: 0, totalYield: 0 }
    );

    // Get user documents
    const userDocuments = await db
      .select()
      .from(documentos)
      .where(eq(documentos.userId, userId))
      .orderBy(desc(documentos.createdAt));

    res.json({
      user: user[0],
      movements: userMovements,
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
    const adminUser = await db
      .select()
      .from(users)
      .where(eq(users.id, adminUserId))
      .limit(1);

    // Get document info
    const document = await db
      .select()
      .from(documentos)
      .where(eq(documentos.id, documentId))
      .limit(1);

    if (document.length === 0) {
      return res.status(404).json({ message: 'Documento não encontrado' });
    }

    // Update document status
    const updateData: any = {
      status: approved ? 'aprovado' : 'rejeitado',
      aprovadoPor: adminUser[0].email,
      aprovadoEm: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (!approved) {
      updateData.motivoRejeicao = reason;
    }

    await db
      .update(documentos)
      .set(updateData)
      .where(eq(documentos.id, documentId));

    // Check if all user documents are approved
    const userDocs = await db
      .select()
      .from(documentos)
      .where(eq(documentos.userId, document[0].userId));

    const requiredDocs = ['rg', 'comprovante']; // RG/CNH and comprovante are required
    const approvedRequiredDocs = userDocs.filter(doc => 
      requiredDocs.includes(doc.tipo) && doc.status === 'aprovado'
    );

    // If all required documents are approved, mark user as verified
    if (approved && approvedRequiredDocs.length >= requiredDocs.length) {
      await db
        .update(users)
        .set({
          documentosVerificados: true,
          documentosAprovadosEm: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        })
        .where(eq(users.id, document[0].userId));
    } else if (!approved) {
      // If any required document is rejected, mark user as not verified
      const hasRejectedRequired = userDocs.some(doc => 
        requiredDocs.includes(doc.tipo) && doc.status === 'rejeitado'
      );
      
      if (hasRejectedRequired) {
        await db
          .update(users)
          .set({
            documentosVerificados: false,
            documentosAprovadosEm: null,
            updatedAt: new Date().toISOString()
          })
          .where(eq(users.id, document[0].userId));
      }
    }

    res.json({
      message: approved 
        ? 'Documento aprovado com sucesso!' 
        : 'Documento rejeitado. Usuário foi notificado.',
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
router.get('/stats', isAuthenticated, isAdmin, async (req, res) => {
  try {
    // Get total users count
    const [totalUsersResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users);

    // Get verified users count
    const [verifiedUsersResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(users)
      .where(eq(users.documentosVerificados, true));

    // Get pending documents count
    const [pendingDocsResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(documentos)
      .where(eq(documentos.status, 'pendente'));

    // Get total current balance (saldo com rendimentos)
    const [totalBalanceResult] = await db
      .select({ 
        total: sql<number>`COALESCE(SUM(${users.saldo}), 0)` 
      })
      .from(users);

    // Calculate total invested amount (only deposits)
    const [totalDepositedResult] = await db
      .select({ 
        total: sql<number>`COALESCE(SUM(${movimentos.valor}), 0)` 
      })
      .from(movimentos)
      .where(eq(movimentos.tipo, 'deposito'));

    // Calculate total yields generated
    const [totalYieldsResult] = await db
      .select({ 
        total: sql<number>`COALESCE(SUM(${movimentos.valor}), 0)` 
      })
      .from(movimentos)
      .where(eq(movimentos.tipo, 'rendimento'));

    // Calculate total withdrawals
    const [totalWithdrawalsResult] = await db
      .select({ 
        total: sql<number>`COALESCE(SUM(${movimentos.valor}), 0)` 
      })
      .from(movimentos)
      .where(eq(movimentos.tipo, 'saque'));

    // Get recent movements count
    const [recentMovementsResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(movimentos)
      .where(sql`${movimentos.createdAt} >= date('now', '-30 days')`);

    // Get movement breakdown by type
    const movementBreakdown = await db
      .select({ 
        tipo: movimentos.tipo,
        total: sql<number>`COALESCE(SUM(${movimentos.valor}), 0)`,
        count: sql<number>`count(*)`
      })
      .from(movimentos)
      .groupBy(movimentos.tipo);

    // Get daily transaction volumes for the last 30 days
    const dailyVolume = await db
      .select({ 
        date: sql<string>`date(${movimentos.createdAt})`,
        totalVolume: sql<number>`COALESCE(SUM(${movimentos.valor}), 0)`,
        transactionCount: sql<number>`count(*)`
      })
      .from(movimentos)
      .where(sql`${movimentos.createdAt} >= date('now', '-30 days')`)
      .groupBy(sql`date(${movimentos.createdAt})`)
      .orderBy(sql`date(${movimentos.createdAt}) DESC`);

    res.json({
      totalUsers: totalUsersResult.count,
      verifiedUsers: verifiedUsersResult.count,
      pendingDocuments: pendingDocsResult.count,
      totalBalance: totalBalanceResult.total,
      totalInvested: totalDepositedResult.total,
      totalYields: totalYieldsResult.total,
      totalWithdrawals: totalWithdrawalsResult.total,
      recentMovements: recentMovementsResult.count,
      movementBreakdown,
      dailyVolume
    });

  } catch (error) {
    console.error('Error getting admin stats:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

// Get comprehensive dashboard data
router.get('/dashboard-data', isAuthenticated, isAdmin, async (req, res) => {
  try {
    // Get all users with their financial data and last access info
    const usersWithFinancials = await db
      .select({
        id: users.id,
        nomeCompleto: users.nomeCompleto,
        email: users.email,
        cpf: users.cpf,
        saldo: users.saldo,
        documentosVerificados: users.documentosVerificados,
        contaAprovada: users.contaAprovada,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt
      })
      .from(users)
      .orderBy(desc(users.createdAt));

    // Get detailed movement history for all users
    const allMovements = await db
      .select({
        id: movimentos.id,
        userId: movimentos.userId,
        tipo: movimentos.tipo,
        valor: movimentos.valor,
        descricao: movimentos.descricao,
        createdAt: movimentos.createdAt,
        userName: users.nomeCompleto,
        userEmail: users.email
      })
      .from(movimentos)
      .innerJoin(users, eq(movimentos.userId, users.id))
      .orderBy(desc(movimentos.createdAt));

    // Calculate platform totals
    const [totalInvestedResult] = await db
      .select({ 
        total: sql<number>`COALESCE(SUM(${movimentos.valor}), 0)` 
      })
      .from(movimentos)
      .where(eq(movimentos.tipo, 'deposito'));

    const [totalYieldsResult] = await db
      .select({ 
        total: sql<number>`COALESCE(SUM(${movimentos.valor}), 0)` 
      })
      .from(movimentos)
      .where(eq(movimentos.tipo, 'rendimento'));

    const [totalWithdrawalsResult] = await db
      .select({ 
        total: sql<number>`COALESCE(SUM(${movimentos.valor}), 0)` 
      })
      .from(movimentos)
      .where(eq(movimentos.tipo, 'saque'));

    const [totalCurrentBalanceResult] = await db
      .select({ 
        total: sql<number>`COALESCE(SUM(${users.saldo}), 0)` 
      })
      .from(users);

    // Get movement counts by type for pie chart
    const movementTypeStats = await db
      .select({ 
        tipo: movimentos.tipo,
        count: sql<number>`count(*)`,
        total: sql<number>`COALESCE(SUM(${movimentos.valor}), 0)`
      })
      .from(movimentos)
      .groupBy(movimentos.tipo);

    // Get monthly growth data (last 12 months)
    const monthlyGrowth = await db
      .select({ 
        month: sql<string>`strftime('%Y-%m', ${movimentos.createdAt})`,
        deposits: sql<number>`COALESCE(SUM(CASE WHEN ${movimentos.tipo} = 'deposito' THEN ${movimentos.valor} ELSE 0 END), 0)`,
        yields: sql<number>`COALESCE(SUM(CASE WHEN ${movimentos.tipo} = 'rendimento' THEN ${movimentos.valor} ELSE 0 END), 0)`,
        withdrawals: sql<number>`COALESCE(SUM(CASE WHEN ${movimentos.tipo} = 'saque' THEN ${movimentos.valor} ELSE 0 END), 0)`,
        userCount: sql<number>`count(DISTINCT ${movimentos.userId})`
      })
      .from(movimentos)
      .where(sql`${movimentos.createdAt} >= date('now', '-12 months')`)
      .groupBy(sql`strftime('%Y-%m', ${movimentos.createdAt})`)
      .orderBy(sql`strftime('%Y-%m', ${movimentos.createdAt}) DESC`);

    // Calculate individual user summaries
    const userSummaries = usersWithFinancials.map(user => {
      const userMovements = allMovements.filter(mov => mov.userId === user.id);
      
      const totalDeposited = userMovements
        .filter(mov => mov.tipo === 'deposito')
        .reduce((sum, mov) => sum + mov.valor, 0);
      
      const totalYield = userMovements
        .filter(mov => mov.tipo === 'rendimento')
        .reduce((sum, mov) => sum + mov.valor, 0);
        
      const totalWithdrawn = userMovements
        .filter(mov => mov.tipo === 'saque')
        .reduce((sum, mov) => sum + mov.valor, 0);

      const lastMovement = userMovements[0]; // Sorted by desc createdAt
      const lastAccess = lastMovement ? lastMovement.createdAt : user.updatedAt;

      return {
        ...user,
        totalDeposited,
        totalYield,
        totalWithdrawn,
        lastAccess,
        movementCount: userMovements.length
      };
    });

    res.json({
      // Platform totals
      platformTotals: {
        totalInvested: totalInvestedResult.total,
        totalYields: totalYieldsResult.total,
        totalWithdrawals: totalWithdrawalsResult.total,
        totalCurrentBalance: totalCurrentBalanceResult.total,
        totalUsers: usersWithFinancials.length,
        verifiedUsers: usersWithFinancials.filter(u => u.documentosVerificados).length
      },
      
      // Chart data
      movementTypeStats,
      monthlyGrowth,
      
      // User details
      userSummaries,
      
      // Recent movements
      recentMovements: allMovements.slice(0, 50)
    });

  } catch (error) {
    console.error('Error getting dashboard data:', error);
    res.status(500).json({ message: 'Erro interno do servidor' });
  }
});

export default router;