// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
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

describe("Spec 001 — Tenant Isolation & Object Authorization Suite (A/B Testing)", () => {
  describe("TENANT-01: Acesso ao próprio Workspace autorizado", () => {
    it("deve resolver activeWorkspaceId quando o usuário for membro ou dono do workspace", async () => {
      vi.spyOn(prisma.membership, "findMany").mockResolvedValueOnce([
        { workspaceId: "workspace-alpha", role: "admin" } as any,
      ]);
      vi.spyOn(prisma.workspace, "findMany").mockResolvedValueOnce([]);

      const result = await resolveActiveWorkspace("user-1", "workspace-alpha");
      expect(result.activeWorkspaceId).toBe("workspace-alpha");
      expect(result.membershipRole).toBe("admin");
    });

    it("assertTenantAccess permite operação quando targetWorkspaceId coincide com activeWorkspaceId", () => {
      const ctx = {
        actorUserId: "user-1",
        platformRole: "user" as const,
        activeWorkspaceId: "workspace-alpha",
        membershipRole: "admin" as const,
        scope: "workspace" as const,
        capabilities: ["*"],
      };

      expect(() => assertTenantAccess(ctx, "workspace-alpha")).not.toThrow();
    });
  });

  describe("TENANT-02: Bloqueio de acesso a Workspace alheio", () => {
    it("resolveActiveWorkspace DEVE rejeitar quando o usuário solicitar workspace onde não tem membresia", async () => {
      vi.spyOn(prisma.membership, "findMany").mockResolvedValueOnce([
        { workspaceId: "workspace-alpha", role: "member" } as any,
      ]);
      vi.spyOn(prisma.workspace, "findMany").mockResolvedValueOnce([]);

      // Tenta forjar workspace-beta
      await expect(resolveActiveWorkspace("user-1", "workspace-beta")).rejects.toThrow(
        "Acesso negado ao workspace solicitado."
      );
    });

    it("assertTenantAccess deve lançar ForbiddenError quando tentar acessar outro workspace", () => {
      const ctx = {
        actorUserId: "user-1",
        platformRole: "user" as const,
        activeWorkspaceId: "workspace-alpha",
        membershipRole: "member" as const,
        scope: "workspace" as const,
        capabilities: ["*"],
      };

      expect(() => assertTenantAccess(ctx, "workspace-beta")).toThrowError(ForbiddenError);
    });
  });

  describe("TENANT-03: Tentativa de forjar workspaceId é ignorada ou bloqueada", () => {
    it("parâmetro forjado na query/body que não pertença ao usuário resulta em rejeição imediata", async () => {
      vi.spyOn(prisma.membership, "findMany").mockResolvedValueOnce([
        { workspaceId: "workspace-alpha", role: "admin" } as any,
      ]);
      vi.spyOn(prisma.workspace, "findMany").mockResolvedValueOnce([]);

      await expect(resolveActiveWorkspace("user-1", "forged-foreign-tenant-id")).rejects.toThrow(
        "Acesso negado ao workspace solicitado."
      );
    });

    it("quando nenhuma sugestão é enviada, o servidor define o workspace canônico do usuário com autoridade", async () => {
      vi.spyOn(prisma.membership, "findMany").mockResolvedValueOnce([
        { workspaceId: "workspace-alpha", role: "admin" } as any,
      ]);
      vi.spyOn(prisma.workspace, "findMany").mockResolvedValueOnce([]);

      const result = await resolveActiveWorkspace("user-1", undefined);
      expect(result.activeWorkspaceId).toBe("workspace-alpha");
    });
  });

  describe("OBJECT-01: Autorização de Objeto Deny-by-Default", () => {
    it("deve rejeitar objeto sem vínculo de tenant ou pertencente a outro tenant", () => {
      const ctx = {
        actorUserId: "user-1",
        platformRole: "user" as const,
        activeWorkspaceId: "workspace-alpha",
        membershipRole: "admin" as const,
        scope: "workspace" as const,
        capabilities: ["*"],
      };

      // Objeto sem workspaceId
      expect(() => assertObjectAccess(ctx, { id: "obj-1", workspaceId: null as any })).toThrow();

      // Objeto de outro tenant
      expect(() => assertObjectAccess(ctx, { id: "obj-2", workspaceId: "workspace-beta" })).toThrow();
    });

    it("técnico com escopo 'own' só pode acessar entidades onde seja o executor", () => {
      const ctx = {
        actorUserId: "user-tech-1",
        platformRole: "user" as const,
        activeWorkspaceId: "workspace-alpha",
        membershipRole: "technician" as const,
        technicianPersonId: "person-tech-1",
        scope: "workspace" as const,
        capabilities: ["*"],
      };

      // Recurso atribuído a ele mesmo: permitido
      expect(() =>
        assertObjectAccess(ctx, {
          id: "order-1",
          workspaceId: "workspace-alpha",
          technicianPersonId: "person-tech-1",
        })
      ).not.toThrow();

      // Recurso atribuído a outro técnico: negado
      expect(() =>
        assertObjectAccess(ctx, {
          id: "order-2",
          workspaceId: "workspace-alpha",
          technicianPersonId: "person-tech-2",
        })
      ).toThrow();
    });
  });

  describe("End-to-End Route Protection & Tenant Isolation via HTTP", () => {
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

      // Error handler
      app.use((err: any, _req: any, res: any, _next: any) => {
        const statusCode = err?.statusCode || 500;
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

    it("EXTRACT-01: deve retornar 401 para requisição anônima em /api/extract/production-order", async () => {
      const res = await fetch(`${baseUrl}/api/extract/production-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(401);
      server.close();
    });

    it("ROTAS FUNDACIONAIS: deve retornar 401 sem autenticação para /api/people e /api/locations", async () => {
      const resPeople = await fetch(`${baseUrl}/api/people`);
      expect(resPeople.status).toBe(401);

      const resLocations = await fetch(`${baseUrl}/api/locations`);
      expect(resLocations.status).toBe(401);

      server.close();
    });

    it("TENANT-02: tentativa de consultar Local ou Pessoa de outro workspace retorna 403 Forbidden", async () => {
      // Cria token válido para Usuário do Workspace A
      const token = signAccessToken({
        id: "user-alpha-id",
        email: "user@alpha.com",
        role: "admin",
      });

      // Mocka user e appUser
      vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
        id: "user-alpha-id",
        email: "user@alpha.com",
        role: "admin",
        isActive: true,
      } as any);

      vi.spyOn(prisma.appUser, "findUnique").mockResolvedValue({
        id: "app-user-alpha",
        workspaceId: "workspace-alpha",
      } as any);

      vi.spyOn(prisma.membership, "findMany").mockResolvedValue([
        { workspaceId: "workspace-alpha", role: "admin" } as any,
      ]);
      vi.spyOn(prisma.workspace, "findMany").mockResolvedValue([]);
      vi.spyOn(prisma.person, "findFirst").mockResolvedValue(null);

      // Mocka Location pertencente ao Workspace Beta
      vi.spyOn(prisma.location, "findUnique").mockResolvedValue({
        id: "loc-beta",
        workspaceId: "workspace-beta",
        name: "Filial Beta",
      } as any);

      // Request autenticada do usuário Alpha para local Beta
      const res = await fetch(`${baseUrl}/api/locations/loc-beta`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.message).toContain("outro workspace");

      server.close();
    });
  });
});
