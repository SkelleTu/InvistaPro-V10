import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/ui/footer";
import { ArrowLeft, Shield, Eye, Lock } from "lucide-react";
import { useLocation } from "wouter";

export default function PoliticaPrivacidade() {
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
                <Eye className="text-white h-6 w-6" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">Política de Privacidade</h1>
                <p className="text-muted-foreground">Proteção e transparência de dados</p>
              </div>
            </div>
          </div>

          {/* Content */}
          <Card className="shadow-lg">
            <CardHeader className="bg-gradient-to-r from-blue-500/10 to-blue-400/5">
              <CardTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5 text-blue-600" />
                Política de Privacidade InvistaPRO
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Última atualização: {new Date().toLocaleDateString('pt-BR')}
              </p>
            </CardHeader>
            
            <CardContent className="p-8 space-y-8">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Shield className="h-5 w-5 text-blue-600 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-blue-800">Compromisso com sua Privacidade</h3>
                    <p className="text-sm text-blue-700 mt-1">
                      A InvistaPRO se compromete a proteger e respeitar sua privacidade em conformidade com a LGPD.
                    </p>
                  </div>
                </div>
              </div>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">1. Informações que Coletamos</h2>
                <div className="space-y-4 text-sm text-muted-foreground">
                  <div>
                    <h3 className="font-semibold text-foreground mb-2">1.1 Dados de Identificação</h3>
                    <ul className="list-disc list-inside space-y-1 ml-4">
                      <li>Nome completo e CPF</li>
                      <li>Data de nascimento</li>
                      <li>Documento de identidade (RG/CNH)</li>
                      <li>Endereço residencial completo</li>
                      <li>Telefone e email</li>
                    </ul>
                  </div>
                  
                  <div>
                    <h3 className="font-semibold text-foreground mb-2">1.2 Dados Financeiros</h3>
                    <ul className="list-disc list-inside space-y-1 ml-4">
                      <li>Informações bancárias (PIX, conta corrente)</li>
                      <li>Histórico de transações na plataforma</li>
                      <li>Comprovantes de renda</li>
                      <li>Movimentações e saldos</li>
                    </ul>
                  </div>
                  
                  <div>
                    <h3 className="font-semibold text-foreground mb-2">1.3 Dados Técnicos</h3>
                    <ul className="list-disc list-inside space-y-1 ml-4">
                      <li>Endereço IP e localização</li>
                      <li>Informações do dispositivo e navegador</li>
                      <li>Cookies e tecnologias similares</li>
                      <li>Logs de acesso e segurança</li>
                    </ul>
                  </div>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">2. Como Utilizamos suas Informações</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p><strong>Finalidades do Tratamento:</strong></p>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li>Verificação de identidade e prevenção a fraudes (KYC/AML)</li>
                    <li>Processamento de investimentos e transações financeiras</li>
                    <li>Cumprimento de obrigações legais e regulatórias</li>
                    <li>Comunicação sobre serviços e suporte técnico</li>
                    <li>Melhoria contínua da plataforma e experiência do usuário</li>
                    <li>Análise de risco e segurança das operações</li>
                  </ul>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">3. Base Legal para o Tratamento</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>O tratamento de seus dados pessoais é baseado nas seguintes hipóteses legais da LGPD:</p>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li><strong>Consentimento:</strong> Para comunicações promocionais e melhorias de produto</li>
                    <li><strong>Execução de contrato:</strong> Para prestação dos serviços de investimento</li>
                    <li><strong>Cumprimento de obrigação legal:</strong> Para atender exigências regulatórias</li>
                    <li><strong>Legítimo interesse:</strong> Para prevenção a fraudes e segurança</li>
                  </ul>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">4. Compartilhamento de Dados</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>Seus dados podem ser compartilhados apenas nas seguintes situações:</p>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li>Com instituições financeiras parceiras para processamento de pagamentos</li>
                    <li>Com prestadores de serviços (tecnologia, segurança, auditoria)</li>
                    <li>Com autoridades competentes quando exigido por lei</li>
                    <li>Em casos de fusão, aquisição ou reorganização empresarial</li>
                  </ul>
                  <p className="mt-4">
                    <strong>Importante:</strong> Nunca vendemos ou comercializamos seus dados pessoais com terceiros.
                  </p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">5. Segurança e Proteção</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>Implementamos medidas técnicas e organizacionais avançadas:</p>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li>Criptografia SSL/TLS para transmissão de dados</li>
                    <li>Criptografia AES-256 para armazenamento</li>
                    <li>Autenticação multifator e biométrica</li>
                    <li>Monitoramento contínuo de segurança 24/7</li>
                    <li>Controles de acesso baseados em função</li>
                    <li>Backups seguros e plano de recuperação</li>
                  </ul>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">6. Seus Direitos (LGPD)</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>Conforme a LGPD, você possui os seguintes direitos:</p>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li><strong>Confirmação:</strong> Saber se tratamos seus dados</li>
                    <li><strong>Acesso:</strong> Obter cópia dos dados tratados</li>
                    <li><strong>Correção:</strong> Corrigir dados incompletos ou incorretos</li>
                    <li><strong>Anonimização/Bloqueio:</strong> Limitar o uso dos dados</li>
                    <li><strong>Eliminação:</strong> Exclusão de dados desnecessários</li>
                    <li><strong>Portabilidade:</strong> Transferir dados para outro fornecedor</li>
                    <li><strong>Revogação:</strong> Retirar consentimento a qualquer momento</li>
                  </ul>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">7. Retenção de Dados</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>Os prazos de retenção variam conforme a finalidade:</p>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li><strong>Dados de identificação:</strong> 5 anos após encerramento da conta</li>
                    <li><strong>Dados financeiros:</strong> 10 anos conforme legislação bancária</li>
                    <li><strong>Logs de segurança:</strong> 6 meses para investigações</li>
                    <li><strong>Comunicações:</strong> 2 anos para suporte e qualidade</li>
                  </ul>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">8. Cookies e Tecnologias</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>Utilizamos cookies para:</p>
                  <ul className="list-disc list-inside space-y-2 ml-4">
                    <li>Manter sua sessão ativa e preferências</li>
                    <li>Analisar performance e usabilidade</li>
                    <li>Personalizar conteúdo e experiência</li>
                    <li>Garantir segurança e prevenção a fraudes</li>
                  </ul>
                  <p>Você pode gerenciar cookies através das configurações do navegador.</p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">9. Transferência Internacional</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    Seus dados são processados principalmente no Brasil. Quando necessário transferir dados 
                    para outros países, garantimos proteção adequada através de cláusulas contratuais padrão 
                    e certificações internacionais.
                  </p>
                </div>
              </section>

              <section>
                <h2 className="text-xl font-semibold text-foreground mb-4">10. Alterações na Política</h2>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p>
                    Esta política pode ser atualizada periodicamente. Mudanças significativas serão comunicadas 
                    com 30 dias de antecedência através dos canais oficiais. O uso continuado da plataforma 
                    após mudanças constitui aceite das novas condições.
                  </p>
                </div>
              </section>

              <div className="border-t pt-6 mt-8">
                <div className="bg-blue-50 rounded-lg p-4">
                  <h3 className="font-semibold text-foreground mb-2">Encarregado de Dados (DPO)</h3>
                  <p className="text-sm text-muted-foreground mb-2">
                    Para exercer seus direitos ou esclarecer dúvidas sobre esta política:
                  </p>
                  <div className="space-y-1 text-sm">
                    <p><strong>Email:</strong> vfdiogoseg@gmail.com</p>
                    <p><strong>WhatsApp:</strong> (19) 99723-8298</p>
                    <p><strong>Endereço:</strong> Araras, SP - Brasil</p>
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