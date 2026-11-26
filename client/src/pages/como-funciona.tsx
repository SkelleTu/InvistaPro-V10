import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { ArrowLeft, UserRoundCheck, KeyRound, FlaskConical, ShieldAlert } from "lucide-react";
import { useLocation } from "wouter";

const steps = [
  { icon: UserRoundCheck, title: "1. Conta e validação", text: "Crie sua conta e conclua as etapas de validação solicitadas. O acesso a recursos protegidos depende da aprovação e das permissões da conta." },
  { icon: KeyRound, title: "2. Integração Deriv", text: "Para usar o módulo de negociação, configure um token Deriv válido e escolha a conta correspondente. O sistema valida o token antes de confirmar a conexão." },
  { icon: FlaskConical, title: "3. Teste em DEMO", text: "Comece pelo ambiente DEMO. Verifique conexão, dados de mercado, configurações e bloqueios antes de considerar qualquer operação." },
  { icon: ShieldAlert, title: "4. Ambiente REAL", text: "O ambiente REAL exige credenciais válidas e ativação explícita. Operações podem gerar perdas; não há rentabilidade garantida." },
];

export default function ComoFunciona() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={() => setLocation("/")} className="shrink-0" data-testid="button-voltar"><ArrowLeft className="w-4 h-4 mr-2" />Voltar</Button>
            <div><h1 className="text-3xl font-bold text-foreground">Como Funciona</h1><p className="text-muted-foreground">Etapas e condições de uso da plataforma</p></div>
          </div>
          <Card>
            <CardHeader><CardTitle>Fluxo de utilização</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              {steps.map(({icon: Icon,title,text}) => <div key={title} className="flex gap-4 items-start"><div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0"><Icon className="h-5 w-5 text-primary" /></div><div><h2 className="font-semibold text-foreground">{title}</h2><p className="text-sm text-muted-foreground mt-1">{text}</p></div></div>)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Simulações e movimentações</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>O simulador apresenta estimativas com base nos parâmetros informados. Ele não movimenta dinheiro, não cria depósitos e não comprova rentabilidade.</p>
              <p>Depósitos e saques só podem ser considerados concluídos após confirmação do provedor de pagamento e conciliação no histórico da conta. Se uma integração não estiver configurada, a operação permanecerá indisponível.</p>
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
