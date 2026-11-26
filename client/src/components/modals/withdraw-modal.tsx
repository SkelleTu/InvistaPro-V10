import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { AlertTriangle, Banknote } from "lucide-react";

interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WithdrawModal({ isOpen, onClose }: WithdrawModalProps) {
  const { user } = useAuth();
  const balance = Number(user?.saldo ?? 0);
  const formattedBalance = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number.isFinite(balance) ? balance : 0
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5" />
            Saques
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-5">
          <div className="rounded-lg border bg-muted/40 p-4 text-center">
            <p className="text-sm text-muted-foreground">Saldo registrado na conta</p>
            <p className="mt-1 text-3xl font-bold">{formattedBalance}</p>
          </div>
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div className="space-y-2">
                <h3 className="font-semibold">Saques temporariamente indisponíveis</h3>
                <p className="text-sm text-muted-foreground">
                  A integração de transferência ainda não está configurada. Nenhum saque de rendimento ou saque total pode ser concluído ou confirmado pela plataforma neste momento.
                </p>
                <p className="text-sm text-muted-foreground">
                  O saldo exibido é um registro interno e não significa que exista transferência bancária disponível.
                </p>
              </div>
            </div>
          </div>
          <Button variant="outline" className="w-full" onClick={onClose}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
