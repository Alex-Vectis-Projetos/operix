// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error backend dependency is intentionally isolated from the SPA test graph.
import express from "../../backend/node_modules/express/index.js";
import { prisma } from "../../backend/src/lib/prisma.js";
import { signAccessToken } from "../../backend/src/lib/jwt.js";
import { projectPaymentListItem } from "../../backend/src/services/downstreamPaymentOrderAdapter.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://operix_local:U2dkA-cJYnwHuD7hiAY2hPTrkawjg6f8@127.0.0.1:55432/operix_local?schema=public";
process.env.JWT_SECRET ??= "this-is-a-test-secret-with-more-than-32-chars-long";

const a = { workspaceId: "70000000-0000-4000-8000-000000000001", clientId: "71000000-0000-4000-8000-000000000001", owner: { id: "72000000-0000-4000-8000-000000000001", appId: "73000000-0000-4000-8000-000000000001", email: "legacy.a@example.com" }, technician: { id: "72000000-0000-4000-8000-000000000002", appId: "73000000-0000-4000-8000-000000000002", email: "legacy.tech@example.com" } };
const b = { workspaceId: "70000000-0000-4000-8000-000000000002", clientId: "71000000-0000-4000-8000-000000000002", owner: { id: "72000000-0000-4000-8000-000000000003", appId: "73000000-0000-4000-8000-000000000003", email: "legacy.b@example.com" } };

