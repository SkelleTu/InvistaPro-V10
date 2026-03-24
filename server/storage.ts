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
  blockedAssets,
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
import { db } from "./db";
import { eq, desc, and, isNotNull, sql, lt } from "drizzle-orm";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto";

// Encryption utilities for sensitive data
class EncryptionService {
  private static getKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY?.trim();
    if (!key) {
      throw new Error('ENCRYPTION_KEY environment variable is required for token encryption. Please configure a 64-character hexadecimal key.');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(key)) {
      throw new Error('ENCRYPTION_KEY must be a 64-character hexadecimal string (32 bytes).');
    }
    return Buffer.from(key, 'hex');
  }

  static encrypt(text: string): string {
    try {
      const algorithm = 'aes-256-gcm';
      const key = this.getKey();
      const iv = randomBytes(16);
      const cipher = createCipheriv(algorithm, key, iv);
      
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag();
      
      // Combine iv, authTag, and encrypted data
      return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
    } catch (error: any) {
      throw new Error('Failed to encrypt data: ' + (error?.message || 'Unknown error'));
    }
  }

  static decrypt(encryptedData: string): string {
    try {
      const algorithm = 'aes-256-gcm';
      const key = this.getKey();
      
      // Handle plain text tokens (for backward compatibility)
      if (!encryptedData.includes(':')) {
        console.warn('⚠️ Token appears to be in plain text format, returning as-is');
        return encryptedData;
      }
      
      const parts = encryptedData.split(':');
      if (parts.length !== 3) {
        throw new Error(`Invalid encrypted data format: expected 3 parts separated by ':', got ${parts.length}`);
      }
      
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];
      
      const decipher = createDecipheriv(algorithm, key, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error: any) {
      console.error('❌ Decryption error details:', {
        message: error?.message,
        dataLength: encryptedData?.length,
        dataPreview: encryptedData?.substring(0, 50) + '...'
      });
      throw new Error('Failed to decrypt data: ' + (error?.message || 'Unknown error'));
    }
  }
}

// Interface for storage operations
export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByCpf(cpf: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;

  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: UpdateUser): Promise<User>;
  
  // Verification operations
  updateVerificationCode(userId: string, code: string, expiresAt: Date): Promise<void>;
  verifyPhone(userId: string): Promise<User>;
  approveAccount(userId: string, approvedBy: string): Promise<User>;
  
  // Movement operations
  createMovimento(movimento: InsertMovimento): Promise<Movimento>;
  getUserMovimentos(userId: string, limit?: number): Promise<Movimento[]>;
  
  // Financial calculations
  calcularRendimento(saldo: number): Promise<number>;
  
  // Document operations
  createDocumento(documento: InsertDocumento): Promise<Documento>;
  getUserDocumentos(userId: string): Promise<Documento[]>;
  updateDocumentoStatus(id: string, status: string, motivoRejeicao?: string): Promise<Documento>;

  // TRADING SYSTEM OPERATIONS
  
  // Deriv token operations
  createDerivToken(token: InsertDerivToken): Promise<DerivToken>;
  getUserDerivToken(userId: string): Promise<DerivToken | undefined>;
  updateDerivToken(userId: string, token: string, accountType: string): Promise<DerivToken>;
  deactivateDerivToken(userId: string): Promise<void>;
  
  // Trade configuration operations
  createTradeConfig(config: InsertTradeConfiguration): Promise<TradeConfiguration>;
  getUserTradeConfig(userId: string): Promise<TradeConfiguration | undefined>;
  getAllTradeConfigurations(): Promise<TradeConfiguration[]>;
  getActiveTradeConfigurations(): Promise<TradeConfiguration[]>;
  updateTradeConfig(userId: string, mode: string): Promise<TradeConfiguration>;
  updateSelectedModalities(userId: string, modalities: string[]): Promise<void>;
  updateAccuGrowthRates(userId: string, rates: string[]): Promise<void>;
  updateModalityFrequency(userId: string, freq: Record<string, string>): Promise<void>;
  updateAccuTicksPerRate(userId: string, ticks: Record<string, number>): Promise<void>;
  updateAccuFrequencyPerRate(userId: string, freq: Record<string, string>): Promise<void>;
  updateModalityTicks(userId: string, ticks: Record<string, number>): Promise<void>;
  updateRiskSettings(userId: string, settings: {
    enableMartingale?: boolean;
    enableLeverage?: boolean;
    enableCircuitBreaker?: boolean;
    enableRecoveryMode?: boolean;
    martingaleMultipliers?: number[];
    circuitBreakerLosses?: number;
    circuitBreakerPauseMinutes?: number;
    stakeMode?: string;
    fixedStake?: number;
  }): Promise<void>;
  deactivateAllTradeConfigs(userId: string): Promise<void>;
  reactivateTradeConfiguration(id: string): Promise<void>;
  deactivateTradeConfiguration(id: string): Promise<void>;
  
  // Trade operations
  createTradeOperation(operation: InsertTradeOperation): Promise<TradeOperation>;
  getUserTradeOperations(userId: string, limit?: number): Promise<TradeOperation[]>;
  updateTradeOperation(id: string, updates: Partial<TradeOperation>): Promise<TradeOperation>;
  getTradeOperationByDerivContractId(derivContractId: string): Promise<TradeOperation | null>;
  getActiveTradeOperations(userId: string): Promise<TradeOperation[]>;
  
  // AI logs operations
  createAiLog(log: InsertAiLog): Promise<AiLog>;
  getUserAiLogs(userId: string, limit?: number): Promise<AiLog[]>;
  getLatestAiAnalysis(userId: string): Promise<AiLog[]>;
  
  // Market data operations
  upsertMarketData(data: InsertMarketData): Promise<MarketData>;
  getMarketData(symbol: string): Promise<MarketData | undefined>;
  getAllMarketData(): Promise<MarketData[]>;
  
  // Trading analytics
  getTradingStats(userId: string): Promise<{
    totalTrades: number;
    wonTrades: number;
    lostTrades: number;
    expiredTrades: number;
    totalProfit: number;
    winRate: number;
  }>;
  
  // Additional trading analytics for FNACIA system
  getActiveTradesCount(userId: string): Promise<number>;
  getDailyLossCount(userId: string, date: string): Promise<number>;
  saveActiveTradeForTracking(tradeData: any): Promise<void>;

  // RESILIENCE SYSTEM OPERATIONS
  
  // Active trading sessions
  upsertActiveTradingSession(session: InsertActiveTradingSession): Promise<ActiveTradingSession>;
  getActiveTradingSession(sessionKey: string): Promise<ActiveTradingSession | undefined>;
  getAllActiveTradingSessions(): Promise<ActiveTradingSession[]>;
  updateActiveTradingSession(sessionKey: string, updates: Partial<ActiveTradingSession>): Promise<void>;
  deactivateActiveTradingSession(sessionKey: string): Promise<void>;
  clearInactiveTradingSessions(): Promise<void>;
  
  // WebSocket subscriptions
  saveWebSocketSubscription(subscription: InsertActiveWebSocketSubscription): Promise<ActiveWebSocketSubscription>;
  getActiveWebSocketSubscriptions(): Promise<ActiveWebSocketSubscription[]>;
  deactivateWebSocketSubscription(subscriptionId: string): Promise<void>;
  clearAllWebSocketSubscriptions(): Promise<void>;
  
  // System health heartbeat
  updateSystemHeartbeat(componentName: string, status: string, metadata?: any, lastError?: string): Promise<void>;
  getSystemHeartbeat(componentName: string): Promise<SystemHealthHeartbeat | undefined>;
  getAllSystemHeartbeats(): Promise<SystemHealthHeartbeat[]>;
  incrementHeartbeatError(componentName: string, error: string): Promise<void>;
  resetHeartbeatErrors(componentName: string): Promise<void>;

  // Trading control (pause/resume - centralizado)
  getTradingControlStatus(): Promise<TradingControl | undefined>;
  pauseTrading(pausedBy: string, reason: string): Promise<TradingControl>;
  resumeTrading(): Promise<TradingControl>;

  // Asset Blacklist operations
  createAssetBlacklist(blacklist: InsertAssetBlacklist): Promise<AssetBlacklist>;
  getUserAssetBlacklists(userId: string): Promise<AssetBlacklist[]>;
  deleteAssetBlacklist(id: string): Promise<void>;
  isAssetBlocked(userId: string, assetName: string): Promise<boolean>;
  isUserBlockedAsset(userId: string, symbol: string, tradeMode: string): Promise<boolean>;

  // Pause Configuration operations
  getUserPauseConfig(userId: string): Promise<PauseConfiguration | undefined>;
  createPauseConfig(config: InsertPauseConfiguration): Promise<PauseConfiguration>;
  updatePauseConfig(userId: string, config: UpdatePauseConfiguration): Promise<PauseConfiguration>;
  updatePausedNowStatus(userId: string, isPausedNow: boolean): Promise<void>;

  // Cleanup: expirar automaticamente trades pendentes irrecuperáveis
  expireOldPendingTrades(olderThanMinutes?: number): Promise<number>;

  // Reset total de dados operacionais (mantém usuário, token e configurações)
  resetAllTradingData(userId: string): Promise<{ tablesCleared: string[]; rowsDeleted: number }>;
}

