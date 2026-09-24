import { Router, type Response } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

export const financialRecordsRouter = Router();

function deprecated(res: Response) {
  return res.status(410).json({ code: "LEGACY_FINANCE_WRITE_DEPRECATED", message: "Este recurso foi desativado na T09. Use a autoridade canônica (Expense/PaymentList)." });
}

financialRecordsRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => deprecated(res));
financialRecordsRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => deprecated(res));
financialRecordsRouter.patch("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => deprecated(res));
financialRecordsRouter.delete("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => deprecated(res));
financialRecordsRouter.post("/delete-by", requireAuth, async (req: AuthenticatedRequest, res: Response) => deprecated(res));
