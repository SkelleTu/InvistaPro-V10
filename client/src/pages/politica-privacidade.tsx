import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { ArrowLeft, Shield, Eye, Lock, AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";

export default function PoliticaPrivacidade() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={() => setLocation("/")}><ArrowLeft className="w-4 h-4 mr-2" />Voltar</Button>
            <div><h1 className="text-3xl font-bold">Aviso de Privacidade</h1><p className="text-muted-foreground">Informações sobre dados tratados pela aplicação</p></div>
          </div>
          <Card className="border-amber-500/40"><CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" />Identificação do responsável</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">
            <p>Esta página descreve categorias de dados e operações observadas na aplicação. A identificação jurídica completa do controlador, seu endereço e o contato formal do encarregado ainda precisam ser confirmados e publicados. Este aviso deve passar por revisão jurídica e de privacidade antes de ser considerado completo.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><Eye className="h-5 w-5 text-primary" />1. Categorias de dados</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-3">
            <p>Conforme os recursos utilizados, a aplicação pode tratar:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Dados de conta e contato, como nome, e-mail e telefone</li>
              <li>Dados de perfil e identificação informados pelo usuário, como CPF e endereço</li>
              <li>Documentos enviados para processos de validação, quando esse recurso for utilizado</li>
              <li>Dados de sessão, registros técnicos, eventos de segurança e informações do navegador</li>
              <li>Configurações, simulações, operações e movimentações registradas na conta</li>
              <li>Credenciais ou tokens de serviços externos de negociação, quando configurados</li>
            </ul>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>2. Finalidades do tratamento</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Os dados podem ser utilizados para criar e manter contas, autenticar sessões, aplicar controles de acesso, validar informações submetidas, apresentar dados da conta, executar simulações solicitadas, registrar operações e diagnosticar falhas ou incidentes.</p>
            <p>Recursos de negociação e serviços externos somente devem utilizar credenciais quando o usuário os configurar e autorizar.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>3. Armazenamento, segurança e fornecedores</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2">
            <p>A aplicação utiliza infraestrutura de hospedagem, bancos de dados e serviços de terceiros para executar suas funções. Dados podem ser processados por esses fornecedores conforme a funcionalidade utilizada e a configuração vigente.</p>
            <p>Tokens de integração são tratados no servidor e a aplicação possui mecanismos de sessão, controle de acesso e criptografia de credenciais. Isso não elimina todos os riscos nem constitui certificação independente de segurança.</p>
            <p>A lista completa de fornecedores, locais de processamento, prazos de retenção e contratos de tratamento deve ser confirmada pelo responsável antes da publicação definitiva deste aviso.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>4. Compartilhamento</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2">
            <p>O compartilhamento pode ocorrer com fornecedores técnicos necessários à hospedagem, armazenamento, comunicação e integração com serviços externos, bem como para cumprir obrigações legais ou responder a solicitações válidas de autoridades.</p>
            <p>Esta página não afirma que não existe compartilhamento nem substitui a identificação dos fornecedores e das finalidades específicas.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>5. Retenção e descarte</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">
            <p>Os períodos de retenção variam conforme o tipo de dado, a finalidade, a necessidade operacional e as obrigações legais aplicáveis. Uma tabela completa de retenção e descarte ainda precisa ser formalmente definida e publicada pelo controlador.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><Lock className="h-5 w-5 text-primary" />6. Direitos do titular</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Nos termos da LGPD, o titular pode solicitar confirmação de tratamento, acesso, correção, informações sobre compartilhamento e, quando cabível, anonimização, bloqueio, eliminação, portabilidade ou revogação do consentimento.</p>
            <p>O canal oficial para solicitações de titulares ainda precisa ser formalmente publicado pelo controlador. A identidade do solicitante deverá ser confirmada para proteger os dados, e o atendimento observará os requisitos e prazos legais aplicáveis.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>7. Atualizações deste aviso</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">
            <p>Este aviso deve ser atualizado quando houver mudanças nos dados tratados, finalidades, fornecedores, prazos de retenção ou canais do controlador. Última atualização: {new Date().toLocaleDateString("pt-BR")}.</p>
          </CardContent></Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
