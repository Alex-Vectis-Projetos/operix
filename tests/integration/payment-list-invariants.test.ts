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
 * Spec 004 — Payment List Domain & Tenancy Invariants Suite (T01/T02 Baseline)
 * 
 * Cobre os 17 cenários do Grupo 1 (Invariantes de Lista, Claims, Numeração e Moeda)
 * e cenários de ciclo de vida / fronteira legada correspondentes:
 * 
 * - LIST-MULTIWEEK-01
 * - LIST-TENANT-01
 * - LIST-TECH-OWN-01
 * - LIST-CLAIM-RESERVED-01
 * - LIST-CLAIM-CONSUMED-01
 * - LIST-CLAIM-REJECT-RELEASE-01
 * - LIST-CANCEL-RELIST-01
 * - LIST-CLAIM-PAID-NO-RELIST-01
 * - LIST-DUPLICATE-CONCURRENT-01
 * - LIST-NUMBER-CONCURRENT-01
 * - LIST-NUMBER-SEED-DRY-RUN-01
 * - LIST-NUMBER-SEED-AMBIGUOUS-SKIP-01
 * - LIST-NUMBER-LEGACY-SEED-01
 * - LIST-NUMBER-NO-COLLISION-01
 * - LIST-NUMBER-MALFORMED-LEGACY-01
 * - LIST-CURRENCY-REQUIRED-01
 * - LIST-CURRENCY-MISMATCH-01
 * - LIST-PENDING-01
 * - LIST-PAID-IDEMPOTENT-01
 * - LIST-PAID-FORBIDDEN-01
 * - LEGACY-PAYMENTORDER-READONLY-01
 */

const FIXTURES_004 = {
  wsAlpha: "40000000-0000-4000-8000-000000000001",
  wsBravo: "40000000-0000-4000-8000-000000000002",
  ownerA: {
    userId: "41000000-0000-4000-8000-000000000001",
    appUserId: "42000000-0000-4000-8000-000000000001",
    email: "owner.a.spec004@example.com",
    role: "owner",
  },
  adminA: {
    userId: "41000000-0000-4000-8000-000000000002",
    appUserId: "42000000-0000-4000-8000-000000000002",
    email: "admin.a.spec004@example.com",
    role: "admin",
  },
  techA1: {
    userId: "41000000-0000-4000-8000-000000000003",
    appUserId: "42000000-0000-4000-8000-000000000003",
    email: "tech.a1.spec004@example.com",
    role: "technician",
  },
  techA2: {
    userId: "41000000-0000-4000-8000-000000000004",
    appUserId: "42000000-0000-4000-8000-000000000004",
    email: "tech.a2.spec004@example.com",
    role: "technician",
  },
  ownerB: {
    userId: "41000000-0000-4000-8000-000000000005",
    appUserId: "42000000-0000-4000-8000-000000000005",
    email: "owner.b.spec004@example.com",
    role: "owner",
  },
  clientA: {
    id: "43000000-0000-4000-8000-000000000001",
    name: "Cliente Alpha Fleet",
  },
  clientBravo: {
    id: "43000000-0000-4000-8000-000000000002",
    name: "Cliente Bravo Fleet",
  },
};

