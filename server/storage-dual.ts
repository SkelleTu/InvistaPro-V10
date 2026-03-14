/**
 * DUAL DATABASE STORAGE - Turso (primário) + SQLite (fallback)
 *
 * Turso (libSQL cloud) é o banco principal - dados persistem 100% na nuvem.
 * SQLite local é fallback caso Turso esteja indisponível.
 */

import { DatabaseStorage } from "./storage";
import { TursoStorage } from "./storage-turso";
import { isTursoAvailable, initializeTursoDatabase } from "./db-turso";
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

export class DualStorage implements IStorage {
  private sqlite: DatabaseStorage;
  private turso: TursoStorage | null;
  private isDualMode: boolean;

  constructor() {
    this.sqlite = new DatabaseStorage();
    this.turso = isTursoAvailable ? new TursoStorage() : null;
    this.isDualMode = isTursoAvailable;

    if (this.isDualMode) {
      console.log('🚀 [TURSO] Sistema Dual Database ATIVO - Turso (primário) + SQLite (fallback)');
      console.log('🌐 [TURSO] Todos os dados serão persistidos no Turso cloud');
      initializeTursoDatabase().then(ok => {
        if (ok) console.log('✅ [TURSO] Tabelas inicializadas no Turso!');
        else console.error('❌ [TURSO] Falha ao inicializar tabelas');
      }).catch(err => console.error('❌ [TURSO] Erro na inicialização:', err.message));
    } else {
      console.warn('⚠️ [TURSO] Não disponível - usando apenas SQLite local');
      console.warn('   Configure TURSO_DATABASE_URL e TURSO_AUTH_TOKEN para ativar');
    }
  }

  private async primaryWrite<T>(tursoOp: () => Promise<T>, sqliteOp: () => Promise<T>, op: string): Promise<T> {
    if (!this.isDualMode || !this.turso) return await sqliteOp();
    try {
      const result = await tursoOp();
      sqliteOp().catch(err => console.warn(`⚠️ [DUAL] SQLite sync falhou em ${op}:`, err.message));
      return result;
    } catch (err: any) {
      console.error(`❌ [TURSO] Falha em ${op}:`, err.message, '- fallback SQLite');
      return await sqliteOp();
    }
  }

  private async primaryRead<T>(tursoOp: () => Promise<T>, sqliteOp: () => Promise<T>, op: string): Promise<T> {
    if (!this.isDualMode || !this.turso) return await sqliteOp();
    try {
      return await tursoOp();
    } catch (err: any) {
      console.warn(`⚠️ [TURSO] Leitura falhou em ${op}, fallback SQLite:`, err.message);
      return await sqliteOp();
    }
  }

  async getUser(id: string) { return this.primaryRead(() => this.turso!.getUser(id), () => this.sqlite.getUser(id), 'getUser'); }
  async getUserByEmail(email: string) { return this.primaryRead(() => this.turso!.getUserByEmail(email), () => this.sqlite.getUserByEmail(email), 'getUserByEmail'); }
  async getUserByCpf(cpf: string) { return this.primaryRead(() => this.turso!.getUserByCpf(cpf), () => this.sqlite.getUserByCpf(cpf), 'getUserByCpf'); }
  async getAllUsers() { return this.primaryRead(() => this.turso!.getAllUsers(), () => this.sqlite.getAllUsers(), 'getAllUsers'); }
  async createUser(user: InsertUser) { return this.primaryWrite(() => this.turso!.createUser(user), () => this.sqlite.createUser(user), 'createUser'); }
  async updateUser(id: string, data: UpdateUser) { return this.primaryWrite(() => this.turso!.updateUser(id, data), () => this.sqlite.updateUser(id, data), 'updateUser'); }
  async updateVerificationCode(userId: string, code: string, expiresAt: Date) { return this.primaryWrite(() => this.turso!.updateVerificationCode(userId, code, expiresAt), () => this.sqlite.updateVerificationCode(userId, code, expiresAt), 'updateVerificationCode'); }
  async verifyPhone(userId: string) { return this.primaryWrite(() => this.turso!.verifyPhone(userId), () => this.sqlite.verifyPhone(userId), 'verifyPhone'); }
  async approveAccount(userId: string, approvedBy: string) { return this.primaryWrite(() => this.turso!.approveAccount(userId, approvedBy), () => this.sqlite.approveAccount(userId, approvedBy), 'approveAccount'); }

