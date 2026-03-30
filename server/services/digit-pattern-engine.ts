/**
 * DIGIT PATTERN ENGINE — Motor de Análise Preditiva de Dígitos
 *
 * Vai além da frequência simples: usa padrões SEQUENCIAIS para estimar
 * qual dígito tem maior probabilidade de aparecer NO PRÓXIMO TICK.
 *
 * Técnicas combinadas:
 *  1. Markov Chain (ordem 1, 2, 3) — P(próximo | últimos N dígitos)
 *     Ex: se os últimos 3 dígitos foram [5,3,7], quem vem depois com mais frequência?
 *
 *  2. Momentum de Frequência — taxa de mudança da frequência por janela
 *     Dígito esquentando rápido = sinal mais forte que dígito apenas "quente"
 *
 *  3. Score Composto Preditivo — combina Markov + frequência + momentum
 *     Dígitos com alto score histórico E sequencialmente prováveis ganham
 *     stakes mais altos no Kelly
 *
 * Saída: digitPredictionScores[0..9] — probabilidade relativa de cada dígito
 * aparecer no próximo tick, calibrada para alimentar o Kelly diretamente.
 */

import { digitFrequencyAnalyzer } from './digit-frequency-analyzer';

interface MarkovState {
  // Tabelas de transição por ordem
  // order1[prev][next] = count de vezes que 'next' veio depois de 'prev'
  order1: number[][];  // [10][10]
  // order2[prev2*10+prev1][next] = count
  order2: number[][];  // [100][10]
  // order3[prev3*100+prev2*10+prev1][next] = count
  order3: number[][];  // [1000][10]
  totalTransitions: number;
}

interface DigitPredictionResult {
  symbol: string;
  scores: number[];           // [0..9] soma = 1.0 — probabilidade relativa de cada dígito
  markovProbabilities: number[]; // probabilidade pura Markov (ordem mais alta disponível)
  frequencyScores: number[];  // frequência ponderada multi-janela
  momentumScores: number[];   // taxa de mudança de frequência (normalizada)
  confidence: number;         // 0-100% — quão confiável é a previsão
  dominantDigit: number;      // dígito com maior score composto
  markovOrder: number;        // ordem Markov usada (1, 2 ou 3)
  sampleCount: number;        // transições observadas para calcular Markov
  insights: string[];         // resumo legível
}

class DigitPatternEngine {
  private markovStates: Map<string, MarkovState> = new Map();
  private recentDigitsCache: Map<string, number[]> = new Map();

  private readonly MIN_TRANSITIONS_ORDER1 = 30;
  private readonly MIN_TRANSITIONS_ORDER2 = 50;
  private readonly MIN_TRANSITIONS_ORDER3 = 100;

  // ── Inicializa tabelas Markov para um símbolo ──────────────────────────────
  private initMarkovState(): MarkovState {
    return {
      order1: Array.from({ length: 10 }, () => new Array(10).fill(0)),
      order2: Array.from({ length: 100 }, () => new Array(10).fill(0)),
      order3: Array.from({ length: 1000 }, () => new Array(10).fill(0)),
      totalTransitions: 0,
    };
  }

  /**
   * Alimenta o motor com a sequência de dígitos atual.
   * Chamado após cada atualização do digitFrequencyAnalyzer.
   */
  processDigitSequence(symbol: string, digits: number[]): void {
    if (digits.length < 4) return;

    let state = this.markovStates.get(symbol);
    if (!state) {
      state = this.initMarkovState();
      this.markovStates.set(symbol, state);
    }

    // Reset e recalcula com os últimos 500 dígitos (janela Markov)
    state.order1 = Array.from({ length: 10 }, () => new Array(10).fill(0));
    state.order2 = Array.from({ length: 100 }, () => new Array(10).fill(0));
    state.order3 = Array.from({ length: 1000 }, () => new Array(10).fill(0));
    state.totalTransitions = 0;

    const window = digits.slice(-500);

    for (let i = 1; i < window.length; i++) {
      const next = window[i];
      const prev1 = window[i - 1];
      state.order1[prev1][next]++;

      if (i >= 2) {
        const prev2 = window[i - 2];
        const key2 = prev2 * 10 + prev1;
        state.order2[key2][next]++;
      }

      if (i >= 3) {
        const prev3 = window[i - 3];
        const key3 = prev3 * 100 + window[i-2] * 10 + prev1;
        state.order3[key3][next]++;
      }

      state.totalTransitions++;
    }

    this.recentDigitsCache.set(symbol, window);
  }

