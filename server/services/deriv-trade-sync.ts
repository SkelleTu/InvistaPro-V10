/**
 * SISTEMA DE SINCRONIZAÇÃO AUTOMÁTICA DE TRADES DA DERIV
 * Sincroniza todos os trades, históricos e dados de profit/loss
 * em tempo real com o banco de dados local
 */

import { dualStorage as storage } from '../storage-dual';
import { DerivAPIService } from './deriv-api';
import { errorTracker } from './error-tracker';
import { realStatsTracker } from './real-stats-tracker';
import { advancedLearningSystem } from './advanced-learning-system';

interface DerivTradeData {
  contractId: number;
  symbol: string;
  direction: 'up' | 'down';
  amount: number;
  entryPrice?: number;
  exitPrice?: number;
  profit?: number;
  status: string;
  timestamp: number;
}

export class DerivTradeSync {
  private syncInterval: NodeJS.Timeout | null = null;
  private lastSyncTime: Map<string, number> = new Map(); // userId -> lastSync
  private syncInProgress: Set<string> = new Set(); // userId
  private readonly SYNC_INTERVAL_MS = 15000; // 🔄 ACELERADO: Sincroniza a cada 15 segundos
  private readonly CACHE_DURATION_MS = 10000; // Cache reduzido para 10 segundos (mais real-time)
  private syncApi: DerivAPIService = new DerivAPIService(); // Instância própria para não interferir com o scheduler

  constructor() {
    console.log('🔄 [DERIV SYNC] Sistema de sincronização de trades inicializado');
  }

  /**
   * Inicia a sincronização automática contínua
   */
  startAutoSync(): void {
    if (this.syncInterval) {
      console.log('⚠️ [DERIV SYNC] Sincronização já está em execução');
      return;
    }

    console.log('🚀 [DERIV SYNC] Iniciando sincronização automática...');
    this.syncInterval = setInterval(async () => {
      try {
        await this.performFullSync();
      } catch (error: any) {
        errorTracker.captureError(
          error,
          'ERROR',
          'WEBSOCKET',
          {
            requestPath: 'DERIV_SYNC_AUTO',
            requestMethod: 'performFullSync'
          }
        );
      }
    }, this.SYNC_INTERVAL_MS);
  }

