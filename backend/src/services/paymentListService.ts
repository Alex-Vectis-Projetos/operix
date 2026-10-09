import { Prisma, type PaymentListStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableEntityError } from "../lib/objectAuth.js";
import type { RequestContext } from "../middleware/requestContext.js";
import { projectPaymentListItemInTransaction } from "./downstreamPaymentOrderAdapter.js";
import { mapBillingInvoice } from "../routes/billingOperations.js";

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
    items: (list.items ?? []).map((item: any) => ({
      ...item,
      vehicleDescription: item.vehicleDescription || item.carName || "Véhicule non spécifié",
      serviceLocation: item.serviceLocation || item.operationalSiteKey || "",
      totalAmount: asMoney(item.totalAmount),
    })),
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

export async function absorbProvisionalClaimsInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    workspaceId: string;
    targetPaymentListId: string;
    entryIds: string[];
    absorbedByReason: string;
  }
) {
  if (!params.entryIds.length) return;

  const existingClaims = await tx.paymentListEntryClaim.findMany({
    where: {
      workspaceId: params.workspaceId,
      weeklogEntryId: { in: params.entryIds },
      status: { in: ["provisional", "reserved", "consumed"] },
    },
    include: { paymentList: { select: { id: true, status: true, sourceType: true } } },
  });

  const affectedAutoListIds = new Set<string>();

  for (const claim of existingClaims) {
    if (claim.paymentListId === params.targetPaymentListId) continue;
    if (claim.status === "consumed" || claim.status === "reserved") {
      throw new ConflictError("WEEKLOG_ENTRY_ALREADY_CLAIMED");
    }

    // Absorb claim
    await tx.paymentListEntryClaim.update({
      where: { id: claim.id },
      data: {
        status: "released",
        releasedAt: new Date(),
        releasedReason: params.absorbedByReason,
      },
    });

    // Remove item from source draft list
    await tx.paymentListItem.deleteMany({
      where: {
        workspaceId: params.workspaceId,
        paymentListId: claim.paymentListId,
        weeklogEntryId: claim.weeklogEntryId,
      },
    });

    affectedAutoListIds.add(claim.paymentListId);
  }

  // Update totals / status for affected source lists
  for (const autoListId of affectedAutoListIds) {
    const remainingItems = await tx.paymentListItem.findMany({
      where: { workspaceId: params.workspaceId, paymentListId: autoListId },
    });
    if (remainingItems.length === 0) {
      await tx.paymentList.update({
        where: { id: autoListId },
        data: {
          status: "superseded",
          supersededByPaymentListId: params.targetPaymentListId,
          itemCount: 0,
          sourceDocumentTotal: new Prisma.Decimal(0),
        },
      });
    } else {
      const remainingTotal = remainingItems.reduce(
        (sum, it) => sum.plus(it.totalAmount),
        new Prisma.Decimal(0)
      );
      await tx.paymentList.update({
        where: { id: autoListId },
        data: {
          itemCount: remainingItems.length,
          sourceDocumentTotal: remainingTotal,
        },
      });
    }
  }
}

export async function createAutoDraftPaymentListInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    workspaceId: string;
    weeklogId: string;
    validationId: string;
    actorUserId: string;
  }
) {
  // Idempotency: exactly-once commercial handoff authority is originWeeklogValidationId
  const existing = await tx.paymentList.findFirst({
    where: {
      workspaceId: params.workspaceId,
      originWeeklogValidationId: params.validationId,
      sourceType: "weeklog_auto",
      status: { notIn: ["cancelled", "superseded"] },
    },
    include: { items: true, claims: true },
  });
  if (existing) {
    return existing;
  }

  const validation = await tx.weeklogValidation.findFirst({
    where: { id: params.validationId, workspaceId: params.workspaceId },
  });
  if (!validation || validation.status !== "validated") {
    return null;
  }

  const weeklog = await tx.weeklog.findFirst({
    where: { id: params.weeklogId, workspaceId: params.workspaceId },
    include: { client: { select: { id: true, name: true } } },
  });
  if (!weeklog) return null;

  // Extract frozen approved entries from coverageSnapshot
  const snapshot = validation.coverageSnapshot;
  let candidateEntryIds: string[] = [];
  if (Array.isArray(snapshot)) {
    candidateEntryIds = snapshot.map((c: any) => c.weeklogEntryId || c.entryId || c.id).filter(Boolean);
  } else if (snapshot && typeof snapshot === "object" && Array.isArray((snapshot as any).entries)) {
    candidateEntryIds = (snapshot as any).entries.map((e: any) => e.entryId || e.weeklogEntryId || e.id).filter(Boolean);
  }
  if (!candidateEntryIds.length) return null;

  const entries = await tx.weeklogEntry.findMany({
    where: {
      id: { in: candidateEntryIds },
      workspaceId: params.workspaceId,
      validationStatus: "approved",
    },
    include: { productionOrder: { select: { operationalSiteKey: true } } },
    orderBy: [{ deliveredAt: "asc" }, { id: "asc" }],
  });

  if (!entries.length) return null;

  const currencies = [...new Set(entries.map((e) => e.currencyCode).filter(Boolean))];
  if (currencies.length > 1) {
    throw new ConflictError("CANNOT_CREATE_AUTO_LIST_MULTIPLE_CURRENCIES");
  }
  const currencyCode = currencies[0] || "EUR";

  const total = entries.reduce((sum, entry) => sum.plus(entry.totalAmount), new Prisma.Decimal(0));
  const clientName = weeklog.client?.name || entries[0]?.clientName || "VECTIS Client";
  const listNumber = await allocateNumber(tx, params.workspaceId);

  const list = await tx.paymentList.create({
    data: {
      workspaceId: params.workspaceId,
      listNumber,
      clientId: weeklog.clientId,
      clientName,
      currencyCode,
      status: "draft",
      sourceType: "weeklog_auto",
      originWeeklogId: weeklog.id,
      originWeeklogValidationId: validation.id,
      itemCount: entries.length,
      sourceDocumentTotal: total,
      recognizedTotal: new Prisma.Decimal(0),
      createdBy: params.actorUserId,
    },
  });

  await tx.paymentListItem.createMany({
    data: entries.map((entry) => {
      const vehicleDesc = [entry.brand, entry.model].filter(Boolean).join(" ") || "Véhicule non spécifié";
      const siteLoc = entry.productionOrder?.operationalSiteKey || weeklog.siteKey || "";
      return {
        workspaceId: params.workspaceId,
        paymentListId: list.id,
        weeklogEntryId: entry.id,
        carName: vehicleDesc,
        vehicleDescription: vehicleDesc,
        licensePlate: entry.licensePlate,
        vin: entry.vin,
        technicianUserId: entry.technicianUserId,
        technicianName: entry.technicianName,
        operationalSiteKey: siteLoc,
        serviceLocation: siteLoc,
        servicesSnapshot: entry.servicesSnapshot as Prisma.InputJsonValue,
        totalAmount: entry.totalAmount,
      };
    }),
  });

  await tx.paymentListEntryClaim.createMany({
    data: entries.map((entry) => ({
      workspaceId: params.workspaceId,
      paymentListId: list.id,
      weeklogEntryId: entry.id,
      status: "provisional",
    })),
  });

  const createdItems = await tx.paymentListItem.findMany({
    where: { paymentListId: list.id, workspaceId: params.workspaceId },
    select: { id: true },
  });
  for (const item of createdItems) {
    await projectPaymentListItemInTransaction(tx, params.workspaceId, item.id);
  }

  return list;
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
        sourceType: "manual",
      } });
      if (entries.length) {
        await absorbProvisionalClaimsInTransaction(tx, {
          workspaceId,
          targetPaymentListId: list.id,
          entryIds: entries.map((e) => e.id),
          absorbedByReason: `absorbed_by_manual_list:${list.id}`,
        });
        await tx.paymentListItem.createMany({ data: entries.map((entry) => {
          const vehicleDesc = [entry.brand, entry.model].filter(Boolean).join(" ") || "Véhicule non spécifié";
          const siteLoc = entry.weeklog?.siteKey || "";
          return {
            workspaceId, paymentListId: list.id, weeklogEntryId: entry.id,
            carName: vehicleDesc, vehicleDescription: vehicleDesc,
            licensePlate: entry.licensePlate, vin: entry.vin,
            technicianUserId: entry.technicianUserId, technicianName: entry.technicianName,
            operationalSiteKey: siteLoc, serviceLocation: siteLoc,
            servicesSnapshot: entry.servicesSnapshot as Prisma.InputJsonValue, totalAmount: entry.totalAmount,
          };
        }) });
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
    // The import is the idempotency key for materialisation. Locking it makes
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
      sourceType: "external_import",
      items: { create: imported.items.map((item) => {
        const vehicleDesc = item.reviewedCarName || "Véhicule non spécifié";
        const siteLoc = item.rawPlatform || "";
        return {
          carName: vehicleDesc,
          vehicleDescription: vehicleDesc,
          licensePlate: item.reviewedLicensePlate,
          vin: item.reviewedVin,
          technicianUserId: item.reviewedTechnicianUserId,
          operationalSiteKey: siteLoc,
          serviceLocation: siteLoc,
          servicesSnapshot: item.reviewedServices as Prisma.InputJsonValue,
          totalAmount: item.reviewedTotal!,
        };
      }) },
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

export async function transitionPaymentList(
  ctx: RequestContext,
  id: string,
  target: unknown,
  options?: { isClientAuthorized?: boolean }
) {
  const parsedStatus = z.enum(["ready_for_billing", "under_review", "confronted", "pending", "paid", "cancelled", "superseded"]).safeParse(target);
  if (!parsedStatus.success) throw new ConflictError("LIST_INVALID_STATE_TRANSITION");
  const toStatus = parsedStatus.data as PaymentListStatus;
  if (toStatus === "ready_for_billing") {
    manager(ctx);
  } else if (!options?.isClientAuthorized) {
    manager(ctx);
  }
  const workspaceId = ws(ctx);
  return prisma.$transaction(async (tx) => {
    const list = await tx.paymentList.findFirst({ where: { id, workspaceId }, include: { claims: true, items: true } });
    if (!list) throw new NotFoundError("LIST_NOT_FOUND");
    if (list.status === "paid" && toStatus === "paid") return presentList(list);
    if (list.status === "ready_for_billing" && toStatus === "ready_for_billing") return presentList(list);
    const allowed: Record<string, string[]> = {
      draft: ["ready_for_billing", "under_review", "cancelled", "superseded"],
      ready_for_billing: ["pending", "cancelled"],
      under_review: ["confronted", "cancelled"],
      confronted: ["pending", "cancelled"],
      pending: ["paid"],
      paid: [],
      cancelled: [],
      superseded: [],
    };
    if (!allowed[list.status]?.includes(toStatus)) throw new ConflictError("LIST_INVALID_STATE_TRANSITION");
    if (toStatus === "ready_for_billing") {
      await tx.paymentListEntryClaim.updateMany({
        where: { paymentListId: list.id, workspaceId, status: "provisional" },
        data: { status: "reserved" },
      });
      if (list.recognizedTotal.isZero() && !list.sourceDocumentTotal.isZero()) {
        await tx.paymentList.update({
          where: { id: list.id },
          data: { recognizedTotal: list.sourceDocumentTotal },
        });
      }
    }
    if (toStatus === "pending") {
      const currentRun = await tx.paymentListConfrontationRun.findFirst({
        where: { paymentListId: list.id, workspaceId, status: "completed" },
        orderBy: { sequence: "desc" },
        include: { results: { select: { paymentListItemId: true, status: true, decision: true } } },
      });
      if (!currentRun && list.sourceType !== "manual" && list.sourceType !== "weeklog_auto") {
        throw new ConflictError("LIST_CONFRONTATION_REQUIRED");
      }
      if (currentRun) {
        const itemResults = currentRun.results.filter((result) => result.paymentListItemId !== null);
        const evaluatedItems = new Set(itemResults.map((result) => result.paymentListItemId));
        if (evaluatedItems.size !== list.itemCount || currentRun.results.some((result) => result.status === "ambiguous_match" || result.status === "unmatched_weeklog" || (result.status !== "exact_match" && result.decision === "none"))) {
          throw new ConflictError("LIST_CONFRONTATION_REQUIRED");
        }
        if (currentRun.results.some((result) => result.decision === "contest" || result.decision === "request_rectification")) {
          throw new ConflictError("UNRESOLVED_DISPUTES_BLOCK_PENDING");
        }
      }
      await tx.paymentListEntryClaim.updateMany({ where: { paymentListId: list.id, workspaceId, status: "reserved" }, data: { status: "consumed", consumedAt: new Date() } });
    }
    if (toStatus === "cancelled") {
      await tx.paymentListEntryClaim.updateMany({ where: { paymentListId: list.id, workspaceId, status: { in: ["reserved", "provisional"] } }, data: { status: "released", releasedAt: new Date(), releasedReason: "LIST_CANCELLED" } });
    }
    await tx.paymentList.update({ where: { id: list.id }, data: toStatus === "paid" ? { status: toStatus, paidAt: new Date(), paidBy: ctx.actorUserId } : { status: toStatus } });
    const items = await tx.paymentListItem.findMany({ where: { paymentListId: list.id, workspaceId }, select: { id: true } });
    for (const item of items) await projectPaymentListItemInTransaction(tx, workspaceId, item.id);
    return presentList(await tx.paymentList.findUniqueOrThrow({ where: { id: list.id }, include: { items: true, claims: true } }));
  });
}

async function allocateInvoiceNumber(tx: Prisma.TransactionClient, workspaceId: string): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ currentValue: number }>>(Prisma.sql`
    INSERT INTO tenant_sequence_counters (id, workspace_id, sequence_type, current_value, updated_at)
    VALUES (gen_random_uuid(), ${workspaceId}, 'invoice', 1, NOW())
    ON CONFLICT (workspace_id, sequence_type)
    DO UPDATE SET current_value = tenant_sequence_counters.current_value + 1, updated_at = NOW()
    RETURNING current_value AS "currentValue"
  `);
  const next = rows[0]?.currentValue;
  if (!Number.isInteger(next) || next < 1) throw new ConflictError("INVOICE_NUMBER_EXHAUSTED");
  const year = new Date().getUTCFullYear();
  return `FAC-${year}-${String(next).padStart(5, "0")}`;
}

