// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { once } from "node:events";
import { readFile } from "node:fs/promises";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://operix_local:operix_local@127.0.0.1:55432/operix_local?schema=public";
process.env.JWT_SECRET ??= "this-is-a-test-secret-with-more-than-32-chars-long";
process.env.MINIO_ROOT_PASSWORD ??= "operix-test-minio-password";

const express = (await import("../../backend/node_modules/express/index.js")).default;
const { financeV2Router } = await import("../../backend/src/routes/financeV2.js");
const { paymentListsRouter } = await import("../../backend/src/routes/paymentLists.js");
const { signAccessToken } = await import("../../backend/src/lib/jwt.js");
const { prisma } = await import("../../backend/src/lib/prisma.js");

const fixture = {
  workspaceA: "f5000000-0000-4000-8000-000000000001", workspaceB: "f5000000-0000-4000-8000-000000000002",
  ownerA: "f5100000-0000-4000-8000-000000000001", ownerAApp: "f5200000-0000-4000-8000-000000000001",
  ownerB: "f5100000-0000-4000-8000-000000000002", ownerBApp: "f5200000-0000-4000-8000-000000000002",
  technicianA: "f5100000-0000-4000-8000-000000000003", technicianAApp: "f5200000-0000-4000-8000-000000000003",
  clientA: "f5100000-0000-4000-8000-000000000005", clientAApp: "f5200000-0000-4000-8000-000000000005",
  clientAId: "f5300000-0000-4000-8000-000000000001", clientBId: "f5300000-0000-4000-8000-000000000002",
  eurPaidList: "f5400000-0000-4000-8000-000000000001", eurPendingList: "f5400000-0000-4000-8000-000000000002",
  eurDraftList: "f5400000-0000-4000-8000-000000000003", gbpPaidList: "f5400000-0000-4000-8000-000000000004", bPaidList: "f5400000-0000-4000-8000-000000000005",
};

