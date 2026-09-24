import { createHash } from "node:crypto";
import { Prisma, type Distribution } from "@prisma/client";
import type { RequestContext } from "../middleware/requestContext.js";
import { prisma } from "../lib/prisma.js";
import { FinanceError } from "./expenseService.js";

export type DistributionParticipant =
  | { kind: "person"; personId: string }
  | { kind: "workspace"; workspaceId: string }
  | { kind: "client"; clientId: string };
export type DistributionAllocation =
  | { mode: "fixed"; amount: string }
  | { mode: "percentage"; percentage: string };
export type DistributionInput = { paymentListId: string; paymentListItemId?: string | null; participant: DistributionParticipant; allocation: DistributionAllocation };
export type DistributionCancelInput = { reason: string };

function fail(statusCode: number, code: string, message: string): never { throw new FinanceError(statusCode, code, message); }
function workspaceForMutation(ctx: RequestContext) {
  if (!ctx.activeWorkspaceId || (ctx.membershipRole !== "owner" && ctx.membershipRole !== "admin")) fail(403, "FINANCE_FORBIDDEN", "Você não possui permissão para operar distribuições.");
  return ctx.activeWorkspaceId;
}
function workspaceForRead(ctx: RequestContext) {
  if (!ctx.activeWorkspaceId) fail(403, "FINANCE_FORBIDDEN", "Workspace ativo não definido.");
  if (ctx.membershipRole === "owner" || ctx.membershipRole === "admin") return { workspaceId: ctx.activeWorkspaceId, technicianPersonId: undefined };
  if (ctx.membershipRole === "technician" && ctx.technicianPersonId) return { workspaceId: ctx.activeWorkspaceId, technicianPersonId: ctx.technicianPersonId };
  fail(403, "FINANCE_FORBIDDEN", "Você não possui permissão para consultar distribuições.");
}
function fingerprint(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function money(value: string, code: string) {
  const decimal = new Prisma.Decimal(value);
  if (decimal.lte(0) || decimal.gt(new Prisma.Decimal("9999999999.99"))) fail(422, code, "Valor de distribuição inválido.");
  return decimal;
}
function createFingerprint(input: DistributionInput) {
  const allocation = input.allocation.mode === "fixed"
    ? { mode: "fixed", amount: money(input.allocation.amount, "DISTRIBUTION_AMOUNT_INVALID").toFixed(2) }
    : { mode: "percentage", percentage: new Prisma.Decimal(input.allocation.percentage).toFixed(2) };
  return fingerprint({ paymentListId: input.paymentListId, paymentListItemId: input.paymentListItemId ?? null, participant: input.participant, allocation });
}
function cancelFingerprint(distributionId: string, input: DistributionCancelInput) { return fingerprint({ distributionId, reason: input.reason.trim() }); }

async function resolveSource(tx: Prisma.TransactionClient, workspaceId: string, input: DistributionInput) {
  const list = await tx.paymentList.findFirst({ where: { id: input.paymentListId, workspaceId }, select: { id: true, recognizedTotal: true, currencyCode: true } });
  if (!list) fail(404, "DISTRIBUTION_PAYMENT_LIST_NOT_FOUND", "Lista de pagamento não encontrada.");
  if (!input.paymentListItemId) return { list, itemId: null, base: list.recognizedTotal };
  const item = await tx.paymentListItem.findFirst({ where: { id: input.paymentListItemId, workspaceId }, select: { id: true, paymentListId: true, totalAmount: true } });
  if (!item) fail(404, "DISTRIBUTION_ITEM_NOT_FOUND", "Item da lista de pagamento não encontrado.");
  if (item.paymentListId !== list.id) fail(422, "DISTRIBUTION_ITEM_LIST_MISMATCH", "Item não pertence à lista de pagamento informada.");
  return { list, itemId: item.id, base: item.totalAmount };
}
async function resolveParticipant(tx: Prisma.TransactionClient, workspaceId: string, participant: DistributionParticipant) {
  const missing = () => fail(404, "DISTRIBUTION_PARTICIPANT_NOT_FOUND", "Participante não encontrado.");
  if (participant.kind === "person") {
    if (!await tx.person.findFirst({ where: { id: participant.personId, workspaceId, deletedAt: null }, select: { id: true } })) missing();
    return { participantKind: "person" as const, participantPersonId: participant.personId };
  }
  if (participant.kind === "workspace") {
    if (participant.workspaceId !== workspaceId) missing();
    return { participantKind: "workspace" as const, participantWorkspaceId: workspaceId };
  }
  if (!await tx.client.findFirst({ where: { id: participant.clientId, workspaceId, deletedAt: null }, select: { id: true } })) missing();
  return { participantKind: "client" as const, participantClientId: participant.clientId };
}
function resolveAllocation(input: DistributionAllocation, base: Prisma.Decimal) {
  if (input.mode === "fixed") {
    const fixed = money(input.amount, "DISTRIBUTION_AMOUNT_INVALID");
    return { allocationMode: "fixed" as const, fixedAmount: fixed.toFixed(2), resolvedAmount: fixed.toFixed(2) };
  }
  const percentage = new Prisma.Decimal(input.percentage);
  if (percentage.lte(0) || percentage.gt(100)) fail(422, "DISTRIBUTION_PERCENTAGE_INVALID", "Percentual de distribuição inválido.");
  const resolved = base.mul(percentage).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  if (resolved.lte(0)) fail(422, "DISTRIBUTION_RESOLVED_AMOUNT_INVALID", "Percentual não produz valor distribuível.");
  return { allocationMode: "percentage" as const, percentage: percentage.toFixed(2), resolvedAmount: resolved.toFixed(2) };
}
export function presentDistribution(distribution: Distribution) {
  const participant = distribution.participantKind === "person"
    ? { kind: "person", personId: distribution.participantPersonId! }
    : distribution.participantKind === "workspace"
      ? { kind: "workspace", workspaceId: distribution.participantWorkspaceId! }
      : { kind: "client", clientId: distribution.participantClientId! };
  const allocation = distribution.allocationMode === "fixed"
    ? { mode: "fixed", amount: distribution.fixedAmount!.toFixed(2) }
    : { mode: "percentage", percentage: distribution.percentage!.toFixed(2) };
  return {
    id: distribution.id, paymentListId: distribution.paymentListId, paymentListItemId: distribution.paymentListItemId,
    participant, allocation, resolvedAmount: distribution.resolvedAmount.toFixed(2), currencyCode: distribution.currencyCode, status: distribution.status,
    createdAt: distribution.createdAt.toISOString(), createdByUserId: distribution.createdByUserId,
    cancelledAt: distribution.cancelledAt?.toISOString() ?? null, cancelledByUserId: distribution.cancelledByUserId ?? null, cancellationReason: distribution.cancellationReason ?? null,
  };
}
async function replay(tx: Prisma.TransactionClient, workspaceId: string, actorUserId: string, actionNamespace: string, idempotencyKey: string, requestHash: string) {
  const record = await tx.financeIdempotency.findUnique({ where: { workspaceId_actorUserId_actionNamespace_idempotencyKey: { workspaceId, actorUserId, actionNamespace, idempotencyKey } } });
  if (!record) return null;
  if (record.requestHash !== requestHash) fail(409, "IDEMPOTENCY_KEY_REUSED", "Chave de idempotência reutilizada com outra solicitação.");
  const distribution = await tx.distribution.findFirst({ where: { id: record.resourceId, workspaceId } });
  if (!distribution) fail(409, "IDEMPOTENCY_RESOURCE_MISSING", "Materialização idempotente não encontrada.");
  return distribution;
}

export async function createDistribution(ctx: RequestContext, input: DistributionInput, idempotencyKey: string) {
  const workspaceId = workspaceForMutation(ctx), requestHash = createFingerprint(input);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await replay(tx, workspaceId, ctx.actorUserId, "distribution.create", idempotencyKey, requestHash);
      if (existing) return { distribution: existing, idempotent: true };
      const source = await resolveSource(tx, workspaceId, input);
      const distribution = await tx.distribution.create({ data: {
        workspaceId, paymentListId: source.list.id, paymentListItemId: source.itemId, currencyCode: source.list.currencyCode, createdByUserId: ctx.actorUserId,
        ...await resolveParticipant(tx, workspaceId, input.participant), ...resolveAllocation(input.allocation, source.base),
      } });
      await tx.financeIdempotency.create({ data: { workspaceId, actorUserId: ctx.actorUserId, actionNamespace: "distribution.create", idempotencyKey, requestHash, resourceType: "distribution", resourceId: distribution.id } });
      return { distribution, idempotent: false };
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const existing = await prisma.$transaction((tx) => replay(tx, workspaceId, ctx.actorUserId, "distribution.create", idempotencyKey, requestHash));
    if (!existing) throw error;
    return { distribution: existing, idempotent: true };
  }
}

