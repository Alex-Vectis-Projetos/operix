import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveRequestContext } from "../middleware/requestContext.js";
import {
  ALLOWED_CLIENT_CAPABILITIES,
  assertClientCapability,
  ForbiddenError,
  NotFoundError,
  UnprocessableEntityError,
} from "../lib/objectAuth.js";

export const clientsRouter = Router();

clientsRouter.use(requireAuth);
clientsRouter.use(resolveRequestContext);

const createClientSchema = z.object({
  name: z.string().trim().min(1, "Nome do cliente é obrigatório.").max(200),
  address: z.string().trim().max(500).optional().nullable(),
  contactEmail: z.string().trim().email("Email de contato inválido.").optional().nullable().or(z.literal("")),
  contactPhone: z.string().trim().max(50).optional().nullable(),
  displayCode: z.string().trim().max(50).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

function formatClient(client: any) {
  return {
    id: client.id,
    workspace_id: client.workspaceId,
    workspaceId: client.workspaceId,
    name: client.name,
    address: client.address,
    contact_email: client.contactEmail,
    contactEmail: client.contactEmail,
    contact_phone: client.contactPhone,
    contactPhone: client.contactPhone,
    display_code: client.displayCode,
    displayCode: client.displayCode,
    notes: client.notes,
    created_at: client.createdAt instanceof Date ? client.createdAt.toISOString() : client.createdAt,
    createdAt: client.createdAt instanceof Date ? client.createdAt.toISOString() : client.createdAt,
    updated_at: client.updatedAt instanceof Date ? client.updatedAt.toISOString() : client.updatedAt,
    updatedAt: client.updatedAt instanceof Date ? client.updatedAt.toISOString() : client.updatedAt,
  };
}

/**
 * GET /api/clients
 * Retorna todos os clientes ativos do workspace ativo resolvido no RequestContext
 */
clientsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.ctx?.activeWorkspaceId;
    if (!workspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const clients = await prisma.client.findMany({
      where: {
        workspaceId,
        deletedAt: null,
      },
      orderBy: { name: "asc" },
    });

    return res.status(200).json({
      clients: clients.map(formatClient),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * GET /api/clients/:id
 * Retorna cliente específico se pertencer estritamente ao workspace ativo (404 caso pertença a outro)
 */
clientsRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.ctx?.activeWorkspaceId;
    if (!workspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const id = typeof req.params.id === "string" ? req.params.id : String(req.params.id);

    const client = await prisma.client.findFirst({
      where: {
        id,
        workspaceId,
        deletedAt: null,
      },
    });

    if (!client) {
      return res.status(404).json({ message: "Cliente não encontrado." });
    }

    return res.status(200).json({ client: formatClient(client) });
  } catch (error) {
    return next(error);
  }
});

/**
 * POST /api/clients
 * Cadastra cliente associando com o workspace ativo
 */
clientsRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.ctx?.activeWorkspaceId;
    if (!workspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const input = createClientSchema.parse(req.body);

    const client = await prisma.client.create({
      data: {
        workspaceId,
        visibilityScope: "workspace",
        name: input.name,
        address: input.address || null,
        contactEmail: input.contactEmail || null,
        contactPhone: input.contactPhone || null,
        displayCode: input.displayCode || null,
        notes: input.notes || null,
        createdBy: req.ctx?.actorUserId || null,
      },
    });

    return res.status(201).json({ client: formatClient(client) });
  } catch (error) {
    return next(error);
  }
});

const collaboratorCapabilitiesSchema = z.array(z.string()).refine(
  (caps) => caps.every((c) => (ALLOWED_CLIENT_CAPABILITIES as readonly string[]).includes(c)),
  { message: "INVALID_CLIENT_CAPABILITY: Capacidade solicitada inválida para perfil cliente." }
);

const createCollaboratorSchema = z.object({
  userId: z.string().uuid("userId deve ser um UUID válido."),
  role: z.string().default("collaborator"),
  capabilities: z.array(z.string()).min(1, "Ao menos uma capacidade deve ser informada."),
  siteKey: z.string().trim().max(100).optional().nullable(),
});

const updateCollaboratorSchema = z.object({
  role: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  siteKey: z.string().trim().max(100).optional().nullable(),
  status: z.enum(["active", "revoked"]).optional(),
});

function formatGrant(grant: any) {
  return {
    id: grant.id,
    grantId: grant.id,
    workspaceId: grant.workspaceId,
    workspace_id: grant.workspaceId,
    userId: grant.userId,
    user_id: grant.userId,
    clientId: grant.clientId,
    client_id: grant.clientId,
    role: grant.role,
    status: grant.status,
    capabilities: grant.capabilities,
    siteKey: grant.siteKey,
    site_key: grant.siteKey,
    grantedAt: grant.grantedAt instanceof Date ? grant.grantedAt.toISOString() : grant.grantedAt,
    revokedAt: grant.revokedAt instanceof Date ? grant.revokedAt.toISOString() : grant.revokedAt,
    createdAt: grant.createdAt instanceof Date ? grant.createdAt.toISOString() : grant.createdAt,
  };
}

/**
 * Valida autoridade para delegar / gerenciar colaboradores:
 * - Owner/Admin do workspace: autoridade irrestrita para qualquer cliente do workspace.
 * - Representante do cliente: deve possuir grant com 'client.collaborators.manage' para o MESMO clientId,
 *   não pode delegar capacidades além do seu teto e não pode delegar fora do seu siteKey.
 */
async function assertCollaboratorManagementAuthority(
  ctx: any,
  clientId: string,
  requestedCapabilities?: string[],
  requestedSiteKey?: string | null
): Promise<{ isOwnerOrAdmin: boolean; delegatorGrant?: any }> {
  const isOwnerOrAdmin = ctx.membershipRole === "owner" || ctx.membershipRole === "admin";

  if (isOwnerOrAdmin) {
    // Owner/Admin pode delegar qualquer capacidade cliente-segura
    if (requestedCapabilities) {
      const invalidCaps = requestedCapabilities.filter(
        (c) => !(ALLOWED_CLIENT_CAPABILITIES as readonly string[]).includes(c)
      );
      if (invalidCaps.length > 0) {
        throw new UnprocessableEntityError(
          "INVALID_CLIENT_CAPABILITY: Capacidade solicitada inválida para perfil cliente."
        );
      }
    }
    return { isOwnerOrAdmin: true };
  }

  // Representante do cliente: valida se possui capacidade 'client.collaborators.manage'
  const delegatorGrant = await assertClientCapability(ctx, {
    clientId,
    capability: "client.collaborators.manage",
  });

  if (requestedCapabilities) {
    // 1. Não pode solicitar capacidades inválidas
    const invalidCaps = requestedCapabilities.filter(
      (c) => !(ALLOWED_CLIENT_CAPABILITIES as readonly string[]).includes(c)
    );
    if (invalidCaps.length > 0) {
      throw new UnprocessableEntityError(
        "INVALID_CLIENT_CAPABILITY: Capacidade solicitada inválida para perfil cliente."
      );
    }

    // 2. Teto de delegação: representante não pode conceder capacidades que ele próprio não possui
    const unpossessed = requestedCapabilities.filter(
      (c) => !delegatorGrant.capabilities.includes(c)
    );
    if (unpossessed.length > 0) {
      throw new ForbiddenError(
        "CAPABILITY_CEILING_EXCEEDED: Representante não pode conceder capacidades superiores ao seu próprio teto."
      );
    }
  }

  // 3. Teto de localidade: representante restrito a um site só pode criar grants para o mesmo site
  if (
    delegatorGrant.siteKey &&
    requestedSiteKey !== undefined &&
    requestedSiteKey !== delegatorGrant.siteKey
  ) {
    throw new ForbiddenError(
      "SITE_SCOPE_UNAUTHORIZED: Delegante restrito a um local operacional não pode delegar para outro local."
    );
  }

  return { isOwnerOrAdmin: false, delegatorGrant };
}

/**
 * POST /api/clients/:clientId/collaborators
 * Cria ou atualiza ClientAccessGrant para colaborador do cliente especificado.
 */
clientsRouter.post("/:clientId/collaborators", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId || !ctx?.actorUserId) {
      return res.status(403).json({ message: "Contexto de autenticação incompleto." });
    }

    const clientId = String(req.params.clientId);
    const input = createCollaboratorSchema.parse(req.body);

    // 1. Valida autoridade do delegador (garante detecção de CROSS_CLIENT_FORBIDDEN)
    await assertCollaboratorManagementAuthority(ctx, clientId, input.capabilities, input.siteKey);

    // 2. Valida existência do cliente no workspace ativo
    const client = await prisma.client.findFirst({
      where: { id: clientId, workspaceId: ctx.activeWorkspaceId, deletedAt: null },
    });
    if (!client) {
      return res.status(404).json({ message: "Cliente não encontrado no workspace ativo." });
    }

    const grant = await prisma.clientAccessGrant.upsert({
      where: {
        workspaceId_userId_clientId: {
          workspaceId: ctx.activeWorkspaceId,
          userId: input.userId,
          clientId,
        },
      },
      create: {
        workspaceId: ctx.activeWorkspaceId,
        userId: input.userId,
        clientId,
        role: input.role,
        status: "active",
        capabilities: input.capabilities,
        siteKey: input.siteKey || null,
      },
      update: {
        role: input.role,
        status: "active",
        capabilities: input.capabilities,
        siteKey: input.siteKey || null,
        revokedAt: null,
        revokedBy: null,
      },
    });

    return res.status(201).json({
      grantId: grant.id,
      grant: formatGrant(grant),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(422).json({
        code: "INVALID_CLIENT_CAPABILITY",
        message: error.errors[0]?.message || "Payload de delegação inválido.",
      });
    }
    return next(error);
  }
});

