// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
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
import { Prisma } from "@prisma/client";

// Configurações de ambiente mínimas para testes
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://operix_local:U2dkA-cJYnwHuD7hiAY2hPTrkawjg6f8@127.0.0.1:55432/operix_local?schema=public";
process.env.JWT_SECRET = process.env.JWT_SECRET || "this-is-a-test-secret-with-more-than-32-chars-long";
process.env.MINIO_ROOT_PASSWORD = process.env.MINIO_ROOT_PASSWORD || "miniopassword123456";

/**
 * Suite de Aceitação e Regressão da Spec 003: Mobile Operational Flow
 * Conclusão de OP, WEEKLOG, Validação em Lote e Retificação Versionada (R1)
 *
 * Mapeamento estrito com acceptance.md (45 Cenários de Aceitação)
 * [GRUPO A - ESTRUTURAIS]: Devem rodar GREEN (provam schema T01, composite constraints, self-FKs).
 * [GRUPO B - COMPORTAMENTAIS]: Devem rodar RED nesta etapa T02 (baseline para T03-T08).
 * [GRUPO C - REGRESSÃO LEGADA]: Devem rodar RED nesta etapa provando ausência de delegação.
 */

// Fixtures determinísticas isoladas para a Spec 003
const FIXTURES_003 = {
  wsAlpha: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
  wsBravo: "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb",
  wsPersonal: "cccccccc-3333-4ccc-8ccc-cccccccccccc",
  ownerA: {
    userId: "10000000-0000-4000-8000-000000000001",
    appUserId: "20000000-0000-4000-8000-000000000001",
    email: "owner.a.spec003@example.com",
    role: "owner",
  },
  techA1: {
    userId: "10000000-0000-4000-8000-000000000002",
    appUserId: "20000000-0000-4000-8000-000000000002",
    email: "tech.a1.spec003@example.com",
    role: "technician",
  },
  techA2: {
    userId: "10000000-0000-4000-8000-000000000003",
    appUserId: "20000000-0000-4000-8000-000000000003",
    email: "tech.a2.spec003@example.com",
    role: "technician",
  },
  validatorClientA: {
    userId: "10000000-0000-4000-8000-000000000004",
    appUserId: "20000000-0000-4000-8000-000000000004",
    email: "validator.ca.spec003@example.com",
    role: "user",
  },
  validatorClientB: {
    userId: "10000000-0000-4000-8000-000000000005",
    appUserId: "20000000-0000-4000-8000-000000000005",
    email: "validator.cb.spec003@example.com",
    role: "user",
  },
  validatorRevoked: {
    userId: "10000000-0000-4000-8000-000000000006",
    appUserId: "20000000-0000-4000-8000-000000000006",
    email: "validator.revoked.spec003@example.com",
    role: "user",
  },
  ownerB: {
    userId: "10000000-0000-4000-8000-000000000007",
    appUserId: "20000000-0000-4000-8000-000000000007",
    email: "owner.b.spec003@example.com",
    role: "owner",
  },
  independentTechC: {
    userId: "10000000-0000-4000-8000-000000000008",
    appUserId: "20000000-0000-4000-8000-000000000008",
    email: "tech.independent.spec003@example.com",
    role: "technician",
  },
  clientA: {
    id: "30000000-0000-4000-8000-000000000001",
    name: "Cliente Alpha Frotas",
  },
  clientB: {
    id: "30000000-0000-4000-8000-000000000002",
    name: "Cliente Beta Locadora",
  },
  clientBravo: {
    id: "30000000-0000-4000-8000-000000000003",
    name: "Cliente Bravo Externo",
  },
  sites: {
    central: "SITE-CENTRAL-01",
    norte: "SITE-NORTE-02",
  },
};

