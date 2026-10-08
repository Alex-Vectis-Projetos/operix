import { Prisma, type Budget, type BudgetRevision, type ProductionOrder } from "@prisma/client";
export { Prisma };
import { prisma } from "../lib/prisma.js";
import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
} from "../lib/objectAuth.js";

export interface CalculatedTotals {
  grossTotal: Prisma.Decimal;
  discountPct: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  netTotal: Prisma.Decimal;
  taxPct: Prisma.Decimal;
  taxTotal: Prisma.Decimal;
  finalTotal: Prisma.Decimal;
}

export function toDecimal(value: unknown, fallback = 0): Prisma.Decimal {
  if (value instanceof Prisma.Decimal) return value;
  if (typeof value === "number" || typeof value === "string") {
    try {
      return new Prisma.Decimal(value);
    } catch {
      return new Prisma.Decimal(fallback);
    }
  }
  return new Prisma.Decimal(fallback);
}

export function round2(dec: Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(dec.toFixed(2));
}

/**
 * Processa todos os cálculos monetários da revisão com Prisma.Decimal e arredondamento estrito em 2 casas.
 */
export function calculateRevisionTotals(input: {
  grossTotal?: unknown;
  discountPct?: unknown;
  taxPct?: unknown;
  parts?: unknown;
  services?: unknown;
  labor?: unknown;
}): CalculatedTotals {
  let gross = toDecimal(input.grossTotal, 0);

  // Se grossTotal não foi informado explicitamente ou for 0, calcular pela soma dos itens
  if (gross.isZero()) {
    let sum = new Prisma.Decimal(0);
    const sumList = (items: unknown, quantityKeys: string[], unitPriceKeys: string[]) => {
      if (Array.isArray(items)) {
        for (const it of items) {
          const declaredTotal = it?.total;
          if (declaredTotal !== undefined && declaredTotal !== null && declaredTotal !== "") {
            sum = sum.add(toDecimal(declaredTotal));
            continue;
          }
          const quantityValue = quantityKeys
            .map((key) => it?.[key])
            .find((value) => value !== undefined && value !== null && value !== "");
          const unitPriceValue = unitPriceKeys
            .map((key) => it?.[key])
            .find((value) => value !== undefined && value !== null && value !== "");
          const qty = toDecimal(quantityValue ?? 1);
          const unitPrice = toDecimal(unitPriceValue ?? 0);
          sum = sum.add(unitPrice.mul(qty));
        }
      }
    };
    sumList(input.parts, ["quantity", "qty"], ["unitPrice", "unit_price", "price"]);
    sumList(input.services, ["quantity", "qty"], ["unitPrice", "unit_price", "price"]);
    sumList(input.labor, ["hours", "quantity", "qty"], ["hourlyRate", "hourly_rate", "unitPrice", "unit_price", "rate"]);
    if (!sum.isZero()) {
      gross = sum;
    }
  }

  const grossTotal = round2(gross);
  const discountPct = toDecimal(input.discountPct, 0);
  const taxPct = toDecimal(input.taxPct, 0);

  // discountTotal = grossTotal * (discountPct / 100)
  const discountTotal = round2(grossTotal.mul(discountPct).div(100));

  // netTotal = grossTotal - discountTotal
  const netTotal = round2(grossTotal.sub(discountTotal));

  // taxTotal = netTotal * (taxPct / 100)
  const taxTotal = round2(netTotal.mul(taxPct).div(100));

  // finalTotal = netTotal + taxTotal
  const finalTotal = round2(netTotal.add(taxTotal));

  return {
    grossTotal,
    discountPct,
    discountTotal,
    netTotal,
    taxPct,
    taxTotal,
    finalTotal,
  };
}

/**
 * Geração atômica e sequencial de código de orçamento por workspace (ex.: ORC-2026-0001).
 */
