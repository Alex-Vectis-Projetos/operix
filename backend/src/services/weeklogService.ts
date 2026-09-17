import { randomUUID } from "node:crypto";
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

      // 4. Congelamento imutável da coverage (pode ser vazio se não houver ordens ainda)
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

/**
 * Valida autorização do validador via ClientAccessGrant no PostgreSQL.
 * A validação exige grant ativo para o workspaceId, userId e clientId especificados.
 */
export async function assertActiveClientAccessGrant(
  tx: Prisma.TransactionClient,
  ctx: RequestContext,
  clientId: string
): Promise<{ id: string; status: string; role: string }> {
  if (!ctx.activeWorkspaceId || !ctx.actorUserId) {
    throw new ForbiddenError("Contexto de autenticação incompleto.");
  }

  const grants: Array<{ id: string; status: string; role: string; revokedAt: Date | null }> =
    await tx.$queryRaw`
      SELECT id, status, role, revoked_at as "revokedAt"
      FROM client_access_grants
      WHERE workspace_id = ${ctx.activeWorkspaceId}
        AND user_id = ${ctx.actorUserId}
        AND client_id = ${clientId}
      FOR UPDATE
    `;

  if (!grants || grants.length === 0) {
    throw new ForbiddenError(
      "VALIDATOR_GRANT_REQUIRED: Validador não possui vínculo (ClientAccessGrant) com este cliente no workspace."
    );
  }

  const grant = grants[0];
  if (grant.status !== "active" || grant.revokedAt != null) {
    throw new ForbiddenError(
      "VALIDATOR_REVOKED: O vínculo de validação (ClientAccessGrant) para este cliente foi revogado."
    );
  }

  return grant;
}

export interface ReviewWeeklogEntryPayload {
  outcome?: "approved" | "rejected";
  validationStatus?: "approved" | "rejected";
  rejectionReason?: string | null;
}

/**
 * Realiza o review individual de uma WeeklogEntry por um validador autorizado do cliente.
 */
export async function reviewWeeklogEntry(
  ctx: RequestContext,
  weeklogId: string,
  entryId: string,
  payload: ReviewWeeklogEntryPayload
) {
  if (!ctx.activeWorkspaceId || !ctx.actorUserId) {
    throw new ForbiddenError("Workspace ativo ou usuário não definidos.");
  }

  const outcome = payload.outcome || payload.validationStatus;
  if (!outcome || (outcome !== "approved" && outcome !== "rejected")) {
    throw new UnprocessableEntityError(
      "OUTCOME_REQUIRED: O resultado da inspeção deve ser 'approved' ou 'rejected'."
    );
  }

  const trimmedReason = payload.rejectionReason?.trim();
  if (outcome === "rejected" && (!trimmedReason || trimmedReason.length === 0)) {
    throw new UnprocessableEntityError(
      "REJECTION_REASON_REQUIRED: A rejeição de um item exige a indicação de um motivo formal não-vazio."
    );
  }

  return await prisma.$transaction(
    async (tx) => {
      // 1. Carregar lote semanal
      const weeklog = await tx.weeklog.findUnique({
        where: { id: weeklogId },
      });

      if (!weeklog || weeklog.workspaceId !== ctx.activeWorkspaceId) {
        throw new NotFoundError("Lote de WEEKLOG não encontrado.");
      }

      if (weeklog.status === "validated") {
        throw new ConflictError(
          "VALIDATED_IMMUTABLE: O lote semanal já foi validado e suas entradas não aceitam modificação."
        );
      }

      if (weeklog.status !== "pending_validation") {
        throw new ConflictError(
          `WEEKLOG_NOT_PENDING_VALIDATION: O lote semanal está em estado '${weeklog.status}' e não aceita revisão de itens.`
        );
      }

      // 2. Validação de grant ativo para o cliente
      await assertActiveClientAccessGrant(tx, ctx, weeklog.clientId);

      // 3. Carregar entrada com lock
      const entries: any[] = await tx.$queryRaw`
        SELECT id, workspace_id as "workspaceId", weeklog_id as "weeklogId",
               technician_user_id as "technicianUserId", validation_status as "validationStatus"
        FROM weeklog_entries
        WHERE id = ${entryId}
        FOR UPDATE
      `;

      if (!entries || entries.length === 0) {
        throw new NotFoundError("Entrada de WEEKLOG não encontrada.");
      }

      const entry = entries[0];
      if (entry.workspaceId !== ctx.activeWorkspaceId || entry.weeklogId !== weeklogId) {
        throw new NotFoundError("Entrada de WEEKLOG não encontrada neste lote.");
      }

      // 4. Bloqueio de auto-validação: executor não pode validar o próprio serviço
      if (entry.technicianUserId === ctx.actorUserId) {
        throw new ForbiddenError(
          "VALIDATOR_SELF_FORBIDDEN: O executor do serviço não pode aprovar ou revisar o próprio trabalho."
        );
      }

      // 5. Imutabilidade do review: pending -> approved ou pending -> rejected apenas
      if (entry.validationStatus !== "pending") {
        throw new ConflictError(
          `ENTRY_ALREADY_REVIEWED: A entrada de WEEKLOG já foi revisada com status '${entry.validationStatus}' e não pode ter seu resultado alterado diretamente.`
        );
      }

      // 6. Atualizar entrada
      const updatedEntry = await tx.weeklogEntry.update({
        where: { id: entryId },
        data: {
          validationStatus: outcome,
          rejectionReason: outcome === "rejected" ? trimmedReason : null,
          reviewedAt: new Date(),
          reviewerUserId: ctx.actorUserId,
        },
      });

      // 7. Registrar evento de auditoria na rodada ativa
      const activeRound = await tx.weeklogValidation.findFirst({
        where: { weeklogId, status: "pending" },
        orderBy: { validationSequence: "desc" },
      });

      if (activeRound) {
        const audit = Array.isArray(activeRound.auditTrail) ? (activeRound.auditTrail as any[]) : [];
        audit.push({
          action: "entry_reviewed",
          entryId,
          outcome,
          reviewerUserId: ctx.actorUserId,
          timestamp: new Date().toISOString(),
        });

        await tx.weeklogValidation.update({
          where: { id: activeRound.id },
          data: { auditTrail: audit },
        });
      }

      return updatedEntry;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    }
  );
}

