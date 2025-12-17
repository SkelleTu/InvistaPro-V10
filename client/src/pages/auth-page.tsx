import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Footer } from "@/components/ui/footer";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ChartLine, Shield, Eye, EyeOff, TrendingUp, Cpu, AlertTriangle } from "lucide-react";
import iconImage from "@/assets/investpro-icon.png";
import { registerUserSchema, loginSchema, type RegisterUser, type LoginUser } from "@shared/schema";
import investmentBgImage from "@assets/generated_images/Dark_investment_chart_background_ac2d4762.png";


export default function AuthPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [currentTab, setCurrentTab] = useState("login");
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordRecovery, setShowPasswordRecovery] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState("");

  // Registration form
  const registerForm = useForm<RegisterUser>({
    resolver: zodResolver(registerUserSchema),
  });

  // Login form  
  const loginForm = useForm<LoginUser>({
    resolver: zodResolver(loginSchema),
  });

  // Registration mutation
  const registerMutation = useMutation({
    mutationFn: async (data: RegisterUser) => {
      const response = await apiRequest("/api/register", { method: "POST", body: JSON.stringify(data) });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Conta criada!",
        description: data.message,
      });
      // Reset form
      registerForm.reset();
      setCurrentTab("login");
    },
    onError: (error: any) => {
      console.error("Register error:", error);
      
      let errorMessage = "Erro interno do servidor";
      let errorTitle = "Erro no cadastro";

      // Handle different error types
      if (error.errors && Array.isArray(error.errors)) {
        // Multiple validation errors
        errorMessage = error.errors.join(", ");
        errorTitle = "Dados inválidos";
      } else if (error.message) {
        errorMessage = error.message;
        // Customize title based on error type
        if (error.message.includes("CPF")) {
          errorTitle = "CPF inválido";
        } else if (error.message.includes("email")) {
          errorTitle = "Email inválido";
        }
      }

      toast({
        title: errorTitle,
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: async (data: LoginUser) => {
      const response = await apiRequest("/api/login", { method: "POST", body: JSON.stringify(data) });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Login realizado!",
        description: "Bem-vindo de volta!",
      });
      // Invalidate auth query and redirect to home
      queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
      setLocation("/");
    },
    onError: (error) => {
      toast({
        title: "Erro no login",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Password recovery mutation
  const passwordRecoveryMutation = useMutation({
    mutationFn: async (email: string) => {
      const response = await apiRequest("/api/password-recovery/request", { method: "POST", body: JSON.stringify({ email }) });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Email enviado!",
        description: data.message,
      });
    },
    onError: (error) => {
      toast({
        title: "Erro",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onRegisterSubmit = (data: RegisterUser) => {
    registerMutation.mutate(data);
  };

  const onLoginSubmit = (data: LoginUser) => {
    loginMutation.mutate(data);
  };

  const handlePasswordRecovery = () => {
    if (!recoveryEmail) {
      toast({
        title: "Email obrigatório",
        description: "Digite seu email para recuperar a senha",
        variant: "destructive",
      });
      return;
    }
    passwordRecoveryMutation.mutate(recoveryEmail);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <div 
        className="flex-1 bg-background flex items-center justify-center p-2 sm:p-4 relative"
        style={{
          backgroundImage: `url(${investmentBgImage})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      >
        {/* Background overlay with blur effect */}
        <div className="absolute inset-0 backdrop-blur-md bg-background/30 mobile-backdrop-blur mobile-backdrop-enhanced"></div>
        
        <div className="w-full max-w-sm sm:max-w-md lg:max-w-4xl relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8 items-center">
          {/* Left side - Hero */}
          <div className="text-foreground space-y-8">
            <div className="text-center lg:text-left">
              <img 
                src={iconImage} 
                alt="InvistaPRO Logo" 
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl mx-auto lg:mx-0 mb-4 sm:mb-6 shadow-lg relative z-0"
              />
              <div className="text-center lg:text-left mb-2 sm:mb-4">
                <h1 className="text-2xl sm:text-3xl lg:text-5xl font-bold mb-1">InvistaPRO</h1>
                <p className="text-sm sm:text-base font-medium text-muted-foreground tracking-wide opacity-80">
                  Invista com <span className="font-bold text-foreground">Risco Zero</span>
                </p>
              </div>
              <p className="text-sm sm:text-xl text-muted-foreground mb-4 sm:mb-8">
                Sua plataforma profissional de investimentos
              </p>
            </div>

            {/* AI Technology Card - Desktop Only */}
            <Card className="bg-gradient-to-br from-indigo-500/10 to-purple-600/10 border-indigo-400/30 backdrop-blur-sm mb-6 hidden lg:block">
              <CardContent className="p-4">
                <div className="flex items-center space-x-3 mb-2">
                  <div className="w-8 h-8 bg-gradient-to-br from-indigo-400 to-purple-600 rounded-lg flex items-center justify-center">
                    <Cpu className="h-4 w-4 text-white" />
                  </div>
                  <h3 className="font-semibold text-foreground">Algoritmos Inteligentes</h3>
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Nossa plataforma utiliza Inteligência Artificial avançada para automatizar completamente todo o processo de investimento, otimizando seus rendimentos 24/7.
                </p>
              </CardContent>
            </Card>

            <div className="space-y-3 sm:space-y-4 hidden lg:block">
              <div className="flex items-center space-x-4">
                <div className="w-10 h-10 bg-accent/50 rounded-lg flex items-center justify-center">
                  <Shield className="h-5 w-5 text-foreground" />
                </div>
                <div>
                  <h3 className="font-medium">Segurança Bancária</h3>
                  <p className="text-muted-foreground text-sm">Criptografia de ponta e validação rigorosa</p>
                </div>
              </div>
              
              <div className="flex items-center space-x-4">
                <div className="w-10 h-10 bg-accent/50 rounded-lg flex items-center justify-center">
                  <ChartLine className="h-5 w-5 text-foreground" />
                </div>
                <div>
                  <h3 className="font-medium">Rendimento Garantido</h3>
                  <p className="text-muted-foreground text-sm">Rendendo 130% com os lucros dos melhores bancos do Brasil</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right side - Auth Forms */}
          <Card className="bg-card border-border shadow-2xl w-full">
            <CardContent className="p-4 sm:p-6 lg:p-8">
              <Tabs value={currentTab} onValueChange={setCurrentTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-4 sm:mb-8">
                  <TabsTrigger value="login">Entrar</TabsTrigger>
                  <TabsTrigger value="register">Cadastrar</TabsTrigger>
                </TabsList>

                <TabsContent value="login" className="space-y-4 sm:space-y-6">
                  <div className="text-center mb-4 sm:mb-6">
                    <h2 className="text-lg sm:text-2xl font-bold text-card-foreground">Bem-vindo de volta</h2>
                    <p className="text-sm sm:text-base text-muted-foreground">Entre na sua conta InvistaPRO</p>
                  </div>

                  {/* Security Alert for Login */}
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
                    <div className="flex items-center space-x-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <p className="text-amber-800 text-xs font-medium">
                        🔒 NUNCA compartilhe sua senha com terceiros. Nossa equipe JAMAIS solicitará suas credenciais.
                      </p>
                    </div>
                  </div>

                  <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-3 sm:space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="login-email">Email</Label>
                      <Input
                        id="login-email"
                        type="email"
                        {...loginForm.register("email")}
                        placeholder="seu@email.com"
                        className="h-10 sm:h-12"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="login-password">Senha</Label>
                      <div className="relative">
                        <Input
                          id="login-password"
                          type={showPassword ? "text" : "password"}
                          {...loginForm.register("password")}
                          placeholder="Sua senha"
                          className="h-10 sm:h-12 pr-10"
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

                    <Button 
                      type="submit" 
                      className="w-full h-10 sm:h-12" 
                      disabled={loginMutation.isPending}
                    >
                      {loginMutation.isPending ? "Entrando..." : "Entrar"}
                    </Button>

                    <div className="text-center mt-3">
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-sm text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPasswordRecovery(!showPasswordRecovery)}
                      >
                        Esqueci minha senha
                      </Button>
                    </div>

                    {/* Password Recovery Form */}
                    {showPasswordRecovery && (
                      <div className="mt-4 p-4 bg-muted/30 rounded-lg border">
                        <h3 className="text-sm font-medium mb-3">Recuperar senha</h3>
                        <div className="space-y-3">
                          <Input
                            type="email"
                            placeholder="Digite seu email cadastrado"
                            value={recoveryEmail}
                            onChange={(e) => setRecoveryEmail(e.target.value)}
                            className="h-10"
                          />
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              size="sm"
                              onClick={handlePasswordRecovery}
                              disabled={passwordRecoveryMutation.isPending}
                              className="flex-1"
                            >
                              {passwordRecoveryMutation.isPending ? "Enviando..." : "Enviar link"}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setShowPasswordRecovery(false);
                                setRecoveryEmail("");
                              }}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </form>
                </TabsContent>

                <TabsContent value="register" className="space-y-3 sm:space-y-4">
                  <div className="text-center mb-4 sm:mb-6">
                    <h2 className="text-lg sm:text-2xl font-bold text-card-foreground">Criar conta</h2>
                    <p className="text-sm sm:text-base text-muted-foreground">Comece a investir hoje mesmo</p>
                  </div>

                  {/* AI Technology Card - Mobile Only */}
                  <Card className="bg-gradient-to-br from-indigo-500/10 to-purple-600/10 border-indigo-400/30 backdrop-blur-sm mb-4 lg:hidden">
                    <CardContent className="p-3">
                      <div className="flex items-center space-x-2 mb-2">
                        <div className="w-6 h-6 bg-gradient-to-br from-indigo-400 to-purple-600 rounded-lg flex items-center justify-center">
                          <Cpu className="h-3 w-3 text-white" />
                        </div>
                        <h3 className="font-semibold text-card-foreground text-sm">IA Avançada</h3>
                      </div>
                      <p className="text-muted-foreground text-xs leading-relaxed">
                        Algoritmos inteligentes automatizam todo processo para otimizar seus rendimentos 24/7.
                      </p>
                    </CardContent>
                  </Card>

                  {/* Privacy Notice - Mobile Only */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 lg:hidden">
                    <p className="text-blue-800 text-xs">
                      🛡️ Seus dados são protegidos com criptografia bancária. Política de Privacidade em conformidade com LGPD.
                    </p>
                  </div>

                  <form onSubmit={registerForm.handleSubmit(onRegisterSubmit)} className="space-y-3 sm:space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="register-name">Nome Completo</Label>
                        <Input
                          id="register-name"
                          {...registerForm.register("nomeCompleto")}
                          placeholder="Seu nome completo"
                          className="h-10 sm:h-12"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="register-cpf">CPF</Label>
                        <Input
                          id="register-cpf"
                          {...registerForm.register("cpf")}
                          placeholder="000.000.000-00"
                          className="h-10 sm:h-12"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="register-email">Email</Label>
                      <Input
                        id="register-email"
                        type="email"
                        {...registerForm.register("email")}
                        placeholder="seu@email.com"
                        className="h-10 sm:h-12"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="register-phone">Telefone</Label>
                      <Input
                        id="register-phone"
                        {...registerForm.register("telefone")}
                        placeholder="(11) 99999-9999"
                        className="h-10 sm:h-12"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="register-password">Senha</Label>
                        <Input
                          id="register-password"
                          type="password"
                          {...registerForm.register("password")}
                          placeholder="Mínimo 6 caracteres"
                          className="h-10 sm:h-12"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="register-confirm-password">Confirmar Senha</Label>
                        <Input
                          id="register-confirm-password"
                          type="password"
                          {...registerForm.register("confirmPassword")}
                          placeholder="Confirme sua senha"
                          className="h-10 sm:h-12"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="register-address">Endereço</Label>
                      <Input
                        id="register-address"
                        {...registerForm.register("endereco")}
                        placeholder="Rua, número, bairro"
                        className="h-10 sm:h-12"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="register-city">Cidade</Label>
                        <Input
                          id="register-city"
                          {...registerForm.register("cidade")}
                          placeholder="São Paulo"
                          className="h-10 sm:h-12"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="register-state">Estado</Label>
                        <Select onValueChange={(value) => registerForm.setValue("estado", value)}>
                          <SelectTrigger className="h-10 sm:h-12">
                            <SelectValue placeholder="SP" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="SP">SP</SelectItem>
                            <SelectItem value="RJ">RJ</SelectItem>
                            <SelectItem value="MG">MG</SelectItem>
                            <SelectItem value="RS">RS</SelectItem>
                            <SelectItem value="PR">PR</SelectItem>
                            <SelectItem value="SC">SC</SelectItem>
                            <SelectItem value="BA">BA</SelectItem>
                            <SelectItem value="GO">GO</SelectItem>
                            <SelectItem value="PE">PE</SelectItem>
                            <SelectItem value="CE">CE</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="register-cep">CEP</Label>
                        <Input
                          id="register-cep"
                          {...registerForm.register("cep")}
                          placeholder="00000-000"
                          className="h-10 sm:h-12"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs text-muted-foreground mb-2 p-2 bg-accent/20 rounded border">
                        Obs. A conta bancária da Chave deve ser do titular da Conta do Usuário
                      </div>
                      <Label htmlFor="register-pix">Chave Pix (Será usado para saque seus rendimentos)</Label>
                      <Input
                        id="register-pix"
                        {...registerForm.register("chavePix")}
                        placeholder="Sua chave PIX (CPF, email, telefone ou chave aleatória)"
                        className="h-10 sm:h-12"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="register-pix-type">Tipo da Chave PIX</Label>
                      <Select onValueChange={(value) => registerForm.setValue("tipoChavePix", value)}>
                        <SelectTrigger className="h-10 sm:h-12">
                          <SelectValue placeholder="Selecione o tipo" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cpf">CPF</SelectItem>
                          <SelectItem value="email">Email</SelectItem>
                          <SelectItem value="telefone">Telefone</SelectItem>
                          <SelectItem value="chave_aleatoria">Chave Aleatória</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <Button 
                      type="submit" 
                      className="w-full h-10 sm:h-12" 
                      disabled={registerMutation.isPending}
                    >
                      {registerMutation.isPending ? "Criando conta..." : "Criar conta"}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
        </div>
      </div>
      
      {/* Footer */}
      <Footer />
    </div>
  );
}