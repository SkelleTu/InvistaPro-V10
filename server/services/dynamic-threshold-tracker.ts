import { storage } from '../storage';

/**
 * 🎯 SISTEMA DE THRESHOLD DINÂMICO BASEADO EM MÉDIA ALTA DIÁRIA
 * 
 * Este serviço rastreia todos os thresholds de consenso da IA ao longo do dia
 * e calcula a "média alta" (top 30% dos thresholds) para garantir operações
 * conservadoras e acertivas apenas nos melhores momentos do dia.
 */

interface ThresholdRecord {
  timestamp: Date;
  threshold: number;
  symbol: string;
  decision: 'up' | 'down' | 'neutral';
}

interface DailyThresholdStats {
  date: string;
  allThresholds: number[];
  highAverageThreshold: number; // Média do top 30%
  medianThreshold: number;
  minThreshold: number;
  maxThreshold: number;
  totalAnalyses: number;
  topPercentile: number; // Valor do top 30%
}

class DynamicThresholdTracker {
  private dailyThresholds: ThresholdRecord[] = [];
  private currentDate: string = new Date().toISOString().split('T')[0];
  private stats: DailyThresholdStats | null = null;
  
  // 🎯 CONFIGURAÇÕES DO SISTEMA OTIMIZADAS
  private readonly HIGH_PERCENTILE = 0.40; // Top 40% dos thresholds (média alta mais abrangente)
  private readonly MIN_SAMPLES_FOR_STATS = 5; // Reduzido para começar análises mais cedo
  
  constructor() {
    console.log('🎯 [THRESHOLD TRACKER] Sistema de threshold dinâmico iniciado');
    this.resetIfNewDay();
    
    // Reset automático à meia-noite
    setInterval(() => this.resetIfNewDay(), 60000); // Verifica a cada minuto
  }
  
  /**
   * Registra um novo threshold de análise de IA
   */
  recordThreshold(threshold: number, symbol: string, decision: 'up' | 'down' | 'neutral'): void {
    this.resetIfNewDay();
    
    const record: ThresholdRecord = {
      timestamp: new Date(),
      threshold,
      symbol,
      decision
    };
    
    this.dailyThresholds.push(record);
    
    // Recalcular estatísticas se tivermos amostras suficientes
    if (this.dailyThresholds.length >= this.MIN_SAMPLES_FOR_STATS) {
      this.calculateStats();
    }
    
    console.log(`📊 [THRESHOLD] Registrado: ${threshold}% | Total hoje: ${this.dailyThresholds.length}`);
  }
  
  /**
   * Calcula estatísticas diárias incluindo a média alta
   */
  private calculateStats(): void {
    if (this.dailyThresholds.length === 0) {
      this.stats = null;
      return;
    }
    
    // Filtrar apenas thresholds de decisões não-neutras (que realmente indicam entrada)
    const validThresholds = this.dailyThresholds
      .filter(record => record.decision !== 'neutral')
      .map(record => record.threshold)
      .sort((a, b) => b - a); // Ordem decrescente
    
    if (validThresholds.length === 0) {
      // Se só temos neutros, usar todos os thresholds
      const allThresholds = this.dailyThresholds
        .map(record => record.threshold)
        .sort((a, b) => b - a);
      
      this.stats = {
        date: this.currentDate,
        allThresholds,
        highAverageThreshold: this.calculateMean(allThresholds),
        medianThreshold: this.calculateMedian(allThresholds),
        minThreshold: Math.min(...allThresholds),
        maxThreshold: Math.max(...allThresholds),
        totalAnalyses: this.dailyThresholds.length,
        topPercentile: allThresholds[0] || 0
      };
      return;
    }
    
    // Calcular índice do top percentil
    const topIndex = Math.floor(validThresholds.length * this.HIGH_PERCENTILE);
    const topThresholds = validThresholds.slice(0, Math.max(1, topIndex));
    
    // Calcular média alta (média do top 30%)
    const highAverage = this.calculateMean(topThresholds);
    
    this.stats = {
      date: this.currentDate,
      allThresholds: validThresholds,
      highAverageThreshold: highAverage,
      medianThreshold: this.calculateMedian(validThresholds),
      minThreshold: Math.min(...validThresholds),
      maxThreshold: Math.max(...validThresholds),
      totalAnalyses: this.dailyThresholds.length,
      topPercentile: topThresholds[topThresholds.length - 1] || validThresholds[0] || 0
    };
    
    console.log(`📈 [STATS UPDATE] Média Alta: ${highAverage.toFixed(1)}% | Mediana: ${this.stats.medianThreshold.toFixed(1)}% | Amostras: ${this.dailyThresholds.length}`);
  }
  
