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

// GET /finance/reconciliations
financeRouter.get("/reconciliations", requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  return res.json(await loadReconciliationsWithOrders());
});

// POST /finance/reconciliations — insert bruto (merge/reject do confronto)
financeRouter.post("/reconciliations", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const b = req.body ?? {};
  const recon = await prisma.reconciliation.create({
    data: {
      serviceOrderId: b.service_order_id ?? null,
      paymentOrderId: b.payment_order_id ?? null,
      matchedBy: b.matched_by ?? "manual",
      confidenceScore: Number(b.confidence_score ?? 0),
      differenceAmount: Number(b.difference_amount ?? 0),
      status: b.status ?? "pending",
      notes: b.notes ?? null,
    },
  });
  return res.status(201).json(mapRecon(recon, null, null));
});

// PATCH /finance/reconciliations/:id — merge notes / status / matched_by
financeRouter.patch("/reconciliations/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const id = req.params["id"] as string;
  const b = req.body ?? {};
  const data: Record<string, unknown> = {};
  if (b.status !== undefined) data.status = b.status;
  if (b.matched_by !== undefined) data.matchedBy = b.matched_by;
  if (b.notes !== undefined) data.notes = b.notes;
  if (b.merge_notes !== undefined && typeof b.merge_notes === "object") {
    const current = await prisma.reconciliation.findUnique({ where: { id }, select: { notes: true } });
    data.notes = JSON.stringify({ ...parseNotes(current?.notes ?? null), ...b.merge_notes });
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ message: "Nenhum campo para atualizar." });
  const recon = await prisma.reconciliation.update({ where: { id }, data });
  return res.json(mapRecon(recon, null, null));
});

// POST /finance/reconciliations/manual-merge — port do useManualMerge
financeRouter.post("/reconciliations/manual-merge", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { service_order_id, payment_order_id } = req.body ?? {};
  if (!service_order_id || !payment_order_id) {
    return res.status(400).json({ message: "service_order_id e payment_order_id são obrigatórios." });
  }
  const [so, po] = await Promise.all([
    prisma.serviceOrder.findUnique({ where: { id: service_order_id } }),
    prisma.paymentOrder.findUnique({ where: { id: payment_order_id } }),
  ]);
  if (!so || !po) return res.status(404).json({ message: "OS ou OP não encontrada." });

  const soTotal = Number(so.total || 0);
  const poTotal = Number(po.total || 0);
  const diff = soTotal - poTotal;
  const status = Math.abs(diff) < 0.01 ? "matched" : "mismatch";

  const notes = JSON.stringify({
    match_reasons: ["manual"],
    match_type: status === "matched" ? "exact_match" : "partial_match",
    explanation: `Fusão manual: OS (${so.licensePlate || "N/A"}, ${so.clientName || "N/A"}) ↔ OP (${po.licensePlate || "N/A"}, ${po.clientName || "N/A"}). ${status === "matched" ? "Valores iguais." : `Diferença: €${Math.abs(diff).toFixed(2)}`}`,
    so_total: soTotal,
    po_total: poTotal,
  });

  const recon = await prisma.$transaction(async (tx) => {
    await tx.reconciliation.deleteMany({ where: { serviceOrderId: service_order_id, matchedBy: "auto" } });
    await tx.reconciliation.deleteMany({ where: { paymentOrderId: payment_order_id, matchedBy: "auto" } });
    return tx.reconciliation.create({
      data: {
        serviceOrderId: service_order_id,
        paymentOrderId: payment_order_id,
        matchedBy: "manual",
        confidenceScore: 100,
        differenceAmount: diff,
        status,
        notes,
      },
    });
  });

  await emitFinancialEvent({
    workspaceId: so.workspaceId,
    eventType: "reconciliation.manual_merge",
    entityType: "reconciliation",
    entityId: recon.id,
    payload: { service_order_id, payment_order_id, difference: diff, status, year_reference: so.yearReference },
    actorUserId: req.auth?.userId,
  });

  return res.status(201).json(mapRecon(recon, so, po));
});

/* ═══════════════════ Motor de reconciliação (port da edge function run-reconciliation) ═══════════════════ */

financeRouter.post("/reconciliations/run", requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  return res.status(410).json({ code: "LEGACY_RECONCILIATION_ENGINE_DEPRECATED", message: "A reconciliação comercial é operada por /api/payment-lists." });
});

function normalizePlate(s?: string | null): string {
  return (s ?? "").trim().toUpperCase().replace(/[\s\-.]/g, "");
}
function normLower(s?: string | null): string {
  return (s ?? "").trim().toLowerCase();
}

const PLATFORM_ALIASES: Record<string, string> = {
  "st romain": "St Romain",
  "saint romain": "St Romain",
  stromain: "St Romain",
  "saint-romain": "St Romain",
  andrezieux: "Andrezieux",
  andrézieux: "Andrezieux",
  "andrezieux-boutheon": "Andrezieux",
};

function normalizePlatform(name?: string | null): string | null {
  if (!name) return null;
  const clean = name.toLowerCase().trim();
  return PLATFORM_ALIASES[clean] || name.trim();
}

function extractServiceNamesSO(so: any): string[] {
  const names: string[] = [];
  for (const n of [so.service1Name, so.service2Name, so.service3Name, so.service4Name]) {
    if (n) names.push(normLower(n));
  }
  return names.sort();
}

function extractServiceNamesPO(po: any): string[] {
  const services = po.services;
  if (!Array.isArray(services)) return [];
  return services
    .map((s: any) => (typeof s === "object" && s?.name ? normLower(s.name) : null))
    .filter(Boolean)
    .sort() as string[];
}

function serviceNamesMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (shorter.length / longer.length < 0.8) return false;
  return longer.includes(shorter);
}

function servicesCompatible(soNames: string[], poNames: string[]): boolean {
  if (soNames.length === 0 && poNames.length === 0) return true;
  if (soNames.length === 0 || poNames.length === 0) return false;
  for (const sn of soNames) {
    for (const pn of poNames) {
      if (serviceNamesMatch(sn, pn)) return true;
    }
  }
  return false;
}

function serviceOverlapRatio(soNames: string[], poNames: string[]): number {
  if (soNames.length === 0 && poNames.length === 0) return 1;
  const total = Math.max(soNames.length, poNames.length);
  if (total === 0) return 1;
  let matched = 0;
  const used = new Set<number>();
  for (const sn of soNames) {
    for (let i = 0; i < poNames.length; i++) {
      if (!used.has(i) && serviceNamesMatch(sn, poNames[i])) {
        matched++;
        used.add(i);
        break;
      }
    }
  }
  return matched / total;
}