describe("Spec 004 — T09 Legacy PaymentOrder Transition", () => {
  let app: express.Express;
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl: string;
  let serial = 0;
  const ctx = { actorUserId: a.owner.id, platformRole: "user" as const, activeWorkspaceId: a.workspaceId, membershipRole: "owner" as const, scope: "workspace" as const, capabilities: [] };
  const headers = (actor = a.owner, workspaceId = a.workspaceId) => ({ Authorization: `Bearer ${signAccessToken({ id: actor.id, email: actor.email, role: "admin" })}`, "Content-Type": "application/json", "X-Workspace-Id": workspaceId });

  async function clear(workspaceId: string) {
    await prisma.paymentOrder.deleteMany({ where: { workspaceId } });
    await prisma.paymentListConfrontationResult.deleteMany({ where: { workspaceId } });
    await prisma.paymentListConfrontationRun.deleteMany({ where: { workspaceId } });
    await prisma.paymentListEntryClaim.deleteMany({ where: { workspaceId } });
    await prisma.paymentListItem.deleteMany({ where: { workspaceId } });
    await prisma.paymentList.deleteMany({ where: { workspaceId } });
    await prisma.financialRecord.deleteMany({ where: { workspaceId } });
  }
  async function makeItem(workspaceId = a.workspaceId, clientId = a.clientId, owner = a.owner, technician = a.technician) {
    const list = await prisma.paymentList.create({ data: { workspaceId, listNumber: `L9${String(++serial).padStart(5, "0")}`, clientId, clientName: "Cliente legado", currencyCode: "EUR", status: "under_review", itemCount: 1, sourceDocumentTotal: "125.50", recognizedTotal: "0.00", createdBy: owner.id } });
    return prisma.paymentListItem.create({ data: { workspaceId, paymentListId: list.id, carName: "Veículo canônico", licensePlate: "AA123BB", vin: "1HGCM82633A004352", technicianUserId: technician.id, technicianName: "Técnico canônico", servicesSnapshot: [{ type: "PDR", quantity: "1" }], totalAmount: "125.50" }, include: { paymentList: true } });
  }

  beforeAll(async () => {
    for (const f of [a, b]) { await clear(f.workspaceId); await prisma.client.deleteMany({ where: { workspaceId: f.workspaceId } }); await prisma.membership.deleteMany({ where: { workspaceId: f.workspaceId } }); await prisma.workspace.deleteMany({ where: { id: f.workspaceId } }); }
    await prisma.user.deleteMany({ where: { id: { in: [a.owner.id, a.technician.id, b.owner.id] } } });
    for (const actor of [a.owner, a.technician, b.owner]) await prisma.user.create({ data: { id: actor.id, email: actor.email, fullName: actor.email, role: actor === a.technician ? "user" : "admin", passwordHash: "test-hash", isActive: true, appUser: { create: { id: actor.appId, email: actor.email, name: actor.email } } } });
    for (const [f, owner, members] of [[a, a.owner, [{ userId: a.owner.appId, role: "owner" }, { userId: a.technician.appId, role: "technician" }]], [b, b.owner, [{ userId: b.owner.appId, role: "owner" }]]] as const) {
      await prisma.workspace.create({ data: { id: f.workspaceId, name: `Workspace ${f.workspaceId}`, timezone: "Europe/Paris", ownerUserId: owner.appId, memberships: { create: members.map((m) => ({ ...m, status: "active" })) } } });
      await prisma.client.create({ data: { id: f.clientId, workspaceId: f.workspaceId, name: `Cliente ${f.workspaceId}` } });
    }
  });
  beforeEach(async () => {
    serial = 0; await clear(a.workspaceId); await clear(b.workspaceId);
    app = express(); app.use(express.json());
    const { paymentOrdersRouter } = await import("../../backend/src/routes/paymentOrders.js");
    const { financeRouter } = await import("../../backend/src/routes/finance.js");
    app.use("/api/payment-orders", paymentOrdersRouter); app.use("/api/finance", financeRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, () => { const address = server.address(); baseUrl = `http://127.0.0.1:${typeof address === "object" ? address?.port : 0}`; resolve(); }); });
  });
  afterEach(() => server.close());
  afterAll(async () => { for (const f of [a, b]) { await clear(f.workspaceId); await prisma.client.deleteMany({ where: { workspaceId: f.workspaceId } }); await prisma.membership.deleteMany({ where: { workspaceId: f.workspaceId } }); await prisma.workspace.deleteMany({ where: { id: f.workspaceId } }); } await prisma.user.deleteMany({ where: { id: { in: [a.owner.id, a.technician.id, b.owner.id] } } }); await prisma.$disconnect(); });

  it("LEGACY-PO-PROJECTION-IDEMPOTENT-01 and LEGACY-PO-PROJECTION-CONCURRENT-01: canonical projection is one-way and converges", async () => {
    const item = await makeItem(); const financialBefore = await prisma.financialRecord.count({ where: { workspaceId: a.workspaceId } });
    const [left, right] = await Promise.all([projectPaymentListItem(ctx, item.id), projectPaymentListItem(ctx, item.id)]);
    expect(left?.id).toBe(right?.id);
    const stored = await prisma.paymentListItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(stored.legacyPaymentOrderId).toBe(left?.id);
    expect(await prisma.paymentOrder.count({ where: { workspaceId: a.workspaceId } })).toBe(1);
    expect((await projectPaymentListItem(ctx, item.id))?.id).toBe(left?.id);
    expect(await prisma.paymentOrder.count({ where: { workspaceId: a.workspaceId } })).toBe(1);
    expect(await prisma.financialRecord.count({ where: { workspaceId: a.workspaceId } })).toBe(financialBefore);
  });

  it("LEGACY-PO-GET-TENANT-01 and LEGACY-PO-QUERY-SPOOF-01: the real mounted read route scopes active workspace", async () => {
    const item = await makeItem(); await projectPaymentListItem(ctx, item.id);
    expect((await fetch(`${baseUrl}/api/payment-orders`, { headers: headers() })).status).toBe(200);
    const foreign = await fetch(`${baseUrl}/api/payment-orders?workspace_id=${a.workspaceId}`, { headers: headers(b.owner, b.workspaceId) });
    expect(foreign.status).toBe(200); expect(await foreign.json()).toEqual([]);
  });

  it("LEGACY-PO-PROJECTION-TENANT-01: adapter cannot link or update a foreign workspace item", async () => {
    const foreignItem = await makeItem(b.workspaceId, b.clientId, b.owner, b.owner);
    await expect(projectPaymentListItem(ctx, foreignItem.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await prisma.paymentOrder.count({ where: { workspaceId: b.workspaceId } })).toBe(0);
    expect((await prisma.paymentListItem.findUniqueOrThrow({ where: { id: foreignItem.id } })).legacyPaymentOrderId).toBeNull();
  });

  it("LEGACY-PAYMENTORDER-READONLY-01: real legacy mutations reach deprecation policy without data changes", async () => {
    const item = await makeItem(); const projection = await projectPaymentListItem(ctx, item.id);
    const before = { orders: await prisma.paymentOrder.count({ where: { workspaceId: a.workspaceId } }), lists: await prisma.paymentList.count({ where: { workspaceId: a.workspaceId } }), items: await prisma.paymentListItem.count({ where: { workspaceId: a.workspaceId } }), finance: await prisma.financialRecord.count({ where: { workspaceId: a.workspaceId } }) };
    for (const [path, method] of [["", "POST"], [`/${projection!.id}`, "PATCH"], [`/${projection!.id}`, "DELETE"], ["", "DELETE"]] as const) {
      const response = await fetch(`${baseUrl}/api/payment-orders${path}`, { method, headers: headers(), body: method === "PATCH" ? JSON.stringify({ total: 1 }) : method === "POST" ? JSON.stringify({ total: 1 }) : undefined });
      expect(response.status).toBe(410); expect((await response.json()).code).toBe("LEGACY_PAYMENT_ORDER_WRITE_DEPRECATED");
    }
    expect({ orders: await prisma.paymentOrder.count({ where: { workspaceId: a.workspaceId } }), lists: await prisma.paymentList.count({ where: { workspaceId: a.workspaceId } }), items: await prisma.paymentListItem.count({ where: { workspaceId: a.workspaceId } }), finance: await prisma.financialRecord.count({ where: { workspaceId: a.workspaceId } }) }).toEqual(before);
  });

  it("LEGACY-RECONCILIATION-RUN-DISABLED-01: the destructive engine is retired before it can mutate", async () => {
    const before = { orders: await prisma.paymentOrder.count(), reconciliations: await prisma.reconciliation.count(), finance: await prisma.financialRecord.count() };
    const response = await fetch(`${baseUrl}/api/finance/reconciliations/run`, { method: "POST", headers: headers() });
    expect(response.status).toBe(410); expect((await response.json()).code).toBe("LEGACY_RECONCILIATION_ENGINE_DEPRECATED");
    expect({ orders: await prisma.paymentOrder.count(), reconciliations: await prisma.reconciliation.count(), finance: await prisma.financialRecord.count() }).toEqual(before);
  });

  it("LEGACY-RECONCILIATION-READ-DISABLED-01: unsafe global reconciliation reads are not exposed", async () => {
    const response = await fetch(`${baseUrl}/api/finance/reconciliations`, { headers: headers() });
    expect(response.status).toBe(410);
    expect((await response.json()).code).toBe("LEGACY_RECONCILIATION_READ_DEPRECATED");
  });
});
