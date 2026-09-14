import type { NextFunction, Response } from "express";
import type { AuthenticatedRequest } from "./auth.js";
import { prisma } from "../lib/prisma.js";
import { normalizeWorkspaceRole } from "../lib/membershipService.js";

export interface RequestContext {
  /** ID do usuário autenticado no JWT (User.id) */
  readonly actorUserId: string;

  /** Papel global da plataforma (platform_admin | user) */
  readonly platformRole: "platform_admin" | "user";

  /** Workspace ativo resolvido e validado no servidor */
  readonly activeWorkspaceId?: string;

  /** Papel do usuário dentro do workspace ativo */
  readonly membershipRole?: "owner" | "admin" | "technician" | "partner" | "client" | "member";

  /** ID do cadastro de Person correspondente ao técnico */
  readonly technicianPersonId?: string;

  /** Escopo de operação da requisição */
  readonly scope: "workspace" | "technician_personal";

  /** Capacidades avaliadas do usuário */
  readonly capabilities: ReadonlyArray<string>;
}

declare global {
  namespace Express {
    interface Request {
      ctx?: RequestContext;
    }
  }
}

/**
 * Função pura para resolução e validação do workspace ativo.
 * Ignora ou rejeita identificadores forjados pelo cliente que não correspondam
 * a uma membresia ativa comprovada no banco de dados.
 */
export async function resolveActiveWorkspace(
  appUserId: string,
  suggestedWorkspaceId?: string | null
): Promise<{
  activeWorkspaceId?: string;
  membershipRole?: "owner" | "admin" | "technician" | "partner" | "client" | "member";
}> {
  const [memberships, ownedWorkspaces] = await Promise.all([
    prisma.membership.findMany({
      where: { userId: appUserId, status: "active" },
      select: { workspaceId: true, role: true },
    }),
    prisma.workspace.findMany({
      where: { ownerUserId: appUserId },
      select: { id: true },
    }),
  ]);

  const ownedIds = new Set(ownedWorkspaces.map((w) => w.id));

  // Se o cliente sugeriu um workspace específico (via header, param ou query)
  if (suggestedWorkspaceId) {
    const isOwner = ownedIds.has(suggestedWorkspaceId);
    const membership = memberships.find((m) => m.workspaceId === suggestedWorkspaceId);

    if (isOwner) {
      return {
        activeWorkspaceId: suggestedWorkspaceId,
        membershipRole: "owner",
      };
    }

    if (membership) {
      return {
        activeWorkspaceId: suggestedWorkspaceId,
        membershipRole: (normalizeWorkspaceRole(membership.role) as any) ?? "member",
      };
    }

    // SUGERIU UM WORKSPACE NÃO AUTORIZADO: rejeita com erro!
    throw new Error("Acesso negado ao workspace solicitado.");
  }

  // Sem sugestão: seleciona o primeiro workspace onde o usuário é owner ou membro
  if (ownedWorkspaces.length > 0) {
    return {
      activeWorkspaceId: ownedWorkspaces[0].id,
      membershipRole: "owner",
    };
  }

  if (memberships.length > 0) {
    return {
      activeWorkspaceId: memberships[0].workspaceId,
      membershipRole: (normalizeWorkspaceRole(memberships[0].role) as any) ?? "member",
    };
  }

  return {};
}

/**
 * Middleware que materializa o RequestContext obrigatório no servidor.
 */
export async function resolveRequestContext(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.auth?.userId) {
    return res.status(401).json({ message: "Requer autenticação prévia." });
  }

  try {
    const [appUser, person] = await Promise.all([
      prisma.appUser.findUnique({
        where: { authUserId: req.auth.userId },
        select: { id: true, workspaceId: true },
      }),
      prisma.person.findFirst({
        where: { systemAccessUserId: req.auth.userId, deletedAt: null },
        select: { id: true, type: true },
      }),
    ]);

    if (!appUser) {
      return res.status(401).json({ message: "Registro de usuário da aplicação não localizado." });
    }

    // Coleta sugestão de workspace vinda do cliente
    const rawSuggested =
      (req.headers["x-workspace-id"] as string | undefined) ||
      (req.params as Record<string, string | undefined>)?.workspaceId ||
      (req.query as Record<string, string | undefined>)?.workspace_id ||
      appUser.workspaceId;

    let activeWorkspaceInfo: {
      activeWorkspaceId?: string;
      membershipRole?: "owner" | "admin" | "technician" | "partner" | "client" | "member";
    } = {};

    try {
      activeWorkspaceInfo = await resolveActiveWorkspace(appUser.id, rawSuggested);
    } catch {
      return res.status(403).json({ message: "Você não possui acesso ao workspace solicitado." });
    }

    const platformRole =
      req.auth.role === "platform_admin" ||
      req.auth.email.toLowerCase() === "qwork@qworkgroup.com"
        ? ("platform_admin" as const)
        : ("user" as const);

    const isTechnicianOnly = person?.type === "technician" && !activeWorkspaceInfo.activeWorkspaceId;

    const ctx: RequestContext = {
      actorUserId: req.auth.userId,
      platformRole,
      activeWorkspaceId: activeWorkspaceInfo.activeWorkspaceId,
      membershipRole: activeWorkspaceInfo.membershipRole,
      technicianPersonId: person?.id,
      scope: isTechnicianOnly ? "technician_personal" : "workspace",
      capabilities: ["*"],
    };

    req.ctx = ctx;
    return next();
  } catch (error) {
    return next(error);
  }
}