const money = (v: number) => `€${v.toFixed(2)}`;

// POST /finance/reconciliations/run
financeRouter.post("/reconciliations/run", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  // Limpeza de financial_records órfãos (antes feita no cliente em useRunReconciliation)
  const [soIdsRows, poIdsRows] = await Promise.all([
    prisma.serviceOrder.findMany({ select: { id: true } }),
    prisma.paymentOrder.findMany({ select: { id: true } }),
  ]);
  const validSOIds = new Set(soIdsRows.map((r) => r.id));
  const validPOIds = new Set(poIdsRows.map((r) => r.id));

  const frRows = await prisma.financialRecord.findMany({
    where: { source: { in: ["service_orders", "payment_orders"] } },
    select: { id: true, source: true, serviceOrderId: true, paymentOrderId: true },
  });
  const orphanIds = frRows
    .filter((r) => {
      if (r.source === "service_orders" && r.serviceOrderId && !validSOIds.has(r.serviceOrderId)) return true;
      if (r.source === "payment_orders" && r.paymentOrderId && !validPOIds.has(r.paymentOrderId)) return true;
      return false;
    })
    .map((r) => r.id);
  if (orphanIds.length > 0) {
    await prisma.financialRecord.deleteMany({ where: { id: { in: orphanIds } } });
  }

  // HARD RESET: limpa resultados auto anteriores
  await prisma.reconciliation.deleteMany({ where: { matchedBy: "auto" } });

  const [serviceOrders, paymentOrders] = await Promise.all([
    prisma.serviceOrder.findMany(),
    prisma.paymentOrder.findMany(),
  ]);

  if (serviceOrders.length === 0 || paymentOrders.length === 0) {
    return res.json({
      total: 0, matched: 0, mismatched: 0, missing: 0, pending: 0,
      status: "no_data",
      message:
        serviceOrders.length === 0 && paymentOrders.length === 0
          ? "No service or payment orders found"
          : serviceOrders.length === 0
            ? "No service orders found — cannot reconcile"
            : "No payment orders found — cannot reconcile",
      debug: { so_count: serviceOrders.length, po_count: paymentOrders.length },
    });
  }

  interface NormItem {
    id: string;
    plate: string;
    platform: string;
    client: string;
    services: string[];
    total: number;
    raw: any;
  }

  const normSOs: NormItem[] = serviceOrders.map((so) => ({
    id: so.id,
    plate: normalizePlate(so.licensePlate),
    platform: normalizePlatform(so.platform) || "unknown_platform",
    client: normLower(so.clientName) || "unknown_client",
    services: extractServiceNamesSO(so),
    total: Number(so.total || 0),
    raw: so,
  }));
  const normPOs: NormItem[] = paymentOrders.map((po) => ({
    id: po.id,
    plate: normalizePlate(po.licensePlate),
    platform: normalizePlatform(po.platform) || "unknown_platform",
    client: normLower(po.clientName) || "unknown_client",
    services: extractServiceNamesPO(po),
    total: Number(po.total || 0),
    raw: po,
  }));

  const soGroups = new Map<string, NormItem[]>();
  const poGroups = new Map<string, NormItem[]>();
  for (const so of normSOs) {
    const key = `${so.plate}|${so.platform}|${so.client}`;
    if (!soGroups.has(key)) soGroups.set(key, []);
    soGroups.get(key)!.push(so);
  }
  for (const po of normPOs) {
    const key = `${po.plate}|${po.platform}|${po.client}`;
    if (!poGroups.has(key)) poGroups.set(key, []);
    poGroups.get(key)!.push(po);
  }

  const results: any[] = [];
  const matchedSOIds = new Set<string>();
  const matchedPOIds = new Set<string>();
  const debugDecisions: any[] = [];

  // FASE 1: agrupamento estrito (placa + plataforma + cliente)
  for (const [groupKey, groupSOs] of soGroups.entries()) {
    const groupPOs = poGroups.get(groupKey);
    if (!groupPOs || groupPOs.length === 0) continue;

    const allSOServices = groupSOs.flatMap((so) => so.services);
    const allPOServices = groupPOs.flatMap((po) => po.services);
    if (!servicesCompatible(allSOServices, allPOServices)) continue;

    const soTotal = groupSOs.reduce((sum, so) => sum + so.total, 0);
    const poTotal = groupPOs.reduce((sum, po) => sum + po.total, 0);
    const groupDiff = soTotal - poTotal;
    const overlapRatio = serviceOverlapRatio(allSOServices, allPOServices);

    let matchType: string;
    let status: string;
    if (groupSOs.length === 1 && groupPOs.length === 1 && Math.abs(groupDiff) < 0.01 && overlapRatio >= 0.8) {
      matchType = "exact_match";
      status = "matched";
    } else if (groupSOs.length === 1 && groupPOs.length === 1 && overlapRatio >= 0.5) {
      matchType = Math.abs(groupDiff) < 5 ? "exact_match" : "partial_match";
      status = Math.abs(groupDiff) < 5 ? "matched" : "mismatch";
    } else if (Math.abs(groupDiff) < 5) {
      matchType = "grouped_match";
      status = "matched";
    } else {
      matchType = "partial_match";
      status = "mismatch";
    }

    let confidence = 25 + 30 + 20 + Math.round(overlapRatio * 40);
    if (Math.abs(groupDiff) < 0.01) confidence += 10;
    else if (Math.abs(groupDiff) < 5) confidence += 5;

    const reasons: string[] = ["plate_exact", "platform_match", "client_exact"];
    if (overlapRatio >= 0.8) reasons.push("service_exact");
    else if (overlapRatio > 0) reasons.push("service_partial");
    if (Math.abs(groupDiff) < 0.01) reasons.push("value_exact");
    else if (Math.abs(groupDiff) < 5) reasons.push("value_close");
    if (groupSOs.length > 1 || groupPOs.length > 1) reasons.push("grouped_match");

    const groupExplanation =
      matchType === "grouped_match" || groupSOs.length > 1 || groupPOs.length > 1
        ? `Grupo conciliado: ${groupSOs.length} OS ↔ ${groupPOs.length} OP para placa ${groupSOs[0].plate}, plataforma ${groupSOs[0].platform}, cliente ${groupSOs[0].client}. Total OS: ${money(soTotal)}, Total OP: ${money(poTotal)}, diff: ${money(Math.abs(groupDiff))}.`
        : `Conciliação exacta: ${groupSOs[0].plate} (${groupSOs[0].platform}, ${groupSOs[0].client}). OS: ${money(soTotal)}, OP: ${money(poTotal)}.`;

    debugDecisions.push({ group_key: groupKey, so_count: groupSOs.length, po_count: groupPOs.length, so_total: soTotal, po_total: poTotal, diff: groupDiff, match_type: matchType, status, confidence, reasons, service_overlap: overlapRatio });

    const sortedSOs = [...groupSOs].sort((a, b) => a.total - b.total);
    const sortedPOs = [...groupPOs].sort((a, b) => a.total - b.total);
    for (let i = 0; i < sortedSOs.length; i++) {
      const so = sortedSOs[i];
      const po = sortedPOs[Math.min(i, sortedPOs.length - 1)];
      results.push({
        serviceOrderId: so.id,
        paymentOrderId: po.id,
        matchedBy: "auto",
        confidenceScore: confidence,
        differenceAmount: so.total - po.total,
        status,
        notes: JSON.stringify({
          match_reasons: reasons,
          match_type: matchType,
          explanation: groupExplanation,
          so_plate: so.raw.licensePlate, po_plate: po.raw.licensePlate,
          so_platform: so.raw.platform, po_platform: po.raw.platform,
          so_client: so.raw.clientName, po_client: po.raw.clientName,
          so_total: so.total, po_total: po.total,
          so_date: so.raw.createdAt, po_date: po.raw.createdAt,
          group_so_total: soTotal, group_po_total: poTotal,
          group_so_count: groupSOs.length, group_po_count: groupPOs.length,
        }),
      });
      matchedSOIds.add(so.id);
    }
    for (const po of groupPOs) matchedPOIds.add(po.id);
  }

  // FASE 2: fallback por link direto (payment_orders.service_order_id)
  for (const po of normPOs) {
    if (matchedPOIds.has(po.id)) continue;
    if (!po.raw.serviceOrderId) continue;
    const so = normSOs.find((s) => s.id === po.raw.serviceOrderId);
    if (!so || matchedSOIds.has(so.id)) continue;

    const plateOk = so.plate === po.plate || !so.plate || !po.plate;
    const platformOk = so.platform === po.platform || so.platform === "unknown_platform" || po.platform === "unknown_platform";
    const serviceOk = servicesCompatible(so.services, po.services) || so.services.length === 0 || po.services.length === 0;
    if (!plateOk || !platformOk || !serviceOk) continue;

    const diff = so.total - po.total;
    const status = Math.abs(diff) < 0.01 ? "matched" : "mismatch";
    const overlapRatio = serviceOverlapRatio(so.services, po.services);
    let confidence = 30;
    if (plateOk && so.plate) confidence += 25;
    if (platformOk) confidence += 30;
    confidence += Math.round(overlapRatio * 40);
    if (Math.abs(diff) < 0.01) confidence += 10;

    const reasons = ["direct_link"];
    if (so.plate && so.plate === po.plate) reasons.push("plate_exact");
    if (platformOk) reasons.push("platform_match");
    if (overlapRatio >= 0.8) reasons.push("service_exact");

    results.push({
      serviceOrderId: so.id,
      paymentOrderId: po.id,
      matchedBy: "auto",
      confidenceScore: confidence,
      differenceAmount: diff,
      status,
      notes: JSON.stringify({
        match_reasons: reasons,
        match_type: status === "matched" ? "exact_match" : "partial_match",
        explanation: `Link direto: ${so.raw.licensePlate || "N/A"} (${so.raw.platform || "N/A"}, ${so.raw.clientName || "N/A"}). OS: ${money(so.total)}, OP: ${money(po.total)}.`,
        so_plate: so.raw.licensePlate, po_plate: po.raw.licensePlate,
        so_platform: so.raw.platform, po_platform: po.raw.platform,
        so_client: so.raw.clientName, po_client: po.raw.clientName,
        so_total: so.total, po_total: po.total,
      }),
    });
    matchedSOIds.add(so.id);
    matchedPOIds.add(po.id);
  }

  // FASE 3/4: sem correspondência → missing
  for (const so of normSOs) {
    if (matchedSOIds.has(so.id)) continue;
    results.push({
      serviceOrderId: so.id,
      paymentOrderId: null,
      matchedBy: "auto",
      confidenceScore: 0,
      differenceAmount: so.total,
      status: "missing",
      notes: JSON.stringify({
        match_reasons: ["no_match"],
        match_type: "no_match",
        explanation: `Sem correspondência: OS ${so.raw.licensePlate || "N/A"} (${so.raw.platform || "N/A"}, ${so.raw.clientName || "N/A"}, ${money(so.total)}).`,
        so_plate: so.raw.licensePlate, so_platform: so.raw.platform,
        so_client: so.raw.clientName, so_total: so.total,
      }),
    });
  }
  for (const po of normPOs) {
    if (matchedPOIds.has(po.id)) continue;
    results.push({
      serviceOrderId: null,
      paymentOrderId: po.id,
      matchedBy: "auto",
      confidenceScore: 0,
      differenceAmount: -po.total,
      status: "missing",
      notes: JSON.stringify({
        match_reasons: ["no_match"],
        match_type: "no_match",
        explanation: `Sem correspondência: OP ${po.raw.licensePlate || "N/A"} (${po.raw.platform || "N/A"}, ${po.raw.clientName || "N/A"}, ${money(po.total)}).`,
        po_plate: po.raw.licensePlate, po_platform: po.raw.platform,
        po_client: po.raw.clientName, po_total: po.total,
      }),
    });
  }

  // Evita duplicar pares SO+PO que já existem como manual/validated/rejected
  // (replica o índice único parcial do Supabase)
  const existingPairs = await prisma.reconciliation.findMany({
    where: { serviceOrderId: { not: null }, paymentOrderId: { not: null } },
    select: { serviceOrderId: true, paymentOrderId: true },
  });
  const pairSet = new Set(existingPairs.map((p) => `${p.serviceOrderId}|${p.paymentOrderId}`));
  const toInsert = results.filter((r) => {
    if (!r.serviceOrderId || !r.paymentOrderId) return true;
    return !pairSet.has(`${r.serviceOrderId}|${r.paymentOrderId}`);
  });

  const inserted = await prisma.reconciliation.createMany({ data: toInsert });

  const summaryResult = {
    total: results.length,
    inserted: inserted.count,
    matched: results.filter((r) => r.status === "matched").length,
    mismatched: results.filter((r) => r.status === "mismatch").length,
    missing: results.filter((r) => r.status === "missing").length,
    pending: 0,
    grouped: results.filter((r) => parseNotes(r.notes).match_type === "grouped_match").length,
    debug: { so_count: serviceOrders.length, po_count: paymentOrders.length },
    debug_sample: debugDecisions.slice(0, 10),
  };

  await emitFinancialEvent({
    eventType: "financial.reconciliation.run",
    entityType: "reconciliation",
    payload: { matched: summaryResult.matched, mismatched: summaryResult.mismatched, missing: summaryResult.missing, year_reference: new Date().getFullYear() },
    actorUserId: req.auth?.userId,
  });

  return res.json(summaryResult);
});

