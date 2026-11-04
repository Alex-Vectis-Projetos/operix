/**
 * useWorkspace — OPERATIONAL CONTEXT layer ONLY.
 *
 * Architectural rule (do not break):
 *  • This hook describes the active OPERATIONAL workspace (tenant scope:
 *    OS, OP, billing, teams, dashboards).
 *  • It is NOT the global identity. Owner identity lives in
 *    `useIsPlatformOwner` and is always present for the platform owner —
 *    independent of which workspace is active.
 *  • Owner ≠ Workspace. Both coexist; one never nullifies the other.
 *
 * Switching workspace MUST NOT reload the page, recreate providers,
 * reset auth, or unmount the React tree. It only updates the operational
 * scope by changing `selectedId` and re-running workspace-keyed queries.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { useAuth } from "./useAuth";
import type { BrandConfig } from "@/components/layout/BrandNameEditor";

export interface WorkspaceMember {
  auth_user_id: string;
  app_user_id: string;
  name: string | null;
  email: string;
  phone: string | null;
  role: string;
  role_label?: string;
  status: string;
  membership_id: string;
  permissions_overrides?: Record<string, boolean> | null;
}

export type MembershipRole = "admin" | "tecnico" | "cliente" | "socio";

export interface AvailableWorkspace {
  id: string;
  name: string;
  ownerAppUserId: string | null;
  membershipRole: MembershipRole | null;
  membershipStatus: string;
  brandConfig: BrandConfig | null;
  logoUrl: string | null;
}

export interface WorkspaceContext {
  workspaceId: string | null;
  workspaceName: string | null;
  ownerAppUserId: string | null;
  brandConfig: BrandConfig | null;
  logoUrl: string | null;
  availableWorkspaces: AvailableWorkspace[];
  members: WorkspaceMember[];
  memberAuthIds: string[];
  myRole: MembershipRole | null;
  isAdmin: boolean;
  isWorkspaceOwner: boolean;
  canManageBranding: boolean;
  isLoading: boolean;
  /** Switch the active operational workspace WITHOUT reloading the page. */
  switchWorkspace: (workspaceId: string) => void;
  updateBranding: (branding: { name?: string; brand_config?: BrandConfig | null; logo_url?: string | null }) => Promise<void>;
}

const WorkspaceCtx = createContext<WorkspaceContext | undefined>(undefined);

const SELECTED_KEY = "selected_workspace_id";

function readSelected(): string | null {
  try { return localStorage.getItem(SELECTED_KEY); } catch { return null; }
}

export interface SessionBootstrapData {
  appUserId: string | null;
  authUserId: string;
  email: string;
  role: string;
  membershipRole: string | null;
  isWorkspaceOwner: boolean;
  activeWorkspaceId: string | null;
  activeWorkspace: {
    workspaceId: string;
    workspaceName: string;
    ownerAppUserId: string | null;
    membershipRole: string | null;
    membershipStatus: string;
    brandConfig?: BrandConfig | null;
    logoUrl?: string | null;
  } | null;
  workspaces: Array<{
    workspaceId: string;
    workspaceName: string;
    ownerAppUserId: string | null;
    membershipRole: string | null;
    membershipStatus: string;
    brandConfig?: BrandConfig | null;
    logoUrl?: string | null;
  }>;
  permissions: {
    admin: boolean;
    role: string;
    membership_role: string | null;
    is_workspace_owner: boolean;
    workspace_id: string | null;
    permissions_overrides: Record<string, boolean> | null;
    map: Record<string, { allowed: boolean; scope?: string }>;
  };
  computedAt: string;
}

export const BOOTSTRAP_QUERY_KEY = ["session-bootstrap"] as const;

