import { prisma } from "../lib/prisma.js";
import { Prisma } from "@prisma/client";
export { Prisma };
import type { RequestContext } from "../middleware/requestContext.js";
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
  assertTenantAccess,
  assertObjectAccess,
} from "../lib/objectAuth.js";
import { operationalWeekOf } from "../lib/weekUtils.js";

export interface FinalizeProductionOrderOptions {
  deliveredAt?: Date | string | null;
}

export interface FinalizeProductionOrderResult {
  productionOrder: any;
  weeklog: any;
  weeklogEntry: any;
  idempotent: boolean;
}

const DOC_ENTITY_TYPE_WEEKLOG = "service_order";
const DOC_MODULE_WEEKLOG = "orders";

function sanitizeFolderName(raw: string | null | undefined): string {
  if (!raw) return "UNTITLED";
  return (
    String(raw)
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase() || "UNTITLED"
  );
}

function vehicleFolderName(
  brand: string | null | undefined,
  model: string | null | undefined,
  licensePlate: string | null | undefined
): string {
  const vehicle = sanitizeFolderName([brand, model].filter(Boolean).join(" "));
  const plate = sanitizeFolderName(licensePlate || "SEM-MATRICULA");
  return `${vehicle} - ${plate}`;
}

async function syncPhotosToWeeklogFolders(
  tx: Prisma.TransactionClient,
  po: {
    id: string;
    workspaceId: string;
    brand: string | null;
    model: string | null;
    licensePlate: string | null;
    photos?: Array<{
      id: string;
      storagePath: string;
      category: string;
      caption: string | null;
      sizeBytes: number | null;
      uploadedBy: string;
    }>;
  },
  weekInfo: { weekNumber: number; yearReference: number },
  actorUserId: string
): Promise<void> {
  try {
    const weekName = `Week ${String(weekInfo.weekNumber).padStart(2, "0")}`;
    let weekFolder = await tx.document.findFirst({
      where: {
        workspaceId: po.workspaceId,
        entityType: DOC_ENTITY_TYPE_WEEKLOG,
        module: DOC_MODULE_WEEKLOG,
        type: "folder",
        parentId: null,
        name: weekName,
      },
      select: { id: true },
    });

    if (!weekFolder) {
      weekFolder = await tx.document.create({
        data: {
          workspaceId: po.workspaceId,
          entityType: DOC_ENTITY_TYPE_WEEKLOG,
          module: DOC_MODULE_WEEKLOG,
          type: "folder",
          parentId: null,
          name: weekName,
          displayName: `${weekName} · ${weekInfo.yearReference}`,
          uploadedBy: actorUserId || null,
        },
        select: { id: true },
      });
    }

    const vehName = vehicleFolderName(po.brand, po.model, po.licensePlate);
    let vehicleFolder = await tx.document.findFirst({
      where: {
        workspaceId: po.workspaceId,
        entityType: DOC_ENTITY_TYPE_WEEKLOG,
        module: DOC_MODULE_WEEKLOG,
        type: "folder",
        parentId: weekFolder.id,
        name: vehName,
      },
      select: { id: true },
    });

    if (!vehicleFolder) {
      vehicleFolder = await tx.document.create({
        data: {
          workspaceId: po.workspaceId,
          entityType: DOC_ENTITY_TYPE_WEEKLOG,
          module: DOC_MODULE_WEEKLOG,
          type: "folder",
          parentId: weekFolder.id,
          name: vehName,
          uploadedBy: actorUserId || null,
        },
        select: { id: true },
      });
    }

    const photos = po.photos || [];
    for (const photo of photos) {
      if (!photo.storagePath) continue;

      const already = await tx.document.findFirst({
        where: {
          workspaceId: po.workspaceId,
          parentId: vehicleFolder.id,
          storagePath: photo.storagePath,
        },
        select: { id: true },
      });

      if (already) continue;

      const ext = photo.storagePath.split(".").pop() || "";
      const safeCaption =
        photo.caption && photo.caption.trim().length > 0
          ? photo.caption
          : `${photo.category || "photo"}_${photo.id.slice(0, 8)}`;
      const fileName = ext ? `${safeCaption}.${ext}` : safeCaption;

      await tx.document.create({
        data: {
          workspaceId: po.workspaceId,
          entityType: DOC_ENTITY_TYPE_WEEKLOG,
          module: DOC_MODULE_WEEKLOG,
          type: "file",
          parentId: vehicleFolder.id,
          name: fileName,
          displayName: photo.caption || null,
          storagePath: photo.storagePath,
          sizeBytes: photo.sizeBytes ?? null,
          uploadedBy: photo.uploadedBy || actorUserId || null,
        },
      });
    }
  } catch (err) {
    // Non-blocking for folder/document indexing
    console.error("[weeklogService] syncPhotosToWeeklogFolders error:", err);
  }
}

