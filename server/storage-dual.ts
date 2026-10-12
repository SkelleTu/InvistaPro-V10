/**
 * STORAGE COOPERATIVO
 *
 * ESCRITAS : Turso (primário) + SQLite (sync background) — Neon NÃO recebe escritas
 * LEITURAS críticas/raras    : Neon (circuit breaker) → Turso → SQLite
 * LEITURAS alta frequência   : SQLite (primário, já sincronizado) → Turso (fallback)
 *
 * ESTRATÉGIA DE PRESERVAÇÃO DE COTA:
 *  - Dados efêmeros (market data, heartbeat, ws subs, ai logs) → SQLite only
 *  - Leituras de alta frequência (controle, sessões ativas) → SQLite first
 *  - Escritas importantes (users, trades, movimentos) → Turso + SQLite sync
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

const QUOTA_ERRORS = ['exceeded the data transfer quota', 'data transfer quota', 'upgrade your plan', 'reads are blocked', 'SQL read operations are forbidden'];

function isQuotaOrBlockError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return QUOTA_ERRORS.some(p => lower.includes(p.toLowerCase()));
}

export class DualStorage implements IStorage {
  private sqlite: DatabaseStorage;
  private turso: TursoStorage | null;
  private neon: PostgresStorage | null;

  private neonDisabled = false;
  private neonFailCount = 0;
  private readonly MAX_NEON_FAILS = 3;

  // Circuit breaker para o Turso (preservar cota)
  private tursoReadDisabled = false;
  private tursoReadFailCount = 0;
  private readonly MAX_TURSO_READ_FAILS = 5;

  constructor() {
    this.sqlite = new DatabaseStorage();
    // Turso is intentionally disabled: this deployment uses only Neon + SQLite.
    this.turso = null;
    this.neon = isPostgresAvailable ? new PostgresStorage() : null;

    console.log('🗄️ [STORAGE] SQLite local ativo para cache, dados transitórios e diagnósticos.');
    if (this.neon) {
      console.log('☁️ [STORAGE] Neon ativo como fonte durável dos dados essenciais.');
    } else {
      console.error('❌ [STORAGE] Neon indisponível: gravações essenciais serão recusadas para evitar perda silenciosa.');
    }
  }

  // ─── Circuit breaker do Neon ──────────────────────────────────────────────

  private get neonOk(): boolean { return !this.neonDisabled && this.neon !== null; }

  private onNeonError(err: any, op: string): void {
    const msg = err?.message || String(err);
    if (isQuotaOrBlockError(msg)) {
      if (!this.neonDisabled) {
        this.neonDisabled = true;
        console.warn(`🔌 [NEON] Circuit breaker ATIVADO — leituras redirecionadas para SQLite/Turso.`);
        console.warn(`   Motivo: cota/bloqueio detectado em "${op}"`);
      }
      return;
    }
    this.neonFailCount++;
    if (this.neonFailCount >= this.MAX_NEON_FAILS && !this.neonDisabled) {
      this.neonDisabled = true;
      console.warn(`🔌 [NEON] Circuit breaker ATIVADO após ${this.MAX_NEON_FAILS} falhas (última: ${op})`);
    }
  }

  private neonOk_reset(): void { this.neonFailCount = 0; }

  // ─── Circuit breaker do Turso (leituras) ─────────────────────────────────

  private get tursoReadOk(): boolean { return !this.tursoReadDisabled && this.turso !== null; }

  private onTursoReadError(err: any, op: string): void {
    const msg = err?.message || String(err);
    if (isQuotaOrBlockError(msg)) {
      if (!this.tursoReadDisabled) {
        this.tursoReadDisabled = true;
        console.warn(`🔌 [TURSO] Circuit breaker de LEITURAS ATIVADO — redirecionando para SQLite.`);
        console.warn(`   Motivo: cota/bloqueio detectado em "${op}"`);
      }
      return;
    }
    this.tursoReadFailCount++;
    if (this.tursoReadFailCount >= this.MAX_TURSO_READ_FAILS && !this.tursoReadDisabled) {
      this.tursoReadDisabled = true;
      console.warn(`🔌 [TURSO] Circuit breaker de LEITURAS ATIVADO após ${this.MAX_TURSO_READ_FAILS} falhas (última: ${op})`);
    }
  }

  // ─── Primitivas ───────────────────────────────────────────────────────────

  /**
   * Operações locais/transitórias são confirmadas no SQLite antes de retornar.
   * Não grava automaticamente logs, trades ou ticks no Neon.
   */
  private async write<T>(_legacyRemoteFn: () => Promise<T>, sqliteFn: () => Promise<T>, op: string): Promise<T> {
    try {
      return await sqliteFn();
    } catch (error: any) {
      console.error(`❌ [SQLITE] Falha na gravação local ${op}:`, error?.message || String(error));
      throw error;
    }
  }

  /**
   * Dados essenciais só são considerados salvos depois da confirmação do Neon.
   * SQLite recebe a cópia local de forma síncrona; se essa cópia falhar, a Neon
   * continua sendo a fonte recuperável e o próximo boot tentará restaurá-la.
   */
  private async writeEssential<T>(neonFn: () => Promise<T>, sqliteFn: () => Promise<unknown>, op: string): Promise<T> {
    if (!this.neonOk || !this.neon) {
      throw new Error(`NEON_REQUIRED: gravação essencial "${op}" recusada porque a Neon não está disponível.`);
    }
    let durable: T;
    try {
      durable = await neonFn();
      this.neonOk_reset();
    } catch (error: any) {
      this.onNeonError(error, op);
      console.error(`❌ [NEON] Gravação essencial ${op} falhou; operação não será confirmada:`, error?.message || String(error));
      throw error;
    }
    try {
      await sqliteFn();
    } catch (error: any) {
      console.warn(`⚠️ [SQLITE CACHE] ${op} foi confirmado na Neon, mas a cópia local falhou; será restaurada no próximo sync.`, error?.message || String(error));
    }
    return durable;
  }

  /**
   * LEITURA REMOTA: Neon (circuit breaker) → Turso (circuit breaker) → SQLite
   * Usar apenas para dados críticos de baixa frequência (ex: leitura de usuário na autenticação).
   */
  private async read<T>(
    neonFn: (() => Promise<T>) | null,
    _legacyRemoteFn: () => Promise<T>,
    sqliteFn: () => Promise<T>,
    op: string
  ): Promise<T> {
    if (neonFn && this.neonOk) {
      try {
        const result = await neonFn();
        this.neonOk_reset();
        return result;
      } catch (error: any) {
        this.onNeonError(error, op);
        // Reads may fall back to local cache for availability; writes never do.
      }
    }
    return sqliteFn();
  }

  /**
   * LEITURA LOCAL: SQLite (primário) → Turso (fallback)
   * Usar para dados de alta frequência já sincronizados no SQLite via dual-write.
   * PRESERVA COTA DO TURSO: evita chamadas remotas desnecessárias.
   */
  private async localRead<T>(
    _legacyRemoteFn: () => Promise<T>,
    sqliteFn: () => Promise<T>,
    _op: string
  ): Promise<T> {
    return sqliteFn();
  }

  // ─── Usuários ─────────────────────────────────────────────────────────────

  async getUser(id: string) {
    return this.read(() => this.neon!.getUser(id), () => this.turso!.getUser(id), () => this.sqlite.getUser(id), 'getUser');
  }
  async getUserByEmail(email: string) {
    return this.read(() => this.neon!.getUserByEmail(email), () => this.turso!.getUserByEmail(email), () => this.sqlite.getUserByEmail(email), 'getUserByEmail');
  }
  async getUserByCpf(cpf: string) {
    return this.read(() => this.neon!.getUserByCpf(cpf), () => this.turso!.getUserByCpf(cpf), () => this.sqlite.getUserByCpf(cpf), 'getUserByCpf');
  }
  async getAllUsers() {
    return this.read(() => this.neon!.getAllUsers(), () => this.turso!.getAllUsers(), () => this.sqlite.getAllUsers(), 'getAllUsers');
  }
  async createUser(user: InsertUser) { const payload = { ...user, id: user.id ?? randomBytes(16).toString('hex') } as InsertUser; return this.writeEssential(() => this.neon!.createUser(payload), () => this.sqlite.createUser(payload), 'createUser'); }
  async updateUser(id: string, data: UpdateUser) { return this.writeEssential(() => this.neon!.updateUser(id, data), () => this.sqlite.updateUser(id, data), 'updateUser'); }
  async updateVerificationCode(uid: string, code: string, exp: Date) { return this.writeEssential(() => this.neon!.updateVerificationCode(uid, code, exp), () => this.sqlite.updateVerificationCode(uid, code, exp), 'updateVerificationCode'); }
  async verifyPhone(uid: string) { return this.writeEssential(() => this.neon!.verifyPhone(uid), () => this.sqlite.verifyPhone(uid), 'verifyPhone'); }
  async approveAccount(uid: string, by: string) { return this.writeEssential(() => this.neon!.approveAccount(uid, by), () => this.sqlite.approveAccount(uid, by), 'approveAccount'); }

  // ─── Movimentos ───────────────────────────────────────────────────────────

  async createMovimento(m: InsertMovimento) { return this.write(() => this.turso!.createMovimento(m), () => this.sqlite.createMovimento(m), 'createMovimento'); }
  async getUserMovimentos(uid: string, limit?: number) {
    return this.read(() => this.neon!.getUserMovimentos(uid, limit), () => this.turso!.getUserMovimentos(uid, limit), () => this.sqlite.getUserMovimentos(uid, limit), 'getUserMovimentos');
  }
  async calcularRendimento(saldo: number) { return this.sqlite.calcularRendimento(saldo); }

  // ─── Documentos ───────────────────────────────────────────────────────────

  async createDocumento(d: InsertDocumento) { return this.write(() => this.turso!.createDocumento(d), () => this.sqlite.createDocumento(d), 'createDocumento'); }
  async getUserDocumentos(uid: string) {
    return this.read(() => this.neon!.getUserDocumentos(uid), () => this.turso!.getUserDocumentos(uid), () => this.sqlite.getUserDocumentos(uid), 'getUserDocumentos');
  }
  async updateDocumentoStatus(id: string, status: string, motivo?: string) { return this.write(() => this.turso!.updateDocumentoStatus(id, status, motivo), () => this.sqlite.updateDocumentoStatus(id, status, motivo), 'updateDocumentoStatus'); }

  // ─── Tokens Deriv ─────────────────────────────────────────────────────────

  async createDerivToken(t: InsertDerivToken) { const payload = { ...t, id: t.id ?? randomBytes(16).toString('hex'), slotIndex: t.slotIndex ?? null } as InsertDerivToken; return this.writeEssential(() => this.neon!.createDerivToken(payload), () => this.sqlite.createDerivToken(payload), 'createDerivToken'); }
  async getUserDerivToken(uid: string) {
    return this.localRead(() => this.turso!.getUserDerivToken(uid), () => this.sqlite.getUserDerivToken(uid), 'getUserDerivToken');
  }
  // Token de autenticação precisa estar visível imediatamente nas leituras locais após o POST.
  // O write() genérico sincroniza SQLite em background; isso causava corrida: o POST retornava
  // sucesso, mas GET /account-info lia SQLite antes da cópia terminar e dizia "token não configurado".
  async updateDerivToken(uid: string, token: string, accountType: string) {
    const id = randomBytes(16).toString('hex');
    return this.writeEssential(
      () => this.neon!.updateDerivToken(uid, token, accountType, id),
      () => this.sqlite.updateDerivToken(uid, token, accountType, id),
      'updateDerivToken'
    );
  }
  async deactivateDerivToken(uid: string) { return this.writeEssential(() => this.neon!.deactivateDerivToken(uid), () => this.sqlite.deactivateDerivToken(uid), 'deactivateDerivToken'); }

  // ─── Frenético 10-Tokens ──────────────────────────────────────────────────
  async getAllDerivTokens(uid: string) {
    return this.localRead(() => this.turso!.getAllDerivTokens(uid), () => this.sqlite.getAllDerivTokens(uid), 'getAllDerivTokens');
  }
  async upsertDerivTokenBySlot(uid: string, slotIndex: number, token: string, accountType: string) {
    const id = randomBytes(16).toString('hex');
    return this.writeEssential(
      () => this.neon!.upsertDerivTokenBySlot(uid, slotIndex, token, accountType, id),
      () => this.sqlite.upsertDerivTokenBySlot(uid, slotIndex, token, accountType, id),
      'upsertDerivTokenBySlot'
    );
  }
  async deleteDerivTokenBySlot(uid: string, slotIndex: number) {
    return this.writeEssential(() => this.neon!.deleteDerivTokenBySlot(uid, slotIndex), () => this.sqlite.deleteDerivTokenBySlot(uid, slotIndex), 'deleteDerivTokenBySlot');
  }

  // ─── Módulos de Cópia Simultânea por Modalidade ───────────────────────────
  async getModalityModuleConfigs(uid: string) {
    return this.read(() => this.neon!.getModalityModuleConfigs(uid), async () => [], () => this.sqlite.getModalityModuleConfigs(uid), 'getModalityModuleConfigs');
  }
  async getModalityModuleConfig(uid: string, modality: string) {
    return this.read(() => this.neon!.getModalityModuleConfig(uid, modality), async () => undefined, () => this.sqlite.getModalityModuleConfig(uid, modality), 'getModalityModuleConfig');
  }
  async upsertModalityModuleConfig(uid: string, modality: string, slotConfigs: import('@shared/schema').ModuleSlotConfig[]) {
    return this.writeEssential(() => this.neon!.upsertModalityModuleConfig(uid, modality, slotConfigs), () => this.sqlite.upsertModalityModuleConfig(uid, modality, slotConfigs), 'upsertModalityModuleConfig');
  }

  // ─── Configurações de Trade ───────────────────────────────────────────────

  async createTradeConfig(c: InsertTradeConfiguration) { const payload = { ...c, id: c.id ?? randomBytes(16).toString('hex') } as InsertTradeConfiguration; return this.writeEssential(() => this.neon!.createTradeConfig(payload), () => this.sqlite.createTradeConfig(payload), 'createTradeConfig'); }
  async getUserTradeConfig(uid: string) {
    return this.localRead(() => this.turso!.getUserTradeConfig(uid), () => this.sqlite.getUserTradeConfig(uid), 'getUserTradeConfig');
  }
  async getAllTradeConfigurations() {
    return this.localRead(() => this.turso!.getAllTradeConfigurations(), () => this.sqlite.getAllTradeConfigurations(), 'getAllTradeConfigurations');
  }
  async getActiveTradeConfigurations() {
    // Alta frequência (chamado a cada 60s) → SQLite first
    return this.localRead(() => this.turso!.getActiveTradeConfigurations(), () => this.sqlite.getActiveTradeConfigurations(), 'getActiveTradeConfigurations');
  }
  async updateTradeConfig(uid: string, mode: string) { const id = randomBytes(16).toString('hex'); return this.writeEssential(() => this.neon!.updateTradeConfig(uid, mode, id), () => this.sqlite.updateTradeConfig(uid, mode, id), 'updateTradeConfig'); }
  async updateSelectedModalities(uid: string, modalities: string[]) { return this.writeEssential(() => this.neon!.updateSelectedModalities(uid, modalities), () => this.sqlite.updateSelectedModalities(uid, modalities), 'updateSelectedModalities'); }
  async updateAccuGrowthRates(uid: string, rates: string[]) { return this.writeEssential(() => this.neon!.updateAccuGrowthRates(uid, rates), () => this.sqlite.updateAccuGrowthRates(uid, rates), 'updateAccuGrowthRates'); }
  async updateModalityFrequency(uid: string, freq: Record<string, string>) { return this.writeEssential(() => this.neon!.updateModalityFrequency(uid, freq), () => this.sqlite.updateModalityFrequency(uid, freq), 'updateModalityFrequency'); }
  async updateAccuTicksPerRate(uid: string, ticks: Record<string, number>) { return this.writeEssential(() => this.neon!.updateAccuTicksPerRate(uid, ticks), () => this.sqlite.updateAccuTicksPerRate(uid, ticks), 'updateAccuTicksPerRate'); }
  async updateAccuFrequencyPerRate(uid: string, freq: Record<string, string>) { return this.writeEssential(() => this.neon!.updateAccuFrequencyPerRate(uid, freq), () => this.sqlite.updateAccuFrequencyPerRate(uid, freq), 'updateAccuFrequencyPerRate'); }
  async updateModalityTicks(uid: string, ticks: Record<string, number>) { return this.writeEssential(() => this.neon!.updateModalityTicks(uid, ticks), () => this.sqlite.updateModalityTicks(uid, ticks), 'updateModalityTicks'); }
  async deactivateAllTradeConfigs(uid: string) { return this.writeEssential(() => this.neon!.deactivateAllTradeConfigs(uid), () => this.sqlite.deactivateAllTradeConfigs(uid), 'deactivateAllTradeConfigs'); }
  async reactivateTradeConfiguration(id: string) { return this.writeEssential(() => this.neon!.reactivateTradeConfiguration(id), () => this.sqlite.reactivateTradeConfiguration(id), 'reactivateTradeConfiguration'); }
  async deactivateTradeConfiguration(id: string) { return this.writeEssential(() => this.neon!.deactivateTradeConfiguration(id), () => this.sqlite.deactivateTradeConfiguration(id), 'deactivateTradeConfiguration'); }

  // ─── Sincronização de usuário para satisfazer FK do Turso ─────────────────

  private tursoSyncedUsers = new Set<string>();

  private async ensureUserInTurso(userId: string): Promise<void> {
    if (!this.turso || this.tursoSyncedUsers.has(userId)) return;
    try {
      const tursoUser = await this.turso.getUser(userId).catch(() => null);
      if (!tursoUser) {
        const sqliteUser = await this.sqlite.getUser(userId);
        if (sqliteUser) {
          await this.turso.createUser(sqliteUser).catch(() => {});
        }
      }
      this.tursoSyncedUsers.add(userId);
    } catch {
      // não-fatal — FK error será tratado pelo fallback SQLite se necessário
    }
  }

  // ─── Operações de Trade ───────────────────────────────────────────────────

  async createTradeOperation(op: InsertTradeOperation): Promise<TradeOperation> {
    const id = randomBytes(16).toString('hex').toUpperCase();
    const withId = { ...op, id } as any;
    if (this.turso) {
      try {
        await this.ensureUserInTurso(op.userId);
        // Aguardar AMBOS (Turso + SQLite) para garantir consistência.
        // Sem isso, SQLite fica desatualizado e o sync não encontra operações pendentes.
        const [tursoResult] = await Promise.allSettled([
          this.turso.createTradeOperation(withId),
          this.sqlite.createTradeOperation(withId),
        ]);
        if (tursoResult.status === 'fulfilled') return tursoResult.value;
        // Turso falhou mas SQLite pode ter dado certo
        const sqliteResult = await this.sqlite.createTradeOperation(withId).catch((e: any) => {
          console.warn('⚠️ [SQLITE] createTradeOperation (após falha Turso):', e.message);
          throw e;
        });
        return sqliteResult;
      } catch (e: any) {
        console.warn('⚠️ [TURSO] createTradeOperation falhou, fallback SQLite:', e.message);
      }
    }
    return this.sqlite.createTradeOperation(withId);
  }

  async getUserTradeOperations(uid: string, limit?: number) {
    // Busca SQLite e Turso em paralelo e mescla os resultados para não perder pendentes.
    // Isso resolve o bug onde novos trades ficavam só no Turso e o sync nunca os encontrava.
    let sqliteOps: any[] = [];
    let tursoOps: any[] = [];

    try {
      sqliteOps = await this.sqlite.getUserTradeOperations(uid, limit) ?? [];
    } catch {}

    if (this.turso && this.tursoReadOk) {
      try {
        tursoOps = await this.turso.getUserTradeOperations(uid, limit) ?? [];
        this.tursoReadFailCount = 0;
      } catch (e: any) {
        this.onTursoReadError(e, 'getUserTradeOperations');
      }
    }

    if (tursoOps.length === 0) return sqliteOps;
    if (sqliteOps.length === 0) return tursoOps;

    // Mesclar: usar mapa por ID, preferindo Turso (fonte primária de escrita)
    const merged = new Map<string, any>();
    for (const op of sqliteOps) if (op?.id) merged.set(op.id, op);
    for (const op of tursoOps)  if (op?.id) merged.set(op.id, op); // sobrescreve com dado mais recente
    const result = Array.from(merged.values());

    // Ordenar por createdAt decrescente (mais recente primeiro), respeitando o limit
    result.sort((a: any, b: any) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
    return limit ? result.slice(0, limit) : result;
  }
  async getTradeOperationByDerivContractId(derivContractId: string): Promise<TradeOperation | null> {
    return this.localRead(
      () => this.turso!.getTradeOperationByDerivContractId(derivContractId),
      () => this.sqlite.getTradeOperationByDerivContractId(derivContractId),
      'getTradeOperationByDerivContractId'
    );
  }
  async updateTradeOperation(id: string, updates: Partial<TradeOperation>) { return this.write(() => this.turso!.updateTradeOperation(id, updates), () => this.sqlite.updateTradeOperation(id, updates), 'updateTradeOperation'); }
  async getActiveTradeOperations(uid: string) {
    // Alta frequência (sync a cada 30s) → SQLite first
    return this.localRead(() => this.turso!.getActiveTradeOperations(uid), () => this.sqlite.getActiveTradeOperations(uid), 'getActiveTradeOperations');
  }

  // ─── Logs de IA (somente SQLite — dados transientes de alta frequência) ───

  async createAiLog(log: InsertAiLog)                  { return this.sqlite.createAiLog(log); }
  async getUserAiLogs(uid: string, limit?: number)     { return this.sqlite.getUserAiLogs(uid, limit); }
  async getLatestAiAnalysis(uid: string)               { return this.sqlite.getLatestAiAnalysis(uid); }

  // ─── Dados de Mercado (somente SQLite — cache local de alta frequência) ───

  async upsertMarketData(data: InsertMarketData) { return this.sqlite.upsertMarketData(data); }
  async getMarketData(symbol: string)            { return this.sqlite.getMarketData(symbol); }
  async getAllMarketData()                        { return this.sqlite.getAllMarketData(); }

  // ─── Estatísticas de Trading ──────────────────────────────────────────────

  async getTradingStats(uid: string) {
    // Turso é a fonte primária de escrita — buscar dele para ter estatísticas atualizadas.
    // SQLite fica como fallback caso Turso esteja indisponível.
    return this.localRead(
      () => this.turso!.getTradingStats(uid),
      () => this.sqlite.getTradingStats(uid),
      'getTradingStats'
    );
  }

  async getActiveTradesCount(uid: string) {
    // Alta frequência → SQLite first
    return this.localRead(() => this.turso!.getActiveTradesCount(uid), () => this.sqlite.getActiveTradesCount(uid), 'getActiveTradesCount');
  }
  async getDailyLossCount(uid: string, date: string) {
    // Alta frequência → SQLite first
    return this.localRead(() => this.turso!.getDailyLossCount(uid, date), () => this.sqlite.getDailyLossCount(uid, date), 'getDailyLossCount');
  }
  // saveActiveTradeForTracking: dados temporários de rastreamento → SQLite only
  async saveActiveTradeForTracking(data: any) { return this.sqlite.saveActiveTradeForTracking(data); }

  // ─── PnL Diário ───────────────────────────────────────────────────────────

  async createOrUpdateDailyPnL(uid: string, data: Partial<InsertDailyPnL>) {
    if (this.turso) {
      try {
        await this.ensureUserInTurso(uid);
        const r = await this.turso.createOrUpdateDailyPnL(uid, data);
        this.sqlite.createOrUpdateDailyPnL(uid, data).catch(() => {});
        return r;
      } catch (e: any) {
        console.warn(`⚠️ [TURSO] createOrUpdateDailyPnL falhou, fallback SQLite:`, e.message);
      }
    }
    return this.sqlite.createOrUpdateDailyPnL(uid, data);
  }
  async getDailyPnL(uid: string, date?: string) {
    return this.localRead(() => this.turso!.getDailyPnL(uid, date), () => this.sqlite.getDailyPnL(uid, date), 'getDailyPnL');
  }
  async getConservativeOperationsToday(uid: string) {
    return this.localRead(() => this.turso!.getConservativeOperationsToday(uid), () => this.sqlite.getConservativeOperationsToday(uid), 'getConservativeOperationsToday');
  }
  async incrementConservativeOperations(uid: string) { return this.write(() => this.turso!.incrementConservativeOperations(uid), () => this.sqlite.incrementConservativeOperations(uid), 'incrementConservativeOperations'); }
  async getRecentDailyPnL(uid: string, days?: number) {
    return this.localRead(() => this.turso!.getRecentDailyPnL(uid, days), () => this.sqlite.getRecentDailyPnL(uid, days), 'getRecentDailyPnL');
  }

  // ─── Estratégias de Recuperação ───────────────────────────────────────────

  async createAiRecoveryStrategy(s: InsertAiRecoveryStrategy) { return this.write(() => this.turso!.createAiRecoveryStrategy(s), () => this.sqlite.createAiRecoveryStrategy(s), 'createAiRecoveryStrategy'); }
  async getUserRecoveryStrategies(uid: string) {
    return this.localRead(() => this.turso!.getUserRecoveryStrategies(uid), () => this.sqlite.getUserRecoveryStrategies(uid), 'getUserRecoveryStrategies');
  }
  async updateRecoveryStrategy(id: string, updates: Partial<AiRecoveryStrategy>) { return this.write(() => this.turso!.updateRecoveryStrategy(id, updates), () => this.sqlite.updateRecoveryStrategy(id, updates), 'updateRecoveryStrategy'); }
  async calculateRecoveryMultiplier(uid: string) {
    return this.localRead(() => this.turso!.calculateRecoveryMultiplier(uid), () => this.sqlite.calculateRecoveryMultiplier(uid), 'calculateRecoveryMultiplier');
  }
  async shouldActivateRecovery(uid: string) {
    return this.localRead(() => this.turso!.shouldActivateRecovery(uid), () => this.sqlite.shouldActivateRecovery(uid), 'shouldActivateRecovery');
  }
  async getRecoveryThresholdRecommendation(uid: string) {
    return this.localRead(() => this.turso!.getRecoveryThresholdRecommendation(uid), () => this.sqlite.getRecoveryThresholdRecommendation(uid), 'getRecoveryThresholdRecommendation');
  }
  async canExecuteTradeWithoutViolatingMinimum(uid: string, potentialLoss: number, isMartingaleRecovery = false) {
    return this.localRead(() => this.turso!.canExecuteTradeWithoutViolatingMinimum(uid, potentialLoss, isMartingaleRecovery), () => this.sqlite.canExecuteTradeWithoutViolatingMinimum(uid, potentialLoss, isMartingaleRecovery), 'canExecuteTradeWithoutViolatingMinimum');
  }
  async getMinimumBalanceRequired(uid: string)  { return this.sqlite.getMinimumBalanceRequired(uid); }
  async getBalanceAnalysis(uid: string)          { return this.sqlite.getBalanceAnalysis(uid); }

  // ─── Sessões de Trading Ativas ────────────────────────────────────────────

  async upsertActiveTradingSession(session: InsertActiveTradingSession) { return this.write(() => this.turso!.upsertActiveTradingSession(session), () => this.sqlite.upsertActiveTradingSession(session), 'upsertActiveTradingSession'); }
  async getActiveTradingSession(key: string) {
    // Alta frequência → SQLite first
    return this.localRead(() => this.turso!.getActiveTradingSession(key), () => this.sqlite.getActiveTradingSession(key), 'getActiveTradingSession');
  }
  async getAllActiveTradingSessions() {
    // Alta frequência (a cada 60s) → SQLite first
    return this.localRead(() => this.turso!.getAllActiveTradingSessions(), () => this.sqlite.getAllActiveTradingSessions(), 'getAllActiveTradingSessions');
  }
  async updateActiveTradingSession(key: string, updates: Partial<ActiveTradingSession>) { return this.write(() => this.turso!.updateActiveTradingSession(key, updates), () => this.sqlite.updateActiveTradingSession(key, updates), 'updateActiveTradingSession'); }
  async deactivateActiveTradingSession(key: string) { return this.write(() => this.turso!.deactivateActiveTradingSession(key), () => this.sqlite.deactivateActiveTradingSession(key), 'deactivateActiveTradingSession'); }
  async clearInactiveTradingSessions()               { return this.write(() => this.turso!.clearInactiveTradingSessions(), () => this.sqlite.clearInactiveTradingSessions(), 'clearInactiveTradingSessions'); }

  // ─── Subscriptions WebSocket (SQLite only — efêmeras, recriadas no boot) ─

  async saveWebSocketSubscription(sub: InsertActiveWebSocketSubscription) { return this.sqlite.saveWebSocketSubscription(sub); }
  async getActiveWebSocketSubscriptions() { return this.sqlite.getActiveWebSocketSubscriptions(); }
  async deactivateWebSocketSubscription(id: string) { return this.sqlite.deactivateWebSocketSubscription(id); }
  async clearAllWebSocketSubscriptions()             { return this.sqlite.clearAllWebSocketSubscriptions(); }

  // ─── Health Heartbeat (SQLite local — alta frequência, não precisa de nuvem)

  async updateSystemHeartbeat(name: string, status: string, meta?: any, lastErr?: string) { return this.sqlite.updateSystemHeartbeat(name, status, meta, lastErr); }
  async getSystemHeartbeat(name: string)   { return this.sqlite.getSystemHeartbeat(name); }
  async getAllSystemHeartbeats()            { return this.sqlite.getAllSystemHeartbeats(); }
  async incrementHeartbeatError(name: string, err: string) { return this.sqlite.incrementHeartbeatError(name, err); }
  async resetHeartbeatErrors(name: string) { return this.sqlite.resetHeartbeatErrors(name); }

  // ─── Controle de Trading ──────────────────────────────────────────────────

  async getTradingControlStatus() {
    // Alta frequência → SQLite first
    return this.localRead(() => this.turso!.getTradingControlStatus(), () => this.sqlite.getTradingControlStatus(), 'getTradingControlStatus');
  }
  async pauseTrading(by: string, reason: string) { return this.write(() => this.turso!.pauseTrading(by, reason), () => this.sqlite.pauseTrading(by, reason), 'pauseTrading'); }
  async resumeTrading()                           { return this.write(() => this.turso!.resumeTrading(), () => this.sqlite.resumeTrading(), 'resumeTrading'); }

  // ─── Blacklist / Ativos Bloqueados (SQLite only — verificação por trade) ──

  async createAssetBlacklist(b: any)                          { return this.sqlite.createAssetBlacklist(b); }
  async getUserAssetBlacklists(uid: string)                   { return this.sqlite.getUserAssetBlacklists(uid); }
  async deleteAssetBlacklist(id: string)                      { return this.sqlite.deleteAssetBlacklist(id); }
  async isAssetBlocked(uid: string, asset: string)            { return this.sqlite.isAssetBlocked(uid, asset); }
  async isUserBlockedAsset(uid: string, sym: string, mode: string) { return this.sqlite.isUserBlockedAsset(uid, sym, mode); }

  // ─── Configuração de Pausa (SQLite only — verificação por trade) ──────────

  async getUserPauseConfig(uid: string)                       { return this.sqlite.getUserPauseConfig(uid); }
  async createPauseConfig(cfg: any)                           { return this.sqlite.createPauseConfig(cfg); }
  async updatePauseConfig(uid: string, cfg: any)              { return this.sqlite.updatePauseConfig(uid, cfg); }
  async updatePausedNowStatus(uid: string, v: boolean)        { return this.sqlite.updatePausedNowStatus(uid, v); }

  // ─── Utilitários ─────────────────────────────────────────────────────────

  async expireOldPendingTrades(mins = 5): Promise<number> {
    return this.sqlite.expireOldPendingTrades(mins);
  }

  async resetAllTradingData(uid: string): Promise<{ tablesCleared: string[]; rowsDeleted: number }> {
    if (this.turso) {
      try {
        const r = await this.turso.resetAllTradingData(uid);
        this.sqlite.resetAllTradingData(uid).catch(() => {});
        return r;
      } catch {}
    }
    return this.sqlite.resetAllTradingData(uid);
  }

  async clearTabData(userId: string, tab: string): Promise<{ cleared: string[]; rowsDeleted: number }> {
    return this.sqlite.clearTabData(userId, tab);
  }

  async updateRiskSettings(userId: string, settings: any): Promise<void> {
    return this.writeEssential(() => this.neon!.updateRiskSettings(userId, settings), () => this.sqlite.updateRiskSettings(userId, settings), 'updateRiskSettings');
  }
}

export const dualStorage = new DualStorage();
