import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Workflow,
  Search,
  FilterX,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Coins,
  FileText,
  CreditCard,
  Wrench,
  Calendar,
  User,
  Building2,
  Car,
  Hash as HashIcon,
  ArrowUpRight,
  ExternalLink,
} from "lucide-react";
import { useLanguage } from "@/hooks/useLanguage";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  useOperationalWorkflow,
  type OperationalWorkflowFilters,
  type OperationalWorkflowStatus,
  type WorkflowItem,
  type StatusMetaEntry,
} from "@/hooks/useOperationalWorkflow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

const ALL_STATUSES: OperationalWorkflowStatus[] = [
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
];

function fmtBRL(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v as number)) return "—";
  return Number(v).toLocaleString("pt-BR", {
    style: "currency",
    currency: "EUR",
  });
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return String(iso).slice(0, 10);
  }
}

function StatusPill({
  meta,
  status,
  label,
}: {
  meta?: StatusMetaEntry;
  status: OperationalWorkflowStatus;
  label?: string;
}) {
  const tone =
    meta?.tone ??
    "bg-slate-100 text-slate-700 dark:bg-slate-900/40 dark:text-slate-300 border-slate-300";
  const dot = meta?.dot ?? "bg-slate-400";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${tone}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label ?? meta?.label ?? status}
    </span>
  );
}

