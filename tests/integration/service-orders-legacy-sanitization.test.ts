// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
// @ts-expect-error backend dependency
import express, { type Request, type Response, type NextFunction } from "../../backend/node_modules/express/index.js";
import { prisma } from "../../backend/src/lib/prisma.js";
import { signAccessToken } from "../../backend/src/lib/jwt.js";
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
} from "../../backend/src/lib/objectAuth.js";
import { serviceOrdersRouter } from "../../backend/src/routes/serviceOrders.js";
import { productionOrdersRouter } from "../../backend/src/routes/productionOrders.js";
import { weeklogsRouter } from "../../backend/src/routes/weeklogs.js";
import { backfillLegacyServiceOrders } from "../../backend/scripts/backfillLegacyServiceOrders.js";

// Configurações mínimas de ambiente
process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://operix_local:U2dkA-cJYnwHuD7hiAY2hPTrkawjg6f8@127.0.0.1:55432/operix_local?schema=public";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "this-is-a-test-secret-with-more-than-32-chars-long";

// Fixtures determinísticas isoladas para a suíte T08
const FIXTURES_T08 = {
  wsAlpha: "88888888-1111-4888-8888-aaaaaaaaaaaa",
  wsBravo: "88888888-2222-4888-8888-bbbbbbbbbbbb",
  ownerA: {
    userId: "80000000-0000-4000-8000-000000000001",
    appUserId: "81000000-0000-4000-8000-000000000001",
    email: "owner.a.t08@example.com",
    role: "owner",
  },
  techA1: {
    userId: "80000000-0000-4000-8000-000000000002",
    appUserId: "81000000-0000-4000-8000-000000000002",
    email: "tech.a1.t08@example.com",
    role: "technician",
  },
  techA2: {
    userId: "80000000-0000-4000-8000-000000000003",
    appUserId: "81000000-0000-4000-8000-000000000003",
    email: "tech.a2.t08@example.com",
    role: "technician",
  },
  ownerB: {
    userId: "80000000-0000-4000-8000-000000000004",
    appUserId: "81000000-0000-4000-8000-000000000004",
    email: "owner.b.t08@example.com",
    role: "owner",
  },
  clientA1: {
    id: "82000000-0000-4000-8000-000000000001",
    name: "Cliente Alpha T08 Frota 1",
  },
  clientA2: {
    id: "82000000-0000-4000-8000-000000000002",
    name: "Cliente Alpha T08 Frota 2",
  },
  clientB: {
    id: "82000000-0000-4000-8000-000000000003",
    name: "Cliente Bravo T08",
  },
  siteCentral: "SITE-T08-CENTRAL",
};