  /**
   * 🎯 FUNÇÃO PRINCIPAL: Retorna o threshold dinâmico ideal para operar
   * ✅ FIX: Com histórico pequeno, usar threshold conservador (45%) não "Média Alta"
   * 
   * Lógica:
   * - Se temos dados suficientes: usa média alta (top 30%)
   * - Se poucos dados: usa threshold conservador inicial (70%)
   * - Aplica ajustes baseados no modo de operação
   */
  getDynamicThreshold(mode: string, forceMinimumOperations: boolean = false): number {
    this.resetIfNewDay();
    
    // Se não temos estatísticas ainda, usar threshold otimizado para maximizar operações
    if (!this.stats || this.dailyThresholds.length < this.MIN_SAMPLES_FOR_STATS) {
      const initialThreshold = 45; // ✅ FIX: Reduzido para 45% para permitir operações no início
      console.log(`🎯 [DYNAMIC THRESHOLD] Coletando dados iniciais: ${initialThreshold}% (otimizado)`);
      return initialThreshold;
    }
    
    // ✅ FIX: Com histórico pequeno (<30 amostras), usar mediana ao invés de "Média Alta"
    // Isso evita que a "Média Alta" seja muito inflada quando há poucos dados
    let dynamicThreshold = this.stats.highAverageThreshold;
    
    // Se histórico é insuficiente, usar mediana (mais conservador e representativo)
    if (this.dailyThresholds.length < 30) {
      dynamicThreshold = this.stats.medianThreshold;
      console.log(`🎯 [DYNAMIC THRESHOLD] Histórico pequeno (${this.dailyThresholds.length} amostras) - usando Mediana: ${dynamicThreshold.toFixed(1)}%`);
    }
    
    // 🎯 AJUSTE INTELIGENTE POR MODO DE OPERAÇÃO
    const modeLimits = this.getModeLimits(mode);
    
    // 📈 OTIMIZAÇÃO: Usar threshold mais agressivo para maximizar operações dentro da média alta
    if (mode.includes('production')) {
      // Em produção, usar 90% da média alta para capturar mais oportunidades boas
      dynamicThreshold = dynamicThreshold * 0.90;
    } else if (mode.includes('test_sem_limites')) {
      // No modo sem limites, usar 85% da média alta para maximizar volume
      dynamicThreshold = dynamicThreshold * 0.85;
    } else {
      // Outros modos de teste: usar 88% da média alta
      dynamicThreshold = dynamicThreshold * 0.88;
    }
    
    // Se estamos forçando operações mínimas, relaxar ainda mais
    if (forceMinimumOperations) {
      // Garantir operações mínimas com threshold ainda mais flexível
      dynamicThreshold = Math.min(
        this.stats.topPercentile * 0.75, // 25% mais agressivo no top percentil
        dynamicThreshold * 0.80 // 20% mais flexível que o normal
      );
      console.log(`🎯 [FORCE MINIMUM] Threshold otimizado para garantir operações: ${dynamicThreshold.toFixed(1)}%`);
    }
    
    // 🎯 LIMITES OTIMIZADOS: Maximizar operações dentro de parâmetros seguros
    dynamicThreshold = Math.max(40, dynamicThreshold); // ✅ Mínimo reduzido para 40%
    dynamicThreshold = Math.min(80, dynamicThreshold); // Máximo reduzido para 80% (mais oportunidades)
    
    console.log(`🎯 [DYNAMIC THRESHOLD] Modo: ${mode} | Threshold: ${dynamicThreshold.toFixed(1)}% | Média Alta: ${this.stats.highAverageThreshold.toFixed(1)}%`);
    
    return Math.round(dynamicThreshold);
  }
  
