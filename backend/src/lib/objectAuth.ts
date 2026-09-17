import type { RequestContext } from "../middleware/requestContext.js";
import { prisma } from "./prisma.js";

export class BadRequestError extends Error {
  readonly statusCode = 400;
  constructor(message = "Requisição inválida.") {
    super(message);
    this.name = "BadRequestError";
  }
}

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

export class ConflictError extends Error {
  readonly statusCode = 409;
  constructor(message = "Conflito de estado do recurso.") {
    super(message);
    this.name = "ConflictError";
  }
}

export class UnprocessableEntityError extends Error {
  readonly statusCode = 422;
  constructor(message = "Entidade improcessável.") {
    super(message);
    this.name = "UnprocessableEntityError";
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
    technicianUserId?: string | null;
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
    const matchesUser =
      (resource.assignedUserId && resource.assignedUserId === ctx.actorUserId) ||
      (resource.technicianUserId && resource.technicianUserId === ctx.actorUserId);
    const matchesPerson =
      ctx.technicianPersonId &&
      resource.technicianPersonId &&
      resource.technicianPersonId === ctx.technicianPersonId;

    if (!matchesUser && !matchesPerson) {
      throw new ForbiddenError("Acesso negado: você só pode acessar os seus próprios registros operacionais.");
    }
  }
}

/**
 * Validação e aplicação das regras de atribuição de técnico (TECH-ASSIGN-01 e TECH-ASSIGN-02).
 */
export async function validateTechnicianAssignment(
  ctx: RequestContext,
  targetTechnicianUserId?: string | null
): Promise<{ technicianUserId: string | null; technicianName: string | null }> {
  // Regra TECH-ASSIGN-01: Se o usuário logado for técnico no workspace
  if (ctx.membershipRole === "technician") {
    if (targetTechnicianUserId && targetTechnicianUserId !== ctx.actorUserId) {
      throw new ForbiddenError(
        "Técnicos só podem atribuir ordens de produção a si mesmos (TECH-ASSIGN-01)."
      );
    }
    // Auto-atribuição forçada para o próprio técnico
    const appUser = await prisma.appUser.findFirst({
      where: { authUserId: ctx.actorUserId },
      include: { user: { select: { fullName: true } } },
    });
    return {
      technicianUserId: ctx.actorUserId,
      technicianName: appUser?.name || appUser?.user?.fullName || null,
    };
  }

  // Se não foi informado técnico por admin/owner:
  if (!targetTechnicianUserId) {
    return { technicianUserId: null, technicianName: null };
  }

  // Se for owner/admin atribuindo a si mesmo:
  if (targetTechnicianUserId === ctx.actorUserId) {
    const appUser = await prisma.appUser.findFirst({
      where: { authUserId: ctx.actorUserId },
      include: { user: { select: { fullName: true } } },
    });
    return {
      technicianUserId: ctx.actorUserId,
      technicianName: appUser?.name || appUser?.user?.fullName || null,
    };
  }

  // Regra TECH-ASSIGN-02: Apenas owner ou admin podem atribuir outros técnicos membros do mesmo workspace
  if (
    ctx.membershipRole !== "owner" &&
    ctx.membershipRole !== "admin" &&
    ctx.platformRole !== "platform_admin"
  ) {
    throw new ForbiddenError("Apenas administradores ou proprietários podem atribuir técnicos.");
  }

  // Localiza o AppUser do técnico alvo
  const targetAppUser = await prisma.appUser.findFirst({
    where: {
      OR: [
        { authUserId: targetTechnicianUserId },
        { id: targetTechnicianUserId },
      ],
    },
    include: { user: { select: { fullName: true } } },
  });

  if (!targetAppUser) {
    throw new ForbiddenError("Técnico selecionado não é membro ativo do workspace.");
  }

  // Valida se o técnico alvo é membro ativo ou owner do workspace ativo
  const [membership, workspace] = await Promise.all([
    prisma.membership.findFirst({
      where: {
        workspaceId: ctx.activeWorkspaceId,
        userId: targetAppUser.id,
        status: "active",
      },
    }),
    prisma.workspace.findFirst({
      where: {
        id: ctx.activeWorkspaceId,
        ownerUserId: targetAppUser.id,
      },
    }),
  ]);

  if (!membership && !workspace) {
    throw new ForbiddenError("Técnico selecionado não é membro ativo do workspace.");
  }

  return {
    technicianUserId: targetAppUser.authUserId,
    technicianName: targetAppUser.name || targetAppUser.user?.fullName || null,
  };
}

