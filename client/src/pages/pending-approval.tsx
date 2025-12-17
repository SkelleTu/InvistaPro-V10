import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Footer } from "@/components/ui/footer";
import { Clock, User, Shield, Phone, Mail } from "lucide-react";
import investmentBgImage from "@assets/generated_images/Dark_investment_chart_background_ac2d4762.png";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

function PendingApprovalPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("/api/logout", { method: "POST" });
    },
    onSuccess: () => {
      queryClient.clear();
      // Redirecionar para página de login após logout
      window.location.href = '/';
    },
    onError: (error) => {
      toast({
        title: "Erro",
        description: error.message,
        variant: "destructive",
      });
      // Mesmo com erro, redirecionar para segurança
      window.location.href = '/';
    },
  });

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div 
        className="flex-1 bg-gradient-to-br from-primary to-primary/90 flex items-center justify-center p-4 relative"
        style={{
          backgroundImage: `url(${investmentBgImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      >
        {/* Background overlay with blur effect */}
        <div className="absolute inset-0 backdrop-blur-md bg-primary/40 mobile-backdrop-blur mobile-backdrop-enhanced"></div>
        <div className="w-full max-w-2xl relative z-10">
        <Card className="bg-white shadow-2xl">
          <CardHeader className="text-center">
            <div className="w-20 h-20 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Clock className="text-orange-600 h-10 w-10" />
            </div>
            <CardTitle className="text-3xl font-bold text-gray-900 mb-2">
              Conta em Análise
            </CardTitle>
            <p className="text-gray-600 text-lg">
              Sua conta está sendo avaliada pela nossa equipe
            </p>
          </CardHeader>
          
          <CardContent className="space-y-8">
            {/* User Info */}
            <div className="bg-gray-50 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <User className="h-5 w-5 mr-2" />
                Informações da Conta
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Nome:</span>
                  <span className="ml-2 font-medium">{user?.nomeCompleto}</span>
                </div>
                <div>
                  <span className="text-gray-500">Email:</span>
                  <span className="ml-2 font-medium">{user?.email}</span>
                </div>
                <div>
                  <span className="text-gray-500">CPF:</span>
                  <span className="ml-2 font-medium">{user?.cpf}</span>
                </div>
                <div>
                  <span className="text-gray-500">Telefone:</span>
                  <span className="ml-2 font-medium">{user?.telefone}</span>
                </div>
              </div>
            </div>

            {/* Status Checks */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                <Shield className="h-5 w-5 mr-2" />
                Status de Verificação
              </h3>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                      <Phone className="h-4 w-4 text-white" />
                    </div>
                    <span className="text-green-800 font-medium">Telefone Verificado</span>
                  </div>
                  <div className="text-green-600 text-sm font-medium">✓ Concluído</div>
                </div>

                <div className="flex items-center justify-between p-4 bg-green-50 rounded-lg border border-green-200">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center">
                      <Mail className="h-4 w-4 text-white" />
                    </div>
                    <span className="text-green-800 font-medium">Email Verificado</span>
                  </div>
                  <div className="text-green-600 text-sm font-medium">✓ Concluído</div>
                </div>

                <div className="flex items-center justify-between p-4 bg-orange-50 rounded-lg border border-orange-200">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-orange-500 rounded-full flex items-center justify-center">
                      <Shield className="h-4 w-4 text-white" />
                    </div>
                    <span className="text-orange-800 font-medium">Aprovação da Conta</span>
                  </div>
                  <div className="text-orange-600 text-sm font-medium">⏳ Em análise</div>
                </div>
              </div>
            </div>

            {/* Information */}
            <div className="bg-blue-50 rounded-xl p-6 border border-blue-200">
              <h3 className="text-lg font-semibold text-blue-900 mb-3">
                O que acontece agora?
              </h3>
              <ul className="space-y-2 text-blue-800">
                <li className="flex items-start">
                  <span className="text-blue-500 mr-2">•</span>
                  Nossa equipe está verificando suas informações
                </li>
                <li className="flex items-start">
                  <span className="text-blue-500 mr-2">•</span>
                  O processo leva até 2 dias úteis
                </li>
                <li className="flex items-start">
                  <span className="text-blue-500 mr-2">•</span>
                  Você receberá um email quando sua conta for aprovada
                </li>
                <li className="flex items-start">
                  <span className="text-blue-500 mr-2">•</span>
                  Após a aprovação, você poderá fazer depósitos e investir
                </li>
              </ul>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <Button
                onClick={handleLogout}
                disabled={logoutMutation.isPending}
                variant="outline"
                className="flex-1"
              >
                {logoutMutation.isPending ? "Saindo..." : "Sair da Conta"}
              </Button>
              
              <Button
                onClick={() => window.location.reload()}
                className="flex-1 bg-primary hover:bg-primary/90"
              >
                Verificar Status
              </Button>
            </div>

            {/* Support */}
            <div className="text-center pt-4 border-t border-gray-200">
              <p className="text-gray-600 text-sm">
                Dúvidas sobre o processo de aprovação?
              </p>
              <p className="text-primary font-medium text-sm mt-1">
                Entre em contato com nosso suporte
              </p>
            </div>
          </CardContent>
        </Card>
        </div>
      </div>
      
      {/* Footer */}
      <Footer />
    </div>
  );
}

export default PendingApprovalPage;