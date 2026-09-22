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
 * Spec 004 — Commercial Confrontation & Dispute Governance Suite (T01/T02 Baseline)
 * 
 * Cobre os 10 cenários do Grupo 4 (Motor de Confronto Versionado, Tríade Veículo-Serviço-Valor,
 * Pareamento Único, Ambiguidade, Imutabilidade de Rerun e Decisão Humana),
 * além dos cenários de bloqueio de disputas e fronteira contábil:
 * 
 * - CONFRONT-NOT-EVALUATED-01
 * - CONFRONT-IDEMPOTENT-01
 * - CONFRONT-RERUN-HISTORY-01
 * - CONFRONT-RERUN-DECISION-IMMUTABLE-01
 * - CONFRONT-VEHICLE-01
 * - CONFRONT-SERVICE-01
 * - CONFRONT-VALUE-01
 * - CONFRONT-AMBIGUOUS-01
 * - CONFRONT-UNMATCHED-WEEKLOG-01
 * - CONFRONT-HUMAN-DECISION-01
 * - LIST-PENDING-BLOCKED-CONTEST-01
 * - LIST-PENDING-BLOCKED-RECTIFICATION-01
 * - LIST-RECTIFICATION-LINEAGE-01
 * - NO-FINANCE-SIDE-EFFECT-04
 */

const FIXTURES_004_CONFRONT = {
  wsAlpha: "40000000-0000-4000-8000-000000000050",
  wsBravo: "40000000-0000-4000-8000-000000000060",
  ownerA: {
    userId: "41000000-0000-4000-8000-000000000050",
    appUserId: "42000000-0000-4000-8000-000000000050",
    email: "owner.a.confront@example.com",
    role: "owner",
  },
  techA1: {
    userId: "41000000-0000-4000-8000-000000000051",
    appUserId: "42000000-0000-4000-8000-000000000051",
    email: "tech.a1.confront@example.com",
    role: "technician",
  },
  clientA: {
    id: "43000000-0000-4000-8000-000000000050",
    name: "Cliente Confronto Alpha",
  },
};

