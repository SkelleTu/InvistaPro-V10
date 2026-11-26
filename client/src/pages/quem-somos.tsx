import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { ArrowLeft, Building2, Code2, Target, Users } from "lucide-react";
import { useLocation } from "wouter";

export default function QuemSomos() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={() => setLocation("/")} className="shrink-0" data-testid="button-voltar"><ArrowLeft className="w-4 h-4 mr-2" />Voltar</Button>
            <div className="flex items-center gap-3"><div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center"><Building2 className="h-6 w-6 text-primary" /></div><div><h1 className="text-3xl font-bold text-foreground">Sobre a Invista PRO</h1><p className="text-muted-foreground">Tecnologia para acompanhamento e negociação</p></div></div>
          </div>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><Target className="h-5 w-5 text-primary" />Propósito da plataforma</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-3"><p>A Invista PRO é uma plataforma de software que reúne recursos de acompanhamento de conta, simulação, análise de mercado e integração com serviços externos de negociação.</p><p>As funcionalidades dependem da disponibilidade e configuração de cada integração. A plataforma não promete rentabilidade nem elimina os riscos das operações.</p></CardContent></Card>
          <div className="grid md:grid-cols-2 gap-6">
            <Card><CardContent className="p-6 space-y-3"><Code2 className="h-7 w-7 text-primary" /><h2 className="font-semibold">Desenvolvimento tecnológico</h2><p className="text-sm text-muted-foreground">O produto é desenvolvido e aprimorado continuamente, com foco em integração, observabilidade e clareza operacional.</p></CardContent></Card>
            <Card><CardContent className="p-6 space-y-3"><Users className="h-7 w-7 text-primary" /><h2 className="font-semibold">Uso responsável</h2><p className="text-sm text-muted-foreground">O usuário deve verificar as condições de cada serviço, testar no ambiente DEMO quando disponível e compreender os riscos antes de utilizar o ambiente REAL.</p></CardContent></Card>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
