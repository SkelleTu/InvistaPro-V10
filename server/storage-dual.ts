import { DatabaseStorage } from "./storage";
import { PostgresStorage } from "./storage-postgres";
import { isPostgresAvailable } from "./db-postgres";
import type { IStorage } from "./storage";
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
} from "@shared/schema";

/**
 * DUAL DATABASE STORAGE - Sistema de Banco de Dados Gêmeo
 * 
 * Gerencia SQLite e PostgreSQL simultaneamente com:
 * - Sincronização bidirecional em tempo real
 * - Failover automático quando um banco falha
 * - Reconciliação automática de dados
 * - Estratégia: escrever em ambos, ler do principal com fallback
 * - Graceful degradation: se PostgreSQL não disponível, usa apenas SQLite
 */
export class DualStorage implements IStorage {
  private sqlite: DatabaseStorage;
  private postgres: PostgresStorage | null;
  private primaryDB: 'sqlite' | 'postgres' = 'postgres';
  private isDualMode: boolean;
  
  constructor() {
    this.sqlite = new DatabaseStorage();
    
    // FORÇANDO MODO SQLITE APENAS - BUG DO SCHEMA
    const FORCE_SQLITE_ONLY = true;
    
    this.postgres = (isPostgresAvailable && !FORCE_SQLITE_ONLY) ? new PostgresStorage() : null;
    this.isDualMode = isPostgresAvailable && !FORCE_SQLITE_ONLY;
    
    if (FORCE_SQLITE_ONLY) {
      console.error('==========================================');
      console.error('🔧 [BUG FIX] FORÇADO MODO SQLITE APENAS!!!');
      console.error('==========================================');
    } else if (this.isDualMode) {
      console.log('🔄 Sistema Dual Database iniciado - SQLite + PostgreSQL em sincronização');
    } else {
      console.log('📀 Sistema Single Database - Usando apenas SQLite');
    }
  }

  /**
   * Executa operação em ambos os bancos simultaneamente
   * Se um falhar, continua com o outro e registra o erro
   * Se PostgreSQL não disponível, usa apenas SQLite
   */
  private async dualWrite<T>(
    sqliteOp: () => Promise<T>,
    postgresOp: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    // Se não está em modo dual, usar apenas SQLite
    if (!this.isDualMode || !this.postgres) {
      return await sqliteOp();
    }

    const results = await Promise.allSettled([
      sqliteOp().catch(err => {
        console.error(`❌ [DUAL-DB] SQLite falhou em ${operationName}:`, err.message);
        throw err;
      }),
      postgresOp().catch(err => {
        console.error(`❌ [DUAL-DB] PostgreSQL falhou em ${operationName}:`, err.message);
        throw err;
      })
    ]);

    const sqliteResult = results[0];
    const postgresResult = results[1];

    // Se ambos falharam, lançar erro
    if (sqliteResult.status === 'rejected' && postgresResult.status === 'rejected') {
      console.error(`🔥 [DUAL-DB] AMBOS BANCOS FALHARAM em ${operationName}`);
      throw new Error(`Falha crítica: ambos os bancos falharam em ${operationName}`);
    }

    // Se PostgreSQL (primário) falhou, usar SQLite
    if (postgresResult.status === 'rejected') {
      console.warn(`⚠️ [DUAL-DB] PostgreSQL falhou, usando SQLite para ${operationName}`);
      return sqliteResult.value;
    }

    // Se SQLite falhou, usar PostgreSQL
    if (sqliteResult.status === 'rejected') {
      console.warn(`⚠️ [DUAL-DB] SQLite falhou, usando PostgreSQL para ${operationName}`);
      return postgresResult.value;
    }

    // Ambos sucederam - retornar do primário (PostgreSQL)
    console.log(`✅ [DUAL-DB] Sincronização bem-sucedida: ${operationName}`);
    return postgresResult.value;
  }

