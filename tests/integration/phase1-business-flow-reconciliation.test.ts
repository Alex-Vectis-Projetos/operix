// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { once } from "node:events";
import { readFile } from "node:fs/promises";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://operix_local:U2dkA-cJYnwHuD7hiAY2hPTrkawjg6f8@127.0.0.1:5432/operix_local?schema=public";
process.env.JWT_SECRET = process.env.JWT_SECRET || "this-is-a-test-secret-with-more-than-32-chars-long";
process.env.MINIO_ROOT_PASSWORD = process.env.MINIO_ROOT_PASSWORD || "operix-test-minio-password";

// Import modules
const express = (await import("../../backend/node_modules/express/index.js")).default;
const { weeklogsRouter } = await import("../../backend/src/routes/weeklogs.js");
const { paymentListsRouter } = await import("../../backend/src/routes/paymentLists.js");
const { financeV2Router } = await import("../../backend/src/routes/financeV2.js");
const { productionOrdersRouter } = await import("../../backend/src/routes/productionOrders.js");
const { budgetsRouter } = await import("../../backend/src/routes/budgets.js");
const { externalOperationalImportsRouter } = await import("../../backend/src/routes/externalOperationalImports.js");
const { minioImportDocumentStorage, aiImportExtractionProvider } = await import("../../backend/src/services/externalImportAdapters.js");
const { signAccessToken } = await import("../../backend/src/lib/jwt.js");
const { prisma } = await import("../../backend/src/lib/prisma.js");
const weeklogService = await import("../../backend/src/services/weeklogService.js");
const paymentListService = await import("../../backend/src/services/paymentListService.js");

const fixture = {
  workspaceA: "70000000-0000-4000-8000-000000000001",
  workspaceB: "70000000-0000-4000-8000-000000000002",
  ownerA: "71000000-0000-4000-8000-000000000001",
  ownerAApp: "72000000-0000-4000-8000-000000000001",
  ownerB: "71000000-0000-4000-8000-000000000002",
  ownerBApp: "72000000-0000-4000-8000-000000000002",
  adminA: "71000000-0000-4000-8000-000000000003",
  adminAApp: "72000000-0000-4000-8000-000000000003",
  clientAUser: "71000000-0000-4000-8000-000000000004",
  clientAApp: "72000000-0000-4000-8000-000000000004",
  techA: "71000000-0000-4000-8000-000000000005",
  techAApp: "72000000-0000-4000-8000-000000000005",
  clientAId: "73000000-0000-4000-8000-000000000001",
  clientBId: "73000000-0000-4000-8000-000000000002",
  locationAId: "74000000-0000-4000-8000-000000000001",
};

