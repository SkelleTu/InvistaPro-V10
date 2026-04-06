import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Zap, Brain, Target, Settings, Wifi, WifiOff, CheckCircle2 } from "lucide-react";

interface ModuleSlotConfig {
  slotIndex: number;
  enabled: boolean;
  stakeMode: "ai" | "fixed" | "manual";
  fixedStake: number;
}

interface SlotOverview {
  slotIndex: number;
  hasToken: boolean;
  accountType: string | null;
  balance: number | null;
  currency: string;
  isActive: boolean;
}

interface ModuleOverview {
  overview: SlotOverview[];
  configuredCount: number;
}

const STAKE_MODES: Array<{ value: "ai" | "fixed" | "manual"; label: string; icon: typeof Brain; color: string }> = [
  { value: "ai", label: "IA", icon: Brain, color: "bg-blue-500/20 border-blue-500/50 text-blue-300" },
  { value: "fixed", label: "Fixo", icon: Target, color: "bg-yellow-500/20 border-yellow-500/50 text-yellow-300" },
  { value: "manual", label: "Manual", icon: Settings, color: "bg-orange-500/20 border-orange-500/50 text-orange-300" },
];

const SLOT_RING_COLORS = [
  "ring-violet-500", "ring-blue-500", "ring-cyan-500", "ring-teal-500", "ring-green-500",
  "ring-lime-500", "ring-yellow-500", "ring-orange-500", "ring-red-500", "ring-pink-500",
];

interface Props {
  modalityId: string;
}

