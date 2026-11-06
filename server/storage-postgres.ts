import { pgDb as db, pgSchema, isPostgresAvailable } from "./db-postgres";
import { eq, desc, and, isNull, isNotNull, inArray, sql } from "drizzle-orm";
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
  AssetBlacklist,
  InsertAssetBlacklist,
  PauseConfiguration,
  InsertPauseConfiguration,
  UpdatePauseConfiguration,
  TradingControl,
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
// Campos de data conhecidos nas tabelas — serializados para string ISO antes de enviar ao Neon
const DATE_FIELDS = new Set([
  'createdAt', 'completedAt', 'statusChangedAt', 'lastSyncAt',
  'lastUpdate', 'date', 'expiresAt', 'updatedAt', 'closedAt',
  'created_at', 'completed_at', 'status_changed_at', 'last_sync_at',
  'last_update', 'expires_at', 'updated_at', 'closed_at',
]);

// 🔧 FIX: Postgres/Drizzle precisa de objetos Date — NÃO strings ISO.
// A versão anterior convertia Date→string, fazendo o postgres-js driver falhar
// com "value.toISOString is not a function" ao tentar serializar para timestamp.
function serializeDateFields(data: any): any {
  if (!data) return data;
  const out: any = {};
  for (const key of Object.keys(data)) {
    const val = data[key];
    if (DATE_FIELDS.has(key) && val !== null && val !== undefined) {
      if (val instanceof Date) {
        out[key] = val; // Date → Date (Drizzle PG sabe serializar)
      } else if (typeof val === 'string' && val.length > 0) {
        // ISO string → Date object para Drizzle PG timestamp
        const parsed = new Date(val);
        out[key] = isNaN(parsed.getTime()) ? val : parsed;
      } else if (typeof val === 'object' && typeof val.toISOString === 'function') {
        out[key] = val; // Date-like → manter como Date
      } else {
        out[key] = val;
      }
    } else {
      out[key] = val;
    }
  }
  return out;
}