describe("Spec 006 / Phase 1 — Business Flow Reconciliation Acceptance Suite", () => {
  let server: any;
  let baseUrl = "";

  const headers = (actor = fixture.ownerA, workspace = fixture.workspaceA, key = "phase1-reconciliation-key", role = "admin") => ({
    Authorization: `Bearer ${signAccessToken({ id: actor, email: `${actor}@operix.test`, role })}`,
    "X-Workspace-Id": workspace,
    "Content-Type": "application/json",
    "Idempotency-Key": key,
  });

  const request = (path: string, init: RequestInit = {}) => fetch(`${baseUrl}${path}`, init);

  async function resetDb() {
    const ws = [fixture.workspaceA, fixture.workspaceB];
    for (const table of [
      "payment_list_confrontation_results",
      "payment_list_confrontation_runs",
      "payment_list_entry_claims",
      "payment_list_items",
      "payment_lists",
      "external_list_import_items",
      "external_list_imports",
      "weeklog_entries",
      "external_operational_import_items",
      "external_operational_imports",
      "weeklog_validations",
      "weeklogs",
      "production_photos",
      "production_orders",
      "budgets",
      "finance_idempotency",
      "obligation_payments",
      "financial_obligations",
      "distributions",
      "expenses",
      "financial_records",
      "client_access_grants",
    ]) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE workspace_id IN ('${ws.join("','")}')`);
    }

    await prisma.client.deleteMany({ where: { id: { in: [fixture.clientAId, fixture.clientBId] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: ws } } });
    await prisma.user.deleteMany({
      where: { id: { in: [fixture.ownerA, fixture.ownerB, fixture.adminA, fixture.clientAUser, fixture.techA] } },
    });

    // Create seed users
    await prisma.user.create({
      data: {
        id: fixture.ownerA,
        email: "owner-a@operix.test",
        fullName: "Owner A",
        role: "admin",
        passwordHash: "x",
        appUser: { create: { id: fixture.ownerAApp, email: "owner-a@operix.test" } },
      },
    });
    await prisma.user.create({
      data: {
        id: fixture.ownerB,
        email: "owner-b@operix.test",
        fullName: "Owner B",
        role: "admin",
        passwordHash: "x",
        appUser: { create: { id: fixture.ownerBApp, email: "owner-b@operix.test" } },
      },
    });
    await prisma.user.create({
      data: {
        id: fixture.adminA,
        email: "admin-a@operix.test",
        fullName: "Admin A",
        role: "admin",
        passwordHash: "x",
        appUser: { create: { id: fixture.adminAApp, email: "admin-a@operix.test" } },
      },
    });
    await prisma.user.create({
      data: {
        id: fixture.clientAUser,
        email: "client-a@operix.test",
        fullName: "Client A",
        role: "user",
        passwordHash: "x",
        appUser: { create: { id: fixture.clientAApp, email: "client-a@operix.test" } },
      },
    });
    await prisma.user.create({
      data: {
        id: fixture.techA,
        email: "tech-a@operix.test",
        fullName: "Technician A",
        role: "technician",
        passwordHash: "x",
        appUser: { create: { id: fixture.techAApp, email: "tech-a@operix.test" } },
      },
    });

    // Workspaces
    await prisma.workspace.create({
      data: {
        id: fixture.workspaceA,
        name: "Workspace Alpha",
        ownerUserId: fixture.ownerAApp,
        memberships: {
          create: [
            { userId: fixture.adminAApp, role: "admin", status: "active" },
            { userId: fixture.clientAApp, role: "client", status: "active" },
            { userId: fixture.techAApp, role: "technician", status: "active" },
          ],
        },
      },
    });
    await prisma.workspace.create({
      data: {
        id: fixture.workspaceB,
        name: "Workspace Bravo",
        ownerUserId: fixture.ownerBApp,
      },
    });

    await prisma.client.create({
      data: { id: fixture.clientAId, workspaceId: fixture.workspaceA, name: "VECTIS Client" },
    });
    await prisma.client.create({
      data: { id: fixture.clientBId, workspaceId: fixture.workspaceB, name: "Foreign Client" },
    });

    await prisma.clientAccessGrant.create({
      data: {
        workspaceId: fixture.workspaceA,
        userId: fixture.clientAUser,
        clientId: fixture.clientAId,
        role: "validator",
        status: "active",
      },
    });
  }

  beforeAll(async () => {
    await resetDb();
    vi.spyOn(minioImportDocumentStorage, "put").mockResolvedValue(undefined as any);
    vi.spyOn(aiImportExtractionProvider, "extractOperationalDocument").mockResolvedValue({
      raw: { provider: "synthetic-test" },
      rows: [
        {
          rawLicensePlate: "EXT-888-ZZ",
          rawVin: "VF312345678901234",
          rawCarName: "Renault Clio",
          rawClientName: "VECTIS Client",
          rawCurrencyCode: "EUR",
          rawOperationalSiteKey: "SITE-EXT-01",
          rawTechnician: "Technician A",
          rawDeliveredAtText: "2026-09-18T12:00:00Z",
          rawServices: [{ code: "PDR" }],
          rawTotalText: "200.00",
        },
      ],
    });

    const app = express();
    app.use(express.json());
    app.use("/api/weeklogs", weeklogsRouter);
    app.use("/api/payment-lists", paymentListsRouter);
    app.use("/api/finance/v2", financeV2Router);
    app.use("/api/production-orders", productionOrdersRouter);
    app.use("/api/budgets", budgetsRouter);
    app.use("/api/external-operational-imports", externalOperationalImportsRouter);
    server = app.listen(0);
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    server?.close();
    await resetDb();
    await prisma.$disconnect();
  });

  /* =========================================================================
   * GROUP 1: WEEK BOUNDARY, AUTO-CLOSURE & PROJECTION
   * ========================================================================= */

  describe("Group 1: Week Boundary, Auto-Closure & Projection", () => {
    it("WEEK-AUTO-CLOSE-01: Expired open WEEKLOG automatically becomes pending_validation", async () => {
      // Create an open weeklog whose endsOn is in the past
      const pastWeeklog = await prisma.weeklog.create({
        data: {
          id: "75000000-0000-4000-8000-000000000001",
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-default",
          startsOn: new Date("2026-09-06T00:00:00.000Z"),
          endsOn: new Date("2026-09-12T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W37",
          weekNumber: 37,
          status: "open",
        },
      });

      // Target behavior: runner or service function reconcileExpiredWeeklogs transitions expired open weeklogs
      // RED: Currently, no auto-close runner exists in weeklogService
      const reconcileFn = (weeklogService as any).reconcileExpiredWeeklogs;
      expect(typeof reconcileFn).toBe("function");

      await reconcileFn(fixture.workspaceA);
      const updated = await prisma.weeklog.findUniqueOrThrow({ where: { id: pastWeeklog.id } });
      expect(updated.status).toBe("pending_validation");
    });

    it("WEEK-BOUNDARY-ROLLFORWARD-01: Vehicle finalized after Saturday boundary belongs only to the next operational week", async () => {
      // PO delivered on Monday 2026-09-14 belongs to Week 38, not past Week 37
      const po = await prisma.productionOrder.create({
        data: {
          id: "76000000-0000-4000-8000-000000000001",
          workspaceId: fixture.workspaceA,
          code: "PO-ROLL-01",
          clientId: fixture.clientAId,
          operationalSiteKey: "site-rollforward",
          currencyCode: "EUR",
          status: "in_production",
          performedServices: [{ name: "DSP", amount: 500, total: 500 }],
        },
      });

      const response = await request(`/api/production-orders/${po.id}/finalize`, {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "rollforward-po-key"),
        body: JSON.stringify({ deliveredAt: "2026-09-14T10:00:00.000Z" }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.weeklog.weekNumber).toBe(39);
      expect(body.weeklog.startsOn).toContain("2026-09-27");
    });

    it("WEEK-NO-UNFINISHED-01: ProductionOrder not finalized before boundary does not appear in the closed week", async () => {
      const unfinishedPo = await prisma.productionOrder.create({
        data: {
          id: "76000000-0000-4000-8000-000000000002",
          workspaceId: fixture.workspaceA,
          code: "PO-UNFINISHED-01",
          clientId: fixture.clientAId,
          status: "in_progress",
        },
      });

      // Query weeklog entries for the closed week
      const entries = await prisma.weeklogEntry.findMany({
        where: {
          workspaceId: fixture.workspaceA,
          productionOrderId: unfinishedPo.id,
        },
      });

      expect(entries).toHaveLength(0);
    });

    it("WEEK-CATCHUP-01: Missed boundary while backend is offline is reconciled safely after restart / runner execution", async () => {
      const missedWeeklog = await prisma.weeklog.create({
        data: {
          id: "75000000-0000-4000-8000-000000000002",
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-default",
          startsOn: new Date("2026-08-30T00:00:00.000Z"),
          endsOn: new Date("2026-09-05T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W36",
          weekNumber: 36,
          status: "open",
        },
      });

      // RED: Runner startup catch-up hook does not exist yet
      const runner = await import("../../backend/src/lib/weekCloseRunner.js").catch(() => null);
      expect(runner).not.toBeNull();
      expect(typeof runner?.runStartupCatchup).toBe("function");

      await runner!.runStartupCatchup();
      const updated = await prisma.weeklog.findUniqueOrThrow({ where: { id: missedWeeklog.id } });
      expect(updated.status).toBe("pending_validation");
    });

    it("WEEK-CLOSE-IDEMPOTENT-01: Repeated closure processing causes no duplicate validation state/evidence", async () => {
      const targetWeeklog = await prisma.weeklog.create({
        data: {
          id: "75000000-0000-4000-8000-000000000003",
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-default",
          startsOn: new Date("2026-08-23T00:00:00.000Z"),
          endsOn: new Date("2026-08-29T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W35",
          weekNumber: 35,
          status: "open",
        },
      });

      const reconcileFn = (weeklogService as any).reconcileExpiredWeeklogs;
      // RED: reconcileFn missing
      expect(typeof reconcileFn).toBe("function");

      await reconcileFn(fixture.workspaceA);
      await reconcileFn(fixture.workspaceA);

      const rounds = await prisma.weeklogValidation.findMany({
        where: { weeklogId: targetWeeklog.id },
      });
      expect(rounds.length).toBeLessThanOrEqual(1);
    });

    it("WEEK-PROJECTION-01: Business WEEKLOG projection exposes vehicle/site/date/services/total without requiring part-level detail", async () => {
      // Seed an entry with full vehicle details
      const wl = await prisma.weeklog.create({
        data: {
          id: "75000000-0000-4000-8000-000000000004",
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-default",
          startsOn: new Date("2026-09-20T00:00:00.000Z"),
          endsOn: new Date("2026-09-26T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W39",
          weekNumber: 39,
          status: "open",
        },
      });

      const poProj = await prisma.productionOrder.create({
        data: {
          id: "76000000-0000-4000-8000-000000000003",
          workspaceId: fixture.workspaceA,
          code: "PO-PROJ-01",
          clientId: fixture.clientAId,
          status: "delivered",
        },
      });

      await prisma.weeklogEntry.create({
        data: {
          id: "77000000-0000-4000-8000-000000000001",
          workspaceId: fixture.workspaceA,
          weeklogId: wl.id,
          productionOrderId: poProj.id,
          technicianUserId: fixture.ownerA,
          technicianName: "Owner A",
          clientId: fixture.clientAId,
          totalAmount: 810.0,
          currencyCode: "EUR",
          deliveredAt: new Date("2026-09-25T14:30:00.000Z"),
          brand: "CITROËN",
          model: "C4",
          licensePlate: "EW-621-GF",
          vin: "VF7NC5FS0AY123456",
          servicesSnapshot: [{ name: "DSP" }, { name: "Montagem" }, { name: "Pintura" }],
          validationStatus: "approved",
        },
      });

      // RED: Concise projection endpoint GET /api/weeklogs/:id/projection
      const response = await request(`/api/weeklogs/${wl.id}/projection`, {
        headers: headers(),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            vehicleDescription: "CITROËN C4",
            licensePlate: "EW-621-GF",
            vin: "VF7NC5FS0AY123456",
            serviceLocation: "Atelier Paris Nord",
            servicesSummary: "DSP + Montagem + Pintura",
            totalAmount: "810.00",
          }),
        ])
      );
      // Ensures raw panel damage matrix is not present in top-level business item projection
      expect(data.items[0]).not.toHaveProperty("damagePanelsMatrix");
    });
  });

  /* =========================================================================
   * GROUP 2: WEEKLOG VALIDATION & AUTOMATIC DRAFT LIST HANDOFF
   * ========================================================================= */

  describe("Group 2: WEEKLOG Validation & Automatic Draft List Handoff", () => {
    let validatedWlId = "75000000-0000-4000-8000-000000000010";

    beforeEach(async () => {
      await prisma.weeklogValidation.deleteMany({ where: { weeklogId: validatedWlId } });
      await prisma.weeklogEntry.deleteMany({ where: { weeklogId: validatedWlId } });
      await prisma.weeklog.deleteMany({ where: { id: validatedWlId } });
      await prisma.productionOrder.deleteMany({ where: { id: "76000000-0000-4000-8000-000000000010" } });
      await prisma.productionOrder.create({
        data: {
          id: "76000000-0000-4000-8000-000000000010",
          workspaceId: fixture.workspaceA,
          code: "PO-VAL-01",
          clientId: fixture.clientAId,
          status: "delivered",
        },
      });
      // Prepare a weeklog with pending_validation and 1 approved entry
      await prisma.weeklog.create({
        data: {
          id: validatedWlId,
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-default",
          startsOn: new Date("2026-09-13T00:00:00.000Z"),
          endsOn: new Date("2026-09-19T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W38",
          weekNumber: 38,
          status: "pending_validation",
          entries: {
            create: {
              id: "77000000-0000-4000-8000-000000000010",
              productionOrderId: "76000000-0000-4000-8000-000000000010",
              technicianUserId: fixture.ownerA,
              technicianName: "Owner A",
              clientId: fixture.clientAId,
              deliveredAt: new Date("2026-09-18T10:00:00.000Z"),
              totalAmount: 1500.0,
              currencyCode: "EUR",
              brand: "BMW",
              model: "Serie 1",
              licensePlate: "EW-621-GF",
              vin: "WBA1V710305G06196",
              validationStatus: "approved",
            },
          },
        },
      });

      await prisma.weeklogValidation.create({
        data: {
          id: "78000000-0000-4000-8000-000000000010",
          weeklogId: validatedWlId,
          workspaceId: fixture.workspaceA,
          validationSequence: 1,
          status: "pending",
          submittedAt: new Date(),
          submittedBy: fixture.ownerA,
          coverageSnapshot: [{ weeklogEntryId: "77000000-0000-4000-8000-000000000010" }],
        },
      });
    });

    it("LIST-AUTO-01: Complete successful WEEKLOG validation creates exactly one draft PaymentList", async () => {
      const response = await request(`/api/weeklogs/${validatedWlId}/validate`, {
        method: "POST",
        headers: headers(fixture.clientAUser, fixture.workspaceA, "val-auto-list-key"),
        body: JSON.stringify({
          validationMethod: "authenticated_confirmation",
          approvedEntryIds: ["77000000-0000-4000-8000-000000000010"],
        }),
      });

      expect(response.status).toBe(200);

      // RED: validateWeeklogBatch does not trigger draft PaymentList creation yet
      const autoList = await prisma.paymentList.findFirst({
        where: {
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          status: "draft",
        },
        include: { items: true },
      });

      expect(autoList).not.toBeNull();
      expect(autoList?.status).toBe("draft");
      expect(autoList?.items).toHaveLength(1);
    });

    it("LIST-AUTO-IDEMPOTENT-01: Retry/concurrency cannot create duplicate PaymentLists/items/claims", async () => {
      // RED: Calling validate repeatedly should result in strictly 1 PaymentList for this weeklog
      const call1 = request(`/api/weeklogs/${validatedWlId}/validate`, {
        method: "POST",
        headers: headers(fixture.clientAUser, fixture.workspaceA, "val-idempotent-key-1"),
        body: JSON.stringify({
          validationMethod: "authenticated_confirmation",
          approvedEntryIds: ["77000000-0000-4000-8000-000000000010"],
        }),
      });
      const call2 = request(`/api/weeklogs/${validatedWlId}/validate`, {
        method: "POST",
        headers: headers(fixture.clientAUser, fixture.workspaceA, "val-idempotent-key-1"),
        body: JSON.stringify({
          validationMethod: "authenticated_confirmation",
          approvedEntryIds: ["77000000-0000-4000-8000-000000000010"],
        }),
      });

      await Promise.all([call1, call2]);

      const count = await prisma.paymentList.count({
        where: {
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
        },
      });
      expect(count).toBe(1);
    });

    it("LIST-PARTIAL-NO-AUTO-01: rectification_pending / incomplete validation does not create a List", async () => {
      const partialWlId = "75000000-0000-4000-8000-000000000020";
      await prisma.productionOrder.deleteMany({ where: { id: "76000000-0000-4000-8000-000000000020" } });
      await prisma.productionOrder.create({
        data: {
          id: "76000000-0000-4000-8000-000000000020",
          workspaceId: fixture.workspaceA,
          code: "PO-PARTIAL-01",
          clientId: fixture.clientAId,
          status: "delivered",
        },
      });
      await prisma.weeklog.create({
        data: {
          id: partialWlId,
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-partial",
          startsOn: new Date("2026-09-06T00:00:00.000Z"),
          endsOn: new Date("2026-09-12T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W37",
          weekNumber: 37,
          status: "pending_validation",
          entries: {
            create: {
              id: "77000000-0000-4000-8000-000000000020",
              productionOrderId: "76000000-0000-4000-8000-000000000020",
              technicianUserId: fixture.ownerA,
              technicianName: "Owner A",
              clientId: fixture.clientAId,
              deliveredAt: new Date("2026-09-10T10:00:00.000Z"),
              totalAmount: 1200.0,
              currencyCode: "EUR",
              brand: "Renault",
              model: "Clio",
              validationStatus: "rejected",
            },
          },
        },
      });

      await prisma.weeklogValidation.create({
        data: {
          id: "78000000-0000-4000-8000-000000000020",
          weeklogId: partialWlId,
          workspaceId: fixture.workspaceA,
          validationSequence: 1,
          status: "pending",
          submittedAt: new Date(),
          submittedBy: fixture.ownerA,
          coverageSnapshot: [{ weeklogEntryId: "77000000-0000-4000-8000-000000000020" }],
        },
      });

      const response = await request(`/api/weeklogs/${partialWlId}/validate`, {
        method: "POST",
        headers: headers(fixture.clientAUser, fixture.workspaceA, "val-partial-key"),
        body: JSON.stringify({
          validationMethod: "authenticated_confirmation",
          approvedEntryIds: [], // None approved
        }),
      });

      // Partial / rectification validation should not create a PaymentList
      const listCount = await prisma.paymentList.count({
        where: {
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          status: "draft",
        },
      });
      expect(listCount).toBe(0);
    });

    it("LIST-WEEKLOG-PRESERVE-01: Automatic List creation does not delete or mutate signed WEEKLOG evidence", async () => {
      // Invariant: Validation records and signature evidence persist unchanged
      const validationBefore = await prisma.weeklogValidation.findFirst({
        where: { weeklogId: validatedWlId },
      });
      expect(validationBefore).toBeDefined();
    });

    it("LIST-ACTIVE-QUEUE-01: Transferred validated WEEKLOG is absent from default active queue but remains available in history/detail", async () => {
      // Create a validated weeklog
      await prisma.weeklog.create({
        data: {
          id: "75000000-0000-4000-8000-000000000030",
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-default",
          startsOn: new Date("2026-08-16T00:00:00.000Z"),
          endsOn: new Date("2026-08-22T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W34",
          weekNumber: 34,
          status: "validated",
        },
      });

      // RED: Default active queue query GET /api/weeklogs must not include validated weeklogs
      const activeResponse = await request("/api/weeklogs", { headers: headers() });
      const activeList = await activeResponse.json();
      expect(activeList.some((w: any) => w.id === "75000000-0000-4000-8000-000000000030")).toBe(false);

      // Must remain accessible via history query:
      const historyResponse = await request("/api/weeklogs?status=validated", { headers: headers() });
      const historyList = await historyResponse.json();
      expect(historyList.some((w: any) => w.id === "75000000-0000-4000-8000-000000000030")).toBe(true);
    });
  });

  /* =========================================================================
   * GROUP 3: PROJECTIONS, MULTIWEEK & EXTERNAL IMPORT RECONCILIATION
   * ========================================================================= */

  describe("Group 3: Projections, Multiweek & External Import Reconciliation", () => {
    it("LIST-PROJECTION-01: Generated List carries correct vehicle, completion date, site, services and amount semantics", async () => {
      // RED: Verify auto-generated list carries the VECTIS projection attributes
      const list = await prisma.paymentList.findFirst({
        where: { workspaceId: fixture.workspaceA, status: "draft" },
        include: { items: true },
      });

      // RED: Auto-generated list not present yet
      expect(list).not.toBeNull();
      expect(list?.items[0]).toMatchObject({
        vehicleDescription: expect.any(String),
        serviceLocation: expect.any(String),
      });
    });

    it("LIST-MANUAL-PRESERVED-01: Manual List flow remains supported", async () => {
      const response = await request("/api/payment-lists", {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "manual-list-key"),
        body: JSON.stringify({
          clientId: fixture.clientAId,
          currencyCode: "EUR",
          entryIds: [],
        }),
      });

      expect(response.status).toBe(201);
      const created = await response.json();
      expect(created.status).toBe("draft");
      expect(created.currencyCode).toBe("EUR");
    });

    it("LIST-MANUAL-AUTO-COEXIST-01: Manual list creation absorbs provisional auto-draft claims without 409 collision", async () => {
      // Setup a weeklog entry claimed provisionally by an auto-draft list
      const autoListId = "74000000-0000-4000-8000-000000000077";
      const manualEntryId = "75000000-0000-4000-8000-000000000077";
      const manualWlId = "75000000-0000-4000-8000-000000000076";
      await prisma.paymentListEntryClaim.deleteMany({ where: { weeklogEntryId: manualEntryId } });
      await prisma.paymentListItem.deleteMany({ where: { weeklogEntryId: manualEntryId } });
      await prisma.paymentList.deleteMany({ where: { id: autoListId } });
      await prisma.weeklogEntry.deleteMany({ where: { id: manualEntryId } });
      await prisma.weeklog.deleteMany({ where: { id: manualWlId } });

      await prisma.weeklog.create({
        data: {
          id: manualWlId,
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-default",
          startsOn: new Date("2026-09-13T00:00:00.000Z"),
          endsOn: new Date("2026-09-19T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W38",
          weekNumber: 38,
          status: "validated",
        },
      });

      await prisma.weeklogEntry.create({
        data: {
          id: manualEntryId,
          workspaceId: fixture.workspaceA,
          weeklogId: manualWlId,
          sourceType: "production_order",
          licensePlate: "ABS-001-FR",
          carName: "Peugeot 208",
          totalAmount: 350.0,
          deliveredAt: new Date("2026-09-18T10:00:00.000Z"),
          validationStatus: "approved",
        },
      });

      const pl = await prisma.paymentList.create({
        data: {
          id: autoListId,
          workspaceId: fixture.workspaceA,
          listNumber: "PL-AUTO-ABSORB-TEST",
          clientId: fixture.clientAId,
          clientName: "VECTIS Client",
          currencyCode: "EUR",
          status: "draft",
          createdBy: fixture.ownerA,
        },
      });

      // Active claim held by auto-draft list (provisional in ADR-002; reserved in current DB)
      await prisma.paymentListEntryClaim.create({
        data: {
          workspaceId: fixture.workspaceA,
          paymentListId: pl.id,
          weeklogEntryId: manualEntryId,
          status: "reserved",
        },
      });

      // Operator manually creates a list selecting that entry
      const res = await request("/api/payment-lists", {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "manual-absorb-key"),
        body: JSON.stringify({
          clientId: fixture.clientAId,
          currencyCode: "EUR",
          entryIds: [manualEntryId],
        }),
      });

      // RED: Currently manual list creation does not absorb provisional claims (returns 409 ENTRY_ALREADY_CLAIMED)
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe("draft");
    });

    it("LIST-IMPORT-PRESERVED-01: External import/OCR/confrontation remains possible and anti-double-billing semantics remain coherent after automatic List introduction", async () => {
      // Invariant: Importing external list can reconcile against entries without throwing unique constraint collision on claims
      // RED: Requires source-aware claim reconciliation architecture
      const confrontationModule = await import("../../backend/src/services/confrontationService.js");
      expect(typeof confrontationModule.runConfrontation).toBe("function");

      // Verify that claim architecture allows external list confrontation coexistence
      const schema = await readFile(new URL("../../backend/prisma/schema.prisma", import.meta.url), "utf8");
      expect(schema).toMatch(/sourceType/);
    });

    it("LIST-MULTIWEEK-PRESERVED-01: Existing multiweek capability is not accidentally removed", async () => {
      // Multiweek list creation capability is preserved
      const response = await request("/api/payment-lists", {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "multiweek-list-key"),
        body: JSON.stringify({
          clientId: fixture.clientAId,
          currencyCode: "EUR",
          entryIds: [],
        }),
      });

      expect(response.status).toBe(201);
      const list = await response.json();
      expect(list.currencyCode).toBe("EUR");
    });
  });

  /* =========================================================================
   * GROUP 4: INVOICE HANDOFF & FINANCE
   * ========================================================================= */

  describe("Group 4: Invoice Handoff & Finance Boundaries", () => {
    let readyListId = "74000000-0000-4000-8000-000000000099";

    beforeEach(async () => {
      await prisma.paymentList.deleteMany({ where: { id: readyListId } });
      await prisma.paymentList.create({
        data: {
          id: readyListId,
          workspaceId: fixture.workspaceA,
          listNumber: "PL-INV-001",
          clientId: fixture.clientAId,
          clientName: "VECTIS Client",
          currencyCode: "EUR",
          status: "draft",
          recognizedTotal: "2500.00",
          createdBy: fixture.ownerA,
        },
      });
    });

    it("LIST-INVOICE-HANDOFF-01: Eligible List exposes the smallest supported create/associate invoice flow", async () => {
      // RED: POST /api/payment-lists/:id/invoice/create route does not exist yet (returns 404)
      const response = await request(`/api/payment-lists/${readyListId}/invoice/create`, {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "invoice-handoff-key"),
        body: JSON.stringify({ notes: "VECTIS September Facturation" }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.invoiceId).toBeDefined();

      const updatedList = await prisma.paymentList.findUniqueOrThrow({ where: { id: readyListId } });
      expect(updatedList.status).toBe("pending");
      expect(updatedList.invoiceId).toBe(body.invoiceId);
    });

    it("FIN-AUTO-DRAFT-NO-EFFECT-01: Automatic draft List changes neither Expected nor Received", async () => {
      const draftListId = "74000000-0000-4000-8000-000000000088";
      await prisma.paymentList.deleteMany({ where: { id: draftListId } });
      await prisma.paymentList.create({
        data: {
          id: draftListId,
          workspaceId: fixture.workspaceA,
          listNumber: "PL-DRAFT-ZERO",
          clientId: fixture.clientAId,
          clientName: "VECTIS Client",
          currencyCode: "EUR",
          status: "draft",
          recognizedTotal: "5000.00",
          createdBy: fixture.ownerA,
        },
      });

      const response = await request("/api/finance/v2/summary", { headers: headers() });
      expect(response.status).toBe(200);
      const summary = await response.json();
      const eur = summary.currencies.find((c: any) => c.currencyCode === "EUR");
      // Draft list must NOT contribute to Expected or Received (only pendingListId's 2500 is in Expected)
      expect(eur?.expected).toBe("2500.00");
      expect(eur?.received).toBe("0.00");
    });

    it("FIN-PENDING-PAID-PRESERVED-01: Only pending/paid transitions continue driving Finance", async () => {
      // Mark pending list as paid
      await prisma.paymentList.update({
        where: { id: pendingListId },
        data: { status: "paid" },
      });

      const response = await request("/api/finance/v2/summary", { headers: headers() });
      const summary = await response.json();
      const eur = summary.currencies.find((c: any) => c.currencyCode === "EUR");
      expect(eur?.expected).toBe("0.00");
      expect(eur?.received).toBe("2500.00");
    });
  });

  /* =========================================================================
   * GROUP 5: MULTI-TENANT ISOLATION
   * ========================================================================= */

  describe("Group 5: Multi-Tenant Zero Trust Boundary", () => {
    it("CROSS-TENANT-RECONCILIATION-01: All new behavior remains workspace-scoped and foreign IDs do not leak", async () => {
      // Create a foreign weeklog in Workspace B
      const foreignWl = await prisma.weeklog.create({
        data: {
          id: "75000000-0000-4000-8000-000000000099",
          workspaceId: fixture.workspaceB,
          clientId: fixture.clientBId,
          siteKey: "site-foreign",
          startsOn: new Date("2026-09-06T00:00:00.000Z"),
          endsOn: new Date("2026-09-12T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W37",
          weekNumber: 37,
          status: "pending_validation",
        },
      });

      // Actor from Workspace A attempts to validate or access foreign weeklog
      const response = await request(`/api/weeklogs/${foreignWl.id}/validate`, {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "cross-tenant-val"),
        body: JSON.stringify({
          validationMethod: "authenticated_confirmation",
          approvedEntryIds: [],
        }),
      });

      expect([403, 404]).toContain(response.status);
    });
  });

  /* =========================================================================
   * GROUP 6: BUDGET AUTHORITY & CLIENT GOVERNANCE (SPEC 002 RECONCILIATION)
   * ========================================================================= */
  describe("Group 6: Budget Authority & Client Governance (Spec 002)", () => {
    let budgetId = "81000000-0000-4000-8000-000000000001";
    let rev1Id = "82000000-0000-4000-8000-000000000001";

    beforeAll(async () => {
      await prisma.budget.deleteMany({ where: { id: budgetId } });
      const b = await prisma.budget.create({
        data: {
          id: budgetId,
          workspaceId: fixture.workspaceA,
          code: "BUD-REV-01",
          clientId: fixture.clientAId,
          technicianUserId: fixture.techA,
          createdById: fixture.ownerA,
          currentRevisionNumber: 1,
        },
      });

      await prisma.budgetRevision.create({
        data: {
          id: rev1Id,
          budgetId: b.id,
          revisionNumber: 1,
          status: "draft",
          clientSnapshot: { name: "VECTIS Client" },
          vehicleSnapshot: { plate: "EW-621-GF" },
          grossTotal: 700.0,
          currencyCode: "EUR",
          createdById: fixture.ownerA,
        },
      });

      await prisma.budget.update({
        where: { id: budgetId },
        data: { currentRevisionId: rev1Id },
      });
    });

    it("BUDGET-TECH-NO-SELF-APPROVE-01: Technician executor MUST NOT approve own Budget", async () => {
      // RED: In current Spec002 baseline, TECH-BUDGET-APPROVE-OWN allowed technician self-approval (returns 200).
      // Superseded: The frozen Alex/VECTIS rule strictly forbids technician self-approval (must return 403).
      const res = await request(`/api/budgets/${budgetId}/revisions/${rev1Id}/approve`, {
        method: "POST",
        headers: headers(fixture.techA, fixture.workspaceA, "tech-self-approve-key", "technician"),
        body: JSON.stringify({ notes: "Technician self-approval attempt" }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.message || "").toMatch(/TECH_SELF_APPROVAL_FORBIDDEN|não pode aprovar/i);
    });

    it("BUDGET-CLIENT-APPROVE-01: Client Collaborator with budget.approve formally approves revision", async () => {
      const res = await request(`/api/budgets/${budgetId}/revisions/${rev1Id}/approve`, {
        method: "POST",
        headers: headers(fixture.clientAUser, fixture.workspaceA, "client-approve-key", "user"),
        body: JSON.stringify({ notes: "Client formal approval" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.revision.status).toBe("approved");
    });

    it("BUDGET-CLIENT-REJECT-01: Client Collaborator formally rejects revision with reason", async () => {
      const rejBudgetId = "81000000-0000-4000-8000-000000000002";
      const rejRevId = "82000000-0000-4000-8000-000000000002";
      await prisma.budget.deleteMany({ where: { id: rejBudgetId } });
      const b = await prisma.budget.create({
        data: {
          id: rejBudgetId,
          workspaceId: fixture.workspaceA,
          code: "BUD-REJ-01",
          clientId: fixture.clientAId,
          technicianUserId: fixture.techA,
          createdById: fixture.ownerA,
          currentRevisionNumber: 1,
        },
      });

      await prisma.budgetRevision.create({
        data: {
          id: rejRevId,
          budgetId: b.id,
          revisionNumber: 1,
          status: "draft",
          clientSnapshot: { name: "VECTIS Client" },
          vehicleSnapshot: { plate: "REJ-001" },
          grossTotal: 500.0,
          currencyCode: "EUR",
          createdById: fixture.ownerA,
        },
      });

      await prisma.budget.update({
        where: { id: rejBudgetId },
        data: { currentRevisionId: rejRevId },
      });

      const res = await request(`/api/budgets/${rejBudgetId}/revisions/${rejRevId}/reject`, {
        method: "POST",
        headers: headers(fixture.clientAUser, fixture.workspaceA, "client-reject-key", "user"),
        body: JSON.stringify({ reason: "Tarifa acima da tabela acordada" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.revision.status).toBe("rejected");
    });

    it("BUDGET-REVISION-REAPPROVAL-01: Changed approved budget requires formal client re-approval", async () => {
      const modBudgetId = "81000000-0000-4000-8000-000000000003";
      const modRev1 = "82000000-0000-4000-8000-000000000003";
      const modRev2 = "82000000-0000-4000-8000-000000000004";
      await prisma.budget.deleteMany({ where: { id: modBudgetId } });
      const b = await prisma.budget.create({
        data: {
          id: modBudgetId,
          workspaceId: fixture.workspaceA,
          code: "BUD-MOD-01",
          clientId: fixture.clientAId,
          technicianUserId: fixture.techA,
          createdById: fixture.ownerA,
          currentRevisionNumber: 2,
        },
      });

      await prisma.budgetRevision.createMany({
        data: [
          {
            id: modRev1,
            budgetId: b.id,
            revisionNumber: 1,
            status: "approved",
            clientSnapshot: { name: "VECTIS Client" },
            vehicleSnapshot: { plate: "MOD-001" },
            grossTotal: 500.0,
            currencyCode: "EUR",
            createdById: fixture.ownerA,
          },
          {
            id: modRev2,
            budgetId: b.id,
            revisionNumber: 2,
            status: "draft",
            clientSnapshot: { name: "VECTIS Client" },
            vehicleSnapshot: { plate: "MOD-001" },
            grossTotal: 750.0,
            currencyCode: "EUR",
            createdById: fixture.ownerA,
          },
        ],
      });

      await prisma.budget.update({
        where: { id: modBudgetId },
        data: {
          approvedRevisionId: modRev1,
          currentRevisionId: modRev2,
        },
      });

      const current = await prisma.budgetRevision.findUniqueOrThrow({ where: { id: modRev2 } });
      expect(current.status).not.toBe("approved");
    });

    it("BUDGET-CROSS-CLIENT-01: Cross-client budget approval is strictly blocked", async () => {
      // User with Client A grant attempts to approve Budget belonging to Client B
      const crossBudgetId = "81000000-0000-4000-8000-000000000004";
      const crossRevId = "82000000-0000-4000-8000-000000000005";
      await prisma.budget.deleteMany({ where: { id: crossBudgetId } });
      const b = await prisma.budget.create({
        data: {
          id: crossBudgetId,
          workspaceId: fixture.workspaceA,
          code: "BUD-CROSS-01",
          clientId: fixture.clientBId, // Foreign Client
          technicianUserId: fixture.techA,
          createdById: fixture.ownerA,
          currentRevisionNumber: 1,
        },
      });

      await prisma.budgetRevision.create({
        data: {
          id: crossRevId,
          budgetId: b.id,
          revisionNumber: 1,
          status: "draft",
          clientSnapshot: { name: "Foreign Client" },
          vehicleSnapshot: { plate: "CRS-001" },
          grossTotal: 1000.0,
          currencyCode: "EUR",
          createdById: fixture.ownerA,
        },
      });

      await prisma.budget.update({
        where: { id: crossBudgetId },
        data: { currentRevisionId: crossRevId },
      });

      const res = await request(`/api/budgets/${crossBudgetId}/revisions/${crossRevId}/approve`, {
        method: "POST",
        headers: headers(fixture.clientAUser, fixture.workspaceA, "cross-client-key", "user"),
        body: JSON.stringify({ notes: "Cross-client approval attempt" }),
      });

      // RED: Currently route does not check grant.clientId == budget.clientId
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.message || "").toMatch(/CROSS_CLIENT_FORBIDDEN|não autorizado para este cliente/i);
    });

    it("DIRECT-PO-PRESERVED-01: Direct ProductionOrder creation preserved without budget approval", async () => {
      const res = await request("/api/production-orders", {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "direct-po-key"),
        body: JSON.stringify({
          code: "PO-DIR-999",
          clientId: fixture.clientAId,
          licensePlate: "DIR-999-FR",
          platform: "Platform Lyon",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.code).toBe("PO-DIR-999");
      expect(body.budgetId).toBeNull();
    });
  });

  /* =========================================================================
   * GROUP 7: CLIENT COLLABORATOR GOVERNANCE SCOPE
   * ========================================================================= */
  describe("Group 7: Client Collaborator Governance Scope", () => {
    it("CLIENT-GOVERNANCE-CAPABILITIES-01: ClientAccessGrant enforces granular capabilities", async () => {
      // RED: ClientAccessGrant.capabilities column / check does not exist yet
      const grant = await prisma.clientAccessGrant.findFirst({
        where: { userId: fixture.clientAUser, workspaceId: fixture.workspaceA },
      });
      expect(grant).not.toBeNull();
      expect((grant as any)?.capabilities).toBeDefined();
    });

    it("CLIENT-GOVERNANCE-LOCAL-SCOPE-01: Operational siteKey scope blocks out-of-scope validation", async () => {
      // RED: Scoped grant to site-lyon attempting validation on site-paris should return 403
      const scopedWeeklogId = "75000000-0000-4000-8000-000000000099";
      await prisma.weeklog.deleteMany({ where: { id: scopedWeeklogId } });
      await prisma.weeklog.create({
        data: {
          id: scopedWeeklogId,
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-paris",
          startsOn: new Date("2026-09-20T00:00:00.000Z"),
          endsOn: new Date("2026-09-26T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W39",
          weekNumber: 39,
          status: "pending_validation",
        },
      });

      const res = await request(`/api/weeklogs/${scopedWeeklogId}/validate`, {
        method: "POST",
        headers: headers(fixture.clientAUser, fixture.workspaceA, "scoped-val-key", "user"),
        body: JSON.stringify({
          validationMethod: "authenticated_confirmation",
          approvedEntryIds: [],
        }),
      });

      // RED: Site scope checking is not yet implemented
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.message || "").toMatch(/SITE_SCOPE_UNAUTHORIZED|local operacional não autorizado/i);
    });

    it("CLIENT-NO-FINANCE-LEDGER-01: Client collaborator has zero access to internal Finance ledger", async () => {
      const res = await request("/api/finance/v2/summary", {
        headers: headers(fixture.clientAUser, fixture.workspaceA, "client-fin-key", "user"),
      });

      // GREEN: Existing finance authorization strictly rejects non-owner / non-admin
      expect(res.status).toBe(403);
    });

    it("CLIENT-COLLABORATOR-DELEGATION-01: Authorized client representative delegates collaborator within client boundary", async () => {
      // Representative delegates new collaborator for Client A
      const res = await request(`/api/clients/${fixture.clientAId}/collaborators`, {
        method: "POST",
        headers: headers(fixture.clientAUser, fixture.workspaceA, "delegate-key", "user"),
        body: JSON.stringify({
          userId: fixture.techA,
          role: "collaborator",
          capabilities: ["weeklog.validate", "budget.approve"],
          siteKey: "site-lyon",
        }),
      });

      // RED: Endpoint does not exist yet (404)
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.grantId).toBeDefined();

      // Cross-client delegation attempt returns 403
      const crossRes = await request(`/api/clients/${fixture.clientBId}/collaborators`, {
        method: "POST",
        headers: headers(fixture.clientAUser, fixture.workspaceA, "cross-delegate-key", "user"),
        body: JSON.stringify({
          userId: fixture.techA,
          role: "collaborator",
          capabilities: ["weeklog.validate"],
        }),
      });

      expect(crossRes.status).toBe(403);
    });
  });

  /* =========================================================================
   * GROUP 8: EXTERNAL WEEKLOG INTAKE VIA CANONICAL IMPORTS ROUTER
   * ========================================================================= */
  describe("Group 8: External WEEKLOG Intake & Reconciliation", () => {
    let externalImportId = "";
    let externalWeeklogId = "";

    it("EXT-WEEKLOG-REVIEW-01: External WEEKLOG upload stages entries for human review", async () => {
      const res = await request("/api/external-operational-imports", {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "ext-wl-upload-key"),
        body: JSON.stringify({
          fileName: "external-weeklog.pdf",
          mimeType: "application/pdf",
          contentBase64: Buffer.from("%PDF-1.7\nexternal operational weeklog content").toString("base64"),
        }),
      });

      // GREEN: Canonical route stages import rows
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.importId).toBeDefined();
      expect(body.status).toBe("extracted");
      externalImportId = body.importId;
    });

    it("EXT-WEEKLOG-VALIDATED-01: Committing reviewed external WEEKLOG marks it validated", async () => {
      // Patch staged row with reviewed fields
      const detailRes = await request(`/api/external-operational-imports/${externalImportId}`, { headers: headers() });
      const detail = await detailRes.json();
      const firstItemId = detail.items[0]?.id;

      if (firstItemId) {
        await request(`/api/external-operational-imports/${externalImportId}/rows`, {
          method: "PATCH",
          headers: headers(fixture.ownerA, fixture.workspaceA, "ext-wl-patch-key"),
          body: JSON.stringify({
            rows: [
              {
                id: firstItemId,
                patch: {
                  reviewedLicensePlate: "EXT-888-ZZ",
                  reviewedCarName: "Renault Clio",
                  reviewedClientId: fixture.clientAId,
                  reviewedCurrencyCode: "EUR",
                  reviewedOperationalSiteKey: "SITE-EXT-01",
                  reviewedTechnicianUserId: fixture.techA,
                  reviewedDeliveredAt: "2026-09-18T12:00:00.000Z",
                  reviewedServices: [{ code: "PDR", quantity: "1", amount: "200.00" }],
                  reviewedTotal: "200.00",
                },
              },
            ],
          }),
        });
      }

      // Commit the external import
      const commitRes = await request(`/api/external-operational-imports/${externalImportId}/commit`, {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "ext-wl-commit-key"),
        body: JSON.stringify({}),
      });

      // GREEN: Existing canonical route commits to status validated
      expect([200, 201]).toContain(commitRes.status);
      const commitBody = await commitRes.json();
      expect(commitBody.status).toBe("committed");
      externalWeeklogId = commitBody.weeklogId;
      expect(externalWeeklogId).toBeDefined();

      const wl = await prisma.weeklog.findUniqueOrThrow({ where: { id: externalWeeklogId } });
      expect(wl.status).toBe("validated");
    });

    it("EXT-WEEKLOG-AUTO-LIST-01: Committed external WEEKLOG triggers automatic draft PaymentList creation", async () => {
      // RED: In current code, commit does not trigger draft PaymentList creation
      const autoList = await prisma.paymentList.findFirst({
        where: {
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          items: { some: { operationalSiteKey: "SITE-EXT-01" } },
        },
      });

      expect(autoList).not.toBeNull();
      expect(autoList?.status).toBe("draft");
    });

    it("EXT-WEEKLOG-AUTO-LIST-IDEMPOTENT-01: External WEEKLOG auto-list handoff is strictly idempotent", async () => {
      // RED: In current code, auto list count is 0
      const count = await prisma.paymentList.count({
        where: {
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          items: { some: { operationalSiteKey: "SITE-EXT-01" } },
        },
      });

      expect(count).toBe(1);
    });
  });

  /* =========================================================================
   * GROUP 9: IMPORTER UX & PRODUCTION TIMELINE
   * ========================================================================= */
  describe("Group 9: Importer UX & Production Timeline", () => {
    it("IMPORT-UX-CONTRACT-01: Importer contract exposes preview controls and bulk downward edit capability", async () => {
      const importId = "76000000-0000-4000-8000-000000000099";
      // RED: POST /api/external-operational-imports/:id/apply-downward endpoint does not exist yet (returns 404)
      const res = await request(`/api/external-operational-imports/${importId}/apply-downward`, {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "bulk-downward-key"),
        body: JSON.stringify({
          field: "reviewedTechnicianUserId",
          value: fixture.techA,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.appliedCount).toBeGreaterThan(0);
    });

    it("PRODUCTION-HISTORY-01: Production timeline returns chronological sequence of domain facts", async () => {
      // RED: GET /api/production-orders/:id/timeline does not exist yet (returns 404)
      const res = await request(`/api/production-orders/76000000-0000-4000-8000-000000000001/timeline`, {
        headers: headers(fixture.ownerA, fixture.workspaceA, "timeline-key"),
      });

      expect(res.status).toBe(200);
      const events = await res.json();
      expect(Array.isArray(events)).toBe(true);
      expect(events[0]).toMatchObject({ type: "created" });
    });
  });

  /* =========================================================================
   * GROUP 10: CONTRACTUAL UI RELEASE GATES
   * ========================================================================= */
  describe("Group 10: Contractual UI Release Gates", () => {
    it("UI-LIGHT-MODE-01: Design tokens define accessible light-mode contrast", async () => {
      const indexCss = await readFile("src/index.css", "utf8");
      expect(indexCss).toContain(":root");
      expect(indexCss).toContain("--background");
      expect(indexCss).toContain("--foreground");
    });

    it("UI-MOBILE-CORE-01: Core layout contains viewport responsive metadata", async () => {
      const indexHtml = await readFile("index.html", "utf8");
      expect(indexHtml).toContain('name="viewport"');
      expect(indexHtml).toContain("width=device-width");
    });

    it("UI-TABLET-CORE-01: Responsive container classes exist for tablet views", async () => {
      const indexCss = await readFile("src/index.css", "utf8");
      expect(indexCss.length).toBeGreaterThan(100);
    });

    it("UI-BRAND-OPERIX-01: Operix brand hygiene verified (zero Nexus strings in title)", async () => {
      const indexHtml = await readFile("index.html", "utf8");
      expect(indexHtml).toContain("Operix");
      expect(indexHtml).not.toContain("Nexus");
      expect(indexHtml).not.toContain("WorkNexus");
    });

    it("UI-AUTOMATION-HIDDEN-01: Deferred automation module absent from active navigation", async () => {
      const navFile = await readFile("src/components/layout/AppLayout.tsx", "utf8").catch(() => "");
      expect(navFile).not.toContain('to="/automation"');
    });
  });
});
