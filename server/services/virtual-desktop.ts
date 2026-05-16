import { spawn, ChildProcess, execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const DISPLAY = ':99';
const DISPLAY_NUM = 99;
const VNC_PORT = 5901;
const WEBSOCKIFY_PORT = 6080;
const RESOLUTION = '1280x800x24';

// Resolve binary path dynamically — prefer which, then known nix-store paths, then fallback
function resolveBin(name: string, nixFallbacks: string[] = []): string {
  try {
    const r = spawnSync('which', [name], { encoding: 'utf8', timeout: 3000 });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  } catch {}
  for (const fb of nixFallbacks) {
    if (existsSync(fb)) return fb;
  }
  return name; // fallback: just use name and hope it's in PATH at runtime
}

// Lazy-resolve binaries once on first use
let _bins: Record<string, string> | null = null;
function getBins() {
  if (_bins) return _bins;
  _bins = {
    xvfbRun:    resolveBin('xvfb-run',   ['/nix/store/ds3bnbkkv55ig9243zw88xybk62aqaxx-xvfb-run-1+g87f6705/bin/xvfb-run']),
    x11vnc:     resolveBin('x11vnc',      ['/nix/store/4rxi8q5x6yb39ykygl5ddvmlx6v26gjy-x11vnc-0.9.17/bin/x11vnc']),
    openbox:    resolveBin('openbox',     ['/nix/store/sj7nznjghqz316gclkz5y4ii0a1nqai9-openbox-3.6.1/bin/openbox']),
    xsetroot:   resolveBin('xsetroot',    ['/nix/store/21rcnlwxh0qvlc12whjiscb5qmf5nq8a-xsetroot-1.1.3/bin/xsetroot']),
    websockify: resolveBin('websockify',  ['/home/runner/workspace/.pythonlibs/bin/websockify']),
    // wine-wow-10.0 = WoW64 support (runs BOTH 32-bit and 64-bit Windows apps)
    // wine-10.0    = wine64 only (runs 64-bit only — MT5 installer is 32-bit, would fail)
    wine:       resolveBin('wine', [
      '/nix/store/0mbxz9m3hp8zdvr9b3k3szry230rv64x-wine-wow-10.0/bin/wine',
      '/nix/store/d7zxq15f0sycdi07h77pga90hgwl7rn8-wine-10.0/bin/wine',
    ]),
    wineboot:   resolveBin('wineboot', [
      '/nix/store/0mbxz9m3hp8zdvr9b3k3szry230rv64x-wine-wow-10.0/bin/wineboot',
      '/nix/store/d7zxq15f0sycdi07h77pga90hgwl7rn8-wine-10.0/bin/wineboot',
    ]),
    wineserver: resolveBin('wineserver', [
      '/nix/store/0mbxz9m3hp8zdvr9b3k3szry230rv64x-wine-wow-10.0/bin/wineserver',
      '/nix/store/d7zxq15f0sycdi07h77pga90hgwl7rn8-wine-10.0/bin/wineserver',
    ]),
  };
  return _bins;
}

type DesktopStatus = 'stopped' | 'starting' | 'running' | 'error';

class VirtualDesktopService {
  private desktopProc: ChildProcess | null = null;
  private websockifyProc: ChildProcess | null = null;
  private wineProc: ChildProcess | null = null;
  private status: DesktopStatus = 'stopped';
  private errorMsg: string = '';
  private startedAt: number | null = null;
  private logs: string[] = [];
  private mt5Installed: boolean = false;
  private mt5Uploaded: boolean = false;
  private mt5UploadedExe: string | null = null;
  private wineReady: boolean = false;

  private log(msg: string) {
    const ts = new Date().toISOString().slice(11, 19);
    const line = `[${ts}] ${msg}`;
    console.log(`🖥️ [DESKTOP] ${msg}`);
    this.logs.push(line);
    if (this.logs.length > 300) this.logs.shift();
  }

  getStatus() {
    return {
      status: this.status,
      error: this.errorMsg,
      startedAt: this.startedAt,
      vncPort: VNC_PORT,
      websockifyPort: WEBSOCKIFY_PORT,
      logs: this.logs.slice(-50),
      hasXvfb: !!this.desktopProc,
      hasVnc: !!this.desktopProc,
      hasWebsockify: !!this.websockifyProc,
      mt5Installed: this.mt5Installed,
      mt5Uploaded: this.mt5Uploaded,
      mt5UploadedExe: this.mt5UploadedExe,
      wineReady: this.wineReady,
    };
  }

  setMT5Uploaded(exePath: string) {
    this.mt5Uploaded = true;
    this.mt5UploadedExe = exePath;
    this.log(`📦 MT5 carregado via upload: ${exePath}`);
  }

  clearMT5Uploaded() {
    this.mt5Uploaded = false;
    this.mt5UploadedExe = null;
  }

  // Check filesystem for uploaded MT5 exe (populated by upload routes)
  private findUploadedMT5Exe(): string | null {
    const uploadDir = path.resolve(process.cwd(), 'mt5-uploaded');
    if (!existsSync(uploadDir)) return null;
    const { readdirSync, statSync } = require('fs');
    const candidates = ['terminal64.exe', 'terminal.exe', 'metatrader5.exe', 'mt5.exe'];
    function walk(d: string): string | null {
      let entries: string[];
      try { entries = readdirSync(d); } catch { return null; }
      for (const entry of entries) {
        const full = path.join(d, entry);
        try {
          const st = statSync(full);
          if (st.isDirectory()) { const r = walk(full); if (r) return r; }
          else if (candidates.includes(entry.toLowerCase())) return full;
        } catch {}
      }
      return null;
    }
    return walk(uploadDir);
  }

  private getWinePrefix(): string {
    return process.env.WINEPREFIX || path.join(process.env.HOME || '/home/runner', '.wine');
  }

  private checkMT5Installed(): boolean {
    const winePrefix = this.getWinePrefix();
    const candidates = [
      path.join(winePrefix, 'drive_c', 'Program Files', 'MetaTrader 5', 'terminal64.exe'),
      path.join(winePrefix, 'drive_c', 'Program Files (x86)', 'MetaTrader 5', 'terminal64.exe'),
      path.join(winePrefix, 'drive_c', 'Program Files', 'MetaTrader 5', 'terminal.exe'),
    ];
    return candidates.some(p => existsSync(p));
  }

  private getMT5ExePath(): string | null {
    const winePrefix = this.getWinePrefix();
    const candidates = [
      path.join(winePrefix, 'drive_c', 'Program Files', 'MetaTrader 5', 'terminal64.exe'),
      path.join(winePrefix, 'drive_c', 'Program Files (x86)', 'MetaTrader 5', 'terminal64.exe'),
      path.join(winePrefix, 'drive_c', 'Program Files', 'MetaTrader 5', 'terminal.exe'),
    ];
    return candidates.find(p => existsSync(p)) || null;
  }

  private getWineEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      DISPLAY,
      WINEDEBUG: '-all',
      WINEDLLOVERRIDES: 'mscoree,mshtml=',
      HOME: process.env.HOME || '/home/runner',
      WINEPREFIX: this.getWinePrefix(),
      WINEARCH: 'win64',
    };
  }

  async start(): Promise<{ success: boolean; error?: string }> {
    if (this.status === 'running' || this.status === 'starting') {
      return { success: true };
    }

    this.status = 'starting';
    this.errorMsg = '';
    this.logs = [];
    const bins = getBins();

    this.log(`🔍 Binários resolvidos:`);
    this.log(`   xvfb-run  → ${bins.xvfbRun}`);
    this.log(`   x11vnc    → ${bins.x11vnc}`);
    this.log(`   openbox   → ${bins.openbox}`);
    this.log(`   wine      → ${bins.wine}`);
    this.log(`   wineboot  → ${bins.wineboot}`);
    this.log(`   websockify→ ${bins.websockify}`);
    this.log(`   xsetroot  → ${existsSync(bins.xsetroot) ? bins.xsetroot : '(não disponível, ignorado)'}`);

    // Cleanup stale processes
    try { execSync(`rm -f /tmp/.X${DISPLAY_NUM}-lock`, { timeout: 2000 }); } catch {}
    try { execSync(`pkill -9 -f "Xvfb :${DISPLAY_NUM}" 2>/dev/null || true`, { timeout: 2000 }); } catch {}
    try { execSync(`pkill -9 -f "x11vnc.*:${DISPLAY_NUM}" 2>/dev/null || true`, { timeout: 2000 }); } catch {}
    try { execSync(`pkill -9 -f "websockify.*${WEBSOCKIFY_PORT}" 2>/dev/null || true`, { timeout: 2000 }); } catch {}
    try { execSync(`${bins.wineserver} -k 2>/dev/null || true`, { timeout: 3000 }); } catch {}

    await this.delay(1000);

    try {
      // Validate required binaries
      if (!existsSync(bins.xvfbRun)) throw new Error(`xvfb-run não encontrado: ${bins.xvfbRun}`);
      if (!existsSync(bins.x11vnc))  throw new Error(`x11vnc não encontrado: ${bins.x11vnc}`);
      if (!existsSync(bins.openbox)) throw new Error(`openbox não encontrado: ${bins.openbox}`);
      if (!existsSync(bins.wine))    throw new Error(`wine não encontrado: ${bins.wine}`);
      if (!existsSync(bins.websockify)) throw new Error(`websockify não encontrado: ${bins.websockify}`);

      await this.startDesktop();
      this.log('✅ Desktop Xvfb+x11vnc iniciado — aguardando estabilizar...');
      await this.delay(4000);

      await this.startWebsockify();
      this.log('✅ WebSocket proxy (websockify) iniciado');
      await this.delay(500);

      this.status = 'running';
      this.startedAt = Date.now();
      this.log('🎉 Desktop virtual PRONTO! Iniciando Wine...');

      // Check if MT5 is available and auto-launch
      this.mt5Installed = this.checkMT5Installed();
      const uploadedExe = this.findUploadedMT5Exe();
      if (uploadedExe) {
        this.mt5Uploaded = true;
        this.mt5UploadedExe = uploadedExe;
        this.log(`📦 MT5 encontrado via upload: ${uploadedExe}`);
        this.log('🚀 Iniciando MT5 do upload automaticamente...');
        setTimeout(() => this.launchExe(uploadedExe), 3000);
      } else if (this.mt5Installed) {
        this.log('✅ MT5 detectado na instalação — iniciando...');
        setTimeout(() => this.launchMT5(), 3000);
      } else {
        this.log('🍷 Inicializando Wine (wineboot --init)...');
        setTimeout(() => this.initWinePrefix(), 2000);
      }

      return { success: true };
    } catch (err: any) {
      this.status = 'error';
      this.errorMsg = err.message || String(err);
      this.log(`❌ Erro fatal: ${this.errorMsg}`);
      return { success: false, error: this.errorMsg };
    }
  }

  private async initWinePrefix(): Promise<void> {
    const bins = getBins();
    this.wineReady = false;
    this.log('🍷 Inicializando prefixo Wine 64-bit...');

    await new Promise<void>((resolve) => {
      const proc = spawn(bins.wineboot, ['--init'], {
        env: this.getWineEnv(),
        detached: false,
      });

      let output = '';
      proc.stdout?.on('data', (d: Buffer) => {
        const msg = d.toString().trim();
        if (msg) { this.log(`[wineboot] ${msg}`); output += msg; }
      });
      proc.stderr?.on('data', (d: Buffer) => {
        const msg = d.toString().trim();
        if (msg && !msg.includes('fixme:') && !msg.includes('warn:') && !msg.includes('err:winediag')) {
          this.log(`[wineboot] ${msg}`);
        }
      });
      proc.on('exit', (code) => {
        this.log(`[wineboot] concluído — código ${code}`);
        this.wineReady = true;
        resolve();
      });
      proc.on('error', (e) => { this.log(`[wineboot error] ${e.message}`); resolve(); });
      setTimeout(() => { if (!this.wineReady) { this.log('[wineboot] timeout (30s) — continuando'); resolve(); } }, 30000);
    });

    this.log('🍷 Wine pronto. Iniciando instalador MT5 automaticamente...');
    await this.delay(2000);
    await this.installMT5();
  }

  private async launchMT5(): Promise<void> {
    const mt5Path = this.getMT5ExePath();
    if (!mt5Path) {
      this.log('⚠️ MT5 não encontrado no Wine prefix — iniciando instalador...');
      await this.initWinePrefix();
      return;
    }
    this.log(`🚀 Iniciando MetaTrader 5: ${mt5Path}`);
    const bins = getBins();
    const proc = spawn(bins.wine, [mt5Path], {
      env: this.getWineEnv(),
      detached: false,
    });
    proc.stdout?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) this.log(`[mt5] ${msg}`);
    });
    proc.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg && !msg.includes('fixme:') && !msg.includes('warn:') && !msg.includes('err:winediag')) {
        this.log(`[mt5] ${msg}`);
      }
    });
    proc.on('exit', (code) => {
      this.log(`[mt5] encerrado — código ${code}`);
      this.wineProc = null;
    });
    proc.on('error', (e) => { this.log(`[mt5 error] ${e.message}`); });
    this.wineProc = proc;
  }

  private startDesktop(): Promise<void> {
    return new Promise((resolve, reject) => {
      const bins = getBins();
      const hasXsetroot = existsSync(bins.xsetroot);
      this.log(`Iniciando Xvfb (${RESOLUTION}) + Openbox + x11vnc na porta ${VNC_PORT}`);

      // Script que roda dentro do xvfb-run
      const bgCmd = hasXsetroot
        ? `${bins.xsetroot} -solid "#1e3a5f" 2>/dev/null || true`
        : `true`;

      const innerScript = [
        `export DISPLAY=${DISPLAY}`,
        `${bins.openbox} --sm-disable &`,
        'sleep 1',
        bgCmd,
        `${bins.x11vnc} -display ${DISPLAY} -nopw -rfbport ${VNC_PORT} -forever -shared -noxdamage -noxfixes -quiet 2>&1 &`,
        'sleep 2',
        'echo "[DESKTOP_READY]"',
        'while true; do sleep 10; done',
      ].join('\n');

      const proc = spawn(bins.xvfbRun, [
        `--server-num=${DISPLAY_NUM}`,
        '--server-args', `-screen 0 ${RESOLUTION} -ac -extension RANDR`,
        'bash', '-c', innerScript,
      ], {
        detached: false,
        env: { ...process.env },
      });

      let resolved = false;
      const resolveOnce = () => { if (!resolved) { resolved = true; resolve(); } };

      proc.stdout?.on('data', (d: Buffer) => {
        const msg = d.toString().trim();
        if (!msg) return;
        this.log(`[desktop] ${msg}`);
        if (msg.includes('[DESKTOP_READY]')) resolveOnce();
      });

      proc.stderr?.on('data', (d: Buffer) => {
        const msg = d.toString().trim();
        if (!msg) return;
        // Filter noisy but harmless messages
        if (msg.includes('XOpenDisplay') || msg.includes('MIT-MAGIC') ||
            msg.includes('_XSERVTransm') || msg.includes('deprecated') ||
            msg.includes('Initializing') || msg.includes('warning:')) return;
        this.log(`[desktop] ${msg}`);
      });

      proc.on('error', (e) => {
        this.log(`[desktop error] ${e.message}`);
        if (!resolved) { resolved = true; reject(e); }
      });

      proc.on('exit', (code) => {
        this.log(`[desktop] processo encerrado — código ${code}`);
        this.desktopProc = null;
        if (this.status === 'running') {
          this.status = 'error';
          this.errorMsg = `Desktop encerrado inesperadamente (código ${code})`;
        }
      });

      this.desktopProc = proc;
      // Safety timeout — resolve even if [DESKTOP_READY] was missed
      setTimeout(() => resolveOnce(), 10000);
    });
  }

  private startWebsockify(): Promise<void> {
    return new Promise((resolve, reject) => {
      const bins = getBins();
      this.log(`Iniciando websockify :${WEBSOCKIFY_PORT} → localhost:${VNC_PORT}`);

      try { execSync(`pkill -9 -f "websockify.*${WEBSOCKIFY_PORT}" 2>/dev/null || true`, { timeout: 2000 }); } catch {}
      try { execSync(`pkill -9 -f "websockify.*${VNC_PORT}" 2>/dev/null || true`, { timeout: 2000 }); } catch {}

      const proc = spawn(bins.websockify, [
        String(WEBSOCKIFY_PORT),
        `localhost:${VNC_PORT}`,
      ], { detached: false });

      proc.stdout?.on('data', (d: Buffer) => {
        const msg = d.toString().trim();
        if (msg) this.log(`[websockify] ${msg}`);
      });
      proc.stderr?.on('data', (d: Buffer) => {
        const msg = d.toString().trim();
        if (msg) this.log(`[websockify] ${msg}`);
      });
      proc.on('error', (e) => {
        this.log(`[websockify error] ${e.message}`);
        reject(e);
      });
      proc.on('exit', (code) => {
        this.log(`[websockify] encerrado — código ${code}`);
        this.websockifyProc = null;
        if (this.status === 'running') this.status = 'error';
      });

      this.websockifyProc = proc;
      setTimeout(() => resolve(), 2000);
    });
  }

  async startOrInstallMT5(): Promise<{ success: boolean; error?: string }> {
    if (this.status !== 'running') {
      return { success: false, error: 'Desktop virtual não está rodando. Inicie primeiro.' };
    }
    if (this.mt5Uploaded && this.mt5UploadedExe) {
      this.log('📦 Abrindo MT5 carregado via upload...');
      return this.launchExe(this.mt5UploadedExe);
    }
    if (this.checkMT5Installed()) {
      this.mt5Installed = true;
      this.log('✅ MT5 instalado — iniciando terminal...');
      await this.launchMT5();
      return { success: true };
    }
    return this.installMT5();
  }

  async installMT5(): Promise<{ success: boolean; error?: string }> {
    if (this.status !== 'running') {
      return { success: false, error: 'Desktop virtual não está rodando. Inicie primeiro.' };
    }
    const bins = getBins();

    const candidates = [
      'attached_assets/mt5setup_1773900411116.exe',
      'attached_assets/mt5setup_1773899696235.exe',
    ];
    const installerPath = candidates
      .map(c => path.resolve(process.cwd(), c))
      .find(p => existsSync(p));

    if (!installerPath) {
      return { success: false, error: 'Instalador MT5 não encontrado em attached_assets/' };
    }
    if (!existsSync(bins.wine)) {
      return { success: false, error: `Wine não encontrado: ${bins.wine}` };
    }

    if (this.wineProc && !this.wineProc.killed) {
      try { this.wineProc.kill('SIGTERM'); } catch {}
      await this.delay(500);
    }

    this.log(`🍷 Iniciando instalador MT5 via Wine (WoW64)...`);
    this.log(`📂 Arquivo: ${installerPath}`);
    this.log(`ℹ️  O instalador abrirá na tela virtual — siga os passos clicando em "Avançar"`);

    const wineProc = spawn(bins.wine, [installerPath], {
      env: {
        ...this.getWineEnv(),
        WINEDEBUG: 'err+all',
      },
      detached: false,
    });

    wineProc.stdout?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) this.log(`[wine-installer] ${msg}`);
    });
    wineProc.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg && !msg.includes('fixme:') && !msg.includes('warn:') && !msg.includes('err:winediag')) {
        this.log(`[wine-installer] ${msg}`);
      }
    });
    wineProc.on('error', (e) => { this.log(`[wine-installer error] ${e.message}`); });
    wineProc.on('exit', (code) => {
      this.log(`[wine-installer] finalizado — código ${code}`);
      this.wineProc = null;
      const installed = this.checkMT5Installed();
      if (installed) {
        this.mt5Installed = true;
        this.log('✅ MT5 instalado com sucesso! Iniciando terminal em 3s...');
        setTimeout(() => this.launchMT5(), 3000);
      } else {
        this.log('⚠️ Instalação finalizada mas MT5 não detectado ainda (pode precisar reiniciar)');
      }
    });

    this.wineProc = wineProc;
    return { success: true };
  }

  async launchExe(exePath: string): Promise<{ success: boolean; error?: string }> {
    if (this.status !== 'running') {
      return { success: false, error: 'Desktop virtual não está rodando.' };
    }
    const bins = getBins();
    if (!existsSync(bins.wine)) {
      return { success: false, error: `Wine não encontrado: ${bins.wine}` };
    }

    if (this.wineProc && !this.wineProc.killed) {
      try { this.wineProc.kill('SIGTERM'); } catch {}
      await this.delay(500);
    }

    this.log(`🚀 Executando: ${exePath}`);

    const proc = spawn(bins.wine, [exePath], {
      env: this.getWineEnv(),
      detached: false,
    });

    proc.stdout?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) this.log(`[wine] ${msg}`);
    });
    proc.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg && !msg.includes('fixme:') && !msg.includes('warn:') && !msg.includes('err:winediag')) {
        this.log(`[wine] ${msg}`);
      }
    });
    proc.on('error', (e) => { this.log(`[wine error] ${e.message}`); });
    proc.on('exit', (code) => {
      this.log(`[wine] processo encerrado — código ${code}`);
      this.wineProc = null;
    });

    this.wineProc = proc;
    return { success: true };
  }

  async stop(): Promise<void> {
    this.log('Encerrando desktop virtual...');
    const bins = getBins();

    const killProc = (proc: ChildProcess | null, name: string) => {
      if (proc && !proc.killed) {
        try { proc.kill('SIGTERM'); } catch {}
        this.log(`[${name}] encerrado`);
      }
    };

    killProc(this.wineProc, 'wine');
    killProc(this.websockifyProc, 'websockify');
    await this.delay(300);
    killProc(this.desktopProc, 'desktop');

    try { execSync(`${bins.wineserver} -k 2>/dev/null || true`, { timeout: 3000 }); } catch {}
    try { execSync(`pkill -9 -f "Xvfb :${DISPLAY_NUM}" 2>/dev/null || true`, { timeout: 2000 }); } catch {}
    try { execSync(`pkill -9 -f "x11vnc.*${DISPLAY}" 2>/dev/null || true`, { timeout: 2000 }); } catch {}
    try { execSync(`pkill -9 -f "websockify.*${WEBSOCKIFY_PORT}" 2>/dev/null || true`, { timeout: 2000 }); } catch {}
    try { execSync(`rm -f /tmp/.X${DISPLAY_NUM}-lock`, { timeout: 2000 }); } catch {}

    this.wineProc = null;
    this.websockifyProc = null;
    this.desktopProc = null;
    this.status = 'stopped';
    this.startedAt = null;
    this.wineReady = false;

    this.log('Desktop virtual encerrado');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const virtualDesktop = new VirtualDesktopService();