  async createMovimento(m: InsertMovimento) { return this.primaryWrite(() => this.turso!.createMovimento(m), () => this.sqlite.createMovimento(m), 'createMovimento'); }
  async getUserMovimentos(userId: string, limit?: number) { return this.primaryRead(() => this.turso!.getUserMovimentos(userId, limit), () => this.sqlite.getUserMovimentos(userId, limit), 'getUserMovimentos'); }
  async calcularRendimento(saldo: number) { return this.sqlite.calcularRendimento(saldo); }

  async createDocumento(d: InsertDocumento) { return this.primaryWrite(() => this.turso!.createDocumento(d), () => this.sqlite.createDocumento(d), 'createDocumento'); }
  async getUserDocumentos(userId: string) { return this.primaryRead(() => this.turso!.getUserDocumentos(userId), () => this.sqlite.getUserDocumentos(userId), 'getUserDocumentos'); }
  async updateDocumentoStatus(id: string, status: string, motivo?: string) { return this.primaryWrite(() => this.turso!.updateDocumentoStatus(id, status, motivo), () => this.sqlite.updateDocumentoStatus(id, status, motivo), 'updateDocumentoStatus'); }

  async createDerivToken(t: InsertDerivToken) { return this.primaryWrite(() => this.turso!.createDerivToken(t), () => this.sqlite.createDerivToken(t), 'createDerivToken'); }

  async getUserDerivToken(userId: string): Promise<DerivToken | undefined> {
    if (!this.isDualMode || !this.turso) return await this.sqlite.getUserDerivToken(userId);
    try {
      const tursoResult = await this.turso.getUserDerivToken(userId);
      if (tursoResult) return tursoResult;

      // Turso returned nothing - check SQLite as fallback (data may not have synced)
      const sqliteResult = await this.sqlite.getUserDerivToken(userId);
      if (sqliteResult) {
        console.log(`🔄 [DUAL] Token encontrado no SQLite mas não no Turso para userId=${userId} - sincronizando...`);
        // Read-repair: sync the encrypted token from SQLite raw DB to Turso
        try {
          await this.turso.updateDerivToken(userId, sqliteResult.token, sqliteResult.accountType || 'demo');
          console.log(`✅ [DUAL] Token sincronizado SQLite→Turso para userId=${userId}`);
        } catch (syncErr: any) {
          console.warn(`⚠️ [DUAL] Falha ao sincronizar token para Turso:`, syncErr.message);
        }
        return sqliteResult;
      }
      return undefined;
    } catch (err: any) {
      console.warn(`⚠️ [TURSO] getUserDerivToken falhou, fallback SQLite:`, err.message);
      return await this.sqlite.getUserDerivToken(userId);
    }
  }

  async updateDerivToken(userId: string, token: string, accountType: string) {
    if (!this.isDualMode || !this.turso) return await this.sqlite.updateDerivToken(userId, token, accountType);
    try {
      const result = await this.turso.updateDerivToken(userId, token, accountType);
      // Sync to SQLite in background
      this.sqlite.updateDerivToken(userId, token, accountType).catch(err =>
        console.warn(`⚠️ [DUAL] SQLite sync falhou em updateDerivToken:`, err.message)
      );
      return result;
    } catch (err: any) {
      console.error(`❌ [TURSO] Falha em updateDerivToken:`, err.message, '- fallback SQLite');
      const result = await this.sqlite.updateDerivToken(userId, token, accountType);
      // Try to async repair Turso after SQLite save
      setTimeout(async () => {
        try {
          await this.turso!.updateDerivToken(userId, token, accountType);
          console.log(`✅ [DUAL] Token reparado no Turso após fallback SQLite para userId=${userId}`);
        } catch (repairErr: any) {
          console.warn(`⚠️ [DUAL] Reparo assíncrono do Turso falhou:`, repairErr.message);
        }
      }, 2000);
      return result;
    }
  }

