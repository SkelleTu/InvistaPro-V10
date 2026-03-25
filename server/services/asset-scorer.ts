/**
 * ASSET SCORER — Sistema de Pontuação Multidimensional de Ativos
 * 
 * Avalia cada ativo em 6 dimensões operacionais para selecionar
 * o melhor ativo a operar em cada ciclo de trading:
 * 
 *  D1 Estatística    (20%) — chi-square, desvio padrão, z-score, confiança
 *  D2 Edge Matemático (25%) — EV, Kelly criterion, edge consistency  
 *  D3 Histórico       (20%) — win rate, streaks, lucro acumulado
 *  D4 Risco           (20%) — perdas consecutivas, volatilidade, blacklist
 *  D5 Qualidade Dados (10%) — ticks disponíveis, frescor, consistência
 *  D6 Sentimento IA   (5%)  — consensus, força do acordo entre modelos
 */

import { digitFrequencyAnalyzer } from './digit-frequency-analyzer.js';

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface AssetPerformanceRecord {
  wins: number;
  losses: number;
  lastTrades: boolean[];          // true=win, false=loss — últimas N operações
  totalProfit: number;
  lastTradeTime: number;
  consecutiveLosses: number;
  consecutiveWins: number;
  isBlacklisted: boolean;
  volatilityHistory: number[];    // últimos desvios padrão de preço
}

export interface AssetScoreInput {
  symbol: string;
  priceHistory: number[];         // array de preços recentes
  tickCount: number;              // total de ticks no buffer
  dataAgeMs: number;              // tempo desde o último tick em ms
  aiConsensusScore: number;       // 0-100 — score das 5 IAs
  aiAgreementStrength: number;    // 0-100 — quão alinhadas estão as 5 IAs
  performance: AssetPerformanceRecord | null;
  isBlacklisted: boolean;
  // Campos opcionais para scoring especializado por tipo de contrato
  contractType?: string;          // 'accumulator' | 'digit_differ' | etc.
  supremeStats?: {                // Dados do motor supremo (volatilidade real e regime)
    hurstExponent: number;
    shannonEntropy: number;
    zScoreVolatility: number;
    marketRegime: string;
  };
}

export interface DimensionScore {
  name: string;
  score: number;         // 0-100
  weight: number;        // 0-1
  details: string;
  contribution: number;  // score × weight
}

export interface AssetScoreResult {
  symbol: string;
  finalScore: number;              // 0-100 (score ponderado final)
  grade: 'S' | 'A' | 'B' | 'C' | 'D' | 'BLOCKED';
  dimensions: DimensionScore[];
  recommendation: string;
  blockedReason?: string;
  bestBarrier: string;
  digitEdge: number;
  expectedWinRate: number;
  kellyFraction: number;           // fração ótima do Kelly criterion (0-1)
  stakeMultiplier: number;         // multiplicador de stake sugerido (0.5 - 1.5)
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const PAYOUT_RATIO = 0.95;         // Deriv DIGIT DIFFER paga ~95% do stake em ganho
const BASE_WIN_RATE = 0.90;        // Win rate base do contrato DIFFER sem edge
const MAX_CONSECUTIVE_LOSSES = 5;  // Bloqueio temporário após N perdas seguidas
const MIN_TICKS_FOR_ANALYSIS = 50; // Mínimo de ticks para análise válida
const STALE_DATA_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutos

// Pesos de cada dimensão (soma = 1.0)
const WEIGHTS = {
  statistical: 0.20,
  mathematical: 0.25,
  historical: 0.20,
  risk: 0.20,
  dataQuality: 0.10,
  aiSentiment: 0.05
};

// ─── AssetScorer ──────────────────────────────────────────────────────────────

export class AssetScorer {

