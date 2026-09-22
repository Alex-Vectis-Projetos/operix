import { useMemo, useState } from "react";
import { ClipboardList, FolderTree, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  HierarchyExplorer,
  applyHierarchyContext,
  loadHierarchyContext,
  type HierarchyContext,
} from "@/components/shared/HierarchyExplorer";
import { PaymentOrdersTable } from "@/components/payment-orders/PaymentOrdersTable";
import { EmbeddedFileManager } from "@/components/file-manager/EmbeddedFileManager";
import { SectionPlaceholder } from "@/components/shared/SectionPlaceholder";
import { usePaymentOrders } from "@/hooks/usePaymentOrders";
import { useLanguage } from "@/hooks/useLanguage";
import { useContextualWorkspace } from "@/hooks/useContextualWorkspace";
import { ContextualWorkspacePicker } from "@/components/workspace/ContextualWorkspacePicker";

/**
 * Compatibility view for the one-way legacy PaymentOrder projection.
 * T11 owns the canonical PaymentList import and confrontation interfaces.
 */
export default function PaymentOrdersPage() {
  const { t } = useLanguage();
  const { data: orders = [], isLoading } = usePaymentOrders({});
  const ctxWs = useContextualWorkspace("payment_orders");
  const [hCtx, setHCtx] = useState<HierarchyContext>(() => loadHierarchyContext("hierarchy.payment_orders"));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem("hierarchy.payment_orders.collapsed") === "1"; } catch { return false; }
  });
  const [treeOpen, setTreeOpen] = useState(false);
  const visibleOrders = useMemo(() => applyHierarchyContext(orders as never[], hCtx), [orders, hCtx]);

  const handleHierarchyContextChange = (context: HierarchyContext) => {
    setHCtx(context);
    setTreeOpen(false);
  };

  return (
    <div className="animate-fade-in flex min-h-full w-full min-w-0 flex-col gap-3 overflow-visible md:gap-2">
      <header className="sticky top-0 z-30 -mx-3 flex shrink-0 flex-col gap-3 border-b border-border/40 bg-background/95 px-3 pb-3 pt-1 backdrop-blur sm:-mx-4 sm:px-4 md:static md:mx-0 md:flex-row md:items-center md:justify-between md:bg-transparent md:px-1 md:pb-2 md:pt-0 md:backdrop-blur-none">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Wallet className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground truncate">LISTA</h1>
            <p className="text-[11px] text-muted-foreground truncate">{t("po.subtitle") || "Projeção histórica somente leitura"}</p>
          </div>
        </div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 md:flex md:items-center">
          <Button variant="outline" size="icon" className="h-11 w-11 md:hidden" onClick={() => setTreeOpen(true)} aria-label="Abrir contexto operacional">
            <FolderTree className="h-4 w-4" />
          </Button>
          <ContextualWorkspacePicker ctx={ctxWs} />
        </div>
      </header>

      <p className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        Importação, revisão e liquidação comercial usam o fluxo canônico de Listas de Pagamento. A interface desse fluxo será entregue no T11.
      </p>

      <Sheet open={treeOpen} onOpenChange={setTreeOpen}>
        <SheetContent side="left" className="w-[min(22rem,calc(100vw-1rem))] p-0">
          <HierarchyExplorer records={orders as never[]} storageKey="hierarchy.payment_orders" context={hCtx} onContextChange={handleHierarchyContextChange} weekIcon={ClipboardList} defaultAllCollapsed />
        </SheetContent>
      </Sheet>

      <div className="flex min-h-0 w-full flex-1 gap-3 overflow-visible md:overflow-hidden">
        <aside className={`hidden md:flex shrink-0 transition-[width] duration-200 ${sidebarCollapsed ? "w-12" : "w-56"}`}>
          <HierarchyExplorer
            records={orders as never[]}
            storageKey="hierarchy.payment_orders"
            context={hCtx}
            onContextChange={setHCtx}
            collapsible
            collapsed={sidebarCollapsed}
            onCollapsedChange={setSidebarCollapsed}
            weekIcon={ClipboardList}
            defaultAllCollapsed
          />
        </aside>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-visible md:overflow-auto">
          {hCtx.section === "documentos" ? (
            <EmbeddedFileManager entityType="payment_order" module="orders" year={hCtx.year ?? null} />
          ) : hCtx.section === "relatorios" ? (
            <SectionPlaceholder icon="chart" title="Relatórios" subtitle={hCtx.year ? `Ano ${hCtx.year}` : undefined} hint="Relatórios automáticos serão disponibilizados em breve." />
          ) : (
            <PaymentOrdersTable orders={visibleOrders} isLoading={isLoading} />
          )}
        </div>
      </div>
    </div>
  );
}
