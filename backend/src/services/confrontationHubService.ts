import { Prisma, type ConfrontationDecision, type ConfrontationStatus } from "@prisma/client";
import * as xlsx from "xlsx";
import { prisma } from "../lib/prisma.js";
import { ForbiddenError, NotFoundError, UnprocessableEntityError } from "../lib/objectAuth.js";
import type { RequestContext } from "../middleware/requestContext.js";
import { aiImportExtractionProvider } from "./externalImportAdapters.js";

function requireWorkspace(ctx: RequestContext): string {
  if (!ctx.activeWorkspaceId) throw new ForbiddenError("Workspace ativo não definido.");
  return ctx.activeWorkspaceId;
}

export function normalizePlate(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{5,16}$/.test(normalized) ? normalized : null;
}

export function normalizeVin(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-HJ-NPR-Z0-9]{11,17}$/.test(normalized) ? normalized : null;
}

export interface ConfrontationColumnMapping {
  plateColumn?: string;
  vinColumn?: string;
  serviceColumn?: string;
  amountColumn?: string;
  taxType: "HT" | "TTC";
  granularity: "auto" | "synthetic" | "analytic";
}

export interface ConfrontationFilePreview {
  fileName: string;
  columns: string[];
  suggestedMapping: ConfrontationColumnMapping;
  rawRows: Record<string, any>[];
  sampleRows: Record<string, any>[];
  totalRows: number;
}

export interface ExternalConfrontationRow {
  licensePlate?: string | null;
  vin?: string | null;
  serviceDescription?: string | null;
  amount: number | string;
  taxType?: "HT" | "TTC";
  rawRow?: Record<string, any>;
}

export interface ExecuteConfrontationInput {
  clientId: string;
  period?: string; // e.g. "2026-W41"
  paymentListId?: string;
  granularity?: "auto" | "synthetic" | "analytic";
  taxType?: "HT" | "TTC";
  rows: ExternalConfrontationRow[];
}

export interface ConfrontationItemResult {
  id: string;
  licensePlate: string;
  vin: string | null;
  carName: string | null;
  serviceDescription: string;
  internalAmount: string;
  externalAmount: string;
  differenceAmount: string;
  status:
    | "exact_match"
    | "value_difference"
    | "service_discrepancy"
    | "omitted_by_client"
    | "in_production"
    | "vehicle_not_found"
    | "validated_pending_list"
    | "ambiguous_match";
  decision: "none" | "contest" | "accept_difference" | "resolve" | "pending";
  decisionNotes?: string | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  weeklogId?: string | null;
  weeklogSignatureRef?: string | null;
  paymentListId?: string | null;
}

export interface ConfrontationSummaryMetrics {
  totalCompared: number;
  exactMatchCount: number;
  valueDifferenceCount: number;
  omittedByClientCount: number;
  inProductionCount: number;
  notFoundCount: number;
  totalInternalAmount: string;
  totalExternalAmount: string;
  netDifferenceAmount: string;
}

export interface ConfrontationExecutionResponse {
  runId: string;
  sequence: number;
  createdAt: string;
  client: { id: string; name: string };
  period?: string | null;
  paymentList?: { id: string; listNumber: string } | null;
  granularityUsed: "synthetic" | "analytic";
  metrics: ConfrontationSummaryMetrics;
  results: ConfrontationItemResult[];
}

/**
 * 1. Preview and Column Detection
 */
