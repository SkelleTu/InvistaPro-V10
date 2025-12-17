/**
 * HYBRID ORCHESTRATOR - PROJETO PERDA ZERO
 * Orquestrador central que gerencia Sistema Avançado + Sistema Neural Quântico
 * Elimina dependência circular e controla lifecycle
 */

import { AdvancedLearningSystem, AdvancedLearningConfig } from './advanced-learning-system';
import { QuantumNeuralSystem, QuantumNeuralConfig } from './quantum-neural-system';
import { MicroscopicTechnicalAnalyzer, microscopicAnalyzer, MicroscopicAnalysis } from './microscopic-technical-analysis';
import { DerivTickData } from './deriv-api';

interface IAdvancedAnalyzer {
  analyzeMarket(symbol: string, marketData: any[], models: string[]): Promise<any>;
  getSystemStatus(): any;
}

interface IQuantumAnalyzer {
  analyzeQuantumCooperative(symbol: string, marketData: any[], timeframe?: '1m' | '5m' | '15m' | '1h'): Promise<any>;
  getPerformanceStats(): any;
}

interface IMicroscopicAnalyzer {
  addTick(symbol: string, tick: DerivTickData): void;
  start(): void;
  stop(): void;
  getMicroscopicStatus(): any;
  on(event: string, listener: Function): any;
}

interface HybridConfig {
  enableQuantum: boolean;
  enableMicroscopic?: boolean;
  advancedConfig: AdvancedLearningConfig;
  quantumConfig?: QuantumNeuralConfig;
  maxMemoryMB?: number;
  reinitializationGuard?: boolean;
}

export class HybridOrchestrator {
  private advancedSystem: IAdvancedAnalyzer | null = null;
  private quantumSystem: IQuantumAnalyzer | null = null;
  private microscopicSystem: IMicroscopicAnalyzer | null = null;
  private config: HybridConfig;
  private initialized = false;
  private initializationInProgress = false;
  private latestMicroscopicAnalysis: Map<string, MicroscopicAnalysis> = new Map();

  constructor(config: HybridConfig) {
    this.config = config;
  }

  /**
   * INICIALIZAÇÃO SEGURA SEM DEPENDÊNCIA CIRCULAR
   */
  async initialize(): Promise<void> {
    // Proteção contra re-inicialização
    if (this.initialized || this.initializationInProgress) {
      console.log('🔒 HybridOrchestrator: já inicializado ou em progresso');
      return;
    }

    this.initializationInProgress = true;

    try {
      console.log('🎯 [HYBRID ORCHESTRATOR] Inicializando sistemas independentemente...');

      // 1. Inicializar Sistema Avançado (SEM integração quântica)
      this.advancedSystem = new AdvancedLearningSystem(this.config.advancedConfig);
      console.log('✅ Sistema Avançado inicializado');

      // 2. Inicializar Sistema Quântico (SE habilitado e memória disponível)
      if (this.config.enableQuantum && this.isMemoryAvailable()) {
        try {
          console.log('🌌 Inicializando Sistema Neural Quântico...');
          this.quantumSystem = new QuantumNeuralSystem(this.config.quantumConfig!);
          console.log('✅ Sistema Neural Quântico inicializado');
        } catch (error) {
          console.error('❌ Falha na inicialização do Sistema Quântico:', error);
          console.log('⚠️ Continuando apenas com Sistema Avançado');
          this.quantumSystem = null;
        }
      } else {
        console.log('⚠️ Sistema Quântico desabilitado ou memória insuficiente');
      }

      // 3. Inicializar Sistema de Análise Técnica Microscópica
      if (this.config.enableMicroscopic !== false) { // Default: habilitado
        try {
          console.log('🔬 Inicializando Sistema de Análise Técnica Microscópica...');
          this.microscopicSystem = microscopicAnalyzer;
          
          // Configurar listener para análises microscópicas
          this.microscopicSystem.on('analysis', (analysis: MicroscopicAnalysis) => {
            this.latestMicroscopicAnalysis.set(analysis.symbol, analysis);
          });
          
          this.microscopicSystem.start();
          console.log('✅ Sistema Microscópico inicializado - Análise em 100ms');
        } catch (error) {
          console.error('❌ Falha na inicialização do Sistema Microscópico:', error);
          console.log('⚠️ Continuando sem análise técnica microscópica');
          this.microscopicSystem = null;
        }
      } else {
        console.log('⚠️ Sistema Microscópico desabilitado');
      }

      this.initialized = true;
      console.log('🎉 HybridOrchestrator inicializado com sucesso!');
      
    } catch (error) {
      console.error('💥 Erro na inicialização do HybridOrchestrator:', error);
      throw error;
    } finally {
      this.initializationInProgress = false;
    }
  }

