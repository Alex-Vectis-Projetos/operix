import { Router, type Response } from "express";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { fetchAICompletion } from "../lib/ai.js";

export const financeRouter = Router();

/* ═══════════════════ shared money math (port of src/lib/distributionMath.ts) ═══════════════════ */

const toCents = (n: number | string | null | undefined): number => Math.round(Number(n || 0) * 100);

function splitCents(totalCents: number, pcts: number[]): number[] {
  const n = pcts.length;
  if (n === 0) return [];
  const raw = pcts.map((p) => (totalCents * p) / 100);
  const floors = raw.map((x) => Math.floor(x));
  let remainder = totalCents - floors.reduce((s, x) => s + x, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  const out = floors.slice();
  for (let k = 0; k < order.length && remainder > 0; k++) {
    out[order[k].i] += 1;
    remainder -= 1;
  }
  return out;
}

/* ═══════════════════ mappers (snake_case wire format, same shape the Supabase client returned) ═══════════════════ */

function mapSO(o: any) {
  if (!o) return null;
  return {
    id: o.id,
    workspace_id: o.workspaceId,
    assigned_user_id: o.assignedUserId,
    client_id: o.clientId,
    client_name: o.clientName,
    car_name: o.carName,
    license_plate: o.licensePlate,
    platform: o.platform,
    group_id: o.groupId,
    week: o.week,
    year_reference: o.yearReference,
    technician_name: o.technicianName,
    technician_earning: o.technicianEarning,
    technician_percentage: o.technicianPercentage,
    service_1_name: o.service1Name,
    service_1_price: o.service1Price,
    service_2_name: o.service2Name,
    service_2_price: o.service2Price,
    service_3_name: o.service3Name,
    service_3_price: o.service3Price,
    service_4_name: o.service4Name,
    service_4_price: o.service4Price,
    total: o.total,
    status: o.status,
    distribution_snapshot: o.distributionSnapshot ?? null,
    created_at: o.createdAt.toISOString(),
    updated_at: o.updatedAt.toISOString(),
  };
}

function mapPO(o: any) {
  if (!o) return null;
  return {
    id: o.id,
    workspace_id: o.workspaceId,
    assigned_user_id: o.assignedUserId,
    client_id: o.clientId,
    client_name: o.clientName,
    car_name: o.carName,
    license_plate: o.licensePlate,
    platform: o.platform,
    group_id: o.groupId,
    list_name: o.listName,
    technician_name: o.technicianName,
    services: o.services,
    service_order_id: o.serviceOrderId,
    total: o.total,
    status: o.status,
    created_at: o.createdAt.toISOString(),
    updated_at: o.updatedAt.toISOString(),
  };
}

function mapRecon(r: any, so: any | null, po: any | null) {
  return {
    id: r.id,
    service_order_id: r.serviceOrderId,
    payment_order_id: r.paymentOrderId,
    matched_by: r.matchedBy,
    confidence_score: r.confidenceScore,
    difference_amount: r.differenceAmount,
    status: r.status,
    notes: r.notes,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
    service_orders: mapSO(so),
    payment_orders: mapPO(po),
  };
}

function parseNotes(notes: string | null): Record<string, any> {
  if (!notes) return {};
  try {
    const parsed = JSON.parse(notes);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function emitFinancialEvent(input: {
  workspaceId?: string | null;
  eventType: string;
  entityType: string;
  entityId?: string | null;
  payload?: Record<string, unknown>;
  actorUserId?: string | null;
}) {
  try {
    const payload = input.payload ?? {};
    const hash = createHash("sha256")
      .update(`${input.eventType}|${input.entityType}|${input.entityId ?? ""}|${JSON.stringify(payload)}|${Date.now()}`)
      .digest("hex");
    await prisma.financialEvent.create({
      data: {
        workspaceId: input.workspaceId ?? null,
        eventType: input.eventType,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        payload: payload as any,
        eventHash: hash,
        actorUserId: input.actorUserId ?? null,
      },
    });
  } catch (err) {
    console.warn("[finance] emitFinancialEvent falhou (ignorado):", err);
  }
}

async function loadReconciliationsWithOrders(where: Record<string, unknown> = {}) {
  const recons = await prisma.reconciliation.findMany({ where, orderBy: { createdAt: "desc" } });
  const soIds = [...new Set(recons.map((r) => r.serviceOrderId).filter(Boolean))] as string[];
  const poIds = [...new Set(recons.map((r) => r.paymentOrderId).filter(Boolean))] as string[];
  const [sos, pos] = await Promise.all([
    soIds.length ? prisma.serviceOrder.findMany({ where: { id: { in: soIds } } }) : [],
    poIds.length ? prisma.paymentOrder.findMany({ where: { id: { in: poIds } } }) : [],
  ]);
  const soMap = new Map(sos.map((s) => [s.id, s]));
  const poMap = new Map(pos.map((p) => [p.id, p]));
  return recons.map((r) =>
    mapRecon(r, r.serviceOrderId ? soMap.get(r.serviceOrderId) ?? null : null, r.paymentOrderId ? poMap.get(r.paymentOrderId) ?? null : null),
  );
}

/* ═══════════════════ Reconciliations (aba Confronto / useReconciliation) ═══════════════════ */

// Reconciliation has no tenant key or trustworthy tenant relationship. Do not
// infer ownership through legacy joins; the canonical commercial read is the
// tenant-scoped PaymentList confrontation API.
financeRouter.get("/reconciliations", requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  return res.status(410).json({ code: "LEGACY_RECONCILIATION_READ_DEPRECATED", message: "A consulta comercial é operada por /api/payment-lists." });
});

financeRouter.get("/reconciliations", (_req, res) => res.status(410).json({ code: "LEGACY_RECONCILIATION_READ_DEPRECATED", message: "A consulta comercial é operada por /api/payment-lists." }));
financeRouter.post("/reconciliations", (_req, res) => res.status(410).json({ code: "LEGACY_RECONCILIATION_ENGINE_DEPRECATED" }));
financeRouter.patch("/reconciliations/:id", (_req, res) => res.status(410).json({ code: "LEGACY_RECONCILIATION_ENGINE_DEPRECATED" }));
financeRouter.post("/reconciliations/manual-merge", (_req, res) => res.status(410).json({ code: "LEGACY_RECONCILIATION_ENGINE_DEPRECATED" }));
financeRouter.post("/reconciliations/run", (_req, res) => res.status(410).json({ code: "LEGACY_RECONCILIATION_ENGINE_DEPRECATED" }));
financeRouter.get("/confrontation/candidates", (_req, res) => res.status(410).json({ code: "LEGACY_RECONCILIATION_ENGINE_DEPRECATED" }));
financeRouter.post("/confrontation/merge", (_req, res) => res.status(410).json({ code: "LEGACY_RECONCILIATION_ENGINE_DEPRECATED" }));
financeRouter.post("/confrontation/reject", (_req, res) => res.status(410).json({ code: "LEGACY_RECONCILIATION_ENGINE_DEPRECATED" }));
financeRouter.get("/confrontation/pending", (_req, res) => res.status(410).json({ code: "LEGACY_RECONCILIATION_ENGINE_DEPRECATED" }));
financeRouter.post("/confrontation/validate", (_req, res) => res.status(410).json({ code: "LEGACY_RECONCILIATION_ENGINE_DEPRECATED" }));
financeRouter.get("/confrontation/history", (_req, res) => res.status(410).json({ code: "LEGACY_RECONCILIATION_READ_DEPRECATED" }));

/* ═══════════════════ Resumo financeiro (port de useReconciliationSummary) ═══════════════════ */

financeRouter.get("/summary", (_req, res) => res.status(410).json({ code: "LEGACY_FINANCE_READ_DEPRECATED", message: "Este resumo financeiro foi desativado." }));

/* ═══════════════════ Regras de distribuição de lucros ═══════════════════ */

function mapProfitRule(r: any) {
  return {
    id: r.id,
    rule_name: r.ruleName,
    group_ids: r.groupIds ?? [],
    is_active: r.isActive,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
    profit_rule_items: (r.items ?? []).map((it: any) => ({
      id: it.id,
      rule_id: it.ruleId,
      participant_name: it.participantName,
      percentage: it.percentage,
      participant_type: it.participantType,
    })),
  };
}

financeRouter.get("/profit-rules", (_req, res) => res.status(410).json({ code: "LEGACY_PROFIT_RULE_READ_DEPRECATED" }));
financeRouter.post("/profit-rules", (_req, res) => res.status(410).json({ code: "LEGACY_PROFIT_RULE_WRITE_DEPRECATED" }));
financeRouter.delete("/profit-rules/:id", (_req, res) => res.status(410).json({ code: "LEGACY_PROFIT_RULE_WRITE_DEPRECATED" }));
financeRouter.delete("/profit-rules", (_req, res) => res.status(410).json({ code: "LEGACY_PROFIT_RULE_WRITE_DEPRECATED" }));
financeRouter.get("/aggregation-source", (_req, res) => res.status(410).json({ code: "LEGACY_PROFIT_RULE_READ_DEPRECATED" }));
financeRouter.get("/participation/summary", (_req, res) => res.status(410).json({ code: "LEGACY_PROFIT_RULE_READ_DEPRECATED" }));
financeRouter.get("/participation/detail", (_req, res) => res.status(410).json({ code: "LEGACY_PROFIT_RULE_READ_DEPRECATED" }));

/* ═══════════════════ Fonte da agregação por participante (useParticipantAggregation) ═══════════════════ */


/* ═══════════════════ Técnicos (user_roles + profiles) ═══════════════════ */

financeRouter.get("/technicians", requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const roleRows = await prisma.userRole.findMany({ where: { role: "technician" }, select: { userId: true } });
  const ids = roleRows.map((r) => r.userId);
  if (ids.length === 0) return res.json([]);
  const profiles = await prisma.profile.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true } });
  const list = profiles
    .map((p) => ({ id: p.id, name: p.fullName || p.email || "—" }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return res.json(list);
});

