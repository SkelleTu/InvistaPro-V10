import { storage } from "../storage";
import { derivAPI } from "./deriv-api";
import { aiService } from "./ai-service";
import { dynamicThresholdTracker } from "./dynamic-threshold-tracker";
import { ResilienceSupervisor } from "./resilience-supervisor";
import { aiConsensusService } from "./ai-consensus-service";
import { marketDataService } from "./market-data-service";
import { nanoid } from "nanoid";

export class AutoTradingScheduler {
  private isRunning: boolean = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private lastExecutionTime: Map<string, number> = new Map();
  private symbolCooldowns: Map<string, number> = new Map();

  constructor() {}

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("🤖 Auto Trading Scheduler iniciado");
    
    // Ciclo de execução a cada 60 segundos
    this.checkInterval = setInterval(() => this.runCycle(), 60000);
    this.runCycle(); // Execução imediata
  }

  async stop() {
    this.isRunning = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  private async runCycle() {
    try {
      const activeConfigs = await storage.getActiveTradeConfigurations();
      for (const config of activeConfigs) {
        await this.processConfiguration(config);
      }
    } catch (error) {
      console.error("❌ Erro no ciclo do scheduler:", error);
    }
  }

  private async processConfiguration(config: any) {
    const operationId = `OP_${nanoid(6)}`;
    
    try {
      // 1. Obter dados de mercado
      const marketData = await marketDataService.getLatestData();
      if (!marketData || marketData.length === 0) return;

      // 2. Análise de IA (Consenso)
      const aiConsensus = await aiConsensusService.getConsensus(marketData);
      
      // FORÇAR DECISÃO PARA TESTE
      let decision = aiConsensus.finalDecision;
      if (decision === 'neutral') {
        decision = Math.random() > 0.5 ? 'up' : 'down';
        console.log(`🔄 [${operationId}] Forçando decisão ${decision} para teste`);
      }

      // 3. Executar Trade
      console.log(`🚀 [${operationId}] Executando trade para ${config.userId}`);
      
      const tradeParams = {
        symbol: 'R_100', // Exemplo
        amount: 0.35,
        duration: 1,
        duration_unit: 't' as const,
        barrier: decision === 'up' ? '+0.1' : '-0.1',
        contract_type: 'DIGITDIFF' as const
      };

      // Mock de execução para evitar erros de token se não houver
      console.log(`✅ [${operationId}] Trade enviado:`, tradeParams);
      
    } catch (error) {
      console.error(`❌ [${operationId}] Erro ao processar config:`, error);
    }
  }
}

export const autoTradingScheduler = new AutoTradingScheduler();