export async function listDistributions(ctx: RequestContext) {
  const scope = workspaceForRead(ctx);
  return prisma.distribution.findMany({ where: { workspaceId: scope.workspaceId, ...(scope.technicianPersonId ? { participantPersonId: scope.technicianPersonId } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "asc" }] });
}
export async function getDistribution(ctx: RequestContext, distributionId: string) {
  const scope = workspaceForRead(ctx);
  const distribution = await prisma.distribution.findFirst({ where: { id: distributionId, workspaceId: scope.workspaceId, ...(scope.technicianPersonId ? { participantPersonId: scope.technicianPersonId } : {}) } });
  if (!distribution) fail(404, "DISTRIBUTION_NOT_FOUND", "Distribuição não encontrada.");
  return distribution;
}
export async function cancelDistribution(ctx: RequestContext, distributionId: string, input: DistributionCancelInput, idempotencyKey: string) {
  const workspaceId = workspaceForMutation(ctx), requestHash = cancelFingerprint(distributionId, input);
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await replay(tx, workspaceId, ctx.actorUserId, "distribution.cancel", idempotencyKey, requestHash);
      if (existing) return { distribution: existing, idempotent: true };
      const current = await tx.distribution.findFirst({ where: { id: distributionId, workspaceId } });
      if (!current) fail(404, "DISTRIBUTION_NOT_FOUND", "Distribuição não encontrada.");
      if (current.status !== "active") fail(409, "DISTRIBUTION_NOT_CANCELLABLE", "Distribuição não pode ser cancelada.");
      if (await tx.financialObligation.findFirst({ where: { workspaceId, distributionId, status: { in: ["pending", "paid", "reversed"] } }, select: { id: true } })) fail(409, "DISTRIBUTION_NOT_CANCELLABLE", "Distribuição possui obrigação vinculada.");
      const changed = await tx.distribution.updateMany({ where: { id: distributionId, workspaceId, status: "active" }, data: { status: "cancelled", cancelledAt: new Date(), cancelledByUserId: ctx.actorUserId, cancellationReason: input.reason.trim() } });
      if (changed.count !== 1) {
        const raced = await replay(tx, workspaceId, ctx.actorUserId, "distribution.cancel", idempotencyKey, requestHash);
        if (raced) return { distribution: raced, idempotent: true };
        fail(409, "DISTRIBUTION_NOT_CANCELLABLE", "Distribuição não pode ser cancelada.");
      }
      const distribution = await tx.distribution.findUniqueOrThrow({ where: { id: distributionId } });
      await tx.financeIdempotency.create({ data: { workspaceId, actorUserId: ctx.actorUserId, actionNamespace: "distribution.cancel", idempotencyKey, requestHash, resourceType: "distribution", resourceId: distribution.id } });
      return { distribution, idempotent: false };
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const existing = await prisma.$transaction((tx) => replay(tx, workspaceId, ctx.actorUserId, "distribution.cancel", idempotencyKey, requestHash));
    if (!existing) throw error;
    return { distribution: existing, idempotent: true };
  }
}