  /**
   * Para a sincronização automática
   */
  stopAutoSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('⏸️ [DERIV SYNC] Sincronização automática parada');
    }
  }

  /**
   * Sincroniza trades de um usuário específico
   */
  async syncUserTrades(userId: string): Promise<{
    synced: number;
    updated: number;
    errors: string[];
  }> {
    // Evitar sincronização duplicada
    if (this.syncInProgress.has(userId)) {
      console.log(`⚠️ [DERIV SYNC] Sincronização em progresso para ${userId}`);
      return { synced: 0, updated: 0, errors: [] };
    }

    // Verificar cache
    const lastSync = this.lastSyncTime.get(userId) || 0;
    const now = Date.now();
    if (now - lastSync < this.CACHE_DURATION_MS) {
      console.log(`ℹ️ [DERIV SYNC] Cache válido para ${userId}, pulando sincronização`);
      return { synced: 0, updated: 0, errors: [] };
    }

    this.syncInProgress.add(userId);
    const result = { synced: 0, updated: 0, errors: [] as string[] };

    try {
      console.log(`🔄 [DERIV SYNC] Iniciando sincronização de trades para ${userId}...`);

      // Buscar token Deriv do usuário
      const derivToken = await storage.getUserDerivToken(userId);
      if (!derivToken || !derivToken.token) {
        result.errors.push('Nenhum token Deriv configurado');
        return result;
      }

      // Buscar operações ativas/pendentes + expiradas recentes (últimas 2h) do usuário
      // IMPORTANTE: buscar ANTES de expirar para capturar resultados reais da Deriv
      const operations = await storage.getUserTradeOperations(userId, 500);
      const pendingOps = operations.filter(op => 
        op.status === 'pending' || op.status === 'active'
      );

      // Trades expiradas sem resultado confirmado (podem ter perdido — precisamos checar)
      // Inclui profit===null (novo padrão) E profit===0 com deriv_status='expired_unresolved' (legado)
      const now = Date.now();
      const twoHoursAgo = now - 2 * 60 * 60 * 1000;
      const expiredUnconfirmed = operations.filter(op =>
        op.status === 'expired' &&
        op.derivContractId &&
        (op.profit === null || op.profit === undefined || (op.profit === 0 && op.derivStatus === 'expired_unresolved')) &&
        op.createdAt &&
        new Date(op.createdAt).getTime() > twoHoursAgo
      );

      const opsToCheck = [...pendingOps, ...expiredUnconfirmed];
      console.log(`📊 [DERIV SYNC] Encontradas ${pendingOps.length} operações pendentes + ${expiredUnconfirmed.length} expiradas sem resultado`);

      if (opsToCheck.length === 0) {
        // Limpeza automática só depois de verificar resultados
        try {
          const expired = await storage.expireOldPendingTrades(5);
          if (expired > 0) {
            console.log(`🧹 [DERIV SYNC] ${expired} trades pendentes antigos expirados automaticamente`);
          }
        } catch (cleanupError: any) {
          console.log(`⚠️ [DERIV SYNC] Erro na limpeza de trades antigos: ${cleanupError?.message}`);
        }
        return result;
      }

      // Conectar à Deriv para sincronização se não estiver conectado
      let connectedForSync = false;
      if (!this.syncApi.isApiConnected()) {
        try {
          const accountType = derivToken.accountType === 'real' ? 'real' : 'demo';
          const connected = await this.syncApi.connect(derivToken.token, accountType, `SYNC_${userId}_${Date.now()}`);
          if (connected) {
            connectedForSync = true;
            // Aguardar estabilização da conexão
            await new Promise(resolve => setTimeout(resolve, 1500));
            console.log(`🔌 [DERIV SYNC] Conexão estabelecida para sincronização`);
          } else {
            console.log(`⚠️ [DERIV SYNC] Não foi possível conectar para sincronização`);
            return result;
          }
        } catch (connError: any) {
          console.log(`⚠️ [DERIV SYNC] Erro ao conectar para sync: ${connError?.message}`);
          return result;
        }
      }

      try {
      // Buscar tabela de lucro (contratos fechados) em lote - muito mais eficiente
      let profitTableMap: Map<string, any> = new Map();
      try {
        const profitTableEntries = await this.syncApi.getProfitTable(200);
        if (profitTableEntries.length > 0) {
          for (const entry of profitTableEntries) {
            if (entry.contract_id) {
              profitTableMap.set(String(entry.contract_id), entry);
            }
          }
          console.log(`📊 [DERIV SYNC] profit_table carregada: ${profitTableEntries.length} contratos históricos`);
        }
      } catch (ptError: any) {
        console.log(`⚠️ [DERIV SYNC] Não foi possível carregar profit_table: ${ptError?.message}`);
      }

      // Para cada operação pendente + expiradas sem resultado, buscar status da Deriv
      for (const operation of opsToCheck) {
        try {
          if (!operation.derivContractId) {
            console.log(`⚠️ [DERIV SYNC] Operação ${operation.id} sem contract ID`);
            continue;
          }

          const contractIdStr = String(operation.derivContractId);

          // PASSO 1: Verificar profit_table (contratos fechados)
          const ptEntry = profitTableMap.get(contractIdStr);
          if (ptEntry) {
            const profit = ptEntry.sell_price - ptEntry.buy_price;
            const updates: any = {
              status: profit > 0 ? 'won' : profit < 0 ? 'lost' : 'closed',
              profit: profit,
              derivProfit: profit,
              derivStatus: 'closed',
              buyPrice: ptEntry.buy_price,
              sellPrice: ptEntry.sell_price || 0,
              payout: ptEntry.payout || ptEntry.sell_price || 0,
              shortcode: ptEntry.shortcode,
              exitEpoch: ptEntry.sell_time,
              entryEpoch: ptEntry.purchase_time,
              lastSyncAt: new Date().toISOString(),
              syncCount: (operation.syncCount || 0) + 1,
              statusChangedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
            };

            if (operation.status !== 'won' && operation.status !== 'lost') {
              result.updated++;
              console.log(`✅ [DERIV SYNC] [profit_table] ${operation.symbol} ${updates.status}: Profit=$${profit.toFixed(2)} | Buy=$${ptEntry.buy_price} | Sell=$${ptEntry.sell_price || 0}`);
              // Registrar resultado REAL nas estatísticas (contractId previne duplo registro)
              if (updates.status === 'won') {
                realStatsTracker.recordWin(profit, contractIdStr);
              } else if (updates.status === 'lost') {
                realStatsTracker.recordLoss(profit, operation.symbol, contractIdStr);
              }
            }

            await storage.updateTradeOperation(operation.id, updates);
            result.synced++;
            continue;
          }

          // PASSO 2: Tentar proposal_open_contract (somente para trades não expirados)
          // Trades já marcados como expired não estão abertos — pular chamada ao vivo
          if (operation.status === 'expired') {
            console.log(`⚠️ [DERIV SYNC] Trade ${operation.derivContractId} expirado sem resultado na profit_table — sem dados`);
            continue;
          }

          const contractInfo = await this.syncApi.getContractInfo(Number(operation.derivContractId));
          if (!contractInfo) {
            // Contrato não encontrado em nenhum lugar - pode ter expirado antes de ser registrado
            // Marcar como expirado após 30 tentativas de sync (>7.5 min)
            const syncCount = (operation.syncCount || 0) + 1;
            if (syncCount >= 30) {
              await storage.updateTradeOperation(operation.id, {
                status: 'expired',
                derivStatus: 'not_found',
                lastSyncAt: new Date().toISOString(),
                syncCount,
              });
              console.log(`⏰ [DERIV SYNC] Contrato ${operation.derivContractId} marcado como expirado após ${syncCount} tentativas`);
            } else {
              await storage.updateTradeOperation(operation.id, {
                lastSyncAt: new Date().toISOString(),
                syncCount,
              });
              console.log(`⚠️ [DERIV SYNC] Contrato ${operation.derivContractId} não encontrado (tentativa ${syncCount})`);
            }
            continue;
          }

          // 100% DERIV DATA SYNC - Capturar todos os campos
          const updates: any = {
            shortcode: contractInfo.shortcode,
            buyPrice: contractInfo.buy_price,
            contractType: contractInfo.contract_type,
            barrier: contractInfo.barrier,
            derivStatus: contractInfo.status,
            lastSyncAt: new Date().toISOString(),
            syncCount: (operation.syncCount || 0) + 1,
          };

          if (contractInfo.status === 'closed' || contractInfo.status === 'sold') {
            // Contrato finalizado - capturar TODOS os dados finais
            if (operation.status !== 'won' && operation.status !== 'lost') {
              const profit = contractInfo.profit || 0;
              updates.status = profit > 0 ? 'won' : profit < 0 ? 'lost' : 'closed';
              updates.profit = profit;
              updates.derivProfit = profit;
              updates.exitPrice = contractInfo.exit_tick;
              updates.sellPrice = contractInfo.sell_price;
              updates.entryEpoch = contractInfo.entry_tick_time;
              updates.exitEpoch = contractInfo.exit_tick_time;
              updates.payout = contractInfo.payout;
              updates.statusChangedAt = new Date().toISOString();
              updates.completedAt = new Date().toISOString();
              result.updated++;

              console.log(`✅ [DERIV SYNC] ${operation.symbol} ${updates.status}: Profit=$${profit.toFixed(2)} | Buy=$${contractInfo.buy_price} | Sell=$${contractInfo.sell_price || 0} | Payout=$${contractInfo.payout || 0}`);

              // Registrar resultado REAL nas estatísticas (contractId previne duplo registro)
              if (updates.status === 'won') {
                realStatsTracker.recordWin(profit, contractIdStr);
              } else if (updates.status === 'lost') {
                realStatsTracker.recordLoss(profit, operation.symbol, contractIdStr);
              }
            }
          } else if (contractInfo.status === 'open') {
            // Contrato ainda aberto - atualizar preço e época de entrada
            if (operation.status === 'pending') {
              updates.status = 'active';
              updates.statusChangedAt = new Date().toISOString();
            }
            updates.entryPrice = contractInfo.entry_tick;
            updates.entryEpoch = contractInfo.entry_tick_time;
            updates.payout = contractInfo.payout;
            console.log(`📈 [DERIV SYNC] ${operation.symbol} ativo | Entry=$${contractInfo.entry_tick} | Barrier=${contractInfo.barrier}`);
          }

          // SEMPRE salvar - garante sync 100%
          await storage.updateTradeOperation(operation.id, updates);

          result.synced++;
        } catch (error: any) {
          const msg = `Erro ao sincronizar ${operation.id}: ${error?.message || 'Erro desconhecido'}`;
          result.errors.push(msg);
          console.error(`❌ [DERIV SYNC] ${msg}`);
        }
      }

      // Limpeza automática: expirar trades pendentes irrecuperáveis (> 5 min)
      // Feito DEPOIS do scan da profit_table para não perder resultados reais
      try {
        const expiredCount = await storage.expireOldPendingTrades(5);
        if (expiredCount > 0) {
          console.log(`🧹 [DERIV SYNC] ${expiredCount} trades pendentes antigos expirados automaticamente`);
        }
      } catch (cleanupError: any) {
        console.log(`⚠️ [DERIV SYNC] Erro na limpeza de trades antigos: ${cleanupError?.message}`);
      }

      // Atualizar timestamp da última sincronização
      this.lastSyncTime.set(userId, now);

      console.log(`✅ [DERIV SYNC] Sincronização concluída para ${userId}: ${result.synced} verificados, ${result.updated} atualizados`);
      } finally {
        // Desconectar se conectamos especificamente para sync
        if (connectedForSync && this.syncApi.isApiConnected()) {
          await this.syncApi.disconnect();
          console.log(`🔌 [DERIV SYNC] Conexão de sync encerrada`);
        }
      }
    } catch (error: any) {
      const msg = `Erro geral na sincronização: ${error.message}`;
      result.errors.push(msg);
      console.error(`❌ [DERIV SYNC] ${msg}`);
    } finally {
      this.syncInProgress.delete(userId);
    }

    return result;
  }

  /**
   * Sincronização completa de todos os usuários
   */
  private async performFullSync(): Promise<void> {
    try {
      // Buscar todas as configurações ativas
      const configs = await storage.getActiveTradeConfigurations();
      const userIds = Array.from(new Set(configs.map(c => c.userId)));

      if (userIds.length === 0) {
        return;
      }

      console.log(`🔄 [DERIV SYNC] Sincronizando ${userIds.length} usuário(s)...`);

      const results: { [key: string]: any } = {};
      for (const userId of userIds) {
        results[userId] = await this.syncUserTrades(userId);
      }

      // Resumo da sincronização
      const totalSynced = Object.values(results).reduce((sum: number, r: any) => sum + r.synced, 0);
      const totalUpdated = Object.values(results).reduce((sum: number, r: any) => sum + r.updated, 0);
      
      if (totalUpdated > 0) {
        console.log(`📊 [DERIV SYNC] Resumo: ${totalSynced} verificados, ${totalUpdated} atualizados`);
      }
    } catch (error: any) {
      console.error(`❌ [DERIV SYNC] Erro na sincronização completa:`, error.message);
    }
  }

  /**
   * Força uma sincronização imediata (sem respeitar cache)
   */
  async forceSyncNow(userId?: string): Promise<void> {
    if (userId) {
      // Limpar cache para este usuário
      this.lastSyncTime.delete(userId);
      await this.syncUserTrades(userId);
    } else {
      // Sincronização forçada completa
      await this.performFullSync();
    }
  }

  /**
   * Retorna estatísticas da sincronização
   */
  getStats(): {
    syncing: number;
    lastSyncTimes: { userId: string; msAgo: number }[];
  } {
    const syncing = this.syncInProgress.size;
    const lastSyncTimes = Array.from(this.lastSyncTime.entries()).map(([userId, time]) => ({
      userId,
      msAgo: Date.now() - time
    }));

    return {
      syncing,
      lastSyncTimes: lastSyncTimes.sort((a, b) => a.msAgo - b.msAgo)
    };
  }
}

// Singleton
export const derivTradeSync = new DerivTradeSync();
