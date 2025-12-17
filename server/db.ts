import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from "@shared/schema";
import fs from 'fs';
import path from 'path';

// Garantir que o diretório do banco existe
const dbDir = path.join(process.cwd(), 'database');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Caminho do arquivo de banco local
const dbPath = path.join(dbDir, 'investpro.db');

// Criar conexão SQLite local
const sqlite = new Database(dbPath);

// Configurações ultra-conservativas para evitar disk I/O errors
try {
  sqlite.pragma('journal_mode = DELETE'); // Modo mais conservativo
  sqlite.pragma('synchronous = FULL'); // Máxima segurança
  sqlite.pragma('cache_size = 10000'); // Cache menor
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('temp_store = memory');
  sqlite.pragma('locking_mode = NORMAL'); // Evitar problemas de lock
  console.log('✅ SQLite configurado com modo ultra-conservativo para evitar disk I/O errors');
} catch (error) {
  console.error('❌ Erro ao configurar SQLite:', error);
  // Tentar recriar banco do zero se houver erro
  sqlite.close();
  fs.unlinkSync(dbPath);
  const newSqlite = new Database(dbPath);
  module.exports.sqlite = newSqlite;
}

// Criar instância do Drizzle
export const db = drizzle(sqlite, { schema });

// Exportar sqlite para uso em migrações
export { sqlite };

// Graceful shutdown para fechar conexão do banco
export function closeDatabase(): void {
  try {
    sqlite.close();
    console.log('🔌 Conexão com banco de dados fechada com segurança');
  } catch (error) {
    console.error('❌ Erro ao fechar banco de dados:', error);
  }
}

// Remoção dos handlers de sinal para evitar race conditions
// O shutdown será coordenado pelo server/index.ts