  /**
   * ANÁLISE HÍBRIDA SUPREMA - SEM DEPENDÊNCIAS CIRCULARES
   */
  async analyzeHybridSupreme(
    symbol: string,
    marketData: any[],
    models: string[],
    timeframe: '1m' | '5m' | '15m' | '1h' = '1m'
  ): Promise<{
    prediction: 'up' | 'down' | 'neutral';
    confidence: number;
    reasoning: string;
    systems: {
      advanced: any;
      quantum?: any;
      microscopic?: any;
      hybrid: any;
    };
    quantumAdvantage: number;
    projectedReturn: number;
  }> {
    if (!this.initialized) {
      await this.initialize();
    }

    console.log(`🔥 [HYBRID ORCHESTRATOR] Análise híbrida para ${symbol}`);

    // 1. Alimentar dados para sistema microscópico (se ativo)
    if (this.microscopicSystem && marketData.length > 0) {
      const latestTick = marketData[marketData.length - 1];
      if (latestTick && typeof latestTick.quote === 'number') {
        this.microscopicSystem.addTick(symbol, latestTick as DerivTickData);
      }
    }

    // 2. Análise com Sistema Avançado (sempre disponível)
    const advancedResult = await this.advancedSystem!.analyzeMarket(symbol, marketData, models);

    // 3. Análise com Sistema Quântico (se disponível)
    let quantumResult = null;
    if (this.quantumSystem) {
      try {
        quantumResult = await this.quantumSystem.analyzeQuantumCooperative(symbol, marketData, timeframe);
      } catch (error) {
        console.error('⚠️ Erro no Sistema Quântico, usando apenas Sistema Avançado:', error);
      }
    }

    // 4. Obter análise microscópica recente (se disponível)
    const microscopicResult = this.latestMicroscopicAnalysis.get(symbol);

    // 5. Fusão Inteligente de TODOS os Resultados
    return await this.fuseResults(advancedResult, quantumResult, microscopicResult);
  }

  /**
   * FUSÃO INTELIGENTE DOS SISTEMAS
   */
  private async fuseResults(advancedResult: any, quantumResult: any, microscopicResult?: MicroscopicAnalysis): Promise<any> {
    const hasMicroscopic = microscopicResult && microscopicResult.cooperativeSignal.confidence > 50;
    
    if (!quantumResult && !hasMicroscopic) {
      // Apenas sistema avançado
      return {
        prediction: advancedResult.prediction || 'neutral',
        confidence: advancedResult.confidence || 75,
        reasoning: 'Análise usando Sistema Avançado (Quantum e Microscópico indisponíveis)',
        systems: {
          advanced: advancedResult,
          hybrid: { mode: 'advanced_only', quantum_status: 'disabled', microscopic_status: 'disabled' }
        },
        quantumAdvantage: 0,
        projectedReturn: this.calculateProjectedReturn(advancedResult.prediction, advancedResult.confidence)
      };
    }

    // Log da fusão baseada nos sistemas disponíveis
    const availableSystems = [];
    if (quantumResult) availableSystems.push('Quântico');
    if (hasMicroscopic) availableSystems.push('Microscópico Técnico');
    
    console.log(`🌌 [HYBRID FUSION] Fusionando Sistema Avançado + ${availableSystems.join(' + ')}`);
    
    // Pesos dinâmicos baseados nos sistemas disponíveis
    // CORREÇÃO: Priorizar sistema quântico quando disponível
    let advancedWeight = 0.3;
    let quantumWeight = quantumResult ? 0.5 : 0;
    let microscopicWeight = hasMicroscopic ? 0.2 : 0;
    
    // Se algum sistema não está disponível, redistribuir pesos
    if (!quantumResult && hasMicroscopic) {
      advancedWeight = 0.7;
      microscopicWeight = 0.3;
    } else if (quantumResult && !hasMicroscopic) {
      advancedWeight = 0.3;
      quantumWeight = 0.7; // Dar mais peso ao quântico
    }
    
    // Sanitizar confidence inputs para prevenir NaN propagation
    const safeAdvancedConfidence = isFinite(advancedResult.confidence) && advancedResult.confidence >= 0 ? 
      Math.min(100, advancedResult.confidence) : 50; // Default 50% se inválido
    const safeQuantumConfidence = quantumResult && isFinite(quantumResult.confidence) && quantumResult.confidence >= 0 ? 
      Math.min(100, quantumResult.confidence) : 50; // Default 50% se inválido
    const safeMicroscopicConfidence = hasMicroscopic ? 
      Math.min(100, microscopicResult!.cooperativeSignal.confidence) : 0;
    
    const predictions = { up: 0, down: 0, neutral: 0 };
    
    // Somar contribuições de cada sistema
    if (advancedResult.prediction && advancedResult.prediction in predictions) {
      predictions[advancedResult.prediction as keyof typeof predictions] += (safeAdvancedConfidence / 100) * advancedWeight;
    }
    
    if (quantumResult && quantumResult.prediction && quantumResult.prediction in predictions) {
      predictions[quantumResult.prediction as keyof typeof predictions] += (safeQuantumConfidence / 100) * quantumWeight;
    }
    
    if (hasMicroscopic && microscopicResult!.cooperativeSignal.technicalDirection in predictions) {
      predictions[microscopicResult!.cooperativeSignal.technicalDirection as keyof typeof predictions] += (safeMicroscopicConfidence / 100) * microscopicWeight;
      console.log(`🔬 [MICROSCOPIC FUSION] Adicionando sinal técnico: ${microscopicResult!.cooperativeSignal.technicalDirection} (${safeMicroscopicConfidence.toFixed(1)}% confiança)`);
    }
    
    const maxScore = Math.max(predictions.up, predictions.down, predictions.neutral);
    let finalPrediction: 'up' | 'down' | 'neutral';
    
    if (maxScore === predictions.up) finalPrediction = 'up';
    else if (maxScore === predictions.down) finalPrediction = 'down';
    else finalPrediction = 'neutral';
    
    // CORREÇÃO: Amplificar confiança híbrida para evitar sinais muito fracos
    // Se todos sistemas concordam, aumentar confiança
    const systemsAgree = (advancedResult.prediction === (quantumResult?.prediction || advancedResult.prediction));
    const hybridConfidence = systemsAgree 
      ? Math.min(95, Math.max(maxScore * 100, 65)) // Mínimo 65% quando acordam
      : Math.min(95, Math.max(maxScore * 100, 45)); // Mínimo 45% quando discordam
    const quantumAdvantage = quantumResult ? (quantumResult.quantumAdvantage || 0) : 0;
    
    // Construir reasoning dinâmico baseado nos sistemas ativos
    let reasoning = `FUSÃO HÍBRIDA: ${finalPrediction.toUpperCase()} (${hybridConfidence.toFixed(1)}%)`;
    reasoning += ` | Avançado: ${advancedResult.prediction}`;
    if (quantumResult) reasoning += ` | Quântico: ${quantumResult.prediction}`;
    if (hasMicroscopic) reasoning += ` | Microscópico: ${microscopicResult!.cooperativeSignal.technicalDirection}`;
    if (quantumResult) reasoning += ` | Vantagem Quântica: ${(quantumAdvantage * 100).toFixed(1)}%`;
    
    // Construir mode baseado nos sistemas ativos
    let mode = 'advanced_only';
    if (quantumResult && hasMicroscopic) mode = 'quantum_microscopic_enhanced';
    else if (quantumResult) mode = 'quantum_enhanced';
    else if (hasMicroscopic) mode = 'microscopic_enhanced';
    
    return {
      prediction: finalPrediction,
      confidence: hybridConfidence,
      reasoning,
      systems: {
        advanced: advancedResult,
        quantum: quantumResult,
        microscopic: hasMicroscopic ? microscopicResult : null,
        hybrid: {
          mode,
          fusion_weights: { 
            advanced: advancedWeight, 
            quantum: quantumWeight, 
            microscopic: microscopicWeight 
          },
          consensus_strength: maxScore,
          participating_systems: availableSystems.length + 1 // +1 for advanced
        }
      },
      quantumAdvantage,
      projectedReturn: this.calculateProjectedReturn(finalPrediction, hybridConfidence, quantumAdvantage)
    };
  }

