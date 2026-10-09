import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CalendarDays,
  Car,
  ClipboardList,
  Clock3,
  Coins,
  Hash,
  ShieldCheck,
  User,
  Wrench,
  AlertTriangle,
  Play,
  Undo2,
  Pause,
} from "lucide-react";
import {
  useProductionOrders,
  PRODUCTION_STATUSES,
  PRIORITY_META,
  isOrderLocked,
  type ProductionOrder,
  type ProductionPriority,
  type ProductionStatus,
} from "@/hooks/useProductionOrders";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

interface Props {
  onOpen: (o: ProductionOrder) => void;
}

type BoardColumn = {
  key: string;
  label: string;
  description: string;
  statuses: ProductionStatus[];
  accent: string;
  dot: string;
  icon: React.ComponentType<{ className?: string }>;
};

const BOARD_COLUMNS: BoardColumn[] = [
  {
    key: "in_production",
    label: "Em Produção",
    description: "Serviço em andamento",
    statuses: ["new_vehicle", "triage", "awaiting_validation", "in_production", "finished", "invoiced"],
    accent:
      "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/30",
    dot: "bg-indigo-500",
    icon: Wrench,
  },
  {
    key: "paused",
    label: "Pausado",
    description: "Interrompido temporariamente",
    statuses: ["paused"],
    accent:
      "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
    dot: "bg-amber-500",
    icon: Pause,
  },
  {
    key: "delivered",
    label: "Finalizado",
    description: "Concluído e entregue",
    statuses: ["delivered"],
    accent:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    dot: "bg-emerald-500",
    icon: ShieldCheck,
  },
];

const STATUS_LABEL: Record<ProductionStatus, string> = {
  new_vehicle: "Em Produção",
  triage: "Em Produção",
  awaiting_validation: "Em Produção",
  in_production: "Em Produção",
  paused: "Pausado",
  finished: "Em Produção",
  invoiced: "Em Produção",
  delivered: "Finalizado",
};

function columnFor(status: ProductionStatus): BoardColumn | undefined {
  return BOARD_COLUMNS.find((c) => c.statuses.includes(status));
}

function getValidTransitions(currentStatus: ProductionStatus): ProductionStatus[] {
  if (isOrderLocked(currentStatus)) {
    return [];
  }
  if (currentStatus === "paused") {
    return ["in_production", "delivered"];
  }
  return ["paused", "delivered"];
}

function formatCanonicalCurrency(
  v: number | string | null | undefined,
  currency = "EUR"
): string {
  if (v == null || v === "") return "—";
  const num = typeof v === "number" ? v : Number(v);
  if (Number.isNaN(num)) return "—";
  try {
    const loc = currency === "BRL" ? "pt-BR" : "fr-FR";
    return new Intl.NumberFormat(loc, {
      style: "currency",
      currency: currency || "EUR",
      minimumFractionDigits: 2,
    }).format(num);
  } catch {
    return `${num.toFixed(2)} ${currency}`;
  }
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
    return d.toLocaleDateString("pt-BR");
  } catch {
    return String(iso).slice(0, 10);
  }
}

