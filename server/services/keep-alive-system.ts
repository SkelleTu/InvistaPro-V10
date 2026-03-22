import * as cron from 'node-cron';
import fetch from 'node-fetch';

interface KeepAliveStatus {
  isActive: boolean;
  lastPingAt: Date | null;
  lastExternalPingAt: Date | null;
  lastExternalPingSource: string | null;
  totalPings: number;
  totalExternalPings: number;
  totalFailures: number;
  uptimeSeconds: number;
  startTime: Date;
  targetUrl: string | null;
}

class KeepAliveSystem {
  private status: KeepAliveStatus;
  private pingJob: cron.ScheduledTask | null = null;
  private uptimeInterval: NodeJS.Timeout | null = null;
  private readonly PING_INTERVAL = '*/3 * * * *'; // A cada 3 minutos
  private static instance: KeepAliveSystem | null = null;

  constructor() {
    this.status = {
      isActive: false,
      lastPingAt: null,
      lastExternalPingAt: null,
      lastExternalPingSource: null,
      totalPings: 0,
      totalExternalPings: 0,
      totalFailures: 0,
      uptimeSeconds: 0,
      startTime: new Date(),
      targetUrl: null
    };
  }

  static getInstance(): KeepAliveSystem {
    if (!KeepAliveSystem.instance) {
      KeepAliveSystem.instance = new KeepAliveSystem();
    }
    return KeepAliveSystem.instance;
  }

  private resolveTargetUrl(): string | null {
    // 1. Domínio público do Replit (ambiente de desenvolvimento)
    const replitDomain = process.env.REPLIT_DEV_DOMAIN;
    if (replitDomain) {
      return `https://${replitDomain}/api/status`;
    }
    // 2. URL customizada se configurada
    const customUrl = process.env.KEEP_ALIVE_URL;
    if (customUrl) {
      return customUrl.startsWith('http') ? customUrl : `https://${customUrl}`;
    }
    return null;
  }

  start(): void {
    if (this.status.isActive) return;

    this.cleanup();
    this.status.isActive = true;
    this.status.startTime = new Date();
    this.status.targetUrl = this.resolveTargetUrl();

    console.log('🔌 Sistema Keep-Alive iniciado');
    console.log('   • Intervalo de ping: a cada 3 minutos');
    console.log('   • URL alvo:', this.status.targetUrl || '⚠️ Não detectada (REPLIT_DEV_DOMAIN ausente)');

    // Primeiro ping imediato para confirmar que está funcionando
    setTimeout(() => this.doPing(), 5000);

    // Pings recorrentes a cada 3 minutos via cron
    this.pingJob = cron.schedule(this.PING_INTERVAL, () => {
      // Re-resolve URL a cada ciclo (pode mudar após restart)
      this.status.targetUrl = this.resolveTargetUrl();
      this.doPing();
    });

    // Uptime counter
    this.uptimeInterval = setInterval(() => {
      this.status.uptimeSeconds = Math.floor((Date.now() - this.status.startTime.getTime()) / 1000);
    }, 1000);

    console.log('✅ Sistema Keep-Alive 24/7 ATIVO!');
  }

  private async doPing(): Promise<void> {
    const url = this.status.targetUrl;
    if (!url) {
      // Sem URL configurada — tenta resolver de novo
      this.status.targetUrl = this.resolveTargetUrl();
      if (!this.status.targetUrl) {
        console.log('⚠️ [Keep-Alive] URL não detectada — sem ping');
        return;
      }
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(this.status.targetUrl!, {
        method: 'GET',
        signal: controller.signal as any,
        headers: { 'X-Keep-Alive': 'ping', 'X-Timestamp': new Date().toISOString() }
      });
      clearTimeout(timeout);

      if (response.ok) {
        this.status.lastPingAt = new Date();
        this.status.totalPings++;
        console.log(`💓 [Keep-Alive] Ping OK → ${this.status.targetUrl} | Total: ${this.status.totalPings}`);
      } else {
        this.status.totalFailures++;
        console.log(`⚠️ [Keep-Alive] Ping falhou — HTTP ${response.status}`);
      }
    } catch (err: any) {
      this.status.totalFailures++;
      if (err.name !== 'AbortError') {
        console.log('⚠️ [Keep-Alive] Erro de ping:', err.message);
      }
    }
  }

  private cleanup(): void {
    if (this.pingJob) { this.pingJob.stop(); this.pingJob = null; }
    if (this.uptimeInterval) { clearInterval(this.uptimeInterval); this.uptimeInterval = null; }
  }

  stop(): void {
    this.cleanup();
    this.status.isActive = false;
    console.log('🛑 Sistema Keep-Alive parado');
  }

  /** Registra um ping externo recebido (de Vercel, UptimeRobot, cron-job.org, etc.) */
  receivePing(source: string): { success: boolean; message: string; status: any } {
    this.status.lastExternalPingAt = new Date();
    this.status.lastExternalPingSource = source;
    this.status.totalExternalPings++;
    console.log(`📡 [Keep-Alive] Ping externo recebido de: ${source} | Total externos: ${this.status.totalExternalPings}`);
    return { success: true, message: `Ping recebido de ${source}`, status: this.getStatus() };
  }

  /** Compatibilidade com código legado que chamava setVercelUrl */
  setVercelUrl(url: string): void {
    this.status.targetUrl = url;
    console.log(`🔗 [Keep-Alive] URL configurada: ${url}`);
  }

  getStatus(): any {
    const s = this.status.uptimeSeconds;
    return {
      isActive: this.status.isActive,
      uptime: `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`,
      uptimeSeconds: s,
      startTime: this.status.startTime.toISOString(),
      lastPingAt: this.status.lastPingAt?.toISOString() || null,
      lastExternalPingAt: this.status.lastExternalPingAt?.toISOString() || null,
      lastExternalPingSource: this.status.lastExternalPingSource,
      totalPings: this.status.totalPings,
      totalExternalPings: this.status.totalExternalPings,
      totalFailures: this.status.totalFailures,
      targetUrl: this.status.targetUrl,
      serverTime: new Date().toISOString()
    };
  }
}

export const keepAliveSystem = KeepAliveSystem.getInstance();
