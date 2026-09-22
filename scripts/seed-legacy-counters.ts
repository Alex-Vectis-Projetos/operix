import { prisma } from "../backend/src/lib/prisma.js";
import { pathToFileURL } from "node:url";

const PAYMENT_LIST_SEQUENCE = "payment_list";
const LEGACY_NUMBER = /^L(\d{6})$/;

export interface LegacySeedReport {
  scanned: number;
  validFormat: number;
  deterministicallyScoped: number;
  ambiguous: number;
  malformed: number;
  malformedIgnored: number;
  skippedAmbiguous: number;
  seedByWorkspace: Record<string, number>;
  applied: boolean;
}

/**
 * Finds only legacy list codes whose workspace is explicitly persisted. This
 * deliberately does not infer tenancy from a client, vehicle, date or name.
 */
export async function discoverLegacySeed({ apply = false }: { apply?: boolean } = {}): Promise<LegacySeedReport> {
  const [paymentOrders, productionLists] = await Promise.all([
    prisma.paymentOrder.findMany({ select: { workspaceId: true, listName: true } }),
    prisma.productionList.findMany({ select: { workspaceId: true, listName: true } }),
  ]);

  const report: LegacySeedReport = {
    scanned: paymentOrders.length + productionLists.length,
    validFormat: 0,
    deterministicallyScoped: 0,
    ambiguous: 0,
    malformed: 0,
    malformedIgnored: 0,
    skippedAmbiguous: 0,
    seedByWorkspace: {},
    applied: apply,
  };

  for (const row of [...paymentOrders, ...productionLists]) {
    const matched = row.listName ? LEGACY_NUMBER.exec(row.listName) : null;
    if (!matched) {
      report.malformed += 1;
      report.malformedIgnored += 1;
      continue;
    }
    report.validFormat += 1;
    if (!row.workspaceId) {
      report.ambiguous += 1;
      report.skippedAmbiguous += 1;
      continue;
    }
    report.deterministicallyScoped += 1;
    const value = Number(matched[1]);
    report.seedByWorkspace[row.workspaceId] = Math.max(report.seedByWorkspace[row.workspaceId] ?? 0, value);
  }

  if (apply) {
    await prisma.$transaction(async (tx) => {
      for (const [workspaceId, currentValue] of Object.entries(report.seedByWorkspace)) {
        await tx.tenantSequenceCounter.upsert({
          where: { workspaceId_sequenceType: { workspaceId, sequenceType: PAYMENT_LIST_SEQUENCE } },
          create: { workspaceId, sequenceType: PAYMENT_LIST_SEQUENCE, currentValue },
          update: { currentValue: { set: currentValue } },
        });
        // Never lower a counter which was already advanced by canonical lists.
        await tx.$executeRaw`
          UPDATE tenant_sequence_counters
          SET current_value = GREATEST(current_value, ${currentValue}), updated_at = NOW()
          WHERE workspace_id = ${workspaceId} AND sequence_type = ${PAYMENT_LIST_SEQUENCE}
        `;
      }
    });
  }

  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const apply = process.argv.includes("--apply");
  discoverLegacySeed({ apply })
    .then((report) => {
      console.info(JSON.stringify(report, null, 2));
    })
    .finally(() => prisma.$disconnect());
}
