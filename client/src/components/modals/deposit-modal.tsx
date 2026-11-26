import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CreditCard } from "lucide-react";

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DepositModal({ isOpen, onClose }: DepositModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Depósitos
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div className="space-y-2">
                <h3 className="font-semibold">Depósitos temporariamente indisponíveis</h3>
                <p className="text-sm text-muted-foreground">
                  A integração com o provedor de pagamento ainda não está configurada. A plataforma não consegue gerar um PIX válido nem confirmar um depósito neste momento.
                </p>
                <p className="text-sm font-medium text-foreground">
                  Não transfira dinheiro para chaves PIX exibidas fora de um fluxo de pagamento confirmado dentro da plataforma.
                </p>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            O saldo só poderá ser creditado após confirmação verificável do provedor e conciliação no histórico da conta. Não há depósito mínimo, prazo ou rendimento contratado informado por esta tela.
          </p>
          <Button variant="outline" className="w-full" onClick={onClose}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