/**
 * Upload de assinatura gráfica em PNG com validação binária e governança de staging no MinIO.
 */
export async function uploadWeeklogSignature(
  ctx: RequestContext,
  weeklogId: string,
  fileBuffer: Buffer
) {
  if (!ctx.activeWorkspaceId || !ctx.actorUserId) {
    throw new ForbiddenError("Workspace ativo ou usuário não definidos.");
  }

  // 1. Carregar lote e verificar tenant
  const weeklog = await prisma.weeklog.findUnique({
    where: { id: weeklogId },
  });

  if (!weeklog || weeklog.workspaceId !== ctx.activeWorkspaceId) {
    throw new NotFoundError("Lote de WEEKLOG não encontrado.");
  }

  // 2. Imutabilidade pós-validação: se já validado, retorna 409
  if (weeklog.status === "validated") {
    throw new ConflictError(
      "SIGNATURE_IMMUTABLE_AFTER_VALIDATION: O lote semanal já foi validado e não aceita novos uploads de assinatura."
    );
  }

  if (weeklog.status !== "pending_validation") {
    throw new ConflictError(
      `WEEKLOG_NOT_PENDING_VALIDATION: O lote está em estado '${weeklog.status}' e não aceita upload de assinatura.`
    );
  }

  // 3. Validação de grant ativo do validador
  await prisma.$transaction(async (tx) => {
    await assertActiveClientAccessGrant(tx, ctx, weeklog.clientId);
  });

  // 4. Salvar arquivo no storage sob caminho de staging governado
  const { saveStagingSignature } = await import("../lib/weeklogStorage.js");
  const stagingKey = await saveStagingSignature(ctx.activeWorkspaceId, weeklogId, fileBuffer);

  return {
    signatureStoragePath: stagingKey,
    uploadedAt: new Date().toISOString(),
  };
}

export interface ValidateWeeklogBatchPayload {
  validationMethod: "authenticated_confirmation" | "drawn_signature";
  signatureStoragePath?: string | null;
}

/**
 * Conclui a Validation Round pendente do lote semanal, aplicando regras de
 * anti-self-validation, integridade de coverage, governança de assinatura e zero efeito financeiro.
 */
