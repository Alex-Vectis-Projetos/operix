import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "./useWorkspace";
import { useAuth } from "./useAuth";
import { toast } from "sonner";
import {
  listProductionOrders,
  createProductionOrder,
  updateProductionOrder,
  deleteProductionOrder,
} from "@/lib/apiProductionOrders";

export type ProductionStatus =
  | "new_vehicle" | "triage" | "awaiting_validation" | "in_production"
  | "paused" | "finished" | "invoiced" | "delivered";

export type CommercialStatus = "invoiced" | "delivered" | null;

export const LOCKED_STATUSES: ProductionStatus[] = ["delivered", "invoiced"];
export const isOrderLocked = (s?: ProductionStatus | null) => !!s && LOCKED_STATUSES.includes(s);

export type ProductionPriority = "low" | "normal" | "high" | "urgent";

export interface ProductionOrder {
  id: string;
  workspace_id: string;
  code: string;
  client_id: string | null;
  client_name: string | null;
  technician_user_id: string | null;
  technician_name: string | null;
  platform: string | null;
  insurer: string | null;
  license_plate: string | null;
  vin: string | null;
  brand: string | null;
  model: string | null;
  color: string | null;
  notes: string | null;
  priority: ProductionPriority;
  status: ProductionStatus;
  due_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  delivered_at: string | null;
  service_order_id: string | null;
  budget_id?: string | null;
  budgetId?: string | null;
  budget_revision_id?: string | null;
  budgetRevisionId?: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export const PRODUCTION_STATUSES: { value: ProductionStatus; label: string; color: string }[] = [
  { value: "in_production", label: "Em Produção", color: "bg-indigo-500" },
  { value: "paused", label: "Pausado", color: "bg-amber-500" },
  { value: "delivered", label: "Finalizado", color: "bg-emerald-500" },
];

export const PRIORITY_META: Record<ProductionPriority, { label: string; tone: string }> = {
  low: { label: "Baixa", tone: "text-muted-foreground" },
  normal: { label: "Normal", tone: "text-foreground" },
  high: { label: "Alta", tone: "text-amber-500" },
  urgent: { label: "Urgente", tone: "text-destructive" },
};

const TIMESTAMP_FIELDS = ["due_at", "started_at", "finished_at", "delivered_at"] as const;
const TEXT_NULL_FIELDS = [
  "client_id", "client_name", "technician_user_id", "technician_name", "platform", "insurer",
  "license_plate", "vin", "brand", "model", "color", "notes", "service_order_id", "commercial_status",
] as const;

export function normalizeProductionOrderPayload(payload: Partial<ProductionOrder>) {
  const normalized: Record<string, unknown> = { ...payload };
  delete normalized.id;
  delete normalized.created_at;
  delete normalized.updated_at;
  delete normalized.created_by;
  delete normalized.workspace_id;

  TIMESTAMP_FIELDS.forEach((field) => {
    if (!(field in normalized)) return;
    const value = normalized[field];
    normalized[field] = typeof value === "string" && value.trim() === "" ? null : value ?? null;
  });

  TEXT_NULL_FIELDS.forEach((field) => {
    if (!(field in normalized)) return;
    if (normalized[field] === "") normalized[field] = null;
  });

  return normalized as Partial<ProductionOrder>;
}

export function useProductionOrders(filters?: { technicianOnly?: boolean; status?: ProductionStatus }) {
  const qc = useQueryClient();
  const { workspaceId } = useWorkspace();
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["production_orders", workspaceId, filters],
    enabled: !!workspaceId,
    queryFn: () =>
      listProductionOrders(workspaceId!, {
        status: filters?.status,
        technician_user_id: filters?.technicianOnly && user?.id ? user.id : undefined,
      }),
    retry: 0,
    placeholderData: (previousData) => previousData ?? [],
  });

  const create = useMutation({
    mutationFn: async (payload: Partial<ProductionOrder>) => {
      if (!workspaceId) throw new Error("Workspace ausente");
      const clean = normalizeProductionOrderPayload(payload);
      return createProductionOrder({
        priority: "normal",
        status: "in_production",
        ...clean,
        workspace_id: workspaceId,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production_orders"] });
      toast.success("Ordem criada");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, ...patch }: Partial<ProductionOrder> & { id: string }) => {
      const clean = normalizeProductionOrderPayload(patch);
      const stamp: Record<string, string> = {};
      if (clean.status === "in_production" && !clean.started_at) stamp.started_at = new Date().toISOString();
      if (clean.status === "delivered" && !clean.delivered_at) stamp.delivered_at = new Date().toISOString();
      return updateProductionOrder(id, { ...clean, ...stamp });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["production_orders"] }),
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteProductionOrder(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["production_orders"] });
      toast.success("Ordem removida");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return { ...query, create, update, remove };
}

export function useProductionKpis() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: ["production_kpis", workspaceId],
    enabled: !!workspaceId,
    queryFn: async (): Promise<{
      in_progress: number; paused: number; finished_today: number; delivered_today: number;
      overdue: number; active_technicians: number; avg_cycle_minutes: number;
      by_platform: Record<string, number>;
    }> => {
      const orders = await listProductionOrders(workspaceId!);
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const in_progress = orders.filter((o) => o.status === "in_production").length;
      const paused = orders.filter((o) => o.status === "paused").length;
      const finished_today = orders.filter(
        (o) => o.finished_at && new Date(o.finished_at) >= todayStart,
      ).length;
      const delivered_today = orders.filter(
        (o) => o.delivered_at && new Date(o.delivered_at) >= todayStart,
      ).length;
      const overdue = orders.filter(
        (o) => o.due_at && new Date(o.due_at) < now && !["finished", "invoiced", "delivered"].includes(o.status),
      ).length;

      const techSet = new Set(orders.filter((o) => o.technician_user_id).map((o) => o.technician_user_id));
      const active_technicians = techSet.size;

      const cycles = orders
        .filter((o) => o.started_at && o.finished_at)
        .map((o) => (new Date(o.finished_at!).getTime() - new Date(o.started_at!).getTime()) / 60000);
      const avg_cycle_minutes = cycles.length ? cycles.reduce((a, b) => a + b, 0) / cycles.length : 0;

      const by_platform: Record<string, number> = {};
      orders.forEach((o) => {
        if (o.platform) by_platform[o.platform] = (by_platform[o.platform] ?? 0) + 1;
      });

      return { in_progress, paused, finished_today, delivered_today, overdue, active_technicians, avg_cycle_minutes, by_platform };
    },
  });
}

export function useProductionTimeline(_orderId: string | null) {
  return useQuery({
    queryKey: ["production_events", _orderId],
    enabled: false,
    queryFn: async () => [] as unknown[],
    retry: 0,
    placeholderData: [],
  });
}
