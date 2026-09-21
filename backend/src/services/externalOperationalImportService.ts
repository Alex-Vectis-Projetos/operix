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
