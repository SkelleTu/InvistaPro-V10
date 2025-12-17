import { sql } from 'drizzle-orm';
import {
  index,
  text,
  sqliteTable,
  real,
  integer,
} from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session storage table for express sessions
export const sessions = sqliteTable(
  "sessions",
  {
    sid: text("sid").primaryKey(),
    sess: text("sess").notNull(),
    expire: text("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Users table with complete personal information
export const users = sqliteTable("users", {
  id: text("id").primaryKey().default(sql`(hex(randomblob(16)))`),
  // Authentication fields
  email: text("email").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  
  // Personal information
  nomeCompleto: text("nome_completo").notNull(),
  cpf: text("cpf").unique().notNull(),
  telefone: text("telefone").notNull(),
  
  // Address information
  endereco: text("endereco").notNull(),
  cidade: text("cidade").notNull(),
  estado: text("estado").notNull(),
  cep: text("cep").notNull(),
  
  // PIX information
  chavePix: text("chave_pix").notNull(),
  tipoChavePix: text("tipo_chave_pix").notNull(), // email, cpf, telefone, chave_aleatoria
  
  // Verification and status
  telefoneVerificado: integer("telefone_verificado", { mode: 'boolean' }).default(false),
  codigoVerificacao: text("codigo_verificacao"),
  codigoExpiresAt: text("codigo_expires_at"),
  
  // Password recovery
  passwordResetToken: text("password_reset_token"),
  passwordResetTokenExpiresAt: text("password_reset_token_expires_at"),
  contaAprovada: integer("conta_aprovada", { mode: 'boolean' }).default(true),
  aprovadaPor: text("aprovada_por"),
  aprovadaEm: text("aprovada_em"),
  
  // Document verification for withdrawals
  documentosVerificados: integer("documentos_verificados", { mode: 'boolean' }).default(false),
  documentosAprovadosEm: text("documentos_aprovados_em"),
  
  // Admin privileges
  isAdmin: integer("is_admin", { mode: 'boolean' }).default(false),
  
  // Security features for hybrid authentication
  senhaFallback: text("senha_fallback"), // Hashed fallback password for PCs without biometric
  usarSenhaFallback: integer("usar_senha_fallback", { mode: 'boolean' }).default(false),
  biometriaConfigurada: integer("biometria_configurada", { mode: 'boolean' }).default(false),
  
  // Financial data
  saldo: real("saldo").default(0.00).notNull(),
  depositoData: text("deposito_data"),
  rendimentoSaqueAutomatico: integer("rendimento_saque_automatico", { mode: 'boolean' }).default(false),
  
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

export const movimentos = sqliteTable("movimentos", {
  id: text("id").primaryKey().default(sql`(hex(randomblob(16)))`),
  userId: text("user_id").notNull().references(() => users.id),
  tipo: text("tipo").notNull(), // 'deposito', 'rendimento', 'saque'
  valor: real("valor").notNull(),
  descricao: text("descricao"),
  pixString: text("pix_string"), // For PIX deposits
  biometriaVerificada: integer("biometria_verificada", { mode: 'boolean' }).default(false), // Security verification tracking

  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Document uploads table for KYC verification
export const documentos = sqliteTable("documentos", {
  id: text("id").primaryKey().default(sql`(hex(randomblob(16)))`),
  userId: text("user_id").notNull().references(() => users.id),
  tipo: text("tipo").notNull(), // 'rg_cnh_frente', 'rg_cnh_verso', 'comprovante_residencia'
  arquivo: text("arquivo").notNull(), // File path or URL
  status: text("status").default('pendente'), // 'pendente', 'aprovado', 'rejeitado'
  motivoRejeicao: text("motivo_rejeicao"),
  aprovadoPor: text("aprovado_por"),
  aprovadoEm: text("aprovado_em"),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// KYC Status table for tracking overall verification status
export const kycStatus = sqliteTable("kyc_status", {
  id: text("id").primaryKey().default(sql`(hex(randomblob(16)))`),
  userId: text("user_id").notNull().references(() => users.id),
  status: text("status").default('pending'), // 'pending', 'under_review', 'approved', 'rejected'
  // Document status flags
  rgCnhFrenteStatus: text("rg_cnh_frente_status").default('pending'),
  rgCnhVersoStatus: text("rg_cnh_verso_status").default('pending'), 
  comprovanteResidenciaStatus: text("comprovante_residencia_status").default('pending'),
  // Overall completion
  completedAt: text("completed_at"),
  approvedAt: text("approved_at"),
  rejectedAt: text("rejected_at"),
  rejectionReason: text("rejection_reason"),
  reviewedBy: text("reviewed_by"), // Admin email who reviewed
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// Registration schema for new users with enhanced validation
export const registerUserSchema = createInsertSchema(users).omit({
  id: true,
  passwordHash: true,
  telefoneVerificado: true,
  codigoVerificacao: true,
  codigoExpiresAt: true,
  contaAprovada: true,
  aprovadaPor: true,
  aprovadaEm: true,
  documentosVerificados: true,
  documentosAprovadosEm: true,
  isAdmin: true,
  saldo: true,
  depositoData: true,
  rendimentoSaqueAutomatico: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  password: z.string().min(6, "Senha deve ter pelo menos 6 caracteres"),
  confirmPassword: z.string(),
  cpf: z.string().min(11, "CPF deve ter 11 dígitos").max(14, "CPF inválido"),
  email: z.string().email("Email inválido"),
  telefone: z.string().min(10, "Telefone deve ter pelo menos 10 dígitos").max(15, "Telefone inválido"),
  cep: z.string().min(8, "CEP deve ter 8 dígitos").max(9, "CEP inválido"),
}).refine(data => data.password === data.confirmPassword, {
  message: "Senhas não coincidem",
  path: ["confirmPassword"],
});

// Login schema
export const loginSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(1, "Senha é obrigatória"),
});

// Phone verification schema
export const phoneVerificationSchema = z.object({
  userId: z.string().min(1, "ID do usuário é obrigatório"),
  codigo: z.string().length(6, "Código deve ter 6 dígitos"),
});

export const insertMovimentoSchema = createInsertSchema(movimentos).omit({
  id: true,
  createdAt: true,
});

export const insertDocumentoSchema = createInsertSchema(documentos).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
}).partial();

// Schema for document upload
export const uploadDocumentSchema = z.object({
  tipo: z.enum(['rg_cnh_frente', 'rg_cnh_verso', 'comprovante_residencia'], {
    required_error: "Tipo de documento é obrigatório"
  }),
  arquivo: z.string().min(1, "Arquivo é obrigatório"),
});

// Schema for admin document review
export const reviewDocumentSchema = z.object({
  documentId: z.string().min(1, "ID do documento é obrigatório"),
  status: z.enum(['aprovado', 'rejeitado'], {
    required_error: "Status é obrigatório"
  }),
  motivoRejeicao: z.string().optional(),
});



// Schema for withdrawal request
export const withdrawalRequestSchema = z.object({
  valor: z.number().min(0.01, "Valor deve ser maior que zero"),
  tipo: z.enum(['rendimento', 'total'], {
    required_error: "Tipo de saque é obrigatório"
  }),
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type RegisterUser = z.infer<typeof registerUserSchema>;
export type LoginUser = z.infer<typeof loginSchema>;
export type PhoneVerification = z.infer<typeof phoneVerificationSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type Movimento = typeof movimentos.$inferSelect;
export type InsertMovimento = z.infer<typeof insertMovimentoSchema>;
export type Documento = typeof documentos.$inferSelect;
export type InsertDocumento = z.infer<typeof insertDocumentoSchema>;
export type UploadDocument = z.infer<typeof uploadDocumentSchema>;
export type KycStatus = typeof kycStatus.$inferSelect;
export type InsertKycStatus = typeof kycStatus.$inferInsert;
export type ReviewDocument = z.infer<typeof reviewDocumentSchema>;

export type WithdrawalRequest = z.infer<typeof withdrawalRequestSchema>;

// TRADING SYSTEM TABLES

// Deriv API tokens for authorized users
export const derivTokens = sqliteTable("deriv_tokens", {
  id: text("id").primaryKey().default(sql`(hex(randomblob(16)))`),
  userId: text("user_id").notNull().references(() => users.id),
  token: text("token").notNull(), // Encrypted Deriv API token
  accountType: text("account_type").notNull(), // 'demo' or 'real'
  isActive: integer("is_active", { mode: 'boolean' }).default(true),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// Trading configurations for operation modes
export const tradeConfigurations = sqliteTable("trade_configurations", {
  id: text("id").primaryKey().default(sql`(hex(randomblob(16)))`),
  userId: text("user_id").notNull().references(() => users.id),
  mode: text("mode").notNull(), // 'production_3-4_24h', 'production_2_24h', 'test_4_1min', etc.
  isActive: integer("is_active", { mode: 'boolean' }).default(false),
  operationsCount: integer("operations_count").notNull(),
  intervalType: text("interval_type").notNull(), // 'minutes', 'hours', 'days'  
  intervalValue: integer("interval_value").notNull(),
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// AI analysis logs from Hugging Face models
export const aiLogs = sqliteTable("ai_logs", {
  id: text("id").primaryKey().default(sql`(hex(randomblob(16)))`),
  userId: text("user_id").notNull().references(() => users.id),
  modelName: text("model_name").notNull(),
  analysis: text("analysis").notNull(), // AI's detailed analysis in JSON
  decision: text("decision").notNull(), // 'buy', 'sell', 'hold'
  confidence: real("confidence").notNull(), // 0.0 to 1.0
  marketData: text("market_data").notNull(), // Market data used for analysis in JSON
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Trading operations tracking
export const tradeOperations = sqliteTable("trade_operations", {
  id: text("id").primaryKey().default(sql`(hex(randomblob(16)))`),
  userId: text("user_id").notNull().references(() => users.id),
  derivContractId: text("deriv_contract_id"), // Deriv's contract ID
  symbol: text("symbol").notNull(), // Trading symbol (e.g. 'R_100')
  tradeType: text("trade_type").notNull(), // 'digitdiff'
  direction: text("direction").notNull(), // 'up', 'down'
  amount: real("amount").notNull(), // Stake amount
  duration: integer("duration").notNull(), // Duration in ticks
  status: text("status").default('pending'), // 'pending', 'active', 'won', 'lost'
  entryPrice: real("entry_price"),
  exitPrice: real("exit_price"),
  profit: real("profit"),
  aiConsensus: text("ai_consensus").notNull(), // AI models' consensus in JSON
  isRecoveryMode: integer("isRecoveryMode", { mode: 'boolean' }).default(false), // Trade feito em modo recuperação
  recoveryMultiplier: real("recovery_multiplier").default(1.0), // Multiplicador aplicado
  isConservativeForced: integer("is_conservative_forced", { mode: 'boolean' }).default(false), // Operação conservadora forçada
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  completedAt: text("completed_at"),
});

// Daily P&L tracking for loss recovery system
export const dailyPnL = sqliteTable("daily_pnl", {
  id: text("id").primaryKey().default(sql`(hex(randomblob(16)))`),
  userId: text("user_id").notNull().references(() => users.id),
  date: text("date").notNull(), // YYYY-MM-DD format
  openingBalance: real("opening_balance").notNull(),
  currentBalance: real("current_balance").notNull(),
  dailyPnL: real("daily_pnl").notNull(), // Profit/Loss for the day
  totalTrades: integer("total_trades").default(0),
  wonTrades: integer("won_trades").default(0),
  lostTrades: integer("lost_trades").default(0),
  conservativeOperations: integer("conservative_operations").default(0), // Operações conservadoras diárias (2-4)
  isRecoveryActive: integer("is_recovery_active", { mode: 'boolean' }).default(false),
  recoveryThreshold: real("recovery_threshold").default(0.75), // 75% threshold to start recovery
  maxDrawdown: real("max_drawdown").default(0), // Biggest loss during the day
  recoveryOperations: integer("recovery_operations").default(0), // Number of recovery trades
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// AI Loss Recovery Strategies
export const aiRecoveryStrategies = sqliteTable("ai_recovery_strategies", {
  id: text("id").primaryKey().default(sql`(hex(randomblob(16)))`),
  userId: text("user_id").notNull().references(() => users.id),
  strategyName: text("strategy_name").notNull(), // 'gradual_increment', 'ai_cooperation', 'smart_threshold'
  isActive: integer("is_active", { mode: 'boolean' }).default(true),
  parameters: text("parameters").notNull(), // JSON with strategy-specific parameters
  successRate: real("success_rate").default(0), // Track strategy performance
  totalRecoveries: integer("total_recoveries").default(0),
  avgRecoveryTime: real("avg_recovery_time").default(0), // Minutes to recover
  createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// Real-time market data cache
export const marketData = sqliteTable("market_data", {
  id: text("id").primaryKey().default(sql`(hex(randomblob(16)))`),
  symbol: text("symbol").notNull(),
  currentPrice: real("current_price").notNull(),
  priceHistory: text("price_history").notNull(), // JSON array of recent prices
  lastUpdate: text("last_update").default(sql`CURRENT_TIMESTAMP`),
  isSimulated: integer("is_simulated", { mode: 'boolean' }).default(false).notNull(), // Indica se são dados simulados
});

// TRADING SYSTEM SCHEMAS

export const insertDerivTokenSchema = createInsertSchema(derivTokens).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTradeConfigSchema = createInsertSchema(tradeConfigurations).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertTradeOperationSchema = createInsertSchema(tradeOperations).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});

export const insertAiLogSchema = createInsertSchema(aiLogs).omit({
  id: true,
  createdAt: true,
});

export const insertMarketDataSchema = createInsertSchema(marketData).omit({
  id: true,
  lastUpdate: true,
});

export const insertDailyPnLSchema = createInsertSchema(dailyPnL).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertAiRecoveryStrategySchema = createInsertSchema(aiRecoveryStrategies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Trading form validation schemas
export const derivTokenConfigSchema = z.object({
  token: z.string().min(1, "Token Deriv é obrigatório"),
  accountType: z.enum(['demo', 'real'], {
    required_error: "Tipo de conta é obrigatório"
  }),
});

export const tradeModeConfigSchema = z.object({
  mode: z.enum([
    'production_3-4_24h', 'production_2_24h', 'production_4_perpetuo',
    'test_4_1min', 'test_3_2min', 'test_4_1hour', 'test_3_2hour', 'test_4_perpetuo', 'test_sem_limites'
  ], {
    required_error: "Modo de operação é obrigatório"
  }),
});

export const manualTradeSchema = z.object({
  symbol: z.string().min(1, "Símbolo é obrigatório"),
  direction: z.enum(['up', 'down'], {
    required_error: "Direção é obrigatória"
  }),
  amount: z.number().min(0.35, "Valor mínimo é 0.35").max(50000, "Valor máximo é 50000"),
  duration: z.number().min(1, "Duração mínima é 1 tick").max(10, "Duração máxima é 10 ticks"),
});

// TRADING SYSTEM TYPES

export type DerivToken = typeof derivTokens.$inferSelect;
export type InsertDerivToken = z.infer<typeof insertDerivTokenSchema>;
export type TradeConfiguration = typeof tradeConfigurations.$inferSelect;
export type InsertTradeConfiguration = z.infer<typeof insertTradeConfigSchema>;
export type TradeOperation = typeof tradeOperations.$inferSelect;
export type InsertTradeOperation = z.infer<typeof insertTradeOperationSchema>;
export type AiLog = typeof aiLogs.$inferSelect;
export type InsertAiLog = z.infer<typeof insertAiLogSchema>;
export type MarketData = typeof marketData.$inferSelect;
export type InsertMarketData = z.infer<typeof insertMarketDataSchema>;
export type DailyPnL = typeof dailyPnL.$inferSelect;
export type InsertDailyPnL = z.infer<typeof insertDailyPnLSchema>;
export type AiRecoveryStrategy = typeof aiRecoveryStrategies.$inferSelect;
export type InsertAiRecoveryStrategy = z.infer<typeof insertAiRecoveryStrategySchema>;

export type DerivTokenConfig = z.infer<typeof derivTokenConfigSchema>;
export type TradeModeConfig = z.infer<typeof tradeModeConfigSchema>;
export type ManualTrade = z.infer<typeof manualTradeSchema>;

// ============================================
// SISTEMA DE APRENDIZADO AVANÇADO - MÁXIMA INOVAÇÃO
// ============================================

// Sistema de Experiment Tracking Avançado
export const experimentTracking = sqliteTable('experiment_tracking', {
  id: text('id').primaryKey().default(sql`(hex(randomblob(16)))`),
  experimentType: text('experiment_type').notNull(), // 'ai_model', 'strategy', 'weight_optimization', 'pattern_detection'
  experimentName: text('experiment_name').notNull(),
  parameters: text('parameters', { mode: 'json' }).notNull(),
  results: text('results', { mode: 'json' }).notNull(),
  performance: text('performance', { mode: 'json' }).notNull(),
  startTime: text('start_time').notNull(),
  endTime: text('end_time'),
  status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull().default('running'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
});

// Sistema de Aprendizado Dinâmico de Pesos
export const dynamicWeights = sqliteTable('dynamic_weights', {
  id: text('id').primaryKey().default(sql`(hex(randomblob(16)))`),
  modelName: text('model_name').notNull(),
  symbol: text('symbol').notNull(),
  baseWeight: real('base_weight').notNull(),
  currentWeight: real('current_weight').notNull(),
  performance: real('performance').notNull(), // accuracy rate
  profitability: real('profitability').notNull(), // profit rate
  cooperationScore: real('cooperation_score').notNull(),
  adaptationRate: real('adaptation_rate').notNull().default(0.1), // taxa de adaptação do peso
  updateReason: text('update_reason').notNull(),
  lastUpdated: text('last_updated').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
});

// Sistema de Memory Episódica para Reinforcement Learning
export const episodicMemory = sqliteTable('episodic_memory', {
  id: text('id').primaryKey().default(sql`(hex(randomblob(16)))`),
  symbol: text('symbol').notNull(),
  marketState: text('market_state', { mode: 'json' }).notNull(),
  action: text('action').notNull(),
  reward: real('reward').notNull(),
  nextState: text('next_state', { mode: 'json' }),
  episode: text('episode').notNull(),
  importance: real('importance').notNull().default(1.0),
  timestamp: text('timestamp').notNull(),
  decay: real('decay').notNull().default(1.0), // fator de decaimento temporal
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
});

// Sistema de Padrões Emergentes e Regimes de Mercado
export const emergentPatterns = sqliteTable('emergent_patterns', {
  id: text('id').primaryKey().default(sql`(hex(randomblob(16)))`),
  symbol: text('symbol').notNull(),
  patternType: text('pattern_type').notNull(), // 'motif', 'discord', 'regime_change', 'volatility_cluster'
  patternData: text('pattern_data', { mode: 'json' }).notNull(),
  confidence: real('confidence').notNull(),
  frequency: integer('frequency').notNull(),
  profitability: real('profitability'),
  status: text('status', { enum: ['active', 'testing', 'validated', 'deprecated'] }).notNull().default('testing'),
  detectedAt: text('detected_at').notNull(),
  lastSeen: text('last_seen').notNull(),
  validationCount: integer('validation_count').notNull().default(0)
});

// Sistema de Auto-Evolução de Estratégias com Genetic Programming
export const strategyEvolution = sqliteTable('strategy_evolution', {
  id: text('id').primaryKey().default(sql`(hex(randomblob(16)))`),
  parentStrategy: text('parent_strategy'),
  strategyCode: text('strategy_code').notNull(),
  generation: integer('generation').notNull(),
  mutation: text('mutation', { mode: 'json' }).notNull(),
  fitness: real('fitness').notNull(),
  backtestResults: text('backtest_results', { mode: 'json' }).notNull(),
  status: text('status', { enum: ['candidate', 'testing', 'production', 'retired'] }).notNull().default('candidate'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  promotedAt: text('promoted_at'),
  retiredAt: text('retired_at')
});

// Sistema de Meta-Learning Cross-Validation
export const metaLearning = sqliteTable('meta_learning', {
  id: text('id').primaryKey().default(sql`(hex(randomblob(16)))`),
  sourceSymbol: text('source_symbol').notNull(),
  targetSymbol: text('target_symbol').notNull(),
  transferType: text('transfer_type').notNull(), // 'weight_transfer', 'pattern_transfer', 'strategy_transfer'
  transferData: text('transfer_data', { mode: 'json' }).notNull(),
  effectiveness: real('effectiveness').notNull(),
  confidence: real('confidence').notNull(),
  applicability: real('applicability').notNull(),
  status: text('status', { enum: ['testing', 'active', 'deprecated'] }).notNull().default('testing'),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  lastApplied: text('last_applied')
});

// Sistema de Performance Analytics Avançado
export const performanceAnalytics = sqliteTable('performance_analytics', {
  id: text('id').primaryKey().default(sql`(hex(randomblob(16)))`),
  analysisType: text('analysis_type').notNull(), // 'model_performance', 'strategy_analysis', 'market_regime'
  timeframe: text('timeframe').notNull(), // 'minute', 'hour', 'day', 'week'
  symbol: text('symbol').notNull(),
  metrics: text('metrics', { mode: 'json' }).notNull(),
  insights: text('insights', { mode: 'json' }).notNull(),
  recommendations: text('recommendations', { mode: 'json' }).notNull(),
  confidence: real('confidence').notNull(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`)
});

// SCHEMAS PARA SISTEMA DE APRENDIZADO AVANÇADO

export const insertExperimentTrackingSchema = createInsertSchema(experimentTracking).omit({
  id: true,
  createdAt: true
});

export const insertDynamicWeightsSchema = createInsertSchema(dynamicWeights).omit({
  id: true,
  createdAt: true
});

export const insertEpisodicMemorySchema = createInsertSchema(episodicMemory).omit({
  id: true,
  createdAt: true
});

export const insertEmergentPatternsSchema = createInsertSchema(emergentPatterns).omit({
  id: true
});

export const insertStrategyEvolutionSchema = createInsertSchema(strategyEvolution).omit({
  id: true,
  createdAt: true,
  promotedAt: true,
  retiredAt: true
});

export const insertMetaLearningSchema = createInsertSchema(metaLearning).omit({
  id: true,
  createdAt: true,
  lastApplied: true
});

export const insertPerformanceAnalyticsSchema = createInsertSchema(performanceAnalytics).omit({
  id: true,
  createdAt: true
});

// TYPES PARA SISTEMA DE APRENDIZADO AVANÇADO

export type ExperimentTracking = typeof experimentTracking.$inferSelect;
export type InsertExperimentTracking = z.infer<typeof insertExperimentTrackingSchema>;
export type DynamicWeights = typeof dynamicWeights.$inferSelect;
export type InsertDynamicWeights = z.infer<typeof insertDynamicWeightsSchema>;
export type EpisodicMemory = typeof episodicMemory.$inferSelect;
export type InsertEpisodicMemory = z.infer<typeof insertEpisodicMemorySchema>;
export type EmergentPatterns = typeof emergentPatterns.$inferSelect;
export type InsertEmergentPatterns = z.infer<typeof insertEmergentPatternsSchema>;
export type StrategyEvolution = typeof strategyEvolution.$inferSelect;
export type InsertStrategyEvolution = z.infer<typeof insertStrategyEvolutionSchema>;
export type MetaLearning = typeof metaLearning.$inferSelect;
export type InsertMetaLearning = z.infer<typeof insertMetaLearningSchema>;
export type PerformanceAnalytics = typeof performanceAnalytics.$inferSelect;
export type InsertPerformanceAnalytics = z.infer<typeof insertPerformanceAnalyticsSchema>;

// ============================================
// SISTEMA DE RESILIÊNCIA E AUTO-RESTART
// ============================================

// Persistência de sessões ativas de trading
export const activeTradingSessions = sqliteTable('active_trading_sessions', {
  id: text('id').primaryKey().default(sql`(hex(randomblob(16)))`),
  sessionKey: text('session_key').notNull().unique(),
  userId: text('user_id').notNull().references(() => users.id),
  configId: text('config_id').notNull().references(() => tradeConfigurations.id),
  mode: text('mode').notNull(),
  operationsCount: integer('operations_count').notNull(),
  executedOperations: integer('executed_operations').notNull().default(0),
  intervalType: text('interval_type').notNull(),
  intervalValue: integer('interval_value').notNull(),
  lastExecutionTime: text('last_execution_time'),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// Persistência de subscrições WebSocket ativas
export const activeWebSocketSubscriptions = sqliteTable('active_websocket_subscriptions', {
  id: text('id').primaryKey().default(sql`(hex(randomblob(16)))`),
  symbol: text('symbol').notNull(),
  subscriptionId: text('subscription_id').notNull(),
  subscriptionType: text('subscription_type').notNull(), // 'ticks', 'candles', 'proposal'
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// Monitoramento de saúde do sistema (heartbeat)
export const systemHealthHeartbeat = sqliteTable('system_health_heartbeat', {
  id: text('id').primaryKey().default(sql`(hex(randomblob(16)))`),
  componentName: text('component_name').notNull().unique(), // 'scheduler', 'websocket', 'market_collector'
  lastHeartbeat: text('last_heartbeat').notNull(),
  status: text('status').notNull().default('healthy'), // 'healthy', 'degraded', 'failed'
  errorCount: integer('error_count').notNull().default(0),
  lastError: text('last_error'),
  metadata: text('metadata', { mode: 'json' }),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

// SCHEMAS PARA SISTEMA DE RESILIÊNCIA

export const insertActiveTradingSessionSchema = createInsertSchema(activeTradingSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertActiveWebSocketSubscriptionSchema = createInsertSchema(activeWebSocketSubscriptions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSystemHealthHeartbeatSchema = createInsertSchema(systemHealthHeartbeat).omit({
  id: true,
  updatedAt: true,
});

// TYPES PARA SISTEMA DE RESILIÊNCIA

export type ActiveTradingSession = typeof activeTradingSessions.$inferSelect;
export type InsertActiveTradingSession = z.infer<typeof insertActiveTradingSessionSchema>;
export type ActiveWebSocketSubscription = typeof activeWebSocketSubscriptions.$inferSelect;
export type InsertActiveWebSocketSubscription = z.infer<typeof insertActiveWebSocketSubscriptionSchema>;
export type SystemHealthHeartbeat = typeof systemHealthHeartbeat.$inferSelect;
export type InsertSystemHealthHeartbeat = z.infer<typeof insertSystemHealthHeartbeatSchema>;


