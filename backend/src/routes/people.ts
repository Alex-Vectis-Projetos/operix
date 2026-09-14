import { Router, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { resolveRequestContext } from "../middleware/requestContext.js";
import { buildPermissionsForRole } from "../lib/permissionPolicy.js";
import { isPersonType, findMissingPersonFields, TYPES_REQUIRING_LOCATION, type PersonType } from "../lib/personValidation.js";
import { buildPersonDocumentSummary, computeDocumentStatus } from "../lib/personDocumentStatus.js";

export const peopleRouter = Router();

peopleRouter.use(requireAuth);
peopleRouter.use(resolveRequestContext);

function checkPermission(req: AuthenticatedRequest, action: "view" | "create" | "edit" | "delete" | "upload_document"): boolean {
  const { admin, map } = buildPermissionsForRole(req.auth?.role);
  if (admin) return true;
  return map[`people.${action}`]?.allowed ?? false;
}

function mapIdentityDocument(d: any) {
  return {
    id: d.id,
    document_type: d.documentType,
    document_number: d.documentNumber,
    is_primary: d.isPrimary,
  };
}

function mapPerson(p: any, extra: Record<string, unknown> = {}) {
  return {
    id: p.id,
    workspace_id: p.workspaceId,
    type: p.type,
    full_name: p.fullName,
    id_documents: Array.isArray(p.identityDocuments) ? p.identityDocuments.map(mapIdentityDocument) : [],
    birth_date: p.birthDate ? p.birthDate.toISOString() : null,
    email: p.email,
    phone: p.phone,
    role: p.role,
    department: p.department,
    location_id: p.locationId,
    location_name: p.location?.name ?? null,
    system_access_user_id: p.systemAccessUserId,
    tax_id: p.taxId,
    address: p.address,
    fiscal_data: p.fiscalData ?? null,
    source_invoice_document_id: p.sourceInvoiceDocumentId,
    status: p.status,
    notes: p.notes,
    created_at: p.createdAt.toISOString(),
    updated_at: p.updatedAt.toISOString(),
    ...extra,
  };
}

function mapDocument(d: any, today = new Date()) {
  return {
    id: d.id,
    name: d.name,
    display_name: d.displayName,
    storage_path: d.storagePath,
    mime_type: d.mimeType,
    size_bytes: d.sizeBytes,
    issue_date: d.issueDate ? d.issueDate.toISOString() : null,
    expiry_date: d.expiryDate ? d.expiryDate.toISOString() : null,
    country_requirement_id: d.countryRequirementId,
    status: computeDocumentStatus(d, today),
    uploaded_by: d.uploadedBy,
    created_at: d.createdAt.toISOString(),
  };
}

async function computeDocumentsPendingCount(personId: string, locationCountry: string | null): Promise<number> {
  if (!locationCountry) return 0;
  const [requirements, documents] = await Promise.all([
    prisma.countryDocumentRequirement.findMany({ where: { country: locationCountry, active: true } }),
    prisma.document.findMany({ where: { entityType: "person", parentId: personId } }),
  ]);
  const summary = buildPersonDocumentSummary(requirements, documents as any);
  return summary.filter((s) => s.status === "pending").length;
}

// GET /people?type=&status=&location_id=&search=
peopleRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "view")) {
    return res.status(403).json({ message: "Você não tem permissão para visualizar Pessoas." });
  }
  const { type, status, location_id, search } = req.query as Record<string, string | undefined>;

  const people = await prisma.person.findMany({
    where: {
      deletedAt: null,
      ...(req.ctx?.activeWorkspaceId ? { workspaceId: req.ctx.activeWorkspaceId } : {}),
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
      ...(location_id ? { locationId: location_id } : {}),
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: { location: { select: { name: true, addressCountry: true } }, identityDocuments: true },
    orderBy: { fullName: "asc" },
  });

  const withPending = await Promise.all(
    people.map(async (p) => {
      const pendingCount =
        p.type === "technician" || p.type === "provider_operational"
          ? await computeDocumentsPendingCount(p.id, p.location?.addressCountry ?? null)
          : 0;
      return mapPerson(p, { documents_pending_count: pendingCount });
    })
  );

  return res.json(withPending);
});

// GET /people/:id
peopleRouter.get("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "view")) {
    return res.status(403).json({ message: "Você não tem permissão para visualizar Pessoas." });
  }
  const person = await prisma.person.findFirst({
    where: { id: req.params["id"] as string, deletedAt: null },
    include: { location: true, identityDocuments: true },
  });
  if (!person) return res.status(404).json({ message: "Pessoa não encontrada." });
  if (person.workspaceId && req.ctx?.activeWorkspaceId && person.workspaceId !== req.ctx.activeWorkspaceId) {
    return res.status(403).json({ message: "Acesso negado: pessoa pertence a outro workspace." });
  }

  let documentsSummary: unknown[] = [];
  let countryNotConfigured = false;
  if (person.type === "technician" || person.type === "provider_operational") {
    const country = person.location?.addressCountry ?? null;
    if (country) {
      const [requirements, documents] = await Promise.all([
        prisma.countryDocumentRequirement.findMany({ where: { country, active: true }, orderBy: { sortOrder: "asc" } }),
        prisma.document.findMany({ where: { entityType: "person", parentId: person.id } }),
      ]);
      documentsSummary = buildPersonDocumentSummary(requirements, documents as any);
      countryNotConfigured = requirements.length === 0;
    } else {
      countryNotConfigured = true;
    }
  }

  return res.json(mapPerson(person, { documents_summary: documentsSummary, country_not_configured: countryNotConfigured }));
});

