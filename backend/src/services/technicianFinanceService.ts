import { Prisma } from "@prisma/client";
import type { RequestContext } from "../middleware/requestContext.js";
import { prisma } from "../lib/prisma.js";
import { FinanceError } from "./expenseService.js";

function fail(statusCode: number, code: string, message: string): never {
  throw new FinanceError(statusCode, code, message);
}

function workspaceForRead(ctx: RequestContext) {
  if (!ctx.activeWorkspaceId) fail(403, "FINANCE_FORBIDDEN", "Workspace ativo não definido.");
  return ctx.activeWorkspaceId;
}

function workspaceForMutation(ctx: RequestContext) {
  if (!ctx.activeWorkspaceId) fail(403, "FINANCE_FORBIDDEN", "Workspace ativo não definido.");
  if (ctx.membershipRole !== "owner" && ctx.membershipRole !== "admin") {
    fail(403, "FINANCE_FORBIDDEN", "Você não possui permissão para liquidar saldos de técnicos.");
  }
  return ctx.activeWorkspaceId;
}

const zero = () => new Prisma.Decimal(0);
const money = (val: Prisma.Decimal) => val.toFixed(2);

export interface TechnicianFinanceSummary {
  personId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  currencyCode: string;
  expectedGross: string;
  receivedGross: string;
  totalExpenses: string;
  settledPayments: string;
  availableBalance: string; // receivedGross - totalExpenses - settledPayments
}

export interface TechnicianStatementItem {
  id: string;
  type: "earning" | "expense" | "settlement";
  date: string;
  description: string;
  category?: string;
  status: string;
  amount: string;
  currencyCode: string;
  referenceId?: string | null;
}

export interface TechnicianStatement {
  technician: {
    id: string;
    name: string;
    email?: string | null;
    phone?: string | null;
  };
  summary: {
    currencyCode: string;
    expectedGross: string;
    receivedGross: string;
    totalExpenses: string;
    settledPayments: string;
    availableBalance: string;
    status: "positive" | "zero" | "negative";
  };
  part1_earnings: TechnicianStatementItem[];
  part2_expenses: TechnicianStatementItem[];
  part3_settlements: TechnicianStatementItem[];
}

/**
 * List all technicians in the workspace with their aggregated financial positions.
 */
export async function listTechniciansWithFinanceSummary(ctx: RequestContext): Promise<TechnicianFinanceSummary[]> {
  const workspaceId = workspaceForRead(ctx);

  // If user is a technician, restrict only to their own personId
  const filterPersonId =
    ctx.membershipRole === "technician" && ctx.technicianPersonId ? ctx.technicianPersonId : undefined;

  const technicians = await prisma.person.findMany({
    where: {
      workspaceId,
      type: "technician",
      deletedAt: null,
      ...(filterPersonId ? { id: filterPersonId } : {}),
    },
    select: { id: true, fullName: true, email: true, phone: true },
    orderBy: { fullName: "asc" },
  });

  const results: TechnicianFinanceSummary[] = [];

  for (const tech of technicians) {
    // 1. Distributions for this technician
    const distributions = await prisma.distribution.findMany({
      where: {
        workspaceId,
        participantPersonId: tech.id,
        status: "active",
      },
    });

    const paymentListIds = [...new Set(distributions.map((d) => d.paymentListId))];
    const paymentLists = await prisma.paymentList.findMany({
      where: { id: { in: paymentListIds }, workspaceId },
      select: { id: true, status: true, currencyCode: true },
    });
    const listMap = new Map(paymentLists.map((pl) => [pl.id, pl]));

    let expectedGross = zero();
    let receivedGross = zero();
    let defaultCurrency = "EUR";

    for (const dist of distributions) {
      defaultCurrency = dist.currencyCode;
      const list = listMap.get(dist.paymentListId);
      if (list?.status === "pending") {
        expectedGross = expectedGross.add(dist.resolvedAmount);
      } else if (list?.status === "paid") {
        receivedGross = receivedGross.add(dist.resolvedAmount);
      }
    }

    // 2. Expenses tied to this technician (contextKind = technician_person)
    const expenses = await prisma.expense.findMany({
      where: {
        workspaceId,
        technicianPersonId: tech.id,
        status: "effective",
      },
      select: { amount: true, currencyCode: true },
    });
    let totalExpenses = zero();
    for (const exp of expenses) {
      totalExpenses = totalExpenses.add(exp.amount);
    }

    // 3. Settled payments to this technician via financial obligations
    const distIds = distributions.map((d) => d.id);
    const obligations = await prisma.financialObligation.findMany({
      where: {
        workspaceId,
        distributionId: { in: distIds },
      },
      select: { id: true },
    });
    const obligationIds = obligations.map((o) => o.id);

    const settledPaymentsRecords = await prisma.obligationPayment.findMany({
      where: {
        workspaceId,
        status: "effective",
        obligationId: { in: obligationIds },
      },
      select: { amount: true },
    });
    let settledPayments = zero();
    for (const sp of settledPaymentsRecords) {
      settledPayments = settledPayments.add(sp.amount);
    }

    // Available per Alex's rule: Received - Expenses - Settled
    const availableBalance = receivedGross.minus(totalExpenses).minus(settledPayments);

    results.push({
      personId: tech.id,
      name: tech.fullName,
      email: tech.email,
      phone: tech.phone,
      currencyCode: defaultCurrency,
      expectedGross: money(expectedGross),
      receivedGross: money(receivedGross),
      totalExpenses: money(totalExpenses),
      settledPayments: money(settledPayments),
      availableBalance: money(availableBalance),
    });
  }

  return results;
}

