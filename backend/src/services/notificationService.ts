import { prisma } from "../lib/prisma.js";

export type NotificationType =
  | "system"
  | "service_order"
  | "payment"
  | "discrepancy"
  | "workspace_invite"
  | "weeklog"
  | "budget"
  | "observation"
  | "document";

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

/**
 * Helper: Retrieve all owner/admin user IDs for a given workspace.
 */
export async function getWorkspaceManagerUserIds(
  workspaceId: string,
  excludeUserId?: string,
): Promise<string[]> {
  try {
    const members = await prisma.membership.findMany({
      where: {
        workspaceId,
        role: { in: ["owner", "admin"] },
        ...(excludeUserId ? { userId: { not: excludeUserId } } : {}),
      },
      select: { userId: true },
    });
    return members.map((m) => m.userId);
  } catch (err) {
    console.error("[notificationService] Failed to get workspace managers:", err);
    return [];
  }
}

/**
 * Helper: Notify when a new observation or internal note is added to a production order.
 */
export async function notifyObservationAdded(
  targetUserIds: string[],
  orderCode: string,
  noteSnippet: string,
  vehicleInfo?: string | null,
  authorName?: string | null,
  orderId?: string | null,
) {
  const uniqueUsers = Array.from(new Set(targetUserIds.filter(Boolean)));
  if (!uniqueUsers.length) return null;

  const authorPrefix = authorName ? `${authorName}: ` : "";
  const vehSuffix = vehicleInfo ? ` (${vehicleInfo})` : "";
  const cleanSnippet = noteSnippet.trim().replace(/\s+/g, " ").slice(0, 140);

  return createBatchNotifications(
    uniqueUsers.map((userId) => ({
      userId,
      type: "observation",
      title: `Nova Observação na OP ${orderCode}`,
      body: `${authorPrefix}"${cleanSnippet}"${vehSuffix}`,
      payload: { orderCode, orderId, vehicleInfo, authorName, noteSnippet: cleanSnippet },
    })),
  );
}

/**
 * Helper: Notify when a production order changes status.
 */
export async function notifyProductionStatusChanged(
  targetUserIds: string[],
  orderCode: string,
  fromStatus: string,
  toStatus: string,
  vehicleInfo?: string | null,
  authorName?: string | null,
  orderId?: string | null,
) {
  const uniqueUsers = Array.from(new Set(targetUserIds.filter(Boolean)));
  if (!uniqueUsers.length) return null;

  const statusLabels: Record<string, string> = {
    new_vehicle: "Novo Veículo",
    in_production: "Em Produção",
    paused: "Pausada",
    ready_for_pickup: "Pronto para Retirada",
    delivered: "Entregue / Concluída",
    canceled: "Cancelada",
  };
  const fromLabel = statusLabels[fromStatus] || fromStatus;
  const toLabel = statusLabels[toStatus] || toStatus;
  const authorPrefix = authorName ? `${authorName} alterou: ` : "";
  const vehSuffix = vehicleInfo ? ` (${vehicleInfo})` : "";

  return createBatchNotifications(
    uniqueUsers.map((userId) => ({
      userId,
      type: "service_order",
      title: `Status Atualizado: OP ${orderCode}`,
      body: `${authorPrefix}OP ${orderCode}${vehSuffix} avançou de "${fromLabel}" para "${toLabel}".`,
      payload: { orderCode, orderId, vehicleInfo, fromStatus, toStatus, authorName },
    })),
  );
}

/**
 * Helper: Notify when a document is validated, receives observations, or is updated.
 */
export async function notifyDocumentUpdated(
  targetUserIds: string[],
  documentName: string,
  action: "validated" | "observation" | "updated",
  authorName?: string | null,
  documentId?: string | null,
) {
  const uniqueUsers = Array.from(new Set(targetUserIds.filter(Boolean)));
  if (!uniqueUsers.length) return null;

  const actionText =
    action === "validated"
      ? "foi validado com sucesso."
      : action === "observation"
      ? "recebeu uma nova observação."
      : "foi atualizado.";
  const authorPrefix = authorName ? `${authorName}: ` : "";

  return createBatchNotifications(
    uniqueUsers.map((userId) => ({
      userId,
      type: "document",
      title: action === "validated" ? "Documento Validado" : "Documento Atualizado",
      body: `${authorPrefix}O documento "${documentName}" ${actionText}`,
      payload: { documentName, documentId, action, authorName },
    })),
  );
}

/**
 * Helper: Notify when a workflow list changes status.
 */
export async function notifyWorkflowStatusChanged(
  targetUserIds: string[],
  listName: string,
  fromStatus: string,
  toStatus: string,
  authorName?: string | null,
) {
  const uniqueUsers = Array.from(new Set(targetUserIds.filter(Boolean)));
  if (!uniqueUsers.length) return null;

  return createBatchNotifications(
    uniqueUsers.map((userId) => ({
      userId,
      type: "payment",
      title: `Workflow: ${listName}`,
      body: `${authorName ? `${authorName}: ` : ""}A lista "${listName}" mudou de "${fromStatus}" para "${toStatus}".`,
      payload: { listName, fromStatus, toStatus, authorName },
    })),
  );
}

