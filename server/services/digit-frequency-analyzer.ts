/**
 * DIGIT FREQUENCY ANALYZER
 * 
 * Analisa a distribuição real de dígitos finais nos ticks da Deriv para identificar
 * desvios estatísticos exploráveis em contratos DIGIT DIFFER.
 * 
 * Princípio: Em índices sintéticos, cada dígito (0-9) deveria aparecer ~10% das vezes.
 * Quando um dígito aparece MENOS que 10% (dígito "frio"), usá-lo como barreira DIFFER
 * aumenta a vantagem estatística acima dos 90% base do contrato.
 * 
 * Exemplo: Dígito 3 aparece 6% nas últimas 300 ticks → barreira 3 → 94% de vitória esperada
 */

interface DigitStats {
  digit: number;
  count: number;
  frequency: number;      // 0.0 - 1.0
  expectedFrequency: number; // sempre 0.10
  deviation: number;      // frequency - expected (negativo = mais frio)
  edge: number;           // vantagem em % acima do baseline 90% (positivo = melhor)
}

interface DigitAnalysisResult {
  symbol: string;
  totalTicks: number;
  windowSize: number;
  digits: DigitStats[];
  coldestDigit: number;         // dígito com menor frequência = melhor barreira
  coldestDigitEdge: number;     // vantagem adicional em % (ex: 3.5 = 93.5% win rate)
  hottestDigit: number;         // dígito mais frequente (EVITAR como barreira)
  recommendedBarrier: string;   // barreira recomendada como string
  confidence: number;           // 0-100% confiança na análise (depende do nº de ticks)
  winRateExpected: number;      // taxa de vitória esperada com a barreira recomendada (%)
  lastUpdated: number;
}

interface DigitFrequencyState {
  symbol: string;
  digitCounts: number[];        // índice = dígito (0-9), valor = contagem
  recentDigits: number[];       // últimos N dígitos (buffer circular)
  totalProcessed: number;
  lastUpdate: number;
}

export class DigitFrequencyAnalyzer {
  private states: Map<string, DigitFrequencyState> = new Map();
  private readonly WINDOW_SIZES = [100, 300, 500];   // janelas de análise
  private readonly PRIMARY_WINDOW = 300;              // janela principal
  private readonly MIN_TICKS_FOR_CONFIDENCE = 50;    // mínimo para análise confiável
  private readonly MAX_BUFFER = 500;                  // máximo de ticks armazenados

