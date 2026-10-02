import { type ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/useLanguage";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading, degraded, recoverSession } = useAuth();
  const location = useLocation();
  const { t } = useLanguage();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!loading) {
      setTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setTimedOut(true), 1500);
    return () => window.clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    // #region debug-point A:protected-route-state
    void fetch("http://127.0.0.1:7777/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "route-loading-stall",
        runId: "pre-fix",
        hypothesisId: "A",
        location: "src/components/ProtectedRoute.tsx:state",
        msg: "[DEBUG] AUTH_GUARD_STATE",
        data: {
          pathname: location.pathname,
          loading,
          timedOut,
          hasSession: Boolean(session),
          degraded,
        },
        ts: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }, [degraded, loading, location.pathname, session, timedOut]);

  // Auth degradado (GoTrue 504 storm): nunca prender a UI.
  if (degraded && !session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-6 px-6 text-center">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-primary font-bold text-primary-foreground text-2xl">
          Q
        </div>
        <div className="max-w-md space-y-2">
          <h1 className="text-lg font-semibold text-foreground">
            {t("auth.restoreSessionTitle", "Tivemos um problema temporário ao restaurar sua sessão.")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("auth.restoreSessionBody", "Faça login novamente para continuar. Seus dados estão seguros.")}
          </p>
        </div>
        <Button onClick={recoverSession}>{t("action.signInAgain", "Entrar novamente")}</Button>
      </div>
    );
  }

  if (loading && !timedOut) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-primary font-bold text-primary-foreground text-2xl">
          Q
        </div>
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{t("common.loading", "A carregar…")} Operix…</p>
      </div>
    );
  }

  if (loading && timedOut) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-6 px-6 text-center">
        <div className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-primary font-bold text-primary-foreground text-2xl">
          Q
        </div>
        <div className="max-w-md space-y-2">
          <h1 className="text-lg font-semibold text-foreground">
            {t("auth.restoreSessionTitle", "Tivemos um problema temporário ao restaurar sua sessão.")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("auth.restoreSessionBody", "Faça login novamente para continuar. Seus dados estão seguros.")}
          </p>
        </div>
        <Button onClick={recoverSession}>{t("action.signInAgain", "Entrar novamente")}</Button>
      </div>
    );
  }

  if (!session) return <Navigate to="/auth" replace />;

  void location;

  return <>{children}</>;
}