export async function generateBudgetCode(
  tx: Prisma.TransactionClient,
  workspaceId: string
): Promise<string> {
  const currentYear = new Date().getFullYear();
  const prefix = `ORC-${currentYear}-`;

  const lastBudget = await tx.budget.findFirst({
    where: {
      workspaceId,
      code: { startsWith: prefix },
    },
    orderBy: { code: "desc" },
    select: { code: true },
  });

  let nextNum = 1;
  if (lastBudget?.code) {
    const parts = lastBudget.code.split("-");
    const num = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(num)) {
      nextNum = num + 1;
    }
  } else {
    const count = await tx.budget.count({ where: { workspaceId } });
    nextNum = count + 1;
  }

  return `${prefix}${String(nextNum).padStart(4, "0")}`;
}

export interface CreateBudgetInput {
  workspaceId: string;
  createdById: string;
  clientId?: string | null;
  clientName?: string | null;
  vehiclePlate?: string | null;
  vehicleVin?: string | null;
  vehicleBrand?: string | null;
  vehicleModel?: string | null;
  technicianUserId?: string | null;
  legacyLocalId?: string | null;
  currencyCode?: string;
  budgetType?: string;
  clientSnapshot?: any;
  vehicleSnapshot?: any;
  dossierSnapshot?: any;
  parts?: any;
  services?: any;
  labor?: any;
  interventionTypes?: string[];
  diagnosis?: string | null;
  technicalDescription?: string | null;
  notes?: string | null;
  signature?: any;
  grossTotal?: unknown;
  discountPct?: unknown;
  taxPct?: unknown;
}

/**
 * Criação atômica de agregador Budget e sua primeira BudgetRevision (draft).
 */