  /**
   * Probabilidades Markov dado contexto recente.
   * Usa a maior ordem disponível com dados suficientes.
   */
  private getMarkovProbabilities(symbol: string): { probs: number[]; order: number; sampleCount: number } {
    const state = this.markovStates.get(symbol);
    const digits = this.recentDigitsCache.get(symbol);

    if (!state || !digits || digits.length < 4) {
      return { probs: new Array(10).fill(0.1), order: 0, sampleCount: 0 };
    }

    const len = digits.length;
    const d1 = digits[len - 1];
    const d2 = digits[len - 2];
    const d3 = digits[len - 3];

    // Tenta ordem 3 primeiro
    if (state.totalTransitions >= this.MIN_TRANSITIONS_ORDER3) {
      const key3 = d3 * 100 + d2 * 10 + d1;
      const row = state.order3[key3];
      const total = row.reduce((s, v) => s + v, 0);
      if (total >= 5) {
        const probs = row.map(v => (v + 0.5) / (total + 5)); // Laplace smoothing
        const sum = probs.reduce((s, v) => s + v, 0);
        return { probs: probs.map(p => p / sum), order: 3, sampleCount: total };
      }
    }

    // Tenta ordem 2
    if (state.totalTransitions >= this.MIN_TRANSITIONS_ORDER2) {
      const key2 = d2 * 10 + d1;
      const row = state.order2[key2];
      const total = row.reduce((s, v) => s + v, 0);
      if (total >= 5) {
        const probs = row.map(v => (v + 0.5) / (total + 5));
        const sum = probs.reduce((s, v) => s + v, 0);
        return { probs: probs.map(p => p / sum), order: 2, sampleCount: total };
      }
    }

    // Ordem 1 (fallback)
    if (state.totalTransitions >= this.MIN_TRANSITIONS_ORDER1) {
      const row = state.order1[d1];
      const total = row.reduce((s, v) => s + v, 0);
      if (total >= 3) {
        const probs = row.map(v => (v + 0.5) / (total + 5));
        const sum = probs.reduce((s, v) => s + v, 0);
        return { probs: probs.map(p => p / sum), order: 1, sampleCount: total };
      }
    }

    return { probs: new Array(10).fill(0.1), order: 0, sampleCount: 0 };
  }

  /**
   * Calcula momentum de frequência por dígito:
   * taxa de variação entre janela curta (10 ticks) e média (50 ticks)
   * Normalizado para [0, 1] — 0.5 = neutro, >0.5 = esquentando
   */
  private getMomentumScores(digits: number[]): number[] {
    const momentum = new Array(10).fill(0.5);
    if (digits.length < 15) return momentum;

    const window10 = digits.slice(-10);
    const window50 = digits.slice(-Math.min(50, digits.length));

    const freq10 = new Array(10).fill(0);
    const freq50 = new Array(10).fill(0);

    for (const d of window10) freq10[d]++;
    for (const d of window50) freq50[d]++;

    const total10 = window10.length;
    const total50 = window50.length;

    for (let d = 0; d < 10; d++) {
      const f10 = freq10[d] / total10;
      const f50 = freq50[d] / total50;
      // delta = f10 - f50; range tipico -0.15 a +0.15
      // Normaliza para [0,1]: 0.5 + delta * 3 clamped
      const raw = 0.5 + (f10 - f50) * 3.5;
      momentum[d] = Math.min(1.0, Math.max(0.0, raw));
    }

    return momentum;
  }

