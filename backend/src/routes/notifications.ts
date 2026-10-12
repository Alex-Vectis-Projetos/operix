import { Router, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

type NotificationRow = {
  id: string;
  userId: string;
  type: string | null;
  title: string | null;
  body: string | null;
  payload: unknown | null;
  isRead: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function mapNotification(r: NotificationRow) {
  return {
    id: r.id,
    user_id: typeof r.userId === "string" ? r.userId : (r as any).user_id ?? null,
    type: r.type ?? (r as any).notification_type ?? "system",
    title: r.title ?? (r as any).subject ?? null,
    body: r.body ?? (r as any).message ?? null,
    payload: r.payload ?? (r as any).metadata ?? null,
    is_read: typeof r.isRead === "boolean" ? r.isRead : Boolean((r as any).is_read ?? false),
    created_at: typeof r.createdAt === "string" ? r.createdAt : r.createdAt?.toISOString?.() ?? new Date().toISOString(),
    updated_at: typeof r.updatedAt === "string" ? r.updatedAt : r.updatedAt?.toISOString?.() ?? new Date().toISOString(),
  };
}

const PATCH_BODY = z
  .object({ is_read: z.boolean().optional() })
  .strict();

const PATCH_ALL_BODY = z
  .object({ is_read: z.literal(true) })
  .strict();

const CREATE_BODY = z.object({
  type: z.string().default("system"),
  title: z.string(),
  body: z.string().optional().nullable(),
  payload: z.record(z.any()).optional().nullable(),
});

notificationsRouter.post("/", async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const userId = req.auth!.userId;
    const input = CREATE_BODY.parse(req.body ?? {});
    const created = await (prisma as any).notification.create({
      data: {
        userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        payload: input.payload ?? null,
      },
    });
    return res.status(201).json(mapNotification(created));
  } catch (e) {
    next(e);
  }
});

notificationsRouter.get("/", async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const userId = req.auth!.userId;
    const limit = Math.min(Number((req.query.limit as string) ?? 50) || 50, 200);
    try {
      const rows = await (prisma as any).notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return res.json(rows.map(mapNotification));
    } catch {
      // Fallback for raw query if prisma client is mid-migration
      const rawRows = await prisma.$queryRawUnsafe<any>(
        "SELECT id, user_id, type, title, body, payload, is_read, created_at, updated_at FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2",
        userId,
        limit,
      ).catch(() => []);
      return res.json((rawRows || []).map(mapNotification));
    }
  } catch (e) {
    next(e);
  }
});

notificationsRouter.patch("/:id", async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const userId = req.auth!.userId;
    const id = String(req.params.id);
    const body = PATCH_BODY.parse(req.body ?? {});
    try {
      await prisma.$executeRawUnsafe(
        "UPDATE notifications SET is_read = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3",
        Boolean(body.is_read ?? true),
        id,
        userId,
      );
    } catch {
      /* noop — table may not exist yet in older tenants */
    }
    return res.status(204).send();
  } catch (e) {
    next(e);
  }
});

notificationsRouter.patch("/", async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const userId = req.auth!.userId;
    const body = PATCH_ALL_BODY.parse(req.body ?? {});
    try {
      await prisma.$executeRawUnsafe(
        "UPDATE notifications SET is_read = $1, updated_at = NOW() WHERE user_id = $2 AND is_read = FALSE",
        Boolean(body.is_read),
        userId,
      );
    } catch {
      /* noop */
    }
    return res.status(204).send();
  } catch (e) {
    next(e);
  }
});

notificationsRouter.delete("/", async (req: AuthenticatedRequest, res: Response, next) => {
  try {
    const userId = req.auth!.userId;
    try {
      await prisma.$executeRawUnsafe("DELETE FROM notifications WHERE user_id = $1", userId);
    } catch {
      /* noop */
    }
    return res.status(204).send();
  } catch (e) {
    next(e);
  }
});
