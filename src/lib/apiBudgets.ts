import { apiRequest } from "@/lib/api";

export interface ApiBudgetRevision {
  id: string;
  budgetId: string;
  budget_id: string;
  revisionNumber: number;
  revision_number: number;
  status: "draft" | "submitted" | "approved" | "rejected";
  currencyCode: string;
  currency_code: string;
  budgetType: string;
  budget_type: string;
  clientSnapshot?: any;
  client_snapshot?: any;
  vehicleSnapshot?: any;
  vehicle_snapshot?: any;
  dossierSnapshot?: any;
  dossier_snapshot?: any;
  parts?: any[];
  services?: any[];
  labor?: any[];
  interventionTypes?: string[];
  intervention_types?: string[];
  diagnosis?: string | null;
  technicalDescription?: string | null;
  grossTotal: string | number;
  gross_total: string | number;
  discountPct: string | number;
  discount_pct: string | number;
  discountTotal: string | number;
  discount_total: string | number;
  netTotal: string | number;
  net_total: string | number;
  taxPct: string | number;
  tax_pct: string | number;
  taxTotal: string | number;
  tax_total: string | number;
  finalTotal: string | number;
  final_total: string | number;
  signature?: any;
  rejection?: any;
  approvedAt?: string | null;
  approved_at?: string | null;
  approvedById?: string | null;
  createdById?: string;
  createdAt?: string;
  created_at?: string;
}

export interface ApiBudget {
  id: string;
  workspaceId: string;
  workspace_id: string;
  code: string;
  clientId?: string | null;
  client_id?: string | null;
  clientName?: string | null;
  client_name?: string | null;
  vehiclePlate?: string | null;
  vehicle_plate?: string | null;
  vehicleVin?: string | null;
  vehicle_vin?: string | null;
  vehicleBrand?: string | null;
  vehicle_brand?: string | null;
  vehicleModel?: string | null;
  vehicle_model?: string | null;
  currentRevisionNumber: number;
  current_revision_number: number;
  currentRevisionId?: string | null;
  current_revision_id?: string | null;
  approvedRevisionId?: string | null;
  approved_revision_id?: string | null;
  technicianUserId?: string | null;
  technician_user_id?: string | null;
  legacyLocalId?: string | null;
  legacy_local_id?: string | null;
  createdAt: string;
  created_at: string;
  updatedAt: string;
  updated_at: string;
  currentRevision?: ApiBudgetRevision | null;
  current_revision?: ApiBudgetRevision | null;
  approvedRevision?: ApiBudgetRevision | null;
  approved_revision?: ApiBudgetRevision | null;
  revisions?: ApiBudgetRevision[];
  productionOrder?: any;
  production_order?: any;
}

export interface ApiBudgetPhoto {
  id: string;
  budgetId: string;
  budget_id: string;
  workspaceId: string;
  workspace_id: string;
  storagePath: string;
  storage_path: string;
  url?: string | null;
  download_url?: string | null;
  category: string;
  caption?: string | null;
  sizeBytes?: number | null;
  size_bytes?: number | null;
  uploadedBy?: string;
  uploaded_by?: string;
  createdAt: string;
  created_at: string;
}

export function listBudgets(filters?: {
  q?: string;
  clientId?: string;
  plate?: string;
}): Promise<{ budgets: ApiBudget[] }> {
  const params = new URLSearchParams();
  if (filters?.q) params.set("q", filters.q);
  if (filters?.clientId) params.set("clientId", filters.clientId);
  if (filters?.plate) params.set("plate", filters.plate);
  const queryStr = params.toString();
  return apiRequest<{ budgets: ApiBudget[] }>(`/budgets${queryStr ? `?${queryStr}` : ""}`);
}

export function getBudget(id: string): Promise<{ budget: ApiBudget }> {
  return apiRequest<{ budget: ApiBudget }>(`/budgets/${id}`);
}

export function getBudgetRevisions(id: string): Promise<{ revisions: ApiBudgetRevision[] }> {
  return apiRequest<{ revisions: ApiBudgetRevision[] }>(`/budgets/${id}/revisions`);
}

export function createBudget(payload: Record<string, any>): Promise<{
  budget: ApiBudget;
  revision: ApiBudgetRevision;
}> {
  return apiRequest<{ budget: ApiBudget; revision: ApiBudgetRevision }>("/budgets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateBudgetRevision(
  budgetId: string,
  revisionId: string,
  patch: Record<string, any>
): Promise<{
  budget: ApiBudget;
  revision: ApiBudgetRevision;
  isNewRevision: boolean;
}> {
  return apiRequest<{ budget: ApiBudget; revision: ApiBudgetRevision; isNewRevision: boolean }>(
    `/budgets/${budgetId}/revisions/${revisionId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }
  );
}

export function approveBudgetRevision(
  budgetId: string,
  revisionId: string,
  options?: { notes?: string; dueAt?: string | null }
): Promise<{
  budget: ApiBudget;
  revision: ApiBudgetRevision;
  productionOrder?: any;
}> {
  return apiRequest<{ budget: ApiBudget; revision: ApiBudgetRevision; productionOrder?: any }>(
    `/budgets/${budgetId}/revisions/${revisionId}/approve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revisionId, ...options }),
    }
  );
}

export function rejectBudgetRevision(
  budgetId: string,
  revisionId: string,
  reason: string
): Promise<{
  budget: ApiBudget;
  revision: ApiBudgetRevision;
}> {
  return apiRequest<{ budget: ApiBudget; revision: ApiBudgetRevision }>(
    `/budgets/${budgetId}/revisions/${revisionId}/reject`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revisionId, reason }),
    }
  );
}

export function syncLocalBudgets(
  items: Array<Record<string, any>>
): Promise<{ synced: Record<string, string> }> {
  return apiRequest<{ synced: Record<string, string> }>("/budgets/sync-local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
}

export function getBudgetPhotos(id: string): Promise<{ photos: ApiBudgetPhoto[] }> {
  return apiRequest<{ photos: ApiBudgetPhoto[] }>(`/budgets/${id}/photos`);
}

export function deleteBudgetPhoto(
  budgetId: string,
  photoId: string
): Promise<{ deleted: number; id: string }> {
  return apiRequest<{ deleted: number; id: string }>(`/budgets/${budgetId}/photos/${photoId}`, {
    method: "DELETE",
  });
}
