import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableEntityError } from "../lib/objectAuth.js";
import type { RequestContext } from "../middleware/requestContext.js";
import {
  aiImportExtractionProvider,
  type ImportDocumentStorage,
  type ImportExtractionProvider,
  listImportStorageKey,
  minioImportDocumentStorage,
  sha256,
  type SupportedImportMimeType,
  validateImportFile,
} from "./externalImportAdapters.js";

type ServiceDependencies = {
  storage?: ImportDocumentStorage;
  extraction?: ImportExtractionProvider;
};

export class ImportPipelineError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly importId: string;
  constructor(importId: string, code: string, statusCode = 503) {
    super(code);
    this.name = "ImportPipelineError";
    this.importId = importId;
    this.code = code;
    this.statusCode = statusCode;
  }
}

const reviewServicesSchema = z.array(z.object({
  code: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  quantity: z.union([z.number().positive(), z.string().regex(/^\d+(\.\d+)?$/)]).optional(),
  amount: z.union([z.number().positive(), z.string().regex(/^\d+(\.\d+)?$/)]).optional(),
  unitPrice: z.union([z.number().positive(), z.string().regex(/^\d+(\.\d+)?$/)]).optional(),
}).passthrough().refine((service) => Boolean(service.code || service.description), "SERVICE_IDENTIFIER_REQUIRED")).min(1).max(100);

const listRowReviewSchema = z.object({
  reviewedLicensePlate: z.string().max(64).nullable().optional(),
  reviewedVin: z.string().max(64).nullable().optional(),
  reviewedCarName: z.string().trim().max(500).nullable().optional(),
  reviewedServices: reviewServicesSchema.nullable().optional(),
  reviewedTotal: z.string().trim().max(64).nullable().optional(),
}).strict();

const listHeaderReviewSchema = z.object({
  reviewedClientId: z.string().uuid().nullable().optional(),
  reviewedCurrencyCode: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
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

export function parseReviewedDecimal(value: string): Prisma.Decimal {
  const text = value.replace(/\s/g, "").replace(/[^0-9,.-]/g, "");
  if (!text || text.startsWith("-") || text.includes("-", 1)) throw new UnprocessableEntityError("REVIEWED_TOTAL_INVALID");
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  const decimalIndex = Math.max(lastComma, lastDot);
  let normalized: string;
  if (decimalIndex >= 0) {
    const integer = text.slice(0, decimalIndex).replace(/[,.]/g, "");
    const fraction = text.slice(decimalIndex + 1);
    normalized = `${integer}.${fraction}`;
  } else {
    normalized = text;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) throw new UnprocessableEntityError("REVIEWED_TOTAL_INVALID");
  const decimal = new Prisma.Decimal(normalized);
  if (!decimal.isPositive()) throw new UnprocessableEntityError("REVIEWED_TOTAL_MUST_BE_POSITIVE");
  return decimal;
}

function isCompleteRow(row: {
  reviewedLicensePlate: string | null;
  reviewedVin: string | null;
  reviewedServices: Prisma.JsonValue | null;
  reviewedTotal: Prisma.Decimal | null;
}): boolean {
  return Boolean((row.reviewedLicensePlate || row.reviewedVin) && row.reviewedServices && row.reviewedTotal?.isPositive());
}

async function refreshImportReviewStatus(importId: string, ws: string) {
  const current = await prisma.externalListImport.findFirstOrThrow({
    where: { id: importId, workspaceId: ws },
    include: { items: true },
  });
  const headerComplete = Boolean(current.reviewedClientId && current.reviewedCurrencyCode);
  const rowsComplete = current.items.length > 0 && current.items.every(isCompleteRow);
  const status = headerComplete && rowsComplete ? "reviewed" : "under_review";
  return prisma.externalListImport.update({ where: { id: current.id }, data: { status } , include: { items: true } });
}

async function persistListExtraction(
  importId: string,
  ws: string,
  extracted: Awaited<ReturnType<ImportExtractionProvider["extractListDocument"]>>,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.externalListImportItem.count({ where: { importId, workspaceId: ws } });
    if (existing) throw new ConflictError("IMPORT_EXTRACTION_ROWS_ALREADY_EXIST");
    await tx.externalListImportItem.createMany({
      data: extracted.rows.map((row) => ({
        workspaceId: ws,
        importId,
        rawLicensePlate: row.rawLicensePlate ?? null,
        rawVin: row.rawVin ?? null,
        rawCarName: row.rawCarName ?? null,
        rawClient: row.rawClientName ?? null,
        rawTechnician: row.rawTechnician ?? null,
        rawServices: row.rawServices as Prisma.InputJsonValue | undefined,
        rawTotalText: row.rawTotalText ?? null,
        fieldConfidence: row.fieldConfidence as Prisma.InputJsonValue | undefined,
        status: "staged",
      })),
    });
    return tx.externalListImport.update({
      where: { id: importId },
      data: { rawOcrResult: extracted.raw as Prisma.InputJsonValue, status: "extracted", errorMessage: null },
      include: { items: true },
    });
  });
}

