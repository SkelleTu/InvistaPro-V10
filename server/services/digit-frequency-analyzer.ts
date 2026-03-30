/**
 * DIGIT FREQUENCY ANALYZER — VERSÃO AVANÇADA
 *
 * Replica e expande a análise de dígitos que a própria Deriv exibe em tempo real:
 * - Janelas múltiplas (25, 50, 100, 200, 500 ticks) com BIAS para dados recentes
 * - Score ponderado com MAIOR peso nas janelas curtas (mais atuais, como Deriv exibe)
 * - Detecção de tendência: dígito esquentando vs esfriando → sinaliza momentum
 * - EMA (Média Móvel Exponencial) de frequência para cada dígito
 * - Estratégias separadas para DIFFERS (dígito frio) e MATCHES (dígito quente)
 *
 * Princípio Deriv: Os índices sintéticos usam RNG auditado. Em janelas curtas há
 * desvios estatísticos exploráveis — a Deriv mostra isso visualmente com barras coloridas.
 */

interface DigitStats {
  digit: number;
  count: number;
  frequency: number;         // 0.0 - 1.0
  expectedFrequency: number; // sempre 0.10
  deviation: number;         // frequency - expected
  edge: number;              // vantagem DIFFERS em % (positivo = mais frio = melhor para DIFF)
  matchScore: number;        // vantagem MATCHES em % (positivo = mais quente = melhor para MATCH)
  trendDiff: number;         // tendência: freq_25 - freq_200 (positivo = esquentando, negativo = esfriando)
  combinedDiffScore: number; // score composto para DIFFERS (edge + bonus tendência esfriando)
  combinedMatchScore: number;// score composto para MATCHES (matchScore + bonus tendência esquentando)
}

interface DigitAnalysisResult {
  symbol: string;
  totalTicks: number;
  windowSize: number;
  digits: DigitStats[];
  coldestDigit: number;          // DIFFERS: dígito com menor frequência = melhor barreira
  coldestDigitEdge: number;      // vantagem adicional em %
  hottestDigit: number;          // MATCHES: dígito mais frequente = melhor barreira
  hottestDigitScore: number;     // score do dígito mais quente
  recommendedBarrier: string;    // barreira DIFFERS recomendada
  recommendedMatchBarrier: string; // barreira MATCHES recomendada
  confidence: number;            // 0-100%
  winRateExpected: number;       // taxa de vitória esperada DIFFERS (%)
  winRateExpectedMatch: number;  // taxa de vitória esperada MATCHES (%)
  lastUpdated: number;
}

interface DigitFrequencyState {
  symbol: string;
  digitCounts: number[];   // índice = dígito (0-9), valor = contagem no buffer total
  recentDigits: number[];  // últimos N dígitos (buffer circular)
  totalProcessed: number;
  lastUpdate: number;
}

export class DigitFrequencyAnalyzer {
  private states: Map<string, DigitFrequencyState> = new Map();

  // Janelas de análise — igual ao Deriv (destaque para janela curta de 25 ticks)
  private readonly WINDOW_SIZES = [25, 50, 100, 200, 500];
  // Pesos INVERTIDOS: janela menor = PESO MAIOR (dados recentes valem mais)
  private readonly WINDOW_WEIGHTS = [8, 5, 3, 2, 1]; // soma = 19
  private readonly PRIMARY_WINDOW = 200;
  private readonly MIN_TICKS_FOR_CONFIDENCE = 25;   // 25 = primeira janela Deriv
  private readonly MAX_BUFFER = 500;

  processTickDigit(symbol: string, lastDigit: number): void {
    if (lastDigit < 0 || lastDigit > 9 || !Number.isInteger(lastDigit)) return;

    let state = this.states.get(symbol);
    if (!state) {
      state = {
        symbol,
        digitCounts: new Array(10).fill(0),
        recentDigits: [],
        totalProcessed: 0,
        lastUpdate: Date.now()
      };
      this.states.set(symbol, state);
    }

    state.recentDigits.push(lastDigit);
    if (state.recentDigits.length > this.MAX_BUFFER) {
      const removed = state.recentDigits.shift()!;
      state.digitCounts[removed] = Math.max(0, state.digitCounts[removed] - 1);
    }
    state.digitCounts[lastDigit]++;
    state.totalProcessed++;
    state.lastUpdate = Date.now();
  }