/* ═══════════════════ Participação (substitui participation_ledger/v_participation_summary) ═══════════════════ */

interface SnapshotEntry {
  participant_name: string;
  percentage: number;
  calculated_value: number;
}

async function loadParticipationRows(year?: number | null) {
  const serviceOrders = await prisma.serviceOrder.findMany({
    select: { id: true, total: true, status: true, yearReference: true, distributionSnapshot: true, workspaceId: true },
  });
  const items = await prisma.profitRuleItem.findMany({ select: { participantName: true, participantType: true } });
  const typeByName = new Map<string, string>();
  for (const it of items) typeByName.set(it.participantName, it.participantType);

  const rows: {
    id: string;
    workspace_id: string | null;
    service_order_id: string;
    participant_name: string;
    participant_type: string;
    percentage: number;
    expected_amount: number;
    received_amount: number;
    pending_amount: number;
    status: string;
    year_reference: number | null;
  }[] = [];

  for (const so of serviceOrders) {
    const snap = so.distributionSnapshot as unknown as SnapshotEntry[] | null;
    if (!Array.isArray(snap) || snap.length === 0) continue;
    // Ano é rótulo de exibição: OS sem year_reference entram em qualquer ano selecionado
    if (year && so.yearReference != null && so.yearReference !== year) continue;

    const totalCents = toCents(so.total);
    const pcts = snap.map((s) => Number(s.percentage || 0));
    const parts = splitCents(totalCents, pcts);
    const status = so.status === "paid" ? "paid" : so.status === "partial" ? "partial" : "pending";

    snap.forEach((s, i) => {
      const expected = parts[i] / 100;
      const received = status === "paid" ? expected : 0;
      rows.push({
        id: `${so.id}:${s.participant_name}`,
        workspace_id: so.workspaceId,
        service_order_id: so.id,
        participant_name: s.participant_name,
        participant_type: typeByName.get(s.participant_name) ?? "other",
        percentage: Number(s.percentage || 0),
        expected_amount: expected,
        received_amount: received,
        pending_amount: expected - received,
        status,
        year_reference: so.yearReference,
      });
    });
  }

  return rows;
}