/* ═══════════════════ Confronto OS×OP (port de useConfrontoOSOP) ═══════════════════ */

function extractSOServicesWire(so: any): { name: string; price: number }[] {
  const services: { name: string; price: number }[] = [];
  for (let i = 1; i <= 4; i++) {
    const name = so[`service${i}Name`];
    if (name) services.push({ name, price: Number(so[`service${i}Price`] || 0) });
  }
  return services;
}

function extractPOServicesWire(po: any): { name: string; price: number }[] {
  if (!Array.isArray(po.services)) return [];
  return po.services.map((s: any) => ({
    name: s?.name || s?.service_name || "—",
    price: Number(s?.price || s?.value || 0),
  }));
}

function agingLevel(createdAt: Date): "normal" | "warning" | "critical" {
  const days = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  if (days >= 7) return "critical";
  if (days >= 3) return "warning";
  return "normal";
}

function confrontoScore(so: any, po: any): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  if (normLower(so.clientName) && normLower(po.clientName) && normLower(so.clientName) === normLower(po.clientName)) {
    score += 30;
    reasons.push("cliente");
  } else if (so.clientId && po.clientId && so.clientId === po.clientId) {
    score += 30;
    reasons.push("cliente_id");
  }

  if (normLower(so.platform) && normLower(po.platform) && normLower(so.platform) === normLower(po.platform)) {
    score += 25;
    reasons.push("plataforma");
  }

  if (normLower(so.technicianName) && normLower(po.technicianName) && normLower(so.technicianName) === normLower(po.technicianName)) {
    score += 20;
    reasons.push("técnico");
  } else if (so.assignedUserId && po.assignedUserId && so.assignedUserId === po.assignedUserId) {
    score += 20;
    reasons.push("assigned_user");
  }

  const soPlate = normalizePlate(so.licensePlate);
  const poPlate = normalizePlate(po.licensePlate);
  if (soPlate && poPlate && soPlate === poPlate) {
    score += 15;
    reasons.push("placa");
  }

  const soSvcs = extractSOServicesWire(so).map((s) => normLower(s.name));
  const poSvcs = extractPOServicesWire(po).map((s) => normLower(s.name));
  if (soSvcs.length > 0 && poSvcs.length > 0) {
    const overlap = soSvcs.filter((s) => poSvcs.some((p) => p.includes(s) || s.includes(p))).length;
    const ratio = overlap / Math.max(soSvcs.length, poSvcs.length);
    if (ratio >= 0.5) {
      score += 10;
      reasons.push("serviços");
    }
  }

  return { score, reasons };
}

