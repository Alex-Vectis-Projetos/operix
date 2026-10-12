import { Router, type Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { runWeatherIngest } from "../services/weatherIngest.js";

export const weatherRouter = Router();

/* GET /api/weather/hail-events */
weatherRouter.get("/hail-events", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, severity, since, no_expired, limit = "200", sort = "asc", order } = req.query as Record<string, string>;
    const direction = (order || sort)?.toLowerCase() === "desc" ? "desc" : "asc";
    const where: any = {};
    if (status) where.status = status;
    if (severity) where.severity = severity;
    if (since) {
      where.OR = [
        { forecastTime: { gte: new Date(since) } },
        { observedTime: { gte: new Date(since) } },
        { createdAt: { gte: new Date(since) } },
      ];
    }
    if (no_expired === "true") {
      const now = new Date();
      where.AND = [
        { status: { not: "closed" } },
        { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
      ];
    }
    const rawEvents = await (prisma as any).hailEvent.findMany({
      where,
      orderBy: { forecastTime: direction },
      take: Math.min(parseInt(limit) || 200, 500),
    });
    // Ensure both camelCase and snake_case properties are available
    const hailEvents = rawEvents.map((e: any) => ({
      ...e,
      forecast_time: e.forecastTime ? new Date(e.forecastTime).toISOString() : null,
      observed_time: e.observedTime ? new Date(e.observedTime).toISOString() : null,
      created_at: e.createdAt ? new Date(e.createdAt).toISOString() : null,
      hail_size_mm: e.hailSizeMm ?? null,
      radius_km: e.radiusKm ?? 15,
      external_id: e.externalId ?? null,
    }));
    res.json({ hailEvents });
  } catch (e) {
    res.status(500).json({ message: (e as Error).message });
  }
});

/* POST /api/weather/hail-events/ingest — manual trigger */
weatherRouter.post("/hail-events/ingest", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await runWeatherIngest(prisma);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ message: (e as Error).message });
  }
});

/* GET /api/weather/hail-reports */
weatherRouter.get("/hail-reports", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { since, limit = "500" } = req.query as Record<string, string>;
    const where: any = {};
    if (since) where.observedAt = { gte: new Date(since) };
    const reports = await (prisma as any).hailReport.findMany({
      where, orderBy: { observedAt: "desc" },
      take: Math.min(parseInt(limit) || 500, 1000),
    });
    res.json({ reports });
  } catch (e) {
    res.status(500).json({ message: (e as Error).message });
  }
});

/* POST /api/weather/hail-reports — submit community report */
const HailReportSchema = z.object({
  lat: z.number(), lng: z.number(),
  city: z.string().optional().nullable(),
  hailEventId: z.string().optional().nullable(),
  hailSizeMm: z.number().optional().nullable(),
  severity: z.enum(["low","moderate","severe","extreme"]).default("moderate"),
  status: z.string().default("partial"),
  confidenceScore: z.number().min(0).max(1).default(0.3),
  notes: z.string().optional().nullable(),
  photoStoragePath: z.string().optional().nullable(),
  photoUrl: z.string().optional().nullable(),
});

weatherRouter.post("/hail-reports", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = HailReportSchema.parse(req.body);
    const report = await (prisma as any).hailReport.create({
      data: {
        reporterUserId: req.auth!.userId,
        hailEventId: body.hailEventId ?? null,
        lat: body.lat, lng: body.lng, city: body.city ?? null,
        hailSizeMm: body.hailSizeMm ?? null, severity: body.severity,
        status: body.status, confidenceScore: body.confidenceScore,
        notes: body.notes ?? null,
        photoStoragePath: body.photoStoragePath ?? null,
        photoUrl: body.photoUrl ?? null,
      },
    });
    res.json({ report });
  } catch (e) {
    if (e instanceof z.ZodError) return res.status(400).json({ message: "Payload inválido", issues: e.issues });
    res.status(500).json({ message: (e as Error).message });
  }
});

/* GET /api/weather/backend-events — proxy to backend_event_logs */
weatherRouter.get("/backend-events", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { table_name, action, since, count: countOnly, limit = "50" } = req.query as Record<string, string>;
    const where: any = {};
    if (table_name) where.tableName = table_name;
    if (action) where.action = action;
    if (since) where.createdAt = { gte: new Date(since) };
    if (countOnly === "true") {
      const count = await prisma.backendEventLog.count({ where });
      return res.json({ count });
    }
    const events = await prisma.backendEventLog.findMany({
      where, orderBy: { createdAt: "desc" },
      take: Math.min(parseInt(limit) || 50, 300),
      select: { id: true, tableName: true, action: true, payload: true, actorUserId: true, createdAt: true },
    });
    res.json({ events });
  } catch (e) {
    res.status(500).json({ message: (e as Error).message });
  }
});
