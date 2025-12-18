/**
 * SISTEMA DE SINCRONIZAÇÃO AUTOMÁTICA DE TRADES DA DERIV
 * Sincroniza todos os trades, históricos e dados de profit/loss
 * em tempo real com o banco de dados local
 */

import { storage } from '../storage';
import { derivAPI } from './deriv-api';
import { errorTracker } from './error-tracker';

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
          'DERIV_SYNC',
          {
            requestPath: 'AUTO_SYNC',
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

      // Buscar operações ativas/pendentes do usuário
      const operations = await storage.getUserTradeOperations(userId, 500);
      const pendingOps = operations.filter(op => 
        op.status === 'pending' || op.status === 'active'
      );

      console.log(`📊 [DERIV SYNC] Encontradas ${pendingOps.length} operações pendentes`);

      // Para cada operação pendente, buscar status da Deriv
      for (const operation of pendingOps) {
        try {
          if (!operation.derivContractId) {
            console.log(`⚠️ [DERIV SYNC] Operação ${operation.id} sem contract ID`);
            continue;
          }

          // Buscar informações do contrato na Deriv
          const contractInfo = await derivAPI.getContractInfo(Number(operation.derivContractId));
          if (!contractInfo) {
            console.log(`⚠️ [DERIV SYNC] Não encontrou contrato ${operation.derivContractId}`);
            continue;
          }

          // Atualizar operação se houver mudanças
          let hasChanges = false;
          const updates: any = {};

          if (contractInfo.status === 'closed' || contractInfo.status === 'sold') {
            // Contrato finalizado
            if (operation.status !== 'won' && operation.status !== 'lost') {
              const profit = contractInfo.profit || 0;
              updates.status = profit > 0 ? 'won' : profit < 0 ? 'lost' : 'closed';
              updates.profit = profit;
              updates.exitPrice = contractInfo.exit_tick;
              hasChanges = true;
              result.updated++;

              console.log(`✅ [DERIV SYNC] ${operation.symbol} ${updates.status}: $${profit.toFixed(2)}`);
            }
          } else if (contractInfo.status === 'open') {
            // Contrato ainda aberto - atualizar preço
            if (operation.status === 'pending') {
              updates.status = 'active';
              updates.entryPrice = contractInfo.entry_tick;
              hasChanges = true;
              console.log(`📈 [DERIV SYNC] ${operation.symbol} ativado`);
            }
          }

          // Salvar atualizações
          if (hasChanges) {
            await storage.updateTradeOperation(operation.id, updates);
          }

          result.synced++;
        } catch (error: any) {
          const msg = `Erro ao sincronizar ${operation.id}: ${error?.message || 'Erro desconhecido'}`;
          result.errors.push(msg);
          console.error(`❌ [DERIV SYNC] ${msg}`);
        }
      }

      // Atualizar timestamp da última sincronização
      this.lastSyncTime.set(userId, now);

      console.log(`✅ [DERIV SYNC] Sincronização concluída para ${userId}: ${result.synced} verificados, ${result.updated} atualizados`);
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
      const userIds = [...new Set(configs.map(c => c.userId))];

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
