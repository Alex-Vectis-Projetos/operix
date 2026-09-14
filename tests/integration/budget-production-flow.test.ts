// @vitest-environment node
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
// @ts-expect-error backend dependency
import express, { type Request, type Response, type NextFunction } from "../../backend/node_modules/express/index.js";
import { prisma } from "../../backend/src/lib/prisma.js";
import { signAccessToken } from "../../backend/src/lib/jwt.js";
import { ForbiddenError } from "../../backend/src/lib/objectAuth.js";

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

    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
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
    await prisma.budgetRevision.deleteMany({});
    await prisma.budget.deleteMany({
      where: { workspaceId: { in: [FIXTURES.wsAlpha, FIXTURES.wsBravo, FIXTURES.independentTechC.personalWsId] } },
    });
    await prisma.client.deleteMany({
      where: { id: { in: [FIXTURES.clientA, FIXTURES.clientB] } },
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
  });

  // =========================================================================
  // GRUPO B: TESTES COMPORTAMENTAIS DE ACEITAÇÃO (T03-T08 BASELINE)
  // Status esperado: RED (falham pois endpoints e serviços ainda não existem)
  // =========================================================================
  describe("Grupo B: Comportamento de Negócio e Serviços (RED Baseline)", () => {
    it("TENANT-01: Usuário do Workspace A não lê Budget do Workspace B", async () => {
      const tokenA = signAccessToken({
        id: FIXTURES.techA1.userId,
        email: FIXTURES.techA1.email,
        role: "user",
      });

      // Tentativa de ler orçamento do Workspace B
      const response = await fetch(`${baseUrl}/api/budgets/b2222222-2222-4222-8222-222222222222`, {
        headers: {
          Authorization: `Bearer ${tokenA}`,
          "X-Workspace-Id": FIXTURES.wsAlpha,
        },
      });

      // Deve falhar com 403 Forbidden (ou 404 deny-by-default)
      // Atualmente retorna 404 (Route not implemented) ou rejeição
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.message).toMatch(/Acesso negado|Forbidden/i);
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

      const response = await fetch(`${baseUrl}/api/budgets/b-approved-lock/revisions/r-approved-lock`, {
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
      const rev1 = await prisma.budgetRevision.findUnique({ where: { id: "r-approved-lock" } });
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
});
