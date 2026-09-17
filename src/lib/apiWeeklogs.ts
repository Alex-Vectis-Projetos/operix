import { apiRequest, ApiError } from "@/lib/api";

export type WeeklogStatus = "open" | "pending_validation" | "validated" | "rectification_pending";
export type WeeklogEntryValidationStatus = "pending" | "approved" | "rejected" | "rectification_requested";

export interface WeeklogEntry {
  id: string;
  weeklogId: string;
  productionOrderId: string;
  executionSequence: number;
  technicianUserId: string;
  technicianName?: string | null;
  clientId: string;
  clientName?: string | null;
  currencyCode: string;
  totalAmount: string | number;
  servicesSnapshot: any[];
  vehicleSnapshot?: any;
  deliveredAt: string;
  validationStatus: WeeklogEntryValidationStatus;
  rejectionReason: string | null;
  rectificationOriginId: string | null;
  legacyServiceOrderId?: string | null;
  reviewedAt?: string | null;
  reviewerUserId?: string | null;
  rectificationReason?: string | null;
  rectificationRequestedAt?: string | null;
  rectificationRequestedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WeeklogValidationSummary {
  id: string;
  weeklogId: string;
  workspaceId: string;
  validationSequence: number;
  status: string;
  submittedAt: string | null;
  submittedBy: string | null;
  validatedAt: string | null;
  validatorUserId?: string | null;
  validationMethod?: string | null;
  signatureStoragePath?: string | null;
  coverageSnapshot?: any;
  auditTrail?: any;
  createdAt: string;
  updatedAt: string;
}

export interface Weeklog {
  id: string;
  workspaceId: string;
  startsOn: string;
  endsOn?: string;
  week?: string;
  weekNumber?: number;
  yearReference?: number;
  clientId: string;
  siteKey: string;
  status: WeeklogStatus;
  createdAt: string;
  updatedAt: string;
  validations?: WeeklogValidationSummary[];
  entries?: WeeklogEntry[];
}

export interface WeeklogFilters {
  startsOn?: string;
  clientId?: string;
  status?: string;
  siteKey?: string;
}

export interface ReviewWeeklogEntryPayload {
  outcome: "approved" | "rejected";
  rejectionReason?: string | null;
}

export interface ValidateWeeklogPayload {
  validationMethod: "authenticated_confirmation" | "drawn_signature";
  signatureStoragePath?: string | null;
}

export interface RectifyWeeklogEntryPayload {
  reason: string;
  assignedTechnicianUserId?: string | null;
}

export interface SubmitWeeklogResult {
  weeklog: Weeklog;
  validationRound: WeeklogValidationSummary;
  coverageSnapshot: any[];
  status: "pending_validation";
  idempotent: boolean;
}

export interface UploadSignatureResult {
  signatureStoragePath: string;
  uploadedAt: string;
}

export interface ValidateWeeklogResult {
  weeklog: Weeklog;
  validationRound: WeeklogValidationSummary;
  idempotent: boolean;
}

export interface RectifyWeeklogEntryResult {
  productionOrder: any;
  weeklog: Weeklog;
  weeklogEntry: WeeklogEntry;
  idempotent: boolean;
}

export function listWeeklogs(filters?: WeeklogFilters): Promise<Weeklog[]> {
  const params = new URLSearchParams();
  if (filters?.startsOn) params.set("startsOn", filters.startsOn);
  if (filters?.clientId) params.set("clientId", filters.clientId);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.siteKey) params.set("siteKey", filters.siteKey);

  const qs = params.toString();
  return apiRequest<Weeklog[]>(`/weeklogs${qs ? `?${qs}` : ""}`, {
    timeoutMs: 12000,
  });
}

export function getWeeklog(id: string): Promise<Weeklog> {
  return apiRequest<Weeklog>(`/weeklogs/${id}`, {
    timeoutMs: 10000,
  });
}

export function listWeeklogEntries(weeklogId: string): Promise<WeeklogEntry[]> {
  return apiRequest<WeeklogEntry[]>(`/weeklogs/${weeklogId}/entries`, {
    timeoutMs: 10000,
  });
}

export function getWeeklogEntry(weeklogId: string, entryId: string): Promise<WeeklogEntry> {
  return apiRequest<WeeklogEntry>(`/weeklogs/${weeklogId}/entries/${entryId}`, {
    timeoutMs: 10000,
  });
}

export function submitWeeklogForValidation(weeklogId: string): Promise<SubmitWeeklogResult> {
  return apiRequest<SubmitWeeklogResult>(`/weeklogs/${weeklogId}/submit-for-validation`, {
    method: "POST",
    timeoutMs: 15000,
  });
}

export function reviewWeeklogEntry(
  weeklogId: string,
  entryId: string,
  payload: ReviewWeeklogEntryPayload
): Promise<WeeklogEntry> {
  return apiRequest<WeeklogEntry>(`/weeklogs/${weeklogId}/entries/${entryId}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 12000,
  });
}

export async function uploadWeeklogSignature(
  weeklogId: string,
  pngBlob: Blob
): Promise<UploadSignatureResult> {
  return apiRequest<UploadSignatureResult>(`/weeklogs/${weeklogId}/signature-upload`, {
    method: "POST",
    body: pngBlob,
    headers: {
      "Content-Type": "image/png",
    },
    timeoutMs: 20000,
  });
}

export function validateWeeklog(
  weeklogId: string,
  payload: ValidateWeeklogPayload
): Promise<ValidateWeeklogResult> {
  return apiRequest<ValidateWeeklogResult>(`/weeklogs/${weeklogId}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 15000,
  });
}