// GET /finance/confrontation/candidates
financeRouter.get("/confrontation/candidates", requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const [recons, allSO, allPO] = await Promise.all([
    prisma.reconciliation.findMany({ select: { serviceOrderId: true, paymentOrderId: true } }),
    prisma.serviceOrder.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.paymentOrder.findMany({ orderBy: { createdAt: "desc" } }),
  ]);
  const reconSOIds = new Set(recons.map((r) => r.serviceOrderId).filter(Boolean));
  const reconPOIds = new Set(recons.map((r) => r.paymentOrderId).filter(Boolean));

  const freeSO = allSO.filter((so) => !reconSOIds.has(so.id));
  const freePO = allPO.filter((po) => !reconPOIds.has(po.id));

  const candidates: any[] = [];
  const usedPO = new Set<string>();

  for (const so of freeSO) {
    let best: any | null = null;
    for (const po of freePO) {
      if (usedPO.has(po.id)) continue;
      const { score, reasons } = confrontoScore(so, po);
      if (score >= 40 && (!best || score > best.score)) {
        best = {
          so: mapSO(so),
          po: mapPO(po),
          score,
          reasons,
          soServices: extractSOServicesWire(so),
          poServices: extractPOServicesWire(po),
        };
      }
    }
    if (best) {
      candidates.push(best);
      usedPO.add(best.po.id);
    }
  }

  return res.json(candidates.sort((a, b) => b.score - a.score));
});

// POST /finance/confrontation/merge — port do useMergeMatch
financeRouter.post("/confrontation/merge", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { so_id, po_id } = req.body ?? {};
  if (!so_id || !po_id) return res.status(400).json({ message: "so_id e po_id são obrigatórios." });
  const [so, po] = await Promise.all([
    prisma.serviceOrder.findUnique({ where: { id: so_id } }),
    prisma.paymentOrder.findUnique({ where: { id: po_id } }),
  ]);
  if (!so || !po) return res.status(404).json({ message: "OS ou OP não encontrada." });

  const soTotal = Number(so.total || 0);
  const poTotal = Number(po.total || 0);
  const diff = soTotal - poTotal;
  const isExact = Math.abs(diff) < 0.01;

  const notes = JSON.stringify({
    match_type: isExact ? "exact_match" : "value_discrepancy",
    so_total: soTotal,
    po_total: poTotal,
    so_plate: so.licensePlate,
    po_plate: po.licensePlate,
    so_client: so.clientName,
    po_client: po.clientName,
    merged_at: new Date().toISOString(),
    ...(isExact
      ? { cleared: true, cleared_at: new Date().toISOString(), validated: true, validated_at: new Date().toISOString() }
      : {}),
  });

  await prisma.reconciliation.create({
    data: {
      serviceOrderId: so_id,
      paymentOrderId: po_id,
      matchedBy: "manual",
      confidenceScore: 100,
      differenceAmount: diff,
      status: isExact ? "matched" : "mismatch",
      notes,
    },
  });

  return res.json({ isExact, diff });
});

// POST /finance/confrontation/reject
financeRouter.post("/confrontation/reject", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { so_id, po_id } = req.body ?? {};
  if (!so_id || !po_id) return res.status(400).json({ message: "so_id e po_id são obrigatórios." });
  await prisma.reconciliation.create({
    data: {
      serviceOrderId: so_id,
      paymentOrderId: po_id,
      matchedBy: "rejected",
      confidenceScore: 0,
      differenceAmount: 0,
      status: "rejected",
      notes: JSON.stringify({ rejected: true, rejected_at: new Date().toISOString() }),
    },
  });
  return res.status(201).json({ ok: true });
});

