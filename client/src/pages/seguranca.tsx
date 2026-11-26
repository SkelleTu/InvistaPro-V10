import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { ArrowLeft, Shield, LockKeyhole, AlertTriangle, Eye } from "lucide-react";
import { useLocation } from "wouter";

export default function Seguranca() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-8">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={() => setLocation("/")} className="shrink-0" data-testid="button-voltar"><ArrowLeft className="w-4 h-4 mr-2" />Voltar</Button>
            <div className="flex items-center gap-3"><div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center"><Shield className="h-6 w-6 text-primary" /></div><div><h1 className="text-3xl font-bold text-foreground">Segurança</h1><p className="text-muted-foreground">Controles, limites e responsabilidades</p></div></div>
          </div>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><LockKeyhole className="h-5 w-5 text-primary" />Proteção da conta</CardTitle></CardHeader><CardContent className="space-y-3 text-sm text-muted-foreground"><p>A plataforma utiliza autenticação de sessão, verificações de autorização no servidor e armazenamento de segredos em variáveis de ambiente. Nenhuma chave privada de integração deve ser compartilhada ou inserida em páginas públicas.</p><p>Os controles de segurança são continuamente revisados. A presença de HTTPS ou de mecanismos de autenticação não significa risco zero nem substitui a proteção das credenciais do usuário.</p></CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2"><Eye className="h-5 w-5 text-primary" />Monitoramento e disponibilidade</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2"><p>Serviços, integrações e disponibilidade operacional são monitorados. Quando uma credencial, conexão ou validação obrigatória está ausente, a funcionalidade correspondente deve permanecer bloqueada.</p><p>Backups e indicadores de saúde são mecanismos de resiliência; não representam certificação independente nem garantia de disponibilidade ininterrupta.</p></CardContent></Card>
          <Card className="border-amber-500/30"><CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" />Risco de negociação</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2"><p>Operações em mercados financeiros podem causar perdas. Teste primeiro no ambiente DEMO e só utilize o ambiente REAL após compreender os riscos e confirmar as configurações.</p><p>Não existe proteção capaz de garantir lucro ou impedir todas as perdas.</p></CardContent></Card>
        </div>
      </main>
      <Footer />
    </div>
  );
}