/**
 * Detailed 3-part statement (Extrato em 3 partes) for an individual technician.
 * Part 1: Produção / Repasses (Previstos e Recebidos)
 * Part 2: Despesas e Adiantamentos do Técnico
 * Part 3: Histórico de Acertos / Liquidações
 */
export async function getTechnicianStatement(
  ctx: RequestContext,
  personId: string
): Promise<TechnicianStatement> {
  const workspaceId = workspaceForRead(ctx);

  // Authorization check: technician can only access their own statement
  if (ctx.membershipRole === "technician" && ctx.technicianPersonId && ctx.technicianPersonId !== personId) {
    fail(403, "FINANCE_FORBIDDEN", "Você não tem permissão para visualizar o extrato de outro técnico.");
  }

  const tech = await prisma.person.findFirst({
    where: { id: personId, workspaceId, type: "technician", deletedAt: null },
  });
  if (!tech) fail(404, "TECHNICIAN_NOT_FOUND", "Técnico não encontrado.");

  // Part 1: Earnings (Distributions)
  const distributions = await prisma.distribution.findMany({
    where: {
      workspaceId,
      participantPersonId: personId,
      status: "active",
    },
    orderBy: { createdAt: "desc" },
  });

  const paymentListIds = [...new Set(distributions.map((d) => d.paymentListId))];
  const paymentLists = await prisma.paymentList.findMany({
    where: { id: { in: paymentListIds }, workspaceId },
  });
  const listMap = new Map(paymentLists.map((pl) => [pl.id, pl]));

  let expectedGross = zero();
  let receivedGross = zero();
  let primaryCurrency = "EUR";

  const part1_earnings: TechnicianStatementItem[] = distributions.map((d) => {
    primaryCurrency = d.currencyCode;
    const list = listMap.get(d.paymentListId);
    const listStatus = list?.status ?? "draft";
    const isPaid = listStatus === "paid";
    const isPending = listStatus === "pending";

    if (isPending) expectedGross = expectedGross.add(d.resolvedAmount);
    if (isPaid) receivedGross = receivedGross.add(d.resolvedAmount);

    return {
      id: d.id,
      type: "earning",
      date: d.createdAt.toISOString(),
      description: `Repasse - Lista ${list?.listNumber || d.paymentListId.slice(0, 8)} (${d.allocationMode === "percentage" ? `${d.percentage}%` : "Fixo"})`,
      status: listStatus,
      amount: money(d.resolvedAmount),
      currencyCode: d.currencyCode,
      referenceId: d.paymentListId,
    };
  });

  // Part 2: Expenses
  const expenses = await prisma.expense.findMany({
    where: {
      workspaceId,
      technicianPersonId: personId,
      status: "effective",
    },
    orderBy: { occurredOn: "desc" },
  });

  let totalExpenses = zero();
  const part2_expenses: TechnicianStatementItem[] = expenses.map((e) => {
    totalExpenses = totalExpenses.add(e.amount);
    return {
      id: e.id,
      type: "expense",
      date: e.occurredOn.toISOString(),
      description: e.description || `Despesa categoria: ${e.category}`,
      category: e.category,
      status: e.status,
      amount: money(e.amount),
      currencyCode: e.currencyCode,
      referenceId: e.id,
    };
  });

  // Part 3: Settlements (Obligation Payments)
  const distIds = distributions.map((d) => d.id);
  const obligations = await prisma.financialObligation.findMany({
    where: {
      workspaceId,
      distributionId: { in: distIds },
    },
    select: { id: true },
  });
  const obligationIds = obligations.map((o) => o.id);

  const settledPayments = await prisma.obligationPayment.findMany({
    where: {
      workspaceId,
      status: "effective",
      obligationId: { in: obligationIds },
    },
    orderBy: { paidAt: "desc" },
  });

  let totalSettled = zero();
  const part3_settlements: TechnicianStatementItem[] = settledPayments.map((p) => {
    totalSettled = totalSettled.add(p.amount);
    return {
      id: p.id,
      type: "settlement",
      date: p.paidAt.toISOString(),
      description: `Liquidação de Repasse efetuada`,
      status: p.status,
      amount: money(p.amount),
      currencyCode: p.currencyCode,
      referenceId: p.obligationId,
    };
  });

  const availableBalance = receivedGross.minus(totalExpenses).minus(totalSettled);
  let status: "positive" | "zero" | "negative" = "zero";
  if (availableBalance.gt(0)) status = "positive";
  else if (availableBalance.lt(0)) status = "negative";

  return {
    technician: {
      id: tech.id,
      name: tech.fullName,
      email: tech.email,
      phone: tech.phone,
    },
    summary: {
      currencyCode: primaryCurrency,
      expectedGross: money(expectedGross),
      receivedGross: money(receivedGross),
      totalExpenses: money(totalExpenses),
      settledPayments: money(totalSettled),
      availableBalance: money(availableBalance),
      status,
    },
    part1_earnings,
    part2_expenses,
    part3_settlements,
  };
}

