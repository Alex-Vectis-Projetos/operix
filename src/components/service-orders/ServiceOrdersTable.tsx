import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronRight, Camera, FileText } from "lucide-react";
import { useLanguage } from "@/hooks/useLanguage";
import { useAuth } from "@/hooks/useAuth";
import { useClients } from "@/hooks/useServiceOrders";
import { useAssignableUsers } from "@/hooks/useAssignableUsers";
import { toast } from "sonner";
import { formatLicensePlate } from "@/lib/formatPlate";
import { cn } from "@/lib/utils";
import { getRowAlertLevel, type AlertLevel } from "@/hooks/useAgingAlerts";
import { AlertTriangle, Clock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTechnicianEarnings, getTechEarnings } from "@/hooks/useTechnicianEarnings";
import { PlatformOpsToggle } from "@/components/service-orders/PlatformOpsToggle";
import { ServiceOrderPhotosDialog } from "@/components/service-orders/ServiceOrderPhotosDialog";
import { WeeklogOperationalDocumentDialog, type ServiceOrderLike } from "@/components/service-orders/WeeklogOperationalDocumentDialog";

interface ServiceOrderRow {
  id: string;
  client_id: string | null;
  client_name?: string | null;
  platform: string | null;
  technician_name?: string | null;
  user_id?: string | null;
  assigned_user_id?: string | null;
  week: string | null;
  operational_unit?: string | null;
  car_name: string | null;
  license_plate: string | null;
  service_1_name: string | null;
  service_1_price: number | null;
  service_2_name: string | null;
  service_2_price: number | null;
  service_3_name: string | null;
  service_3_price: number | null;
  service_4_name: string | null;
  service_4_price: number | null;
  total: number | null;
  status: string;
  created_at: string;
  clients?: { name: string } | null;
  technicians?: { name: string } | null;
}

interface ServiceOrdersTableProps {
  orders: ServiceOrderRow[];
  isLoading: boolean;
}

type PaymentStatus = "paid" | "partial" | "pending" | "draft" | "none";

const paymentTextStyle: Record<PaymentStatus, string> = {
  paid: "text-emerald-400",
  partial: "text-amber-400",
  pending: "text-red-400",
  draft: "",
  none: "",
};

const paymentBadgeStyle: Record<PaymentStatus, string> = {
  paid: "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
  partial: "bg-amber-500/10 text-amber-500 border-amber-500/30",
  pending: "bg-red-500/10 text-red-500 border-red-500/30",
  draft: "bg-muted text-muted-foreground",
  none: "bg-muted text-muted-foreground",
};

const paymentLabel: Record<PaymentStatus, string> = {
  paid: "Pago",
  partial: "Parcial",
  pending: "Pendente",
  draft: "Rascunho",
  none: "Sem pagamento",
};

interface EditState {
  client_id: string;
  platform: string;
  assigned_user_id: string;
  week: string;
  car_name: string;
  license_plate: string;
  service_1_name: string;
  service_1_price: number;
  service_2_name: string;
  service_2_price: number;
  service_3_name: string;
  service_3_price: number;
  service_4_name: string;
  service_4_price: number;
}

const EMPTY_RELATION_VALUE = "__none__";

const toNullableText = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
};