  processHistoricalDigits(symbol: string, digits: number[]): void {
    const recentDigits = digits.slice(-this.MAX_BUFFER);
    const counts = new Array(10).fill(0);
    for (const d of recentDigits) {
      if (d >= 0 && d <= 9) counts[d]++;
    }
    const existing = this.states.get(symbol);
    this.states.set(symbol, {
      symbol,
      digitCounts: counts,
      recentDigits: [...recentDigits],
      totalProcessed: (existing?.totalProcessed || 0) + digits.length,
      lastUpdate: Date.now()
    });
  }

  extractLastDigit(priceStr: string): number | null {
    const digitsOnly = priceStr.replace(/[^0-9]/g, '');
    if (!digitsOnly) return null;
    const last = parseInt(digitsOnly[digitsOnly.length - 1]);
    return isNaN(last) ? null : last;
  }

  /**
   * Calcula frequências para uma janela de ticks
   */
  private calcWindowFreqs(recentDigits: number[], windowSize: number): number[] {
    const window = recentDigits.slice(-Math.min(windowSize, recentDigits.length));
    const total = window.length;
    if (total === 0) return new Array(10).fill(0.1);
    const counts = new Array(10).fill(0);
    for (const d of window) counts[d]++;
    return counts.map(c => c / total);
  }

  /**
   * Análise de uma única janela
   */
  analyzeSymbol(symbol: string, windowSize: number = this.PRIMARY_WINDOW): DigitAnalysisResult | null {
    const state = this.states.get(symbol);
    if (!state || state.recentDigits.length < this.MIN_TICKS_FOR_CONFIDENCE) return null;

    const freqs = this.calcWindowFreqs(state.recentDigits, windowSize);
    const freqs25 = this.calcWindowFreqs(state.recentDigits, 25);
    const freqs200 = this.calcWindowFreqs(state.recentDigits, 200);
    const totalTicks = Math.min(windowSize, state.recentDigits.length);

    const digits: DigitStats[] = [];
    for (let d = 0; d <= 9; d++) {
      const frequency = freqs[d];
      const expectedFrequency = 0.10;
      const deviation = frequency - expectedFrequency;
      const edge = (expectedFrequency - frequency) * 100;         // DIFFERS: positivo = frio = bom
      const matchScore = (frequency - expectedFrequency) * 100;  // MATCHES: positivo = quente = bom
      const trendDiff = (freqs25[d] - freqs200[d]) * 100;        // positivo = esquentando

      // Score composto DIFFERS: recompensa dígito frio + tendência de esfriar ainda mais
      const trendBonusDiff = trendDiff < 0 ? Math.abs(trendDiff) * 0.4 : 0;
      const combinedDiffScore = edge + trendBonusDiff;

      // Score composto MATCHES: recompensa dígito quente + tendência de esquentar ainda mais
      const trendBonusMatch = trendDiff > 0 ? trendDiff * 0.4 : 0;
      const combinedMatchScore = matchScore + trendBonusMatch;

      digits.push({
        digit: d, count: Math.round(frequency * totalTicks),
        frequency, expectedFrequency, deviation, edge, matchScore,
        trendDiff, combinedDiffScore, combinedMatchScore
      });
    }

    const sortedByDiff = [...digits].sort((a, b) => b.combinedDiffScore - a.combinedDiffScore);
    const sortedByMatch = [...digits].sort((a, b) => b.combinedMatchScore - a.combinedMatchScore);
    const coldest = sortedByDiff[0];
    const hottest = sortedByMatch[0];

    const confidence = Math.min(100, (totalTicks / this.PRIMARY_WINDOW) * 100);
    const winRateExpected = Math.min(99, Math.max(80, 90 + coldest.edge));
    const winRateExpectedMatch = Math.min(30, Math.max(5, 10 + hottest.matchScore));

    return {
      symbol, totalTicks, windowSize: totalTicks, digits,
      coldestDigit: coldest.digit,
      coldestDigitEdge: coldest.edge,
      hottestDigit: hottest.digit,
      hottestDigitScore: hottest.combinedMatchScore,
      recommendedBarrier: coldest.digit.toString(),
      recommendedMatchBarrier: hottest.digit.toString(),
      confidence,
      winRateExpected,
      winRateExpectedMatch,
      lastUpdated: state.lastUpdate
    };
  }

