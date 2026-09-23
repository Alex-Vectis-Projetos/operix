import { Router, type NextFunction, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { resolveRequestContext } from "../middleware/requestContext.js";
import { getFinanceSummary } from "../services/financeSummaryService.js";

export const financeV2Router = Router();
// Finance v2 has no transport-level workspace selector: RequestContext must
// resolve its normal active scope, never a query-string override.
financeV2Router.use((req, _res, next) => {
  delete (req.query as Record<string, unknown>).workspace_id;
  delete (req.query as Record<string, unknown>).workspaceId;
  next();
});
financeV2Router.get("/summary", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.ctx) return res.status(401).json({ message: "Contexto de requisição ausente." });
    return res.json(await getFinanceSummary(req.ctx));
  } catch (error) {
    return next(error);
  }
});