export async function previewConfrontationFile(
  ctx: RequestContext,
  file: { fileName: string; mimeType: string; bytes: Buffer }
): Promise<ConfrontationFilePreview> {
  requireWorkspace(ctx);

  const isExcelOrCsv =
    file.fileName.endsWith(".xlsx") ||
    file.fileName.endsWith(".xls") ||
    file.fileName.endsWith(".csv") ||
    file.mimeType.includes("spreadsheet") ||
    file.mimeType.includes("excel") ||
    file.mimeType.includes("csv");

  if (isExcelOrCsv) {
    const workbook = xlsx.read(file.bytes, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new UnprocessableEntityError("O arquivo de planilha não contém abas.");
    const sheet = workbook.Sheets[sheetName];
    const rawRows = xlsx.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });

    if (rawRows.length === 0) {
      throw new UnprocessableEntityError("A planilha enviada está vazia.");
    }

    const columns = Object.keys(rawRows[0] || {});
    const mapping = detectMappingHeuristics(columns, rawRows);

    return {
      fileName: file.fileName,
      columns,
      suggestedMapping: mapping,
      rawRows,
      sampleRows: rawRows.slice(0, 5),
      totalRows: rawRows.length,
    };
  }

  // Fallback for PDF: use AI extraction provider
  const extracted = await aiImportExtractionProvider.extractListDocument({
    bytes: file.bytes,
    mimeType: file.mimeType as any,
    fileName: file.fileName,
  });

  const convertedRows = extracted.rows.map((r: any) => ({
    "Placa": r.rawLicensePlate || r.licensePlate || "",
    "VIN": r.rawVin || r.vin || "",
    "Serviço": Array.isArray(r.rawServices)
      ? r.rawServices.map((s: any) => s.description || s.name || "").join(", ")
      : Array.isArray(r.services)
        ? r.services.map((s: any) => s.name || s.description || "").join(", ")
        : "",
    "Valor": r.rawTotalText || r.totalAmount || "0",
  }));

  const columns = ["Placa", "VIN", "Serviço", "Valor"];
  return {
    fileName: file.fileName,
    columns,
    suggestedMapping: {
      plateColumn: "Placa",
      vinColumn: "VIN",
      serviceColumn: "Serviço",
      amountColumn: "Valor",
      taxType: "HT",
      granularity: "auto",
    },
    rawRows: convertedRows,
    sampleRows: convertedRows.slice(0, 5),
    totalRows: convertedRows.length,
  };
}

function detectMappingHeuristics(columns: string[], rows: Record<string, any>[]): ConfrontationColumnMapping {
  const normCols = columns.map((c) => ({
    original: c,
    norm: c.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim(),
  }));

  // Detect Plate
  const plateCandidates = ["immatriculation", "plaque", "placa", "matricula", "vehicule", "veiculo", "auto", "rego"];
  const plateCol = normCols.find((c) => plateCandidates.some((k) => c.norm.includes(k)))?.original;

  // Detect VIN
  const vinCandidates = ["vin", "chassis", "n chassis", "numero chassis"];
  const vinCol = normCols.find((c) => vinCandidates.some((k) => c.norm === k || c.norm.includes(k)))?.original;

  // Detect Service
  const serviceCandidates = ["prestation", "intervention", "designation", "service", "servico", "operation", "description", "travaux"];
  const serviceCol = normCols.find((c) => serviceCandidates.some((k) => c.norm.includes(k)))?.original;

  // Detect Amount
  const amountCandidates = ["montant ht", "total ht", "valor ht", "montant ttc", "total ttc", "montant", "total", "valor", "prix", "net"];
  const amountCol = normCols.find((c) => amountCandidates.some((k) => c.norm.includes(k)))?.original;

  // Tax Type
  let taxType: "HT" | "TTC" = "HT";
  if (amountCol) {
    const l = amountCol.toLowerCase();
    if (l.includes("ttc") || l.includes("com imposto")) taxType = "TTC";
  }

  // Detect Granularity: check if license plates repeat in rows
  let granularity: "auto" | "synthetic" | "analytic" = "auto";
  if (plateCol && rows.length > 1) {
    const plates = rows.map((r) => String(r[plateCol] || "").trim()).filter(Boolean);
    const uniquePlates = new Set(plates);
    if (plates.length > uniquePlates.size) {
      granularity = "analytic"; // Has repeated plates for separate service lines
    } else {
      granularity = "synthetic"; // Each row is a distinct vehicle total
    }
  }

  return {
    plateColumn: plateCol || columns[0],
    vinColumn: vinCol,
    serviceColumn: serviceCol,
    amountColumn: amountCol,
    taxType,
    granularity,
  };
}