  /**
   * Pontua um ativo em todas as 6 dimensões e retorna o score final.
   * Para acumuladores (contractType='accumulator'), D1 e D2 usam métricas
   * de volatilidade e regime de mercado em vez de análise de frequência de dígitos.
   */
  scoreAsset(input: AssetScoreInput): AssetScoreResult {
    // Verificação de bloqueio imediato (descarte antes de qualquer cálculo)
    const blockCheck = this.checkHardBlocks(input);
    if (blockCheck) {
      return this.buildBlockedResult(input.symbol, blockCheck);
    }

    const isAccumulator = input.contractType === 'accumulator';

    let d1: DimensionScore;
    let d2: DimensionScore;
    let barrierResult: any;

    if (isAccumulator) {
      // ── ACCU D1: Volatilidade de Preço ────────────────────────────────────
      // Acumuladores perdem quando o preço cruza a barreira — baixa volatilidade = melhor
      d1 = this.scoreAccuVolatility(input);

      // ── ACCU D2: Regime de Mercado (Hurst + Entropia) ─────────────────────
      // Mercado trending/calm = bom para ACCU. Volátil/randômico = péssimo.
      d2 = this.scoreAccuRegime(input);

      // ACCU não tem barreira de dígito — usar placeholder
      barrierResult = { barrier: '0', edge: 0, confidence: 0 };
    } else {
      // Calcular frequência de dígitos para análises matemáticas/estatísticas
      const digitAnalysis = digitFrequencyAnalyzer.analyzeSymbolMultiWindow(input.symbol);
      barrierResult = digitFrequencyAnalyzer.getBestBarrier(input.symbol);
      d1 = this.scoreStatistical(input, digitAnalysis);
      d2 = this.scoreMathematical(input, digitAnalysis, barrierResult);
    }

    // ── D3: Histórico de Performance ─────────────────────────────────────────
    const d3 = this.scoreHistorical(input);

    // ── D4: Risco ────────────────────────────────────────────────────────────
    const d4 = this.scoreRisk(input);

    // ── D5: Qualidade dos Dados ───────────────────────────────────────────────
    const d5 = this.scoreDataQuality(input);

    // ── D6: Sentimento IA ─────────────────────────────────────────────────────
    const d6 = this.scoreAISentiment(input);

    const dimensions: DimensionScore[] = [d1, d2, d3, d4, d5, d6];

    // Score final ponderado
    const finalScore = dimensions.reduce((sum, d) => sum + d.contribution, 0);

    // Kelly criterion para stake ótimo
    const winRate = this.estimateWinRate(input, barrierResult.edge);
    const kellyFraction = this.calculateKelly(winRate, PAYOUT_RATIO);

    // Multiplicador de stake baseado no score final e Kelly
    const stakeMultiplier = this.calculateStakeMultiplier(finalScore, kellyFraction, d4.score);

    const grade = this.calculateGrade(finalScore);
    const recommendation = this.buildRecommendation(finalScore, dimensions, grade);

    return {
      symbol: input.symbol,
      finalScore: Math.round(finalScore * 10) / 10,
      grade,
      dimensions,
      recommendation,
      bestBarrier: barrierResult.barrier,
      digitEdge: barrierResult.edge,
      expectedWinRate: winRate * 100,
      kellyFraction,
      stakeMultiplier
    };
  }

  // ─── ACCU D1: Volatilidade de Preço ──────────────────────────────────────
  // Para acumuladores: volatilidade baixa = barreira mais difícil de atingir = melhor

  private scoreAccuVolatility(input: AssetScoreInput): DimensionScore {
    const prices = input.priceHistory.slice(-100);

    if (prices.length < 20) {
      return this.dim('Volatilidade ACCU', 40, WEIGHTS.statistical,
        `Histórico insuficiente (${prices.length} preços) — score conservador`);
    }

    // Calcular retornos percentuais tick-a-tick
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push(Math.abs((prices[i] - prices[i - 1]) / prices[i - 1]));
    }

    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Coeficiente de variação (volatilidade relativa)
    // ACCU: quanto menor a volatilidade, mais seguro para entrar
    const cv = mean; // média dos movimentos tick-a-tick (já é relativa ao preço)

