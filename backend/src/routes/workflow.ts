import { Router, type Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

export const OPERATIONAL_WORKFLOW_STATUSES = [
  "em_elaboracao",
  "em_producao",
  "weeklog_em_aberto",
  "aguardando_assinatura",
  "aguardando_aprovacao",
  "correcao_necessaria",
  "aprovado",
  "aguardando_ordem_lista",
  "aguardando_pagamento",
  "pago",
  "encerrado",
] as const;

export type OperationalWorkflowStatus = typeof OPERATIONAL_WORKFLOW_STATUSES[number];

export const STATUS_META: Record<
  OperationalWorkflowStatus,
  { label: string; tone: string; dot: string; next_action: string }
> = {
  em_elaboracao: {
    label: "Em elaboração",
    tone: "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300 border-slate-300",
    dot: "bg-slate-400",
    next_action: "Iniciar triagem e mover a ordem para Em Produção.",
  },
  em_producao: {
    label: "Em produção",
    tone: "bg-indigo-50 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 border-indigo-200",
    dot: "bg-indigo-500",
    next_action: "Executar os serviços e marcar a produção como finalizada.",
  },
  weeklog_em_aberto: {
    label: "WEEKLOG em aberto",
    tone: "bg-sky-50 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300 border-sky-200",
    dot: "bg-sky-500",
    next_action: "Preencher a validação do WEEKLOG (assinatura + responsável + valor).",
  },
  aguardando_assinatura: {
    label: "Aguardando assinatura",
    tone: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200",
    dot: "bg-amber-500",
    next_action: "Confirmar a assinatura do documento operacional no WEEKLOG.",
  },
  aguardando_aprovacao: {
    label: "Aguardando aprovação",
    tone: "bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300 border-violet-200",
    dot: "bg-violet-500",
    next_action: "Validar SIM no WEEKLOG para liberar para lista/ordem de pagamento.",
  },
  correcao_necessaria: {
    label: "Correção necessária",
    tone: "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300 border-rose-200",
    dot: "bg-rose-500",
    next_action: "Corrigir as inconsistências no WEEKLOG e revalidar.",
  },
  aprovado: {
    label: "Aprovado",
    tone: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200",
    dot: "bg-emerald-500",
    next_action: "Criar a Ordem/Lista de Pagamento (geração automática ao validar).",
  },
  aguardando_ordem_lista: {
    label: "Aguardando ordem/lista",
    tone: "bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300 border-teal-200",
    dot: "bg-teal-500",
    next_action: "Aguardar a criação automática da Ordem de Pagamento após a validação.",
  },
  aguardando_pagamento: {
    label: "Aguardando pagamento",
    tone: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-300",
    dot: "bg-amber-600",
    next_action: "Efetuar o pagamento da Ordem de Pagamento.",
  },
  pago: {
    label: "Pago",
    tone: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200 border-emerald-400",
    dot: "bg-emerald-600",
    next_action: "Pagamento confirmado. Acompanhe a entrega final.",
  },
  encerrado: {
    label: "Encerrado",
    tone: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200 border-slate-400",
    dot: "bg-slate-600",
    next_action: "Processo completamente concluído.",
  },
};

type UnpackPromise<T> = T extends Promise<infer U> ? U : T;
type PO = UnpackPromise<ReturnType<typeof prisma.productionOrder.findMany>>[number];
type SO = UnpackPromise<ReturnType<typeof prisma.serviceOrder.findMany>>[number];
type PAY = UnpackPromise<ReturnType<typeof prisma.paymentOrder.findMany>>[number];

export type WorkflowItem = {
  id: string;
  origin: "production_weeklog" | "weeklog_only" | "payment_only";

  production_order_id: string | null;
  production_code: string | null;
  production_status: string | null;
  production_delivered_at: string | null;

  service_order_id: string | null;
  week: string | null;
  week_number: number | null;
  year_reference: number | null;

  payment_order_id: string | null;
  list_name: string | null;
  payment_status: string | null;

  client_name: string | null;
  technician_name: string | null;
  platform: string | null;
  operational_unit: string | null;

  brand: string | null;
  model: string | null;
  car_name: string | null;
  license_plate: string | null;
  vin: string | null;

  valor_total: number | null;
  valor_aprovado: number | null;
  valor_pago: number | null;
  valor_pendente: number | null;

  validation_situation: "oui" | "non" | null;
  validation_assinado: boolean;
  validation_retificativa: "none" | "partial" | "full" | null;

  status: OperationalWorkflowStatus;
  status_label: string;
  next_action: string;
  has_error: boolean;

  created_at: string;
};

export type WorkflowSummary = {
  count: number;
  valor_total: number;
  valor_aprovado: number;
  valor_pago: number;
  valor_pendente: number;
  by_status: Record<string, number>;
  aguardando_acao: number;
  com_erro: number;
};

function jsonGet(root: any, path: string[]): any {
  let cur: any = root;
  for (const p of path) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

function parseValidation(so: SO | null): {
  situation: "oui" | "non" | null;
  assinado: boolean;
  valor_final: number | null;
  retificativa: "none" | "partial" | "full" | null;
  week_display: string | null;
  week_number: number | null;
  year_ref: number | null;
  list_name: string | null;
  payment_order_id: string | null;
  historico_len: number;
} {
  if (!so) {
    return {
      situation: null,
      assinado: false,
      valor_final: null,
      retificativa: null,
      week_display: null,
      week_number: null,
      year_ref: null,
      list_name: null,
      payment_order_id: null,
      historico_len: 0,
    };
  }
  const op =
    (so.distributionSnapshot &&
      typeof so.distributionSnapshot === "object" &&
      ((so.distributionSnapshot as any)?.operational_document ??
        (so.distributionSnapshot as any)?.operationalDocument)) ||
    null;
  const v = op?.validation ?? null;
  const r = op?.retificativa ?? null;
  const b = op?.base ?? null;

  const situationRaw =
    v?.situation ?? v?.validation_sit ?? v?.validation ?? null;
  let situation: "oui" | "non" | null = null;
  if (situationRaw === "oui" || situationRaw === "non") situation = situationRaw;

  const assinado = Boolean(v?.assinado);
  const valor_final =
    typeof v?.valor_final === "number" && isFinite(v.valor_final)
      ? v.valor_final
      : null;
  const retRaw = r?.type ?? null;
  let retificativa: "none" | "partial" | "full" | null = null;
  if (retRaw === "none" || retRaw === "partial" || retRaw === "full")
    retificativa = retRaw;

  const week_display: string | null =
    String(b?.week_display ?? so.week ?? "").trim() || null;
  let week_number: number | null = so.week ? null : null;
  if (b?.week_number && Number.isFinite(Number(b.week_number)))
    week_number = Number(b.week_number);
  if (!week_number && week_display) {
    const m = /(\d{1,2})/.exec(week_display);
    if (m) week_number = parseInt(m[1], 10);
  }
  if (!week_number && so.week) {
    const m = /(\d{1,2})/.exec(String(so.week));
    if (m) week_number = parseInt(m[1], 10);
  }
  const year_ref = so.yearReference ?? b?.year_reference ?? null;

  const list_name: string | null = v?.list_name ?? v?.listName ?? null;
  const payment_order_id: string | null =
    v?.payment_order_id ?? v?.paymentOrderId ?? null;
  const historico_len = Array.isArray(v?.historico) ? v.historico.length : 0;

  return {
    situation,
    assinado,
    valor_final,
    retificativa,
    week_display,
    week_number,
    year_ref,
    list_name,
    payment_order_id,
    historico_len,
  };
}

function deriveStatus(params: {
  po: any | null;
  so: SO | null;
  pay: PAY | null;
  val: ReturnType<typeof parseValidation>;
  we?: any | null;
  pli?: any | null;
}): OperationalWorkflowStatus {
  const { po, so, pay, val, we, pli } = params;
  const prodStatus = po?.status ?? null;

  const isPaid =
    (pli?.paymentList?.status === "paid") ||
    (pay?.status === "paid") ||
    (typeof pay?.total === "number" &&
      typeof pay?.amountPaid === "number" &&
      pay.amountPaid >= pay.total - 0.005 &&
      pay.total > 0);

  if (isPaid) {
    return prodStatus === "delivered" || prodStatus === "invoiced"
      ? "encerrado"
      : "pago";
  }

  if (pli?.paymentList?.status === "pending" || pay?.status === "pending") {
    return "aguardando_pagamento";
  }

  if (pli?.paymentList) {
    const plStatus = pli.paymentList.status;
    if (plStatus === "ready_for_billing" || plStatus === "confronted" || plStatus === "under_review" || plStatus === "draft") {
      return "aguardando_ordem_lista";
    }
  }

  if (pay) {
    return "aguardando_pagamento";
  }

  if (we) {
    const latestVal = we.weeklog?.validations?.[0];
    if (latestVal?.status === "rejected") return "correcao_necessaria";
    if (latestVal?.status === "approved") return "aguardando_ordem_lista";
    if (latestVal?.submittedAt || latestVal?.status === "signed") return "aguardando_aprovacao";
    return "weeklog_em_aberto";
  }

  if (so) {
    if (val.situation === "non") return "correcao_necessaria";
    if (val.situation === "oui") {
      return "aguardando_ordem_lista";
    }
    if (val.assinado) return "aguardando_aprovacao";
    if (
      val.historico_len > 0 ||
      val.valor_final !== null ||
      val.retificativa !== null
    )
      return "aguardando_assinatura";
    return "weeklog_em_aberto";
  }

  if (po) {
    const hasDelivery = Boolean(po.deliveredAt);
    if (hasDelivery || prodStatus === "finished" || prodStatus === "delivered")
      return "weeklog_em_aberto";
    if (
      prodStatus === "in_production" ||
      prodStatus === "paused" ||
      prodStatus === "awaiting_validation"
    )
      return "em_producao";
    return "em_elaboracao";
  }

  return "em_elaboracao";
}

function itemFromParts(params: {
  po: any | null;
  so: SO | null;
  pay: PAY | null;
  we?: any | null;
  pli?: any | null;
}): WorkflowItem {
  const { po, so, pay, we, pli } = params;
  const val = parseValidation(so);

  const client_name =
    po?.clientName ??
    we?.clientName ??
    so?.clientName ??
    pli?.paymentList?.clientName ??
    pay?.clientName ??
    null;

  const technician_name =
    po?.technicianName ??
    we?.technicianName ??
    so?.technicianName ??
    pli?.technicianName ??
    pay?.technicianName ??
    null;

  const platform = po?.platform ?? so?.platform ?? pay?.platform ?? null;
  const operational_unit =
    po?.operationalSiteKey ??
    we?.weeklog?.siteKey ??
    pli?.operationalSiteKey ??
    so?.operationalUnit ??
    pay?.operationalUnit ??
    null;

  const brand = po?.brand ?? we?.brand ?? null;
  const model = po?.model ?? we?.model ?? null;
  const car_name =
    so?.carName ??
    pli?.carName ??
    pay?.carName ??
    (brand && model ? `${brand} ${model}` : null);
  const license_plate =
    po?.licensePlate ??
    we?.licensePlate ??
    so?.licensePlate ??
    pli?.licensePlate ??
    pay?.licensePlate ??
    null;
  const vin = po?.vin ?? we?.vin ?? pli?.vin ?? null;

  let poTotal: number | null = null;
  if (po?.budgetRevision?.finalTotal != null) {
    poTotal = Number(po.budgetRevision.finalTotal);
  } else if (po?.budget?.total != null) {
    poTotal = Number(po.budget.total);
  } else if (Array.isArray(po?.performedServices) && po.performedServices.length > 0) {
    poTotal = po.performedServices.reduce((sum: number, s: any) => {
      const q = Number(s.quantity ?? 1) || 1;
      const pu = Number(s.unit_price ?? s.unitPrice ?? s.price ?? 0) || 0;
      return sum + (Number(s.total) || (q * pu));
    }, 0);
  }

  const pliTotal = pli?.totalAmount != null ? Number(pli.totalAmount) : null;
  const weTotal = we?.totalAmount != null ? Number(we.totalAmount) : null;
  const soTotal = so && typeof so.total === "number" && isFinite(so.total) ? so.total : null;
  const payTotal = pay && typeof pay.total === "number" && isFinite(pay.total) ? pay.total : null;

  const rawTotal = pliTotal ?? weTotal ?? soTotal ?? poTotal ?? payTotal ?? null;
  const valor_total = rawTotal != null ? Number(rawTotal.toFixed(2)) : null;

  const latestVal = we?.weeklog?.validations?.[0];
  const isApproved =
    latestVal?.status === "approved" || val.situation === "oui";
  const isRejected =
    latestVal?.status === "rejected" || val.situation === "non";

  const validation_situation: "oui" | "non" | null = isApproved
    ? "oui"
    : isRejected
      ? "non"
      : val.situation;

  const validation_assinado =
    Boolean(latestVal?.submittedAt) ||
    latestVal?.status === "approved" ||
    latestVal?.status === "signed" ||
    val.assinado;

  const validation_retificativa =
    we?.isRectification ? "partial" : val.retificativa;

  const valor_aprovado = isApproved
    ? (val.valor_final ?? pliTotal ?? weTotal ?? valor_total)
    : null;

  const isPaid =
    (pli?.paymentList?.status === "paid") ||
    (pay?.status === "paid") ||
    (payTotal != null &&
      typeof pay?.amountPaid === "number" &&
      pay.amountPaid >= payTotal - 0.005 &&
      payTotal > 0);

  let valor_pago = 0;
  if (typeof pay?.amountPaid === "number" && isFinite(pay.amountPaid) && pay.amountPaid > 0) {
    valor_pago = pay.amountPaid;
  } else if (isPaid && valor_total !== null) {
    valor_pago = valor_total;
  }

  const valor_pendente = isPaid
    ? 0
    : valor_total !== null
      ? Math.max(0, Number((valor_total - valor_pago).toFixed(2)))
      : null;

  const week_raw =
    we?.weeklog?.week ??
    so?.week ??
    (val.week_display
      ? (val.year_ref ? `${val.year_ref}-W${String(val.week_number ?? 0).padStart(2, "0")}` : val.week_display)
      : null);

  const status = deriveStatus({ po, so, pay, val, we, pli });
  const meta = STATUS_META[status];
  const has_error = status === "correcao_necessaria";

  const created_at =
    po?.createdAt?.toISOString() ??
    we?.createdAt?.toISOString() ??
    so?.createdAt?.toISOString() ??
    pay?.createdAt?.toISOString() ??
    new Date(0).toISOString();

  return {
    id:
      po?.id ??
      we?.id ??
      so?.id ??
      pay?.id ??
      `wf-${crypto.randomUUID()}`,
    origin: po
      ? "production_weeklog"
      : so
        ? "weeklog_only"
        : "payment_only",

    production_order_id: po?.id ?? we?.productionOrderId ?? null,
    production_code: po?.code ?? null,
    production_status: po?.status ?? null,
    production_delivered_at:
      po?.deliveredAt?.toISOString() ?? we?.deliveredAt?.toISOString() ?? null,

    service_order_id: so?.id ?? null,
    week: week_raw,
    week_number: we?.weeklog?.weekNumber ?? val.week_number,
    year_reference: we?.weeklog?.yearReference ?? val.year_ref ?? so?.yearReference ?? null,

    payment_order_id: pay?.id ?? pli?.legacyPaymentOrderId ?? val.payment_order_id ?? null,
    list_name: pli?.paymentList?.listNumber ?? pay?.listName ?? val.list_name ?? null,
    payment_status: pli?.paymentList?.status ?? pay?.status ?? null,

    client_name,
    technician_name,
    platform,
    operational_unit,

    brand,
    model,
    car_name,
    license_plate,
    vin,

    valor_total,
    valor_aprovado,
    valor_pago,
    valor_pendente,

    validation_situation,
    validation_assinado,
    validation_retificativa,

    status,
    status_label: meta.label,
    next_action: meta.next_action,
    has_error,

    created_at,
  };
}

export const workflowRouter = Router();

workflowRouter.get(
  "/",
  requireAuth,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const q = req.query as Record<string, string | undefined>;
      const workspace_id = q.workspace_id;
      if (!workspace_id)
        return res.status(400).json({ message: "workspace_id é obrigatório." });

      const [pos, sos, pays, paymentLists] = await Promise.all([
        prisma.productionOrder.findMany({
          where: { workspaceId: workspace_id },
          include: {
            budgetRevision: true,
            budget: true,
            weeklogEntries: {
              include: {
                weeklog: {
                  include: {
                    validations: {
                      orderBy: { validationSequence: "desc" },
                      take: 1,
                    },
                  },
                },
                paymentListItems: {
                  include: {
                    paymentList: true,
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.serviceOrder.findMany({
          where: {
            workspaceId: workspace_id,
            deletedAt: null,
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.paymentOrder.findMany({
          where: {
            workspaceId: workspace_id,
            deletedAt: null,
          },
          orderBy: { createdAt: "desc" },
        }),
        prisma.paymentList.findMany({
          where: { workspaceId: workspace_id },
          include: {
            items: true,
          },
          orderBy: { createdAt: "desc" },
        }),
      ]);

      const bySoId = new Map<string, SO>();
      for (const so of sos) bySoId.set(so.id, so);

      const byProductionSoFK = new Map<string, any>();
      const byProductionCode = new Map<string, any>();
      for (const po of pos) {
        if (po.serviceOrderId) byProductionSoFK.set(po.serviceOrderId, po);
        if (po.code) byProductionCode.set(po.code, po);
      }

      const payBySoId = new Map<string, PAY>();
      const payById = new Map<string, PAY>();
      const payByListName = new Map<string, PAY>();
      for (const pay of pays) {
        if (pay.serviceOrderId) payBySoId.set(pay.serviceOrderId, pay);
        if (pay.id) payById.set(pay.id, pay);
        if (pay.listName) payByListName.set(pay.listName, pay);
      }

      const seenKeys = new Set<string>();
      const seenPayIds = new Set<string>();
      const seenPaymentListIds = new Set<string>();
      const seenSoIds = new Set<string>();
      const items: WorkflowItem[] = [];

      const pushIfNew = (key: string, it: WorkflowItem) => {
        if (seenKeys.has(key)) return;
        seenKeys.add(key);
        items.push(it);
      };

      for (const po of pos) {
        const so = po.serviceOrderId ? bySoId.get(po.serviceOrderId) ?? null : null;
        if (so) seenSoIds.add(so.id);

        const we = po.weeklogEntries?.[0] ?? null;
        const pli = we?.paymentListItems?.[0] ?? null;

        if (pli?.paymentListId) seenPaymentListIds.add(pli.paymentListId);

        let pay: PAY | null = null;
        if (pli?.legacyPaymentOrderId) {
          pay = payById.get(pli.legacyPaymentOrderId) ?? null;
        }
        if (!pay && pli?.paymentList?.listNumber) {
          pay = payByListName.get(pli.paymentList.listNumber) ?? null;
        }
        if (!pay && so) {
          pay = payBySoId.get(so.id) ?? null;
        }

        if (pay) seenPayIds.add(pay.id);

        const it = itemFromParts({ po, so, pay, we, pli });
        pushIfNew(`po-${po.id}`, it);
      }

      for (const so of sos) {
        if (seenSoIds.has(so.id)) continue;
        if (seenKeys.has(`so-${so.id}`)) continue;
        const alreadyLinkedViaPO = byProductionSoFK.has(so.id);
        if (alreadyLinkedViaPO) continue;
        let po: any | null = null;
        if (!po) {
          const snap = so.distributionSnapshot;
          const base =
            snap &&
            typeof snap === "object" &&
            (snap as any)?.operational_document?.base;
          const code = base?.production_code ?? null;
          if (code) po = byProductionCode.get(String(code)) ?? null;
        }
        const pay = payBySoId.get(so.id) ?? null;
        if (pay) seenPayIds.add(pay.id);

        const it = itemFromParts({ po, so, pay });
        pushIfNew(`so-${so.id}`, it);
      }

      for (const pay of pays) {
        if (seenPayIds.has(pay.id)) continue;
        if (seenKeys.has(`pay-${pay.id}`)) continue;
        const so = pay.serviceOrderId ? bySoId.get(pay.serviceOrderId) ?? null : null;
        let po: any | null = so ? byProductionSoFK.get(so.id) ?? null : null;
        const it = itemFromParts({ po, so, pay });
        pushIfNew(`pay-${pay.id}`, it);
      }

      items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

      // === FILTROS ===
      const filt_year = q.year ? parseInt(q.year, 10) : null;
      const filt_client = q.client?.trim() || null;
      const filt_client_id = q.client_id?.trim() || null;
      const filt_local = q.local?.trim() || q.operational_unit?.trim() || null;
      const filt_technician = q.technician?.trim() || null;
      const filt_week = q.week?.trim() || null;
      const filt_status = q.status?.trim() || null;
      const filt_pagamento = q.pagamento?.trim() || q.payment?.trim() || null;
      const filt_origem = q.origem?.trim() || q.origin?.trim() || null;
      const filt_search = q.search?.trim() || null;
      const filt_plate = q.license_plate?.trim() || q.plate?.trim() || null;

      const filtered = items.filter((it) => {
        if (filt_year !== null) {
          if (!it.year_reference || it.year_reference !== filt_year) return false;
        }
        if (filt_client) {
          const n = (it.client_name ?? "").toLowerCase();
          if (!n.includes(filt_client.toLowerCase())) return false;
        }
        if (filt_local) {
          const u = (it.operational_unit ?? "").toLowerCase();
          if (!u.includes(filt_local.toLowerCase())) return false;
        }
        if (filt_technician) {
          const t = (it.technician_name ?? "").toLowerCase();
          if (!t.includes(filt_technician.toLowerCase())) return false;
        }
        if (filt_week) {
          const wk = (it.week ?? "").toLowerCase();
          const num = String(it.week_number ?? "");
          if (
            !wk.includes(filt_week.toLowerCase()) &&
            !num.includes(filt_week)
          )
            return false;
        }
        if (filt_status) {
          if (it.status !== filt_status) return false;
        }
        if (filt_pagamento) {
          if (filt_pagamento === "pago" || filt_pagamento === "paid") {
            if (it.status !== "pago" && it.status !== "encerrado") return false;
          } else if (filt_pagamento === "pendente") {
            if (!it.valor_pendente || it.valor_pendente <= 0) return false;
          } else if (filt_pagamento === "sem_pagamento" || filt_pagamento === "none") {
            if (it.payment_order_id) return false;
          }
        }
        if (filt_origem) {
          if (it.origin !== filt_origem) return false;
        }
        if (filt_plate) {
          const p = (it.license_plate ?? "").toLowerCase();
          if (!p.includes(filt_plate.toLowerCase())) return false;
        }
        if (filt_search) {
          const s = filt_search.toLowerCase();
          const hay = [
            it.client_name,
            it.technician_name,
            it.license_plate,
            it.vin,
            it.car_name,
            it.brand,
            it.model,
            it.production_code,
            it.list_name,
            it.week,
            it.platform,
          ]
            .map((x) => (x ?? "").toLowerCase())
            .join(" | ");
          if (!hay.includes(s)) return false;
        }
        return true;
      });

      // === RESUMO ===
      const by_status: Record<string, number> = {};
      let valor_total = 0;
      let valor_aprovado = 0;
      let valor_pago = 0;
      let valor_pendente = 0;
      let aguardando_acao = 0;
      let com_erro = 0;
      for (const it of filtered) {
        by_status[it.status] = (by_status[it.status] ?? 0) + 1;
        if (it.valor_total !== null && typeof it.valor_total === "number")
          valor_total += it.valor_total;
        if (it.valor_aprovado !== null) valor_aprovado += it.valor_aprovado;
        if (typeof it.valor_pago === "number") valor_pago += it.valor_pago;
        if (it.valor_pendente !== null) valor_pendente += it.valor_pendente;
        if (
          it.status !== "pago" &&
          it.status !== "encerrado" &&
          it.status !== "em_elaboracao"
        )
          aguardando_acao += 1;
        if (it.has_error) com_erro += 1;
      }
      const summary: WorkflowSummary = {
        count: filtered.length,
        valor_total: Number(valor_total.toFixed(2)),
        valor_aprovado: Number(valor_aprovado.toFixed(2)),
        valor_pago: Number(valor_pago.toFixed(2)),
        valor_pendente: Number(valor_pendente.toFixed(2)),
        by_status,
        aguardando_acao,
        com_erro,
      };

      return res.json({
        items: filtered,
        summary,
        status_meta: STATUS_META,
        filters_applied: {
          workspace_id,
          year: filt_year,
          client: filt_client,
          client_id: filt_client_id,
          operational_unit: filt_local,
          technician: filt_technician,
          week: filt_week,
          status: filt_status,
          pagamento: filt_pagamento,
          origem: filt_origem,
          search: filt_search,
          license_plate: filt_plate,
        },
      });
    } catch (err: any) {
      console.error("[workflow] unhandled error", err);
      return res.status(500).json({
        message: err?.message || "Erro interno ao carregar workflow consolidado.",
      });
    }
  },
);
