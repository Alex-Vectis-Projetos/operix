import { apiRequest } from "./api";

export interface ConfrontationColumnMapping {
  plateColumn?: string;
  vinColumn?: string;
  serviceColumn?: string;
  amountColumn?: string;
  taxType: "HT" | "TTC";
  granularity: "auto" | "synthetic" | "analytic";
}

export interface ConfrontationFilePreview {
  fileName: string;
  columns: string[];
  suggestedMapping: ConfrontationColumnMapping;
  rawRows?: Record<string, any>[];
  sampleRows: Record<string, any>[];
  totalRows: number;
}

export interface ExternalConfrontationRow {
  licensePlate?: string | null;
  vin?: string | null;
  serviceDescription?: string | null;
  amount: number | string;
  taxType?: "HT" | "TTC";
  rawRow?: Record<string, any>;
}

export interface ExecuteConfrontationInput {
  clientId: string;
  period?: string;
  paymentListId?: string;
  granularity?: "auto" | "synthetic" | "analytic";
  taxType?: "HT" | "TTC";
  rows: ExternalConfrontationRow[];
  mappingConfirmed?: ConfrontationColumnMapping;
  fileName?: string;
  fileBase64?: string;
  fileSha256?: string;
}

export interface ConfrontationItemResult {
  id: string;
  licensePlate: string;
  vin: string | null;
  carName: string | null;
  serviceDescription: string;
  internalAmount: string;
  externalAmount: string;
  differenceAmount: string;
  status:
    | "exact_match"
    | "value_difference"
    | "service_discrepancy"
    | "omitted_by_client"
    | "in_production"
    | "vehicle_not_found"
    | "validated_pending_list"
    | "ambiguous_match";
  decision: "none" | "contest" | "accept_difference" | "resolve" | "pending";
  decisionNotes?: string | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  weeklogId?: string | null;
  weeklogValidationId?: string | null;
  weeklogSignatureRef?: string | null;
  paymentListId?: string | null;
}

export interface ConfrontationSummaryMetrics {
  totalCompared: number;
  exactMatchCount: number;
  valueDifferenceCount: number;
  omittedByClientCount: number;
  inProductionCount: number;
  notFoundCount: number;
  totalInternalAmount: string;
  totalExternalAmount: string;
  netDifferenceAmount: string;
}

export interface ConfrontationExecutionResponse {
  runId: string;
  sequence: number;
  createdAt: string;
  client: { id: string; name: string };
  period?: string | null;
  paymentList?: { id: string; listNumber: string } | null;
  granularityUsed: "synthetic" | "analytic";
  metrics: ConfrontationSummaryMetrics;
  results: ConfrontationItemResult[];
  fileName?: string | null;
  mappingConfirmed?: any;
}

export interface ConfrontationRunSummary {
  id: string;
  runNumber: number;
  client: { id: string; name: string };
  paymentList?: { id: string; listNumber: string } | null;
  period?: string | null;
  fileName?: string | null;
  granularity: string;
  metrics: ConfrontationSummaryMetrics;
  createdAt: string;
  createdBy?: { id: string; fullName: string } | null;
}

export interface ConfrontationEvidenceResponse {
  available: boolean;
  validationId?: string;
  sequence?: number;
  signedAt?: string;
  validatorName?: string;
  signatureUrl?: string | null;
  mimeType?: string;
  fileName?: string;
  notes?: string;
}

export async function previewConfrontationFile(file: File): Promise<ConfrontationFilePreview> {
  const form = new FormData();
  form.append("file", file);
  return apiRequest<ConfrontationFilePreview>("/payment-lists/confrontation/preview", {
    method: "POST",
    body: form,
  });
}

export async function executeConfrontationHub(
  input: ExecuteConfrontationInput
): Promise<ConfrontationExecutionResponse> {
  return apiRequest<ConfrontationExecutionResponse>("/payment-lists/confrontation/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function listConfrontationRuns(clientId?: string): Promise<ConfrontationRunSummary[]> {
  const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
  return apiRequest<ConfrontationRunSummary[]>(`/payment-lists/confrontation/runs${query}`, {
    method: "GET",
  });
}

export async function getConfrontationRun(runId: string): Promise<ConfrontationExecutionResponse> {
  return apiRequest<ConfrontationExecutionResponse>(`/payment-lists/confrontation/runs/${runId}`, {
    method: "GET",
  });
}

export async function saveConfrontationDecision(
  runId: string,
  input: { itemKey: string; decision: string; decisionNotes?: string }
): Promise<{ success: boolean; decision: any }> {
  return apiRequest<{ success: boolean; decision: any }>(
    `/payment-lists/confrontation/runs/${runId}/decisions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );
}

export async function getConfrontationEvidence(
  validationId: string
): Promise<ConfrontationEvidenceResponse> {
  return apiRequest<ConfrontationEvidenceResponse>(
    `/payment-lists/confrontation/evidence/${validationId}`,
    {
      method: "GET",
    }
  );
}