    // Score: volatilidade baixa = score alto (seguro para ACCU)
    // cv < 0.001 (0.1%/tick) = muito calmo = 95
    // cv < 0.002 (0.2%/tick) = calmo = 80
    // cv < 0.003 (0.3%/tick) = moderado = 60
    // cv < 0.005 (0.5%/tick) = agitado = 40
    // cv >= 0.005 = muito agitado = 20
    let score: number;
    if      (cv < 0.001) score = 95;
    else if (cv < 0.002) score = 80;
    else if (cv < 0.003) score = 62;
    else if (cv < 0.005) score = 42;
    else                  score = 20;

    // Bônus se dados do motor supremo confirmam baixa volatilidade
    if (input.supremeStats) {
      const zVol = input.supremeStats.zScoreVolatility;
      if (zVol < 1.0) score = Math.min(100, score + 10); // volatilidade abaixo do normal = bom
      else if (zVol > 2.0) score = Math.max(0, score - 20); // volatilidade anormal = muito ruim para ACCU
    }

    return this.dim('Volatilidade ACCU', score, WEIGHTS.statistical,
      `mvto-médio=${(cv * 100).toFixed(3)}%/tick | σ=${(stdDev * 100).toFixed(3)}% | n=${prices.length}${input.supremeStats ? ` | zVol=${input.supremeStats.zScoreVolatility.toFixed(2)}` : ''}`);
  }

  // ─── ACCU D2: Regime de Mercado (Hurst + Entropia) ───────────────────────
  // Para acumuladores: trending ou calm = bom. Randômico ou muito volátil = ruim.

  private scoreAccuRegime(input: AssetScoreInput): DimensionScore {
    if (!input.supremeStats) {
      // Sem dados do motor supremo, estimar pela série de preços
      const prices = input.priceHistory.slice(-50);
      if (prices.length < 20) {
        return this.dim('Regime ACCU', 40, WEIGHTS.mathematical,
          'Motor supremo indisponível — sem estimativa de regime');
      }

      // Estimativa simples de Hurst pela autocorrelação de lag-1
      const returns: number[] = [];
      for (let i = 1; i < prices.length; i++) {
        returns.push(prices[i] - prices[i - 1]);
      }
      const n = returns.length;
      if (n < 10) {
        return this.dim('Regime ACCU', 45, WEIGHTS.mathematical,
          'Histórico insuficiente para estimar regime');
      }
      const mean = returns.reduce((s, r) => s + r, 0) / n;
      let cov = 0, varSum = 0;
      for (let i = 0; i < n - 1; i++) {
        cov += (returns[i] - mean) * (returns[i + 1] - mean);
        varSum += Math.pow(returns[i] - mean, 2);
      }
      // Proteção contra divisão por zero (mercado completamente estático)
      const autocorr = varSum > 1e-12 ? Math.max(-1, Math.min(1, cov / varSum)) : 0;
      // Autocorrelação positiva = trending (Hurst > 0.5), negativa = mean-reverting
      const hurstProxy = Math.max(0.1, Math.min(0.9, 0.5 + autocorr * 0.3));

      let score = 50;
      if (hurstProxy > 0.62) score = 78; // trending → bom para ACCU
      else if (hurstProxy > 0.52) score = 62;
      else if (hurstProxy < 0.40) score = 55; // mean-reverting → aceitável
      else score = 40; // randômico → ruim

      return this.dim('Regime ACCU', score, WEIGHTS.mathematical,
        `Hurst estimado=${hurstProxy.toFixed(2)} | autocorr=${autocorr.toFixed(3)} | regime=estimado`);
    }

    const { hurstExponent, shannonEntropy, marketRegime } = input.supremeStats;

    // Mapa de regime → score para ACCU
    // Mercado em tendência clara = ótimo (barreira em 1 direção, preço vai embora da outra)
    // Mercado calmo = bom (menos chance de atingir barreira)
    // Mercado randômico/volátil = ruim (preço pode ir em qualquer direção)
    const regimeScores: Record<string, number> = {
      'strong_trend':    90,
      'weak_trend':      75,
      'calm':            80,
      'ranging':         65,
      'mean_reverting':  55,
      'neutral':         45,
      'unknown':         30,
      'volatile':        20,
      'chaotic':         10,
    };
    let regimeScore = regimeScores[marketRegime] ?? 40;

    // Ajuste pelo expoente de Hurst (medida mais precisa que o rótulo)
    // Hurst > 0.6 = trending → bom para ACCU
    // Hurst ~0.5 = randômico → neutro
    // Hurst < 0.4 = mean-reverting → aceitável mas não ótimo
    if (hurstExponent > 0.65)       regimeScore = Math.min(100, regimeScore + 15);
    else if (hurstExponent > 0.55)  regimeScore = Math.min(100, regimeScore + 5);
    else if (hurstExponent < 0.40)  regimeScore = Math.max(0, regimeScore - 5);
    else if (hurstExponent < 0.35)  regimeScore = Math.max(0, regimeScore - 15);

    // Penalidade por alta entropia (mercado imprevisível)
    if (shannonEntropy > 3.0) regimeScore = Math.max(0, regimeScore - 15);
    else if (shannonEntropy < 2.0) regimeScore = Math.min(100, regimeScore + 10);

    return this.dim('Regime ACCU', regimeScore, WEIGHTS.mathematical,
      `Hurst=${hurstExponent.toFixed(2)} | Entropia=${shannonEntropy.toFixed(2)} | Regime=${marketRegime}`);
  }

