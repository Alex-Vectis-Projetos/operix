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
      const [platData, eventsData, poData, clientsData, peopleData] = await withPromiseTimeout(
        Promise.all([
          apiRequest<any>(`/platforms?workspace_id=${workspaceId}`).catch(() => []),
          apiRequest<{ count: number }>(`/weather/backend-events?count=true&since=${since}`).catch(() => ({ count: 0 })),
          apiRequest<{ orders?: any[] } | any[]>(`/production-orders`).catch(() => []),
          apiRequest<{ clients?: any[] } | any[]>(`/billing/admin/ops/clients?active_only=false`).catch(() => []),
          apiRequest<{ people?: any[] } | any[]>(`/people`).catch(() => []),
        ]),
        15000,
        "operational_kpis"
      );

      const platforms: any[] = Array.isArray(platData) ? platData : platData?.platforms ?? [];
      const orders: any[] = Array.isArray(poData) ? poData : poData?.orders ?? [];
      const clientsList: any[] = Array.isArray(clientsData) ? clientsData : clientsData?.clients ?? [];
      const peopleList: any[] = Array.isArray(peopleData) ? peopleData : peopleData?.people ?? [];

      const openOrders = orders.filter((o: any) =>
        ["pending", "in_production", "waiting_parts", "in_progress", "open"].includes(o.status)
      );

      const techSet = new Set<string>();
      const cliSet = new Set<string>();

      for (const o of openOrders) {
        if (o.technician_user_id || o.technicianUserId) {
          techSet.add(o.technician_user_id || o.technicianUserId);
        }
        if (o.client_id || o.clientId) {
          cliSet.add(o.client_id || o.clientId);
        }
      }

      for (const p of peopleList) {
        if (p.role === "technician" || p.category === "technician") {
          techSet.add(p.id);
        }
      }

      const activeClientsCount = cliSet.size > 0 ? cliSet.size : clientsList.filter((c: any) => c.is_active !== false).length;
      const activeTechniciansCount = techSet.size > 0 ? techSet.size : peopleList.filter((p: any) => p.is_active !== false && (p.role === "technician" || p.category === "technician")).length;

      const activeIds = new Set<string>();
      for (const p of platforms) {
        if (p.state === "active" || p.status === "active") activeIds.add(p.id);
      }
      const platformsActive = activeIds.size > 0 ? activeIds.size : (openOrders.length > 0 ? 1 : platforms.length);
      const platformsInactive = Math.max(0, platforms.length - platformsActive);
      const platformsDegraded = platforms.filter((p: any) => p.state === "degraded").length;

      return {
        platformsActive,
        platformsInactive,
        platformsDegraded,
        alerts: 0,
        realtimeEvents24h: eventsData?.count ?? 0,
        activeTechnicians: activeTechniciansCount,
        activeClients: activeClientsCount,
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
