import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveRequestContext } from "../middleware/requestContext.js";
import {
  s3,
  getProductionPhotoStorageKey,
  getPresignedDownloadUrl,
  assertTenantStoragePath,
} from "../lib/minio.js";
import { assertObjectAccess } from "../lib/objectAuth.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

export const productionPhotosRouter = Router({ mergeParams: true });

productionPhotosRouter.use(requireAuth);
productionPhotosRouter.use(resolveRequestContext);

function mapPhoto(p: any, url?: string) {
  return {
    id: p.id,
    production_order_id: p.productionOrderId,
    productionOrderId: p.productionOrderId,
    workspace_id: p.workspaceId,
    workspaceId: p.workspaceId,
    uploaded_by: p.uploadedBy,
    uploadedBy: p.uploadedBy,
    category: p.category,
    storage_path: p.storagePath,
    storagePath: p.storagePath,
    caption: p.caption ?? null,
    size_bytes: p.sizeBytes ?? null,
    sizeBytes: p.sizeBytes ?? null,
    url: url || null,
    download_url: url || null,
    created_at: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
  };
}

// GET /api/production-orders/:orderId/photos
// Lista fotos gerando presigned URLs com TTL de 15 minutos (sem JWT na query string)
productionPhotosRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const { orderId } = req.params as { orderId: string };

    const order = await prisma.productionOrder.findUnique({
      where: { id: orderId },
    });

    if (!order || order.workspaceId !== ctx.activeWorkspaceId) {
      return res.status(404).json({ message: "Ordem de produção não encontrada." });
    }

    assertObjectAccess(ctx, order);

    const photos = await prisma.productionPhoto.findMany({
      where: {
        productionOrderId: orderId,
        workspaceId: ctx.activeWorkspaceId,
      },
      orderBy: { createdAt: "desc" },
    });

    const photosWithUrls = await Promise.all(
      photos.map(async (p) => {
        const url = await getPresignedDownloadUrl("production-photos", p.storagePath, 900);
        return mapPhoto(p, url);
      })
    );

    return res.json(photosWithUrls);
  } catch (error) {
    return next(error);
  }
});

// POST /api/production-orders/:orderId/photos
// Upload multipart ou registro de metadados com chave canônica: tenants/{workspaceId}/production-orders/{orderId}/{photoId}.jpg
productionPhotosRouter.post(
  "/",
  upload.single("file"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.ctx;
      if (!ctx?.activeWorkspaceId) {
        return res.status(403).json({ message: "Workspace ativo não definido." });
      }

      const { orderId } = req.params as { orderId: string };

      const order = await prisma.productionOrder.findUnique({
        where: { id: orderId },
      });

      if (!order || order.workspaceId !== ctx.activeWorkspaceId) {
        return res.status(404).json({ message: "Ordem de produção não encontrada." });
      }

      assertObjectAccess(ctx, order);

      const b = req.body;
      const file = req.file;

      const photoId = randomUUID();
      const ext = file?.originalname ? file.originalname.split(".").pop() || "jpg" : "jpg";
      const canonicalKey = getProductionPhotoStorageKey(
        ctx.activeWorkspaceId,
        orderId,
        photoId,
        ext
      ).storageKey;

      let finalStoragePath = canonicalKey;
      let finalSizeBytes = file?.size || Number(b.size_bytes || b.sizeBytes) || null;

      if (file) {
        await s3.send(
          new PutObjectCommand({
            Bucket: "production-photos",
            Key: canonicalKey,
            Body: file.buffer,
            ContentType: file.mimetype || "image/jpeg",
          })
        );
      } else if (b.storage_path || b.storagePath) {
        const suppliedPath = String(b.storage_path || b.storagePath);
        assertTenantStoragePath(ctx, suppliedPath);
        finalStoragePath = suppliedPath;
      }

      const photo = await prisma.productionPhoto.create({
        data: {
          id: photoId,
          productionOrderId: orderId,
          workspaceId: ctx.activeWorkspaceId,
          uploadedBy: ctx.actorUserId,
          category: b.category || "damage",
          storagePath: finalStoragePath,
          caption: b.caption ?? null,
          sizeBytes: finalSizeBytes,
        },
      });

      const url = await getPresignedDownloadUrl("production-photos", finalStoragePath, 900);

      return res.status(201).json(mapPhoto(photo, url));
    } catch (error) {
      return next(error);
    }
  }
);

// DELETE /api/production-orders/:orderId/photos/:photoId
// Valida tenant e deleta registro no banco e objeto físico no MinIO
productionPhotosRouter.delete(
  "/:photoId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.ctx;
      if (!ctx?.activeWorkspaceId) {
        return res.status(403).json({ message: "Workspace ativo não definido." });
      }

      const { orderId, photoId } = req.params as { orderId: string; photoId: string };

      const order = await prisma.productionOrder.findUnique({
        where: { id: orderId },
      });

      if (!order || order.workspaceId !== ctx.activeWorkspaceId) {
        return res.status(404).json({ message: "Ordem de produção não encontrada." });
      }

      assertObjectAccess(ctx, order);

      const photo = await prisma.productionPhoto.findUnique({
        where: { id: photoId },
      });

      if (!photo || photo.productionOrderId !== orderId || photo.workspaceId !== ctx.activeWorkspaceId) {
        return res.status(404).json({ message: "Foto não encontrada neste tenant." });
      }

      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: "production-photos",
            Key: photo.storagePath,
          })
        );
      } catch (s3Err) {
        console.warn("[storage] Aviso: falha ao remover arquivo físico do MinIO:", s3Err);
      }

      await prisma.productionPhoto.delete({ where: { id: photoId } });

      return res.json({ deleted: 1, id: photoId });
    } catch (error) {
      return next(error);
    }
  }
);
