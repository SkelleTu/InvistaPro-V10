import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ChevronLeft, Monitor, Play, Square, Download, RefreshCw,
  Loader2, AlertTriangle, CheckCircle2, Terminal, Maximize2, Minimize2
} from "lucide-react";

interface DesktopStatus {
  status: "stopped" | "starting" | "running" | "error";
  error: string;
  startedAt: number | null;
  vncPort: number;
  websockifyPort: number;
  logs: string[];
  hasXvfb: boolean;
  hasVnc: boolean;
  hasWebsockify: boolean;
  mt5Installed: boolean;
  wineReady: boolean;
}

export default function MetaTrader5Page() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showLogs, setShowLogs] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const desktopContainerRef = useRef<HTMLDivElement>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const { data: status, isLoading } = useQuery<DesktopStatus>({
    queryKey: ["/api/desktop/status"],
    refetchInterval: 3000,
  });

  const startMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/desktop/start", { method: "POST" });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        toast({ title: "Desktop iniciado!", description: "Ambiente Windows carregando..." });
        queryClient.invalidateQueries({ queryKey: ["/api/desktop/status"] });
      } else {
        toast({ title: "Erro ao iniciar", description: data.error, variant: "destructive" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/desktop/stop", { method: "POST" });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Desktop encerrado" });
      queryClient.invalidateQueries({ queryKey: ["/api/desktop/status"] });
    },
  });

  const installMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/desktop/install-mt5", { method: "POST" });
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.success) {
        toast({ title: "Instalador iniciado!", description: "Siga o assistente no desktop virtual." });
      } else {
        toast({ title: "Erro na instalação", description: data.error, variant: "destructive" });
      }
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [status?.logs]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement && desktopContainerRef.current) {
      desktopContainerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handler = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const isRunning = status?.status === "running";
  const isStarting = status?.status === "starting" || startMutation.isPending;
  const isStopped = !status || status.status === "stopped" || status.status === "error";

  const statusBadge = () => {
    if (isStarting) return <Badge className="bg-yellow-500 text-white gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Iniciando...</Badge>;
    if (isRunning) return <Badge className="bg-green-500 text-white gap-1.5"><CheckCircle2 className="h-3 w-3" />Rodando</Badge>;
    if (status?.status === "error") return <Badge className="bg-red-500 text-white gap-1.5"><AlertTriangle className="h-3 w-3" />Erro</Badge>;
    return <Badge variant="secondary" className="gap-1.5"><Square className="h-3 w-3" />Parado</Badge>;
  };

  const reloadViewer = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <div className="border-b border-border bg-card px-4 py-3 flex items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/")}
            data-testid="button-back"
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Dashboard
          </Button>
          <div className="flex items-center gap-2">
            <Monitor className="h-5 w-5 text-primary" />
            <h1 className="font-bold text-lg">MetaTrader 5</h1>
            <span className="text-xs text-muted-foreground hidden sm:inline">— Desktop Virtual</span>
          </div>
          {statusBadge()}
        </div>

        <div className="flex items-center gap-2">
          {isStopped && !isStarting && (
            <Button
              size="sm"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              data-testid="button-start-desktop"
              className="gap-1.5"
            >
              {startMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Iniciar Desktop
            </Button>
          )}

          {isRunning && (
            <>
              {status?.mt5Installed ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => installMutation.mutate()}
                  disabled={installMutation.isPending}
                  data-testid="button-launch-mt5"
                  className="gap-1.5 border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-950"
                >
                  {installMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  <span className="hidden sm:inline">Iniciar MT5</span>
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => installMutation.mutate()}
                  disabled={installMutation.isPending}
                  data-testid="button-install-mt5"
                  className="gap-1.5"
                >
                  {installMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  <span className="hidden sm:inline">Instalar MT5</span>
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={reloadViewer}
                data-testid="button-reload-viewer"
                className="gap-1.5"
              >
                <RefreshCw className="h-4 w-4" />
                <span className="hidden sm:inline">Recarregar</span>
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => stopMutation.mutate()}
                disabled={stopMutation.isPending}
                data-testid="button-stop-desktop"
                className="gap-1.5"
              >
                {stopMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                <span className="hidden sm:inline">Parar</span>
              </Button>
            </>
          )}

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowLogs(v => !v)}
            data-testid="button-toggle-logs"
            className="gap-1.5 text-muted-foreground"
          >
            <Terminal className="h-4 w-4" />
            <span className="hidden sm:inline">Logs</span>
          </Button>
        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop viewport */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Windows chrome */}
          <div
            ref={desktopContainerRef}
            className="flex-1 flex flex-col bg-[#1a1a2e] overflow-hidden"
            style={{ minHeight: 0 }}
          >
            {/* Windows title bar */}
            <div className="bg-[#0078d4] flex items-center justify-between px-3 py-1.5 shrink-0 select-none">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-sm bg-white/20 flex items-center justify-center">
                  <Monitor className="h-2.5 w-2.5 text-white" />
                </div>
                <span className="text-white text-xs font-medium">MetaTrader 5 — Desktop Virtual</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={toggleFullscreen}
                  className="w-7 h-5 rounded hover:bg-white/20 flex items-center justify-center transition-colors"
                  title={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
                >
                  {isFullscreen
                    ? <Minimize2 className="h-3 w-3 text-white" />
                    : <Maximize2 className="h-3 w-3 text-white" />
                  }
                </button>
              </div>
            </div>

            {/* Desktop area */}
            <div className="flex-1 relative overflow-hidden bg-[#008080]" style={{ minHeight: 0 }}>
              {isRunning ? (
                <iframe
                  ref={iframeRef}
                  src="/vnc-viewer.html"
                  className="w-full h-full border-0"
                  data-testid="iframe-vnc-viewer"
                  allow="fullscreen"
                  title="Desktop Virtual MetaTrader 5"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white gap-6">
                  <div className="flex flex-col items-center gap-4 text-center px-6">
                    <Monitor className="h-20 w-20 text-white/30" />
                    {isStarting ? (
                      <>
                        <Loader2 className="h-10 w-10 animate-spin text-blue-300" />
                        <div>
                          <p className="font-semibold text-lg">Iniciando ambiente...</p>
                          <p className="text-sm text-white/60 mt-1">Aguarde enquanto o desktop virtual é preparado</p>
                        </div>
                        <div className="w-48 h-1.5 bg-white/10 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-400 rounded-full animate-pulse" style={{ width: "70%" }} />
                        </div>
                      </>
                    ) : status?.status === "error" ? (
                      <>
                        <AlertTriangle className="h-10 w-10 text-red-400" />
                        <div>
                          <p className="font-semibold text-lg text-red-300">Erro no desktop</p>
                          <p className="text-sm text-white/60 mt-1">{status.error}</p>
                        </div>
                        <Button
                          onClick={() => startMutation.mutate()}
                          className="gap-2 bg-blue-600 hover:bg-blue-700"
                          data-testid="button-retry-start"
                        >
                          <RefreshCw className="h-4 w-4" />
                          Tentar novamente
                        </Button>
                      </>
                    ) : (
                      <>
                        <div>
                          <p className="font-semibold text-lg">Desktop Virtual</p>
                          <p className="text-sm text-white/60 mt-1">
                            Clique em "Iniciar Desktop" para ligar o ambiente Windows
                          </p>
                          <p className="text-xs text-white/40 mt-1">
                            O MetaTrader 5 será executado aqui via Wine
                          </p>
                        </div>
                        <Button
                          onClick={() => startMutation.mutate()}
                          disabled={startMutation.isPending}
                          className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                          data-testid="button-start-desktop-center"
                          size="lg"
                        >
                          <Play className="h-5 w-5" />
                          Iniciar Desktop
                        </Button>
                      </>
                    )}
                  </div>

                  {/* Windows taskbar mockup */}
                  <div className="absolute bottom-0 left-0 right-0 h-10 bg-[#c0c0c0] border-t-2 border-white flex items-center px-1 gap-1">
                    <button className="h-8 px-2 bg-[#c0c0c0] border border-t-white border-l-white border-b-gray-600 border-r-gray-600 text-xs font-bold flex items-center gap-1">
                      <Monitor className="h-3 w-3" />
                      <span>Iniciar</span>
                    </button>
                    <div className="flex-1" />
                    <div className="text-xs text-gray-700 pr-2">
                      {new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Status bar */}
            <div className="bg-[#c0c0c0] border-t border-gray-400 px-3 py-1 flex items-center gap-4 text-xs text-gray-700 shrink-0 select-none">
              <span>
                {isRunning
                  ? status?.mt5Installed
                    ? "✅ MT5 instalado — clique 'Iniciar MT5' para abrir"
                    : "⏳ Inicializando Wine e instalador MT5..."
                  : isStarting
                  ? "⏳ Iniciando componentes..."
                  : "⬜ Desktop parado"}
              </span>
              {isRunning && status?.startedAt && (
                <span className="text-gray-500">
                  {new Date(status.startedAt).toLocaleTimeString('pt-BR')}
                </span>
              )}
              <div className="flex-1" />
              {isRunning && (
                <div className="flex items-center gap-2">
                  <span className={status?.hasXvfb ? "text-green-700" : "text-red-600"}>
                    Xvfb {status?.hasXvfb ? "✓" : "✗"}
                  </span>
                  <span className={status?.hasVnc ? "text-green-700" : "text-red-600"}>
                    VNC {status?.hasVnc ? "✓" : "✗"}
                  </span>
                  <span className={status?.hasWebsockify ? "text-green-700" : "text-red-600"}>
                    WS {status?.hasWebsockify ? "✓" : "✗"}
                  </span>
                  <span className={status?.mt5Installed ? "text-green-700" : "text-orange-600"}>
                    MT5 {status?.mt5Installed ? "✓" : "..."}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Logs panel */}
        {showLogs && (
          <div className="w-80 border-l border-border bg-black flex flex-col shrink-0" data-testid="panel-logs">
            <div className="border-b border-gray-800 px-3 py-2 flex items-center justify-between">
              <span className="text-xs font-mono text-green-400 flex items-center gap-1.5">
                <Terminal className="h-3 w-3" />
                Logs do servidor
              </span>
              <button
                onClick={() => setShowLogs(false)}
                className="text-gray-500 hover:text-white text-xs"
                data-testid="button-close-logs"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 font-mono text-xs text-green-300 space-y-0.5">
              {status?.logs && status.logs.length > 0 ? (
                status.logs.map((line, i) => (
                  <div key={i} className="leading-5 whitespace-pre-wrap break-all" data-testid={`log-line-${i}`}>
                    {line}
                  </div>
                ))
              ) : (
                <div className="text-gray-600">Nenhum log ainda...</div>
              )}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* Info bar at bottom */}
      {!isRunning && !isStarting && (
        <div className="border-t border-border bg-card px-4 py-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span><strong>Passo 1:</strong> Clique em "Iniciar Desktop" para ligar o ambiente virtual</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span><strong>Passo 2:</strong> Aguarde o desktop carregar (~30s)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span><strong>Passo 3:</strong> O instalador MT5 abre automaticamente — siga o assistente na tela</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span><strong>Próximas vezes:</strong> Basta clicar "Iniciar MT5" — sem reinstalar</span>
          </div>
        </div>
      )}
    </div>
  );
}
