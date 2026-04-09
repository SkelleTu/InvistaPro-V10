import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Zap, Activity, DollarSign, Layers, Brain, Settings,
  CheckCircle2, AlertCircle, Loader2, RefreshCw, PlayCircle,
  Circle, TrendingUp, TrendingDown, BarChart2, Target, Flame,
  ChevronDown, ChevronUp, Copy, Cpu, Wifi, WifiOff, Clock,
  Hash, Radio, Percent, XCircle
} from "lucide-react";

interface ModuleSlotConfig {
  slotIndex: number;
  enabled: boolean;
  stakeMode: 'ai' | 'fixed' | 'manual';
  fixedStake: number;
}

interface SlotOverview {
  slotIndex: number;
  hasToken: boolean;
  accountType: string | null;
  balance: number | null;
  currency: string;
  activeModalities: string[];
  isActive: boolean;
  stats: { wins: number; losses: number; totalPnl: number };
}

interface ModuleOverview {
  overview: SlotOverview[];
  configuredCount: number;
}

interface ModalityConfig {
  modality: string;
  slotConfigs: string;
}

interface RajadaCondition {
  ready: boolean;
  score: number;
  reason: string;
  details: Record<string, any>;
}

interface RajadaResult {
  success: boolean;
  totalModules: number;
  succeeded: number;
  failed: number;
  results: Array<{ slotIndex: number; status: string; stakeUsed: number; contractId: string | null }>;
}

const MODALITIES = [
  { id: "digit_matches", name: "Digit Matches", category: "Dígitos", color: "blue" },
  { id: "digit_differs", name: "Digit Differs", category: "Dígitos", color: "blue" },
  { id: "digit_over", name: "Digit Over", category: "Dígitos", color: "blue" },
  { id: "digit_under", name: "Digit Under", category: "Dígitos", color: "blue" },
  { id: "digit_even", name: "Digit Even", category: "Dígitos", color: "blue" },
  { id: "digit_odd", name: "Digit Odd", category: "Dígitos", color: "blue" },
  { id: "rise", name: "Rise (Alta)", category: "Altas & Baixas", color: "emerald" },
  { id: "fall", name: "Fall (Baixa)", category: "Altas & Baixas", color: "emerald" },
  { id: "higher", name: "Higher", category: "Altas & Baixas", color: "emerald" },
  { id: "lower", name: "Lower", category: "Altas & Baixas", color: "emerald" },
  { id: "touch", name: "Touch", category: "Touch/No Touch", color: "purple" },
  { id: "no_touch", name: "No Touch", category: "Touch/No Touch", color: "purple" },
  { id: "end_between", name: "End Between", category: "In/Out", color: "orange" },
  { id: "end_outside", name: "End Outside", category: "In/Out", color: "orange" },
  { id: "stays_between", name: "Stays Between", category: "In/Out", color: "orange" },
  { id: "goes_outside", name: "Goes Outside", category: "In/Out", color: "orange" },
  { id: "accumulator", name: "Acumulador", category: "Acumuladores", color: "yellow" },
  { id: "multiplier", name: "Multiplicador", category: "Multiplicadores", color: "red" },
  { id: "vanilla_call", name: "Vanilla Call", category: "Vanilla", color: "violet" },
  { id: "vanilla_put", name: "Vanilla Put", category: "Vanilla", color: "violet" },
];

const SLOT_COLORS = [
  "border-violet-500/50 bg-violet-500/5",
  "border-blue-500/50 bg-blue-500/5",
  "border-cyan-500/50 bg-cyan-500/5",
  "border-teal-500/50 bg-teal-500/5",
  "border-green-500/50 bg-green-500/5",
  "border-yellow-500/50 bg-yellow-500/5",
  "border-orange-500/50 bg-orange-500/5",
  "border-red-500/50 bg-red-500/5",
  "border-pink-500/50 bg-pink-500/5",
  "border-rose-500/50 bg-rose-500/5",
];

