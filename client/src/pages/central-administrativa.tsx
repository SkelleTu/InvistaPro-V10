import { useMutation, useQuery } from "@tanstack/react-query";
import { Users, Wallet, ArrowDownLeft, ArrowUpRight, ShieldCheck, RefreshCw, LogOut, Search, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState } from "react";

type AdminStats = {
  totalUsers?: number; verifiedUsers?: number; pendingDocuments?: number;
  totalBalance?: number; totalInvested?: number; totalYields?: number; totalWithdrawals?: number;
  recentMovements?: number;
};
type AdminUser = {
  id: string; nomeCompleto: string; email: string; cpf?: string;
  saldo: number; documentosVerificados?: boolean; contaAprovada?: boolean; createdAt?: string;
};
type AffiliateSummary = { profiles: number; referrals: number; commissionEvents: number; commissionTotal: number };
type AffiliateLink = { id: string; referrerUserId: string; referrerName?: string; referrerEmail?: string; referredUserId: string; referredName?: string; referredEmail?: string; createdAt?: string };
type TradingSummary = { totalOperations: number; openOperations: number; winningOperations: number; losingOperations: number; netProfit: number; participatingUsers: number };

type AdminMovement = { id: string; tipo: string; valor: number; descricao?: string; createdAt?: string; user?: { nomeCompleto?: string; email?: string } };
type AdminReport = { id: string; scope: string; subjectUserId?: string | null; rowCount: number; contentSha256: string; createdAt?: string; downloadUrl: string };

type AdminUserDetail = {
  user: { id: string; nomeCompleto: string; email: string; cpf?: string; telefone?: string; endereco?: string; cidade?: string; estado?: string; cep?: string; saldo: number; contaAprovada?: boolean; documentosVerificados?: boolean; createdAt?: string };
  movements: Array<{ id: string; tipo: string; valor: number; descricao?: string; createdAt?: string }>;
  tradeOperations: Array<{ id: string; symbol: string; tradeType: string; direction: string; amount: number; duration: number; status?: string; profit?: number | null; createdAt?: string; completedAt?: string }>;
  documents: Array<{ id: string; tipo: string; status?: string; createdAt?: string; motivoRejeicao?: string }>;
  summary: { totalDeposited: number; totalWithdrawn: number; totalYield: number };
};

const money = (v: unknown) => new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}).format(Number(v||0));

