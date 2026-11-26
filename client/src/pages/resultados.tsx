import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { ArrowLeft, BarChart3, Info, ShieldAlert } from "lucide-react";
import { useLocation } from "wouter";

export default function Resultados() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={() => setLocation("/")} className="shrink-0" data-testid="button-voltar">
              <ArrowLeft className="w-4 h-4 mr-2" />Voltar
            </Button>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center"><BarChart3 className="h-6 w-6 text-primary" /></div>
              <div><h1 className="text-3xl font-bold text-foreground">Resultados</h1><p className="text-muted-foreground">Histórico e indicadores verificáveis</p></div>
            </div>
          </div>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Info className="h-5 w-5 text-primary" />Histórico financeiro</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Não há, neste momento, uma série histórica auditada publicada nesta página. Por isso, não exibimos percentuais de rentabilidade, taxa de sucesso ou comparações com bancos sem uma fonte verificável.</p>
              <p>Os valores apresentados no painel da conta devem ser interpretados conforme sua origem: saldo registrado, movimentação confirmada ou simulação. Uma simulação não representa resultado obtido nem promessa de retorno.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-amber-500" />Risco e resultados</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Operações de renda variável podem gerar perdas, inclusive do capital utilizado. Rentabilidade passada não garante resultados futuros.</p>
              <p>Resultados reais só devem ser considerados quando houver operações concluídas, registros financeiros conciliados e documentação de suporte disponível.</p>
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
