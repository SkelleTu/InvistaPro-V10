import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { ArrowLeft, FileText, AlertTriangle, ShieldAlert } from "lucide-react";
import { useLocation } from "wouter";

export default function TermosUso() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={() => setLocation("/")}><ArrowLeft className="w-4 h-4 mr-2" />Voltar</Button>
            <div><h1 className="text-3xl font-bold">Termos de Uso</h1><p className="text-muted-foreground">Condições informativas de utilização da plataforma</p></div>
          </div>
          <Card className="border-amber-500/40">
            <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" />Documento provisório</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>Este conteúdo é informativo e não substitui termos contratuais revisados por profissional jurídico. A identificação formal do controlador/operador, os dados empresariais e as condições definitivas de prestação do serviço precisam ser confirmados antes de este texto ser usado como instrumento contratual.</p>
              <p>Última atualização: {new Date().toLocaleDateString("pt-BR")}</p>
            </CardContent>
          </Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" />1. Escopo da plataforma</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2">
            <p>A Invista PRO é uma aplicação de software que reúne painel de conta, simulações, ferramentas de análise e integrações opcionais com serviços externos, incluindo Deriv e MetaTrader.</p>
            <p>A disponibilidade de cada recurso depende da configuração técnica, das permissões da conta e da disponibilidade do respectivo provedor. A exibição de um botão ou módulo não significa que o serviço esteja habilitado.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>2. Conta e credenciais</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2">
            <p>O usuário deve manter suas credenciais em sigilo, fornecer informações corretas e utilizar somente integrações e contas que esteja autorizado a acessar. Tokens de provedores externos devem ser inseridos exclusivamente nos campos oficiais da aplicação.</p>
            <p>O acesso a áreas protegidas pode depender de validação de identidade, aprovação da conta e permissões administrativas.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>3. Simulações e informações financeiras</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2">
            <p>O simulador aplica uma taxa matemática fixa de 0,835% ao mês aos valores informados. Essa taxa é apenas um parâmetro ilustrativo do cálculo; não é taxa contratada, benchmark bancário, oferta de investimento, rendimento efetivo ou promessa de retorno.</p>
            <p>Saldo, rendimento e histórico somente devem ser considerados efetivos quando estiverem registrados e conciliados. Simulações não movimentam dinheiro e não comprovam rentabilidade.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-amber-500" />4. Negociação e riscos</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2">
            <p>As integrações de negociação podem permitir operações em ambiente DEMO ou REAL, conforme token válido, permissões, configuração e confirmação do provedor externo. O ambiente REAL envolve risco de perda financeira, inclusive do capital utilizado.</p>
            <p>Não existe garantia de lucro, taxa de acerto, disponibilidade ininterrupta ou proteção contra perdas. O usuário deve compreender as regras e os riscos do provedor antes de operar.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>5. Depósitos, saques e movimentações</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Uma solicitação exibida na interface não representa transferência concluída. Depósitos e saques dependem de integração de pagamento ativa, confirmação do provedor e conciliação financeira no histórico da conta.</p>
            <p>Enquanto esses requisitos não forem confirmados, a plataforma não deve indicar a movimentação como concluída nem criar expectativa de prazo ou disponibilidade de saldo.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>6. Serviços de terceiros e disponibilidade</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Serviços externos estão sujeitos aos próprios termos, políticas, limites e períodos de indisponibilidade. A plataforma pode sofrer manutenção, falhas de integração ou interrupções.</p>
            <p>Este documento não define tarifas, prazos de saque, carência de capital, depósito mínimo ou obrigações regulatórias que não tenham sido formalmente confirmadas.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>7. Privacidade e contato</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2">
            <p>O tratamento de dados é descrito no Aviso de Privacidade. Para dúvidas ou solicitações, utilize os canais de suporte publicados na plataforma.</p>
            <p>Antes da publicação como contrato definitivo, este documento deve ser completado com a identificação legal da entidade responsável, endereço, canais oficiais e revisão jurídica.</p>
          </CardContent></Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
