import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableEntityError, validateTechnicianAssignment } from "../lib/objectAuth.js";
import type { RequestContext } from "../middleware/requestContext.js";
import {
  aiImportExtractionProvider,
  type ImportDocumentStorage,
  type ImportExtractionProvider,
  minioImportDocumentStorage,
  operationalImportStorageKey,
  sha256,
  validateImportFile,
} from "./externalImportAdapters.js";
import { ImportPipelineError, parseReviewedDecimal } from "./externalListImportService.js";
import { operationalWeekOf } from "../lib/weekUtils.js";

type ServiceDependencies = { storage?: ImportDocumentStorage; extraction?: ImportExtractionProvider };

const reviewedServicesSchema = z.array(z.object({
  code: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  quantity: z.union([z.number().positive(), z.string().regex(/^\d+(\.\d+)?$/)]).optional(),
  amount: z.union([z.number().positive(), z.string().regex(/^\d+(\.\d+)?$/)]).optional(),
  unitPrice: z.union([z.number().positive(), z.string().regex(/^\d+(\.\d+)?$/)]).optional(),
}).passthrough().refine((service) => Boolean(service.code || service.description), "SERVICE_IDENTIFIER_REQUIRED")).min(1).max(100);

const operationalRowReviewSchema = z.object({
  reviewedLicensePlate: z.string().max(64).nullable().optional(),
  reviewedVin: z.string().max(64).nullable().optional(),
  reviewedCarName: z.string().trim().max(500).nullable().optional(),
  reviewedClientId: z.string().uuid().nullable().optional(),
  reviewedCurrencyCode: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  reviewedOperationalSiteKey: z.string().trim().min(1).max(200).nullable().optional(),
  reviewedTechnicianUserId: z.string().uuid().nullable().optional(),
  reviewedDeliveredAt: z.coerce.date().nullable().optional(),
  reviewedServices: reviewedServicesSchema.nullable().optional(),
  reviewedTotal: z.string().trim().max(64).nullable().optional(),
}).strict();

function workspaceId(ctx: RequestContext): string {
  if (!ctx.activeWorkspaceId) throw new ForbiddenError("Workspace ativo não definido.");
  return ctx.activeWorkspaceId;
}

function assertImportManager(ctx: RequestContext): void {
  if (ctx.platformRole === "platform_admin" || ctx.membershipRole === "owner" || ctx.membershipRole === "admin") return;
  throw new ForbiddenError("IMPORT_FORBIDDEN_ROLE");
}

function normalizePlate(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!normalized || normalized.length < 5 || normalized.length > 16) throw new UnprocessableEntityError("REVIEWED_LICENSE_PLATE_INVALID");
  return normalized;
}

function normalizeVin(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!/^[A-HJ-NPR-Z0-9]{11,17}$/.test(normalized)) throw new UnprocessableEntityError("REVIEWED_VIN_INVALID");
  return normalized;
}

function completeOperationalRow(row: {
  reviewedLicensePlate: string | null;
  reviewedVin: string | null;
  reviewedClientId: string | null;
  reviewedCurrencyCode: string | null;
  reviewedOperationalSiteKey: string | null;
  reviewedTechnicianUserId: string | null;
  reviewedDeliveredAt: Date | null;
  reviewedServices: Prisma.JsonValue | null;
  reviewedTotal: Prisma.Decimal | null;
}): boolean {
  return Boolean(
    (row.reviewedLicensePlate || row.reviewedVin) && row.reviewedClientId && row.reviewedCurrencyCode &&
    row.reviewedOperationalSiteKey && row.reviewedTechnicianUserId && row.reviewedDeliveredAt &&
    row.reviewedServices && row.reviewedTotal?.isPositive(),
  );
}

async function refreshImportReviewStatus(importId: string, ws: string) {
  const record = await prisma.externalOperationalImport.findFirstOrThrow({ where: { id: importId, workspaceId: ws }, include: { items: true } });
  const complete = record.items.length > 0 && record.items.every(completeOperationalRow);
  return prisma.externalOperationalImport.update({ where: { id: record.id }, data: { status: complete ? "reviewed" : "under_review" }, include: { items: true } });
}

