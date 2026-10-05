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

interface WorkspaceMember {
  auth_user_id: string;
  app_user_id: string;
  name: string | null;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  membership_id: string;
}

export type MembershipRole = "admin" | "tecnico" | "cliente" | "socio";

interface AvailableWorkspace {
  id: string;
  name: string;
  ownerAppUserId: string | null;
  membershipRole: MembershipRole | null;
  membershipStatus: string;
}

interface WorkspaceContext {
  workspaceId: string | null;
  workspaceName: string | null;
  ownerAppUserId: string | null;
  availableWorkspaces: AvailableWorkspace[];
  members: WorkspaceMember[];
  memberAuthIds: string[];
  myRole: MembershipRole | null;
  isAdmin: boolean;
  isLoading: boolean;
  /** Switch the active operational workspace WITHOUT reloading the page. */
  switchWorkspace: (workspaceId: string) => void;
}

const WorkspaceCtx = createContext<WorkspaceContext | undefined>(undefined);

const SELECTED_KEY = "selected_workspace_id";

function readSelected(): string | null {
  try { return localStorage.getItem(SELECTED_KEY); } catch { return null; }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;

  // Operational scope state — initialised from storage, mutated by the
  // switcher. Owner and tenant users share the same flow: the workspace
  // is the OPERATIONAL context, never the identity.
  const [selectedId, setSelectedId] = useState<string | null>(() => readSelected());

  const { data: wsData, isLoading: wsLoading } = useQuery({
    queryKey: ["my-workspace", userId, selectedId],
    enabled: !!userId,
    retry: 0,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const data = await apiRequest<{
        appUserId: string | null;
        workspaces: Array<{
          workspaceId: string;
          workspaceName: string;
          ownerAppUserId: string | null;
          membershipRole: MembershipRole | null;
          membershipStatus: string;
        }>;
      }>("/account/workspaces", { timeoutMs: 8000 });
      const memberships = data.workspaces;
      if (!memberships || memberships.length === 0) {
        return {
          appUserId: data.appUserId,
          availableWorkspaces: [],
          workspaceId: null,
          workspaceName: null,
          ownerAppUserId: null,
          myRole: null,
        };
      }

      // Resolve: explicit selection → first membership. Never null when
      // memberships exist — operational runtime always has a scope so the
      // owner identity layer stays alongside a live workspace.
      const picked = selectedId ? memberships.find((m) => m.workspaceId === selectedId) : null;
      const membership = picked || memberships[0];
      // Persist whichever id we ended up with so subsequent mounts are
      // deterministic. This does NOT trigger a remount — it just keeps
      // storage in sync with state.
      try {
        if (localStorage.getItem(SELECTED_KEY) !== membership.workspaceId) {
          localStorage.setItem(SELECTED_KEY, membership.workspaceId);
        }
      } catch { /* best effort */ }
      return {
        workspaceId: membership.workspaceId,
        workspaceName: membership.workspaceName,
        appUserId: data.appUserId,
        ownerAppUserId: membership.ownerAppUserId,
        myRole: membership.membershipRole,
        availableWorkspaces: memberships.map((item) => ({
          id: item.workspaceId,
          name: item.workspaceName,
          ownerAppUserId: item.ownerAppUserId,
          membershipRole: item.membershipRole,
          membershipStatus: item.membershipStatus,
        })),
      };
    },
  });

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
    queryClient.invalidateQueries({ queryKey: ["my-workspace"] });
    queryClient.invalidateQueries({ queryKey: ["workspace-members"] });
  }, [selectedId, queryClient]);

  const value = useMemo<WorkspaceContext>(() => ({
    workspaceId: wsData?.workspaceId ?? null,
    workspaceName: wsData?.workspaceName ?? null,
    ownerAppUserId: wsData?.ownerAppUserId ?? null,
    availableWorkspaces: wsData?.availableWorkspaces ?? [],
    members,
    memberAuthIds,
    myRole,
    isAdmin,
    isLoading: wsLoading,
    switchWorkspace,
  }), [wsData, members, memberAuthIds, myRole, isAdmin, wsLoading, switchWorkspace]);

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
