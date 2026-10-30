import { Router, type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { resolveRequestContext } from "../middleware/requestContext.js";
import { prisma } from "../lib/prisma.js";
import { assertClientCapability, ForbiddenError, NotFoundError } from "../lib/objectAuth.js";
import {
  createExternalListImport,
  discardExternalListImport,
  getExternalListImport,
  ImportPipelineError,
  retryExternalListExtraction,
  reviewExternalListImport,
} from "../services/externalListImportService.js";
import {
  associateInvoiceForPaymentList,
  commitReviewedImport,
  createInvoiceForPaymentList,
  createPaymentList,
  getPaymentList,
  listPaymentLists,
  transitionPaymentList,
} from "../services/paymentListService.js";
import { decideConfrontationResult, getConfrontation, runConfrontation } from "../services/confrontationService.js";
import { sendEmail } from "../lib/email/resend.js";
import {
  previewConfrontationFile,
  executeConfrontationHub,
  recordConfrontationDecision,
  listConfrontationRuns,
  getConfrontationRun,
  getConfrontationEvidence,
} from "../services/confrontationHubService.js";

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
const confrontSchema = z.object({ mode: z.enum(["current", "new_round"]).optional() }).strict();

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

async function assertPaymentListAccess(
  req: Request,
  listId: string,
  capability: "payment_list.review"
): Promise<{ list: any; isInternalManager: boolean }> {
  const ctx = req.ctx!;
  if (!ctx.activeWorkspaceId) {
    throw new ForbiddenError("FORBIDDEN_ROLE");
  }
  const list = await prisma.paymentList.findFirst({
    where: { id: listId, workspaceId: ctx.activeWorkspaceId },
    include: { items: true },
  });
  if (!list) {
    throw new NotFoundError("LIST_NOT_FOUND");
  }
  const isInternalManager =
    ctx.platformRole === "platform_admin" ||
    ctx.membershipRole === "owner" ||
    ctx.membershipRole === "admin";

  if (!isInternalManager) {
    const grant = await assertClientCapability(ctx, {
      clientId: list.clientId,
      capability,
    });
    if (grant.siteKey) {
      const allBelong =
        list.items.length > 0 &&
        list.items.every((i: any) => i.operationalSiteKey === grant.siteKey);
      if (!allBelong) {
        throw new ForbiddenError(
          "SITE_SCOPE_UNAUTHORIZED: Local operacional não autorizado para este validador."
        );
      }
    }
  }
  return { list, isInternalManager };
}

paymentListsRouter.post("/confrontation/preview", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const file = uploadInput(req);
    const preview = await previewConfrontationFile(req.ctx!, file);
    return res.json(preview);
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.post("/confrontation/execute", async (req: Request, res: Response) => {
  try {
    const result = await executeConfrontationHub(req.ctx!, req.body);
    return res.status(200).json(result);
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.get("/confrontation/runs", async (req: Request, res: Response) => {
  try {
    const clientId = typeof req.query.clientId === "string" ? req.query.clientId : undefined;
    const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;
    const runs = await listConfrontationRuns(req.ctx!, { clientId, limit });
    return res.json(runs);
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.get("/confrontation/runs/:runId", async (req: Request, res: Response) => {
  try {
    const run = await getConfrontationRun(req.ctx!, routeParam(req, "runId"));
    return res.json(run);
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.post("/confrontation/runs/:runId/decisions", async (req: Request, res: Response) => {
  try {
    const itemId = req.body?.itemId || req.body?.itemKey;
    const decision = req.body?.decision;
    const notes = req.body?.notes || req.body?.decisionNotes;

    if (!itemId || !decision) {
      return res.status(400).json({ message: "Campos obrigatórios: itemId (ou itemKey) e decision." });
    }
    const updated = await recordConfrontationDecision(req.ctx!, {
      runId: routeParam(req, "runId"),
      itemId,
      decision,
      notes,
    });
    return res.json(updated);
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.post("/confrontation/notify-discrepancy", async (req: Request, res: Response) => {
  try {
    const {
      runId,
      itemResultId,
      clientEmail,
      clientName,
      licensePlate,
      carName,
      serviceDescription,
      internalAmount,
      externalAmount,
      differenceAmount,
      notes,
    } = req.body || {};

    if (!clientEmail || !licensePlate) {
      return res.status(400).json({ message: "clientEmail e licensePlate são obrigatórios." });
    }

    const emailSubject = `Divergência de Valores — OS Operix vs. Lista do Cliente (Placa: ${licensePlate})`;
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b;">
        <h2 style="color: #0f172a; margin-bottom: 8px;">Notificação de Divergência Operacional</h2>
        <p>Prezada equipe <strong>${clientName || "Parceiro"}</strong>,</p>
        <p>Identificamos uma divergência de valores durante o confronto da lista de pagamento com a ordem de serviço validada na Operix:</p>
        <table style="border-collapse: collapse; width: 100%; max-width: 600px; margin: 16px 0; font-size: 14px;">
          <tr style="background-color: #f1f5f9;"><td style="padding: 8px 12px; font-weight: bold; border: 1px solid #cbd5e1;">Veículo</td><td style="padding: 8px 12px; border: 1px solid #cbd5e1;">${carName || "—"}</td></tr>
          <tr><td style="padding: 8px 12px; font-weight: bold; border: 1px solid #cbd5e1;">Matrícula / Placa</td><td style="padding: 8px 12px; border: 1px solid #cbd5e1;"><strong>${licensePlate}</strong></td></tr>
          <tr style="background-color: #f1f5f9;"><td style="padding: 8px 12px; font-weight: bold; border: 1px solid #cbd5e1;">Serviço Realizado</td><td style="padding: 8px 12px; border: 1px solid #cbd5e1;">${serviceDescription || "DSP / Reparação"}</td></tr>
          <tr><td style="padding: 8px 12px; font-weight: bold; border: 1px solid #cbd5e1;">Valor na OS (WEEKLOG)</td><td style="padding: 8px 12px; border: 1px solid #cbd5e1; color: #047857; font-weight: bold;">€${internalAmount}</td></tr>
          <tr style="background-color: #f1f5f9;"><td style="padding: 8px 12px; font-weight: bold; border: 1px solid #cbd5e1;">Valor na Lista Enviada</td><td style="padding: 8px 12px; border: 1px solid #cbd5e1; color: #b45309; font-weight: bold;">€${externalAmount}</td></tr>
          <tr><td style="padding: 8px 12px; font-weight: bold; border: 1px solid #cbd5e1;">Diferença a Ajustar</td><td style="padding: 8px 12px; border: 1px solid #cbd5e1; color: #dc2626; font-weight: bold;">€${differenceAmount}</td></tr>
        </table>
        ${notes ? `<p><strong>Observações adicionais:</strong><br/>${notes}</p>` : ""}
        <p>Solicitamos a verificação e emissão da lista corrigida para o alinhamento e faturamento.</p>
        <p style="margin-top: 24px; font-size: 12px; color: #64748b;">Enviado automaticamente pelo módulo de Confronto Comercial — Operix Platform.</p>
      </div>
    `;

    const sendRes = await sendEmail({
      to: clientEmail,
      subject: emailSubject,
      html: emailHtml,
    });

    if (runId && itemResultId) {
      try {
        await recordConfrontationDecision(req.ctx!, {
          runId,
          itemId: itemResultId,
          decision: "contest",
          notes: `Notificação enviada por e-mail para ${clientEmail}: ${notes || "Contestação de valor"}`,
        });
      } catch (err) {
        console.warn("Aviso ao registrar decisão de contestação:", err);
      }
    }

    return res.status(200).json({
      ok: true,
      sent: sendRes.ok,
      messageId: sendRes.ok ? sendRes.id : null,
      error: !sendRes.ok ? sendRes.error : null,
    });
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.get("/confrontation/evidence/:validationId", async (req: Request, res: Response) => {
  try {
    const evidence = await getConfrontationEvidence(req.ctx!, routeParam(req, "validationId"));
    return res.json(evidence);
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.get("/:id/confrontation", async (req: Request, res: Response) => {
  try {
    const { isInternalManager } = await assertPaymentListAccess(req, routeParam(req, "id"), "payment_list.review");
    return res.json(await getConfrontation(req.ctx!, routeParam(req, "id"), { isClientAuthorized: !isInternalManager }));
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.post("/:id/confront", async (req: Request, res: Response) => {
  try {
    const { isInternalManager } = await assertPaymentListAccess(req, routeParam(req, "id"), "payment_list.review");
    const payload = confrontSchema.parse(req.body ?? {});
    const result = await runConfrontation(req.ctx!, routeParam(req, "id"), payload, { isClientAuthorized: !isInternalManager });
    return res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.patch("/:id/confrontation/:resultId/decision", async (req: Request, res: Response) => {
  try {
    const { isInternalManager } = await assertPaymentListAccess(req, routeParam(req, "id"), "payment_list.review");
    return res.json(await decideConfrontationResult(req.ctx!, routeParam(req, "id"), routeParam(req, "resultId"), req.body, { isClientAuthorized: !isInternalManager }));
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
    const toStatus = req.body?.toStatus;
    const { isInternalManager } = await assertPaymentListAccess(req, routeParam(req, "id"), "payment_list.review");
    if (toStatus === "ready_for_billing" && !isInternalManager) {
      throw new ForbiddenError("FORBIDDEN_ROLE: Apenas operadores internos possuem autoridade para aprovar faturamento.");
    }
    return res.json(await transitionPaymentList(req.ctx!, routeParam(req, "id"), toStatus, { isClientAuthorized: !isInternalManager }));
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.post("/:id/invoice/create", async (req: Request, res: Response) => {
  try {
    const listId = routeParam(req, "id");
    const result = await createInvoiceForPaymentList(req.ctx!, listId, req.body);
    return res.status(result.idempotent ? 200 : 201).json(result);
  } catch (error) {
    return sendError(res, error);
  }
});

paymentListsRouter.post("/:id/invoice/associate", async (req: Request, res: Response) => {
  try {
    const listId = routeParam(req, "id");
    const result = await associateInvoiceForPaymentList(req.ctx!, listId, req.body);
    return res.status(200).json(result);
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