async function persistOperationalExtraction(
  importId: string,
  ws: string,
  extracted: Awaited<ReturnType<ImportExtractionProvider["extractOperationalDocument"]>>,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.externalOperationalImportItem.count({ where: { importId, workspaceId: ws } });
    if (existing) throw new ConflictError("IMPORT_EXTRACTION_ROWS_ALREADY_EXIST");
    await tx.externalOperationalImportItem.createMany({ data: extracted.rows.map((row) => ({
      workspaceId: ws,
      importId,
      rawLicensePlate: row.rawLicensePlate ?? null,
      rawVin: row.rawVin ?? null,
      rawCarName: row.rawCarName ?? null,
      rawClientName: row.rawClientName ?? null,
      rawCurrencyCode: row.rawCurrencyCode ?? null,
      rawOperationalSiteKey: row.rawOperationalSiteKey ?? null,
      rawTechnician: row.rawTechnician ?? null,
      rawWeek: row.rawWeek ?? null,
      rawDeliveredAtText: row.rawDeliveredAtText ?? null,
      rawServices: row.rawServices as Prisma.InputJsonValue | undefined,
      rawTotalText: row.rawTotalText ?? null,
      fieldConfidence: row.fieldConfidence as Prisma.InputJsonValue | undefined,
      status: "staged",
    })) });
    return tx.externalOperationalImport.update({
      where: { id: importId },
      data: { rawOcrResult: extracted.raw as Prisma.InputJsonValue, status: "extracted", errorMessage: null },
      include: { items: true },
    });
  });
}

export async function createExternalOperationalImport(
  ctx: RequestContext,
  input: { fileName: string; mimeType: string; bytes: Buffer },
  dependencies: ServiceDependencies = {},
) {
  assertImportManager(ctx);
  const ws = workspaceId(ctx);
  const validated = validateImportFile(input);
  const storage = dependencies.storage ?? minioImportDocumentStorage;
  const extraction = dependencies.extraction ?? aiImportExtractionProvider;
  const id = randomUUID();
  const header = await prisma.externalOperationalImport.create({ data: { id, workspaceId: ws, fileName: validated.fileName, uploadedBy: ctx.actorUserId, status: "uploaded" } });
  const key = operationalImportStorageKey(ws, id, validated.fileName);
  let promoted = false;
  try {
    await storage.put(key, input.bytes, validated.mimeType);
    promoted = true;
    await prisma.externalOperationalImport.update({ where: { id }, data: { storagePath: key, fileSha256: sha256(input.bytes), mimeType: validated.mimeType, sizeBytes: input.bytes.length, status: "extracting" } });
    const extracted = await extraction.extractOperationalDocument({ bytes: input.bytes, mimeType: validated.mimeType, fileName: validated.fileName });
    return await persistOperationalExtraction(id, ws, extracted);
  } catch (error) {
    await prisma.externalOperationalImport.updateMany({ where: { id, workspaceId: ws }, data: { status: "failed", errorMessage: promoted ? "IMPORT_EXTRACTION_OR_PERSISTENCE_FAILED" : "IMPORT_STORAGE_PROMOTION_FAILED" } });
    if (error instanceof ConflictError) throw error;
    throw new ImportPipelineError(header.id, promoted ? "IMPORT_EXTRACTION_FAILED" : "IMPORT_STORAGE_PROMOTION_FAILED");
  }
}

/** Re-extraction is permitted only from a failed, empty staging import. */
export async function retryExternalOperationalExtraction(
  ctx: RequestContext,
  importId: string,
  dependencies: ServiceDependencies = {},
) {
  assertImportManager(ctx);
  const ws = workspaceId(ctx);
  const storage = dependencies.storage ?? minioImportDocumentStorage;
  const extraction = dependencies.extraction ?? aiImportExtractionProvider;
  const current = await prisma.externalOperationalImport.findFirst({
    where: { id: importId, workspaceId: ws },
    include: { items: { select: { id: true } } },
  });
  if (!current) throw new NotFoundError("EXTERNAL_OPERATIONAL_IMPORT_NOT_FOUND");
  if (current.items.length) throw new ConflictError("IMPORT_RETRY_ROWS_ALREADY_EXIST");
  if (!current.storagePath || !current.mimeType) throw new ConflictError("IMPORT_RETRY_PROVENANCE_UNAVAILABLE");
  const claimed = await prisma.externalOperationalImport.updateMany({
    where: { id: current.id, workspaceId: ws, status: "failed" },
    data: { status: "extracting", errorMessage: null },
  });
  if (claimed.count !== 1) throw new ConflictError("IMPORT_RETRY_STATE_INVALID");
  try {
    const bytes = await storage.read(current.storagePath);
    const extracted = await extraction.extractOperationalDocument({
      bytes,
      mimeType: current.mimeType as "application/pdf" | "image/png" | "image/jpeg",
      fileName: current.fileName,
    });
    return await persistOperationalExtraction(current.id, ws, extracted);
  } catch (error) {
    await prisma.externalOperationalImport.updateMany({
      where: { id: current.id, workspaceId: ws, status: "extracting" },
      data: { status: "failed", errorMessage: "IMPORT_RETRY_EXTRACTION_FAILED" },
    });
    if (error instanceof ConflictError) throw error;
    throw new ImportPipelineError(current.id, "IMPORT_RETRY_EXTRACTION_FAILED");
  }
}