// POST /people
peopleRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "create")) {
    return res.status(403).json({ message: "Você não tem permissão para criar Pessoas." });
  }
  const body = req.body ?? {};
  if (!isPersonType(body.type)) {
    return res.status(400).json({ message: "type inválido. Use: administrative, technician, provider_operational ou provider_administrative." });
  }
  const type = body.type as PersonType;

  const missing = findMissingPersonFields({ ...body, type });
  if (missing.length > 0) {
    return res.status(400).json({ message: `Campos obrigatórios ausentes: ${missing.join(", ")}.` });
  }

  const requiresLocation = TYPES_REQUIRING_LOCATION.includes(type);

  let warning: string | null = null;
  if (type === "provider_administrative" && body.tax_id) {
    const duplicate = await prisma.person.findFirst({
      where: { taxId: String(body.tax_id).trim(), deletedAt: null, status: "active", type: "provider_administrative" },
    });
    if (duplicate) warning = "tax_id_duplicate";
  }

  const idDocuments: Array<{ document_type?: unknown; document_number?: unknown; is_primary?: unknown }> = Array.isArray(body.id_documents)
    ? body.id_documents
    : [];

  const person = await prisma.person.create({
    data: {
      workspaceId: req.ctx?.activeWorkspaceId ?? body.workspace_id ?? null,
      type,
      fullName: String(body.full_name).trim(),
      birthDate: body.birth_date ? new Date(body.birth_date) : null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      role: body.role ?? null,
      department: body.department ?? null,
      locationId: requiresLocation ? body.location_id : null,
      systemAccessUserId: body.system_access_user_id ?? null,
      taxId: body.tax_id ?? null,
      address: body.address ?? null,
      fiscalData: body.fiscal_data ?? null,
      sourceInvoiceDocumentId: body.source_invoice_document_id ?? null,
      status: body.status === "inactive" ? "inactive" : "active",
      notes: body.notes ?? null,
      createdBy: req.auth?.userId ?? null,
      identityDocuments: {
        create: idDocuments
          .filter((d) => String(d.document_type ?? "").trim() && String(d.document_number ?? "").trim())
          .map((d, i) => ({
            documentType: String(d.document_type).trim(),
            documentNumber: String(d.document_number).trim(),
            isPrimary: Boolean(d.is_primary) || i === 0,
          })),
      },
    },
    include: { location: { select: { name: true, addressCountry: true } }, identityDocuments: true },
  });

  return res.status(201).json(mapPerson(person, warning ? { warning } : {}));
});

// PATCH /people/:id
peopleRouter.patch("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "edit")) {
    return res.status(403).json({ message: "Você não tem permissão para editar Pessoas." });
  }
  const id = req.params["id"] as string;
  const existing = await prisma.person.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return res.status(404).json({ message: "Pessoa não encontrada." });
  if (existing.workspaceId && req.ctx?.activeWorkspaceId && existing.workspaceId !== req.ctx.activeWorkspaceId) {
    return res.status(403).json({ message: "Acesso negado: pessoa pertence a outro workspace." });
  }

  const body = req.body ?? {};
  const type = (isPersonType(body.type) ? body.type : existing.type) as PersonType;

  const existingIdDocuments = body.id_documents === undefined
    ? (await prisma.personIdentityDocument.findMany({ where: { personId: id } })).map((d) => ({
        document_type: d.documentType,
        document_number: d.documentNumber,
      }))
    : undefined;

  const merged = {
    full_name: body.full_name ?? existing.fullName,
    id_documents: body.id_documents !== undefined ? body.id_documents : existingIdDocuments,
    email: body.email ?? existing.email,
    location_id: body.location_id ?? existing.locationId,
    tax_id: body.tax_id ?? existing.taxId,
    address: body.address ?? existing.address,
    type,
  };
  const missing = findMissingPersonFields(merged);
  if (missing.length > 0) {
    return res.status(400).json({ message: `Campos obrigatórios ausentes: ${missing.join(", ")}.` });
  }

  const fieldMap: Record<string, string> = {
    type: "type",
    full_name: "fullName",
    email: "email",
    phone: "phone",
    role: "role",
    department: "department",
    location_id: "locationId",
    system_access_user_id: "systemAccessUserId",
    tax_id: "taxId",
    address: "address",
    fiscal_data: "fiscalData",
    status: "status",
    notes: "notes",
  };
  const data: Record<string, unknown> = {};
  for (const [bodyKey, prismaKey] of Object.entries(fieldMap)) {
    if (body[bodyKey] !== undefined) data[prismaKey] = body[bodyKey];
  }
  if (body.birth_date !== undefined) data.birthDate = body.birth_date ? new Date(body.birth_date) : null;

  const idDocuments: Array<{ document_type?: unknown; document_number?: unknown; is_primary?: unknown }> | undefined =
    Array.isArray(body.id_documents) ? body.id_documents : undefined;

  const person = await prisma.$transaction(async (tx) => {
    if (idDocuments) {
      await tx.personIdentityDocument.deleteMany({ where: { personId: id } });
      await tx.personIdentityDocument.createMany({
        data: idDocuments
          .filter((d) => String(d.document_type ?? "").trim() && String(d.document_number ?? "").trim())
          .map((d, i) => ({
            personId: id,
            documentType: String(d.document_type).trim(),
            documentNumber: String(d.document_number).trim(),
            isPrimary: Boolean(d.is_primary) || i === 0,
          })),
      });
    }
    return tx.person.update({
      where: { id },
      data,
      include: { location: { select: { name: true, addressCountry: true } }, identityDocuments: true },
    });
  });
  return res.json(mapPerson(person));
});

