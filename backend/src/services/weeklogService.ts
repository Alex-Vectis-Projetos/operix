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
  /**
   * Internal test seam / clock injection for deterministic testing.
   * NEVER exposed to public HTTP callers or client payloads.
   */
  _serverTime?: Date;
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
    console.error("[weeklogService] syncPhotosToWeeklogFolders error:", err);
  }
}

/**
 * Downstream Legacy Projection Adapter.
 *
 * NOTA ARQUITETURAL: A tabela legacy `service_orders` possui colunas físicas
 * limitadas para apenas 4 serviços (service1Name..service4Price).
 * Se `servicesSnapshot` contiver mais de 4 serviços (>4), `WeeklogEntry.servicesSnapshot`
 * (Source of Truth) preserva a totalidade dos itens sem qualquer truncamento.
 * A projeção legada apenas preenche os 4 primeiros slots disponíveis e reflete
 * o `total` integral.
 */
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
 *
 * HARDENED INVARIANTS:
 * - Pure Server-Side Authority for deliveredAt (Zero client payload authority).
 * - Locked Source of Truth: All authorization, preconditions, snapshot, and projections
 *   are read transaction-locally AFTER acquiring the SELECT ... FOR UPDATE row lock.
 * - Budget Lineage Validation: Only approved budget revisions can originate a WEEKLOG entry.
 * - External P2002 recovery: Aborted transactions are never reused.
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

  // 1. Transaction-local execution under pessimistic row lock
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Step 1.1: Acquire pessimistic tenant-safe row lock on ProductionOrder
        const [lockedRow] = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id
          FROM "production_orders"
          WHERE "id" = ${orderId} AND "workspace_id" = ${ctx.activeWorkspaceId}
          FOR UPDATE
        `;

        if (!lockedRow) {
          throw new NotFoundError("Ordem de produção não encontrada.");
        }

        // Step 1.2: Re-read fresh, transaction-local ProductionOrder under lock (Locked Source of Truth)
        const currentPo = await tx.productionOrder.findUnique({
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

        if (!currentPo || currentPo.workspaceId !== ctx.activeWorkspaceId) {
          throw new NotFoundError("Ordem de produção não encontrada.");
        }

        // Step 1.3: Authorize on fresh locked object (prevents reassign/ownership race)
        assertTenantAccess(ctx, currentPo.workspaceId);
        assertObjectAccess(ctx, currentPo);

        // Step 1.4: Check idempotency on current execution sequence under lock
        if (currentPo.status === "delivered") {
          const existingEntry = await tx.weeklogEntry.findUnique({
            where: {
              productionOrderId_executionSequence: {
                productionOrderId: currentPo.id,
                executionSequence: currentPo.executionSequence,
              },
            },
            include: {
              weeklog: true,
            },
          });

          if (existingEntry) {
            return {
              productionOrder: currentPo,
              weeklog: existingEntry.weeklog,
              weeklogEntry: existingEntry,
              idempotent: true,
            };
          }
          throw new ConflictError(
            "Ordem de produção já entregue sem entrada de Weeklog correspondente."
          );
        }

        // Step 1.5: Validate permitted status transitions
        if (currentPo.status !== "in_production" && currentPo.status !== "paused") {
          throw new ConflictError(
            `Ordem de produção com status '${currentPo.status}' não pode ser finalizada. Estados permitidos: in_production, paused.`
          );
        }

        // Step 1.6: Validate domain preconditions on fresh locked object
        if (!currentPo.clientId) {
          throw new UnprocessableEntityError("CLIENT_REQUIRED: Ordem de produção sem cliente canônico.");
        }

        if (!currentPo.operationalSiteKey) {
          throw new UnprocessableEntityError(
            "OPERATIONAL_SITE_REQUIRED: Ordem de produção sem local operacional (siteKey)."
          );
        }

        // Step 1.7: Currency resolution & Budget lineage validation
        let resolvedCurrencyCode: string | null = null;
        let servicesSnapshot: any[] = [];
        let totalAmount: Prisma.Decimal = new Prisma.Decimal(0);

        if (currentPo.budgetId) {
          // Budget-originated OP
          const budget = currentPo.budget;
          if (!budget || budget.workspaceId !== ctx.activeWorkspaceId || budget.id !== currentPo.budgetId) {
            throw new UnprocessableEntityError("BUDGET_LINEAGE_INVALID: Orçamento vinculado inválido ou inexistente.");
          }

          if (!currentPo.budgetRevisionId) {
            throw new UnprocessableEntityError("BUDGET_LINEAGE_INVALID: Ordem de produção sem revisão de orçamento vinculada.");
          }

          const revision = currentPo.budgetRevision;
          if (!revision || revision.budgetId !== budget.id || revision.id !== currentPo.budgetRevisionId) {
            throw new UnprocessableEntityError("BUDGET_LINEAGE_INVALID: Revisão vinculada não pertence ao orçamento.");
          }

          // Strict Domain Invariant: Only approved budget revisions can originate WEEKLOG
          if (budget.approvedRevisionId !== currentPo.budgetRevisionId || revision.status !== "approved") {
            throw new UnprocessableEntityError(
              "UNAPPROVED_BUDGET_REVISION: Apenas revisão de orçamento aprovada pode gerar WEEKLOG final."
            );
          }

          resolvedCurrencyCode = revision.currencyCode || null;
          if (!resolvedCurrencyCode || !/^[A-Z]{3}$/.test(resolvedCurrencyCode)) {
            throw new UnprocessableEntityError(
              "CURRENCY_REQUIRED: Código de moeda canônico ausente ou inválido na revisão do orçamento."
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
          resolvedCurrencyCode = currentPo.currencyCode || null;
          if (!resolvedCurrencyCode || !/^[A-Z]{3}$/.test(resolvedCurrencyCode)) {
            throw new UnprocessableEntityError(
              "CURRENCY_REQUIRED: Código de moeda canônico ausente ou inválido na ordem direta."
            );
          }

          const rawServices = currentPo.performedServices;
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

        // Step 1.8: Server-side Timestamp Authority & Operational Week
        const workspace = await tx.workspace.findUniqueOrThrow({
          where: { id: currentPo.workspaceId },
          select: { timezone: true },
        });
        const timezone = workspace.timezone || "UTC";

        // Pure server-side authority: client body cannot pick delivery time
        const serverDeliveredAt = options?._serverTime || new Date();
        const weekInfo = operationalWeekOf(serverDeliveredAt, timezone);

        // Step 1.9: Update ProductionOrder to delivered
        const updatedPo = await tx.productionOrder.update({
          where: { id: currentPo.id },
          data: {
            status: "delivered",
            deliveredAt: serverDeliveredAt,
          },
        });

        // Step 1.10: Upsert Weeklog Header
        const weeklog = await tx.weeklog.upsert({
          where: {
            workspaceId_startsOn_clientId_siteKey: {
              workspaceId: currentPo.workspaceId,
              startsOn: weekInfo.startsOn,
              clientId: currentPo.clientId!,
              siteKey: currentPo.operationalSiteKey!,
            },
          },
          create: {
            workspaceId: currentPo.workspaceId,
            startsOn: weekInfo.startsOn,
            endsOn: weekInfo.endsOn,
            clientId: currentPo.clientId!,
            siteKey: currentPo.operationalSiteKey!,
            timezone: weekInfo.timezone,
            week: weekInfo.week,
            weekNumber: weekInfo.weekNumber,
            yearReference: weekInfo.yearReference,
            status: "open",
          },
          update: {},
        });

        // Step 1.11: Downstream ServiceOrder projection
        const legacyServiceOrder = await syncLegacyServiceOrderProjection(tx, {
          workspaceId: currentPo.workspaceId,
          technicianUserId: currentPo.technicianUserId || ctx.actorUserId,
          technicianName: currentPo.technicianName || "",
          clientId: currentPo.clientId,
          clientName: currentPo.clientName || "",
          brand: currentPo.brand,
          model: currentPo.model,
          licensePlate: currentPo.licensePlate,
          week: weekInfo.week,
          yearReference: weekInfo.yearReference,
          total: totalAmount,
          services: servicesSnapshot,
        });

        // Step 1.12: Rectification linkage
        let rectificationOriginEntryId: string | null = null;
        let isRectification = false;
        if (currentPo.executionSequence > 1) {
          const prevEntry = await tx.weeklogEntry.findFirst({
            where: {
              productionOrderId: currentPo.id,
              executionSequence: currentPo.executionSequence - 1,
            },
            select: { id: true },
          });
          if (prevEntry) {
            rectificationOriginEntryId = prevEntry.id;
            isRectification = true;
          }
        }

        // Step 1.13: Create immutable WeeklogEntry snapshot
        const weeklogEntry = await tx.weeklogEntry.create({
          data: {
            weeklogId: weeklog.id,
            workspaceId: currentPo.workspaceId,
            productionOrderId: currentPo.id,
            executionSequence: currentPo.executionSequence,
            budgetId: currentPo.budgetId || null,
            budgetRevisionId: currentPo.budgetRevisionId || null,
            legacyServiceOrderId: legacyServiceOrder.id,
            technicianUserId: currentPo.technicianUserId || ctx.actorUserId,
            technicianName: currentPo.technicianName || "",
            clientId: currentPo.clientId!,
            clientName: currentPo.clientName || "",
            brand: currentPo.brand || null,
            model: currentPo.model || null,
            color: currentPo.color || null,
            licensePlate: currentPo.licensePlate || null,
            vin: currentPo.vin || null,
            servicesSnapshot: servicesSnapshot as any,
            totalAmount,
            currencyCode: resolvedCurrencyCode!,
            deliveredAt: serverDeliveredAt,
            validationStatus: "pending",
            isRectification,
            rectificationOriginEntryId,
          },
        });

        // Step 1.14: Link legacyServiceOrderId back to ProductionOrder
        await tx.productionOrder.update({
          where: { id: currentPo.id },
          data: {
            serviceOrderId: legacyServiceOrder.id,
          },
        });

        // Step 1.15: Sync document folders
        await syncPhotosToWeeklogFolders(tx, currentPo, weekInfo, ctx.actorUserId);

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
              productionOrderId: orderId,
              executionSequence: (
                await prisma.productionOrder.findUnique({
                  where: { id: orderId },
                  select: { executionSequence: true },
                })
              )?.executionSequence ?? 1,
            },
          },
          include: { weeklog: true },
        });

        if (existing) {
          const freshPo = await prisma.productionOrder.findUnique({ where: { id: orderId } });
          return {
            productionOrder: freshPo,
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

export interface WeeklogListFilters {
  startsOn?: string | Date;
  clientId?: string;
  status?: string;
  siteKey?: string;
}

/**
 * Lista lotes de WEEKLOG do workspace ativo com filtros canônicos.
 * Aplica segregação estrita por tenant e escopo de técnico ('scope: own').
 */
export async function listWeeklogs(
  ctx: RequestContext,
  filters: WeeklogListFilters = {}
) {
  if (!ctx.activeWorkspaceId) {
    throw new ForbiddenError("Workspace ativo não definido.");
  }

  const isTechnicianScope =
    ctx.membershipRole === "technician" && ctx.scope === "workspace";

  const where: Prisma.WeeklogWhereInput = {
    workspaceId: ctx.activeWorkspaceId,
  };

  if (filters.clientId) {
    where.clientId = filters.clientId;
  }
  if (filters.status) {
    where.status = filters.status;
  }
  if (filters.siteKey) {
    where.siteKey = filters.siteKey;
  }
  if (filters.startsOn) {
    where.startsOn = new Date(filters.startsOn);
  }

  if (isTechnicianScope) {
    where.entries = {
      some: {
        technicianUserId: ctx.actorUserId,
      },
    };
  }

  const weeklogs = await prisma.weeklog.findMany({
    where,
    include: {
      validations: {
        orderBy: { validationSequence: "desc" },
        take: 1,
      },
      entries: isTechnicianScope
        ? {
            where: { technicianUserId: ctx.actorUserId },
            orderBy: { executionSequence: "asc" },
          }
        : {
            orderBy: { executionSequence: "asc" },
          },
    },
    orderBy: [{ startsOn: "desc" }, { createdAt: "desc" }],
  });

  return weeklogs;
}

/**
 * Retorna um lote de WEEKLOG por ID com validação estrita de tenant e técnico.
 */
export async function getWeeklogById(ctx: RequestContext, id: string) {
  if (!ctx.activeWorkspaceId) {
    throw new ForbiddenError("Workspace ativo não definido.");
  }

  const weeklog = await prisma.weeklog.findUnique({
    where: { id },
    include: {
      validations: {
        orderBy: { validationSequence: "asc" },
      },
      entries: {
        orderBy: { executionSequence: "asc" },
      },
    },
  });

  if (!weeklog || weeklog.workspaceId !== ctx.activeWorkspaceId) {
    throw new NotFoundError("Lote de WEEKLOG não encontrado.");
  }

  const isTechnicianScope =
    ctx.membershipRole === "technician" && ctx.scope === "workspace";

  if (isTechnicianScope) {
    const ownEntries = weeklog.entries.filter(
      (e) => e.technicianUserId === ctx.actorUserId
    );
    if (ownEntries.length === 0) {
      throw new NotFoundError("Lote de WEEKLOG não encontrado.");
    }
    return {
      ...weeklog,
      entries: ownEntries,
    };
  }

  return weeklog;
}

/**
 * Retorna as entradas autorizadas de um WEEKLOG específico.
 */
export async function getWeeklogEntries(ctx: RequestContext, weeklogId: string) {
  if (!ctx.activeWorkspaceId) {
    throw new ForbiddenError("Workspace ativo não definido.");
  }

  const weeklog = await prisma.weeklog.findUnique({
    where: { id: weeklogId },
  });

  if (!weeklog || weeklog.workspaceId !== ctx.activeWorkspaceId) {
    throw new NotFoundError("Lote de WEEKLOG não encontrado.");
  }

  const isTechnicianScope =
    ctx.membershipRole === "technician" && ctx.scope === "workspace";

  const entries = await prisma.weeklogEntry.findMany({
    where: {
      weeklogId,
      workspaceId: ctx.activeWorkspaceId,
      ...(isTechnicianScope ? { technicianUserId: ctx.actorUserId } : {}),
    },
    orderBy: { executionSequence: "asc" },
  });

  if (isTechnicianScope && entries.length === 0) {
    throw new ForbiddenError("Acesso negado: nenhum item autorizado encontrado.");
  }

  return entries;
}

/**
 * Retorna uma entrada específica de WEEKLOG garantindo parentesco e tenant.
 */
export async function getWeeklogEntryById(
  ctx: RequestContext,
  weeklogId: string,
  entryId: string
) {
  if (!ctx.activeWorkspaceId) {
    throw new ForbiddenError("Workspace ativo não definido.");
  }

  const entry = await prisma.weeklogEntry.findUnique({
    where: { id: entryId },
  });

  if (!entry || entry.workspaceId !== ctx.activeWorkspaceId || entry.weeklogId !== weeklogId) {
    throw new NotFoundError("Entrada de WEEKLOG não encontrada.");
  }

  assertObjectAccess(ctx, entry);

  return entry;
}

/**
 * Submete um lote de WEEKLOG para validação congelando a cobertura da rodada.
 * Transição atômica: open | rectification_pending -> pending_validation.
 * Idempotente para retries na mesma rodada com status pending_validation.
 */
export async function submitWeeklogForValidation(
  ctx: RequestContext,
  weeklogId: string
) {
  if (!ctx.activeWorkspaceId) {
    throw new ForbiddenError("Workspace ativo não definido.");
  }

  // Autoridade: Apenas gestores, administradores ou owners podem submeter o lote semanal
  if (ctx.membershipRole === "technician") {
    throw new ForbiddenError("Apenas gestores ou administradores podem submeter o lote semanal para validação.");
  }

  return await prisma.$transaction(
    async (tx) => {
      // 1. Lock pessimista no cabeçalho do Weeklog
      const lockedRows: any[] = await tx.$queryRaw`
        SELECT id, workspace_id as "workspaceId", status, client_id as "clientId", site_key as "siteKey"
        FROM weeklogs
        WHERE id = ${weeklogId} AND workspace_id = ${ctx.activeWorkspaceId}
        FOR UPDATE
      `;

      if (!lockedRows || lockedRows.length === 0) {
        throw new NotFoundError("Lote de WEEKLOG não encontrado.");
      }

      const currentWl = lockedRows[0];

      // 2. State machine & idempotência
      if (currentWl.status === "pending_validation") {
        const activeRound = await tx.weeklogValidation.findFirst({
          where: {
            weeklogId,
            workspaceId: ctx.activeWorkspaceId,
            status: "pending",
          },
          orderBy: { validationSequence: "desc" },
        });

        const fullWl = await tx.weeklog.findUnique({ where: { id: weeklogId } });

        return {
          weeklog: fullWl,
          validationRound: activeRound,
          coverageSnapshot: activeRound?.coverageSnapshot,
          status: "pending_validation",
          idempotent: true,
        };
      }

      if (currentWl.status !== "open" && currentWl.status !== "rectification_pending") {
        throw new ConflictError(
          `WEEKLOG_INVALID_STATE_FOR_SUBMISSION: Lote em estado '${currentWl.status}' não pode ser submetido para validação.`
        );
      }

      // 3. Carregar entradas elegíveis para submission
      const eligibleEntries = await tx.weeklogEntry.findMany({
        where: {
          weeklogId,
          workspaceId: ctx.activeWorkspaceId,
          validationStatus: "pending",
        },
        orderBy: { executionSequence: "asc" },
      });

      if (eligibleEntries.length === 0) {
        throw new UnprocessableEntityError(
          "EMPTY_WEEKLOG_CANNOT_BE_SUBMITTED: O lote semanal não possui ordens de produção pendentes para validação."
        );
      }

      // 4. Congelamento imutável da coverage
      const coverageSnapshot = eligibleEntries.map((e) => ({
        weeklogEntryId: e.id,
        productionOrderId: e.productionOrderId,
        executionSequence: e.executionSequence,
        validationStatus: e.validationStatus,
        totalAmount: e.totalAmount.toString(),
        currencyCode: e.currencyCode,
      }));

      // 5. Determinar sequência da rodada de validação
      const latestValidation = await tx.weeklogValidation.findFirst({
        where: { weeklogId },
        orderBy: { validationSequence: "desc" },
        select: { validationSequence: true },
      });
      const nextSequence = (latestValidation?.validationSequence ?? 0) + 1;

      // 6. Criar registro versionado WeeklogValidation em estado pending
      const validationRound = await tx.weeklogValidation.create({
        data: {
          weeklogId,
          workspaceId: ctx.activeWorkspaceId!,
          validationSequence: nextSequence,
          status: "pending",
          submittedAt: new Date(),
          submittedBy: ctx.actorUserId,
          coverageSnapshot,
          auditTrail: [
            {
              action: "submitted_for_validation",
              actorUserId: ctx.actorUserId,
              timestamp: new Date().toISOString(),
            },
          ],
        },
      });

      // 7. Atualizar status do cabeçalho
      const updatedWeeklog = await tx.weeklog.update({
        where: { id: weeklogId },
        data: { status: "pending_validation" },
      });

      return {
        weeklog: updatedWeeklog,
        validationRound,
        coverageSnapshot,
        status: "pending_validation",
        idempotent: false,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    }
  );
}
