import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { ArrowLeft, Scale, UserCheck, AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";

export default function LGPD() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={() => setLocation("/")}><ArrowLeft className="w-4 h-4 mr-2" />Voltar</Button>
            <div className="flex items-center gap-3"><Scale className="h-8 w-8 text-primary" /><div><h1 className="text-3xl font-bold">LGPD — Direitos do titular</h1><p className="text-muted-foreground">Informações gerais sobre a Lei nº 13.709/2018</p></div></div>
          </div>
          <Card className="border-amber-500/40"><CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" />Situação das informações institucionais</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">
            <p>Esta página explica direitos previstos na LGPD, mas não constitui certificação de conformidade. A identificação formal do controlador, o contato do encarregado, o inventário de tratamentos, os prazos de retenção e os procedimentos internos precisam ser confirmados e documentados antes de qualquer declaração de conformidade integral.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>1. Sobre a LGPD</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">
            <p>A Lei nº 13.709/2018 estabelece regras para o tratamento de dados pessoais por pessoas físicas e jurídicas, com direitos para os titulares e deveres para os agentes de tratamento.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><UserCheck className="h-5 w-5 text-primary" />2. Direitos do titular</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Conforme a lei e observadas as condições aplicáveis, o titular pode solicitar:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Confirmação da existência de tratamento e acesso aos dados</li>
              <li>Correção de dados incompletos, inexatos ou desatualizados</li>
              <li>Anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade</li>
              <li>Portabilidade, observadas as regras da autoridade nacional</li>
              <li>Informações sobre entidades com as quais houve compartilhamento</li>
              <li>Informações sobre a possibilidade de negar consentimento e suas consequências</li>
              <li>Revogação do consentimento, quando essa for a base legal utilizada</li>
            </ul>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>3. Como encaminhar uma solicitação</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Utilize os canais de suporte publicados na plataforma e descreva o direito que deseja exercer. Poderá ser solicitada confirmação de identidade para evitar divulgação indevida de dados pessoais.</p>
            <p>O atendimento e os prazos observarão a LGPD e a regulamentação aplicável. Esta página não promete prazo contratual adicional nem confirma a existência de encarregado formalmente designado.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>4. Autoridade Nacional de Proteção de Dados</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2">
            <p>A ANPD é a autoridade brasileira responsável por zelar pela proteção de dados pessoais e fiscalizar o cumprimento da LGPD.</p>
            <p><a className="text-primary underline" href="https://www.gov.br/anpd/" target="_blank" rel="noreferrer">Site oficial da ANPD</a></p>
          </CardContent></Card>
          <p className="text-xs text-muted-foreground">Conteúdo informativo. Última atualização: {new Date().toLocaleDateString("pt-BR")}.</p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
