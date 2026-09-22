import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  commitPaymentListImport,
  createPaymentList,
  createPaymentListImport,
  discardPaymentListImport,
  getPaymentList,
  getPaymentListImport,
  listPaymentLists,
  retryPaymentListImportExtraction,
  transitionPaymentListStatus,
  updatePaymentListImportRows,
  type ExternalListImportRowsReviewInput,
  type PaymentListCreateInput,
  type PaymentListStatusTransitionInput,
} from "@/lib/apiPaymentLists";

export * from "@/lib/apiPaymentLists";

export const paymentListQueryKeys = {
  all: (workspaceId?: string | null) => ["payment-lists", workspaceId ?? "none"] as const,
  list: (workspaceId?: string | null) => [...paymentListQueryKeys.all(workspaceId), "list"] as const,
  details: (workspaceId?: string | null) => [...paymentListQueryKeys.all(workspaceId), "detail"] as const,
  detail: (workspaceId?: string | null, paymentListId?: string | null) =>
    [...paymentListQueryKeys.details(workspaceId), paymentListId ?? "none"] as const,
  imports: (workspaceId?: string | null) => [...paymentListQueryKeys.all(workspaceId), "import"] as const,
  import: (workspaceId?: string | null, importId?: string | null) =>
    [...paymentListQueryKeys.imports(workspaceId), importId ?? "none"] as const,
  confrontation: (workspaceId?: string | null, paymentListId?: string | null) =>
    [...paymentListQueryKeys.detail(workspaceId, paymentListId), "confrontation"] as const,
};

type PaymentListQueryClient = Pick<QueryClient, "invalidateQueries">;

export async function invalidatePaymentListCollection(queryClient: PaymentListQueryClient, workspaceId?: string | null) {
  await queryClient.invalidateQueries({ queryKey: paymentListQueryKeys.list(workspaceId) });
}

export async function invalidatePaymentListDetail(queryClient: PaymentListQueryClient, workspaceId: string | null | undefined, paymentListId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: paymentListQueryKeys.detail(workspaceId, paymentListId) }),
    invalidatePaymentListCollection(queryClient, workspaceId),
  ]);
}

export async function invalidatePaymentListImport(queryClient: PaymentListQueryClient, workspaceId: string | null | undefined, importId: string) {
  await queryClient.invalidateQueries({ queryKey: paymentListQueryKeys.import(workspaceId, importId) });
}

export async function invalidatePaymentListImportCommit(queryClient: PaymentListQueryClient, workspaceId: string | null | undefined, importId: string, paymentListId: string) {
  await Promise.all([
    invalidatePaymentListImport(queryClient, workspaceId, importId),
    invalidatePaymentListDetail(queryClient, workspaceId, paymentListId),
  ]);
}

export function usePaymentLists() {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: paymentListQueryKeys.list(workspaceId),
    enabled: Boolean(workspaceId),
    queryFn: listPaymentLists,
  });
}

export function usePaymentList(paymentListId?: string | null) {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: paymentListQueryKeys.detail(workspaceId, paymentListId),
    enabled: Boolean(workspaceId && paymentListId),
    queryFn: () => getPaymentList(paymentListId!),
  });
}

export function useCreatePaymentList() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  return useMutation({
    mutationFn: (payload: PaymentListCreateInput) => createPaymentList(payload),
    onSuccess: () => invalidatePaymentListCollection(queryClient, workspaceId),
  });
}

export function useTransitionPaymentListStatus() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  return useMutation({
    mutationFn: ({ paymentListId, payload }: { paymentListId: string; payload: PaymentListStatusTransitionInput }) =>
      transitionPaymentListStatus(paymentListId, payload),
    onSuccess: (_, { paymentListId }) => invalidatePaymentListDetail(queryClient, workspaceId, paymentListId),
  });
}

export function usePaymentListImport(importId?: string | null) {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: paymentListQueryKeys.import(workspaceId, importId),
    enabled: Boolean(workspaceId && importId),
    queryFn: () => getPaymentListImport(importId!),
  });
}

export function useCreatePaymentListImport() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  return useMutation({
    mutationFn: (file: File) => createPaymentListImport(file),
    onSuccess: (result) => invalidatePaymentListImport(queryClient, workspaceId, result.importId),
  });
}

export function useRetryPaymentListImportExtraction() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  return useMutation({
    mutationFn: (importId: string) => retryPaymentListImportExtraction(importId),
    onSuccess: (result) => invalidatePaymentListImport(queryClient, workspaceId, result.importId),
  });
}

export function useUpdatePaymentListImportRows() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  return useMutation({
    mutationFn: ({ importId, payload }: { importId: string; payload: ExternalListImportRowsReviewInput }) =>
      updatePaymentListImportRows(importId, payload),
    onSuccess: (result) => invalidatePaymentListImport(queryClient, workspaceId, result.importId),
  });
}

export function useCommitPaymentListImport() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  return useMutation({
    mutationFn: ({ importId }: { importId: string }) => commitPaymentListImport(importId),
    onSuccess: (paymentList, { importId }) => invalidatePaymentListImportCommit(queryClient, workspaceId, importId, paymentList.id),
  });
}

export function useDiscardPaymentListImport() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  return useMutation({
    mutationFn: (importId: string) => discardPaymentListImport(importId),
    onSuccess: (_, importId) => invalidatePaymentListImport(queryClient, workspaceId, importId),
  });
}