// GET /finance/audit/timeline?year=&event_type=&entity_type=&hash=&limit=
financeRouter.get("/audit/timeline", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const q = req.query as Record<string, string | undefined>;
  const where: Record<string, unknown> = {};
  if (q.event_type) where.eventType = q.event_type;
  if (q.entity_type) where.entityType = q.entity_type;
  if (q.hash) where.eventHash = q.hash;
  if (q.year) {
    const y = Number(q.year);
    where.createdAt = { gte: new Date(Date.UTC(y, 0, 1)), lt: new Date(Date.UTC(y + 1, 0, 1)) };
  }
  const limit = Math.min(Number(q.limit ?? 200), 500);
  const events = await prisma.financialEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: limit });

  return res.json(
    events.map((ev) => {
      const payload = (ev.payload ?? {}) as Record<string, unknown>;
      return {
        id: ev.id,
        workspace_id: ev.workspaceId,
        year_reference: payload["year_reference"] ?? ev.createdAt.getUTCFullYear(),
        entity_type: ev.entityType,
        entity_id: ev.entityId,
        event_type: ev.eventType,
        event_hash: ev.eventHash,
        revision: 1,
        source: "backend",
        correlation_id: null,
        caused_by_event_id: null,
        actor_user_id: ev.actorUserId,
        payload_summary: {
          amount: payload["amount"] ?? null,
          received: payload["received"] ?? null,
          expected: payload["expected"] ?? null,
          status: payload["status"] ?? null,
          reason: payload["reason"] ?? null,
          participant: payload["participant_name"] ?? null,
          service_order_id: payload["service_order_id"] ?? null,
          invoice_id: payload["invoice_id"] ?? null,
        },
        payload,
        created_at: ev.createdAt.toISOString(),
      };
    }),
  );
});