export async function createBudget(input: CreateBudgetInput) {
  let legacyBillingClient: {
    id: string;
    workspaceId: string | null;
    name: string;
    customerDisplayId: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    postalCode: string | null;
    city: string | null;
    country: string | null;
    notes: string | null;
    createdBy: string | null;
  } | null = null;

  // 1. Validação estrita de vinculação cross-tenant de cliente (CLIENT-01)
  if (input.clientId) {
    const client = await prisma.client.findUnique({
      where: { id: input.clientId },
      select: { id: true, workspaceId: true, name: true },
    });
    if (!client) {
      legacyBillingClient = await prisma.billingClient.findUnique({
        where: { id: input.clientId },
        select: {
          id: true,
          workspaceId: true,
          name: true,
          customerDisplayId: true,
          email: true,
          phone: true,
          address: true,
          postalCode: true,
          city: true,
          country: true,
          notes: true,
          createdBy: true,
        },
      });
      if (legacyBillingClient && legacyBillingClient.workspaceId !== input.workspaceId) {
          throw new ForbiddenError("Cliente não pertence ao workspace ativo.");
      }
    }
    if ((!client && !legacyBillingClient) || (client && client.workspaceId !== input.workspaceId)) {
      throw new ForbiddenError("Cliente não pertence ao workspace ativo.");
    }
    if (!input.clientName) {
      input.clientName = client?.name ?? legacyBillingClient!.name;
    }
  }

  const totals = calculateRevisionTotals(input);

  // Retry loop para concorrência de geração de código único por workspace
  let attempts = 0;
  while (attempts < 5) {
    attempts++;
    try {
      return await prisma.$transaction(async (tx) => {
        if (legacyBillingClient) {
          await tx.client.upsert({
            where: { id: legacyBillingClient.id },
            create: {
              id: legacyBillingClient.id,
              workspaceId: input.workspaceId,
              visibilityScope: "workspace",
              name: legacyBillingClient.name,
              contactEmail: legacyBillingClient.email,
              contactPhone: legacyBillingClient.phone,
              address: [legacyBillingClient.address, legacyBillingClient.postalCode, legacyBillingClient.city, legacyBillingClient.country]
                .filter(Boolean)
                .join(", ") || null,
              displayCode: legacyBillingClient.customerDisplayId,
              notes: legacyBillingClient.notes,
              createdBy: legacyBillingClient.createdBy,
            },
            update: { name: legacyBillingClient.name },
          });
        }

        const code = await generateBudgetCode(tx, input.workspaceId);

        const budget = await tx.budget.create({
          data: {
            workspaceId: input.workspaceId,
            code,
            clientId: input.clientId || null,
            clientName: input.clientName || null,
            vehiclePlate: input.vehiclePlate || null,
            vehicleVin: input.vehicleVin || null,
            vehicleBrand: input.vehicleBrand || null,
            vehicleModel: input.vehicleModel || null,
            technicianUserId: input.technicianUserId || null,
            legacyLocalId: input.legacyLocalId || null,
            createdById: input.createdById,
            currentRevisionNumber: 1,
          },
        });

        const clientSnapshot = input.clientSnapshot ?? {
          id: input.clientId || null,
          name: input.clientName || null,
        };

        const vehicleSnapshot = input.vehicleSnapshot ?? {
          plate: input.vehiclePlate || null,
          brand: input.vehicleBrand || null,
          model: input.vehicleModel || null,
          vin: input.vehicleVin || null,
        };

        const revision = await tx.budgetRevision.create({
          data: {
            budgetId: budget.id,
            revisionNumber: 1,
            status: "draft",
            currencyCode: input.currencyCode || "EUR",
            budgetType: input.budgetType || "pdr",
            clientSnapshot,
            vehicleSnapshot,
            dossierSnapshot: input.dossierSnapshot ?? null,
            parts: input.parts ?? [],
            services: input.services ?? [],
            labor: input.labor ?? [],
            interventionTypes: input.interventionTypes ?? [],
            diagnosis: input.diagnosis ?? null,
            technicalDescription: input.technicalDescription ?? null,
            signature: input.signature ?? Prisma.JsonNull,
            ...totals,
            createdById: input.createdById,
          },
        });

        const updatedBudget = await tx.budget.update({
          where: { id: budget.id },
          data: {
            currentRevisionId: revision.id,
          },
          include: {
            currentRevision: true,
          },
        });

        return {
          budget: updatedBudget,
          revision,
        };
      });
    } catch (err: any) {
      if (err?.code === "P2002" && String(err?.meta?.target ?? "").includes("legacy") && input.legacyLocalId) {
        const existing = await prisma.budget.findFirst({
          where: { workspaceId: input.workspaceId, legacyLocalId: input.legacyLocalId },
          include: { currentRevision: true },
        });
        if (existing?.currentRevision) {
          return { budget: existing, revision: existing.currentRevision };
        }
      }
      if (err?.code === "P2002" && err?.meta?.target?.includes("code") && attempts < 5) {
        continue;
      }
      throw err;
    }
  }

  throw new Error("Não foi possível gerar código único de orçamento após múltiplas tentativas.");
}

export interface UpdateRevisionInput {
  clientSnapshot?: any;
  vehicleSnapshot?: any;
  dossierSnapshot?: any;
  parts?: any;
  services?: any;
  labor?: any;
  interventionTypes?: string[];
  diagnosis?: string | null;
  technicalDescription?: string | null;
  notes?: string | null;
  grossTotal?: unknown;
  discountPct?: unknown;
  taxPct?: unknown;
  currencyCode?: string;
  budgetType?: string;
  signature?: any;
}

/**
 * Atualiza uma revisão draft in-place, ou cria uma nova revisão draft preservando a versão aprovada anterior intacta.
 */
