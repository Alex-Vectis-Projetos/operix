import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "./useWorkspace";
import {
  listWeeklogs,
  getWeeklog,
  listWeeklogEntries,
  type Weeklog,
  type WeeklogEntry,
  type WeeklogFilters,
  type WeeklogStatus,
  type WeeklogValidationSummary,
} from "@/lib/apiWeeklogs";

export type {
  Weeklog,
  WeeklogEntry,
  WeeklogFilters,
  WeeklogStatus,
  WeeklogValidationSummary,
};

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
