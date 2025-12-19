import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { 
  Key, 
  Eye, 
  EyeOff, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Save,
  RefreshCw
} from "lucide-react";

interface DerivTokenStatus {
  tokenConfigured: boolean;
  token?: string;
  accountType?: "demo" | "real";
  balance?: number;
  currency?: string;
}

export default function DerivTokenSettings() {
  const { toast } = useToast();
  const [showToken, setShowToken] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [accountType, setAccountType] = useState<"demo" | "real">("demo");
  const [isChangingToken, setIsChangingToken] = useState(false);

  // Fetch current token status
  const { data: tokenStatus, isLoading, refetch } = useQuery<DerivTokenStatus>({
    queryKey: ["/api/trading/deriv-token"],
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // Mutation to save token
  const saveTokenMutation = useMutation({
    mutationFn: async () => {
      if (!tokenInput.trim()) {
        throw new Error("Token é obrigatório");
      }
      
      const response = await apiRequest("/api/trading/deriv-token", {
        method: "POST",
        body: JSON.stringify({
          token: tokenInput.trim(),
          accountType,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Erro ao salvar token");
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Token configurado com sucesso!",
        description: `Conta ${data.accountType} conectada - Saldo: ${data.balance} ${data.currency}`,
        duration: 5000,
      });
      setTokenInput("");
      setIsChangingToken(false);
      queryClient.invalidateQueries({ queryKey: ["/api/trading/deriv-token"] });
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao configurar token",
        description: error.message || "Falha na conexão com Deriv",
        variant: "destructive",
        duration: 5000,
      });
    },
  });

  // Mutation to remove token
  const removeTokenMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("/api/trading/deriv-token", {
        method: "DELETE",
      });
      
      if (!response.ok) {
        throw new Error("Erro ao remover token");
      }
      
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Token removido",
        description: "A configuração Deriv foi limpa.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/trading/deriv-token"] });
    },
    onError: (error: any) => {
      toast({
        title: "Erro ao remover token",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <Card className="border-blue-200 dark:border-blue-900">
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Key className="h-5 w-5 text-blue-500" />
          <span>Configuração da Token Deriv API</span>
        </CardTitle>
        <CardDescription>
          Conecte sua conta Deriv para iniciar operações automatizadas de trading
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Status atual */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-blue-500 mr-2" />
            <span className="text-muted-foreground">Verificando configuração...</span>
          </div>
        ) : tokenStatus?.tokenConfigured ? (
          <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg space-y-3">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
              <span className="font-medium text-green-800 dark:text-green-200">Token Configurado</span>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
              <div>
                <p className="text-xs text-muted-foreground">Token</p>
                <p className="font-mono text-sm font-medium">{tokenStatus.token}</p>
              </div>
              {tokenStatus.accountType && (
                <div>
                  <p className="text-xs text-muted-foreground">Tipo de Conta</p>
                  <Badge variant={tokenStatus.accountType === "demo" ? "secondary" : "default"}>
                    {tokenStatus.accountType === "demo" ? "Demo (Teste)" : "Real"}
                  </Badge>
                </div>
              )}
              {tokenStatus.balance !== undefined && (
                <div>
                  <p className="text-xs text-muted-foreground">Saldo</p>
                  <p className="text-sm font-medium">{tokenStatus.balance} {tokenStatus.currency}</p>
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-4 pt-3 border-t border-green-200 dark:border-green-800">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsChangingToken(!isChangingToken)}
                data-testid="button-change-token"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Alterar Token
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:text-red-700"
                onClick={() => {
                  if (confirm("Tem certeza? Isso vai desconectar sua conta Deriv.")) {
                    removeTokenMutation.mutate();
                  }
                }}
                disabled={removeTokenMutation.isPending}
                data-testid="button-remove-token"
              >
                {removeTokenMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <AlertCircle className="h-4 w-4 mr-2" />
                )}
                Remover Token
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg flex items-start space-x-3">
            <AlertCircle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-yellow-800 dark:text-yellow-200">Nenhum token configurado</p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                Para começar a tradear, configure sua token API da Deriv.
              </p>
            </div>
          </div>
        )}

        {/* Form para adicionar/alterar token */}
        {(!tokenStatus?.tokenConfigured || isChangingToken) && (
          <div className="space-y-4 pt-4 border-t">
            <div className="space-y-2">
              <Label htmlFor="token" className="font-medium">
                Token API Deriv
              </Label>
              <div className="relative">
                <Input
                  id="token"
                  type={showToken ? "text" : "password"}
                  placeholder="a1-abc123def456..."
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  disabled={saveTokenMutation.isPending}
                  className="pr-10"
                  data-testid="input-deriv-token"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  data-testid="button-toggle-show-token"
                >
                  {showToken ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Obtenha sua token em: https://api.deriv.com → API Tokens
              </p>
            </div>

            <div className="space-y-2">
              <Label className="font-medium">Tipo de Conta</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={accountType === "demo" ? "default" : "outline"}
                  onClick={() => setAccountType("demo")}
                  disabled={saveTokenMutation.isPending}
                  data-testid="button-account-demo"
                >
                  Demo (Teste)
                </Button>
                <Button
                  variant={accountType === "real" ? "default" : "outline"}
                  onClick={() => setAccountType("real")}
                  disabled={saveTokenMutation.isPending}
                  data-testid="button-account-real"
                >
                  Real (Vivendo)
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {accountType === "demo" 
                  ? "Use Demo para testar o sistema sem risco" 
                  : "Use Real para operar com sua conta verdadeira"}
              </p>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                Como obter sua token (Passo-a-passo):
              </p>
              <ol className="text-xs text-blue-700 dark:text-blue-300 space-y-1 list-decimal list-inside">
                <li>Acesse https://api.deriv.com</li>
                <li>Faça login com sua conta Deriv</li>
                <li>Clique em "API Tokens" ou "Account" → "API Tokens"</li>
                <li>Clique em "Create new token"</li>
                <li>Selecione a conta (CR para trading real)</li>
                <li>Ative os escopos: <strong>Trade</strong> + <strong>Read</strong></li>
                <li>Copie a token e cole aqui imediatamente (não será mostrada novamente!)</li>
              </ol>
              <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded p-2 mt-2">
                <p className="text-xs text-yellow-800 dark:text-yellow-200">
                  ⚠️ <strong>Escopos Necessários:</strong>
                </p>
                <ul className="text-xs text-yellow-700 dark:text-yellow-300 mt-1 space-y-0.5 list-disc list-inside">
                  <li><strong>Trade</strong> - Executar operações de trading</li>
                  <li><strong>Read</strong> - Ver saldo e dados da conta</li>
                </ul>
              </div>
            </div>

            <Button
              onClick={() => saveTokenMutation.mutate()}
              disabled={saveTokenMutation.isPending || !tokenInput.trim()}
              className="w-full"
              size="lg"
              data-testid="button-save-token"
            >
              {saveTokenMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Conectando...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Salvar e Conectar
                </>
              )}
            </Button>
          </div>
        )}

        {/* Info box */}
        <div className="bg-muted/50 border rounded-lg p-3 space-y-2">
          <p className="text-sm font-medium">Segurança</p>
          <p className="text-xs text-muted-foreground">
            Sua token é criptografada e armazenada de forma segura no servidor. Nunca será compartilhada ou exposta no navegador.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