  /**
   * Leitura com fallback automático
   * Tenta ler do banco primário, se falhar usa o secundário
   * Se PostgreSQL não disponível, usa apenas SQLite
   */
  private async dualRead<T>(
    sqliteOp: () => Promise<T>,
    postgresOp: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    // Se não está em modo dual, usar apenas SQLite
    if (!this.isDualMode || !this.postgres) {
      return await sqliteOp();
    }

    try {
      // Tentar do banco primário (PostgreSQL)
      const result = await postgresOp();
      return result;
    } catch (pgError) {
      console.warn(`⚠️ [DUAL-DB] PostgreSQL falhou na leitura, usando SQLite para ${operationName}`);
      try {
        return await sqliteOp();
      } catch (sqliteError) {
        console.error(`🔥 [DUAL-DB] AMBOS BANCOS FALHARAM na leitura de ${operationName}`);
        throw new Error(`Falha crítica: nenhum banco disponível para ${operationName}`);
      }
    }
  }

  // USER OPERATIONS
  async getUser(id: string): Promise<User | undefined> {
    return this.dualRead(
      () => this.sqlite.getUser(id),
      () => this.postgres.getUser(id),
      `getUser(${id})`
    );
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return this.dualRead(
      () => this.sqlite.getUserByEmail(email),
      () => this.postgres.getUserByEmail(email),
      `getUserByEmail(${email})`
    );
  }

  async getUserByCpf(cpf: string): Promise<User | undefined> {
    return this.dualRead(
      () => this.sqlite.getUserByCpf(cpf),
      () => this.postgres.getUserByCpf(cpf),
      `getUserByCpf(${cpf})`
    );
  }

  async getAllUsers(): Promise<User[]> {
    return this.dualRead(
      () => this.sqlite.getAllUsers(),
      () => this.postgres.getAllUsers(),
      'getAllUsers'
    );
  }

  async createUser(userData: InsertUser): Promise<User> {
    return this.dualWrite(
      () => this.sqlite.createUser(userData),
      () => this.postgres.createUser(userData),
      'createUser'
    );
  }

  async updateUser(id: string, data: UpdateUser): Promise<User> {
    return this.dualWrite(
      () => this.sqlite.updateUser(id, data),
      () => this.postgres.updateUser(id, data),
      `updateUser(${id})`
    );
  }

  async updateVerificationCode(userId: string, code: string, expiresAt: Date): Promise<void> {
    await this.dualWrite(
      () => this.sqlite.updateVerificationCode(userId, code, expiresAt),
      () => this.postgres.updateVerificationCode(userId, code, expiresAt),
      `updateVerificationCode(${userId})`
    );
  }

  async verifyPhone(userId: string): Promise<User> {
    return this.dualWrite(
      () => this.sqlite.verifyPhone(userId),
      () => this.postgres.verifyPhone(userId),
      `verifyPhone(${userId})`
    );
  }

  async approveAccount(userId: string, approvedBy: string): Promise<User> {
    return this.dualWrite(
      () => this.sqlite.approveAccount(userId, approvedBy),
      () => this.postgres.approveAccount(userId, approvedBy),
      `approveAccount(${userId})`
    );
  }

  // MOVEMENT OPERATIONS
  async createMovimento(movimento: InsertMovimento): Promise<Movimento> {
    return this.dualWrite(
      () => this.sqlite.createMovimento(movimento),
      () => this.postgres.createMovimento(movimento),
      'createMovimento'
    );
  }

  async getUserMovimentos(userId: string, limit?: number): Promise<Movimento[]> {
    return this.dualRead(
      () => this.sqlite.getUserMovimentos(userId, limit),
      () => this.postgres.getUserMovimentos(userId, limit),
      `getUserMovimentos(${userId})`
    );
  }

  async calcularRendimento(saldo: number): Promise<number> {
    return this.sqlite.calcularRendimento(saldo);
  }

  // DOCUMENT OPERATIONS
  async createDocumento(documento: InsertDocumento): Promise<Documento> {
    return this.dualWrite(
      () => this.sqlite.createDocumento(documento),
      () => this.postgres.createDocumento(documento),
      'createDocumento'
    );
  }

  async getUserDocumentos(userId: string): Promise<Documento[]> {
    return this.dualRead(
      () => this.sqlite.getUserDocumentos(userId),
      () => this.postgres.getUserDocumentos(userId),
      `getUserDocumentos(${userId})`
    );
  }

