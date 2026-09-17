import express, { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "../middleware/auth.js";
import { resolveRequestContext } from "../middleware/requestContext.js";
import {
  listWeeklogs,
  getWeeklogById,
  getWeeklogEntries,
  getWeeklogEntryById,
  submitWeeklogForValidation,
  reviewWeeklogEntry,
  uploadWeeklogSignature,
  validateWeeklogBatch,
} from "../services/weeklogService.js";
import { prisma } from "../lib/prisma.js";

export const weeklogsRouter = Router();

weeklogsRouter.use(requireAuth);
weeklogsRouter.use(resolveRequestContext);

// GET /api/weeklogs
weeklogsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const { startsOn, clientId, client_id, status, siteKey, site_key } =
      req.query as Record<string, string | undefined>;

    const weeklogs = await listWeeklogs(ctx, {
      startsOn,
      clientId: clientId || client_id,
      status,
      siteKey: siteKey || site_key,
    });

    return res.json(weeklogs);
  } catch (error) {
    return next(error);
  }
});

// GET /api/weeklogs/:id
weeklogsRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const id = req.params["id"] as string;
    const weeklog = await getWeeklogById(ctx, id);

    return res.json(weeklog);
  } catch (error) {
    return next(error);
  }
});

// GET /api/weeklogs/:id/entries
weeklogsRouter.get("/:id/entries", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const id = req.params["id"] as string;
    const entries = await getWeeklogEntries(ctx, id);

    return res.json(entries);
  } catch (error) {
    return next(error);
  }
});

// GET /api/weeklogs/:id/entries/:entryId
weeklogsRouter.get("/:id/entries/:entryId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const id = req.params["id"] as string;
    const entryId = req.params["entryId"] as string;
    const entry = await getWeeklogEntryById(ctx, id, entryId);

    return res.json(entry);
  } catch (error) {
    return next(error);
  }
});

// POST /api/weeklogs/:id/submit-for-validation
weeklogsRouter.post("/:id/submit-for-validation", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const id = req.params["id"] as string;
    const result = await submitWeeklogForValidation(ctx, id);

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
});

// POST /api/weeklogs/:id/entries/:entryId/review
weeklogsRouter.post(
  "/:id/entries/:entryId/review",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.ctx;
      if (!ctx?.activeWorkspaceId) {
        return res.status(403).json({ message: "Workspace ativo não definido." });
      }

      const id = req.params["id"] as string;
      const entryId = req.params["entryId"] as string;

      const updatedEntry = await reviewWeeklogEntry(ctx, id, entryId, req.body);
      return res.status(200).json(updatedEntry);
    } catch (error) {
      return next(error);
    }
  }
);

// POST /api/weeklogs/:id/signature-upload
// Recebe o buffer binário PNG capturado pelo canvas
weeklogsRouter.post(
  "/:id/signature-upload",
  express.raw({ type: ["image/png", "application/octet-stream", "*/*"], limit: "2mb" }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.ctx;
      if (!ctx?.activeWorkspaceId) {
        return res.status(403).json({ message: "Workspace ativo não definido." });
      }

      const id = req.params["id"] as string;

      let buffer: Buffer;
      if (Buffer.isBuffer(req.body)) {
        buffer = req.body;
      } else if (typeof req.body === "string") {
        buffer = Buffer.from(req.body, "base64");
      } else {
        buffer = Buffer.alloc(0);
      }

      const result = await uploadWeeklogSignature(ctx, id, buffer);
      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }
);

// POST /api/weeklogs/:id/validate
weeklogsRouter.post(
  "/:id/validate",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ctx = req.ctx;
      if (!ctx?.activeWorkspaceId) {
        return res.status(403).json({ message: "Workspace ativo não definido." });
      }

      const id = req.params["id"] as string;
      const result = await validateWeeklogBatch(ctx, id, req.body);

      return res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  }
);

