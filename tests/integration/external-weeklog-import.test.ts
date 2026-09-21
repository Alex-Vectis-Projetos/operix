// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
// @ts-expect-error backend dependency
import express, { type Request, type Response, type NextFunction } from "../../backend/node_modules/express/index.js";
import { prisma } from "../../backend/src/lib/prisma.js";
import { signAccessToken } from "../../backend/src/lib/jwt.js";
import { ForbiddenError } from "../../backend/src/lib/objectAuth.js";
import { aiImportExtractionProvider, minioImportDocumentStorage } from "../../backend/src/services/externalImportAdapters.js";

// Configurações de ambiente mínimas para testes
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://operix_local:U2dkA-cJYnwHuD7hiAY2hPTrkawjg6f8@127.0.0.1:55432/operix_local?schema=public";
process.env.JWT_SECRET = process.env.JWT_SECRET || "this-is-a-test-secret-with-more-than-32-chars-long";
process.env.MINIO_ROOT_PASSWORD = process.env.MINIO_ROOT_PASSWORD || "miniopassword123456";

/**
 * Spec 004 — External WEEKLOG Import & Frozen Validation Coverage Suite (T01/T02 Baseline)
 * 
 * Cobre os 7 cenários do Grupo 3 (Staging de WEEKLOG Externo, XOR Estrutural sem POs falsas,
 * Idempotência de Commit, Concorrência Real, Snapshot Congelado de Cobertura, Inelegibilidade
 * de Entradas Tardias e Rejeição de Criação Direta sem Evidência Formal):
 * 
 * - IMPORT-WEEKLOG-REVIEW-01
 * - IMPORT-WEEKLOG-NO-FAKE-PO-01
 * - IMPORT-WEEKLOG-COMMIT-IDEMPOTENT-01
 * - IMPORT-WEEKLOG-CONCURRENT-COMMIT-01
 * - IMPORT-WEEKLOG-COVERAGE-01
 * - IMPORT-WEEKLOG-LATE-ENTRY-01
 * - IMPORT-WEEKLOG-NO-DIRECT-APPROVE-01
 */

const FIXTURES_004_WEEKLOG = {
  wsAlpha: "40000000-0000-4000-8000-000000000030",
  wsBravo: "40000000-0000-4000-8000-000000000040",
  ownerA: {
    userId: "41000000-0000-4000-8000-000000000030",
    appUserId: "42000000-0000-4000-8000-000000000030",
    email: "owner.a.wlimport@example.com",
    role: "owner",
  },
  foreignTechnician: {
    userId: "41000000-0000-4000-8000-000000000041",
    appUserId: "42000000-0000-4000-8000-000000000041",
    email: "foreign.tech.wlimport@example.com",
  },
  clientA: {
    id: "43000000-0000-4000-8000-000000000030",
    name: "Cliente Parceiro Oficina Externa",
  },
};

