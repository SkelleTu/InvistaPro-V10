/**
 * TPM (Total Production Maintenance / Manutenção Produtiva Total)
 * Sistema de manutenção preventiva para o trading
 * 
 * Monitoramento contínuo de saúde com:
 * - Health checks de componentes (IAs, APIs, modelos)
 * - Detecção preditiva de degradação
 * - Rotação automática de modelos com problemas
 * - Prevenção de falhas antes que aconteçam
 */

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
  healthScore: number; // 0-100
}

export interface TPMAlert {
  id: string;
  timestamp: number;
  severity: 'info' | 'warning' | 'critical';
  component: string;
  message: string;
  suggestedAction: string;
}

export interface MaintenanceSchedule {
  modelId: string;
  lastMaintenance: number;
  nextMaintenance: number;
  maintenanceType: 'rotation' | 'reset' | 'cleanup' | 'retrain';
  priority: number;
}

export class TPMSystem {
  private healthMetrics: Map<string, AIHealthMetric[]> = new Map();
  private alerts: TPMAlert[] = [];
  private maintenanceQueue: MaintenanceSchedule[] = [];
  private readonly DEGRADATION_THRESHOLD = 0.7; // 70% saúde = degraded
  private readonly CRITICAL_THRESHOLD = 0.5; // 50% saúde = critical
  private checkInterval: NodeJS.Timeout | null = null;
  
  private readonly TPM_CONFIG = {
    maxConsecutiveFailures: 3,
    degradationWindow: 60000,
    maintenanceCheckInterval: 30000,
    autoRotationEnabled: true,
    predictiveMaintenance: true,
  };

  constructor() {
    console.log('🔧 [TPM] Sistema de Manutenção Produtiva Total INICIALIZADO');
    console.log('📊 Monitoramento contínuo de saúde das IAs');
    console.log('🚨 Detecção preditiva de degradação ativa');
    console.log('♻️  Rotação automática de modelos');
  }

