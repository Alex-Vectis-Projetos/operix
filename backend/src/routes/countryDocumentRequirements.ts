import { Router, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { buildPermissionsForRole } from "../lib/permissionPolicy.js";

export const countryDocumentRequirementsRouter = Router();

function checkPermission(req: AuthenticatedRequest, action: "view" | "edit"): boolean {
  const { admin, map } = buildPermissionsForRole(req.auth?.role);
  if (admin) return true;
  return map[`country_document_requirements.${action}`]?.allowed ?? false;
}

function mapRequirement(r: any) {
  return {
    id: r.id,
    country: r.country,
    document_name: r.documentName,
    applies_to: r.appliesTo,
    sort_order: r.sortOrder,
    active: r.active,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

// GET /country-document-requirements?country=&active=
countryDocumentRequirementsRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "view")) {
    return res.status(403).json({ message: "Você não tem permissão para visualizar esta configuração." });
  }
  const { country, active } = req.query as Record<string, string | undefined>;
  // active ausente -> só ativos (default); active=all -> sem filtro (ativos+inativos); active=true/false -> filtro explícito.
  const activeFilter: boolean | undefined = active === undefined ? true : active === "all" ? undefined : active === "true";
  const requirements = await prisma.countryDocumentRequirement.findMany({
    where: {
      ...(country ? { country } : {}),
      active: activeFilter,
    },
    orderBy: [{ country: "asc" }, { sortOrder: "asc" }],
  });
  return res.json(requirements.map(mapRequirement));
});

// GET /country-document-requirements/countries — lista distinta de países configurados
countryDocumentRequirementsRouter.get("/countries", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "view")) {
    return res.status(403).json({ message: "Você não tem permissão para visualizar esta configuração." });
  }
  const rows = await prisma.countryDocumentRequirement.findMany({
    where: { active: true },
    select: { country: true },
    distinct: ["country"],
    orderBy: { country: "asc" },
  });
  return res.json(rows.map((r) => r.country));
});

const DEFAULT_COUNTRY_TEMPLATES: Record<string, Array<{ name: string; appliesTo: "both" | "technician" | "provider_operational" }>> = {
  "Portugal": [
    { name: "Documento de Identificação (CC / Passaporte / Título de Residência)", appliesTo: "both" },
    { name: "Comprovativo de Início de Atividade / Certidão de Empresa", appliesTo: "both" },
    { name: "Seguro de Responsabilidade Civil / Acidentes de Trabalho", appliesTo: "both" },
    { name: "Comprovativo de Morada / Domicílio Fiscal", appliesTo: "both" },
    { name: "Certificação Técnica PDR / Automóvel", appliesTo: "technician" },
    { name: "Carta de Condução", appliesTo: "both" },
  ],
  "Bélgica": [
    { name: "Documento de Identidade Oficial / Passaporte", appliesTo: "both" },
    { name: "Declaração Limosa / Documento A1 (Destacamento)", appliesTo: "both" },
    { name: "Registo Empresarial / Número de IVA (BCE / KBO)", appliesTo: "both" },
    { name: "Seguro de Responsabilidade Civil Profissional", appliesTo: "both" },
    { name: "Certificação Técnica PDR", appliesTo: "technician" },
    { name: "Carta de Condução", appliesTo: "both" },
  ],
  "Espanha": [
    { name: "Documento de Identidade (DNI / NIE / Passaporte)", appliesTo: "both" },
    { name: "Certificado de Alta no RETA / IAE / CIF", appliesTo: "both" },
    { name: "Seguro de Responsabilidade Civil", appliesTo: "both" },
    { name: "Certificado de Estar al Corriente con la Seguridad Social e Hacienda", appliesTo: "both" },
    { name: "Certificação Técnica PDR / Automóvel", appliesTo: "technician" },
    { name: "Carta de Condução", appliesTo: "both" },
  ],
  "França": [
    { name: "Pièce d'Identité / Titre de Séjour / Passeport", appliesTo: "both" },
    { name: "Extrait Kbis / Attestation URSSAF / SIRET", appliesTo: "both" },
    { name: "Assurance Responsabilité Civile Professionnelle (RC Pro)", appliesTo: "both" },
    { name: "Attestation A1 (si détachement européen)", appliesTo: "both" },
    { name: "Certificação Técnica PDR", appliesTo: "technician" },
    { name: "Permis de Conduire", appliesTo: "both" },
  ],
  "Alemanha": [
    { name: "Personalausweis / Reisepass (Identificação Oficial)", appliesTo: "both" },
    { name: "Gewerbeanmeldung (Registo de Atividade Comercial)", appliesTo: "both" },
    { name: "Betriebshaftpflichtversicherung (Seguro de Responsabilidade)", appliesTo: "both" },
    { name: "Freistellungsbescheinigung (Certificado Fiscal)", appliesTo: "both" },
    { name: "Certificação Técnica PDR", appliesTo: "technician" },
    { name: "Führerschein (Carta de Condução)", appliesTo: "both" },
  ],
  "Brasil": [
    { name: "Documento de Identidade Oficial (RG / CNH) e CPF", appliesTo: "both" },
    { name: "Comprovante de CNPJ / MEI / Contrato Social", appliesTo: "both" },
    { name: "Comprovante de Residência Atualizado", appliesTo: "both" },
    { name: "Certificado de Formação / Qualificação Técnica PDR", appliesTo: "technician" },
    { name: "Carteira Nacional de Habilitação (CNH)", appliesTo: "both" },
  ],
  "default": [
    { name: "Documento Oficial de Identificação / Passaporte", appliesTo: "both" },
    { name: "Comprovativo de Registo Fiscal e Empresarial", appliesTo: "both" },
    { name: "Seguro de Responsabilidade Civil Profissional", appliesTo: "both" },
    { name: "Comprovativo de Morada / Domicílio", appliesTo: "both" },
    { name: "Certificação Técnica / Qualificação PDR", appliesTo: "technician" },
    { name: "Carta / Licença de Condução", appliesTo: "both" },
  ],
};

