// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
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
import {
  Prisma,
  calculateRevisionTotals,
  createBudget,
  updateBudgetRevision,
  approveBudgetRevision,
  rejectBudgetRevision,
  syncLocalBudgets,
} from "../../backend/src/services/budgetService.js";

// Configurações de ambiente mínimas para testes
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://operix_local:U2dkA-cJYnwHuD7hiAY2hPTrkawjg6f8@127.0.0.1:55432/operix_local?schema=public";
process.env.JWT_SECRET = process.env.JWT_SECRET || "this-is-a-test-secret-with-more-than-32-chars-long";
process.env.MINIO_ROOT_PASSWORD = process.env.MINIO_ROOT_PASSWORD || "miniopassword123456";
if (process.env.SMTP_PORT === "") delete process.env.SMTP_PORT;
if (process.env.SMTP_SECURE === "") delete process.env.SMTP_SECURE;

/**
 * Suite de Aceitação e Regressão da Spec 002: Mobile Operational Flow
 * Orçamento -> Revisões -> Aprovação -> Ordem de Produção (R1)
 *
 * Classificação estrita conforme DoD:
 * [GRUPO A - ESTRUTURAIS]: Devem rodar GREEN (provam schema, chaves compostas, constraints parciais e índices únicos do PostgreSQL).
 * [GRUPO B - COMPORTAMENTAIS]: Devem rodar RED nesta etapa (baseline T02 para T03-T08).
 */

