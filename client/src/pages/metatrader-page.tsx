import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, keepPreviousData } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Activity, TrendingUp, TrendingDown, Settings, Download, Wifi, WifiOff,
  BarChart2, Zap, Shield, RefreshCw, AlertTriangle, CheckCircle2,
  Brain, Target, DollarSign, ArrowUpRight, ArrowDownRight, Clock, Info, ChevronLeft,
  Eye, Cpu, XCircle, CheckCircle, Minus, ChevronDown, ChevronUp, Copy, ClipboardCheck,
  Flame, ArrowDownCircle, ArrowUpCircle, Gauge, Layers, History, Timer
} from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface MT5Status {
  connected: boolean;
  accountId: string;
  broker: string;
  lastHeartbeat: number;
  totalSignalsGenerated: number;
  totalTradesExecuted: number;
  openPositions: number;
  dailyProfit: number;
  dailyLoss: number;
  dailyWins: number;
  dailyLosses: number;
  winRate: number;
  activeSignal: any;
  recentTrades: any[];
  systemHealth: 'excellent' | 'good' | 'warning' | 'critical';
  cachedSymbols: string[];
  lastBalance?: number;
  lastEquity?: number;
  latestAIConsensus?: number;
  latestAIDirection?: 'up' | 'down' | 'neutral';
  latestAnalysisSymbol?: string;
  latestAnalysisAt?: number;
  consecutiveLosses?: number;
  circuitBreakerActive?: boolean;
  circuitBreakerRemainingMin?: number;
}

interface MT5Config {
  enabled: boolean;
  symbols: string[];
  defaultLotSize: number;
  maxLotSize: number;
  maxOpenPositions: number;
  maxDailyLoss: number;
  maxDailyProfit: number;
  stopLossPips: number;
  takeProfitPips: number;
  useAIStopLoss: boolean;
  useTrailingStop: boolean;
  trailingStopPips: number;
  signalTimeoutSeconds: number;
  pollingIntervalMs: number;
  riskPercent: number;
  apiToken: string;
  requireGirassolConfirmation: boolean;
  maxPositionsPerSymbol: number;
  invertGirassolBuffers: boolean;
  tradingTimeframe: 'day_trade' | 'swing_trade' | 'position_trade';
  tradingStyle: 'scalp' | 'alvo_longo';
}

interface AIModelResult {
  model: string;
  prediction: 'up' | 'down' | 'neutral';
  confidence: number;
  reasoning: string;
  narrative?: string;
}

interface AIAnalysisEntry {
  id: string;
  timestamp: number;
  symbol: string;
  phase: 'circuit_breaker' | 'data_check' | 'huggingface' | 'technical' | 'decision';
  status: 'processing' | 'approved' | 'rejected' | 'waiting' | 'blocked';
  aiConsensus?: number;
  aiDirection?: 'up' | 'down' | 'neutral';
  aiReasoning?: string;
  modelResults?: AIModelResult[];
  participatingModels?: number;
  technicalAction?: 'BUY' | 'SELL' | 'HOLD';
  technicalAgrees?: boolean;
  technicalScore?: number;
  indicators?: Record<string, any>;
  technicalNarrative?: string;
  finalDecision?: 'BUY' | 'SELL' | 'HOLD' | null;
  decisionReason: string;
  fullNarrative?: string;
  circuitBreakerActive?: boolean;
  consecutiveLosses?: number;
  circuitBreakerRemainingMin?: number;
  candlesAvailable?: number;
}

interface AIAnalysisResponse {
  log: AIAnalysisEntry[];
  latest: AIAnalysisEntry | null;
  total: number;
}

function ModelCard({ model, index }: { model: AIModelResult; index: number }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={`rounded-lg border transition-colors ${
        model.prediction === 'up' ? 'border-green-500/30 bg-green-500/5' :
        model.prediction === 'down' ? 'border-red-500/30 bg-red-500/5' :
        'border-yellow-500/30 bg-yellow-500/5'
      }`}
      data-testid={`card-model-${index}`}
    >
      <button
        className="w-full flex items-center gap-3 p-2 text-left"
        onClick={() => setExpanded(e => !e)}
      >
        <div className={`w-2 h-2 rounded-full shrink-0 ${
          model.prediction === 'up' ? 'bg-green-500' :
          model.prediction === 'down' ? 'bg-red-500' : 'bg-yellow-500'
        }`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <p className="text-xs font-medium truncate">{model.model}</p>
            <div className="flex items-center gap-2 shrink-0">
              <Badge variant="outline" className={`text-xs ${
                model.prediction === 'up' ? 'text-green-500 border-green-500' :
                model.prediction === 'down' ? 'text-red-500 border-red-500' :
                'text-yellow-500 border-yellow-500'
              }`}>
                {model.prediction === 'up' ? '↑ COMPRA' : model.prediction === 'down' ? '↓ VENDA' : '— NEUTRO'}
              </Badge>
              <span className="text-xs font-bold w-8 text-right">{model.confidence}%</span>
              {expanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
            </div>
          </div>
          <Progress value={model.confidence} className="h-1.5" />
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {model.narrative && (
            <p className="text-xs text-foreground/85 leading-relaxed bg-background/50 rounded p-2 border">
              {model.narrative}
            </p>
          )}
          {model.reasoning && !model.narrative && (
            <p className="text-xs text-muted-foreground">{model.reasoning}</p>
          )}
        </div>
      )}
    </div>
  );
}

const HEALTH_COLOR = {
  excellent: 'text-green-500',
  good: 'text-blue-500',
  warning: 'text-yellow-500',
  critical: 'text-red-500'
};

const HEALTH_LABEL = {
  excellent: 'Excelente',
  good: 'Bom',
  warning: 'Aguardando',
  critical: 'Crítico'
};

const ALL_SYMBOLS = ['EURUSD', 'GBPUSD', 'XAUUSD', 'USDJPY', 'BTCUSD', 'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'GBPJPY'];

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatTime(ts: number): string {
  if (!ts) return '—';
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function GirassolStatusBadge({ bias, description }: { bias?: string; description?: string }) {
  if (!bias || bias === 'NEUTRAL') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-muted bg-muted/30 text-xs text-muted-foreground">
        <span>🌻</span>
        <span>{description || 'Girassol: aguardando sinal'}</span>
      </div>
    );
  }
  if (bias === 'BUY') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-green-500/50 bg-green-500/10 text-xs text-green-500 font-medium">
        <span>🌻</span>
        <TrendingUp className="h-3.5 w-3.5" />
        <span>{description || 'Girassol: COMPRA (azul)'}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-red-500/50 bg-red-500/10 text-xs text-red-500 font-medium">
      <span>🌻</span>
      <TrendingDown className="h-3.5 w-3.5" />
      <span>{description || 'Girassol: VENDA (vermelho)'}</span>
    </div>
  );
}