// Função para inicializar tabelas
export function initializeDatabase() {
  try {
    console.log('🗄️ Inicializando banco de dados local SQLite...');
    
    // Criar tabelas se não existirem
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expire DATETIME NOT NULL
      )
    `);

    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS IDX_session_expire ON sessions(expire)
    `);

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        nome_completo TEXT NOT NULL,
        cpf TEXT UNIQUE NOT NULL,
        telefone TEXT NOT NULL,
        endereco TEXT NOT NULL,
        cidade TEXT NOT NULL,
        estado TEXT NOT NULL,
        cep TEXT NOT NULL,
        chave_pix TEXT NOT NULL,
        tipo_chave_pix TEXT NOT NULL,
        telefone_verificado INTEGER DEFAULT 0,
        codigo_verificacao TEXT,
        codigo_expires_at DATETIME,
        password_reset_token TEXT,
        password_reset_token_expires_at DATETIME,
        conta_aprovada INTEGER DEFAULT 1,
        aprovada_por TEXT,
        aprovada_em DATETIME,
        documentos_verificados INTEGER DEFAULT 0,
        documentos_aprovados_em DATETIME,
        is_admin INTEGER DEFAULT 0,
        senha_fallback TEXT,
        usar_senha_fallback INTEGER DEFAULT 0,
        biometria_configurada INTEGER DEFAULT 0,
        saldo REAL DEFAULT 0.00 NOT NULL,
        deposito_data DATETIME,
        rendimento_saque_automatico INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS movimentos (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL,
        tipo TEXT NOT NULL,
        valor REAL NOT NULL,
        descricao TEXT,
        pix_string TEXT,
        biometria_verificada INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS documentos (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL,
        tipo TEXT NOT NULL,
        arquivo TEXT NOT NULL,
        status TEXT DEFAULT 'pendente',
        motivo_rejeicao TEXT,
        aprovado_por TEXT,
        aprovado_em DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS kyc_status (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        rg_cnh_frente_status TEXT DEFAULT 'pending',
        rg_cnh_verso_status TEXT DEFAULT 'pending',
        comprovante_residencia_status TEXT DEFAULT 'pending',
        completed_at DATETIME,
        approved_at DATETIME,
        rejected_at DATETIME,
        rejection_reason TEXT,
        reviewed_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // TRADING SYSTEM TABLES
    
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS deriv_tokens (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL,
        token TEXT NOT NULL,
        account_type TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS trade_configurations (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        is_active INTEGER DEFAULT 0,
        operations_count INTEGER NOT NULL,
        interval_type TEXT NOT NULL,
        interval_value INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS ai_logs (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        analysis TEXT NOT NULL,
        decision TEXT NOT NULL,
        confidence REAL NOT NULL,
        market_data TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS trade_operations (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL,
        deriv_contract_id TEXT,
        symbol TEXT NOT NULL,
        trade_type TEXT NOT NULL,
        direction TEXT NOT NULL,
        amount REAL NOT NULL,
        duration INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        entry_price REAL,
        exit_price REAL,
        profit REAL,
        ai_consensus TEXT NOT NULL,
        isRecoveryMode INTEGER DEFAULT 0,
        recovery_multiplier REAL DEFAULT 1.0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS market_data (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        symbol TEXT NOT NULL,
        current_price REAL NOT NULL,
        price_history TEXT NOT NULL,
        last_update DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_simulated INTEGER DEFAULT 0 NOT NULL
      )
    `);

    // LOSS RECOVERY SYSTEM TABLES
    
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS daily_pnl (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL,
        date TEXT NOT NULL,
        opening_balance REAL NOT NULL,
        current_balance REAL NOT NULL,
        daily_pnl REAL NOT NULL,
        total_trades INTEGER DEFAULT 0,
        won_trades INTEGER DEFAULT 0,
        lost_trades INTEGER DEFAULT 0,
        is_recovery_active INTEGER DEFAULT 0,
        recovery_threshold REAL DEFAULT 0.75,
        max_drawdown REAL DEFAULT 0,
        recovery_operations INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS ai_recovery_strategies (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL,
        strategy_name TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        parameters TEXT NOT NULL,
        success_rate REAL DEFAULT 0,
        total_recoveries INTEGER DEFAULT 0,
        avg_recovery_time REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Adicionar colunas que podem não existir em DBs antigos
    try {
      sqlite.exec(`ALTER TABLE users ADD COLUMN documentos_aprovados_em DATETIME`);
    } catch (error) {
      // Coluna já existe, ignorar erro
    }
    
    try {
      sqlite.exec(`ALTER TABLE market_data ADD COLUMN is_simulated INTEGER DEFAULT 0 NOT NULL`);
    } catch (error) {
      // Coluna já existe, ignorar erro
    }

    // Migração final da coluna isRecoveryMode
    try {
      // Verificar se a coluna antiga existe e renomear
      const checkCol = sqlite.prepare("PRAGMA table_info(trade_operations)").all();
      const hasOldCol = checkCol.some((col: any) => col.name === 'is_recovery_mode');
      const hasNewCol = checkCol.some((col: any) => col.name === 'isRecoveryMode');
      
      if (hasOldCol && !hasNewCol) {
        console.log('🔧 Migrando coluna is_recovery_mode -> isRecoveryMode');
        sqlite.exec(`ALTER TABLE trade_operations RENAME COLUMN is_recovery_mode TO isRecoveryMode`);
        console.log('✅ Migração de coluna concluída');
      } else if (!hasOldCol && !hasNewCol) {
        console.log('🆕 Adicionando coluna isRecoveryMode');
        sqlite.exec(`ALTER TABLE trade_operations ADD COLUMN isRecoveryMode INTEGER DEFAULT 0`);
        console.log('✅ Coluna isRecoveryMode adicionada');
      } else {
        console.log('✅ Coluna isRecoveryMode já está correta');
      }
    } catch (error) {
      console.error('⚠️ Erro na migração da coluna:', error);
    }

    // Adicionar coluna conservative_operations na tabela daily_pnl
    try {
      const checkPnlCols = sqlite.prepare("PRAGMA table_info(daily_pnl)").all();
      const hasConservativeOps = checkPnlCols.some((col: any) => col.name === 'conservative_operations');
      
      if (!hasConservativeOps) {
        console.log('🆕 Adicionando coluna conservative_operations na tabela daily_pnl');
        sqlite.exec(`ALTER TABLE daily_pnl ADD COLUMN conservative_operations INTEGER DEFAULT 0`);
        console.log('✅ Coluna conservative_operations adicionada com sucesso');
      } else {
        console.log('✅ Coluna conservative_operations já existe');
      }
    } catch (error) {
      console.error('⚠️ Erro ao adicionar coluna conservative_operations:', error);
    }

    // Adicionar coluna is_conservative_forced na tabela trade_operations
    try {
      const checkOpsCols = sqlite.prepare("PRAGMA table_info(trade_operations)").all();
      const hasConservativeForced = checkOpsCols.some((col: any) => col.name === 'is_conservative_forced');
      
      if (!hasConservativeForced) {
        console.log('🆕 Adicionando coluna is_conservative_forced na tabela trade_operations');
        sqlite.exec(`ALTER TABLE trade_operations ADD COLUMN is_conservative_forced INTEGER DEFAULT 0`);
        console.log('✅ Coluna is_conservative_forced adicionada com sucesso');
      } else {
        console.log('✅ Coluna is_conservative_forced já existe');
      }
    } catch (error) {
      console.error('⚠️ Erro ao adicionar coluna is_conservative_forced:', error);
    }

    // SISTEMA DE RESILIÊNCIA E AUTO-RESTART

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS active_trading_sessions (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        session_key TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        config_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        operations_count INTEGER NOT NULL,
        executed_operations INTEGER NOT NULL DEFAULT 0,
        interval_type TEXT NOT NULL,
        interval_value INTEGER NOT NULL,
        last_execution_time DATETIME,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (config_id) REFERENCES trade_configurations(id)
      )
    `);

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS active_websocket_subscriptions (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        symbol TEXT NOT NULL,
        subscription_id TEXT NOT NULL,
        subscription_type TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS system_health_heartbeat (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        component_name TEXT NOT NULL UNIQUE,
        last_heartbeat DATETIME NOT NULL,
        status TEXT NOT NULL DEFAULT 'healthy',
        error_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        metadata TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Banco de dados local inicializado com sucesso!');
    console.log('🛡️ Sistema de resiliência e auto-restart configurado!');
    console.log(`📍 Local do arquivo: ${dbPath}`);
    
    return true;
  } catch (error) {
    console.error('❌ Erro ao inicializar banco de dados:', error);
    throw error;
  }
}