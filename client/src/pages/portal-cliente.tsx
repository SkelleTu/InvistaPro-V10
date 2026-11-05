import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Activity, ArrowDownLeft, ArrowUpRight, BarChart3, Bell, ChevronRight, Users,
  CircleDollarSign, CreditCard, History, LayoutDashboard, LogOut,
  Menu, Network, RefreshCw, ShieldCheck, Sparkles, UserRound, Wallet, X
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Movement = {
  id?: string;
  tipo: string;
  valor: number | string;
  descricao?: string | null;
  createdAt?: string;
};

type Dashboard = {
  saldo?: number;
  totalTrades?: number;
  wonTrades?: number;
  winRate?: number;
  totalPnL?: number;
  movimentos?: Array<{ tipo: string; valor: number | string; data?: string }>;
};
type TradeActivity = {
  id: string; symbol?: string; tradeType?: string; direction?: string;
  amount?: number | string; duration?: number; status?: string;
  profit?: number | string | null; createdAt?: string; completedAt?: string;
};
type FinancialSummary = {
  balance: number; totalDeposits: number; totalYields: number; totalWithdrawals: number;
  netRecordedFlow: number; movementCount: number; lastMovementAt?: string | null;
};

const money = (value: unknown) => new Intl.NumberFormat("pt-BR", {
  style: "currency", currency: "BRL"
}).format(Number(value || 0));

const dateLabel = (value?: string) => value
  ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
  : "—";

const navItems = [
  { id: "inicio", label: "Visão geral", icon: LayoutDashboard },
  { id: "carteira", label: "Minha carteira", icon: Wallet },
  { id: "evolucao", label: "Minha evolução", icon: BarChart3 },
  { id: "afiliados", label: "Afiliados", icon: Network },
  { id: "historico", label: "Histórico", icon: History },
  { id: "perfil", label: "Meu perfil", icon: UserRound },
  { id: "energizar", label: "Energizar IA", icon: Sparkles },
];

