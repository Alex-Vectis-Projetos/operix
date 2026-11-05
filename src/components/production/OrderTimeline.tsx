import { useProductionTimeline } from "@/hooks/useProductionOrders";
import { Activity, ArrowRight, Camera, UserPlus, AlertCircle, Edit3, Pause, Play, CheckCircle2, Clock, FileCheck } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

interface Props { orderId: string; }

const ICONS: Record<string, any> = {
  budget_approved: FileCheck,
  created: Activity,
  status_changed: ArrowRight,
  stage_changed: ArrowRight,
  in_production: Play,
  assigned: UserPlus,
  photo_added: Camera,
  priority_changed: AlertCircle,
  field_updated: Edit3,
  finalized: CheckCircle2,
  weeklog_entry: Clock,
  rectification_requested: AlertCircle,
};

export function OrderTimeline({ orderId }: Props) {
  const { data: events = [], isLoading } = useProductionTimeline(orderId);
  if (isLoading) return <div className="text-sm text-muted-foreground">Carregando histórico…</div>;
  if (!events.length) return <div className="text-sm text-muted-foreground">Sem eventos.</div>;

  return (
    <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
      {events.map((e: any, idx: number) => {
        const Icon = iconFor(e);
        const eventId = e.id || `${e.type || e.event_type}-${idx}`;
        const eventTime = e.created_at || e.timestamp || e.createdAt;
        const actorName = e.actor_name || e.actorName || (e.actorId ? `Usuário (${e.actorId.slice(0, 8)})` : "Sistema");

        return (
          <div key={eventId} className="flex gap-3 text-sm">
            <div className="flex flex-col items-center">
              <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center">
                <Icon className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="w-px flex-1 bg-border/60 mt-1" />
            </div>
            <div className="flex-1 pb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-foreground">{actorName}</span>
                <span className="text-muted-foreground">{labelFor(e)}</span>
              </div>
              {eventTime && (
                <div className="text-xs text-muted-foreground">
                  {new Date(eventTime).toLocaleString("pt-PT")} · {formatDistanceToNow(new Date(eventTime), { addSuffix: true, locale: ptBR })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function labelFor(e: any) {
  const type = e.event_type || e.type;
  switch (type) {
    case "budget_approved":
      return `aprovou o orçamento ${e.metadata?.budgetCode ? `(${e.metadata.budgetCode})` : ""} originando esta ordem de produção`;
    case "created":
      return `criou a ordem de produção (${statusLabel(e.to_value || e.metadata?.status)})`;
    case "in_production":
      return "iniciou a produção do veículo";
    case "status_changed":
      return statusActionLabel(e.from_value || e.metadata?.from, e.to_value || e.metadata?.to);
    case "stage_changed":
      return `moveu etapa: ${e.metadata?.from ?? "—"} → ${e.metadata?.to ?? "—"}${e.metadata?.reason ? ` (${e.metadata.reason})` : ""}`;
    case "assigned":
      return `atribuiu para ${e.to_value ?? e.metadata?.technicianName ?? "—"}`;
    case "photo_added":
      return `enviou foto (${photoLabel(e.to_value || e.metadata?.category)})`;
    case "weeklog_entry":
      return `registrou apontamento na WEEKLOG${e.metadata?.totalAmount != null ? ` (${Number(e.metadata.totalAmount).toFixed(2)} €)` : ""}`;
    case "rectification_requested":
      return `solicitou retificação de apontamento${e.metadata?.rectificationReason ? `: "${e.metadata.rectificationReason}"` : ""}`;
    case "reopened":
      return `reabriu a ordem para retificação (Execução #${e.metadata?.executionSequence ?? 2})`;
    case "priority_changed":
      return `alterou prioridade: ${e.from_value} → ${e.to_value}`;
    case "finalized":
      return "finalizou a ordem de produção";
    case "field_updated":
      if (e.to_value === "minimized") return "minimizou a ordem (continua ativa)";
      if (e.to_value === "resumed") return "retomou a ordem";
      return "editou dados da ordem";
    default:
      return type || "evento";
  }
}

function iconFor(e: any) {
  const type = e.event_type || e.type;
  if (type === "status_changed" || type === "stage_changed") {
    const to = e.to_value || e.metadata?.to;
    const from = e.from_value || e.metadata?.from;
    if (to === "paused") return Pause;
    if (from === "paused" && to === "in_production") return Play;
    if (to === "finished") return CheckCircle2;
  }
  return ICONS[type] ?? Activity;
}

function statusActionLabel(from?: string | null, to?: string | null) {
  if (to === "paused") return "pausou a ordem";
  if (from === "paused" && to === "in_production") return "retomou a ordem";
  if (to === "finished") return "finalizou a ordem";
  return `alterou status: ${statusLabel(from)} → ${statusLabel(to)}`;
}

function statusLabel(value?: string | null) {
  const labels: Record<string, string> = {
    new_vehicle: "Novo Veículo",
    triage: "Em Triagem",
    awaiting_validation: "Aguardando Validação",
    in_production: "Em Produção",
    paused: "Pausado",
    finished: "Finalizado",
    invoiced: "Faturado",
    delivered: "Entregue",
  };
  return value ? labels[value] ?? value : "—";
}

function photoLabel(value?: string | null) {
  const labels: Record<string, string> = { before: "Antes", during: "Durante", after: "Depois", damage: "Danos", validation: "Validação" };
  return value ? labels[value] ?? value : "—";
}
