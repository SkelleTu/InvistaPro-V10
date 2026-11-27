import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import { ArrowLeft, Brain, TrendingUp, Shield, Cpu, BarChart3, Globe, Zap, AlertTriangle } from "lucide-react";
import { Footer } from "@/components/ui/footer";

export default function TecnologiaFinanceira() {
  const [, setLocation] = useLocation();
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-8 space-y-8">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => setLocation("/")}>
            <ArrowLeft className="w-4 h-4 mr-2" />Voltar
          </Button>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
              <Brain className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-foreground">Tecnologia da plataforma</h1>
              <p className="text-muted-foreground">Recursos de software, análise e integração</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="h-5 w-5 text-primary" />Arquitetura de software</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>A Invista PRO reúne painel de conta, simulações, ferramentas de análise, configurações de automação e integrações opcionais com serviços externos. Cada módulo depende de permissões, credenciais e disponibilidade técnica próprias.</p>
            <p>A plataforma não anuncia pool de liquidez, negociação institucional, alocação coletiva de recursos ou acesso a taxas exclusivas sem documentação verificável desses serviços.</p>
          </CardContent>
        </Card>

        <div className="grid md:grid-cols-2 gap-6">
          <Card>
            <CardContent className="p-6 space-y-3">
              <BarChart3 className="h-7 w-7 text-primary" />
              <h2 className="font-semibold text-foreground">Painel e indicadores</h2>
              <p className="text-sm text-muted-foreground">Apresenta saldo registrado, movimentações e indicadores disponíveis. Estimativas matemáticas são identificadas como estimativas; não substituem histórico conciliado.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 space-y-3">
              <TrendingUp className="h-7 w-7 text-primary" />
              <h2 className="font-semibold text-foreground">Simulador</h2>
              <p className="text-sm text-muted-foreground">Calcula cenários com parâmetros informados. A taxa ilustrativa utilizada no simulador não é rendimento contratado, taxa de mercado nem promessa de retorno.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 space-y-3">
              <Globe className="h-7 w-7 text-primary" />
              <h2 className="font-semibold text-foreground">Integrações externas</h2>
              <p className="text-sm text-muted-foreground">A conexão com Deriv e MetaTrader depende de tokens válidos, permissões, configuração do terminal e validações de segurança. A presença do módulo não significa conexão ativa.</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 space-y-3">
              <Zap className="h-7 w-7 text-primary" />
              <h2 className="font-semibold text-foreground">Automação e controles</h2>
              <p className="text-sm text-muted-foreground">Controles de pausa, seleção de modalidades, limites e bloqueios auxiliam a configuração. Nenhum controle elimina o risco de mercado ou garante resultado positivo.</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-primary" />Segurança operacional</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>Credenciais de integração devem ser enviadas somente pelos campos protegidos da aplicação. O sistema aplica autenticação, autorização e validações no servidor, mas isso não representa risco zero nem certificação independente.</p>
            <p>Integrações ausentes ou com falha devem permanecer bloqueadas. Antes de usar qualquer ambiente REAL, verifique a conta externa, as permissões e os parâmetros de execução.</p>
          </CardContent>
        </Card>

        <Card className="border-amber-500/30">
          <CardHeader><CardTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" />Risco e disponibilidade</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>Negociação de ativos e contratos financeiros pode gerar perdas, inclusive do capital utilizado. Não há garantia de rentabilidade, liquidez, disponibilidade ininterrupta ou proteção integral do capital. Consulte também os termos dos provedores externos.</p>
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
}
