import { Router, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { notifyDocumentUpdated, getWorkspaceManagerUserIds } from "../services/notificationService.js";

export const documentsRouter = Router();

function mapDoc(doc: any) {
  return {
    id: doc.id,
    name: doc.name,
    display_name: doc.displayName,
    entity_type: doc.entityType,
    module: doc.module,
    type: doc.type,
    parent_id: doc.parentId,
    storage_path: doc.storagePath,
    mime_type: doc.mimeType,
    size_bytes: doc.sizeBytes,
    rotation: doc.rotation,
    zoom: doc.zoom,
    validated: doc.validated,
    visual_state: doc.visualState,
    uploaded_by: doc.uploadedBy,
    workspace_id: doc.workspaceId,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

// GET /documents?entity_type=&module=&parent_id= (or parent_id=null)
documentsRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { entity_type, module: mod, parent_id } = req.query as Record<string, string | undefined>;
  if (!entity_type) return res.status(400).json({ message: "entity_type é obrigatório." });

  const docs = await prisma.document.findMany({
    where: {
      entityType: entity_type,
      ...(mod ? { module: mod } : {}),
      parentId: parent_id === undefined || parent_id === "null" ? null : parent_id,
    },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  return res.json(docs.map(mapDoc));
});

// GET /documents/folders?entity_type=
documentsRouter.get("/folders", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { entity_type } = req.query as Record<string, string | undefined>;
  if (!entity_type) return res.status(400).json({ message: "entity_type é obrigatório." });

  const folders = await prisma.document.findMany({
    where: { entityType: entity_type, type: "folder" },
    select: { id: true, name: true, parentId: true },
    orderBy: { name: "asc" },
  });
  return res.json(folders.map((f) => ({ id: f.id, name: f.name, parent_id: f.parentId })));
});

// POST /documents
documentsRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const b = req.body;
  if (!b.name || !b.entity_type) {
    return res.status(400).json({ message: "Campos obrigatórios: name, entity_type." });
  }

  const doc = await prisma.document.create({
    data: {
      name: b.name,
      displayName: b.display_name ?? b.name,
      entityType: b.entity_type,
      module: b.module ?? null,
      type: b.type ?? "file",
      parentId: b.parent_id ?? null,
      storagePath: b.storage_path ?? null,
      mimeType: b.mime_type ?? null,
      sizeBytes: b.size_bytes ?? null,
      rotation: b.rotation ?? 0,
      zoom: b.zoom ?? 1,
      validated: b.validated ?? false,
      visualState: b.visual_state ?? null,
      uploadedBy: b.uploaded_by ?? null,
      workspaceId: b.workspace_id ?? null,
      ...(b.created_at ? { createdAt: new Date(b.created_at) } : {}),
    },
  });
  return res.status(201).json(mapDoc(doc));
});

// PATCH /documents/:id
documentsRouter.patch("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const id = req.params["id"] as string;
  const b = req.body;

  const existing = await prisma.document.findUnique({ where: { id } });
  if (!existing) {
    return res.status(404).json({ message: "Documento não encontrado." });
  }

  const data: Record<string, unknown> = {};
  if (b.name !== undefined) data.name = b.name;
  if (b.display_name !== undefined) data.displayName = b.display_name;
  if (b.parent_id !== undefined) data.parentId = b.parent_id;
  if (b.rotation !== undefined) data.rotation = b.rotation;
  if (b.zoom !== undefined) data.zoom = b.zoom;
  if (b.validated !== undefined) data.validated = b.validated;
  if (b.visual_state !== undefined) data.visualState = b.visual_state;

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: "Nenhum campo para actualizar." });
  }

  const doc = await prisma.document.update({ where: { id }, data });

  // Notificação de atualização / validação / observação de documento
  try {
    const actorUserId = req.auth?.userId;
    const authorName = req.auth?.email || "Um operador";
    const targetUsers: string[] = [];

    if (existing.uploadedBy && existing.uploadedBy !== actorUserId) {
      targetUsers.push(existing.uploadedBy);
    }
    if (existing.workspaceId && actorUserId) {
      const managers = await getWorkspaceManagerUserIds(existing.workspaceId, actorUserId);
      targetUsers.push(...managers);
    }

    const docTitle = doc.displayName || doc.name;
    const vs = b.visual_state as any;
    const hasNoteOrObs = vs && (vs.notes || vs.observacao || vs.observation || vs.motivo || vs.comments);

    if (b.validated === true && existing.validated !== true) {
      await notifyDocumentUpdated(targetUsers, docTitle, "validated", authorName, doc.id);
    } else if (hasNoteOrObs) {
      await notifyDocumentUpdated(targetUsers, docTitle, "observation", authorName, doc.id);
    } else if (b.name !== undefined || b.display_name !== undefined) {
      await notifyDocumentUpdated(targetUsers, docTitle, "updated", authorName, doc.id);
    }
  } catch (notifErr) {
    console.error("[documents] Falha ao enviar notificação de documento:", notifErr);
  }

  return res.json(mapDoc(doc));
});

// DELETE /documents/batch  (must be before /:id)
documentsRouter.delete("/batch", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { ids } = req.body as { ids?: string[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "ids (array) é obrigatório." });
  }
  await prisma.document.deleteMany({ where: { id: { in: ids } } });
  return res.json({ deleted: ids.length });
});

// DELETE /documents/:id
documentsRouter.delete("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const id = req.params["id"] as string;
  await prisma.document.delete({ where: { id } });
  return res.json({ deleted: 1 });
});
