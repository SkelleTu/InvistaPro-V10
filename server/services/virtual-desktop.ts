import { spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import path from 'path';

const XVFB_BIN = '/nix/store/ykd61g0lhw6d4fhbc6v4znw3062qjyzw-xorg-server-21.1.13/bin/Xvfb';
const X11VNC_BIN = '/nix/store/4rxi8q5x6yb39ykygl5ddvmlx6v26gjy-x11vnc-0.9.17/bin/x11vnc';
const OPENBOX_BIN = '/nix/store/sj7nznjghqz316gclkz5y4ii0a1nqai9-openbox-3.6.1/bin/openbox';
const WINE_BIN = '/nix/store/d7zxq15f0sycdi07h77pga90hgwl7rn8-wine-10.0/bin/wine';
const WEBSOCKIFY_BIN = '/home/runner/workspace/.pythonlibs/bin/websockify';
const NOVNC_DIR = path.resolve(process.cwd(), 'public/novnc');

const DISPLAY = ':99';
const VNC_PORT = 5901;
const WEBSOCKIFY_PORT = 6080;
const RESOLUTION = '1280x800x24';

type DesktopStatus = 'stopped' | 'starting' | 'running' | 'error';

class VirtualDesktopService {
  private xvfbProc: ChildProcess | null = null;
  private openboxProc: ChildProcess | null = null;
  private vncProc: ChildProcess | null = null;
  private websockifyProc: ChildProcess | null = null;
  private wineProc: ChildProcess | null = null;
  private status: DesktopStatus = 'stopped';
  private errorMsg: string = '';
  private startedAt: number | null = null;
  private logs: string[] = [];

  private log(msg: string) {
    const ts = new Date().toISOString().slice(11, 19);
    const line = `[${ts}] ${msg}`;
    console.log(`🖥️ [DESKTOP] ${msg}`);
    this.logs.push(line);
    if (this.logs.length > 100) this.logs.shift();
  }

  getStatus() {
    return {
      status: this.status,
      error: this.errorMsg,
      startedAt: this.startedAt,
      vncPort: VNC_PORT,
      websockifyPort: WEBSOCKIFY_PORT,
      logs: this.logs.slice(-30),
      hasXvfb: !!this.xvfbProc,
      hasVnc: !!this.vncProc,
      hasWebsockify: !!this.websockifyProc,
    };
  }

  async start(): Promise<{ success: boolean; error?: string }> {
    if (this.status === 'running' || this.status === 'starting') {
      return { success: true };
    }

    this.status = 'starting';
    this.errorMsg = '';
    this.logs = [];
    this.log('Iniciando ambiente virtual Windows...');

    try {
      await this.startXvfb();
      await this.delay(1500);
      await this.startOpenbox();
      await this.delay(1000);
      await this.startVnc();
      await this.delay(1500);
      await this.startWebsockify();
      await this.delay(500);

      this.status = 'running';
      this.startedAt = Date.now();
      this.log('✅ Desktop virtual iniciado com sucesso!');
      return { success: true };
    } catch (err: any) {
      this.status = 'error';
      this.errorMsg = err.message || String(err);
      this.log(`❌ Erro: ${this.errorMsg}`);
      return { success: false, error: this.errorMsg };
    }
  }

  private startXvfb(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.log(`Iniciando Xvfb em display ${DISPLAY} (${RESOLUTION})`);

      if (!existsSync(XVFB_BIN)) {
        reject(new Error(`Xvfb não encontrado: ${XVFB_BIN}`));
        return;
      }

      const proc = spawn(XVFB_BIN, [
        DISPLAY,
        '-screen', '0', RESOLUTION,
        '-ac',
        '-nolisten', 'tcp',
      ], { detached: false });

      proc.stderr?.on('data', (d: Buffer) => {
        const msg = d.toString().trim();
        if (msg) this.log(`[Xvfb] ${msg}`);
      });

      proc.on('error', (e) => { this.log(`[Xvfb error] ${e.message}`); });
      proc.on('exit', (code) => {
        this.log(`[Xvfb] exited with code ${code}`);
        this.xvfbProc = null;
        if (this.status === 'running') this.status = 'error';
      });

      this.xvfbProc = proc;
      setTimeout(() => resolve(), 1000);
    });
  }

  private startOpenbox(): Promise<void> {
    return new Promise((resolve) => {
      this.log('Iniciando gerenciador de janelas Openbox');

      const proc = spawn(OPENBOX_BIN, [], {
        env: { ...process.env, DISPLAY },
        detached: false,
      });

      proc.stderr?.on('data', (d: Buffer) => {
        const msg = d.toString().trim();
        if (msg) this.log(`[openbox] ${msg}`);
      });

      proc.on('error', (e) => this.log(`[openbox error] ${e.message}`));
      proc.on('exit', (code) => {
        this.log(`[openbox] exited with code ${code}`);
        this.openboxProc = null;
      });

      this.openboxProc = proc;
      setTimeout(() => resolve(), 500);
    });
  }

  private startVnc(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.log(`Iniciando servidor VNC na porta ${VNC_PORT}`);

      if (!existsSync(X11VNC_BIN)) {
        reject(new Error(`x11vnc não encontrado: ${X11VNC_BIN}`));
        return;
      }

      const proc = spawn(X11VNC_BIN, [
        '-display', DISPLAY,
        '-nopw',
        '-listen', 'localhost',
        '-rfbport', String(VNC_PORT),
        '-forever',
        '-shared',
        '-quiet',
      ], { detached: false });

      proc.stdout?.on('data', (d: Buffer) => {
        const msg = d.toString().trim();
        if (msg) this.log(`[x11vnc] ${msg}`);
      });

      proc.stderr?.on('data', (d: Buffer) => {
        const msg = d.toString().trim();
        if (msg) this.log(`[x11vnc] ${msg}`);
      });

      proc.on('error', (e) => {
        this.log(`[x11vnc error] ${e.message}`);
        reject(e);
      });

      proc.on('exit', (code) => {
        this.log(`[x11vnc] exited with code ${code}`);
        this.vncProc = null;
        if (this.status === 'running') this.status = 'error';
      });

      this.vncProc = proc;
      setTimeout(() => resolve(), 1000);
    });
  }

  private startWebsockify(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.log(`Iniciando websockify na porta ${WEBSOCKIFY_PORT}`);

      if (!existsSync(WEBSOCKIFY_BIN)) {
        reject(new Error(`websockify não encontrado: ${WEBSOCKIFY_BIN}`));
        return;
      }

      if (!existsSync(NOVNC_DIR)) {
        reject(new Error(`noVNC não encontrado em: ${NOVNC_DIR}`));
        return;
      }

      const proc = spawn(WEBSOCKIFY_BIN, [
        '--web', NOVNC_DIR,
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
        this.log(`[websockify] exited with code ${code}`);
        this.websockifyProc = null;
        if (this.status === 'running') this.status = 'error';
      });

      this.websockifyProc = proc;
      setTimeout(() => resolve(), 800);
    });
  }

  async installMT5(): Promise<{ success: boolean; error?: string }> {
    if (this.status !== 'running') {
      return { success: false, error: 'Desktop virtual não está rodando. Inicie primeiro.' };
    }

    const installerPath = path.resolve(process.cwd(), 'attached_assets/mt5setup_1773899696235.exe');
    if (!existsSync(installerPath)) {
      return { success: false, error: 'Arquivo do instalador MT5 não encontrado' };
    }

    if (!existsSync(WINE_BIN)) {
      return { success: false, error: `Wine não encontrado: ${WINE_BIN}` };
    }

    this.log('Iniciando instalador MetaTrader 5 via Wine...');

    return new Promise((resolve) => {
      const wineProc = spawn(WINE_BIN, [installerPath], {
        env: { ...process.env, DISPLAY, WINEDEBUG: '-all' },
        detached: false,
      });

      wineProc.stdout?.on('data', (d: Buffer) => {
        const msg = d.toString().trim();
        if (msg) this.log(`[wine] ${msg}`);
      });

      wineProc.stderr?.on('data', (d: Buffer) => {
        const msg = d.toString().trim();
        if (msg) this.log(`[wine] ${msg}`);
      });

      wineProc.on('error', (e) => {
        this.log(`[wine error] ${e.message}`);
        resolve({ success: false, error: e.message });
      });

      wineProc.on('exit', (code) => {
        this.log(`[wine] instalador finalizou com código ${code}`);
        this.wineProc = null;
        resolve({ success: true });
      });

      this.wineProc = wineProc;
      resolve({ success: true });
    });
  }

  async stop(): Promise<void> {
    this.log('Encerrando desktop virtual...');

    const kill = (proc: ChildProcess | null, name: string) => {
      if (proc && !proc.killed) {
        try { proc.kill('SIGTERM'); } catch {}
        this.log(`[${name}] encerrado`);
      }
    };

    kill(this.wineProc, 'wine');
    kill(this.websockifyProc, 'websockify');
    kill(this.vncProc, 'x11vnc');
    kill(this.openboxProc, 'openbox');
    await this.delay(500);
    kill(this.xvfbProc, 'Xvfb');

    this.wineProc = null;
    this.websockifyProc = null;
    this.vncProc = null;
    this.openboxProc = null;
    this.xvfbProc = null;
    this.status = 'stopped';
    this.startedAt = null;
    this.log('Desktop virtual encerrado');
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const virtualDesktop = new VirtualDesktopService();
