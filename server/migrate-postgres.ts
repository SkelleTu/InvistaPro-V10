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
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
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
    
    console.log('✅ Tabelas PostgreSQL criadas com sucesso!');
    console.log('🔄 Sistema Dual Database pronto para uso');
    
  } catch (error) {
    console.error('❌ Erro na migração PostgreSQL:', error);
    throw error;
  }
}

// Executar migração
migratePostgres()
  .then(() => {
    console.log('🎉 Migração concluída com sucesso!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Falha na migração:', error);
    process.exit(1);
  });