  /**
   * VERIFICAÇÕES DE SEGURANÇA
   */
  private isMemoryAvailable(): boolean {
    const maxMemoryMB = this.config.maxMemoryMB || 1500; // Default 1.5GB limit
    
    if (process.memoryUsage) {
      const memUsage = process.memoryUsage();
      const currentMemoryMB = memUsage.heapUsed / 1024 / 1024;
      
      console.log(`📊 Memória atual: ${currentMemoryMB.toFixed(0)}MB / ${maxMemoryMB}MB`);
      
      return currentMemoryMB < (maxMemoryMB * 0.7); // Use only 70% of limit
    }
    
    return true; // Assumir OK se não conseguir medir
  }

  private calculateProjectedReturn(prediction: string, confidence: number, quantumAdvantage: number = 0): number {
    // Numeric safety - garantir valores finitos
    const safeConfidence = (isFinite(confidence) && confidence > 0) ? confidence : 0;
    const safeQuantumAdvantage = (isFinite(quantumAdvantage) && quantumAdvantage > 0) ? quantumAdvantage : 0;
    
    const baseReturn = (safeConfidence / 100) * (prediction === 'neutral' ? 0.3 : 1.0);
    const quantumBonus = safeQuantumAdvantage * 0.5;
    const totalReturn = baseReturn + quantumBonus;
    
    // Garantir que retorno seja finito
    return isFinite(totalReturn) ? totalReturn : 0;
  }

  /**
   * STATUS DOS SISTEMAS
   */
  getHybridStatus() {
    return {
      initialized: this.initialized,
      initializationInProgress: this.initializationInProgress,
      systems: {
        advanced: this.advancedSystem ? { active: true, status: this.advancedSystem.getSystemStatus() } : null,
        quantum: this.quantumSystem ? { active: true, stats: this.quantumSystem.getPerformanceStats() } : null,
        microscopic: this.microscopicSystem ? { active: true, status: this.microscopicSystem.getMicroscopicStatus() } : null
      },
      config: {
        quantumEnabled: this.config.enableQuantum,
        microscopicEnabled: this.config.enableMicroscopic !== false,
        memoryLimit: this.config.maxMemoryMB
      }
    };
  }
}