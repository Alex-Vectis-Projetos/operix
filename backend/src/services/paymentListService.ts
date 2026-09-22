import { Prisma, type PaymentListStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableEntityError } from "../lib/objectAuth.js";
import type { RequestContext } from "../middleware/requestContext.js";
import { projectPaymentListItemInTransaction } from "./downstreamPaymentOrderAdapter.js";

const currencySchema = z.string({ required_error: "LIST_CURRENCY_REQUIRED" }).regex(/^[A-Z]{3}$/, "LIST_CURRENCY_REQUIRED");
const createSchema = z.object({
  clientId: z.string().uuid(),
  currencyCode: currencySchema,
  // The database keeps legacy-compatible String identifiers.  Authority is
  // still established by the tenant-scoped lookup below, never by ID shape.
  entryIds: z.array(z.string().min(1)).max(500).optional().default([]),
  issueDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  notes: z.string().trim().max(2_000).optional(),
}).strict();

function ws(ctx: RequestContext) {
  if (!ctx.activeWorkspaceId) throw new ForbiddenError("FORBIDDEN_ROLE");
  return ctx.activeWorkspaceId;
}
function manager(ctx: RequestContext) {
  if (ctx.platformRole === "platform_admin" || ctx.membershipRole === "owner" || ctx.membershipRole === "admin") return;
  throw new ForbiddenError("FORBIDDEN_ROLE");
}
function asDecimal(value: Prisma.Decimal | string | number) { return new Prisma.Decimal(value); }

function presentList(list: any) {
  const asMoney = (value: unknown) => value instanceof Prisma.Decimal ? value.toFixed(2) : value;
  return {
    ...list,
    sourceDocumentTotal: asMoney(list.sourceDocumentTotal),
    recognizedTotal: asMoney(list.recognizedTotal),
    items: (list.items ?? []).map((item: any) => ({ ...item, totalAmount: asMoney(item.totalAmount) })),
  };
}

async function allocateNumber(tx: Prisma.TransactionClient, workspaceId: string): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ currentValue: number }>>(Prisma.sql`
    INSERT INTO tenant_sequence_counters (id, workspace_id, sequence_type, current_value, updated_at)
    VALUES (gen_random_uuid(), ${workspaceId}, 'payment_list', 1, NOW())
    ON CONFLICT (workspace_id, sequence_type)
    DO UPDATE SET current_value = tenant_sequence_counters.current_value + 1, updated_at = NOW()
    RETURNING current_value AS "currentValue"
  `);
  const next = rows[0]?.currentValue;
  if (!Number.isInteger(next) || next < 1 || next > 999999) throw new ConflictError("LIST_NUMBER_EXHAUSTED");
  return `L${String(next).padStart(6, "0")}`;
}

async function scopedList(ctx: RequestContext, id: string) {
  const record = await prisma.paymentList.findFirst({ where: { id, workspaceId: ws(ctx) }, include: { items: true, claims: true } });
  if (!record) throw new NotFoundError("LIST_NOT_FOUND");
  return record;
}

function sanitize(ctx: RequestContext, list: any) {
  const formatted = presentList(list);
  if (ctx.membershipRole !== "technician") return formatted;
  const items = formatted.items.filter((item: { technicianUserId?: string | null }) => item.technicianUserId === ctx.actorUserId);
  const { sourceDocumentTotal: _source, recognizedTotal: _recognized, claims: _claims, ...safe } = formatted;
  return { ...safe, items };
}

