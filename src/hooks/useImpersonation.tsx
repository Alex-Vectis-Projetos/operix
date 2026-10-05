import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { useAuth } from "./useAuth";

/**
 * Impersonation — admin-only "view as user" mode.
 *
 * Security model (frontend-filter strategy):
 *  - The real auth session is NEVER swapped. RLS still runs as the admin.
 *  - `effectiveUserId` is consumed by useRole, usePermission, and any hook
 *    that filters data by user identity, so the UI mirrors what the target
 *    user would see.
 *  - Only admins can start impersonation (enforced both client-side here
 *    and again at the call site via isAdmin check).
 *  - Every start/exit is logged to backend_event_logs.
 *
 * Persistence: sessionStorage (survives reloads, dies with tab).
 */

const STORAGE_KEY = "impersonation_target";

type ImpersonationTarget = {
  userId: string;
  fullName: string;
  email: string;
  role: string;
};

interface ImpersonationContextType {
  target: ImpersonationTarget | null;
  isImpersonating: boolean;
  /** Effective auth user id — impersonated id when active, real auth id otherwise. */
  effectiveUserId: string | null;
  startImpersonation: (target: ImpersonationTarget) => Promise<void>;
  stopImpersonation: () => Promise<void>;
}

const Ctx = createContext<ImpersonationContextType | undefined>(undefined);

function readStored(): ImpersonationTarget | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.userId === "string") return parsed;
  } catch {
    /* ignore */
  }
  return null;
}

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [target, setTarget] = useState<ImpersonationTarget | null>(() => readStored());

  // Auto-clear if the real user changes (logout / different login)
  useEffect(() => {
    if (!user?.id && target) {
      sessionStorage.removeItem(STORAGE_KEY);
      setTarget(null);
    }
  }, [user?.id, target]);

  const startImpersonation = useCallback(
    async (t: ImpersonationTarget) => {
      if (!user?.id) return;
      if (t.userId === user.id) return; // can't impersonate self
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(t));
      setTarget(t);
    },
    [user?.id],
  );

  const stopImpersonation = useCallback(async () => {
    sessionStorage.removeItem(STORAGE_KEY);
    setTarget(null);
  }, []);

  const value: ImpersonationContextType = {
    target,
    isImpersonating: !!target,
    effectiveUserId: target?.userId ?? user?.id ?? null,
    startImpersonation,
    stopImpersonation,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useImpersonation() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useImpersonation must be used within ImpersonationProvider");
  return ctx;
}
