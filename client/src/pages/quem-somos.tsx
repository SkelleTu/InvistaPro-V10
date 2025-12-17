import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { ArrowLeft, Building2, Users, Target, Award } from "lucide-react";
import { useLocation } from "wouter";

export default function QuemSomos() {
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
              <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center">
                <Building2 className="text-white h-6 w-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">Quem Somos</h1>
                <p className="text-muted-foreground">Conheça a InvistaPRO</p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="space-y-8">
            <Card className="shadow-lg">
              <CardHeader className="bg-gradient-to-r from-primary/10 to-primary/5">
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-primary" />
                  Nossa Missão
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <p className="text-lg text-muted-foreground leading-relaxed">
                  A InvistaPRO nasceu com a missão de democratizar o acesso a investimentos de alta qualidade, 
                  oferecendo uma plataforma tecnológica avançada que combina segurança, rentabilidade e simplicidade. 
                  Acreditamos que todos merecem a oportunidade de fazer seu dinheiro crescer com 
                  <span className="font-semibold text-primary"> risco zero</span>.
                </p>
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-3 gap-6">
              <Card>
                <CardContent className="p-6 text-center">
                  <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Target className="h-8 w-8 text-blue-600" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">Visão</h3>
                  <p className="text-sm text-muted-foreground">
                    Ser a principal plataforma de investimentos automatizados do Brasil, 
                    reconhecida pela excelência e inovação tecnológica.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6 text-center">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Users className="h-8 w-8 text-green-600" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">Valores</h3>
                  <p className="text-sm text-muted-foreground">
                    Transparência, segurança, inovação e compromisso com os resultados 
                    dos nossos investidores são nossos pilares fundamentais.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-6 text-center">
                  <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <Award className="h-8 w-8 text-amber-600" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">Propósito</h3>
                  <p className="text-sm text-muted-foreground">
                    Transformar a vida financeira das pessoas através de investimentos 
                    inteligentes, seguros e acessíveis a todos.
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>Nossa História</CardTitle>
              </CardHeader>
              <CardContent className="p-8 space-y-6">
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                      <span className="font-bold text-primary">2024</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">Fundação da InvistaPRO</h3>
                      <p className="text-sm text-muted-foreground">
                        Criada por especialistas em tecnologia financeira com o objetivo de revolucionar 
                        o mercado de investimentos brasileiro através da automação inteligente.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                      <span className="font-bold text-primary">2024</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">Lançamento da Plataforma</h3>
                      <p className="text-sm text-muted-foreground">
                        Desenvolvimento e lançamento da plataforma com tecnologia de ponta, 
                        incluindo segurança biométrica e processos automatizados de investimento.
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                      <span className="font-bold text-primary">2025</span>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">Crescimento Sustentável</h3>
                      <p className="text-sm text-muted-foreground">
                        Consolidação como uma das principais fintechs de investimento do país, 
                        com milhares de usuários ativos e rentabilidade consistente.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>Tecnologia e Inovação</CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="font-semibold text-foreground mb-3">Infraestrutura Avançada</h3>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li>• Algoritmos proprietários de análise de mercado</li>
                      <li>• Criptografia de nível bancário para todas as transações</li>
                      <li>• Monitoramento 24/7 por sistemas de inteligência artificial</li>
                      <li>• Backup redundante e recuperação de desastres</li>
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-3">Segurança Biométrica</h3>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li>• Sistema "InvestPro-Secure-Auth" próprio</li>
                      <li>• Reconhecimento facial avançado</li>
                      <li>• Autenticação multifator obrigatória</li>
                      <li>• Detecção de fraudes em tempo real</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>Compromisso com a Qualidade</CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="space-y-4">
                  <p className="text-muted-foreground">
                    Na InvistaPRO, acreditamos que a qualidade não é negociável. Por isso, 
                    implementamos os mais rigorosos padrões de controle e qualidade em todos 
                    os aspectos da nossa operação:
                  </p>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <h3 className="font-semibold text-foreground mb-2">Auditoria Contínua</h3>
                      <p className="text-sm text-muted-foreground">
                        Nossos processos são auditados regularmente por empresas independentes 
                        para garantir total conformidade e transparência.
                      </p>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground mb-2">Suporte Especializado</h3>
                      <p className="text-sm text-muted-foreground">
                        Equipe de especialistas disponível para atender suas necessidades 
                        com excelência e agilidade.
                      </p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg border-primary/20">
              <CardContent className="p-8 text-center">
                <div className="w-20 h-20 bg-gradient-to-br from-amber-400 to-yellow-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Award className="text-white h-10 w-10" />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-4">
                  Invista com Risco Zero
                </h2>
                <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
                  Mais que um slogan, é nosso compromisso. Utilizamos as melhores práticas do mercado 
                  financeiro, tecnologia de ponta e processos rigorosos para garantir que seus 
                  investimentos tenham a máxima segurança e rentabilidade.
                </p>
                <div className="flex justify-center gap-8 text-sm">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-primary">10.63%</div>
                    <p className="text-muted-foreground">Rentabilidade anual</p>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">100%</div>
                    <p className="text-muted-foreground">Seguro e protegido</p>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">24/7</div>
                    <p className="text-muted-foreground">Monitoramento</p>
                  </div>
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