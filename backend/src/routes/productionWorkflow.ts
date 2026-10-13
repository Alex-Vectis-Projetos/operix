import { Router, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { buildPermissionsForRole, normalizePermissionRole } from "../lib/permissionPolicy.js";
import {
  isWorkflowStatus,
  isTransitionAllowed,
  WORKFLOW_STATUS_LABELS,
  type WorkflowStatus,
} from "../lib/productionWorkflowStatus.js";
import { notifyWorkflowStatusChanged, getWorkspaceManagerUserIds } from "../services/notificationService.js";

export const productionWorkflowRouter = Router();

/** ISO week number (1-53) — mirrors src/hooks/usePaymentListsConsolidated.ts. */
function getISOWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function checkPermission(req: AuthenticatedRequest, action: "view" | "move"): boolean {
  const { admin, map } = buildPermissionsForRole(req.auth?.role);
  if (admin) return true;
  return map[`production_workflow.${action}`]?.allowed ?? false;
}

/**
 * Partners can only move lists through the operational (pre-invoicing) part
 * of the flow; owner/admin can perform every transition, including the
 * manual-confirmation placeholders for the not-yet-automated steps (FR-016).
 */
function canRoleMoveTransition(role: string | null | undefined, from: WorkflowStatus, to: WorkflowStatus): boolean {
  const normalized = normalizePermissionRole(role);
  if (normalized === "owner" || normalized === "admin") return true;
  if (normalized === "partner") {
    const partnerAllowedTargets: WorkflowStatus[] = [
      "em_elaboracao",
      "aguardando_assinatura",
      "aguardando_aprovacao",
      "correcao_necessaria",
    ];
    return partnerAllowedTargets.includes(from) && partnerAllowedTargets.includes(to);
  }
  return false;
}

// GET /api/production-workflow/lists?year=&clientId=&operationalUnit=&technicianId=
productionWorkflowRouter.get("/lists", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "view")) {
    return res.status(403).json({ message: "Você não tem permissão para visualizar o workflow de produção." });
  }

  const { year, clientId, operationalUnit, technicianId, workspace_id } = req.query as Record<string, string | undefined>;

  const orders = await prisma.paymentOrder.findMany({
    where: {
      deletedAt: null,
      listName: { not: null },
      ...(workspace_id ? { workspaceId: workspace_id } : {}),
      ...(clientId ? { clientId } : {}),
      ...(operationalUnit ? { operationalUnit } : {}),
      ...(technicianId ? { technicianId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  type Agg = {
    listName: string;
    clientId: string | null;
    clientName: string | null;
    operationalUnit: string | null;
    technicianId: string | null;
    technicianName: string | null;
    year: number;
    week: number;
    itemCount: number;
    totalValue: number;
  };

  const byList = new Map<string, Agg>();
  for (const po of orders) {
    const listName = (po.listName ?? "").trim();
    if (!listName) continue;
    const created = po.createdAt;
    const y = created.getUTCFullYear();
    const w = getISOWeek(created);

    let agg = byList.get(listName);
    if (!agg) {
      agg = {
        listName,
        clientId: po.clientId,
        clientName: po.clientName,
        operationalUnit: po.operationalUnit,
        technicianId: po.technicianId,
        technicianName: po.technicianName,
        year: y,
        week: w,
        itemCount: 0,
        totalValue: 0,
      };
      byList.set(listName, agg);
    }
    agg.itemCount += 1;
    agg.totalValue += Number(po.total ?? 0);
    if (agg.year > y || (agg.year === y && agg.week > w)) {
      agg.year = y;
      agg.week = w;
    }
  }

  const listNames = Array.from(byList.keys());
  const filteredByYear = year
    ? listNames.filter((ln) => byList.get(ln)!.year === parseInt(year, 10))
    : listNames;

  const statusRows = await prisma.productionList.findMany({
    where: { listName: { in: filteredByYear } },
  });
  const statusByList = new Map(statusRows.map((r) => [r.listName, r.status]));

  const lists = filteredByYear
    .map((ln) => {
      const agg = byList.get(ln)!;
      return {
        listName: agg.listName,
        status: (statusByList.get(ln) as WorkflowStatus | undefined) ?? "em_elaboracao",
        clientId: agg.clientId,
        clientName: agg.clientName,
        operationalUnit: agg.operationalUnit,
        technicianId: agg.technicianId,
        technicianName: agg.technicianName,
        year: agg.year,
        week: agg.week,
        itemCount: agg.itemCount,
        totalValue: agg.totalValue,
      };
    })
    .sort((a, b) => (a.year !== b.year ? b.year - a.year : a.week !== b.week ? b.week - a.week : a.listName.localeCompare(b.listName)));

  return res.json({ lists });
});

// GET /api/production-workflow/lists/:listName/items
productionWorkflowRouter.get("/lists/:listName/items", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!checkPermission(req, "view")) {
    return res.status(403).json({ message: "Você não tem permissão para visualizar o workflow de produção." });
  }

  const listName = req.params["listName"] as string;
  const { workspace_id } = req.query as Record<string, string | undefined>;
  const orders = await prisma.paymentOrder.findMany({
    where: { listName, deletedAt: null, ...(workspace_id ? { workspaceId: workspace_id } : {}) },
    orderBy: { createdAt: "asc" },
  });

  if (orders.length === 0) {
    return res.status(404).json({ message: "Lista de produção não encontrada." });
  }

  const items = orders.map((po) => ({
    id: po.id,
    clientName: po.clientName,
    platform: po.platform,
    technicianName: po.technicianName,
    week: getISOWeek(po.createdAt),
    carName: po.carName,
    licensePlate: po.licensePlate,
    services: po.services ?? [],
    total: po.total,
  }));

  return res.json({ listName, items });
});

// PATCH /api/production-workflow/lists/:listName/status
productionWorkflowRouter.patch("/lists/:listName/status", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const listName = req.params["listName"] as string;
  const toStatus = req.body?.toStatus as string | undefined;
  const workspaceId = req.body?.workspace_id as string | undefined;

  if (!toStatus || !isWorkflowStatus(toStatus)) {
    return res.status(422).json({ message: "Status de destino inválido." });
  }

  const existingOrder = await prisma.paymentOrder.findFirst({
    where: { listName, deletedAt: null, ...(workspaceId ? { workspaceId } : {}) },
    select: { id: true },
  });
  if (!existingOrder) {
    return res.status(404).json({ message: "Lista de produção não encontrada." });
  }

  let current = await prisma.productionList.findUnique({ where: { listName } });
  if (!current) {
    current = await prisma.productionList.create({ data: { listName, status: "em_elaboracao", workspaceId: workspaceId ?? null } });
  }
  const fromStatus = current.status as WorkflowStatus;

  if (!isTransitionAllowed(fromStatus, toStatus)) {
    return res.status(409).json({
      message: `Não é possível mover de '${WORKFLOW_STATUS_LABELS[fromStatus]}' para '${WORKFLOW_STATUS_LABELS[toStatus]}' diretamente.`,
    });
  }

  if (!checkPermission(req, "move") || !canRoleMoveTransition(req.auth?.role, fromStatus, toStatus)) {
    return res.status(403).json({ message: "Você não tem permissão para mover esta lista para o status solicitado." });
  }

  const updateResult = await prisma.productionList.updateMany({
    where: { listName, status: fromStatus },
    data: { status: toStatus, previousStatus: fromStatus, updatedBy: req.auth?.userId ?? null },
  });

  if (updateResult.count === 0) {
    return res.status(409).json({ message: "O status desta lista foi alterado por outro usuário; atualize a tela." });
  }

  const updated = await prisma.productionList.findUnique({ where: { listName } });

  // Notifica técnicos e gestores sobre a transição de workflow
  try {
    const actorUserId = req.auth?.userId;
    const involvedOrders = await prisma.paymentOrder.findMany({
      where: { listName, deletedAt: null },
      select: { technicianId: true, workspaceId: true },
    });
    const targetUsers: string[] = [];
    let wsId = workspaceId;
    for (const io of involvedOrders) {
      if (io.technicianId && io.technicianId !== actorUserId) targetUsers.push(io.technicianId);
      if (!wsId && io.workspaceId) wsId = io.workspaceId;
    }
    if (wsId && actorUserId) {
      const managers = await getWorkspaceManagerUserIds(wsId, actorUserId);
      targetUsers.push(...managers);
    }
    const authorName = req.auth?.email || "Operador";
    await notifyWorkflowStatusChanged(
      targetUsers,
      listName,
      WORKFLOW_STATUS_LABELS[fromStatus] || fromStatus,
      WORKFLOW_STATUS_LABELS[toStatus as WorkflowStatus] || toStatus,
      authorName,
    );
  } catch (wErr) {
    console.error("[workflow] Falha ao enviar notificação de status de workflow:", wErr);
  }

  return res.json({
    listName,
    status: updated!.status,
    previousStatus: updated!.previousStatus,
    updatedAt: updated!.updatedAt.toISOString(),
  });
});