export async function createExternalListImport(
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
  const header = await prisma.externalListImport.create({
    data: { id, workspaceId: ws, fileName: validated.fileName, uploadedBy: ctx.actorUserId, status: "uploaded" },
  });
  const key = listImportStorageKey(ws, id, validated.fileName);
  let promoted = false;

  try {
    await storage.put(key, input.bytes, validated.mimeType);
    promoted = true;
    await prisma.externalListImport.update({
      where: { id },
      data: { storagePath: key, fileSha256: sha256(input.bytes), mimeType: validated.mimeType, sizeBytes: input.bytes.length, status: "extracting" },
    });
    const extracted = await extraction.extractListDocument({ bytes: input.bytes, mimeType: validated.mimeType, fileName: validated.fileName });
    const imported = await persistListExtraction(id, ws, extracted);
    return imported;
  } catch (error) {
    if (promoted && !(error instanceof ImportPipelineError)) {
      // Provenance remains when extraction fails; only a metadata persistence failure attempts cleanup.
      await prisma.externalListImport.updateMany({ where: { id, workspaceId: ws }, data: { status: "failed", errorMessage: "IMPORT_EXTRACTION_OR_PERSISTENCE_FAILED" } });
    } else {
      await prisma.externalListImport.updateMany({ where: { id, workspaceId: ws }, data: { status: "failed", errorMessage: "IMPORT_STORAGE_PROMOTION_FAILED" } });
    }
    if (error instanceof ConflictError) throw error;
    throw new ImportPipelineError(header.id, promoted ? "IMPORT_EXTRACTION_FAILED" : "IMPORT_STORAGE_PROMOTION_FAILED");
  }
}

/** Retry is explicit and one-way: only a failed import with no staging rows may re-extract. */
export async function retryExternalListExtraction(
  ctx: RequestContext,
  importId: string,
  dependencies: ServiceDependencies = {},
) {
  assertImportManager(ctx);
  const ws = workspaceId(ctx);
  const storage = dependencies.storage ?? minioImportDocumentStorage;
  const extraction = dependencies.extraction ?? aiImportExtractionProvider;
  const current = await prisma.externalListImport.findFirst({
    where: { id: importId, workspaceId: ws },
    include: { items: { select: { id: true } } },
  });
  if (!current) throw new NotFoundError("IMPORT_NOT_FOUND");
  if (current.items.length) throw new ConflictError("IMPORT_RETRY_ROWS_ALREADY_EXIST");
  if (!current.storagePath || !current.mimeType) throw new ConflictError("IMPORT_RETRY_PROVENANCE_UNAVAILABLE");

  // Conditional state change serializes concurrent retries without a process-local lock.
  const claimed = await prisma.externalListImport.updateMany({
    where: { id: current.id, workspaceId: ws, status: "failed" },
    data: { status: "extracting", errorMessage: null },
  });
  if (claimed.count !== 1) throw new ConflictError("IMPORT_RETRY_STATE_INVALID");

  try {
    const bytes = await storage.read(current.storagePath);
    const extracted = await extraction.extractListDocument({
      bytes,
      mimeType: current.mimeType as SupportedImportMimeType,
      fileName: current.fileName,
    });
    return await persistListExtraction(current.id, ws, extracted);
  } catch (error) {
    await prisma.externalListImport.updateMany({
      where: { id: current.id, workspaceId: ws, status: "extracting" },
      data: { status: "failed", errorMessage: "IMPORT_RETRY_EXTRACTION_FAILED" },
    });
    if (error instanceof ConflictError) throw error;
    throw new ImportPipelineError(current.id, "IMPORT_RETRY_EXTRACTION_FAILED");
  }
}

