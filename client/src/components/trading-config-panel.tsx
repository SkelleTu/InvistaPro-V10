import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Clock, Ban, Plus, Trash2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface AssetBlacklist {
  id: string;
  assetPattern: string;
  patternType: 'exact' | 'contains';
  reason?: string;
  isActive: boolean;
}

interface PauseConfig {
  id: string;
  isEnabled: boolean;
  operatingDurationMinutes: number;
  pauseDurationMinSeconds: number;
  pauseDurationMaxSeconds: number;
  useTechnicalAnalysisConsensus: boolean;
  minAIConsensusForPause: number;
  isPausedNow: boolean;
}

export default function TradingConfigPanel() {
  const { toast } = useToast();
  const [newAsset, setNewAsset] = useState("");
  const [assetPattern, setAssetPattern] = useState("contains");

  // Queries
  const { data: blacklists = [] } = useQuery({
    queryKey: ['/api/trading/asset-blacklist'],
    queryFn: () => apiRequest('/api/trading/asset-blacklist').then(r => r.json()),
  });

  const { data: pauseConfig } = useQuery({
    queryKey: ['/api/trading/pause-config'],
    queryFn: () => apiRequest('/api/trading/pause-config').then(r => r.json()),
  });

  // Mutations
  const createBlacklistMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await apiRequest('/api/trading/asset-blacklist', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/trading/asset-blacklist'] });
      setNewAsset("");
      toast({ title: "Ativo bloqueado com sucesso!" });
    },
    onError: () => {
      toast({ title: "Erro ao bloquear ativo", variant: "destructive" });
    },
  });

  const deleteBlacklistMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest(`/api/trading/asset-blacklist/${id}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/trading/asset-blacklist'] });
      toast({ title: "Ativo desbloqueado" });
    },
  });

  const updatePauseConfigMutation = useMutation({
    mutationFn: async (data: Partial<PauseConfig>) => {
      const response = await apiRequest('/api/trading/pause-config', {
        method: 'PUT',
        body: JSON.stringify(data),
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/trading/pause-config'] });
      toast({ title: "Configuração atualizada!" });
    },
  });

  const handleAddAsset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAsset.trim()) return;
    
    createBlacklistMutation.mutate({
      assetPattern: newAsset,
      patternType: assetPattern,
      reason: `Bloqueado - ${assetPattern === 'exact' ? 'Exato' : 'Contém'}: ${newAsset}`,
    });
  };

  return (
    <div className="space-y-6">
      {/* Asset Blacklist */}
      <Card data-testid="card-asset-blacklist">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5" />
            Bloqueio de Ativos
          </CardTitle>
          <CardDescription>
            Bloqueia operações com ativos "Jump" e "(1s)" para evitar losses desnecessárias
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-amber-200 bg-amber-50">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              Padrão recomendado: Bloqueie todos os "Jump" e ativos contendo "(1s)"
            </AlertDescription>
          </Alert>

          <form onSubmit={handleAddAsset} className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Input
                placeholder="Ex: Jump, (1s)"
                value={newAsset}
                onChange={(e) => setNewAsset(e.target.value)}
                data-testid="input-asset-pattern"
              />
              <select
                value={assetPattern}
                onChange={(e) => setAssetPattern(e.target.value)}
                className="px-3 py-2 border rounded-md text-sm"
                data-testid="select-pattern-type"
              >
                <option value="contains">Contém</option>
                <option value="exact">Exato</option>
              </select>
              <Button type="submit" size="sm" data-testid="button-add-asset">
                <Plus className="h-4 w-4 mr-1" /> Bloquear
              </Button>
            </div>
          </form>

          <div className="space-y-2">
            {(blacklists as AssetBlacklist[]).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50"
                data-testid={`blacklist-item-${item.id}`}
              >
                <div>
                  <Badge variant="outline" className="mb-1">
                    {item.patternType === 'contains' ? 'Contém' : 'Exato'}
                  </Badge>
                  <p className="font-mono text-sm">{item.assetPattern}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteBlacklistMutation.mutate(item.id)}
                  data-testid={`button-delete-blacklist-${item.id}`}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
            {blacklists.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Nenhum ativo bloqueado. Recomendamos bloquear "Jump" e "(1s)"
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Pause Configuration */}
      {pauseConfig && (
        <Card data-testid="card-pause-config">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Configuração de Pausas Inteligentes
            </CardTitle>
            <CardDescription>
              Pausas aleatórias com análise técnica para melhorar o desempenho
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="operating-duration" className="text-sm font-medium">
                  Tempo de Operação (minutos)
                </Label>
                <Input
                  id="operating-duration"
                  type="number"
                  min="1"
                  max="120"
                  value={pauseConfig.operatingDurationMinutes}
                  onChange={(e) =>
                    updatePauseConfigMutation.mutate({
                      operatingDurationMinutes: parseInt(e.target.value),
                    })
                  }
                  data-testid="input-operating-duration"
                />
              </div>

              <div>
                <Label htmlFor="pause-duration-min" className="text-sm font-medium">
                  Pausa Mínima (segundos)
                </Label>
                <Input
                  id="pause-duration-min"
                  type="number"
                  min="10"
                  max="600"
                  value={pauseConfig.pauseDurationMinSeconds}
                  onChange={(e) =>
                    updatePauseConfigMutation.mutate({
                      pauseDurationMinSeconds: parseInt(e.target.value),
                    })
                  }
                  data-testid="input-pause-duration-min"
                />
              </div>

              <div>
                <Label htmlFor="pause-duration-max" className="text-sm font-medium">
                  Pausa Máxima (segundos)
                </Label>
                <Input
                  id="pause-duration-max"
                  type="number"
                  min="10"
                  max="600"
                  value={pauseConfig.pauseDurationMaxSeconds}
                  onChange={(e) =>
                    updatePauseConfigMutation.mutate({
                      pauseDurationMaxSeconds: parseInt(e.target.value),
                    })
                  }
                  data-testid="input-pause-duration-max"
                />
              </div>

              <div>
                <Label htmlFor="min-consensus" className="text-sm font-medium">
                  Consenso Mínimo de IAs (%)
                </Label>
                <Input
                  id="min-consensus"
                  type="number"
                  min="0.3"
                  max="1.0"
                  step="0.1"
                  value={pauseConfig.minAIConsensusForPause}
                  onChange={(e) =>
                    updatePauseConfigMutation.mutate({
                      minAIConsensusForPause: parseFloat(e.target.value),
                    })
                  }
                  data-testid="input-min-consensus"
                />
              </div>
            </div>

            <div className="p-4 border rounded-lg bg-blue-50">
              <p className="text-sm font-medium mb-2">Configuração Atual:</p>
              <ul className="text-sm space-y-1 text-gray-700">
                <li>Operação: {pauseConfig.operatingDurationMinutes} minutos</li>
                <li>
                  Pausa: {pauseConfig.pauseDurationMinSeconds}s -{" "}
                  {pauseConfig.pauseDurationMaxSeconds}s
                </li>
                <li>
                  Status: {pauseConfig.isPausedNow ? "EM PAUSA" : "Operando"}
                </li>
                <li>
                  Análise Técnica:{" "}
                  {pauseConfig.useTechnicalAnalysisConsensus ? "Ativa" : "Inativa"}
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
