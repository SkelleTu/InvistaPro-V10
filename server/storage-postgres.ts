import { pgDb as db, pgSchema, isPostgresAvailable } from "./db-postgres";
import { eq, desc, and } from "drizzle-orm";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto";
import type {
  User,
  InsertUser,
  UpdateUser,
  Movimento,
  InsertMovimento,
  Documento,
  InsertDocumento,
  DerivToken,
  InsertDerivToken,
  TradeConfiguration,
  InsertTradeConfiguration,
  TradeOperation,
  InsertTradeOperation,
  AiLog,
  InsertAiLog,
  MarketData,
  InsertMarketData,
  DailyPnL,
  InsertDailyPnL,
  AiRecoveryStrategy,
  InsertAiRecoveryStrategy,
} from "@shared/schema";
import type { IStorage } from "./storage";

// Encryption utilities (same as SQLite)
class EncryptionService {
  private static getKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY?.trim();
    if (!key) {
      throw new Error('ENCRYPTION_KEY environment variable is required for token encryption.');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error('ENCRYPTION_KEY must be a 64-character hexadecimal string (32 bytes).');
    }
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
    const algorithm = 'aes-256-gcm';
    const key = this.getKey();
    
    const parts = encryptedData.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }
    
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

// Conversor de tipos SQLite para PostgreSQL
function convertSQLiteDataToPostgres(data: any): any {
  if (!data) return data;
  
  const converted = { ...data };
  
  // Converter booleanos (SQLite usa 0/1, PostgreSQL usa true/false)
  for (const key in converted) {
    if (typeof converted[key] === 'number' && (converted[key] === 0 || converted[key] === 1)) {
      // Campos conhecidos como booleanos
      const booleanFields = [
        'telefoneVerificado', 'contaAprovada', 'documentosVerificados', 'isAdmin',
        'usarSenhaFallback', 'biometriaConfigurada', 'rendimentoSaqueAutomatico',
        'biometriaVerificada', 'isActive', 'isRecoveryMode', 'isConservativeForced',
        'isRecoveryActive', 'isSimulated'
      ];
      
      if (booleanFields.includes(key)) {
        converted[key] = Boolean(converted[key]);
      }
    }
  }
  
  return converted;
}