export function ProductionBoard({ onOpen }: Props) {
  const { data: ordersRaw = [], isLoading, update, remove, finalize } = useProductionOrders();
  const orders = Array.isArray(ordersRaw)
    ? (ordersRaw as ProductionOrder[]).filter((o: ProductionOrder) => !!o)
    : [];

  const [pauseModal, setPauseModal] = useState<{
    open: boolean;
    order: ProductionOrder | null;
    targetStatus: ProductionStatus;
    reason: string;
  }>({ open: false, order: null, targetStatus: "paused", reason: "" });

  const grouped = useMemo(() => {
    const m = new Map<string, ProductionOrder[]>();
    BOARD_COLUMNS.forEach((c) => m.set(c.key, []));
    orders.forEach((o) => {
      if (!o || !o.status) return;
      const col = columnFor(o.status);
      if (!col) return;
      const arr = m.get(col.key);
      if (arr) arr.push(o);
    });
    return m;
  }, [orders]);

  const applyStatusChange = (id: string, status: ProductionStatus) => {
    const order = orders.find((o) => o && o.id === id);
    if (!order) return;
    if (isOrderLocked(order.status)) {
      toast.warning("Ordem finalizada não pode ter o status alterado.");
      return;
    }
    if (order.status === status) return;

    const allowed = getValidTransitions(order.status);
    if (!allowed.includes(status)) {
      toast.warning(`Transição não permitida a partir de ${STATUS_LABEL[order.status] || order.status}.`);
      return;
    }

    if (status === "delivered") {
      const confirmFinalize = window.confirm(
        `Finalizar e entregar ordem ${order.code || order.id}? Esta ação encerrará a execução e gerará o registro comercial no WEEKLOG.`
      );
      if (!confirmFinalize) return;
      finalize.mutate(id);
      return;
    }

    update.mutate(
      { id, status },
      {
        onSuccess: () => {
          toast.success(`Ordem ${order.code || id} atualizada com sucesso.`);
        },
        onError: (err: any) => {
          toast.error(err?.message || "Falha ao atualizar status da ordem.");
        },
      }
    );
  };

  const requestChangeStatus = (order: ProductionOrder, status: ProductionStatus) => {
    if (isOrderLocked(order.status)) return;
    if (status === "paused") {
      setPauseModal({ open: true, order, targetStatus: "paused", reason: "" });
      return;
    }
    applyStatusChange(order.id!, status);
  };

  const confirmPause = () => {
    const { order, reason, targetStatus } = pauseModal;
    if (!order) return;
    if (!reason.trim()) {
      toast.error("Motivo da pausa é obrigatório.");
      return;
    }
    const timestamp = new Date().toISOString();
    const currentInternal = order.notes ?? "";
    const append =
      `\n\n==== PAUSA ====\nData: ${timestamp}\nMotivo: ${reason.trim()}\n`;
    const notes = currentInternal.trim()
      ? currentInternal + append
      : append.trimStart();
    update.mutate(
      { id: order.id!, status: targetStatus, notes },
      {
        onSuccess: () => {
          toast.success(`OS ${order.code || order.id?.slice(0, 8)} pausada com sucesso.`);
          setPauseModal({ open: false, order: null, targetStatus: "paused", reason: "" });
        },
        onError: (err: any) => {
          toast.error(err?.message || "Falha ao pausar a ordem.");
        },
      },
    );
  };

  const returnToBudget = async () => {
    const { order } = pauseModal;
    if (!order?.id) return;
    if (!window.confirm(
      "Retornar esta ordem para Orçamentos como Rascunho?\n\n• A ordem de produção será removida do Kanban.\n• O orçamento vinculado voltará a ser editável.\n• Uma nova assinatura/confirmação será necessária.",
    )) return;
    try {
      window.dispatchEvent(
        new CustomEvent("production:return-to-budget", {
          detail: { productionOrderId: order.id },
        }),
      );
      await remove.mutateAsync(order.id);
      toast.success("Ordem removida da Produção · Orçamento retornado para Rascunho.");
    } catch (e: any) {
      toast.error(e?.message || "Falha ao retornar ao orçamento.");
    } finally {
      setPauseModal({ open: false, order: null, targetStatus: "paused", reason: "" });
    }
  };

  const changeReqRef = useRef<
    (order: ProductionOrder, status: ProductionStatus) => void
  >(requestChangeStatus);
  changeReqRef.current = requestChangeStatus;
  useEffect(() => {
    const handler = (ev: Event) => {
      const ce = ev as CustomEvent<{ order: ProductionOrder; status: ProductionStatus }>;
      const ord = ce.detail?.order;
      const st = ce.detail?.status;
      if (!ord || !st) return;
      changeReqRef.current?.(ord, st);
    };
    window.addEventListener("production:order-change-status-requested", handler);
    return () =>
      window.removeEventListener("production:order-change-status-requested", handler);
  }, []);

  const onDrop = (e: React.DragEvent, column: BoardColumn) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    const order = orders.find((o) => o && o.id === id);
    if (!order) return;
    if (isOrderLocked(order.status)) return;

    let target: ProductionStatus | null = null;
    if (column.key === "in_production") {
      if (order.status === "paused") {
        target = "in_production";
      } else {
        return;
      }
    } else if (column.key === "paused") {
      if (order.status !== "paused") {
        target = "paused";
      }
    } else if (column.key === "delivered") {
      if (order.status !== "delivered") {
        target = "delivered";
      }
    }

    if (target) {
      const allowed = getValidTransitions(order.status);
      if (!allowed.includes(target)) {
        toast.warning(`Transição não permitida.`);
        return;
      }
      requestChangeStatus(order, target);
    }
  };

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory lg:grid lg:grid-cols-3 lg:gap-6 lg:overflow-visible">
        {BOARD_COLUMNS.map((col) => (
          <div
            key={col.key}
            className="min-w-[285px] max-w-[340px] flex-1 shrink-0 snap-start rounded-xl bg-muted/30 p-3 lg:min-w-0 lg:max-w-none min-h-[200px] xl:min-h-[320px] xl:max-h-[calc(100svh-260px)] xl:overflow-y-auto"
          >
            <div className="mb-3 flex items-center justify-between py-2 md:py-1">
              <div className="flex items-center gap-2">
                <Skeleton className="h-2 w-2 rounded-full" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-5 w-8 rounded-md" />
            </div>
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-40 w-full rounded-lg" />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory lg:grid lg:grid-cols-3 lg:gap-6 lg:overflow-visible">
        {BOARD_COLUMNS.map((col) => {
          const items = grouped.get(col.key) ?? [];
          const Icon = col.icon;
          return (
            <div
              key={col.key}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, col)}
              className="flex min-w-[285px] max-w-[340px] flex-1 shrink-0 snap-start flex-col rounded-xl border border-border/70 bg-muted/30 p-3 lg:min-w-0 lg:max-w-none xl:max-h-[calc(100svh-260px)] xl:overflow-y-auto"
            >
              <div className="sticky top-0 z-10 mb-3 flex items-start justify-between gap-2 rounded-lg bg-muted/40 px-2 py-2 backdrop-blur">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${col.accent}`}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${col.dot}`} />
                      <h3 className="text-sm font-semibold leading-none tracking-tight">
                        {col.label}
                      </h3>
                    </div>
                    <p className="mt-1 truncate text-[10px] text-muted-foreground">
                      {col.description}
                    </p>
                  </div>
                </div>
                <Badge variant="secondary" className="shrink-0 text-xs tabular-nums">
                  {items.length}
                </Badge>
              </div>
              <div className="space-y-2.5">
                {items.map((o) => (
                  <OrderCard
                    key={o.id ?? String(Math.random())}
                    order={o}
                    onOpen={onOpen}
                    onChangeStatus={(next) => requestChangeStatus(o, next)}
                  />
                ))}
                {items.length === 0 && (
                  <div className="py-8 text-center text-[11px] text-muted-foreground opacity-70">
                    Nenhuma ordem nesta fase
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog
        open={pauseModal.open}
        onOpenChange={(o) => {
          if (!o) setPauseModal({ open: false, order: null, targetStatus: "paused", reason: "" });
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pause className="h-5 w-5 text-amber-600" /> Pausar Ordem de Produção
            </DialogTitle>
            <DialogDescription>
              {pauseModal.order
                ? `OS ${pauseModal.order.code || pauseModal.order.id?.slice(0, 8).toUpperCase()}`
                : ""}{" "}
              — informe o motivo da pausa para continuar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="pause-reason">
                Motivo da pausa <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="pause-reason"
                autoFocus
                rows={4}
                placeholder="Ex.: Falta de peça específica, aguardando resposta do cliente, veículo necessita de inspeção complementar…"
                value={pauseModal.reason}
                onChange={(e) =>
                  setPauseModal((m) => ({ ...m, reason: e.target.value }))
                }
              />
              <p className="text-[11px] text-muted-foreground">
                O motivo será salvo nas observações internas da ordem.
              </p>
            </div>
            <div className="rounded-lg border border-dashed border-slate-400/40 bg-slate-50/60 p-3 dark:bg-slate-900/40">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full gap-2 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                onClick={returnToBudget}
                disabled={remove.isPending}
              >
                <Undo2 className="h-4 w-4" /> Retornar ao orçamento
              </Button>
              <p className="pt-1.5 text-[11px] text-muted-foreground text-center">
                Retira a ordem da Produção e devolve para Orçamentos como <strong>Rascunho editável</strong>.
              </p>
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setPauseModal({ open: false, order: null, targetStatus: "paused", reason: "" })
              }
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={confirmPause}
              disabled={!pauseModal.reason.trim() || update.isPending}
            >
              {update.isPending ? "Salvando…" : (
                <>
                  <Play className="mr-2 h-4 w-4" /> Confirmar pausa
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function OrderCard({
  order,
  onOpen,
  onChangeStatus,
}: {
  order: ProductionOrder;
  onOpen: (o: ProductionOrder) => void;
  onChangeStatus: (next: ProductionStatus) => void;
}) {
  const safePriority: (typeof PRIORITY_META)[ProductionPriority] =
    PRIORITY_META[order.priority as ProductionPriority] ?? PRIORITY_META.normal;

  const col = columnFor(order.status);
  const locked = isOrderLocked(order.status);

  // Campos Canônicos
  const clientName = order.client_name || order.clientName || "—";
  const vehicle = [order.brand, order.model].filter(Boolean).join(" ") || "—";
  const licensePlate = order.license_plate || order.licensePlate || order.vin || "—";
  const operationalSite = order.operational_site_key || order.operationalSiteKey || null;

  const budgetCode = order.budget_code || order.budgetCode || null;
  const displayNumber = budgetCode ? `Devis ${budgetCode}` : `OS ${order.code || "—"}`;

  const rawTotal = order.total ?? order.total_amount ?? order.recognized_total ?? null;
  const currency = order.currency || order.currency_code || order.currencyCode || "EUR";
  const formattedTotal = formatCanonicalCurrency(rawTotal, currency);

  let tipoServico = "Serviço Operacional";
  if (Array.isArray(order.performed_services) && order.performed_services.length > 0) {
    tipoServico = `${order.performed_services.length} serviço(s) registrado(s)`;
  } else if (order.insurer) {
    tipoServico = order.insurer;
  } else if (budgetCode || order.budgetId || order.budget_id) {
    tipoServico = "Orçamento Aprovado";
  }

  const dataISO = order.started_at || order.due_at || order.created_at;
  const isOverdue =
    !!order.due_at &&
    new Date(order.due_at).getTime() < Date.now() &&
    !locked;

  const validTransitions = getValidTransitions(order.status);

  return (
    <Card
      draggable={!locked}
      onDragStart={(e) => {
        try {
          e.dataTransfer.setData("text/plain", order.id ?? "");
        } catch {
          /* noop */
        }
      }}
      onClick={() => onOpen(order)}
      className="cursor-pointer space-y-3 overflow-hidden border-border/60 p-3 transition-all hover:border-primary/40 hover:shadow-md [&[draggable=false]]:opacity-80"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Hash className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold tracking-tight text-foreground">
              {displayNumber}
            </div>
            <div className="text-[10px] font-mono text-muted-foreground">
              OS {order.code || "—"}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {order.priority && order.priority !== "normal" ? (
            <Badge
              variant="outline"
              className={`text-[10px] px-1.5 py-0 ${safePriority.tone}`}
            >
              {safePriority.label}
            </Badge>
          ) : null}
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 ${col?.accent ?? "bg-muted text-muted-foreground"}`}
          >
            {STATUS_LABEL[order.status] ?? order.status}
          </Badge>
        </div>
      </div>

      <div className="space-y-1.5 text-[11px] leading-snug text-foreground/90">
        <InfoLine icon={User} label="Cliente" value={clientName} />
        <InfoLine
          icon={Car}
          label="Veículo"
          value={vehicle + (order.color ? ` · ${order.color}` : "")}
        />
        <InfoLine
          icon={ClipboardList}
          label="Matrícula"
          value={licensePlate}
        />
        <InfoLine
          icon={Wrench}
          label="Serviço"
          value={tipoServico}
        />
        {operationalSite ? (
          <InfoLine
            icon={ClipboardList}
            label="Site"
            value={operationalSite}
          />
        ) : null}
        <InfoLine
          icon={Coins}
          label="Valor total"
          value={formattedTotal}
          valueClassName={rawTotal != null ? "text-emerald-700 dark:text-emerald-400 font-semibold" : undefined}
        />
        <InfoLine
          icon={isOverdue ? AlertTriangle : CalendarDays}
          label={isOverdue ? "Atrasado desde" : "Data"}
          value={
            isOverdue && order.due_at
              ? formatDistanceToNow(new Date(order.due_at), {
                  addSuffix: true,
                  locale: ptBR,
                })
              : formatDate(dataISO)
          }
          valueClassName={isOverdue ? "font-medium text-destructive" : undefined}
          iconClassName={isOverdue ? "text-destructive" : undefined}
        />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <Clock3 className="h-3 w-3" />
          <span className="truncate">
            Atualizado{" "}
            {order.updated_at
              ? formatDistanceToNow(new Date(order.updated_at), {
                  addSuffix: true,
                  locale: ptBR,
                })
              : "—"}
          </span>
        </div>
        <div
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          {validTransitions.length > 0 ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={locked}
                  className="h-7 gap-1 px-2 text-[11px]"
                >
                  Mover
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-2">
                <div className="space-y-1.5 text-xs">
                  <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Ação de Status
                  </p>
                  <div className="flex flex-col gap-1">
                    {validTransitions.map((target) => (
                      <Button
                        key={target}
                        size="sm"
                        variant="ghost"
                        className="justify-start h-8 px-2 text-xs"
                        onClick={() => onChangeStatus(target)}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              columnFor(target)?.dot ?? "bg-slate-400"
                            }`}
                          />
                          {target === "paused"
                            ? "Pausar Ordem"
                            : target === "in_production"
                            ? "Retomar Produção"
                            : "Finalizar Ordem"}
                        </span>
                      </Button>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              Travado
            </Badge>
          )}
        </div>
      </div>
    </Card>
  );
}

function InfoLine({
  icon: Icon,
  label,
  value,
  valueClassName,
  iconClassName,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
  iconClassName?: string;
}) {
  return (
    <div className="flex items-start gap-1.5">
      <Icon
        className={`mt-[2px] h-3 w-3 shrink-0 text-muted-foreground/70 ${iconClassName ?? ""}`}
      />
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
        {label}
      </span>
      <span
        className={`truncate text-foreground/90 ${valueClassName ?? "font-medium"}`}
      >
        {value}
      </span>
    </div>
  );
}
