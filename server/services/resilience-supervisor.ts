import { EventEmitter } from 'events';
import { dualStorage as storage } from '../storage-dual';
import { errorTracker } from './error-tracker';

export interface ComponentHealth {
  componentName: string;
  isHealthy: boolean;
  lastHeartbeat: Date;
  errorCount: number;
  lastError?: string;
}

export interface RestartPolicy {
  maxRestarts: number;
  restartWindow: number; // milliseconds
  backoffMultiplier: number;
}

export class ResilienceSupervisor extends EventEmitter {
  private monitoringInterval: NodeJS.Timeout | null = null;
  private heartbeatTimeout: number = 90000; // 90 seconds (1.5x heartbeat interval)
  private checkInterval: number = 30000; // Check every 30 seconds
  private restartHistory: Map<string, number[]> = new Map();
  private isRunning: boolean = false;
  
  private readonly COMPONENT_NAMES = {
    SCHEDULER: 'scheduler',
    WEBSOCKET: 'websocket',
    MARKET_COLLECTOR: 'market_collector',
  };

  private defaultRestartPolicy: RestartPolicy = {
    maxRestarts: 5,
    restartWindow: 300000, // 5 minutes
    backoffMultiplier: 1.5,
  };

  constructor() {
    super();
    console.log('🛡️ ResilienceSupervisor inicializado');
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('⚠️ ResilienceSupervisor já está rodando');
      return;
    }

    this.isRunning = true;
    console.log('🚀 Iniciando ResilienceSupervisor...');
    
    // Recuperar sessões ativas (não apagar subscrições - elas serão usadas na reconexão)
    await this.recoverActiveSessions();

    // Iniciar monitoramento de saúde
    this.startHealthMonitoring();