// GET /finance/audit/integrity-summary — calculado on-the-fly
financeRouter.get("/audit/integrity-summary", requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const [events, pos, soIdsRows, frs, dists] = await Promise.all([
    prisma.financialEvent.findMany({ select: { eventHash: true }, where: { eventHash: { not: null } } }),
    prisma.paymentOrder.findMany({ select: { id: true, serviceOrderId: true } }),
    prisma.serviceOrder.findMany({ select: { id: true } }),
    prisma.financialRecord.findMany({ select: { id: true, workspaceId: true, serviceOrderId: true } }),
    prisma.serviceOrderDistribution.findMany({ select: { serviceOrderId: true, percentage: true } }),
  ]);

  const hashCounts = new Map<string, number>();
  for (const e of events) hashCounts.set(e.eventHash!, (hashCounts.get(e.eventHash!) ?? 0) + 1);
  const duplicateHashCount = [...hashCounts.values()].filter((c) => c > 1).length;

  const soIds = new Set(soIdsRows.map((s) => s.id));
  const orphanOpCount = pos.filter((po) => !po.serviceOrderId || !soIds.has(po.serviceOrderId)).length;
  const missingSoLinks = frs.filter((fr) => fr.serviceOrderId && !soIds.has(fr.serviceOrderId)).length;

  const pctBySo = new Map<string, number>();
  for (const d of dists) pctBySo.set(d.serviceOrderId, (pctBySo.get(d.serviceOrderId) ?? 0) + Number(d.percentage || 0));
  const overAllocated = [...pctBySo.values()].filter((sum) => sum > 100.5).length;

  const invalidWorkspaceRows = frs.filter((fr) => !fr.workspaceId).length;

  return res.json({
    duplicate_hash_count: duplicateHashCount,
    orphan_op_count: orphanOpCount,
    missing_so_links: missingSoLinks,
    over_allocated_distributions: overAllocated,
    invalid_workspace_rows: invalidWorkspaceRows,
    replay_collapses: 0,
    skipped_diff_updates: 0,
    financial_sync_lock_hits: 0,
  });
});

// GET /finance/audit/participation-diffs — camada de revisões não portada; lista vazia
financeRouter.get("/audit/participation-diffs", requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  return res.json([]);
});

