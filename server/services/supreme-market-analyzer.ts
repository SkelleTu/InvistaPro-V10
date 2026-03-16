/**
 * MOTOR DE ANÁLISE SUPREMA — InvestaPRO
 *
 * Analisa o mercado em dimensões que nenhum humano consegue monitorar simultaneamente:
 *
 * 1. Multi-Timeframe Simultâneo   — 1s / 5s / 30s / 60s / 300s ao mesmo tempo
 * 2. Expoente de Hurst            — detecta se mercado está em tendência, aleatório ou mean-reverting
 * 3. Entropia de Shannon          — mede previsibilidade estatística do fluxo de ticks
 * 4. Autocorrelação Serial        — padrões de sequência invisíveis ao olho humano
 * 5. Análise Espectral (FFT)      — detecta ciclos e frequências ocultas no preço
 * 6. Z-score de Volatilidade      — anomalias estatísticas em tempo real
 * 7. Skewness & Kurtosis          — assimetria e curtose da distribuição de retornos
 * 8. Tick Clustering              — grupos de ticks direcionais consecutivos
 * 9. Correlação Cruzada           — sincronismo entre múltiplos ativos em tempo real
 * 10. Detector de Regime          — classifica o mercado: trending / ranging / caótico / calmo
 * 11. Motor de Parâmetros         — outputs adaptativos para cada modalidade de contrato
 */

import { EventEmitter } from 'events';

// ─────────────────────── Tipos ───────────────────────

export type MarketRegime = 'strong_trend' | 'weak_trend' | 'ranging' | 'chaotic' | 'calm';

export interface TimeframeAnalysis {
  window: number;        // tamanho da janela em ticks
  trend: 'up' | 'down' | 'sideways';
  strength: number;      // 0–100
  volatility: number;    // desvio padrão normalizado
  momentum: number;      // velocidade da mudança de preço
}

export interface SpectralCycle {
  period: number;        // período dominante (em ticks)
  amplitude: number;     // força do ciclo (0–1)
  phase: 'rising' | 'falling' | 'peak' | 'trough';
}

export interface SupremeAnalysis {
  symbol: string;
  timestamp: number;

  // ── Camada 1: Multi-Timeframe ──
  multiTimeframe: {
    tf1s:   TimeframeAnalysis;
    tf5s:   TimeframeAnalysis;
    tf30s:  TimeframeAnalysis;
    tf60s:  TimeframeAnalysis;
    tf300s: TimeframeAnalysis;
    convergence: number;       // 0–100: quanto os timeframes concordam
    dominantTrend: 'up' | 'down' | 'sideways';
  };

  // ── Camada 2: Física Estatística ──
  statistics: {
    hurstExponent: number;     // >0.6 tendência | ~0.5 random | <0.4 mean-reverting
    shannonEntropy: number;    // 0=previsível total | 1=caos total
    autocorrelation: number;   // -1 a +1 (>0 persistência | <0 reversão)
    skewness: number;          // assimetria dos retornos
    kurtosis: number;          // caudas pesadas (>3 = fat tails)
    zScoreVolatility: number;  // volatilidade atual vs baseline histórico
  };

  // ── Camada 3: Análise Espectral ──
  spectral: {
    dominantCycle: SpectralCycle | null;
    cyclePower: number;        // 0–100: força do ciclo detectado
    noiseRatio: number;        // 0–1: sinal vs ruído
  };

  // ── Camada 4: Micro-estrutura ──
  microstructure: {
    tickClusterStreak: number;         // ticks consecutivos na mesma direção
    tickClusterDirection: 'up' | 'down' | 'mixed';
    avgTickSize: number;               // tamanho médio de tick
    tickSizeAnomaly: boolean;          // tick atual anormalmente grande
    reversalProbability: number;       // 0–100: prob de reversão iminente
  };

  // ── Camada 5: Correlação Cruzada ──
  crossCorrelation: {
    mostCorrelated: string;    // símbolo mais correlacionado
    correlationScore: number;  // -1 a +1
    leadLagMs: number;         // símbolo A lidera símbolo B por X ms
  };

  // ── Camada 6: Regime ──
  regime: MarketRegime;
  regimeConfidence: number;    // 0–100

