import { apiRequest } from "@/lib/api";

/**
 * ============================================================================
 * CANONICAL FINANCE V2 FRONTEND CLIENT & DTO TYPES (SPEC-005)
 * ============================================================================
 * Source of truth: backend/src/routes/financeV2.ts and canonical domain services.
 * All monetary fields are preserved as exact Decimal strings (e.g. "5000.30").
 * Currencies are separated by explicit ISO 4217 code (no EUR fallback, no FX).
 * Tenant authority is strictly server-side (RequestContext). No workspace ID is
 * transported as tenant authority in query parameters or request bodies.
 * ============================================================================
 */

/* ── Money & Helper Types ── */

export interface FinanceCurrencySummary {
  currencyCode: string;
  expected: string;
  received: string;
  expenses: string;
  settledObligationPayments: string;
  available: string;
}

export interface FinanceSummaryResponse {
  currencies: FinanceCurrencySummary[];
}

/* ── Expenses ── */

export type ExpenseStatus = "effective" | "reversed";

export type ExpenseContextKind =
  | "payment_list"
  | "production_order"
  | "technician_person"
  | "client"
  | "document";

export type ExpenseContext =
  | { kind: "payment_list"; id: string }
  | { kind: "production_order"; id: string }
  | { kind: "technician_person"; id: string }
  | { kind: "client"; id: string }
  | { kind: "document"; id: string };

export interface Expense {
  id: string;
  amount: string;
  currencyCode: string;
  category: string;
  occurredOn: string;
  description: string | null;
  status: ExpenseStatus;
  context: ExpenseContext | null;
  createdAt: string;
  createdByUserId: string;
  reversedAt: string | null;
  reversedByUserId: string | null;
  reversalReason: string | null;
}

export interface ExpenseListResponse {
  items: Expense[];
}

export interface CreateExpenseInput {
  amount: string;
  currencyCode: string;
  category: string;
  occurredOn: string;
  description?: string;
  context?: ExpenseContext;
}

export interface ReverseExpenseInput {
  reason: string;
}

export interface ExpenseMutationResponse extends Expense {
  idempotent: boolean;
}

/* ── Distributions ── */

export type DistributionStatus = "active" | "cancelled";

export type DistributionParticipantKind = "person" | "workspace" | "client";

export type DistributionParticipant =
  | { kind: "person"; personId: string }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "client"; clientId: string };

export type DistributionAllocationMode = "fixed" | "percentage";

export type DistributionAllocation =
  | { mode: "fixed"; amount: string }
  | { mode: "percentage"; percentage: string };

export interface Distribution {
  id: string;
  paymentListId: string;
  paymentListItemId: string | null;
  participant: DistributionParticipant;
  allocation: DistributionAllocation;
  resolvedAmount: string;
  currencyCode: string;
  status: DistributionStatus;
  createdAt: string;
  createdByUserId: string;
  cancelledAt: string | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
}

export interface DistributionListResponse {
  items: Distribution[];
}

export interface CreateDistributionInput {
  paymentListId: string;
  paymentListItemId?: string | null;
  participant: DistributionParticipant;
  allocation: DistributionAllocation;
}

export interface CancelDistributionInput {
  reason: string;
}

export interface DistributionMutationResponse extends Distribution {
  idempotent: boolean;
}

/* ── Financial Obligations & Settlements ── */

export type ObligationStatus = "pending" | "paid" | "cancelled" | "reversed";

export type ObligationPaymentStatus = "effective" | "reversed";

export interface ObligationPayment {
  id: string;
  obligationId: string;
  amount: string;
  currencyCode: string;
  status: ObligationPaymentStatus;
  paidAt: string;
  paidByUserId: string;
  reversedAt: string | null;
  reversedByUserId: string | null;
  reversalReason: string | null;
}

export interface FinancialObligation {
  id: string;
  distributionId: string;
  distribution: Distribution;
  amount: string;
  currencyCode: string;
  status: ObligationStatus;
  createdAt: string;
  createdByUserId: string;
  paidAt: string | null;
  paidByUserId: string | null;
  cancelledAt: string | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
  reversedAt: string | null;
  reversedByUserId: string | null;
  reversalReason: string | null;
  payment: ObligationPayment | null;
}

export interface ObligationListResponse {
  items: FinancialObligation[];
}

export interface CreateObligationInput {
  distributionId: string;
}

export interface CancelObligationInput {
  reason: string;
}

export interface ReverseObligationPaymentInput {
  reason: string;
}

export interface ObligationMutationResponse extends FinancialObligation {
  idempotent: boolean;
}

/* ── Idempotency Key & Command Envelope Helpers ── */

export function generateIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface CommandEnvelope<TInput> {
  input: TInput;
  idempotencyKey: string;
}

export function prepareCommand<TInput>(input: TInput, idempotencyKey?: string): CommandEnvelope<TInput> {
  return {
    input,
    idempotencyKey: idempotencyKey ?? generateIdempotencyKey(),
  };
}

/* ── Canonical API Client Functions ── */

/**
 * GET /api/finance/v2/summary
 * Retrieves currency-separated financial summary for the active workspace.
 */
