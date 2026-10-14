import { prisma } from "../lib/prisma.js";
import { ForbiddenError, NotFoundError } from "../lib/objectAuth.js";
import type { RequestContext } from "../middleware/requestContext.js";

export interface ListCategoriesFilter {
  locale?: string;
  activeOnly?: boolean;
}

export async function listServiceCategories(filter?: ListCategoriesFilter) {
  const locale = filter?.locale || "pt-BR";
  const where = filter?.activeOnly !== false ? { active: true } : {};

  const categories = await prisma.serviceCategory.findMany({
    where,
    orderBy: { sortOrder: "asc" },
    include: {
      translations: {
        where: {
          locale: { in: [locale, "pt-BR", "fr-FR"] },
        },
      },
    },
  });

  return categories.map((c) => {
    const translation =
      c.translations.find((t) => t.locale === locale) ||
      c.translations.find((t) => t.locale === "pt-BR") ||
      c.translations[0];

    return {
      id: c.id,
      code: c.code,
      parentId: c.parentId,
      sortOrder: c.sortOrder,
      active: c.active,
      name: translation?.name || c.code,
    };
  });
}

export interface ListCatalogItemsFilter {
  categoryCode?: string;
  search?: string;
  locale?: string;
  activeOnly?: boolean;
}

export async function listServiceCatalogItems(ctx: RequestContext, filter?: ListCatalogItemsFilter) {
  const wsId = ctx.activeWorkspaceId;
  const locale = filter?.locale || "pt-BR";

  // Category filter
  let categoryId: string | undefined;
  if (filter?.categoryCode) {
    const cat = await prisma.serviceCategory.findUnique({
      where: { code: filter.categoryCode },
      select: { id: true },
    });
    if (cat) categoryId = cat.id;
  }

  // Build query
  const items = await prisma.serviceCatalogItem.findMany({
    where: {
      isActive: filter?.activeOnly !== false ? true : undefined,
      categoryId,
      OR: [
        { workspaceId: null }, // global items
        ...(wsId ? [{ workspaceId: wsId }] : []), // tenant-specific items
      ],
    },
    include: {
      category: {
        include: {
          translations: {
            where: { locale: { in: [locale, "pt-BR", "fr-FR"] } },
          },
        },
      },
      translations: {
        where: { locale: { in: [locale, "pt-BR", "fr-FR"] } },
      },
      ...(wsId
        ? {
            workspaceConfigs: {
              where: { workspaceId: wsId },
            },
          }
        : {}),
    },
    orderBy: [{ category: { sortOrder: "asc" } }, { code: "asc" }],
  });

  return items
    .map((item) => {
      const config = item.workspaceConfigs?.[0];
      const translation =
        item.translations.find((t) => t.locale === locale) ||
        item.translations.find((t) => t.locale === "pt-BR") ||
        item.translations[0];

      const catTranslation =
        item.category.translations.find((t) => t.locale === locale) ||
        item.category.translations.find((t) => t.locale === "pt-BR") ||
        item.category.translations[0];

      // If disabled for this workspace
      if (config && !config.enabled) return null;

      const name = config?.customLabel || translation?.name || item.code;
      const description = translation?.description || null;

      // Text search filter
      if (filter?.search) {
        const q = filter.search.toLowerCase().trim();
        const matches =
          name.toLowerCase().includes(q) ||
          item.code.toLowerCase().includes(q) ||
          (description && description.toLowerCase().includes(q));
        if (!matches) return null;
      }

      return {
        id: item.id,
        code: item.code,
        categoryCode: item.category.code,
        categoryName: catTranslation?.name || item.category.code,
        name,
        description,
        operationType: item.operationType,
        unitType: item.unitType,
        requiresVehicleRegion: item.requiresVehicleRegion,
        requiresQuantity: item.requiresQuantity,
        defaultStageCode: config?.defaultStageCode || item.defaultStageCode,
        suggestedPrice: config?.defaultPrice ? Number(config.defaultPrice) : null,
        currencyCode: config?.currencyCode || null,
        isCustom: item.workspaceId !== null,
      };
    })
    .filter(Boolean);
}