export default function MetaTraderPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [configEdits, setConfigEdits] = useState<Partial<MT5Config>>({});
  const [newApiToken, setNewApiToken] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [urlCopied, setUrlCopied] = useState(false);
  const [platformUrlCopied, setPlatformUrlCopied] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [positionTimers, setPositionTimers] = useState<Record<number, number>>({});
  const analysisEndRef = useRef<HTMLDivElement>(null);

  const { data: status, isLoading: statusLoading } = useQuery<MT5Status>({
    queryKey: ['/api/mt5/status'],
    refetchInterval: 2000,
    placeholderData: keepPreviousData,
  });

  const { data: config, isLoading: configLoading } = useQuery<MT5Config>({
    queryKey: ['/api/mt5/config'],
    refetchInterval: 30000
  });

  const { data: positions } = useQuery<any[]>({
    queryKey: ['/api/mt5/positions'],
    refetchInterval: 2000
  });

  const { data: trades } = useQuery<any[]>({
    queryKey: ['/api/mt5/trades'],
    refetchInterval: 2000
  });

  const { data: activeSignal, isLoading: signalLoading } = useQuery<any>({
    queryKey: ['/api/mt5/signal'],
    refetchInterval: 3000,
    placeholderData: keepPreviousData,
  });

  const { data: aiAnalysis } = useQuery<AIAnalysisResponse>({
    queryKey: ['/api/mt5/ai-analysis'],
    refetchInterval: 2000,
    placeholderData: keepPreviousData,
  });

  const { data: spikeDashboard } = useQuery<any>({
    queryKey: ['/api/mt5/spike-dashboard'],
    refetchInterval: 3000
  });

  const { data: brazilNews } = useQuery<any>({
    queryKey: ['/api/mt5/brazil-news'],
    refetchInterval: 30000,
  });

  // Atualizar timestamp de "última atualização"
  useEffect(() => {
    setLastUpdated(new Date());
    setSecondsAgo(0);
  }, [status, positions, trades, aiAnalysis]);

  // Contador de segundos desde última atualização
  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsAgo(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Atualizar duração das posições abertas a cada segundo
  useEffect(() => {
    const interval = setInterval(() => {
      if (positions && positions.length > 0) {
        const now = Date.now();
        const timers: Record<number, number> = {};
        positions.forEach((pos: any) => {
          if (pos.openTime) {
            const openMs = pos.openTime * 1000 > now ? pos.openTime : pos.openTime * 1000;
            timers[pos.ticket] = Math.floor((now - openMs) / 1000);
          }
        });
        setPositionTimers(timers);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [positions]);

  // Auto-scroll do feed de análises quando chega nova entrada
  const prevAnalysisCount = useRef(0);
  useEffect(() => {
    if (aiAnalysis?.log && aiAnalysis.log.length > prevAnalysisCount.current) {
      prevAnalysisCount.current = aiAnalysis.log.length;
      if (activeTab === 'signals' && analysisEndRef.current) {
        analysisEndRef.current.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [aiAnalysis?.log?.length, activeTab]);

  const updateConfigMutation = useMutation({
    mutationFn: async (updates: Partial<MT5Config>) => {
      return await apiRequest('POST', '/api/mt5/config', updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mt5/config'] });
      queryClient.invalidateQueries({ queryKey: ['/api/mt5/status'] });
      toast({ title: 'Configuração salva', description: 'MetaTrader atualizado com sucesso.' });
      setConfigEdits({});
    },
    onError: (err: any) => {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  });

  const generateSignalMutation = useMutation({
    mutationFn: async (symbol: string) => {
      return await apiRequest('POST', '/api/mt5/signal/generate', { symbol });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mt5/signal'] });
      queryClient.invalidateQueries({ queryKey: ['/api/mt5/status'] });
      toast({ title: 'Sinal gerado', description: 'As IAs analisaram o mercado e geraram um novo sinal.' });
    }
  });

  const resetSessionMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/mt5/reset-session', {});
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/mt5/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/mt5/ai-analysis'] });
      const cleared = data?.cleared?.join(', ') || 'estado de sessão';
      toast({
        title: '✅ Sessão zerada com sucesso',
        description: `Removido: ${cleared}. Dados de aprendizado da IA preservados.`,
      });
    },
    onError: () => {
      toast({ title: 'Erro ao zerar sessão', description: 'Tente novamente.', variant: 'destructive' });
    }
  });

  const handleSaveConfig = () => {
    const updates = { ...configEdits };
    if (newApiToken) updates.apiToken = newApiToken;
    updateConfigMutation.mutate(updates);
    setNewApiToken('');
  };

  const cfg = { ...config, ...configEdits };

  const copyServerUrl = () => {
    navigator.clipboard.writeText(window.location.origin).then(() => {
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2500);
    });
  };

  const copyPlatformUrl = () => {
    navigator.clipboard.writeText(window.location.origin).then(() => {
      setPlatformUrlCopied(true);
      setTimeout(() => setPlatformUrlCopied(false), 2500);
    });
  };

  const downloadEA = () => {
    const a = document.createElement('a');
    a.href = '/api/mt5/download-ea';
    a.download = 'InvistaPRO_EA.mq5';
    a.click();
    toast({ title: 'Expert Advisor baixado!', description: 'URL e token da InvistaPRO já pré-configurados. Instale o .mq5 no MetaTrader, compile e adicione a URL do servidor nas Opções → Expert Advisors → WebRequest.' });
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation('/trading')}
              data-testid="button-back"
              className="gap-1.5 text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              Voltar
            </Button>
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-2">
                <BarChart2 className="h-8 w-8 text-primary" />
                MetaTrader Integration
              </h1>
              <p className="text-muted-foreground mt-1">
                5 IAs conectadas ao MetaTrader 4/5 via Expert Advisor
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {/* Badge tempo real */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground border rounded-full px-2.5 py-1">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-breathe" />
              <Timer className="h-3 w-3" />
              <span>
                {secondsAgo < 5 ? 'Agora mesmo' : `${secondsAgo}s atrás`}
              </span>
            </div>
            {/* Conexão EA */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
              status?.connected
                ? 'border-green-500 bg-green-500/10'
                : status?.systemHealth === 'critical'
                  ? 'border-red-500 bg-red-500/10'
                  : 'border-yellow-500 bg-yellow-500/10'
            }`}>
              {status?.connected
                ? <Wifi className="h-4 w-4 text-green-500" />
                : status?.systemHealth === 'critical'
                  ? <WifiOff className="h-4 w-4 text-red-500" />
                  : <WifiOff className="h-4 w-4 text-yellow-500" />
              }
              <span className={`text-sm font-medium ${
                status?.connected
                  ? 'text-green-500'
                  : status?.systemHealth === 'critical'
                    ? 'text-red-500'
                    : 'text-yellow-500'
              }`}>
                {status?.connected
                  ? `Conectado • ${status.broker}`
                  : status?.systemHealth === 'critical'
                    ? 'EA Desconectado'
                    : 'Aguardando EA'}
              </span>
            </div>
            <Button onClick={downloadEA} data-testid="button-download-ea" className="gap-2">
              <Download className="h-4 w-4" />
              Baixar EA
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card data-testid="card-status-health">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Saúde do Sistema</span>
                <Shield className={`h-4 w-4 ${HEALTH_COLOR[status?.systemHealth || 'good']}`} />
              </div>
              <p className={`text-xl font-bold mt-1 ${HEALTH_COLOR[status?.systemHealth || 'good']}`}>
                {HEALTH_LABEL[status?.systemHealth || 'good']}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">{status?.connected ? `EA: ${status.accountId || '—'}` : 'EA desconectado'}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-status-balance">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Saldo EA</span>
                <DollarSign className="h-4 w-4 text-green-500" />
              </div>
              <p className="text-xl font-bold mt-1 text-green-500">
                {status?.lastBalance ? `$${status.lastBalance.toFixed(2)}` : '—'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Equity: {status?.lastEquity ? `$${status.lastEquity.toFixed(2)}` : '—'}
              </p>
            </CardContent>
          </Card>
          <Card data-testid="card-status-ai-live">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">IA ao Vivo</span>
                <Brain className={`h-4 w-4 transition-colors duration-500 ${status?.latestAIConsensus !== undefined ? 'text-primary' : 'text-muted-foreground'}`} />
              </div>
              <p className={`text-xl font-bold mt-1 transition-colors duration-500 ${
                status?.latestAIConsensus !== undefined
                  ? status.latestAIConsensus >= 70 ? 'text-green-500' : 'text-yellow-500'
                  : 'text-muted-foreground'
              }`}>
                {status?.latestAIConsensus !== undefined ? `${status.latestAIConsensus.toFixed(0)}%` : '—'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {status?.latestAnalysisSymbol || 'Aguardando'}{status?.latestAIDirection ? ` · ${status.latestAIDirection === 'up' ? '↑' : status.latestAIDirection === 'down' ? '↓' : '—'}` : ''}
              </p>
            </CardContent>
          </Card>
          <Card data-testid="card-status-signals">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Sinais Gerados</span>
                <Zap className="h-4 w-4 text-primary" />
              </div>
              <p className="text-xl font-bold mt-1">{status?.totalSignalsGenerated || 0}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Win Rate: {status?.winRate?.toFixed(1) || 0}%</p>
            </CardContent>
          </Card>
          <Card data-testid="card-status-positions">
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Posições / Perdas</span>
                <Activity className="h-4 w-4 text-blue-500" />
              </div>
              <p className="text-xl font-bold mt-1 text-blue-500">{status?.openPositions || 0}</p>
              <p className={`text-xs mt-0.5 ${(status?.consecutiveLosses || 0) >= 2 ? 'text-red-500 font-semibold' : 'text-muted-foreground'}`}>
                {status?.circuitBreakerActive
                  ? `🛑 CB ativo — ${status.circuitBreakerRemainingMin}min`
                  : `Perdas consec.: ${status?.consecutiveLosses ?? 0}/3`}
              </p>
            </CardContent>
          </Card>
        </div>

        {!status?.connected && (
          <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4 flex flex-col sm:flex-row items-start gap-3" data-testid="banner-ea-disconnected">
            <AlertTriangle className="h-5 w-5 text-yellow-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <p className="font-semibold text-yellow-600 dark:text-yellow-400 text-sm">EA não conectado — URL do servidor pode ter mudado</p>
                <p className="text-xs text-muted-foreground mt-0.5">Atualize nos dois lugares abaixo sempre que o Replit reiniciar.</p>
              </div>
              <div className="space-y-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">① EA (F7 → Inputs → <strong>ServerURL</strong>)</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-background border rounded px-2 py-1 flex-1 truncate font-mono" data-testid="text-current-server-url">
                      {window.location.origin}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 gap-1.5 text-xs h-7"
                      onClick={copyServerUrl}
                      data-testid="button-copy-server-url"
                    >
                      {urlCopied ? <ClipboardCheck className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                      {urlCopied ? 'Copiado!' : 'Copiar'}
                    </Button>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">② Plataforma MT (Ferramentas → Opções → Expert Advisors → <strong>Permitir WebRequest</strong>)</p>
                  <div className="flex items-center gap-2">
                    <code className="text-xs bg-background border rounded px-2 py-1 flex-1 truncate font-mono" data-testid="text-current-platform-url">
                      {window.location.origin}
                    </code>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 gap-1.5 text-xs h-7"
                      onClick={copyPlatformUrl}
                      data-testid="button-copy-platform-url"
                    >
                      {platformUrlCopied ? <ClipboardCheck className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                      {platformUrlCopied ? 'Copiado!' : 'Copiar'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-6" data-testid="tabs-metatrader">
            <TabsTrigger value="dashboard" data-testid="tab-dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="signals" data-testid="tab-signals">Sinais & IAs</TabsTrigger>
            <TabsTrigger value="spike" data-testid="tab-spike" className="relative">
              <Flame className="h-3.5 w-3.5 mr-1" />
              Spike
              {spikeDashboard?.criticalAlerts?.length > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">
                  {spikeDashboard.criticalAlerts.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="positions" data-testid="tab-positions" className="relative">
              Posições
              {positions && positions.length > 0 && (
                <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-blue-500 text-white text-[10px] flex items-center justify-center font-bold">
                  {positions.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="history" data-testid="tab-history">
              <History className="h-3.5 w-3.5 mr-1" />
              Histórico
            </TabsTrigger>
            <TabsTrigger value="config" data-testid="tab-config">Config</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-4 mt-4">

            {/* Status Girassol em tempo real */}
            {activeSignal && (activeSignal.girassolBias || activeSignal.girassolDescription) && (
              <GirassolStatusBadge
                bias={activeSignal.girassolBias}
                description={activeSignal.girassolDescription}
              />
            )}

            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <DollarSign className="h-5 w-5 text-primary" />
                    Resultado do Dia
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Ganhos</span>
                    <span className="text-green-500 font-bold">+${status?.dailyProfit?.toFixed(2) || '0.00'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Perdas</span>
                    <span className="text-red-500 font-bold">-${status?.dailyLoss?.toFixed(2) || '0.00'}</span>
                  </div>
                  <Separator />
                  <div className="flex justify-between items-center">
                    <span className="font-medium">Resultado Líquido</span>
                    <span className={`font-bold text-lg ${(status?.dailyProfit || 0) - (status?.dailyLoss || 0) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {((status?.dailyProfit || 0) - (status?.dailyLoss || 0)) >= 0 ? '+' : ''}
                      ${((status?.dailyProfit || 0) - (status?.dailyLoss || 0)).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex gap-4 pt-2">
                    <div className="flex items-center gap-1 text-sm">
                      <ArrowUpRight className="h-4 w-4 text-green-500" />
                      <span className="text-green-500 font-medium">{status?.dailyWins || 0} wins</span>
                    </div>
                    <div className="flex items-center gap-1 text-sm">
                      <ArrowDownRight className="h-4 w-4 text-red-500" />
                      <span className="text-red-500 font-medium">{status?.dailyLosses || 0} losses</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Zap className="h-5 w-5 text-yellow-500" />
                    Sinal Ativo das IAs
                    <div className={`w-2 h-2 rounded-full ml-auto ${activeSignal?.action && activeSignal.action !== 'HOLD' ? 'bg-green-500 animate-breathe' : 'bg-yellow-500'}`} />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const isActive = !!(activeSignal?.action && activeSignal.action !== 'HOLD');
                    return (
                      <div>
                        {/* Bloco sinal ativo — sempre no DOM, nunca desmontado */}
                        <div className={`space-y-3 overflow-hidden transition-all duration-500 ease-in-out ${isActive ? 'opacity-100 max-h-[500px]' : 'opacity-0 max-h-0 pointer-events-none'}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-xl font-bold">{activeSignal?.symbol || '—'}</span>
                            <div className="flex items-center gap-2">
                              {activeSignal?.source === 'deriv_bot' && (
                                <Badge variant="outline" className="text-xs border-primary/40 text-primary">Deriv Bot</Badge>
                              )}
                              <Badge className={activeSignal?.action === 'BUY' ? 'bg-green-500' : 'bg-red-500'}>
                                {activeSignal?.action}
                              </Badge>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-muted-foreground">Confiança</span>
                              <p className="font-medium text-primary">{(((activeSignal?.confidence) || 0) * 100).toFixed(1)}%</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">IAs Ativas</span>
                              <p className="font-medium">{activeSignal?.aiSources?.length || 5}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Stop Loss</span>
                              <p className="font-medium text-red-500">
                                {(activeSignal?.stopLoss ?? 0) > 0 ? activeSignal!.stopLoss.toFixed(2) : (activeSignal?.stopLossPips ?? 0) > 0 ? `${activeSignal!.stopLossPips} pips` : 'IA dinâmico'}
                              </p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Take Profit</span>
                              <p className="font-medium text-green-500">
                                {(activeSignal?.takeProfit ?? 0) > 0 ? activeSignal!.takeProfit.toFixed(2) : (activeSignal?.takeProfitPips ?? 0) > 0 ? `${activeSignal!.takeProfitPips} pips` : 'IA dinâmico'}
                              </p>
                            </div>
                          </div>
                          {activeSignal?.girassolDescription && (
                            <GirassolStatusBadge bias={activeSignal.girassolBias} description={activeSignal.girassolDescription} />
                          )}
                          <p className="text-xs text-muted-foreground border-t pt-2">{activeSignal?.reason}</p>
                        </div>

                        {/* Bloco HOLD — sempre no DOM, nunca desmontado */}
                        <div className={`space-y-3 overflow-hidden transition-all duration-500 ease-in-out ${!isActive ? 'opacity-100 max-h-[500px]' : 'opacity-0 max-h-0 pointer-events-none'}`}>
                          <div className="flex items-center gap-2 p-2 rounded-md bg-yellow-500/10 border border-yellow-500/30">
                            <Clock className="h-4 w-4 text-yellow-500 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-yellow-600 dark:text-yellow-400">IAs monitorando — aguardando consenso ≥70%</p>
                              <p className="text-xs text-muted-foreground truncate">{activeSignal?.reason || 'Análise em progresso...'}</p>
                            </div>
                            <Badge variant="outline" className="shrink-0 text-yellow-500 border-yellow-500">HOLD</Badge>
                          </div>
                          {status?.latestAIConsensus !== undefined && (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground flex items-center gap-1">
                                  <Brain className="h-3 w-3" />
                                  Consenso real — {status.latestAnalysisSymbol || '—'}
                                  {status.latestIsRecoveryMode && <span className="text-orange-500 font-semibold ml-1">🔴 Recovery</span>}
                                </span>
                                <span className={`font-bold transition-colors duration-500 ${
                                  status.latestAIDirection === 'neutral' ? 'text-yellow-500'
                                  : status.latestAIConsensus >= (status.latestRequiredConsensus ?? 70) ? 'text-green-500' : 'text-red-500'
                                }`}>
                                  {status.latestAIConsensus.toFixed(1)}%
                                  {status.latestAIDirection && <span className="ml-1">{status.latestAIDirection === 'up' ? '↑' : status.latestAIDirection === 'down' ? '↓' : '—'}</span>}
                                </span>
                              </div>
                              <Progress value={status.latestAIConsensus} className="h-2" />
                              <div className="flex justify-between text-xs text-muted-foreground">
                                <span>0%</span>
                                <span className={status.latestIsRecoveryMode ? 'text-orange-500 font-semibold' : 'text-yellow-500'}>
                                  {status.latestRequiredConsensus ?? 70}% mínimo{status.latestIsRecoveryMode ? ' (recovery)' : ''}
                                </span>
                                <span>100%</span>
                              </div>
                              {status.latestAIDirection === 'neutral' && (
                                <p className="text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950/30 rounded px-2 py-1">
                                  ⚠️ IAs retornaram NEUTRO — sem direção clara, operação bloqueada
                                </p>
                              )}
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-muted/30 rounded p-2">
                              <p className="text-muted-foreground">Stop Loss</p>
                              <p className="font-semibold text-blue-400">IA dinâmico (ATR)</p>
                            </div>
                            <div className="bg-muted/30 rounded p-2">
                              <p className="text-muted-foreground">Take Profit</p>
                              <p className="font-semibold text-blue-400">IA dinâmico (Fib)</p>
                            </div>
                            <div className="bg-muted/30 rounded p-2">
                              <p className="text-muted-foreground">Última análise</p>
                              <p className="font-semibold">{status?.latestAnalysisAt ? formatTime(status.latestAnalysisAt) : '—'}</p>
                            </div>
                            <div className="bg-muted/30 rounded p-2">
                              <p className="text-muted-foreground">Perdas consec.</p>
                              <p className={`font-semibold transition-colors duration-500 ${(status?.consecutiveLosses || 0) >= 2 ? 'text-red-500' : 'text-green-500'}`}>
                                {status?.consecutiveLosses ?? 0}/3
                              </p>
                            </div>
                          </div>
                          {!status?.connected && <p className="text-xs text-yellow-500 text-center">⚠️ Conecte o EA ao MT5 para receber sinais</p>}
                        </div>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>
            </div>

            {/* Posições abertas em miniatura no dashboard */}
            {positions && positions.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="h-5 w-5 text-blue-500" />
                    Posições Abertas — Monitoramento em Tempo Real
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-breathe ml-auto" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {positions.map((pos: any) => {
                      const duration = positionTimers[pos.ticket] || 0;
                      return (
                        <div key={pos.ticket} className={`flex items-center justify-between p-3 rounded-lg border ${pos.profit >= 0 ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`} data-testid={`dash-position-${pos.ticket}`}>
                          <div className="flex items-center gap-3">
                            {pos.type === 'BUY'
                              ? <TrendingUp className="h-4 w-4 text-green-500" />
                              : <TrendingDown className="h-4 w-4 text-red-500" />}
                            <div>
                              <p className="font-bold text-sm">{pos.symbol}</p>
                              <p className="text-xs text-muted-foreground">#{pos.ticket} • {pos.lots} lot • entrada: {pos.openPrice}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatDuration(duration)}
                            </div>
                            <div className="text-right">
                              <p className={`font-bold ${pos.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {pos.profit >= 0 ? '+' : ''}${pos.profit?.toFixed(2)}
                              </p>
                              <p className="text-xs text-muted-foreground">{pos.type}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <History className="h-5 w-5 text-muted-foreground" />
                  Últimas Operações Fechadas
                </CardTitle>
              </CardHeader>
              <CardContent>
                {trades && trades.length > 0 ? (
                  <div className="space-y-2">
                    {trades.slice(0, 8).map((trade: any, i: number) => (
                      <div key={i} className="flex items-center justify-between py-2 border-b last:border-0" data-testid={`row-trade-${i}`}>
                        <div className="flex items-center gap-3">
                          <Badge variant={trade.type === 'BUY' ? 'default' : 'secondary'} className={trade.type === 'BUY' ? 'bg-blue-500' : 'bg-purple-500'}>
                            {trade.type}
                          </Badge>
                          <div>
                            <p className="font-medium text-sm">{trade.symbol}</p>
                            <p className="text-xs text-muted-foreground">{trade.lots} lots • #{trade.ticket}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-bold ${trade.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {trade.profit >= 0 ? '+' : ''}${trade.profit?.toFixed(2)}
                          </p>
                          <Badge variant="outline" className="text-xs">{trade.closeReason || 'CLOSED'}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
                    <History className="h-10 w-10 opacity-30" />
                    <p className="text-sm">Nenhuma operação fechada nesta sessão</p>
                    <p className="text-xs">O histórico aparecerá aqui quando posições forem encerradas</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="signals" className="space-y-4 mt-4">

            {/* Circuit breaker warning */}
            {aiAnalysis?.latest?.circuitBreakerActive && (
              <Card className="border-red-500 bg-red-500/10" data-testid="card-circuit-breaker">
                <CardContent className="pt-4">
                  <div className="flex items-center gap-3">
                    <Shield className="h-6 w-6 text-red-500 shrink-0" />
                    <div className="flex-1">
                      <p className="font-bold text-red-500">Circuit Breaker Ativo</p>
                      <p className="text-sm text-muted-foreground">
                        {aiAnalysis.latest.consecutiveLosses} perdas consecutivas — Pausa de {aiAnalysis.latest.circuitBreakerRemainingMin} min para proteção da banca
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-red-500/50 text-red-500 hover:bg-red-500/10 shrink-0"
                      onClick={() => resetSessionMutation.mutate()}
                      disabled={resetSessionMutation.isPending}
                      data-testid="button-reset-session-cb"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 mr-1 ${resetSessionMutation.isPending ? 'animate-spin' : ''}`} />
                      Zerar Sessão
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Reset de Sessão — visível somente quando Recovery está ativo */}
            {status?.latestIsRecoveryMode && !aiAnalysis?.latest?.circuitBreakerActive && (
              <Card className="border-orange-500/40 bg-orange-500/5" data-testid="card-recovery-reset">
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-orange-500 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-orange-500">
                          🔴 Modo Recovery ativo
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Threshold elevado após perdas consecutivas. Zere para novo contexto de análise.
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-orange-500/50 text-orange-500 hover:bg-orange-500/10 shrink-0"
                      onClick={() => resetSessionMutation.mutate()}
                      disabled={resetSessionMutation.isPending}
                      data-testid="button-reset-session-recovery"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 mr-1 ${resetSessionMutation.isPending ? 'animate-spin' : ''}`} />
                      {resetSessionMutation.isPending ? 'Zerando...' : 'Zerar Sessão de Testes'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Status bar: consenso ao vivo */}
            <div className="grid grid-cols-4 gap-3">
              <Card data-testid="card-live-consensus">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Consenso Real das IAs</p>
                  <p className={`text-2xl font-bold transition-colors duration-500 ${
                    status?.latestAIConsensus === undefined ? 'text-muted-foreground'
                    : status.latestAIDirection === 'neutral' ? 'text-yellow-500'
                    : status.latestAIConsensus >= (status.latestRequiredConsensus ?? 70) ? 'text-green-500' : 'text-red-500'
                  }`}>
                    {status?.latestAIConsensus !== undefined ? `${status.latestAIConsensus.toFixed(1)}%` : '—'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    {status?.latestAnalysisSymbol || 'Aguardando símbolo'}
                    {status?.latestAIDirection && <span>{status.latestAIDirection === 'up' ? ' ↑ COMPRA' : status.latestAIDirection === 'down' ? ' ↓ VENDA' : ' — NEUTRO'}</span>}
                  </p>
                </CardContent>
              </Card>
              <Card data-testid="card-min-consensus" className={`transition-colors duration-500 ${status?.latestIsRecoveryMode ? 'border-orange-500/50 bg-orange-500/5' : ''}`}>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">
                    {status?.latestIsRecoveryMode ? '🔴 Mínimo (Recovery)' : 'Mínimo Exigido'}
                  </p>
                  <p className={`text-2xl font-bold transition-colors duration-500 ${status?.latestIsRecoveryMode ? 'text-orange-500' : 'text-primary'}`}>
                    {status?.latestRequiredConsensus !== undefined ? `${status.latestRequiredConsensus}%` : '70%'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {status?.latestIsRecoveryMode ? 'Elevado por perdas consecutivas' : 'Limiar de segurança'}
                  </p>
                </CardContent>
              </Card>
              <Card data-testid="card-consecutive-losses">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Perdas Consecutivas</p>
                  <p className={`text-2xl font-bold ${(status?.consecutiveLosses || 0) >= 2 ? 'text-red-500' : 'text-green-500'}`}>
                    {status?.consecutiveLosses ?? aiAnalysis?.latest?.consecutiveLosses ?? 0}/3
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {status?.circuitBreakerActive ? `🛑 CB ativo — ${status.circuitBreakerRemainingMin}min restantes` : 'Circuit breaker em 3'}
                  </p>
                </CardContent>
              </Card>
              <Card data-testid="card-analyses-count">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Análises Realizadas</p>
                  <p className="text-2xl font-bold">{aiAnalysis?.total ?? 0}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {status?.latestAnalysisAt ? `Última: ${formatTime(status.latestAnalysisAt)}` : 'Desde o último restart'}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* ── CARD: Noticiário Brasileiro em Tempo Real ───────────── */}
            <Card className="border-yellow-500/30 bg-yellow-500/5" data-testid="card-brazil-news">
              <CardHeader className="pb-2 pt-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <span className="text-base">🇧🇷</span>
                  Sentimento Mercado Brasileiro — Noticiário em Tempo Real
                  <Badge variant="outline" className="text-xs gap-1 ml-auto">
                    <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-breathe" />
                    Atualiza a cada 30s
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="pb-3 space-y-3">
                {brazilNews ? (
                  <>
                    {/* Barra de sentimento geral */}
                    <div className="flex items-center gap-4">
                      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border font-bold text-sm ${
                        brazilNews.direction === 'bullish' ? 'border-green-500/50 bg-green-500/10 text-green-400' :
                        brazilNews.direction === 'bearish' ? 'border-red-500/50 bg-red-500/10 text-red-400' :
                        'border-yellow-500/50 bg-yellow-500/10 text-yellow-400'
                      }`}>
                        {brazilNews.direction === 'bullish' ? '↑ BULLISH' :
                         brazilNews.direction === 'bearish' ? '↓ BEARISH' : '— NEUTRO'}
                        <span className="text-lg font-black ml-1">{brazilNews.strength}%</span>
                      </div>
                      <div className="flex-1">
                        <Progress
                          value={brazilNews.strength}
                          className={`h-2.5 ${brazilNews.direction === 'bullish' ? '[&>div]:bg-green-500' : brazilNews.direction === 'bearish' ? '[&>div]:bg-red-500' : '[&>div]:bg-yellow-500'}`}
                        />
                        <p className="text-xs text-muted-foreground mt-1">{brazilNews.newsCount} notícias analisadas · Score: {brazilNews.score?.toFixed(3)}</p>
                      </div>
                      {/* Bloqueios ativos */}
                      {(brazilNews.aiInfluence?.blocksBuy || brazilNews.aiInfluence?.blocksSell) && (
                        <div className="flex items-center gap-1 px-2 py-1.5 rounded border border-red-500/50 bg-red-500/10 text-red-400 text-xs font-semibold">
                          🛑 {brazilNews.aiInfluence.blocksBuy ? 'BUY Suspenso' : 'SELL Suspenso'}
                        </div>
                      )}
                      {!brazilNews.aiInfluence?.blocksBuy && !brazilNews.aiInfluence?.blocksSell && Math.abs(brazilNews.aiInfluence?.confidenceModifier ?? 0) > 0.02 && (
                        <div className={`flex items-center gap-1 px-2 py-1.5 rounded border text-xs font-semibold ${
                          (brazilNews.aiInfluence?.confidenceModifier ?? 0) > 0 ? 'border-green-500/50 bg-green-500/10 text-green-400' : 'border-red-500/50 bg-red-500/10 text-red-400'
                        }`}>
                          {(brazilNews.aiInfluence?.confidenceModifier ?? 0) > 0 ? '▲' : '▼'} Conf {Math.round((brazilNews.aiInfluence?.confidenceModifier ?? 0) * 100)}%
                        </div>
                      )}
                    </div>

                    {/* Scores por categoria */}
                    {brazilNews.categories && (
                      <div className="grid grid-cols-5 gap-1.5 text-xs">
                        {[
                          { key: 'cambio', label: 'Câmbio', icon: '💱' },
                          { key: 'bolsa', label: 'Bolsa', icon: '📈' },
                          { key: 'juros', label: 'SELIC', icon: '🏦' },
                          { key: 'economia', label: 'Economia', icon: '🏭' },
                          { key: 'politica', label: 'Política', icon: '🏛️' },
                        ].map(cat => {
                          const val = brazilNews.categories[cat.key] ?? 0;
                          return (
                            <div key={cat.key} className="bg-background/60 rounded-md p-2 border text-center">
                              <p className="text-base">{cat.icon}</p>
                              <p className="text-muted-foreground">{cat.label}</p>
                              <p className={`font-bold ${val > 0.1 ? 'text-green-400' : val < -0.1 ? 'text-red-400' : 'text-yellow-400'}`}>
                                {val > 0.1 ? '↑' : val < -0.1 ? '↓' : '—'} {Math.abs(val * 100).toFixed(0)}%
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Top headlines recentes */}
                    {brazilNews.headlines && brazilNews.headlines.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                          <span>📰</span> Últimas Notícias Coletadas
                        </p>
                        <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                          {brazilNews.headlines.slice(0, 12).map((h: any, i: number) => (
                            <div key={i} className={`flex items-start gap-2 p-2 rounded text-xs border-l-2 ${
                              h.sentiment === 'bullish' ? 'border-green-500 bg-green-500/5' :
                              h.sentiment === 'bearish' ? 'border-red-500 bg-red-500/5' :
                              'border-border bg-muted/10'
                            }`}>
                              <span className="shrink-0 mt-0.5">
                                {h.sentiment === 'bullish' ? '📗' : h.sentiment === 'bearish' ? '📕' : '📄'}
                              </span>
                              <div className="flex-1 min-w-0">
                                <p className="leading-snug text-foreground/90 line-clamp-2">{h.title}</p>
                                <p className="text-muted-foreground mt-0.5">{h.source} · {h.sentiment === 'bullish' ? <span className="text-green-400">alta</span> : h.sentiment === 'bearish' ? <span className="text-red-400">baixa</span> : 'neutro'}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Razão de influência */}
                    {brazilNews.aiInfluence?.reason && (
                      <p className="text-xs text-muted-foreground bg-muted/30 rounded p-2 border-l-2 border-yellow-500/50">
                        {brazilNews.aiInfluence.reason}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-3 text-muted-foreground py-2">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <p className="text-sm">Coletando notícias brasileiras em tempo real...</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── CARD: Quadro de Votos das IAs ao Vivo ──────────────── */}
            {aiAnalysis?.latest?.modelResults && aiAnalysis.latest.modelResults.length > 0 && (
              <Card className="border-primary/30" data-testid="card-ai-vote-board">
                <CardHeader className="pb-2 pt-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Brain className="h-4 w-4 text-primary" />
                    Quadro de Votos — {aiAnalysis.latest.modelResults.length} IAs Analisando Agora
                    <span className="text-xs text-muted-foreground ml-1">· {aiAnalysis.latest.symbol}</span>
                    <Badge variant="outline" className="text-xs gap-1 ml-auto">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-breathe" />
                      {new Date(aiAnalysis.latest.timestamp).toLocaleTimeString('pt-BR')}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-3 space-y-3">
                  {/* Grade de votos por modelo */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {aiAnalysis.latest.modelResults.map((model: any, i: number) => {
                      const pred = model.prediction || model.direction || 'neutral';
                      const conf = ((model.confidence ?? 0) * 100);
                      const isUp   = pred === 'up'   || pred === 'BUY';
                      const isDown = pred === 'down'  || pred === 'SELL';
                      return (
                        <div key={i} className={`rounded-lg p-2.5 border text-xs ${
                          isUp   ? 'border-green-500/40 bg-green-500/8' :
                          isDown ? 'border-red-500/40 bg-red-500/8' :
                          'border-border bg-muted/20'
                        }`} data-testid={`vote-model-${i}`}>
                          <p className="font-semibold leading-tight mb-1.5 line-clamp-2 text-foreground/80" style={{fontSize:'10px'}}>
                            {model.modelName?.replace('FinBERT','FB').replace('RoBERTa','Rb').replace('XLM-','').replace('DistilRoBERTa','DistilRb').replace('CryptoBERT','CrypBT').replace('FinTwits','FTwits').replace('Zero-Shot','ZeroShot') || `IA ${i+1}`}
                          </p>
                          <div className="flex items-center justify-between gap-1">
                            <span className={`font-black text-sm ${isUp ? 'text-green-400' : isDown ? 'text-red-400' : 'text-yellow-400'}`}>
                              {isUp ? '↑' : isDown ? '↓' : '—'}
                            </span>
                            <span className={`font-bold ${conf >= 70 ? 'text-green-400' : conf >= 50 ? 'text-yellow-400' : 'text-muted-foreground'}`}>
                              {conf.toFixed(0)}%
                            </span>
                          </div>
                          <Progress value={conf} className={`h-1 mt-1 ${isUp ? '[&>div]:bg-green-500' : isDown ? '[&>div]:bg-red-500' : '[&>div]:bg-yellow-500'}`} />
                        </div>
                      );
                    })}
                  </div>

                  {/* Linha de sistemas especializados */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    {/* Quantum */}
                    {aiAnalysis.latest.quantumPrediction !== undefined && (
                      <div className="bg-background/60 rounded-lg p-2.5 border">
                        <p className="text-muted-foreground mb-1 flex items-center gap-1"><Zap className="h-3 w-3 text-purple-400"/>Sistema Quântico</p>
                        <p className={`font-bold ${aiAnalysis.latest.quantumPrediction === 'up' ? 'text-green-400' : aiAnalysis.latest.quantumPrediction === 'down' ? 'text-red-400' : 'text-yellow-400'}`}>
                          {aiAnalysis.latest.quantumPrediction === 'up' ? '↑ COMPRA' : aiAnalysis.latest.quantumPrediction === 'down' ? '↓ VENDA' : '— NEUTRO'}
                        </p>
                        {aiAnalysis.latest.quantumConfidence !== undefined && (
                          <Progress value={aiAnalysis.latest.quantumConfidence * 100} className="h-1 mt-1 [&>div]:bg-purple-500" />
                        )}
                      </div>
                    )}
                    {/* Microscopic */}
                    {aiAnalysis.latest.microscopicPrediction !== undefined && (
                      <div className="bg-background/60 rounded-lg p-2.5 border">
                        <p className="text-muted-foreground mb-1 flex items-center gap-1"><Gauge className="h-3 w-3 text-blue-400"/>Microscópico</p>
                        <p className={`font-bold ${aiAnalysis.latest.microscopicPrediction === 'up' ? 'text-green-400' : aiAnalysis.latest.microscopicPrediction === 'down' ? 'text-red-400' : 'text-yellow-400'}`}>
                          {aiAnalysis.latest.microscopicPrediction === 'up' ? '↑ COMPRA' : aiAnalysis.latest.microscopicPrediction === 'down' ? '↓ VENDA' : '— NEUTRO'}
                        </p>
                        {aiAnalysis.latest.microscopicConfidence !== undefined && (
                          <Progress value={aiAnalysis.latest.microscopicConfidence * 100} className="h-1 mt-1 [&>div]:bg-blue-500" />
                        )}
                      </div>
                    )}
                    {/* Volatilidade */}
                    {aiAnalysis.latest.volatility !== undefined && (
                      <div className="bg-background/60 rounded-lg p-2.5 border">
                        <p className="text-muted-foreground mb-1 flex items-center gap-1"><Activity className="h-3 w-3 text-orange-400"/>Volatilidade</p>
                        <p className="font-bold">{(aiAnalysis.latest.volatility * 100).toFixed(2)}%</p>
                        <p className="text-muted-foreground">{aiAnalysis.latest.marketRegime || '—'}</p>
                      </div>
                    )}
                    {/* Consenso geral */}
                    <div className={`rounded-lg p-2.5 border ${
                      aiAnalysis.latest.aiConsensus >= (aiAnalysis.latest.requiredConsensus ?? 70) ? 'border-green-500/50 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'
                    }`}>
                      <p className="text-muted-foreground mb-1 flex items-center gap-1"><CheckCircle2 className="h-3 w-3"/>Consenso Final</p>
                      <p className={`font-black text-lg ${aiAnalysis.latest.aiConsensus >= (aiAnalysis.latest.requiredConsensus ?? 70) ? 'text-green-400' : 'text-red-400'}`}>
                        {aiAnalysis.latest.aiConsensus?.toFixed(1)}%
                      </p>
                      <p className="text-muted-foreground">mín: {aiAnalysis.latest.requiredConsensus ?? 70}%{aiAnalysis.latest.isRecoveryMode ? ' 🔴' : ''}</p>
                    </div>
                  </div>

                  {/* Narrativa completa */}
                  {aiAnalysis.latest.decisionReason && (
                    <div className="bg-muted/30 rounded-lg p-3 border-l-4 border-primary text-xs leading-relaxed">
                      <p className="font-semibold text-primary mb-1 flex items-center gap-1">
                        <Brain className="h-3 w-3" /> Decisão das IAs
                      </p>
                      <p className="text-foreground/90">{aiAnalysis.latest.decisionReason}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Live AI activity — sempre visível mesmo sem log entries */}
            {status?.connected && (
              <Card className="border-primary/30 bg-primary/5" data-testid="card-live-ai-activity">
                <CardHeader className="pb-2 pt-3">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Brain className="h-4 w-4 text-primary" />
                    Atividade das IAs em Tempo Real
                    <Badge variant="outline" className="text-xs gap-1 ml-auto">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-breathe" />
                      Live
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div className="bg-background/60 rounded-lg p-2.5 border">
                      <p className="text-muted-foreground mb-1">EA Conectado</p>
                      <p className="font-bold text-green-500">{status.broker || '—'}</p>
                      <p className="text-muted-foreground">{status.accountId}</p>
                    </div>
                    <div className="bg-background/60 rounded-lg p-2.5 border">
                      <p className="text-muted-foreground mb-1">Saldo / Equity</p>
                      <p className="font-bold">{status.lastBalance ? `$${status.lastBalance.toFixed(2)}` : '—'}</p>
                      <p className="text-muted-foreground">{status.lastEquity ? `Eq: $${status.lastEquity.toFixed(2)}` : '—'}</p>
                    </div>
                    <div className="bg-background/60 rounded-lg p-2.5 border">
                      <p className="text-muted-foreground mb-1">Último símbolo analisado</p>
                      <p className="font-bold">{status.latestAnalysisSymbol || status.cachedSymbols?.[0] || '—'}</p>
                      <p className="text-muted-foreground">{status.latestAnalysisAt ? formatTime(status.latestAnalysisAt) : 'aguardando...'}</p>
                    </div>
                    <div className="bg-background/60 rounded-lg p-2.5 border">
                      <p className="text-muted-foreground mb-1">Próxima entrada</p>
                      <p className={`font-bold ${
                        status.latestAIDirection === 'neutral' ? 'text-yellow-500'
                        : status.latestAIConsensus !== undefined && status.latestAIConsensus >= (status.latestRequiredConsensus ?? 70) ? 'text-green-500'
                        : 'text-red-500'
                      }`}>
                        {status.latestAIDirection === 'neutral' ? '— NEUTRO'
                          : status.latestAIConsensus !== undefined && status.latestAIConsensus >= (status.latestRequiredConsensus ?? 70) ? '⚡ Pronto!'
                          : '⏳ Aguardando'}
                      </p>
                      <p className="text-muted-foreground">
                        {status.latestAIConsensus !== undefined
                          ? `${status.latestAIConsensus.toFixed(0)}% / ${status.latestRequiredConsensus ?? 70}% mínimo${status.latestIsRecoveryMode ? ' 🔴' : ''}`
                          : 'analisando...'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Última análise — detalhes completos */}
            {aiAnalysis?.latest && (
              <Card data-testid="card-latest-analysis">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-2">
                      <Eye className="h-5 w-5 text-primary" />
                      Última Análise — {aiAnalysis.latest.symbol}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {new Date(aiAnalysis.latest.timestamp).toLocaleTimeString('pt-BR')}
                      </span>
                      <Badge className={
                        aiAnalysis.latest.status === 'approved' ? 'bg-green-500' :
                        aiAnalysis.latest.status === 'rejected' ? 'bg-red-500' :
                        aiAnalysis.latest.status === 'blocked' ? 'bg-orange-500' :
                        aiAnalysis.latest.status === 'waiting' ? 'bg-yellow-500' :
                        'bg-blue-500'
                      }>
                        {aiAnalysis.latest.status === 'approved' ? '✅ Aprovado' :
                         aiAnalysis.latest.status === 'rejected' ? '❌ Rejeitado' :
                         aiAnalysis.latest.status === 'blocked' ? '🛑 Bloqueado' :
                         aiAnalysis.latest.status === 'waiting' ? '⏳ Aguardando' :
                         '🔄 Processando'}
                      </Badge>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm bg-muted/40 rounded-md p-3 border-l-4 border-primary">
                    {aiAnalysis.latest.decisionReason}
                  </p>

                  {/* Resumo geral em linguagem natural */}
                  {aiAnalysis.latest.fullNarrative && (
                    <div className="bg-muted/30 rounded-lg p-3 border-l-4 border-primary">
                      <p className="text-xs font-semibold text-primary mb-2 flex items-center gap-2">
                        <Brain className="h-3.5 w-3.5" />
                        Resumo Completo da Análise
                      </p>
                      <pre className="text-xs text-foreground/90 whitespace-pre-wrap font-sans leading-relaxed">
                        {aiAnalysis.latest.fullNarrative}
                      </pre>
                    </div>
                  )}

                  {/* Resultados por modelo de IA com narrativa expandível */}
                  {aiAnalysis.latest.modelResults && aiAnalysis.latest.modelResults.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <Brain className="h-4 w-4 text-primary" />
                        O que cada IA analisou — {aiAnalysis.latest.participatingModels} modelos
                      </p>
                      <div className="space-y-2">
                        {aiAnalysis.latest.modelResults.map((model, i) => (
                          <ModelCard key={i} model={model} index={i} />
                        ))}
                      </div>

                      {/* Consenso geral */}
                      {aiAnalysis.latest.aiConsensus !== undefined && (
                        <div className="mt-3 p-3 rounded-lg border bg-muted/20">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-semibold">Consenso Final das IAs</span>
                            <span className={`text-lg font-bold ${
                              aiAnalysis.latest.aiConsensus >= 80 ? 'text-green-500' :
                              aiAnalysis.latest.aiConsensus >= 70 ? 'text-blue-500' : 'text-red-500'
                            }`}>
                              {aiAnalysis.latest.aiConsensus.toFixed(1)}%
                              {aiAnalysis.latest.aiDirection && (
                                <span className="ml-2 text-sm">
                                  {aiAnalysis.latest.aiDirection === 'up' ? '↑ COMPRA' :
                                   aiAnalysis.latest.aiDirection === 'down' ? '↓ VENDA' : '— NEUTRO'}
                                </span>
                              )}
                            </span>
                          </div>
                          <Progress value={aiAnalysis.latest.aiConsensus} className="h-3" />
                          <div className="flex justify-between text-xs text-muted-foreground mt-1">
                            <span>0%</span>
                            <span className="text-yellow-500">70% mínimo</span>
                            <span>100%</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Indicadores técnicos com interpretação */}
                  {aiAnalysis.latest.indicators && (
                    <div>
                      <p className="text-sm font-semibold mb-3 flex items-center gap-2">
                        <BarChart2 className="h-4 w-4 text-primary" />
                        Indicadores Técnicos
                        {aiAnalysis.latest.technicalAction && (
                          <Badge variant="outline" className={`text-xs ml-auto ${
                            aiAnalysis.latest.technicalAction === 'BUY' ? 'text-green-500 border-green-500' :
                            aiAnalysis.latest.technicalAction === 'SELL' ? 'text-red-500 border-red-500' :
                            'text-muted-foreground'
                          }`}>
                            Sinal Técnico: {aiAnalysis.latest.technicalAction}
                            {aiAnalysis.latest.technicalAgrees !== undefined && (
                              <span className="ml-1">{aiAnalysis.latest.technicalAgrees ? '✓ Confirma IA' : '✗ Diverge da IA'}</span>
                            )}
                          </Badge>
                        )}
                      </p>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                        {[
                          { label: 'RSI (14)', value: aiAnalysis.latest.indicators.rsi?.toFixed(1), color: (aiAnalysis.latest.indicators.rsi < 30 || aiAnalysis.latest.indicators.rsi > 70) ? 'text-orange-500' : 'text-foreground' },
                          { label: 'MACD', value: aiAnalysis.latest.indicators.macd?.toFixed(5), color: aiAnalysis.latest.indicators.macd > 0 ? 'text-green-500' : 'text-red-500' },
                          { label: 'Sinal MACD', value: aiAnalysis.latest.indicators.macdSignal?.toFixed(5), color: 'text-foreground' },
                          { label: 'EMA 20', value: aiAnalysis.latest.indicators.ema20?.toFixed(4), color: 'text-foreground' },
                          { label: 'EMA 50', value: aiAnalysis.latest.indicators.ema50?.toFixed(4), color: 'text-foreground' },
                          { label: 'EMA 200', value: aiAnalysis.latest.indicators.ema200?.toFixed(4), color: 'text-foreground' },
                          { label: 'Boll. Upper', value: aiAnalysis.latest.indicators.bollingerUpper?.toFixed(4), color: 'text-blue-400' },
                          { label: 'Boll. Lower', value: aiAnalysis.latest.indicators.bollingerLower?.toFixed(4), color: 'text-blue-400' },
                          { label: 'ATR (14)', value: aiAnalysis.latest.indicators.atr?.toFixed(5), color: 'text-foreground' },
                          { label: 'ADX (14)', value: aiAnalysis.latest.indicators.adx?.toFixed(1), color: (aiAnalysis.latest.indicators.adx > 25) ? 'text-green-500' : 'text-muted-foreground' },
                          { label: 'Stoch %K', value: aiAnalysis.latest.indicators.stochK?.toFixed(1), color: 'text-foreground' },
                          { label: 'Stoch %D', value: aiAnalysis.latest.indicators.stochD?.toFixed(1), color: 'text-foreground' },
                          { label: 'Suporte', value: aiAnalysis.latest.indicators.support?.toFixed(4), color: 'text-green-500' },
                          { label: 'Resistência', value: aiAnalysis.latest.indicators.resistance?.toFixed(4), color: 'text-red-500' },
                          { label: 'Tendência', value: aiAnalysis.latest.indicators.trend, color: aiAnalysis.latest.indicators.trend === 'bullish' ? 'text-green-500' : aiAnalysis.latest.indicators.trend === 'bearish' ? 'text-red-500' : 'text-yellow-500' },
                          { label: 'Volatilidade', value: aiAnalysis.latest.indicators.volatility ? aiAnalysis.latest.indicators.volatility.toFixed(3) + '%' : '-', color: 'text-foreground' },
                        ].map((ind, i) => (
                          <div key={i} className="bg-muted/30 rounded p-2" data-testid={`indicator-${ind.label.replace(/\s/g,'-').toLowerCase()}`}>
                            <p className="text-xs text-muted-foreground">{ind.label}</p>
                            <p className={`text-sm font-bold ${ind.color}`}>{ind.value ?? '—'}</p>
                          </div>
                        ))}
                      </div>

                      {/* Interpretação em linguagem natural dos indicadores */}
                      {aiAnalysis.latest.technicalNarrative && (
                        <div className="bg-muted/20 rounded-lg p-3 border-l-4 border-blue-500">
                          <p className="text-xs font-semibold text-blue-500 mb-2 flex items-center gap-2">
                            <BarChart2 className="h-3.5 w-3.5" />
                            Interpretação dos Indicadores em Linguagem Natural
                          </p>
                          <p className="text-xs text-foreground/90 leading-relaxed">{aiAnalysis.latest.technicalNarrative}</p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Feed de análises em tempo real */}
            <Card data-testid="card-analysis-feed">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <Cpu className="h-5 w-5 text-primary" />
                    Feed de Análises em Tempo Real
                  </span>
                  <Badge variant="outline" className="text-xs gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-breathe" />
                    Atualiza a cada 3s
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {aiAnalysis?.log && aiAnalysis.log.length > 0 ? (
                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {aiAnalysis.log.slice(0, 30).map((entry, i) => (
                      <div key={entry.id} className={`flex gap-3 p-2 rounded-lg border text-xs ${
                        entry.status === 'approved' ? 'border-green-500/30 bg-green-500/5' :
                        entry.status === 'rejected' ? 'border-red-500/30 bg-red-500/5' :
                        entry.status === 'blocked' ? 'border-orange-500/30 bg-orange-500/5' :
                        entry.status === 'waiting' ? 'border-yellow-500/30 bg-yellow-500/5' :
                        'border-border bg-muted/20'
                      }`} data-testid={`feed-entry-${i}`}>
                        <div className="shrink-0 mt-0.5">
                          {entry.status === 'approved' ? <CheckCircle className="h-3.5 w-3.5 text-green-500" /> :
                           entry.status === 'rejected' ? <XCircle className="h-3.5 w-3.5 text-red-500" /> :
                           entry.status === 'blocked' ? <Shield className="h-3.5 w-3.5 text-orange-500" /> :
                           entry.status === 'waiting' ? <Clock className="h-3.5 w-3.5 text-yellow-500" /> :
                           <RefreshCw className="h-3.5 w-3.5 text-blue-500" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-bold">{entry.symbol}</span>
                              <Badge variant="outline" className="text-xs py-0 h-4">
                                {entry.phase === 'circuit_breaker' ? '🛑 CB' :
                                 entry.phase === 'data_check' ? '📊 Dados' :
                                 entry.phase === 'huggingface' ? '🧠 IA' :
                                 entry.phase === 'technical' ? '📈 Técnico' :
                                 '🎯 Decisão'}
                              </Badge>
                              {entry.aiConsensus !== undefined && (
                                <span className={`font-semibold ${entry.aiConsensus >= 70 ? 'text-green-500' : 'text-red-500'}`}>
                                  {entry.aiConsensus.toFixed(0)}%
                                </span>
                              )}
                              {entry.finalDecision && entry.finalDecision !== 'HOLD' && (
                                <Badge className={`text-xs py-0 h-4 ${entry.finalDecision === 'BUY' ? 'bg-green-500' : 'bg-red-500'}`}>
                                  {entry.finalDecision}
                                </Badge>
                              )}
                            </div>
                            <span className="text-muted-foreground shrink-0">
                              {new Date(entry.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-muted-foreground leading-tight">{entry.decisionReason}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3 py-4">
                    <div className="flex flex-col items-center text-muted-foreground gap-2 pb-2">
                      <Cpu className="h-8 w-8 opacity-30" />
                      <p className="font-medium text-sm">Aguardando primeiras análises...</p>
                      <p className="text-xs text-center max-w-sm">
                        O feed é preenchido automaticamente à medida que o EA envia dados do MT5. O EA está {status?.connected ? <span className="text-green-500 font-medium">conectado</span> : <span className="text-yellow-500 font-medium">aguardando</span>}.
                      </p>
                    </div>
                    {status?.connected && (
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="flex items-center gap-2 p-2.5 rounded-lg border bg-muted/20">
                          <div className="w-2 h-2 rounded-full bg-green-500 animate-breathe shrink-0" />
                          <div>
                            <p className="font-semibold">EA Ativo</p>
                            <p className="text-muted-foreground">{status.broker} · {status.accountId}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 p-2.5 rounded-lg border bg-muted/20">
                          <Brain className="h-4 w-4 text-primary shrink-0" />
                          <div>
                            <p className="font-semibold">HuggingFace + 4 IAs</p>
                            <p className="text-muted-foreground">Analisando mercado</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 p-2.5 rounded-lg border bg-muted/20">
                          <Target className="h-4 w-4 text-yellow-500 shrink-0" />
                          <div>
                            <p className="font-semibold">Limiar: 70%</p>
                            <p className="text-muted-foreground">Consenso mínimo</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Gerar sinal manual */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Zap className="h-5 w-5 text-yellow-500" />
                  Forçar Análise Manual
                </CardTitle>
                <CardDescription>
                  {status?.cachedSymbols?.length
                    ? `Ativos ativos no EA da corretora ${status.broker || 'conectada'}`
                    : 'Aguardando dados do EA — conecte o MetaTrader para ver os ativos disponíveis'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {status?.cachedSymbols?.length ? (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {status.cachedSymbols.map((sym: string) => (
                      <Button
                        key={sym}
                        variant="outline"
                        onClick={() => generateSignalMutation.mutate(sym)}
                        disabled={generateSignalMutation.isPending}
                        data-testid={`button-signal-${sym}`}
                        className="gap-1"
                      >
                        <Zap className="h-3 w-3" />
                        {sym}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                    <Cpu className="h-8 w-8 opacity-30" />
                    <p className="text-sm">Nenhum ativo recebido do EA ainda</p>
                    <p className="text-xs">O EA envia os ativos automaticamente ao se conectar</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="spike" className="space-y-4 mt-4">
            {/* Header de alerta crítico */}
            {spikeDashboard?.criticalAlerts?.length > 0 && (
              <div className="rounded-lg border border-red-500/60 bg-red-500/10 p-4 space-y-2" data-testid="banner-spike-critical">
                <div className="flex items-center gap-2 font-bold text-red-500">
                  <Flame className="h-5 w-5" />
                  {spikeDashboard.criticalAlerts.length} SPIKE(S) IMINENTE(S) DETECTADO(S)
                </div>
                {spikeDashboard.criticalAlerts.map((alert: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm border border-red-500/30 rounded-md px-3 py-2" data-testid={`alert-spike-critical-${i}`}>
                    <span className="font-semibold">{alert.symbol}</span>
                    <div className="flex items-center gap-3">
                      <Badge variant="destructive">{alert.direction === 'down' ? '↓ CRASH' : '↑ BOOM'}</Badge>
                      <span className="text-muted-foreground">Iminência: <strong className="text-red-400">{alert.imminence}%</strong></span>
                      <span className="text-muted-foreground">Confiança: <strong className="text-red-400">{alert.confidence}%</strong></span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Estado vazio */}
            {(!spikeDashboard || spikeDashboard.totalSymbolsMonitored === 0) && (
              <Card data-testid="card-spike-empty">
                <CardContent className="py-16 text-center space-y-3">
                  <Flame className="h-12 w-12 mx-auto text-orange-400 opacity-40" />
                  <p className="font-semibold text-muted-foreground">Nenhum Crash/Boom com dados carregados</p>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    O EA precisa enviar dados de mercado de pelo menos um índice Crash ou Boom para a análise de spike funcionar.
                    Certifique-se de que o símbolo configurado no EA é Crash 1000, Crash 500, Boom 1000 ou similar.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Cards de análise por símbolo */}
            {spikeDashboard?.analyses?.map((analysis: any, i: number) => (
              <Card
                key={i}
                className={`border-2 ${
                  analysis.overallConfidence >= 75 ? 'border-red-500/60' :
                  analysis.overallConfidence >= 50 ? 'border-orange-400/60' :
                  'border-border'
                }`}
                data-testid={`card-spike-${analysis.symbol.replace(/\s/g, '-').toLowerCase()}`}
              >
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center justify-between text-base">
                    <div className="flex items-center gap-2">
                      {analysis.spikeType === 'crash'
                        ? <ArrowDownCircle className="h-5 w-5 text-red-500" />
                        : <ArrowUpCircle className="h-5 w-5 text-green-500" />
                      }
                      <span>{analysis.symbol}</span>
                      <Badge variant={analysis.spikeType === 'crash' ? 'destructive' : 'default'} className={analysis.spikeType === 'boom' ? 'bg-green-500' : ''}>
                        {analysis.spikeType === 'crash' ? '↓ CRASH' : '↑ BOOM'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`text-sm font-bold ${
                          analysis.imminenceLabel === 'crítica' ? 'border-red-500 text-red-500 bg-red-500/10' :
                          analysis.imminenceLabel === 'alta'    ? 'border-orange-400 text-orange-400 bg-orange-400/10' :
                          analysis.imminenceLabel === 'moderada'? 'border-yellow-400 text-yellow-400 bg-yellow-400/10' :
                                                                   'border-muted-foreground text-muted-foreground'
                        }`}
                        data-testid={`badge-imminence-${i}`}
                      >
                        {analysis.imminenceLabel?.toUpperCase()}
                      </Badge>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">

                  {/* Barras de progresso */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1.5" data-testid={`progress-imminence-${i}`}>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> Iminência do Spike</span>
                        <span className="font-bold text-foreground">{analysis.imminencePercent}%</span>
                      </div>
                      <Progress value={analysis.imminencePercent} className="h-2" />
                      <p className="text-xs text-muted-foreground">{analysis.candlesSinceLastSpike} / {analysis.averageInterval} candles (média)</p>
                    </div>
                    <div className="space-y-1.5" data-testid={`progress-confidence-${i}`}>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Gauge className="h-3 w-3" /> Confiança Total</span>
                        <span className={`font-bold ${analysis.overallConfidence >= 70 ? 'text-red-500' : analysis.overallConfidence >= 45 ? 'text-orange-400' : 'text-foreground'}`}>
                          {analysis.overallConfidence}%
                        </span>
                      </div>
                      <Progress
                        value={analysis.overallConfidence}
                        className={`h-2 ${analysis.overallConfidence >= 70 ? '[&>div]:bg-red-500' : analysis.overallConfidence >= 45 ? '[&>div]:bg-orange-400' : ''}`}
                      />
                    </div>
                  </div>

                  {/* ── PADRÃO GIRASSOL (ESTRATÉGIA PRIMÁRIA) ── */}
                  {analysis.girassolPattern?.detected ? (
                    <div className={`rounded-md border-2 p-3 space-y-2 ${
                      analysis.girassolPattern.fibAlignment
                        ? 'border-yellow-400 bg-yellow-400/10'
                        : 'border-amber-500/70 bg-amber-500/10'
                    }`} data-testid={`card-girassol-${i}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-bold text-sm text-yellow-400">
                          <span className="text-base">🌻</span>
                          GIRASSOL — {analysis.girassolPattern.patternType === 'double_top' ? 'DUPLO TOPO' : 'DUPLO FUNDO'} DETECTADO
                        </div>
                        <Badge className={`text-xs font-bold ${
                          analysis.girassolPattern.confirmationScore >= 90
                            ? 'bg-red-600'
                            : analysis.girassolPattern.confirmationScore >= 75
                            ? 'bg-orange-500'
                            : 'bg-yellow-600'
                        }`}>
                          Score {analysis.girassolPattern.confirmationScore}/100
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div className="bg-background/40 rounded px-2 py-1">
                          <p className="text-muted-foreground">Pivô 1</p>
                          <p className="font-mono font-bold text-foreground">{analysis.girassolPattern.firstPivotPrice?.toFixed(4)}</p>
                        </div>
                        <div className="bg-background/40 rounded px-2 py-1">
                          <p className="text-muted-foreground">Pivô 2</p>
                          <p className="font-mono font-bold text-foreground">{analysis.girassolPattern.secondPivotPrice?.toFixed(4)}</p>
                        </div>
                        <div className="bg-background/40 rounded px-2 py-1">
                          <p className="text-muted-foreground">Divergência</p>
                          <p className="font-bold text-foreground">{analysis.girassolPattern.priceDivergencePct?.toFixed(2)}%</p>
                        </div>
                        <div className="bg-background/40 rounded px-2 py-1">
                          <p className="text-muted-foreground">Candles entre pivôs</p>
                          <p className="font-bold text-foreground">{analysis.girassolPattern.candlesBetween}</p>
                        </div>
                      </div>
                      {analysis.girassolPattern.fibAlignment && (
                        <div className="flex items-center gap-1.5 text-xs text-yellow-300 font-semibold">
                          <span>✨</span>
                          <span>CONFLUÊNCIA COM FIBONACCI — sinal de máxima força</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 p-2 rounded-md border border-dashed border-border text-xs text-muted-foreground" data-testid={`card-girassol-absent-${i}`}>
                      <span>🌻</span>
                      <span>Padrão Girassol não identificado — aguardando duplo pivô</span>
                    </div>
                  )}

                  {/* Indicadores */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className={`flex items-center gap-2 p-2 rounded-md border text-xs ${analysis.momentumConfirms ? 'border-orange-400/50 bg-orange-400/10 text-orange-400' : 'border-border text-muted-foreground'}`} data-testid={`badge-momentum-${i}`}>
                      {analysis.momentumConfirms ? <CheckCircle className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                      Momentum Confirma
                    </div>
                    <div className={`flex items-center gap-2 p-2 rounded-md border text-xs ${analysis.volatilityCompressed ? 'border-purple-400/50 bg-purple-400/10 text-purple-400' : 'border-border text-muted-foreground'}`} data-testid={`badge-compression-${i}`}>
                      {analysis.volatilityCompressed ? <CheckCircle className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                      Vol. Comprimida {analysis.volatilityCompressed ? `(${analysis.compressionScore}%)` : ''}
                    </div>
                    <div className={`flex items-center gap-2 p-2 rounded-md border text-xs ${analysis.preEntryWindow ? 'border-green-400/50 bg-green-400/10 text-green-400' : 'border-border text-muted-foreground'}`} data-testid={`badge-entry-window-${i}`}>
                      {analysis.preEntryWindow ? <Zap className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                      {analysis.preEntryWindow ? '⚡ JANELA ABERTA' : 'Janela Fechada'}
                    </div>
                  </div>

                  {/* Fibonacci */}
                  {analysis.fibZoneScore && (
                    <div className="rounded-md border border-blue-400/40 bg-blue-400/5 p-3 space-y-1.5" data-testid={`card-fib-zone-${i}`}>
                      <div className="flex items-center gap-2 text-sm font-semibold text-blue-400">
                        <Layers className="h-4 w-4" />
                        Zona Fibonacci Mais Próxima
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Nível: <strong className="text-foreground">{analysis.fibZoneScore.level}</strong> ({analysis.fibZoneScore.layer})</span>
                        <span className="text-muted-foreground">Distância: <strong className="text-foreground">{analysis.fibZoneScore.distancePct?.toFixed(2)}%</strong></span>
                        <Badge variant="outline" className="border-blue-400 text-blue-400">{analysis.fibZoneScore.significance}</Badge>
                        <span className="text-blue-400 font-bold">{analysis.fibZoneScore.spikeMultiplier?.toFixed(1)}× spike</span>
                      </div>
                      {analysis.nearestFibLevels?.length > 1 && (
                        <div className="flex gap-1.5 flex-wrap mt-1">
                          {analysis.nearestFibLevels.map((fib: any, fi: number) => (
                            <Badge key={fi} variant="secondary" className="text-xs">
                              {fib.label} ({fib.layer}) {fib.distancePct?.toFixed(2)}%
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Recomendação de transição */}
                  {analysis.switchRecommendation && (
                    <div className={`rounded-md border-2 p-4 space-y-2 ${
                      analysis.switchRecommendation.urgency === 'critical' ? 'border-red-500 bg-red-500/10' :
                      analysis.switchRecommendation.urgency === 'high'     ? 'border-orange-400 bg-orange-400/10' :
                                                                              'border-yellow-400 bg-yellow-400/10'
                    }`} data-testid={`card-switch-${i}`}>
                      <div className={`flex items-center gap-2 font-bold text-sm ${
                        analysis.switchRecommendation.urgency === 'critical' ? 'text-red-500' :
                        analysis.switchRecommendation.urgency === 'high'     ? 'text-orange-400' : 'text-yellow-400'
                      }`}>
                        <Flame className="h-4 w-4" />
                        TRANSIÇÃO RECOMENDADA — {analysis.switchRecommendation.urgency.toUpperCase()}
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="border-red-400 text-red-400">{analysis.switchRecommendation.exitDirection}</Badge>
                          <span className="text-muted-foreground text-xs">→ fechar continuidade</span>
                        </div>
                        <span className="text-muted-foreground">depois</span>
                        <div className="flex items-center gap-1.5">
                          <Badge className={analysis.switchRecommendation.spikeDirection === 'SELL' ? 'bg-red-500' : 'bg-green-500'}>
                            {analysis.switchRecommendation.spikeDirection} SPIKE
                          </Badge>
                          <span className="text-muted-foreground text-xs">→ entrar no spike</span>
                        </div>
                        <span className="ml-auto font-bold text-muted-foreground">
                          ⏱ {analysis.switchRecommendation.secondsToAct}s para agir
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{analysis.switchRecommendation.reasoning}</p>
                    </div>
                  )}

                  {/* Alertas */}
                  {analysis.alerts?.length > 0 && (
                    <div className="space-y-1">
                      {analysis.alerts.map((alert: string, ai: number) => (
                        <p key={ai} className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1" data-testid={`text-spike-alert-${i}-${ai}`}>
                          {alert}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Narrativa */}
                  <p className="text-xs text-muted-foreground border-t pt-3 leading-relaxed" data-testid={`text-spike-narrative-${i}`}>
                    {analysis.narrative}
                  </p>
                </CardContent>
              </Card>
            ))}

            {/* Info sobre estratégia */}
            <Card className="border-dashed" data-testid="card-spike-strategy-info">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <p className="font-semibold text-foreground">🌻 Estratégia Girassol + Fibonacci — Crash/Boom</p>
                    <p>1. <strong>Padrão Girassol (primário):</strong> Dois pivôs consecutivos (duplo topo ou duplo fundo) formam o gatilho principal. Quando o segundo pivô confirma o nível, o spike é iminente.</p>
                    <p>2. <strong>Confluência Fibonacci:</strong> Se o duplo pivô ocorre em zona Fibonacci crítica (0%, 50%, 61.8%, 100%), a força do sinal se multiplica — sinal de máxima prioridade.</p>
                    <p>3. <strong>Filtros secundários:</strong> Contagem de candles desde último spike + momentum pré-spike + compressão de volatilidade reforçam o sinal Girassol.</p>
                    <p>4. <strong>Transição:</strong> Com o sinal ativo, a IA fecha a posição de continuidade e entra imediatamente na direção do spike.</p>
                    <p>5. <strong>Saída rápida:</strong> Após o spike, a IA fecha a posição e aguarda a próxima oportunidade.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="positions" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-blue-500" />
                    Posições Abertas ({positions?.length || 0})
                  </span>
                  <Badge variant="outline" className="text-xs gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-breathe" />
                    Atualiza a cada 2s
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {positions && positions.length > 0 ? (
                  <div className="space-y-4">
                    {positions.map((pos: any) => {
                      const duration = positionTimers[pos.ticket] || 0;
                      const isProfit = pos.profit >= 0;
                      return (
                        <div key={pos.ticket} className={`p-4 border-2 rounded-xl space-y-3 ${isProfit ? 'border-green-500/40 bg-green-500/5' : 'border-red-500/40 bg-red-500/5'}`} data-testid={`card-position-${pos.ticket}`}>
                          {/* Header da posição */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`p-2 rounded-lg ${pos.type === 'BUY' ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                                {pos.type === 'BUY'
                                  ? <TrendingUp className="h-5 w-5 text-green-500" />
                                  : <TrendingDown className="h-5 w-5 text-red-500" />}
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="font-bold text-lg">{pos.symbol}</p>
                                  <Badge className={pos.type === 'BUY' ? 'bg-green-500' : 'bg-red-500'}>
                                    {pos.type}
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">Ticket #{pos.ticket} • {pos.lots} lote(s)</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className={`text-2xl font-bold ${isProfit ? 'text-green-500' : 'text-red-500'}`}>
                                {isProfit ? '+' : ''}${pos.profit?.toFixed(2)}
                              </p>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground justify-end">
                                <Clock className="h-3 w-3" />
                                <span>{formatDuration(duration)}</span>
                              </div>
                            </div>
                          </div>

                          {/* Detalhes da posição */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                            <div className="bg-background/50 rounded-md p-2">
                              <p className="text-muted-foreground">Entrada</p>
                              <p className="font-mono font-bold">{pos.openPrice}</p>
                            </div>
                            <div className="bg-background/50 rounded-md p-2">
                              <p className="text-muted-foreground">Preço Atual</p>
                              <p className="font-mono font-bold">{pos.currentPrice || pos.openPrice}</p>
                            </div>
                            <div className="bg-background/50 rounded-md p-2">
                              <p className="text-muted-foreground">Stop Loss</p>
                              <p className={`font-mono font-bold ${pos.stopLoss > 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                                {pos.stopLoss > 0 ? pos.stopLoss : 'IA monitora'}
                              </p>
                            </div>
                            <div className="bg-background/50 rounded-md p-2">
                              <p className="text-muted-foreground">Take Profit</p>
                              <p className={`font-mono font-bold ${pos.takeProfit > 0 ? 'text-green-500' : 'text-muted-foreground'}`}>
                                {pos.takeProfit > 0 ? pos.takeProfit : 'IA monitora'}
                              </p>
                            </div>
                          </div>

                          {/* Hora de abertura */}
                          <div className="flex items-center gap-2 text-xs text-muted-foreground border-t pt-2">
                            <Clock className="h-3 w-3" />
                            <span>Aberta às {formatTime(pos.openTime)}</span>
                            {pos.signalId && (
                              <>
                                <span>•</span>
                                <span>Sinal: {pos.signalId}</span>
                              </>
                            )}
                            <span className="ml-auto flex items-center gap-1">
                              <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-breathe" />
                              IA monitorando
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-16 text-muted-foreground">
                    <Activity className="h-14 w-14 mx-auto mb-4 opacity-20" />
                    <p className="font-medium">Nenhuma posição aberta no momento</p>
                    <p className="text-xs mt-1">O EA abrirá posições automaticamente com base nos sinais das IAs</p>
                    <div className="flex items-center justify-center gap-1.5 mt-3 text-xs">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-breathe" />
                      <span>Monitorando mercado em tempo real</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <History className="h-5 w-5 text-muted-foreground" />
                    Histórico de Operações Fechadas
                  </span>
                  <div className="flex items-center gap-2">
                    {trades && trades.length > 0 && (
                      <Badge variant="outline">
                        {trades.filter((t: any) => t.profit >= 0).length} ganhos / {trades.filter((t: any) => t.profit < 0).length} perdas
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-xs gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-breathe" />
                      Ao vivo
                    </Badge>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {trades && trades.length > 0 ? (
                  <>
                    {/* Resumo */}
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div className="bg-muted/30 rounded-lg p-3 text-center">
                        <p className="text-xs text-muted-foreground">Total Operações</p>
                        <p className="text-xl font-bold">{trades.length}</p>
                      </div>
                      <div className="bg-green-500/10 rounded-lg p-3 text-center">
                        <p className="text-xs text-muted-foreground">Lucro Total</p>
                        <p className="text-xl font-bold text-green-500">
                          +${trades.filter((t: any) => t.profit > 0).reduce((acc: number, t: any) => acc + t.profit, 0).toFixed(2)}
                        </p>
                      </div>
                      <div className="bg-red-500/10 rounded-lg p-3 text-center">
                        <p className="text-xs text-muted-foreground">Perda Total</p>
                        <p className="text-xl font-bold text-red-500">
                          -${Math.abs(trades.filter((t: any) => t.profit < 0).reduce((acc: number, t: any) => acc + t.profit, 0)).toFixed(2)}
                        </p>
                      </div>
                    </div>

                    {/* Lista de trades */}
                    <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                      {trades.map((trade: any, i: number) => (
                        <div key={i} className={`p-3 rounded-lg border ${trade.profit >= 0 ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`} data-testid={`history-trade-${i}`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge className={trade.type === 'BUY' ? 'bg-blue-500' : 'bg-purple-500'} variant="default">
                                {trade.type}
                              </Badge>
                              <span className="font-bold">{trade.symbol}</span>
                              <span className="text-xs text-muted-foreground">stake ${Number(trade.lots).toFixed(2)}</span>
                              {trade.source === 'deriv' && (
                                <Badge variant="outline" className="text-xs border-primary/40 text-primary">Deriv Bot</Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className={`text-xs ${trade.closeReason === 'WIN' ? 'border-green-500 text-green-500' : trade.closeReason === 'LOSS' ? 'border-red-500 text-red-500' : ''}`}>
                                {trade.closeReason || 'CLOSED'}
                              </Badge>
                              <span className={`font-bold text-lg ${trade.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {trade.profit >= 0 ? '+' : ''}${trade.profit?.toFixed(2)}
                              </span>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-muted-foreground">
                            <span>Entrada: <span className="font-mono text-foreground">{trade.openPrice || '—'}</span></span>
                            <span>Saída: <span className="font-mono text-foreground">{trade.closePrice || '—'}</span></span>
                            <span>Abertura: <span className="text-foreground">{formatTime(trade.openTime)}</span></span>
                            <span>Fechamento: <span className="text-foreground">{formatTime(trade.closeTime)}</span></span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="space-y-4 py-6">
                    <div className="flex flex-col items-center text-muted-foreground gap-2">
                      <History className="h-12 w-12 opacity-20" />
                      <p className="font-medium">Nenhuma operação registrada ainda</p>
                      <p className="text-xs max-w-sm text-center">
                        Operações do EA aparecem aqui automaticamente ao fechar. A IA aguarda consenso ≥70% para entrar.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                      <div className="bg-muted/30 rounded-lg p-3 text-center">
                        <p className="text-muted-foreground">Sinais gerados</p>
                        <p className="text-lg font-bold">{status?.totalSignalsGenerated || 0}</p>
                      </div>
                      <div className="bg-muted/30 rounded-lg p-3 text-center">
                        <p className="text-muted-foreground">Ganho hoje</p>
                        <p className="text-lg font-bold text-green-500">+${status?.dailyProfit?.toFixed(2) || '0.00'}</p>
                      </div>
                      <div className="bg-muted/30 rounded-lg p-3 text-center">
                        <p className="text-muted-foreground">Perda hoje</p>
                        <p className="text-lg font-bold text-red-500">-${status?.dailyLoss?.toFixed(2) || '0.00'}</p>
                      </div>
                      <div className="bg-muted/30 rounded-lg p-3 text-center">
                        <p className="text-muted-foreground">Win Rate</p>
                        <p className="text-lg font-bold text-primary">{status?.winRate?.toFixed(1) || 0}%</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-breathe" />
                      EA {status?.connected ? 'conectado e aguardando sinal' : 'desconectado — conecte o MT5'}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="config" className="space-y-4 mt-4">

            {/* ── GERENCIAMENTO DE SESSÃO ────────────────────────────── */}
            <Card className="border-blue-500/30 bg-blue-500/5" data-testid="card-session-management">
              <CardHeader className="pb-2 pt-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <RefreshCw className="h-4 w-4 text-blue-400" />
                  Gerenciamento de Sessão de Testes
                </CardTitle>
                <CardDescription className="text-xs">
                  Zera dados operacionais de testes sem apagar aprendizado da IA ou banco de dados
                </CardDescription>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1 text-xs text-muted-foreground flex-1">
                    <p className="font-medium text-foreground text-sm">O que é zerado:</p>
                    <p>• Perdas consecutivas → 0 (remove modo Recovery e thresholds elevados)</p>
                    <p>• Circuit Breaker → desativado</p>
                    <p>• Modo pós-perda e ativo bloqueado</p>
                    <p>• Log de análise em memória da sessão atual</p>
                    <p className="font-medium text-foreground text-sm mt-2">O que é preservado:</p>
                    <p>• Pesos e aprendizado de todos os modelos de IA</p>
                    <p>• Histórico de trades e dados do banco</p>
                    <p>• Configurações do sistema</p>
                  </div>
                  <Button
                    variant="outline"
                    className="border-blue-500/50 text-blue-400 hover:bg-blue-500/10 shrink-0 self-start"
                    onClick={() => resetSessionMutation.mutate()}
                    disabled={resetSessionMutation.isPending}
                    data-testid="button-reset-session-config"
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${resetSessionMutation.isPending ? 'animate-spin' : ''}`} />
                    {resetSessionMutation.isPending ? 'Zerando...' : 'Zerar Sessão'}
                  </Button>
                </div>
                {status?.latestIsRecoveryMode && (
                  <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/30">
                    <AlertTriangle className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                    <p className="text-xs text-orange-500">
                      🔴 Recovery ativo — threshold elevado para {status?.latestRequiredConsensus ?? '?'}% — Recomendado zerar para novo contexto.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Settings className="h-5 w-5" />
                  Configurações do Sistema
                </CardTitle>
                <CardDescription>Configure como o Expert Advisor vai operar</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* ── MODO DE OPERAÇÃO ─────────────────────────────── */}
                <div className="space-y-4">
                  <div>
                    <Label className="font-semibold text-base">Modo de Operação</Label>
                    <p className="text-sm text-muted-foreground">Define o horizonte temporal e estilo dos trades</p>
                  </div>

                  {/* Timeframe principal */}
                  <div className="grid grid-cols-3 gap-2" data-testid="group-trading-timeframe">
                    {([
                      { value: 'day_trade',      label: 'Day Trade',      desc: 'Mesmo dia' },
                      { value: 'swing_trade',    label: 'Swing Trade',    desc: '2–5 dias' },
                      { value: 'position_trade', label: 'Position Trade', desc: 'Semanas+' },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        data-testid={`btn-timeframe-${opt.value}`}
                        onClick={() => setConfigEdits(p => ({ ...p, tradingTimeframe: opt.value }))}
                        className={`flex flex-col items-center justify-center p-3 rounded-lg border-2 text-center transition-all ${
                          (cfg.tradingTimeframe ?? 'day_trade') === opt.value
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border hover:border-primary/50 text-muted-foreground'
                        }`}
                      >
                        <span className="font-semibold text-sm">{opt.label}</span>
                        <span className="text-xs opacity-70 mt-0.5">{opt.desc}</span>
                      </button>
                    ))}
                  </div>

                  {/* Sub-classificação por estilo */}
                  <div className="grid grid-cols-2 gap-3" data-testid="group-trading-style">
                    {([
                      {
                        value: 'scalp',
                        label: '(a) Scalp',
                        sublabel: 'Rápidas',
                        desc: 'TP/SL no tamanho de 1 pivot. Operações de segundos a minutos.',
                        icon: '⚡',
                      },
                      {
                        value: 'alvo_longo',
                        label: '(b) Alvo Longo',
                        sublabel: 'Espera',
                        desc: 'TP em estruturas maiores (Fibonacci, suporte/resistência). Maior R:R.',
                        icon: '🎯',
                      },
                    ] as const).map(opt => {
                      const selected = (cfg.tradingStyle ?? 'scalp') === opt.value;
                      return (
                        <button
                          key={opt.value}
                          data-testid={`btn-style-${opt.value}`}
                          onClick={() => setConfigEdits(p => ({ ...p, tradingStyle: opt.value }))}
                          className={`flex flex-col gap-1 p-4 rounded-lg border-2 text-left transition-all ${
                            selected
                              ? 'border-primary bg-primary/10'
                              : 'border-border hover:border-primary/50'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{opt.icon}</span>
                            <div>
                              <span className={`font-bold text-sm ${selected ? 'text-primary' : ''}`}>{opt.label}</span>
                              <span className="text-xs text-muted-foreground ml-1">— {opt.sublabel}</span>
                            </div>
                            {selected && (
                              <div className="ml-auto w-2 h-2 rounded-full bg-primary" />
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground leading-snug">{opt.desc}</p>
                        </button>
                      );
                    })}
                  </div>

                  {/* Resumo do modo ativo */}
                  <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
                    <span className="text-primary font-medium">Modo ativo:</span>
                    <span>
                      {cfg.tradingTimeframe === 'day_trade' ? 'Day Trade' : cfg.tradingTimeframe === 'swing_trade' ? 'Swing Trade' : 'Position Trade'}
                      {' → '}
                      {(cfg.tradingStyle ?? 'scalp') === 'scalp' ? '⚡ Scalp (alvos de 1 pivot, rápido)' : '🎯 Alvo Longo (estruturas maiores)'}
                    </span>
                  </div>
                </div>

                <Separator />

                <div className="flex items-center justify-between">
                  <div>
                    <Label className="font-semibold text-base">Sistema Ativo</Label>
                    <p className="text-sm text-muted-foreground">Habilita geração e envio de sinais</p>
                  </div>
                  <Switch
                    checked={cfg.enabled || false}
                    onCheckedChange={(v) => setConfigEdits(p => ({ ...p, enabled: v }))}
                    data-testid="switch-enabled"
                  />
                </div>
                <Separator />

                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label data-testid="label-lot-size">Tamanho do Lote Padrão</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={cfg.defaultLotSize || 0.01}
                      onChange={e => setConfigEdits(p => ({ ...p, defaultLotSize: Number(e.target.value) }))}
                      data-testid="input-lot-size"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Lote Máximo</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={cfg.maxLotSize || 1.0}
                      onChange={e => setConfigEdits(p => ({ ...p, maxLotSize: Number(e.target.value) }))}
                      data-testid="input-max-lot-size"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Stop Loss (pips)</Label>
                    <Input
                      type="number"
                      value={cfg.stopLossPips || 30}
                      onChange={e => setConfigEdits(p => ({ ...p, stopLossPips: Number(e.target.value) }))}
                      data-testid="input-stop-loss"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Take Profit (pips)</Label>
                    <Input
                      type="number"
                      value={cfg.takeProfitPips || 60}
                      onChange={e => setConfigEdits(p => ({ ...p, takeProfitPips: Number(e.target.value) }))}
                      data-testid="input-take-profit"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Máx. Posições Simultâneas (total)</Label>
                    <Input
                      type="number"
                      value={cfg.maxOpenPositions || 5}
                      onChange={e => setConfigEdits(p => ({ ...p, maxOpenPositions: Number(e.target.value) }))}
                      data-testid="input-max-positions"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Máx. Posições por Símbolo</Label>
                    <Input
                      type="number"
                      min={0}
                      value={cfg.maxPositionsPerSymbol ?? 1}
                      onChange={e => setConfigEdits(p => ({ ...p, maxPositionsPerSymbol: Number(e.target.value) }))}
                      data-testid="input-max-positions-per-symbol"
                    />
                    <p className="text-xs text-muted-foreground">0 = sem limite por símbolo. 1 = esperar fechar antes de nova entrada no mesmo ativo.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Risco por Trade (%)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={cfg.riskPercent || 1}
                      onChange={e => setConfigEdits(p => ({ ...p, riskPercent: Number(e.target.value) }))}
                      data-testid="input-risk-percent"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Perda Máxima Diária ($)</Label>
                    <Input
                      type="number"
                      value={cfg.maxDailyLoss || 100}
                      onChange={e => setConfigEdits(p => ({ ...p, maxDailyLoss: Number(e.target.value) }))}
                      data-testid="input-max-daily-loss"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Lucro Alvo Diário ($)</Label>
                    <Input
                      type="number"
                      value={cfg.maxDailyProfit || 500}
                      onChange={e => setConfigEdits(p => ({ ...p, maxDailyProfit: Number(e.target.value) }))}
                      data-testid="input-max-daily-profit"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Stop Loss Dinâmico por IA</Label>
                    <p className="text-sm text-muted-foreground">As IAs calculam SL baseado em ATR e volatilidade</p>
                  </div>
                  <Switch
                    checked={cfg.useAIStopLoss || false}
                    onCheckedChange={v => setConfigEdits(p => ({ ...p, useAIStopLoss: v }))}
                    data-testid="switch-ai-stop-loss"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Trailing Stop</Label>
                    <p className="text-sm text-muted-foreground">Proteção automática de lucros</p>
                  </div>
                  <Switch
                    checked={cfg.useTrailingStop || false}
                    onCheckedChange={v => setConfigEdits(p => ({ ...p, useTrailingStop: v }))}
                    data-testid="switch-trailing-stop"
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border border-yellow-500/30 bg-yellow-500/5 p-3">
                  <div>
                    <Label className="flex items-center gap-2">
                      🌻 Girassol Obrigatório
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Quando ativo, a IA só abre posição se o Girassol tiver sinal claro (BUY ou SELL).
                      Sinal NEUTRO ou indicador ausente no gráfico bloqueia a entrada.
                    </p>
                  </div>
                  <Switch
                    checked={cfg.requireGirassolConfirmation || false}
                    onCheckedChange={v => setConfigEdits(p => ({ ...p, requireGirassolConfirmation: v }))}
                    data-testid="switch-require-girassol"
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border border-orange-500/30 bg-orange-500/5 p-3">
                  <div>
                    <Label className="flex items-center gap-2">
                      🔄 Inverter Buffers do Girassol
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Ative se o painel de diagnóstico mostrar <strong>buf0</strong> com valor em TOPOS do mercado (quando deveria ser SELL, não BUY).
                      Isso troca a leitura dos buffers 0 e 1.
                    </p>
                  </div>
                  <Switch
                    checked={cfg.invertGirassolBuffers || false}
                    onCheckedChange={v => setConfigEdits(p => ({ ...p, invertGirassolBuffers: v }))}
                    data-testid="switch-invert-girassol"
                  />
                </div>

                <Separator />

                <div className="space-y-2">
                  <Label>Token de Segurança (API Token)</Label>
                  <p className="text-sm text-muted-foreground">Protege os endpoints. Insira o mesmo no parâmetro do EA.</p>
                  <Input
                    type="password"
                    placeholder="Deixe em branco para manter o atual"
                    value={newApiToken}
                    onChange={e => setNewApiToken(e.target.value)}
                    data-testid="input-api-token"
                  />
                </div>

                <Button
                  onClick={handleSaveConfig}
                  disabled={updateConfigMutation.isPending}
                  className="w-full"
                  data-testid="button-save-config"
                >
                  {updateConfigMutation.isPending ? (
                    <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Salvando...</>
                  ) : (
                    <><CheckCircle2 className="h-4 w-4 mr-2" /> Salvar Configurações</>
                  )}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Download className="h-5 w-5" />
                  Expert Advisor (EA)
                </CardTitle>
                <CardDescription>
                  Baixe e instale o EA no MetaTrader 4 ou 5
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-muted rounded-lg p-4 space-y-2">
                  <p className="font-medium flex items-center gap-2"><Info className="h-4 w-4 text-blue-500" /> Como instalar:</p>
                  <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                    <li>Clique em "Baixar EA" abaixo</li>
                    <li>No MetaTrader: <strong>Arquivo → Abrir pasta de dados → MQL5/Experts</strong></li>
                    <li>Cole o arquivo <code>.mq5</code> na pasta</li>
                    <li>No MetaTrader: clique em <strong>Compilar (F7)</strong> no MetaEditor</li>
                    <li>Arraste o EA para qualquer gráfico e habilite o <strong>AlgoTrading</strong></li>
                    <li>Configure a URL do servidor nos parâmetros do EA</li>
                  </ol>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">① URL do Servidor — EA (F7 → Inputs → ServerURL)</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={window.location.origin}
                      className="text-xs font-mono"
                      data-testid="input-server-url"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0 gap-1.5"
                      onClick={copyServerUrl}
                      data-testid="button-copy-server-url-config"
                    >
                      {urlCopied ? <ClipboardCheck className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      {urlCopied ? 'Copiado!' : 'Copiar'}
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">② URL da Plataforma — MT (Ferramentas → Opções → Expert Advisors → Permitir WebRequest)</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={window.location.origin}
                      className="text-xs font-mono"
                      data-testid="input-platform-url"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="shrink-0 gap-1.5"
                      onClick={copyPlatformUrl}
                      data-testid="button-copy-platform-url-config"
                    >
                      {platformUrlCopied ? <ClipboardCheck className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      {platformUrlCopied ? 'Copiado!' : 'Copiar'}
                    </Button>
                  </div>
                </div>
                <Button onClick={downloadEA} className="w-full gap-2" data-testid="button-download-ea-config">
                  <Download className="h-4 w-4" />
                  Baixar InvistaPRO_EA.mq5
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

