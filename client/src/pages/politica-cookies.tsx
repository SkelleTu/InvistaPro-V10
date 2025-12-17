import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { ArrowLeft, Cookie, Settings, Info } from "lucide-react";
import { useLocation } from "wouter";

export default function PoliticaCookies() {
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
              <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center">
                <Cookie className="text-white h-6 w-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">Política de Cookies</h1>
                <p className="text-muted-foreground">Uso de cookies e tecnologias similares</p>
              </div>
            </div>
          </div>

          {/* Content */}
          <Card className="shadow-lg">
            <CardHeader className="bg-gradient-to-r from-orange-500/10 to-orange-400/5">
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-orange-600" />
                Política de Cookies InvistaPRO
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Última atualização: {new Date().toLocaleDateString('pt-BR')}
              </p>
            </CardHeader>
            
            <CardContent className="p-8 space-y-8">
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Info className="h-5 w-5 text-orange-600 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-orange-800">Sobre esta Política</h3>
                    <p className="text-sm text-orange-700 mt-1">
                      Esta política explica como utilizamos cookies e tecnologias similares na plataforma InvistaPRO.
                    </p>
                  </div>
                </div>
              </div>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">1. O que são Cookies</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    Cookies são pequenos arquivos de texto que são armazenados no seu dispositivo (computador, tablet ou celular) 
                    quando você visita um site. Eles contêm informações que ajudam o site a lembrar das suas preferências 
                    e melhorar sua experiência de navegação.
                  </p>
                  <p>
                    Os cookies podem ser temporários (removidos quando você fecha o navegador) ou persistentes 
                    (permanecem no dispositivo por um período determinado), e podem ser originados pelo próprio site 
                    que você está visitando ou por serviços de terceiros integrados.
                  </p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">2. Tipos de Cookies que Utilizamos</h2>
                <div className="space-y-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="bg-blue-50 rounded-lg p-4">
                      <h3 className="font-semibold text-blue-800 mb-2">Cookies Essenciais</h3>
                      <p className="text-sm text-blue-700 mb-3">
                        Necessários para o funcionamento básico da plataforma. Não podem ser desabilitados.
                      </p>
                      <ul className="text-xs text-blue-600 space-y-1">
                        <li>• Manutenção da sessão de login</li>
                        <li>• Preferências de idioma e moeda</li>
                        <li>• Segurança e prevenção de fraudes</li>
                        <li>• Funcionalidades do carrinho e transações</li>
                      </ul>
                    </div>
                    
                    <div className="bg-green-50 rounded-lg p-4">
                      <h3 className="font-semibold text-green-800 mb-2">Cookies de Performance</h3>
                      <p className="text-sm text-green-700 mb-3">
                        Coletam informações sobre como você usa nosso site para melhorar a performance.
                      </p>
                      <ul className="text-xs text-green-600 space-y-1">
                        <li>• Análise de tráfego e navegação</li>
                        <li>• Identificação de páginas mais visitadas</li>
                        <li>• Otimização de velocidade de carregamento</li>
                        <li>• Detecção de erros técnicos</li>
                      </ul>
                    </div>
                    
                    <div className="bg-purple-50 rounded-lg p-4">
                      <h3 className="font-semibold text-purple-800 mb-2">Cookies de Funcionalidade</h3>
                      <p className="text-sm text-purple-700 mb-3">
                        Permitem que o site lembre suas preferências para uma experiência personalizada.
                      </p>
                      <ul className="text-xs text-purple-600 space-y-1">
                        <li>• Configurações de tema (claro/escuro)</li>
                        <li>• Preferências de layout</li>
                        <li>• Histórico de ações recentes</li>
                        <li>• Personalização de interface</li>
                      </ul>
                    </div>
                    
                    <div className="bg-amber-50 rounded-lg p-4">
                      <h3 className="font-semibold text-amber-800 mb-2">Cookies de Segurança</h3>
                      <p className="text-sm text-amber-700 mb-3">
                        Protegem contra atividades maliciosas e garantem a integridade das transações.
                      </p>
                      <ul className="text-xs text-amber-600 space-y-1">
                        <li>• Autenticação multifator</li>
                        <li>• Detecção de comportamento suspeito</li>
                        <li>• Proteção contra CSRF</li>
                        <li>• Validação de dispositivos</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">3. Cookies de Terceiros</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>Podemos utilizar serviços de terceiros que podem definir cookies no seu dispositivo:</p>
                  <div className="bg-card/50 rounded-lg p-4">
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <h3 className="font-semibold text-foreground mb-2">Serviços de Análise</h3>
                        <ul className="text-xs space-y-1">
                          <li>• Google Analytics (análise de tráfego)</li>
                          <li>• Hotjar (mapeamento de comportamento)</li>
                          <li>• Microsoft Clarity (análise de experiência)</li>
                        </ul>
                      </div>
                      <div>
                        <h3 className="font-semibold text-foreground mb-2">Integração e Suporte</h3>
                        <ul className="text-xs space-y-1">
                          <li>• Zendesk (sistema de suporte)</li>
                          <li>• Intercom (chat ao vivo)</li>
                          <li>• CDN (entrega de conteúdo)</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                  <p>
                    Estes terceiros possuem suas próprias políticas de privacidade e uso de cookies. 
                    Recomendamos que você consulte suas políticas para entender como seus dados são tratados.
                  </p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">4. Gerenciamento de Cookies</h2>
                <div className="space-y-4 text-sm text-muted-foreground">
                  <p>Você tem controle total sobre os cookies em seu dispositivo:</p>
                  
                  <div className="bg-blue-50 rounded-lg p-4">
                    <h3 className="font-semibold text-blue-800 mb-2">Configurações do Navegador</h3>
                    <p className="text-sm text-blue-700 mb-2">Como gerenciar cookies nos principais navegadores:</p>
                    <div className="grid md:grid-cols-2 gap-3 text-xs text-blue-600">
                      <div>
                        <p><strong>Google Chrome:</strong></p>
                        <p>Configurações → Privacidade e segurança → Cookies</p>
                      </div>
                      <div>
                        <p><strong>Mozilla Firefox:</strong></p>
                        <p>Preferências → Privacidade e segurança → Cookies</p>
                      </div>
                      <div>
                        <p><strong>Safari:</strong></p>
                        <p>Preferências → Privacidade → Cookies</p>
                      </div>
                      <div>
                        <p><strong>Microsoft Edge:</strong></p>
                        <p>Configurações → Cookies e permissões do site</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <Info className="h-4 w-4 text-amber-600 mt-0.5" />
                      <div>
                        <h3 className="font-semibold text-amber-800">Importante</h3>
                        <p className="text-xs text-amber-700 mt-1">
                          Desabilitar cookies essenciais pode afetar o funcionamento da plataforma e impedir 
                          que você acesse certas funcionalidades, como fazer login ou realizar transações.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">5. Tempo de Armazenamento</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>Diferentes tipos de cookies têm prazos de validade distintos:</p>
                  <div className="bg-card/50 rounded-lg p-4">
                    <div className="grid md:grid-cols-2 gap-4 text-xs">
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="font-semibold">Sessão de login:</span>
                          <span>30 dias</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-semibold">Preferências:</span>
                          <span>12 meses</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-semibold">Segurança:</span>
                          <span>24 horas</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <span className="font-semibold">Análise:</span>
                          <span>24 meses</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-semibold">Performance:</span>
                          <span>6 meses</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="font-semibold">Funcionalidade:</span>
                          <span>12 meses</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">6. Cookies Essenciais para Funcionamento</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>Lista dos cookies essenciais que são necessários para o funcionamento da plataforma:</p>
                  <div className="bg-red-50 rounded-lg p-4">
                    <div className="grid md:grid-cols-2 gap-4 text-xs">
                      <div>
                        <p><strong>sessionId:</strong> Identificação da sessão de login</p>
                        <p><strong>authToken:</strong> Token de autenticação segura</p>
                        <p><strong>csrfToken:</strong> Proteção contra ataques CSRF</p>
                      </div>
                      <div>
                        <p><strong>userPrefs:</strong> Configurações de interface</p>
                        <p><strong>language:</strong> Idioma selecionado</p>
                        <p><strong>timezone:</strong> Fuso horário do usuário</p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">7. Uso de Local Storage e Session Storage</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    Além de cookies, utilizamos tecnologias de armazenamento local para melhorar sua experiência:
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-4">
                    <li><strong>Local Storage:</strong> Armazena dados que persistem entre sessões (preferências de tema, configurações)</li>
                    <li><strong>Session Storage:</strong> Dados temporários válidos apenas durante a sessão atual</li>
                    <li><strong>IndexedDB:</strong> Cache local para otimizar performance de dados frequentes</li>
                  </ul>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">8. Alterações nesta Política</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    Podemos atualizar esta Política de Cookies periodicamente para refletir mudanças em nossas práticas 
                    ou por outros motivos operacionais, legais ou regulamentares. Alterações significativas serão 
                    comunicadas através dos canais oficiais da plataforma.
                  </p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">9. Consentimento e Opt-out</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    Ao continuar usando nossa plataforma após ser informado sobre o uso de cookies, você consente 
                    com sua utilização conforme descrito nesta política. Você pode retirar seu consentimento ou 
                    modificar suas preferências a qualquer momento através das configurações do navegador.
                  </p>
                  <p>
                    Para cookies de terceiros, recomendamos visitar os sites dos respectivos provedores para 
                    entender suas práticas e exercer suas opções de opt-out.
                  </p>
                </div>
              </section>

              <div className="border-t pt-6 mt-8">
                <div className="bg-orange-50 rounded-lg p-4">
                  <h3 className="font-semibold text-foreground mb-2">Dúvidas sobre Cookies</h3>
                  <p className="text-sm text-muted-foreground mb-2">
                    Se você tiver dúvidas sobre nossa utilização de cookies ou desejar mais informações:
                  </p>
                  <div className="space-y-1 text-sm">
                    <p><strong>Email:</strong> vfdiogoseg@gmail.com</p>
                    <p><strong>WhatsApp:</strong> (19) 99723-8298</p>
                    <p><strong>Horário:</strong> Segunda a sexta, 9h às 18h</p>
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