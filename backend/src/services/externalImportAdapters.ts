import { createHash } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { z } from "zod";
import { fetchAICompletion, parseToolCall } from "../lib/ai.js";
import { s3 } from "../lib/minio.js";

export const IMPORT_BUCKET = "uploads";
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const supportedMimeTypes = ["application/pdf", "image/png", "image/jpeg"] as const;
export type SupportedImportMimeType = (typeof supportedMimeTypes)[number];

export interface ImportDocumentStorage {
  put(key: string, bytes: Buffer, mimeType: SupportedImportMimeType): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

export interface ExtractedImportRow {
  rawLicensePlate?: string | null;
  rawVin?: string | null;
  rawCarName?: string | null;
  rawClientName?: string | null;
  rawCurrencyCode?: string | null;
  rawOperationalSiteKey?: string | null;
  rawTechnician?: string | null;
  rawWeek?: string | null;
  rawDeliveredAtText?: string | null;
  rawServices?: unknown;
  rawTotalText?: string | null;
  fieldConfidence?: unknown;
}

export interface ImportExtractionProvider {
  extractListDocument(input: { bytes: Buffer; mimeType: SupportedImportMimeType; fileName: string }): Promise<{ raw: unknown; rows: ExtractedImportRow[] }>;
  extractOperationalDocument(input: { bytes: Buffer; mimeType: SupportedImportMimeType; fileName: string }): Promise<{ raw: unknown; rows: ExtractedImportRow[] }>;
}

const nullableText = z.string().trim().max(1_000).nullable().optional();
const extractedRowSchema = z.object({
  rawLicensePlate: nullableText,
  rawVin: nullableText,
  rawCarName: nullableText,
  rawClientName: nullableText,
  rawCurrencyCode: nullableText,
  rawOperationalSiteKey: nullableText,
  rawTechnician: nullableText,
  rawWeek: nullableText,
  rawDeliveredAtText: nullableText,
  rawServices: z.unknown().optional(),
  rawTotalText: nullableText,
  fieldConfidence: z.unknown().optional(),
}).strict();

const extractionResponseSchema = z.object({
  rows: z.array(extractedRowSchema).min(1).max(2_000),
}).strict();

function hasPrefix(bytes: Buffer, prefix: number[]): boolean {
  return bytes.length >= prefix.length && prefix.every((value, index) => bytes[index] === value);
}

export function validateImportFile(input: { fileName: string; mimeType: string; bytes: Buffer }): {
  fileName: string;
  mimeType: SupportedImportMimeType;
} {
  const suppliedName = input.fileName.trim();
  if (suppliedName.includes("/") || suppliedName.includes("\\") || suppliedName.includes("..") || /[\u0000-\u001f]/.test(suppliedName)) {
    throw Object.assign(new Error("IMPORT_FILE_NAME_INVALID"), { statusCode: 422, code: "IMPORT_FILE_NAME_INVALID" });
  }
  const fileName = suppliedName;
  if (!fileName || fileName.length > 180) throw Object.assign(new Error("IMPORT_FILE_NAME_INVALID"), { statusCode: 422, code: "IMPORT_FILE_NAME_INVALID" });
  if (!supportedMimeTypes.includes(input.mimeType as SupportedImportMimeType)) {
    throw Object.assign(new Error("IMPORT_MIME_NOT_ALLOWED"), { statusCode: 422, code: "IMPORT_MIME_NOT_ALLOWED" });
  }
  if (input.bytes.length === 0 || input.bytes.length > MAX_IMPORT_BYTES) {
    throw Object.assign(new Error("IMPORT_FILE_SIZE_INVALID"), { statusCode: 422, code: "IMPORT_FILE_SIZE_INVALID" });
  }

  const validMagic =
    (input.mimeType === "application/pdf" && input.bytes.subarray(0, 5).toString("ascii") === "%PDF-") ||
    (input.mimeType === "image/png" && hasPrefix(input.bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
    (input.mimeType === "image/jpeg" && hasPrefix(input.bytes, [0xff, 0xd8, 0xff]));
  if (!validMagic) {
    throw Object.assign(new Error("IMPORT_FILE_SIGNATURE_INVALID"), { statusCode: 422, code: "IMPORT_FILE_SIGNATURE_INVALID" });
  }
  return { fileName, mimeType: input.mimeType as SupportedImportMimeType };
}

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function listImportStorageKey(workspaceId: string, importId: string, fileName: string): string {
  return `tenants/${workspaceId}/lists/imports/${importId}/original_${fileName}`;
}

export function operationalImportStorageKey(workspaceId: string, importId: string, fileName: string): string {
  return `tenants/${workspaceId}/weeklogs/imports/${importId}/original_${fileName}`;
}

export const minioImportDocumentStorage: ImportDocumentStorage = {
  async put(key, bytes, mimeType) {
    await s3.send(new PutObjectCommand({ Bucket: IMPORT_BUCKET, Key: key, Body: bytes, ContentType: mimeType }));
  },
  async read(key) {
    const result = await s3.send(new GetObjectCommand({ Bucket: IMPORT_BUCKET, Key: key }));
    const body = result.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
    if (!body?.transformToByteArray) throw new Error("IMPORT_STORAGE_READ_FAILED");
    return Buffer.from(await body.transformToByteArray());
  },
  async delete(key) {
    await s3.send(new DeleteObjectCommand({ Bucket: IMPORT_BUCKET, Key: key }));
  },
};

async function extract(kind: "list" | "operational", input: { bytes: Buffer; mimeType: SupportedImportMimeType; fileName: string }) {
  const response = await fetchAICompletion({
    messages: [
      {
        role: "system",
        content: "Extract document rows faithfully. Never invent values. Keep monetary text exactly as printed in rawTotalText. Return null for unknown values.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: `Extract ${kind} rows from ${input.fileName}. Return raw textual fields and structured services only.` },
          { type: "image_url", image_url: { url: `data:${input.mimeType};base64,${input.bytes.toString("base64")}` } },
        ],
      },
    ],
    tools: [{
      type: "function",
      function: {
        name: "extract_import_rows",
        description: "Returns document rows for governed relational staging.",
        parameters: {
          type: "object",
          properties: { rows: { type: "array", items: { type: "object" } } },
          required: ["rows"],
          additionalProperties: false,
        },
      },
    }],
    tool_choice: { type: "function", function: { name: "extract_import_rows" } },
  });
  if (!response.ok) throw new Error("IMPORT_EXTRACTION_PROVIDER_UNAVAILABLE");
  const raw = await response.json();
  const parsed = extractionResponseSchema.safeParse(parseToolCall(raw));
  if (!parsed.success) throw new Error("IMPORT_EXTRACTION_INVALID_OUTPUT");
  return { raw, rows: parsed.data.rows };
}

export const aiImportExtractionProvider: ImportExtractionProvider = {
  extractListDocument: (input) => extract("list", input),
  extractOperationalDocument: (input) => extract("operational", input),
};
