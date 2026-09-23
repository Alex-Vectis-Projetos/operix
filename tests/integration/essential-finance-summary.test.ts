// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { once } from "node:events";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://operix_local:operix_local@127.0.0.1:55432/operix_local?schema=public";
process.env.JWT_SECRET ??= "this-is-a-test-secret-with-more-than-32-chars-long";
process.env.MINIO_ROOT_PASSWORD ??= "operix-test-minio-password";

const { prisma } = await import("../../backend/src/lib/prisma.js");
const { getFinanceSummary } = await import("../../backend/src/services/financeSummaryService.js");
const express = (await import("../../backend/node_modules/express/index.js")).default;
const { financeV2Router } = await import("../../backend/src/routes/financeV2.js");
const { paymentListsRouter } = await import("../../backend/src/routes/paymentLists.js");
const { signAccessToken } = await import("../../backend/src/lib/jwt.js");

const U = "f7100000-0000-4000-8000-000000000001", A = "f7200000-0000-4000-8000-000000000001";
const T = "f7100000-0000-4000-8000-000000000002", TA = "f7200000-0000-4000-8000-000000000002";
const C = "f7100000-0000-4000-8000-000000000003", CAU = "f7200000-0000-4000-8000-000000000003";
const P = "f7100000-0000-4000-8000-000000000004", PA = "f7200000-0000-4000-8000-000000000004";
const WA = "f7300000-0000-4000-8000-000000000001", WB = "f7300000-0000-4000-8000-000000000002", WP = "f7300000-0000-4000-8000-000000000003";
const CA = "f7400000-0000-4000-8000-000000000001", CB = "f7400000-0000-4000-8000-000000000002";
const LIST_E_PENDING = "f7600000-0000-4000-8000-000000000001", LIST_E_PAID = "f7600000-0000-4000-8000-000000000002";
const LIST_CAD = "f7600000-0000-4000-8000-000000000003", LIST_USD = "f7600000-0000-4000-8000-000000000004", LIST_B = "f7600000-0000-4000-8000-000000000005";
const CAD_EXPENSE = "f7500000-0000-4000-8000-000000000001", GBP_EXPENSE = "f7500000-0000-4000-8000-000000000002";
const CAD_OBLIGATION = "f7800000-0000-4000-8000-000000000001", USD_OBLIGATION = "f7800000-0000-4000-8000-000000000002";
const CAD_PAYMENT = "f7900000-0000-4000-8000-000000000001", USD_PAYMENT = "f7900000-0000-4000-8000-000000000002";

const ctx = (workspaceId = WA, membershipRole: any = "owner") => ({ actorUserId: U, platformRole: "user" as const, activeWorkspaceId: workspaceId, membershipRole, scope: "workspace" as const, capabilities: ["*"] });

