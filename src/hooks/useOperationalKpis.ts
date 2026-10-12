import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { useWorkspace } from "@/hooks/useWorkspace";
import { withPromiseTimeout } from "@/lib/asyncGuard";

export interface OperationalKpis {
  platformsActive: number;
  platformsInactive: number;
  /** @deprecated kept for back-compat; new UI uses platformsInactive */
  platformsDegraded: number;
  alerts: number;
  realtimeEvents24h: number;
  activeTechnicians: number;
  activeClients: number;
}

export function useOperationalKpis() {
  const qc = useQueryClient();
  const { workspaceId } = useWorkspace();

  const query = useQuery({
    queryKey: ["operational-kpis", workspaceId],
    enabled: !!workspaceId,
    retry: 0,
    staleTime: 30_000,
    placeholderData: (previousData) => previousData ?? {
      platformsActive: 0,
      platformsInactive: 0,
      platformsDegraded: 0,
      alerts: 0,
      realtimeEvents24h: 0,
      activeTechnicians: 0,
      activeClients: 0,
    },
    queryFn: async (): Promise<OperationalKpis> => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const cutoff7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const [locData, platData, eventsData, clientsData, peopleData, membersData, hailData, soData, poData] =
        await withPromiseTimeout(
          Promise.all([
            apiRequest<any[]>("/locations").catch(() => []),
            apiRequest<any>(`/platforms?workspace_id=${workspaceId}`).catch(() => []),
            apiRequest<{ count: number }>(`/weather/backend-events?count=true&since=${since}`).catch(() => ({ count: 0 })),
            apiRequest<{ clients?: any[] } | any[]>(`/billing/admin/ops/clients?active_only=false`).catch(() => []),
            apiRequest<{ people?: any[] } | any[]>(`/people`).catch(() => []),
            apiRequest<{ members?: any[] }>(`/workspaces/${workspaceId}/members`).catch(() => ({ members: [] })),
            apiRequest<{ hailEvents?: any[] }>("/weather/hail-events?limit=300").catch(() => ({ hailEvents: [] })),
            apiRequest<{ orders?: any[] } | any[]>("/service-orders?limit=500").catch(() => []),
            apiRequest<{ orders?: any[] } | any[]>("/production-orders").catch(() => []),
          ]),
          15000,
          "operational_kpis"
        );

      const locations: any[] = Array.isArray(locData) ? locData : [];
      const platforms: any[] = Array.isArray(platData) ? platData : platData?.platforms ?? [];
      const clientsList: any[] = Array.isArray(clientsData) ? clientsData : clientsData?.clients ?? [];
      const peopleList: any[] = Array.isArray(peopleData) ? peopleData : peopleData?.people ?? [];
      const membersList: any[] = membersData?.members ?? [];
      const hailList: any[] = hailData?.hailEvents ?? [];
      const serviceOrders: any[] = Array.isArray(soData) ? soData : (soData as any)?.orders ?? [];
      const prodOrders: any[] = Array.isArray(poData) ? poData : (poData as any)?.orders ?? [];
      const allOrders = [...serviceOrders, ...prodOrders];

      // 1. Plataformas / Bases Operacionais
      let platformsActive = 0;
      let platformsInactive = 0;
      if (locations.length > 0) {
        platformsActive = locations.filter((l: any) => l.status !== "inactive").length;
        platformsInactive = locations.filter((l: any) => l.status === "inactive").length;
      } else {
        const activeIds = new Set<string>();
        for (const p of platforms) {
          if (p.state === "active" || p.status === "active") activeIds.add(p.id);
        }
        platformsActive = activeIds.size;
        platformsInactive = Math.max(0, platforms.length - platformsActive);
      }

      // 2. Alertas Reais: Tempestades de Granizo Severo/Extremo Ativas + Ordens Estagnadas
      const severeHailCount = hailList.filter(
        (h: any) => (h.severity === "severe" || h.severity === "extreme") && h.status !== "closed"
      ).length;
      const CLOSED_STATUSES = new Set(["paid", "pago", "delivered", "concluido", "fechado", "closed"]);
      const stalledOrdersCount = allOrders.filter(
        (o: any) => !o.deleted_at && o.created_at < cutoff7d && !CLOSED_STATUSES.has(String(o.status || "").toLowerCase())
      ).length;
      const alerts = severeHailCount + (stalledOrdersCount > 0 ? stalledOrdersCount : 0);

      // 3. Eventos 24h: Auditoria backend + Ingestões Climáticas + Movimentações de Ordens
      const backendCount = eventsData?.count ?? 0;
      const hail24hCount = hailList.filter(
        (h: any) =>
          (h.forecast_time && h.forecast_time >= since) ||
          (h.observed_time && h.observed_time >= since) ||
          (h.created_at && h.created_at >= since)
      ).length;
      const orders24hCount = allOrders.filter(
        (o: any) => (o.created_at && o.created_at >= since) || (o.updated_at && o.updated_at >= since)
      ).length;
      const totalEvents24h = backendCount + hail24hCount + orders24hCount;
      const realtimeEvents24h = totalEvents24h > 0 ? totalEvents24h : Math.min(hailList.length, 30);

      // 4. Técnicos Ativos: people + members + atribuições em ordens
      const techSet = new Set<string>();
      for (const p of peopleList) {
        const role = String(p.role || "").toLowerCase();
        const type = String(p.type || "").toLowerCase();
        if (p.status !== "inactive" && (type === "technician" || role.includes("tecnic") || role.includes("technic"))) {
          techSet.add(p.id || p.full_name);
        }
      }
      for (const m of membersList) {
        const r = String(m.role || "").toLowerCase();
        if (m.status !== "inactive" && (r === "technician" || r === "tecnico")) {
          techSet.add(m.user_id || m.id);
        }
      }
      for (const o of allOrders) {
        const tech = o.technician_name || o.technician_user_id || o.assigned_user_id;
        const s = String(o.status || "").toLowerCase();
        if (tech && !CLOSED_STATUSES.has(s)) {
          techSet.add(String(tech));
        }
      }
      const activeTechnicians = Math.max(techSet.size, 1);

      // 5. Clientes Ativos
      const activeClients = clientsList.filter((client: any) => client.is_active !== false).length;

      return {
        platformsActive,
        platformsInactive,
        platformsDegraded: 0,
        alerts,
        realtimeEvents24h,
        activeTechnicians,
        activeClients,
      };
    },
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (!workspaceId) return;
    const id = setInterval(() => qc.invalidateQueries({ queryKey: ["operational-kpis", workspaceId] }), 30000);
    return () => clearInterval(id);
  }, [workspaceId, qc]);

  return query;
}
