import type { RequestContext } from "../middleware/requestContext.js";

export class ForbiddenError extends Error {
  readonly statusCode = 403;
  constructor(message = "Acesso negado.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message = "Recurso não encontrado.") {
    super(message);
    this.name = "NotFoundError";
  }
}

/**
 * Valida se o targetWorkspaceId corresponde ao workspace ativo resolvido no servidor.
 * Deny-by-default contra BOLA/IDOR horizontal (S5A-003).
 */
export function assertTenantAccess(
  ctx: RequestContext,
  targetWorkspaceId?: string | null
): void {
  if (!targetWorkspaceId) {
    throw new ForbiddenError("Acesso negado: objeto sem vínculo de workspace.");
  }

  // Se o usuário for platform_admin em rota de administração global, pode ter bypass controlado
  if (ctx.platformRole === "platform_admin" && !ctx.activeWorkspaceId) {
    return;
  }

  if (ctx.activeWorkspaceId !== targetWorkspaceId) {
    throw new ForbiddenError("Acesso negado: você não tem permissão para acessar recursos deste workspace.");
  }
}

/**
 * Valida autorização no nível de objeto para uma entidade específica.
 * Suporta restrição de escopo `own` para técnicos.
 */
export function assertObjectAccess<
  T extends {
    workspaceId?: string | null;
    assignedUserId?: string | null;
    technicianPersonId?: string | null;
  }
>(
  ctx: RequestContext,
  resource: T | null | undefined,
  requiredScope?: "own" | "all"
): void {
  if (!resource) {
    throw new NotFoundError("Recurso não encontrado.");
  }

  // 1. Validação de fronteira de tenant (deny-by-default)
  assertTenantAccess(ctx, resource.workspaceId);

  // 2. Validação de escopo restrito ("own") para técnico
  const mustEnforceOwn =
    requiredScope === "own" ||
    (ctx.membershipRole === "technician" && ctx.scope === "workspace");

  if (mustEnforceOwn) {
    const matchesUser = resource.assignedUserId && resource.assignedUserId === ctx.actorUserId;
    const matchesPerson =
      ctx.technicianPersonId &&
      resource.technicianPersonId &&
      resource.technicianPersonId === ctx.technicianPersonId;

    if (!matchesUser && !matchesPerson) {
      throw new ForbiddenError("Acesso negado: você só pode acessar os seus próprios registros operacionais.");
    }
  }
}