  /**
   * Análise multi-janela com BIAS para dados recentes (como Deriv exibe)
   * Janela menor = PESO MAIOR (25 ticks = 8x, 500 ticks = 1x)
   */
  analyzeSymbolMultiWindow(symbol: string): DigitAnalysisResult | null {
    const state = this.states.get(symbol);
    if (!state || state.recentDigits.length < this.MIN_TICKS_FOR_CONFIDENCE) return null;

    // Calcular frequências por janela
    const windowFreqs: number[][] = this.WINDOW_SIZES.map(ws =>
      this.calcWindowFreqs(state.recentDigits, ws)
    );

    // Frequências das janelas curta (25) e longa (200) para cálculo de tendência
    const freqs25  = windowFreqs[0]; // 25 ticks
    const freqs200 = windowFreqs[3]; // 200 ticks

    // Score ponderado por janela para cada dígito
    const totalWeight = this.WINDOW_WEIGHTS.reduce((a, b) => a + b, 0);
    const weightedFreqs = new Array(10).fill(0);
    for (let i = 0; i < this.WINDOW_SIZES.length; i++) {
      const ws = this.WINDOW_SIZES[i];
      if (state.recentDigits.length >= Math.max(ws * 0.5, this.MIN_TICKS_FOR_CONFIDENCE)) {
        const w = this.WINDOW_WEIGHTS[i];
        for (let d = 0; d <= 9; d++) {
          weightedFreqs[d] += windowFreqs[i][d] * w;
        }
      }
    }
    for (let d = 0; d <= 9; d++) weightedFreqs[d] /= totalWeight;

    const digits: DigitStats[] = [];
    for (let d = 0; d <= 9; d++) {
      const frequency = weightedFreqs[d];
      const expectedFrequency = 0.10;
      const deviation = frequency - expectedFrequency;
      const edge = (expectedFrequency - frequency) * 100;
      const matchScore = (frequency - expectedFrequency) * 100;
      const trendDiff = (freqs25[d] - freqs200[d]) * 100; // positivo = esquentando

      // Score composto DIFFERS: frio + tendência de esfriar
      const trendBonusDiff = trendDiff < 0 ? Math.abs(trendDiff) * 0.4 : -Math.abs(trendDiff) * 0.1;
      const combinedDiffScore = edge + trendBonusDiff;

      // Score composto MATCHES: quente + tendência de esquentar
      const trendBonusMatch = trendDiff > 0 ? trendDiff * 0.4 : -Math.abs(trendDiff) * 0.1;
      const combinedMatchScore = matchScore + trendBonusMatch;

      digits.push({
        digit: d, count: Math.round(frequency * Math.min(state.recentDigits.length, this.PRIMARY_WINDOW)),
        frequency, expectedFrequency, deviation, edge, matchScore,
        trendDiff, combinedDiffScore, combinedMatchScore
      });
    }

    const sortedByDiff  = [...digits].sort((a, b) => b.combinedDiffScore  - a.combinedDiffScore);
    const sortedByMatch = [...digits].sort((a, b) => b.combinedMatchScore - a.combinedMatchScore);
    const coldest = sortedByDiff[0];
    const hottest = sortedByMatch[0];

    // Confiança: cresce com ticks até 200 (janela principal Deriv)
    const ticks = Math.min(state.recentDigits.length, 500);
    const confidence = Math.min(100, (ticks / this.PRIMARY_WINDOW) * 100);

    const winRateExpected = Math.min(99, Math.max(80, 90 + coldest.edge));
    const winRateExpectedMatch = Math.min(30, Math.max(5, 10 + hottest.matchScore));

    return {
      symbol,
      totalTicks: state.recentDigits.length,
      windowSize: this.PRIMARY_WINDOW,
      digits,
      coldestDigit: coldest.digit,
      coldestDigitEdge: coldest.combinedDiffScore,
      hottestDigit: hottest.digit,
      hottestDigitScore: hottest.combinedMatchScore,
      recommendedBarrier: coldest.digit.toString(),
      recommendedMatchBarrier: hottest.digit.toString(),
      confidence,
      winRateExpected,
      winRateExpectedMatch,
      lastUpdated: state.lastUpdate
    };
  }

