import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiRequest } from "@/lib/api";
import { clearStoredAuthSession, readStoredAuthSession, type AuthUser, writeStoredAuthSession } from "@/lib/authSession";
import { queryClient } from "@/lib/queryClient";
import { RealtimeHub } from "@/lib/realtime/RealtimeHub";
import { OperationalEventBus } from "@/lib/operationalBus";
import { AgentRuntime } from "@/lib/agent";
import { VirtualEngineer } from "@/lib/virtualEngineer";
import { OperationalCopilot } from "@/lib/copilot";
import { logSecurityEvent } from "@/lib/securityLog";
import { registerCurrentDevice } from "@/lib/deviceFingerprint";

const ACTION_TIMEOUT_MS = 15000;

type Profile = { full_name: string; email: string; avatar_url: string | null } | null;
type SessionUser = {
  id: string;
  email: string;
  user_metadata: {
    must_change_password?: boolean;
  };
};

type Session = {
  access_token: string;
  user: SessionUser;
};

function cleanupSessionRuntime() {
  try {
    localStorage.removeItem("selected_workspace_id");
    localStorage.removeItem("owner_global_mode");
    localStorage.removeItem("invite_token");
    sessionStorage.removeItem("invite_token");
    sessionStorage.removeItem("impersonation_target");
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith("ctx_ws::"))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch { /* storage cleanup is best-effort */ }
  try { RealtimeHub.resetHub(); } catch { /* realtime cleanup is best-effort */ }
  try { OperationalEventBus.reset(); } catch { /* runtime cleanup is best-effort */ }
  try { AgentRuntime.stop(); } catch { /* runtime cleanup is best-effort */ }
  try { VirtualEngineer.stop(); } catch { /* runtime cleanup is best-effort */ }
  try { OperationalCopilot.reset(); } catch { /* runtime cleanup is best-effort */ }
  try { queryClient.clear(); } catch { /* cache cleanup is best-effort */ }
}

interface AuthContextType {
  session: Session | null;
  user: AuthUser | null;
  profile: Profile;
  loading: boolean;
  degraded: boolean;
  recoverSession: () => void;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    role?: "admin" | "technician" | "partner" | "client",
  ) => Promise<{ error: Error | null }>;
  changePassword: (password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function withTimeout<T>(promise: PromiseLike<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timeout`)), ms);
    Promise.resolve<T>(promise as PromiseLike<T>).then(
      (v) => { window.clearTimeout(timer); resolve(v); },
      (e) => { window.clearTimeout(timer); reject(e); },
    );
  });
}

function mapUserToSession(user: AuthUser, token: string): Session {
  return {
    access_token: token,
    user: {
      id: user.id,
      email: user.email,
      user_metadata: {},
    },
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<Profile>(null);
  const [loading, setLoading] = useState(true);
  const [degraded] = useState(false);
  const mounted = useRef(true);

  const applySession = (nextUser: AuthUser | null, token: string | null) => {
    if (!mounted.current) return;
    setUser(nextUser);
    setSession(nextUser && token ? mapUserToSession(nextUser, token) : null);
    setProfile(
      nextUser
        ? {
            full_name: nextUser.fullName,
            email: nextUser.email,
            avatar_url: null,
          }
        : null,
    );
  };

  const recoverSession = useCallback(() => {
    clearStoredAuthSession();
    cleanupSessionRuntime();
    applySession(null, null);
    setLoading(false);
    if (typeof window !== "undefined") window.location.replace("/auth");
  }, []);

  useEffect(() => {
    mounted.current = true;
    const boot = async () => {
      const stored = readStoredAuthSession();
      if (!stored?.token) {
        applySession(null, null);
        setLoading(false);
        return;
      }

      try {
        const data = await withTimeout<{ user: AuthUser }>(
          apiRequest("/auth/me", {
            headers: {
              Authorization: `Bearer ${stored.token}`,
            },
          }),
          ACTION_TIMEOUT_MS,
          "restoreSession",
        );
        writeStoredAuthSession({
          token: stored.token,
          user: data.user,
        });
        applySession(data.user, stored.token);
        try { registerCurrentDevice(); } catch { /* device registration must not block auth */ }
      } catch (error) {
        clearStoredAuthSession();
        cleanupSessionRuntime();
        applySession(null, null);
      } finally {
        setLoading(false);
      }
    };

    void boot();

    return () => {
      mounted.current = false;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const data = await withTimeout<{ token: string; user: AuthUser }>(
        apiRequest("/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            password,
          }),
        }),
        ACTION_TIMEOUT_MS,
        "signIn",
      );

      writeStoredAuthSession(data);
      applySession(data.user, data.token);
      try { registerCurrentDevice(); } catch { /* best effort */ }
      logSecurityEvent({
        type: "login",
        severity: "info",
        metadata: { email: data.user.email },
        riskScore: 0,
      });
      return { error: null };
    } catch (err) {
      logSecurityEvent({
        type: "login_failed",
        severity: "warn",
        metadata: { email, reason: err instanceof Error ? err.message : "unknown" },
        riskScore: 30,
      });
      return { error: err instanceof Error ? err : new Error("Login indisponível no momento.") };
    }
  }, []);

  const signUp = useCallback(async (
    email: string,
    password: string,
    fullName: string,
    role: "admin" | "technician" | "partner" | "client" = "admin",
  ) => {
    try {
      const data = await withTimeout<{ token: string; user: AuthUser }>(
        apiRequest("/auth/register", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: email.trim().toLowerCase(),
            password,
            fullName: fullName.trim(),
            role,
          }),
        }),
        ACTION_TIMEOUT_MS,
        "signUp",
      );

      writeStoredAuthSession(data);
      applySession(data.user, data.token);
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error("Falha ao criar conta.") };
    }
  }, []);

  const changePassword = useCallback(async (password: string) => {
    try {
      const stored = readStoredAuthSession();
      if (!stored?.token) {
        throw new Error("Sessão inválida. Faça login novamente.");
      }

      await withTimeout(
        apiRequest("/auth/change-password", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${stored.token}`,
          },
          body: JSON.stringify({ password }),
        }),
        ACTION_TIMEOUT_MS,
        "changePassword",
      );
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error("Erro ao alterar senha.") };
    }
  }, []);

  const signOut = useCallback(async () => {
    clearStoredAuthSession();
    cleanupSessionRuntime();
    applySession(null, null);
    logSecurityEvent({ type: "logout", severity: "info" });
    if (typeof window !== "undefined") window.location.replace("/auth");
  }, []);

  const value = useMemo(
    () => ({ session, user, profile, loading, degraded, recoverSession, signIn, signUp, changePassword, signOut }),
    [session, user, profile, loading, degraded, recoverSession, signIn, signUp, changePassword, signOut],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
