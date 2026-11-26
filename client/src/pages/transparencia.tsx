import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { ArrowLeft, Eye, FileText, BarChart3, AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";

export default function Transparencia() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={() => setLocation("/")} className="shrink-0" data-testid="button-voltar"><ArrowLeft className="w-4 h-4 mr-2" />Voltar</Button>
            <div className="flex items-center gap-3"><div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center"><Eye className="h-6 w-6 text-primary" /></div><div><h1 className="text-3xl font-bold text-foreground">Transparência</h1><p className="text-muted-foreground">Origem dos dados e limites das informações</p></div></div>
          </div>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-primary" />Indicadores e histórico</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-3"><p>Os indicadores do painel devem refletir registros da conta, movimentações confirmadas e operações concluídas. Quando não há dados suficientes, o painel deve informar essa ausência em vez de estimar resultados como se fossem realizados.</p><p>Não publicamos nesta página taxas de sucesso, volume gerenciado, índices de Sharpe ou séries históricas sem documentação verificável e metodologia definida.</p></CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" />Custos e integrações</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-3"><p>Taxas, limites, prazos e condições dependem dos termos vigentes e do provedor efetivamente integrado. Consulte as informações apresentadas no momento de cada operação antes de confirmar.</p><p>Uma funcionalidade visível na interface não significa que o provedor esteja configurado ou que a transação tenha sido concluída.</p></CardContent></Card>
          <Card className="border-amber-500/30"><CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" />Simulação não é resultado</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground"><p>Simulações são estimativas calculadas a partir de parâmetros informados. Não representam histórico real, promessa de rentabilidade ou garantia de recebimento.</p></CardContent></Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
