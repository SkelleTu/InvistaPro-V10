import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Zap, Brain, Target, Settings, CheckCircle2 } from "lucide-react";

interface ModuleSlotConfig {
  slotIndex: number;
  enabled: boolean;
  stakeMode: "ai" | "fixed" | "manual";
  fixedStake: number;
}

interface SlotInfo {
  slotIndex: number;
  accountType: string;
  maskedToken: string;
  isActive: boolean;
}

const STAKE_MODES: Array<{ value: "ai" | "fixed" | "manual"; label: string; color: string }> = [
  { value: "ai",     label: "IA",     color: "bg-blue-500/20 border-blue-500/50 text-blue-300" },
  { value: "fixed",  label: "Fixo",   color: "bg-yellow-500/20 border-yellow-500/50 text-yellow-300" },
  { value: "manual", label: "Manual", color: "bg-orange-500/20 border-orange-500/50 text-orange-300" },
];

const SLOT_RING = [
  "ring-violet-500", "ring-blue-500", "ring-cyan-500", "ring-teal-500", "ring-green-500",
  "ring-lime-500",   "ring-yellow-500", "ring-orange-500", "ring-red-500", "ring-pink-500",
];

interface Props { modalityId: string; }

export default function ModalityModuleSelector({ modalityId }: Props) {
  const { toast } = useToast();
  const [localConfigs, setLocalConfigs] = useState<ModuleSlotConfig[]>(
    Array.from({ length: 10 }, (_, i) => ({ slotIndex: i, enabled: false, stakeMode: "ai" as const, fixedStake: 0.35 }))
  );
  const [dirty, setDirty] = useState(false);

  // Usa o mesmo endpoint de token/slot que o resto do sistema já usa (rápido — só DB, sem WebSocket)
  const { data: slotData } = useQuery<{ slots: SlotInfo[]; totalConfigured: number }>({
    queryKey: ["/api/trading/deriv-tokens/slots"],
    queryFn: () => apiRequest("/api/trading/deriv-tokens/slots").then(r => r.json()),
    staleTime: 30000,
  });

  const { data: savedConfigs = [], isLoading } = useQuery<ModuleSlotConfig[]>({
    queryKey: ["/api/trading/module-configs", modalityId],
    queryFn: () => apiRequest(`/api/trading/module-configs/${modalityId}`).then(r => r.json()).then((d: any) => Array.isArray(d) ? d : (d?.slotConfigs ?? [])),
  });

  const savedKey = JSON.stringify(savedConfigs);
  useEffect(() => {
    if (!isLoading) {
      setLocalConfigs(
        Array.from({ length: 10 }, (_, i) => {
          const saved = (savedConfigs as ModuleSlotConfig[]).find(c => c.slotIndex === i);
          return saved ?? { slotIndex: i, enabled: false, stakeMode: "ai" as const, fixedStake: 0.35 };
        })
      );
      setDirty(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey, isLoading]);

  const saveMutation = useMutation({
    mutationFn: (configs: ModuleSlotConfig[]) =>
      apiRequest(`/api/trading/module-configs/${modalityId}`, {
        method: "PUT",
        body: JSON.stringify({ slotConfigs: configs }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trading/module-configs", modalityId] });
      queryClient.invalidateQueries({ queryKey: ["/api/trading/module-overview"] });
      const count = localConfigs.filter(c => c.enabled).length;
      toast({ title: `Módulos salvos!`, description: `${count} slot(s) ativo(s) para ${modalityId}.` });
      setDirty(false);
    },
    onError: () => toast({ title: "Erro ao salvar módulos", variant: "destructive" }),
  });

  const configuredSlots = slotData?.slots ?? [];
  const hasSlot = (idx: number) => configuredSlots.some(s => s.slotIndex === idx && s.isActive);
  const enabledCount = localConfigs.filter(c => c.enabled).length;
  const tokenTotal = configuredSlots.filter(s => s.isActive).length;

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

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-2 pt-2 border-t border-blue-200/50 dark:border-blue-700/50 py-2">
        <Loader2 className="w-3 h-3 animate-spin" />
        Carregando configuração de módulos...
      </div>
    );
  }

  return (
    <div className="mt-2 pt-2 border-t border-blue-200/50 dark:border-blue-700/50 space-y-2">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-xs font-semibold text-violet-300">Módulos de Cópia</span>
          <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-violet-500/40 text-violet-300">
            {enabledCount} ativo{enabledCount !== 1 ? "s" : ""}
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
            {saveMutation.isPending
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <CheckCircle2 className="w-3 h-3" />}
            <span className="ml-1">Salvar</span>
          </Button>
        )}
      </div>

      {/* 10 botões de slot — sempre clicáveis, destaque visual se tem token */}
      <div className="flex flex-wrap gap-1.5">
        {localConfigs.map((cfg) => {
          const hasToken = hasSlot(cfg.slotIndex);
          const slot = configuredSlots.find(s => s.slotIndex === cfg.slotIndex);
          const isEnabled = cfg.enabled;
          const ring = SLOT_RING[cfg.slotIndex] ?? "ring-gray-500";

          return (
            <div key={cfg.slotIndex} className="relative">
              <button
                title={
                  isEnabled
                    ? `Slot ${cfg.slotIndex + 1} ativo — clique para desativar`
                    : hasToken
                      ? `Slot ${cfg.slotIndex + 1} (${slot?.accountType?.toUpperCase() ?? "DEMO"}) — clique para ativar`
                      : `Slot ${cfg.slotIndex + 1} — sem token configurado (pode ativar mesmo assim)`
                }
                className={`
                  w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border transition-all cursor-pointer
                  ${isEnabled
                    ? `ring-2 ${ring} ring-offset-1 ring-offset-background border-transparent bg-violet-500/20 text-violet-200 shadow-sm`
                    : hasToken
                      ? "border-muted-foreground/40 text-muted-foreground hover:border-violet-400/60 hover:text-violet-300 bg-background"
                      : "border-border/30 text-muted-foreground/40 bg-muted/10 hover:border-border/50 hover:text-muted-foreground/60"
                  }
                `}
                onClick={() => toggleSlot(cfg.slotIndex)}
                data-testid={`slot-btn-${modalityId}-${cfg.slotIndex}`}
              >
                {cfg.slotIndex + 1}
              </button>
              {/* ponto de status */}
              <div className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-background ${
                isEnabled ? "bg-green-400" : hasToken ? "bg-blue-400/60" : "bg-muted/40"
              }`} />
            </div>
          );
        })}
      </div>

      {/* Legenda rápida */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> Ativo</span>
        <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-blue-400/60 inline-block" /> Com token</span>
        <span className="flex items-center gap-0.5"><span className="w-2 h-2 rounded-full bg-muted/40 border border-border/30 inline-block" /> Sem token</span>
        {tokenTotal > 0 && (
          <span className="ml-auto text-violet-300/60">{tokenTotal} token{tokenTotal !== 1 ? "s" : ""} configurado{tokenTotal !== 1 ? "s" : ""}</span>
        )}
      </div>

      {/* Config de stake para slots ativos */}
      {localConfigs.some(c => c.enabled) && (
        <div className="space-y-1.5 rounded-lg bg-black/20 p-2">
          <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide mb-1">Modo de Stake por Slot Ativo</p>
          {localConfigs.filter(c => c.enabled).map((cfg) => {
            const slot = configuredSlots.find(s => s.slotIndex === cfg.slotIndex);
            return (
              <div key={cfg.slotIndex} className="flex items-center gap-2 flex-wrap">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${SLOT_RING[cfg.slotIndex]?.replace("ring-","border-") || "border-muted"} text-foreground shrink-0`}>
                  {cfg.slotIndex + 1}
                </div>
                {slot && (
                  <Badge variant="outline" className={`text-[10px] py-0 px-1 shrink-0 ${slot.accountType === "real" ? "border-orange-500/40 text-orange-300" : "border-blue-500/40 text-blue-300"}`}>
                    {slot.accountType?.toUpperCase()}
                  </Badge>
                )}
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
                      type="number" step="0.10" min="0.35"
                      className="h-5 w-16 text-[10px] px-1 py-0"
                      value={cfg.fixedStake}
                      onChange={e => setFixedStake(cfg.slotIndex, e.target.value)}
                      data-testid={`fixed-stake-${modalityId}-${cfg.slotIndex}`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
