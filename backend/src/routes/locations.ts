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
    maps_url: l.mapsUrl ?? null,
    created_at: l.createdAt.toISOString(),
    updated_at: l.updatedAt.toISOString(),
  };
}

export async function resolveMapUrlToAddress(rawUrl: string): Promise<{
  success: boolean;
  latitude: number | null;
  longitude: number | null;
  resolved_url: string;
  is_approximate: boolean;
  address: {
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  name_hint?: string | null;
}> {
  let finalUrl = rawUrl.trim();

  // 1. Resolver redirects (se for link encurtador de compartilhamento)
  if (/goo\.gl|maps\.app\.goo\.gl|waze\.com/i.test(finalUrl)) {
    try {
      const resp = await fetch(finalUrl, {
        method: "GET",
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        signal: AbortSignal.timeout(7000),
      });
      finalUrl = resp.url || finalUrl;
    } catch {
      // continua com a URL original se falhar o redirect
    }
  }

  let lat: number | null = null;
  let lon: number | null = null;
  let nameHint: string | null = null;

  // Extrair nameHint de /place/Nome+Do+Lugar/
  const placeMatch = finalUrl.match(/\/place\/([^/@?]+)/i);
  if (placeMatch && placeMatch[1]) {
    try {
      nameHint = decodeURIComponent(placeMatch[1].replace(/\+/g, " "));
    } catch {}
  }

  // Regex 1: @lat,lon (Google Maps padrão)
  const atMatch = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (atMatch) {
    lat = parseFloat(atMatch[1]);
    lon = parseFloat(atMatch[2]);
  }

  // Regex 2: !3dlat!4dlon (Google Maps data embed)
  if (lat == null) {
    const dataMatch = finalUrl.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (dataMatch) {
      lat = parseFloat(dataMatch[1]);
      lon = parseFloat(dataMatch[2]);
    }
  }

  // Regex 3: ?q=lat,lon ou ll=lat,lon ou query=lat,lon (Google Maps / Waze)
  if (lat == null) {
    const qMatch = finalUrl.match(/[?&](?:q|ll|query)=(-?\d+\.\d+)[,%20]+(-?\d+\.\d+)/i);
    if (qMatch) {
      lat = parseFloat(qMatch[1]);
      lon = parseFloat(qMatch[2]);
    }
  }

  // Regex 4: OpenStreetMap (#map=zoom/lat/lon ou ?mlat=...&mlon=...)
  if (lat == null) {
    const osmMatch = finalUrl.match(/#map=\d+\/(-?\d+\.\d+)\/(-?\d+\.\d+)/);
    if (osmMatch) {
      lat = parseFloat(osmMatch[1]);
      lon = parseFloat(osmMatch[2]);
    }
    const osmQMatch = finalUrl.match(/[?&]mlat=(-?\d+\.\d+)&mlon=(-?\d+\.\d+)/i);
    if (osmQMatch) {
      lat = parseFloat(osmQMatch[1]);
      lon = parseFloat(osmQMatch[2]);
    }
  }

  // Regex 5: Coordenadas brutas digitadas/coladas
  if (lat == null) {
    const directMatch = finalUrl.match(/^(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)$/);
    if (directMatch) {
      lat = parseFloat(directMatch[1]);
      lon = parseFloat(directMatch[2]);
    }
  }

  // Fallback: se não encontrou coordenadas por regex, mas tem termo de busca, geocodifica
  if (lat == null) {
    const qTextMatch = finalUrl.match(/[?&]q=([^&]+)/i);
    const searchTarget = nameHint || (qTextMatch ? decodeURIComponent(qTextMatch[1].replace(/\+/g, " ")) : null);
    if (searchTarget) {
      try {
        const nomSearchUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchTarget)}&limit=1&addressdetails=1&accept-language=pt`;
        const sResp = await fetch(nomSearchUrl, {
          headers: { "User-Agent": "Operix-Operations/1.0 (admin@operix-pro.com)" },
          signal: AbortSignal.timeout(6000),
        });
        if (sResp.ok) {
          const sData = await sResp.json();
          const first = Array.isArray(sData) && sData[0];
          if (first?.lat && first?.lon) {
            lat = parseFloat(first.lat);
            lon = parseFloat(first.lon);
            const addr = first.address || {};
            return {
              success: true,
              latitude: lat,
              longitude: lon,
              resolved_url: finalUrl,
              is_approximate: true,
              address: {
                street: addr.road || addr.pedestrian || addr.footway || searchTarget,
                number: addr.house_number || "",
                neighborhood: addr.suburb || addr.neighbourhood || addr.city_district || "",
                city: addr.city || addr.town || addr.municipality || addr.village || "",
                state: addr.state || addr.province || addr.region || "",
                zip: addr.postcode || "",
                country: addr.country || "",
              },
              name_hint: nameHint,
            };
          }
        }
      } catch {}
    }
  }

  if (lat == null || lon == null) {
    throw new Error("Não foi possível identificar coordenadas geográficas a partir deste link.");
  }

  // Reverse Geocode com Nominatim
  const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&addressdetails=1&accept-language=pt`;
  const nomResp = await fetch(nomUrl, {
    headers: { "User-Agent": "Operix-Operations/1.0 (admin@operix-pro.com)" },
    signal: AbortSignal.timeout(6000),
  });

  if (!nomResp.ok) {
    throw new Error("Serviço de geocodificação temporariamente indisponível.");
  }

  const nomData = await nomResp.json();
  const addr = nomData?.address || {};

  return {
    success: true,
    latitude: lat,
    longitude: lon,
    resolved_url: finalUrl,
    is_approximate: !addr.house_number,
    address: {
      street: addr.road || addr.pedestrian || addr.footway || addr.amenity || addr.building || "",
      number: addr.house_number || "",
      neighborhood: addr.suburb || addr.neighbourhood || addr.city_district || "",
      city: addr.city || addr.town || addr.municipality || addr.village || "",
      state: addr.state || addr.province || addr.region || "",
      zip: addr.postcode || "",
      country: addr.country || "",
    },
    name_hint: nameHint || addr.amenity || addr.tourism || addr.shop || null,
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

// POST /locations/resolve-map-url
locationsRouter.post("/resolve-map-url", async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const url = String(req.body?.url ?? "").trim();
    if (!url) {
      return res.status(400).json({ message: "URL ou termo do mapa obrigatório." });
    }
    const result = await resolveMapUrlToAddress(url);
    return res.json(result);
  } catch (err: any) {
    return res.status(400).json({ message: err?.message || "Não foi possível identificar o endereço a partir deste link." });
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
        mapsUrl: body.maps_url ? String(body.maps_url).trim() : null,
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
      maps_url: "mapsUrl",
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
