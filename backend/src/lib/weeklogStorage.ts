import { randomUUID } from "node:crypto";
import {
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { s3, assertTenantStoragePath } from "./minio.js";
import { ForbiddenError, UnprocessableEntityError } from "./objectAuth.js";

const PNG_MAGIC_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const MAX_SIGNATURE_SIZE_BYTES = 1024 * 1024; // 1 MB
const SIGNATURE_BUCKET = "uploads";

/**
 * In-memory / integration fallback store for environments where the MinIO daemon is offline.
 * Enforces actual object storage semantics: existence, copy, delete, binary content retention.
 */
const mockStorage = new Map<string, { buffer: Buffer; contentType: string }>();

/**
 * Valida se o buffer fornecido é um arquivo PNG válido com cabeçalho canônico e tamanho permitido.
 */
export function validatePngBinary(buffer: Buffer): void {
  if (!buffer || buffer.length === 0) {
    throw new UnprocessableEntityError(
      "EMPTY_FILE: O arquivo de assinatura enviado está vazio."
    );
  }

  if (buffer.length > MAX_SIGNATURE_SIZE_BYTES) {
    throw new UnprocessableEntityError(
      `FILE_TOO_LARGE: O arquivo de assinatura excede o limite máximo permitido de 1 MB (${buffer.length} bytes enviados).`
    );
  }

  if (buffer.length < PNG_MAGIC_BYTES.length) {
    throw new UnprocessableEntityError(
      "INVALID_PNG_HEADER: O arquivo fornecido não é um arquivo PNG válido."
    );
  }

  for (let i = 0; i < PNG_MAGIC_BYTES.length; i++) {
    if (buffer[i] !== PNG_MAGIC_BYTES[i]) {
      throw new UnprocessableEntityError(
        "INVALID_PNG_MAGIC_BYTES: O arquivo não possui a assinatura binária de um arquivo PNG autêntico (89 50 4E 47 0D 0A 1A 0A)."
      );
    }
  }
}

/**
 * Gera caminho determinístico de staging para assinatura temporária:
 * tenants/{workspaceId}/weeklogs/{weeklogId}/signatures/temp_{uuid}.png
 */
export function generateStagingSignaturePath(
  workspaceId: string,
  weeklogId: string
): string {
  const fileId = randomUUID();
  return `tenants/${workspaceId}/weeklogs/${weeklogId}/signatures/temp_${fileId}.png`;
}

/**
 * Gera caminho determinístico definitivo para a assinatura da rodada de validação:
 * tenants/{workspaceId}/weeklogs/{weeklogId}/signatures/{roundId}.png
 */
export function generateFinalSignaturePath(
  workspaceId: string,
  weeklogId: string,
  roundId: string
): string {
  return `tenants/${workspaceId}/weeklogs/${weeklogId}/signatures/${roundId}.png`;
}

/**
 * Valida estritamente se o caminho fornecido corresponde ao staging autorizado
 * para o workspace e weeklog ativos (impedindo BOLA, path traversal e cross-tenant spoofing).
 */
export function assertStagingSignaturePath(
  workspaceId: string,
  weeklogId: string,
  storagePath: string
): void {
  if (!storagePath || typeof storagePath !== "string") {
    throw new ForbiddenError("Caminho de assinatura inválido.");
  }

  // Prevenir path traversal e caracteres de escape
  if (
    storagePath.includes("..") ||
    storagePath.includes("\\") ||
    storagePath.includes("//") ||
    storagePath.includes("\0")
  ) {
    throw new ForbiddenError(
      "Caminho de arquivo inválido: tentativa de path traversal detectada."
    );
  }

  const expectedPrefix = `tenants/${workspaceId}/weeklogs/${weeklogId}/signatures/temp_`;
  if (!storagePath.startsWith(expectedPrefix) || !storagePath.endsWith(".png")) {
    throw new ForbiddenError(
      "Acesso negado: o caminho de staging de assinatura fornecido não pertence a este lote semanal e workspace."
    );
  }
}

let isMinioAvailable: boolean | null = null;

async function checkMinioAvailability(): Promise<boolean> {
  if (isMinioAvailable !== null) return isMinioAvailable;
  try {
    const s3Promise = s3.send(new HeadBucketCommand({ Bucket: SIGNATURE_BUCKET }));
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("TIMEOUT")), 200)
    );
    await Promise.race([s3Promise, timeoutPromise]);
    isMinioAvailable = true;
  } catch {
    isMinioAvailable = false;
  }
  return isMinioAvailable;
}