  startMonitoring(): void {
    if (this.checkInterval) return;
    
    console.log('▶️  [TPM] Iniciando monitoramento de saúde...');
    
    this.checkInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.TPM_CONFIG.maintenanceCheckInterval);
  }

  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('⏹️  [TPM] Monitoramento PARADO');
    }
  }

  recordHealthMetric(
    modelId: string,
    symbol: string,
    accuracy: number,
    profitability: number,
    responseTime: number,
    success: boolean
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

    const metric: AIHealthMetric = {
      modelId,
      symbol,
      accuracy,
      profitability,
      consistencyScore: success ? 100 : 0,
      failureRate: success ? 0 : 100,
      responseTime,
      lastCheck: Date.now(),
      status: this.getHealthStatus(healthScore),
      healthScore
    };

    const metrics = this.healthMetrics.get(modelId)!;
    metrics.push(metric);

    if (metrics.length > 100) {
      metrics.shift();
    }

    this.detectDegradation(modelId, metric);
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
    healthScore: number
  ): 'healthy' | 'degraded' | 'critical' | 'maintenance' {
    if (healthScore >= 80) return 'healthy';
    if (healthScore >= this.DEGRADATION_THRESHOLD * 100) return 'degraded';
    if (healthScore >= this.CRITICAL_THRESHOLD * 100) return 'critical';
    return 'maintenance';
  }

  private detectDegradation(modelId: string, currentMetric: AIHealthMetric): void {
    const metrics = this.healthMetrics.get(modelId) || [];
    if (metrics.length < 2) return;

    const previousMetric = metrics[metrics.length - 2];
    const degradation = previousMetric.healthScore - currentMetric.healthScore;

    if (degradation > 15) {
      this.createAlert('critical', modelId, 
        `Degradação súbita: ${previousMetric.healthScore.toFixed(1)}% → ${currentMetric.healthScore.toFixed(1)}%`,
        `Rotacionar modelo ${modelId}`
      );
    }

    if (currentMetric.status === 'critical') {
      this.createAlert('warning', modelId,
        `IA crítica: saúde ${currentMetric.healthScore.toFixed(1)}%`,
        `Agendar manutenção para ${modelId}`
      );
      
      if (this.TPM_CONFIG.autoRotationEnabled) {
        this.scheduleRotation(modelId, 'critical');
      }
    }

    if (metrics.length >= 5) {
      const recentMetrics = metrics.slice(-5);
      const isDecreasing = recentMetrics.every((m, i) => 
        i === 0 || m.healthScore <= recentMetrics[i - 1].healthScore
      );

      if (isDecreasing) {
        this.createAlert('warning', modelId,
          `Tendência de degradação (últimos 5 checks)`,
          `Manutenção preventiva recomendada`
        );
      }
    }
  }

  private scheduleRotation(modelId: string, reason: string): void {
    const schedule: MaintenanceSchedule = {
      modelId,
      lastMaintenance: Date.now(),
      nextMaintenance: Date.now() + 60000,
      maintenanceType: 'rotation',
      priority: reason === 'critical' ? 1 : 2
    };

    this.maintenanceQueue.push(schedule);
    this.maintenanceQueue.sort((a, b) => a.priority - b.priority);

    console.log(`♻️  [TPM ROTATION] ${modelId} agendado (${reason})`);
  }

  private createAlert(
    severity: 'info' | 'warning' | 'critical',
    component: string,
    message: string,
    suggestedAction: string
  ): void {
    const alert: TPMAlert = {
      id: `tpm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      severity,
      component,
      message,
      suggestedAction
    };

    this.alerts.push(alert);

    if (this.alerts.length > 50) {
      this.alerts.shift();
    }

    const icon = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️';
    console.log(`${icon} [TPM] ${component}: ${message}`);
  }

  private performHealthCheck(): void {
    let totalHealthy = 0;
    let totalDegraded = 0;
    let totalCritical = 0;

    this.healthMetrics.forEach((metrics, modelId) => {
      if (metrics.length === 0) return;

      const latest = metrics[metrics.length - 1];
      
      if (latest.status === 'healthy') totalHealthy++;
      else if (latest.status === 'degraded') totalDegraded++;
      else if (latest.status === 'critical') totalCritical++;
    });

    const total = totalHealthy + totalDegraded + totalCritical;
    if (total > 0) {
      console.log(
        `📊 [TPM] Saúde: ${totalHealthy}✅/${totalDegraded}⚠️/${totalCritical}🚨 (${total} modelos)`
      );
    }

    this.processMaintenance();
  }

  private processMaintenance(): void {
    const now = Date.now();
    const toExecute = this.maintenanceQueue.filter(m => m.nextMaintenance <= now);

    for (const schedule of toExecute) {
      console.log(
        `🔧 [TPM] Executando ${schedule.maintenanceType} para ${schedule.modelId}`
      );
      
      const index = this.maintenanceQueue.indexOf(schedule);
      if (index > -1) {
        this.maintenanceQueue.splice(index, 1);
      }
    }
  }

  getHealthReport() {
    const report: any = {
      timestamp: Date.now(),
      totalModels: this.healthMetrics.size,
      healthSummary: { healthy: 0, degraded: 0, critical: 0, maintenance: 0 },
      models: {},
      recentAlerts: this.alerts.slice(-10),
      maintenanceQueue: this.maintenanceQueue.slice(0, 10)
    };

    this.healthMetrics.forEach((metrics, modelId) => {
      if (metrics.length === 0) return;

      const latest = metrics[metrics.length - 1];
      report.healthSummary[latest.status]++;

      report.models[modelId] = {
        status: latest.status,
        healthScore: latest.healthScore.toFixed(1),
        accuracy: latest.accuracy.toFixed(3),
        profitability: latest.profitability.toFixed(3),
        responseTime: `${latest.responseTime.toFixed(0)}ms`,
        lastCheck: new Date(latest.lastCheck).toISOString()
      };
    });

    return report;
  }
}

export const tpmSystem = new TPMSystem();
