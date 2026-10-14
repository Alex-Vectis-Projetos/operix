import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "../middleware/auth.js";
import { resolveRequestContext, type RequestContext } from "../middleware/requestContext.js";
import {
  listServiceCategories,
  listServiceCatalogItems,
  createLocalCatalogItem,
  setWorkspaceServiceConfig,
} from "../services/serviceCatalogService.js";

export const serviceCatalogRouter = Router();

// Permite leitura autenticada com contexto de workspace
serviceCatalogRouter.use(requireAuth);
serviceCatalogRouter.use(resolveRequestContext);

// GET /api/service-catalog/categories
serviceCatalogRouter.get(
  "/categories",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const locale = (req.query.locale as string) || "pt-BR";
      const categories = await listServiceCategories({ locale });
      res.json(categories);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/service-catalog/items
serviceCatalogRouter.get(
  "/items",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.ctx as RequestContext;
      const categoryCode = req.query.categoryCode as string | undefined;
      const search = req.query.q as string | undefined;
      const locale = (req.query.locale as string) || "pt-BR";

      const items = await listServiceCatalogItems(ctx, {
        categoryCode,
        search,
        locale,
      });

      res.json(items);
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/service-catalog/items (criação de item local do workspace)
serviceCatalogRouter.post(
  "/items",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.ctx as RequestContext;
      const {
        code,
        categoryCode,
        operationType,
        unitType,
        requiresVehicleRegion,
        requiresQuantity,
        defaultStageCode,
        namePt,
        nameFr,
        description,
        defaultPrice,
        currencyCode,
      } = req.body;

      if (!code || !categoryCode || !namePt) {
        return res.status(400).json({
          error: "Campos obrigatórios: code, categoryCode, namePt.",
        });
      }

      const item = await createLocalCatalogItem(ctx, {
        code,
        categoryCode,
        operationType,
        unitType,
        requiresVehicleRegion,
        requiresQuantity,
        defaultStageCode,
        namePt,
        nameFr,
        description,
        defaultPrice,
        currencyCode,
      });

      res.status(201).json(item);
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/service-catalog/configs/:itemId (customização local de preço/etapa do workspace)
serviceCatalogRouter.patch(
  "/configs/:itemId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.ctx as RequestContext;
      const itemId = String(req.params.itemId);
      const { enabled, customLabel, defaultPrice, currencyCode, defaultStageCode } = req.body;

      const config = await setWorkspaceServiceConfig(ctx, itemId, {
        enabled,
        customLabel,
        defaultPrice,
        currencyCode,
        defaultStageCode,
      });

      res.json(config);
    } catch (err) {
      next(err);
    }
  }
);
