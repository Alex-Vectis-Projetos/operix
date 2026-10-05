import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { TERMS_VERSION } from "@/config/legal";

/**
 * Returns whether the current user has accepted the current legal terms version.
 * Backed by localStorage (qw.consent.accepted_${userId}_${TERMS_VERSION}).
 * In Phase 1 canonical architecture, Supabase is eliminated.
 */
export function useConsent() {
  const { user, loading: authLoading } = useAuth();
  const consentKey = user?.id ? `qw.consent.accepted_${user.id}_${TERMS_VERSION}` : null;

  const query = useQuery({
    queryKey: ["user-consent", user?.id, TERMS_VERSION],
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!consentKey || typeof window === "undefined") return false;
      return localStorage.getItem(consentKey) === "true";
    },
  });

  return {
    hasConsented: Boolean(query.data),
    isLoading: !!user?.id && (authLoading || query.isLoading),
    refetch: query.refetch,
  };
}

