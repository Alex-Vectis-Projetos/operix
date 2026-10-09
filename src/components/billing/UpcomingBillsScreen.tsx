import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search, AlertTriangle, CalendarClock, CheckCircle2, Clock, Flame,
  CreditCard, Loader2, Bell, ArrowRight, Filter,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/api";

type Invoice = {
  id: string;
  invoice_number: string;
  customer_name: string | null;
  issue_date: string;
  due_date: string | null;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: string;
  notes?: string | null;
};
type Method = {
  id: string;
  name: string;
};

type Bucket = "today" | "next7" | "next30" | "overdue" | "paid";

const BUCKETS: { id: Bucket; label: string; icon: typeof Flame; tone: string; ring: string; glow: string }[] = [
  { id: "overdue", label: "Vencidas",         icon: Flame,         tone: "text-destructive",  ring: "border-destructive/40", glow: "shadow-[0_0_30px_-10px_hsl(var(--destructive)/0.5)]" },
  { id: "today",   label: "Vencendo hoje",    icon: AlertTriangle, tone: "text-amber-400",     ring: "border-amber-500/40",   glow: "shadow-[0_0_30px_-10px_hsl(45_93%_47%/0.5)]" },
  { id: "next7",   label: "Próximos 7 dias",  icon: Clock,         tone: "text-orange-400",    ring: "border-orange-500/40",  glow: "shadow-[0_0_30px_-10px_hsl(25_95%_53%/0.4)]" },
  { id: "next30",  label: "Próximos 30 dias", icon: CalendarClock, tone: "text-primary",       ring: "border-primary/40",     glow: "shadow-[0_0_30px_-10px_hsl(var(--primary)/0.4)]" },
  { id: "paid",    label: "Pagas",            icon: CheckCircle2,  tone: "text-emerald-400",   ring: "border-emerald-500/40", glow: "shadow-[0_0_30px_-10px_hsl(142_71%_45%/0.4)]" },
];

const fmt = (v: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v || 0);

const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", year: "numeric" }) : "—";

function daysUntil(due?: string | null): number | null {
  if (!due) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(due); d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

function classify(inv: Invoice): Bucket {
  if (inv.status === "paid" || inv.status === "cancelled") return "paid";
  const d = daysUntil(inv.due_date);
  if (d === null) return "next30";
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d <= 7) return "next7";
  return "next30";
}

