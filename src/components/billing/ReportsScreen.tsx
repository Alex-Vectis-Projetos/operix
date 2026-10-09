import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, Download, FileSpreadsheet, FileText,
  DollarSign, AlertTriangle, Wallet, Activity, Truck, Car, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { format, subMonths, startOfMonth, endOfMonth, parseISO } from "date-fns";
import { pt } from "date-fns/locale";
import { apiRequest } from "@/lib/api";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────
// Types & helpers
// ─────────────────────────────────────────────────────────────
type Invoice = {
  id: string;
  invoice_number: string;
  type: "incoming" | "outgoing";
  total_amount: number;
  paid_amount: number;
  remaining_amount: number | null;
  status: string;
  issue_date: string;
  due_date: string | null;
  fleet_id: string | null;
  vehicle_id: string | null;
  supplier_id: string | null;
};
type Payment = {
  id: string;
  amount: number;
  payment_date: string;
  status: string;
  invoice_id: string;
};

const STATUS_LABELS: Record<string, string> = {
  paid: "Pago",
  pending: "Pendente",
  overdue: "Atrasado",
  partial: "Parcial",
  draft: "Rascunho",
  cancelled: "Cancelado",
};

const STATUS_COLORS: Record<string, string> = {
  paid: "hsl(142 76% 45%)",
  pending: "hsl(38 92% 55%)",
  overdue: "hsl(0 84% 60%)",
  partial: "hsl(217 91% 60%)",
  draft: "hsl(215 16% 50%)",
  cancelled: "hsl(280 50% 60%)",
};

const eur = (n: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n || 0);

const eurFull = (n: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(n || 0);

function StatusPieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;
  return (
    <div className="rounded-md border border-border/60 bg-popover/95 backdrop-blur-sm px-3 py-2 text-xs shadow-xl min-w-[170px]">
      <div className="flex items-center gap-2 mb-1.5 pb-1 border-b border-border/50">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: data.color }} />
        <span className="font-semibold text-foreground">{data.name}</span>
      </div>
      <div className="space-y-1 text-muted-foreground text-[11px]">
        <div className="flex justify-between gap-4">
          <span>Quantidade:</span>
          <span className="font-mono font-medium text-foreground">{data.count} ({data.countPct.toFixed(1)}%)</span>
        </div>
        <div className="flex justify-between gap-4">
          <span>Valor total:</span>
          <span className="font-mono font-medium text-foreground">{eurFull(data.amount)} ({data.amountPct.toFixed(1)}%)</span>
        </div>
      </div>
    </div>
  );
}