export function ServiceOrdersTable({ orders, isLoading }: ServiceOrdersTableProps) {
  const { t, formatCurrency } = useLanguage();
  const { user } = useAuth();
  const { data: clients = [] } = useClients();
  const { data: technicians = [] } = useAssignableUsers();
  const { data: earningsMap } = useTechnicianEarnings();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [photosOpen, setPhotosOpen] = useState(false);
  const [photosOrderId, setPhotosOrderId] = useState<string | null>(null);
  const [operDocOpen, setOperDocOpen] = useState(false);
  const [operDocOrder, setOperDocOrder] = useState<ServiceOrderLike | null>(null);

  // Use DB-stored status as single source of truth (synced by DB trigger)
  const getPaymentStatus = (o: ServiceOrderRow): PaymentStatus => {
    const s = o.status?.toLowerCase();
    if (s === "paid") return "paid";
    if (s === "partial") return "partial";
    if (s === "pending") return "pending";
    if (s === "draft") return "draft";
    return "none";
  };

  const alertStyle: Record<AlertLevel, string> = {
    none: "",
    level1: "ring-1 ring-amber-500/40",
    level2: "ring-1 ring-orange-500/50",
    level3: "ring-1 ring-red-500/60 animate-pulse",
  };

  const AlertIcon = ({ level, days }: { level: AlertLevel; days: number }) => {
    if (level === "none") return null;
    const Icon = level === "level3" ? AlertTriangle : level === "level2" ? AlertTriangle : Clock;
    const color = level === "level3" ? "text-red-500" : level === "level2" ? "text-orange-500" : "text-amber-500";
    const label = level === "level3"
      ? `🚨 ${days} dias — crítico`
      : level === "level2"
      ? `⚠️ ${days} dias sem pagamento`
      : `⏳ ${days} dias pendente`;
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Icon className={cn("h-3.5 w-3.5 shrink-0", color)} />
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );

  };

  // --- Selection logic ---
  const toggleOne = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Composite group identity: year|client|platform|unit|tech|week
  type GroupKey = string;
  const groupKeyOf = (o: ServiceOrderRow): GroupKey => {
    const year = o.created_at ? new Date(o.created_at).getFullYear().toString() : "—";
    const client = (o.client_name || "Sem Cliente").trim();
    const plat = (o.platform || "Sem Plataforma").trim();
    const unit = (o.operational_unit || "").trim();
    const tech = (o.technician_name || "Sem Técnico").trim();
    const week = (o.week || "Sem Semana").trim();
    return `${year}||${client}||${plat}||${unit}||${tech}||${week}`;
  };

  const toggleGroupSelection = (groupOrders: ServiceOrderRow[]) => {
    const allSelected = groupOrders.every(o => selected.has(o.id));
    setSelected(prev => {
      const next = new Set(prev);
      groupOrders.forEach(o => {
        if (allSelected) next.delete(o.id); else next.add(o.id);
      });
      return next;
    });
  };

  const getGroupStatus = (groupOrders: ServiceOrderRow[]): PaymentStatus => {
    if (!groupOrders.length) return "none";
    const statuses = groupOrders.map(o => getPaymentStatus(o));
    const allPaid = statuses.every(s => s === "paid");
    const allPending = statuses.every(s => s === "pending" || s === "none" || s === "draft");
    if (allPaid) return "paid";
    if (allPending) return "pending";
    return "partial";
  };

  const groupStatusLabel: Record<PaymentStatus, string> = {
    paid: "✓ Pago",
    partial: "◐ Parcial",
    pending: "● Pendente",
    draft: "— Rascunho",
    none: "— Sem dados",
  };

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const o of orders) {
      initial.add(groupKeyOf(o));
    }
    return initial;
  });
  const toggleCollapse = (k: string) => setCollapsedGroups(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });

  const openPhotos = (id: string) => {
    setPhotosOrderId(id);
    setPhotosOpen(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!orders.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-sm">{t("so.noOrders")}</p>
        <p className="text-xs mt-1">{t("so.uploadHint")}</p>
      </div>
    );
  }

  // Group by composite identity (year|client|platform|unit|tech|week)
  const groupMap = new Map<string, { key: string; orders: ServiceOrderRow[] }>();
  for (const o of orders) {
    const k = groupKeyOf(o);
    const g = groupMap.get(k);
    if (g) g.orders.push(o);
    else groupMap.set(k, { key: k, orders: [o] });
  }
  const groupedOrders = [...groupMap.values()]
    .map(g => {
      const parts = g.key.split("||");
      return {
        key: g.key,
        year: parts[0],
        client: parts[1],
        platform: parts[2],
        unit: parts[3],
        tech: parts[4],
        week: parts[5],
        orders: g.orders,
        status: getGroupStatus(g.orders),
        total: g.orders.reduce((s, o) => s + (Number(o.total) || 0), 0),
      };
    })
    .sort((a, b) =>
      a.year.localeCompare(b.year) ||
      a.client.localeCompare(b.client) ||
      a.platform.localeCompare(b.platform) ||
      a.unit.localeCompare(b.unit) ||
      a.tech.localeCompare(b.tech) ||
      a.week.localeCompare(b.week, undefined, { numeric: true })
    );

  return (
    <div className="space-y-4">
      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-border/40 bg-muted/40 px-3 py-3 md:flex-row md:items-center md:gap-3 md:px-4 md:py-2">
          <span className="text-sm font-medium">{selected.size} selecionado(s)</span>
          <Button variant="ghost" size="sm" className="h-10 text-xs md:h-7" onClick={() => setSelected(new Set())}>
            Limpar seleção
          </Button>
        </div>
      )}

      {/* Grouped by composite identity */}
      {groupedOrders.map(group => {
        const isCollapsed = collapsedGroups.has(group.key);
        return (
        <div key={group.key} className="space-y-1">
          {/* Group header */}
          <div className="flex flex-col gap-2 rounded-lg bg-secondary/40 px-3 py-3 md:flex-row md:items-center md:justify-between md:py-2">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => toggleCollapse(group.key)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-background/40 md:h-5 md:w-5"
                title={isCollapsed ? "Expandir" : "Recolher"}
                aria-label={isCollapsed ? "Expandir" : "Recolher"}
              >
                {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              <Button
                variant={group.orders.every(o => selected.has(o.id)) ? "secondary" : "outline"}
                size="sm"
                className="h-9 shrink-0 px-3 text-xs md:h-6 md:px-2 md:text-[10px]"
                onClick={() => toggleGroupSelection(group.orders)}
              >
                {group.week}
              </Button>
              <span className="hidden md:flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0 truncate">
                <span className="text-foreground/80 font-medium">{group.client}</span>
                <span>·</span><span>{group.platform}</span>
                <PlatformOpsToggle platformName={group.platform} />
                {group.unit && (<><span>·</span><span>{group.unit}</span></>)}
                <span>·</span><span>{group.tech}</span>
                <span>·</span><span>{group.year}</span>
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 shrink-0 pl-11 md:justify-start md:pl-0">
              <span className="text-xs text-muted-foreground">
                {group.orders.length} itens · {formatCurrency(group.total)}
              </span>
              <span className={cn("text-xs font-medium", paymentTextStyle[group.status])}>
                {groupStatusLabel[group.status]}
              </span>
            </div>
          </div>

          {!isCollapsed && (
          <div className="space-y-2 md:hidden">
            {group.orders.map((o) => {
              const ps = getPaymentStatus(o);
              const services = [o.service_1_name, o.service_2_name, o.service_3_name, o.service_4_name].filter(Boolean);
              const rowAlert = ps !== "paid" ? getRowAlertLevel(o.created_at) : "none";
              const daysOld = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 86400000);
              const techName = o.technician_name || o.technicians?.name;
              const dbPct = (o as any).technician_percentage;
              const dbEarn = (o as any).technician_earning;
              const techEarn = (dbPct != null && dbPct > 0)
                ? { percentage: dbPct, earnings: dbEarn ?? 0 }
                : getTechEarnings(techName, o.total, earningsMap);
              return (
                <div key={o.id} className={cn("rounded-lg border border-border/50 bg-card p-3 shadow-sm", paymentTextStyle[ps], alertStyle[rowAlert])}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <Checkbox checked={selected.has(o.id)} onCheckedChange={() => toggleOne(o.id)} />
                        <AlertIcon level={rowAlert} days={daysOld} />
                        <span className="truncate text-sm font-semibold">{o.client_name || o.clients?.name || "—"}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono text-foreground">{formatLicensePlate(o.license_plate) || "Sem placa"}</span>
                        <span>{o.car_name || "Sem viatura"}</span>
                        <span>{techName || "Sem técnico"}</span>
                      </div>
                    </div>
                    <Badge variant="outline" className={cn("shrink-0 text-[10px]", paymentBadgeStyle[ps])}>{paymentLabel[ps]}</Badge>
                  </div>

                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div><span className="text-muted-foreground">Plataforma</span><p className="font-medium">{o.platform || "—"}</p></div>
                      <div><span className="text-muted-foreground">Total</span><p className="font-semibold text-primary tabular-nums">{o.total != null ? formatCurrency(Number(o.total)) : "—"}</p></div>
                    </div>
                    <p className="text-xs text-muted-foreground">{services.length ? services.join(", ") : "Sem serviços"}</p>
                    {techEarn && <p className="text-[11px] text-muted-foreground">Tec. {techEarn.percentage}% · <span className="text-foreground">{formatCurrency(techEarn.earnings)}</span></p>}
                    <div className="flex justify-end gap-2 border-t border-border/50 pt-2">
                      <Button variant="outline" size="sm" className="h-10 bg-indigo-500/5 border-indigo-400/30 hover:bg-indigo-500/10 text-indigo-700 dark:text-indigo-300" onClick={() => { setOperDocOrder({ ...o } as ServiceOrderLike); setOperDocOpen(true); }}>
                        <FileText className="h-4 w-4 mr-1" /> Doc. Operacional
                      </Button>
                      <Button variant="outline" size="sm" className="h-10" onClick={() => openPhotos(o.id)}>
                        <Camera className="h-4 w-4 mr-1" /> Fotos
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          )}

          {!isCollapsed && (
          <div className="hidden rounded-lg border border-border/50 overflow-hidden md:block">
            <Table className="table-cols-zebra">
              <TableHeader>
                <TableRow className="bg-secondary/30">
                  <TableHead className="w-10" />
                  <TableHead>{t("label.client")}</TableHead>
                  <TableHead>{t("label.platform")}</TableHead>
                  <TableHead>{t("label.technician")}</TableHead>
                  <TableHead>{t("label.week")}</TableHead>
                  <TableHead>{t("label.car")}</TableHead>
                  <TableHead>{t("label.plate")}</TableHead>
                  <TableHead>{t("label.services")}</TableHead>
                  <TableHead className="text-right">{t("label.total")}</TableHead>
                  <TableHead className="text-right">Tec. %</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead>{t("label.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.orders.map((o) => {
                  const ps = getPaymentStatus(o);

                  const services = [o.service_1_name, o.service_2_name, o.service_3_name, o.service_4_name].filter(Boolean);
                  const rowAlert = ps !== "paid" ? getRowAlertLevel(o.created_at) : "none";
                  const daysOld = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 86400000);
                  const techName = o.technician_name || o.technicians?.name;
                  // Use DB-persisted values if available, fallback to live calculation
                  const dbPct = (o as any).technician_percentage;
                  const dbEarn = (o as any).technician_earning;
                  const techEarn = (dbPct != null && dbPct > 0)
                    ? { percentage: dbPct, earnings: dbEarn ?? 0 }
                    : getTechEarnings(techName, o.total, earningsMap);
                  return (
                    <TableRow key={o.id} className={cn(paymentTextStyle[ps], alertStyle[rowAlert])}>
                      <TableCell className="w-10">
                        <Checkbox checked={selected.has(o.id)} onCheckedChange={() => toggleOne(o.id)} />
                      </TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">
                          <AlertIcon level={rowAlert} days={daysOld} />
                          {o.client_name || o.clients?.name || "—"}
                        </div>
                      </TableCell>
                      <TableCell>{o.platform || "—"}</TableCell>
                      <TableCell>{o.technician_name || o.technicians?.name || "—"}</TableCell>
                      <TableCell>{o.week || "—"}</TableCell>
                      <TableCell>{o.car_name || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{formatLicensePlate(o.license_plate) || "—"}</TableCell>
                      <TableCell>
                        <span className="text-xs">{services.length ? services.join(", ") : "—"}</span>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {o.total != null ? formatCurrency(Number(o.total)) : "—"}
                      </TableCell>
                      <TableCell className="text-right text-[10px] tabular-nums">
                        {techEarn ? (
                          <span className="text-muted-foreground">
                            {techEarn.percentage}% · <span className="text-foreground font-medium">{formatCurrency(techEarn.earnings)}</span>
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-[10px]", paymentBadgeStyle[ps])}>
                          {paymentLabel[ps]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/10" onClick={() => { setOperDocOrder({ ...o } as ServiceOrderLike); setOperDocOpen(true); }} aria-label="Documento Operacional">
                                  <FileText className="h-3 w-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">📋 Documento Operacional WEEKLOG</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openPhotos(o.id)} aria-label="Fotos">
                            <Camera className="h-3 w-3" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          )}
        </div>
        );
      })}

      <ServiceOrderPhotosDialog
        open={photosOpen}
        serviceOrderId={photosOrderId}
        onOpenChange={(o) => {
          setPhotosOpen(o);
          if (!o) setPhotosOrderId(null);
        }}
      />

      <WeeklogOperationalDocumentDialog
        open={operDocOpen}
        onOpenChange={(o) => {
          setOperDocOpen(o);
          if (!o) setOperDocOrder(null);
        }}
        order={operDocOrder}
        currentUserId={user?.id ?? null}
        currentUserName={user?.fullName || user?.email || null}
        onSaved={(latest) => {
          // Atualiza a lista no cache do react-query para refletir o operational_document novo
          queryClient.invalidateQueries({ queryKey: ["service-orders"] });
          // Atualiza a cópia local no dialog (caso reabra imediatamente)
          setOperDocOrder(latest);
        }}
      />
    </div>
  );
}