/* ═══════════════════ Integridade (port da RPC run_financial_integrity_check) ═══════════════════ */

// GET /finance/integrity/issues?year=&severity=&issue_type=&status=
financeRouter.get("/integrity/issues", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const q = req.query as Record<string, string | undefined>;
  const where: Record<string, unknown> = {};
  if (q.year) where.yearReference = Number(q.year);
  if (q.severity && q.severity !== "all") where.severity = q.severity;
  if (q.issue_type && q.issue_type !== "all") where.issueType = q.issue_type;
  if (q.status && q.status !== "all") where.status = q.status;
  const issues = await prisma.financialIntegrityIssue.findMany({ where, orderBy: { detectedAt: "desc" }, take: 500 });
  return res.json(
    issues.map((i) => ({
      id: i.id,
      workspace_id: i.workspaceId,
      year_reference: i.yearReference,
      severity: i.severity,
      issue_type: i.issueType,
      entity_type: i.entityType,
      entity_id: i.entityId,
      reference_id: i.referenceId,
      detected_at: i.detectedAt.toISOString(),
      resolved_at: i.resolvedAt?.toISOString() ?? null,
      status: i.status,
      details_json: i.detailsJson ?? {},
      hash: i.hash,
    })),
  );
});

// GET /finance/integrity/snapshots?year=
financeRouter.get("/integrity/snapshots", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const q = req.query as Record<string, string | undefined>;
  const where: Record<string, unknown> = {};
  if (q.year) where.yearReference = Number(q.year);
  const snapshots = await prisma.financialIntegritySnapshot.findMany({ where, orderBy: { createdAt: "desc" }, take: 50 });
  return res.json(
    snapshots.map((s) => ({
      id: s.id,
      workspace_id: s.workspaceId,
      year_reference: s.yearReference,
      snapshot_type: s.snapshotType,
      total_received: s.totalReceived,
      total_expected: s.totalExpected,
      total_pending: s.totalPending,
      total_distributed: s.totalDistributed,
      total_expenses: s.totalExpenses,
      total_profit: s.totalProfit,
      total_os: s.totalOs,
      total_op: s.totalOp,
      created_at: s.createdAt.toISOString(),
    })),
  );
});

// POST /finance/integrity/run {year}
financeRouter.post("/integrity/run", (_req, res) => res.status(410).json({ code: "LEGACY_FINANCE_WRITE_DEPRECATED" }));

/* ═══════════════════ AI Insights (port da edge function financial-ai-insights) ═══════════════════ */

type Insight = {
  level: "info" | "warning" | "critical";
  category: string;
  title: string;
  detail: string;
};

