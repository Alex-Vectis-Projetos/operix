import { apiRequest } from "@/lib/api";

export interface ServiceOrderRecord {
  id: string;
  workspace_id: string | null;
  visibility_scope: string;
  user_id: string;
  assigned_user_id: string;
  client_id: string | null;
  client_name: string;
  car_name: string | null;
  license_plate: string | null;
  platform: string | null;
  platform_id: string | null;
  operational_unit: string | null;
  group_id: string | null;
  week: string | null;
  year_reference: number | null;
  technician_name: string;
  technician_earning: number | null;
  technician_percentage: number | null;
  service_1_name: string | null;
  service_1_price: number | null;
  service_2_name: string | null;
  service_2_price: number | null;
  service_3_name: string | null;
  service_3_price: number | null;
  service_4_name: string | null;
  service_4_price: number | null;
  total: number | null;
  status: string;
  distribution_snapshot: Record<string, unknown> | null;
  created_by: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export function listServiceOrders(
  workspaceId: string,
  filters?: { client_id?: string; platform?: string; week?: string; assigned_user_id?: string },
): Promise<ServiceOrderRecord[]> {
  const params = new URLSearchParams({ workspace_id: workspaceId });
  if (filters?.client_id) params.set("client_id", filters.client_id);
  if (filters?.platform) params.set("platform", filters.platform);
  if (filters?.week) params.set("week", filters.week);
  if (filters?.assigned_user_id) params.set("assigned_user_id", filters.assigned_user_id);
  return apiRequest<ServiceOrderRecord[]>(`/service-orders?${params}`, { timeoutMs: 10000 });
}


export function listClients(
  workspaceId?: string,
): Promise<{ id: string; name: string }[]> {
  const params = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : "";
  return apiRequest<{ id: string; name: string }[]>(`/service-orders/clients${params}`, {
    timeoutMs: 8000,
  });
}
