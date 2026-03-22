import fetch from 'node-fetch';

// 2 minutos e 30 segundos em ms — interleave com pings externos de 5 min
const PULL_INTERVAL_MS = 2.5 * 60 * 1000; // 150 000 ms

interface KeepAliveStatus {
  isActive: boolean;
  // Último auto-pull (servidor puxando a si mesmo)
  lastPingAt: Date | null;
  // Último ping recebido de serviço externo (Vercel, UptimeRobot, etc.)
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
  private pullInterval: NodeJS.Timeout | null = null;
  private uptimeInterval: NodeJS.Timeout | null = null;
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
    const replitDomain = process.env.REPLIT_DEV_DOMAIN;
    if (replitDomain) {
      return `https://${replitDomain}/api/status`;
    }
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
    console.log(`   • Auto-pull interno: a cada ${PULL_INTERVAL_MS / 60000} min (interleave com pings externos de 5 min)`);
    console.log('   • URL alvo:', this.status.targetUrl || '⚠️ Não detectada (REPLIT_DEV_DOMAIN ausente)');

    // Primeiro pull após 5 segundos para confirmar funcionamento
    setTimeout(() => this.doPull(), 5000);

    // Pull recorrente a cada 2 min 30 s
    this.pullInterval = setInterval(() => {
      this.status.targetUrl = this.resolveTargetUrl();
      this.doPull();
    }, PULL_INTERVAL_MS);

    // Uptime counter
    this.uptimeInterval = setInterval(() => {
      this.status.uptimeSeconds = Math.floor((Date.now() - this.status.startTime.getTime()) / 1000);
    }, 1000);

    console.log('✅ Sistema Keep-Alive 24/7 ATIVO! (pull a cada 2m30s + push externo a cada 5m = atividade máxima a cada ~2m30s)');
  }

  private async doPull(): Promise<void> {
    if (!this.status.targetUrl) {
      this.status.targetUrl = this.resolveTargetUrl();
      if (!this.status.targetUrl) {
        console.log('⚠️ [Keep-Alive] URL não detectada — sem pull');
        return;
      }
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(this.status.targetUrl, {
        method: 'GET',
        signal: controller.signal as any,
        headers: {
          'X-Keep-Alive': 'pull',
          'X-Ping-Type': 'internal-pull',
          'X-Timestamp': new Date().toISOString()
        }
      });
      clearTimeout(timeout);

      if (response.ok) {
        this.status.lastPingAt = new Date();
        this.status.totalPings++;
        console.log(`💓 [Keep-Alive] Auto-pull OK → ${this.status.targetUrl} | Pull #${this.status.totalPings}`);
      } else {
        this.status.totalFailures++;
        console.log(`⚠️ [Keep-Alive] Auto-pull falhou — HTTP ${response.status}`);
      }
    } catch (err: any) {
      this.status.totalFailures++;
      if (err.name !== 'AbortError') {
        console.log('⚠️ [Keep-Alive] Erro de auto-pull:', err.message);
      }
    }
  }

  private cleanup(): void {
    if (this.pullInterval) { clearInterval(this.pullInterval); this.pullInterval = null; }
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
    console.log(`📡 [Keep-Alive] Push externo recebido de: ${source} | Total externos: ${this.status.totalExternalPings}`);
    return { success: true, message: `Ping recebido de ${source}`, status: this.getStatus() };
  }

  /** Compatibilidade com código legado */
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
      pullIntervalMinutes: PULL_INTERVAL_MS / 60000,
      serverTime: new Date().toISOString()
    };
  }
}

export const keepAliveSystem = KeepAliveSystem.getInstance();