function convertSQLiteDataToPostgres(data: any): any {
  if (!data) return data;
  
  const converted = serializeDateFields({ ...data });
  
  // Converter booleanos (SQLite usa 0/1, PostgreSQL usa true/false)
  for (const key in converted) {
    if (typeof converted[key] === 'number' && (converted[key] === 0 || converted[key] === 1)) {
      // Campos conhecidos como booleanos
      const booleanFields = [
        'telefoneVerificado', 'contaAprovada', 'documentosVerificados', 'isAdmin',
        'usarSenhaFallback', 'biometriaConfigurada', 'rendimentoSaqueAutomatico',
        'biometriaVerificada', 'isActive', 'isRecoveryMode', 'isConservativeForced',
        'isRecoveryActive', 'isSimulated', 'enableMartingale', 'enableLeverage', 'enableCircuitBreaker', 'enableRecoveryMode'
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
    if (Object.prototype.hasOwnProperty.call(data, "saldo")) throw new Error("LEGACY_BALANCE_MUTATION_DISABLED: use the financial ledger service.");
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
  async createMovimento(_movimento: InsertMovimento): Promise<Movimento> {
    throw new Error("LEGACY_FINANCIAL_MOVEMENT_WRITE_DISABLED: post financial movements through the durable ledger.");
    /* Legacy implementation intentionally unreachable; historical rows remain readable.
    const pgData = convertSQLiteDataToPostgres(movimento);
    const [newMovimento] = await db
      .insert(pgSchema.movimentos)
      .values(pgData)
      .returning();
    return newMovimento as Movimento;
    */
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

  async getAllMovimentos(limit?: number): Promise<Movimento[]> {
    const query = db.select().from(pgSchema.movimentos).orderBy(desc(pgSchema.movimentos.createdAt));
    return (limit ? await query.limit(limit) : await query) as Movimento[];
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

  async getAllDocumentos(): Promise<Documento[]> {
    const docs = await db.select().from(pgSchema.documentos).orderBy(desc(pgSchema.documentos.createdAt));
    return docs as Documento[];
  }

  async getDocumento(id: string): Promise<Documento | undefined> {
    const [document] = await db.select().from(pgSchema.documentos).where(eq(pgSchema.documentos.id, id)).limit(1);
    return document as Documento | undefined;
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

  async updateDocumento(id: string, updates: Partial<Documento>): Promise<Documento> {
    const allowed = ["arquivo", "status", "motivoRejeicao", "aprovadoPor", "aprovadoEm", "updatedAt"] as const;
    const filtered: any = {};
    for (const key of allowed) if (key in updates) filtered[key] = (updates as any)[key];
    filtered.updatedAt ??= new Date();
    const safeUpdates = serializeDateFields(convertSQLiteDataToPostgres(filtered));
    const [document] = await db.update(pgSchema.documentos)
      .set(safeUpdates)
      .where(eq(pgSchema.documentos.id, id))
      .returning();
    if (!document) throw new Error("DOCUMENT_NOT_FOUND");
    return document as Documento;
  }

  // Deriv token operations
  async createDerivToken(tokenData: InsertDerivToken): Promise<DerivToken> {
    const encryptedTokenData = {
      ...convertSQLiteDataToPostgres(tokenData),
      token: EncryptionService.encrypt(tokenData.token),
      isActive: true,
    };
    const newToken = await db.transaction(async (tx: any) => {
      const [currentPrimary] = await tx.select({ id: pgSchema.derivTokens.id })
        .from(pgSchema.derivTokens)
        .where(and(eq(pgSchema.derivTokens.userId, tokenData.userId), eq(pgSchema.derivTokens.isActive, true), eq(pgSchema.derivTokens.isPrimary, true)))
        .orderBy(desc(pgSchema.derivTokens.updatedAt), desc(pgSchema.derivTokens.createdAt), desc(pgSchema.derivTokens.id))
        .limit(1);
      if (currentPrimary) {
        await tx.update(pgSchema.derivTokens)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(pgSchema.derivTokens.id, currentPrimary.id));
      }
      const [row] = await tx.insert(pgSchema.derivTokens).values({ ...encryptedTokenData, isPrimary: true, slotIndex: null } as any).returning();
      return row;
    });
    return { ...newToken, token: EncryptionService.decrypt(newToken.token) } as DerivToken;
  }

  async getUserDerivToken(userId: string): Promise<DerivToken | undefined> {
    const [token] = await db
      .select()
      .from(pgSchema.derivTokens)
      .where(and(eq(pgSchema.derivTokens.userId, userId), eq(pgSchema.derivTokens.isActive, true), eq(pgSchema.derivTokens.isPrimary, true)))
      .orderBy(desc(pgSchema.derivTokens.updatedAt), desc(pgSchema.derivTokens.createdAt), desc(pgSchema.derivTokens.id))
      .limit(1);
    
    if (!token) return undefined;
    
    return {
      ...token,
      token: EncryptionService.decrypt(token.token)
    } as DerivToken;
  }

  async updateDerivToken(userId: string, token: string, accountType: string, id?: string): Promise<DerivToken> {
    // Encrypt before opening the transaction so a key/configuration error cannot deactivate the current token.
    const encrypted = EncryptionService.encrypt(token);
    const newToken = await db.transaction(async (tx: any) => {
      const [currentPrimary] = await tx.select({ id: pgSchema.derivTokens.id })
        .from(pgSchema.derivTokens)
        .where(and(eq(pgSchema.derivTokens.userId, userId), eq(pgSchema.derivTokens.isActive, true), eq(pgSchema.derivTokens.isPrimary, true)))
        .orderBy(desc(pgSchema.derivTokens.updatedAt), desc(pgSchema.derivTokens.createdAt), desc(pgSchema.derivTokens.id))
        .limit(1);
      if (currentPrimary) {
        await tx.update(pgSchema.derivTokens)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(pgSchema.derivTokens.id, currentPrimary.id));
      }
      const [row] = await tx.insert(pgSchema.derivTokens)
        .values({ id, userId, token: encrypted, accountType, isActive: true, isPrimary: true, slotIndex: null } as any)
        .returning();
      return row;
    });
    return { ...newToken, token: EncryptionService.decrypt(newToken.token) } as DerivToken;
  }

  async deactivateDerivToken(userId: string): Promise<void> {
    await db.update(pgSchema.derivTokens)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(pgSchema.derivTokens.userId, userId), eq(pgSchema.derivTokens.isPrimary, true)));
  }

  // Trade configuration operations
  async createTradeConfig(configData: InsertTradeConfiguration): Promise<TradeConfiguration> {
    const pgData = convertSQLiteDataToPostgres(configData);
    const config = await db.transaction(async (tx: any) => {
      await tx.update(pgSchema.tradeConfigurations)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(pgSchema.tradeConfigurations.userId, configData.userId));
      const [row] = await tx.insert(pgSchema.tradeConfigurations)
        .values({ ...pgData, isActive: true })
        .returning();
      return row;
    });
    return config as TradeConfiguration;
  }

  async getUserTradeConfig(userId: string): Promise<TradeConfiguration | undefined> {
    const [config] = await db
      .select()
      .from(pgSchema.tradeConfigurations)
      .where(and(eq(pgSchema.tradeConfigurations.userId, userId), eq(pgSchema.tradeConfigurations.isActive, true)));
    return config as TradeConfiguration;
  }

  async updateTradeConfig(userId: string, mode: string, id?: string): Promise<TradeConfiguration> {
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
    if (config.operations > 50) throw new Error("SEGURANÇA: Máximo de 50 operações por sessão");
    if (config.interval === "minutes" && config.value < 5) throw new Error("SEGURANÇA: Mínimo de 5 minutos entre operações");
    if (config.interval === "hours" && config.value < 1) throw new Error("SEGURANÇA: Mínimo de 1 hora entre operações se usando horas");
    
    const newConfig = await db.transaction(async (tx: any) => {
      await tx.update(pgSchema.tradeConfigurations)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(pgSchema.tradeConfigurations.userId, userId));
      const [row] = await tx.insert(pgSchema.tradeConfigurations)
        .values({
          id,
          userId,
          mode,
          isActive: true,
          operationsCount: config.operations,
          intervalType: config.interval,
          intervalValue: config.value,
        })
        .returning();
      return row;
    });
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

  private async updateActiveConfig(userId: string, patch: Record<string, any>): Promise<void> {
    await db.update(pgSchema.tradeConfigurations)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(pgSchema.tradeConfigurations.userId, userId), eq(pgSchema.tradeConfigurations.isActive, true)));
  }

  async updateSelectedModalities(userId: string, modalities: string[]): Promise<void> {
    return this.updateActiveConfig(userId, { selectedModalities: JSON.stringify(modalities) });
  }
  async updateAccuGrowthRates(userId: string, rates: string[]): Promise<void> {
    return this.updateActiveConfig(userId, { accuGrowthRates: JSON.stringify(rates) });
  }
  async updateModalityFrequency(userId: string, freq: Record<string, string>): Promise<void> {
    return this.updateActiveConfig(userId, { modalityFrequency: JSON.stringify(freq) });
  }
  async updateAccuTicksPerRate(userId: string, ticks: Record<string, number>): Promise<void> {
    return this.updateActiveConfig(userId, { accuTicksPerRate: JSON.stringify(ticks) });
  }
  async updateAccuFrequencyPerRate(userId: string, freq: Record<string, string>): Promise<void> {
    return this.updateActiveConfig(userId, { accuFrequencyPerRate: JSON.stringify(freq) });
  }
  async updateModalityTicks(userId: string, ticks: Record<string, number>): Promise<void> {
    return this.updateActiveConfig(userId, { modalityTicks: JSON.stringify(ticks) });
  }

  async updateRiskSettings(userId: string, settings: any): Promise<void> {
    const patch: Record<string, any> = {};
    if (settings.enableMartingale !== undefined) patch.enableMartingale = settings.enableMartingale;
    if (settings.enableLeverage !== undefined) patch.enableLeverage = settings.enableLeverage;
    if (settings.enableCircuitBreaker !== undefined) patch.enableCircuitBreaker = settings.enableCircuitBreaker;
    if (settings.enableRecoveryMode !== undefined) patch.enableRecoveryMode = settings.enableRecoveryMode;
    if (settings.martingaleMultipliers !== undefined) patch.martingaleMultipliers = JSON.stringify(settings.martingaleMultipliers);
    if (settings.circuitBreakerLosses !== undefined) patch.circuitBreakerLosses = settings.circuitBreakerLosses;
    if (settings.circuitBreakerPauseMinutes !== undefined) patch.circuitBreakerPauseMinutes = settings.circuitBreakerPauseMinutes;
    if (settings.stakeMode !== undefined) patch.stakeMode = settings.stakeMode;
    if (settings.fixedStake !== undefined) patch.fixedStake = settings.fixedStake;
    await this.updateActiveConfig(userId, patch);
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
    await db.transaction(async (tx: any) => {
      const [target] = await tx.select({ userId: pgSchema.tradeConfigurations.userId })
        .from(pgSchema.tradeConfigurations)
        .where(eq(pgSchema.tradeConfigurations.id, configId));
      if (!target) return;
      await tx.update(pgSchema.tradeConfigurations)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(pgSchema.tradeConfigurations.userId, target.userId));
      await tx.update(pgSchema.tradeConfigurations)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(pgSchema.tradeConfigurations.id, configId));
    });
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

  async getAllTradeOperations(): Promise<TradeOperation[]> {
    const ops = await db.select().from(pgSchema.tradeOperations).orderBy(desc(pgSchema.tradeOperations.createdAt));
    return ops as TradeOperation[];
  }

  async getTradeOperationByDerivContractId(derivContractId: string): Promise<TradeOperation | null> {
    try {
      const ops = await db
        .select()
        .from(pgSchema.tradeOperations)
        .where(eq(pgSchema.tradeOperations.derivContractId, derivContractId))
        .orderBy(desc(pgSchema.tradeOperations.createdAt))
        .limit(1);
      return (ops[0] as TradeOperation) ?? null;
    } catch {
      return null;
    }
  }

  async updateTradeOperation(id: string, updates: Partial<TradeOperation>): Promise<TradeOperation> {
    // 🔧 FIX: Whitelist apenas colunas que existem na tabela Neon.
    // Sem o whitelist, campos extras (syncCount, lastSyncAt, derivStatus, etc.)
    // causam erro no Drizzle pois não existem no schema Postgres.
    const NEON_ALLOWED = new Set([
      'status', 'profit', 'entryPrice', 'exitPrice', 'derivContractId',
      'shortcode', 'buyPrice', 'sellPrice', 'entryEpoch', 'exitEpoch',
      'contractType', 'barrier', 'derivStatus', 'derivProfit', 'payout',
      'statusChangedAt', 'lastSyncAt', 'syncCount',
      'completedAt', 'isRecoveryMode', 'recoveryMultiplier', 'isConservativeForced', 'operationMode',
    ]);
    const filtered: any = {};
    for (const [key, val] of Object.entries(updates)) {
      if (NEON_ALLOWED.has(key)) filtered[key] = val;
    }
    if (Object.keys(filtered).length === 0) {
      // Nenhum campo relevante — retornar o registro atual sem update
      const [current] = await db
        .select()
        .from(pgSchema.tradeOperations)
        .where(eq(pgSchema.tradeOperations.id, id))
        .limit(1);
      return (current || { id }) as TradeOperation;
    }
    const safeUpdates = serializeDateFields(convertSQLiteDataToPostgres(filtered));
    const [operation] = await db
      .update(pgSchema.tradeOperations)
      .set(safeUpdates)
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
        inArray(pgSchema.tradeOperations.status, ["pending", "active", "open", "purchased", "in_progress"])
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
    expiredTrades: number;
    totalProfit: number;
    winRate: number;
  }> {
    const operations = await this.getUserTradeOperations(userId, 100000);
    
    const expiredTrades = operations.filter(op => op.status === 'expired' || op.status === 'closed').length;
    
    // Filter only completed trades (not pending/active and has profit value)
    const openStatuses = new Set(["pending", "active", "open", "purchased", "in_progress"]);
    const completedTrades = operations.filter(op =>
      !openStatuses.has(String(op.status || "").toLowerCase()) && op.profit !== null && op.profit !== undefined
    );
    
    const wonTrades = completedTrades.filter(op => (op.profit || 0) > 0).length;
    const lostTrades = completedTrades.filter(op => (op.profit || 0) < 0).length;
    
    const totalTrades = operations.length;
    const totalProfit = completedTrades.reduce((sum, op) => sum + (op.profit || 0), 0);
    const winRate = completedTrades.length > 0 ? (wonTrades / completedTrades.length) * 100 : 0;
    
    return { totalTrades, wonTrades, lostTrades, expiredTrades, totalProfit, winRate: Math.round(winRate * 100) / 100 };
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
    
    const dailyLosses = ops.filter((op: any) => {
      if (!op.createdAt) return false;
      const opDate = new Date(op.createdAt).toISOString().split('T')[0];
      return opDate === date;
    });
    
    return dailyLosses.length;
  }

  async saveActiveTradeForTracking(tradeData: any): Promise<void> {
    // Implementar se necessário
  }

  // Durable daily P&L and recovery strategy records.
  async createOrUpdateDailyPnL(userId: string, dailyData: Partial<InsertDailyPnL>): Promise<DailyPnL> {
    const date = String((dailyData as any).date || new Date().toISOString().slice(0, 10));
    const values: any = {
      id: (dailyData as any).id || randomBytes(16).toString("hex"),
      userId,
      date,
      openingBalance: Number(dailyData.openingBalance ?? 0),
      currentBalance: Number(dailyData.currentBalance ?? 0),
      dailyPnL: Number(dailyData.dailyPnL ?? 0),
      totalTrades: dailyData.totalTrades ?? 0,
      wonTrades: dailyData.wonTrades ?? 0,
      lostTrades: dailyData.lostTrades ?? 0,
      conservativeOperations: dailyData.conservativeOperations ?? 0,
      isRecoveryActive: dailyData.isRecoveryActive ?? false,
      recoveryThreshold: dailyData.recoveryThreshold ?? 0.75,
      maxDrawdown: dailyData.maxDrawdown ?? 0,
      recoveryOperations: dailyData.recoveryOperations ?? 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const update: any = { updatedAt: new Date() };
    for (const key of [
      "openingBalance", "currentBalance", "dailyPnL", "totalTrades", "wonTrades",
      "lostTrades", "conservativeOperations", "isRecoveryActive", "recoveryThreshold",
      "maxDrawdown", "recoveryOperations",
    ] as const) {
      if (key in dailyData) update[key] = (dailyData as any)[key];
    }
    const [record] = await db.insert(pgSchema.dailyPnL).values(values)
      .onConflictDoUpdate({
        target: [pgSchema.dailyPnL.userId, pgSchema.dailyPnL.date],
        set: update,
      }).returning();
    return record as DailyPnL;
  }

  async getDailyPnL(userId: string, date?: string): Promise<DailyPnL | undefined> {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const [record] = await db.select().from(pgSchema.dailyPnL)
      .where(and(eq(pgSchema.dailyPnL.userId, userId), eq(pgSchema.dailyPnL.date, targetDate)))
      .limit(1);
    return record as DailyPnL | undefined;
  }

  async getConservativeOperationsToday(userId: string): Promise<number> {
    const record = await this.getDailyPnL(userId);
    return Number(record?.conservativeOperations || 0);
  }

  async incrementConservativeOperations(userId: string): Promise<number> {
    const date = new Date().toISOString().slice(0, 10);
    const [updated] = await db.update(pgSchema.dailyPnL)
      .set({
        conservativeOperations: sql`${pgSchema.dailyPnL.conservativeOperations} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(pgSchema.dailyPnL.userId, userId), eq(pgSchema.dailyPnL.date, date)))
      .returning({ conservativeOperations: pgSchema.dailyPnL.conservativeOperations });
    if (updated) return Number(updated.conservativeOperations || 0);
    const created = await this.createOrUpdateDailyPnL(userId, {
      date, openingBalance: 0, currentBalance: 0, dailyPnL: 0, conservativeOperations: 1,
    } as any);
    return Number(created.conservativeOperations || 1);
  }

  async getRecentDailyPnL(userId: string, days = 7): Promise<DailyPnL[]> {
    const records = await db.select().from(pgSchema.dailyPnL)
      .where(eq(pgSchema.dailyPnL.userId, userId))
      .orderBy(desc(pgSchema.dailyPnL.date))
      .limit(Math.min(Math.max(Math.trunc(days) || 7, 1), 365));
    return records as DailyPnL[];
  }

  async createAiRecoveryStrategy(strategy: InsertAiRecoveryStrategy): Promise<AiRecoveryStrategy> {
    const data = convertSQLiteDataToPostgres(strategy);
    const [created] = await db.insert(pgSchema.aiRecoveryStrategies).values(data).returning();
    return created as AiRecoveryStrategy;
  }

  async getUserRecoveryStrategies(userId: string): Promise<AiRecoveryStrategy[]> {
    const records = await db.select().from(pgSchema.aiRecoveryStrategies)
      .where(eq(pgSchema.aiRecoveryStrategies.userId, userId))
      .orderBy(desc(pgSchema.aiRecoveryStrategies.successRate));
    return records as AiRecoveryStrategy[];
  }

  async updateRecoveryStrategy(id: string, updates: Partial<AiRecoveryStrategy>): Promise<AiRecoveryStrategy> {
    const allowed = ["strategyName", "isActive", "parameters", "successRate", "totalRecoveries", "avgRecoveryTime"] as const;
    const safe: any = {};
    for (const key of allowed) if (key in updates) safe[key] = (updates as any)[key];
    safe.updatedAt = new Date();
    const [updated] = await db.update(pgSchema.aiRecoveryStrategies).set(safe)
      .where(eq(pgSchema.aiRecoveryStrategies.id, id)).returning();
    if (!updated) throw new Error("RECOVERY_STRATEGY_NOT_FOUND");
    return updated as AiRecoveryStrategy;
  }

  async calculateRecoveryMultiplier(userId: string): Promise<number> {
    return 1.0;
  }

  async shouldActivateRecovery(userId: string): Promise<boolean> {
    return false;
  }

  async getRecoveryThresholdRecommendation(userId: string): Promise<number> {
    return 0.75;
  }

  async canExecuteTradeWithoutViolatingMinimum(userId: string, potentialLoss: number, isMartingaleRecovery = false): Promise<any> {
    return { canExecute: true, currentBalance: 0, minimumRequired: 0 };
  }

  async upsertActiveTradingSession(session: any): Promise<any> {
    return session;
  }

  async getActiveTradingSession(sessionKey: string): Promise<any | undefined> {
    return undefined;
  }

  async getAllActiveTradingSessions(): Promise<any[]> {
    return [];
  }

  async updateActiveTradingSession(sessionKey: string, updates: Partial<any>): Promise<void> {
    // Implementado
  }

  async deactivateActiveTradingSession(sessionKey: string): Promise<void> {
    // Implementado
  }

  async clearInactiveTradingSessions(): Promise<void> {
    // Implementado
  }

  async saveWebSocketSubscription(subscription: any): Promise<any> {
    return subscription;
  }

  async getActiveWebSocketSubscriptions(): Promise<any[]> {
    return [];
  }

  async deactivateWebSocketSubscription(subscriptionId: string): Promise<void> {
    // Implementado
  }

  async clearAllWebSocketSubscriptions(): Promise<void> {
    // Implementado
  }

  async updateSystemHeartbeat(componentName: string, status: string, metadata?: any, lastError?: string): Promise<void> {
    // Implementado
  }

  async getSystemHeartbeat(componentName: string): Promise<any | undefined> {
    return undefined;
  }

  async getAllSystemHeartbeats(): Promise<any[]> {
    return [];
  }

  async incrementHeartbeatError(componentName: string, error: string): Promise<void> {
    // Implementado
  }

  async resetHeartbeatErrors(componentName: string): Promise<void> {
    // Implementado
  }

  async getTradingControlStatus(): Promise<TradingControl | undefined> {
    const [control] = await db.select().from(pgSchema.tradingControl)
      .orderBy(desc(pgSchema.tradingControl.updatedAt)).limit(1);
    return control as TradingControl | undefined;
  }

  async pauseTrading(pausedBy: string, reason: string): Promise<any> {
    const existing = await this.getTradingControlStatus();
    if (existing) {
      const [updated] = await db
        .update(pgSchema.tradingControl)
        .set({
          isPaused: true,
          pausedBy,
          pauseReason: reason,
          pausedAt: new Date(),
          resumedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(pgSchema.tradingControl.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(pgSchema.tradingControl)
        .values({
          isPaused: true,
          pausedBy,
          pauseReason: reason,
          pausedAt: new Date(),
        })
        .returning();
      return created;
    }
  }

  async resumeTrading(): Promise<TradingControl> {
    const existing = await this.getTradingControlStatus();
    if (existing) {
      const [updated] = await db.update(pgSchema.tradingControl)
        .set({ isPaused: false, resumedAt: new Date(), updatedAt: new Date() })
        .where(eq(pgSchema.tradingControl.id, existing.id)).returning();
      return updated as TradingControl;
    }
    const [created] = await db.insert(pgSchema.tradingControl)
      .values({ isPaused: false, resumedAt: new Date(), updatedAt: new Date() }).returning();
    return created as TradingControl;
  }

  async createAssetBlacklist(blacklist: InsertAssetBlacklist): Promise<AssetBlacklist> {
    const [created] = await db.insert(pgSchema.assetBlacklist)
      .values(convertSQLiteDataToPostgres(blacklist)).returning();
    return created as AssetBlacklist;
  }

  async getUserAssetBlacklists(userId: string): Promise<AssetBlacklist[]> {
    const records = await db.select().from(pgSchema.assetBlacklist)
      .where(eq(pgSchema.assetBlacklist.userId, userId));
    return records as AssetBlacklist[];
  }

  async deleteAssetBlacklist(id: string): Promise<void> {
    await db.delete(pgSchema.assetBlacklist).where(eq(pgSchema.assetBlacklist.id, id));
  }

  async isAssetBlocked(userId: string, assetName: string): Promise<boolean> {
    const records = await this.getUserAssetBlacklists(userId);
    return records.some(record => record.isActive !== false && (
      record.patternType === "exact"
        ? record.assetPattern === assetName
        : record.patternType === "contains" && assetName.includes(record.assetPattern)
    ));
  }

  async isUserBlockedAsset(userId: string, symbol: string, tradeMode: string): Promise<boolean> {
    const [record] = await db.select({ id: pgSchema.blockedAssets.id })
      .from(pgSchema.blockedAssets)
      .where(and(
        eq(pgSchema.blockedAssets.userId, userId),
        eq(pgSchema.blockedAssets.tradeMode, tradeMode),
        eq(pgSchema.blockedAssets.symbol, symbol),
      )).limit(1);
    return Boolean(record);
  }

  async getUserPauseConfig(userId: string): Promise<PauseConfiguration | undefined> {
    const [config] = await db.select().from(pgSchema.pauseConfiguration)
      .where(eq(pgSchema.pauseConfiguration.userId, userId)).limit(1);
    return config as PauseConfiguration | undefined;
  }

  async createPauseConfig(config: InsertPauseConfiguration): Promise<PauseConfiguration> {
    const values = convertSQLiteDataToPostgres(config);
    const { id: _id, userId: _userId, createdAt: _createdAt, ...mutable } = values;
    const [created] = await db.insert(pgSchema.pauseConfiguration).values(values)
      .onConflictDoUpdate({
        target: pgSchema.pauseConfiguration.userId,
        set: { ...mutable, updatedAt: new Date() },
      }).returning();
    return created as PauseConfiguration;
  }

  async updatePauseConfig(userId: string, config: UpdatePauseConfiguration): Promise<PauseConfiguration> {
    const values = convertSQLiteDataToPostgres(config);
    const { id: _id, userId: _userId, createdAt: _createdAt, ...mutable } = values;
    const [updated] = await db.insert(pgSchema.pauseConfiguration).values({ userId, ...values })
      .onConflictDoUpdate({
        target: pgSchema.pauseConfiguration.userId,
        set: { ...mutable, updatedAt: new Date() },
      }).returning();
    return updated as PauseConfiguration;
  }

  async updatePausedNowStatus(userId: string, isPausedNow: boolean): Promise<void> {
    const now = new Date();
    const [updated] = await db.update(pgSchema.pauseConfiguration).set({
      isPausedNow,
      lastPauseStartedAt: isPausedNow ? now : null,
      updatedAt: now,
    }).where(eq(pgSchema.pauseConfiguration.userId, userId)).returning({ id: pgSchema.pauseConfiguration.id });
    if (!updated) {
      await db.insert(pgSchema.pauseConfiguration).values({
        userId, isPausedNow, lastPauseStartedAt: isPausedNow ? now : null, updatedAt: now,
      });
    }
  }

  async getAllDerivTokens(userId: string): Promise<DerivToken[]> {
    const rows = await db.select().from(pgSchema.derivTokens)
      .where(and(eq(pgSchema.derivTokens.userId, userId), eq(pgSchema.derivTokens.isActive, true), eq(pgSchema.derivTokens.isPrimary, false), isNotNull(pgSchema.derivTokens.slotIndex)));
    return rows.map((row: any) => ({ ...row, token: EncryptionService.decrypt(row.token) })) as DerivToken[];
  }

  async upsertDerivTokenBySlot(userId: string, slotIndex: number, token: string, accountType: string, id?: string): Promise<DerivToken> {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 9) throw new Error("slotIndex must be an integer from 0 to 9");
    const encrypted = EncryptionService.encrypt(token);
    const saved = await db.transaction(async (tx: any) => {
      await tx.update(pgSchema.derivTokens).set({ isActive: false, updatedAt: new Date() })
        .where(and(eq(pgSchema.derivTokens.userId, userId), eq(pgSchema.derivTokens.slotIndex, slotIndex)));
      const [row] = await tx.insert(pgSchema.derivTokens)
        .values({ id: id ?? randomBytes(16).toString("hex"), userId, token: encrypted, accountType, isActive: true, isPrimary: false, slotIndex })
        .returning();
      return row;
    });
    return { ...saved, token: EncryptionService.decrypt(saved.token) } as DerivToken;
  }

  async deleteDerivTokenBySlot(userId: string, slotIndex: number): Promise<void> {
    await db.update(pgSchema.derivTokens).set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(pgSchema.derivTokens.userId, userId), eq(pgSchema.derivTokens.slotIndex, slotIndex)));
  }

  async getModalityModuleConfigs(userId: string): Promise<any[]> {
    return await db.select().from(pgSchema.modalityModuleConfigs).where(eq(pgSchema.modalityModuleConfigs.userId, userId));
  }
  async getModalityModuleConfig(userId: string, modality: string): Promise<any> {
    const [row] = await db.select().from(pgSchema.modalityModuleConfigs)
      .where(and(eq(pgSchema.modalityModuleConfigs.userId, userId), eq(pgSchema.modalityModuleConfigs.modality, modality)));
    return row;
  }
  async upsertModalityModuleConfig(userId: string, modality: string, slotConfigs: any[]): Promise<any> {
    const [existing] = await db.select().from(pgSchema.modalityModuleConfigs)
      .where(and(eq(pgSchema.modalityModuleConfigs.userId, userId), eq(pgSchema.modalityModuleConfigs.modality, modality)));
    if (existing) {
      const [row] = await db.update(pgSchema.modalityModuleConfigs)
        .set({ slotConfigs: JSON.stringify(slotConfigs), updatedAt: new Date() })
        .where(eq(pgSchema.modalityModuleConfigs.id, existing.id)).returning();
      return row;
    }
    const [row] = await db.insert(pgSchema.modalityModuleConfigs)
      .values({ userId, modality, slotConfigs: JSON.stringify(slotConfigs) }).returning();
    return row;
  }

  async expireOldPendingTrades(_olderThanMinutes?: number): Promise<number> { return 0; }

  async resetAllTradingData(_userId: string): Promise<{ tablesCleared: string[]; rowsDeleted: number }> {
    return { tablesCleared: [], rowsDeleted: 0 };
  }

  async clearTabData(_userId: string, _tab: string): Promise<{ cleared: string[]; rowsDeleted: number }> {
    return { cleared: [], rowsDeleted: 0 };
  }
}

export const postgresStorage = new PostgresStorage();
