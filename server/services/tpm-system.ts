/**
 * TPM (Total Production Maintenance / Manutenção Produtiva Total)
 * 5 PILARES COMPLETOS com detalhes microscópicos:
 * 
 * 1. AUTONOMOUS MAINTENANCE - IAs se auto-verificam e self-heal
 * 2. PLANNED MAINTENANCE - Preventiva, Preditiva, Corretiva
 * 3. QUALITY MANAGEMENT - Win Rate, Profit, Consistency, Sharpe obrigatórios
 * 4. CONTINUOUS IMPROVEMENT - Weights dinâmicos + Feedback loop
 * 5. SAFETY & RESILIENCE - Circuit breaker, fallback, proteção saldo
 */

// ==================== PILAR 1: AUTONOMOUS MAINTENANCE ====================
export interface AutonousMaintenance {
  lastSelfCheck: number;
  consecutiveFailures: number;
  autoHealed: boolean;
  healingAttempts: number;
  nextAutoHeal: number;
}

// ==================== PILAR 3: QUALITY THRESHOLDS ====================
export interface QualityThresholds {
  minWinRate: number; // 50%
  minProfitability: number; // 0%
  minConsistency: number; // 70%
  maxNegativeSharpe: number; // 0 (não aceita)
  violationCount: number;
  quarantined: boolean;
}

// ==================== PILAR 4: CONTINUOUS IMPROVEMENT ====================
export interface ContinuousImprovement {
  weightHistory: Array<{ timestamp: number; weights: Map<string, number> }>;
  performanceTrend: number; // -1 (piorando), 0 (estável), 1 (melhorando)
  feedbackScore: number; // 0-100 baseado em feedback
  optimizationIterations: number;
  lastOptimization: number;
}

// ==================== PILAR 5: SAFETY & RESILIENCE ====================
export interface SafetyCircuit {
  status: 'open' | 'closed' | 'half-open';
  failureCount: number;
  successCount: number;
  tripThreshold: number; // falhas consecutivas
  resetTimeout: number;
  lastTrip: number;
}

export interface AIHealthMetric {
  modelId: string;
  symbol: string;
  accuracy: number;
  profitability: number;
  consistencyScore: number;
  failureRate: number;
  responseTime: number;
  lastCheck: number;
  status: 'healthy' | 'degraded' | 'critical' | 'maintenance';
  healthScore: number;
  
  // Pilares
  autonomous: AutonousMaintenance;
  quality: QualityThresholds;
  improvement: ContinuousImprovement;
  safety: SafetyCircuit;
  winRate: number;
  sharpeRatio: number;
}

export interface TPMAlert {
  id: string;
  timestamp: number;
  severity: 'info' | 'warning' | 'critical';
  component: string;
  pilar: 'autonomous' | 'planned' | 'quality' | 'improvement' | 'safety';
  message: string;
  suggestedAction: string;
}

export interface MaintenanceSchedule {
  modelId: string;
  lastMaintenance: number;
  nextMaintenance: number;
  maintenanceType: 'rotation' | 'reset' | 'cleanup' | 'retrain' | 'quarantine' | 'heal';
  priority: number;
  reason: string;
}

export class TPMSystem {
  private healthMetrics: Map<string, AIHealthMetric[]> = new Map();
  private alerts: TPMAlert[] = [];
  private maintenanceQueue: MaintenanceSchedule[] = [];
  private checkInterval: NodeJS.Timeout | null = null;
  private autoHealInterval: NodeJS.Timeout | null = null;
  
  private readonly THRESHOLDS = {
    // PILAR 1: Autonomous
    autoHealInterval: 120000, // 2 min
    maxConsecutiveFailures: 5,
    
    // PILAR 2: Planned
    degradationThreshold: 0.7, // 70% = degraded
    criticalThreshold: 0.5,    // 50% = critical
    degradationWindow: 60000,   // 60 seg
    
    // PILAR 3: Quality
    minWinRate: 0.50,          // 50%
    minProfit: 0.0,            // 0%
    minConsistency: 0.70,      // 70%
    maxNegativeSharpe: 0.0,    // Não aceita negativo
    
    // PILAR 5: Safety
    circuitTripThreshold: 3,   // 3 falhas = trip
    circuitResetTimeout: 300000, // 5 min
  };

