/**
 * useConsent — Phase 1 clean pass-through.
 * Returns hasConsented: true to keep the application unblocked.
 */
export function useConsent() {
  return {
    hasConsented: true,
    isLoading: false,
    refetch: async () => {},
  };
}


