import React, { useEffect, useMemo, useRef, useState } from "react";
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
  Loader2,
  CheckCircle2,
  CheckCheck,
  Paintbrush,
  Filter,
  ArrowRight,
  Lock,
  Eye,
  AlertOctagon,
  Check,
  Search,
  Hammer,
  Cog,
  Flame,
  Layers,
  LayoutGrid,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useProductionOrders,
  PRIORITY_META,
  isOrderLocked,
  type ProductionOrder,
  type ProductionPriority,
  type ProductionStatus,
} from "@/hooks/useProductionOrders";
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
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ApiError } from "@/lib/api";

interface Props {
  onOpen: (o: ProductionOrder) => void;
}

export interface StageConfig {
  key: string;
  label: string;
  shortLabel: string;
  sectorName?: string;
  description: string;
  accent: string;
  dot: string;
  icon: React.ComponentType<{ className?: string }>;
  isTerminal?: boolean;
  isPause?: boolean;
}

export const WORKSHOP_STAGES: StageConfig[] = [
  {
    key: "awaiting_start",
    label: "Aguardando Início",
    shortLabel: "Aguardando",
    description: "OS aprovada na fila de entrada",
    accent: "bg-slate-500/10 text-slate-700 dark:text-slate-300 border-slate-500/30",
    dot: "bg-slate-400",
    icon: Clock3,
  },
  {
    key: "diagnosis",
    label: "Diagnóstico",
    shortLabel: "Diagnóstico",
    description: "Checklist e vistoria técnica de entrada",
    accent: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/30",
    dot: "bg-cyan-500",
    icon: ClipboardList,
  },
  {
    key: "disassembly",
    label: "Desmontagem",
    shortLabel: "Desmontagem",
    sectorName: "Montagem / Desmontagem",
    description: "Desmontagem de peças, forrações e presilhas",
    accent: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
    dot: "bg-amber-500",
    icon: Wrench,
  },
  {
    key: "pdr",
    label: "PDR / Martelinho",
    shortLabel: "PDR",
    sectorName: "PDR",
    description: "Desamassamento artesanal sem repintura",
    accent: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30",
    dot: "bg-blue-500",
    icon: Hammer,
  },
  {
    key: "mechanics",
    label: "Mecânica",
    shortLabel: "Mecânica",
    sectorName: "Mecânica",
    description: "Reparos mecânicos, suspensão e alinhamento",
    accent: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-500/30",
    dot: "bg-indigo-500",
    icon: Cog,
  },
  {
    key: "bodywork",
    label: "Funilaria",
    shortLabel: "Funilaria",
    sectorName: "Funilaria",
    description: "Chapeação, alinhamento de lataria e solda",
    accent: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30",
    dot: "bg-orange-500",
    icon: Flame,
  },
  {
    key: "paint_prep",
    label: "Preparação",
    shortLabel: "Preparação",
    sectorName: "Pintura",
    description: "Lixamento, primer, aparelhamento e isolamento",
    accent: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
    dot: "bg-yellow-500",
    icon: Layers,
  },
  {
    key: "paint",
    label: "Pintura",
    shortLabel: "Pintura",
    sectorName: "Pintura",
    description: "Cabine de pintura, base de cor e verniz",
    accent: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/30",
    dot: "bg-purple-500",
    icon: Paintbrush,
  },
  {
    key: "assembly",
    label: "Montagem",
    shortLabel: "Montagem",
    sectorName: "Montagem / Desmontagem",
    description: "Reinstalação de peças, vãos e vidraçaria",
    accent: "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/30",
    dot: "bg-teal-500",
    icon: Wrench,
  },
  {
    key: "inspection",
    label: "Inspeção Final",
    shortLabel: "Inspeção / CQ",
    description: "Controle de qualidade, polimento e lavagem",
    accent: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    dot: "bg-emerald-500",
    icon: CheckCheck,
  },
  {
    key: "paused",
    label: "Pausado",
    shortLabel: "Pausado",
    description: "Interrompido por impedimento real",
    accent: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30",
    dot: "bg-rose-500",
    icon: Pause,
    isPause: true,
  },
  {
    key: "finished",
    label: "Finalizado",
    shortLabel: "Finalizado",
    description: "Concluído e transferido para WEEKLOG",
    accent: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30",
    dot: "bg-green-500",
    icon: ShieldCheck,
    isTerminal: true,
  },
];

export interface SectorFilterConfig {
  key: string;
  label: string;
  shortLabel: string;
  description: string;
  dot: string;
  icon: React.ComponentType<{ className?: string }>;
  stageKeys: string[];
}