export async function updateBudgetRevision(
  workspaceId: string,
  budgetId: string,
  revisionId: string,
  actorUserId: string,
  data: UpdateRevisionInput
): Promise<{
  budget: Budget;
  revision: BudgetRevision;
  isNewRevision: boolean;
}> {
  const budget = await prisma.budget.findFirst({
    where: { id: budgetId, workspaceId, deletedAt: null },
    include: {
      revisions: { where: { id: revisionId } },
    },
  });

  if (!budget) {
    throw new NotFoundError("Orçamento não encontrado.");
  }

  const targetRev = budget.revisions[0];
  if (!targetRev) {
    throw new NotFoundError("Revisão não encontrada para este orçamento.");
  }

  // Cenário 1: Revisão está em draft -> Atualização in-place
  if (targetRev.status === "draft") {
    const totals = calculateRevisionTotals({
      grossTotal: data.grossTotal ?? targetRev.grossTotal,
      discountPct: data.discountPct ?? targetRev.discountPct,
      taxPct: data.taxPct ?? targetRev.taxPct,
      parts: data.parts ?? targetRev.parts,
      services: data.services ?? targetRev.services,
      labor: data.labor ?? targetRev.labor,
    });

    const updatedRev = await prisma.budgetRevision.update({
      where: { id: targetRev.id },
      data: {
        currencyCode: data.currencyCode ?? targetRev.currencyCode,
        budgetType: data.budgetType ?? targetRev.budgetType,
        clientSnapshot: data.clientSnapshot ?? targetRev.clientSnapshot,
        vehicleSnapshot: data.vehicleSnapshot ?? targetRev.vehicleSnapshot,
        dossierSnapshot: data.dossierSnapshot ?? targetRev.dossierSnapshot,
        parts: data.parts ?? targetRev.parts,
        services: data.services ?? targetRev.services,
        labor: data.labor ?? targetRev.labor,
        interventionTypes: data.interventionTypes ?? targetRev.interventionTypes,
        diagnosis: data.diagnosis ?? targetRev.diagnosis,
        technicalDescription: data.technicalDescription ?? targetRev.technicalDescription,
        signature:
          data.signature === undefined
            ? targetRev.signature
            : data.signature ?? Prisma.JsonNull,
        ...totals,
      },
    });

    return {
      budget,
      revision: updatedRev,
      isNewRevision: false,
    };
  }

  // Cenário 2: Revisão já foi aprovada (ou submitted/rejected) -> Imutabilidade: gera nova revisão draft
  const nextRevNumber = budget.currentRevisionNumber + 1;
  const totals = calculateRevisionTotals({
    grossTotal: data.grossTotal ?? targetRev.grossTotal,
    discountPct: data.discountPct ?? targetRev.discountPct,
    taxPct: data.taxPct ?? targetRev.taxPct,
    parts: data.parts ?? targetRev.parts,
    services: data.services ?? targetRev.services,
    labor: data.labor ?? targetRev.labor,
  });

  return await prisma.$transaction(async (tx) => {
    const newRev = await tx.budgetRevision.create({
      data: {
        budgetId: budget.id,
        revisionNumber: nextRevNumber,
        status: "draft",
        currencyCode: data.currencyCode ?? targetRev.currencyCode,
        budgetType: data.budgetType ?? targetRev.budgetType,
        clientSnapshot: data.clientSnapshot ?? targetRev.clientSnapshot,
        vehicleSnapshot: data.vehicleSnapshot ?? targetRev.vehicleSnapshot,
        dossierSnapshot: data.dossierSnapshot ?? targetRev.dossierSnapshot,
        parts: data.parts ?? targetRev.parts,
        services: data.services ?? targetRev.services,
        labor: data.labor ?? targetRev.labor,
        interventionTypes: data.interventionTypes ?? targetRev.interventionTypes,
        diagnosis: data.diagnosis ?? targetRev.diagnosis,
        technicalDescription: data.technicalDescription ?? targetRev.technicalDescription,
        signature: data.signature ?? Prisma.JsonNull,
        ...totals,
        createdById: actorUserId,
      },
    });

    const updatedBudget = await tx.budget.update({
      where: { id: budget.id },
      data: {
        currentRevisionNumber: nextRevNumber,
        currentRevisionId: newRev.id,
        // approvedRevisionId é preservado intocado!
      },
    });

    return {
      budget: updatedBudget,
      revision: newRev,
      isNewRevision: true,
    };
  });
}

export interface ApproveRevisionOptions {
  notes?: string;
  dueAt?: Date | string | null;
  operationalSiteKey?: string | null;
}

