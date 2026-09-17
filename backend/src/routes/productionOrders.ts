import { Router, type Request, type Response, type NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveRequestContext, type RequestContext } from "../middleware/requestContext.js";
import {
  ForbiddenError,
  NotFoundError,
  assertObjectAccess,
} from "../lib/objectAuth.js";
import {
  operationalWeekOf,
  flattenServicesFromBudgetNotes,
  isWeekClosed,
} from "../lib/weekUtils.js";
import {
  finalizeProductionOrder,
  type FinalizeProductionOrderOptions,
} from "../services/weeklogService.js";

export const productionOrdersRouter = Router();

productionOrdersRouter.use(requireAuth);
productionOrdersRouter.use(resolveRequestContext);

function genCode(): string {
  return `PO-${Date.now().toString(36).toUpperCase()}`;
}

function mapOrder(o: any) {
  if (!o) return null;
  return {
    id: o.id,
    workspace_id: o.workspaceId,
    workspaceId: o.workspaceId,
    code: o.code,
    client_id: o.clientId,
    clientId: o.clientId,
    client_name: o.clientName,
    clientName: o.clientName,
    technician_user_id: o.technicianUserId,
    technicianUserId: o.technicianUserId,
    technician_name: o.technicianName,
    technicianName: o.technicianName,
    platform: o.platform,
    insurer: o.insurer,
    license_plate: o.licensePlate,
    licensePlate: o.licensePlate,
    vin: o.vin,
    brand: o.brand,
    model: o.model,
    color: o.color,
    notes: o.notes,
    priority: o.priority,
    status: o.status,
    commercial_status: o.commercialStatus,
    commercialStatus: o.commercialStatus,
    service_order_id: o.serviceOrderId,
    serviceOrderId: o.serviceOrderId,
    budget_id: o.budgetId,
    budgetId: o.budgetId,
    budget_revision_id: o.budgetRevisionId,
    budgetRevisionId: o.budgetRevisionId,
    due_at: o.dueAt?.toISOString?.() ?? (o.dueAt ? String(o.dueAt) : null),
    dueAt: o.dueAt?.toISOString?.() ?? (o.dueAt ? String(o.dueAt) : null),
    started_at: o.startedAt?.toISOString?.() ?? (o.startedAt ? String(o.startedAt) : null),
    startedAt: o.startedAt?.toISOString?.() ?? (o.startedAt ? String(o.startedAt) : null),
    finished_at: o.finishedAt?.toISOString?.() ?? (o.finishedAt ? String(o.finishedAt) : null),
    finishedAt: o.finishedAt?.toISOString?.() ?? (o.finishedAt ? String(o.finishedAt) : null),
    delivered_at: o.deliveredAt?.toISOString?.() ?? (o.deliveredAt ? String(o.deliveredAt) : null),
    deliveredAt: o.deliveredAt?.toISOString?.() ?? (o.deliveredAt ? String(o.deliveredAt) : null),
    created_by: o.createdBy,
    createdBy: o.createdBy,
    created_at: o.createdAt?.toISOString?.() ?? (o.createdAt ? String(o.createdAt) : null),
    createdAt: o.createdAt?.toISOString?.() ?? (o.createdAt ? String(o.createdAt) : null),
    updated_at: o.updatedAt?.toISOString?.() ?? (o.updatedAt ? String(o.updatedAt) : null),
    updatedAt: o.updatedAt?.toISOString?.() ?? (o.updatedAt ? String(o.updatedAt) : null),
    photos: Array.isArray(o.photos) ? o.photos : undefined,
  };
}

