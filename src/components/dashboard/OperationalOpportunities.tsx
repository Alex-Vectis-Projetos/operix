import { useMemo, useState } from "react";
import {
  Target,
  TrendingUp,
  Users,
  FileText,
  MapPin,
  Zap,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Activity,
  RefreshCw,
  AlertTriangle,
  Compass,
  Radio,
  ExternalLink,
  ShieldAlert,
} from "lucide-react";
import { apiRequest } from "@/lib/api";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

/* ------------------------------------------------------------------ */
/*  Types & priority system                                            */
/* ------------------------------------------------------------------ */
export type OpPriority = "low" | "medium" | "high" | "critical";

export interface OppHailEvent {
  id: string;
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number;
  lng: number;
  radius_km: number;
  severity: "low" | "moderate" | "severe" | "extreme";
  status: "forecast" | "ongoing" | "confirmed" | "closed";
  hail_size_mm: number | null;
  probability: number | null;
}

export interface OppOrder {
  id: string;
  city?: string;
  platform?: string;
  plate?: string;
  status?: string;
  lat: number;
  lng: number;
}

export interface OppTeam {
  lat: number;
  lng: number;
  city?: string;
  when?: string;
}

export interface Opportunity {
  id: string;
  hail: OppHailEvent;
  city: string;
  country: string;
  nearbyOrders: OppOrder[];
  nearbyTeams: OppTeam[];
  nearestOrderDistanceKm: number | null;
  nearestTeamDistanceKm: number | null;
  damageConcentration: number;   // 0..100 — orders × severity heuristic
  economicRelevance: number;     // 0..100 — based on order count + size
  operationalPotential: number;  // 0..100 — combined score
  priority: OpPriority;
  score: number;
  category: "direct_demand" | "team_deploy" | "market_alert";
}

export const PRIORITY_META: Record<OpPriority, { label: string; color: string; glow: string; bg: string }> = {
  low:      { label: "Baixa",    color: "#22d3ee", glow: "#22d3ee55", bg: "#22d3ee18" },
  medium:   { label: "Média",    color: "#eab308", glow: "#eab30855", bg: "#eab30818" },
  high:     { label: "Alta",     color: "#f97316", glow: "#f9731655", bg: "#f9731618" },
  critical: { label: "Crítica",  color: "#ef4444", glow: "#ef444599", bg: "#ef444422" },
};

const SEVERITY_WEIGHT = { low: 1, moderate: 2, severe: 3.5, extreme: 5 } as const;