  async deactivateDerivToken(userId: string) { return this.primaryWrite(() => this.turso!.deactivateDerivToken(userId), () => this.sqlite.deactivateDerivToken(userId), 'deactivateDerivToken'); }

  async createTradeConfig(c: InsertTradeConfiguration) { return this.primaryWrite(() => this.turso!.createTradeConfig(c), () => this.sqlite.createTradeConfig(c), 'createTradeConfig'); }
  async getUserTradeConfig(userId: string) { return this.primaryRead(() => this.turso!.getUserTradeConfig(userId), () => this.sqlite.getUserTradeConfig(userId), 'getUserTradeConfig'); }
  async getAllTradeConfigurations() { return this.primaryRead(() => this.turso!.getAllTradeConfigurations(), () => this.sqlite.getAllTradeConfigurations(), 'getAllTradeConfigurations'); }
  async getActiveTradeConfigurations() { return this.primaryRead(() => this.turso!.getActiveTradeConfigurations(), () => this.sqlite.getActiveTradeConfigurations(), 'getActiveTradeConfigurations'); }
  async updateTradeConfig(userId: string, mode: string) { return this.primaryWrite(() => this.turso!.updateTradeConfig(userId, mode), () => this.sqlite.updateTradeConfig(userId, mode), 'updateTradeConfig'); }
  async deactivateAllTradeConfigs(userId: string) { return this.primaryWrite(() => this.turso!.deactivateAllTradeConfigs(userId), () => this.sqlite.deactivateAllTradeConfigs(userId), 'deactivateAllTradeConfigs'); }
  async reactivateTradeConfiguration(id: string) { return this.primaryWrite(() => this.turso!.reactivateTradeConfiguration(id), () => this.sqlite.reactivateTradeConfiguration(id), 'reactivateTradeConfiguration'); }
  async deactivateTradeConfiguration(id: string) { return this.primaryWrite(() => this.turso!.deactivateTradeConfiguration(id), () => this.sqlite.deactivateTradeConfiguration(id), 'deactivateTradeConfiguration'); }

  async createTradeOperation(op: InsertTradeOperation) { return this.primaryWrite(() => this.turso!.createTradeOperation(op), () => this.sqlite.createTradeOperation(op), 'createTradeOperation'); }
  async getUserTradeOperations(userId: string, limit?: number) { return this.primaryRead(() => this.turso!.getUserTradeOperations(userId, limit), () => this.sqlite.getUserTradeOperations(userId, limit), 'getUserTradeOperations'); }
  async updateTradeOperation(id: string, updates: Partial<TradeOperation>) { return this.primaryWrite(() => this.turso!.updateTradeOperation(id, updates), () => this.sqlite.updateTradeOperation(id, updates), 'updateTradeOperation'); }
  async getActiveTradeOperations(userId: string) { return this.primaryRead(() => this.turso!.getActiveTradeOperations(userId), () => this.sqlite.getActiveTradeOperations(userId), 'getActiveTradeOperations'); }

  async createAiLog(log: InsertAiLog) { return this.primaryWrite(() => this.turso!.createAiLog(log), () => this.sqlite.createAiLog(log), 'createAiLog'); }
  async getUserAiLogs(userId: string, limit?: number) { return this.primaryRead(() => this.turso!.getUserAiLogs(userId, limit), () => this.sqlite.getUserAiLogs(userId, limit), 'getUserAiLogs'); }
  async getLatestAiAnalysis(userId: string) { return this.primaryRead(() => this.turso!.getLatestAiAnalysis(userId), () => this.sqlite.getLatestAiAnalysis(userId), 'getLatestAiAnalysis'); }