export default function UpcomingBillsScreen() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [activeBucket, setActiveBucket] = useState<Bucket | "all">("all");
  const [payDialog, setPayDialog] = useState<Invoice | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<string>("");
  const [paying, setPaying] = useState(false);

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ["billing-invoices-upcoming"],
    queryFn: async () => {
      const data = await apiRequest<{ invoices: Invoice[] }>("/billing/admin/ops/invoices");
      return data.invoices ?? [];
    },
  });

  const { data: methods = [] } = useQuery({
    queryKey: ["billing-payment-methods-active"],
    queryFn: async () => {
      const data = await apiRequest<{ methods: Method[] }>("/billing/admin/payment-methods");
      return data.methods ?? [];
    },
  });

  const grouped = useMemo(() => {
    const g: Record<Bucket, Invoice[]> = { today: [], next7: [], next30: [], overdue: [], paid: [] };
    for (const inv of invoices) g[classify(inv)].push(inv);
    return g;
  }, [invoices]);

  const visible = useMemo(() => {
    const base = activeBucket === "all"
      ? invoices
      : grouped[activeBucket];
    if (!search.trim()) return base;
    const s = search.toLowerCase();
    return base.filter((i) =>
      [i.invoice_number, i.customer_name, i.notes].some((v) => (v ?? "").toLowerCase().includes(s)),
    );
  }, [invoices, grouped, activeBucket, search]);

  const totals = useMemo(() => {
    const sum = (arr: Invoice[]) =>
      arr.reduce((s, i) => s + Number(i.remaining_amount ?? i.total_amount ?? 0), 0);
    return {
      today: sum(grouped.today),
      next7: sum(grouped.next7),
      next30: sum(grouped.next30),
      overdue: sum(grouped.overdue),
      paid: grouped.paid.reduce((s, i) => s + Number(i.paid_amount ?? 0), 0),
    };
  }, [grouped]);

  const openPay = (inv: Invoice) => {
    setPayDialog(inv);
    setPayAmount(String(inv.remaining_amount ?? inv.total_amount ?? 0));
    setPayMethod(methods[0]?.id ?? "");
  };

  const confirmPay = async () => {
    if (!payDialog) return;
    const amt = Number(payAmount);
    if (!amt || amt <= 0) {
      toast({ title: "Valor inválido", variant: "destructive" });
      return;
    }
    setPaying(true);
    try {
      await apiRequest("/billing/admin/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_id: payDialog.id,
          amount: amt,
          payment_method_id: payMethod || null,
          payment_date: new Date().toISOString().slice(0, 10),
          status: "confirmed",
          reference: null,
          notes: null,
          account: null,
          proof_path: null,
          proof_name: null,
        }),
      });
      toast({ title: "Pagamento registrado com sucesso" });
      setPayDialog(null);
      qc.invalidateQueries({ queryKey: ["billing-invoices-upcoming"] });
      qc.invalidateQueries({ queryKey: ["admin-payments-ledger"] });
      qc.invalidateQueries({ queryKey: ["admin-invoices-ops"] });
    } catch (e: any) {
      toast({ title: "Erro ao registrar pagamento", description: e.message, variant: "destructive" });
    } finally {
      setPaying(false);
    }
  };

  const remindAll = async () => {
    try {
      const targets = grouped.overdue.concat(grouped.today);
      if (!targets.length) {
        toast({ title: "Nenhuma fatura crítica", description: "Não existem faturas vencidas ou a vencer hoje." });
        return;
      }
      const data = await apiRequest<{ sent: number; total: number }>("/billing/admin/ops/invoices/remind-critical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoice_ids: targets.map((invoice) => invoice.id),
        }),
      });
      toast({
        title: `${data.sent ?? targets.length} alertas de cobrança emitidos`,
        description: "Notificações registradas e enviadas para os clientes com faturas críticas.",
      });
    } catch (e: any) {
      toast({ title: "Erro ao notificar", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb>
        <BreadcrumbList className="text-xs">
          <BreadcrumbItem><BreadcrumbLink href="/billing/faturas">Faturamento</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Contas a vencer</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Contas a vencer</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Painel operacional de vencimentos e pagamentos prioritários
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-8" onClick={remindAll}>
          <Bell className="h-3.5 w-3.5 mr-1.5" />
          Notificar críticos
        </Button>
      </div>

      {/* Priority cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {BUCKETS.map((b) => {
          const Icon = b.icon;
          const count = grouped[b.id].length;
          const total = totals[b.id];
          const active = activeBucket === b.id;
          return (
            <button
              key={b.id}
              onClick={() => setActiveBucket(active ? "all" : b.id)}
              className={cn(
                "text-left rounded-lg border bg-card/60 backdrop-blur-sm p-3 transition-all hover:scale-[1.02]",
                b.ring,
                active ? cn("ring-2 ring-offset-2 ring-offset-background", b.glow) : "border-border/50",
                active && b.id === "overdue" && "ring-destructive",
                active && b.id === "today" && "ring-amber-500",
                active && b.id === "next7" && "ring-orange-500",
                active && b.id === "next30" && "ring-primary",
                active && b.id === "paid" && "ring-emerald-500",
              )}
            >
              <div className="flex items-center justify-between mb-2">
                <Icon className={cn("h-4 w-4", b.tone)} />
                <Badge variant="outline" className={cn("text-[10px]", b.tone, b.ring)}>{count}</Badge>
              </div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{b.label}</p>
              <p className={cn("text-base font-semibold tabular-nums mt-1", b.tone)}>{fmt(total)}</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <Card className="border-border/50">
        <CardContent className="pt-4 pb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar por número, cliente ou notas..."
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Select value={activeBucket} onValueChange={(v) => setActiveBucket(v as Bucket | "all")}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <Filter className="h-3 w-3 mr-1.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os grupos</SelectItem>
              {BUCKETS.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : activeBucket === "all" ? (
        <div className="space-y-6">
          {BUCKETS.map((b) => {
            const list = (search
              ? grouped[b.id].filter((i) =>
                  [i.invoice_number, i.customer_name, i.notes].some((v) =>
                    (v ?? "").toLowerCase().includes(search.toLowerCase()),
                  ),
                )
              : grouped[b.id]
            );
            if (!list.length) return null;
            return (
              <BucketSection
                key={b.id}
                bucket={b}
                items={list}
                onPay={openPay}
              />
            );
          })}
          {visible.length === 0 && (
            <Card className="border-border/50">
              <CardContent className="py-16 text-center text-xs text-muted-foreground">
                Nenhuma fatura encontrada.
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <BucketSection
          bucket={BUCKETS.find((b) => b.id === activeBucket)!}
          items={visible}
          onPay={openPay}
        />
      )}

      {/* Quick pay dialog */}
      <Dialog open={!!payDialog} onOpenChange={(o) => !o && setPayDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-primary" />
              Pagamento rápido
            </DialogTitle>
          </DialogHeader>
          {payDialog && (
            <div className="space-y-3">
              <div className="rounded-md border border-border/50 bg-muted/20 p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Fatura</span>
                  <span className="font-mono text-primary">{payDialog.invoice_number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Cliente</span>
                  <span>{payDialog.customer_name ?? "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Vencimento</span>
                  <span>{fmtDate(payDialog.due_date)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Saldo</span>
                  <span className="font-semibold text-amber-400">
                    {fmt(Number(payDialog.remaining_amount ?? payDialog.total_amount ?? 0))}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] uppercase tracking-wider">Valor</Label>
                  <Input
                    type="number" step="0.01"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[10px] uppercase tracking-wider">Método</Label>
                  <Select value={payMethod} onValueChange={setPayMethod}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>
                      {methods.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPayDialog(null)}>Cancelar</Button>
            <Button size="sm" onClick={confirmPay} disabled={paying}>
              {paying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5 mr-1.5" />}
              Confirmar pagamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Bucket section
// ─────────────────────────────────────────────────────────────
function BucketSection({
  bucket,
  items,
  onPay,
}: {
  bucket: typeof BUCKETS[number];
  items: Invoice[];
  onPay: (inv: Invoice) => void;
}) {
  const Icon = bucket.icon;
  return (
    <div className="space-y-2 animate-fade-in">
      <div className="flex items-center gap-2 px-1">
        <Icon className={cn("h-3.5 w-3.5", bucket.tone)} />
        <h3 className={cn("text-xs font-semibold uppercase tracking-wider", bucket.tone)}>{bucket.label}</h3>
        <span className="text-[10px] text-muted-foreground">· {items.length}</span>
        <div className={cn("flex-1 h-px", bucket.ring.replace("border", "bg").replace("/40", "/20"))} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {items.map((inv) => {
          const d = daysUntil(inv.due_date);
          const isPaid = bucket.id === "paid";
          return (
            <Card
              key={inv.id}
              className={cn(
                "border bg-card/60 backdrop-blur-sm transition-all hover:scale-[1.005]",
                bucket.ring,
                bucket.id === "overdue" && "hover:shadow-[0_0_20px_-8px_hsl(var(--destructive)/0.6)]",
                bucket.id === "today" && "hover:shadow-[0_0_20px_-8px_hsl(45_93%_47%/0.6)]",
              )}
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-primary">{inv.invoice_number}</span>
                      {!isPaid && d !== null && (
                        <Badge variant="outline" className={cn("text-[9px]", bucket.tone, bucket.ring)}>
                          {d < 0 ? `${Math.abs(d)}d em atraso` : d === 0 ? "Hoje" : `Em ${d}d`}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs font-medium mt-1 truncate">{inv.customer_name ?? "—"}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Vence {fmtDate(inv.due_date)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={cn("text-sm font-semibold tabular-nums", bucket.tone)}>
                      {fmt(Number(inv.remaining_amount ?? inv.total_amount ?? 0))}
                    </p>
                    <p className="text-[9px] text-muted-foreground tabular-nums">
                      Total {fmt(Number(inv.total_amount ?? 0))}
                    </p>
                  </div>
                </div>
                {!isPaid && (
                  <div className="flex justify-end mt-2">
                    <Button
                      size="sm" variant="ghost"
                      className="h-7 text-[11px] text-primary hover:text-primary"
                      onClick={() => onPay(inv)}
                    >
                      <CreditCard className="h-3 w-3 mr-1" />
                      Pagar agora
                      <ArrowRight className="h-3 w-3 ml-1" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
