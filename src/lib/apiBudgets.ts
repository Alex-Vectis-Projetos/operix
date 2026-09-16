import { apiRequest } from "@/lib/api";

export type BudgetStatus = "draft" | "submitted" | "approved" | "rejected";
export type BudgetType = "pdr" | "smart" | "detailing" | "bodywork" | "mechanic" | "other";

export interface CreateBudgetInput {
  clientId?: string | null;
  clientName?: string | null;
  vehiclePlate?: string | null;
  vehicleVin?: string | null;
  vehicleBrand?: string | null;
  vehicleModel?: string | null;
  technicianUserId?: string | null;
  legacyLocalId?: string | null;
  currencyCode?: string;
  budgetType?: BudgetType | string;
  clientSnapshot?: Record<string, any> | null;
  vehicleSnapshot?: Record<string, any> | null;
  dossierSnapshot?: Record<string, any> | null;
  parts?: any[];
  services?: any[];
  labor?: any[];
  interventionTypes?: string[];
  diagnosis?: string | null;
  technicalDescription?: string | null;
  notes?: string | null;
  grossTotal?: number | string;
  discountPct?: number | string;
  taxPct?: number | string;
}

export interface UpdateBudgetRevisionInput {
  currencyCode?: string;
  budgetType?: BudgetType | string;
  clientSnapshot?: Record<string, any> | null;
  vehicleSnapshot?: Record<string, any> | null;
  dossierSnapshot?: Record<string, any> | null;
  parts?: any[];
  services?: any[];
  labor?: any[];
  interventionTypes?: string[];
  diagnosis?: string | null;
  technicalDescription?: string | null;
  notes?: string | null;
  grossTotal?: number | string;
  discountPct?: number | string;
  taxPct?: number | string;
}

export interface ApproveBudgetRevisionOptions {
  notes?: string;
  dueAt?: string | null;
}

