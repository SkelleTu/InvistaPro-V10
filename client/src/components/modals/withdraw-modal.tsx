import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/contexts/ThemeContext";
import { AlertTriangle, Banknote } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WithdrawModal({ isOpen, onClose }: WithdrawModalProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const { theme } = useTheme();
  const queryClient = useQueryClient();

  const withdrawTotalMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/withdraw/total", { method: "POST" });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Saque realizado!",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/movements"] });
      onClose();
    },
    onError: (error) => {
      toast({
        title: "Erro no saque",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const formatCurrency = (value: string | number) => {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(numValue);
  };

  const calculateDaysFromDeposit = () => {
    if (!user?.depositoData) return 0;
    const today = new Date();
    const depositDate = new Date(user.depositoData);
    const diffTime = today.getTime() - depositDate.getTime();
    return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  };

  const canWithdraw = () => {
    const daysFromDeposit = calculateDaysFromDeposit();
    const today = new Date();
    return daysFromDeposit >= 95 && today.getDate() <= 5;
  };

  const getRemainingDays = () => {
    const daysFromDeposit = calculateDaysFromDeposit();
    return Math.max(0, 95 - daysFromDeposit);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className={`max-w-md ${theme === 'fluent' ? 'fluent-card shadow-xl border-0' : ''}`}>
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-gray-900 flex items-center">
            <Banknote className="h-5 w-5 mr-2" />
            Saque Total
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* Balance Display */}
          <div className={`${theme === 'fluent' ? 'bg-muted border border-border p-6 text-center' : 'bg-gray-50 rounded-xl p-6 text-center'}`}>
            <p className="text-sm text-gray-600 mb-2">Valor Total Disponível</p>
            <p className="text-3xl font-bold text-gray-900">
              {formatCurrency(user?.saldo || 0)}
            </p>
          </div>

          {/* Withdrawal Rules */}
          <div className={`${theme === 'fluent' ? 'bg-amber-50 border border-amber-200 p-4' : 'bg-amber-50 border border-amber-200 rounded-lg p-4'}`}>
            <div className="flex items-start space-x-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800">
                <p className="font-medium mb-2">Regras para Saque Total:</p>
                <ul className="space-y-1 text-xs">
                  <li>• Disponível apenas após 95 dias do primeiro depósito</li>
                  <li>• Pode ser solicitado até o 5º dia útil do mês</li>
                  <li>• O saque remove todo o saldo da conta</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Status Information */}
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Dias desde o depósito:</span>
              <span className="font-medium">{calculateDaysFromDeposit()} dias</span>
            </div>
            
            {getRemainingDays() > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Dias restantes:</span>
                <span className="font-medium text-amber-600">{getRemainingDays()} dias</span>
              </div>
            )}
            
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Dia do mês atual:</span>
              <span className="font-medium">{new Date().getDate()}º dia</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3">
            {canWithdraw() ? (
              <Button
                onClick={() => withdrawTotalMutation.mutate()}
                disabled={withdrawTotalMutation.isPending}
                className="w-full bg-red-600 hover:bg-red-700 text-white"
                size="lg"
              >
                {withdrawTotalMutation.isPending 
                  ? "Processando saque..." 
                  : "Confirmar Saque Total"
                }
              </Button>
            ) : (
              <Button disabled className="w-full" size="lg">
                Saque Total Indisponível
              </Button>
            )}
            
            <Button
              variant="outline"
              onClick={() => onClose()}
              className="w-full"
            >
              Cancelar
            </Button>
          </div>

          {!canWithdraw() && (
            <div className="text-center text-sm text-gray-500">
              {getRemainingDays() > 0 
                ? `Aguarde ${getRemainingDays()} dias para solicitar o saque total`
                : "Saque total disponível apenas até o 5º dia do mês"
              }
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
