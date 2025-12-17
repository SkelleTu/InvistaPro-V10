import { Pie } from 'react-chartjs-2';
import { useTheme } from '@/contexts/ThemeContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, TrendingUp } from 'lucide-react';

interface InvestmentData {
  totalInvested: number;
  totalYield: number;
  currentBalance: number;
}

interface InvestmentPieChartProps {
  data: InvestmentData;
}

export default function InvestmentPieChart({ data }: InvestmentPieChartProps) {
  const { theme } = useTheme();

  // Calcular categorias leigas para o usuário entender
  const categories = [
    {
      label: 'Dinheiro Investido',
      value: data.totalInvested,
      color: theme === 'fluent' ? '#0078d4' : '#10b981',
      description: 'Valor que você depositou'
    },
    {
      label: 'Lucros Gerados',
      value: data.totalYield,
      color: theme === 'fluent' ? '#107c10' : '#3b82f6',
      description: 'Rendimentos conquistados'
    }
  ];

  const chartData = {
    labels: categories.map(cat => cat.label),
    datasets: [{
      data: categories.map(cat => cat.value),
      backgroundColor: categories.map(cat => cat.color),
      borderColor: theme === 'fluent' ? '#ffffff' : '#1f2937',
      borderWidth: theme === 'fluent' ? 2 : 1,
      hoverBorderWidth: 3,
    }]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: {
          color: theme === 'fluent' ? '#323130' : 'hsl(var(--foreground))',
          font: { 
            size: theme === 'fluent' ? 14 : 12,
            weight: theme === 'fluent' ? 'bold' : 'normal',
            family: theme === 'fluent' ? 'Segoe UI, Arial' : 'Inter'
          },
          padding: theme === 'fluent' ? 20 : 15,
          usePointStyle: true,
          pointStyle: theme === 'fluent' ? 'rect' : 'circle'
        }
      },
      tooltip: {
        backgroundColor: theme === 'fluent' ? '#ffffff' : '#1f2937',
        titleColor: theme === 'fluent' ? '#323130' : '#ffffff',
        bodyColor: theme === 'fluent' ? '#323130' : '#ffffff',
        borderColor: theme === 'fluent' ? '#d2d0ce' : '#374151',
        borderWidth: theme === 'fluent' ? 1 : 0,
        cornerRadius: theme === 'fluent' ? 0 : 6,
        titleFont: {
          size: 14,
          weight: '600',
          family: theme === 'fluent' ? 'Segoe UI' : 'Inter'
        },
        bodyFont: {
          size: 13,
          family: theme === 'fluent' ? 'Segoe UI' : 'Inter'
        },
        callbacks: {
          label: function(context: any) {
            const value = Number(context.raw);
            const category = categories[context.dataIndex];
            const percentage = ((value / data.currentBalance) * 100).toFixed(1);
            return `${category.description}: R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} (${percentage}%)`;
          }
        }
      }
    },
    elements: {
      arc: {
        borderWidth: theme === 'fluent' ? 0 : 1,
      }
    },
    layout: {
      padding: theme === 'fluent' ? 10 : 0
    }
  };

  return (
    <Card className={`${theme === 'fluent' ? 'fluent-card shadow-lg' : ''}`}>
      <CardHeader>
        <CardTitle className={`flex items-center space-x-2 ${theme === 'fluent' ? 'text-lg font-semibold' : ''}`}>
          <PieChart className="h-5 w-5" />
          <span>Composição dos Seus Investimentos</span>
        </CardTitle>
        {theme === 'fluent' && (
          <p className="text-sm text-muted-foreground mt-2">
            Veja como seu dinheiro está distribuído de forma simples
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className={`${theme === 'fluent' ? 'h-80' : 'h-64'}`}>
          <Pie data={chartData} options={chartOptions} />
        </div>
        
        {theme === 'fluent' && (
          <div className="mt-6 space-y-3">
            {categories.map((category, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-muted rounded-none border border-border">
                <div className="flex items-center space-x-3">
                  <div 
                    className="w-4 h-4"
                    style={{ backgroundColor: category.color }}
                  />
                  <div>
                    <p className="font-semibold text-sm">{category.label}</p>
                    <p className="text-xs text-muted-foreground">{category.description}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-sm">
                    R$ {category.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {((category.value / data.currentBalance) * 100).toFixed(1)}%
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}