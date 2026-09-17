import { prisma } from "../src/lib/prisma.js";
import { operationalWeekOf } from "../src/lib/weekUtils.js";
import { Prisma } from "../src/services/weeklogService.js";

export interface BackfillOptions {
  apply?: boolean;
  workspaceId?: string;
}

export interface BackfillReport {
  scanned: number;
  alreadyCanonical: number;
  eligible: number;
  wouldCreate: number;
  created: number;
  skippedAmbiguous: number;
  skippedMissingWorkspace: number;
  skippedMissingClient: number;
  skippedMissingSite: number;
  skippedMissingCurrency: number;
  skippedMissingServices: number;
  skippedNotDelivered: number;
  errors: Array<{ id: string; error: string }>;
}

/**
 * Script canônico de Backfill determinístico de ServiceOrders legadas para o novo modelo de WEEKLOG.
 *
 * REGRAS DE SEGURANÇA (Spec 003 T08):
 * 1. Default DRY-RUN (zero writes); execução real exige flag explícita `apply: true` ou `--apply`.
 * 2. Somente mapeia registros com prova determinística comprovada no schema (ProductionOrder.serviceOrderId).
 * 3. Nunca mapeia por heurística de placa, VIN ou nome aproximado.
 * 4. Não sobrescreve registros canônicos existentes (idempotente e restart-safe).
 * 5. Não fabrica dados obrigatórios (se faltar siteKey, currencyCode, client ou services, classifica como SKIP e preserva como Legacy Archive).
 * 6. Zero efeitos financeiros colaterais (nunca cria PaymentOrder, listName ou FinancialRecord).
 */