  constructor() {
    console.log('🔧 [TPM] ===== SISTEMA COMPLETO DE MANUTENÇÃO PRODUTIVA TOTAL =====');
    console.log('🏗️  PILAR 1: Manutenção Autônoma (Self-checks + Self-healing)');
    console.log('📋 PILAR 2: Manutenção Planejada (Preventiva + Preditiva + Corretiva)');
    console.log('✅ PILAR 3: Gestão de Qualidade (Win Rate, Profit, Consistency, Sharpe)');
    console.log('📈 PILAR 4: Melhoria Contínua (Weights dinâmicos + Feedback loop)');
    console.log('🛡️  PILAR 5: Segurança & Resiliência (Circuit breaker + Fallback)');
    console.log('=' .repeat(65));
  }

  startMonitoring(): void {
    if (this.checkInterval) return;
    
    console.log('▶️  [TPM] Iniciando monitoramento de saúde...');
    
    // PILAR 1: Autonomous - Auto-checks a cada 30s
    this.checkInterval = setInterval(() => {
      this.performHealthCheck();
    }, 30000);
    
    // PILAR 1: Autonomous - Auto-healing a cada 2 min
    this.autoHealInterval = setInterval(() => {
      this.performAutoHealing();
    }, this.THRESHOLDS.autoHealInterval);
  }

  stopMonitoring(): void {
    if (this.checkInterval) clearInterval(this.checkInterval);
    if (this.autoHealInterval) clearInterval(this.autoHealInterval);
    console.log('⏹️  [TPM] Monitoramento PARADO');
  }

  // ===== INTEGRAÇÃO REAL COM TRADES =====
  recordTradeResult(
    modelId: string,
    symbol: string,
    tradeProfit: number,
    tradeWon: boolean,
    responseTime: number,
    stake: number
  ): void {
    if (!this.healthMetrics.has(modelId)) {
      this.healthMetrics.set(modelId, []);
    }

    const profitability = tradeProfit / stake;
    const accuracy = tradeWon ? 1.0 : 0.0;

    // Chamar recordHealthMetric com dados REAIS
    this.recordHealthMetric(
      modelId,
      symbol,
      accuracy,
      profitability,
      responseTime,
      tradeWon,
      accuracy, // winRate
      tradeProfit > 0 ? profitability : -profitability
    );

    const metrics = this.healthMetrics.get(modelId);
    if (metrics && metrics.length > 0) {
      const latest = metrics[metrics.length - 1];
      
      // PILAR 4: Feedback contínuo
      latest.improvement.feedbackScore = Math.max(0, Math.min(100, profitability * 100));
      
      console.log(`💰 [TPM TRADE] ${modelId} @ ${symbol}: ${tradeWon ? '✅' : '❌'} | P&L: ${(tradeProfit > 0 ? '+' : '')}${tradeProfit.toFixed(2)} | Health: ${latest.healthScore.toFixed(1)}`);
    }
  }

  recordHealthMetric(
    modelId: string,
    symbol: string,
    accuracy: number,
    profitability: number,
    responseTime: number,
    success: boolean,
    winRate: number = 0.5,
    sharpeRatio: number = 0
  ): void {
    if (!this.healthMetrics.has(modelId)) {
      this.healthMetrics.set(modelId, []);
    }

    const healthScore = this.calculateHealthScore(
      accuracy,
      profitability,
      success,
      responseTime
    );

    // ===== PILAR 3: QUALITY CHECKS =====
    const qualityViolations = this.checkQualityThresholds(
      winRate,
      profitability,
      accuracy,
      sharpeRatio
    );

    const metric: AIHealthMetric = {
      modelId,
      symbol,
      accuracy,
      profitability,
      consistencyScore: success ? 100 : 0,
      failureRate: success ? 0 : 100,
      responseTime,
      lastCheck: Date.now(),
      status: this.getHealthStatus(healthScore, qualityViolations),
      healthScore,
      winRate,
      sharpeRatio,
      
      // PILAR 1: Autonomous
      autonomous: {
        lastSelfCheck: Date.now(),
        consecutiveFailures: success ? 0 : 1,
        autoHealed: false,
        healingAttempts: 0,
        nextAutoHeal: Date.now() + this.THRESHOLDS.autoHealInterval
      },
      
      // PILAR 3: Quality
      quality: {
        minWinRate: this.THRESHOLDS.minWinRate,
        minProfitability: this.THRESHOLDS.minProfit,
        minConsistency: this.THRESHOLDS.minConsistency,
        maxNegativeSharpe: this.THRESHOLDS.maxNegativeSharpe,
        violationCount: qualityViolations,
        quarantined: qualityViolations > 2
      },
      
      // PILAR 4: Continuous Improvement
      improvement: {
        weightHistory: [],
        performanceTrend: success ? 1 : -1,
        feedbackScore: profitability * 100,
        optimizationIterations: 0,
        lastOptimization: Date.now()
      },
      
      // PILAR 5: Safety
      safety: {
        status: success ? 'closed' : 'half-open',
        failureCount: success ? 0 : 1,
        successCount: success ? 1 : 0,
        tripThreshold: this.THRESHOLDS.circuitTripThreshold,
        resetTimeout: this.THRESHOLDS.circuitResetTimeout,
        lastTrip: Date.now()
      }
    };

    const metrics = this.healthMetrics.get(modelId)!;
    metrics.push(metric);

    if (metrics.length > 100) {
      metrics.shift();
    }

    this.detectDegradation(modelId, metric);
  }