export default function PortalCliente() {
  const { user } = useAuth();
  const [active, setActive] = useState("inicio");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [referralCopied, setReferralCopied] = useState(false);
  const [documentType, setDocumentType] = useState("rg_cnh_frente");
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [withdrawalAmount, setWithdrawalAmount] = useState("100");

  const dashboardQuery = useQuery<Dashboard>({
    queryKey: ["/api/dashboard/variable-income"],
    enabled: !!user,
    refetchInterval: 60_000,
  });
  const movementsQuery = useQuery<Movement[]>({
    queryKey: ["/api/movements?limit=500"],
    enabled: !!user,
    refetchInterval: 60_000,
  });
  const financialSummaryQuery = useQuery<FinancialSummary>({
    queryKey: ["/api/client/financial-summary"],
    enabled: !!user,
    refetchInterval: 60_000,
  });
  const tradeActivityQuery = useQuery<{ operations: TradeActivity[] }>({
    queryKey: ["/api/client/activity?limit=200"],
    enabled: !!user && (active === "historico" || active === "evolucao"),
    refetchInterval: 60_000,
  });
  const tradeOperations = tradeActivityQuery.data?.operations ?? [];
  const movements = movementsQuery.data ?? [];
  const documentsQuery = useQuery<any[]>({
    queryKey: ["/api/documents"],
    enabled: !!user && active === "perfil",
    refetchInterval: 120_000,
  });
  const withdrawalQuoteMutation = useMutation({
    mutationFn: async () => {
      const amount = Number(withdrawalAmount);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Informe um valor válido.");
      const response = await apiRequest("/api/withdrawal/quote", {
        method: "POST",
        body: JSON.stringify({ valor: amount }),
      });
      return response.json() as Promise<{
        valorSolicitado: number; taxaPercentual: number; taxaServico: number;
        valorLiquido: number; moeda: string; status: string; aviso: string;
      }>;
    },
  });
  const uploadDocumentMutation = useMutation({
    mutationFn: async () => {
      if (!documentFile) throw new Error("Selecione um arquivo antes de enviar.");
      const formData = new FormData();
      formData.append("tipo", documentType);
      formData.append("documento", documentFile);
      const response = await fetch("/api/documents/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || "Não foi possível enviar o documento.");
      }
      return response.json();
    },
    onSuccess: async () => {
      setDocumentFile(null);
      await queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
    },
  });
  const affiliatesQuery = useQuery<{
    referralCode: string; referralLink: string; directReferrals: number; totalNetwork: number;
    commissionRatePercent: number; commissionTotal: number; commissionEvents: number;
    pendingCommissionEvents: number;
    referrals: Array<{ id: string; displayName: string; level: number; createdAt?: string }>;
    network: Array<{ id: string; displayName: string; level: number; createdAt?: string }>;
    commissionNotice: string;
  }>({
    queryKey: ["/api/affiliates"],
    enabled: !!user && active === "afiliados",
    refetchInterval: 60_000,
    retry: false,
  });
  const evolutionData = useMemo(() => {
    const sorted = [...movements]
      .filter((item) => item.createdAt && Number.isFinite(Number(item.valor)))
      .sort((a, b) => new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime());
    const byDay = new Map<string, number>();
    let running = 0;
    for (const item of sorted) {
      const kind = String(item.tipo || "").toLowerCase();
      const value = Number(item.valor || 0);
      if (kind === "deposito") running += value;
      else if (kind === "rendimento") running += value;
      else if (kind === "saque") running -= value;
      else continue;
      const day = new Date(item.createdAt!).toLocaleDateString("pt-BR");
      byDay.set(day, running);
    }
    return Array.from(byDay, ([data, valor]) => ({ data, valor: Number(valor.toFixed(2)) })).slice(-30);
  }, [movements]);
  const recentDeposits = useMemo(() => movements.filter((item) => item.tipo === "deposito").reduce((sum, item) => sum + Number(item.valor || 0), 0), [movements]);
  const recentWithdrawals = useMemo(() => movements.filter((item) => item.tipo === "saque").reduce((sum, item) => sum + Number(item.valor || 0), 0), [movements]);
  const recentYields = useMemo(() => movements.filter((item) => item.tipo === "rendimento").reduce((sum, item) => sum + Number(item.valor || 0), 0), [movements]);
  const totalDeposits = Number(financialSummaryQuery.data?.totalDeposits ?? recentDeposits);
  const totalWithdrawals = Number(financialSummaryQuery.data?.totalWithdrawals ?? recentWithdrawals);
  const totalYields = Number(financialSummaryQuery.data?.totalYields ?? recentYields);
  const recordedNetFlow = Number(financialSummaryQuery.data?.netRecordedFlow ?? (totalDeposits + totalYields - totalWithdrawals));
  const balance = Number(financialSummaryQuery.data?.balance ?? dashboardQuery.data?.saldo ?? user?.saldo ?? 0);

  const logout = async () => {
    try {
      await apiRequest("/api/logout", { method: "POST" });
    } finally {
      queryClient.clear();
      window.location.href = "/auth";
    }
  };

  const selectTab = (id: string) => {
    setActive(id);
    setMobileOpen(false);
    setNotificationsOpen(false);
    if (id === "energizar") window.dispatchEvent(new Event("invista:open-ai-assistant"));
  };

  const SidebarContent = () => (
    <>
      <div className="flex items-center gap-3 px-5 py-6 border-b border-white/10">
        <div className="h-10 w-10 rounded-xl bg-violet-500/20 border border-violet-300/20 flex items-center justify-center">
          <Activity className="h-5 w-5 text-violet-300" />
        </div>
        <div>
          <p className="font-bold tracking-wide text-white">INVISTA<span className="text-violet-300">PRO</span></p>
          <p className="text-[10px] uppercase tracking-[.22em] text-slate-500">Portal do cliente</p>
        </div>
      </div>
      <div className="px-4 pt-6 pb-2 text-[10px] uppercase tracking-[.2em] text-slate-500">Seu espaço</div>
      <nav className="px-3 space-y-1">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => selectTab(id)}
            className={`w-full flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition ${active === id ? "bg-violet-500/15 text-violet-200 border border-violet-400/20" : "text-slate-400 hover:bg-white/5 hover:text-white"}`}>
            <Icon className="h-4 w-4" /> <span>{label}</span>
            {active === id && <ChevronRight className="h-4 w-4 ml-auto" />}
          </button>
        ))}
      </nav>
      <div className="mt-6 px-3">
        <button onClick={() => selectTab("energizar")}
          className="w-full rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-950/40 hover:brightness-110">
          <span className="flex items-center justify-center gap-2"><Sparkles className="h-4 w-4" /> ENERGIZAR IA</span>
        </button>
      </div>
      <div className="mt-auto p-4">
        <div className="rounded-xl border border-white/10 bg-white/[.03] p-3 mb-3">
          <div className="flex items-center gap-2 text-xs text-slate-300"><ShieldCheck className="h-4 w-4 text-emerald-400" /> Área autenticada</div>
          <p className="mt-1 text-[11px] text-slate-500">Seus dados são carregados da conta vinculada ao seu login.</p>
        </div>
        <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-2 text-sm text-slate-400 hover:text-white">
          <LogOut className="h-4 w-4" /> Sair da conta
        </button>
      </div>
    </>
  );

  const PageTitle = ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div className="mb-7">
      <p className="text-xs uppercase tracking-[.2em] text-violet-300 mb-2">Área do cliente</p>
      <h1 className="text-2xl sm:text-3xl font-bold text-white">{title}</h1>
      <p className="text-sm text-slate-400 mt-2">{subtitle}</p>
    </div>
  );

  const Metric = ({ label, value, icon: Icon, detail }: { label: string; value: string; icon: any; detail: string }) => (
    <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 shadow-xl shadow-black/10">
      <div className="flex items-center justify-between">
        <span className="text-sm text-slate-400">{label}</span>
        <span className="h-9 w-9 rounded-xl bg-violet-500/10 flex items-center justify-center"><Icon className="h-4 w-4 text-violet-300" /></span>
      </div>
      <p className="text-2xl font-bold text-white mt-4">{value}</p>
      <p className="text-xs text-slate-500 mt-1">{detail}</p>
    </div>
  );

  const MovementList = ({ limit }: { limit?: number }) => {
    const list = limit ? movements.slice(0, limit) : movements;
    if (movementsQuery.isLoading) return <div className="p-6 text-sm text-slate-400">Carregando movimentações…</div>;
    if (movementsQuery.isError) return <div className="p-6 text-sm text-rose-300">Não foi possível carregar o histórico. Atualize a página para tentar novamente.</div>;
    if (!list.length) return <div className="p-8 text-center text-sm text-slate-500">Nenhuma movimentação encontrada nesta conta.</div>;
    return <div className="divide-y divide-white/5">{list.map((item, index) => {
      const isDeposit = item.tipo === "deposito";
      const isYield = item.tipo === "rendimento";
      return <div key={item.id ?? `${item.tipo}-${item.createdAt}-${index}`} className="flex items-center gap-3 px-5 py-4">
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${isDeposit ? "bg-emerald-500/10 text-emerald-300" : isYield ? "bg-violet-500/10 text-violet-300" : "bg-amber-500/10 text-amber-300"}`}>
          {isDeposit ? <ArrowDownLeft className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-200 capitalize">{item.descricao || (isDeposit ? "Aporte" : isYield ? "Rendimento" : "Saque")}</p>
          <p className="text-xs text-slate-500">{dateLabel(item.createdAt)}</p>
        </div>
        <p className={`text-sm font-semibold ${isDeposit || isYield ? "text-emerald-300" : "text-slate-300"}`}>{money(item.valor)}</p>
      </div>;
    })}</div>;
  };

  const renderContent = () => {
    if (active === "inicio") return <>
      <PageTitle title={`Olá, ${user?.nomeCompleto?.split(" ")[0] || "cliente"}.`} subtitle="Aqui está o resumo das informações registradas na sua conta." />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
        <Metric label="Saldo atual" value={money(balance)} icon={Wallet} detail="Valor informado pelo backend da sua conta" />
        <Metric label="Aportes registrados" value={money(totalDeposits)} icon={ArrowDownLeft} detail="Soma das movimentações classificadas como aporte" />
        <Metric label="Saques registrados" value={money(totalWithdrawals)} icon={ArrowUpRight} detail="Soma das movimentações classificadas como saque" />
        <Metric label="Operações registradas" value={String(dashboardQuery.data?.totalTrades ?? "—")} icon={Activity} detail="Quantidade retornada pelo motor" />
        <Metric label="Operações vencedoras" value={String(dashboardQuery.data?.wonTrades ?? "—")} icon={BarChart3} detail="Operações concluídas com resultado positivo" />
        <Metric label="Taxa de acerto" value={dashboardQuery.data?.winRate == null ? "—" : `${Number(dashboardQuery.data.winRate).toFixed(2)}%`} icon={Activity} detail="Percentual calculado pelo backend" />
        <Metric label="Resultado das operações" value={money(dashboardQuery.data?.totalPnL ?? 0)} icon={BarChart3} detail="PnL real registrado, pode ser negativo" />
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-4">
        <section className="rounded-2xl border border-white/10 bg-slate-900/70 overflow-hidden">
          <div className="flex items-center justify-between p-5 border-b border-white/5"><div><h2 className="font-semibold text-white">Movimentações recentes</h2><p className="text-xs text-slate-500 mt-1">Dados vinculados à sua conta</p></div><button onClick={() => selectTab("historico")} className="text-xs text-violet-300 hover:text-white">Ver histórico</button></div>
          <MovementList limit={5} />
        </section>
        <section className="rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-950/60 to-slate-900 p-5">
          <div className="h-10 w-10 rounded-xl bg-violet-400/15 flex items-center justify-center mb-4"><Sparkles className="h-5 w-5 text-violet-200" /></div>
          <h2 className="text-lg font-semibold text-white">Central do cliente</h2>
          <p className="text-sm text-slate-400 mt-2 leading-6">Consulte sua carteira, acompanhe os registros financeiros e acesse as funcionalidades disponíveis para sua conta.</p>
          <Button onClick={() => selectTab("carteira")} className="mt-5 bg-violet-600 hover:bg-violet-500 text-white">Abrir minha carteira</Button>
        </section>
      </div>
    </>;

    if (active === "carteira") return <>
      <PageTitle title="Minha carteira" subtitle="Visão dos valores registrados no sistema para sua conta." />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <Metric label="Saldo registrado" value={money(balance)} icon={Wallet} detail="Saldo retornado pelo backend" />
        <Metric label="Aportes registrados" value={money(totalDeposits)} icon={CreditCard} detail="Resumo completo do banco" />
        <Metric label="Rendimentos registrados" value={money(totalYields)} icon={Activity} detail="Movimentações classificadas como rendimento" />
        <Metric label="Saques históricos" value={money(totalWithdrawals)} icon={ArrowUpRight} detail="Movimentações classificadas como saque" />
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
        <h2 className="font-semibold text-white mb-2">Conferência do histórico</h2>
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-slate-400">Fluxo líquido histórico registrado</span><strong className="text-lg text-white">{money(recordedNetFlow)}</strong></div>
        <p className="text-xs text-slate-500 mt-2">A soma considera aportes + rendimentos − saques. O resumo completo vem do banco; se estiver indisponível, a tela usa os últimos 500 registros. Não substitui conciliação contábil nem determina o valor disponível.</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 mt-4">
        <h2 className="font-semibold text-white mb-2">Composição e disponibilidade</h2>
        <p className="text-sm leading-6 text-slate-400">O backend atual ainda não fornece uma separação auditável entre principal, lucro realizado, capital comprometido e valor efetivamente disponível para saque. Por isso, esta tela não estima nem promete esses valores.</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 mt-4">
        <h2 className="font-semibold text-white mb-2">Simular taxa de serviço do saque</h2>
        <p className="text-xs text-slate-500 mb-4">A taxa informativa aprovada é de 7,8%. Esta simulação não solicita saque, não reserva saldo e não transfere dinheiro.</p>
        <div className="flex flex-col sm:flex-row gap-3">
          <label className="flex-1 text-xs text-slate-400">Valor bruto solicitado (R$)
            <input inputMode="decimal" type="number" min="0.01" step="0.01" value={withdrawalAmount} onChange={e=>{setWithdrawalAmount(e.target.value);withdrawalQuoteMutation.reset();}} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-base text-white outline-none focus:border-violet-400" />
          </label>
          <div className="flex items-end"><Button onClick={()=>withdrawalQuoteMutation.mutate()} disabled={withdrawalQuoteMutation.isPending} className="bg-violet-600 hover:bg-violet-500 text-white">{withdrawalQuoteMutation.isPending ? "Calculando…" : "Calcular taxa"}</Button></div>
        </div>
        {withdrawalQuoteMutation.isError && <p className="text-sm text-rose-300 mt-3">{withdrawalQuoteMutation.error instanceof Error ? withdrawalQuoteMutation.error.message : "Não foi possível calcular a taxa."}</p>}
        {withdrawalQuoteMutation.data && <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          <div className="rounded-xl bg-black/20 p-3"><p className="text-xs text-slate-500">Valor bruto</p><p className="text-lg text-white font-semibold">{money(withdrawalQuoteMutation.data.valorSolicitado)}</p></div>
          <div className="rounded-xl bg-black/20 p-3"><p className="text-xs text-slate-500">Taxa de 7,8%</p><p className="text-lg text-amber-300 font-semibold">{money(withdrawalQuoteMutation.data.taxaServico)}</p></div>
          <div className="rounded-xl bg-black/20 p-3"><p className="text-xs text-slate-500">Líquido estimado</p><p className="text-lg text-emerald-300 font-semibold">{money(withdrawalQuoteMutation.data.valorLiquido)}</p></div>
        </div>}
      </div>
      <div className="rounded-2xl border border-amber-400/20 bg-slate-900/70 p-5 mt-4">
        <h2 className="font-semibold text-white">Saques</h2>
        <p className="text-sm text-slate-400 mt-2">A consulta de saldo e o histórico continuam disponíveis. Solicitações e transferências de saque estão desativadas até a integração real com o provedor financeiro.</p>
      </div>
    </>;

    if (active === "evolucao") return <>
      <PageTitle title="Minha evolução" subtitle="Linha histórica calculada exclusivamente a partir das movimentações disponíveis nesta conta." />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Metric label="Aportes registrados" value={money(totalDeposits)} icon={ArrowDownLeft} detail="Total no histórico carregado" />
        <Metric label="Saques registrados" value={money(totalWithdrawals)} icon={ArrowUpRight} detail="Total no histórico carregado" />
        <Metric label="Operações registradas" value={String(dashboardQuery.data?.totalTrades ?? "—")} icon={Activity} detail="Estatística da API da conta" />
        <Metric label="Resultado operacional" value={money(dashboardQuery.data?.totalPnL ?? 0)} icon={BarChart3} detail="Lucros e perdas registrados pelo motor" />
      </div>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div><h2 className="font-semibold text-white">Fluxo líquido acumulado</h2><p className="text-xs text-slate-500 mt-1">Depósitos + rendimentos − saques, conforme registros retornados pela API.</p></div>
          <span className="text-xs text-slate-500">Até 30 datas do histórico carregado</span>
        </div>
        {movementsQuery.isLoading ? <p className="text-sm text-slate-400 p-8 text-center">Carregando histórico…</p> :
          movementsQuery.isError ? <p className="text-sm text-rose-300 p-8 text-center">Não foi possível carregar a evolução.</p> :
          evolutionData.length < 2 ? <p className="text-sm text-slate-400 p-8 text-center">Ainda não há movimentações suficientes para formar uma linha histórica.</p> :
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={evolutionData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#293044" />
                <XAxis dataKey="data" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(v) => money(v)} width={92} />
                <Tooltip formatter={(value: number) => money(value)} labelStyle={{ color: "#e2e8f0" }} contentStyle={{ background: "#0b0e1a", border: "1px solid #37304d", borderRadius: 12 }} />
                <Line type="monotone" dataKey="valor" name="Fluxo acumulado" stroke="#a78bfa" strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>}
        <p className="text-[11px] leading-5 text-amber-300/80 mt-3">O gráfico usa até 500 movimentações recentes. Os totais de aportes, rendimentos e saques vêm do resumo completo do banco. Nenhum dos dois substitui conciliação patrimonial ou define capital disponível.</p>
      </section>
    </>;

    if (active === "afiliados") return <>
      <PageTitle title="Minha rede de afiliados" subtitle="Seu link de indicação, rede cadastrada e eventos de comissão registrados." />
      {affiliatesQuery.isLoading ? <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-8 text-sm text-slate-400">Carregando sua rede…</div> :
       affiliatesQuery.isError || !affiliatesQuery.data ? <div className="rounded-2xl border border-rose-400/20 bg-rose-950/20 p-6 text-sm text-rose-200">Não foi possível carregar os dados de afiliados. Tente atualizar a página.</div> : <>
        <section className="rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-950/60 to-slate-900 p-6 mb-5">
          <div className="flex items-center gap-3 mb-3"><Network className="h-6 w-6 text-violet-200" /><h2 className="font-semibold text-white">Seu link de indicação</h2></div>
          <p className="text-xs text-slate-400 mb-2">Código exclusivo</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 rounded-xl bg-black/30 border border-white/10 px-4 py-3 font-mono tracking-widest text-violet-200">{affiliatesQuery.data.referralCode}</div>
            <Button onClick={() => navigator.clipboard.writeText(window.location.origin + affiliatesQuery.data!.referralLink).then(()=>setReferralCopied(true)).catch(()=>setReferralCopied(false))} className="bg-violet-600 hover:bg-violet-500 text-white">{referralCopied ? "Link copiado" : "Copiar link"}</Button>
          </div>
          <p className="text-xs text-slate-500 mt-3 break-all">{window.location.origin + affiliatesQuery.data.referralLink}</p>
        </section>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-5">
          <Metric label="Indicações diretas" value={String(affiliatesQuery.data.directReferrals)} icon={Users} detail="Contas cadastradas com seu código" />
          <Metric label="Rede total" value={String(affiliatesQuery.data.totalNetwork)} icon={Network} detail="Rede descendente até 10 níveis" />
          <Metric label="Comissões registradas" value={money(affiliatesQuery.data.commissionTotal)} icon={Wallet} detail="Soma do ledger; não representa saldo sacável" />
          <Metric label="Taxa prevista" value={`${affiliatesQuery.data.commissionRatePercent.toFixed(2)}%`} icon={Activity} detail="Base elegível conforme regra do programa" />
        </div>
        <p className="text-xs text-slate-500 mb-4">Eventos de comissão pendentes: {affiliatesQuery.data.pendingCommissionEvents}</p>
        <section className="rounded-2xl border border-white/10 bg-slate-900/70 overflow-hidden mb-5">
          <div className="p-5 border-b border-white/10"><h2 className="font-semibold text-white">Rede de indicações</h2><p className="text-xs text-slate-500 mt-1">Privacidade: nomes abreviados e sem dados de contato de terceiros.</p></div>
          {!affiliatesQuery.data.network.length ? <p className="p-7 text-center text-sm text-slate-500">Você ainda não possui indicações cadastradas.</p> :
            <div className="divide-y divide-white/5">{affiliatesQuery.data.network.map((referral) => <div key={referral.id} className="flex items-center justify-between gap-3 px-5 py-4"><div className="flex items-center gap-3"><div className="h-9 w-9 rounded-full bg-violet-500/10 flex items-center justify-center text-violet-200"><Users className="h-4 w-4" /></div><div><span className="text-sm text-slate-200">{referral.displayName}</span><p className="text-[10px] text-slate-500">Nível {referral.level}</p></div></div><span className="text-xs text-slate-500">{dateLabel(referral.createdAt)}</span></div>)}</div>}
        </section>
        <div className="rounded-xl border border-amber-400/20 bg-amber-950/20 p-4 text-xs leading-5 text-amber-200/90">{affiliatesQuery.data.commissionNotice} A base de cálculo e a liberação de comissões dependem da regra final do programa e da integração de pagamentos. O saldo de comissão não é sacável nesta etapa.</div>
      </>}
    </>;

    if (active === "historico") return <>
      <PageTitle title="Histórico completo" subtitle="Movimentações financeiras e operações registradas na sua própria conta." />
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 overflow-hidden mb-5">
        <div className="p-5 border-b border-white/10"><h2 className="font-semibold text-white">Movimentações financeiras</h2></div>
        <MovementList />
      </div>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 overflow-hidden">
        <div className="p-5 border-b border-white/10"><h2 className="font-semibold text-white">Histórico de operações</h2><p className="text-xs text-slate-500 mt-1">Ativos, direção, valor, estado e resultado retornados pelo motor.</p></div>
        {tradeActivityQuery.isLoading ? <p className="p-6 text-sm text-slate-400">Carregando operações…</p> :
         tradeActivityQuery.isError ? <p className="p-6 text-sm text-rose-200">Não foi possível carregar as operações.</p> :
         !tradeOperations.length ? <p className="p-7 text-center text-sm text-slate-500">Nenhuma operação registrada para esta conta.</p> :
         <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-white/[.02] text-xs uppercase tracking-wider text-slate-500"><tr><th className="text-left px-5 py-3">Ativo</th><th className="text-left px-5 py-3">Direção</th><th className="text-left px-5 py-3">Status</th><th className="text-left px-5 py-3">Data</th><th className="text-right px-5 py-3">Valor</th><th className="text-right px-5 py-3">Resultado</th></tr></thead><tbody className="divide-y divide-white/5">{tradeOperations.map(op=><tr key={op.id}><td className="px-5 py-3 text-slate-200">{op.symbol || "—"}</td><td className="px-5 py-3 text-slate-300 capitalize">{op.direction || op.tradeType || "—"}</td><td className="px-5 py-3 text-slate-400 capitalize">{op.status || "—"}</td><td className="px-5 py-3 text-slate-500">{dateLabel(op.createdAt)}</td><td className="px-5 py-3 text-right text-slate-200">{money(op.amount)}</td><td className={`px-5 py-3 text-right font-medium ${Number(op.profit||0)>=0?"text-emerald-300":"text-rose-300"}`}>{op.profit == null ? "—" : money(op.profit)}</td></tr>)}</tbody></table></div>}
      </section>
    </>;

    if (active === "energizar") return <>
      <PageTitle title="Energizar IA" subtitle="Assistente integrado à sua conta para consultar dados e histórico registrados." />
      <section className="rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-950/50 to-slate-900 p-6">
        <div className="flex items-center gap-3 mb-3"><Sparkles className="h-7 w-7 text-violet-200"/><h2 className="font-semibold text-white text-lg">Assistente Invista Pro</h2></div>
        <p className="text-sm leading-6 text-slate-300 mb-4">A IA está conectada ao contexto permitido da sua conta. Clientes podem consultar movimentações e resultados individuais; controles do motor central e dados de outras contas permanecem restritos.</p>
        <Button onClick={()=>window.dispatchEvent(new Event("invista:open-ai-assistant"))} className="bg-violet-600 hover:bg-violet-500 text-white"><Sparkles className="h-4 w-4 mr-2"/>Abrir assistente IA</Button>
      </section>
    </>;
    if (active === "perfil") return <>
      <PageTitle title="Meu perfil" subtitle="Dados cadastrais e situação documental da conta autenticada." />
      <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-6 grid grid-cols-1 sm:grid-cols-2 gap-5">
        {[["Nome", user?.nomeCompleto], ["E-mail", user?.email], ["Telefone", user?.telefone], ["Cidade", user?.cidade], ["Estado", user?.estado], ["CEP", user?.cep], ["Conta", user?.contaAprovada ? "Aprovada" : "Pendente"], ["Documentação", user?.documentosVerificados ? "Verificada" : "Não verificada"]].map(([label, value]) => <div key={label as string}><p className="text-xs uppercase tracking-wider text-slate-500">{label}</p><p className="text-sm text-slate-200 mt-1">{value || "Não informado"}</p></div>)}
      </div>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 mt-5 overflow-hidden">
        <div className="p-5 border-b border-white/10"><h2 className="font-semibold text-white">Meus documentos</h2><p className="text-xs text-slate-500 mt-1">Situação dos documentos vinculados à sua conta.</p></div>
        {documentsQuery.isLoading ? <p className="p-5 text-sm text-slate-400">Carregando documentos…</p> :
          documentsQuery.isError ? <p className="p-5 text-sm text-rose-300">Não foi possível consultar os documentos.</p> :
          !documentsQuery.data?.length ? <p className="p-5 text-sm text-slate-400">Nenhum documento cadastrado.</p> :
          <div className="divide-y divide-white/5">{documentsQuery.data.map((doc) => <div key={doc.id} className="flex items-center justify-between gap-3 p-4"><div><p className="text-sm text-slate-200">{String(doc.tipo || "Documento").replaceAll("_", " ").toUpperCase()}</p><p className="text-xs text-slate-500">{doc.createdAt ? dateLabel(doc.createdAt) : "Data não informada"}</p></div><span className={`rounded-full px-3 py-1 text-xs ${doc.status === "aprovado" ? "bg-emerald-500/10 text-emerald-300" : doc.status === "rejeitado" ? "bg-rose-500/10 text-rose-300" : "bg-amber-500/10 text-amber-300"}`}>{doc.status || "pendente"}</span></div>)}</div>}
      </section>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 mt-5 p-5">
        <h2 className="font-semibold text-white">Enviar documento</h2>
        <p className="text-xs text-slate-500 mt-1">Arquivos JPG, PNG ou PDF até 5 MB. O envio fica pendente de análise administrativa.</p>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.5fr_auto] gap-3 mt-4">
          <select value={documentType} onChange={(e)=>setDocumentType(e.target.value)} className="rounded-xl bg-slate-950 border border-white/10 px-3 py-2.5 text-sm text-white">
            <option value="rg_cnh_frente">RG/CNH — frente</option><option value="rg_cnh_verso">RG/CNH — verso</option><option value="comprovante_residencia">Comprovante de residência</option>
          </select>
          <input type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onChange={(e)=>setDocumentFile(e.target.files?.[0] || null)} className="min-w-0 text-xs text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-violet-600 file:px-3 file:py-2 file:text-white" />
          <Button disabled={!documentFile || uploadDocumentMutation.isPending} onClick={()=>uploadDocumentMutation.mutate()} className="bg-violet-600 hover:bg-violet-500 text-white">{uploadDocumentMutation.isPending ? "Enviando…" : "Enviar arquivo"}</Button>
        </div>
        {documentFile && <p className="text-xs text-slate-400 mt-2">Selecionado: {documentFile.name}</p>}
        {uploadDocumentMutation.isError && <p className="text-xs text-rose-300 mt-2">{uploadDocumentMutation.error.message}</p>}
        {uploadDocumentMutation.isSuccess && <p className="text-xs text-emerald-300 mt-2">Documento enviado e aguardando análise.</p>}
      </section>
    </>;

    return <>
      <PageTitle title="Energizar IA" subtitle="Central de acompanhamento e acesso ao assistente inteligente Invista Pro." />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <section className="rounded-2xl border border-violet-400/20 bg-gradient-to-br from-violet-950/60 to-slate-900 p-6">
          <div className="h-12 w-12 rounded-xl bg-violet-400/15 flex items-center justify-center mb-4"><Sparkles className="h-6 w-6 text-violet-200" /></div>
          <h2 className="text-lg font-semibold text-white">IA Invista Pro</h2>
          <p className="text-sm text-slate-300 mt-2 leading-6">O assistente inteligente já está disponível no botão flutuante no canto inferior da tela. Use-o para tirar dúvidas e navegar pelas funcionalidades habilitadas para sua conta.</p>
          <div className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4"><p className="text-xs uppercase tracking-wider text-violet-200">Status</p><p className="text-sm text-white mt-1">Assistente conectado à sessão autenticada</p></div>
        </section>
        <section className="rounded-2xl border border-amber-400/20 bg-slate-900/70 p-6">
          <div className="flex items-center gap-3"><CircleDollarSign className="h-7 w-7 text-amber-300" /><h2 className="font-semibold text-white">Aportes e pagamentos</h2></div>
          <p className="text-sm text-slate-300 mt-3 leading-6">A área visual está preparada, mas a geração de cobranças e a confirmação de depósitos estão temporariamente desativadas. Serão reativadas somente depois da integração real com o Mercado Pago e da validação do pagamento.</p>
          <div className="mt-5 rounded-xl border border-amber-400/20 bg-amber-950/20 p-4 text-xs text-amber-200">Nenhum QR Code ou comprovante será tratado como pagamento confirmado. Seu saldo não será alterado por uma confirmação manual.</div>
        </section>
      </div>
    </>;
  };

  return <div className="min-h-screen bg-[#070912] text-white flex">
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-white/10 bg-[#0b0e1a]"><SidebarContent /></aside>
    {mobileOpen && <div className="fixed inset-0 z-50 lg:hidden"><button className="absolute inset-0 bg-black/70" onClick={() => setMobileOpen(false)} aria-label="Fechar menu" /><aside className="relative z-10 w-72 h-full bg-[#0b0e1a] flex flex-col"><div className="flex justify-end p-2"><button onClick={() => setMobileOpen(false)} className="p-2 text-slate-400"><X /></button></div><SidebarContent /></aside></div>}
    <main className="min-w-0 flex-1">
      <header className="h-16 border-b border-white/10 bg-[#0b0e1a]/80 backdrop-blur flex items-center justify-between px-4 sm:px-7 sticky top-0 z-30">
        <div className="flex items-center gap-3"><button onClick={() => setMobileOpen(true)} className="lg:hidden text-slate-300"><Menu /></button><span className="text-xs text-slate-500 hidden sm:inline">INVISTA PRO /</span><span className="text-sm text-slate-200"> {navItems.find((item) => item.id === active)?.label ?? "Energizar IA"}</span></div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <button onClick={()=>setNotificationsOpen((open)=>!open)} className="h-9 w-9 rounded-full border border-white/10 flex items-center justify-center text-slate-400 hover:text-white" title="Atividade recente" aria-expanded={notificationsOpen}><Bell className="h-4 w-4" />{movements.length>0&&<span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-violet-400" />}</button>
            {notificationsOpen&&<div className="absolute right-0 top-12 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-white/10 bg-[#101426] shadow-2xl overflow-hidden">
              <div className="p-4 border-b border-white/10"><p className="text-sm font-semibold text-white">Atividade recente</p><p className="text-[11px] text-slate-500 mt-1">Movimentações registradas na sua conta</p></div>
              {!movements.length?<p className="p-4 text-xs text-slate-500">Nenhuma atividade registrada.</p>:<div className="divide-y divide-white/5">{movements.slice(0,5).map((item,index)=><button key={item.id??index} onClick={()=>{setNotificationsOpen(false);selectTab("historico");}} className="w-full text-left p-3 hover:bg-white/5"><div className="flex justify-between gap-2"><span className="text-xs text-slate-200 capitalize">{item.descricao||item.tipo}</span><span className="text-xs text-violet-200">{money(item.valor)}</span></div><p className="text-[10px] text-slate-500 mt-1">{dateLabel(item.createdAt)}</p></button>)}</div>}
              <button onClick={()=>{setNotificationsOpen(false);selectTab("historico");}} className="w-full border-t border-white/10 p-3 text-xs text-violet-300 hover:bg-white/5">Abrir histórico completo</button>
            </div>}
          </div>
          <div className="hidden sm:block text-right"><p className="text-xs font-medium text-white">{user?.nomeCompleto}</p><p className="text-[10px] text-slate-500">Conta do cliente</p></div>
          <div className="h-9 w-9 rounded-full bg-violet-500/20 border border-violet-300/20 flex items-center justify-center text-sm font-bold text-violet-200">{user?.nomeCompleto?.slice(0,1) || "C"}</div>
        </div>
      </header>
      <div className="max-w-7xl mx-auto p-4 sm:p-7 lg:p-9">
        <div className="flex items-center justify-between mb-6"><div className="flex items-center gap-2 text-xs text-slate-500"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Conectado à sua conta</div><Button variant="ghost" size="sm" onClick={() => { dashboardQuery.refetch(); movementsQuery.refetch(); financialSummaryQuery.refetch(); tradeActivityQuery.refetch(); affiliatesQuery.refetch(); documentsQuery.refetch(); }} className="text-slate-400 hover:text-white"><RefreshCw className="h-4 w-4 mr-2" />Atualizar</Button></div>
        {dashboardQuery.isError && <div className="mb-5 rounded-xl border border-rose-400/20 bg-rose-950/30 p-4 text-sm text-rose-200">Não foi possível atualizar o saldo pelo backend. Os dados exibidos podem estar desatualizados.</div>}
        {financialSummaryQuery.isError && <div className="mb-5 rounded-xl border border-amber-400/20 bg-amber-950/20 p-4 text-sm text-amber-200">O resumo financeiro completo não está disponível. Os totais podem refletir apenas as movimentações recentes carregadas.</div>}
        {renderContent()}
        <footer className="mt-10 border-t border-white/10 pt-5 text-[11px] text-slate-600 flex flex-wrap justify-between gap-2"><span>Invista Pro · Portal do Cliente</span><span>Informações financeiras sujeitas à conciliação do sistema.</span></footer>
      </div>
    </main>
  </div>;
}
