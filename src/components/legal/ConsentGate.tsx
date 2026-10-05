import { ReactNode, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Loader2, ShieldCheck, ExternalLink } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useConsent } from "@/hooks/useConsent";
import { CONSENT_ITEMS, TERMS_VERSION, ConsentKey } from "@/config/legal";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { SYSTEM_METADATA } from "@/config/system";

/**
 * ConsentGate — full-screen mandatory legal consent capture for first login
 * (or whenever TERMS_VERSION is bumped). Blocks the entire app until accepted.
 * Bypassed on /legal/* routes so users can read the policies.
 */
export function ConsentGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { hasConsented, isLoading, refetch } = useConsent();
  const location = useLocation();

  const isLegalRoute = location.pathname.startsWith("/legal");

  const [accepted, setAccepted] = useState<Record<ConsentKey, boolean>>({
    accepted_terms: false,
    accepted_privacy: false,
    accepted_gdpr: false,
    accepted_data_storage: false,
    accepted_sharing_policy: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [bootTimedOut, setBootTimedOut] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBootTimedOut(true), 5000);
    return () => clearTimeout(t);
  }, []);

  const allChecked = useMemo(
    () => CONSENT_ITEMS.every((c) => accepted[c.key]),
    [accepted],
  );

  // GDPR consent must NEVER block pre-auth, signup, logout or legal pages.
  // Bypass first; only show the loading spinner once we actually have a user
  // and are still resolving their consent record.
  if (!user || isLegalRoute) return <>{children}</>;

  if (isLoading && !bootTimedOut) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Verificando consentimentos…</p>
      </div>
    );
  }

  if (hasConsented || bootTimedOut) return <>{children}</>;

  const handleAccept = async () => {
    if (!allChecked || !user) return;
    setSubmitting(true);
    try {
      const consentKey = `qw.consent.accepted_${user.id}_${TERMS_VERSION}`;
      localStorage.setItem(consentKey, "true");
      toast.success("Consentimentos registrados.");
      await refetch();
    } catch (err: any) {
      console.error("[ConsentGate] error:", err);
      toast.error("Não foi possível registrar os consentimentos. Tente novamente.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-md px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-xl rounded-2xl border border-border/60 bg-card shadow-2xl">
        <div className="p-7 border-b border-border/60">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground tracking-tight">
                Consentimento Legal Obrigatório
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                Para acessar o {SYSTEM_METADATA.trademark}, revise e aceite os termos abaixo.
              </p>
            </div>
          </div>
        </div>

        <div className="p-7 space-y-3">
          {CONSENT_ITEMS.map((item) => (
            <label
              key={item.key}
              htmlFor={item.key}
              className="flex items-start gap-3 rounded-lg border border-border/50 bg-background/40 px-4 py-3 hover:border-border transition-colors cursor-pointer"
            >
              <Checkbox
                id={item.key}
                checked={accepted[item.key]}
                onCheckedChange={(v) =>
                  setAccepted((s) => ({ ...s, [item.key]: v === true }))
                }
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <Label htmlFor={item.key} className="text-sm text-foreground leading-snug cursor-pointer">
                  {item.label}
                </Label>
                {item.href && (
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Ler documento <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </label>
          ))}
        </div>

        <div className="p-7 pt-2 border-t border-border/60 flex flex-col gap-3">
          <Button
            onClick={handleAccept}
            disabled={!allChecked || submitting}
            className="w-full h-11"
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Continuar para o sistema
          </Button>
          <p className="text-[10px] text-center text-muted-foreground/70 tracking-wide">
            {SYSTEM_METADATA.trademark} © {SYSTEM_METADATA.year} · Versão dos termos {TERMS_VERSION}
          </p>
        </div>
      </div>
    </div>
  );
}