/**
 * Settle a technician's positive available balance.
 * Creates an obligation for distributions eligible under paid lists and marks them settled.
 */
export async function settleTechnicianBalance(
  ctx: RequestContext,
  personId: string,
  amountToSettleStr?: string
) {
  const workspaceId = workspaceForMutation(ctx);

  const statement = await getTechnicianStatement(ctx, personId);
  const available = new Prisma.Decimal(statement.summary.availableBalance);

  if (available.lte(0)) {
    fail(422, "SETTLEMENT_NOT_AVAILABLE", "Técnico não possui saldo positivo disponível para repasse.");
  }

  const settleAmount = amountToSettleStr ? new Prisma.Decimal(amountToSettleStr) : available;
  if (settleAmount.lte(0) || settleAmount.gt(available)) {
    fail(422, "INVALID_SETTLE_AMOUNT", "Valor de liquidação inválido ou superior ao saldo disponível.");
  }

  return prisma.$transaction(async (tx) => {
    // Find active distributions for paid lists without settled obligation
    const distributions = await tx.distribution.findMany({
      where: {
        workspaceId,
        participantPersonId: personId,
        status: "active",
      },
    });

    const paymentListIds = [...new Set(distributions.map((d) => d.paymentListId))];
    const paidLists = await tx.paymentList.findMany({
      where: { id: { in: paymentListIds }, workspaceId, status: "paid" },
      select: { id: true },
    });
    const paidListIdSet = new Set(paidLists.map((l) => l.id));

    const eligibleDists = distributions.filter((d) => paidListIdSet.has(d.paymentListId));

    let remainingToSettle = settleAmount;
    const settledPayments = [];

    for (const dist of eligibleDists) {
      if (remainingToSettle.lte(0)) break;

      // Check existing obligation
      let obligation = await tx.financialObligation.findUnique({
        where: { distributionId: dist.id },
      });

      if (!obligation) {
        obligation = await tx.financialObligation.create({
          data: {
            workspaceId,
            distributionId: dist.id,
            amount: dist.resolvedAmount,
            currencyCode: dist.currencyCode,
            createdByUserId: ctx.actorUserId,
            status: "pending",
          },
        });
      }

      if (obligation.status === "pending") {
        const payAmount = Prisma.Decimal.min(obligation.amount, remainingToSettle);

        // Update obligation
        await tx.financialObligation.update({
          where: { id: obligation.id },
          data: {
            status: "paid",
            paidAt: new Date(),
            paidByUserId: ctx.actorUserId,
          },
        });

        const payment = await tx.obligationPayment.create({
          data: {
            workspaceId,
            obligationId: obligation.id,
            amount: payAmount,
            currencyCode: obligation.currencyCode,
            paidAt: new Date(),
            paidByUserId: ctx.actorUserId,
          },
        });

        settledPayments.push(payment);
        remainingToSettle = remainingToSettle.minus(payAmount);
      }
    }

    return {
      personId,
      settledAmount: money(settleAmount.minus(remainingToSettle)),
      remainingBalance: money(available.minus(settleAmount.minus(remainingToSettle))),
      paymentsCount: settledPayments.length,
    };
  });
}
