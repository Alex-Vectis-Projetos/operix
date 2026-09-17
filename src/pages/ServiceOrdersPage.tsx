import { useState, useCallback, useMemo } from "react";
import { ClipboardList, FolderTree, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  HierarchyExplorer,
  applyHierarchyContext,
  loadHierarchyContext,
  type HierarchyContext,
} from "@/components/shared/HierarchyExplorer";
import { hierarchyDefaults } from "@/components/shared/HierarchyBreadcrumb";
import { FileUploadZone } from "@/components/service-orders/FileUploadZone";
import { ExtractedDataTable } from "@/components/service-orders/ExtractedDataTable";
import { ServiceOrdersTable } from "@/components/service-orders/ServiceOrdersTable";
import { EmbeddedFileManager, persistDocumentVisualState, storeFileInDocuments } from "@/components/file-manager/EmbeddedFileManager";
import { SectionPlaceholder } from "@/components/shared/SectionPlaceholder";
import { ActiveDocumentBand } from "@/components/shared/ActiveDocumentBand";
import { formatLicensePlate } from "@/lib/formatPlate";
import { fileForCurrentVisualState, type DocumentVisualState } from "@/lib/documentVisualState";
import {
  useServiceOrders,
  useExtractServiceOrder,
  useClients,
  type ExtractedOrder,
  type ExtractionResult,
  type ServiceOrderInsert,
} from "@/hooks/useServiceOrders";
import { useAssignableUsers, useMyAssignableUserId } from "@/hooks/useAssignableUsers";
import { useFileQueue, type QueueItemStatus } from "@/hooks/useFileQueue";
import { useLanguage } from "@/hooks/useLanguage";
import { useAuth } from "@/hooks/useAuth";
import { useRole } from "@/hooks/useRole";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useTechnicianEarnings, getTechEarnings } from "@/hooks/useTechnicianEarnings";
import { Can } from "@/components/Can";
import { getCurrentUser } from "@/lib/authUser";
import { apiRequest } from "@/lib/api";
import { useContextualWorkspace } from "@/hooks/useContextualWorkspace";
import { ContextualWorkspacePicker } from "@/components/workspace/ContextualWorkspacePicker";

