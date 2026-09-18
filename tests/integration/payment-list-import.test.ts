// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
// @ts-expect-error backend dependency
import express, { type Request, type Response, type NextFunction } from "../../backend/node_modules/express/index.js";
import { prisma } from "../../backend/src/lib/prisma.js";
import { signAccessToken } from "../../backend/src/lib/jwt.js";
import { ForbiddenError } from "../../backend/src/lib/objectAuth.js";

// Configurações de ambiente mínimas para testes
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://operix_local:U2dkA-cJYnwHuD7hiAY2hPTrkawjg6f8@127.0.0.1:55432/operix_local?schema=public";
process.env.JWT_SECRET = process.env.JWT_SECRET || "this-is-a-test-secret-with-more-than-32-chars-long";
process.env.MINIO_ROOT_PASSWORD = process.env.MINIO_ROOT_PASSWORD || "miniopassword123456";

/**
 * Spec 004 — Payment List External Import & Staging Suite (T01/T02 Baseline)
 * 
 * Cobre os 5 cenários do Grupo 2 (Upload, Staging Relacional, Preservação Monetária Bruta,
 * Proveniência MinIO, Proibição de Auto-Commit e Bloqueio Cross-Tenant):
 * 
 * - IMPORT-LIST-REVIEW-01
 * - IMPORT-MONEY-RAW-PRESERVED-01
 * - IMPORT-PROVENANCE-01
 * - IMPORT-NO-AUTO-COMMIT-01
 * - IMPORT-CROSS-TENANT-01
 */

const FIXTURES_004_IMPORT = {
  wsAlpha: "40000000-0000-4000-8000-000000000010",
  wsBravo: "40000000-0000-4000-8000-000000000020",
  ownerA: {
    userId: "41000000-0000-4000-8000-000000000010",
    appUserId: "42000000-0000-4000-8000-000000000010",
    email: "owner.a.import@example.com",
    role: "owner",
  },
  ownerB: {
    userId: "41000000-0000-4000-8000-000000000020",
    appUserId: "42000000-0000-4000-8000-000000000020",
    email: "owner.b.import@example.com",
    role: "owner",
  },
  clientA: {
    id: "43000000-0000-4000-8000-000000000010",
    name: "Cliente Import Alpha",
  },
};