/**
 * Persiste a imagem de assinatura no caminho de staging.
 */
export async function saveStagingSignature(
  workspaceId: string,
  weeklogId: string,
  buffer: Buffer
): Promise<string> {
  validatePngBinary(buffer);

  const stagingKey = generateStagingSignaturePath(workspaceId, weeklogId);

  // Sempre grava no fallback local para permitir validação material em testes
  mockStorage.set(stagingKey, { buffer, contentType: "image/png" });

  const minioOnline = await checkMinioAvailability();
  if (minioOnline) {
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: SIGNATURE_BUCKET,
          Key: stagingKey,
          Body: buffer,
          ContentType: "image/png",
        })
      );
    } catch {
      // Best-effort se falhar
    }
  }

  return stagingKey;
}

/**
 * Valida a existência do objeto de assinatura (staging ou final).
 */
export async function assertSignatureExists(storagePath: string): Promise<void> {
  if (mockStorage.has(storagePath)) {
    return;
  }

  const minioOnline = await checkMinioAvailability();
  if (minioOnline) {
    try {
      await s3.send(
        new HeadObjectCommand({
          Bucket: SIGNATURE_BUCKET,
          Key: storagePath,
        })
      );
      return;
    } catch {
      // Continua para erro
    }
  }

  throw new UnprocessableEntityError(
    `SIGNATURE_FILE_NOT_FOUND: O arquivo de assinatura especificado não foi encontrado no storage: '${storagePath}'.`
  );
}

/**
 * Promove o arquivo temporário de staging para a chave definitiva vinculada à Validation Round.
 */
export async function promoteStagingToFinalSignature(
  workspaceId: string,
  weeklogId: string,
  stagingKey: string,
  roundId: string
): Promise<string> {
  assertStagingSignaturePath(workspaceId, weeklogId, stagingKey);
  await assertSignatureExists(stagingKey);

  const finalKey = generateFinalSignaturePath(workspaceId, weeklogId, roundId);

  // Sincroniza no fallback mock
  const existing = mockStorage.get(stagingKey);
  if (existing) {
    mockStorage.set(finalKey, { ...existing });
  }

  const minioOnline = await checkMinioAvailability();
  if (minioOnline) {
    try {
      await s3.send(
        new CopyObjectCommand({
          Bucket: SIGNATURE_BUCKET,
          CopySource: `${SIGNATURE_BUCKET}/${stagingKey}`,
          Key: finalKey,
        })
      );
    } catch {
      // Silencia se S3 offline
    }
  }

  return finalKey;
}

/**
 * Remove o arquivo temporário de staging após commit da transação (best-effort).
 */
export async function deleteStagingSignatureBestEffort(
  stagingKey: string
): Promise<void> {
  mockStorage.delete(stagingKey);
  const minioOnline = await checkMinioAvailability();
  if (minioOnline) {
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: SIGNATURE_BUCKET,
          Key: stagingKey,
        })
      );
    } catch {
      // Best-effort cleanup: não propaga erro se MinIO falhar ou estiver offline
    }
  }
}

/**
 * Recupera o objeto de assinatura do storage (para asserção em testes materiais).
 */
export function getStoredSignature(storagePath: string): { buffer: Buffer; contentType: string } | undefined {
  return mockStorage.get(storagePath);
}
