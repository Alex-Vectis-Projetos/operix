import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { resolveRequestContext } from "../middleware/requestContext.js";
import { getFinanceSummary } from "../services/financeSummaryService.js";
import { createExpense, FinanceError, getExpense, listExpenses, presentExpense, reverseExpense } from "../services/expenseService.js";
import { cancelDistribution, createDistribution, getDistribution, listDistributions, presentDistribution } from "../services/distributionService.js";
import { cancelObligation, createObligation, getObligation, listObligations, presentObligation, reversePayment, settleObligation } from "../services/obligationService.js";
import { applyRuleToPaymentList, createProfitRule, deleteProfitRule, listProfitRules } from "../services/profitRuleService.js";
import { getTechnicianStatement, listTechniciansWithFinanceSummary, settleTechnicianBalance } from "../services/technicianFinanceService.js";

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
  z.object({ kind: z.literal("workspace"), workspaceId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("client"), clientId: z.string().uuid() }).strict(),
]);
const allocation = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("fixed"), amount: money }).strict(),
  z.object({ mode: z.literal("percentage"), percentage: money }).strict(),
]);
const distributionSchema = z.object({ paymentListId: z.string().uuid(), paymentListItemId: z.string().uuid().nullable().optional(), participant, allocation }).strict();
const obligationSchema = z.object({ distributionId: z.string().uuid() }).strict();
const emptySchema = z.object({}).strict();
function idempotencyKey(req: Request) { const value = req.header("Idempotency-Key")?.trim(); if (!value || value.length > 255) throw new FinanceError(422, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key é obrigatório."); return value; }
function ctx(req: AuthenticatedRequest) { if (!req.ctx) throw new FinanceError(401, "REQUEST_CONTEXT_MISSING", "Contexto de requisição ausente."); return req.ctx; }
function expenseId(req: Request) { const value = req.params.expenseId; return Array.isArray(value) ? value[0] : value; }
function distributionId(req: Request) { const value = req.params.distributionId; return Array.isArray(value) ? value[0] : value; }
function obligationId(req: Request) { const value = req.params.obligationId; return Array.isArray(value) ? value[0] : value; }
function paymentId(req: Request) { const value = req.params.paymentId; return Array.isArray(value) ? value[0] : value; }
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
financeV2Router.post("/obligations", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try { const result = await createObligation(ctx(req), obligationSchema.parse(req.body).distributionId, idempotencyKey(req)); return res.status(result.idempotent ? 200 : 201).json({ ...presentObligation(result.obligation, result.distribution, result.payment), idempotent: result.idempotent }); } catch (error) { return next(error); }
});
financeV2Router.get("/obligations", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try { return res.json({ items: (await listObligations(ctx(req))).map(result => presentObligation(result.obligation, result.distribution, result.payment)) }); } catch (error) { return next(error); }
});
financeV2Router.get("/obligations/:obligationId", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try { const result = await getObligation(ctx(req), obligationId(req)); return res.json(presentObligation(result.obligation, result.distribution, result.payment)); } catch (error) { return next(error); }
});
financeV2Router.post("/obligations/:obligationId/cancel", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try { const result = await cancelObligation(ctx(req), obligationId(req), reverseSchema.parse(req.body), idempotencyKey(req)); return res.json({ ...presentObligation(result.obligation, result.distribution, result.payment), idempotent: result.idempotent }); } catch (error) { return next(error); }
});
financeV2Router.post("/obligations/:obligationId/settle", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try { emptySchema.parse(req.body); const result = await settleObligation(ctx(req), obligationId(req), idempotencyKey(req)); return res.json({ ...presentObligation(result.obligation, result.distribution, result.payment), idempotent: result.idempotent }); } catch (error) { return next(error); }
});
financeV2Router.post("/obligations/:obligationId/settlements/:paymentId/reverse", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try { const result = await reversePayment(ctx(req), obligationId(req), paymentId(req), reverseSchema.parse(req.body), idempotencyKey(req)); return res.json({ ...presentObligation(result.obligation, result.distribution, result.payment), idempotent: result.idempotent }); } catch (error) { return next(error); }
});

// Profit Distribution Rules (Templates & Batch Application)
financeV2Router.get("/profit-rules", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try { return res.json({ items: await listProfitRules(ctx(req)) }); } catch (error) { return next(error); }
});

const createProfitRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  siteKey: z.string().trim().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  shares: z.array(z.object({
    participantType: z.enum(["technician", "partner", "workspace", "other"]),
    personId: z.string().uuid().nullable().optional(),
    percentage: money,
  })).min(1),
}).strict();

financeV2Router.post("/profit-rules", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const result = await createProfitRule(ctx(req), createProfitRuleSchema.parse(req.body));
    return res.status(201).json(result);
  } catch (error) { return next(error); }
});

financeV2Router.delete("/profit-rules/:ruleId", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const ruleId = Array.isArray(req.params.ruleId) ? req.params.ruleId[0] : req.params.ruleId;
    return res.json(await deleteProfitRule(ctx(req), ruleId));
  } catch (error) { return next(error); }
});

const applyRuleSchema = z.object({
  paymentListId: z.string().uuid(),
  ruleId: z.string().uuid().optional(),
  shares: z.array(z.object({
    participantType: z.enum(["technician", "partner", "workspace", "other"]),
    personId: z.string().uuid().nullable().optional(),
    percentage: money,
  })).optional(),
}).strict();

financeV2Router.post("/distributions/apply-rule", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const result = await applyRuleToPaymentList(ctx(req), applyRuleSchema.parse(req.body));
    return res.status(201).json(result);
  } catch (error) { return next(error); }
});

// Technician Financial Summary, Extrato em 3 partes, and Settlement
financeV2Router.get("/technicians", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    return res.json({ items: await listTechniciansWithFinanceSummary(ctx(req)) });
  } catch (error) { return next(error); }
});

financeV2Router.get("/technicians/:personId/statement", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const personId = Array.isArray(req.params.personId) ? req.params.personId[0] : req.params.personId;
    return res.json(await getTechnicianStatement(ctx(req), personId));
  } catch (error) { return next(error); }
});

const settleSchema = z.object({
  amount: money.optional(),
}).strict();

financeV2Router.post("/technicians/:personId/settle", requireAuth, resolveRequestContext, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const personId = Array.isArray(req.params.personId) ? req.params.personId[0] : req.params.personId;
    const body = settleSchema.parse(req.body || {});
    return res.json(await settleTechnicianBalance(ctx(req), personId, body.amount));
  } catch (error) { return next(error); }
});

financeV2Router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof z.ZodError) return res.status(422).json({ error: { code: "FINANCE_VALIDATION_INVALID", message: "Payload financeiro inválido." } });
  if (error instanceof FinanceError) return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } });
  return next(error);
});