export async function getExternalOperationalImport(ctx: RequestContext, importId: string) {
  assertImportManager(ctx);
  const record = await prisma.externalOperationalImport.findFirst({ where: { id: importId, workspaceId: workspaceId(ctx) }, include: { items: { include: { reviewedClient: true } } } });
  if (!record) throw new NotFoundError("EXTERNAL_OPERATIONAL_IMPORT_NOT_FOUND");
  return record;
}

export async function reviewExternalOperationalImport(
  ctx: RequestContext,
  importId: string,
  input: { rows: Array<{ id: string; patch: unknown }> },
) {
  assertImportManager(ctx);
  const ws = workspaceId(ctx);
  const current = await prisma.externalOperationalImport.findFirst({ where: { id: importId, workspaceId: ws } });
  if (!current) throw new NotFoundError("EXTERNAL_OPERATIONAL_IMPORT_NOT_FOUND");
  if (["failed", "discarded", "committed"].includes(current.status)) throw new ConflictError("IMPORT_REVIEW_STATE_INVALID");
  await prisma.$transaction(async (tx) => {
    for (const requestedRow of input.rows) {
      const row = await tx.externalOperationalImportItem.findFirst({ where: { id: requestedRow.id, importId: current.id, workspaceId: ws } });
      if (!row) throw new NotFoundError("IMPORT_ROW_NOT_FOUND");
      const patch = operationalRowReviewSchema.parse(requestedRow.patch);
      if (patch.reviewedClientId) {
        const client = await tx.client.findFirst({ where: { id: patch.reviewedClientId, workspaceId: ws, deletedAt: null }, select: { id: true } });
        if (!client) throw new UnprocessableEntityError("REVIEWED_CLIENT_NOT_IN_WORKSPACE");
      }
      const assigned = patch.reviewedTechnicianUserId === undefined || patch.reviewedTechnicianUserId === null
        ? undefined
        : await validateTechnicianAssignment(ctx, patch.reviewedTechnicianUserId);
      const reviewedTotal = patch.reviewedTotal === undefined ? undefined : patch.reviewedTotal === null ? null : parseReviewedDecimal(patch.reviewedTotal);
      const data: Prisma.ExternalOperationalImportItemUncheckedUpdateInput = {
        reviewedBy: ctx.actorUserId,
        reviewedAt: new Date(),
        ...(patch.reviewedLicensePlate !== undefined ? { reviewedLicensePlate: normalizePlate(patch.reviewedLicensePlate) } : {}),
        ...(patch.reviewedVin !== undefined ? { reviewedVin: normalizeVin(patch.reviewedVin) } : {}),
        ...(patch.reviewedCarName !== undefined ? { reviewedCarName: patch.reviewedCarName } : {}),
        ...(patch.reviewedClientId !== undefined ? { reviewedClientId: patch.reviewedClientId } : {}),
        ...(patch.reviewedCurrencyCode !== undefined ? { reviewedCurrencyCode: patch.reviewedCurrencyCode } : {}),
        ...(patch.reviewedOperationalSiteKey !== undefined ? { reviewedOperationalSiteKey: patch.reviewedOperationalSiteKey?.trim() } : {}),
        ...(patch.reviewedTechnicianUserId !== undefined ? { reviewedTechnicianUserId: assigned?.technicianUserId ?? patch.reviewedTechnicianUserId } : {}),
        ...(patch.reviewedDeliveredAt !== undefined ? { reviewedDeliveredAt: patch.reviewedDeliveredAt } : {}),
        ...(patch.reviewedServices !== undefined ? { reviewedServices: patch.reviewedServices === null ? Prisma.JsonNull : patch.reviewedServices as Prisma.InputJsonValue } : {}),
        ...(reviewedTotal !== undefined ? { reviewedTotal } : {}),
      };
      const prospective = { ...row, ...data } as typeof row;
      await tx.externalOperationalImportItem.update({ where: { id: row.id }, data: { ...data, status: completeOperationalRow(prospective) ? "reviewed" : "staged" } });
    }
  });
  return refreshImportReviewStatus(current.id, ws);
}

