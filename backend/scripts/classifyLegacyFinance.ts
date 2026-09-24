import { prisma } from "../src/lib/prisma.js";

async function runClassification(applyMode: boolean) {
  console.log(JSON.stringify({ mode: applyMode ? "apply" : "dry-run", message: "Starting classification..." }));

  const report = {
    mode: applyMode ? "apply" : "dry-run",
    generatedAt: new Date().toISOString(),
    totals: {
      financialRecord: 0,
      financialEvent: 0,
      profitRule: 0,
      serviceOrderDistribution: 0,
      reconciliation: 0,
      paymentOrder: 0,
    },
    classifications: {
      DETERMINISTIC_CANDIDATE: 0,
      GLOBAL_NO_TENANT: 0,
      AMBIGUOUS: 0,
      MALFORMED: 0,
      ARCHIVE_ONLY: 0,
      ALREADY_CANONICAL_OR_PROJECTED: 0,
      UNSUPPORTED_SEMANTICS: 0,
    },
    candidatesByWorkspace: {} as Record<string, number>,
    samples: [] as any[],
  };

  const addSample = (asset: string, id: string, classification: string, reason: string) => {
    if (report.samples.length < 20) {
      report.samples.push({ asset, id, classification, reason });
    }
  };

  const classify = (classification: keyof typeof report.classifications, workspaceId: string | null) => {
    report.classifications[classification]++;
    if (classification === "DETERMINISTIC_CANDIDATE" && workspaceId) {
      report.candidatesByWorkspace[workspaceId] = (report.candidatesByWorkspace[workspaceId] || 0) + 1;
    }
  };

  // 1. FinancialRecord
  const financialRecords = await prisma.financialRecord.findMany();
  report.totals.financialRecord = financialRecords.length;
  for (const fr of financialRecords) {
    if (!fr.workspaceId) {
      classify("GLOBAL_NO_TENANT", null);
      addSample("FinancialRecord", fr.id, "GLOBAL_NO_TENANT", "No workspaceId");
    } else if (fr.type === "income") {
      classify("ARCHIVE_ONLY", fr.workspaceId);
      addSample("FinancialRecord", fr.id, "ARCHIVE_ONLY", "Legacy income must not become Received");
    } else if (fr.type === "expense") {
      // Must check if explicit currency exists (it doesn't in legacy model, usually assumed EUR)
      // "If legacy source does not explicitly and reliably identify currency: do NOT assume EUR... Classify: UNSUPPORTED_SEMANTICS or AMBIGUOUS"
      classify("AMBIGUOUS", fr.workspaceId);
      addSample("FinancialRecord", fr.id, "AMBIGUOUS", "Implicit currency assumption");
    } else {
      classify("UNSUPPORTED_SEMANTICS", fr.workspaceId);
    }
  }

  // 2. FinancialEvent / Integrity
  const financialEvents = await prisma.financialEvent.findMany();
  report.totals.financialEvent = financialEvents.length;
  for (const fe of financialEvents) {
    classify("ARCHIVE_ONLY", fe.workspaceId);
  }

  // 3. ProfitRule
  const profitRules = await prisma.profitRule.findMany();
  report.totals.profitRule = profitRules.length;
  for (const pr of profitRules) {
    classify("ARCHIVE_ONLY", null);
  }

  // 4. ServiceOrderDistribution
  const sods = await prisma.serviceOrderDistribution.findMany();
  report.totals.serviceOrderDistribution = sods.length;
  for (const sod of sods) {
    classify("ARCHIVE_ONLY", null);
  }

  // 5. Reconciliation
  const recons = await prisma.reconciliation.findMany();
  report.totals.reconciliation = recons.length;
  for (const r of recons) {
    classify("ARCHIVE_ONLY", null);
  }

  // 6. PaymentOrder
  const pos = await prisma.paymentOrder.findMany();
  report.totals.paymentOrder = pos.length;
  for (const po of pos) {
    classify("ALREADY_CANONICAL_OR_PROJECTED", po.workspaceId);
  }

  console.log(JSON.stringify(report, null, 2));

  if (applyMode) {
    console.log(JSON.stringify({ message: "Apply mode has no deterministic safe migrations to execute. Classification only." }));
  }
}

const isApply = process.argv.includes("--apply");
runClassification(isApply).catch((e) => {
  console.error(e);
  process.exit(1);
});
