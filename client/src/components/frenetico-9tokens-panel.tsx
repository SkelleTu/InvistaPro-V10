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
  TrendingUp, DollarSign, Flame, Snowflake, Circle
} from "lucide-react";

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
}

interface BalancesResponse {
  sharedAsset: string | null;
  digitHeats: DigitHeat[];
  balances: SlotBalance[];
}

// Slot N → dígito N (slot 0 = dígito 0, slot 9 = dígito 9)
const DIGIT_COLORS = [
  "border-violet-500/40", "border-blue-500/40", "border-cyan-500/40",
  "border-teal-500/40", "border-green-500/40", "border-yellow-500/40",
  "border-orange-500/40", "border-red-500/40", "border-pink-500/40",
  "border-rose-500/40",
];

function HeatIcon({ label }: { label: "hot" | "neutral" | "cold" }) {
  if (label === "hot") return <Flame className="w-3 h-3 text-orange-400" />;
  if (label === "cold") return <Snowflake className="w-3 h-3 text-blue-400" />;
  return <Circle className="w-3 h-3 text-muted-foreground" />;
}

function heatColor(label: "hot" | "neutral" | "cold") {
  if (label === "hot") return "text-orange-400";
  if (label === "cold") return "text-blue-400";
  return "text-muted-foreground";
}

