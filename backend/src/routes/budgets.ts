import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveRequestContext } from "../middleware/requestContext.js";
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  assertObjectAccess,
} from "../lib/objectAuth.js";
import {
  createBudget,
  updateBudgetRevision,
  approveBudgetRevision,
  rejectBudgetRevision,
  syncLocalBudgets,
} from "../services/budgetService.js";

export const budgetsRouter = Router();

budgetsRouter.use(requireAuth);
budgetsRouter.use(resolveRequestContext);

const createBudgetSchema = z.object({
  clientId: z.string().uuid().optional().nullable(),
  clientName: z.string().max(200).optional().nullable(),
  vehiclePlate: z.string().max(30).optional().nullable(),
  vehicleVin: z.string().max(50).optional().nullable(),
  vehicleBrand: z.string().max(100).optional().nullable(),
  vehicleModel: z.string().max(100).optional().nullable(),
  technicianUserId: z.string().uuid().optional().nullable(),
  legacyLocalId: z.string().max(100).optional().nullable(),
  currencyCode: z.string().default("EUR"),
  budgetType: z.string().default("pdr"),
  clientSnapshot: z.record(z.any()).optional().nullable(),
  vehicleSnapshot: z.record(z.any()).optional().nullable(),
  dossierSnapshot: z.record(z.any()).optional().nullable(),
  parts: z.array(z.any()).default([]),
  services: z.array(z.any()).default([]),
  labor: z.array(z.any()).default([]),
  interventionTypes: z.array(z.string()).default([]),
  diagnosis: z.string().max(2000).optional().nullable(),
  technicalDescription: z.string().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  grossTotal: z.union([z.number(), z.string()]).optional(),
  discountPct: z.union([z.number(), z.string()]).optional(),
  taxPct: z.union([z.number(), z.string()]).optional(),
});

const updateRevisionSchema = z.object({
  grossTotal: z.union([z.number(), z.string()]).optional(),
  discountPct: z.union([z.number(), z.string()]).optional(),
  taxPct: z.union([z.number(), z.string()]).optional(),
  parts: z.array(z.any()).optional(),
  services: z.array(z.any()).optional(),
  labor: z.array(z.any()).optional(),
  interventionTypes: z.array(z.string()).optional(),
  diagnosis: z.string().max(2000).optional().nullable(),
  technicalDescription: z.string().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  clientSnapshot: z.record(z.any()).optional().nullable(),
  vehicleSnapshot: z.record(z.any()).optional().nullable(),
  dossierSnapshot: z.record(z.any()).optional().nullable(),
  currencyCode: z.string().optional(),
  budgetType: z.string().optional(),
});

const approveRevisionSchema = z.object({
  revisionId: z.string().min(1, "revisionId é obrigatório."),
  notes: z.string().max(2000).optional(),
  dueAt: z.string().datetime().optional().nullable(),
});

const rejectRevisionSchema = z.object({
  revisionId: z.string().min(1, "revisionId é obrigatório."),
  reason: z.string().min(1, "Motivo da rejeição é obrigatório.").max(1000),
});

