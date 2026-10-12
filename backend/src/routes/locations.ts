import { Router, type Response, type NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { resolveRequestContext } from "../middleware/requestContext.js";
import { assertTenantAccess } from "../lib/objectAuth.js";
import { buildPermissionsForRole } from "../lib/permissionPolicy.js";

export const locationsRouter = Router();

locationsRouter.use(requireAuth);
locationsRouter.use(resolveRequestContext);

function checkPermission(req: AuthenticatedRequest, action: "view" | "create" | "edit" | "delete"): boolean {
  const role = req.ctx?.membershipRole ?? req.auth?.role;
  const { admin, map } = buildPermissionsForRole(role);
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
    latitude: l.latitude != null ? Number(l.latitude) : null,
    longitude: l.longitude != null ? Number(l.longitude) : null,
    is_approximate: Boolean(l.isApproximate),
    created_at: l.createdAt.toISOString(),
    updated_at: l.updatedAt.toISOString(),
  };
}

async function geocodeLocationAddress(parts: {
  street?: string | null;
  number?: string | null;
  city?: string | null;
  country?: string | null;
  zip?: string | null;
}): Promise<{ latitude: number | null; longitude: number | null; isApproximate: boolean }> {
  const query = [
    [parts.street, parts.number].filter(Boolean).join(" "),
    parts.zip,
    parts.city,
    parts.country,
  ]
    .filter(Boolean)
    .join(", ")
    .trim();

  if (!query) return { latitude: null, longitude: null, isApproximate: true };

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&accept-language=pt`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Operix-Operations/1.0 (admin@operix-pro.com)" },
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const data = await res.json();
      const first = Array.isArray(data) && data[0];
      if (first?.lat && first?.lon) {
        return {
          latitude: Number(first.lat),
          longitude: Number(first.lon),
          isApproximate: false,
        };
      }
    }
  } catch {
    // Graceful fallback on network timeout/failure
  }

  // Graceful fallback: try searching city + country if specific street was not indexed
  if (parts.city) {
    try {
      const cityQuery = [parts.city, parts.country].filter(Boolean).join(", ");
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(cityQuery)}&limit=1&accept-language=pt`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Operix-Operations/1.0 (admin@operix-pro.com)" },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json();
        const first = Array.isArray(data) && data[0];
        if (first?.lat && first?.lon) {
          return {
            latitude: Number(first.lat),
            longitude: Number(first.lon),
            isApproximate: true, // Tagged approximate
          };
        }
      }
    } catch {}
  }

  return { latitude: null, longitude: null, isApproximate: true };
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
locationsRouter.get("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo obrigatório." });
    }
    if (!checkPermission(req, "view")) {
      return res.status(403).json({ message: "Você não tem permissão para visualizar Locais." });
    }
    const { status, country, search } = req.query as Record<string, string | undefined>;

    const locations = await prisma.location.findMany({
      where: {
        workspaceId: req.ctx.activeWorkspaceId,
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
  } catch (err) {
    return next(err);
  }
});

// GET /locations/:id
locationsRouter.get("/:id", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!checkPermission(req, "view")) {
      return res.status(403).json({ message: "Você não tem permissão para visualizar Locais." });
    }
    const location = await prisma.location.findUnique({ where: { id: req.params["id"] as string } });
    if (!location) return res.status(404).json({ message: "Local não encontrado." });
    assertTenantAccess(req.ctx!, location.workspaceId);
    return res.json(mapLocation(location));
  } catch (err) {
    return next(err);
  }
});

