import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { resolveRequestContext } from "../middleware/requestContext.js";
import {
  createExternalOperationalImport,
  discardExternalOperationalImport,
  getExternalOperationalImport,
  retryExternalOperationalExtraction,
  reviewExternalOperationalImport,
} from "../services/externalOperationalImportService.js";
import { ImportPipelineError } from "../services/externalListImportService.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const jsonUploadSchema = z.object({ fileName: z.string(), mimeType: z.string(), contentBase64: z.string().min(1) }).strict();
const reviewSchema = z.object({ rows: z.array(z.object({ id: z.string().uuid(), patch: z.object({}).passthrough() }).strict()).min(1) }).strict();

export const externalOperationalImportsRouter = Router();
externalOperationalImportsRouter.use(requireAuth);
externalOperationalImportsRouter.use(resolveRequestContext);

function uploadInput(req: Request) {
  if (req.file) return { fileName: req.file.originalname, mimeType: req.file.mimetype, bytes: req.file.buffer };
  const body = jsonUploadSchema.parse(req.body);
  return { fileName: body.fileName, mimeType: body.mimeType, bytes: Buffer.from(body.contentBase64, "base64") };
}

function routeParam(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function sendError(res: Response, error: unknown): Response {
  if (error instanceof z.ZodError) return res.status(422).json({ code: "IMPORT_PAYLOAD_INVALID", message: "Payload de importação inválido." });
  if (error instanceof ImportPipelineError) return res.status(error.statusCode).json({ code: error.code, importId: error.importId, message: error.message });
  if (error && typeof error === "object" && "statusCode" in error) {
    const typed = error as { statusCode: number; code?: string; message?: string };
    return res.status(typed.statusCode).json({ code: typed.code ?? typed.message, message: typed.message });
  }
  return res.status(500).json({ code: "IMPORT_INTERNAL_ERROR", message: "Falha ao processar importação." });
}

externalOperationalImportsRouter.post("/", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const imported = await createExternalOperationalImport(req.ctx!, uploadInput(req));
    return res.status(201).json({ importId: imported.id, status: imported.status, sha256: imported.fileSha256, items: imported.items, import: imported });
  } catch (error) {
    return sendError(res, error);
  }
});

externalOperationalImportsRouter.get("/:importId", async (req: Request, res: Response) => {
  try {
    const imported = await getExternalOperationalImport(req.ctx!, routeParam(req, "importId"));
    return res.json({ importId: imported.id, status: imported.status, item: imported.items[0] ?? null, items: imported.items, import: imported });
  } catch (error) {
    return sendError(res, error);
  }
});

externalOperationalImportsRouter.post("/:importId/retry-extraction", async (req: Request, res: Response) => {
  try {
    const imported = await retryExternalOperationalExtraction(req.ctx!, routeParam(req, "importId"));
    return res.json({ importId: imported.id, status: imported.status, items: imported.items, import: imported });
  } catch (error) {
    return sendError(res, error);
  }
});

externalOperationalImportsRouter.patch("/:importId/rows", async (req: Request, res: Response) => {
  try {
    const imported = await reviewExternalOperationalImport(req.ctx!, routeParam(req, "importId"), reviewSchema.parse(req.body));
    return res.json({ importId: imported.id, status: imported.status, items: imported.items, import: imported });
  } catch (error) {
    return sendError(res, error);
  }
});

externalOperationalImportsRouter.delete("/:importId", async (req: Request, res: Response) => {
  try {
    await discardExternalOperationalImport(req.ctx!, routeParam(req, "importId"));
    return res.status(204).end();
  } catch (error) {
    return sendError(res, error);
  }
});

// T05 intentionally does not materialize Weeklog/WeeklogEntry.
externalOperationalImportsRouter.post("/:importId/commit", async (req: Request, res: Response) => {
  try {
    await getExternalOperationalImport(req.ctx!, routeParam(req, "importId"));
    return res.status(409).json({ code: "IMPORT_MATERIALIZATION_DEFERRED", message: "EXTERNAL_WEEKLOG_MATERIALIZATION_DEFERRED" });
  } catch (error) {
    return sendError(res, error);
  }
});

externalOperationalImportsRouter.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(422).json({ code: "IMPORT_FILE_SIZE_INVALID", message: "Arquivo excede o tamanho permitido." });
  }
  return next(error);
});
