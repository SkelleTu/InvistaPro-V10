import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Activity, TrendingUp, TrendingDown, Settings, Download, Wifi, WifiOff,
  BarChart2, Zap, Shield, RefreshCw, AlertTriangle, CheckCircle2,
  Brain, Target, DollarSign, ArrowUpRight, ArrowDownRight, Clock, Info, ChevronLeft,
  Eye, Cpu, XCircle, CheckCircle, Minus, ChevronDown, ChevronUp, Copy, ClipboardCheck,
  Flame, ArrowDownCircle, ArrowUpCircle, Gauge, Layers, ToggleLeft, ToggleRight
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

export default function MetaTraderPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [configEdits, setConfigEdits] = useState<Partial<MT5Config>>({});
  const [newApiToken, setNewApiToken] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [urlCopied, setUrlCopied] = useState(false);
  const [platformUrlCopied, setPlatformUrlCopied] = useState(false);

  const { data: status, isLoading: statusLoading } = useQuery<MT5Status>({
    queryKey: ['/api/mt5/status'],
    refetchInterval: 5000
  });

  const { data: config, isLoading: configLoading } = useQuery<MT5Config>({
    queryKey: ['/api/mt5/config'],
    refetchInterval: 30000
  });

  const { data: positions } = useQuery<any[]>({
    queryKey: ['/api/mt5/positions'],
    refetchInterval: 5000
  });

  const { data: trades } = useQuery<any[]>({
    queryKey: ['/api/mt5/trades'],
    refetchInterval: 10000
  });

  const { data: activeSignal, isLoading: signalLoading } = useQuery<any>({
    queryKey: ['/api/mt5/signal'],
    refetchInterval: 15000,
    enabled: !!status?.connected
  });

  const { data: aiAnalysis } = useQuery<AIAnalysisResponse>({
    queryKey: ['/api/mt5/ai-analysis'],
    refetchInterval: 3000
  });

  const { data: spikeDashboard } = useQuery<any>({
    queryKey: ['/api/mt5/spike-dashboard'],
    refetchInterval: 5000
  });

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
          <div className="flex items-center gap-3">
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

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card data-testid="card-status-health">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Saúde</span>
                <Shield className={`h-4 w-4 ${HEALTH_COLOR[status?.systemHealth || 'good']}`} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${HEALTH_COLOR[status?.systemHealth || 'good']}`}>
                {HEALTH_LABEL[status?.systemHealth || 'good']}
              </p>
            </CardContent>
          </Card>
          <Card data-testid="card-status-signals">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Sinais Gerados</span>
                <Brain className="h-4 w-4 text-primary" />
              </div>
              <p className="text-2xl font-bold mt-1">{status?.totalSignalsGenerated || 0}</p>
            </CardContent>
          </Card>
          <Card data-testid="card-status-winrate">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Win Rate</span>
                <Target className="h-4 w-4 text-green-500" />
              </div>
              <p className="text-2xl font-bold mt-1 text-green-500">
                {status?.winRate?.toFixed(1) || 0}%
              </p>
            </CardContent>
          </Card>
          <Card data-testid="card-status-positions">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Posições Abertas</span>
                <Activity className="h-4 w-4 text-blue-500" />
              </div>
              <p className="text-2xl font-bold mt-1 text-blue-500">{status?.openPositions || 0}</p>
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
          <TabsList className="grid w-full grid-cols-5" data-testid="tabs-metatrader">
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
            <TabsTrigger value="positions" data-testid="tab-positions">Posições</TabsTrigger>
            <TabsTrigger value="config" data-testid="tab-config">Configuração</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard" className="space-y-4 mt-4">
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
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Zap className="h-5 w-5 text-yellow-500" />
                    Sinal Ativo das IAs
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {status?.activeSignal ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xl font-bold">{status.activeSignal.symbol}</span>
                        <Badge className={status.activeSignal.action === 'BUY' ? 'bg-green-500' : status.activeSignal.action === 'SELL' ? 'bg-red-500' : 'bg-gray-500'}>
                          {status.activeSignal.action}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Confiança</span>
                          <p className="font-medium text-primary">{((status.activeSignal.confidence || 0) * 100).toFixed(1)}%</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Lote</span>
                          <p className="font-medium">{status.activeSignal.lotSize}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Stop Loss</span>
                          <p className="font-medium text-red-500">{status.activeSignal.stopLossPips} pips</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Take Profit</span>
                          <p className="font-medium text-green-500">{status.activeSignal.takeProfitPips} pips</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground border-t pt-2">{status.activeSignal.reason}</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                      <Clock className="h-8 w-8 mb-2 opacity-50" />
                      <p className="text-sm">Aguardando análise das IAs...</p>
                      {!status?.connected && <p className="text-xs mt-1">Conecte o EA primeiro</p>}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Histórico Recente</CardTitle>
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
                            <p className="text-xs text-muted-foreground">{trade.lots} lotes • #{trade.ticket}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-bold ${trade.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {trade.profit >= 0 ? '+' : ''}${trade.profit?.toFixed(2)}
                          </p>
                          <Badge variant="outline" className="text-xs">{trade.closeReason}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">Nenhuma operação registrada ainda</p>
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
                    <div>
                      <p className="font-bold text-red-500">Circuit Breaker Ativo</p>
                      <p className="text-sm text-muted-foreground">
                        {aiAnalysis.latest.consecutiveLosses} perdas consecutivas — Pausa de {aiAnalysis.latest.circuitBreakerRemainingMin} min para proteção da banca
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Status bar: consenso mínimo e perdas */}
            <div className="grid grid-cols-3 gap-3">
              <Card data-testid="card-min-consensus">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Consenso Mínimo Exigido</p>
                  <p className="text-2xl font-bold text-primary">70%</p>
                  <p className="text-xs text-muted-foreground mt-1">Limiar de segurança da IA</p>
                </CardContent>
              </Card>
              <Card data-testid="card-consecutive-losses">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Perdas Consecutivas</p>
                  <p className={`text-2xl font-bold ${(aiAnalysis?.latest?.consecutiveLosses || 0) >= 2 ? 'text-red-500' : 'text-green-500'}`}>
                    {aiAnalysis?.latest?.consecutiveLosses ?? 0}/3
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Circuit breaker em 3</p>
                </CardContent>
              </Card>
              <Card data-testid="card-analyses-count">
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Análises Realizadas</p>
                  <p className="text-2xl font-bold">{aiAnalysis?.total ?? 0}</p>
                  <p className="text-xs text-muted-foreground mt-1">Desde o último restart</p>
                </CardContent>
              </Card>
            </div>

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
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
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
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Cpu className="h-10 w-10 mb-3 opacity-30" />
                    <p className="font-medium">Aguardando análises das IAs...</p>
                    <p className="text-xs mt-1">As análises aparecem aqui assim que o EA envia dados de mercado</p>
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
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-5 w-5 text-blue-500" />
                  Posições Abertas ({positions?.length || 0})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {positions && positions.length > 0 ? (
                  <div className="space-y-3">
                    {positions.map((pos: any, i: number) => (
                      <div key={i} className="flex items-center justify-between p-3 border rounded-lg" data-testid={`card-position-${pos.ticket}`}>
                        <div className="flex items-center gap-3">
                          {pos.type === 'BUY' ? <TrendingUp className="h-5 w-5 text-green-500" /> : <TrendingDown className="h-5 w-5 text-red-500" />}
                          <div>
                            <p className="font-bold">{pos.symbol}</p>
                            <p className="text-sm text-muted-foreground">#{pos.ticket} • {pos.lots} lots • {pos.type}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-bold ${pos.profit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {pos.profit >= 0 ? '+' : ''}${pos.profit?.toFixed(2)}
                          </p>
                          <p className="text-xs text-muted-foreground">@ {pos.openPrice}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <Activity className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p>Nenhuma posição aberta no momento</p>
                    <p className="text-xs mt-1">O EA abrirá posições automaticamente com base nos sinais das IAs</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="config" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Settings className="h-5 w-5" />
                  Configurações do Sistema
                </CardTitle>
                <CardDescription>Configure como o Expert Advisor vai operar</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
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