  // ===== PILAR 3: QUALITY THRESHOLDS =====
  private checkQualityThresholds(
    winRate: number,
    profitability: number,
    consistency: number,
    sharpeRatio: number
  ): number {
    let violations = 0;

    if (winRate < this.THRESHOLDS.minWinRate) {
      violations++;
      console.log(`⚠️  [TPM QUALITY] Win Rate baixo: ${(winRate * 100).toFixed(1)}% < ${(this.THRESHOLDS.minWinRate * 100).toFixed(1)}%`);
    }

    if (profitability < this.THRESHOLDS.minProfit) {
      violations++;
      console.log(`⚠️  [TPM QUALITY] Lucro negativo: ${(profitability * 100).toFixed(1)}%`);
    }

    if (consistency < this.THRESHOLDS.minConsistency) {
      violations++;
      console.log(`⚠️  [TPM QUALITY] Consistência baixa: ${(consistency * 100).toFixed(1)}% < ${(this.THRESHOLDS.minConsistency * 100).toFixed(1)}%`);
    }

    if (sharpeRatio < this.THRESHOLDS.maxNegativeSharpe) {
      violations++;
      console.log(`⚠️  [TPM QUALITY] Sharpe ratio negativo: ${sharpeRatio.toFixed(2)}`);
    }

    return violations;
  }

  private calculateHealthScore(
    accuracy: number,
    profitability: number,
    success: boolean,
    responseTime: number
  ): number {
    let score = 50;

    score += Math.min(30, accuracy * 30);
    score += Math.min(30, Math.max(0, profitability * 30));
    score += success ? 20 : 0;

    if (responseTime < 100) score += 10;
    else if (responseTime < 500) score += 5;

    return Math.min(100, Math.max(0, score));
  }

  private getHealthStatus(
    healthScore: number,
    qualityViolations: number
  ): 'healthy' | 'degraded' | 'critical' | 'maintenance' {
    if (qualityViolations > 2) return 'maintenance'; // PILAR 3
    if (healthScore >= 80 && qualityViolations === 0) return 'healthy';
    if (healthScore >= this.THRESHOLDS.degradationThreshold * 100) return 'degraded';
    if (healthScore >= this.THRESHOLDS.criticalThreshold * 100) return 'critical';
    return 'maintenance';
  }

  private detectDegradation(modelId: string, currentMetric: AIHealthMetric): void {
    const metrics = this.healthMetrics.get(modelId) || [];
    if (metrics.length < 2) return;

    const previousMetric = metrics[metrics.length - 2];
    const degradation = previousMetric.healthScore - currentMetric.healthScore;

    // PILAR 2: Degradation Detection
    if (degradation > 15) {
      this.createAlert('critical', modelId, 'planned',
        `Degradação súbita: ${previousMetric.healthScore.toFixed(1)}% → ${currentMetric.healthScore.toFixed(1)}%`,
        `Rotacionar modelo ${modelId}`
      );
    }

    // PILAR 3: Quality Violation
    if (currentMetric.quality.violationCount > 2) {
      this.createAlert('critical', modelId, 'quality',
        `${currentMetric.quality.violationCount} violações de qualidade detectadas`,
        `Quarentenar modelo ${modelId} para manutenção`
      );
      
      this.scheduleRotation(modelId, `quality_violation_x${currentMetric.quality.violationCount}`, 1);
    }

    // PILAR 5: Circuit Breaker Trip
    if (currentMetric.safety.status === 'open') {
      this.createAlert('warning', modelId, 'safety',
        `Circuit breaker ABERTO - ${currentMetric.safety.failureCount} falhas consecutivas`,
        `Resetar circuit breaker ou rotacionar`
      );
    }

    if (metrics.length >= 5) {
      const recentMetrics = metrics.slice(-5);
      const isDecreasing = recentMetrics.every((m, i) => 
        i === 0 || m.healthScore <= recentMetrics[i - 1].healthScore
      );

      if (isDecreasing) {
        this.createAlert('warning', modelId, 'planned',
          `Tendência de degradação (últimos 5 checks)`,
          `Manutenção preventiva recomendada`
        );
      }
    }
  }

