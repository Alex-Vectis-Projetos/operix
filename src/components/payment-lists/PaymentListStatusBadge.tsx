import { Badge } from "@/components/ui/badge";
import type { PaymentListStatus } from "@/lib/apiPaymentLists";
import { paymentListStatusLabel } from "./paymentListUi";

const styles: Record<PaymentListStatus, string> = {
  draft: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  under_review: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  confronted: "border-violet-500/40 bg-violet-500/10 text-violet-300",
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  paid: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  cancelled: "border-rose-500/40 bg-rose-500/10 text-rose-300",
};

export function PaymentListStatusBadge({ status }: { status: PaymentListStatus }) {
  return <Badge variant="outline" className={styles[status]}>{paymentListStatusLabel(status)}</Badge>;
}
