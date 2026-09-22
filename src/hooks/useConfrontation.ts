import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  confrontPaymentList,
  decideConfrontationResult,
  getPaymentListConfrontation,
  type ConfrontationDecisionPayload,
  type ConfrontationMode,
} from "@/lib/apiPaymentLists";
import { invalidatePaymentListDetail, paymentListQueryKeys } from "@/hooks/usePaymentLists";

async function invalidateConfrontation(queryClient: ReturnType<typeof useQueryClient>, workspaceId: string | null | undefined, paymentListId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: paymentListQueryKeys.confrontation(workspaceId, paymentListId) }),
    invalidatePaymentListDetail(queryClient, workspaceId, paymentListId),
  ]);
}

export function usePaymentListConfrontation(paymentListId?: string | null) {
  const { workspaceId } = useWorkspace();
  return useQuery({
    queryKey: paymentListQueryKeys.confrontation(workspaceId, paymentListId),
    enabled: Boolean(workspaceId && paymentListId),
    queryFn: () => getPaymentListConfrontation(paymentListId!),
  });
}

export function useConfrontPaymentList() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  return useMutation({
    mutationFn: ({ paymentListId, mode }: { paymentListId: string; mode?: ConfrontationMode }) =>
      confrontPaymentList(paymentListId, { mode }),
    onSuccess: (_, { paymentListId }) => invalidateConfrontation(queryClient, workspaceId, paymentListId),
  });
}

export function useConfrontationDecision() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  return useMutation({
    mutationFn: ({ paymentListId, resultId, payload }: { paymentListId: string; resultId: string; payload: ConfrontationDecisionPayload }) =>
      decideConfrontationResult(paymentListId, resultId, payload),
    onSuccess: (_, { paymentListId }) => invalidateConfrontation(queryClient, workspaceId, paymentListId),
  });
}