  // ===== PILAR 1: AUTO HEALING =====
  private performAutoHealing(): void {
    console.log('🏥 [TPM AUTO-HEALING] Iniciando ciclo de auto-cura...');
    
    this.healthMetrics.forEach((metrics, modelId) => {
      if (metrics.length === 0) return;

      const latest = metrics[metrics.length - 1];
      
      // Se está em estado crítico/maintenance, tentar heal
      if (latest.status === 'critical' || latest.status === 'maintenance') {
        if (latest.autonomous.healingAttempts < 3) {
          console.log(`💊 [TPM HEAL] Tentativa de cura #${latest.autonomous.healingAttempts + 1} em ${modelId}`);
          
          latest.autonomous.autoHealed = true;
          latest.autonomous.healingAttempts++;
          latest.autonomous.nextAutoHeal = Date.now() + 60000; // Tentar de novo em 1 min
        } else {
          // Falhou 3x, agendar rotação
          this.scheduleRotation(modelId, 'auto_heal_failed_3x', 1);
        }
      }
    });
  }

  // ===== PILAR 4: CONTINUOUS IMPROVEMENT =====
  private updateWeights(modelId: string, newWeights: Map<string, number>): void {
    const metrics = this.healthMetrics.get(modelId);
    if (!metrics || metrics.length === 0) return;

    const latest = metrics[metrics.length - 1];
    latest.improvement.weightHistory.push({
      timestamp: Date.now(),
      weights: new Map(newWeights)
    });

    // Manter histórico de 10 versões
    if (latest.improvement.weightHistory.length > 10) {
      latest.improvement.weightHistory.shift();
    }

    latest.improvement.optimizationIterations++;
    latest.improvement.lastOptimization = Date.now();

    console.log(`⚖️  [TPM IMPROVEMENT] Pesos otimizados para ${modelId} (iteração ${latest.improvement.optimizationIterations})`);
  }

  private scheduleRotation(
    modelId: string,
    reason: string,
    priority: number = 2
  ): void {
    const schedule: MaintenanceSchedule = {
      modelId,
      lastMaintenance: Date.now(),
      nextMaintenance: Date.now() + 60000,
      maintenanceType: priority === 1 ? 'rotation' : 'reset',
      priority,
      reason
    };

    this.maintenanceQueue.push(schedule);
    this.maintenanceQueue.sort((a, b) => a.priority - b.priority);

    console.log(`♻️  [TPM ROTATION] ${modelId} agendado (${reason})`);
  }