export async function createInvoiceForPaymentList(
  ctx: RequestContext,
  paymentListId: string,
  payload?: { notes?: string; invoiceNumber?: string; issueDate?: string | Date; dueDate?: string | Date }
) {
  manager(ctx);
  const workspaceId = ws(ctx);

  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ id: string; status: string; invoice_id: string | null }>>(
      Prisma.sql`SELECT id, status, invoice_id FROM payment_lists WHERE id = ${paymentListId} AND workspace_id = ${workspaceId} FOR UPDATE`
    );
    if (!locked) {
      throw new NotFoundError("LIST_NOT_FOUND");
    }

    if (locked.status === "pending" && locked.invoice_id) {
      const existingInvoice = await tx.billingInvoice.findFirst({
        where: { id: locked.invoice_id, workspaceId, deletedAt: null },
      });
      return {
        idempotent: true,
        invoiceId: locked.invoice_id,
        invoice: existingInvoice ? mapBillingInvoice(existingInvoice) : null,
        status: "pending",
      };
    }

    if (locked.status !== "ready_for_billing" && locked.status !== "confronted") {
      throw new ConflictError(
        `LIST_STATUS_INELIGIBLE_FOR_INVOICE: Only ready_for_billing or confronted lists can be invoiced (current: ${locked.status}).`
      );
    }

    const list = await tx.paymentList.findUniqueOrThrow({
      where: { id: paymentListId },
      include: { items: true, claims: true },
    });

    const provisionalClaims = list.claims.filter((c) => c.status === "provisional");
    if (provisionalClaims.length > 0) {
      throw new UnprocessableEntityError(
        "CANNOT_CONSUME_PROVISIONAL_CLAIMS: Only reserved claims can become consumed."
      );
    }

    let invoiceNumber = payload?.invoiceNumber?.trim();
    if (!invoiceNumber) {
      invoiceNumber = await allocateInvoiceNumber(tx, workspaceId);
    }

    const issueDate = payload?.issueDate ? new Date(payload.issueDate) : list.issueDate ?? new Date();
    const dueDate = payload?.dueDate ? new Date(payload.dueDate) : list.dueDate ?? null;
    const effectiveRecognized =
      list.recognizedTotal.isZero() && !list.sourceDocumentTotal.isZero()
        ? list.sourceDocumentTotal
        : list.recognizedTotal;
    const recognizedAmount = Number(effectiveRecognized);

    const billingClient = await tx.billingClient.findFirst({
      where: { id: list.clientId, workspaceId },
    });

    const invoice = await tx.billingInvoice.create({
      data: {
        workspaceId,
        invoiceNumber,
        type: "outgoing",
        billingClientId: billingClient?.id ?? null,
        customerName: list.clientName,
        customerSnapshot: {
          clientId: list.clientId,
          clientName: list.clientName,
        },
        issueDate,
        dueDate,
        totalAmount: recognizedAmount,
        paidAmount: 0,
        remainingAmount: recognizedAmount,
        status: "pending",
        notes: payload?.notes?.trim() || list.notes || null,
        source: "payment_list",
        createdBy: ctx.actorUserId ?? null,
        yearReference: issueDate.getUTCFullYear(),
        metadata: {
          paymentListId: list.id,
          paymentListNumber: list.listNumber,
          currency: list.currencyCode,
          originWeeklogId: list.originWeeklogId,
          originWeeklogValidationId: list.originWeeklogValidationId,
          sourceType: list.sourceType,
          itemCount: list.items.length,
          items: list.items.map((i: any) => ({
            id: i.id,
            carName: i.carName,
            licensePlate: i.licensePlate,
            vin: i.vin,
            technicianName: i.technicianName,
            operationalSiteKey: i.operationalSiteKey,
            totalAmount: i.totalAmount?.toString?.() ?? String(i.totalAmount),
          })),
        },
      },
    });

    await tx.paymentList.update({
      where: { id: list.id },
      data: {
        status: "pending",
        invoiceId: invoice.id,
        recognizedTotal: effectiveRecognized,
        issueDate,
        dueDate,
      },
    });

    const now = new Date();
    await tx.paymentListEntryClaim.updateMany({
      where: {
        workspaceId,
        paymentListId: list.id,
        status: "reserved",
      },
      data: {
        status: "consumed",
        consumedAt: now,
        releasedAt: null,
      },
    });

    return {
      idempotent: false,
      invoiceId: invoice.id,
      invoice: mapBillingInvoice(invoice),
      status: "pending",
    };
  });
}

