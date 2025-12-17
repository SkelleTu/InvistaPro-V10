import * as cron from 'node-cron';
import fetch from 'node-fetch';

interface KeepAliveStatus {
  isActive: boolean;
  lastPingReceived: Date | null;
  lastPingSent: Date | null;
  totalPingsReceived: number;
  totalPingsSent: number;
  vercelUrl: string | null;
  uptimeSeconds: number;
  startTime: Date;
}

class KeepAliveSystem {
  private status: KeepAliveStatus;
  private pingJob: cron.ScheduledTask | null = null;
  private uptimeInterval: NodeJS.Timeout | null = null;
  private readonly PING_INTERVAL = '*/4 * * * *'; // A cada 4 minutos
  private static instance: KeepAliveSystem | null = null;

  constructor() {
    this.status = {
      isActive: false,
      lastPingReceived: null,
      lastPingSent: null,
      totalPingsReceived: 0,
      totalPingsSent: 0,
      vercelUrl: process.env.VERCEL_URL || null,
      uptimeSeconds: 0,
      startTime: new Date()
    };
  }

  static getInstance(): KeepAliveSystem {
    if (!KeepAliveSystem.instance) {
      KeepAliveSystem.instance = new KeepAliveSystem();
    }
    return KeepAliveSystem.instance;
  }

  start(): void {
    if (this.status.isActive) {
      console.log('⚡ KeepAlive já está ativo');
      return;
    }

    // Limpar timers anteriores se existirem
    this.cleanup();

    this.status.isActive = true;
    this.status.startTime = new Date();

    console.log('🔌 Sistema Keep-Alive iniciado');
    console.log('   • Intervalo de ping: a cada 4 minutos');
    console.log('   • Vercel URL:', this.status.vercelUrl || 'Não configurada');
    console.log('   ⚠️ Para 24/7 gratuito, configure cron-job.org ou UptimeRobot');

    // Ping para Vercel a cada 4 minutos (se configurado)
    this.pingJob = cron.schedule(this.PING_INTERVAL, () => {
      this.pingVercel();
    });

    // Atualizar uptime a cada segundo (guardando referência)
    this.uptimeInterval = setInterval(() => {
      this.status.uptimeSeconds = Math.floor((Date.now() - this.status.startTime.getTime()) / 1000);
    }, 1000);

    console.log('✅ Sistema Keep-Alive 24/7 ATIVO!');
  }

  private cleanup(): void {
    if (this.pingJob) {
      this.pingJob.stop();
      this.pingJob = null;
    }
    if (this.uptimeInterval) {
      clearInterval(this.uptimeInterval);
      this.uptimeInterval = null;
    }
  }

  stop(): void {
    this.cleanup();
    this.status.isActive = false;
    console.log('🛑 Sistema Keep-Alive parado');
  }

  async pingVercel(): Promise<boolean> {
    const vercelUrl = this.status.vercelUrl;
    
    if (!vercelUrl) {
      console.log('⚠️ VERCEL_URL não configurada - ping não enviado');
      return false;
    }

    try {
      const pingUrl = vercelUrl.startsWith('http') 
        ? `${vercelUrl}/api/ping` 
        : `https://${vercelUrl}/api/ping`;
      
      console.log(`📤 Enviando ping para Vercel: ${pingUrl}`);
      
      const response = await fetch(pingUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Ping-From': 'replit',
          'X-Timestamp': new Date().toISOString()
        },
        body: JSON.stringify({
          source: 'replit',
          timestamp: Date.now(),
          uptime: this.status.uptimeSeconds
        })
      });

      if (response.ok) {
        this.status.lastPingSent = new Date();
        this.status.totalPingsSent++;
        console.log(`✅ Ping enviado para Vercel com sucesso | Total: ${this.status.totalPingsSent}`);
        return true;
      } else {
        console.log(`⚠️ Vercel respondeu com status: ${response.status}`);
        return false;
      }
    } catch (error) {
      console.log('⚠️ Erro ao pingar Vercel (pode estar em deploy):', (error as Error).message);
      return false;
    }
  }

  receivePing(source: string): { success: boolean; message: string; status: any } {
    this.status.lastPingReceived = new Date();
    this.status.totalPingsReceived++;
    
    console.log(`📥 Ping recebido de: ${source} | Total: ${this.status.totalPingsReceived}`);
    
    return {
      success: true,
      message: `Ping recebido com sucesso de ${source}`,
      status: this.getStatus()
    };
  }

  setVercelUrl(url: string): void {
    this.status.vercelUrl = url;
    console.log(`🔗 Vercel URL configurada: ${url}`);
  }

  getStatus(): any {
    const now = new Date();
    const uptime = this.status.uptimeSeconds;
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;

    return {
      isActive: this.status.isActive,
      uptime: `${hours}h ${minutes}m ${seconds}s`,
      uptimeSeconds: uptime,
      startTime: this.status.startTime.toISOString(),
      lastPingReceived: this.status.lastPingReceived?.toISOString() || null,
      lastPingSent: this.status.lastPingSent?.toISOString() || null,
      totalPingsReceived: this.status.totalPingsReceived,
      totalPingsSent: this.status.totalPingsSent,
      vercelUrl: this.status.vercelUrl,
      serverTime: now.toISOString(),
      nextPingIn: this.getNextPingTime()
    };
  }

  private getNextPingTime(): string {
    const now = new Date();
    const nextMinute = Math.ceil(now.getMinutes() / 4) * 4;
    const nextPing = new Date(now);
    nextPing.setMinutes(nextMinute, 0, 0);
    
    if (nextPing <= now) {
      nextPing.setMinutes(nextPing.getMinutes() + 4);
    }
    
    const diffMs = nextPing.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffSecs = Math.floor((diffMs % 60000) / 1000);
    
    return `${diffMins}m ${diffSecs}s`;
  }
}

export const keepAliveSystem = KeepAliveSystem.getInstance();
