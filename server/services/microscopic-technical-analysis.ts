/**
 * SISTEMA DE ANÁLISE TÉCNICA MICROSCÓPICA EM MILISSEGUNDOS
 * 
 * Este sistema trabalha em cooperação com as IAs existentes,
 * fornecendo análises técnicas avançadas em intervalos ultra-rápidos
 */

import { DerivTickData } from './deriv-api';
import { EventEmitter } from 'events';

export interface CandlestickData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tickCount: number;
}

export interface TechnicalIndicators {
  rsi: number;
  macd: { macd: number; signal: number; histogram: number };
  bollinger: { upper: number; middle: number; lower: number; bandwidth: number };
  fibonacci: { levels: number[]; support: number; resistance: number };
  stochastic: { k: number; d: number };
  williams: number;
  cci: number;
  momentum: number;
  roc: number; // Rate of Change
}

export interface GraphPattern {
  type: 'doji' | 'hammer' | 'shooting_star' | 'engulfing' | 'harami' | 'flag' | 'triangle' | 'head_shoulders';
  strength: number;
  reliability: number;
  direction: 'bullish' | 'bearish' | 'neutral';
  timeframe: string;
}

export interface MicroscopicAnalysis {
  symbol: string;
  timestamp: number;
  priceAction: {
    trend: 'up' | 'down' | 'sideways';
    strength: number;
    velocity: number; // Price change per millisecond
    acceleration: number;
  };
  technicalIndicators: TechnicalIndicators;
  graphPatterns: GraphPattern[];
  volumeAnalysis: {
    volume: number;
    volumeProfile: 'increasing' | 'decreasing' | 'stable';
    volumeSpike: boolean;
    relativeTrend: number; // Volume vs average
  };
  supportResistance: {
    nearestSupport: number;
    nearestResistance: number;
    supportStrength: number;
    resistanceStrength: number;
  };
  digitAnalysis: {
    lastDigit: number;
    digitVelocity: number; // How fast digits are changing
    digitPattern: string; // Recent pattern
    digitMomentum: 'increasing' | 'decreasing' | 'oscillating';
  };
  cooperativeSignal: {
    technicalDirection: 'up' | 'down' | 'neutral';
    confidence: number;
    agreementWithAI: number; // 0-1 how much it agrees with AI
    hybridRecommendation: 'up' | 'down' | 'neutral';
  };
}

export class MicroscopicTechnicalAnalyzer extends EventEmitter {
  private tickBuffer: Map<string, DerivTickData[]> = new Map();
  private candlestickData: Map<string, CandlestickData[]> = new Map();
  private analysisInterval: NodeJS.Timeout | null = null;
  private isActive = false;
  private readonly ANALYSIS_INTERVAL_MS = 100; // Análise a cada 100ms
  private readonly BUFFER_SIZE = 1000;
  private readonly CANDLESTICK_PERIOD_MS = 1000; // Candlesticks de 1 segundo

  constructor() {
    super();
    console.log('🔬 SISTEMA DE ANÁLISE TÉCNICA MICROSCÓPICA INICIALIZADO');
    console.log('⚡ Análise em intervalos de 100ms para máxima precisão');
    console.log('📊 Indicadores técnicos avançados + Análise gráfica em tempo real');
  }

  start(): void {
    if (this.isActive) return;
    
    this.isActive = true;
    this.analysisInterval = setInterval(() => {
      this.performMicroscopicAnalysis();
    }, this.ANALYSIS_INTERVAL_MS);

    console.log('🚀 [MICROSCOPIC] Análise técnica microscópica ATIVADA - 100ms intervals');
  }

  stop(): void {
    if (!this.isActive) return;
    
    this.isActive = false;
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }

    console.log('🔴 [MICROSCOPIC] Análise técnica microscópica DESATIVADA');
  }

  addTick(symbol: string, tick: DerivTickData): void {
    if (!this.tickBuffer.has(symbol)) {
      this.tickBuffer.set(symbol, []);
    }

    const buffer = this.tickBuffer.get(symbol)!;
    buffer.push(tick);

    // Manter buffer limitado
    if (buffer.length > this.BUFFER_SIZE) {
      buffer.shift();
    }

    // Atualizar candlestick
    this.updateCandlestick(symbol, tick);
  }

  private updateCandlestick(symbol: string, tick: DerivTickData): void {
    if (!this.candlestickData.has(symbol)) {
      this.candlestickData.set(symbol, []);
    }

    const candles = this.candlestickData.get(symbol)!;
    const currentTime = Date.now();
    const candleTime = Math.floor(currentTime / this.CANDLESTICK_PERIOD_MS) * this.CANDLESTICK_PERIOD_MS;

    // Verificar se precisa de nova vela
    if (candles.length === 0 || candles[candles.length - 1].timestamp !== candleTime) {
      candles.push({
        timestamp: candleTime,
        open: tick.quote,
        high: tick.quote,
        low: tick.quote,
        close: tick.quote,
        volume: 1,
        tickCount: 1
      });
    } else {
      // Atualizar vela atual
      const currentCandle = candles[candles.length - 1];
      currentCandle.high = Math.max(currentCandle.high, tick.quote);
      currentCandle.low = Math.min(currentCandle.low, tick.quote);
      currentCandle.close = tick.quote;
      currentCandle.volume += 1;
      currentCandle.tickCount += 1;
    }

    // Limitar número de velas
    if (candles.length > this.BUFFER_SIZE) {
      candles.shift();
    }
  }

  private performMicroscopicAnalysis(): void {
    this.tickBuffer.forEach((ticks, symbol) => {
      if (ticks.length < 50) return; // Precisa de dados mínimos

      try {
        const analysis = this.analyzeMicroscopic(symbol, ticks);
        this.emit('analysis', analysis);
        
        // Log apenas se houver sinal forte
        if (analysis.cooperativeSignal.confidence > 70) {
          console.log(`🔬 [MICROSCOPIC ${symbol}] ${analysis.cooperativeSignal.technicalDirection.toUpperCase()} (${analysis.cooperativeSignal.confidence.toFixed(1)}% confiança)`);
          console.log(`📈 [PRICE ACTION] Trend: ${analysis.priceAction.trend}, Velocity: ${analysis.priceAction.velocity.toFixed(6)}`);
          console.log(`🎯 [DIGIT] Last: ${analysis.digitAnalysis.lastDigit}, Momentum: ${analysis.digitAnalysis.digitMomentum}`);
        }
      } catch (error) {
        console.warn(`⚠️ [MICROSCOPIC] Erro na análise de ${symbol}:`, error);
      }
    });
  }

  private analyzeMicroscopic(symbol: string, ticks: DerivTickData[]): MicroscopicAnalysis {
    const latestTick = ticks[ticks.length - 1];
    const prices = ticks.map(t => t.quote);
    const candles = this.candlestickData.get(symbol) || [];

    // 1. ANÁLISE DE PRICE ACTION
    const priceAction = this.analyzePriceAction(prices);

    // 2. INDICADORES TÉCNICOS
    const technicalIndicators = this.calculateTechnicalIndicators(prices, candles);

    // 3. PADRÕES GRÁFICOS
    const graphPatterns = this.detectGraphPatterns(candles);

    // 4. ANÁLISE DE VOLUME
    const volumeAnalysis = this.analyzeVolume(candles);

    // 5. SUPORTE E RESISTÊNCIA
    const supportResistance = this.analyzeSupportResistance(prices);

    // 6. ANÁLISE DE DÍGITOS
    const digitAnalysis = this.analyzeDigitMicroscopic(ticks);

    // 7. SINAL COOPERATIVO FINAL
    const cooperativeSignal = this.generateCooperativeSignal(
      priceAction,
      technicalIndicators,
      graphPatterns,
      volumeAnalysis,
      supportResistance,
      digitAnalysis
    );

    return {
      symbol,
      timestamp: Date.now(),
      priceAction,
      technicalIndicators,
      graphPatterns,
      volumeAnalysis,
      supportResistance,
      digitAnalysis,
      cooperativeSignal
    };
  }

  private analyzePriceAction(prices: number[]): MicroscopicAnalysis['priceAction'] {
    const current = prices[prices.length - 1];
    const previous = prices[prices.length - 2];
    const older = prices[prices.length - 10] || prices[0];

    // Velocidade (mudança por tick)
    const velocity = previous ? (current - previous) / previous : 0;

    // Aceleração (mudança da velocidade)
    const oldVelocity = prices.length >= 3 ? 
      (previous - prices[prices.length - 3]) / prices[prices.length - 3] : 0;
    const acceleration = velocity - oldVelocity;

    // Força da tendência
    const trendChange = (current - older) / older;
    let trend: 'up' | 'down' | 'sideways' = 'sideways';
    let strength = 0;

    if (Math.abs(trendChange) > 0.001) {
      trend = trendChange > 0 ? 'up' : 'down';
      strength = Math.min(100, Math.abs(trendChange) * 10000);
    }

    return {
      trend,
      strength,
      velocity,
      acceleration
    };
  }

  private calculateTechnicalIndicators(prices: number[], candles: CandlestickData[]): TechnicalIndicators {
    const period14 = Math.min(14, prices.length);
    const period26 = Math.min(26, prices.length);

    return {
      rsi: this.calculateRSI(prices, period14),
      macd: this.calculateMACD(prices),
      bollinger: this.calculateBollingerBands(prices, 20),
      fibonacci: this.calculateFibonacci(prices),
      stochastic: this.calculateStochastic(candles, period14),
      williams: this.calculateWilliamsR(candles, period14),
      cci: this.calculateCCI(candles, period14),
      momentum: this.calculateMomentum(prices, 10),
      roc: this.calculateROC(prices, 10)
    };
  }

  private calculateRSI(prices: number[], period: number): number {
    if (prices.length < period + 1) return 50;

    let gains = 0;
    let losses = 0;

    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1];
      if (change > 0) gains += change;
      else losses -= change;
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateMACD(prices: number[]): TechnicalIndicators['macd'] {
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macd = ema12 - ema26;
    
    // Simplificado para tempo real
    const signal = this.calculateEMA([macd], 9);
    const histogram = macd - signal;

    return { macd, signal, histogram };
  }

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length === 0) return 0;
    if (prices.length === 1) return prices[0];

    const multiplier = 2 / (period + 1);
    let ema = prices[0];

    for (let i = 1; i < prices.length; i++) {
      ema = (prices[i] * multiplier) + (ema * (1 - multiplier));
    }

    return ema;
  }

  private calculateBollingerBands(prices: number[], period: number): TechnicalIndicators['bollinger'] {
    const recentPrices = prices.slice(-period);
    const sma = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
    
    const variance = recentPrices.reduce((acc, price) => acc + Math.pow(price - sma, 2), 0) / recentPrices.length;
    const stdDev = Math.sqrt(variance);

    const upper = sma + (2 * stdDev);
    const lower = sma - (2 * stdDev);
    const bandwidth = ((upper - lower) / sma) * 100;

    return {
      upper,
      middle: sma,
      lower,
      bandwidth
    };
  }

  private calculateFibonacci(prices: number[]): TechnicalIndicators['fibonacci'] {
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const diff = high - low;

    const levels = [
      high,
      high - (diff * 0.236),
      high - (diff * 0.382),
      high - (diff * 0.5),
      high - (diff * 0.618),
      high - (diff * 0.786),
      low
    ];

    const currentPrice = prices[prices.length - 1];
    let support = low;
    let resistance = high;

    for (const level of levels) {
      if (level <= currentPrice && level > support) support = level;
      if (level >= currentPrice && level < resistance) resistance = level;
    }

    return { levels, support, resistance };
  }

  private calculateStochastic(candles: CandlestickData[], period: number): TechnicalIndicators['stochastic'] {
    if (candles.length < period) return { k: 50, d: 50 };

    const recentCandles = candles.slice(-period);
    const high = Math.max(...recentCandles.map(c => c.high));
    const low = Math.min(...recentCandles.map(c => c.low));
    const close = candles[candles.length - 1].close;

    const k = ((close - low) / (high - low)) * 100;
    const d = k; // Simplificado

    return { k, d };
  }

  private calculateWilliamsR(candles: CandlestickData[], period: number): number {
    if (candles.length < period) return -50;

    const recentCandles = candles.slice(-period);
    const high = Math.max(...recentCandles.map(c => c.high));
    const low = Math.min(...recentCandles.map(c => c.low));
    const close = candles[candles.length - 1].close;

    return ((high - close) / (high - low)) * -100;
  }

  private calculateCCI(candles: CandlestickData[], period: number): number {
    if (candles.length < period) return 0;

    const recentCandles = candles.slice(-period);
    const typicalPrices = recentCandles.map(c => (c.high + c.low + c.close) / 3);
    const sma = typicalPrices.reduce((a, b) => a + b, 0) / typicalPrices.length;
    
    const meanDeviation = typicalPrices.reduce((acc, tp) => acc + Math.abs(tp - sma), 0) / typicalPrices.length;
    const currentTypicalPrice = typicalPrices[typicalPrices.length - 1];

    return (currentTypicalPrice - sma) / (0.015 * meanDeviation);
  }

  private calculateMomentum(prices: number[], period: number): number {
    if (prices.length < period + 1) return 0;
    
    const current = prices[prices.length - 1];
    const past = prices[prices.length - 1 - period];
    
    return ((current - past) / past) * 100;
  }

  private calculateROC(prices: number[], period: number): number {
    if (prices.length < period + 1) return 0;
    
    const current = prices[prices.length - 1];
    const past = prices[prices.length - 1 - period];
    
    return ((current - past) / past) * 100;
  }

  private detectGraphPatterns(candles: CandlestickData[]): GraphPattern[] {
    const patterns: GraphPattern[] = [];
    
    if (candles.length < 3) return patterns;

    const recent = candles.slice(-3);
    
    // Detectar Doji
    const lastCandle = recent[recent.length - 1];
    const bodySize = Math.abs(lastCandle.close - lastCandle.open);
    const shadowSize = lastCandle.high - lastCandle.low;
    
    if (bodySize / shadowSize < 0.1) {
      patterns.push({
        type: 'doji',
        strength: 70,
        reliability: 65,
        direction: 'neutral',
        timeframe: '1s'
      });
    }

    // Detectar Hammer/Shooting Star
    const lowerShadow = lastCandle.open > lastCandle.close ? 
      lastCandle.close - lastCandle.low : lastCandle.open - lastCandle.low;
    const upperShadow = lastCandle.high - Math.max(lastCandle.open, lastCandle.close);

    if (lowerShadow > bodySize * 2 && upperShadow < bodySize * 0.1) {
      patterns.push({
        type: 'hammer',
        strength: 75,
        reliability: 70,
        direction: 'bullish',
        timeframe: '1s'
      });
    }

    return patterns;
  }

  private analyzeVolume(candles: CandlestickData[]): MicroscopicAnalysis['volumeAnalysis'] {
    if (candles.length < 10) {
      return {
        volume: 0,
        volumeProfile: 'stable',
        volumeSpike: false,
        relativeTrend: 0
      };
    }

    const recent = candles.slice(-5);
    const older = candles.slice(-10, -5);
    
    const currentVolume = recent[recent.length - 1].volume;
    const avgRecentVolume = recent.reduce((sum, c) => sum + c.volume, 0) / recent.length;
    const avgOlderVolume = older.reduce((sum, c) => sum + c.volume, 0) / older.length;
    
    const relativeTrend = (avgRecentVolume - avgOlderVolume) / avgOlderVolume;
    const volumeSpike = currentVolume > avgRecentVolume * 1.5;
    
    let volumeProfile: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (relativeTrend > 0.1) volumeProfile = 'increasing';
    else if (relativeTrend < -0.1) volumeProfile = 'decreasing';

    return {
      volume: currentVolume,
      volumeProfile,
      volumeSpike,
      relativeTrend
    };
  }

  private analyzeSupportResistance(prices: number[]): MicroscopicAnalysis['supportResistance'] {
    const currentPrice = prices[prices.length - 1];
    const sortedPrices = [...prices].sort((a, b) => a - b);
    const priceRange = sortedPrices[sortedPrices.length - 1] - sortedPrices[0];
    
    // Encontrar níveis de suporte e resistência próximos
    let nearestSupport = sortedPrices[0];
    let nearestResistance = sortedPrices[sortedPrices.length - 1];
    
    for (const price of sortedPrices) {
      if (price <= currentPrice && price > nearestSupport) {
        nearestSupport = price;
      }
      if (price >= currentPrice && price < nearestResistance) {
        nearestResistance = price;
      }
    }

    // Calcular força dos níveis baseado na frequência
    const supportCount = prices.filter(p => Math.abs(p - nearestSupport) / priceRange < 0.01).length;
    const resistanceCount = prices.filter(p => Math.abs(p - nearestResistance) / priceRange < 0.01).length;

    const supportStrength = Math.min(100, (supportCount / prices.length) * 1000);
    const resistanceStrength = Math.min(100, (resistanceCount / prices.length) * 1000);

    return {
      nearestSupport,
      nearestResistance,
      supportStrength,
      resistanceStrength
    };
  }

  private analyzeDigitMicroscopic(ticks: DerivTickData[]): MicroscopicAnalysis['digitAnalysis'] {
    const lastDigits = ticks.map(tick => {
      const priceStr = tick.display_value || tick.quote.toString();
      const digitsOnly = priceStr.replace(/[^0-9]/g, '');
      return parseInt(digitsOnly[digitsOnly.length - 1]) || 0;
    });

    const currentDigit = lastDigits[lastDigits.length - 1];
    const recentDigits = lastDigits.slice(-10);
    
    // Velocidade de mudança de dígitos
    const digitChanges = recentDigits.slice(1).filter((digit, i) => digit !== recentDigits[i]).length;
    const digitVelocity = digitChanges / recentDigits.length;

    // Padrão recente
    const digitPattern = recentDigits.slice(-5).join('');

    // Momentum dos dígitos
    const recent5 = recentDigits.slice(-5);
    const isIncreasing = recent5.every((digit, i) => i === 0 || digit >= recent5[i - 1]);
    const isDecreasing = recent5.every((digit, i) => i === 0 || digit <= recent5[i - 1]);
    
    let digitMomentum: 'increasing' | 'decreasing' | 'oscillating' = 'oscillating';
    if (isIncreasing) digitMomentum = 'increasing';
    else if (isDecreasing) digitMomentum = 'decreasing';

    return {
      lastDigit: currentDigit,
      digitVelocity,
      digitPattern,
      digitMomentum
    };
  }

  private generateCooperativeSignal(
    priceAction: MicroscopicAnalysis['priceAction'],
    indicators: TechnicalIndicators,
    patterns: GraphPattern[],
    volume: MicroscopicAnalysis['volumeAnalysis'],
    sr: MicroscopicAnalysis['supportResistance'],
    digits: MicroscopicAnalysis['digitAnalysis']
  ): MicroscopicAnalysis['cooperativeSignal'] {
    
    let upSignals = 0;
    let downSignals = 0;
    let activeSignalsWeight = 0; // 🔥 CORRIGIDO: Peso apenas dos sinais ativos

    // 1. Price Action (peso 25)
    if (priceAction.trend === 'up' && priceAction.strength > 30) {
      upSignals += 25;
      activeSignalsWeight += 25;
    } else if (priceAction.trend === 'down' && priceAction.strength > 30) {
      downSignals += 25;
      activeSignalsWeight += 25;
    }

    // 2. RSI (peso 15)
    if (indicators.rsi < 30) {
      upSignals += 15;
      activeSignalsWeight += 15;
    } else if (indicators.rsi > 70) {
      downSignals += 15;
      activeSignalsWeight += 15;
    }

    // 3. MACD (peso 20)
    if (indicators.macd.histogram > 0) {
      upSignals += 20;
      activeSignalsWeight += 20;
    } else if (indicators.macd.histogram < 0) {
      downSignals += 20;
      activeSignalsWeight += 20;
    }

    // 4. Volume (peso 10)
    if (volume.volumeProfile === 'increasing' && priceAction.trend === 'up') {
      upSignals += 10;
      activeSignalsWeight += 10;
    } else if (volume.volumeProfile === 'increasing' && priceAction.trend === 'down') {
      downSignals += 10;
      activeSignalsWeight += 10;
    }

    // 5. Bollinger Bands (peso 15)
    const currentPrice = 1; // Placeholder
    if (currentPrice < indicators.bollinger.lower) {
      upSignals += 15;
      activeSignalsWeight += 15;
    } else if (currentPrice > indicators.bollinger.upper) {
      downSignals += 15;
      activeSignalsWeight += 15;
    }

    // 6. Digit Analysis (peso 15)
    if (digits.digitMomentum === 'increasing' && digits.lastDigit < 5) {
      upSignals += 15;
      activeSignalsWeight += 15;
    } else if (digits.digitMomentum === 'decreasing' && digits.lastDigit > 5) {
      downSignals += 15;
      activeSignalsWeight += 15;
    }

    const netSignal = upSignals - downSignals;
    
    // 🔥 CORRIGIDO: Calcular confiança baseado APENAS nos sinais ativos
    // Se activeSignalsWeight = 0, usar valor padrão baixo
    const confidence = activeSignalsWeight > 0 
      ? Math.min(95, (Math.abs(netSignal) / activeSignalsWeight * 100) * 1.1) // Amplificador 1.1x
      : 0;
    
    let technicalDirection: 'up' | 'down' | 'neutral' = 'neutral';
    if (netSignal > 10) technicalDirection = 'up';
    else if (netSignal < -10) technicalDirection = 'down';

    // Simulação de acordo com IA (será integrado depois)
    const agreementWithAI = Math.random() * 0.4 + 0.6; // 60-100% acordo

    return {
      technicalDirection,
      confidence,
      agreementWithAI,
      hybridRecommendation: technicalDirection
    };
  }

  getMicroscopicStatus(): any {
    return {
      active: this.isActive,
      intervalMs: this.ANALYSIS_INTERVAL_MS,
      symbolsTracked: this.tickBuffer.size,
      bufferSizes: Object.fromEntries(
        Array.from(this.tickBuffer.entries()).map(([symbol, ticks]) => [symbol, ticks.length])
      )
    };
  }
}

// Export singleton
export const microscopicAnalyzer = new MicroscopicTechnicalAnalyzer();