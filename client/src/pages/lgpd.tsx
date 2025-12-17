import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { ArrowLeft, Scale, UserCheck, AlertCircle } from "lucide-react";
import { useLocation } from "wouter";

export default function LGPD() {
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
                <Scale className="text-white h-6 w-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">LGPD - Lei Geral de Proteção de Dados</h1>
                <p className="text-muted-foreground">Conformidade e direitos do titular</p>
              </div>
            </div>
          </div>

          {/* Content */}
          <Card className="shadow-lg">
            <CardHeader className="bg-gradient-to-r from-green-500/10 to-green-400/5">
              <CardTitle className="flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-green-600" />
                Conformidade LGPD - InvistaPRO
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Lei nº 13.709/2018 - Proteção de dados pessoais no Brasil
              </p>
            </CardHeader>
            
            <CardContent className="p-8 space-y-8">
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <UserCheck className="h-5 w-5 text-green-600 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-green-800">Compromisso com a LGPD</h3>
                    <p className="text-sm text-green-700 mt-1">
                      A InvistaPRO está em total conformidade com a Lei Geral de Proteção de Dados Pessoais.
                    </p>
                  </div>
                </div>
              </div>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">1. O que é a LGPD</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    A Lei Geral de Proteção de Dados Pessoais (LGPD) - Lei nº 13.709/2018 é a legislação brasileira 
                    que regulamenta o tratamento de dados pessoais, tanto no meio físico quanto digital, por pessoas 
                    físicas ou jurídicas de direito público ou privado.
                  </p>
                  <p>
                    A lei tem como objetivo proteger os direitos fundamentais de liberdade e privacidade, 
                    estabelecendo regras claras sobre como os dados pessoais devem ser coletados, 
                    armazenados, tratados e compartilhados.
                  </p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">2. Princípios da LGPD Aplicados</h2>
                <div className="grid md:grid-cols-2 gap-4 text-sm text-muted-foreground">
                  <div className="space-y-3">
                    <div>
                      <h3 className="font-semibold text-foreground">Finalidade</h3>
                      <p>Coletamos dados apenas para fins específicos e legítimos relacionados aos nossos serviços.</p>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">Adequação</h3>
                      <p>O tratamento é compatível com as finalidades informadas ao titular dos dados.</p>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">Necessidade</h3>
                      <p>Limitamos o tratamento ao mínimo necessário para atingir as finalidades.</p>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">Livre Acesso</h3>
                      <p>Garantimos consulta facilitada e gratuita sobre forma e duração do tratamento.</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <h3 className="font-semibold text-foreground">Qualidade dos Dados</h3>
                      <p>Mantemos dados exatos, claros, relevantes e atualizados.</p>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">Transparência</h3>
                      <p>Fornecemos informações claras e acessíveis sobre o tratamento de dados.</p>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">Segurança</h3>
                      <p>Utilizamos medidas técnicas e administrativas para proteger os dados.</p>
                    </div>
                    <div>
                      <h3 className="font-semibold text-foreground">Responsabilização</h3>
                      <p>Demonstramos eficácia das medidas de proteção adotadas.</p>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">3. Seus Direitos como Titular de Dados</h2>
                <div className="space-y-4">
                  <div className="bg-card/50 rounded-lg p-4">
                    <h3 className="font-semibold text-foreground mb-3">Direitos Fundamentais (Art. 18 da LGPD):</h3>
                    <div className="grid md:grid-cols-2 gap-3 text-sm text-muted-foreground">
                      <div className="space-y-2">
                        <div className="flex items-start gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                          <div>
                            <p className="font-medium">Confirmação da existência de tratamento</p>
                            <p className="text-xs">Saber se seus dados estão sendo tratados</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                          <div>
                            <p className="font-medium">Acesso aos dados</p>
                            <p className="text-xs">Obter cópia dos dados pessoais tratados</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                          <div>
                            <p className="font-medium">Correção de dados incompletos</p>
                            <p className="text-xs">Atualizar informações inexatas ou desatualizadas</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                          <div>
                            <p className="font-medium">Anonimização, bloqueio ou eliminação</p>
                            <p className="text-xs">Para dados desnecessários ou excessivos</p>
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-start gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                          <div>
                            <p className="font-medium">Portabilidade dos dados</p>
                            <p className="text-xs">Transferir dados para outro fornecedor</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                          <div>
                            <p className="font-medium">Eliminação dos dados</p>
                            <p className="text-xs">Quando tratados com base no consentimento</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                          <div>
                            <p className="font-medium">Informações sobre compartilhamento</p>
                            <p className="text-xs">Saber com quem seus dados foram compartilhados</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full mt-2"></div>
                          <div>
                            <p className="font-medium">Revogação do consentimento</p>
                            <p className="text-xs">Retirar autorização a qualquer momento</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">4. Como Exercer seus Direitos</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    Para exercer qualquer um dos seus direitos previstos na LGPD, você pode entrar em contato 
                    conosco através dos canais oficiais. Garantimos resposta em até 15 dias conforme estabelecido na lei.
                  </p>
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5" />
                      <div>
                        <h3 className="font-semibold text-amber-800">Processo de Solicitação</h3>
                        <ol className="list-decimal list-inside space-y-1 text-amber-700 mt-2 text-xs">
                          <li>Entre em contato através dos canais oficiais</li>
                          <li>Informe claramente qual direito deseja exercer</li>
                          <li>Forneça informações para confirmação de identidade</li>
                          <li>Aguarde nossa resposta em até 15 dias úteis</li>
                          <li>Caso necessário, podemos prorrogar por mais 15 dias</li>
                        </ol>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">5. Base Legal para Tratamento</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>Conforme Art. 7º da LGPD, tratamos seus dados pessoais com base nas seguintes hipóteses:</p>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="bg-blue-50 rounded-lg p-3">
                        <p className="font-semibold text-blue-800">Consentimento do Titular</p>
                        <p className="text-xs text-blue-700">Para comunicações promocionais e melhorias</p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-3">
                        <p className="font-semibold text-green-800">Execução de Contrato</p>
                        <p className="text-xs text-green-700">Prestação dos serviços de investimento</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="bg-purple-50 rounded-lg p-3">
                        <p className="font-semibold text-purple-800">Cumprimento de Obrigação Legal</p>
                        <p className="text-xs text-purple-700">Atendimento de exigências regulatórias</p>
                      </div>
                      <div className="bg-orange-50 rounded-lg p-3">
                        <p className="font-semibold text-orange-800">Legítimo Interesse</p>
                        <p className="text-xs text-orange-700">Prevenção a fraudes e segurança</p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">6. Governança de Dados</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>Implementamos estrutura de governança robusta:</p>
                  <ul className="list-disc list-inside space-y-1 ml-4">
                    <li>Encarregado de Proteção de Dados (DPO) designado</li>
                    <li>Políticas internas de proteção de dados</li>
                    <li>Treinamento contínuo das equipes</li>
                    <li>Avaliação de impacto em novos projetos</li>
                    <li>Monitoramento e auditoria periódica</li>
                    <li>Plano de resposta a incidentes de segurança</li>
                  </ul>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">7. Autoridade Nacional de Proteção de Dados (ANPD)</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    A ANPD é o órgão responsável por zelar pela proteção dos dados pessoais no Brasil. 
                    Caso não esteja satisfeito com nossa resposta, você pode apresentar reclamação diretamente à ANPD.
                  </p>
                  <div className="bg-card/50 rounded-lg p-3">
                    <p className="text-xs">
                      <strong>Site oficial:</strong> https://www.gov.br/anpd/<br/>
                      <strong>Canal de atendimento:</strong> Ouvidoria da ANPD
                    </p>
                  </div>
                </div>
              </section>

              <div className="border-t pt-6 mt-8">
                <div className="bg-green-50 rounded-lg p-4">
                  <h3 className="font-semibold text-foreground mb-2">Encarregado de Proteção de Dados (DPO)</h3>
                  <p className="text-sm text-muted-foreground mb-2">
                    Nosso DPO está disponível para esclarecer dúvidas e receber solicitações relacionadas à LGPD:
                  </p>
                  <div className="space-y-1 text-sm">
                    <p><strong>Email:</strong> vfdiogoseg@gmail.com</p>
                    <p><strong>WhatsApp:</strong> (19) 99723-8298</p>
                    <p><strong>Horário de atendimento:</strong> Segunda a sexta, 9h às 18h</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
      
      <Footer />
    </div>
  );
}