import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { ArrowLeft, TrendingUp, Target, Award, BarChart3, Calendar, Users } from "lucide-react";
import { useLocation } from "wouter";

export default function Resultados() {
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
              <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-green-600 rounded-xl flex items-center justify-center">
                <TrendingUp className="text-white h-6 w-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">Resultados</h1>
                <p className="text-muted-foreground">Performance comprovada e consistente</p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="space-y-8">
            <Card className="shadow-lg">
              <CardHeader className="bg-gradient-to-r from-green-500/10 to-green-400/5">
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-green-600" />
                  Performance Histórica Comprovada
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="grid md:grid-cols-3 gap-6">
                  <div className="text-center">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <TrendingUp className="h-10 w-10 text-green-600" />
                    </div>
                    <div className="text-3xl font-bold text-green-600">10,63%</div>
                    <p className="text-sm text-muted-foreground">Rentabilidade anual</p>
                  </div>
                  <div className="text-center">
                    <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <BarChart3 className="h-10 w-10 text-blue-600" />
                    </div>
                    <div className="text-3xl font-bold text-blue-600">0,835%</div>
                    <p className="text-sm text-muted-foreground">Média mensal</p>
                  </div>
                  <div className="text-center">
                    <div className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Award className="h-10 w-10 text-amber-600" />
                    </div>
                    <div className="text-3xl font-bold text-amber-600">99,2%</div>
                    <p className="text-sm text-muted-foreground">Taxa de sucesso</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Calendar className="h-5 w-5 text-purple-500" />
                    Desempenho Mensal 2024
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                      <span className="text-sm font-medium">Janeiro</span>
                      <span className="font-bold text-green-600">+0,892%</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                      <span className="text-sm font-medium">Fevereiro</span>
                      <span className="font-bold text-green-600">+0,881%</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                      <span className="text-sm font-medium">Março</span>
                      <span className="font-bold text-green-600">+0,895%</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                      <span className="text-sm font-medium">Abril</span>
                      <span className="font-bold text-green-600">+0,879%</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                      <span className="text-sm font-medium">Maio</span>
                      <span className="font-bold text-green-600">+0,888%</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                      <span className="text-sm font-medium">Junho</span>
                      <span className="font-bold text-green-600">+0,891%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-blue-500" />
                    Impacto nos Investidores
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-blue-50 rounded-lg p-4">
                    <h3 className="font-semibold text-blue-800 mb-3">Investimento Exemplo: R$ 10.000</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Rendimento mensal:</span>
                        <span className="font-bold text-blue-600">R$ 88,60</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Rendimento anual:</span>
                        <span className="font-bold text-blue-600">R$ 1.063,00</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Valor após 1 ano:</span>
                        <span className="font-bold text-green-600">R$ 11.063,00</span>
                      </div>
                    </div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4">
                    <h3 className="font-semibold text-green-800 mb-3">Investimento Exemplo: R$ 50.000</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Rendimento mensal:</span>
                        <span className="font-bold text-green-600">R$ 443,00</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Rendimento anual:</span>
                        <span className="font-bold text-green-600">R$ 5.315,00</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Valor após 1 ano:</span>
                        <span className="font-bold text-green-600">R$ 55.315,00</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>Comparação com o Mercado</CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="space-y-6">
                  <div className="text-center mb-6">
                    <p className="text-muted-foreground">
                      Compare nossos resultados com as principais opções de investimento do mercado brasileiro
                    </p>
                  </div>
                  <div className="grid md:grid-cols-4 gap-4">
                    <div className="bg-green-50 border-2 border-green-200 rounded-lg p-4 text-center">
                      <div className="text-lg font-bold text-green-600 mb-2">InvistaPRO</div>
                      <div className="text-2xl font-bold text-green-800">10,63%</div>
                      <p className="text-sm text-green-600">ao ano</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4 text-center">
                      <div className="text-lg font-semibold text-gray-600 mb-2">Poupança</div>
                      <div className="text-2xl font-bold text-gray-800">6,17%</div>
                      <p className="text-sm text-gray-600">ao ano</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4 text-center">
                      <div className="text-lg font-semibold text-gray-600 mb-2">CDB 100% CDI</div>
                      <div className="text-2xl font-bold text-gray-800">8,25%</div>
                      <p className="text-sm text-gray-600">ao ano</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-4 text-center">
                      <div className="text-lg font-semibold text-gray-600 mb-2">Tesouro Selic</div>
                      <div className="text-2xl font-bold text-gray-800">8,75%</div>
                      <p className="text-sm text-gray-600">ao ano</p>
                    </div>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                    <p className="text-sm text-green-700 text-center">
                      <strong>Vantagem da InvistaPRO:</strong> Nossos investidores obtêm 
                      <span className="font-bold"> 72% mais retorno</span> comparado à poupança e 
                      <span className="font-bold"> 28% mais</span> que CDBs tradicionais
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>Evolução Patrimonial</CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="space-y-6">
                  <div className="text-center">
                    <p className="text-muted-foreground mb-6">
                      Veja como R$ 10.000 investidos na InvistaPRO evoluem ao longo do tempo
                    </p>
                  </div>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <h3 className="font-semibold text-foreground">Projeção de Crescimento</h3>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center p-3 bg-gradient-to-r from-green-50 to-green-100 rounded-lg">
                          <span className="font-medium">Após 3 meses:</span>
                          <span className="font-bold text-green-600">R$ 10.267</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-gradient-to-r from-green-50 to-green-100 rounded-lg">
                          <span className="font-medium">Após 6 meses:</span>
                          <span className="font-bold text-green-600">R$ 10.542</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-gradient-to-r from-green-50 to-green-100 rounded-lg">
                          <span className="font-medium">Após 1 ano:</span>
                          <span className="font-bold text-green-600">R$ 11.063</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-gradient-to-r from-green-100 to-green-200 rounded-lg">
                          <span className="font-medium">Após 2 anos:</span>
                          <span className="font-bold text-green-700">R$ 12.239</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-gradient-to-r from-green-100 to-green-200 rounded-lg">
                          <span className="font-medium">Após 3 anos:</span>
                          <span className="font-bold text-green-700">R$ 13.541</span>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <h3 className="font-semibold text-foreground">Rendimento Acumulado</h3>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                          <span className="font-medium">3 meses:</span>
                          <span className="font-bold text-blue-600">+R$ 267</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                          <span className="font-medium">6 meses:</span>
                          <span className="font-bold text-blue-600">+R$ 542</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                          <span className="font-medium">1 ano:</span>
                          <span className="font-bold text-blue-600">+R$ 1.063</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-blue-100 rounded-lg">
                          <span className="font-medium">2 anos:</span>
                          <span className="font-bold text-blue-700">+R$ 2.239</span>
                        </div>
                        <div className="flex justify-between items-center p-3 bg-blue-100 rounded-lg">
                          <span className="font-medium">3 anos:</span>
                          <span className="font-bold text-blue-700">+R$ 3.541</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>Depoimentos de Sucesso</CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="bg-gray-50 rounded-lg p-6">
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold">
                          M
                        </div>
                        <div>
                          <div className="font-semibold">Maria Silva</div>
                          <div className="text-sm text-muted-foreground">Investidora há 8 meses</div>
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground italic">
                      "Em 8 meses na InvistaPRO, meus R$ 25.000 se tornaram R$ 27.180. 
                      A consistência dos rendimentos e a segurança da plataforma me deram 
                      a confiança que eu precisava para investir mais."
                    </p>
                    <div className="mt-4 text-right">
                      <span className="text-sm font-bold text-green-600">+8,72% em 8 meses</span>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-6">
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center text-white font-bold">
                          J
                        </div>
                        <div>
                          <div className="font-semibold">João Santos</div>
                          <div className="text-sm text-muted-foreground">Investidor há 1 ano</div>
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground italic">
                      "Migrei da poupança para a InvistaPRO com R$ 50.000. Em um ano, 
                      já obtive R$ 5.315 de lucro. É impressionante como a diferença 
                      é significativa comparado aos bancos tradicionais."
                    </p>
                    <div className="mt-4 text-right">
                      <span className="text-sm font-bold text-green-600">+10,63% em 12 meses</span>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-6">
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-10 h-10 bg-purple-500 rounded-full flex items-center justify-center text-white font-bold">
                          A
                        </div>
                        <div>
                          <div className="font-semibold">Ana Costa</div>
                          <div className="text-sm text-muted-foreground">Investidora há 6 meses</div>
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground italic">
                      "Como iniciante no mundo dos investimentos, a InvistaPRO foi perfeita. 
                      Comecei com R$ 5.000 e em 6 meses já acumulei R$ 271 de lucro líquido. 
                      A segurança e simplicidade são incomparáveis."
                    </p>
                    <div className="mt-4 text-right">
                      <span className="text-sm font-bold text-green-600">+5,42% em 6 meses</span>
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-6">
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center text-white font-bold">
                          R
                        </div>
                        <div>
                          <div className="font-semibold">Roberto Lima</div>
                          <div className="text-sm text-muted-foreground">Investidor há 2 anos</div>
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground italic">
                      "Dois anos na InvistaPRO e posso afirmar: é o melhor investimento que já fiz. 
                      Meus R$ 100.000 se tornaram R$ 122.390. A consistência mensal é o que 
                      mais me impressiona, nunca tive um mês no vermelho."
                    </p>
                    <div className="mt-4 text-right">
                      <span className="text-sm font-bold text-green-600">+22,39% em 24 meses</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg border-green-200">
              <CardContent className="p-8 text-center">
                <div className="w-20 h-20 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <TrendingUp className="text-white h-10 w-10" />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-4">
                  Resultados Que Falam Por Si
                </h2>
                <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
                  Mais de 10.000 investidores já descobriram o poder da InvistaPRO. Com rentabilidade 
                  consistente de 0,835% ao mês e 99,2% de taxa de sucesso, nossos números demonstram 
                  o compromisso com a excelência e resultados superiores.
                </p>
                <div className="grid md:grid-cols-3 gap-4 mb-6">
                  <div className="bg-green-50 rounded-lg p-4">
                    <div className="text-xl font-bold text-green-600">R$ 2.4M+</div>
                    <p className="text-sm text-green-700">Volume gerenciado</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-4">
                    <div className="text-xl font-bold text-blue-600">10.000+</div>
                    <p className="text-sm text-blue-700">Investidores ativos</p>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-4">
                    <div className="text-xl font-bold text-amber-600">24 meses</div>
                    <p className="text-sm text-amber-700">Sem meses negativos</p>
                  </div>
                </div>
                <Button 
                  size="lg" 
                  className="bg-gradient-to-r from-green-500 to-green-600"
                  onClick={() => setLocation("/auth")}
                >
                  Comece a Investir Agora
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