function parseDate(v: unknown): Date | null {
  if (!v || v === "") return null;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Validação e aplicação das regras de atribuição de técnico (TECH-ASSIGN-01 e TECH-ASSIGN-02).
 */
export async function validateTechnicianAssignment(
  ctx: RequestContext,
  targetTechnicianUserId?: string | null
): Promise<{ technicianUserId: string | null; technicianName: string | null }> {
  // Regra TECH-ASSIGN-01: Se o usuário logado for técnico no workspace
  if (ctx.membershipRole === "technician") {
    if (targetTechnicianUserId && targetTechnicianUserId !== ctx.actorUserId) {
      throw new ForbiddenError(
        "Técnicos só podem atribuir ordens de produção a si mesmos (TECH-ASSIGN-01)."
      );
    }
    // Auto-atribuição forçada para o próprio técnico
    const appUser = await prisma.appUser.findFirst({
      where: { authUserId: ctx.actorUserId },
      include: { user: { select: { fullName: true } } },
    });
    return {
      technicianUserId: ctx.actorUserId,
      technicianName: appUser?.name || appUser?.user?.fullName || null,
    };
  }

  // Se não foi informado técnico por admin/owner:
  if (!targetTechnicianUserId) {
    return { technicianUserId: null, technicianName: null };
  }

  // Se for owner/admin atribuindo a si mesmo:
  if (targetTechnicianUserId === ctx.actorUserId) {
    const appUser = await prisma.appUser.findFirst({
      where: { authUserId: ctx.actorUserId },
      include: { user: { select: { fullName: true } } },
    });
    return {
      technicianUserId: ctx.actorUserId,
      technicianName: appUser?.name || appUser?.user?.fullName || null,
    };
  }

  // Regra TECH-ASSIGN-02: Apenas owner ou admin podem atribuir outros técnicos membros do mesmo workspace
  if (
    ctx.membershipRole !== "owner" &&
    ctx.membershipRole !== "admin" &&
    ctx.platformRole !== "platform_admin"
  ) {
    throw new ForbiddenError("Apenas administradores ou proprietários podem atribuir técnicos.");
  }

  // Localiza o AppUser do técnico alvo
  const targetAppUser = await prisma.appUser.findFirst({
    where: {
      OR: [
        { authUserId: targetTechnicianUserId },
        { id: targetTechnicianUserId },
      ],
    },
    include: { user: { select: { fullName: true } } },
  });

  if (!targetAppUser) {
    throw new ForbiddenError("Técnico selecionado não é membro ativo do workspace.");
  }

  // Valida se o técnico alvo é membro ativo ou owner do workspace ativo
  const [membership, workspace] = await Promise.all([
    prisma.membership.findFirst({
      where: {
        workspaceId: ctx.activeWorkspaceId,
        userId: targetAppUser.id,
        status: "active",
      },
    }),
    prisma.workspace.findFirst({
      where: {
        id: ctx.activeWorkspaceId,
        ownerUserId: targetAppUser.id,
      },
    }),
  ]);

  if (!membership && !workspace) {
    throw new ForbiddenError("Técnico selecionado não é membro ativo do workspace.");
  }

  return {
    technicianUserId: targetAppUser.authUserId,
    technicianName: targetAppUser.name || targetAppUser.user?.fullName || null,
  };
}

// ---------------------------------------------------------------------------
// Helpers: Pastas semana + veículo no WEEKLOG (Document.type="folder" nativo)
// e link de fotos da Produção para o veículo (mesmo storage_path → NÃO duplica
// bytes no storage). ZERO migrations, tudo sobre tabela `documents` existente.
// ---------------------------------------------------------------------------
const DOC_ENTITY_TYPE_WEEKLOG = "service_order";
const DOC_MODULE_WEEKLOG = "orders"; // compatível com HierarchyExplorer do WEEKLOG

function sanitizeFolderName(raw: string | null | undefined): string {
  if (!raw) return "UNTITLED";
  return String(raw)
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase() || "UNTITLED";
}

function vehicleFolderName(
  brand: string | null | undefined,
  model: string | null | undefined,
  licensePlate: string | null | undefined,
): string {
  const vehicle = sanitizeFolderName([brand, model].filter(Boolean).join(" "));
  const plate = sanitizeFolderName(licensePlate || "SEM-MATRICULA");
  return `${vehicle} - ${plate}`;
}

async function upsertWeekFolder(
  workspaceId: string,
  userId: string,
  weekNumber: number,
  yearReference: number,
  retificacao: boolean = false,
): Promise<{ id: string; created: boolean }> {
  const name = retificacao
    ? `Week ${String(weekNumber).padStart(2, "0")} — Retificação`
    : `Week ${String(weekNumber).padStart(2, "0")}`;
  try {
    const found = await prisma.document.findFirst({
      where: {
        workspaceId,
        entityType: DOC_ENTITY_TYPE_WEEKLOG,
        module: DOC_MODULE_WEEKLOG,
        type: "folder",
        parentId: null,
        name,
      },
      select: { id: true },
    });
    if (found) return { id: found.id, created: false };

    const created = await prisma.document.create({
      data: {
        workspaceId,
        entityType: DOC_ENTITY_TYPE_WEEKLOG,
        module: DOC_MODULE_WEEKLOG,
        type: "folder",
        parentId: null,
        name,
        displayName: `${name} · ${yearReference}${retificacao ? " · Atrasado" : ""}`,
        uploadedBy: userId || null,
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (err) {
    console.error("[weeklog][folders] Falha upsertWeekFolder:", err);
    throw err;
  }
}

async function upsertVehicleFolder(
  workspaceId: string,
  userId: string,
  weekFolderId: string,
  brand: string | null | undefined,
  model: string | null | undefined,
  licensePlate: string | null | undefined,
): Promise<{ id: string; created: boolean }> {
  const name = vehicleFolderName(brand, model, licensePlate);
  try {
    const found = await prisma.document.findFirst({
      where: {
        workspaceId,
        entityType: DOC_ENTITY_TYPE_WEEKLOG,
        module: DOC_MODULE_WEEKLOG,
        type: "folder",
        parentId: weekFolderId,
        name,
      },
      select: { id: true },
    });
    if (found) return { id: found.id, created: false };

    const created = await prisma.document.create({
      data: {
        workspaceId,
        entityType: DOC_ENTITY_TYPE_WEEKLOG,
        module: DOC_MODULE_WEEKLOG,
        type: "folder",
        parentId: weekFolderId,
        name,
        uploadedBy: userId || null,
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (err) {
    console.error("[weeklog][folders] Falha upsertVehicleFolder:", err);
    throw err;
  }
}

async function ensureWeekVehicleFoldersAndLinkPhotos(
  po: {
    id: string;
    workspaceId: string;
    brand: string | null;
    model: string | null;
    licensePlate: string | null;
    photos?: Array<{ id: string; storagePath: string; category: string; caption: string | null; sizeBytes: number | null; uploadedBy: string }>;
  },
  userId: string,
  weekNumber: number,
  yearReference: number,
  _serviceOrderId: string,
  retificacao: boolean = false,
): Promise<{
  week_folder_id: string | null;
  vehicle_folder_id: string | null;
  week_folder_created: boolean;
  vehicle_folder_created: boolean;
  linked_photos_count: number;
  skipped_photos_count: number;
  errors: string[];
}> {
  const result = {
    week_folder_id: null as string | null,
    vehicle_folder_id: null as string | null,
    week_folder_created: false,
    vehicle_folder_created: false,
    linked_photos_count: 0,
    skipped_photos_count: 0,
    errors: [] as string[],
  };
  try {
    const photos = po.photos || [];

    // 1) Criar/buscar Week XX folder (raiz) — com ou sem retificação
    const wk = await upsertWeekFolder(po.workspaceId, userId, weekNumber, yearReference, retificacao);
    result.week_folder_id = wk.id;
    result.week_folder_created = wk.created;

    // 2) Criar/buscar Veículo folder filho
    const vh = await upsertVehicleFolder(po.workspaceId, userId, wk.id, po.brand, po.model, po.licensePlate);
    result.vehicle_folder_id = vh.id;
    result.vehicle_folder_created = vh.created;

    // 3) Linkar cada ProductionPhoto como Document(type=file) filho do veículo
    //    (reusa storage_path da foto — NÃO duplica binário no storage)
    for (const photo of photos) {
      try {
        if (!photo.storagePath) {
          result.skipped_photos_count += 1;
          continue;
        }
        // idempotência: já existe Document com este storagePath sob este vehicleFolder?
        const already = await prisma.document.findFirst({
          where: {
            workspaceId: po.workspaceId,
            parentId: vh.id,
            storagePath: photo.storagePath,
          },
          select: { id: true },
        });
        if (already) {
          result.skipped_photos_count += 1;
          continue;
        }

        const ext = photo.storagePath.split(".").pop() || "";
        const safeCaption = photo.caption && photo.caption.trim().length > 0 ? photo.caption : `${photo.category || "photo"}_${photo.id.slice(0, 8)}`;
        const name = ext ? `${safeCaption}.${ext}` : safeCaption;

        await prisma.document.create({
          data: {
            workspaceId: po.workspaceId,
            entityType: DOC_ENTITY_TYPE_WEEKLOG,
            module: DOC_MODULE_WEEKLOG,
            type: "file",
            parentId: vh.id,
            name,
            displayName: photo.caption || null,
            storagePath: photo.storagePath,
            sizeBytes: photo.sizeBytes ?? null,
            uploadedBy: photo.uploadedBy || userId || null,
          },
        });
        result.linked_photos_count += 1;
      } catch (pErr) {
        result.skipped_photos_count += 1;
        result.errors.push(`photo ${photo.id}: ${pErr instanceof Error ? pErr.message : String(pErr)}`);
      }
    }

    return result;
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }
}

// ---------------------------------------------------------------------------
// Hook: Produção → WEEKLOG automático.
// Regra: Quando ProductionOrder status = "delivered" (Finalizado), cria OU
// atualiza uma entrada ServiceOrder (WEEKLOG) com a semana operacional correta
// (domingo a sábado). Usa production_orders.service_order_id como chave
// idempotente — NÃO duplica, sempre atualiza se já houver vínculo.
// NÃO quebra lógica atual: ordens de pagamento continuam independentes.
// Cria também a hierarquia de pastas Week XX / Veículo e linka as fotos.
// ---------------------------------------------------------------------------
async function upsertWeeklogFromProduction(
  poId: string,
  userId: string,
): Promise<{ weeklog?: any; action?: "created" | "updated" | "skipped"; reason?: string; folders?: any }> {
  try {
    const po = await prisma.productionOrder.findUnique({ where: { id: poId }, include: { photos: true } });
    if (!po) return { action: "skipped", reason: "production_order_not_found" };
    if (po.status !== "delivered") return { action: "skipped", reason: "not_finalized" };

    const refDate = po.deliveredAt ?? po.finishedAt ?? new Date();
    const weekInfo = operationalWeekOf(refDate);

    // --- PROMPT 5: RETIFICAÇÃO (semana original vs semana finalização real) ---
    // Semana original esperada (de entrada/criação/início de produção) como referência.
    const originalDate = po.startedAt ?? po.dueAt ?? po.createdAt ?? refDate;
    const originalWeekInfo = operationalWeekOf(originalDate);
    const isRetificacao =
      originalWeekInfo.weekNumber !== weekInfo.weekNumber ||
      originalWeekInfo.yearReference !== weekInfo.yearReference;

    // Efetivo (se retificação → usar a ORIGINAL com sufixo A: W26A / pasta "Week 26 — Retificação").
    // Semana finalizada (data real entrega continua salva como meta-info em operational.base).
    let effective = isRetificacao
      ? {
          week: `${originalWeekInfo.yearReference}-W${String(originalWeekInfo.weekNumber).padStart(2, "0")}A`, // 2026-W26A
          yearReference: originalWeekInfo.yearReference,
          weekNumber: originalWeekInfo.weekNumber,
          weekDisplay: `Week ${String(originalWeekInfo.weekNumber).padStart(2, "0")} — Retificação`,
          weekShortDisplay: `${String(originalWeekInfo.weekNumber).padStart(2, "0")}A · Retificação`,
        }
      : {
          week: weekInfo.week,
          yearReference: weekInfo.yearReference,
          weekNumber: weekInfo.weekNumber,
          weekDisplay: weekInfo.displayShort,
          weekShortDisplay: weekInfo.displayShort,
        };

    // -----------------------------------------------------------------------
    // PROMPT 6: Regra de FECHAMENTO SEMANAL
    // - Se NÃO é retificação (registro NORMAL) e a semana do delivery está
    //   FECHADA (hoje > sábado fim da semana) → NÃO cria/atualiza na semana
    //   antiga (REGRA 2). Automaticamente encaixa na SEMANA ATUAL (REGRA 3).
    // - Retificações NÃO são bloqueadas (REGRA 4): elas sempre podem entrar
    //   mesmo após fechamento, com o sufixo A apontando para semana original.
    // -----------------------------------------------------------------------
    if (!isRetificacao && isWeekClosed(effective.week)) {
      const todayWeek = operationalWeekOf(new Date());
      effective = {
        week: todayWeek.week,
        yearReference: todayWeek.yearReference,
        weekNumber: todayWeek.weekNumber,
        weekDisplay: todayWeek.displayShort,
        weekShortDisplay: todayWeek.displayShort,
      };
    }

    const { items: svc, total: budgetTotal } = flattenServicesFromBudgetNotes(po.notes ?? null);
    const s1 = svc[0] ?? null;
    const s2 = svc[1] ?? null;
    const s3 = svc[2] ?? null;
    const s4 = svc[3] ?? null;

    const carNameParts = [po.brand, po.model, po.color].filter(Boolean).join(" ") || null;
    // Carrega distributionSnapshot existente (com validações salvas anteriormente, se existir)
    // — declarado ANTES de usar no operational_document merge.
    const existingDistributionSnapshot = po.serviceOrderId
      ? (await prisma.serviceOrder.findUnique({ where: { id: po.serviceOrderId }, select: { distributionSnapshot: true } }))?.distributionSnapshot ?? null
      : null;
    const existingDist = existingDistributionSnapshot || null;
    const existingOperational = (existingDist && typeof existingDist === "object" && (existingDist as any).operational_document) || {};
    // ---------------------------------------------------------------------
    // PROMPT 6 REGRA 9: Validação já registrada PRESERVADA e NÃO SOBRESCRITA
    // por nova execução automática do hook de produção.
    // - Se existir validation.xxx com situation=oui ou historico preenchido,
    //   mantemos o validation intacto sem nenhum spread/merge perigoso.
    // - O mesmo para retificativa já salva pelo Dialog.
    // ---------------------------------------------------------------------
    const preserved: Record<string, unknown> = {};
    for (const k of ["validation", "retificativa", "historico", "historico_validacoes"] as const) {
      const v = (existingOperational as any)?.[k];
      if (v !== undefined && v !== null) {
        if (typeof v !== "object" || Array.isArray(v)) {
          if (Array.isArray(v) ? v.length > 0 : true) preserved[k] = v;
        } else if (Object.keys(v as any).length > 0) {
          preserved[k] = v;
        }
      }
    }
    const distributionSnapshot = {
      ...(existingDist && typeof existingDist === "object" ? (existingDist as Record<string, unknown>) : {}),
      operational_document: {
        ...(existingOperational as Record<string, unknown>),
        ...preserved,
        base: {
          ...((existingOperational as any)?.base && typeof (existingOperational as any).base === "object"
            ? ((existingOperational as any).base as Record<string, unknown>)
            : {}),
          vin: po.vin ?? null,
          insurer: po.insurer ?? null,
          delivered_at: (po.deliveredAt ?? refDate).toISOString(),
          brand: po.brand ?? null,
          model: po.model ?? null,
          color: po.color ?? null,
          production_order_id: po.id,
          production_code: po.code ?? null,
          week_number: effective.weekNumber,
          week_display: effective.weekShortDisplay,
          photos_count: (po.photos ?? []).length,
          retificacao: isRetificacao,
          semana_original: {
            week: originalWeekInfo.week,
            week_number: originalWeekInfo.weekNumber,
            display: originalWeekInfo.displayShort,
            year_reference: originalWeekInfo.yearReference,
            data_referencia: originalDate.toISOString(),
          },
          semana_finalizacao: {
            week: weekInfo.week,
            week_number: weekInfo.weekNumber,
            display: weekInfo.displayShort,
            year_reference: weekInfo.yearReference,
            data_real: refDate.toISOString(),
          },
          data_entrega_real: refDate.toISOString(),
        },
      },
    };
    const weeklogData = {
      workspaceId: po.workspaceId,
      visibilityScope: "workspace" as const,
      userId: userId || po.createdBy || "",
      assignedUserId: po.technicianUserId || userId || po.createdBy || "",
      clientId: po.clientId ?? null,
      clientName: po.clientName ?? "",
      carName: carNameParts ? String(carNameParts) : null,
      licensePlate: po.licensePlate ?? null,
      platform: po.platform ?? null,
      operationalUnit: null,
      groupId: null,
      week: effective.week,
      yearReference: effective.yearReference,
      technicianName: po.technicianName ?? "",
      technicianEarning: null,
      technicianPercentage: null,
      service1Name: s1 ? s1.desc : null,
      service1Price: s1 ? (isFinite(s1.price) ? s1.price : null) : null,
      service2Name: s2 ? s2.desc : null,
      service2Price: s2 ? (isFinite(s2.price) ? s2.price : null) : null,
      service3Name: s3 ? s3.desc : null,
      service3Price: s3 ? (isFinite(s3.price) ? s3.price : null) : null,
      service4Name: s4 ? s4.desc : null,
      service4Price: s4 ? (isFinite(s4.price) ? s4.price : null) : null,
      total: budgetTotal > 0 ? budgetTotal : null,
      status: "confirmed" as const,
      distributionSnapshot,
    };

    // Helper local: cria/atualiza pastas e linka fotos (NUNCA quebra o fluxo weeklog)
    const attachFolders = async (serviceOrderId: string) => {
      try {
        return await ensureWeekVehicleFoldersAndLinkPhotos(
          po as any,
          userId,
          effective.weekNumber,
          effective.yearReference,
          serviceOrderId,
          isRetificacao, // criar pasta "Week XX — Retificação"
        );
      } catch (foldersErr) {
        console.error("[weeklog][folders] Falha anexar pastas/fotos:", foldersErr);
        return { errors: [foldersErr instanceof Error ? foldersErr.message : String(foldersErr)] };
      }
    };

    // 1) Idempotência: já existe vínculo por serviceOrderId → atualiza a existente
    if (po.serviceOrderId) {
      const existing = await prisma.serviceOrder.findUnique({ where: { id: po.serviceOrderId } });
      if (existing) {
        const updated = await prisma.serviceOrder.update({
          where: { id: po.serviceOrderId },
          data: weeklogData,
        });
        const folders = await attachFolders(updated.id);
        return { weeklog: updated, action: "updated", folders };
      }
    }

    // 2) Idempotência 2: já existe outra entrada WEEKLOG com semana +
    //    (licensePlate OU cliente+vin) — impede duplicação de veículo (REGRA 6).
    //    Inclui SEMANA RETIFICADA WXXA se for o caso.
    const baseFilter: any = {
      workspaceId: po.workspaceId,
      deletedAt: null,
      week: effective.week,
      yearReference: effective.yearReference,
    };
    const vinFilter = po.vin ? { distributionSnapshot: { path: ["operational_document", "base", "vin"], equals: po.vin } } : null;
    const plateFilter = po.licensePlate ? { licensePlate: po.licensePlate } : null;
    const clientFilter = po.clientId
      ? { clientId: po.clientId }
      : po.clientName
        ? { clientName: po.clientName }
        : null;
    const whereClauses: any[] = [];
    if (plateFilter) {
      if (clientFilter) whereClauses.push({ ...baseFilter, ...plateFilter, ...clientFilter });
      whereClauses.push({ ...baseFilter, ...plateFilter });
    }
    if (vinFilter) {
      whereClauses.push({ ...baseFilter, ...vinFilter });
      if (clientFilter) whereClauses.push({ ...baseFilter, ...vinFilter, ...clientFilter });
    }
    // NÃO incluir clientFilter SOZINHO (sem placa / sem VIN): mesmo cliente pode
    // ter vários veículos diferentes na mesma semana, e isso causava duplicação
    // indevida (REGRA 6: "Não permitir duplicação de veículos.").
    const similar = whereClauses.length > 0
      ? await prisma.serviceOrder.findFirst({
          where: { OR: whereClauses },
          orderBy: { createdAt: "desc" },
        })
      : null;

    if (similar) {
      // Garante que o productionOrder aponte para esta weeklog (se ainda não estiver atrelado)
      if (!po.serviceOrderId || po.serviceOrderId !== similar.id) {
        await prisma.productionOrder.update({
          where: { id: po.id },
          data: { serviceOrderId: similar.id },
        });
      }
      const updated = await prisma.serviceOrder.update({
        where: { id: similar.id },
        data: weeklogData,
      });
      const folders = await attachFolders(updated.id);
      return { weeklog: updated, action: "updated", folders };
    }

    // 3) Nenhuma entrada encontrada → cria NOVA entrada WEEKLOG + vincula id
    const created = await prisma.serviceOrder.create({
      data: weeklogData,
    });
    await prisma.productionOrder.update({
      where: { id: po.id },
      data: { serviceOrderId: created.id },
    });
    const folders = await attachFolders(created.id);
    return { weeklog: created, action: "created", folders };
  } catch (err) {
    // NÃO interromper fluxo principal de salvar Produção caso algo falhe no WEEKLOG.
    // Registra e segue (o usuário pode resolver depois manualmente).
    console.error("[weeklog] Falha ao gerar/atualizar entrada automática:", err);
    return { action: "skipped", reason: err instanceof Error ? err.message : String(err) };
  }
}

// GET /api/production-orders
productionOrdersRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const { status, technician_user_id, technicianUserId, clientId, client_id, q, priority } =
      req.query as Record<string, string | undefined>;

    const isTechnicianScope =
      ctx.membershipRole === "technician" && ctx.scope === "workspace";

    const techFilter = isTechnicianScope
      ? ctx.actorUserId
      : (technician_user_id || technicianUserId);

    const clientFilter = clientId || client_id;

    const orders = await prisma.productionOrder.findMany({
      where: {
        workspaceId: ctx.activeWorkspaceId,
        ...(status ? { status } : {}),
        ...(priority ? { priority } : {}),
        ...(techFilter ? { technicianUserId: techFilter } : {}),
        ...(clientFilter ? { clientId: clientFilter } : {}),
        ...(q
          ? {
              OR: [
                { code: { contains: q, mode: "insensitive" } },
                { clientName: { contains: q, mode: "insensitive" } },
                { licensePlate: { contains: q, mode: "insensitive" } },
                { model: { contains: q, mode: "insensitive" } },
                { brand: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: {
        photos: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json(orders.map(mapOrder));
  } catch (error) {
    return next(error);
  }
});

// GET /api/production-orders/:id
productionOrdersRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const order = await prisma.productionOrder.findUnique({
      where: { id },
      include: {
        photos: true,
        budget: true,
        budgetRevision: true,
      },
    });

    if (!order || order.workspaceId !== ctx.activeWorkspaceId) {
      return res.status(404).json({ message: "Ordem de produção não encontrada." });
    }

    assertObjectAccess(ctx, order);

    return res.json(mapOrder(order));
  } catch (error) {
    return next(error);
  }
});

// POST /api/production-orders
productionOrdersRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const b = req.body;

    // Validação da regra de atribuição de técnico (TECH-ASSIGN-01 e TECH-ASSIGN-02)
    const rawTech = b.technician_user_id ?? b.technicianUserId;
    const { technicianUserId, technicianName } = await validateTechnicianAssignment(ctx, rawTech);

    // Validação de linhagem de orçamento (production_orders_budget_lineage_check)
    const rawBudgetId = b.budget_id ?? b.budgetId ?? null;
    const rawBudgetRevisionId = b.budget_revision_id ?? b.budgetRevisionId ?? null;

    let budgetId: string | null = null;
    let budgetRevisionId: string | null = null;

    if (rawBudgetId || rawBudgetRevisionId) {
      if (!rawBudgetId || !rawBudgetRevisionId) {
        return res.status(400).json({
          message:
            "Ambos budgetId e budgetRevisionId devem ser fornecidos para ordens vinculadas a orçamento.",
        });
      }

      const budget = await prisma.budget.findUnique({
        where: { id: rawBudgetId },
      });
      if (!budget || budget.workspaceId !== ctx.activeWorkspaceId) {
        return res.status(404).json({ message: "Orçamento vinculado não encontrado." });
      }

      budgetId = rawBudgetId;
      budgetRevisionId = rawBudgetRevisionId;
    }

    const order = await prisma.productionOrder.create({
      data: {
        workspaceId: ctx.activeWorkspaceId,
        code: b.code || genCode(),
        clientId: b.client_id ?? b.clientId ?? null,
        clientName: b.client_name ?? b.clientName ?? null,
        technicianUserId,
        technicianName: technicianName || b.technician_name || b.technicianName || null,
        platform: b.platform ?? null,
        insurer: b.insurer ?? null,
        licensePlate: b.license_plate ?? b.licensePlate ?? null,
        vin: b.vin ?? null,
        brand: b.brand ?? null,
        model: b.model ?? null,
        color: b.color ?? null,
        notes: b.notes ?? null,
        priority: b.priority ?? "normal",
        status: b.status ?? "new_vehicle",
        commercialStatus: b.commercial_status ?? b.commercialStatus ?? null,
        serviceOrderId: b.service_order_id ?? b.serviceOrderId ?? null,
        budgetId,
        budgetRevisionId,
        dueAt: parseDate(b.due_at ?? b.dueAt),
        startedAt: parseDate(b.started_at ?? b.startedAt),
        finishedAt: parseDate(b.finished_at ?? b.finishedAt),
        deliveredAt: parseDate(b.delivered_at ?? b.deliveredAt),
        createdBy: ctx.actorUserId,
      },
    });

    let weeklog: any = undefined;
    if (order.status === "delivered") {
      weeklog = await upsertWeeklogFromProduction(order.id, ctx.actorUserId);
    }

    return res.status(201).json({ ...mapOrder(order), weeklog });
  } catch (error) {
    return next(error);
  }
});

// PATCH /api/production-orders/:id
productionOrdersRouter.patch("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const existing = await prisma.productionOrder.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.activeWorkspaceId) {
      return res.status(404).json({ message: "Ordem de produção não encontrada." });
    }

    assertObjectAccess(ctx, existing);

    const b = req.body;
    const data: Record<string, unknown> = {};

    if (b.client_id !== undefined || b.clientId !== undefined) {
      data.clientId = b.client_id ?? b.clientId ?? null;
    }
    if (b.client_name !== undefined || b.clientName !== undefined) {
      data.clientName = b.client_name ?? b.clientName ?? null;
    }

    if (b.technician_user_id !== undefined || b.technicianUserId !== undefined) {
      const rawTech = b.technician_user_id ?? b.technicianUserId;
      const { technicianUserId, technicianName } = await validateTechnicianAssignment(ctx, rawTech);
      data.technicianUserId = technicianUserId;
      data.technicianName = technicianName || b.technician_name || b.technicianName || null;
    } else if (b.technician_name !== undefined || b.technicianName !== undefined) {
      data.technicianName = b.technician_name ?? b.technicianName ?? null;
    }

    if (b.platform !== undefined) data.platform = b.platform || null;
    if (b.insurer !== undefined) data.insurer = b.insurer || null;
    if (b.license_plate !== undefined || b.licensePlate !== undefined) {
      data.licensePlate = b.license_plate ?? b.licensePlate ?? null;
    }
    if (b.vin !== undefined) data.vin = b.vin || null;
    if (b.brand !== undefined) data.brand = b.brand || null;
    if (b.model !== undefined) data.model = b.model || null;
    if (b.color !== undefined) data.color = b.color || null;
    if (b.notes !== undefined) data.notes = b.notes || null;
    if (b.priority !== undefined) data.priority = b.priority;
    if (b.status !== undefined) data.status = b.status;
    if (b.commercial_status !== undefined || b.commercialStatus !== undefined) {
      data.commercialStatus = b.commercial_status ?? b.commercialStatus ?? null;
    }
    if (b.service_order_id !== undefined || b.serviceOrderId !== undefined) {
      data.serviceOrderId = b.service_order_id ?? b.serviceOrderId ?? null;
    }
    if (b.due_at !== undefined || b.dueAt !== undefined) {
      data.dueAt = parseDate(b.due_at ?? b.dueAt);
    }
    if (b.started_at !== undefined || b.startedAt !== undefined) {
      data.startedAt = parseDate(b.started_at ?? b.startedAt);
    }
    if (b.finished_at !== undefined || b.finishedAt !== undefined) {
      data.finishedAt = parseDate(b.finished_at ?? b.finishedAt);
    }
    if (b.delivered_at !== undefined || b.deliveredAt !== undefined) {
      data.deliveredAt = parseDate(b.delivered_at ?? b.deliveredAt);
    }

    // Delegação canônica de PATCH status="delivered" para finalizeProductionOrder (LEGACY-FINALIZE-01)
    if (b.status === "delivered") {
      const otherData = { ...data };
      delete otherData.status;
      delete otherData.deliveredAt;
      if (Object.keys(otherData).length > 0) {
        await prisma.productionOrder.update({ where: { id }, data: otherData });
      }

      const finalized = await finalizeProductionOrder(ctx, id);

      return res.json({
        ...mapOrder(finalized.productionOrder),
        weeklog: finalized.weeklog,
        weeklogEntry: finalized.weeklogEntry,
      });
    }

    // Auto-preenchimento de data de entrega se status virou delivered
    if (data.status === "delivered" && !data.deliveredAt && !existing.deliveredAt) {
      data.deliveredAt = new Date();
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ message: "Nenhum campo para atualizar." });
    }

    const order = await prisma.productionOrder.update({ where: { id }, data });

    let weeklog: any = undefined;
    if (order.status === "delivered") {
      weeklog = await upsertWeeklogFromProduction(order.id, ctx.actorUserId);
    }

    return res.json({ ...mapOrder(order), weeklog });
  } catch (error) {
    return next(error);
  }
});

// POST /api/production-orders/:id/finalize
productionOrdersRouter.post("/:id/finalize", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const result = await finalizeProductionOrder(ctx, id);

    return res.status(200).json(result);
  } catch (error) {
    return next(error);
  }
});

// DELETE /api/production-orders/:id
productionOrdersRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = req.params["id"] as string;
    const ctx = req.ctx;
    if (!ctx?.activeWorkspaceId) {
      return res.status(403).json({ message: "Workspace ativo não definido." });
    }

    const existing = await prisma.productionOrder.findUnique({ where: { id } });
    if (!existing || existing.workspaceId !== ctx.activeWorkspaceId) {
      return res.status(404).json({ message: "Ordem de produção não encontrada." });
    }

    assertObjectAccess(ctx, existing);

    // Permissão restrita: apenas administradores, owners e platform_admins podem deletar ordens
    if (ctx.membershipRole === "technician" || ctx.membershipRole === "member") {
      throw new ForbiddenError("Permissão insuficiente para excluir ordem de produção.");
    }

    await prisma.productionOrder.delete({ where: { id } });
    return res.json({ deleted: 1 });
  } catch (error) {
    return next(error);
  }
});