// GET /finance/confrontation/pending
financeRouter.get("/confrontation/pending", requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const rows = await loadReconciliationsWithOrders({ status: "mismatch", matchedBy: { in: ["manual", "auto"] } });
  const pending = rows
    .filter((r: any) => {
      const notes = parseNotes(r.notes);
      return !notes.cleared && !notes.validated && r.service_orders && r.payment_orders;
    })
    .map((r: any) => {
      const so = r.service_orders;
      const po = r.payment_orders;
      const soServices: { name: string; price: number }[] = [];
      for (let i = 1; i <= 4; i++) {
        if (so[`service_${i}_name`]) soServices.push({ name: so[`service_${i}_name`], price: Number(so[`service_${i}_price`] || 0) });
      }
      const poServices = Array.isArray(po.services)
        ? po.services.map((s: any) => ({ name: s?.name || s?.service_name || "—", price: Number(s?.price || s?.value || 0) }))
        : [];
      const totalSO = Number(so.total || 0);
      const totalPO = Number(po.total || 0);
      return {
        id: r.id,
        so,
        po,
        soServices,
        poServices,
        totalSO,
        totalPO,
        difference: totalSO - totalPO,
        created_at: r.created_at,
        aging_level: agingLevel(new Date(r.created_at)),
      };
    });
  return res.json(pending);
});

// POST /finance/confrontation/validate — port do useValidatePending
financeRouter.post("/confrontation/validate", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { id, difference } = req.body ?? {};
  if (!id) return res.status(400).json({ message: "id é obrigatório." });
  const current = await prisma.reconciliation.findUnique({ where: { id } });
  if (!current) return res.status(404).json({ message: "Reconciliação não encontrada." });

  const diff = Number(difference ?? current.differenceAmount ?? 0);
  const updatedNotes = JSON.stringify({
    ...parseNotes(current.notes),
    validated: true,
    validated_at: new Date().toISOString(),
    cleared: true,
    cleared_at: new Date().toISOString(),
    financial_adjustment: diff,
    adjustment_reason: "Divergência validada e aceite como paga",
  });

  await prisma.reconciliation.update({
    where: { id },
    data: { notes: updatedNotes, status: "matched", matchedBy: "validated" },
  });

  if (Math.abs(diff) > 0.01) {
    await prisma.financialRecord.create({
      data: {
        type: "adjustment",
        source: "reconciliation",
        amount: Math.abs(diff),
        status: "resolved",
        notes: `Ajuste financeiro interno: divergência de €${Math.abs(diff).toFixed(2)} validada`,
        category: "adjustment",
      },
    });
  }

  await emitFinancialEvent({
    eventType: "reconciliation.validated",
    entityType: "reconciliation",
    entityId: id,
    payload: { difference: diff, year_reference: new Date().getFullYear() },
    actorUserId: req.auth?.userId,
  });

  return res.json({ ok: true });
});

// GET /finance/confrontation/history
financeRouter.get("/confrontation/history", requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const rows = await loadReconciliationsWithOrders();
  const fifteenDaysAgo = Date.now() - 15 * 24 * 60 * 60 * 1000;
  const history = rows
    .filter((r: any) => {
      const notes = parseNotes(r.notes);
      return (notes.cleared || notes.validated) && r.service_orders && r.payment_orders;
    })
    .filter((r: any) => {
      const notes = parseNotes(r.notes);
      const resolvedAt = notes.cleared_at || notes.validated_at || r.created_at;
      return new Date(resolvedAt).getTime() > fifteenDaysAgo;
    })
    .map((r: any) => {
      const notes = parseNotes(r.notes);
      return {
        id: r.id,
        so_plate: r.service_orders?.license_plate || "—",
        po_plate: r.payment_orders?.license_plate || "—",
        so_client: r.service_orders?.client_name || "—",
        po_client: r.payment_orders?.client_name || "—",
        totalSO: Number(r.service_orders?.total || 0),
        totalPO: Number(r.payment_orders?.total || 0),
        difference: Number(r.difference_amount || 0),
        resolved_at: notes.cleared_at || notes.validated_at || r.created_at,
        action: notes.validated ? "validated" : "cleared",
        created_at: r.created_at,
      };
    });
  return res.json(history);
});

/* ═══════════════════ Resumo financeiro (port de useReconciliationSummary) ═══════════════════ */

