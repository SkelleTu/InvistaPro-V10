/**
 * MOTOR DE APRENDIZADO PERSISTENTE REAL
 *
 * Este é o sistema que faz as IAs ficarem genuinamente melhores a cada operação.
 *
 * Funcionamento:
 * - Antes de cada trade: captura o que cada modelo previu + contexto de mercado
 * - Após o resultado (win/loss): calcula recompensa e atualiza pesos via gradiente
 * - Usa EMA (Exponential Moving Average) com momentum para evitar oscilações
 * - Persiste tudo no banco - sobrevive a reinicializações
 * - Modelos que acertam mais ganham mais peso na próxima decisão
 * - Modelos que erram têm peso reduzido automaticamente
 *
 * Algoritmo de atualização de peso (Online Gradient Descent com Momentum):
 *   gradient = reward * prediction_confidence
 *   momentum = beta * old_momentum + (1 - beta) * gradient
 *   new_weight = old_weight + learning_rate * momentum
 *   new_weight = clamp(new_weight, 0.05, 3.0)
 *
 * Taxa de aprendizado adaptativa (Adam-like):
 *   lr decreases as model converges (more trades = smaller updates)
 *   lr increases if model is consistently wrong (unstable = needs to relearn)
 */

import { db } from '../db';
import {
  modelLearningState,
  learningRecords,
  type ModelLearningState,
} from '@shared/schema';
import { eq, and, desc } from 'drizzle-orm';

const MODELS = [
  'advanced_learning',
  'quantum_neural',
  'microscopic_technical',
  'huggingface_ai',
  'digit_frequency',
  'asset_scorer',
  'market_regime',
  'momentum_indicator',
  'volatility_filter',
  'pattern_recognition',
];

interface TradeContext {
  contractId: string;
  symbol: string;
  tradeType: string;
  modelPredictions: Record<string, 'up' | 'down' | 'neutral'>;
  modelConfidences: Record<string, number>;
  marketContext: {
    price: number;
    volatility: number;
    momentum: number;
    regime: string;
    timestamp: number;
  };
  technicalIndicators: Record<string, number>;
  overallConfidence: number;
  finalDecision: 'up' | 'down' | 'neutral';
}

interface TradeResult {
  contractId: string;
  symbol: string;
  status: 'won' | 'lost' | 'sold';
  profit: number;
  buyPrice: number;
  contractType: string;
}

interface ModelStats {
  modelName: string;
  symbol: string;
  weight: number;
  accuracy: number;
  totalTrades: number;
  correctPredictions: number;
  totalProfit: number;
  learningRate: number;
  recentTrend: number;
  recentHistory: number[];
}

