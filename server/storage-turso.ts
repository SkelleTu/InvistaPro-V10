/**
 * TURSO STORAGE - Banco principal da plataforma InvistaPRO
 *
 * Usa @libsql/client + Drizzle ORM para conectar ao Turso (libSQL na nuvem).
 * O schema é 100% compatível com SQLite, portanto reutiliza shared/schema.ts.
 *
 * Este storage implementa a mesma interface IStorage do storage.ts,
 * mas aponta para o banco Turso em vez do SQLite local.
 */

import {
  users,
  movimentos,
  documentos,
  derivTokens,
  tradeConfigurations,
  tradeOperations,
  aiLogs,
  marketData,
  dailyPnL,
  aiRecoveryStrategies,
  activeTradingSessions,
  activeWebSocketSubscriptions,
  systemHealthHeartbeat,
  tradingControl,
  assetBlacklist,
  pauseConfiguration,
  type User,
  type InsertUser,
  type UpdateUser,
  type Movimento,
  type InsertMovimento,
  type Documento,
  type InsertDocumento,
  type DerivToken,
  type InsertDerivToken,
  type TradeConfiguration,
  type InsertTradeConfiguration,
  type TradeOperation,
  type InsertTradeOperation,
  type AiLog,
  type InsertAiLog,
  type MarketData,
  type InsertMarketData,
  type DailyPnL,
  type InsertDailyPnL,
  type AiRecoveryStrategy,
  type InsertAiRecoveryStrategy,
  type ActiveTradingSession,
  type InsertActiveTradingSession,
  type ActiveWebSocketSubscription,
  type InsertActiveWebSocketSubscription,
  type SystemHealthHeartbeat,
  type InsertSystemHealthHeartbeat,
  type TradingControl,
  type InsertTradingControl,
  type AssetBlacklist,
  type InsertAssetBlacklist,
  type PauseConfiguration,
  type InsertPauseConfiguration,
  type UpdatePauseConfiguration,
} from "@shared/schema";
import { tursoDb } from "./db-turso";
import { eq, desc, and, sql } from "drizzle-orm";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto";
import type { IStorage } from "./storage";

