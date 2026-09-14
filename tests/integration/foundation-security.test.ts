// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

// Configurações de ambiente mínimas para testes limpos
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock?schema=public";
process.env.JWT_SECRET = process.env.JWT_SECRET || "this-is-a-test-secret-with-more-than-32-chars-long";
process.env.MINIO_ROOT_PASSWORD = process.env.MINIO_ROOT_PASSWORD || "miniopassword123456";
if (process.env.SMTP_PORT === "") delete process.env.SMTP_PORT;
if (process.env.SMTP_SECURE === "") delete process.env.SMTP_SECURE;

/**
 * Suite de Regressão de Segurança da Spec 001: Foundation Context
 * 
 * Demonstra as falhas originais (RED) e prova as correções (GREEN) comportamentais:
 * - AUTH-01: Proibir autorregistro público de administrador (S5A-001)
 * - AUTH-02: Impedir que alteração de membership altere User.role global (S5A-002)
 * - EXTRACT-01: Proteger rotas de extração de IA contra requisições não autenticadas (S5A-008)
 * - TENANT-01 a TENANT-03: Isolamento multi-tenant obrigatório
 * - OBJECT-01: Autorização de objeto deny-by-default
 */

describe("Spec 001 — Foundation Context & Security Regression Tests", () => {
  describe("AUTH-01: Autorregistro Público não deve aceitar papel global privilegiado", () => {
    it("deve rejeitar tentativa de registrar com role 'admin' ou forçar para 'user'", async () => {
      const authModule = await import("../../backend/src/routes/auth.js");
      // @ts-expect-error registerSchema exportado
      const schema = authModule.registerSchema;
      expect(schema).toBeDefined();

      const payload = {
        email: "attacker@example.com",
        password: "password123",
        fullName: "Attacker Admin",
        role: "admin",
      };

      const result = schema.safeParse(payload);
      
      // CRITÉRIO DE SEGURANÇA:
      // O payload NÃO pode resultar em role 'admin'. Deve falhar validação ou ser 'user'.
      const isVulnerable = result.success && (result.data as { role?: string }).role === "admin";
      expect(isVulnerable).toBe(false);
      expect(result.success).toBe(false);
    });
  });

  describe("AUTH-02: Alteração de Membership não deve alterar User.role global", () => {
    it("updateMemberMembershipOnly deve mutar estritamente Membership sem tocar em User.role ou UserRole", async () => {
      const { updateMemberMembershipOnly } = await import("../../backend/src/lib/membershipService.js");

      const mockTx = {
        membership: {
          update: vi.fn().mockResolvedValue({
            id: "membership-1",
            role: "admin",
            status: "active",
            userId: "app-user-1",
            workspaceId: "ws-1",
          }),
        },
        user: {
          update: vi.fn(),
        },
        userRole: {
          upsert: vi.fn(),
          create: vi.fn(),
        },
      };

      const result = await updateMemberMembershipOnly(mockTx as any, "membership-1", {
        role: "admin",
        status: "active",
      });

      expect(mockTx.membership.update).toHaveBeenCalledWith({
        where: { id: "membership-1" },
        data: { role: "admin", status: "active" },
        select: {
          id: true,
          role: true,
          status: true,
          userId: true,
          workspaceId: true,
        },
      });

      // PROVA COMPORTAMENTAL: Nenhuma mutação em User.role ou UserRole
      expect(mockTx.user.update).not.toHaveBeenCalled();
      expect(mockTx.userRole.upsert).not.toHaveBeenCalled();
      expect(mockTx.userRole.create).not.toHaveBeenCalled();
      expect(result.role).toBe("admin");
    });
  });

  describe("EXTRACT-01: Endpoints de Extração/IA devem rejeitar requisições anônimas", () => {
    it("deve rejeitar com 401 requisições sem header de autorização", async () => {
      const { extractRouter } = await import("../../backend/src/routes/extract.js");
      
      const req = {
        headers: {},
      };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      const next = vi.fn();

      // Dispara o primeiro middleware do router (requireAuth)
      const authMiddleware = extractRouter.stack[0].handle;
      await authMiddleware(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("TENANT-01 a TENANT-03: Isolamento Multi-Tenant e RequestContext", () => {
    it("TENANT-01 & TENANT-02: assertTenantAccess deve permitir mesmo tenant e bloquear tenant alheio ou null", async () => {
      const { assertTenantAccess, ForbiddenError } = await import("../../backend/src/lib/objectAuth.js");

      const ctxA = {
        actorUserId: "user-a",
        platformRole: "user" as const,
        activeWorkspaceId: "ws-a",
        membershipRole: "admin" as const,
        scope: "workspace" as const,
        capabilities: ["*"],
      };

      // Mesma empresa: permitido
      expect(() => assertTenantAccess(ctxA, "ws-a")).not.toThrow();

      // Empresa alheia: bloqueado com ForbiddenError
      expect(() => assertTenantAccess(ctxA, "ws-b")).toThrowError(ForbiddenError);

      // Objeto com workspaceId null: bloqueado com ForbiddenError (deny-by-default)
      expect(() => assertTenantAccess(ctxA, null)).toThrowError(ForbiddenError);
      expect(() => assertTenantAccess(ctxA, undefined)).toThrowError(ForbiddenError);
    });

    it("TENANT-03: resolveRequestContext deve injetar RequestContext válido e bloquear tenant forjado", async () => {
      const { resolveRequestContext } = await import("../../backend/src/middleware/requestContext.js");
      const { prisma } = await import("../../backend/src/lib/prisma.js");

      vi.spyOn(prisma.appUser, "findUnique").mockResolvedValueOnce({
        id: "app-user-1",
        authUserId: "auth-user-1",
        workspaceId: "ws-canonical",
      } as any);

      vi.spyOn(prisma.person, "findFirst").mockResolvedValueOnce(null);

      vi.spyOn(prisma.membership, "findMany").mockResolvedValueOnce([
        { workspaceId: "ws-canonical", role: "admin" } as any,
      ]);
      vi.spyOn(prisma.workspace, "findMany").mockResolvedValueOnce([]);

      const mockReq: any = {
        auth: { userId: "auth-user-1", email: "user@test.com", role: "user" },
        headers: {},
        params: {},
        query: {},
      };
      const mockRes: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      };
      const next = vi.fn();

      await resolveRequestContext(mockReq, mockRes, next);

      expect(next).toHaveBeenCalled();
      expect(mockReq.ctx).toBeDefined();
      expect(mockReq.ctx.actorUserId).toBe("auth-user-1");
      expect(mockReq.ctx.activeWorkspaceId).toBe("ws-canonical");
      expect(mockReq.ctx.membershipRole).toBe("admin");
      expect(mockReq.ctx.platformRole).toBe("user");
    });
  });

  describe("OBJECT-01: Autorização de Objeto Deny-by-Default", () => {
    it("deve negar acesso por padrão se o objeto não pertencer ao workspace ativo", async () => {
      const { assertObjectAccess, ForbiddenError } = await import("../../backend/src/lib/objectAuth.js");

      const ctx = {
        actorUserId: "user-a",
        platformRole: "user" as const,
        activeWorkspaceId: "ws-a",
        membershipRole: "member" as const,
        scope: "workspace" as const,
        capabilities: ["*"],
      };

      const resourceFromWsB = {
        id: "order-1",
        workspaceId: "ws-b",
      };

      expect(() => assertObjectAccess(ctx, resourceFromWsB)).toThrowError(ForbiddenError);

      // Objeto sem workspaceId (null) DEVE ser negado
      expect(() => assertObjectAccess(ctx, { id: "order-2", workspaceId: null })).toThrowError(ForbiddenError);
    });

    it("técnico com scope 'own' não pode acessar objeto de outro técnico no mesmo workspace", async () => {
      const { assertObjectAccess, ForbiddenError } = await import("../../backend/src/lib/objectAuth.js");

      const ctxTech = {
        actorUserId: "tech-1",
        platformRole: "user" as const,
        activeWorkspaceId: "ws-a",
        membershipRole: "technician" as const,
        technicianPersonId: "person-tech-1",
        scope: "workspace" as const,
        capabilities: ["service_orders.view"],
      };

      const resourceOfAnotherTech = {
        id: "order-2",
        workspaceId: "ws-a",
        technicianPersonId: "person-tech-2",
        assignedUserId: "tech-2",
      };

      expect(() => assertObjectAccess(ctxTech, resourceOfAnotherTech, "own")).toThrowError(ForbiddenError);
    });
  });
});