/* ------------------------------------------------------------------ */
/*  Haversine distance (km)                                            */
/* ------------------------------------------------------------------ */
function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* ------------------------------------------------------------------ */
/*  Compute opportunities (hybrid: Direct Fleet + Regional Market)     */
/* ------------------------------------------------------------------ */
export function computeOpportunities(
  hailEvents: OppHailEvent[],
  orders: OppOrder[],
  teams: OppTeam[],
): Opportunity[] {
  const ORDER_RADIUS = 75;   // km (impact zone around storm)
  const TEAM_RADIUS = 120;   // km (reasonable dispatch radius for mobile PDR team)

  return hailEvents
    .filter((h) => h.status !== "closed")
    .map((h) => {
      const radius = Math.max(ORDER_RADIUS, Number(h.radius_km) || 0);
      const nearbyOrders = orders.filter((o) =>
        haversineKm({ lat: h.lat, lng: h.lng }, { lat: o.lat, lng: o.lng }) <= radius,
      );
      const nearbyTeams = teams.filter((tm) =>
        haversineKm({ lat: h.lat, lng: h.lng }, { lat: tm.lat, lng: tm.lng }) <= TEAM_RADIUS,
      );

      // Distance to nearest order and team
      let minOrderDist = Infinity;
      orders.forEach((o) => {
        const d = haversineKm({ lat: h.lat, lng: h.lng }, { lat: o.lat, lng: o.lng });
        if (d < minOrderDist) minOrderDist = d;
      });

      let minTeamDist = Infinity;
      teams.forEach((tm) => {
        const d = haversineKm({ lat: h.lat, lng: h.lng }, { lat: tm.lat, lng: tm.lng });
        if (d < minTeamDist) minTeamDist = d;
      });

      const sevW = SEVERITY_WEIGHT[h.severity] ?? 2;
      const sizeMm = Number(h.hail_size_mm) || 0;
      const sizeFactor = 1 + Math.min(2.5, sizeMm / 20); // 25mm ≈ +1.25x
      const isDirectDemand = nearbyOrders.length > 0;
      const isTeamDeploy = nearbyTeams.length > 0;

      const orderFactor = 1 + Math.min(4, nearbyOrders.length * 0.8) + (isTeamDeploy ? 0.4 : 0);

      const damageConcentration = Math.min(100, Math.round(sevW * 12 + sizeMm * 1.2));
      const economicRelevance = Math.min(100, Math.round(nearbyOrders.length * 15 + sevW * 8));

      let score = sevW * sizeFactor * orderFactor;
      if (isDirectDemand) score += 8;
      if (isTeamDeploy) score += 4;

      const operationalPotential = Math.min(100, Math.round(score * 5.5));

      let priority: OpPriority = "low";
      if (score >= 16 || (isDirectDemand && score >= 12)) priority = "critical";
      else if (score >= 9 || isDirectDemand) priority = "high";
      else if (score >= 4.5 || isTeamDeploy) priority = "medium";

      const category: "direct_demand" | "team_deploy" | "market_alert" = isDirectDemand
        ? "direct_demand"
        : isTeamDeploy
        ? "team_deploy"
        : "market_alert";

      return {
        id: h.id,
        hail: h,
        city: h.city ?? h.region ?? "Região",
        country: h.country ?? "—",
        nearbyOrders,
        nearbyTeams,
        nearestOrderDistanceKm: minOrderDist === Infinity ? null : Math.round(minOrderDist),
        nearestTeamDistanceKm: minTeamDist === Infinity ? null : Math.round(minTeamDist),
        damageConcentration,
        economicRelevance,
        operationalPotential,
        priority,
        score,
        category,
      };
    })
    .filter((o) => o.score > 0.5)
    .sort((a, b) => b.score - a.score);
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */
export function OperationalOpportunities({
  opportunities,
  totalMonitoredEvents = 0,
  onSelect,
}: {
  opportunities: Opportunity[];
  totalMonitoredEvents?: number;
  onSelect?: (opp: Opportunity) => void;
}) {
  const queryClient = useQueryClient();
  const [priorityFilter, setPriorityFilter] = useState<"all" | OpPriority>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "direct_demand" | "team_deploy" | "market_alert">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const triggerIngest = async () => {
    setSyncing(true);
    try {
      const res = await apiRequest<{ ok: boolean; inserted?: number; totalFetched?: number }>("/weather/hail-events/ingest", {
        method: "POST",
      });
      queryClient.invalidateQueries({ queryKey: ["op-map-hail"] });
      queryClient.invalidateQueries({ queryKey: ["op-map-hail-reports"] });
      toast({
        title: "Inteligência Climática Atualizada!",
        description: `Ingestão executada com sucesso. ${res.inserted ?? 0} novos eventos catalogados.`,
      });
    } catch (e: any) {
      toast({
        title: "Erro ao atualizar clima",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
  };

  const filtered = useMemo(() => {
    return opportunities.filter((o) => {
      if (priorityFilter !== "all" && o.priority !== priorityFilter) return false;
      if (categoryFilter !== "all" && o.category !== categoryFilter) return false;
      return true;
    });
  }, [opportunities, priorityFilter, categoryFilter]);

  const counts = useMemo(() => {
    const pCounts: Record<OpPriority, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    let directDemandCount = 0;
    let teamDeployCount = 0;
    let marketAlertCount = 0;

    opportunities.forEach((o) => {
      pCounts[o.priority]++;
      if (o.category === "direct_demand") directDemandCount++;
      else if (o.category === "team_deploy") teamDeployCount++;
      else marketAlertCount++;
    });

    return { pCounts, directDemandCount, teamDeployCount, marketAlertCount };
  }, [opportunities]);

  const totalOrders = opportunities.reduce((s, o) => s + o.nearbyOrders.length, 0);
  const totalTeams = opportunities.reduce((s, o) => s + o.nearbyTeams.length, 0);

  return (
    <div
      className="glass-panel rounded-xl p-5 animate-fade-in mt-4 text-slate-100"
      style={{
        background: "linear-gradient(180deg, hsl(220 16% 9% / 0.98), hsl(220 16% 7% / 0.98))",
        border: "1px solid hsl(220 14% 18%)",
        boxShadow: "0 10px 30px -5px rgba(0,0,0,0.5)",
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <div className="relative">
              <Target className="h-4 w-4 text-orange-400" />
              <Sparkles className="h-2.5 w-2.5 text-yellow-300 absolute -top-1 -right-1.5" />
            </div>
            <span>Oportunidades Operacionais</span>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
              PDR Intel
            </span>
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Cruzamento geoespacial: células de tempestade × frotas de clientes × equipes de martelinho disponíveis.
          </p>
        </div>

        {/* Action + Aggregate stats */}
        <div className="flex flex-wrap items-center gap-2">
          <Stat
            icon={<Activity className="h-3 w-3" />}
            label="Tempestades ativas"
            value={totalMonitoredEvents || opportunities.length}
            color="#a855f7"
          />
          <Stat
            icon={<FileText className="h-3 w-3" />}
            label="Ordens na zona"
            value={totalOrders}
            color="#22d3ee"
          />
          <Stat
            icon={<Users className="h-3 w-3" />}
            label="Equipes no raio"
            value={totalTeams}
            color="#34d399"
          />

          <button
            onClick={triggerIngest}
            disabled={syncing}
            className="flex items-center gap-1.5 text-[10px] px-3 py-1.5 rounded-md border border-slate-700 bg-slate-800/80 hover:bg-slate-700 hover:border-cyan-500/50 text-slate-200 transition cursor-pointer disabled:opacity-50"
            title="Sincronizar alertas climáticos em tempo real (MeteoAlarm / NOAA / Open-Meteo)"
          >
            <RefreshCw className={`h-3 w-3 text-cyan-400 ${syncing ? "animate-spin" : ""}`} />
            <span>{syncing ? "Atualizando…" : "Atualizar Alertas"}</span>
          </button>
        </div>
      </div>

      {/* Filter Tabs: Category & Priority */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-800/80">
        {/* Category Pill Filters */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCategoryFilter("all")}
            className={`text-[11px] px-2.5 py-1 rounded-md border transition cursor-pointer ${
              categoryFilter === "all"
                ? "bg-slate-700 text-white border-slate-500"
                : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200"
            }`}
          >
            Todas as Ocorrências ({opportunities.length})
          </button>
          <button
            onClick={() => setCategoryFilter("direct_demand")}
            className={`text-[11px] px-2.5 py-1 rounded-md border transition cursor-pointer flex items-center gap-1 ${
              categoryFilter === "direct_demand"
                ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/50"
                : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-cyan-300"
            }`}
          >
            <FileText className="h-3 w-3" />
            Com Ordens de Clientes ({counts.directDemandCount})
          </button>
          <button
            onClick={() => setCategoryFilter("team_deploy")}
            className={`text-[11px] px-2.5 py-1 rounded-md border transition cursor-pointer flex items-center gap-1 ${
              categoryFilter === "team_deploy"
                ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/50"
                : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-emerald-300"
            }`}
          >
            <Users className="h-3 w-3" />
            Com Equipes no Raio ({counts.teamDeployCount})
          </button>
          <button
            onClick={() => setCategoryFilter("market_alert")}
            className={`text-[11px] px-2.5 py-1 rounded-md border transition cursor-pointer flex items-center gap-1 ${
              categoryFilter === "market_alert"
                ? "bg-purple-500/20 text-purple-300 border-purple-500/50"
                : "bg-slate-900/60 text-slate-400 border-slate-800 hover:text-purple-300"
            }`}
          >
            <Radio className="h-3 w-3" />
            Alertas de Mercado ({counts.marketAlertCount})
          </button>
        </div>

        {/* Priority Filter Chips */}
        <div className="flex flex-wrap gap-1.5 items-center">
          <FilterChip
            active={priorityFilter === "all"}
            label="Qualquer severidade"
            color="#94a3b8"
            onClick={() => setPriorityFilter("all")}
          />
          {(["critical", "high", "medium", "low"] as OpPriority[]).map((p) => (
            <FilterChip
              key={p}
              active={priorityFilter === p}
              label={`${PRIORITY_META[p].label} (${counts.pCounts[p]})`}
              color={PRIORITY_META[p].color}
              onClick={() => setPriorityFilter(p)}
            />
          ))}
        </div>
      </div>

      {/* Content list or Empty State */}
      {filtered.length === 0 ? (
        <div
          className="py-12 text-center text-xs text-slate-400 border border-dashed rounded-lg p-6 flex flex-col items-center justify-center gap-2"
          style={{ borderColor: "hsl(220 12% 20%)" }}
        >
          <ShieldAlert className="h-8 w-8 text-slate-500 mb-1" />
          <div className="font-medium text-slate-300 text-sm">Nenhuma oportunidade operacional ativa no filtro selecionado.</div>
          <div className="text-slate-500 max-w-md">
            {totalMonitoredEvents > 0
              ? `${totalMonitoredEvents} tempestades estão sendo monitoradas no radar global. Nenhuma atende aos critérios do filtro selecionado.`
              : "Nenhum evento severo detectado no perímetro de satélite. Clique em 'Atualizar Alertas' para acionar nova varredura no MeteoAlarm e NOAA."}
          </div>
          <button
            onClick={triggerIngest}
            disabled={syncing}
            className="mt-2 text-xs px-3 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white font-medium transition cursor-pointer"
          >
            Sincronizar radar meteorológico agora
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.slice(0, 16).map((opp) => (
            <OpportunityCard
              key={opp.id}
              opp={opp}
              isExpanded={expandedId === opp.id}
              onToggleExpand={() => setExpandedId((curr) => (curr === opp.id ? null : opp.id))}
              onSelect={() => onSelect?.(opp)}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      <div
        className="mt-4 pt-3 border-t flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400"
        style={{ borderColor: "hsl(220 12% 18%)" }}
      >
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-purple-400" />
          <span>Motor PDR Inteligente: dispatch de equipes móveis, previsão de demanda e campanhas automáticas.</span>
        </span>
        <span className="font-mono text-slate-500">
          {totalMonitoredEvents || opportunities.length} eventos analisados · {filtered.length} oportunidades no grid
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Row / Card Component                                               */
/* ------------------------------------------------------------------ */
function OpportunityCard({
  opp,
  isExpanded,
  onToggleExpand,
  onSelect,
}: {
  opp: Opportunity;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSelect?: () => void;
}) {
  const meta = PRIORITY_META[opp.priority];

  return (
    <div
      className="rounded-lg transition-all border overflow-hidden"
      style={{
        background: isExpanded ? "hsl(220 16% 11%)" : "hsl(220 15% 9.5%)",
        borderColor: isExpanded ? `${meta.color}66` : "hsl(220 14% 16%)",
        boxShadow: opp.priority === "critical" ? `0 0 14px ${meta.glow}` : "none",
      }}
    >
      <div
        onClick={onToggleExpand}
        className="w-full text-left p-3 flex items-center justify-between gap-3 flex-wrap cursor-pointer hover:bg-slate-800/40 transition"
      >
        {/* Left — region + priority + category badge */}
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap"
            style={{ background: meta.bg, color: meta.color, border: `1px solid ${meta.color}55` }}
          >
            {meta.label}
          </div>

          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-100 truncate flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-cyan-400 flex-shrink-0" />
              <span>{opp.city}</span>
              <span className="text-[10px] text-slate-400 font-normal">({opp.country})</span>
              {opp.category === "direct_demand" && (
                <span className="text-[9px] font-medium px-1.5 py-0.2 rounded bg-cyan-500/20 border border-cyan-500/40 text-cyan-300">
                  Frota no raio
                </span>
              )}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2">
              <span className="uppercase font-medium" style={{ color: meta.color }}>
                {opp.hail.severity}
              </span>
              <span>·</span>
              <span>Granizo: {opp.hail.hail_size_mm ? `${opp.hail.hail_size_mm}mm` : "Aviso meteorológico"}</span>
              <span>·</span>
              <span>Raio {opp.hail.radius_km || 25}km</span>
            </div>
          </div>
        </div>

        {/* Middle — operational metrics */}
        <div className="flex items-center gap-3 text-[11px] text-slate-400">
          <Metric
            icon={<FileText className="h-3.5 w-3.5 text-cyan-400" />}
            value={opp.nearbyOrders.length}
            label={opp.nearbyOrders.length === 1 ? "Ordem" : "Ordens"}
          />
          <Metric
            icon={<Users className="h-3.5 w-3.5 text-emerald-400" />}
            value={opp.nearbyTeams.length}
            label={opp.nearbyTeams.length === 1 ? "Equipe" : "Equipes"}
          />
          <Metric
            icon={<TrendingUp className="h-3.5 w-3.5 text-orange-400" />}
            value={`${opp.operationalPotential}%`}
            label="Potencial"
          />
        </div>

        {/* Right — score bars + chevron */}
        <div className="flex items-center gap-3 flex-1 min-w-[160px] max-w-[260px]">
          <ScoreBar label="Dano" value={opp.damageConcentration} color="#ef4444" />
          <ScoreBar label="Econômico" value={opp.economicRelevance} color="#22d3ee" />
          <div className="text-slate-400 hover:text-slate-200">
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </div>
        </div>
      </div>

      {/* Expanded Details Panel */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-2 border-t border-slate-800 bg-slate-950/40 text-xs text-slate-300 space-y-3 animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {/* Left Column: Ordens Próximas */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
              <div className="text-xs font-semibold text-slate-200 flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-cyan-400" />
                  Ordens de Serviço no Perímetro ({opp.nearbyOrders.length})
                </span>
                {opp.nearestOrderDistanceKm != null && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    Mais próxima a {opp.nearestOrderDistanceKm} km
                  </span>
                )}
              </div>

              {opp.nearbyOrders.length === 0 ? (
                <div className="text-[11px] text-slate-400 py-2">
                  Nenhuma ordem aberta na zona imediata desta tempestade.
                  {opp.nearestOrderDistanceKm != null && (
                    <span className="block text-slate-400 mt-1">
                      Distância até o cliente/ordem mais próxima do tenant: <strong>{opp.nearestOrderDistanceKm} km</strong>.
                    </span>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                  {opp.nearbyOrders.map((o) => (
                    <div
                      key={o.id}
                      className="p-1.5 rounded bg-slate-950 border border-slate-800/80 text-[11px] flex items-center justify-between"
                    >
                      <div>
                        <span className="font-semibold text-slate-200">{o.plate || "Veículo"}</span>
                        <span className="text-slate-400 ml-1.5">({o.platform || o.city || "Operação"})</span>
                      </div>
                      <span className="text-[10px] text-cyan-400 font-medium">{o.status || "Ativa"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right Column: Equipes & Bases */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-lg p-3">
              <div className="text-xs font-semibold text-slate-200 flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5 text-emerald-400" />
                  Equipes & Bases Mobilizáveis ({opp.nearbyTeams.length})
                </span>
                {opp.nearestTeamDistanceKm != null && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    Base a {opp.nearestTeamDistanceKm} km
                  </span>
                )}
              </div>

              {opp.nearbyTeams.length === 0 ? (
                <div className="text-[11px] text-slate-400 py-2">
                  Nenhuma base com técnicos a menos de 120km deste evento.
                  {opp.nearestTeamDistanceKm != null && (
                    <span className="block text-slate-400 mt-1">
                      Base técnica mais próxima: <strong>{opp.nearestTeamDistanceKm} km</strong>.
                    </span>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                  {opp.nearbyTeams.map((t, idx) => (
                    <div
                      key={idx}
                      className="p-1.5 rounded bg-slate-950 border border-slate-800/80 text-[11px] flex items-center justify-between"
                    >
                      <span className="font-medium text-slate-200">{t.city || "Base Operacional"}</span>
                      <span className="text-[10px] text-emerald-400">Pronta para despacho</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex items-center justify-between pt-1">
            <div className="text-[10px] text-slate-400">
              Coordenadas: <span className="font-mono text-slate-300">{opp.hail.lat.toFixed(4)}, {opp.hail.lng.toFixed(4)}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect?.();
                  toast({
                    title: "Alvo posicionado!",
                    description: `O mapa foi centralizado na célula de ${opp.city}.`,
                  });
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white transition cursor-pointer shadow-sm"
              >
                <Compass className="h-3.5 w-3.5 mr-0.5" />
                <span>Ver no Mapa</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ icon, value, label }: { icon: React.ReactNode; value: number | string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      {icon}
      <span className="font-semibold text-slate-200">{value}</span>
      <span className="opacity-70 text-[10px]">{label}</span>
    </div>
  );
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex justify-between text-[9px] text-slate-400 mb-0.5">
        <span>{label}</span>
        <span className="font-mono">{value}%</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden bg-slate-800">
        <div
          className="h-full transition-all"
          style={{ width: `${value}%`, background: color, boxShadow: `0 0 6px ${color}99` }}
        />
      </div>
    </div>
  );
}

function FilterChip({ active, label, color, onClick }: { active: boolean; label: string; color: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[10px] px-2.5 py-1 rounded-md border transition-all flex items-center gap-1 cursor-pointer"
      style={{
        borderColor: active ? color : "hsl(220 12% 22%)",
        background: active ? `${color}22` : "transparent",
        color: active ? color : "#94a3b8",
        boxShadow: active ? `0 0 8px ${color}55` : "none",
      }}
    >
      {label}
    </button>
  );
}

function Stat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div
      className="px-2.5 py-1 rounded-md flex items-center gap-1.5 text-[10px]"
      style={{ background: `${color}15`, border: `1px solid ${color}40`, color }}
    >
      {icon}
      <span className="font-semibold text-slate-100">{value}</span>
      <span className="opacity-80">{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Heatmap GeoJSON helper — for map integration                       */
/* ------------------------------------------------------------------ */
export function opportunitiesToHeatmapGeoJSON(opps: Opportunity[]) {
  return {
    type: "FeatureCollection" as const,
    features: opps.map((o) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [o.hail.lng, o.hail.lat] },
      properties: {
        id: o.id,
        weight: Math.min(1, o.score / 25),
        priority: o.priority,
        color: PRIORITY_META[o.priority].color,
        potential: o.operationalPotential,
      },
    })),
  };
}
