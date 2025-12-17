import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Plus, Download, Banknote, Calculator } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import DepositModal from "@/components/modals/deposit-modal";
import SimulationModal from "@/components/modals/simulation-modal";
import WithdrawModal from "@/components/modals/withdraw-modal";

export default function ActionButtons() {
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showSimulationModal, setShowSimulationModal] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const { toast } = useToast();
  const { theme } = useTheme();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const withdrawYieldMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/yield/withdraw", { method: "POST" });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Saque realizado!",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/movements"] });
    },
    onError: (error) => {
      toast({
        title: "Erro no saque",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <>
      <div className={`grid grid-cols-1 md:grid-cols-4 ${theme === 'fluent' ? 'fluent-grid gap-3' : 'gap-4'} mb-8`}>
        <Button
          onClick={() => setShowDepositModal(true)}
          className={`${theme === 'fluent' ? 'fluent-button fluent-elevated bg-primary hover:bg-primary/90 text-primary-foreground' : 'bg-foreground hover:bg-foreground/90 text-background rounded-xl'} p-4 font-medium transition-all duration-300 flex items-center justify-center space-x-2 h-auto`}
          size="lg"
        >
          <Plus className="h-4 w-4" />
          <span>Depositar</span>
        </Button>
        
        <Button
          onClick={() => withdrawYieldMutation.mutate()}
          disabled={withdrawYieldMutation.isPending}
          className={`${theme === 'fluent' ? 'fluent-button fluent-elevated bg-emerald-600 hover:bg-emerald-700 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl'} p-4 font-medium transition-all duration-300 flex items-center justify-center space-x-2 h-auto`}
          size="lg"
        >
          <Download className="h-4 w-4" />
          <span>Sacar Rendimento</span>
        </Button>
        
        <Button
          onClick={() => setShowWithdrawModal(true)}
          className={`${theme === 'fluent' ? 'fluent-button fluent-elevated bg-amber-600 hover:bg-amber-700 text-white' : 'bg-amber-600 hover:bg-amber-700 text-white rounded-xl'} p-4 font-medium transition-all duration-300 flex items-center justify-center space-x-2 h-auto`}
          size="lg"
        >
          <Banknote className="h-4 w-4" />
          <span>Saque Total</span>
        </Button>
        
        <Button
          onClick={() => setShowSimulationModal(true)}
          className={`${theme === 'fluent' ? 'fluent-button fluent-elevated bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white rounded-xl'} p-4 font-medium transition-all duration-300 flex items-center justify-center space-x-2 h-auto`}
          size="lg"
        >
          <Calculator className="h-4 w-4" />
          <span>Simular</span>
        </Button>
      </div>

      {/* Modals */}
      <DepositModal
        isOpen={showDepositModal}
        onClose={() => setShowDepositModal(false)}
      />
      
      <SimulationModal
        isOpen={showSimulationModal}
        onClose={() => setShowSimulationModal(false)}
      />
      
      <WithdrawModal
        isOpen={showWithdrawModal}
        onClose={() => setShowWithdrawModal(false)}
      />
    </>
  );
}