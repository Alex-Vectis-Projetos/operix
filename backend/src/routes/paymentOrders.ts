import { Router, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { resolveRequestContext } from "../middleware/requestContext.js";

export const paymentOrdersRouter = Router();
paymentOrdersRouter.use(requireAuth);
paymentOrdersRouter.use(resolveRequestContext);

function mapOrder(order: any) {
  return {
    id: order.id, workspace_id: order.workspaceId, client_id: order.clientId, client_name: order.clientName,
    car_name: order.carName, license_plate: order.licensePlate, platform: order.platform, operational_unit: order.operationalUnit,
    group_id: order.groupId, list_name: order.listName, year_reference: order.yearReference, technician_id: order.technicianId,
    technician_name: order.technicianName, services: order.services, service_order_id: order.serviceOrderId, amount_paid: order.amountPaid,
    total: order.total, status: order.status, created_by: order.createdBy, created_at: order.createdAt.toISOString(), updated_at: order.updatedAt.toISOString(),
  };
}

function deprecated(res: Response) {
  return res.status(410).json({ code: "LEGACY_PAYMENT_ORDER_WRITE_DEPRECATED", message: "Alterações operacionais devem ser realizadas via /api/payment-lists." });
}

paymentOrdersRouter.get("/", async (req: AuthenticatedRequest, res: Response) => {
  const ctx = req.ctx;
  if (!ctx?.activeWorkspaceId) return res.status(403).json({ code: "FORBIDDEN_ROLE" });
  const query = req.query as Record<string, string | undefined>;
  const orders = await prisma.paymentOrder.findMany({
    where: {
      workspaceId: ctx.activeWorkspaceId,
      deletedAt: null,
      ...(query.client_id ? { clientId: query.client_id } : {}),
      ...(query.platform ? { platform: query.platform } : {}),
      ...(query.list_name ? { listName: query.list_name } : {}),
      ...(ctx.membershipRole === "technician" ? { technicianId: ctx.actorUserId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return res.json(orders.map(mapOrder));
});

paymentOrdersRouter.post("/", (_req, res) => deprecated(res));
paymentOrdersRouter.patch("/:id", (_req, res) => deprecated(res));
paymentOrdersRouter.delete("/:id", (_req, res) => deprecated(res));
paymentOrdersRouter.delete("/", (_req, res) => deprecated(res));
