import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Navigate } from "react-router-dom";
import { Loader2, ShieldOff } from "lucide-react";
import { useCan } from "@/hooks/usePermission";
import { useLanguage } from "@/hooks/useLanguage";
import { Skeleton } from "@/components/ui/skeleton";

interface PermissionGuardProps {
  permission: string;             // e.g. "financial.view"
  children: React.ReactNode;
  fallback?: "redirect" | "denied" | "hide";
  redirectTo?: string;
}

function PermissionLoadingSkeleton({ pathname }: { pathname: string }) {
  const isOperationalRoute =
    pathname === "/service-orders" ||
    pathname === "/payment-orders" ||
    pathname === "/financial" ||
    pathname === "/production";

  if (isOperationalRoute) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-3 w-64" />
            </div>
          </div>
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <Skeleton className="hidden h-[60vh] rounded-xl lg:block" />
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
            </div>
            <Skeleton className="h-[48vh] rounded-xl" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-28 rounded-xl" />
      <Skeleton className="h-56 rounded-xl" />
    </div>
  );
}

/**
 * Route/page guard — uses the SINGLE source-of-truth `can()` resolver.
 * No role checks. No fallback to legacy logic.
 *
 * Resilience: a 6s watchdog forces render-through if permissions never
 * resolve, so backend slowness can never deadlock the app shell.
 */
export function PermissionGuard({
  permission,
  children,
  fallback = "denied",
  redirectTo = "/",
}: PermissionGuardProps) {
  const { can, isLoading } = useCan();
  const { t } = useLanguage();
  const location = useLocation();
  const [module, action] = permission.split(".");

  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!isLoading) {
      setTimedOut(false);
      return;
    }
    const t = setTimeout(() => {
      setTimedOut(true);
    }, 1500);
    return () => clearTimeout(t);
  }, [isLoading]);



  if (isLoading && !timedOut) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>{t("guard.checkingPermissions", "A verificar permissões…")}</span>
        </div>
        <PermissionLoadingSkeleton pathname={location.pathname} />
      </div>
    );
  }

  if (timedOut) {
    if (fallback === "hide") return null;
    if (fallback === "redirect") return <Navigate to={redirectTo} replace />;
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center px-6">
        <div className="rounded-full bg-muted/40 p-4 mb-4">
          <ShieldOff className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-1">{t("guard.permissionsUnavailableTitle", "Permissões indisponíveis")}</h2>
        <p className="text-sm text-muted-foreground max-w-md">
          {t("guard.permissionsUnavailableBody", "Não foi possível carregar permissões a tempo. Atualize a página e tente novamente.")}
        </p>
        <p className="text-[11px] text-muted-foreground/60 mt-3 font-mono">required: {permission}</p>
      </div>
    );
  }

  if (can(module, action).allowed) return <>{children}</>;

  if (fallback === "hide") return null;
  if (fallback === "redirect") return <Navigate to={redirectTo} replace />;

  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-6">
      <div className="rounded-full bg-destructive/10 p-4 mb-4">
        <ShieldOff className="h-8 w-8 text-destructive" />
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-1">{t("guard.accessRestrictedTitle", "Acesso restrito")}</h2>
      <p className="text-sm text-muted-foreground max-w-md">
        {t("guard.accessRestrictedBody", "Não tem permissão para visualizar este módulo. Contacte o administrador se precisar de acesso.")}
      </p>
      <p className="text-[11px] text-muted-foreground/60 mt-3 font-mono">required: {permission}</p>
    </div>
  );
}