  /**
   * Gera scores preditivos completos para um símbolo.
   * Combina: Markov (40%) + Frequência multi-janela (40%) + Momentum (20%)
   *
   * Retorna probabilidades relativas para cada dígito [0..9],
   * prontas para alimentar o Kelly diretamente.
   */
  getPredictionScores(symbol: string): DigitPredictionResult {
    // Sincroniza com o digit frequency analyzer
    const analysis = digitFrequencyAnalyzer.analyzeSymbolMultiWindow(symbol);
    const stateData = (digitFrequencyAnalyzer as any).states?.get(symbol);
    const digits: number[] = stateData?.recentDigits ?? [];

    if (digits.length >= 4) {
      this.processDigitSequence(symbol, digits);
    }

    // ── 1. Probabilidades Markov ─────────────────────────────────────────────
    const { probs: markovProbs, order: markovOrder, sampleCount } = this.getMarkovProbabilities(symbol);

    // ── 2. Frequências multi-janela do analisador existente ──────────────────
    const freqScores = new Array(10).fill(0.1);
    if (analysis) {
      for (const d of analysis.digits) {
        // Usa combinedMatchScore normalizado para [0, 1]
        // combinedMatchScore varia tipicamente de -10 a +15
        freqScores[d.digit] = Math.max(0.01, (d.frequency + d.trendDiff * 0.01));
      }
      // Normaliza para soma = 1
      const freqSum = freqScores.reduce((s, v) => s + v, 0);
      for (let d = 0; d < 10; d++) freqScores[d] /= freqSum;
    }

    // ── 3. Momentum de frequência ────────────────────────────────────────────
    const momentumRaw = this.getMomentumScores(digits);
    // Normaliza momentum para soma = 1
    const momentumSum = momentumRaw.reduce((s, v) => s + v, 0);
    const momentumScores = momentumRaw.map(v => v / momentumSum);

    // ── 4. Score composto ────────────────────────────────────────────────────
    // Pesos: Markov tem mais peso quando há dados suficientes
    const markovWeight   = markovOrder >= 2 ? 0.45 : markovOrder === 1 ? 0.30 : 0.15;
    const freqWeight     = markovOrder >= 2 ? 0.38 : markovOrder === 1 ? 0.50 : 0.65;
    const momentumWeight = 1 - markovWeight - freqWeight; // ~0.17-0.20

    const compositeRaw = new Array(10).fill(0);
    for (let d = 0; d < 10; d++) {
      compositeRaw[d] =
        markovProbs[d]    * markovWeight   +
        freqScores[d]     * freqWeight     +
        momentumScores[d] * momentumWeight;
    }

    // Normaliza o score composto para soma = 1
    const compositeSum = compositeRaw.reduce((s, v) => s + v, 0);
    const scores = compositeRaw.map(v => v / compositeSum);

    // ── 5. Confiança ─────────────────────────────────────────────────────────
    // Cresce com dados: max 100% quando Markov ordem 3 com 200+ transições
    const dataConfidence = Math.min(100, (digits.length / 200) * 100);
    const markovConfidence = markovOrder >= 3 ? 100 : markovOrder === 2 ? 75 : markovOrder === 1 ? 45 : 20;
    const confidence = Math.round(dataConfidence * 0.6 + markovConfidence * 0.4);

    // ── 6. Dígito dominante ──────────────────────────────────────────────────
    const dominantDigit = scores.indexOf(Math.max(...scores));

    // ── 7. Insights legíveis ─────────────────────────────────────────────────
    const insights: string[] = [];
    const sortedByScore = scores
      .map((s, d) => ({ d, s }))
      .sort((a, b) => b.s - a.s);

    const top3 = sortedByScore.slice(0, 3);
    insights.push(`Top dígitos: ${top3.map(x => `${x.d}(${(x.s * 100).toFixed(1)}%)`).join(', ')}`);

    if (markovOrder >= 2) {
      const top1 = sortedByScore[0];
      const top2 = sortedByScore[1];
      const ratio = top1.s / (top2.s || 0.001);
      if (ratio > 1.5) {
        insights.push(`🎯 Markov Ord${markovOrder} aponta forte para dígito ${top1.d} (${ratio.toFixed(1)}× mais provável que 2º)`);
      } else {
        insights.push(`📊 Markov Ord${markovOrder}: distribuição equilibrada — apostar nos top 3`);
      }
    } else {
      insights.push(`⚠️ Dados insuficientes para Markov — usando frequência + momentum`);
    }

    // Detecta se um dígito está em anomalia de momentum (esquentando rápido)
    const hotMomentum = momentumRaw
      .map((m, d) => ({ d, m }))
      .filter(x => x.m > 0.72)
      .sort((a, b) => b.m - a.m);
    if (hotMomentum.length > 0) {
      insights.push(`🔥 Momentum acelerado: ${hotMomentum.map(x => `${x.d}(+${((x.m - 0.5) * 100).toFixed(0)}%)`).join(', ')}`);
    }

    return {
      symbol,
      scores,
      markovProbabilities: markovProbs,
      frequencyScores: freqScores,
      momentumScores,
      confidence,
      dominantDigit,
      markovOrder,
      sampleCount,
      insights,
    };
  }