type StructuredProductionService = {
  id: string;
  name: string;
  description: string;
  category: "service" | "part" | "labor";
  quantity: string;
  unitPrice: string;
  total: string;
  completed: false;
  status: "pending";
  currency: string;
};

function strictDecimal(value: unknown, errorCode: string): Prisma.Decimal {
  try {
    const decimal = new Prisma.Decimal(String(value));
    if (!decimal.isFinite()) throw new Error("not finite");
    return decimal;
  } catch {
    throw new UnprocessableEntityError(errorCode);
  }
}

function buildStructuredProductionServices(
  revision: Pick<BudgetRevision, "services" | "parts" | "labor" | "grossTotal">,
  currencyCode: string,
): StructuredProductionService[] {
  const structured: StructuredProductionService[] = [];
  const sources: Array<{
    category: StructuredProductionService["category"];
    rows: unknown;
    quantityKeys: string[];
    unitPriceKeys: string[];
  }> = [
    { category: "service", rows: revision.services, quantityKeys: ["quantity", "qty"], unitPriceKeys: ["unitPrice", "unit_price", "price"] },
    { category: "part", rows: revision.parts, quantityKeys: ["quantity", "qty"], unitPriceKeys: ["unitPrice", "unit_price", "price"] },
    { category: "labor", rows: revision.labor, quantityKeys: ["hours", "quantity", "qty"], unitPriceKeys: ["hourlyRate", "hourly_rate", "unitPrice", "unit_price", "rate"] },
  ];

  for (const source of sources) {
    if (!Array.isArray(source.rows)) continue;
    source.rows.forEach((raw, index) => {
      const item = raw as Record<string, unknown>;
      const name = String(item.name ?? item.description ?? item.serviceName ?? "").trim();
      const quantityRaw = source.quantityKeys
        .map((key) => item[key])
        .find((value) => value !== undefined && value !== null && value !== "");
      const unitPriceRaw = source.unitPriceKeys
        .map((key) => item[key])
        .find((value) => value !== undefined && value !== null && value !== "");
      const totalRaw = item.total;

      const valueCandidates = [unitPriceRaw, totalRaw].filter(
        (value) => value !== undefined && value !== null && value !== "",
      );
      const hasPositiveValue = valueCandidates.some((value) => {
        try {
          return new Prisma.Decimal(String(value)).gt(0);
        } catch {
          return true;
        }
      });

      // Ignore only the empty placeholder rows created by the form.
      if (!name && !hasPositiveValue) return;
      if (!name) {
        throw new UnprocessableEntityError(`BUDGET_SERVICE_NAME_REQUIRED: ${source.category}[${index}]`);
      }

      const quantity = strictDecimal(quantityRaw ?? 1, `BUDGET_SERVICE_QUANTITY_INVALID: ${source.category}[${index}]`);
      if (quantity.lte(0)) {
        throw new UnprocessableEntityError(`BUDGET_SERVICE_QUANTITY_INVALID: ${source.category}[${index}]`);
      }

      let unitPrice: Prisma.Decimal;
      let total: Prisma.Decimal;
      if (unitPriceRaw !== undefined) {
        unitPrice = strictDecimal(unitPriceRaw, `BUDGET_SERVICE_VALUE_INVALID: ${source.category}[${index}]`);
        total = quantity.mul(unitPrice);
        if (totalRaw !== undefined && totalRaw !== null && totalRaw !== "") {
          const declaredTotal = strictDecimal(totalRaw, `BUDGET_SERVICE_TOTAL_INVALID: ${source.category}[${index}]`);
          if (!declaredTotal.equals(total)) {
            throw new UnprocessableEntityError(`BUDGET_SERVICE_TOTAL_MISMATCH: ${source.category}[${index}]`);
          }
          total = declaredTotal;
        }
      } else if (totalRaw !== undefined && totalRaw !== null && totalRaw !== "") {
        total = strictDecimal(totalRaw, `BUDGET_SERVICE_TOTAL_INVALID: ${source.category}[${index}]`);
        unitPrice = total.div(quantity);
      } else {
        throw new UnprocessableEntityError(`BUDGET_SERVICE_VALUE_REQUIRED: ${source.category}[${index}]`);
      }

      if (unitPrice.lte(0) || total.lte(0)) {
        throw new UnprocessableEntityError(`BUDGET_SERVICE_VALUE_REQUIRED: ${source.category}[${index}]`);
      }

      structured.push({
        id: String(item.id || `${source.category}-${index + 1}`),
        name,
        description: String(item.description ?? name).trim() || name,
        category: source.category,
        quantity: quantity.toString(),
        unitPrice: unitPrice.toFixed(2),
        total: total.toFixed(2),
        completed: false,
        status: "pending",
        currency: currencyCode,
      });
    });
  }

  if (structured.length === 0) {
    throw new UnprocessableEntityError(
      "BUDGET_NO_EXECUTABLE_SERVICES: O orçamento precisa conter ao menos uma linha estruturada com descrição e valor positivo.",
    );
  }

  const structuredGrossTotal = structured.reduce(
    (sum, service) => sum.add(service.total),
    new Prisma.Decimal(0),
  );
  if (!structuredGrossTotal.equals(revision.grossTotal)) {
    throw new UnprocessableEntityError(
      `BUDGET_SERVICE_TOTAL_MISMATCH: linhas=${structuredGrossTotal.toFixed(2)} bruto=${revision.grossTotal.toFixed(2)}.`,
    );
  }

  return structured;
}