export async function syncLegacyServiceOrderProjection(
  tx: Prisma.TransactionClient,
  params: {
    workspaceId: string;
    technicianUserId: string;
    technicianName: string;
    clientId?: string | null;
    clientName?: string | null;
    brand?: string | null;
    model?: string | null;
    licensePlate?: string | null;
    week: string;
    yearReference: number;
    total: Prisma.Decimal;
    services: any[];
  }
) {
  const s1 = params.services[0];
  const s2 = params.services[1];
  const s3 = params.services[2];
  const s4 = params.services[3];

  const carName = [params.brand, params.model].filter(Boolean).join(" ") || null;

  return await tx.serviceOrder.create({
    data: {
      workspaceId: params.workspaceId,
      visibilityScope: "workspace",
      userId: params.technicianUserId,
      assignedUserId: params.technicianUserId,
      clientId: params.clientId || null,
      clientName: params.clientName || "",
      carName,
      licensePlate: params.licensePlate || null,
      week: params.week,
      yearReference: params.yearReference,
      technicianName: params.technicianName || "",
      service1Name: s1 ? String(s1.description || s1.name) : null,
      service1Price: s1 && s1.total ? Number(s1.total) : null,
      service2Name: s2 ? String(s2.description || s2.name) : null,
      service2Price: s2 && s2.total ? Number(s2.total) : null,
      service3Name: s3 ? String(s3.description || s3.name) : null,
      service3Price: s3 && s3.total ? Number(s3.total) : null,
      service4Name: s4 ? String(s4.description || s4.name) : null,
      service4Price: s4 && s4.total ? Number(s4.total) : null,
      total: Number(params.total),
      status: "delivered",
    },
  });
}

/**
 * T04 Domain Command: finalizeProductionOrder
 * Atomically transitions ProductionOrder -> delivered, generates Weeklog header,
 * creates immutable WeeklogEntry snapshot, and downstream legacy ServiceOrder projection.
 */
