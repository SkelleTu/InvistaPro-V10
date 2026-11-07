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
  uuid,
  bigint,
  char,
  inet,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// One shared Neon database backs both V10 and Aura visual deployments.
export const mt5BridgeState = pgTable("mt5_bridge_state", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const invistaDatabaseIdentity = pgTable("invista_database_identity", {
  id: integer("id").primaryKey(),
  platformId: varchar("platform_id", { length: 20 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  essentialBackfillCompletedAt: timestamp("essential_backfill_completed_at"),
  operationalBackfillCompletedAt: timestamp("operational_backfill_completed_at"),
  riskControlsBackfillCompletedAt: timestamp("risk_controls_backfill_completed_at"),
});

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
  isPrimary: boolean("is_primary").notNull().default(false),
  slotIndex: integer("slot_index"),
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
  selectedModalities: text("selected_modalities").default('digit_differs'),
  accuGrowthRates: text("accu_growth_rates").default('["1","2","3","4","5"]'),
  modalityFrequency: text("modality_frequency").default('{}'),
  accuTicksPerRate: text("accu_ticks_per_rate").default('{"1":10,"2":7,"3":5,"4":4,"5":3}'),
  accuFrequencyPerRate: text("accu_frequency_per_rate").default('{}'),
  modalityTicks: text("modality_ticks").default('{}'),
  enableMartingale: boolean("enable_martingale").default(true),
  enableLeverage: boolean("enable_leverage").default(true),
  enableCircuitBreaker: boolean("enable_circuit_breaker").default(true),
  enableRecoveryMode: boolean("enable_recovery_mode").default(true),
  martingaleMultipliers: text("martingale_multipliers").default('[1.3,1.6,2.0]'),
  circuitBreakerLosses: integer("circuit_breaker_losses").default(1),
  circuitBreakerPauseMinutes: integer("circuit_breaker_pause_minutes").default(2),
  stakeMode: text("stake_mode").default('ai'),
  fixedStake: real("fixed_stake").default(0.35),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const modalityModuleConfigs = pgTable("modality_module_configs", {
  id: varchar("id", { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  userId: varchar("user_id", { length: 32 }).notNull().references(() => users.id),
  modality: varchar("modality", { length: 100 }).notNull(),
  slotConfigs: text("slot_configs").notNull().default('[]'),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [index("IDX_modality_module_user_modality").on(table.userId, table.modality)]);

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
  shortcode: text("shortcode"),
  buyPrice: real("buy_price"),
  sellPrice: real("sell_price"),
  entryEpoch: integer("entry_epoch"),
  exitEpoch: integer("exit_epoch"),
  contractType: varchar("contract_type", { length: 50 }),
  barrier: varchar("barrier", { length: 20 }),
  derivStatus: varchar("deriv_status", { length: 50 }),
  derivProfit: real("deriv_profit"),
  payout: real("payout"),
  statusChangedAt: timestamp("status_changed_at"),
  lastSyncAt: timestamp("last_sync_at"),
  syncCount: integer("sync_count").default(0),
  aiConsensus: text("ai_consensus").notNull(),
  isRecoveryMode: boolean("isRecoveryMode").default(false),
  recoveryMultiplier: real("recovery_multiplier").default(1.0),
  isConservativeForced: boolean("is_conservative_forced").default(false),
  operationMode: varchar("operation_mode", { length: 100 }).default('Operação Ordinária'),
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

export const pauseConfiguration = pgTable("pause_configuration", {
  id: varchar("id", { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  userId: varchar("user_id", { length: 32 }).notNull().references(() => users.id),
  isEnabled: boolean("is_enabled").default(true),
  operatingDurationMinutes: integer("operating_duration_minutes").default(15),
  pauseDurationMinSeconds: integer("pause_duration_min_seconds").default(60),
  pauseDurationMaxSeconds: integer("pause_duration_max_seconds").default(180),
  useTechnicalAnalysisConsensus: boolean("use_technical_analysis_consensus").default(true),
  minAIConsensusForPause: real("min_ai_consensus_for_pause").default(0.7),
  lastPauseStartedAt: timestamp("last_pause_started_at"),
  lastOperatingStartedAt: timestamp("last_operating_started_at"),
  isPausedNow: boolean("is_paused_now").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const assetBlacklist = pgTable("asset_blacklist", {
  id: varchar("id", { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  userId: varchar("user_id", { length: 32 }).notNull().references(() => users.id),
  assetPattern: text("asset_pattern").notNull(),
  patternType: varchar("pattern_type", { length: 20 }).notNull(),
  isActive: boolean("is_active").default(true),
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const blockedAssets = pgTable("blocked_assets", {
  id: varchar("id", { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  userId: varchar("user_id", { length: 32 }).notNull().references(() => users.id),
  tradeMode: varchar("trade_mode", { length: 50 }).notNull(),
  symbol: varchar("symbol", { length: 100 }).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
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

export const tradingControl = pgTable('trading_control', {
  id: varchar('id', { length: 32 }).primaryKey().default(sql`replace(gen_random_uuid()::text, '-', '')`),
  isPaused: boolean('is_paused').default(false),
  pausedBy: text('paused_by'),
  pausedAt: timestamp('paused_at'),
  pauseReason: text('pause_reason'),
  resumedAt: timestamp('resumed_at'),
  updatedAt: timestamp('updated_at').defaultNow(),
});


// ─── Durable financial ledger (Neon/PostgreSQL only) ────────────────────────
// Monetary values are integer cents. Posted ledger rows are append-only at the
// database layer; corrections must be represented by new reversing entries.
export const financialAccounts = pgTable("financial_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountCode: varchar("account_code", { length: 100 }).notNull().unique(),
  ownerUserId: varchar("owner_user_id", { length: 32 }).references(() => users.id, { onDelete: "restrict" }),
  accountKind: varchar("account_kind", { length: 32 }).notNull(),
  currency: char("currency", { length: 3 }).notNull().default("BRL"),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_financial_accounts_owner_kind_currency").on(table.ownerUserId, table.accountKind, table.currency),
]);

export const ledgerTransactions = pgTable("ledger_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull().unique(),
  eventType: varchar("event_type", { length: 48 }).notNull(),
  referenceType: varchar("reference_type", { length: 48 }),
  referenceId: varchar("reference_id", { length: 160 }),
  description: text("description").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdBy: varchar("created_by", { length: 32 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_ledger_transactions_created_at").on(table.createdAt),
  index("idx_ledger_transactions_reference").on(table.referenceType, table.referenceId),
]);

export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  transactionId: uuid("transaction_id").notNull().references(() => ledgerTransactions.id, { onDelete: "restrict" }),
  accountId: uuid("account_id").notNull().references(() => financialAccounts.id, { onDelete: "restrict" }),
  direction: varchar("direction", { length: 6 }).notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull().default("BRL"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_ledger_entries_transaction").on(table.transactionId),
  index("idx_ledger_entries_account_created").on(table.accountId, table.createdAt),
]);

export const paymentIntents = pgTable("payment_intents", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: varchar("user_id", { length: 32 }).notNull().references(() => users.id, { onDelete: "restrict" }),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull().default("BRL"),
  status: varchar("status", { length: 20 }).notNull().default("created"),
  provider: varchar("provider", { length: 40 }),
  providerPaymentId: varchar("provider_payment_id", { length: 160 }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_payment_intents_user_created").on(table.userId, table.createdAt),
  uniqueIndex("idx_payment_intents_provider_payment").on(table.provider, table.providerPaymentId),
]);

export const providerPayments = pgTable("provider_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  paymentIntentId: uuid("payment_intent_id").notNull().unique().references(() => paymentIntents.id, { onDelete: "restrict" }),
  provider: varchar("provider", { length: 40 }).notNull(),
  providerPaymentId: varchar("provider_payment_id", { length: 160 }).notNull(),
  externalReference: varchar("external_reference", { length: 160 }).notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  providerStatus: varchar("provider_status", { length: 40 }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
  rawSnapshot: jsonb("raw_snapshot").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("idx_provider_payments_provider_id").on(table.provider, table.providerPaymentId),
]);

export const withdrawalRequests = pgTable("withdrawal_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: varchar("user_id", { length: 32 }).notNull().references(() => users.id, { onDelete: "restrict" }),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  feeCents: bigint("fee_cents", { mode: "number" }).notNull().default(0),
  netAmountCents: bigint("net_amount_cents", { mode: "number" }).notNull(),
  currency: char("currency", { length: 3 }).notNull().default("BRL"),
  status: varchar("status", { length: 20 }).notNull().default("requested"),
  provider: varchar("provider", { length: 40 }),
  providerTransferId: varchar("provider_transfer_id", { length: 160 }),
  idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull().unique(),
  destinationFingerprint: varchar("destination_fingerprint", { length: 160 }),
  destinationEncrypted: text("destination_encrypted"),
  failureReason: text("failure_reason"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_withdrawal_requests_user_created").on(table.userId, table.requestedAt),
]);

export const providerWebhookEvents = pgTable("provider_webhook_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: varchar("provider", { length: 40 }).notNull(),
  providerEventId: varchar("provider_event_id", { length: 160 }).notNull(),
  eventType: varchar("event_type", { length: 100 }).notNull(),
  signatureVerified: boolean("signature_verified").notNull().default(false),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  processingStatus: varchar("processing_status", { length: 20 }).notNull().default("received"),
  processingError: text("processing_error"),
}, (table) => [
  uniqueIndex("idx_provider_webhook_events_provider_id").on(table.provider, table.providerEventId),
  index("idx_provider_webhook_events_received").on(table.receivedAt),
]);

export const financialAuditEvents = pgTable("financial_audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorUserId: varchar("actor_user_id", { length: 32 }),
  subjectUserId: varchar("subject_user_id", { length: 32 }),
  action: varchar("action", { length: 80 }).notNull(),
  entityType: varchar("entity_type", { length: 48 }).notNull(),
  entityId: varchar("entity_id", { length: 160 }).notNull(),
  beforeState: jsonb("before_state").$type<Record<string, unknown>>(),
  afterState: jsonb("after_state").$type<Record<string, unknown>>(),
  reason: text("reason"),
  requestId: varchar("request_id", { length: 160 }),
  ipAddress: inet("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_financial_audit_subject_created").on(table.subjectUserId, table.createdAt),
  index("idx_financial_audit_created").on(table.createdAt),
]);

export const adminReportExports = pgTable("admin_report_exports", {
  id: uuid("id").defaultRandom().primaryKey(),
  requestedBy: varchar("requested_by", { length: 32 }).notNull().references(() => users.id, { onDelete: "restrict" }),
  reportScope: varchar("report_scope", { length: 24 }).notNull(),
  subjectUserId: varchar("subject_user_id", { length: 32 }).references(() => users.id, { onDelete: "restrict" }),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  rowCount: bigint("row_count", { mode: "number" }).notNull().default(0),
  contentSha256: char("content_sha256", { length: 64 }).notNull(),
  privateStorageRef: text("private_storage_ref").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_admin_report_exports_subject_created").on(table.subjectUserId, table.createdAt),
]);


// Affiliate attribution and pending commissions are persisted in the same durable PostgreSQL database.
export const affiliateProfiles = pgTable("affiliate_profiles", {
  userId: varchar("user_id", { length: 32 }).primaryKey().references(() => users.id, { onDelete: "cascade" }),
  referralCode: varchar("referral_code", { length: 20 }).notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const affiliateReferrals = pgTable("affiliate_referrals", {
  id: varchar("id", { length: 32 }).primaryKey(),
  referrerUserId: varchar("referrer_user_id", { length: 32 }).notNull().references(() => users.id, { onDelete: "cascade" }),
  referredUserId: varchar("referred_user_id", { length: 32 }).notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_affiliate_referrals_referrer").on(table.referrerUserId),
]);

export const affiliateCommissions = pgTable("affiliate_commissions", {
  id: varchar("id", { length: 32 }).primaryKey(),
  referrerUserId: varchar("referrer_user_id", { length: 32 }).notNull().references(() => users.id),
  referredUserId: varchar("referred_user_id", { length: 32 }).notNull().references(() => users.id),
  paymentReference: varchar("payment_reference", { length: 160 }).notNull().unique(),
  eligibleBaseCents: bigint("eligible_base_cents", { mode: "number" }).notNull(),
  rateBps: integer("rate_bps").notNull().default(150),
  commissionAmountCents: bigint("commission_amount_cents", { mode: "number" }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("idx_affiliate_commissions_referrer").on(table.referrerUserId),
]);
