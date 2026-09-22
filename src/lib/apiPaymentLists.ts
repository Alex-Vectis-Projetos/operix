import { apiRequest } from "@/lib/api";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type PaymentListStatus = "draft" | "under_review" | "confronted" | "pending" | "paid" | "cancelled";
export type PaymentListTransitionStatus = Exclude<PaymentListStatus, "draft">;
export type PaymentListEntryClaimStatus = "reserved" | "consumed" | "released";
export type ConfrontationStatus =
  | "not_evaluated"
  | "exact_match"
  | "ambiguous_match"
  | "value_difference"
  | "service_discrepancy"
  | "vehicle_not_found"
  | "unmatched_weeklog";
export type ConfrontationDecision = "none" | "accept_difference" | "contest" | "request_rectification" | "reject_item";
export type ConfrontationDecisionInput = Exclude<ConfrontationDecision, "none">;
export type ConfrontationMode = "current" | "new_round";
export type ExternalListImportStatus = "uploaded" | "extracting" | "extracted" | "under_review" | "reviewed" | "committed" | "failed" | "discarded";

export interface PaymentListItem {
  id: string;
  workspaceId: string;
  paymentListId: string;
  weeklogEntryId: string | null;
  legacyPaymentOrderId: string | null;
  carName: string | null;
  licensePlate: string | null;
  vin: string | null;
  technicianUserId: string | null;
  technicianName: string | null;
  operationalSiteKey: string | null;
  servicesSnapshot: JsonValue;
  totalAmount: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentListEntryClaim {
  id: string;
  workspaceId: string;
  paymentListId: string;
  weeklogEntryId: string;
  status: PaymentListEntryClaimStatus;
  claimedAt: string;
  consumedAt: string | null;
  releasedAt: string | null;
  releasedReason: string | null;
}

export interface PaymentList {
  id: string;
  workspaceId: string;
  listNumber: string;
  clientId: string;
  clientName: string;
  currencyCode: string;
  status: PaymentListStatus;
  itemCount: number;
  sourceDocumentTotal: string;
  recognizedTotal: string;
  issueDate: string | null;
  dueDate: string | null;
  paidAt: string | null;
  paidBy: string | null;
  documentId: string | null;
  invoiceId: string | null;
  notes: string | null;
  createdBy: string;
  confrontedBy: string | null;
  confrontedAt: string | null;
  validatedBy: string | null;
  validatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: PaymentListItem[];
  claims?: PaymentListEntryClaim[];
}

export type PaymentListDetail = PaymentList;

export interface PaymentListCreateInput {
  clientId: string;
  currencyCode: string;
  entryIds?: string[];
  issueDate?: string;
  dueDate?: string;
  notes?: string;
}

export interface PaymentListStatusTransitionInput {
  toStatus: PaymentListTransitionStatus;
}

export interface ConfrontationResult {
  id: string;
  workspaceId: string;
  paymentListId: string;
  runId: string;
  paymentListItemId: string | null;
  weeklogEntryId: string | null;
  status: ConfrontationStatus;
  decision: ConfrontationDecision;
  differenceAmount: string;
  notes: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  reopenedProductionOrderId: string | null;
  targetExecutionSequence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConfrontationRun {
  runId: string;
  sequence: number;
  status: string;
  results: ConfrontationResult[];
  idempotent: boolean;
  mode: ConfrontationMode;
  previousRunId?: string;
}

export interface PaymentListConfrontationEmpty {
  status: "not_evaluated";
  items: Array<{ paymentListItemId: string; confrontationStatus: "not_evaluated" }>;
  results: [];
}

export type PaymentListConfrontation = ConfrontationRun | PaymentListConfrontationEmpty;

export interface ConfrontationDecisionPayload {
  decision: ConfrontationDecisionInput;
  notes: string;
}

export interface ConfrontationDecisionResponse {
  result: ConfrontationResult;
  idempotent: boolean;
}

export interface ExternalListImportItem {
  id: string;
  workspaceId: string;
  importId: string;
  rawLicensePlate: string | null;
  rawVin: string | null;
  rawCarName: string | null;
  rawClient: string | null;
  rawTechnician: string | null;
  rawPlatform: string | null;
  rawServices: JsonValue | null;
  rawTotalText: string | null;
  fieldConfidence: JsonValue | null;
  reviewedLicensePlate: string | null;
  reviewedVin: string | null;
  reviewedCarName: string | null;
  reviewedTechnicianUserId: string | null;
  reviewedServices: JsonValue | null;
  reviewedTotal: string | null;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
}

export interface ExternalListImport {
  id: string;
  workspaceId: string;
  paymentListId: string | null;
  fileName: string;
  storagePath: string | null;
  fileSha256: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  reviewedClientId: string | null;
  reviewedCurrencyCode: string | null;
  status: ExternalListImportStatus;
  rawOcrResult: JsonValue | null;
  errorMessage: string | null;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
  items: ExternalListImportItem[];
}

export interface ExternalListImportResponse {
  importId: string;
  status: ExternalListImportStatus;
  item?: ExternalListImportItem | null;
  items: ExternalListImportItem[];
  import: ExternalListImport;
  sha256?: string | null;
}

export interface ExternalListImportHeaderReview {
  reviewedClientId?: string | null;
  reviewedCurrencyCode?: string | null;
}

export interface ExternalListImportServiceReview {
  code?: string;
  description?: string;
  quantity?: number | string;
  amount?: number | string;
  unitPrice?: number | string;
  [key: string]: JsonValue | undefined;
}

export interface ExternalListImportItemReview {
  reviewedLicensePlate?: string | null;
  reviewedVin?: string | null;
  reviewedCarName?: string | null;
  reviewedServices?: ExternalListImportServiceReview[] | null;
  reviewedTotal?: string | null;
}

export interface ExternalListImportRowsReviewInput {
  header?: ExternalListImportHeaderReview;
  rows?: Array<{ id: string; patch: ExternalListImportItemReview }>;
}

export function listPaymentLists(): Promise<PaymentList[]> {
  return apiRequest<PaymentList[]>("/payment-lists");
}

export function getPaymentList(paymentListId: string): Promise<PaymentListDetail> {
  return apiRequest<PaymentListDetail>(`/payment-lists/${paymentListId}`);
}

export function createPaymentList(payload: PaymentListCreateInput): Promise<PaymentList> {
  return apiRequest<PaymentList>("/payment-lists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function transitionPaymentListStatus(paymentListId: string, payload: PaymentListStatusTransitionInput): Promise<PaymentList> {
  return apiRequest<PaymentList>(`/payment-lists/${paymentListId}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function createPaymentListImport(file: File): Promise<ExternalListImportResponse> {
  const body = new FormData();
  body.append("file", file);
  return apiRequest<ExternalListImportResponse>("/payment-lists/imports", { method: "POST", body });
}

export function getPaymentListImport(importId: string): Promise<ExternalListImportResponse> {
  return apiRequest<ExternalListImportResponse>(`/payment-lists/imports/${importId}`);
}

export function retryPaymentListImportExtraction(importId: string): Promise<ExternalListImportResponse> {
  return apiRequest<ExternalListImportResponse>(`/payment-lists/imports/${importId}/retry-extraction`, { method: "POST" });
}

export function updatePaymentListImportRows(importId: string, payload: ExternalListImportRowsReviewInput): Promise<ExternalListImportResponse> {
  return apiRequest<ExternalListImportResponse>(`/payment-lists/imports/${importId}/rows`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function discardPaymentListImport(importId: string): Promise<void> {
  return apiRequest<void>(`/payment-lists/imports/${importId}`, { method: "DELETE" });
}

export function commitPaymentListImport(importId: string): Promise<PaymentList> {
  return apiRequest<PaymentList>(`/payment-lists/imports/${importId}/commit`, { method: "POST" });
}

export function getPaymentListConfrontation(paymentListId: string): Promise<PaymentListConfrontation> {
  return apiRequest<PaymentListConfrontation>(`/payment-lists/${paymentListId}/confrontation`);
}

export function confrontPaymentList(paymentListId: string, payload: { mode?: ConfrontationMode } = {}): Promise<ConfrontationRun> {
  return apiRequest<ConfrontationRun>(`/payment-lists/${paymentListId}/confront`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function decideConfrontationResult(paymentListId: string, resultId: string, payload: ConfrontationDecisionPayload): Promise<ConfrontationDecisionResponse> {
  return apiRequest<ConfrontationDecisionResponse>(`/payment-lists/${paymentListId}/confrontation/${resultId}/decision`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
