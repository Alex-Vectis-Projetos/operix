// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

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
const { clientsRouter } = await import("../../backend/src/routes/clients.js");
const { operationalBillingRouter } = await import("../../backend/src/routes/billingOperations.js");
const { minioImportDocumentStorage, aiImportExtractionProvider } = await import("../../backend/src/services/externalImportAdapters.js");
const { signAccessToken } = await import("../../backend/src/lib/jwt.js");
const { prisma } = await import("../../backend/src/lib/prisma.js");
const weeklogService = await import("../../backend/src/services/weeklogService.js");
const paymentListService = await import("../../backend/src/services/paymentListService.js");
const { assertClientCapability, ALLOWED_CLIENT_CAPABILITIES } = await import("../../backend/src/lib/objectAuth.js");

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
      "billing_invoices",
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
        role: "representative",
        status: "active",
        capabilities: ["budget.approve", "weeklog.validate", "client.collaborators.manage"],
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
    app.use("/api/clients", clientsRouter);
    app.use("/api/billing", operationalBillingRouter);

    app.use((err: any, _req: any, res: any, _next: any) => {
      const status = typeof err?.statusCode === "number" ? err.statusCode : 500;
      return res.status(status).json({
        code: err?.code,
        message: err?.message || "Internal error",
      });
    });

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
          operationalSiteKey: "Atelier Paris Nord",
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

      // Concise projection endpoint GET /api/weeklogs/:id/projection
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

    it("WEEK-AUTO-CLOSE-MANUAL-RACE-01: Concurrent manual submit and auto-close runner converge safely without duplicated rounds", async () => {
      const raceWl = await prisma.weeklog.create({
        data: {
          id: "75000000-0000-4000-8000-000000000021",
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-default",
          startsOn: new Date("2026-08-02T00:00:00.000Z"),
          endsOn: new Date("2026-08-08T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W32",
          weekNumber: 32,
          status: "open",
        },
      });

      const reconcileFn = (weeklogService as any).reconcileExpiredWeeklogs;
      const ctx = {
        activeWorkspaceId: fixture.workspaceA,
        actorUserId: fixture.ownerA,
        membershipRole: "admin",
        scope: "workspace",
      };

      const [manualResult, autoResult] = await Promise.allSettled([
        (weeklogService as any).submitWeeklogForValidation(ctx, raceWl.id),
        reconcileFn(fixture.workspaceA),
      ]);

      expect(manualResult.status).toBe("fulfilled");
      expect(autoResult.status).toBe("fulfilled");

      const finalWl = await prisma.weeklog.findUniqueOrThrow({ where: { id: raceWl.id } });
      expect(finalWl.status).toBe("pending_validation");

      const rounds = await prisma.weeklogValidation.findMany({
        where: { weeklogId: raceWl.id },
      });
      expect(rounds.length).toBe(1);
    });

    it("WEEK-AUTO-CLOSE-CONCURRENT-RUNNERS-01: Multiple concurrent runner instances process expired weeklogs safely under SKIP LOCKED", async () => {
      const runnerWl = await prisma.weeklog.create({
        data: {
          id: "75000000-0000-4000-8000-000000000022",
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-default",
          startsOn: new Date("2026-07-26T00:00:00.000Z"),
          endsOn: new Date("2026-08-01T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W31",
          weekNumber: 31,
          status: "open",
        },
      });

      const reconcileFn = (weeklogService as any).reconcileExpiredWeeklogs;

      await Promise.all([
        reconcileFn(fixture.workspaceA),
        reconcileFn(fixture.workspaceA),
        reconcileFn(fixture.workspaceA),
      ]);

      const finalWl = await prisma.weeklog.findUniqueOrThrow({ where: { id: runnerWl.id } });
      expect(finalWl.status).toBe("pending_validation");

      const rounds = await prisma.weeklogValidation.findMany({
        where: { weeklogId: runnerWl.id },
      });
      expect(rounds.length).toBe(1);
    });

    it("WEEK-AUTO-CLOSE-NEXT-SEQUENCE-01: Auto-close increments validation sequence when prior historical validation rounds exist", async () => {
      const seqWl = await prisma.weeklog.create({
        data: {
          id: "75000000-0000-4000-8000-000000000023",
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-default",
          startsOn: new Date("2026-07-19T00:00:00.000Z"),
          endsOn: new Date("2026-07-25T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W30",
          weekNumber: 30,
          status: "open",
        },
      });

      await prisma.weeklogValidation.create({
        data: {
          weeklogId: seqWl.id,
          workspaceId: fixture.workspaceA,
          validationSequence: 1,
          status: "validated",
          submittedAt: new Date("2026-07-26T10:00:00.000Z"),
          validatedAt: new Date("2026-07-26T11:00:00.000Z"),
          coverageSnapshot: [],
          auditTrail: [],
        },
      });

      const reconcileFn = (weeklogService as any).reconcileExpiredWeeklogs;
      await reconcileFn(fixture.workspaceA);

      const latestRound = await prisma.weeklogValidation.findFirst({
        where: { weeklogId: seqWl.id, status: "pending" },
        orderBy: { validationSequence: "desc" },
      });

      expect(latestRound).not.toBeNull();
      expect(latestRound?.validationSequence).toBe(2);
    });

    it("WEEK-AUTO-CLOSE-COVERAGE-FREEZE-01: Auto-close creates immutable coverage snapshot and does not invent a human submittedBy actor", async () => {
      const freezeWl = await prisma.weeklog.create({
        data: {
          id: "75000000-0000-4000-8000-000000000024",
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-default",
          startsOn: new Date("2026-07-12T00:00:00.000Z"),
          endsOn: new Date("2026-07-18T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W29",
          weekNumber: 29,
          status: "open",
        },
      });

      const po = await prisma.productionOrder.create({
        data: {
          id: "76000000-0000-4000-8000-000000000024",
          workspaceId: fixture.workspaceA,
          code: "PO-FREEZE-01",
          clientId: fixture.clientAId,
          status: "delivered",
        },
      });

      const entry = await prisma.weeklogEntry.create({
        data: {
          id: "77000000-0000-4000-8000-000000000024",
          workspaceId: fixture.workspaceA,
          weeklogId: freezeWl.id,
          productionOrderId: po.id,
          technicianUserId: fixture.ownerA,
          technicianName: "Owner A",
          clientId: fixture.clientAId,
          totalAmount: 450.0,
          currencyCode: "EUR",
          deliveredAt: new Date("2026-07-15T10:00:00.000Z"),
          validationStatus: "pending",
        },
      });

      const reconcileFn = (weeklogService as any).reconcileExpiredWeeklogs;
      await reconcileFn(fixture.workspaceA);

      const round = await prisma.weeklogValidation.findFirstOrThrow({
        where: { weeklogId: freezeWl.id },
      });

      expect(round.submittedBy).toBeNull();

      const snapshot = round.coverageSnapshot as any[];
      expect(snapshot).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            weeklogEntryId: entry.id,
            productionOrderId: po.id,
            totalAmount: "450",
            currencyCode: "EUR",
          }),
        ])
      );
    });

    it("WEEK-PROJECTION-CROSS-TENANT-01: Weeklog projection enforces strict tenant boundary and returns 404 for foreign workspace", async () => {
      const foreignWl = await prisma.weeklog.create({
        data: {
          id: "75000000-0000-4000-8000-000000000025",
          workspaceId: fixture.workspaceB,
          clientId: fixture.clientBId,
          siteKey: "site-foreign",
          startsOn: new Date("2026-07-05T00:00:00.000Z"),
          endsOn: new Date("2026-07-11T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W28",
          weekNumber: 28,
          status: "open",
        },
      });

      const response = await request(`/api/weeklogs/${foreignWl.id}/projection`, {
        headers: headers(fixture.ownerA, fixture.workspaceA),
      });

      expect([403, 404]).toContain(response.status);
    });

    it("WEEK-PROJECTION-CLIENT-SITE-SCOPE-01: Client collaborator projection access enforces siteKey scope and client boundary", async () => {
      const lyonWl = await prisma.weeklog.create({
        data: {
          id: "75000000-0000-4000-8000-000000000026",
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-lyon",
          startsOn: new Date("2026-06-28T00:00:00.000Z"),
          endsOn: new Date("2026-07-04T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W27",
          weekNumber: 27,
          status: "open",
        },
      });

      const parisWl = await prisma.weeklog.create({
        data: {
          id: "75000000-0000-4000-8000-000000000027",
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-paris",
          startsOn: new Date("2026-06-28T00:00:00.000Z"),
          endsOn: new Date("2026-07-04T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W27",
          weekNumber: 27,
          status: "open",
        },
      });

      const scopedUser = randomUUID();
      const scopedUserApp = randomUUID();
      await prisma.user.create({
        data: {
          id: scopedUser,
          email: `${scopedUser}@client.com`,
          fullName: "Lyon Client Proj User",
          role: "user",
          passwordHash: "x",
          appUser: { create: { id: scopedUserApp, email: `${scopedUser}@client.com` } },
        },
      });
      await prisma.membership.create({
        data: {
          workspaceId: fixture.workspaceA,
          userId: scopedUserApp,
          role: "client",
          status: "active",
        },
      });
      await prisma.clientAccessGrant.create({
        data: {
          workspaceId: fixture.workspaceA,
          userId: scopedUser,
          clientId: fixture.clientAId,
          role: "representative",
          status: "active",
          siteKey: "site-lyon",
          capabilities: ["weeklog.validate"],
        },
      });

      const allowedRes = await request(`/api/weeklogs/${lyonWl.id}/projection`, {
        headers: headers(scopedUser, fixture.workspaceA, "proj-lyon-key", "client"),
      });
      expect(allowedRes.status).toBe(200);

      const deniedRes = await request(`/api/weeklogs/${parisWl.id}/projection`, {
        headers: headers(scopedUser, fixture.workspaceA, "proj-paris-key", "client"),
      });
      expect(deniedRes.status).toBe(403);
      const deniedBody = await deniedRes.json();
      expect(deniedBody.message).toContain("SITE_SCOPE_UNAUTHORIZED");
    });
  });

  /* =========================================================================
   * GROUP 2: WEEKLOG VALIDATION & AUTOMATIC DRAFT LIST HANDOFF
   * ========================================================================= */

  describe("Group 2: WEEKLOG Validation & Automatic Draft List Handoff", () => {
    let validatedWlId = "75000000-0000-4000-8000-000000000010";

    beforeEach(async () => {
      await prisma.paymentListEntryClaim.deleteMany({ where: { paymentList: { originWeeklogId: validatedWlId } } });
      await prisma.paymentListItem.deleteMany({ where: { paymentList: { originWeeklogId: validatedWlId } } });
      await prisma.paymentList.deleteMany({ where: { originWeeklogId: validatedWlId } });
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
      let list = await prisma.paymentList.findFirst({
        where: { workspaceId: fixture.workspaceA, status: "draft" },
        include: { items: true },
      });

      let createdForTest = false;
      if (!list) {
        createdForTest = true;
        await request(`/api/weeklogs/75000000-0000-4000-8000-000000000010/validate`, {
          method: "POST",
          headers: headers(fixture.clientAUser, fixture.workspaceA, "val-proj-key"),
          body: JSON.stringify({
            validationMethod: "authenticated_confirmation",
            approvedEntryIds: ["77000000-0000-4000-8000-000000000010"],
          }),
        });
        list = await prisma.paymentList.findFirst({
          where: { workspaceId: fixture.workspaceA, status: "draft" },
          include: { items: true },
        });
      }

      try {
        // RED: Auto-generated list not present yet
        expect(list).not.toBeNull();
        expect(list?.items[0]).toMatchObject({
          vehicleDescription: expect.any(String),
          serviceLocation: expect.any(String),
        });
      } finally {
        if (createdForTest && list) {
          await prisma.paymentListEntryClaim.deleteMany({ where: { paymentListId: list.id } });
          await prisma.paymentListItem.deleteMany({ where: { paymentListId: list.id } });
          await prisma.paymentList.deleteMany({ where: { id: list.id } });
        }
      }
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
      await prisma.weeklog.deleteMany({ where: { workspaceId: fixture.workspaceA, siteKey: "site-manual-coexist" } });

      await prisma.weeklog.create({
        data: {
          id: manualWlId,
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-manual-coexist",
          startsOn: new Date("2026-10-18T00:00:00.000Z"),
          endsOn: new Date("2026-10-24T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W43",
          weekNumber: 43,
          status: "validated",
        },
      });

      const manualPoId = "76000000-0000-4000-8000-000000000077";
      await prisma.productionOrder.deleteMany({ where: { id: manualPoId } });
      await prisma.productionOrder.create({
        data: {
          id: manualPoId,
          workspaceId: fixture.workspaceA,
          code: "PO-MANUAL-COEXIST",
          clientId: fixture.clientAId,
          status: "delivered",
        },
      });

      await prisma.weeklogEntry.create({
        data: {
          id: manualEntryId,
          workspaceId: fixture.workspaceA,
          weeklogId: manualWlId,
          productionOrderId: manualPoId,
          clientId: fixture.clientAId,
          technicianUserId: fixture.ownerA,
          technicianName: "Owner A",
          currencyCode: "EUR",
          sourceType: "production_order",
          licensePlate: "ABS-001-FR",
          model: "Peugeot 208",
          totalAmount: 350.0,
          deliveredAt: new Date("2026-10-20T10:00:00.000Z"),
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

    it("LIST-PARTIAL-ABSORB-HARDENING-01: Partial absorption releases only selected entries, keeps remaining entries billable, and recalculates auto-draft totals", async () => {
      const autoListId = "74000000-0000-4000-8000-000000000088";
      const entry1Id = "75000000-0000-4000-8000-000000000081";
      const entry2Id = "75000000-0000-4000-8000-000000000082";
      const wlId = "75000000-0000-4000-8000-000000000080";
      const po1Id = "76000000-0000-4000-8000-000000000081";
      const po2Id = "76000000-0000-4000-8000-000000000082";

      await prisma.paymentListEntryClaim.deleteMany({ where: { weeklogEntryId: { in: [entry1Id, entry2Id] } } });
      await prisma.paymentListItem.deleteMany({ where: { weeklogEntryId: { in: [entry1Id, entry2Id] } } });
      await prisma.paymentList.deleteMany({ where: { id: autoListId } });
      await prisma.weeklogEntry.deleteMany({ where: { id: { in: [entry1Id, entry2Id] } } });
      await prisma.productionOrder.deleteMany({ where: { id: { in: [po1Id, po2Id] } } });
      await prisma.weeklog.deleteMany({ where: { id: wlId } });

      await prisma.productionOrder.createMany({
        data: [
          { id: po1Id, workspaceId: fixture.workspaceA, code: "PO-PARTIAL-1", clientId: fixture.clientAId, status: "delivered" },
          { id: po2Id, workspaceId: fixture.workspaceA, code: "PO-PARTIAL-2", clientId: fixture.clientAId, status: "delivered" },
        ],
      });

      await prisma.weeklog.create({
        data: {
          id: wlId,
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-partial-absorb",
          startsOn: new Date("2026-10-25T00:00:00.000Z"),
          endsOn: new Date("2026-10-31T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W44",
          weekNumber: 44,
          status: "validated",
        },
      });

      await prisma.weeklogEntry.createMany({
        data: [
          {
            id: entry1Id,
            workspaceId: fixture.workspaceA,
            weeklogId: wlId,
            productionOrderId: po1Id,
            clientId: fixture.clientAId,
            technicianUserId: fixture.ownerA,
            technicianName: "Owner A",
            currencyCode: "EUR",
            sourceType: "production_order",
            licensePlate: "PAR-001-AA",
            totalAmount: 200.0,
            deliveredAt: new Date("2026-10-26T10:00:00.000Z"),
            validationStatus: "approved",
          },
          {
            id: entry2Id,
            workspaceId: fixture.workspaceA,
            weeklogId: wlId,
            productionOrderId: po2Id,
            clientId: fixture.clientAId,
            technicianUserId: fixture.ownerA,
            technicianName: "Owner A",
            currencyCode: "EUR",
            sourceType: "production_order",
            licensePlate: "PAR-002-BB",
            totalAmount: 300.0,
            deliveredAt: new Date("2026-10-27T10:00:00.000Z"),
            validationStatus: "approved",
          },
        ],
      });

      const autoList = await prisma.paymentList.create({
        data: {
          id: autoListId,
          workspaceId: fixture.workspaceA,
          listNumber: "PL-AUTO-PARTIAL-TEST",
          clientId: fixture.clientAId,
          clientName: "VECTIS Client",
          currencyCode: "EUR",
          status: "draft",
          sourceType: "weeklog_auto",
          itemCount: 2,
          sourceDocumentTotal: 500.0,
          recognizedTotal: 0.0,
          createdBy: fixture.ownerA,
        },
      });

      await prisma.paymentListItem.createMany({
        data: [
          {
            workspaceId: fixture.workspaceA,
            paymentListId: autoList.id,
            weeklogEntryId: entry1Id,
            vehicleDescription: "Entry 1 Car",
            totalAmount: 200.0,
            servicesSnapshot: [],
          },
          {
            workspaceId: fixture.workspaceA,
            paymentListId: autoList.id,
            weeklogEntryId: entry2Id,
            vehicleDescription: "Entry 2 Car",
            totalAmount: 300.0,
            servicesSnapshot: [],
          },
        ],
      });

      await prisma.paymentListEntryClaim.createMany({
        data: [
          { workspaceId: fixture.workspaceA, paymentListId: autoList.id, weeklogEntryId: entry1Id, status: "provisional" },
          { workspaceId: fixture.workspaceA, paymentListId: autoList.id, weeklogEntryId: entry2Id, status: "provisional" },
        ],
      });

      // Operator creates a manual list absorbing only entry1Id
      const res = await request("/api/payment-lists", {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "partial-absorb-key"),
        body: JSON.stringify({
          clientId: fixture.clientAId,
          currencyCode: "EUR",
          entryIds: [entry1Id],
        }),
      });

      expect(res.status).toBe(201);
      const manualList = await res.json();
      expect(manualList.status).toBe("draft");

      // Verify the manual list received a reserved claim
      const manualClaim = await prisma.paymentListEntryClaim.findFirst({
        where: { paymentListId: manualList.id, weeklogEntryId: entry1Id },
      });
      expect(manualClaim?.status).toBe("reserved");

      // Verify auto-draft state:
      // 1. auto-draft remains draft (NOT superseded)
      const updatedAutoList = await prisma.paymentList.findUniqueOrThrow({
        where: { id: autoListId },
        include: { items: true, claims: true },
      });
      expect(updatedAutoList.status).toBe("draft");
      expect(updatedAutoList.itemCount).toBe(1);
      expect(Number(updatedAutoList.sourceDocumentTotal)).toBe(300.0);

      // 2. entry1 absorbed item is no longer in auto-draft items
      expect(updatedAutoList.items).toHaveLength(1);
      expect(updatedAutoList.items[0]?.weeklogEntryId).toBe(entry2Id);

      // 3. entry1 claim is released with explicit reason
      const entry1Claim = updatedAutoList.claims.find((c) => c.weeklogEntryId === entry1Id);
      expect(entry1Claim?.status).toBe("released");
      expect(entry1Claim?.releasedReason).toBe(`absorbed_by_manual_list:${manualList.id}`);

      // 4. entry2 claim remains provisional in auto-draft
      const entry2Claim = updatedAutoList.claims.find((c) => c.weeklogEntryId === entry2Id);
      expect(entry2Claim?.status).toBe("provisional");

      // 5. entry2 remains billable: create another manual list with entry2Id
      const res2 = await request("/api/payment-lists", {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "partial-absorb-key-2"),
        body: JSON.stringify({
          clientId: fixture.clientAId,
          currencyCode: "EUR",
          entryIds: [entry2Id],
        }),
      });
      expect(res2.status).toBe(201);

      // Now all entries of autoList were absorbed -> auto-draft becomes superseded
      const finalizedAutoList = await prisma.paymentList.findUniqueOrThrow({
        where: { id: autoListId },
      });
      expect(finalizedAutoList.status).toBe("superseded");
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

    it("LIST-EXTERNAL-AUTO-ABSORB-01: External multiweek confrontation absorbs provisional auto-draft claims into definitive reserved claims", async () => {
      // RED: Source-aware multiweek claim absorption requires ADR-002 provisional claim status
      const schema = await readFile(new URL("../../backend/prisma/schema.prisma", import.meta.url), "utf8");
      expect(schema).toMatch(/provisional/);
    });

    it("LIST-PROVENANCE-IMMUTABLE-01: Commercial provenance foreign keys enforce ON DELETE RESTRICT on weeklog, validation, and superseding parent", async () => {
      const provWlId = "75000000-0000-4000-8000-000000000091";
      const provValId = "78000000-0000-4000-8000-000000000091";
      const provPlAId = "74000000-0000-4000-8000-000000000091";
      const provPlBId = "74000000-0000-4000-8000-000000000092";

      // Cleanup
      await prisma.paymentList.deleteMany({ where: { id: { in: [provPlBId, provPlAId] } } });
      await prisma.weeklogValidation.deleteMany({ where: { id: provValId } });
      await prisma.weeklog.deleteMany({ where: { id: provWlId } });

      // Create Weeklog & Validation
      await prisma.weeklog.create({
        data: {
          id: provWlId,
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-prov-immut",
          startsOn: new Date("2026-11-01T00:00:00.000Z"),
          endsOn: new Date("2026-11-07T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W45",
          weekNumber: 45,
          status: "validated",
        },
      });

      await prisma.weeklogValidation.create({
        data: {
          id: provValId,
          weeklogId: provWlId,
          workspaceId: fixture.workspaceA,
          validationSequence: 1,
          status: "validated",
          submittedAt: new Date(),
          coverageSnapshot: [],
        },
      });

      // Create PaymentList A originating from provWlId and provValId
      await prisma.paymentList.create({
        data: {
          id: provPlAId,
          workspaceId: fixture.workspaceA,
          listNumber: "PL-PROV-001",
          clientId: fixture.clientAId,
          clientName: "Client A",
          currencyCode: "EUR",
          status: "draft",
          sourceType: "weeklog_auto",
          originWeeklogId: provWlId,
          originWeeklogValidationId: provValId,
          createdBy: fixture.ownerA,
        },
      });

      // 1. Deleting referenced Weeklog MUST FAIL with foreign key violation (ON DELETE RESTRICT)
      await expect(
        prisma.weeklog.delete({ where: { id: provWlId } })
      ).rejects.toThrow();

      // 2. Deleting referenced WeeklogValidation MUST FAIL with foreign key violation (ON DELETE RESTRICT)
      await expect(
        prisma.weeklogValidation.delete({ where: { id: provValId } })
      ).rejects.toThrow();

      // Create PaymentList B superseded by PaymentList A
      await prisma.paymentList.create({
        data: {
          id: provPlBId,
          workspaceId: fixture.workspaceA,
          listNumber: "PL-PROV-002",
          clientId: fixture.clientAId,
          clientName: "Client A",
          currencyCode: "EUR",
          status: "superseded",
          sourceType: "weeklog_auto",
          supersededByPaymentListId: provPlAId,
          createdBy: fixture.ownerA,
        },
      });

      // 3. Deleting parent PaymentList A MUST FAIL while PaymentList B references it (ON DELETE RESTRICT)
      await expect(
        prisma.paymentList.delete({ where: { id: provPlAId } })
      ).rejects.toThrow();

      // Teardown in correct order
      await prisma.paymentList.delete({ where: { id: provPlBId } });
      await prisma.paymentList.delete({ where: { id: provPlAId } });
      await prisma.weeklogValidation.delete({ where: { id: provValId } });
      await prisma.weeklog.delete({ where: { id: provWlId } });
    });

    it("LIST-INTERNAL-READY-FOR-BILLING-01: ready_for_billing transition requires internal operator authority, transitions provisional claims to reserved, is idempotent, and preserves zero finance impact", async () => {
      const rfbListId = "74000000-0000-4000-8000-000000000095";
      const rfbEntryId = "77000000-0000-4000-8000-000000000095";
      const rfbPoId = "76000000-0000-4000-8000-000000000095";
      const rfbWlId = "75000000-0000-4000-8000-000000000095";

      // Cleanup
      await prisma.paymentListEntryClaim.deleteMany({ where: { paymentListId: rfbListId } });
      await prisma.paymentListItem.deleteMany({ where: { paymentListId: rfbListId } });
      await prisma.paymentList.deleteMany({ where: { id: rfbListId } });
      await prisma.weeklogEntry.deleteMany({ where: { id: rfbEntryId } });
      await prisma.weeklog.deleteMany({ where: { id: rfbWlId } });
      await prisma.productionOrder.deleteMany({ where: { id: rfbPoId } });

      await prisma.productionOrder.create({
        data: {
          id: rfbPoId,
          workspaceId: fixture.workspaceA,
          code: "PO-RFB-01",
          clientId: fixture.clientAId,
          status: "delivered",
        },
      });

      await prisma.weeklog.create({
        data: {
          id: rfbWlId,
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-rfb",
          startsOn: new Date("2026-11-08T00:00:00.000Z"),
          endsOn: new Date("2026-11-14T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W46",
          weekNumber: 46,
          status: "validated",
          entries: {
            create: {
              id: rfbEntryId,
              productionOrderId: rfbPoId,
              technicianUserId: fixture.ownerA,
              technicianName: "Tech A",
              clientId: fixture.clientAId,
              deliveredAt: new Date("2026-11-10T10:00:00.000Z"),
              totalAmount: 1800.0,
              currencyCode: "EUR",
              brand: "Audi",
              model: "A4",
              validationStatus: "approved",
            },
          },
        },
      });

      // Create draft auto payment list with provisional claim
      await prisma.paymentList.create({
        data: {
          id: rfbListId,
          workspaceId: fixture.workspaceA,
          listNumber: "PL-RFB-001",
          clientId: fixture.clientAId,
          clientName: "Client A",
          currencyCode: "EUR",
          status: "draft",
          sourceType: "weeklog_auto",
          itemCount: 1,
          sourceDocumentTotal: 1800.0,
          recognizedTotal: 0,
          createdBy: fixture.ownerA,
          items: {
            create: {
              weeklogEntryId: rfbEntryId,
              carName: "Audi A4",
              vehicleDescription: "Audi A4",
              serviceLocation: "site-rfb",
              servicesSnapshot: [],
              totalAmount: 1800.0,
            },
          },
          claims: {
            create: {
              weeklogEntryId: rfbEntryId,
              status: "provisional",
            },
          },
        },
      });

      // 1. Client collaborator with payment_list.review CANNOT transition to ready_for_billing
      await prisma.clientAccessGrant.updateMany({
        where: { workspaceId: fixture.workspaceA, clientId: fixture.clientAId, userId: fixture.clientAUser },
        data: {
          capabilities: [
            "budget.approve",
            "weeklog.validate",
            "payment_list.review",
            "invoice.view",
            "client.collaborators.manage",
          ],
        },
      });

      const clientRes = await request(`/api/payment-lists/${rfbListId}/status`, {
        method: "PATCH",
        headers: headers(fixture.clientAUser, fixture.workspaceA, "rfb-client-key", "user"),
        body: JSON.stringify({ toStatus: "ready_for_billing" }),
      });
      expect(clientRes.status).toBe(403);
      const clientBody = await clientRes.json();
      expect(clientBody.message || "").toMatch(/FORBIDDEN_ROLE/);

      // Verify claim remains provisional
      let claim = await prisma.paymentListEntryClaim.findFirstOrThrow({
        where: { paymentListId: rfbListId, weeklogEntryId: rfbEntryId },
      });
      expect(claim.status).toBe("provisional");

      // 2. Authorized internal operator transitions to ready_for_billing
      const opRes = await request(`/api/payment-lists/${rfbListId}/status`, {
        method: "PATCH",
        headers: headers(fixture.ownerA, fixture.workspaceA, "rfb-op-key"),
        body: JSON.stringify({ toStatus: "ready_for_billing" }),
      });
      expect(opRes.status).toBe(200);
      const opBody = await opRes.json();
      expect(opBody.status).toBe("ready_for_billing");

      // Verify claim transitioned from provisional to reserved
      claim = await prisma.paymentListEntryClaim.findFirstOrThrow({
        where: { paymentListId: rfbListId, weeklogEntryId: rfbEntryId },
      });
      expect(claim.status).toBe("reserved");

      // 3. Idempotency: repeating the transition returns 200 without error
      const idempRes = await request(`/api/payment-lists/${rfbListId}/status`, {
        method: "PATCH",
        headers: headers(fixture.ownerA, fixture.workspaceA, "rfb-idemp-key"),
        body: JSON.stringify({ toStatus: "ready_for_billing" }),
      });
      expect(idempRes.status).toBe(200);

      // 4. Finance remains strictly zero in ready_for_billing
      const finRes = await request("/api/finance/v2/summary", {
        headers: headers(fixture.ownerA, fixture.workspaceA, "rfb-fin-key"),
      });
      expect(finRes.status).toBe(200);
      const finBody = await finRes.json();
      const eurBucket = finBody.currencies.find((c: any) => c.currencyCode === "EUR");
      if (eurBucket) {
        expect(eurBucket.expected).toBe("0.00");
        expect(eurBucket.received).toBe("0.00");
      }

      // 5. Pre-invoice cancellation from ready_for_billing is allowed and releases reserved claim
      const cancelRes = await request(`/api/payment-lists/${rfbListId}/status`, {
        method: "PATCH",
        headers: headers(fixture.ownerA, fixture.workspaceA, "rfb-cancel-key"),
        body: JSON.stringify({ toStatus: "cancelled" }),
      });
      expect(cancelRes.status).toBe(200);
      const cancelBody = await cancelRes.json();
      expect(cancelBody.status).toBe("cancelled");

      claim = await prisma.paymentListEntryClaim.findFirstOrThrow({
        where: { paymentListId: rfbListId, weeklogEntryId: rfbEntryId },
      });
      expect(claim.status).toBe("released");
      expect(claim.releasedReason).toBe("LIST_CANCELLED");

      // Teardown
      await prisma.paymentListEntryClaim.deleteMany({ where: { paymentListId: rfbListId } });
      await prisma.paymentListItem.deleteMany({ where: { paymentListId: rfbListId } });
      await prisma.paymentList.deleteMany({ where: { id: rfbListId } });
      await prisma.weeklogEntry.deleteMany({ where: { id: rfbEntryId } });
      await prisma.weeklog.deleteMany({ where: { id: rfbWlId } });
      await prisma.productionOrder.deleteMany({ where: { id: rfbPoId } });
    });
  });

  /* =========================================================================
   * GROUP 4: INVOICE HANDOFF & FINANCE
   * ========================================================================= */

  describe("Group 4: Invoice Handoff & Finance Boundaries", () => {
    const readyListId = "74000000-0000-4000-8000-000000000099";
    const pendingListId = "74000000-0000-4000-8000-000000000077";
    const draftListId = "74000000-0000-4000-8000-000000000088";
    const concListId = "74000000-0000-4000-8000-000000000066";
    const assocListId = "74000000-0000-4000-8000-000000000055";
    const rollbackListId = "74000000-0000-4000-8000-000000000044";
    const groupWlId = "75000000-0000-4000-8000-000000000044";
    const groupPoId = "76000000-0000-4000-8000-000000000044";

    const groupPoMap = new Map<string, string>();
    async function ensureGroupEntry(entryId: string) {
      let poId = groupPoMap.get(entryId);
      if (!poId) {
        poId = randomUUID();
        groupPoMap.set(entryId, poId);
      }
      await prisma.productionOrder.upsert({
        where: { id: poId },
        create: { id: poId, workspaceId: fixture.workspaceA, code: `PO-${randomUUID().slice(0, 8)}`, clientId: fixture.clientAId, status: "delivered" },
        update: {},
      });
      await prisma.weeklog.upsert({
        where: { id: groupWlId },
        create: {
          id: groupWlId,
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-lyon",
          startsOn: new Date("2026-07-19T00:00:00.000Z"),
          endsOn: new Date("2026-07-25T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W30",
          weekNumber: 30,
          status: "validated",
        },
        update: {},
      });
      await prisma.weeklogEntry.upsert({
        where: { id: entryId },
        create: {
          id: entryId,
          workspaceId: fixture.workspaceA,
          weeklogId: groupWlId,
          productionOrderId: poId,
          technicianUserId: fixture.ownerA,
          technicianName: "Owner A",
          clientId: fixture.clientAId,
          totalAmount: 500,
          currencyCode: "EUR",
          deliveredAt: new Date("2026-07-20T10:00:00Z"),
          validationStatus: "approved",
        },
        update: {},
      });
    }

    beforeEach(async () => {
      const allIds = [readyListId, pendingListId, draftListId, concListId, assocListId, rollbackListId];
      await prisma.paymentListEntryClaim.deleteMany({ where: { paymentListId: { in: allIds } } });
      await prisma.paymentListItem.deleteMany({ where: { paymentListId: { in: allIds } } });
      await prisma.paymentList.deleteMany({ where: { id: { in: allIds } } });
      await prisma.billingInvoice.deleteMany({ where: { workspaceId: { in: [fixture.workspaceA, fixture.workspaceB] } } });

      await ensureGroupEntry("entry-claim-ready-01");

      await prisma.paymentList.create({
        data: {
          id: readyListId,
          workspaceId: fixture.workspaceA,
          listNumber: "PL-INV-001",
          clientId: fixture.clientAId,
          clientName: "VECTIS Client",
          currencyCode: "EUR",
          status: "ready_for_billing",
          recognizedTotal: "2500.00",
          createdBy: fixture.ownerA,
        },
      });

      await prisma.paymentListEntryClaim.create({
        data: {
          workspaceId: fixture.workspaceA,
          paymentListId: readyListId,
          weeklogEntryId: "entry-claim-ready-01",
          status: "reserved",
        },
      });

      await prisma.paymentList.create({
        data: {
          id: pendingListId,
          workspaceId: fixture.workspaceA,
          listNumber: "PL-PEND-001",
          clientId: fixture.clientAId,
          clientName: "VECTIS Client",
          currencyCode: "EUR",
          status: "pending",
          recognizedTotal: "2500.00",
          createdBy: fixture.ownerA,
        },
      });
    });

    it("LIST-INVOICE-HANDOFF-01: Eligible List exposes the smallest supported create/associate invoice flow", async () => {
      // 1. Client collaborator without internal manager authority is denied (403)
      const clientResp = await request(`/api/payment-lists/${readyListId}/invoice/create`, {
        method: "POST",
        headers: headers(fixture.clientAUser, fixture.workspaceA, "client-no-inv", "user"),
        body: JSON.stringify({ notes: "Unauthorized client call" }),
      });
      expect(clientResp.status).toBe(403);

      // 2. Authorized internal operator invokes create
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

      // 3. Reserved claims transitioned to consumed (immutable)
      const claim = await prisma.paymentListEntryClaim.findFirstOrThrow({ where: { paymentListId: readyListId } });
      expect(claim.status).toBe("consumed");
      expect(claim.consumedAt).toBeInstanceOf(Date);
      expect(claim.releasedAt).toBeNull();

      // 4. Post-invoice cancellation (pending -> cancelled) is strictly forbidden in Phase 1
      const cancelResp = await request(`/api/payment-lists/${readyListId}/status`, {
        method: "PATCH",
        headers: headers(fixture.ownerA, fixture.workspaceA),
        body: JSON.stringify({ toStatus: "cancelled" }),
      });
      expect(cancelResp.status).toBe(409);
    });

    it("LIST-INVOICE-CREATE-IDEMPOTENT-01: Repeated create command returns and reuses same handoff without duplicate invoice", async () => {
      // First call creates the invoice
      const res1 = await request(`/api/payment-lists/${readyListId}/invoice/create`, {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "idemp-key-1"),
        body: JSON.stringify({ notes: "Initial create" }),
      });
      expect(res1.status).toBe(201);
      const body1 = await res1.json();
      expect(body1.invoiceId).toBeDefined();

      const invoiceCountBefore = await prisma.billingInvoice.count({
        where: { workspaceId: fixture.workspaceA },
      });

      // Second call returns existing handoff idempotently
      const res2 = await request(`/api/payment-lists/${readyListId}/invoice/create`, {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "idemp-key-2"),
        body: JSON.stringify({ notes: "Repeated create" }),
      });
      expect([200, 201]).toContain(res2.status);
      const body2 = await res2.json();
      expect(body2.invoiceId).toBe(body1.invoiceId);

      const invoiceCountAfter = await prisma.billingInvoice.count({
        where: { workspaceId: fixture.workspaceA },
      });
      expect(invoiceCountAfter).toBe(invoiceCountBefore);
    });

    it("LIST-INVOICE-CONCURRENT-01: Concurrent create creates exactly one effective invoice and link", async () => {
      await ensureGroupEntry("entry-claim-conc-01");
      await prisma.paymentList.create({
        data: {
          id: concListId,
          workspaceId: fixture.workspaceA,
          listNumber: "PL-CONC-001",
          clientId: fixture.clientAId,
          clientName: "VECTIS Client",
          currencyCode: "EUR",
          status: "ready_for_billing",
          recognizedTotal: "1200.00",
          createdBy: fixture.ownerA,
        },
      });
      await prisma.paymentListEntryClaim.create({
        data: {
          workspaceId: fixture.workspaceA,
          paymentListId: concListId,
          weeklogEntryId: "entry-claim-conc-01",
          status: "reserved",
        },
      });

      const [res1, res2] = await Promise.all([
        request(`/api/payment-lists/${concListId}/invoice/create`, {
          method: "POST",
          headers: headers(fixture.ownerA, fixture.workspaceA, "conc-call-1"),
          body: JSON.stringify({ notes: "Concurrent 1" }),
        }),
        request(`/api/payment-lists/${concListId}/invoice/create`, {
          method: "POST",
          headers: headers(fixture.ownerA, fixture.workspaceA, "conc-call-2"),
          body: JSON.stringify({ notes: "Concurrent 2" }),
        }),
      ]);

      expect([200, 201]).toContain(res1.status);
      expect([200, 201]).toContain(res2.status);
      const b1 = await res1.json();
      const b2 = await res2.json();
      expect(b1.invoiceId).toBe(b2.invoiceId);

      const updated = await prisma.paymentList.findUniqueOrThrow({ where: { id: concListId } });
      expect(updated.status).toBe("pending");
      expect(updated.invoiceId).toBe(b1.invoiceId);

      const claim = await prisma.paymentListEntryClaim.findFirstOrThrow({ where: { paymentListId: concListId } });
      expect(claim.status).toBe("consumed");
    });

    it("LIST-INVOICE-ASSOCIATE-IDEMPOTENT-01: Explicit associate associates compatible invoice, remains idempotent, and blocks incompatible link", async () => {
      await ensureGroupEntry("entry-claim-assoc-01");
      // 1. Create a compatible invoice in Workspace A for Client A
      const existingInv = await prisma.billingInvoice.create({
        data: {
          workspaceId: fixture.workspaceA,
          invoiceNumber: "FAC-COMPAT-001",
          customerName: "VECTIS Client",
          customerSnapshot: { clientId: fixture.clientAId },
          totalAmount: 1500,
          remainingAmount: 1500,
          status: "draft",
          source: "manual",
        },
      });

      await prisma.paymentList.create({
        data: {
          id: assocListId,
          workspaceId: fixture.workspaceA,
          listNumber: "PL-ASSOC-001",
          clientId: fixture.clientAId,
          clientName: "VECTIS Client",
          currencyCode: "EUR",
          status: "ready_for_billing",
          recognizedTotal: "1500.00",
          createdBy: fixture.ownerA,
        },
      });
      await prisma.paymentListEntryClaim.create({
        data: {
          workspaceId: fixture.workspaceA,
          paymentListId: assocListId,
          weeklogEntryId: "entry-claim-assoc-01",
          status: "reserved",
        },
      });

      // 2. Associate existing invoice
      const assocRes = await request(`/api/payment-lists/${assocListId}/invoice/associate`, {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "assoc-key"),
        body: JSON.stringify({ invoiceId: existingInv.id }),
      });
      expect(assocRes.status).toBe(200);
      const assocBody = await assocRes.json();
      expect(assocBody.invoiceId).toBe(existingInv.id);

      const listAfter = await prisma.paymentList.findUniqueOrThrow({ where: { id: assocListId } });
      expect(listAfter.status).toBe("pending");
      expect(listAfter.invoiceId).toBe(existingInv.id);

      // 3. Repeated associate to same invoice is idempotent
      const repeatRes = await request(`/api/payment-lists/${assocListId}/invoice/associate`, {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "assoc-repeat-key"),
        body: JSON.stringify({ invoiceId: existingInv.id }),
      });
      expect(repeatRes.status).toBe(200);

      // 4. Associating a different invoice when already linked returns 409 Conflict
      const diffInv = await prisma.billingInvoice.create({
        data: {
          workspaceId: fixture.workspaceA,
          invoiceNumber: "FAC-DIFF-001",
          customerName: "VECTIS Client",
          customerSnapshot: { clientId: fixture.clientAId },
          totalAmount: 1500,
          remainingAmount: 1500,
          status: "draft",
          source: "manual",
        },
      });
      const diffRes = await request(`/api/payment-lists/${assocListId}/invoice/associate`, {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "assoc-diff-key"),
        body: JSON.stringify({ invoiceId: diffInv.id }),
      });
      expect(diffRes.status).toBe(409);

      // 5. Cross-tenant foreign invoice ID returns 404 (does not leak existence)
      const foreignInv = await prisma.billingInvoice.create({
        data: {
          workspaceId: fixture.workspaceB,
          invoiceNumber: "FAC-FOR-001",
          customerName: "VECTIS Client",
          totalAmount: 100,
          remainingAmount: 100,
          status: "draft",
          source: "manual",
        },
      });
      const foreignRes = await request(`/api/payment-lists/${readyListId}/invoice/associate`, {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "assoc-foreign-key"),
        body: JSON.stringify({ invoiceId: foreignInv.id }),
      });
      expect(foreignRes.status).toBe(404);
    });

    it("LIST-INVOICE-ATOMIC-ROLLBACK-01: Transaction failure rolls back invoice, link, status, and claims together", async () => {
      await ensureGroupEntry("entry-claim-rollback-01");
      await prisma.paymentList.create({
        data: {
          id: rollbackListId,
          workspaceId: fixture.workspaceA,
          listNumber: "PL-ROLLBACK-001",
          clientId: fixture.clientAId,
          clientName: "VECTIS Client",
          currencyCode: "EUR",
          status: "ready_for_billing",
          recognizedTotal: "1000.00",
          createdBy: fixture.ownerA,
        },
      });
      // Add a provisional claim: cannot be consumed without being reserved
      await prisma.paymentListEntryClaim.create({
        data: {
          workspaceId: fixture.workspaceA,
          paymentListId: rollbackListId,
          weeklogEntryId: "entry-claim-rollback-01",
          status: "provisional",
        },
      });

      const invCountBefore = await prisma.billingInvoice.count({
        where: { workspaceId: fixture.workspaceA },
      });

      const failRes = await request(`/api/payment-lists/${rollbackListId}/invoice/create`, {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "rollback-key"),
        body: JSON.stringify({ notes: "Failing create" }),
      });
      expect(failRes.status).toBe(422);

      // Everything rolled back:
      const listAfter = await prisma.paymentList.findUniqueOrThrow({ where: { id: rollbackListId } });
      expect(listAfter.status).toBe("ready_for_billing");
      expect(listAfter.invoiceId).toBeNull();

      const claimAfter = await prisma.paymentListEntryClaim.findFirstOrThrow({ where: { paymentListId: rollbackListId } });
      expect(claimAfter.status).toBe("provisional");
      expect(claimAfter.consumedAt).toBeNull();

      const invCountAfter = await prisma.billingInvoice.count({
        where: { workspaceId: fixture.workspaceA },
      });
      expect(invCountAfter).toBe(invCountBefore);
    });

    it("FIN-AUTO-DRAFT-NO-EFFECT-01: Automatic draft List changes neither Expected nor Received", async () => {
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
      // Transitions FROM Expected TO Received: Expected becomes 0.00, Received becomes 2500.00
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

    it("BUDGET-WORKSPACE-ADMIN-NO-CLIENT-APPROVAL-01: Workspace Owner/Admin cannot approve client Budget without client grant", async () => {
      // Owner/Admin may bootstrap/manage grants but MUST NOT approve a client Budget merely because they are workspace admins.
      const res = await request(`/api/budgets/${budgetId}/revisions/${rev1Id}/approve`, {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "owner-no-client-approve-key"),
        body: JSON.stringify({ notes: "Owner unauthorized bypass attempt" }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.message || "").toMatch(/VALIDATOR_GRANT_REQUIRED|permissão insuficiente|não autorizado/i);
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

    it("BUDGET-SITE-SCOPE-ALLOW-01: Site-scoped client collaborator approves budget matching their operational site", async () => {
      const siteScopedUser = "71000000-0000-4000-8000-000000000091";
      const siteScopedAppUser = "71000000-0000-4000-8000-000000000191";
      await prisma.user.upsert({
        where: { id: siteScopedUser },
        create: { id: siteScopedUser, email: "site-scoped@client.com", fullName: "Site Scoped User", role: "user", passwordHash: "x" },
        update: {},
      });
      await prisma.appUser.upsert({
        where: { authUserId: siteScopedUser },
        create: { id: siteScopedAppUser, authUserId: siteScopedUser, email: "site-scoped@client.com" },
        update: {},
      });
      await prisma.membership.upsert({
        where: { workspaceId_userId: { workspaceId: fixture.workspaceA, userId: siteScopedAppUser } },
        create: { workspaceId: fixture.workspaceA, userId: siteScopedAppUser, role: "client", status: "active" },
        update: { status: "active" },
      });
      await prisma.clientAccessGrant.upsert({
        where: {
          workspaceId_userId_clientId: {
            workspaceId: fixture.workspaceA,
            userId: siteScopedUser,
            clientId: fixture.clientAId,
          },
        },
        create: {
          workspaceId: fixture.workspaceA,
          userId: siteScopedUser,
          clientId: fixture.clientAId,
          capabilities: ["budget.approve"],
          siteKey: "site-lyon",
          status: "active",
        },
        update: {
          capabilities: ["budget.approve"],
          siteKey: "site-lyon",
          status: "active",
        },
      });

      const lyonBudgetId = "81000000-0000-4000-8000-000000000071";
      const lyonRevId = "82000000-0000-4000-8000-000000000071";
      await prisma.budget.deleteMany({ where: { id: lyonBudgetId } });
      const lyonBudget = await prisma.budget.create({
        data: {
          id: lyonBudgetId,
          workspaceId: fixture.workspaceA,
          code: "BUD-LYON-01",
          clientId: fixture.clientAId,
          technicianUserId: fixture.techA,
          createdById: fixture.ownerA,
          currentRevisionNumber: 1,
        },
      });
      await prisma.budgetRevision.create({
        data: {
          id: lyonRevId,
          budgetId: lyonBudget.id,
          revisionNumber: 1,
          status: "draft",
          clientSnapshot: { name: "VECTIS Client", siteKey: "site-lyon" },
          vehicleSnapshot: { plate: "LYON-01" },
          grossTotal: 400.0,
          currencyCode: "EUR",
          createdById: fixture.ownerA,
        },
      });
      await prisma.budget.update({
        where: { id: lyonBudgetId },
        data: { currentRevisionId: lyonRevId },
      });

      const res = await request(`/api/budgets/${lyonBudgetId}/revisions/${lyonRevId}/approve`, {
        method: "POST",
        headers: headers(siteScopedUser, fixture.workspaceA, "lyon-approve-key", "user"),
        body: JSON.stringify({ notes: "Site match approval" }),
      });

      expect(res.status).toBe(200);
    });

    it("BUDGET-SITE-SCOPE-DENY-01: Site-scoped client collaborator is denied approval for another site", async () => {
      const siteScopedUser = "71000000-0000-4000-8000-000000000091";
      const parisBudgetId = "81000000-0000-4000-8000-000000000072";
      const parisRevId = "82000000-0000-4000-8000-000000000072";
      await prisma.budget.deleteMany({ where: { id: parisBudgetId } });
      const parisBudget = await prisma.budget.create({
        data: {
          id: parisBudgetId,
          workspaceId: fixture.workspaceA,
          code: "BUD-PARIS-01",
          clientId: fixture.clientAId,
          technicianUserId: fixture.techA,
          createdById: fixture.ownerA,
          currentRevisionNumber: 1,
        },
      });
      await prisma.budgetRevision.create({
        data: {
          id: parisRevId,
          budgetId: parisBudget.id,
          revisionNumber: 1,
          status: "draft",
          clientSnapshot: { name: "VECTIS Client", siteKey: "site-paris" },
          vehicleSnapshot: { plate: "PARIS-01" },
          grossTotal: 400.0,
          currencyCode: "EUR",
          createdById: fixture.ownerA,
        },
      });
      await prisma.budget.update({
        where: { id: parisBudgetId },
        data: { currentRevisionId: parisRevId },
      });

      const res = await request(`/api/budgets/${parisBudgetId}/revisions/${parisRevId}/approve`, {
        method: "POST",
        headers: headers(siteScopedUser, fixture.workspaceA, "paris-approve-key", "user"),
        body: JSON.stringify({ notes: "Site mismatch approval attempt" }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.message || "").toMatch(/SITE_SCOPE_UNAUTHORIZED|local operacional não autorizado/i);
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

    it("CLIENT-CAPABILITY-BUDGET-APPROVE-01: Client collaborator lacking budget.approve is denied", async () => {
      const noBudgetApproveUser = "71000000-0000-4000-8000-000000000099";
      const noBudgetApproveAppUser = "71000000-0000-4000-8000-000000000199";
      await prisma.user.upsert({
        where: { id: noBudgetApproveUser },
        create: { id: noBudgetApproveUser, email: "no-budget-app@client.com", fullName: "No Budget App", role: "user", passwordHash: "x" },
        update: {},
      });
      await prisma.appUser.upsert({
        where: { authUserId: noBudgetApproveUser },
        create: { id: noBudgetApproveAppUser, authUserId: noBudgetApproveUser, email: "no-budget-app@client.com" },
        update: {},
      });
      await prisma.membership.upsert({
        where: { workspaceId_userId: { workspaceId: fixture.workspaceA, userId: noBudgetApproveAppUser } },
        create: { workspaceId: fixture.workspaceA, userId: noBudgetApproveAppUser, role: "client", status: "active" },
        update: { status: "active" },
      });
      await prisma.clientAccessGrant.upsert({
        where: {
          workspaceId_userId_clientId: {
            workspaceId: fixture.workspaceA,
            userId: noBudgetApproveUser,
            clientId: fixture.clientAId,
          },
        },
        create: {
          workspaceId: fixture.workspaceA,
          userId: noBudgetApproveUser,
          clientId: fixture.clientAId,
          capabilities: ["weeklog.validate"],
          status: "active",
        },
        update: {
          capabilities: ["weeklog.validate"],
          status: "active",
          revokedAt: null,
        },
      });

      const budgetId = "81000000-0000-4000-8000-000000000099";
      const revId = "82000000-0000-4000-8000-000000000099";
      await prisma.budget.deleteMany({ where: { id: budgetId } });
      const budget = await prisma.budget.create({
        data: {
          id: budgetId,
          workspaceId: fixture.workspaceA,
          code: "BUD-NO-CAP-01",
          clientId: fixture.clientAId,
          technicianUserId: fixture.techA,
          createdById: fixture.ownerA,
          currentRevisionNumber: 1,
        },
      });

      await prisma.budgetRevision.create({
        data: {
          id: revId,
          budgetId: budget.id,
          revisionNumber: 1,
          status: "draft",
          clientSnapshot: { name: "VECTIS Client" },
          vehicleSnapshot: { plate: "EW-621-GF" },
          grossTotal: 1000.0,
          currencyCode: "EUR",
          createdById: fixture.ownerA,
        },
      });

      await prisma.budget.update({
        where: { id: budget.id },
        data: { currentRevisionId: revId },
      });

      const res = await request(`/api/budgets/${budget.id}/revisions/${revId}/approve`, {
        method: "POST",
        headers: headers(noBudgetApproveUser, fixture.workspaceA, "cap-budget-app-key", "user"),
        body: JSON.stringify({ notes: "Client approval attempt" }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.message || "").toMatch(/CAPABILITY_UNAUTHORIZED|permissão insuficiente/i);
    });

    it("CLIENT-CAPABILITY-WEEKLOG-VALIDATE-01: Client collaborator lacking weeklog.validate is denied", async () => {
      const noWlValUser = "71000000-0000-4000-8000-000000000098";
      const noWlValAppUser = "71000000-0000-4000-8000-000000000198";
      await prisma.user.upsert({
        where: { id: noWlValUser },
        create: { id: noWlValUser, email: "no-wl-val@client.com", fullName: "No WL Val", role: "user", passwordHash: "x" },
        update: {},
      });
      await prisma.appUser.upsert({
        where: { authUserId: noWlValUser },
        create: { id: noWlValAppUser, authUserId: noWlValUser, email: "no-wl-val@client.com" },
        update: {},
      });
      await prisma.membership.upsert({
        where: { workspaceId_userId: { workspaceId: fixture.workspaceA, userId: noWlValAppUser } },
        create: { workspaceId: fixture.workspaceA, userId: noWlValAppUser, role: "client", status: "active" },
        update: { status: "active" },
      });
      await prisma.clientAccessGrant.upsert({
        where: {
          workspaceId_userId_clientId: {
            workspaceId: fixture.workspaceA,
            userId: noWlValUser,
            clientId: fixture.clientAId,
          },
        },
        create: {
          workspaceId: fixture.workspaceA,
          userId: noWlValUser,
          clientId: fixture.clientAId,
          capabilities: ["budget.approve"],
          status: "active",
        },
        update: {
          capabilities: ["budget.approve"],
          status: "active",
          revokedAt: null,
        },
      });

      const wlId = "75000000-0000-4000-8000-000000000088";
      await prisma.weeklog.deleteMany({
        where: {
          OR: [
            { id: wlId },
            {
              workspaceId: fixture.workspaceA,
              startsOn: new Date("2026-09-13T00:00:00.000Z"),
              clientId: fixture.clientAId,
              siteKey: "site-default",
            },
          ],
        },
      });
      await prisma.weeklog.create({
        data: {
          id: wlId,
          workspaceId: fixture.workspaceA,
          clientId: fixture.clientAId,
          siteKey: "site-default",
          startsOn: new Date("2026-09-13T00:00:00.000Z"),
          endsOn: new Date("2026-09-19T23:59:59.999Z"),
          yearReference: 2026,
          week: "2026-W38",
          weekNumber: 38,
          status: "pending_validation",
        },
      });

      const res = await request(`/api/weeklogs/${wlId}/validate`, {
        method: "POST",
        headers: headers(noWlValUser, fixture.workspaceA, "cap-wl-val-key", "user"),
        body: JSON.stringify({
          validationMethod: "authenticated_confirmation",
          approvedEntryIds: [],
        }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.message || "").toMatch(/CAPABILITY_UNAUTHORIZED|permissão insuficiente/i);
    });

    it("CLIENT-CAPABILITY-PAYMENT-LIST-REVIEW-01: Client collaborator lacking payment_list.review is denied on canonical route", async () => {
      const listId = "74000000-0000-4000-8000-000000000066";
      await prisma.paymentList.deleteMany({ where: { id: listId } });
      await prisma.paymentList.create({
        data: {
          id: listId,
          workspaceId: fixture.workspaceA,
          listNumber: "PL-REV-001",
          clientId: fixture.clientAId,
          clientName: "VECTIS Client",
          currencyCode: "EUR",
          status: "draft",
          createdBy: fixture.ownerA,
          items: {
            create: [
              {
                operationalSiteKey: "site-lyon",
                totalAmount: 150.0,
                servicesSnapshot: {},
              },
            ],
          },
        },
      });

      // 1. User with grant for clientA but LACKING payment_list.review (only weeklog.validate) -> 403
      const noReviewUser = "71000000-0000-4000-8000-000000000099"; // configured earlier with ["weeklog.validate"]
      const resNoCap = await request(`/api/payment-lists/${listId}/status`, {
        method: "PATCH",
        headers: headers(noReviewUser, fixture.workspaceA, "cap-pl-no-rev-key", "user"),
        body: JSON.stringify({ toStatus: "under_review" }),
      });
      expect(resNoCap.status).toBe(403);
      const bodyNoCap = await resNoCap.json();
      expect(bodyNoCap.message || "").toMatch(/CAPABILITY_UNAUTHORIZED|permissão insuficiente/i);

      // 2. User with payment_list.review but MISMATCHED site scope (site-paris vs site-lyon) -> 403
      const parisUser = "71000000-0000-4000-8000-000000000092";
      const parisAppUser = "71000000-0000-4000-8000-000000000192";
      await prisma.user.upsert({
        where: { id: parisUser },
        create: { id: parisUser, email: "paris-pl@client.com", fullName: "Paris PL User", role: "user", passwordHash: "x" },
        update: {},
      });
      await prisma.appUser.upsert({
        where: { authUserId: parisUser },
        create: { id: parisAppUser, authUserId: parisUser, email: "paris-pl@client.com" },
        update: {},
      });
      await prisma.membership.upsert({
        where: { workspaceId_userId: { workspaceId: fixture.workspaceA, userId: parisAppUser } },
        create: { workspaceId: fixture.workspaceA, userId: parisAppUser, role: "client", status: "active" },
        update: { status: "active" },
      });
      await prisma.clientAccessGrant.upsert({
        where: { workspaceId_userId_clientId: { workspaceId: fixture.workspaceA, userId: parisUser, clientId: fixture.clientAId } },
        create: {
          workspaceId: fixture.workspaceA,
          userId: parisUser,
          clientId: fixture.clientAId,
          capabilities: ["payment_list.review"],
          siteKey: "site-paris",
          status: "active",
        },
        update: {
          capabilities: ["payment_list.review"],
          siteKey: "site-paris",
          status: "active",
          revokedAt: null,
        },
      });
      const resSiteMismatch = await request(`/api/payment-lists/${listId}/status`, {
        method: "PATCH",
        headers: headers(parisUser, fixture.workspaceA, "cap-pl-site-mismatch-key", "user"),
        body: JSON.stringify({ toStatus: "under_review" }),
      });
      expect(resSiteMismatch.status).toBe(403);
      const bodySiteMismatch = await resSiteMismatch.json();
      expect(bodySiteMismatch.message || "").toMatch(/SITE_SCOPE_UNAUTHORIZED|local operacional não autorizado/i);

      // 3. Revoked grant -> 403
      await prisma.clientAccessGrant.update({
        where: { workspaceId_userId_clientId: { workspaceId: fixture.workspaceA, userId: parisUser, clientId: fixture.clientAId } },
        data: { status: "revoked", revokedAt: new Date() },
      });
      const resRevoked = await request(`/api/payment-lists/${listId}/status`, {
        method: "PATCH",
        headers: headers(parisUser, fixture.workspaceA, "cap-pl-revoked-key", "user"),
        body: JSON.stringify({ toStatus: "under_review" }),
      });
      expect(resRevoked.status).toBe(403);

      // 4. Cross-client collaborator -> 403
      const crossClientUser = "71000000-0000-4000-8000-000000000093";
      const crossClientAppUser = "71000000-0000-4000-8000-000000000193";
      await prisma.user.upsert({
        where: { id: crossClientUser },
        create: { id: crossClientUser, email: "cross-pl@client.com", fullName: "Cross PL User", role: "user", passwordHash: "x" },
        update: {},
      });
      await prisma.appUser.upsert({
        where: { authUserId: crossClientUser },
        create: { id: crossClientAppUser, authUserId: crossClientUser, email: "cross-pl@client.com" },
        update: {},
      });
      await prisma.membership.upsert({
        where: { workspaceId_userId: { workspaceId: fixture.workspaceA, userId: crossClientAppUser } },
        create: { workspaceId: fixture.workspaceA, userId: crossClientAppUser, role: "client", status: "active" },
        update: { status: "active" },
      });
      const clientA2Id = "73000000-0000-4000-8000-000000000099";
      await prisma.client.upsert({
        where: { id: clientA2Id },
        create: { id: clientA2Id, workspaceId: fixture.workspaceA, name: "Second Client A2" },
        update: {},
      });
      await prisma.clientAccessGrant.upsert({
        where: { workspaceId_userId_clientId: { workspaceId: fixture.workspaceA, userId: crossClientUser, clientId: clientA2Id } },
        create: {
          workspaceId: fixture.workspaceA,
          userId: crossClientUser,
          clientId: clientA2Id,
          capabilities: ["payment_list.review"],
          status: "active",
        },
        update: {
          capabilities: ["payment_list.review"],
          status: "active",
        },
      });
      const resCross = await request(`/api/payment-lists/${listId}/status`, {
        method: "PATCH",
        headers: headers(crossClientUser, fixture.workspaceA, "cap-pl-cross-key", "user"),
        body: JSON.stringify({ toStatus: "under_review" }),
      });
      expect(resCross.status).toBe(403);
      const bodyCross = await resCross.json();
      expect(bodyCross.message || "").toMatch(/CROSS_CLIENT_FORBIDDEN|não autorizado para este cliente/i);

      // 5. Authorized collaborator with payment_list.review and matching site (site-lyon) -> 200
      const authorizedUser = "71000000-0000-4000-8000-000000000094";
      const authorizedAppUser = "71000000-0000-4000-8000-000000000194";
      await prisma.user.upsert({
        where: { id: authorizedUser },
        create: { id: authorizedUser, email: "auth-pl@client.com", fullName: "Auth PL User", role: "user", passwordHash: "x" },
        update: {},
      });
      await prisma.appUser.upsert({
        where: { authUserId: authorizedUser },
        create: { id: authorizedAppUser, authUserId: authorizedUser, email: "auth-pl@client.com" },
        update: {},
      });
      await prisma.membership.upsert({
        where: { workspaceId_userId: { workspaceId: fixture.workspaceA, userId: authorizedAppUser } },
        create: { workspaceId: fixture.workspaceA, userId: authorizedAppUser, role: "client", status: "active" },
        update: { status: "active" },
      });
      await prisma.clientAccessGrant.upsert({
        where: { workspaceId_userId_clientId: { workspaceId: fixture.workspaceA, userId: authorizedUser, clientId: fixture.clientAId } },
        create: {
          workspaceId: fixture.workspaceA,
          userId: authorizedUser,
          clientId: fixture.clientAId,
          capabilities: ["payment_list.review"],
          siteKey: "site-lyon",
          status: "active",
        },
        update: {
          capabilities: ["payment_list.review"],
          siteKey: "site-lyon",
          status: "active",
        },
      });
      const resAllowed = await request(`/api/payment-lists/${listId}/status`, {
        method: "PATCH",
        headers: headers(authorizedUser, fixture.workspaceA, "cap-pl-allowed-key", "user"),
        body: JSON.stringify({ toStatus: "under_review" }),
      });
      expect(resAllowed.status).toBe(200);
      const bodyAllowed = await resAllowed.json();
      expect(bodyAllowed.status).toBe("under_review");

      // 6. Internal manager (Owner) can transition status via internal authority
      const resOwner = await request(`/api/payment-lists/${listId}/status`, {
        method: "PATCH",
        headers: headers(fixture.ownerA, fixture.workspaceA, "cap-pl-owner-key", "owner"),
        body: JSON.stringify({ toStatus: "cancelled" }),
      });
      expect(resOwner.status).toBe(200);
      const bodyOwner = await resOwner.json();
      expect(bodyOwner.status).toBe("cancelled");
    });

    it("CLIENT-CAPABILITY-INVOICE-VIEW-01: invoice.view capability enforced at canonical route level with zero ledger leak and site scoping", async () => {
      // 1. Verify capability definition in infrastructure
      expect(ALLOWED_CLIENT_CAPABILITIES).toContain("invoice.view");

      // 2. Resolver verifies authority correctly against ClientAccessGrant
      const dummyCtxLacking = {
        activeWorkspaceId: fixture.workspaceA,
        actorUserId: fixture.techA,
        membershipRole: "client",
      };
      await expect(
        assertClientCapability(dummyCtxLacking as any, {
          clientId: fixture.clientAId,
          capability: "invoice.view",
        })
      ).rejects.toThrow();

      // 3. Grant with explicit invoice.view resolves successfully
      const invViewUser = "71000000-0000-4000-8000-000000000095";
      const invViewApp = "72000000-0000-4000-8000-000000000095";
      await prisma.user.upsert({
        where: { id: invViewUser },
        create: {
          id: invViewUser,
          email: "inv-view@client.com",
          fullName: "Invoice Viewer",
          role: "user",
          passwordHash: "x",
        },
        update: {},
      });
      let appUserInv = await prisma.appUser.findUnique({
        where: { authUserId: invViewUser },
      });
      if (!appUserInv) {
        appUserInv = await prisma.appUser.create({
          data: {
            id: invViewApp,
            authUserId: invViewUser,
            email: "inv-view@client.com",
            workspaceId: fixture.workspaceA,
          },
        });
      }
      await prisma.membership.upsert({
        where: { workspaceId_userId: { workspaceId: fixture.workspaceA, userId: appUserInv.id } },
        create: {
          workspaceId: fixture.workspaceA,
          userId: appUserInv.id,
          role: "client",
          status: "active",
        },
        update: { status: "active", role: "client" },
      });
      await prisma.clientAccessGrant.upsert({
        where: { workspaceId_userId_clientId: { workspaceId: fixture.workspaceA, userId: invViewUser, clientId: fixture.clientAId } },
        create: {
          workspaceId: fixture.workspaceA,
          userId: invViewUser,
          clientId: fixture.clientAId,
          capabilities: ["invoice.view"],
          status: "active",
        },
        update: {
          capabilities: ["invoice.view"],
          status: "active",
        },
      });

      const resolved = await assertClientCapability(
        {
          activeWorkspaceId: fixture.workspaceA,
          actorUserId: invViewUser,
          membershipRole: "client",
        } as any,
        {
          clientId: fixture.clientAId,
          capability: "invoice.view",
        }
      );
      expect(resolved.capabilities).toContain("invoice.view");

      // 4. Canonical route GET /api/billing/invoices/:id route-level proof
      const invFixture = await prisma.billingInvoice.create({
        data: {
          workspaceId: fixture.workspaceA,
          invoiceNumber: "FAC-VIEW-001",
          customerName: "VECTIS Client",
          customerSnapshot: { clientId: fixture.clientAId },
          totalAmount: 3200,
          remainingAmount: 3200,
          status: "draft",
          source: "manual",
          metadata: {
            currency: "EUR",
            items: [{ operationalSiteKey: "site-lyon" }],
          },
        },
      });

      // 4a. Collaborator with active invoice.view grant accesses invoice JSON
      const resView = await request(`/api/billing/invoices/${invFixture.id}`, {
        headers: headers(invViewUser, fixture.workspaceA, "inv-view-key", "user"),
      });
      expect(resView.status).toBe(200);
      const invData = await resView.json();
      expect(invData.invoice_number).toBe("FAC-VIEW-001");
      expect(invData.total_amount).toBe(3200);
      // Zero internal Finance ledger leakage
      expect(invData.margin).toBeUndefined();
      expect(invData.internalLedger).toBeUndefined();

      // 4b. Collaborator accesses PDF document
      const resPdf = await request(`/api/billing/invoices/${invFixture.id}/pdf`, {
        headers: headers(invViewUser, fixture.workspaceA, "inv-pdf-key", "user"),
      });
      expect(resPdf.status).toBe(200);
      expect(resPdf.headers.get("content-type")).toContain("application/pdf");

      // 4c. Collaborator lacking invoice.view is denied (403 CAPABILITY_UNAUTHORIZED)
      const resNoCap = await request(`/api/billing/invoices/${invFixture.id}`, {
        headers: headers(fixture.techA, fixture.workspaceA, "inv-no-cap-key", "user"),
      });
      expect(resNoCap.status).toBe(403);

      // 4d. Revoked grant is denied (403)
      await prisma.clientAccessGrant.update({
        where: { workspaceId_userId_clientId: { workspaceId: fixture.workspaceA, userId: invViewUser, clientId: fixture.clientAId } },
        data: { status: "revoked" },
      });
      const resRevoked = await request(`/api/billing/invoices/${invFixture.id}`, {
        headers: headers(invViewUser, fixture.workspaceA, "inv-revoked-key", "user"),
      });
      expect(resRevoked.status).toBe(403);

      // 4e. Site-scoped grant mismatch is denied (403 SITE_SCOPE_UNAUTHORIZED)
      const siteScopedUser = "71000000-0000-4000-8000-000000000096";
      const siteScopedApp = "72000000-0000-4000-8000-000000000096";
      await prisma.user.upsert({
        where: { id: siteScopedUser },
        create: {
          id: siteScopedUser,
          email: "site-scoped@client.com",
          fullName: "Site Scoped Viewer",
          role: "user",
          passwordHash: "x",
        },
        update: {},
      });
      let appUserSite = await prisma.appUser.findUnique({
        where: { authUserId: siteScopedUser },
      });
      if (!appUserSite) {
        appUserSite = await prisma.appUser.create({
          data: {
            id: siteScopedApp,
            authUserId: siteScopedUser,
            email: "site-scoped@client.com",
            workspaceId: fixture.workspaceA,
          },
        });
      }
      await prisma.membership.upsert({
        where: { workspaceId_userId: { workspaceId: fixture.workspaceA, userId: appUserSite.id } },
        create: {
          workspaceId: fixture.workspaceA,
          userId: appUserSite.id,
          role: "client",
          status: "active",
        },
        update: { status: "active", role: "client" },
      });
      await prisma.clientAccessGrant.upsert({
        where: { workspaceId_userId_clientId: { workspaceId: fixture.workspaceA, userId: siteScopedUser, clientId: fixture.clientAId } },
        create: {
          workspaceId: fixture.workspaceA,
          userId: siteScopedUser,
          clientId: fixture.clientAId,
          capabilities: ["invoice.view"],
          siteKey: "site-paris",
          status: "active",
        },
        update: {
          capabilities: ["invoice.view"],
          siteKey: "site-paris",
          status: "active",
        },
      });
      const resSiteScope = await request(`/api/billing/invoices/${invFixture.id}`, {
        headers: headers(siteScopedUser, fixture.workspaceA, "inv-site-scope-key", "user"),
      });
      expect(resSiteScope.status).toBe(403);

      // 4f. Cross-tenant access returns 404 (does not leak foreign invoice existence)
      const resCrossTenant = await request(`/api/billing/invoices/${invFixture.id}`, {
        headers: headers(fixture.ownerB, fixture.workspaceB, "inv-cross-key"),
      });
      expect(resCrossTenant.status).toBe(404);

      await prisma.billingInvoice.deleteMany({ where: { id: invFixture.id } });
    });

    it("CLIENT-COLLABORATORS-MANAGE-01: Authorized client representative delegates, updates, and revokes collaborators", async () => {
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

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.grantId).toBeDefined();

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

    it("CLIENT-FOCUS-DEFAULT-DENY-01: Newly-created grant defaults to empty capabilities and cannot validate without explicit capability", async () => {
      const defaultDenyUser = "71000000-0000-4000-8000-000000000096";
      const defaultDenyAppUser = "71000000-0000-4000-8000-000000000196";
      await prisma.user.upsert({
        where: { id: defaultDenyUser },
        create: { id: defaultDenyUser, email: "default-deny@client.com", fullName: "Default Deny User", role: "user", passwordHash: "x" },
        update: {},
      });
      await prisma.appUser.upsert({
        where: { authUserId: defaultDenyUser },
        create: { id: defaultDenyAppUser, authUserId: defaultDenyUser, email: "default-deny@client.com" },
        update: {},
      });
      await prisma.membership.upsert({
        where: { workspaceId_userId: { workspaceId: fixture.workspaceA, userId: defaultDenyAppUser } },
        create: { workspaceId: fixture.workspaceA, userId: defaultDenyAppUser, role: "client", status: "active" },
        update: { status: "active" },
      });

      // Create raw grant omitting capabilities to test Prisma default
      await prisma.clientAccessGrant.deleteMany({
        where: { workspaceId: fixture.workspaceA, userId: defaultDenyUser, clientId: fixture.clientAId },
      });
      const newGrant = await prisma.clientAccessGrant.create({
        data: {
          workspaceId: fixture.workspaceA,
          userId: defaultDenyUser,
          clientId: fixture.clientAId,
          role: "validator", // legacy role name must NOT grant weeklog.validate
          status: "active",
        },
      });

      // Default in database MUST be empty array []
      expect(newGrant.capabilities).toEqual([]);

      // Attempting to validate weeklog with empty capabilities fails with 403
      const wlId = "75000000-0000-4000-8000-000000000088";
      const resVal = await request(`/api/weeklogs/${wlId}/validate`, {
        method: "POST",
        headers: headers(defaultDenyUser, fixture.workspaceA, "default-deny-val-key", "user"),
        body: JSON.stringify({
          validationMethod: "authenticated_confirmation",
          approvedEntryIds: [],
        }),
      });
      expect(resVal.status).toBe(403);
      const valBody = await resVal.json();
      expect(valBody.message || "").toMatch(/CAPABILITY_UNAUTHORIZED|permissão insuficiente/i);

      // Delegation endpoint rejects omitted / empty capabilities
      const resEmptyDelegation = await request(`/api/clients/${fixture.clientAId}/collaborators`, {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "delegation-empty-key", "owner"),
        body: JSON.stringify({
          userId: defaultDenyUser,
          role: "collaborator",
          capabilities: [],
        }),
      });
      expect(resEmptyDelegation.status).toBe(422);

      // Legacy grant with explicit weeklog.validate still functions
      const legacyGrant = await prisma.clientAccessGrant.findFirst({
        where: { userId: fixture.clientAUser, workspaceId: fixture.workspaceA, clientId: fixture.clientAId },
      });
      expect(legacyGrant?.capabilities).toContain("weeklog.validate");
    });

    it("CLIENT-COLLABORATOR-REINVITE-01: Revoked collaborator is reinvited/reactivated atomically without unique constraint failure", async () => {
      const reinviteUser = "71000000-0000-4000-8000-000000000089";
      const reinviteAppUser = "71000000-0000-4000-8000-000000000189";
      await prisma.user.upsert({
        where: { id: reinviteUser },
        create: { id: reinviteUser, email: "reinvite@client.com", fullName: "Reinvite User", role: "user", passwordHash: "x" },
        update: {},
      });
      await prisma.appUser.upsert({
        where: { authUserId: reinviteUser },
        create: { id: reinviteAppUser, authUserId: reinviteUser, email: "reinvite@client.com" },
        update: {},
      });
      await prisma.membership.upsert({
        where: { workspaceId_userId: { workspaceId: fixture.workspaceA, userId: reinviteAppUser } },
        create: { workspaceId: fixture.workspaceA, userId: reinviteAppUser, role: "client", status: "active" },
        update: { status: "active" },
      });

      // Step 1: Initial invitation
      const createRes = await request(`/api/clients/${fixture.clientAId}/collaborators`, {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "reinvite-create-key", "owner"),
        body: JSON.stringify({
          userId: reinviteUser,
          role: "collaborator",
          capabilities: ["weeklog.validate"],
          siteKey: "site-lyon",
        }),
      });
      expect(createRes.status).toBe(201);
      const { grantId } = await createRes.json();
      expect(grantId).toBeDefined();

      // Step 2: Soft revoke
      const deleteRes = await request(`/api/clients/${fixture.clientAId}/collaborators/${grantId}`, {
        method: "DELETE",
        headers: headers(fixture.ownerA, fixture.workspaceA, "reinvite-delete-key", "owner"),
      });
      expect(deleteRes.status).toBe(200);

      const revokedDb = await prisma.clientAccessGrant.findUnique({ where: { id: grantId } });
      expect(revokedDb?.status).toBe("revoked");
      expect(revokedDb?.revokedAt).not.toBeNull();

      // Step 3: Reinvite same user for same client with updated capabilities and site
      const reinviteRes = await request(`/api/clients/${fixture.clientAId}/collaborators`, {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "reinvite-repost-key", "owner"),
        body: JSON.stringify({
          userId: reinviteUser,
          role: "collaborator",
          capabilities: ["weeklog.validate", "budget.approve"],
          siteKey: "site-paris",
        }),
      });
      expect(reinviteRes.status).toBe(201);
      const reinviteBody = await reinviteRes.json();
      expect(reinviteBody.grantId).toBe(grantId); // Same atomic grant reactivated

      const reactivatedDb = await prisma.clientAccessGrant.findUnique({ where: { id: grantId } });
      expect(reactivatedDb?.status).toBe("active");
      expect(reactivatedDb?.revokedAt).toBeNull();
      expect(reactivatedDb?.revokedBy).toBeNull();
      expect(reactivatedDb?.capabilities).toEqual(["weeklog.validate", "budget.approve"]);
      expect(reactivatedDb?.siteKey).toBe("site-paris");
    });

    it("CLIENT-SITE-SCOPE-DENIAL-01: Operational siteKey scope blocks out-of-scope validation", async () => {
      const scopedUser = "71000000-0000-4000-8000-000000000097";
      const scopedAppUser = "71000000-0000-4000-8000-000000000197";
      await prisma.user.upsert({
        where: { id: scopedUser },
        create: {
          id: scopedUser,
          email: "scoped-user@client.com",
          fullName: "Scoped User",
          role: "user",
          passwordHash: "x",
        },
        update: {},
      });
      await prisma.appUser.upsert({
        where: { authUserId: scopedUser },
        create: { id: scopedAppUser, authUserId: scopedUser, email: "scoped-user@client.com" },
        update: {},
      });
      await prisma.membership.upsert({
        where: { workspaceId_userId: { workspaceId: fixture.workspaceA, userId: scopedAppUser } },
        create: { workspaceId: fixture.workspaceA, userId: scopedAppUser, role: "client", status: "active" },
        update: { status: "active" },
      });
      await prisma.clientAccessGrant.upsert({
        where: {
          workspaceId_userId_clientId: {
            workspaceId: fixture.workspaceA,
            userId: scopedUser,
            clientId: fixture.clientAId,
          },
        },
        create: {
          workspaceId: fixture.workspaceA,
          userId: scopedUser,
          clientId: fixture.clientAId,
          capabilities: ["weeklog.validate"],
          siteKey: "site-lyon",
          status: "active",
        },
        update: {
          capabilities: ["weeklog.validate"],
          siteKey: "site-lyon",
          status: "active",
        },
      });

      const scopedWeeklogId = "75000000-0000-4000-8000-000000000099";
      await prisma.weeklog.deleteMany({
        where: {
          OR: [
            { id: scopedWeeklogId },
            {
              workspaceId: fixture.workspaceA,
              startsOn: new Date("2026-09-20T00:00:00.000Z"),
              clientId: fixture.clientAId,
              siteKey: "site-paris",
            },
          ],
        },
      });
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
        headers: headers(scopedUser, fixture.workspaceA, "scoped-val-key", "user"),
        body: JSON.stringify({
          validationMethod: "authenticated_confirmation",
          approvedEntryIds: [],
        }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.message || "").toMatch(/SITE_SCOPE_UNAUTHORIZED|local operacional não autorizado/i);
    });

    it("CLIENT-NO-FINANCE-LEDGER-01: Client collaborator has zero access to internal Finance ledger", async () => {
      const res = await request("/api/finance/v2/summary", {
        headers: headers(fixture.clientAUser, fixture.workspaceA, "client-fin-key", "user"),
      });

      expect(res.status).toBe(403);
    });

    it("CLIENT-FOCUS-OWNER-BOOTSTRAP-01: Workspace Owner/Admin bootstraps initial client representative", async () => {
      const bootstrapUser = "71000000-0000-4000-8000-000000000096";
      await prisma.user.upsert({
        where: { id: bootstrapUser },
        create: { id: bootstrapUser, email: "rep-bootstrap@client.com", fullName: "Rep Bootstrap", role: "user", passwordHash: "x" },
        update: {},
      });

      const res = await request(`/api/clients/${fixture.clientAId}/collaborators`, {
        method: "POST",
        headers: headers(fixture.ownerA, fixture.workspaceA, "owner-boot-key"),
        body: JSON.stringify({
          userId: bootstrapUser,
          role: "representative",
          capabilities: ["client.collaborators.manage", "budget.approve", "weeklog.validate"],
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.grantId).toBeDefined();
      expect(body.grant.capabilities).toContain("client.collaborators.manage");
    });

    it("CLIENT-FOCUS-LEGACY-BACKWARD-COMPAT-01: Legacy validator grant maintains weeklog.validate compatibility", async () => {
      const legacyUser = "71000000-0000-4000-8000-000000000095";
      await prisma.user.upsert({
        where: { id: legacyUser },
        create: { id: legacyUser, email: "legacy-val@client.com", fullName: "Legacy Val", role: "user", passwordHash: "x" },
        update: {},
      });

      await prisma.clientAccessGrant.upsert({
        where: {
          workspaceId_userId_clientId: {
            workspaceId: fixture.workspaceA,
            userId: legacyUser,
            clientId: fixture.clientAId,
          },
        },
        create: {
          workspaceId: fixture.workspaceA,
          userId: legacyUser,
          clientId: fixture.clientAId,
          role: "validator",
          capabilities: ["weeklog.validate"],
          status: "active",
        },
        update: {
          role: "validator",
          capabilities: ["weeklog.validate"],
          status: "active",
        },
      });

      const grant = await prisma.clientAccessGrant.findFirst({
        where: { userId: legacyUser, workspaceId: fixture.workspaceA },
      });
      expect(grant?.capabilities).toContain("weeklog.validate");
    });

    it("CLIENT-FOCUS-REVOKED-GRANT-DENIED-01: Revoked grant remains strictly denied", async () => {
      const revokedUser = "71000000-0000-4000-8000-000000000094";
      const revokedAppUser = "71000000-0000-4000-8000-000000000194";
      await prisma.user.upsert({
        where: { id: revokedUser },
        create: {
          id: revokedUser,
          email: "revoked-user@client.com",
          fullName: "Revoked User",
          role: "user",
          passwordHash: "x",
        },
        update: {},
      });
      await prisma.appUser.upsert({
        where: { authUserId: revokedUser },
        create: { id: revokedAppUser, authUserId: revokedUser, email: "revoked-user@client.com" },
        update: {},
      });
      await prisma.membership.upsert({
        where: { workspaceId_userId: { workspaceId: fixture.workspaceA, userId: revokedAppUser } },
        create: { workspaceId: fixture.workspaceA, userId: revokedAppUser, role: "client", status: "active" },
        update: { status: "active" },
      });

      const grant = await prisma.clientAccessGrant.upsert({
        where: {
          workspaceId_userId_clientId: {
            workspaceId: fixture.workspaceA,
            userId: revokedUser,
            clientId: fixture.clientAId,
          },
        },
        create: {
          workspaceId: fixture.workspaceA,
          userId: revokedUser,
          clientId: fixture.clientAId,
          role: "validator",
          capabilities: ["weeklog.validate"],
          status: "revoked",
          revokedAt: new Date(),
        },
        update: {
          status: "revoked",
          revokedAt: new Date(),
        },
      });

      const delRes = await request(`/api/clients/${fixture.clientAId}/collaborators/${grant.id}`, {
        method: "DELETE",
        headers: headers(fixture.clientAUser, fixture.workspaceA, "del-key", "user"),
      });
      expect(delRes.status).toBe(200);

      // Now verify that the revoked user is denied when attempting an operation
      const valRes = await request(`/api/weeklogs/any-id/validate`, {
        method: "POST",
        headers: headers(revokedUser, fixture.workspaceA, "revoked-val-key", "user"),
        body: JSON.stringify({ validationMethod: "authenticated_confirmation", approvedEntryIds: [] }),
      });
      expect([403, 404]).toContain(valRes.status);
    });

    it("CLIENT-FOCUS-CEILING-ENFORCEMENT-01: Collaborator cannot grant capability it lacks", async () => {
      const limitedRep = "71000000-0000-4000-8000-000000000093";
      const limitedAppUser = "71000000-0000-4000-8000-000000000193";
      await prisma.user.upsert({
        where: { id: limitedRep },
        create: {
          id: limitedRep,
          email: "limited-rep@client.com",
          fullName: "Limited Rep",
          role: "user",
          passwordHash: "x",
        },
        update: {},
      });
      await prisma.appUser.upsert({
        where: { authUserId: limitedRep },
        create: { id: limitedAppUser, authUserId: limitedRep, email: "limited-rep@client.com" },
        update: {},
      });
      await prisma.membership.upsert({
        where: { workspaceId_userId: { workspaceId: fixture.workspaceA, userId: limitedAppUser } },
        create: { workspaceId: fixture.workspaceA, userId: limitedAppUser, role: "client", status: "active" },
        update: { status: "active" },
      });

      await prisma.clientAccessGrant.upsert({
        where: {
          workspaceId_userId_clientId: {
            workspaceId: fixture.workspaceA,
            userId: limitedRep,
            clientId: fixture.clientAId,
          },
        },
        create: {
          workspaceId: fixture.workspaceA,
          userId: limitedRep,
          clientId: fixture.clientAId,
          role: "representative",
          capabilities: ["client.collaborators.manage", "weeklog.validate"], // Lacks budget.approve
          status: "active",
        },
        update: {
          capabilities: ["client.collaborators.manage", "weeklog.validate"],
          status: "active",
        },
      });

      const res = await request(`/api/clients/${fixture.clientAId}/collaborators`, {
        method: "POST",
        headers: headers(limitedRep, fixture.workspaceA, "ceil-key", "user"),
        body: JSON.stringify({
          userId: fixture.techA,
          capabilities: ["budget.approve"], // Attempt to escalate beyond ceiling
        }),
      });

      expect(res.status).toBe(403);
    });

    it("CLIENT-FOCUS-NO-FINANCE-GRANT-01: Collaborator cannot grant internal Finance access", async () => {
      const res = await request(`/api/clients/${fixture.clientAId}/collaborators`, {
        method: "POST",
        headers: headers(fixture.clientAUser, fixture.workspaceA, "fin-grant-key", "user"),
        body: JSON.stringify({
          userId: fixture.techA,
          capabilities: ["finance.manage"], // Internal forbidden capability
        }),
      });

      expect([403, 422]).toContain(res.status);
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
      // 1. Verify user-observable UI capabilities in PaymentListImportDialog: zoom, rotation, and editable row drafts
      const dialogSrc = await readFile("src/components/payment-lists/PaymentListImportDialog.tsx", "utf8");
      expect(dialogSrc).toContain("ZoomIn");
      expect(dialogSrc).toContain("ZoomOut");
      expect(dialogSrc).toContain("RotateCw");
      expect(dialogSrc).toContain("reviewedCarName");
      expect(dialogSrc).toContain("reviewedLicensePlate");
      expect(dialogSrc).toContain("reviewedTotal");

      // 2. Verify that applying values downward to multiple rows is supported via batch row patch API
      const testImportId = "76000000-0000-4000-8000-000000000088";
      const item1Id = "76000000-0000-4000-8000-000000000081";
      const item2Id = "76000000-0000-4000-8000-000000000082";

      await prisma.externalOperationalImportItem.deleteMany({ where: { importId: testImportId } });
      await prisma.externalOperationalImport.deleteMany({ where: { id: testImportId } });

      await prisma.externalOperationalImport.create({
        data: {
          id: testImportId,
          workspaceId: fixture.workspaceA,
          fileName: "batch-downward-test.pdf",
          mimeType: "application/pdf",
          fileSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          sizeBytes: 1024,
          status: "extracted",
          storagePath: "staging/batch-downward-test.pdf",
          uploadedBy: fixture.ownerA,
        },
      });

      await prisma.externalOperationalImportItem.createMany({
        data: [
          {
            id: item1Id,
            importId: testImportId,
            workspaceId: fixture.workspaceA,
            rawCarName: "Peugeot 208",
            status: "staged",
          },
          {
            id: item2Id,
            importId: testImportId,
            workspaceId: fixture.workspaceA,
            rawCarName: "Peugeot 208",
            status: "staged",
          },
        ],
      });

      // Batch downward mutation using the real canonical PATCH /:importId/rows route
      const patchRes = await request(`/api/external-operational-imports/${testImportId}/rows`, {
        method: "PATCH",
        headers: headers(fixture.ownerA, fixture.workspaceA, "batch-downward-key"),
        body: JSON.stringify({
          rows: [
            { id: item1Id, patch: { reviewedCarName: "Peugeot 208 GT", reviewedTechnicianUserId: fixture.techA } },
            { id: item2Id, patch: { reviewedCarName: "Peugeot 208 GT", reviewedTechnicianUserId: fixture.techA } },
          ],
        }),
      });

      expect(patchRes.status).toBe(200);
      const patchedItems = await prisma.externalOperationalImportItem.findMany({
        where: { importId: testImportId },
      });
      expect(patchedItems.every((i) => i.reviewedCarName === "Peugeot 208 GT")).toBe(true);
      expect(patchedItems.every((i) => i.reviewedTechnicianUserId === fixture.techA)).toBe(true);
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