// IDs determinísticos para Fixtures Mínimas
const FIXTURES = {
  wsAlpha: "11111111-1111-4111-8111-111111111111",
  wsBravo: "22222222-2222-4222-8222-222222222222",
  ownerA: {
    userId: "33333333-3333-4333-8333-333333333333",
    appUserId: "33333333-3333-4333-8333-333333333334",
    email: "owner.a@example.com",
    role: "owner",
  },
  ownerB: {
    userId: "44444444-4444-4444-8444-444444444444",
    appUserId: "44444444-4444-4444-8444-444444444445",
    email: "owner.b@example.com",
    role: "owner",
  },
  techA1: {
    userId: "55555555-5555-4555-8555-555555555555",
    appUserId: "55555555-5555-4555-8555-555555555556",
    email: "tech.a1@example.com",
    role: "technician",
  },
  techA2: {
    userId: "66666666-6666-4666-8666-666666666666",
    appUserId: "66666666-6666-4666-8666-666666666667",
    email: "tech.a2@example.com",
    role: "technician",
  },
  techB: {
    userId: "77777777-7777-4777-8777-777777777777",
    appUserId: "77777777-7777-4777-8777-777777777778",
    email: "tech.b@example.com",
    role: "technician",
  },
  independentTechC: {
    userId: "88888888-8888-4888-8888-888888888888",
    appUserId: "88888888-8888-4888-8888-888888888889",
    email: "tech.c@example.com",
    role: "owner",
    personalWsId: "88888888-8888-4888-8888-888888888880",
  },
  clientA: "99999999-9999-4999-8999-999999999999",
  clientB: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

describe("Spec 002 — Test-First Acceptance Suite (T02)", () => {
  let app: express.Express;
  let server: any;
  let baseUrl: string;

  // Provisionamento das fixtures essenciais no banco antes dos testes
  beforeAll(async () => {
    // Limpeza de testes anteriores caso existam
    await cleanupTestData();

    // 1. Criar Usuários e AppUsers
    for (const actor of [
      FIXTURES.ownerA,
      FIXTURES.ownerB,
      FIXTURES.techA1,
      FIXTURES.techA2,
      FIXTURES.techB,
      FIXTURES.independentTechC,
    ]) {
      await prisma.user.create({
        data: {
          id: actor.userId,
          email: actor.email,
          fullName: actor.email.split("@")[0],
          passwordHash: "hash123",
          role: "user",
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

    // 2. Criar Workspaces Corporativos
    await prisma.workspace.create({
      data: {
        id: FIXTURES.wsAlpha,
        name: "Oficina Alpha",
        type: "company",
        ownerUserId: FIXTURES.ownerA.appUserId,
        memberships: {
          create: [
            { id: "mem-oa", userId: FIXTURES.ownerA.appUserId, role: "owner", status: "active" },
            { id: "mem-ta1", userId: FIXTURES.techA1.appUserId, role: "technician", status: "active" },
            { id: "mem-ta2", userId: FIXTURES.techA2.appUserId, role: "technician", status: "active" },
          ],
        },
      },
    });

    await prisma.workspace.create({
      data: {
        id: FIXTURES.wsBravo,
        name: "Oficina Bravo",
        type: "company",
        ownerUserId: FIXTURES.ownerB.appUserId,
        memberships: {
          create: [
            { id: "mem-ob", userId: FIXTURES.ownerB.appUserId, role: "owner", status: "active" },
            { id: "mem-tb", userId: FIXTURES.techB.appUserId, role: "technician", status: "active" },
          ],
        },
      },
    });

    // 3. Criar Clientes Operacionais Canônicos
    await prisma.client.create({
      data: {
        id: FIXTURES.clientA,
        workspaceId: FIXTURES.wsAlpha,
        name: "Cliente Alpha 1",
      },
    });

    await prisma.client.create({
      data: {
        id: FIXTURES.clientB,
        workspaceId: FIXTURES.wsBravo,
        name: "Cliente Bravo 1",
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

    // Carregar rotas existentes do backend
    const { productionOrdersRouter } = await import("../../backend/src/routes/productionOrders.js");
    app.use("/api/production-orders", productionOrdersRouter);

    const { workspaceRouter } = await import("../../backend/src/routes/workspaces.js");
    app.use("/api/workspaces", workspaceRouter);

    const { clientsRouter } = await import("../../backend/src/routes/clients.js");
    app.use("/api/clients", clientsRouter);

    // Tentativa de carregar rota de orçamentos se existir
    try {
      // @ts-expect-error rota a ser implementada na Spec 002
      const { budgetsRouter } = await import("../../backend/src/routes/budgets.js");
      if (budgetsRouter) {
        app.use("/api/budgets", budgetsRouter);
      }
    } catch {
      // budgets.js ainda não existe (esperado para T02)
    }

    const { ZodError } = await import("zod");
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      if (err instanceof ZodError) {
        return res.status(400).json({ message: "Payload inválido.", issues: err.issues });
      }
      const statusCode = err?.statusCode || (err instanceof ForbiddenError ? 403 : 500);
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
    await prisma.productionOrder.deleteMany({
      where: { workspaceId: { in: [FIXTURES.wsAlpha, FIXTURES.wsBravo, FIXTURES.independentTechC.personalWsId] } },
    });
    await prisma.budgetPhoto.deleteMany({
      where: { workspaceId: { in: [FIXTURES.wsAlpha, FIXTURES.wsBravo, FIXTURES.independentTechC.personalWsId] } },
    });
    await prisma.budget.updateMany({
      where: { workspaceId: { in: [FIXTURES.wsAlpha, FIXTURES.wsBravo, FIXTURES.independentTechC.personalWsId] } },
      data: { currentRevisionId: null, approvedRevisionId: null },
    });
    await prisma.budgetRevision.deleteMany({});
    await prisma.budget.deleteMany({
      where: { workspaceId: { in: [FIXTURES.wsAlpha, FIXTURES.wsBravo, FIXTURES.independentTechC.personalWsId] } },
    });
    await prisma.client.deleteMany({
      where: {
        OR: [
          { id: { in: [FIXTURES.clientA, FIXTURES.clientB] } },
          { workspaceId: { in: [FIXTURES.wsAlpha, FIXTURES.wsBravo, FIXTURES.independentTechC.personalWsId] } },
        ],
      },
    });
    await prisma.membership.deleteMany({
      where: {
        workspaceId: { in: [FIXTURES.wsAlpha, FIXTURES.wsBravo, FIXTURES.independentTechC.personalWsId] },
      },
    });
    await prisma.workspace.deleteMany({
      where: {
        id: { in: [FIXTURES.wsAlpha, FIXTURES.wsBravo, FIXTURES.independentTechC.personalWsId] },
      },
    });
    await prisma.appUser.deleteMany({
      where: {
        id: {
          in: [
            FIXTURES.ownerA.appUserId,
            FIXTURES.ownerB.appUserId,
            FIXTURES.techA1.appUserId,
            FIXTURES.techA2.appUserId,
            FIXTURES.techB.appUserId,
            FIXTURES.independentTechC.appUserId,
          ],
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [
            FIXTURES.ownerA.userId,
            FIXTURES.ownerB.userId,
            FIXTURES.techA1.userId,
            FIXTURES.techA2.userId,
            FIXTURES.techB.userId,
            FIXTURES.independentTechC.userId,
          ],
        },
      },
    });
  }

  // =========================================================================
  // GRUPO A: TESTES ESTRUTURAIS (SCHEMA, COMPOSITE INTEGRITY, CONSTRAINTS)
  // Status esperado: GREEN (prova que T01 foi executado com sucesso)
  // =========================================================================
  describe("Grupo A: Validações Estruturais e Invariantes de Banco (GREEN)", () => {
    it("PERSONAL-01: Schema suporta criação de personal workspace vinculado a AppUser", async () => {
      const personalWs = await prisma.workspace.create({
        data: {
          id: FIXTURES.independentTechC.personalWsId,
          name: "Oficina Pessoal - Tech C",
          type: "personal",
          ownerUserId: FIXTURES.independentTechC.appUserId,
        },
      });

      expect(personalWs).toBeDefined();
      expect(personalWs.type).toBe("personal");
      expect(personalWs.ownerUserId).toBe(FIXTURES.independentTechC.appUserId);
    });

    it("PERSONAL-UNIQUE-01: Duplo provisioning concorrente não pode criar dois personal workspaces para o mesmo AppUser", async () => {
      // Tentativa de criar segundo workspace com type = 'personal' para o mesmo AppUser
      await expect(
        prisma.workspace.create({
          data: {
            id: "duplicate-personal-ws",
            name: "Oficina Pessoal Duplicada",
            type: "personal",
            ownerUserId: FIXTURES.independentTechC.appUserId,
          },
        })
      ).rejects.toThrow();

      // Porém, criar outro workspace corporativo (type = 'company') para o mesmo owner é permitido
      const secondCompanyWs = await prisma.workspace.create({
        data: {
          id: "second-company-ws-owner-c",
          name: "Oficina Comercial de C",
          type: "company",
          ownerUserId: FIXTURES.independentTechC.appUserId,
        },
      });
      expect(secondCompanyWs.type).toBe("company");

      // Limpa workspace corporativo secundário
      await prisma.workspace.delete({ where: { id: secondCompanyWs.id } });
    });

    it("PERSONAL-LIFE-01: Ciclo de vida idempotente do personal workspace via POST /api/workspaces/personal", async () => {
      const tokenC = signAccessToken({
        id: FIXTURES.independentTechC.userId,
        email: FIXTURES.independentTechC.email,
        role: "user",
      });

      // 1. Provisiona workspace pessoal pela primeira vez
      const res1 = await fetch(`${baseUrl}/api/workspaces/personal`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenC}`,
        },
      });

      expect(res1.status).toBe(200);
      const data1 = await res1.json();
      expect(data1.workspace).toBeDefined();
      expect(data1.workspace.type).toBe("personal");
      expect(data1.workspace.owner_user_id).toBe(FIXTURES.independentTechC.appUserId);

      // 2. Chamada subsequente (idempotente) deve retornar o mesmo workspace sem erro
      const res2 = await fetch(`${baseUrl}/api/workspaces/personal`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenC}`,
        },
      });

      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.workspace.id).toBe(data1.workspace.id);
    });

    it("PERSONAL-RES-01: RequestContext resolve automaticamente o personal workspace na ausência de X-Workspace-Id", async () => {
      const tokenC = signAccessToken({
        id: FIXTURES.independentTechC.userId,
        email: FIXTURES.independentTechC.email,
        role: "user",
      });

      // Técnico autônomo sem cabeçalho X-Workspace-Id
      const response = await fetch(`${baseUrl}/api/clients`, {
        headers: {
          Authorization: `Bearer ${tokenC}`,
        },
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(Array.isArray(body.clients)).toBe(true);
    });

    it("CLIENT-CRUD-01: POST /api/clients cadastra cliente no workspace e GET /api/clients lista", async () => {
      const tokenA = signAccessToken({
        id: FIXTURES.ownerA.userId,
        email: FIXTURES.ownerA.email,
        role: "user",
      });

      const resCreate = await fetch(`${baseUrl}/api/clients`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Oficina Alpha Auto Center",
          contactEmail: "contato@alpha.com",
          contactPhone: "+351 912345678",
          address: "Rua Central 100, Lisboa",
        }),
      });

      expect(resCreate.status).toBe(201);
      const created = await resCreate.json();
      expect(created.client).toBeDefined();
      expect(created.client.name).toBe("Oficina Alpha Auto Center");
      expect(created.client.workspaceId).toBe(FIXTURES.wsAlpha);

      const resList = await fetch(`${baseUrl}/api/clients`, {
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
        },
      });

      expect(resList.status).toBe(200);
      const list = await resList.json();
      const found = list.clients.find((c: any) => c.name === "Oficina Alpha Auto Center");
      expect(found).toBeDefined();
      expect(found.id).toBe(created.client.id);
    });

    it("CLIENT-ISOLATION-01: Isolamento estrito de clientes entre workspaces (GET / e GET /:id retornam 404 para outro tenant)", async () => {
      // 1. Cliente cadastrado no Workspace A
      const tokenA = signAccessToken({
        id: FIXTURES.ownerA.userId,
        email: FIXTURES.ownerA.email,
        role: "user",
      });

      const resCreate = await fetch(`${baseUrl}/api/clients`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Cliente Secreto Workspace A",
        }),
      });

      const { client: clientA } = await resCreate.json();

      // 2. Usuário de Workspace B lista clientes do seu workspace
      const tokenB = signAccessToken({
        id: FIXTURES.ownerB.userId,
        email: FIXTURES.ownerB.email,
        role: "user",
      });

      const resListB = await fetch(`${baseUrl}/api/clients`, {
        headers: {
          Authorization: `Bearer ${tokenB}`,
          "X-Workspace-Id": FIXTURES.wsBravo,
        },
      });

      expect(resListB.status).toBe(200);
      const listB = await resListB.json();
      const leak = listB.clients.find((c: any) => c.id === clientA.id);
      expect(leak).toBeUndefined();

      // 3. Usuário de Workspace B tenta consultar diretamente o ID do cliente de A
      const resGetB = await fetch(`${baseUrl}/api/clients/${clientA.id}`, {
        headers: {
          Authorization: `Bearer ${tokenB}`,
          "X-Workspace-Id": FIXTURES.wsBravo,
        },
      });

      // Deve retornar 404 para evitar enumeração de recursos (Zero Trust / BOLA)
      expect(resGetB.status).toBe(404);
    });

    it("PO-03: Foreign Key Composta garante que budgetRevisionId pertença obrigatoriamente ao mesmo budgetId", async () => {
      // 1. Criar Budget 1 com Revision 1
      const budget1 = await prisma.budget.create({
        data: {
          id: "b1111111-1111-4111-8111-111111111111",
          workspaceId: FIXTURES.wsAlpha,
          code: "ORC-001",
          createdById: FIXTURES.ownerA.userId,
        },
      });

      const revision1 = await prisma.budgetRevision.create({
        data: {
          id: "r1111111-1111-4111-8111-111111111111",
          budgetId: budget1.id,
          revisionNumber: 1,
          clientSnapshot: { name: "Cliente 1" },
          vehicleSnapshot: { plate: "ABC-1234" },
          grossTotal: 100.0,
          netTotal: 100.0,
          finalTotal: 100.0,
          createdById: FIXTURES.ownerA.userId,
        },
      });

      // 2. Criar Budget 2 com Revision 2
      const budget2 = await prisma.budget.create({
        data: {
          id: "b2222222-2222-4222-8222-222222222222",
          workspaceId: FIXTURES.wsAlpha,
          code: "ORC-002",
          createdById: FIXTURES.ownerA.userId,
        },
      });

      const revision2 = await prisma.budgetRevision.create({
        data: {
          id: "r2222222-2222-4222-8222-222222222222",
          budgetId: budget2.id,
          revisionNumber: 1,
          clientSnapshot: { name: "Cliente 2" },
          vehicleSnapshot: { plate: "XYZ-5678" },
          grossTotal: 200.0,
          netTotal: 200.0,
          finalTotal: 200.0,
          createdById: FIXTURES.ownerA.userId,
        },
      });

      // 3. Tentativa forjada: Vincular ProductionOrder ao Budget 1 com a Revision do Budget 2
      // A constraint composta (budget_revision_id, budget_id) -> budget_revisions(id, budget_id) deve REJEITAR!
      await expect(
        prisma.productionOrder.create({
          data: {
            id: "po-forged-integrity",
            workspaceId: FIXTURES.wsAlpha,
            code: "OP-FORGED",
            budgetId: budget1.id,
            budgetRevisionId: revision2.id, // Pertence ao Budget 2!
            createdBy: FIXTURES.ownerA.userId,
          },
        })
      ).rejects.toThrow();

      // 4. Vinculação legítima (mesmo budgetId) deve ter SUCESSO
      const validPO = await prisma.productionOrder.create({
        data: {
          id: "po-valid-integrity",
          workspaceId: FIXTURES.wsAlpha,
          code: "OP-VALID",
          budgetId: budget1.id,
          budgetRevisionId: revision1.id, // Pertence ao Budget 1!
          createdBy: FIXTURES.ownerA.userId,
        },
      });
      expect(validPO.budgetRevisionId).toBe(revision1.id);
    });

    it("PO-01 (Estrutural): Cardinalidade 1:0..1 via constraint @@unique([budgetId])", async () => {
      // Budget 1 já possui uma ProductionOrder (criada no teste anterior)
      // Tentativa de criar uma SEGUNDA ProductionOrder para o mesmo budgetId deve falhar por unicidade
      await expect(
        prisma.productionOrder.create({
          data: {
            id: "po-duplicate-budget",
            workspaceId: FIXTURES.wsAlpha,
            code: "OP-DUP-001",
            budgetId: "b1111111-1111-4111-8111-111111111111",
            createdBy: FIXTURES.ownerA.userId,
          },
        })
      ).rejects.toThrow();
    });

    it("DIRECT-OP-01: ProductionOrder sem Budget continua perfeitamente suportada (budgetId = null)", async () => {
      const directPO = await prisma.productionOrder.create({
        data: {
          id: "po-direct-flow",
          workspaceId: FIXTURES.wsAlpha,
          code: "OP-DIRECT-001",
          budgetId: null,
          budgetRevisionId: null,
          createdBy: FIXTURES.ownerA.userId,
        },
      });

      expect(directPO).toBeDefined();
      expect(directPO.budgetId).toBeNull();
      expect(directPO.budgetRevisionId).toBeNull();
    });

    it("SYNC-01: Migração idempotente com @@unique([workspaceId, legacyLocalId]) impede duplicatas", async () => {
      // 1. Criar Budget com legacyLocalId
      await prisma.budget.create({
        data: {
          id: "b-sync-01",
          workspaceId: FIXTURES.wsAlpha,
          code: "ORC-SYNC-1",
          legacyLocalId: "local-client-uid-12345",
          createdById: FIXTURES.ownerA.userId,
        },
      });

      // 2. Tentativa de reinserir o mesmo legacyLocalId no mesmo workspace deve violar unicidade
      await expect(
        prisma.budget.create({
          data: {
            id: "b-sync-02",
            workspaceId: FIXTURES.wsAlpha,
            code: "ORC-SYNC-2",
            legacyLocalId: "local-client-uid-12345",
            createdById: FIXTURES.ownerA.userId,
          },
        })
      ).rejects.toThrow();
    });

    it("POINTER-01: Budget A não aceita currentRevisionId apontando para revisão de Budget B", async () => {
      // Tentativa de fazer o Budget 1 apontar currentRevisionId para a Revision 2 (que pertence ao Budget 2)
      // A FK composta (current_revision_id, id) -> budget_revisions(id, budget_id) deve REJEITAR!
      await expect(
        prisma.budget.update({
          where: { id: "b1111111-1111-4111-8111-111111111111" },
          data: {
            currentRevisionId: "r2222222-2222-4222-8222-222222222222", // Pertence a Budget 2!
          },
        })
      ).rejects.toThrow();

      // Já apontar para a Revision 1 (do próprio Budget 1) deve ter SUCESSO
      const updated = await prisma.budget.update({
        where: { id: "b1111111-1111-4111-8111-111111111111" },
        data: {
          currentRevisionId: "r1111111-1111-4111-8111-111111111111",
        },
      });
      expect(updated.currentRevisionId).toBe("r1111111-1111-4111-8111-111111111111");
    });

    it("POINTER-02: Budget A não aceita approvedRevisionId apontando para revisão de Budget B", async () => {
      // A FK composta (approved_revision_id, id) -> budget_revisions(id, budget_id) deve REJEITAR!
      await expect(
        prisma.budget.update({
          where: { id: "b1111111-1111-4111-8111-111111111111" },
          data: {
            approvedRevisionId: "r2222222-2222-4222-8222-222222222222", // Pertence a Budget 2!
          },
        })
      ).rejects.toThrow();

      // Apontar para Revision 1 (do próprio Budget 1) deve ter SUCESSO
      const updated = await prisma.budget.update({
        where: { id: "b1111111-1111-4111-8111-111111111111" },
        data: {
          approvedRevisionId: "r1111111-1111-4111-8111-111111111111",
        },
      });
      expect(updated.approvedRevisionId).toBe("r1111111-1111-4111-8111-111111111111");
    });

    it("PO-LINEAGE-01: CHECK constraint rejeita budgetRevisionId preenchido com budgetId NULL", async () => {
      // Tentativa de criar OP com budgetRevisionId preenchido mas budgetId nulo
      // Viola a CHECK constraint: production_orders_budget_lineage_check
      await expect(
        prisma.productionOrder.create({
          data: {
            id: "po-invalid-lineage-check",
            workspaceId: FIXTURES.wsAlpha,
            code: "OP-CHECK-FAIL",
            budgetId: null,
            budgetRevisionId: "r1111111-1111-4111-8111-111111111111",
            createdBy: FIXTURES.ownerA.userId,
          },
        })
      ).rejects.toThrow();
    });

    it("PO-LINEAGE-02: Excluir BudgetRevision referenciada por ProductionOrder é bloqueado por ON DELETE RESTRICT", async () => {
      // A OP 'po-valid-integrity' criada no teste PO-03 referencia revision1 (r1111111-1111-4111-8111-111111111111)
      // Tentativa de deletar fisicamente a BudgetRevision deve ser sumariamente bloqueada pelo PostgreSQL
      await expect(
        prisma.budgetRevision.delete({
          where: { id: "r1111111-1111-4111-8111-111111111111" },
        })
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // GRUPO C: SERVIÇO DE DOMÍNIO DE ORÇAMENTOS - budgetService (T05)
  // Status esperado: GREEN (testa regras de negócio, cálculos, atomicidade e idempotência)
  // =========================================================================
  describe("Grupo C: Serviço de Domínio de Orçamentos (T05)", () => {
    it("DECIMAL-01: calculateRevisionTotals processa cálculos monetários com precisão Decimal e 2 casas", () => {
      const totals = calculateRevisionTotals({
        grossTotal: 1000.0,
        discountPct: 10.0,
        taxPct: 23.0,
      });

      expect(totals.grossTotal).toBeInstanceOf(Prisma.Decimal);
      expect(totals.grossTotal.toString()).toBe("1000");
      expect(totals.discountTotal.toString()).toBe("100");
      expect(totals.netTotal.toString()).toBe("900");
      expect(totals.taxTotal.toString()).toBe("207");
      expect(totals.finalTotal.toString()).toBe("1107");
    });

    it("SERVICE-BUDGET-01: createBudget gera agregador Budget, Revision 1 (draft) e código sequencial", async () => {
      const res = await createBudget({
        workspaceId: FIXTURES.wsAlpha,
        createdById: FIXTURES.ownerA.userId,
        clientId: FIXTURES.clientA,
        clientName: "Cliente Alpha 1",
        vehiclePlate: "SVC-001",
        grossTotal: 500.0,
        discountPct: 5.0,
        taxPct: 23.0,
      });

      expect(res.budget).toBeDefined();
      expect(res.budget.code).toMatch(/^ORC-\d{4}-\d{4}$/);
      expect(res.budget.currentRevisionNumber).toBe(1);
      expect(res.revision.status).toBe("draft");
      expect(res.budget.currentRevisionId).toBe(res.revision.id);
      expect(res.budget.approvedRevisionId).toBeNull();
    });

    it("SERVICE-CLIENT-CROSS-01: createBudget rejeita clientId pertencente a outro workspace", async () => {
      await expect(
        createBudget({
          workspaceId: FIXTURES.wsAlpha,
          createdById: FIXTURES.ownerA.userId,
          clientId: FIXTURES.clientB, // Pertence a wsBravo
          vehiclePlate: "SVC-CROSS",
        })
      ).rejects.toThrow(ForbiddenError);
    });

    it("SERVICE-REVISION-IMMUTABLE-01: updateBudgetRevision edita draft in-place e gera nova revisão se aprovada", async () => {
      // 1. Cria orçamento
      const { budget, revision } = await createBudget({
        workspaceId: FIXTURES.wsAlpha,
        createdById: FIXTURES.ownerA.userId,
        clientId: FIXTURES.clientA,
        vehiclePlate: "IMMUT-01",
        grossTotal: 200.0,
      });

      // 2. Edita draft -> in-place
      const draftUpdate = await updateBudgetRevision(
        FIXTURES.wsAlpha,
        budget.id,
        revision.id,
        FIXTURES.ownerA.userId,
        { grossTotal: 250.0 }
      );
      expect(draftUpdate.isNewRevision).toBe(false);
      expect(draftUpdate.revision.id).toBe(revision.id);
      expect(draftUpdate.revision.finalTotal.toString()).toBe("250");

      // 3. Aprova revisão
      const approved = await approveBudgetRevision(
        FIXTURES.wsAlpha,
        budget.id,
        revision.id,
        FIXTURES.ownerA.userId
      );
      expect(approved.revision.status).toBe("approved");

      // 4. Edição subsequente após aprovação -> FORK da revisão 2
      const postApprUpdate = await updateBudgetRevision(
        FIXTURES.wsAlpha,
        budget.id,
        revision.id,
        FIXTURES.ownerA.userId,
        { grossTotal: 400.0 }
      );
      expect(postApprUpdate.isNewRevision).toBe(true);
      expect(postApprUpdate.revision.revisionNumber).toBe(2);
      expect(postApprUpdate.revision.status).toBe("draft");
      expect(postApprUpdate.revision.finalTotal.toString()).toBe("400");
      expect(postApprUpdate.budget.currentRevisionId).toBe(postApprUpdate.revision.id);
      expect(postApprUpdate.budget.approvedRevisionId).toBe(revision.id);

      // Revisão 1 permanece aprovada e intacta
      const rev1 = await prisma.budgetRevision.findUnique({ where: { id: revision.id } });
      expect(rev1?.status).toBe("approved");
      expect(rev1?.finalTotal.toString()).toBe("250");
    });

    it("SERVICE-APPROVE-TRANSACTION-01: approveBudgetRevision cria OP e re-aprovação atualiza mesma OP via whitelist", async () => {
      // 1. Cria orçamento com revisão 1
      const { budget, revision: rev1 } = await createBudget({
        workspaceId: FIXTURES.wsAlpha,
        createdById: FIXTURES.ownerA.userId,
        clientId: FIXTURES.clientA,
        vehiclePlate: "PO-TRAN-01",
        grossTotal: 300.0,
      });

      // 2. Primeira aprovação -> Cria ProductionOrder (1:0..1)
      const resApprove1 = await approveBudgetRevision(
        FIXTURES.wsAlpha,
        budget.id,
        rev1.id,
        FIXTURES.ownerA.userId
      );
      expect(resApprove1.productionOrder).toBeDefined();
      expect(resApprove1.productionOrder.budgetId).toBe(budget.id);
      expect(resApprove1.productionOrder.budgetRevisionId).toBe(rev1.id);
      expect(resApprove1.productionOrder.status).toBe("in_production");

      const poId = resApprove1.productionOrder.id;

      // 3. Cria revisão 2
      const resRev2 = await updateBudgetRevision(
        FIXTURES.wsAlpha,
        budget.id,
        rev1.id,
        FIXTURES.ownerA.userId,
        { grossTotal: 600.0, vehicleSnapshot: { plate: "PO-TRAN-01-REV2" } }
      );

      // 4. Re-aprovação da revisão 2 -> Atualiza a MESMA OP conforme whitelist
      const resApprove2 = await approveBudgetRevision(
        FIXTURES.wsAlpha,
        budget.id,
        resRev2.revision.id,
        FIXTURES.ownerA.userId
      );
      expect(resApprove2.productionOrder.id).toBe(poId);
      expect(resApprove2.productionOrder.budgetRevisionId).toBe(resRev2.revision.id);
      expect(resApprove2.productionOrder.status).toBe("in_production"); // status preservado
      expect(resApprove2.productionOrder.licensePlate).toBe("PO-TRAN-01-REV2"); // whitelist permitida

      // Confirma que não existe mais de 1 OP para o mesmo budget
      const poCount = await prisma.productionOrder.count({ where: { budgetId: budget.id } });
      expect(poCount).toBe(1);
    });

    it("SERVICE-DELIVERED-LOCK-01: approveBudgetRevision em OP com status delivered retorna erro 422 UnprocessableEntity", async () => {
      const { budget, revision } = await createBudget({
        workspaceId: FIXTURES.wsAlpha,
        createdById: FIXTURES.ownerA.userId,
        vehiclePlate: "DELIV-01",
        grossTotal: 150.0,
      });

      const appr = await approveBudgetRevision(
        FIXTURES.wsAlpha,
        budget.id,
        revision.id,
        FIXTURES.ownerA.userId
      );

      // Simula entrega finalizada na oficina
      await prisma.productionOrder.update({
        where: { id: appr.productionOrder.id },
        data: { status: "delivered", deliveredAt: new Date() },
      });

      // Cria revisão 2
      const rev2 = await updateBudgetRevision(
        FIXTURES.wsAlpha,
        budget.id,
        revision.id,
        FIXTURES.ownerA.userId,
        { grossTotal: 300.0 }
      );

      // Tentativa de aprovar orçamento com OP já entregue deve lançar UnprocessableEntityError (422)
      await expect(
        approveBudgetRevision(
          FIXTURES.wsAlpha,
          budget.id,
          rev2.revision.id,
          FIXTURES.ownerA.userId
        )
      ).rejects.toThrow(UnprocessableEntityError);
    });

    it("SERVICE-REJECT-01: rejectBudgetRevision registra motivo e bloqueia rejeição de revisão aprovada", async () => {
      const { budget, revision } = await createBudget({
        workspaceId: FIXTURES.wsAlpha,
        createdById: FIXTURES.ownerA.userId,
        vehiclePlate: "REJ-01",
      });

      const rejected = await rejectBudgetRevision(
        FIXTURES.wsAlpha,
        budget.id,
        revision.id,
        FIXTURES.ownerA.userId,
        "Valor considerado elevado pelo perito"
      );

      expect(rejected.revision.status).toBe("rejected");
      expect((rejected.revision.rejection as any).reason).toBe("Valor considerado elevado pelo perito");

      // Cria e aprova nova revisão para testar bloqueio
      const rev2 = await updateBudgetRevision(
        FIXTURES.wsAlpha,
        budget.id,
        revision.id,
        FIXTURES.ownerA.userId,
        { grossTotal: 50.0 }
      );
      await approveBudgetRevision(
        FIXTURES.wsAlpha,
        budget.id,
        rev2.revision.id,
        FIXTURES.ownerA.userId
      );

      // Tentar rejeitar revisão aprovada deve lançar ConflictError (409)
      await expect(
        rejectBudgetRevision(
          FIXTURES.wsAlpha,
          budget.id,
          rev2.revision.id,
          FIXTURES.ownerA.userId,
          "Motivo tardio"
        )
      ).rejects.toThrow(ConflictError);
    });

    it("SERVICE-SYNC-LOCAL-01: syncLocalBudgets migra orçamentos legados com idempotência concorrente", async () => {
      const localItems = [
        { legacyLocalId: "local-sync-uuid-1", clientName: "Cliente Local 1", vehiclePlate: "LOC-001", grossTotal: 120.0 },
        { legacyLocalId: "local-sync-uuid-2", clientName: "Cliente Local 2", vehiclePlate: "LOC-002", grossTotal: 250.0 },
      ];

      // 1. Primeira sincronização
      const sync1 = await syncLocalBudgets(FIXTURES.wsAlpha, FIXTURES.ownerA.userId, localItems);
      expect(sync1["local-sync-uuid-1"]).toBeDefined();
      expect(sync1["local-sync-uuid-2"]).toBeDefined();

      // 2. Segunda sincronização com os mesmos itens (retentativa / concorrência)
      const sync2 = await syncLocalBudgets(FIXTURES.wsAlpha, FIXTURES.ownerA.userId, localItems);
      expect(sync2["local-sync-uuid-1"]).toBe(sync1["local-sync-uuid-1"]);
      expect(sync2["local-sync-uuid-2"]).toBe(sync1["local-sync-uuid-2"]);

      // Confirma que não foram criados orçamentos duplicados no banco
      const count = await prisma.budget.count({
        where: {
          workspaceId: FIXTURES.wsAlpha,
          legacyLocalId: { in: ["local-sync-uuid-1", "local-sync-uuid-2"] },
        },
      });
      expect(count).toBe(2);
    });
  });

  // =========================================================================
  // GRUPO B: TESTES COMPORTAMENTAIS DE ACEITAÇÃO (T03-T08 BASELINE)
  // Status esperado: RED (falham pois endpoints e serviços ainda não existem)
  // =========================================================================
  describe("Grupo B: Comportamento de Negócio e Serviços (RED Baseline)", () => {
    it("TENANT-01: Usuário do Workspace A não lê Budget do Workspace B (404 Not Found para evitar enumeração)", async () => {
      const budgetB = await prisma.budget.create({
        data: {
          id: "b-ws-bravo-tenant-01",
          workspaceId: FIXTURES.wsBravo,
          code: "ORC-BRAVO-T01",
          createdById: FIXTURES.ownerB.userId,
        },
      });

      const tokenA = signAccessToken({
        id: FIXTURES.techA1.userId,
        email: FIXTURES.techA1.email,
        role: "user",
      });

      // Tentativa de ler orçamento do Workspace B
      const response = await fetch(`${baseUrl}/api/budgets/${budgetB.id}`, {
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
        },
      });

      // Padronização: lookup por ID de recurso de outro tenant retorna 404 Not Found
      expect(response.status).toBe(404);
      const text = await response.text();
      let body: any = {};
      try {
        body = JSON.parse(text);
      } catch {
        // Express HTML 404
      }
      expect(body.message || "").toMatch(/não encontrado|not found/i);
    });

    it("TECH-OWN-01: Técnico vinculado com scope own não acessa Budget de outro técnico", async () => {
      // Budget atribuído ao Técnico A1
      const budgetTechA1 = await prisma.budget.create({
        data: {
          id: "b-assigned-tech-a1",
          workspaceId: FIXTURES.wsAlpha,
          code: "ORC-TECH-A1",
          technicianUserId: FIXTURES.techA1.userId,
          createdById: FIXTURES.ownerA.userId,
        },
      });

      const tokenA2 = signAccessToken({
        id: FIXTURES.techA2.userId,
        email: FIXTURES.techA2.email,
        role: "user",
      });

      // Técnico A2 tenta consultar orçamento atribuído ao Técnico A1
      const response = await fetch(`${baseUrl}/api/budgets/${budgetTechA1.id}`, {
        headers: {
          Authorization: `Bearer ${tokenA2}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
        },
      });

      expect(response.status).toBe(403);
    });

    it("CLIENT-01: Cliente de outro workspace é rejeitado ao criar orçamento", async () => {
      const tokenA = signAccessToken({
        id: FIXTURES.ownerA.userId,
        email: FIXTURES.ownerA.email,
        role: "user",
      });

      // Payload apontando para clientB (que pertence a wsBravo)
      const response = await fetch(`${baseUrl}/api/budgets`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId: FIXTURES.clientB, // Pertence a wsBravo!
          clientName: "Cliente Forjado",
          vehiclePlate: "FRA-2026",
        }),
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.message).toMatch(/Cliente não pertence ao workspace ativo/i);
    });

    it("BUDGET-01: Criação de Orçamento gera agregador e Revision 1 com status draft", async () => {
      const tokenA = signAccessToken({
        id: FIXTURES.ownerA.userId,
        email: FIXTURES.ownerA.email,
        role: "user",
      });

      const response = await fetch(`${baseUrl}/api/budgets`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId: FIXTURES.clientA,
          clientName: "Cliente Alpha 1",
          vehiclePlate: "XYZ-9988",
          vehicleBrand: "Renault",
          vehicleModel: "Clio",
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.budget).toBeDefined();
      expect(body.budget.currentRevisionNumber).toBe(1);
      expect(body.budget.currentRevision.status).toBe("draft");
      expect(body.budget.approvedRevisionId).toBeNull();
    });

    it("REVISION-01: Revisão com status approved não pode ser sobrescrita", async () => {
      const tokenA = signAccessToken({
        id: FIXTURES.ownerA.userId,
        email: FIXTURES.ownerA.email,
        role: "user",
      });

      // 1. Criar orçamento com revisão já aprovada
      const budget = await prisma.budget.create({
        data: {
          id: "b-approved-lock",
          workspaceId: FIXTURES.wsAlpha,
          code: "ORC-LOCK",
          createdById: FIXTURES.ownerA.userId,
        },
      });

      const revApproved = await prisma.budgetRevision.create({
        data: {
          id: "r-approved-lock",
          budgetId: budget.id,
          revisionNumber: 1,
          status: "approved",
          clientSnapshot: { name: "Cliente" },
          vehicleSnapshot: { plate: "ABC-0000" },
          grossTotal: 500.0,
          netTotal: 500.0,
          finalTotal: 500.0,
          createdById: FIXTURES.ownerA.userId,
        },
      });

      await prisma.budget.update({
        where: { id: budget.id },
        data: { approvedRevisionId: revApproved.id, currentRevisionId: revApproved.id },
      });

      // 2. Tentar alterar diretamente o rascunho da revisão aprovada
      const response = await fetch(`${baseUrl}/api/budgets/${budget.id}/revisions/${revApproved.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grossTotal: 9999.0,
        }),
      });

      // Não pode atualizar in-place a revisão aprovada (deve criar nova revisão 2 ou bloquear)
      const after = await prisma.budgetRevision.findUnique({ where: { id: revApproved.id } });
      expect(Number(after?.finalTotal)).toBe(500.0);
    });

    it("REVISION-02: Edição após aprovação cria Revision 2 com status draft", async () => {
      const tokenA = signAccessToken({
        id: FIXTURES.ownerA.userId,
        email: FIXTURES.ownerA.email,
        role: "user",
      });

      const budget = await prisma.budget.create({
        data: {
          id: "b-approved-lock-2",
          workspaceId: FIXTURES.wsAlpha,
          code: "ORC-LOCK-2",
          createdById: FIXTURES.ownerA.userId,
        },
      });

      const revApproved = await prisma.budgetRevision.create({
        data: {
          id: "r-approved-lock-2",
          budgetId: budget.id,
          revisionNumber: 1,
          status: "approved",
          clientSnapshot: { name: "Cliente" },
          vehicleSnapshot: { plate: "ABC-0000" },
          grossTotal: 500.0,
          netTotal: 500.0,
          finalTotal: 500.0,
          createdById: FIXTURES.ownerA.userId,
        },
      });

      await prisma.budget.update({
        where: { id: budget.id },
        data: { approvedRevisionId: revApproved.id, currentRevisionId: revApproved.id },
      });

      const response = await fetch(`${baseUrl}/api/budgets/${budget.id}/revisions/${revApproved.id}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          grossTotal: 650.0,
          notes: "Adição de para-choque",
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.revision.revisionNumber).toBe(2);
      expect(body.revision.status).toBe("draft");

      // Revisão 1 permanece aprovada e intacta
      const rev1 = await prisma.budgetRevision.findUnique({ where: { id: revApproved.id } });
      expect(rev1?.status).toBe("approved");
    });

    it("PO-01 (Comportamental): Primeira aprovação gera uma única ProductionOrder", async () => {
      const tokenA = signAccessToken({
        id: FIXTURES.ownerA.userId,
        email: FIXTURES.ownerA.email,
        role: "user",
      });

      const budget = await prisma.budget.create({
        data: {
          id: "b-approve-flow",
          workspaceId: FIXTURES.wsAlpha,
          code: "ORC-APPR-1",
          createdById: FIXTURES.ownerA.userId,
        },
      });

      const rev = await prisma.budgetRevision.create({
        data: {
          id: "r-approve-flow-1",
          budgetId: budget.id,
          revisionNumber: 1,
          status: "submitted",
          clientSnapshot: { name: "Cliente" },
          vehicleSnapshot: { plate: "ABC-1111" },
          createdById: FIXTURES.ownerA.userId,
        },
      });

      const response = await fetch(`${baseUrl}/api/budgets/${budget.id}/revisions/${rev.id}/approve`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ revisionId: rev.id }),
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.productionOrder).toBeDefined();
      expect(body.productionOrder.budgetId).toBe(budget.id);
      expect(body.productionOrder.budgetRevisionId).toBe(rev.id);
    });

    it("PO-02: Re-aprovação com OP aberta atualiza a mesma OP conforme whitelist", async () => {
      // 1. Cria a revisão 2 para o orçamento b-approve-flow
      await prisma.budgetRevision.create({
        data: {
          id: "r-new-rev-2",
          budgetId: "b-approve-flow",
          revisionNumber: 2,
          status: "submitted",
          clientSnapshot: { name: "Cliente" },
          vehicleSnapshot: { plate: "ABC-1111", model: "Clio Atualizado" },
          grossTotal: 800.0,
          netTotal: 800.0,
          finalTotal: 800.0,
          createdById: FIXTURES.ownerA.userId,
        },
      });

      const tokenA = signAccessToken({
        id: FIXTURES.ownerA.userId,
        email: FIXTURES.ownerA.email,
        role: "user",
      });

      const response = await fetch(`${baseUrl}/api/budgets/b-approve-flow/revisions/r-new-rev-2/approve`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ revisionId: "r-new-rev-2" }),
      });

      expect(response.status).toBe(200);
      // Confirma que nenhuma segunda OP foi criada
      const totalOPs = await prisma.productionOrder.count({ where: { budgetId: "b-approve-flow" } });
      expect(totalOPs).toBe(1);
    });

    it("CONCURRENT-01: Aprovações concorrentes não geram duas OPs", async () => {
      const tokenA = signAccessToken({
        id: FIXTURES.ownerA.userId,
        email: FIXTURES.ownerA.email,
        role: "user",
      });

      const budget = await prisma.budget.create({
        data: {
          id: "b-race-approve",
          workspaceId: FIXTURES.wsAlpha,
          code: "ORC-RACE",
          createdById: FIXTURES.ownerA.userId,
        },
      });

      const rev = await prisma.budgetRevision.create({
        data: {
          id: "r-race-approve",
          budgetId: budget.id,
          revisionNumber: 1,
          status: "submitted",
          clientSnapshot: { name: "Cliente" },
          vehicleSnapshot: { plate: "RACE-01" },
          createdById: FIXTURES.ownerA.userId,
        },
      });

      // Dispara 2 aprovações simultâneas
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/budgets/${budget.id}/revisions/${rev.id}/approve`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenA}`,
            "X-Workspace-Id": FIXTURES.wsAlpha,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ revisionId: rev.id }),
        }),
        fetch(`${baseUrl}/api/budgets/${budget.id}/revisions/${rev.id}/approve`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenA}`,
            "X-Workspace-Id": FIXTURES.wsAlpha,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ revisionId: rev.id }),
        }),
      ]);

      // Ao menos uma deve suceder ou ambas reconciliarem idempotentemente
      const statuses = [res1.status, res2.status];
      expect(statuses.filter((s) => s === 200 || s === 201).length).toBeGreaterThanOrEqual(1);

      // No banco de dados, nunca pode haver mais de 1 OP
      const count = await prisma.productionOrder.count({ where: { budgetId: budget.id } });
      expect(count).toBe(1);
    });
  });

  // =========================================================================
  // Grupo D: Proteção e Adequação de productionOrders.ts ao RequestContext (T07)
  // =========================================================================
  describe("Grupo D: Proteção e Adequação de productionOrders.ts ao RequestContext (T07)", () => {
    it("PO-CTX-01: GET /api/production-orders filtra automaticamente pelo workspace do token, ignorando workspace_id forjado na query", async () => {
      // Cria uma ordem no Workspace Alpha e outra no Workspace Bravo
      const orderAlpha = await prisma.productionOrder.create({
        data: {
          id: "po-ctx-alpha-01",
          workspaceId: FIXTURES.wsAlpha,
          code: "PO-ALPHA-01",
          clientName: "Cliente Alpha",
          createdBy: FIXTURES.ownerA.userId,
        },
      });

      const orderBravo = await prisma.productionOrder.create({
        data: {
          id: "po-ctx-bravo-01",
          workspaceId: FIXTURES.wsBravo,
          code: "PO-BRAVO-01",
          clientName: "Cliente Bravo",
          createdBy: FIXTURES.ownerB.userId,
        },
      });

      const tokenA = signAccessToken({
        id: FIXTURES.ownerA.userId,
        email: FIXTURES.ownerA.email,
        role: "user",
      });

      // Tenta forjar a query buscando o workspace Bravo
      const response = await fetch(`${baseUrl}/api/production-orders?workspace_id=${FIXTURES.wsBravo}`, {
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
        },
      });

      expect(response.status).toBe(200);
      const orders: any[] = await response.json();
      const ids = orders.map((o) => o.id);
      expect(ids).toContain(orderAlpha.id);
      expect(ids).not.toContain(orderBravo.id);
    });

    it("PO-CTX-02: Técnico com papel technician só visualiza suas próprias ordens de produção (own scope)", async () => {
      // Ordem atribuída ao Tech A1
      const orderTechA1 = await prisma.productionOrder.create({
        data: {
          id: "po-tech-a1-only",
          workspaceId: FIXTURES.wsAlpha,
          code: "PO-TECH-01",
          technicianUserId: FIXTURES.techA1.userId,
          createdBy: FIXTURES.ownerA.userId,
        },
      });

      // Ordem atribuída ao Tech A2
      const orderTechA2 = await prisma.productionOrder.create({
        data: {
          id: "po-tech-a2-only",
          workspaceId: FIXTURES.wsAlpha,
          code: "PO-TECH-02",
          technicianUserId: FIXTURES.techA2.userId,
          createdBy: FIXTURES.ownerA.userId,
        },
      });

      const tokenTech1 = signAccessToken({
        id: FIXTURES.techA1.userId,
        email: FIXTURES.techA1.email,
        role: "user",
      });

      const response = await fetch(`${baseUrl}/api/production-orders`, {
        headers: {
          Authorization: `Bearer ${tokenTech1}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
        },
      });

      expect(response.status).toBe(200);
      const orders: any[] = await response.json();
      const ids = orders.map((o) => o.id);
      expect(ids).toContain(orderTechA1.id);
      expect(ids).not.toContain(orderTechA2.id);
    });

    it("PO-DIRECT-01: POST /api/production-orders cria ordem direta com budgetId: null e budgetRevisionId: null", async () => {
      const tokenA = signAccessToken({
        id: FIXTURES.ownerA.userId,
        email: FIXTURES.ownerA.email,
        role: "user",
      });

      const response = await fetch(`${baseUrl}/api/production-orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_name: "Cliente Direto Balcão",
          brand: "Toyota",
          model: "Corolla",
          license_plate: "DIR-9999",
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.client_name).toBe("Cliente Direto Balcão");
      expect(body.budget_id).toBeNull();
      expect(body.budget_revision_id).toBeNull();
      expect(body.workspace_id).toBe(FIXTURES.wsAlpha);
      expect(body.created_by).toBe(FIXTURES.ownerA.userId);
    });

    it("TECH-ASSIGN-01: Técnico tentando atribuir ordem a outro técnico recebe 403 Forbidden", async () => {
      const tokenTech1 = signAccessToken({
        id: FIXTURES.techA1.userId,
        email: FIXTURES.techA1.email,
        role: "user",
      });

      const response = await fetch(`${baseUrl}/api/production-orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenTech1}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_name: "Cliente Invasão",
          technicianUserId: FIXTURES.techA2.userId, // Tentativa de atribuir a outro técnico
        }),
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.message).toContain("TECH-ASSIGN-01");
    });

    it("TECH-ASSIGN-01-SELF: Técnico sem informar technicianUserId tem a ordem auto-atribuída a si mesmo", async () => {
      const tokenTech1 = signAccessToken({
        id: FIXTURES.techA1.userId,
        email: FIXTURES.techA1.email,
        role: "user",
      });

      const response = await fetch(`${baseUrl}/api/production-orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenTech1}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_name: "Cliente Auto Atribuído",
          brand: "Honda",
          model: "Civic",
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.technician_user_id).toBe(FIXTURES.techA1.userId);
    });

    it("TECH-ASSIGN-02: Admin consegue atribuir ordem a técnico membro ativo do mesmo workspace", async () => {
      const tokenA = signAccessToken({
        id: FIXTURES.ownerA.userId,
        email: FIXTURES.ownerA.email,
        role: "user",
      });

      const response = await fetch(`${baseUrl}/api/production-orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_name: "Cliente Atribuído por Admin",
          technicianUserId: FIXTURES.techA1.userId,
        }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.technician_user_id).toBe(FIXTURES.techA1.userId);
    });

    it("TECH-ASSIGN-03 (FORGED-TECHNICIAN): Admin tentando atribuir técnico de outro workspace recebe 403 Forbidden", async () => {
      const tokenA = signAccessToken({
        id: FIXTURES.ownerA.userId,
        email: FIXTURES.ownerA.email,
        role: "user",
      });

      // Tentativa de atribuir o técnico B (que só pertence ao Workspace Bravo)
      const response = await fetch(`${baseUrl}/api/production-orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_name: "Cliente Técnico Forjado",
          technicianUserId: FIXTURES.techB.userId,
        }),
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.message).toContain("não é membro ativo");
    });

    it("PO-TENANT-ISOLATION-01: Usuário do Workspace A tentando PATCH ou DELETE em ordem do Workspace B recebe 404 Not Found", async () => {
      const orderBravo = await prisma.productionOrder.create({
        data: {
          id: "po-bravo-iso-01",
          workspaceId: FIXTURES.wsBravo,
          code: "PO-BRAVO-ISO",
          clientName: "Cliente Bravo Isolado",
          createdBy: FIXTURES.ownerB.userId,
        },
      });

      const tokenA = signAccessToken({
        id: FIXTURES.ownerA.userId,
        email: FIXTURES.ownerA.email,
        role: "user",
      });

      // Tentativa de PATCH
      const patchRes = await fetch(`${baseUrl}/api/production-orders/${orderBravo.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ notes: "Invasão" }),
      });
      expect(patchRes.status).toBe(404);

      // Tentativa de DELETE
      const deleteRes = await fetch(`${baseUrl}/api/production-orders/${orderBravo.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
        },
      });
      expect(deleteRes.status).toBe(404);
    });

    it("PO-TECH-DELETE-FORBIDDEN: Técnico tentando deletar ordem de produção recebe 403 Forbidden", async () => {
      const orderTech = await prisma.productionOrder.create({
        data: {
          id: "po-tech-delete-test",
          workspaceId: FIXTURES.wsAlpha,
          code: "PO-TECH-DEL",
          technicianUserId: FIXTURES.techA1.userId,
          createdBy: FIXTURES.ownerA.userId,
        },
      });

      const tokenTech1 = signAccessToken({
        id: FIXTURES.techA1.userId,
        email: FIXTURES.techA1.email,
        role: "user",
      });

      const deleteRes = await fetch(`${baseUrl}/api/production-orders/${orderTech.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${tokenTech1}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
        },
      });

      expect(deleteRes.status).toBe(403);
      const body = await deleteRes.json();
      expect(body.message).toContain("Permissão insuficiente");
    });

    it("BUDGET-TECH-ASSIGN-01: Técnico tentando criar orçamento atribuindo a outro técnico recebe 403 Forbidden", async () => {
      const tokenTech1 = signAccessToken({
        id: FIXTURES.techA1.userId,
        email: FIXTURES.techA1.email,
        role: "user",
      });

      const response = await fetch(`${baseUrl}/api/budgets`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenTech1}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientName: "Cliente Tentativa Ilícita",
          technicianUserId: FIXTURES.techA2.userId,
        }),
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.message).toContain("TECH-ASSIGN-01");
    });
  });
});
