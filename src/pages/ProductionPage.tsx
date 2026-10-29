import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, LayoutGrid, Calculator, RefreshCw, AlertTriangle } from "lucide-react";
import { ProductionBoard } from "@/components/production/ProductionBoard";
import { OrderDetailDialog } from "@/components/production/OrderDetailDialog";
import { BudgetPanel } from "@/components/production/BudgetPanel";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import type { ProductionOrder } from "@/hooks/useProductionOrders";
import { useLanguage } from "@/hooks/useLanguage";
import { useWorkspace } from "@/hooks/useWorkspace";

const BLANK: ProductionOrder = {
  id: "__new__", workspace_id: "", code: "", client_id: null, client_name: null,
  technician_user_id: null, technician_name: null, platform: null, insurer: null,
  license_plate: null, vin: null, brand: null, model: null, color: null, notes: null,
  priority: "normal", status: "in_production", due_at: null, started_at: null,
  finished_at: null, delivered_at: null, service_order_id: null, created_by: "",
  created_at: "", updated_at: "",
};

export default function ProductionPage() {
  const { t } = useLanguage();
  const { workspaceId } = useWorkspace();
  const [open, setOpen] = useState<ProductionOrder | null>(null);
  const [orderKeyCounter, setOrderKeyCounter] = useState(0);

  const handleDialogClose = () => {
    setOpen(null);
  };

  const openNewOrder = () => {
    setOrderKeyCounter((c) => c + 1);
    setOpen({ ...BLANK, workspace_id: workspaceId ?? "" });
  };

  return (
    <ErrorBoundary
      fallback={
        <div className="min-w-0 max-w-full space-y-4 md:space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight md:text-2xl">
                {t("nav.production", "Produção")}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t("production.subtitle", "Pipeline operacional de veículos em tempo real.")}
              </p>
            </div>
            <Button
              onClick={() => window.location.reload()}
              variant="outline"
              className="h-11 w-full gap-2 sm:w-auto md:h-10"
            >
              <RefreshCw className="h-4 w-4" /> Tentar novamente
            </Button>
          </div>

          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-destructive/40 bg-destructive/5 p-10 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <AlertTriangle className="h-7 w-7" />
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {t("production.pageError", "Erro ao carregar a página de Produção.")}
            </h2>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
              O menu e navegação permanecem disponíveis. Você pode mudar de página ou tentar novamente.
              <br />
              <span className="text-xs">
                Le menu et la navigation restent disponibles. Vous pouvez changer de page ou réessayer.
              </span>
            </p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button onClick={() => window.location.reload()} className="gap-2">
                <RefreshCw className="h-4 w-4" /> Recarregar Produção
              </Button>
              <Button variant="outline" onClick={() => window.history.back()} className="gap-2">
                Voltar
              </Button>
            </div>
            <p className="mt-6 text-[11px] text-muted-foreground/80">
              Orçamentos · Em Produção · Rascunhos — novas abas serão liberadas após recarga bem-sucedida.
            </p>
          </div>
        </div>
      }
    >
    <div className="min-w-0 max-w-full space-y-4 md:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight md:text-2xl">{t("nav.production", "Produção")}</h1>
          <p className="text-sm text-muted-foreground">{t("production.subtitle", "Pipeline operacional de veículos em tempo real.")}</p>
        </div>
      </div>

      <Tabs defaultValue="budgets" className="min-w-0 max-w-full">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 md:inline-flex md:w-auto">
          <TabsTrigger value="budgets" className="min-h-10 gap-1.5 px-2 text-xs md:text-sm">
            <Calculator className="h-4 w-4" />
            <span className="truncate">Orçamentos</span>
          </TabsTrigger>
          <TabsTrigger value="board" className="min-h-10 gap-1.5 px-2 text-xs md:text-sm">
            <LayoutGrid className="h-4 w-4" />
            <span className="truncate">Em Produção</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="budgets" className="mt-4">
          <BudgetPanel onOpenOrder={(order) => { setOpen(order); }} />
        </TabsContent>
        <ErrorBoundary
          fallback={
            <div className="mt-4 flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-amber-400/40 bg-amber-500/5 p-8 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <h3 className="text-base font-semibold text-foreground">
                {t("production.kanbanError", "Kanban Em Produção indisponível no momento")}
              </h3>
              <p className="mt-2 max-w-md text-xs text-muted-foreground">
                Tente novamente em instantes — a aba Orçamentos continua disponível.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-4 gap-2"
                onClick={() => window.location.reload()}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Recarregar
              </Button>
            </div>
          }
        >
          <TabsContent value="board" className="mt-4 space-y-4">
            <div className="flex justify-end">
              <Button onClick={openNewOrder} className="h-11 w-full gap-2 sm:w-auto md:h-10">
                <Plus className="h-4 w-4" /> {t("production.newOrder", "Nova Ordem")}
              </Button>
            </div>
            <ProductionBoard onOpen={setOpen} />
          </TabsContent>
        </ErrorBoundary>
      </Tabs>

      <ErrorBoundary
        key={open ? `${open.id}-${orderKeyCounter}` : "closed"}
        fallback={
          <div className="hidden" aria-hidden>
            OrderDetailDialog temporarily unavailable
          </div>
        }
      >
        {open && <OrderDetailDialog order={open} onClose={handleDialogClose} />}
      </ErrorBoundary>
    </div>
    </ErrorBoundary>
  );
}