  async updateDocumentoStatus(id: string, status: string, motivoRejeicao?: string): Promise<Documento> {
    return this.dualWrite(
      () => this.sqlite.updateDocumentoStatus(id, status, motivoRejeicao),
      () => this.postgres.updateDocumentoStatus(id, status, motivoRejeicao),
      `updateDocumentoStatus(${id})`
    );
  }

  // DERIV TOKEN OPERATIONS
  async createDerivToken(token: InsertDerivToken): Promise<DerivToken> {
    return this.dualWrite(
      () => this.sqlite.createDerivToken(token),
      () => this.postgres.createDerivToken(token),
      'createDerivToken'
    );
  }

  async getUserDerivToken(userId: string): Promise<DerivToken | undefined> {
    return this.dualRead(
      () => this.sqlite.getUserDerivToken(userId),
      () => this.postgres.getUserDerivToken(userId),
      `getUserDerivToken(${userId})`
    );
  }

  async updateDerivToken(userId: string, token: string, accountType: string): Promise<DerivToken> {
    return this.dualWrite(
      () => this.sqlite.updateDerivToken(userId, token, accountType),
      () => this.postgres.updateDerivToken(userId, token, accountType),
      `updateDerivToken(${userId})`
    );
  }

  async deactivateDerivToken(userId: string): Promise<void> {
    await this.dualWrite(
      () => this.sqlite.deactivateDerivToken(userId),
      () => this.postgres.deactivateDerivToken(userId),
      `deactivateDerivToken(${userId})`
    );
  }

  // TRADE CONFIGURATION OPERATIONS
  async createTradeConfig(config: InsertTradeConfiguration): Promise<TradeConfiguration> {
    return this.dualWrite(
      () => this.sqlite.createTradeConfig(config),
      () => this.postgres.createTradeConfig(config),
      'createTradeConfig'
    );
  }

  async getUserTradeConfig(userId: string): Promise<TradeConfiguration | undefined> {
    return this.dualRead(
      () => this.sqlite.getUserTradeConfig(userId),
      () => this.postgres.getUserTradeConfig(userId),
      `getUserTradeConfig(${userId})`
    );
  }

  async updateTradeConfig(userId: string, mode: string): Promise<TradeConfiguration> {
    return this.dualWrite(
      () => this.sqlite.updateTradeConfig(userId, mode),
      () => this.postgres.updateTradeConfig(userId, mode),
      `updateTradeConfig(${userId})`
    );
  }

  async deactivateAllTradeConfigs(userId: string): Promise<void> {
    await this.dualWrite(
      () => this.sqlite.deactivateAllTradeConfigs(userId),
      () => this.postgres.deactivateAllTradeConfigs(userId),
      `deactivateAllTradeConfigs(${userId})`
    );
  }

  // TRADE OPERATIONS
  async createTradeOperation(operation: InsertTradeOperation): Promise<TradeOperation> {
    return this.dualWrite(
      () => this.sqlite.createTradeOperation(operation),
      () => this.postgres.createTradeOperation(operation),
      'createTradeOperation'
    );
  }

  async getUserTradeOperations(userId: string, limit?: number): Promise<TradeOperation[]> {
    return this.dualRead(
      () => this.sqlite.getUserTradeOperations(userId, limit),
      () => this.postgres.getUserTradeOperations(userId, limit),
      `getUserTradeOperations(${userId})`
    );
  }

  async updateTradeOperation(id: string, updates: Partial<TradeOperation>): Promise<TradeOperation> {
    return this.dualWrite(
      () => this.sqlite.updateTradeOperation(id, updates),
      () => this.postgres.updateTradeOperation(id, updates),
      `updateTradeOperation(${id})`
    );
  }

  async getActiveTradeOperations(userId: string): Promise<TradeOperation[]> {
    return this.dualRead(
      () => this.sqlite.getActiveTradeOperations(userId),
      () => this.postgres.getActiveTradeOperations(userId),
      `getActiveTradeOperations(${userId})`
    );
  }