// DELETE /people/:id (soft delete)
peopleRouter.delete("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "delete")) {
    return res.status(403).json({ message: "Você não tem permissão para excluir Pessoas." });
  }
  const id = req.params["id"] as string;
  const existing = await prisma.person.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return res.status(404).json({ message: "Pessoa não encontrada." });
  if (existing.workspaceId && req.ctx?.activeWorkspaceId && existing.workspaceId !== req.ctx.activeWorkspaceId) {
    return res.status(403).json({ message: "Acesso negado: pessoa pertence a outro workspace." });
  }
  await prisma.person.update({
    where: { id },
    data: { deletedAt: new Date(), deletedBy: req.auth?.userId ?? null },
  });
  return res.json({ deleted: 1 });
});

// GET /people/:id/documents
peopleRouter.get("/:id/documents", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "view")) {
    return res.status(403).json({ message: "Você não tem permissão para visualizar documentos." });
  }
  const person = await prisma.person.findFirst({ where: { id: req.params["id"] as string, deletedAt: null } });
  if (!person) return res.status(404).json({ message: "Pessoa não encontrada." });
  if (person.workspaceId && req.ctx?.activeWorkspaceId && person.workspaceId !== req.ctx.activeWorkspaceId) {
    return res.status(403).json({ message: "Acesso negado: pessoa pertence a outro workspace." });
  }
  const documents = await prisma.document.findMany({
    where: { entityType: "person", parentId: req.params["id"] as string },
    orderBy: { createdAt: "desc" },
  });
  return res.json(documents.map((d) => mapDocument(d)));
});

// POST /people/:id/documents — cria o registro após o upload físico via /api/storage/upload
peopleRouter.post("/:id/documents", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "upload_document")) {
    return res.status(403).json({ message: "Você não tem permissão para anexar documentos." });
  }
  const personId = req.params["id"] as string;
  const body = req.body ?? {};
  if (!body.name || !body.storage_path) {
    return res.status(400).json({ message: "Campos obrigatórios: name, storage_path." });
  }

  const person = await prisma.person.findFirst({ where: { id: personId, deletedAt: null } });
  if (!person) return res.status(404).json({ message: "Pessoa não encontrada." });
  if (person.workspaceId && req.ctx?.activeWorkspaceId && person.workspaceId !== req.ctx.activeWorkspaceId) {
    return res.status(403).json({ message: "Acesso negado: pessoa pertence a outro workspace." });
  }

  const document = await prisma.document.create({
    data: {
      name: String(body.name),
      entityType: "person",
      module: "pessoas",
      parentId: personId,
      storagePath: String(body.storage_path),
      mimeType: body.mime_type ?? null,
      sizeBytes: body.size_bytes ?? null,
      issueDate: body.issue_date ? new Date(body.issue_date) : null,
      expiryDate: body.expiry_date ? new Date(body.expiry_date) : null,
      countryRequirementId: body.country_requirement_id ?? null,
      uploadedBy: req.auth?.userId ?? null,
      workspaceId: person.workspaceId,
    },
  });
  return res.status(201).json(mapDocument(document));
});

// DELETE /people/:id/documents/:documentId
peopleRouter.delete("/:id/documents/:documentId", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "upload_document")) {
    return res.status(403).json({ message: "Você não tem permissão para remover documentos." });
  }
  const person = await prisma.person.findFirst({ where: { id: req.params["id"] as string, deletedAt: null } });
  if (!person) return res.status(404).json({ message: "Pessoa não encontrada." });
  if (person.workspaceId && req.ctx?.activeWorkspaceId && person.workspaceId !== req.ctx.activeWorkspaceId) {
    return res.status(403).json({ message: "Acesso negado: pessoa pertence a outro workspace." });
  }
  const doc = await prisma.document.findUnique({ where: { id: req.params["documentId"] as string } });
  if (!doc || doc.parentId !== person.id) return res.status(404).json({ message: "Documento não encontrado." });
  await prisma.document.delete({ where: { id: req.params["documentId"] as string } });
  return res.json({ deleted: 1 });
});

