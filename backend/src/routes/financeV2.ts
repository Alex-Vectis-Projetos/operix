import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { resolveRequestContext } from "../middleware/requestContext.js";
import { getFinanceSummary } from "../services/financeSummaryService.js";
import { createExpense, FinanceError, getExpense, listExpenses, presentExpense, reverseExpense } from "../services/expenseService.js";
import { cancelDistribution, createDistribution, getDistribution, listDistributions, presentDistribution } from "../services/distributionService.js";

export const financeV2Router = Router();
const money = z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const context = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("payment_list"), id: z.string().uuid() }).strict(), z.object({ kind: z.literal("production_order"), id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("technician_person"), id: z.string().uuid() }).strict(), z.object({ kind: z.literal("client"), id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("document"), id: z.string().uuid() }).strict(),
]);
const createSchema = z.object({ amount: money, currencyCode: currency, category: z.string().trim().min(1).max(120), occurredOn: date, description: z.string().trim().max(2000).optional(), context: context.optional() }).strict();
const reverseSchema = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();
const participant = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("person"), personId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("workspace"), workspaceId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("client"), clientId: z.string().uuid() }).strict(),
]);
const allocation = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("fixed"), amount: money }).strict(),
  z.object({ mode: z.literal("percentage"), percentage: money }).strict(),
]);
const distributionSchema = z.object({ paymentListId: z.string().uuid(), paymentListItemId: z.string().uuid().nullable().optional(), participant, allocation }).strict();
function idempotencyKey(req: Request) { const value = req.header("Idempotency-Key")?.trim(); if (!value || value.length > 255) throw new FinanceError(422, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key é obrigatório."); return value; }
function ctx(req: AuthenticatedRequest) { if (!req.ctx) throw new FinanceError(401, "REQUEST_CONTEXT_MISSING", "Contexto de requisição ausente."); return req.ctx; }
function expenseId(req: Request) { const value = req.params.expenseId; return Array.isArray(value) ? value[0] : value; }
function distributionId(req: Request) { const value = req.params.distributionId; return Array.isArray(value) ? value[0] : value; }
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
financeV2Router.post("/expenses", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try { const result = await createExpense(ctx(req), createSchema.parse(req.body), idempotencyKey(req)); return res.status(result.idempotent ? 200 : 201).json({ ...presentExpense(result.expense), idempotent: result.idempotent }); } catch (error) { return next(error); }
});
financeV2Router.get("/expenses", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try { return res.json({ items: (await listExpenses(ctx(req))).map(presentExpense) }); } catch (error) { return next(error); }
});
financeV2Router.get("/expenses/:expenseId", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try { return res.json(presentExpense(await getExpense(ctx(req), expenseId(req)))); } catch (error) { return next(error); }
});
financeV2Router.post("/expenses/:expenseId/reverse", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try { const result = await reverseExpense(ctx(req), expenseId(req), reverseSchema.parse(req.body), idempotencyKey(req)); return res.json({ ...presentExpense(result.expense), idempotent: result.idempotent }); } catch (error) { return next(error); }
});
financeV2Router.post("/distributions", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try { const result = await createDistribution(ctx(req), distributionSchema.parse(req.body), idempotencyKey(req)); return res.status(result.idempotent ? 200 : 201).json({ ...presentDistribution(result.distribution), idempotent: result.idempotent }); } catch (error) { return next(error); }
});
financeV2Router.get("/distributions", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try { return res.json({ items: (await listDistributions(ctx(req))).map(presentDistribution) }); } catch (error) { return next(error); }
});
financeV2Router.get("/distributions/:distributionId", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try { return res.json(presentDistribution(await getDistribution(ctx(req), distributionId(req)))); } catch (error) { return next(error); }
});
financeV2Router.post("/distributions/:distributionId/cancel", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try { const result = await cancelDistribution(ctx(req), distributionId(req), reverseSchema.parse(req.body), idempotencyKey(req)); return res.json({ ...presentDistribution(result.distribution), idempotent: result.idempotent }); } catch (error) { return next(error); }
});
financeV2Router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof z.ZodError) return res.status(422).json({ error: { code: "FINANCE_VALIDATION_INVALID", message: "Payload financeiro inválido." } });
  if (error instanceof FinanceError) return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
  return next(error);
});