    console.log('✅ ResilienceSupervisor ativo e monitorando componentes');
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    console.log('🛑 ResilienceSupervisor parado');
  }

  private startHealthMonitoring(): void {
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.checkComponentsHealth();
      } catch (error) {
        console.error('❌ Erro no monitoramento de saúde:', error);
      }
    }, this.checkInterval);

    console.log(`💓 Monitoramento de saúde iniciado (verificação a cada ${this.checkInterval/1000}s)`);
  }

  private async checkComponentsHealth(): Promise<void> {
    const components = [
      this.COMPONENT_NAMES.SCHEDULER,
      this.COMPONENT_NAMES.WEBSOCKET,
      this.COMPONENT_NAMES.MARKET_COLLECTOR,
    ];

    for (const componentName of components) {
      try {
        const health = await this.getComponentHealth(componentName);
        
        if (!health.isHealthy) {
          console.warn(`⚠️ Componente ${componentName} não está saudável`);
          console.warn(`   Último heartbeat: ${health.lastHeartbeat}`);
          console.warn(`   Erros: ${health.errorCount}`);
          
          // Tentar restart do componente
          await this.attemptComponentRestart(componentName, health);
        }
      } catch (error) {
        console.error(`❌ Erro ao verificar saúde de ${componentName}:`, error);
      }
    }
  }

  private async getComponentHealth(componentName: string): Promise<ComponentHealth> {
    const heartbeat = await storage.getSystemHeartbeat(componentName);

    if (!heartbeat) {
      // Componente nunca enviou heartbeat - considerar não-saudável
      console.warn(`⚠️ [HEALTH] ${componentName}: Sem heartbeat`);
      return {
        componentName,
        isHealthy: false,
        lastHeartbeat: new Date(0),
        errorCount: 0,
      };
    }

    const lastHeartbeatTime = new Date(heartbeat.lastHeartbeat).getTime();
    const now = Date.now();
    const timeSinceLastHeartbeat = now - lastHeartbeatTime;
    
    // Para scheduler: se não tiver heartbeat recente, marcar como não-saudável
    const isHealthy = timeSinceLastHeartbeat < this.heartbeatTimeout && 
                      heartbeat.status === 'healthy';
    
    if (!isHealthy && componentName === this.COMPONENT_NAMES.SCHEDULER) {
      console.warn(`⚠️ [HEALTH] Scheduler: ${timeSinceLastHeartbeat}ms desde último heartbeat (timeout: ${this.heartbeatTimeout}ms)`);
    }

    return {
      componentName: heartbeat.componentName,
      isHealthy,
      lastHeartbeat: new Date(heartbeat.lastHeartbeat),
      errorCount: heartbeat.errorCount,
      lastError: heartbeat.lastError || undefined,
    };
  }

  private async attemptComponentRestart(
    componentName: string, 
    health: ComponentHealth
  ): Promise<void> {
    // Verificar política de restart
    if (!this.canRestart(componentName)) {
      console.error(`🚫 Componente ${componentName} excedeu limite de restarts`);
      console.error(`   Intervenção manual necessária`);
      
      // Emitir evento crítico
      this.emit('critical_failure', {
        componentName,
        health,
        reason: 'Max restarts exceeded',
      });
      
      return;
    }

    console.log(`🔄 Tentando reiniciar componente: ${componentName}`);
    
    try {
      // Registrar tentativa de restart
      this.recordRestart(componentName);
      
      // Emitir evento de restart
      this.emit('component_restart', {
        componentName,
        reason: 'Health check failed',
        health,
      });

      // Restart específico por componente
      await this.restartComponent(componentName);

      // Resetar contadores de erro após restart bem-sucedido
      await storage.resetHeartbeatErrors(componentName);
      
      console.log(`✅ Componente ${componentName} reiniciado com sucesso`);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`❌ Falha ao reiniciar ${componentName}:`, errorMessage);
      
      // Incrementar contador de erros
      await storage.incrementHeartbeatError(componentName, errorMessage);
      
      // Capturar erro
      errorTracker.captureError(
        error instanceof Error ? error : new Error(errorMessage),
        'ERROR',
        'UNKNOWN',
        {
          requestPath: 'COMPONENT_RESTART',
          requestMethod: 'RESTART',
          requestBody: {
            componentName,
            health,
          },
        }
      );
    }
  }

  private async restartComponent(componentName: string): Promise<void> {
    switch (componentName) {
      case this.COMPONENT_NAMES.SCHEDULER:
        await this.restartScheduler();
        break;
      case this.COMPONENT_NAMES.WEBSOCKET:
        await this.restartWebSocket();
        break;
      case this.COMPONENT_NAMES.MARKET_COLLECTOR:
        await this.restartMarketCollector();
        break;
      default:
        throw new Error(`Componente desconhecido: ${componentName}`);
    }
  }

  private async restartScheduler(): Promise<void> {
    console.log('🔄 Reiniciando AutoTradingScheduler...');
    
    // O scheduler será reiniciado através do evento
    // A implementação específica será adicionada no próximo commit
    this.emit('restart_scheduler');
  }

  private async restartWebSocket(): Promise<void> {
    console.log('🔄 Reiniciando WebSocket connections...');
    
    // WebSocket será reiniciado através do evento
    this.emit('restart_websocket');
  }

  private async restartMarketCollector(): Promise<void> {
    console.log('🔄 Reiniciando MarketDataCollector...');
    
    // Market collector será reiniciado através do evento
    this.emit('restart_market_collector');
  }

  private canRestart(componentName: string): boolean {
    const history = this.restartHistory.get(componentName) || [];
    const now = Date.now();
    
    // Remover restarts fora da janela
    const recentRestarts = history.filter(
      timestamp => now - timestamp < this.defaultRestartPolicy.restartWindow
    );
    
    return recentRestarts.length < this.defaultRestartPolicy.maxRestarts;
  }

  private recordRestart(componentName: string): void {
    const history = this.restartHistory.get(componentName) || [];
    history.push(Date.now());
    
    // Manter apenas restarts recentes
    const now = Date.now();
    const recentRestarts = history.filter(
      timestamp => now - timestamp < this.defaultRestartPolicy.restartWindow
    );
    
    this.restartHistory.set(componentName, recentRestarts);
  }

  private async recoverActiveSessions(): Promise<void> {
    console.log('🔍 Recuperando sessões ativas do banco de dados...');
    
    try {
      const activeSessions = await storage.getAllActiveTradingSessions();
      
      if (activeSessions.length > 0) {
        console.log(`✅ Encontradas ${activeSessions.length} sessões ativas para recuperar`);
        
        // Emitir evento para que o scheduler recupere as sessões
        this.emit('recover_sessions', activeSessions);
      } else {
        console.log('ℹ️ Nenhuma sessão ativa encontrada para recuperar');
      }
    } catch (error) {
      console.error('❌ Erro ao recuperar sessões ativas:', error);
    }
  }

  // Método para componentes reportarem heartbeat
  async reportHeartbeat(
    componentName: string,
    metadata?: any
  ): Promise<void> {
    try {
      await storage.updateSystemHeartbeat(
        componentName,
        'healthy',
        metadata
      );
    } catch (error) {
      console.error(`❌ Erro ao reportar heartbeat de ${componentName}:`, error);
    }
  }

  // Método para componentes reportarem erros
  async reportError(
    componentName: string,
    error: Error | string
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : error;
    
    try {
      await storage.incrementHeartbeatError(componentName, errorMessage);
      
      console.warn(`⚠️ Erro reportado por ${componentName}: ${errorMessage}`);
    } catch (err) {
      console.error(`❌ Erro ao reportar erro de ${componentName}:`, err);
    }
  }

  // Obter status de todos os componentes
  async getSystemStatus(): Promise<ComponentHealth[]> {
    const components = [
      this.COMPONENT_NAMES.SCHEDULER,
      this.COMPONENT_NAMES.WEBSOCKET,
      this.COMPONENT_NAMES.MARKET_COLLECTOR,
    ];

    const healthStatuses: ComponentHealth[] = [];

    for (const componentName of components) {
      try {
        const health = await this.getComponentHealth(componentName);
        healthStatuses.push(health);
      } catch (error) {
        healthStatuses.push({
          componentName,
          isHealthy: false,
          lastHeartbeat: new Date(0),
          errorCount: 999,
          lastError: 'Failed to check health',
        });
      }
    }

    return healthStatuses;
  }

  // Método para forçar restart de um componente
  async forceRestart(componentName: string): Promise<void> {
    console.log(`🔄 Restart forçado solicitado para: ${componentName}`);
    
    try {
      await this.restartComponent(componentName);
      await storage.resetHeartbeatErrors(componentName);
      
      console.log(`✅ Restart forçado completado para: ${componentName}`);
    } catch (error) {
      console.error(`❌ Falha no restart forçado de ${componentName}:`, error);
      throw error;
    }
  }
}

// Singleton instance
export const resilienceSupervisor = new ResilienceSupervisor();
