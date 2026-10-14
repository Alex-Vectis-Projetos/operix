import { apiRequest } from "./api";

export interface ServiceCategoryDto {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  active: boolean;
  parentId?: string | null;
}

export interface ServiceCatalogItemDto {
  id: string;
  code: string;
  categoryCode: string;
  categoryName: string;
  name: string;
  description?: string | null;
  operationType: string;
  unitType: string;
  requiresVehicleRegion: boolean;
  requiresQuantity: boolean;
  defaultStageCode?: string | null;
  suggestedPrice?: number | null;
  currencyCode?: string | null;
  isCustom: boolean;
}

export async function listServiceCategories(locale = "pt-BR"): Promise<ServiceCategoryDto[]> {
  return apiRequest<ServiceCategoryDto[]>(`/service-catalog/categories?locale=${encodeURIComponent(locale)}`, {
    timeoutMs: 10000,
  });
}

export interface ListCatalogItemsParams {
  categoryCode?: string;
  q?: string;
  locale?: string;
}

export async function listServiceCatalogItems(params?: ListCatalogItemsParams): Promise<ServiceCatalogItemDto[]> {
  const query = new URLSearchParams();
  if (params?.categoryCode) query.set("categoryCode", params.categoryCode);
  if (params?.q) query.set("q", params.q);
  if (params?.locale) query.set("locale", params.locale);

  const qs = query.toString();
  return apiRequest<ServiceCatalogItemDto[]>(`/service-catalog/items${qs ? `?${qs}` : ""}`, {
    timeoutMs: 12000,
  });
}

export async function createLocalCatalogItem(payload: {
  code: string;
  categoryCode: string;
  namePt: string;
  nameFr?: string;
  description?: string;
  operationType?: string;
  unitType?: string;
  defaultPrice?: number;
  currencyCode?: string;
}): Promise<ServiceCatalogItemDto> {
  return apiRequest<ServiceCatalogItemDto>("/service-catalog/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 12000,
  });
}

export async function setWorkspaceServiceConfig(
  itemId: string,
  payload: {
    enabled?: boolean;
    customLabel?: string | null;
    defaultPrice?: number | null;
    currencyCode?: string | null;
    defaultStageCode?: string | null;
  }
): Promise<any> {
  return apiRequest(`/service-catalog/configs/${itemId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: 12000,
  });
}