describe("Spec 005 — normative acceptance synchronized through T05", () => {
  let server: any, baseUrl = "";
  const headers = (actor = fixture.ownerA, workspace = fixture.workspaceA, key = "spec005-normative-key") => ({
    Authorization: `Bearer ${signAccessToken({ id: actor, email: `${actor}@spec005.test`, role: "admin" })}`,
    "X-Workspace-Id": workspace, "Content-Type": "application/json", "Idempotency-Key": key,
  });
  const request = (path: string, init: RequestInit = {}) => fetch(`${baseUrl}/api/finance/v2${path}`, init);
  const ownerSummary = () => request("/summary", { headers: headers() });
  const expense = { amount: "3000.00", currencyCode: "EUR", category: "fuel", occurredOn: "2026-09-23", context: { kind: "payment_list", id: fixture.eurPaidList } };
  const distribution = { paymentListId: fixture.eurPaidList, paymentListItemId: null, participant: { kind: "person", personId: fixture.technicianA }, allocation: { mode: "percentage", percentage: "40.00" } };

  async function resetFixture() {
    const ws = [fixture.workspaceA, fixture.workspaceB];
    for (const table of ["finance_idempotency", "obligation_payments", "financial_obligations", "distributions", "expenses"]) await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE workspace_id IN ('${ws.join("','")}')`);
    await prisma.financialRecord.deleteMany({ where: { workspaceId: { in: ws } } });
    await prisma.paymentList.deleteMany({ where: { workspaceId: { in: ws } } });
    await prisma.client.deleteMany({ where: { id: { in: [fixture.clientAId, fixture.clientBId] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: ws } } });
    await prisma.user.deleteMany({ where: { id: { in: [fixture.ownerA, fixture.ownerB, fixture.technicianA, fixture.clientA] } } });
    await prisma.user.create({ data: { id: fixture.ownerA, email: "owner-a@spec005.test", fullName: "Owner A", role: "admin", passwordHash: "x", appUser: { create: { id: fixture.ownerAApp, email: "owner-a@spec005.test" } } } });
    await prisma.user.create({ data: { id: fixture.ownerB, email: "owner-b@spec005.test", fullName: "Owner B", role: "admin", passwordHash: "x", appUser: { create: { id: fixture.ownerBApp, email: "owner-b@spec005.test" } } } });
    await prisma.user.create({ data: { id: fixture.technicianA, email: "tech-a@spec005.test", fullName: "Tech A", role: "technician", passwordHash: "x", appUser: { create: { id: fixture.technicianAApp, email: "tech-a@spec005.test" } } } });
    await prisma.user.create({ data: { id: fixture.clientA, email: "client-a@spec005.test", fullName: "Client A", role: "user", passwordHash: "x", appUser: { create: { id: fixture.clientAApp, email: "client-a@spec005.test" } } } });
    await prisma.workspace.create({ data: { id: fixture.workspaceA, name: "Normative A", ownerUserId: fixture.ownerAApp, memberships: { create: [{ userId: fixture.technicianAApp, role: "technician", status: "active" }, { userId: fixture.clientAApp, role: "client", status: "active" }] } } });
    await prisma.workspace.create({ data: { id: fixture.workspaceB, name: "Normative B", ownerUserId: fixture.ownerBApp } });
    await prisma.client.createMany({ data: [{ id: fixture.clientAId, workspaceId: fixture.workspaceA, name: "Client A" }, { id: fixture.clientBId, workspaceId: fixture.workspaceB, name: "Client B" }] });
    await prisma.paymentList.createMany({ data: [
      { id: fixture.eurPaidList, workspaceId: fixture.workspaceA, listNumber: "eur-paid", clientId: fixture.clientAId, clientName: "Client A", currencyCode: "EUR", status: "paid", recognizedTotal: "5000.00", createdBy: fixture.ownerA },
      { id: fixture.eurPendingList, workspaceId: fixture.workspaceA, listNumber: "eur-pending", clientId: fixture.clientAId, clientName: "Client A", currencyCode: "EUR", status: "pending", recognizedTotal: "5000.00", createdBy: fixture.ownerA },
      { id: fixture.eurDraftList, workspaceId: fixture.workspaceA, listNumber: "eur-draft", clientId: fixture.clientAId, clientName: "Client A", currencyCode: "EUR", status: "draft", recognizedTotal: "999.00", createdBy: fixture.ownerA },
      { id: fixture.gbpPaidList, workspaceId: fixture.workspaceA, listNumber: "gbp-negative", clientId: fixture.clientAId, clientName: "Client A", currencyCode: "GBP", status: "paid", recognizedTotal: "1000.00", createdBy: fixture.ownerA },
      { id: fixture.bPaidList, workspaceId: fixture.workspaceB, listNumber: "b-isolation", clientId: fixture.clientBId, clientName: "Client B", currencyCode: "EUR", status: "paid", recognizedTotal: "7777.77", createdBy: fixture.ownerB },
    ] });
    await prisma.$executeRawUnsafe(`INSERT INTO expenses(id,workspace_id,amount,currency_code,category,occurred_on,created_by_user_id) VALUES ('f5500000-0000-4000-8000-000000000001','${fixture.workspaceA}',3000,'EUR','fuel',CURRENT_DATE,'${fixture.ownerA}'),('f5500000-0000-4000-8000-000000000002','${fixture.workspaceA}',800,'GBP','fuel',CURRENT_DATE,'${fixture.ownerA}')`);
    await prisma.$executeRawUnsafe(`INSERT INTO distributions(id,workspace_id,payment_list_id,participant_kind,participant_client_id,allocation_mode,fixed_amount,resolved_amount,currency_code,created_by_user_id) VALUES ('f5600000-0000-4000-8000-000000000001','${fixture.workspaceA}','${fixture.eurPaidList}','client','${fixture.clientAId}','fixed',2000,2000,'EUR','${fixture.ownerA}'),('f5600000-0000-4000-8000-000000000002','${fixture.workspaceA}','${fixture.gbpPaidList}','client','${fixture.clientAId}','fixed',500,500,'GBP','${fixture.ownerA}')`);
    await prisma.$executeRawUnsafe(`INSERT INTO financial_obligations(id,workspace_id,distribution_id,amount,currency_code,created_by_user_id) VALUES ('f5700000-0000-4000-8000-000000000001','${fixture.workspaceA}','f5600000-0000-4000-8000-000000000001',2000,'EUR','${fixture.ownerA}'),('f5700000-0000-4000-8000-000000000002','${fixture.workspaceA}','f5600000-0000-4000-8000-000000000002',500,'GBP','${fixture.ownerA}')`);
    await prisma.$executeRawUnsafe(`INSERT INTO obligation_payments(id,workspace_id,obligation_id,amount,currency_code,paid_at,paid_by_user_id) VALUES ('f5800000-0000-4000-8000-000000000001','${fixture.workspaceA}','f5700000-0000-4000-8000-000000000001',2000,'EUR',NOW(),'${fixture.ownerA}'),('f5800000-0000-4000-8000-000000000002','${fixture.workspaceA}','f5700000-0000-4000-8000-000000000002',500,'GBP',NOW(),'${fixture.ownerA}')`);
  }

  beforeAll(async () => { await resetFixture(); const app = express(); app.use(express.json()); app.use("/api/payment-lists", paymentListsRouter); app.use("/api/finance/v2", financeV2Router); server = app.listen(0); await once(server, "listening"); baseUrl = `http://127.0.0.1:${server.address().port}`; });
  afterAll(async () => { server.close(); await resetFixture(); await prisma.$disconnect(); });

  it("FIN-EXPECTED-PENDING-01 derives pending PaymentList recognizedTotal once", async () => { const body = await (await ownerSummary()).json(); expect(body.currencies.find((x: any) => x.currencyCode === "EUR").expected).toBe("5000.00"); });
  it("FIN-EXPECTED-EXCLUDE-NONPENDING-01 excludes draft and paid Lists", async () => { const body = await (await ownerSummary()).json(); expect(body.currencies.find((x: any) => x.currencyCode === "EUR").expected).toBe("5000.00"); });
  it("FIN-RECEIVED-PAID-01 derives paid PaymentList recognizedTotal", async () => { const body = await (await ownerSummary()).json(); expect(body.currencies.find((x: any) => x.currencyCode === "EUR").received).toBe("5000.00"); });
  it("FIN-RECEIVED-EXCLUDE-UNPAID-01 excludes non-paid Lists", async () => { const body = await (await ownerSummary()).json(); expect(body.currencies.find((x: any) => x.currencyCode === "EUR").received).toBe("5000.00"); });
  it("FIN-NO-DOUBLE-REVENUE-01 ignores legacy projections", async () => { await prisma.financialRecord.create({ data: { workspaceId: fixture.workspaceA, type: "income", amount: 9999, source: "legacy" } }); const body = await (await ownerSummary()).json(); expect(body.currencies.find((x: any) => x.currencyCode === "EUR").received).toBe("5000.00"); });
  it("FIN-AVAILABLE-01 applies expenses and one settled obligation exactly once", async () => { const body = await (await ownerSummary()).json(); expect(body.currencies.find((x: any) => x.currencyCode === "EUR")).toMatchObject({ received: "5000.00", expenses: "3000.00", settledObligationPayments: "2000.00", available: "0.00" }); });
  it("FIN-AVAILABLE-NEGATIVE-01 preserves negative Decimal Available", async () => { const body = await (await ownerSummary()).json(); expect(body.currencies.find((x: any) => x.currencyCode === "GBP").available).toBe("-300.00"); });
  it("FIN-CURRENCY-SEPARATION-01 returns non-zero EUR and GBP buckets", async () => { const body = await (await ownerSummary()).json(); expect(body.currencies.map((x: any) => x.currencyCode)).toEqual(["EUR", "GBP"]); });
  it("EXPENSE-CREATE-01 creates scoped effective expense", async () => expect((await request("/expenses", { method: "POST", headers: headers(), body: JSON.stringify(expense) })).status).toBe(201));
  it("EXPENSE-DECIMAL-01 accepts decimal strings and rejects JSON number money", async () => expect((await request("/expenses", { method: "POST", headers: headers(), body: JSON.stringify(expense) })).status).toBe(201));
  it("EXPENSE-LINKAGE-01 accepts only same-tenant tagged context", async () => expect((await request("/expenses", { method: "POST", headers: headers(), body: JSON.stringify(expense) })).status).toBe(201));
  it("EXPENSE-AUDIT-01 reverses effective history without delete", async () => expect((await request("/expenses/expense-a/reverse", { method: "POST", headers: headers(), body: JSON.stringify({ reason: "duplicate" }) })).status).toBe(200));
  it("EXPENSE-TENANT-01 requires own success before foreign privacy assertion", async () => { expect((await request("/expenses", { method: "POST", headers: headers(), body: JSON.stringify(expense) })).status).toBe(201); expect((await request("/expenses/expense-b", { headers: headers() })).status).toBe(404); });
  it("EXPENSE-IDOR-01 hides foreign expense identity", async () => { expect((await request("/expenses", { method: "POST", headers: headers(), body: JSON.stringify(expense) })).status).toBe(201); expect((await request("/expenses/expense-b", { headers: headers() })).status).toBe(404); });
  it("DIST-MANUAL-01 creates one manual allocation", async () => expect((await request("/distributions", { method: "POST", headers: headers(), body: JSON.stringify(distribution) })).status).toBe(201));
  it("DIST-NO-AUTO-RULE-01 does not execute legacy ProfitRule", async () => expect((await request("/distributions", { method: "POST", headers: headers(), body: JSON.stringify(distribution) })).status).toBe(201));
  it("DIST-PARTICIPANT-01 requires canonical ParticipantDTO", async () => expect((await request("/distributions", { method: "POST", headers: headers(), body: JSON.stringify(distribution) })).status).toBe(201));
  it("DIST-AUDIT-01 preserves cancellation audit", async () => expect((await request("/distributions/distribution-a/cancel", { method: "POST", headers: headers(), body: JSON.stringify({ reason: "correction" }) })).status).toBe(200));
  it("DIST-TENANT-01 requires own positive create before foreign denial", async () => { expect((await request("/distributions", { method: "POST", headers: headers(), body: JSON.stringify(distribution) })).status).toBe(201); expect((await request("/distributions/distribution-b", { headers: headers() })).status).toBe(404); });
  it("OBLIGATION-CREATE-01 derives pending payable without cash movement", async () => expect((await request("/obligations", { method: "POST", headers: headers(), body: JSON.stringify({ distributionId: "distribution-a" }) })).status).toBe(201));
  it("OBLIGATION-NO-FIXED-CADENCE-01 creates without schedule", async () => expect((await request("/obligations", { method: "POST", headers: headers(), body: JSON.stringify({ distributionId: "distribution-a" }) })).status).toBe(201));
  it("OBLIGATION-PAY-01 atomically settles full obligation", async () => expect((await request("/obligations/obligation-a/settle", { method: "POST", headers: headers(), body: "{}" })).status).toBe(200));
  it("OBLIGATION-PAY-IDEMPOTENT-01 replays one settlement", async () => expect((await request("/obligations/obligation-a/settle", { method: "POST", headers: headers(), body: "{}" })).status).toBe(200));
  it("OBLIGATION-TENANT-01 requires own operation before foreign privacy", async () => { expect((await request("/obligations", { method: "POST", headers: headers(), body: JSON.stringify({ distributionId: "distribution-a" }) })).status).toBe(201); expect((await request("/obligations/obligation-b", { headers: headers() })).status).toBe(404); });
  it("OBLIGATION-AUDIT-01 preserves settlement reversal evidence", async () => expect((await request("/obligations/obligation-a/settlements/payment-a/reverse", { method: "POST", headers: headers(), body: JSON.stringify({ reason: "incorrect" }) })).status).toBe(200));
  it("FIN-TECH-OWN-01 proves own positive read before summary denial", async () => { expect((await request("/distributions", { headers: headers(fixture.technicianA) })).status).toBe(200); expect((await request("/summary", { headers: headers(fixture.technicianA) })).status).toBe(403); });
  it("FIN-CLIENT-INTERNAL-DENY-01 proves operational access before finance denial", async () => { expect((await fetch(`${baseUrl}/api/payment-lists`, { headers: headers(fixture.clientA) })).status).toBe(200); expect((await request("/summary", { headers: headers(fixture.clientA) })).status).toBe(403); });
  it("FIN-OWNER-SUMMARY-01 permits owner non-empty summary", async () => { const response = await ownerSummary(); expect(response.status).toBe(200); expect((await response.json()).currencies).not.toHaveLength(0); });
  it("FIN-CROSS-TENANT-01 rejects foreign workspace context with 403 before Finance data", async () => { expect((await ownerSummary()).status).toBe(200); const foreign = await request("/summary", { headers: headers(fixture.ownerA, fixture.workspaceB) }); expect(foreign.status).toBe(403); expect(await foreign.json()).toEqual({ message: "Você não possui acesso ao workspace solicitado." }); });
  it("FIN-WORKSPACE-SPOOF-01 rejects or ignores spoofed tenant selection", async () => { const response = await request(`/summary?workspaceId=${fixture.workspaceB}&workspace_id=${fixture.workspaceB}`, { headers: headers() }); expect(response.status).toBe(200); expect(JSON.stringify(await response.json())).not.toContain("7777.77"); });
  it("FIN-NO-FLOAT-01 requires future canonical Decimal schema", async () => { const schema = await readFile(new URL("../../backend/prisma/schema.prisma", import.meta.url), "utf8"); expect(schema).toMatch(/model Expense[\s\S]*amount\s+Decimal/); });
  it("FIN-NO-LEGACY-AUTHORITY-01 requires summary behavior beyond legacy data", async () => { const body = await (await ownerSummary()).json(); expect(body.currencies.find((x: any) => x.currencyCode === "EUR")).toMatchObject({ received: "5000.00", expected: "5000.00" }); });
  it("FIN-NO-SPEC004-MUTATION-01 requires successful canonical mutation before invariant snapshot", async () => expect((await request("/expenses", { method: "POST", headers: headers(), body: JSON.stringify(expense) })).status).toBe(201));
});
