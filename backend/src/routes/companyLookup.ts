import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "../middleware/auth.js";
import { resolveRequestContext } from "../middleware/requestContext.js";
import { lookupCompanyService } from "../services/companyLookupService.js";

export const companyLookupRouter = Router();

companyLookupRouter.use(requireAuth);
companyLookupRouter.use(resolveRequestContext);

companyLookupRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { query, country_hint } = req.body || {};
    if (!query || typeof query !== "string") {
      return res.status(400).json({ message: "query é obrigatório." });
    }
    const result = await lookupCompanyService(query, country_hint || "FR");
    return res.json(result);
  } catch (err) {
    return next(err);
  }
});