  // ─── D1: Dimensão Estatística ─────────────────────────────────────────────

  private scoreStatistical(input: AssetScoreInput, digitAnalysis: any): DimensionScore {
    const digits = input.priceHistory.slice(-500)
      .map(p => {
        const s = p.toString().replace(/[^0-9]/g, '');
        return s.length > 0 ? parseInt(s[s.length - 1]) : -1;
      })
      .filter(d => d >= 0 && d <= 9);

    if (digits.length < MIN_TICKS_FOR_ANALYSIS) {
      return this.dim('Estatística', 50, WEIGHTS.statistical,
        `Dados insuficientes: ${digits.length} ticks (mín. ${MIN_TICKS_FOR_ANALYSIS})`);
    }

    const counts = new Array(10).fill(0);
    for (const d of digits) counts[d]++;
    const n = digits.length;
    const expected = n / 10;

    // Chi-square test: mede desvio da distribuição uniforme esperada
    // X² = Σ((observado - esperado)² / esperado)
    // Valor alto = distribuição não-uniforme = edge estatístico real
    const chiSquare = counts.reduce((sum, count) => {
      return sum + Math.pow(count - expected, 2) / expected;
    }, 0);

    // Chi-square crítico para df=9, α=0.05 = 16.92
    // Se X² > 16.92, a distribuição é estatisticamente não-uniforme (p < 0.05)
    const chiSquareCritical = 16.92;
    const isSignificant = chiSquare > chiSquareCritical;
    const chiScore = Math.min(100, (chiSquare / chiSquareCritical) * 60 + (isSignificant ? 20 : 0));

    // Desvio padrão das frequências: quão dispersas estão as frequências
    const frequencies = counts.map(c => c / n);
    const meanFreq = 0.10;
    const stdDev = Math.sqrt(frequencies.reduce((s, f) => s + Math.pow(f - meanFreq, 2), 0) / 10);

    // Z-score do dígito mais frio: quão anormal é sua baixa frequência
    if (digitAnalysis) {
      const coldest = digitAnalysis.digits.sort((a: any, b: any) => a.frequency - b.frequency)[0];
      const zScore = (meanFreq - coldest.frequency) / (stdDev || 0.001);
      // Z-score > 1.645 = significativo (95% confiança), > 2.326 = muito significativo (99%)
      const zScore95 = zScore > 1.645;
      const zScore99 = zScore > 2.326;
      const zScoreScore = Math.min(100, zScore * 25);
      const confidenceBonus = zScore99 ? 20 : (zScore95 ? 10 : 0);
      const sampleBonus = Math.min(20, (n / MIN_TICKS_FOR_ANALYSIS) * 5);

      const finalScore = Math.min(100, chiScore * 0.4 + zScoreScore * 0.4 + confidenceBonus + sampleBonus);
      return this.dim('Estatística', finalScore, WEIGHTS.statistical,
        `X²=${chiSquare.toFixed(1)}${isSignificant ? '✓signif' : ''} | σ=${(stdDev*100).toFixed(2)}% | Z-score=${zScore.toFixed(2)}${zScore99 ? '(99%)' : zScore95 ? '(95%)' : ''} | n=${n}`);
    }

    const sampleScore = Math.min(40, (n / 300) * 40);
    const score = Math.min(100, chiScore * 0.7 + sampleScore);
    return this.dim('Estatística', score, WEIGHTS.statistical,
      `X²=${chiSquare.toFixed(1)} | σ=${(stdDev*100).toFixed(2)}% | n=${n}`);
  }

