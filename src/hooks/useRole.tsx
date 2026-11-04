import { createContext, useContext, ReactNode } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { useAuth } from "./useAuth";
import { useImpersonation } from "./useImpersonation";
import { useWorkspaceOptional } from "./useWorkspace";

export type AppRole = "owner" | "admin" | "partner" | "technician" | "client";

// Map from DB enum to sidebar/RoleGuard keys used in codebase
const ROLE_MAP: Record<AppRole, string> = {
  owner: "admin",
  admin: "admin",
  partner: "socio",
  technician: "tecnico",
  client: "cliente",
};

// Reverse map for DB operations
export const DISPLAY_TO_DB: Record<string, AppRole> = {
  admin: "admin",
  socio: "partner",
  tecnico: "technician",
  cliente: "client",
};

export type DisplayRole = "admin" | "tecnico" | "cliente" | "socio";

interface RoleContext {
  dbRole: AppRole | null;
  role: DisplayRole | null;
  isAdmin: boolean;
  isOwner: boolean;
  isLoading: boolean;
}

const RoleCtx = createContext<RoleContext | undefined>(undefined);

export function RoleProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const { effectiveUserId, isImpersonating } = useImpersonation();
  const workspace = useWorkspaceOptional();
  // When impersonating, resolve the role of the target user so the whole UI
  // (sidebar, guards, dashboards) reflects what they see.
  const lookupId = isImpersonating ? effectiveUserId : user?.id;
  const workspaceId = workspace?.workspaceId ?? null;
  const isWorkspaceLoading = workspace?.isLoading ?? false;

  const { data, isLoading, isPending } = useQuery({
    queryKey: ["my-role", lookupId, isImpersonating, workspaceId],
    enabled: !!lookupId,
    retry: 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (lookupId) params.set("userId", lookupId);
      if (workspaceId) params.set("workspaceId", workspaceId);
      const suffix = params.size > 0 ? `?${params.toString()}` : "";
      return apiRequest<{
        role: AppRole | null;
        is_workspace_owner?: boolean;
      }>(`/account/role${suffix}`, { timeoutMs: 8000 });
    },
    placeholderData: keepPreviousData,
  });

  // Platform owner safety net — the master account ALWAYS resolves as admin,
  // even if the user_roles row is missing, the query is slow, or the timeout
  // fired. This prevents the owner from ever losing dashboard/admin access.
  const OWNER_EMAILS = ["qwork@qworkgroup.com"];
  const isOwnerEmail =
    !!user?.email && OWNER_EMAILS.includes(user.email.toLowerCase());

  const effectiveDbRole: AppRole | null = isOwnerEmail ? "owner" : data?.role ?? null;
  const isOwner = effectiveDbRole === "owner" || data?.is_workspace_owner === true || isOwnerEmail;
  const role = effectiveDbRole ? (ROLE_MAP[effectiveDbRole] as DisplayRole) : null;
  const isAdmin = effectiveDbRole === "owner" || effectiveDbRole === "admin";

  const isResolving = isOwnerEmail
    ? false
    : (authLoading || !user || isWorkspaceLoading || (!!lookupId && (isPending || (isLoading && !data))));

  return (
    <RoleCtx.Provider
      value={{ dbRole: effectiveDbRole, role, isAdmin, isOwner, isLoading: isResolving }}
    >
      {children}
    </RoleCtx.Provider>
  );
}

export function useRole() {
  const ctx = useContext(RoleCtx);
  if (!ctx) throw new Error("useRole must be used within RoleProvider");
  return ctx;
}
