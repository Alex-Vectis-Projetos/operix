import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "./useWorkspace";
import {
  listWeeklogs,
  getWeeklog,
  listWeeklogEntries,
  getWeeklogEntry,
  submitWeeklogForValidation,
  reviewWeeklogEntry,
  uploadWeeklogSignature,
  validateWeeklog,
  rectifyWeeklogEntry,
  mapWeeklogError,
  type Weeklog,
  type WeeklogEntry,
  type WeeklogFilters,
  type WeeklogStatus,
  type WeeklogValidationSummary,
  type ReviewWeeklogEntryPayload,
  type ValidateWeeklogPayload,
  type RectifyWeeklogEntryPayload,
  type SubmitWeeklogResult,
  type UploadSignatureResult,
  type ValidateWeeklogResult,
  type RectifyWeeklogEntryResult,
} from "@/lib/apiWeeklogs";

export type {
  Weeklog,
  WeeklogEntry,
  WeeklogFilters,
  WeeklogStatus,
  WeeklogValidationSummary,
  ReviewWeeklogEntryPayload,
  ValidateWeeklogPayload,
  RectifyWeeklogEntryPayload,
  SubmitWeeklogResult,
  UploadSignatureResult,
  ValidateWeeklogResult,
  RectifyWeeklogEntryResult,
};
export { mapWeeklogError };

export const weeklogQueryKeys = {
  all: (workspaceId?: string | null) => ["weeklogs", workspaceId ?? "none"] as const,
  lists: (workspaceId?: string | null) => [...weeklogQueryKeys.all(workspaceId), "list"] as const,
  list: (workspaceId?: string | null, filters?: WeeklogFilters) =>
    [...weeklogQueryKeys.lists(workspaceId), filters ?? {}] as const,
  details: (workspaceId?: string | null) => [...weeklogQueryKeys.all(workspaceId), "detail"] as const,
  detail: (workspaceId?: string | null, id?: string | null) =>
    [...weeklogQueryKeys.details(workspaceId), id ?? "none"] as const,
  entries: (workspaceId?: string | null, id?: string | null) =>
    [...weeklogQueryKeys.detail(workspaceId, id), "entries"] as const,
};

export function useWeeklogs(filters?: WeeklogFilters) {
  const { workspaceId } = useWorkspace();

  return useQuery({
    queryKey: weeklogQueryKeys.list(workspaceId, filters),
    enabled: !!workspaceId,
    queryFn: () => listWeeklogs(filters),
  });
}

export function useWeeklog(id?: string | null) {
  const { workspaceId } = useWorkspace();

  return useQuery({
    queryKey: weeklogQueryKeys.detail(workspaceId, id),
    enabled: !!workspaceId && !!id,
    queryFn: () => getWeeklog(id!),
  });
}

export function useWeeklogEntries(weeklogId?: string | null) {
  const { workspaceId } = useWorkspace();

  return useQuery({
    queryKey: weeklogQueryKeys.entries(workspaceId, weeklogId),
    enabled: !!workspaceId && !!weeklogId,
    queryFn: () => listWeeklogEntries(weeklogId!),
  });
}

export function useSubmitWeeklog() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();

  return useMutation({
    mutationFn: (weeklogId: string) => submitWeeklogForValidation(weeklogId),
    onSuccess: (_, weeklogId) => {
      queryClient.invalidateQueries({ queryKey: weeklogQueryKeys.detail(workspaceId, weeklogId) });
      queryClient.invalidateQueries({ queryKey: weeklogQueryKeys.entries(workspaceId, weeklogId) });
      queryClient.invalidateQueries({ queryKey: weeklogQueryKeys.lists(workspaceId) });
    },
  });
}

export function useReviewWeeklogEntry() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();

  return useMutation({
    mutationFn: ({
      weeklogId,
      entryId,
      payload,
    }: {
      weeklogId: string;
      entryId: string;
      payload: ReviewWeeklogEntryPayload;
    }) => reviewWeeklogEntry(weeklogId, entryId, payload),
    onSuccess: (_, { weeklogId }) => {
      queryClient.invalidateQueries({ queryKey: weeklogQueryKeys.detail(workspaceId, weeklogId) });
      queryClient.invalidateQueries({ queryKey: weeklogQueryKeys.entries(workspaceId, weeklogId) });
    },
  });
}

export function useUploadWeeklogSignature() {
  return useMutation({
    mutationFn: ({
      weeklogId,
      pngBlob,
    }: {
      weeklogId: string;
      pngBlob: Blob;
    }) => uploadWeeklogSignature(weeklogId, pngBlob),
  });
}

export function useValidateWeeklog() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();

  return useMutation({
    mutationFn: ({
      weeklogId,
      payload,
    }: {
      weeklogId: string;
      payload: ValidateWeeklogPayload;
    }) => validateWeeklog(weeklogId, payload),
    onSuccess: (_, { weeklogId }) => {
      queryClient.invalidateQueries({ queryKey: weeklogQueryKeys.detail(workspaceId, weeklogId) });
      queryClient.invalidateQueries({ queryKey: weeklogQueryKeys.entries(workspaceId, weeklogId) });
      queryClient.invalidateQueries({ queryKey: weeklogQueryKeys.lists(workspaceId) });
      queryClient.invalidateQueries({ queryKey: ["production_orders"] });
    },
  });
}

export function useRectifyWeeklogEntry() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();

  return useMutation({
    mutationFn: ({
      weeklogId,
      entryId,
      payload,
    }: {
      weeklogId: string;
      entryId: string;
      payload: RectifyWeeklogEntryPayload;
    }) => rectifyWeeklogEntry(weeklogId, entryId, payload),
    onSuccess: (_, { weeklogId }) => {
      queryClient.invalidateQueries({ queryKey: weeklogQueryKeys.detail(workspaceId, weeklogId) });
      queryClient.invalidateQueries({ queryKey: weeklogQueryKeys.entries(workspaceId, weeklogId) });
      queryClient.invalidateQueries({ queryKey: weeklogQueryKeys.lists(workspaceId) });
      queryClient.invalidateQueries({ queryKey: ["production_orders"] });
      queryClient.invalidateQueries({ queryKey: ["production_kpis"] });
    },
  });
}
