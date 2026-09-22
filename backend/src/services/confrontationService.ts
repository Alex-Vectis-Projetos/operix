import { Prisma, type ConfrontationDecision, type ConfrontationStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableEntityError } from "../lib/objectAuth.js";
import type { RequestContext } from "../middleware/requestContext.js";
import { rectifyWeeklogEntryInTransaction } from "./weeklogService.js";

const modeSchema = z.enum(["current", "new_round"]);
const decisionSchema = z.object({
  decision: z.enum(["accept_difference", "contest", "request_rectification", "reject_item"]),
  notes: z.string().trim().min(1, "CONFRONTATION_DECISION_NOTES_REQUIRED").max(2_000, "CONFRONTATION_DECISION_NOTES_REQUIRED"),
}).strict();

let afterRectificationTestHook: (() => void | Promise<void>) | undefined;
export function setAfterRectificationTestHook(hook: (() => void | Promise<void>) | undefined) {
  afterRectificationTestHook = hook;
}

type ConfrontMode = z.infer<typeof modeSchema>;
type PlanResult = {
  paymentListItemId: string | null;
  weeklogEntryId: string | null;
  status: ConfrontationStatus;
  differenceAmount: Prisma.Decimal;
};

function workspaceId(ctx: RequestContext) {
  if (!ctx.activeWorkspaceId) throw new ForbiddenError("FORBIDDEN_ROLE");
  return ctx.activeWorkspaceId;
}

function requireManager(ctx: RequestContext) {
  if (ctx.platformRole === "platform_admin" || ctx.membershipRole === "owner" || ctx.membershipRole === "admin") return;
  throw new ForbiddenError("FORBIDDEN_ROLE");
}

function money(value: Prisma.Decimal) { return value.toFixed(2); }

function normalizeVin(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-HJ-NPR-Z0-9]{11,17}$/.test(normalized) ? normalized : null;
}

function normalizePlate(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{5,16}$/.test(normalized) ? normalized : null;
}

function normalizedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ").toUpperCase();
  return normalized || null;
}

function decimalText(value: unknown): string {
  try { return new Prisma.Decimal(value as Prisma.Decimal.Value).toFixed(6); }
  catch { return "1.000000"; }
}

function normalizedServices(value: Prisma.JsonValue): Array<{ identity: string; quantity: string }> | null {
  if (!Array.isArray(value)) return null;
  const services: Array<{ identity: string; quantity: string }> = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const item = raw as Record<string, unknown>;
    const identity = normalizedText(item.serviceId) ?? normalizedText(item.type) ?? normalizedText(item.code) ?? normalizedText(item.name) ?? normalizedText(item.description);
    if (!identity) return null;
    services.push({ identity, quantity: decimalText(item.quantity ?? item.qty ?? 1) });
  }
  return services.sort((left, right) => left.identity.localeCompare(right.identity) || left.quantity.localeCompare(right.quantity));
}

function servicesEqual(left: Prisma.JsonValue, right: Prisma.JsonValue): boolean {
  const normalizedLeft = normalizedServices(left);
  const normalizedRight = normalizedServices(right);
  return normalizedLeft !== null && normalizedRight !== null && normalizedLeft.length === normalizedRight.length && normalizedLeft.every((item, index) => item.identity === normalizedRight[index]!.identity && item.quantity === normalizedRight[index]!.quantity);
}

function coverageContains(snapshot: Prisma.JsonValue, entryId: string): boolean {
  const entries = Array.isArray(snapshot)
    ? snapshot
    : snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && Array.isArray((snapshot as Record<string, unknown>).entries)
      ? (snapshot as Record<string, unknown>).entries as Prisma.JsonValue[]
      : [];
  return entries.some((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
    const value = entry as Record<string, unknown>;
    return value.weeklogEntryId === entryId || value.entryId === entryId || value.id === entryId;
  });
}

function planKey(result: PlanResult) {
  return [result.paymentListItemId ?? "", result.weeklogEntryId ?? "", result.status, money(result.differenceAmount)].join("|");
}

function presentResult(result: any) {
  return { ...result, differenceAmount: result.differenceAmount instanceof Prisma.Decimal ? money(result.differenceAmount) : result.differenceAmount };
}

