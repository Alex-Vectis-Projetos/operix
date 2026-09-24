// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { once } from "node:events";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://operix_local:operix_local@127.0.0.1:55432/operix_local?schema=public";
process.env.JWT_SECRET ??= "this-is-a-test-secret-with-more-than-32-chars-long";
process.env.MINIO_ROOT_PASSWORD ??= "operix-test-minio-password";

const { prisma } = await import("../../backend/src/lib/prisma.js");
const express = (await import("../../backend/node_modules/express/index.js")).default;
const { financeV2Router } = await import("../../backend/src/routes/financeV2.js");
const { signAccessToken } = await import("../../backend/src/lib/jwt.js");

const U = "d6100000-0000-4000-8000-000000000001", A = "d6200000-0000-4000-8000-000000000001";
const B = "d6100000-0000-4000-8000-000000000002", BA = "d6200000-0000-4000-8000-000000000002";
const T = "d6100000-0000-4000-8000-000000000003", TA = "d6200000-0000-4000-8000-000000000003";
const C = "d6100000-0000-4000-8000-000000000004", CAU = "d6200000-0000-4000-8000-000000000004";
const P = "d6100000-0000-4000-8000-000000000005", PA = "d6200000-0000-4000-8000-000000000005";
const WA = "d6300000-0000-4000-8000-000000000001", WB = "d6300000-0000-4000-8000-000000000002", WP = "d6300000-0000-4000-8000-000000000003";
const CLIENT_A = "d6400000-0000-4000-8000-000000000001", CLIENT_B = "d6400000-0000-4000-8000-000000000002";
const LIST_A = "d6500000-0000-4000-8000-000000000001", LIST_B = "d6500000-0000-4000-8000-000000000002";
const ORDER_A = "d6600000-0000-4000-8000-000000000001", ORDER_B = "d6600000-0000-4000-8000-000000000002";
const PERSON_A = "d6700000-0000-4000-8000-000000000001", PERSON_B = "d6700000-0000-4000-8000-000000000002";
const DOC_A = "d6800000-0000-4000-8000-000000000001", DOC_B = "d6800000-0000-4000-8000-000000000002";

