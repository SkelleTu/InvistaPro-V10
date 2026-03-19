import { spawn, ChildProcess, execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const XVFBRUN = '/nix/store/ds3bnbkkv55ig9243zw88xybk62aqaxx-xvfb-run-1+g87f6705/bin/xvfb-run';
const X11VNC_BIN = '/nix/store/4rxi8q5x6yb39ykygl5ddvmlx6v26gjy-x11vnc-0.9.17/bin/x11vnc';
const OPENBOX_BIN = '/nix/store/sj7nznjghqz316gclkz5y4ii0a1nqai9-openbox-3.6.1/bin/openbox';
const WINE_DIR = '/nix/store/d7zxq15f0sycdi07h77pga90hgwl7rn8-wine-10.0/bin';
const WINE_BIN = `${WINE_DIR}/wine`;
const WINEBOOT_BIN = `${WINE_DIR}/wineboot`;
const WINESERVER_BIN = `${WINE_DIR}/wineserver`;
const WEBSOCKIFY_BIN = '/home/runner/workspace/.pythonlibs/bin/websockify';

const DISPLAY = ':99';
const DISPLAY_NUM = 99;
const VNC_PORT = 5901;
const WEBSOCKIFY_PORT = 6080;
const RESOLUTION = '1280x800x24';

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
  private wineReady: boolean = false;

  private log(msg: string) {
    const ts = new Date().toISOString().slice(11, 19);
    const line = `[${ts}] ${msg}`;
    console.log(`🖥️ [DESKTOP] ${msg}`);
    this.logs.push(line);
    if (this.logs.length > 200) this.logs.shift();
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
      wineReady: this.wineReady,
    };
  }

  private checkMT5Installed(): boolean {
    const winePrefix = process.env.WINEPREFIX || path.join(process.env.HOME || '/root', '.wine');
    const candidates = [
      path.join(winePrefix, 'drive_c', 'Program Files', 'MetaTrader 5', 'terminal64.exe'),
      path.join(winePrefix, 'drive_c', 'Program Files (x86)', 'MetaTrader 5', 'terminal64.exe'),
      path.join(winePrefix, 'drive_c', 'Program Files', 'MetaTrader 5', 'terminal.exe'),
    ];
    return candidates.some(p => existsSync(p));
  }

  private getMT5ExePath(): string | null {
    const winePrefix = process.env.WINEPREFIX || path.join(process.env.HOME || '/root', '.wine');
    const candidates = [
      path.join(winePrefix, 'drive_c', 'Program Files', 'MetaTrader 5', 'terminal64.exe'),
      path.join(winePrefix, 'drive_c', 'Program Files (x86)', 'MetaTrader 5', 'terminal64.exe'),
      path.join(winePrefix, 'drive_c', 'Program Files', 'MetaTrader 5', 'terminal.exe'),
    ];
    return candidates.find(p => existsSync(p)) || null;
  }

  async start(): Promise<{ success: boolean; error?: string }> {
    if (this.status === 'running' || this.status === 'starting') {
      return { success: true };
    }

    this.status = 'starting';
    this.errorMsg = '';
    this.logs = [];
    this.log('Iniciando ambiente virtual Windows...');

    // Clean up any stale lock files and processes
    try {
      execSync(`rm -f /tmp/.X${DISPLAY_NUM}-lock`, { timeout: 2000 });
      execSync(`pkill -9 -f "Xvfb ${DISPLAY}" 2>/dev/null || true`, { timeout: 2000 });
      execSync(`pkill -9 -f "x11vnc.*${DISPLAY}" 2>/dev/null || true`, { timeout: 2000 });
      execSync(`pkill -9 -f "websockify.*${WEBSOCKIFY_PORT}" 2>/dev/null || true`, { timeout: 2000 });
      execSync(`${WINESERVER_BIN} -k 2>/dev/null || true`, { timeout: 3000 });
    } catch {}

    await this.delay(1000);

    try {
      await this.startDesktop();
      await this.delay(4000);
      await this.startWebsockify();
      await this.delay(500);

      this.status = 'running';
      this.startedAt = Date.now();
      this.log('✅ Desktop virtual iniciado com sucesso!');

      // Check if MT5 is already installed
      this.mt5Installed = this.checkMT5Installed();
      if (this.mt5Installed) {
        this.log('✅ MT5 detectado — iniciando terminal...');
        setTimeout(() => this.launchMT5(), 2000);
      } else {
        this.log('📦 MT5 não instalado — iniciando Wine e instalador...');
        setTimeout(() => this.initWineAndInstall(), 2000);
      }

      return { success: true };
    } catch (err: any) {
      this.status = 'error';
      this.errorMsg = err.message || String(err);
      this.log(`❌ Erro: ${this.errorMsg}`);
      return { success: false, error: this.errorMsg };
    }
  }

  private async initWineAndInstall(): Promise<void> {
    if (!existsSync(WINEBOOT_BIN)) {
      this.log('⚠️ wineboot não encontrado, tentando instalar direto...');
      await this.installMT5();
      return;
    }

    this.log('🍷 Inicializando prefixo Wine (wineboot)...');
    this.wineReady = false;

    await new Promise<void>((resolve) => {
      const winebootProc = spawn(WINEBOOT_BIN, ['--init'], {
        env: { ...process.env, DISPLAY, WINEDEBUG: '-all', WINEDLLOVERRIDES: '' },
        detached: false,
      });

      winebootProc.stdout?.on('data', (d: Buffer) => {
        const msg = d.toString().trim();
        if (msg) this.log(`[wineboot] ${msg}`);
      });

      winebootProc.stderr?.on('data', (d: Buffer) => {
        const msg = d.toString().trim();
        if (msg && !msg.includes('fixme:') && !msg.includes('warn:')) this.log(`[wineboot] ${msg}`);
      });

      winebootProc.on('exit', (code) => {
        this.log(`[wineboot] finalizado com código ${code}`);
        this.wineReady = true;
        resolve();
      });

      winebootProc.on('error', (e) => {
        this.log(`[wineboot error] ${e.message}`);
        resolve();
      });

      setTimeout(() => resolve(), 30000);
    });

    this.log('🍷 Wine pronto — iniciando instalador MT5...');
    await this.delay(2000);
    await this.installMT5();
  }

  private async launchMT5(): Promise<void> {
    const mt5Path = this.getMT5ExePath();
    if (!mt5Path) {
      this.log('⚠️ MT5 não encontrado, rodando instalador...');
      await this.initWineAndInstall();
      return;
    }

    this.log(`🚀 Iniciando MetaTrader 5: ${mt5Path}`);
    const mt5Proc = spawn(WINE_BIN, [mt5Path], {
      env: { ...process.env, DISPLAY, WINEDEBUG: '-all' },
      detached: false,
    });

    mt5Proc.stdout?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) this.log(`[mt5] ${msg}`);
    });

    mt5Proc.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg && !msg.includes('fixme:') && !msg.includes('warn:')) this.log(`[mt5] ${msg}`);
    });

    mt5Proc.on('exit', (code) => {
      this.log(`[mt5] encerrado com código ${code}`);
      this.wineProc = null;
    });

    mt5Proc.on('error', (e) => {
      this.log(`[mt5 error] ${e.message}`);
    });

    this.wineProc = mt5Proc;
  }

  private startDesktop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.log(`Iniciando Xvfb + Openbox + VNC via xvfb-run`);

      if (!existsSync(XVFBRUN)) {
        reject(new Error(`xvfb-run não encontrado: ${XVFBRUN}`));
        return;
      }

      // Script that runs inside the xvfb-run context:
      // - starts openbox (window manager)
      // - sets a visible background color (blue like Windows)
      // - starts x11vnc (VNC server)
      // - keeps alive with a loop
      const innerScript = [
        `export DISPLAY=${DISPLAY}`,
        `${OPENBOX_BIN} --sm-disable &`,
        'sleep 2',
        // Try to set a visible background color
        `xsetroot -solid "#1a3a5c" 2>/dev/null || true`,
        `${X11VNC_BIN} -display ${DISPLAY} -nopw -rfbport ${VNC_PORT} -forever -shared -noxdamage -noxfixes 2>&1 &`,
        'sleep 2',
        'echo "[DESKTOP_READY]"',
        'while true; do sleep 10; done',
      ].join('\n');

      const proc = spawn(XVFBRUN, [
        `--server-num=${DISPLAY_NUM}`,
        '--server-args', `-screen 0 ${RESOLUTION} -ac`,
        'bash', '-c', innerScript,
      ], {
        detached: false,
        env: { ...process.env },
      });

      let resolved = false;
      const resolveOnce = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      proc.stdout?.on('data', (d: Buffer) => {
        const msg = d.toString().trim();
        if (!msg) return;
        this.log(`[desktop] ${msg}`);
        if (msg.includes('[DESKTOP_READY]') && !resolved) {
          resolveOnce();
        }
      });

      proc.stderr?.on('data', (d: Buffer) => {
        const msg = d.toString().trim();
        if (!msg) return;
        if (msg.includes('XOpenDisplay') || msg.includes('MIT-MAGIC') ||
            msg.includes('_XSERVTransm') || msg.includes('deprecated')) return;
        this.log(`[desktop] ${msg}`);
      });

      proc.on('error', (e) => {
        this.log(`[desktop error] ${e.message}`);
        if (!resolved) {
          resolved = true;
          reject(e);
        }
      });

      proc.on('exit', (code) => {
        this.log(`[desktop] processo encerrado com código ${code}`);
        this.desktopProc = null;
        if (this.status === 'running') {
          this.status = 'error';
          this.errorMsg = `Desktop encerrado inesperadamente (código ${code})`;
        }
      });

      this.desktopProc = proc;

      // Resolve after timeout even if [DESKTOP_READY] was missed
      setTimeout(() => resolveOnce(), 8000);
    });
  }

  private startWebsockify(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.log(`Iniciando WebSocket proxy na porta ${WEBSOCKIFY_PORT}`);

      if (!existsSync(WEBSOCKIFY_BIN)) {
        reject(new Error(`websockify não encontrado: ${WEBSOCKIFY_BIN}`));
        return;
      }

      // Kill any existing websockify on this port
      try {
        execSync(`pkill -9 -f "websockify.*${WEBSOCKIFY_PORT}" 2>/dev/null || true`, { timeout: 2000 });
      } catch {}

      const proc = spawn(WEBSOCKIFY_BIN, [
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
        this.log(`[websockify] encerrado com código ${code}`);
        this.websockifyProc = null;
        if (this.status === 'running') this.status = 'error';
      });

      this.websockifyProc = proc;
      setTimeout(() => resolve(), 1500);
    });
  }

  async startOrInstallMT5(): Promise<{ success: boolean; error?: string }> {
    if (this.status !== 'running') {
      return { success: false, error: 'Desktop virtual não está rodando. Inicie primeiro.' };
    }

    // If already installed, launch it directly
    if (this.checkMT5Installed()) {
      this.mt5Installed = true;
      this.log('✅ MT5 já instalado — iniciando terminal...');
      await this.launchMT5();
      return { success: true };
    }

    // Not installed: run installer
    return this.installMT5();
  }

  async installMT5(): Promise<{ success: boolean; error?: string }> {
    if (this.status !== 'running') {
      return { success: false, error: 'Desktop virtual não está rodando. Inicie primeiro.' };
    }

    const candidates = [
      'attached_assets/mt5setup_1773900411116.exe',
      'attached_assets/mt5setup_1773899696235.exe',
    ];
    const installerPath = candidates.map(c => path.resolve(process.cwd(), c)).find(p => existsSync(p));
    if (!installerPath) {
      return { success: false, error: 'Arquivo do instalador MT5 não encontrado em attached_assets/' };
    }

    if (!existsSync(WINE_BIN)) {
      return { success: false, error: `Wine não encontrado: ${WINE_BIN}` };
    }

    // Kill any previous wine/mt5 process
    if (this.wineProc && !this.wineProc.killed) {
      try { this.wineProc.kill('SIGTERM'); } catch {}
      await this.delay(500);
    }

    this.log('🍷 Iniciando instalador MetaTrader 5 via Wine...');
    this.log(`📂 Instalador: ${installerPath}`);

    // Try with /quiet first for silent install, fallback shows GUI
    const wineProc = spawn(WINE_BIN, [installerPath, '/silent'], {
      env: {
        ...process.env,
        DISPLAY,
        WINEDEBUG: 'err+all',
        WINEDLLOVERRIDES: '',
        HOME: process.env.HOME || '/home/runner',
        WINEPREFIX: process.env.WINEPREFIX || `${process.env.HOME || '/home/runner'}/.wine`,
      },
      detached: false,
    });

    wineProc.stdout?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg) this.log(`[wine] ${msg}`);
    });

    wineProc.stderr?.on('data', (d: Buffer) => {
      const msg = d.toString().trim();
      if (msg && !msg.includes('fixme:') && !msg.includes('warn:') && !msg.includes('err:winediag')) {
        this.log(`[wine] ${msg}`);
      }
    });

    wineProc.on('error', (e) => {
      this.log(`[wine error] ${e.message}`);
    });

    wineProc.on('exit', (code) => {
      this.log(`[wine] instalador finalizou com código ${code}`);
      this.wineProc = null;
      // Check if MT5 got installed
      const installed = this.checkMT5Installed();
      if (installed) {
        this.mt5Installed = true;
        this.log('✅ MT5 instalado com sucesso! Iniciando terminal...');
        setTimeout(() => this.launchMT5(), 3000);
      } else {
        this.log('⚠️ Instalação concluída — MT5 pode precisar de interação na tela');
      }
    });

    this.wineProc = wineProc;
    return { success: true };
  }

  async stop(): Promise<void> {
    this.log('Encerrando desktop virtual...');

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

    try {
      execSync(`${WINESERVER_BIN} -k 2>/dev/null || true`, { timeout: 3000 });
    } catch {}

    this.wineProc = null;
    this.websockifyProc = null;
    this.desktopProc = null;
    this.status = 'stopped';
    this.startedAt = null;
    this.wineReady = false;

    // Clean up X lock files
    try {
      execSync(`rm -f /tmp/.X${DISPLAY_NUM}-lock`, { timeout: 2000 });
    } catch {}

    this.log('Desktop virtual encerrado');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const virtualDesktop = new VirtualDesktopService();
