import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import {
  s3,
  PUBLIC_BUCKETS,
  getPresignedDownloadUrl,
  assertTenantStoragePath,
} from "../lib/minio.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveRequestContext } from "../middleware/requestContext.js";
import type { Readable } from "node:stream";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export const storageRouter = Router();

function wildcardPath(req: Request): string {
  const raw = (req.params as Record<string, string | string[]>)["0"];
  return Array.isArray(raw) ? raw.join("/") : (raw ?? "");
}

function bucketParam(req: Request): string {
  const raw = (req.params as Record<string, string | string[]>)["bucket"];
  return Array.isArray(raw) ? raw[0] : (raw ?? "");
}

async function streamObject(bucket: string, filePath: string, res: Response, cacheControl: string) {
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: filePath }));
    if (obj.ContentType) res.setHeader("Content-Type", obj.ContentType);
    if (obj.ContentLength) res.setHeader("Content-Length", obj.ContentLength);
    res.setHeader("Cache-Control", cacheControl);
    (obj.Body as Readable).pipe(res);
  } catch (err: unknown) {
    const code = (err as { name?: string })?.name;
    if (code === "NoSuchKey" || code === "NotFound") {
      res.status(404).json({ message: "Arquivo não encontrado." });
    } else {
      console.error("[storage] stream error", err);
      res.status(500).json({ message: "Erro ao recuperar o arquivo." });
    }
  }
}

// GET /api/storage/public/:bucket/* — arquivos públicos (sem auth)
storageRouter.get("/public/:bucket/*", async (req: Request, res: Response) => {
  const bucket = bucketParam(req);
  if (!PUBLIC_BUCKETS.includes(bucket)) {
    return res.status(403).json({ message: "Bucket não é público." });
  }
  await streamObject(bucket, wildcardPath(req), res, "public, max-age=86400");
});

// A partir daqui, todas as rotas exigem autenticação estrita no Header e RequestContext (Zero JWT em query string)
storageRouter.use(requireAuth);
storageRouter.use(resolveRequestContext);

// POST /api/storage/upload
storageRouter.post(
  "/upload",
  upload.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.ctx;
      if (!ctx?.activeWorkspaceId) {
        return res.status(403).json({ message: "Workspace ativo não definido." });
      }

      const file = req.file;
      const bucket = req.body.bucket as string | undefined;
      const path = req.body.path as string | undefined;

      if (!file || !bucket || !path) {
        return res.status(400).json({ message: "Campos obrigatórios: file, bucket, path." });
      }

      // Validação de fronteira de tenant
      assertTenantStoragePath(ctx, path);

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: path,
          Body: file.buffer,
          ContentType: file.mimetype || "application/octet-stream",
        })
      );

      return res.json({ path, bucket });
    } catch (err) {
      return next(err);
    }
  }
);

// POST /api/storage/presigned-download
// Retorna URL pré-assinada com TTL de 15 minutos sem expor tokens na query string
storageRouter.post(
  "/presigned-download",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.ctx;
      if (!ctx?.activeWorkspaceId) {
        return res.status(403).json({ message: "Workspace ativo não definido." });
      }

      const { bucket, path, expiresInSeconds = 900 } = req.body as {
        bucket?: string;
        path?: string;
        expiresInSeconds?: number;
      };

      if (!bucket || !path) {
        return res.status(400).json({ message: "Campos obrigatórios: bucket, path." });
      }

      // Bloqueio comprovado de acesso cross-tenant a arquivos
      assertTenantStoragePath(ctx, path);

      const ttl = Math.min(Math.max(Number(expiresInSeconds) || 900, 60), 900); // máx 15 min (900s)
      const url = await getPresignedDownloadUrl(bucket, path, ttl);

      return res.json({ url, expiresInSeconds: ttl });
    } catch (err) {
      return next(err);
    }
  }
);

// GET /api/storage/file/:bucket/* — arquivos privados protegidos por header Bearer (sem suporte a token em query)
storageRouter.get(
  "/file/:bucket/*",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.ctx;
      if (!ctx?.activeWorkspaceId) {
        return res.status(403).json({ message: "Workspace ativo não definido." });
      }

      const bucket = bucketParam(req);
      const filePath = wildcardPath(req);

      // Bloqueio de acesso cross-tenant
      assertTenantStoragePath(ctx, filePath);

      await streamObject(bucket, filePath, res, "private, max-age=900");
    } catch (err) {
      return next(err);
    }
  }
);

// DELETE /api/storage/files
storageRouter.delete("/files", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const { bucket, paths } = req.body as { bucket?: string; paths?: string[] };

    if (!bucket || !Array.isArray(paths) || paths.length === 0) {
      return res.status(400).json({ message: "Campos obrigatórios: bucket, paths (array)." });
    }

    // Validação cross-tenant para todos os arquivos
    for (const p of paths) {
      assertTenantStoragePath(ctx, p);
    }

    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: paths.map((Key) => ({ Key })) },
      })
    );
    return res.json({ deleted: paths.length });
  } catch (err) {
    return next(err);
  }
});