/**
 * Aprovação transacional com revisionId explícito.
 * Garante cardinalidade 1:0..1 com ProductionOrder e aplica whitelist de re-aprovação.
 */
export async function approveBudgetRevision(
  workspaceId: string,
  budgetId: string,
  revisionId: string,
  actorUserId: string,
  options?: ApproveRevisionOptions
): Promise<{
  budget: Budget;
  revision: BudgetRevision;
  productionOrder: ProductionOrder;
}> {
  return await prisma.$transaction(async (tx) => {
    const budget = await tx.budget.findFirst({
      where: { id: budgetId, workspaceId, deletedAt: null },
      include: {
        revisions: true,
        productionOrder: true,
      },
    });

    if (!budget) {
      throw new NotFoundError("Orçamento não encontrado.");
    }

    const revision = budget.revisions.find((r) => r.id === revisionId);
    if (!revision) {
      throw new NotFoundError("Revisão não encontrada para este orçamento.");
    }

    if (revision.status === "rejected") {
      throw new ConflictError("Revisão com status rejeitado não pode ser aprovada diretamente.");
    }

    // A) Retry idempotente legítimo:
    // A revisão solicitada é a revisão corrente do orçamento, já está aprovada,
    // o approvedRevisionId aponta para ela e a ProductionOrder correspondente já existe.
    if (
      revision.id === budget.currentRevisionId &&
      revision.id === budget.approvedRevisionId &&
      revision.status === "approved" &&
      budget.productionOrder
    ) {
      return {
        budget,
        revision,
        productionOrder: budget.productionOrder,
      };
    }

    // B) Revisão stale (Cenário 1.3):
    // Se a revisão for mais antiga que a corrente (ex: Rev 1 quando Rev 2 foi criada/corrente;
    // ou tentativa de downgrade), rejeita com 409 Conflict.
    const isStale =
      revision.revisionNumber < budget.currentRevisionNumber ||
      (budget.currentRevisionId !== null &&
        revision.revisionNumber === budget.currentRevisionNumber &&
        revision.id !== budget.currentRevisionId);

    if (isStale) {
      throw new ConflictError(
        "Apenas a revisão corrente do orçamento pode ser aprovada. A revisão solicitada está desatualizada (stale)."
      );
    }

    const existingPO = budget.productionOrder;

    // Se já existe uma OP vinculada
    let resolvedPO: ProductionOrder;
    if (existingPO) {
      if (existingPO.status === "delivered") {
        throw new UnprocessableEntityError("Não é possível aprovar orçamento para ordem de produção já entregue.");
      }

      const vehicleSnap = (revision.vehicleSnapshot as any) || {};
      const clientSnap = (revision.clientSnapshot as any) || {};
      const dossierSnap = (revision.dossierSnapshot as any) || {};
      const canonicalSiteKey =
        options?.operationalSiteKey ||
        (budget as any).siteKey ||
        (budget as any).operationalSiteKey ||
        dossierSnap.siteKey ||
        dossierSnap.operationalSiteKey ||
        clientSnap.siteKey ||
        clientSnap.operationalSiteKey ||
        vehicleSnap.siteKey ||
        vehicleSnap.operationalSiteKey ||
        null;
      const canonicalCurrency =
        revision.currencyCode ||
        (budget as any).currencyCode ||
        "EUR";

      const structuredServices = buildStructuredProductionServices(revision, canonicalCurrency);

      resolvedPO = await tx.productionOrder.update({
        where: { id: existingPO.id },
        data: {
          budgetRevisionId: revision.id,
          notes: options?.notes || existingPO.notes,
          brand: vehicleSnap.brand || existingPO.brand,
          model: vehicleSnap.model || existingPO.model,
          color: vehicleSnap.color || existingPO.color,
          licensePlate: vehicleSnap.plate || existingPO.licensePlate,
          vin: vehicleSnap.vin || existingPO.vin,
          clientId: clientSnap.id || existingPO.clientId,
          clientName: clientSnap.name || existingPO.clientName,
          platform: `Orçamento ${budget.code} · Total ${revision.finalTotal} ${canonicalCurrency}`,
          dueAt: options?.dueAt ? new Date(options.dueAt) : existingPO.dueAt,
          operationalSiteKey: canonicalSiteKey || existingPO.operationalSiteKey,
          currencyCode: canonicalCurrency || existingPO.currencyCode,
          performedServices: structuredServices,
          // Preservados intocados: status, startedAt, finishedAt, deliveredAt, technicianUserId, technicianName, priority
        },
      });
    } else {
      // Primeira aprovação: Cria uma única ProductionOrder vinculada
      const vehicleSnap = (revision.vehicleSnapshot as any) || {};
      const clientSnap = (revision.clientSnapshot as any) || {};
      const dossierSnap = (revision.dossierSnapshot as any) || {};
      const canonicalSiteKey =
        options?.operationalSiteKey ||
        (budget as any).siteKey ||
        (budget as any).operationalSiteKey ||
        dossierSnap.siteKey ||
        dossierSnap.operationalSiteKey ||
        clientSnap.siteKey ||
        clientSnap.operationalSiteKey ||
        vehicleSnap.siteKey ||
        vehicleSnap.operationalSiteKey ||
        null;
      const canonicalCurrency =
        revision.currencyCode ||
        (budget as any).currencyCode ||
        "EUR";
      const poCode = `PO-${Date.now().toString(36).toUpperCase()}`;

      const structuredServices = buildStructuredProductionServices(revision, canonicalCurrency);

      resolvedPO = await tx.productionOrder.create({
        data: {
          workspaceId: budget.workspaceId,
          code: poCode,
          budgetId: budget.id,
          budgetRevisionId: revision.id,
          clientId: clientSnap.id || budget.clientId,
          clientName: clientSnap.name || budget.clientName || "",
          technicianUserId: budget.technicianUserId || null,
          brand: vehicleSnap.brand || budget.vehicleBrand || "",
          model: vehicleSnap.model || budget.vehicleModel || "",
          licensePlate: vehicleSnap.plate || budget.vehiclePlate || "",
          vin: vehicleSnap.vin || budget.vehicleVin || "",
          color: vehicleSnap.color || null,
          platform: `Orçamento ${budget.code} · Total ${revision.finalTotal} ${canonicalCurrency}`,
          status: "in_production",
          priority: "medium",
          notes: options?.notes || `Orçamento ${budget.code} (Rev ${revision.revisionNumber})`,
          createdBy: actorUserId,
          dueAt: options?.dueAt ? new Date(options.dueAt) : null,
          operationalSiteKey: canonicalSiteKey,
          currencyCode: canonicalCurrency,
          performedServices: structuredServices,
        },
      });
    }

    // Atualiza status da revisão para aprovada
    const approvedRev = await tx.budgetRevision.update({
      where: { id: revision.id },
      data: {
        status: "approved",
        approvedAt: new Date(),
        approvedById: actorUserId,
      },
    });

    // Atualiza ponteiro de approvedRevisionId em Budget
    const updatedBudget = await tx.budget.update({
      where: { id: budget.id },
      data: {
        approvedRevisionId: revision.id,
        currentRevisionId: revision.id,
        currentRevisionNumber: Math.max(budget.currentRevisionNumber, revision.revisionNumber),
      },
    });

    return {
      budget: updatedBudget,
      revision: approvedRev,
      productionOrder: resolvedPO,
    };
  });
}

