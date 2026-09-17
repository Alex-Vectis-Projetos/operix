import { apiRequest } from "@/lib/api";
import type { ProductionOrder } from "@/hooks/useProductionOrders";

export function listProductionOrders(
  workspaceId: string,
  filters?: { status?: string; technician_user_id?: string },
): Promise<ProductionOrder[]> {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  if (filters?.status) params.set("status", filters.status);
  if (filters?.technician_user_id) params.set("technician_user_id", filters.technician_user_id);
  return apiRequest<ProductionOrder[]>(`/production-orders?${params}`, { timeoutMs: 10000 });
}

export function createProductionOrder(payload: Record<string, unknown>): Promise<ProductionOrder> {
  return apiRequest<ProductionOrder>("/production-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 12000,
  });
}

export function updateProductionOrder(
  id: string,
  patch: Record<string, unknown>,
): Promise<ProductionOrder> {
  return apiRequest<ProductionOrder>(`/production-orders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    timeoutMs: 12000,
  });
}

export function deleteProductionOrder(id: string): Promise<void> {
  return apiRequest<void>(`/production-orders/${id}`, { method: "DELETE", timeoutMs: 10000 });
}

export interface FinalizeProductionOrderResult {
  productionOrder: ProductionOrder;
  weeklog: any;
  weeklogEntry: any;
  idempotent?: boolean;
}

export function finalizeProductionOrder(id: string): Promise<FinalizeProductionOrderResult> {
  return apiRequest<FinalizeProductionOrderResult>(`/production-orders/${id}/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    timeoutMs: 15000,
  });
}