function formatRevision(r: any) {
  if (!r) return null;
  return {
    id: r.id,
    budget_id: r.budgetId,
    budgetId: r.budgetId,
    revision_number: r.revisionNumber,
    revisionNumber: r.revisionNumber,
    status: r.status,
    currency_code: r.currencyCode,
    currencyCode: r.currencyCode,
    budget_type: r.budgetType,
    budgetType: r.budgetType,
    client_snapshot: r.clientSnapshot,
    clientSnapshot: r.clientSnapshot,
    vehicle_snapshot: r.vehicleSnapshot,
    vehicleSnapshot: r.vehicleSnapshot,
    dossier_snapshot: r.dossierSnapshot,
    dossierSnapshot: r.dossierSnapshot,
    parts: r.parts,
    services: r.services,
    labor: r.labor,
    intervention_types: r.interventionTypes,
    interventionTypes: r.interventionTypes,
    diagnosis: r.diagnosis,
    technical_description: r.technicalDescription,
    technicalDescription: r.technicalDescription,
    gross_total: r.grossTotal?.toString?.() ?? r.grossTotal,
    grossTotal: r.grossTotal?.toString?.() ?? r.grossTotal,
    discount_pct: r.discountPct?.toString?.() ?? r.discountPct,
    discountPct: r.discountPct?.toString?.() ?? r.discountPct,
    discount_total: r.discountTotal?.toString?.() ?? r.discountTotal,
    discountTotal: r.discountTotal?.toString?.() ?? r.discountTotal,
    net_total: r.netTotal?.toString?.() ?? r.netTotal,
    netTotal: r.netTotal?.toString?.() ?? r.netTotal,
    tax_pct: r.taxPct?.toString?.() ?? r.taxPct,
    taxPct: r.taxPct?.toString?.() ?? r.taxPct,
    tax_total: r.taxTotal?.toString?.() ?? r.taxTotal,
    taxTotal: r.taxTotal?.toString?.() ?? r.taxTotal,
    final_total: r.finalTotal?.toString?.() ?? r.finalTotal,
    finalTotal: r.finalTotal?.toString?.() ?? r.finalTotal,
    signature: r.signature,
    rejection: r.rejection,
    approved_at: r.approvedAt instanceof Date ? r.approvedAt.toISOString() : r.approvedAt,
    approvedAt: r.approvedAt instanceof Date ? r.approvedAt.toISOString() : r.approvedAt,
    approved_by_id: r.approvedById,
    approvedById: r.approvedById,
    created_by_id: r.createdById,
    createdById: r.createdById,
    created_at: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
  };
}

function formatProductionOrder(po: any) {
  if (!po) return null;
  return {
    id: po.id,
    workspace_id: po.workspaceId,
    workspaceId: po.workspaceId,
    code: po.code,
    budget_id: po.budgetId,
    budgetId: po.budgetId,
    budget_revision_id: po.budgetRevisionId,
    budgetRevisionId: po.budgetRevisionId,
    client_id: po.clientId,
    clientId: po.clientId,
    client_name: po.clientName,
    clientName: po.clientName,
    technician_user_id: po.technicianUserId,
    technicianUserId: po.technicianUserId,
    brand: po.brand,
    model: po.model,
    color: po.color,
    license_plate: po.licensePlate,
    licensePlate: po.licensePlate,
    vin: po.vin,
    status: po.status,
    platform: po.platform,
    notes: po.notes,
    created_by: po.createdBy,
    createdBy: po.createdBy,
    created_at: po.createdAt instanceof Date ? po.createdAt.toISOString() : po.createdAt,
    createdAt: po.createdAt instanceof Date ? po.createdAt.toISOString() : po.createdAt,
  };
}

function formatBudget(b: any) {
  if (!b) return null;
  return {
    id: b.id,
    workspace_id: b.workspaceId,
    workspaceId: b.workspaceId,
    code: b.code,
    client_id: b.clientId,
    clientId: b.clientId,
    client_name: b.clientName,
    clientName: b.clientName,
    vehicle_plate: b.vehiclePlate,
    vehiclePlate: b.vehiclePlate,
    vehicle_vin: b.vehicleVin,
    vehicleVin: b.vehicleVin,
    vehicle_brand: b.vehicleBrand,
    vehicleBrand: b.vehicleBrand,
    vehicle_model: b.vehicleModel,
    vehicleModel: b.vehicleModel,
    current_revision_number: b.currentRevisionNumber,
    currentRevisionNumber: b.currentRevisionNumber,
    current_revision_id: b.currentRevisionId,
    currentRevisionId: b.currentRevisionId,
    approved_revision_id: b.approvedRevisionId,
    approvedRevisionId: b.approvedRevisionId,
    technician_user_id: b.technicianUserId,
    technicianUserId: b.technicianUserId,
    created_by_id: b.createdById,
    createdById: b.createdById,
    legacy_local_id: b.legacyLocalId,
    legacyLocalId: b.legacyLocalId,
    created_at: b.createdAt instanceof Date ? b.createdAt.toISOString() : b.createdAt,
    createdAt: b.createdAt instanceof Date ? b.createdAt.toISOString() : b.createdAt,
    updated_at: b.updatedAt instanceof Date ? b.updatedAt.toISOString() : b.updatedAt,
    updatedAt: b.updatedAt instanceof Date ? b.updatedAt.toISOString() : b.updatedAt,
    current_revision: formatRevision(b.currentRevision),
    currentRevision: formatRevision(b.currentRevision),
    approved_revision: formatRevision(b.approvedRevision),
    approvedRevision: formatRevision(b.approvedRevision),
    revisions: Array.isArray(b.revisions) ? b.revisions.map(formatRevision) : undefined,
    production_order: formatProductionOrder(b.productionOrder),
    productionOrder: formatProductionOrder(b.productionOrder),
  };
}