export const SECTOR_FILTERS: SectorFilterConfig[] = [
  {
    key: "awaiting_start",
    label: "Aguardando Início",
    shortLabel: "Aguardando",
    description: "OS aprovada na fila de entrada",
    dot: "bg-slate-400",
    icon: Clock3,
    stageKeys: ["awaiting_start"],
  },
  {
    key: "diagnosis",
    label: "Diagnóstico",
    shortLabel: "Diagnóstico",
    description: "Checklist e vistoria técnica de entrada",
    dot: "bg-cyan-500",
    icon: ClipboardList,
    stageKeys: ["diagnosis"],
  },
  {
    key: "assembly_disassembly",
    label: "Montagem e Desmontagem",
    shortLabel: "Mont./Desmont.",
    description: "Desmontagem inicial e montagem/reinstalação pós-pintura",
    dot: "bg-amber-500",
    icon: Wrench,
    stageKeys: ["disassembly", "assembly"],
  },
  {
    key: "pdr",
    label: "PDR / Martelinho",
    shortLabel: "PDR",
    description: "Desamassamento artesanal sem repintura",
    dot: "bg-blue-500",
    icon: Hammer,
    stageKeys: ["pdr"],
  },
  {
    key: "mechanics",
    label: "Mecânica",
    shortLabel: "Mecânica",
    description: "Reparos mecânicos, suspensão e alinhamento",
    dot: "bg-indigo-500",
    icon: Cog,
    stageKeys: ["mechanics"],
  },
  {
    key: "bodywork",
    label: "Funilaria",
    shortLabel: "Funilaria",
    description: "Chapeação, alinhamento de lataria e solda",
    dot: "bg-orange-500",
    icon: Flame,
    stageKeys: ["bodywork"],
  },
  {
    key: "paint_prep",
    label: "Preparação",
    shortLabel: "Preparação",
    description: "Lixamento, primer, aparelhamento e isolamento",
    dot: "bg-yellow-500",
    icon: Layers,
    stageKeys: ["paint_prep"],
  },
  {
    key: "paint",
    label: "Pintura",
    shortLabel: "Pintura",
    description: "Cabine de pintura, base de cor e verniz",
    dot: "bg-purple-500",
    icon: Paintbrush,
    stageKeys: ["paint"],
  },
  {
    key: "inspection",
    label: "Inspeção Final",
    shortLabel: "Inspeção / CQ",
    description: "Controle de qualidade, polimento e lavagem",
    dot: "bg-emerald-500",
    icon: CheckCheck,
    stageKeys: ["inspection"],
  },
  {
    key: "paused",
    label: "Pausado",
    shortLabel: "Pausado",
    description: "Interrompido por impedimento real",
    dot: "bg-rose-500",
    icon: Pause,
    stageKeys: ["paused"],
  },
];

export const STAGE_MAP = new Map<string, StageConfig>(
  WORKSHOP_STAGES.map((s) => [s.key, s])
);

