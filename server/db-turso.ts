import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from "@shared/schema";

let tursoDb: ReturnType<typeof drizzle> | null = null;
let tursoClient: Client | null = null;
let isTursoAvailable = false;

try {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  if (tursoUrl && tursoToken) {
    tursoClient = createClient({
      url: tursoUrl,
      authToken: tursoToken,
    });

    tursoDb = drizzle(tursoClient, { schema });
    isTursoAvailable = true;

    console.log('✅ Turso (libSQL) conectado - Banco principal ATIVO');
    console.log(`   • URL: ${tursoUrl.replace(/\/\/.*@/, '//***//')}`);
  } else {
    if (!tursoUrl) console.warn('⚠️ TURSO_DATABASE_URL não configurada');
    if (!tursoToken) console.warn('⚠️ TURSO_AUTH_TOKEN não configurado');
    console.warn('⚠️ Turso não disponível - usando SQLite local como fallback');
  }
} catch (error) {
  console.error('❌ Erro ao conectar ao Turso:', error);
  console.warn('⚠️ Continuando com SQLite local');
}

export { tursoDb, isTursoAvailable };

export async function initializeTursoDatabase(): Promise<boolean> {
  if (!tursoClient || !isTursoAvailable) return false;

  try {
    console.log('🗄️ Inicializando tabelas no Turso...');

    const stmts = [
      `CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expire TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS IDX_session_expire ON sessions(expire)`,
      `CREATE TABLE IF NOT EXISTS users (
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
        codigo_expires_at TEXT,
        password_reset_token TEXT,
        password_reset_token_expires_at TEXT,
        conta_aprovada INTEGER DEFAULT 1,
        aprovada_por TEXT,
        aprovada_em TEXT,
        documentos_verificados INTEGER DEFAULT 0,
        documentos_aprovados_em TEXT,
        is_admin INTEGER DEFAULT 0,
        senha_fallback TEXT,
        usar_senha_fallback INTEGER DEFAULT 0,
        biometria_configurada INTEGER DEFAULT 0,
        saldo REAL DEFAULT 0.00 NOT NULL,
        deposito_data TEXT,
        rendimento_saque_automatico INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS movimentos (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL,
        tipo TEXT NOT NULL,
        valor REAL NOT NULL,
        descricao TEXT,
        pix_string TEXT,
        biometria_verificada INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,
      `CREATE TABLE IF NOT EXISTS documentos (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL,
        tipo TEXT NOT NULL,
        arquivo TEXT NOT NULL,
        status TEXT DEFAULT 'pendente',
        motivo_rejeicao TEXT,
        aprovado_por TEXT,
        aprovado_em TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,
      `CREATE TABLE IF NOT EXISTS kyc_status (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        rg_cnh_frente_status TEXT DEFAULT 'pending',
        rg_cnh_verso_status TEXT DEFAULT 'pending',
        comprovante_residencia_status TEXT DEFAULT 'pending',
        completed_at TEXT,
        approved_at TEXT,
        rejected_at TEXT,
        rejection_reason TEXT,
        reviewed_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,
      `CREATE TABLE IF NOT EXISTS deriv_tokens (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL,
        token TEXT NOT NULL,
        account_type TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,
      `CREATE TABLE IF NOT EXISTS trade_configurations (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        is_active INTEGER DEFAULT 0,
        operations_count INTEGER NOT NULL,
        interval_type TEXT NOT NULL,
        interval_value INTEGER NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,
      `CREATE TABLE IF NOT EXISTS ai_logs (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL,
        model_name TEXT NOT NULL,
        analysis TEXT NOT NULL,
        decision TEXT NOT NULL,
        confidence REAL NOT NULL,
        market_data TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,
      `CREATE TABLE IF NOT EXISTS trade_operations (
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
        shortcode TEXT,
        buy_price REAL,
        sell_price REAL,
        entry_epoch INTEGER,
        exit_epoch INTEGER,
        contract_type TEXT,
        barrier TEXT,
        deriv_status TEXT,
        deriv_profit REAL,
        payout REAL,
        status_changed_at TEXT,
        last_sync_at TEXT,
        sync_count INTEGER DEFAULT 0,
        is_conservative_forced INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,
      `CREATE TABLE IF NOT EXISTS market_data (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        symbol TEXT NOT NULL,
        current_price REAL NOT NULL,
        price_history TEXT NOT NULL,
        last_update TEXT DEFAULT CURRENT_TIMESTAMP,
        is_simulated INTEGER DEFAULT 0 NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS daily_pnl (
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
        conservative_operations INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,
      `CREATE TABLE IF NOT EXISTS ai_recovery_strategies (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL,
        strategy_name TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        parameters TEXT NOT NULL,
        success_rate REAL DEFAULT 0,
        total_recoveries INTEGER DEFAULT 0,
        avg_recovery_time REAL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,
      `CREATE TABLE IF NOT EXISTS active_trading_sessions (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        session_key TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        config_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        operations_count INTEGER NOT NULL,
        executed_operations INTEGER NOT NULL DEFAULT 0,
        interval_type TEXT NOT NULL,
        interval_value INTEGER NOT NULL,
        last_execution_time TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,
      `CREATE TABLE IF NOT EXISTS active_websocket_subscriptions (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        symbol TEXT NOT NULL,
        subscription_id TEXT NOT NULL,
        subscription_type TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS system_health_heartbeat (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        component_name TEXT NOT NULL UNIQUE,
        last_heartbeat TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'healthy',
        error_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        metadata TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS trading_control (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        is_paused INTEGER DEFAULT 0,
        paused_by TEXT,
        paused_at TEXT,
        pause_reason TEXT,
        resumed_at TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS asset_blacklist (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL,
        asset_pattern TEXT NOT NULL,
        pattern_type TEXT NOT NULL DEFAULT 'exact',
        reason TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,
      `CREATE TABLE IF NOT EXISTS pause_configuration (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL UNIQUE,
        is_paused_now INTEGER DEFAULT 0,
        auto_pause_enabled INTEGER DEFAULT 0,
        pause_after_loss_streak INTEGER DEFAULT 3,
        pause_after_daily_loss_percent REAL DEFAULT 0.1,
        resume_after_minutes INTEGER DEFAULT 60,
        last_pause_started_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,
      `CREATE TABLE IF NOT EXISTS blocked_assets (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        user_id TEXT NOT NULL,
        trade_mode TEXT NOT NULL,
        symbol TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`,
      `CREATE TABLE IF NOT EXISTS experiment_tracking (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        experiment_type TEXT NOT NULL,
        experiment_name TEXT NOT NULL,
        parameters TEXT NOT NULL,
        results TEXT NOT NULL,
        performance TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS dynamic_weights (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        model_name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        base_weight REAL NOT NULL,
        current_weight REAL NOT NULL,
        performance REAL NOT NULL,
        profitability REAL NOT NULL,
        cooperation_score REAL NOT NULL,
        adaptation_rate REAL NOT NULL DEFAULT 0.1,
        update_reason TEXT NOT NULL,
        last_updated TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS episodic_memory (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        symbol TEXT NOT NULL,
        market_state TEXT NOT NULL,
        action TEXT NOT NULL,
        reward REAL NOT NULL,
        next_state TEXT,
        episode TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 1.0,
        timestamp TEXT NOT NULL,
        decay REAL NOT NULL DEFAULT 1.0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS emergent_patterns (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        symbol TEXT NOT NULL,
        pattern_type TEXT NOT NULL,
        pattern_data TEXT NOT NULL,
        confidence REAL NOT NULL,
        frequency INTEGER NOT NULL,
        profitability REAL,
        status TEXT NOT NULL DEFAULT 'testing',
        detected_at TEXT NOT NULL,
        last_seen TEXT NOT NULL,
        validation_count INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS strategy_evolution (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        parent_strategy TEXT,
        strategy_code TEXT NOT NULL,
        generation INTEGER NOT NULL,
        mutation TEXT NOT NULL,
        fitness REAL NOT NULL,
        backtest_results TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'candidate',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        promoted_at TEXT,
        retired_at TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS meta_learning (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        source_symbol TEXT NOT NULL,
        target_symbol TEXT NOT NULL,
        transfer_type TEXT NOT NULL,
        transfer_data TEXT NOT NULL,
        effectiveness REAL NOT NULL,
        confidence REAL NOT NULL,
        applicability REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'testing',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_applied TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS performance_analytics (
        id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
        analysis_type TEXT NOT NULL,
        timeframe TEXT NOT NULL,
        symbol TEXT NOT NULL,
        metrics TEXT NOT NULL,
        insights TEXT NOT NULL,
        recommendations TEXT NOT NULL,
        confidence REAL NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`,
    ];

    for (const sql of stmts) {
      await (tursoDb as any).run(sql);
    }

    // Migração: adicionar selected_modalities se não existir
    try {
      await (tursoDb as any).run(`ALTER TABLE trade_configurations ADD COLUMN selected_modalities TEXT DEFAULT 'digit_differs'`);
    } catch (e: any) {
      // Coluna já existe - ignorar
    }

    console.log('✅ Tabelas Turso inicializadas com sucesso!');
    return true;
  } catch (error) {
    console.error('❌ Erro ao inicializar tabelas no Turso:', error);
    return false;
  }
}