/**
 * Rejeição formal de revisão com motivo registrado.
 */
export async function rejectBudgetRevision(
  workspaceId: string,
  budgetId: string,
  revisionId: string,
  actorUserId: string,
  reason: string
): Promise<{
  budget: Budget;
  revision: BudgetRevision;
}> {
  return await prisma.$transaction(async (tx) => {
    const budget = await tx.budget.findFirst({
      where: { id: budgetId, workspaceId, deletedAt: null },
      include: {
        revisions: { where: { id: revisionId } },
      },
    });

    if (!budget) {
      throw new NotFoundError("Orçamento não encontrado.");
    }

    const revision = budget.revisions[0];
    if (!revision) {
      throw new NotFoundError("Revisão não encontrada para este orçamento.");
    }

    const isStale =
      revision.revisionNumber < budget.currentRevisionNumber ||
      (budget.currentRevisionId !== null &&
        revision.revisionNumber === budget.currentRevisionNumber &&
        revision.id !== budget.currentRevisionId);

    if (isStale) {
      throw new ConflictError(
        "Apenas a revisão corrente do orçamento pode ser rejeitada. A revisão solicitada está desatualizada (stale)."
      );
    }

    if (revision.status === "approved") {
      throw new ConflictError("Revisão aprovada não pode ser rejeitada diretamente.");
    }

    const rejectedRev = await tx.budgetRevision.update({
      where: { id: revision.id },
      data: {
        status: "rejected",
        rejection: {
          reason: reason.trim(),
          rejectedAt: new Date().toISOString(),
          rejectedById: actorUserId,
        },
      },
    });

    return {
      budget,
      revision: rejectedRev,
    };
  });
}

