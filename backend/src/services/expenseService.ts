import { createHash } from "node:crypto";
import { Prisma, type Expense } from "@prisma/client";
import type { RequestContext } from "../middleware/requestContext.js";
import { prisma } from "../lib/prisma.js";

export class FinanceError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) { super(message); }
}

export type ExpenseContext =
  | { kind: "payment_list"; id: string }
  | { kind: "production_order"; id: string }
  | { kind: "technician_person"; id: string }
  | { kind: "client"; id: string }
  | { kind: "document"; id: string };

export type ExpenseInput = { amount: string; currencyCode: string; category: string; occurredOn: string; description?: string; context?: ExpenseContext };
export type ExpenseReverseInput = { reason: string };

function fail(statusCode: number, code: string, message: string): never { throw new FinanceError(statusCode, code, message); }
function workspace(ctx: RequestContext) {
  if (!ctx.activeWorkspaceId) fail(403, "FINANCE_FORBIDDEN", "Workspace ativo não definido.");
  if (ctx.membershipRole !== "owner" && ctx.membershipRole !== "admin") fail(403, "FINANCE_FORBIDDEN", "Você não possui permissão para operar despesas.");
  return ctx.activeWorkspaceId;
}
function canonicalDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail(422, "EXPENSE_OCCURRED_ON_INVALID", "Data de ocorrência inválida.");
  return date;
}
function canonicalMoney(value: string) {
  const decimal = new Prisma.Decimal(value);
  if (decimal.lte(0) || decimal.gt(new Prisma.Decimal("9999999999.99"))) fail(422, "EXPENSE_AMOUNT_INVALID", "Valor da despesa inválido.");
  return decimal.toFixed(2);
}
function fingerprint(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function createFingerprint(input: ExpenseInput) {
  return fingerprint({ amount: canonicalMoney(input.amount), currencyCode: input.currencyCode, category: input.category, occurredOn: input.occurredOn, description: input.description?.trim() || null, context: input.context ?? null });
}
function reverseFingerprint(expenseId: string, input: ExpenseReverseInput) { return fingerprint({ expenseId, reason: input.reason.trim() }); }

async function assertContext(tx: Prisma.TransactionClient, workspaceId: string, context?: ExpenseContext) {
  if (!context) return {};
  const missing = () => fail(404, "EXPENSE_CONTEXT_NOT_FOUND", "Contexto da despesa não encontrado.");
  if (context.kind === "payment_list") {
    if (!await tx.paymentList.findFirst({ where: { id: context.id, workspaceId }, select: { id: true } })) missing();
    return { contextKind: "payment_list" as const, paymentListId: context.id };
  }
  if (context.kind === "production_order") {
    if (!await tx.productionOrder.findFirst({ where: { id: context.id, workspaceId }, select: { id: true } })) missing();
    return { contextKind: "production_order" as const, productionOrderId: context.id };
  }
  if (context.kind === "technician_person") {
    if (!await tx.person.findFirst({ where: { id: context.id, workspaceId, type: "technician", deletedAt: null }, select: { id: true } })) missing();
    return { contextKind: "technician_person" as const, technicianPersonId: context.id };
  }
  if (context.kind === "client") {
    if (!await tx.client.findFirst({ where: { id: context.id, workspaceId, deletedAt: null }, select: { id: true } })) missing();
    return { contextKind: "client" as const, clientId: context.id };
  }
  if (!await tx.document.findFirst({ where: { id: context.id, workspaceId }, select: { id: true } })) missing();
  return { contextKind: "document" as const, documentId: context.id };
}

export function presentExpense(expense: Expense) {
  const contextId = expense.paymentListId ?? expense.productionOrderId ?? expense.technicianPersonId ?? expense.clientId ?? expense.documentId;
  return {
    id: expense.id, amount: expense.amount.toFixed(2), currencyCode: expense.currencyCode, category: expense.category,
    occurredOn: expense.occurredOn.toISOString().slice(0, 10), description: expense.description, status: expense.status,
    context: expense.contextKind && contextId ? { kind: expense.contextKind, id: contextId } : null,
    createdAt: expense.createdAt.toISOString(), createdByUserId: expense.createdByUserId,
    reversedAt: expense.reversedAt?.toISOString() ?? null, reversedByUserId: expense.reversedByUserId ?? null, reversalReason: expense.reversalReason ?? null,
  };
}

async function replay(tx: Prisma.TransactionClient, workspaceId: string, actorUserId: string, actionNamespace: string, idempotencyKey: string, requestHash: string) {
  const record = await tx.financeIdempotency.findUnique({ where: { workspaceId_actorUserId_actionNamespace_idempotencyKey: { workspaceId, actorUserId, actionNamespace, idempotencyKey } } });
  if (!record) return null;
  if (record.requestHash !== requestHash) fail(409, "IDEMPOTENCY_KEY_REUSED", "Chave de idempotência reutilizada com outra solicitação.");
  const expense = await tx.expense.findFirst({ where: { id: record.resourceId, workspaceId } });
  if (!expense) fail(409, "IDEMPOTENCY_RESOURCE_MISSING", "Materialização idempotente não encontrada.");
  return expense;
}

export async function createExpense(ctx: RequestContext, input: ExpenseInput, idempotencyKey: string) {
  const workspaceId = workspace(ctx), requestHash = createFingerprint(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await replay(tx, workspaceId, ctx.actorUserId, "expense.create", idempotencyKey, requestHash);
      if (existing) return { expense: existing, idempotent: true };
      const expense = await tx.expense.create({ data: {
        workspaceId, amount: canonicalMoney(input.amount), currencyCode: input.currencyCode, category: input.category,
        occurredOn: canonicalDate(input.occurredOn), description: input.description?.trim() || null, createdByUserId: ctx.actorUserId,
        ...await assertContext(tx, workspaceId, input.context),
      } });
      await tx.financeIdempotency.create({ data: { workspaceId, actorUserId: ctx.actorUserId, actionNamespace: "expense.create", idempotencyKey, requestHash, resourceType: "expense", resourceId: expense.id } });
      return { expense, idempotent: false };
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const existing = await prisma.$transaction((tx) => replay(tx, workspaceId, ctx.actorUserId, "expense.create", idempotencyKey, requestHash));
    if (!existing) throw error;
    return { expense: existing, idempotent: true };
  }
}

export async function listExpenses(ctx: RequestContext) {
  const workspaceId = workspace(ctx);
  return prisma.expense.findMany({ where: { workspaceId }, orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }, { id: "asc" }] });
}

