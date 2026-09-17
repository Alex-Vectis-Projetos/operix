import { Router, type Request, type Response, type NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveRequestContext, type RequestContext } from "../middleware/requestContext.js";
import { ForbiddenError } from "../lib/objectAuth.js";

export const serviceOrdersRouter = Router();

// Enforce RequestContext & Authentication on all routes
serviceOrdersRouter.use(requireAuth);
serviceOrdersRouter.use(resolveRequestContext);

function isTechScope(ctx: RequestContext): boolean {
  return (
    ctx.membershipRole === "technician" ||
    ctx.scope === "technician_personal"
  );
}

// Helper robusto: situation = validado? Case-insensitive + trim + booleanos.
function isSituationValidated(situ: unknown): boolean {
  if (situ === true) return true;
  if (typeof situ !== "string") return false;
  const s = situ.trim().toLowerCase();
  if (!s) return false;
  return (
    s === "oui" ||
    s === "sim" ||
    s === "true" ||
    s === "1" ||
    s === "yes" ||
    s === "validado" ||
    s === "assinado"
  );
}

function mapOrder(o: any) {
  const distSnap =
    o.distributionSnapshot && typeof o.distributionSnapshot === "object"
      ? o.distributionSnapshot
      : null;
  const operational_document =
    (distSnap && (distSnap as any).operational_document) || null;
  const opBase = (operational_document && (operational_document as any).base) || null;
  const prodJoin = o._productionOrder || null;

  return {
    id: o.id,
    workspace_id: o.workspaceId,
    workspaceId: o.workspaceId,
    visibility_scope: o.visibilityScope,
    user_id: o.userId,
    assigned_user_id: o.assignedUserId,
    client_id: o.clientId,
    client_name: o.clientName,
    car_name: o.carName,
    license_plate: o.licensePlate,
    platform: o.platform,
    platform_id: o.platformId,
    operational_unit: o.operationalUnit,
    group_id: o.groupId,
    week: o.week,
    year_reference: o.yearReference,
    technician_name: o.technicianName,
    technician_earning: o.technicianEarning,
    technician_percentage: o.technicianPercentage,
    service_1_name: o.service1Name,
    service_1_price: o.service1Price,
    service_2_name: o.service2Name,
    service_2_price: o.service2Price,
    service_3_name: o.service3Name,
    service_3_price: o.service3Price,
    service_4_name: o.service4Name,
    service_4_price: o.service4Price,
    total: o.total,
    status: o.status,
    distribution_snapshot: distSnap,
    operational_document,
    production_vin: prodJoin?.vin ?? opBase?.vin ?? null,
    production_insurer: prodJoin?.insurer ?? opBase?.insurer ?? null,
    production_delivered_at: prodJoin?.deliveredAt
      ? typeof prodJoin.deliveredAt === "string"
        ? prodJoin.deliveredAt
        : (prodJoin.deliveredAt as Date)?.toISOString()
      : opBase?.delivered_at ?? null,
    production_code: prodJoin?.code ?? opBase?.production_code ?? null,
    created_by: o.createdBy,
    deleted_at: o.deletedAt?.toISOString() ?? null,
    created_at: o.createdAt.toISOString(),
    updated_at: o.updatedAt.toISOString(),
    legacyArchive: !o._hasWeeklogEntry,
  };
}

