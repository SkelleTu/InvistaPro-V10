import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ShieldCheck } from "lucide-react";

interface Frenetico9TokensPanelProps {
  syncedDigitCount?: number;
  syncedStakeMode?: "ai" | "fixed" | "manual";
  syncedFixedStake?: number;
}

export default function Frenetico9TokensPanel(_props: Frenetico9TokensPanelProps) {
  return (
    <Card className="border-amber-500/30 bg-amber-500/5" data-testid="card-digitmatch-disabled">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Rajada multi-conta (DIGITMATCH)
            </CardTitle>
            <CardDescription>
              Módulo legado indisponível no ambiente de produção
            </CardDescription>
          </div>
          <Badge variant="outline" className="border-amber-500/40 text-amber-600">Desativado</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          A execução DIGITMATCH está bloqueada pela política de contratos da produção. O servidor rejeita as solicitações deste módulo antes de conectar contas ou enviar ordens.
        </p>
        <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-background/60 p-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
          <p>
            Não insira tokens nem tente iniciar rajadas nesta tela. As modalidades atualmente permitidas são ACCU e DIGITDIFF, sujeitas às suas próprias verificações e bloqueios.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
