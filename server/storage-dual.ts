/**
 * STORAGE COOPERATIVO — Neon (leitura) + Turso (escrita) + SQLite (fallback)
 *
 * Leituras: Neon PostgreSQL → Turso → SQLite
 * Escritas: Turso (primário) + SQLite (sync background) — Neon NÃO recebe escritas
 *
 * Isso preserva a cota de transferência do Neon (que conta por escrita/leitura),
 * usando Turso como banco de escrita confiável e Neon apenas para leituras históricas.
 */

import { randomBytes } from "crypto";
import { DatabaseStorage } from "./storage";
import { PostgresStorage } from "./storage-postgres";
import { TursoStorage } from "./storage-turso";
import { isPostgresAvailable } from "./db-postgres";
import { isTursoAvailable } from "./db-turso";
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
  private turso: TursoStorage | null;
  private neon: PostgresStorage | null;

  // Circuit breaker para leituras do Neon
  private neonReadDisabled: boolean = false;
  private neonReadFailures: number = 0;
  private readonly MAX_NEON_READ_FAILURES = 3;

  constructor() {
    this.sqlite = new DatabaseStorage();
    this.turso = isTursoAvailable ? new TursoStorage() : null;
    this.neon = isPostgresAvailable ? new PostgresStorage() : null;
    this.neonReadDisabled = false;

    if (this.turso) {
      console.log('✅ [STORAGE] Turso ATIVO como banco de escrita principal');
    } else {
      console.warn('⚠️ [STORAGE] Turso não disponível — usando SQLite para escritas');
    }

    if (this.neon) {
      console.log('🔍 [STORAGE] Neon disponível para leituras (somente leitura — cota preservada)');
    } else {
      console.warn('⚠️ [STORAGE] Neon não disponível para leituras');
    }
  }

  // ─── Circuit breaker para leituras do Neon ───────────────────────────────

  private get neonReadActive(): boolean {
    return !this.neonReadDisabled && this.neon !== null;
  }

  private disableNeonRead(reason: string): void {
    if (!this.neonReadDisabled) {
      this.neonReadDisabled = true;
      console.warn(`🔌 [NEON] Circuit breaker de leitura ATIVADO — leituras redirecionadas para Turso.`);
      console.warn(`   Motivo: ${reason}`);
    }
  }

  private handleNeonReadError(err: any, op: string): void {
    const msg = err?.message || String(err);
    if (isQuotaError(msg)) {
      this.disableNeonRead(`Cota excedida em leitura (${op})`);
      return;
    }
    this.neonReadFailures++;
    if (this.neonReadFailures >= this.MAX_NEON_READ_FAILURES) {
      this.disableNeonRead(`${this.MAX_NEON_READ_FAILURES} falhas consecutivas de leitura (última: ${op})`);
    }
  }

  private resetNeonReadFailures(): void {
    this.neonReadFailures = 0;
  }

  // ─── Helpers principais ──────────────────────────────────────────────────

  /** Escritas: Turso (primário) + SQLite (sync background). Neon nunca recebe escritas. */
  private async write<T>(tursoOp: () => Promise<T>, sqliteOp: () => Promise<T>, op: string): Promise<T> {
    if (this.turso) {
      try {
        const result = await tursoOp();
        sqliteOp().catch(err => console.warn(`⚠️ [SQLITE SYNC] ${op}:`, err.message));
        return result;
      } catch (err: any) {
        console.warn(`⚠️ [TURSO] Falha em ${op}, fallback SQLite:`, err.message);
        return await sqliteOp();
      }
    }
    return await sqliteOp();
  }

  /** Leituras: tenta Neon → Turso → SQLite */
  private async read<T>(neonOp: (() => Promise<T>) | null, tursoOp: () => Promise<T>, sqliteOp: () => Promise<T>, op: string): Promise<T> {
    // Tentar Neon se disponível e circuit breaker aberto
    if (neonOp && this.neonReadActive) {
      try {
        const result = await neonOp();
        this.resetNeonReadFailures();
        return result;
      } catch (err: any) {
        this.handleNeonReadError(err, op);
        // Cai para Turso
      }
    }

    // Turso como segundo na cadeia
    if (this.turso) {
      try {
        return await tursoOp();
      } catch (err: any) {
        // Cai para SQLite
      }
    }

    return await sqliteOp();
  }

  // ─── Usuários ─────────────────────────────────────────────────────────────

  async getUser(id: string) {
    return this.read(
      this.neon ? () => this.neon!.getUser(id) : null,
      () => this.turso!.getUser(id),
      () => this.sqlite.getUser(id),
      'getUser'
    );
  }

  async getUserByEmail(email: string) {
    return this.read(
      this.neon ? () => this.neon!.getUserByEmail(email) : null,
      () => this.turso!.getUserByEmail(email),
      () => this.sqlite.getUserByEmail(email),
      'getUserByEmail'
    );
  }

  async getUserByCpf(cpf: string) {
    return this.read(
      this.neon ? () => this.neon!.getUserByCpf(cpf) : null,
      () => this.turso!.getUserByCpf(cpf),
      () => this.sqlite.getUserByCpf(cpf),
      'getUserByCpf'
    );
  }

  async getAllUsers() {
    if (this.turso) {
      try {
        const r = await this.turso.getAllUsers();
        if (r.length > 0) return r;
      } catch {}
    }
    if (this.neonReadActive) {
      try {
        const r = await this.neon!.getAllUsers();
        this.resetNeonReadFailures();
        if (r.length > 0) return r;
      } catch (err: any) { this.handleNeonReadError(err, 'getAllUsers'); }
    }
    return this.sqlite.getAllUsers();
  }

  async createUser(user: InsertUser) { return this.write(() => this.turso!.createUser(user), () => this.sqlite.createUser(user), 'createUser'); }
  async updateUser(id: string, data: UpdateUser) { return this.write(() => this.turso!.updateUser(id, data), () => this.sqlite.updateUser(id, data), 'updateUser'); }
  async updateVerificationCode(userId: string, code: string, expiresAt: Date) { return this.write(() => this.turso!.updateVerificationCode(userId, code, expiresAt), () => this.sqlite.updateVerificationCode(userId, code, expiresAt), 'updateVerificationCode'); }
  async verifyPhone(userId: string) { return this.write(() => this.turso!.verifyPhone(userId), () => this.sqlite.verifyPhone(userId), 'verifyPhone'); }
  async approveAccount(userId: string, approvedBy: string) { return this.write(() => this.turso!.approveAccount(userId, approvedBy), () => this.sqlite.approveAccount(userId, approvedBy), 'approveAccount'); }

  // ─── Movimentos ───────────────────────────────────────────────────────────

  async createMovimento(m: InsertMovimento) { return this.write(() => this.turso!.createMovimento(m), () => this.sqlite.createMovimento(m), 'createMovimento'); }
  async getUserMovimentos(userId: string, limit?: number) {
    return this.read(
      null,
      () => this.turso!.getUserMovimentos(userId, limit),
      () => this.sqlite.getUserMovimentos(userId, limit),
      'getUserMovimentos'
    );
  }
  async calcularRendimento(saldo: number) { return this.sqlite.calcularRendimento(saldo); }

  // ─── Documentos ───────────────────────────────────────────────────────────

  async createDocumento(d: InsertDocumento) { return this.write(() => this.turso!.createDocumento(d), () => this.sqlite.createDocumento(d), 'createDocumento'); }
  async getUserDocumentos(userId: string) {
    return this.read(
      null,
      () => this.turso!.getUserDocumentos(userId),
      () => this.sqlite.getUserDocumentos(userId),
      'getUserDocumentos'
    );
  }
  async updateDocumentoStatus(id: string, status: string, motivo?: string) { return this.write(() => this.turso!.updateDocumentoStatus(id, status, motivo), () => this.sqlite.updateDocumentoStatus(id, status, motivo), 'updateDocumentoStatus'); }

  // ─── Tokens Deriv ─────────────────────────────────────────────────────────

  async createDerivToken(t: InsertDerivToken) { return this.write(() => this.turso!.createDerivToken(t), () => this.sqlite.createDerivToken(t), 'createDerivToken'); }

  async getUserDerivToken(userId: string): Promise<DerivToken | undefined> {
    // Turso é fonte principal para tokens (dados recentes)
    if (this.turso) {
      try {
        const r = await this.turso.getUserDerivToken(userId);
        if (r) return r;
      } catch {}
    }
    // Tentar Neon como fallback de leitura
    if (this.neonReadActive) {
      try {
        const r = await this.neon!.getUserDerivToken(userId);
        this.resetNeonReadFailures();
        if (r) return r;
      } catch (err: any) { this.handleNeonReadError(err, 'getUserDerivToken'); }
    }
    return this.sqlite.getUserDerivToken(userId);
  }

  async updateDerivToken(userId: string, token: string, accountType: string) { return this.write(() => this.turso!.updateDerivToken(userId, token, accountType), () => this.sqlite.updateDerivToken(userId, token, accountType), 'updateDerivToken'); }
  async deactivateDerivToken(userId: string) { return this.write(() => this.turso!.deactivateDerivToken(userId), () => this.sqlite.deactivateDerivToken(userId), 'deactivateDerivToken'); }

  // ─── Configurações de Trade ───────────────────────────────────────────────

  async createTradeConfig(c: InsertTradeConfiguration) { return this.write(() => this.turso!.createTradeConfig(c), () => this.sqlite.createTradeConfig(c), 'createTradeConfig'); }

  async getUserTradeConfig(userId: string): Promise<TradeConfiguration | undefined> {
    if (this.turso) {
      try {
        const r = await this.turso.getUserTradeConfig(userId);
        if (r) return r;
      } catch {}
    }
    if (this.neonReadActive) {
      try {
        const r = await this.neon!.getUserTradeConfig(userId);
        this.resetNeonReadFailures();
        if (r) return r;
      } catch (err: any) { this.handleNeonReadError(err, 'getUserTradeConfig'); }
    }
    return this.sqlite.getUserTradeConfig(userId);
  }

  async getAllTradeConfigurations(): Promise<TradeConfiguration[]> {
    if (this.turso) {
      try {
        const r = await this.turso.getAllTradeConfigurations();
        if (r.length > 0) return r;
      } catch {}
    }
    if (this.neonReadActive) {
      try {
        const r = await this.neon!.getAllTradeConfigurations();
        this.resetNeonReadFailures();
        if (r.length > 0) return r;
      } catch (err: any) { this.handleNeonReadError(err, 'getAllTradeConfigurations'); }
    }
    return this.sqlite.getAllTradeConfigurations();
  }

  async getActiveTradeConfigurations(): Promise<TradeConfiguration[]> {
    if (this.turso) {
      try {
        const r = await this.turso.getActiveTradeConfigurations();
        if (r.length > 0) return r;
      } catch {}
    }
    if (this.neonReadActive) {
      try {
        const r = await this.neon!.getActiveTradeConfigurations();
        this.resetNeonReadFailures();
        if (r.length > 0) return r;
      } catch (err: any) { this.handleNeonReadError(err, 'getActiveTradeConfigurations'); }
    }
    return this.sqlite.getActiveTradeConfigurations();
  }

  async updateTradeConfig(userId: string, mode: string) { return this.write(() => this.turso!.updateTradeConfig(userId, mode), () => this.sqlite.updateTradeConfig(userId, mode), 'updateTradeConfig'); }
  async updateSelectedModalities(userId: string, modalities: string[]) { return this.write(() => this.turso!.updateSelectedModalities(userId, modalities), () => this.sqlite.updateSelectedModalities(userId, modalities), 'updateSelectedModalities'); }
  async deactivateAllTradeConfigs(userId: string) { return this.write(() => this.turso!.deactivateAllTradeConfigs(userId), () => this.sqlite.deactivateAllTradeConfigs(userId), 'deactivateAllTradeConfigs'); }
  async reactivateTradeConfiguration(id: string) { return this.write(() => this.turso!.reactivateTradeConfiguration(id), () => this.sqlite.reactivateTradeConfiguration(id), 'reactivateTradeConfiguration'); }
  async deactivateTradeConfiguration(id: string) { return this.write(() => this.turso!.deactivateTradeConfiguration(id), () => this.sqlite.deactivateTradeConfiguration(id), 'deactivateTradeConfiguration'); }

  // ─── Operações de Trade ───────────────────────────────────────────────────

  async createTradeOperation(op: InsertTradeOperation): Promise<TradeOperation> {
    const sharedId = randomBytes(16).toString('hex').toUpperCase();
    const opWithId = { ...op, id: sharedId } as any;

    if (this.turso) {
      try {
        const result = await this.turso.createTradeOperation(opWithId);
        this.sqlite.createTradeOperation(opWithId).catch((err: any) =>
          console.warn('⚠️ [SQLITE SYNC] createTradeOperation:', err.message)
        );
        return result;
      } catch (err: any) {
        console.warn('⚠️ [TURSO] createTradeOperation falhou, fallback SQLite:', err.message);
        return await this.sqlite.createTradeOperation(opWithId);
      }
    }
    return await this.sqlite.createTradeOperation(opWithId);
  }

  async getUserTradeOperations(userId: string, limit?: number) {
    // Turso é a fonte de verdade para operações (todas as escritas vão para lá)
    if (this.turso) {
      try {
        const tursoOps = await this.turso.getUserTradeOperations(userId, limit);

        // Enriquecer com operações que possam existir apenas no SQLite (criadas antes do Turso)
        const sqliteOps = await this.sqlite.getUserTradeOperations(userId, limit ? limit * 2 : 500).catch(() => [] as TradeOperation[]);

        if (sqliteOps.length === 0) return tursoOps;

        const tursoIds = new Set(tursoOps.map(o => o.id.toLowerCase()));
        const tursoContractIds = new Set(tursoOps.filter(o => o.derivContractId).map(o => String(o.derivContractId)));

        for (const sqliteOp of sqliteOps) {
          const byId = tursoIds.has(sqliteOp.id.toLowerCase());
          const byContract = sqliteOp.derivContractId ? tursoContractIds.has(String(sqliteOp.derivContractId)) : false;
          if (!byId && !byContract) tursoOps.push(sqliteOp);
        }

        tursoOps.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        return limit ? tursoOps.slice(0, limit) : tursoOps;
      } catch {}
    }
    return await this.sqlite.getUserTradeOperations(userId, limit);
  }

  async updateTradeOperation(id: string, updates: Partial<TradeOperation>) { return this.write(() => this.turso!.updateTradeOperation(id, updates), () => this.sqlite.updateTradeOperation(id, updates), 'updateTradeOperation'); }
  async getActiveTradeOperations(userId: string) {
    return this.read(null, () => this.turso!.getActiveTradeOperations(userId), () => this.sqlite.getActiveTradeOperations(userId), 'getActiveTradeOperations');
  }

  // ─── Logs de IA ───────────────────────────────────────────────────────────

  async createAiLog(log: InsertAiLog) { return this.sqlite.createAiLog(log); }
  async getUserAiLogs(userId: string, limit?: number) { return this.sqlite.getUserAiLogs(userId, limit); }
  async getLatestAiAnalysis(userId: string) { return this.sqlite.getLatestAiAnalysis(userId); }

  // ─── Dados de Mercado ─────────────────────────────────────────────────────

  async upsertMarketData(data: InsertMarketData) { return this.sqlite.upsertMarketData(data); }
  async getMarketData(symbol: string) { return this.sqlite.getMarketData(symbol); }
  async getAllMarketData() { return this.sqlite.getAllMarketData(); }

  // ─── Estatísticas de Trading ──────────────────────────────────────────────

  async getTradingStats(userId: string) { return this.sqlite.getTradingStats(userId); }
  async getActiveTradesCount(userId: string) {
    return this.read(null, () => this.turso!.getActiveTradesCount(userId), () => this.sqlite.getActiveTradesCount(userId), 'getActiveTradesCount');
  }
  async getDailyLossCount(userId: string, date: string) {
    return this.read(null, () => this.turso!.getDailyLossCount(userId, date), () => this.sqlite.getDailyLossCount(userId, date), 'getDailyLossCount');
  }
  async saveActiveTradeForTracking(tradeData: any) { return this.write(() => this.turso!.saveActiveTradeForTracking(tradeData), () => this.sqlite.saveActiveTradeForTracking(tradeData), 'saveActiveTradeForTracking'); }

  // ─── PnL Diário ───────────────────────────────────────────────────────────

  async createOrUpdateDailyPnL(userId: string, data: Partial<InsertDailyPnL>) { return this.write(() => this.turso!.createOrUpdateDailyPnL(userId, data), () => this.sqlite.createOrUpdateDailyPnL(userId, data), 'createOrUpdateDailyPnL'); }
  async getDailyPnL(userId: string, date?: string) {
    return this.read(null, () => this.turso!.getDailyPnL(userId, date), () => this.sqlite.getDailyPnL(userId, date), 'getDailyPnL');
  }
  async getConservativeOperationsToday(userId: string) {
    return this.read(null, () => this.turso!.getConservativeOperationsToday(userId), () => this.sqlite.getConservativeOperationsToday(userId), 'getConservativeOperationsToday');
  }
  async incrementConservativeOperations(userId: string) { return this.write(() => this.turso!.incrementConservativeOperations(userId), () => this.sqlite.incrementConservativeOperations(userId), 'incrementConservativeOperations'); }
  async getRecentDailyPnL(userId: string, days?: number) {
    return this.read(null, () => this.turso!.getRecentDailyPnL(userId, days), () => this.sqlite.getRecentDailyPnL(userId, days), 'getRecentDailyPnL');
  }

  // ─── Estratégias de Recuperação ───────────────────────────────────────────

  async createAiRecoveryStrategy(s: InsertAiRecoveryStrategy) { return this.write(() => this.turso!.createAiRecoveryStrategy(s), () => this.sqlite.createAiRecoveryStrategy(s), 'createAiRecoveryStrategy'); }
  async getUserRecoveryStrategies(userId: string) {
    return this.read(null, () => this.turso!.getUserRecoveryStrategies(userId), () => this.sqlite.getUserRecoveryStrategies(userId), 'getUserRecoveryStrategies');
  }
  async updateRecoveryStrategy(id: string, updates: Partial<AiRecoveryStrategy>) { return this.write(() => this.turso!.updateRecoveryStrategy(id, updates), () => this.sqlite.updateRecoveryStrategy(id, updates), 'updateRecoveryStrategy'); }
  async calculateRecoveryMultiplier(userId: string) {
    return this.read(null, () => this.turso!.calculateRecoveryMultiplier(userId), () => this.sqlite.calculateRecoveryMultiplier(userId), 'calculateRecoveryMultiplier');
  }
  async shouldActivateRecovery(userId: string) {
    return this.read(null, () => this.turso!.shouldActivateRecovery(userId), () => this.sqlite.shouldActivateRecovery(userId), 'shouldActivateRecovery');
  }
  async getRecoveryThresholdRecommendation(userId: string) {
    return this.read(null, () => this.turso!.getRecoveryThresholdRecommendation(userId), () => this.sqlite.getRecoveryThresholdRecommendation(userId), 'getRecoveryThresholdRecommendation');
  }
  async canExecuteTradeWithoutViolatingMinimum(userId: string, potentialLoss: number) {
    return this.read(null, () => this.turso!.canExecuteTradeWithoutViolatingMinimum(userId, potentialLoss), () => this.sqlite.canExecuteTradeWithoutViolatingMinimum(userId, potentialLoss), 'canExecuteTradeWithoutViolatingMinimum');
  }
  async getMinimumBalanceRequired(userId: string) { return this.sqlite.getMinimumBalanceRequired(userId); }
  async getBalanceAnalysis(userId: string) { return this.sqlite.getBalanceAnalysis(userId); }

  // ─── Sessões de Trading Ativas ────────────────────────────────────────────

  async upsertActiveTradingSession(session: InsertActiveTradingSession) { return this.write(() => this.turso!.upsertActiveTradingSession(session), () => this.sqlite.upsertActiveTradingSession(session), 'upsertActiveTradingSession'); }
  async getActiveTradingSession(sessionKey: string) {
    return this.read(null, () => this.turso!.getActiveTradingSession(sessionKey), () => this.sqlite.getActiveTradingSession(sessionKey), 'getActiveTradingSession');
  }
  async getAllActiveTradingSessions() {
    return this.read(null, () => this.turso!.getAllActiveTradingSessions(), () => this.sqlite.getAllActiveTradingSessions(), 'getAllActiveTradingSessions');
  }
  async updateActiveTradingSession(sessionKey: string, updates: Partial<ActiveTradingSession>) { return this.write(() => this.turso!.updateActiveTradingSession(sessionKey, updates), () => this.sqlite.updateActiveTradingSession(sessionKey, updates), 'updateActiveTradingSession'); }
  async deactivateActiveTradingSession(sessionKey: string) { return this.write(() => this.turso!.deactivateActiveTradingSession(sessionKey), () => this.sqlite.deactivateActiveTradingSession(sessionKey), 'deactivateActiveTradingSession'); }
  async clearInactiveTradingSessions() { return this.write(() => this.turso!.clearInactiveTradingSessions(), () => this.sqlite.clearInactiveTradingSessions(), 'clearInactiveTradingSessions'); }

  // ─── Subscriptions WebSocket ──────────────────────────────────────────────

  async saveWebSocketSubscription(sub: InsertActiveWebSocketSubscription) { return this.write(() => this.turso!.saveWebSocketSubscription(sub), () => this.sqlite.saveWebSocketSubscription(sub), 'saveWebSocketSubscription'); }
  async getActiveWebSocketSubscriptions() {
    return this.read(null, () => this.turso!.getActiveWebSocketSubscriptions(), () => this.sqlite.getActiveWebSocketSubscriptions(), 'getActiveWebSocketSubscriptions');
  }
  async deactivateWebSocketSubscription(subscriptionId: string) { return this.write(() => this.turso!.deactivateWebSocketSubscription(subscriptionId), () => this.sqlite.deactivateWebSocketSubscription(subscriptionId), 'deactivateWebSocketSubscription'); }
  async clearAllWebSocketSubscriptions() { return this.write(() => this.turso!.clearAllWebSocketSubscriptions(), () => this.sqlite.clearAllWebSocketSubscriptions(), 'clearAllWebSocketSubscriptions'); }

  // ─── Health Heartbeat (sempre SQLite — dados locais) ─────────────────────

  async updateSystemHeartbeat(componentName: string, status: string, metadata?: any, lastError?: string) { return this.sqlite.updateSystemHeartbeat(componentName, status, metadata, lastError); }
  async getSystemHeartbeat(componentName: string) { return this.sqlite.getSystemHeartbeat(componentName); }
  async getAllSystemHeartbeats() { return this.sqlite.getAllSystemHeartbeats(); }
  async incrementHeartbeatError(componentName: string, error: string) { return this.sqlite.incrementHeartbeatError(componentName, error); }
  async resetHeartbeatErrors(componentName: string) { return this.sqlite.resetHeartbeatErrors(componentName); }

  // ─── Controle de Trading (pause/resume — Turso para compartilhar entre sessões) ─

  async getTradingControlStatus() {
    return this.read(
      this.neon ? () => this.neon!.getTradingControlStatus() : null,
      () => this.turso!.getTradingControlStatus(),
      () => this.sqlite.getTradingControlStatus(),
      'getTradingControlStatus'
    );
  }
  async pauseTrading(pausedBy: string, reason: string) { return this.write(() => this.turso!.pauseTrading(pausedBy, reason), () => this.sqlite.pauseTrading(pausedBy, reason), 'pauseTrading'); }
  async resumeTrading() { return this.write(() => this.turso!.resumeTrading(), () => this.sqlite.resumeTrading(), 'resumeTrading'); }

  // ─── Blacklist / Ativos Bloqueados (SQLite local) ─────────────────────────

  async createAssetBlacklist(blacklist: any) { return this.sqlite.createAssetBlacklist(blacklist); }
  async getUserAssetBlacklists(userId: string) { return this.sqlite.getUserAssetBlacklists(userId); }
  async deleteAssetBlacklist(id: string) { return this.sqlite.deleteAssetBlacklist(id); }
  async isAssetBlocked(userId: string, assetName: string) { return this.sqlite.isAssetBlocked(userId, assetName); }
  async isUserBlockedAsset(userId: string, symbol: string, tradeMode: string) { return this.sqlite.isUserBlockedAsset(userId, symbol, tradeMode); }

  // ─── Configuração de Pausa (SQLite local) ────────────────────────────────

  async getUserPauseConfig(userId: string) { return this.sqlite.getUserPauseConfig(userId); }
  async createPauseConfig(config: any) { return this.sqlite.createPauseConfig(config); }
  async updatePauseConfig(userId: string, config: any) { return this.sqlite.updatePauseConfig(userId, config); }
  async updatePausedNowStatus(userId: string, isPausedNow: boolean) { return this.sqlite.updatePausedNowStatus(userId, isPausedNow); }

  // ─── Utilitários ─────────────────────────────────────────────────────────

  async expireOldPendingTrades(olderThanMinutes: number = 5): Promise<number> {
    return this.sqlite.expireOldPendingTrades(olderThanMinutes);
  }

  async resetAllTradingData(userId: string): Promise<{ tablesCleared: string[]; rowsDeleted: number }> {
    if (this.turso) {
      try {
        const r = await this.turso.resetAllTradingData(userId);
        this.sqlite.resetAllTradingData(userId).catch(() => {});
        return r;
      } catch {}
    }
    return this.sqlite.resetAllTradingData(userId);
  }
}

export const dualStorage = new DualStorage();
