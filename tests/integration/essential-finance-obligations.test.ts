// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

const U = "b8100000-0000-4000-8000-000000000001", UA = "b8200000-0000-4000-8000-000000000001";
const B = "b8100000-0000-4000-8000-000000000002", BA = "b8200000-0000-4000-8000-000000000002";
const T = "b8100000-0000-4000-8000-000000000003", TA = "b8200000-0000-4000-8000-000000000003";
const C = "b8100000-0000-4000-8000-000000000004", CAU = "b8200000-0000-4000-8000-000000000004";
const P = "b8100000-0000-4000-8000-000000000005", PA = "b8200000-0000-4000-8000-000000000005";
const WA = "b8300000-0000-4000-8000-000000000001", WB = "b8300000-0000-4000-8000-000000000002", WP = "b8300000-0000-4000-8000-000000000003";
const CA = "b8400000-0000-4000-8000-000000000001", CB = "b8400000-0000-4000-8000-000000000002", CP = "b8400000-0000-4000-8000-000000000003";
const LA = "b8500000-0000-4000-8000-000000000001", LB = "b8500000-0000-4000-8000-000000000002", LP = "b8500000-0000-4000-8000-000000000003";
const IA = "b8700000-0000-4000-8000-000000000001";
const PT = "b8600000-0000-4000-8000-000000000001", PO = "b8600000-0000-4000-8000-000000000002", PN = "b8600000-0000-4000-8000-000000000003", PB = "b8600000-0000-4000-8000-000000000004";

