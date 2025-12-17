import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { ArrowLeft, FileText, Shield, AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";

export default function TermosUso() {
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
              <div className="w-12 h-12 bg-gradient-to-br from-amber-400 to-yellow-600 rounded-xl flex items-center justify-center">
                <FileText className="text-white h-6 w-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">Termos de Uso</h1>
                <p className="text-muted-foreground">InvistaPRO - Plataforma de Investimentos</p>
              </div>
            </div>
          </div>

          {/* Content */}
          <Card className="shadow-lg">
            <CardHeader className="bg-gradient-to-r from-primary/10 to-primary/5">
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Termos de Uso da Plataforma InvistaPRO
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Última atualização: {new Date().toLocaleDateString('pt-BR')}
              </p>
            </CardHeader>
            
            <CardContent className="p-8 space-y-8">
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-amber-800">Importante</h3>
                    <p className="text-sm text-amber-700 mt-1">
                      Ao utilizar a plataforma InvistaPRO, você aceita integralmente estes termos e condições.
                    </p>
                  </div>
                </div>
              </div>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">1. Definições</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p><strong>Plataforma:</strong> Refere-se ao sistema InvistaPRO, incluindo website, aplicações e serviços relacionados.</p>
                  <p><strong>Usuário:</strong> Pessoa física maior de 18 anos que utiliza os serviços da plataforma.</p>
                  <p><strong>Investimentos:</strong> Operações financeiras realizadas através da plataforma com rendimentos automatizados.</p>
                  <p><strong>Conta:</strong> Perfil do usuário na plataforma com dados pessoais e financeiros verificados.</p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">2. Aceite dos Termos</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    O uso da plataforma InvistaPRO implica na aceitação integral destes Termos de Uso. 
                    Caso não concorde com qualquer disposição, você deve interromper imediatamente o uso dos serviços.
                  </p>
                  <p>
                    Reservamo-nos o direito de modificar estes termos a qualquer momento, sendo as alterações 
                    comunicadas com 30 dias de antecedência através dos canais oficiais.
                  </p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">3. Requisitos e Elegibilidade</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>Para utilizar a plataforma, você deve:</p>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li>Ser pessoa física maior de 18 anos</li>
                    <li>Possuir documento de identidade válido</li>
                    <li>Ter conta bancária em seu nome</li>
                    <li>Fornecer informações verídicas e atualizadas</li>
                    <li>Concordar com verificação de identidade (KYC)</li>
                    <li>Depositar valor mínimo de R$ 130,00</li>
                  </ul>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">4. Funcionamento dos Investimentos</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    A InvistaPRO oferece sistema automatizado de investimentos com rendimento mensal de 0,835% 
                    sobre o capital aplicado, totalizando aproximadamente 10,63% ao ano.
                  </p>
                  <p><strong>Regras de Movimentação:</strong></p>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li>Rendimentos podem ser sacados mensalmente</li>
                    <li>Capital principal bloqueado por 95 dias</li>
                    <li>Saques acima de R$ 300 requerem autenticação biométrica</li>
                    <li>Processamento de saques em até 48 horas úteis</li>
                  </ul>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">5. Obrigações do Usuário</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <ul className="list-disc list-inside space-y-2">
                    <li>Manter dados pessoais sempre atualizados</li>
                    <li>Não compartilhar credenciais de acesso</li>
                    <li>Utilizar a plataforma apenas para fins lícitos</li>
                    <li>Comunicar imediatamente atividades suspeitas</li>
                    <li>Respeitar os limites operacionais estabelecidos</li>
                    <li>Arcar com taxas e impostos conforme legislação</li>
                  </ul>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">6. Limitações e Responsabilidades</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    A InvistaPRO atua como facilitadora de investimentos automatizados, não sendo instituição financeira. 
                    Não garantimos rentabilidade específica e operações estão sujeitas a variações de mercado.
                  </p>
                  <p><strong>Limitações de Responsabilidade:</strong></p>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li>Flutuações normais do mercado financeiro</li>
                    <li>Indisponibilidade temporária da plataforma</li>
                    <li>Mudanças na legislação tributária</li>
                    <li>Força maior e caso fortuito</li>
                  </ul>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">7. Privacidade e Proteção de Dados</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    Seus dados pessoais são protegidos conforme nossa Política de Privacidade e legislação LGPD. 
                    Utilizamos criptografia avançada e medidas de segurança rigorosas para proteger suas informações.
                  </p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">8. Rescisão e Encerramento</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    Você pode solicitar encerramento da conta a qualquer tempo, respeitando o prazo de carência 
                    de 95 dias para saque do capital principal. O encerramento não exime responsabilidades já constituídas.
                  </p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">9. Legislação Aplicável</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    Estes termos são regidos pela legislação brasileira. Quaisquer controvérsias serão dirimidas 
                    no foro da comarca de Araras/SP, com exclusão de qualquer outro.
                  </p>
                </div>
              </section>

              <div className="border-t pt-6 mt-8">
                <div className="bg-primary/10 rounded-lg p-4">
                  <h3 className="font-semibold text-foreground mb-2">Contato e Suporte</h3>
                  <p className="text-sm text-muted-foreground">
                    Para dúvidas sobre estes termos, entre em contato através do WhatsApp (19) 99723-8298 
                    ou email vfdiogoseg@gmail.com.
                  </p>
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