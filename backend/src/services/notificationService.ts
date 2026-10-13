import { prisma } from "../lib/prisma.js";

export type NotificationType =
  | "system"
  | "service_order"
  | "payment"
  | "discrepancy"
  | "workspace_invite"
  | "weeklog"
  | "budget";

export interface CreateNotificationInput {
  userId: string;
  type?: NotificationType;
  title: string;
  body?: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * Creates a single persistent in-app notification.
 * Never throws — safe to call inside or after business operations.
 */
export async function createNotification(input: CreateNotificationInput) {
  if (!input.userId) return null;
  try {
    return await (prisma as any).notification.create({
      data: {
        userId: input.userId,
        type: input.type ?? "system",
        title: input.title,
        body: input.body ?? null,
        payload: (input.payload ?? {}) as any,
      },
    });
  } catch (err) {
    console.error("[notificationService] Failed to create notification:", (err as Error).message);
    return null;
  }
}

/**
 * Creates multiple in-app notifications in batch.
 */
export async function createBatchNotifications(inputs: CreateNotificationInput[]) {
  const valid = inputs.filter((i) => Boolean(i.userId));
  if (!valid.length) return null;
  try {
    return await (prisma as any).notification.createMany({
      data: valid.map((i) => ({
        userId: i.userId,
        type: i.type ?? "system",
        title: i.title,
        body: i.body ?? null,
        payload: (i.payload ?? {}) as any,
      })),
    });
  } catch (err) {
    console.error("[notificationService] Failed to create batch notifications:", (err as Error).message);
    return null;
  }
}

/**
 * Helper: Notify user about an incoming workspace invitation.
 */
export async function notifyWorkspaceInvite(
  targetUserId: string,
  workspaceName: string,
  role: string,
  inviteId: string,
) {
  return createNotification({
    userId: targetUserId,
    type: "workspace_invite",
    title: "Novo Convite de Workspace",
    body: `Você foi convidado para ingressar em "${workspaceName}" como ${role.toUpperCase()}.`,
    payload: { inviteId, workspaceName, role },
  });
}

/**
 * Helper: Notify inviter when their invitation was accepted.
 */
export async function notifyInviteAccepted(
  inviterUserId: string,
  acceptedUserName: string,
  workspaceName: string,
) {
  return createNotification({
    userId: inviterUserId,
    type: "workspace_invite",
    title: "Convite Aceito",
    body: `${acceptedUserName} aceitou o convite para ingressar em "${workspaceName}".`,
    payload: { acceptedUserName, workspaceName },
  });
}

/**
 * Helper: Notify technician when a production or service order is assigned.
 */
export async function notifyOrderAssigned(
  technicianUserId: string,
  orderCode: string,
  vehicleInfo?: string | null,
) {
  return createNotification({
    userId: technicianUserId,
    type: "service_order",
    title: "Ordem de Produção Atribuída",
    body: `A ordem ${orderCode}${vehicleInfo ? ` (${vehicleInfo})` : ""} foi atribuída ao seu usuário.`,
    payload: { orderCode, vehicleInfo },
  });
}

/**
 * Helper: Notify when a budget correction request is submitted.
 */
export async function notifyCorrectionRequested(
  targetUserId: string,
  budgetCode: string,
  orderCode: string,
  reason: string,
  requesterName?: string | null,
) {
  return createNotification({
    userId: targetUserId,
    type: "discrepancy",
    title: "Solicitação de Correção de Devis",
    body: `${requesterName || "Um operador"} solicitou correção no Devis ${budgetCode} (OP ${orderCode}): ${reason}`,
    payload: { budgetCode, orderCode, reason },
  });
}

/**
 * Helper: Notify when a budget is approved.
 */
export async function notifyBudgetApproved(
  targetUserId: string,
  budgetCode: string,
  clientName?: string | null,
) {
  return createNotification({
    userId: targetUserId,
    type: "budget",
    title: "Orçamento Aprovado",
    body: `O orçamento ${budgetCode}${clientName ? ` (${clientName})` : ""} foi aprovado com sucesso.`,
    payload: { budgetCode, clientName },
  });
}

/**
 * Helper: Notify workspace managers when a weeklog is submitted for validation.
 */
export async function notifyWeeklogSubmitted(
  validatorUserIds: string[],
  weekNumber: number | string,
  workspaceName: string,
) {
  return createBatchNotifications(
    validatorUserIds.map((userId) => ({
      userId,
      type: "weeklog",
      title: "Lote de Semana Operacional Submetido",
      body: `O lote da Semana ${weekNumber} em "${workspaceName}" aguarda validação.`,
      payload: { weekNumber, workspaceName },
    })),
  );
}

/**
 * Helper: Notify managers / finance when a payment list reaches ready_for_billing status.
 */
export async function notifyPaymentListReady(
  financeUserIds: string[],
  listName: string,
  itemCount: number,
) {
  return createBatchNotifications(
    financeUserIds.map((userId) => ({
      userId,
      type: "payment",
      title: "Lista Pronta para Faturamento",
      body: `A lista de pagamento "${listName}" (${itemCount} itens) está pronta para faturamento comercial.`,
      payload: { listName, itemCount },
    })),
  );
}
