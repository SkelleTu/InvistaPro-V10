import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import Header from "@/components/dashboard/header";
import { 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  DollarSign, 
  Settings, 
  Play, 
  Pause, 
  BarChart3, 
  Bot,
  Zap,
  Target,
  Clock,
  Brain,
  CheckCircle2,
  Hash,
  Infinity
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AccountInfo {
  balance: number;
  accountType: "demo" | "real";
  currency: string;
  loginId?: string;
}

interface TradeStats {
  totalTrades: number;
  wonTrades: number;
  lostTrades: number;
  winRate: number;
  totalProfit: number;
  avgProfit: number;
}

interface TradeConfig {
  id: string;
  mode: string;
  isActive: boolean;
  operationsCount: number;
  intervalType: string;
  intervalValue: number;
}

interface TradeOperation {
  id: string;
  symbol: string;
  direction: "up" | "down";
  amount: number;
  status: "won" | "lost" | "pending" | "cancelled";
  profit?: number;
  createdAt: string;
}

interface AILog {
  id: string;
  modelName: string;
  analysis: string;
  decision: string;
  confidence: number;
  createdAt: string;
}

export default function TradingSystemPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [derivToken, setDerivToken] = useState("");
  const [accountType, setAccountType] = useState<"demo" | "real">("demo");

  // Verificar acesso autorizado via backend centralizado
  const { data: accessCheck } = useQuery({
    queryKey: ["/api/auto-trading/check-access"],
    enabled: !!user,
    staleTime: 5 * 60 * 1000, // Cache por 5 minutos
  });
  
  const hasAccess = Boolean((accessCheck as any)?.hasAccess);

  // Queries
  const { data: accountInfo } = useQuery<AccountInfo>({
    queryKey: ["/api/trading/account-info"],
    enabled: hasAccess,
    refetchInterval: 2000, // Atualiza a cada 2 segundos
  });

  const { data: tradeConfig } = useQuery<TradeConfig>({
    queryKey: ["/api/trading/config"],
    enabled: hasAccess,
    refetchInterval: 2000, // Atualiza a cada 2 segundos
  });

  const { data: tradeStats } = useQuery<TradeStats>({
    queryKey: ["/api/trading/stats"],
    enabled: hasAccess,
    refetchInterval: 1000, // Atualiza a cada 1 segundo para estatísticas
  });

  const { data: recentOperations = [] } = useQuery<TradeOperation[]>({
    queryKey: ["/api/trading/operations"],
    enabled: hasAccess,
    refetchInterval: 1000, // Atualiza a cada 1 segundo para ver novas operações
  });

  const { data: aiLogs = [] } = useQuery<AILog[]>({
    queryKey: ["/api/trading/ai-logs"],
    enabled: hasAccess,
    refetchInterval: 2000, // Atualiza a cada 2 segundos para ver novas análises
  });

  const { data: savedDerivToken } = useQuery<
    { tokenConfigured: false } | 
    { tokenConfigured: true; token: string; accountType: string; isActive: boolean; createdAt: string }
  >({
    queryKey: ["/api/trading/deriv-token"],
    enabled: hasAccess
  });

  // Queries em tempo real para atualizações automáticas
  const { data: realTimeData } = useQuery({
    queryKey: ["/api/trading/realtime-data"],
    enabled: hasAccess && !!user,
    refetchInterval: 1000, // Atualização a cada segundo para dados em tempo real
  });

  const { data: aiAnalysis } = useQuery({
    queryKey: ["/api/trading/ai-analysis"],
    enabled: hasAccess,
    refetchInterval: 5000, // Atualização a cada 5 segundos para análises de IA cooperativa
  });

  const { data: liveBalance } = useQuery({
    queryKey: ["/api/trading/live-balance"],
    enabled: hasAccess && !!savedDerivToken && (savedDerivToken as any)?.tokenConfigured === true,
    refetchInterval: 2000, // Saldo atualizado a cada 2 segundos
  });

  // Estatísticas históricas de threshold da IA em tempo real
  const { data: aiThresholdStats } = useQuery({
    queryKey: ["/api/auto-trading/ai-threshold-stats"],
    enabled: hasAccess,
    refetchInterval: 3000, // Atualização a cada 3 segundos
  });

  // Status do scheduler (sistema de trading)
  const { data: schedulerStatus } = useQuery({
    queryKey: ["/api/auto-trading/status"],
    enabled: hasAccess,
    refetchInterval: 2000, // Atualização a cada 2 segundos
  });

  // Debug logging to identify the issue
  useEffect(() => {
    console.log('🔍 Trading System Debug:', {
      hasAccess,
      savedDerivToken,
      tokenConfigured: (savedDerivToken as any)?.tokenConfigured,
      liveBalanceEnabled: hasAccess && !!savedDerivToken && (savedDerivToken as any)?.tokenConfigured === true
    });
  }, [hasAccess, savedDerivToken]);

  // Mutations
  const saveTokenMutation = useMutation({
    mutationFn: async (data: { token: string; accountType: "demo" | "real" }) => {
      const response = await apiRequest("/api/trading/deriv-token", {
        method: "POST",
        body: JSON.stringify(data)
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Token salvo com sucesso!",
        description: "Conexão com Deriv estabelecida."
      });
      queryClient.invalidateQueries({ queryKey: ["/api/trading/account-info"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trading/deriv-token"] });
      setDerivToken(""); // Limpar campo após salvar
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao salvar token",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const updateConfigMutation = useMutation({
    mutationFn: async (mode: string) => {
      const response = await apiRequest("/api/trading/config", {
        method: "POST",
        body: JSON.stringify({ mode })
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Configuração atualizada!",
        description: "Modo de operação alterado com sucesso."
      });
      queryClient.invalidateQueries({ queryKey: ["/api/trading/config"] });
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao atualizar configuração",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const controlSchedulerMutation = useMutation({
    mutationFn: async (action: 'pause' | 'resume') => {
      const response = await apiRequest(`/api/auto-trading/scheduler/${action}`, {
        method: "POST"
      });
      return response.json();
    },
    onSuccess: (data, action) => {
      toast({
        title: action === 'pause' ? "Sistema pausado" : "Sistema iniciado",
        description: data.message || (action === 'pause' ? "O sistema de trading foi pausado com sucesso." : "O sistema de trading foi iniciado com sucesso.")
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auto-trading/status"] });
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao controlar sistema",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Verificar acesso
  if (!hasAccess) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container mx-auto px-4 py-8">
          <Card className="max-w-md mx-auto">
            <CardContent className="p-6 text-center">
              <h2 className="text-xl font-bold mb-2">Acesso Restrito</h2>
              <p className="text-muted-foreground">
                O Sistema de Renda Variável está disponível apenas para usuários autorizados.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'USD'
    }).format(value);
  };

  const getOperationModeLabel = (mode: string) => {
    const modes: Record<string, string> = {
      'production_3-4_24h': '3-4 operações a cada 24h (Produção)',
      'production_2_24h': '2 operações a cada 24h (Produção)',
      'test_4_1min': '4 operações a cada 1 minuto (Teste)',
      'test_3_2min': '3 operações a cada 2 minutos (Teste)',
      'test_4_1hour': '4 operações a cada 1 hora (Teste)',
      'test_3_2hour': '3 operações a cada 2 horas (Teste)',
      'test_sem_limites': 'Sem Limites - Operação Contínua (Teste)'
    };
    return modes[mode] || mode;
  };

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <div className="container mx-auto px-4 py-8">
        {/* Cabeçalho da página */}
        <div className="mb-8">
          <div className="flex items-center space-x-3 mb-2">
            <BarChart3 className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold text-foreground">Sistema de Renda Variável</h1>
          </div>
          <p className="text-muted-foreground">
            Trading automatizado em digit differs com inteligência artificial cooperativa
          </p>
          <div className="flex items-center space-x-2 mt-2">
            <Badge variant="outline" className="text-green-600 border-green-200 animate-pulse">
              <Zap className="h-3 w-3 mr-1" />
              Proprietário: {user?.nomeCompleto || user?.email}
            </Badge>
            <Badge variant="outline" className="text-blue-600 border-blue-200">
              <Brain className="h-3 w-3 mr-1" />
              IA Cooperativa Ativa
            </Badge>
            {accountInfo?.accountType && (
              <Badge variant={accountInfo.accountType === 'demo' ? "secondary" : "default"}>
                {accountInfo.accountType === 'demo' ? 'Demo' : 'Real'}
              </Badge>
            )}
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="config">Configurações</TabsTrigger>
            <TabsTrigger value="operations">Operações</TabsTrigger>
            <TabsTrigger value="ai-analysis">IA e Análises</TabsTrigger>
          </TabsList>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-6">
            {/* Card de Controle do Sistema */}
            <Card className="border-2 border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Bot className="h-5 w-5" />
                    <span>Controle do Sistema de Trading</span>
                  </div>
                  <Badge variant={(schedulerStatus as any)?.schedulerActive ? "default" : "secondary"} className="animate-pulse">
                    <span className={`w-2 h-2 rounded-full inline-block mr-1 ${(schedulerStatus as any)?.schedulerActive ? 'bg-green-500' : 'bg-gray-500'}`}></span>
                    {(schedulerStatus as any)?.schedulerActive ? 'Ativo' : 'Pausado'}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {(schedulerStatus as any)?.schedulerActive 
                    ? "O sistema está rodando e monitorando oportunidades de trading" 
                    : "O sistema está pausado e não está executando operações"}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Sessões Ativas</p>
                    <p className="text-2xl font-bold">{(schedulerStatus as any)?.stats?.totalSessions || 0}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Operações Executadas</p>
                    <p className="text-2xl font-bold">{(schedulerStatus as any)?.stats?.totalExecutedOperations || 0}</p>
                  </div>
                </div>
                <div className="flex space-x-2">
                  {(schedulerStatus as any)?.schedulerActive ? (
                    <Button
                      variant="destructive"
                      onClick={() => controlSchedulerMutation.mutate('pause')}
                      disabled={controlSchedulerMutation.isPending}
                      data-testid="button-pause-system"
                    >
                      <Pause className="h-4 w-4 mr-2" />
                      {controlSchedulerMutation.isPending ? 'Pausando...' : 'Pausar Sistema'}
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      onClick={() => controlSchedulerMutation.mutate('resume')}
                      disabled={controlSchedulerMutation.isPending}
                      data-testid="button-start-system"
                    >
                      <Play className="h-4 w-4 mr-2" />
                      {controlSchedulerMutation.isPending ? 'Iniciando...' : 'Iniciar Sistema'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Cards de estatísticas - Linha 1 */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card data-testid="card-balance">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Saldo Atual</CardTitle>
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold transition-all duration-500 hover:scale-105" data-testid="text-balance">
                    <span className={`${(realTimeData as any)?.balanceChanged ? 'animate-bounce text-green-500' : ''}`}>
                      {(liveBalance as any)?.balance ? formatCurrency((liveBalance as any).balance) : 
                       accountInfo?.balance ? formatCurrency(accountInfo.balance) : '--'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Conta {accountInfo?.accountType || 'não conectada'} 
                    {(realTimeData as any)?.lastUpdate && (
                      <span className="text-green-500 ml-2 animate-pulse">• Ao vivo</span>
                    )}
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-operations">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total de Operações</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-total-operations">
                    {tradeStats?.totalTrades || 0}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Operações realizadas
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-winrate">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Taxa de Acerto</CardTitle>
                  <Target className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-winrate">
                    {tradeStats?.winRate ? `${tradeStats.winRate}%` : '0%'}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {tradeStats?.wonTrades || 0} vitórias de {tradeStats?.totalTrades || 0}
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-profit">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Lucro Total</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold" data-testid="text-profit">
                    {tradeStats?.totalProfit ? formatCurrency(tradeStats.totalProfit) : '$0.00'}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Resultado acumulado
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Cards de IA - Linha 2 */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card data-testid="card-ai-threshold" className="border-blue-200 dark:border-blue-900">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Threshold Médio IA</CardTitle>
                  <Brain className="h-4 w-4 text-blue-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-blue-600 dark:text-blue-400" data-testid="text-ai-threshold">
                    {(aiThresholdStats as any)?.thresholdMedio ? `${(aiThresholdStats as any).thresholdMedio}%` : '--'}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {(aiThresholdStats as any)?.thresholdsAnalisados || 0} análises registradas
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-ai-days" className="border-purple-200 dark:border-purple-900">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Sistema Ativo</CardTitle>
                  <Clock className="h-4 w-4 text-purple-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-purple-600 dark:text-purple-400" data-testid="text-ai-days">
                    {(aiThresholdStats as any)?.diasAtivo || 0} dia{(aiThresholdStats as any)?.diasAtivo !== 1 ? 's' : ''}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tempo de operação contínua
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-ai-max" className="border-green-200 dark:border-green-900">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Threshold Máximo</CardTitle>
                  <TrendingUp className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-ai-max">
                    {(aiThresholdStats as any)?.thresholdMaximo ? `${(aiThresholdStats as any).thresholdMaximo}%` : '--'}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Pico de confiança registrado
                  </p>
                </CardContent>
              </Card>

              <Card data-testid="card-ai-min" className="border-orange-200 dark:border-orange-900">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Threshold Mínimo</CardTitle>
                  <TrendingDown className="h-4 w-4 text-orange-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-600 dark:text-orange-400" data-testid="text-ai-min">
                    {(aiThresholdStats as any)?.thresholdMinimo ? `${(aiThresholdStats as any).thresholdMinimo}%` : '--'}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Menor confiança registrada
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Status da configuração atual */}
            {tradeConfig && (
              <Card data-testid="card-config">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Settings className="h-5 w-5" />
                    <span>Configuração Atual</span>
                    <Badge variant="outline" className="animate-pulse">
                      <span className="w-2 h-2 bg-green-500 rounded-full inline-block mr-1"></span>
                      Live
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium" data-testid="text-config-mode">{getOperationModeLabel(tradeConfig.mode)}</p>
                      <p className="text-sm text-muted-foreground">
                        Status: <span data-testid="text-config-status">{tradeConfig.isActive ? 'Ativo' : 'Inativo'}</span>
                      </p>
                    </div>
                    <Badge variant={tradeConfig.isActive ? "default" : "secondary"} data-testid="badge-config-status">
                      {tradeConfig.isActive ? <Play className="h-3 w-3 mr-1" /> : <Pause className="h-3 w-3 mr-1" />}
                      {tradeConfig.isActive ? 'Rodando' : 'Parado'}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Operações recentes com tempo real */}
            <Card data-testid="card-operations-live">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Activity className="h-5 w-5" />
                  <span>Operações em Tempo Real</span>
                  <Badge variant="outline" className="animate-pulse">
                    <span className="w-2 h-2 bg-green-500 rounded-full inline-block mr-1"></span>
                    Live
                  </Badge>
                </CardTitle>
                <CardDescription>Atualização automática a cada 1 segundo</CardDescription>
              </CardHeader>
              <CardContent>
                {recentOperations.length > 0 ? (
                  <div className="space-y-4">
                    {recentOperations.slice(0, 5).map((operation: any) => (
                      <div key={operation.id} className="flex items-center justify-between p-3 border rounded transition-all hover:border-primary" data-testid={`operation-${operation.id}`}>
                        <div className="flex items-center space-x-3">
                          {operation.direction === 'up' ? (
                            <TrendingUp className="h-4 w-4 text-green-500" />
                          ) : (
                            <TrendingDown className="h-4 w-4 text-red-500" />
                          )}
                          <div>
                            <p className="font-medium" data-testid={`operation-symbol-${operation.id}`}>{operation.symbol}</p>
                            <p className="text-sm text-muted-foreground">
                              {formatCurrency(operation.amount)} • {operation.direction.toUpperCase()}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge variant={
                            operation.status === 'won' ? 'default' : 
                            operation.status === 'lost' ? 'destructive' : 
                            'secondary'
                          } data-testid={`operation-status-${operation.id}`}>
                            {operation.status}
                          </Badge>
                          {operation.profit && (
                            <p className={`text-sm ${operation.profit >= 0 ? 'text-green-600' : 'text-red-600'}`} data-testid={`operation-profit-${operation.id}`}>
                              {operation.profit >= 0 ? '+' : ''}{formatCurrency(operation.profit)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground py-8">
                    Nenhuma operação realizada ainda.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Configurações Tab */}
          <TabsContent value="config" className="space-y-6">
            {/* Diagnóstico e Correção Automática */}
            <Card className="border-yellow-200 dark:border-yellow-900">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2 text-yellow-800 dark:text-yellow-200">
                  <Settings className="h-5 w-5" />
                  <span>Diagnóstico do Sistema</span>
                </CardTitle>
                <CardDescription>
                  Verificar e corrigir problemas automaticamente
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-3">
                  <Button
                    onClick={() => {
                      fetch('/api/auto-trading/diagnose')
                        .then(r => r.json())
                        .then(data => {
                          console.log('Diagnóstico:', data);
                          toast({
                            title: `Problema Identificado: ${data.problema || 'NENHUM'}`,
                            description: JSON.stringify(data, null, 2),
                            duration: 10000
                          });
                        });
                    }}
                    variant="outline"
                    data-testid="button-diagnose"
                  >
                    <Activity className="h-4 w-4 mr-2" />
                    Diagnosticar
                  </Button>
                  
                  <Button
                    onClick={() => {
                      fetch('/api/auto-trading/fix-auto', { method: 'POST' })
                        .then(r => r.json())
                        .then(data => {
                          console.log('Correções aplicadas:', data);
                          toast({
                            title: "Correções Aplicadas!",
                            description: `${data.corrigoesAplicadas} correção(ões) aplicada(s). ${data.proximoPasso}`,
                            duration: 10000
                          });
                          // Recarregar dados
                          queryClient.invalidateQueries({ queryKey: ["/api/trading/config"] });
                        });
                    }}
                    variant="default"
                    className="bg-green-600 hover:bg-green-700"
                    data-testid="button-fix-auto"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Corrigir Automaticamente
                  </Button>
                </div>
                <div className="text-sm text-muted-foreground p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded border border-yellow-200 dark:border-yellow-800">
                  <p className="font-medium mb-1">🔧 Correções Automáticas:</p>
                  <ul className="list-disc list-inside space-y-1 text-xs">
                    <li>Desativa parada de emergência</li>
                    <li>Remove aprovação administrativa</li>
                    <li>Cria/reativa configuração de trading</li>
                    <li>Reseta sessões bloqueadas</li>
                    <li>Aumenta limites para modo demo</li>
                  </ul>
                </div>
              </CardContent>
            </Card>

            {/* Token Deriv */}
            <Card>
              <CardHeader>
                <CardTitle>Configuração da API Deriv</CardTitle>
                <CardDescription>
                  Configure seu token de API para conectar com a plataforma Deriv
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Mostrar token salvo se existir */}
                {savedDerivToken?.tokenConfigured && (
                  <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    <div className="flex items-center space-x-2 mb-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium text-green-800 dark:text-green-200">
                        Token Configurado
                      </span>
                    </div>
                    <p className="text-sm text-green-700 dark:text-green-300">
                      Token: {savedDerivToken.token}
                    </p>
                    <p className="text-sm text-green-700 dark:text-green-300">
                      Tipo de conta: {savedDerivToken.accountType === 'demo' ? 'Demo (Teste)' : 'Real (Produção)'}
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="token">
                    {savedDerivToken?.tokenConfigured ? 'Novo Token da API (opcional)' : 'Token da API'}
                  </Label>
                  <Input
                    id="token"
                    type="password"
                    placeholder={savedDerivToken?.tokenConfigured ? "Insira um novo token para substituir" : "Insira seu token da API Deriv"}
                    value={derivToken}
                    onChange={(e) => setDerivToken(e.target.value)}
                    data-testid="input-deriv-token"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="account-type">Tipo de Conta</Label>
                  <Select value={accountType} onValueChange={(value: "demo" | "real") => setAccountType(value)}>
                    <SelectTrigger data-testid="select-account-type">
                      <SelectValue placeholder="Selecione o tipo de conta" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="demo">Demo (Teste)</SelectItem>
                      <SelectItem value="real">Real (Produção)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button 
                  onClick={() => saveTokenMutation.mutate({ token: derivToken, accountType })}
                  disabled={!derivToken || saveTokenMutation.isPending}
                  data-testid="button-save-token"
                >
                  {saveTokenMutation.isPending ? 
                    "Salvando..." : 
                    savedDerivToken?.tokenConfigured ? "Atualizar Token" : "Salvar Token"
                  }
                </Button>
                
                {/* Limpar campo após salvar */}
                {savedDerivToken?.tokenConfigured && (
                  <Button 
                    variant="outline"
                    onClick={() => setDerivToken("")}
                    disabled={saveTokenMutation.isPending}
                    data-testid="button-clear-token"
                  >
                    Limpar Campo
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Configurações de Digit Differs */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Target className="h-5 w-5" />
                  <span>Configurações de Digit Differs</span>
                </CardTitle>
                <CardDescription>
                  Configure parâmetros específicos para operações de digit differs
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Tipo de Operação Digit */}
                <div className="space-y-3">
                  <h4 className="font-medium flex items-center space-x-2">
                    <Hash className="h-4 w-4" />
                    <span>Tipo de Operação</span>
                  </h4>
                  <div className="grid grid-cols-2 gap-3">
                    <Button
                      variant="outline"
                      className="h-auto p-4 flex flex-col items-start space-y-2"
                      data-testid="button-digit-differs"
                    >
                      <div className="flex items-center space-x-2">
                        <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                        <span className="font-medium">Digit Differs</span>
                      </div>
                      <p className="text-xs text-muted-foreground text-left">
                        Ganha se o último dígito for DIFERENTE do previsto
                      </p>
                    </Button>
                    <Button
                      variant="outline"
                      className="h-auto p-4 flex flex-col items-start space-y-2 opacity-50"
                      disabled
                      data-testid="button-digit-matches"
                    >
                      <div className="flex items-center space-x-2">
                        <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
                        <span className="font-medium">Digit Matches</span>
                      </div>
                      <p className="text-xs text-muted-foreground text-left">
                        Em breve: Ganha se o último dígito for IGUAL ao previsto
                      </p>
                    </Button>
                  </div>
                  <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                      <strong>Digit Differs Ativo:</strong> O sistema prevê um dígito (0-9) e ganha se o último dígito do preço final for diferente da previsão.
                    </p>
                  </div>
                </div>

                <Separator />

                {/* Parâmetros Avançados */}
                <div className="space-y-3">
                  <h4 className="font-medium flex items-center space-x-2">
                    <Settings className="h-4 w-4" />
                    <span>Parâmetros de Trading</span>
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Duração (Ticks)</Label>
                      <div className="p-3 border rounded-lg bg-muted/50">
                        <div className="text-sm font-medium">1-10 ticks</div>
                        <div className="text-xs text-muted-foreground">Automático via IA</div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Valor por Trade</Label>
                      <div className="p-3 border rounded-lg bg-muted/50">
                        <div className="text-sm font-medium">$1-10 USD</div>
                        <div className="text-xs text-muted-foreground">Baseado no modo</div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Dígito Alvo</Label>
                      <div className="p-3 border rounded-lg bg-muted/50">
                        <div className="text-sm font-medium">0-9 (Random)</div>
                        <div className="text-xs text-muted-foreground">Gerado pela IA</div>
                      </div>
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Símbolos Suportados */}
                <div className="space-y-3">
                  <h4 className="font-medium flex items-center space-x-2">
                    <BarChart3 className="h-4 w-4" />
                    <span>Símbolos para Digit Differs</span>
                  </h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {['R_50', 'R_75', 'R_100', '1HZ50V', '1HZ75V', '1HZ100V'].map((symbol) => (
                      <div key={symbol} className="p-2 border rounded-lg text-center">
                        <div className="text-sm font-medium">{symbol}</div>
                        <div className="text-xs text-green-600">✓ Ativo</div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Modo de Operação */}
            <Card>
              <CardHeader>
                <CardTitle>Frequência de Operações</CardTitle>
                <CardDescription>
                  Configure a frequência das operações de digit differs
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <h4 className="font-medium">Modos de Produção</h4>
                  <div className="grid gap-2">
                    <Button
                      variant={tradeConfig?.mode === 'production_3-4_24h' ? "default" : "outline"}
                      onClick={() => updateConfigMutation.mutate('production_3-4_24h')}
                      disabled={updateConfigMutation.isPending}
                      className="justify-start"
                      data-testid="button-mode-prod-3-4"
                    >
                      <Clock className="h-4 w-4 mr-2" />
                      3-4 digit differs a cada 24 horas
                    </Button>
                    <Button
                      variant={tradeConfig?.mode === 'production_2_24h' ? "default" : "outline"}
                      onClick={() => updateConfigMutation.mutate('production_2_24h')}
                      disabled={updateConfigMutation.isPending}
                      className="justify-start"
                      data-testid="button-mode-prod-2"
                    >
                      <Clock className="h-4 w-4 mr-2" />
                      2 digit differs a cada 24 horas
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h4 className="font-medium">Modos de Teste</h4>
                  <div className="grid gap-2">
                    <Button
                      variant={tradeConfig?.mode === 'test_4_1min' ? "default" : "outline"}
                      onClick={() => updateConfigMutation.mutate('test_4_1min')}
                      disabled={updateConfigMutation.isPending}
                      className="justify-start"
                      data-testid="button-mode-test-4-1min"
                    >
                      <Zap className="h-4 w-4 mr-2" />
                      4 digit differs a cada 1 minuto
                    </Button>
                    <Button
                      variant={tradeConfig?.mode === 'test_3_2min' ? "default" : "outline"}
                      onClick={() => updateConfigMutation.mutate('test_3_2min')}
                      disabled={updateConfigMutation.isPending}
                      className="justify-start"
                      data-testid="button-mode-test-3-2min"
                    >
                      <Zap className="h-4 w-4 mr-2" />
                      3 digit differs a cada 2 minutos
                    </Button>
                    <Button
                      variant={tradeConfig?.mode === 'test_4_1hour' ? "default" : "outline"}
                      onClick={() => updateConfigMutation.mutate('test_4_1hour')}
                      disabled={updateConfigMutation.isPending}
                      className="justify-start"
                      data-testid="button-mode-test-4-1h"
                    >
                      <Clock className="h-4 w-4 mr-2" />
                      4 digit differs a cada 1 hora
                    </Button>
                    <Button
                      variant={tradeConfig?.mode === 'test_3_2hour' ? "default" : "outline"}
                      onClick={() => updateConfigMutation.mutate('test_3_2hour')}
                      disabled={updateConfigMutation.isPending}
                      className="justify-start"
                      data-testid="button-mode-test-3-2h"
                    >
                      <Clock className="h-4 w-4 mr-2" />
                      3 digit differs a cada 2 horas
                    </Button>
                    <Button
                      variant={tradeConfig?.mode === 'test_sem_limites' ? "default" : "outline"}
                      onClick={() => updateConfigMutation.mutate('test_sem_limites')}
                      disabled={updateConfigMutation.isPending}
                      className="justify-start"
                      data-testid="button-mode-test-sem-limites"
                    >
                      <Infinity className="h-4 w-4 mr-2" />
                      Sem Limites - Operação Contínua
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Operações Tab */}
          <TabsContent value="operations" className="space-y-6">
            <Card data-testid="card-operations-history">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Activity className="h-5 w-5" />
                  <span>Histórico de Operações</span>
                  <Badge variant="outline" className="animate-pulse">
                    <span className="w-2 h-2 bg-green-500 rounded-full inline-block mr-1"></span>
                    Live
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Atualização automática a cada 1 segundo - Todas as operações do sistema
                </CardDescription>
              </CardHeader>
              <CardContent>
                {recentOperations.length > 0 ? (
                  <div className="space-y-4">
                    {recentOperations.map((operation: any) => (
                      <div key={operation.id} className="flex items-center justify-between p-4 border rounded-lg transition-all hover:border-primary" data-testid={`history-operation-${operation.id}`}>
                        <div className="flex items-center space-x-4">
                          {operation.direction === 'up' ? (
                            <TrendingUp className="h-5 w-5 text-green-500" />
                          ) : (
                            <TrendingDown className="h-5 w-5 text-red-500" />
                          )}
                          <div>
                            <p className="font-medium" data-testid={`history-symbol-${operation.id}`}>{operation.symbol}</p>
                            <p className="text-sm text-muted-foreground" data-testid={`history-time-${operation.id}`}>
                              {new Date(operation.createdAt).toLocaleString('pt-BR')}
                            </p>
                          </div>
                        </div>
                        <div className="text-center">
                          <p className="font-medium" data-testid={`history-amount-${operation.id}`}>{formatCurrency(operation.amount)}</p>
                          <p className="text-sm text-muted-foreground">{operation.direction.toUpperCase()}</p>
                        </div>
                        <div className="text-right">
                          <Badge variant={
                            operation.status === 'won' ? 'default' : 
                            operation.status === 'lost' ? 'destructive' : 
                            'secondary'
                          } data-testid={`history-status-${operation.id}`}>
                            {operation.status}
                          </Badge>
                          {operation.profit !== undefined && (
                            <p className={`text-sm font-medium ${operation.profit >= 0 ? 'text-green-600' : 'text-red-600'}`} data-testid={`history-profit-${operation.id}`}>
                              {operation.profit >= 0 ? '+' : ''}{formatCurrency(operation.profit)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">Nenhuma operação encontrada.</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Configure o sistema e inicie as operações automatizadas.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* IA e Análises Tab */}
          <TabsContent value="ai-analysis" className="space-y-6">
            <Card data-testid="card-ai-logs">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Brain className="h-5 w-5" />
                  <span>Análises de Inteligência Artificial</span>
                  <Badge variant="outline" className="animate-pulse">
                    <span className="w-2 h-2 bg-blue-500 rounded-full inline-block mr-1"></span>
                    Live
                  </Badge>
                </CardTitle>
                <CardDescription>
                  Atualização automática a cada 2 segundos - Logs detalhados das IAs cooperativas
                </CardDescription>
              </CardHeader>
              <CardContent>
                {aiLogs.length > 0 ? (
                  <div className="space-y-4">
                    {aiLogs.slice(0, 10).map((log: any) => (
                      <div key={log.id} className="p-4 border rounded-lg space-y-2 transition-all hover:border-blue-500" data-testid={`ai-log-${log.id}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <Bot className="h-4 w-4 text-blue-500" />
                            <span className="font-medium" data-testid={`ai-log-model-${log.id}`}>{log.modelName}</span>
                            <Badge variant="outline" data-testid={`ai-log-confidence-${log.id}`}>
                              {(log.confidence * 100).toFixed(1)}% confiança
                            </Badge>
                          </div>
                          <span className="text-xs text-muted-foreground" data-testid={`ai-log-time-${log.id}`}>
                            {new Date(log.createdAt).toLocaleString('pt-BR')}
                          </span>
                        </div>
                        
                        <div className="space-y-1">
                          <p className="text-sm"><strong>Decisão:</strong> <span data-testid={`ai-log-decision-${log.id}`}>{log.decision}</span></p>
                          <p className="text-sm"><strong>Análise:</strong></p>
                          <div className="text-sm text-muted-foreground bg-muted p-3 rounded" data-testid={`ai-log-analysis-${log.id}`}>
                            {JSON.stringify(JSON.parse(log.analysis), null, 2)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-muted-foreground">Nenhuma análise de IA encontrada.</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Os logs das IAs aparecerão aqui quando o sistema estiver ativo.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}