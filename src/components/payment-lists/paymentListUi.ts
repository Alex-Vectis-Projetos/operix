import type { ConfrontationDecisionInput, ConfrontationResult, PaymentListStatus } from "@/lib/apiPaymentLists";

const statusLabels: Record<PaymentListStatus, string> = {
  draft: "Rascunho",
  under_review: "Em revisão",
  confronted: "Confrontada",
  pending: "Pendente de recebimento",
  paid: "Recebida",
  cancelled: "Cancelada",
};

export function paymentListStatusLabel(status: PaymentListStatus) {
  return statusLabels[status];
}

/** Formats a Decimal transport string without turning it into a business calculation. */
export function formatPaymentListMoney(value: string, currencyCode: string) {
  const normalized = value.trim().replace(",", ".");
  const [integer = "0", fraction = ""] = normalized.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${currencyCode} ${grouped},${fraction.padEnd(2, "0").slice(0, 2)}`;
}

export function allowedConfrontationDecisions(result: Pick<ConfrontationResult, "status" | "paymentListItemId" | "weeklogEntryId">): ConfrontationDecisionInput[] {
  if (result.status === "exact_match") return [];
  const actions: ConfrontationDecisionInput[] = [];
  if (result.paymentListItemId) {
    if (result.status === "value_difference" || result.status === "service_discrepancy") actions.push("accept_difference");
    actions.push("contest", "reject_item");
  }
  if (result.weeklogEntryId) actions.push("request_rectification");
  return actions;
}

export function isGlobalCommercialTotal(value: unknown): value is string {
  return typeof value === "string";
}
