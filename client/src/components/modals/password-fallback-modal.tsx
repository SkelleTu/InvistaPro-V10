import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, Shield, Lock, Monitor } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface PasswordFallbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function PasswordFallbackModal({ isOpen, onClose, onSuccess }: PasswordFallbackModalProps) {
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [usarSenhaFallback, setUsarSenhaFallback] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (senha.length < 6) {
      toast({
        title: "Senha muito curta",
        description: "A senha deve ter pelo menos 6 caracteres",
        variant: "destructive",
      });
      return;
    }
    
    if (senha !== confirmarSenha) {
      toast({
        title: "Senhas não coincidem",
        description: "Verifique se as senhas são idênticas",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    
    try {
      const response = await fetch('/api/security/setup-password-fallback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          senha,
          usarSenhaFallback,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Erro ao configurar senha');
      }

      toast({
        title: "Senha configurada!",
        description: "Agora você pode usar senha para verificação em PCs",
      });
      
      onSuccess();
      onClose();
    } catch (error: any) {
      toast({
        title: "Erro",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setSenha('');
    setConfirmarSenha('');
    setUsarSenhaFallback(true);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Monitor className="w-5 h-5 text-blue-600" />
            Configurar Senha para PCs
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-blue-600 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-blue-900 mb-1">
                  Para usuários de PC sem biometria
                </p>
                <p className="text-blue-700">
                  Configure uma senha de segurança para usar como alternativa à biometria em computadores.
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="senha" className="flex items-center gap-2">
                <Lock className="w-4 h-4" />
                Senha de Segurança
              </Label>
              <Input
                id="senha"
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                required
                minLength={6}
                className="mt-1"
              />
            </div>

            <div>
              <Label htmlFor="confirmar-senha">
                Confirmar Senha
              </Label>
              <Input
                id="confirmar-senha"
                type="password"
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
                placeholder="Digite a senha novamente"
                required
                className="mt-1"
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-medium">
                  Usar senha como método principal em PCs
                </Label>
                <p className="text-xs text-muted-foreground">
                  Priorizar senha sobre biometria em computadores
                </p>
              </div>
              <Switch
                checked={usarSenhaFallback}
                onCheckedChange={setUsarSenhaFallback}
              />
            </div>

            <div className="flex gap-3 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                className="flex-1"
                disabled={isLoading}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={isLoading || !senha || !confirmarSenha}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Configurando...
                  </>
                ) : (
                  'Configurar Senha'
                )}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}