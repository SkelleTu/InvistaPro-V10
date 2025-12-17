import { sql } from 'drizzle-orm';
import {
  index,
  text,
  pgTable,
  real,
  boolean,
  timestamp,
  integer,
  jsonb,
  varchar,
  serial,
} from "drizzle-orm/pg-core";

// Session storage table for express sessions
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid", { length: 255 }).primaryKey(),
    sess: text("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Users table with complete personal information - PostgreSQL version
export const users = pgTable("users", {
  id: varchar("id", { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  // Authentication fields
  email: varchar("email", { length: 255 }).unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  
  // Personal information
  nomeCompleto: text("nome_completo").notNull(),
  cpf: varchar("cpf", { length: 14 }).unique().notNull(),
  telefone: varchar("telefone", { length: 15 }).notNull(),
  
  // Address information
  endereco: text("endereco").notNull(),
  cidade: varchar("cidade", { length: 100 }).notNull(),
  estado: varchar("estado", { length: 2 }).notNull(),
  cep: varchar("cep", { length: 9 }).notNull(),
  
  // PIX information
  chavePix: text("chave_pix").notNull(),
  tipoChavePix: varchar("tipo_chave_pix", { length: 50 }).notNull(),
  
  // Verification and status
  telefoneVerificado: boolean("telefone_verificado").default(false),
  codigoVerificacao: varchar("codigo_verificacao", { length: 10 }),
  codigoExpiresAt: timestamp("codigo_expires_at"),
  
  // Password recovery
  passwordResetToken: varchar("password_reset_token", { length: 255 }),
  passwordResetTokenExpiresAt: timestamp("password_reset_token_expires_at"),
  contaAprovada: boolean("conta_aprovada").default(true),
  aprovadaPor: varchar("aprovada_por", { length: 255 }),
  aprovadaEm: timestamp("aprovada_em"),
  
  // Document verification for withdrawals
  documentosVerificados: boolean("documentos_verificados").default(false),
  documentosAprovadosEm: timestamp("documentos_aprovados_em"),
  
  // Admin privileges
  isAdmin: boolean("is_admin").default(false),
  
  // Security features for hybrid authentication
  senhaFallback: text("senha_fallback"),
  usarSenhaFallback: boolean("usar_senha_fallback").default(false),
  biometriaConfigurada: boolean("biometria_configurada").default(false),
  
  // Financial data
  saldo: real("saldo").default(0.00).notNull(),
  depositoData: timestamp("deposito_data"),
  rendimentoSaqueAutomatico: boolean("rendimento_saque_automatico").default(false),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const movimentos = pgTable("movimentos", {
  id: varchar("id", { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  userId: varchar("user_id", { length: 32 }).notNull().references(() => users.id),
  tipo: varchar("tipo", { length: 50 }).notNull(),
  valor: real("valor").notNull(),
  descricao: text("descricao"),
  pixString: text("pix_string"),
  biometriaVerificada: boolean("biometria_verificada").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const documentos = pgTable("documentos", {
  id: varchar("id", { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  userId: varchar("user_id", { length: 32 }).notNull().references(() => users.id),
  tipo: varchar("tipo", { length: 100 }).notNull(),
  arquivo: text("arquivo").notNull(),
  status: varchar("status", { length: 50 }).default('pendente'),
  motivoRejeicao: text("motivo_rejeicao"),
  aprovadoPor: varchar("aprovado_por", { length: 255 }),
  aprovadoEm: timestamp("aprovado_em"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const kycStatus = pgTable("kyc_status", {
  id: varchar("id", { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  userId: varchar("user_id", { length: 32 }).notNull().references(() => users.id),
  status: varchar("status", { length: 50 }).default('pending'),
  rgCnhFrenteStatus: varchar("rg_cnh_frente_status", { length: 50 }).default('pending'),
  rgCnhVersoStatus: varchar("rg_cnh_verso_status", { length: 50 }).default('pending'), 
  comprovanteResidenciaStatus: varchar("comprovante_residencia_status", { length: 50 }).default('pending'),
  completedAt: timestamp("completed_at"),
  approvedAt: timestamp("approved_at"),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  reviewedBy: varchar("reviewed_by", { length: 255 }),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Trading tables
export const derivTokens = pgTable("deriv_tokens", {
  id: varchar("id", { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  userId: varchar("user_id", { length: 32 }).notNull().references(() => users.id),
  token: text("token").notNull(),
  accountType: varchar("account_type", { length: 20 }).notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const tradeConfigurations = pgTable("trade_configurations", {
  id: varchar("id", { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  userId: varchar("user_id", { length: 32 }).notNull().references(() => users.id),
  mode: varchar("mode", { length: 100 }).notNull(),
  isActive: boolean("is_active").default(false),
  operationsCount: integer("operations_count").notNull(),
  intervalType: varchar("interval_type", { length: 20 }).notNull(),
  intervalValue: integer("interval_value").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const aiLogs = pgTable("ai_logs", {
  id: varchar("id", { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  userId: varchar("user_id", { length: 32 }).notNull().references(() => users.id),
  modelName: varchar("model_name", { length: 100 }).notNull(),
  analysis: text("analysis").notNull(),
  decision: varchar("decision", { length: 20 }).notNull(),
  confidence: real("confidence").notNull(),
  marketData: text("market_data").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const tradeOperations = pgTable("trade_operations", {
  id: varchar("id", { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  userId: varchar("user_id", { length: 32 }).notNull().references(() => users.id),
  derivContractId: varchar("deriv_contract_id", { length: 100 }),
  symbol: varchar("symbol", { length: 50 }).notNull(),
  tradeType: varchar("trade_type", { length: 50 }).notNull(),
  direction: varchar("direction", { length: 10 }).notNull(),
  amount: real("amount").notNull(),
  duration: integer("duration").notNull(),
  status: varchar("status", { length: 20 }).default('pending'),
  entryPrice: real("entry_price"),
  exitPrice: real("exit_price"),
  profit: real("profit"),
  aiConsensus: text("ai_consensus").notNull(),
  isRecoveryMode: boolean("isRecoveryMode").default(false),
  recoveryMultiplier: real("recovery_multiplier").default(1.0),
  isConservativeForced: boolean("is_conservative_forced").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const dailyPnL = pgTable("daily_pnl", {
  id: varchar("id", { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  userId: varchar("user_id", { length: 32 }).notNull().references(() => users.id),
  date: varchar("date", { length: 10 }).notNull(),
  openingBalance: real("opening_balance").notNull(),
  currentBalance: real("current_balance").notNull(),
  dailyPnL: real("daily_pnl").notNull(),
  totalTrades: integer("total_trades").default(0),
  wonTrades: integer("won_trades").default(0),
  lostTrades: integer("lost_trades").default(0),
  conservativeOperations: integer("conservative_operations").default(0),
  isRecoveryActive: boolean("is_recovery_active").default(false),
  recoveryThreshold: real("recovery_threshold").default(0.75),
  maxDrawdown: real("max_drawdown").default(0),
  recoveryOperations: integer("recovery_operations").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const aiRecoveryStrategies = pgTable("ai_recovery_strategies", {
  id: varchar("id", { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  userId: varchar("user_id", { length: 32 }).notNull().references(() => users.id),
  strategyName: varchar("strategy_name", { length: 100 }).notNull(),
  isActive: boolean("is_active").default(true),
  parameters: text("parameters").notNull(),
  successRate: real("success_rate").default(0),
  totalRecoveries: integer("total_recoveries").default(0),
  avgRecoveryTime: real("avg_recovery_time").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const marketData = pgTable("market_data", {
  id: varchar("id", { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  symbol: varchar("symbol", { length: 50 }).notNull(),
  currentPrice: real("current_price").notNull(),
  priceHistory: text("price_history").notNull(),
  lastUpdate: timestamp("last_update").defaultNow(),
  isSimulated: boolean("is_simulated").default(false).notNull(),
});

// Advanced learning system tables
export const experimentTracking = pgTable('experiment_tracking', {
  id: varchar('id', { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  experimentType: varchar('experiment_type', { length: 100 }).notNull(),
  experimentName: varchar('experiment_name', { length: 255 }).notNull(),
  parameters: jsonb('parameters').notNull(),
  results: jsonb('results').notNull(),
  performance: jsonb('performance').notNull(),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time'),
  status: varchar('status', { length: 20 }).notNull().default('running'),
  createdAt: timestamp('created_at').defaultNow()
});

export const dynamicWeights = pgTable('dynamic_weights', {
  id: varchar('id', { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  modelName: varchar('model_name', { length: 100 }).notNull(),
  symbol: varchar('symbol', { length: 50 }).notNull(),
  baseWeight: real('base_weight').notNull(),
  currentWeight: real('current_weight').notNull(),
  performance: real('performance').notNull(),
  profitability: real('profitability').notNull(),
  cooperationScore: real('cooperation_score').notNull(),
  adaptationRate: real('adaptation_rate').notNull().default(0.1),
  updateReason: text('update_reason').notNull(),
  lastUpdated: timestamp('last_updated').notNull(),
  createdAt: timestamp('created_at').defaultNow()
});

export const episodicMemory = pgTable('episodic_memory', {
  id: varchar('id', { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  symbol: varchar('symbol', { length: 50 }).notNull(),
  marketState: jsonb('market_state').notNull(),
  action: varchar('action', { length: 50 }).notNull(),
  reward: real('reward').notNull(),
  nextState: jsonb('next_state'),
  episode: varchar('episode', { length: 100 }).notNull(),
  importance: real('importance').notNull().default(1.0),
  timestamp: timestamp('timestamp').notNull(),
  decay: real('decay').notNull().default(1.0),
  createdAt: timestamp('created_at').defaultNow()
});

export const emergentPatterns = pgTable('emergent_patterns', {
  id: varchar('id', { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  symbol: varchar('symbol', { length: 50 }).notNull(),
  patternType: varchar('pattern_type', { length: 100 }).notNull(),
  patternData: jsonb('pattern_data').notNull(),
  confidence: real('confidence').notNull(),
  frequency: integer('frequency').notNull(),
  profitability: real('profitability'),
  status: varchar('status', { length: 20 }).notNull().default('testing'),
  detectedAt: timestamp('detected_at').notNull(),
  lastSeen: timestamp('last_seen').notNull(),
  validationCount: integer('validation_count').notNull().default(0)
});

export const strategyEvolution = pgTable('strategy_evolution', {
  id: varchar('id', { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  parentStrategy: varchar('parent_strategy', { length: 32 }),
  strategyCode: text('strategy_code').notNull(),
  generation: integer('generation').notNull(),
  mutation: jsonb('mutation').notNull(),
  fitness: real('fitness').notNull(),
  backtestResults: jsonb('backtest_results').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('candidate'),
  createdAt: timestamp('created_at').defaultNow(),
  promotedAt: timestamp('promoted_at'),
  retiredAt: timestamp('retired_at')
});

export const metaLearning = pgTable('meta_learning', {
  id: varchar('id', { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  sourceSymbol: varchar('source_symbol', { length: 50 }).notNull(),
  targetSymbol: varchar('target_symbol', { length: 50 }).notNull(),
  transferType: varchar('transfer_type', { length: 100 }).notNull(),
  transferData: jsonb('transfer_data').notNull(),
  effectiveness: real('effectiveness').notNull(),
  confidence: real('confidence').notNull(),
  applicability: real('applicability').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('testing'),
  createdAt: timestamp('created_at').defaultNow(),
  lastApplied: timestamp('last_applied')
});

export const performanceAnalytics = pgTable('performance_analytics', {
  id: varchar('id', { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  analysisType: varchar('analysis_type', { length: 100 }).notNull(),
  timeframe: varchar('timeframe', { length: 20 }).notNull(),
  symbol: varchar('symbol', { length: 50 }).notNull(),
  metrics: jsonb('metrics').notNull(),
  insights: jsonb('insights').notNull(),
  recommendations: jsonb('recommendations').notNull(),
  confidence: real('confidence').notNull(),
  createdAt: timestamp('created_at').defaultNow()
});
