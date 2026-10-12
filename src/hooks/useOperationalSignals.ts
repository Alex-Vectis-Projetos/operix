import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { useWorkspace } from "@/hooks/useWorkspace";
import { agentBus, type AgentEvent } from "@/lib/agentEventBus";
import "@/lib/operationalObserver"; // ensure singleton observer is started

export type SignalLevel = "ok" | "info" | "warn" | "error";

export interface OperationalSignal {
  id: string; level: SignalLevel; title: string; detail?: string;
}

export function useOperationalSignals() {
  const { workspaceId } = useWorkspace();
  const [recent, setRecent] = useState<AgentEvent[]>(() => agentBus.snapshot().slice(-30));

  useEffect(() => {
    const unsub = agentBus.subscribe((e) => {
      setRecent((prev) => { const next = [...prev, e]; return next.length > 30 ? next.slice(-30) : next; });
    });
    return unsub;
  }, []);

  const { data: platforms } = useQuery({
    queryKey: ["op-signals-platforms", workspaceId],
    enabled: !!workspaceId,
    staleTime: 60_000,
    queryFn: async () => {
      const data = await apiRequest<{ platforms: any[] }>(`/platforms?workspace_id=${workspaceId}`);
      return data.platforms ?? [];
    },
  });

  const { data: hailEvents = [] } = useQuery({
    queryKey: ["op-signals-hail-events"],
    staleTime: 60_000,
    queryFn: async () => {
      const data = await apiRequest<{ hailEvents: any[] }>("/weather/hail-events?limit=50&sort=desc&no_expired=true");
      return data.hailEvents ?? [];
    },
  });

  const ACTIVE_STATUSES = ["pending","draft","open","in_progress","em_andamento","aguardando","aberto"];
  const PAID_STATUSES = ["pago","paid","settled","liquidado"];

  // Stalled service orders — active SO not touched in > 18h
  const { data: stalledSO } = useQuery({
    queryKey: ["op-intel-stalled-so", workspaceId],
    enabled: !!workspaceId,
    staleTime: 120_000,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 18 * 3600_000).toISOString();
      const data = await apiRequest<{ orders: any[] }>(`/service-orders?workspace_id=${workspaceId}&limit=200`);
      return (data.orders ?? [])
        .filter((o: any) => !o.deleted_at && ACTIVE_STATUSES.includes(o.status) && o.updated_at < cutoff)
        .sort((a: any, b: any) => a.updated_at < b.updated_at ? -1 : 1)
        .slice(0, 5);
    },
  });

  // Production volume — today vs yesterday SO count
  const { data: prodTrend } = useQuery({
    queryKey: ["op-intel-prod-trend", workspaceId],
    enabled: !!workspaceId,
    staleTime: 300_000,
    queryFn: async () => {
      const startToday = new Date(new Date().setHours(0,0,0,0)).toISOString();
      const startYesterday = new Date(Date.now() - 24*3600_000); startYesterday.setHours(0,0,0,0);
      const startY = startYesterday.toISOString();
      const data = await apiRequest<{ orders: any[] }>(`/service-orders?workspace_id=${workspaceId}&limit=500`);
      const orders = data.orders ?? [];
      const today = orders.filter((o: any) => !o.deleted_at && o.created_at >= startToday).length;
      const yesterday = orders.filter((o: any) => !o.deleted_at && o.created_at >= startY && o.created_at < startToday).length;
      return { today, yesterday };
    },
  });

  // Overdue payments — unpaid PO older than 30 days
  const { data: overduePO } = useQuery({
    queryKey: ["op-intel-overdue-po", workspaceId],
    enabled: !!workspaceId,
    staleTime: 300_000,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 30*24*3600_000).toISOString();
      const data = await apiRequest<{ orders: any[] }>(`/payment-orders?workspace_id=${workspaceId}&limit=500`);
      return (data.orders ?? []).filter((o: any) => !o.deleted_at && o.created_at < cutoff && !PAID_STATUSES.includes(o.status)).length;
    },
  });

  // Inactive technicians — members(role=tecnico) with no SO in 14d
  const { data: inactiveTechs } = useQuery({
    queryKey: ["op-intel-inactive-techs", workspaceId],
    enabled: !!workspaceId,
    staleTime: 600_000,
    queryFn: async () => {
      const cutoff14d = new Date(Date.now() - 14*24*3600_000).toISOString();
      const [membersData, soData] = await Promise.all([
        apiRequest<{ members: any[] }>(`/workspaces/${workspaceId}/members`),
        apiRequest<{ orders: any[] }>(`/service-orders?workspace_id=${workspaceId}&limit=500`),
      ]);
      const techs = (membersData.members ?? []).filter((m: any) => m.role === "tecnico" && m.status === "active");
      const active = new Set((soData.orders ?? []).filter((o: any) => o.created_at >= cutoff14d).map((o: any) => o.assigned_user_id).filter(Boolean));
      const total = techs.length;
      const inactive = techs.filter((t: any) => !active.has(t.user_id)).length;
      return { total, inactive };
    },
  });

  // Inactive workspace — zero SO created in last 7d (but workspace has techs)
  const { data: workspaceActivity } = useQuery({
    queryKey: ["op-intel-ws-activity", workspaceId],
    enabled: !!workspaceId,
    staleTime: 600_000,
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 7*24*3600_000).toISOString();
      const data = await apiRequest<{ orders: any[] }>(`/service-orders?workspace_id=${workspaceId}&limit=200`);
      return (data.orders ?? []).filter((o: any) => !o.deleted_at && o.created_at >= cutoff).length;
    },
  });

  const signals = useMemo<OperationalSignal[]>(() => {
    const out: OperationalSignal[] = [];
    const degraded = (platforms ?? []).filter((p: any) => p.state === "degraded");
    if (degraded.length) out.push({ id:"platforms-degraded", level:"warn", title:`${degraded.length} plataforma(s) degradada(s)`, detail: degraded.map((p: any) => p.name).join(", ") });
    
    // Hail / Radar PDR signals
    if (hailEvents.length > 0) {
      const severeCount = hailEvents.filter((h: any) => h.severity === "severe" || h.severity === "extreme").length;
      if (severeCount > 0) {
        out.push({
          id: "radar-severe",
          level: "warn",
          title: `Alerta Meteorológico — ${severeCount} ocorrências severas de granizo`,
          detail: "Monitoramento PDR com atividade crítica recente",
        });
      } else {
        out.push({
          id: "radar-active",
          level: "info",
          title: `Radar PDR ativo — ${hailEvents.length} ocorrências monitoradas`,
          detail: "Rede de radar operacional e atualizada",
        });
      }
    } else {
      out.push({
        id: "radar-idle",
        level: "ok",
        title: "Radar PDR em prontidão",
        detail: "Sem tempestades severas ativas no momento",
      });
    }

    if (stalledSO?.length) {
      const oldest = stalledSO[0];
      const hours = Math.round((Date.now() - new Date(oldest.updated_at as string).getTime()) / 36e5);
      out.push({ id:"so-stalled", level:"info", title: stalledSO.length === 1 ? `Ordem de serviço inativa há ${hours}h` : `${stalledSO.length} ordens de serviço inativas`, detail: stalledSO.length > 1 ? `A mais antiga há ${hours}h` : undefined });
    }
    if (prodTrend && prodTrend.yesterday >= 3 && prodTrend.today < prodTrend.yesterday * 0.5) {
      const pct = Math.round((1 - prodTrend.today / prodTrend.yesterday) * 100);
      out.push({ id:"production-drop", level:"info", title:"Volume de produção em queda", detail:`Hoje ${prodTrend.today} vs ontem ${prodTrend.yesterday} (-${pct}%)` });
    }
    if (overduePO && overduePO > 0) out.push({ id:"payments-overdue", level:"warn", title:`${overduePO} pagamento(s) em atraso há mais de 30 dias` });
    if (inactiveTechs && inactiveTechs.total >= 3 && inactiveTechs.inactive > 0) out.push({ id:"techs-inactive", level:"info", title:`${inactiveTechs.inactive} de ${inactiveTechs.total} técnicos sem atividade recente`, detail:"Sem ordens nos últimos 14 dias" });
    if (workspaceActivity === 0 && (inactiveTechs?.total ?? 0) > 0) out.push({ id:"workspace-idle", level:"info", title:"Workspace sem nova atividade esta semana", detail:"Zero ordens criadas nos últimos 7 dias" });
    
    // Filter out historical spurious tile network failures
    const cutoff = Date.now() - 5*60_000;
    const errs = recent.filter((e) => e.level === "error" && e.at > cutoff && !(e.title === "Falha de rede" && (!e.detail || e.detail.includes("tile") || e.detail.includes("rainviewer") || e.detail.includes("nominatim"))));
    if (errs.length >= 3) out.push({ id:"alert-spike", level:"error", title:`Pico de alertas — ${errs.length} erros recentes`, detail: errs[errs.length-1].title });
    else if (errs.length) out.push({ id:"runtime-errors", level:"error", title:`${errs.length} erro(s) recente(s)`, detail: errs[errs.length-1].title });
    if (!out.length) out.push({ id:"all-ok", level:"ok", title:"Sistema operacional estável" });
    return out;
  }, [platforms, hailEvents, recent, stalledSO, prodTrend, overduePO, inactiveTechs, workspaceActivity]);

  const worst: SignalLevel = signals.some(s => s.level === "error") ? "error" : signals.some(s => s.level === "warn") ? "warn" : signals.some(s => s.level === "info" && s.id !== "all-ok") ? "info" : "ok";
  return { signals, worst, recent };
}
