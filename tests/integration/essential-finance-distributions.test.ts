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
const { paymentListsRouter } = await import("../../backend/src/routes/paymentLists.js");
const { signAccessToken } = await import("../../backend/src/lib/jwt.js");

const U = "c7100000-0000-4000-8000-000000000001", UA = "c7200000-0000-4000-8000-000000000001";
const B = "c7100000-0000-4000-8000-000000000002", BA = "c7200000-0000-4000-8000-000000000002";
const T = "c7100000-0000-4000-8000-000000000003", TA = "c7200000-0000-4000-8000-000000000003";
const C = "c7100000-0000-4000-8000-000000000004", CAU = "c7200000-0000-4000-8000-000000000004";
const P = "c7100000-0000-4000-8000-000000000005", PA = "c7200000-0000-4000-8000-000000000005";
const WA = "c7300000-0000-4000-8000-000000000001", WB = "c7300000-0000-4000-8000-000000000002", WP = "c7300000-0000-4000-8000-000000000003";
const CLIENT_A = "c7400000-0000-4000-8000-000000000001", CLIENT_B = "c7400000-0000-4000-8000-000000000002", CLIENT_P = "c7400000-0000-4000-8000-000000000003";
const LIST_A = "c7500000-0000-4000-8000-000000000001", LIST_A2 = "c7500000-0000-4000-8000-000000000002", LIST_B = "c7500000-0000-4000-8000-000000000003", LIST_P = "c7500000-0000-4000-8000-000000000004";
const ITEM_A = "c7600000-0000-4000-8000-000000000001", ITEM_A2 = "c7600000-0000-4000-8000-000000000002", ITEM_B = "c7600000-0000-4000-8000-000000000003";
const PERSON_T = "c7700000-0000-4000-8000-000000000001", PERSON_OTHER = "c7700000-0000-4000-8000-000000000002", PERSON_B = "c7700000-0000-4000-8000-000000000003";
const RULE = "c7800000-0000-4000-8000-000000000001";

