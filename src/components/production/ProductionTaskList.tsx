import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Wrench,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Play,
  CheckCheck,
  Camera,
  Eye,
  MapPin,
  Pause,
} from "lucide-react";
import { VehicleBlueprint5Views, type DamagePointData } from "./VehicleBlueprint5Views";
import { apiRequest } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface ProductionTaskItem {
  id: string;
  productionOrderId: string;
  workspaceId: string;
  serviceCategory: string; // pdr, assembly_disassembly, paint, bodywork
  carPartCode: string;
  description: string;
  commercialAmount: string | number;
  currencyCode: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  primaryTechnicianId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  completionNotes?: string | null;
  afterPhotoPath?: string | null;
}

interface ProductionTaskListProps {
  orderId: string;
  tasks: ProductionTaskItem[];
  inspectionDamagePoints?: DamagePointData[];
  onTaskUpdated?: () => void;
  canEdit?: boolean;
}

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  pdr: { label: "Martelinho (PDR)", color: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  assembly_disassembly: { label: "Montagem / Desmontagem", color: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  paint: { label: "Pintura", color: "bg-purple-500/10 text-purple-600 border-purple-500/20" },
  bodywork: { label: "Funilaria", color: "bg-orange-500/10 text-orange-600 border-orange-500/20" },
};

export function ProductionTaskList({
  orderId,
  tasks,
  inspectionDamagePoints = [],
  onTaskUpdated,
  canEdit = true,
}: ProductionTaskListProps) {
  const [showBlueprint, setShowBlueprint] = useState(false);
  const [loadingTaskId, setLoadingTaskId] = useState<string | null>(null);

  const handleUpdateStatus = async (taskId: string, newStatus: ProductionTaskItem["status"]) => {
    try {
      setLoadingTaskId(taskId);
      await apiRequest(`/production-orders/${orderId}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      toast.success(
        newStatus === "in_progress"
          ? "Serviço iniciado."
          : newStatus === "completed"
          ? "Serviço marcado como concluído!"
          : "Status atualizado."
      );
      onTaskUpdated?.();
    } catch (err: any) {
      toast.error(err?.message || "Falha ao atualizar tarefa.");
    } finally {
      setLoadingTaskId(null);
    }
  };

  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const progressPct = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Cabeçalho Operacional da Ficha Técnica */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/20 p-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Ficha Técnica Operacional do Técnico</span>
            <Badge variant="outline" className="text-xs">
              {completedCount} de {tasks.length} concluídos ({progressPct}%)
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Acompanhamento de chão de fábrica por componente e apontamento de execução em tempo real.
          </p>
        </div>

        {inspectionDamagePoints.length > 0 && (
          <Button
            size="sm"
            variant={showBlueprint ? "default" : "outline"}
            className="gap-1.5 text-xs"
            onClick={() => setShowBlueprint(!showBlueprint)}
          >
            <Eye className="h-3.5 w-3.5" />
            {showBlueprint ? "Ocultar Blueprint 5 Vistas" : "Ver Blueprint de Danos do Orçamento"}
          </Button>
        )}
      </div>

      {/* Blueprint Visual Sob Demanda */}
      {showBlueprint && inspectionDamagePoints.length > 0 && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 w-full min-w-0 max-w-full overflow-hidden">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold text-primary">
              Mapa de Danos do Veículo (Somente Leitura para Orientação Técnica)
            </span>
            <Badge variant="secondary" className="text-[11px]">
              {inspectionDamagePoints.length} pontos mapeados
            </Badge>
          </div>
          <VehicleBlueprint5Views damagePoints={inspectionDamagePoints} readOnly />
        </div>
      )}

      {/* Lista de Tarefas / Intervenções */}
      {tasks.length === 0 ? (
        <div className="flex min-h-[140px] flex-col items-center justify-center rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
          <Wrench className="mb-2 h-6 w-6 text-muted-foreground/60" />
          <span>Nenhuma intervenção estruturada cadastrada para esta ordem de produção.</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {tasks.map((task) => {
            const meta = CATEGORY_META[task.serviceCategory] || {
              label: task.serviceCategory,
              color: "bg-muted text-muted-foreground",
            };
            const isCompleted = task.status === "completed";
            const isInProgress = task.status === "in_progress";
            const isLoading = loadingTaskId === task.id;

            return (
              <Card
                key={task.id}
                className={cn(
                  "transition-all",
                  isCompleted && "border-emerald-500/40 bg-emerald-500/5",
                  isInProgress && "border-blue-500/50 bg-blue-500/5"
                )}
              >
                <CardHeader className="flex flex-row items-start justify-between space-y-0 p-3 pb-2">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{task.description}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Badge variant="outline" className={cn("text-[10px] px-2 py-0 border", meta.color)}>
                        {meta.label}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Peça: <strong className="text-foreground">{task.carPartCode}</strong>
                      </span>
                    </div>
                  </div>

                  <Badge
                    variant="outline"
                    className={cn(
                      "text-xs capitalize",
                      isCompleted && "bg-emerald-500 text-white border-transparent",
                      isInProgress && "bg-blue-600 text-white border-transparent",
                      task.status === "blocked" && "bg-amber-500 text-white border-transparent"
                    )}
                  >
                    {isCompleted
                      ? "Concluído"
                      : isInProgress
                      ? "Em Andamento"
                      : task.status === "blocked"
                      ? "Impedimento / Pausado"
                      : "Pendente"}
                  </Badge>
                </CardHeader>

                <CardContent className="p-3 pt-1">
                  <div className="flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
                    <span>
                      Valor Comercial:{" "}
                      <strong className="text-foreground">
                        {Number(task.commercialAmount).toFixed(2)} {task.currencyCode}
                      </strong>
                    </span>

                    {/* Ações do Técnico no Chão de Fábrica */}
                    {canEdit && (
                      <div className="flex items-center gap-1.5">
                        {!isCompleted && !isInProgress && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 px-2 text-xs"
                            disabled={isLoading}
                            onClick={() => handleUpdateStatus(task.id, "in_progress")}
                          >
                            <Play className="h-3 w-3 text-blue-500" />
                            Iniciar
                          </Button>
                        )}

                        {isInProgress && (
                          <Button
                            size="sm"
                            className="h-7 gap-1 bg-emerald-600 px-2 text-xs hover:bg-emerald-700 text-white"
                            disabled={isLoading}
                            onClick={() => handleUpdateStatus(task.id, "completed")}
                          >
                            <CheckCheck className="h-3 w-3" />
                            Concluir
                          </Button>
                        )}

                        {isCompleted && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                            disabled={isLoading}
                            onClick={() => handleUpdateStatus(task.id, "in_progress")}
                          >
                            Reabrir
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
