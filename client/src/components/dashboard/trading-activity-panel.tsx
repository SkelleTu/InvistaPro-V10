import { Badge } from "@/components/ui/badge";
import { getTradingActivity, type TradingDashboardStatus } from "@/lib/trading-dashboard-status";

export function TradingActivityPanel({ status, nextCycleCountdown = 0 }: {
  status?: TradingDashboardStatus | null;
  nextCycleCountdown?: number;
}) {
  const activity = getTradingActivity(status);
  if (!activity.visible) return null;

  return (
    <section aria-label="Atividade em Tempo Real" className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Atividade em Tempo Real</h3>
        <Badge variant={activity.label === "Operando" ? "default" : activity.label === "Pausado/Bloqueado" ? "destructive" : "outline"}>
          {activity.label}
        </Badge>
      </div>
      {activity.phase && <p className="text-sm font-medium break-words">{activity.phase}</p>}
      {activity.detail && <p className="text-xs text-muted-foreground leading-relaxed break-words" data-testid="text-current-activity">{activity.detail}</p>}
      {activity.errors.map((error) => <p key={error} role="alert" className="text-xs text-destructive break-words">{error}</p>)}
      {activity.blockers.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-destructive space-y-1">
          {activity.blockers.map((blocker, index) => <li key={index} className="break-words">{blocker}</li>)}
        </ul>
      )}
      {status?.schedulerActive === true && activity.phase === "AGUARDANDO" &&
        (status.schedulerStatus?.nextCycleAt ?? 0) > 0 && nextCycleCountdown > 0 && (
        <p className="text-xs text-muted-foreground">Próximo ciclo em {nextCycleCountdown}s</p>
      )}
      {activity.logs.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma atividade confirmada pelo backend ainda</p>
      ) : (
        <div className="space-y-1 pt-2 border-t border-border/40">
          <p className="text-xs font-medium text-muted-foreground">Atividade Recente</p>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {activity.logs.map((entry, index) => {
              const date = entry.time == null ? null : new Date(entry.time);
              const validTime = date != null && Number.isFinite(date.getTime());
              return (
                <div key={index} className="flex flex-wrap items-start gap-2 text-xs">
                  {validTime && <time className="text-muted-foreground font-mono shrink-0" dateTime={date.toISOString()}>
                    {date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </time>}
                  {entry.type && <span className="text-muted-foreground">{entry.type}</span>}
                  <span className="text-foreground break-words min-w-0 flex-1">{entry.message}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