export async function discardExternalOperationalImport(ctx: RequestContext, importId: string) {
  assertImportManager(ctx);
  const result = await prisma.externalOperationalImport.updateMany({ where: { id: importId, workspaceId: workspaceId(ctx), status: { notIn: ["committed", "discarded"] } }, data: { status: "discarded" } });
  if (!result.count) throw new NotFoundError("EXTERNAL_OPERATIONAL_IMPORT_NOT_FOUND_OR_FINALIZED");
}

type ReviewedOperationalRow = {
  id: string;
  reviewedLicensePlate: string | null;
  reviewedVin: string | null;
  reviewedCarName: string | null;
  reviewedClientId: string | null;
  reviewedCurrencyCode: string | null;
  reviewedOperationalSiteKey: string | null;
  reviewedTechnicianUserId: string | null;
  reviewedDeliveredAt: Date | null;
  reviewedServices: Prisma.JsonValue | null;
  reviewedTotal: Prisma.Decimal | null;
};

type ExternalMaterialization = {
  importId: string;
  status: "committed";
  idempotent: boolean;
  materializationId: string;
  weeklogId: string | null;
  weeklogs: Array<{ id: string; startsOn: Date; endsOn: Date; clientId: string; siteKey: string; status: string }>;
  entries: Array<{
    id: string;
    weeklogId: string;
    sourceType: string;
    productionOrderId: string | null;
    externalImportItemId: string | null;
    executionSequence: number;
    validationStatus: string;
  }>;
  validation: { id: string; weeklogId: string; validationSequence: number; validationMethod: string | null; coverageSnapshot: Prisma.JsonValue } | null;
  validations: Array<{ id: string; weeklogId: string; validationSequence: number; validationMethod: string | null; coverageSnapshot: Prisma.JsonValue }>;
};

function isReviewedServices(value: Prisma.JsonValue | null): value is Prisma.JsonArray {
  return Array.isArray(value) && value.length > 0 && value.every((service) =>
    service !== null && typeof service === "object" && !Array.isArray(service) &&
    (typeof (service as Record<string, unknown>).code === "string" || typeof (service as Record<string, unknown>).description === "string"),
  );
}

function externalEntryDto(entry: {
  id: string; weeklogId: string; sourceType: string; productionOrderId: string | null;
  externalImportItemId: string | null; executionSequence: number; validationStatus: string;
}) {
  return {
    id: entry.id,
    weeklogId: entry.weeklogId,
    sourceType: entry.sourceType,
    productionOrderId: entry.productionOrderId,
    externalImportItemId: entry.externalImportItemId,
    executionSequence: entry.executionSequence,
    validationStatus: entry.validationStatus,
  };
}

function externalValidationDto(validation: {
  id: string; weeklogId: string; validationSequence: number; validationMethod: string | null; coverageSnapshot: Prisma.JsonValue;
}) {
  return {
    id: validation.id,
    weeklogId: validation.weeklogId,
    validationSequence: validation.validationSequence,
    validationMethod: validation.validationMethod,
    coverageSnapshot: validation.coverageSnapshot,
  };
}