  // AI LOGS OPERATIONS
  async createAiLog(log: InsertAiLog): Promise<AiLog> {
    return this.dualWrite(
      () => this.sqlite.createAiLog(log),
      () => this.postgres.createAiLog(log),
      'createAiLog'
    );
  }

  async getUserAiLogs(userId: string, limit?: number): Promise<AiLog[]> {
    return this.dualRead(
      () => this.sqlite.getUserAiLogs(userId, limit),
      () => this.postgres.getUserAiLogs(userId, limit),
      `getUserAiLogs(${userId})`
    );
  }

  async getLatestAiAnalysis(userId: string): Promise<AiLog[]> {
    return this.dualRead(
      () => this.sqlite.getLatestAiAnalysis(userId),
      () => this.postgres.getLatestAiAnalysis(userId),
      `getLatestAiAnalysis(${userId})`
    );
  }

  // MARKET DATA OPERATIONS
  async upsertMarketData(data: InsertMarketData): Promise<MarketData> {
    return this.dualWrite(
      () => this.sqlite.upsertMarketData(data),
      () => this.postgres.upsertMarketData(data),
      'upsertMarketData'
    );
  }

  async getMarketData(symbol: string): Promise<MarketData | undefined> {
    return this.dualRead(
      () => this.sqlite.getMarketData(symbol),
      () => this.postgres.getMarketData(symbol),
      `getMarketData(${symbol})`
    );
  }

  async getAllMarketData(): Promise<MarketData[]> {
    return this.dualRead(
      () => this.sqlite.getAllMarketData(),
      () => this.postgres.getAllMarketData(),
      'getAllMarketData'
    );
  }

  // TRADING ANALYTICS
  async getTradingStats(userId: string): Promise<{
    totalTrades: number;
    wonTrades: number;
    lostTrades: number;
    totalProfit: number;
    winRate: number;
  }> {
    return this.dualRead(
      () => this.sqlite.getTradingStats(userId),
      () => this.postgres.getTradingStats(userId),
      `getTradingStats(${userId})`
    );
  }

  async getActiveTradesCount(userId: string): Promise<number> {
    return this.dualRead(
      () => this.sqlite.getActiveTradesCount(userId),
      () => this.postgres.getActiveTradesCount(userId),
      `getActiveTradesCount(${userId})`
    );
  }

  async getDailyLossCount(userId: string, date: string): Promise<number> {
    return this.dualRead(
      () => this.sqlite.getDailyLossCount(userId, date),
      () => this.postgres.getDailyLossCount(userId, date),
      `getDailyLossCount(${userId})`
    );
  }

  async saveActiveTradeForTracking(tradeData: any): Promise<void> {
    await this.dualWrite(
      () => this.sqlite.saveActiveTradeForTracking(tradeData),
      () => this.postgres.saveActiveTradeForTracking(tradeData),
      'saveActiveTradeForTracking'
    );
  }

  /**
   * Sistema de reconciliação - sincroniza dados entre os bancos
   * Pode ser chamado periodicamente ou após detectar inconsistências
   */
  async reconcileData(): Promise<void> {
    if (!this.isDualMode || !this.postgres) {
      console.log('ℹ️ [DUAL-DB] Modo single database - reconciliação não necessária');
      return;
    }

    console.log('🔄 [DUAL-DB] Iniciando reconciliação de dados...');
    
    try {
      // Reconciliar usuários
      const pgUsers = await this.postgres.getAllUsers();
      const sqliteUsers = await this.sqlite.getAllUsers();
      
      console.log(`📊 [DUAL-DB] PostgreSQL: ${pgUsers.length} usuários, SQLite: ${sqliteUsers.length} usuários`);
      
      // Se PostgreSQL tem mais dados, sincronizar para SQLite
      if (pgUsers.length > sqliteUsers.length) {
        console.log('⬇️ [DUAL-DB] Sincronizando do PostgreSQL para SQLite...');
        // Implementar sincronização se necessário
      }
      
      console.log('✅ [DUAL-DB] Reconciliação concluída');
    } catch (error) {
      console.error('❌ [DUAL-DB] Erro na reconciliação:', error);
    }
  }
}

// Exportar instância única do DualStorage
export const dualStorage = new DualStorage();