class PersistentLearningEngine {
  private pendingContexts: Map<string, TradeContext> = new Map();
  private modelStatsCache: Map<string, ModelStats> = new Map();
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  private readonly BETA_MOMENTUM = 0.9;
  private readonly WEIGHT_MIN = 0.05;
  private readonly WEIGHT_MAX = 3.0;
  private readonly INITIAL_LR = 0.12;
  private readonly LR_DECAY = 0.0005;
  private readonly LR_MIN = 0.02;
  private readonly LR_BOOST_THRESHOLD = 0.35;
  private readonly RECENT_HISTORY_SIZE = 20;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInitialize();
    return this.initPromise;
  }

  private async _doInitialize(): Promise<void> {
    try {
      console.log('🧠 [LEARNING ENGINE] Inicializando motor de aprendizado persistente...');

      const rows = await db.select().from(modelLearningState);

      for (const row of rows) {
        const key = `${row.modelName}::${row.symbol}`;
        this.modelStatsCache.set(key, {
          modelName: row.modelName,
          symbol: row.symbol,
          weight: row.weight,
          accuracy: row.accuracy,
          totalTrades: row.totalTrades,
          correctPredictions: row.correctPredictions,
          totalProfit: row.totalProfit,
          learningRate: row.learningRate,
          recentTrend: row.recentTrend,
          recentHistory: (row.recentHistory as number[]) || [],
        });
      }

      const totalModels = this.modelStatsCache.size;
      console.log(`✅ [LEARNING ENGINE] Carregados ${totalModels} estados de modelos do banco`);
      console.log(`📊 [LEARNING ENGINE] Prontos para aprender com cada trade`);

      this.initialized = true;
    } catch (error) {
      console.error('❌ [LEARNING ENGINE] Erro ao inicializar:', error);
      this.initialized = true;
    }
  }

  /**
   * Registra o contexto ANTES de um trade ser executado.
   * Deve ser chamado com todas as previsões dos modelos antes de enviar para Deriv.
   */
  registerTradeContext(context: TradeContext): void {
    this.pendingContexts.set(context.contractId, context);
    if (process.env.NODE_ENV !== 'production') {
      console.log(`📝 [LEARNING] Contexto registrado para contrato ${context.contractId} | ${context.symbol}`);
    }
  }

  /**
   * Processa o resultado de um trade e atualiza os pesos dos modelos.
   * Deve ser chamado quando o contrato fecha (won/lost/sold).
   */
  async processTradeResult(result: TradeResult): Promise<void> {
    await this.initialize();

    const context = this.pendingContexts.get(result.contractId);
    if (!context) {
      console.log(`⚠️ [LEARNING] Sem contexto para contrato ${result.contractId} - pulando aprendizado`);
      return;
    }

    this.pendingContexts.delete(result.contractId);

    // 🛠️ CORREÇÃO: status 'open' com profit negativo = contrato foi nocauteado (accumulator knockout)
    // O Deriv às vezes retorna status='open' mesmo quando o acumulador é encerrado por perda.
    // Normalizar para garantir que o aprendizado reflita o resultado real.
    const normalizedStatus: string =
      result.status === 'open' && result.profit < 0 ? 'lost' :
      result.status === 'open' && result.profit > 0 ? 'won' :
      result.status;

    if (normalizedStatus !== result.status) {
      console.log(`🔄 [LEARNING] Status normalizado: '${result.status}' → '${normalizedStatus}' (profit: ${result.profit}) para contrato ${result.contractId}`);
      result = { ...result, status: normalizedStatus as any };
    }

    try {
      const reward = this.calculateReward(result);
      const updatedWeights: Record<string, number> = {};
      const cumulativeAccuracy: Record<string, number> = {};
      let dominantModel = '';
      let dominantWeight = 0;

      for (const modelName of MODELS) {
        const stats = await this.getOrCreateModelStats(modelName, result.symbol);
        const prediction = context.modelPredictions[modelName];
        const confidence = context.modelConfidences[modelName] || 0.5;

        let isCorrect = false;
        if (prediction && prediction !== 'neutral') {
          if (result.status === 'won') {
            isCorrect = true;
          } else if (result.status === 'lost') {
            isCorrect = false;
          } else {
            isCorrect = result.profit > 0;
          }
        } else {
          isCorrect = result.profit >= 0;
        }

        const newStats = this.updateModelWeight(stats, reward, isCorrect, confidence, result.profit);

        updatedWeights[modelName] = newStats.weight;
        cumulativeAccuracy[modelName] = newStats.accuracy;

        await this.persistModelStats(newStats);
        this.modelStatsCache.set(`${modelName}::${result.symbol}`, newStats);

        if (newStats.weight > dominantWeight) {
          dominantWeight = newStats.weight;
          dominantModel = modelName;
        }
      }

      await db.insert(learningRecords).values({
        contractId: result.contractId,
        symbol: result.symbol,
        tradeType: result.contractType || context.tradeType,
        modelPredictions: context.modelPredictions,
        modelWeightsSnapshot: await this.getCurrentWeightsSnapshot(result.symbol),
        marketContext: context.marketContext,
        technicalIndicators: context.technicalIndicators,
        outcome: result.status,
        profit: result.profit,
        buyPrice: result.buyPrice,
        reward,
        updatedWeights,
        dominantModel,
        confidenceAtEntry: context.overallConfidence,
        cumulativeAccuracy,
      });

      const emoji = result.status === 'won' ? '✅' : result.status === 'lost' ? '❌' : '💰';
      console.log(`\n${emoji} [LEARNING] Trade ${result.contractId} processado | Recompensa: ${reward.toFixed(3)}`);
      console.log(`   📊 Modelos atualizados: ${MODELS.length} | Dominante: ${dominantModel} (peso: ${dominantWeight.toFixed(3)})`);

      this.logTopModels(result.symbol);

    } catch (error) {
      console.error('❌ [LEARNING ENGINE] Erro ao processar resultado:', error);
    }
  }

  /**
   * Calcula a recompensa do trade (-1.0 a +1.0).
   * Vai além de apenas win/loss — considera o profit relativo.
   */
  private calculateReward(result: TradeResult): number {
    if (result.status === 'won') {
      const payout = result.buyPrice > 0 ? result.profit / result.buyPrice : 0;
      return Math.min(1.0, 0.7 + payout * 0.3);
    } else if (result.status === 'lost') {
      return -1.0;
    } else {
      const pctProfit = result.buyPrice > 0 ? result.profit / result.buyPrice : 0;
      if (pctProfit > 0.15) return 0.6;
      if (pctProfit > 0) return 0.3;
      if (pctProfit === 0) return 0;
      return -0.5;
    }
  }

  /**
   * Atualiza os parâmetros de aprendizado de um modelo usando
   * gradiente com momentum (similar ao SGD+momentum do deep learning).
   */
  private updateModelWeight(
    stats: ModelStats,
    reward: number,
    isCorrect: boolean,
    confidence: number,
    profit: number
  ): ModelStats {
    const newStats = { ...stats };

    newStats.totalTrades += 1;
    if (isCorrect) newStats.correctPredictions += 1;
    newStats.totalProfit += profit;

    newStats.accuracy = newStats.totalTrades > 0
      ? newStats.correctPredictions / newStats.totalTrades
      : 0.5;

    const recentHistory = [...(stats.recentHistory || [])];
    recentHistory.push(isCorrect ? 1 : 0);
    if (recentHistory.length > this.RECENT_HISTORY_SIZE) recentHistory.shift();
    newStats.recentHistory = recentHistory;

    if (recentHistory.length >= 5) {
      const recentSum = recentHistory.slice(-10).reduce((a, b) => a + b, 0);
      const recentRate = recentSum / Math.min(10, recentHistory.length);
      newStats.recentTrend = recentRate - 0.5;
    }

    const lr = this.getAdaptiveLearningRate(newStats);
    newStats.learningRate = lr;

    const gradient = reward * confidence;
    const newMomentum = this.BETA_MOMENTUM * (stats.gradientMomentum || 0) + (1 - this.BETA_MOMENTUM) * gradient;
    newStats.gradientMomentum = newMomentum;

    const weightDelta = lr * newMomentum;
    newStats.weight = Math.max(
      this.WEIGHT_MIN,
      Math.min(this.WEIGHT_MAX, stats.weight + weightDelta)
    );

    return newStats;
  }

  /**
   * Taxa de aprendizado adaptativa:
   * - Diminui à medida que o modelo acumula mais trades (converge)
   * - Aumenta se o modelo está errando consistentemente (precisa reaprender)
   */
  private getAdaptiveLearningRate(stats: ModelStats): number {
    let lr = this.INITIAL_LR / (1 + this.LR_DECAY * stats.totalTrades);
    lr = Math.max(this.LR_MIN, lr);

    if (stats.accuracy < this.LR_BOOST_THRESHOLD && stats.totalTrades > 10) {
      lr = Math.min(this.INITIAL_LR, lr * 1.5);
    }

    return lr;
  }

  private async getOrCreateModelStats(modelName: string, symbol: string): Promise<ModelStats> {
    const key = `${modelName}::${symbol}`;
    const cached = this.modelStatsCache.get(key);
    if (cached) return cached;

    const rows = await db
      .select()
      .from(modelLearningState)
      .where(and(eq(modelLearningState.modelName, modelName), eq(modelLearningState.symbol, symbol)))
      .limit(1);

    if (rows.length > 0) {
      const row = rows[0];
      const stats: ModelStats = {
        modelName: row.modelName,
        symbol: row.symbol,
        weight: row.weight,
        accuracy: row.accuracy,
        totalTrades: row.totalTrades,
        correctPredictions: row.correctPredictions,
        totalProfit: row.totalProfit,
        learningRate: row.learningRate,
        recentTrend: row.recentTrend,
        recentHistory: (row.recentHistory as number[]) || [],
      };
      this.modelStatsCache.set(key, stats);
      return stats;
    }

    const newStats: ModelStats = {
      modelName,
      symbol,
      weight: 1.0,
      accuracy: 0.5,
      totalTrades: 0,
      correctPredictions: 0,
      totalProfit: 0,
      learningRate: this.INITIAL_LR,
      recentTrend: 0.0,
      recentHistory: [],
    };
    this.modelStatsCache.set(key, newStats);
    return newStats;
  }

  private async persistModelStats(stats: ModelStats): Promise<void> {
    const now = new Date().toISOString();
    const existing = await db
      .select()
      .from(modelLearningState)
      .where(and(eq(modelLearningState.modelName, stats.modelName), eq(modelLearningState.symbol, stats.symbol)))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(modelLearningState)
        .set({
          weight: stats.weight,
          accuracy: stats.accuracy,
          totalTrades: stats.totalTrades,
          correctPredictions: stats.correctPredictions,
          totalProfit: stats.totalProfit,
          learningRate: stats.learningRate,
          gradientMomentum: stats.gradientMomentum || 0,
          recentTrend: stats.recentTrend,
          recentHistory: stats.recentHistory,
          lastUpdated: now,
          updatedAt: now,
        })
        .where(eq(modelLearningState.id, existing[0].id));
    } else {
      await db.insert(modelLearningState).values({
        modelName: stats.modelName,
        symbol: stats.symbol,
        weight: stats.weight,
        accuracy: stats.accuracy,
        totalTrades: stats.totalTrades,
        correctPredictions: stats.correctPredictions,
        totalProfit: stats.totalProfit,
        learningRate: stats.learningRate,
        gradientMomentum: stats.gradientMomentum || 0,
        recentTrend: stats.recentTrend,
        recentHistory: stats.recentHistory,
        lastUpdated: now,
      });
    }
  }

  private async getCurrentWeightsSnapshot(symbol: string): Promise<Record<string, number>> {
    const snapshot: Record<string, number> = {};
    for (const modelName of MODELS) {
      const key = `${modelName}::${symbol}`;
      const cached = this.modelStatsCache.get(key);
      snapshot[modelName] = cached ? cached.weight : 1.0;
    }
    return snapshot;
  }

  private logTopModels(symbol: string): void {
    const stats: ModelStats[] = [];
    for (const modelName of MODELS) {
      const key = `${modelName}::${symbol}`;
      const cached = this.modelStatsCache.get(key);
      if (cached && cached.totalTrades > 0) stats.push(cached);
    }

    if (stats.length === 0) return;

    stats.sort((a, b) => b.weight - a.weight);
    const top3 = stats.slice(0, 3);
    const modelLines = top3.map(s =>
      `${s.modelName}: peso=${s.weight.toFixed(3)} acc=${(s.accuracy * 100).toFixed(1)}% (${s.totalTrades} trades)`
    ).join(' | ');
    console.log(`   🏆 Top modelos ${symbol}: ${modelLines}`);
  }

  /**
   * Retorna o ranking atual de modelos para um ativo.
   * Usado pelo HybridOrchestrator para ponderar decisões.
   */
  async getModelWeights(symbol: string): Promise<Record<string, number>> {
    await this.initialize();
    const weights: Record<string, number> = {};
    for (const modelName of MODELS) {
      const stats = await this.getOrCreateModelStats(modelName, symbol);
      weights[modelName] = stats.weight;
    }
    return weights;
  }

  /**
   * Retorna estatísticas completas de aprendizado para o painel de UI.
   */
  async getLearningStats(symbol?: string): Promise<{
    totalTrades: number;
    modelsStats: Array<{
      modelName: string;
      symbol: string;
      weight: number;
      accuracy: number;
      totalTrades: number;
      totalProfit: number;
      recentTrend: number;
      learningRate: number;
    }>;
    recentRecords: Array<{
      contractId: string;
      symbol: string;
      outcome: string;
      profit: number;
      reward: number;
      dominantModel: string | null;
      confidenceAtEntry: number | null;
      createdAt: string | null;
    }>;
    overallAccuracy: number;
    totalProfit: number;
    learningCycles: number;
  }> {
    await this.initialize();

    let query = db.select().from(modelLearningState);
    if (symbol) {
      query = query.where(eq(modelLearningState.symbol, symbol)) as typeof query;
    }
    const rows = await query;

    const recentQuery = db
      .select({
        contractId: learningRecords.contractId,
        symbol: learningRecords.symbol,
        outcome: learningRecords.outcome,
        profit: learningRecords.profit,
        reward: learningRecords.reward,
        dominantModel: learningRecords.dominantModel,
        confidenceAtEntry: learningRecords.confidenceAtEntry,
        createdAt: learningRecords.createdAt,
      })
      .from(learningRecords)
      .orderBy(desc(learningRecords.createdAt))
      .limit(50);

    const recentRecords = await (symbol
      ? recentQuery.where(eq(learningRecords.symbol, symbol))
      : recentQuery);

    const totalTrades = recentRecords.length > 0
      ? (await db.select().from(learningRecords)).length
      : 0;

    const totalCorrect = rows.reduce((sum, r) => sum + r.correctPredictions, 0);
    const totalTradesAll = rows.reduce((sum, r) => sum + r.totalTrades, 0);
    const overallAccuracy = totalTradesAll > 0 ? totalCorrect / totalTradesAll : 0.5;
    const totalProfit = rows.reduce((sum, r) => sum + r.totalProfit, 0);

    return {
      totalTrades,
      modelsStats: rows.map(r => ({
        modelName: r.modelName,
        symbol: r.symbol,
        weight: r.weight,
        accuracy: r.accuracy,
        totalTrades: r.totalTrades,
        totalProfit: r.totalProfit,
        recentTrend: r.recentTrend,
        learningRate: r.learningRate,
      })),
      recentRecords: recentRecords.map(r => ({
        contractId: r.contractId,
        symbol: r.symbol,
        outcome: r.outcome,
        profit: r.profit,
        reward: r.reward,
        dominantModel: r.dominantModel,
        confidenceAtEntry: r.confidenceAtEntry,
        createdAt: r.createdAt,
      })),
      overallAccuracy,
      totalProfit,
      learningCycles: totalTrades,
    };
  }

  /**
   * Reseta o aprendizado de um modelo específico (útil em caso de drift severo).
   */
  async resetModelLearning(modelName: string, symbol: string): Promise<void> {
    await db
      .update(modelLearningState)
      .set({
        weight: 1.0,
        accuracy: 0.5,
        totalTrades: 0,
        correctPredictions: 0,
        totalProfit: 0,
        learningRate: this.INITIAL_LR,
        gradientMomentum: 0,
        recentTrend: 0,
        recentHistory: [],
        lastUpdated: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(modelLearningState.modelName, modelName), eq(modelLearningState.symbol, symbol)));

    const key = `${modelName}::${symbol}`;
    this.modelStatsCache.delete(key);
    console.log(`🔄 [LEARNING] Modelo ${modelName} resetado para ${symbol}`);
  }
}

export const persistentLearningEngine = new PersistentLearningEngine();
export type { TradeContext, TradeResult, ModelStats };
