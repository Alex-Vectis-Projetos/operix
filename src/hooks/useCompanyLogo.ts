import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { apiRequest } from "@/lib/api";
import { useWorkspaceOptional } from "./useWorkspace";
import type { BrandConfig } from "@/components/layout/BrandNameEditor";

/**
 * Procedural & Custom branding store.
 *
 * Workspace-scoped branding with seamless fallback to company settings.
 * Prioritizes active operational workspace for multi-tenant isolation.
 */
export function useCompanyLogo() {
  const queryClient = useQueryClient();
  const workspace = useWorkspaceOptional();
  const workspaceId = workspace?.workspaceId;

  const { data, isLoading } = useQuery({
    queryKey: ["company-brand", workspaceId ?? "none"],
    queryFn: async () => {
      const empty = { brandConfig: {} as BrandConfig };
      if (workspaceId) {
        try {
          const res = await apiRequest<{
            workspace: {
              id: string;
              name: string;
              brand_config: BrandConfig | null;
              logo_url: string | null;
            };
          }>(`/workspaces/${workspaceId}/branding`);
          if (res?.workspace) {
            const raw = (res.workspace.brand_config as BrandConfig) || {};
            return {
              brandConfig: {
                ...raw,
                name: raw.name || res.workspace.name,
                logoUrl: res.workspace.logo_url ?? raw.logoUrl ?? null,
              },
            };
          }
        } catch {
          // fallback to /settings/company if workspace branding route fails
        }
      }

      try {
        const data = await apiRequest<{ settings: any }>("/settings/company");
        const raw = (data?.settings?.brand_config || data?.settings?.brandConfig) as BrandConfig | null;
        const logoUrl = data?.settings?.logo_url || data?.settings?.logoUrl || null;
        return {
          brandConfig: raw ? { ...raw, ...(logoUrl ? { logoUrl } : {}) } : ({} as BrandConfig),
        };
      } catch {
        return empty;
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const brandMutation = useMutation({
    mutationFn: async (brandConfig: BrandConfig) => {
      if (workspaceId) {
        await apiRequest(`/workspaces/${workspaceId}/branding`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: brandConfig.name,
            brand_config: brandConfig,
            logo_url: brandConfig.logoUrl ?? null,
          }),
        });
      } else {
        await apiRequest("/settings/company", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brand_config: brandConfig,
            logo_url: brandConfig.logoUrl ?? undefined,
          }),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-brand"] });
      queryClient.invalidateQueries({ queryKey: ["my-workspace"] });
      queryClient.invalidateQueries({ queryKey: ["company-settings"] });
    },
  });

  const effectiveBrandConfig: BrandConfig = useMemo(() => {
    const fromWs = workspace?.brandConfig;
    const wsLogo = workspace?.logoUrl;
    const fromQuery = data?.brandConfig;
    const merged = { ...(fromQuery || {}), ...(fromWs || {}) };
    if (wsLogo && !merged.logoUrl) {
      merged.logoUrl = wsLogo;
    }
    return merged;
  }, [workspace?.brandConfig, workspace?.logoUrl, data?.brandConfig]);

  return {
    brandConfig: effectiveBrandConfig,
    isLoading,
    saveBrandConfig: brandMutation.mutateAsync,
    isSavingBrand: brandMutation.isPending,
  };
}
