import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { AlertCircle, Clock, Ban, Plus, Trash2, CheckSquare2, Square } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";

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

interface AvailableAsset {
  symbol: string;
  display_name: string; // Corrigido para bater com a API
  category?: string;
  supportsDigitDiff?: boolean;
}

export default function TradingConfigPanel() {
  const { toast } = useToast();
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  
  // Pause config states
  const [operatingDuration, setOperatingDuration] = useState([15]);
  const [pauseMinDuration, setPauseMinDuration] = useState([60]);
  const [pauseMaxDuration, setPauseMaxDuration] = useState([180]);
  const [minAIConsensus, setMinAIConsensus] = useState([0.7]);

  // Queries
  const { data: availableAssets = [], isLoading: isLoadingAssets } = useQuery({
    queryKey: ['/api/trading/assets', 'digit_diff'],
    queryFn: () => apiRequest('/api/trading/assets?mode=digit_diff&t=' + Date.now()).then(r => r.json()),
  });

  const { data: blockedSymbols = [] } = useQuery({
    queryKey: ['/api/trading/blocked-assets', 'digit_diff'],
    queryFn: () => apiRequest('/api/trading/blocked-assets?mode=digit_diff').then(r => r.json()),
  });

  const { data: blacklists = [] } = useQuery({
    queryKey: ['/api/trading/asset-blacklist'],
    queryFn: () => apiRequest('/api/trading/asset-blacklist').then(r => r.json()),
  });

  const { data: pauseConfig } = useQuery({
    queryKey: ['/api/trading/pause-config'],
    queryFn: () => apiRequest('/api/trading/pause-config').then(r => r.json()),
  });

  // Sincronizar valores iniciais
  useEffect(() => {
    if (pauseConfig) {
      setOperatingDuration([pauseConfig.operatingDurationMinutes]);
      setPauseMinDuration([pauseConfig.pauseDurationMinSeconds]);
      setPauseMaxDuration([pauseConfig.pauseDurationMaxSeconds]);
      setMinAIConsensus([pauseConfig.minAIConsensusForPause]);
    }
  }, [pauseConfig]);

  // Mutations
  const updateBlockedAssetsMutation = useMutation({
    mutationFn: async (symbols: string[]) => {
      await apiRequest('/api/trading/block-assets', {
        method: 'POST',
        body: JSON.stringify({
          tradeMode: 'digit_diff',
          symbols,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/trading/blocked-assets'] });
      setSelectedAssets([]);
      toast({ title: "Lista de bloqueio atualizada!" });
    },
  });

  const bulkBlockAssetsMutation = useMutation({
    mutationFn: async (assets: string[]) => {
      const promises = assets.map(asset =>
        apiRequest('/api/trading/asset-blacklist', {
          method: 'POST',
          body: JSON.stringify({
            assetPattern: asset,
            patternType: 'exact',
            reason: `Bloqueado manualmente - ${asset}`,
          }),
        }).then(r => r.json())
      );
      return Promise.all(promises);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/trading/asset-blacklist'] });
      setSelectedAssets([]);
      toast({ title: "Ativos bloqueados com sucesso!" });
    },
    onError: (error: any) => {
      toast({ 
        title: "Erro ao bloquear ativos", 
        description: error.message,
        variant: "destructive" 
      });
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
      toast({ title: "Configuração de pausas atualizada!" });
    },
  });

  const handleSelectAsset = (symbol: string) => {
    setSelectedAssets(prev =>
      prev.includes(symbol)
        ? prev.filter(s => s !== symbol)
        : [...prev, symbol]
    );
  };

  const handleSelectAll = () => {
    if (selectedAssets.length === (availableAssets as AvailableAsset[]).length) {
      setSelectedAssets([]);
    } else {
      setSelectedAssets((availableAssets as AvailableAsset[]).map(a => a.symbol));
    }
  };

  const handleBlockSelected = () => {
    if (selectedAssets.length === 0) {
      toast({ title: "Selecione pelo menos um ativo" });
      return;
    }
    
    // Pegar o que já está bloqueado e adicionar os novos
    const currentBlocked = (blockedSymbols as string[]) || [];
    const newBlocked = Array.from(new Set([...currentBlocked, ...selectedAssets]));
    updateBlockedAssetsMutation.mutate(newBlocked);
  };

  const handleUnblockAsset = (symbol: string) => {
    const currentBlocked = (blockedSymbols as string[]) || [];
    const newBlocked = currentBlocked.filter((s: string) => s !== symbol);
    updateBlockedAssetsMutation.mutate(newBlocked);
  };

  const isAllSelected = selectedAssets.length === (availableAssets as AvailableAsset[]).length && (availableAssets as AvailableAsset[]).length > 0;

  return (
    <div className="space-y-6">
      {/* Asset Blacklist Multi-Select */}
      <Card data-testid="card-asset-blacklist">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5" />
            Bloqueio de Ativos
          </CardTitle>
          <CardDescription>
            Selecione múltiplos ativos para bloquear de uma vez. Padrão recomendado: todos os "Jump" e "(1s)"
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert className="border-amber-200 bg-amber-50">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              💡 Selecione vários ativos com os checkboxes e clique em "Bloquear Selecionados" para bloqueá-los todos de uma vez!
            </AlertDescription>
          </Alert>

          {/* Lista de Ativos com Checkboxes */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Ativos Disponíveis ({(availableAssets as AvailableAsset[]).length})</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
                data-testid="button-select-all-assets"
              >
                {isAllSelected ? (
                  <>
                    <CheckSquare2 className="h-4 w-4 mr-1" />
                    Desselecionar Todos
                  </>
                ) : (
                  <>
                    <Square className="h-4 w-4 mr-1" />
                    Selecionar Todos
                  </>
                )}
              </Button>
            </div>

            <ScrollArea className="h-96 border rounded-lg p-4 bg-muted/30">
              <div className="space-y-2">
                {isLoadingAssets ? (
                  <div className="flex flex-col items-center justify-center py-10 space-y-3">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    <p className="text-sm text-muted-foreground italic">Conectando à Deriv e buscando ativos...</p>
                  </div>
                ) : (availableAssets as AvailableAsset[]).length > 0 ? (
                  (availableAssets as AvailableAsset[]).map((asset) => {
                    const isBlocked = (blockedSymbols as string[]).includes(asset.symbol);
                    
                    return (
                      <div
                        key={asset.symbol}
                        className={`flex items-center space-x-3 p-2 rounded-lg hover:bg-muted/50 cursor-pointer transition ${
                          isBlocked ? 'opacity-50 bg-red-50' : ''
                        }`}
                        onClick={() => !isBlocked && handleSelectAsset(asset.symbol)}
                        data-testid={`asset-item-${asset.symbol}`}
                      >
                        <Checkbox
                          checked={selectedAssets.includes(asset.symbol)}
                          onCheckedChange={() => handleSelectAsset(asset.symbol)}
                          disabled={isBlocked}
                          data-testid={`checkbox-${asset.symbol}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-semibold text-sm">{asset.symbol}</span>
                            {isBlocked && (
                              <Badge variant="destructive" className="text-xs">
                                Bloqueado
                              </Badge>
                            )}
                            {asset.supportsDigitDiff && (
                              <Badge variant="outline" className="text-xs">
                                ✓ DIGITDIFF
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {asset.display_name} {asset.category ? `• ${asset.category}` : ''}
                          </p>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-center py-10 text-muted-foreground">
                    Nenhum ativo disponível no momento.
                  </div>
                )}
              </div>
            </ScrollArea>

            <div className="flex gap-2">
              <Button
                onClick={handleBlockSelected}
                disabled={selectedAssets.length === 0 || bulkBlockAssetsMutation.isPending}
                className="flex-1"
                data-testid="button-block-selected"
              >
                <Ban className="h-4 w-4 mr-2" />
                Bloquear {selectedAssets.length} Selecionado{selectedAssets.length !== 1 ? 's' : ''}
              </Button>
            </div>
          </div>

          {/* Ativos Bloqueados */}
          {(blockedSymbols as string[]).length > 0 && (
            <div className="space-y-2 pt-4 border-t">
              <Label className="text-sm font-semibold">Ativos Bloqueados ({(blockedSymbols as string[]).length})</Label>
              <div className="flex flex-wrap gap-2">
                {(blockedSymbols as string[]).map((symbol) => (
                  <Badge
                    key={symbol}
                    variant="destructive"
                    className="cursor-pointer group relative"
                    data-testid={`blocked-badge-${symbol}`}
                  >
                    {symbol}
                    <Trash2
                      className="h-3 w-3 ml-1 opacity-0 group-hover:opacity-100 transition cursor-pointer"
                      onClick={() => handleUnblockAsset(symbol)}
                    />
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pause Configuration com Sliders */}
      {pauseConfig && (
        <Card data-testid="card-pause-config">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Configuração de Pausas Inteligentes
            </CardTitle>
            <CardDescription>
              Ajuste manualmente os sliders para configurar duração de operação e pausas aleatórias
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            {/* Operating Duration Slider */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="operating-duration" className="text-base font-medium">
                  ⏱️ Tempo de Operação Contínua
                </Label>
                <Badge variant="default" className="text-lg px-3 py-1">
                  {operatingDuration[0]} min
                </Badge>
              </div>
              <Slider
                id="operating-duration"
                min={1}
                max={120}
                step={1}
                value={operatingDuration}
                onValueChange={(val) => {
                  setOperatingDuration(val);
                  updatePauseConfigMutation.mutate({ operatingDurationMinutes: val[0] });
                }}
                className="w-full"
                data-testid="slider-operating-duration"
              />
              <p className="text-xs text-muted-foreground">
                O sistema operará continuamente por este tempo antes de fazer uma pausa
              </p>
            </div>

            {/* Pause Min Duration Slider */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="pause-min" className="text-base font-medium">
                  ⏸️ Pausa Mínima
                </Label>
                <Badge variant="secondary" className="text-lg px-3 py-1">
                  {pauseMinDuration[0]}s
                </Badge>
              </div>
              <Slider
                id="pause-min"
                min={10}
                max={300}
                step={10}
                value={pauseMinDuration}
                onValueChange={(val) => {
                  setPauseMinDuration(val);
                  updatePauseConfigMutation.mutate({ pauseDurationMinSeconds: val[0] });
                }}
                className="w-full"
                data-testid="slider-pause-min"
              />
              <p className="text-xs text-muted-foreground">
                Duração mínima aleatória de cada pausa (varia entre min e máx)
              </p>
            </div>

            {/* Pause Max Duration Slider */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="pause-max" className="text-base font-medium">
                  ⏸️ Pausa Máxima
                </Label>
                <Badge variant="secondary" className="text-lg px-3 py-1">
                  {pauseMaxDuration[0]}s
                </Badge>
              </div>
              <Slider
                id="pause-max"
                min={10}
                max={600}
                step={10}
                value={pauseMaxDuration}
                onValueChange={(val) => {
                  setPauseMaxDuration(val);
                  updatePauseConfigMutation.mutate({ pauseDurationMaxSeconds: val[0] });
                }}
                className="w-full"
                data-testid="slider-pause-max"
              />
              <p className="text-xs text-muted-foreground">
                Duração máxima aleatória de cada pausa
              </p>
            </div>

            {/* AI Consensus Slider */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="min-consensus" className="text-base font-medium">
                  🤖 Consenso Mínimo de IAs
                </Label>
                <Badge variant="outline" className="text-lg px-3 py-1">
                  {(minAIConsensus[0] * 100).toFixed(0)}%
                </Badge>
              </div>
              <Slider
                id="min-consensus"
                min={0.3}
                max={1.0}
                step={0.05}
                value={minAIConsensus}
                onValueChange={(val) => {
                  setMinAIConsensus(val);
                  updatePauseConfigMutation.mutate({ minAIConsensusForPause: val[0] });
                }}
                className="w-full"
                data-testid="slider-min-consensus"
              />
              <p className="text-xs text-muted-foreground">
                Nível de acordo entre as IAs para ativar a pausa automática (análise técnica)
              </p>
            </div>

            {/* Status Card */}
            <div className="p-4 border-2 border-blue-200 rounded-lg bg-blue-50">
              <p className="text-sm font-bold text-blue-900 mb-3">📊 RESUMO DA CONFIGURAÇÃO ATUAL:</p>
              <ul className="text-sm space-y-2 text-blue-800">
                <li>✅ Operação: <span className="font-mono font-bold">{operatingDuration[0]} minutos</span></li>
                <li>⏸️ Pausa Aleatória: <span className="font-mono font-bold">{pauseMinDuration[0]}s - {pauseMaxDuration[0]}s</span></li>
                <li>🤖 Consenso de IAs: <span className="font-mono font-bold">{(minAIConsensus[0] * 100).toFixed(0)}%</span></li>
                <li>🟢 Status: <span className="font-bold">{pauseConfig.isPausedNow ? '⏸️ EM PAUSA' : '▶️ OPERANDO'}</span></li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
