import { Line } from 'react-chartjs-2';
import { useTheme } from '@/contexts/ThemeContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';

interface TrendData {
  months: string[];
  values: number[];
  trend: 'up' | 'down' | 'stable';
  monthlyGrowth: number;
}

interface TrendChartProps {
  data: TrendData;
  title: string;
  subtitle?: string;
}

export default function TrendChart({ data, title, subtitle }: TrendChartProps) {
  const { theme } = useTheme();

  // Calcular estatísticas simples para o usuário
  const currentValue = data.values[data.values.length - 1] || 0;
  const previousValue = data.values[data.values.length - 2] || currentValue;
  const growth = currentValue - previousValue;
  const growthPercent = previousValue > 0 ? ((growth / previousValue) * 100) : 0;

  const chartData = {
    labels: data.months,
    datasets: [{
      label: title,
      data: data.values,
      borderColor: theme === 'fluent' ? 
        (data.trend === 'up' ? '#107c10' : data.trend === 'down' ? '#d13438' : '#0078d4') :
        (data.trend === 'up' ? '#10b981' : data.trend === 'down' ? '#ef4444' : '#3b82f6'),
      backgroundColor: theme === 'fluent' ?
        (data.trend === 'up' ? 'rgba(16, 124, 16, 0.1)' : data.trend === 'down' ? 'rgba(209, 52, 56, 0.1)' : 'rgba(0, 120, 212, 0.1)') :
        (data.trend === 'up' ? 'rgba(16, 185, 129, 0.1)' : data.trend === 'down' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)'),
      borderWidth: theme === 'fluent' ? 3 : 2,
      fill: true,
      tension: theme === 'fluent' ? 0.1 : 0.4,
      pointRadius: theme === 'fluent' ? 4 : 3,
      pointHoverRadius: theme === 'fluent' ? 6 : 4,
      pointBackgroundColor: theme === 'fluent' ? '#ffffff' : 'currentColor',
      pointBorderColor: 'currentColor',
      pointBorderWidth: theme === 'fluent' ? 2 : 1,
    }]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      intersect: false,
      mode: 'index' as const,
    },
    plugins: {
      legend: {
        display: false
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
          weight: 600,
          family: theme === 'fluent' ? 'Segoe UI' : 'Inter'
        },
        bodyFont: {
          size: 13,
          family: theme === 'fluent' ? 'Segoe UI' : 'Inter'
        },
        callbacks: {
          label: function(context: any) {
            return `Valor: R$ ${Number(context.raw).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
          }
        }
      }
    },
    scales: {
      x: {
        grid: {
          color: theme === 'fluent' ? '#f3f2f1' : 'hsl(var(--border))',
          drawBorder: false,
        },
        ticks: {
          color: theme === 'fluent' ? '#605e5c' : 'hsl(var(--muted-foreground))',
          font: {
            size: theme === 'fluent' ? 12 : 11,
            family: theme === 'fluent' ? 'Segoe UI' : 'Inter'
          }
        }
      },
      y: {
        grid: {
          color: theme === 'fluent' ? '#f3f2f1' : 'hsl(var(--border))',
          drawBorder: false,
        },
        ticks: {
          color: theme === 'fluent' ? '#605e5c' : 'hsl(var(--muted-foreground))',
          font: {
            size: theme === 'fluent' ? 12 : 11,
            family: theme === 'fluent' ? 'Segoe UI' : 'Inter'
          },
          callback: function(value: any) {
            return `R$ ${Number(value).toLocaleString('pt-BR')}`;
          }
        }
      }
    },
    elements: {
      point: {
        hoverBackgroundColor: theme === 'fluent' ? '#ffffff' : 'currentColor',
      }
    },
    layout: {
      padding: theme === 'fluent' ? { top: 10, bottom: 10 } : 0
    }
  };

  const getTrendIcon = () => {
    if (data.trend === 'up') return <TrendingUp className="h-5 w-5 text-green-600" />;
    if (data.trend === 'down') return <TrendingDown className="h-5 w-5 text-red-600" />;
    return <Activity className="h-5 w-5 text-blue-600" />;
  };

  const getTrendText = () => {
    if (data.trend === 'up') return 'Crescimento';
    if (data.trend === 'down') return 'Queda';
    return 'Estável';
  };

  const getTrendColor = () => {
    if (data.trend === 'up') return theme === 'fluent' ? 'text-green-700' : 'text-green-600';
    if (data.trend === 'down') return theme === 'fluent' ? 'text-red-700' : 'text-red-600';
    return theme === 'fluent' ? 'text-blue-700' : 'text-blue-600';
  };

  return (
    <Card className={`${theme === 'fluent' ? 'fluent-card shadow-lg' : ''}`}>
      <CardHeader>
        <CardTitle className={`flex items-center justify-between ${theme === 'fluent' ? 'text-lg font-semibold' : ''}`}>
          <div className="flex items-center space-x-2">
            {getTrendIcon()}
            <span>{title}</span>
          </div>
          <div className={`flex items-center space-x-1 text-sm ${getTrendColor()}`}>
            <span className="font-semibold">{getTrendText()}</span>
          </div>
        </CardTitle>
        {subtitle && theme === 'fluent' && (
          <p className="text-sm text-muted-foreground mt-2">{subtitle}</p>
        )}
      </CardHeader>
      <CardContent>
        <div className={`${theme === 'fluent' ? 'h-80' : 'h-64'} mb-4`}>
          <Line data={chartData} options={chartOptions} />
        </div>
        
        {theme === 'fluent' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-muted p-4 border border-border">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Valor Atual</p>
              <p className="text-lg font-bold">
                R$ {currentValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="bg-muted p-4 border border-border">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Crescimento Mensal</p>
              <p className={`text-lg font-bold ${growthPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {growthPercent >= 0 ? '+' : ''}{growthPercent.toFixed(2)}%
              </p>
            </div>
            <div className="bg-muted p-4 border border-border">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">Diferença</p>
              <p className={`text-lg font-bold ${growth >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {growth >= 0 ? '+' : ''}R$ {growth.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}