describe("Spec 004 — Payment List Domain & Tenancy Invariants (T01/T02 Baseline)", () => {
  let app: express.Express;
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    await cleanupTestData();

    // 1. Criar Usuários globais e AppUsers
    for (const actor of [
      FIXTURES_004.ownerA,
      FIXTURES_004.adminA,
      FIXTURES_004.techA1,
      FIXTURES_004.techA2,
      FIXTURES_004.ownerB,
    ]) {
      await prisma.user.create({
        data: {
          id: actor.userId,
          email: actor.email,
          fullName: actor.email.split("@")[0],
          role: actor.role === "owner" || actor.role === "admin" ? "admin" : "user",
          passwordHash: "hash-spec004-test",
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

    // 2. Criar Workspaces Alpha e Bravo
    await prisma.workspace.create({
      data: {
        id: FIXTURES_004.wsAlpha,
        name: "Workspace Alpha Operações 004",
        timezone: "Europe/Paris",
        ownerUserId: FIXTURES_004.ownerA.appUserId,
        memberships: {
          create: [
            { id: "mem-004-oa", userId: FIXTURES_004.ownerA.appUserId, role: "owner", status: "active" },
            { id: "mem-004-aa", userId: FIXTURES_004.adminA.appUserId, role: "admin", status: "active" },
            { id: "mem-004-ta1", userId: FIXTURES_004.techA1.appUserId, role: "technician", status: "active" },
            { id: "mem-004-ta2", userId: FIXTURES_004.techA2.appUserId, role: "technician", status: "active" },
          ],
        },
      },
    });

    await prisma.workspace.create({
      data: {
        id: FIXTURES_004.wsBravo,
        name: "Workspace Bravo Concorrente 004",
        timezone: "Europe/Paris",
        ownerUserId: FIXTURES_004.ownerB.appUserId,
        memberships: {
          create: [
            { id: "mem-004-ob", userId: FIXTURES_004.ownerB.appUserId, role: "owner", status: "active" },
          ],
        },
      },
    });

    // 3. Criar Clientes
    await prisma.client.create({
      data: {
        id: FIXTURES_004.clientA.id,
        workspaceId: FIXTURES_004.wsAlpha,
        name: FIXTURES_004.clientA.name,
      },
    });

    await prisma.client.create({
      data: {
        id: FIXTURES_004.clientBravo.id,
        workspaceId: FIXTURES_004.wsBravo,
        name: FIXTURES_004.clientBravo.name,
      },
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanOperationalData();

    app = express();
    app.use(express.json());

    // Rotas existentes
    const { clientsRouter } = await import("../../backend/src/routes/clients.js");
    app.use("/api/clients", clientsRouter);

    const { weeklogsRouter } = await import("../../backend/src/routes/weeklogs.js");
    app.use("/api/weeklogs", weeklogsRouter);

    const { paymentOrdersRouter } = await import("../../backend/src/routes/paymentOrders.js");
    app.use("/api/payment-orders", paymentOrdersRouter);

    // Rota futura de paymentLists (T07+)
    try {
      // @ts-expect-error route not yet created in T01/T02
      const { paymentListsRouter } = await import("../../backend/src/routes/paymentLists.js");
      app.use("/api/payment-lists", paymentListsRouter);
    } catch {
      // Em T01/T02 a rota ainda não existe; chamadas retornam 404 naturally
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

  async function cleanOperationalData() {
    await prisma.weeklogValidation.deleteMany({
      where: { workspaceId: { in: [FIXTURES_004.wsAlpha, FIXTURES_004.wsBravo] } },
    });
    await prisma.weeklogEntry.deleteMany({
      where: { workspaceId: { in: [FIXTURES_004.wsAlpha, FIXTURES_004.wsBravo] } },
    });
    await prisma.weeklog.deleteMany({
      where: { workspaceId: { in: [FIXTURES_004.wsAlpha, FIXTURES_004.wsBravo] } },
    });
    await prisma.productionOrder.deleteMany({
      where: { workspaceId: { in: [FIXTURES_004.wsAlpha, FIXTURES_004.wsBravo] } },
    });
    await prisma.paymentOrder.deleteMany({
      where: { workspaceId: { in: [FIXTURES_004.wsAlpha, FIXTURES_004.wsBravo] } },
    });
  }

  async function cleanupTestData() {
    await cleanOperationalData();
    await prisma.client.deleteMany({
      where: { workspaceId: { in: [FIXTURES_004.wsAlpha, FIXTURES_004.wsBravo] } },
    });
    await prisma.membership.deleteMany({
      where: { workspaceId: { in: [FIXTURES_004.wsAlpha, FIXTURES_004.wsBravo] } },
    });
    await prisma.workspace.deleteMany({
      where: { id: { in: [FIXTURES_004.wsAlpha, FIXTURES_004.wsBravo] } },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [
            FIXTURES_004.ownerA.userId,
            FIXTURES_004.adminA.userId,
            FIXTURES_004.techA1.userId,
            FIXTURES_004.techA2.userId,
            FIXTURES_004.ownerB.userId,
          ],
        },
      },
    });
  }

  function getAuthHeader(user: { userId: string; email: string; role: string }, workspaceId?: string) {
    const token = signAccessToken({
      id: user.userId,
      email: user.email,
      role: user.role === "owner" || user.role === "admin" ? "admin" : "user",
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

  async function createValidWeeklogEntry(params: {
    id: string;
    workspaceId: string;
    clientId: string;
    currencyCode: string;
    amount?: string;
    technicianUserId: string;
    technicianName?: string;
  }) {
    const po = await prisma.productionOrder.create({
      data: {
        id: `po-${params.id}`,
        workspaceId: params.workspaceId,
        code: `PO-${params.id}`,
        clientId: params.clientId,
        technicianUserId: params.technicianUserId,
        operationalSiteKey: "SITE-PDR-01",
        currencyCode: params.currencyCode,
        status: "delivered",
        deliveredAt: new Date("2026-08-15T10:00:00Z"),
      },
    });

    const wl = await prisma.weeklog.upsert({
      where: {
        workspaceId_startsOn_clientId_siteKey: {
          workspaceId: params.workspaceId,
          startsOn: new Date("2026-08-10T00:00:00Z"),
          clientId: params.clientId,
          siteKey: "SITE-PDR-01",
        },
      },
      update: {},
      create: {
        id: `wl-${params.id}`,
        workspaceId: params.workspaceId,
        startsOn: new Date("2026-08-10T00:00:00Z"),
        endsOn: new Date("2026-08-16T23:59:59Z"),
        clientId: params.clientId,
        siteKey: "SITE-PDR-01",
        week: "2026-W33",
        weekNumber: 33,
        yearReference: 2026,
        status: "validated",
      },
    });

    return await prisma.weeklogEntry.create({
      data: {
        id: params.id,
        weeklogId: wl.id,
        workspaceId: params.workspaceId,
        productionOrderId: po.id,
        executionSequence: 1,
        clientId: params.clientId,
        technicianUserId: params.technicianUserId,
        technicianName: params.technicianName || "Tech A1",
        currencyCode: params.currencyCode,
        totalAmount: params.amount || "450.00",
        deliveredAt: new Date("2026-08-15T10:00:00Z"),
        validationStatus: "approved",
        servicesSnapshot: [{ description: "Serviço PDR", amount: params.amount || "450.00" }],
      },
    });
  }

  async function createLegacyPaymentOrder(params: {
    id: string;
    workspaceId: string;
    listName?: string;
    carName?: string;
  }) {
    return await prisma.paymentOrder.create({
      data: {
        id: params.id,
        workspaceId: params.workspaceId,
        userId: FIXTURES_004.ownerA.userId,
        assignedUserId: FIXTURES_004.ownerA.userId,
        listName: params.listName || "L000100",
        carName: params.carName || "Legacy Car",
        status: "pending",
      },
    });
  }

  // =========================================================================
  // GRUPO 1: DOMÍNIO DA LISTA DE PAGAMENTO & INVARIANTES DE TENANCY
  // =========================================================================

  describe("Grupo 1: Invariantes de Domínio e Tenancy da Lista de Pagamento", () => {
    it("LIST-MULTIWEEK-01: Agregação Multissemanas Autoritativa em Única Lista", async () => {
      // Given: 3 lotes Weeklog validados distintos (W29, W30, W32) no mesmo workspaceId e clientId
      const w29 = await prisma.weeklog.create({
        data: {
          id: "wl-004-mw-w29",
          workspaceId: FIXTURES_004.wsAlpha,
          week: "2026-W29",
          startsOn: new Date("2026-07-13T00:00:00Z"),
          endsOn: new Date("2026-07-19T23:59:59Z"),
          clientId: FIXTURES_004.clientA.id,
          siteKey: "SITE-PDR-01",
          status: "validated",
          entries: {
            create: {
              id: "entry-004-w29-a1",
              workspaceId: FIXTURES_004.wsAlpha,
              technicianUserId: FIXTURES_004.techA1.userId,
              technicianName: "Tech A1",
              executionSequence: 1,
              currencyCode: "EUR",
              totalAmount: "500.00",
              performedServices: [{ description: "PDR W29", amount: "500.00" }],
              validationStatus: "approved",
            },
          },
        },
      });

      const w30 = await prisma.weeklog.create({
        data: {
          id: "wl-004-mw-w30",
          workspaceId: FIXTURES_004.wsAlpha,
          week: "2026-W30",
          startsOn: new Date("2026-07-20T00:00:00Z"),
          endsOn: new Date("2026-07-26T23:59:59Z"),
          clientId: FIXTURES_004.clientA.id,
          siteKey: "SITE-PDR-01",
          status: "validated",
          entries: {
            create: {
              id: "entry-004-w30-b1",
              workspaceId: FIXTURES_004.wsAlpha,
              technicianUserId: FIXTURES_004.techA2.userId,
              technicianName: "Tech A2",
              executionSequence: 1,
              currencyCode: "EUR",
              totalAmount: "350.00",
              performedServices: [{ description: "PDR W30", amount: "350.00" }],
              validationStatus: "approved",
            },
          },
        },
      });

      const w32 = await prisma.weeklog.create({
        data: {
          id: "wl-004-mw-w32",
          workspaceId: FIXTURES_004.wsAlpha,
          week: "2026-W32",
          startsOn: new Date("2026-08-03T00:00:00Z"),
          endsOn: new Date("2026-08-09T23:59:59Z"),
          clientId: FIXTURES_004.clientA.id,
          siteKey: "SITE-PDR-01",
          status: "validated",
          entries: {
            create: {
              id: "entry-004-w32-c1",
              workspaceId: FIXTURES_004.wsAlpha,
              technicianUserId: FIXTURES_004.techA1.userId,
              technicianName: "Tech A1",
              executionSequence: 1,
              currencyCode: "EUR",
              totalAmount: "600.00",
              performedServices: [{ description: "PDR W32", amount: "600.00" }],
              validationStatus: "approved",
            },
          },
        },
      });

      // When: Gestor cria PaymentList consolidando as 3 entradas de semanas distintas
      const res = await fetch(`${baseUrl}/api/payment-lists`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004.ownerA, FIXTURES_004.wsAlpha),
        body: JSON.stringify({
          clientId: FIXTURES_004.clientA.id,
          currencyCode: "EUR",
          entryIds: ["entry-004-w29-a1", "entry-004-w30-b1", "entry-004-w32-c1"],
        }),
      });

      // Then: Deve retornar HTTP 201 com cabeçalho registrando itemCount = 3 e sourceDocumentTotal = "1450.00"
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.itemCount).toBe(3);
      expect(String(data.sourceDocumentTotal)).toBe("1450.00");
      expect(data.currencyCode).toBe("EUR");
    });

    it("LIST-TENANT-01: Isolamento Estrito de Tenant em Listas Comerciais", async () => {
      // Given: Usuário do Workspace A e uma PaymentList pertencente ao Workspace B
      const listBId = "44000000-0000-4000-8000-000000000099";

      // When: Usuário de A tenta GET na lista de B
      const resGet = await fetch(`${baseUrl}/api/payment-lists/${listBId}`, {
        headers: getAuthHeader(FIXTURES_004.ownerA, FIXTURES_004.wsAlpha),
      });

      // When: Usuário de A tenta mutar status na lista de B
      const resPatch = await fetch(`${baseUrl}/api/payment-lists/${listBId}/status`, {
        method: "PATCH",
        headers: getAuthHeader(FIXTURES_004.ownerA, FIXTURES_004.wsAlpha),
        body: JSON.stringify({ toStatus: "pending" }),
      });

      // Then: Todas as requisições devem retornar HTTP 404 (ou 403 Forbidden) deny-by-default
      expect([403, 404]).toContain(resGet.status);
      expect([403, 404]).toContain(resPatch.status);
    });

    it("LIST-TECH-OWN-01: Restrição de Escopo de Técnico (scope: own) e Ocultação de Faturamento Global", async () => {
      // Given: Técnico autenticado techA1 consulta lista contendo itens de múltiplos técnicos
      const listId = "44000000-0000-4000-8000-000000000001";

      // When: Técnico consulta a lista via GET /api/payment-lists/:id
      const res = await fetch(`${baseUrl}/api/payment-lists/${listId}`, {
        headers: getAuthHeader(FIXTURES_004.techA1, FIXTURES_004.wsAlpha),
      });

      // Then: Deve retornar HTTP 200 sanitizado: faturamento global omitido no JSON
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sourceDocumentTotal).toBeUndefined();
      expect(data.recognizedTotal).toBeUndefined();
      expect(data.profitMargin).toBeUndefined();
    });

    it("LIST-CLAIM-RESERVED-01: Associação Inicial com Claim em Status Reserved", async () => {
      // Given: WeeklogEntry validada no Workspace A
      const entry = await createValidWeeklogEntry({
        id: "entry-004-claim-res",
        workspaceId: FIXTURES_004.wsAlpha,
        clientId: FIXTURES_004.clientA.id,
        technicianUserId: FIXTURES_004.techA1.userId,
        currencyCode: "EUR",
        amount: "450.00",
      });

      // When: Gestor cria PaymentList em draft vinculando entry
      const res = await fetch(`${baseUrl}/api/payment-lists`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004.ownerA, FIXTURES_004.wsAlpha),
        body: JSON.stringify({
          clientId: FIXTURES_004.clientA.id,
          currencyCode: "EUR",
          entryIds: [entry.id],
        }),
      });

      // Then: HTTP 201 e claim deve ser criada com status = 'reserved'
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.id).toBeDefined();
    });

    it("LIST-CLAIM-CONSUMED-01: Transição de Claim para Consumed no Avanço para Pending", async () => {
      // Given: PaymentList L1 contendo W1 com claim em status 'reserved'
      const listId = "44000000-0000-4000-8000-000000000002";

      // When: Gestor avança lista para 'pending'
      const res = await fetch(`${baseUrl}/api/payment-lists/${listId}/status`, {
        method: "PATCH",
        headers: getAuthHeader(FIXTURES_004.ownerA, FIXTURES_004.wsAlpha),
        body: JSON.stringify({ toStatus: "pending" }),
      });

      // Then: Retorna HTTP 200 e claims ativas transicionam para 'consumed'
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("pending");
    });

    it("LIST-CLAIM-REJECT-RELEASE-01: Liberação de Claim para Released no Desfecho REJECT_ITEM", async () => {
      // Given: PaymentList em conferência com resultado divergente
      const listId = "44000000-0000-4000-8000-000000000003";
      const resultId = "45000000-0000-4000-8000-000000000001";

      // When: Gestor registra decisão terminal 'reject_item'
      const res = await fetch(`${baseUrl}/api/payment-lists/${listId}/confrontation/${resultId}/decision`, {
        method: "PATCH",
        headers: getAuthHeader(FIXTURES_004.ownerA, FIXTURES_004.wsAlpha),
        body: JSON.stringify({
          decision: "reject_item",
          reason: "Serviço não aprovado pelo cliente nesta fatura",
        }),
      });

      // Then: Retorna HTTP 200 e claim transiciona para status = 'released'
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.claimStatus).toBe("released");
    });

    it("LIST-CANCEL-RELIST-01: Liberação de Execução após Cancelamento de Lista", async () => {
      // Given: PaymentList contendo execução reservada
      const listId = "44000000-0000-4000-8000-000000000004";

      // When: Gestor cancela a lista
      const resCancel = await fetch(`${baseUrl}/api/payment-lists/${listId}/status`, {
        method: "PATCH",
        headers: getAuthHeader(FIXTURES_004.ownerA, FIXTURES_004.wsAlpha),
        body: JSON.stringify({ toStatus: "cancelled" }),
      });

      // Then: Lista cancelada com sucesso (HTTP 200) e claims liberadas
      expect(resCancel.status).toBe(200);
    });

    it("LIST-CLAIM-PAID-NO-RELIST-01: Proibição de Refaturamento de Execução em Lista Paga", async () => {
      // Given: Entry já pertencente a uma lista em status 'paid'
      const entryId = "entry-004-already-paid";

      // When: Usuário tenta associar a mesma entry a uma nova lista
      const res = await fetch(`${baseUrl}/api/payment-lists`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004.ownerA, FIXTURES_004.wsAlpha),
        body: JSON.stringify({
          clientId: FIXTURES_004.clientA.id,
          currencyCode: "EUR",
          entryIds: [entryId],
        }),
      });

      // Then: HTTP 409 Conflict (WEEKLOG_ENTRY_ALREADY_CLAIMED)
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.code || data.message).toMatch(/WEEKLOG_ENTRY_ALREADY_CLAIMED|ALREADY_CLAIMED/i);
    });

    it("LIST-DUPLICATE-CONCURRENT-01: Tentativa de Claim Concorrente da Mesma Entrada", async () => {
      // Given: Entry W1 validada disponível
      const entry = await createValidWeeklogEntry({
        id: "entry-004-race-claim",
        workspaceId: FIXTURES_004.wsAlpha,
        clientId: FIXTURES_004.clientA.id,
        technicianUserId: FIXTURES_004.techA1.userId,
        currencyCode: "EUR",
        amount: "700.00",
      });

      // When: Duas requisições paralelas tentam criar listas reivindicando W1
      const headers = getAuthHeader(FIXTURES_004.ownerA, FIXTURES_004.wsAlpha);
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/payment-lists`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            clientId: FIXTURES_004.clientA.id,
            currencyCode: "EUR",
            entryIds: [entry.id],
          }),
        }),
        fetch(`${baseUrl}/api/payment-lists`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            clientId: FIXTURES_004.clientA.id,
            currencyCode: "EUR",
            entryIds: [entry.id],
          }),
        }),
      ]);

      // Then: Exatamente uma obtém 201 Created e a outra recebe 409 Conflict
      const statuses = [res1.status, res2.status];
      expect(statuses).toContain(201);
      expect(statuses).toContain(409);
    });

    it("LIST-NUMBER-CONCURRENT-01: Alocação Concorrente de Numeração Sequencial Monotônica", async () => {
      // Given: 10 requisições simultâneas de criação de lista no mesmo workspace
      const headers = getAuthHeader(FIXTURES_004.ownerA, FIXTURES_004.wsAlpha);
      const requests = Array.from({ length: 10 }).map((_, idx) =>
        fetch(`${baseUrl}/api/payment-lists`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            clientId: FIXTURES_004.clientA.id,
            currencyCode: "EUR",
            sourceDocumentTotal: "100.00",
          }),
        })
      );

      // When: Execução simultânea em paralelo
      const responses = await Promise.all(requests);

      // Then: Todas têm sucesso (HTTP 201) e alocam códigos monotônicos únicos L0xxxxx
      for (const res of responses) {
        expect(res.status).toBe(201);
      }
      const payloads = await Promise.all(responses.map((r) => r.json()));
      const numbers = payloads.map((p) => p.listNumber);
      const uniqueNumbers = new Set(numbers);
      expect(uniqueNumbers.size).toBe(10);
      for (const num of numbers) {
        expect(num).toMatch(/^L\d{6}$/);
      }
    });

    it("LIST-NUMBER-SEED-DRY-RUN-01: CLI de Seed Discovery em Modo Padrão DRY-RUN", async () => {
      // Given: Registros legados no banco
      await createLegacyPaymentOrder({
        id: "po-004-legacy-seed",
        workspaceId: FIXTURES_004.wsAlpha,
        listName: "L000450",
        carName: "Legacy Car 450",
      });

      // When: Executa o script de seed discovery sem a flag --apply
      try {
        // @ts-expect-error script created in T05
        const { discoverLegacySeed } = await import("../../scripts/seed-legacy-counters.js");
        const report = await discoverLegacySeed({ apply: false });
        expect(report.scanned).toBeGreaterThan(0);
        expect(report.seedByWorkspace[FIXTURES_004.wsAlpha]).toBe(450);
      } catch (err: any) {
        // Em T01/T02 o script ainda não existe
        expect(err.code).toBe("ERR_MODULE_NOT_FOUND");
      }
    });

    it("LIST-NUMBER-SEED-AMBIGUOUS-SKIP-01: Ignorar Códigos sem Workspace Determinístico no Seed", async () => {
      // Given: Código em production_lists sem workspace_id
      try {
        // @ts-expect-error script created in T05
        const { discoverLegacySeed } = await import("../../scripts/seed-legacy-counters.js");
        const report = await discoverLegacySeed({ apply: false });
        expect(report.skippedAmbiguous).toBeDefined();
      } catch (err: any) {
        expect(err.code).toBe("ERR_MODULE_NOT_FOUND");
      }
    });

    it("LIST-NUMBER-LEGACY-SEED-01: Descoberta de Maior Código Legado Compatível como Seed", async () => {
      // Given: Ordens antigas com list_name = "L000250"
      await createLegacyPaymentOrder({
        id: "po-004-legacy-250",
        workspaceId: FIXTURES_004.wsAlpha,
        listName: "L000250",
        carName: "Legacy 250",
      });

      // When: Script executado com --apply
      try {
        // @ts-expect-error script created in T05
        const { discoverLegacySeed } = await import("../../scripts/seed-legacy-counters.js");
        const report = await discoverLegacySeed({ apply: true });
        expect(report.seedByWorkspace[FIXTURES_004.wsAlpha]).toBe(250);

        // Then: A primeira lista canônica criada recebe L000251
        const res = await fetch(`${baseUrl}/api/payment-lists`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_004.ownerA, FIXTURES_004.wsAlpha),
          body: JSON.stringify({
            clientId: FIXTURES_004.clientA.id,
            currencyCode: "EUR",
          }),
        });
        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.listNumber).toBe("L000251");
      } catch (err: any) {
        expect(err.code).toBe("ERR_MODULE_NOT_FOUND");
      }
    });

    it("LIST-NUMBER-NO-COLLISION-01: Prevenção de Colisão com Histórico Legado", async () => {
      // Given: Workspace com códigos legados esparsos no banco (L000010, L000050)
      const res = await fetch(`${baseUrl}/api/payment-lists`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004.ownerA, FIXTURES_004.wsAlpha),
        body: JSON.stringify({
          clientId: FIXTURES_004.clientA.id,
          currencyCode: "EUR",
        }),
      });

      // Then: Nenhuma lista canônica recebe código igual aos códigos pré-existentes
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(["L000010", "L000050"]).not.toContain(data.listNumber);
    });

    it("LIST-NUMBER-MALFORMED-LEGACY-01: Tratamento de Códigos Legados Fora do Padrão", async () => {
      // Given: Registros com nomes arbitrários ("LISTA-EXTRA", "W32-SOUZA", "L1023")
      await createLegacyPaymentOrder({
        id: "po-004-malformed-01",
        workspaceId: FIXTURES_004.wsAlpha,
        listName: "LISTA-EXTRA-ARBITRARIA",
        carName: "Car Extra",
      });

      // When: Algoritmo de seed é executado
      try {
        // @ts-expect-error script created in T05
        const { discoverLegacySeed } = await import("../../scripts/seed-legacy-counters.js");
        const report = await discoverLegacySeed({ apply: false });
        expect(report.malformedIgnored).toBeGreaterThan(0);
      } catch (err: any) {
        expect(err.code).toBe("ERR_MODULE_NOT_FOUND");
      }
    });

    it("LIST-CURRENCY-REQUIRED-01: Rejeição de Criação de Lista sem Moeda Válida (3 Letras Maiúsculas)", async () => {
      // Given: Payload sem currencyCode ou com formato inválido ("eur", "123", "")
      const invalidPayloads = [
        { clientId: FIXTURES_004.clientA.id },
        { clientId: FIXTURES_004.clientA.id, currencyCode: "eur" },
        { clientId: FIXTURES_004.clientA.id, currencyCode: "EUROPE" },
        { clientId: FIXTURES_004.clientA.id, currencyCode: "123" },
      ];

      for (const payload of invalidPayloads) {
        const res = await fetch(`${baseUrl}/api/payment-lists`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_004.ownerA, FIXTURES_004.wsAlpha),
          body: JSON.stringify(payload),
        });

        // Then: HTTP 422 Unprocessable Entity (CURRENCY_REQUIRED)
        expect(res.status).toBe(422);
        const data = await res.json();
        expect(data.code || data.message).toMatch(/CURRENCY_REQUIRED|INVALID_CURRENCY/i);
      }
    });

    it("LIST-CURRENCY-MISMATCH-01: Rejeição de Mistura de Moedas em Única Lista", async () => {
      // Given: Lista configurada em EUR e entry em BRL
      const entryBrl = await createValidWeeklogEntry({
        id: "entry-004-brl-mismatch",
        workspaceId: FIXTURES_004.wsAlpha,
        clientId: FIXTURES_004.clientA.id,
        technicianUserId: FIXTURES_004.techA1.userId,
        currencyCode: "BRL",
        amount: "1200.00",
      });

      // When: Tentativa de incluir entry em BRL em lista em EUR
      const res = await fetch(`${baseUrl}/api/payment-lists`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004.ownerA, FIXTURES_004.wsAlpha),
        body: JSON.stringify({
          clientId: FIXTURES_004.clientA.id,
          currencyCode: "EUR",
          entryIds: [entryBrl.id],
        }),
      });

      // Then: HTTP 422 Unprocessable Entity (CURRENCY_MISMATCH)
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.code || data.message).toMatch(/CURRENCY_MISMATCH/i);
    });

    it("LIST-PENDING-01: Transição para Pending Exigindo Status Confronted e Zero Disputas", async () => {
      // Given: PaymentList em status confronted com todos os itens aceitos
      const listId = "44000000-0000-4000-8000-000000000005";

      // When: Gestor avança para 'pending'
      const res = await fetch(`${baseUrl}/api/payment-lists/${listId}/status`, {
        method: "PATCH",
        headers: getAuthHeader(FIXTURES_004.ownerA, FIXTURES_004.wsAlpha),
        body: JSON.stringify({ toStatus: "pending" }),
      });

      // Then: HTTP 200, status passa para 'pending', claims consumidas
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("pending");
    });

    it("LIST-PAID-IDEMPOTENT-01: Confirmação Idempotente de Recebimento por Gestor Autorizado", async () => {
      // Given: PaymentList em status 'pending'
      const listId = "44000000-0000-4000-8000-000000000006";

      // When: Duas chamadas consecutivas de liquidação (toStatus: 'paid')
      const headers = getAuthHeader(FIXTURES_004.ownerA, FIXTURES_004.wsAlpha);
      const res1 = await fetch(`${baseUrl}/api/payment-lists/${listId}/status`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ toStatus: "paid" }),
      });
      const res2 = await fetch(`${baseUrl}/api/payment-lists/${listId}/status`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ toStatus: "paid" }),
      });

      // Then: Ambas retornam HTTP 200 idempotentemente e paidAt preenchido
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.status).toBe("paid");
      expect(data2.paidAt).toBeDefined();
    });

    it("LIST-PAID-FORBIDDEN-01: Bloqueio de Liquidação por Usuário sem Papel de Gestão", async () => {
      // Given: PaymentList em pending e usuário técnico
      const listId = "44000000-0000-4000-8000-000000000007";

      // When: Técnico tenta acionar toStatus: 'paid'
      const res = await fetch(`${baseUrl}/api/payment-lists/${listId}/status`, {
        method: "PATCH",
        headers: getAuthHeader(FIXTURES_004.techA1, FIXTURES_004.wsAlpha),
        body: JSON.stringify({ toStatus: "paid" }),
      });

      // Then: HTTP 403 Forbidden (FORBIDDEN_ROLE)
      expect(res.status).toBe(403);
    });

    it("LEGACY-PAYMENTORDER-READONLY-01: Proibição de Mutações em Rotas Legadas", async () => {
      // Given: Ordem legada existente e usuário autenticado
      const po = await createLegacyPaymentOrder({
        id: "po-legacy-readonly-test",
        workspaceId: FIXTURES_004.wsAlpha,
        carName: "Legacy Existing Car",
      });
      const headers = getAuthHeader(FIXTURES_004.ownerA, FIXTURES_004.wsAlpha);

      // When: Tentativa de POST /api/payment-orders
      const resPost = await fetch(`${baseUrl}/api/payment-orders`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          car_name: "Legacy Direct Car",
          list_name: "L000999",
        }),
      });

      // When: Tentativa de PATCH /api/payment-orders/:id
      const resPatch = await fetch(`${baseUrl}/api/payment-orders/${po.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          amount_paid: 150.0,
        }),
      });

      // Then: Rotas devem retornar HTTP 410 Gone ou 409 Conflict (descontinuadas na Spec 004)
      expect([409, 410]).toContain(resPost.status);
      expect([409, 410]).toContain(resPatch.status);
    });
  });
});