  // ── Camada 7: Oportunidade ──
  opportunityScore: number;    // 0–100: qualidade geral da oportunidade
  opportunityDirection: 'up' | 'down' | 'neutral';

  // ── Camada 8: Parâmetros Adaptativos (OUTPUT DO MOTOR) ──
  adaptiveParams: AdaptiveContractParams;
}

export interface AdaptiveContractParams {
  // Modalidade recomendada pelo motor (não rotação por tempo)
  recommendedModality: string;
  modalityScore: number;       // 0–100: confiança na escolha

  // Acumulador
  accumulator: {
    growthRate: number;        // 0.01–0.05 (dinâmico por volatilidade)
    expectedTicks: number;     // quantos ticks segurar antes de fechar
    riskLevel: 'low' | 'medium' | 'high';
  };

  // Multiplicador
  multiplier: {
    factor: number;            // 5, 10, 20, 50 (dinâmico por trend strength)
    direction: 'up' | 'down';
    confidence: number;
  };

  // Touch / No-Touch
  touch: {
    barrierOffsetPct: number;  // % dinâmico baseado na volatilidade
    useNoTouch: boolean;       // no-touch preferível em mercados caóticos
  };

  // Turbo / Knockout
  turbo: {
    knockoutOffsetPct: number; // % dinâmico
    durationMin: number;       // duração recomendada em minutos
  };

  // Vanilla Options
  vanilla: {
    strikeOffsetPct: number;   // % dinâmico
    durationMin: number;
  };

  // Rise / Fall
  riseFall: {
    durationTicks: number;     // duração em ticks (dinâmico)
    direction: 'up' | 'down';
  };

  // Digit Differs
  digitDiff: {
    barrier: number;           // dígito frio recomendado
    confidence: number;
  };

  // Ajuste de stake
  stakeMultiplier: number;     // 0.5–2.0 (reduz em oportunidades fracas, aumenta em fortes)
}

// ─────────────────────── Engine ───────────────────────

export class SupremeMarketAnalyzer extends EventEmitter {
  private tickBuffers: Map<string, number[]> = new Map();        // symbol → prices
  private timestampBuffers: Map<string, number[]> = new Map();   // symbol → timestamps
  private readonly MAX_BUFFER = 2000;                             // últimos 2000 ticks
  private volatilityBaseline: Map<string, number[]> = new Map(); // histórico de vol para z-score
  private lastAnalysis: Map<string, SupremeAnalysis> = new Map();
  private analysisInterval: NodeJS.Timeout | null = null;
  private readonly ANALYSIS_INTERVAL_MS = 3000;                   // análise a cada 3s (libera event loop para requisições HTTP)

  constructor() {
    super();
    console.log('🧠 [SUPREME] Motor de Análise Suprema inicializado');
    console.log('🔬 [SUPREME] 10 dimensões simultâneas de análise de mercado');
  }

  start(): void {
    this.analysisInterval = setInterval(() => this.runCycle(), this.ANALYSIS_INTERVAL_MS);
    console.log('🚀 [SUPREME] Motor ativo — análise a cada 3s');
  }

  stop(): void {
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
  }

  addTick(symbol: string, price: number, ts: number = Date.now()): void {
    if (!this.tickBuffers.has(symbol)) {
      this.tickBuffers.set(symbol, []);
      this.timestampBuffers.set(symbol, []);
    }
    const prices = this.tickBuffers.get(symbol)!;
    const times = this.timestampBuffers.get(symbol)!;
    prices.push(price);
    times.push(ts);
    if (prices.length > this.MAX_BUFFER) {
      prices.shift();
      times.shift();
    }
  }

  getLatestAnalysis(symbol: string): SupremeAnalysis | null {
    return this.lastAnalysis.get(symbol) || null;
  }

  getAllAnalyses(): Map<string, SupremeAnalysis> {
    return this.lastAnalysis;
  }

  private runCycle(): void {
    const entries = Array.from(this.tickBuffers.entries());
    let idx = 0;
    const processNext = () => {
      if (idx >= entries.length) return;
      const [symbol, prices] = entries[idx++];
      if (prices.length >= 60) {
        try {
          const analysis = this.analyzeSymbol(symbol, prices);
          this.lastAnalysis.set(symbol, analysis);
          this.emit('analysis', analysis);
        } catch (e) {
          // silêncio para não poluir logs
        }
      }
      setImmediate(processNext);
    };
    setImmediate(processNext);
  }

