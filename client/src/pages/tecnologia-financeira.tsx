import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocation } from "wouter";
import { ArrowLeft, Brain, TrendingUp, Shield, Cpu, BarChart3, Globe, Zap } from "lucide-react";
import { Footer } from "@/components/ui/footer";

export default function TecnologiaFinanceira() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
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
              <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center">
                <Brain className="text-white h-6 w-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">Tecnologia Financeira</h1>
                <p className="text-muted-foreground">Nossa arquitetura de liquidez inteligente</p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="space-y-8">
            <Card className="shadow-lg">
              <CardHeader className="bg-gradient-to-r from-indigo-500/10 to-purple-400/5">
                <CardTitle className="flex items-center gap-2">
                  <Cpu className="h-5 w-5 text-indigo-600" />
                  Pool de Liquidez Inteligente
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="space-y-6">
                  <p className="text-muted-foreground leading-relaxed">
                    A InvistaPRO utiliza uma <strong>arquitetura financeira proprietária</strong> que consolida 
                    todos os recursos dos investidores em um <strong>pool unificado de alta liquidez</strong>. 
                    Este sistema permite otimização máxima de rendimentos através de alocação dinâmica em 
                    <strong> produtos financeiros de baixo risco e alta performance</strong>.
                  </p>
                  
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-6">
                    <h3 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
                      <TrendingUp className="h-5 w-5" />
                      Como Alcançamos 130% Superior ao Mercado
                    </h3>
                    <div className="space-y-3 text-sm text-blue-800">
                      <p>• <strong>Concentração de Capital:</strong> Pools maiores obtêm melhores condições em produtos premium</p>
                      <p>• <strong>Negociação Institucional:</strong> Acesso a taxas exclusivas normalmente indisponíveis para pessoas físicas</p>
                      <p>• <strong>Diversificação Automática:</strong> Distribuição inteligente entre múltiplos instrumentos financeiros</p>
                      <p>• <strong>Rebalanceamento Contínuo:</strong> Algoritmos ajustam posições em tempo real para máxima eficiência</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg">
              <CardHeader className="bg-gradient-to-r from-green-500/10 to-emerald-400/5">
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-green-600" />
                  Estrutura de Rentabilidade
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="grid md:grid-cols-2 gap-8">
                  <div>
                    <h3 className="font-semibold text-foreground mb-4">Fonte dos Rendimentos</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                        <span className="text-sm font-medium">Produtos Bancários Premium</span>
                        <span className="text-sm font-bold text-green-600">45%</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                        <span className="text-sm font-medium">Instrumentos de Renda Fixa</span>
                        <span className="text-sm font-bold text-blue-600">35%</span>
                      </div>
                      <div className="flex justify-between items-center p-3 bg-purple-50 rounded-lg">
                        <span className="text-sm font-medium">Arbitragem de Liquidez</span>
                        <span className="text-sm font-bold text-purple-600">20%</span>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <h3 className="font-semibold text-foreground mb-4">Performance vs Mercado</h3>
                    <div className="space-y-4">
                      <div className="bg-gray-50 rounded-lg p-4">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-sm text-muted-foreground">Poupança Tradicional</span>
                          <span className="text-lg font-bold text-gray-600">6,2%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-2">
                          <div className="bg-gray-600 h-2 rounded-full" style={{ width: '47%' }}></div>
                        </div>
                      </div>
                      
                      <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4">
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-sm font-medium text-green-700">InvistaPRO Pool</span>
                          <span className="text-lg font-bold text-green-600">10,63%</span>
                        </div>
                        <div className="w-full bg-green-200 rounded-full h-2">
                          <div className="bg-green-600 h-2 rounded-full" style={{ width: '100%' }}></div>
                        </div>
                        <p className="text-xs text-green-600 mt-2 font-medium">+71% superior à poupança</p>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg">
              <CardHeader className="bg-gradient-to-r from-purple-500/10 to-violet-400/5">
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-purple-600" />
                  Segurança e Compliance
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="grid md:grid-cols-3 gap-6">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Shield className="h-8 w-8 text-purple-600" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-2">Instituições Regulamentadas</h3>
                    <p className="text-sm text-muted-foreground">
                      Todas as operações são realizadas através de instituições financeiras licenciadas e supervisionadas pelo BACEN
                    </p>
                  </div>
                  
                  <div className="text-center">
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Globe className="h-8 w-8 text-green-600" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-2">Diversificação Geográfica</h3>
                    <p className="text-sm text-muted-foreground">
                      Pool distribuído entre múltiplas jurisdições para redução de risco sistêmico
                    </p>
                  </div>
                  
                  <div className="text-center">
                    <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Zap className="h-8 w-8 text-blue-600" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-2">Liquidez Garantida</h3>
                    <p className="text-sm text-muted-foreground">
                      Sistema de reservas permite saques imediatos independente do volume
                    </p>
                  </div>
                </div>
                
                <div className="mt-8 bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <p className="text-sm text-amber-800">
                    <strong>Transparência:</strong> Nosso modelo de negócio baseia-se em spread de otimização. 
                    Ganhamos uma pequena margem da diferença entre rendimentos obtidos institucionalmente 
                    e os rendimentos distribuídos aos investidores, mantendo 130% superior ao mercado retail.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}