// POST /locations
locationsRouter.post("/", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo obrigatório." });
    }
    if (!checkPermission(req, "create")) {
      return res.status(403).json({ message: "Você não tem permissão para criar Locais." });
    }
    const body = req.body ?? {};
    const missing = findMissingFields(body);
    if (missing.length > 0) {
      return res.status(400).json({ message: `Campos obrigatórios ausentes: ${missing.join(", ")}.` });
    }

    let lat = body.latitude != null ? Number(body.latitude) : null;
    let lng = body.longitude != null ? Number(body.longitude) : null;
    let isApprox = false;

    if (lat == null || lng == null) {
      const geo = await geocodeLocationAddress({
        street: body.address_street,
        number: body.address_number,
        city: body.address_city,
        country: body.address_country,
        zip: body.address_zip,
      });
      lat = geo.latitude;
      lng = geo.longitude;
      isApprox = geo.isApproximate;
    }

    const location = await prisma.location.create({
      data: {
        workspaceId: req.ctx.activeWorkspaceId,
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
        latitude: lat,
        longitude: lng,
        isApproximate: isApprox,
        createdBy: req.auth?.userId ?? null,
      },
    });
    return res.status(201).json(mapLocation(location));
  } catch (err) {
    return next(err);
  }
});

// PATCH /locations/:id
locationsRouter.patch("/:id", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!checkPermission(req, "edit")) {
      return res.status(403).json({ message: "Você não tem permissão para editar Locais." });
    }
    const id = req.params["id"] as string;
    const existing = await prisma.location.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Local não encontrado." });
    assertTenantAccess(req.ctx!, existing.workspaceId);

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

    const addressChanged =
      body.address_street !== undefined ||
      body.address_number !== undefined ||
      body.address_city !== undefined ||
      body.address_country !== undefined ||
      body.address_zip !== undefined;

    if (body.latitude !== undefined) {
      data.latitude = body.latitude != null ? Number(body.latitude) : null;
    }
    if (body.longitude !== undefined) {
      data.longitude = body.longitude != null ? Number(body.longitude) : null;
    }

    if (addressChanged && body.latitude === undefined && body.longitude === undefined) {
      const geo = await geocodeLocationAddress({
        street: (body.address_street ?? existing.addressStreet) as string,
        number: (body.address_number ?? existing.addressNumber) as string,
        city: (body.address_city ?? existing.addressCity) as string,
        country: (body.address_country ?? existing.addressCountry) as string,
        zip: (body.address_zip ?? existing.addressZip) as string,
      });
      data.latitude = geo.latitude;
      data.longitude = geo.longitude;
      data.isApproximate = geo.isApproximate;
    }

    const location = await prisma.location.update({ where: { id }, data });
    return res.json(mapLocation(location));
  } catch (err) {
    return next(err);
  }
});

// POST /locations/backfill-geocode — Geocode any existing locations missing coordinates
locationsRouter.post("/backfill-geocode", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo obrigatório." });
    }
    const locations = await prisma.location.findMany({
      where: {
        workspaceId: req.ctx.activeWorkspaceId,
        latitude: null,
      },
    });
    const results = [];
    for (const loc of locations) {
      const geo = await geocodeLocationAddress({
        street: loc.addressStreet,
        number: loc.addressNumber,
        city: loc.addressCity,
        country: loc.addressCountry,
        zip: loc.addressZip,
      });
      if (geo.latitude != null && geo.longitude != null) {
        const updated = await prisma.location.update({
          where: { id: loc.id },
          data: {
            latitude: geo.latitude,
            longitude: geo.longitude,
            isApproximate: geo.isApproximate,
          },
        });
        results.push(mapLocation(updated));
      }
    }
    return res.json({ backfilled: results.length, items: results });
  } catch (err) {
    return next(err);
  }
});

// DELETE /locations/:id — bloqueado se houver Pessoa vinculada (inativar em vez de excluir)
locationsRouter.delete("/:id", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!checkPermission(req, "delete")) {
      return res.status(403).json({ message: "Você não tem permissão para excluir Locais." });
    }
    const id = req.params["id"] as string;
    const existing = await prisma.location.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: "Local não encontrado." });
    assertTenantAccess(req.ctx!, existing.workspaceId);

    const peopleCount = await prisma.person.count({ where: { locationId: id, deletedAt: null } });
    if (peopleCount > 0) {
      return res.status(409).json({
        message: `Não é possível excluir: ${peopleCount} pessoa(s) vinculada(s) a este Local. Inative o Local em vez de excluir.`,
      });
    }
    await prisma.location.delete({ where: { id } });
    return res.json({ deleted: 1 });
  } catch (err) {
    return next(err);
  }
});
