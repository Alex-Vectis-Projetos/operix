import { Activity, PauseCircle, Bell, Radio, Users, Building2 } from "lucide-react";
import { useOperationalKpis } from "@/hooks/useOperationalKpis";

interface CellProps {
  label: string;
  value: string | number;
  icon: any;
  tone: string;
  pulse?: boolean;
  sub?: string;
}

/**
 * Industrial KPI cell — calmer ambient, strong typographic value.
 * The `pulse` ring is reserved for genuine anomalies (degraded /
 * alerts > 0), not as ambient decoration.
 */
function KpiCell({ label, value, icon: Icon, tone, pulse, sub }: CellProps) {
  return (
    <div className="glass-panel rounded-xl p-4 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80 leading-tight">
          {label}
        </span>
        <div className={`relative flex h-7 w-7 items-center justify-center rounded-md border border-border/60 bg-muted/40 ${tone}`}>
          <Icon className="h-3.5 w-3.5" />
          {pulse && (
            <span className="absolute -inset-px rounded-md border border-current animate-ping opacity-40" />
          )}
        </div>
      </div>
      <div className="text-[26px] leading-none font-semibold tabular-nums tracking-tight text-foreground">
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground/80">{sub}</div>}
    </div>
  );
}

export function OperationalKPIs() {
  const { data, isLoading } = useOperationalKpis();
  const v = (n?: number) => (isLoading ? "—" : String(n ?? 0));
  const inactive = data?.platformsInactive ?? 0;
  const alerts = data?.alerts ?? 0;
  const activePlatforms = data?.platformsActive ?? 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <KpiCell label="Plataformas Ativas" value={v(activePlatforms)}
        icon={Activity} tone="text-emerald-400" sub="bases operacionais" />
      <KpiCell label="Plataformas Inativas" value={v(inactive)}
        icon={PauseCircle} tone={inactive > 0 ? "text-amber-400" : "text-muted-foreground/70"} sub="bases pausadas" />
      <KpiCell label="Alertas" value={v(alerts)}
        icon={Bell} tone={alerts > 0 ? "text-amber-400" : "text-muted-foreground/70"}
        pulse={alerts > 0} sub="clima & produção" />
      <KpiCell label="Eventos 24h" value={v(data?.realtimeEvents24h)}
        icon={Radio} tone="text-sky-400" sub="stream operacional" />
      <KpiCell label="Técnicos Ativos" value={v(data?.activeTechnicians)}
        icon={Users} tone="text-violet-400" sub="em operação" />
      <KpiCell label="Clientes Ativos" value={v(data?.activeClients)}
        icon={Building2} tone="text-amber-300" sub="com OS abertas" />
    </div>
  );
}