describe("Spec 004 — External WEEKLOG Import & Coverage Suite (T01/T02 Baseline)", () => {
  let app: express.Express;
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    await cleanupTestData();

    await prisma.user.create({
      data: {
        id: FIXTURES_004_WEEKLOG.ownerA.userId,
        email: FIXTURES_004_WEEKLOG.ownerA.email,
        fullName: "Owner Weeklog Import",
        role: "admin",
        passwordHash: "hash-spec004-wl-test",
        isActive: true,
        appUser: {
          create: {
            id: FIXTURES_004_WEEKLOG.ownerA.appUserId,
            email: FIXTURES_004_WEEKLOG.ownerA.email,
            name: "Owner Weeklog Import",
          },
        },
      },
    });

    await prisma.user.create({
      data: {
        id: FIXTURES_004_WEEKLOG.foreignTechnician.userId,
        email: FIXTURES_004_WEEKLOG.foreignTechnician.email,
        fullName: "Foreign Technician",
        role: "user",
        passwordHash: "hash-spec004-foreign-tech",
        isActive: true,
        appUser: { create: { id: FIXTURES_004_WEEKLOG.foreignTechnician.appUserId, email: FIXTURES_004_WEEKLOG.foreignTechnician.email, name: "Foreign Technician" } },
      },
    });

    await prisma.workspace.create({
      data: {
        id: FIXTURES_004_WEEKLOG.wsAlpha,
        name: "Workspace Alpha External WL 004",
        timezone: "Europe/Paris",
        ownerUserId: FIXTURES_004_WEEKLOG.ownerA.appUserId,
        memberships: {
          create: [
            { id: "mem-004-wl-oa", userId: FIXTURES_004_WEEKLOG.ownerA.appUserId, role: "owner", status: "active" },
          ],
        },
      },
    });

    await prisma.client.create({
      data: {
        id: FIXTURES_004_WEEKLOG.clientA.id,
        workspaceId: FIXTURES_004_WEEKLOG.wsAlpha,
        name: FIXTURES_004_WEEKLOG.clientA.name,
      },
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanOperationalData();
    vi.spyOn(minioImportDocumentStorage, "put").mockResolvedValue();
    vi.spyOn(aiImportExtractionProvider, "extractOperationalDocument").mockResolvedValue({
      raw: { provider: "synthetic-test" },
      rows: [{ rawLicensePlate: "AA-11-BB", rawVin: "WVWZZZ1JZXW000001", rawCarName: "Golf", rawClientName: "Parceiro OCR", rawCurrencyCode: "EUR", rawOperationalSiteKey: "SITE-PDR-01", rawTechnician: "Técnico OCR", rawDeliveredAtText: "2026-09-21T12:00:00Z", rawServices: [{ code: "PDR" }], rawTotalText: "€ 125,50" }],
    });

    app = express();
    app.use(express.json());

    // Rota existente de weeklogs
    const { weeklogsRouter } = await import("../../backend/src/routes/weeklogs.js");
    app.use("/api/weeklogs", weeklogsRouter);

    // Rota futura de importações operacionais externas
    try {
      // @ts-expect-error route created in T06
      const { externalOperationalImportsRouter } = await import("../../backend/src/routes/externalOperationalImports.js");
      app.use("/api/external-operational-imports", externalOperationalImportsRouter);
    } catch {
      // In T01/T02 router is not yet implemented
    }

    const { ZodError } = await import("zod");
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      if (err instanceof ZodError || err?.name === "ZodError") {
        return res.status(400).json({ message: "Payload inválido.", issues: err.issues });
      }
      const statusCode = err?.statusCode || (err instanceof ForbiddenError || err?.name === "ForbiddenError" ? 403 : 500);
      res.status(statusCode).json({ message: err?.message || "Internal error" });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${typeof addr === "object" ? addr?.port : 0}`;
        resolve();
      });
    });
  });

  afterEach(() => {
    if (server) {
      server.close();
    }
    vi.restoreAllMocks();
  });

  async function cleanOperationalData() {
    await prisma.weeklogValidation.deleteMany({
      where: { workspaceId: FIXTURES_004_WEEKLOG.wsAlpha },
    });
    await prisma.weeklogEntry.deleteMany({
      where: { workspaceId: FIXTURES_004_WEEKLOG.wsAlpha },
    });
    await prisma.weeklog.deleteMany({
      where: { workspaceId: FIXTURES_004_WEEKLOG.wsAlpha },
    });
    await prisma.productionOrder.deleteMany({
      where: { workspaceId: FIXTURES_004_WEEKLOG.wsAlpha },
    });
    await prisma.externalOperationalImportItem.deleteMany({ where: { workspaceId: FIXTURES_004_WEEKLOG.wsAlpha } });
    await prisma.externalOperationalImport.deleteMany({ where: { workspaceId: FIXTURES_004_WEEKLOG.wsAlpha } });
  }

  async function cleanupTestData() {
    await cleanOperationalData();
    await prisma.client.deleteMany({
      where: { workspaceId: FIXTURES_004_WEEKLOG.wsAlpha },
    });
    await prisma.membership.deleteMany({
      where: { workspaceId: FIXTURES_004_WEEKLOG.wsAlpha },
    });
    await prisma.workspace.deleteMany({
      where: { id: FIXTURES_004_WEEKLOG.wsAlpha },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [FIXTURES_004_WEEKLOG.ownerA.userId, FIXTURES_004_WEEKLOG.foreignTechnician.userId] } },
    });
  }

  function getAuthHeader(user: { userId: string; email: string; role: string }, workspaceId?: string) {
    const token = signAccessToken({
      id: user.userId,
      email: user.email,
      role: user.role === "owner" ? "admin" : "user",
    });
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    if (workspaceId) {
      headers["X-Workspace-Id"] = workspaceId;
    }
    return headers;
  }

  describe("Grupo 3: Importação Externa de WEEKLOG & Cobertura Congelada", () => {
    it("IMPORT-WEEKLOG-REVIEW-01: Staging e Revisão de WEEKLOG Externo", async () => {
      // Given: Folha escaneada de parceiro externo
      const uploadPayload = {
        fileName: "folha_semanal_oficina_parceira.pdf",
        mimeType: "application/pdf",
          contentBase64: Buffer.from("%PDF-1.7\nsynthetic weeklog").toString("base64"),
      };

      // When: Upload na esteira operacional externa
      const res = await fetch(`${baseUrl}/api/external-operational-imports`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_WEEKLOG.ownerA, FIXTURES_004_WEEKLOG.wsAlpha),
        body: JSON.stringify(uploadPayload),
      });

      // Then: Retorna HTTP 201 com staging relacional e rawTotalText preservado
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.importId).toBeDefined();
      expect(data.status).toBe("extracted");
      expect(data.items).toBeInstanceOf(Array);
    });

    it("IMPORT-TECH-CROSS-TENANT-01: técnico global sem membership não pode ser authority revisada", async () => {
      const headers = getAuthHeader(FIXTURES_004_WEEKLOG.ownerA, FIXTURES_004_WEEKLOG.wsAlpha);
      const created = await fetch(`${baseUrl}/api/external-operational-imports`, {
        method: "POST", headers,
        body: JSON.stringify({ fileName: "review-weeklog.pdf", mimeType: "application/pdf", contentBase64: Buffer.from("%PDF-1.7\nreview operational").toString("base64") }),
      });
      expect(created.status).toBe(201);
      const importData = await created.json();
      const item = importData.items[0];
      const before = await Promise.all([
        prisma.paymentList.count({ where: { workspaceId: FIXTURES_004_WEEKLOG.wsAlpha } }),
        prisma.weeklog.count({ where: { workspaceId: FIXTURES_004_WEEKLOG.wsAlpha } }),
        prisma.weeklogEntry.count({ where: { workspaceId: FIXTURES_004_WEEKLOG.wsAlpha } }),
        prisma.weeklogValidation.count({ where: { workspaceId: FIXTURES_004_WEEKLOG.wsAlpha } }),
      ]);
      const rejected = await fetch(`${baseUrl}/api/external-operational-imports/${importData.importId}/rows`, {
        method: "PATCH", headers,
        body: JSON.stringify({ rows: [{ id: item.id, patch: { reviewedTechnicianUserId: FIXTURES_004_WEEKLOG.foreignTechnician.userId } }] }),
      });
      expect(rejected.status).toBe(403);
      const reviewed = await fetch(`${baseUrl}/api/external-operational-imports/${importData.importId}/rows`, {
        method: "PATCH", headers,
        body: JSON.stringify({ rows: [{ id: item.id, patch: {
          reviewedLicensePlate: "AA-11-BB",
          reviewedVin: "WVWZZZ1JZXW000001",
          reviewedClientId: FIXTURES_004_WEEKLOG.clientA.id,
          reviewedCurrencyCode: "EUR",
          reviewedOperationalSiteKey: "SITE-PDR-01",
          reviewedTechnicianUserId: FIXTURES_004_WEEKLOG.ownerA.userId,
          reviewedDeliveredAt: "2026-09-21T12:00:00.000Z",
          reviewedServices: [{ code: "PDR", quantity: "1", amount: "125.50" }],
          reviewedTotal: "1250,50",
        } }] }),
      });
      expect(reviewed.status).toBe(200);
      const reviewBody = await reviewed.json();
      expect(reviewBody.status).toBe("reviewed");
      expect(reviewBody.items[0].reviewedDeliveredAt).toBeDefined();
      expect(await Promise.all([
        prisma.paymentList.count({ where: { workspaceId: FIXTURES_004_WEEKLOG.wsAlpha } }),
        prisma.weeklog.count({ where: { workspaceId: FIXTURES_004_WEEKLOG.wsAlpha } }),
        prisma.weeklogEntry.count({ where: { workspaceId: FIXTURES_004_WEEKLOG.wsAlpha } }),
        prisma.weeklogValidation.count({ where: { workspaceId: FIXTURES_004_WEEKLOG.wsAlpha } }),
      ])).toEqual(before);
    });

    it("IMPORT-WEEKLOG-NO-FAKE-PO-01: Materialização Canônica sem Fabricação de OPs Fictícias", async () => {
      // Given: Lote de WEEKLOG externo revisado pelo gestor
      const importId = "44000000-0000-4000-8000-000000000031";

      // When: Gestor efetiva o lote
      const res = await fetch(`${baseUrl}/api/external-operational-imports/${importId}/commit`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_WEEKLOG.ownerA, FIXTURES_004_WEEKLOG.wsAlpha),
        body: JSON.stringify({}),
      });

      // Then: HTTP 200, materializa WeeklogEntry com sourceType = 'external_import' e productionOrderId = null
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.entries).toBeDefined();
      for (const entry of data.entries) {
        expect(entry.sourceType).toBe("external_import");
        expect(entry.productionOrderId).toBeNull();
        expect(entry.externalImportItemId).toBeDefined();
      }

      // Zero OPs fictícias criadas
      const poCount = await prisma.productionOrder.count({
        where: { workspaceId: FIXTURES_004_WEEKLOG.wsAlpha },
      });
      expect(poCount).toBe(0);
    });

    it("IMPORT-WEEKLOG-COMMIT-IDEMPOTENT-01: Idempotência de Retry no Commit de Importação Operacional Externa", async () => {
      // Given: Lote de importação operacional externa em staging
      const importId = "44000000-0000-4000-8000-000000000032";
      const headers = getAuthHeader(FIXTURES_004_WEEKLOG.ownerA, FIXTURES_004_WEEKLOG.wsAlpha);

      // When: Primeiro commit
      const res1 = await fetch(`${baseUrl}/api/external-operational-imports/${importId}/commit`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      // Then: Primeiro commit retorna HTTP 201 Created (materialização)
      expect(res1.status).toBe(201);
      const data1 = await res1.json();

      // When: Retry da MESMA operação já materializada
      const res2 = await fetch(`${baseUrl}/api/external-operational-imports/${importId}/commit`, {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });
      // Then: Retry idempotente retorna HTTP 200 OK com exatamente os mesmos dados sem duplicar
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.materializationId || data2.weeklogId).toBe(data1.materializationId || data1.weeklogId);
    });

    it("IMPORT-WEEKLOG-CONCURRENT-COMMIT-01: Prevenção de Materialização Concorrente Duplicada", async () => {
      // Given: Duas requisições paralelas concorrentes tentando comitar o mesmo lote
      const importId = "44000000-0000-4000-8000-000000000033";
      const headers = getAuthHeader(FIXTURES_004_WEEKLOG.ownerA, FIXTURES_004_WEEKLOG.wsAlpha);

      // When: Concorrência real via Promise.all
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/external-operational-imports/${importId}/commit`, {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        }),
        fetch(`${baseUrl}/api/external-operational-imports/${importId}/commit`, {
          method: "POST",
          headers,
          body: JSON.stringify({}),
        }),
      ]);

      // Then: Ambas convergem para sucesso (uma 201 e uma 200 idempotente, ou ambas 200), sem erro 500 nem colisão vazada
      expect([200, 201]).toContain(res1.status);
      expect([200, 201]).toContain(res2.status);
      const data1 = await res1.json();
      const data2 = await res2.json();
      expect(data1.weeklogId || data1.materializationId).toBe(data2.weeklogId || data2.materializationId);
    });

    it("IMPORT-WEEKLOG-COVERAGE-01: Validação Formal com Snapshot Congelado de Cobertura", async () => {
      // Given: Commit de WEEKLOG externo com 3 entradas
      const importId = "44000000-0000-4000-8000-000000000034";

      // When: Efetivação do lote
      const res = await fetch(`${baseUrl}/api/external-operational-imports/${importId}/commit`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_WEEKLOG.ownerA, FIXTURES_004_WEEKLOG.wsAlpha),
        body: JSON.stringify({}),
      });

      // Then: Cria WeeklogValidation com validationMethod = 'external_import_review' e coverageSnapshot estruturado
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.validation).toBeDefined();
      expect(data.validation.validationMethod).toBe("external_import_review");
      expect(data.validation.coverageSnapshot.schemaVersion).toBeDefined();
      expect(data.validation.coverageSnapshot.sourceType).toBe("external_import");
      expect(data.validation.coverageSnapshot.sha256).toBeDefined();
      expect(data.validation.coverageSnapshot.entries).toHaveLength(3);
    });

    it("IMPORT-WEEKLOG-LATE-ENTRY-01: Inelegibilidade de Entradas Tardias para Cobertura em Validação Prévia", async () => {
      // Given: Rodada de validação já consolidada para lote semanal
      const weeklog = await prisma.weeklog.create({
        data: {
          id: "wl-004-late-entry",
          workspaceId: FIXTURES_004_WEEKLOG.wsAlpha,
          week: "2026-W33",
          startsOn: new Date("2026-08-10T00:00:00Z"),
          endsOn: new Date("2026-08-16T23:59:59Z"),
          clientId: FIXTURES_004_WEEKLOG.clientA.id,
          siteKey: "SITE-PDR-01",
          status: "validated",
        },
      });

      await prisma.weeklogValidation.create({
        data: {
          id: "val-004-frozen-snap",
          weeklogId: weeklog.id,
          workspaceId: FIXTURES_004_WEEKLOG.wsAlpha,
          validationSequence: 1,
          validationMethod: "external_import_review",
          status: "validated",
          coverageSnapshot: {
            schemaVersion: "1.0",
            sourceType: "external_import",
            entries: [{ entryId: "entry-004-prior-1" }, { entryId: "entry-004-prior-2" }],
          },
        },
      });

      // When: Nova entrada tardia é adicionada a posteriori no mesmo Weeklog
      const lateEntry = await prisma.weeklogEntry.create({
        data: {
          id: "entry-004-late-added",
          weeklogId: weeklog.id,
          workspaceId: FIXTURES_004_WEEKLOG.wsAlpha,
          technicianUserId: FIXTURES_004_WEEKLOG.ownerA.userId,
          technicianName: "Owner WL",
          executionSequence: 1,
          currencyCode: "EUR",
          totalAmount: "250.00",
          performedServices: [{ description: "Serviço Tardio", amount: "250.00" }],
          validationStatus: "pending",
        },
      });

      // Then: A entrada tardia não herda o status validated da rodada prévia
      expect(lateEntry.validationStatus).toBe("pending");
      const validation = await prisma.weeklogValidation.findUnique({
        where: { id: "val-004-frozen-snap" },
      });
      const snapshotEntries = (validation?.coverageSnapshot as any)?.entries || [];
      const coveredIds = snapshotEntries.map((e: any) => e.entryId);
      expect(coveredIds).not.toContain(lateEntry.id);
    });

    it("IMPORT-WEEKLOG-NO-DIRECT-APPROVE-01: Rejeição de Criação Direta sem Evidência Formal", async () => {
      // Given: Tentativa de criar WeeklogEntry direto via API com validationStatus = 'approved'
      const res = await fetch(`${baseUrl}/api/weeklogs/any-id/entries`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_WEEKLOG.ownerA, FIXTURES_004_WEEKLOG.wsAlpha),
        body: JSON.stringify({
          validationStatus: "approved",
          performedServices: [{ description: "Tentativa de aprovação direta", amount: "500.00" }],
        }),
      });

      // Then: Rejeitada com HTTP 422 Unprocessable Entity
      expect(res.status).toBe(422);
    });
  });
});
