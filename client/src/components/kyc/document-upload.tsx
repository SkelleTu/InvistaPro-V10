import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, FileText, AlertTriangle, Shield } from "lucide-react";

export default function DocumentUpload() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [rgFile, setRgFile] = useState<File | null>(null);
  const [comprovanteFile, setComprovanteFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  // Mutation para upload de documentos
  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch('/api/kyc/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Erro no upload');
      }

      return response.json();
    },
    onError: (error: Error) => {
      toast({
        title: "Erro no upload",
        description: error.message,
        variant: "destructive",
      });
    }
  });

  const handleFileChange = (type: 'rg' | 'comprovante', file: File | null) => {
    if (!file) return;

    // Validar tipo de arquivo
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: "Tipo de arquivo inválido",
        description: "Apenas imagens (JPG, PNG) ou PDF são aceitos.",
        variant: "destructive",
      });
      return;
    }

    // Validar tamanho (máximo 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      toast({
        title: "Arquivo muito grande",
        description: "O arquivo deve ter no máximo 10MB.",
        variant: "destructive",
      });
      return;
    }

    if (type === 'rg') {
      setRgFile(file);
    } else {
      setComprovanteFile(file);
    }
  };

  const handleSubmit = async () => {
    if (!rgFile && !comprovanteFile) {
      toast({
        title: "Nenhum arquivo selecionado",
        description: "Selecione pelo menos um documento para enviar.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);

    // Upload documents one by one
    try {
      if (rgFile) {
        const formData = new FormData();
        formData.append('documento', rgFile);
        formData.append('tipo', 'rg');
        await uploadMutation.mutateAsync(formData);
      }
      
      if (comprovanteFile) {
        const formData = new FormData();
        formData.append('documento', comprovanteFile);
        formData.append('tipo', 'comprovante');
        await uploadMutation.mutateAsync(formData);
      }
      
      toast({
        title: "Upload realizado com sucesso!",
        description: "Seus documentos foram enviados e estão em análise.",
        variant: "default",
      });
      
      // Reset files
      setRgFile(null);
      setComprovanteFile(null);
      
      // Refetch KYC status
      queryClient.invalidateQueries({ queryKey: ["/api/kyc/status"] });
      
    } catch (error) {
      // Error handling is already done in the mutation
      console.error("Upload error:", error);
    } finally {
      setUploading(false);
    }
  };

  if (!user) return null;

  return (
    <Card>
      <CardHeader>
        {/* Security Notice for Document Upload */}
        <Alert className="bg-green-50 border-green-200 mb-4">
          <Shield className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800 text-sm">
            <strong>Segurança:</strong> Seus documentos são transmitidos com criptografia SSL e armazenados em servidores seguros. Apenas nossa equipe de compliance terá acesso para verificação.
          </AlertDescription>
        </Alert>
        
        <CardTitle className="flex items-center space-x-2">
          <Upload className="h-5 w-5" />
          <span>Upload de Documentos</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Instruções */}
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Importante:</strong> Certifique-se de que os documentos estejam nítidos, 
            bem iluminados e com todas as informações visíveis. Documentos com má qualidade 
            serão rejeitados.
          </AlertDescription>
        </Alert>

        {/* Upload RG/CNH */}
        <div className="space-y-2">
          <Label htmlFor="rg-upload" className="flex items-center space-x-2">
            <FileText className="h-4 w-4" />
            <span>RG ou CNH (Documento de Identidade)</span>
          </Label>
          <Input
            id="rg-upload"
            type="file"
            accept="image/*,.pdf"
            onChange={(e) => handleFileChange('rg', e.target.files?.[0] || null)}
            disabled={uploading}
            data-testid="input-rg-upload"
          />
          {rgFile && (
            <p className="text-sm text-green-600">
              ✓ {rgFile.name} ({(rgFile.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Formatos aceitos: JPG, PNG, PDF. Máximo 10MB.
          </p>
        </div>

        {/* Upload Comprovante */}
        <div className="space-y-2">
          <Label htmlFor="comprovante-upload" className="flex items-center space-x-2">
            <FileText className="h-4 w-4" />
            <span>Comprovante de Residência</span>
          </Label>
          <Input
            id="comprovante-upload"
            type="file"
            accept="image/*,.pdf"
            onChange={(e) => handleFileChange('comprovante', e.target.files?.[0] || null)}
            disabled={uploading}
            data-testid="input-comprovante-upload"
          />
          {comprovanteFile && (
            <p className="text-sm text-green-600">
              ✓ {comprovanteFile.name} ({(comprovanteFile.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Conta de luz, água, telefone ou extrato bancário (máximo 3 meses).
          </p>
        </div>

        {/* Botão de Upload */}
        <Button
          onClick={handleSubmit}
          disabled={uploading || (!rgFile && !comprovanteFile)}
          className="w-full"
          data-testid="button-upload-documents"
        >
          {uploading ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Enviando...
            </>
          ) : (
            <>
              <Upload className="h-4 w-4 mr-2" />
              Enviar Documentos
            </>
          )}
        </Button>

        {/* Orientações Detalhadas */}
        <div className="bg-muted/50 rounded-lg p-4 space-y-3">
          <h4 className="font-medium">Orientações para o Upload:</h4>
          <div className="space-y-2 text-sm text-muted-foreground">
            <div>
              <strong>RG ou CNH:</strong>
              <ul className="list-disc list-inside ml-2 space-y-1">
                <li>Documento deve estar dentro da validade</li>
                <li>Foto deve estar nítida e visível</li>
                <li>Todos os dados devem estar legíveis</li>
                <li>Se CNH, deve conter o CPF</li>
              </ul>
            </div>
            <div>
              <strong>Comprovante de Residência:</strong>
              <ul className="list-disc list-inside ml-2 space-y-1">
                <li>Máximo 3 meses da data atual</li>
                <li>Deve conter seu nome completo</li>
                <li>Endereço deve ser o mesmo do cadastro</li>
                <li>Aceitos: conta de luz, água, telefone, extrato bancário</li>
              </ul>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}