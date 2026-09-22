import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../lib/objectAuth.js";
import type { RequestContext } from "../middleware/requestContext.js";

function workspaceId(ctx: RequestContext) {
  if (!ctx.activeWorkspaceId) throw new ForbiddenError("FORBIDDEN_ROLE");
  return ctx.activeWorkspaceId;
}

function projectionData(item: any) {
  if (!item.technicianUserId) return null;
  return {
    workspaceId: item.workspaceId, userId: item.paymentList.createdBy, assignedUserId: item.technicianUserId,
    clientId: item.paymentList.clientId, clientName: item.paymentList.clientName, carName: item.carName,
    licensePlate: item.licensePlate, listName: item.paymentList.listNumber, yearReference: item.paymentList.createdAt.getUTCFullYear(),
    technicianId: item.technicianUserId, technicianName: item.technicianName, services: item.servicesSnapshot as Prisma.InputJsonValue,
    total: Number(item.totalAmount), status: item.paymentList.status, createdBy: item.paymentList.createdBy,
  };
}

export async function projectPaymentListItemInTransaction(tx: Prisma.TransactionClient, workspace: string, paymentListItemId: string) {
  const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM payment_list_items WHERE id = ${paymentListItemId} AND workspace_id = ${workspace} FOR UPDATE
  `);
  if (!locked.length) throw new NotFoundError("PAYMENT_LIST_ITEM_NOT_FOUND");
  const item = await tx.paymentListItem.findFirst({
    where: { id: paymentListItemId, workspaceId: workspace },
    include: { paymentList: { select: { clientId: true, clientName: true, listNumber: true, status: true, createdAt: true, createdBy: true } } },
  });
  if (!item) throw new NotFoundError("PAYMENT_LIST_ITEM_NOT_FOUND");
  const data = projectionData(item);
  if (!data) return null;
  if (item.legacyPaymentOrderId) {
    const existing = await tx.paymentOrder.findFirst({ where: { id: item.legacyPaymentOrderId, workspaceId: workspace } });
    if (!existing) throw new ConflictError("LEGACY_PAYMENT_ORDER_PROJECTION_CONFLICT");
    return tx.paymentOrder.update({ where: { id: existing.id }, data });
  }
  const created = await tx.paymentOrder.create({ data });
  await tx.paymentListItem.update({ where: { id: item.id }, data: { legacyPaymentOrderId: created.id } });
  return created;
}

export async function projectPaymentListItem(ctx: RequestContext, paymentListItemId: string) {
  const workspace = workspaceId(ctx);
  return prisma.$transaction((tx) => projectPaymentListItemInTransaction(tx, workspace, paymentListItemId));
}
