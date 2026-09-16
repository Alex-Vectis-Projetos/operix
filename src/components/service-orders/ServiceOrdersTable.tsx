import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateServiceOrder, deleteServiceOrder } from "@/lib/apiServiceOrders";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Trash2, Pencil, Save, X, Loader2, ChevronDown, ChevronRight, Camera, FileText } from "lucide-react";
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
import { BulkDeleteDialog } from "@/components/shared/BulkDeleteDialog";
import { useTechnicianEarnings, getTechEarnings } from "@/hooks/useTechnicianEarnings";
import { Can } from "@/components/Can";
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
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

  // --- Delete mutation ---
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteServiceOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service_orders"] });
      queryClient.invalidateQueries({ queryKey: ["financial-summary"] });
      toast.success(t("toast.deleted"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => deleteServiceOrder(id)));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service_orders"] });
      queryClient.invalidateQueries({ queryKey: ["payment_status_map"] });
      setSelected(new Set());
      setShowDeleteDialog(false);
      toast.success(t("toast.deleted"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const updateMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!editForm) return;

      const total =
        (Number(editForm.service_1_price) || 0) +
        (Number(editForm.service_2_price) || 0) +
        (Number(editForm.service_3_price) || 0) +
        (Number(editForm.service_4_price) || 0);

      if (total === 0) {
        throw new Error(t("validate.inlineError") + ": " + t("validate.zeroTotal").replace("{n}", ""));
      }

      const existing = orders.find((o) => o.id === id);
      if (!existing) throw new Error("Ordem de serviço não encontrada.");

      const resolvedClientId = editForm.client_id === EMPTY_RELATION_VALUE ? null : editForm.client_id;
      const resolvedAssignedUserId = editForm.assigned_user_id === EMPTY_RELATION_VALUE ? null : editForm.assigned_user_id;
      const finalAssignedUserId = resolvedAssignedUserId ?? existing.assigned_user_id;
      if (!finalAssignedUserId) {
        throw new Error("assigned_user_id is required. Please select a user.");
      }
      const techMatch = resolvedAssignedUserId
        ? technicians.find((t) => t.user_id === resolvedAssignedUserId)
        : null;
      const clientName = resolvedClientId
        ? (clients.find(c => c.id === resolvedClientId)?.name || existing.client_name || "")
        : (existing.client_name || "");
      const techName = techMatch?.name || existing.technician_name || "";

      // Calculate technician earnings from profit distribution rules
      const techEarn = getTechEarnings(techName, total, earningsMap);

      await updateServiceOrder(id, {
        client_id: resolvedClientId,
        client_name: clientName,
        technician_name: techName,
        user_id: finalAssignedUserId,
        assigned_user_id: finalAssignedUserId,
        platform: toNullableText(editForm.platform),
        week: toNullableText(editForm.week),
        car_name: toNullableText(editForm.car_name),
        license_plate: formatLicensePlate(editForm.license_plate),
        service_1_name: toNullableText(editForm.service_1_name),
        service_1_price: Number(editForm.service_1_price) || 0,
        service_2_name: toNullableText(editForm.service_2_name),
        service_2_price: Number(editForm.service_2_price) || 0,
        service_3_name: toNullableText(editForm.service_3_name),
        service_3_price: Number(editForm.service_3_price) || 0,
        service_4_name: toNullableText(editForm.service_4_name),
        service_4_price: Number(editForm.service_4_price) || 0,
        total,
        technician_percentage: techEarn?.percentage ?? 0,
        technician_earning: techEarn?.earnings ?? 0,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["service_orders"] });
      queryClient.invalidateQueries({ queryKey: ["financial-summary"] });
      setEditingId(null);
      setEditForm(null);
      toast.success(t("toast.updated"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const startEdit = (o: ServiceOrderRow) => {
    // OS extraídas por OCR podem ter apenas client_name (sem client_id):
    // resolve pelo nome para o seletor não abrir vazio.
    const clientName = (o.client_name || o.clients?.name || "").trim().toLowerCase();
    const clientByName = !o.client_id && clientName
      ? clients.find((c) => c.name.trim().toLowerCase() === clientName)
      : null;
    setEditingId(o.id);
    setEditForm({
      client_id: o.client_id || clientByName?.id || EMPTY_RELATION_VALUE,
      platform: o.platform || "",
      assigned_user_id: o.assigned_user_id || EMPTY_RELATION_VALUE,
      week: o.week || "",
      car_name: o.car_name || "",
      license_plate: o.license_plate || "",
      service_1_name: o.service_1_name || "",
      service_1_price: o.service_1_price ?? 0,
      service_2_name: o.service_2_name || "",
      service_2_price: o.service_2_price ?? 0,
      service_3_name: o.service_3_name || "",
      service_3_price: o.service_3_price ?? 0,
      service_4_name: o.service_4_name || "",
      service_4_price: o.service_4_price ?? 0,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(null);
  };

  const openPhotos = (id: string) => {
    setPhotosOrderId(id);
    setPhotosOpen(true);
  };

  const updateField = (field: keyof EditState, value: string | number) => {
    setEditForm((prev) => (prev ? { ...prev, [field]: value } : prev));
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
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3 md:flex-row md:items-center md:gap-3 md:px-4 md:py-2">
          <span className="text-sm font-medium">{selected.size} selecionado(s)</span>
          <Can permission="service_orders.delete">
            <Button
              variant="destructive"
              size="sm"
              className="h-10 text-xs md:h-7"
              onClick={() => setShowDeleteDialog(true)}
            >
              <Trash2 className="h-3 w-3 mr-1" /> Excluir selecionados
            </Button>
          </Can>
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
              const isEditing = editingId === o.id && editForm;
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
              const computedTotal = isEditing
                ? (Number(editForm.service_1_price) || 0) + (Number(editForm.service_2_price) || 0) + (Number(editForm.service_3_price) || 0) + (Number(editForm.service_4_price) || 0)
                : Number(o.total) || 0;
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

                  {isEditing ? (
                    <div className="mt-3 space-y-2 rounded-md border border-border/50 bg-background/50 p-2">
                      <div className="grid grid-cols-1 gap-2">
                        <Select value={editForm.client_id} onValueChange={(value) => updateField("client_id", value)}>
                          <SelectTrigger className="h-11 text-xs bg-background"><SelectValue placeholder={t("label.client")} /></SelectTrigger>
                          <SelectContent><SelectItem value={EMPTY_RELATION_VALUE}>—</SelectItem>{editForm.client_id !== EMPTY_RELATION_VALUE && !clients.some((c) => c.id === editForm.client_id) && <SelectItem value={editForm.client_id}>{o.client_name || o.clients?.name || "Cliente atual"}</SelectItem>}{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent>
                        </Select>
                        <Select value={editForm.assigned_user_id} onValueChange={(value) => updateField("assigned_user_id", value)}>
                          <SelectTrigger className="h-11 text-xs bg-background"><SelectValue placeholder={t("label.technician")} /></SelectTrigger>
                          <SelectContent><SelectItem value={EMPTY_RELATION_VALUE}>—</SelectItem>{editForm.assigned_user_id !== EMPTY_RELATION_VALUE && !technicians.some((tech) => tech.user_id === editForm.assigned_user_id) && <SelectItem value={editForm.assigned_user_id}>{o.technician_name || o.technicians?.name || "Técnico atual"}</SelectItem>}{technicians.map((technician) => <SelectItem key={technician.user_id} value={technician.user_id}>{technician.name}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input className="h-11 text-xs" value={editForm.platform} placeholder={t("label.platform")} onChange={(e) => updateField("platform", e.target.value)} />
                        <Input className="h-11 text-xs" value={editForm.week} placeholder={t("label.week")} onChange={(e) => updateField("week", e.target.value)} />
                        <Input className="h-11 text-xs" value={editForm.car_name} placeholder={t("label.car")} onChange={(e) => updateField("car_name", e.target.value)} />
                        <Input className="h-11 font-mono text-xs" value={editForm.license_plate} placeholder={t("label.plate")} onChange={(e) => updateField("license_plate", e.target.value)} />
                      </div>
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                          <Input className="h-10 text-xs" value={(editForm as any)[`service_${i}_name`]} placeholder={`Serviço ${i}`} onChange={(e) => updateField(`service_${i}_name` as keyof EditState, e.target.value)} />
                          <Input className="h-10 text-right text-xs tabular-nums" type="number" step="0.01" value={(editForm as any)[`service_${i}_price`]} onChange={(e) => updateField(`service_${i}_price` as keyof EditState, Number(e.target.value) || 0)} />
                        </div>
                      ))}
                      <div className="flex items-center justify-between border-t border-border/50 pt-2">
                        <span className="text-sm font-semibold text-primary tabular-nums">{formatCurrency(computedTotal)}</span>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" className="h-10" onClick={cancelEdit}><X className="h-4 w-4" /></Button>
                          <Button size="sm" className="h-10" onClick={() => updateMutation.mutate(o.id)} disabled={updateMutation.isPending}>{updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}</Button>
                        </div>
                      </div>
                    </div>
                  ) : (
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
                        <Can permission="service_orders.edit"><Button variant="outline" size="sm" className="h-10" onClick={() => startEdit(o)}><Pencil className="h-4 w-4 mr-1" />Editar</Button></Can>
                        <Can permission="service_orders.delete"><Button variant="ghost" size="sm" className="h-10 text-destructive" onClick={() => deleteMutation.mutate(o.id)}><Trash2 className="h-4 w-4" /></Button></Can>
                      </div>
                    </div>
                  )}
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
                  const isEditing = editingId === o.id && editForm;
                  const ps = getPaymentStatus(o);

                  if (isEditing) {
                    const computedTotal =
                      (Number(editForm.service_1_price) || 0) +
                      (Number(editForm.service_2_price) || 0) +
                      (Number(editForm.service_3_price) || 0) +
                      (Number(editForm.service_4_price) || 0);

                    return (
                      <TableRow key={o.id} className={cn("relative", paymentTextStyle[ps])}>
                        <TableCell className="p-1">
                          <Checkbox checked={selected.has(o.id)} onCheckedChange={() => toggleOne(o.id)} />
                        </TableCell>
                        <TableCell className="p-1 min-w-[170px]">
                          <Select value={editForm.client_id} onValueChange={(value) => updateField("client_id", value)}>
                            <SelectTrigger className="h-7 text-xs bg-background">
                              <SelectValue placeholder={t("label.client")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={EMPTY_RELATION_VALUE}>—</SelectItem>
                              {editForm.client_id !== EMPTY_RELATION_VALUE && !clients.some((c) => c.id === editForm.client_id) && (
                                <SelectItem value={editForm.client_id}>{o.client_name || o.clients?.name || "Cliente atual"}</SelectItem>
                              )}
                              {clients.map((client) => (
                                <SelectItem key={client.id} value={client.id}>
                                  {client.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="p-1">
                          <Input className="h-7 text-xs" value={editForm.platform} onChange={(e) => updateField("platform", e.target.value)} />
                        </TableCell>
                        <TableCell className="p-1 min-w-[170px]">
                          <Select value={editForm.assigned_user_id} onValueChange={(value) => updateField("assigned_user_id", value)}>
                            <SelectTrigger className="h-7 text-xs bg-background">
                              <SelectValue placeholder={t("label.technician")} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={EMPTY_RELATION_VALUE}>—</SelectItem>
                              {editForm.assigned_user_id !== EMPTY_RELATION_VALUE && !technicians.some((tech) => tech.user_id === editForm.assigned_user_id) && (
                                <SelectItem value={editForm.assigned_user_id}>{o.technician_name || o.technicians?.name || "Técnico atual"}</SelectItem>
                              )}
                              {technicians.map((technician) => (
                                <SelectItem key={technician.user_id} value={technician.user_id}>
                                  <span className="font-medium">{technician.name}</span>
                                  {technician.display_code ? (
                                    <span className="ml-2 text-[10px] text-muted-foreground">
                                      {technician.display_code}
                                    </span>
                                  ) : null}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="p-1">
                          <Input className="h-7 text-xs w-16" value={editForm.week} onChange={(e) => updateField("week", e.target.value)} />
                        </TableCell>
                        <TableCell className="p-1">
                          <Input className="h-7 text-xs" value={editForm.car_name} onChange={(e) => updateField("car_name", e.target.value)} />
                        </TableCell>
                        <TableCell className="p-1">
                          <Input className="h-7 text-xs w-24 font-mono" value={editForm.license_plate} onChange={(e) => updateField("license_plate", e.target.value)} />
                        </TableCell>
                        <TableCell className="p-1">
                          <div className="space-y-1">
                            {[1, 2, 3, 4].map((i) => (
                              <div key={i} className="flex gap-1">
                                <Input
                                  className="h-6 text-[11px] px-1 w-20"
                                  value={(editForm as any)[`service_${i}_name`]}
                                  placeholder={`S${i}`}
                                  onChange={(e) => updateField(`service_${i}_name` as keyof EditState, e.target.value)}
                                />
                                <Input
                                  className="h-6 text-[11px] px-1 w-14 text-right tabular-nums"
                                  type="number"
                                  step="0.01"
                                  value={(editForm as any)[`service_${i}_price`]}
                                  onChange={(e) => updateField(`service_${i}_price` as keyof EditState, Number(e.target.value) || 0)}
                                />
                              </div>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-semibold text-primary tabular-nums">
                          {formatCurrency(computedTotal)}
                        </TableCell>
                        <TableCell className="text-right text-[10px] text-muted-foreground">—</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("text-[10px]", paymentBadgeStyle[ps])}>
                            {paymentLabel[ps]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-primary"
                              onClick={() => updateMutation.mutate(o.id)}
                              disabled={updateMutation.isPending}
                            >
                              {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={cancelEdit}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }

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
                          <Can permission="service_orders.edit">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(o)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </Can>
                          <Can permission="service_orders.delete">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(o.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </Can>
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

      <BulkDeleteDialog
        open={showDeleteDialog}
        count={selected.size}
        onConfirm={() => bulkDeleteMutation.mutate([...selected])}
        onCancel={() => setShowDeleteDialog(false)}
        isPending={bulkDeleteMutation.isPending}
      />

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