  async upsertMarketData(data: InsertMarketData) { return this.primaryWrite(() => this.turso!.upsertMarketData(data), () => this.sqlite.upsertMarketData(data), 'upsertMarketData'); }
  async getMarketData(symbol: string) { return this.primaryRead(() => this.turso!.getMarketData(symbol), () => this.sqlite.getMarketData(symbol), 'getMarketData'); }
  async getAllMarketData() { return this.primaryRead(() => this.turso!.getAllMarketData(), () => this.sqlite.getAllMarketData(), 'getAllMarketData'); }

  async getTradingStats(userId: string) { return this.primaryRead(() => this.turso!.getTradingStats(userId), () => this.sqlite.getTradingStats(userId), 'getTradingStats'); }
  async getActiveTradesCount(userId: string) { return this.primaryRead(() => this.turso!.getActiveTradesCount(userId), () => this.sqlite.getActiveTradesCount(userId), 'getActiveTradesCount'); }
  async getDailyLossCount(userId: string, date: string) { return this.primaryRead(() => this.turso!.getDailyLossCount(userId, date), () => this.sqlite.getDailyLossCount(userId, date), 'getDailyLossCount'); }
  async saveActiveTradeForTracking(tradeData: any) { return this.primaryWrite(() => this.turso!.saveActiveTradeForTracking(tradeData), () => this.sqlite.saveActiveTradeForTracking(tradeData), 'saveActiveTradeForTracking'); }

  async createOrUpdateDailyPnL(userId: string, data: Partial<InsertDailyPnL>) { return this.primaryWrite(() => this.turso!.createOrUpdateDailyPnL(userId, data), () => this.sqlite.createOrUpdateDailyPnL(userId, data), 'createOrUpdateDailyPnL'); }
  async getDailyPnL(userId: string, date?: string) { return this.primaryRead(() => this.turso!.getDailyPnL(userId, date), () => this.sqlite.getDailyPnL(userId, date), 'getDailyPnL'); }
  async getConservativeOperationsToday(userId: string) { return this.primaryRead(() => this.turso!.getConservativeOperationsToday(userId), () => this.sqlite.getConservativeOperationsToday(userId), 'getConservativeOperationsToday'); }
  async incrementConservativeOperations(userId: string) { return this.primaryWrite(() => this.turso!.incrementConservativeOperations(userId), () => this.sqlite.incrementConservativeOperations(userId), 'incrementConservativeOperations'); }
  async getRecentDailyPnL(userId: string, days?: number) { return this.primaryRead(() => this.turso!.getRecentDailyPnL(userId, days), () => this.sqlite.getRecentDailyPnL(userId, days), 'getRecentDailyPnL'); }

