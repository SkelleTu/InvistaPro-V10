import { pgDb, pgSchema } from './db-postgres';
import { sql } from 'drizzle-orm';

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
        slot_index INTEGER DEFAULT 0,
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

    // Migração: adicionar coluna operation_mode se não existir (PostgreSQL)
    try {
      await pgDb.execute(sql`
        ALTER TABLE trade_operations ADD COLUMN IF NOT EXISTS operation_mode VARCHAR(100) DEFAULT 'Operação Ordinária'
      `);
    } catch (e: any) {
      if (!e.message?.includes('already exists')) {
        console.error('Aviso ao adicionar operation_mode no PG:', e.message);
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
    
    // Idempotent upgrades for existing Neon databases.
    await pgDb.execute(sql`ALTER TABLE deriv_tokens ADD COLUMN IF NOT EXISTS slot_index INTEGER DEFAULT 0`);
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

    console.log('✅ Tabelas PostgreSQL criadas com sucesso!');

    // Neon is the durable source of truth. Never bulk-copy SQLite into Neon at boot.
    // Local restoration is handled by neon-sqlite-sync after schema migration.
    console.log('ℹ️ Backfill SQLite → Neon desativado; a Neon não será sobrescrita por dados locais antigos.');

    console.log('🔄 Sistema Dual Database pronto para uso');
    
  } catch (error) {
    console.error('❌ Erro na migração PostgreSQL:', error);
    throw error;
  }
}

// Exportar função para ser chamada ao inicializar o servidor
export async function runPostgresMigration() {
  try {
    await migratePostgres();
    console.log('🎉 Migração PostgreSQL concluída com sucesso!');
    return true;
  } catch (error) {
    console.error('❌ Falha na migração PostgreSQL:', error);
    return false;
  }
}
