import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiRequest } from "@/lib/api";
import { RealtimeHub } from "@/lib/realtime/RealtimeHub";
import { useAuth } from "./useAuth";
import { useRole } from "./useRole";
import { useImpersonation } from "./useImpersonation";
import { useWorkspaceOptional } from "./useWorkspace";


/**
 * Permission key format: "module.action"
 *
 * Resolution order — MUST mirror DB function public.has_permission():
 *  1. Admin → always allow, scope = 'all'
 *  2. user_permissions override (allow=true|false, scope) → use it
 *  3. role_permissions for user's role (allow, scope) → use it
 *  4. Default DENY (fail-safe), scope = null
 *
 * Scope values: 'own' | 'team' | 'all'.
 * Backward compatibility: missing scope is treated as 'all'.
 */

export type PermissionScope = "own" | "team" | "all";
export type PermissionResult = { allowed: boolean; scope: PermissionScope | null };

const DEBUG = Boolean(
  (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env?.DEV,
);
const PERMS_QUERY_KEY = ["my-permissions"] as const;

type Source = "admin" | "role" | "default-deny";
type Entry = { allowed: boolean; scope: PermissionScope | null; source: Source };

function useMyPermissionsMap() {
  const { user } = useAuth();
  const { dbRole, isAdmin, isLoading: roleLoading } = useRole();
  const { effectiveUserId, isImpersonating } = useImpersonation();
  const workspace = useWorkspaceOptional();
  const qc = useQueryClient();
  // When impersonating, evaluate permissions for the target user so the UI
  // matches what they would see. isAdmin already reflects the impersonated role.
  const permUserId = isImpersonating ? effectiveUserId : user?.id;
  const workspaceId = workspace?.workspaceId ?? null;

  useEffect(() => {
    if (!permUserId) {
      return;
    }

    const invalidate = () => qc.invalidateQueries({ queryKey: PERMS_QUERY_KEY });
    const off = RealtimeHub.subscribe({ table: "user_roles" }, invalidate);
    return () => {
      off();
    };
  }, [permUserId, qc]);


  return useQuery({
    queryKey: [...PERMS_QUERY_KEY, permUserId, dbRole, isImpersonating, workspaceId],
    enabled: !!permUserId && !roleLoading,
    staleTime: 30_000,
    retry: 0,
    placeholderData: (previousData) => previousData ?? { admin: false, map: {} },
    queryFn: async (): Promise<{ admin: boolean; map: Record<string, Entry> }> => {
      if (!permUserId) return { admin: false, map: {} };
      if (isAdmin) return { admin: true, map: {} };

      try {
        const params = new URLSearchParams();
        if (permUserId) params.set("userId", permUserId);
        if (workspaceId) params.set("workspaceId", workspaceId);
        const suffix = params.size > 0 ? `?${params.toString()}` : "";
        const data = await apiRequest<{
          admin: boolean;
          map: Record<string, Entry>;
        }>(`/account/permissions${suffix}`, { timeoutMs: 8000 });
        return {
          admin: data.admin,
          map: data.map ?? {},
        };
      } catch (error) {
        if (DEBUG) {
          void error;
        }
        return { admin: false, map: {} };
      }
    },
  });
}

/** Manually invalidate the permissions cache (call after toggling perms in UI). */
export function useInvalidatePermissions() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: PERMS_QUERY_KEY });
}

export function usePermission(key: string): { allowed: boolean; isLoading: boolean } {
  const { isAdmin, isLoading: roleLoading } = useRole();
  const { data, isLoading } = useMyPermissionsMap();

  if (roleLoading) return { allowed: false, isLoading: true };
  if (isAdmin) return { allowed: true, isLoading: false };
  if (isLoading || !data) return { allowed: false, isLoading: true };
  if (data.admin) return { allowed: true, isLoading: false };

  return { allowed: data.map[key]?.allowed === true, isLoading: false };
}

/** Bulk check: returns true only if ALL keys are allowed. */
export function usePermissions(keys: string[]): { allowed: boolean; isLoading: boolean; map: Record<string, boolean> } {
  const { isAdmin, isLoading: roleLoading } = useRole();
  const { data, isLoading } = useMyPermissionsMap();

  if (roleLoading) return { allowed: false, isLoading: true, map: {} };
  if (isAdmin) {
    const map = Object.fromEntries(keys.map((k) => [k, true]));
    return { allowed: true, isLoading: false, map };
  }
  if (isLoading || !data) return { allowed: false, isLoading: true, map: {} };
  if (data.admin) {
    const map = Object.fromEntries(keys.map((k) => [k, true]));
    return { allowed: true, isLoading: false, map };
  }
  const map = Object.fromEntries(keys.map((k) => [k, data.map[k]?.allowed === true]));
  return { allowed: keys.every((k) => map[k]), isLoading: false, map };
}

/**
 * SINGLE SOURCE OF TRUTH — `can(module, action)` resolver.
 *
 * Returns a `PermissionResult` object: `{ allowed, scope }`.
 *
 * BACKWARD COMPATIBILITY:
 * The returned object is also truthy when `allowed === true`, so any legacy
 * `if (can(m, a))` check still works because the object itself is truthy.
 * Prefer `can(m, a).allowed` going forward.
 */
export function useCan(): {
  can: (module: string, action: string) => PermissionResult;
  isLoading: boolean;
} {
  const { isAdmin, isLoading: roleLoading } = useRole();
  const { data, isLoading } = useMyPermissionsMap();

  const can = (module: string, action: string): PermissionResult => {
    if (isAdmin) return { allowed: true, scope: "all" };
    if (!data) return { allowed: false, scope: null };
    if (data.admin) return { allowed: true, scope: "all" };
    const entry = data.map?.[`${module}.${action}`];
    if (!entry || !entry.allowed) return { allowed: false, scope: null };
    return { allowed: true, scope: entry.scope ?? "all" };
  };

  // Loading while role is still resolving OR perms map is fetching (unless admin shortcut)
  const loading = roleLoading || (isLoading && !isAdmin);
  return { can, isLoading: loading };
}