export async function getExpense(ctx: RequestContext, expenseId: string) {
  const workspaceId = workspace(ctx);
  const expense = await prisma.expense.findFirst({ where: { id: expenseId, workspaceId } });
  if (!expense) fail(404, "EXPENSE_NOT_FOUND", "Despesa não encontrada.");
  return expense;
}

export async function reverseExpense(ctx: RequestContext, expenseId: string, input: ExpenseReverseInput, idempotencyKey: string) {
  const workspaceId = workspace(ctx), requestHash = reverseFingerprint(expenseId, input);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await replay(tx, workspaceId, ctx.actorUserId, "expense.reverse", idempotencyKey, requestHash);
      if (existing) return { expense: existing, idempotent: true };
      const current = await tx.expense.findFirst({ where: { id: expenseId, workspaceId } });
      if (!current) fail(404, "EXPENSE_NOT_FOUND", "Despesa não encontrada.");
      if (current.status !== "effective") fail(409, "EXPENSE_NOT_REVERSIBLE", "Despesa já foi revertida.");
      const changed = await tx.expense.updateMany({ where: { id: expenseId, workspaceId, status: "effective" }, data: { status: "reversed", reversedAt: new Date(), reversedByUserId: ctx.actorUserId, reversalReason: input.reason.trim() } });
      if (changed.count !== 1) {
        const raced = await replay(tx, workspaceId, ctx.actorUserId, "expense.reverse", idempotencyKey, requestHash);
        if (raced) return { expense: raced, idempotent: true };
        fail(409, "EXPENSE_NOT_REVERSIBLE", "Despesa já foi revertida.");
      }
      const expense = await tx.expense.findUniqueOrThrow({ where: { id: expenseId } });
      await tx.financeIdempotency.create({ data: { workspaceId, actorUserId: ctx.actorUserId, actionNamespace: "expense.reverse", idempotencyKey, requestHash, resourceType: "expense", resourceId: expense.id } });
      return { expense, idempotent: false };
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const existing = await prisma.$transaction((tx) => replay(tx, workspaceId, ctx.actorUserId, "expense.reverse", idempotencyKey, requestHash));
    if (!existing) throw error;
    return { expense: existing, idempotent: true };
  }
}