  /**
   * Converte scores preditivos em stakes Kelly-ponderados.
   * Mantém o mesmo formato que computeSmartStakes usa,
   * mas baseado em probabilidade preditiva ao invés de frequência simples.
   *
   * @param symbol     - Símbolo analisado
   * @param baseAmount - Stake mínimo base ($)
   * @param minStake   - Mínimo absoluto por contrato ($0.35 para DIGITMATCH)
   * @returns stakes[0..9] — valor em $ a apostar em cada dígito
   */
  computePredictiveStakes(
    symbol: string,
    baseAmount: number,
    minStake: number = 0.35
  ): { stakes: Record<number, number>; prediction: DigitPredictionResult } {
    const prediction = this.getPredictionScores(symbol);
    const { scores } = prediction;

    // Kelly preditivo: stake_d = baseAmount × (score_d / score_uniforme)
    // score_uniforme = 1/10 = 0.10
    const stakes: Record<number, number> = {};
    const UNIFORM_PROB = 0.10;

    for (let d = 0; d < 10; d++) {
      const ratio = scores[d] / UNIFORM_PROB; // ex: 0.18 / 0.10 = 1.8
      const raw = baseAmount * ratio;
      stakes[d] = Math.max(minStake, parseFloat(raw.toFixed(2)));
    }

    return { stakes, prediction };
  }

