import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ArcElement, BarElement, Filler } from 'chart.js';
import { Line, Pie, Bar } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, ArcElement, BarElement, Filler);
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  Users, 
  FileText, 
  TrendingUp, 
  DollarSign, 
  CheckCircle, 
  XCircle,
  Clock,
  Eye,
  BarChart3,
  PieChart
} from "lucide-react";

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function AdminPanel({ isOpen, onClose }: AdminPanelProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [reviewReason, setReviewReason] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserForAnalysis, setSelectedUserForAnalysis] = useState<any>(null);

  // Verificar se é admin via API
  const { data: adminCheck } = useQuery<{ hasAccess: boolean; userEmail: string | null; message: string }>({
    queryKey: ["/api/admin/check-access"],
    enabled: !!user && isOpen,
  });
  
  const isAdmin = adminCheck?.hasAccess || false;

  // Buscar estatísticas do admin
  const { data: stats } = useQuery<any>({
    queryKey: ["/api/admin/stats"],
    enabled: isAdmin && isOpen,
  });

  // Buscar todos os usuários
  const { data: allUsers } = useQuery<any[]>({
    queryKey: ["/api/admin/users"],
    enabled: isAdmin && isOpen,
  });

  // Buscar documentos pendentes
  const { data: pendingDocs } = useQuery<any[]>({
    queryKey: ["/api/admin/documents/pending"],
    enabled: isAdmin && isOpen,
  });

  // Buscar movimentações recentes
  const { data: recentMovements } = useQuery<any[]>({
    queryKey: ["/api/admin/movements"],
    enabled: isAdmin && isOpen,
  });

  // Buscar dados completos do dashboard
  const { data: dashboardData } = useQuery<any>({
    queryKey: ["/api/admin/dashboard-data"],
    enabled: isAdmin && isOpen,
  });

  // Buscar status de pausa global do trading
  const { data: tradingControlStatus, refetch: refetchTradingStatus } = useQuery<any>({
    queryKey: ["/api/auto-trading/trading-control-status"],
    enabled: isAdmin && isOpen,
    refetchInterval: 5000, // Atualizar a cada 5 segundos
  });

  // Mutation para pausar trading
  const pauseTradingMutation = useMutation({
    mutationFn: async (reason: string) => {
      const response = await fetch('/api/auto-trading/pause-trading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reason }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Erro ao pausar trading');
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Trading pausado com sucesso!",
        description: "Todos os remixes pararam de operar.",
      });
      refetchTradingStatus();
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao pausar trading",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Mutation para retomar trading
  const resumeTradingMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/auto-trading/resume-trading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Erro ao retomar trading');
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Trading retomado com sucesso!",
        description: "Todos os remixes voltaram a operar.",
      });
      refetchTradingStatus();
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao retomar trading",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const [pauseReason, setPauseReason] = useState("");

  // Mutation para revisar documentos
  const reviewDocMutation = useMutation({
    mutationFn: async ({ documentId, approved, reason }: { documentId: string; approved: boolean; reason?: string }) => {
      const response = await fetch('/api/admin/documents/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ documentId, approved, reason }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Erro ao revisar documento');
      }

      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Documento revisado com sucesso!",
        description: "O usuário foi notificado sobre o resultado.",
      });
      
      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["/api/admin/documents/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setReviewReason("");
    },
    onError: (error: Error) => {
      toast({
        title: "Erro ao revisar documento",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const handleDocumentReview = (documentId: string, approved: boolean) => {
    if (!approved && !reviewReason.trim()) {
      toast({
        title: "Motivo obrigatório",
        description: "Por favor, informe o motivo da rejeição.",
        variant: "destructive",
      });
      return;
    }

    reviewDocMutation.mutate({
      documentId,
      approved,
      reason: approved ? undefined : reviewReason
    });
  };

  // Filtrar usuários baseado na pesquisa
  const filteredUsers = dashboardData?.userSummaries?.filter((u: any) => {
    if (!searchQuery.trim()) return false;
    const searchLower = searchQuery.toLowerCase().trim();
    return (
      u.nomeCompleto?.toLowerCase().includes(searchLower) ||
      u.email?.toLowerCase().includes(searchLower) ||
      u.cpf?.includes(searchQuery.trim())
    );
  }) || [];

  // Buscar dados detalhados do usuário selecionado
  const { data: selectedUserDetails } = useQuery<any>({
    queryKey: ["/api/admin/user", selectedUserForAnalysis?.id],
    enabled: isAdmin && !!selectedUserForAnalysis?.id,
  });

  if (!isAdmin) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acesso Negado</DialogTitle>
          </DialogHeader>
          <p>Apenas administradores têm acesso a esta funcionalidade.</p>
          <Button onClick={onClose}>Fechar</Button>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto p-4 md:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <Users className="h-5 w-5" />
            <div className="flex flex-col">
              <span>Painel Administrativo - InvistaPRO</span>
              <span className="text-xs font-medium text-muted-foreground tracking-wide opacity-75">Invista com Risco Zero</span>
            </div>
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="dashboard" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-1 h-auto">
            <TabsTrigger value="dashboard" className="text-xs md:text-sm px-2 py-2">Dashboard</TabsTrigger>
            <TabsTrigger value="search" className="text-xs md:text-sm px-2 py-2">🔍 Buscar</TabsTrigger>
            <TabsTrigger value="overview" className="text-xs md:text-sm px-2 py-2">Geral</TabsTrigger>
            <TabsTrigger value="users" className="text-xs md:text-sm px-2 py-2">Usuários</TabsTrigger>
            <TabsTrigger value="documents" className="text-xs md:text-sm px-2 py-2">Docs</TabsTrigger>
            <TabsTrigger value="movements" className="text-xs md:text-sm px-2 py-2">Movs</TabsTrigger>
            <TabsTrigger value="trading" className="text-xs md:text-sm px-2 py-2">Trading</TabsTrigger>
          </TabsList>

          {/* Dashboard Tab */}
          <TabsContent value="dashboard" className="space-y-6 mt-6">
            {/* Totais da Plataforma */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    💰 Total Investido (Apenas Depósitos)
                  </CardTitle>
                  <TrendingUp className="h-4 w-4 text-blue-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-blue-600">
                    R$ {Number(dashboardData?.platformTotals?.totalInvested || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Soma de todos os depósitos dos usuários
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    📈 Total com Rendimentos
                  </CardTitle>
                  <DollarSign className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-green-600">
                    R$ {Number(dashboardData?.platformTotals?.totalCurrentBalance || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Saldo atual total (investimento + rendimentos)
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    💎 Rendimentos Gerados
                  </CardTitle>
                  <TrendingUp className="h-4 w-4 text-emerald-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold text-emerald-600">
                    R$ {Number(dashboardData?.platformTotals?.totalYields || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Total de rendimentos pagos aos usuários
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Gráficos */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Gráfico de Pizza - Distribuição de Transações */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <PieChart className="h-5 w-5" />
                    <span>Distribuição por Tipo de Transação</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div style={{ height: '300px' }}>
                    {dashboardData?.movementTypeStats && dashboardData.movementTypeStats.length > 0 ? (
                      <Pie
                        data={{
                          labels: dashboardData.movementTypeStats.map((stat: any) => 
                            stat.tipo === 'deposito' ? 'Depósitos' :
                            stat.tipo === 'rendimento' ? 'Rendimentos' : 'Saques'
                          ),
                          datasets: [{
                            data: dashboardData.movementTypeStats.map((stat: any) => stat.total),
                            backgroundColor: [
                              '#10b981', // Verde para depósitos
                              '#3b82f6', // Azul para rendimentos
                              '#ef4444', // Vermelho para saques
                            ],
                            borderWidth: 2,
                            borderColor: '#1f2937'
                          }]
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: {
                              position: 'bottom' as const,
                              labels: {
                                color: 'hsl(var(--foreground))',
                                font: { size: 12 }
                              }
                            },
                            tooltip: {
                              callbacks: {
                                label: function(context) {
                                  const value = Number(context.raw);
                                  return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
                                }
                              }
                            }
                          }
                        }}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        <p>Nenhum dado de transação disponível</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Gráfico de Linha - Evolução Mensal */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <BarChart3 className="h-5 w-5" />
                    <span>Evolução Mensal da Plataforma</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div style={{ height: '300px' }}>
                    {dashboardData?.monthlyGrowth && dashboardData.monthlyGrowth.length > 0 ? (
                      <Line
                        data={{
                          labels: dashboardData.monthlyGrowth.map((month: any) => month.month).reverse(),
                          datasets: [
                            {
                              label: 'Depósitos',
                              data: dashboardData.monthlyGrowth.map((month: any) => month.deposits).reverse(),
                              borderColor: '#10b981',
                              backgroundColor: 'rgba(16, 185, 129, 0.1)',
                              tension: 0.4,
                              fill: true
                            },
                            {
                              label: 'Rendimentos',
                              data: dashboardData.monthlyGrowth.map((month: any) => month.yields).reverse(),
                              borderColor: '#3b82f6',
                              backgroundColor: 'rgba(59, 130, 246, 0.1)',
                              tension: 0.4,
                              fill: true
                            }
                          ]
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: {
                              position: 'top' as const,
                              labels: {
                                color: 'hsl(var(--foreground))',
                                font: { size: 12 }
                              }
                            },
                            tooltip: {
                              callbacks: {
                                label: function(context) {
                                  const value = Number(context.raw);
                                  return `${context.dataset.label}: R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
                                }
                              }
                            }
                          },
                          scales: {
                            y: {
                              ticks: {
                                color: 'hsl(var(--muted-foreground))',
                                callback: function(value) {
                                  return `R$ ${Number(value).toLocaleString('pt-BR')}`;
                                }
                              },
                              grid: { color: 'hsl(var(--border))' }
                            },
                            x: {
                              ticks: { color: 'hsl(var(--muted-foreground))' },
                              grid: { color: 'hsl(var(--border))' }
                            }
                          }
                        }}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground">
                        <p>Nenhum dado de crescimento mensal disponível</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Tabela de Usuários com Detalhes Financeiros */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Users className="h-5 w-5" />
                  <span>Usuários - Resumo Financeiro e Último Acesso</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Usuário</TableHead>
                        <TableHead>Total Investido</TableHead>
                        <TableHead>Rendimentos</TableHead>
                        <TableHead>Saldo Atual</TableHead>
                        <TableHead>Último Acesso</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dashboardData?.userSummaries?.map((user: any) => (
                        <TableRow key={user.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium text-sm">{user.nomeCompleto}</p>
                              <p className="text-xs text-muted-foreground">{user.email}</p>
                            </div>
                          </TableCell>
                          <TableCell className="font-mono">
                            <span className="text-blue-600">
                              R$ {Number(user.totalDeposited || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono">
                            <span className="text-green-600">
                              R$ {Number(user.totalYield || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                          </TableCell>
                          <TableCell className="font-mono">
                            <span className="text-emerald-600 font-semibold">
                              R$ {Number(user.saldo || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">
                            {user.lastAccess ? new Date(user.lastAccess).toLocaleString('pt-BR') : 'Nunca'}
                          </TableCell>
                          <TableCell>
                            <div className="flex space-x-1">
                              <Badge variant={user.contaAprovada ? "default" : "secondary"}>
                                {user.contaAprovada ? "Aprovado" : "Pendente"}
                              </Badge>
                              {user.documentosVerificados && (
                                <Badge variant="outline" className="text-green-600">
                                  ✅ Verificado
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Histórico de Transações Recentes */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <TrendingUp className="h-5 w-5" />
                  <span>Últimas 50 Transações da Plataforma</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data/Hora</TableHead>
                        <TableHead>Usuário</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Valor</TableHead>
                        <TableHead>Descrição</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dashboardData?.recentMovements?.map((movement: any) => (
                        <TableRow key={movement.id}>
                          <TableCell className="text-sm font-mono">
                            {new Date(movement.createdAt).toLocaleString('pt-BR')}
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="font-medium text-sm">{movement.userName}</p>
                              <p className="text-xs text-muted-foreground">{movement.userEmail}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                movement.tipo === 'deposito' ? 'default' :
                                movement.tipo === 'rendimento' ? 'secondary' : 'destructive'
                              }
                            >
                              {movement.tipo === 'deposito' ? '💰 Depósito' :
                               movement.tipo === 'rendimento' ? '📈 Rendimento' : '💸 Saque'}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono">
                            <span className={
                              movement.tipo === 'deposito' ? 'text-green-600' :
                              movement.tipo === 'rendimento' ? 'text-blue-600' : 'text-red-600'
                            }>
                              R$ {Number(movement.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm">
                            {movement.descricao || '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Search Tab */}
          <TabsContent value="search" className="space-y-6 mt-6">
            {/* Campo de Pesquisa */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Users className="h-5 w-5" />
                  <span>Pesquisar Usuário</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="search-user">Pesquisar por nome, email ou CPF</Label>
                    <Input
                      id="search-user"
                      type="text"
                      placeholder="Digite o nome, email ou CPF do usuário..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      data-testid="input-search-user"
                    />
                  </div>
                  
                  {/* Lista de Usuários Filtrados */}
                  {searchQuery.trim() && (
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      <h4 className="font-medium text-sm">Resultados da Pesquisa ({filteredUsers.length} encontrado{filteredUsers.length !== 1 ? 's' : ''}):</h4>
                      {filteredUsers.length === 0 ? (
                        <p className="text-muted-foreground text-sm">Nenhum usuário encontrado para "{searchQuery.trim()}".</p>
                      ) : (
                        <div className="grid gap-2">
                          {filteredUsers.slice(0, 20).map((user: any) => (
                            <div 
                              key={user.id}
                              className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                                selectedUserForAnalysis?.id === user.id 
                                  ? 'bg-blue-50 border-blue-200' 
                                  : 'hover:bg-gray-50'
                              }`}
                              onClick={() => setSelectedUserForAnalysis(user)}
                              data-testid={`user-result-${user.id}`}
                            >
                              <div className="flex justify-between items-start">
                                <div>
                                  <p className="font-medium">{user.nomeCompleto}</p>
                                  <p className="text-sm text-muted-foreground">{user.email}</p>
                                  <p className="text-xs text-muted-foreground">CPF: {user.cpf}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-sm font-mono text-green-600">
                                    R$ {Number(user.saldo || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {user.movementCount || 0} transações
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Análise Individual do Usuário Selecionado */}
            {selectedUserForAnalysis && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <TrendingUp className="h-5 w-5" />
                    <span>Análise Individual - {selectedUserForAnalysis.nomeCompleto}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Resumo Financeiro do Usuário */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-blue-50 p-4 rounded-lg">
                      <h4 className="text-sm font-medium text-blue-700">Total Investido</h4>
                      <p className="text-2xl font-bold text-blue-600">
                        R$ {Number(selectedUserForAnalysis.totalDeposited || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="bg-green-50 p-4 rounded-lg">
                      <h4 className="text-sm font-medium text-green-700">Rendimentos</h4>
                      <p className="text-2xl font-bold text-green-600">
                        R$ {Number(selectedUserForAnalysis.totalYield || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="bg-emerald-50 p-4 rounded-lg">
                      <h4 className="text-sm font-medium text-emerald-700">Saldo Atual</h4>
                      <p className="text-2xl font-bold text-emerald-600">
                        R$ {Number(selectedUserForAnalysis.saldo || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="bg-red-50 p-4 rounded-lg">
                      <h4 className="text-sm font-medium text-red-700">Total Sacado</h4>
                      <p className="text-2xl font-bold text-red-600">
                        R$ {Number(selectedUserForAnalysis.totalWithdrawn || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>

                  {/* Gráfico de Pizza - Distribuição Financeira do Usuário */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle>Distribuição Financeira</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div style={{ height: '250px' }}>
                          <Pie
                            data={{
                              labels: ['Depósitos', 'Rendimentos', 'Saques'],
                              datasets: [{
                                data: [
                                  selectedUserForAnalysis.totalDeposited || 0,
                                  selectedUserForAnalysis.totalYield || 0,
                                  selectedUserForAnalysis.totalWithdrawn || 0
                                ],
                                backgroundColor: ['#3b82f6', '#10b981', '#ef4444'],
                                borderWidth: 2,
                                borderColor: '#1f2937'
                              }]
                            }}
                            options={{
                              responsive: true,
                              maintainAspectRatio: false,
                              plugins: {
                                legend: {
                                  position: 'bottom' as const,
                                  labels: { color: 'hsl(var(--foreground))', font: { size: 12 } }
                                },
                                tooltip: {
                                  callbacks: {
                                    label: function(context) {
                                      const value = Number(context.raw);
                                      return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
                                    }
                                  }
                                }
                              }
                            }}
                          />
                        </div>
                      </CardContent>
                    </Card>

                    {/* Informações do Usuário */}
                    <Card>
                      <CardHeader>
                        <CardTitle>Informações do Usuário</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="font-medium">Nome:</span>
                            <p className="text-muted-foreground">{selectedUserForAnalysis.nomeCompleto}</p>
                          </div>
                          <div>
                            <span className="font-medium">Email:</span>
                            <p className="text-muted-foreground">{selectedUserForAnalysis.email}</p>
                          </div>
                          <div>
                            <span className="font-medium">CPF:</span>
                            <p className="text-muted-foreground">{selectedUserForAnalysis.cpf}</p>
                          </div>
                          <div>
                            <span className="font-medium">Cadastro:</span>
                            <p className="text-muted-foreground">
                              {new Date(selectedUserForAnalysis.createdAt).toLocaleDateString('pt-BR')}
                            </p>
                          </div>
                          <div>
                            <span className="font-medium">Último Acesso:</span>
                            <p className="text-muted-foreground">
                              {selectedUserForAnalysis.lastAccess 
                                ? new Date(selectedUserForAnalysis.lastAccess).toLocaleString('pt-BR')
                                : 'Nunca'
                              }
                            </p>
                          </div>
                          <div>
                            <span className="font-medium">Status:</span>
                            <div className="flex space-x-1">
                              <Badge variant={selectedUserForAnalysis.contaAprovada ? "default" : "secondary"}>
                                {selectedUserForAnalysis.contaAprovada ? "Aprovado" : "Pendente"}
                              </Badge>
                              {selectedUserForAnalysis.documentosVerificados && (
                                <Badge variant="outline" className="text-green-600">
                                  Verificado
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Histórico de Transações do Usuário */}
                  {selectedUserDetails?.movements && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Histórico de Transações</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Data/Hora</TableHead>
                              <TableHead>Tipo</TableHead>
                              <TableHead>Valor</TableHead>
                              <TableHead>Descrição</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {selectedUserDetails.movements.map((movement: any) => (
                              <TableRow key={movement.id}>
                                <TableCell className="text-sm font-mono">
                                  {new Date(movement.createdAt).toLocaleString('pt-BR')}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant={
                                      movement.tipo === 'deposito' ? 'default' :
                                      movement.tipo === 'rendimento' ? 'secondary' : 'destructive'
                                    }
                                  >
                                    {movement.tipo === 'deposito' ? '💰 Depósito' :
                                     movement.tipo === 'rendimento' ? '📈 Rendimento' : '💸 Saque'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-mono">
                                  <span className={
                                    movement.tipo === 'deposito' ? 'text-green-600' :
                                    movement.tipo === 'rendimento' ? 'text-blue-600' : 'text-red-600'
                                  }>
                                    R$ {Number(movement.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                  </span>
                                </TableCell>
                                <TableCell className="text-sm">
                                  {movement.descricao || '-'}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </CardContent>
                    </Card>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Total de Usuários
                  </CardTitle>
                  <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.totalUsers || 0}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Usuários Verificados
                  </CardTitle>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.verifiedUsers || 0}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Documentos Pendentes
                  </CardTitle>
                  <Clock className="h-4 w-4 text-yellow-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{stats?.pendingDocuments || 0}</div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Saldo Total
                  </CardTitle>
                  <DollarSign className="h-4 w-4 text-green-500" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    R$ {Number(stats?.totalBalance || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Todos os Usuários</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>CPF</TableHead>
                      <TableHead>Saldo</TableHead>
                      <TableHead>Verificado</TableHead>
                      <TableHead>Data de Cadastro</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allUsers?.map((user: any) => (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">{user.nomeCompleto}</TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>{user.cpf}</TableCell>
                        <TableCell>
                          R$ {Number(user.saldo || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>
                          <Badge variant={user.documentosVerificados ? "default" : "secondary"}>
                            {user.documentosVerificados ? "Sim" : "Não"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {new Date(user.createdAt).toLocaleDateString('pt-BR')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Documents Tab */}
          <TabsContent value="documents" className="space-y-6 mt-6">
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-lg font-semibold">Documentos Pendentes de Análise</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                {pendingDocs?.map((doc: any) => (
                  <div key={doc.id} className="border rounded-lg p-4 bg-card">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-2">
                      <div className="flex-1">
                        <h4 className="font-medium text-base">{doc.user.nomeCompleto}</h4>
                        <p className="text-sm text-muted-foreground">{doc.user.email}</p>
                        <p className="text-sm text-muted-foreground">CPF: {doc.user.cpf}</p>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {doc.tipo === 'rg' ? 'RG/CNH' : 'Comprovante de Residência'}
                      </Badge>
                    </div>
                    
                    <div className="text-sm text-muted-foreground mb-3">
                      Enviado em: {new Date(doc.createdAt).toLocaleDateString('pt-BR')}
                    </div>

                    <div className="space-y-3">
                      <div>
                        <Label htmlFor={`reason-${doc.id}`}>Motivo da rejeição (se aplicável)</Label>
                        <Textarea
                          id={`reason-${doc.id}`}
                          placeholder="Descreva o motivo caso vá rejeitar..."
                          value={reviewReason}
                          onChange={(e) => setReviewReason(e.target.value)}
                          rows={3}
                        />
                      </div>

                        <div className="flex flex-col sm:flex-row gap-2">
                        <Button
                          onClick={() => window.open(`/api/kyc/document/${doc.id}`, '_blank')}
                          variant="outline"
                          size="sm"
                          className="w-full sm:w-auto"
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          Visualizar
                        </Button>
                        <Button
                          onClick={() => handleDocumentReview(doc.id, true)}
                          disabled={reviewDocMutation.isPending}
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 w-full sm:w-auto"
                        >
                          <CheckCircle className="h-4 w-4 mr-1" />
                          Aprovar
                        </Button>
                        <Button
                          onClick={() => handleDocumentReview(doc.id, false)}
                          disabled={reviewDocMutation.isPending}
                          variant="destructive"
                          size="sm"
                          className="w-full sm:w-auto"
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Rejeitar
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}

                {pendingDocs?.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p>Nenhum documento pendente de análise.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Movements Tab */}
          <TabsContent value="movements" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle>Movimentações Recentes</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Usuário</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead>Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentMovements?.map((movement: any) => (
                      <TableRow key={movement.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{movement.user.nomeCompleto}</p>
                            <p className="text-sm text-muted-foreground">{movement.user.email}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              movement.tipo === 'deposito' ? 'default' :
                              movement.tipo === 'rendimento' ? 'secondary' : 'destructive'
                            }
                          >
                            {movement.tipo === 'deposito' ? 'Depósito' :
                             movement.tipo === 'rendimento' ? 'Rendimento' : 'Saque'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          R$ {Number(movement.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>{movement.descricao}</TableCell>
                        <TableCell>
                          {new Date(movement.createdAt).toLocaleDateString('pt-BR')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Trading Control Tab */}
          <TabsContent value="trading" className="space-y-6 mt-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Controle Centralizado de Trading
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Status Badge */}
                <div className="flex items-center gap-4">
                  <div>
                    <p className="text-sm font-medium mb-1">Status Global</p>
                    <Badge variant={tradingControlStatus?.isPaused ? "destructive" : "default"} className="text-base px-4 py-2">
                      {tradingControlStatus?.isPaused ? "🛑 PAUSADO" : "▶️ ATIVO"}
                    </Badge>
                  </div>
                </div>

                {/* Pause Information */}
                {tradingControlStatus?.isPaused && (
                  <div className="bg-red-50 dark:bg-red-950 p-4 rounded-lg border border-red-200 dark:border-red-800">
                    <p className="text-sm"><span className="font-semibold">Pausado por:</span> {tradingControlStatus.pausedBy}</p>
                    <p className="text-sm"><span className="font-semibold">Data:</span> {tradingControlStatus.pausedAt ? new Date(tradingControlStatus.pausedAt).toLocaleString('pt-BR') : '-'}</p>
                    <p className="text-sm"><span className="font-semibold">Motivo:</span> {tradingControlStatus.pauseReason}</p>
                  </div>
                )}

                {/* Control Buttons */}
                <div className="space-y-3">
                  {!tradingControlStatus?.isPaused ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Pausar trading globalmente</p>
                      <Input
                        placeholder="Motivo da pausa..."
                        value={pauseReason}
                        onChange={(e) => setPauseReason(e.target.value)}
                      />
                      <Button
                        onClick={() => pauseTradingMutation.mutate(pauseReason)}
                        disabled={pauseTradingMutation.isPending || !pauseReason.trim()}
                        variant="destructive"
                        className="w-full"
                      >
                        {pauseTradingMutation.isPending ? "Pausando..." : "🛑 Pausar Trading para TODOS os Remixes"}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        Isso pausará operações em TODOS os remixes da aplicação
                      </p>
                    </div>
                  ) : (
                    <Button
                      onClick={() => resumeTradingMutation.mutate()}
                      disabled={resumeTradingMutation.isPending}
                      className="w-full bg-green-600 hover:bg-green-700"
                    >
                      {resumeTradingMutation.isPending ? "Retomando..." : "▶️ Retomar Trading para TODOS os Remixes"}
                    </Button>
                  )}
                </div>

                {/* Info */}
                <div className="bg-blue-50 dark:bg-blue-950 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-sm text-muted-foreground">
                    <span className="font-semibold block mb-2">ℹ️ Como funciona:</span>
                    Este controle é <span className="font-semibold">centralizado</span> e compartilhado entre TODOS os remixes. Quando você pausar o trading aqui, todos os remixes irão:
                  </p>
                  <ul className="text-sm text-muted-foreground mt-2 ml-4 space-y-1">
                    <li>✓ Verificar a flag de pausa antes de executar operações</li>
                    <li>✓ Interromper novas operações imediatamente</li>
                    <li>✓ Retomar automaticamente quando reativado</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end mt-6">
          <Button onClick={onClose}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}