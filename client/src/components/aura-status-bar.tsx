import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Clock, UserRound } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

type HealthResponse = {
  status?: string;
  trading?: { active?: boolean; scheduler?: string };
};

export default function AuraStatusBar() {
  const { user } = useAuth();
  const [now, setNow] = useState(() => new Date());
  const { data, isError, isLoading } = useQuery<HealthResponse>({
    queryKey: ["/api/health"],
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: false,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const online = data?.status === "online" && !isError;
  const apiLabel = isLoading ? "VERIFICANDO API" : online ? "API ONLINE" : "API INDISPONÍVEL";
  const tradingLabel = data?.trading?.active ? "TRADING ATIVO" : "TRADING EM ESPERA";

  return (
    <div className="aura-statusbar" role="status" aria-live="polite">
      <div className="aura-statusbar-group">
        <span className={`aura-status-dot ${online ? "is-online" : isError ? "is-offline" : "is-loading"}`} />
        <span>{apiLabel}</span>
      </div>
      <div className="aura-statusbar-group aura-statusbar-user">
        <UserRound />
        <span>{user?.nomeCompleto || user?.email || "Conta autenticada"}</span>
      </div>
      <div className="aura-statusbar-group aura-statusbar-trading">
        <Activity />
        <span>{tradingLabel}</span>
      </div>
      <div className="aura-statusbar-group aura-statusbar-clock">
        <Clock />
        <span>{now.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" })}</span>
      </div>
    </div>
  );
}