export default function Frenetico9TokensPanel() {
  const { toast } = useToast();
  const [activeSlotInput, setActiveSlotInput] = useState<number | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [accountType, setAccountType] = useState<"demo" | "real">("demo");
  const [showToken, setShowToken] = useState(false);
  const [burstAmount, setBurstAmount] = useState("0.35");

  const { data: slotsData, isLoading, refetch } = useQuery<{ slots: SlotInfo[]; totalConfigured: number }>({
    queryKey: ["/api/trading/deriv-tokens/slots"],
    refetchInterval: 10000,
  });

  const { data: balancesData, refetch: refetchBalances } = useQuery<BalancesResponse>({
    queryKey: ["/api/trading/deriv-tokens/slots/balances"],
    refetchInterval: 30000,
    enabled: (slotsData?.totalConfigured ?? 0) > 0,
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
        title: `Slot ${data.slotIndex + 1} configurado!`,
        description: `Conta ${data.accountType === 'demo' ? 'Demo' : 'Real'} conectada${data.balance != null ? ` — Saldo: $${data.balance.toFixed(2)}` : ''}`,
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
      toast({ title: `Slot ${slotIndex + 1} removido`, description: "Token desconfigurado com sucesso" });
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
        body: JSON.stringify({ amount: parseFloat(burstAmount), duration: 1 }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    onSuccess: (data) => {
      const hotDigits = (data.digitHeats ?? []).filter((d: DigitHeat) => d.label === "hot").map((d: DigitHeat) => d.digit);
      toast({
        title: `⚡ Rajada! ${data.openedContracts}/${data.totalSlots} contratos abertos`,
        description: `${data.targetSymbol} · cobertura ${data.coveragePercent}% (dígitos 0-9) · ${data.burstDurationMs}ms${hotDigits.length > 0 ? ` · 🔥 quentes: [${hotDigits.join(",")}]` : ""}`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Erro na rajada", description: err.message, variant: "destructive" });
    },
  });

  const configuredSlots = slotsData?.slots ?? [];
  const getSlotInfo = (idx: number) => configuredSlots.find(s => s.slotIndex === idx);
  const getSlotBalance = (idx: number) => balancesData?.balances?.find(b => b.slotIndex === idx);
  const sharedAsset = balancesData?.sharedAsset ?? null;

  const totalConfigured = slotsData?.totalConfigured ?? 0;
  const totalBalance = balancesData?.balances
    ?.filter(b => b.balance != null)
    ?.reduce((sum, b) => sum + (b.balance ?? 0), 0) ?? 0;

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
                Slot 0→dígito 0 … Slot 9→dígito 9 · mesmo ativo · disparo simultâneo
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

        {totalConfigured > 0 && (
          <div className="mt-3 p-3 rounded-lg bg-violet-500/5 border border-violet-500/20 text-xs text-muted-foreground space-y-2">
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
            <p>Cada slot cobre <strong>1 dígito fixo</strong> (slot 0 = dígito 0, slot 9 = dígito 9). No disparo, todos abrem DIGITMATCH no <strong>mesmo ativo e mesmo tick</strong>, cada um no seu dígito — cobertura total dos 10 dígitos com {totalConfigured} conta(s).</p>
            {balancesData?.digitHeats && (
              <div className="flex gap-1 flex-wrap pt-1">
                {balancesData.digitHeats.map(h => (
                  <span key={h.digit} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                    h.label === "hot" ? "bg-orange-500/20 text-orange-400" :
                    h.label === "cold" ? "bg-blue-500/20 text-blue-400" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    <HeatIcon label={h.label} />
                    {h.digit}
                    <span className="opacity-70 font-normal">{(h.frequency * 100).toFixed(0)}%</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Grid 2x5 dos slots */}
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 10 }, (_, i) => {
            const slot = getSlotInfo(i);
            const balance = getSlotBalance(i);
            const isConfiguring = activeSlotInput === i;
            const isConfigured = !!slot;
            // slot i → dígito i (fixo)
            const digitHeat = balancesData?.digitHeats?.[i];

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
                {/* Cabeçalho: dígito + indicador de calor */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base font-bold font-mono leading-none">{i}</span>
                    <span className="text-[10px] text-muted-foreground">dígito</span>
                    {digitHeat && (
                      <span className={`inline-flex items-center gap-0.5 text-[10px] ${heatColor(digitHeat.label)}`}>
                        <HeatIcon label={digitHeat.label} />
                        {(digitHeat.frequency * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                  {isConfigured && (
                    <Badge variant="outline" className="text-[10px] h-4 px-1 text-green-400 border-green-500/30">
                      ativo
                    </Badge>
                  )}
                </div>

                {isConfigured ? (
                  <>
                    <div className="space-y-1 mb-2">
                      <div className="flex items-center gap-1">
                        <Key className="w-3 h-3 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground font-mono">{slot.maskedToken}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {slot.accountType === 'demo' ? '🧪 Demo' : '💰 Real'}
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
                  </>
                ) : isConfiguring ? (
                  <div className="space-y-2">
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
                    className="w-full h-7 text-[10px] border-dashed"
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

        {/* Barra de ação — disparo manual */}
        {totalConfigured > 0 && (
          <div className="flex items-end gap-3 pt-2 border-t border-border/30">
            <div className="space-y-1">
              <Label className="text-xs">Valor por contrato (USD)</Label>
              <Input
                value={burstAmount}
                onChange={e => setBurstAmount(e.target.value)}
                type="number"
                min="0.35"
                step="0.10"
                className="h-8 w-28 text-xs"
                data-testid="input-burst-amount"
              />
            </div>
            <Button
              onClick={() => burstMutation.mutate()}
              disabled={burstMutation.isPending || totalConfigured === 0}
              className="h-8 bg-violet-600 hover:bg-violet-700 text-white"
              data-testid="btn-fire-burst"
            >
              {burstMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <PlayCircle className="w-4 h-4 mr-2" />
              )}
              Disparar Rajada ({totalConfigured} dígitos)
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() => { refetch(); refetchBalances(); }}
              data-testid="btn-refresh-slots"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        )}

        {totalConfigured === 0 && (
          <div className="text-center py-4 text-muted-foreground text-sm">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>Adicione uma conta em cada dígito para começar.</p>
            <p className="text-xs mt-1">Cada dígito (0-9) usa uma conta Deriv separada. Com 10 dígitos configurados, cada rajada cobre 100% dos dígitos no mesmo tick e ativo.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