/**
 * PATCH /api/clients/:clientId/collaborators/:grantId
 * Atualiza capacidades, siteKey ou status de um colaborador existente.
 */
clientsRouter.patch("/:clientId/collaborators/:grantId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId || !ctx?.actorUserId) {
      return res.status(403).json({ message: "Contexto de autenticação incompleto." });
    }

    const clientId = String(req.params.clientId);
    const grantId = String(req.params.grantId);
    const input = updateCollaboratorSchema.parse(req.body);

    const existingGrant = await prisma.clientAccessGrant.findFirst({
      where: { id: grantId, workspaceId: ctx.activeWorkspaceId, clientId },
    });
    if (!existingGrant) {
      return res.status(404).json({ message: "Colaborador não encontrado para este cliente." });
    }

    await assertCollaboratorManagementAuthority(ctx, clientId, input.capabilities, input.siteKey);

    const updated = await prisma.clientAccessGrant.update({
      where: { id: grantId },
      data: {
        role: input.role ?? existingGrant.role,
        capabilities: input.capabilities ?? existingGrant.capabilities,
        siteKey: input.siteKey !== undefined ? input.siteKey : existingGrant.siteKey,
        status: input.status ?? existingGrant.status,
      },
    });

    return res.status(200).json({
      grantId: updated.id,
      grant: formatGrant(updated),
    });
  } catch (error) {
    return next(error);
  }
});

/**
 * DELETE /api/clients/:clientId/collaborators/:grantId
 * Revoga soft o vínculo de colaboração do cliente (preserva integridade e histórico de auditoria).
 */
clientsRouter.delete("/:clientId/collaborators/:grantId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId || !ctx?.actorUserId) {
      return res.status(403).json({ message: "Contexto de autenticação incompleto." });
    }

    const clientId = String(req.params.clientId);
    const grantId = String(req.params.grantId);

    const existingGrant = await prisma.clientAccessGrant.findFirst({
      where: { id: grantId, workspaceId: ctx.activeWorkspaceId, clientId },
    });
    if (!existingGrant) {
      return res.status(404).json({ message: "Colaborador não encontrado para este cliente." });
    }

    await assertCollaboratorManagementAuthority(ctx, clientId);

    const revoked = await prisma.clientAccessGrant.update({
      where: { id: grantId },
      data: {
        status: "revoked",
        revokedAt: new Date(),
        revokedBy: ctx.actorUserId,
      },
    });

    return res.status(200).json({
      message: "Grant revogado com sucesso.",
      grantId: revoked.id,
      grant: formatGrant(revoked),
    });
  } catch (error) {
    return next(error);
  }
});

