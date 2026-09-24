import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  cancelDistribution,
  cancelObligation,
  createDistribution,
  createExpense,
  createObligation,
  generateIdempotencyKey,
  getDistribution,
  getExpense,
  getFinanceSummary,
  getObligation,
  listDistributions,
  listExpenses,
  listObligations,
  prepareCommand,
  reverseExpense,
  reverseObligationPayment,
  settleObligation,
  type CancelDistributionInput,
  type CancelObligationInput,
  type CommandEnvelope,
  type CreateDistributionInput,
  type CreateExpenseInput,
  type CreateObligationInput,
  type ReverseExpenseInput,
  type ReverseObligationPaymentInput,
} from "@/lib/apiFinanceV2";

export * from "@/lib/apiFinanceV2";

/**
 * ============================================================================
 * CANONICAL FINANCE QUERY KEYS
 * ============================================================================
 * Active workspace ID strictly partitions the frontend cache.
 * Switching workspaces instantly points queries to the new partition key,
 * preventing cross-workspace cache pollution.
 * ============================================================================
 */
export const financeQueryKeys = {
  all: (workspaceId?: string | null) => ["finance", workspaceId ?? "none"] as const,
  summary: (workspaceId?: string | null) => [...financeQueryKeys.all(workspaceId), "summary"] as const,
  expenses: (workspaceId?: string | null) => [...financeQueryKeys.all(workspaceId), "expenses"] as const,
  expenseList: (workspaceId?: string | null) => [...financeQueryKeys.expenses(workspaceId), "list"] as const,
  expenseDetail: (workspaceId?: string | null, expenseId?: string | null) =>
    [...financeQueryKeys.expenses(workspaceId), "detail", expenseId ?? "none"] as const,
  distributions: (workspaceId?: string | null) => [...financeQueryKeys.all(workspaceId), "distributions"] as const,
  distributionList: (workspaceId?: string | null) => [...financeQueryKeys.distributions(workspaceId), "list"] as const,
  distributionDetail: (workspaceId?: string | null, distributionId?: string | null) =>
    [...financeQueryKeys.distributions(workspaceId), "detail", distributionId ?? "none"] as const,
  obligations: (workspaceId?: string | null) => [...financeQueryKeys.all(workspaceId), "obligations"] as const,
  obligationList: (workspaceId?: string | null) => [...financeQueryKeys.obligations(workspaceId), "list"] as const,
  obligationDetail: (workspaceId?: string | null, obligationId?: string | null) =>
    [...financeQueryKeys.obligations(workspaceId), "detail", obligationId ?? "none"] as const,
};

type FinanceQueryClient = Pick<QueryClient, "invalidateQueries">;

/* ── Cache Invalidation Helpers ── */

export async function invalidateFinanceSummary(queryClient: FinanceQueryClient, workspaceId?: string | null) {
  await queryClient.invalidateQueries({ queryKey: financeQueryKeys.summary(workspaceId) });
}

export async function invalidateExpenseList(queryClient: FinanceQueryClient, workspaceId?: string | null) {
  await queryClient.invalidateQueries({ queryKey: financeQueryKeys.expenseList(workspaceId) });
}

export async function invalidateExpenseDetail(
  queryClient: FinanceQueryClient,
  workspaceId: string | null | undefined,
  expenseId: string
) {
  await queryClient.invalidateQueries({ queryKey: financeQueryKeys.expenseDetail(workspaceId, expenseId) });
}

export async function invalidateDistributionList(queryClient: FinanceQueryClient, workspaceId?: string | null) {
  await queryClient.invalidateQueries({ queryKey: financeQueryKeys.distributionList(workspaceId) });
}

export async function invalidateDistributionDetail(
  queryClient: FinanceQueryClient,
  workspaceId: string | null | undefined,
  distributionId: string
) {
  await queryClient.invalidateQueries({ queryKey: financeQueryKeys.distributionDetail(workspaceId, distributionId) });
}

export async function invalidateObligationList(queryClient: FinanceQueryClient, workspaceId?: string | null) {
  await queryClient.invalidateQueries({ queryKey: financeQueryKeys.obligationList(workspaceId) });
}

export async function invalidateObligationDetail(
  queryClient: FinanceQueryClient,
  workspaceId: string | null | undefined,
  obligationId: string
) {
  await queryClient.invalidateQueries({ queryKey: financeQueryKeys.obligationDetail(workspaceId, obligationId) });
}

/* ── Summary Hook ── */

export function useFinanceSummary() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: financeQueryKeys.summary(workspaceId),
    enabled: Boolean(workspaceId),
    queryFn: getFinanceSummary,
  });
}

/* ── Expense Hooks ── */

export function useExpenses() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: financeQueryKeys.expenseList(workspaceId),
    enabled: Boolean(workspaceId),
    queryFn: listExpenses,
  });
}

export function useExpense(expenseId?: string | null) {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: financeQueryKeys.expenseDetail(workspaceId, expenseId),
    enabled: Boolean(workspaceId && expenseId),
    queryFn: () => getExpense(expenseId!),
  });
}

export interface CreateExpenseMutationVariables {
  input: CreateExpenseInput;
  idempotencyKey?: string;
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  return useMutation({
    mutationFn: (variables: CreateExpenseMutationVariables | CommandEnvelope<CreateExpenseInput>) => {
      const key = variables.idempotencyKey || generateIdempotencyKey();
      return createExpense(variables.input, key);
    },
    onSuccess: async () => {
      await Promise.all([
        invalidateExpenseList(queryClient, workspaceId),
        invalidateFinanceSummary(queryClient, workspaceId),
      ]);
    },
  });
}

