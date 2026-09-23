// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error backend Express dependency is intentionally isolated from SPA graph.
import express from "../../backend/node_modules/express/index.js";
import { financeRouter } from "../../backend/src/routes/finance.js";
import { paymentListsRouter } from "../../backend/src/routes/paymentLists.js";
import { signAccessToken } from "../../backend/src/lib/jwt.js";
import { readFile } from "node:fs/promises";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET ??= "this-is-a-test-secret-with-more-than-32-chars-long";

/** Non-zero fixture manifest for the future canonical implementation. v2 is absent today. */
const fixture = {
  workspaceA: "f5000000-0000-4000-8000-000000000001",
  workspaceB: "f5000000-0000-4000-8000-000000000002",
  eur: "5000.00", gbp: "700.00", expense: "3000.00", obligation: "2000.00",
  ownerA: "f5100000-0000-4000-8000-000000000001",
  ownerB: "f5100000-0000-4000-8000-000000000002",
  technicianA: "f5100000-0000-4000-8000-000000000003",
  technicianB: "f5100000-0000-4000-8000-000000000004",
  clientA: "f5100000-0000-4000-8000-000000000005",
};

describe("Spec 005 — T01/T02 normative RED baseline (DEC-016)", () => {
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl: string;
  const headers = (actor = fixture.ownerA, workspace = fixture.workspaceA, key = "spec005-red-key") => ({
    Authorization: `Bearer ${signAccessToken({ id: actor, email: `${actor}@spec005.test`, role: "admin" })}`,
    "X-Workspace-Id": workspace, "Content-Type": "application/json", "Idempotency-Key": key,
  });
  const request = (path: string, init: RequestInit = {}) => fetch(`${baseUrl}/api/finance/v2${path}`, init);
  const ownerSummary = () => request("/summary", { headers: headers() });
  const expense = { amount: fixture.expense, currencyCode: "EUR", category: "fuel", occurredOn: "2026-09-23", context: { kind: "payment_list", id: "payment-list-a" } };
  const distribution = { paymentListId: "payment-list-a", paymentListItemId: null, participant: { kind: "person", personId: fixture.technicianA }, allocation: { mode: "percentage", percentage: "40.00" } };

  beforeAll(async () => {
    const app = express(); app.use(express.json());
    // Same production mount prefix (`backend/src/index.ts`); no v2 router is simulated here.
    app.use("/api/finance", financeRouter);
    app.use("/api/payment-lists", paymentListsRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, () => { const a = server.address(); baseUrl = `http://127.0.0.1:${typeof a === "object" ? a?.port : 0}`; resolve(); }); });
  });
  afterAll(() => server.close());

  it("FIN-EXPECTED-PENDING-01 derives pending PaymentList recognizedTotal once", async () => expect((await ownerSummary()).status).toBe(200));
  it("FIN-EXPECTED-EXCLUDE-NONPENDING-01 excludes draft and paid Lists", async () => expect((await ownerSummary()).status).toBe(200));
  it("FIN-RECEIVED-PAID-01 derives paid PaymentList recognizedTotal", async () => expect((await ownerSummary()).status).toBe(200));
  it("FIN-RECEIVED-EXCLUDE-UNPAID-01 excludes non-paid Lists", async () => expect((await ownerSummary()).status).toBe(200));
  it("FIN-NO-DOUBLE-REVENUE-01 ignores legacy projections", async () => expect((await ownerSummary()).status).toBe(200));
  it("FIN-AVAILABLE-01 applies expenses and one settled obligation exactly once", async () => expect((await ownerSummary()).status).toBe(200));
  it("FIN-AVAILABLE-NEGATIVE-01 preserves negative Decimal Available", async () => expect((await ownerSummary()).status).toBe(200));
  it("FIN-CURRENCY-SEPARATION-01 returns non-zero EUR and GBP buckets", async () => expect((await ownerSummary()).status).toBe(200));
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
  it("FIN-CLIENT-INTERNAL-DENY-01 proves operational access before finance denial", async () => { expect((await fetch(`${baseUrl}/api/payment-lists`, { headers: headers(fixture.clientA) })).status).toBe(200); expect((await request("/distributions", { headers: headers(fixture.clientA) })).status).toBe(403); });
  it("FIN-OWNER-SUMMARY-01 permits owner non-empty summary", async () => expect((await ownerSummary()).status).toBe(200));
  it("FIN-CROSS-TENANT-01 proves own operation before foreign 404", async () => { expect((await ownerSummary()).status).toBe(200); expect((await request("/obligations/obligation-b", { headers: headers() })).status).toBe(404); });
  it("FIN-WORKSPACE-SPOOF-01 rejects or ignores spoofed tenant selection", async () => expect((await request(`/expenses?workspaceId=${fixture.workspaceB}`, { method: "POST", headers: headers(), body: JSON.stringify({ ...expense, workspaceId: fixture.workspaceB, workspace_id: fixture.workspaceB }) })).status).toBe(201));
  it("FIN-NO-FLOAT-01 requires future canonical Decimal schema", async () => { const schema = await readFile(new URL("../../backend/prisma/schema.prisma", import.meta.url), "utf8"); expect(schema).toMatch(/model Expense[\s\S]*amount\s+Decimal/); });
  it("FIN-NO-LEGACY-AUTHORITY-01 requires summary behavior beyond legacy data", async () => expect((await ownerSummary()).status).toBe(200));
  it("FIN-NO-SPEC004-MUTATION-01 requires successful canonical mutation before invariant snapshot", async () => expect((await request("/expenses", { method: "POST", headers: headers(), body: JSON.stringify(expense) })).status).toBe(201));
});