// POST /finance/ai-insights { workspaceId, year }
financeRouter.post("/ai-insights", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const workspaceId: string | undefined = req.body?.workspaceId;
  if (!workspaceId) return res.status(400).json({ error: "workspaceId required" });
  const yr = Number(req.body?.year ?? new Date().getFullYear());

  const records = await prisma.financialRecord.findMany({
    where: {
      workspaceId,
      OR: [
        { yearReference: yr },
        { yearReference: null, createdAt: { gte: new Date(Date.UTC(yr, 0, 1)), lt: new Date(Date.UTC(yr + 1, 0, 1)) } },
      ],
    },
    take: 2000,
  });

  const insights: Insight[] = [];

  // 1) Duplicados (mesmo tipo + label + valor + dia)
  const dupMap = new Map<string, number>();
  for (const r of records) {
    const day = r.createdAt.toISOString().slice(0, 10);
    const key = `${r.type}|${(r.label || "").trim().toLowerCase()}|${Number(r.amount).toFixed(2)}|${day}`;
    dupMap.set(key, (dupMap.get(key) || 0) + 1);
  }
  for (const [key, count] of dupMap) {
    if (count >= 2) {
      insights.push({
        level: "warning",
        category: "duplicates",
        title: "Possível lançamento duplicado",
        detail: `${count}× lançamentos idênticos: ${key.split("|")[1] || "(sem descrição)"} — €${key.split("|")[2]}`,
      });
    }
  }

  // 2) Despesas anormais (z-score por categoria)
  const byCat = new Map<string, number[]>();
  for (const r of records) {
    if (r.type !== "expense") continue;
    const c = r.category || "other";
    const arr = byCat.get(c) || [];
    arr.push(Number(r.amount) || 0);
    byCat.set(c, arr);
  }
  for (const [cat, arr] of byCat) {
    if (arr.length < 5) continue;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const sd = Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
    const threshold = mean + 2.5 * sd;
    const outliers = arr.filter((v) => v > threshold && v > mean * 1.8);
    if (outliers.length) {
      insights.push({
        level: "warning",
        category: "anomaly",
        title: `Despesas anormais em "${cat}"`,
        detail: `${outliers.length} valor(es) acima de €${threshold.toFixed(2)} (média: €${mean.toFixed(2)})`,
      });
    }
  }

  // 3) Documentos importados sem ficheiro vinculado
  const importedNoRef = records.filter((r) => r.origin === "imported_document" && !r.referenceId).length;
  if (importedNoRef > 0) {
    insights.push({
      level: "warning",
      category: "documents",
      title: "Lançamentos importados sem documento",
      detail: `${importedNoRef} lançamento(s) marcados como importados mas sem ficheiro vinculado`,
    });
  }

  // 4) Rentabilidade
  const totalIncome = records.filter((r) => r.type === "income").reduce((a, r) => a + Number(r.amount || 0), 0);
  const totalExpense = records.filter((r) => r.type === "expense").reduce((a, r) => a + Number(r.amount || 0), 0);
  const margin = totalIncome - totalExpense;
  if (totalIncome > 0 && margin < 0) {
    insights.push({
      level: "critical",
      category: "profitability",
      title: "Margem operacional negativa",
      detail: `Despesas (€${totalExpense.toFixed(2)}) superam receitas (€${totalIncome.toFixed(2)}) em €${Math.abs(margin).toFixed(2)}`,
    });
  }

  // 5) Concentração de retiradas
  const wdByTech = new Map<string, number>();
  for (const r of records) {
    if (r.category !== "salary" && r.type !== "withdrawal") continue;
    const k = r.assignedUserId || "—";
    wdByTech.set(k, (wdByTech.get(k) || 0) + Number(r.amount || 0));
  }
  const wdTotal = [...wdByTech.values()].reduce((a, b) => a + b, 0);
  for (const [tech, v] of wdByTech) {
    if (wdTotal > 0 && v / wdTotal > 0.55 && tech !== "—") {
      insights.push({
        level: "warning",
        category: "withdrawals",
        title: "Concentração de retiradas",
        detail: `Um técnico concentra ${((v / wdTotal) * 100).toFixed(0)}% das retiradas (€${v.toFixed(2)})`,
      });
    }
  }

  const kpis = {
    totalIncome,
    totalExpense,
    margin,
    records: records.length,
    fuelEntries: 0,
    missingReceipts: 0,
    duplicates: [...dupMap.values()].filter((c) => c >= 2).length,
  };

  // Narrativa via IA (best-effort)
  let narrative = "";
  if (insights.length) {
    try {
      const prompt = `Resume em 3-4 frases curtas, em português europeu, o estado financeiro do workspace deste ano com base nos indicadores e alertas seguintes. Tom direto, sem floreios.\n\nKPIs: ${JSON.stringify(kpis)}\n\nAlertas: ${JSON.stringify(insights.slice(0, 12))}`;
      const aiRes = await fetchAICompletion({
        messages: [
          { role: "system", content: "És um analista financeiro conciso. Nunca inventas dados." },
          { role: "user", content: prompt },
        ],
      });
      if (aiRes.ok) {
        const data: any = await aiRes.json();
        narrative = data?.choices?.[0]?.message?.content || "";
      }
    } catch (err) {
      console.error("[finance] narrativa AI falhou:", err);
    }
  }

  return res.json({ kpis, insights, narrative, generatedAt: new Date().toISOString() });
});