function KpiCard({
  icon: Icon,
  title,
  value,
  sub,
  tone,
}: {
  icon: any;
  title: string;
  value: string;
  sub?: string;
  tone: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div className={`rounded-md p-1.5 ${tone}`}>
          <Icon className="h-3.5 w-3.5 text-current" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-xl font-semibold tracking-tight">{value}</div>
        {sub ? (
          <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatProductionStatus(status: string | null | undefined): string {
  if (!status) return "—";
  const map: Record<string, string> = {
    new_vehicle: "Novo Veículo",
    in_production: "Em Produção",
    paused: "Pausado",
    awaiting_validation: "Aguardando Validação",
    finished: "Finalizado",
    delivered: "Entregue",
    invoiced: "Faturado",
    cancelled: "Cancelado",
  };
  return map[status] ?? status;
}

function NavLink({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: any;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 gap-1.5 px-2.5 text-[11px] font-medium hover:bg-primary/5 hover:text-primary transition-colors"
      asChild
    >
      <Link to={to}>
        <Icon className="h-3 w-3" /> {label}
        <ExternalLink className="h-2.5 w-2.5 text-muted-foreground ml-0.5" />
      </Link>
    </Button>
  );
}

function OperationCard({
  it,
  meta,
}: {
  it: WorkflowItem;
  meta: Record<OperationalWorkflowStatus, StatusMetaEntry>;
}) {
  const m = meta?.[it.status];
  return (
    <Card className="group overflow-hidden border border-border/80 bg-card/95 transition-all duration-200 hover:shadow-lg hover:border-primary/30 flex flex-col justify-between">
      <CardHeader className="p-4 pb-3 space-y-3">
        {/* Top Badges & Total */}
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1.5 min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusPill meta={m} status={it.status} />
              {it.list_name && (
                <Badge variant="outline" className="h-5 gap-1 font-mono text-[11px] border-primary/25 bg-primary/5 text-primary">
                  <HashIcon className="h-2.5 w-2.5" /> {it.list_name}
                </Badge>
              )}
              {it.operational_unit && (
                <Badge variant="secondary" className="h-5 gap-1 text-[10px] font-medium text-muted-foreground bg-muted">
                  <Building2 className="h-2.5 w-2.5 shrink-0" /> {it.operational_unit}
                </Badge>
              )}
              {it.validation_retificativa && it.validation_retificativa !== "none" && (
                <Badge
                  variant="secondary"
                  className="h-5 gap-1 text-[10px] border-amber-400/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-semibold"
                >
                  <AlertTriangle className="h-2.5 w-2.5 shrink-0" /> Retificação · {it.validation_retificativa.toUpperCase()}
                </Badge>
              )}
              {it.has_error && (
                <Badge variant="destructive" className="h-5 gap-1 text-[10px]">
                  <AlertTriangle className="h-2.5 w-2.5 shrink-0" /> Correção
                </Badge>
              )}
            </div>

            {/* Client & Vehicle */}
            <div className="pt-1">
              <h3 className="text-base font-bold text-foreground tracking-tight leading-snug truncate" title={it.client_name ?? "Cliente não informado"}>
                {it.client_name || "Cliente não informado"}
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {(it.car_name || (it.brand && it.model)) && (
                  <span className="font-medium text-foreground/90 inline-flex items-center gap-1.5 truncate max-w-[220px]" title={it.car_name ?? `${it.brand} ${it.model}`}>
                    <Car className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {it.car_name ?? `${it.brand} ${it.model}`}
                  </span>
                )}
                {it.license_plate && (
                  <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-muted/80 border border-border/70 text-foreground shrink-0">
                    {it.license_plate}
                  </span>
                )}
                {it.vin && (
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                    VIN: {it.vin.slice(0, 8)}…
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Monetary Total Block */}
          <div className="shrink-0 text-right pl-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
              Total Operacional
            </span>
            <div className="text-lg sm:text-xl font-bold tabular-nums text-foreground tracking-tight mt-0.5">
              {fmtBRL(it.valor_total)}
            </div>
            {it.valor_pendente !== null && it.valor_pendente > 0 ? (
              <span className="inline-block text-[10px] font-medium text-amber-600 dark:text-amber-400 mt-0.5">
                Pendente: {fmtBRL(it.valor_pendente)}
              </span>
            ) : it.status === "pago" || it.status === "encerrado" ? (
              <span className="inline-block text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 mt-0.5">
                Totalmente Pago
              </span>
            ) : null}
          </div>
        </div>

        {/* Next Action Banner */}
        <div
          className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground/90 dark:text-primary-foreground"
          role="note"
          aria-label="Próxima ação"
        >
          <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <span className="font-semibold uppercase tracking-wider text-[10px] text-primary block">
              Próxima ação
            </span>
            <span className="leading-snug text-foreground/90 text-xs block">
              {m?.next_action ?? it.next_action}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-0 space-y-3 flex-1 flex flex-col justify-between">
        {/* 3 Pipeline Stages Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {/* STAGE 1: PRODUÇÃO */}
          <div className="min-w-0 rounded-xl border border-border/70 bg-muted/20 p-2.5 sm:p-3 space-y-2 transition-colors hover:border-border">
            <div className="flex items-center justify-between gap-1 border-b border-border/40 pb-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-indigo-500">
                <Wrench className="h-3.5 w-3.5 shrink-0" /> Produção
              </div>
              {it.production_status && (
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                  it.production_status === 'delivered' || it.production_status === 'finished'
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : it.production_status === 'paused'
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                    : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'
                }`}>
                  {formatProductionStatus(it.production_status)}
                </span>
              )}
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="min-w-0">
                <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Ordem</span>
                <span className="block font-mono text-xs font-semibold text-foreground truncate" title={it.production_code ?? ""}>
                  {it.production_code ?? "—"}
                </span>
              </div>
              <div className="min-w-0">
                <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Status</span>
                <span className="block font-medium text-xs text-foreground truncate">
                  {formatProductionStatus(it.production_status)}
                </span>
              </div>
              <div className="min-w-0">
                <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Finalizado</span>
                <span className="block font-medium text-xs text-foreground tabular-nums">
                  {fmtDate(it.production_delivered_at)}
                </span>
              </div>
            </div>
          </div>

          {/* STAGE 2: WEEKLOG */}
          <div className="min-w-0 rounded-xl border border-border/70 bg-muted/20 p-2.5 sm:p-3 space-y-2 transition-colors hover:border-border">
            <div className="flex items-center justify-between gap-1 border-b border-border/40 pb-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-sky-500">
                <FileText className="h-3.5 w-3.5 shrink-0" /> WEEKLOG
              </div>
              {it.validation_situation === "oui" ? (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  Validado
                </span>
              ) : it.validation_situation === "non" ? (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400">
                  Recusado
                </span>
              ) : it.week ? (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400">
                  Em Aberto
                </span>
              ) : null}
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="min-w-0">
                <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Semana</span>
                <span className="block font-mono text-xs font-semibold text-foreground truncate">
                  {it.week ?? "—"}
                </span>
              </div>
              <div className="min-w-0">
                <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Validação</span>
                <span className="block font-medium text-xs truncate">
                  {it.validation_situation === "oui" ? (
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 inline shrink-0" /> Sim {it.validation_assinado ? "· Assinado" : ""}
                    </span>
                  ) : it.validation_situation === "non" ? (
                    <span className="text-rose-600 dark:text-rose-400 font-semibold inline-flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 inline shrink-0" /> Não
                    </span>
                  ) : it.validation_assinado ? (
                    <span className="text-indigo-600 dark:text-indigo-400 font-medium">Assinado</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </span>
              </div>
              <div className="min-w-0">
                <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Valor Aprovado</span>
                <span className="block font-semibold text-xs text-foreground tabular-nums truncate">
                  {fmtBRL(it.valor_aprovado)}
                </span>
              </div>
            </div>
          </div>

          {/* STAGE 3: PAGAMENTO */}
          <div className="min-w-0 rounded-xl border border-border/70 bg-muted/20 p-2.5 sm:p-3 space-y-2 transition-colors hover:border-border">
            <div className="flex items-center justify-between gap-1 border-b border-border/40 pb-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-500">
                <CreditCard className="h-3.5 w-3.5 shrink-0" /> Pagamento
              </div>
              {it.status === "pago" || it.status === "encerrado" ? (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  Pago
                </span>
              ) : it.valor_pendente && it.valor_pendente > 0 ? (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  Pendente
                </span>
              ) : null}
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="min-w-0">
                <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Lista</span>
                <span className="block font-mono text-xs font-semibold text-foreground truncate">
                  {it.list_name ? `# ${it.list_name}` : "—"}
                </span>
              </div>
              <div className="min-w-0">
                <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Valor Pago</span>
                <span className="block font-medium text-xs text-foreground tabular-nums truncate">
                  {fmtBRL(it.valor_pago)}
                </span>
              </div>
              <div className="min-w-0">
                <span className="block text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Pendente</span>
                <span className={`block font-semibold text-xs tabular-nums truncate ${
                  it.valor_pendente && it.valor_pendente > 0
                    ? "text-amber-600 dark:text-amber-400 font-bold"
                    : "text-emerald-600 dark:text-emerald-400"
                }`}>
                  {fmtBRL(it.valor_pendente)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Card Footer: Metadata and Links */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-border/50 pt-2.5 mt-auto">
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {it.technician_name && (
              <span className="inline-flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" /> {it.technician_name}
              </span>
            )}
            {it.year_reference && (
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" /> {it.year_reference}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(it.production_order_id || it.production_code) && (
              <NavLink to="/production" label="Produção" icon={Wrench} />
            )}
            {(it.service_order_id || it.week) && (
              <NavLink to="/service-orders" label="WEEKLOG" icon={FileText} />
            )}
            {(it.payment_order_id || it.list_name) && (
              <NavLink to="/payment-orders" label="Pagamento" icon={CreditCard} />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function ProductionWorkflowPage() {
  const { t } = useLanguage();
  const { workspaceId } = useWorkspace();
  const [filters, setFilters] = useState<OperationalWorkflowFilters>({});
  const [tab, setTab] = useState<"all" | "open" | "finance" | "done">("all");

  const tabFilters = useMemo<OperationalWorkflowFilters>(() => {
    const base = { ...filters };
    if (tab === "open") {
      base.status = undefined;
      base.pagamento = undefined;
      // Mantém apenas os que não estão pagos/encerrados
    } else if (tab === "finance") {
      base.status = undefined;
      base.pagamento = "pendente";
    } else if (tab === "done") {
      base.status = undefined;
      base.pagamento = "pago";
    }
    return base;
  }, [tab, filters]);

  const { data, isLoading, isError, error } = useOperationalWorkflow(tabFilters);

  const displayItems = useMemo<WorkflowItem[]>(() => {
    const list = data?.items ?? [];
    if (tab === "open") {
      return list.filter(
        (it) =>
          it.status !== "pago" &&
          it.status !== "encerrado" &&
          it.status !== "em_elaboracao",
      );
    }
    if (tab === "finance") {
      return list.filter(
        (it) =>
          (it.status === "aguardando_pagamento" ||
            (it.valor_pendente ?? 0) > 0) &&
          it.status !== "encerrado",
      );
    }
    if (tab === "done") {
      return list.filter((it) => it.status === "pago" || it.status === "encerrado");
    }
    return list;
  }, [tab, data]);

  const meta = data?.status_meta;
  const s = data?.summary;
  const byStatus = s?.by_status ?? {};
  const statusOptions = ALL_STATUSES.filter((k) => (byStatus[k] ?? 0) > 0);

  return (
    <div className="animate-fade-in flex min-h-full w-full min-w-0 flex-col gap-3 overflow-visible md:gap-2">
      <header className="sticky top-0 z-30 -mx-3 flex shrink-0 flex-col gap-3 border-b border-border/40 bg-background/95 px-3 pb-3 pt-1 backdrop-blur sm:-mx-4 sm:px-4 md:static md:mx-0 md:flex-row md:items-center md:justify-between md:bg-transparent md:px-1 md:pb-2 md:pt-0 md:backdrop-blur-none">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Workflow className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground truncate">
              {t("nav.productionWorkflow", "Workflow Operacional")}
            </h1>
            <p className="text-[11px] text-muted-foreground truncate">
              Painel consolidado · Produção → WEEKLOG → Ordem → Pagamento · fonte da verdade real
            </p>
          </div>
        </div>
      </header>

      {/* ==== KPIs ==== */}
      <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {isLoading && !s ? (
          <>
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-3 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="mt-2 h-3 w-40" />
                </CardContent>
              </Card>
            ))}
          </>
        ) : (
          <>
            <KpiCard
              icon={Coins}
              title="Valor Total"
              value={fmtBRL(s?.valor_total ?? null)}
              sub={`${s?.count ?? 0} operações · ${s?.aguardando_acao ?? 0} aguardando ação`}
              tone="bg-indigo-500/10 text-indigo-700 dark:text-indigo-400"
            />
            <KpiCard
              icon={CheckCircle2}
              title="Valor Aprovado"
              value={fmtBRL(s?.valor_aprovado ?? null)}
              sub={`${statusOptions.length} status ativos (semanas em operação)`}
              tone="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
            />
            <KpiCard
              icon={Clock}
              title="Valor Pendente"
              value={fmtBRL(s?.valor_pendente ?? null)}
              sub={`aguardando liquidação financeira`}
              tone="bg-amber-500/10 text-amber-700 dark:text-amber-400"
            />
            <KpiCard
              icon={TrendingUp}
              title="Valor Pago"
              value={fmtBRL(s?.valor_pago ?? null)}
              sub={`${s?.com_erro ?? 0} operação(ões) com correção necessária`}
              tone="bg-violet-500/10 text-violet-700 dark:text-violet-400"
            />
          </>
        )}
      </section>

      {/* ==== TABS + FILTROS ==== */}
      <section className="space-y-2">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as typeof tab)}
          className="w-full"
        >
          <TabsList className="grid h-auto w-full grid-cols-4 gap-1 p-1 md:inline-flex md:w-auto">
            <TabsTrigger value="all" className="min-h-9 text-xs md:text-sm">
              Todas · <span className="tabular-nums">{s?.count ?? 0}</span>
            </TabsTrigger>
            <TabsTrigger value="open" className="min-h-9 text-xs md:text-sm">
              Em andamento ·{" "}
              <span className="tabular-nums">{s?.aguardando_acao ?? 0}</span>
            </TabsTrigger>
            <TabsTrigger value="finance" className="min-h-9 text-xs md:text-sm">
              Financeiro
            </TabsTrigger>
            <TabsTrigger value="done" className="min-h-9 text-xs md:text-sm">
              Concluídas
            </TabsTrigger>
          </TabsList>

          <div className="mt-2 grid gap-2 rounded-xl border bg-slate-50/60 p-2.5 dark:bg-slate-900/20 md:grid-cols-8">
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Busca
              </Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Cliente, placa, código, VIN..."
                  value={filters.search ?? ""}
                  onChange={(e) =>
                    setFilters((p) => ({ ...p, search: e.target.value }))
                  }
                  className="h-8 pl-7.5 text-sm [&:not(:placeholder-shown)]~.lucide-x:hidden"
                  style={{ paddingLeft: 28 }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Ano
              </Label>
              <Input
                type="number"
                placeholder="2026"
                value={filters.year ?? ""}
                onChange={(e) =>
                  setFilters((p) => ({
                    ...p,
                    year: e.target.value
                      ? parseInt(e.target.value, 10)
                      : undefined,
                  }))
                }
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Semana
              </Label>
              <Input
                placeholder="32 ou W32"
                value={filters.week ?? ""}
                onChange={(e) =>
                  setFilters((p) => ({ ...p, week: e.target.value }))
                }
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Status
              </Label>
              <Select
                value={filters.status ?? ""}
                onValueChange={(v) =>
                  setFilters((p) => ({
                    ...p,
                    status: (v as OperationalWorkflowStatus) || undefined,
                  }))
                }
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  {ALL_STATUSES.map((k) => {
                    const m = meta?.[k];
                    const n = byStatus[k] ?? 0;
                    return (
                      <SelectItem key={k} value={k}>
                        <span className="flex items-center justify-between gap-2">
                          <span>{m?.label ?? k}</span>
                          <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[10px] tabular-nums dark:bg-slate-800">
                            {n}
                          </span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Cliente
              </Label>
              <Input
                placeholder="Nome"
                value={filters.client ?? ""}
                onChange={(e) =>
                  setFilters((p) => ({ ...p, client: e.target.value }))
                }
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Técnico
              </Label>
              <Input
                placeholder="Nome"
                value={filters.technician ?? ""}
                onChange={(e) =>
                  setFilters((p) => ({ ...p, technician: e.target.value }))
                }
                className="h-8"
              />
            </div>
            <div className="flex flex-col justify-end">
              <div className="flex gap-2">
                <Select
                  value={filters.pagamento ?? "any"}
                  onValueChange={(v) =>
                    setFilters((p) => ({
                      ...p,
                      pagamento: v === "any" ? undefined : (v as any),
                    }))
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Pagamento" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Qualquer</SelectItem>
                    <SelectItem value="pendente">Pendente</SelectItem>
                    <SelectItem value="pago">Pago</SelectItem>
                    <SelectItem value="none">Sem Pagamento (ainda)</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1 px-2 text-[11px]"
                  onClick={() => setFilters({})}
                  title="Limpar filtros"
                >
                  <FilterX className="h-3 w-3" /> Limpar
                </Button>
              </div>
            </div>
          </div>

          <TabsContent value="all" className="mt-0 space-y-3 pt-2">
            <WorkflowGrid
              loading={isLoading}
              error={isError ? (error as any)?.message : null}
              items={displayItems}
              meta={meta}
            />
          </TabsContent>
          <TabsContent value="open" className="mt-0 space-y-3 pt-2">
            <WorkflowGrid
              loading={isLoading}
              error={isError ? (error as any)?.message : null}
              items={displayItems}
              meta={meta}
            />
          </TabsContent>
          <TabsContent value="finance" className="mt-0 space-y-3 pt-2">
            <WorkflowGrid
              loading={isLoading}
              error={isError ? (error as any)?.message : null}
              items={displayItems}
              meta={meta}
            />
          </TabsContent>
          <TabsContent value="done" className="mt-0 space-y-3 pt-2">
            <WorkflowGrid
              loading={isLoading}
              error={isError ? (error as any)?.message : null}
              items={displayItems}
              meta={meta}
            />
          </TabsContent>
        </Tabs>
      </section>
    </div>
  );
}

function WorkflowGrid({
  loading,
  error,
  items,
  meta,
}: {
  loading: boolean;
  error: string | null;
  items: WorkflowItem[];
  meta?: Record<OperationalWorkflowStatus, StatusMetaEntry>;
}) {
  if (loading && (!items || items.length === 0)) {
    return (
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="overflow-hidden">
            <CardHeader className="pb-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="mt-1 h-4 w-2/3" />
              <Skeleton className="mt-3 h-10 w-full" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-28 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <Card className="border-rose-300/60 bg-rose-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm text-rose-700 dark:text-rose-300">
            <AlertTriangle className="h-4 w-4" /> Erro ao carregar Workflow
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-rose-800 dark:text-rose-200">
          {error}
        </CardContent>
      </Card>
    );
  }
  if (!items || items.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Nenhuma operação encontrada
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Ajuste os filtros, crie uma nova Produção (menu Produção → Nova Ordem) e
          finalize o serviço para que o Workflow comece a mostrar as operações.
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {items.map((it) => (
        <OperationCard
          key={it.id}
          it={it}
          meta={meta!}
        />
      ))}
    </div>
  );
}