export async function createPaymentList(ctx: RequestContext, raw: unknown) {
  manager(ctx);
  const input = createSchema.parse(raw);
  const workspaceId = ws(ctx);
  if (new Set(input.entryIds).size !== input.entryIds.length) throw new UnprocessableEntityError("WEEKLOG_ENTRY_NOT_ELIGIBLE");

  try {
    return await prisma.$transaction(async (tx) => {
      const client = await tx.client.findFirst({ where: { id: input.clientId, workspaceId, deletedAt: null }, select: { id: true, name: true } });
      if (!client) throw new UnprocessableEntityError("WEEKLOG_ENTRY_NOT_ELIGIBLE");
      const entries = input.entryIds.length ? await tx.weeklogEntry.findMany({
        where: { id: { in: input.entryIds }, workspaceId }, include: { weeklog: { select: { status: true, siteKey: true } } },
      }) : [];
      if (entries.length !== input.entryIds.length || entries.some((entry) => entry.clientId !== input.clientId || entry.currencyCode !== input.currencyCode || entry.validationStatus !== "approved" || entry.weeklog.status !== "validated")) {
        throw new UnprocessableEntityError(entries.some((entry) => entry.currencyCode !== input.currencyCode) ? "LIST_CURRENCY_MISMATCH" : "WEEKLOG_ENTRY_NOT_ELIGIBLE");
      }
      const number = await allocateNumber(tx, workspaceId);
      const total = entries.reduce((sum, entry) => sum.plus(entry.totalAmount), new Prisma.Decimal(0));
      const list = await tx.paymentList.create({ data: {
        workspaceId, listNumber: number, clientId: client.id, clientName: client.name, currencyCode: input.currencyCode,
        itemCount: entries.length, sourceDocumentTotal: total, recognizedTotal: new Prisma.Decimal(0), createdBy: ctx.actorUserId,
        issueDate: input.issueDate, dueDate: input.dueDate, notes: input.notes,
      } });
      if (entries.length) {
        await tx.paymentListItem.createMany({ data: entries.map((entry) => ({
          workspaceId, paymentListId: list.id, weeklogEntryId: entry.id, carName: [entry.brand, entry.model].filter(Boolean).join(" ") || null,
          licensePlate: entry.licensePlate, vin: entry.vin, technicianUserId: entry.technicianUserId, technicianName: entry.technicianName,
          operationalSiteKey: entry.weeklog.siteKey, servicesSnapshot: entry.servicesSnapshot as Prisma.InputJsonValue, totalAmount: entry.totalAmount,
        })) });
        await tx.paymentListEntryClaim.createMany({ data: entries.map((entry) => ({ workspaceId, paymentListId: list.id, weeklogEntryId: entry.id, status: "reserved" })) });
      }
      const createdItems = await tx.paymentListItem.findMany({ where: { paymentListId: list.id, workspaceId }, select: { id: true } });
      for (const item of createdItems) await projectPaymentListItemInTransaction(tx, workspaceId, item.id);
      return presentList(await tx.paymentList.findUniqueOrThrow({ where: { id: list.id }, include: { items: true, claims: true } }));
    });
  } catch (error: any) {
    if (error?.code === "P2002" && String(error?.meta?.target).includes("weeklog_entry")) throw new ConflictError("WEEKLOG_ENTRY_ALREADY_CLAIMED");
    throw error;
  }
}