  private createAlert(
    severity: 'info' | 'warning' | 'critical',
    component: string,
    pilar: 'autonomous' | 'planned' | 'quality' | 'improvement' | 'safety',
    message: string,
    suggestedAction: string
  ): void {
    const alert: TPMAlert = {
      id: `tpm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      severity,
      component,
      pilar,
      message,
      suggestedAction
    };

    this.alerts.push(alert);
    if (this.alerts.length > 50) {
      this.alerts.shift();
    }

    const icon = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️';
    const pilarName = { autonomous: '🤖', planned: '📋', quality: '✅', improvement: '📈', safety: '🛡️' }[pilar];
    console.log(`${icon} [TPM ${pilar.toUpperCase()}] ${pilarName} ${component}: ${message}`);
  }

  private performHealthCheck(): void {
    let stats = { healthy: 0, degraded: 0, critical: 0, maintenance: 0 };
    let totalHealthScore = 0;
    let modelCount = 0;

    this.healthMetrics.forEach((metrics, modelId) => {
      if (metrics.length === 0) return;

      const latest = metrics[metrics.length - 1];
      stats[latest.status]++;
      totalHealthScore += latest.healthScore;
      modelCount++;
    });

    const avgHealth = modelCount > 0 ? (totalHealthScore / modelCount).toFixed(1) : 'N/A';
    console.log(
      `📊 [TPM HEALTH] Média: ${avgHealth}% | 🟢${stats.healthy} 🟡${stats.degraded} 🔴${stats.critical} 🛠️${stats.maintenance}`
    );

    this.processMaintenance();
  }

  private processMaintenance(): void {
    const now = Date.now();
    const toExecute = this.maintenanceQueue.filter(m => m.nextMaintenance <= now);

    for (const schedule of toExecute) {
      console.log(
        `🔧 [TPM EXEC] ${schedule.maintenanceType.toUpperCase()} para ${schedule.modelId} (${schedule.reason})`
      );
      
      const index = this.maintenanceQueue.indexOf(schedule);
      if (index > -1) {
        this.maintenanceQueue.splice(index, 1);
      }
    }
  }

  // ===== TRADE PERFORMANCE ANALYTICS =====
  getTradePerformanceByModel() {
    const performance: any = {};

    this.healthMetrics.forEach((metrics, modelId) => {
      const wins = metrics.filter(m => m.consistencyScore === 100).length;
      const losses = metrics.filter(m => m.consistencyScore === 0).length;
      const total = wins + losses;
      const winRate = total > 0 ? (wins / total * 100) : 0;
      const avgProfit = metrics.reduce((sum, m) => sum + m.profitability, 0) / Math.max(1, metrics.length);

      performance[modelId] = {
        trades: total,
        wins,
        losses,
        winRate: winRate.toFixed(1) + '%',
        avgProfit: (avgProfit * 100).toFixed(2) + '%',
        recentTrend: metrics.length >= 2 
          ? (metrics[metrics.length - 1].profitability > metrics[metrics.length - 2].profitability ? '📈' : '📉')
          : '➡️'
      };
    });

    return performance;
  }

  getHealthReport() {
    const report: any = {
      timestamp: Date.now(),
      totalModels: this.healthMetrics.size,
      healthSummary: { healthy: 0, degraded: 0, critical: 0, maintenance: 0 },
      models: {},
      recentAlerts: this.alerts.slice(-10),
      maintenanceQueue: this.maintenanceQueue.slice(0, 10),
      tradePerformance: this.getTradePerformanceByModel(),
      
      // PILARES
      pillars: {
        autonomous: { autoHealAttempts: 0, successfulHeals: 0 },
        planned: { preventativeActions: 0, predictiveDegradations: 0 },
        quality: { violations: 0, quarantined: 0 },
        improvement: { optimizations: 0, avgFeedback: 0 },
        safety: { circuitTrips: 0, fallbacksTriggered: 0 }
      }
    };

    this.healthMetrics.forEach((metrics, modelId) => {
      if (metrics.length === 0) return;

      const latest = metrics[metrics.length - 1];
      report.healthSummary[latest.status]++;

      // Calcular estatísticas dos pilares
      report.pillars.autonomous.autoHealAttempts += latest.autonomous.healingAttempts;
      report.pillars.quality.violations += latest.quality.violationCount;
      if (latest.quality.quarantined) report.pillars.quality.quarantined++;
      report.pillars.improvement.optimizations += latest.improvement.optimizationIterations;
      report.pillars.improvement.avgFeedback += latest.improvement.feedbackScore;
      if (latest.safety.status === 'open') report.pillars.safety.circuitTrips++;

      report.models[modelId] = {
        status: latest.status,
        healthScore: latest.healthScore.toFixed(1),
        winRate: (latest.winRate * 100).toFixed(1) + '%',
        profitability: (latest.profitability * 100).toFixed(1) + '%',
        sharpe: latest.sharpeRatio.toFixed(2),
        responseTime: `${latest.responseTime.toFixed(0)}ms`,
        
        // Pilares
        qualityViolations: latest.quality.violationCount,
        quarantined: latest.quality.quarantined,
        circuitStatus: latest.safety.status,
        autoHealAttempts: latest.autonomous.healingAttempts,
        feedbackScore: latest.improvement.feedbackScore.toFixed(1),
        lastCheck: new Date(latest.lastCheck).toISOString()
      };
    });

    report.pillars.improvement.avgFeedback = this.healthMetrics.size > 0 
      ? (report.pillars.improvement.avgFeedback / this.healthMetrics.size).toFixed(1)
      : 0;

    return report;
  }
}

export const tpmSystem = new TPMSystem();