export async function finalizeProductionOrder(
  ctx: RequestContext,
  orderId: string,
  options?: FinalizeProductionOrderOptions,
  retryCount = 0
): Promise<FinalizeProductionOrderResult> {
  if (!ctx.activeWorkspaceId) {
    throw new ForbiddenError("Workspace ativo não definido.");
  }

  // 1. Initial lookup & authorization checks
  const po = await prisma.productionOrder.findUnique({
    where: { id: orderId },
    include: {
      photos: true,
      budget: {
        include: {
          approvedRevision: true,
          currentRevision: true,
        },
      },
      budgetRevision: true,
    },
  });

  if (!po || po.workspaceId !== ctx.activeWorkspaceId) {
    throw new NotFoundError("Ordem de produção não encontrada.");
  }

  assertTenantAccess(ctx, po.workspaceId);
  assertObjectAccess(ctx, po);

  // 2. Fast idempotency check if already delivered
  if (po.status === "delivered") {
    const existingEntry = await prisma.weeklogEntry.findUnique({
      where: {
        productionOrderId_executionSequence: {
          productionOrderId: po.id,
          executionSequence: po.executionSequence,
        },
      },
      include: {
        weeklog: true,
      },
    });

    if (existingEntry) {
      return {
        productionOrder: po,
        weeklog: existingEntry.weeklog,
        weeklogEntry: existingEntry,
        idempotent: true,
      };
    }
  }

  // 3. Permitted state transitions check
  if (po.status !== "in_production" && po.status !== "paused") {
    throw new ConflictError(
      `Ordem de produção com status '${po.status}' não pode ser finalizada. Estados permitidos: in_production, paused.`
    );
  }

  // 4. Domain preconditions validation
  if (!po.clientId) {
    throw new UnprocessableEntityError("CLIENT_REQUIRED: Ordem de produção sem cliente canônico.");
  }

  if (!po.operationalSiteKey) {
    throw new UnprocessableEntityError(
      "OPERATIONAL_SITE_REQUIRED: Ordem de produção sem local operacional (siteKey)."
    );
  }

  // Currency resolution: Budget vs Direct OP
  let resolvedCurrencyCode: string | null = null;
  let servicesSnapshot: any[] = [];
  let totalAmount: Prisma.Decimal = new Prisma.Decimal(0);

  if (po.budgetId) {
    // Budget-originated OP
    const revision =
      po.budgetRevision ||
      po.budget?.approvedRevision ||
      po.budget?.currentRevision;

    if (!revision || revision.budgetId !== po.budgetId) {
      throw new UnprocessableEntityError(
        "BUDGET_LINEAGE_INVALID: Linhagem de revisão de orçamento inválida."
      );
    }

    resolvedCurrencyCode = revision.currencyCode || po.currencyCode || null;

    if (!resolvedCurrencyCode || !/^[A-Z]{3}$/.test(resolvedCurrencyCode)) {
      throw new UnprocessableEntityError(
        "CURRENCY_REQUIRED: Código de moeda canônico não resolvível do orçamento."
      );
    }

    const revServices = Array.isArray(revision.services) ? revision.services : [];
    const revParts = Array.isArray(revision.parts) ? revision.parts : [];
    const revLabor = Array.isArray(revision.labor) ? revision.labor : [];

    servicesSnapshot =
      revServices.length > 0
        ? revServices
        : revParts.length > 0
        ? revParts
        : revLabor;

    totalAmount = new Prisma.Decimal(
      revision.finalTotal?.toString() || revision.grossTotal?.toString() || "0"
    );
  } else {
    // Direct OP
    resolvedCurrencyCode = po.currencyCode || null;

    if (!resolvedCurrencyCode || !/^[A-Z]{3}$/.test(resolvedCurrencyCode)) {
      throw new UnprocessableEntityError(
        "CURRENCY_REQUIRED: Código de moeda canônico ausente ou inválido na ordem direta."
      );
    }

    const rawServices = po.performedServices;
    if (!rawServices || !Array.isArray(rawServices) || rawServices.length === 0) {
      throw new UnprocessableEntityError(
        "DIRECT_OP_NO_SERVICES: Ordem de produção direta sem performedServices estruturado."
      );
    }

    let calculatedSum = new Prisma.Decimal(0);
    servicesSnapshot = rawServices.map((item: any, idx: number) => {
      const name = item.name || item.description;
      const description = item.description || item.name;
      if (!name && !description) {
        throw new UnprocessableEntityError(
          `DIRECT_OP_SERVICE_INVALID: Serviço no índice ${idx} sem nome ou descrição.`
        );
      }

      let quantity: Prisma.Decimal;
      let unitPrice: Prisma.Decimal;
      let itemTotal: Prisma.Decimal;

      if (item.amount !== undefined && item.amount !== null && item.amount !== "") {
        unitPrice = new Prisma.Decimal(String(item.amount));
        quantity =
          item.quantity !== undefined
            ? new Prisma.Decimal(String(item.quantity))
            : new Prisma.Decimal(1);
        itemTotal = quantity.mul(unitPrice);
      } else if (item.unitPrice !== undefined && item.unitPrice !== null && item.unitPrice !== "") {
        unitPrice = new Prisma.Decimal(String(item.unitPrice));
        quantity =
          item.quantity !== undefined
            ? new Prisma.Decimal(String(item.quantity))
            : new Prisma.Decimal(1);
        itemTotal =
          item.total !== undefined
            ? new Prisma.Decimal(String(item.total))
            : quantity.mul(unitPrice);
      } else {
        throw new UnprocessableEntityError(
          `DIRECT_OP_SERVICE_INVALID: Serviço no índice ${idx} sem valor monetário.`
        );
      }

      if (item.total !== undefined && item.total !== null && item.total !== "") {
        const declaredTotal = new Prisma.Decimal(String(item.total));
        if (!declaredTotal.equals(quantity.mul(unitPrice))) {
          throw new UnprocessableEntityError(
            `DIRECT_OP_SERVICE_TOTAL_MISMATCH: Total informado (${declaredTotal}) difere de quantity * unitPrice (${quantity.mul(unitPrice)}).`
          );
        }
      }

      calculatedSum = calculatedSum.add(itemTotal);

      return {
        name: String(name),
        description: String(description),
        type: item.type || "pdr",
        quantity: quantity.toString(),
        unitPrice: unitPrice.toFixed(2),
        total: itemTotal.toFixed(2),
      };
    });

    totalAmount = calculatedSum.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  }

  // 5. Temporal calculation & boundaries
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: po.workspaceId },
    select: { timezone: true },
  });
  const timezone = workspace.timezone || "UTC";

  const deliveredAtDate = options?.deliveredAt
    ? new Date(options.deliveredAt)
    : po.deliveredAt || new Date();

  if (isNaN(deliveredAtDate.getTime())) {
    throw new UnprocessableEntityError("Data de entrega fornecida é inválida.");
  }

  const weekInfo = operationalWeekOf(deliveredAtDate, timezone);

  // 6. Execute atomic transaction
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Tenant-safe row locking on ProductionOrder
        const [locked] = await tx.$queryRaw<
          Array<{
            id: string;
            workspace_id: string;
            status: string;
            execution_sequence: number;
          }>
        >`
          SELECT id, workspace_id, status, execution_sequence
          FROM "production_orders"
          WHERE "id" = ${po.id} AND "workspace_id" = ${po.workspaceId}
          FOR UPDATE
        `;

        if (!locked) {
          throw new NotFoundError("Ordem de produção não encontrada sob lock.");
        }

        if (locked.status === "delivered") {
          const entry = await tx.weeklogEntry.findUnique({
            where: {
              productionOrderId_executionSequence: {
                productionOrderId: po.id,
                executionSequence: locked.execution_sequence,
              },
            },
            include: { weeklog: true },
          });
          if (entry) {
            return {
              productionOrder: po,
              weeklog: entry.weeklog,
              weeklogEntry: entry,
              idempotent: true,
            };
          }
          throw new ConflictError("Ordem de produção já entregue sem entrada de Weeklog.");
        }

        if (locked.status !== "in_production" && locked.status !== "paused") {
          throw new ConflictError(
            `Ordem de produção em status '${locked.status}' não pode ser finalizada.`
          );
        }

        // Update ProductionOrder status & deliveredAt
        const updatedPo = await tx.productionOrder.update({
          where: { id: po.id },
          data: {
            status: "delivered",
            deliveredAt: deliveredAtDate,
          },
        });

        // Upsert Weeklog Header
        const weeklog = await tx.weeklog.upsert({
          where: {
            workspaceId_startsOn_clientId_siteKey: {
              workspaceId: po.workspaceId,
              startsOn: weekInfo.startsOn,
              clientId: po.clientId!,
              siteKey: po.operationalSiteKey!,
            },
          },
          create: {
            workspaceId: po.workspaceId,
            startsOn: weekInfo.startsOn,
            endsOn: weekInfo.endsOn,
            clientId: po.clientId!,
            siteKey: po.operationalSiteKey!,
            timezone: weekInfo.timezone,
            week: weekInfo.week,
            weekNumber: weekInfo.weekNumber,
            yearReference: weekInfo.yearReference,
            status: "open",
          },
          update: {},
        });

        // Downstream ServiceOrder projection
        const legacyServiceOrder = await syncLegacyServiceOrderProjection(tx, {
          workspaceId: po.workspaceId,
          technicianUserId: po.technicianUserId || ctx.actorUserId,
          technicianName: po.technicianName || "",
          clientId: po.clientId,
          clientName: po.clientName || "",
          brand: po.brand,
          model: po.model,
          licensePlate: po.licensePlate,
          week: weekInfo.week,
          yearReference: weekInfo.yearReference,
          total: totalAmount,
          services: servicesSnapshot,
        });

        // Rectification linkage
        let rectificationOriginEntryId: string | null = null;
        let isRectification = false;
        if (po.executionSequence > 1) {
          const prevEntry = await tx.weeklogEntry.findFirst({
            where: {
              productionOrderId: po.id,
              executionSequence: po.executionSequence - 1,
            },
            select: { id: true },
          });
          if (prevEntry) {
            rectificationOriginEntryId = prevEntry.id;
            isRectification = true;
          }
        }

        // Create immutable WeeklogEntry snapshot
        const weeklogEntry = await tx.weeklogEntry.create({
          data: {
            weeklogId: weeklog.id,
            workspaceId: po.workspaceId,
            productionOrderId: po.id,
            executionSequence: po.executionSequence,
            budgetId: po.budgetId || null,
            budgetRevisionId: po.budgetRevisionId || null,
            legacyServiceOrderId: legacyServiceOrder.id,
            technicianUserId: po.technicianUserId || ctx.actorUserId,
            technicianName: po.technicianName || "",
            clientId: po.clientId!,
            clientName: po.clientName || "",
            brand: po.brand || null,
            model: po.model || null,
            color: po.color || null,
            licensePlate: po.licensePlate || null,
            vin: po.vin || null,
            servicesSnapshot: servicesSnapshot as any,
            totalAmount,
            currencyCode: resolvedCurrencyCode!,
            deliveredAt: deliveredAtDate,
            validationStatus: "pending",
            isRectification,
            rectificationOriginEntryId,
          },
        });

        // Link legacyServiceOrderId back to ProductionOrder
        await tx.productionOrder.update({
          where: { id: po.id },
          data: {
            serviceOrderId: legacyServiceOrder.id,
          },
        });

        // Sync document folders
        await syncPhotosToWeeklogFolders(tx, po, weekInfo, ctx.actorUserId);

        return {
          productionOrder: updatedPo,
          weeklog,
          weeklogEntry,
          idempotent: false,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      }
    );
  } catch (error: any) {
    if (error?.code === "P2002") {
      const target = error.meta?.target;
      const targetStr = Array.isArray(target) ? target.join(",") : String(target || "");

      // Case A: Duplicate on productionOrderId + executionSequence (concurrent idempotency)
      if (
        targetStr.includes("production_order_id") ||
        targetStr.includes("execution_sequence") ||
        error.message?.includes("production_order_id")
      ) {
        const existing = await prisma.weeklogEntry.findUnique({
          where: {
            productionOrderId_executionSequence: {
              productionOrderId: po.id,
              executionSequence: po.executionSequence,
            },
          },
          include: { weeklog: true },
        });

        if (existing) {
          const freshPo = await prisma.productionOrder.findUnique({ where: { id: po.id } });
          return {
            productionOrder: freshPo || po,
            weeklog: existing.weeklog,
            weeklogEntry: existing,
            idempotent: true,
          };
        }
      }

      // Case B: Duplicate on Weeklog header identity (concurrent header creation)
      if (
        targetStr.includes("workspace_id") ||
        targetStr.includes("starts_on") ||
        targetStr.includes("client_id") ||
        targetStr.includes("site_key") ||
        error.message?.includes("weeklogs_workspace_id_starts_on_client_id_site_key_key")
      ) {
        if (retryCount < 3) {
          return finalizeProductionOrder(ctx, orderId, options, retryCount + 1);
        }
      }

      // Re-throw any other P2002 without masking
      throw error;
    }

    throw error;
  }
}
