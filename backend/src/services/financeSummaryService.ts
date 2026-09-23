import { Prisma } from "@prisma/client";
import type { RequestContext } from "../middleware/requestContext.js";
import { prisma } from "../lib/prisma.js";

export type FinanceSummaryCurrency = {
  currencyCode: string;
  expected: string;
  received: string;
  expenses: string;
  settledObligationPayments: string;
  available: string;
};

function forbidden(message: string) {
  return Object.assign(new Error(message), { statusCode: 403 });
}

function assertSummaryAuthority(ctx: RequestContext): string {
  if (!ctx.activeWorkspaceId) throw forbidden("Workspace ativo não definido.");
  if (ctx.membershipRole !== "owner" && ctx.membershipRole !== "admin") {
    throw forbidden("Você não possui permissão para consultar o resumo financeiro.");
  }
  return ctx.activeWorkspaceId;
}

const zero = () => new Prisma.Decimal(0);
const money = (value: Prisma.Decimal) => value.toFixed(2);

export async function getFinanceSummary(ctx: RequestContext): Promise<{ currencies: FinanceSummaryCurrency[] }> {
  const workspaceId = assertSummaryAuthority(ctx);
  const [lists, expenses, payments] = await Promise.all([
    prisma.paymentList.groupBy({
      by: ["status", "currencyCode"],
      where: { workspaceId, status: { in: ["pending", "paid"] } },
      _sum: { recognizedTotal: true },
    }),
    prisma.expense.groupBy({
      by: ["currencyCode"], where: { workspaceId, status: "effective" }, _sum: { amount: true },
    }),
    prisma.obligationPayment.groupBy({
      by: ["currencyCode"], where: { workspaceId, status: "effective" }, _sum: { amount: true },
    }),
  ]);

  const buckets = new Map<string, { expected: Prisma.Decimal; received: Prisma.Decimal; expenses: Prisma.Decimal; payments: Prisma.Decimal }>();
  const bucket = (currencyCode: string) => {
    let item = buckets.get(currencyCode);
    if (!item) { item = { expected: zero(), received: zero(), expenses: zero(), payments: zero() }; buckets.set(currencyCode, item); }
    return item;
  };
  for (const row of lists) {
    const value = row._sum.recognizedTotal ?? zero();
    if (row.status === "pending") bucket(row.currencyCode).expected = value;
    if (row.status === "paid") bucket(row.currencyCode).received = value;
  }
  for (const row of expenses) bucket(row.currencyCode).expenses = row._sum.amount ?? zero();
  for (const row of payments) bucket(row.currencyCode).payments = row._sum.amount ?? zero();

  return { currencies: [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currencyCode, value]) => ({
    currencyCode, expected: money(value.expected), received: money(value.received), expenses: money(value.expenses),
    settledObligationPayments: money(value.payments), available: money(value.received.minus(value.expenses).minus(value.payments)),
  })) };
}
