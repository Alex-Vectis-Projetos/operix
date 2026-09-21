// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
// @ts-expect-error backend dependency
import express, { type Request, type Response, type NextFunction } from "../../backend/node_modules/express/index.js";
import { prisma } from "../../backend/src/lib/prisma.js";
import { signAccessToken } from "../../backend/src/lib/jwt.js";
import { ForbiddenError } from "../../backend/src/lib/objectAuth.js";
import { aiImportExtractionProvider, minioImportDocumentStorage } from "../../backend/src/services/externalImportAdapters.js";
import { fetchAICompletion, parseToolCall } from "../../backend/src/lib/ai.js";

vi.mock("../../backend/src/lib/ai.js", () => ({ fetchAICompletion: vi.fn(), parseToolCall: vi.fn() }));

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
  clientB: {
    id: "43000000-0000-4000-8000-000000000020",
    name: "Cliente Import Bravo",
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
    await prisma.client.create({
      data: { id: FIXTURES_004_IMPORT.clientB.id, workspaceId: FIXTURES_004_IMPORT.wsBravo, name: FIXTURES_004_IMPORT.clientB.name },
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    vi.spyOn(minioImportDocumentStorage, "put").mockResolvedValue();
    vi.spyOn(minioImportDocumentStorage, "read").mockResolvedValue(Buffer.from("%PDF-1.7\nretry original"));
    vi.spyOn(aiImportExtractionProvider, "extractListDocument").mockResolvedValue({
      raw: { provider: "synthetic-test" },
      rows: [{ rawLicensePlate: "AA-11-BB", rawVin: "WVWZZZ1JZXW000001", rawCarName: "Golf", rawServices: [{ code: "PDR" }], rawTotalText: "€ 1.250,50" }],
    });
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
    vi.restoreAllMocks();
  });

  async function cleanupTestData() {
    await prisma.externalListImportItem.deleteMany({ where: { workspaceId: { in: [FIXTURES_004_IMPORT.wsAlpha, FIXTURES_004_IMPORT.wsBravo] } } });
    await prisma.externalListImport.deleteMany({ where: { workspaceId: { in: [FIXTURES_004_IMPORT.wsAlpha, FIXTURES_004_IMPORT.wsBravo] } } });
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
          contentBase64: Buffer.from("%PDF-1.7\nsynthetic import").toString("base64"),
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
      expect(data.status).toBe("extracted");
      expect(data.items).toBeInstanceOf(Array);
    });

    it("IMPORT-MONEY-RAW-PRESERVED-01: Preservação de Texto Monetário Bruto de OCR sem Conversão Float Prematura", async () => {
      // Given: Upload de documento contendo texto monetário '€ 1.250,50'
      const create = await fetch(`${baseUrl}/api/payment-lists/imports`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha),
        body: JSON.stringify({ fileName: "raw-money.pdf", mimeType: "application/pdf", contentBase64: Buffer.from("%PDF-1.7\nraw money").toString("base64") }),
      });
      expect(create.status).toBe(201);
      const created = await create.json();
      const res = await fetch(`${baseUrl}/api/payment-lists/imports/${created.importId}`, { headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha) });

      // Then: Retorna o item de staging com rawTotalText verbatim '€ 1.250,50' e reviewedTotal null
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.item.rawTotalText).toBe("€ 1.250,50");
      expect(data.item.reviewedTotal).toBeNull();
    });

    it("IMPORT-PROVENANCE-01: Auditoria e Rastreabilidade de Arquivo Original", async () => {
      // Given: Uma importação externa estagiada; materialização em PaymentList é T06.
      const create = await fetch(`${baseUrl}/api/payment-lists/imports`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha),
        body: JSON.stringify({ fileName: "provenance.pdf", mimeType: "application/pdf", contentBase64: Buffer.from("%PDF-1.7\nprovenance").toString("base64") }),
      });
      const created = await create.json();

      // When: Gestor consulta a proveniência persistida no staging
      const res = await fetch(`${baseUrl}/api/payment-lists/imports/${created.importId}`, {
        headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha),
      });

      // Then: staging preserva nome original, hash e chave governada; não cria PaymentList em T05.
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.import.fileName).toBe("provenance.pdf");
      expect(data.import.fileSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(data.import.storagePath).toMatch(/^tenants\/.+\/lists\/imports\/.+\/original_provenance\.pdf$/);
      expect(await prisma.paymentList.count({ where: { workspaceId: FIXTURES_004_IMPORT.wsAlpha } })).toBe(0);
    });

    it("IMPORT-NO-AUTO-COMMIT-01: Proibição de Commit Automático sem Validação Humana e Campos Obrigatórios", async () => {
      // Given: Staging com identidade veicular incompleta (reviewedVin = null e reviewedLicensePlate = null)
      const create = await fetch(`${baseUrl}/api/payment-lists/imports`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha),
        body: JSON.stringify({ fileName: "incomplete-review.pdf", mimeType: "application/pdf", contentBase64: Buffer.from("%PDF-1.7\nincomplete review").toString("base64") }),
      });
      expect(create.status).toBe(201);
      const { importId } = await create.json();

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
      // Given: Upload e criação de staging relacional no Workspace B
      const createRes = await fetch(`${baseUrl}/api/payment-lists/imports`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_IMPORT.ownerB, FIXTURES_004_IMPORT.wsBravo),
        body: JSON.stringify({
          fileName: "lista_cliente_bravo.pdf",
          mimeType: "application/pdf",
          contentBase64: Buffer.from("%PDF-1.7\nother tenant").toString("base64"),
        }),
      });
      expect(createRes.status).toBe(201);
      const { importId } = await createRes.json();

      // When: Usuário do Workspace A tenta comitar o import do Workspace B
      const res = await fetch(`${baseUrl}/api/payment-lists/imports/${importId}/commit`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha),
        body: JSON.stringify({}),
      });

      // Then: Requisição falha com HTTP 404 Not Found deny-by-default
      expect(res.status).toBe(404);
    });

    it("IMPORT-AUTH-01: upload exige bearer válido", async () => {
      const res = await fetch(`${baseUrl}/api/payment-lists/imports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: "unauthenticated.pdf", mimeType: "application/pdf", contentBase64: Buffer.from("%PDF-1.7\nunauthenticated").toString("base64") }),
      });
      expect(res.status).toBe(401);
    });

    it("IMPORT-WORKSPACE-SPOOF-01: header de workspace sem membership é rejeitado", async () => {
      const res = await fetch(`${baseUrl}/api/payment-lists/imports`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsBravo),
        body: JSON.stringify({ fileName: "spoof.pdf", mimeType: "application/pdf", contentBase64: Buffer.from("%PDF-1.7\nspoof").toString("base64") }),
      });
      expect(res.status).toBe(403);
    });

    it("IMPORT-OBJECT-CROSS-TENANT-01: leitura de import de outro tenant é deny-by-default", async () => {
      const created = await fetch(`${baseUrl}/api/payment-lists/imports`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha),
        body: JSON.stringify({ fileName: "alpha.pdf", mimeType: "application/pdf", contentBase64: Buffer.from("%PDF-1.7\nalpha").toString("base64") }),
      });
      const { importId } = await created.json();
      const res = await fetch(`${baseUrl}/api/payment-lists/imports/${importId}`, { headers: getAuthHeader(FIXTURES_004_IMPORT.ownerB, FIXTURES_004_IMPORT.wsBravo) });
      expect(res.status).toBe(404);
    });

    it("IMPORT-ROW-CROSS-IMPORT-01: uma linha não pode ser revisada através de outro import", async () => {
      const makeImport = async (fileName: string) => {
        const res = await fetch(`${baseUrl}/api/payment-lists/imports`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha),
          body: JSON.stringify({ fileName, mimeType: "application/pdf", contentBase64: Buffer.from("%PDF-1.7\nrow scope").toString("base64") }),
        });
        return res.json();
      };
      const [first, second] = await Promise.all([makeImport("first.pdf"), makeImport("second.pdf")]);
      const res = await fetch(`${baseUrl}/api/payment-lists/imports/${first.importId}/rows`, {
        method: "PATCH",
        headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha),
        body: JSON.stringify({ rows: [{ id: second.items[0].id, patch: { reviewedLicensePlate: "AA11BB" } }] }),
      });
      expect(res.status).toBe(404);
    });

    it("IMPORT-PATH-TRAVERSAL-01 e IMPORT-MIME-01: arquivo inseguro é rejeitado antes de storage/extraction", async () => {
      const headers = getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha);
      const traversal = await fetch(`${baseUrl}/api/payment-lists/imports`, {
        method: "POST", headers,
        body: JSON.stringify({ fileName: "../escape.pdf", mimeType: "application/pdf", contentBase64: Buffer.from("%PDF-1.7\nunsafe").toString("base64") }),
      });
      const mime = await fetch(`${baseUrl}/api/payment-lists/imports`, {
        method: "POST", headers,
        body: JSON.stringify({ fileName: "unsafe.txt", mimeType: "text/plain", contentBase64: Buffer.from("not a document").toString("base64") }),
      });
      expect(traversal.status).toBe(422);
      expect(mime.status).toBe(422);
      expect(minioImportDocumentStorage.put).not.toHaveBeenCalled();
      expect(aiImportExtractionProvider.extractListDocument).not.toHaveBeenCalled();
    });

    it("IMPORT-SIZE-01: multipart acima do limite é rejeitado pela rota antes de staging", async () => {
      const form = new FormData();
      form.set("file", new Blob([Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(10 * 1024 * 1024)])], { type: "application/pdf" }), "oversized.pdf");
      const token = signAccessToken({ id: FIXTURES_004_IMPORT.ownerA.userId, email: FIXTURES_004_IMPORT.ownerA.email, role: "admin" });
      const res = await fetch(`${baseUrl}/api/payment-lists/imports`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "X-Workspace-Id": FIXTURES_004_IMPORT.wsAlpha },
        body: form,
      });
      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe("IMPORT_FILE_SIZE_INVALID");
      expect(minioImportDocumentStorage.put).not.toHaveBeenCalled();
    });

    it("IMPORT-STORAGE-FAILURE-01: falha de promoção preserva cabeçalho failed sem path fictício", async () => {
      vi.spyOn(minioImportDocumentStorage, "put").mockRejectedValueOnce(new Error("synthetic storage failure"));
      const res = await fetch(`${baseUrl}/api/payment-lists/imports`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha),
        body: JSON.stringify({ fileName: "storage-failure.pdf", mimeType: "application/pdf", contentBase64: Buffer.from("%PDF-1.7\nstorage failure").toString("base64") }),
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      const record = await prisma.externalListImport.findUniqueOrThrow({ where: { id: body.importId } });
      expect(record.status).toBe("failed");
      expect(record.storagePath).toBeNull();
      expect(record.fileSha256).toBeNull();
    });

    it("IMPORT-CLIENT-CROSS-TENANT-01: authority revisada de cliente é validada no workspace ativo", async () => {
      const create = await fetch(`${baseUrl}/api/payment-lists/imports`, {
        method: "POST", headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha),
        body: JSON.stringify({ fileName: "review-client.pdf", mimeType: "application/pdf", contentBase64: Buffer.from("%PDF-1.7\nreview client").toString("base64") }),
      });
      const imported = await create.json();
      const rejected = await fetch(`${baseUrl}/api/payment-lists/imports/${imported.importId}/rows`, {
        method: "PATCH", headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha),
        body: JSON.stringify({ header: { reviewedClientId: FIXTURES_004_IMPORT.clientB.id, reviewedCurrencyCode: "EUR" } }),
      });
      expect(rejected.status).toBe(422);
    });

    it("IMPORT-EXTRACTION-FAILURE-01: falha de provider preserva proveniência, sem staging authority", async () => {
      vi.spyOn(aiImportExtractionProvider, "extractListDocument").mockRejectedValueOnce(new Error("synthetic provider timeout"));
      const res = await fetch(`${baseUrl}/api/payment-lists/imports`, {
        method: "POST", headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha),
        body: JSON.stringify({ fileName: "provider-failure.pdf", mimeType: "application/pdf", contentBase64: Buffer.from("%PDF-1.7\nprovider failure").toString("base64") }),
      });
      expect(res.status).toBe(503);
      const body = await res.json();
      const record = await prisma.externalListImport.findUniqueOrThrow({ where: { id: body.importId }, include: { items: true } });
      expect(record.status).toBe("failed");
      expect(record.storagePath).toMatch(/^tenants\//);
      expect(record.fileSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(record.items).toHaveLength(0);
      expect(record.reviewedClientId).toBeNull();
      expect(record.reviewedCurrencyCode).toBeNull();
    });

    it("IMPORT-PROVIDER-DTO-01: saída vazia, serviço inválido e JSON malformado são rejeitados pelo adapter Zod", async () => {
      vi.mocked(aiImportExtractionProvider.extractListDocument).mockRestore();
      vi.mocked(fetchAICompletion).mockResolvedValue({ ok: true, json: async () => ({}) } as any);
      vi.mocked(parseToolCall).mockReturnValue({ rows: [] });
      await expect(aiImportExtractionProvider.extractListDocument({ bytes: Buffer.from("%PDF-"), mimeType: "application/pdf", fileName: "dto.pdf" })).rejects.toThrow("IMPORT_EXTRACTION_INVALID_OUTPUT");

      vi.mocked(parseToolCall).mockReturnValue({ rows: [{ rawServices: [{ description: "PDR", amount: "not-a-number" }] }] });
      await expect(aiImportExtractionProvider.extractListDocument({ bytes: Buffer.from("%PDF-"), mimeType: "application/pdf", fileName: "dto.pdf" })).rejects.toThrow("IMPORT_EXTRACTION_INVALID_OUTPUT");

      vi.mocked(fetchAICompletion).mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError("malformed provider json"); } } as any);
      await expect(aiImportExtractionProvider.extractListDocument({ bytes: Buffer.from("%PDF-"), mimeType: "application/pdf", fileName: "dto.pdf" })).rejects.toThrow("malformed provider json");
    });

    it("IMPORT-RETRY-IDEMPOTENT-01: retry explícito reutiliza o original uma vez e concorrência não duplica staging", async () => {
      vi.spyOn(aiImportExtractionProvider, "extractListDocument").mockRejectedValueOnce(new Error("synthetic provider timeout"));
      const create = await fetch(`${baseUrl}/api/payment-lists/imports`, {
        method: "POST", headers: getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha),
        body: JSON.stringify({ fileName: "retry.pdf", mimeType: "application/pdf", contentBase64: Buffer.from("%PDF-1.7\nretry").toString("base64") }),
      });
      expect(create.status).toBe(503);
      const { importId } = await create.json();
      const headers = getAuthHeader(FIXTURES_004_IMPORT.ownerA, FIXTURES_004_IMPORT.wsAlpha);
      const [first, second] = await Promise.all([
        fetch(`${baseUrl}/api/payment-lists/imports/${importId}/retry-extraction`, { method: "POST", headers }),
        fetch(`${baseUrl}/api/payment-lists/imports/${importId}/retry-extraction`, { method: "POST", headers }),
      ]);
      expect([first.status, second.status].sort()).toEqual([200, 409]);
      const record = await prisma.externalListImport.findUniqueOrThrow({ where: { id: importId }, include: { items: true } });
      expect(record.status).toBe("extracted");
      expect(record.items).toHaveLength(1);
      expect(minioImportDocumentStorage.read).toHaveBeenCalledTimes(1);
    });
  });
});
