import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { resolveRequestContext } from "../middleware/requestContext.js";
import {
  createExternalListImport,
  discardExternalListImport,
  getExternalListImport,
  ImportPipelineError,
  retryExternalListExtraction,
  reviewExternalListImport,
} from "../services/externalListImportService.js";
import {
  commitReviewedImport,
  createPaymentList,
  getPaymentList,
  listPaymentLists,
  transitionPaymentList,
} from "../services/paymentListService.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const jsonUploadSchema = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  contentBase64: z.string().min(1),
}).strict();
const rowsReviewSchema = z.object({
  header: z.unknown().optional(),
  rows: z.array(z.object({ id: z.string().uuid(), patch: z.object({}).passthrough() }).strict()).optional(),
}).strict();

export const paymentListsRouter = Router();
paymentListsRouter.use(requireAuth);
paymentListsRouter.use(resolveRequestContext);

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
  if (error instanceof z.ZodError) {
    const code = error.issues.some((issue) => issue.message === "LIST_CURRENCY_REQUIRED") ? "LIST_CURRENCY_REQUIRED" : "IMPORT_PAYLOAD_INVALID";
    return res.status(422).json({ code, message: code === "LIST_CURRENCY_REQUIRED" ? "Moeda obrigatória e inválida." : "Payload de importação inválido." });
  }
  if (error instanceof ImportPipelineError) return res.status(error.statusCode).json({ code: error.code, importId: error.importId, message: error.message });
  if (error && typeof error === "object" && "statusCode" in error) {
    const typed = error as { statusCode: number; code?: string; message?: string };
    return res.status(typed.statusCode).json({ code: typed.code ?? typed.message, message: typed.message });
  }
  return res.status(500).json({ code: "IMPORT_INTERNAL_ERROR", message: "Falha ao processar importação." });
}

paymentListsRouter.post("/imports", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const imported = await createExternalListImport(req.ctx!, uploadInput(req));
    return res.status(201).json({ importId: imported.id, status: imported.status, sha256: imported.fileSha256, items: imported.items, import: imported });
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.get("/imports/:importId", async (req: Request, res: Response) => {
  try {
    const imported = await getExternalListImport(req.ctx!, routeParam(req, "importId"));
    return res.json({ importId: imported.id, status: imported.status, item: imported.items[0] ?? null, items: imported.items, import: imported });
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.post("/imports/:importId/retry-extraction", async (req: Request, res: Response) => {
  try {
    const imported = await retryExternalListExtraction(req.ctx!, routeParam(req, "importId"));
    return res.json({ importId: imported.id, status: imported.status, items: imported.items, import: imported });
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.patch("/imports/:importId/rows", async (req: Request, res: Response) => {
  try {
    const body = rowsReviewSchema.parse(req.body);
    const imported = await reviewExternalListImport(req.ctx!, routeParam(req, "importId"), { header: body.header, rows: body.rows });
    return res.json({ importId: imported.id, status: imported.status, items: imported.items, import: imported });
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.patch("/imports/:importId/items/:itemId", async (req: Request, res: Response) => {
  try {
    const itemId = routeParam(req, "itemId");
    const imported = await reviewExternalListImport(req.ctx!, routeParam(req, "importId"), { rows: [{ id: itemId, patch: req.body }] });
    return res.json({ importId: imported.id, status: imported.status, item: imported.items.find((item) => item.id === req.params.itemId) ?? null, import: imported });
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.delete("/imports/:importId", async (req: Request, res: Response) => {
  try {
    await discardExternalListImport(req.ctx!, routeParam(req, "importId"));
    return res.status(204).end();
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.post("/imports/:importId/commit", async (req: Request, res: Response) => {
  try {
    const list = await commitReviewedImport(req.ctx!, routeParam(req, "importId"));
    return res.status(201).json(list);
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.get("/", async (req: Request, res: Response) => {
  try {
    return res.json(await listPaymentLists(req.ctx!));
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.post("/", async (req: Request, res: Response) => {
  try {
    return res.status(201).json(await createPaymentList(req.ctx!, req.body));
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    return res.json(await getPaymentList(req.ctx!, routeParam(req, "id")));
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.patch("/:id/status", async (req: Request, res: Response) => {
  try {
    return res.json(await transitionPaymentList(req.ctx!, routeParam(req, "id"), req.body?.toStatus));
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    return res.status(422).json({ code: "IMPORT_FILE_SIZE_INVALID", message: "Arquivo excede o tamanho permitido." });
  }
  return next(error);
});