  /**
   * Verifica se devemos forçar operações para atingir mínimo diário
   */
  async shouldForceMinimumOperations(userId: string, mode: string): Promise<boolean> {
    const modeLimits = this.getModeLimits(mode);
    
    // Se não há mínimo, não forçar
    if (modeLimits.min === 0) return false;
    
    // Buscar operações do dia
    const todayOperations = await this.getTodayOperationsCount(userId);
    
    // Se já atingimos o mínimo, não forçar
    if (todayOperations >= modeLimits.min) return false;
    
    // Verificar a hora do dia
    const now = new Date();
    const hours = now.getHours();
    
    // Se está perto do fim do dia (após 18h) e ainda não atingiu o mínimo, forçar
    if (hours >= 18 && todayOperations < modeLimits.min) {
      console.log(`⚠️ [FORCE MINIMUM] ${hours}h - Apenas ${todayOperations}/${modeLimits.min} operações hoje`);
      return true;
    }
    
    // Se está no meio do dia (após 12h) e zero operações, forçar
    if (hours >= 12 && todayOperations === 0) {
      console.log(`⚠️ [FORCE MINIMUM] ${hours}h - Zero operações hoje, forçando entrada`);
      return true;
    }
    
    return false;
  }
  
  /**
   * Obtém limites de operações por modo
   */
  private getModeLimits(mode: string): { min: number; max: number } {
    switch(mode) {
      case 'production_2_24h':
        return { min: 2, max: 2 };
      case 'production_3-4_24h':
        return { min: 3, max: 4 };
      case 'test_sem_limites':
        return { min: 1, max: 999999 }; // Mínimo 1-2 operações/dia mesmo sem limites
      case 'test_4_1min':
      case 'test_3_2min':
      case 'test_4_1hour':
      case 'test_3_2hour':
        return { min: 0, max: 999999 }; // Testes não têm mínimo
      default:
        return { min: 0, max: 999999 };
    }
  }
  
  /**
   * Conta operações do dia para o usuário
   */
  private async getTodayOperationsCount(userId: string): Promise<number> {
    try {
      const operations = await storage.getActiveTradeOperations(userId);
      const today = new Date().toISOString().split('T')[0];
      
      return operations.filter(op => {
        if (!op.createdAt) return false;
        const opDate = new Date(op.createdAt).toISOString().split('T')[0];
        return opDate === today && (op.status === 'won' || op.status === 'lost' || op.status === 'pending');
      }).length;
    } catch (error) {
      console.error('❌ Erro ao contar operações do dia:', error);
      return 0;
    }
  }
  
  /**
   * Obtém estatísticas atuais
   */
  getStats(): DailyThresholdStats | null {
    this.resetIfNewDay();
    return this.stats;
  }
  
  /**
   * Reseta se mudou o dia
   */
  private resetIfNewDay(): void {
    const today = new Date().toISOString().split('T')[0];
    
    if (today !== this.currentDate) {
      console.log(`🔄 [THRESHOLD TRACKER] Novo dia detectado: ${today} (anterior: ${this.currentDate})`);
      console.log(`📊 [RESET] Thresholds do dia anterior: ${this.dailyThresholds.length} análises`);
      
      this.currentDate = today;
      this.dailyThresholds = [];
      this.stats = null;
    }
  }
  
  /**
   * Utilitários de cálculo
   */
  private calculateMean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
  
  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;
    
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    
    if (sorted.length % 2 === 0) {
      return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    
    return sorted[mid];
  }
}

// Singleton
export const dynamicThresholdTracker = new DynamicThresholdTracker();