export async function commitReviewedImport(ctx: RequestContext, importId: string) {
  manager(ctx);
  const workspaceId = ws(ctx);
  return prisma.$transaction(async (tx) => {
    // The import is the idempotency key for materialisation.  Locking it makes
    // concurrent retries observe the first committed paymentListId instead of
    // allocating a second commercial list.
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM external_list_imports
      WHERE id = ${importId} AND workspace_id = ${workspaceId}
      FOR UPDATE
    `);
    if (!locked.length) throw new NotFoundError("LIST_IMPORT_NOT_REVIEWED");
    const imported = await tx.externalListImport.findFirst({ where: { id: importId, workspaceId }, include: { items: true, reviewedClient: true } });
    if (!imported) throw new NotFoundError("LIST_IMPORT_NOT_REVIEWED");
    if (imported.paymentListId) return presentList(await tx.paymentList.findFirstOrThrow({ where: { id: imported.paymentListId, workspaceId }, include: { items: true } }));
    if (
      imported.status !== "reviewed" ||
      !imported.reviewedClientId ||
      !imported.reviewedCurrencyCode ||
      !/^[A-Z]{3}$/.test(imported.reviewedCurrencyCode) ||
      !imported.reviewedClient ||
      !imported.items.length ||
      imported.items.some((row) =>
        row.status !== "reviewed" ||
        !row.reviewedTotal ||
        !Array.isArray(row.reviewedServices) ||
        row.reviewedServices.length === 0 ||
        asDecimal(row.reviewedTotal).lessThanOrEqualTo(0) ||
        (!row.reviewedLicensePlate && !row.reviewedVin),
      )
    ) throw new UnprocessableEntityError("MISSING_REQUIRED_STAGING_FIELDS");
    const number = await allocateNumber(tx, workspaceId);
    const total = imported.items.reduce((sum, item) => sum.plus(asDecimal(item.reviewedTotal!)), new Prisma.Decimal(0));
    const list = await tx.paymentList.create({ data: {
      workspaceId, listNumber: number, clientId: imported.reviewedClientId, clientName: imported.reviewedClient.name, currencyCode: imported.reviewedCurrencyCode,
      itemCount: imported.items.length, sourceDocumentTotal: total, recognizedTotal: new Prisma.Decimal(0), createdBy: ctx.actorUserId, documentId: imported.id,
      items: { create: imported.items.map((item) => ({ carName: item.reviewedCarName, licensePlate: item.reviewedLicensePlate, vin: item.reviewedVin, technicianUserId: item.reviewedTechnicianUserId, servicesSnapshot: item.reviewedServices as Prisma.InputJsonValue, totalAmount: item.reviewedTotal! })) },
    } });
    await tx.externalListImport.update({ where: { id: imported.id }, data: { paymentListId: list.id, status: "committed" } });
    const createdItems = await tx.paymentListItem.findMany({ where: { paymentListId: list.id, workspaceId }, select: { id: true } });
    for (const item of createdItems) await projectPaymentListItemInTransaction(tx, workspaceId, item.id);
    return presentList(await tx.paymentList.findUniqueOrThrow({ where: { id: list.id }, include: { items: true } }));
  });
}

export async function getPaymentList(ctx: RequestContext, id: string) { return sanitize(ctx, await scopedList(ctx, id)); }
export async function listPaymentLists(ctx: RequestContext) {
  const records = await prisma.paymentList.findMany({ where: { workspaceId: ws(ctx) }, include: { items: true }, orderBy: { createdAt: "desc" } });
  return records.map((record) => sanitize(ctx, record));
}

export async function transitionPaymentList(ctx: RequestContext, id: string, target: unknown) {
  const parsedStatus = z.enum(["under_review", "confronted", "pending", "paid", "cancelled"]).safeParse(target);
  if (!parsedStatus.success) throw new ConflictError("LIST_INVALID_STATE_TRANSITION");
  const toStatus = parsedStatus.data as PaymentListStatus;
  manager(ctx);
  const workspaceId = ws(ctx);
  return prisma.$transaction(async (tx) => {
    const list = await tx.paymentList.findFirst({ where: { id, workspaceId }, include: { claims: true, items: true } });
    if (!list) throw new NotFoundError("LIST_NOT_FOUND");
    if (list.status === "paid" && toStatus === "paid") return presentList(list);
    const allowed: Record<string, string[]> = { draft: ["under_review", "cancelled"], under_review: ["confronted", "cancelled"], confronted: ["pending"], pending: ["paid"], paid: [], cancelled: [] };
    if (!allowed[list.status].includes(toStatus)) throw new ConflictError("LIST_INVALID_STATE_TRANSITION");
    if (toStatus === "pending") {
      const currentRun = await tx.paymentListConfrontationRun.findFirst({
        where: { paymentListId: list.id, workspaceId, status: "completed" },
        orderBy: { sequence: "desc" },
        include: { results: { select: { paymentListItemId: true, status: true, decision: true } } },
      });
      if (!currentRun) {
        throw new ConflictError("LIST_CONFRONTATION_REQUIRED");
      }
      const itemResults = currentRun.results.filter((result) => result.paymentListItemId !== null);
      const evaluatedItems = new Set(itemResults.map((result) => result.paymentListItemId));
      if (evaluatedItems.size !== list.itemCount || currentRun.results.some((result) => result.status === "ambiguous_match" || result.status === "unmatched_weeklog" || (result.status !== "exact_match" && result.decision === "none"))) {
        throw new ConflictError("LIST_CONFRONTATION_REQUIRED");
      }
      if (currentRun.results.some((result) => result.decision === "contest" || result.decision === "request_rectification")) {
        throw new ConflictError("UNRESOLVED_DISPUTES_BLOCK_PENDING");
      }
      await tx.paymentListEntryClaim.updateMany({ where: { paymentListId: list.id, workspaceId, status: "reserved" }, data: { status: "consumed", consumedAt: new Date() } });
    }
    if (toStatus === "cancelled") await tx.paymentListEntryClaim.updateMany({ where: { paymentListId: list.id, workspaceId, status: "reserved" }, data: { status: "released", releasedAt: new Date(), releasedReason: "LIST_CANCELLED" } });
    await tx.paymentList.update({ where: { id: list.id }, data: toStatus === "paid" ? { status: toStatus, paidAt: new Date(), paidBy: ctx.actorUserId } : { status: toStatus } });
    const items = await tx.paymentListItem.findMany({ where: { paymentListId: list.id, workspaceId }, select: { id: true } });
    for (const item of items) await projectPaymentListItemInTransaction(tx, workspaceId, item.id);
    return presentList(await tx.paymentList.findUniqueOrThrow({ where: { id: list.id }, include: { items: true, claims: true } }));
  });
}