export async function backfillLegacyServiceOrders(
  options: BackfillOptions = {}
): Promise<BackfillReport> {
  const isApply = Boolean(options.apply);

  const report: BackfillReport = {
    scanned: 0,
    alreadyCanonical: 0,
    eligible: 0,
    wouldCreate: 0,
    created: 0,
    skippedAmbiguous: 0,
    skippedMissingWorkspace: 0,
    skippedMissingClient: 0,
    skippedMissingSite: 0,
    skippedMissingCurrency: 0,
    skippedMissingServices: 0,
    skippedNotDelivered: 0,
    errors: [],
  };

  const where: Record<string, unknown> = {
    deletedAt: null,
  };
  if (options.workspaceId) {
    where.workspaceId = options.workspaceId;
  }

  const serviceOrders = await prisma.serviceOrder.findMany({
    where,
    orderBy: { createdAt: "asc" },
  });

  report.scanned = serviceOrders.length;

  for (const so of serviceOrders) {
    try {
      if (!so.workspaceId) {
        report.skippedMissingWorkspace++;
        continue;
      }

      // 1. Verificar se já é canônico através de WeeklogEntry vinculada
      const existingEntryForSo = await prisma.weeklogEntry.findFirst({
        where: { legacyServiceOrderId: so.id },
      });

      if (existingEntryForSo) {
        report.alreadyCanonical++;
        continue;
      }

      // 2. Busca determinística: ProductionOrder que aponte para este serviceOrderId
      const matchingProductionOrders = await prisma.productionOrder.findMany({
        where: {
          workspaceId: so.workspaceId,
          serviceOrderId: so.id,
        },
      });

      // Mapeamento só ocorre se houver exatamente uma relação formal unívoca
      if (matchingProductionOrders.length === 0 || matchingProductionOrders.length > 1) {
        report.skippedAmbiguous++;
        continue;
      }

      const po = matchingProductionOrders[0];

      // Verificar se a ProductionOrder já possui WeeklogEntry
      const existingEntryForPo = await prisma.weeklogEntry.findFirst({
        where: {
          productionOrderId: po.id,
          executionSequence: po.executionSequence,
        },
      });

      if (existingEntryForPo) {
        report.alreadyCanonical++;
        continue;
      }

      // 3. Validação estrita de pré-condições canônicas (sem fabricação de dados)
      const resolvedClientId = po.clientId || so.clientId;
      if (!resolvedClientId) {
        report.skippedMissingClient++;
        continue;
      }

      const client = await prisma.client.findFirst({
        where: { id: resolvedClientId, workspaceId: so.workspaceId, deletedAt: null },
      });
      if (!client) {
        report.skippedMissingClient++;
        continue;
      }

      if (!po.operationalSiteKey || po.operationalSiteKey.trim().length === 0) {
        report.skippedMissingSite++;
        continue;
      }

      const currency = po.currencyCode?.trim()?.toUpperCase();
      if (!currency || !/^[A-Z]{3}$/.test(currency)) {
        report.skippedMissingCurrency++;
        continue;
      }

      // Resolução dos serviços estruturados
      let resolvedServices: any[] = [];
      if (Array.isArray(po.performedServices) && po.performedServices.length > 0) {
        resolvedServices = po.performedServices;
      } else {
        // Tenta montar serviços das colunas legadas da serviceOrder
        for (let i = 1; i <= 4; i++) {
          const name = (so as any)[`service${i}Name`];
          const price = (so as any)[`service${i}Price`];
          if (name && String(name).trim()) {
            resolvedServices.push({
              code: `SERV-0${i}`,
              description: String(name).trim(),
              quantity: 1,
              unitPrice: price ? String(price) : "0.00",
              total: price ? String(price) : "0.00",
            });
          }
        }
      }

      if (resolvedServices.length === 0) {
        report.skippedMissingServices++;
        continue;
      }

      // 3.5. Validação estrita de conclusão de execução (T08 Targeted Hardening)
      // ProductionOrder deve representar execução concluída: deliveredAt válido e status == 'delivered'
      if (!po.deliveredAt || po.status !== "delivered") {
        report.skippedNotDelivered++;
        continue;
      }

      const resolvedTotal = new Prisma.Decimal(po.budgetRevisionId ? 0 : so.total ?? 0);
      const resolvedDeliveredAt = po.deliveredAt;
      const resolvedTechUserId = po.technicianUserId || so.assignedUserId || so.userId;

      // 4. Elegível para migração determinística
      report.eligible++;

      if (!isApply) {
        report.wouldCreate++;
        continue;
      }

      // 5. Aplicação atômica transacional por linha
      await prisma.$transaction(
        async (tx) => {
          const ws = await tx.workspace.findUnique({
            where: { id: so.workspaceId! },
            select: { timezone: true },
          });
          const timezone = ws?.timezone || "UTC";
          const weekInfo = operationalWeekOf(resolvedDeliveredAt, timezone);

          const weeklog = await tx.weeklog.upsert({
            where: {
              workspaceId_startsOn_clientId_siteKey: {
                workspaceId: so.workspaceId!,
                startsOn: weekInfo.startsOn,
                clientId: resolvedClientId,
                siteKey: po.operationalSiteKey!,
              },
            },
            create: {
              workspaceId: so.workspaceId!,
              startsOn: weekInfo.startsOn,
              endsOn: weekInfo.endsOn,
              clientId: resolvedClientId,
              siteKey: po.operationalSiteKey!,
              timezone: weekInfo.timezone,
              week: weekInfo.week,
              weekNumber: weekInfo.weekNumber,
              yearReference: weekInfo.yearReference,
              status: "open",
            },
            update: {},
          });

          await tx.weeklogEntry.create({
            data: {
              weeklogId: weeklog.id,
              workspaceId: so.workspaceId!,
              productionOrderId: po.id,
              executionSequence: po.executionSequence,
              budgetId: po.budgetId || null,
              budgetRevisionId: po.budgetRevisionId || null,
              legacyServiceOrderId: so.id,
              technicianUserId: resolvedTechUserId || "legacy-system",
              technicianName: po.technicianName || so.technicianName || "",
              clientId: resolvedClientId,
              clientName: po.clientName || so.clientName || client.name || "",
              brand: po.brand || null,
              model: po.model || null,
              color: po.color || null,
              licensePlate: po.licensePlate || so.licensePlate || null,
              vin: po.vin || null,
              servicesSnapshot: resolvedServices,
              totalAmount: resolvedTotal,
              currencyCode: currency,
              deliveredAt: resolvedDeliveredAt,
              validationStatus: "pending",
              isRectification: po.executionSequence > 1,
            },
          });

          if (po.status !== "delivered") {
            await tx.productionOrder.update({
              where: { id: po.id },
              data: { status: "delivered", deliveredAt: resolvedDeliveredAt },
            });
          }
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
      );

      report.created++;
    } catch (err: any) {
      report.errors.push({ id: so.id, error: err?.message || String(err) });
    }
  }

  return report;
}

// CLI entry point
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("backfillLegacyServiceOrders.ts")) {
  const applyFlag = process.argv.includes("--apply");
  const wsArg = process.argv.find((a) => a.startsWith("--workspace="));
  const workspaceId = wsArg ? wsArg.split("=")[1] : undefined;

  console.log(`[Backfill] Iniciando backfill legado. Modo: ${applyFlag ? "APPLY (writes habilitados)" : "DRY-RUN (zero writes)"}`);

  backfillLegacyServiceOrders({ apply: applyFlag, workspaceId })
    .then((report) => {
      console.log("\n[Backfill Report Result]");
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error("[Backfill Error]:", err);
      process.exit(1);
    });
}