export default function CentralAdministrativa() {
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportMessage, setReportMessage] = useState("");
  const generateReport = async (scope: "client" | "platform", userId?: string) => {
    setReportBusy(true); setReportMessage("");
    try {
      const response = await apiRequest("/api/admin/reports", { method: "POST", body: JSON.stringify({ scope, userId, reason: scope === "client" ? "Dossiê individual solicitado pelo administrador" : "Relatório consolidado solicitado pelo administrador" }) });
      const result = await response.json();
      if (!response.ok || !result.downloadUrl) throw new Error(result.message || "Falha ao gerar relatório.");
      setReportMessage("PDF gerado, arquivado e registrado na auditoria.");
      window.location.href = result.downloadUrl;
    } catch (error) {
      setReportMessage(error instanceof Error ? error.message : "Não foi possível gerar o PDF.");
    } finally { setReportBusy(false); }
  };
  const stats = useQuery<AdminStats>({queryKey:["/api/admin/stats"],retry:false});
  const users = useQuery<AdminUser[]>({queryKey:["/api/admin/users"],retry:false});
  const affiliates = useQuery<AffiliateSummary>({queryKey:["/api/admin/affiliates/summary"],retry:false});
  const affiliateNetwork = useQuery<AffiliateLink[]>({queryKey:["/api/admin/affiliates/network?limit=500"],retry:false});
  const trading = useQuery<TradingSummary>({queryKey:["/api/admin/trading/summary"],retry:false});
  const recentMovements = useQuery<AdminMovement[]>({queryKey:["/api/admin/movements"],retry:false});
  const reportArchive = useQuery<AdminReport[]>({queryKey:["/api/admin/reports"],retry:false});
  const pendingDocuments = useQuery<Array<{
    id: string; userId: string; tipo: string; status: string; createdAt?: string;
    user?: { nomeCompleto?: string; email?: string; cpf?: string };
  }>>({queryKey:["/api/admin/documents/pending"],retry:false});
  const reviewDocument = useMutation({
    mutationFn: async (payload: { documentId: string; approved: boolean; reason?: string }) => {
      const response = await apiRequest("/api/admin/documents/review", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return response.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/admin/documents/pending"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/admin/user"] }),
      ]);
    },
  });
  const userDetail = useQuery<AdminUserDetail>({
    queryKey: ["/api/admin/user", selectedUserId],
    queryFn: async () => {
      const response = await apiRequest(`/api/admin/user/${selectedUserId}`);
      return response.json();
    },
    enabled: !!selectedUserId,
    retry: false,
  });
  const logout = async () => { try { await apiRequest("/api/logout",{method:"POST"}); } finally { queryClient.clear(); window.location.href="/auth"; } };
  const filtered = (users.data ?? []).filter(u => `${u.nomeCompleto} ${u.email}`.toLowerCase().includes(search.toLowerCase()));
  const Stat = ({label,value,icon:Icon,sub}:{label:string;value:string;icon:any;sub:string}) => <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5"><div className="flex justify-between text-slate-400 text-sm"><span>{label}</span><Icon className="h-4 w-4 text-violet-300"/></div><div className="text-2xl font-bold text-white mt-4">{value}</div><div className="text-xs text-slate-500 mt-1">{sub}</div></div>;
  return <div className="min-h-screen bg-[#070912] text-white">
    <header className="border-b border-white/10 bg-[#0b0e1a] px-5 py-4"><div className="max-w-7xl mx-auto flex items-center justify-between gap-4"><div><p className="font-bold tracking-wide">INVISTA<span className="text-violet-300">PRO</span></p><p className="text-[10px] uppercase tracking-[.22em] text-slate-500">Central Administrativa Geral</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={reportBusy} onClick={()=>generateReport("platform")} className="border-violet-400/30 text-violet-200">{reportBusy ? "Gerando PDF…" : "PDF geral da plataforma"}</Button><Button variant="outline" onClick={()=>{stats.refetch();users.refetch();affiliates.refetch();affiliateNetwork.refetch();trading.refetch();pendingDocuments.refetch();recentMovements.refetch();reportArchive.refetch();if(selectedUserId)userDetail.refetch();}} className="border-white/15 text-slate-200"><RefreshCw className="h-4 w-4 mr-2"/>Atualizar</Button><Button variant="ghost" onClick={logout} className="text-slate-300"><LogOut className="h-4 w-4 mr-2"/>Sair</Button></div></div></header>
    <main className="max-w-7xl mx-auto p-5 sm:p-8">
      {reportMessage && <div role="status" className="mb-5 rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-200">{reportMessage}</div> }
      <div className="mb-7"><div className="flex items-center gap-2 text-xs uppercase tracking-[.2em] text-violet-300 mb-2"><ShieldCheck className="h-4 w-4"/>Acesso administrativo</div><h1 className="text-3xl font-bold">Visão consolidada</h1><p className="text-sm text-slate-400 mt-2">Dados retornados pelas rotas administrativas existentes no Invista Pro V10.</p></div>
      {stats.isError && <div className="rounded-xl border border-rose-400/20 bg-rose-950/30 p-4 text-sm text-rose-200 mb-5">Não foi possível consultar as estatísticas administrativas. A API pode não reconhecer este perfil como administrador.</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <Stat label="Clientes cadastrados" value={String(stats.data?.totalUsers ?? "—")} icon={Users} sub="Total de usuários registrados"/>
        <Stat label="Saldo total registrado" value={money(stats.data?.totalBalance)} icon={Wallet} sub="Soma do campo saldo dos usuários"/>
        <Stat label="Aportes registrados" value={money(stats.data?.totalInvested)} icon={ArrowDownLeft} sub="Movimentações classificadas como depósito"/>
        <Stat label="Saques registrados" value={money(stats.data?.totalWithdrawals)} icon={ArrowUpRight} sub="Movimentações classificadas como saque"/>
        <Stat label="Documentos verificados" value={String(stats.data?.verifiedUsers ?? "—")} icon={ShieldCheck} sub="Usuários com documentação verificada"/>
        <Stat label="Documentos pendentes" value={String(stats.data?.pendingDocuments ?? "—")} icon={Activity} sub="Aguardando análise"/>
        <Stat label="Rendimentos registrados" value={money(stats.data?.totalYields)} icon={Activity} sub="Registros históricos classificados como rendimento"/>
        <Stat label="Movimentações recentes" value={String(stats.data?.recentMovements ?? "—")} icon={RefreshCw} sub="Últimos 30 dias conforme API"/>
      </div>
      <section className="mb-8">
        <div className="mb-4"><h2 className="font-semibold text-white">Motor de execução — visão consolidada</h2><p className="text-xs text-slate-500 mt-1">Estatísticas agregadas das operações armazenadas para todas as contas.</p></div>
        {trading.isError ? <p className="text-sm text-rose-200 mb-4">Não foi possível carregar as estatísticas globais do motor.</p> :
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <Stat label="Operações registradas" value={String(trading.data?.totalOperations ?? "—")} icon={Activity} sub="Total no histórico operacional" />
            <Stat label="Operações abertas" value={String(trading.data?.openOperations ?? "—")} icon={RefreshCw} sub="Pendentes, ativas ou abertas" />
            <Stat label="Contas participantes" value={String(trading.data?.participatingUsers ?? "—")} icon={Users} sub="Clientes com operações registradas" />
            <Stat label="Operações positivas" value={String(trading.data?.winningOperations ?? "—")} icon={ArrowUpRight} sub="Resultado maior que zero" />
            <Stat label="Operações negativas" value={String(trading.data?.losingOperations ?? "—")} icon={ArrowDownLeft} sub="Resultado menor que zero" />
            <Stat label="PnL operacional agregado" value={money(trading.data?.netProfit)} icon={Wallet} sub="Soma dos resultados encerrados; pode ser negativo" />
          </div>}
      </section>
      <section className="mb-8">
        <div className="mb-4"><h2 className="font-semibold text-white">Rede de afiliados</h2><p className="text-xs text-slate-500 mt-1">Indicadores da rede e eventos registrados no ledger interno; não representam pagamentos realizados.</p></div>
        {affiliates.isError ? <p className="text-sm text-rose-200">Não foi possível carregar os indicadores de afiliados.</p> :
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Stat label="Códigos ativos" value={String(affiliates.data?.profiles ?? "—")} icon={Users} sub="Perfis com código de indicação" />
            <Stat label="Indicações registradas" value={String(affiliates.data?.referrals ?? "—")} icon={Activity} sub="Vínculos de indicação únicos" />
            <Stat label="Eventos de comissão" value={String(affiliates.data?.commissionEvents ?? "—")} icon={ShieldCheck} sub="Eventos de comissão gravados no ledger" />
            <Stat label="Comissões registradas" value={money(affiliates.data?.commissionTotal)} icon={Wallet} sub="Ledger de comissão, não saldo sacável" />
          </div>}
      </section>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 overflow-hidden mb-8">
        <div className="p-5 border-b border-white/10"><h2 className="font-semibold text-white">Vínculos globais de indicação</h2><p className="text-xs text-slate-500 mt-1">Relação entre indicador e conta indicada; consulta limitada aos 500 vínculos mais recentes.</p></div>
        {affiliateNetwork.isLoading ? <p className="p-6 text-sm text-slate-400">Carregando rede global…</p> :
         affiliateNetwork.isError ? <p className="p-6 text-sm text-rose-200">Não foi possível carregar os vínculos globais.</p> :
         !affiliateNetwork.data?.length ? <p className="p-6 text-sm text-slate-500">Nenhum vínculo de indicação registrado.</p> :
         <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-white/[.02] text-xs uppercase tracking-wider text-slate-500"><tr><th className="text-left px-5 py-3">Indicador</th><th className="text-left px-5 py-3">Conta indicada</th><th className="text-left px-5 py-3">Data do vínculo</th></tr></thead><tbody className="divide-y divide-white/5">{affiliateNetwork.data.map(link=><tr key={link.id}><td className="px-5 py-3"><p className="text-slate-200">{link.referrerName || "—"}</p><p className="text-xs text-slate-500">{link.referrerEmail || link.referrerUserId}</p></td><td className="px-5 py-3"><p className="text-slate-200">{link.referredName || "—"}</p><p className="text-xs text-slate-500">{link.referredEmail || link.referredUserId}</p></td><td className="px-5 py-3 text-slate-500">{link.createdAt ? new Date(link.createdAt).toLocaleString("pt-BR") : "—"}</td></tr>)}</tbody></table></div>}
      </section>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 overflow-hidden mb-8">
        <div className="p-5 border-b border-white/10"><h2 className="font-semibold text-white">Movimentações globais recentes</h2><p className="text-xs text-slate-500 mt-1">Últimas movimentações disponíveis no registro operacional atual.</p></div>
        {recentMovements.isLoading ? <p className="p-6 text-sm text-slate-400">Carregando movimentações…</p> :
         recentMovements.isError ? <p className="p-6 text-sm text-rose-200">Não foi possível carregar as movimentações globais.</p> :
         !recentMovements.data?.length ? <p className="p-6 text-sm text-slate-500">Nenhuma movimentação encontrada.</p> :
         <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-white/[.02] text-xs uppercase tracking-wider text-slate-500"><tr><th className="text-left px-5 py-3">Cliente</th><th className="text-left px-5 py-3">Tipo</th><th className="text-left px-5 py-3">Descrição</th><th className="text-left px-5 py-3">Data</th><th className="text-right px-5 py-3">Valor</th></tr></thead><tbody className="divide-y divide-white/5">{recentMovements.data.slice(0,30).map(m=><tr key={m.id}><td className="px-5 py-3"><p className="text-slate-200">{m.user?.nomeCompleto || "Cliente"}</p><p className="text-[11px] text-slate-500">{m.user?.email || ""}</p></td><td className="px-5 py-3 text-slate-300 capitalize">{m.tipo}</td><td className="px-5 py-3 text-slate-400">{m.descricao || "—"}</td><td className="px-5 py-3 text-slate-500">{m.createdAt ? new Date(m.createdAt).toLocaleString("pt-BR") : "—"}</td><td className="px-5 py-3 text-right text-slate-200">{money(m.valor)}</td></tr>)}</tbody></table></div>}
      </section>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 overflow-hidden mb-8">
        <div className="p-5 border-b border-white/10"><h2 className="font-semibold text-white">Documentos pendentes de análise</h2><p className="text-xs text-slate-500 mt-1">Aprovação e rejeição ficam registradas no backend administrativo existente.</p></div>
        {pendingDocuments.isLoading ? <p className="p-6 text-sm text-slate-400">Carregando documentos…</p> :
         pendingDocuments.isError ? <p className="p-6 text-sm text-rose-200">Não foi possível carregar documentos pendentes.</p> :
         !pendingDocuments.data?.length ? <p className="p-6 text-sm text-slate-500">Não há documentos aguardando análise.</p> :
         <div className="divide-y divide-white/5">{pendingDocuments.data.map(doc=><div key={doc.id} className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5">
           <div><p className="text-sm font-medium text-slate-200">{doc.user?.nomeCompleto || "Cliente"}</p><p className="text-xs text-slate-500">{doc.user?.email || ""}</p><p className="text-xs text-violet-200 mt-2">{doc.tipo.replaceAll("_"," ").toUpperCase()}</p><p className="text-[11px] text-slate-600 mt-1">{doc.createdAt ? new Date(doc.createdAt).toLocaleString("pt-BR") : "Data não informada"}</p></div>
           <div className="flex gap-2">
             <Button size="sm" disabled={reviewDocument.isPending} className="bg-emerald-700 hover:bg-emerald-600 text-white" onClick={()=>reviewDocument.mutate({documentId:doc.id,approved:true})}>Aprovar</Button>
             <Button size="sm" variant="outline" disabled={reviewDocument.isPending} className="border-rose-400/30 text-rose-200" onClick={()=>{const reason=window.prompt("Informe o motivo da rejeição:");if(reason?.trim())reviewDocument.mutate({documentId:doc.id,approved:false,reason:reason.trim()});}}>Rejeitar</Button>
           </div>
         </div>)}</div>}
        {reviewDocument.isError && <p className="px-5 pb-4 text-xs text-rose-200">Não foi possível atualizar o documento. Verifique as permissões e tente novamente.</p>}
      </section>

      <section className="rounded-2xl border border-white/10 bg-slate-900/70 overflow-hidden mb-8">
        <div className="p-5 border-b border-white/10"><h2 className="font-semibold text-white">Arquivo de relatórios PDF</h2><p className="text-xs text-slate-500 mt-1">Documentos gerados ficam armazenados em bucket privado; cada download é auditado e o hash SHA-256 é conferido.</p></div>
        {reportArchive.isLoading ? <p className="p-5 text-sm text-slate-400">Consultando arquivo…</p> : reportArchive.isError ? <p className="p-5 text-sm text-rose-200">Arquivo de relatórios indisponível.</p> : !reportArchive.data?.length ? <p className="p-5 text-sm text-slate-500">Nenhum relatório arquivado ainda.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-white/[.02] text-xs uppercase tracking-wider text-slate-500"><tr><th className="text-left px-5 py-3">Gerado em</th><th className="text-left px-5 py-3">Escopo</th><th className="text-left px-5 py-3">Registros</th><th className="text-left px-5 py-3">SHA-256</th><th className="text-right px-5 py-3">Arquivo</th></tr></thead><tbody className="divide-y divide-white/5">{reportArchive.data.map(report=><tr key={report.id}><td className="px-5 py-3 text-slate-300">{report.createdAt ? new Date(report.createdAt).toLocaleString("pt-BR") : "—"}</td><td className="px-5 py-3 text-slate-300">{report.scope === "client" ? "Cliente" : "Plataforma"}</td><td className="px-5 py-3 text-slate-300">{report.rowCount}</td><td className="px-5 py-3 text-xs font-mono text-slate-500">{report.contentSha256.slice(0,16)}…</td><td className="px-5 py-3 text-right"><a href={report.downloadUrl} className="text-violet-300 underline underline-offset-2">Baixar PDF</a></td></tr>)}</tbody></table></div>}
      </section>
      <section className="rounded-2xl border border-white/10 bg-slate-900/70 overflow-hidden">
        <div className="p-5 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3"><div><h2 className="font-semibold text-white">Clientes</h2><p className="text-xs text-slate-500 mt-1">Consulta administrativa; nenhuma alteração financeira é executada nesta tela.</p></div><div className="relative"><Search className="h-4 w-4 text-slate-500 absolute left-3 top-3"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar cliente ou e-mail" className="w-full sm:w-72 rounded-xl bg-slate-950 border border-white/10 py-2.5 pl-9 pr-3 text-sm text-white outline-none focus:border-violet-400/50"/></div></div>
        {users.isLoading ? <div className="p-8 text-slate-400 text-sm">Carregando clientes…</div> : users.isError ? <div className="p-8 text-rose-200 text-sm">Não foi possível carregar a lista de clientes.</div> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs uppercase tracking-wider text-slate-500 bg-white/[.02]"><tr><th className="text-left px-5 py-3">Cliente</th><th className="text-left px-5 py-3">E-mail</th><th className="text-left px-5 py-3">Saldo registrado</th><th className="text-left px-5 py-3">Conta</th><th className="text-left px-5 py-3">Documentos</th><th className="text-left px-5 py-3">Detalhes</th></tr></thead><tbody className="divide-y divide-white/5">{filtered.map(u=><tr key={u.id} className={`hover:bg-white/[.02] ${selectedUserId===u.id?"bg-violet-500/10":""}`}><td className="px-5 py-4 font-medium text-slate-200">{u.nomeCompleto}</td><td className="px-5 py-4 text-slate-400">{u.email}</td><td className="px-5 py-4 text-slate-200">{money(u.saldo)}</td><td className="px-5 py-4"><span className={u.contaAprovada?"text-emerald-300":"text-amber-300"}>{u.contaAprovada?"Aprovada":"Pendente"}</span></td><td className="px-5 py-4"><span className={u.documentosVerificados?"text-emerald-300":"text-amber-300"}>{u.documentosVerificados?"Verificados":"Não verificados"}</span></td><td className="px-5 py-4"><Button size="sm" variant="outline" className="border-white/15 text-slate-200" onClick={()=>setSelectedUserId(u.id)}>Ver ficha</Button></td></tr>)}</tbody></table>{!filtered.length&&<div className="p-8 text-center text-sm text-slate-500">Nenhum cliente encontrado.</div>}</div>}
      </section>
      {selectedUserId && <section className="rounded-2xl border border-violet-400/20 bg-slate-900/70 overflow-hidden mt-6">
        <div className="p-5 border-b border-white/10 flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-white">Ficha completa do cliente</h2><p className="text-xs text-slate-500 mt-1">Dados cadastrais, documentos e movimentações da conta selecionada.</p></div><div className="flex gap-2"><Button variant="outline" disabled={reportBusy} onClick={()=>generateReport("client",selectedUserId || undefined)} className="border-violet-400/30 text-violet-200">{reportBusy ? "Gerando PDF…" : "Imprimir / arquivar dossiê"}</Button><Button variant="ghost" onClick={()=>setSelectedUserId(null)} className="text-slate-300">Fechar</Button></div></div>
        {userDetail.isLoading ? <p className="p-6 text-sm text-slate-400">Carregando ficha…</p> : userDetail.isError || !userDetail.data ? <p className="p-6 text-sm text-rose-200">Não foi possível consultar a ficha deste cliente.</p> : <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 p-5">
            <Stat label="Saldo registrado" value={money(userDetail.data.user.saldo)} icon={Wallet} sub="Campo atual da conta" />
            <Stat label="Aportes" value={money(userDetail.data.summary.totalDeposited)} icon={ArrowDownLeft} sub="Histórico registrado" />
            <Stat label="Rendimentos" value={money(userDetail.data.summary.totalYield)} icon={Activity} sub="Histórico registrado" />
            <Stat label="Saques" value={money(userDetail.data.summary.totalWithdrawn)} icon={ArrowUpRight} sub="Histórico registrado" />
          </div>
          <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="rounded-xl border border-white/10 p-4"><h3 className="font-semibold text-white mb-3">Cadastro</h3><p className="text-slate-300">{userDetail.data.user.nomeCompleto}</p><p className="text-slate-400">{userDetail.data.user.email}</p><p className="text-slate-400">{userDetail.data.user.telefone || "Telefone não informado"}</p><p className="text-slate-400 mt-2">{[userDetail.data.user.endereco,userDetail.data.user.cidade,userDetail.data.user.estado,userDetail.data.user.cep].filter(Boolean).join(" · ")}</p><p className="text-xs text-slate-500 mt-3">CPF: {userDetail.data.user.cpf || "Não informado"}</p></div>
            <div className="rounded-xl border border-white/10 p-4"><h3 className="font-semibold text-white mb-3">Documentos</h3>{!userDetail.data.documents.length ? <p className="text-slate-500">Nenhum documento cadastrado.</p> : <div className="space-y-3">{userDetail.data.documents.map(doc=><div key={doc.id} className="flex items-center justify-between gap-2"><div><p className="text-slate-200">{doc.tipo}</p><p className="text-xs text-slate-500">{doc.createdAt ? new Date(doc.createdAt).toLocaleDateString("pt-BR") : "—"}</p><a href={`/api/admin/documents/${encodeURIComponent(doc.id)}/file`} target="_blank" rel="noopener noreferrer" className="text-xs text-violet-300 hover:text-violet-200 underline underline-offset-2">Abrir arquivo</a></div><span className="text-xs text-slate-300">{doc.status || "pendente"}</span></div>)}</div>}</div>
          </div>
          <div className="px-5 pb-5"><h3 className="font-semibold text-white mb-3">Operações do cliente</h3>{!userDetail.data.tradeOperations.length ? <p className="text-sm text-slate-500">Nenhuma operação registrada.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-slate-500"><tr><th className="text-left py-2">Ativo</th><th className="text-left py-2">Direção</th><th className="text-left py-2">Status</th><th className="text-left py-2">Data</th><th className="text-right py-2">Stake</th><th className="text-right py-2">PnL</th></tr></thead><tbody className="divide-y divide-white/5">{userDetail.data.tradeOperations.slice(0,50).map(op=><tr key={op.id}><td className="py-3 text-slate-200">{op.symbol}</td><td className="py-3 text-slate-300 capitalize">{op.direction || op.tradeType}</td><td className="py-3 text-slate-400 capitalize">{op.status || "—"}</td><td className="py-3 text-slate-500">{op.createdAt ? new Date(op.createdAt).toLocaleString("pt-BR") : "—"}</td><td className="py-3 text-right text-slate-200">{money(op.amount)}</td><td className={`py-3 text-right ${Number(op.profit||0)>=0?"text-emerald-300":"text-rose-300"}`}>{op.profit == null ? "—" : money(op.profit)}</td></tr>)}</tbody></table></div>}</div>
          <div className="px-5 pb-5"><h3 className="font-semibold text-white mb-3">Movimentações</h3>{!userDetail.data.movements.length ? <p className="text-sm text-slate-500">Nenhuma movimentação registrada.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-xs text-slate-500"><tr><th className="text-left py-2">Tipo</th><th className="text-left py-2">Descrição</th><th className="text-left py-2">Data</th><th className="text-right py-2">Valor</th></tr></thead><tbody className="divide-y divide-white/5">{userDetail.data.movements.slice(0,50).map(m=><tr key={m.id}><td className="py-3 text-slate-300 capitalize">{m.tipo}</td><td className="py-3 text-slate-400">{m.descricao || "—"}</td><td className="py-3 text-slate-500">{m.createdAt ? new Date(m.createdAt).toLocaleString("pt-BR") : "—"}</td><td className="py-3 text-right text-slate-200">{money(m.valor)}</td></tr>)}</tbody></table></div>}</div>
        </>}
      </section>}
      <div className="mt-6 rounded-xl border border-amber-400/20 bg-amber-950/20 p-4 text-xs leading-5 text-amber-200/80">Importante: estes totais refletem os campos e movimentos disponíveis na API atual. Ainda não representam uma conciliação contábil independente entre passivos dos clientes, capital próprio, capital alocado, reservas e liquidez.</div>
    </main>
  </div>;
}