describe("Spec 004 — Commercial Confrontation & Disputes Suite (T01/T02 Baseline)", () => {
  let app: express.Express;
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    await cleanupTestData();

    for (const actor of [FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.techA1]) {
      await prisma.user.create({
        data: {
          id: actor.userId,
          email: actor.email,
          fullName: actor.email.split("@")[0],
          role: actor.role === "owner" ? "admin" : "user",
          passwordHash: "hash-spec004-confront-test",
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
        id: FIXTURES_004_CONFRONT.wsAlpha,
        name: "Workspace Alpha Confront 004",
        timezone: "Europe/Paris",
        ownerUserId: FIXTURES_004_CONFRONT.ownerA.appUserId,
        memberships: {
          create: [
            { id: "mem-004-conf-oa", userId: FIXTURES_004_CONFRONT.ownerA.appUserId, role: "owner", status: "active" },
            { id: "mem-004-conf-ta", userId: FIXTURES_004_CONFRONT.techA1.appUserId, role: "technician", status: "active" },
          ],
        },
      },
    });

    await prisma.client.create({
      data: {
        id: FIXTURES_004_CONFRONT.clientA.id,
        workspaceId: FIXTURES_004_CONFRONT.wsAlpha,
        name: FIXTURES_004_CONFRONT.clientA.name,
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

    // Rota existente de weeklogs
    const { weeklogsRouter } = await import("../../backend/src/routes/weeklogs.js");
    app.use("/api/weeklogs", weeklogsRouter);

    // Rota futura de payment-lists
    try {
      // @ts-expect-error route created in T07/T08
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

  async function cleanOperationalData() {
    await prisma.weeklogValidation.deleteMany({
      where: { workspaceId: FIXTURES_004_CONFRONT.wsAlpha },
    });
    await prisma.weeklogEntry.deleteMany({
      where: { workspaceId: FIXTURES_004_CONFRONT.wsAlpha },
    });
    await prisma.weeklog.deleteMany({
      where: { workspaceId: FIXTURES_004_CONFRONT.wsAlpha },
    });
    await prisma.productionOrder.deleteMany({
      where: { workspaceId: FIXTURES_004_CONFRONT.wsAlpha },
    });
  }

  async function cleanupTestData() {
    await cleanOperationalData();
    await prisma.client.deleteMany({
      where: { workspaceId: FIXTURES_004_CONFRONT.wsAlpha },
    });
    await prisma.membership.deleteMany({
      where: { workspaceId: FIXTURES_004_CONFRONT.wsAlpha },
    });
    await prisma.workspace.deleteMany({
      where: { id: FIXTURES_004_CONFRONT.wsAlpha },
    });
    await prisma.user.deleteMany({
      where: {
        id: { in: [FIXTURES_004_CONFRONT.ownerA.userId, FIXTURES_004_CONFRONT.techA1.userId] },
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

  describe("Grupo 4: Motor de Confronto Comercial Versionado & Resultados Desacoplados", () => {
    it("CONFRONT-NOT-EVALUATED-01: Estado Inicial Padrão de Confronto", async () => {
      // Given: PaymentList recém-criada antes da execução do confronto
      const listId = "44000000-0000-4000-8000-000000000051";

      // When: Consulta os resultados de confronto da lista
      const res = await fetch(`${baseUrl}/api/payment-lists/${listId}/confrontation`, {
        headers: getAuthHeader(FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.wsAlpha),
      });

      // Then: Status retornado deve ser 'not_evaluated' para todos os itens
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("not_evaluated");
      for (const item of data.items) {
        expect(item.confrontationStatus).toBe("not_evaluated");
      }
    });

    it("CONFRONT-IDEMPOTENT-01: Idempotência de Execução de Confronto sem Alterações", async () => {
      // Given: Lista com rodada 1 de confronto executada
      const listId = "44000000-0000-4000-8000-000000000052";
      const headers = getAuthHeader(FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.wsAlpha);

      // When: Re-executa o confronto sem nenhuma alteração nos dados
      const res1 = await fetch(`${baseUrl}/api/payment-lists/${listId}/confront`, { method: "POST", headers });
      const res2 = await fetch(`${baseUrl}/api/payment-lists/${listId}/confront`, {
        method: "POST",
        headers,
        body: JSON.stringify({ mode: "current" }),
      });

      // Then: Ambas retornam a rodada 1 com HTTP 200 sem criar nova rodada
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      const data2 = await res2.json();
      expect(data2.sequence).toBe(1);
      expect(data2.idempotent).toBe(true);
      expect(data2.mode).toBe("current");
    });

    it("CONFRONT-RERUN-HISTORY-01: Criação de Nova Rodada Versionada Preservando Histórico", async () => {
      // Given: Rodada 1 concluída sem decisões humanas e novos dados validados
      const listId = "44000000-0000-4000-8000-000000000053";

      // When: Solicita explicitamente uma nova rodada de confronto
      const res = await fetch(`${baseUrl}/api/payment-lists/${listId}/confront`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.wsAlpha),
        body: JSON.stringify({ mode: "new_round" }),
      });

      // Then: Cria rodada 2 (sequence = 2), rodada 1 passa para 'superseded' e histórico permanece gravado
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.sequence).toBe(2);
      expect(data.mode).toBe("new_round");
      expect(data.previousRunId).toBeDefined();
    });

    it("CONFRONT-RERUN-DECISION-IMMUTABLE-01: Bloqueio de Rerun quando Rodada Ativa Possui Decisões Humanas", async () => {
      // Given: PaymentList cuja rodada ativa possui decisão humana registrada
      const listId = "44000000-0000-4000-8000-000000000054";

      // When: Após mudança relevante, usuário tenta recomputação da rodada corrente
      const res = await fetch(`${baseUrl}/api/payment-lists/${listId}/confront`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.wsAlpha),
      });

      // Then: Bloqueio com HTTP 409 Conflict (CONFRONTATION_RERUN_HAS_DECISIONS)
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.code || data.message).toMatch(/CONFRONTATION_RERUN_HAS_DECISIONS|RERUN_HAS_DECISIONS/i);

      // And: Ação explícita cria uma rodada nova sem sobrescrever a rodada decidida.
      const explicitNewRound = await fetch(`${baseUrl}/api/payment-lists/${listId}/confront`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.wsAlpha),
        body: JSON.stringify({ mode: "new_round" }),
      });
      expect(explicitNewRound.status).toBe(200);
      const newRound = await explicitNewRound.json();
      expect(newRound.mode).toBe("new_round");
      expect(newRound.sequence).toBe(2);
      expect(newRound.previousRunId).toBeDefined();
    });

    it("CONFRONT-VEHICLE-01: Pareamento por Identificador Veicular com Pareamento Único", async () => {
      // Given: Entry com placa AA123BB e item da lista com AA-123-BB e mesmo VIN
      const listId = "44000000-0000-4000-8000-000000000055";

      // When: Motor de confronto é executado
      const res = await fetch(`${baseUrl}/api/payment-lists/${listId}/confront`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.wsAlpha),
      });

      // Then: Identifica match veicular exato e gera resultado com chave única por rodada
      expect(res.status).toBe(200);
      const data = await res.json();
      const match = data.results.find((r: any) => r.licensePlateClean === "AA123BB");
      expect(match).toBeDefined();
      expect(match.vehicleMatch).toBe(true);
    });

    it("CONFRONT-SERVICE-01: Detecção de Divergência de Serviços e Glosas", async () => {
      // Given: Entry com 3 serviços (€800) e lista reconhecendo apenas 1 serviço (€400)
      const listId = "44000000-0000-4000-8000-000000000056";

      // When: Confronto é executado
      const res = await fetch(`${baseUrl}/api/payment-lists/${listId}/confront`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.wsAlpha),
      });

      // Then: Resultado classificado como service_discrepancy com differenceAmount de 400.00 EUR
      expect(res.status).toBe(200);
      const data = await res.json();
      const discrepancy = data.results.find((r: any) => r.status === "service_discrepancy");
      expect(discrepancy).toBeDefined();
      expect(String(discrepancy.differenceAmount)).toBe("400.00");
    });

    it("CONFRONT-VALUE-01: Detecção de Diferença Monetária com Mesmos Serviços", async () => {
      // Given: Entry com serviço martelinho €500 e item da lista reconhecendo €420
      const listId = "44000000-0000-4000-8000-000000000057";

      // When: Confronto é executado
      const res = await fetch(`${baseUrl}/api/payment-lists/${listId}/confront`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.wsAlpha),
      });

      // Then: Resultado classificado como value_difference com differenceAmount de -80.00 EUR
      expect(res.status).toBe(200);
      const data = await res.json();
      const diff = data.results.find((r: any) => r.status === "value_difference");
      expect(diff).toBeDefined();
      expect(String(diff.differenceAmount)).toBe("-80.00");
    });

    it("CONFRONT-AMBIGUOUS-01: Veículo Declarado na Lista Ausente na Produção", async () => {
      // Given: Item de lista com placa ZZ999ZZ sem correspondente na produção
      const listId = "44000000-0000-4000-8000-000000000058";

      // When: Confronto é executado
      const res = await fetch(`${baseUrl}/api/payment-lists/${listId}/confront`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.wsAlpha),
      });

      // Then: Resultado com paymentListItemId preenchido, weeklogEntryId = null e status = 'vehicle_not_found'
      expect(res.status).toBe(200);
      const data = await res.json();
      const notFound = data.results.find((r: any) => r.status === "vehicle_not_found");
      expect(notFound).toBeDefined();
      expect(notFound.weeklogEntryId).toBeNull();
    });

    it("CONFRONT-UNMATCHED-WEEKLOG-01: Execução de WEEKLOG Ausente na Lista do Cliente", async () => {
      // Given: Entry de Weeklog executada para o cliente sem menção na lista
      const listId = "44000000-0000-4000-8000-000000000059";

      // When: Confronto é executado
      const res = await fetch(`${baseUrl}/api/payment-lists/${listId}/confront`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.wsAlpha),
      });

      // Then: Resultado com paymentListItemId = null, weeklogEntryId preenchido e status = 'unmatched_weeklog'
      expect(res.status).toBe(200);
      const data = await res.json();
      const unmatched = data.results.find((r: any) => r.status === "unmatched_weeklog");
      expect(unmatched).toBeDefined();
      expect(unmatched.paymentListItemId).toBeNull();
      expect(unmatched.weeklogEntryId).toBeDefined();
    });

    it("CONFRONT-HUMAN-DECISION-01: Registro Formal de Decisão Humana para Divergência", async () => {
      // Given: Divergência de valor na lista
      const listId = "44000000-0000-4000-8000-000000000060";
      const resultId = "45000000-0000-4000-8000-000000000060";

      // When: Gestor registra decisão accept_difference com nota formal
      const res = await fetch(`${baseUrl}/api/payment-lists/${listId}/confrontation/${resultId}/decision`, {
        method: "PATCH",
        headers: getAuthHeader(FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.wsAlpha),
        body: JSON.stringify({
          decision: "accept_difference",
          note: "Desconto comercial de frota aprovado",
        }),
      });

      // Then: Resultado atualizado com decidedBy, decidedAt e computado no recognizedTotal
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.decision).toBe("accept_difference");
      expect(data.decidedBy).toBe(FIXTURES_004_CONFRONT.ownerA.userId);
      expect(data.decidedAt).toBeDefined();
    });

    it("LIST-PENDING-BLOCKED-CONTEST-01: Bloqueio de Pending por Disputa Aberta (Contestação)", async () => {
      // Given: Lista com item sob decisão CONTEST em aberto
      const listId = "44000000-0000-4000-8000-000000000061";

      // When: Tentativa de avançar para 'pending'
      const res = await fetch(`${baseUrl}/api/payment-lists/${listId}/status`, {
        method: "PATCH",
        headers: getAuthHeader(FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.wsAlpha),
        body: JSON.stringify({ toStatus: "pending" }),
      });

      // Then: HTTP 409 Conflict (UNRESOLVED_DISPUTES_BLOCK_PENDING)
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.code || data.message).toMatch(/UNRESOLVED_DISPUTES_BLOCK_PENDING|DISPUTES_BLOCK_PENDING/i);
    });

    it("LIST-PENDING-BLOCKED-RECTIFICATION-01: Bloqueio de Pending por Retificação Pendente", async () => {
      // Given: Lista com item sob decisão REQUEST_RECTIFICATION em aberto
      const listId = "44000000-0000-4000-8000-000000000062";

      // When: Tentativa de avançar para 'pending'
      const res = await fetch(`${baseUrl}/api/payment-lists/${listId}/status`, {
        method: "PATCH",
        headers: getAuthHeader(FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.wsAlpha),
        body: JSON.stringify({ toStatus: "pending" }),
      });

      // Then: HTTP 409 Conflict (UNRESOLVED_DISPUTES_BLOCK_PENDING)
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.code || data.message).toMatch(/UNRESOLVED_DISPUTES_BLOCK_PENDING|DISPUTES_BLOCK_PENDING/i);
    });

    it("LIST-RECTIFICATION-LINEAGE-01: Retificação Comercial Reabrindo OP sem Entidade Sintética", async () => {
      // Given: Item glosado associado a WeeklogEntry originada de PO1
      const listId = "44000000-0000-4000-8000-000000000063";
      const resultId = "45000000-0000-4000-8000-000000000063";

      // When: Gestor registra request_rectification
      const res = await fetch(`${baseUrl}/api/payment-lists/${listId}/confrontation/${resultId}/decision`, {
        method: "PATCH",
        headers: getAuthHeader(FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.wsAlpha),
        body: JSON.stringify({
          decision: "request_rectification",
          reason: "Acabamento de pintura rejeitado na vistoria",
        }),
      });

      // Then: Invoca rectifyWeeklogEntry da Spec 003 e registra linhagem real sem entidade sintética
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.reopenedProductionOrderId).toBeDefined();
      expect(data.targetExecutionSequence).toBe(2);
      expect(data.rectificationId).toBeUndefined();
    });

    it("NO-FINANCE-SIDE-EFFECT-04: Ausência Estrita de Side-Effects Financeiros Automáticos", async () => {
      // Given: Contagens iniciais financeiras e de distribuição
      const initialFinancialCount = await prisma.financialRecord.count({
        where: { workspaceId: FIXTURES_004_CONFRONT.wsAlpha },
      });
      const initialDistributionCount = await prisma.serviceOrderDistribution.count();

      // When: Executa o ciclo canônico completo da Spec 004
      // 1. Criar Lista
      const createRes = await fetch(`${baseUrl}/api/payment-lists`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.wsAlpha),
        body: JSON.stringify({
          clientId: FIXTURES_004_CONFRONT.clientA.id,
          currencyCode: "EUR",
        }),
      });
      expect(createRes.status).toBe(201);
      const list = await createRes.json();

      // 2. Executar Confronto
      const confrontRes = await fetch(`${baseUrl}/api/payment-lists/${list.id}/confront`, {
        method: "POST",
        headers: getAuthHeader(FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.wsAlpha),
      });
      expect(confrontRes.status).toBe(200);

      // 3. Avançar para Pending
      const pendingRes = await fetch(`${baseUrl}/api/payment-lists/${list.id}/status`, {
        method: "PATCH",
        headers: getAuthHeader(FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.wsAlpha),
        body: JSON.stringify({ toStatus: "pending" }),
      });
      expect(pendingRes.status).toBe(200);

      // 4. Liquidar como Paid
      const paidRes = await fetch(`${baseUrl}/api/payment-lists/${list.id}/status`, {
        method: "PATCH",
        headers: getAuthHeader(FIXTURES_004_CONFRONT.ownerA, FIXTURES_004_CONFRONT.wsAlpha),
        body: JSON.stringify({ toStatus: "paid" }),
      });
      expect(paidRes.status).toBe(200);

      // Then: Provar ausência estrita de mutações em tabelas contábeis/financeiras
      const finalFinancialCount = await prisma.financialRecord.count({
        where: { workspaceId: FIXTURES_004_CONFRONT.wsAlpha },
      });
      const finalDistributionCount = await prisma.serviceOrderDistribution.count();

      expect(finalFinancialCount).toBe(initialFinancialCount);
      expect(finalDistributionCount).toBe(initialDistributionCount);
    });
  });
});