async function clean() {
  const workspaces = [WA, WB, WP];
  for (const table of ["finance_idempotency", "obligation_payments", "financial_obligations", "distributions", "expenses"]) await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE workspace_id IN ('${workspaces.join("','")}')`);
  await prisma.financialRecord.deleteMany({ where: { workspaceId: { in: workspaces } } });
  await prisma.paymentList.deleteMany({ where: { workspaceId: { in: workspaces } } });
  await prisma.client.deleteMany({ where: { id: { in: [CA, CB] } } });
  await prisma.workspace.deleteMany({ where: { id: { in: workspaces } } });
  await prisma.appUser.deleteMany({ where: { id: { in: [A, TA, CAU, PA] } } });
  await prisma.user.deleteMany({ where: { id: { in: [U, T, C, P] } } });
}

describe("Spec 005 — T05 canonical finance summary", () => {
  let server: any, base = "";
  const token = (id: string) => signAccessToken({ id, email: `${id}@t`, role: "admin" });
  const get = (id?: string, path = "/summary", workspaceId = WA) => fetch(base + path, { headers: id ? { Authorization: `Bearer ${token(id)}`, "X-Workspace-Id": workspaceId } : {} });

  beforeAll(async () => {
    await clean();
    await prisma.user.create({ data: { id: U, email: "summary@t", fullName: "Summary", role: "admin", passwordHash: "x", appUser: { create: { id: A, email: "summary@t" } } } });
    await prisma.user.create({ data: { id: T, email: "tech@t", fullName: "Tech", role: "technician", passwordHash: "x", appUser: { create: { id: TA, email: "tech@t" } } } });
    await prisma.user.create({ data: { id: C, email: "client@t", fullName: "Client", role: "user", passwordHash: "x", appUser: { create: { id: CAU, email: "client@t" } } } });
    await prisma.user.create({ data: { id: P, email: "personal@t", fullName: "Personal", role: "technician", passwordHash: "x", appUser: { create: { id: PA, email: "personal@t" } } } });
    await prisma.workspace.create({ data: { id: WA, name: "A", ownerUserId: A, memberships: { create: [{ userId: TA, role: "technician", status: "active" }, { userId: CAU, role: "client", status: "active" }] } } });
    await prisma.workspace.create({ data: { id: WB, name: "B", ownerUserId: A } });
    await prisma.workspace.create({ data: { id: WP, name: "Personal", type: "personal", ownerUserId: PA } });
    await prisma.client.createMany({ data: [{ id: CA, workspaceId: WA, name: "A" }, { id: CB, workspaceId: WB, name: "B" }] });
    await prisma.paymentList.createMany({ data: [
      { id: LIST_E_PENDING, workspaceId: WA, listNumber: "pending-eur", clientId: CA, clientName: "A", currencyCode: "EUR", status: "pending", recognizedTotal: "0.30", sourceDocumentTotal: "999.99", createdBy: U },
      { id: LIST_E_PAID, workspaceId: WA, listNumber: "paid-eur", clientId: CA, clientName: "A", currencyCode: "EUR", status: "paid", recognizedTotal: "5000.00", createdBy: U },
      { id: LIST_CAD, workspaceId: WA, listNumber: "matrix-cad", clientId: CA, clientName: "A", currencyCode: "CAD", status: "paid", recognizedTotal: "5000.00", createdBy: U },
      { id: LIST_USD, workspaceId: WA, listNumber: "negative-usd", clientId: CA, clientName: "A", currencyCode: "USD", status: "paid", recognizedTotal: "1000.00", createdBy: U },
      { id: LIST_B, workspaceId: WB, listNumber: "isolation-b", clientId: CB, clientName: "B", currencyCode: "EUR", status: "paid", recognizedTotal: "7777.77", createdBy: U },
    ] });
    await prisma.$executeRawUnsafe(`INSERT INTO expenses(id,workspace_id,amount,currency_code,category,occurred_on,created_by_user_id) VALUES ('${CAD_EXPENSE}','${WA}',3000,'CAD','fuel',CURRENT_DATE,'${U}'),('${GBP_EXPENSE}','${WA}',0.10,'GBP','fuel',CURRENT_DATE,'${U}'),('f7500000-0000-4000-8000-000000000003','${WA}',3000,'EUR','fuel',CURRENT_DATE,'${U}'),('f7500000-0000-4000-8000-000000000004','${WA}',800,'USD','fuel',CURRENT_DATE,'${U}')`);
    await prisma.$executeRawUnsafe(`INSERT INTO distributions(id,workspace_id,payment_list_id,participant_kind,participant_client_id,allocation_mode,fixed_amount,resolved_amount,currency_code,created_by_user_id) VALUES ('f7700000-0000-4000-8000-000000000001','${WA}','${LIST_CAD}','client','${CA}','fixed',2000,2000,'CAD','${U}'),('f7700000-0000-4000-8000-000000000002','${WA}','${LIST_USD}','client','${CA}','fixed',500,500,'USD','${U}')`);
    await prisma.$executeRawUnsafe(`INSERT INTO financial_obligations(id,workspace_id,distribution_id,amount,currency_code,created_by_user_id) VALUES ('${CAD_OBLIGATION}','${WA}','f7700000-0000-4000-8000-000000000001',2000,'CAD','${U}'),('${USD_OBLIGATION}','${WA}','f7700000-0000-4000-8000-000000000002',500,'USD','${U}')`);
    await prisma.$executeRawUnsafe(`INSERT INTO obligation_payments(id,workspace_id,obligation_id,amount,currency_code,paid_at,paid_by_user_id) VALUES ('${USD_PAYMENT}','${WA}','${USD_OBLIGATION}',500,'USD',NOW(),'${U}')`);
    const app = express(); app.use("/api/payment-lists", paymentListsRouter); app.use("/api/finance/v2", financeV2Router); server = app.listen(0); await once(server, "listening"); base = `http://127.0.0.1:${server.address().port}/api/finance/v2`;
  });

  afterAll(async () => { server.close(); await clean(); await prisma.$disconnect(); });

  it("aggregates canonical PaymentList and effective facts per ordered currency with Decimal strings", async () => {
    expect(await getFinanceSummary(ctx())).toEqual({ currencies: [
      { currencyCode: "CAD", expected: "0.00", received: "5000.00", expenses: "3000.00", settledObligationPayments: "0.00", available: "2000.00" },
      { currencyCode: "EUR", expected: "0.30", received: "5000.00", expenses: "3000.00", settledObligationPayments: "0.00", available: "2000.00" },
      { currencyCode: "GBP", expected: "0.00", received: "0.00", expenses: "0.10", settledObligationPayments: "0.00", available: "-0.10" },
      { currencyCode: "USD", expected: "0.00", received: "1000.00", expenses: "800.00", settledObligationPayments: "500.00", available: "-300.00" },
    ] });
  });

  it("moves one canonical list from expected to received without double counting", async () => {
    await prisma.paymentList.update({ where: { id: LIST_E_PENDING }, data: { status: "paid" } });
    expect((await getFinanceSummary(ctx())).currencies.find((x) => x.currencyCode === "EUR")).toMatchObject({ expected: "0.00", received: "5000.30", available: "2000.30" });
  });

  it("proves the complete Available current-state matrix without deleting audit facts", async () => {
    expect((await getFinanceSummary(ctx())).currencies.find((x) => x.currencyCode === "CAD")).toMatchObject({ received: "5000.00", expenses: "3000.00", settledObligationPayments: "0.00", available: "2000.00" });
    await prisma.$executeRawUnsafe(`INSERT INTO obligation_payments(id,workspace_id,obligation_id,amount,currency_code,paid_at,paid_by_user_id) VALUES ('${CAD_PAYMENT}','${WA}','${CAD_OBLIGATION}',2000,'CAD',NOW(),'${U}')`);
    expect((await getFinanceSummary(ctx())).currencies.find((x) => x.currencyCode === "CAD")).toMatchObject({ settledObligationPayments: "2000.00", available: "0.00" });
    await prisma.$executeRawUnsafe(`UPDATE obligation_payments SET status='reversed',reversed_at=NOW(),reversed_by_user_id='${U}',reversal_reason='fixture correction' WHERE id='${CAD_PAYMENT}'`);
    expect((await getFinanceSummary(ctx())).currencies.find((x) => x.currencyCode === "CAD")).toMatchObject({ settledObligationPayments: "0.00", available: "2000.00" });
    await prisma.$executeRawUnsafe(`UPDATE expenses SET status='reversed',reversed_at=NOW(),reversed_by_user_id='${U}',reversal_reason='fixture correction' WHERE id='${CAD_EXPENSE}'`);
    expect((await getFinanceSummary(ctx())).currencies.find((x) => x.currencyCode === "CAD")).toMatchObject({ expenses: "0.00", available: "5000.00" });
    expect((await getFinanceSummary(ctx())).currencies.find((x) => x.currencyCode === "USD")).toMatchObject({ available: "-300.00" });
    expect(await prisma.obligationPayment.count({ where: { id: CAD_PAYMENT, status: "reversed" } })).toBe(1); expect(await prisma.expense.count({ where: { id: CAD_EXPENSE, status: "reversed" } })).toBe(1);
  });

  it("removes a currency represented only by reversed canonical facts", async () => {
    await prisma.$executeRawUnsafe(`UPDATE expenses SET status='reversed',reversed_at=NOW(),reversed_by_user_id='${U}',reversal_reason='fixture correction' WHERE id='${GBP_EXPENSE}'`);
    expect((await getFinanceSummary(ctx())).currencies.find((x) => x.currencyCode === "GBP")).toBeUndefined(); expect(await prisma.expense.count({ where: { id: GBP_EXPENSE, status: "reversed" } })).toBe(1);
  });

  it("denies technician and client workspace capability", async () => {
    await expect(getFinanceSummary(ctx(WA, "technician"))).rejects.toMatchObject({ statusCode: 403}); await expect(getFinanceSummary(ctx(WA, "client"))).rejects.toMatchObject({ statusCode: 403 });
  });

  it("excludes conspicuous legacy FinancialRecord revenue through the real summary route", async () => {
    await prisma.financialRecord.create({ data: { workspaceId: WA, type: "income", amount: 9999, source: "legacy" } }); const body = await (await get(U)).json(); const eur = body.currencies.find((x: any) => x.currencyCode === "EUR"); expect(eur).toMatchObject({ received: "5000.30", expected: "0.00" }); expect(JSON.stringify(body)).not.toContain("9999");
  });

  it("keeps owner A in non-zero workspace A, permits client operations, and denies finance", async () => {
    expect((await get()).status).toBe(401); expect((await get(T)).status).toBe(403);
    const operational = await fetch(base.replace("/api/finance/v2", "/api/payment-lists"), { headers: { Authorization: `Bearer ${token(C)}`, "X-Workspace-Id": WA } }); expect(operational.status).toBe(200); expect((await get(C)).status).toBe(403);
    const owner = await get(U); expect(owner.status).toBe(200); expect(JSON.stringify(await owner.json())).not.toContain("7777.77");
    for (const path of [`/summary?workspaceId=${WB}`, `/summary?workspace_id=${WB}`]) { const scoped = await get(U, path); expect(scoped.status).toBe(200); const body = await scoped.json(); expect(body.currencies.find((x: any) => x.currencyCode === "EUR")).toMatchObject({ received: "5000.30" }); expect(JSON.stringify(body)).not.toContain("7777.77"); }
  });

  it("allows a technician who owns an active personal workspace", async () => { const personal = await get(P, "/summary", WP); expect(personal.status).toBe(200); expect(await personal.json()).toEqual({ currencies: [] }); });
});