/**
 * GET /api/budgets
 * Lista orçamentos do workspace ativo com filtros e restrição de escopo own para técnicos.
 */
budgetsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const { q, clientId, plate } = req.query as Record<string, string | undefined>;

    const isTechnicianScope =
      ctx.membershipRole === "technician" && ctx.scope === "workspace";

    const budgets = await prisma.budget.findMany({
      where: {
        workspaceId: ctx.activeWorkspaceId,
        deletedAt: null,
        ...(isTechnicianScope ? { technicianUserId: ctx.actorUserId } : {}),
        ...(clientId ? { clientId } : {}),
        ...(plate ? { vehiclePlate: { contains: plate, mode: "insensitive" } } : {}),
        ...(q
          ? {
              OR: [
                { code: { contains: q, mode: "insensitive" } },
                { clientName: { contains: q, mode: "insensitive" } },
                { vehiclePlate: { contains: q, mode: "insensitive" } },
                { vehicleModel: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        currentRevision: true,
        approvedRevision: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({
      budgets: budgets.map(formatBudget),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/budgets/sync-local
 * Sincronização idempotente de orçamentos legados do LocalStorage.
 */
budgetsRouter.post("/sync-local", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const result = await syncLocalBudgets(ctx.activeWorkspaceId, ctx.actorUserId, items);

    return res.status(200).json({ synced: result });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/budgets/:id
 * Consulta orçamento por ID com autorização no nível de objeto (404 para tenant cruzado / 403 para scope own).
 */
budgetsRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const ctx = req.ctx;
    const workspaceId = ctx?.activeWorkspaceId;

    const budget = await prisma.budget.findUnique({
      where: { id },
      include: {
        currentRevision: true,
        approvedRevision: true,
        productionOrder: true,
      },
    });

    // Zero Trust / Anti-Enumeração: Se o orçamento não existe ou pertence a outro workspace, retorna 404
    if (!budget || budget.deletedAt || budget.workspaceId !== workspaceId) {
      return res.status(404).json({ message: "Orçamento não encontrado." });
    }

    // Validação de autorização no nível de objeto (escopo own para técnicos vinculados)
    if (ctx) {
      assertObjectAccess(ctx, budget);
    }

    return res.status(200).json({ budget: formatBudget(budget) });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/budgets/:id/revisions
 * Lista histórico completo de revisões do orçamento.
 */
budgetsRouter.get("/:id/revisions", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = String(req.params.id);
    const ctx = req.ctx;
    const workspaceId = ctx?.activeWorkspaceId;

    const budget = await prisma.budget.findUnique({
      where: { id },
    });

    if (!budget || budget.deletedAt || budget.workspaceId !== workspaceId) {
      return res.status(404).json({ message: "Orçamento não encontrado." });
    }

    if (ctx) {
      assertObjectAccess(ctx, budget);
    }

    const revisions = await prisma.budgetRevision.findMany({
      where: { budgetId: id },
      orderBy: { revisionNumber: "asc" },
    });

    return res.status(200).json({
      revisions: revisions.map(formatRevision),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/budgets
 * Cria novo orçamento agregador e primeira revisão (draft).
 */
budgetsRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const input = createBudgetSchema.parse(req.body);

    const { budget, revision } = await createBudget({
      workspaceId: ctx.activeWorkspaceId,
      createdById: ctx.actorUserId,
      ...input,
    });

    const fullBudget = await prisma.budget.findUnique({
      where: { id: budget.id },
      include: {
        currentRevision: true,
        approvedRevision: true,
      },
    });

    return res.status(201).json({
      budget: formatBudget(fullBudget),
      revision: formatRevision(revision),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * PUT /api/budgets/:id/revisions/:revisionId
 * Atualiza rascunho in-place ou gera nova revisão (fork) preservando a versão aprovada intacta.
 */
budgetsRouter.put("/:id/revisions/:revisionId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const budgetId = String(req.params.id);
    const revisionId = String(req.params.revisionId);
    const input = updateRevisionSchema.parse(req.body);

    const result = await updateBudgetRevision(
      ctx.activeWorkspaceId,
      budgetId,
      revisionId,
      ctx.actorUserId,
      input
    );

    const statusCode = result.isNewRevision ? 201 : 200;
    return res.status(statusCode).json({
      budget: formatBudget(result.budget),
      revision: formatRevision(result.revision),
      isNewRevision: result.isNewRevision,
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/budgets/:id/revisions/:revisionId/approve
 * Aprovação transacional com revisionId explícito. Integra 1:0..1 com ProductionOrder.
 */
budgetsRouter.post("/:id/revisions/:revisionId/approve", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const budgetId = String(req.params.id);
    const revisionId = String(req.params.revisionId);
    const input = approveRevisionSchema.parse(req.body);

    if (input.revisionId !== revisionId) {
      return res.status(409).json({ message: "revisionId do corpo diverge da rota solicitada." });
    }

    const result = await approveBudgetRevision(
      ctx.activeWorkspaceId,
      budgetId,
      revisionId,
      ctx.actorUserId,
      {
        notes: input.notes,
        dueAt: input.dueAt,
      }
    );

    return res.status(200).json({
      budget: formatBudget(result.budget),
      revision: formatRevision(result.revision),
      productionOrder: formatProductionOrder(result.productionOrder),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/budgets/:id/revisions/:revisionId/reject
 * Rejeição formal com revisionId explícito e motivo registrado.
 */
budgetsRouter.post("/:id/revisions/:revisionId/reject", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const budgetId = String(req.params.id);
    const revisionId = String(req.params.revisionId);
    const input = rejectRevisionSchema.parse(req.body);

    if (input.revisionId !== revisionId) {
      return res.status(409).json({ message: "revisionId do corpo diverge da rota solicitada." });
    }

    const result = await rejectBudgetRevision(
      ctx.activeWorkspaceId,
      budgetId,
      revisionId,
      ctx.actorUserId,
      input.reason
    );

    return res.status(200).json({
      budget: formatBudget(result.budget),
      revision: formatRevision(result.revision),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/budgets/:id/photos
 * Lista fotos anexadas ao orçamento.
 */
budgetsRouter.get("/:id/photos", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const budgetId = String(req.params.id);
    const ctx = req.ctx;
    const workspaceId = ctx?.activeWorkspaceId;

    const budget = await prisma.budget.findUnique({
      where: { id: budgetId },
    });

    if (!budget || budget.deletedAt || budget.workspaceId !== workspaceId) {
      return res.status(404).json({ message: "Orçamento não encontrado." });
    }

    const photos = await prisma.budgetPhoto.findMany({
      where: { budgetId },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({
      photos: photos.map((p) => ({
        id: p.id,
        budget_id: p.budgetId,
        budgetId: p.budgetId,
        workspace_id: p.workspaceId,
        workspaceId: p.workspaceId,
        storage_path: p.storagePath,
        storagePath: p.storagePath,
        category: p.category,
        caption: p.caption,
        size_bytes: p.sizeBytes,
        sizeBytes: p.sizeBytes,
        uploaded_by: p.uploadedBy,
        uploadedBy: p.uploadedBy,
        created_at: p.createdAt.toISOString(),
        createdAt: p.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/budgets/:id/photos
 * Registra metadados de foto após upload com storage_path canônico.
 */
budgetsRouter.post("/:id/photos", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const budgetId = String(req.params.id);
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const budget = await prisma.budget.findUnique({
      where: { id: budgetId },
    });

    if (!budget || budget.deletedAt || budget.workspaceId !== ctx.activeWorkspaceId) {
      return res.status(404).json({ message: "Orçamento não encontrado." });
    }

    const photoSchema = z.object({
      storagePath: z.string().min(1, "storagePath é obrigatório."),
      category: z.string().default("damage"),
      caption: z.string().optional().nullable(),
      sizeBytes: z.number().int().positive().optional(),
    });

    const input = photoSchema.parse(req.body);

    const photo = await prisma.budgetPhoto.create({
      data: {
        budgetId,
        workspaceId: ctx.activeWorkspaceId,
        storagePath: input.storagePath,
        category: input.category,
        caption: input.caption ?? null,
        sizeBytes: input.sizeBytes,
        uploadedBy: ctx.actorUserId,
      },
    });

    return res.status(201).json({ photo });
  } catch (error) {
    return next(error);
  }
});