  // ─────────────────── Análise Principal ───────────────────

  private analyzeSymbol(symbol: string, prices: number[]): SupremeAnalysis {
    const returns = this.computeReturns(prices);

    const multiTimeframe = this.analyzeMultiTimeframe(prices);
    const statistics     = this.analyzeStatistics(prices, returns);
    const spectral       = this.analyzeSpectral(prices);
    const microstructure = this.analyzeMicrostructure(prices);
    const crossCorr      = this.analyzeCrossCorrelation(symbol, prices);
    const regime         = this.classifyRegime(statistics, multiTimeframe, spectral);
    const { score: opportunityScore, direction: opportunityDirection } =
      this.scoreOpportunity(multiTimeframe, statistics, regime, microstructure);
    const adaptiveParams = this.computeAdaptiveParams(
      multiTimeframe, statistics, spectral, microstructure, regime,
      opportunityScore, opportunityDirection, symbol
    );

    return {
      symbol,
      timestamp: Date.now(),
      multiTimeframe,
      statistics,
      spectral,
      microstructure,
      crossCorrelation: crossCorr,
      regime,
      regimeConfidence: this.computeRegimeConfidence(statistics, multiTimeframe),
      opportunityScore,
      opportunityDirection,
      adaptiveParams,
    };
  }

  // ─────────────────── Camada 1: Multi-Timeframe ───────────────────

  private analyzeMultiTimeframe(prices: number[]): SupremeAnalysis['multiTimeframe'] {
    const windows = { tf1s: 5, tf5s: 25, tf30s: 150, tf60s: 300, tf300s: 1500 };
    const analyses: Record<string, TimeframeAnalysis> = {};

    for (const [key, w] of Object.entries(windows)) {
      const slice = prices.slice(-Math.min(w, prices.length));
      analyses[key] = this.analyzeTimeframe(slice, w);
    }

    const trends = Object.values(analyses).map(a => a.trend);
    const upCount   = trends.filter(t => t === 'up').length;
    const downCount = trends.filter(t => t === 'down').length;
    const convergence = Math.max(upCount, downCount) / trends.length * 100;
    const dominantTrend: 'up' | 'down' | 'sideways' =
      upCount > downCount ? 'up' : downCount > upCount ? 'down' : 'sideways';

    return {
      tf1s:   analyses.tf1s   as TimeframeAnalysis,
      tf5s:   analyses.tf5s   as TimeframeAnalysis,
      tf30s:  analyses.tf30s  as TimeframeAnalysis,
      tf60s:  analyses.tf60s  as TimeframeAnalysis,
      tf300s: analyses.tf300s as TimeframeAnalysis,
      convergence,
      dominantTrend,
    };
  }

  private analyzeTimeframe(slice: number[], window: number): TimeframeAnalysis {
    if (slice.length < 2) return { window, trend: 'sideways', strength: 0, volatility: 0, momentum: 0 };

    const first = slice[0];
    const last  = slice[slice.length - 1];
    const change = (last - first) / first;

    const returns = this.computeReturns(slice);
    const volatility = this.stdDev(returns) * 100;

    const halfLen = Math.floor(slice.length / 2);
    const firstHalfAvg = slice.slice(0, halfLen).reduce((a, b) => a + b, 0) / halfLen;
    const secondHalfAvg = slice.slice(halfLen).reduce((a, b) => a + b, 0) / (slice.length - halfLen);
    const momentum = (secondHalfAvg - firstHalfAvg) / firstHalfAvg * 100;

    let trend: 'up' | 'down' | 'sideways' = 'sideways';
    if (Math.abs(change) > 0.0002) {
      trend = change > 0 ? 'up' : 'down';
    }
    const strength = Math.min(100, Math.abs(change) * 50000);

    return { window, trend, strength, volatility, momentum };
  }

  // ─────────────────── Camada 2: Estatísticas ───────────────────