export async function validateWeeklogBatch(
  ctx: RequestContext,
  weeklogId: string,
  payload: ValidateWeeklogBatchPayload
) {
  if (!ctx.activeWorkspaceId || !ctx.actorUserId) {
    throw new ForbiddenError("Workspace ativo ou usuário não definidos.");
  }
  const workspaceId = ctx.activeWorkspaceId;
  const actorUserId = ctx.actorUserId;

  if (
    !payload ||
    (payload.validationMethod !== "authenticated_confirmation" &&
      payload.validationMethod !== "drawn_signature")
  ) {
    throw new UnprocessableEntityError(
      "VALIDATION_METHOD_REQUIRED: O método de validação deve ser 'authenticated_confirmation' ou 'drawn_signature'."
    );
  }

  const {
    assertStagingSignaturePath,
    assertSignatureExists,
    promoteStagingToFinalSignature,
    deleteStagingSignatureBestEffort,
  } = await import("../lib/weeklogStorage.js");

  let finalSignaturePath: string | null = null;
  let stagingKeyToDelete: string | null = null;

  // A & B. Validar e promover arquivo de assinatura FORA da transação do banco (evita I/O de storage em lock de DB)
  if (payload.validationMethod === "drawn_signature") {
    if (!payload.signatureStoragePath || !payload.signatureStoragePath.trim()) {
      throw new UnprocessableEntityError(
        "SIGNATURE_REQUIRED: O método 'drawn_signature' exige o envio de signatureStoragePath previamente carregado."
      );
    }

    const stagingKey = payload.signatureStoragePath.trim();
    assertStagingSignaturePath(workspaceId, weeklogId, stagingKey);
    await assertSignatureExists(stagingKey);

    // Identificar a rodada pendente alvo para chave definitiva determinística
    const existingPendingRound = await prisma.weeklogValidation.findFirst({
      where: {
        weeklogId,
        workspaceId,
        status: "pending",
      },
      orderBy: { validationSequence: "desc" },
      select: { id: true },
    });

    const targetRoundId = existingPendingRound?.id || randomUUID();

    finalSignaturePath = await promoteStagingToFinalSignature(
      workspaceId,
      weeklogId,
      stagingKey,
      targetRoundId
    );
    stagingKeyToDelete = stagingKey;
  }

  // C. Transação CURTA puramente relacional
  const result = await prisma.$transaction(
    async (tx) => {
      // 1. Lock pessimista no cabeçalho do Weeklog
      const lockedWeeklogs: any[] = await tx.$queryRaw`
        SELECT id, workspace_id as "workspaceId", status, client_id as "clientId"
        FROM weeklogs
        WHERE id = ${weeklogId} AND workspace_id = ${workspaceId}
        FOR UPDATE
      `;

      if (!lockedWeeklogs || lockedWeeklogs.length === 0) {
        throw new NotFoundError("Lote de WEEKLOG não encontrado.");
      }

      const weeklog = lockedWeeklogs[0];

      // 2. Se já validado: verificar idempotência
      if (weeklog.status === "validated") {
        const latestValidation = await tx.weeklogValidation.findFirst({
          where: { weeklogId, workspaceId, status: "validated" },
          orderBy: { validationSequence: "desc" },
        });

        // Se a chamada foi feita pelo mesmo validador com o mesmo método -> Retorno idempotente
        if (
          latestValidation &&
          latestValidation.validatorUserId === actorUserId &&
          latestValidation.validationMethod === payload.validationMethod
        ) {
          return {
            weeklog,
            validationRound: latestValidation,
            idempotent: true,
          };
        }

        throw new ConflictError(
          "WEEKLOG_ALREADY_VALIDATED: O lote semanal já foi validado e não aceita nova validação."
        );
      }

      if (weeklog.status !== "pending_validation") {
        throw new ConflictError(
          `WEEKLOG_NOT_PENDING_VALIDATION: O lote semanal está em estado '${weeklog.status}' e não pode ser validado.`
        );
      }

      // 3. Validar e travar o ClientAccessGrant ativo (evita race de revogação)
      await assertActiveClientAccessGrant(tx, ctx, weeklog.clientId);

      // 4. Localizar a MESMA Validation Round em estado 'pending'
      let activeRound = await tx.weeklogValidation.findFirst({
        where: {
          weeklogId,
          workspaceId,
          status: "pending",
        },
        orderBy: { validationSequence: "desc" },
      });

      // Se a rodada pendente não existe (e.g. teste direto em pending_validation sem submit),
      // provisiona a rodada inicial para completá-la
      if (!activeRound) {
        const latestValidation = await tx.weeklogValidation.findFirst({
          where: { weeklogId },
          orderBy: { validationSequence: "desc" },
          select: { validationSequence: true },
        });
        const nextSeq = (latestValidation?.validationSequence ?? 0) + 1;

        const currentEntries = await tx.weeklogEntry.findMany({
          where: { weeklogId, workspaceId },
        });

        const initialCoverage = currentEntries.map((e) => ({
          weeklogEntryId: e.id,
          productionOrderId: e.productionOrderId,
          executionSequence: e.executionSequence,
          validationStatus: e.validationStatus,
          totalAmount: e.totalAmount.toString(),
          currencyCode: e.currencyCode,
        }));

        activeRound = await tx.weeklogValidation.create({
          data: {
            weeklogId,
            workspaceId,
            validationSequence: nextSeq,
            status: "pending",
            submittedAt: new Date(),
            submittedBy: actorUserId,
            coverageSnapshot: initialCoverage,
            auditTrail: [
              {
                action: "submitted_for_validation",
                actorUserId,
                timestamp: new Date().toISOString(),
              },
            ],
          },
        });
      }

      // Extrair IDs das entradas congeladas na coverage
      const coverage = Array.isArray(activeRound.coverageSnapshot)
        ? (activeRound.coverageSnapshot as any[])
        : [];
      const coveredEntryIds = coverage.map((c) => c.weeklogEntryId).filter(Boolean);

      const coveredEntries = await tx.weeklogEntry.findMany({
        where: {
          id: { in: coveredEntryIds },
          workspaceId,
        },
      });

      // 5. Verificar autoridade contra auto-validação em lote (Zero Trust / 403 antes de pré-condições 409)
      const executorMatch = coveredEntries.some(
        (e) => e.technicianUserId === actorUserId
      );
      if (executorMatch) {
        throw new ForbiddenError(
          "VALIDATOR_BATCH_SELF_FORBIDDEN: O validador executou ordens de produção vinculadas a este lote semanal e não pode validá-lo."
        );
      }

      const anySelfEntry = await tx.weeklogEntry.findFirst({
        where: {
          weeklogId,
          workspaceId,
          technicianUserId: actorUserId,
        },
      });
      if (anySelfEntry) {
        throw new ForbiddenError(
          "VALIDATOR_BATCH_SELF_FORBIDDEN: O validador executou ordens de produção vinculadas a este lote semanal e não pode validá-lo."
        );
      }

      // 6. Verificar se todas as entradas cobertas foram revisadas
      const unreviewedCount = coveredEntries.filter(
        (e) => e.validationStatus === "pending"
      ).length;

      if (unreviewedCount > 0) {
        throw new ConflictError(
          `VALIDATION_REVIEW_INCOMPLETE: Existem ${unreviewedCount} item(ns) de WEEKLOG na cobertura desta rodada com status de validação ainda pendente. Todos os itens devem ser aprovados ou rejeitados antes de validar o lote.`
        );
      }

      // 6.1 Verificar se há pelo menos um item rejeitado
      const hasRejectedEntries = coveredEntries.some(
        (e) => e.validationStatus === "rejected"
      );

      // 6. Atualizar a MESMA rodada de validação para status 'validated'
      const audit = Array.isArray(activeRound.auditTrail) ? (activeRound.auditTrail as any[]) : [];
      audit.push({
        action: "validation_completed",
        validatorUserId: actorUserId,
        validationMethod: payload.validationMethod,
        timestamp: new Date().toISOString(),
      });

      const completedRound = await tx.weeklogValidation.update({
        where: { id: activeRound.id },
        data: {
          status: "validated",
          validatorUserId: actorUserId,
          validationMethod: payload.validationMethod,
          validatedAt: new Date(),
          signatureStoragePath: finalSignaturePath,
          auditTrail: audit,
        },
      });

      // 7. Determinar status final do cabeçalho do Weeklog
      let finalHeaderStatus = "validated";

      if (hasRejectedEntries) {
        // Caso B: pelo menos um item rejeitado -> vai para retificação pendente
        finalHeaderStatus = "rectification_pending";
      } else {
        // Verificar se existem novas ordens adicionadas após o submit (fora da coverage)
        const uncoveredPendingCount = await tx.weeklogEntry.count({
          where: {
            weeklogId,
            workspaceId,
            id: { notIn: coveredEntryIds },
            validationStatus: "pending",
          },
        });

        if (uncoveredPendingCount > 0) {
          // Caso C: existem ordens novas não cobertas -> lote volta para 'open'
          finalHeaderStatus = "open";
        } else {
          // Caso A: todas cobertas e aprovadas -> lote validado
          finalHeaderStatus = "validated";
        }
      }

      const updatedWeeklog = await tx.weeklog.update({
        where: { id: weeklogId },
        data: { status: finalHeaderStatus },
      });

      return {
        weeklog: updatedWeeklog,
        validationRound: completedRound,
        idempotent: false,
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    }
  );

  // 8. Limpeza best-effort do arquivo temporário FORA da transação
  if (stagingKeyToDelete) {
    await deleteStagingSignatureBestEffort(stagingKeyToDelete);
  }

  return result;
}

