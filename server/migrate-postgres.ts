import { pgDb, pgSchema } from './db-postgres';
import { sql } from 'drizzle-orm';
import { db as sqliteDb } from './db';
import * as sqliteSchema from '@shared/schema';

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
    
    console.log('✅ Tabelas PostgreSQL criadas com sucesso!');

    // Helper: converte texto SQLite de data para string ISO compatível com Postgres
    const toIso = (v: string | null | undefined): string | null => {
      if (!v) return null;
      try {
        const d = new Date(v);
        return isNaN(d.getTime()) ? null : d.toISOString();
      } catch { return null; }
    };
    const nowIso = () => new Date().toISOString();

    // 🔄 SINCRONIZAR USUÁRIOS DO SQLITE → NEON (garante que admin e outros usuários existam)
    try {
      console.log('🔄 [SYNC] Sincronizando usuários SQLite → Neon PostgreSQL...');
      const sqliteUsers = await sqliteDb.select().from(sqliteSchema.users);
      let synced = 0;
      let skipped = 0;
      for (const user of sqliteUsers) {
        try {
          await pgDb.execute(sql`
            INSERT INTO users (
              id, email, password_hash, nome_completo, cpf, telefone,
              endereco, cidade, estado, cep,
              chave_pix, tipo_chave_pix,
              telefone_verificado, codigo_verificacao, codigo_expires_at,
              password_reset_token, password_reset_token_expires_at,
              conta_aprovada, aprovada_por, aprovada_em,
              documentos_verificados, documentos_aprovados_em,
              is_admin, senha_fallback, usar_senha_fallback, biometria_configurada,
              saldo, deposito_data, rendimento_saque_automatico,
              created_at, updated_at
            ) VALUES (
              ${user.id}, ${user.email}, ${user.passwordHash}, ${user.nomeCompleto}, ${user.cpf}, ${user.telefone},
              ${user.endereco}, ${user.cidade}, ${user.estado}, ${user.cep},
              ${user.chavePix}, ${user.tipoChavePix},
              ${Boolean(user.telefoneVerificado)}, ${user.codigoVerificacao ?? null}, ${toIso(user.codigoExpiresAt)},
              ${user.passwordResetToken ?? null}, ${toIso(user.passwordResetTokenExpiresAt)},
              ${Boolean(user.contaAprovada)}, ${user.aprovadaPor ?? null}, ${toIso(user.aprovadaEm)},
              ${Boolean(user.documentosVerificados)}, ${toIso(user.documentosAprovadosEm)},
              ${Boolean(user.isAdmin)}, ${user.senhaFallback ?? null}, ${Boolean(user.usarSenhaFallback)}, ${Boolean(user.biometriaConfigurada)},
              ${user.saldo ?? 0}, ${toIso(user.depositoData)}, ${Boolean(user.rendimentoSaqueAutomatico)},
              ${toIso(user.createdAt) ?? nowIso()}, ${toIso(user.updatedAt) ?? nowIso()}
            )
            ON CONFLICT (id) DO UPDATE SET
              saldo = EXCLUDED.saldo,
              updated_at = EXCLUDED.updated_at
          `);
          synced++;
        } catch (userErr: any) {
          if (userErr.message?.includes('unique') || userErr.message?.includes('duplicate')) {
            skipped++;
          } else {
            console.warn(`⚠️ [SYNC] Erro ao sincronizar usuário ${user.id}:`, userErr.message);
          }
        }
      }
      console.log(`✅ [SYNC] Usuários sincronizados: ${synced} inseridos/atualizados, ${skipped} ignorados (conflito)`);
    } catch (syncErr: any) {
      console.warn('⚠️ [SYNC] Falha ao sincronizar usuários (não crítico):', syncErr.message);
    }

    // 🔄 SINCRONIZAR TOKENS DERIV DO SQLITE → NEON
    try {
      const sqliteTokens = await sqliteDb.select().from(sqliteSchema.derivTokens);
      let tokensSynced = 0;
      for (const token of sqliteTokens) {
        try {
          await pgDb.execute(sql`
            INSERT INTO deriv_tokens (id, user_id, token, account_type, is_active, created_at, updated_at)
            VALUES (${token.id}, ${token.userId}, ${token.token}, ${token.accountType}, ${Boolean(token.isActive)},
                    ${toIso(token.createdAt) ?? nowIso()}, ${toIso(token.updatedAt) ?? nowIso()})
            ON CONFLICT (id) DO UPDATE SET
              token = EXCLUDED.token,
              is_active = EXCLUDED.is_active,
              updated_at = EXCLUDED.updated_at
          `);
          tokensSynced++;
        } catch (_) {}
      }
      if (tokensSynced > 0) console.log(`✅ [SYNC] Tokens Deriv sincronizados: ${tokensSynced}`);
    } catch (tokenErr: any) {
      console.warn('⚠️ [SYNC] Falha ao sincronizar tokens Deriv (não crítico):', tokenErr.message);
    }

    // 🔄 SINCRONIZAR TRADE CONFIGURATIONS DO SQLITE → NEON
    try {
      const sqliteConfigs = await sqliteDb.select().from(sqliteSchema.tradeConfigurations);
      let configsSynced = 0;
      for (const config of sqliteConfigs) {
        try {
          await pgDb.execute(sql`
            INSERT INTO trade_configurations (id, user_id, mode, is_active, operations_count, interval_type, interval_value, selected_modalities, created_at, updated_at)
            VALUES (${config.id}, ${config.userId}, ${config.mode}, ${Boolean(config.isActive)}, ${config.operationsCount},
                    ${config.intervalType}, ${config.intervalValue}, ${config.selectedModalities ?? 'digit_differs'},
                    ${toIso(config.createdAt) ?? nowIso()}, ${toIso(config.updatedAt) ?? nowIso()})
            ON CONFLICT (id) DO UPDATE SET
              is_active = EXCLUDED.is_active,
              selected_modalities = EXCLUDED.selected_modalities,
              updated_at = EXCLUDED.updated_at
          `);
          configsSynced++;
        } catch (_) {}
      }
      if (configsSynced > 0) console.log(`✅ [SYNC] Trade Configurations sincronizadas: ${configsSynced}`);
    } catch (configErr: any) {
      console.warn('⚠️ [SYNC] Falha ao sincronizar trade configurations (não crítico):', configErr.message);
    }

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
