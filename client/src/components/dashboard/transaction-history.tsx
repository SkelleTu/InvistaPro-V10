import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowDown, Plus } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export default function TransactionHistory() {
  const { data: movements = [], isLoading } = useQuery({
    queryKey: ["/api/movements"],
  });

  const formatCurrency = (value: string | number) => {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(numValue);
  };

  const getMovementIcon = (tipo: string) => {
    switch (tipo) {
      case 'deposito':
        return <Plus className="h-4 w-4 text-primary" />;
      case 'rendimento':
        return <ArrowUp className="h-4 w-4 text-emerald-600" />;
      case 'saque':
        return <ArrowDown className="h-4 w-4 text-red-600" />;
      default:
        return <ArrowUp className="h-4 w-4 text-gray-600" />;
    }
  };

  const getMovementColor = (tipo: string) => {
    switch (tipo) {
      case 'deposito':
        return 'text-primary';
      case 'rendimento':
        return 'text-emerald-600';
      case 'saque':
        return 'text-red-600';
      default:
        return 'text-gray-900';
    }
  };

  const getBackgroundColor = (tipo: string) => {
    switch (tipo) {
      case 'deposito':
        return 'bg-blue-50';
      case 'rendimento':
        return 'bg-emerald-50';
      case 'saque':
        return 'bg-red-50';
      default:
        return 'bg-gray-50';
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-white border-gray-200">
        <CardContent className="p-6">
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-gray-200 rounded w-1/4"></div>
            <div className="space-y-3">
              <div className="h-16 bg-gray-200 rounded"></div>
              <div className="h-16 bg-gray-200 rounded"></div>
              <div className="h-16 bg-gray-200 rounded"></div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white border-gray-200">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-gray-900">Movimentações Recentes</h3>
          <Button variant="ghost" className="text-primary hover:text-primary/80 text-sm font-medium">
            Ver todas
          </Button>
        </div>
        
        {movements.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>Nenhuma movimentação encontrada</p>
            <p className="text-sm">Suas transações aparecerão aqui</p>
          </div>
        ) : (
          <div className="space-y-4">
            {movements.map((movimento: any) => (
              <div 
                key={movimento.id} 
                className={`flex items-center justify-between p-4 ${getBackgroundColor(movimento.tipo)} rounded-xl`}
              >
                <div className="flex items-center space-x-3">
                  <div className={`w-10 h-10 ${getBackgroundColor(movimento.tipo)} rounded-full flex items-center justify-center border-2 border-white`}>
                    {getMovementIcon(movimento.tipo)}
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">
                      {movimento.descricao || movimento.tipo}
                    </p>
                    <p className="text-sm text-gray-500">
                      {format(new Date(movimento.createdAt), 'dd MMM yyyy', { locale: ptBR })}
                    </p>
                  </div>
                </div>
                <span className={`font-semibold ${getMovementColor(movimento.tipo)}`}>
                  {movimento.tipo === 'saque' ? '-' : '+'}
                  {formatCurrency(movimento.valor)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