function presentRun(run: any, mode: ConfrontMode, idempotent: boolean, previousRunId?: string) {
  return {
    runId: run.id,
    sequence: run.sequence,
    status: run.status,
    results: (run.results ?? []).map(presentResult),
    idempotent,
    mode,
    ...(previousRunId ? { previousRunId } : {}),
  };
}

async function lockList(tx: Prisma.TransactionClient, id: string, workspace: string) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM payment_lists WHERE id = ${id} AND workspace_id = ${workspace} FOR UPDATE
  `);
  if (!locked.length) throw new NotFoundError("LIST_NOT_FOUND");
}

async function buildPlan(tx: Prisma.TransactionClient, list: any, workspace: string): Promise<PlanResult[]> {
  const entries = await tx.weeklogEntry.findMany({
    where: {
      workspaceId: workspace,
      clientId: list.clientId,
      currencyCode: list.currencyCode,
      validationStatus: "approved",
      weeklog: { status: "validated" },
    },
    include: {
      weeklog: { include: { validations: { where: { status: "validated" }, select: { coverageSnapshot: true } } } },
    },
    orderBy: { id: "asc" },
  });
  const currentProductionSequence = new Map<string, number>();
  for (const entry of entries) {
    if (entry.sourceType === "production_order" && entry.productionOrderId) {
      currentProductionSequence.set(entry.productionOrderId, Math.max(currentProductionSequence.get(entry.productionOrderId) ?? 0, entry.executionSequence));
    }
  }
  const formallyValidated = entries.filter((entry) =>
    (entry.sourceType !== "production_order" || !entry.productionOrderId || currentProductionSequence.get(entry.productionOrderId) === entry.executionSequence) &&
    entry.weeklog.validations.some((validation) => coverageContains(validation.coverageSnapshot, entry.id)),
  );
  const claims = formallyValidated.length ? await tx.paymentListEntryClaim.findMany({
    where: { workspaceId: workspace, weeklogEntryId: { in: formallyValidated.map((entry) => entry.id) }, status: { in: ["reserved", "consumed"] } },
    select: { weeklogEntryId: true, paymentListId: true, status: true },
  }) : [];
  const available = formallyValidated.filter((entry) => !claims.some((claim) =>
    claim.weeklogEntryId === entry.id && (claim.status === "consumed" || claim.paymentListId !== list.id),
  ));

  const preliminaries = list.items.slice().sort((left: any, right: any) => left.id.localeCompare(right.id)).map((item: any) => {
    const vin = normalizeVin(item.vin);
    const plate = normalizePlate(item.licensePlate);
    const vinCandidates = vin ? available.filter((entry) => normalizeVin(entry.vin) === vin) : [];
    const plateCandidates = plate ? available.filter((entry) => normalizePlate(entry.licensePlate) === plate) : [];
    const vinIds = new Set(vinCandidates.map((entry) => entry.id));
    const plateIds = new Set(plateCandidates.map((entry) => entry.id));
    const contradictory = vinCandidates.length === 1 && plateCandidates.length === 1 && !plateIds.has(vinCandidates[0]!.id);
    const candidates = vinCandidates.length ? vinCandidates : plateCandidates;
    const ambiguous = contradictory || candidates.length > 1 || (vinCandidates.length > 1 && plateCandidates.length > 0 && [...vinIds].some((id) => !plateIds.has(id)));
    return { item, candidates, ambiguous };
  });
  const requestedBy = new Map<string, number>();
  for (const preliminary of preliminaries) {
    if (!preliminary.ambiguous && preliminary.candidates.length === 1) {
      const id = preliminary.candidates[0]!.id;
      requestedBy.set(id, (requestedBy.get(id) ?? 0) + 1);
    }
  }
  const paired = new Set<string>();
  const results: PlanResult[] = [];
  for (const preliminary of preliminaries) {
    const { item, candidates } = preliminary;
    if (preliminary.ambiguous || (candidates.length === 1 && (requestedBy.get(candidates[0]!.id) ?? 0) > 1)) {
      results.push({ paymentListItemId: item.id, weeklogEntryId: null, status: "ambiguous_match", differenceAmount: new Prisma.Decimal(0) });
      continue;
    }
    if (candidates.length !== 1) {
      results.push({ paymentListItemId: item.id, weeklogEntryId: null, status: "vehicle_not_found", differenceAmount: new Prisma.Decimal(0) });
      continue;
    }
    const entry = candidates[0]!;
    paired.add(entry.id);
    const differenceAmount = new Prisma.Decimal(item.totalAmount).minus(entry.totalAmount);
    const status: ConfrontationStatus = !servicesEqual(item.servicesSnapshot, entry.servicesSnapshot)
      ? "service_discrepancy"
      : differenceAmount.abs().lessThan(new Prisma.Decimal("0.01")) ? "exact_match" : "value_difference";
    results.push({ paymentListItemId: item.id, weeklogEntryId: entry.id, status, differenceAmount });
  }
  for (const entry of available) {
    if (!paired.has(entry.id)) results.push({ paymentListItemId: null, weeklogEntryId: entry.id, status: "unmatched_weeklog", differenceAmount: new Prisma.Decimal(0) });
  }
  return results.sort((left, right) => planKey(left).localeCompare(planKey(right)));
}

async function reserveMatchedClaims(tx: Prisma.TransactionClient, workspace: string, listId: string, results: PlanResult[]) {
  for (const result of results) {
    if (!result.weeklogEntryId || result.status === "ambiguous_match" || result.status === "unmatched_weeklog") continue;
    const claim = await tx.paymentListEntryClaim.findFirst({ where: { workspaceId: workspace, weeklogEntryId: result.weeklogEntryId, status: { in: ["reserved", "consumed"] } } });
    if (claim?.status === "consumed" || (claim && claim.paymentListId !== listId)) throw new ConflictError("WEEKLOG_ENTRY_ALREADY_CLAIMED");
    if (!claim) await tx.paymentListEntryClaim.create({ data: { workspaceId: workspace, paymentListId: listId, weeklogEntryId: result.weeklogEntryId, status: "reserved" } });
  }
}

async function recognizedTotal(tx: Prisma.TransactionClient, workspace: string, listId: string, runId: string) {
  const results = await tx.paymentListConfrontationResult.findMany({
    where: { workspaceId: workspace, paymentListId: listId, runId, paymentListItemId: { not: null }, OR: [{ status: "exact_match" }, { decision: "accept_difference" }] },
    include: { paymentListItem: { select: { totalAmount: true } } },
  });
  return results.reduce((total, result) => total.plus(result.paymentListItem?.totalAmount ?? 0), new Prisma.Decimal(0));
}

async function persistPlan(tx: Prisma.TransactionClient, workspace: string, list: any, run: any, plan: PlanResult[], actorUserId: string) {
  await reserveMatchedClaims(tx, workspace, list.id, plan);
  await tx.paymentListConfrontationResult.createMany({ data: plan.map((result) => ({
    workspaceId: workspace,
    paymentListId: list.id,
    runId: run.id,
    paymentListItemId: result.paymentListItemId,
    weeklogEntryId: result.weeklogEntryId,
    status: result.status,
    differenceAmount: result.differenceAmount,
  })) });
  const total = await recognizedTotal(tx, workspace, list.id, run.id);
  await tx.paymentList.update({ where: { id: list.id }, data: { status: list.status === "under_review" ? "confronted" : list.status, confrontedBy: list.status === "under_review" ? actorUserId : undefined, confrontedAt: list.status === "under_review" ? new Date() : undefined, recognizedTotal: total } });
  return tx.paymentListConfrontationRun.update({ where: { id: run.id }, data: { status: "completed", completedAt: new Date() }, include: { results: { orderBy: { createdAt: "asc" } } } });
}

export async function runConfrontation(ctx: RequestContext, listId: string, raw: unknown) {
  requireManager(ctx);
  const mode = raw === undefined || raw === null || (typeof raw === "object" && Object.keys(raw as object).length === 0)
    ? "current" as const
    : modeSchema.parse((raw as { mode?: unknown }).mode ?? "current");
  const workspace = workspaceId(ctx);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockList(tx, listId, workspace);
      const list = await tx.paymentList.findFirst({ where: { id: listId, workspaceId: workspace }, include: { items: true } });
      if (!list) throw new NotFoundError("LIST_NOT_FOUND");
      if (!["under_review", "confronted"].includes(list.status)) throw new ConflictError("CONFRONTATION_LIST_STATE_LOCKED");
      const latest = await tx.paymentListConfrontationRun.findFirst({ where: { paymentListId: list.id, workspaceId: workspace }, orderBy: { sequence: "desc" }, include: { results: { orderBy: { createdAt: "asc" } } } });
      const plan = await buildPlan(tx, list, workspace);
      if (mode === "current" && latest) {
        const existingKeys = latest.results.map((result) => [result.paymentListItemId ?? "", result.weeklogEntryId ?? "", result.status, money(result.differenceAmount)].join("|")).sort();
        const planKeys = plan.map(planKey).sort();
        if (existingKeys.length === planKeys.length && existingKeys.every((key, index) => key === planKeys[index])) return presentRun(latest, mode, true);
        if (latest.results.some((result) => result.decision !== "none")) throw new ConflictError("CONFRONTATION_RERUN_HAS_DECISIONS");
        await tx.paymentListConfrontationResult.deleteMany({ where: { runId: latest.id, workspaceId: workspace, paymentListId: list.id } });
        const rebuilt = await persistPlan(tx, workspace, list, latest, plan, ctx.actorUserId);
        return presentRun(rebuilt, mode, false);
      }
      if (mode === "new_round" && latest) await tx.paymentListConfrontationRun.update({ where: { id: latest.id }, data: { status: "superseded" } });
      const run = await tx.paymentListConfrontationRun.create({ data: { workspaceId: workspace, paymentListId: list.id, sequence: latest ? latest.sequence + 1 : 1, status: "started" } });
      const completed = await persistPlan(tx, workspace, list, run, plan, ctx.actorUserId);
      return presentRun(completed, mode, false, mode === "new_round" && latest ? latest.id : undefined);
    });
  } catch (error: any) {
    if (error?.code === "P2002") throw new ConflictError("CONFRONTATION_CONCURRENT_WRITE");
    throw error;
  }
}

export async function getConfrontation(ctx: RequestContext, listId: string) {
  requireManager(ctx);
  const workspace = workspaceId(ctx);
  const list = await prisma.paymentList.findFirst({ where: { id: listId, workspaceId: workspace }, include: { items: true } });
  if (!list) throw new NotFoundError("LIST_NOT_FOUND");
  const run = await prisma.paymentListConfrontationRun.findFirst({ where: { paymentListId: list.id, workspaceId: workspace }, orderBy: { sequence: "desc" }, include: { results: { orderBy: { createdAt: "asc" } } } });
  if (!run) return { status: "not_evaluated", items: list.items.map((item) => ({ paymentListItemId: item.id, confrontationStatus: "not_evaluated" })), results: [] };
  return presentRun(run, "current", true);
}

export async function decideConfrontationResult(ctx: RequestContext, listId: string, resultId: string, raw: unknown) {
  requireManager(ctx);
  const input = decisionSchema.parse(raw);
  const workspace = workspaceId(ctx);
  return prisma.$transaction(async (tx) => {
    await lockList(tx, listId, workspace);
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM payment_list_confrontation_results
      WHERE id = ${resultId} AND payment_list_id = ${listId} AND workspace_id = ${workspace} FOR UPDATE
    `);
    if (!locked.length) throw new NotFoundError("CONFRONTATION_RESULT_NOT_FOUND");
    const result = await tx.paymentListConfrontationResult.findFirst({ where: { id: resultId, paymentListId: listId, workspaceId: workspace }, include: { confrontationRun: true, paymentListItem: true } });
    if (!result) throw new NotFoundError("CONFRONTATION_RESULT_NOT_FOUND");
    const latest = await tx.paymentListConfrontationRun.findFirst({ where: { paymentListId: listId, workspaceId: workspace }, orderBy: { sequence: "desc" } });
    if (!latest || latest.id !== result.runId) throw new ConflictError("CONFRONTATION_RUN_NOT_CURRENT");
    if (result.decision !== "none") {
      if (result.decision === input.decision && result.notes === input.notes) {
        if (input.decision === "request_rectification" && (!result.reopenedProductionOrderId || !result.targetExecutionSequence)) {
          const entry = result.weeklogEntryId ? await tx.weeklogEntry.findFirst({ where: { id: result.weeklogEntryId, workspaceId: workspace }, select: { id: true, weeklogId: true, sourceType: true, productionOrderId: true } }) : null;
          if (!entry) throw new ConflictError("RECTIFICATION_LINEAGE_CONFLICT");
          if (entry.sourceType === "external_import" || !entry.productionOrderId) throw new UnprocessableEntityError("EXTERNAL_ENTRY_CANNOT_RECTIFY_PO");
          const productionOrder = await tx.productionOrder.findFirst({
            where: { id: entry.productionOrderId, workspaceId: workspace },
            select: { rectificationOriginId: true },
          });
          if (!productionOrder || (productionOrder.rectificationOriginId && productionOrder.rectificationOriginId !== entry.id)) {
            throw new ConflictError("RECTIFICATION_LINEAGE_CONFLICT");
          }
          const rectification = await rectifyWeeklogEntryInTransaction(tx, ctx, entry.weeklogId, entry.id, { reason: input.notes });
          const recovered = await tx.paymentListConfrontationResult.update({ where: { id: result.id }, data: { reopenedProductionOrderId: rectification.productionOrder.id, targetExecutionSequence: rectification.productionOrder.executionSequence } });
          return { result: presentResult(recovered), idempotent: true };
        }
        return { result: presentResult(result), idempotent: true };
      }
      throw new ConflictError("CONFRONTATION_DECISION_ALREADY_RECORDED");
    }
    if (result.status === "exact_match") throw new UnprocessableEntityError("CONFRONTATION_DECISION_NOT_ALLOWED");
    if (input.decision === "accept_difference" && result.status !== "value_difference" && result.status !== "service_discrepancy") {
      throw new UnprocessableEntityError("CONFRONTATION_DECISION_NOT_ALLOWED");
    }
    if (!result.paymentListItemId && input.decision !== "request_rectification") throw new UnprocessableEntityError("CONFRONTATION_DECISION_NOT_ALLOWED");
    if (input.decision === "reject_item" && !result.paymentListItemId) throw new UnprocessableEntityError("CONFRONTATION_DECISION_NOT_ALLOWED");
    if (input.decision === "request_rectification" && !result.weeklogEntryId) throw new UnprocessableEntityError("CONFRONTATION_DECISION_NOT_ALLOWED");
    let lineage: { reopenedProductionOrderId?: string; targetExecutionSequence?: number } = {};
    if (input.decision === "request_rectification") {
      const entry = await tx.weeklogEntry.findFirst({ where: { id: result.weeklogEntryId!, workspaceId: workspace }, select: { id: true, weeklogId: true, sourceType: true, productionOrderId: true } });
      if (!entry) throw new NotFoundError("WEEKLOG_ENTRY_NOT_FOUND");
      if (entry.sourceType === "external_import" || !entry.productionOrderId) throw new UnprocessableEntityError("EXTERNAL_ENTRY_CANNOT_RECTIFY_PO");
      const rectification = await rectifyWeeklogEntryInTransaction(tx, ctx, entry.weeklogId, entry.id, { reason: input.notes });
      lineage = { reopenedProductionOrderId: rectification.productionOrder.id, targetExecutionSequence: rectification.productionOrder.executionSequence };
      await afterRectificationTestHook?.();
    }
    const updated = await tx.paymentListConfrontationResult.update({ where: { id: result.id }, data: { decision: input.decision as ConfrontationDecision, notes: input.notes, decidedBy: ctx.actorUserId, decidedAt: new Date(), ...lineage } });
    if (input.decision === "reject_item" && result.weeklogEntryId) {
      await tx.paymentListEntryClaim.updateMany({ where: { workspaceId: workspace, paymentListId: listId, weeklogEntryId: result.weeklogEntryId, status: "reserved" }, data: { status: "released", releasedAt: new Date(), releasedReason: "rejected_in_confrontation" } });
    }
    const total = await recognizedTotal(tx, workspace, listId, result.runId);
    await tx.paymentList.update({ where: { id: listId }, data: { recognizedTotal: total } });
    return { result: presentResult(updated), idempotent: false };
  });
}