export default function ModalityModuleSelector({ modalityId }: Props) {
  const { toast } = useToast();
  const [localConfigs, setLocalConfigs] = useState<ModuleSlotConfig[]>([]);
  const [expandedSlot, setExpandedSlot] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);

  const { data: overviewData } = useQuery<ModuleOverview>({
    queryKey: ["/api/trading/module-overview"],
    refetchInterval: 15000,
    queryFn: () => apiRequest("/api/trading/module-overview").then(r => r.json()),
  });

  const { data: savedConfigs = [], isLoading } = useQuery<ModuleSlotConfig[]>({
    queryKey: ["/api/trading/module-configs", modalityId],
    queryFn: () => apiRequest(`/api/trading/module-configs/${modalityId}`).then(r => r.json()),
  });

  const savedKey = JSON.stringify(savedConfigs);
  useEffect(() => {
    if (!isLoading) {
      const defaulted = Array.from({ length: 10 }, (_, i) => {
        const saved = savedConfigs.find(c => c.slotIndex === i);
        return saved ?? { slotIndex: i, enabled: false, stakeMode: "ai" as const, fixedStake: 1.0 };
      });
      setLocalConfigs(defaulted);
      setDirty(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey, isLoading]);

  const saveMutation = useMutation({
    mutationFn: async (configs: ModuleSlotConfig[]) => {
      await apiRequest(`/api/trading/module-configs/${modalityId}`, {
        method: "PUT",
        body: JSON.stringify({ slotConfigs: configs }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trading/module-configs", modalityId] });
      queryClient.invalidateQueries({ queryKey: ["/api/trading/module-overview"] });
      toast({ title: `Módulos de ${modalityId} salvos!`, description: `${localConfigs.filter(c => c.enabled).length} slot(s) ativos.` });
      setDirty(false);
    },
    onError: () => {
      toast({ title: "Erro ao salvar módulos", variant: "destructive" });
    },
  });

  const slots: SlotOverview[] = overviewData?.overview ?? Array.from({ length: 10 }, (_, i) => ({
    slotIndex: i, hasToken: false, accountType: null, balance: null, currency: "USD", isActive: false,
  }));

  const toggleSlot = (idx: number) => {
    setLocalConfigs(prev => prev.map(c => c.slotIndex === idx ? { ...c, enabled: !c.enabled } : c));
    setDirty(true);
  };

  const setStakeMode = (idx: number, mode: "ai" | "fixed" | "manual") => {
    setLocalConfigs(prev => prev.map(c => c.slotIndex === idx ? { ...c, stakeMode: mode } : c));
    setDirty(true);
  };

  const setFixedStake = (idx: number, val: string) => {
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0) {
      setLocalConfigs(prev => prev.map(c => c.slotIndex === idx ? { ...c, fixedStake: num } : c));
      setDirty(true);
    }
  };

  const enabledCount = localConfigs.filter(c => c.enabled).length;
  const tokenCount = slots.filter(s => s.hasToken).length;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        Carregando módulos...
      </div>
    );
  }

  return (
    <div className="mt-2 pt-2 border-t border-blue-200/50 dark:border-blue-700/50 space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-xs font-semibold text-violet-300">Módulos de Cópia</span>
          <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-violet-500/40 text-violet-300">
            {enabledCount}/{tokenCount} ativos
          </Badge>
        </div>
        {dirty && (
          <Button
            size="sm"
            className="h-5 text-[10px] px-2 py-0 bg-violet-600 hover:bg-violet-700 text-white"
            onClick={() => saveMutation.mutate(localConfigs)}
            disabled={saveMutation.isPending}
            data-testid={`btn-save-modules-${modalityId}`}
          >
            {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            <span className="ml-1">Salvar</span>
          </Button>
        )}
      </div>

      {/* Slot Grid — 10 numbered buttons */}
      <div className="flex flex-wrap gap-1.5">
        {localConfigs.map((cfg) => {
          const slot = slots.find(s => s.slotIndex === cfg.slotIndex);
          const hasToken = slot?.hasToken ?? false;
          const isActive = cfg.enabled && hasToken;
          const ringColor = SLOT_RING_COLORS[cfg.slotIndex] || "ring-gray-500";

          return (
            <div key={cfg.slotIndex} className="relative">
              <button
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border transition-all
                  ${!hasToken ? "border-border/40 text-muted-foreground/40 cursor-not-allowed bg-muted/20" : ""}
                  ${hasToken && !cfg.enabled ? "border-border text-muted-foreground bg-background hover:border-muted-foreground/50 cursor-pointer" : ""}
                  ${isActive ? `ring-2 ${ringColor} ring-offset-1 ring-offset-background border-transparent bg-violet-500/20 text-violet-200 font-bold shadow-sm` : ""}
                `}
                onClick={() => hasToken && toggleSlot(cfg.slotIndex)}
                title={!hasToken ? `Slot ${cfg.slotIndex + 1}: Token não configurado` : `Slot ${cfg.slotIndex + 1} ${cfg.enabled ? "(ativo — clique para desativar)" : "(inativo — clique para ativar)"}`}
                data-testid={`slot-btn-${modalityId}-${cfg.slotIndex}`}
              >
                {cfg.slotIndex + 1}
              </button>
              {/* Token indicator dot */}
              {hasToken && (
                <div className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-background ${isActive ? "bg-green-400" : "bg-gray-500"}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Expanded config for active slots */}
      {localConfigs.filter(c => c.enabled && slots.find(s => s.slotIndex === c.slotIndex)?.hasToken).length > 0 && (
        <div className="space-y-1.5 rounded-lg bg-black/20 p-2">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mb-1">Modo de Stake por Slot</p>
          {localConfigs
            .filter(c => c.enabled && slots.find(s => s.slotIndex === c.slotIndex)?.hasToken)
            .map((cfg) => {
              const slot = slots.find(s => s.slotIndex === cfg.slotIndex);
              return (
                <div key={cfg.slotIndex} className="flex items-center gap-2 flex-wrap">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border ${SLOT_RING_COLORS[cfg.slotIndex]?.replace('ring-', 'border-') || ''} text-foreground shrink-0`}>
                    {cfg.slotIndex + 1}
                  </div>
                  <div className="flex gap-1">
                    {STAKE_MODES.map(mode => (
                      <button
                        key={mode.value}
                        className={`text-[10px] px-1.5 py-0.5 rounded border transition-all ${cfg.stakeMode === mode.value ? mode.color : "border-border/50 text-muted-foreground/60 hover:border-muted-foreground/40"}`}
                        onClick={() => setStakeMode(cfg.slotIndex, mode.value)}
                        data-testid={`stake-mode-${modalityId}-${cfg.slotIndex}-${mode.value}`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                  {cfg.stakeMode === "fixed" && (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted-foreground">$</span>
                      <Input
                        type="number"
                        step="0.10"
                        min="0.35"
                        className="h-5 w-16 text-[10px] px-1 py-0"
                        value={cfg.fixedStake}
                        onChange={e => setFixedStake(cfg.slotIndex, e.target.value)}
                        data-testid={`fixed-stake-${modalityId}-${cfg.slotIndex}`}
                      />
                    </div>
                  )}
                  {slot?.balance !== null && (
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {slot.currency} {slot.balance?.toFixed(2)}
                    </span>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* Helper text when no tokens */}
      {tokenCount === 0 && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <WifiOff className="w-3 h-3" />
          Configure tokens nas Configurações (aba Configurações → Deriv Token) para ativar slots.
        </p>
      )}

      {/* Legend */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> Ativo</span>
        <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-gray-500 inline-block" /> Inativo</span>
        <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-muted/30 border border-border/30 inline-block" /> Sem token</span>
      </div>
    </div>
  );
}