export interface ApiBudgetRevision {
  id: string;
  budgetId: string;
  budget_id: string;
  revisionNumber: number;
  revision_number: number;
  status: BudgetStatus;
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

export function createBudget(payload: CreateBudgetInput): Promise<{
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
  patch: UpdateBudgetRevisionInput
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
  options?: ApproveBudgetRevisionOptions
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

export function uploadBudgetPhoto(
  budgetId: string,
  file: File | Blob,
  meta?: { category?: string; caption?: string }
): Promise<{ photo: ApiBudgetPhoto }> {
  const formData = new FormData();
  formData.append("file", file, (file as File).name || "photo.jpg");
  if (meta?.category) formData.append("category", meta.category);
  if (meta?.caption) formData.append("caption", meta.caption);

  return apiRequest<{ photo: ApiBudgetPhoto }>(`/budgets/${budgetId}/photos`, {
    method: "POST",
    body: formData,
  });
}

export function deleteBudgetPhoto(
  budgetId: string,
  photoId: string
): Promise<{ deleted: number; id: string }> {
  return apiRequest<{ deleted: number; id: string }>(`/budgets/${budgetId}/photos/${photoId}`, {
    method: "DELETE",
  });
}

export function deleteBudget(id: string): Promise<{ success: boolean; id: string }> {
  return apiRequest<{ success: boolean; id: string }>(`/budgets/${id}`, {
    method: "DELETE",
  });
}

export function apiBudgetToLocalBudget(api: ApiBudget): any {
  const rev = api.currentRevision || api.current_revision;
  const clientSnap = rev?.clientSnapshot || rev?.client_snapshot || {};
  const vehicleSnap = rev?.vehicleSnapshot || rev?.vehicle_snapshot || {};
  const dossierSnap = rev?.dossierSnapshot || rev?.dossier_snapshot || {};

  return {
    id: api.id,
    number: api.code,
    issued_at: rev?.createdAt || rev?.created_at || api.createdAt || api.created_at || new Date().toISOString(),
    status: (rev?.status || "draft") as any,
    budget_type: (rev?.budgetType || rev?.budget_type || "pdr") as any,

    client_id: api.clientId || api.client_id || clientSnap.id || undefined,
    client_display_id: clientSnap.display_id || clientSnap.customer_display_id || undefined,
    client_name: api.clientName || api.client_name || clientSnap.name || "Cliente",
    client_phone: clientSnap.phone || undefined,
    client_email: clientSnap.email || undefined,
    client_document: clientSnap.document || undefined,

    address_number: clientSnap.address?.number || undefined,
    address_street: clientSnap.address?.street || undefined,
    address_complement: clientSnap.address?.complement || undefined,
    address_postal: clientSnap.address?.postal || undefined,
    address_city: clientSnap.address?.city || undefined,
    address_country: clientSnap.address?.country || undefined,

    dossier_claim_number: dossierSnap.claim_number || undefined,
    dossier_expert_number: dossierSnap.expert_number || undefined,
    dossier_insurance_company: dossierSnap.insurance_company || undefined,
    dossier_garage_name: dossierSnap.garage_name || undefined,

    vehicle_brand: api.vehicleBrand || api.vehicle_brand || vehicleSnap.brand || undefined,
    vehicle_model: api.vehicleModel || api.vehicle_model || vehicleSnap.model || undefined,
    vehicle_plate: api.vehiclePlate || api.vehicle_plate || vehicleSnap.plate || undefined,
    vehicle_vin: api.vehicleVin || api.vehicle_vin || vehicleSnap.vin || undefined,
    vehicle_year: vehicleSnap.year || undefined,
    vehicle_color: vehicleSnap.color || undefined,
    vehicle_km: vehicleSnap.km || undefined,

    intervention_types: rev?.interventionTypes || rev?.intervention_types || [],
    diagnosis: rev?.diagnosis || undefined,
    technical_description: rev?.technicalDescription || rev?.technical_description || undefined,

    discount_pct: Number(rev?.discountPct ?? rev?.discount_pct ?? 0),
    iva_pct: Number(rev?.taxPct ?? rev?.tax_pct ?? 0),

    parts: rev?.parts || [],
    services: rev?.services || [],
    labor: rev?.labor || [],

    vehicle_view_state: null,
    mechanical_selections: [],

    signature_ready: !!rev?.signature?.signed,
    signature: rev?.signature || {
      signed: false,
      signerName: "",
      signerType: "",
      signedAt: null,
      signatureData: null,
      confirmationMethod: null,
      budgetNumberAtMoment: null,
      finalValueAtMoment: null,
    },
    rejection: rev?.rejection || { rejected: false, rejectedAt: null, rejectedBy: null, reason: null },
    created_at: api.createdAt || api.created_at || new Date().toISOString(),
    updated_at: api.updatedAt || api.updated_at || new Date().toISOString(),
  };
}

export function localBudgetToApiPayload(b: any): CreateBudgetInput {
  return {
    clientId: b.client_id || null,
    clientName: b.client_name || null,
    vehiclePlate: b.vehicle_plate || null,
    vehicleVin: b.vehicle_vin || null,
    vehicleBrand: b.vehicle_brand || null,
    vehicleModel: b.vehicle_model || null,
    currencyCode: "EUR",
    budgetType: b.budget_type || "pdr",
    clientSnapshot: {
      id: b.client_id,
      display_id: b.client_display_id,
      name: b.client_name,
      phone: b.client_phone,
      email: b.client_email,
      document: b.client_document,
      address: {
        number: b.address_number,
        street: b.address_street,
        complement: b.address_complement,
        postal: b.address_postal,
        city: b.address_city,
        country: b.address_country,
      },
    },
    vehicleSnapshot: {
      brand: b.vehicle_brand,
      model: b.vehicle_model,
      plate: b.vehicle_plate,
      vin: b.vehicle_vin,
      year: b.vehicle_year,
      color: b.vehicle_color,
      km: b.vehicle_km,
    },
    dossierSnapshot: {
      claim_number: b.dossier_claim_number,
      expert_number: b.dossier_expert_number,
      insurance_company: b.dossier_insurance_company,
      garage_name: b.dossier_garage_name,
    },
    parts: b.parts || [],
    services: b.services || [],
    labor: b.labor || [],
    interventionTypes: b.intervention_types || [],
    diagnosis: b.diagnosis || null,
    technicalDescription: b.technical_description || null,
    discountPct: b.discount_pct || 0,
    taxPct: b.iva_pct || 0,
    notes: b.notes || null,
  };
}