export function getFinanceSummary(): Promise<FinanceSummaryResponse> {
  return apiRequest<FinanceSummaryResponse>("/finance/v2/summary");
}

/**
 * GET /api/finance/v2/expenses
 * Lists all expenses for the active workspace.
 */
export function listExpenses(): Promise<ExpenseListResponse> {
  return apiRequest<ExpenseListResponse>("/finance/v2/expenses");
}

/**
 * GET /api/finance/v2/expenses/:expenseId
 * Retrieves an individual expense by ID.
 */
export function getExpense(expenseId: string): Promise<Expense> {
  return apiRequest<Expense>(`/finance/v2/expenses/${encodeURIComponent(expenseId)}`);
}

/**
 * POST /api/finance/v2/expenses
 * Creates a new expense under server-side idempotency control.
 */
export function createExpense(
  input: CreateExpenseInput,
  idempotencyKey: string
): Promise<ExpenseMutationResponse> {
  return apiRequest<ExpenseMutationResponse>("/finance/v2/expenses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
}

/**
 * POST /api/finance/v2/expenses/:expenseId/reverse
 * Reverses an effective expense.
 */
export function reverseExpense(
  expenseId: string,
  input: ReverseExpenseInput,
  idempotencyKey: string
): Promise<ExpenseMutationResponse> {
  return apiRequest<ExpenseMutationResponse>(`/finance/v2/expenses/${encodeURIComponent(expenseId)}/reverse`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
}

/**
 * GET /api/finance/v2/distributions
 * Lists distributions visible to the caller (admin/owner or own technician scope).
 */
export function listDistributions(): Promise<DistributionListResponse> {
  return apiRequest<DistributionListResponse>("/finance/v2/distributions");
}

/**
 * GET /api/finance/v2/distributions/:distributionId
 * Retrieves a single distribution by ID.
 */
export function getDistribution(distributionId: string): Promise<Distribution> {
  return apiRequest<Distribution>(`/finance/v2/distributions/${encodeURIComponent(distributionId)}`);
}

/**
 * POST /api/finance/v2/distributions
 * Creates a manual distribution against a payment list or item.
 */
export function createDistribution(
  input: CreateDistributionInput,
  idempotencyKey: string
): Promise<DistributionMutationResponse> {
  return apiRequest<DistributionMutationResponse>("/finance/v2/distributions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
}

/**
 * POST /api/finance/v2/distributions/:distributionId/cancel
 * Cancels an active distribution with audit reason.
 */
export function cancelDistribution(
  distributionId: string,
  input: CancelDistributionInput,
  idempotencyKey: string
): Promise<DistributionMutationResponse> {
  return apiRequest<DistributionMutationResponse>(`/finance/v2/distributions/${encodeURIComponent(distributionId)}/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
}

/**
 * GET /api/finance/v2/obligations
 * Lists obligations visible to caller (all for owner/admin, own participant for technician).
 */
export function listObligations(): Promise<ObligationListResponse> {
  return apiRequest<ObligationListResponse>("/finance/v2/obligations");
}

/**
 * GET /api/finance/v2/obligations/:obligationId
 * Retrieves a single obligation with linked distribution and payment evidence.
 */
export function getObligation(obligationId: string): Promise<FinancialObligation> {
  return apiRequest<FinancialObligation>(`/finance/v2/obligations/${encodeURIComponent(obligationId)}`);
}

/**
 * POST /api/finance/v2/obligations
 * Creates a pending obligation from an active distribution.
 */
export function createObligation(
  input: CreateObligationInput,
  idempotencyKey: string
): Promise<ObligationMutationResponse> {
  return apiRequest<ObligationMutationResponse>("/finance/v2/obligations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
}

/**
 * POST /api/finance/v2/obligations/:obligationId/cancel
 * Cancels a pending obligation.
 */
export function cancelObligation(
  obligationId: string,
  input: CancelObligationInput,
  idempotencyKey: string
): Promise<ObligationMutationResponse> {
  return apiRequest<ObligationMutationResponse>(`/finance/v2/obligations/${encodeURIComponent(obligationId)}/cancel`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(input),
  });
}

/**
 * POST /api/finance/v2/obligations/:obligationId/settle
 * Settles a pending obligation in full (generates cash-out payment record).
 */
export function settleObligation(
  obligationId: string,
  idempotencyKey: string
): Promise<ObligationMutationResponse> {
  return apiRequest<ObligationMutationResponse>(`/finance/v2/obligations/${encodeURIComponent(obligationId)}/settle`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({}),
  });
}

/**
 * POST /api/finance/v2/obligations/:obligationId/settlements/:paymentId/reverse
 * Reverses a settled obligation payment.
 */
export function reverseObligationPayment(
  obligationId: string,
  paymentId: string,
  input: ReverseObligationPaymentInput,
  idempotencyKey: string
): Promise<ObligationMutationResponse> {
  return apiRequest<ObligationMutationResponse>(
    `/finance/v2/obligations/${encodeURIComponent(obligationId)}/settlements/${encodeURIComponent(paymentId)}/reverse`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(input),
    }
  );
}
