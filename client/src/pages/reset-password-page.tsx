import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Footer } from "@/components/ui/footer";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff, Shield, CheckCircle } from "lucide-react";
import investmentBgImage from "@assets/generated_images/Dark_investment_chart_background_ac2d4762.png";

export default function ResetPasswordPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [token, setToken] = useState("");
  const [isValidToken, setIsValidToken] = useState(false);

  // Extract token from URL parameters
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenParam = urlParams.get('token');
    
    if (tokenParam) {
      setToken(tokenParam);
      setIsValidToken(true);
    } else {
      toast({
        title: "Token inválido",
        description: "Link de recuperação inválido ou expirado",
        variant: "destructive",
      });
    }
  }, [toast]);

  // Reset password mutation
  const resetPasswordMutation = useMutation({
    mutationFn: async (data: { token: string; newPassword: string }) => {
      const response = await apiRequest("/api/password-recovery/reset", { method: "POST", body: JSON.stringify(data) });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Senha alterada!",
        description: data.message,
      });
      // Redirect to login after 2 seconds
      setTimeout(() => {
        setLocation("/auth");
      }, 2000);
    },
    onError: (error) => {
      toast({
        title: "Erro",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleResetPassword = () => {
    // Validation
    if (!newPassword) {
      toast({
        title: "Senha obrigatória",
        description: "Digite uma nova senha",
        variant: "destructive",
      });
      return;
    }

    if (newPassword.length < 6) {
      toast({
        title: "Senha muito curta",
        description: "A senha deve ter pelo menos 6 caracteres",
        variant: "destructive",
      });
      return;
    }

    if (newPassword !== confirmPassword) {
      toast({
        title: "Senhas não coincidem",
        description: "Digite a mesma senha nos dois campos",
        variant: "destructive",
      });
      return;
    }

    // Submit
    resetPasswordMutation.mutate({
      token,
      newPassword
    });
  };

  if (!isValidToken) {
    return (
      <div className="min-h-screen flex flex-col">
        <div 
          className="flex-1 bg-background flex items-center justify-center p-4 relative"
          style={{
            backgroundImage: `url(${investmentBgImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat'
          }}
        >
          <div className="absolute inset-0 backdrop-blur-md bg-background/30"></div>
          
          <div className="relative z-10 w-full max-w-md">
            <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
              <CardHeader className="text-center">
                <div className="mx-auto mb-4 w-12 h-12 bg-destructive/20 rounded-full flex items-center justify-center">
                  <Shield className="h-6 w-6 text-destructive" />
                </div>
                <CardTitle className="text-xl">Link Inválido</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-center text-muted-foreground mb-4">
                  O link de recuperação de senha é inválido ou expirou.
                </p>
                <Button 
                  onClick={() => setLocation("/auth")}
                  className="w-full"
                >
                  Voltar ao Login
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div 
        className="flex-1 bg-background flex items-center justify-center p-4 relative"
        style={{
          backgroundImage: `url(${investmentBgImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      >
        <div className="absolute inset-0 backdrop-blur-md bg-background/30"></div>
        
        <div className="relative z-10 w-full max-w-md">
          <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
            <CardHeader className="text-center">
              <div className="mx-auto mb-4 w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center">
                <Shield className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-xl">Nova Senha</CardTitle>
              <p className="text-sm text-muted-foreground">
                Digite sua nova senha para acessar sua conta
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">Nova senha</Label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      type={showPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Digite sua nova senha"
                      className="h-12 pr-10"
                      data-testid="input-new-password"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirmar nova senha</Label>
                  <Input
                    id="confirm-password"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Digite novamente a nova senha"
                    className="h-12"
                    data-testid="input-confirm-password"
                  />
                </div>

                <Button 
                  onClick={handleResetPassword}
                  className="w-full h-12" 
                  disabled={resetPasswordMutation.isPending}
                  data-testid="button-reset-password"
                >
                  {resetPasswordMutation.isPending ? "Alterando senha..." : "Alterar senha"}
                </Button>

                <div className="text-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setLocation("/auth")}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Voltar ao login
                  </Button>
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