financeRouter.get("/summary", requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const [serviceOrders, paymentOrders, reconciliations, financialRecords] = await Promise.all([
    prisma.serviceOrder.findMany({ select: { total: true, status: true, clientName: true, technicianName: true, platform: true, createdAt: true } }),
    prisma.paymentOrder.findMany({ select: { total: true, status: true, clientName: true, technicianName: true, platform: true, createdAt: true } }),
    prisma.reconciliation.findMany({ select: { status: true, notes: true } }),
    prisma.financialRecord.findMany({ select: { amount: true, type: true, createdAt: true } }),
  ]);

  const realExpenses = financialRecords.filter((r) => r.type === "expense");
  const expenses = realExpenses.reduce((s, r) => s + Number(r.amount || 0), 0);

  const expectedRevenue = serviceOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const receivedRevenue = paymentOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const totalDifference = expectedRevenue - receivedRevenue;
  const discrepancyPct = expectedRevenue > 0 ? (Math.abs(totalDifference) / expectedRevenue) * 100 : 0;

  const matched = reconciliations.filter((r) => r.status === "matched").length;
  const mismatched = reconciliations.filter((r) => r.status === "mismatch").length;
  const missing = reconciliations.filter((r) => r.status === "missing").length;
  const pending = reconciliations.filter((r) => r.status === "pending").length;

  const activeDiscrepancies = reconciliations.filter((r) => {
    const notes = parseNotes(r.notes);
    return !notes.cleared && (r.status === "mismatch" || r.status === "missing");
  }).length;

  const profit = receivedRevenue - expenses;

  const monthlyData: Record<string, { so: number; po: number; expenses: number }> = {};
  const monthOf = (d: Date) => d.toISOString().slice(0, 7);
  for (const so of serviceOrders) {
    const month = monthOf(so.createdAt);
    (monthlyData[month] ??= { so: 0, po: 0, expenses: 0 }).so += Number(so.total || 0);
  }
  for (const po of paymentOrders) {
    const month = monthOf(po.createdAt);
    (monthlyData[month] ??= { so: 0, po: 0, expenses: 0 }).po += Number(po.total || 0);
  }
  for (const fr of realExpenses) {
    const month = monthOf(fr.createdAt);
    (monthlyData[month] ??= { so: 0, po: 0, expenses: 0 }).expenses += Number(fr.amount || 0);
  }
  const monthly = Object.entries(monthlyData)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, d]) => ({ month, expected: d.so, received: d.po, expenses: d.expenses }));

  const accumulate = (map: Record<string, { name: string; expected: number; received: number }>, name: string, field: "expected" | "received", value: number) => {
    (map[name] ??= { name, expected: 0, received: 0 })[field] += value;
  };
  const byClient: Record<string, { name: string; expected: number; received: number }> = {};
  const byTechnician: Record<string, { name: string; expected: number; received: number }> = {};
  const byPlatform: Record<string, { name: string; expected: number; received: number }> = {};
  for (const so of serviceOrders) {
    accumulate(byClient, so.clientName || "Desconhecido", "expected", Number(so.total || 0));
    accumulate(byTechnician, so.technicianName || "Desconhecido", "expected", Number(so.total || 0));
    accumulate(byPlatform, so.platform || "Desconhecido", "expected", Number(so.total || 0));
  }
  for (const po of paymentOrders) {
    accumulate(byClient, po.clientName || "Desconhecido", "received", Number(po.total || 0));
    accumulate(byTechnician, po.technicianName || "Desconhecido", "received", Number(po.total || 0));
    accumulate(byPlatform, po.platform || "Desconhecido", "received", Number(po.total || 0));
  }

  const alerts: { type: string; message: string; severity: "high" | "medium" | "low" }[] = [];
  if (serviceOrders.length === 0 && paymentOrders.length === 0) {
    alerts.push({ type: "empty", message: "Nenhuma ordem de serviço ou pagamento encontrada. Importe dados primeiro.", severity: "medium" });
  } else {
    if (missing > 0) alerts.push({ type: "missing", message: `${missing} registros sem correspondência`, severity: "high" });
    if (mismatched > 0) alerts.push({ type: "mismatch", message: `${mismatched} divergências de valor detectadas`, severity: "medium" });
    if (discrepancyPct > 10) alerts.push({ type: "high_discrepancy", message: `Taxa de discrepância: ${discrepancyPct.toFixed(1)}%`, severity: "high" });
  }

  return res.json({
    expectedRevenue,
    receivedRevenue,
    totalDifference,
    discrepancyPct: Math.round(discrepancyPct * 10) / 10,
    matched,
    mismatched,
    missing,
    pending,
    expenses,
    profit,
    monthly,
    activeDiscrepancies,
    byClient: Object.values(byClient).sort((a, b) => b.expected - a.expected),
    byTechnician: Object.values(byTechnician).sort((a, b) => b.expected - a.expected),
    byPlatform: Object.values(byPlatform).sort((a, b) => b.expected - a.expected),
    alerts,
    serviceOrderCount: serviceOrders.length,
    paymentOrderCount: paymentOrders.length,
  });
});

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

// GET /finance/profit-rules
financeRouter.get("/profit-rules", requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const rules = await prisma.profitRule.findMany({ include: { items: true }, orderBy: { createdAt: "asc" } });
  return res.json(rules.map(mapProfitRule));
});

// POST /finance/profit-rules — salva regra + itens + distribuições + earnings (transacional)
financeRouter.post("/profit-rules", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const b = req.body ?? {};
  const ruleName = String(b.rule_name ?? "").trim();
  const groupIds: string[] = Array.from(new Set((Array.isArray(b.group_ids) ? b.group_ids : []).filter(Boolean)));
  const isActive = b.is_active !== false;
  const participants: { participant_name: string; percentage: number; participant_type: string }[] = (
    Array.isArray(b.items) ? b.items : []
  ).map((it: any) => ({
    participant_name: String(it.participant_name ?? "").trim(),
    percentage: Number(it.percentage) || 0,
    participant_type: it.participant_type || "other",
  }));

  if (!ruleName) return res.status(400).json({ message: "Nome da regra é obrigatório" });
  if (groupIds.length === 0) return res.status(400).json({ message: "Selecione pelo menos um grupo" });
  const totalPct = participants.reduce((s, p) => s + p.percentage, 0);
  if (totalPct !== 100) return res.status(400).json({ message: "A soma das percentagens deve ser 100%" });

  const existingId: string | null = b.id && !b.is_new ? String(b.id) : null;

  const result = await prisma.$transaction(async (tx) => {
    let ruleId: string;
    if (existingId) {
      await tx.profitRule.update({
        where: { id: existingId },
        data: { ruleName, groupIds, isActive },
      });
      ruleId = existingId;
    } else {
      const created = await tx.profitRule.create({
        data: { ruleName, groupIds, isActive, createdBy: req.auth?.userId ?? null },
      });
      ruleId = created.id;
    }

    await tx.profitRuleItem.deleteMany({ where: { ruleId } });
    await tx.profitRuleItem.createMany({
      data: participants.map((p) => ({
        ruleId,
        participantName: p.participant_name,
        percentage: p.percentage,
        participantType: p.participant_type,
      })),
    });

    // Recalcula distribuições das OS dos grupos vinculados
    const allSOs = await tx.serviceOrder.findMany({ where: { groupId: { in: groupIds } } });
    if (allSOs.length > 0) {
      const soIds = allSOs.map((so) => so.id);
      await tx.serviceOrderDistribution.deleteMany({ where: { serviceOrderId: { in: soIds } } });

      const pctsArr = participants.map((p) => p.percentage);
      const distRows = allSOs.flatMap((so) => {
        const parts = splitCents(toCents(so.total), pctsArr);
        return participants.map((p, i) => ({
          serviceOrderId: so.id,
          participantName: p.participant_name,
          percentage: p.percentage,
          calculatedValue: parts[i] / 100,
        }));
      });
      if (distRows.length > 0) {
        await tx.serviceOrderDistribution.createMany({ data: distRows });
      }

      const techIdx = participants.findIndex((p) => p.participant_type === "technician");
      for (const so of allSOs) {
        const parts = splitCents(toCents(so.total), pctsArr);
        const data: Record<string, unknown> = {};
        if (techIdx >= 0) {
          data.technicianPercentage = participants[techIdx].percentage;
          data.technicianEarning = parts[techIdx] / 100;
        }
        // Snapshot imutável: só materializa se ainda não existir (replica o trigger freeze_distribution_snapshot)
        if (so.distributionSnapshot == null) {
          data.distributionSnapshot = participants.map((p, i) => ({
            participant_name: p.participant_name,
            percentage: p.percentage,
            calculated_value: parts[i] / 100,
          }));
        }
        if (Object.keys(data).length > 0) {
          await tx.serviceOrder.update({ where: { id: so.id }, data });
        }
      }
    }

    return ruleId;
  });

  await emitFinancialEvent({
    eventType: "participation.updated",
    entityType: "profit_rule",
    entityId: result,
    payload: { rule_name: ruleName, group_ids: groupIds, participants, year_reference: new Date().getFullYear() },
    actorUserId: req.auth?.userId,
  });

  const rule = await prisma.profitRule.findUnique({ where: { id: result }, include: { items: true } });
  return res.status(201).json(mapProfitRule(rule));
});