describe("Spec 003 — T08: Saneamento de ServiceOrders e Downstream Projection Adapter", () => {
  let app: express.Express;
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    app.use("/api/service-orders", serviceOrdersRouter);
    app.use("/api/production-orders", productionOrdersRouter);
    app.use("/api/weeklogs", weeklogsRouter);

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const statusCode =
        err?.statusCode ||
        (err instanceof ForbiddenError || err?.name === "ForbiddenError"
          ? 403
          : err instanceof NotFoundError || err?.name === "NotFoundError"
          ? 404
          : err instanceof ConflictError || err?.name === "ConflictError"
          ? 409
          : err instanceof UnprocessableEntityError || err?.name === "UnprocessableEntityError"
          ? 422
          : 500);

      res.status(statusCode).json({
        message: err?.message || "Internal error",
        code: err?.code,
      });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${typeof addr === "object" ? addr?.port : 0}`;
        resolve();
      });
    });

    await seedBaselineData();
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(resolve));
    }
    await cleanupTestData();
  });

  beforeEach(async () => {
    const wsList = [FIXTURES_T08.wsAlpha, FIXTURES_T08.wsBravo];
    await prisma.weeklogEntry.deleteMany({ where: { workspaceId: { in: wsList } } });
    await prisma.weeklogValidation.deleteMany({ where: { workspaceId: { in: wsList } } });
    await prisma.weeklog.deleteMany({ where: { workspaceId: { in: wsList } } });
    await prisma.paymentOrder.deleteMany({ where: { workspaceId: { in: wsList } } });
    await prisma.productionPhoto.deleteMany({ where: { workspaceId: { in: wsList } } });
    await prisma.productionOrder.deleteMany({ where: { workspaceId: { in: wsList } } });
    await prisma.serviceOrder.deleteMany({ where: { workspaceId: { in: wsList } } });
  });

  async function seedBaselineData() {
    await cleanupTestData();

    // 1. Users
    await prisma.user.createMany({
      data: [
        {
          id: FIXTURES_T08.ownerA.userId,
          email: FIXTURES_T08.ownerA.email,
          fullName: "Owner A T08",
          passwordHash: "hash-test",
          role: "owner",
        },
        {
          id: FIXTURES_T08.techA1.userId,
          email: FIXTURES_T08.techA1.email,
          fullName: "Tech A1 T08",
          passwordHash: "hash-test",
          role: "technician",
        },
        {
          id: FIXTURES_T08.techA2.userId,
          email: FIXTURES_T08.techA2.email,
          fullName: "Tech A2 T08",
          passwordHash: "hash-test",
          role: "technician",
        },
        {
          id: FIXTURES_T08.ownerB.userId,
          email: FIXTURES_T08.ownerB.email,
          fullName: "Owner B T08",
          passwordHash: "hash-test",
          role: "owner",
        },
      ],
    });

    // 2. AppUsers
    await prisma.appUser.createMany({
      data: [
        {
          id: FIXTURES_T08.ownerA.appUserId,
          authUserId: FIXTURES_T08.ownerA.userId,
          email: FIXTURES_T08.ownerA.email,
          name: "Owner A T08",
        },
        {
          id: FIXTURES_T08.techA1.appUserId,
          authUserId: FIXTURES_T08.techA1.userId,
          email: FIXTURES_T08.techA1.email,
          name: "Tech A1 T08",
        },
        {
          id: FIXTURES_T08.techA2.appUserId,
          authUserId: FIXTURES_T08.techA2.userId,
          email: FIXTURES_T08.techA2.email,
          name: "Tech A2 T08",
        },
        {
          id: FIXTURES_T08.ownerB.appUserId,
          authUserId: FIXTURES_T08.ownerB.userId,
          email: FIXTURES_T08.ownerB.email,
          name: "Owner B T08",
        },
      ],
    });

    // 3. Workspaces
    await prisma.workspace.createMany({
      data: [
        {
          id: FIXTURES_T08.wsAlpha,
          name: "Workspace Alpha T08",
          ownerUserId: FIXTURES_T08.ownerA.appUserId,
          timezone: "UTC",
        },
        {
          id: FIXTURES_T08.wsBravo,
          name: "Workspace Bravo T08",
          ownerUserId: FIXTURES_T08.ownerB.appUserId,
          timezone: "UTC",
        },
      ],
    });

    // 4. Memberships
    await prisma.membership.createMany({
      data: [
        {
          workspaceId: FIXTURES_T08.wsAlpha,
          userId: FIXTURES_T08.ownerA.appUserId,
          role: "owner",
          status: "active",
        },
        {
          workspaceId: FIXTURES_T08.wsAlpha,
          userId: FIXTURES_T08.techA1.appUserId,
          role: "technician",
          status: "active",
        },
        {
          workspaceId: FIXTURES_T08.wsAlpha,
          userId: FIXTURES_T08.techA2.appUserId,
          role: "technician",
          status: "active",
        },
        {
          workspaceId: FIXTURES_T08.wsBravo,
          userId: FIXTURES_T08.ownerB.appUserId,
          role: "owner",
          status: "active",
        },
      ],
    });

    // 5. Clients
    await prisma.client.createMany({
      data: [
        {
          id: FIXTURES_T08.clientA1.id,
          workspaceId: FIXTURES_T08.wsAlpha,
          name: FIXTURES_T08.clientA1.name,
        },
        {
          id: FIXTURES_T08.clientA2.id,
          workspaceId: FIXTURES_T08.wsAlpha,
          name: FIXTURES_T08.clientA2.name,
        },
        {
          id: FIXTURES_T08.clientB.id,
          workspaceId: FIXTURES_T08.wsBravo,
          name: FIXTURES_T08.clientB.name,
        },
      ],
    });
  }

  async function cleanupTestData() {
    const wsList = [FIXTURES_T08.wsAlpha, FIXTURES_T08.wsBravo];

    await prisma.weeklogEntry.deleteMany({ where: { workspaceId: { in: wsList } } });
    await prisma.weeklogValidation.deleteMany({ where: { workspaceId: { in: wsList } } });
    await prisma.weeklog.deleteMany({ where: { workspaceId: { in: wsList } } });
    await prisma.paymentOrder.deleteMany({ where: { workspaceId: { in: wsList } } });
    await prisma.productionPhoto.deleteMany({ where: { workspaceId: { in: wsList } } });
    await prisma.productionOrder.deleteMany({ where: { workspaceId: { in: wsList } } });
    await prisma.serviceOrder.deleteMany({ where: { workspaceId: { in: wsList } } });
    await prisma.clientAccessGrant.deleteMany({ where: { workspaceId: { in: wsList } } });
    await prisma.client.deleteMany({ where: { workspaceId: { in: wsList } } });
    await prisma.membership.deleteMany({ where: { workspaceId: { in: wsList } } });
    await prisma.workspace.deleteMany({ where: { id: { in: wsList } } });
    await prisma.appUser.deleteMany({
      where: {
        id: {
          in: [
            FIXTURES_T08.ownerA.appUserId,
            FIXTURES_T08.techA1.appUserId,
            FIXTURES_T08.techA2.appUserId,
            FIXTURES_T08.ownerB.appUserId,
          ],
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [
            FIXTURES_T08.ownerA.userId,
            FIXTURES_T08.techA1.userId,
            FIXTURES_T08.techA2.userId,
            FIXTURES_T08.ownerB.userId,
          ],
        },
      },
    });
  }

  // =========================================================================
  // 1. GET /service-orders: Pureza e Ausência de Mutações (Zero Writes)
  // =========================================================================
  it("LEGACY-SO-GET-PURE-01: GET /service-orders é 100% read-only e não executa mutação de reconciliação", async () => {
    const token = signAccessToken({
      id: FIXTURES_T08.ownerA.userId,
      email: FIXTURES_T08.ownerA.email,
      role: "owner",
    });

    // Cria ServiceOrder com payload legado e PaymentOrder associado
    const so = await prisma.serviceOrder.create({
      data: {
        workspaceId: FIXTURES_T08.wsAlpha,
        userId: FIXTURES_T08.ownerA.userId,
        assignedUserId: FIXTURES_T08.techA1.userId,
        clientName: "Cliente Teste Pureza",
        licensePlate: "PUR-1111",
        status: "validated",
        total: 250,
        distributionSnapshot: {
          operational_document: {
            validation: { situation: "sim" }, // sem payment_order_id
          },
        },
      },
    });

    const po = await prisma.paymentOrder.create({
      data: {
        workspaceId: FIXTURES_T08.wsAlpha,
        userId: FIXTURES_T08.ownerA.userId,
        assignedUserId: FIXTURES_T08.techA1.userId,
        serviceOrderId: so.id,
        listName: "L010138",
        status: "pending",
      },
    });

    // Estado antes do GET
    const soBefore = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: so.id } });
    const poBefore = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: po.id } });
    const soCountBefore = await prisma.serviceOrder.count({ where: { workspaceId: FIXTURES_T08.wsAlpha } });
    const poCountBefore = await prisma.paymentOrder.count({ where: { workspaceId: FIXTURES_T08.wsAlpha } });

    // Executa GET /api/service-orders
    const response = await fetch(`${baseUrl}/api/service-orders`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": FIXTURES_T08.wsAlpha,
      },
    });

    expect(response.status).toBe(200);

    // Estado após o GET deve ser EXATAMENTE idêntico (zero writes)
    const soAfter = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: so.id } });
    const poAfter = await prisma.paymentOrder.findUniqueOrThrow({ where: { id: po.id } });
    const soCountAfter = await prisma.serviceOrder.count({ where: { workspaceId: FIXTURES_T08.wsAlpha } });
    const poCountAfter = await prisma.paymentOrder.count({ where: { workspaceId: FIXTURES_T08.wsAlpha } });

    expect(soAfter.updatedAt.getTime()).toBe(soBefore.updatedAt.getTime());
    expect(poAfter.updatedAt.getTime()).toBe(poBefore.updatedAt.getTime());
    expect(soCountAfter).toBe(soCountBefore);
    expect(poCountAfter).toBe(poCountBefore);
    expect(soAfter.distributionSnapshot).toEqual(soBefore.distributionSnapshot);
  });

  // =========================================================================
  // 2. Isolamento de Tenant e Scope Own
  // =========================================================================
  it("LEGACY-SO-TENANT-01: Parâmetro workspace_id forjado na query é ignorado em favor do token", async () => {
    const token = signAccessToken({
      id: FIXTURES_T08.ownerA.userId,
      email: FIXTURES_T08.ownerA.email,
      role: "owner",
    });

    // Cria ordem no Workspace B
    await prisma.serviceOrder.create({
      data: {
        workspaceId: FIXTURES_T08.wsBravo,
        userId: FIXTURES_T08.ownerB.userId,
        assignedUserId: FIXTURES_T08.ownerB.userId,
        clientName: "Cliente Bravo Invasor",
        status: "draft",
      },
    });

    // Owner A tenta passar ?workspace_id=wsBravo
    const response = await fetch(
      `${baseUrl}/api/service-orders?workspace_id=${FIXTURES_T08.wsBravo}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Workspace-Id": FIXTURES_T08.wsAlpha,
        },
      }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    // Deve retornar apenas ordens do Workspace Alpha (nenhuma do Bravo)
    expect(body.every((o: any) => o.workspace_id === FIXTURES_T08.wsAlpha)).toBe(true);
  });

  it("LEGACY-SO-TECH-OWN-01: Técnico com scope own só recebe ordens atribuídas a si mesmo", async () => {
    const tokenTech1 = signAccessToken({
      id: FIXTURES_T08.techA1.userId,
      email: FIXTURES_T08.techA1.email,
      role: "technician",
    });

    // Cria ordem atribuída a Tech 1
    const soTech1 = await prisma.serviceOrder.create({
      data: {
        workspaceId: FIXTURES_T08.wsAlpha,
        userId: FIXTURES_T08.ownerA.userId,
        assignedUserId: FIXTURES_T08.techA1.userId,
        clientName: "Ordem Tech 1",
        status: "draft",
      },
    });

    // Cria ordem atribuída a Tech 2
    await prisma.serviceOrder.create({
      data: {
        workspaceId: FIXTURES_T08.wsAlpha,
        userId: FIXTURES_T08.ownerA.userId,
        assignedUserId: FIXTURES_T08.techA2.userId,
        clientName: "Ordem Tech 2",
        status: "draft",
      },
    });

    // Tech 1 faz GET /service-orders (mesmo tentando passar ?assigned_user_id=tech2)
    const response = await fetch(
      `${baseUrl}/api/service-orders?assigned_user_id=${FIXTURES_T08.techA2.userId}`,
      {
        headers: {
          Authorization: `Bearer ${tokenTech1}`,
          "X-Workspace-Id": FIXTURES_T08.wsAlpha,
        },
      }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.length).toBe(1);
    expect(body[0].id).toBe(soTech1.id);
    expect(body[0].assigned_user_id).toBe(FIXTURES_T08.techA1.userId);
  });

  // =========================================================================
  // 3. GET /clients: Isolamento de Tenant e Scope
  // =========================================================================
  it("LEGACY-SO-CLIENTS-TENANT-01: GET /clients só retorna clientes do active workspace", async () => {
    const token = signAccessToken({
      id: FIXTURES_T08.ownerA.userId,
      email: FIXTURES_T08.ownerA.email,
      role: "owner",
    });

    const response = await fetch(`${baseUrl}/api/service-orders/clients`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": FIXTURES_T08.wsAlpha,
      },
    });

    expect(response.status).toBe(200);
    const clients = await response.json();
    const ids = clients.map((c: any) => c.id);
    expect(ids).toContain(FIXTURES_T08.clientA1.id);
    expect(ids).toContain(FIXTURES_T08.clientA2.id);
    expect(ids).not.toContain(FIXTURES_T08.clientB.id);
  });

  it("LEGACY-SO-CLIENTS-TECH-OWN-01: Técnico com scope own só lista clientes com ordens vinculadas a si", async () => {
    const tokenTech1 = signAccessToken({
      id: FIXTURES_T08.techA1.userId,
      email: FIXTURES_T08.techA1.email,
      role: "technician",
    });

    // Cria ordem para Tech 1 associada ao Client A1
    await prisma.serviceOrder.create({
      data: {
        workspaceId: FIXTURES_T08.wsAlpha,
        userId: FIXTURES_T08.ownerA.userId,
        clientId: FIXTURES_T08.clientA1.id,
        assignedUserId: FIXTURES_T08.techA1.userId,
        status: "draft",
      },
    });

    // Cria ordem para Tech 2 associada ao Client A2
    await prisma.serviceOrder.create({
      data: {
        workspaceId: FIXTURES_T08.wsAlpha,
        userId: FIXTURES_T08.ownerA.userId,
        clientId: FIXTURES_T08.clientA2.id,
        assignedUserId: FIXTURES_T08.techA2.userId,
        status: "draft",
      },
    });

    const response = await fetch(`${baseUrl}/api/service-orders/clients`, {
      headers: {
        Authorization: `Bearer ${tokenTech1}`,
        "X-Workspace-Id": FIXTURES_T08.wsAlpha,
      },
    });

    expect(response.status).toBe(200);
    const clients = await response.json();
    expect(clients.length).toBe(1);
    expect(clients[0].id).toBe(FIXTURES_T08.clientA1.id);
  });

  // =========================================================================
  // 4. BOLA / IDOR e Cross-Tenant Mutation Block
  // =========================================================================
  it("LEGACY-SO-CROSS-TENANT-MUTATION-01: Tentativa de PATCH ou DELETE em ServiceOrder de outro workspace retorna 404", async () => {
    const tokenB = signAccessToken({
      id: FIXTURES_T08.ownerB.userId,
      email: FIXTURES_T08.ownerB.email,
      role: "owner",
    });

    // Ordem no Workspace A
    const orderA = await prisma.serviceOrder.create({
      data: {
        workspaceId: FIXTURES_T08.wsAlpha,
        userId: FIXTURES_T08.ownerA.userId,
        assignedUserId: FIXTURES_T08.techA1.userId,
        clientName: "Alvo Workspace A",
        status: "draft",
      },
    });

    // Owner B tenta PATCH
    const patchRes = await fetch(`${baseUrl}/api/service-orders/${orderA.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${tokenB}`,
        "X-Workspace-Id": FIXTURES_T08.wsBravo,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ client_name: "Invasão" }),
    });
    expect(patchRes.status).toBe(404);

    // Owner B tenta DELETE
    const deleteRes = await fetch(`${baseUrl}/api/service-orders/${orderA.id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${tokenB}`,
        "X-Workspace-Id": FIXTURES_T08.wsBravo,
      },
    });
    expect(deleteRes.status).toBe(404);
  });

  // =========================================================================
  // 5. Imutabilidade de Projeção Canônica
  // =========================================================================
  it("LEGACY-SO-CANONICAL-PROJECTION-IMMUTABLE-01: ServiceOrder vinculada a WeeklogEntry não pode ser mutada via rota legada (409)", async () => {
    const token = signAccessToken({
      id: FIXTURES_T08.ownerA.userId,
      email: FIXTURES_T08.ownerA.email,
      role: "owner",
    });

    // Finaliza uma OP canônica para gerar WeeklogEntry e downstream ServiceOrder projection
    const po = await prisma.productionOrder.create({
      data: {
        workspaceId: FIXTURES_T08.wsAlpha,
        code: "PO-PROJ-01",
        clientId: FIXTURES_T08.clientA1.id,
        operationalSiteKey: FIXTURES_T08.siteCentral,
        currencyCode: "BRL",
        performedServices: [
          { code: "SRV-01", description: "Pintura", quantity: 1, unitPrice: "300.00", total: "300.00" },
        ],
        status: "in_production",
        createdBy: FIXTURES_T08.ownerA.userId,
      },
    });

    const finRes = await fetch(`${baseUrl}/api/production-orders/${po.id}/finalize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": FIXTURES_T08.wsAlpha,
      },
    });
    expect(finRes.status).toBe(200);
    const finBody = await finRes.json();
    const entryId = finBody.weeklogEntry?.id || finBody.weeklog_entry?.id;

    // Localiza a ServiceOrder gerada como projeção
    const entry = await prisma.weeklogEntry.findUniqueOrThrow({ where: { id: entryId } });
    expect(entry.legacyServiceOrderId).toBeTruthy();
    const projectionId = entry.legacyServiceOrderId!;

    // Tentativa de alterar a ServiceOrder por rota legada PATCH deve ser recusada com 409
    const patchRes = await fetch(`${baseUrl}/api/service-orders/${projectionId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": FIXTURES_T08.wsAlpha,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ total: 999 }),
    });

    expect(patchRes.status).toBe(409);
    const errBody = await patchRes.json();
    expect(errBody.code).toBe("CANONICAL_PROJECTION_IMMUTABLE");

    // Tentativa de DELETE da projeção também deve ser recusada com 409
    const delRes = await fetch(`${baseUrl}/api/service-orders/${projectionId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": FIXTURES_T08.wsAlpha,
      },
    });
    expect(delRes.status).toBe(409);
    const delBody = await delRes.json();
    expect(delBody.code).toBe("CANONICAL_PROJECTION_IMMUTABLE");
  });

  // =========================================================================
  // 6. Zero Efeitos Financeiros na Validação Legada
  // =========================================================================
  it("LEGACY-SO-VALIDATION-NO-FINANCE-01: Tentativa de validação legada retorna 409 e não gera PaymentOrder", async () => {
    const token = signAccessToken({
      id: FIXTURES_T08.ownerA.userId,
      email: FIXTURES_T08.ownerA.email,
      role: "owner",
    });

    // Ordem puramente histórica (sem weeklog entry)
    const so = await prisma.serviceOrder.create({
      data: {
        workspaceId: FIXTURES_T08.wsAlpha,
        userId: FIXTURES_T08.ownerA.userId,
        assignedUserId: FIXTURES_T08.techA1.userId,
        clientName: "Cliente Validação Legada",
        total: 500,
        status: "draft",
      },
    });

    const poCountBefore = await prisma.paymentOrder.count({ where: { workspaceId: FIXTURES_T08.wsAlpha } });

    // Tentativa de validar por PATCH legado
    const res = await fetch(`${baseUrl}/api/service-orders/${so.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": FIXTURES_T08.wsAlpha,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: "validated",
        operational_document: {
          validation: { situation: "sim" },
        },
      }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("LEGACY_VALIDATION_DEPRECATED");

    // Prova que NENHUM PaymentOrder foi gerado
    const poCountAfter = await prisma.paymentOrder.count({ where: { workspaceId: FIXTURES_T08.wsAlpha } });
    expect(poCountAfter).toBe(poCountBefore);
  });

  // =========================================================================
  // 7. Depreciação de Criação Direta e Batch Delete
  // =========================================================================
  it("LEGACY-SO-DIRECT-CREATE-DEPRECATED-01: POST /service-orders retorna HTTP 410 Gone", async () => {
    const token = signAccessToken({
      id: FIXTURES_T08.ownerA.userId,
      email: FIXTURES_T08.ownerA.email,
      role: "owner",
    });

    const response = await fetch(`${baseUrl}/api/service-orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": FIXTURES_T08.wsAlpha,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_name: "Novo Não-Autorizado",
        total: 100,
      }),
    });

    expect(response.status).toBe(410);
    const body = await response.json();
    expect(body.code).toBe("LEGACY_SERVICE_ORDER_WRITE_DEPRECATED");
  });

  it("LEGACY-SO-DELETE-CANONICAL-BLOCKED-01: DELETE /by-year retorna HTTP 410 e não deleta registros", async () => {
    const token = signAccessToken({
      id: FIXTURES_T08.ownerA.userId,
      email: FIXTURES_T08.ownerA.email,
      role: "owner",
    });

    const response = await fetch(`${baseUrl}/api/service-orders/by-year/2026`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": FIXTURES_T08.wsAlpha,
      },
    });

    expect(response.status).toBe(410);
    const body = await response.json();
    expect(body.code).toBe("LEGACY_BATCH_DELETE_DEPRECATED");
  });

  // =========================================================================
  // 8. Testes do Script de Backfill
  // =========================================================================
  it("LEGACY-BACKFILL-DRY-RUN-01: Backfill em modo DRY-RUN produz relatório com wouldCreate mas ZERO escritas no banco", async () => {
    // Cria par elegível determinístico: ProductionOrder que aponta para ServiceOrder com todos os pré-requisitos
    const so = await prisma.serviceOrder.create({
      data: {
        workspaceId: FIXTURES_T08.wsAlpha,
        userId: FIXTURES_T08.ownerA.userId,
        assignedUserId: FIXTURES_T08.techA1.userId,
        clientName: "Cliente Backfill DryRun",
        clientId: FIXTURES_T08.clientA1.id,
        total: 450,
        status: "delivered",
      },
    });

    await prisma.productionOrder.create({
      data: {
        workspaceId: FIXTURES_T08.wsAlpha,
        code: "PO-BACKFILL-DRY",
        clientId: FIXTURES_T08.clientA1.id,
        serviceOrderId: so.id,
        operationalSiteKey: FIXTURES_T08.siteCentral,
        currencyCode: "BRL",
        performedServices: [
          { code: "SRV-01", description: "Polimento", quantity: 1, unitPrice: "450.00", total: "450.00" },
        ],
        status: "delivered",
        createdBy: FIXTURES_T08.ownerA.userId,
      },
    });

    const entriesBefore = await prisma.weeklogEntry.count({ where: { workspaceId: FIXTURES_T08.wsAlpha } });

    // Executa em DRY-RUN
    const report = await backfillLegacyServiceOrders({
      apply: false,
      workspaceId: FIXTURES_T08.wsAlpha,
    });

    expect(report.eligible).toBeGreaterThanOrEqual(1);
    expect(report.wouldCreate).toBeGreaterThanOrEqual(1);
    expect(report.created).toBe(0);

    // Banco de dados deve permanecer intacto
    const entriesAfter = await prisma.weeklogEntry.count({ where: { workspaceId: FIXTURES_T08.wsAlpha } });
    expect(entriesAfter).toBe(entriesBefore);
  });

  it("LEGACY-BACKFILL-IDEMPOTENT-01 & NO-OVERWRITE: Execução com apply migra ordenadamente e segunda execução não duplica", async () => {
    const so = await prisma.serviceOrder.create({
      data: {
        workspaceId: FIXTURES_T08.wsAlpha,
        userId: FIXTURES_T08.ownerA.userId,
        assignedUserId: FIXTURES_T08.techA1.userId,
        clientName: "Cliente Backfill Idempotent",
        clientId: FIXTURES_T08.clientA1.id,
        total: 500,
        status: "delivered",
      },
    });

    await prisma.productionOrder.create({
      data: {
        workspaceId: FIXTURES_T08.wsAlpha,
        code: "PO-BACKFILL-IDEMP",
        clientId: FIXTURES_T08.clientA1.id,
        serviceOrderId: so.id,
        operationalSiteKey: FIXTURES_T08.siteCentral,
        currencyCode: "BRL",
        performedServices: [
          { code: "SRV-01", description: "Polimento", quantity: 1, unitPrice: "500.00", total: "500.00" },
        ],
        status: "delivered",
        createdBy: FIXTURES_T08.ownerA.userId,
      },
    });

    // Executa com APPLY
    const report1 = await backfillLegacyServiceOrders({
      apply: true,
      workspaceId: FIXTURES_T08.wsAlpha,
    });

    expect(report1.created).toBe(1);

    const entriesAfterApply = await prisma.weeklogEntry.count({ where: { workspaceId: FIXTURES_T08.wsAlpha } });
    expect(entriesAfterApply).toBe(1);

    // Segunda execução com APPLY (idempotência)
    const report2 = await backfillLegacyServiceOrders({
      apply: true,
      workspaceId: FIXTURES_T08.wsAlpha,
    });

    expect(report2.created).toBe(0);
    expect(report2.alreadyCanonical).toBeGreaterThanOrEqual(1);

    const entriesAfterSecond = await prisma.weeklogEntry.count({ where: { workspaceId: FIXTURES_T08.wsAlpha } });
    expect(entriesAfterSecond).toBe(entriesAfterApply);
  });

  it("LEGACY-BACKFILL-AMBIGUOUS-SKIP-01: ServiceOrder sem vínculo determinístico de ProductionOrder é preservada como Legacy Archive", async () => {
    // Cria ServiceOrder sem nenhuma ProductionOrder apontando para ela
    const soAmbiguous = await prisma.serviceOrder.create({
      data: {
        workspaceId: FIXTURES_T08.wsAlpha,
        userId: FIXTURES_T08.ownerA.userId,
        assignedUserId: FIXTURES_T08.techA1.userId,
        clientName: "Cliente Órfão Sem PO",
        total: 120,
        status: "draft",
      },
    });

    const report = await backfillLegacyServiceOrders({
      apply: true,
      workspaceId: FIXTURES_T08.wsAlpha,
    });

    expect(report.skippedAmbiguous).toBeGreaterThanOrEqual(1);

    // Confirma que não foi criada WeeklogEntry artificial
    const entry = await prisma.weeklogEntry.findFirst({
      where: { legacyServiceOrderId: soAmbiguous.id },
    });
    expect(entry).toBeNull();
  });

  it("LEGACY-BACKFILL-NO-FINANCE-01: Backfill determinístico gera zero efeitos financeiros", async () => {
    const poBefore = await prisma.paymentOrder.count({ where: { workspaceId: FIXTURES_T08.wsAlpha } });

    await backfillLegacyServiceOrders({
      apply: true,
      workspaceId: FIXTURES_T08.wsAlpha,
    });

    const poAfter = await prisma.paymentOrder.count({ where: { workspaceId: FIXTURES_T08.wsAlpha } });
    expect(poAfter).toBe(poBefore);
  });
});
