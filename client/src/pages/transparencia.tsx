import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { ArrowLeft, Eye, BarChart, FileText, TrendingUp, Calendar } from "lucide-react";
import { useLocation } from "wouter";

export default function Transparencia() {
  const [, setLocation] = useLocation();

  const currentMonth = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

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
              <div className="w-12 h-12 bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl flex items-center justify-center">
                <Eye className="text-white h-6 w-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">Transparência</h1>
                <p className="text-muted-foreground">Clareza total em todas as operações</p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="space-y-8">
            <Card className="shadow-lg">
              <CardHeader className="bg-gradient-to-r from-teal-500/10 to-teal-400/5">
                <CardTitle className="flex items-center gap-2">
                  <Eye className="h-5 w-5 text-teal-600" />
                  Compromisso com a Transparência
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="bg-teal-50 border border-teal-200 rounded-lg p-6">
                  <p className="text-teal-800 leading-relaxed">
                    <strong>Na InvistaPRO, transparência não é apenas uma palavra - é nossa filosofia.</strong> 
                    Acreditamos que você tem o direito de saber exatamente como seus investimentos são gerenciados, 
                    quais são os custos envolvidos e como obtemos nossos resultados. Por isso, fornecemos 
                    informações claras, detalhadas e atualizadas sobre todos os aspectos de nossa operação.
                  </p>
                </div>
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart className="h-5 w-5 text-blue-500" />
                    Performance em Tempo Real
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-blue-50 rounded-lg p-4">
                    <div className="text-center mb-4">
                      <div className="text-3xl font-bold text-blue-600">0,835%</div>
                      <p className="text-sm text-blue-700">Rentabilidade mensal atual</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="text-center">
                        <div className="font-semibold text-blue-800">99,2%</div>
                        <p className="text-blue-600">Taxa de sucesso</p>
                      </div>
                      <div className="text-center">
                        <div className="font-semibold text-blue-800">R$ 2.4M</div>
                        <p className="text-blue-600">Volume gerenciado</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>• Dados atualizados em tempo real</p>
                    <p>• Histórico completo de performance</p>
                    <p>• Comparação com índices de mercado</p>
                    <p>• Relatórios mensais detalhados</p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-green-500" />
                    Estrutura de Custos
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                      <span className="font-semibold text-green-800">Taxa de Administração</span>
                      <span className="font-bold text-green-600">0% ao ano</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <span className="font-semibold text-gray-800">Taxa de Performance</span>
                      <span className="font-bold text-gray-900">Já incluída</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <span className="font-semibold text-gray-800">Taxa de Entrada</span>
                      <span className="font-bold text-green-600">R$ 0</span>
                    </div>
                    <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                      <span className="font-semibold text-gray-800">Taxa de Saída</span>
                      <span className="font-bold text-green-600">R$ 0</span>
                    </div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3">
                    <p className="text-sm text-green-700">
                      <strong>Sem taxas ocultas:</strong> O que você vê é exatamente o que você paga
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-purple-500" />
                  Estratégia de Investimento
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8 space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="font-semibold text-foreground mb-3">Alocação de Capital</h3>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Renda Fixa</span>
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-2 bg-gray-200 rounded">
                            <div className="w-3/4 h-full bg-blue-500 rounded"></div>
                          </div>
                          <span className="text-sm font-semibold">75%</span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Fundos DI</span>
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-2 bg-gray-200 rounded">
                            <div className="w-1/5 h-full bg-green-500 rounded"></div>
                          </div>
                          <span className="text-sm font-semibold">20%</span>
                        </div>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Reserva de Emergência</span>
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-2 bg-gray-200 rounded">
                            <div className="w-1/20 h-full bg-amber-500 rounded"></div>
                          </div>
                          <span className="text-sm font-semibold">5%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-3">Gerenciamento de Risco</h3>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li>• Diversificação automática do portfólio</li>
                      <li>• Limites rígidos de exposição por ativo</li>
                      <li>• Monitoramento de volatilidade em tempo real</li>
                      <li>• Rebalanceamento automático mensal</li>
                      <li>• Proteção contra eventos de mercado</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5 text-orange-500" />
                  Relatórios e Comunicação
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="grid md:grid-cols-3 gap-6">
                  <div className="bg-blue-50 rounded-lg p-4">
                    <h3 className="font-semibold text-blue-800 mb-2">Relatórios Mensais</h3>
                    <ul className="text-sm text-blue-700 space-y-1">
                      <li>• Performance detalhada</li>
                      <li>• Análise de mercado</li>
                      <li>• Projeções futuras</li>
                      <li>• Recomendações estratégicas</li>
                    </ul>
                  </div>
                  <div className="bg-green-50 rounded-lg p-4">
                    <h3 className="font-semibold text-green-800 mb-2">Comunicação Trimestral</h3>
                    <ul className="text-sm text-green-700 space-y-1">
                      <li>• Webinars educativos</li>
                      <li>• Q&A com especialistas</li>
                      <li>• Análise macroeconômica</li>
                      <li>• Tendências de mercado</li>
                    </ul>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-4">
                    <h3 className="font-semibold text-purple-800 mb-2">Comunicação Anual</h3>
                    <ul className="text-sm text-purple-700 space-y-1">
                      <li>• Relatório de sustentabilidade</li>
                      <li>• Auditoria independente</li>
                      <li>• Projeções para próximo ano</li>
                      <li>• Inovações tecnológicas</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>Histórico de Performance ({currentMonth})</CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="space-y-6">
                  <div className="bg-gradient-to-r from-teal-50 to-teal-100 rounded-lg p-6">
                    <div className="grid md:grid-cols-4 gap-4 text-center">
                      <div>
                        <div className="text-2xl font-bold text-teal-600">10,63%</div>
                        <p className="text-sm text-teal-700">Rentabilidade anual</p>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-teal-600">0,835%</div>
                        <p className="text-sm text-teal-700">Média mensal</p>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-teal-600">2,847</div>
                        <p className="text-sm text-teal-700">Sharpe Ratio</p>
                      </div>
                      <div>
                        <div className="text-2xl font-bold text-teal-600">0,12%</div>
                        <p className="text-sm text-teal-700">Volatilidade</p>
                      </div>
                    </div>
                  </div>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <h3 className="font-semibold text-foreground mb-3">Últimos 12 Meses</h3>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Janeiro 2024:</span>
                          <span className="font-semibold text-green-600">+0,892%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Fevereiro 2024:</span>
                          <span className="font-semibold text-green-600">+0,881%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Março 2024:</span>
                          <span className="font-semibold text-green-600">+0,895%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Abril 2024:</span>
                          <span className="font-semibold text-green-600">+0,879%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Maio 2024:</span>
                          <span className="font-semibold text-green-600">+0,888%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Junho 2024:</span>
                          <span className="font-semibold text-green-600">+0,891%</span>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-3">Últimos 6 Meses</h3>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Julho 2024:</span>
                          <span className="font-semibold text-green-600">+0,884%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Agosto 2024:</span>
                          <span className="font-semibold text-green-600">+0,887%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Setembro 2024:</span>
                          <span className="font-semibold text-green-600">+0,882%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Outubro 2024:</span>
                          <span className="font-semibold text-green-600">+0,890%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Novembro 2024:</span>
                          <span className="font-semibold text-green-600">+0,885%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Dezembro 2024:</span>
                          <span className="font-semibold text-green-600">+0,893%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>Nossa Equipe e Valores</CardTitle>
              </CardHeader>
              <CardContent className="p-8 space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="bg-blue-50 rounded-lg p-6">
                    <h3 className="font-semibold text-blue-800 mb-4">Sobre Nós</h3>
                    <div className="space-y-3 text-sm text-blue-700">
                      <p><strong>Início:</strong> Startup criada em 2024 por empreendedores brasileiros</p>
                      <p><strong>Foco:</strong> Tecnologia para democratizar investimentos</p>
                      <p><strong>Estudos:</strong> Análise constante do mercado financeiro brasileiro</p>
                      <p><strong>Objetivo:</strong> Tornar investimentos acessíveis para todos</p>
                      <p><strong>Compromisso:</strong> Transparência total com nossos investidores</p>
                    </div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-6">
                    <h3 className="font-semibold text-green-800 mb-4">Nossos Princípios</h3>
                    <ul className="space-y-2 text-sm text-green-700">
                      <li>• Transparência total em todas as operações</li>
                      <li>• Foco no cliente e na experiência do usuário</li>
                      <li>• Inovação constante em tecnologia financeira</li>
                      <li>• Educação financeira para nossos investidores</li>
                      <li>• Rentabilidade consistente e sustentável</li>
                      <li>• Atendimento humanizado e personalizado</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>Como Garantimos Sua Segurança</CardTitle>
              </CardHeader>
              <CardContent className="p-8 space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="bg-purple-50 rounded-lg p-6">
                    <h3 className="font-semibold text-purple-800 mb-4">Proteção Básica</h3>
                    <div className="space-y-3 text-sm text-purple-700">
                      <p><strong>Senhas seguras:</strong> Criptografia em todas as informações</p>
                      <p><strong>Verificação:</strong> Confirmação por email e documentos</p>
                      <p><strong>Monitoramento:</strong> Equipe acompanha movimentações diariamente</p>
                      <p><strong>Backup:</strong> Seus dados salvos em múltiplos locais</p>
                      <p><strong>Acesso:</strong> Apenas você tem controle da sua conta</p>
                    </div>
                  </div>
                  <div className="bg-orange-50 rounded-lg p-6">
                    <h3 className="font-semibold text-orange-800 mb-4">Política de Investimento</h3>
                    <ul className="space-y-2 text-sm text-orange-700">
                      <li>• Investimentos apenas em produtos de baixo risco</li>
                      <li>• Diversificação do portfólio para reduzir volatilidade</li>
                      <li>• Análise criteriosa antes de cada aplicação</li>
                      <li>• Reserva de emergência sempre mantida</li>
                      <li>• Relatórios mensais detalhados enviados</li>
                      <li>• Suporte via WhatsApp e email</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg border-teal-200">
              <CardContent className="p-8 text-center">
                <div className="w-20 h-20 bg-gradient-to-br from-teal-500 to-teal-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Eye className="text-white h-10 w-10" />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-4">
                  Transparência Total
                </h2>
                <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
                  Acreditamos que a transparência constrói confiança. Por isso, fornecemos acesso completo 
                  a informações sobre performance, custos, estratégias e governança. Você tem o direito 
                  de saber exatamente como seu dinheiro está sendo gerenciado.
                </p>
                <div className="bg-teal-50 border border-teal-200 rounded-lg p-4 inline-block">
                  <p className="text-sm text-teal-700">
                    <strong>Central de Transparência:</strong> Acesse relatórios detalhados, demonstrações financeiras 
                    e informações sobre nossa operação através do seu dashboard pessoal.
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