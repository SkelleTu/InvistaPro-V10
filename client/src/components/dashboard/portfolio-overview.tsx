import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { Card, CardContent } from "@/components/ui/card";
import { Wallet, TrendingUp, Calendar, ArrowUp, AlertCircle } from "lucide-react";
import InvestmentPieChart from "@/components/charts/InvestmentPieChart";

export default function PortfolioOverview() {
  const { user } = useAuth();
  const { theme } = useTheme();

  const { data: dashboardData } = useQuery<any>({
    queryKey: ["/api/dashboard/variable-income"],
    enabled: !!user,
  });

  const currentYield = dashboardData ? { rendimento: dashboardData.rendimento } : undefined;

  // Welcome Section
  const WelcomeSection = () => (
    <div className="mb-8">
      <h2 className="text-2xl font-bold text-foreground mb-2">
        Olá, {user?.nomeCompleto?.split(' ')[0] || 'Investidor'}!
      </h2>
      <p className="text-muted-foreground">Acompanhe o saldo registrado e as ferramentas da plataforma</p>
    </div>
  );

  const formatCurrency = (value: string | number) => {
    const parsedValue = typeof value === 'string' ? Number.parseFloat(value) : Number(value);
    const numValue = Number.isFinite(parsedValue) ? parsedValue : 0;
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(numValue);
  };

  // A composição usa apenas saldo registrado e estimativa matemática; não representa aportes ou lucros conciliados.
  const currentBalance = Number(user?.saldo ?? 0);
  const currentYieldValue = Number.parseFloat(String(currentYield?.rendimento ?? "0"));
  const safeBalance = Number.isFinite(currentBalance) ? currentBalance : 0;
  const safeYield = Number.isFinite(currentYieldValue) ? Math.max(0, currentYieldValue) : 0;
  const investmentData = {
    totalInvested: Math.max(safeBalance - safeYield, 0),
    totalYield: safeYield,
    currentBalance: safeBalance,
  };

  return (
    <div>
      <WelcomeSection />
      
      {/* Portfolio Overview Cards */}
      <div className={`grid grid-cols-1 md:grid-cols-3 ${theme === 'fluent' ? 'fluent-grid gap-3' : 'gap-6'} mb-8`}>
        {/* Total Balance Card */}
        <Card className={`${theme === 'fluent' ? 'fluent-card bg-card shadow-lg border-0' : 'bg-gradient-to-r from-accent to-muted border-border'}`}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-muted-foreground text-sm">Saldo Total</p>
                <p className="text-3xl font-bold text-foreground">
                  {formatCurrency(dashboardData?.saldo || user?.saldo || 0)}
                </p>
              </div>
              <div className={`w-12 h-12 ${theme === 'fluent' ? 'bg-primary/10 border border-border' : 'bg-background/20 rounded-xl'} flex items-center justify-center`}>
                <Wallet className="h-6 w-6 text-foreground" />
              </div>
            </div>
            <div className="flex items-center">
              <ArrowUp className="h-4 w-4 text-green-400 mr-1" />
              <span className="text-green-400 text-sm">Saldo registrado na conta; não confirma disponibilidade para saque</span>
            </div>
          </CardContent>
        </Card>

        {/* Monthly Yield Card */}
        <Card className={`${theme === 'fluent' ? 'fluent-card bg-card shadow-lg border-0' : 'bg-card border-border'}`}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-muted-foreground text-sm">Rendimento estimado</p>
                <p className="text-2xl font-bold text-card-foreground">
                  {formatCurrency((currentYield as any)?.rendimento || 0)}
                </p>
              </div>
              <div className={`w-12 h-12 ${theme === 'fluent' ? 'bg-emerald-500/10 border border-emerald-200' : 'bg-emerald-500/20 rounded-xl'} flex items-center justify-center`}>
                <TrendingUp className="h-6 w-6 text-emerald-600" />
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              Estimativa ilustrativa baseada em taxa fixa de 0,835% ao mês; não é rendimento realizado ou contratado
            </div>
          </CardContent>
        </Card>

        {/* Next Withdrawal Card */}
        <Card className={`${theme === 'fluent' ? 'fluent-card bg-card shadow-lg border-0' : 'bg-card border-border'}`}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-muted-foreground text-sm">Status dos saques</p>
                <p className="text-2xl font-bold text-card-foreground">
                  Indisponível
                </p>
              </div>
              <div className={`w-12 h-12 ${theme === 'fluent' ? 'bg-amber-500/10 border border-amber-200' : 'bg-amber-500/20 rounded-xl'} flex items-center justify-center`}>
                <Calendar className="h-6 w-6 text-amber-600" />
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              Integração de transferência não configurada
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Trading Statistics Cards */}
      {dashboardData && (
        <div className={`grid grid-cols-1 md:grid-cols-4 ${theme === 'fluent' ? 'fluent-grid gap-3' : 'gap-6'} mb-8`}>
          <Card className={`${theme === 'fluent' ? 'fluent-card bg-card shadow-lg border-0' : 'bg-card border-border'}`}>
            <CardContent className="p-6">
              <p className="text-muted-foreground text-sm">Total de Operações</p>
              <p className="text-2xl font-bold text-card-foreground">{Number.isFinite(Number(dashboardData.totalTrades)) ? Number(dashboardData.totalTrades) : 0}</p>
            </CardContent>
          </Card>
          <Card className={`${theme === 'fluent' ? 'fluent-card bg-card shadow-lg border-0' : 'bg-card border-border'}`}>
            <CardContent className="p-6">
              <p className="text-muted-foreground text-sm">Taxa de Sucesso</p>
              <p className="text-2xl font-bold text-green-600">{(Number.isFinite(Number(dashboardData.winRate)) ? Number(dashboardData.winRate) : 0).toFixed(2)}%</p>
            </CardContent>
          </Card>
          <Card className={`${theme === 'fluent' ? 'fluent-card bg-card shadow-lg border-0' : 'bg-card border-border'}`}>
            <CardContent className="p-6">
              <p className="text-muted-foreground text-sm">Operações Vencidas</p>
              <p className="text-2xl font-bold text-card-foreground">{Number(dashboardData.wonTrades) || 0}/{Number(dashboardData.totalTrades) || 0}</p>
            </CardContent>
          </Card>
          <Card className={`${theme === 'fluent' ? 'fluent-card bg-card shadow-lg border-0' : 'bg-card border-border'}`}>
            <CardContent className="p-6">
              <p className="text-muted-foreground text-sm">Lucro/Prejuízo</p>
              <p className={`text-2xl font-bold ${(Number(dashboardData.totalPnL) || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {formatCurrency(Number(dashboardData.totalPnL) || 0)}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Gráficos para tema Fluent Design */}
      {theme === 'fluent' && (
        <div className="space-y-8 mt-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <InvestmentPieChart data={investmentData} />
            <Card className="fluent-card bg-card shadow-lg border-0">
              <CardContent className="h-full min-h-[280px] flex flex-col items-center justify-center text-center p-8">
                <AlertCircle className="h-8 w-8 text-muted-foreground mb-3" />
                <h3 className="font-semibold text-foreground">Histórico de evolução indisponível</h3>
                <p className="text-sm text-muted-foreground mt-2 max-w-sm">
                  Ainda não há uma série histórica de saldos e movimentações conciliadas. A plataforma não cria crescimento fictício para preencher o gráfico.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
