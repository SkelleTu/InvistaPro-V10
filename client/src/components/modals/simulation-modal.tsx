import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Calculator } from "lucide-react";

interface SimulationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface SimulationResult {
  historico: Array<{
    mes: number;
    rendimento: number;
    saldoAcumulado: number;
  }>;
  resumo: {
    totalInvestido: number;
    totalRendimentos: number;
    valorFinal: number;
  };
}

export default function SimulationModal({ isOpen, onClose }: SimulationModalProps) {
  const [depositoInicial, setDepositoInicial] = useState("");
  const [meses, setMeses] = useState("");
  const [depositoExtra, setDepositoExtra] = useState("");
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const { toast } = useToast();

  const simulationMutation = useMutation({
    mutationFn: async (data: {
      depositoInicial: number;
      meses: number;
      depositoExtra?: number;
    }) => {
      const response = await apiRequest("/api/simulation", { method: "POST", body: JSON.stringify(data) });
      return response.json();
    },
    onSuccess: (data) => {
      setSimulationResult(data);
      toast({
        title: "Simulação realizada!",
        description: "Confira os resultados abaixo",
      });
    },
    onError: (error) => {
      toast({
        title: "Erro na simulação",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleRunSimulation = () => {
    const inicial = parseFloat(depositoInicial);
    const periodo = parseInt(meses);
    const extra = depositoExtra ? parseFloat(depositoExtra) : 0;

    if (!inicial || inicial <= 0) {
      toast({
        title: "Valor inválido",
        description: "Informe um valor inicial válido",
        variant: "destructive",
      });
      return;
    }

    if (!periodo || periodo <= 0) {
      toast({
        title: "Período inválido",
        description: "Informe um período válido em meses",
        variant: "destructive",
      });
      return;
    }

    simulationMutation.mutate({
      depositoInicial: inicial,
      meses: periodo,
      depositoExtra: extra,
    });
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(value);
  };

  const handleClose = () => {
    setDepositoInicial("");
    setMeses("");
    setDepositoExtra("");
    setSimulationResult(null);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold text-gray-900">
            Simulação - Rendimentos de até 130% dos maiores bancos
          </DialogTitle>
        </DialogHeader>
        
        <div className="overflow-y-auto max-h-[calc(90vh-120px)] space-y-6">
          {/* Simulation Form */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <Label htmlFor="inicial">Depósito Inicial</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
                  R$
                </span>
                <Input
                  id="inicial"
                  type="number"
                  value={depositoInicial}
                  onChange={(e) => setDepositoInicial(e.target.value)}
                  className="pl-8"
                  placeholder="1.000,00"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="periodo">Período (meses)</Label>
              <Input
                id="periodo"
                type="number"
                value={meses}
                onChange={(e) => setMeses(e.target.value)}
                placeholder="12"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="mensal">Depósito Mensal (opcional)</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">
                  R$
                </span>
                <Input
                  id="mensal"
                  type="number"
                  value={depositoExtra}
                  onChange={(e) => setDepositoExtra(e.target.value)}
                  className="pl-8"
                  placeholder="0,00"
                />
              </div>
            </div>
          </div>
          
          <Button
            onClick={handleRunSimulation}
            disabled={simulationMutation.isPending}
            className="w-full md:w-auto bg-primary hover:bg-primary/90"
            size="lg"
          >
            <Calculator className="h-4 w-4 mr-2" />
            {simulationMutation.isPending ? "Simulando..." : "Simular - Performance dos maiores bancos brasileiros"}
          </Button>
          
          {/* Results */}
          {simulationResult && (
            <div className="space-y-6">
              {/* Summary Cards */}
              <div className="bg-gradient-to-r from-primary to-primary/90 rounded-xl p-6 text-white">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="text-center">
                    <p className="text-blue-100 text-sm">Total Investido</p>
                    <p className="text-2xl font-bold">
                      {formatCurrency(simulationResult.resumo.totalInvestido)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-blue-100 text-sm">Até 130% dos Bancos - Rendimentos</p>
                    <p className="text-2xl font-bold">
                      {formatCurrency(simulationResult.resumo.totalRendimentos)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-blue-100 text-sm">Valor Final</p>
                    <p className="text-2xl font-bold">
                      {formatCurrency(simulationResult.resumo.valorFinal)}
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Results Table */}
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Mês
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Rendimento (130% Bancos)
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Saldo Acumulado
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {simulationResult.historico.map((month) => (
                        <tr key={month.mes}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {month.mes}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-emerald-600 font-semibold">
                            {formatCurrency(month.rendimento)}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 font-semibold">
                            {formatCurrency(month.saldoAcumulado)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