const STAKE_MODE_LABELS = {
  ai: { label: "IA Decide", icon: Brain, color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/30" },
  fixed: { label: "Fixo", icon: Target, color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/30" },
  manual: { label: "Manual", icon: Settings, color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/30" },
};

function SlotCard({ slot }: { slot: SlotOverview }) {
  const colorClass = SLOT_COLORS[slot.slotIndex] || SLOT_COLORS[0];
  const isConfigured = slot.hasToken;
  const isActive = slot.isActive;

  return (
    <div className={`border rounded-xl p-3 transition-all ${colorClass} ${!isConfigured ? 'opacity-50' : ''}`}
      data-testid={`slot-card-${slot.slotIndex}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border ${isActive ? 'bg-green-500/20 border-green-500/50 text-green-300' : isConfigured ? 'bg-muted border-border text-muted-foreground' : 'bg-muted/50 border-border/50 text-muted-foreground/50'}`}>
            {slot.slotIndex}
          </div>
          {isConfigured ? (
            <Wifi className="w-3 h-3 text-green-400" />
          ) : (
            <WifiOff className="w-3 h-3 text-muted-foreground/50" />
          )}
        </div>
        <div className="flex items-center gap-1">
          {isConfigured && (
            <Badge variant="outline" className={`text-[10px] py-0 px-1 ${slot.accountType === 'real' ? 'border-orange-500/40 text-orange-300' : 'border-blue-500/40 text-blue-300'}`}>
              {slot.accountType === 'real' ? 'REAL' : 'DEMO'}
            </Badge>
          )}
        </div>
      </div>

      {isConfigured ? (
        <>
          <div className="flex items-center gap-1 mb-1">
            <DollarSign className="w-3 h-3 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">
              {slot.balance !== null ? `${slot.currency} ${slot.balance.toFixed(2)}` : '—'}
            </span>
          </div>
          {isActive ? (
            <div className="flex flex-wrap gap-1 mt-1">
              {slot.activeModalities.slice(0, 2).map(m => (
                <Badge key={m} variant="secondary" className="text-[9px] py-0 px-1">
                  {MODALITIES.find(mod => mod.id === m)?.name || m}
                </Badge>
              ))}
              {slot.activeModalities.length > 2 && (
                <Badge variant="secondary" className="text-[9px] py-0 px-1">
                  +{slot.activeModalities.length - 2}
                </Badge>
              )}
            </div>
          ) : (
            <p className="text-[10px] text-muted-foreground">Nenhuma modalidade</p>
          )}
        </>
      ) : (
        <p className="text-[10px] text-muted-foreground mt-1">Token não configurado</p>
      )}
    </div>
  );
}

interface ModalityModuleCardProps {
  modality: typeof MODALITIES[0];
  slots: SlotOverview[];
  config: ModuleSlotConfig[];
  onSave: (modality: string, configs: ModuleSlotConfig[]) => void;
  isSaving: boolean;
}

function ModalityModuleCard({ modality, slots, config, onSave, isSaving }: ModalityModuleCardProps) {
  const { toast } = useToast();
  const [localConfig, setLocalConfig] = useState<ModuleSlotConfig[]>(() => {
    if (config.length > 0) return config;
    return Array.from({ length: 10 }, (_, i) => ({
      slotIndex: i,
      enabled: false,
      stakeMode: 'ai' as const,
      fixedStake: 0.35,
    }));
  });
  const [expanded, setExpanded] = useState(false);
  const [rajadaResult, setRajadaResult] = useState<RajadaResult | null>(null);

  const enabledCount = localConfig.filter(c => c.enabled).length;

  const { data: conditions, isLoading: conditionsLoading, refetch: refetchConditions } = useQuery<RajadaCondition>({
    queryKey: ['/api/trading/module-configs', modality.id, 'rajada-conditions'],
    queryFn: () => apiRequest(`/api/trading/module-configs/${modality.id}/rajada-conditions`).then(r => r.json()),
    refetchInterval: 15000,
    enabled: expanded && enabledCount > 0,
  });

  const rajadaMutation = useMutation({
    mutationFn: () => apiRequest(`/api/trading/module-configs/${modality.id}/rajada`, { method: 'POST' }),
    onSuccess: (data: any) => {
      setRajadaResult(data);
      toast({
        title: `⚡ Rajada disparada — ${modality.name}`,
        description: `${data.succeeded}/${data.totalModules} módulos executados com sucesso`,
      });
    },
    onError: (e: any) => {
      toast({ title: 'Erro na Rajada', description: e?.message || 'Falha ao disparar', variant: 'destructive' });
    },
  });

  const toggleSlot = (slotIndex: number) => {
    setLocalConfig(prev => prev.map(c =>
      c.slotIndex === slotIndex ? { ...c, enabled: !c.enabled } : c
    ));
  };

  const setStakeMode = (slotIndex: number, mode: 'ai' | 'fixed' | 'manual') => {
    setLocalConfig(prev => prev.map(c =>
      c.slotIndex === slotIndex ? { ...c, stakeMode: mode } : c
    ));
  };

  const setFixedStake = (slotIndex: number, value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    setLocalConfig(prev => prev.map(c =>
      c.slotIndex === slotIndex ? { ...c, fixedStake: Math.max(0.35, num) } : c
    ));
  };

  const handleSave = () => {
    onSave(modality.id, localConfig);
  };

  const scoreColor = conditions?.score
    ? conditions.score >= 70 ? 'text-green-400' : conditions.score >= 50 ? 'text-yellow-400' : 'text-red-400'
    : 'text-muted-foreground';

  return (
    <Card className="border-border/50 overflow-hidden">
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(e => !e)}
        data-testid={`modality-module-header-${modality.id}`}
      >
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${enabledCount > 0 ? 'bg-green-400 animate-pulse' : 'bg-muted-foreground/30'}`} />
          <div>
            <h3 className="font-semibold text-sm">{modality.name}</h3>
            <p className="text-[11px] text-muted-foreground">{modality.category}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {enabledCount > 0 && (
            <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-xs">
              {enabledCount} módulo{enabledCount !== 1 ? 's' : ''}
            </Badge>
          )}
          {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border/50 p-4 space-y-4">
          {/* Condições de Rajada */}
          {enabledCount > 0 && (
            <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold flex items-center gap-1.5">
                  <Radio className="w-3 h-3 text-blue-400" />
                  Condições de Mercado
                </span>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => refetchConditions()}>
                  <RefreshCw className="w-3 h-3" />
                </Button>
              </div>
              {conditionsLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Analisando...
                </div>
              ) : conditions ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{conditions.reason}</span>
                    <span className={`text-sm font-bold ${scoreColor}`}>{conditions.score}/100</span>
                  </div>
                  <Progress value={conditions.score} className="h-1.5" />
                  <div className="flex items-center gap-1.5 mt-1">
                    {conditions.ready ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                    ) : (
                      <Clock className="w-3.5 h-3.5 text-yellow-400" />
                    )}
                    <span className={`text-xs font-medium ${conditions.ready ? 'text-green-400' : 'text-yellow-400'}`}>
                      {conditions.ready ? 'Momento favorável para Rajada' : 'Aguardando condições ideais'}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* Slots Grid */}
          <div>
            <Label className="text-xs font-semibold text-muted-foreground mb-2 block">Módulos participantes</Label>
            <div className="space-y-2">
              {Array.from({ length: 10 }, (_, i) => {
                const slot = slots[i];
                const slotConf = localConfig.find(c => c.slotIndex === i) || { slotIndex: i, enabled: false, stakeMode: 'ai' as const, fixedStake: 0.35 };
                const hasToken = slot?.hasToken;
                const ModeIcon = STAKE_MODE_LABELS[slotConf.stakeMode]?.icon || Brain;

                return (
                  <div
                    key={i}
                    className={`flex items-center gap-3 p-2 rounded-lg border transition-all ${slotConf.enabled ? 'border-blue-500/40 bg-blue-500/5' : 'border-border/30 bg-muted/10'} ${!hasToken ? 'opacity-40' : ''}`}
                    data-testid={`slot-row-${modality.id}-${i}`}
                  >
                    <Checkbox
                      checked={slotConf.enabled}
                      onCheckedChange={() => hasToken && toggleSlot(i)}
                      disabled={!hasToken}
                      data-testid={`checkbox-slot-${modality.id}-${i}`}
                      className="flex-shrink-0"
                    />
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border flex-shrink-0 ${SLOT_COLORS[i]}`}>
                      {i}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-medium">Módulo {i}</span>
                        {slot?.accountType && (
                          <Badge variant="outline" className={`text-[9px] py-0 px-1 ${slot.accountType === 'real' ? 'border-orange-500/40 text-orange-300' : 'border-blue-500/40 text-blue-300'}`}>
                            {slot.accountType?.toUpperCase()}
                          </Badge>
                        )}
                        {slot?.balance !== null && slot?.balance !== undefined && (
                          <span className="text-[10px] text-muted-foreground">${slot.balance.toFixed(2)}</span>
                        )}
                        {!hasToken && <span className="text-[10px] text-muted-foreground italic">sem token</span>}
                      </div>
                    </div>

                    {slotConf.enabled && (
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {/* Stake Mode Selector */}
                        <div className="flex gap-1">
                          {(['ai', 'fixed', 'manual'] as const).map(mode => {
                            const cfg = STAKE_MODE_LABELS[mode];
                            const Icon = cfg.icon;
                            return (
                              <button
                                key={mode}
                                onClick={() => setStakeMode(i, mode)}
                                className={`text-[10px] px-1.5 py-0.5 rounded border transition-all ${slotConf.stakeMode === mode ? cfg.bg + ' ' + cfg.color : 'border-border/30 text-muted-foreground hover:border-muted-foreground/50'}`}
                                data-testid={`stake-mode-${modality.id}-${i}-${mode}`}
                              >
                                <Icon className="w-2.5 h-2.5 inline mr-0.5" />
                                {cfg.label}
                              </button>
                            );
                          })}
                        </div>

                        {/* Fixed Stake Input */}
                        {(slotConf.stakeMode === 'fixed' || slotConf.stakeMode === 'manual') && (
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-muted-foreground">$</span>
                            <Input
                              type="number"
                              min="0.35"
                              step="0.10"
                              value={slotConf.fixedStake}
                              onChange={(e) => setFixedStake(i, e.target.value)}
                              className="h-6 w-16 text-[11px] px-1.5"
                              data-testid={`stake-input-${modality.id}-${i}`}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              onClick={handleSave}
              disabled={isSaving}
              size="sm"
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
              data-testid={`save-module-config-${modality.id}`}
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
              Salvar Configuração
            </Button>

            {enabledCount > 0 && (
              <Button
                onClick={() => rajadaMutation.mutate()}
                disabled={rajadaMutation.isPending}
                size="sm"
                variant="outline"
                className={`flex-1 border-orange-500/50 text-orange-300 hover:bg-orange-500/10 ${conditions?.ready ? 'border-green-500/50 text-green-300 hover:bg-green-500/10' : ''}`}
                data-testid={`rajada-btn-${modality.id}`}
              >
                {rajadaMutation.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                  : <Zap className="w-3.5 h-3.5 mr-1" />}
                Rajada Manual
              </Button>
            )}
          </div>

          {/* Rajada Result */}
          {rajadaResult && (
            <div className={`rounded-lg border p-3 text-xs space-y-1.5 ${rajadaResult.succeeded > 0 ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
              <div className="flex items-center gap-2 font-semibold">
                {rajadaResult.succeeded > 0 ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <XCircle className="w-3.5 h-3.5 text-red-400" />}
                Rajada: {rajadaResult.succeeded}/{rajadaResult.totalModules} módulos executados
              </div>
              <div className="grid grid-cols-2 gap-1">
                {rajadaResult.results?.map(r => (
                  <div key={r.slotIndex} className={`flex items-center gap-1 ${r.status === 'success' ? 'text-green-300' : 'text-red-300'}`}>
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] border ${SLOT_COLORS[r.slotIndex]}`}>
                      {r.slotIndex}
                    </div>
                    <span>{r.status === 'success' ? `✓ $${r.stakeUsed}` : '✗'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default function ModulosPanel() {
  const { toast } = useToast();
  const [savingModality, setSavingModality] = useState<string | null>(null);

  const { data: overview, isLoading: overviewLoading, refetch: refetchOverview } = useQuery<ModuleOverview>({
    queryKey: ['/api/trading/module-overview'],
    queryFn: () => apiRequest('/api/trading/module-overview').then(r => r.json()),
    refetchInterval: 30000,
  });

  const { data: allConfigs, isLoading: configsLoading } = useQuery<ModalityConfig[]>({
    queryKey: ['/api/trading/module-configs'],
    queryFn: () => apiRequest('/api/trading/module-configs').then(r => r.json()).then((data: any) => {
      const raw = data?.configs ?? data;
      if (Array.isArray(raw)) return raw as ModalityConfig[];
      return Object.entries(raw || {}).map(([modality, slotConfigs]) => ({
        modality,
        slotConfigs: typeof slotConfigs === 'string' ? slotConfigs : JSON.stringify(slotConfigs),
      }));
    }),
  });

  const saveConfigMutation = useMutation({
    mutationFn: ({ modality, slotConfigs }: { modality: string; slotConfigs: ModuleSlotConfig[] }) =>
      apiRequest(`/api/trading/module-configs/${modality}`, { method: 'PUT', body: JSON.stringify({ slotConfigs }) }),
    onSuccess: (_, { modality }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/trading/module-configs'] });
      queryClient.invalidateQueries({ queryKey: ['/api/trading/module-overview'] });
      toast({ title: '✅ Configuração salva', description: `Módulos de ${MODALITIES.find(m => m.id === modality)?.name} atualizados` });
      setSavingModality(null);
    },
    onError: (e: any) => {
      toast({ title: 'Erro ao salvar', description: e?.message, variant: 'destructive' });
      setSavingModality(null);
    },
  });

  const handleSaveModality = useCallback((modality: string, configs: ModuleSlotConfig[]) => {
    setSavingModality(modality);
    saveConfigMutation.mutate({ modality, slotConfigs: configs });
  }, [saveConfigMutation]);

  const getModalityConfig = (modalityId: string): ModuleSlotConfig[] => {
    const mc = allConfigs?.find(c => c.modality === modalityId);
    if (!mc) return [];
    try {
      return JSON.parse(mc.slotConfigs) as ModuleSlotConfig[];
    } catch {
      return [];
    }
  };

  const slots: SlotOverview[] = overview?.overview || Array.from({ length: 10 }, (_, i) => ({
    slotIndex: i,
    hasToken: false,
    accountType: null,
    balance: null,
    currency: 'USD',
    activeModalities: [],
    isActive: false,
    stats: { wins: 0, losses: 0, totalPnl: 0 },
  }));

  const configuredSlots = slots.filter(s => s.hasToken).length;
  const activeSlots = slots.filter(s => s.isActive).length;
  const totalActiveModules = allConfigs?.reduce((acc, c) => {
    try { return acc + (JSON.parse(c.slotConfigs) as ModuleSlotConfig[]).filter(s => s.enabled).length; } catch { return acc; }
  }, 0) || 0;

  const categorizedModalities = MODALITIES.reduce((acc, m) => {
    if (!acc[m.category]) acc[m.category] = [];
    acc[m.category].push(m);
    return acc;
  }, {} as Record<string, typeof MODALITIES>);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Copy className="w-5 h-5 text-blue-400" />
            Sistema de Módulos
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Amplifique cada decisão da IA disparando o mesmo contrato em múltiplos módulos simultaneamente
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetchOverview()} data-testid="btn-refresh-overview">
          <RefreshCw className="w-3.5 h-3.5 mr-1" />
          Atualizar
        </Button>
      </div>

      {/* Camada 1: Painel Central de Módulos */}
      <Card className="border-blue-500/20 bg-gradient-to-br from-blue-500/5 to-background">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-400" />
            Painel Central de Módulos
          </CardTitle>
          <CardDescription className="text-xs">
            Visão geral de todos os 10 módulos (tokens) — seus saldos, modalidades ativas e status em tempo real
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Stats Row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-center">
              <div className="text-2xl font-bold text-blue-400">{configuredSlots}</div>
              <div className="text-[11px] text-muted-foreground">Módulos configurados</div>
            </div>
            <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-center">
              <div className="text-2xl font-bold text-green-400">{activeSlots}</div>
              <div className="text-[11px] text-muted-foreground">Módulos ativos</div>
            </div>
            <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-center">
              <div className="text-2xl font-bold text-orange-400">{totalActiveModules}</div>
              <div className="text-[11px] text-muted-foreground">Cópias simultâneas</div>
            </div>
          </div>

          {/* Como funciona */}
          {configuredSlots === 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                <div className="text-xs space-y-1">
                  <p className="font-semibold text-amber-300">Nenhum módulo configurado</p>
                  <p className="text-muted-foreground">
                    Para usar o sistema de módulos, primeiro configure os tokens nos slots 0-9 na aba
                    <strong className="text-foreground"> Configurações → Frenético 9-Tokens</strong>.
                    Cada slot usa seu próprio token/conta Deriv para executar trades em paralelo.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Slots Grid */}
          {overviewLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              Carregando módulos...
            </div>
          ) : (
            <div className="grid grid-cols-5 gap-2">
              {slots.map(slot => <SlotCard key={slot.slotIndex} slot={slot} />)}
            </div>
          )}

          {/* Como funciona o amplificador */}
          <div className="rounded-lg border border-border/50 bg-muted/10 p-3">
            <h4 className="text-xs font-semibold flex items-center gap-1.5 mb-2">
              <Cpu className="w-3.5 h-3.5 text-blue-400" />
              Como funciona o Amplificador de Cópia Simultânea
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-muted-foreground">
              <div className="flex items-start gap-1.5">
                <span className="text-blue-400 font-bold">1.</span>
                <span>A IA analisa o mercado e aprova um trade em uma modalidade</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-blue-400 font-bold">2.</span>
                <span>O sistema dispara o mesmo contrato simultaneamente em todos os módulos ativos naquela modalidade</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-blue-400 font-bold">3.</span>
                <span>Cada módulo executa na sua própria conta/token com stake configurado individualmente</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Camada 2: Configuração por Modalidade */}
      <div>
        <h3 className="text-base font-semibold mb-1 flex items-center gap-2">
          <Settings className="w-4 h-4 text-muted-foreground" />
          Configuração por Modalidade
        </h3>
        <p className="text-xs text-muted-foreground mb-4">
          Para cada modalidade, selecione quais módulos copiam as operações e defina o stake de cada um.
          Clique em qualquer modalidade para expandir e configurar.
        </p>

        {configsLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" />
            Carregando configurações...
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(categorizedModalities).map(([category, modalities]) => (
              <div key={category}>
                <div className="flex items-center gap-2 mb-2">
                  <Separator className="flex-1" />
                  <span className="text-xs font-semibold text-muted-foreground px-2 whitespace-nowrap">{category}</span>
                  <Separator className="flex-1" />
                </div>
                <div className="space-y-2">
                  {modalities.map(modality => (
                    <ModalityModuleCard
                      key={modality.id}
                      modality={modality}
                      slots={slots}
                      config={getModalityConfig(modality.id)}
                      onSave={handleSaveModality}
                      isSaving={savingModality === modality.id}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
