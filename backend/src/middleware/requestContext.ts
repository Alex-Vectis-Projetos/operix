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
 * Provisionamento idempotente de Personal Workspace conforme ADR-002.
 * Protegido contra concorrência pelo índice único parcial:
 * workspaces_owner_user_id_personal_key ON workspaces(owner_user_id) WHERE type = 'personal'.
 */
export async function provisionPersonalWorkspace(
  appUserId: string,
  userName?: string
): Promise<{ id: string }> {
  const existing = await prisma.workspace.findFirst({
    where: { ownerUserId: appUserId, type: "personal" },
    select: { id: true },
  });
  if (existing) {
    return existing;
  }

  const name = userName ? `Oficina Pessoal - ${userName}` : "Oficina Pessoal";
  try {
    return await prisma.workspace.create({
      data: {
        name,
        type: "personal",
        ownerUserId: appUserId,
        memberships: {
          create: {
            userId: appUserId,
            role: "owner",
            status: "active",
            source: "personal_workspace_provisioning",
          },
        },
      },
      select: { id: true },
    });
  } catch (error: any) {
    if (error?.code === "P2002") {
      const concurrent = await prisma.workspace.findFirst({
        where: { ownerUserId: appUserId, type: "personal" },
        select: { id: true },
      });
      if (concurrent) {
        return concurrent;
      }
    }
    throw error;
  }
}

/**
 * Função pura para resolução e validação do workspace ativo.
 * Ignora ou rejeita identificadores forjados pelo cliente que não correspondam
 * a uma membresia ativa comprovada no banco de dados.
 */
export async function resolveActiveWorkspace(
  appUserId: string,
  suggestedWorkspaceId?: string | null,
  options?: {
    isTechnician?: boolean;
    userName?: string;
  }
): Promise<{
  activeWorkspaceId?: string;
  membershipRole?: "owner" | "admin" | "technician" | "partner" | "client" | "member";
  isPersonalWorkspace?: boolean;
}> {
  const [memberships, ownedWorkspaces] = await Promise.all([
    prisma.membership.findMany({
      where: { userId: appUserId, status: "active" },
      select: { workspaceId: true, role: true },
    }),
    prisma.workspace.findMany({
      where: { ownerUserId: appUserId },
      select: { id: true, type: true },
    }),
  ]);

  const ownedMap = new Map(ownedWorkspaces.map((w) => [w.id, w.type]));

  // Se o cliente sugeriu um workspace específico (via header, param ou query)
  if (suggestedWorkspaceId) {
    const isOwner = ownedMap.has(suggestedWorkspaceId);
    const membership = memberships.find((m) => m.workspaceId === suggestedWorkspaceId);

    if (isOwner) {
      return {
        activeWorkspaceId: suggestedWorkspaceId,
        membershipRole: "owner",
        isPersonalWorkspace: ownedMap.get(suggestedWorkspaceId) === "personal",
      };
    }

    if (membership) {
      return {
        activeWorkspaceId: suggestedWorkspaceId,
        membershipRole: (normalizeWorkspaceRole(membership.role) as any) ?? "member",
        isPersonalWorkspace: false,
      };
    }

    // SUGERIU UM WORKSPACE NÃO AUTORIZADO: rejeita com erro!
    throw new Error("Acesso negado ao workspace solicitado.");
  }

  // Sem sugestão: ADR-002 prioriza Personal Workspace se o usuário possuir um
  const personalWs = ownedWorkspaces.find((w) => w.type === "personal");
  if (personalWs) {
    return {
      activeWorkspaceId: personalWs.id,
      membershipRole: "owner",
      isPersonalWorkspace: true,
    };
  }

  // Se possui workspace corporativo onde é owner:
  if (ownedWorkspaces.length > 0) {
    return {
      activeWorkspaceId: ownedWorkspaces[0].id,
      membershipRole: "owner",
      isPersonalWorkspace: false,
    };
  }

  // Se possui membresia ativa em workspace:
  if (memberships.length > 0) {
    return {
      activeWorkspaceId: memberships[0].workspaceId,
      membershipRole: (normalizeWorkspaceRole(memberships[0].role) as any) ?? "member",
      isPersonalWorkspace: false,
    };
  }

  // Lazy-provisioning para técnicos autônomos sem workspace (ADR-002)
  if (options?.isTechnician) {
    const provisioned = await provisionPersonalWorkspace(appUserId, options.userName);
    return {
      activeWorkspaceId: provisioned.id,
      membershipRole: "owner",
      isPersonalWorkspace: true,
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
    const [appUser, person, user] = await Promise.all([
      prisma.appUser.findUnique({
        where: { authUserId: req.auth.userId },
        select: { id: true, name: true, workspaceId: true },
      }),
      prisma.person.findFirst({
        where: { systemAccessUserId: req.auth.userId, deletedAt: null },
        select: { id: true, type: true },
      }),
      prisma.user.findUnique({
        where: { id: req.auth.userId },
        select: { fullName: true },
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

    const isTechnician = person?.type === "technician" || req.auth.role === "technician";
    const userName = appUser.name || user?.fullName || undefined;

    let activeWorkspaceInfo: {
      activeWorkspaceId?: string;
      membershipRole?: "owner" | "admin" | "technician" | "partner" | "client" | "member";
      isPersonalWorkspace?: boolean;
    } = {};

    try {
      activeWorkspaceInfo = await resolveActiveWorkspace(appUser.id, rawSuggested, {
        isTechnician,
        userName,
      });
    } catch {
      return res.status(403).json({ message: "Você não possui acesso ao workspace solicitado." });
    }

    const platformRole =
      req.auth.role === "platform_admin"
        ? ("platform_admin" as const)
        : ("user" as const);

    const isPersonalScope = !!activeWorkspaceInfo.isPersonalWorkspace;

    const ctx: RequestContext = {
      actorUserId: req.auth.userId,
      platformRole,
      activeWorkspaceId: activeWorkspaceInfo.activeWorkspaceId,
      membershipRole: activeWorkspaceInfo.membershipRole,
      technicianPersonId: person?.id,
      scope: isPersonalScope ? "technician_personal" : "workspace",
      capabilities: ["*"],
    };

    req.ctx = ctx;
    return next();
  } catch (error) {
    return next(error);
  }
}
