/**
 * DUAL DATABASE STORAGE - Neon PostgreSQL (primário) + SQLite (fallback)
 *
 * Neon PostgreSQL é o banco principal - dados persistem 100% na nuvem.
 * SQLite local é fallback caso o PostgreSQL esteja indisponível.
 */

import { randomBytes } from "crypto";
import { DatabaseStorage } from "./storage";
import { PostgresStorage } from "./storage-postgres";
import { isPostgresAvailable } from "./db-postgres";
import type { IStorage } from "./storage";
import type {
  User, InsertUser, UpdateUser,
  Movimento, InsertMovimento,
  Documento, InsertDocumento,
  DerivToken, InsertDerivToken,
  TradeConfiguration, InsertTradeConfiguration,
  TradeOperation, InsertTradeOperation,
  AiLog, InsertAiLog,
  MarketData, InsertMarketData,
  DailyPnL, InsertDailyPnL,
  AiRecoveryStrategy, InsertAiRecoveryStrategy,
  ActiveTradingSession, InsertActiveTradingSession,
  ActiveWebSocketSubscription, InsertActiveWebSocketSubscription,
  SystemHealthHeartbeat, TradingControl,
} from "@shared/schema";

const QUOTA_ERRORS = ['exceeded the data transfer quota', 'data transfer quota', 'upgrade your plan', 'exceeded.*quota'];

function isQuotaError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return QUOTA_ERRORS.some(pattern => {
    try { return new RegExp(pattern, 'i').test(lower); } catch { return lower.includes(pattern); }
  });
}

export class DualStorage implements IStorage {
  private sqlite: DatabaseStorage;
  private postgres: PostgresStorage | null;
  private isDualMode: boolean;
  private neonDisabled: boolean = false;
  private consecutiveFailures: number = 0;
  private readonly MAX_FAILURES = 3;

  constructor() {
    this.sqlite = new DatabaseStorage();
    this.postgres = isPostgresAvailable ? new PostgresStorage() : null;
    this.isDualMode = isPostgresAvailable;
    this.neonDisabled = false;

    if (this.isDualMode) {
      console.log('🚀 [NEON] Sistema Dual Database ATIVO - Neon PostgreSQL (primário) + SQLite (fallback)');
      console.log('🌐 [NEON] Todos os dados serão persistidos no Neon PostgreSQL cloud');
    } else {
      console.warn('⚠️ [NEON] PostgreSQL não disponível - usando apenas SQLite local');
      console.warn('   Configure DATABASE_URL para ativar o Neon PostgreSQL');
    }
  }

  private disableNeon(reason: string): void {
    if (!this.neonDisabled) {
      this.neonDisabled = true;
      this.isDualMode = false;
      console.warn(`🔌 [NEON] Circuit breaker ATIVADO — Neon desabilitado para esta sessão.`);
      console.warn(`   Motivo: ${reason}`);
      console.warn(`   ✅ Sistema continuará operando normalmente via SQLite local.`);
    }
  }

