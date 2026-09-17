import { randomUUID } from "node:crypto";
import {
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { s3 } from "./minio.js";
import { ForbiddenError, UnprocessableEntityError } from "./objectAuth.js";

const PNG_MAGIC_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const MAX_SIGNATURE_SIZE_BYTES = 1024 * 1024; // 1 MB
const SIGNATURE_BUCKET = "uploads";

/**
 * Interface explícita de Storage Driver para governança de assinaturas.
 */
export interface SignatureStorageDriver {
  saveStaging(workspaceId: string, weeklogId: string, buffer: Buffer): Promise<string>;
  promoteToFinal(
    workspaceId: string,
    weeklogId: string,
    stagingKey: string,
    roundId: string
  ): Promise<string>;
  assertExists(storagePath: string): Promise<void>;
  deleteStaging(stagingKey: string): Promise<void>;
  getStoredSignature?(storagePath: string): { buffer: Buffer; contentType: string } | undefined;
}

/**
 * Driver de Produção: Comunica diretamente com MinIO/S3.
 * NUNCA recorre a fallback em memória; emite erro explícito caso o serviço esteja indisponível.
 */
export class ProductionS3StorageDriver implements SignatureStorageDriver {
  async saveStaging(
    workspaceId: string,
    weeklogId: string,
    buffer: Buffer
  ): Promise<string> {
    const stagingKey = generateStagingSignaturePath(workspaceId, weeklogId);
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: SIGNATURE_BUCKET,
          Key: stagingKey,
          Body: buffer,
          ContentType: "image/png",
        })
      );
      return stagingKey;
    } catch (error: any) {
      throw new UnprocessableEntityError(
        `STORAGE_UNAVAILABLE: O serviço de armazenamento de arquivos (MinIO/S3) está indisponível ou inacessível: ${error?.message || "connection error"}.`
      );
    }
  }

  async promoteToFinal(
    workspaceId: string,
    weeklogId: string,
    stagingKey: string,
    roundId: string
  ): Promise<string> {
    const finalKey = generateFinalSignaturePath(workspaceId, weeklogId, roundId);
    try {
      await s3.send(
        new CopyObjectCommand({
          Bucket: SIGNATURE_BUCKET,
          CopySource: `${SIGNATURE_BUCKET}/${stagingKey}`,
          Key: finalKey,
        })
      );
      return finalKey;
    } catch (error: any) {
      throw new UnprocessableEntityError(
        `STORAGE_UNAVAILABLE: Falha ao promover arquivo de assinatura no MinIO/S3: ${error?.message || "connection error"}.`
      );
    }
  }

  async assertExists(storagePath: string): Promise<void> {
    try {
      await s3.send(
        new HeadObjectCommand({
          Bucket: SIGNATURE_BUCKET,
          Key: storagePath,
        })
      );
    } catch (error: any) {
      const code = error?.name || error?.$metadata?.httpStatusCode;
      if (code === "NotFound" || code === 404) {
        throw new UnprocessableEntityError(
          `SIGNATURE_FILE_NOT_FOUND: O arquivo de assinatura especificado não foi encontrado no storage: '${storagePath}'.`
        );
      }
      throw new UnprocessableEntityError(
        `STORAGE_UNAVAILABLE: O serviço de armazenamento de arquivos (MinIO/S3) está inacessível ao verificar arquivo: ${error?.message || "connection error"}.`
      );
    }
  }

  async deleteStaging(stagingKey: string): Promise<void> {
    try {
      await s3.send(
        new DeleteObjectCommand({
          Bucket: SIGNATURE_BUCKET,
          Key: stagingKey,
        })
      );
    } catch {
      // Best-effort cleanup: não propaga erro
    }
  }
}

/**
 * Driver de Teste / Integração em Memória.
 * Retém buffers binários e verifica existência material sem depender do daemon S3 externo.
 */
export class InMemoryTestStorageDriver implements SignatureStorageDriver {
  private store = new Map<string, { buffer: Buffer; contentType: string }>();

  async saveStaging(
    workspaceId: string,
    weeklogId: string,
    buffer: Buffer
  ): Promise<string> {
    const stagingKey = generateStagingSignaturePath(workspaceId, weeklogId);
    this.store.set(stagingKey, { buffer, contentType: "image/png" });
    return stagingKey;
  }

  async promoteToFinal(
    workspaceId: string,
    weeklogId: string,
    stagingKey: string,
    roundId: string
  ): Promise<string> {
    const finalKey = generateFinalSignaturePath(workspaceId, weeklogId, roundId);
    const existing = this.store.get(stagingKey);
    if (!existing) {
      throw new UnprocessableEntityError(
        `SIGNATURE_FILE_NOT_FOUND: O arquivo de assinatura temporário não foi encontrado no storage: '${stagingKey}'.`
      );
    }
    this.store.set(finalKey, { ...existing });
    return finalKey;
  }

  async assertExists(storagePath: string): Promise<void> {
    if (!this.store.has(storagePath)) {
      throw new UnprocessableEntityError(
        `SIGNATURE_FILE_NOT_FOUND: O arquivo de assinatura especificado não foi encontrado no storage: '${storagePath}'.`
      );
    }
  }

  async deleteStaging(stagingKey: string): Promise<void> {
    this.store.delete(stagingKey);
  }

  getStoredSignature(
    storagePath: string
  ): { buffer: Buffer; contentType: string } | undefined {
    return this.store.get(storagePath);
  }

  clear(): void {
    this.store.clear();
  }
}

const defaultProductionDriver = new ProductionS3StorageDriver();
const defaultInMemoryDriver = new InMemoryTestStorageDriver();

let activeDriverOverride: SignatureStorageDriver | null = null;

/**
 * Injeta ou redefine o storage driver ativo (para testes ou isolamento).
 */
export function setStorageDriver(driver: SignatureStorageDriver | null): void {
  activeDriverOverride = driver;
}

/**
 * Retorna o storage driver ativo:
 * 1. Override explícito se injetado via setStorageDriver().
 * 2. InMemoryTestStorageDriver se NODE_ENV === 'test'.
 * 3. ProductionS3StorageDriver em qualquer outro ambiente.
 */
export function getStorageDriver(): SignatureStorageDriver {
  if (activeDriverOverride) {
    return activeDriverOverride;
  }
  if (process.env["NODE_ENV"] === "test") {
    return defaultInMemoryDriver;
  }
  return defaultProductionDriver;
}

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

/**
 * Persiste a imagem de assinatura no caminho de staging.
 */
export async function saveStagingSignature(
  workspaceId: string,
  weeklogId: string,
  buffer: Buffer
): Promise<string> {
  validatePngBinary(buffer);
  return getStorageDriver().saveStaging(workspaceId, weeklogId, buffer);
}

/**
 * Valida a existência do objeto de assinatura (staging ou final).
 */
export async function assertSignatureExists(storagePath: string): Promise<void> {
  return getStorageDriver().assertExists(storagePath);
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
  return getStorageDriver().promoteToFinal(workspaceId, weeklogId, stagingKey, roundId);
}

/**
 * Remove o arquivo temporário de staging após commit da transação (best-effort).
 */
export async function deleteStagingSignatureBestEffort(
  stagingKey: string
): Promise<void> {
  return getStorageDriver().deleteStaging(stagingKey);
}

/**
 * Recupera o objeto de assinatura do storage (para asserção em testes materiais).
 */
export function getStoredSignature(
  storagePath: string
): { buffer: Buffer; contentType: string } | undefined {
  const driver = getStorageDriver();
  return driver.getStoredSignature ? driver.getStoredSignature(storagePath) : undefined;
}