/**
 * Sincronização concorrente idempotente de orçamentos legados do LocalStorage.
 * Usa constraint @@unique([workspaceId, legacyLocalId]).
 */
export async function syncLocalBudgets(
  workspaceId: string,
  actorUserId: string,
  items: Array<{
    legacyLocalId: string;
    clientName?: string;
    vehiclePlate?: string;
    vehicleBrand?: string;
    vehicleModel?: string;
    grossTotal?: number;
    parts?: any;
    services?: any;
    labor?: any;
  }>
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  for (const item of items) {
    const existing = await prisma.budget.findUnique({
      where: {
        workspaceId_legacyLocalId: {
          workspaceId,
          legacyLocalId: item.legacyLocalId,
        },
      },
      select: { id: true },
    });

    if (existing) {
      result[item.legacyLocalId] = existing.id;
      continue;
    }

    const created = await createBudget({
      workspaceId,
      createdById: actorUserId,
      legacyLocalId: item.legacyLocalId,
      clientName: item.clientName,
      vehiclePlate: item.vehiclePlate,
      vehicleBrand: item.vehicleBrand,
      vehicleModel: item.vehicleModel,
      grossTotal: item.grossTotal,
      parts: item.parts,
      services: item.services,
      labor: item.labor,
    });

    result[item.legacyLocalId] = created.budget.id;
  }

  return result;
}