export default function ServiceOrdersPage() {
  const { t, formatCurrency } = useLanguage();
  const { user } = useAuth();
  const { isAdmin, dbRole } = useRole();
  const canAssignAnyTechnician = isAdmin || dbRole === "partner";
  const isTechnicianRole = dbRole === "technician";
  const queryClient = useQueryClient();

  const [extractions, setExtractions] = useState<(ExtractionResult & { _id: string; _file?: File; _documentId?: string; _docState: DocumentVisualState; _ocrVersion: number })[]>([]);
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const { data: orders = [], isLoading } = useServiceOrders({});
  const { extract } = useExtractServiceOrder();
  const { data: clients = [] } = useClients();
  const { data: technicians = [] } = useAssignableUsers();
  const { data: myAssignableUserId } = useMyAssignableUserId();
  const { data: earningsMap } = useTechnicianEarnings();
  const { isProcessing, addFiles } = useFileQueue();
  const ctxWs = useContextualWorkspace("service_orders");

  const [hCtx, setHCtx] = useState<HierarchyContext>(() =>
    loadHierarchyContext("hierarchy.service_orders"),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem("hierarchy.service_orders.collapsed") === "1"; } catch { return false; }
  });
  const [treeOpen, setTreeOpen] = useState(false);
  const handleHierarchyContextChange = (ctx: HierarchyContext) => {
    setHCtx(ctx);
    setTreeOpen(false);
  };
  const visibleOrders = useMemo(
    () => applyHierarchyContext(orders as any[], hCtx),
    [orders, hCtx],
  );

  const handleFiles = useCallback((files: File[]) => {
    const ctxDefaults = hierarchyDefaults(hCtx);
    const targetYear = hCtx.year ?? null;
    addFiles(files, async (file, onStatus) => {
      onStatus("uploading" as QueueItemStatus);
      const storedDocument = await storeFileInDocuments(file, "service_order", user?.id, "orders", targetYear);
      queryClient.invalidateQueries({ queryKey: ["embedded-docs", "service_order"] });
      onStatus("processing" as QueueItemStatus);
      try {
        const result = await extract(file);
        const prefilled = {
          ...result,
          orders: result.orders.map((o) => ({
            ...o,
            client: o.client ?? ctxDefaults.client,
            week: o.week ?? ctxDefaults.week,
            technician: o.technician ?? ctxDefaults.technician,
          })),
        };
        setExtractions(prev => [...prev, {
          ...prefilled,
          _id: crypto.randomUUID(),
          _file: file,
          _documentId: storedDocument?.id,
          _docState: { displayName: file.name, rotation: 0, zoom: 1, validated: false, updatedAt: new Date().toISOString() },
          _ocrVersion: 0,
        }]);
        if (result.confidence === "low") {
          toast.warning(t("serviceOrders.lowConfidence", "Extração com baixa confiança. Revise com atenção."));
        }
      } catch (err) {
        const msg = (err as Error).message || t("serviceOrders.extractUnknown", "Erro desconhecido na extração.");
        toast.error(msg, { duration: 8000 });
        throw err;
      }
    });
  }, [addFiles, extract, user?.id, queryClient, hCtx, t]);

  const handleSave = async (extractionId: string, rows: ExtractedOrder[], opts?: { isPrivate?: boolean }) => {
    const extraction = extractions.find((e) => e._id === extractionId);
    const authUser = await getCurrentUser();
    if (!authUser?.id) {
      toast.error("Sessão expirada. Faça login novamente antes de salvar.", { duration: 7000 });
      return;
    }
    const inserts: ServiceOrderInsert[] = [];
    const missingUserRows: number[] = [];
    rows.forEach((r, idx) => {
      const clientMatch = clients.find((c) => c.name.toLowerCase() === r.client?.toLowerCase());
      const rawTech = (r.technician ?? "").trim();
      const techByUser = technicians.find((t) => t.user_id === rawTech);
      const techByName = !techByUser
        ? technicians.find((t) => t.name.toLowerCase() === rawTech.toLowerCase())
        : undefined;
      const techMatch = techByUser ?? techByName;
      let technicianName: string = techMatch?.name ?? rawTech;
      if (!canAssignAnyTechnician) {
        const me = technicians.find((t) => t.user_id === authUser.id);
        if (me) technicianName = me.name;
      } else if (techByUser) {
        technicianName = techByUser.name;
      }
      const selectedUser = techByUser ?? techByName ?? null;
      const ctxDefaults = hierarchyDefaults(hCtx);
      const payload: Record<string, any> = {
        client_id: clientMatch?.id || null,
        client_name: r.client?.trim() || clientMatch?.name || ctxDefaults.client || "",
        technician_name: technicianName,
        technician_id: null,
        platform: r.platform ?? ctxDefaults.platform ?? null,
        week: r.week ?? ctxDefaults.week ?? null,
        operational_unit: ctxDefaults.operational_unit ?? null,
        car_name: r.car_name ?? null,
        license_plate: r.license_plate ? formatLicensePlate(r.license_plate) : null,
        service_1_name: r.service_1_name ?? null,
        service_1_price: r.service_1_price ?? null,
        service_2_name: r.service_2_name ?? null,
        service_2_price: r.service_2_price ?? null,
        service_3_name: r.service_3_name ?? null,
        service_3_price: r.service_3_price ?? null,
        service_4_name: r.service_4_name ?? null,
        service_4_price: r.service_4_price ?? null,
        total: r.total ?? null,
        status: "draft",
        group_id: r.week ?? ctxDefaults.week ?? null,
        // Ownership: private OS skip workspace linkage; collective OS bind to workspace.
        visibility_scope: opts?.isPrivate ? "private" : "workspace",
        ...(opts?.isPrivate ? { workspace_id: null } : (ctxWs.resolvedWorkspaceId ? { workspace_id: ctxWs.resolvedWorkspaceId } : {})),
      };
      // Contexto operacional SEMPRE prevalece sobre o ano atual.
      if (ctxDefaults.year) {
        const y = parseInt(ctxDefaults.year, 10);
        const d = new Date();
        d.setFullYear(y);
        payload.created_at = d.toISOString();
      }
      const techName = payload.technician_name || r.technician;
      const techEarn = getTechEarnings(techName, payload.total, earningsMap);
      payload.technician_percentage = techEarn?.percentage ?? 0;
      payload.technician_earning = techEarn?.earnings ?? 0;
      let finalUserId: string = authUser.id;
      if (canAssignAnyTechnician) finalUserId = selectedUser?.user_id ?? "";
      if (!canAssignAnyTechnician && finalUserId !== authUser.id) {
        throw new Error("RLS violation prevention: invalid user_id");
      }
      if (!finalUserId) missingUserRows.push(idx + 1);
      payload.user_id = finalUserId;
      payload.assigned_user_id = finalUserId;
      inserts.push(payload as ServiceOrderInsert);
    });
    if (missingUserRows.length > 0) {
      const msg = isTechnicianRole
        ? "Sua conta não está autenticada. Faça login novamente antes de salvar."
        : `Selecione um usuário antes de salvar (linha(s): ${missingUserRows.join(", ")})`;
      toast.error(msg, { duration: 7000 });
      return;
    }
    toast.error(
      "A gravação direta de Ordens de Serviço legadas foi descontinuada (T08). O fluxo canônico de importação e confronto OCR será integrado na Spec 004.",
      { duration: 8000 }
    );
  };

  const handleDiscard = (extractionId: string) => {
    setExtractions(prev => prev.filter((e) => e._id !== extractionId));
  };

  const updateDocumentState = async (extractionId: string, state: DocumentVisualState) => {
    setExtractions(prev => prev.map((e) => e._id === extractionId ? { ...e, _docState: state } : e));
    const extraction = extractions.find((e) => e._id === extractionId);
    if (extraction?._documentId) {
      await persistDocumentVisualState(extraction._documentId, state, false);
      queryClient.invalidateQueries({ queryKey: ["embedded-docs", "service_order"] });
    }
  };

  const handleReprocessOcr = async (extractionId: string, state: DocumentVisualState) => {
    const extraction = extractions.find((e) => e._id === extractionId);
    if (!extraction?._file) return;
    setReprocessingId(extractionId);
    try {
      await updateDocumentState(extractionId, state);
      const visualFile = await fileForCurrentVisualState(extraction._file, state);
      const result = await extract(visualFile);
      const ctxDefaults = hierarchyDefaults(hCtx);
      const prefilled = {
        ...result,
        orders: result.orders.map((o) => ({
          ...o,
          client: o.client ?? ctxDefaults.client,
          week: o.week ?? ctxDefaults.week,
          technician: o.technician ?? ctxDefaults.technician,
        })),
      };
      setExtractions(prev => prev.map((e) => e._id === extractionId ? { ...e, ...prefilled, _docState: state, _ocrVersion: e._ocrVersion + 1 } : e));
      toast.success("OCR reprocessado com a orientação atual.");
    } catch (err) {
      toast.error((err as Error).message || "Erro ao reprocessar OCR.", { duration: 8000 });
    } finally {
      setReprocessingId(null);
    }
  };

  const hasExtractions = extractions.length > 0;

  const handleDeleteYear = useCallback(async (_year: string) => {
    toast.error("Exclusão em lote por ano descontinuada (T08). Registros históricos são imutáveis.");
  }, []);

  return (
    <div className="animate-fade-in flex min-h-full w-full min-w-0 flex-col gap-3 overflow-visible md:gap-2">
      {/* HEADER — sits ABOVE the operational tree, full width */}
      <header className="sticky top-0 z-30 -mx-3 flex shrink-0 flex-col gap-3 border-b border-border/40 bg-background/95 px-3 pb-3 pt-1 backdrop-blur sm:-mx-4 sm:px-4 md:static md:mx-0 md:flex-row md:items-center md:justify-between md:bg-transparent md:px-1 md:pb-2 md:pt-0 md:backdrop-blur-none">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <ClipboardList className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold text-foreground truncate">
              <span className="font-bold tracking-[0.08em] text-indigo-600 dark:text-indigo-400">WEEKLOG</span>
              <span className="mx-2 text-muted-foreground/60">·</span>
              {t("so.title") || "Ordens de serviço"}
            </h1>
            <p className="text-[11px] text-muted-foreground truncate">
              {t("so.subtitle") || "Gestão e validação documental operacional"}
              <span className="mx-1.5 text-muted-foreground/60">—</span>
              <span className="text-indigo-500/90 dark:text-indigo-400">Integração Produção (Finalizado) → semana automática</span>
            </p>
          </div>
        </div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 md:flex md:items-center">
          <Button variant="outline" size="icon" className="h-11 w-11 md:hidden" onClick={() => setTreeOpen(true)} aria-label="Abrir contexto operacional">
            <FolderTree className="h-4 w-4" />
          </Button>
          <ContextualWorkspacePicker ctx={ctxWs} />
          <Can permission="service_orders.create">
            <FileUploadZone onFilesSelected={handleFiles} isProcessing={isProcessing} compact />
          </Can>
        </div>
      </header>

      <Sheet open={treeOpen} onOpenChange={setTreeOpen}>
        <SheetContent side="left" className="w-[min(22rem,calc(100vw-1rem))] p-0">
          <HierarchyExplorer
            records={orders as any}
            storageKey="hierarchy.service_orders"
            context={hCtx}
            onContextChange={handleHierarchyContextChange}
            onDeleteYear={handleDeleteYear}
            defaultAllCollapsed
          />
        </SheetContent>
      </Sheet>

      {/* WORKSPACE — sidebar + canvas, both starting at the same baseline */}
      <div className="flex min-h-0 w-full flex-1 gap-3 overflow-visible md:overflow-hidden">
        <aside
          className={`hidden md:flex shrink-0 transition-[width] duration-200 ${sidebarCollapsed ? "w-12" : "w-56"}`}
        >
          <HierarchyExplorer
            records={orders as any}
            storageKey="hierarchy.service_orders"
            context={hCtx}
            onContextChange={setHCtx}
            collapsible
            collapsed={sidebarCollapsed}
            onCollapsedChange={setSidebarCollapsed}
            onDeleteYear={handleDeleteYear}
            defaultAllCollapsed
          />
        </aside>

        {/* CANVAS — fluid, single scroll, no extra wrappers */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-visible md:overflow-auto">
          {hasExtractions && extractions.map((extraction) => (
            <ActiveDocumentBand
              key={extraction._id}
              file={extraction._file}
              stage="review"
              initialState={extraction._docState}
              onStateChange={(state) => setExtractions(prev => prev.map((e) => e._id === extraction._id ? { ...e, _docState: state } : e))}
              onPersistState={(state) => updateDocumentState(extraction._id, state)}
              onReprocessOcr={(state) => handleReprocessOcr(extraction._id, state)}
              isReprocessing={reprocessingId === extraction._id}
              onClose={() => handleDiscard(extraction._id)}
            >
              <ExtractedDataTable
                key={`${extraction._id}:${extraction._ocrVersion}`}
                orders={extraction.orders}
                confidence={extraction.confidence}
                notes={extraction.notes}
                onSave={(rows, opts) => handleSave(extraction._id, rows, opts)}
                onDiscard={() => handleDiscard(extraction._id)}
                isSaving={false}
                technicians={technicians}
                isTechnicianRole={isTechnicianRole}
                isAdmin={canAssignAnyTechnician}
                myTechnicianName={
                  myAssignableUserId
                    ? technicians.find((t) => t.user_id === myAssignableUserId)?.name ?? null
                    : null
                }
                hidePrivacyToggle={!ctxWs.resolvedWorkspaceId}
              />
            </ActiveDocumentBand>
          ))}

          {!hasExtractions && (
            hCtx.section === "documentos" ? (
              <div className="space-y-3">
                <EmbeddedFileManager entityType="service_order" module="orders" year={hCtx.year ?? null} />
                {/* ESTRUTURA ATIVA: documentos/fotos organizados POR SEMANA + VEÍCULO (criados automaticamente ao finalizar Produção) */}
                <section
                  className="mt-2 rounded-xl border border-emerald-300/60 bg-emerald-500/5 p-4 dark:bg-emerald-500/[0.03]"
                  aria-label="Estrutura documentos semana+veículo"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <FolderTree className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <h3 className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 tracking-wide">
                      WEEKLOG · Estrutura Semana + Veículo (ATIVO · criação automática)
                    </h3>
                  </div>
                  <p className="text-[11px] text-muted-foreground max-w-3xl leading-relaxed">
                    Ao finalizar um veículo na Produção, a estrutura abaixo é criada automaticamente
                    neste WEEKLOG e as fotos/documentos do veículo são migradas sem duplicação:
                  </p>
                  <ul className="text-[11px] text-muted-foreground mt-2 space-y-0.5 list-disc pl-5">
                    <li>
                      Pasta <b className="text-emerald-700 dark:text-emerald-300">Week XX</b> (ex: <code className="px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Week 32</code>) — raiz da semana operacional.
                    </li>
                    <li>
                      Dentro de cada semana: <b className="text-emerald-700 dark:text-emerald-300">MARCA MODELO - MATRÍCULA</b> (ex: <code className="px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">PEUGEOT 2008 - DN648GM</code>).
                    </li>
                    <li>Todas as fotos anexadas à ordem de Produção aparecem automaticamente dentro da pasta do veículo correto — nunca misturadas entre veículos.</li>
                    <li>Filtros nativos do HierarchyExplorer (ano / semana / veículo / cliente / técnico) já funcionam imediatamente para buscas.</li>
                  </ul>
                </section>
              </div>
            ) : hCtx.section === "relatorios" ? (
              <SectionPlaceholder
                icon="chart"
                title="Relatórios"
                subtitle={hCtx.year ? `Ano ${hCtx.year}` : undefined}
                hint="Relatórios automáticos serão disponibilizados em breve."
              />
            ) : (
              <ServiceOrdersTable orders={visibleOrders as any} isLoading={isLoading} />
            )
          )}
        </div>
      </div>
    </div>
  );
}