  /**
   * Retorna os N dígitos com maiores scores preditivos.
   * Usado para selecionar quais dígitos cobrir no burst.
   */
  getTopPredictedDigits(symbol: string, n: number): number[] {
    const prediction = this.getPredictionScores(symbol);
    return prediction.scores
      .map((s, d) => ({ d, s }))
      .sort((a, b) => b.s - a.s)
      .slice(0, n)
      .map(x => x.d);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // SCORE DE ALINHAMENTO — Markov + Frequência
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Mede o grau de CONCORDÂNCIA entre o que Markov prediz e o que a frequência
   * histórica aponta. Quando ambos apontam para os mesmos dígitos quentes,
   * a confiança da entrada é máxima.
   *
   * Score 0-100:
   *   0-39  → Discordância: Markov e frequência divergem — aguardar
   *   40-69 → Alinhamento parcial — entrada com stake conservador
   *   70-100→ Alinhamento forte — entrada com stake pleno
   *
   * Também retorna Σ(score_composto²) como proxy para EV preditivo:
   * quanto mais concentrado o score em poucos dígitos, maior o edge.
   */
  getEntryAlignmentScore(symbol: string): {
    alignmentScore: number;   // 0-100 — concordância Markov × frequência
    entryQuality: 'strong' | 'moderate' | 'weak' | 'wait';
    topAlignedDigits: number[];  // dígitos onde ambos os sinais convergem
    predictiveEdge: number;   // Σ(score²)×10 — quanto mais alto, mais edge preditivo
    markovConfidence: number; // confiança do Markov (0-100)
    freqConfidence: number;   // confiança da frequência (0-100)
    combinedInsight: string;  // resumo para log
  } {
    const prediction = this.getPredictionScores(symbol);
    const { scores: markovFreqScores, markovOrder, confidence: markovConf } = prediction;

    // Top-3 do Markov e da frequência
    const sortedByComposite = markovFreqScores
      .map((s, d) => ({ d, s }))
      .sort((a, b) => b.s - a.s);
    const topMarkov = new Set(sortedByComposite.slice(0, 3).map(x => x.d));

    // Top-3 pela frequência pura (sem Markov)
    const freqScores = prediction.frequencyScores;
    const sortedByFreq = freqScores
      .map((s, d) => ({ d, s }))
      .sort((a, b) => b.s - a.s);
    const topFreq = new Set(sortedByFreq.slice(0, 3).map(x => x.d));

    // Overlap: quantos dígitos estão no top-3 de ambos
    const overlap = [...topMarkov].filter(d => topFreq.has(d)).length;
    const overlapScore = (overlap / 3) * 100; // 0, 33, 66, 100

    // Momento: os dígitos top-Markov também têm momentum positivo?
    const momentumScores = prediction.momentumScores;
    const topMarkovMomentum = [...topMarkov].map(d => momentumScores[d]);
    const avgMomentum = topMarkovMomentum.reduce((s, v) => s + v, 0) / 3;
    const momentumBonus = Math.max(0, (avgMomentum - 0.5) * 40); // -20 a +20

    // Score de alinhamento final
    const rawAlignment = overlapScore + momentumBonus;
    const alignmentScore = Math.min(100, Math.max(0, rawAlignment));

    // Classificação de qualidade
    let entryQuality: 'strong' | 'moderate' | 'weak' | 'wait';
    if (alignmentScore >= 70 && markovConf >= 50) entryQuality = 'strong';
    else if (alignmentScore >= 40 && markovConf >= 30) entryQuality = 'moderate';
    else if (alignmentScore >= 20) entryQuality = 'weak';
    else entryQuality = 'wait';

    // Dígitos alinhados: top de ambos os sinais
    const topAlignedDigits = [...topMarkov].filter(d => topFreq.has(d));
    if (topAlignedDigits.length === 0) {
      // fallback: top-2 do composto
      topAlignedDigits.push(...sortedByComposite.slice(0, 2).map(x => x.d));
    }

    // Edge preditivo: Σ(score²) — quanto mais concentrado, mais edge
    const predictiveEdge = markovFreqScores.reduce((s, v) => s + v * v, 0) * 10;

    const combinedInsight = `Alinhamento=${alignmentScore.toFixed(0)}% (overlap=${overlap}/3) | ` +
      `MarkovOrd${markovOrder} conf=${markovConf}% | momentum=${(avgMomentum*100).toFixed(0)}% | ` +
      `qualidade=${entryQuality.toUpperCase()} | digits=[${topAlignedDigits.join(',')}]`;

    return {
      alignmentScore,
      entryQuality,
      topAlignedDigits,
      predictiveEdge,
      markovConfidence: markovConf,
      freqConfidence: Math.min(100, (this.recentDigitsCache.get(symbol)?.length ?? 0) / 200 * 100),
      combinedInsight,
    };
  }

  /**
   * GATE DE ENTRADA COMPLETO — combina EV matemático + alinhamento Markov + momentum.
   * Retorna uma decisão GO/NO-GO clara para o motor de trading.
   *
   * @param symbol        - Símbolo
   * @param payout        - Payout do contrato (ex: 8.5)
   * @param nDigits       - Quantos dígitos serão cobertos
   * @param minAlignment  - Score mínimo de alinhamento (default 40)
   */
  getFullEntryDecision(symbol: string, payout: number = 8.5, nDigits: number = 10, minAlignment: number = 40): {
    goTrade: boolean;           // DECISÃO FINAL
    reason: string;             // justificativa
    alignment: ReturnType<DigitPatternEngine['getEntryAlignmentScore']>;
    targetDigits: number[];     // dígitos recomendados para cobertura
    stakeBoost: number;         // multiplicador sugerido (1.0 = normal, >1 = boost para sinal forte)
  } {
    const alignment = this.getEntryAlignmentScore(symbol);
    const topDigits = this.getTopPredictedDigits(symbol, nDigits);

    const alignmentOk = alignment.alignmentScore >= minAlignment;
    const markovReliable = alignment.markovConfidence >= 30 || alignment.entryQuality !== 'wait';

    if (!alignmentOk) {
      return {
        goTrade: false,
        reason: `NO-GO: Alinhamento fraco (${alignment.alignmentScore.toFixed(0)}% < ${minAlignment}%). Markov e frequência discordam — aguardar convergência.`,
        alignment, targetDigits: topDigits, stakeBoost: 1.0,
      };
    }

    if (!markovReliable) {
      return {
        goTrade: false,
        reason: `NO-GO: Markov insuficiente (conf=${alignment.markovConfidence.toFixed(0)}%). Aguardar mais dados sequenciais.`,
        alignment, targetDigits: topDigits, stakeBoost: 1.0,
      };
    }

    // Stake boost baseado na qualidade do sinal
    const stakeBoost = alignment.entryQuality === 'strong' ? 1.2
      : alignment.entryQuality === 'moderate' ? 1.0
      : 0.8;

    return {
      goTrade: true,
      reason: `GO: ${alignment.combinedInsight}`,
      alignment, targetDigits: topDigits, stakeBoost,
    };
  }

  hasData(symbol: string): boolean {
    return (this.recentDigitsCache.get(symbol)?.length ?? 0) >= 30;
  }
}

export const digitPatternEngine = new DigitPatternEngine();