  private handleNeonError(err: any, op: string): void {
    const msg = err?.message || String(err);
    if (isQuotaError(msg)) {
      this.disableNeon(`Cota de transferência de dados excedida (${op})`);
      return;
    }
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.MAX_FAILURES) {
      this.disableNeon(`${this.MAX_FAILURES} falhas consecutivas (última em ${op}: ${msg})`);
    }
  }

  private resetFailures(): void {
    this.consecutiveFailures = 0;
  }

  private async primaryWrite<T>(pgOp: () => Promise<T>, sqliteOp: () => Promise<T>, op: string): Promise<T> {
    if (this.neonDisabled || !this.isDualMode || !this.postgres) return await sqliteOp();
    try {
      const result = await pgOp();
      this.resetFailures();
      sqliteOp().catch(err => console.warn(`⚠️ [DUAL] SQLite sync falhou em ${op}:`, err.message));
      return result;
    } catch (err: any) {
      this.handleNeonError(err, op);
      return await sqliteOp();
    }
  }

  private async primaryRead<T>(pgOp: () => Promise<T>, sqliteOp: () => Promise<T>, op: string): Promise<T> {
    if (this.neonDisabled || !this.isDualMode || !this.postgres) return await sqliteOp();
    try {
      const result = await pgOp();
      this.resetFailures();
      return result;
    } catch (err: any) {
      this.handleNeonError(err, op);
      return await sqliteOp();
    }
  }

  private get neonActive(): boolean {
    return !this.neonDisabled && this.isDualMode && this.postgres !== null;
  }

  async getUser(id: string) {
    if (!this.neonActive) return await this.sqlite.getUser(id);
    try {
      const r = await this.postgres!.getUser(id);
      this.resetFailures();
      if (r) return r;
      return await this.sqlite.getUser(id);
    } catch (err: any) { this.handleNeonError(err, 'getUser'); return await this.sqlite.getUser(id); }
  }
  async getUserByEmail(email: string) {
    if (!this.neonActive) return await this.sqlite.getUserByEmail(email);
    try {
      const r = await this.postgres!.getUserByEmail(email);
      this.resetFailures();
      if (r) return r;
      return await this.sqlite.getUserByEmail(email);
    } catch (err: any) { this.handleNeonError(err, 'getUserByEmail'); return await this.sqlite.getUserByEmail(email); }
  }
  async getUserByCpf(cpf: string) {
    if (!this.neonActive) return await this.sqlite.getUserByCpf(cpf);
    try {
      const r = await this.postgres!.getUserByCpf(cpf);
      this.resetFailures();
      if (r) return r;
      return await this.sqlite.getUserByCpf(cpf);
    } catch (err: any) { this.handleNeonError(err, 'getUserByCpf'); return await this.sqlite.getUserByCpf(cpf); }
  }
  async getAllUsers() {
    if (!this.neonActive) return await this.sqlite.getAllUsers();
    try {
      const pgUsers = await this.postgres!.getAllUsers();
      this.resetFailures();
      if (pgUsers.length > 0) return pgUsers;
      return await this.sqlite.getAllUsers();
    } catch (err: any) { this.handleNeonError(err, 'getAllUsers'); return await this.sqlite.getAllUsers(); }
  }
  async createUser(user: InsertUser) { return this.primaryWrite(() => this.postgres!.createUser(user), () => this.sqlite.createUser(user), 'createUser'); }
  async updateUser(id: string, data: UpdateUser) { return this.primaryWrite(() => this.postgres!.updateUser(id, data), () => this.sqlite.updateUser(id, data), 'updateUser'); }
  async updateVerificationCode(userId: string, code: string, expiresAt: Date) { return this.primaryWrite(() => this.postgres!.updateVerificationCode(userId, code, expiresAt), () => this.sqlite.updateVerificationCode(userId, code, expiresAt), 'updateVerificationCode'); }
  async verifyPhone(userId: string) { return this.primaryWrite(() => this.postgres!.verifyPhone(userId), () => this.sqlite.verifyPhone(userId), 'verifyPhone'); }
  async approveAccount(userId: string, approvedBy: string) { return this.primaryWrite(() => this.postgres!.approveAccount(userId, approvedBy), () => this.sqlite.approveAccount(userId, approvedBy), 'approveAccount'); }

  async createMovimento(m: InsertMovimento) { return this.primaryWrite(() => this.postgres!.createMovimento(m), () => this.sqlite.createMovimento(m), 'createMovimento'); }
  async getUserMovimentos(userId: string, limit?: number) { return this.primaryRead(() => this.postgres!.getUserMovimentos(userId, limit), () => this.sqlite.getUserMovimentos(userId, limit), 'getUserMovimentos'); }
  async calcularRendimento(saldo: number) { return this.sqlite.calcularRendimento(saldo); }

  async createDocumento(d: InsertDocumento) { return this.primaryWrite(() => this.postgres!.createDocumento(d), () => this.sqlite.createDocumento(d), 'createDocumento'); }
  async getUserDocumentos(userId: string) { return this.primaryRead(() => this.postgres!.getUserDocumentos(userId), () => this.sqlite.getUserDocumentos(userId), 'getUserDocumentos'); }
  async updateDocumentoStatus(id: string, status: string, motivo?: string) { return this.primaryWrite(() => this.postgres!.updateDocumentoStatus(id, status, motivo), () => this.sqlite.updateDocumentoStatus(id, status, motivo), 'updateDocumentoStatus'); }

  async createDerivToken(t: InsertDerivToken) { return this.primaryWrite(() => this.postgres!.createDerivToken(t), () => this.sqlite.createDerivToken(t), 'createDerivToken'); }

  async getUserDerivToken(userId: string): Promise<DerivToken | undefined> {
    if (!this.neonActive) return await this.sqlite.getUserDerivToken(userId);
    try {
      const pgResult = await this.postgres!.getUserDerivToken(userId);
      this.resetFailures();
      if (pgResult) return pgResult;
      return await this.sqlite.getUserDerivToken(userId);
    } catch (err: any) {
      this.handleNeonError(err, 'getUserDerivToken');
      return await this.sqlite.getUserDerivToken(userId);
    }
  }

  async updateDerivToken(userId: string, token: string, accountType: string) {
    return this.primaryWrite(
      () => this.postgres!.updateDerivToken(userId, token, accountType),
      () => this.sqlite.updateDerivToken(userId, token, accountType),
      'updateDerivToken'
    );
  }

  async deactivateDerivToken(userId: string) { return this.primaryWrite(() => this.postgres!.deactivateDerivToken(userId), () => this.sqlite.deactivateDerivToken(userId), 'deactivateDerivToken'); }

  async createTradeConfig(c: InsertTradeConfiguration) { return this.primaryWrite(() => this.postgres!.createTradeConfig(c), () => this.sqlite.createTradeConfig(c), 'createTradeConfig'); }

  async getUserTradeConfig(userId: string): Promise<TradeConfiguration | undefined> {
    if (!this.neonActive) return await this.sqlite.getUserTradeConfig(userId);
    try {
      const pgResult = await this.postgres!.getUserTradeConfig(userId);
      this.resetFailures();
      if (pgResult) return pgResult;
      return await this.sqlite.getUserTradeConfig(userId);
    } catch (err: any) {
      this.handleNeonError(err, 'getUserTradeConfig');
      return await this.sqlite.getUserTradeConfig(userId);
    }
  }

  async getAllTradeConfigurations(): Promise<TradeConfiguration[]> {
    if (!this.neonActive) return await this.sqlite.getAllTradeConfigurations();
    try {
      const pgResult = await this.postgres!.getAllTradeConfigurations();
      this.resetFailures();
      if (pgResult.length > 0) return pgResult;
      return await this.sqlite.getAllTradeConfigurations();
    } catch (err: any) {
      this.handleNeonError(err, 'getAllTradeConfigurations');
      return await this.sqlite.getAllTradeConfigurations();
    }
  }

  async getActiveTradeConfigurations(): Promise<TradeConfiguration[]> {
    if (!this.neonActive) return await this.sqlite.getActiveTradeConfigurations();
    try {
      const pgResult = await this.postgres!.getActiveTradeConfigurations();
      this.resetFailures();
      if (pgResult.length > 0) return pgResult;
      return await this.sqlite.getActiveTradeConfigurations();
    } catch (err: any) {
      this.handleNeonError(err, 'getActiveTradeConfigurations');
      return await this.sqlite.getActiveTradeConfigurations();
    }
  }

  async updateTradeConfig(userId: string, mode: string) { return this.primaryWrite(() => this.postgres!.updateTradeConfig(userId, mode), () => this.sqlite.updateTradeConfig(userId, mode), 'updateTradeConfig'); }
  async updateSelectedModalities(userId: string, modalities: string[]) { return this.primaryWrite(() => this.postgres!.updateSelectedModalities(userId, modalities), () => this.sqlite.updateSelectedModalities(userId, modalities), 'updateSelectedModalities'); }
  async deactivateAllTradeConfigs(userId: string) { return this.primaryWrite(() => this.postgres!.deactivateAllTradeConfigs(userId), () => this.sqlite.deactivateAllTradeConfigs(userId), 'deactivateAllTradeConfigs'); }
  async reactivateTradeConfiguration(id: string) { return this.primaryWrite(() => this.postgres!.reactivateTradeConfiguration(id), () => this.sqlite.reactivateTradeConfiguration(id), 'reactivateTradeConfiguration'); }
  async deactivateTradeConfiguration(id: string) { return this.primaryWrite(() => this.postgres!.deactivateTradeConfiguration(id), () => this.sqlite.deactivateTradeConfiguration(id), 'deactivateTradeConfiguration'); }

  // 🔧 FIX CRÍTICO: Pré-gerar ID compartilhado entre Neon e SQLite.
  // Antes, cada banco gerava seu próprio ID (Neon: lowercase uuid, SQLite: uppercase hex),
  // impossibilitando o merge por ID → todas as ops ficavam como "pending" na UI.
  async createTradeOperation(op: InsertTradeOperation): Promise<TradeOperation> {
    const sharedId = randomBytes(16).toString('hex').toUpperCase();
    const opWithId = { ...op, id: sharedId } as any;
    if (!this.neonActive) {
      return await this.sqlite.createTradeOperation(opWithId);
    }
    try {
      const result = await this.postgres!.createTradeOperation(opWithId);
      this.resetFailures();
      // SQLite em background com o MESMO ID
      this.sqlite.createTradeOperation(opWithId).catch((err: any) =>
        console.warn('⚠️ [DUAL] SQLite sync falhou em createTradeOperation:', err.message)
      );
      return result;
    } catch (err: any) {
      this.handleNeonError(err, 'createTradeOperation');
      return await this.sqlite.createTradeOperation(opWithId);
    }
  }

  // 🔧 FIX: Merge inteligente Neon + SQLite com correspondência por ID e derivContractId.
  // Neon pode ter status "pending" para operações cujos updates falharam.
  // SQLite tem os resultados corretos (won/lost). O merge prefere SQLite
  // quando Neon ainda mostra "pending"/"active" mas SQLite tem status terminal.
  // Também usa derivContractId como fallback para operações criadas antes do fix de IDs.
  async getUserTradeOperations(userId: string, limit?: number) {
    if (!this.neonActive) {
      return await this.sqlite.getUserTradeOperations(userId, limit);
    }
    try {
      // Buscar mais registros do SQLite para garantir cobertura total no merge
      const fetchLimit = limit ? limit * 3 : 500;
      const [neonOps, sqliteOps] = await Promise.all([
        this.postgres!.getUserTradeOperations(userId, limit).catch(() => [] as TradeOperation[]),
        this.sqlite.getUserTradeOperations(userId, fetchLimit).catch(() => [] as TradeOperation[]),
      ]);

      const TERMINAL = new Set(['won', 'lost', 'sold', 'expired', 'closed']);

      // Indexar SQLite por ID e por derivContractId para merge duplo
      const sqliteById = new Map<string, TradeOperation>();
      const sqliteByContractId = new Map<string, TradeOperation>();
      for (const op of sqliteOps) {
        sqliteById.set(op.id, op);
        // Normalizar ID para comparação case-insensitive (fix para IDs gerados antes do patch)
        sqliteById.set(op.id.toLowerCase(), op);
        if (op.derivContractId) sqliteByContractId.set(String(op.derivContractId), op);
      }

      // Neon é a fonte principal de lista. Para cada op do Neon,
      // tentar encontrar correspondência no SQLite por ID (exato ou case-insensitive)
      // ou por derivContractId (fallback para ops antigas com IDs diferentes).
      const merged = neonOps.map(neonOp => {
        const sqliteOp =
          sqliteById.get(neonOp.id) ||
          sqliteById.get((neonOp.id || '').toLowerCase()) ||
          (neonOp.derivContractId ? sqliteByContractId.get(String(neonOp.derivContractId)) : undefined);

        if (!sqliteOp) return neonOp;

        const neonTerminal = TERMINAL.has(neonOp.status || '');
        const sqliteTerminal = TERMINAL.has(sqliteOp.status || '');

        if (!neonTerminal && sqliteTerminal) {
          // SQLite tem dado mais atualizado — mesclar campos de resultado
          return {
            ...neonOp,
            status: sqliteOp.status,
            profit: sqliteOp.profit ?? neonOp.profit,
            completedAt: sqliteOp.completedAt ?? neonOp.completedAt,
            exitPrice: sqliteOp.exitPrice ?? neonOp.exitPrice,
          };
        }
        return neonOp;
      });

      // Rastrear derivContractIds já incluídos para evitar duplicatas
      const includedContractIds = new Set<string>();
      for (const op of merged) {
        if (op.derivContractId) includedContractIds.add(String(op.derivContractId));
      }

      // Adicionar operações que existem APENAS no SQLite
      // (criadas durante falha do Neon, ou com IDs diferentes que não bateram)
      const neonIds = new Set(neonOps.map(o => o.id.toLowerCase()));
      for (const sqliteOp of sqliteOps) {
        const alreadyById = neonIds.has(sqliteOp.id.toLowerCase());
        const alreadyByContract = sqliteOp.derivContractId
          ? includedContractIds.has(String(sqliteOp.derivContractId))
          : false;
        if (!alreadyById && !alreadyByContract) {
          merged.push(sqliteOp);
          if (sqliteOp.derivContractId) includedContractIds.add(String(sqliteOp.derivContractId));
        }
      }

      // Ordenar por createdAt desc e aplicar limit
      merged.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      return limit ? merged.slice(0, limit) : merged;
    } catch (err: any) {
      this.handleNeonError(err, 'getUserTradeOperations');
      return await this.sqlite.getUserTradeOperations(userId, limit);
    }
  }

  async updateTradeOperation(id: string, updates: Partial<TradeOperation>) { return this.primaryWrite(() => this.postgres!.updateTradeOperation(id, updates), () => this.sqlite.updateTradeOperation(id, updates), 'updateTradeOperation'); }
  async getActiveTradeOperations(userId: string) { return this.primaryRead(() => this.postgres!.getActiveTradeOperations(userId), () => this.sqlite.getActiveTradeOperations(userId), 'getActiveTradeOperations'); }

  async createAiLog(log: InsertAiLog) { return this.sqlite.createAiLog(log); }
  async getUserAiLogs(userId: string, limit?: number) { return this.sqlite.getUserAiLogs(userId, limit); }
  async getLatestAiAnalysis(userId: string) { return this.sqlite.getLatestAiAnalysis(userId); }

  async upsertMarketData(data: InsertMarketData) { return this.sqlite.upsertMarketData(data); }
  async getMarketData(symbol: string) { return this.sqlite.getMarketData(symbol); }
  async getAllMarketData() { return this.sqlite.getAllMarketData(); }

  // 🔧 FIX: Usar SQLite para stats — Neon tem todas as operações como "pending"
  // (updates falhavam devido ao bug toISOString). SQLite tem os dados corretos.
  async getTradingStats(userId: string) { return this.sqlite.getTradingStats(userId); }
  async getActiveTradesCount(userId: string) { return this.primaryRead(() => this.postgres!.getActiveTradesCount(userId), () => this.sqlite.getActiveTradesCount(userId), 'getActiveTradesCount'); }
  async getDailyLossCount(userId: string, date: string) { return this.primaryRead(() => this.postgres!.getDailyLossCount(userId, date), () => this.sqlite.getDailyLossCount(userId, date), 'getDailyLossCount'); }
  async saveActiveTradeForTracking(tradeData: any) { return this.primaryWrite(() => this.postgres!.saveActiveTradeForTracking(tradeData), () => this.sqlite.saveActiveTradeForTracking(tradeData), 'saveActiveTradeForTracking'); }

  async createOrUpdateDailyPnL(userId: string, data: Partial<InsertDailyPnL>) { return this.primaryWrite(() => this.postgres!.createOrUpdateDailyPnL(userId, data), () => this.sqlite.createOrUpdateDailyPnL(userId, data), 'createOrUpdateDailyPnL'); }
  async getDailyPnL(userId: string, date?: string) { return this.primaryRead(() => this.postgres!.getDailyPnL(userId, date), () => this.sqlite.getDailyPnL(userId, date), 'getDailyPnL'); }
  async getConservativeOperationsToday(userId: string) { return this.primaryRead(() => this.postgres!.getConservativeOperationsToday(userId), () => this.sqlite.getConservativeOperationsToday(userId), 'getConservativeOperationsToday'); }
  async incrementConservativeOperations(userId: string) { return this.primaryWrite(() => this.postgres!.incrementConservativeOperations(userId), () => this.sqlite.incrementConservativeOperations(userId), 'incrementConservativeOperations'); }
  async getRecentDailyPnL(userId: string, days?: number) { return this.primaryRead(() => this.postgres!.getRecentDailyPnL(userId, days), () => this.sqlite.getRecentDailyPnL(userId, days), 'getRecentDailyPnL'); }

  async createAiRecoveryStrategy(s: InsertAiRecoveryStrategy) { return this.primaryWrite(() => this.postgres!.createUserRecoveryStrategy(s as any), () => this.sqlite.createAiRecoveryStrategy(s), 'createAiRecoveryStrategy'); }
  async getUserRecoveryStrategies(userId: string) { return this.primaryRead(() => this.postgres!.getUserRecoveryStrategies(userId), () => this.sqlite.getUserRecoveryStrategies(userId), 'getUserRecoveryStrategies'); }
  async updateRecoveryStrategy(id: string, updates: Partial<AiRecoveryStrategy>) { return this.primaryWrite(() => this.postgres!.updateRecoveryStrategy(id, updates as any), () => this.sqlite.updateRecoveryStrategy(id, updates), 'updateRecoveryStrategy'); }
  async calculateRecoveryMultiplier(userId: string) { return this.primaryRead(() => this.postgres!.calculateRecoveryMultiplier(userId), () => this.sqlite.calculateRecoveryMultiplier(userId), 'calculateRecoveryMultiplier'); }
  async shouldActivateRecovery(userId: string) { return this.primaryRead(() => this.postgres!.shouldActivateRecovery(userId), () => this.sqlite.shouldActivateRecovery(userId), 'shouldActivateRecovery'); }
  async getRecoveryThresholdRecommendation(userId: string) { return this.primaryRead(() => this.postgres!.getRecoveryThresholdRecommendation(userId), () => this.sqlite.getRecoveryThresholdRecommendation(userId), 'getRecoveryThresholdRecommendation'); }
  async canExecuteTradeWithoutViolatingMinimum(userId: string, potentialLoss: number) { return this.primaryRead(() => this.postgres!.canExecuteTradeWithoutViolatingMinimum(userId, potentialLoss), () => this.sqlite.canExecuteTradeWithoutViolatingMinimum(userId, potentialLoss), 'canExecuteTradeWithoutViolatingMinimum'); }
  async getMinimumBalanceRequired(userId: string) { return this.sqlite.getMinimumBalanceRequired(userId); }
  async getBalanceAnalysis(userId: string) { return this.sqlite.getBalanceAnalysis(userId); }

  async upsertActiveTradingSession(session: InsertActiveTradingSession) { return this.primaryWrite(() => this.postgres!.upsertActiveTradingSession(session), () => this.sqlite.upsertActiveTradingSession(session), 'upsertActiveTradingSession'); }
  async getActiveTradingSession(sessionKey: string) { return this.primaryRead(() => this.postgres!.getActiveTradingSession(sessionKey), () => this.sqlite.getActiveTradingSession(sessionKey), 'getActiveTradingSession'); }
  async getAllActiveTradingSessions() { return this.primaryRead(() => this.postgres!.getAllActiveTradingSessions(), () => this.sqlite.getAllActiveTradingSessions(), 'getAllActiveTradingSessions'); }
  async updateActiveTradingSession(sessionKey: string, updates: Partial<ActiveTradingSession>) { return this.primaryWrite(() => this.postgres!.updateActiveTradingSession(sessionKey, updates), () => this.sqlite.updateActiveTradingSession(sessionKey, updates), 'updateActiveTradingSession'); }
  async deactivateActiveTradingSession(sessionKey: string) { return this.primaryWrite(() => this.postgres!.deactivateActiveTradingSession(sessionKey), () => this.sqlite.deactivateActiveTradingSession(sessionKey), 'deactivateActiveTradingSession'); }
  async clearInactiveTradingSessions() { return this.primaryWrite(() => this.postgres!.clearInactiveTradingSessions(), () => this.sqlite.clearInactiveTradingSessions(), 'clearInactiveTradingSessions'); }

  async saveWebSocketSubscription(sub: InsertActiveWebSocketSubscription) { return this.primaryWrite(() => this.postgres!.saveWebSocketSubscription(sub), () => this.sqlite.saveWebSocketSubscription(sub), 'saveWebSocketSubscription'); }
  async getActiveWebSocketSubscriptions() { return this.primaryRead(() => this.postgres!.getActiveWebSocketSubscriptions(), () => this.sqlite.getActiveWebSocketSubscriptions(), 'getActiveWebSocketSubscriptions'); }
  async deactivateWebSocketSubscription(subscriptionId: string) { return this.primaryWrite(() => this.postgres!.deactivateWebSocketSubscription(subscriptionId), () => this.sqlite.deactivateWebSocketSubscription(subscriptionId), 'deactivateWebSocketSubscription'); }
  async clearAllWebSocketSubscriptions() { return this.primaryWrite(() => this.postgres!.clearAllWebSocketSubscriptions(), () => this.sqlite.clearAllWebSocketSubscriptions(), 'clearAllWebSocketSubscriptions'); }

  async updateSystemHeartbeat(componentName: string, status: string, metadata?: any, lastError?: string) { return this.sqlite.updateSystemHeartbeat(componentName, status, metadata, lastError); }
  async getSystemHeartbeat(componentName: string) { return this.sqlite.getSystemHeartbeat(componentName); }
  async getAllSystemHeartbeats() { return this.sqlite.getAllSystemHeartbeats(); }
  async incrementHeartbeatError(componentName: string, error: string) { return this.sqlite.incrementHeartbeatError(componentName, error); }
  async resetHeartbeatErrors(componentName: string) { return this.sqlite.resetHeartbeatErrors(componentName); }

  async getTradingControlStatus() { return this.primaryRead(() => this.postgres!.getTradingControlStatus(), () => this.sqlite.getTradingControlStatus(), 'getTradingControlStatus'); }
  async pauseTrading(pausedBy: string, reason: string) { return this.primaryWrite(() => this.postgres!.pauseTrading(pausedBy, reason), () => this.sqlite.pauseTrading(pausedBy, reason), 'pauseTrading'); }
  async resumeTrading() { return this.primaryWrite(() => this.postgres!.resumeTrading(), () => this.sqlite.resumeTrading(), 'resumeTrading'); }

  async createAssetBlacklist(blacklist: any) { return this.sqlite.createAssetBlacklist(blacklist); }
  async getUserAssetBlacklists(userId: string) { return this.sqlite.getUserAssetBlacklists(userId); }
  async deleteAssetBlacklist(id: string) { return this.sqlite.deleteAssetBlacklist(id); }
  async isAssetBlocked(userId: string, assetName: string) { return this.sqlite.isAssetBlocked(userId, assetName); }
  async isUserBlockedAsset(userId: string, symbol: string, tradeMode: string) { return this.sqlite.isUserBlockedAsset(userId, symbol, tradeMode); }

  async getUserPauseConfig(userId: string) { return this.sqlite.getUserPauseConfig(userId); }
  async createPauseConfig(config: any) { return this.sqlite.createPauseConfig(config); }
  async updatePauseConfig(userId: string, config: any) { return this.sqlite.updatePauseConfig(userId, config); }
  async updatePausedNowStatus(userId: string, isPausedNow: boolean) { return this.sqlite.updatePausedNowStatus(userId, isPausedNow); }

  async expireOldPendingTrades(olderThanMinutes: number = 5): Promise<number> {
    return this.sqlite.expireOldPendingTrades(olderThanMinutes);
  }

  async resetAllTradingData(userId: string): Promise<{ tablesCleared: string[]; rowsDeleted: number }> {
    return this.sqlite.resetAllTradingData(userId);
  }
}

export const dualStorage = new DualStorage();