  async createAiRecoveryStrategy(s: InsertAiRecoveryStrategy) { return this.primaryWrite(() => this.turso!.createAiRecoveryStrategy(s), () => this.sqlite.createAiRecoveryStrategy(s), 'createAiRecoveryStrategy'); }
  async getUserRecoveryStrategies(userId: string) { return this.primaryRead(() => this.turso!.getUserRecoveryStrategies(userId), () => this.sqlite.getUserRecoveryStrategies(userId), 'getUserRecoveryStrategies'); }
  async updateRecoveryStrategy(id: string, updates: Partial<AiRecoveryStrategy>) { return this.primaryWrite(() => this.turso!.updateRecoveryStrategy(id, updates), () => this.sqlite.updateRecoveryStrategy(id, updates), 'updateRecoveryStrategy'); }
  async calculateRecoveryMultiplier(userId: string) { return this.primaryRead(() => this.turso!.calculateRecoveryMultiplier(userId), () => this.sqlite.calculateRecoveryMultiplier(userId), 'calculateRecoveryMultiplier'); }
  async shouldActivateRecovery(userId: string) { return this.primaryRead(() => this.turso!.shouldActivateRecovery(userId), () => this.sqlite.shouldActivateRecovery(userId), 'shouldActivateRecovery'); }
  async getRecoveryThresholdRecommendation(userId: string) { return this.primaryRead(() => this.turso!.getRecoveryThresholdRecommendation(userId), () => this.sqlite.getRecoveryThresholdRecommendation(userId), 'getRecoveryThresholdRecommendation'); }
  async canExecuteTradeWithoutViolatingMinimum(userId: string, potentialLoss: number) { return this.primaryRead(() => this.turso!.canExecuteTradeWithoutViolatingMinimum(userId, potentialLoss), () => this.sqlite.canExecuteTradeWithoutViolatingMinimum(userId, potentialLoss), 'canExecuteTradeWithoutViolatingMinimum'); }
  async getMinimumBalanceRequired(userId: string) { return this.primaryRead(() => this.turso!.getMinimumBalanceRequired(userId), () => this.sqlite.getMinimumBalanceRequired(userId), 'getMinimumBalanceRequired'); }
  async getBalanceAnalysis(userId: string) { return this.primaryRead(() => this.turso!.getBalanceAnalysis(userId), () => this.sqlite.getBalanceAnalysis(userId), 'getBalanceAnalysis'); }

  async upsertActiveTradingSession(session: InsertActiveTradingSession) { return this.primaryWrite(() => this.turso!.upsertActiveTradingSession(session), () => this.sqlite.upsertActiveTradingSession(session), 'upsertActiveTradingSession'); }
  async getActiveTradingSession(sessionKey: string) { return this.primaryRead(() => this.turso!.getActiveTradingSession(sessionKey), () => this.sqlite.getActiveTradingSession(sessionKey), 'getActiveTradingSession'); }
  async getAllActiveTradingSessions() { return this.primaryRead(() => this.turso!.getAllActiveTradingSessions(), () => this.sqlite.getAllActiveTradingSessions(), 'getAllActiveTradingSessions'); }
  async updateActiveTradingSession(sessionKey: string, updates: Partial<ActiveTradingSession>) { return this.primaryWrite(() => this.turso!.updateActiveTradingSession(sessionKey, updates), () => this.sqlite.updateActiveTradingSession(sessionKey, updates), 'updateActiveTradingSession'); }
  async deactivateActiveTradingSession(sessionKey: string) { return this.primaryWrite(() => this.turso!.deactivateActiveTradingSession(sessionKey), () => this.sqlite.deactivateActiveTradingSession(sessionKey), 'deactivateActiveTradingSession'); }
  async clearInactiveTradingSessions() { return this.primaryWrite(() => this.turso!.clearInactiveTradingSessions(), () => this.sqlite.clearInactiveTradingSessions(), 'clearInactiveTradingSessions'); }

  async saveWebSocketSubscription(sub: InsertActiveWebSocketSubscription) { return this.primaryWrite(() => this.turso!.saveWebSocketSubscription(sub), () => this.sqlite.saveWebSocketSubscription(sub), 'saveWebSocketSubscription'); }
  async getActiveWebSocketSubscriptions() { return this.primaryRead(() => this.turso!.getActiveWebSocketSubscriptions(), () => this.sqlite.getActiveWebSocketSubscriptions(), 'getActiveWebSocketSubscriptions'); }
  async deactivateWebSocketSubscription(subscriptionId: string) { return this.primaryWrite(() => this.turso!.deactivateWebSocketSubscription(subscriptionId), () => this.sqlite.deactivateWebSocketSubscription(subscriptionId), 'deactivateWebSocketSubscription'); }
  async clearAllWebSocketSubscriptions() { return this.primaryWrite(() => this.turso!.clearAllWebSocketSubscriptions(), () => this.sqlite.clearAllWebSocketSubscriptions(), 'clearAllWebSocketSubscriptions'); }