  /**
   * Processa um novo tick para um símbolo
   */
  processTickDigit(symbol: string, lastDigit: number): void {
    if (lastDigit < 0 || lastDigit > 9 || !Number.isInteger(lastDigit)) {
      return;
    }

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

  /**
   * Processa um array de ticks históricos para um símbolo
   */
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

  /**
   * Extrai o último dígito de um preço
   */
  extractLastDigit(priceStr: string): number | null {
    const digitsOnly = priceStr.replace(/[^0-9]/g, '');
    if (!digitsOnly) return null;
    const last = parseInt(digitsOnly[digitsOnly.length - 1]);
    return isNaN(last) ? null : last;
  }

  /**
   * Analisa a distribuição de dígitos para um símbolo e retorna a melhor barreira
   */
  analyzeSymbol(symbol: string, windowSize: number = this.PRIMARY_WINDOW): DigitAnalysisResult | null {
    const state = this.states.get(symbol);
    if (!state || state.recentDigits.length < this.MIN_TICKS_FOR_CONFIDENCE) {
      return null;
    }

    const window = state.recentDigits.slice(-Math.min(windowSize, state.recentDigits.length));
    const totalTicks = window.length;
    
    const windowCounts = new Array(10).fill(0);
    for (const d of window) windowCounts[d]++;

    const digits: DigitStats[] = [];
    for (let d = 0; d <= 9; d++) {
      const count = windowCounts[d];
      const frequency = count / totalTicks;
      const expectedFrequency = 0.10;
      const deviation = frequency - expectedFrequency;
      // Edge: DIFFER ganha quando dígito NÃO aparece
      // Se frequência real = 7% (frio), win rate = 93% → edge = +3%
      // Se frequência real = 13% (quente), win rate = 87% → edge = -3%
      const edge = (expectedFrequency - frequency) * 100;

      digits.push({ digit: d, count, frequency, expectedFrequency, deviation, edge });
    }

    // Ordenar por edge descendente (maior edge primeiro = mais frio = melhor)
    const sorted = [...digits].sort((a, b) => b.edge - a.edge);
    const coldest = sorted[0];
    const hottest = sorted[sorted.length - 1];

    // Confiança baseada no número de ticks (mais ticks = mais confiança)
    const confidence = Math.min(100, (totalTicks / this.PRIMARY_WINDOW) * 100);

    // Win rate esperado = 90% base + edge do dígito mais frio
    const winRateExpected = 90 + coldest.edge;

    return {
      symbol,
      totalTicks,
      windowSize: window.length,
      digits,
      coldestDigit: coldest.digit,
      coldestDigitEdge: coldest.edge,
      hottestDigit: hottest.digit,
      recommendedBarrier: coldest.digit.toString(),
      confidence,
      winRateExpected: Math.min(99, Math.max(80, winRateExpected)),
      lastUpdated: state.lastUpdate
    };
  }

  /**
   * Analisa múltiplas janelas e retorna consenso ponderado
   */
  analyzeSymbolMultiWindow(symbol: string): DigitAnalysisResult | null {
    const state = this.states.get(symbol);
    if (!state || state.recentDigits.length < this.MIN_TICKS_FOR_CONFIDENCE) {
      return null;
    }

    const results: DigitAnalysisResult[] = [];
    for (const ws of this.WINDOW_SIZES) {
      if (state.recentDigits.length >= Math.min(ws, this.MIN_TICKS_FOR_CONFIDENCE)) {
        const r = this.analyzeSymbol(symbol, ws);
        if (r) results.push(r);
      }
    }

    if (results.length === 0) return null;

    // Consenso: contagem de votos para cada dígito como "mais frio"
    const votesForColdest = new Array(10).fill(0);
    const edgeSums = new Array(10).fill(0);
    let totalWeight = 0;

    results.forEach((r, i) => {
      const weight = i + 1; // janelas maiores têm peso maior
      votesForColdest[r.coldestDigit] += weight;
      r.digits.forEach(d => {
        edgeSums[d.digit] += d.edge * weight;
      });
      totalWeight += weight;
    });

    // Dígito com mais votos ponderados = mais consistentemente frio
    let bestDigit = 0;
    let bestVotes = -1;
    for (let d = 0; d <= 9; d++) {
      if (votesForColdest[d] > bestVotes) {
        bestVotes = votesForColdest[d];
        bestDigit = d;
      }
    }

    const avgEdge = edgeSums[bestDigit] / totalWeight;
    const primaryResult = results[results.length - 1]; // usa janela maior como base

    return {
      ...primaryResult,
      coldestDigit: bestDigit,
      coldestDigitEdge: avgEdge,
      recommendedBarrier: bestDigit.toString(),
      winRateExpected: Math.min(99, Math.max(80, 90 + avgEdge)),
      confidence: Math.min(100, primaryResult.confidence * (bestVotes / totalWeight + 0.5))
    };
  }

  /**
   * Retorna a melhor barreira para um símbolo (string pronta para o trade)
   * Fallback para '5' (neutro) se não há dados suficientes
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
   * Retorna o score de "vantagem estatística" de um símbolo (0-100)
   * Usado na seleção de ativos: ativos com maior edge estatístico têm prioridade
   */
  getDigitEdgeScore(symbol: string): number {
    const analysis = this.analyzeSymbolMultiWindow(symbol);
    if (!analysis) return 50; // score neutro se sem dados

    // Edge pode ser negativo (dígito frio desapareceu) ou positivo
    // Normalizar para 0-100: baseline 50, cada % de edge = +5 pontos
    const score = 50 + (analysis.coldestDigitEdge * 5);
    return Math.min(100, Math.max(0, score));
  }

  /**
   * Retorna resumo para log
   */
  getSummary(symbol: string): string {
    const analysis = this.analyzeSymbolMultiWindow(symbol);
    if (!analysis) return `${symbol}: sem dados suficientes`;

    const sorted = [...analysis.digits].sort((a, b) => b.edge - a.edge);
    const top3 = sorted.slice(0, 3).map(d => `${d.digit}(${d.frequency.toFixed(0)*100 < 1 ? (d.frequency*100).toFixed(1) : (d.frequency*100).toFixed(0)}%)`).join(', ');
    
    return `${symbol}: barreira=${analysis.recommendedBarrier} | edge=+${analysis.coldestDigitEdge.toFixed(1)}% | winRate=${analysis.winRateExpected.toFixed(1)}% | conf=${analysis.confidence.toFixed(0)}% | dígitos frios: ${top3}`;
  }

  /**
   * Retorna todos os estados ativos (para debug/dashboard)
   */
  getAllAnalyses(): DigitAnalysisResult[] {
    const results: DigitAnalysisResult[] = [];
    for (const symbol of this.states.keys()) {
      const r = this.analyzeSymbolMultiWindow(symbol);
      if (r) results.push(r);
    }
    return results.sort((a, b) => b.coldestDigitEdge - a.coldestDigitEdge);
  }

  /**
   * Retorna os N dígitos mais quentes (maior frequência) — usados no modo FRENÉTICO de Digit Matches.
   * Para DIGITMATCH queremos os dígitos que aparecem MAIS frequentemente (oposto do DIFFERS).
   */
  getHottestDigitsForMatches(symbol: string, n: number = 3): number[] {
    const analysis = this.analyzeSymbolMultiWindow(symbol);
    if (!analysis) {
      // Sem dados: retorna dígitos aleatórios como fallback
      const all = [0,1,2,3,4,5,6,7,8,9];
      const shuffled = all.sort(() => Math.random() - 0.5);
      return shuffled.slice(0, n);
    }
    // Ordenar dígitos por frequência decrescente (mais quente = mais provável para MATCHES)
    const sorted = [...analysis.digits].sort((a, b) => b.frequency - a.frequency);
    return sorted.slice(0, n).map(d => d.digit);
  }

  getSymbolCount(): number {
    return this.states.size;
  }

  hasData(symbol: string): boolean {
    const s = this.states.get(symbol);
    return !!(s && s.recentDigits.length >= this.MIN_TICKS_FOR_CONFIDENCE);
  }
}

export const digitFrequencyAnalyzer = new DigitFrequencyAnalyzer();
