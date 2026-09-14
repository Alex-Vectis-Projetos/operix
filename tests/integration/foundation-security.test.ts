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
 * Demonstra as falhas originais (RED) antes da implementação das correções:
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
      // No código vulnerável, result.success é true e result.data.role é 'admin'.
      const isVulnerable = result.success && (result.data as { role?: string }).role === "admin";
      expect(isVulnerable).toBe(false);
    });
  });

  describe("AUTH-02: Alteração de Membership não deve alterar User.role global", () => {
    it("deve existir rotina desacoplada de atualização de membro que não toca no User global", async () => {
      // Importa helper ou controller de membership
      const { updateMemberMembershipOnly } = await import("../../backend/src/lib/membershipService.js").catch(() => ({
        updateMemberMembershipOnly: null,
      }));

      // No código legado em workspaces.ts:604-616, a transação altera user.role e userRole global.
      // O teste exige uma rotina desacoplada onde User.role nunca é modificado.
      expect(updateMemberMembershipOnly).not.toBeNull();
    });
  });

  describe("EXTRACT-01: Endpoints de Extração/IA devem rejeitar requisições anônimas", () => {
    it("deve conter middleware de autenticação nas rotas de extração", async () => {
      const { extractRouter } = await import("../../backend/src/routes/extract.js");
      
      const stack = extractRouter.stack;
      const orderRoute = stack.find((layer: any) => layer.route?.path === "/production-order");
      
      expect(orderRoute).toBeDefined();
      
      // No código vulnerável, a rota tem 1 único handler e ZERO middlewares de autenticação
      const handlers = orderRoute.route.stack;
      // Para estar protegido, deve ter middleware de autenticação na pilha
      expect(handlers.length).toBeGreaterThan(1);
    });
  });

  describe("TENANT-01 a TENANT-03: Isolamento Multi-Tenant e RequestContext", () => {
    it("TENANT-01 & TENANT-02: assertTenantAccess deve permitir mesmo tenant e bloquear tenant alheio", async () => {
      const { assertTenantAccess } = await import("../../backend/src/lib/objectAuth.js").catch(() => ({
        assertTenantAccess: null,
      }));

      expect(assertTenantAccess).not.toBeNull();

      if (assertTenantAccess) {
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

        // Empresa alheia: bloqueado com erro
        expect(() => assertTenantAccess(ctxA, "ws-b")).toThrow();
      }
    });

    it("TENANT-03: resolveRequestContext deve validar o workspace ativo no servidor", async () => {
      const { resolveRequestContext } = await import("../../backend/src/middleware/requestContext.js").catch(() => ({
        resolveRequestContext: null,
      }));

      expect(resolveRequestContext).not.toBeNull();
    });
  });

  describe("OBJECT-01: Autorização de Objeto Deny-by-Default", () => {
    it("deve negar acesso por padrão se o objeto não pertencer ao workspace ativo", async () => {
      const { assertObjectAccess } = await import("../../backend/src/lib/objectAuth.js").catch(() => ({
        assertObjectAccess: null,
      }));

      expect(assertObjectAccess).not.toBeNull();

      if (assertObjectAccess) {
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

        expect(() => assertObjectAccess(ctx, resourceFromWsB)).toThrow();
      }
    });

    it("técnico com scope 'own' não pode acessar objeto de outro técnico no mesmo workspace", async () => {
      const { assertObjectAccess } = await import("../../backend/src/lib/objectAuth.js").catch(() => ({
        assertObjectAccess: null,
      }));

      expect(assertObjectAccess).not.toBeNull();

      if (assertObjectAccess) {
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

        expect(() => assertObjectAccess(ctxTech, resourceOfAnotherTech, "own")).toThrow();
      }
    });
  });
});