async function readCommittedExternalMaterialization(
  tx: Prisma.TransactionClient,
  ws: string,
  importId: string,
): Promise<ExternalMaterialization> {
  const imported = await tx.externalOperationalImport.findFirst({
    where: { id: importId, workspaceId: ws, status: "committed" },
    include: { items: { select: { id: true } } },
  });
  if (!imported) throw new ConflictError("IMPORT_MATERIALIZATION_NOT_COMMITTED");

  const entries = await tx.weeklogEntry.findMany({
    where: { workspaceId: ws, externalImportItemId: { in: imported.items.map((item) => item.id) } },
    include: { weeklog: { select: { id: true, startsOn: true, endsOn: true, clientId: true, siteKey: true, status: true } } },
    orderBy: [{ deliveredAt: "asc" }, { id: "asc" }],
  });
  if (entries.length !== imported.items.length) throw new ConflictError("IMPORT_COMMITTED_MATERIALIZATION_INCOMPLETE");

  const weeklogs = [...new Map(entries.map((entry) => [entry.weeklog.id, entry.weeklog])).values()]
    .sort((left, right) => left.startsOn.getTime() - right.startsOn.getTime() || left.id.localeCompare(right.id));
  const candidateValidations = await tx.weeklogValidation.findMany({
    where: { workspaceId: ws, weeklogId: { in: weeklogs.map((weeklog) => weeklog.id) }, validationMethod: "external_import_review" },
    orderBy: [{ weeklogId: "asc" }, { validationSequence: "asc" }],
  });
  const validations = candidateValidations
    .filter((validation) => {
      const snapshot = validation.coverageSnapshot as Record<string, unknown> | null;
      return snapshot?.sourceType === "external_import" && snapshot.sourceImportId === importId;
    })
    .map(externalValidationDto);
  if (validations.length !== weeklogs.length) throw new ConflictError("IMPORT_COMMITTED_VALIDATION_INCOMPLETE");

  return {
    importId,
    status: "committed",
    idempotent: true,
    materializationId: importId,
    weeklogId: weeklogs[0]?.id ?? null,
    weeklogs,
    entries: entries.map(externalEntryDto),
    validation: validations[0] ?? null,
    validations,
  };
}

async function validateReviewedOperationalRows(
  tx: Prisma.TransactionClient,
  ws: string,
  rows: ReviewedOperationalRow[],
) {
  if (!rows.length || !rows.every(completeOperationalRow)) {
    throw new UnprocessableEntityError("IMPORT_REVIEW_INCOMPLETE");
  }

  const workspace = await tx.workspace.findUnique({ where: { id: ws }, select: { timezone: true } });
  if (!workspace) throw new NotFoundError("WORKSPACE_NOT_FOUND");
  const resolved: Array<ReviewedOperationalRow & { clientName: string; technicianName: string; weekInfo: ReturnType<typeof operationalWeekOf> }> = [];

  for (const row of rows) {
    if (!row.reviewedClientId || !row.reviewedTechnicianUserId || !row.reviewedDeliveredAt || !row.reviewedCurrencyCode ||
      !row.reviewedOperationalSiteKey || !row.reviewedTotal || !isReviewedServices(row.reviewedServices)) {
      throw new UnprocessableEntityError("IMPORT_REVIEW_INCOMPLETE");
    }
    if (!/^[A-Z]{3}$/.test(row.reviewedCurrencyCode) || !row.reviewedTotal.isPositive()) {
      throw new UnprocessableEntityError("IMPORT_REVIEWED_VALUES_INVALID");
    }
    // Recheck vehicle identity as it is a security-sensitive reviewed value.
    normalizePlate(row.reviewedLicensePlate);
    normalizeVin(row.reviewedVin);
    if (!row.reviewedLicensePlate && !row.reviewedVin) throw new UnprocessableEntityError("REVIEWED_VEHICLE_IDENTIFIER_REQUIRED");

    const [client, technician] = await Promise.all([
      tx.client.findFirst({ where: { id: row.reviewedClientId, workspaceId: ws, deletedAt: null }, select: { id: true, name: true } }),
      tx.appUser.findFirst({
        where: { authUserId: row.reviewedTechnicianUserId },
        include: { user: { select: { fullName: true, isActive: true } }, memberships: { where: { workspaceId: ws, status: "active" }, select: { id: true } } },
      }),
    ]);
    if (!client) throw new UnprocessableEntityError("REVIEWED_CLIENT_NOT_IN_WORKSPACE");
    if (!technician?.user.isActive) throw new ForbiddenError("REVIEWED_TECHNICIAN_NOT_ACTIVE");
    const isWorkspaceOwner = await tx.workspace.findFirst({ where: { id: ws, ownerUserId: technician.id }, select: { id: true } });
    if (!technician.memberships.length && !isWorkspaceOwner) throw new ForbiddenError("REVIEWED_TECHNICIAN_NOT_IN_WORKSPACE");

    resolved.push({
      ...row,
      clientName: client.name,
      technicianName: technician.name || technician.user.fullName || "",
      weekInfo: operationalWeekOf(row.reviewedDeliveredAt, workspace.timezone || "UTC"),
    });
  }
  return resolved;
}