export interface ReverseExpenseMutationVariables {
  expenseId: string;
  input: ReverseExpenseInput;
  idempotencyKey?: string;
}

export function useReverseExpense() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  return useMutation({
    mutationFn: (variables: ReverseExpenseMutationVariables) => {
      const key = variables.idempotencyKey || generateIdempotencyKey();
      return reverseExpense(variables.expenseId, variables.input, key);
    },
    onSuccess: async (_, variables) => {
      await Promise.all([
        invalidateExpenseDetail(queryClient, workspaceId, variables.expenseId),
        invalidateExpenseList(queryClient, workspaceId),
        invalidateFinanceSummary(queryClient, workspaceId),
      ]);
    },
  });
}

/* ── Distribution Hooks ── */

export function useDistributions() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: financeQueryKeys.distributionList(workspaceId),
    enabled: Boolean(workspaceId),
    queryFn: listDistributions,
  });
}

export function useDistribution(distributionId?: string | null) {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: financeQueryKeys.distributionDetail(workspaceId, distributionId),
    enabled: Boolean(workspaceId && distributionId),
    queryFn: () => getDistribution(distributionId!),
  });
}

export interface CreateDistributionMutationVariables {
  input: CreateDistributionInput;
  idempotencyKey?: string;
}

export function useCreateDistribution() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  return useMutation({
    mutationFn: (variables: CreateDistributionMutationVariables | CommandEnvelope<CreateDistributionInput>) => {
      const key = variables.idempotencyKey || generateIdempotencyKey();
      return createDistribution(variables.input, key);
    },
    onSuccess: async () => {
      // Distributions have zero cash effect: only invalidate distributions
      await invalidateDistributionList(queryClient, workspaceId);
    },
  });
}

export interface CancelDistributionMutationVariables {
  distributionId: string;
  input: CancelDistributionInput;
  idempotencyKey?: string;
}

export function useCancelDistribution() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  return useMutation({
    mutationFn: (variables: CancelDistributionMutationVariables) => {
      const key = variables.idempotencyKey || generateIdempotencyKey();
      return cancelDistribution(variables.distributionId, variables.input, key);
    },
    onSuccess: async (_, variables) => {
      await Promise.all([
        invalidateDistributionDetail(queryClient, workspaceId, variables.distributionId),
        invalidateDistributionList(queryClient, workspaceId),
      ]);
    },
  });
}

/* ── Financial Obligation & Settlement Hooks ── */

export function useObligations() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: financeQueryKeys.obligationList(workspaceId),
    enabled: Boolean(workspaceId),
    queryFn: listObligations,
  });
}

export function useObligation(obligationId?: string | null) {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: financeQueryKeys.obligationDetail(workspaceId, obligationId),
    enabled: Boolean(workspaceId && obligationId),
    queryFn: () => getObligation(obligationId!),
  });
}

export interface CreateObligationMutationVariables {
  input: CreateObligationInput;
  idempotencyKey?: string;
}

export function useCreateObligation() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  return useMutation({
    mutationFn: (variables: CreateObligationMutationVariables | CommandEnvelope<CreateObligationInput>) => {
      const key = variables.idempotencyKey || generateIdempotencyKey();
      return createObligation(variables.input, key);
    },
    onSuccess: async () => {
      // Pending obligation creation has no cash effect. Invalidate obligations and distribution queries.
      await Promise.all([
        invalidateObligationList(queryClient, workspaceId),
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.distributions(workspaceId) }),
      ]);
    },
  });
}

export interface CancelObligationMutationVariables {
  obligationId: string;
  input: CancelObligationInput;
  idempotencyKey?: string;
}

export function useCancelObligation() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  return useMutation({
    mutationFn: (variables: CancelObligationMutationVariables) => {
      const key = variables.idempotencyKey || generateIdempotencyKey();
      return cancelObligation(variables.obligationId, variables.input, key);
    },
    onSuccess: async (_, variables) => {
      await Promise.all([
        invalidateObligationDetail(queryClient, workspaceId, variables.obligationId),
        invalidateObligationList(queryClient, workspaceId),
        queryClient.invalidateQueries({ queryKey: financeQueryKeys.distributions(workspaceId) }),
      ]);
    },
  });
}

export interface SettleObligationMutationVariables {
  obligationId: string;
  idempotencyKey?: string;
}

export function useSettleObligation() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  return useMutation({
    mutationFn: (variables: SettleObligationMutationVariables) => {
      const key = variables.idempotencyKey || generateIdempotencyKey();
      return settleObligation(variables.obligationId, key);
    },
    onSuccess: async (_, variables) => {
      // Settlement produces real cash out -> invalidate obligation and summary
      await Promise.all([
        invalidateObligationDetail(queryClient, workspaceId, variables.obligationId),
        invalidateObligationList(queryClient, workspaceId),
        invalidateFinanceSummary(queryClient, workspaceId),
      ]);
    },
  });
}

export interface ReverseObligationPaymentMutationVariables {
  obligationId: string;
  paymentId: string;
  input: ReverseObligationPaymentInput;
  idempotencyKey?: string;
}

export function useReverseObligationPayment() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  return useMutation({
    mutationFn: (variables: ReverseObligationPaymentMutationVariables) => {
      const key = variables.idempotencyKey || generateIdempotencyKey();
      return reverseObligationPayment(variables.obligationId, variables.paymentId, variables.input, key);
    },
    onSuccess: async (_, variables) => {
      // Payment reversal restores available cash -> invalidate obligation and summary
      await Promise.all([
        invalidateObligationDetail(queryClient, workspaceId, variables.obligationId),
        invalidateObligationList(queryClient, workspaceId),
        invalidateFinanceSummary(queryClient, workspaceId),
      ]);
    },
  });
}
