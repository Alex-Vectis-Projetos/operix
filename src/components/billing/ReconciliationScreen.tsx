import { useEffect, useMemo, useState } from "react";
import {
  GitMerge, Search, Filter, Sparkles, Link2, Unlink, AlertTriangle,
  CheckCircle2, Clock, Loader2, XCircle, Eye, ArrowRight, RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/api";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type RecStatus = "pending" | "partial" | "matched" | "divergent" | "analyzing" | "rejected";

type Invoice = {
  id: string;
  invoice_number: string;
  customer_name: string | null;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: string;
  due_date: string | null;
  issue_date: string | null;
};

type Payment = {
  id: string;
  invoice_id: string | null;
  reconciliation_id: string | null;
  amount: number;
  payment_date: string;
  reference: string | null;
  status: string;
  notes: string | null;
};

type Reconciliation = {
  id: string;
  reference: string | null;
  reconciliation_date: string;
  total_amount: number;
  status: RecStatus;
  notes: string | null;
  created_at: string;
};

// ─────────────────────────────────────────────────────────────
// Status meta
// ─────────────────────────────────────────────────────────────
const STATUS_META: Record<RecStatus, { label: string; cls: string; icon: any }> = {
  pending:   { label: "Não conciliado", cls: "bg-muted/40 text-muted-foreground border-border",        icon: Clock },
  partial:   { label: "Parcial",        cls: "bg-amber-500/10 text-amber-400 border-amber-500/30",   icon: Loader2 },
  matched:   { label: "Conciliado",     cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30", icon: CheckCircle2 },
  divergent: { label: "Divergente",     cls: "bg-destructive/10 text-destructive border-destructive/30", icon: AlertTriangle },
  analyzing: { label: "Em análise",     cls: "bg-primary/10 text-primary border-primary/30",         icon: Eye },
  rejected:  { label: "Rejeitado",      cls: "bg-muted/30 text-muted-foreground line-through border-border", icon: XCircle },
};

function StatusBadge({ status }: { status: RecStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.pending;
  const Icon = m.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 text-[10px]", m.cls)}>
      <Icon className="h-3 w-3" />
      {m.label}
    </Badge>
  );
}

const fmt = (n: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n || 0);

// ─────────────────────────────────────────────────────────────
// Suggestion engine — match unreconciled payments ↔ invoices
// ─────────────────────────────────────────────────────────────
type Suggestion = {
  payment: Payment;
  invoice: Invoice;
  diff: number;
  status: RecStatus;
  confidence: number;
};

function suggestMatches(payments: Payment[], invoices: Invoice[]): Suggestion[] {
  const openInvoices = invoices.filter((i) => Number(i.remaining_amount) > 0.01);
  const freePayments = payments.filter((p) => !p.invoice_id && !p.reconciliation_id);
  const out: Suggestion[] = [];
  const used = new Set<string>();

  for (const p of freePayments) {
    let best: { inv: Invoice; score: number } | null = null;
    for (const inv of openInvoices) {
      if (used.has(inv.id)) continue;
      const refScore =
        p.reference && inv.invoice_number &&
        inv.invoice_number.toLowerCase().includes(p.reference.toLowerCase().trim())
          ? 50 : 0;
      const valDiff = Math.abs(Number(p.amount) - Number(inv.remaining_amount));
      const valScore = valDiff < 0.01 ? 50 : valDiff < Number(inv.remaining_amount) * 0.05 ? 30 : 0;
      const score = refScore + valScore;
      if (score > 0 && (!best || score > best.score)) best = { inv, score };
    }
    if (best && best.score >= 30) {
      const diff = Number(p.amount) - Number(best.inv.remaining_amount);
      const status: RecStatus =
        Math.abs(diff) < 0.01 ? "matched" :
        Math.abs(diff) < Number(best.inv.remaining_amount) * 0.05 ? "partial" :
        "divergent";
      out.push({ payment: p, invoice: best.inv, diff, status, confidence: best.score });
      used.add(best.inv.id);
    }
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
export default function ReconciliationScreen() {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [recs, setRecs] = useState<Reconciliation[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tab, setTab] = useState("suggestions");

  // Manual matching dialog
  const [manualOpen, setManualOpen] = useState(false);
  const [pickPayment, setPickPayment] = useState<string>("");
  const [pickInvoice, setPickInvoice] = useState<string>("");
  const [manualNotes, setManualNotes] = useState("");

  // Detail panel
  const [detailRec, setDetailRec] = useState<Reconciliation | null>(null);

  async function loadAll() {
    setLoading(true);
    try {
      const [iRes, pRes] = await Promise.all([
        apiRequest<{ invoices: any[] }>("/billing/admin/ops/invoices").catch(() => ({ invoices: [] })),
        apiRequest<{ payments: any[] }>("/billing/admin/payments").catch(() => ({ payments: [] })),
      ]);
      const mappedInvoices = (iRes.invoices ?? []).map((inv: any) => ({
        id: inv.id,
        invoice_number: inv.invoice_number,
        customer_name: inv.customer_name,
        total_amount: Number(inv.total_amount) || 0,
        paid_amount: Number(inv.paid_amount) || 0,
        remaining_amount: Number(inv.remaining_amount) || 0,
        status: inv.status,
        due_date: inv.due_date,
        issue_date: inv.issue_date,
      }));
      const mappedPayments = (pRes.payments ?? []).map((pay: any) => ({
        id: pay.id,
        invoice_id: pay.invoice_id,
        reconciliation_id: pay.invoice_id ? `REC-${pay.id.slice(0, 8)}` : null,
        amount: Number(pay.amount) || 0,
        payment_date: pay.payment_date,
        reference: pay.reference,
        status: pay.status,
        notes: pay.notes,
      }));
      setInvoices(mappedInvoices);
      setPayments(mappedPayments);

      const derivedRecs: Reconciliation[] = mappedPayments
        .filter((p: any) => p.invoice_id)
        .map((p: any) => {
          const matchedInv = mappedInvoices.find((i: any) => i.id === p.invoice_id);
          const diff = matchedInv ? p.amount - matchedInv.total_amount : 0;
          const status: RecStatus = Math.abs(diff) < 0.01 ? "matched" : Math.abs(diff) < 50 ? "partial" : "divergent";
          return {
            id: `REC-${p.id}`,
            reference: p.reference || matchedInv?.invoice_number || `REC-${p.id.slice(0, 8)}`,
            reconciliation_date: p.payment_date,
            total_amount: p.amount,
            status,
            notes: p.notes,
            created_at: p.payment_date,
          };
        });
      setRecs(derivedRecs);
    } catch (e: any) {
      toast.error("Falha ao carregar dados: " + (e?.message || "Erro"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []);

  const suggestions = useMemo(() => suggestMatches(payments, invoices), [payments, invoices]);

  const filteredRecs = useMemo(() => {
    return recs.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!search) return true;
      const s = search.toLowerCase();
      return [r.reference, r.notes].filter(Boolean).some((v) => v!.toLowerCase().includes(s));
    });
  }, [recs, search, statusFilter]);

  const kpi = useMemo(() => {
    const matched = recs.filter((r) => r.status === "matched").length;
    const partial = recs.filter((r) => r.status === "partial").length;
    const divergent = recs.filter((r) => r.status === "divergent").length;
    const analyzing = recs.filter((r) => r.status === "analyzing").length;
    const unrec = payments.filter((p) => !p.invoice_id && !p.reconciliation_id).length;
    return { matched, partial, divergent, analyzing, unrec };
  }, [recs, payments]);

  // ─── Actions ───────────────────────────────────────────────
  async function applySuggestion(s: Suggestion) {
    try {
      await apiRequest(`/billing/admin/payments/${s.payment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_id: s.invoice.id,
          status: "confirmed",
          amount: s.payment.amount,
          payment_date: s.payment.payment_date,
        }),
      });
      toast.success("Conciliação aplicada");
      loadAll();
    } catch (e: any) {
      toast.error("Erro: " + (e?.message || "Falha"));
    }
  }

  async function manualMatch() {
    if (!pickPayment || !pickInvoice) return;
    const p = payments.find((x) => x.id === pickPayment);
    const i = invoices.find((x) => x.id === pickInvoice);
    if (!p || !i) return;

    try {
      await apiRequest(`/billing/admin/payments/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_id: i.id,
          status: "confirmed",
          amount: p.amount,
          payment_date: p.payment_date,
          notes: manualNotes || p.notes,
        }),
      });
      toast.success("Conciliação manual criada");
      setManualOpen(false);
      setPickPayment(""); setPickInvoice(""); setManualNotes("");
      loadAll();
    } catch (e: any) {
      toast.error("Erro: " + (e?.message || "Falha"));
    }
  }

  async function changeStatus(rec: Reconciliation, status: RecStatus) {
    setRecs((prev) => prev.map((r) => (r.id === rec.id ? { ...r, status } : r)));
    toast.success("Status atualizado");
  }

  async function unlinkRec(rec: Reconciliation) {
    try {
      const paymentId = rec.id.replace("REC-", "");
      await apiRequest(`/billing/admin/payments/${paymentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_id: null,
          status: "pending",
        }),
      });
      toast.success("Conciliação desfeita");
      setDetailRec(null);
      loadAll();
    } catch (e: any) {
      toast.error("Erro: " + (e?.message || "Falha"));
    }
  }

  const detailLinkedPayments = useMemo(
    () => detailRec ? payments.filter((p) => p.reconciliation_id === detailRec.id) : [],
    [detailRec, payments],
  );
  const detailLinkedInvoices = useMemo(() => {
    const ids = new Set(detailLinkedPayments.map((p) => p.invoice_id).filter(Boolean) as string[]);
    return invoices.filter((i) => ids.has(i.id));
  }, [detailLinkedPayments, invoices]);

  // ─── Render ────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb>
        <BreadcrumbList className="text-xs">
          <BreadcrumbItem><BreadcrumbLink href="/billing/faturas">Faturamento</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Conciliação</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <GitMerge className="h-5 w-5 text-primary" /> Conciliação Financeira
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Cruzamento automático e manual entre pagamentos e faturas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={loadAll}>
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", loading && "animate-spin")} />
            Atualizar
          </Button>
          <Button size="sm" className="h-8" onClick={() => setManualOpen(true)}>
            <Link2 className="h-3.5 w-3.5 mr-1.5" />
            Conciliação manual
          </Button>
        </div>
      </div>

      {/* KPI band */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Conciliados",   value: kpi.matched,   cls: "text-emerald-400" },
          { label: "Parciais",      value: kpi.partial,   cls: "text-amber-400" },
          { label: "Divergentes",   value: kpi.divergent, cls: "text-destructive" },
          { label: "Em análise",    value: kpi.analyzing, cls: "text-primary" },
          { label: "Não conciliados", value: kpi.unrec,   cls: "text-muted-foreground" },
        ].map((k) => (
          <Card key={k.label} className="border-border/50">
            <CardContent className="pt-4 pb-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</p>
              <p className={cn("text-lg font-semibold tabular-nums", k.cls)}>{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="suggestions" className="text-xs">
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            Sugestões ({suggestions.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs">
            Histórico ({recs.length})
          </TabsTrigger>
        </TabsList>

        {/* SUGGESTIONS TAB */}
        <TabsContent value="suggestions" className="mt-4">
          <Card className="border-border/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Sugestões automáticas
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 mx-auto animate-spin mb-2" /> Analisando...
                </div>
              ) : suggestions.length === 0 ? (
                <div className="py-12 text-center text-xs text-muted-foreground">
                  Nenhuma sugestão disponível. Todos os pagamentos parecem estar vinculados.
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {suggestions.map((s) => (
                    <div key={s.payment.id} className="p-4 hover:bg-accent/30 transition-colors">
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto] gap-3 items-center">
                        {/* Payment */}
                        <div className="rounded-md border border-border/50 bg-card/30 p-3">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pagamento</p>
                          <p className="font-mono text-xs text-primary mt-1">{s.payment.reference || s.payment.id.slice(0, 8)}</p>
                          <p className="text-sm font-semibold tabular-nums mt-0.5">{fmt(Number(s.payment.amount))}</p>
                          <p className="text-[10px] text-muted-foreground">{s.payment.payment_date}</p>
                        </div>

                        <ArrowRight className="h-4 w-4 text-muted-foreground mx-auto hidden md:block" />

                        {/* Invoice */}
                        <div className="rounded-md border border-border/50 bg-card/30 p-3">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Fatura</p>
                          <p className="font-mono text-xs text-primary mt-1">{s.invoice.invoice_number}</p>
                          <p className="text-sm font-semibold tabular-nums mt-0.5">{fmt(Number(s.invoice.remaining_amount))}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{s.invoice.customer_name || "—"}</p>
                        </div>

                        {/* Action + diff */}
                        <div className="flex flex-col gap-2 items-end">
                          <StatusBadge status={s.status} />
                          {Math.abs(s.diff) >= 0.01 && (
                            <div className={cn(
                              "text-[10px] flex items-center gap-1",
                              s.status === "divergent" ? "text-destructive" : "text-amber-400",
                            )}>
                              <AlertTriangle className="h-3 w-3" />
                              Δ {fmt(s.diff)}
                            </div>
                          )}
                          <Button size="sm" className="h-7 text-xs" onClick={() => applySuggestion(s)}>
                            Aplicar
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* HISTORY TAB */}
        <TabsContent value="history" className="mt-4 space-y-4">
          <Card className="border-border/50">
            <CardContent className="pt-4 pb-3 flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Pesquisar referência ou notas..."
                  className="h-8 pl-8 text-xs"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 w-[180px] text-xs">
                  <Filter className="h-3 w-3 mr-1.5" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os estados</SelectItem>
                  {Object.entries(STATUS_META).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card className="border-border/50 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="text-[10px] uppercase tracking-wider">
                  <TableHead>Referência</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Montante</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRecs.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-12 text-xs text-muted-foreground">Nenhuma conciliação encontrada</TableCell></TableRow>
                ) : (
                  filteredRecs.map((r) => (
                    <TableRow key={r.id} className="text-xs">
                      <TableCell className="font-mono text-[11px] text-primary">{r.reference || r.id.slice(0, 8)}</TableCell>
                      <TableCell className="text-muted-foreground">{r.reconciliation_date}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{fmt(Number(r.total_amount))}</TableCell>
                      <TableCell><StatusBadge status={r.status} /></TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Select value={r.status} onValueChange={(v) => changeStatus(r, v as RecStatus)}>
                            <SelectTrigger className="h-7 w-[130px] text-[10px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(STATUS_META).map(([k, v]) => (
                                <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDetailRec(r)}>
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Manual matching dialog */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Conciliação manual</DialogTitle>
            <DialogDescription className="text-xs">
              Vincule um pagamento a uma fatura e gere o registro de auditoria.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
            <div className="space-y-2">
              <label className="text-xs font-medium">Pagamento</label>
              {payments.length === 0 ? (
                <div className="rounded border border-dashed border-border/70 p-2 text-center text-xs text-muted-foreground bg-muted/20">
                  <p>Nenhum pagamento registado.</p>
                  <p className="text-[10px] mt-0.5">Registe recebimentos no separador <strong>Pagamentos</strong> para conciliar.</p>
                </div>
              ) : (
                <Select value={pickPayment} onValueChange={setPickPayment}>
                  <SelectTrigger className="text-xs"><SelectValue placeholder="Escolher pagamento..." /></SelectTrigger>
                  <SelectContent>
                    {payments.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">
                        {(p.reference || p.id.slice(0, 8))} · {fmt(Number(p.amount))} · {p.payment_date}
                        {p.reconciliation_id ? " (Já vinculado)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium">Fatura</label>
              <Select value={pickInvoice} onValueChange={setPickInvoice}>
                <SelectTrigger className="text-xs"><SelectValue placeholder="Escolher fatura..." /></SelectTrigger>
                <SelectContent>
                  {invoices.filter((i) => Number(i.remaining_amount) > 0).map((i) => (
                    <SelectItem key={i.id} value={i.id} className="text-xs">
                      {i.invoice_number} · {fmt(Number(i.remaining_amount))} · {i.customer_name || "—"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {pickPayment && pickInvoice && (() => {
            const p = payments.find((x) => x.id === pickPayment)!;
            const i = invoices.find((x) => x.id === pickInvoice)!;
            const diff = Number(p.amount) - Number(i.remaining_amount);
            return (
              <div className="rounded-md border border-border/50 bg-card/40 p-3 grid grid-cols-3 gap-3 text-xs">
                <div><p className="text-muted-foreground">Pago</p><p className="font-semibold tabular-nums">{fmt(Number(p.amount))}</p></div>
                <div><p className="text-muted-foreground">Fatura</p><p className="font-semibold tabular-nums">{fmt(Number(i.remaining_amount))}</p></div>
                <div><p className="text-muted-foreground">Diferença</p>
                  <p className={cn("font-semibold tabular-nums", Math.abs(diff) < 0.01 ? "text-emerald-400" : "text-destructive")}>
                    {fmt(diff)}
                  </p>
                </div>
              </div>
            );
          })()}

          <Textarea
            value={manualNotes}
            onChange={(e) => setManualNotes(e.target.value)}
            placeholder="Notas de auditoria (opcional)"
            rows={2}
            className="text-xs"
          />

          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)}>Cancelar</Button>
            <Button onClick={manualMatch} disabled={!pickPayment || !pickInvoice}>
              <Link2 className="h-3.5 w-3.5 mr-1.5" /> Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail panel */}
      <Sheet open={!!detailRec} onOpenChange={(o) => !o && setDetailRec(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
          {detailRec && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <GitMerge className="h-4 w-4 text-primary" />
                  {detailRec.reference || detailRec.id.slice(0, 8)}
                </SheetTitle>
                <SheetDescription className="text-xs">
                  {detailRec.reconciliation_date} · Criado em {new Date(detailRec.created_at).toLocaleString("pt-PT")}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-4">
                <div className="flex items-center gap-2">
                  <StatusBadge status={detailRec.status} />
                  <span className="text-sm tabular-nums font-semibold ml-auto">{fmt(Number(detailRec.total_amount))}</span>
                </div>

                {detailRec.notes && (
                  <Card className="border-border/50">
                    <CardContent className="pt-3 pb-3 text-xs text-muted-foreground whitespace-pre-wrap">
                      {detailRec.notes}
                    </CardContent>
                  </Card>
                )}

                {/* Comparative panel */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Pagamento vs Fatura</p>
                  {detailLinkedPayments.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum pagamento vinculado.</p>
                  ) : (
                    detailLinkedPayments.map((p) => {
                      const inv = invoices.find((i) => i.id === p.invoice_id);
                      const diff = inv ? Number(p.amount) - Number(inv.total_amount) : 0;
                      return (
                        <div key={p.id} className="grid grid-cols-2 gap-2 mb-2">
                          <Card className="border-border/50">
                            <CardContent className="pt-3 pb-3">
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pago</p>
                              <p className="font-mono text-xs text-primary">{p.reference || p.id.slice(0, 8)}</p>
                              <p className="text-sm font-semibold tabular-nums">{fmt(Number(p.amount))}</p>
                              <p className="text-[10px] text-muted-foreground">{p.payment_date}</p>
                            </CardContent>
                          </Card>
                          <Card className={cn("border-border/50", inv && Math.abs(diff) >= 0.01 && "border-destructive/40")}>
                            <CardContent className="pt-3 pb-3">
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Fatura</p>
                              {inv ? (
                                <>
                                  <p className="font-mono text-xs text-primary">{inv.invoice_number}</p>
                                  <p className="text-sm font-semibold tabular-nums">{fmt(Number(inv.total_amount))}</p>
                                  <p className="text-[10px] text-muted-foreground truncate">{inv.customer_name || "—"}</p>
                                  {Math.abs(diff) >= 0.01 && (
                                    <p className="text-[10px] text-destructive mt-1 flex items-center gap-1">
                                      <AlertTriangle className="h-3 w-3" /> Δ {fmt(diff)}
                                    </p>
                                  )}
                                </>
                              ) : (
                                <p className="text-xs text-muted-foreground">Sem fatura vinculada</p>
                              )}
                            </CardContent>
                          </Card>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="flex justify-between gap-2 pt-2 border-t border-border/50">
                  <Button variant="outline" size="sm" onClick={() => unlinkRec(detailRec)}>
                    <Unlink className="h-3.5 w-3.5 mr-1.5" /> Desfazer
                  </Button>
                  <Select value={detailRec.status} onValueChange={(v) => changeStatus(detailRec, v as RecStatus)}>
                    <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_META).map(([k, v]) => (
                        <SelectItem key={k} value={k} className="text-xs">{v.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
