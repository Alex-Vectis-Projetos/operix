import { useEffect, useMemo, useState } from "react";
import { useServiceOrders } from "@/hooks/useServiceOrders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  FileText, Trash2, CheckCircle2, Car, User,
  Calendar, DollarSign, ExternalLink, Pencil,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useLanguage } from "@/hooks/useLanguage";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import type { ProductionOrder } from "@/hooks/useProductionOrders";

export const PRODUCTION_DRAFT_PREFIX = "production-draft-new-";

interface ProductionDraft {
  draftId: string;
  data: Partial<ProductionOrder>;
}

const LEGACY_DRAFT_KEY = "production-draft-new";

function hasMeaningfulData(data: Partial<ProductionOrder>): boolean {
  return !!(
    data.license_plate || data.client_name || data.brand ||
    data.model || data.platform || data.insurer || data.vin
  );
}

function readProductionDrafts(): ProductionDraft[] {
  const drafts: ProductionDraft[] = [];
  try {
    // Migrate legacy single-draft key to new format
    const legacyRaw = localStorage.getItem(LEGACY_DRAFT_KEY);
    if (legacyRaw) {
      try {
        const parsed = JSON.parse(legacyRaw);
        if (parsed && typeof parsed === "object" && hasMeaningfulData(parsed)) {
          const migratedId = crypto.randomUUID();
          localStorage.setItem(`${PRODUCTION_DRAFT_PREFIX}${migratedId}`, legacyRaw);
        }
      } catch { /* ignore */ }
      localStorage.removeItem(LEGACY_DRAFT_KEY);
    }

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PRODUCTION_DRAFT_PREFIX)) continue;
      const draftId = key.slice(PRODUCTION_DRAFT_PREFIX.length);
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && hasMeaningfulData(parsed)) {
          drafts.push({ draftId, data: parsed });
        }
      } catch { /* ignore corrupt entry */ }
    }
  } catch { /* ignore */ }
  return drafts;
}

interface Props {
  onResumeProductionDraft?: (draftId: string) => void;
  refreshKey?: number;
}

export function DraftsPanel({ onResumeProductionDraft, refreshKey = 0 }: Props) {
  const { formatCurrency } = useLanguage();
  const navigate = useNavigate();
  const { data: allOrders = [], isLoading } = useServiceOrders({});
  const [productionDrafts, setProductionDrafts] = useState<ProductionDraft[]>([]);
  const [discardingDraftId, setDiscardingDraftId] = useState<string | null>(null);

  useEffect(() => {
    setProductionDrafts(readProductionDrafts());
  }, [refreshKey]);

  const discardProductionDraft = (draftId: string) => {
    localStorage.removeItem(`${PRODUCTION_DRAFT_PREFIX}${draftId}`);
    setProductionDrafts((prev) => prev.filter((d) => d.draftId !== draftId));
    setDiscardingDraftId(null);
    toast.message("Rascunho descartado.");
  };

  const drafts = useMemo(
    () => allOrders.filter((o: any) => o.status === "draft"),
    [allOrders],
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (drafts.length === 0 && productionDrafts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-muted-foreground">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/50">
          <FileText className="h-6 w-6 opacity-40" />
        </div>
        <p className="text-sm font-medium">Nenhum rascunho pendente</p>
        <p className="text-xs opacity-60">
          Ordens criadas ou importadas e ainda não salvas aparecerão aqui.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* Production order drafts (localStorage) */}
      {productionDrafts.length > 0 && (
        <div className="mb-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {productionDrafts.length === 1 ? "Nova ordem em edição" : `${productionDrafts.length} novas ordens em edição`}
          </p>
          <div className="space-y-2">
            {productionDrafts.map(({ draftId, data }) => (
              <Card
                key={draftId}
                className="border-amber-500/40 bg-amber-500/5 transition-all hover:border-amber-500/60"
              >
                <CardContent className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className="shrink-0 border-amber-500/40 bg-amber-500/10 text-amber-600 text-[10px]"
                        >
                          Não salva
                        </Badge>
                        <span className="truncate text-sm font-semibold">
                          {data.license_plate || data.client_name || "Ordem sem identificação"}
                          {data.brand ? ` · ${data.brand}` : ""}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {data.client_name && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />{data.client_name}
                          </span>
                        )}
                        {data.platform && (
                          <span className="flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" />{data.platform}
                          </span>
                        )}
                        {data.model && (
                          <span className="flex items-center gap-1">
                            <Car className="h-3 w-3" />{data.model}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1.5 px-2.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={() => setDiscardingDraftId(draftId)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Descartar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 px-3 text-xs border-amber-500/40 text-amber-600 hover:bg-amber-500/10"
                        onClick={() => onResumeProductionDraft?.(draftId)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Continuar
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Service orders from DB with status=draft */}
      {drafts.length > 0 && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">
                {drafts.length}{" "}
                {drafts.length === 1
                  ? "ordem de serviço aguardando confirmação"
                  : "ordens de serviço aguardando confirmação"}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => navigate("/service-orders")}
            >
              <ExternalLink className="h-3 w-3" />
              Ver todas as OS
            </Button>
          </div>

          <div className="space-y-3">
            {drafts.map((order: any) => {
              const services = [
                order.service_1_name,
                order.service_2_name,
                order.service_3_name,
                order.service_4_name,
              ].filter(Boolean);

              return (
                <Card key={order.id} className="transition-all hover:border-primary/30 hover:shadow-sm">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Badge variant="outline" className="shrink-0 bg-muted/60 text-muted-foreground text-[10px]">
                          Rascunho
                        </Badge>
                        <CardTitle className="truncate text-sm font-semibold">
                          {order.license_plate || "Sem placa"}
                          {order.car_name ? ` · ${order.car_name}` : ""}
                        </CardTitle>
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {order.created_at
                          ? formatDistanceToNow(new Date(order.created_at), { locale: ptBR, addSuffix: true })
                          : "—"}
                      </span>
                    </div>
                  </CardHeader>

                  <CardContent className="space-y-2 px-4 pb-3">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {order.client_name && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" /> {order.client_name}
                        </span>
                      )}
                      {order.technician_name && (
                        <span className="flex items-center gap-1">
                          <Car className="h-3 w-3" /> {order.technician_name}
                        </span>
                      )}
                      {order.week && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" /> Semana {order.week}
                        </span>
                      )}
                      {order.platform && (
                        <span className="flex items-center gap-1">
                          <ExternalLink className="h-3 w-3" /> {order.platform}
                        </span>
                      )}
                    </div>

                    {services.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {services.map((s, i) => (
                          <Badge key={i} variant="secondary" className="px-1.5 py-0 text-[10px]">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
                        <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                        {order.total != null ? formatCurrency(order.total) : "—"}
                      </span>
                      <Badge variant="outline" className="text-[10px] text-muted-foreground border-border/70">
                        Histórico · Somente Leitura
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* Discard production draft dialog */}
      <AlertDialog open={!!discardingDraftId} onOpenChange={(o) => !o && setDiscardingDraftId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar rascunho?</AlertDialogTitle>
            <AlertDialogDescription>
              O rascunho será removido permanentemente. Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
              onClick={() => discardingDraftId && discardProductionDraft(discardingDraftId)}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