async function clean() {
  const ws = [WA, WB, WP];
  for (const table of ["finance_idempotency", "obligation_payments", "financial_obligations", "distributions", "expenses"]) await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE workspace_id IN ('${ws.join("','")}')`);
  await prisma.financialRecord.deleteMany({ where: { workspaceId: { in: ws } } });
  await prisma.document.deleteMany({ where: { id: { in: [DOC_A, DOC_B] } } });
  await prisma.person.deleteMany({ where: { id: { in: [PERSON_A, PERSON_B] } } });
  await prisma.productionOrder.deleteMany({ where: { id: { in: [ORDER_A, ORDER_B] } } });
  await prisma.paymentList.deleteMany({ where: { id: { in: [LIST_A, LIST_B] } } });
  await prisma.client.deleteMany({ where: { id: { in: [CLIENT_A, CLIENT_B] } } });
  await prisma.workspace.deleteMany({ where: { id: { in: ws } } });
  await prisma.user.deleteMany({ where: { id: { in: [U, B, T, C, P] } } });
}

describe("Spec 005 — T06 canonical expense lifecycle", () => {
  let server: any, base = "";
  const token = (id: string) => signAccessToken({ id, email: `${id}@t`, role: "admin" });
  const request = (path: string, init: RequestInit = {}, actor = U, workspace = WA) => fetch(base + path, { ...init, headers: { Authorization: `Bearer ${token(actor)}`, "X-Workspace-Id": workspace, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const create = (body: unknown, key: string, actor = U, workspace = WA) => request("/expenses", { method: "POST", body: JSON.stringify(body), headers: { "Idempotency-Key": key } }, actor, workspace);
  const expense = (amount = "123.45", context?: unknown) => ({ amount, currencyCode: "EUR", category: "fuel", occurredOn: "2026-09-23", description: "canonical expense", ...(context ? { context } : {}) });

  beforeAll(async () => {
    await clean();
    for (const [id, appId, email, role] of [[U, A, "owner-a@t", "admin"], [B, BA, "owner-b@t", "admin"], [T, TA, "tech@t", "technician"], [C, CAU, "client@t", "user"], [P, PA, "personal@t", "technician"]] as const) await prisma.user.create({ data: { id, email, fullName: email, role, passwordHash: "x", appUser: { create: { id: appId, email } } } });
    await prisma.workspace.create({ data: { id: WA, name: "A", ownerUserId: A, memberships: { create: [{ userId: TA, role: "technician", status: "active" }, { userId: CAU, role: "client", status: "active" }] } } });
    await prisma.workspace.create({ data: { id: WB, name: "B", ownerUserId: BA } });
    await prisma.workspace.create({ data: { id: WP, name: "Personal", type: "personal", ownerUserId: PA } });
    await prisma.client.createMany({ data: [{ id: CLIENT_A, workspaceId: WA, name: "A" }, { id: CLIENT_B, workspaceId: WB, name: "B" }] });
    await prisma.paymentList.createMany({ data: [{ id: LIST_A, workspaceId: WA, clientId: CLIENT_A, clientName: "A", listNumber: "t06-a", currencyCode: "EUR", status: "paid", recognizedTotal: "5000.00", createdBy: U }, { id: LIST_B, workspaceId: WB, clientId: CLIENT_B, clientName: "B", listNumber: "t06-b", currencyCode: "EUR", status: "paid", recognizedTotal: "7777.77", createdBy: B }] });
    await prisma.productionOrder.createMany({ data: [{ id: ORDER_A, workspaceId: WA, code: "T06-A", createdBy: U }, { id: ORDER_B, workspaceId: WB, code: "T06-B", createdBy: B }] });
    await prisma.person.createMany({ data: [{ id: PERSON_A, workspaceId: WA, type: "technician", fullName: "Tech A" }, { id: PERSON_B, workspaceId: WB, type: "technician", fullName: "Tech B" }] });
    await prisma.document.createMany({ data: [{ id: DOC_A, workspaceId: WA, name: "A", entityType: "finance" }, { id: DOC_B, workspaceId: WB, name: "B", entityType: "finance" }] });
    const app = express(); app.use(express.json()); app.use("/api/finance/v2", financeV2Router); server = app.listen(0); await once(server, "listening"); base = `http://127.0.0.1:${server.address().port}/api/finance/v2`;
  });
  afterAll(async () => { server.close(); await clean(); await prisma.$disconnect(); });

  it("creates exact Decimal expenses, derives authority, and replays a matching create", async () => {
    const first = await create(expense("0.10"), "create-replay"); expect(first.status).toBe(201); const body = await first.json(); expect(body).toMatchObject({ amount: "0.10", currencyCode: "EUR", occurredOn: "2026-09-23", status: "effective", createdByUserId: U, idempotent: false, context: null });
    const replay = await create(expense("0.10"), "create-replay"); expect(replay.status).toBe(200); expect((await replay.json())).toMatchObject({ id: body.id, idempotent: true });
    expect(await prisma.expense.count({ where: { workspaceId: WA, amount: "0.10" } })).toBe(1);
    const mismatch = await create(expense("0.20"), "create-replay"); expect(mismatch.status).toBe(409); expect((await mismatch.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("rejects unsafe money, malformed dates, currency, and client authority fields", async () => {
    for (const body of [{ ...expense(), amount: 10 }, { ...expense(), amount: "1e2" }, { ...expense(), amount: "1,00" }, { ...expense(), amount: "10.001" }, { ...expense(), currencyCode: "eur" }, { ...expense(), occurredOn: "2026-02-30" }, { ...expense(), workspaceId: WB }, { ...expense(), status: "reversed", createdByUserId: B }]) { const response = await create(body, `invalid-${JSON.stringify(body).length}-${Math.random()}`); expect(response.status).toBe(422); expect((await response.json()).error.code).toBeDefined(); }
  });

  it("accepts every canonical context exactly once and rejects foreign context without a write", async () => {
    const contexts = [{ kind: "payment_list", id: LIST_A }, { kind: "production_order", id: ORDER_A }, { kind: "technician_person", id: PERSON_A }, { kind: "client", id: CLIENT_A }, { kind: "document", id: DOC_A }];
    for (const [index, context] of contexts.entries()) { const response = await create(expense("10.00", context), `context-${index}`); expect(response.status).toBe(201); expect((await response.json()).context).toEqual(context); }
    const foreign = await create(expense("10.00", { kind: "payment_list", id: LIST_B }), "foreign-context"); expect(foreign.status).toBe(404); expect((await foreign.json()).error.code).toBe("EXPENSE_CONTEXT_NOT_FOUND");
    expect(await prisma.expense.count({ where: { workspaceId: WA } })).toBe(6);
  });

  it("lists and reads only active-workspace expenses and hides foreign IDs", async () => {
    const foreign = await create(expense("77.77"), "b-expense", B, WB); const foreignBody = await foreign.json();
    const listed = await request("/expenses"); expect(listed.status).toBe(200); const items = (await listed.json()).items; expect(items.length).toBeGreaterThan(0); expect(JSON.stringify(items)).not.toContain("77.77");
    const own = items[0]; expect((await request(`/expenses/${own.id}`)).status).toBe(200); const hidden = await request(`/expenses/${foreignBody.id}`); expect(hidden.status).toBe(404); expect((await hidden.json()).error.code).toBe("EXPENSE_NOT_FOUND"); expect((await request("/expenses/00000000-0000-4000-8000-000000000000")).status).toBe(404);
  });

  it("enforces owner, personal owner, technician, client, and unauthenticated authorization", async () => {
    expect((await create(expense("1.00"), "personal-create", P, WP)).status).toBe(201);
    expect((await request("/expenses", {}, T)).status).toBe(403); expect((await create(expense("1.00"), "tech-create", T)).status).toBe(403);
    expect((await request("/expenses", {}, C)).status).toBe(403); expect((await create(expense("1.00"), "client-create", C)).status).toBe(403);
    expect((await fetch(`${base}/expenses`)).status).toBe(401);
  });

  it("reverses the original row once, restores the real summary, and preserves audit fields", async () => {
    const made = await create(expense("3000.00", { kind: "payment_list", id: LIST_A }), "reverse-create"); const original = await made.json();
    const before = await request("/summary"); expect((await before.json()).currencies.find((x: any) => x.currencyCode === "EUR")).toMatchObject({ expenses: "3050.10", available: "1949.90" });
    const reversed = await request(`/expenses/${original.id}/reverse`, { method: "POST", body: JSON.stringify({ reason: "duplicate" }), headers: { "Idempotency-Key": "reverse-key" } }); expect(reversed.status).toBe(200); expect(await reversed.json()).toMatchObject({ id: original.id, status: "reversed", reversalReason: "duplicate", reversedByUserId: U, idempotent: false });
    const after = await request("/summary"); expect((await after.json()).currencies.find((x: any) => x.currencyCode === "EUR")).toMatchObject({ expenses: "50.10", available: "4949.90" });
    const replay = await request(`/expenses/${original.id}/reverse`, { method: "POST", body: JSON.stringify({ reason: "duplicate" }), headers: { "Idempotency-Key": "reverse-key" } }); expect(replay.status).toBe(200); expect((await replay.json()).idempotent).toBe(true);
    const changed = await request(`/expenses/${original.id}/reverse`, { method: "POST", body: JSON.stringify({ reason: "other" }), headers: { "Idempotency-Key": "reverse-key" } }); expect(changed.status).toBe(409); const second = await request(`/expenses/${original.id}/reverse`, { method: "POST", body: JSON.stringify({ reason: "other" }), headers: { "Idempotency-Key": "second-key" } }); expect(second.status).toBe(409);
  });

  it("converges concurrent create and reversal retries without legacy or Spec004 side effects", async () => {
    const financialBefore = await prisma.financialRecord.count({ where: { workspaceId: WA } }); const listBefore = await prisma.paymentList.findUniqueOrThrow({ where: { id: LIST_A }, select: { status: true, recognizedTotal: true } });
    const payload = expense("12.34"); const [a, b] = await Promise.all([create(payload, "concurrent-create"), create(payload, "concurrent-create")]); expect([a.status, b.status].sort()).toEqual([200, 201]); const ids = await Promise.all([a.json(), b.json()]); expect(ids[0].id).toBe(ids[1].id);
    const [r1, r2] = await Promise.all([request(`/expenses/${ids[0].id}/reverse`, { method: "POST", body: JSON.stringify({ reason: "race" }), headers: { "Idempotency-Key": "concurrent-reverse" } }), request(`/expenses/${ids[0].id}/reverse`, { method: "POST", body: JSON.stringify({ reason: "race" }), headers: { "Idempotency-Key": "concurrent-reverse" } })]); expect([r1.status, r2.status].sort()).toEqual([200, 200]); expect(await prisma.expense.count({ where: { id: ids[0].id, status: "reversed" } })).toBe(1);
    expect(await prisma.financialRecord.count({ where: { workspaceId: WA } })).toBe(financialBefore); expect(await prisma.paymentList.findUniqueOrThrow({ where: { id: LIST_A }, select: { status: true, recognizedTotal: true } })).toEqual(listBefore);
  });
});
