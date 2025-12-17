import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/contexts/ThemeContext";
import { Copy, QrCode, X, TrendingUp } from "lucide-react";
import iconImage from "@/assets/investpro-icon.png";


interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DepositModal({ isOpen, onClose }: DepositModalProps) {
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null);
  const [showFloatingButton, setShowFloatingButton] = useState(false);
  const [pixData, setPixData] = useState<{
    qrCode: string;
    pixString: string;
    valor: string;
    chavePix?: string;
    empresa?: string;
    observacao?: string;
  } | null>(null);
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const { theme } = useTheme();
  const queryClient = useQueryClient();

  // Buscar valores disponíveis para depósito apenas se o usuário estiver autenticado
  const { data: amountsData } = useQuery({
    queryKey: ['/api/deposit/amounts'],
    enabled: !!user && isAuthenticated,
    queryFn: async () => {
      const response = await apiRequest("/api/deposit/amounts");
      return response.json();
    },
  });

  const generatePixMutation = useMutation({
    mutationFn: async (valor: number) => {
      const response = await apiRequest("/api/pix/generate", { method: "POST", body: JSON.stringify({ valor }) });
      return response.json();
    },
    onSuccess: (data) => {
      setPixData(data);
      toast({
        title: "PIX gerado!",
        description: "Use o QR Code ou copie a chave PIX",
      });
    },
    onError: (error) => {
      toast({
        title: "Erro ao gerar PIX",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const confirmDepositMutation = useMutation({
    mutationFn: async () => {
      if (!pixData) throw new Error("PIX data not found");
      const response = await apiRequest("/api/deposit/confirm", { 
        method: "POST", 
        body: JSON.stringify({
          valor: pixData.valor,
          pixString: pixData.pixString,
        })
      });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Depósito confirmado!",
        description: data.message,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      queryClient.invalidateQueries({ queryKey: ["/api/movements"] });
      handleClose();
    },
    onError: (error) => {
      toast({
        title: "Erro ao confirmar depósito",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleGeneratePix = () => {
    if (!selectedAmount) {
      toast({
        title: "Valor não selecionado",
        description: "Selecione um valor para depósito",
        variant: "destructive",
      });
      return;
    }
    generatePixMutation.mutate(selectedAmount);
  };

  const handleCopyPix = async () => {
    if (pixData?.pixString) {
      await navigator.clipboard.writeText(pixData.pixString);
      toast({
        title: "PIX copiado!",
        description: "A chave PIX foi copiada para a área de transferência",
      });
    }
  };

  const handleClose = () => {
    setSelectedAmount(null);
    setShowFloatingButton(false);
    setPixData(null);
    onClose();
  };

  const handleNewDeposit = () => {
    setPixData(null);
    setSelectedAmount(null);
    setShowFloatingButton(false);
  };

  const handleAmountSelect = (amount: number) => {
    setSelectedAmount(amount);
    setShowFloatingButton(true);
  };

  const handleCloseFloatingButton = () => {
    setShowFloatingButton(false);
    setSelectedAmount(null);
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className={`max-w-4xl max-h-[90vh] overflow-y-auto ${theme === 'fluent' ? 'fluent-card bg-card shadow-xl border-0' : 'bg-card border-border'}`}>
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-3 text-xl font-semibold text-card-foreground">
            <img 
              src={iconImage} 
              alt="InvistaPRO Logo" 
              className="w-12 h-12 rounded-lg shadow-sm relative z-0"
            />
            <div className="flex flex-col relative z-10">
              <span className="text-xl font-semibold">Fazer Depósito - InvistaPRO</span>
              <span className="text-xs font-medium text-muted-foreground tracking-wide opacity-75">Invista com Risco Zero</span>
            </div>
          </DialogTitle>
        </DialogHeader>
        
        {!pixData ? (
          <div className="space-y-6 pb-32 md:pb-8">
            <div className="space-y-4">
              <Label className="text-lg font-semibold">Selecione o Valor do Depósito</Label>
              
              {amountsData?.amounts && (
                <div className={`grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 ${theme === 'fluent' ? 'fluent-grid gap-2' : 'gap-3'} max-h-96 overflow-y-auto`}>
                  {amountsData.amounts.map((amount: number) => (
                    <Button
                      key={amount}
                      variant={selectedAmount === amount ? "default" : "outline"}
                      onClick={() => handleAmountSelect(amount)}
                      className={`p-4 h-auto flex flex-col ${
                        selectedAmount === amount 
                          ? theme === 'fluent' ? "fluent-elevated bg-primary text-primary-foreground border-0" : "bg-accent text-foreground border-border"
                          : theme === 'fluent' ? "fluent-card hover:fluent-elevated border-border" : "hover:bg-muted border-border"
                      }`}
                      data-testid={`deposit-amount-${amount}`}
                    >
                      <span className="text-lg font-semibold">
                        R$ {amount.toLocaleString('pt-BR')}
                      </span>
                      {amount === 130 && (
                        <span className="text-xs opacity-80">Valor inicial</span>
                      )}
                      {amount >= 10000 && (
                        <span className="text-xs opacity-80">Alto rendimento</span>
                      )}
                    </Button>
                  ))}
                </div>
              )}
              
              <p className="text-sm text-muted-foreground text-center">
                Valores exponenciais para máxima rentabilidade
              </p>
              
              {selectedAmount && !showFloatingButton && (
                <div className="bg-accent/20 rounded-lg p-4 text-center border border-border">
                  <p className="text-lg font-bold text-foreground">
                    Valor selecionado: R$ {selectedAmount.toLocaleString('pt-BR')}
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">
                    Rendimento mensal até 130% dos melhores bancos
                  </p>
                </div>
              )}
            </div>
            
            {/* Botão inline para desktop - sempre visível quando valor selecionado */}
            {selectedAmount && (
              <div className="hidden md:block">
                <Button
                  onClick={handleGeneratePix}
                  disabled={generatePixMutation.isPending}
                  className="w-full bg-foreground hover:bg-foreground/90 text-background py-6 text-xl font-bold rounded-xl shadow-lg"
                  size="lg"
                  data-testid="button-generate-pix-desktop"
                >
                  {generatePixMutation.isPending ? "Gerando PIX..." : "DEPOSITAR AGORA"}
                </Button>
              </div>
            )}

            {/* Botão flutuante que aparece quando um valor é selecionado - mobile */}
            {showFloatingButton && (
              <>
                {/* Overlay para fechar clicando fora */}
                <div 
                  className="fixed inset-0 bg-black/20 z-40 md:hidden"
                  onClick={handleCloseFloatingButton}
                />
                
                {/* Botão flutuante - apenas mobile */}
                <div className="fixed bottom-16 left-1/2 transform -translate-x-1/2 z-50 flex items-center space-x-3 md:hidden">
                  <Button
                    onClick={handleGeneratePix}
                    disabled={generatePixMutation.isPending}
                    className="bg-foreground hover:bg-foreground/90 text-background px-12 py-6 text-xl font-bold rounded-full shadow-2xl border-2 border-accent"
                    size="lg"
                    data-testid="button-generate-pix-floating"
                  >
                    {generatePixMutation.isPending ? "Gerando PIX..." : "DEPOSITAR"}
                  </Button>
                  
                  <Button
                    onClick={handleCloseFloatingButton}
                    variant="outline"
                    size="lg"
                    className="rounded-full w-14 h-14 p-0 bg-card border-border shadow-lg"
                    data-testid="button-close-floating"
                  >
                    <X className="h-6 w-6" />
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* QR Code Display */}
            <div className="text-center">
              <div className="w-48 h-48 mx-auto mb-4 bg-background border-2 border-border rounded-xl flex items-center justify-center">
                <img 
                  src={pixData.qrCode} 
                  alt="QR Code PIX" 
                  className="w-40 h-40"
                />
              </div>
              <p className="text-sm text-muted-foreground mb-4">
                Escaneie o QR Code ou use o PIX Copia e Cola
              </p>
            </div>
            
            {/* Company Info */}
            <div className="bg-accent/20 rounded-lg p-4 mb-4 border border-border">
              <div className="flex items-center space-x-2 mb-2">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span className="text-sm font-medium text-card-foreground">Dados do PIX</span>
              </div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <p><strong>Favorecido:</strong> {pixData.empresa || "Victor Felipe Diogo"}</p>
                <p><strong>Chave PIX:</strong> {pixData.chavePix || "05f6ace9-d21c-43f2-8fb9-40e7da3009a8"}</p>
                <p><strong>Valor:</strong> R$ {pixData.valor}</p>
                <p><strong>Descrição:</strong> {pixData.observacao || "Depósito InvistaPRO"}</p>
              </div>
            </div>

            {/* PIX Code */}
            <div className="bg-muted rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">PIX Copia e Cola:</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyPix}
                  className="text-foreground hover:text-foreground/80"
                >
                  <Copy className="h-4 w-4 mr-1" />
                  Copiar
                </Button>
              </div>
              <div className="p-2 bg-background rounded border border-border text-xs font-mono text-foreground break-all">
                {pixData.pixString}
              </div>
            </div>
            
            <div className="flex space-x-3">
              <Button
                variant="outline"
                onClick={handleNewDeposit}
                className="flex-1"
              >
                Novo Depósito
              </Button>
              <Button
                onClick={() => confirmDepositMutation.mutate()}
                disabled={confirmDepositMutation.isPending}
                className="flex-1 bg-foreground hover:bg-foreground/90 text-background"
              >
                {confirmDepositMutation.isPending ? "Confirmando..." : "Simular Pagamento"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
