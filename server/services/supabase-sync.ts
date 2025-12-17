import { createClient, SupabaseClient } from '@supabase/supabase-js';

class SupabaseSyncService {
  private client: SupabaseClient | null = null;
  private isConnected = false;
  private syncQueue: Array<{ table: string; operation: 'upsert' | 'delete'; data: any }> = [];
  private syncInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initialize();
  }

  private initialize() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.warn('⚠️ SUPABASE_URL ou SUPABASE_ANON_KEY não configurados.');
      console.warn('📋 Configure as variáveis de ambiente para ativar sincronização com Supabase');
      return;
    }

    try {
      this.client = createClient(supabaseUrl, supabaseKey);
      this.isConnected = true;
      console.log('✅ Supabase conectado - Sincronização em tempo real ativada');
      
      this.startSyncQueue();
    } catch (error) {
      console.error('❌ Erro ao conectar Supabase:', error);
      this.isConnected = false;
    }
  }

  private startSyncQueue() {
    this.syncInterval = setInterval(async () => {
      if (this.syncQueue.length > 0 && this.client) {
        const batch = [...this.syncQueue];
        this.syncQueue = [];
        
        for (const item of batch) {
          try {
            await this.executeSyncOperation(item);
          } catch (error) {
            console.error(`❌ Erro ao sincronizar ${item.table}:`, error);
            this.syncQueue.push(item);
          }
        }
      }
    }, 1000);
  }

  private async executeSyncOperation(item: { table: string; operation: 'upsert' | 'delete'; data: any }) {
    if (!this.client) return;

    if (item.operation === 'upsert') {
      const { error } = await this.client
        .from(item.table)
        .upsert(item.data, { onConflict: 'id' });
      
      if (error) {
        if (error.code === '42P01') {
          console.warn(`⚠️ Tabela ${item.table} não existe no Supabase - crie-a primeiro`);
        } else {
          throw error;
        }
      } else {
        console.log(`🔄 [Supabase] Sincronizado ${item.table}: ${item.data.id}`);
      }
    } else if (item.operation === 'delete') {
      const { error } = await this.client
        .from(item.table)
        .delete()
        .eq('id', item.data.id);
      
      if (error && error.code !== '42P01') {
        throw error;
      }
    }
  }

  isActive(): boolean {
    return this.isConnected && this.client !== null;
  }

  async syncUser(userData: any) {
    if (!this.isActive()) return;
    
    const sanitizedData = this.sanitizeUserData(userData);
    this.syncQueue.push({
      table: 'users',
      operation: 'upsert',
      data: sanitizedData
    });
  }

  async syncMovimento(movimento: any) {
    if (!this.isActive()) return;
    
    this.syncQueue.push({
      table: 'movimentos',
      operation: 'upsert',
      data: this.sanitizeData(movimento)
    });
  }

  async syncDocumento(documento: any) {
    if (!this.isActive()) return;
    
    this.syncQueue.push({
      table: 'documentos',
      operation: 'upsert',
      data: this.sanitizeData(documento)
    });
  }

  async syncTradeOperation(operation: any) {
    if (!this.isActive()) return;
    
    this.syncQueue.push({
      table: 'trade_operations',
      operation: 'upsert',
      data: this.sanitizeData(operation)
    });
  }

  async syncTradeConfig(config: any) {
    if (!this.isActive()) return;
    
    this.syncQueue.push({
      table: 'trade_configurations',
      operation: 'upsert',
      data: this.sanitizeData(config)
    });
  }

  async syncDailyPnl(pnl: any) {
    if (!this.isActive()) return;
    
    this.syncQueue.push({
      table: 'daily_pnl',
      operation: 'upsert',
      data: this.sanitizeData(pnl)
    });
  }

  private sanitizeUserData(user: any): any {
    const { passwordHash, senhaFallback, codigoVerificacao, passwordResetToken, ...safeData } = user;
    return this.sanitizeData(safeData);
  }

  private sanitizeData(data: any): any {
    const result: any = {};
    
    for (const [key, value] of Object.entries(data)) {
      const snakeKey = this.camelToSnake(key);
      
      if (typeof value === 'boolean') {
        result[snakeKey] = value;
      } else if (value === null || value === undefined) {
        result[snakeKey] = null;
      } else {
        result[snakeKey] = value;
      }
    }
    
    return result;
  }

  private camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }

  async testConnection(): Promise<boolean> {
    if (!this.client) return false;
    
    try {
      const { data, error } = await this.client.from('users').select('id').limit(1);
      if (error && error.code === '42P01') {
        console.log('⚠️ Tabela users não existe no Supabase - precisa criar as tabelas');
        return true;
      }
      return !error;
    } catch {
      return false;
    }
  }

  async getAllUsersFromSupabase(): Promise<any[]> {
    if (!this.client) return [];
    
    try {
      const { data, error } = await this.client.from('users').select('*');
      if (error) {
        console.error('❌ Erro ao buscar usuários do Supabase:', error);
        return [];
      }
      return data || [];
    } catch {
      return [];
    }
  }

  getStatus(): { connected: boolean; queueSize: number } {
    return {
      connected: this.isConnected,
      queueSize: this.syncQueue.length
    };
  }

  stop() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
  }
}

export const supabaseSync = new SupabaseSyncService();