  // ─── D2: Edge Matemático ──────────────────────────────────────────────────

  private scoreMathematical(input: AssetScoreInput, digitAnalysis: any, barrierResult: any): DimensionScore {
    const edge = barrierResult.edge;
    const confidence = barrierResult.confidence;
    const winRate = BASE_WIN_RATE + Math.max(0, edge / 100);

    // Expected Value (EV) por unidade de stake
    // EV = P(win) × payout - P(loss) × 1
    // DIFFER paga ~95% do stake em ganho (ex: $1 stake → $0.95 lucro se ganhar)
    const ev = winRate * PAYOUT_RATIO - (1 - winRate) * 1.0;

    // Kelly criterion: f* = (p × b - q) / b
    // onde b = odds_payout, p = winRate, q = 1 - winRate
    const kellyFraction = this.calculateKelly(winRate, PAYOUT_RATIO);

    // Consistência do edge entre múltiplas janelas (se disponível)
    let consistencyScore = 50;
    if (digitAnalysis && digitAnalysis.digits) {
      const windowResults = [100, 300, 500]
        .map(ws => digitFrequencyAnalyzer.analyzeSymbol(input.symbol, ws))
        .filter(r => r !== null);

      if (windowResults.length >= 2) {
        const edges = windowResults.map(r => r!.coldestDigitEdge);
        const allPositive = edges.every(e => e > 0);
        const allSameDigit = windowResults.map(r => r!.coldestDigit)
          .every(d => d === windowResults[0]!.coldestDigit);
        const edgeVariance = Math.max(...edges) - Math.min(...edges);

        if (allPositive && allSameDigit && edgeVariance < 3) consistencyScore = 100;
        else if (allPositive && edgeVariance < 5) consistencyScore = 80;
        else if (allPositive) consistencyScore = 65;
        else consistencyScore = 40;
      }
    }

    // Score baseado em: EV (positivo é bom), edge, Kelly, consistência
    const evScore = ev > 0 ? Math.min(100, ev * 2000) : 0; // EV de 5% = score 100
    const edgeScore = Math.min(100, confidence * 0.5 + Math.max(0, edge) * 8);
    const kellyScore = Math.min(100, kellyFraction * 500); // Kelly 20% = score 100

    const score = (evScore * 0.35) + (edgeScore * 0.35) + (consistencyScore * 0.30);
    return this.dim('Edge Matemático', Math.min(100, score), WEIGHTS.mathematical,
      `EV=${(ev*100).toFixed(2)}% | edge=+${edge.toFixed(1)}% | Kelly=${(kellyFraction*100).toFixed(1)}% | consist=${consistencyScore.toFixed(0)}`);
  }

  // ─── D3: Histórico de Performance ─────────────────────────────────────────