// DELETE /finance/profit-rules/:id
financeRouter.delete("/profit-rules/:id", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  await prisma.profitRule.delete({ where: { id: req.params["id"] as string } });
  return res.status(204).end();
});

// DELETE /finance/profit-rules — todas
financeRouter.delete("/profit-rules", requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const result = await prisma.profitRule.deleteMany({});
  return res.json({ deleted: result.count });
});

/* ═══════════════════ Fonte da agregação por participante (useParticipantAggregation) ═══════════════════ */

// GET /finance/aggregation-source
financeRouter.get("/aggregation-source", requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const [serviceOrders, rules, items] = await Promise.all([
    prisma.serviceOrder.findMany({
      select: {
        id: true, total: true, status: true, groupId: true, week: true,
        distributionSnapshot: true, carName: true, licensePlate: true, yearReference: true,
      },
    }),
    prisma.profitRule.findMany({ where: { isActive: true }, select: { id: true, groupIds: true, isActive: true } }),
    prisma.profitRuleItem.findMany({ select: { ruleId: true, participantName: true, percentage: true } }),
  ]);
  return res.json({
    service_orders: serviceOrders.map((so) => ({
      id: so.id,
      total: so.total,
      status: so.status,
      group_id: so.groupId,
      week: so.week,
      year_reference: so.yearReference,
      distribution_snapshot: so.distributionSnapshot ?? null,
      car_name: so.carName,
      license_plate: so.licensePlate,
    })),
    profit_rules: rules.map((r) => ({ id: r.id, group_ids: r.groupIds ?? [], is_active: r.isActive })),
    profit_rule_items: items.map((it) => ({ rule_id: it.ruleId, participant_name: it.participantName, percentage: it.percentage })),
  });
});

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

// GET /finance/participation/summary?year=
financeRouter.get("/participation/summary", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const year = req.query["year"] ? Number(req.query["year"]) : null;
  const rows = await loadParticipationRows(year);

  const byKey = new Map<string, any>();
  for (const r of rows) {
    if (r.participant_type === "client") continue;
    const key = `${r.participant_name}|${r.participant_type}`;
    const agg = byKey.get(key) ?? {
      workspace_id: r.workspace_id,
      year_reference: year,
      participant_name: r.participant_name,
      participant_type: r.participant_type,
      participant_user_id: null,
      expected: 0,
      received: 0,
      pending: 0,
      pending_count: 0,
      partial_count: 0,
      paid_count: 0,
      os_count: 0,
      _soIds: new Set<string>(),
    };
    agg.expected += r.expected_amount;
    agg.received += r.received_amount;
    agg.pending += r.pending_amount;
    if (r.status === "pending") agg.pending_count += 1;
    else if (r.status === "partial") agg.partial_count += 1;
    else if (r.status === "paid") agg.paid_count += 1;
    agg._soIds.add(r.service_order_id);
    byKey.set(key, agg);
  }

  const summary = [...byKey.values()].map((a) => {
    a.os_count = a._soIds.size;
    delete a._soIds;
    a.expected = Math.round(a.expected * 100) / 100;
    a.received = Math.round(a.received * 100) / 100;
    a.pending = Math.round(a.pending * 100) / 100;
    return a;
  });

  return res.json(summary);
});

// GET /finance/participation/detail?name=&year=
financeRouter.get("/participation/detail", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const name = req.query["name"] as string | undefined;
  if (!name) return res.status(400).json({ message: "name é obrigatório." });
  const year = req.query["year"] ? Number(req.query["year"]) : null;
  const rows = await loadParticipationRows(year);
  return res.json(rows.filter((r) => r.participant_name === name && r.participant_type !== "client"));
});