export async function createLocalCatalogItem(
  ctx: RequestContext,
  payload: {
    code: string;
    categoryCode: string;
    operationType?: string;
    unitType?: string;
    requiresVehicleRegion?: boolean;
    requiresQuantity?: boolean;
    defaultStageCode?: string;
    namePt: string;
    nameFr?: string;
    description?: string;
    defaultPrice?: number;
    currencyCode?: string;
  }
) {
  if (!ctx.activeWorkspaceId) {
    throw new ForbiddenError("Workspace ativo necessário.");
  }

  const category = await prisma.serviceCategory.findUnique({
    where: { code: payload.categoryCode },
    select: { id: true },
  });
  if (!category) {
    throw new NotFoundError("Categoria não encontrada.");
  }

  const created = await prisma.serviceCatalogItem.create({
    data: {
      code: payload.code.trim().toLowerCase(),
      workspaceId: ctx.activeWorkspaceId,
      categoryId: category.id,
      operationType: payload.operationType || "repair",
      unitType: payload.unitType || "service",
      requiresVehicleRegion: payload.requiresVehicleRegion ?? false,
      requiresQuantity: payload.requiresQuantity ?? false,
      defaultStageCode: payload.defaultStageCode || null,
      isActive: true,
      translations: {
        create: [
          { locale: "pt-BR", name: payload.namePt, description: payload.description || null },
          ...(payload.nameFr
            ? [{ locale: "fr-FR", name: payload.nameFr, description: payload.description || null }]
            : []),
        ],
      },
      ...(payload.defaultPrice != null
        ? {
            workspaceConfigs: {
              create: {
                workspaceId: ctx.activeWorkspaceId,
                defaultPrice: payload.defaultPrice,
                currencyCode: payload.currencyCode || "EUR",
                enabled: true,
              },
            },
          }
        : {}),
    },
    include: {
      translations: true,
      category: true,
    },
  });

  return created;
}

export async function setWorkspaceServiceConfig(
  ctx: RequestContext,
  catalogItemId: string,
  payload: {
    enabled?: boolean;
    customLabel?: string | null;
    defaultPrice?: number | null;
    currencyCode?: string | null;
    defaultStageCode?: string | null;
  }
) {
  if (!ctx.activeWorkspaceId) {
    throw new ForbiddenError("Workspace ativo necessário.");
  }

  // Validate item exists and is either global or belongs to workspace
  const item = await prisma.serviceCatalogItem.findFirst({
    where: {
      id: catalogItemId,
      OR: [{ workspaceId: null }, { workspaceId: ctx.activeWorkspaceId }],
    },
  });
  if (!item) {
    throw new NotFoundError("Item do catálogo não encontrado.");
  }

  const upserted = await prisma.workspaceServiceConfig.upsert({
    where: {
      workspaceId_catalogItemId: {
        workspaceId: ctx.activeWorkspaceId,
        catalogItemId,
      },
    },
    update: {
      ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {}),
      ...(payload.customLabel !== undefined ? { customLabel: payload.customLabel } : {}),
      ...(payload.defaultPrice !== undefined ? { defaultPrice: payload.defaultPrice } : {}),
      ...(payload.currencyCode !== undefined ? { currencyCode: payload.currencyCode } : {}),
      ...(payload.defaultStageCode !== undefined ? { defaultStageCode: payload.defaultStageCode } : {}),
    },
    create: {
      workspaceId: ctx.activeWorkspaceId,
      catalogItemId,
      enabled: payload.enabled ?? true,
      customLabel: payload.customLabel || null,
      defaultPrice: payload.defaultPrice ?? null,
      currencyCode: payload.currencyCode || "EUR",
      defaultStageCode: payload.defaultStageCode || null,
    },
  });

  return upserted;
}
