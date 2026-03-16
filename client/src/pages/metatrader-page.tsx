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
  Brain, Target, DollarSign, ArrowUpRight, ArrowDownRight, Clock, Info, ChevronLeft
} from "lucide-react";

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

  const downloadEA = () => {
    const baseUrl = window.location.origin;
    const token = newApiToken || '[SEU_TOKEN_AQUI]';
    const content = generateEAContent(baseUrl, token, cfg);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'InvestaPRO_EA.mq5';
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: 'Expert Advisor baixado!', description: 'Instale o arquivo .mq5 no MetaTrader e compile-o.' });
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

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4" data-testid="tabs-metatrader">
            <TabsTrigger value="dashboard" data-testid="tab-dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="signals" data-testid="tab-signals">Sinais & IAs</TabsTrigger>
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
            <div className="grid md:grid-cols-5 gap-3">
              {['Quantum Neural', 'Advanced Learning', 'Microscopic TA', 'Hugging Face', 'Supreme Analyzer'].map((aiName, i) => (
                <Card key={i} data-testid={`card-ai-${i}`}>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                      <span className="text-xs font-medium">{aiName}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">IA #{i + 1}</p>
                    <Badge variant="outline" className="mt-2 text-xs">Ativa</Badge>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <Brain className="h-5 w-5 text-primary" />
                    Gerar Sinal Manual
                  </span>
                </CardTitle>
                <CardDescription>
                  Force as 5 IAs a analisar um par específico agora
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {(config?.symbols || ['EURUSD', 'GBPUSD', 'XAUUSD', 'USDJPY', 'BTCUSD']).map((sym: string) => (
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

                {status?.activeSignal && (
                  <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="font-semibold">Último Sinal</h4>
                      <Badge className={status.activeSignal.action === 'BUY' ? 'bg-green-500' : status.activeSignal.action === 'SELL' ? 'bg-red-500' : 'bg-gray-500'}>
                        {status.activeSignal.action} {status.activeSignal.symbol}
                      </Badge>
                    </div>
                    {status.activeSignal.indicators && (
                      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 text-sm">
                        <div>
                          <span className="text-muted-foreground text-xs">RSI</span>
                          <p className="font-bold">{status.activeSignal.indicators.rsi?.toFixed(1)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">MACD</span>
                          <p className="font-bold">{status.activeSignal.indicators.macd?.toFixed(5)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">EMA20</span>
                          <p className="font-bold">{status.activeSignal.indicators.ema20?.toFixed(4)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">EMA50</span>
                          <p className="font-bold">{status.activeSignal.indicators.ema50?.toFixed(4)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">ADX</span>
                          <p className="font-bold">{status.activeSignal.indicators.adx?.toFixed(1)}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground text-xs">ATR</span>
                          <p className="font-bold">{status.activeSignal.indicators.atr?.toFixed(5)}</p>
                        </div>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">{status.activeSignal.reason}</p>
                  </div>
                )}
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
                    <Label>Máx. Posições Simultâneas</Label>
                    <Input
                      type="number"
                      value={cfg.maxOpenPositions || 5}
                      onChange={e => setConfigEdits(p => ({ ...p, maxOpenPositions: Number(e.target.value) }))}
                      data-testid="input-max-positions"
                    />
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
                <div className="flex gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs">URL do Servidor (para o EA)</Label>
                    <Input
                      readOnly
                      value={window.location.origin}
                      className="text-xs font-mono"
                      data-testid="input-server-url"
                    />
                  </div>
                </div>
                <Button onClick={downloadEA} className="w-full gap-2" data-testid="button-download-ea-config">
                  <Download className="h-4 w-4" />
                  Baixar InvestaPRO_EA.mq5
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function generateEAContent(serverUrl: string, token: string, config: Partial<MT5Config>): string {
  return `//+------------------------------------------------------------------+
//|                                              InvestaPRO_EA.mq5   |
//|                        Copyright 2025, InvestaPRO Systems        |
//|                     Powered by 5 AI Systems + MetaTrader Bridge  |
//+------------------------------------------------------------------+
#property copyright "InvestaPRO Systems"
#property link      "${serverUrl}"
#property version   "2.00"
#property strict

#include <Trade\\Trade.mqh>
#include <Trade\\PositionInfo.mqh>

//--- Input Parameters
input string   ServerURL       = "${serverUrl}";
input string   ApiToken        = "${token}";
input string   TradingSymbol   = "";  // Vazio = par atual
input double   LotSize         = ${config.defaultLotSize || 0.01};
input int      StopLoss        = ${config.stopLossPips || 30};
input int      TakeProfit      = ${config.takeProfitPips || 60};
input int      MaxPositions    = ${config.maxOpenPositions || 5};
input double   MaxDailyLoss    = ${config.maxDailyLoss || 100};
input double   MaxDailyProfit  = ${config.maxDailyProfit || 500};
input bool     UseAIStopLoss   = ${config.useAIStopLoss ? 'true' : 'false'};
input bool     UseTrailing     = ${config.useTrailingStop ? 'true' : 'false'};
input int      TrailingPips    = ${config.trailingStopPips || 15};
input int      SignalTimeout   = ${config.signalTimeoutSeconds || 60};
input int      PollIntervalSec = 5;
input int      HeartbeatSec    = 15;
input int      CandlesHistory  = 200;

//--- Global Variables
CTrade         trade;
CPositionInfo  posInfo;
datetime       lastSignalCheck  = 0;
datetime       lastHeartbeat    = 0;
datetime       lastDataUpload   = 0;
double         dailyProfit      = 0;
double         dailyLoss        = 0;
string         lastSignalId     = "";
string         accountId        = "";

//+------------------------------------------------------------------+
//| Expert initialization                                            |
//+------------------------------------------------------------------+
int OnInit() {
   accountId = IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN));
   trade.SetExpertMagicNumber(20250101);
   trade.SetDeviationInPoints(10);
   
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)) {
      Alert("⚠️ AlgoTrading não está habilitado! Habilite nas configurações do MetaTrader.");
      return INIT_FAILED;
   }
   
   Print("✅ InvestaPRO EA iniciado | Servidor: ", ServerURL);
   Print("📡 Conta: ", accountId, " | Par: ", GetSymbol());
   
   SendHeartbeat();
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                          |
//+------------------------------------------------------------------+
void OnDeinit(const int reason) {
   Print("⏹️ InvestaPRO EA finalizado. Razão: ", reason);
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick() {
   datetime now = TimeCurrent();
   
   // Heartbeat
   if(now - lastHeartbeat >= HeartbeatSec) {
      SendHeartbeat();
      lastHeartbeat = now;
   }
   
   // Upload de dados de mercado
   if(now - lastDataUpload >= 60) {
      UploadMarketData();
      lastDataUpload = now;
   }
   
   // Atualizar posições abertas
   UpdateOpenPositions();
   
   // Verificar trailing stop
   if(UseTrailing) ManageTrailingStop();
   
   // Checar limites diários
   if(!CheckDailyLimits()) return;
   
   // Verificar sinal das IAs
   if(now - lastSignalCheck >= PollIntervalSec) {
      CheckAndExecuteSignal();
      lastSignalCheck = now;
   }
}

//+------------------------------------------------------------------+
//| Envia heartbeat para o servidor                                  |
//+------------------------------------------------------------------+
void SendHeartbeat() {
   string symbol   = GetSymbol();
   double balance  = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity   = AccountInfoDouble(ACCOUNT_EQUITY);
   double margin   = AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   string broker   = AccountInfoString(ACCOUNT_COMPANY);
   int    platform = (int)TerminalInfoInteger(TERMINAL_BUILD);
   int    open     = CountOpenPositions();
   
   string body = StringFormat(
      "{\\\"accountId\\\":\\\"%s\\\",\\\"broker\\\":\\\"%s\\\","
      "\\\"balance\\\":%.2f,\\\"equity\\\":%.2f,\\\"freeMargin\\\":%.2f,"
      "\\\"openPositions\\\":%d,\\\"platform\\\":%d}",
      accountId, broker, balance, equity, margin, open, platform
   );
   
   char   req[];
   char   res[];
   string headers = "Content-Type: application/json\\r\\n";
   StringToCharArray(body, req, 0, StringLen(body));
   
   int result = WebRequest("POST", ServerURL + "/api/mt5/heartbeat", headers, 5000, req, res, headers);
   if(result == 200) Print("💚 Heartbeat OK | Balance: $", DoubleToString(balance, 2));
   else              Print("⚠️ Heartbeat falhou: ", result);
}

//+------------------------------------------------------------------+
//| Upload dados de mercado para as IAs                              |
//+------------------------------------------------------------------+
void UploadMarketData() {
   string symbol = GetSymbol();
   MqlRates rates[];
   int copied = CopyRates(symbol, PERIOD_H1, 0, CandlesHistory, rates);
   if(copied <= 0) return;
   
   string candlesJson = "[";
   for(int i = 0; i < MathMin(copied, 100); i++) {
      if(i > 0) candlesJson += ",";
      candlesJson += StringFormat(
         "{\\\"open\\\":%.5f,\\\"high\\\":%.5f,\\\"low\\\":%.5f,\\\"close\\\":%.5f,\\\"volume\\\":%d,\\\"time\\\":%d}",
         rates[i].open, rates[i].high, rates[i].low, rates[i].close, (int)rates[i].tick_volume, (int)rates[i].time
      );
   }
   candlesJson += "]";
   
   string body = StringFormat("{\\\"symbol\\\":\\\"%s\\\",\\\"candles\\\":%s}", symbol, candlesJson);
   char req[], res[];
   string headers = "Content-Type: application/json\\r\\n";
   StringToCharArray(body, req, 0, StringLen(body));
   WebRequest("POST", ServerURL + "/api/mt5/market-data", headers, 10000, req, res, headers);
   Print("📊 Dados enviados: ", copied, " candles de ", symbol);
}

//+------------------------------------------------------------------+
//| Consulta e executa sinal das IAs                                 |
//+------------------------------------------------------------------+
void CheckAndExecuteSignal() {
   if(CountOpenPositions() >= MaxPositions) return;
   
   string symbol  = GetSymbol();
   string url     = ServerURL + "/api/mt5/signal?symbol=" + symbol + "&token=" + ApiToken;
   char   req[], res[];
   string headers = "";
   
   int code = WebRequest("GET", url, headers, 8000, req, res, headers);
   if(code != 200) { Print("⚠️ Falha ao buscar sinal: HTTP ", code); return; }
   
   string response = CharArrayToString(res);
   
   string action     = ExtractJsonString(response, "action");
   string signalId   = ExtractJsonString(response, "id");
   double confidence = ExtractJsonDouble(response, "confidence");
   double slPrice    = ExtractJsonDouble(response, "stopLoss");
   double tpPrice    = ExtractJsonDouble(response, "takeProfit");
   double lotSize    = ExtractJsonDouble(response, "lotSize");
   string reason     = ExtractJsonString(response, "reason");
   
   if(signalId == lastSignalId || action == "HOLD" || action == "") return;
   
   Print("🔔 Sinal recebido: ", action, " ", symbol, " | Confiança: ", DoubleToString(confidence * 100, 1), "% | ", reason);
   
   double entryPrice = (action == "BUY") ? SymbolInfoDouble(symbol, SYMBOL_ASK) : SymbolInfoDouble(symbol, SYMBOL_BID);
   double point      = SymbolInfoDouble(symbol, SYMBOL_POINT);
   int    digits     = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   
   if(!UseAIStopLoss || slPrice <= 0) {
      slPrice = (action == "BUY") ? entryPrice - StopLoss * point : entryPrice + StopLoss * point;
   }
   if(!UseAIStopLoss || tpPrice <= 0) {
      tpPrice = (action == "BUY") ? entryPrice + TakeProfit * point : entryPrice - TakeProfit * point;
   }
   if(lotSize <= 0) lotSize = LotSize;
   
   slPrice = NormalizeDouble(slPrice, digits);
   tpPrice = NormalizeDouble(tpPrice, digits);
   
   bool ok = false;
   if(action == "BUY")  ok = trade.Buy(lotSize, symbol, entryPrice, slPrice, tpPrice, "InvestaPRO_" + signalId);
   if(action == "SELL") ok = trade.Sell(lotSize, symbol, entryPrice, slPrice, tpPrice, "InvestaPRO_" + signalId);
   
   if(ok) {
      lastSignalId = signalId;
      ulong ticket = trade.ResultOrder();
      Print("✅ Ordem executada: #", ticket, " ", action, " @ ", entryPrice);
      ReportTradeOpen(ticket, signalId, symbol, action, lotSize, entryPrice, slPrice, tpPrice);
   } else {
      Print("❌ Erro ao executar ordem: ", trade.ResultRetcode(), " - ", trade.ResultRetcodeDescription());
   }
}

//+------------------------------------------------------------------+
//| Reporta abertura de trade para o servidor                        |
//+------------------------------------------------------------------+
void ReportTradeOpen(ulong ticket, string signalId, string symbol, string type, double lots, double openPrice, double sl, double tp) {
   string body = StringFormat(
      "{\\\"ticket\\\":%llu,\\\"signalId\\\":\\\"%s\\\",\\\"symbol\\\":\\\"%s\\\","
      "\\\"type\\\":\\\"%s\\\",\\\"lots\\\":%.2f,\\\"openPrice\\\":%.5f,"
      "\\\"stopLoss\\\":%.5f,\\\"takeProfit\\\":%.5f,\\\"openTime\\\":%d}",
      ticket, signalId, symbol, type, lots, openPrice, sl, tp, (int)TimeCurrent()
   );
   char req[], res[];
   string headers = "Content-Type: application/json\\r\\n";
   StringToCharArray(body, req, 0, StringLen(body));
   WebRequest("POST", ServerURL + "/api/mt5/trade/open", headers, 5000, req, res, headers);
}

//+------------------------------------------------------------------+
//| Atualiza posições abertas                                        |
//+------------------------------------------------------------------+
void UpdateOpenPositions() {
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic() != 20250101) continue;
      
      ulong  ticket  = posInfo.Ticket();
      double profit  = posInfo.Profit();
      double current = posInfo.PriceCurrent();
      
      if(profit > 0) dailyProfit += profit;
      else           dailyLoss   += MathAbs(profit);
      
      // Verificar se deve fechar por limite diário
      string closeReason = "";
      if(dailyLoss >= MaxDailyLoss)   closeReason = "SL";
      if(dailyProfit >= MaxDailyProfit) closeReason = "TP";
      
      if(closeReason != "") {
         trade.PositionClose(ticket);
         ReportTradeClose(ticket, posInfo.Symbol(), posInfo.TypeDescription(),
                          posInfo.Volume(), posInfo.PriceOpen(), current,
                          profit, closeReason);
      }
   }
}

//+------------------------------------------------------------------+
//| Trailing stop                                                    |
//+------------------------------------------------------------------+
void ManageTrailingStop() {
   double point = SymbolInfoDouble(GetSymbol(), SYMBOL_POINT);
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(!posInfo.SelectByIndex(i)) continue;
      if(posInfo.Magic() != 20250101) continue;
      double newSL = 0;
      if(posInfo.PositionType() == POSITION_TYPE_BUY) {
         newSL = posInfo.PriceCurrent() - TrailingPips * point;
         if(newSL > posInfo.StopLoss() + point)
            trade.PositionModify(posInfo.Ticket(), newSL, posInfo.TakeProfit());
      } else {
         newSL = posInfo.PriceCurrent() + TrailingPips * point;
         if(newSL < posInfo.StopLoss() - point || posInfo.StopLoss() == 0)
            trade.PositionModify(posInfo.Ticket(), newSL, posInfo.TakeProfit());
      }
   }
}

//+------------------------------------------------------------------+
//| Reporta fechamento de trade                                      |
//+------------------------------------------------------------------+
void ReportTradeClose(ulong ticket, string symbol, string type, double lots, double openPrice, double closePrice, double profit, string closeReason) {
   double pips = MathAbs(closePrice - openPrice) / SymbolInfoDouble(symbol, SYMBOL_POINT) / 10;
   string body = StringFormat(
      "{\\\"ticket\\\":%llu,\\\"symbol\\\":\\\"%s\\\",\\\"type\\\":\\\"%s\\\","
      "\\\"lots\\\":%.2f,\\\"openPrice\\\":%.5f,\\\"closePrice\\\":%.5f,"
      "\\\"profit\\\":%.2f,\\\"pips\\\":%.1f,\\\"closeTime\\\":%d,\\\"closeReason\\\":\\\"%s\\\"}",
      ticket, symbol, type, lots, openPrice, closePrice, profit, pips, (int)TimeCurrent(), closeReason
   );
   char req[], res[];
   string headers = "Content-Type: application/json\\r\\n";
   StringToCharArray(body, req, 0, StringLen(body));
   WebRequest("POST", ServerURL + "/api/mt5/trade/close", headers, 5000, req, res, headers);
   Print("📋 Fechamento reportado: #", ticket, " | P&L: $", DoubleToString(profit, 2));
}

//+------------------------------------------------------------------+
//| Verifica limites diários                                         |
//+------------------------------------------------------------------+
bool CheckDailyLimits() {
   if(dailyLoss >= MaxDailyLoss) {
      Print("🛑 Limite diário de perda atingido: $", DoubleToString(dailyLoss, 2));
      return false;
   }
   if(dailyProfit >= MaxDailyProfit) {
      Print("🎯 Meta diária de lucro atingida: $", DoubleToString(dailyProfit, 2));
      return false;
   }
   return true;
}

//+------------------------------------------------------------------+
//| Conta posições abertas deste EA                                  |
//+------------------------------------------------------------------+
int CountOpenPositions() {
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--) {
      if(posInfo.SelectByIndex(i) && posInfo.Magic() == 20250101) count++;
   }
   return count;
}

//+------------------------------------------------------------------+
//| Obtém símbolo a usar                                             |
//+------------------------------------------------------------------+
string GetSymbol() {
   return (TradingSymbol == "" || TradingSymbol == NULL) ? Symbol() : TradingSymbol;
}

//+------------------------------------------------------------------+
//| Extrai string de JSON simples                                    |
//+------------------------------------------------------------------+
string ExtractJsonString(string json, string key) {
   string search = "\\"" + key + "\\":\\"";
   int start = StringFind(json, search);
   if(start < 0) return "";
   start += StringLen(search);
   int end = StringFind(json, "\\"", start);
   if(end < 0) return "";
   return StringSubstr(json, start, end - start);
}

//+------------------------------------------------------------------+
//| Extrai double de JSON simples                                    |
//+------------------------------------------------------------------+
double ExtractJsonDouble(string json, string key) {
   string search = "\\"" + key + "\\":";
   int start = StringFind(json, search);
   if(start < 0) return 0;
   start += StringLen(search);
   int end = start;
   while(end < StringLen(json) && (StringGetCharacter(json, end) == '.' || (StringGetCharacter(json, end) >= '0' && StringGetCharacter(json, end) <= '9'))) end++;
   if(end <= start) return 0;
   return StringToDouble(StringSubstr(json, start, end - start));
}
//+------------------------------------------------------------------+
`;
}
