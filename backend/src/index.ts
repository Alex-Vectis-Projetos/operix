import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { ensureBuckets } from "./lib/minio.js";
import { authRouter } from "./routes/auth.js";
import { accountRouter } from "./routes/account.js";
import { billingRouter } from "./routes/billing.js";
import { workspaceRouter } from "./routes/workspaces.js";
import { extractRouter } from "./routes/extract.js";
import { storageRouter } from "./routes/storage.js";
import { documentsRouter } from "./routes/documents.js";
import { serviceOrdersRouter } from "./routes/serviceOrders.js";
import { productionOrdersRouter } from "./routes/productionOrders.js";
import { productionPhotosRouter } from "./routes/productionPhotos.js";
import { invitesRouter } from "./routes/invites.js";
import { paymentOrdersRouter } from "./routes/paymentOrders.js";
import { productionWorkflowRouter } from "./routes/productionWorkflow.js";
import { workflowRouter } from "./routes/workflow.js";
import { platformsRouter } from "./routes/platforms.js";
import { financeRouter } from "./routes/finance.js";
import { financeV2Router } from "./routes/financeV2.js";
import { financialRecordsRouter } from "./routes/financialRecords.js";
import { settingsRouter } from "./routes/settings.js";
import { weatherRouter } from "./routes/weather.js";
import { routeCalcRouter } from "./routes/routeCalc.js";
import { notificationsRouter } from "./routes/notifications.js";
import { operationalBillingRouter } from "./routes/billingOperations.js";
import { locationsRouter } from "./routes/locations.js";
import { peopleRouter } from "./routes/people.js";
import { countryDocumentRequirementsRouter } from "./routes/countryDocumentRequirements.js";
import { clientsRouter } from "./routes/clients.js";
import { budgetsRouter } from "./routes/budgets.js";
import { weeklogsRouter } from "./routes/weeklogs.js";
import { paymentListsRouter } from "./routes/paymentLists.js";
import { externalOperationalImportsRouter } from "./routes/externalOperationalImports.js";
import { runWeatherIngest } from "./services/weatherIngest.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN.split(",").map((item: string) => item.trim()), credentials: true }));
app.use(
  express.json({
    limit: "20mb",
    verify: (req: Request & { rawBody?: string }, _res: Response, buf: Uint8Array) => {
      req.rawBody = new TextDecoder().decode(buf);
    },
  }),
);
app.use(morgan("combined"));

app.get("/api/health", async (_req: Request, res: Response) => {
  await prisma.$queryRaw`SELECT 1`;
  res.json({
    status: "ok",
    service: "qw-nexus-api",
  });
});

app.use("/api/auth", authRouter);
app.use("/api/account", accountRouter);
app.use("/api/billing", billingRouter);
app.use("/api/workspaces", workspaceRouter);
app.use("/api/extract", extractRouter);
app.use("/api/storage", storageRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/service-orders", serviceOrdersRouter);
app.use("/api/production-orders", productionOrdersRouter);
app.use("/api/production-orders/:orderId/photos", productionPhotosRouter);
app.use("/api", invitesRouter);
app.use("/api/payment-orders", paymentOrdersRouter);
app.use("/api/production-workflow", productionWorkflowRouter);
app.use("/api/workflow", workflowRouter);
app.use("/api/platforms", platformsRouter);
app.use("/api/finance", financeRouter);
app.use("/api/finance/v2", financeV2Router);
app.use("/api/financial-records", financialRecordsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/weather", weatherRouter);
app.use("/api/route", routeCalcRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/billing", operationalBillingRouter);
app.use("/api/locations", locationsRouter);
app.use("/api/people", peopleRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/budgets", budgetsRouter);
app.use("/api/weeklogs", weeklogsRouter);
app.use("/api/payment-lists", paymentListsRouter);
app.use("/api/external-operational-imports", externalOperationalImportsRouter);
app.use("/api/country-document-requirements", countryDocumentRequirementsRouter);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      message: "Payload inválido.",
      issues: err.issues,
    });
  }

  if (err && typeof err === "object" && "statusCode" in err && typeof (err as Record<string, unknown>).statusCode === "number") {
    const status = (err as Record<string, unknown>).statusCode as number;
    const msg = err instanceof Error ? err.message : String((err as Record<string, unknown>).message || "Acesso negado.");
    return res.status(status).json({
      message: msg,
    });
  }

  const message = err instanceof Error ? err.message : String(err);
  console.error("[api] unhandled error", message);
  return res.status(500).json({
    message: "Erro interno no servidor.",
  });
});


app.listen(env.PORT, async () => {
  console.log(`[api] listening on port ${env.PORT}`);
  try {
    await ensureBuckets();
  } catch (err) {
    console.error("[minio] falha ao inicializar buckets:", err);
  }
});

// Scheduled hail weather ingest every 15 minutes
setTimeout(() => {
  runWeatherIngest(prisma).catch((e: Error) => console.error("[weather] startup ingest error:", e.message));
  setInterval(() => {
    runWeatherIngest(prisma).catch((e: Error) => console.error("[weather] ingest error:", e.message));
  }, 15 * 60 * 1000);
}, 8000);
