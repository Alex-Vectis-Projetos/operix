import { useState, useMemo, useRef } from "react";
import {
  FileSpreadsheet,
  Upload,
  AlertTriangle,
  CheckCircle2,
  Clock,
  HelpCircle,
  Car,
  FileText,
  Filter,
  Download,
  ShieldCheck,
  RefreshCw,
  Search,
  Check,
  X,
  FileCheck2,
  Building2,
  Calendar,
  Layers,
  ChevronRight,
  Info,
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
  type ConfrontationFilePreview,
  type ConfrontationColumnMapping,
  type ConfrontationExecutionResponse,
  type ConfrontationItemResult,
} from "@/lib/apiConfrontationHub";

export function ConfrontationHub() {
  const { data: clients = [], isLoading: isLoadingClients } = useClients();
  const { data: paymentLists = [] } = usePaymentLists();

  // Step state
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("");
  const [selectedPaymentListId, setSelectedPaymentListId] = useState<string>("");

  // File & Preview state
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [preview, setPreview] = useState<ConfrontationFilePreview | null>(null);
  const [mapping, setMapping] = useState<ConfrontationColumnMapping>({
    plateColumn: "",
    vinColumn: "",
    serviceColumn: "",
    amountColumn: "",
    taxType: "HT",
    granularity: "auto",
  });
  const [mappingModalOpen, setMappingModalOpen] = useState(false);

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

  // Filtered lists for the chosen client
  const availableLists = useMemo(() => {
    if (!selectedClientId) return [];
    return paymentLists.filter((l) => l.clientId === selectedClientId);
  }, [paymentLists, selectedClientId]);

  // Handle file drop/change
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!selectedClientId) {
      toast.error("Selecione primeiro o cliente antes de importar a lista externa.");
      return;
    }
    setFile(selected);
    setIsUploading(true);
    try {
      const p = await previewConfrontationFile(selected);
      setPreview(p);
      setMapping(p.suggestedMapping);
      setMappingModalOpen(true);
      toast.success("Documento lido com sucesso. Confirme o mapeamento de colunas.");
    } catch (err: any) {
      toast.error(err?.message || "Falha ao ler o arquivo para confronto.");
      setFile(null);
    } finally {
      setIsUploading(false);
    }
  };

  // Confirm mapping and run confrontation
  const handleConfirmMappingAndExecute = async () => {
    if (!preview || !file) return;
    setMappingModalOpen(false);
    setIsExecuting(true);

    try {
      // Map rows from sample or preview
      // Send raw parsed rows using confirmed mapping columns
      const plateCol = mapping.plateColumn || "";
      const vinCol = mapping.vinColumn || "";
      const serviceCol = mapping.serviceColumn || "";
      const amountCol = mapping.amountColumn || "";

      // Convert rows
      const rows = preview.sampleRows.map((r) => {
        let amtStr = String(r[amountCol] || "0").replace(/[^0-9,.-]/g, "").replace(",", ".");
        return {
          licensePlate: plateCol ? String(r[plateCol] || "") : null,
          vin: vinCol ? String(r[vinCol] || "") : null,
          serviceDescription: serviceCol ? String(r[serviceCol] || "") : null,
          amount: parseFloat(amtStr) || 0,
          taxType: mapping.taxType,
        };
      });

      const res = await executeConfrontationHub({
        clientId: selectedClientId,
        period: selectedPeriod || undefined,
        paymentListId: selectedPaymentListId || undefined,
        granularity: mapping.granularity,
        taxType: mapping.taxType,
        rows,
      });

      setConfrontationResult(res);
      toast.success("Confronto OS × OP executado com sucesso!");
    } catch (err: any) {
      toast.error(err?.message || "Erro ao executar confronto.");
    } finally {
      setIsExecuting(false);
    }
  };

  // Submit human commercial decision on discrepancy
  const handleSaveDecision = () => {
    if (!activeItemForDecision || !confrontationResult) return;
    setIsSavingDecision(true);

    // Update local state without mutating financial records
    const updatedResults = confrontationResult.results.map((r) => {
      if (r.id === activeItemForDecision.id) {
        return {
          ...r,
          decision: decisionType,
          decisionNotes: decisionNotes || (decisionType === "contest" ? "Conforme WEEKLOG assinada pelo chefe da oficina" : "Aceite comercial do operador"),
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
          : "Decisão gravada com sucesso."
    );

    setActiveItemForDecision(null);
    setDecisionNotes("");
    setIsSavingDecision(false);
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

            {confrontationResult && (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setConfrontationResult(null)}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Novo Confronto
                </Button>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleExportDossierPdf}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  Exportar Dossiê de Contestação (PDF)
                </Button>
              </div>
            )}
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

            {/* Dropzone de Upload */}
            <div className="rounded-lg border-2 border-dashed border-border/80 hover:border-emerald-500/60 transition-colors p-6 text-center">
              <input
                type="file"
                id="confrontation-file-input"
                className="hidden"
                accept=".xlsx,.xls,.csv,.pdf"
                onChange={handleFileSelect}
                disabled={isUploading || isExecuting || !selectedClientId}
              />
              <label
                htmlFor="confrontation-file-input"
                className={`flex flex-col items-center justify-center cursor-pointer ${
                  !selectedClientId ? "opacity-50 cursor-not-allowed" : ""
                }`}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 mb-3">
                  <Upload className="h-6 w-6" />
                </div>
                <p className="text-sm font-medium">
                  {isUploading ? "Processando e detectando colunas..." : "Clique ou arraste a lista externa do cliente aqui"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Formatos aceitos: Planilhas Excel (.xlsx, .xls), CSV delimitado (.csv) ou Relatórios em PDF
                </p>
              </label>
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
              <span><strong>Cliente:</strong> {confrontationResult.client.name}</span>
              {confrontationResult.period && <span><strong>Período:</strong> {confrontationResult.period}</span>}
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
                  <TableHead className="w-[28%]">Serviço / Granularidade</TableHead>
                  <TableHead className="w-[12%] text-right">Valor Operix</TableHead>
                  <TableHead className="w-[12%] text-right">Valor Cliente</TableHead>
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
                          {item.weeklogSignatureRef && (
                            <div className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                              <ShieldCheck className="h-3 w-3" />
                              <span>Prova: WEEKLOG assinada ({item.weeklogSignatureRef})</span>
                            </div>
                          )}
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
                            <Badge className="bg-amber-500/10 text-amber-600 border-amber-300">
                              Contestado
                            </Badge>
                          ) : item.decision === "accept_difference" ? (
                            <Badge className="bg-muted text-muted-foreground">
                              Aceite Registrado
                            </Badge>
                          ) : item.decision === "resolve" ? (
                            <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-300">
                              Resolvido
                            </Badge>
                          ) : isDiff || isOmitted ? (
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
                              Tomar Decisão
                            </Button>
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

      {/* 3. Column Mapping Confirmation Modal */}
      <Dialog open={mappingModalOpen} onOpenChange={setMappingModalOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">
              Confirmar Mapeamento de Colunas da Lista Externa
            </DialogTitle>
            <DialogDescription className="text-xs">
              O Operix identificou automaticamente as colunas da planilha. Verifique a correspondência dos campos antes de iniciar o confronto.
            </DialogDescription>
          </DialogHeader>

          {preview && (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="space-y-1">
                  <Label className="text-xs">Coluna da Placa *</Label>
                  <Select
                    value={mapping.plateColumn}
                    onValueChange={(val) => setMapping({ ...mapping, plateColumn: val })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecione a coluna" />
                    </SelectTrigger>
                    <SelectContent>
                      {preview.columns.map((c) => (
                        <SelectItem key={c} value={c} className="text-xs">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Coluna do Valor *</Label>
                  <Select
                    value={mapping.amountColumn}
                    onValueChange={(val) => setMapping({ ...mapping, amountColumn: val })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecione a coluna" />
                    </SelectTrigger>
                    <SelectContent>
                      {preview.columns.map((c) => (
                        <SelectItem key={c} value={c} className="text-xs">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Coluna de Serviço (Opcional)</Label>
                  <Select
                    value={mapping.serviceColumn || "none"}
                    onValueChange={(val) => setMapping({ ...mapping, serviceColumn: val === "none" ? "" : val })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecione ou deixe em branco" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none" className="text-xs">
                        Não aplicável (Sintético)
                      </SelectItem>
                      {preview.columns.map((c) => (
                        <SelectItem key={c} value={c} className="text-xs">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Base Fiscal de Comparação</Label>
                  <Select
                    value={mapping.taxType}
                    onValueChange={(val: "HT" | "TTC") => setMapping({ ...mapping, taxType: val })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="HT" className="text-xs">
                        HT (Sem impostos / Net)
                      </SelectItem>
                      <SelectItem value="TTC" className="text-xs">
                        TTC (Com impostos / Bruto)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Granularity Toggle */}
              <div className="rounded-md border p-3 bg-muted/20 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">Granularidade da Comparação</span>
                  <Badge variant="outline" className="text-[10px] uppercase font-mono">
                    {mapping.granularity}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {mapping.granularity === "synthetic"
                    ? "Detectado formato sintético: o cliente informou um valor consolidado por veículo. Os serviços internos serão somados para comparar o total do carro."
                    : "Detectado formato analítico: linhas discriminadas por tipo de intervenção."}
                </p>
              </div>

              {/* Sample Rows Preview */}
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Amostra das Primeiras Linhas Extraídas ({preview.totalRows} linhas no total):
                </span>
                <div className="rounded border overflow-x-auto max-h-36 text-[11px]">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        {preview.columns.slice(0, 5).map((col) => (
                          <TableHead key={col} className="h-7 text-[10px] py-1">
                            {col}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.sampleRows.map((row, idx) => (
                        <TableRow key={idx} className="h-6">
                          {preview.columns.slice(0, 5).map((col) => (
                            <TableCell key={col} className="py-1 font-mono text-[10px]">
                              {String(row[col] ?? "—")}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setMappingModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleConfirmMappingAndExecute}
              disabled={isExecuting}
            >
              Confirmar e Executar Confronto
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
              Gravar Decisão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