  private scoreHistorical(input: AssetScoreInput): DimensionScore {
    const perf = input.performance;

    if (!perf || (perf.wins + perf.losses) === 0) {
      return this.dim('Histórico', 65, WEIGHTS.historical,
        'Sem histórico — usando score neutro favorável');
    }

    const totalTrades = perf.wins + perf.losses;
    const winRate = perf.wins / totalTrades;
    const winRateScore = winRate * 100;

    // Streak de vitórias: bônus progressivo
    const winStreakBonus = perf.consecutiveWins > 0
      ? Math.min(25, perf.consecutiveWins * 5)
      : 0;

    // Streak de derrotas: penalidade progressiva
    const lossStreakPenalty = perf.consecutiveLosses > 0
      ? Math.min(40, perf.consecutiveLosses * 8)
      : 0;

    // Win rate das últimas N operações (memória curta — mais relevante)
    const recentTrades = perf.lastTrades.slice(-10);
    const recentWinRate = recentTrades.length > 0
      ? recentTrades.filter(t => t).length / recentTrades.length
      : winRate;
    const recentScore = recentWinRate * 100;

    // Lucro acumulado no ativo
    const profitScore = perf.totalProfit >= 0
      ? Math.min(20, perf.totalProfit * 10)
      : Math.max(-20, perf.totalProfit * 10);

    // Sample size adequacy (mais trades = mais confiança)
    const sampleWeight = Math.min(1.0, totalTrades / 20);

    const rawScore = (winRateScore * 0.4 + recentScore * 0.4 + profitScore) + winStreakBonus - lossStreakPenalty;
    const finalScore = Math.min(100, Math.max(0, rawScore * sampleWeight + 65 * (1 - sampleWeight)));

    return this.dim('Histórico', finalScore, WEIGHTS.historical,
      `WR=${(winRate*100).toFixed(0)}% | recent=${(recentWinRate*100).toFixed(0)}% | ${perf.wins}W/${perf.losses}L | streak=${perf.consecutiveWins > 0 ? `+${perf.consecutiveWins}win` : perf.consecutiveLosses > 0 ? `-${perf.consecutiveLosses}loss` : '0'} | P&L=${perf.totalProfit >= 0 ? '+' : ''}$${perf.totalProfit.toFixed(2)}`);
  }

  // ─── D4: Risco ────────────────────────────────────────────────────────────

  private scoreRisk(input: AssetScoreInput): DimensionScore {
    const perf = input.performance;
    let score = 80; // Score de risco começa alto (baixo risco) e vai caindo

    // Penalidade por perdas consecutivas (risco crescente)
    const consLosses = perf?.consecutiveLosses || 0;
    if (consLosses >= MAX_CONSECUTIVE_LOSSES) {
      return this.dim('Risco', 0, WEIGHTS.risk,
        `🚫 BLOQUEIO: ${consLosses} perdas consecutivas (máx: ${MAX_CONSECUTIVE_LOSSES})`);
    }
    const lossPenalty = consLosses * 12; // Cada perda consecutiva = -12 pontos
    score -= lossPenalty;

    // Penalidade por taxa de perda recente alta (últimas 5 ops)
    if (perf && perf.lastTrades.length >= 5) {
      const last5 = perf.lastTrades.slice(-5);
      const last5Losses = last5.filter(t => !t).length;
      if (last5Losses >= 4) {
        score -= 20; // 4+ perdas nos últimos 5 trades = sinal de risco alto
      } else if (last5Losses >= 3) {
        score -= 10;
      }
    }

    // Volatilidade do ativo (desvio padrão dos preços)
    if (input.priceHistory.length >= 20) {
      const recent = input.priceHistory.slice(-20);
      const mean = recent.reduce((s, p) => s + p, 0) / recent.length;
      const variance = recent.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / recent.length;
      const stdDev = Math.sqrt(variance);
      const cv = stdDev / mean; // Coeficiente de variação
      // Alta volatilidade relativa = mais imprevisível = mais risco
      if (cv > 0.05) score -= 15;
      else if (cv > 0.02) score -= 8;
    }

    // Penalidade por dados velhos (risco de informação desatualizada)
    if (input.dataAgeMs > STALE_DATA_THRESHOLD_MS) {
      score -= 20;
    } else if (input.dataAgeMs > 60000) { // > 1 min
      score -= 5;
    }

    const finalScore = Math.min(100, Math.max(0, score));
    const details = [
      `perdas-consec=${consLosses}`,
      perf?.lastTrades.length ? `últimos5=${perf.lastTrades.slice(-5).filter(t => !t).length}L` : '',
      `dados-age=${(input.dataAgeMs / 1000).toFixed(0)}s`
    ].filter(Boolean).join(' | ');

    return this.dim('Risco', finalScore, WEIGHTS.risk, details);
  }

