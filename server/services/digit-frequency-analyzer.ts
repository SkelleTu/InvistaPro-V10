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

  getSymbolCount(): number { return this.states.size; }

  hasData(symbol: string): boolean {
    const s = this.states.get(symbol);
    return !!(s && s.recentDigits.length >= this.MIN_TICKS_FOR_CONFIDENCE);
  }
}

export const digitFrequencyAnalyzer = new DigitFrequencyAnalyzer();
