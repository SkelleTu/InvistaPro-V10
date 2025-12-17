import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, Shield, FileText, Clock, CheckCircle } from "lucide-react";
import UserProfileModal from "@/components/profile/user-profile-modal";

export default function KYCNotification() {
  const { user } = useAuth();
  const [showProfileModal, setShowProfileModal] = useState(false);

  // Buscar status dos documentos KYC
  const { data: kycStatus } = useQuery({
    queryKey: ["/api/kyc/status"],
    enabled: !!user,
  });

  // Não mostrar notificação se o usuário já está verificado
  if (user?.documentosVerificados) {
    return null;
  }

  // Calcular estatísticas dos documentos
  const requiredDocs = ['rg', 'comprovante'];
  const userDocs = (kycStatus as any)?.documents || [];
  
  const pendingDocs = userDocs.filter((doc: any) => doc.status === 'pendente').length;
  const approvedDocs = userDocs.filter((doc: any) => doc.status === 'aprovado').length;
  const rejectedDocs = userDocs.filter((doc: any) => doc.status === 'rejeitado').length;
  const missingDocs = requiredDocs.length - userDocs.filter((doc: any) => 
    requiredDocs.includes(doc.tipo)
  ).length;

  const totalMissing = missingDocs + rejectedDocs;
  const hasDocuments = userDocs.length > 0;
  const hasRejectedDocs = rejectedDocs > 0;

  // Determinar prioridade da notificação
  let priority: 'urgent' | 'info' = 'info';
  let title = '';
  let description = '';
  let icon = <FileText className="h-4 w-4" />;

  if (!hasDocuments || totalMissing > 0) {
    priority = 'urgent';
    title = '⚠️ Verificação de Documentos Obrigatória';
    description = 'Envie seus documentos para ter acesso completo à plataforma.';
    icon = <AlertTriangle className="h-4 w-4" />;
  } else if (hasRejectedDocs) {
    priority = 'urgent';
    title = '❌ Documentos Rejeitados';
    description = 'Alguns documentos foram rejeitados. Envie novamente conforme as orientações.';
    icon = <AlertTriangle className="h-4 w-4" />;
  } else if (pendingDocs > 0) {
    priority = 'info';
    title = '⏳ Documentos em Análise';
    description = 'Seus documentos estão sendo analisados. Em breve você receberá uma resposta.';
    icon = <Clock className="h-4 w-4" />;
  }

  const getAlertVariant = () => {
    switch (priority) {
      case 'urgent':
        return 'destructive';
      case 'info':
        return 'default';
      default:
        return 'default';
    }
  };

  return (
    <>
      <Card className={`mb-6 ${priority === 'urgent' ? 'border-red-200 bg-red-50' : 'border-blue-200 bg-blue-50'}`}>
        <CardContent className="p-4">
          <Alert variant={getAlertVariant()} className="border-0 bg-transparent p-0">
            <div className="flex items-start space-x-3">
              <div className={`mt-0.5 ${priority === 'urgent' ? 'text-red-600' : 'text-blue-600'}`}>
                {icon}
              </div>
              
              <div className="flex-1">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className={`font-medium ${priority === 'urgent' ? 'text-red-900' : 'text-blue-900'}`}>
                      {title}
                    </h3>
                    <AlertDescription className={`mt-1 ${priority === 'urgent' ? 'text-red-700' : 'text-blue-700'}`}>
                      {description}
                    </AlertDescription>
                  </div>
                  
                  <Button
                    size="sm"
                    onClick={() => setShowProfileModal(true)}
                    className={priority === 'urgent' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}
                  >
                    {totalMissing > 0 ? 'Enviar Documentos' : 'Ver Status'}
                  </Button>
                </div>

                {/* Status dos Documentos */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {missingDocs > 0 && (
                    <Badge variant="outline" className="text-red-700 border-red-200">
                      {missingDocs} documentos faltando
                    </Badge>
                  )}
                  {rejectedDocs > 0 && (
                    <Badge variant="outline" className="text-red-700 border-red-200">
                      {rejectedDocs} rejeitados
                    </Badge>
                  )}
                  {pendingDocs > 0 && (
                    <Badge variant="outline" className="text-yellow-700 border-yellow-200">
                      {pendingDocs} em análise
                    </Badge>
                  )}
                  {approvedDocs > 0 && (
                    <Badge variant="outline" className="text-green-700 border-green-200">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      {approvedDocs} aprovados
                    </Badge>
                  )}
                </div>

                {/* Lista dos Documentos Necessários */}
                <div className="mt-3 text-sm">
                  <p className={`font-medium mb-1 ${priority === 'urgent' ? 'text-red-800' : 'text-blue-800'}`}>
                    Documentos obrigatórios:
                  </p>
                  <ul className={`text-xs space-y-1 ${priority === 'urgent' ? 'text-red-700' : 'text-blue-700'}`}>
                    <li>• RG ou CNH com foto (documento de identidade)</li>
                    <li>• Comprovante de residência (máximo 3 meses)</li>
                  </ul>
                </div>

                {/* Informação adicional para urgentes */}
                {priority === 'urgent' && (
                  <div className="mt-3 p-3 bg-red-100 rounded-lg border border-red-200">
                    <div className="flex items-start space-x-2">
                      <Shield className="h-4 w-4 text-red-600 mt-0.5" />
                      <div className="text-sm">
                        <p className="font-medium text-red-900">Importante:</p>
                        <p className="text-red-700">
                          Para sua segurança e conformidade regulatória, o envio de documentos
                          é obrigatório para acessar todas as funcionalidades da plataforma.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Alert>
        </CardContent>
      </Card>

      {/* Modal do Perfil do Usuário */}
      <UserProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
      />
    </>
  );
}