import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { CheckCircle2, XCircle, Eye, Landmark, Clock } from "lucide-react";
import { toast } from "sonner";
import { LoadingState } from "@/components/shared/LoadingState";
import {
  useAdminPendingTransfers, useApproveManualTransfer, useRejectManualTransfer,
  signedProofUrl, statusMeta,
} from "@/hooks/useManualPayments";
import { openOrDownloadFile } from "@/lib/storage";

function fmtMoney(v: number, c = "EUR") {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: c }).format(v);
}

export function ManualPaymentsReview() {
  const { data: rows = [], isLoading, refetch } = useAdminPendingTransfers();
  const approve = useApproveManualTransfer();
  const reject = useRejectManualTransfer();
  const [acting, setActing] = useState<{ id: string; mode: "approve" | "reject" } | null>(null);
  const [reason, setReason] = useState("");

  const handleAction = async () => {
    if (!acting) return;
    try {
      if (acting.mode === "approve") {
        await approve.mutateAsync({ id: acting.id, notes: reason || undefined });
        toast.success("Pagamento aprovado · fatura marcada como paga");
      } else {
        if (!reason.trim()) return toast.error("Indique um motivo");
        await reject.mutateAsync({ id: acting.id, reason });
        toast.success("Pagamento rejeitado");
      }
      setActing(null); setReason(""); refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Falha na ação");
    }
  };

  const openProof = async (path: string, fileName = "comprovante") => {
    const url = await signedProofUrl(path);
    if (!url) return toast.error("Não foi possível abrir o comprovante");
    openOrDownloadFile(url, fileName);
  };

  if (isLoading) return <LoadingState variant="cards" />;

  return (
    <Card className="surface-card overflow-hidden">
      <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Landmark className="h-4 w-4 text-primary" /> Pagamentos manuais a validar
        </h3>
        <Badge variant="outline" className="text-[10px]">{rows.length} pendente(s)</Badge>
      </div>

      {rows.length === 0 ? (
        <div className="p-8 text-center text-xs text-muted-foreground flex flex-col items-center gap-2">
          <CheckCircle2 className="h-8 w-8 text-emerald-400/60" />
          Sem pagamentos a validar.
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {rows.map((t: any) => {
            const sm = statusMeta(t.status);
            return (
              <div key={t.id} className="p-4 flex flex-wrap items-center gap-3">
                <div className={`h-9 w-9 rounded-md grid place-items-center bg-background/60 border border-border/40 ${sm.tone}`}>
                  {t.status === "awaiting_transfer" ? <Clock className="h-4 w-4" /> : <Landmark className="h-4 w-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">{t.workspaces?.name ?? t.workspace_id.slice(0, 8)}</span>
                    <Badge variant="outline" className={`text-[10px] ${sm.tone}`}>{sm.label}</Badge>
                    {t.platform_invoices?.invoice_number && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        {t.platform_invoices.invoice_number}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-[10px]">{t.payment_method ?? "—"}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Ref. <span className="font-mono">{t.reference_code}</span>
                    {t.transfer_date && ` · Transferido em ${new Date(t.transfer_date).toLocaleDateString("pt-PT")}`}
                    {` · Submetido ${new Date(t.declared_at).toLocaleString("pt-PT")}`}
                  </p>
                  {t.notes && <p className="text-xs text-muted-foreground mt-1 italic">"{t.notes}"</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold">{fmtMoney(Number(t.amount), t.currency)}</p>
                </div>
                {t.proof_path && (
                  <Button size="sm" variant="outline" onClick={() => openProof(t.proof_path)} className="h-8 gap-1">
                    <Eye className="h-3.5 w-3.5" /> Comprovante
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setActing({ id: t.id, mode: "approve" })}
                  className="h-8 gap-1 text-emerald-400 hover:text-emerald-300">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Aprovar
                </Button>
                <Button size="sm" variant="outline" onClick={() => setActing({ id: t.id, mode: "reject" })}
                  className="h-8 gap-1 text-red-400 hover:text-red-300">
                  <XCircle className="h-3.5 w-3.5" /> Rejeitar
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!acting} onOpenChange={(v) => !v && setActing(null)}>
        <DialogContent className="surface-card">
          <DialogHeader>
            <DialogTitle>{acting?.mode === "approve" ? "Aprovar pagamento" : "Rejeitar pagamento"}</DialogTitle>
            <DialogDescription>
              {acting?.mode === "approve"
                ? "Confirma a receção da transferência. A fatura será marcada como paga e a assinatura reativada."
                : "Indique o motivo da rejeição. O cliente será notificado."}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={acting?.mode === "approve" ? "Notas internas (opcional)" : "Motivo da rejeição (obrigatório)"}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setActing(null)}>Cancelar</Button>
            <Button
              onClick={handleAction}
              className={acting?.mode === "approve" ? "" : "bg-red-600 hover:bg-red-700"}
              disabled={approve.isPending || reject.isPending}
            >
              {acting?.mode === "approve" ? "Aprovar" : "Rejeitar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