export function getEffectiveStage(o: ProductionOrder): string {
  if (o.status === "paused") return "paused";
  if (o.status === "delivered") return "finished";
  const stage = o.currentStage || (o as any).current_stage;
  if (stage && STAGE_MAP.has(stage)) return stage;
  return "awaiting_start";
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

interface BlockedTaskItem {
  id: string;
  category: string;
  carPartCode: string;
  description: string;
  status: string;
  missingTechnician?: boolean;
}

export function ProductionBoard({ onOpen }: Props) {
  const {
    data: ordersRaw = [],
    isLoading,
    update,
    remove,
    finalize,
    updateStage,
  } = useProductionOrders();

  const orders = useMemo(() => {
    return Array.isArray(ordersRaw)
      ? (ordersRaw as ProductionOrder[]).filter((o: ProductionOrder) => !!o)
      : [];
  }, [ordersRaw]);

  const [activeDragOrder, setActiveDragOrder] = useState<ProductionOrder | null>(null);
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Modal de Pausa
  const [pauseModal, setPauseModal] = useState<{
    open: boolean;
    order: ProductionOrder | null;
    reason: string;
  }>({ open: false, order: null, reason: "" });

  // Modal de Finalização Normal
  const [finalizeModal, setFinalizeModal] = useState<{
    open: boolean;
    order: ProductionOrder | null;
  }>({ open: false, order: null });

  // Modal de Bloqueio por Tarefas Incompletas (Regra Canônica)
  const [blockedModal, setBlockedModal] = useState<{
    open: boolean;
    order: ProductionOrder | null;
    pendingTasks: BlockedTaskItem[];
    message: string;
  }>({ open: false, order: null, pendingTasks: [], message: "" });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  // Filtragem de Busca
  const filteredOrders = useMemo(() => {
    if (!searchQuery.trim()) return orders;
    const q = searchQuery.toLowerCase().trim();
    return orders.filter((o) => {
      const code = (o.code || "").toLowerCase();
      const client = (o.client_name || o.clientName || "").toLowerCase();
      const plate = (o.license_plate || o.licensePlate || o.vin || "").toLowerCase();
      const brand = (o.brand || "").toLowerCase();
      const model = (o.model || "").toLowerCase();
      const devis = (o.budget_code || o.budgetCode || "").toLowerCase();
      return (
        code.includes(q) ||
        client.includes(q) ||
        plate.includes(q) ||
        brand.includes(q) ||
        model.includes(q) ||
        devis.includes(q)
      );
    });
  }, [orders, searchQuery]);

  // Agrupamento por etapa
  const groupedOrders = useMemo(() => {
    const map = new Map<string, ProductionOrder[]>();
    WORKSHOP_STAGES.forEach((s) => map.set(s.key, []));

    filteredOrders.forEach((o) => {
      const stageKey = getEffectiveStage(o);
      const list = map.get(stageKey) || [];
      list.push(o);
      map.set(stageKey, list);
    });
    return map;
  }, [filteredOrders]);

  // Demanda Prevista para o setor filtrado
  const forecastedOrdersForSector = useMemo(() => {
    if (sectorFilter === "all") return [];
    const activeFilter = SECTOR_FILTERS.find((f) => f.key === sectorFilter);
    const targetKeys = activeFilter ? activeFilter.stageKeys : [sectorFilter];

    return filteredOrders.filter((o) => {
      if (o.status === "delivered") return false;
      const currentStageKey = getEffectiveStage(o);
      if (targetKeys.includes(currentStageKey)) return false;

      const route = o.recommendedRoute || (o as any).recommended_route;
      if (!Array.isArray(route)) return false;

      const currentIdx = route.indexOf(currentStageKey);
      // Está na rota para algum dos estágios do setor e é posterior à etapa atual
      return targetKeys.some((targetKey) => {
        const targetIdx = route.indexOf(targetKey);
        return targetIdx > -1 && (currentIdx === -1 || targetIdx > currentIdx);
      });
    });
  }, [filteredOrders, sectorFilter]);

  // Ação de transição para Finalizado
  const handleFinalizeRequest = async (order: ProductionOrder) => {
    try {
      await finalize.mutateAsync(order.id);
      setFinalizeModal({ open: false, order: null });
      toast.success(`Ordem ${order.code} finalizada e integrada à WEEKLOG!`);
    } catch (err: any) {
      setFinalizeModal({ open: false, order: null });
      const apiErr = err as ApiError;
      if (
        apiErr.status === 422 ||
        apiErr.code === "UNRESOLVED_PRODUCTION_TASKS" ||
        apiErr.details?.code === "UNRESOLVED_PRODUCTION_TASKS"
      ) {
        const tasks: BlockedTaskItem[] =
          apiErr.details?.pendingTasks ||
          apiErr.details?.unresolvedTasks ||
          [];
        setBlockedModal({
          open: true,
          order,
          pendingTasks: tasks,
          message:
            apiErr.message ||
            "Existem tarefas operacionais pendentes ou sem técnico responsável assinado.",
        });
      } else {
        toast.error(err?.message || "Falha ao finalizar ordem de produção.");
      }
    }
  };

  // Movimentação de Etapa
  const handleMoveStage = (order: ProductionOrder, targetStage: string) => {
    if (isOrderLocked(order.status)) {
      toast.warning("Ordem finalizada não pode ser movimentada no Kanban.");
      return;
    }

    const currentStageKey = getEffectiveStage(order);
    if (currentStageKey === targetStage) return;

    if (targetStage === "finished") {
      setFinalizeModal({ open: true, order });
      return;
    }

    if (targetStage === "paused") {
      setPauseModal({ open: true, order, reason: "" });
      return;
    }

    updateStage.mutate({ id: order.id, stage: targetStage });
  };

  const confirmPause = () => {
    const { order, reason } = pauseModal;
    if (!order) return;
    if (!reason.trim()) {
      toast.error("Motivo da pausa é obrigatório.");
      return;
    }
    updateStage.mutate(
      { id: order.id, stage: "paused", reason: reason.trim() },
      {
        onSuccess: () => {
          setPauseModal({ open: false, order: null, reason: "" });
        },
      }
    );
  };

  // DND Handlers
  const handleDragStart = (event: DragStartEvent) => {
    const activeId = String(event.active.id);
    const order = orders.find((o) => o && o.id === activeId);
    if (order && !isOrderLocked(order.status)) {
      setActiveDragOrder(order);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDragOrder(null);
    if (!over) return;

    const activeId = String(active.id);
    const targetStageKey = String(over.id);

    const order = orders.find((o) => o && o.id === activeId);
    if (!order || isOrderLocked(order.status)) return;

    handleMoveStage(order, targetStageKey);
  };

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory">
        {WORKSHOP_STAGES.slice(0, 5).map((col) => (
          <div
            key={col.key}
            className="min-w-[280px] max-w-[320px] shrink-0 rounded-xl bg-card border border-border/70 p-3 min-h-[300px]"
          >
            <div className="mb-3 flex items-center justify-between py-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-8 rounded-md" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-32 w-full rounded-lg" />
              <Skeleton className="h-32 w-full rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Barra de Ferramentas / Filtros do Kanban */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          {/* Campo de Busca */}
          <div className="relative w-full sm:w-64 min-w-[200px]">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar por placa, OS, chassi..."
              className="h-8.5 pl-8 text-xs bg-background"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* Filtros de Setor com Ícone + Contador + Tooltip no hover */}
          <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 max-w-full">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant={sectorFilter === "all" ? "default" : "outline"}
                  className="h-8 text-xs px-2.5 gap-1.5 shrink-0"
                  onClick={() => setSectorFilter("all")}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  <span>Todos</span>
                  <span className="ml-0.5 rounded-full bg-muted px-1.5 py-0.2 text-[10px] font-semibold tabular-nums text-foreground">
                    {filteredOrders.length}
                  </span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <p className="font-semibold">Todos os Setores ({filteredOrders.length})</p>
                <p className="text-[10px] text-muted-foreground">Exibe o pipeline operacional completo do Kanban</p>
              </TooltipContent>
            </Tooltip>

            {SECTOR_FILTERS.map((st) => {
              const count = st.stageKeys.reduce(
                (acc, k) => acc + (groupedOrders.get(k) || []).length,
                0
              );
              const Icon = st.icon;
              const isSelected = sectorFilter === st.key;
              return (
                <Tooltip key={st.key}>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant={isSelected ? "default" : "outline"}
                      className={`h-8 px-2 gap-1.5 shrink-0 transition-colors ${
                        isSelected ? "" : "hover:bg-accent/60"
                      }`}
                      onClick={() => setSectorFilter(isSelected ? "all" : st.key)}
                      aria-label={`${st.label} (${count})`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                      <span className="text-[11px] font-semibold tabular-nums">{count}</span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    <p className="font-semibold">{st.label} ({count})</p>
                    <p className="text-[10px] text-muted-foreground">{st.description}</p>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>

        {/* Resumo de Status Operacional */}
        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 pt-2 border-t border-border/40 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-blue-500" /> Em fluxo:{" "}
            <strong className="text-foreground">
              {filteredOrders.filter((o) => o.status === "in_production").length}
            </strong>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-rose-500" /> Pausados:{" "}
            <strong className="text-foreground">
              {filteredOrders.filter((o) => o.status === "paused").length}
            </strong>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Finalizados:{" "}
            <strong className="text-foreground">
              {filteredOrders.filter((o) => o.status === "delivered").length}
            </strong>
          </span>
        </div>
      </div>

      {/* Seção de Demanda Prevista (quando filtrado por setor) */}
      {sectorFilter !== "all" && forecastedOrdersForSector.length > 0 && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h4 className="text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                Demanda Prevista: {SECTOR_FILTERS.find((f) => f.key === sectorFilter)?.label || "Setor"} ({forecastedOrdersForSector.length} veículo{forecastedOrdersForSector.length > 1 ? "s" : ""} na fila anterior)
              </h4>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Veículos com serviços aprovados para este setor que estão atualmente em fases preliminares
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {forecastedOrdersForSector.map((o) => {
              const currentSt = STAGE_MAP.get(getEffectiveStage(o));
              return (
                <Card
                  key={`forecast-${o.id}`}
                  onClick={() => onOpen(o)}
                  className="p-2.5 bg-card/80 border-blue-500/20 hover:border-blue-500/50 cursor-pointer text-xs space-y-1.5 transition-all shadow-2xs"
                >
                  <div className="flex items-center justify-between font-semibold">
                    <span>OS {o.code}</span>
                    <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-600 border-blue-500/30">
                      Na Rota
                    </Badge>
                  </div>
                  <div className="truncate text-muted-foreground">
                    {[o.brand, o.model].filter(Boolean).join(" ") || "Veículo"} · {o.license_plate || o.licensePlate || "—"}
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] pt-1 border-t border-border/50">
                    <span className="text-muted-foreground">Atualmente em:</span>
                    <Badge variant="secondary" className="text-[10px] gap-1 px-1.5 py-0">
                      <span className={`h-1.5 w-1.5 rounded-full ${currentSt?.dot ?? "bg-slate-400"}`} />
                      {currentSt?.shortLabel ?? "Etapa"}
                    </Badge>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Quadro Kanban de Etapas Operacionais */}
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory">
          {WORKSHOP_STAGES.filter((s) => {
            if (sectorFilter === "all") return true;
            if (s.isTerminal) return true;
            const activeFilter = SECTOR_FILTERS.find((f) => f.key === sectorFilter);
            if (activeFilter) {
              return activeFilter.stageKeys.includes(s.key);
            }
            return sectorFilter === s.key;
          }).map((stage) => {
            const items = groupedOrders.get(stage.key) ?? [];
            return (
              <DroppableStageColumn
                key={stage.key}
                stage={stage}
                items={items}
                onOpen={onOpen}
                onMoveStage={handleMoveStage}
              />
            );
          })}
        </div>

        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)" }}>
          {activeDragOrder ? (
            <div className="w-[300px] transform rotate-1 scale-[1.02] shadow-2xl ring-2 ring-primary/60 rounded-xl cursor-grabbing pointer-events-none opacity-95">
              <StageOrderCardContent
                order={activeDragOrder}
                onOpen={() => {}}
                onMoveStage={() => {}}
                isOverlay
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Modal de Pausa */}
      <Dialog
        open={pauseModal.open}
        onOpenChange={(o) => {
          if (!o) setPauseModal({ open: false, order: null, reason: "" });
        }}
      >
        <DialogContent className="w-[95vw] max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pause className="h-5 w-5 text-rose-600" /> Pausar Ordem de Produção
            </DialogTitle>
            <DialogDescription>
              {pauseModal.order ? `OS ${pauseModal.order.code}` : ""} — informe o motivo do impedimento operacional.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="pause-reason">
                Motivo do impedimento <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="pause-reason"
                autoFocus
                rows={4}
                placeholder="Ex.: Aguardando chegada de peças de reposição da concessionária, pendente autorização complementar..."
                value={pauseModal.reason}
                onChange={(e) =>
                  setPauseModal((m) => ({ ...m, reason: e.target.value }))
                }
              />
              <p className="text-[11px] text-muted-foreground">
                O histórico do percurso será preservado e a OS poderá ser retomada no mesmo setor.
              </p>
            </div>
          </div>
          <DialogFooter className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPauseModal({ open: false, order: null, reason: "" })}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="bg-rose-600 hover:bg-rose-700 text-white"
              onClick={confirmPause}
              disabled={!pauseModal.reason.trim() || updateStage.isPending}
            >
              {updateStage.isPending ? "Salvando..." : "Confirmar Pausa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Confirmação de Finalização */}
      <Dialog
        open={finalizeModal.open}
        onOpenChange={(o) => {
          if (!o && !finalize.isPending) setFinalizeModal({ open: false, order: null });
        }}
      >
        <DialogContent className="w-[95vw] max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5" /> Finalizar e Transferir para WEEKLOG
            </DialogTitle>
            <DialogDescription>
              Esta ação valida todas as tarefas operacionais e gera o registro comercial auditável no WEEKLOG.
            </DialogDescription>
          </DialogHeader>
          {finalizeModal.order ? (
            <div className="rounded-lg border border-border/70 bg-muted/40 p-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Código OS:</span>
                <span className="font-semibold">{finalizeModal.order.code}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Cliente:</span>
                <span className="font-medium">{finalizeModal.order.client_name || finalizeModal.order.clientName || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Veículo:</span>
                <span className="font-medium">{[finalizeModal.order.brand, finalizeModal.order.model].filter(Boolean).join(" ") || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Valor:</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {formatCanonicalCurrency(
                    finalizeModal.order.total ?? finalizeModal.order.total_amount ?? finalizeModal.order.recognized_total,
                    finalizeModal.order.currency || finalizeModal.order.currency_code || "EUR"
                  )}
                </span>
              </div>
            </div>
          ) : null}
          <DialogFooter className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={finalize.isPending}
              onClick={() => setFinalizeModal({ open: false, order: null })}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
              disabled={finalize.isPending}
              onClick={() => finalizeModal.order && handleFinalizeRequest(finalizeModal.order)}
            >
              {finalize.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Validando e Finalizando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" /> Confirmar Finalização
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal de Bloqueio por Validação Estrita (INV-01 a INV-06) */}
      <Dialog
        open={blockedModal.open}
        onOpenChange={(o) => {
          if (!o) setBlockedModal({ open: false, order: null, pendingTasks: [], message: "" });
        }}
      >
        <DialogContent className="w-[95vw] max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertOctagon className="h-5 w-5" /> Finalização Bloqueada — Tarefas Pendentes
            </DialogTitle>
            <DialogDescription>
              {blockedModal.order ? `OS ${blockedModal.order.code}` : ""} — Não é possível enviar a ordem à WEEKLOG com pendências operacionais.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive">
              <p className="font-semibold mb-1">
                Regra Canônica de Integridade Operacional (INV-01 a INV-06):
              </p>
              <p className="leading-relaxed">
                Todas as tarefas operacionais devem estar marcadas como concluídas e possuir a assinatura do técnico executor antes do envio à WEEKLOG. Baixas fictícias automáticas não são permitidas.
              </p>
            </div>

            <div className="space-y-2">
              <span className="font-semibold text-foreground">
                Pendências encontradas ({blockedModal.pendingTasks.length}):
              </span>
              <div className="max-h-56 overflow-y-auto space-y-1.5 rounded-lg border p-2 bg-muted/20">
                {blockedModal.pendingTasks.map((t, idx) => (
                  <div
                    key={t.id || idx}
                    className="flex items-center justify-between p-2 rounded-md bg-background border text-xs gap-2"
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium truncate">
                        {t.carPartCode || "Peça"} — {t.description || "Serviço"}
                      </span>
                      <span className="text-[10px] text-muted-foreground uppercase">
                        Categoria: {t.category || "Geral"}
                      </span>
                    </div>
                    <div>
                      {t.missingTechnician ? (
                        <Badge variant="outline" className="text-amber-600 border-amber-500/30 bg-amber-500/10 text-[10px]">
                          Sem Técnico Atribuído
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-destructive border-destructive/30 bg-destructive/10 text-[10px]">
                          {t.status === "in_progress" ? "Em Andamento" : "Pendente"}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="flex justify-between gap-2 sm:justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBlockedModal({ open: false, order: null, pendingTasks: [], message: "" })}
            >
              Fechar
            </Button>
            {blockedModal.order && (
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  const ord = blockedModal.order;
                  setBlockedModal({ open: false, order: null, pendingTasks: [], message: "" });
                  if (ord) onOpen(ord);
                }}
              >
                <Wrench className="h-3.5 w-3.5" /> Abrir Ficha Técnica da OS
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DroppableStageColumn({
  stage,
  items,
  onOpen,
  onMoveStage,
}: {
  stage: StageConfig;
  items: ProductionOrder[];
  onOpen: (o: ProductionOrder) => void;
  onMoveStage: (order: ProductionOrder, stageKey: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: stage.key,
  });
  const Icon = stage.icon;

  return (
    <div
      ref={setNodeRef}
      className={`flex min-w-[290px] max-w-[340px] shrink-0 snap-start flex-col rounded-xl border p-3 transition-all duration-200 ${
        isOver
          ? "border-primary ring-2 ring-primary/50 bg-primary/5 shadow-md"
          : "border-border/70 bg-card/60 dark:bg-slate-900/40"
      }`}
    >
      <div className="sticky top-0 z-20 mb-3 flex items-start justify-between gap-2 rounded-lg bg-card border border-border/80 px-3 py-2.5 shadow-xs">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${stage.accent}`}>
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 shrink-0 rounded-full ${stage.dot}`} />
              <h3 className="text-sm font-semibold leading-none tracking-tight">
                {stage.label}
              </h3>
            </div>
            <p className="mt-1 truncate text-[10px] text-muted-foreground">
              {stage.description}
            </p>
          </div>
        </div>
        <Badge variant="secondary" className="shrink-0 text-xs tabular-nums">
          {items.length}
        </Badge>
      </div>

      <div className="space-y-3 overflow-y-auto max-h-[calc(100vh-270px)] pr-1 min-h-[160px]">
        {items.map((o) => (
          <DraggableStageOrderCard
            key={o.id}
            order={o}
            onOpen={onOpen}
            onMoveStage={(target) => onMoveStage(o, target)}
          />
        ))}
        {items.length === 0 && (
          <div className="py-12 text-center text-xs text-muted-foreground/70 border-2 border-dashed border-border/40 rounded-lg">
            Nenhum veículo nesta etapa
          </div>
        )}
      </div>
    </div>
  );
}

function DraggableStageOrderCard({
  order,
  onOpen,
  onMoveStage,
}: {
  order: ProductionOrder;
  onOpen: (o: ProductionOrder) => void;
  onMoveStage: (target: string) => void;
}) {
  const locked = isOrderLocked(order.status);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: order.id,
    disabled: locked,
    data: { order },
  });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`touch-none ${isDragging ? "opacity-30 scale-95 transition-opacity" : "transition-transform"}`}
      {...attributes}
      {...listeners}
    >
      <StageOrderCardContent
        order={order}
        onOpen={onOpen}
        onMoveStage={onMoveStage}
        isDragging={isDragging}
      />
    </div>
  );
}

function StageOrderCardContent({
  order,
  onOpen,
  onMoveStage,
  isDragging,
  isOverlay,
}: {
  order: ProductionOrder;
  onOpen: (o: ProductionOrder) => void;
  onMoveStage: (target: string) => void;
  isDragging?: boolean;
  isOverlay?: boolean;
}) {
  const safePriority = PRIORITY_META[order.priority as ProductionPriority] ?? PRIORITY_META.normal;
  const currentStageKey = getEffectiveStage(order);
  const currentStageMeta = STAGE_MAP.get(currentStageKey);
  const locked = isOrderLocked(order.status);

  const clientName = order.client_name || order.clientName || "—";
  const vehicle = [order.brand, order.model].filter(Boolean).join(" ") || "—";
  const licensePlate = order.license_plate || order.licensePlate || order.vin || "—";
  const operationalSite = order.operational_site_key || order.operationalSiteKey || null;

  const budgetCode = order.budget_code || order.budgetCode || null;
  const displayNumber = budgetCode ? `Devis ${budgetCode}` : `OS ${order.code || "—"}`;

  const rawTotal = order.total ?? order.total_amount ?? order.recognized_total ?? null;
  const currency = order.currency || order.currency_code || "EUR";
  const formattedTotal = formatCanonicalCurrency(rawTotal, currency);

  let tipoServico = "Serviço Operacional";
  if (Array.isArray(order.performed_services) && order.performed_services.length > 0) {
    tipoServico = `${order.performed_services.length} serviço(s) na OS`;
  } else if (order.insurer) {
    tipoServico = order.insurer;
  } else if (budgetCode) {
    tipoServico = "Orçamento Aprovado";
  }

  const dataISO = order.started_at || order.due_at || order.created_at;
  const isOverdue = !!order.due_at && new Date(order.due_at).getTime() < Date.now() && !locked;

  // Roteiro Recomendado
  const route: string[] = order.recommendedRoute || (order as any).recommended_route || [];
  const currentIdx = route.indexOf(currentStageKey);
  const nextRecommendedStage = currentIdx > -1 && currentIdx + 1 < route.length ? route[currentIdx + 1] : null;

  return (
    <Card
      onClick={() => {
        if (!isDragging && !isOverlay) onOpen(order);
      }}
      className={`space-y-3 overflow-hidden border-border/70 p-3 transition-all select-none ${
        isOverlay
          ? "border-primary bg-card shadow-2xl"
          : locked
          ? "opacity-85 cursor-pointer bg-card/90"
          : "cursor-grab active:cursor-grabbing hover:border-primary/50 hover:shadow-md bg-card"
      }`}
    >
      {/* Cabeçalho do Card */}
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
            <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${safePriority.tone}`}>
              {safePriority.label}
            </Badge>
          ) : null}
          <Badge
            variant="outline"
            className={`text-[10px] px-1.5 py-0 ${currentStageMeta?.accent ?? "bg-muted text-muted-foreground"}`}
          >
            {currentStageMeta?.shortLabel ?? currentStageKey}
          </Badge>
        </div>
      </div>

      {/* Rota Recomendada do Veículo */}
      {route.length > 0 && (
        <div className="rounded-md bg-muted/40 p-1.5 border border-border/40 text-[10px] space-y-1">
          <div className="flex items-center justify-between text-muted-foreground font-medium">
            <span>Roteiro do Veículo:</span>
            {nextRecommendedStage && (
              <span className="text-primary font-semibold">
                Próximo: {STAGE_MAP.get(nextRecommendedStage)?.shortLabel || nextRecommendedStage}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 overflow-x-auto py-0.5 no-scrollbar">
            {route.map((stKey, idx) => {
              const st = STAGE_MAP.get(stKey);
              const isCurrent = stKey === currentStageKey;
              const isPast = currentIdx > -1 && idx < currentIdx;
              return (
                <React.Fragment key={stKey}>
                  {idx > 0 && <span className="text-muted-foreground/40 text-[9px]">→</span>}
                  <span
                    className={`shrink-0 rounded px-1 py-0.2 text-[9px] font-medium ${
                      isCurrent
                        ? "bg-primary text-primary-foreground font-bold"
                        : isPast
                        ? "text-muted-foreground/70 line-through"
                        : "text-muted-foreground bg-muted/80"
                    }`}
                  >
                    {st?.shortLabel || stKey}
                  </span>
                </React.Fragment>
              );
            })}
          </div>
        </div>
      )}

      {/* Informações se Pausado */}
      {order.status === "paused" && (order.pausedReason || (order as any).paused_reason) && (
        <div className="rounded-md bg-rose-500/10 border border-rose-500/20 p-1.5 text-[10px] text-rose-700 dark:text-rose-400">
          <strong>Impedimento:</strong> {order.pausedReason || (order as any).paused_reason}
        </div>
      )}

      {/* Dados do Veículo e Cliente */}
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
        {operationalSite && (
          <InfoLine icon={ClipboardList} label="Site" value={operationalSite} />
        )}
        <InfoLine
          icon={Coins}
          label="Valor"
          value={formattedTotal}
          valueClassName={rawTotal != null ? "text-emerald-700 dark:text-emerald-400 font-semibold" : undefined}
        />
        <InfoLine
          icon={isOverdue ? AlertTriangle : CalendarDays}
          label={isOverdue ? "Atrasado" : "Data"}
          value={
            isOverdue && order.due_at
              ? formatDistanceToNow(new Date(order.due_at), { addSuffix: true, locale: ptBR })
              : formatDate(dataISO)
          }
          valueClassName={isOverdue ? "font-medium text-destructive" : undefined}
          iconClassName={isOverdue ? "text-destructive" : undefined}
        />
      </div>

      {/* Rodapé e Ações */}
      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground truncate">
          <Clock3 className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {order.updated_at
              ? formatDistanceToNow(new Date(order.updated_at), { addSuffix: true, locale: ptBR })
              : "—"}
          </span>
        </div>

        <div
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {locked ? (
            <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30 gap-1">
              <Lock className="h-2.5 w-2.5" /> Bloqueado
            </Badge>
          ) : (
            <Popover>
              <PopoverTrigger asChild>
                <Button size="sm" variant="secondary" className="h-7 gap-1 px-2 text-[11px]">
                  Mover Etapa
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-56 p-2 z-50">
                <div className="space-y-1.5 text-xs">
                  <p className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Avançar no Fluxo
                  </p>
                  <div className="flex flex-col gap-1">
                    {/* Próxima etapa recomendada destacada */}
                    {nextRecommendedStage && nextRecommendedStage !== currentStageKey && (
                      <Button
                        size="sm"
                        variant="default"
                        className="justify-start h-8 px-2 text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
                        onClick={() => onMoveStage(nextRecommendedStage)}
                      >
                        <ArrowRight className="h-3 w-3 mr-1" />
                        Avançar: {STAGE_MAP.get(nextRecommendedStage)?.shortLabel}
                      </Button>
                    )}

                    {/* Demais etapas */}
                    {WORKSHOP_STAGES.filter(
                      (s) => s.key !== currentStageKey && s.key !== nextRecommendedStage
                    ).map((st) => (
                      <Button
                        key={st.key}
                        size="sm"
                        variant="ghost"
                        className="justify-start h-7 px-2 text-xs"
                        onClick={() => onMoveStage(st.key)}
                      >
                        <span className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${st.dot}`} />
                          {st.label}
                        </span>
                      </Button>
                    ))}
                  </div>
                </div>
              </PopoverContent>
            </Popover>
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
      <Icon className={`mt-[2px] h-3 w-3 shrink-0 text-muted-foreground/70 ${iconClassName ?? ""}`} />
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
        {label}:
      </span>
      <span className={`truncate text-foreground/90 ${valueClassName ?? "font-medium"}`}>
        {value}
      </span>
    </div>
  );
}
