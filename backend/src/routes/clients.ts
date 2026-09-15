import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveRequestContext } from "../middleware/requestContext.js";

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