// Tooltip themed
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border/60 bg-popover/95 backdrop-blur-sm px-3 py-2 text-xs shadow-xl">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2 tabular-nums">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium">{typeof p.value === "number" ? eurFull(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────
export default function ReportsScreen() {
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [periodMonths, setPeriodMonths] = useState<number>(6);
  const [view, setView] = useState<"overview" | "fleet" | "trends">("overview");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [emailingPdf, setEmailingPdf] = useState(false);

  const [distMetric, setDistMetric] = useState<"amount" | "count">("amount");

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await apiRequest<{ invoices: Invoice[] }>("/billing/admin/ops/invoices");
      setInvoices((data?.invoices || []) as any);
      setPayments([]);
    } catch (e: any) {
      toast.error("Erro ao carregar relatórios", { description: e?.message ?? "Falha de comunicação" });
    } finally {
      setLoading(false);
    }
  }

  // Build monthly buckets
  const monthly = useMemo(() => {
    const now = new Date();
    const buckets: { key: string; label: string; start: Date; end: Date }[] = [];
    for (let i = periodMonths - 1; i >= 0; i--) {
      const d = subMonths(now, i);
      buckets.push({
        key: format(d, "yyyy-MM"),
        label: format(d, "MMM/yy", { locale: pt }),
        start: startOfMonth(d),
        end: endOfMonth(d),
      });
    }
    return buckets.map((b) => {
      const monthInv = invoices.filter((i) => {
        const d = parseISO(i.issue_date);
        return d >= b.start && d <= b.end;
      });
      const revenue = monthInv.filter((i) => i.type === "outgoing").reduce((s, i) => s + Number(i.total_amount), 0);
      const expenses = monthInv.filter((i) => i.type === "incoming").reduce((s, i) => s + Number(i.total_amount), 0);
      const received = monthInv.filter((i) => i.type === "outgoing").reduce((s, i) => s + Number(i.paid_amount || 0), 0);
      const overdue = monthInv.filter((i) => i.status === "overdue").reduce((s, i) => s + Number(i.remaining_amount ?? i.total_amount), 0);
      return {
        label: b.label,
        revenue,
        expenses,
        received,
        profit: revenue - expenses,
        overdue,
      };
    });
  }, [invoices, periodMonths]);

  // KPIs (current period totals)
  const kpis = useMemo(() => {
    const sum = (arr: any[], k: string) => arr.reduce((s, x) => s + Number(x[k] || 0), 0);
    const totalRevenue = sum(monthly, "revenue");
    const totalExpenses = sum(monthly, "expenses");
    const totalReceived = sum(monthly, "received");
    const profit = totalRevenue - totalExpenses;
    const overdueAmount = invoices
      .filter((i) => i.status === "overdue")
      .reduce((s, i) => s + Number(i.remaining_amount ?? i.total_amount), 0);
    const pendingAmount = invoices
      .filter((i) => ["pending", "partial"].includes(i.status))
      .reduce((s, i) => s + Number(i.remaining_amount ?? i.total_amount), 0);
    const inadimplenciaPct = totalRevenue > 0 ? (overdueAmount / totalRevenue) * 100 : 0;

    // Trend: compare current vs previous of same length (split monthly in half)
    const half = Math.floor(monthly.length / 2);
    const prev = monthly.slice(0, half).reduce((s, m) => s + m.revenue, 0);
    const curr = monthly.slice(half).reduce((s, m) => s + m.revenue, 0);
    const trendPct = prev > 0 ? ((curr - prev) / prev) * 100 : 0;

    return { totalRevenue, totalExpenses, totalReceived, profit, overdueAmount, pendingAmount, inadimplenciaPct, trendPct };
  }, [monthly, invoices]);

  const totalAmountInvoices = useMemo(() => {
    return invoices.reduce((s, i) => s + Number(i.total_amount || 0), 0);
  }, [invoices]);

  // Status distribution for pie
  const statusDist = useMemo(() => {
    const groups: Record<string, { count: number; amount: number }> = {};
    invoices.forEach((i) => {
      const st = i.status || "draft";
      if (!groups[st]) {
        groups[st] = { count: 0, amount: 0 };
      }
      groups[st].count += 1;
      groups[st].amount += Number(i.total_amount || 0);
    });

    const totalInvoices = invoices.length;
    const totalAmount = Object.values(groups).reduce((acc, g) => acc + g.amount, 0);

    return Object.entries(groups).map(([statusKey, data]) => {
      const label = STATUS_LABELS[statusKey] || statusKey;
      const countPct = totalInvoices > 0 ? (data.count / totalInvoices) * 100 : 0;
      const amountPct = totalAmount > 0 ? (data.amount / totalAmount) * 100 : 0;
      return {
        key: statusKey,
        name: label,
        status: statusKey,
        count: data.count,
        amount: data.amount,
        value: totalAmount > 0 ? (distMetric === "amount" ? (data.amount > 0 ? data.amount : 0.001) : data.count) : data.count,
        countPct,
        amountPct,
        color: STATUS_COLORS[statusKey] || "hsl(220 9% 60%)",
      };
    });
  }, [invoices, distMetric]);

  // Expenses by fleet/vehicle
  const fleetExpenses = useMemo(() => {
    const map = new Map<string, number>();
    invoices
      .filter((i) => i.type === "incoming" && i.fleet_id)
      .forEach((i) => {
        const k = i.fleet_id!;
        map.set(k, (map.get(k) || 0) + Number(i.total_amount));
      });
    return Array.from(map.entries())
      .map(([id, total]) => ({ name: `Frota ${id.slice(0, 6)}`, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [invoices]);

  const vehicleExpenses = useMemo(() => {
    const map = new Map<string, number>();
    invoices
      .filter((i) => i.type === "incoming" && i.vehicle_id)
      .forEach((i) => {
        const k = i.vehicle_id!;
        map.set(k, (map.get(k) || 0) + Number(i.total_amount));
      });
    return Array.from(map.entries())
      .map(([id, total]) => ({ name: `Veículo ${id.slice(0, 6)}`, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  }, [invoices]);

  // Export
  function exportCSV() {
    const rows = [
      ["Mês", "Faturamento", "Despesas", "Recebido", "Lucro", "Inadimplência"],
      ...monthly.map((m) => [m.label, m.revenue, m.expenses, m.received, m.profit, m.overdue]),
    ];
    const csv = rows.map((r) => r.join(";")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-financeiro-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("CSV exportado");
  }

  async function exportPDF() {
    if (exportingPdf) return;
    setExportingPdf(true);
    try {
      const data = await apiRequest<{ signedUrl: string }>("/billing/reports/financial/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodMonths,
          generatedAt: new Date().toISOString(),
          kpis,
          monthly,
        }),
      });
      if (!data?.signedUrl) throw new Error("PDF indisponível");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast.error("Falha ao gerar PDF", { description: e?.message ?? "Erro desconhecido" });
    } finally {
      setExportingPdf(false);
    }
  }

  async function emailPDF() {
    if (emailingPdf) return;
    setEmailingPdf(true);
    try {
      await apiRequest("/billing/reports/financial/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          periodMonths,
          generatedAt: new Date().toISOString(),
          kpis,
          monthly,
        }),
      });
      toast.success("Relatório enviado por email");
    } catch (e: any) {
      toast.error("Falha ao enviar relatório", { description: e?.message ?? "Erro desconhecido" });
    } finally {
      setEmailingPdf(false);
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Relatórios Financeiros</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Dashboards executivos · faturamento, lucro, inadimplência, despesas e tendências
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(periodMonths)} onValueChange={(v) => setPeriodMonths(Number(v))}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="3">Últimos 3 meses</SelectItem>
              <SelectItem value="6">Últimos 6 meses</SelectItem>
              <SelectItem value="12">Últimos 12 meses</SelectItem>
              <SelectItem value="24">Últimos 24 meses</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-8" onClick={exportCSV}>
            <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />
            CSV
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={exportPDF} disabled={exportingPdf}>
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            PDF
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={emailPDF} disabled={emailingPdf}>
            {emailingPdf ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <FileText className="h-3.5 w-3.5 mr-1.5" />}
            Email
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Faturamento"
          value={eur(kpis.totalRevenue)}
          icon={DollarSign}
          accent="emerald"
          trend={kpis.trendPct}
        />
        <KpiCard
          label="Lucro líquido"
          value={eur(kpis.profit)}
          icon={Activity}
          accent={kpis.profit >= 0 ? "emerald" : "destructive"}
          subtitle={`${kpis.totalRevenue > 0 ? ((kpis.profit / kpis.totalRevenue) * 100).toFixed(1) : "0"}% margem`}
        />
        <KpiCard
          label="Inadimplência"
          value={`${kpis.inadimplenciaPct.toFixed(1)}%`}
          icon={AlertTriangle}
          accent="destructive"
          subtitle={eur(kpis.overdueAmount)}
        />
        <KpiCard
          label="Pagamentos pendentes"
          value={eur(kpis.pendingAmount)}
          icon={Wallet}
          accent="amber"
          subtitle={`${invoices.filter((i) => ["pending", "partial"].includes(i.status)).length} faturas`}
        />
      </div>

      {/* View tabs */}
      <Tabs value={view} onValueChange={(v) => setView(v as any)}>
        <TabsList className="h-9">
          <TabsTrigger value="overview" className="text-xs">Visão geral</TabsTrigger>
          <TabsTrigger value="fleet" className="text-xs">Frota & Veículos</TabsTrigger>
          <TabsTrigger value="trends" className="text-xs">Tendências</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground text-xs">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Carregando dados...
        </div>
      ) : view === "overview" ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Monthly revenue */}
          <Card className="border-border/50 lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-400" />
                Faturamento mensal
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={monthly} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g-rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(142 76% 45%)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="hsl(142 76% 45%)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="g-exp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(0 84% 60%)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="hsl(0 84% 60%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area type="monotone" dataKey="revenue" name="Faturamento" stroke="hsl(142 76% 45%)" fill="url(#g-rev)" strokeWidth={2} />
                  <Area type="monotone" dataKey="expenses" name="Despesas" stroke="hsl(0 84% 60%)" fill="url(#g-exp)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Status distribution */}
          <Card className="border-border/50">
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm">Distribuição por estado</CardTitle>
              <div className="flex items-center gap-1 bg-muted/40 p-0.5 rounded-md border border-border/40 text-[10px]">
                <button
                  type="button"
                  onClick={() => setDistMetric("amount")}
                  className={cn(
                    "px-2 py-0.5 rounded font-medium transition-colors",
                    distMetric === "amount" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Valor (€)
                </button>
                <button
                  type="button"
                  onClick={() => setDistMetric("count")}
                  className={cn(
                    "px-2 py-0.5 rounded font-medium transition-colors",
                    distMetric === "count" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  Qtd (Nº)
                </button>
              </div>
            </CardHeader>
            <CardContent>
              {statusDist.length === 0 ? (
                <div className="h-[280px] flex items-center justify-center text-xs text-muted-foreground">
                  Nenhuma fatura encontrada no período
                </div>
              ) : (
                <div className="relative">
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie
                        data={statusDist}
                        dataKey="value"
                        nameKey="name"
                        cx="50%" cy="45%"
                        innerRadius={55} outerRadius={92}
                        paddingAngle={statusDist.length > 1 ? 3 : 0}
                      >
                        {statusDist.map((s, i) => (
                          <Cell key={i} fill={s.color} stroke="hsl(var(--background))" strokeWidth={2} />
                        ))}
                      </Pie>
                      <Tooltip content={<StatusPieTooltip />} />
                      <Legend
                        verticalAlign="bottom"
                        wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
                        formatter={(value, entry: any) => {
                          const payload = entry?.payload;
                          const metricLabel = distMetric === "amount" ? eur(payload?.amount ?? 0) : `${payload?.count ?? 0} fat.`;
                          return `${value} (${metricLabel})`;
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Donut Center Summary */}
                  <div className="absolute top-[45%] left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none text-center">
                    <div className="text-base font-bold font-mono tracking-tight text-foreground">
                      {distMetric === "amount" ? eur(totalAmountInvoices) : `${invoices.length}`}
                    </div>
                    <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-medium">
                      {distMetric === "amount" ? "Total Faturado" : "Faturas"}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Profit bars */}
          <Card className="border-border/50 lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" />
                Lucro líquido mensal
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="profit" name="Lucro" radius={[6, 6, 0, 0]}>
                    {monthly.map((m, i) => (
                      <Cell key={i} fill={m.profit >= 0 ? "hsl(142 76% 45%)" : "hsl(0 84% 60%)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Inadimplência */}
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                Inadimplência
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Line type="monotone" dataKey="overdue" name="Em atraso" stroke="hsl(0 84% 60%)" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      ) : view === "fleet" ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Truck className="h-4 w-4 text-primary" />
                Despesas por frota
              </CardTitle>
            </CardHeader>
            <CardContent>
              {fleetExpenses.length === 0 ? (
                <p className="text-xs text-muted-foreground py-12 text-center">
                  Nenhuma despesa associada a frotas no período.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={fleetExpenses} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} width={90} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="total" name="Despesas" fill="hsl(217 91% 60%)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Car className="h-4 w-4 text-primary" />
                Despesas por veículo
              </CardTitle>
            </CardHeader>
            <CardContent>
              {vehicleExpenses.length === 0 ? (
                <p className="text-xs text-muted-foreground py-12 text-center">
                  Nenhuma despesa associada a veículos no período.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={vehicleExpenses} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={10} width={90} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="total" name="Despesas" fill="hsl(280 65% 60%)" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Evolução financeira (Faturamento vs Recebido vs Despesas)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={380}>
                <LineChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="revenue" name="Faturamento" stroke="hsl(142 76% 45%)" strokeWidth={2.5} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="received" name="Recebido" stroke="hsl(217 91% 60%)" strokeWidth={2.5} dot={{ r: 3 }} />
                  <Line type="monotone" dataKey="expenses" name="Despesas" stroke="hsl(0 84% 60%)" strokeWidth={2.5} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Comparative table */}
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Comparativo mensal</CardTitle>
            </CardHeader>
            <CardContent className="overflow-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/50">
                    <th className="text-left py-2 px-2">Mês</th>
                    <th className="text-right py-2 px-2">Faturamento</th>
                    <th className="text-right py-2 px-2">Despesas</th>
                    <th className="text-right py-2 px-2">Lucro</th>
                    <th className="text-right py-2 px-2">Recebido</th>
                    <th className="text-right py-2 px-2">Inadimpl.</th>
                    <th className="text-right py-2 px-2">Var.</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.map((m, i) => {
                    const prev = monthly[i - 1];
                    const variation = prev && prev.revenue > 0 ? ((m.revenue - prev.revenue) / prev.revenue) * 100 : 0;
                    return (
                      <tr key={m.label} className="border-b border-border/30 hover:bg-accent/30 transition-colors">
                        <td className="py-2 px-2 font-medium">{m.label}</td>
                        <td className="text-right tabular-nums py-2 px-2 text-emerald-400">{eur(m.revenue)}</td>
                        <td className="text-right tabular-nums py-2 px-2 text-destructive">{eur(m.expenses)}</td>
                        <td className={`text-right tabular-nums py-2 px-2 font-medium ${m.profit >= 0 ? "text-emerald-400" : "text-destructive"}`}>
                          {eur(m.profit)}
                        </td>
                        <td className="text-right tabular-nums py-2 px-2 text-blue-400">{eur(m.received)}</td>
                        <td className="text-right tabular-nums py-2 px-2 text-amber-400">{eur(m.overdue)}</td>
                        <td className="text-right tabular-nums py-2 px-2">
                          {i === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <Badge variant="outline" className={`text-[10px] ${variation >= 0 ? "text-emerald-400 border-emerald-500/30" : "text-destructive border-destructive/30"}`}>
                              {variation >= 0 ? <TrendingUp className="h-2.5 w-2.5 mr-0.5" /> : <TrendingDown className="h-2.5 w-2.5 mr-0.5" />}
                              {Math.abs(variation).toFixed(1)}%
                            </Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// KPI card
// ─────────────────────────────────────────────────────────────
function KpiCard({
  label, value, icon: Icon, accent, subtitle, trend,
}: {
  label: string;
  value: string;
  icon: any;
  accent: "emerald" | "destructive" | "amber" | "primary";
  subtitle?: string;
  trend?: number;
}) {
  const colors: Record<string, string> = {
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20 shadow-[0_0_30px_-10px_hsl(142_76%_45%/0.4)]",
    destructive: "text-destructive bg-destructive/10 border-destructive/20 shadow-[0_0_30px_-10px_hsl(var(--destructive)/0.4)]",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20 shadow-[0_0_30px_-10px_hsl(38_92%_55%/0.4)]",
    primary: "text-primary bg-primary/10 border-primary/20 shadow-[0_0_30px_-10px_hsl(var(--primary)/0.4)]",
  };
  return (
    <Card className={`border ${colors[accent]} backdrop-blur-sm`}>
      <CardContent className="pt-4 pb-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
            <p className="text-xl font-semibold tabular-nums mt-1">{value}</p>
            {subtitle && <p className="text-[10px] text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <Icon className="h-4 w-4 opacity-80" />
        </div>
        {typeof trend === "number" && (
          <div className="mt-2 flex items-center gap-1 text-[10px]">
            {trend >= 0 ? (
              <TrendingUp className="h-3 w-3 text-emerald-400" />
            ) : (
              <TrendingDown className="h-3 w-3 text-destructive" />
            )}
            <span className={trend >= 0 ? "text-emerald-400" : "text-destructive"}>
              {trend >= 0 ? "+" : ""}{trend.toFixed(1)}%
            </span>
            <span className="text-muted-foreground">vs período anterior</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