/**
 * The only authority that may approve external-import entries.  It locks the
 * import and materializes reviewed rows atomically; no production order,
 * service order, payment list, claim, or financial projection is created.
 */
export async function commitReviewedExternalOperationalImport(ctx: RequestContext, importId: string): Promise<ExternalMaterialization> {
  assertImportManager(ctx);
  const ws = workspaceId(ctx);

  return prisma.$transaction(async (tx) => {
    const lockedImports: Array<{ id: string }> = await tx.$queryRaw`
      SELECT id FROM external_operational_imports
      WHERE id = ${importId} AND workspace_id = ${ws}
      FOR UPDATE
    `;
    if (!lockedImports.length) {
      const foreignImport = await tx.externalOperationalImport.findUnique({ where: { id: importId }, select: { workspaceId: true } });
      if (foreignImport) throw new ForbiddenError("EXTERNAL_OPERATIONAL_IMPORT_CROSS_TENANT_FORBIDDEN");
      throw new NotFoundError("EXTERNAL_OPERATIONAL_IMPORT_NOT_FOUND");
    }

    const imported = await tx.externalOperationalImport.findFirstOrThrow({
      where: { id: importId, workspaceId: ws },
      include: { items: { orderBy: { id: "asc" } } },
    });
    if (imported.status === "committed") return readCommittedExternalMaterialization(tx, ws, importId);
    if (imported.status !== "reviewed") throw new ConflictError("IMPORT_NOT_REVIEWED");
    if (!imported.fileSha256) throw new UnprocessableEntityError("IMPORT_PROVENANCE_SHA256_REQUIRED");

    const reviewedRows = await validateReviewedOperationalRows(tx, ws, imported.items);
    const grouped = new Map<string, typeof reviewedRows>();
    for (const row of reviewedRows) {
      const key = [row.weekInfo.startsOn.toISOString(), row.reviewedClientId, row.reviewedOperationalSiteKey].join("|");
      const rows = grouped.get(key) ?? [];
      rows.push(row);
      grouped.set(key, rows);
    }

    const materializedWeeklogs: ExternalMaterialization["weeklogs"] = [];
    const materializedEntries: ExternalMaterialization["entries"] = [];
    const materializedValidations: NonNullable<ExternalMaterialization["validation"]>[] = [];
    const now = new Date();

    for (const [, rows] of [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const first = rows[0]!;
      const weeklog = await tx.weeklog.upsert({
        where: { workspaceId_startsOn_clientId_siteKey: { workspaceId: ws, startsOn: first.weekInfo.startsOn, clientId: first.reviewedClientId!, siteKey: first.reviewedOperationalSiteKey! } },
        create: {
          workspaceId: ws,
          startsOn: first.weekInfo.startsOn,
          endsOn: first.weekInfo.endsOn,
          clientId: first.reviewedClientId!,
          siteKey: first.reviewedOperationalSiteKey!,
          timezone: first.weekInfo.timezone,
          week: first.weekInfo.week,
          weekNumber: first.weekInfo.weekNumber,
          yearReference: first.weekInfo.yearReference,
          status: "open",
        },
        update: {},
      });
      const lockedWeeklogs: Array<{ id: string; status: string }> = await tx.$queryRaw`
        SELECT id, status FROM weeklogs WHERE id = ${weeklog.id} AND workspace_id = ${ws} FOR UPDATE
      `;
      if (!lockedWeeklogs.length) throw new NotFoundError("WEEKLOG_NOT_FOUND");
      if (lockedWeeklogs[0]!.status === "pending_validation") throw new ConflictError("EXTERNAL_IMPORT_WEEKLOG_PENDING_VALIDATION");

      const createdEntries = [] as Array<{ id: string; weeklogId: string; sourceType: string; productionOrderId: string | null; externalImportItemId: string | null; executionSequence: number; validationStatus: string; deliveredAt: Date }>;
      for (const row of rows.sort((left, right) => left.reviewedDeliveredAt!.getTime() - right.reviewedDeliveredAt!.getTime() || left.id.localeCompare(right.id))) {
        const entry = await tx.weeklogEntry.create({
          data: {
            weeklogId: weeklog.id,
            workspaceId: ws,
            sourceType: "external_import",
            productionOrderId: null,
            externalImportItemId: row.id,
            executionSequence: 1,
            budgetId: null,
            budgetRevisionId: null,
            legacyServiceOrderId: null,
            technicianUserId: row.reviewedTechnicianUserId!,
            technicianName: row.technicianName,
            clientId: row.reviewedClientId!,
            clientName: row.clientName,
            brand: null,
            model: row.reviewedCarName,
            color: null,
            licensePlate: row.reviewedLicensePlate,
            vin: row.reviewedVin,
            servicesSnapshot: row.reviewedServices as Prisma.InputJsonValue,
            totalAmount: row.reviewedTotal!,
            currencyCode: row.reviewedCurrencyCode!,
            deliveredAt: row.reviewedDeliveredAt!,
            validationStatus: "pending",
          },
        });
        createdEntries.push(entry);
      }

      const latestValidation = await tx.weeklogValidation.findFirst({
        where: { workspaceId: ws, weeklogId: weeklog.id },
        orderBy: { validationSequence: "desc" },
        select: { validationSequence: true },
      });
      const coverageSnapshot = {
        schemaVersion: "1.0",
        sourceType: "external_import",
        sourceImportId: imported.id,
        sha256: imported.fileSha256,
        entries: createdEntries
          .sort((left, right) => left.deliveredAt.getTime() - right.deliveredAt.getTime() || left.id.localeCompare(right.id))
          .map((entry) => ({ entryId: entry.id, externalImportItemId: entry.externalImportItemId, executionSequence: 1, sourceType: "external_import" })),
      };
      const validation = await tx.weeklogValidation.create({
        data: {
          weeklogId: weeklog.id,
          workspaceId: ws,
          validationSequence: (latestValidation?.validationSequence ?? 0) + 1,
          status: "validated",
          submittedAt: now,
          submittedBy: ctx.actorUserId,
          validatorUserId: ctx.actorUserId,
          validationMethod: "external_import_review",
          coverageSnapshot,
          auditTrail: [{ action: "external_import_review_committed", actorUserId: ctx.actorUserId, sourceImportId: imported.id, timestamp: now.toISOString() }],
          validatedAt: now,
        },
      });
      await tx.weeklogEntry.updateMany({
        where: { id: { in: createdEntries.map((entry) => entry.id) }, workspaceId: ws, validationStatus: "pending" },
        data: { validationStatus: "approved", reviewedAt: now, reviewerUserId: ctx.actorUserId },
      });
      const finalizedWeeklog = await tx.weeklog.update({ where: { id: weeklog.id }, data: { status: "validated" }, select: { id: true, startsOn: true, endsOn: true, clientId: true, siteKey: true, status: true } });
      materializedWeeklogs.push(finalizedWeeklog);
      materializedEntries.push(...createdEntries.map((entry) => externalEntryDto({ ...entry, validationStatus: "approved" })));
      materializedValidations.push(externalValidationDto(validation));
    }

    await tx.externalOperationalImport.update({ where: { id: imported.id }, data: { status: "committed" } });
    materializedWeeklogs.sort((left, right) => left.startsOn.getTime() - right.startsOn.getTime() || left.id.localeCompare(right.id));
    materializedEntries.sort((left, right) => left.weeklogId.localeCompare(right.weeklogId) || left.id.localeCompare(right.id));
    materializedValidations.sort((left, right) => left.weeklogId.localeCompare(right.weeklogId) || left.validationSequence - right.validationSequence);
    return {
      importId: imported.id,
      status: "committed",
      idempotent: false,
      materializationId: imported.id,
      weeklogId: materializedWeeklogs[0]?.id ?? null,
      weeklogs: materializedWeeklogs,
      entries: materializedEntries,
      validation: materializedValidations[0] ?? null,
      validations: materializedValidations,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}
