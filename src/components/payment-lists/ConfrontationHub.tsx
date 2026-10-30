import { useState, useMemo, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { apiRequest } from "@/lib/api";
import {
  Upload,
  AlertTriangle,
  CheckCircle2,
  Clock,
  HelpCircle,
  FileText,
  Download,
  ShieldCheck,
  RefreshCw,
  Search,
  FileCheck2,
  Info,
  History,
  Eye,
  ExternalLink,
  Loader2,
  Mail,
  Send,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useClients } from "@/hooks/useServiceOrders";
import { usePaymentLists } from "@/hooks/usePaymentLists";
import {
  previewConfrontationFile,
  executeConfrontationHub,
  listConfrontationRuns,
  getConfrontationRun,
  saveConfrontationDecision,
  getConfrontationEvidence,
  type ConfrontationFilePreview,
  type ConfrontationColumnMapping,
  type ConfrontationExecutionResponse,
  type ConfrontationItemResult,
  type ConfrontationRunSummary,
  type ConfrontationEvidenceResponse,
} from "@/lib/apiConfrontationHub";

export interface EditableReviewRow {
  _id: string;
  licensePlate: string;
  vin: string;
  serviceDescription: string;
  amount: string;
}

export function ConfrontationHub() {
  const [searchParams] = useSearchParams();
  const { data: clients = [] } = useClients();
  const { data: paymentLists = [] } = usePaymentLists();

  // Step state
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");
  const [selectedPaymentListId, setSelectedPaymentListId] = useState<string>("");

  // Auto-select list from searchParams if navigated from PaymentLists tab
  useEffect(() => {
    const listParam = searchParams.get("list");
    if (listParam && paymentLists.length > 0) {
      const found = paymentLists.find((l) => l.id === listParam);
      if (found) {
        setSelectedClientId(found.clientId);
        setSelectedPaymentListId(found.id);
      }
    }
  }, [searchParams, paymentLists]);

  // File & Preview state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState<ConfrontationFilePreview | null>(null);
  const [mapping, setMapping] = useState<ConfrontationColumnMapping>({
    plateColumn: "",
    vinColumn: "",
    serviceColumn: "",
    amountColumn: "",
    taxType: "HT",
    granularity: "auto",
  });
  const [editableRows, setEditableRows] = useState<EditableReviewRow[]>([]);
  const [mappingModalOpen, setMappingModalOpen] = useState(false);

  // Discrepancy Email Notification Modal state
  const [discrepancyModalOpen, setDiscrepancyModalOpen] = useState(false);
  const [activeDiscrepancyItem, setActiveDiscrepancyItem] = useState<ConfrontationItemResult | null>(null);
  const [clientEmailInput, setClientEmailInput] = useState("");
  const [discrepancyEmailNotes, setDiscrepancyEmailNotes] = useState("");
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  // Confrontation Execution State
  const [isExecuting, setIsExecuting] = useState(false);
  const [confrontationResult, setConfrontationResult] = useState<ConfrontationExecutionResponse | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Dispute / Decision Dialog
  const [activeItemForDecision, setActiveItemForDecision] = useState<ConfrontationItemResult | null>(null);
  const [decisionType, setDecisionType] = useState<"contest" | "accept_difference" | "resolve" | "pending">("contest");
  const [decisionNotes, setDecisionNotes] = useState("");
  const [isSavingDecision, setIsSavingDecision] = useState(false);

  // Historical runs state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pastRuns, setPastRuns] = useState<ConfrontationRunSummary[]>([]);
  const [isLoadingPastRuns, setIsLoadingPastRuns] = useState(false);

  // Evidence Dialog state
  const [evidenceModalOpen, setEvidenceModalOpen] = useState(false);
  const [isLoadingEvidence, setIsLoadingEvidence] = useState(false);
  const [activeEvidence, setActiveEvidence] = useState<ConfrontationEvidenceResponse | null>(null);
  const [activeEvidenceItem, setActiveEvidenceItem] = useState<ConfrontationItemResult | null>(null);

  // Filtered lists for the chosen client
  const availableLists = useMemo(() => {
    if (!selectedClientId) return [];
    return paymentLists.filter((l) => l.clientId === selectedClientId);
  }, [paymentLists, selectedClientId]);

  // Process selected file (via input click or drag-and-drop)
  const processSelectedFile = async (selected: File) => {
    setFile(selected);
    setIsUploading(true);
    try {
      const p = await previewConfrontationFile(selected);
      setPreview(p);
      setMapping(p.suggestedMapping);

      const plateCol = p.suggestedMapping.plateColumn;
      const vinCol = p.suggestedMapping.vinColumn || "";
      const serviceCol = p.suggestedMapping.serviceColumn || "";
      const amountCol = p.suggestedMapping.amountColumn;
      const allRows = p.rawRows && p.rawRows.length > 0 ? p.rawRows : p.sampleRows;

      const initialEditable: EditableReviewRow[] = allRows.map((r, idx) => ({
        _id: `row-${idx}`,
        licensePlate: plateCol ? String(r[plateCol] || "") : "",
        vin: vinCol ? String(r[vinCol] || "") : "",
        serviceDescription: serviceCol ? String(r[serviceCol] || "") : "",
        amount: String(r[amountCol] || "0").replace(/[^0-9,.-]/g, "").replace(",", "."),
      }));

      setEditableRows(initialEditable);
      setMappingModalOpen(true);
      toast.success("Documento lido com sucesso. Revise as informações na tabela antes de confrontar.");
    } catch (err: any) {
      toast.error(err?.message || "Falha ao ler o arquivo para confronto.");
      setFile(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    await processSelectedFile(selected);
  };

  // Confirm review and run confrontation
  const handleConfirmMappingAndExecute = async () => {
    if (!file || editableRows.length === 0) {
      toast.error("Nenhuma linha válida para executar o confronto.");
      return;
    }

    if (!selectedClientId) {
      toast.error("Por favor, selecione o Cliente Comercial antes de executar o confronto.");
      return;
    }

    setMappingModalOpen(false);
    setIsExecuting(true);

    try {
      const rows = editableRows.map((r) => {
        let amtStr = String(r.amount || "0").replace(/[^0-9,.-]/g, "").replace(",", ".");
        return {
          licensePlate: r.licensePlate?.trim() || null,
          vin: r.vin?.trim() || null,
          serviceDescription: r.serviceDescription?.trim() || null,
          amount: parseFloat(amtStr) || 0,
          taxType: mapping.taxType,
        };
      });

      // Convert file to base64 for persistent storage in MinIO
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = reader.result as string;
          const b64 = res.split(",")[1] || res;
          resolve(b64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await executeConfrontationHub({
        clientId: selectedClientId,
        period: selectedPeriod || undefined,
        paymentListId: selectedPaymentListId === "none" ? undefined : (selectedPaymentListId || undefined),
        granularity: mapping.granularity,
        taxType: mapping.taxType,
        rows,
        mappingConfirmed: mapping,
        fileName: file.name,
        fileBase64,
      });

      setConfrontationResult(res);
      toast.success(`Confronto OS × OP #${res.sequence} executado e persistido com sucesso!`);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao executar confronto.");
    } finally {
      setIsExecuting(false);
    }
  };

  // Open discrepancy notification modal
  const handleOpenDiscrepancyEmail = (item: ConfrontationItemResult) => {
    setActiveDiscrepancyItem(item);
    const client = clients.find((c: any) => c.id === selectedClientId);
    setClientEmailInput((client as any)?.email || "");
    setDiscrepancyEmailNotes(
      `Identificamos divergência no veículo de placa ${item.licensePlate} (${item.serviceDescription}): valor na OS da Operix é €${item.internalAmount}, enquanto na lista recebida consta €${item.externalAmount} (diferença de €${item.differenceAmount}). Favor providenciar a regularização.`
    );
    setDiscrepancyModalOpen(true);
  };

  // Send discrepancy notification email
  const handleSendDiscrepancyEmail = async () => {
    if (!activeDiscrepancyItem || !clientEmailInput.trim()) {
      toast.warning("Informe o e-mail do cliente destinatário.");
      return;
    }
    setIsSendingEmail(true);
    try {
      const client = clients.find((c: any) => c.id === selectedClientId);
      await apiRequest("/api/payment-lists/confrontation/notify-discrepancy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runId: confrontationResult?.runId,
          itemResultId: activeDiscrepancyItem.id,
          clientEmail: clientEmailInput.trim(),
          clientName: client?.name || "Parceiro Comercial",
          licensePlate: activeDiscrepancyItem.licensePlate,
          carName: activeDiscrepancyItem.carName,
          serviceDescription: activeDiscrepancyItem.serviceDescription,
          internalAmount: activeDiscrepancyItem.internalAmount,
          externalAmount: activeDiscrepancyItem.externalAmount,
          differenceAmount: activeDiscrepancyItem.differenceAmount,
          notes: discrepancyEmailNotes,
        }),
      });
      toast.success(`Relatório de divergência enviado por e-mail para ${clientEmailInput}!`);
      setDiscrepancyModalOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao enviar e-mail de divergência.");
    } finally {
      setIsSendingEmail(false);
    }
  };

  // Submit human commercial decision on discrepancy
  const handleSaveDecision = async () => {
    if (!activeItemForDecision || !confrontationResult) return;
    setIsSavingDecision(true);

    try {
      const finalNotes = decisionNotes || (
        decisionType === "contest"
          ? "Conforme WEEKLOG assinada pelo chefe da oficina"
          : decisionType === "accept_difference"
          ? "Aceite comercial do operador registrado no histórico"
          : decisionType === "resolve"
          ? "Divergência resolvida comercialmente"
          : "Pendente de alinhamento"
      );

      if (confrontationResult.runId) {
        await saveConfrontationDecision(confrontationResult.runId, {
          itemKey: activeItemForDecision.id,
          decision: decisionType,
          decisionNotes: finalNotes,
        });
      }

      const updatedResults = confrontationResult.results.map((r) => {
        if (r.id === activeItemForDecision.id) {
          return {
            ...r,
            decision: decisionType,
            decisionNotes: finalNotes,
            decidedAt: new Date().toISOString(),
          };
        }
        return r;
      });

      setConfrontationResult({
        ...confrontationResult,
        results: updatedResults,
      });

      toast.success(
        decisionType === "contest"
          ? "Contestação registrada com evidência da WEEKLOG."
          : decisionType === "accept_difference"
            ? "Aceite do valor externo registrado no histórico (sem alteração da Lista)."
            : "Decisão gravada com sucesso no histórico."
      );

      setActiveItemForDecision(null);
      setDecisionNotes("");
    } catch (err: any) {
      toast.error(err?.message || "Erro ao persistir decisão comercial.");
    } finally {
      setIsSavingDecision(false);
    }
  };

  // Load historical confrontation runs
  const handleOpenHistory = async () => {
    setIsLoadingPastRuns(true);
    setHistoryOpen(true);
    try {
      const runs = await listConfrontationRuns(selectedClientId || undefined);
      setPastRuns(runs);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao carregar histórico de confrontos.");
    } finally {
      setIsLoadingPastRuns(false);
    }
  };

  // Reopen a past confrontation
  const handleSelectPastRun = async (runId: string) => {
    setIsExecuting(true);
    try {
      const run = await getConfrontationRun(runId);
      setConfrontationResult(run);
      setSelectedClientId(run.client.id);
      if (run.period) setSelectedPeriod(run.period);
      setHistoryOpen(false);
      toast.success(`Confronto #${run.sequence} carregado do histórico com sucesso.`);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao abrir confronto anterior.");
    } finally {
      setIsExecuting(false);
    }
  };

  // Open evidence viewer
  const handleViewEvidence = async (item: ConfrontationItemResult) => {
    if (!item.weeklogValidationId) {
      toast.info("Evidência não disponível para este item.");
      return;
    }
    setActiveEvidenceItem(item);
    setIsLoadingEvidence(true);
    setEvidenceModalOpen(true);
    try {
      const evidence = await getConfrontationEvidence(item.weeklogValidationId);
      setActiveEvidence(evidence);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao carregar evidência da assinatura.");
      setActiveEvidence({ available: false, notes: "Erro ao obter evidência da assinatura." });
    } finally {
      setIsLoadingEvidence(false);
    }
  };

  // Filtered comparison results
  const filteredResults = useMemo(() => {
    if (!confrontationResult) return [];
    return confrontationResult.results.filter((r) => {
      const matchQuery =
        !searchQuery ||
        r.licensePlate.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (r.vin && r.vin.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (r.carName && r.carName.toLowerCase().includes(searchQuery.toLowerCase()));

      if (!matchQuery) return false;

      if (filterStatus === "all") return true;
      if (filterStatus === "exact") return r.status === "exact_match";
      if (filterStatus === "diff") return r.status === "value_difference" || r.status === "service_discrepancy";
      if (filterStatus === "omitted") return r.status === "omitted_by_client";
      if (filterStatus === "in_prod") return r.status === "in_production";
      if (filterStatus === "not_found") return r.status === "vehicle_not_found";
      return true;
    });
  }, [confrontationResult, filterStatus, searchQuery]);

  // Export Dossier PDF
  const handleExportDossierPdf = () => {
    window.print();
    toast.info("Janela de impressão aberta para gerar o Dossiê de Contestação em PDF.");
  };

  return (
    <div className="space-y-6">
      {/* 1. Header & Configuration Card */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <FileCheck2 className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-lg font-semibold tracking-tight">
                  Confronto OS × OP (Conferência de Listas)
                </CardTitle>
                <CardDescription className="text-xs">
                  Compare os serviços e valores consolidados na WEEKLOG / Listas internas com os documentos enviados pelo cliente.
                </CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleOpenHistory}
                disabled={isLoadingPastRuns}
                className="text-xs"
              >
                <History className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
                Histórico de Confrontos
              </Button>

              {confrontationResult && (
                <>
                  <Button variant="outline" size="sm" onClick={() => setConfrontationResult(null)} className="text-xs">
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Novo Confronto
                  </Button>
                  <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs" onClick={handleExportDossierPdf}>
                    <Download className="mr-1.5 h-3.5 w-3.5" />
                    Exportar Dossiê de Contestação (PDF)
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>

        {!confrontationResult && (
          <CardContent className="space-y-4 pt-0">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Cliente */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Cliente Comercial *</Label>
                <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder="Selecione o cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c: any) => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Período / Semana */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Semana / Período Operacional</Label>
                <Input
                  placeholder="Ex: 2026-W41 ou Outubro/2026"
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              {/* Lista Interna Opcional */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Lista Interna Preexistente (Opcional)</Label>
                <Select
                  value={selectedPaymentListId}
                  onValueChange={setSelectedPaymentListId}
                  disabled={!selectedClientId || availableLists.length === 0}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue placeholder={availableLists.length > 0 ? "Selecionar lista interna" : "Nenhuma lista gerada (usará WEEKLOG)"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-xs">
                      Auto-detectar da WEEKLOG validada
                    </SelectItem>
                    {availableLists.map((l) => (
                      <SelectItem key={l.id} value={l.id} className="text-xs">
                        {l.listNumber} ({l.itemCount} itens · {l.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Dropzone de Upload com suporte robusto a clique e arrastar */}
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const dropped = e.dataTransfer.files?.[0];
                if (dropped) void processSelectedFile(dropped);
              }}
              className={`rounded-lg border-2 border-dashed p-6 text-center cursor-pointer transition-all ${
                isDragging
                  ? "border-emerald-500 bg-emerald-500/10 scale-[1.01]"
                  : "border-border/80 hover:border-emerald-500/60 hover:bg-muted/30"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                id="confrontation-file-input"
                className="hidden"
                accept=".xlsx,.xls,.csv,.pdf"
                onChange={handleFileSelect}
                disabled={isUploading || isExecuting}
              />
              <div className="flex flex-col items-center justify-center select-none pointer-events-none">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 mb-3">
                  <Upload className="h-6 w-6" />
                </div>
                <p className="text-sm font-medium text-foreground">
                  {isUploading
                    ? "Processando documento e extraindo registros..."
                    : "Clique ou arraste a lista externa do cliente aqui"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Formatos aceitos: Planilhas Excel (.xlsx, .xls), CSV (.csv) ou Relatórios em PDF
                </p>
                {!selectedClientId && (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400 mt-2 bg-amber-500/10 px-2 py-0.5 rounded">
                    Dica: Você pode selecionar o cliente agora ou logo após abrir o documento.
                  </span>
                )}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* 2. Results Dashboard & Metrics */}
      {confrontationResult && (
        <div className="space-y-6">
          {/* Summary Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Card className="p-3.5 bg-card/60">
              <span className="text-[11px] font-medium text-muted-foreground">Comparados</span>
              <p className="text-xl font-bold mt-1">{confrontationResult.metrics.totalCompared}</p>
              <span className="text-[10px] text-muted-foreground">veículos e linhas</span>
            </Card>

            <Card className="p-3.5 border-emerald-500/20 bg-emerald-500/5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">Conformes</span>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </div>
              <p className="text-xl font-bold text-emerald-700 dark:text-emerald-400 mt-1">
                {confrontationResult.metrics.exactMatchCount}
              </p>
              <span className="text-[10px] text-emerald-600/80">Valores conferem 100%</span>
            </Card>

            <Card className="p-3.5 border-amber-500/20 bg-amber-500/5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">Divergências</span>
                <AlertTriangle className="h-4 w-4 text-amber-600" />
              </div>
              <p className="text-xl font-bold text-amber-700 dark:text-amber-400 mt-1">
                {confrontationResult.metrics.valueDifferenceCount}
              </p>
              <span className="text-[10px] text-amber-600/80">Valores divergentes</span>
            </Card>

            <Card className="p-3.5 border-blue-500/20 bg-blue-500/5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-blue-700 dark:text-blue-400">Omitidos Cliente</span>
                <FileText className="h-4 w-4 text-blue-600" />
              </div>
              <p className="text-xl font-bold text-blue-700 dark:text-blue-400 mt-1">
                {confrontationResult.metrics.omittedByClientCount}
              </p>
              <span className="text-[10px] text-blue-600/80">Na oficina, fora da lista</span>
            </Card>

            <Card className="p-3.5 border-purple-500/20 bg-purple-500/5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-purple-700 dark:text-purple-400">Em Produção</span>
                <Clock className="h-4 w-4 text-purple-600" />
              </div>
              <p className="text-xl font-bold text-purple-700 dark:text-purple-400 mt-1">
                {confrontationResult.metrics.inProductionCount}
              </p>
              <span className="text-[10px] text-purple-600/80">Ainda não validados</span>
            </Card>

            <Card className="p-3.5 border-rose-500/20 bg-rose-500/5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-rose-700 dark:text-rose-400">Não Localizados</span>
                <HelpCircle className="h-4 w-4 text-rose-600" />
              </div>
              <p className="text-xl font-bold text-rose-700 dark:text-rose-400 mt-1">
                {confrontationResult.metrics.notFoundCount}
              </p>
              <span className="text-[10px] text-rose-600/80">Sem cadastro no Operix</span>
            </Card>
          </div>

          {/* Granularity & Scope Context Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-muted/40 border text-xs text-muted-foreground">
            <div className="flex items-center gap-4">
              <span><strong>Confronto:</strong> #{confrontationResult.sequence}</span>
              <span><strong>Cliente:</strong> {confrontationResult.client.name}</span>
              {confrontationResult.period && <span><strong>Período:</strong> {confrontationResult.period}</span>}
              {confrontationResult.fileName && <span><strong>Arquivo:</strong> {confrontationResult.fileName}</span>}
              <span>
                <strong>Granularidade:</strong>{" "}
                <Badge variant="outline" className="text-[10px] uppercase font-mono">
                  {confrontationResult.granularityUsed === "synthetic" ? "Sintética (Total por Veículo)" : "Analítica (Por Serviço)"}
                </Badge>
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span>Total Operix: <strong>€{confrontationResult.metrics.totalInternalAmount}</strong></span>
              <span>Total Cliente: <strong>€{confrontationResult.metrics.totalExternalAmount}</strong></span>
              <span className={Number(confrontationResult.metrics.netDifferenceAmount) > 0 ? "text-amber-600 font-semibold" : ""}>
                Diferença Líquida: <strong>€{confrontationResult.metrics.netDifferenceAmount}</strong>
              </span>
            </div>
          </div>

          {/* Filters and Search Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Filtrar por placa ou veículo..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-xs"
                />
              </div>

              <div className="flex rounded-md border p-0.5 bg-muted/30">
                <Button
                  size="sm"
                  variant={filterStatus === "all" ? "secondary" : "ghost"}
                  className="h-7 text-xs px-2.5"
                  onClick={() => setFilterStatus("all")}
                >
                  Todos ({confrontationResult.results.length})
                </Button>
                <Button
                  size="sm"
                  variant={filterStatus === "diff" ? "secondary" : "ghost"}
                  className="h-7 text-xs px-2.5 text-amber-600"
                  onClick={() => setFilterStatus("diff")}
                >
                  Divergências ({confrontationResult.metrics.valueDifferenceCount})
                </Button>
                <Button
                  size="sm"
                  variant={filterStatus === "omitted" ? "secondary" : "ghost"}
                  className="h-7 text-xs px-2.5 text-blue-600"
                  onClick={() => setFilterStatus("omitted")}
                >
                  Omitidos ({confrontationResult.metrics.omittedByClientCount})
                </Button>
                <Button
                  size="sm"
                  variant={filterStatus === "exact" ? "secondary" : "ghost"}
                  className="h-7 text-xs px-2.5 text-emerald-600"
                  onClick={() => setFilterStatus("exact")}
                >
                  Conformes ({confrontationResult.metrics.exactMatchCount})
                </Button>
              </div>
            </div>
          </div>

          {/* Confrontation Results Table */}
          <div className="rounded-lg border overflow-hidden bg-card">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="w-[18%]">Veículo (Placa / VIN)</TableHead>
                  <TableHead className="w-[30%]">Serviço / Evidência</TableHead>
                  <TableHead className="w-[11%] text-right">Valor Operix</TableHead>
                  <TableHead className="w-[11%] text-right">Valor Cliente</TableHead>
                  <TableHead className="w-[12%] text-right">Divergência</TableHead>
                  <TableHead className="w-[18%] text-center">Decisão Comercial</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredResults.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-xs">
                      Nenhum veículo corresponde ao filtro selecionado.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredResults.map((item) => {
                    const isDiff = item.status === "value_difference" || item.status === "service_discrepancy";
                    const isOmitted = item.status === "omitted_by_client";
                    const isInProd = item.status === "in_production";
                    const isNotFound = item.status === "vehicle_not_found";

                    return (
                      <TableRow key={item.id} className="hover:bg-muted/40 transition-colors">
                        <TableCell>
                          <div className="font-mono font-bold text-xs">{item.licensePlate}</div>
                          {item.carName && <div className="text-[11px] text-muted-foreground">{item.carName}</div>}
                          {item.vin && <div className="text-[10px] text-muted-foreground/80 font-mono">VIN: {item.vin}</div>}
                        </TableCell>

                        <TableCell>
                          <div className="text-xs font-medium">{item.serviceDescription}</div>
                          <div className="flex items-center gap-2 mt-1">
                            {item.weeklogValidationId ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 text-[11px] text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 px-1.5 flex items-center gap-1 font-medium"
                                onClick={() => handleViewEvidence(item)}
                              >
                                <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                                Visualizar WEEKLOG assinada
                              </Button>
                            ) : (
                              <span className="text-[10px] text-muted-foreground/80 flex items-center gap-1">
                                <Info className="h-3 w-3" />
                                Evidência não disponível
                              </span>
                            )}
                          </div>
                          {isInProd && (
                            <div className="text-[10px] text-purple-600 dark:text-purple-400 mt-0.5">
                              OS em produção no chão de fábrica (não validada)
                            </div>
                          )}
                        </TableCell>

                        <TableCell className="text-right tabular-nums text-xs font-medium">
                          €{item.internalAmount}
                        </TableCell>

                        <TableCell className="text-right tabular-nums text-xs font-medium">
                          €{item.externalAmount}
                        </TableCell>

                        <TableCell className="text-right tabular-nums text-xs">
                          {isDiff ? (
                            <span className="font-bold text-amber-600 dark:text-amber-400">
                              +€{item.differenceAmount}
                            </span>
                          ) : isOmitted ? (
                            <span className="font-bold text-blue-600 dark:text-blue-400">
                              +€{item.differenceAmount} (omitido)
                            </span>
                          ) : isInProd ? (
                            <Badge variant="outline" className="text-[10px] text-purple-600 border-purple-300">
                              Em produção
                            </Badge>
                          ) : isNotFound ? (
                            <Badge variant="outline" className="text-[10px] text-rose-600 border-rose-300">
                              Não cadastrado
                            </Badge>
                          ) : (
                            <span className="text-emerald-600 font-medium">€0.00</span>
                          )}
                        </TableCell>

                        <TableCell className="text-center">
                          {item.decision === "contest" ? (
                            <Badge className="bg-amber-500/10 text-amber-600 border-amber-300 cursor-pointer" onClick={() => {
                              setActiveItemForDecision(item);
                              setDecisionType("contest");
                              setDecisionNotes(item.decisionNotes || "");
                            }}>
                              Contestado
                            </Badge>
                          ) : item.decision === "accept_difference" ? (
                            <Badge className="bg-muted text-muted-foreground cursor-pointer" onClick={() => {
                              setActiveItemForDecision(item);
                              setDecisionType("accept_difference");
                              setDecisionNotes(item.decisionNotes || "");
                            }}>
                              Aceite Registrado
                            </Badge>
                          ) : item.decision === "resolve" ? (
                            <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-300 cursor-pointer" onClick={() => {
                              setActiveItemForDecision(item);
                              setDecisionType("resolve");
                              setDecisionNotes(item.decisionNotes || "");
                            }}>
                              Resolvido
                            </Badge>
                          ) : isDiff || isOmitted ? (
                            <div className="flex items-center justify-center gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                                onClick={() => {
                                  setActiveItemForDecision(item);
                                  setDecisionType("contest");
                                  setDecisionNotes(
                                    item.weeklogSignatureRef
                                      ? `Contestação formal fundamentada na WEEKLOG assinada (${item.weeklogSignatureRef}) pelo chefe da oficina.`
                                      : "Contestação de valor divergente conforme registros operacionais internos."
                                  );
                                }}
                              >
                                Decisão
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-amber-400 text-amber-700 dark:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 font-medium gap-1"
                                onClick={() => handleOpenDiscrepancyEmail(item)}
                                title="Solicitar Correção / Enviar ao Cliente"
                              >
                                <Mail className="h-3 w-3" />
                                Enviar ao Cliente
                              </Button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* 3. Tabela de Revisão e Edição da Lista do Cliente */}
      <Dialog open={mappingModalOpen} onOpenChange={setMappingModalOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <FileCheck2 className="h-5 w-5 text-emerald-600" />
              Revisão e Edição da Lista de Pagamento do Cliente
            </DialogTitle>
            <DialogDescription className="text-xs">
              Revise e edite diretamente as informações extraídas (placas, serviços e valores) antes de confirmar o confronto.
            </DialogDescription>
          </DialogHeader>

          {preview && (
            <div className="space-y-4 py-2">
              {/* Header de Configuração do Confronto */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-lg border bg-muted/20">
                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Cliente Comercial *</Label>
                  <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                    <SelectTrigger className="h-8 text-xs bg-card">
                      <SelectValue placeholder="Selecione o cliente" />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.map((c: any) => (
                        <SelectItem key={c.id} value={c.id} className="text-xs">
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Semana / Período Operacional</Label>
                  <Input
                    placeholder="Ex: 2026-W42 ou Semana 42"
                    value={selectedPeriod}
                    onChange={(e) => setSelectedPeriod(e.target.value)}
                    className="h-8 text-xs bg-card"
                  />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs font-semibold">Base Fiscal</Label>
                  <Select
                    value={mapping.taxType}
                    onValueChange={(val: "HT" | "TTC") => setMapping({ ...mapping, taxType: val })}
                  >
                    <SelectTrigger className="h-8 text-xs bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HT" className="text-xs">
                        HT (Sem impostos / Líquido)
                      </SelectItem>
                      <SelectItem value="TTC" className="text-xs">
                        TTC (Com impostos / Bruto)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Tabela de Edição de Linhas */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">
                    Linhas do Documento ({editableRows.length} linhas detectadas):
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1"
                    onClick={() =>
                      setEditableRows([
                        ...editableRows,
                        {
                          _id: `row-${Date.now()}`,
                          licensePlate: "",
                          vin: "",
                          serviceDescription: "DSP / Reparação",
                          amount: "0",
                        },
                      ])
                    }
                  >
                    <Plus className="h-3 w-3" /> Adicionar Linha
                  </Button>
                </div>

                <div className="rounded-lg border overflow-x-auto max-h-[380px] bg-card">
                  <Table className="text-xs">
                    <TableHeader className="bg-muted/40 sticky top-0 z-10">
                      <TableRow>
                        <TableHead className="w-[20%] font-semibold">Matrícula / Placa</TableHead>
                        <TableHead className="w-[22%] font-semibold">VIN (Chassi)</TableHead>
                        <TableHead className="w-[38%] font-semibold">Descrição do Serviço</TableHead>
                        <TableHead className="w-[15%] text-right font-semibold">Valor (€)</TableHead>
                        <TableHead className="w-[5%] text-center"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {editableRows.map((row, idx) => (
                        <TableRow key={row._id} className="hover:bg-muted/20">
                          <TableCell className="p-1.5">
                            <Input
                              value={row.licensePlate}
                              onChange={(e) => {
                                const next = [...editableRows];
                                next[idx].licensePlate = e.target.value.toUpperCase();
                                setEditableRows(next);
                              }}
                              placeholder="Ex: AA-12-BB"
                              className="h-7 text-xs font-mono font-bold"
                            />
                          </TableCell>
                          <TableCell className="p-1.5">
                            <Input
                              value={row.vin}
                              onChange={(e) => {
                                const next = [...editableRows];
                                next[idx].vin = e.target.value.toUpperCase();
                                setEditableRows(next);
                              }}
                              placeholder="VIN opcional"
                              className="h-7 text-[11px] font-mono text-muted-foreground"
                            />
                          </TableCell>
                          <TableCell className="p-1.5">
                            <Input
                              value={row.serviceDescription}
                              onChange={(e) => {
                                const next = [...editableRows];
                                next[idx].serviceDescription = e.target.value;
                                setEditableRows(next);
                              }}
                              placeholder="Ex: DSP, Montagem, Pintura..."
                              className="h-7 text-xs"
                            />
                          </TableCell>
                          <TableCell className="p-1.5 text-right">
                            <Input
                              value={row.amount}
                              onChange={(e) => {
                                const next = [...editableRows];
                                next[idx].amount = e.target.value;
                                setEditableRows(next);
                              }}
                              placeholder="0.00"
                              className="h-7 text-xs text-right font-semibold font-mono"
                            />
                          </TableCell>
                          <TableCell className="p-1.5 text-center">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                setEditableRows(editableRows.filter((_, i) => i !== idx));
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Totalizador */}
              <div className="flex items-center justify-between text-xs p-2.5 rounded-lg border bg-muted/20">
                <span>Arquivo: <strong>{preview.fileName}</strong></span>
                <span className="font-semibold text-foreground">
                  Total da Lista: €
                  {editableRows
                    .reduce((sum, r) => sum + (parseFloat(r.amount.replace(",", ".")) || 0), 0)
                    .toFixed(2)}
                </span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMappingModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium gap-1.5"
              onClick={handleConfirmMappingAndExecute}
              disabled={isExecuting || editableRows.length === 0 || !selectedClientId}
            >
              {isExecuting ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Cruzando dados...
                </>
              ) : (
                <>
                  <FileCheck2 className="h-4 w-4" />
                  Confirmar e Executar Confronto
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Solicitar Correção / Enviar ao Cliente */}
      <Dialog open={discrepancyModalOpen} onOpenChange={setDiscrepancyModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2 text-foreground">
              <Mail className="h-5 w-5 text-amber-500" />
              Solicitar Correção de Divergência ao Cliente
            </DialogTitle>
            <DialogDescription className="text-xs">
              Dispara uma notificação formal por e-mail para a empresa parceira corrigir a divergência identificada no confronto.
            </DialogDescription>
          </DialogHeader>

          {activeDiscrepancyItem && (
            <div className="space-y-3.5 py-1 text-xs">
              {/* Quadro comparativo */}
              <div className="rounded-lg border p-3 bg-amber-500/5 border-amber-500/20 space-y-1.5">
                <div className="flex justify-between font-bold text-sm">
                  <span>Placa: {activeDiscrepancyItem.licensePlate}</span>
                  <span className="text-amber-600 dark:text-amber-400">
                    Diferença: €{activeDiscrepancyItem.differenceAmount}
                  </span>
                </div>
                <div className="text-muted-foreground">{activeDiscrepancyItem.serviceDescription}</div>
                <div className="grid grid-cols-2 gap-2 pt-2 border-t text-[11px]">
                  <div>
                    <span className="text-muted-foreground block">Valor na OS (WEEKLOG):</span>
                    <strong className="text-emerald-600 dark:text-emerald-400 font-mono">
                      €{activeDiscrepancyItem.internalAmount}
                    </strong>
                  </div>
                  <div>
                    <span className="text-muted-foreground block">Valor na Lista do Cliente:</span>
                    <strong className="text-amber-600 dark:text-amber-400 font-mono">
                      €{activeDiscrepancyItem.externalAmount}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">E-mail do Destinatário (Cliente Parceiro) *</Label>
                <Input
                  type="email"
                  value={clientEmailInput}
                  onChange={(e) => setClientEmailInput(e.target.value)}
                  placeholder="exemplo@empresa-cliente.com"
                  className="h-8 text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">Mensagem / Justificativa</Label>
                <Textarea
                  value={discrepancyEmailNotes}
                  onChange={(e) => setDiscrepancyEmailNotes(e.target.value)}
                  rows={4}
                  className="text-xs leading-relaxed"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDiscrepancyModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white font-medium gap-1.5"
              onClick={handleSendDiscrepancyEmail}
              disabled={isSendingEmail || !clientEmailInput.trim()}
            >
              {isSendingEmail ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  Enviar Notificação por E-mail
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 4. Commercial Decision Modal */}
      <Dialog open={Boolean(activeItemForDecision)} onOpenChange={(open) => !open && setActiveItemForDecision(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              Registrar Decisão Comercial sobre Divergência
            </DialogTitle>
            <DialogDescription className="text-xs">
              A decisão tomada fica gravada no histórico de conferência do confronto e não altera o faturamento ou a WEEKLOG.
            </DialogDescription>
          </DialogHeader>

          {activeItemForDecision && (
            <div className="space-y-3.5 py-1">
              <div className="rounded-md border p-3 bg-muted/30 text-xs space-y-1">
                <div className="flex justify-between font-bold">
                  <span>Veículo: {activeItemForDecision.licensePlate}</span>
                  <span className="text-amber-600">Divergência: +€{activeItemForDecision.differenceAmount}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Operix: €{activeItemForDecision.internalAmount}</span>
                  <span>Cliente: €{activeItemForDecision.externalAmount}</span>
                </div>
              </div>

              {activeItemForDecision.weeklogValidationId && (
                <div className="flex items-center justify-between p-2 rounded bg-emerald-500/10 border border-emerald-500/20 text-xs">
                  <span className="text-emerald-700 dark:text-emerald-300 font-medium flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    Validação assinada disponível
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 text-[11px] border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
                    onClick={() => handleViewEvidence(activeItemForDecision)}
                  >
                    Visualizar WEEKLOG assinada
                  </Button>
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Ação a Tomar</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={decisionType === "contest" ? "default" : "outline"}
                    className={decisionType === "contest" ? "bg-amber-600 hover:bg-amber-700 text-white" : ""}
                    onClick={() => setDecisionType("contest")}
                  >
                    Contestar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={decisionType === "accept_difference" ? "default" : "outline"}
                    onClick={() => setDecisionType("accept_difference")}
                  >
                    Registrar Aceite
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={decisionType === "resolve" ? "default" : "outline"}
                    onClick={() => setDecisionType("resolve")}
                  >
                    Marcar como Resolvida
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={decisionType === "pending" ? "default" : "outline"}
                    onClick={() => setDecisionType("pending")}
                  >
                    Manter Pendente
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Observações e Evidências</Label>
                <Textarea
                  placeholder="Justificativa da contestação com menção à WEEKLOG assinada..."
                  value={decisionNotes}
                  onChange={(e) => setDecisionNotes(e.target.value)}
                  className="text-xs h-24"
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setActiveItemForDecision(null)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleSaveDecision}
              disabled={isSavingDecision}
            >
              {isSavingDecision ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Gravando...
                </>
              ) : (
                "Gravar Decisão"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 5. Historical Confrontations Dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <History className="h-4 w-4 text-emerald-600" />
              Histórico de Confrontos Executados
            </DialogTitle>
            <DialogDescription className="text-xs">
              Confrontos salvos e imutáveis. Cada execução preserva o documento original, métricas comparadas e decisões comerciais.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2">
            {isLoadingPastRuns ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground text-xs gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
                <span>Carregando histórico do workspace...</span>
              </div>
            ) : pastRuns.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground text-xs">
                Nenhum confronto salvo anteriormente neste workspace.
              </div>
            ) : (
              <div className="rounded border overflow-x-auto max-h-80 text-xs">
                <Table>
                  <TableHeader className="bg-muted/40">
                    <TableRow>
                      <TableHead className="w-[12%]">Nº</TableHead>
                      <TableHead className="w-[18%]">Data / Hora</TableHead>
                      <TableHead className="w-[20%]">Cliente</TableHead>
                      <TableHead className="w-[15%]">Arquivo</TableHead>
                      <TableHead className="w-[15%] text-center">Itens / Divergências</TableHead>
                      <TableHead className="w-[10%]">Responsável</TableHead>
                      <TableHead className="w-[10%] text-right">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pastRuns.map((r) => (
                      <TableRow key={r.id} className="hover:bg-muted/30 transition-colors">
                        <TableCell className="font-mono font-bold">#{r.runNumber}</TableCell>
                        <TableCell className="text-muted-foreground text-[11px]">
                          {new Date(r.createdAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="font-medium">{r.client.name}</TableCell>
                        <TableCell className="text-[11px] truncate max-w-[120px]" title={r.fileName || ""}>
                          {r.fileName || "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="font-semibold">{r.metrics.totalCompared}</span> itens ·{" "}
                          <span className={r.metrics.valueDifferenceCount > 0 ? "text-amber-600 font-semibold" : "text-emerald-600"}>
                            {r.metrics.valueDifferenceCount} div.
                          </span>
                        </TableCell>
                        <TableCell className="text-[11px] text-muted-foreground">
                          {r.createdBy?.fullName || "Sistema"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2 text-emerald-600 hover:text-emerald-700"
                            onClick={() => handleSelectPastRun(r.id)}
                            disabled={isExecuting}
                          >
                            <Eye className="mr-1 h-3 w-3" />
                            Abrir
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setHistoryOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 6. WEEKLOG Signed Evidence Dialog */}
      <Dialog open={evidenceModalOpen} onOpenChange={setEvidenceModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              Evidência da WEEKLOG Assinada
            </DialogTitle>
            <DialogDescription className="text-xs">
              Validação oficial pelo chefe da oficina vinculada aos serviços do veículo.
            </DialogDescription>
          </DialogHeader>

          <div className="py-2 space-y-3">
            {isLoadingEvidence ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground text-xs gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
                <span>Recuperando comprovante de assinatura...</span>
              </div>
            ) : activeEvidence && activeEvidence.available ? (
              <div className="space-y-3">
                <div className="p-3 rounded-lg border bg-muted/20 text-xs space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Veículo:</span>
                    <span className="font-bold">{activeEvidenceItem?.licensePlate}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Validador Oficial:</span>
                    <span className="font-semibold">{activeEvidence.validatorName || "Chefe de Oficina"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Data da Assinatura:</span>
                    <span>{activeEvidence.signedAt ? new Date(activeEvidence.signedAt).toLocaleString() : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sequência / Rodada:</span>
                    <Badge variant="outline" className="text-[10px]">
                      Rodada #{activeEvidence.sequence || 1}
                    </Badge>
                  </div>
                </div>

                {activeEvidence.signatureUrl ? (
                  <div className="space-y-2">
                    <span className="text-xs font-medium text-muted-foreground">Assinatura Digital Gravada:</span>
                    <div className="rounded-lg border bg-white dark:bg-zinc-950 p-4 text-center">
                      <img
                        src={activeEvidence.signatureUrl}
                        alt="Assinatura da WEEKLOG"
                        className="max-h-40 mx-auto object-contain filter dark:invert"
                      />
                    </div>
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-xs h-7"
                        onClick={() => window.open(activeEvidence.signatureUrl!, "_blank")}
                      >
                        <ExternalLink className="mr-1.5 h-3 w-3" />
                        Abrir Arquivo em Nova Aba
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 text-center rounded border border-amber-500/20 bg-amber-500/5 text-xs text-amber-700 dark:text-amber-300">
                    Validação confirmada, porém o arquivo de assinatura não foi anexado.
                  </div>
                )}
              </div>
            ) : (
              <div className="p-6 text-center rounded-lg border border-border text-xs text-muted-foreground space-y-2">
                <AlertTriangle className="h-8 w-8 mx-auto text-amber-500" />
                <p className="font-semibold text-foreground">Evidência não disponível</p>
                <p className="text-[11px]">
                  {activeEvidence?.notes || "Não há arquivo de assinatura digital registrado para a rodada de validação deste veículo."}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEvidenceModalOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