  // ─── D5: Qualidade dos Dados ──────────────────────────────────────────────

  private scoreDataQuality(input: AssetScoreInput): DimensionScore {
    let score = 0;

    // Quantidade de ticks: mais ticks = análise mais confiável
    const tickScore = Math.min(40, (input.tickCount / 500) * 40);
    score += tickScore;

    // Frescor dos dados: dados recentes são mais valiosos
    const ageMinutes = input.dataAgeMs / 60000;
    let freshnessScore = 0;
    if (ageMinutes < 1) freshnessScore = 40;
    else if (ageMinutes < 2) freshnessScore = 30;
    else if (ageMinutes < 5) freshnessScore = 15;
    else freshnessScore = 0;
    score += freshnessScore;

    // Consistência: verificar se histórico de preços tem gaps ou anomalias
    if (input.priceHistory.length >= 10) {
      const prices = input.priceHistory.slice(-50);
      let gapCount = 0;
      for (let i = 1; i < prices.length; i++) {
        const change = Math.abs(prices[i] - prices[i - 1]) / prices[i - 1];
        if (change > 0.10) gapCount++; // Gap > 10% = anomalia
      }
      const consistencyScore = Math.max(0, 20 - gapCount * 5);
      score += consistencyScore;
    }

    return this.dim('Qualidade Dados', Math.min(100, score), WEIGHTS.dataQuality,
      `ticks=${input.tickCount} | age=${(input.dataAgeMs / 1000).toFixed(0)}s | priceLen=${input.priceHistory.length}`);
  }

  // ─── D6: Sentimento IA ────────────────────────────────────────────────────

  private scoreAISentiment(input: AssetScoreInput): DimensionScore {
    const consensus = input.aiConsensusScore;
    const agreement = input.aiAgreementStrength;

    // Score base = força do consenso das IAs
    let score = consensus;

    // Bônus se todas as IAs estiverem bem alinhadas
    if (agreement >= 80) score = Math.min(100, score + 10);
    else if (agreement < 50) score = Math.max(0, score - 10);

    return this.dim('Sentimento IA', score, WEIGHTS.aiSentiment,
      `consensus=${consensus.toFixed(0)}% | acordo=${agreement.toFixed(0)}%`);
  }

  // ─── Verificação de Bloqueios Absolutos ───────────────────────────────────