export async function getExternalListImport(ctx: RequestContext, importId: string) {
  assertImportManager(ctx);
  const record = await prisma.externalListImport.findFirst({ where: { id: importId, workspaceId: workspaceId(ctx) }, include: { items: true, reviewedClient: true } });
  if (!record) throw new NotFoundError("IMPORT_NOT_FOUND");
  return record;
}

export async function reviewExternalListImport(
  ctx: RequestContext,
  importId: string,
  input: { header?: unknown; rows?: Array<{ id: string; patch: unknown }> },
) {
  assertImportManager(ctx);
  const ws = workspaceId(ctx);
  const current = await prisma.externalListImport.findFirst({ where: { id: importId, workspaceId: ws } });
  if (!current) throw new NotFoundError("IMPORT_NOT_FOUND");
  if (["failed", "discarded", "committed"].includes(current.status)) throw new ConflictError("IMPORT_REVIEW_STATE_INVALID");

  await prisma.$transaction(async (tx) => {
    if (input.header !== undefined) {
      const header = listHeaderReviewSchema.parse(input.header);
      if (header.reviewedClientId) {
        const client = await tx.client.findFirst({ where: { id: header.reviewedClientId, workspaceId: ws, deletedAt: null }, select: { id: true } });
        if (!client) throw new UnprocessableEntityError("REVIEWED_CLIENT_NOT_IN_WORKSPACE");
      }
      await tx.externalListImport.update({ where: { id: current.id }, data: header });
    }
    for (const requestedRow of input.rows ?? []) {
      const row = await tx.externalListImportItem.findFirst({ where: { id: requestedRow.id, importId: current.id, workspaceId: ws } });
      if (!row) throw new NotFoundError("IMPORT_ROW_NOT_FOUND");
      const patch = listRowReviewSchema.parse(requestedRow.patch);
      const reviewedTotal = patch.reviewedTotal === undefined ? undefined : patch.reviewedTotal === null ? null : parseReviewedDecimal(patch.reviewedTotal);
      const data: Prisma.ExternalListImportItemUncheckedUpdateInput = {
        reviewedBy: ctx.actorUserId,
        reviewedAt: new Date(),
        ...(patch.reviewedLicensePlate !== undefined ? { reviewedLicensePlate: normalizePlate(patch.reviewedLicensePlate) } : {}),
        ...(patch.reviewedVin !== undefined ? { reviewedVin: normalizeVin(patch.reviewedVin) } : {}),
        ...(patch.reviewedCarName !== undefined ? { reviewedCarName: patch.reviewedCarName } : {}),
        ...(patch.reviewedServices !== undefined ? { reviewedServices: patch.reviewedServices === null ? Prisma.JsonNull : patch.reviewedServices as Prisma.InputJsonValue } : {}),
        ...(reviewedTotal !== undefined ? { reviewedTotal } : {}),
      };
      const prospective = { ...row, ...data } as typeof row;
      await tx.externalListImportItem.update({ where: { id: row.id }, data: { ...data, status: isCompleteRow(prospective) ? "reviewed" : "staged" } });
    }
  });
  return refreshImportReviewStatus(current.id, ws);
}

export async function discardExternalListImport(ctx: RequestContext, importId: string) {
  assertImportManager(ctx);
  const result = await prisma.externalListImport.updateMany({
    where: { id: importId, workspaceId: workspaceId(ctx), status: { notIn: ["committed", "discarded"] } },
    data: { status: "discarded" },
  });
  if (!result.count) throw new NotFoundError("IMPORT_NOT_FOUND_OR_FINALIZED");
}

export function toListImportUpload(input: { fileName: string; mimeType: string; contentBase64: string }) {
  return { fileName: input.fileName, mimeType: input.mimeType as SupportedImportMimeType, bytes: Buffer.from(input.contentBase64, "base64") };
}