  /**
   * Retorna a melhor barreira para DIGIT DIFFERS
   * Usa dígito mais frio com confirmação multi-janela e tendência
   */
  getBestBarrier(symbol: string): { barrier: string; edge: number; confidence: number; winRate: number } {
    const analysis = this.analyzeSymbolMultiWindow(symbol);
    if (!analysis || analysis.confidence < 30) {
      return { barrier: '5', edge: 0, confidence: 0, winRate: 90 };
    }
    return {
      barrier: analysis.recommendedBarrier,
      edge: analysis.coldestDigitEdge,
      confidence: analysis.confidence,
      winRate: analysis.winRateExpected
    };
  }

  /**
   * Retorna a melhor barreira para DIGIT MATCHES
   * Usa dígito mais quente com confirmação multi-janela e tendência de aquecimento
   */
  getBestBarrierForMatches(symbol: string): { barrier: string; score: number; confidence: number; trendDiff: number } {
    const analysis = this.analyzeSymbolMultiWindow(symbol);
    if (!analysis) {
      const fallback = Math.floor(Math.random() * 10);
      return { barrier: fallback.toString(), score: 0, confidence: 0, trendDiff: 0 };
    }
    const hottest = analysis.digits
      .slice()
      .sort((a, b) => b.combinedMatchScore - a.combinedMatchScore)[0];
    return {
      barrier: hottest.digit.toString(),
      score: hottest.combinedMatchScore,
      confidence: analysis.confidence,
      trendDiff: hottest.trendDiff
    };
  }

  /**
   * Retorna os N dígitos mais quentes para MODO FRENÉTICO
   * Ordenados por score composto (frequência + tendência de aquecimento)
   */
  getHottestDigitsForMatches(symbol: string, n: number = 3): number[] {
    const analysis = this.analyzeSymbolMultiWindow(symbol);
    if (!analysis) {
      const all = [0,1,2,3,4,5,6,7,8,9];
      return all.sort(() => Math.random() - 0.5).slice(0, n);
    }
    const sorted = [...analysis.digits].sort((a, b) => b.combinedMatchScore - a.combinedMatchScore);
    return sorted.slice(0, n).map(d => d.digit);
  }

  /**
   * Score de vantagem para seleção de ativos
   */
  getDigitEdgeScore(symbol: string): number {
    const analysis = this.analyzeSymbolMultiWindow(symbol);
    if (!analysis) return 50;
    const score = 50 + (analysis.coldestDigitEdge * 5);
    return Math.min(100, Math.max(0, score));
  }

  /**
   * Resumo completo (DIFFERS + MATCHES + tendências)
   */
  getSummary(symbol: string): string {
    const analysis = this.analyzeSymbolMultiWindow(symbol);
    if (!analysis) return `${symbol}: sem dados suficientes`;

    const sortedDiff  = [...analysis.digits].sort((a, b) => b.combinedDiffScore  - a.combinedDiffScore);
    const sortedMatch = [...analysis.digits].sort((a, b) => b.combinedMatchScore - a.combinedMatchScore);

    const top3Diff  = sortedDiff.slice(0, 3).map(d =>
      `${d.digit}(${(d.frequency*100).toFixed(0)}%${d.trendDiff < -1 ? '↓' : d.trendDiff > 1 ? '↑' : '→'})`
    ).join(', ');
    const top3Match = sortedMatch.slice(0, 3).map(d =>
      `${d.digit}(${(d.frequency*100).toFixed(0)}%${d.trendDiff > 1 ? '↑' : d.trendDiff < -1 ? '↓' : '→'})`
    ).join(', ');

    return `${symbol}: DIFF→${analysis.recommendedBarrier}(edge+${analysis.coldestDigitEdge.toFixed(1)}%) ` +
           `MATCH→${analysis.recommendedMatchBarrier} | ` +
           `ticks=${analysis.totalTicks} conf=${analysis.confidence.toFixed(0)}% | ` +
           `frios: ${top3Diff} | quentes: ${top3Match}`;
  }