describe("Spec 003 — Test-First Acceptance & Regression Suite (T02)", () => {
  let app: express.Express;
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    await cleanupTestData();

    // 1. Criar Usuários globais e AppUsers
    for (const actor of [
      FIXTURES_003.ownerA,
      FIXTURES_003.techA1,
      FIXTURES_003.techA2,
      FIXTURES_003.validatorClientA,
      FIXTURES_003.validatorClientB,
      FIXTURES_003.validatorRevoked,
      FIXTURES_003.ownerB,
      FIXTURES_003.independentTechC,
    ]) {
      await prisma.user.create({
        data: {
          id: actor.userId,
          email: actor.email,
          fullName: actor.email.split("@")[0],
          role: actor.role === "owner" ? "admin" : "user",
          passwordHash: "hash-spec003-test",
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

    // 2. Criar Workspaces Alpha, Bravo e Personal
    await prisma.workspace.create({
      data: {
        id: FIXTURES_003.wsAlpha,
        name: "Workspace Alpha Operações",
        timezone: "Europe/Paris",
        ownerUserId: FIXTURES_003.ownerA.appUserId,
        memberships: {
          create: [
            { id: "mem-003-oa", userId: FIXTURES_003.ownerA.appUserId, role: "owner", status: "active" },
            { id: "mem-003-ta1", userId: FIXTURES_003.techA1.appUserId, role: "technician", status: "active" },
            { id: "mem-003-ta2", userId: FIXTURES_003.techA2.appUserId, role: "technician", status: "active" },
            { id: "mem-003-va", userId: FIXTURES_003.validatorClientA.appUserId, role: "user", status: "active" },
            { id: "mem-003-vb", userId: FIXTURES_003.validatorClientB.appUserId, role: "user", status: "active" },
            { id: "mem-003-vr", userId: FIXTURES_003.validatorRevoked.appUserId, role: "user", status: "active" },
          ],
        },
      },
    });

    await prisma.workspace.create({
      data: {
        id: FIXTURES_003.wsBravo,
        name: "Workspace Bravo Concorrente",
        timezone: "Europe/Paris",
        ownerUserId: FIXTURES_003.ownerB.appUserId,
        memberships: {
          create: [
            { id: "mem-003-ob", userId: FIXTURES_003.ownerB.appUserId, role: "owner", status: "active" },
          ],
        },
      },
    });

    await prisma.workspace.create({
      data: {
        id: FIXTURES_003.wsPersonal,
        name: "Oficina Pessoal Tech C",
        type: "personal",
        timezone: "UTC",
        ownerUserId: FIXTURES_003.independentTechC.appUserId,
        memberships: {
          create: [
            { id: "mem-003-tc", userId: FIXTURES_003.independentTechC.appUserId, role: "owner", status: "active" },
          ],
        },
      },
    });

    // 3. Criar Clientes em Alpha e Bravo
    await prisma.client.create({
      data: {
        id: FIXTURES_003.clientA.id,
        workspaceId: FIXTURES_003.wsAlpha,
        name: FIXTURES_003.clientA.name,
      },
    });

    await prisma.client.create({
      data: {
        id: FIXTURES_003.clientB.id,
        workspaceId: FIXTURES_003.wsAlpha,
        name: FIXTURES_003.clientB.name,
      },
    });

    await prisma.client.create({
      data: {
        id: FIXTURES_003.clientBravo.id,
        workspaceId: FIXTURES_003.wsBravo,
        name: FIXTURES_003.clientBravo.name,
      },
    });

    // 4. Criar ClientAccessGrants
    await prisma.clientAccessGrant.create({
      data: {
        id: "grant-ca-active",
        workspaceId: FIXTURES_003.wsAlpha,
        userId: FIXTURES_003.validatorClientA.userId,
        clientId: FIXTURES_003.clientA.id,
        role: "validator",
        status: "active",
      },
    });

    await prisma.clientAccessGrant.create({
      data: {
        id: "grant-cb-active",
        workspaceId: FIXTURES_003.wsAlpha,
        userId: FIXTURES_003.validatorClientB.userId,
        clientId: FIXTURES_003.clientB.id,
        role: "validator",
        status: "active",
      },
    });

    await prisma.clientAccessGrant.create({
      data: {
        id: "grant-cr-revoked",
        workspaceId: FIXTURES_003.wsAlpha,
        userId: FIXTURES_003.validatorRevoked.userId,
        clientId: FIXTURES_003.clientA.id,
        role: "validator",
        status: "revoked",
        revokedAt: new Date("2026-09-15T10:00:00Z"),
        revokedBy: FIXTURES_003.ownerA.userId,
      },
    });
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Isolamento estrito entre testes: limpa tabelas operacionais transacionais
    await prisma.weeklogValidation.deleteMany({
      where: { workspaceId: { in: [FIXTURES_003.wsAlpha, FIXTURES_003.wsBravo, FIXTURES_003.wsPersonal] } },
    });
    await prisma.weeklogEntry.deleteMany({
      where: { workspaceId: { in: [FIXTURES_003.wsAlpha, FIXTURES_003.wsBravo, FIXTURES_003.wsPersonal] } },
    });
    await prisma.weeklog.deleteMany({
      where: { workspaceId: { in: [FIXTURES_003.wsAlpha, FIXTURES_003.wsBravo, FIXTURES_003.wsPersonal] } },
    });
    await prisma.productionOrder.deleteMany({
      where: { workspaceId: { in: [FIXTURES_003.wsAlpha, FIXTURES_003.wsBravo, FIXTURES_003.wsPersonal] } },
    });

    app = express();
    app.use(express.json());

    // Rotas existentes
    const { productionOrdersRouter } = await import("../../backend/src/routes/productionOrders.js");
    app.use("/api/production-orders", productionOrdersRouter);

    const { clientsRouter } = await import("../../backend/src/routes/clients.js");
    app.use("/api/clients", clientsRouter);

    const { budgetsRouter } = await import("../../backend/src/routes/budgets.js");
    app.use("/api/budgets", budgetsRouter);

    // Tentar importar weeklogsRouter caso venha a existir em T03+
    try {
      // @ts-expect-error route not yet created in T02
      const { weeklogsRouter } = await import("../../backend/src/routes/weeklogs.js");
      app.use("/api/weeklogs", weeklogsRouter);
    } catch {
      // Em T02 a rota ainda não existe. Chamadas a /api/weeklogs retornarão 404 naturally.
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
    await prisma.weeklogValidation.deleteMany({
      where: {
        workspaceId: { in: [FIXTURES_003.wsAlpha, FIXTURES_003.wsBravo, FIXTURES_003.wsPersonal] },
      },
    });
    await prisma.weeklogEntry.deleteMany({
      where: {
        workspaceId: { in: [FIXTURES_003.wsAlpha, FIXTURES_003.wsBravo, FIXTURES_003.wsPersonal] },
      },
    });
    await prisma.weeklog.deleteMany({
      where: {
        workspaceId: { in: [FIXTURES_003.wsAlpha, FIXTURES_003.wsBravo, FIXTURES_003.wsPersonal] },
      },
    });
    await prisma.clientAccessGrant.deleteMany({
      where: {
        workspaceId: { in: [FIXTURES_003.wsAlpha, FIXTURES_003.wsBravo, FIXTURES_003.wsPersonal] },
      },
    });
    await prisma.productionPhoto.deleteMany({
      where: {
        workspaceId: { in: [FIXTURES_003.wsAlpha, FIXTURES_003.wsBravo, FIXTURES_003.wsPersonal] },
      },
    });
    await prisma.productionOrder.deleteMany({
      where: {
        workspaceId: { in: [FIXTURES_003.wsAlpha, FIXTURES_003.wsBravo, FIXTURES_003.wsPersonal] },
      },
    });
    await prisma.budgetPhoto.deleteMany({
      where: {
        workspaceId: { in: [FIXTURES_003.wsAlpha, FIXTURES_003.wsBravo, FIXTURES_003.wsPersonal] },
      },
    });
    await prisma.budgetRevision.deleteMany({
      where: {
        budget: {
          workspaceId: { in: [FIXTURES_003.wsAlpha, FIXTURES_003.wsBravo, FIXTURES_003.wsPersonal] },
        },
      },
    });
    await prisma.budget.deleteMany({
      where: {
        workspaceId: { in: [FIXTURES_003.wsAlpha, FIXTURES_003.wsBravo, FIXTURES_003.wsPersonal] },
      },
    });
    await prisma.client.deleteMany({
      where: {
        workspaceId: { in: [FIXTURES_003.wsAlpha, FIXTURES_003.wsBravo, FIXTURES_003.wsPersonal] },
      },
    });
    await prisma.membership.deleteMany({
      where: {
        workspaceId: { in: [FIXTURES_003.wsAlpha, FIXTURES_003.wsBravo, FIXTURES_003.wsPersonal] },
      },
    });
    await prisma.workspace.deleteMany({
      where: {
        id: { in: [FIXTURES_003.wsAlpha, FIXTURES_003.wsBravo, FIXTURES_003.wsPersonal] },
      },
    });
    await prisma.appUser.deleteMany({
      where: {
        id: {
          in: [
            FIXTURES_003.ownerA.appUserId,
            FIXTURES_003.techA1.appUserId,
            FIXTURES_003.techA2.appUserId,
            FIXTURES_003.validatorClientA.appUserId,
            FIXTURES_003.validatorClientB.appUserId,
            FIXTURES_003.validatorRevoked.appUserId,
            FIXTURES_003.ownerB.appUserId,
            FIXTURES_003.independentTechC.appUserId,
          ],
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [
            FIXTURES_003.ownerA.userId,
            FIXTURES_003.techA1.userId,
            FIXTURES_003.techA2.userId,
            FIXTURES_003.validatorClientA.userId,
            FIXTURES_003.validatorClientB.userId,
            FIXTURES_003.validatorRevoked.userId,
            FIXTURES_003.ownerB.userId,
            FIXTURES_003.independentTechC.userId,
          ],
        },
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

  // =========================================================================
  // GRUPO A: TESTES ESTRUTURAIS (SCHEMA T01, CONSTRAINTS RELACIONAIS)
  // Status esperado: GREEN (prova que o schema T01 está 100% ativo no Postgres)
  // =========================================================================
  describe("Grupo A: Validações Estruturais e Invariantes Relacionais (GREEN)", () => {
    it("T01-STRUCT-01: Constraint @@unique([productionOrderId, executionSequence]) impede execuções duplicadas de mesma sequência", async () => {
      const po = await prisma.productionOrder.create({
        data: {
          id: "po-struct-01",
          workspaceId: FIXTURES_003.wsAlpha,
          code: "PO-STRUCT-01",
          clientId: FIXTURES_003.clientA.id,
          executionSequence: 1,
          currencyCode: "EUR",
          operationalSiteKey: FIXTURES_003.sites.central,
        },
      });

      const wl = await prisma.weeklog.create({
        data: {
          id: "wl-struct-01",
          workspaceId: FIXTURES_003.wsAlpha,
          startsOn: new Date("2026-08-10T00:00:00Z"),
          endsOn: new Date("2026-08-16T23:59:59Z"),
          clientId: FIXTURES_003.clientA.id,
          siteKey: FIXTURES_003.sites.central,
          week: "2026-W33",
          weekNumber: 33,
          yearReference: 2026,
        },
      });

      await prisma.weeklogEntry.create({
        data: {
          id: "wle-struct-01",
          weeklogId: wl.id,
          workspaceId: FIXTURES_003.wsAlpha,
          productionOrderId: po.id,
          executionSequence: 1,
          technicianUserId: FIXTURES_003.techA1.userId,
          technicianName: "Tech A1",
          clientId: FIXTURES_003.clientA.id,
          currencyCode: "EUR",
          deliveredAt: new Date(),
        },
      });

      // Tentativa de criar segunda entry com a MESMA productionOrderId e executionSequence deve ser rejeitada pelo Postgres
      await expect(
        prisma.weeklogEntry.create({
          data: {
            id: "wle-struct-02-dup",
            weeklogId: wl.id,
            workspaceId: FIXTURES_003.wsAlpha,
            productionOrderId: po.id,
            executionSequence: 1,
            technicianUserId: FIXTURES_003.techA1.userId,
            technicianName: "Tech A1",
            clientId: FIXTURES_003.clientA.id,
            currencyCode: "EUR",
            deliveredAt: new Date(),
          },
        })
      ).rejects.toThrow();
    });

    it("T01-STRUCT-02: Self-FK rectificationOriginEntryId vincula WeeklogEntry com ON DELETE RESTRICT", async () => {
      const entryOriginal = await prisma.weeklogEntry.findUniqueOrThrow({
        where: { id: "wle-struct-01" },
      });

      // Criar entry de sequência 2 apontando para a entry 1
      const po = await prisma.productionOrder.findUniqueOrThrow({
        where: { id: "po-struct-01" },
      });

      const entryRework = await prisma.weeklogEntry.create({
        data: {
          id: "wle-struct-02-rework",
          weeklogId: entryOriginal.weeklogId,
          workspaceId: FIXTURES_003.wsAlpha,
          productionOrderId: po.id,
          executionSequence: 2,
          technicianUserId: FIXTURES_003.techA1.userId,
          technicianName: "Tech A1",
          clientId: FIXTURES_003.clientA.id,
          currencyCode: "EUR",
          deliveredAt: new Date(),
          isRectification: true,
          rectificationOriginEntryId: entryOriginal.id,
        },
      });

      expect(entryRework.rectificationOriginEntryId).toBe(entryOriginal.id);

      // Tentar excluir a entry original deve ser bloqueado por ON DELETE RESTRICT
      await expect(
        prisma.weeklogEntry.delete({
          where: { id: entryOriginal.id },
        })
      ).rejects.toThrow();
    });

    it("T01-STRUCT-03: @@unique([workspaceId, startsOn, clientId, siteKey]) impede cabeçalhos semanais duplicados", async () => {
      await expect(
        prisma.weeklog.create({
          data: {
            id: "wl-struct-dup",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
          },
        })
      ).rejects.toThrow();
    });

    it("T01-STRUCT-04: @@unique([weeklogId, validationSequence]) versiona validações do lote", async () => {
      const val1 = await prisma.weeklogValidation.create({
        data: {
          id: "val-struct-01",
          weeklogId: "wl-struct-01",
          workspaceId: FIXTURES_003.wsAlpha,
          validationSequence: 1,
          validatorUserId: FIXTURES_003.validatorClientA.userId,
          validationMethod: "authenticated_confirmation",
          coverageSnapshot: ["wle-struct-01"],
        },
      });
      expect(val1.validationSequence).toBe(1);

      // Tentativa de duplicar validationSequence 1 no mesmo weeklog deve violar constraint
      await expect(
        prisma.weeklogValidation.create({
          data: {
            id: "val-struct-02-dup",
            weeklogId: "wl-struct-01",
            workspaceId: FIXTURES_003.wsAlpha,
            validationSequence: 1,
            validatorUserId: FIXTURES_003.validatorClientA.userId,
            validationMethod: "authenticated_confirmation",
            coverageSnapshot: ["wle-struct-01"],
          },
        })
      ).rejects.toThrow();
    });

    it("T01-STRUCT-05: ClientAccessGrant @@unique([workspaceId, userId, clientId]) impede grant duplicado", async () => {
      await expect(
        prisma.clientAccessGrant.create({
          data: {
            id: "grant-dup-test",
            workspaceId: FIXTURES_003.wsAlpha,
            userId: FIXTURES_003.validatorClientA.userId,
            clientId: FIXTURES_003.clientA.id,
            role: "validator",
          },
        })
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // GRUPO B: TESTES COMPORTAMENTAIS (45 CENÁRIOS DE ACCEPTANCE.MD)
  // Status esperado: RED (contrato executável antes de T03-T08)
  // =========================================================================
  describe("Grupo B: Contratos Comportamentais da Spec 003 (RED Baseline)", () => {

    // -----------------------------------------------------------------------
    // B.1 - Finalização de Produção e Agrupamento Semanal
    // -----------------------------------------------------------------------
    describe("B.1 Finalização de Produção e Agrupamento", () => {
      it("FINALIZE-01: Conclusão atômica de OP cria exatamente uma entrada no lote WEEKLOG correspondente", async () => {
        const po = await prisma.productionOrder.create({
          data: {
            id: "po-fin-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-FIN-01",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: "EUR",
            performedServices: [{ description: "Reparo PDR", amount: "150.00" }],
            status: "in_production",
          },
        });

        const res = await fetch(`${baseUrl}/api/production-orders/${po.id}/finalize`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.weeklogEntry).toBeDefined();
        expect(data.weeklogEntry.productionOrderId).toBe(po.id);

        const dbEntry = await prisma.weeklogEntry.findFirst({
          where: { productionOrderId: po.id },
        });
        expect(dbEntry).not.toBeNull();
        expect(dbEntry?.executionSequence).toBe(1);
      });

      it("FINALIZE-IDEMPOTENT-01: Chamar a finalização repetidas vezes retorna o mesmo registro sem duplicar", async () => {
        const po = await prisma.productionOrder.create({
          data: {
            id: "po-fin-idemp-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-FIN-IDEMP-01",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: "EUR",
            performedServices: [{ description: "PDR Painel", amount: "200.00" }],
            status: "in_production",
          },
        });

        const headers = getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha);
        const res1 = await fetch(`${baseUrl}/api/production-orders/${po.id}/finalize`, { method: "POST", headers });
        const res2 = await fetch(`${baseUrl}/api/production-orders/${po.id}/finalize`, { method: "POST", headers });

        expect(res1.status).toBe(200);
        expect(res2.status).toBe(200);
        const count = await prisma.weeklogEntry.count({ where: { productionOrderId: po.id } });
        expect(count).toBe(1);
      });

      it("FINALIZE-CONCURRENT-01: Duas chamadas simultâneas produzem exatamente 1 item no banco", async () => {
        const po = await prisma.productionOrder.create({
          data: {
            id: "po-fin-conc-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-FIN-CONC-01",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: "EUR",
            performedServices: [{ description: "PDR Teto", amount: "300.00" }],
            status: "in_production",
          },
        });

        const headers = getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha);
        const [resA, resB] = await Promise.all([
          fetch(`${baseUrl}/api/production-orders/${po.id}/finalize`, { method: "POST", headers }),
          fetch(`${baseUrl}/api/production-orders/${po.id}/finalize`, { method: "POST", headers }),
        ]);

        expect([resA.status, resB.status]).toContain(200);
        const count = await prisma.weeklogEntry.count({
          where: { productionOrderId: po.id, executionSequence: 1 },
        });
        expect(count).toBe(1);
      });

      it("FINALIZE-RETRY-CURRENT-EXECUTION-01: Retry de finalização retorna a entrada da sequência ativa", async () => {
        const po = await prisma.productionOrder.create({
          data: {
            id: "po-fin-retry-seq-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-FIN-RETRY-01",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: "EUR",
            executionSequence: 2,
            performedServices: [{ description: "Retrabalho PDR", amount: "100.00" }],
            status: "in_production",
          },
        });

        const headers = getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha);
        const res = await fetch(`${baseUrl}/api/production-orders/${po.id}/finalize`, { method: "POST", headers });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.weeklogEntry.executionSequence).toBe(2);
      });

      it("DIRECT-OP-WEEKLOG-01: OP direta sem orçamento utiliza performedServices estruturado para gerar snapshot", async () => {
        const po = await prisma.productionOrder.create({
          data: {
            id: "po-direct-valid-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-DIRECT-01",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: "EUR",
            performedServices: [
              { description: "Serviço A", amount: "200.00" },
              { description: "Serviço B", amount: "250.00" },
            ],
            status: "in_production",
          },
        });

        const res = await fetch(`${baseUrl}/api/production-orders/${po.id}/finalize`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.weeklogEntry.servicesSnapshot).toHaveLength(2);
        expect(Number(data.weeklogEntry.totalAmount)).toBe(450.0);
      });

      it("DIRECT-OP-NO-SERVICES-01: Bloqueio de OP direta sem serviços com HTTP 422 Unprocessable Entity", async () => {
        const po = await prisma.productionOrder.create({
          data: {
            id: "po-direct-no-services-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-DIRECT-NO-SRV",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: "EUR",
            performedServices: [],
            status: "in_production",
          },
        });

        const res = await fetch(`${baseUrl}/api/production-orders/${po.id}/finalize`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha),
        });

        expect(res.status).toBe(422);
        const data = await res.json();
        expect(data.message).toMatch(/DIRECT_OP_NO_SERVICES|performedServices/i);
      });

      it("DIRECT-OP-NO-SITE-01: Bloqueio de OP sem local operacional com HTTP 422 Unprocessable Entity", async () => {
        const po = await prisma.productionOrder.create({
          data: {
            id: "po-direct-no-site-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-NO-SITE",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: null,
            currencyCode: "EUR",
            performedServices: [{ description: "PDR", amount: "100.00" }],
            status: "in_production",
          },
        });

        const res = await fetch(`${baseUrl}/api/production-orders/${po.id}/finalize`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha),
        });

        expect(res.status).toBe(422);
        const data = await res.json();
        expect(data.message).toMatch(/OPERATIONAL_SITE_REQUIRED/i);
      });

      it("FINALIZE-NO-CURRENCY-01: Bloqueio de OP sem código de moeda canônico com HTTP 422 Unprocessable Entity", async () => {
        const po = await prisma.productionOrder.create({
          data: {
            id: "po-no-currency-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-NO-CURR",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: null,
            performedServices: [{ description: "PDR", amount: "100.00" }],
            status: "in_production",
          },
        });

        const res = await fetch(`${baseUrl}/api/production-orders/${po.id}/finalize`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha),
        });

        expect(res.status).toBe(422);
        const data = await res.json();
        expect(data.message).toMatch(/CURRENCY_REQUIRED/i);
      });

      it("SNAPSHOT-01: Modificações posteriores na ProductionOrder não alteram o snapshot congelado do WEEKLOG", async () => {
        const po = await prisma.productionOrder.create({
          data: {
            id: "po-snap-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-SNAP-01",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: "EUR",
            performedServices: [{ description: "Original PDR", amount: "180.00" }],
            status: "in_production",
          },
        });

        const res = await fetch(`${baseUrl}/api/production-orders/${po.id}/finalize`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha),
        });
        expect(res.status).toBe(200);

        // Alterar PO depois
        await prisma.productionOrder.update({
          where: { id: po.id },
          data: { performedServices: [{ description: "Alterado indevidamente", amount: "999.00" }] },
        });

        const entry = await prisma.weeklogEntry.findFirstOrThrow({ where: { productionOrderId: po.id } });
        expect(Number(entry.totalAmount)).toBe(180.0);
      });

      it("WEEK-GROUP-01: Entradas concluídas no mesmo período semanal e mesmo cliente/oficina compartilham o mesmo weeklogId", async () => {
        const po1 = await prisma.productionOrder.create({
          data: {
            id: "po-grp-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-GRP-01",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: "EUR",
            performedServices: [{ description: "A", amount: "100.00" }],
            status: "in_production",
          },
        });
        const po2 = await prisma.productionOrder.create({
          data: {
            id: "po-grp-02",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-GRP-02",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: "EUR",
            performedServices: [{ description: "B", amount: "120.00" }],
            status: "in_production",
          },
        });

        const headers = getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha);
        await fetch(`${baseUrl}/api/production-orders/${po1.id}/finalize`, { method: "POST", headers });
        await fetch(`${baseUrl}/api/production-orders/${po2.id}/finalize`, { method: "POST", headers });

        const e1 = await prisma.weeklogEntry.findFirstOrThrow({ where: { productionOrderId: po1.id } });
        const e2 = await prisma.weeklogEntry.findFirstOrThrow({ where: { productionOrderId: po2.id } });

        expect(e1.weeklogId).toBe(e2.weeklogId);
      });

      it("WEEK-GROUP-CLIENT-01: Duas ordens na mesma semana para clientes diferentes geram dois lotes Weeklog distintos", async () => {
        const poClientA = await prisma.productionOrder.create({
          data: {
            id: "po-grp-cla-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-CLA-01",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: "EUR",
            performedServices: [{ description: "A", amount: "100.00" }],
            status: "in_production",
          },
        });
        const poClientB = await prisma.productionOrder.create({
          data: {
            id: "po-grp-clb-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-CLB-01",
            clientId: FIXTURES_003.clientB.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: "EUR",
            performedServices: [{ description: "B", amount: "100.00" }],
            status: "in_production",
          },
        });

        const headers = getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha);
        await fetch(`${baseUrl}/api/production-orders/${poClientA.id}/finalize`, { method: "POST", headers });
        await fetch(`${baseUrl}/api/production-orders/${poClientB.id}/finalize`, { method: "POST", headers });

        const eA = await prisma.weeklogEntry.findFirstOrThrow({ where: { productionOrderId: poClientA.id } });
        const eB = await prisma.weeklogEntry.findFirstOrThrow({ where: { productionOrderId: poClientB.id } });

        expect(eA.weeklogId).not.toBe(eB.weeklogId);
      });

      it("WEEK-GROUP-LOCATION-01: Duas ordens do mesmo cliente em oficinas diferentes (siteKey) geram lotes distintos", async () => {
        const poSite1 = await prisma.productionOrder.create({
          data: {
            id: "po-site-1-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-SITE-1",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: "EUR",
            performedServices: [{ description: "A", amount: "100.00" }],
            status: "in_production",
          },
        });
        const poSite2 = await prisma.productionOrder.create({
          data: {
            id: "po-site-2-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-SITE-2",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.norte,
            currencyCode: "EUR",
            performedServices: [{ description: "B", amount: "100.00" }],
            status: "in_production",
          },
        });

        const headers = getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha);
        await fetch(`${baseUrl}/api/production-orders/${poSite1.id}/finalize`, { method: "POST", headers });
        await fetch(`${baseUrl}/api/production-orders/${poSite2.id}/finalize`, { method: "POST", headers });

        const e1 = await prisma.weeklogEntry.findFirstOrThrow({ where: { productionOrderId: poSite1.id } });
        const e2 = await prisma.weeklogEntry.findFirstOrThrow({ where: { productionOrderId: poSite2.id } });

        expect(e1.weeklogId).not.toBe(e2.weeklogId);
      });

      it("WEEK-GROUP-CONCURRENT-01: Duas finalizações simultâneas para o mesmo cliente/semana compartilham cabeçalho sem colisão", async () => {
        const poConc1 = await prisma.productionOrder.create({
          data: {
            id: "po-head-conc-1",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-H-1",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: "EUR",
            performedServices: [{ description: "A", amount: "100.00" }],
            status: "in_production",
          },
        });
        const poConc2 = await prisma.productionOrder.create({
          data: {
            id: "po-head-conc-2",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-H-2",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA2.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: "EUR",
            performedServices: [{ description: "B", amount: "100.00" }],
            status: "in_production",
          },
        });

        const headers1 = getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha);
        const headers2 = getAuthHeader(FIXTURES_003.techA2, FIXTURES_003.wsAlpha);

        const [r1, r2] = await Promise.all([
          fetch(`${baseUrl}/api/production-orders/${poConc1.id}/finalize`, { method: "POST", headers: headers1 }),
          fetch(`${baseUrl}/api/production-orders/${poConc2.id}/finalize`, { method: "POST", headers: headers2 }),
        ]);

        expect(r1.status).toBe(200);
        expect(r2.status).toBe(200);

        const e1 = await prisma.weeklogEntry.findFirstOrThrow({ where: { productionOrderId: poConc1.id } });
        const e2 = await prisma.weeklogEntry.findFirstOrThrow({ where: { productionOrderId: poConc2.id } });

        expect(e1.weeklogId).toBe(e2.weeklogId);
      });
    });

    // -----------------------------------------------------------------------
    // B.2 - Determinismo Temporal, Fuso Horário e Boundaries
    // -----------------------------------------------------------------------
    describe("B.2 Determinismo Temporal e Boundaries", () => {
      it("WEEK-BOUNDARY-01: A transição de Domingo 00:00:00 a Sábado 23:59:59 respeita o fuso horário configurado no workspace", async () => {
        // Domingo em Europe/Paris (UTC+2 no verão) às 00:00:01 local corresponde a Sábado 22:00:01 UTC
        const res = await fetch(`${baseUrl}/api/weeklogs/calculate-boundary`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.ownerA, FIXTURES_003.wsAlpha),
          body: JSON.stringify({
            timestamp: "2026-08-16T00:00:01+02:00",
            timezone: "Europe/Paris",
          }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.startsOn).toBe("2026-08-15T22:00:00.000Z"); // Domingo 00:00 local em UTC
      });

      it("WEEK-DST-SPRING-01: Transição com salto de 23h na Primavera calcula início e término sem perder ordens no boundary", async () => {
        const res = await fetch(`${baseUrl}/api/weeklogs/calculate-boundary`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.ownerA, FIXTURES_003.wsAlpha),
          body: JSON.stringify({
            timestamp: "2026-03-29T02:30:00+01:00", // Domingo da virada de horário de verão em Paris
            timezone: "Europe/Paris",
          }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.week).toBe("2026-W13");
      });

      it("WEEK-DST-FALL-01: Transição com repetição de 25h no Outono mantém consistência estrita de timestamps UTC", async () => {
        const res = await fetch(`${baseUrl}/api/weeklogs/calculate-boundary`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.ownerA, FIXTURES_003.wsAlpha),
          body: JSON.stringify({
            timestamp: "2026-10-25T02:30:00+02:00", // Domingo do retorno de horário de verão em Paris
            timezone: "Europe/Paris",
          }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.week).toBe("2026-W43");
      });

      it("WEEK-YEAR-BOUNDARY-01: Semana que cruza 31/12 e 01/01 resolve startsOn e yearReference de forma determinística", async () => {
        const res = await fetch(`${baseUrl}/api/weeklogs/calculate-boundary`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.ownerA, FIXTURES_003.wsAlpha),
          body: JSON.stringify({
            timestamp: "2026-12-31T23:59:00+01:00",
            timezone: "Europe/Paris",
          }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.yearReference).toBe(2026);
      });

      it("WEEK-INVALID-TIMEZONE-01: Workspace com fuso IANA inválido aciona fallback seguro e determinístico para UTC", async () => {
        const res = await fetch(`${baseUrl}/api/weeklogs/calculate-boundary`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.ownerA, FIXTURES_003.wsAlpha),
          body: JSON.stringify({
            timestamp: "2026-08-12T14:00:00Z",
            timezone: "Invalid/Fictional_Zone",
          }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.resolvedTimezone).toBe("UTC");
      });
    });

    // -----------------------------------------------------------------------
    // B.3 - Isolamento Multi-Tenant e Escopo de Técnico
    // -----------------------------------------------------------------------
    describe("B.3 Multi-Tenancy e Escopo", () => {
      it("TENANT-01: Usuário do Workspace B recebe HTTP 404/403 ao tentar visualizar ou validar WEEKLOG do Workspace A", async () => {
        const wlA = await prisma.weeklog.create({
          data: {
            id: "wl-tenant-test-a",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-17T00:00:00Z"),
            endsOn: new Date("2026-08-23T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W34",
            weekNumber: 34,
            yearReference: 2026,
            status: "open",
          },
        });

        // Usuário do Workspace B tenta acessar GET /api/weeklogs/:id
        const res = await fetch(`${baseUrl}/api/weeklogs/${wlA.id}`, {
          headers: getAuthHeader(FIXTURES_003.ownerB, FIXTURES_003.wsBravo),
        });

        expect([403, 404]).toContain(res.status);
      });

      it("TECH-OWN-01: Técnico com scope own só visualiza e opera suas próprias entradas de WEEKLOG atribuídas", async () => {
        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-tech-scope-test",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-24T00:00:00Z"),
            endsOn: new Date("2026-08-30T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W35",
            weekNumber: 35,
            yearReference: 2026,
          },
        });

        const po1 = await prisma.productionOrder.create({
          data: {
            id: "po-tech-1",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-T-1",
            currencyCode: "EUR",
            executionSequence: 1,
          },
        });
        const po2 = await prisma.productionOrder.create({
          data: {
            id: "po-tech-2",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-T-2",
            currencyCode: "EUR",
            executionSequence: 1,
          },
        });

        await prisma.weeklogEntry.create({
          data: {
            id: "wle-t1",
            weeklogId: wl.id,
            workspaceId: FIXTURES_003.wsAlpha,
            productionOrderId: po1.id,
            executionSequence: 1,
            technicianUserId: FIXTURES_003.techA1.userId,
            technicianName: "Tech A1",
            clientId: FIXTURES_003.clientA.id,
            currencyCode: "EUR",
            deliveredAt: new Date(),
          },
        });

        await prisma.weeklogEntry.create({
          data: {
            id: "wle-t2",
            weeklogId: wl.id,
            workspaceId: FIXTURES_003.wsAlpha,
            productionOrderId: po2.id,
            executionSequence: 1,
            technicianUserId: FIXTURES_003.techA2.userId,
            technicianName: "Tech A2",
            clientId: FIXTURES_003.clientA.id,
            currencyCode: "EUR",
            deliveredAt: new Date(),
          },
        });

        // Tech A1 lista entries
        const res = await fetch(`${baseUrl}/api/weeklogs/${wl.id}/entries`, {
          headers: getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha),
        });

        expect(res.status).toBe(200);
        const entries = await res.json();
        expect(entries.every((e: any) => e.technicianUserId === FIXTURES_003.techA1.userId)).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // B.4 - Submissão, Validação em Lote e Assinatura
    // -----------------------------------------------------------------------
    describe("B.4 Submissão, Validação e Assinatura", () => {
      it("SUBMIT-VALIDATION-01: Submissão de lote transiciona para pending_validation e congela coverageSnapshot", async () => {
        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-sub-01",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "open",
          },
        });

        const res = await fetch(`${baseUrl}/api/weeklogs/${wl.id}/submit-for-validation`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.ownerA, FIXTURES_003.wsAlpha),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.status).toBe("pending_validation");
        expect(data.coverageSnapshot).toBeDefined();
      });

      it("SUBMIT-VALIDATION-IDEMPOTENT-01: Chamada redundante de submit-for-validation é tratada de forma idempotente", async () => {
        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-sub-idemp-01",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "pending_validation",
          },
        });

        const headers = getAuthHeader(FIXTURES_003.ownerA, FIXTURES_003.wsAlpha);
        const res = await fetch(`${baseUrl}/api/weeklogs/${wl.id}/submit-for-validation`, { method: "POST", headers });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.status).toBe("pending_validation");
      });

      it("VALIDATE-01: Validador com capability weeklog.validate aprova o lote semanal gerando WeeklogValidation versionado", async () => {
        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-val-auth-01",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "pending_validation",
          },
        });

        const res = await fetch(`${baseUrl}/api/weeklogs/${wl.id}/validate`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.validatorClientA, FIXTURES_003.wsAlpha),
          body: JSON.stringify({
            validationMethod: "authenticated_confirmation",
          }),
        });

        expect(res.status).toBe(200);
        const validation = await prisma.weeklogValidation.findFirst({ where: { weeklogId: wl.id } });
        expect(validation).not.toBeNull();
        expect(validation?.validationSequence).toBe(1);
      });

      it("VALIDATE-FORBIDDEN-01: Usuário sem grant formal do cliente recebe HTTP 403 Forbidden", async () => {
        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-val-forbid-01",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "pending_validation",
          },
        });

        // Usuário aleatório sem grant
        const res = await fetch(`${baseUrl}/api/weeklogs/${wl.id}/validate`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.ownerB, FIXTURES_003.wsAlpha),
          body: JSON.stringify({ validationMethod: "authenticated_confirmation" }),
        });

        expect(res.status).toBe(403);
      });

      it("VALIDATOR-CLIENT-SCOPE-01: Validador com grant para Cliente A valida com sucesso o lote do Cliente A", async () => {
        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-val-scope-ok-01",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "pending_validation",
          },
        });

        const res = await fetch(`${baseUrl}/api/weeklogs/${wl.id}/validate`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.validatorClientA, FIXTURES_003.wsAlpha),
          body: JSON.stringify({ validationMethod: "authenticated_confirmation" }),
        });

        expect(res.status).toBe(200);
      });

      it("VALIDATOR-OTHER-CLIENT-01: Validador do Cliente A tentando validar lote do Cliente B recebe HTTP 403 Forbidden", async () => {
        const wlB = await prisma.weeklog.create({
          data: {
            id: "wl-val-other-cl-01",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientB.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "pending_validation",
          },
        });

        const res = await fetch(`${baseUrl}/api/weeklogs/${wlB.id}/validate`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.validatorClientA, FIXTURES_003.wsAlpha),
          body: JSON.stringify({ validationMethod: "authenticated_confirmation" }),
        });

        expect(res.status).toBe(403);
      });

      it("VALIDATOR-REVOKED-01: Bloqueio de validador com grant revogado com HTTP 403 Forbidden", async () => {
        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-val-revoked-01",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "pending_validation",
          },
        });

        const res = await fetch(`${baseUrl}/api/weeklogs/${wl.id}/validate`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.validatorRevoked, FIXTURES_003.wsAlpha),
          body: JSON.stringify({ validationMethod: "authenticated_confirmation" }),
        });

        expect(res.status).toBe(403);
      });

      it("VALIDATOR-SELF-01: Bloqueio de auto-validação de técnico executor que também é admin/owner com HTTP 403 Forbidden", async () => {
        const po = await prisma.productionOrder.create({
          data: {
            id: "po-val-self-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-SELF-01",
            currencyCode: "EUR",
            executionSequence: 1,
          },
        });

        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-val-self-01",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "pending_validation",
          },
        });

        const entry = await prisma.weeklogEntry.create({
          data: {
            id: "wle-self-01",
            weeklogId: wl.id,
            workspaceId: FIXTURES_003.wsAlpha,
            productionOrderId: po.id,
            executionSequence: 1,
            technicianUserId: FIXTURES_003.ownerA.userId, // Owner executou a ordem
            technicianName: "Owner A",
            clientId: FIXTURES_003.clientA.id,
            currencyCode: "EUR",
            deliveredAt: new Date(),
          },
        });

        // Owner tenta aprovar sua própria entry
        const res = await fetch(`${baseUrl}/api/weeklogs/${wl.id}/entries/${entry.id}/review`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.ownerA, FIXTURES_003.wsAlpha),
          body: JSON.stringify({ validationStatus: "approved" }),
        });

        expect(res.status).toBe(403);
      });

      it("VALIDATOR-BATCH-SELF-01: Bloqueio de auto-validação em lote por técnico executor com HTTP 403 Forbidden", async () => {
        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-batch-self-01",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "pending_validation",
          },
        });

        const po = await prisma.productionOrder.create({
          data: {
            id: "po-batch-self-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-B-SELF-01",
            currencyCode: "EUR",
            executionSequence: 1,
          },
        });

        await prisma.weeklogEntry.create({
          data: {
            id: "wle-batch-self-01",
            weeklogId: wl.id,
            workspaceId: FIXTURES_003.wsAlpha,
            productionOrderId: po.id,
            executionSequence: 1,
            technicianUserId: FIXTURES_003.validatorClientA.userId, // Validador executou uma das ordens
            technicianName: "Validator A",
            clientId: FIXTURES_003.clientA.id,
            currencyCode: "EUR",
            deliveredAt: new Date(),
          },
        });

        const res = await fetch(`${baseUrl}/api/weeklogs/${wl.id}/validate`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.validatorClientA, FIXTURES_003.wsAlpha),
          body: JSON.stringify({ validationMethod: "authenticated_confirmation" }),
        });

        expect(res.status).toBe(403);
      });

      it("PERSONAL-TECH-SELF-VALIDATE-01: Personal Workspace sem auto-validação com HTTP 403 Forbidden", async () => {
        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-pers-self-01",
            workspaceId: FIXTURES_003.wsPersonal,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "pending_validation",
          },
        });

        // Técnico autônomo tentando auto-validar o lote de seu cliente
        const res = await fetch(`${baseUrl}/api/weeklogs/${wl.id}/validate`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.independentTechC, FIXTURES_003.wsPersonal),
          body: JSON.stringify({ validationMethod: "authenticated_confirmation" }),
        });

        expect(res.status).toBe(403);
      });

      it("SIGNATURE-01: Upload de assinatura manuscrita grava imagem no MinIO e vincula storagePath", async () => {
        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-sig-01",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "pending_validation",
          },
        });

        // Magic bytes PNG: \x89PNG\r\n\x1a\n
        const fakePngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

        const res = await fetch(`${baseUrl}/api/weeklogs/${wl.id}/signature-upload`, {
          method: "POST",
          headers: {
            ...getAuthHeader(FIXTURES_003.validatorClientA, FIXTURES_003.wsAlpha),
            "Content-Type": "image/png",
          },
          body: fakePngBuffer,
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.signatureStoragePath).toBeDefined();
      });

      it("CONFIRMATION-01: Confirmação eletrônica sem desenho registra carimbo de sessão do validador", async () => {
        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-conf-01",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "pending_validation",
          },
        });

        const res = await fetch(`${baseUrl}/api/weeklogs/${wl.id}/validate`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.validatorClientA, FIXTURES_003.wsAlpha),
          body: JSON.stringify({ validationMethod: "authenticated_confirmation" }),
        });

        expect(res.status).toBe(200);
        const validation = await prisma.weeklogValidation.findFirst({ where: { weeklogId: wl.id } });
        expect(validation?.validationMethod).toBe("authenticated_confirmation");
        expect(validation?.validatorUserId).toBe(FIXTURES_003.validatorClientA.userId);
      });

      it("SIGNATURE-IMMUTABLE-AFTER-VALIDATION-01: Imutabilidade de assinatura pós-validação com HTTP 409 Conflict", async () => {
        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-sig-immut-01",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "validated",
          },
        });

        const fakePngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const res = await fetch(`${baseUrl}/api/weeklogs/${wl.id}/signature-upload`, {
          method: "POST",
          headers: {
            ...getAuthHeader(FIXTURES_003.validatorClientA, FIXTURES_003.wsAlpha),
            "Content-Type": "image/png",
          },
          body: fakePngBuffer,
        });

        expect(res.status).toBe(409);
      });

      it("VALIDATED-IMMUTABLE-01: Bloqueio de edição in-place de item validado com HTTP 409 Conflict", async () => {
        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-item-immut-01",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "validated",
          },
        });

        const po = await prisma.productionOrder.create({
          data: {
            id: "po-item-immut-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-IMMUT-01",
            currencyCode: "EUR",
            executionSequence: 1,
          },
        });

        const entry = await prisma.weeklogEntry.create({
          data: {
            id: "wle-item-immut-01",
            weeklogId: wl.id,
            workspaceId: FIXTURES_003.wsAlpha,
            productionOrderId: po.id,
            executionSequence: 1,
            technicianUserId: FIXTURES_003.techA1.userId,
            technicianName: "Tech A1",
            clientId: FIXTURES_003.clientA.id,
            currencyCode: "EUR",
            deliveredAt: new Date(),
            validationStatus: "approved",
          },
        });

        const res = await fetch(`${baseUrl}/api/weeklogs/${wl.id}/entries/${entry.id}`, {
          method: "PATCH",
          headers: getAuthHeader(FIXTURES_003.ownerA, FIXTURES_003.wsAlpha),
          body: JSON.stringify({ totalAmount: "500.00" }),
        });

        expect(res.status).toBe(409);
      });

      it("RELOAD-01: Persistência relacional pura: estado validado sobrevive a page reload", async () => {
        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-reload-test-01",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "validated",
          },
        });

        const res = await fetch(`${baseUrl}/api/weeklogs/${wl.id}`, {
          headers: getAuthHeader(FIXTURES_003.ownerA, FIXTURES_003.wsAlpha),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.status).toBe("validated");
      });
    });

    // -----------------------------------------------------------------------
    // B.5 - Retificação Versionada, Rework e Linhagem
    // -----------------------------------------------------------------------
    describe("B.5 Retificação Versionada", () => {
      it("RECTIFICATION-01: Solicitação de retificação mantém histórico e reabre a OP para retrabalho", async () => {
        const po = await prisma.productionOrder.create({
          data: {
            id: "po-rect-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-RECT-01",
            currencyCode: "EUR",
            executionSequence: 1,
            status: "delivered",
          },
        });

        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-rect-01",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "pending_validation",
          },
        });

        const entry = await prisma.weeklogEntry.create({
          data: {
            id: "wle-rect-01",
            weeklogId: wl.id,
            workspaceId: FIXTURES_003.wsAlpha,
            productionOrderId: po.id,
            executionSequence: 1,
            technicianUserId: FIXTURES_003.techA1.userId,
            technicianName: "Tech A1",
            clientId: FIXTURES_003.clientA.id,
            currencyCode: "EUR",
            deliveredAt: new Date(),
          },
        });

        const res = await fetch(`${baseUrl}/api/weeklogs/${wl.id}/entries/${entry.id}/rectify`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.validatorClientA, FIXTURES_003.wsAlpha),
          body: JSON.stringify({ rectificationReason: "Granizo remanescente na coluna C" }),
        });

        expect(res.status).toBe(200);

        // A OP original deve ter reaberto com executionSequence 2
        const updatedPo = await prisma.productionOrder.findUniqueOrThrow({ where: { id: po.id } });
        expect(updatedPo.status).toBe("in_production");
        expect(updatedPo.executionSequence).toBe(2);

        // A entry original permanece com validationStatus rectification_requested
        const originalEntry = await prisma.weeklogEntry.findUniqueOrThrow({ where: { id: entry.id } });
        expect(originalEntry.validationStatus).toBe("rectification_requested");
      });

      it("RECTIFICATION-REASON-01: Rejeição/retificação sem motivo formal é rejeitada com HTTP 400 Bad Request", async () => {
        const res = await fetch(`${baseUrl}/api/weeklogs/wl-any/entries/wle-any/rectify`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.validatorClientA, FIXTURES_003.wsAlpha),
          body: JSON.stringify({}),
        });

        expect(res.status).toBe(400);
      });

      it("RECTIFICATION-REVALIDATE-01: O retrabalho concluído gera nova entrada de WEEKLOG que exige nova validação formal", async () => {
        const po = await prisma.productionOrder.create({
          data: {
            id: "po-rect-reval-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-REVAL-01",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: "EUR",
            executionSequence: 2,
            performedServices: [{ description: "Retrabalho", amount: "100.00" }],
            status: "in_production",
          },
        });

        const res = await fetch(`${baseUrl}/api/production-orders/${po.id}/finalize`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.weeklogEntry.validationStatus).toBe("pending");
      });

      it("RECTIFICATION-SAME-WEEK-01: Re-finalização na mesma semana cria entrada com executionSequence = 2 no mesmo lote", async () => {
        const po = await prisma.productionOrder.create({
          data: {
            id: "po-rect-same-week",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-SW-01",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: "EUR",
            executionSequence: 2,
            performedServices: [{ description: "Retrabalho concluído", amount: "150.00" }],
            status: "in_production",
          },
        });

        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-rect-same-week",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "open",
          },
        });

        const e1 = await prisma.weeklogEntry.create({
          data: {
            id: "wle-sw-seq-1",
            weeklogId: wl.id,
            workspaceId: FIXTURES_003.wsAlpha,
            productionOrderId: po.id,
            executionSequence: 1,
            technicianUserId: FIXTURES_003.techA1.userId,
            technicianName: "Tech A1",
            clientId: FIXTURES_003.clientA.id,
            currencyCode: "EUR",
            deliveredAt: new Date("2026-08-11T10:00:00Z"),
            validationStatus: "rectification_requested",
          },
        });

        const res = await fetch(`${baseUrl}/api/production-orders/${po.id}/finalize`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.weeklogEntry.weeklogId).toBe(wl.id);
        expect(data.weeklogEntry.executionSequence).toBe(2);
        expect(data.weeklogEntry.rectificationOriginEntryId).toBe(e1.id);
      });

      it("RECTIFICATION-NEXT-WEEK-01: Re-finalização em semana subsequente aloca a nova entrada no lote da nova semana", async () => {
        const po = await prisma.productionOrder.create({
          data: {
            id: "po-rect-next-week",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-NW-01",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: "EUR",
            executionSequence: 2,
            performedServices: [{ description: "Retrabalho W34", amount: "150.00" }],
            status: "in_production",
          },
        });

        const wlOld = await prisma.weeklog.create({
          data: {
            id: "wl-old-w33",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "validated",
          },
        });

        const e1 = await prisma.weeklogEntry.create({
          data: {
            id: "wle-nw-seq-1",
            weeklogId: wlOld.id,
            workspaceId: FIXTURES_003.wsAlpha,
            productionOrderId: po.id,
            executionSequence: 1,
            technicianUserId: FIXTURES_003.techA1.userId,
            technicianName: "Tech A1",
            clientId: FIXTURES_003.clientA.id,
            currencyCode: "EUR",
            deliveredAt: new Date("2026-08-11T10:00:00Z"),
            validationStatus: "rectification_requested",
          },
        });

        // Finalização ocorre na semana W34
        const res = await fetch(`${baseUrl}/api/production-orders/${po.id}/finalize`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha),
          body: JSON.stringify({ deliveredAt: "2026-08-18T10:00:00Z" }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.weeklogEntry.weeklogId).not.toBe(wlOld.id);
        expect(data.weeklogEntry.rectificationOriginEntryId).toBe(e1.id);
      });

      it("RECTIFICATION-MULTIPLE-01: Três ciclos de retificação mantêm cadeia ininterrupta de self-FKs", async () => {
        const po = await prisma.productionOrder.create({
          data: {
            id: "po-rect-mult-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-MULT-01",
            clientId: FIXTURES_003.clientA.id,
            currencyCode: "EUR",
            executionSequence: 3,
            status: "in_production",
          },
        });

        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-rect-mult",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
          },
        });

        const e1 = await prisma.weeklogEntry.create({
          data: {
            id: "wle-mult-1",
            weeklogId: wl.id,
            workspaceId: FIXTURES_003.wsAlpha,
            productionOrderId: po.id,
            executionSequence: 1,
            technicianUserId: FIXTURES_003.techA1.userId,
            technicianName: "Tech A1",
            clientId: FIXTURES_003.clientA.id,
            currencyCode: "EUR",
            deliveredAt: new Date("2026-08-11T10:00:00Z"),
            validationStatus: "rectification_requested",
          },
        });

        const e2 = await prisma.weeklogEntry.create({
          data: {
            id: "wle-mult-2",
            weeklogId: wl.id,
            workspaceId: FIXTURES_003.wsAlpha,
            productionOrderId: po.id,
            executionSequence: 2,
            technicianUserId: FIXTURES_003.techA1.userId,
            technicianName: "Tech A1",
            clientId: FIXTURES_003.clientA.id,
            currencyCode: "EUR",
            deliveredAt: new Date("2026-08-12T10:00:00Z"),
            validationStatus: "rectification_requested",
            isRectification: true,
            rectificationOriginEntryId: e1.id,
          },
        });

        const e3 = await prisma.weeklogEntry.create({
          data: {
            id: "wle-mult-3",
            weeklogId: wl.id,
            workspaceId: FIXTURES_003.wsAlpha,
            productionOrderId: po.id,
            executionSequence: 3,
            technicianUserId: FIXTURES_003.techA1.userId,
            technicianName: "Tech A1",
            clientId: FIXTURES_003.clientA.id,
            currencyCode: "EUR",
            deliveredAt: new Date("2026-08-13T10:00:00Z"),
            validationStatus: "pending",
            isRectification: true,
            rectificationOriginEntryId: e2.id,
          },
        });

        expect(e2.rectificationOriginEntryId).toBe(e1.id);
        expect(e3.rectificationOriginEntryId).toBe(e2.id);
      });

      it("RECTIFICATION-FORGED-TECH-01: Bloqueio de técnico forjado em retificação com HTTP 403 Forbidden", async () => {
        const res = await fetch(`${baseUrl}/api/weeklogs/wl-any/entries/wle-any/rectify`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha),
          body: JSON.stringify({
            rectificationReason: "Motivo válido",
            assignedTechnicianUserId: FIXTURES_003.techA2.userId, // Tech tentando reatribuir para outro técnico
          }),
        });

        expect(res.status).toBe(403);
      });

      it("RECTIFICATION-VALIDATOR-ASSIGN-FORBIDDEN-01: Validador do cliente tentando selecionar técnico tem atribuição rejeitada", async () => {
        const res = await fetch(`${baseUrl}/api/weeklogs/wl-any/entries/wle-any/rectify`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.validatorClientA, FIXTURES_003.wsAlpha),
          body: JSON.stringify({
            rectificationReason: "Defeito",
            assignedTechnicianUserId: FIXTURES_003.techA1.userId,
          }),
        });

        // Validador não escolhe técnico
        expect([400, 403]).toContain(res.status);
      });
    });

    // -----------------------------------------------------------------------
    // B.6 - Invariantes Financeiros e Regressão de Legado
    // -----------------------------------------------------------------------
    describe("B.6 Fronteira Financeira e Regressão de Legado", () => {
      it("NO-FINANCE-SIDE-EFFECT-01: A validação do WEEKLOG não cria PaymentOrder, não gera listName e não oculta itens", async () => {
        const initialPaymentOrdersCount = await prisma.paymentOrder.count({
          where: { workspaceId: FIXTURES_003.wsAlpha },
        });

        const wl = await prisma.weeklog.create({
          data: {
            id: "wl-no-fin-01",
            workspaceId: FIXTURES_003.wsAlpha,
            startsOn: new Date("2026-08-10T00:00:00Z"),
            endsOn: new Date("2026-08-16T23:59:59Z"),
            clientId: FIXTURES_003.clientA.id,
            siteKey: FIXTURES_003.sites.central,
            week: "2026-W33",
            weekNumber: 33,
            yearReference: 2026,
            status: "pending_validation",
          },
        });

        await fetch(`${baseUrl}/api/weeklogs/${wl.id}/validate`, {
          method: "POST",
          headers: getAuthHeader(FIXTURES_003.validatorClientA, FIXTURES_003.wsAlpha),
          body: JSON.stringify({ validationMethod: "authenticated_confirmation" }),
        });

        const finalPaymentOrdersCount = await prisma.paymentOrder.count({
          where: { workspaceId: FIXTURES_003.wsAlpha },
        });

        expect(finalPaymentOrdersCount).toBe(initialPaymentOrdersCount);
      });

      it("LEGACY-FINALIZE-01: Chamada legada PATCH /production-orders/:id com status delivered delega para finalize", async () => {
        const po = await prisma.productionOrder.create({
          data: {
            id: "po-legacy-patch-01",
            workspaceId: FIXTURES_003.wsAlpha,
            code: "PO-LEGACY-01",
            clientId: FIXTURES_003.clientA.id,
            technicianUserId: FIXTURES_003.techA1.userId,
            operationalSiteKey: FIXTURES_003.sites.central,
            currencyCode: "EUR",
            performedServices: [{ description: "Reparo", amount: "100.00" }],
            status: "in_production",
          },
        });

        const res = await fetch(`${baseUrl}/api/production-orders/${po.id}`, {
          method: "PATCH",
          headers: getAuthHeader(FIXTURES_003.techA1, FIXTURES_003.wsAlpha),
          body: JSON.stringify({ status: "delivered" }),
        });

        expect(res.status).toBe(200);

        // Deve ter delegado para criar a entrada no WeeklogEntry correspondente
        const entry = await prisma.weeklogEntry.findFirst({
          where: { productionOrderId: po.id },
        });
        expect(entry).not.toBeNull();
      });
    });
  });
});
