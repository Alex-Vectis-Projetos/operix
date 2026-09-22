// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error backend dependency is intentionally isolated from the SPA test graph.
import express, { type NextFunction, type Request, type Response } from "../../backend/node_modules/express/index.js";
import { prisma } from "../../backend/src/lib/prisma.js";
import { signAccessToken } from "../../backend/src/lib/jwt.js";
import { ForbiddenError } from "../../backend/src/lib/objectAuth.js";
import { setAfterRectificationTestHook } from "../../backend/src/services/confrontationService.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://operix_local:U2dkA-cJYnwHuD7hiAY2hPTrkawjg6f8@127.0.0.1:55432/operix_local?schema=public";
process.env.JWT_SECRET ??= "this-is-a-test-secret-with-more-than-32-chars-long";

const fixture = {
  workspaceId: "40000000-0000-4000-8000-000000000050",
  clientId: "43000000-0000-4000-8000-000000000050",
  owner: { id: "41000000-0000-4000-8000-000000000050", appId: "42000000-0000-4000-8000-000000000050", email: "owner.a.confront@example.com" },
  technician: { id: "41000000-0000-4000-8000-000000000051", appId: "42000000-0000-4000-8000-000000000051", email: "tech.a.confront@example.com" },
  foreign: { workspaceId: "40000000-0000-4000-8000-000000000060", owner: { id: "41000000-0000-4000-8000-000000000060", appId: "42000000-0000-4000-8000-000000000060", email: "owner.b.confront@example.com" } },
};
const validVin = "1HGCM82633A004352";
const pdr = [{ type: "PDR", quantity: "1" }];