export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByCpf(cpf: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.cpf, cpf));
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return await db.select().from(users);
  }



  async createUser(userData: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(userData)
      .returning();
    
    return user;
  }

  async updateUser(id: string, data: UpdateUser): Promise<User> {
    const [user] = await db
      .update(users)
      .set({ ...data, updatedAt: new Date().toISOString() })
      .where(eq(users.id, id))
      .returning();
    
    return user;
  }

  // Verification operations
  async updateVerificationCode(userId: string, code: string, expiresAt: Date): Promise<void> {
    await db
      .update(users)
      .set({
        codigoVerificacao: code,
        codigoExpiresAt: expiresAt.toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, userId));
  }

  async verifyPhone(userId: string): Promise<User> {
    const [user] = await db
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
    const [user] = await db
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

  // Movement operations
  async createMovimento(movimento: InsertMovimento): Promise<Movimento> {
    const [newMovimento] = await db
      .insert(movimentos)
      .values(movimento)
      .returning();
    
    return newMovimento;
  }

  async getUserMovimentos(userId: string, limit = 10): Promise<Movimento[]> {
    return await db
      .select()
      .from(movimentos)
      .where(eq(movimentos.userId, userId))
      .orderBy(desc(movimentos.createdAt))
      .limit(limit);
  }

  // Financial calculations
  async calcularRendimento(saldo: number): Promise<number> {
    const taxaMensal = 0.00835; // 0.835% mensal = 10.63% anual composto exato
    const rendimento = saldo * taxaMensal;
    return Math.round(rendimento * 100) / 100; // Round to 2 decimal places
  }

  // Document operations
  async createDocumento(documento: InsertDocumento): Promise<Documento> {
    const [newDocumento] = await db
      .insert(documentos)
      .values(documento)
      .returning();
    return newDocumento;
  }

  async getUserDocumentos(userId: string): Promise<Documento[]> {
    return await db
      .select()
      .from(documentos)
      .where(eq(documentos.userId, userId))
      .orderBy(desc(documentos.createdAt));
  }

  async updateDocumentoStatus(id: string, status: string, motivoRejeicao?: string): Promise<Documento> {
    const [documento] = await db
      .update(documentos)
      .set({
        status,
        motivoRejeicao,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(documentos.id, id))
      .returning();
    return documento;
  }

  // TRADING SYSTEM IMPLEMENTATIONS
  
  // Deriv token operations
  async createDerivToken(tokenData: InsertDerivToken): Promise<DerivToken> {
    // Atomic operation: deactivate existing and create new in transaction
    return db.transaction((tx) => {
      // Deactivate existing active tokens first to maintain single-active invariant
      tx
        .update(derivTokens)
        .set({
          isActive: false,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(derivTokens.userId, tokenData.userId))
        .run();
      
      // Encrypt the token before storing
      const encryptedTokenData = {
        ...tokenData,
        token: EncryptionService.encrypt(tokenData.token),
        isActive: true,
      };
      
      const newToken = tx
        .insert(derivTokens)
        .values(encryptedTokenData)
        .returning()
        .get();
      
      // Decrypt token for return value
      return {
        ...newToken,
        token: EncryptionService.decrypt(newToken.token)
      };
    });
  }

  async getUserDerivToken(userId: string): Promise<DerivToken | undefined> {
    const [token] = await db
      .select()
      .from(derivTokens)
      .where(and(eq(derivTokens.userId, userId), eq(derivTokens.isActive, true)));
    
    if (!token) return undefined;
    
    // Decrypt token before returning
    return {
      ...token,
      token: EncryptionService.decrypt(token.token)
    };
  }

  async updateDerivToken(userId: string, token: string, accountType: string): Promise<DerivToken> {
    // CORREÇÃO: Remover async da função de transação - better-sqlite3 não suporta async em transactions
    return db.transaction((tx) => {
      // Deactivate all existing tokens first (método síncrono)
      tx
        .update(derivTokens)
        .set({
          isActive: false,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(derivTokens.userId, userId))
        .run();
      
      // Create new active token with encryption (método síncrono)
      const [newToken] = tx
        .insert(derivTokens)
        .values({
          userId,
          token: EncryptionService.encrypt(token),
          accountType,
          isActive: true,
        })
        .returning()
        .all();
      
      // Decrypt token for return value
      return {
        ...newToken,
        token: EncryptionService.decrypt(newToken.token)
      };
    });
  }

  async deactivateDerivToken(userId: string): Promise<void> {
    await db
      .update(derivTokens)
      .set({
        isActive: false,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(derivTokens.userId, userId));
  }
  
  // Trade configuration operations
  async createTradeConfig(configData: InsertTradeConfiguration): Promise<TradeConfiguration> {
    // Use atomic transaction to ensure single active config per user
    return db.transaction((tx) => {
      // Deactivate existing active configs first to maintain single-active invariant
      tx
        .update(tradeConfigurations)
        .set({
          isActive: false,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tradeConfigurations.userId, configData.userId))
        .run();
      
      const config = tx
        .insert(tradeConfigurations)
        .values({
          ...configData,
          isActive: true, // Explicitly ensure config is created as active
        })
        .returning()
        .get();
      return config;
    });
  }

  async getUserTradeConfig(userId: string): Promise<TradeConfiguration | undefined> {
    const [config] = await db
      .select()
      .from(tradeConfigurations)
      .where(and(eq(tradeConfigurations.userId, userId), eq(tradeConfigurations.isActive, true)));
    return config;
  }

  async updateTradeConfig(userId: string, mode: string): Promise<TradeConfiguration> {
    // Validate inputs first
    if (!userId?.trim()) {
      throw new Error('Invalid userId: cannot be empty');
    }
    if (!mode?.trim()) {
      throw new Error('Invalid mode: cannot be empty');
    }
    
    // SEGURANÇA: Configurações com limites de segurança obrigatórios
    const modeConfigs = {
      'production_3-4_24h': { operations: 4, interval: 'hours', value: 6 }, // 4 ops in 24h = every 6h
      'production_2_24h': { operations: 2, interval: 'hours', value: 12 }, // 2 ops in 24h = every 12h
      'test_4_1min': { operations: 4, interval: 'minutes', value: 1 },
      'test_3_2min': { operations: 3, interval: 'minutes', value: 2 },
      'test_4_1hour': { operations: 4, interval: 'hours', value: 1 },
      'test_3_2hour': { operations: 3, interval: 'hours', value: 2 },
      'test_limitado_seguro': { operations: 5, interval: 'minutes', value: 30 }, // MÁXIMO SEGURO: 5 ops a cada 30min
      'test_sem_limites': { operations: 50, interval: 'minutes', value: 5 }, // MODO SEM LIMITES: Máximo permitido com intervalo mínimo de segurança
    };
    
    const config = modeConfigs[mode as keyof typeof modeConfigs];
    if (!config) {
      throw new Error(`Invalid mode: ${mode}. Allowed modes: ${Object.keys(modeConfigs).join(', ')}`);
    }
    
    // SEGURANÇA: Limites máximos obrigatórios
    if (config.operations > 50) {
      throw new Error('SEGURANÇA: Máximo de 50 operações por sessão');
    }
    
    // SEGURANÇA: Validação rigorosa de intervalos - MÍNIMO 5 MINUTOS
    if (config.interval === 'seconds' && config.value < 300) {
      throw new Error('SEGURANÇA: Mínimo de 5 minutos (300 segundos) entre operações');
    }
    if (config.interval === 'minutes' && config.value < 5) {
      throw new Error('SEGURANÇA: Mínimo de 5 minutos entre operações');
    }
    if (config.interval === 'hours' && config.value < 1) {
      throw new Error('SEGURANÇA: Mínimo de 1 hora entre operações se usando horas');
    }
    
    // Atomic operation: deactivate existing and create new in transaction
    return db.transaction((tx) => {
      // Deactivate all existing configs for this user
      tx
        .update(tradeConfigurations)
        .set({
          isActive: false,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(tradeConfigurations.userId, userId))
        .run();
      
      // Create new active config
      const newConfig = tx
        .insert(tradeConfigurations)
        .values({
          userId,
          mode,
          isActive: true,
          operationsCount: config.operations,
          intervalType: config.interval,
          intervalValue: config.value,
        })
        .returning()
        .get();
      
      return newConfig;
    });
  }

  async updateSelectedModalities(userId: string, modalities: string[]): Promise<void> {
    const modalitiesJson = JSON.stringify(modalities);
    await db
      .update(tradeConfigurations)
      .set({
        selectedModalities: modalitiesJson,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(tradeConfigurations.userId, userId), eq(tradeConfigurations.isActive, true)));
  }

  async updateAccuGrowthRates(userId: string, rates: string[]): Promise<void> {
    await db
      .update(tradeConfigurations)
      .set({
        accuGrowthRates: JSON.stringify(rates),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(tradeConfigurations.userId, userId), eq(tradeConfigurations.isActive, true)));
  }

  async updateModalityFrequency(userId: string, freq: Record<string, string>): Promise<void> {
    await db
      .update(tradeConfigurations)
      .set({
        modalityFrequency: JSON.stringify(freq),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(tradeConfigurations.userId, userId), eq(tradeConfigurations.isActive, true)));
  }

  async updateAccuTicksPerRate(userId: string, ticks: Record<string, number>): Promise<void> {
    await db
      .update(tradeConfigurations)
      .set({
        accuTicksPerRate: JSON.stringify(ticks),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(tradeConfigurations.userId, userId), eq(tradeConfigurations.isActive, true)));
  }

  async updateAccuFrequencyPerRate(userId: string, freq: Record<string, string>): Promise<void> {
    await db
      .update(tradeConfigurations)
      .set({
        accuFrequencyPerRate: JSON.stringify(freq),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(tradeConfigurations.userId, userId), eq(tradeConfigurations.isActive, true)));
  }

  async updateModalityTicks(userId: string, ticks: Record<string, number>): Promise<void> {
    await db
      .update(tradeConfigurations)
      .set({
        modalityTicks: JSON.stringify(ticks),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(tradeConfigurations.userId, userId), eq(tradeConfigurations.isActive, true)));
  }

  async updateRiskSettings(userId: string, settings: {
    enableMartingale?: boolean;
    enableLeverage?: boolean;
    enableCircuitBreaker?: boolean;
    enableRecoveryMode?: boolean;
    martingaleMultipliers?: number[];
    circuitBreakerLosses?: number;
    circuitBreakerPauseMinutes?: number;
    stakeMode?: string;
    fixedStake?: number;
  }): Promise<void> {
    const patch: Record<string, any> = { updatedAt: new Date().toISOString() };
    if (settings.enableMartingale !== undefined) patch.enableMartingale = settings.enableMartingale;
    if (settings.enableLeverage !== undefined) patch.enableLeverage = settings.enableLeverage;
    if (settings.enableCircuitBreaker !== undefined) patch.enableCircuitBreaker = settings.enableCircuitBreaker;
    if (settings.enableRecoveryMode !== undefined) patch.enableRecoveryMode = settings.enableRecoveryMode;
    if (settings.martingaleMultipliers !== undefined) patch.martingaleMultipliers = JSON.stringify(settings.martingaleMultipliers);
    if (settings.circuitBreakerLosses !== undefined) patch.circuitBreakerLosses = settings.circuitBreakerLosses;
    if (settings.circuitBreakerPauseMinutes !== undefined) patch.circuitBreakerPauseMinutes = settings.circuitBreakerPauseMinutes;
    if (settings.stakeMode !== undefined) patch.stakeMode = settings.stakeMode;
    if (settings.fixedStake !== undefined) patch.fixedStake = settings.fixedStake;
    await db
      .update(tradeConfigurations)
      .set(patch)
      .where(and(eq(tradeConfigurations.userId, userId), eq(tradeConfigurations.isActive, true)));
  }

  async deactivateAllTradeConfigs(userId: string): Promise<void> {
    await db
      .update(tradeConfigurations)
      .set({
        isActive: false,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tradeConfigurations.userId, userId));
  }

  async getActiveTradeConfigurations(): Promise<TradeConfiguration[]> {
    return await db
      .select()
      .from(tradeConfigurations)
      .where(eq(tradeConfigurations.isActive, true))
      .orderBy(desc(tradeConfigurations.createdAt));
  }

  async deactivateTradeConfiguration(configId: string): Promise<void> {
    await db
      .update(tradeConfigurations)
      .set({
        isActive: false,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tradeConfigurations.id, configId));
  }

  async reactivateTradeConfiguration(configId: string): Promise<void> {
    await db
      .update(tradeConfigurations)
      .set({
        isActive: true,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(tradeConfigurations.id, configId));
  }

  async getAllTradeConfigurations(): Promise<TradeConfiguration[]> {
    return await db
      .select()
      .from(tradeConfigurations)
      .orderBy(desc(tradeConfigurations.createdAt));
  }
  
  // Trade operations
  async createTradeOperation(operationData: InsertTradeOperation): Promise<TradeOperation> {
    // Validate critical fields
    if (!operationData.userId?.trim()) {
      throw new Error('Invalid userId: cannot be empty');
    }
    if (!operationData.symbol?.trim()) {
      throw new Error('Invalid symbol: cannot be empty'); 
    }
    if (!operationData.direction || !['up', 'down'].includes(operationData.direction)) {
      throw new Error('Invalid direction: must be "up" or "down"');
    }
    if (!operationData.amount || operationData.amount <= 0) {
      throw new Error('Invalid amount: must be greater than 0');
    }
    if (!operationData.duration || operationData.duration <= 0) {
      throw new Error('Invalid duration: must be greater than 0');
    }
    
    // Pre-flight checks: ensure user has active Deriv token and trade configuration
    const derivToken = await this.getUserDerivToken(operationData.userId);
    if (!derivToken || !derivToken.token?.trim()) {
      throw new Error('User must have a valid Deriv API token to create trades');
    }
    
    const tradeConfig = await this.getUserTradeConfig(operationData.userId);
    if (!tradeConfig || !tradeConfig.isActive) {
      throw new Error('User must have an active trade configuration to create trades');
    }
    
    const [operation] = await db
      .insert(tradeOperations)
      .values(operationData)
      .returning();
    return operation;
  }

  async getUserTradeOperations(userId: string, limit = 50): Promise<TradeOperation[]> {
    return await db
      .select()
      .from(tradeOperations)
      .where(eq(tradeOperations.userId, userId))
      .orderBy(desc(tradeOperations.createdAt))
      .limit(limit);
  }

  async getTradeOperationByDerivContractId(derivContractId: string): Promise<TradeOperation | null> {
    const [op] = await db
      .select()
      .from(tradeOperations)
      .where(eq(tradeOperations.derivContractId, derivContractId))
      .orderBy(desc(tradeOperations.createdAt))
      .limit(1);
    return op ?? null;
  }

  async updateTradeOperation(id: string, updates: Partial<TradeOperation>): Promise<TradeOperation> {
    // Whitelist allowed fields for security - 100% Deriv data sync
    const allowedFields = [
      'status', 'profit', 'entryPrice', 'exitPrice', 'derivContractId', 'completedAt',
      'shortcode', 'buyPrice', 'sellPrice', 'entryEpoch', 'exitEpoch',
      'contractType', 'barrier', 'derivStatus', 'derivProfit', 'payout',
      'statusChangedAt', 'lastSyncAt', 'syncCount'
    ];
    const safeUpdates: any = {};
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        safeUpdates[key] = value;
      }
    }
    
    // Only set completedAt when transitioning to terminal status (if not already set)
    const currentOperation = await db
      .select()
      .from(tradeOperations)
      .where(eq(tradeOperations.id, id))
      .limit(1);
    
    if (currentOperation.length > 0 && !safeUpdates.completedAt) {
      const current = currentOperation[0];
      const isTransitioningToTerminal = 
        current.status !== 'won' && current.status !== 'lost' && 
        (safeUpdates.status === 'won' || safeUpdates.status === 'lost');
      
      if (isTransitioningToTerminal) {
        safeUpdates.completedAt = new Date().toISOString();
      }
    }
    
    const [operation] = await db
      .update(tradeOperations)
      .set(safeUpdates)
      .where(eq(tradeOperations.id, id))
      .returning();
    return operation;
  }

  async getActiveTradeOperations(userId: string): Promise<TradeOperation[]> {
    return await db
      .select()
      .from(tradeOperations)
      .where(and(
        eq(tradeOperations.userId, userId),
        eq(tradeOperations.status, 'active')
      ))
      .orderBy(desc(tradeOperations.createdAt));
  }
  
  // AI logs operations
  async createAiLog(logData: InsertAiLog): Promise<AiLog> {
    const [log] = await db
      .insert(aiLogs)
      .values(logData)
      .returning();
    return log;
  }

  async getUserAiLogs(userId: string, limit = 100): Promise<AiLog[]> {
    return await db
      .select()
      .from(aiLogs)
      .where(eq(aiLogs.userId, userId))
      .orderBy(desc(aiLogs.createdAt))
      .limit(limit);
  }

  async getLatestAiAnalysis(userId: string): Promise<AiLog[]> {
    return await db
      .select()
      .from(aiLogs)
      .where(eq(aiLogs.userId, userId))
      .orderBy(desc(aiLogs.createdAt))
      .limit(10); // Last 10 AI analyses
  }
  
  // Market data operations
  async upsertMarketData(dataInput: InsertMarketData): Promise<MarketData> {
    try {
      // Try to find existing market data for this symbol
      const existing = await this.getMarketData(dataInput.symbol);
      
      if (existing) {
        // Update existing
        const [updated] = await db
          .update(marketData)
          .set({
            currentPrice: dataInput.currentPrice,
            priceHistory: dataInput.priceHistory,
            lastUpdate: new Date().toISOString(),
          })
          .where(eq(marketData.symbol, dataInput.symbol))
          .returning();
        return updated;
      } else {
        // Create new
        const [created] = await db
          .insert(marketData)
          .values(dataInput)
          .returning();
        return created;
      }
    } catch (error: any) {
      // Handle potential duplicate key errors and other database constraints
      const errorMessage = error?.message || 'Unknown error';
      if (errorMessage.includes('UNIQUE constraint failed') || errorMessage.includes('duplicate')) {
        // If duplicate symbol error, try to update instead
        const [updated] = await db
          .update(marketData)
          .set({
            currentPrice: dataInput.currentPrice,
            priceHistory: dataInput.priceHistory,
            lastUpdate: new Date().toISOString(),
          })
          .where(eq(marketData.symbol, dataInput.symbol))
          .returning();
        return updated;
      }
      throw new Error(`Failed to upsert market data for symbol ${dataInput.symbol}: ${errorMessage}`);
    }
  }

  async getMarketData(symbol: string): Promise<MarketData | undefined> {
    const [data] = await db
      .select()
      .from(marketData)
      .where(eq(marketData.symbol, symbol));
    return data;
  }

  async getAllMarketData(): Promise<MarketData[]> {
    return await db
      .select()
      .from(marketData)
      .orderBy(desc(marketData.lastUpdate));
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
    const operations = await db
      .select()
      .from(tradeOperations)
      .where(eq(tradeOperations.userId, userId));
    
    const totalTrades = operations.length;
    
    // Contar expiradas (sem resultado de lucro)
    const expiredTrades = operations.filter(op => op.status === 'expired' || op.status === 'closed').length;
    
    // Filter only completed trades (not pending and has profit value)
    const completedTrades = operations.filter(op => op.status !== 'pending' && op.status !== 'active' && op.profit !== null && op.profit !== undefined);
    
    // Count wins and losses based on PROFIT (not status)
    const wonTrades = completedTrades.filter(op => (op.profit || 0) > 0).length;
    const lostTrades = completedTrades.filter(op => (op.profit || 0) < 0).length;
    
    const totalProfit = completedTrades.reduce((sum, op) => sum + (op.profit || 0), 0);
    const winRate = completedTrades.length > 0 ? (wonTrades / completedTrades.length) * 100 : 0;
    
    return {
      totalTrades,
      wonTrades,
      lostTrades,
      expiredTrades,
      totalProfit,
      winRate: Math.round(winRate * 100) / 100,
    };
  }

  // Additional trading analytics for FNACIA system
  async getActiveTradesCount(userId: string): Promise<number> {
    const operations = await db
      .select()
      .from(tradeOperations)
      .where(and(
        eq(tradeOperations.userId, userId),
        eq(tradeOperations.status, 'active')
      ));
    
    return operations.length;
  }

  async getDailyLossCount(userId: string, date: string): Promise<number> {
    // Get date range for the day (start and end of day)
    const startOfDay = `${date}T00:00:00.000Z`;
    const endOfDay = `${date}T23:59:59.999Z`;
    
    const operations = await db
      .select()
      .from(tradeOperations)
      .where(and(
        eq(tradeOperations.userId, userId),
        eq(tradeOperations.status, 'lost')
      ));
    
    // Filter by date properly handling ISO string format
    const dailyLosses = operations.filter(op => {
      if (!op.completedAt) return false;
      
      try {
        // Parse ISO timestamp and extract date part
        const completedDate = op.completedAt.split('T')[0]; // Get YYYY-MM-DD part from ISO string
        return completedDate === date;
      } catch (error) {
        // Fallback for any parsing errors
        return false;
      }
    });
    
    return dailyLosses.length;
  }

  async saveActiveTradeForTracking(tradeData: any): Promise<void> {
    // Insert a new trade operation record for tracking
    await db
      .insert(tradeOperations)
      .values({
        userId: tradeData.userId,
        derivContractId: tradeData.contractId,
        symbol: tradeData.symbol,
        tradeType: tradeData.tradeType || 'digitdiff',
        direction: tradeData.direction || 'up',
        amount: tradeData.amount || 0,
        duration: tradeData.duration || 1,
        status: 'active',
        aiConsensus: JSON.stringify(tradeData.aiConsensus || {}),
        createdAt: new Date().toISOString()
      });
  }

  // LOSS RECOVERY SYSTEM OPERATIONS

  // Daily P&L Operations
  async createOrUpdateDailyPnL(userId: string, dailyData: Partial<InsertDailyPnL>): Promise<DailyPnL> {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    
    try {
      // Ensure user exists before touching daily_pnl (prevents FOREIGN KEY constraint failure)
      const userExists = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
      if (userExists.length === 0) {
        // User doesn't exist in local DB (e.g. Replit Auth user) — skip and return a virtual record
        console.warn(`[storage] createOrUpdateDailyPnL: userId ${userId} não encontrado — operação ignorada`);
        return {
          id: 'virtual',
          userId,
          date: today,
          openingBalance: dailyData.openingBalance?.toString() || '0',
          currentBalance: dailyData.currentBalance?.toString() || '0',
          dailyPnL: dailyData.dailyPnL?.toString() || '0',
          totalOperations: dailyData.totalOperations || 0,
          winOperations: dailyData.winOperations || 0,
          lossOperations: dailyData.lossOperations || 0,
          conservativeOperations: dailyData.conservativeOperations || 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as any;
      }

      // Check if today's record exists
      const existing = await db
        .select()
        .from(dailyPnL)
        .where(and(eq(dailyPnL.userId, userId), eq(dailyPnL.date, today)))
        .limit(1);

      if (existing.length > 0) {
        // Update existing record
        const [updated] = await db
          .update(dailyPnL)
          .set({
            ...dailyData,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(dailyPnL.id, existing[0].id))
          .returning();
        return updated;
      } else {
        // Create new record
        const [created] = await db
          .insert(dailyPnL)
          .values({
            userId,
            date: today,
            openingBalance: dailyData.openingBalance || 0,
            currentBalance: dailyData.currentBalance || 0,
            dailyPnL: dailyData.dailyPnL || 0,
            ...dailyData,
          })
          .returning();
        return created;
      }
    } catch (error: any) {
      if (error.message?.includes('FOREIGN KEY')) {
        console.warn(`[storage] createOrUpdateDailyPnL FOREIGN KEY ignorado para userId=${userId}`);
        return { id: 'virtual', userId, date: today, dailyPnL: '0', openingBalance: '0', currentBalance: '0', totalOperations: 0, winOperations: 0, lossOperations: 0, conservativeOperations: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as any;
      }
      throw new Error(`Failed to create/update daily P&L: ${error.message}`);
    }
  }

  async getDailyPnL(userId: string, date?: string): Promise<DailyPnL | undefined> {
    const targetDate = date || new Date().toISOString().split('T')[0];
    
    const [record] = await db
      .select()
      .from(dailyPnL)
      .where(and(eq(dailyPnL.userId, userId), eq(dailyPnL.date, targetDate)))
      .limit(1);
    
    return record;
  }

  // 🎯 SISTEMA DE OPERAÇÕES CONSERVADORAS - Tracking Persistente
  async getConservativeOperationsToday(userId: string): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    
    const [record] = await db
      .select()
      .from(dailyPnL)
      .where(and(eq(dailyPnL.userId, userId), eq(dailyPnL.date, today)))
      .limit(1);
    
    return record?.conservativeOperations || 0;
  }

  async incrementConservativeOperations(userId: string): Promise<number> {
    const today = new Date().toISOString().split('T')[0];
    
    try {
      // 🔒 OPERAÇÃO ATÔMICA: Tentar incrementar registro existente primeiro
      const updated = await db
        .update(dailyPnL)
        .set({
          conservativeOperations: sql`${dailyPnL.conservativeOperations} + 1`,
          updatedAt: new Date().toISOString()
        })
        .where(and(
          eq(dailyPnL.userId, userId),
          eq(dailyPnL.date, today)
        ))
        .returning();
      
      if (updated.length > 0) {
        // Incremento bem-sucedido
        return updated[0].conservativeOperations || 1;
      }
      
      // ⚠️ Registro não existe - Criar novo
      // Buscar saldo inicial (mesmo método que createOrUpdateDailyPnL)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      const [yesterdayRecord] = await db
        .select()
        .from(dailyPnL)
        .where(and(eq(dailyPnL.userId, userId), eq(dailyPnL.date, yesterdayStr)))
        .limit(1);
      
      let openingBalance = yesterdayRecord?.currentBalance || 0;
      
      // Se não tem saldo de ontem, buscar da conta Deriv
      if (!yesterdayRecord) {
        const tokenData = await this.getUserDerivToken(userId);
        openingBalance = tokenData?.accountType === 'demo' ? 10000 : 100;
      }
      
      // 🔒 INSERT com proteção contra race condition
      try {
        const [created] = await db
          .insert(dailyPnL)
          .values({
            userId,
            date: today,
            openingBalance,
            currentBalance: openingBalance,
            dailyPnL: 0,
            conservativeOperations: 1,
            totalTrades: 0,
            wonTrades: 0,
            lostTrades: 0
          })
          .returning();
        
        return created.conservativeOperations || 1;
      } catch (insertError: any) {
        // Se INSERT falhou (race condition), tentar incrementar novamente
        if (insertError.message?.includes('UNIQUE constraint')) {
          const [retryUpdate] = await db
            .update(dailyPnL)
            .set({
              conservativeOperations: sql`${dailyPnL.conservativeOperations} + 1`,
              updatedAt: new Date().toISOString()
            })
            .where(and(
              eq(dailyPnL.userId, userId),
              eq(dailyPnL.date, today)
            ))
            .returning();
          
          return retryUpdate?.conservativeOperations || 1;
        }
        throw insertError;
      }
    } catch (error: any) {
      console.error(`Error incrementing conservative operations: ${error.message}`);
      throw new Error(`Failed to increment conservative operations: ${error.message}`);
    }
  }

  async getRecentDailyPnL(userId: string, days = 7): Promise<DailyPnL[]> {
    return await db
      .select()
      .from(dailyPnL)
      .where(eq(dailyPnL.userId, userId))
      .orderBy(desc(dailyPnL.date))
      .limit(days);
  }

  // AI Recovery Strategies Operations
  async createAiRecoveryStrategy(strategyData: InsertAiRecoveryStrategy): Promise<AiRecoveryStrategy> {
    const [strategy] = await db
      .insert(aiRecoveryStrategies)
      .values(strategyData)
      .returning();
    return strategy;
  }

  async getUserRecoveryStrategies(userId: string): Promise<AiRecoveryStrategy[]> {
    return await db
      .select()
      .from(aiRecoveryStrategies)
      .where(eq(aiRecoveryStrategies.userId, userId))
      .orderBy(desc(aiRecoveryStrategies.successRate));
  }

  async updateRecoveryStrategy(id: string, updates: Partial<AiRecoveryStrategy>): Promise<AiRecoveryStrategy> {
    const [updated] = await db
      .update(aiRecoveryStrategies)
      .set({
        ...updates,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(aiRecoveryStrategies.id, id))
      .returning();
    return updated;
  }

  // Loss Recovery Analytics
  async calculateRecoveryMultiplier(userId: string): Promise<number> {
    let todayPnL = await this.getDailyPnL(userId);
    if (!todayPnL) {
      // Auto-inicializar PnL se não existir
      const tokenData = await this.getUserDerivToken(userId);
      const initialBalance = tokenData?.accountType === 'demo' ? 10000 : 100;
      todayPnL = await this.createOrUpdateDailyPnL(userId, {
        openingBalance: initialBalance,
        currentBalance: initialBalance,
        dailyPnL: 0
      });
    }

    const lossPercent = Math.abs(todayPnL.dailyPnL) / todayPnL.openingBalance;
    
    // ANTI-MARTINGALE: Reduzir stakes gradualmente em perdas para proteger banca.
    // Nunca aumentar acima de 1.0x — martingale em RNG/DIGITDIFF é matematicamente ruinoso.
    if (lossPercent >= 0.20) return 0.5; // 20%+ loss: reduzir 50% para preservar banca
    if (lossPercent >= 0.15) return 0.6; // 15%+ loss: reduzir 40%
    if (lossPercent >= 0.10) return 0.7; // 10%+ loss: reduzir 30%
    if (lossPercent >= 0.05) return 0.85; // 5%+ loss: reduzir 15%
    if (lossPercent >= 0.02) return 0.95; // 2%+ loss: reduzir 5%
    
    return 1.0; // Sem perdas relevantes = stake normal
  }

  async shouldActivateRecovery(userId: string): Promise<boolean> {
    try {
      let todayPnL = await this.getDailyPnL(userId);
      if (!todayPnL) {
        const tokenData = await this.getUserDerivToken(userId);
        const initialBalance = tokenData?.accountType === 'demo' ? 10000 : 100;
        try {
          todayPnL = await this.createOrUpdateDailyPnL(userId, {
            openingBalance: initialBalance,
            currentBalance: initialBalance,
            dailyPnL: 0
          });
        } catch (fkErr: any) {
          if (fkErr?.message?.includes('FOREIGN KEY') || fkErr?.message?.includes('NOT NULL')) {
            return false;
          }
          throw fkErr;
        }
      }
      const lossPercent = Math.abs(todayPnL.dailyPnL) / todayPnL.openingBalance;
      const threshold = todayPnL.recoveryThreshold || 0.75;
      return lossPercent >= threshold;
    } catch {
      return false;
    }
  }

  async getRecoveryThresholdRecommendation(userId: string): Promise<number> {
    const userStrategies = await this.getUserRecoveryStrategies(userId);
    const todayPnL = await this.getDailyPnL(userId);
    
    if (!todayPnL) return 0.75; // Default se não há dados
    
    // 🔥 SISTEMA DINÂMICO DE THRESHOLD 75% A 95%
    // Baseado na severidade das perdas e cooperação das IAs
    const lossPercent = Math.abs(todayPnL.dailyPnL) / todayPnL.openingBalance;
    
    let dynamicThreshold = 0.75; // Base 75%
    
    // Elevar threshold baseado na severidade da perda
    if (lossPercent >= 0.25) {
      // Perdas >= 25%: Threshold máximo 95% - IAs trabalham na máxima cooperação
      dynamicThreshold = 0.95;
    } else if (lossPercent >= 0.20) {
      // Perdas >= 20%: Threshold 90% - Cooperação muito alta
      dynamicThreshold = 0.90;
    } else if (lossPercent >= 0.15) {
      // Perdas >= 15%: Threshold 87% - Cooperação alta
      dynamicThreshold = 0.87;
    } else if (lossPercent >= 0.10) {
      // Perdas >= 10%: Threshold 83% - Cooperação média-alta
      dynamicThreshold = 0.83;
    } else if (lossPercent >= 0.05) {
      // Perdas >= 5%: Threshold 80% - Cooperação média
      dynamicThreshold = 0.80;
    } else if (lossPercent >= 0.02) {
      // Perdas >= 2%: Threshold 77% - Cooperação baixa-média
      dynamicThreshold = 0.77;
    }
    // Abaixo de 2% de perda: usa threshold base 75%
    
    // Aplicar modificadores baseados em estratégias ativas do usuário
    const bestStrategy = userStrategies.find(s => s.isActive && (s.successRate || 0) > 0.70);
    
    if (bestStrategy) {
      try {
        const params = JSON.parse(bestStrategy.parameters);
        const strategyThreshold = params.recoveryThreshold || dynamicThreshold;
        
        // Se a estratégia do usuário tem threshold específico, aplicar como modificador
        if (strategyThreshold > dynamicThreshold) {
          dynamicThreshold = Math.min(0.95, strategyThreshold); // Nunca passar de 95%
        }
        
        // Bonus baseado na taxa de sucesso da estratégia
        const successRate = bestStrategy.successRate || 0;
        if (successRate > 85) {
          // Estratégias com alta taxa de sucesso podem usar thresholds ligeiramente mais altos
          dynamicThreshold = Math.min(0.95, dynamicThreshold + 0.03);
        } else if (successRate < 60) {
          // Estratégias com baixa taxa de sucesso usam thresholds mais conservadores
          dynamicThreshold = Math.max(0.75, dynamicThreshold - 0.05);
        }
        
        console.log(`🎯 [THRESHOLD DYNAMIC] Aplicado modificador da estratégia "${bestStrategy.strategyName}":`);
        console.log(`   • Taxa de sucesso: ${successRate}%`);
        console.log(`   • Threshold da estratégia: ${Math.round(strategyThreshold * 100)}%`);
        
      } catch (error) {
        console.warn(`⚠️ Erro ao processar parâmetros da estratégia: ${error}`);
      }
    }
    
    // Garantir que sempre esteja no range 75%-95%
    dynamicThreshold = Math.max(0.75, Math.min(0.95, dynamicThreshold));
    
    console.log(`🧠 [THRESHOLD DYNAMIC] Calculado dinamicamente:`);
    console.log(`   • Perda atual: ${(lossPercent * 100).toFixed(1)}%`);
    console.log(`   • Threshold base: ${Math.round(dynamicThreshold * 100)}%`);
    console.log(`   • Estratégias ativas: ${userStrategies.filter(s => s.isActive).length}`);
    console.log(`   • Cooperação IA requerida: ${dynamicThreshold >= 0.90 ? 'MÁXIMA' : dynamicThreshold >= 0.85 ? 'ALTA' : dynamicThreshold >= 0.80 ? 'MÉDIA-ALTA' : 'PADRÃO'}`);
    
    return Number(dynamicThreshold.toFixed(2));
  }

  // 🔥 PROTEÇÃO CONTRA FECHAMENTO ABAIXO DO ANTERIOR/ABERTURA
  // isMartingaleRecovery=true → limites mais amplos (a operação É a recuperação)
  async canExecuteTradeWithoutViolatingMinimum(userId: string, potentialLoss: number, isMartingaleRecovery = false): Promise<{canExecute: boolean, reason?: string, currentBalance: number, minimumRequired: number}> {
    let todayPnL = await this.getDailyPnL(userId);
    
    if (!todayPnL) {
      const tokenData = await this.getUserDerivToken(userId);
      let initialBalance = 10000;
      if (tokenData?.accountType === 'real') initialBalance = 100;
      
      try {
        todayPnL = await this.createOrUpdateDailyPnL(userId, {
          openingBalance: initialBalance, currentBalance: initialBalance, dailyPnL: 0,
          totalTrades: 0, wonTrades: 0, lostTrades: 0, isRecoveryActive: false,
          recoveryThreshold: 0.75, maxDrawdown: 0, recoveryOperations: 0
        });
      } catch (fkErr: any) {
        if (fkErr?.message?.includes('FOREIGN KEY') || fkErr?.message?.includes('NOT NULL')) {
          return { canExecute: true, currentBalance: initialBalance, minimumRequired: initialBalance * 0.95 };
        }
        throw fkErr;
      }
    }

    const currentBalance = todayPnL.currentBalance;
    const openingBalance = todayPnL.openingBalance;

    // Calcular saldo após potencial perda
    const projectedBalance = currentBalance - potentialLoss;

    // PROTEÇÃO ORIENTADA AO MERCADO:
    // Não usa o fechamento do dia anterior como piso (que causaria bloqueio até meia-noite).
    // Em vez disso, usa uma margem de drawdown máximo sobre a ABERTURA DO DIA.
    // O mercado controla quando voltar: o Recovery Mode já exige consenso alto (75%+)
    // antes de autorizar qualquer trade após perdas.
    const tokenData = await this.getUserDerivToken(userId);
    const accountType = tokenData?.accountType || 'demo';

    // Limites por tipo de operação:
    //   Trade normal    → Demo 25% | Real 15%  (ampliado para não bloquear IA prematuramente)
    //   Martingale rec. → Demo 40% | Real 28%  (a operação É a recuperação, não pode ser bloqueada)
    const maxDrawdownPct = isMartingaleRecovery
      ? (accountType === 'demo' ? 0.40 : 0.28)
      : (accountType === 'demo' ? 0.25 : 0.15);

    const minimumRequired = openingBalance * (1 - maxDrawdownPct);

    // Proteção absoluta: nunca deixar o saldo projetado abaixo de 20% do saldo atual
    // (garante que mesmo martingale não aposte tudo de uma vez)
    const absoluteFloor = currentBalance * 0.20;

    if (projectedBalance < minimumRequired || projectedBalance < absoluteFloor) {
      const effectiveFloor = Math.max(minimumRequired, absoluteFloor);
      const lostPct = (((openingBalance - projectedBalance) / openingBalance) * 100).toFixed(1);
      const limitLabel = isMartingaleRecovery ? `${(maxDrawdownPct*100).toFixed(0)}% (martingale)` : `${(maxDrawdownPct*100).toFixed(0)}%`;
      const reason = `Trade bloqueado: queda de ${lostPct}% excede limite de ${limitLabel} da abertura ($${openingBalance.toFixed(2)})`;

      console.log(`🚫 PROTEÇÃO ATIVADA: ${reason}`);
      console.log(`   • Modo: ${isMartingaleRecovery ? 'MARTINGALE RECOVERY' : 'TRADE NORMAL'}`);
      console.log(`   • Saldo atual: $${currentBalance.toFixed(2)}`);
      console.log(`   • Perda potencial: $${potentialLoss.toFixed(2)}`);
      console.log(`   • Saldo projetado: $${projectedBalance.toFixed(2)}`);
      console.log(`   • Mínimo permitido: $${effectiveFloor.toFixed(2)} (${limitLabel} abaixo da abertura)`);
      console.log(`   • Abertura do dia: $${openingBalance.toFixed(2)}`);
      console.log(`   ⏳ Sistema aguardará mercado melhorar (consenso ≥75%) antes de operar.`);

      return {
        canExecute: false,
        reason,
        currentBalance,
        minimumRequired: effectiveFloor
      };
    }

    return {
      canExecute: true,
      currentBalance,
      minimumRequired
    };
  }

  async getMinimumBalanceRequired(userId: string): Promise<number> {
    const todayPnL = await this.getDailyPnL(userId);
    if (!todayPnL) return 0;
    
    // Buscar saldo do dia anterior
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    const yesterdayPnL = await this.getDailyPnL(userId, yesterdayStr);
    const previousDayClosingBalance = yesterdayPnL ? yesterdayPnL.currentBalance : todayPnL.openingBalance;
    
    // Retornar o maior valor entre abertura do dia e fechamento anterior
    return Math.max(todayPnL.openingBalance, previousDayClosingBalance);
  }

  async getBalanceAnalysis(userId: string): Promise<{
    currentBalance: number;
    openingBalance: number;
    previousDayBalance: number;
    minimumRequired: number;
    safetyMargin: number;
    dailyPnL: number;
    canTrade: boolean;
  }> {
    const todayPnL = await this.getDailyPnL(userId);
    
    if (!todayPnL) {
      return {
        currentBalance: 0,
        openingBalance: 0,
        previousDayBalance: 0,
        minimumRequired: 0,
        safetyMargin: 0,
        dailyPnL: 0,
        canTrade: false
      };
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    const yesterdayPnL = await this.getDailyPnL(userId, yesterdayStr);
    const previousDayBalance = yesterdayPnL ? yesterdayPnL.currentBalance : todayPnL.openingBalance;
    
    const minimumRequired = Math.max(todayPnL.openingBalance, previousDayBalance);
    const safetyMargin = todayPnL.currentBalance - minimumRequired;
    
    return {
      currentBalance: todayPnL.currentBalance,
      openingBalance: todayPnL.openingBalance,
      previousDayBalance,
      minimumRequired,
      safetyMargin,
      dailyPnL: todayPnL.dailyPnL,
      canTrade: safetyMargin > 0
    };
  }

  // RESILIENCE SYSTEM OPERATIONS

  async upsertActiveTradingSession(session: InsertActiveTradingSession): Promise<ActiveTradingSession> {
    try {
      const existing = await this.getActiveTradingSession(session.sessionKey);
      
      if (existing) {
        await db
          .update(activeTradingSessions)
          .set({ ...session, updatedAt: new Date().toISOString() })
          .where(eq(activeTradingSessions.sessionKey, session.sessionKey));
        return (await this.getActiveTradingSession(session.sessionKey))!;
      } else {
        const [created] = await db
          .insert(activeTradingSessions)
          .values(session)
          .returning();
        return created;
      }
    } catch (err: any) {
      if (err?.message?.includes('FOREIGN KEY')) {
        return { ...session, id: session.sessionKey, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as any;
      }
      throw err;
    }
  }

  async getActiveTradingSession(sessionKey: string): Promise<ActiveTradingSession | undefined> {
    const [session] = await db
      .select()
      .from(activeTradingSessions)
      .where(eq(activeTradingSessions.sessionKey, sessionKey));
    return session;
  }

  async getAllActiveTradingSessions(): Promise<ActiveTradingSession[]> {
    return await db
      .select()
      .from(activeTradingSessions)
      .where(eq(activeTradingSessions.isActive, true));
  }

  async updateActiveTradingSession(sessionKey: string, updates: Partial<ActiveTradingSession>): Promise<void> {
    await db
      .update(activeTradingSessions)
      .set({ ...updates, updatedAt: new Date().toISOString() })
      .where(eq(activeTradingSessions.sessionKey, sessionKey));
  }

  async deactivateActiveTradingSession(sessionKey: string): Promise<void> {
    await db
      .update(activeTradingSessions)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(activeTradingSessions.sessionKey, sessionKey));
  }

  async clearInactiveTradingSessions(): Promise<void> {
    await db
      .delete(activeTradingSessions)
      .where(eq(activeTradingSessions.isActive, false));
  }

  async saveWebSocketSubscription(subscription: InsertActiveWebSocketSubscription): Promise<ActiveWebSocketSubscription> {
    const [created] = await db
      .insert(activeWebSocketSubscriptions)
      .values(subscription)
      .returning();
    return created;
  }

  async getActiveWebSocketSubscriptions(): Promise<ActiveWebSocketSubscription[]> {
    return await db
      .select()
      .from(activeWebSocketSubscriptions)
      .where(eq(activeWebSocketSubscriptions.isActive, true));
  }

  async deactivateWebSocketSubscription(subscriptionId: string): Promise<void> {
    await db
      .update(activeWebSocketSubscriptions)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(activeWebSocketSubscriptions.subscriptionId, subscriptionId));
  }

  async clearAllWebSocketSubscriptions(): Promise<void> {
    await db
      .delete(activeWebSocketSubscriptions)
      .where(eq(activeWebSocketSubscriptions.isActive, false));
  }

  async updateSystemHeartbeat(componentName: string, status: string, metadata?: any, lastError?: string): Promise<void> {
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
      await db
        .update(systemHealthHeartbeat)
        .set(data)
        .where(eq(systemHealthHeartbeat.componentName, componentName));
    } else {
      await db.insert(systemHealthHeartbeat).values({
        ...data,
        errorCount: 0,
      });
    }
  }

  async getSystemHeartbeat(componentName: string): Promise<SystemHealthHeartbeat | undefined> {
    const [heartbeat] = await db
      .select()
      .from(systemHealthHeartbeat)
      .where(eq(systemHealthHeartbeat.componentName, componentName));
    return heartbeat;
  }

  async getAllSystemHeartbeats(): Promise<SystemHealthHeartbeat[]> {
    return await db.select().from(systemHealthHeartbeat);
  }

  async incrementHeartbeatError(componentName: string, error: string): Promise<void> {
    const existing = await this.getSystemHeartbeat(componentName);
    
    if (existing) {
      await db
        .update(systemHealthHeartbeat)
        .set({
          errorCount: existing.errorCount + 1,
          lastError: error,
          status: 'degraded',
          updatedAt: new Date().toISOString(),
        })
        .where(eq(systemHealthHeartbeat.componentName, componentName));
    } else {
      await db.insert(systemHealthHeartbeat).values({
        componentName,
        lastHeartbeat: new Date().toISOString(),
        status: 'degraded',
        errorCount: 1,
        lastError: error,
      });
    }
  }

  async resetHeartbeatErrors(componentName: string): Promise<void> {
    await db
      .update(systemHealthHeartbeat)
      .set({
        errorCount: 0,
        lastError: null,
        status: 'healthy',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(systemHealthHeartbeat.componentName, componentName));
  }

  // Trading control (centralizado - compartilhado entre todos os remixes)
  async getTradingControlStatus(): Promise<TradingControl | undefined> {
    const [control] = await db.select().from(tradingControl).limit(1);
    return control;
  }

  async pauseTrading(pausedBy: string, reason: string): Promise<TradingControl> {
    const existing = await this.getTradingControlStatus();
    const now = new Date().toISOString();

    if (existing) {
      const [updated] = await db
        .update(tradingControl)
        .set({
          isPaused: true,
          pausedBy,
          pausedAt: now,
          pauseReason: reason,
          resumedAt: null,
          updatedAt: now,
        })
        .where(eq(tradingControl.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(tradingControl)
        .values({
          isPaused: true,
          pausedBy,
          pausedAt: now,
          pauseReason: reason,
          updatedAt: now,
        })
        .returning();
      return created;
    }
  }

  async resumeTrading(): Promise<TradingControl> {
    const existing = await this.getTradingControlStatus();
    const now = new Date().toISOString();

    if (existing) {
      const [updated] = await db
        .update(tradingControl)
        .set({
          isPaused: false,
          resumedAt: now,
          updatedAt: now,
        })
        .where(eq(tradingControl.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(tradingControl)
        .values({
          isPaused: false,
          resumedAt: now,
          updatedAt: now,
        })
        .returning();
      return created;
    }
  }

  // Asset Blacklist operations
  async createAssetBlacklist(blacklist: InsertAssetBlacklist): Promise<AssetBlacklist> {
    const [result] = await db.insert(assetBlacklist).values(blacklist).returning();
    return result;
  }

  async getUserAssetBlacklists(userId: string): Promise<AssetBlacklist[]> {
    return await db.select().from(assetBlacklist).where(eq(assetBlacklist.userId, userId));
  }

  async deleteAssetBlacklist(id: string): Promise<void> {
    await db.delete(assetBlacklist).where(eq(assetBlacklist.id, id));
  }

  async isAssetBlocked(userId: string, assetName: string): Promise<boolean> {
    const blacklisted = await db.select().from(assetBlacklist).where(eq(assetBlacklist.userId, userId));
    return blacklisted.some(ba => {
      if (ba.patternType === 'exact') {
        return ba.assetPattern === assetName;
      } else if (ba.patternType === 'contains') {
        return assetName.includes(ba.assetPattern);
      }
      return false;
    });
  }

  async isUserBlockedAsset(userId: string, symbol: string, tradeMode: string): Promise<boolean> {
    const rows = await db.select().from(blockedAssets).where(
      and(
        eq(blockedAssets.userId, userId),
        eq(blockedAssets.tradeMode, tradeMode),
        eq(blockedAssets.symbol, symbol)
      )
    );
    return rows.length > 0;
  }

  // Pause Configuration operations
  async getUserPauseConfig(userId: string): Promise<PauseConfiguration | undefined> {
    const [config] = await db.select().from(pauseConfiguration).where(eq(pauseConfiguration.userId, userId));
    return config;
  }

  async createPauseConfig(config: InsertPauseConfiguration): Promise<PauseConfiguration> {
    const [result] = await db.insert(pauseConfiguration).values(config).returning();
    return result;
  }

  async updatePauseConfig(userId: string, config: UpdatePauseConfiguration): Promise<PauseConfiguration> {
    const [result] = await db.update(pauseConfiguration).set({
      ...config,
      updatedAt: new Date().toISOString(),
    }).where(eq(pauseConfiguration.userId, userId)).returning();
    return result;
  }

  async updatePausedNowStatus(userId: string, isPausedNow: boolean): Promise<void> {
    await db.update(pauseConfiguration).set({
      isPausedNow,
      lastPauseStartedAt: isPausedNow ? new Date().toISOString() : null,
      updatedAt: new Date().toISOString(),
    }).where(eq(pauseConfiguration.userId, userId));
  }

  /**
   * Expira automaticamente trades pendentes irrecuperáveis.
   * Contratos DIGIT DIFFER têm duração de ~10 ticks (< 30 segundos).
   * Qualquer trade pendente com mais de `olderThanMinutes` minutos nunca será resolvido.
   * @param olderThanMinutes Padrão: 5 minutos
   * @returns Número de trades marcados como expirados
   */
  async expireOldPendingTrades(olderThanMinutes: number = 5): Promise<number> {
    const cutoffTime = new Date(Date.now() - olderThanMinutes * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const result = await db.run(
      sql`UPDATE trade_operations 
          SET status = 'expired', 
              profit = NULL, 
              deriv_status = 'expired_unresolved',
              last_sync_at = ${now},
              completed_at = ${now}
          WHERE status = 'pending' 
            AND created_at < ${cutoffTime}`
    );

    return (result as any).changes ?? 0;
  }

  async resetAllTradingData(userId: string): Promise<{ tablesCleared: string[]; rowsDeleted: number }> {
    const tablesCleared: string[] = [];
    let rowsDeleted = 0;

    const del = async (table: any, condition: any, name: string) => {
      try {
        const rows = await db.delete(table).where(condition).returning();
        if (rows.length > 0 || true) {
          tablesCleared.push(name);
          rowsDeleted += rows.length;
        }
      } catch {}
    };

    await del(tradeOperations, eq(tradeOperations.userId, userId), 'trade_operations');
    await del(aiLogs, eq(aiLogs.userId, userId), 'ai_logs');
    await del(dailyPnL, eq(dailyPnL.userId, userId), 'daily_pnl');
    await del(aiRecoveryStrategies, eq(aiRecoveryStrategies.userId, userId), 'ai_recovery_strategies');
    await del(blockedAssets, eq(blockedAssets.userId, userId), 'blocked_assets');
    await del(assetBlacklist, eq(assetBlacklist.userId, userId), 'asset_blacklist');

    // Sessões e WebSockets — limpar tudo (são temporários de qualquer forma)
    try {
      const sessions = await db.delete(activeTradingSessions).returning();
      tablesCleared.push('active_trading_sessions');
      rowsDeleted += sessions.length;
    } catch {}

    try {
      const wsSubs = await db.delete(activeWebSocketSubscriptions).returning();
      tablesCleared.push('active_websocket_subscriptions');
      rowsDeleted += wsSubs.length;
    } catch {}

    // Nota: memória de aprendizado das IAs (episodic_memory, dynamic_weights,
    // emergent_patterns, strategy_evolution, meta_learning, experiment_tracking,
    // performance_analytics) é preservada — representa conhecimento acumulado valioso.

    return { tablesCleared, rowsDeleted };
  }

}

export const storage = new DatabaseStorage();