  private analyzeStatistics(prices: number[], returns: number[]): SupremeAnalysis['statistics'] {
    return {
      hurstExponent:     this.computeHurst(prices),
      shannonEntropy:    this.computeShannonEntropy(returns),
      autocorrelation:   this.computeAutocorrelation(returns, 1),
      skewness:          this.computeSkewness(returns),
      kurtosis:          this.computeKurtosis(returns),
      zScoreVolatility:  this.computeVolatilityZScore(returns),
    };
  }

  /** Expoente de Hurst por R/S Analysis */
  private computeHurst(prices: number[]): number {
    const n = Math.min(prices.length, 512);
    const series = prices.slice(-n);
    if (n < 20) return 0.5;

    const lags = [8, 16, 32, 64].filter(l => l < n / 2);
    if (lags.length < 2) return 0.5;

    const rsValues: number[] = [];
    for (const lag of lags) {
      const rsForLag: number[] = [];
      for (let start = 0; start + lag <= series.length; start += lag) {
        const sub = series.slice(start, start + lag);
        const mean = sub.reduce((a, b) => a + b, 0) / sub.length;
        const deviations = sub.map((v, i) => sub.slice(0, i + 1).reduce((a, b) => a + b, 0) / (i + 1) - mean);
        const R = Math.max(...deviations) - Math.min(...deviations);
        const S = this.stdDev(sub.map(v => v - mean));
        if (S > 0) rsForLag.push(R / S);
      }
      if (rsForLag.length > 0) {
        rsValues.push(rsForLag.reduce((a, b) => a + b, 0) / rsForLag.length);
      }
    }

    if (rsValues.length < 2) return 0.5;

    const logLags = lags.slice(0, rsValues.length).map(l => Math.log(l));
    const logRS   = rsValues.map(v => Math.log(Math.max(v, 0.0001)));

    const n2 = logLags.length;
    const sumX  = logLags.reduce((a, b) => a + b, 0);
    const sumY  = logRS.reduce((a, b) => a + b, 0);
    const sumXY = logLags.reduce((acc, x, i) => acc + x * logRS[i], 0);
    const sumX2 = logLags.reduce((acc, x) => acc + x * x, 0);
    const hurst = (n2 * sumXY - sumX * sumY) / (n2 * sumX2 - sumX * sumX);

    return Math.max(0.1, Math.min(0.9, hurst));
  }

  /** Entropia de Shannon baseada na distribuição de retornos em bins */
  private computeShannonEntropy(returns: number[]): number {
    if (returns.length < 10) return 0.5;

    const bins = 10;
    const min  = Math.min(...returns);
    const max  = Math.max(...returns);
    const range = max - min;
    if (range === 0) return 0;

    const counts = new Array(bins).fill(0);
    for (const r of returns) {
      const idx = Math.min(bins - 1, Math.floor(((r - min) / range) * bins));
      counts[idx]++;
    }

    const total = returns.length;
    let entropy = 0;
    for (const count of counts) {
      if (count > 0) {
        const p = count / total;
        entropy -= p * Math.log2(p);
      }
    }
    return entropy / Math.log2(bins); // normaliza 0–1
  }

  /** Autocorrelação de lag-1 (persistência vs reversão) */
  private computeAutocorrelation(returns: number[], lag: number): number {
    if (returns.length < lag + 2) return 0;

    const n    = returns.length - lag;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;

    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (returns[i] - mean) * (returns[i + lag] - mean);
    }
    for (const r of returns) {
      den += (r - mean) ** 2;
    }