describe("Spec 004 — Commercial Confrontation & Disputes", () => {
  let app: express.Express;
  let server: ReturnType<express.Express["listen"]>;
  let baseUrl: string;
  let serial = 0;

  const auth = (actor = fixture.owner, activeWorkspaceId = fixture.workspaceId) => ({
    Authorization: `Bearer ${signAccessToken({ id: actor.id, email: actor.email, role: actor === fixture.technician ? "user" : "admin" })}`,
    "Content-Type": "application/json",
    "X-Workspace-Id": activeWorkspaceId,
  });

  async function cleanOperationalData() {
    const where = { workspaceId: fixture.workspaceId };
    await prisma.paymentListConfrontationResult.deleteMany({ where });
    await prisma.paymentListConfrontationRun.deleteMany({ where });
    await prisma.paymentListEntryClaim.deleteMany({ where });
    await prisma.paymentListItem.deleteMany({ where });
    await prisma.paymentList.deleteMany({ where });
    await prisma.weeklogValidation.deleteMany({ where });
    await prisma.productionOrder.updateMany({ where, data: { rectificationOriginId: null } });
    await prisma.weeklogEntry.deleteMany({ where });
    await prisma.weeklog.deleteMany({ where });
    await prisma.productionOrder.deleteMany({ where });
    await prisma.externalOperationalImportItem.deleteMany({ where });
    await prisma.externalOperationalImport.deleteMany({ where });
  }

  async function createEntry(input: Partial<{ plate: string; vin: string; amount: string; services: any; clientId: string; currency: string; validated: boolean }> = {}) {
    const index = ++serial;
    const clientId = input.clientId ?? fixture.clientId;
    const startsOn = new Date(Date.UTC(2026, 0, 5 + index * 7));
    const weeklog = await prisma.weeklog.create({ data: {
      workspaceId: fixture.workspaceId, startsOn, endsOn: new Date(startsOn.getTime() + 6 * 86_400_000), clientId,
      siteKey: "SITE-CONFRONT", week: `2026-W${String(index).padStart(2, "0")}`, weekNumber: index, yearReference: 2026, status: "validated",
    } });
    const order = await prisma.productionOrder.create({ data: {
      workspaceId: fixture.workspaceId, code: `PO-CONFRONT-${index}`, clientId, technicianUserId: fixture.technician.id,
      operationalSiteKey: "SITE-CONFRONT", currencyCode: input.currency ?? "EUR", status: "delivered", deliveredAt: startsOn,
    } });
    const entry = await prisma.weeklogEntry.create({ data: {
      weeklogId: weeklog.id, workspaceId: fixture.workspaceId, sourceType: "production_order", productionOrderId: order.id,
      executionSequence: 1, clientId, technicianUserId: fixture.technician.id, technicianName: "Tech Confront",
      licensePlate: input.plate ?? "AA123BB", vin: input.vin ?? validVin, servicesSnapshot: input.services ?? pdr,
      totalAmount: input.amount ?? "500.00", currencyCode: input.currency ?? "EUR", deliveredAt: startsOn,
      validationStatus: input.validated === false ? "pending" : "approved",
    } });
    if (input.validated !== false) await prisma.weeklogValidation.create({ data: {
      weeklogId: weeklog.id, workspaceId: fixture.workspaceId, validationSequence: 1, status: "validated",
      validationMethod: "production_order", coverageSnapshot: [{ weeklogEntryId: entry.id }], auditTrail: [], validatedAt: new Date(),
    } });
    return entry;
  }

  async function createList(items: Array<{ plate?: string; vin?: string; amount?: string; services?: any }>) {
    if (items.length !== 1) throw new Error("T07 fixture requires one customer item per list.");
    const total = items[0]!.amount ?? "500.00";
    return prisma.paymentList.create({ data: {
      workspaceId: fixture.workspaceId, listNumber: `L${String(++serial).padStart(6, "0")}`, clientId: fixture.clientId,
      clientName: "Cliente Confronto", currencyCode: "EUR", status: "under_review", itemCount: items.length,
      sourceDocumentTotal: total, recognizedTotal: "0.00", createdBy: fixture.owner.id,
      items: { create: items.map((item) => ({ licensePlate: item.plate ?? "AA-123-BB", vin: item.vin ?? validVin, servicesSnapshot: item.services ?? pdr, totalAmount: item.amount ?? "500.00" })) },
    }, include: { items: true } });
  }

  async function createExternalEntry() {
    const index = ++serial;
    const startsOn = new Date(Date.UTC(2026, 6, 5 + index * 7));
    const imported = await prisma.externalOperationalImport.create({ data: { workspaceId: fixture.workspaceId, fileName: `external-${index}.pdf`, status: "committed", uploadedBy: fixture.owner.id } });
    const importItem = await prisma.externalOperationalImportItem.create({ data: {
      workspaceId: fixture.workspaceId, importId: imported.id, status: "committed", reviewedClientId: fixture.clientId,
      reviewedCurrencyCode: "EUR", reviewedOperationalSiteKey: "SITE-CONFRONT", reviewedTechnicianUserId: fixture.technician.id,
      reviewedLicensePlate: "AA123BB", reviewedVin: validVin, reviewedDeliveredAt: startsOn, reviewedServices: pdr, reviewedTotal: "500.00",
    } });
    const weeklog = await prisma.weeklog.create({ data: {
      workspaceId: fixture.workspaceId, startsOn, endsOn: new Date(startsOn.getTime() + 6 * 86_400_000), clientId: fixture.clientId,
      siteKey: "SITE-CONFRONT", week: `2026-WE${index}`, weekNumber: index + 20, yearReference: 2026, status: "validated",
    } });
    const entry = await prisma.weeklogEntry.create({ data: {
      weeklogId: weeklog.id, workspaceId: fixture.workspaceId, sourceType: "external_import", externalImportItemId: importItem.id,
      clientId: fixture.clientId, technicianUserId: fixture.technician.id, technicianName: "Tech Confront", licensePlate: "AA123BB", vin: validVin,
      servicesSnapshot: pdr, totalAmount: "500.00", currencyCode: "EUR", deliveredAt: startsOn, validationStatus: "approved",
    } });
    await prisma.weeklogValidation.create({ data: {
      weeklogId: weeklog.id, workspaceId: fixture.workspaceId, validationSequence: 1, status: "validated", validationMethod: "external_import_review",
      coverageSnapshot: { schemaVersion: "1.0", sourceType: "external_import", sourceImportId: imported.id, entries: [{ entryId: entry.id }] }, auditTrail: [], validatedAt: new Date(),
    } });
    return entry;
  }

  async function confront(listId: string, mode?: "current" | "new_round") {
    return fetch(`${baseUrl}/api/payment-lists/${listId}/confront`, { method: "POST", headers: auth(), ...(mode ? { body: JSON.stringify({ mode }) } : {}) });
  }

  beforeAll(async () => {
    await cleanOperationalData();
    await prisma.membership.deleteMany({ where: { workspaceId: fixture.foreign.workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: fixture.foreign.workspaceId } });
    await prisma.user.deleteMany({ where: { id: fixture.foreign.owner.id } });
    await prisma.client.deleteMany({ where: { workspaceId: fixture.workspaceId } });
    await prisma.membership.deleteMany({ where: { workspaceId: fixture.workspaceId } });
    await prisma.workspace.deleteMany({ where: { id: fixture.workspaceId } });
    await prisma.user.deleteMany({ where: { id: { in: [fixture.owner.id, fixture.technician.id] } } });
    for (const actor of [fixture.owner, fixture.technician]) await prisma.user.create({ data: {
      id: actor.id, email: actor.email, fullName: actor.email, role: actor === fixture.owner ? "admin" : "user", passwordHash: "test-hash", isActive: true,
      appUser: { create: { id: actor.appId, email: actor.email, name: actor.email } },
    } });
    await prisma.workspace.create({ data: {
      id: fixture.workspaceId, name: "Workspace Confront 004", timezone: "Europe/Paris", ownerUserId: fixture.owner.appId,
      memberships: { create: [{ userId: fixture.owner.appId, role: "owner", status: "active" }, { userId: fixture.technician.appId, role: "technician", status: "active" }] },
    } });
    await prisma.client.create({ data: { id: fixture.clientId, workspaceId: fixture.workspaceId, name: "Cliente Confronto" } });
    await prisma.user.create({ data: {
      id: fixture.foreign.owner.id, email: fixture.foreign.owner.email, fullName: fixture.foreign.owner.email, role: "admin", passwordHash: "test-hash", isActive: true,
      appUser: { create: { id: fixture.foreign.owner.appId, email: fixture.foreign.owner.email, name: fixture.foreign.owner.email } },
    } });
    await prisma.workspace.create({ data: {
      id: fixture.foreign.workspaceId, name: "Workspace Foreign Confront 004", timezone: "Europe/Paris", ownerUserId: fixture.foreign.owner.appId,
      memberships: { create: { userId: fixture.foreign.owner.appId, role: "owner", status: "active" } },
    } });
  });

  beforeEach(async () => {
    serial = 0;
    await cleanOperationalData();
    app = express();
    app.use(express.json());
    const { paymentListsRouter } = await import("../../backend/src/routes/paymentLists.js");
    app.use("/api/payment-lists", paymentListsRouter);
    app.use((error: any, _req: Request, res: Response, _next: NextFunction) => res.status(error?.statusCode || (error instanceof ForbiddenError ? 403 : 500)).json({ code: error?.code, message: error?.message }));
    await new Promise<void>((resolve) => { server = app.listen(0, () => { const address = server.address(); baseUrl = `http://127.0.0.1:${typeof address === "object" ? address?.port : 0}`; resolve(); }); });
  });

  afterEach(() => server.close());
  afterAll(async () => { await cleanOperationalData(); await prisma.client.deleteMany({ where: { workspaceId: fixture.workspaceId } }); await prisma.membership.deleteMany({ where: { workspaceId: fixture.workspaceId } }); await prisma.workspace.deleteMany({ where: { id: fixture.workspaceId } }); await prisma.membership.deleteMany({ where: { workspaceId: fixture.foreign.workspaceId } }); await prisma.workspace.deleteMany({ where: { id: fixture.foreign.workspaceId } }); await prisma.user.deleteMany({ where: { id: { in: [fixture.owner.id, fixture.technician.id, fixture.foreign.owner.id] } } }); await prisma.$disconnect(); });

  it("CONFRONT-NOT-EVALUATED-01: reports the explicit pre-run state", async () => {
    const list = await createList([{ }]);
    const response = await fetch(`${baseUrl}/api/payment-lists/${list.id}/confrontation`, { headers: auth() });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("not_evaluated");
    expect(body.items[0].confrontationStatus).toBe("not_evaluated");
  });

  it("CONFRONT-IDEMPOTENT-01 and CONFRONT-VEHICLE-01: normalizes VIN/plate and recovers the same run", async () => {
    await createEntry({ plate: "AA123BB", vin: validVin.toLowerCase() });
    const list = await createList([{ plate: "aa-123-bb", vin: validVin, amount: "500.00" }]);
    const first = await confront(list.id);
    expect(first.status).toBe(201);
    const created = await first.json();
    expect(created.sequence).toBe(1);
    expect(created.results[0].status).toBe("exact_match");
    const second = await confront(list.id, "current");
    expect(second.status).toBe(200);
    const recovered = await second.json();
    expect(recovered.idempotent).toBe(true);
    expect(recovered.runId).toBe(created.runId);
    expect(recovered.results[0].id).toBe(created.results[0].id);
  });

  it("hardening: formally covered external operational evidence is eligible without a fabricated ProductionOrder", async () => {
    const entry = await createExternalEntry();
    const list = await createList([{ }]);
    const body = await (await confront(list.id)).json();
    expect(body.results.find((row: any) => row.paymentListItemId)).toMatchObject({ status: "exact_match", weeklogEntryId: entry.id });
    expect((await prisma.weeklogEntry.findUniqueOrThrow({ where: { id: entry.id } })).productionOrderId).toBeNull();
  });

  it("CONFRONT-RERUN-HISTORY-01: explicit new_round preserves the completed history", async () => {
    await createEntry();
    const list = await createList([{ }]);
    const first = await confront(list.id); const run1 = await first.json();
    const second = await confront(list.id, "new_round");
    expect(second.status).toBe(201);
    const run2 = await second.json();
    expect(run2.sequence).toBe(2);
    expect(run2.previousRunId).toBe(run1.runId);
    expect(await prisma.paymentListConfrontationRun.findUniqueOrThrow({ where: { id: run1.runId } })).toMatchObject({ status: "superseded" });
  });

  it("CONFRONT-RERUN-DECISION-IMMUTABLE-01: current mode cannot overwrite a decided run", async () => {
    const entry = await createEntry({ amount: "500.00" });
    const list = await createList([{ amount: "420.00" }]);
    const created = await (await confront(list.id)).json();
    const decision = await fetch(`${baseUrl}/api/payment-lists/${list.id}/confrontation/${created.results[0].id}/decision`, { method: "PATCH", headers: auth(), body: JSON.stringify({ decision: "accept_difference", notes: "Desconto formal" }) });
    expect(decision.status).toBe(200);
    await prisma.weeklogEntry.update({ where: { id: entry.id }, data: { totalAmount: "490.00" } });
    const blocked = await confront(list.id, "current");
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).code).toBe("CONFRONTATION_RERUN_HAS_DECISIONS");
    const next = await confront(list.id, "new_round");
    expect(next.status).toBe(201);
    expect((await next.json()).sequence).toBe(2);
  });

  it("CONFRONT-SERVICE-01 and CONFRONT-VALUE-01: service precedence is stable and money remains decimal", async () => {
    await createEntry({ amount: "500.00", services: [{ type: "PDR", quantity: "1" }, { type: "PAINT", quantity: "1" }] });
    const serviceList = await createList([{ amount: "400.00", services: [{ type: "PDR", quantity: "1" }] }]);
    const serviceRun = await (await confront(serviceList.id)).json();
    expect(serviceRun.results.find((result: any) => result.paymentListItemId)?.status).toBe("service_discrepancy");
    await cleanOperationalData();
    await createEntry({ amount: "500.00", services: [{ type: "PDR", quantity: "1" }] });
    const valueList = await createList([{ amount: "420.00", services: [{ type: "PDR", quantity: "1" }] }]);
    const valueRun = await (await confront(valueList.id)).json();
    const result = valueRun.results.find((row: any) => row.paymentListItemId);
    expect(result.status).toBe("value_difference");
    expect(result.differenceAmount).toBe("-80.00");
  });

  it("CONFRONT-AMBIGUOUS-01 and CONFRONT-UNMATCHED-WEEKLOG-01: avoids first-wins and preserves detached entries", async () => {
    await createEntry({ plate: "AA123BB", vin: validVin });
    await createEntry({ plate: "ZZ999ZZ", vin: "1HGCM82633A004353" });
    const ambiguousList = await createList([{ plate: "AA123BB", vin: "1HGCM82633A004353" }]);
    const ambiguous = await (await confront(ambiguousList.id)).json();
    expect(ambiguous.results.find((result: any) => result.paymentListItemId)?.status).toBe("ambiguous_match");
    expect(ambiguous.results.filter((result: any) => result.paymentListItemId === null && result.status === "unmatched_weeklog")).toHaveLength(2);
  });

  it("CONFRONT-AMBIGUOUS-01: records vehicle_not_found without fabricating operational evidence", async () => {
    const list = await createList([{ plate: "XX-999-XX", vin: "1HGCM82633A004351" }]);
    const body = await (await confront(list.id)).json();
    const result = body.results.find((row: any) => row.paymentListItemId);
    expect(result).toMatchObject({ status: "vehicle_not_found", weeklogEntryId: null });
  });

  it("CONFRONT-HUMAN-DECISION-01: accept_difference records the actor and exact recognized customer amount", async () => {
    await createEntry({ amount: "500.00" });
    const list = await createList([{ amount: "420.00" }]);
    const run = await (await confront(list.id)).json();
    const result = run.results.find((row: any) => row.paymentListItemId);
    const response = await fetch(`${baseUrl}/api/payment-lists/${list.id}/confrontation/${result.id}/decision`, { method: "PATCH", headers: auth(), body: JSON.stringify({ decision: "accept_difference", notes: "Acordo comercial documentado" }) });
    expect(response.status).toBe(200);
    const decision = await response.json();
    expect(decision.result.decidedBy).toBe(fixture.owner.id);
    expect((await prisma.paymentList.findUniqueOrThrow({ where: { id: list.id } })).recognizedTotal.toFixed(2)).toBe("420.00");
  });

  it("CONFRONT-HUMAN-DECISION-01 and LIST-CLAIM-REJECT-RELEASE-01: decisions are actor-audited and rejection releases only this claim", async () => {
    const entry = await createEntry({ amount: "500.00" });
    const list = await createList([{ amount: "420.00" }]);
    const run = await (await confront(list.id)).json();
    const result = run.results.find((row: any) => row.paymentListItemId);
    const decision = await fetch(`${baseUrl}/api/payment-lists/${list.id}/confrontation/${result.id}/decision`, { method: "PATCH", headers: auth(), body: JSON.stringify({ decision: "reject_item", notes: "Glosa documentada" }) });
    expect(decision.status).toBe(200);
    expect((await prisma.paymentListEntryClaim.findFirstOrThrow({ where: { paymentListId: list.id, weeklogEntryId: entry.id } })).status).toBe("released");
    expect((await prisma.paymentList.findUniqueOrThrow({ where: { id: list.id } })).recognizedTotal.toFixed(2)).toBe("0.00");
    expect(await prisma.paymentListItem.count({ where: { paymentListId: list.id } })).toBe(1);
  });

  it("LIST-PENDING-BLOCKED-CONTEST-01 and LIST-PENDING-BLOCKED-RECTIFICATION-01: open commercial decisions block pending", async () => {
    for (const decisionName of ["contest", "request_rectification"] as const) {
      await cleanOperationalData();
      const entry = await createEntry({ amount: "500.00" });
      const list = await createList([{ amount: "420.00" }]);
      const run = await (await confront(list.id)).json();
      const result = run.results.find((row: any) => row.paymentListItemId);
      const decision = await fetch(`${baseUrl}/api/payment-lists/${list.id}/confrontation/${result.id}/decision`, { method: "PATCH", headers: auth(), body: JSON.stringify({ decision: decisionName, notes: "Pendência comercial formal" }) });
      expect(decision.status).toBe(200);
      const pending = await fetch(`${baseUrl}/api/payment-lists/${list.id}/status`, { method: "PATCH", headers: auth(), body: JSON.stringify({ toStatus: "pending" }) });
      expect(pending.status).toBe(409);
      expect((await prisma.paymentListEntryClaim.findFirstOrThrow({ where: { paymentListId: list.id, weeklogEntryId: entry.id } })).status).toBe("reserved");
    }
  });

  it("hardening: concurrent current calls converge to one run and one result set", async () => {
    await createEntry();
    const list = await createList([{ }]);
    const [left, right] = await Promise.all([confront(list.id), confront(list.id)]);
    expect([left.status, right.status].sort()).toEqual([200, 201]);
    expect(await prisma.paymentListConfrontationRun.count({ where: { paymentListId: list.id } })).toBe(1);
    expect(await prisma.paymentListConfrontationResult.count({ where: { paymentListId: list.id } })).toBe(1);
  });

  it("hardening: technician cannot execute confrontation", async () => {
    await createEntry();
    const list = await createList([{ }]);
    const blocked = await fetch(`${baseUrl}/api/payment-lists/${list.id}/confront`, { method: "POST", headers: auth(fixture.technician), body: JSON.stringify({ mode: "current" }) });
    expect(blocked.status).toBe(403);
  });

  it("hardening: claim availability distinguishes another-list reservation, consumption and this-list reservation", async () => {
    const entry = await createEntry();
    const ownerList = await createList([{ }]);
    await confront(ownerList.id);
    const rerun = await confront(ownerList.id, "new_round");
    expect((await rerun.json()).results.find((row: any) => row.paymentListItemId).status).toBe("exact_match");
    const otherList = await createList([{ }]);
    const blockedByReservation = await (await confront(otherList.id)).json();
    expect(blockedByReservation.results.find((row: any) => row.paymentListItemId).status).toBe("vehicle_not_found");
    const pending = await fetch(`${baseUrl}/api/payment-lists/${ownerList.id}/status`, { method: "PATCH", headers: auth(), body: JSON.stringify({ toStatus: "pending" }) });
    expect(pending.status).toBe(200);
    expect((await prisma.paymentListEntryClaim.findFirstOrThrow({ where: { paymentListId: ownerList.id, weeklogEntryId: entry.id } })).status).toBe("consumed");
  });

  it("hardening: explicit new rounds serialize and conflicting decisions cannot last-write-win", async () => {
    const entry = await createEntry({ amount: "500.00" });
    const list = await createList([{ amount: "420.00" }]);
    const first = await (await confront(list.id)).json();
    const [roundA, roundB] = await Promise.all([confront(list.id, "new_round"), confront(list.id, "new_round")]);
    expect([roundA.status, roundB.status]).toEqual([201, 201]);
    expect(await prisma.paymentListConfrontationRun.count({ where: { paymentListId: list.id } })).toBe(3);
    const current = await prisma.paymentListConfrontationRun.findFirstOrThrow({ where: { paymentListId: list.id }, orderBy: { sequence: "desc" }, include: { results: true } });
    const result = current.results.find((row) => row.weeklogEntryId === entry.id)!;
    const [left, right] = await Promise.all([
      fetch(`${baseUrl}/api/payment-lists/${list.id}/confrontation/${result.id}/decision`, { method: "PATCH", headers: auth(), body: JSON.stringify({ decision: "contest", notes: "Contestação A" }) }),
      fetch(`${baseUrl}/api/payment-lists/${list.id}/confrontation/${result.id}/decision`, { method: "PATCH", headers: auth(), body: JSON.stringify({ decision: "reject_item", notes: "Glosa B" }) }),
    ]);
    expect([left.status, right.status].sort()).toEqual([200, 409]);
    const crossList = await createList([{ }]);
    const denial = await fetch(`${baseUrl}/api/payment-lists/${crossList.id}/confrontation/${result.id}/decision`, { method: "PATCH", headers: auth(), body: JSON.stringify({ decision: "reject_item", notes: "Tentativa cruzada" }) });
    expect(denial.status).toBe(404);
    expect(first.sequence).toBe(1);
  });

  it("LIST-RECTIFICATION-LINEAGE-01: reuses canonical rectification and records its real lineage", async () => {
    const entry = await createEntry({ amount: "500.00" });
    const list = await createList([{ amount: "420.00" }]);
    const run = await (await confront(list.id)).json();
    const result = run.results.find((row: any) => row.paymentListItemId);
    const response = await fetch(`${baseUrl}/api/payment-lists/${list.id}/confrontation/${result.id}/decision`, { method: "PATCH", headers: auth(), body: JSON.stringify({ decision: "request_rectification", notes: "Falha técnica confirmada" }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    const original = await prisma.weeklogEntry.findUniqueOrThrow({ where: { id: entry.id } });
    const order = await prisma.productionOrder.findUniqueOrThrow({ where: { id: original.productionOrderId! } });
    expect(order).toMatchObject({ status: "in_production", executionSequence: 2, rectificationOriginId: entry.id });
    expect(body.result).toMatchObject({ decision: "request_rectification", reopenedProductionOrderId: order.id, targetExecutionSequence: 2 });
    expect(original.validationStatus).toBe("rectification_requested");
    const retry = await fetch(`${baseUrl}/api/payment-lists/${list.id}/confrontation/${result.id}/decision`, { method: "PATCH", headers: auth(), body: JSON.stringify({ decision: "request_rectification", notes: "Falha técnica confirmada" }) });
    expect(retry.status).toBe(200);
    expect((await prisma.productionOrder.findUniqueOrThrow({ where: { id: order.id } })).executionSequence).toBe(2);
  });

  it("RECT-LIST-CONCURRENT-01: concurrent rectification requests converge to one canonical rework", async () => {
    const entry = await createEntry({ amount: "500.00" });
    const list = await createList([{ amount: "420.00" }]);
    const run = await (await confront(list.id)).json();
    const result = run.results.find((row: any) => row.paymentListItemId);
    const request = () => fetch(`${baseUrl}/api/payment-lists/${list.id}/confrontation/${result.id}/decision`, { method: "PATCH", headers: auth(), body: JSON.stringify({ decision: "request_rectification", notes: "Retrabalho concorrente" }) });
    const [left, right] = await Promise.all([request(), request()]);
    expect([left.status, right.status].sort()).toEqual([200, 200]);
    const order = await prisma.productionOrder.findUniqueOrThrow({ where: { id: entry.productionOrderId! } });
    expect(order).toMatchObject({ status: "in_production", executionSequence: 2, rectificationOriginId: entry.id });
    const stored = await prisma.paymentListConfrontationResult.findUniqueOrThrow({ where: { id: result.id } });
    expect(stored).toMatchObject({ decision: "request_rectification", reopenedProductionOrderId: order.id, targetExecutionSequence: 2 });
  });

  it("RECT-LIST-EXTERNAL-SOURCE-01: external operational evidence cannot fabricate a ProductionOrder", async () => {
    const entry = await createExternalEntry();
    const list = await createList([{ amount: "420.00" }]);
    const run = await (await confront(list.id)).json();
    const result = run.results.find((row: any) => row.paymentListItemId);
    const before = await prisma.productionOrder.count({ where: { workspaceId: fixture.workspaceId } });
    const response = await fetch(`${baseUrl}/api/payment-lists/${list.id}/confrontation/${result.id}/decision`, { method: "PATCH", headers: auth(), body: JSON.stringify({ decision: "request_rectification", notes: "Sem OP de origem" }) });
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("EXTERNAL_ENTRY_CANNOT_RECTIFY_PO");
    expect(await prisma.productionOrder.count({ where: { workspaceId: fixture.workspaceId } })).toBe(before);
    expect(await prisma.paymentListConfrontationResult.findUniqueOrThrow({ where: { id: result.id } })).toMatchObject({ decision: "none", reopenedProductionOrderId: null });
    expect(entry.productionOrderId).toBeNull();
  });

  it("RECT-LIST-ROLLBACK-01: failure after canonical rework rolls back both domains", async () => {
    const entry = await createEntry({ amount: "500.00" });
    const list = await createList([{ amount: "420.00" }]);
    const run = await (await confront(list.id)).json();
    const result = run.results.find((row: any) => row.paymentListItemId);
    const before = await prisma.productionOrder.findUniqueOrThrow({ where: { id: entry.productionOrderId! } });
    setAfterRectificationTestHook(() => { throw new Error("TEST_RECTIFICATION_ROLLBACK"); });
    try {
      const response = await fetch(`${baseUrl}/api/payment-lists/${list.id}/confrontation/${result.id}/decision`, { method: "PATCH", headers: auth(), body: JSON.stringify({ decision: "request_rectification", notes: "Falha injetada" }) });
      expect(response.status).toBe(500);
    } finally { setAfterRectificationTestHook(undefined); }
    expect(await prisma.productionOrder.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({ status: before.status, executionSequence: before.executionSequence, rectificationOriginId: before.rectificationOriginId });
    expect(await prisma.paymentListConfrontationResult.findUniqueOrThrow({ where: { id: result.id } })).toMatchObject({ decision: "none", reopenedProductionOrderId: null, targetExecutionSequence: null });
  });

  it("RECT-LIST-STALE-ENTRY-01: delegates stale execution rejection without partial commercial mutation", async () => {
    const entry = await createEntry({ amount: "500.00" });
    const list = await createList([{ amount: "420.00" }]);
    const run = await (await confront(list.id)).json(); const result = run.results.find((row: any) => row.paymentListItemId);
    await prisma.productionOrder.update({ where: { id: entry.productionOrderId! }, data: { executionSequence: 2 } });
    const response = await fetch(`${baseUrl}/api/payment-lists/${list.id}/confrontation/${result.id}/decision`, { method: "PATCH", headers: auth(), body: JSON.stringify({ decision: "request_rectification", notes: "Entrada histórica" }) });
    expect(response.status).toBe(409);
    expect((await prisma.paymentListConfrontationResult.findUniqueOrThrow({ where: { id: result.id } })).decision).toBe("none");
  });

  it("RECT-LIST-CROSS-TENANT-01: denies a foreign workspace actor without mutating commercial or operational state", async () => {
    const entry = await createEntry({ amount: "500.00" });
    const list = await createList([{ amount: "420.00" }]);
    const run = await (await confront(list.id)).json(); const result = run.results.find((row: any) => row.paymentListItemId);
    const beforeOrder = await prisma.productionOrder.findUniqueOrThrow({ where: { id: entry.productionOrderId! }, select: { status: true, executionSequence: true, rectificationOriginId: true } });
    const beforeResult = await prisma.paymentListConfrontationResult.findUniqueOrThrow({ where: { id: result.id }, select: { decision: true, decidedBy: true, decidedAt: true, reopenedProductionOrderId: true, targetExecutionSequence: true } });
    const claim = await prisma.paymentListEntryClaim.findFirstOrThrow({ where: { workspaceId: fixture.workspaceId, paymentListId: list.id, weeklogEntryId: entry.id }, select: { status: true, releasedAt: true, releasedReason: true } });
    const response = await fetch(`${baseUrl}/api/payment-lists/${list.id}/confrontation/${result.id}/decision`, { method: "PATCH", headers: auth(fixture.foreign.owner, fixture.foreign.workspaceId), body: JSON.stringify({ decision: "request_rectification", notes: "Acesso entre tenants" }) });
    expect(response.status).toBe(404);
    await expect(prisma.productionOrder.findUniqueOrThrow({ where: { id: entry.productionOrderId! }, select: { status: true, executionSequence: true, rectificationOriginId: true } })).resolves.toEqual(beforeOrder);
    await expect(prisma.paymentListConfrontationResult.findUniqueOrThrow({ where: { id: result.id }, select: { decision: true, decidedBy: true, decidedAt: true, reopenedProductionOrderId: true, targetExecutionSequence: true } })).resolves.toEqual(beforeResult);
    await expect(prisma.paymentListEntryClaim.findFirstOrThrow({ where: { workspaceId: fixture.workspaceId, paymentListId: list.id, weeklogEntryId: entry.id }, select: { status: true, releasedAt: true, releasedReason: true } })).resolves.toEqual(claim);
  });

  it("RECT-LIST-LINEAGE-RECOVERY-01: completes a T07 decision missing its T08 lineage exactly once", async () => {
    const entry = await createEntry({ amount: "500.00" });
    const list = await createList([{ amount: "420.00" }]);
    const run = await (await confront(list.id)).json(); const result = run.results.find((row: any) => row.paymentListItemId);
    await prisma.paymentListConfrontationResult.update({ where: { id: result.id }, data: { decision: "request_rectification", notes: "Recuperar linhagem", decidedBy: fixture.owner.id, decidedAt: new Date() } });
    const response = await fetch(`${baseUrl}/api/payment-lists/${list.id}/confrontation/${result.id}/decision`, { method: "PATCH", headers: auth(), body: JSON.stringify({ decision: "request_rectification", notes: "Recuperar linhagem" }) });
    expect(response.status).toBe(200);
    const order = await prisma.productionOrder.findUniqueOrThrow({ where: { id: entry.productionOrderId! } });
    expect(order.executionSequence).toBe(2);
    expect(await prisma.paymentListConfrontationResult.findUniqueOrThrow({ where: { id: result.id } })).toMatchObject({ reopenedProductionOrderId: order.id, targetExecutionSequence: 2 });
  });

  it("RECT-LIST-LINEAGE-RECOVERY-01 / CASE B: recovers an already canonical rectification without another execution", async () => {
    const entry = await createEntry({ amount: "500.00" });
    const list = await createList([{ amount: "420.00" }]);
    const run = await (await confront(list.id)).json(); const result = run.results.find((row: any) => row.paymentListItemId);
    const payload = { decision: "request_rectification", notes: "Recuperar linhagem materializada" };
    expect((await fetch(`${baseUrl}/api/payment-lists/${list.id}/confrontation/${result.id}/decision`, { method: "PATCH", headers: auth(), body: JSON.stringify(payload) })).status).toBe(200);
    const beforeRetry = await prisma.productionOrder.findUniqueOrThrow({ where: { id: entry.productionOrderId! } });
    expect(beforeRetry).toMatchObject({ status: "in_production", executionSequence: 2, rectificationOriginId: entry.id });
    await prisma.paymentListConfrontationResult.update({ where: { id: result.id }, data: { reopenedProductionOrderId: null, targetExecutionSequence: null } });
    const response = await fetch(`${baseUrl}/api/payment-lists/${list.id}/confrontation/${result.id}/decision`, { method: "PATCH", headers: auth(), body: JSON.stringify(payload) });
    expect(response.status).toBe(200);
    const afterRetry = await prisma.productionOrder.findUniqueOrThrow({ where: { id: entry.productionOrderId! } });
    expect(afterRetry.executionSequence).toBe(2);
    expect(await prisma.paymentListConfrontationResult.findUniqueOrThrow({ where: { id: result.id } })).toMatchObject({ reopenedProductionOrderId: afterRetry.id, targetExecutionSequence: 2 });
    expect(await prisma.paymentListEntryClaim.findFirstOrThrow({ where: { workspaceId: fixture.workspaceId, paymentListId: list.id, weeklogEntryId: entry.id } })).toMatchObject({ status: "reserved" });
    expect((await prisma.paymentList.findUniqueOrThrow({ where: { id: list.id } })).status).toBe("confronted");
  });

  it("RECT-LIST-LINEAGE-RECOVERY-01 / CASE C: rejects a foreign rectification origin without repairing it", async () => {
    const entry = await createEntry({ amount: "500.00" });
    const list = await createList([{ amount: "420.00" }]);
    const run = await (await confront(list.id)).json(); const result = run.results.find((row: any) => row.paymentListItemId && row.weeklogEntryId);
    expect(result).toBeDefined();
    const conflictingEntry = await createEntry({ amount: "700.00" });
    const sourceEntry = await prisma.weeklogEntry.findUniqueOrThrow({ where: { id: result.weeklogEntryId } });
    const foreignOrigin = sourceEntry.id === entry.id ? conflictingEntry : entry;
    await prisma.paymentListConfrontationResult.update({ where: { id: result.id }, data: { decision: "request_rectification", notes: "Conflito de linhagem", decidedBy: fixture.owner.id, decidedAt: new Date() } });
    await prisma.productionOrder.update({ where: { id: sourceEntry.productionOrderId! }, data: { status: "in_production", executionSequence: 2, rectificationOriginId: foreignOrigin.id } });
    const beforeOrder = await prisma.productionOrder.findUniqueOrThrow({ where: { id: sourceEntry.productionOrderId! }, select: { executionSequence: true, rectificationOriginId: true } });
    const beforeClaim = await prisma.paymentListEntryClaim.findFirstOrThrow({ where: { workspaceId: fixture.workspaceId, paymentListId: list.id, weeklogEntryId: sourceEntry.id }, select: { status: true, releasedAt: true, releasedReason: true } });
    const response = await fetch(`${baseUrl}/api/payment-lists/${list.id}/confrontation/${result.id}/decision`, { method: "PATCH", headers: auth(), body: JSON.stringify({ decision: "request_rectification", notes: "Conflito de linhagem" }) });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("RECTIFICATION_LINEAGE_CONFLICT");
    await expect(prisma.productionOrder.findUniqueOrThrow({ where: { id: sourceEntry.productionOrderId! }, select: { executionSequence: true, rectificationOriginId: true } })).resolves.toEqual(beforeOrder);
    expect(await prisma.paymentListConfrontationResult.findUniqueOrThrow({ where: { id: result.id } })).toMatchObject({ reopenedProductionOrderId: null, targetExecutionSequence: null });
    await expect(prisma.paymentListEntryClaim.findFirstOrThrow({ where: { workspaceId: fixture.workspaceId, paymentListId: list.id, weeklogEntryId: sourceEntry.id }, select: { status: true, releasedAt: true, releasedReason: true } })).resolves.toEqual(beforeClaim);
  });
});
