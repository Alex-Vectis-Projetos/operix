import { Router, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { resolveRequestContext } from "../middleware/requestContext.js";
import { buildPermissionsForRole } from "../lib/permissionPolicy.js";

export const locationsRouter = Router();

locationsRouter.use(requireAuth);
locationsRouter.use(resolveRequestContext);

function checkPermission(req: AuthenticatedRequest, action: "view" | "create" | "edit" | "delete"): boolean {
  const { admin, map } = buildPermissionsForRole(req.auth?.role);
  if (admin) return true;
  return map[`locations.${action}`]?.allowed ?? false;
}

function mapLocation(l: any) {
  return {
    id: l.id,
    workspace_id: l.workspaceId,
    name: l.name,
    address_street: l.addressStreet,
    address_number: l.addressNumber,
    address_neighborhood: l.addressNeighborhood,
    address_city: l.addressCity,
    address_state: l.addressState,
    address_zip: l.addressZip,
    address_country: l.addressCountry,
    phone: l.phone,
    email: l.email,
    manager_name: l.managerName,
    manager_phone: l.managerPhone,
    manager_email: l.managerEmail,
    status: l.status,
    created_at: l.createdAt.toISOString(),
    updated_at: l.updatedAt.toISOString(),
  };
}

const REQUIRED_FIELDS: Array<[string, string]> = [
  ["name", "Nome do local"],
  ["address_street", "Rua"],
  ["address_city", "Cidade"],
  ["address_country", "País"],
  ["manager_name", "Nome do gerente responsável"],
];

function findMissingFields(body: Record<string, unknown>): string[] {
  return REQUIRED_FIELDS.filter(([key]) => !String(body[key] ?? "").trim()).map(([, label]) => label);
}

// GET /locations?status=&country=&search=
locationsRouter.get("/", async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "view")) {
    return res.status(403).json({ message: "Você não tem permissão para visualizar Locais." });
  }
  const { status, country, search } = req.query as Record<string, string | undefined>;

  const locations = await prisma.location.findMany({
    where: {
      ...(req.ctx?.activeWorkspaceId ? { workspaceId: req.ctx.activeWorkspaceId } : {}),
      ...(status ? { status } : {}),
      ...(country ? { addressCountry: country } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { addressCity: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
  });
  return res.json(locations.map(mapLocation));
});

// GET /locations/:id
locationsRouter.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "view")) {
    return res.status(403).json({ message: "Você não tem permissão para visualizar Locais." });
  }
  const location = await prisma.location.findUnique({ where: { id: req.params["id"] as string } });
  if (!location) return res.status(404).json({ message: "Local não encontrado." });
  if (location.workspaceId && req.ctx?.activeWorkspaceId && location.workspaceId !== req.ctx.activeWorkspaceId) {
    return res.status(403).json({ message: "Acesso negado: local pertence a outro workspace." });
  }
  return res.json(mapLocation(location));
});

// POST /locations
locationsRouter.post("/", async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "create")) {
    return res.status(403).json({ message: "Você não tem permissão para criar Locais." });
  }
  const body = req.body ?? {};
  const missing = findMissingFields(body);
  if (missing.length > 0) {
    return res.status(400).json({ message: `Campos obrigatórios ausentes: ${missing.join(", ")}.` });
  }

  const location = await prisma.location.create({
    data: {
      workspaceId: req.ctx?.activeWorkspaceId ?? body.workspace_id ?? null,
      name: String(body.name).trim(),
      addressStreet: String(body.address_street).trim(),
      addressNumber: body.address_number ?? null,
      addressNeighborhood: body.address_neighborhood ?? null,
      addressCity: String(body.address_city).trim(),
      addressState: body.address_state ?? null,
      addressZip: body.address_zip ?? null,
      addressCountry: String(body.address_country).trim(),
      phone: body.phone ?? null,
      email: body.email ?? null,
      managerName: String(body.manager_name).trim(),
      managerPhone: body.manager_phone ?? null,
      managerEmail: body.manager_email ?? null,
      status: body.status === "inactive" ? "inactive" : "active",
      createdBy: req.auth?.userId ?? null,
    },
  });
  return res.status(201).json(mapLocation(location));
});

// PATCH /locations/:id
locationsRouter.patch("/:id", async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "edit")) {
    return res.status(403).json({ message: "Você não tem permissão para editar Locais." });
  }
  const id = req.params["id"] as string;
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ message: "Local não encontrado." });
  if (existing.workspaceId && req.ctx?.activeWorkspaceId && existing.workspaceId !== req.ctx.activeWorkspaceId) {
    return res.status(403).json({ message: "Acesso negado: local pertence a outro workspace." });
  }

  const body = req.body ?? {};

  const fieldMap: Record<string, string> = {
    name: "name",
    address_street: "addressStreet",
    address_number: "addressNumber",
    address_neighborhood: "addressNeighborhood",
    address_city: "addressCity",
    address_state: "addressState",
    address_zip: "addressZip",
    address_country: "addressCountry",
    phone: "phone",
    email: "email",
    manager_name: "managerName",
    manager_phone: "managerPhone",
    manager_email: "managerEmail",
    status: "status",
  };

  const data: Record<string, unknown> = {};
  for (const [bodyKey, prismaKey] of Object.entries(fieldMap)) {
    if (body[bodyKey] !== undefined) data[prismaKey] = body[bodyKey];
  }
  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: "Nenhum campo para atualizar." });
  }

  try {
    const location = await prisma.location.update({ where: { id }, data });
    return res.json(mapLocation(location));
  } catch {
    return res.status(404).json({ message: "Local não encontrado." });
  }
});

// DELETE /locations/:id — bloqueado se houver Pessoa vinculada (inativar em vez de excluir)
locationsRouter.delete("/:id", async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "delete")) {
    return res.status(403).json({ message: "Você não tem permissão para excluir Locais." });
  }
  const id = req.params["id"] as string;
  const existing = await prisma.location.findUnique({ where: { id } });
  if (!existing) return res.status(404).json({ message: "Local não encontrado." });
  if (existing.workspaceId && req.ctx?.activeWorkspaceId && existing.workspaceId !== req.ctx.activeWorkspaceId) {
    return res.status(403).json({ message: "Acesso negado: local pertence a outro workspace." });
  }

  const peopleCount = await prisma.person.count({ where: { locationId: id, deletedAt: null } });
  if (peopleCount > 0) {
    return res.status(409).json({
      message: `Não é possível excluir: ${peopleCount} pessoa(s) vinculada(s) a este Local. Inative o Local em vez de excluir.`,
    });
  }
  await prisma.location.delete({ where: { id } });
  return res.json({ deleted: 1 });
});