function extractSignatureRef(weeklog: any): string | null {
  if (!weeklog) return null;
  const validation = weeklog.validations?.[0];
  if (validation) {
    return validation.signatureStoragePath ? `WL-${weeklog.id}-SIG` : `WL-${weeklog.id}`;
  }
  return weeklog.status === "validated" ? `WL-${weeklog.id}` : null;
}

/**
 * 2. Execute Confrontation Engine
 */
export async function executeConfrontationHub(
  ctx: RequestContext,
  input: ExecuteConfrontationInput
): Promise<ConfrontationExecutionResponse> {
  const ws = requireWorkspace(ctx);

  const client = await prisma.client.findFirst({
    where: { id: input.clientId, workspaceId: ws },
    select: { id: true, name: true },
  });
  if (!client) throw new NotFoundError("Cliente não encontrado.");

  // Fetch pre-existing PaymentList if specified or available for client/period
  let targetPaymentList: any = null;
  if (input.paymentListId) {
    targetPaymentList = await prisma.paymentList.findFirst({
      where: { id: input.paymentListId, workspaceId: ws, clientId: input.clientId },
      include: { items: true },
    });
  } else {
    targetPaymentList = await prisma.paymentList.findFirst({
      where: {
        workspaceId: ws,
        clientId: input.clientId,
        status: { in: ["draft", "under_review", "confronted", "pending"] },
      },
      include: { items: true },
      orderBy: { createdAt: "desc" },
    });
  }

  // Fetch approved WeeklogEntries for client
  const weeklogEntries = await prisma.weeklogEntry.findMany({
    where: {
      workspaceId: ws,
      clientId: input.clientId,
      validationStatus: "approved",
      weeklog: { status: "validated" },
    },
    include: {
      weeklog: {
        include: {
          validations: {
            where: { status: "validated" },
            orderBy: { validationSequence: "desc" },
            take: 1,
          },
        },
      },
      productionOrder: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // Fetch In-Progress / Unvalidated Orders for client
  const inProgressOrders = await prisma.productionOrder.findMany({
    where: {
      workspaceId: ws,
      clientId: input.clientId,
      status: { in: ["in_production", "paused", "ready"] },
    },
    select: {
      id: true,
      licensePlate: true,
      vin: true,
      brand: true,
      model: true,
      status: true,
    },
  });

  // Determine Granularity
  const externalPlates = input.rows.map((r) => normalizePlate(r.licensePlate)).filter(Boolean) as string[];
  const uniqueExternalPlates = new Set(externalPlates);
  const detectedGranularity: "synthetic" | "analytic" =
    input.granularity && input.granularity !== "auto"
      ? input.granularity
      : externalPlates.length > uniqueExternalPlates.size
        ? "analytic"
        : "synthetic";

  // Build Internal Catalog of Vehicles
  type InternalRecord = {
    licensePlate: string;
    vin: string | null;
    carName: string | null;
    totalAmount: Prisma.Decimal;
    services: Array<{ description: string; amount: Prisma.Decimal }>;
    hasPaymentListItem: boolean;
    paymentListItemId?: string;
    weeklogId?: string | null;
    weeklogSignatureRef?: string | null;
  };

  const internalByPlate = new Map<string, InternalRecord>();

  // 1. First populate from PaymentList if exists (Precedência 1: Lista Interna)
  if (targetPaymentList?.items) {
    for (const item of targetPaymentList.items) {
      const p = normalizePlate(item.licensePlate);
      if (!p) continue;
      const amount = new Prisma.Decimal(item.totalAmount ?? 0);
      const servicesList: Array<{ description: string; amount: Prisma.Decimal }> = [];
      if (Array.isArray(item.servicesSnapshot)) {
        for (const s of item.servicesSnapshot) {
          if (s && typeof s === "object") {
            const desc = String((s as any).description || (s as any).name || "Serviço");
            const price = new Prisma.Decimal((s as any).total || (s as any).unitPrice || 0);
            servicesList.push({ description: desc, amount: price });
          }
        }
      }
      internalByPlate.set(p, {
        licensePlate: p,
        vin: normalizeVin(item.vin),
        carName: item.carName || null,
        totalAmount: amount,
        services: servicesList,
        hasPaymentListItem: true,
        paymentListItemId: item.id,
      });
    }
  }

  // 2. Supplement from validated WeeklogEntries (Precedência 2: WEEKLOG validada)
  for (const entry of weeklogEntries) {
    const p = normalizePlate(entry.licensePlate);
    if (!p) continue;
    if (!internalByPlate.has(p)) {
      const amount = new Prisma.Decimal(entry.totalAmount ?? 0);
      const servicesList: Array<{ description: string; amount: Prisma.Decimal }> = [];
      if (Array.isArray(entry.servicesSnapshot)) {
        for (const s of entry.servicesSnapshot) {
          if (s && typeof s === "object") {
            const desc = String((s as any).description || (s as any).name || "Serviço");
            const price = new Prisma.Decimal((s as any).total || (s as any).unitPrice || 0);
            servicesList.push({ description: desc, amount: price });
          }
        }
      }
      internalByPlate.set(p, {
        licensePlate: p,
        vin: normalizeVin(entry.vin),
        carName: entry.productionOrder ? `${entry.productionOrder.brand || ""} ${entry.productionOrder.model || ""}`.trim() : null,
        totalAmount: amount,
        services: servicesList,
        hasPaymentListItem: false,
        weeklogId: entry.weeklogId,
        weeklogSignatureRef: extractSignatureRef(entry.weeklog),
      });
    } else {
      const existing = internalByPlate.get(p)!;
      if (!existing.weeklogId && entry.weeklogId) {
        existing.weeklogId = entry.weeklogId;
        existing.weeklogSignatureRef = extractSignatureRef(entry.weeklog);
      }
    }
  }

  // Group external rows by plate
  const externalByPlate = new Map<string, ExternalConfrontationRow[]>();
  for (const row of input.rows) {
    const p = normalizePlate(row.licensePlate) || "UNKNOWN";
    if (!externalByPlate.has(p)) externalByPlate.set(p, []);
    externalByPlate.get(p)!.push(row);
  }

  const results: ConfrontationItemResult[] = [];
  const processedPlates = new Set<string>();

  // Process External Rows against Internal Scope
  for (const [plate, extRows] of externalByPlate.entries()) {
    processedPlates.add(plate);

    const extTotal = extRows.reduce((sum, r) => sum.add(new Prisma.Decimal(r.amount || 0)), new Prisma.Decimal(0));
    const firstRow = extRows[0]!;
    const extVin = normalizeVin(firstRow?.vin);

    const internal = internalByPlate.get(plate);

    if (internal) {
      const diff = internal.totalAmount.minus(extTotal);
      const isExact = diff.abs().lessThan(new Prisma.Decimal("0.05"));

      let status: ConfrontationItemResult["status"] = isExact
        ? "exact_match"
        : "value_difference";

      if (!internal.hasPaymentListItem) {
        status = "validated_pending_list";
      }

      const serviceDesc =
        detectedGranularity === "synthetic"
          ? "Reparação e Serviços Consolidados"
          : extRows.map((r) => r.serviceDescription || "Serviço").join(" + ");

      results.push({
        id: `res-${plate}-${Date.now().toString(36)}`,
        licensePlate: plate,
        vin: internal.vin || extVin,
        carName: internal.carName,
        serviceDescription: serviceDesc,
        internalAmount: internal.totalAmount.toFixed(2),
        externalAmount: extTotal.toFixed(2),
        differenceAmount: diff.toFixed(2),
        status,
        decision: "none",
        paymentListId: internal.paymentListItemId ? targetPaymentList?.id : null,
        weeklogId: internal.weeklogId,
        weeklogSignatureRef: internal.weeklogSignatureRef,
      });
    } else {
      // Check if vehicle is In-Progress / Unvalidated
      const inProgress = inProgressOrders.find(
        (o) => normalizePlate(o.licensePlate) === plate || (extVin && normalizeVin(o.vin) === extVin)
      );

      if (inProgress) {
        results.push({
          id: `res-${plate}-prog-${Date.now().toString(36)}`,
          licensePlate: plate,
          vin: extVin || normalizeVin(inProgress.vin),
          carName: `${inProgress.brand || ""} ${inProgress.model || ""}`.trim() || null,
          serviceDescription: firstRow?.serviceDescription || "Serviços em produção",
          internalAmount: "0.00",
          externalAmount: extTotal.toFixed(2),
          differenceAmount: new Prisma.Decimal(0).minus(extTotal).toFixed(2),
          status: "in_production",
          decision: "pending",
          decisionNotes: "OS em chão de fábrica / validação de WEEKLOG pendente",
        });
      } else {
        // Vehicle Not Found
        results.push({
          id: `res-${plate}-nf-${Date.now().toString(36)}`,
          licensePlate: plate,
          vin: extVin,
          carName: null,
          serviceDescription: firstRow?.serviceDescription || "Não especificado pelo cliente",
          internalAmount: "0.00",
          externalAmount: extTotal.toFixed(2),
          differenceAmount: new Prisma.Decimal(0).minus(extTotal).toFixed(2),
          status: "vehicle_not_found",
          decision: "none",
        });
      }
    }
  }

  // Find Internal Vehicles Omitted by Client
  for (const [plate, internal] of internalByPlate.entries()) {
    if (!processedPlates.has(plate)) {
      results.push({
        id: `res-${plate}-omit-${Date.now().toString(36)}`,
        licensePlate: plate,
        vin: internal.vin,
        carName: internal.carName,
        serviceDescription: internal.services.map((s) => s.description).join(", ") || "Serviços executados",
        internalAmount: internal.totalAmount.toFixed(2),
        externalAmount: "0.00",
        differenceAmount: internal.totalAmount.toFixed(2),
        status: "omitted_by_client",
        decision: "contest",
        decisionNotes: "Veículo validado internamente, porém ausente no documento do cliente.",
        weeklogId: internal.weeklogId,
        weeklogSignatureRef: internal.weeklogSignatureRef,
        paymentListId: targetPaymentList?.id,
      });
    }
  }

  // Calculate Metrics
  let totalInternal = new Prisma.Decimal(0);
  let totalExternal = new Prisma.Decimal(0);
  let exactCount = 0;
  let diffCount = 0;
  let omitCount = 0;
  let inProdCount = 0;
  let notFoundCount = 0;

  for (const r of results) {
    totalInternal = totalInternal.add(new Prisma.Decimal(r.internalAmount || 0));
    totalExternal = totalExternal.add(new Prisma.Decimal(r.externalAmount || 0));

    if (r.status === "exact_match") exactCount++;
    else if (r.status === "value_difference" || r.status === "service_discrepancy") diffCount++;
    else if (r.status === "omitted_by_client") omitCount++;
    else if (r.status === "in_production") inProdCount++;
    else if (r.status === "vehicle_not_found") notFoundCount++;
  }

  const metrics: ConfrontationSummaryMetrics = {
    totalCompared: results.length,
    exactMatchCount: exactCount,
    valueDifferenceCount: diffCount,
    omittedByClientCount: omitCount,
    inProductionCount: inProdCount,
    notFoundCount: notFoundCount,
    totalInternalAmount: totalInternal.toFixed(2),
    totalExternalAmount: totalExternal.toFixed(2),
    netDifferenceAmount: totalInternal.minus(totalExternal).toFixed(2),
  };

  const runId = `run-${Date.now().toString(36)}`;

  return {
    runId,
    sequence: 1,
    createdAt: new Date().toISOString(),
    client,
    period: input.period || null,
    paymentList: targetPaymentList ? { id: targetPaymentList.id, listNumber: targetPaymentList.listNumber } : null,
    granularityUsed: detectedGranularity,
    metrics,
    results,
  };
}
