-- ============================================
-- INVESTPRO - SCHEMA COMPLETO PARA NEON
-- PostgreSQL SQL para copiar e colar no editor SQL do Neon
-- ============================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- TABELAS PRINCIPAIS
-- ============================================

-- Tabela de Sessões
CREATE TABLE IF NOT EXISTS sessions (
  sid VARCHAR(255) PRIMARY KEY,
  sess TEXT NOT NULL,
  expire TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_expire ON sessions(expire);

-- Tabela de Usuários
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  
  -- Autenticação
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  
  -- Dados pessoais
  nome_completo TEXT NOT NULL,
  cpf VARCHAR(14) UNIQUE NOT NULL,
  telefone VARCHAR(15) NOT NULL,
  
  -- Endereço
  endereco TEXT NOT NULL,
  cidade VARCHAR(100) NOT NULL,
  estado VARCHAR(2) NOT NULL,
  cep VARCHAR(9) NOT NULL,
  
  -- PIX
  chave_pix TEXT NOT NULL,
  tipo_chave_pix VARCHAR(50) NOT NULL,
  
  -- Verificação
  telefone_verificado BOOLEAN DEFAULT FALSE,
  codigo_verificacao VARCHAR(10),
  codigo_expires_at TIMESTAMP,
  
  -- Recuperação de senha
  password_reset_token VARCHAR(255),
  password_reset_token_expires_at TIMESTAMP,
  
  -- Status da conta
  conta_aprovada BOOLEAN DEFAULT TRUE,
  aprovada_por VARCHAR(255),
  aprovada_em TIMESTAMP,
  
  -- Documentos
  documentos_verificados BOOLEAN DEFAULT FALSE,
  documentos_aprovados_em TIMESTAMP,
  
  -- Admin
  is_admin BOOLEAN DEFAULT FALSE,
  
  -- Segurança
  senha_fallback TEXT,
  usar_senha_fallback BOOLEAN DEFAULT FALSE,
  biometria_configurada BOOLEAN DEFAULT FALSE,
  
  -- Dados financeiros
  saldo REAL DEFAULT 0.00 NOT NULL,
  deposito_data TIMESTAMP,
  rendimento_saque_automatico BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_cpf ON users(cpf);

-- Tabela de Movimentações
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

CREATE INDEX IF NOT EXISTS idx_movimentos_user_id ON movimentos(user_id);

-- Tabela de Documentos
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

CREATE INDEX IF NOT EXISTS idx_documentos_user_id ON documentos(user_id);

-- Tabela de Status KYC
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

CREATE INDEX IF NOT EXISTS idx_kyc_status_user_id ON kyc_status(user_id);

-- ============================================
-- TABELAS DE TRADING
-- ============================================

-- Tokens Deriv
CREATE TABLE IF NOT EXISTS deriv_tokens (
  id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  user_id VARCHAR(32) NOT NULL REFERENCES users(id),
  token TEXT NOT NULL,
  account_type VARCHAR(20) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deriv_tokens_user_id ON deriv_tokens(user_id);

-- Configurações de Trading
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

CREATE INDEX IF NOT EXISTS idx_trade_configurations_user_id ON trade_configurations(user_id);

-- Logs de AI
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

CREATE INDEX IF NOT EXISTS idx_ai_logs_user_id ON ai_logs(user_id);

-- Operações de Trading
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
  ai_consensus TEXT NOT NULL,
  is_recovery_mode BOOLEAN DEFAULT FALSE,
  recovery_multiplier REAL DEFAULT 1.0,
  is_conservative_forced BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_trade_operations_user_id ON trade_operations(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_operations_symbol ON trade_operations(symbol);
CREATE INDEX IF NOT EXISTS idx_trade_operations_status ON trade_operations(status);

-- P&L Diário
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

CREATE INDEX IF NOT EXISTS idx_daily_pnl_user_id ON daily_pnl(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_pnl_date ON daily_pnl(date);

-- Estratégias de Recuperação IA
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

CREATE INDEX IF NOT EXISTS idx_ai_recovery_strategies_user_id ON ai_recovery_strategies(user_id);

-- Dados de Mercado
CREATE TABLE IF NOT EXISTS market_data (
  id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  symbol VARCHAR(50) NOT NULL,
  current_price REAL NOT NULL,
  price_history TEXT NOT NULL,
  last_update TIMESTAMP DEFAULT NOW(),
  is_simulated BOOLEAN DEFAULT FALSE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_data_symbol ON market_data(symbol);

-- ============================================
-- TABELAS DE SISTEMA AVANÇADO DE APRENDIZADO
-- ============================================

-- Rastreamento de Experimentos
CREATE TABLE IF NOT EXISTS experiment_tracking (
  id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  experiment_type VARCHAR(100) NOT NULL,
  experiment_name VARCHAR(255) NOT NULL,
  parameters JSONB NOT NULL,
  results JSONB NOT NULL,
  performance JSONB NOT NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'running',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Pesos Dinâmicos
CREATE TABLE IF NOT EXISTS dynamic_weights (
  id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  model_name VARCHAR(100) NOT NULL,
  symbol VARCHAR(50) NOT NULL,
  base_weight REAL NOT NULL,
  current_weight REAL NOT NULL,
  performance REAL NOT NULL,
  profitability REAL NOT NULL,
  cooperation_score REAL NOT NULL,
  adaptation_rate REAL NOT NULL DEFAULT 0.1,
  update_reason TEXT NOT NULL,
  last_updated TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dynamic_weights_symbol ON dynamic_weights(symbol);

-- Memória Episódica
CREATE TABLE IF NOT EXISTS episodic_memory (
  id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  symbol VARCHAR(50) NOT NULL,
  market_state JSONB NOT NULL,
  action VARCHAR(50) NOT NULL,
  reward REAL NOT NULL,
  next_state JSONB,
  episode VARCHAR(100) NOT NULL,
  importance REAL NOT NULL DEFAULT 1.0,
  timestamp TIMESTAMP NOT NULL,
  decay REAL NOT NULL DEFAULT 1.0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_episodic_memory_symbol ON episodic_memory(symbol);
CREATE INDEX IF NOT EXISTS idx_episodic_memory_episode ON episodic_memory(episode);

-- Padrões Emergentes
CREATE TABLE IF NOT EXISTS emergent_patterns (
  id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  symbol VARCHAR(50) NOT NULL,
  pattern_type VARCHAR(100) NOT NULL,
  pattern_data JSONB NOT NULL,
  confidence REAL NOT NULL,
  frequency INTEGER NOT NULL,
  profitability REAL,
  status VARCHAR(20) NOT NULL DEFAULT 'testing',
  detected_at TIMESTAMP NOT NULL,
  last_seen TIMESTAMP NOT NULL,
  validation_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_emergent_patterns_symbol ON emergent_patterns(symbol);

-- Evolução de Estratégias
CREATE TABLE IF NOT EXISTS strategy_evolution (
  id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  parent_strategy VARCHAR(32),
  strategy_code TEXT NOT NULL,
  generation INTEGER NOT NULL,
  mutation JSONB NOT NULL,
  fitness REAL NOT NULL,
  backtest_results JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'candidate',
  created_at TIMESTAMP DEFAULT NOW(),
  promoted_at TIMESTAMP,
  retired_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_strategy_evolution_status ON strategy_evolution(status);

-- Meta-Learning
CREATE TABLE IF NOT EXISTS meta_learning (
  id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  source_symbol VARCHAR(50) NOT NULL,
  target_symbol VARCHAR(50) NOT NULL,
  transfer_type VARCHAR(100) NOT NULL,
  transfer_data JSONB NOT NULL,
  effectiveness REAL NOT NULL,
  confidence REAL NOT NULL,
  applicability REAL NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'testing',
  created_at TIMESTAMP DEFAULT NOW(),
  last_applied TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_meta_learning_source ON meta_learning(source_symbol);
CREATE INDEX IF NOT EXISTS idx_meta_learning_target ON meta_learning(target_symbol);

-- Análise de Performance
CREATE TABLE IF NOT EXISTS performance_analytics (
  id VARCHAR(32) PRIMARY KEY DEFAULT replace(gen_random_uuid()::text, '-', ''),
  analysis_type VARCHAR(100) NOT NULL,
  timeframe VARCHAR(20) NOT NULL,
  symbol VARCHAR(50) NOT NULL,
  metrics JSONB NOT NULL,
  insights JSONB NOT NULL,
  recommendations JSONB NOT NULL,
  confidence REAL NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_performance_analytics_symbol ON performance_analytics(symbol);

-- ============================================
-- FIM DO SCHEMA
-- ============================================
-- Tabelas criadas com sucesso!
-- Todas as foreign keys e índices já estão implementados.
-- Pronto para sincronização de dados!