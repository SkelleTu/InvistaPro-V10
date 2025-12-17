import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { Card, CardContent } from "@/components/ui/card";
import { Wallet, TrendingUp, Calendar, ArrowUp } from "lucide-react";
import InvestmentPieChart from "@/components/charts/InvestmentPieChart";
import TrendChart from "@/components/charts/TrendChart";

export default function PortfolioOverview() {
  const { user } = useAuth();
  const { theme } = useTheme();

  const { data: currentYield } = useQuery({
    queryKey: ["/api/yield/current"],
    enabled: !!user,
  });

  // Welcome Section
  const WelcomeSection = () => (
    <div className="mb-8">
      <h2 className="text-2xl font-bold text-foreground mb-2">
        Olá, {user?.nomeCompleto?.split(' ')[0] || 'Investidor'}!
      </h2>
      <p className="text-muted-foreground">Acompanhe seus investimentos e rendimentos</p>
    </div>
  );

  const formatCurrency = (value: string | number) => {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(numValue);
  };

  const calculateNextWithdrawalDay = () => {
    const today = new Date();
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    return lastDay;
  };

  // Gerar dados para os gráficos do tema fluent
  const generateChartData = () => {
    const currentBalance = parseFloat(user?.saldo || "0");
    const currentYieldValue = parseFloat((currentYield as any)?.rendimento || "0");
    const totalInvested = currentBalance - currentYieldValue;
    
    // Dados para gráfico de pizza
    const investmentData = {
      totalInvested: Math.max(totalInvested, 0),
      totalYield: currentYieldValue,
      currentBalance: currentBalance
    };

    // Simular dados históricos para gráfico de tendência
    const months = [];
    const values = [];
    const currentMonth = new Date().getMonth();
    
    for (let i = 5; i >= 0; i--) {
      const monthDate = new Date();
      monthDate.setMonth(currentMonth - i);
      months.push(monthDate.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }));
      
      // Simular crescimento gradual
      const baseValue = totalInvested;
      const growth = (5 - i) * (currentYieldValue / 6);
      values.push(baseValue + growth);
    }

    const trendData = {
      months,
      values,
      trend: currentYieldValue > 0 ? 'up' as const : 'stable' as const,
      monthlyGrowth: 0.835 // 0.835% mensal
    };

    return { investmentData, trendData };
  };

  const { investmentData, trendData } = generateChartData();

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
                  {formatCurrency(user?.saldo || 0)}
                </p>
              </div>
              <div className={`w-12 h-12 ${theme === 'fluent' ? 'bg-primary/10 border border-border' : 'bg-background/20 rounded-xl'} flex items-center justify-center`}>
                <Wallet className="h-6 w-6 text-foreground" />
              </div>
            </div>
            <div className="flex items-center">
              <ArrowUp className="h-4 w-4 text-green-400 mr-1" />
              <span className="text-green-400 text-sm">Lucros de até 130% dos maiores bancos brasileiros</span>
            </div>
          </CardContent>
        </Card>

        {/* Monthly Yield Card */}
        <Card className={`${theme === 'fluent' ? 'fluent-card bg-card shadow-lg border-0' : 'bg-card border-border'}`}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-muted-foreground text-sm">Até 130% dos Melhores Bancos</p>
                <p className="text-2xl font-bold text-card-foreground">
                  {formatCurrency((currentYield as any)?.rendimento || 0)}
                </p>
              </div>
              <div className={`w-12 h-12 ${theme === 'fluent' ? 'bg-emerald-500/10 border border-emerald-200' : 'bg-emerald-500/20 rounded-xl'} flex items-center justify-center`}>
                <TrendingUp className="h-6 w-6 text-emerald-600" />
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              Rendimento de até 130% baseado nos lucros dos principais bancos
            </div>
          </CardContent>
        </Card>

        {/* Next Withdrawal Card */}
        <Card className={`${theme === 'fluent' ? 'fluent-card bg-card shadow-lg border-0' : 'bg-card border-border'}`}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-muted-foreground text-sm">Próximo Saque</p>
                <p className="text-2xl font-bold text-card-foreground">
                  Dia {calculateNextWithdrawalDay()}
                </p>
              </div>
              <div className={`w-12 h-12 ${theme === 'fluent' ? 'bg-amber-500/10 border border-amber-200' : 'bg-amber-500/20 rounded-xl'} flex items-center justify-center`}>
                <Calendar className="h-6 w-6 text-amber-600" />
              </div>
            </div>
            <div className="text-sm text-muted-foreground">
              Rendimento disponível
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos para tema Fluent Design */}
      {theme === 'fluent' && (
        <div className="space-y-8 mt-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Gráfico de Pizza - Composição dos Investimentos */}
            <InvestmentPieChart data={investmentData} />
            
            {/* Gráfico de Tendência - Evolução do Saldo */}
            <TrendChart 
              data={trendData}
              title="Evolução do Seu Dinheiro"
              subtitle="Acompanhe como seus investimentos crescem mês a mês"
            />
          </div>
        </div>
      )}
    </div>
  );
}