describe("Spec 004 — Payment List External Import Suite (T01/T02 Baseline)", () => {
  let app: express.Express;
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    await cleanupTestData();

    for (const actor of [FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.ownerB]) {
      await prisma.user.create({
        data: {
          id: actor.userId,
          email: actor.email,
          fullName: actor.email.split("@")[0],
          role: "admin",
          passwordHash: "hash-spec004-import-test",
          isActive: true,
          appUser: {
            create: {
              id: actor.appUserId,
              email: actor.email,
              name: actor.email.split("@")[0],
            },
          },
        },
      });
    }

    await prisma.workspace.create({
      data: {
        id: FIXTURES_004_IMPORT.wsAlpha,
        name: "Workspace Alpha Import 004",
        timezone: "Europe/Paris",
        ownerUserId: FIXTURES_004_IMPORT.ownerA.appUserId,
        memberships: {
          create: [{ id: "mem-004-imp-oa", userId: FIXTURES_004_IMPORT.ownerA.appUserId, role: "owner", status: "active" }],
        },
      },
    });

    await prisma.workspace.create({
      data: {
        id: FIXTURES_004_IMPORT.wsBravo,
        name: "Workspace Bravo Import 004",
        timezone: "Europe/Paris",
        ownerUserId: FIXTURES_004_IMPORT.ownerB.appUserId,
        memberships: {
          create: [{ id: "mem-004-imp-ob", userId: FIXTURES_004_IMPORT.ownerB.appUserId, role: "owner", status: "active" }],
        },
      },
    });

    await prisma.client.create({
      data: {
        id: FIXTURES_004_IMPORT.clientA.id,
        workspaceId: FIXTURES_004_IMPORT.wsAlpha,
        name: FIXTURES_004_IMPORT.clientA.name,
      },
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    app = express();
    app.use(express.json());

    // Rota futura de importação de listas
    try {
      // @ts-expect-error route created in T06
      const { paymentListsRouter } = await import("../../backend/src/routes/paymentLists.js");
      app.use("/api/payment-lists", paymentListsRouter);
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
  });

  async function cleanupTestData() {
    await prisma.client.deleteMany({
      where: { workspaceId: { in: [FIXTURES_004_IMPORT.wsAlpha, FIXTURES_004_IMPORT.wsBravo] } },
    });
    await prisma.membership.deleteMany({
      where: { workspaceId: { in: [FIXTURES_004_IMPORT.wsAlpha, FIXTURES_004_IMPORT.wsBravo] } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: [FIXTURES_004_IMPORT.wsAlpha, FIXTURES_004_IMPORT.wsBravo] } },
    });
    await prisma.user.deleteMany({
      where: {
        id: { in: [FIXTURES_004_IMPORT.ownerA.userId, FIXTURES_004_IMPORT.ownerB.userId] },
      },
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

  describe("Grupo 2: Importação Externa de Documentos & Proveniência", () => {
    it("IMPORT-LIST-REVIEW-01: Upload com Proveniência MinIO e Staging Relacional", async () => {
      // Given: Gestor autenticado com arquivo PDF de fatura comercial
      const dummyFilePayload = {
        fileName: "fatura_pdr_32.pdf",
        mimeType: "application/pdf",
        contentBase64: Buffer.from("DUMMY_PDF_CONTENT_FOR_IMPORT").toString("base64"),
        clientId: FIXTURES_004_IMPORT.clientA.id,
      };

      // When: Upload no endpoint de staging de importação
      const res = await fetch(`${baseUrl}/api/payment-lists/imports`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha),
        body: JSON.stringify(dummyFilePayload),
      });

      // Then: HTTP 201 com proveniência e linhas editáveis no staging, sem criar PaymentList direta
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.importId).toBeDefined();
      expect(data.sha256).toBeDefined();
      expect(data.status).toBe("staged");
      expect(data.items).toBeInstanceOf(Array);
    });

    it("IMPORT-MONEY-RAW-PRESERVED-01: Preservação de Texto Monetário Bruto de OCR sem Conversão Float Prematura", async () => {
      // Given: Upload de documento contendo texto monetário '€ 1.250,50'
      const res = await fetch(`${baseUrl}/api/payment-lists/imports/test-raw-import`, {
        headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha),
      });

      // Then: Retorna o item de staging com rawTotalText verbatim '€ 1.250,50' e reviewedTotal null
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.item.rawTotalText).toBe("€ 1.250,50");
      expect(data.item.reviewedTotal).toBeNull();
    });

    it("IMPORT-PROVENANCE-01: Auditoria e Rastreabilidade de Arquivo Original", async () => {
      // Given: Uma PaymentList criada a partir de uma importação externa efetivada
      const listId = "44000000-0000-4000-8000-000000000021";

      // When: Gestor consulta os detalhes da lista
      const res = await fetch(`${baseUrl}/api/payment-lists/${listId}`, {
        headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha),
      });

      // Then: A lista referencia formalmente o sourceImport com hash SHA-256 e download URL MinIO
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sourceImport).toBeDefined();
      expect(data.sourceImport.sha256).toBeDefined();
      expect(data.sourceImport.originalDownloadUrl).toBeDefined();
    });

    it("IMPORT-NO-AUTO-COMMIT-01: Proibição de Commit Automático sem Validação Humana e Campos Obrigatórios", async () => {
      // Given: Staging com identidade veicular incompleta (reviewedVin = null e reviewedLicensePlate = null)
      const importId = "44000000-0000-4000-8000-000000000022";

      // When: Operador tenta comitar o import incompleto
      const res = await fetch(`${baseUrl}/api/payment-lists/imports/${importId}/commit`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha),
        body: JSON.stringify({}),
      });

      // Then: Rejeição com HTTP 422 (MISSING_REQUIRED_STAGING_FIELDS)
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.code || data.message).toMatch(/MISSING_REQUIRED_STAGING_FIELDS|STAGING_FIELDS_REQUIRED/i);
    });

    it("IMPORT-CROSS-TENANT-01: Bloqueio de Commit Cross-Tenant de Staging", async () => {
      // Given: Import de staging existente no Workspace B
      const importBId = "44000000-0000-4000-8000-000000000099";

      // When: Usuário do Workspace A tenta comitar o import do Workspace B
      const res = await fetch(`${baseUrl}/api/payment-lists/imports/${importBId}/commit`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha),
        body: JSON.stringify({}),
      });

      // Then: Requisição falha com HTTP 404 Not Found (ou 403 Forbidden)
      expect([403, 404]).toContain(res.status);
    });
  });
});