/* ═══════════════════ Auditoria (timeline de eventos + resumo de integridade) ═══════════════════ */

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
financeRouter.post("/integrity/run", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const year = Number(req.body?.year ?? new Date().getFullYear());
  const runId = randomUUID();
  let critical = 0;
  let warning = 0;
  const info = 0;

  const existing = await prisma.financialIntegrityIssue.findMany({
    where: { status: { not: "resolved" }, hash: { not: null } },
    select: { hash: true },
  });
  const existingHashes = new Set(existing.map((e) => e.hash));

  const newIssues: any[] = [];
  const pushIssue = (issue: {
    workspaceId?: string | null;
    severity: "info" | "warning" | "critical";
    issueType: string;
    entityType: string;
    entityId?: string | null;
    hash: string;
    details: Record<string, unknown>;
  }) => {
    if (existingHashes.has(issue.hash)) return;
    existingHashes.add(issue.hash);
    newIssues.push({
      workspaceId: issue.workspaceId ?? null,
      yearReference: year,
      severity: issue.severity,
      issueType: issue.issueType,
      entityType: issue.entityType,
      entityId: issue.entityId ?? null,
      hash: issue.hash,
      detailsJson: issue.details,
    });
    if (issue.severity === "critical") critical += 1;
    else if (issue.severity === "warning") warning += 1;
  };

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

  const [events, frs, sos, pos, dists] = await Promise.all([
    prisma.financialEvent.findMany({
      where: { eventHash: { not: null }, createdAt: { gte: yearStart, lt: yearEnd } },
      select: { id: true, workspaceId: true, eventHash: true },
    }),
    prisma.financialRecord.findMany({
      select: { id: true, workspaceId: true, yearReference: true, serviceOrderId: true, paymentOrderId: true, createdAt: true, type: true, amount: true },
    }),
    prisma.serviceOrder.findMany({ select: { id: true, workspaceId: true, total: true, createdAt: true } }),
    prisma.paymentOrder.findMany({ select: { id: true, workspaceId: true, total: true, createdAt: true } }),
    prisma.serviceOrderDistribution.findMany({ select: { id: true, serviceOrderId: true, percentage: true, calculatedValue: true } }),
  ]);

  const frYear = (fr: (typeof frs)[number]) => fr.yearReference ?? fr.createdAt.getUTCFullYear();
  const frsOfYear = frs.filter((fr) => frYear(fr) === year);
  const sosOfYear = sos.filter((so) => so.createdAt.getUTCFullYear() === year);
  const posOfYear = pos.filter((po) => po.createdAt.getUTCFullYear() === year);
  const soIdSet = new Set(sos.map((s) => s.id));
  const poIdSet = new Set(pos.map((p) => p.id));

  // CHECK 1: eventos duplicados por hash
  const byHash = new Map<string, { count: number; firstId: string; workspaceId: string | null }>();
  for (const e of events) {
    const cur = byHash.get(e.eventHash!) ?? { count: 0, firstId: e.id, workspaceId: e.workspaceId };
    cur.count += 1;
    byHash.set(e.eventHash!, cur);
  }
  for (const [hash, v] of byHash) {
    if (v.count > 1) {
      pushIssue({
        workspaceId: v.workspaceId,
        severity: "critical",
        issueType: "duplicate_event",
        entityType: "financial_events",
        entityId: v.firstId,
        hash: `dup_event_${hash}`,
        details: { event_hash: hash, count: v.count },
      });
    }
  }

  // CHECK 2a: financial_records sem workspace
  for (const fr of frsOfYear) {
    if (!fr.workspaceId) {
      pushIssue({
        severity: "warning",
        issueType: "orphan_record",
        entityType: "financial_records",
        entityId: fr.id,
        hash: `orphan_fr_${fr.id}`,
        details: { reason: "missing_workspace_id" },
      });
    }
  }

  // CHECK 2b/2c: financial_records com referência a OS/OP inexistente
  for (const fr of frsOfYear) {
    if (fr.serviceOrderId && !soIdSet.has(fr.serviceOrderId)) {
      pushIssue({
        workspaceId: fr.workspaceId,
        severity: "critical",
        issueType: "missing_reference",
        entityType: "financial_records",
        entityId: fr.id,
        hash: `fr_missing_so_${fr.id}`,
        details: { service_order_id: fr.serviceOrderId },
      });
    }
    if (fr.paymentOrderId && !poIdSet.has(fr.paymentOrderId)) {
      pushIssue({
        workspaceId: fr.workspaceId,
        severity: "critical",
        issueType: "missing_reference",
        entityType: "financial_records",
        entityId: fr.id,
        hash: `fr_missing_po_${fr.id}`,
        details: { payment_order_id: fr.paymentOrderId },
      });
    }
  }

  // CHECK 2d: distribuições órfãs
  for (const d of dists) {
    if (!soIdSet.has(d.serviceOrderId)) {
      pushIssue({
        severity: "critical",
        issueType: "orphan_record",
        entityType: "service_order_distributions",
        entityId: d.id,
        hash: `sod_orphan_${d.id}`,
        details: { service_order_id: d.serviceOrderId },
      });
    }
  }

  // CHECK 5: soma de participação inválida (> 100.5%)
  const soById = new Map(sos.map((s) => [s.id, s]));
  const pctBySo = new Map<string, number>();
  for (const d of dists) pctBySo.set(d.serviceOrderId, (pctBySo.get(d.serviceOrderId) ?? 0) + Number(d.percentage || 0));
  for (const [soId, sum] of pctBySo) {
    const so = soById.get(soId);
    if (!so || so.createdAt.getUTCFullYear() !== year) continue;
    if (sum > 100.5 || sum < -0.01) {
      pushIssue({
        workspaceId: so.workspaceId,
        severity: "warning",
        issueType: "invalid_participation",
        entityType: "service_orders",
        entityId: soId,
        hash: `part_sum_${soId}`,
        details: { sum_pct: Math.round(sum * 100) / 100 },
      });
    }
  }

  // CHECK 6: valores negativos impossíveis
  for (const so of sosOfYear) {
    if (Number(so.total ?? 0) < 0) {
      pushIssue({
        workspaceId: so.workspaceId,
        severity: "critical",
        issueType: "impossible_amount",
        entityType: "service_orders",
        entityId: so.id,
        hash: `neg_so_${so.id}`,
        details: { total: so.total },
      });
    }
  }
  for (const po of posOfYear) {
    if (Number(po.total ?? 0) < 0) {
      pushIssue({
        workspaceId: po.workspaceId,
        severity: "critical",
        issueType: "impossible_amount",
        entityType: "payment_orders",
        entityId: po.id,
        hash: `neg_po_${po.id}`,
        details: { total: po.total },
      });
    }
  }

  if (newIssues.length > 0) {
    await prisma.financialIntegrityIssue.createMany({ data: newIssues });
  }

  // Snapshot agregado
  const totalExpected = sosOfYear.reduce((s, so) => s + Number(so.total || 0), 0);
  const totalReceived = posOfYear.reduce((s, po) => s + Number(po.total || 0), 0);
  const totalDistributed = dists
    .filter((d) => {
      const so = soById.get(d.serviceOrderId);
      return so && so.createdAt.getUTCFullYear() === year;
    })
    .reduce((s, d) => s + Number(d.calculatedValue || 0), 0);
  const totalExpenses = frsOfYear.filter((fr) => fr.type === "expense").reduce((s, fr) => s + Number(fr.amount || 0), 0);

  await prisma.financialIntegritySnapshot.create({
    data: {
      workspaceId: null,
      yearReference: year,
      snapshotType: "check_run",
      snapshotHash: createHash("sha256").update(`${runId}${year}`).digest("hex"),
      totalReceived,
      totalExpected,
      totalPending: Math.max(totalExpected - totalReceived, 0),
      totalDistributed,
      totalExpenses,
      totalProfit: totalReceived - totalExpenses,
      totalOs: sosOfYear.length,
      totalOp: posOfYear.length,
    },
  });

  await emitFinancialEvent({
    eventType: "financial.integrity.run",
    entityType: "financial_integrity_issues",
    entityId: runId,
    payload: { year_reference: year, critical, warning, info, totals: { expected: totalExpected, received: totalReceived } },
    actorUserId: req.auth?.userId,
  });

  return res.json({
    run_id: runId,
    year_reference: year,
    critical,
    warning,
    info,
    totals: { expected: totalExpected, received: totalReceived },
  });
});

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
