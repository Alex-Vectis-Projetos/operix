import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { RequestContext } from "../middleware/requestContext.js";
import { prisma } from "../lib/prisma.js";
import { FinanceError } from "./expenseService.js";

function fail(statusCode: number, code: string, message: string): never {
  throw new FinanceError(statusCode, code, message);
}

function workspaceForMutation(ctx: RequestContext) {
  if (!ctx.activeWorkspaceId) fail(403, "FINANCE_FORBIDDEN", "Workspace ativo não definido.");
  if (ctx.membershipRole !== "owner" && ctx.membershipRole !== "admin") {
    fail(403, "FINANCE_FORBIDDEN", "Você não possui permissão para gerenciar regras de distribuição.");
  }
  return ctx.activeWorkspaceId;
}

function workspaceForRead(ctx: RequestContext) {
  if (!ctx.activeWorkspaceId) fail(403, "FINANCE_FORBIDDEN", "Workspace ativo não definido.");
  return ctx.activeWorkspaceId;
}

export type ProfitDistributionShareInput = {
  participantType: "technician" | "partner" | "workspace" | "other";
  personId?: string | null;
  percentage: string; // e.g. "60.00"
};

export type CreateProfitRuleInput = {
  name: string;
  siteKey?: string | null;
  clientId?: string | null;
  shares: ProfitDistributionShareInput[];
};

export type ApplyRuleToPaymentListInput = {
  paymentListId: string;
  ruleId?: string;
  shares?: ProfitDistributionShareInput[];
};

export async function createProfitRule(ctx: RequestContext, input: CreateProfitRuleInput) {
  const workspaceId = workspaceForMutation(ctx);
  const name = input.name.trim();
  if (!name) fail(422, "PROFIT_RULE_NAME_REQUIRED", "Nome da regra é obrigatório.");

  if (!input.shares || input.shares.length === 0) {
    fail(422, "PROFIT_RULE_SHARES_REQUIRED", "Ao menos uma cota de rateio deve ser informada.");
  }

  // Validate percentages sum up to 100%
  let totalPercent = new Prisma.Decimal(0);
  for (const share of input.shares) {
    const p = new Prisma.Decimal(share.percentage);
    if (p.lte(0) || p.gt(100)) fail(422, "PROFIT_RULE_SHARE_INVALID", "Percentual da cota deve ser entre 0 e 100.");
    totalPercent = totalPercent.add(p);
  }

  if (totalPercent.gt(100)) {
    fail(422, "PROFIT_RULE_TOTAL_EXCEEDS_100", "A soma dos percentuais não pode exceder 100%.");
  }

  return prisma.$transaction(async (tx) => {
    const rule = await tx.profitDistributionRule.create({
      data: {
        workspaceId,
        name,
        siteKey: input.siteKey?.trim() || null,
        clientId: input.clientId?.trim() || null,
        shares: {
          create: input.shares.map((s) => ({
            participantType: s.participantType,
            personId: s.personId?.trim() || null,
            percentage: new Prisma.Decimal(s.percentage),
          })),
        },
      },
      include: {
        shares: true,
      },
    });
    return rule;
  });
}

export async function listProfitRules(ctx: RequestContext) {
  const workspaceId = workspaceForRead(ctx);
  return prisma.profitDistributionRule.findMany({
    where: { workspaceId, isActive: true },
    include: { shares: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function deleteProfitRule(ctx: RequestContext, ruleId: string) {
  const workspaceId = workspaceForMutation(ctx);
  const existing = await prisma.profitDistributionRule.findFirst({
    where: { id: ruleId, workspaceId },
  });
  if (!existing) fail(404, "PROFIT_RULE_NOT_FOUND", "Regra de distribuição não encontrada.");

  await prisma.profitDistributionRule.update({
    where: { id: ruleId },
    data: { isActive: false },
  });
  return { success: true };
}

/**
 * Apply a rule or customized shares to a PaymentList in batch.
 * Respects Base HT (recognizedTotal) per Alex's rule.
 */
export async function applyRuleToPaymentList(ctx: RequestContext, input: ApplyRuleToPaymentListInput) {
  const workspaceId = workspaceForMutation(ctx);

  return prisma.$transaction(async (tx) => {
    const list = await tx.paymentList.findFirst({
      where: { id: input.paymentListId, workspaceId },
      select: { id: true, recognizedTotal: true, currencyCode: true, status: true },
    });
    if (!list) fail(404, "PAYMENT_LIST_NOT_FOUND", "Lista de pagamento não encontrada.");

    let sharesToApply: { participantType: string; personId?: string | null; percentage: Prisma.Decimal }[] = [];

    if (input.ruleId) {
      const rule = await tx.profitDistributionRule.findFirst({
        where: { id: input.ruleId, workspaceId, isActive: true },
        include: { shares: true },
      });
      if (!rule) fail(404, "PROFIT_RULE_NOT_FOUND", "Regra de distribuição não encontrada.");
      sharesToApply = rule.shares.map((s) => ({
        participantType: s.participantType,
        personId: s.personId,
        percentage: s.percentage,
      }));
    } else if (input.shares && input.shares.length > 0) {
      sharesToApply = input.shares.map((s) => ({
        participantType: s.participantType,
        personId: s.personId?.trim() || null,
        percentage: new Prisma.Decimal(s.percentage),
      }));
    } else {
      fail(422, "PROFIT_RULE_NO_SHARES", "Informe uma regra existente ou a lista de cotas.");
    }

    const baseAmount = list.recognizedTotal;
    const createdDistributions = [];

    for (const share of sharesToApply) {
      const resolvedAmount = baseAmount
        .mul(share.percentage)
        .div(100)
        .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

      if (resolvedAmount.lte(0)) continue;

      let participantKind: "person" | "workspace" | "client" = "person";
      let participantPersonId: string | null = null;
      let participantWorkspaceId: string | null = null;

      if (share.participantType === "workspace") {
        participantKind = "workspace";
        participantWorkspaceId = workspaceId;
      } else if (share.personId) {
        participantKind = "person";
        participantPersonId = share.personId;
      } else {
        // Fallback or generic partner
        participantKind = "workspace";
        participantWorkspaceId = workspaceId;
      }

      const dist = await tx.distribution.create({
        data: {
          workspaceId,
          paymentListId: list.id,
          participantKind,
          participantPersonId,
          participantWorkspaceId,
          allocationMode: "percentage",
          percentage: share.percentage,
          resolvedAmount,
          currencyCode: list.currencyCode,
          ruleId: input.ruleId || null,
          createdByUserId: ctx.actorUserId,
        },
      });

      createdDistributions.push(dist);
    }

    return {
      paymentListId: list.id,
      distributionsCount: createdDistributions.length,
      items: createdDistributions,
    };
  });
}
