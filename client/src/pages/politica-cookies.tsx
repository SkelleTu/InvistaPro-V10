import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { ArrowLeft, Cookie, AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";

export default function PoliticaCookies() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm" onClick={() => setLocation("/")}><ArrowLeft className="w-4 h-4 mr-2" />Voltar</Button>
            <div className="flex items-center gap-3"><Cookie className="h-8 w-8 text-primary" /><div><h1 className="text-3xl font-bold">Política de Cookies</h1><p className="text-muted-foreground">Cookies e armazenamento local</p></div></div>
          </div>
          <Card><CardHeader><CardTitle>1. Cookie de sessão observado</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2">
            <p>A aplicação utiliza o cookie <code>investpro.sid</code> para manter a sessão autenticada do usuário. Esse cookie é necessário para que o servidor reconheça a sessão entre requisições.</p>
            <p>O prazo e os atributos de expiração são definidos pela configuração do servidor e podem mudar. Não atribuímos aqui um período fixo sem uma configuração formal de retenção.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>2. Armazenamento local</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2">
            <p>Algumas preferências e configurações de interface ou módulos podem ser armazenadas no navegador, inclusive por mecanismos como Local Storage. Esses dados não são necessariamente cookies e podem permanecer no dispositivo até serem apagados pelo usuário ou pela aplicação.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>3. Finalidade</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground space-y-2">
            <p>O armazenamento local pode ser utilizado para autenticação, continuidade da sessão, preferências e funcionamento de recursos escolhidos pelo usuário.</p>
            <p>Esta página não declara a existência ou inexistência de cookies de terceiros, publicidade ou análise sem um inventário técnico completo desses recursos.</p>
          </CardContent></Card>
          <Card className="border-amber-500/40"><CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" />4. Inventário pendente</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">
            <p>O inventário completo de cookies, scripts de terceiros, duração, finalidade e mecanismo de consentimento precisa ser validado antes de este documento ser considerado definitivo.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>5. Controle pelo usuário</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">
            <p>O usuário pode consultar e apagar cookies e armazenamento local nas configurações do navegador. A remoção do cookie de sessão encerra ou invalida o acesso autenticado, podendo exigir novo login.</p>
          </CardContent></Card>
          <p className="text-xs text-muted-foreground">Última atualização: {new Date().toLocaleDateString("pt-BR")}.</p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