  getAllAnalyses(): DigitAnalysisResult[] {
    const results: DigitAnalysisResult[] = [];
    for (const symbol of this.states.keys()) {
      const r = this.analyzeSymbolMultiWindow(symbol);
      if (r) results.push(r);
    }
    return results.sort((a, b) => b.coldestDigitEdge - a.coldestDigitEdge);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // GATE DE VALOR ESPERADO (EV) — Matemática exata para DIGITMATCH
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Verifica se a distribuição atual cria EV positivo para burst DIGITMATCH.
   *
   * MATEMÁTICA EXATA:
   *
   * A) BURST KELLY×10 (cobre todos os 10 dígitos, stakes ∝ frequência):
   *    EV = P × Σ(f_d²) − 1
   *    Condição EV > 0: Σ(f_d²) > 1/P  (ex: > 0.1176 para P=8.5)
   *    Σ(f_d²) uniforme = 0.10 → sempre negativo. Precisa de skew real.
   *
   * B) BURST PARCIAL (N dígitos top, stake uniforme):
   *    EV por rodada = [Σ_{top-N}(f_d) × P − N] × stake
   *    Condição EV > 0: média_freq_topN > 1/P
   *    Ex: top-3 com média 14% cada → 0.14×3=0.42 vs 3/8.5=0.353 → EV+
   *
   * C) DIGITMATCH ÚNICO (1 dígito, stake base):
   *    EV = f_hottest × P − 1
   *    Condição: f_hottest > 1/P = 11.76%
   *
   * @param symbol   - Símbolo a analisar
   * @param payout   - Multiplicador de payout do DIGITMATCH (ex: 8.5)
   * @param nDigits  - Quantos dígitos serão cobertos (default 10 = Kelly completo)
   */
  computeEVGate(symbol: string, payout: number = 8.5, nDigits: number = 10): {
    evScore: number;        // EV esperado relativo (>1.0 = positivo, 1.0 = break-even)
    freqSumSq: number;      // Σ(f_d²) — indicador de dispersão/skew
    evThreshold: number;    // 1/P — limiar mínimo para EV positivo
    isPositiveEV: boolean;  // true quando EV esperado é positivo
    topNAvgFreq: number;    // frequência média dos top-N dígitos selecionados
    topNSumFreq: number;    // soma das frequências dos top-N
    entryAllowed: boolean;  // RECOMENDAÇÃO FINAL: entrar ou aguardar
    kellySumSq: number;     // Σ(f_d²) corrigido pelas janelas recentes
    hotDigitCount: number;  // quantos dígitos têm f_d > 1/P (potencialmente positivos)
    reason: string;         // explicação legível para logs
  } {
    const evThreshold = 1 / payout; // 0.1176 para payout 8.5x
    const analysis = this.analyzeSymbolMultiWindow(symbol);

    if (!analysis || analysis.confidence < 30) {
      return {
        evScore: 1.0, freqSumSq: 0.10, evThreshold,
        isPositiveEV: false, topNAvgFreq: 0.10, topNSumFreq: nDigits * 0.10,
        entryAllowed: false, kellySumSq: 0.10, hotDigitCount: 0,
        reason: `Dados insuficientes (conf=${analysis?.confidence.toFixed(0) ?? 0}% < 30%)`,
      };
    }

    const freqs = analysis.digits.map(d => d.frequency);

    // A) Σ(f_d²) para Kelly×10
    const freqSumSq = freqs.reduce((s, f) => s + f * f, 0);
    const kellyEV = payout * freqSumSq;  // deve ser > 1.0 para EV positivo

    // B) Frequências dos top-N dígitos por combinedMatchScore
    const sortedByMatch = [...analysis.digits].sort((a, b) => b.combinedMatchScore - a.combinedMatchScore);
    const topN = sortedByMatch.slice(0, nDigits);
    const topNSumFreq = topN.reduce((s, d) => s + d.frequency, 0);
    const topNAvgFreq = topNSumFreq / nDigits;
    // EV burst parcial uniforme: topNSumFreq × P > N
    const partialEV = topNSumFreq * payout; // deve ser > nDigits para EV positivo

    // C) Dígitos individualmente acima do limiar
    const hotDigitCount = freqs.filter(f => f > evThreshold).length;

    // evScore principal: usa Kelly×10 se nDigits=10, parcial caso contrário
    const evScore = nDigits >= 10
      ? kellyEV           // deve ser > 1.0
      : partialEV / nDigits; // deve ser > 1.0

    const isPositiveEV = evScore > 1.0;

    // Gate adicional: exige pelo menos 1 dígito acima do limiar para burst parcial
    const hasEnoughHotDigits = nDigits < 10
      ? hotDigitCount >= Math.min(1, nDigits)
      : isPositiveEV;

    const entryAllowed = isPositiveEV && hasEnoughHotDigits && analysis.confidence >= 40;

    let reason: string;
    if (!isPositiveEV) {
      reason = nDigits >= 10
        ? `Kelly×10 EV negativo: Σ(f²)=${freqSumSq.toFixed(4)} < limiar ${evThreshold.toFixed(4)} (payout ${payout}x). Distribuição muito uniforme — aguardar skew.`
        : `Burst-${nDigits} EV negativo: avgFreq=${(topNAvgFreq*100).toFixed(1)}% < limiar ${(evThreshold*100).toFixed(1)}%. Aguardar aquecimento.`;
    } else if (!hasEnoughHotDigits) {
      reason = `EV positivo mas sem dígitos quentes suficientes (${hotDigitCount} > limiar). Sinal fraco.`;
    } else if (analysis.confidence < 40) {
      reason = `EV positivo mas confiança baixa (${analysis.confidence.toFixed(0)}% < 40%). Aguardando mais ticks.`;
    } else {
      reason = nDigits >= 10
        ? `✅ Kelly×10 EV POSITIVO: Σ(f²)=${freqSumSq.toFixed(4)} > ${evThreshold.toFixed(4)} | EV=${((evScore-1)*100).toFixed(1)}% acima break-even`
        : `✅ Burst-${nDigits} EV POSITIVO: avgFreq=${(topNAvgFreq*100).toFixed(1)}% > limiar ${(evThreshold*100).toFixed(1)}% | EV=${((evScore-1)*100).toFixed(1)}%`;
    }

    return {
      evScore, freqSumSq, evThreshold, isPositiveEV,
      topNAvgFreq, topNSumFreq, entryAllowed, kellySumSq: freqSumSq,
      hotDigitCount, reason,
    };
  }

  /**
   * Gate de entrada otimizado para DIGITMATCH ÚNICO ou burst pequeno.
   * Combina: frequência do melhor dígito + tendência de aquecimento + EV positivo.
   *
   * @param symbol  - Símbolo a analisar
   * @param payout  - Multiplicador de payout (ex: 8.5)
   * @returns Sinal de entrada com justificativa
   */
  getSingleMatchEntrySignal(symbol: string, payout: number = 8.5): {
    shouldEnter: boolean;
    digit: number;
    frequency: number;
    evPositive: boolean;
    trendUp: boolean;
    confidence: number;
    evMargin: number;     // % acima do limiar (negativo = abaixo)
    reason: string;
  } {
    const analysis = this.analyzeSymbolMultiWindow(symbol);
    const evThreshold = 1 / payout;

    if (!analysis) {
      return { shouldEnter: false, digit: 5, frequency: 0.10, evPositive: false, trendUp: false, confidence: 0, evMargin: -100, reason: 'Sem dados' };
    }

    const best = analysis.digits
      .slice()
      .sort((a, b) => b.combinedMatchScore - a.combinedMatchScore)[0];

    const evPositive = best.frequency > evThreshold;
    const trendUp = best.trendDiff > 0.5; // esquentando na janela curta
    const evMargin = ((best.frequency - evThreshold) / evThreshold) * 100;

    // Sinal FORTE: frequência bem acima do limiar + tendência positiva
    const shouldEnter = evPositive && analysis.confidence >= 40 &&
      (trendUp || best.frequency > evThreshold * 1.3); // 30% acima do limiar ou tendência up

    const reason = shouldEnter
      ? `✅ ENTRADA: dígito ${best.digit} freq=${(best.frequency*100).toFixed(1)}% (${evMargin.toFixed(1)}% acima limiar) | tendência=${trendUp ? '↑' : '→'}`
      : `⏸️ AGUARDAR: dígito ${best.digit} freq=${(best.frequency*100).toFixed(1)}% | EV margin=${evMargin.toFixed(1)}% | conf=${analysis.confidence.toFixed(0)}%`;

    return { shouldEnter, digit: best.digit, frequency: best.frequency, evPositive, trendUp, confidence: analysis.confidence, evMargin, reason };
  }

  getSymbolCount(): number { return this.states.size; }

  hasData(symbol: string): boolean {
    const s = this.states.get(symbol);
    return !!(s && s.recentDigits.length >= this.MIN_TICKS_FOR_CONFIDENCE);
  }
}

export const digitFrequencyAnalyzer = new DigitFrequencyAnalyzer();