export function useSessionBootstrap() {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const selectedWs = readSelected();

  return useQuery({
    queryKey: [...BOOTSTRAP_QUERY_KEY, userId, selectedWs],
    enabled: !!userId && !authLoading,
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<SessionBootstrapData> => {
      const data = await apiRequest<SessionBootstrapData>("/account/bootstrap", { timeoutMs: 8000 });
      if (data.activeWorkspaceId) {
        try {
          if (localStorage.getItem(SELECTED_KEY) !== data.activeWorkspaceId) {
            localStorage.setItem(SELECTED_KEY, data.activeWorkspaceId);
          }
        } catch { /* best effort */ }
      }
      return data;
    },
  });
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(() => readSelected());
  const { data: bootstrap, isLoading: bootstrapLoading } = useSessionBootstrap();

  const wsData = useMemo(() => {
    if (!bootstrap) return null;
    const active = bootstrap.activeWorkspace;
    const memberships = bootstrap.workspaces || [];
    return {
      workspaceId: bootstrap.activeWorkspaceId,
      workspaceName: active?.workspaceName ?? null,
      appUserId: bootstrap.appUserId,
      ownerAppUserId: active?.ownerAppUserId ?? null,
      brandConfig: (active?.brandConfig as BrandConfig | null) || null,
      logoUrl: active?.logoUrl ?? null,
      myRole: (bootstrap.membershipRole as MembershipRole | null) ?? null,
      isWorkspaceOwner: bootstrap.isWorkspaceOwner,
      availableWorkspaces: memberships.map((item) => ({
        id: item.workspaceId,
        name: item.workspaceName,
        ownerAppUserId: item.ownerAppUserId,
        membershipRole: item.membershipRole as MembershipRole | null,
        membershipStatus: item.membershipStatus,
        brandConfig: (item.brandConfig as BrandConfig | null) || null,
        logoUrl: item.logoUrl ?? null,
      })),
    };
  }, [bootstrap]);

  const wsLoading = authLoading || (!bootstrap && bootstrapLoading);

  // Members of the active operational workspace.
  const { data: members = [] } = useQuery({
    queryKey: ["workspace-members", wsData?.workspaceId],
    enabled: !!wsData?.workspaceId,
    retry: 0,
    staleTime: 60_000,
    queryFn: async () => {
      const data = await apiRequest<{ members: WorkspaceMember[] }>(`/workspaces/${wsData!.workspaceId}/members`, { timeoutMs: 8000 });
      return data.members;
    },
    placeholderData: (previousData) => previousData ?? [],
  });

  const memberAuthIds = useMemo(
    () => members.filter((m: WorkspaceMember) => m.auth_user_id).map((m: WorkspaceMember) => m.auth_user_id),
    [members],
  );
  const myRole =
    wsData?.myRole ?? ((members.find((m: WorkspaceMember) => m.auth_user_id === user?.id)?.role as MembershipRole) ?? null);
  const isAdmin = myRole === "admin";
  const isWorkspaceOwner =
    !!wsData?.appUserId && !!wsData?.ownerAppUserId && wsData.appUserId === wsData.ownerAppUserId;
  const canManageBranding = isWorkspaceOwner || isAdmin;

  // Switch operational scope WITHOUT reload. Just update state + storage
  // and invalidate workspace-keyed queries so derived data refetches.
  const switchWorkspace = useCallback((id: string) => {
    if (!id || id === selectedId) return;
    try { localStorage.setItem(SELECTED_KEY, id); } catch { /* best effort */ }
    try {
      Object.keys(sessionStorage)
        .filter((k) => k.startsWith("ctx_ws::"))
        .forEach((k) => sessionStorage.removeItem(k));
    } catch { /* best effort */ }
    setSelectedId(id);
    queryClient.invalidateQueries({ queryKey: BOOTSTRAP_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: ["my-workspace"] });
    queryClient.invalidateQueries({ queryKey: ["workspace-members"] });
  }, [selectedId, queryClient]);

  const updateBranding = useCallback(
    async (branding: { name?: string; brand_config?: BrandConfig | null; logo_url?: string | null }) => {
      if (!wsData?.workspaceId) throw new Error("Nenhum workspace ativo.");
      await apiRequest(`/workspaces/${wsData.workspaceId}/branding`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(branding),
      });
      queryClient.invalidateQueries({ queryKey: BOOTSTRAP_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["my-workspace"] });
      queryClient.invalidateQueries({ queryKey: ["company-brand"] });
    },
    [wsData?.workspaceId, queryClient],
  );

  const value = useMemo<WorkspaceContext>(() => ({
    workspaceId: wsData?.workspaceId ?? null,
    workspaceName: wsData?.workspaceName ?? null,
    ownerAppUserId: wsData?.ownerAppUserId ?? null,
    brandConfig: wsData?.brandConfig ?? null,
    logoUrl: wsData?.logoUrl ?? null,
    availableWorkspaces: wsData?.availableWorkspaces ?? [],
    members,
    memberAuthIds,
    myRole,
    isAdmin,
    isWorkspaceOwner,
    canManageBranding,
    isLoading: wsLoading,
    switchWorkspace,
    updateBranding,
  }), [wsData, members, memberAuthIds, myRole, isAdmin, isWorkspaceOwner, canManageBranding, wsLoading, switchWorkspace, updateBranding]);

  return <WorkspaceCtx.Provider value={value}>{children}</WorkspaceCtx.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceCtx);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}

export function useWorkspaceOptional(): WorkspaceContext | null {
  return useContext(WorkspaceCtx) ?? null;
}
