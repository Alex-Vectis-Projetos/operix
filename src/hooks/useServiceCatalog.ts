import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "./useWorkspace";
import { useLanguage } from "./useLanguage";
import {
  listServiceCategories,
  listServiceCatalogItems,
  createLocalCatalogItem,
  setWorkspaceServiceConfig,
  type ServiceCategoryDto,
  type ServiceCatalogItemDto,
  type ListCatalogItemsParams,
} from "@/lib/apiServiceCatalog";
import { toast } from "sonner";

export function useServiceCategories() {
  const { lang } = useLanguage();
  const locale = lang === "fr" ? "fr-FR" : "pt-BR";

  return useQuery({
    queryKey: ["service_categories", locale],
    queryFn: () => listServiceCategories(locale),
    staleTime: 5 * 60 * 1000,
  });
}

export function useServiceCatalogItems(params?: Omit<ListCatalogItemsParams, "locale">) {
  const { workspaceId } = useWorkspace();
  const { lang } = useLanguage();
  const locale = lang === "fr" ? "fr-FR" : "pt-BR";

  return useQuery({
    queryKey: ["service_catalog_items", workspaceId, locale, params?.categoryCode, params?.q],
    enabled: !!workspaceId,
    queryFn: () =>
      listServiceCatalogItems({
        ...params,
        locale,
      }),
    staleTime: 60 * 1000,
  });
}

export function useCreateLocalCatalogItem() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      code: string;
      categoryCode: string;
      namePt: string;
      nameFr?: string;
      description?: string;
      operationType?: string;
      unitType?: string;
      defaultPrice?: number;
      currencyCode?: string;
    }) => createLocalCatalogItem(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service_catalog_items"] });
      toast.success("Serviço adicionado ao catálogo da oficina com sucesso.");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Falha ao adicionar serviço ao catálogo.");
    },
  });
}

export function useSetWorkspaceServiceConfig() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: ({
      itemId,
      ...payload
    }: {
      itemId: string;
      enabled?: boolean;
      customLabel?: string | null;
      defaultPrice?: number | null;
      currencyCode?: string | null;
      defaultStageCode?: string | null;
    }) => setWorkspaceServiceConfig(itemId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service_catalog_items"] });
      toast.success("Configuração do serviço atualizada.");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Falha ao salvar configuração do serviço.");
    },
  });
}

export type { ServiceCategoryDto, ServiceCatalogItemDto };