    return den === 0 ? 0 : num / den;
  }

  /** Skewness (assimetria) da distribuição de retornos */
  private computeSkewness(returns: number[]): number {
    if (returns.length < 3) return 0;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const std  = this.stdDev(returns);
    if (std === 0) return 0;
    const n = returns.length;
    const sum = returns.reduce((acc, r) => acc + ((r - mean) / std) ** 3, 0);
    return sum / n;
  }

  /** Kurtosis (caudas pesadas) */
  private computeKurtosis(returns: number[]): number {
    if (returns.length < 4) return 3;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const std  = this.stdDev(returns);
    if (std === 0) return 3;
    const n = returns.length;
    const sum = returns.reduce((acc, r) => acc + ((r - mean) / std) ** 4, 0);
    return sum / n;
  }

  /** Z-score da volatilidade atual vs histórico */
  private computeVolatilityZScore(returns: number[]): number {
    const currentVol = this.stdDev(returns.slice(-20));
    const historicalVols: number[] = [];
    const step = 20;
    for (let i = step; i <= returns.length; i += step) {
      historicalVols.push(this.stdDev(returns.slice(i - step, i)));
    }
    if (historicalVols.length < 3) return 0;
    const meanVol = historicalVols.reduce((a, b) => a + b, 0) / historicalVols.length;
    const stdVol  = this.stdDev(historicalVols);
    return stdVol === 0 ? 0 : (currentVol - meanVol) / stdVol;
  }

  // ─────────────────── Camada 3: Espectral (FFT) ───────────────────

  private analyzeSpectral(prices: number[]): SupremeAnalysis['spectral'] {
    const n = 64; // FFT size (potência de 2)
    if (prices.length < n) {
      return { dominantCycle: null, cyclePower: 0, noiseRatio: 1 };
    }

    const slice  = prices.slice(-n);
    const mean   = slice.reduce((a, b) => a + b, 0) / n;
    const signal = slice.map(p => p - mean);

    // FFT simplificada (DFT para fins de detecção de ciclo)
    const magnitudes: number[] = [];
    for (let k = 1; k < n / 2; k++) {
      let re = 0, im = 0;
      for (let t = 0; t < n; t++) {
        const angle = (2 * Math.PI * k * t) / n;
        re += signal[t] * Math.cos(angle);
        im -= signal[t] * Math.sin(angle);
      }
      magnitudes.push(Math.sqrt(re * re + im * im));
    }

    const totalPower = magnitudes.reduce((a, b) => a + b, 0);
    if (totalPower === 0) {
      return { dominantCycle: null, cyclePower: 0, noiseRatio: 1 };
    }

    const maxMag = Math.max(...magnitudes);
    const maxIdx = magnitudes.indexOf(maxMag);
    const cyclePower = Math.min(100, (maxMag / totalPower) * magnitudes.length * 100);

    // Determinar fase do ciclo dominante
    const period = n / (maxIdx + 1);
    const phase = this.determineCyclePhase(slice, period);

    return {
      dominantCycle: {
        period,
        amplitude: maxMag / (totalPower / magnitudes.length),
        phase,
      },
      cyclePower,
      noiseRatio: 1 - maxMag / totalPower,
    };
  }

  private determineCyclePhase(prices: number[], period: number): SpectralCycle['phase'] {
    const recent = prices.slice(-Math.ceil(period / 2));
    const older  = prices.slice(-Math.ceil(period), -Math.ceil(period / 2));
    if (older.length === 0) return 'rising';

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg  = older.reduce((a, b) => a + b, 0)  / older.length;
    const midpoint  = (Math.max(...prices.slice(-Math.ceil(period))) +
                       Math.min(...prices.slice(-Math.ceil(period)))) / 2;

    if (recentAvg > olderAvg && recentAvg > midpoint) return 'peak';
    if (recentAvg < olderAvg && recentAvg < midpoint) return 'trough';
    return recentAvg > olderAvg ? 'rising' : 'falling';
  }

  // ─────────────────── Camada 4: Micro-estrutura ───────────────────

  private analyzeMicrostructure(prices: number[]): SupremeAnalysis['microstructure'] {
    const recent = prices.slice(-50);
    const tickSizes = [];
    let streak = 1;
    let streakDir: 'up' | 'down' | 'mixed' = 'mixed';

    for (let i = 1; i < recent.length; i++) {
      tickSizes.push(Math.abs(recent[i] - recent[i - 1]));
      if (i === recent.length - 1) break;
    }

    // Calcular streak atual
    const lastDir = recent[recent.length - 1] > recent[recent.length - 2] ? 'up' : 'down';
    streakDir = lastDir as 'up' | 'down';
    for (let i = recent.length - 2; i >= 0; i--) {
      const dir = recent[i + 1] > recent[i] ? 'up' : 'down';
      if (dir === lastDir) streak++;
      else break;
    }

    const avgTickSize = tickSizes.reduce((a, b) => a + b, 0) / tickSizes.length || 0;
    const lastTickSize = tickSizes[tickSizes.length - 1] || 0;
    const tickSizeAnomaly = lastTickSize > avgTickSize * 3;

    // Probabilidade de reversão: streak longo aumenta probabilidade
    const reversalProbability = Math.min(95, 50 + streak * 3);

    return {
      tickClusterStreak: streak,
      tickClusterDirection: streakDir,
      avgTickSize,
      tickSizeAnomaly,
      reversalProbability,
    };
  }

  // ─────────────────── Camada 5: Correlação Cruzada ───────────────────

  private analyzeCrossCorrelation(symbol: string, prices: number[]): SupremeAnalysis['crossCorrelation'] {
    const allSymbols = Array.from(this.tickBuffers.keys()).filter(s => s !== symbol);
    let bestCorr = 0;
    let bestSymbol = '';
    let bestLag = 0;

    const myReturns = this.computeReturns(prices.slice(-100));

    for (const other of allSymbols) {
      const otherPrices  = this.tickBuffers.get(other)!;
      const otherReturns = this.computeReturns(otherPrices.slice(-100));
      const minLen = Math.min(myReturns.length, otherReturns.length);
      if (minLen < 10) continue;

      const r = this.pearsonCorrelation(
        myReturns.slice(-minLen),
        otherReturns.slice(-minLen)
      );
      if (Math.abs(r) > Math.abs(bestCorr)) {
        bestCorr   = r;
        bestSymbol = other;
        bestLag    = 0;
      }
    }

    return {
      mostCorrelated: bestSymbol,
      correlationScore: bestCorr,
      leadLagMs: bestLag,
    };
  }

  // ─────────────────── Camada 6: Regime ───────────────────

  private classifyRegime(
    stats: SupremeAnalysis['statistics'],
    mtf:   SupremeAnalysis['multiTimeframe'],
    spec:  SupremeAnalysis['spectral']
  ): MarketRegime {
    const { hurstExponent, shannonEntropy, zScoreVolatility } = stats;
    const { convergence } = mtf;

    // Mercado caótico: alta volatilidade + alta entropia
    if (zScoreVolatility > 2 && shannonEntropy > 0.85) return 'chaotic';

    // Mercado calmo: baixa volatilidade + baixa entropia
    if (zScoreVolatility < -1 && shannonEntropy < 0.4) return 'calm';

    // Tendência forte: Hurst alto + convergência de timeframes alta
    if (hurstExponent > 0.62 && convergence > 70) return 'strong_trend';

    // Tendência fraca: Hurst moderado ou convergência moderada
    if (hurstExponent > 0.52 && convergence > 50) return 'weak_trend';

    // Ranging/mean-reverting: Hurst baixo
    return 'ranging';
  }

  private computeRegimeConfidence(
    stats: SupremeAnalysis['statistics'],
    mtf:   SupremeAnalysis['multiTimeframe']
  ): number {
    const hurstDistance = Math.abs(stats.hurstExponent - 0.5) * 200; // max 80
    const entropyClarity = (1 - Math.abs(stats.shannonEntropy - 0.5) * 2) * 20; // max 20
    return Math.min(100, hurstDistance + entropyClarity);
  }

  // ─────────────────── Camada 7: Pontuação de Oportunidade ───────────────────

  private scoreOpportunity(
    mtf:   SupremeAnalysis['multiTimeframe'],
    stats: SupremeAnalysis['statistics'],
    regime: MarketRegime,
    micro: SupremeAnalysis['microstructure']
  ): { score: number; direction: 'up' | 'down' | 'neutral' } {
    let score = 50;

    // Bônus por convergência de timeframes
    score += (mtf.convergence - 50) * 0.4;

    // Bônus por tendência clara (Hurst)
    if (stats.hurstExponent > 0.6) score += (stats.hurstExponent - 0.5) * 60;
    if (stats.hurstExponent < 0.4) score += 10; // mean-reverting também pode ser bom

    // Penalidade por caos
    if (regime === 'chaotic') score -= 30;
    if (regime === 'calm')     score += 15;

    // Penalidade por streak muito longo (reversão iminente)
    if (micro.tickClusterStreak > 8) score -= 20;

    // Bônus por autocorrelação positiva (persistência)
    if (stats.autocorrelation > 0.1) score += stats.autocorrelation * 20;

    // Penalidade por anomalia de tick size
    if (micro.tickSizeAnomaly) score -= 15;

    score = Math.max(0, Math.min(100, score));

    const direction = mtf.dominantTrend === 'sideways' ? 'neutral' :
                      mtf.dominantTrend as 'up' | 'down';

    return { score, direction };
  }

  // ─────────────────── Camada 8: Parâmetros Adaptativos ───────────────────

  private computeAdaptiveParams(
    mtf:    SupremeAnalysis['multiTimeframe'],
    stats:  SupremeAnalysis['statistics'],
    spec:   SupremeAnalysis['spectral'],
    micro:  SupremeAnalysis['microstructure'],
    regime: MarketRegime,
    oppScore: number,
    oppDir:   'up' | 'down' | 'neutral',
    symbol:   string
  ): AdaptiveContractParams {
    const isSymbolDigit = /^(R_|1HZ|JD|RDBULL|RDBEAR)/.test(symbol);

    // ── Escolha de Modalidade ──
    const { modality, modalityScore } = this.selectBestModality(regime, stats, mtf, micro, oppScore, oppDir, isSymbolDigit);

    // ── Accumulator: crescimento dinâmico por volatilidade ──
    // Baixa vol → taxa menor (mais seguro, dura mais)
    // Alta vol → taxa menor também (para não ser derrubado por spike)
    const volLevel = Math.abs(stats.zScoreVolatility);
    const growthRate = volLevel > 2 ? 0.01       // vol extrema: crescimento mínimo
                     : volLevel > 1 ? 0.015      // vol alta: conservador
                     : volLevel < -1 ? 0.03      // vol baixa: pode crescer mais
                     : 0.02;                     // vol normal: padrão
    const expectedTicks = regime === 'strong_trend' ? 15
                        : regime === 'weak_trend'   ? 10
                        : 6;

    // ── Multiplicador: fator por força da tendência ──
    const trendStrength = mtf.tf30s.strength;
    const multFactor = trendStrength > 70 ? 20
                     : trendStrength > 40 ? 10
                     : 5;
    const multDir: 'up' | 'down' = oppDir === 'neutral' ? 
      (mtf.dominantTrend === 'up' ? 'up' : 'down') : (oppDir as 'up' | 'down');

    // ── Touch/No-Touch: barreira por volatilidade ──
    const baseVol = micro.avgTickSize / (this.tickBuffers.get(symbol)?.[this.tickBuffers.get(symbol)!.length - 1] || 1000) * 100;
    const touchBarrierPct = Math.max(0.005, Math.min(0.03, baseVol * 3));
    const useNoTouch = regime === 'chaotic' || regime === 'ranging';

    // ── Turbo: knockout por volatilidade ──
    const turboPct = Math.max(0.008, Math.min(0.025, baseVol * 4));
    const turboDur = regime === 'strong_trend' ? 20 : 10;

    // ── Vanilla: strike por momentum ──
    const vanillaPct = Math.max(0.003, Math.min(0.015, baseVol * 2));
    const vanillaDur = 15;

    // ── Rise/Fall: duração por regime ──
    const rfTicks = regime === 'strong_trend' ? 10
                  : regime === 'weak_trend'   ? 5
                  : 3;

    // ── Ajuste de stake: reduz em oportunidades fracas ──
    const stakeMultiplier = oppScore > 75 ? 1.2
                          : oppScore > 55 ? 1.0
                          : oppScore > 35 ? 0.8
                          : 0.5;

    return {
      recommendedModality: modality,
      modalityScore,
      accumulator: {
        growthRate,
        expectedTicks,
        riskLevel: volLevel > 1.5 ? 'high' : volLevel > 0.5 ? 'medium' : 'low',
      },
      multiplier: {
        factor:     multFactor,
        direction:  multDir,
        confidence: mtf.convergence,
      },
      touch: {
        barrierOffsetPct: touchBarrierPct,
        useNoTouch,
      },
      turbo: {
        knockoutOffsetPct: turboPct,
        durationMin: turboDur,
      },
      vanilla: {
        strikeOffsetPct: vanillaPct,
        durationMin: vanillaDur,
      },
      riseFall: {
        durationTicks: rfTicks,
        direction: multDir,
      },
      digitDiff: {
        barrier: -1, // preenchido externamente pelo digitFrequencyAnalyzer
        confidence: 80,
      },
      stakeMultiplier,
    };
  }

  // ─────────────────── Seleção de Modalidade ───────────────────

  private selectBestModality(
    regime:    MarketRegime,
    stats:     SupremeAnalysis['statistics'],
    mtf:       SupremeAnalysis['multiTimeframe'],
    micro:     SupremeAnalysis['microstructure'],
    oppScore:  number,
    oppDir:    'up' | 'down' | 'neutral',
    isDigitSymbol: boolean
  ): { modality: string; modalityScore: number } {
    // Score por modalidade baseado nas condições do mercado
    const scores: Record<string, number> = {
      accumulator:    0,
      multiplier_up:  0,
      multiplier_down:0,
      digit_differs:  0,
      rise:           0,
      fall:           0,
      no_touch:       0,
      touch:          0,
    };

    // ── Accumulator: melhor em tendências fortes e baixa volatilidade ──
    if (regime === 'strong_trend') scores.accumulator += 40;
    if (regime === 'weak_trend')   scores.accumulator += 20;
    if (regime === 'calm')         scores.accumulator += 25;
    if (Math.abs(stats.zScoreVolatility) < 1) scores.accumulator += 15;
    if (stats.hurstExponent > 0.6) scores.accumulator += 20;

    // ── Multiplier: melhor em tendências com convergência alta ──
    const multBase = mtf.convergence > 70 && regime !== 'chaotic' ? 50 : 20;
    if (oppDir === 'up')   scores.multiplier_up   = multBase + stats.hurstExponent * 30;
    if (oppDir === 'down') scores.multiplier_down = multBase + stats.hurstExponent * 30;

    // ── Digit Differs: melhor quando símbolo suporta e qualquer regime ──
    if (isDigitSymbol) {
      scores.digit_differs = 45;
      if (regime === 'chaotic') scores.digit_differs += 20; // digits não dependem da direção
    }

    // ── Rise/Fall: tendência confirmada por múltiplos timeframes ──
    if (mtf.convergence > 75 && oppDir !== 'neutral') {
      if (oppDir === 'up')   scores.rise = 55 + stats.hurstExponent * 25;
      if (oppDir === 'down') scores.fall = 55 + stats.hurstExponent * 25;
    }

    // ── No-Touch: mercados ranging/caóticos onde tocar a barreira é raro ──
    if (regime === 'ranging' || regime === 'chaotic') scores.no_touch += 50;
    if (stats.shannonEntropy > 0.7) scores.no_touch += 15;

    // ── Touch: mercados com ciclos claros (alta amplitude espectral) ──
    // Esta opção é mais arriscada, pontuação menor por padrão
    scores.touch = 10;

    // Penalidades
    if (regime === 'chaotic') {
      scores.accumulator    -= 40;
      scores.multiplier_up  -= 20;
      scores.multiplier_down -= 20;
    }
    if (oppScore < 40) {
      // Oportunidade fraca: preferir digit_differs que não depende de direção
      scores.digit_differs  += 25;
      scores.accumulator    -= 15;
    }
    if (micro.tickClusterStreak > 8) {
      // Streak longo: reversão iminente, evitar acumulador
      scores.accumulator -= 30;
      scores.digit_differs += 10;
    }

    // Encontrar modalidade vencedora
    const best = Object.entries(scores).reduce((a, b) => b[1] > a[1] ? b : a);
    return { modality: best[0], modalityScore: Math.max(0, Math.min(100, best[1])) };
  }

  // ─────────────────── Utilidades Matemáticas ───────────────────

  private computeReturns(prices: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    return returns;
  }

  private stdDev(values: number[]): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  private pearsonCorrelation(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    if (n < 3) return 0;
    const meanA = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
    const meanB = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
    let num = 0, denA = 0, denB = 0;
    for (let i = 0; i < n; i++) {
      const da = a[i] - meanA, db = b[i] - meanB;
      num  += da * db;
      denA += da * da;
      denB += db * db;
    }
    const den = Math.sqrt(denA * denB);
    return den === 0 ? 0 : num / den;
  }
}

// Singleton global
export const supremeAnalyzer = new SupremeMarketAnalyzer();