// POST /country-document-requirements/seed-defaults — popula matriz padrão recomendada para o país
countryDocumentRequirementsRouter.post("/seed-defaults", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "edit")) {
    return res.status(403).json({ message: "Você não tem permissão para editar esta configuração." });
  }
  const { country } = req.body ?? {};
  const cName = String(country ?? "").trim();
  if (!cName) {
    return res.status(400).json({ message: "country é obrigatório." });
  }

  const templates = DEFAULT_COUNTRY_TEMPLATES[cName] ?? DEFAULT_COUNTRY_TEMPLATES["default"];
  const results = [];
  let order = 1;

  for (const item of templates) {
    const existing = await prisma.countryDocumentRequirement.findUnique({
      where: { country_documentName: { country: cName, documentName: item.name } },
    });
    if (existing) {
      if (!existing.active) {
        const reactivated = await prisma.countryDocumentRequirement.update({
          where: { id: existing.id },
          data: { active: true, appliesTo: item.appliesTo, sortOrder: order },
        });
        results.push(mapRequirement(reactivated));
      } else {
        results.push(mapRequirement(existing));
      }
    } else {
      const created = await prisma.countryDocumentRequirement.create({
        data: {
          country: cName,
          documentName: item.name,
          appliesTo: item.appliesTo,
          sortOrder: order,
          active: true,
        },
      });
      results.push(mapRequirement(created));
    }
    order++;
  }

  return res.status(201).json(results);
});

// POST /country-document-requirements
countryDocumentRequirementsRouter.post("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "edit")) {
    return res.status(403).json({ message: "Você não tem permissão para editar esta configuração." });
  }
  const { country, document_name, applies_to, sort_order } = req.body ?? {};
  if (!String(country ?? "").trim() || !String(document_name ?? "").trim()) {
    return res.status(400).json({ message: "country e document_name são obrigatórios." });
  }

  const existing = await prisma.countryDocumentRequirement.findUnique({
    where: { country_documentName: { country: String(country).trim(), documentName: String(document_name).trim() } },
  });
  if (existing && existing.active) {
    return res.status(409).json({ message: "Este documento já está configurado para este país." });
  }
  if (existing && !existing.active) {
    const reactivated = await prisma.countryDocumentRequirement.update({
      where: { id: existing.id },
      data: { active: true, sortOrder: sort_order ?? existing.sortOrder, appliesTo: applies_to ?? existing.appliesTo },
    });
    return res.status(201).json(mapRequirement(reactivated));
  }

  const requirement = await prisma.countryDocumentRequirement.create({
    data: {
      country: String(country).trim(),
      documentName: String(document_name).trim(),
      appliesTo: applies_to === "technician" || applies_to === "provider_operational" ? applies_to : "both",
      sortOrder: typeof sort_order === "number" ? sort_order : 0,
    },
  });
  return res.status(201).json(mapRequirement(requirement));
});

// PATCH /country-document-requirements/:id — inclui remoção lógica via active:false (FR-020/FR-023)
countryDocumentRequirementsRouter.patch("/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "edit")) {
    return res.status(403).json({ message: "Você não tem permissão para editar esta configuração." });
  }
  const id = req.params["id"] as string;
  const { document_name, applies_to, sort_order, active } = req.body ?? {};

  const data: Record<string, unknown> = {};
  if (document_name !== undefined) data.documentName = String(document_name).trim();
  if (applies_to !== undefined) data.appliesTo = applies_to;
  if (sort_order !== undefined) data.sortOrder = sort_order;
  if (active !== undefined) data.active = Boolean(active);

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ message: "Nenhum campo para atualizar." });
  }

  try {
    const requirement = await prisma.countryDocumentRequirement.update({ where: { id }, data });
    return res.json(mapRequirement(requirement));
  } catch {
    return res.status(404).json({ message: "Documento obrigatório não encontrado." });
  }
});

// DELETE /country-document-requirements/:id — nunca hard delete (preserva Document.countryRequirementId)
countryDocumentRequirementsRouter.delete("/:id", requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  return res.status(405).json({
    message: "Exclusão direta não permitida. Use PATCH com { active: false } para remover logicamente sem apagar documentos já anexados.",
  });
});