  async updateSystemHeartbeat(componentName: string, status: string, metadata?: any, lastError?: string) { return this.primaryWrite(() => this.turso!.updateSystemHeartbeat(componentName, status, metadata, lastError), () => this.sqlite.updateSystemHeartbeat(componentName, status, metadata, lastError), 'updateSystemHeartbeat'); }
  async getSystemHeartbeat(componentName: string) { return this.primaryRead(() => this.turso!.getSystemHeartbeat(componentName), () => this.sqlite.getSystemHeartbeat(componentName), 'getSystemHeartbeat'); }
  async getAllSystemHeartbeats() { return this.primaryRead(() => this.turso!.getAllSystemHeartbeats(), () => this.sqlite.getAllSystemHeartbeats(), 'getAllSystemHeartbeats'); }
  async incrementHeartbeatError(componentName: string, error: string) { return this.primaryWrite(() => this.turso!.incrementHeartbeatError(componentName, error), () => this.sqlite.incrementHeartbeatError(componentName, error), 'incrementHeartbeatError'); }
  async resetHeartbeatErrors(componentName: string) { return this.primaryWrite(() => this.turso!.resetHeartbeatErrors(componentName), () => this.sqlite.resetHeartbeatErrors(componentName), 'resetHeartbeatErrors'); }

  async getTradingControlStatus() { return this.primaryRead(() => this.turso!.getTradingControlStatus(), () => this.sqlite.getTradingControlStatus(), 'getTradingControlStatus'); }
  async pauseTrading(pausedBy: string, reason: string) { return this.primaryWrite(() => this.turso!.pauseTrading(pausedBy, reason), () => this.sqlite.pauseTrading(pausedBy, reason), 'pauseTrading'); }
  async resumeTrading() { return this.primaryWrite(() => this.turso!.resumeTrading(), () => this.sqlite.resumeTrading(), 'resumeTrading'); }

  async createAssetBlacklist(blacklist: any) { return this.primaryWrite(() => this.turso!.createAssetBlacklist(blacklist), () => this.sqlite.createAssetBlacklist(blacklist), 'createAssetBlacklist'); }
  async getUserAssetBlacklists(userId: string) { return this.primaryRead(() => this.turso!.getUserAssetBlacklists(userId), () => this.sqlite.getUserAssetBlacklists(userId), 'getUserAssetBlacklists'); }
  async deleteAssetBlacklist(id: string) { return this.primaryWrite(() => this.turso!.deleteAssetBlacklist(id), () => this.sqlite.deleteAssetBlacklist(id), 'deleteAssetBlacklist'); }
  async isAssetBlocked(userId: string, assetName: string) { return this.primaryRead(() => this.turso!.isAssetBlocked(userId, assetName), () => this.sqlite.isAssetBlocked(userId, assetName), 'isAssetBlocked'); }

  async getUserPauseConfig(userId: string) { return this.primaryRead(() => this.turso!.getUserPauseConfig(userId), () => this.sqlite.getUserPauseConfig(userId), 'getUserPauseConfig'); }
  async createPauseConfig(config: any) { return this.primaryWrite(() => this.turso!.createPauseConfig(config), () => this.sqlite.createPauseConfig(config), 'createPauseConfig'); }
  async updatePauseConfig(userId: string, config: any) { return this.primaryWrite(() => this.turso!.updatePauseConfig(userId, config), () => this.sqlite.updatePauseConfig(userId, config), 'updatePauseConfig'); }
  async updatePausedNowStatus(userId: string, isPausedNow: boolean) { return this.primaryWrite(() => this.turso!.updatePausedNowStatus(userId, isPausedNow), () => this.sqlite.updatePausedNowStatus(userId, isPausedNow), 'updatePausedNowStatus'); }
}

export const dualStorage = new DualStorage();