  private checkHardBlocks(input: AssetScoreInput): string | null {
    if (input.isBlacklisted) return 'Ativo na lista negra (blacklist)';

    const consLosses = input.performance?.consecutiveLosses || 0;
    if (consLosses >= MAX_CONSECUTIVE_LOSSES) {
      return `${consLosses} perdas consecutivas (máx: ${MAX_CONSECUTIVE_LOSSES}) — cooling off obrigatório`;
    }

    if (input.tickCount < 10) {
      return `Dados insuficientes: apenas ${input.tickCount} ticks`;
    }

    if (input.dataAgeMs > 60 * 60 * 1000) { // > 60 minutos sem dados — alinhado com scheduler
      return `Dados muito desatualizados: ${(input.dataAgeMs / 60000).toFixed(0)} minutos`;
    }

    return null;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private calculateKelly(winRate: number, payoutRatio: number): number {
    // Kelly: f* = (p × b - q) / b
    // b = payoutRatio (retorno por unidade de stake em caso de vitória)
    // Limitado a 20% para proteção (half-Kelly na prática)
    const q = 1 - winRate;
    const kelly = (winRate * payoutRatio - q) / payoutRatio;
    return Math.max(0, Math.min(0.20, kelly)); // Máx 20% do bankroll
  }

  private estimateWinRate(input: AssetScoreInput, digitEdge: number): number {
    // Win rate base do DIFFER + edge estatístico do dígito frio
    const baseRate = BASE_WIN_RATE + Math.max(0, digitEdge / 100);

    // Ajuste por histórico de performance
    if (input.performance && (input.performance.wins + input.performance.losses) >= 10) {
      const historicalRate = input.performance.wins / (input.performance.wins + input.performance.losses);
      // Média ponderada: 70% estatístico + 30% histórico
      return Math.min(0.99, baseRate * 0.7 + historicalRate * 0.3);
    }

    return Math.min(0.99, baseRate);
  }

  private calculateStakeMultiplier(finalScore: number, kellyFraction: number, riskScore: number): number {
    // Score final alto + risco baixo + Kelly positivo = stake maior
    let multiplier = 1.0;

    if (finalScore >= 80 && riskScore >= 70) multiplier = 1.3;
    else if (finalScore >= 65 && riskScore >= 60) multiplier = 1.15;
    else if (finalScore >= 50 && riskScore >= 50) multiplier = 1.0;
    else if (finalScore >= 35) multiplier = 0.85;
    else multiplier = 0.70; // Muito baixo = reduziu bastante

    // Ajuste pelo Kelly: se Kelly sugere agressividade, aumentar um pouco
    if (kellyFraction >= 0.15) multiplier = Math.min(1.5, multiplier + 0.1);

    // Risco alto força redução
    if (riskScore < 40) multiplier = Math.min(multiplier, 0.85);

    return Math.round(multiplier * 100) / 100;
  }

  private calculateGrade(score: number): 'S' | 'A' | 'B' | 'C' | 'D' | 'BLOCKED' {
    if (score >= 80) return 'S';
    if (score >= 65) return 'A';
    if (score >= 50) return 'B';
    if (score >= 35) return 'C';
    return 'D';
  }

  private buildRecommendation(score: number, dims: DimensionScore[], grade: string): string {
    const weakest = [...dims].sort((a, b) => a.score - b.score)[0];
    const strongest = [...dims].sort((a, b) => b.score - a.score)[0];

    if (grade === 'S') return `✅ EXCELENTE — operar com stake amplificado`;
    if (grade === 'A') return `✅ BOM — operar normalmente`;
    if (grade === 'B') return `🟡 REGULAR — operar com stake conservador`;
    if (grade === 'C') return `⚠️ FRACO — operar apenas se não houver alternativa. Ponto fraco: ${weakest.name}`;
    return `❌ RUIM — evitar. Melhorar: ${weakest.name} (score ${weakest.score.toFixed(0)}/100)`;
  }

  private buildBlockedResult(symbol: string, reason: string): AssetScoreResult {
    return {
      symbol,
      finalScore: 0,
      grade: 'BLOCKED',
      dimensions: [],
      recommendation: `🚫 BLOQUEADO: ${reason}`,
      blockedReason: reason,
      bestBarrier: '5',
      digitEdge: 0,
      expectedWinRate: 90,
      kellyFraction: 0,
      stakeMultiplier: 0
    };
  }

  private dim(name: string, score: number, weight: number, details: string): DimensionScore {
    const s = Math.min(100, Math.max(0, score));
    return { name, score: Math.round(s * 10) / 10, weight, details, contribution: s * weight };
  }

  /**
   * Formata resumo completo para log — uma linha por dimensão
   */
  formatScoreLog(result: AssetScoreResult): string {
    if (result.grade === 'BLOCKED') {
      return `🚫 [${result.symbol}] BLOQUEADO: ${result.blockedReason}`;
    }
    const lines = [
      `📊 [ASSET SCORE] ${result.symbol} | NOTA=${result.grade} | Score=${result.finalScore}/100 | Barreira=${result.bestBarrier} | WR esperado=${result.expectedWinRate.toFixed(1)}% | Stake ×${result.stakeMultiplier}`
    ];
    for (const d of result.dimensions) {
      const bar = '█'.repeat(Math.round(d.score / 10)) + '░'.repeat(10 - Math.round(d.score / 10));
      lines.push(`   ${d.name.padEnd(18)} [${bar}] ${d.score.toFixed(0)}/100  ${d.details}`);
    }
    lines.push(`   → ${result.recommendation}`);
    return lines.join('\n');
  }
}

export const assetScorer = new AssetScorer();
