// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// @ts-expect-error backend dependency
import express from "../../backend/node_modules/express/index.js";
import { resolveActiveWorkspace } from "../../backend/src/middleware/requestContext.js";
import { assertTenantAccess, assertObjectAccess, ForbiddenError } from "../../backend/src/lib/objectAuth.js";
import { prisma } from "../../backend/src/lib/prisma.js";
import { signAccessToken } from "../../backend/src/lib/jwt.js";

// Configurações de ambiente mínimas para testes
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock?schema=public";
process.env.JWT_SECRET = process.env.JWT_SECRET || "this-is-a-test-secret-with-more-than-32-chars-long";
process.env.MINIO_ROOT_PASSWORD = process.env.MINIO_ROOT_PASSWORD || "miniopassword123456";
if (process.env.SMTP_PORT === "") delete process.env.SMTP_PORT;
if (process.env.SMTP_SECURE === "") delete process.env.SMTP_SECURE;

describe("Spec 001 — Tenant Isolation & Behavioral Security Suite", () => {
  let app: express.Express;
  let server: any;
  let baseUrl: string;

  beforeEach(async () => {
    app = express();
    app.use(express.json());

    const { peopleRouter } = await import("../../backend/src/routes/people.js");
    const { locationsRouter } = await import("../../backend/src/routes/locations.js");
    const { extractRouter } = await import("../../backend/src/routes/extract.js");

    app.use("/api/people", peopleRouter);
    app.use("/api/locations", locationsRouter);
    app.use("/api/extract", extractRouter);

    // Error handler tipado tratando statusCode
    app.use((err: any, _req: any, res: any, _next: any) => {
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
    vi.restoreAllMocks();
  });

  function generateAuthMocks(workspaceId = "workspace-alpha", role = "admin") {
    const token = signAccessToken({
      id: "user-alpha-id",
      email: "user@alpha.com",
      role: "user",
    });

    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      id: "user-alpha-id",
      email: "user@alpha.com",
      role: "user",
      isActive: true,
    } as any);

    vi.spyOn(prisma.appUser, "findUnique").mockResolvedValue({
      id: "app-user-alpha",
      workspaceId,
    } as any);

    vi.spyOn(prisma.membership, "findMany").mockResolvedValue([
      { workspaceId, role } as any,
    ]);
    vi.spyOn(prisma.workspace, "findMany").mockResolvedValue([]);
    vi.spyOn(prisma.person, "findFirst").mockResolvedValue(null);

    return token;
  }

  describe("A. Membership Role vs Global Role Decoupling", () => {
    it("criação de membro com papel local 'admin' persiste User.role = 'user' e Membership.role = 'admin'", async () => {
      const { workspaceRouter } = await import("../../backend/src/routes/workspaces.ts");
      const wsApp = express();
      wsApp.use(express.json());
      wsApp.use("/api/workspaces", workspaceRouter);
      wsApp.use((err: any, _req: any, res: any, _next: any) => {
        if (err?.name === "ZodError" || err?.issues) {
          return res.status(400).json({ message: "Payload inválido", issues: err.issues });
        }
        return res.status(err?.statusCode ?? 500).json({ message: err?.message ?? "Error" });
      });

      const testWsId = "a1111111-1111-4111-8111-111111111111";
      const testOwnerId = "b2222222-2222-4222-8222-222222222222";
      const testOwnerAppId = "c3333333-3333-4333-8333-333333333333";

      let createdUserData: any = null;
      let createdUserRoleData: any = null;
      let createdMembershipData: any = null;

      vi.spyOn(prisma.user, "findUnique").mockImplementation(async ({ where }: any) => {
        if (where.id === testOwnerId) {
          return { id: testOwnerId, email: "owner@test.com", role: "user", isActive: true } as any;
        }
        if (where.email === "newmember@test.com") {
          return null;
        }
        return null;
      });

      vi.spyOn(prisma.appUser, "findUnique").mockResolvedValue({
        id: testOwnerAppId,
        authUserId: testOwnerId,
      } as any);

      vi.spyOn(prisma.workspace, "findUnique").mockResolvedValue({
        id: testWsId,
        ownerUserId: testOwnerAppId,
      } as any);

      vi.spyOn(prisma.membership, "findFirst").mockResolvedValue({
        id: "mem-owner",
        workspaceId: testWsId,
        userId: testOwnerAppId,
        role: "owner",
        status: "active",
      } as any);

      vi.spyOn(prisma.profile, "count").mockResolvedValue(0);

      vi.spyOn(prisma, "$transaction").mockImplementation(async (txFn: any) => {
        const mockTx = {
          user: {
            create: vi.fn().mockImplementation(({ data }: any) => {
              createdUserData = data;
              return { id: "new-user-id", email: data.email, fullName: data.fullName, role: data.role };
            }),
          },
          appUser: {
            create: vi.fn().mockResolvedValue({ id: "new-app-user-id" }),
          },
          profile: {
            create: vi.fn().mockResolvedValue({ id: "new-user-id" }),
          },
          userRole: {
            create: vi.fn().mockImplementation(({ data }: any) => {
              createdUserRoleData = data;
              return { id: "ur-1", ...data };
            }),
          },
          membership: {
            create: vi.fn().mockImplementation(({ data }: any) => {
              createdMembershipData = data;
              return { id: "new-mem-id", ...data };
            }),
          },
        };
        return txFn(mockTx);
      });

      const token = signAccessToken({ id: testOwnerId, email: "owner@test.com", role: "user" });

      let wsServer: any;
      let wsBaseUrl: string;
      await new Promise<void>((resolve) => {
        wsServer = wsApp.listen(0, () => {
          const addr = wsServer.address();
          wsBaseUrl = `http://127.0.0.1:${typeof addr === "object" ? addr?.port : 0}`;
          resolve();
        });
      });

      const res = await fetch(`${wsBaseUrl}/api/workspaces/${testWsId}/members`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "newmember@test.com",
          fullName: "New Member Admin",
          role: "admin",
        }),
      });

      wsServer.close();

      expect(res.status).toBe(201);
      // PROVA: User.role e UserRole NUNCA recebem 'admin'
      expect(createdUserData.role).toBe("user");
      expect(createdUserRoleData.role).toBe("user");
      // PROVA: Membership local recebe 'admin'
      expect(createdMembershipData.role).toBe("admin");
    });
  });

  describe("B. Objeto Sem Tenant (workspaceId: null) deve ser NEGADO por padrão (403)", () => {
    it("tentativa de acessar Local com workspaceId null retorna 403 Forbidden", async () => {
      const token = generateAuthMocks("workspace-alpha");

      vi.spyOn(prisma.location, "findUnique").mockResolvedValue({
        id: "loc-orphan",
        workspaceId: null,
        name: "Local Órfão",
      } as any);

      const res = await fetch(`${baseUrl}/api/locations/loc-orphan`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.message).toContain("sem vínculo de workspace");
    });

    it("tentativa de acessar Pessoa com workspaceId null retorna 403 Forbidden", async () => {
      const token = generateAuthMocks("workspace-alpha");

      vi.spyOn(prisma.person, "findFirst").mockResolvedValue({
        id: "person-orphan",
        workspaceId: null,
        fullName: "Pessoa Órfã",
      } as any);

      const res = await fetch(`${baseUrl}/api/people/person-orphan`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.message).toContain("sem vínculo de workspace");
    });
  });

  describe("C. Forged POST Tenant é completamente ignorado pelo servidor", () => {
    it("POST /locations com workspace_id forjado no body grava estritamente com activeWorkspaceId do token", async () => {
      const token = generateAuthMocks("workspace-alpha");

      let createdData: any = null;
      vi.spyOn(prisma.location, "create").mockImplementation(async ({ data }: any) => {
        createdData = data;
        return {
          id: "loc-created",
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      });

      const res = await fetch(`${baseUrl}/api/locations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspace_id: "workspace-hacked-beta",
          name: "Nova Filial",
          address_street: "Rua A",
          address_city: "São Paulo",
          address_country: "Brasil",
          manager_name: "Gerente 1",
        }),
      });

      expect(res.status).toBe(201);
      // PROVA: O workspace_id forjado do body foi ignorado; gravou workspace-alpha
      expect(createdData.workspaceId).toBe("workspace-alpha");
    });

    it("POST /people com workspace_id forjado no body grava estritamente com activeWorkspaceId do token", async () => {
      const token = generateAuthMocks("workspace-alpha");

      let createdData: any = null;
      vi.spyOn(prisma.person, "create").mockImplementation(async ({ data }: any) => {
        createdData = data;
        return {
          id: "person-created",
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          identityDocuments: [],
        };
      });

      const res = await fetch(`${baseUrl}/api/people`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspace_id: "workspace-hacked-beta",
          type: "administrative",
          full_name: "Pessoa Teste",
          email: "pessoa@teste.com",
          id_documents: [{ document_type: "RG", document_number: "12345" }],
        }),
      });

      expect(res.status).toBe(201);
      // PROVA: O workspace_id forjado do body foi ignorado; gravou workspace-alpha
      expect(createdData.workspaceId).toBe("workspace-alpha");
    });
  });

  describe("D. Chamadas sem Workspace Ativo retornam 403 (Deny-by-Default)", () => {
    it("GET /locations sem activeWorkspaceId retorna 403 Forbidden", async () => {
      const token = signAccessToken({
        id: "user-noworkspace",
        email: "user@none.com",
        role: "user",
      });

      vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
        id: "user-noworkspace",
        email: "user@none.com",
        role: "user",
        isActive: true,
      } as any);

      vi.spyOn(prisma.appUser, "findUnique").mockResolvedValue({
        id: "app-user-none",
        workspaceId: null,
      } as any);

      vi.spyOn(prisma.membership, "findMany").mockResolvedValue([]);
      vi.spyOn(prisma.workspace, "findMany").mockResolvedValue([]);
      vi.spyOn(prisma.person, "findFirst").mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/api/locations`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.message).toContain("Workspace ativo obrigatório");
    });

    it("GET /people sem activeWorkspaceId retorna 403 Forbidden", async () => {
      const token = signAccessToken({
        id: "user-noworkspace",
        email: "user@none.com",
        role: "user",
      });

      vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
        id: "user-noworkspace",
        email: "user@none.com",
        role: "user",
        isActive: true,
      } as any);

      vi.spyOn(prisma.appUser, "findUnique").mockResolvedValue({
        id: "app-user-none",
        workspaceId: null,
      } as any);

      vi.spyOn(prisma.membership, "findMany").mockResolvedValue([]);
      vi.spyOn(prisma.workspace, "findMany").mockResolvedValue([]);
      vi.spyOn(prisma.person, "findFirst").mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/api/people`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.message).toContain("Workspace ativo obrigatório");
    });
  });

  describe("E. Relacionamento Cross-Tenant de Location é Bloqueado", () => {
    it("POST /people apontando para location_id de outro workspace falha com 400", async () => {
      const token = generateAuthMocks("workspace-alpha");

      // Mocka busca da Location: não encontra no workspace-alpha (pertence ao beta)
      vi.spyOn(prisma.location, "findFirst").mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/api/people`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "technician",
          full_name: "Técnico Cross Tenant",
          email: "tech@cross.com",
          id_documents: [{ document_type: "CPF", document_number: "999888777" }],
          location_id: "location-from-workspace-beta",
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.message).toContain("Local inválido ou pertencente a outro workspace");
    });
  });

  describe("F. Proteção de Rotas HTTP e Isolamento A/B", () => {
    it("EXTRACT-01: requisição anônima para /api/extract/production-order retorna 401", async () => {
      const res = await fetch(`${baseUrl}/api/extract/production-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(401);
    });

    it("TENANT-02: usuário do Workspace Alpha recebe 403 ao buscar Local do Workspace Beta", async () => {
      const token = generateAuthMocks("workspace-alpha");

      vi.spyOn(prisma.location, "findUnique").mockResolvedValue({
        id: "loc-beta",
        workspaceId: "workspace-beta",
        name: "Filial Beta",
      } as any);

      const res = await fetch(`${baseUrl}/api/locations/loc-beta`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.message).toContain("não tem permissão para acessar recursos deste workspace");
    });
  });
});