export async function associateInvoiceForPaymentList(
  ctx: RequestContext,
  paymentListId: string,
  payload: { invoiceId: string }
) {
  manager(ctx);
  const workspaceId = ws(ctx);
  const targetInvoiceId = payload.invoiceId?.trim();
  if (!targetInvoiceId) {
    throw new UnprocessableEntityError("INVOICE_ID_REQUIRED");
  }

  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<Array<{ id: string; status: string; invoice_id: string | null }>>(
      Prisma.sql`SELECT id, status, invoice_id FROM payment_lists WHERE id = ${paymentListId} AND workspace_id = ${workspaceId} FOR UPDATE`
    );
    if (!locked) {
      throw new NotFoundError("LIST_NOT_FOUND");
    }

    if (locked.status === "pending" && locked.invoice_id === targetInvoiceId) {
      const existingInvoice = await tx.billingInvoice.findFirst({
        where: { id: targetInvoiceId, workspaceId, deletedAt: null },
      });
      return {
        idempotent: true,
        invoiceId: targetInvoiceId,
        invoice: existingInvoice ? mapBillingInvoice(existingInvoice) : null,
        status: "pending",
      };
    }

    if (locked.invoice_id && locked.invoice_id !== targetInvoiceId) {
      throw new ConflictError(
        `LIST_ALREADY_INVOICED: List is already linked to another invoice (${locked.invoice_id}).`
      );
    }

    if (locked.status !== "ready_for_billing" && locked.status !== "confronted") {
      throw new ConflictError(
        `LIST_STATUS_INELIGIBLE_FOR_INVOICE: Only ready_for_billing or confronted lists can be invoiced (current: ${locked.status}).`
      );
    }

    const invoice = await tx.billingInvoice.findFirst({
      where: { id: targetInvoiceId, workspaceId, deletedAt: null },
    });
    if (!invoice) {
      throw new NotFoundError("INVOICE_NOT_FOUND");
    }

    const list = await tx.paymentList.findUniqueOrThrow({
      where: { id: paymentListId },
      include: { items: true, claims: true },
    });

    const snapshot = invoice.customerSnapshot as Record<string, any> | null;
    const invoiceClientId = snapshot?.clientId || invoice.billingClientId;
    if (invoiceClientId && invoiceClientId !== list.clientId) {
      throw new UnprocessableEntityError("INVOICE_CLIENT_MISMATCH: Invoice belongs to a different client.");
    }
    if (!invoiceClientId && invoice.customerName && invoice.customerName.trim().toLowerCase() !== list.clientName.trim().toLowerCase()) {
      throw new UnprocessableEntityError("INVOICE_CLIENT_MISMATCH: Invoice belongs to a different client.");
    }

    const otherList = await tx.paymentList.findFirst({
      where: {
        workspaceId,
        invoiceId: invoice.id,
        id: { not: list.id },
        status: { notIn: ["cancelled", "superseded"] },
      },
    });
    if (otherList) {
      throw new ConflictError(
        `INVOICE_ALREADY_LINKED: Invoice is already associated with list ${otherList.listNumber}.`
      );
    }

    const provisionalClaims = list.claims.filter((c) => c.status === "provisional");
    if (provisionalClaims.length > 0) {
      throw new UnprocessableEntityError(
        "CANNOT_CONSUME_PROVISIONAL_CLAIMS: Only reserved claims can become consumed."
      );
    }

    await tx.paymentList.update({
      where: { id: list.id },
      data: {
        status: "pending",
        invoiceId: invoice.id,
      },
    });

    if (invoice.status === "draft") {
      await tx.billingInvoice.update({
        where: { id: invoice.id },
        data: { status: "pending" },
      });
    }

    const now = new Date();
    await tx.paymentListEntryClaim.updateMany({
      where: {
        workspaceId,
        paymentListId: list.id,
        status: "reserved",
      },
      data: {
        status: "consumed",
        consumedAt: now,
        releasedAt: null,
      },
    });

    return {
      idempotent: false,
      invoiceId: invoice.id,
      invoice: mapBillingInvoice(invoice),
      status: "pending",
    };
  });
}

