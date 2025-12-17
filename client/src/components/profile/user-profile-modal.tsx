import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { User, FileText, CheckCircle, Clock, AlertTriangle, Shield } from "lucide-react";
import DocumentUpload from "@/components/kyc/document-upload";

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function UserProfileModal({ isOpen, onClose }: UserProfileModalProps) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"profile" | "kyc">("profile");

  // Buscar status dos documentos KYC
  const { data: kycStatus } = useQuery({
    queryKey: ["/api/kyc/status"],
    enabled: !!user && isOpen,
  });

  if (!user) return null;

  const userDocs = (kycStatus as any)?.documents || [];
  
  // Estatísticas dos documentos
  const requiredDocs = ['rg', 'comprovante'];
  const pendingDocs = userDocs.filter((doc: any) => doc.status === 'pendente');
  const approvedDocs = userDocs.filter((doc: any) => doc.status === 'aprovado');
  const rejectedDocs = userDocs.filter((doc: any) => doc.status === 'rejeitado');
  
  const getDocumentStatus = (tipo: string) => {
    const doc = userDocs.find((d: any) => d.tipo === tipo);
    if (!doc) return 'missing';
    return doc.status;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'aprovado':
        return (
          <Badge variant="outline" className="text-green-700 border-green-200">
            <CheckCircle className="h-3 w-3 mr-1" />
            Aprovado
          </Badge>
        );
      case 'pendente':
        return (
          <Badge variant="outline" className="text-yellow-700 border-yellow-200">
            <Clock className="h-3 w-3 mr-1" />
            Em análise
          </Badge>
        );
      case 'rejeitado':
        return (
          <Badge variant="outline" className="text-red-700 border-red-200">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Rejeitado
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-gray-700 border-gray-200">
            <FileText className="h-3 w-3 mr-1" />
            Pendente
          </Badge>
        );
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <User className="h-5 w-5" />
            <span>Perfil do Usuário</span>
          </DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex space-x-1 bg-muted rounded-lg p-1">
          <Button
            variant={activeTab === "profile" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("profile")}
            className="flex-1"
          >
            Dados Pessoais
          </Button>
          <Button
            variant={activeTab === "kyc" ? "default" : "ghost"}
            size="sm"
            onClick={() => setActiveTab("kyc")}
            className="flex-1"
          >
            Documentos KYC
          </Button>
        </div>

        {activeTab === "profile" && (
          <div className="space-y-4">
            {/* Privacy Notice */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <div className="flex items-center space-x-2 mb-2">
                <Shield className="h-4 w-4 text-blue-600" />
                <h4 className="font-medium text-blue-800">Seus Dados Estão Protegidos</h4>
              </div>
              <p className="text-blue-700 text-sm">
                Todas as informações pessoais são criptografadas e armazenadas com segurança bancária. Nunca compartilhamos seus dados com terceiros.
              </p>
            </div>

            {/* Informações Pessoais */}
            <div>
              <h3 className="text-lg font-medium mb-3">Informações Pessoais</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <label className="font-medium text-muted-foreground">Nome Completo</label>
                  <p>{user.nomeCompleto}</p>
                </div>
                <div>
                  <label className="font-medium text-muted-foreground">Email</label>
                  <p>{user.email}</p>
                </div>
                <div>
                  <label className="font-medium text-muted-foreground">CPF</label>
                  <p>{user.cpf}</p>
                </div>
                <div>
                  <label className="font-medium text-muted-foreground">Telefone</label>
                  <p>{user.telefone}</p>
                </div>
              </div>
            </div>

            <Separator />

            {/* Endereço */}
            <div>
              <h3 className="text-lg font-medium mb-3">Endereço</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="col-span-2">
                  <label className="font-medium text-muted-foreground">Endereço</label>
                  <p>{user.endereco}</p>
                </div>
                <div>
                  <label className="font-medium text-muted-foreground">Cidade</label>
                  <p>{user.cidade}</p>
                </div>
                <div>
                  <label className="font-medium text-muted-foreground">Estado</label>
                  <p>{user.estado}</p>
                </div>
                <div>
                  <label className="font-medium text-muted-foreground">CEP</label>
                  <p>{user.cep}</p>
                </div>
              </div>
            </div>

            <Separator />

            {/* PIX */}
            <div>
              <h3 className="text-lg font-medium mb-3">Chave PIX</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <label className="font-medium text-muted-foreground">Chave PIX</label>
                  <p>{user.chavePix}</p>
                </div>
                <div>
                  <label className="font-medium text-muted-foreground">Tipo de Chave</label>
                  <p className="capitalize">{user.tipoChavePix}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "kyc" && (
          <div className="space-y-4">
            {/* Status de Verificação */}
            <div className="bg-muted/50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-medium">Status de Verificação</h3>
                <Badge
                  variant={user.documentosVerificados ? "default" : "secondary"}
                  className={user.documentosVerificados ? "bg-green-100 text-green-800" : ""}
                >
                  {user.documentosVerificados ? "Verificado" : "Pendente"}
                </Badge>
              </div>
              
              <div className="grid grid-cols-3 gap-4 text-center text-sm">
                <div>
                  <div className="text-2xl font-bold text-green-600">{approvedDocs.length}</div>
                  <div className="text-muted-foreground">Aprovados</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-yellow-600">{pendingDocs.length}</div>
                  <div className="text-muted-foreground">Em Análise</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-red-600">{rejectedDocs.length}</div>
                  <div className="text-muted-foreground">Rejeitados</div>
                </div>
              </div>
            </div>

            {/* Lista de Documentos */}
            <div>
              <h3 className="text-lg font-medium mb-3">Documentos Obrigatórios</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center space-x-3">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium">RG ou CNH</p>
                      <p className="text-sm text-muted-foreground">
                        Documento de identidade com foto
                      </p>
                    </div>
                  </div>
                  {getStatusBadge(getDocumentStatus('rg'))}
                </div>

                <div className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center space-x-3">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Comprovante de Residência</p>
                      <p className="text-sm text-muted-foreground">
                        Máximo 3 meses (conta de luz, água, etc.)
                      </p>
                    </div>
                  </div>
                  {getStatusBadge(getDocumentStatus('comprovante'))}
                </div>
              </div>
            </div>

            {/* Upload de Documentos */}
            <DocumentUpload />

            {/* Documentos Rejeitados */}
            {rejectedDocs.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <h4 className="font-medium text-red-900 mb-2">
                  Documentos Rejeitados
                </h4>
                {rejectedDocs.map((doc: any) => (
                  <div key={doc.id} className="text-sm text-red-700">
                    <p><strong>{doc.tipo === 'rg' ? 'RG/CNH' : 'Comprovante'}:</strong> {doc.motivoRejeicao}</p>
                  </div>
                ))}
                <p className="text-sm text-red-700 mt-2">
                  Por favor, envie novos documentos seguindo as orientações.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end mt-6">
          <Button onClick={onClose}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}