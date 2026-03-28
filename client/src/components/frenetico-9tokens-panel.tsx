import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Zap, Key, Trash2, RefreshCw, PlayCircle,
  CheckCircle2, AlertCircle, Loader2, Eye, EyeOff,
  TrendingUp, DollarSign, Flame, Snowflake, Circle,
  BarChart2, History, Target, Layers
} from "lucide-react";

type StakeMode = "uniform" | "kelly" | "aggressive";

interface SlotInfo {
  slotIndex: number;
  accountType: "demo" | "real";
  maskedToken: string;
  isActive: boolean;
}

interface SlotBalance {
  slotIndex: number;
  balance: number | null;
  error?: string;
}

interface DigitHeat {
  digit: number;
  frequency: number;
  label: "hot" | "neutral" | "cold";
  recommendedStakeMultiplier: number;
}

interface BurstStats {
  totalStaked: number;
  expectedWin: number;
  expectedProfit: number;
  expectedROI: number;
  edgeScore: number;
}

interface BalancesResponse {
  sharedAsset: string | null;
  digitHeats: DigitHeat[];
  balances: SlotBalance[];
}

interface PreviewResponse {
  targetSymbol: string;
  digitHeats: DigitHeat[];
  stakeDistribution: Record<number, number>;
  burstStats: BurstStats;
  stakeMode: StakeMode;
}

interface HistoryEntry {
  timestamp: number;
  symbol: string;
  totalStaked: number;
  expectedProfit: number;
  mode: StakeMode;
  openedContracts: number;
}

const DIGIT_COLORS = [
  "border-violet-500/40", "border-blue-500/40", "border-cyan-500/40",
  "border-teal-500/40", "border-green-500/40", "border-yellow-500/40",
  "border-orange-500/40", "border-red-500/40", "border-pink-500/40",
  "border-rose-500/40",
];

const MODE_CONFIG: Record<StakeMode, { label: string; description: string; color: string; icon: typeof Target }> = {
  uniform: {
    label: "Uniforme",
    description: "Mesmo valor em todos os dígitos — baseline estável",
    color: "border-blue-500/50 bg-blue-500/10 text-blue-300",
    icon: Layers,
  },
  kelly: {
    label: "Kelly",
    description: "Stake proporcional à frequência — foco nos dígitos quentes",
    color: "border-yellow-500/50 bg-yellow-500/10 text-yellow-300",
    icon: BarChart2,
  },
  aggressive: {
    label: "Agressivo",
    description: "Boost exponencial nos quentes · mínimo nos frios · lucro maximizado",
    color: "border-orange-500/50 bg-orange-500/10 text-orange-300",
    icon: Flame,
  },
};

function HeatIcon({ label }: { label: "hot" | "neutral" | "cold" }) {
  if (label === "hot") return <Flame className="w-3 h-3 text-orange-400" />;
  if (label === "cold") return <Snowflake className="w-3 h-3 text-blue-400" />;
  return <Circle className="w-3 h-3 text-muted-foreground" />;
}

function heatBg(label: "hot" | "neutral" | "cold") {
  if (label === "hot") return "bg-orange-500/20 text-orange-400";
  if (label === "cold") return "bg-blue-500/20 text-blue-400";
  return "bg-muted text-muted-foreground";
}

