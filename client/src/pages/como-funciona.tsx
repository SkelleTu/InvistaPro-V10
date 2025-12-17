import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { ArrowLeft, Cog, ArrowRight, CheckCircle, DollarSign, Calendar, Shield } from "lucide-react";
import { useLocation } from "wouter";

export default function ComoFunciona() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-background via-background/95 to-primary/5">
      <div className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-4 mb-8">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLocation("/")}
              className="shrink-0"
              data-testid="button-voltar"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Voltar
            </Button>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl flex items-center justify-center">
                <Cog className="text-white h-6 w-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">Como Funciona</h1>
                <p className="text-muted-foreground">Entenda o processo de investimento</p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="space-y-8">
            <Card className="shadow-lg">
              <CardHeader className="bg-gradient-to-r from-purple-500/10 to-purple-400/5">
                <CardTitle>Processo Simplificado de Investimento</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Em apenas alguns passos, você estará participando do nosso pool de liquidez inteligente com rentabilidade garantida
                </p>
              </CardHeader>
              <CardContent className="p-8">
                <div className="space-y-6">
                  {/* Step 1 */}
                  <div className="flex gap-6 items-start">
                    <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold shrink-0">
                      1
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-foreground mb-2">Cadastro e Verificação</h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        Crie sua conta fornecendo dados básicos e realize a verificação de identidade (KYC) 
                        enviando seus documentos pessoais através da plataforma.
                      </p>
                      <div className="bg-blue-50 rounded-lg p-3">
                        <p className="text-xs text-blue-700">
                          <strong>Documentos necessários:</strong> RG ou CNH, CPF, comprovante de residência
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="text-muted-foreground h-6 w-6 mt-3" />
                  </div>

                  {/* Step 2 */}
                  <div className="flex gap-6 items-start">
                    <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center text-white font-bold shrink-0">
                      2
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-foreground mb-2">Depósito Inicial</h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        Realize seu primeiro depósito via PIX com valor mínimo de R$ 130,00. 
                        O processo é instantâneo e totalmente seguro.
                      </p>
                      <div className="bg-green-50 rounded-lg p-3">
                        <p className="text-xs text-green-700">
                          <strong>PIX Instantâneo:</strong> Seu depósito é creditado imediatamente na conta
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="text-muted-foreground h-6 w-6 mt-3" />
                  </div>

                  {/* Step 3 */}
                  <div className="flex gap-6 items-start">
                    <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center text-white font-bold shrink-0">
                      3
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-foreground mb-2">Investimento Automático</h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        Nossos algoritmos automaticamente aplicam seu dinheiro nas melhores oportunidades 
                        do mercado, garantindo rentabilidade otimizada.
                      </p>
                      <div className="bg-purple-50 rounded-lg p-3">
                        <p className="text-xs text-purple-700">
                          <strong>Automação Inteligente:</strong> Sem necessidade de conhecimento técnico
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="text-muted-foreground h-6 w-6 mt-3" />
                  </div>

                  {/* Step 4 */}
                  <div className="flex gap-6 items-start">
                    <div className="w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center text-white font-bold shrink-0">
                      4
                    </div>
                    <div className="flex-1">
                      <h3 className="font-semibold text-foreground mb-2">Acompanhe seus Rendimentos</h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        Monitore em tempo real o crescimento do seu investimento através do dashboard 
                        personalizado com relatórios detalhados.
                      </p>
                      <div className="bg-amber-50 rounded-lg p-3">
                        <p className="text-xs text-amber-700">
                          <strong>Transparência Total:</strong> Veja exatamente como seu dinheiro está rendendo
                        </p>
                      </div>
                    </div>
                    <CheckCircle className="text-green-500 h-6 w-6 mt-3" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5 text-green-500" />
                    Rendimentos
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-green-50 rounded-lg p-4">
                    <div className="text-center">
                      <div className="text-3xl font-bold text-green-600 mb-1">0,835%</div>
                      <p className="text-sm text-green-700">Por mês</p>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>• Rendimento mensal fixo de 0,835%</p>
                    <p>• Aproximadamente 10,63% ao ano</p>
                    <p>• Rendimentos creditados mensalmente</p>
                    <p>• Possibilidade de saque mensal dos lucros</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-blue-500" />
                    Prazos e Regras
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <div className="flex justify-between">
                      <span>Capital bloqueado:</span>
                      <span className="font-semibold">95 dias</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Saque de lucros:</span>
                      <span className="font-semibold">Mensal</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Depósito mínimo:</span>
                      <span className="font-semibold">R$ 130,00</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Processamento saques:</span>
                      <span className="font-semibold">48h úteis</span>
                    </div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3">
                    <p className="text-xs text-blue-700">
                      <strong>Importante:</strong> Saques acima de R$ 300 requerem autenticação biométrica
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-amber-500" />
                  Sistema de Segurança Avançado
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="grid md:grid-cols-3 gap-6">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Shield className="h-8 w-8 text-red-600" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-2">Criptografia SSL</h3>
                    <p className="text-sm text-muted-foreground">
                      Todas as transações são protegidas com criptografia de nível bancário
                    </p>
                  </div>
                  <div className="text-center">
                    <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <CheckCircle className="h-8 w-8 text-blue-600" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-2">Biometria Avançada</h3>
                    <p className="text-sm text-muted-foreground">
                      Sistema proprietário "InvestPro-Secure-Auth" para máxima segurança
                    </p>
                  </div>
                  <div className="text-center">
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Cog className="h-8 w-8 text-green-600" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-2">Monitoramento 24/7</h3>
                    <p className="text-sm text-muted-foreground">
                      Sistemas de IA monitoram continuamente todas as operações
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>Algoritmo de Investimento</CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="space-y-6">
                  <p className="text-muted-foreground">
                    Nosso algoritmo proprietário utiliza inteligência artificial e análise quantitativa 
                    para identificar as melhores oportunidades de investimento em tempo real:
                  </p>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <h3 className="font-semibold text-foreground mb-3">Análise de Mercado</h3>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        <li>• Monitoramento de 500+ indicadores financeiros</li>
                        <li>• Análise técnica automatizada</li>
                        <li>• Acompanhamento de tendências globais</li>
                        <li>• Avaliação de risco em tempo real</li>
                      </ul>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-3">Otimização Automática</h3>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        <li>• Diversificação inteligente do portfólio</li>
                        <li>• Rebalanceamento automático</li>
                        <li>• Proteção contra volatilidade</li>
                        <li>• Maximização de retornos seguros</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg border-primary/20">
              <CardContent className="p-8 text-center">
                <h2 className="text-2xl font-bold text-foreground mb-4">
                  Pronto para Começar?
                </h2>
                <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
                  Junte-se aos milhares de investidores que já descobriram a maneira mais inteligente 
                  e segura de fazer o dinheiro crescer. Com apenas R$ 130, você pode começar sua 
                  jornada rumo à independência financeira.
                </p>
                <Button 
                  size="lg" 
                  className="bg-gradient-to-r from-primary to-primary/90"
                  onClick={() => setLocation("/auth")}
                >
                  Começar Agora
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      
      <Footer />
    </div>
  );
}