async function cleanFinance() {
  const workspaces = [WA, WB, WP];
  for (const table of ["finance_idempotency", "obligation_payments", "financial_obligations", "distributions", "expenses"]) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE workspace_id IN ('${workspaces.join("','")}')`);
  }
}

async function clean() {
  await cleanFinance();
  await prisma.person.deleteMany({ where: { id: { in: [PT, PO, PN, PB] } } });
  await prisma.paymentList.deleteMany({ where: { id: { in: [LA, LB, LP] } } });
  await prisma.client.deleteMany({ where: { id: { in: [CA, CB, CP] } } });
  await prisma.workspace.deleteMany({ where: { id: { in: [WA, WB, WP] } } });
  await prisma.user.deleteMany({ where: { id: { in: [U, B, T, C, P] } } });
}

describe("Spec 005 — T08 canonical obligation settlement", () => {
  let server: any, base = "";
  const token = (id: string) => signAccessToken({ id, email: `${id}@t`, role: "admin" });
  const request = (path: string, init: RequestInit = {}, actor = U, workspace = WA) => fetch(base + path, {
    ...init,
    headers: { Authorization: `Bearer ${token(actor)}`, "X-Workspace-Id": workspace, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const key = (idempotencyKey: string) => ({ "Idempotency-Key": idempotencyKey });
  const createDistribution = async (participant: unknown = { kind: "person", personId: PT }, amount = "2000.00", idempotencyKey = `distribution-${crypto.randomUUID()}`, actor = U, workspace = WA, list = LA) => {
    const response = await request("/distributions", { method: "POST", body: JSON.stringify({ paymentListId: list, participant, allocation: { mode: "fixed", amount } }), headers: key(idempotencyKey) }, actor, workspace);
    expect(response.status).toBe(201);
    return response.json();
  };
  const createObligation = (distributionId: string, idempotencyKey: string, actor = U, workspace = WA) => request("/obligations", { method: "POST", body: JSON.stringify({ distributionId }), headers: key(idempotencyKey) }, actor, workspace);
  const settle = (id: string, idempotencyKey: string, body: unknown = {}) => request(`/obligations/${id}/settle`, { method: "POST", body: JSON.stringify(body), headers: key(idempotencyKey) });
  const cancel = (id: string, reason: string, idempotencyKey: string, actor = U, workspace = WA) => request(`/obligations/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }), headers: key(idempotencyKey) }, actor, workspace);
  const reverse = (obligationId: string, paymentId: string, reason: string, idempotencyKey: string, actor = U, workspace = WA) => request(`/obligations/${obligationId}/settlements/${paymentId}/reverse`, { method: "POST", body: JSON.stringify({ reason }), headers: key(idempotencyKey) }, actor, workspace);
  const eur = async () => (await (await request("/summary")).json()).currencies.find((currency: any) => currency.currencyCode === "EUR");

  beforeAll(async () => {
    await clean();
    for (const [id, appId, email, role] of [[U, UA, "owner@t", "admin"], [B, BA, "owner-b@t", "admin"], [T, TA, "tech@t", "technician"], [C, CAU, "client@t", "user"], [P, PA, "personal@t", "technician"]] as const) {
      await prisma.user.create({ data: { id, email, fullName: email, role, passwordHash: "x", appUser: { create: { id: appId, email } } } });
    }
    await prisma.workspace.create({ data: { id: WA, name: "A", ownerUserId: UA, memberships: { create: [{ userId: TA, role: "technician", status: "active" }, { userId: CAU, role: "client", status: "active" }] } } });
    await prisma.workspace.create({ data: { id: WB, name: "B", ownerUserId: BA } });
    await prisma.workspace.create({ data: { id: WP, name: "Personal", type: "personal", ownerUserId: PA } });
    await prisma.client.createMany({ data: [{ id: CA, workspaceId: WA, name: "A" }, { id: CB, workspaceId: WB, name: "B" }, { id: CP, workspaceId: WP, name: "P" }] });
    await prisma.paymentList.createMany({ data: [
      { id: LA, workspaceId: WA, clientId: CA, clientName: "A", listNumber: "t08-a", currencyCode: "EUR", status: "paid", recognizedTotal: "5000.00", sourceDocumentTotal: "5555.00", itemCount: 1, createdBy: U },
      { id: LB, workspaceId: WB, clientId: CB, clientName: "B", listNumber: "t08-b", currencyCode: "EUR", status: "paid", recognizedTotal: "7777.77", createdBy: B },
      { id: LP, workspaceId: WP, clientId: CP, clientName: "P", listNumber: "t08-p", currencyCode: "EUR", status: "paid", recognizedTotal: "5000.00", createdBy: P },
    ] });
    await prisma.paymentListItem.create({ data: { id: IA, workspaceId: WA, paymentListId: LA, servicesSnapshot: [], totalAmount: "5000.00" } });
    await prisma.person.createMany({ data: [
      { id: PT, workspaceId: WA, type: "technician", fullName: "Tech A", systemAccessUserId: T },
      { id: PO, workspaceId: WA, type: "technician", fullName: "Tech B" },
      { id: PN, workspaceId: WA, type: "partner", fullName: "No account" },
      { id: PB, workspaceId: WB, type: "technician", fullName: "Foreign" },
    ] });
    const app = express(); app.use(express.json()); app.use("/api/payment-lists", paymentListsRouter); app.use("/api/finance/v2", financeV2Router);
    server = app.listen(0); await once(server, "listening"); base = `http://127.0.0.1:${server.address().port}/api/finance/v2`;
  });
  afterAll(async () => { server.close(); await clean(); await prisma.$disconnect(); });
  beforeEach(async () => { await cleanFinance(); });

  it("A, B, C, D, E: derives frozen payable facts, rejects client authority, enforces uniqueness, and converges create idempotency", async () => {
    const distribution = await createDistribution({ kind: "workspace", workspaceId: WA });
    const first = await createObligation(distribution.id, "create");
    expect(first.status).toBe(201);
    const obligation = await first.json();
    expect(obligation).toMatchObject({
      distributionId: distribution.id,
      amount: "2000.00",
      currencyCode: "EUR",
      status: "pending",
      createdByUserId: U,
      idempotent: false,
    });
    expect(obligation.distribution).toMatchObject({
      participant: { kind: "workspace", workspaceId: WA },
      resolvedAmount: "2000.00",
      currencyCode: "EUR",
    });

    // Owner read own detail (E)
    const detail = await request(`/obligations/${obligation.id}`);
    expect(detail.status).toBe(200);
    expect((await detail.json()).id).toBe(obligation.id);
    expect((await request(`/obligations/${crypto.randomUUID()}`)).status).toBe(404);

    // Same idempotency key + same distribution -> 200 idempotent (C)
    const replay = await createObligation(distribution.id, "create");
    expect(replay.status).toBe(200);
    expect((await replay.json())).toMatchObject({ id: obligation.id, idempotent: true });

    // Same key + different distribution -> 409 IDEMPOTENCY_KEY_REUSED (C)
    const otherDist = await createDistribution({ kind: "workspace", workspaceId: WA }, "1500.00");
    const diffDistReusedKey = await createObligation(otherDist.id, "create");
    expect(diffDistReusedKey.status).toBe(409);
    expect((await diffDistReusedKey.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");

    // Second non-idempotent create for same distribution -> 409 OBLIGATION_ALREADY_EXISTS (D)
    const secondCreate = await createObligation(distribution.id, "other-key");
    expect(secondCreate.status).toBe(409);
    expect((await secondCreate.json()).error.code).toBe("OBLIGATION_ALREADY_EXISTS");

    // Client must not control cadence / installments / amount / dueDate (B)
    expect((await request("/obligations", {
      method: "POST",
      body: JSON.stringify({ distributionId: distribution.id, amount: "1.00", dueDate: "2030-01-01", installmentNumber: 1 }),
      headers: key("invalid"),
    })).status).toBe(422);

    // Concurrent same-key create -> one 201, one 200, exactly one row (D)
    const raceDistribution = await createDistribution({ kind: "person", personId: PO }, "1999.99");
    const raced = await Promise.all([
      createObligation(raceDistribution.id, "create-race"),
      createObligation(raceDistribution.id, "create-race"),
    ]);
    expect(raced.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await prisma.financialObligation.count({ where: { distributionId: raceDistribution.id } })).toBe(1);
  });

  it("F, G, H, AC: enforces tenant, technician-own, client, and participant-without-account boundaries", async () => {
    const techDist = await createDistribution({ kind: "person", personId: PT });
    const tech = await createObligation(techDist.id, "tech-own");
    const techId = (await tech.json()).id;

    const otherDist = await createDistribution({ kind: "person", personId: PO });
    const other = await createObligation(otherDist.id, "tech-other");
    const otherId = (await other.json()).id;

    await createObligation((await createDistribution({ kind: "workspace", workspaceId: WA })).id, "workspace-participant");
    await createObligation((await createDistribution({ kind: "client", clientId: CA })).id, "client-participant");

    // AC: Person participant without account creates obligation without provisioning login access
    const noAccountDist = await createDistribution({ kind: "person", personId: PN });
    expect((await createObligation(noAccountDist.id, "no-account-participant")).status).toBe(201);
    expect(await prisma.user.count({ where: { id: PN } })).toBe(0);
    expect(await prisma.appUser.count({ where: { email: "no-account@t" } })).toBe(0);

    // G: Technician A reads only Tech A participant obligations
    const techList = await request("/obligations", {}, T);
    expect(techList.status).toBe(200);
    const items = (await techList.json()).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: techId, distribution: { participant: { kind: "person", personId: PT } } });

    // Technician A can read own detail, cannot read Tech B detail (404)
    expect((await request(`/obligations/${techId}`, {}, T)).status).toBe(200);
    expect((await request(`/obligations/${otherId}`, {}, T)).status).toBe(404);

    // Technician A cannot see workspace financial summary (403)
    expect((await request("/summary", {}, T)).status).toBe(403);

    // Technician A cannot mutate obligations (403)
    expect((await request(`/obligations/${techId}/settle`, { method: "POST", body: "{}", headers: key("t-settle") }, T)).status).toBe(403);
    expect((await cancel(techId, "tech cancel", "t-cancel", T)).status).toBe(403);

    // Settle Tech A obligation by admin, then verify Tech A reads updated status/payment
    const techSettled = await settle(techId, "admin-settle-tech");
    expect(techSettled.status).toBe(200);
    const techDetailAfterSettle = await request(`/obligations/${techId}`, {}, T);
    expect(techDetailAfterSettle.status).toBe(200);
    expect(await techDetailAfterSettle.json()).toMatchObject({
      id: techId,
      status: "paid",
      payment: { amount: "2000.00", currencyCode: "EUR", status: "effective" },
    });

    // H: Client denied access to finance endpoints (403), operational access remains 200
    expect((await request("/obligations", {}, C)).status).toBe(403);
    const operational = await fetch(base.replace("/api/finance/v2", "/api/payment-lists"), {
      headers: { Authorization: `Bearer ${token(C)}`, "X-Workspace-Id": WA },
    });
    expect(operational.status).toBe(200);

    // F: Foreign Workspace B isolation (404 on direct get, not in list)
    const foreignDist = await createDistribution({ kind: "person", personId: PB }, "2000.00", "foreign-distribution", B, WB, LB);
    const foreign = await createObligation(foreignDist.id, "foreign-obligation", B, WB);
    const foreignId = (await foreign.json()).id;
    expect((await request(`/obligations/${foreignId}`)).status).toBe(404);
    expect(JSON.stringify(await (await request("/obligations")).json())).not.toContain("7777.77");
  });

  it("J, K, L, AA: cancels pending obligation idempotently without mutating Distribution or cash", async () => {
    const distribution = await createDistribution({ kind: "workspace", workspaceId: WA });
    const originalDistribution = await request(`/distributions/${distribution.id}`).then((r) => r.json());
    const summaryBefore = await eur();

    // J: Pending obligation creation has zero effect on cash / Available
    const obligation = await (await createObligation(distribution.id, "cancel-create")).json();
    expect(await eur()).toEqual(summaryBefore);

    // K: Cancellation transition
    const first = await cancel(obligation.id, "correction", "cancel");
    expect(first.status).toBe(200);
    const cancelled = await first.json();
    expect(cancelled).toMatchObject({
      id: obligation.id,
      status: "cancelled",
      amount: "2000.00",
      cancellationReason: "correction",
      cancelledByUserId: U,
      idempotent: false,
    });
    expect(cancelled.cancelledAt).toEqual(expect.any(String));

    // Replay same key -> 200 idempotent
    const replay = await cancel(obligation.id, "correction", "cancel");
    expect(replay.status).toBe(200);
    expect((await replay.json()).idempotent).toBe(true);

    // Same key + different reason -> 409
    expect((await cancel(obligation.id, "different", "cancel")).status).toBe(409);

    // New key on already-cancelled obligation -> 409
    expect((await cancel(obligation.id, "different", "cancel-second")).status).toBe(409);

    // L: Cancelled obligation cannot settle
    expect((await settle(obligation.id, "cancelled-settle")).status).toBe(409);

    // No payments created, cash unchanged
    expect(await prisma.obligationPayment.count({ where: { obligationId: obligation.id } })).toBe(0);
    expect(await eur()).toEqual(summaryBefore);

    // AA: Distribution remains active and unchanged
    const distAfterCancel = await request(`/distributions/${distribution.id}`).then((r) => r.json());
    expect(distAfterCancel).toMatchObject({
      id: distribution.id,
      status: "active",
      resolvedAmount: originalDistribution.resolvedAmount,
      currencyCode: originalDistribution.currencyCode,
    });

    // Concurrent cancel with same key -> converges idempotently to 200
    const raceObligation = await (await createObligation((await createDistribution({ kind: "workspace", workspaceId: WA })).id, "cancel-race-create")).json();
    const results = await Promise.all([
      cancel(raceObligation.id, "race", "cancel-race"),
      cancel(raceObligation.id, "race", "cancel-race"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 200]);
    expect(await prisma.financialObligation.count({ where: { id: raceObligation.id, status: "cancelled" } })).toBe(1);
  });

  it("M, N, O, P, R, S, T, U, V, W, Y, AB: settles full amount atomically, affects Available once, preserves Spec004 truth, and reverses without reopening", async () => {
    // Setup initial financial facts: Received = 5000.00, Expense = 3000.00 -> Available = 2000.00
    expect((await request("/expenses", {
      method: "POST",
      body: JSON.stringify({ amount: "3000.00", currencyCode: "EUR", category: "fuel", occurredOn: "2026-09-24" }),
      headers: key("expense-before-settlement"),
    })).status).toBe(201);

    const distribution = await createDistribution({ kind: "workspace", workspaceId: WA });
    const obligation = await (await createObligation(distribution.id, "settle-create")).json();

    // Spec004 commercial state snapshot
    const commercialBefore = await prisma.paymentList.findUniqueOrThrow({
      where: { id: LA },
      select: { status: true, recognizedTotal: true, sourceDocumentTotal: true, itemCount: true },
    });
    const itemsBefore = await prisma.paymentListItem.count({ where: { paymentListId: LA } });
    const claimsBefore = await prisma.paymentListEntryClaim.count({ where: { paymentListId: LA } });
    const confrontationsBefore = await prisma.paymentListConfrontationRun.count({ where: { paymentListId: LA } });

    // Legacy authorities snapshot
    const legacyBefore = await Promise.all([
      prisma.expense.count({ where: { workspaceId: WA } }),
      prisma.financialRecord.count({ where: { workspaceId: WA } }),
      prisma.paymentOrder.count(),
      prisma.serviceOrderDistribution.count(),
    ]);

    // Available before settlement = 2000.00
    expect(await eur()).toMatchObject({
      received: "5000.00",
      expenses: "3000.00",
      settledObligationPayments: "0.00",
      available: "2000.00",
    });

    // M: Full settlement only — reject partial, installment, or client-supplied fields
    expect((await settle(obligation.id, "settle-invalid", {
      amount: "1.00",
      partialAmount: "1.00",
      remainingAmount: "1999.00",
      installment: 1,
      installmentNumber: 1,
      paidAt: "2026-09-24",
      paidBy: C,
    })).status).toBe(422);

    // N: Atomically settles full obligation and creates ObligationPayment
    const settled = await settle(obligation.id, "settle");
    expect(settled.status).toBe(200);
    const paid = await settled.json();
    expect(paid).toMatchObject({
      status: "paid",
      paidByUserId: U,
      payment: { amount: "2000.00", currencyCode: "EUR", status: "effective", paidByUserId: U },
    });
    expect(paid.paidAt).toEqual(expect.any(String));
    expect(paid.payment.paidAt).toEqual(expect.any(String));

    // R: Available reduced to 0.00, settledObligationPayments = 2000.00
    expect(await eur()).toMatchObject({ settledObligationPayments: "2000.00", available: "0.00" });

    // O: Settlement idempotency replay
    const settleReplay = await settle(obligation.id, "settle");
    expect(settleReplay.status).toBe(200);
    expect((await settleReplay.json()).payment.id).toBe(paid.payment.id);
    expect(await eur()).toMatchObject({ settledObligationPayments: "2000.00", available: "0.00" });

    // P: Second settlement with new idempotency key -> 409 conflict
    expect((await settle(obligation.id, "settle-second")).status).toBe(409);
    expect(await prisma.obligationPayment.count({ where: { obligationId: obligation.id } })).toBe(1);

    // S & T: No expense or legacy record created by settlement
    expect(await Promise.all([
      prisma.expense.count({ where: { workspaceId: WA } }),
      prisma.financialRecord.count({ where: { workspaceId: WA } }),
      prisma.paymentOrder.count(),
      prisma.serviceOrderDistribution.count(),
    ])).toEqual(legacyBefore);

    // AB: Spec004 commercial truth unchanged
    expect(await prisma.paymentList.findUniqueOrThrow({
      where: { id: LA },
      select: { status: true, recognizedTotal: true, sourceDocumentTotal: true, itemCount: true },
    })).toEqual(commercialBefore);
    expect(await prisma.paymentListItem.count({ where: { paymentListId: LA } })).toBe(itemsBefore);
    expect(await prisma.paymentListEntryClaim.count({ where: { paymentListId: LA } })).toBe(claimsBefore);
    expect(await prisma.paymentListConfrontationRun.count({ where: { paymentListId: LA } })).toBe(confrontationsBefore);

    // U & V: Payment reversal preserves payment record, restores Available
    const reversed = await reverse(obligation.id, paid.payment.id, "correction", "reverse");
    expect(reversed.status).toBe(200);
    expect(await reversed.json()).toMatchObject({
      status: "reversed",
      reversalReason: "correction",
      reversedByUserId: U,
      payment: { id: paid.payment.id, status: "reversed", reversalReason: "correction", reversedByUserId: U },
    });
    expect(await eur()).toMatchObject({ settledObligationPayments: "0.00", available: "2000.00" });

    // W: Reversal idempotency replay
    expect((await reverse(obligation.id, paid.payment.id, "correction", "reverse")).status).toBe(200);
    expect(await eur()).toMatchObject({ settledObligationPayments: "0.00", available: "2000.00" });

    // Reversal conflicts: same key different reason (409), new key after reversed (409)
    expect((await reverse(obligation.id, paid.payment.id, "different", "reverse")).status).toBe(409);
    expect((await reverse(obligation.id, paid.payment.id, "different", "reverse-second")).status).toBe(409);

    // Y: Reversed obligation does not reopen — cannot settle again
    expect((await settle(obligation.id, "reversed-settle")).status).toBe(409);
    expect(await prisma.obligationPayment.count({ where: { obligationId: obligation.id } })).toBe(1);
  });

  it("Q, X: converges concurrent settlement and reversal without double cash movement", async () => {
    const obligation = await (await createObligation((await createDistribution({ kind: "workspace", workspaceId: WA })).id, "concurrent-create")).json();

    // Q: Two concurrent settlements with different keys -> exactly one wins (200), one conflicts (409)
    const settled = await Promise.all([
      settle(obligation.id, "settle-race-a"),
      settle(obligation.id, "settle-race-b"),
    ]);
    expect(settled.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.obligationPayment.count({ where: { obligationId: obligation.id } })).toBe(1);

    const payment = await prisma.obligationPayment.findFirstOrThrow({ where: { obligationId: obligation.id } });

    // X: Two concurrent reversals with different keys -> exactly one wins (200), one conflicts (409)
    const reversed = await Promise.all([
      reverse(obligation.id, payment.id, "race", "reverse-race-a"),
      reverse(obligation.id, payment.id, "race", "reverse-race-b"),
    ]);
    expect(reversed.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.obligationPayment.count({ where: { obligationId: obligation.id, status: "reversed" } })).toBe(1);

    const finalDetail = await request(`/obligations/${obligation.id}`).then((r) => r.json());
    expect(finalDetail).toMatchObject({
      status: "reversed",
      payment: { id: payment.id, status: "reversed" },
    });
  });

  it("Z: blocks source Distribution cancellation after real Obligation linkage", async () => {
    const distribution = await createDistribution({ kind: "workspace", workspaceId: WA });
    await createObligation(distribution.id, "distribution-guard");
    const blocked = await request(`/distributions/${distribution.id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: "no cascade" }),
      headers: key("distribution-guard"),
    });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe("DISTRIBUTION_NOT_CANCELLABLE");
    expect(await request(`/distributions/${distribution.id}`).then((r) => r.json())).toMatchObject({
      id: distribution.id,
      status: "active",
    });
  });

  it("I: grants personal workspace owner full obligation lifecycle authority", async () => {
    // Create, read, cancel in personal workspace
    const personalDistribution = await createDistribution({ kind: "workspace", workspaceId: WP }, "2000.00", "personal-distribution", P, WP, LP);
    const personalResponse = await createObligation(personalDistribution.id, "personal-obligation", P, WP);
    expect(personalResponse.status).toBe(201);
    const personal = await personalResponse.json();
    expect((await request("/obligations", {}, P, WP)).status).toBe(200);
    expect((await cancel(personal.id, "owner cancellation", "personal-cancel", P, WP)).status).toBe(200);

    // Settle and reverse in personal workspace
    const secondDistribution = await createDistribution({ kind: "workspace", workspaceId: WP }, "2000.00", "personal-distribution-2", P, WP, LP);
    const second = await (await createObligation(secondDistribution.id, "personal-obligation-2", P, WP)).json();
    const paid = await (await request(`/obligations/${second.id}/settle`, { method: "POST", body: "{}", headers: key("personal-settle") }, P, WP)).json();
    expect((await reverse(second.id, paid.payment.id, "owner reversal", "personal-reverse", P, WP)).status).toBe(200);
  });
});