function StakeBar({ stake, maxStake }: { stake: number; maxStake: number }) {
  const pct = maxStake > 0 ? Math.min(100, (stake / maxStake) * 100) : 0;
  const color = pct > 66 ? "bg-orange-500" : pct > 33 ? "bg-yellow-500" : "bg-blue-500/60";
  return (
    <div className="h-1 w-full bg-border/30 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function Frenetico9TokensPanel() {
  const { toast } = useToast();
  const [activeSlotInput, setActiveSlotInput] = useState<number | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [accountType, setAccountType] = useState<"demo" | "real">("demo");
  const [showToken, setShowToken] = useState(false);
  const [burstAmount, setBurstAmount] = useState("0.35");
  const [stakeMode, setStakeMode] = useState<StakeMode>("kelly");
  const [showHistory, setShowHistory] = useState(false);

  const { data: slotsData, isLoading, refetch } = useQuery<{ slots: SlotInfo[]; totalConfigured: number }>({
    queryKey: ["/api/trading/deriv-tokens/slots"],
    refetchInterval: 10000,
  });

  const { data: balancesData, refetch: refetchBalances } = useQuery<BalancesResponse>({
    queryKey: ["/api/trading/deriv-tokens/slots/balances"],
    refetchInterval: 30000,
    enabled: (slotsData?.totalConfigured ?? 0) > 0,
  });

  const { data: previewData, refetch: refetchPreview } = useQuery<PreviewResponse>({
    queryKey: ["/api/trading/frenetico-9tokens/preview", burstAmount, stakeMode],
    queryFn: () =>
      fetch(`/api/trading/frenetico-9tokens/preview?amount=${burstAmount}&stakeMode=${stakeMode}`, {
        credentials: "include",
      }).then(r => r.json()),
    refetchInterval: 15000,
    enabled: (slotsData?.totalConfigured ?? 0) > 0,
  });

  const { data: historyData } = useQuery<{ history: HistoryEntry[] }>({
    queryKey: ["/api/trading/frenetico-9tokens/history"],
    refetchInterval: 5000,
    enabled: showHistory,
  });

  const configureSlotMutation = useMutation({
    mutationFn: async (slotIndex: number) => {
      if (!tokenInput.trim()) throw new Error("Token é obrigatório");
      const res = await apiRequest(`/api/trading/deriv-tokens/slot/${slotIndex}`, {
        method: "POST",
        body: JSON.stringify({ token: tokenInput.trim(), accountType }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Erro ao configurar slot");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: `Dígito ${data.slotIndex} configurado!`,
        description: `Conta ${data.accountType === "demo" ? "Demo" : "Real"} conectada${data.balance != null ? ` — Saldo: $${data.balance.toFixed(2)}` : ""}`,
      });
      setTokenInput("");
      setActiveSlotInput(null);
      queryClient.invalidateQueries({ queryKey: ["/api/trading/deriv-tokens/slots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trading/deriv-tokens/slots/balances"] });
    },
    onError: (err: any) => {
      toast({ title: "Erro", description: err.message, variant: "destructive" });
    },
  });

  const removeSlotMutation = useMutation({
    mutationFn: async (slotIndex: number) => {
      const res = await apiRequest(`/api/trading/deriv-tokens/slot/${slotIndex}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (_, slotIndex) => {
      toast({ title: `Dígito ${slotIndex} removido`, description: "Token desconfigurado com sucesso" });
      queryClient.invalidateQueries({ queryKey: ["/api/trading/deriv-tokens/slots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trading/deriv-tokens/slots/balances"] });
    },
    onError: (err: any) => {
      toast({ title: "Erro ao remover", description: err.message, variant: "destructive" });
    },
  });

  const burstMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("/api/trading/frenetico-9tokens/burst", {
        method: "POST",
        body: JSON.stringify({ amount: parseFloat(burstAmount), duration: 1, stakeMode }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => {
      const stats = data.burstStats;
      const evSign = stats?.expectedProfit >= 0 ? "+" : "";
      toast({
        title: `⚡ Rajada ${data.stakeMode?.toUpperCase()}! ${data.openedContracts}/${data.totalSlots} contratos`,
        description: `${data.targetSymbol} · $${stats?.totalStaked?.toFixed(2)} investido · EV: ${evSign}$${stats?.expectedProfit?.toFixed(2)} (${stats?.expectedROI?.toFixed(1)}% ROI) · ${data.burstDurationMs}ms`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/trading/frenetico-9tokens/history"] });
      refetchPreview();
    },
    onError: (err: any) => {
      toast({ title: "Erro na rajada", description: err.message, variant: "destructive" });
    },
  });

  const configuredSlots = slotsData?.slots ?? [];
  const getSlotInfo = (idx: number) => configuredSlots.find(s => s.slotIndex === idx);
  const getSlotBalance = (idx: number) => balancesData?.balances?.find(b => b.slotIndex === idx);
  const sharedAsset = previewData?.targetSymbol ?? balancesData?.sharedAsset ?? null;

  const totalConfigured = slotsData?.totalConfigured ?? 0;
  const totalBalance = balancesData?.balances?.filter(b => b.balance != null)?.reduce((sum, b) => sum + (b.balance ?? 0), 0) ?? 0;

  const digitHeats = previewData?.digitHeats ?? balancesData?.digitHeats ?? [];
  const stakeDistribution = previewData?.stakeDistribution ?? {};
  const burstStats = previewData?.burstStats;

  const maxStake = Math.max(...Object.values(stakeDistribution), parseFloat(burstAmount) || 0.35);

  const modeInfo = MODE_CONFIG[stakeMode];
  const ModeIcon = modeInfo.icon;

  return (
    <Card className="border-violet-500/30 bg-gradient-to-br from-background to-violet-950/10">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/20">
              <Zap className="w-5 h-5 text-violet-400" />
            </div>
            <div>
              <CardTitle className="text-lg">Frenético 10-Tokens</CardTitle>
              <CardDescription>
                100% cobertura simultânea · stake inteligente por calor de dígito
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={totalConfigured > 0 ? "default" : "secondary"} className="text-xs">
              {totalConfigured}/10 dígitos
            </Badge>
            {totalConfigured > 0 && (
              <Badge variant="outline" className="text-xs text-green-400 border-green-500/30">
                <DollarSign className="w-3 h-3 mr-1" />
                ${totalBalance.toFixed(2)}
              </Badge>
            )}
          </div>
        </div>

        {/* Painel de inteligência */}
        {totalConfigured > 0 && (
          <div className="mt-3 space-y-2">
            {/* Linha do ativo + heat map */}
            <div className="p-3 rounded-lg bg-violet-500/5 border border-violet-500/20 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-violet-300 font-medium">
                  <TrendingUp className="w-3.5 h-3.5" />
                  Ativo selecionado pela IA
                </div>
                {sharedAsset && (
                  <span className="font-mono font-bold text-violet-400 text-sm tracking-wide">
                    📊 {sharedAsset}
                  </span>
                )}
              </div>
              {digitHeats.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {digitHeats.map(h => (
                    <span key={h.digit} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${heatBg(h.label)}`}>
                      <HeatIcon label={h.label} />
                      {h.digit}
                      <span className="opacity-70 font-normal">{(h.frequency * 100).toFixed(0)}%</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* EV por rajada */}
            {burstStats && (
              <div className="p-3 rounded-lg bg-card border border-border/40 text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 text-muted-foreground font-medium mb-1">
                  <Target className="w-3.5 h-3.5" />
                  Projeção para próxima rajada ({stakeMode})
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <div className="text-center">
                    <div className="text-muted-foreground text-[10px]">Total investido</div>
                    <div className="font-bold text-foreground">${burstStats.totalStaked.toFixed(2)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-muted-foreground text-[10px]">Ganho esperado</div>
                    <div className="font-bold text-blue-400">${burstStats.expectedWin.toFixed(2)}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-muted-foreground text-[10px]">EV líquido</div>
                    <div className={`font-bold ${burstStats.expectedProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {burstStats.expectedProfit >= 0 ? "+" : ""}${burstStats.expectedProfit.toFixed(2)}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-muted-foreground text-[10px]">ROI esperado</div>
                    <div className={`font-bold ${burstStats.expectedROI >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {burstStats.expectedROI >= 0 ? "+" : ""}{burstStats.expectedROI.toFixed(1)}%
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground pt-0.5">
                  <span>Edge score: <strong className="text-violet-400">{burstStats.edgeScore.toFixed(3)}</strong></span>
                  <span>·</span>
                  <span>Payout estimado: <strong>8.5×</strong></span>
                  <span>·</span>
                  <span className="text-green-400/80">1 dígito SEMPRE ganha ✓</span>
                </div>
              </div>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Seletor de modo */}
        {totalConfigured > 0 && (
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Modo de distribuição de stakes</Label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(MODE_CONFIG) as StakeMode[]).map(m => {
                const cfg = MODE_CONFIG[m];
                const Icon = cfg.icon;
                const isActive = stakeMode === m;
                return (
                  <button
                    key={m}
                    onClick={() => setStakeMode(m)}
                    data-testid={`btn-mode-${m}`}
                    className={`rounded-lg border p-2 text-left transition-all text-xs ${isActive ? cfg.color + " border-2" : "border-border/40 bg-card/30 text-muted-foreground hover:border-border"}`}
                  >
                    <div className="flex items-center gap-1 font-bold mb-0.5">
                      <Icon className="w-3 h-3" />
                      {cfg.label}
                    </div>
                    <div className="text-[10px] leading-tight opacity-80">{cfg.description}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Grid 2x5 dos dígitos */}
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 10 }, (_, i) => {
            const slot = getSlotInfo(i);
            const balance = getSlotBalance(i);
            const isConfiguring = activeSlotInput === i;
            const isConfigured = !!slot;
            const digitHeat = digitHeats[i] ?? null;
            const stake = (stakeDistribution[i] ?? parseFloat(burstAmount)) || 0.35;

            return (
              <div
                key={i}
                data-testid={`slot-card-${i}`}
                className={`rounded-lg border p-3 transition-all ${
                  isConfigured
                    ? `${DIGIT_COLORS[i]} bg-card`
                    : "border-dashed border-border/50 bg-card/30"
                }`}
              >
                {/* Cabeçalho: dígito + calor + stake bar */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base font-bold font-mono leading-none">{i}</span>
                    <span className="text-[10px] text-muted-foreground">dígito</span>
                    {digitHeat && (
                      <span className={`inline-flex items-center gap-0.5 text-[10px] ${
                        digitHeat.label === "hot" ? "text-orange-400" :
                        digitHeat.label === "cold" ? "text-blue-400" : "text-muted-foreground"
                      }`}>
                        <HeatIcon label={digitHeat.label} />
                        {(digitHeat.frequency * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {isConfigured && stakeDistribution[i] != null && (
                      <span className="text-[10px] font-mono font-bold text-violet-300">
                        ${stake.toFixed(2)}
                      </span>
                    )}
                    {isConfigured && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1 text-green-400 border-green-500/30">
                        ativo
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Barra de stake relativo */}
                {isConfigured && Object.keys(stakeDistribution).length > 0 && (
                  <StakeBar stake={stake} maxStake={maxStake} />
                )}

                {isConfigured ? (
                  <div className="mt-2">
                    <div className="space-y-0.5 mb-2">
                      <div className="flex items-center gap-1">
                        <Key className="w-3 h-3 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground font-mono">{slot.maskedToken}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {slot.accountType === "demo" ? "🧪 Demo" : "💰 Real"}
                      </div>
                      {balance?.balance != null && (
                        <div className="text-[10px] text-green-400 font-medium">
                          ${balance.balance.toFixed(2)}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full h-6 text-[10px] text-red-400 hover:text-red-300 hover:bg-red-500/10 p-0"
                      onClick={() => removeSlotMutation.mutate(i)}
                      disabled={removeSlotMutation.isPending}
                      data-testid={`btn-remove-slot-${i}`}
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      Remover
                    </Button>
                  </div>
                ) : isConfiguring ? (
                  <div className="space-y-2 mt-2">
                    <div className="relative">
                      <Input
                        placeholder="Token Deriv..."
                        value={tokenInput}
                        onChange={e => setTokenInput(e.target.value)}
                        type={showToken ? "text" : "password"}
                        className="h-7 text-xs pr-7"
                        data-testid={`input-token-slot-${i}`}
                      />
                      <button
                        className="absolute right-2 top-1.5 text-muted-foreground"
                        onClick={() => setShowToken(v => !v)}
                        type="button"
                      >
                        {showToken ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                      </button>
                    </div>
                    <select
                      value={accountType}
                      onChange={e => setAccountType(e.target.value as "demo" | "real")}
                      className="w-full h-7 text-xs rounded border border-input bg-background px-2"
                      data-testid={`select-account-type-slot-${i}`}
                    >
                      <option value="demo">Demo</option>
                      <option value="real">Real</option>
                    </select>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        className="flex-1 h-7 text-[10px]"
                        onClick={() => configureSlotMutation.mutate(i)}
                        disabled={configureSlotMutation.isPending || !tokenInput.trim()}
                        data-testid={`btn-save-slot-${i}`}
                      >
                        {configureSlotMutation.isPending ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3 h-3" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[10px] px-2"
                        onClick={() => { setActiveSlotInput(null); setTokenInput(""); }}
                        data-testid={`btn-cancel-slot-${i}`}
                      >
                        ✕
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-7 text-[10px] border-dashed mt-2"
                    onClick={() => { setActiveSlotInput(i); setTokenInput(""); setShowToken(false); }}
                    data-testid={`btn-configure-slot-${i}`}
                  >
                    <Key className="w-3 h-3 mr-1" />
                    Adicionar conta
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* Barra de ação */}
        {totalConfigured > 0 && (
          <div className="space-y-3 pt-2 border-t border-border/30">
            <div className="flex items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Valor base por contrato (USD)</Label>
                <Input
                  value={burstAmount}
                  onChange={e => setBurstAmount(e.target.value)}
                  type="number"
                  min="0.35"
                  step="0.05"
                  className="h-8 w-28 text-xs"
                  data-testid="input-burst-amount"
                />
              </div>
              <Button
                onClick={() => burstMutation.mutate()}
                disabled={burstMutation.isPending || totalConfigured === 0}
                className="h-8 bg-violet-600 hover:bg-violet-700 text-white font-semibold"
                data-testid="btn-fire-burst"
              >
                {burstMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <PlayCircle className="w-4 h-4 mr-2" />
                )}
                Disparar Rajada
                <ModeIcon className="w-3.5 h-3.5 ml-1.5 opacity-70" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() => { refetch(); refetchBalances(); refetchPreview(); }}
                data-testid="btn-refresh-slots"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
              <Button
                variant={showHistory ? "secondary" : "ghost"}
                size="sm"
                className="h-8"
                onClick={() => setShowHistory(v => !v)}
                data-testid="btn-toggle-history"
              >
                <History className="w-4 h-4" />
              </Button>
            </div>

            {/* Legenda de stakes do modo atual */}
            {stakeMode !== "uniform" && Object.keys(stakeDistribution).length > 0 && (
              <div className="text-[10px] text-muted-foreground flex flex-wrap gap-1 items-center">
                <span className="font-medium text-foreground">Stakes {modeInfo.label}:</span>
                {Array.from({ length: 10 }, (_, i) => {
                  const s = stakeDistribution[i];
                  if (s == null) return null;
                  const heat = digitHeats[i]?.label ?? "neutral";
                  return (
                    <span key={i} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-mono ${heatBg(heat)}`}>
                      {i}: ${s.toFixed(2)}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Histórico de rajadas */}
        {showHistory && historyData?.history && historyData.history.length > 0 && (
          <div className="space-y-1 pt-2 border-t border-border/30">
            <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5 mb-2">
              <History className="w-3.5 h-3.5" />
              Últimas rajadas
            </div>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {historyData.history.map((entry, idx) => (
                <div key={idx} className="flex items-center justify-between text-[10px] py-1 px-2 rounded bg-card/50 border border-border/30">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{new Date(entry.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <span className="font-mono font-bold text-violet-300">{entry.symbol}</span>
                    <Badge variant="outline" className="text-[9px] h-4 px-1 capitalize">{entry.mode}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">${entry.totalStaked.toFixed(2)}</span>
                    <span className={`font-bold ${entry.expectedProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
                      EV: {entry.expectedProfit >= 0 ? "+" : ""}${entry.expectedProfit.toFixed(2)}
                    </span>
                    <span className="text-muted-foreground">{entry.openedContracts}/10</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {totalConfigured === 0 && (
          <div className="text-center py-6 text-muted-foreground text-sm">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="font-medium">Adicione uma conta em cada dígito para começar.</p>
            <p className="text-xs mt-2 max-w-sm mx-auto">
              Cada dígito (0-9) usa uma conta Deriv separada. Com os 10 dígitos configurados,
              o motor Kelly distribui stakes automaticamente — dígitos quentes recebem mais,
              dígitos frios recebem o mínimo — maximizando o valor esperado por rajada.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