export class PostgresStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(pgSchema.users).where(eq(pgSchema.users.id, id));
    return user as User;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(pgSchema.users).where(eq(pgSchema.users.email, email));
    return user as User;
  }

  async getUserByCpf(cpf: string): Promise<User | undefined> {
    const [user] = await db.select().from(pgSchema.users).where(eq(pgSchema.users.cpf, cpf));
    return user as User;
  }

  async getAllUsers(): Promise<User[]> {
    const users = await db.select().from(pgSchema.users);
    return users as User[];
  }

  async createUser(userData: InsertUser): Promise<User> {
    const pgData = convertSQLiteDataToPostgres(userData);
    const [user] = await db
      .insert(pgSchema.users)
      .values(pgData)
      .returning();
    return user as User;
  }

  async updateUser(id: string, data: UpdateUser): Promise<User> {
    const pgData = convertSQLiteDataToPostgres(data);
    const [user] = await db
      .update(pgSchema.users)
      .set({ ...pgData, updatedAt: new Date() })
      .where(eq(pgSchema.users.id, id))
      .returning();
    return user as User;
  }

  async updateVerificationCode(userId: string, code: string, expiresAt: Date): Promise<void> {
    await db
      .update(pgSchema.users)
      .set({
        codigoVerificacao: code,
        codigoExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(pgSchema.users.id, userId));
  }

  async verifyPhone(userId: string): Promise<User> {
    const [user] = await db
      .update(pgSchema.users)
      .set({
        telefoneVerificado: true,
        codigoVerificacao: null,
        codigoExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(pgSchema.users.id, userId))
      .returning();
    return user as User;
  }

  async approveAccount(userId: string, approvedBy: string): Promise<User> {
    const [user] = await db
      .update(pgSchema.users)
      .set({
        contaAprovada: true,
        aprovadaPor: approvedBy,
        aprovadaEm: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(pgSchema.users.id, userId))
      .returning();
    return user as User;
  }

  // Movement operations
  async createMovimento(movimento: InsertMovimento): Promise<Movimento> {
    const pgData = convertSQLiteDataToPostgres(movimento);
    const [newMovimento] = await db
      .insert(pgSchema.movimentos)
      .values(pgData)
      .returning();
    return newMovimento as Movimento;
  }

  async getUserMovimentos(userId: string, limit = 10): Promise<Movimento[]> {
    const movs = await db
      .select()
      .from(pgSchema.movimentos)
      .where(eq(pgSchema.movimentos.userId, userId))
      .orderBy(desc(pgSchema.movimentos.createdAt))
      .limit(limit);
    return movs as Movimento[];
  }

  async calcularRendimento(saldo: number): Promise<number> {
    const taxaMensal = 0.00835;
    const rendimento = saldo * taxaMensal;
    return Math.round(rendimento * 100) / 100;
  }

  // Document operations
  async createDocumento(documento: InsertDocumento): Promise<Documento> {
    const pgData = convertSQLiteDataToPostgres(documento);
    const [newDocumento] = await db
      .insert(pgSchema.documentos)
      .values(pgData)
      .returning();
    return newDocumento as Documento;
  }

  async getUserDocumentos(userId: string): Promise<Documento[]> {
    const docs = await db
      .select()
      .from(pgSchema.documentos)
      .where(eq(pgSchema.documentos.userId, userId))
      .orderBy(desc(pgSchema.documentos.createdAt));
    return docs as Documento[];
  }

  async updateDocumentoStatus(id: string, status: string, motivoRejeicao?: string): Promise<Documento> {
    const [documento] = await db
      .update(pgSchema.documentos)
      .set({
        status,
        motivoRejeicao,
        updatedAt: new Date(),
      })
      .where(eq(pgSchema.documentos.id, id))
      .returning();
    return documento as Documento;
  }

  // Deriv token operations
  async createDerivToken(tokenData: InsertDerivToken): Promise<DerivToken> {
    await db
      .update(pgSchema.derivTokens)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(pgSchema.derivTokens.userId, tokenData.userId));
    
    const encryptedTokenData = {
      ...convertSQLiteDataToPostgres(tokenData),
      token: EncryptionService.encrypt(tokenData.token),
      isActive: true,
    };
    
    const [newToken] = await db
      .insert(pgSchema.derivTokens)
      .values(encryptedTokenData)
      .returning();
    
    return {
      ...newToken,
      token: EncryptionService.decrypt(newToken.token)
    } as DerivToken;
  }

  async getUserDerivToken(userId: string): Promise<DerivToken | undefined> {
    const [token] = await db
      .select()
      .from(pgSchema.derivTokens)
      .where(and(eq(pgSchema.derivTokens.userId, userId), eq(pgSchema.derivTokens.isActive, true)));
    
    if (!token) return undefined;
    
    return {
      ...token,
      token: EncryptionService.decrypt(token.token)
    } as DerivToken;
  }

  async updateDerivToken(userId: string, token: string, accountType: string): Promise<DerivToken> {
    await db
      .update(pgSchema.derivTokens)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(pgSchema.derivTokens.userId, userId));
    
    const [newToken] = await db
      .insert(pgSchema.derivTokens)
      .values({
        userId,
        token: EncryptionService.encrypt(token),
        accountType,
        isActive: true,
      })
      .returning();
    
    return {
      ...newToken,
      token: EncryptionService.decrypt(newToken.token)
    } as DerivToken;
  }

  async deactivateDerivToken(userId: string): Promise<void> {
    await db
      .update(pgSchema.derivTokens)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(pgSchema.derivTokens.userId, userId));
  }

  // Trade configuration operations
  async createTradeConfig(configData: InsertTradeConfiguration): Promise<TradeConfiguration> {
    const pgData = convertSQLiteDataToPostgres(configData);
    
    await db
      .update(pgSchema.tradeConfigurations)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(pgSchema.tradeConfigurations.userId, configData.userId));
    
    const [config] = await db
      .insert(pgSchema.tradeConfigurations)
      .values({
        ...pgData,
        isActive: true,
      })
      .returning();
    
    return config as TradeConfiguration;
  }

  async getUserTradeConfig(userId: string): Promise<TradeConfiguration | undefined> {
    const [config] = await db
      .select()
      .from(pgSchema.tradeConfigurations)
      .where(and(eq(pgSchema.tradeConfigurations.userId, userId), eq(pgSchema.tradeConfigurations.isActive, true)));
    return config as TradeConfiguration;
  }

  async updateTradeConfig(userId: string, mode: string): Promise<TradeConfiguration> {
    const modeConfigs: Record<string, any> = {
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
    if (!config) {
      throw new Error(`Invalid mode: ${mode}`);
    }
    
    await db
      .update(pgSchema.tradeConfigurations)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(pgSchema.tradeConfigurations.userId, userId));
    
    const [newConfig] = await db
      .insert(pgSchema.tradeConfigurations)
      .values({
        userId,
        mode,
        isActive: true,
        operationsCount: config.operations,
        intervalType: config.interval,
        intervalValue: config.value,
      })
      .returning();
    
    return newConfig as TradeConfiguration;
  }

  async deactivateAllTradeConfigs(userId: string): Promise<void> {
    await db
      .update(pgSchema.tradeConfigurations)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(pgSchema.tradeConfigurations.userId, userId));
  }

  async getActiveTradeConfigurations(): Promise<TradeConfiguration[]> {
    const configs = await db
      .select()
      .from(pgSchema.tradeConfigurations)
      .where(eq(pgSchema.tradeConfigurations.isActive, true))
      .orderBy(desc(pgSchema.tradeConfigurations.createdAt));
    return configs as TradeConfiguration[];
  }

  async deactivateTradeConfiguration(configId: string): Promise<void> {
    await db
      .update(pgSchema.tradeConfigurations)
      .set({
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(pgSchema.tradeConfigurations.id, configId));
  }

  async reactivateTradeConfiguration(configId: string): Promise<void> {
    await db
      .update(pgSchema.tradeConfigurations)
      .set({
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(pgSchema.tradeConfigurations.id, configId));
  }

  async getAllTradeConfigurations(): Promise<TradeConfiguration[]> {
    const configs = await db
      .select()
      .from(pgSchema.tradeConfigurations)
      .orderBy(desc(pgSchema.tradeConfigurations.createdAt));
    return configs as TradeConfiguration[];
  }

  // Trade operations
  async createTradeOperation(operationData: InsertTradeOperation): Promise<TradeOperation> {
    const pgData = convertSQLiteDataToPostgres(operationData);
    const [operation] = await db
      .insert(pgSchema.tradeOperations)
      .values(pgData)
      .returning();
    return operation as TradeOperation;
  }

  async getUserTradeOperations(userId: string, limit = 50): Promise<TradeOperation[]> {
    const ops = await db
      .select()
      .from(pgSchema.tradeOperations)
      .where(eq(pgSchema.tradeOperations.userId, userId))
      .orderBy(desc(pgSchema.tradeOperations.createdAt))
      .limit(limit);
    return ops as TradeOperation[];
  }

  async updateTradeOperation(id: string, updates: Partial<TradeOperation>): Promise<TradeOperation> {
    const [operation] = await db
      .update(pgSchema.tradeOperations)
      .set(updates)
      .where(eq(pgSchema.tradeOperations.id, id))
      .returning();
    return operation as TradeOperation;
  }

  async getActiveTradeOperations(userId: string): Promise<TradeOperation[]> {
    const ops = await db
      .select()
      .from(pgSchema.tradeOperations)
      .where(and(
        eq(pgSchema.tradeOperations.userId, userId),
        eq(pgSchema.tradeOperations.status, 'active')
      ))
      .orderBy(desc(pgSchema.tradeOperations.createdAt));
    return ops as TradeOperation[];
  }

  // AI logs operations
  async createAiLog(logData: InsertAiLog): Promise<AiLog> {
    const pgData = convertSQLiteDataToPostgres(logData);
    const [log] = await db
      .insert(pgSchema.aiLogs)
      .values(pgData)
      .returning();
    return log as AiLog;
  }

  async getUserAiLogs(userId: string, limit = 100): Promise<AiLog[]> {
    const logs = await db
      .select()
      .from(pgSchema.aiLogs)
      .where(eq(pgSchema.aiLogs.userId, userId))
      .orderBy(desc(pgSchema.aiLogs.createdAt))
      .limit(limit);
    return logs as AiLog[];
  }

  async getLatestAiAnalysis(userId: string): Promise<AiLog[]> {
    const logs = await db
      .select()
      .from(pgSchema.aiLogs)
      .where(eq(pgSchema.aiLogs.userId, userId))
      .orderBy(desc(pgSchema.aiLogs.createdAt))
      .limit(10);
    return logs as AiLog[];
  }

  // Market data operations
  async upsertMarketData(dataInput: InsertMarketData): Promise<MarketData> {
    const pgData = convertSQLiteDataToPostgres(dataInput);
    const existing = await this.getMarketData(dataInput.symbol);
    
    if (existing) {
      const [updated] = await db
        .update(pgSchema.marketData)
        .set({
          currentPrice: pgData.currentPrice,
          priceHistory: pgData.priceHistory,
          lastUpdate: new Date(),
        })
        .where(eq(pgSchema.marketData.symbol, dataInput.symbol))
        .returning();
      return updated as MarketData;
    } else {
      const [created] = await db
        .insert(pgSchema.marketData)
        .values(pgData)
        .returning();
      return created as MarketData;
    }
  }

  async getMarketData(symbol: string): Promise<MarketData | undefined> {
    const [data] = await db
      .select()
      .from(pgSchema.marketData)
      .where(eq(pgSchema.marketData.symbol, symbol));
    return data as MarketData;
  }

  async getAllMarketData(): Promise<MarketData[]> {
    const data = await db.select().from(pgSchema.marketData);
    return data as MarketData[];
  }

  // Trading analytics
  async getTradingStats(userId: string): Promise<{
    totalTrades: number;
    wonTrades: number;
    lostTrades: number;
    totalProfit: number;
    winRate: number;
  }> {
    const operations = await this.getUserTradeOperations(userId, 1000);
    const completedOps = operations.filter(op => op.status === 'won' || op.status === 'lost');
    
    const totalTrades = completedOps.length;
    const wonTrades = completedOps.filter(op => op.status === 'won').length;
    const lostTrades = completedOps.filter(op => op.status === 'lost').length;
    const totalProfit = completedOps.reduce((sum, op) => sum + (op.profit || 0), 0);
    const winRate = totalTrades > 0 ? (wonTrades / totalTrades) * 100 : 0;
    
    return { totalTrades, wonTrades, lostTrades, totalProfit, winRate };
  }

  async getActiveTradesCount(userId: string): Promise<number> {
    const active = await this.getActiveTradeOperations(userId);
    return active.length;
  }

  async getDailyLossCount(userId: string, date: string): Promise<number> {
    const ops = await db
      .select()
      .from(pgSchema.tradeOperations)
      .where(and(
        eq(pgSchema.tradeOperations.userId, userId),
        eq(pgSchema.tradeOperations.status, 'lost')
      ));
    
    const dailyLosses = ops.filter(op => {
      if (!op.createdAt) return false;
      const opDate = new Date(op.createdAt).toISOString().split('T')[0];
      return opDate === date;
    });
    
    return dailyLosses.length;
  }

  async saveActiveTradeForTracking(tradeData: any): Promise<void> {
    // Implementar se necessário
  }
}

export const postgresStorage = new PostgresStorage();