// ---------------------------------------------------------------------------
// GET /api/service-orders
// Pure read-only endpoint with strict tenant isolation and zero database writes.
// ---------------------------------------------------------------------------
serviceOrdersRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const { client_id, platform, week, assigned_user_id } = req.query as Record<
      string,
      string | undefined
    >;

    const where: Record<string, unknown> = {
      workspaceId: ctx.activeWorkspaceId,
      deletedAt: null,
    };

    // Technician own-scope enforcement (OWASP API1 / BOLA)
    if (isTechScope(ctx)) {
      where.OR = [
        { assignedUserId: ctx.actorUserId },
        { userId: ctx.actorUserId },
      ];
    } else if (assigned_user_id) {
      where.assignedUserId = assigned_user_id;
    }

    if (client_id) where.clientId = client_id;
    if (platform) where.platform = platform;
    if (week) where.week = week;

    const orders = await prisma.serviceOrder.findMany({
      where,
      include: {
        weeklogEntries: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const orderIds = orders.map((o) => o.id);

    // Read linked payment orders in memory without writing back to the database
    const linkedPayments = orderIds.length
      ? await prisma.paymentOrder.findMany({
          where: {
            workspaceId: ctx.activeWorkspaceId,
            deletedAt: null,
            serviceOrderId: { in: orderIds },
          },
          select: { id: true, serviceOrderId: true, listName: true },
        })
      : [];

    const transferredById = new Map<string, { paymentOrderId: string; listName: string }>();
    for (const p of linkedPayments) {
      if (p.serviceOrderId) {
        transferredById.set(p.serviceOrderId, {
          paymentOrderId: p.id,
          listName: p.listName || "",
        });
      }
    }

    // Filter in-memory: transferidos para a Lista não aparecem no grid de ServiceOrders/WEEKLOG
    const ordersForWeeklog = orders.filter((so) => {
      const ds =
        so.distributionSnapshot && typeof so.distributionSnapshot === "object"
          ? (so.distributionSnapshot as any)
          : null;
      const op = ds?.operational_document || null;
      const valid = op?.validation || null;
      const situ = valid?.situation || valid?.validation_sit || null;
      const sim = isSituationValidated(situ);
      const hasPayRef =
        Boolean(valid?.payment_order_id) || Boolean(valid?.list_name) || Boolean(valid?.lista);
      const fkExists = transferredById.has(so.id);
      const transferido = sim && (hasPayRef || fkExists);
      return !transferido;
    });

    // Lookup ProductionOrder details read-only
    const poList = orderIds.length
      ? await prisma.productionOrder.findMany({
          where: {
            workspaceId: ctx.activeWorkspaceId,
            serviceOrderId: { in: orderIds },
          },
          select: {
            id: true,
            serviceOrderId: true,
            vin: true,
            insurer: true,
            deliveredAt: true,
            code: true,
            brand: true,
            model: true,
            color: true,
          },
        })
      : [];

    const poByServiceOrderId = new Map<string, any>();
    for (const po of poList) {
      if (po.serviceOrderId && !poByServiceOrderId.has(po.serviceOrderId)) {
        poByServiceOrderId.set(po.serviceOrderId, po);
      }
    }

    const normalized = ordersForWeeklog.map((so) => {
      const po = poByServiceOrderId.get(so.id) || null;
      const hasWeeklogEntry = Array.isArray(so.weeklogEntries) && so.weeklogEntries.length > 0;
      return {
        ...so,
        _productionOrder: po,
        _hasWeeklogEntry: hasWeeklogEntry,
      };
    });

    return res.json(normalized.map(mapOrder));
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/service-orders/clients
// Lista clientes autorizados no workspace com filtro de escopo do técnico.
// ---------------------------------------------------------------------------
serviceOrdersRouter.get("/clients", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    if (isTechScope(ctx)) {
      const ownOrders = await prisma.serviceOrder.findMany({
        where: {
          workspaceId: ctx.activeWorkspaceId,
          deletedAt: null,
          clientId: { not: null },
          OR: [
            { assignedUserId: ctx.actorUserId },
            { userId: ctx.actorUserId },
          ],
        },
        select: { clientId: true },
        distinct: ["clientId"],
      });

      const clientIds = ownOrders.map((o) => o.clientId!).filter(Boolean);
      if (clientIds.length === 0) {
        return res.json([]);
      }

      const clients = await prisma.client.findMany({
        where: {
          id: { in: clientIds },
          workspaceId: ctx.activeWorkspaceId,
          deletedAt: null,
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      return res.json(clients);
    }

    const clients = await prisma.client.findMany({
      where: {
        workspaceId: ctx.activeWorkspaceId,
        deletedAt: null,
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return res.json(clients);
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/service-orders
// Criação direta descontinuada. Autoridade operacional migrada para Produção & WEEKLOG.
// ---------------------------------------------------------------------------
serviceOrdersRouter.post("/", async (_req: Request, res: Response) => {
  return res.status(410).json({
    code: "LEGACY_SERVICE_ORDER_WRITE_DEPRECATED",
    message:
      "A criação direta de ServiceOrder legada foi descontinuada. Utilize o fluxo canônico de Produção e WEEKLOG (POST /api/production-orders e POST /api/production-orders/:id/finalize).",
  });
});

// ---------------------------------------------------------------------------
// PUT /api/service-orders/:id
// Substituição total descontinuada.
// ---------------------------------------------------------------------------
serviceOrdersRouter.put("/:id", async (_req: Request, res: Response) => {
  return res.status(410).json({
    code: "LEGACY_SERVICE_ORDER_WRITE_DEPRECATED",
    message:
      "A alteração direta de ServiceOrder legada via PUT foi descontinuada. Utilize o fluxo canônico de WEEKLOG.",
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/service-orders/:id
// Proíbe mutação de projeções canônicas, descontinua validação legada e remove PaymentOrder hook.
// ---------------------------------------------------------------------------
serviceOrdersRouter.patch("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const id = req.params["id"] as string;
    const order = await prisma.serviceOrder.findUnique({
      where: { id },
      include: { weeklogEntries: { select: { id: true } } },
    });

    if (!order || order.workspaceId !== ctx.activeWorkspaceId || order.deletedAt !== null) {
      return res.status(404).json({ message: "Ordem de serviço não encontrada." });
    }

    if (
      isTechScope(ctx) &&
      order.assignedUserId !== ctx.actorUserId &&
      order.userId !== ctx.actorUserId
    ) {
      throw new ForbiddenError("Acesso restrito ao próprio técnico.");
    }

    // Regra T08: Projeções de WeeklogEntry canônicas são estritamente imutáveis via rotas legadas
    if (order.weeklogEntries && order.weeklogEntries.length > 0) {
      return res.status(409).json({
        code: "CANONICAL_PROJECTION_IMMUTABLE",
        message:
          "Esta ServiceOrder é uma projeção downstream de uma WeeklogEntry canônica. Alterações operacionais devem ser realizadas através do fluxo canônico de WEEKLOG.",
      });
    }

    // Regra T08: Bloqueio formal de validação legada
    const b = req.body || {};
    const op =
      b.operational_document ||
      b.distribution_snapshot?.operational_document ||
      {};
    const valid = op.validation || {};
    const isVal =
      isSituationValidated(valid.situation || valid.validation_sit) ||
      b.status === "validated" ||
      b.status === "approved" ||
      b.status === "rejected";

    if (isVal) {
      return res.status(409).json({
        code: "LEGACY_VALIDATION_DEPRECATED",
        message:
          "A validação via rota legada de ServiceOrder foi descontinuada. O fluxo canônico exige validação em lote autenticada com ClientAccessGrant em POST /api/weeklogs/:id/submit-for-validation e POST /api/weeklogs/:id/validate.",
      });
    }

    // Qualquer outra tentativa de escrita direta operacional em dados históricos
    return res.status(410).json({
      code: "LEGACY_SERVICE_ORDER_WRITE_DEPRECATED",
      message:
        "A alteração direta de ServiceOrder legada foi descontinuada. Utilize os endpoints canônicos.",
    });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/service-orders/:id
// Proíbe exclusão de projeção canônica e preserva histórico como Legacy Archive.
// ---------------------------------------------------------------------------
serviceOrdersRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const id = req.params["id"] as string;
    const order = await prisma.serviceOrder.findUnique({
      where: { id },
      include: { weeklogEntries: { select: { id: true } } },
    });

    if (!order || order.workspaceId !== ctx.activeWorkspaceId || order.deletedAt !== null) {
      return res.status(404).json({ message: "Ordem de serviço não encontrada." });
    }

    if (
      isTechScope(ctx) &&
      order.assignedUserId !== ctx.actorUserId &&
      order.userId !== ctx.actorUserId
    ) {
      throw new ForbiddenError("Acesso restrito ao próprio técnico.");
    }

    if (order.weeklogEntries && order.weeklogEntries.length > 0) {
      return res.status(409).json({
        code: "CANONICAL_PROJECTION_IMMUTABLE",
        message:
          "Esta ServiceOrder é uma projeção de uma WeeklogEntry canônica e não pode ser excluída.",
      });
    }

    return res.status(409).json({
      code: "LEGACY_ARCHIVE_IMMUTABLE",
      message:
        "Registros históricos legados são preservados como Legacy Archive e não podem ser excluídos.",
    });
  } catch (error) {
    return next(error);
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/service-orders/by-year/:year
// Exclusão em massa descontinuada para conformidade e integridade de auditoria.
// ---------------------------------------------------------------------------
serviceOrdersRouter.delete("/by-year/:year", async (_req: Request, res: Response) => {
  return res.status(410).json({
    code: "LEGACY_BATCH_DELETE_DEPRECATED",
    message:
      "A exclusão em massa por ano foi descontinuada para preservação de histórico auditável e conformidade operacional.",
  });
});
