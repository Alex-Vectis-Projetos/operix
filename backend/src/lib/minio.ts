import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { ForbiddenError } from "./objectAuth.js";
import type { RequestContext } from "../middleware/requestContext.js";

export const s3 = new S3Client({
  endpoint: env.MINIO_ENDPOINT,
  region: "us-east-1",
  credentials: {
    accessKeyId: env.MINIO_ROOT_USER,
    secretAccessKey: env.MINIO_ROOT_PASSWORD,
  },
  forcePathStyle: true,
});

const PUBLIC_BUCKETS = ["avatars", "hail-reports", "marketplace", "logos"];

const ALL_BUCKETS = [
  "uploads",
  "avatars",
  "hail-reports",
  "marketplace",
  "logos",
  "production-photos",
  "accounting-receipts",
  "billing-receipts",
  "payment-proofs",
  "invoice-pdfs",
];

async function bucketExists(name: string): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: name }));
    return true;
  } catch {
    return false;
  }
}

function publicReadPolicy(bucket: string): string {
  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { AWS: ["*"] },
        Action: ["s3:GetObject"],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  });
}

export async function ensureBuckets(): Promise<void> {
  for (const name of ALL_BUCKETS) {
    const exists = await bucketExists(name);
    if (!exists) {
      await s3.send(new CreateBucketCommand({ Bucket: name }));
      console.log(`[minio] bucket criado: ${name}`);
    }
    if (PUBLIC_BUCKETS.includes(name)) {
      await s3.send(
        new PutBucketPolicyCommand({ Bucket: name, Policy: publicReadPolicy(name) })
      );
    }
  }
  console.log("[minio] buckets verificados");
}

/**
 * Gera caminho determinístico e canônico para foto de orçamento:
 * tenants/{workspaceId}/budgets/{budgetId}/{photoId}.jpg
 */
export function getBudgetPhotoStorageKey(
  workspaceId: string,
  budgetId: string,
  photoId: string = randomUUID(),
  extension: string = "jpg"
): { photoId: string; storageKey: string } {
  const ext = extension.replace(/^\./, "") || "jpg";
  return {
    photoId,
    storageKey: `tenants/${workspaceId}/budgets/${budgetId}/${photoId}.${ext}`,
  };
}

/**
 * Gera caminho determinístico e canônico para foto de ordem de produção:
 * tenants/{workspaceId}/production-orders/{orderId}/{photoId}.jpg
 */
export function getProductionPhotoStorageKey(
  workspaceId: string,
  orderId: string,
  photoId: string = randomUUID(),
  extension: string = "jpg"
): { photoId: string; storageKey: string } {
  const ext = extension.replace(/^\./, "") || "jpg";
  return {
    photoId,
    storageKey: `tenants/${workspaceId}/production-orders/${orderId}/${photoId}.${ext}`,
  };
}

/**
 * Gera caminho determinístico e canônico para assinatura digital:
 * tenants/{workspaceId}/budgets/{budgetId}/signatures/{revisionId}.png
 */
export function getSignatureStorageKey(
  workspaceId: string,
  budgetId: string,
  revisionId: string
): string {
  return `tenants/${workspaceId}/budgets/${budgetId}/signatures/${revisionId}.png`;
}

/**
 * Gera URL pré-assinada de download temporária no MinIO/S3 (TTL máximo de 15 minutos = 900s).
 * Dispensa passagem de token JWT na query string.
 */
export async function getPresignedDownloadUrl(
  bucket: string,
  key: string,
  expiresInSeconds: number = 900
): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    return await getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
  } catch (err) {
    console.error("[minio] getPresignedDownloadUrl error:", err);
    return "";
  }
}

export const ALLOWED_STORAGE_BUCKETS = [
  "production-photos",
  "uploads",
] as const;

export type AllowedStorageBucket = (typeof ALLOWED_STORAGE_BUCKETS)[number];

export function assertAllowedBucket(bucket: string): void {
  if (!bucket || !ALLOWED_STORAGE_BUCKETS.includes(bucket as AllowedStorageBucket)) {
    throw new ForbiddenError(`Bucket '${bucket}' não é permitido para esta operação.`);
  }
}

/**
 * Garante que um caminho de storage sob o prefixo 'tenants/{wsId}/...' pertença
 * estritamente ao workspace ativo no RequestContext.
 * Deny-by-default: rejeita caminhos sem tenants/, caminhos de outros tenants,
 * path traversal, caracteres nulos e workspaces vazios.
 */
export function assertTenantStoragePath(ctx: RequestContext, storagePath: string): void {
  if (!ctx.activeWorkspaceId || typeof ctx.activeWorkspaceId !== "string" || !ctx.activeWorkspaceId.trim()) {
    throw new ForbiddenError("Workspace ativo não definido no contexto.");
  }

  if (!storagePath || typeof storagePath !== "string") {
    throw new ForbiddenError("Caminho de arquivo inválido.");
  }

  // Bloqueio estrito de path traversal
  if (
    storagePath.includes("..") ||
    storagePath.includes("\\") ||
    storagePath.includes("//") ||
    storagePath.includes("\0")
  ) {
    throw new ForbiddenError("Caminho de arquivo inválido: tentativa de path traversal detectada.");
  }

  const normalized = storagePath.startsWith("/") ? storagePath.slice(1) : storagePath;
  const expectedPrefix = `tenants/${ctx.activeWorkspaceId}/`;

  if (!normalized.startsWith(expectedPrefix)) {
    throw new ForbiddenError(
      "Acesso negado: o caminho de storage solicitado não pertence ao workspace ativo."
    );
  }
}

export { PUBLIC_BUCKETS };