async function clean() {
  const ws = [WA, WB, WP];
  for (const table of ["finance_idempotency", "obligation_payments", "financial_obligations", "distributions", "expenses"]) await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE workspace_id IN ('${ws.join("','")}')`);
  await prisma.profitRule.deleteMany({ where: { id: RULE } });
  await prisma.financialRecord.deleteMany({ where: { workspaceId: { in: ws } } });
  await prisma.person.deleteMany({ where: { id: { in: [PERSON_T, PERSON_OTHER, PERSON_B] } } });
  await prisma.paymentList.deleteMany({ where: { id: { in: [LIST_A, LIST_A2, LIST_B, LIST_P] } } });
  await prisma.client.deleteMany({ where: { id: { in: [CLIENT_A, CLIENT_B, CLIENT_P] } } });
  await prisma.workspace.deleteMany({ where: { id: { in: ws } } });
  await prisma.user.deleteMany({ where: { id: { in: [U, B, T, C, P] } } });
}

describe("Spec 005 — T07 canonical manual distributions", () => {
  let server: any, base = "";
  const token = (id: string) => signAccessToken({ id, email: `${id}@t`, role: "admin" });
  const request = (path: string, init: RequestInit = {}, actor = U, workspace = WA) => fetch(base + path, { ...init, headers: { Authorization: `Bearer ${token(actor)}`, "X-Workspace-Id": workspace, "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const create = (body: unknown, key: string, actor = U, workspace = WA) => request("/distributions", { method: "POST", body: JSON.stringify(body), headers: { "Idempotency-Key": key } }, actor, workspace);
  const fixed = (amount = "100.00", participant: unknown = { kind: "person", personId: PERSON_T }, paymentListId = LIST_A, paymentListItemId?: string) => ({ paymentListId, ...(paymentListItemId ? { paymentListItemId } : {}), participant, allocation: { mode: "fixed", amount } });
  const percentage = (value = "12.50", paymentListId = LIST_A, paymentListItemId?: string) => ({ paymentListId, ...(paymentListItemId ? { paymentListItemId } : {}), participant: { kind: "person", personId: PERSON_T }, allocation: { mode: "percentage", percentage: value } });

  beforeAll(async () => {
    await clean();
    for (const [id, appId, email, role] of [[U, UA, "owner@t", "admin"], [B, BA, "owner-b@t", "admin"], [T, TA, "tech@t", "technician"], [C, CAU, "client@t", "user"], [P, PA, "personal@t", "technician"]] as const) await prisma.user.create({ data: { id, email, fullName: email, role, passwordHash: "x", appUser: { create: { id: appId, email } } } });
    await prisma.workspace.create({ data: { id: WA, name: "A", ownerUserId: UA, memberships: { create: [{ userId: TA, role: "technician", status: "active" }, { userId: CAU, role: "client", status: "active" }] } } });
    await prisma.workspace.create({ data: { id: WB, name: "B", ownerUserId: BA } });
    await prisma.workspace.create({ data: { id: WP, name: "Personal", type: "personal", ownerUserId: PA } });
    await prisma.client.createMany({ data: [{ id: CLIENT_A, workspaceId: WA, name: "A" }, { id: CLIENT_B, workspaceId: WB, name: "B" }, { id: CLIENT_P, workspaceId: WP, name: "P" }] });
    await prisma.paymentList.createMany({ data: [
      { id: LIST_A, workspaceId: WA, clientId: CLIENT_A, clientName: "A", listNumber: "t07-a", currencyCode: "EUR", status: "paid", recognizedTotal: "1000.00", createdBy: U },
      { id: LIST_A2, workspaceId: WA, clientId: CLIENT_A, clientName: "A", listNumber: "t07-a2", currencyCode: "EUR", status: "paid", recognizedTotal: "333.33", createdBy: U },
      { id: LIST_B, workspaceId: WB, clientId: CLIENT_B, clientName: "B", listNumber: "t07-b", currencyCode: "EUR", status: "paid", recognizedTotal: "7777.77", createdBy: B },
      { id: LIST_P, workspaceId: WP, clientId: CLIENT_P, clientName: "P", listNumber: "t07-p", currencyCode: "EUR", status: "paid", recognizedTotal: "100.00", createdBy: P },
    ] });
    await prisma.paymentListItem.createMany({ data: [
      { id: ITEM_A, workspaceId: WA, paymentListId: LIST_A, servicesSnapshot: [], totalAmount: "333.33" },
      { id: ITEM_A2, workspaceId: WA, paymentListId: LIST_A2, servicesSnapshot: [], totalAmount: "25.00" },
      { id: ITEM_B, workspaceId: WB, paymentListId: LIST_B, servicesSnapshot: [], totalAmount: "25.00" },
    ] });
    await prisma.person.createMany({ data: [
      { id: PERSON_T, workspaceId: WA, type: "technician", fullName: "Tech", systemAccessUserId: T },
      { id: PERSON_OTHER, workspaceId: WA, type: "partner", fullName: "Partner" },
      { id: PERSON_B, workspaceId: WB, type: "technician", fullName: "Foreign" },
    ] });
    await prisma.profitRule.create({ data: { id: RULE, ruleName: "legacy collision", isActive: true, items: { create: [{ participantName: "legacy", percentage: 99 }] } } });
    const app = express(); app.use(express.json()); app.use("/api/payment-lists", paymentListsRouter); app.use("/api/finance/v2", financeV2Router); server = app.listen(0); await once(server, "listening"); base = `http://127.0.0.1:${server.address().port}/api/finance/v2`;
  });
  afterAll(async () => { server.close(); await clean(); await prisma.$disconnect(); });

  it("creates fixed exact entitlement, derives audit/currency, and replays only the same request", async () => {
    const first = await create(fixed(), "fixed-replay"); expect(first.status).toBe(201); const body = await first.json();
    expect(body).toMatchObject({ paymentListId: LIST_A, paymentListItemId: null, participant: { kind: "person", personId: PERSON_T }, allocation: { mode: "fixed", amount: "100.00" }, resolvedAmount: "100.00", currencyCode: "EUR", status: "active", createdByUserId: U, idempotent: false });
    const replay = await create(fixed(), "fixed-replay"); expect(replay.status).toBe(200); expect((await replay.json())).toMatchObject({ id: body.id, idempotent: true });
    const changed = await create(fixed("101.00"), "fixed-replay"); expect(changed.status).toBe(409); expect((await changed.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(await prisma.distribution.count({ where: { id: body.id } })).toBe(1);
  });

  it("resolves list and item percentages with Decimal half-up rounding", async () => {
    const list = await create(percentage("12.50"), "percentage-list"); expect(list.status).toBe(201); expect((await list.json())).toMatchObject({ allocation: { mode: "percentage", percentage: "12.50" }, resolvedAmount: "125.00" });
    const item = await create(percentage("33.33", LIST_A, ITEM_A), "percentage-item"); expect(item.status).toBe(201); expect((await item.json())).toMatchObject({ paymentListItemId: ITEM_A, resolvedAmount: "111.10" });
  });

  it("rejects invalid allocation union, unsafe money, and client authority fields", async () => {
    const invalid = [
      { ...fixed(), allocation: { mode: "fixed", amount: "1.00", percentage: "1.00" } }, { ...percentage(), allocation: { mode: "percentage", percentage: "0" } },
      { ...percentage("100.01") }, { ...fixed("0") }, { ...fixed(), allocation: { mode: "fixed", amount: 10 } }, { ...fixed(), workspaceId: WB }, { ...fixed(), resolvedAmount: "999.99" }, { ...fixed(), currencyCode: "USD" }, { ...fixed(), status: "cancelled" },
    ];
    for (const body of invalid) { const response = await create(body, `invalid-${JSON.stringify(body).length}-${Math.random()}`); expect(response.status).toBe(422); }
  });

  it("enforces lineage and every canonical participant without ProfitRule authority", async () => {
    const before = await prisma.distribution.count({ where: { workspaceId: WA } }); const legacyBefore = await prisma.serviceOrderDistribution.count();
    for (const [index, participant] of [{ kind: "person", personId: PERSON_OTHER }, { kind: "workspace", workspaceId: WA }, { kind: "client", clientId: CLIENT_A }].entries()) expect((await create(fixed("10.00", participant), `participant-${index}`)).status).toBe(201);
    expect(await prisma.distribution.count({ where: { workspaceId: WA } })).toBe(before + 3); expect(await prisma.serviceOrderDistribution.count()).toBe(legacyBefore);
    for (const body of [fixed("10.00", { kind: "person", personId: PERSON_B }), fixed("10.00", { kind: "workspace", workspaceId: WB }), fixed("10.00", { kind: "client", clientId: CLIENT_B }), fixed("10.00", { kind: "person", personId: PERSON_T }, LIST_B), fixed("10.00", { kind: "person", personId: PERSON_T }, LIST_A, ITEM_B)]) expect((await create(body, `foreign-${JSON.stringify(body).length}-${Math.random()}`)).status).toBe(404);
    expect((await create(fixed("10.00", { kind: "person", personId: PERSON_T }, LIST_A, ITEM_A2), "same-tenant-mismatch")).status).toBe(422);
  });

  it("keeps owner ledger scoped, technician reads only own participant, and denies client", async () => {
    const own = await create(fixed("12.00", { kind: "person", personId: PERSON_T }), "tech-own"); const ownId = (await own.json()).id;
    const other = await create(fixed("13.00", { kind: "person", personId: PERSON_OTHER }), "tech-other"); const otherId = (await other.json()).id;
    const foreign = await create(fixed("14.00", { kind: "person", personId: PERSON_B }, LIST_B), "foreign-read", B, WB); const foreignId = (await foreign.json()).id;
    const list = await request("/distributions", {}, T); expect(list.status).toBe(200); const items = (await list.json()).items; expect(items.map((item: any) => item.participant)).toEqual(expect.arrayContaining([{ kind: "person", personId: PERSON_T }])); expect(items.every((item: any) => item.participant.kind === "person" && item.participant.personId === PERSON_T)).toBe(true); expect(items.map((item: any) => item.id)).toContain(ownId);
    expect((await request(`/distributions/${ownId}`, {}, T)).status).toBe(200); expect((await request(`/distributions/${otherId}`, {}, T)).status).toBe(404); expect((await request(`/distributions/${foreignId}`)).status).toBe(404);
    expect((await request("/distributions", {}, C)).status).toBe(403); expect((await fetch(`${base}/distributions`)).status).toBe(401);
  });

  it("permits personal owner authority and preserves zero-cash / no-downstream side effects", async () => {
    const summaryBefore = await (await request("/summary")).json(); const counts = await Promise.all([prisma.financialObligation.count({ where: { workspaceId: WA } }), prisma.obligationPayment.count({ where: { workspaceId: WA } }), prisma.expense.count({ where: { workspaceId: WA } }), prisma.financialRecord.count({ where: { workspaceId: WA } }), prisma.paymentOrder.count(), prisma.serviceOrderDistribution.count()]);
    const listBefore = await prisma.paymentList.findUniqueOrThrow({ where: { id: LIST_A }, select: { status: true, recognizedTotal: true, sourceDocumentTotal: true, itemCount: true } });
    const made = await create(fixed("15.00"), "cash-none"); const id = (await made.json()).id;
    expect(await (await request("/summary")).json()).toEqual(summaryBefore); expect(await Promise.all([prisma.financialObligation.count({ where: { workspaceId: WA } }), prisma.obligationPayment.count({ where: { workspaceId: WA } }), prisma.expense.count({ where: { workspaceId: WA } }), prisma.financialRecord.count({ where: { workspaceId: WA } }), prisma.paymentOrder.count(), prisma.serviceOrderDistribution.count()])).toEqual(counts);
    expect(await prisma.paymentList.findUniqueOrThrow({ where: { id: LIST_A }, select: { status: true, recognizedTotal: true, sourceDocumentTotal: true, itemCount: true } })).toEqual(listBefore);
    const personal = await create({ paymentListId: LIST_P, participant: { kind: "workspace", workspaceId: WP }, allocation: { mode: "fixed", amount: "10.00" } }, "personal", P, WP); expect(personal.status).toBe(201); expect((await request(`/distributions/${(await personal.json()).id}`, {}, P, WP)).status).toBe(200);
    expect(id).toBeTruthy();
  });

  it("cancels one immutable row idempotently, guards paid downstream, and converges a race", async () => {
    const made = await create(fixed("20.00"), "cancel-create"); const original = await made.json();
    const before = await (await request("/summary")).json(); const cancelled = await request(`/distributions/${original.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: "correction" }), headers: { "Idempotency-Key": "cancel-key" } }); expect(cancelled.status).toBe(200); expect(await cancelled.json()).toMatchObject({ id: original.id, status: "cancelled", cancellationReason: "correction", cancelledByUserId: U, idempotent: false, resolvedAmount: "20.00" }); expect(await (await request("/summary")).json()).toEqual(before);
    const replay = await request(`/distributions/${original.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: "correction" }), headers: { "Idempotency-Key": "cancel-key" } }); expect(replay.status).toBe(200); expect((await replay.json()).idempotent).toBe(true);
    expect((await request(`/distributions/${original.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: "other" }), headers: { "Idempotency-Key": "cancel-key" } })).status).toBe(409); expect((await request(`/distributions/${original.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: "other" }), headers: { "Idempotency-Key": "second-key" } })).status).toBe(409);
    const raced = await create(fixed("21.00"), "race-create"); const raceId = (await raced.json()).id; const [a, b] = await Promise.all([request(`/distributions/${raceId}/cancel`, { method: "POST", body: JSON.stringify({ reason: "race" }), headers: { "Idempotency-Key": "race-cancel" } }), request(`/distributions/${raceId}/cancel`, { method: "POST", body: JSON.stringify({ reason: "race" }), headers: { "Idempotency-Key": "race-cancel" } })]); expect([a.status, b.status].sort()).toEqual([200, 200]); expect(await prisma.distribution.count({ where: { id: raceId, status: "cancelled" } })).toBe(1);
    const guarded = await create(fixed("22.00"), "guarded-create"); const guardedId = (await guarded.json()).id; await prisma.financialObligation.create({ data: { workspaceId: WA, distributionId: guardedId, amount: "22.00", currencyCode: "EUR", status: "paid", createdByUserId: U, paidAt: new Date(), paidByUserId: U } }); const blocked = await request(`/distributions/${guardedId}/cancel`, { method: "POST", body: JSON.stringify({ reason: "late" }), headers: { "Idempotency-Key": "guarded-cancel" } }); expect(blocked.status).toBe(409); expect((await blocked.json()).error.code).toBe("DISTRIBUTION_NOT_CANCELLABLE");
  });
});
