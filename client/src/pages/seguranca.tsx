import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { ArrowLeft, Shield, Lock, Eye, CheckCircle, AlertTriangle, Fingerprint } from "lucide-react";
import { useLocation } from "wouter";

export default function Seguranca() {
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
              <div className="w-12 h-12 bg-gradient-to-br from-red-500 to-red-600 rounded-xl flex items-center justify-center">
                <Shield className="text-white h-6 w-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">Segurança</h1>
                <p className="text-muted-foreground">Proteção máxima para seus investimentos</p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="space-y-8">
            <Card className="shadow-lg">
              <CardHeader className="bg-gradient-to-r from-red-500/10 to-red-400/5">
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-red-600" />
                  Segurança de Nível Bancário
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Implementamos os mais rigorosos padrões de segurança da indústria financeira
                </p>
              </CardHeader>
              <CardContent className="p-8">
                <div className="bg-red-50 border border-red-200 rounded-lg p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <Shield className="h-8 w-8 text-red-600" />
                    <div>
                      <h3 className="font-bold text-red-800 text-lg">Compromisso com a Segurança</h3>
                      <p className="text-red-700">Seus investimentos estão protegidos por múltiplas camadas de segurança</p>
                    </div>
                  </div>
                  <div className="grid md:grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-2xl font-bold text-red-600">256-bit</div>
                      <p className="text-sm text-red-700">Criptografia SSL</p>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-red-600">24/7</div>
                      <p className="text-sm text-red-700">Monitoramento</p>
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-red-600">100%</div>
                      <p className="text-sm text-red-700">Protegido</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lock className="h-5 w-5 text-blue-500" />
                    Criptografia Avançada
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                      <div>
                        <p className="font-semibold text-foreground">SSL/TLS 1.3</p>
                        <p className="text-sm text-muted-foreground">Criptografia de última geração para todas as comunicações</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                      <div>
                        <p className="font-semibold text-foreground">AES-256</p>
                        <p className="text-sm text-muted-foreground">Dados armazenados com criptografia militar</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <CheckCircle className="h-5 w-5 text-green-500 mt-0.5" />
                      <div>
                        <p className="font-semibold text-foreground">RSA-4096</p>
                        <p className="text-sm text-muted-foreground">Chaves de segurança de altíssimo nível</p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Fingerprint className="h-5 w-5 text-purple-500" />
                    Autenticação Biométrica
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="bg-purple-50 rounded-lg p-4">
                    <h3 className="font-semibold text-purple-800 mb-2">InvestPro-Secure-Auth</h3>
                    <p className="text-sm text-purple-700">
                      Sistema proprietário de autenticação biométrica desenvolvido exclusivamente para a InvistaPRO
                    </p>
                  </div>
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>• Reconhecimento facial com IA avançada</p>
                    <p>• Detecção de vida em tempo real</p>
                    <p>• Proteção contra fotos e vídeos falsos</p>
                    <p>• Obrigatório para saques acima de R$ 300</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="h-5 w-5 text-green-500" />
                  Monitoramento e Detecção
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="grid md:grid-cols-3 gap-6">
                  <div className="text-center">
                    <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Eye className="h-8 w-8 text-blue-600" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-2">Monitoramento 24/7</h3>
                    <p className="text-sm text-muted-foreground">
                      Sistemas de IA monitoram continuamente todas as transações e atividades suspeitas
                    </p>
                  </div>
                  <div className="text-center">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <AlertTriangle className="h-8 w-8 text-red-600" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-2">Detecção de Fraudes</h3>
                    <p className="text-sm text-muted-foreground">
                      Algoritmos avançados identificam padrões anômalos e bloqueiam tentativas fraudulentas
                    </p>
                  </div>
                  <div className="text-center">
                    <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                      <Shield className="h-8 w-8 text-green-600" />
                    </div>
                    <h3 className="font-semibold text-foreground mb-2">Resposta Imediata</h3>
                    <p className="text-sm text-muted-foreground">
                      Ação automática em milissegundos para proteger sua conta e investimentos
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>Infraestrutura de Segurança</CardTitle>
              </CardHeader>
              <CardContent className="p-8 space-y-6">
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <h3 className="font-semibold text-foreground mb-3">Proteção de Dados</h3>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li>• Segregação completa de dados sensíveis</li>
                      <li>• Backup criptografado em múltiplas localidades</li>
                      <li>• Controle de acesso baseado em funções</li>
                      <li>• Logs de auditoria imutáveis</li>
                      <li>• Políticas de retenção rigorosas</li>
                    </ul>
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground mb-3">Conformidade Regulatória</h3>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                      <li>• Conformidade total com LGPD</li>
                      <li>• Padrões PCI DSS para pagamentos</li>
                      <li>• Certificação ISO 27001 em andamento</li>
                      <li>• Auditoria independente semestral</li>
                      <li>• Relatórios de segurança transparentes</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>Segurança em Camadas</CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="space-y-6">
                  <div className="text-center mb-6">
                    <p className="text-muted-foreground">
                      Nossa arquitetura de segurança em camadas garante proteção máxima em todos os níveis
                    </p>
                  </div>
                  <div className="space-y-4">
                    <div className="bg-gradient-to-r from-red-50 to-red-100 rounded-lg p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center text-white font-bold text-sm">1</div>
                        <div>
                          <h3 className="font-semibold text-red-800">Perímetro de Rede</h3>
                          <p className="text-sm text-red-700">Firewall avançado e proteção DDoS</p>
                        </div>
                      </div>
                    </div>
                    <div className="bg-gradient-to-r from-orange-50 to-orange-100 rounded-lg p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center text-white font-bold text-sm">2</div>
                        <div>
                          <h3 className="font-semibold text-orange-800">Aplicação</h3>
                          <p className="text-sm text-orange-700">WAF, autenticação e autorização rigorosa</p>
                        </div>
                      </div>
                    </div>
                    <div className="bg-gradient-to-r from-blue-50 to-blue-100 rounded-lg p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white font-bold text-sm">3</div>
                        <div>
                          <h3 className="font-semibold text-blue-800">Base de Dados</h3>
                          <p className="text-sm text-blue-700">Criptografia, segregação e controle de acesso</p>
                        </div>
                      </div>
                    </div>
                    <div className="bg-gradient-to-r from-green-50 to-green-100 rounded-lg p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white font-bold text-sm">4</div>
                        <div>
                          <h3 className="font-semibold text-green-800">Monitoramento</h3>
                          <p className="text-sm text-green-700">SIEM, análise comportamental e resposta automática</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle>Certificações e Auditorias</CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="bg-blue-50 rounded-lg p-6">
                    <h3 className="font-semibold text-blue-800 mb-4">Certificações Atuais</h3>
                    <ul className="space-y-2 text-sm text-blue-700">
                      <li>• SSL Certificate Authority (DigiCert)</li>
                      <li>• PCI DSS Level 1 Service Provider</li>
                      <li>• LGPD Compliance Certificate</li>
                      <li>• AWS Well-Architected Security</li>
                    </ul>
                  </div>
                  <div className="bg-green-50 rounded-lg p-6">
                    <h3 className="font-semibold text-green-800 mb-4">Em Processo</h3>
                    <ul className="space-y-2 text-sm text-green-700">
                      <li>• ISO 27001:2013 (Gestão de Segurança)</li>
                      <li>• SOC 2 Type II (Controles de Segurança)</li>
                      <li>• ISO 27018 (Proteção de Dados na Nuvem)</li>
                      <li>• NIST Cybersecurity Framework</li>
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-lg border-red-200">
              <CardContent className="p-8 text-center">
                <div className="w-20 h-20 bg-gradient-to-br from-red-500 to-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <Shield className="text-white h-10 w-10" />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-4">
                  Sua Segurança é Nossa Prioridade
                </h2>
                <p className="text-muted-foreground mb-6 max-w-2xl mx-auto">
                  Investimos constantemente em tecnologia e processos para garantir que seus dados e investimentos 
                  estejam sempre protegidos. Nossa equipe de segurança trabalha 24/7 para manter os mais altos 
                  padrões de proteção do mercado.
                </p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 inline-block">
                  <p className="text-sm text-red-700">
                    <strong>Relatório de Transparência:</strong> Publicamos relatórios trimestrais sobre nossa postura de segurança, 
                    incluindo testes de penetração e auditorias independentes.
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