class EncryptionService {
  private static getKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY?.trim();
    if (!key) throw new Error('ENCRYPTION_KEY não configurada');
    if (!/^[0-9a-fA-F]{64}$/.test(key)) throw new Error('ENCRYPTION_KEY deve ter 64 caracteres hex');
    return Buffer.from(key, 'hex');
  }

  static encrypt(text: string): string {
    const algorithm = 'aes-256-gcm';
    const key = this.getKey();
    const iv = randomBytes(16);
    const cipher = createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
  }

  static decrypt(encryptedData: string): string {
    if (!encryptedData.includes(':')) return encryptedData;
    const parts = encryptedData.split(':');
    if (parts.length !== 3) throw new Error('Formato inválido de dados encriptados');
    const algorithm = 'aes-256-gcm';
    const key = this.getKey();
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    const decipher = createDecipheriv(algorithm, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}

function getDb() {
  if (!tursoDb) throw new Error('Turso não disponível');
  return tursoDb;
}

export class TursoStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await getDb().select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await getDb().select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByCpf(cpf: string): Promise<User | undefined> {
    const [user] = await getDb().select().from(users).where(eq(users.cpf, cpf));
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await getDb().select().from(users);
  }

  async createUser(userData: InsertUser): Promise<User> {
    const [user] = await getDb().insert(users).values(userData).returning();
    return user;
  }

  async updateUser(id: string, data: UpdateUser): Promise<User> {
    const [user] = await getDb()
      .update(users)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async updateVerificationCode(userId: string, code: string, expiresAt: Date): Promise<void> {
    await getDb()
      .update(users)
      .set({
        codigoVerificacao: code,
        codigoExpiresAt: expiresAt.toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, userId));
  }

  async verifyPhone(userId: string): Promise<User> {
    const [user] = await getDb()
      .update(users)
      .set({
        telefoneVerificado: true,
        codigoVerificacao: null,
        codigoExpiresAt: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async approveAccount(userId: string, approvedBy: string): Promise<User> {
    const [user] = await getDb()
      .update(users)
      .set({
        contaAprovada: true,
        aprovadaPor: approvedBy,
        aprovadaEm: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, userId))
      .returning();
    return user;
  }

  async createMovimento(movimento: InsertMovimento): Promise<Movimento> {
    const [newMovimento] = await getDb().insert(movimentos).values(movimento).returning();
    return newMovimento;
  }

  async getUserMovimentos(userId: string, limit = 10): Promise<Movimento[]> {
    return await getDb()
      .select()
      .from(movimentos)
      .where(eq(movimentos.userId, userId))
      .orderBy(desc(movimentos.createdAt))
      .limit(limit);
  }

  async calcularRendimento(saldo: number): Promise<number> {
    const taxaMensal = 0.00835;
    return Math.round(saldo * taxaMensal * 100) / 100;
  }

  async createDocumento(documento: InsertDocumento): Promise<Documento> {
    const [newDocumento] = await getDb().insert(documentos).values(documento).returning();
    return newDocumento;
  }

  async getUserDocumentos(userId: string): Promise<Documento[]> {
    return await getDb()
      .select()
      .from(documentos)
      .where(eq(documentos.userId, userId))
      .orderBy(desc(documentos.createdAt));
  }

  async updateDocumentoStatus(id: string, status: string, motivoRejeicao?: string): Promise<Documento> {
    const [documento] = await getDb()
      .update(documentos)
      .set({ status, motivoRejeicao, updatedAt: new Date().toISOString() })
      .where(eq(documentos.id, id))
      .returning();
    return documento;
  }

  async createDerivToken(tokenData: InsertDerivToken): Promise<DerivToken> {
    const db = getDb();
    await db
      .update(derivTokens)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(derivTokens.userId, tokenData.userId));

    const [newToken] = await db
      .insert(derivTokens)
      .values({ ...tokenData, token: EncryptionService.encrypt(tokenData.token), isActive: true })
      .returning();

    return { ...newToken, token: EncryptionService.decrypt(newToken.token) };
  }

  async getUserDerivToken(userId: string): Promise<DerivToken | undefined> {
    const [token] = await getDb()
      .select()
      .from(derivTokens)
      .where(and(eq(derivTokens.userId, userId), eq(derivTokens.isActive, true)));
    if (!token) return undefined;
    return { ...token, token: EncryptionService.decrypt(token.token) };
  }

  async updateDerivToken(userId: string, token: string, accountType: string): Promise<DerivToken> {
    const db = getDb();
    await db
      .update(derivTokens)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(derivTokens.userId, userId));

    const [newToken] = await db
      .insert(derivTokens)
      .values({ userId, token: EncryptionService.encrypt(token), accountType, isActive: true })
      .returning();

    return { ...newToken, token: EncryptionService.decrypt(newToken.token) };
  }

  async deactivateDerivToken(userId: string): Promise<void> {
    await getDb()
      .update(derivTokens)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(derivTokens.userId, userId));
  }

  async createTradeConfig(configData: InsertTradeConfiguration): Promise<TradeConfiguration> {
    const db = getDb();
    await db
      .update(tradeConfigurations)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(tradeConfigurations.userId, configData.userId));

    const [config] = await db
      .insert(tradeConfigurations)
      .values({ ...configData, isActive: true })
      .returning();
    return config;
  }

  async getUserTradeConfig(userId: string): Promise<TradeConfiguration | undefined> {
    const [config] = await getDb()
      .select()
      .from(tradeConfigurations)
      .where(and(eq(tradeConfigurations.userId, userId), eq(tradeConfigurations.isActive, true)));
    return config;
  }

  async getAllTradeConfigurations(): Promise<TradeConfiguration[]> {
    return await getDb()
      .select()
      .from(tradeConfigurations)
      .orderBy(desc(tradeConfigurations.createdAt));
  }

  async getActiveTradeConfigurations(): Promise<TradeConfiguration[]> {
    return await getDb()
      .select()
      .from(tradeConfigurations)
      .where(eq(tradeConfigurations.isActive, true))
      .orderBy(desc(tradeConfigurations.createdAt));
  }

  async updateTradeConfig(userId: string, mode: string): Promise<TradeConfiguration> {
    if (!userId?.trim()) throw new Error('userId inválido');
    if (!mode?.trim()) throw new Error('mode inválido');

    const modeConfigs: Record<string, { operations: number; interval: string; value: number }> = {
      'production_3-4_24h': { operations: 4, interval: 'hours', value: 6 },
      'production_2_24h': { operations: 2, interval: 'hours', value: 12 },
      'test_4_1min': { operations: 4, interval: 'minutes', value: 1 },
      'test_3_2min': { operations: 3, interval: 'minutes', value: 2 },
      'test_4_1hour': { operations: 4, interval: 'hours', value: 1 },
      'test_3_2hour': { operations: 3, interval: 'hours', value: 2 },
      'test_limitado_seguro': { operations: 5, interval: 'minutes', value: 30 },
      'test_sem_limites': { operations: 50, interval: 'minutes', value: 5 },
    };

    const config = modeConfigs[mode];
    if (!config) throw new Error(`Mode inválido: ${mode}`);

    const db = getDb();
    await db
      .update(tradeConfigurations)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(tradeConfigurations.userId, userId));

    const [newConfig] = await db
      .insert(tradeConfigurations)
      .values({ userId, mode, isActive: true, operationsCount: config.operations, intervalType: config.interval, intervalValue: config.value })
      .returning();
    return newConfig;
  }

  async deactivateAllTradeConfigs(userId: string): Promise<void> {
    await getDb()
      .update(tradeConfigurations)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(tradeConfigurations.userId, userId));
  }

  async reactivateTradeConfiguration(id: string): Promise<void> {
    await getDb()
      .update(tradeConfigurations)
      .set({ isActive: true, updatedAt: new Date().toISOString() })
      .where(eq(tradeConfigurations.id, id));
  }

  async deactivateTradeConfiguration(id: string): Promise<void> {
    await getDb()
      .update(tradeConfigurations)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(tradeConfigurations.id, id));
  }

  async createTradeOperation(operationData: InsertTradeOperation): Promise<TradeOperation> {
    if (!operationData.userId?.trim()) throw new Error('userId inválido');
    if (!operationData.symbol?.trim()) throw new Error('symbol inválido');
    if (!operationData.direction || !['up', 'down'].includes(operationData.direction)) throw new Error('direction inválido');
    if (!operationData.amount || operationData.amount <= 0) throw new Error('amount inválido');
    if (!operationData.duration || operationData.duration <= 0) throw new Error('duration inválido');

    const derivToken = await this.getUserDerivToken(operationData.userId);
    if (!derivToken?.token?.trim()) throw new Error('Token Deriv não encontrado');

    const tradeConfig = await this.getUserTradeConfig(operationData.userId);
    if (!tradeConfig?.isActive) throw new Error('Configuração de trade não encontrada');

    const [operation] = await getDb().insert(tradeOperations).values(operationData).returning();
    return operation;
  }

  async getUserTradeOperations(userId: string, limit = 50): Promise<TradeOperation[]> {
    return await getDb()
      .select()
      .from(tradeOperations)
      .where(eq(tradeOperations.userId, userId))
      .orderBy(desc(tradeOperations.createdAt))
      .limit(limit);
  }

  async updateTradeOperation(id: string, updates: Partial<TradeOperation>): Promise<TradeOperation> {
    const allowedFields = [
      'status', 'profit', 'entryPrice', 'exitPrice', 'derivContractId', 'completedAt',
      'shortcode', 'buyPrice', 'sellPrice', 'entryEpoch', 'exitEpoch',
      'contractType', 'barrier', 'derivStatus', 'derivProfit', 'payout',
      'statusChangedAt', 'lastSyncAt', 'syncCount',
    ];
    const safeUpdates: any = {};
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) safeUpdates[key] = value;
    }

    const db = getDb();
    const [current] = await db.select().from(tradeOperations).where(eq(tradeOperations.id, id)).limit(1);

    if (current && !safeUpdates.completedAt) {
      const isTransitioning = current.status !== 'won' && current.status !== 'lost' &&
        (safeUpdates.status === 'won' || safeUpdates.status === 'lost');
      if (isTransitioning) safeUpdates.completedAt = new Date().toISOString();
    }

    const [operation] = await db.update(tradeOperations).set(safeUpdates).where(eq(tradeOperations.id, id)).returning();
    return operation;
  }

  async getActiveTradeOperations(userId: string): Promise<TradeOperation[]> {
    return await getDb()
      .select()
      .from(tradeOperations)
      .where(and(eq(tradeOperations.userId, userId), eq(tradeOperations.status, 'active')))
      .orderBy(desc(tradeOperations.createdAt));
  }

  async createAiLog(logData: InsertAiLog): Promise<AiLog> {
    const [log] = await getDb().insert(aiLogs).values(logData).returning();
    return log;
  }

  async getUserAiLogs(userId: string, limit = 100): Promise<AiLog[]> {
    return await getDb()
      .select()
      .from(aiLogs)
      .where(eq(aiLogs.userId, userId))
      .orderBy(desc(aiLogs.createdAt))
      .limit(limit);
  }

  async getLatestAiAnalysis(userId: string): Promise<AiLog[]> {
    return await getDb()
      .select()
      .from(aiLogs)
      .where(eq(aiLogs.userId, userId))
      .orderBy(desc(aiLogs.createdAt))
      .limit(10);
  }

  async upsertMarketData(dataInput: InsertMarketData): Promise<MarketData> {
    const db = getDb();
    const existing = await this.getMarketData(dataInput.symbol);

    if (existing) {
      const [updated] = await db
        .update(marketData)
        .set({ currentPrice: dataInput.currentPrice, priceHistory: dataInput.priceHistory, lastUpdate: new Date().toISOString() })
        .where(eq(marketData.symbol, dataInput.symbol))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(marketData).values(dataInput).returning();
      return created;
    }
  }

  async getMarketData(symbol: string): Promise<MarketData | undefined> {
    const [data] = await getDb().select().from(marketData).where(eq(marketData.symbol, symbol));
    return data;
  }

  async getAllMarketData(): Promise<MarketData[]> {
    return await getDb().select().from(marketData).orderBy(desc(marketData.lastUpdate));
  }

  async getTradingStats(userId: string): Promise<{ totalTrades: number; wonTrades: number; lostTrades: number; totalProfit: number; winRate: number }> {
    const operations = await getDb().select().from(tradeOperations).where(eq(tradeOperations.userId, userId));
    const completedTrades = operations.filter(op => op.status !== 'pending' && op.profit !== null && op.profit !== undefined);
    const wonTrades = completedTrades.filter(op => (op.profit || 0) > 0).length;
    const lostTrades = completedTrades.filter(op => (op.profit || 0) < 0).length;
    const totalProfit = completedTrades.reduce((sum, op) => sum + (op.profit || 0), 0);
    const winRate = completedTrades.length > 0 ? (wonTrades / completedTrades.length) * 100 : 0;
    return { totalTrades: operations.length, wonTrades, lostTrades, totalProfit, winRate: Math.round(winRate * 100) / 100 };
  }

  async getActiveTradesCount(userId: string): Promise<number> {
    const operations = await getDb()
      .select()
      .from(tradeOperations)
      .where(and(eq(tradeOperations.userId, userId), eq(tradeOperations.status, 'active')));
    return operations.length;
  }

  async getDailyLossCount(userId: string, date: string): Promise<number> {
    const operations = await getDb()
      .select()
      .from(tradeOperations)
      .where(and(eq(tradeOperations.userId, userId), eq(tradeOperations.status, 'lost')));

    return operations.filter(op => {
      if (!op.completedAt) return false;
      try { return op.completedAt.split('T')[0] === date; } catch { return false; }
    }).length;
  }

  async saveActiveTradeForTracking(tradeData: any): Promise<void> {
    await getDb().insert(tradeOperations).values({
      userId: tradeData.userId,
      derivContractId: tradeData.contractId,
      symbol: tradeData.symbol,
      tradeType: tradeData.tradeType || 'digitdiff',
      direction: tradeData.direction || 'up',
      amount: tradeData.amount || 0,
      duration: tradeData.duration || 1,
      status: 'active',
      aiConsensus: JSON.stringify(tradeData.aiConsensus || {}),
      createdAt: new Date().toISOString(),
    });
  }

  async createOrUpdateDailyPnL(userId: string, dailyData: Partial<InsertDailyPnL>): Promise<DailyPnL> {
    const today = new Date().toISOString().split('T')[0];
    const db = getDb();

    const existing = await db
      .select()
      .from(dailyPnL)
      .where(and(eq(dailyPnL.userId, userId), eq(dailyPnL.date, today)))
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db
        .update(dailyPnL)
        .set({ ...dailyData, updatedAt: new Date().toISOString() })
        .where(eq(dailyPnL.id, existing[0].id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(dailyPnL).values({
        userId, date: today,
        openingBalance: dailyData.openingBalance || 0,
        currentBalance: dailyData.currentBalance || 0,
        dailyPnL: dailyData.dailyPnL || 0,
        ...dailyData,
      }).returning();
      return created;
    }
  }

  async getDailyPnL(userId: string, date?: string): Promise<DailyPnL | undefined> {
    const targetDate = date || new Date().toISOString().split('T')[0];
    const [record] = await getDb()
      .select()
      .from(dailyPnL)
      .where(and(eq(dailyPnL.userId, userId), eq(dailyPnL.date, targetDate)))
      .limit(1);
    return record;
  }

  async getConservativeOperationsToday(userId: string): Promise<number> {
    const record = await this.getDailyPnL(userId);
    return record?.conservativeOperations || 0;
  }

  async incrementConservativeOperations(userId: string): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    const db = getDb();

    const updated = await db
      .update(dailyPnL)
      .set({ conservativeOperations: sql`${dailyPnL.conservativeOperations} + 1`, updatedAt: new Date().toISOString() })
      .where(and(eq(dailyPnL.userId, userId), eq(dailyPnL.date, today)))
      .returning();

    if (updated.length > 0) return updated[0].conservativeOperations || 1;

    const tokenData = await this.getUserDerivToken(userId);
    const openingBalance = tokenData?.accountType === 'demo' ? 10000 : 100;

    const [created] = await db.insert(dailyPnL).values({
      userId, date: today, openingBalance, currentBalance: openingBalance,
      dailyPnL: 0, conservativeOperations: 1, totalTrades: 0, wonTrades: 0, lostTrades: 0,
    }).returning();
    return created.conservativeOperations || 1;
  }

  async getRecentDailyPnL(userId: string, days = 7): Promise<DailyPnL[]> {
    return await getDb()
      .select()
      .from(dailyPnL)
      .where(eq(dailyPnL.userId, userId))
      .orderBy(desc(dailyPnL.date))
      .limit(days);
  }

  async createAiRecoveryStrategy(strategyData: InsertAiRecoveryStrategy): Promise<AiRecoveryStrategy> {
    const [strategy] = await getDb().insert(aiRecoveryStrategies).values(strategyData).returning();
    return strategy;
  }

  async getUserRecoveryStrategies(userId: string): Promise<AiRecoveryStrategy[]> {
    return await getDb()
      .select()
      .from(aiRecoveryStrategies)
      .where(eq(aiRecoveryStrategies.userId, userId))
      .orderBy(desc(aiRecoveryStrategies.successRate));
  }

  async updateRecoveryStrategy(id: string, updates: Partial<AiRecoveryStrategy>): Promise<AiRecoveryStrategy> {
    const [updated] = await getDb()
      .update(aiRecoveryStrategies)
      .set({ ...updates, updatedAt: new Date().toISOString() })
      .where(eq(aiRecoveryStrategies.id, id))
      .returning();
    return updated;
  }

  async calculateRecoveryMultiplier(userId: string): Promise<number> {
    let todayPnL = await this.getDailyPnL(userId);
    if (!todayPnL) {
      const tokenData = await this.getUserDerivToken(userId);
      const initialBalance = tokenData?.accountType === 'demo' ? 10000 : 100;
      todayPnL = await this.createOrUpdateDailyPnL(userId, { openingBalance: initialBalance, currentBalance: initialBalance, dailyPnL: 0 });
    }
    const lossPercent = Math.abs(todayPnL.dailyPnL) / todayPnL.openingBalance;
    if (lossPercent >= 0.20) return 3.5;
    if (lossPercent >= 0.15) return 2.8;
    if (lossPercent >= 0.10) return 2.2;
    if (lossPercent >= 0.05) return 1.6;
    if (lossPercent >= 0.02) return 1.3;
    return 1.0;
  }

  async shouldActivateRecovery(userId: string): Promise<boolean> {
    let todayPnL = await this.getDailyPnL(userId);
    if (!todayPnL) {
      const tokenData = await this.getUserDerivToken(userId);
      const initialBalance = tokenData?.accountType === 'demo' ? 10000 : 100;
      todayPnL = await this.createOrUpdateDailyPnL(userId, { openingBalance: initialBalance, currentBalance: initialBalance, dailyPnL: 0 });
    }
    const lossPercent = Math.abs(todayPnL.dailyPnL) / todayPnL.openingBalance;
    return lossPercent >= (todayPnL.recoveryThreshold || 0.75);
  }

  async getRecoveryThresholdRecommendation(userId: string): Promise<number> {
    const todayPnL = await this.getDailyPnL(userId);
    if (!todayPnL) return 0.75;
    const lossPercent = Math.abs(todayPnL.dailyPnL) / todayPnL.openingBalance;
    if (lossPercent >= 0.25) return 0.95;
    if (lossPercent >= 0.20) return 0.90;
    if (lossPercent >= 0.15) return 0.87;
    if (lossPercent >= 0.10) return 0.83;
    if (lossPercent >= 0.05) return 0.80;
    if (lossPercent >= 0.02) return 0.77;
    return 0.75;
  }

  async canExecuteTradeWithoutViolatingMinimum(userId: string, potentialLoss: number): Promise<{ canExecute: boolean; reason?: string; currentBalance: number; minimumRequired: number }> {
    let todayPnL = await this.getDailyPnL(userId);
    if (!todayPnL) {
      const tokenData = await this.getUserDerivToken(userId);
      const initialBalance = tokenData?.accountType === 'demo' ? 10000 : 100;
      todayPnL = await this.createOrUpdateDailyPnL(userId, {
        openingBalance: initialBalance, currentBalance: initialBalance, dailyPnL: 0,
        totalTrades: 0, wonTrades: 0, lostTrades: 0, isRecoveryActive: false, recoveryThreshold: 0.75, maxDrawdown: 0, recoveryOperations: 0,
      });
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayPnL = await this.getDailyPnL(userId, yesterday.toISOString().split('T')[0]);
    const previousDayClosingBalance = yesterdayPnL ? yesterdayPnL.currentBalance : todayPnL.openingBalance;

    let minimumRequired = Math.max(previousDayClosingBalance, todayPnL.openingBalance);
    const tokenData = await this.getUserDerivToken(userId);
    if (tokenData?.accountType === 'demo') {
      minimumRequired = Math.max(minimumRequired - todayPnL.openingBalance * 0.05, todayPnL.openingBalance * 0.95);
    }

    const projectedBalance = todayPnL.currentBalance - potentialLoss;
    if (projectedBalance < minimumRequired) {
      return { canExecute: false, reason: 'Saldo projetado ficaria abaixo do mínimo requerido', currentBalance: todayPnL.currentBalance, minimumRequired };
    }
    return { canExecute: true, currentBalance: todayPnL.currentBalance, minimumRequired };
  }

  async getMinimumBalanceRequired(userId: string): Promise<number> {
    const todayPnL = await this.getDailyPnL(userId);
    if (!todayPnL) return 0;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayPnL = await this.getDailyPnL(userId, yesterday.toISOString().split('T')[0]);
    return Math.max(todayPnL.openingBalance, yesterdayPnL?.currentBalance || todayPnL.openingBalance);
  }

  async getBalanceAnalysis(userId: string): Promise<{ currentBalance: number; openingBalance: number; previousDayBalance: number; minimumRequired: number; safetyMargin: number; dailyPnL: number; canTrade: boolean }> {
    const todayPnL = await this.getDailyPnL(userId);
    if (!todayPnL) return { currentBalance: 0, openingBalance: 0, previousDayBalance: 0, minimumRequired: 0, safetyMargin: 0, dailyPnL: 0, canTrade: false };

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayPnL = await this.getDailyPnL(userId, yesterday.toISOString().split('T')[0]);
    const previousDayBalance = yesterdayPnL?.currentBalance || todayPnL.openingBalance;
    const minimumRequired = Math.max(todayPnL.openingBalance, previousDayBalance);
    const safetyMargin = todayPnL.currentBalance - minimumRequired;

    return { currentBalance: todayPnL.currentBalance, openingBalance: todayPnL.openingBalance, previousDayBalance, minimumRequired, safetyMargin, dailyPnL: todayPnL.dailyPnL, canTrade: safetyMargin > 0 };
  }

  async upsertActiveTradingSession(session: InsertActiveTradingSession): Promise<ActiveTradingSession> {
    const db = getDb();
    const existing = await this.getActiveTradingSession(session.sessionKey);

    if (existing) {
      await db.update(activeTradingSessions).set({ ...session, updatedAt: new Date().toISOString() }).where(eq(activeTradingSessions.sessionKey, session.sessionKey));
      return (await this.getActiveTradingSession(session.sessionKey))!;
    } else {
      const [created] = await db.insert(activeTradingSessions).values(session).returning();
      return created;
    }
  }

  async getActiveTradingSession(sessionKey: string): Promise<ActiveTradingSession | undefined> {
    const [session] = await getDb().select().from(activeTradingSessions).where(eq(activeTradingSessions.sessionKey, sessionKey));
    return session;
  }

  async getAllActiveTradingSessions(): Promise<ActiveTradingSession[]> {
    return await getDb().select().from(activeTradingSessions).where(eq(activeTradingSessions.isActive, true));
  }

  async updateActiveTradingSession(sessionKey: string, updates: Partial<ActiveTradingSession>): Promise<void> {
    await getDb().update(activeTradingSessions).set({ ...updates, updatedAt: new Date().toISOString() }).where(eq(activeTradingSessions.sessionKey, sessionKey));
  }

  async deactivateActiveTradingSession(sessionKey: string): Promise<void> {
    await getDb().update(activeTradingSessions).set({ isActive: false, updatedAt: new Date().toISOString() }).where(eq(activeTradingSessions.sessionKey, sessionKey));
  }

  async clearInactiveTradingSessions(): Promise<void> {
    await getDb().delete(activeTradingSessions).where(eq(activeTradingSessions.isActive, false));
  }

  async saveWebSocketSubscription(subscription: InsertActiveWebSocketSubscription): Promise<ActiveWebSocketSubscription> {
    const [created] = await getDb().insert(activeWebSocketSubscriptions).values(subscription).returning();
    return created;
  }

  async getActiveWebSocketSubscriptions(): Promise<ActiveWebSocketSubscription[]> {
    return await getDb().select().from(activeWebSocketSubscriptions).where(eq(activeWebSocketSubscriptions.isActive, true));
  }

  async deactivateWebSocketSubscription(subscriptionId: string): Promise<void> {
    await getDb().update(activeWebSocketSubscriptions).set({ isActive: false, updatedAt: new Date().toISOString() }).where(eq(activeWebSocketSubscriptions.subscriptionId, subscriptionId));
  }

  async clearAllWebSocketSubscriptions(): Promise<void> {
    await getDb().delete(activeWebSocketSubscriptions).where(eq(activeWebSocketSubscriptions.isActive, false));
  }

  async updateSystemHeartbeat(componentName: string, status: string, metadata?: any, lastError?: string): Promise<void> {
    const db = getDb();
    const existing = await this.getSystemHeartbeat(componentName);
    const data = {
      componentName,
      lastHeartbeat: new Date().toISOString(),
      status,
      metadata: metadata ? JSON.stringify(metadata) : null,
      lastError: lastError || null,
      updatedAt: new Date().toISOString(),
    };
    if (existing) {
      await db.update(systemHealthHeartbeat).set(data).where(eq(systemHealthHeartbeat.componentName, componentName));
    } else {
      await db.insert(systemHealthHeartbeat).values({ ...data, errorCount: 0 });
    }
  }

  async getSystemHeartbeat(componentName: string): Promise<SystemHealthHeartbeat | undefined> {
    const [heartbeat] = await getDb().select().from(systemHealthHeartbeat).where(eq(systemHealthHeartbeat.componentName, componentName));
    return heartbeat;
  }

  async getAllSystemHeartbeats(): Promise<SystemHealthHeartbeat[]> {
    return await getDb().select().from(systemHealthHeartbeat);
  }

  async incrementHeartbeatError(componentName: string, error: string): Promise<void> {
    const db = getDb();
    const existing = await this.getSystemHeartbeat(componentName);
    if (existing) {
      await db.update(systemHealthHeartbeat).set({
        errorCount: existing.errorCount + 1, lastError: error, status: 'degraded', updatedAt: new Date().toISOString(),
      }).where(eq(systemHealthHeartbeat.componentName, componentName));
    } else {
      await db.insert(systemHealthHeartbeat).values({ componentName, lastHeartbeat: new Date().toISOString(), status: 'degraded', errorCount: 1, lastError: error });
    }
  }

  async resetHeartbeatErrors(componentName: string): Promise<void> {
    await getDb().update(systemHealthHeartbeat).set({ errorCount: 0, lastError: null, status: 'healthy', updatedAt: new Date().toISOString() }).where(eq(systemHealthHeartbeat.componentName, componentName));
  }

  async getTradingControlStatus(): Promise<TradingControl | undefined> {
    const [control] = await getDb().select().from(tradingControl).limit(1);
    return control;
  }

  async pauseTrading(pausedBy: string, reason: string): Promise<TradingControl> {
    const db = getDb();
    const existing = await this.getTradingControlStatus();
    const now = new Date().toISOString();
    if (existing) {
      const [updated] = await db.update(tradingControl).set({ isPaused: true, pausedBy, pausedAt: now, pauseReason: reason, resumedAt: null, updatedAt: now }).where(eq(tradingControl.id, existing.id)).returning();
      return updated;
    } else {
      const [created] = await db.insert(tradingControl).values({ isPaused: true, pausedBy, pausedAt: now, pauseReason: reason, updatedAt: now }).returning();
      return created;
    }
  }

  async resumeTrading(): Promise<TradingControl> {
    const db = getDb();
    const existing = await this.getTradingControlStatus();
    const now = new Date().toISOString();
    if (existing) {
      const [updated] = await db.update(tradingControl).set({ isPaused: false, resumedAt: now, updatedAt: now }).where(eq(tradingControl.id, existing.id)).returning();
      return updated;
    } else {
      const [created] = await db.insert(tradingControl).values({ isPaused: false, resumedAt: now, updatedAt: now }).returning();
      return created;
    }
  }

  async createAssetBlacklist(blacklist: InsertAssetBlacklist): Promise<AssetBlacklist> {
    const [result] = await getDb().insert(assetBlacklist).values(blacklist).returning();
    return result;
  }

  async getUserAssetBlacklists(userId: string): Promise<AssetBlacklist[]> {
    return await getDb().select().from(assetBlacklist).where(eq(assetBlacklist.userId, userId));
  }

  async deleteAssetBlacklist(id: string): Promise<void> {
    await getDb().delete(assetBlacklist).where(eq(assetBlacklist.id, id));
  }

  async isAssetBlocked(userId: string, assetName: string): Promise<boolean> {
    const blockedAssets = await getDb().select().from(assetBlacklist).where(eq(assetBlacklist.userId, userId));
    return blockedAssets.some(ba => {
      if (ba.patternType === 'exact') return ba.assetPattern === assetName;
      if (ba.patternType === 'contains') return assetName.includes(ba.assetPattern);
      return false;
    });
  }

  async getUserPauseConfig(userId: string): Promise<PauseConfiguration | undefined> {
    const [config] = await getDb().select().from(pauseConfiguration).where(eq(pauseConfiguration.userId, userId));
    return config;
  }

  async createPauseConfig(config: InsertPauseConfiguration): Promise<PauseConfiguration> {
    const [result] = await getDb().insert(pauseConfiguration).values(config).returning();
    return result;
  }

  async updatePauseConfig(userId: string, config: UpdatePauseConfiguration): Promise<PauseConfiguration> {
    const [result] = await getDb().update(pauseConfiguration).set({ ...config, updatedAt: new Date().toISOString() }).where(eq(pauseConfiguration.userId, userId)).returning();
    return result;
  }

  async updatePausedNowStatus(userId: string, isPausedNow: boolean): Promise<void> {
    await getDb().update(pauseConfiguration).set({
      isPausedNow,
      lastPauseStartedAt: isPausedNow ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
    }).where(eq(pauseConfiguration.userId, userId));
  }
}

export const tursoStorage = new TursoStorage();
