import { pgDb, pgSchema } from './db-postgres';
import { eq, sql } from 'drizzle-orm';

/**
 * Script de migração para criar tabelas PostgreSQL
 * Executar com: npm run migrate:postgres
 */
async function migratePostgres() {
  console.log('🚀 Iniciando migração PostgreSQL...');
  
  try {
    // Ativar extensão pgcrypto para gen_random_uuid()
    await pgDb.execute(sql`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
    console.log('✅ Extensão pgcrypto ativada');

    const platformId = String(process.env.INVISTA_PLATFORM ?? "").trim().toLowerCase();
    if (platformId !== "v10" && platformId !== "aura") {
      throw new Error("INVISTA_PLATFORM must be set to 'v10' or 'aura' before enabling Neon persistence.");
    }
    await pgDb.execute(sql`
      CREATE TABLE IF NOT EXISTS invista_database_identity (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        platform_id VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        essential_backfill_completed_at TIMESTAMP
      )
    `);
    await pgDb.execute(sql`ALTER TABLE invista_database_identity ADD COLUMN IF NOT EXISTS essential_backfill_completed_at TIMESTAMP`);
    await pgDb.insert(pgSchema.invistaDatabaseIdentity).values({ id: 1, platformId }).onConflictDoNothing();
    const [databaseIdentity] = await pgDb.select().from(pgSchema.invistaDatabaseIdentity)
      .where(eq(pgSchema.invistaDatabaseIdentity.id, 1));
    if (!databaseIdentity || databaseIdentity.platformId !== platformId) {
      throw new Error(`Neon database platform mismatch: configured=${platformId}, database=${databaseIdentity?.platformId ?? "unclaimed"}. Use a separate Neon database per platform.`);
    }
    console.log(`🔒 [NEON] Banco isolado confirmado para plataforma ${platformId}.`);
    
    // Criar tabela de sessões
    await pgDb.execute(sql`
      CREATE TABLE IF NOT EXISTS sessions (
        sid VARCHAR(255) PRIMARY KEY,
        sess TEXT NOT NULL,
        expire TIMESTAMP NOT NULL
      );
    `);
    
    await pgDb.execute(sql`
      CREATE INDEX IF NOT EXISTS IDX_session_expire ON sessions(expire);
    `);
    
    // Criar tabela de usuários
    await pgDb.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        nome_completo TEXT NOT NULL,
        cpf VARCHAR(14) UNIQUE NOT NULL,
        telefone VARCHAR(15) NOT NULL,
        endereco TEXT NOT NULL,
        cidade VARCHAR(100) NOT NULL,
        estado VARCHAR(2) NOT NULL,
        cep VARCHAR(9) NOT NULL,
        chave_pix TEXT NOT NULL,
        tipo_chave_pix VARCHAR(50) NOT NULL,
        telefone_verificado BOOLEAN DEFAULT FALSE,
        codigo_verificacao VARCHAR(10),
        codigo_expires_at TIMESTAMP,
        password_reset_token VARCHAR(255),
        password_reset_token_expires_at TIMESTAMP,
        conta_aprovada BOOLEAN DEFAULT TRUE,
        aprovada_por VARCHAR(255),
        aprovada_em TIMESTAMP,
        documentos_verificados BOOLEAN DEFAULT FALSE,
        documentos_aprovados_em TIMESTAMP,
        is_admin BOOLEAN DEFAULT FALSE,
        senha_fallback TEXT,
        usar_senha_fallback BOOLEAN DEFAULT FALSE,
        biometria_configurada BOOLEAN DEFAULT FALSE,
        saldo REAL DEFAULT 0.00 NOT NULL,
        deposito_data TIMESTAMP,
        rendimento_saque_automatico BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // Criar tabela de movimentos
    await pgDb.execute(sql`
      CREATE TABLE IF NOT EXISTS movimentos (
        id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
        user_id VARCHAR(32) NOT NULL REFERENCES users(id),
        tipo VARCHAR(50) NOT NULL,
        valor REAL NOT NULL,
        descricao TEXT,
        pix_string TEXT,
        biometria_verificada BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // Criar tabela de documentos
    await pgDb.execute(sql`
      CREATE TABLE IF NOT EXISTS documentos (
        id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
        user_id VARCHAR(32) NOT NULL REFERENCES users(id),
        tipo VARCHAR(100) NOT NULL,
        arquivo TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'pendente',
        motivo_rejeicao TEXT,
        aprovado_por VARCHAR(255),
        aprovado_em TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // Criar tabela KYC
    await pgDb.execute(sql`
      CREATE TABLE IF NOT EXISTS kyc_status (
        id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
        user_id VARCHAR(32) NOT NULL REFERENCES users(id),
        status VARCHAR(50) DEFAULT 'pending',
        rg_cnh_frente_status VARCHAR(50) DEFAULT 'pending',
        rg_cnh_verso_status VARCHAR(50) DEFAULT 'pending',
        comprovante_residencia_status VARCHAR(50) DEFAULT 'pending',
        completed_at TIMESTAMP,
        approved_at TIMESTAMP,
        rejected_at TIMESTAMP,
        rejection_reason TEXT,
        reviewed_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // Criar tabelas de trading
    await pgDb.execute(sql`
      CREATE TABLE IF NOT EXISTS deriv_tokens (
        id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
        user_id VARCHAR(32) NOT NULL REFERENCES users(id),
        token TEXT NOT NULL,
        account_type VARCHAR(20) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        slot_index INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pgDb.execute(sql`
      CREATE TABLE IF NOT EXISTS trade_configurations (
        id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
        user_id VARCHAR(32) NOT NULL REFERENCES users(id),
        mode VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT FALSE,
        operations_count INTEGER NOT NULL,
        interval_type VARCHAR(20) NOT NULL,
        interval_value INTEGER NOT NULL,
        selected_modalities TEXT DEFAULT 'digit_differs',
        accu_growth_rates TEXT DEFAULT '["1","2","3","4","5"]',
        modality_frequency TEXT DEFAULT '{}',
        accu_ticks_per_rate TEXT DEFAULT '{"1":10,"2":7,"3":5,"4":4,"5":3}',
        accu_frequency_per_rate TEXT DEFAULT '{}',
        modality_ticks TEXT DEFAULT '{}',
        enable_martingale BOOLEAN DEFAULT TRUE,
        enable_leverage BOOLEAN DEFAULT TRUE,
        enable_circuit_breaker BOOLEAN DEFAULT TRUE,
        enable_recovery_mode BOOLEAN DEFAULT TRUE,
        martingale_multipliers TEXT DEFAULT '[1.3,1.6,2.0]',
        circuit_breaker_losses INTEGER DEFAULT 1,
        circuit_breaker_pause_minutes INTEGER DEFAULT 2,
        stake_mode TEXT DEFAULT 'ai',
        fixed_stake REAL DEFAULT 0.35,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Migração: adicionar coluna selected_modalities se não existir (PostgreSQL)
    try {
      await pgDb.execute(sql`
        ALTER TABLE trade_configurations ADD COLUMN IF NOT EXISTS selected_modalities TEXT DEFAULT 'digit_differs'
      `);
    } catch (e: any) {
      if (!e.message?.includes('already exists')) {
        console.error('Aviso ao adicionar selected_modalities no PG:', e.message);
      }
    }

    await pgDb.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_logs (
        id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
        user_id VARCHAR(32) NOT NULL REFERENCES users(id),
        model_name VARCHAR(100) NOT NULL,
        analysis TEXT NOT NULL,
        decision VARCHAR(20) NOT NULL,
        confidence REAL NOT NULL,
        market_data TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pgDb.execute(sql`
      CREATE TABLE IF NOT EXISTS trade_operations (
        id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
        user_id VARCHAR(32) NOT NULL REFERENCES users(id),
        deriv_contract_id VARCHAR(100),
        symbol VARCHAR(50) NOT NULL,
        trade_type VARCHAR(50) NOT NULL,
        direction VARCHAR(10) NOT NULL,
        amount REAL NOT NULL,
        duration INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        entry_price REAL,
        exit_price REAL,
        profit REAL,
        ai_consensus TEXT NOT NULL,
        "isRecoveryMode" BOOLEAN DEFAULT FALSE,
        recovery_multiplier REAL DEFAULT 1.0,
        is_conservative_forced BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      );
    `);
    
    await pgDb.execute(sql`
      ALTER TABLE trade_operations ADD COLUMN IF NOT EXISTS operation_mode VARCHAR(100) DEFAULT 'Operação Ordinária'
    `);

    await pgDb.execute(sql`
      CREATE TABLE IF NOT EXISTS market_data (
        id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
        symbol VARCHAR(50) NOT NULL,
        current_price REAL NOT NULL,
        price_history TEXT NOT NULL,
        last_update TIMESTAMP DEFAULT NOW(),
        is_simulated BOOLEAN DEFAULT FALSE NOT NULL
      );
    `);

    await pgDb.execute(sql`
      CREATE TABLE IF NOT EXISTS trading_control (
        id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
        is_paused BOOLEAN DEFAULT FALSE,
        paused_by TEXT,
        paused_at TIMESTAMP,
        pause_reason TEXT,
        resumed_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pgDb.execute(sql`
      CREATE TABLE IF NOT EXISTS daily_pnl (
        id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
        user_id VARCHAR(32) NOT NULL REFERENCES users(id),
        date VARCHAR(10) NOT NULL,
        opening_balance REAL NOT NULL,
        current_balance REAL NOT NULL,
        daily_pnl REAL NOT NULL,
        total_trades INTEGER DEFAULT 0,
        won_trades INTEGER DEFAULT 0,
        lost_trades INTEGER DEFAULT 0,
        conservative_operations INTEGER DEFAULT 0,
        is_recovery_active BOOLEAN DEFAULT FALSE,
        recovery_threshold REAL DEFAULT 0.75,
        max_drawdown REAL DEFAULT 0,
        recovery_operations INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await pgDb.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_recovery_strategies (
        id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
        user_id VARCHAR(32) NOT NULL REFERENCES users(id),
        strategy_name VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        parameters TEXT NOT NULL,
        success_rate REAL DEFAULT 0,
        total_recoveries INTEGER DEFAULT 0,
        avg_recovery_time REAL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    // Idempotent upgrades for Neon databases created by earlier releases.
    await pgDb.execute(sql`ALTER TABLE deriv_tokens ADD COLUMN IF NOT EXISTS slot_index INTEGER`);
    await pgDb.execute(sql`ALTER TABLE trade_configurations ADD COLUMN IF NOT EXISTS selected_modalities TEXT DEFAULT 'digit_differs'`);
    await pgDb.execute(sql`ALTER TABLE trade_configurations ADD COLUMN IF NOT EXISTS accu_growth_rates TEXT DEFAULT '["1","2","3","4","5"]'`);
    await pgDb.execute(sql`ALTER TABLE trade_configurations ADD COLUMN IF NOT EXISTS modality_frequency TEXT DEFAULT '{}'`);
    await pgDb.execute(sql`ALTER TABLE trade_configurations ADD COLUMN IF NOT EXISTS accu_ticks_per_rate TEXT DEFAULT '{"1":10,"2":7,"3":5,"4":4,"5":3}'`);
    await pgDb.execute(sql`ALTER TABLE trade_configurations ADD COLUMN IF NOT EXISTS accu_frequency_per_rate TEXT DEFAULT '{}'`);
    await pgDb.execute(sql`ALTER TABLE trade_configurations ADD COLUMN IF NOT EXISTS modality_ticks TEXT DEFAULT '{}'`);
    await pgDb.execute(sql`ALTER TABLE trade_configurations ADD COLUMN IF NOT EXISTS enable_martingale BOOLEAN DEFAULT TRUE`);
    await pgDb.execute(sql`ALTER TABLE trade_configurations ADD COLUMN IF NOT EXISTS enable_leverage BOOLEAN DEFAULT TRUE`);
    await pgDb.execute(sql`ALTER TABLE trade_configurations ADD COLUMN IF NOT EXISTS enable_circuit_breaker BOOLEAN DEFAULT TRUE`);
    await pgDb.execute(sql`ALTER TABLE trade_configurations ADD COLUMN IF NOT EXISTS enable_recovery_mode BOOLEAN DEFAULT TRUE`);
    await pgDb.execute(sql`ALTER TABLE trade_configurations ADD COLUMN IF NOT EXISTS martingale_multipliers TEXT DEFAULT '[1.3,1.6,2.0]'`);
    await pgDb.execute(sql`ALTER TABLE trade_configurations ADD COLUMN IF NOT EXISTS circuit_breaker_losses INTEGER DEFAULT 1`);
    await pgDb.execute(sql`ALTER TABLE trade_configurations ADD COLUMN IF NOT EXISTS circuit_breaker_pause_minutes INTEGER DEFAULT 2`);
    await pgDb.execute(sql`ALTER TABLE trade_configurations ADD COLUMN IF NOT EXISTS stake_mode TEXT DEFAULT 'ai'`);
    await pgDb.execute(sql`ALTER TABLE trade_configurations ADD COLUMN IF NOT EXISTS fixed_stake REAL DEFAULT 0.35`);
    await pgDb.execute(sql`
      CREATE TABLE IF NOT EXISTS modality_module_configs (
        id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
        user_id VARCHAR(32) NOT NULL REFERENCES users(id),
        modality VARCHAR(100) NOT NULL,
        slot_configs TEXT NOT NULL DEFAULT '[]',
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE (user_id, modality)
      )
    `);

    // Normalize legacy duplicates before adding database-level active-slot invariants.
    await pgDb.execute(sql`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY user_id, slot_index
          ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC
        ) AS row_num
        FROM deriv_tokens
        WHERE is_active = TRUE
      )
      UPDATE deriv_tokens AS token
      SET is_active = FALSE, updated_at = NOW()
      WHERE token.id IN (SELECT id FROM ranked WHERE row_num > 1)
    `);
    await pgDb.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_deriv_tokens_one_active_slot
      ON deriv_tokens (user_id, slot_index)
      WHERE is_active = TRUE AND slot_index IS NOT NULL
    `);
    await pgDb.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_deriv_tokens_one_active_primary
      ON deriv_tokens (user_id)
      WHERE is_active = TRUE AND slot_index IS NULL
    `);

    await pgDb.execute(sql`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY user_id
          ORDER BY COALESCE(updated_at, created_at) DESC NULLS LAST, id DESC
        ) AS row_num
        FROM trade_configurations
        WHERE is_active = TRUE
      )
      UPDATE trade_configurations AS config
      SET is_active = FALSE, updated_at = NOW()
      WHERE config.id IN (SELECT id FROM ranked WHERE row_num > 1)
    `);
    await pgDb.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_trade_configurations_one_active_per_user
      ON trade_configurations (user_id)
      WHERE is_active = TRUE
    `);

    console.log('✅ Tabelas PostgreSQL criadas com sucesso!');

    // Neon is the durable source of truth. Missing essential local records are
    // imported once by backfillMissingEssentialDataToNeon after schema migration.
    console.log('ℹ️ Backfill massivo SQLite → Neon desativado; histórico e mercado não são enviados.');

    console.log('🔄 Sistema Dual Database pronto para uso');
    
  } catch (error) {
    console.error('❌ Erro na migração PostgreSQL:', error);
    throw error;
  }
}

// Exportar função para ser chamada ao inicializar o servidor
export async function runPostgresMigration() {
  // Let the boot coordinator classify failures and retry transient database outages.
  // Returning false here hid the original cause and prevented reliable recovery.
  await migratePostgres();
  console.log('🎉 Migração PostgreSQL concluída com sucesso!');
  return true;
}