export function rectifyWeeklogEntry(
  weeklogId: string,
  entryId: string,
  payload: RectifyWeeklogEntryPayload
): Promise<RectifyWeeklogEntryResult> {
  return apiRequest<RectifyWeeklogEntryResult>(`/weeklogs/${weeklogId}/entries/${entryId}/rectify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 15000,
  });
}

export function mapWeeklogError(error: unknown): string {
  if (error instanceof ApiError) {
    const code = error.code;
    switch (code) {
      case "WEEKLOG_INVALID_STATE_FOR_SUBMISSION":
        return "O lote semanal não está em estado elegível para submissão (deve estar aberto ou com retificação pendente).";
      case "OUTCOME_REQUIRED":
        return "É necessário indicar se o item foi aprovado ou rejeitado.";
      case "REJECTION_REASON_REQUIRED":
        return "Motivo da rejeição é obrigatório e deve ser preenchido.";
      case "VALIDATED_IMMUTABLE":
      case "SIGNATURE_IMMUTABLE_AFTER_VALIDATION":
        return "O lote semanal já foi validado e não aceita modificações ou novas assinaturas.";
      case "WEEKLOG_NOT_PENDING_VALIDATION":
        return "A operação exige que o lote esteja em estado 'pending_validation'.";
      case "VALIDATOR_GRANT_REQUIRED":
        return "Acesso negado: você não possui vínculo ativo (ClientAccessGrant) para validar ordens deste cliente.";
      case "VALIDATOR_REVOKED":
        return "Acesso revogado: o vínculo de validação para este cliente foi cancelado.";
      case "VALIDATOR_SELF_FORBIDDEN":
        return "Auto-validação proibida: você executou este serviço e não pode inspecionar o próprio trabalho.";
      case "VALIDATOR_BATCH_SELF_FORBIDDEN":
        return "Auto-validação em lote proibida: você participou da execução de itens deste lote e não pode validá-lo.";
      case "ENTRY_ALREADY_REVIEWED":
        return "Este item já foi inspecionado e não permite alteração direta.";
      case "VALIDATION_REVIEW_INCOMPLETE":
        return "Existem itens com revisão pendente. Todos os itens devem ser aprovados ou rejeitados antes da validação final.";
      case "VALIDATION_METHOD_REQUIRED":
        return "Método de validação inválido ou não informado.";
      case "SIGNATURE_REQUIRED":
        return "Assinatura gráfica obrigatória para o método selecionado.";
      case "EMPTY_FILE":
        return "O arquivo de assinatura enviado está vazio.";
      case "FILE_TOO_LARGE":
        return "O arquivo de assinatura excede o limite máximo permitido de 1 MB.";
      case "INVALID_PNG_HEADER":
      case "INVALID_PNG_MAGIC_BYTES":
        return "O arquivo fornecido não é um arquivo PNG autêntico.";
      case "SIGNATURE_FILE_NOT_FOUND":
        return "Arquivo de assinatura temporário não encontrado no servidor.";
      case "STORAGE_UNAVAILABLE":
        return "Serviço de armazenamento (MinIO/S3) indisponível. Tente novamente.";
      case "WEEKLOG_ALREADY_VALIDATED":
        return "Conflito de validação: este lote já foi validado por outro usuário.";
      case "RECTIFICATION_REASON_REQUIRED":
        return "O motivo da solicitação de retificação é obrigatório.";
      case "VALIDATOR_CANNOT_ASSIGN_TECHNICIAN":
        return "Validadores do cliente não possuem autorização para definir o técnico na retificação.";
      case "RECTIFICATION_PAYLOAD_CONFLICT":
        return "Conflito nos parâmetros da solicitação de retificação.";
      case "STALE_RECTIFICATION_ENTRY":
        return "Apenas a execução corrente da ordem de produção pode ser retificada.";
      case "RECTIFICATION_INVALID_WEEKLOG_STATE":
        return "Retificação só pode ser solicitada em lotes com validação concluída.";
      case "WEEKLOG_CLOSED":
        return "Lotes com status fechado não permitem solicitação de retificação.";
      case "ENTRY_ALREADY_RECTIFICATION_REQUESTED":
        return "Esta entrada já possui uma solicitação de retificação pendente.";
      case "RECTIFICATION_INVALID_ENTRY_OUTCOME":
        return "Apenas itens inspecionados podem ser retificados.";
      case "RECTIFICATION_NOT_VALIDATED":
        return "Esta entrada não pertence a uma rodada de validação concluída.";
    }

    if (error.status === 403) {
      return "Acesso negado: você não possui as permissões necessárias para esta ação.";
    }
    if (error.status === 409) {
      return error.message || "Conflito no estado atual do lote semanal ou entrada.";
    }
    if (error.status === 422) {
      return error.message || "Dados incompletos ou inválidos para a operação.";
    }
    if (error.message) {
      return error.message;
    }
  }

  if (error instanceof Error) {
    return error.message;
  }
  return "Ocorreu um erro inesperado ao processar a solicitação.";
}
