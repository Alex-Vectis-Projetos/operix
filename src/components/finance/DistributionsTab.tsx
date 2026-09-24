import React, { useState, useMemo } from "react";
import { Plus, XCircle, AlertTriangle, Search, Filter, PieChart, Users, Building, User } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useDistributions,
  useCreateDistribution,
  useCancelDistribution,
  prepareCommand,
  type CreateDistributionInput,
  type Distribution,
  type DistributionParticipant,
  type DistributionAllocation,
} from "@/hooks/useFinance";
import { usePaymentLists, usePaymentList } from "@/hooks/usePaymentLists";
import { usePeople } from "@/hooks/usePeople";
import { useClients } from "@/hooks/useServiceOrders";
import { useWorkspace } from "@/hooks/useWorkspace";
import { formatFinanceMoney, formatFinanceDate } from "@/lib/financeFormatters";

interface DistributionsTabProps {
  canMutate?: boolean;
}

export function DistributionsTab({ canMutate = true }: DistributionsTabProps) {
  const { data: distributionsData, isLoading, error } = useDistributions();
  const distributions: Distribution[] = useMemo(() => {
    if (!distributionsData) return [];
    if (Array.isArray(distributionsData)) return distributionsData;
    return (distributionsData as any).items || [];
  }, [distributionsData]);

  const createMutation = useCreateDistribution();
  const cancelMutation = useCancelDistribution();

  const { workspaceId, workspaceName } = useWorkspace();
  const { data: paymentLists = [] } = usePaymentLists();
  const { people = [] } = usePeople();
  const { data: clients = [] } = useClients();

  // Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  // Create Dialog State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedPaymentListId, setSelectedPaymentListId] = useState("");
  const [selectedPaymentListItemId, setSelectedPaymentListItemId] = useState("");
  const [participantKind, setParticipantKind] = useState<"person" | "workspace" | "client">("person");
  const [participantId, setParticipantId] = useState("");
  const [allocationMode, setAllocationMode] = useState<"fixed" | "percentage">("fixed");
  const [allocationValue, setAllocationValue] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  // Selected PaymentList details for items
  const { data: selectedPaymentList } = usePaymentList(selectedPaymentListId || null);

  // Cancel Dialog State
  const [cancelTarget, setCancelTarget] = useState<Distribution | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);

  const filteredDistributions = useMemo(() => {
    return distributions.filter((d) => {
      const matchStatus = selectedStatus === "all" || d.status === selectedStatus;
      const term = searchTerm.toLowerCase().trim();
      const pId =
        d.participant.kind === "person"
          ? d.participant.personId
          : d.participant.kind === "workspace"
          ? d.participant.workspaceId
          : d.participant.clientId;

      const matchSearch =
        !term ||
        d.paymentListId.toLowerCase().includes(term) ||
        pId.toLowerCase().includes(term) ||
        d.resolvedAmount.includes(term) ||
        d.currencyCode.toLowerCase().includes(term);
      return matchStatus && matchSearch;
    });
  }, [distributions, selectedStatus, searchTerm]);

  const handleOpenCreate = () => {
    setSelectedPaymentListId(paymentLists[0]?.id || "");
    setSelectedPaymentListItemId("");
    setParticipantKind("person");
    setParticipantId(people[0]?.id || "");
    setAllocationMode("fixed");
    setAllocationValue("");
    setCreateError(null);
    setIsCreateOpen(true);
  };

  const handlePaymentListChange = (plId: string) => {
    setSelectedPaymentListId(plId);
    setSelectedPaymentListItemId("");
  };

  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!selectedPaymentListId) {
      setCreateError("Selecione uma Lista de Pagamento.");
      return;
    }

    const cleanVal = allocationValue.trim();
    if (!cleanVal || cleanVal === "0" || cleanVal.startsWith("-")) {
      setCreateError("Informe um valor ou percentual positivo válido.");
      return;
    }

    let participant: DistributionParticipant;
    if (participantKind === "workspace") {
      participant = { kind: "workspace", workspaceId: workspaceId || "" };
    } else if (participantKind === "client") {
      if (!participantId) {
        setCreateError("Selecione o cliente participante.");
        return;
      }
      participant = { kind: "client", clientId: participantId };
    } else {
      if (!participantId) {
        setCreateError("Selecione a pessoa participante.");
        return;
      }
      participant = { kind: "person", personId: participantId };
    }

    let allocation: DistributionAllocation;
    if (allocationMode === "percentage") {
      allocation = { mode: "percentage", percentage: cleanVal };
    } else {
      allocation = { mode: "fixed", amount: cleanVal };
    }

    const input: CreateDistributionInput = {
      paymentListId: selectedPaymentListId,
      paymentListItemId: selectedPaymentListItemId || undefined,
      participant,
      allocation,
    };

    try {
      const envelope = prepareCommand(input);
      await createMutation.mutateAsync(envelope);
      setIsCreateOpen(false);
    } catch (err: any) {
      setCreateError(err.message || "Erro ao registrar a distribuição.");
    }
  };

  const handleOpenCancel = (dist: Distribution) => {
    setCancelTarget(dist);
    setCancelReason("");
    setCancelError(null);
  };

  const handleSubmitCancel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelTarget) return;
    setCancelError(null);

    const reason = cancelReason.trim();
    if (!reason || reason.length < 3) {
      setCancelError("Justificativa obrigatória (mínimo 3 caracteres).");
      return;
    }

    try {
      await cancelMutation.mutateAsync({
        distributionId: cancelTarget.id,
        input: { reason },
      });
      setCancelTarget(null);
    } catch (err: any) {
      setCancelError(err.message || "Erro ao cancelar a distribuição.");
    }
  };

  const getParticipantLabel = (p: DistributionParticipant) => {
    if (p.kind === "workspace") return workspaceName || "Empresa / Workspace";
    if (p.kind === "person") {
      const person = people.find((item) => item.id === p.personId);
      return person ? person.full_name : `Pessoa (${p.personId.slice(0, 8)}...)`;
    }
    if (p.kind === "client") {
      const client = clients.find((item) => item.id === p.clientId);
      return client ? client.name : `Cliente (${p.clientId.slice(0, 8)}...)`;
    }
    return "Desconhecido";
  };

  return (
    <div className="space-y-4" data-testid="distributions-tab-content">
      {/* Top Banner: Zero-Cash Semantics Notice */}
      <div className="p-3 bg-muted/30 border border-border/60 rounded-lg text-xs text-muted-foreground flex items-center gap-2">
        <PieChart className="h-4 w-4 text-primary shrink-0" />
        <span>
          <strong>Repasses e Distribuições Manuais:</strong> Representam a alocação de direitos e participações sobre Listas de Pagamento. A efetivação financeira e saída de caixa ocorrem exclusivamente na liquidação de Obrigações.
        </span>
      </div>

      {/* Action and Filter Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar distribuições..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 h-9 text-xs"
              data-testid="distribution-search-input"
            />
          </div>

          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger className="h-9 w-[150px] text-xs">
              <Filter className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="active">Ativas</SelectItem>
              <SelectItem value="cancelled">Canceladas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {canMutate && (
          <Button
            size="sm"
            onClick={handleOpenCreate}
            className="h-9 gap-1.5 shrink-0"
            data-testid="btn-new-distribution"
          >
            <Plus className="h-4 w-4" />
            <span>Nova Distribuição</span>
          </Button>
        )}
      </div>

      {/* Distributions Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      ) : error ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-4 text-sm text-destructive">
            Erro ao carregar distribuições: {(error as Error)?.message}
          </CardContent>
        </Card>
      ) : filteredDistributions.length === 0 ? (
        <Card className="border-border/50 bg-muted/20">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <PieChart className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <h3 className="text-sm font-semibold text-foreground">Nenhuma distribuição encontrada</h3>
            <p className="text-xs text-muted-foreground max-w-sm mt-1">
              {distributions.length === 0
                ? "Crie distribuições manuais para alocar participações de técnicos, parceiros ou da empresa sobre listas de pagamento."
                : "Nenhuma distribuição corresponde aos filtros aplicados."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-md bg-card overflow-x-auto">
          <Table data-testid="distributions-table">
            <TableHeader>
              <TableRow className="bg-muted/40 text-xs">
                <TableHead className="w-[120px]">Lista / Origem</TableHead>
                <TableHead>Participante</TableHead>
                <TableHead className="w-[120px]">Modalidade</TableHead>
                <TableHead className="w-[110px]">Alocação</TableHead>
                <TableHead className="text-right w-[130px]">Valor Resolvido</TableHead>
                <TableHead className="w-[100px] text-center">Status</TableHead>
                {canMutate && <TableHead className="w-[100px] text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredDistributions.map((dist) => {
                const isActive = dist.status === "active";
                const isCancelled = dist.status === "cancelled";

                return (
                  <TableRow
                    key={dist.id}
                    className={`text-xs hover:bg-muted/50 ${isCancelled ? "opacity-60 bg-muted/20" : ""}`}
                    data-testid={`distribution-row-${dist.id}`}
                  >
                    <TableCell className="font-mono whitespace-nowrap text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {dist.paymentListId.slice(0, 8)}...
                      </span>
                      {dist.paymentListItemId && (
                        <div className="text-[10px] text-muted-foreground">Item: {dist.paymentListItemId.slice(0, 6)}</div>
                      )}
                    </TableCell>
                    <TableCell className="font-medium whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {dist.participant.kind === "workspace" && <Building className="h-3.5 w-3.5 text-blue-500" />}
                        {dist.participant.kind === "person" && <User className="h-3.5 w-3.5 text-emerald-500" />}
                        {dist.participant.kind === "client" && <Users className="h-3.5 w-3.5 text-indigo-500" />}
                        <span>{getParticipantLabel(dist.participant)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant="outline" className="text-[11px] font-normal">
                        {dist.allocation.mode === "fixed" ? "Valor Fixo" : "Percentual"}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs whitespace-nowrap">
                      {dist.allocation.mode === "percentage"
                        ? `${dist.allocation.percentage}%`
                        : formatFinanceMoney(dist.allocation.amount, dist.currencyCode)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono font-medium whitespace-nowrap ${
                        isCancelled ? "line-through text-muted-foreground" : "text-foreground"
                      }`}
                    >
                      {formatFinanceMoney(dist.resolvedAmount, dist.currencyCode)}
                    </TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      {isActive && (
                        <Badge variant="secondary" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 text-[10px]">
                          Ativa
                        </Badge>
                      )}
                      {isCancelled && (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[10px]" title={dist.cancellationReason || undefined}>
                          Cancelada
                        </Badge>
                      )}
                    </TableCell>
                    {canMutate && (
                      <TableCell className="text-right whitespace-nowrap">
                        {isActive ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenCancel(dist)}
                            className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                            data-testid={`btn-cancel-distribution-${dist.id}`}
                          >
                            <XCircle className="h-3.5 w-3.5 mr-1" />
                            Cancelar
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground italic pr-2">Cancelada</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* CREATE DISTRIBUTION DIALOG */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <form onSubmit={handleSubmitCreate}>
            <DialogHeader>
              <DialogTitle className="text-base font-semibold">Nova Distribuição Manual</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Aloque um valor fixo ou percentual sobre uma Lista de Pagamento para um participante.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {createError && (
                <div className="p-3 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-md flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              {/* Payment List Selector */}
              <div className="space-y-1.5">
                <Label htmlFor="dist-payment-list" className="text-xs">
                  Lista de Pagamento <span className="text-destructive">*</span>
                </Label>
                <Select value={selectedPaymentListId} onValueChange={handlePaymentListChange}>
                  <SelectTrigger id="dist-payment-list" data-testid="select-dist-payment-list">
                    <SelectValue placeholder="Selecione uma lista..." />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentLists.map((pl) => (
                      <SelectItem key={pl.id} value={pl.id}>
                        {pl.listNumber || pl.id.slice(0, 8)} — Total: {pl.recognizedTotal || pl.sourceDocumentTotal || "0"} {pl.currencyCode} ({pl.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Optional Payment List Item */}
              {selectedPaymentList?.items && selectedPaymentList.items.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="dist-payment-list-item" className="text-xs text-muted-foreground">
                    Item da Lista (Opcional)
                  </Label>
                  <Select
                    value={selectedPaymentListItemId || "all"}
                    onValueChange={(v) => setSelectedPaymentListItemId(v === "all" ? "" : v)}
                  >
                    <SelectTrigger id="dist-payment-list-item" className="text-xs">
                      <SelectValue placeholder="Aplicar na lista inteira" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Lista Inteira (Geral)</SelectItem>
                      {selectedPaymentList.items.map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.carName || item.licensePlate || item.id.slice(0, 6)} — {item.totalAmount}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Participant Type and Selector */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="dist-participant-type" className="text-xs">
                    Tipo de Participante <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={participantKind}
                    onValueChange={(v) => {
                      setParticipantKind(v as any);
                      if (v === "workspace") setParticipantId(workspaceId || "");
                      else if (v === "person") setParticipantId(people[0]?.id || "");
                      else if (v === "client") setParticipantId(clients[0]?.id || "");
                    }}
                  >
                    <SelectTrigger id="dist-participant-type" data-testid="select-participant-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="person">Pessoa / Técnico</SelectItem>
                      <SelectItem value="workspace">Empresa (Workspace)</SelectItem>
                      <SelectItem value="client">Cliente</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="dist-participant-id" className="text-xs">
                    Participante <span className="text-destructive">*</span>
                  </Label>
                  {participantKind === "workspace" ? (
                    <Input
                      id="dist-participant-id"
                      value={workspaceName || "Empresa Ativa"}
                      disabled
                      className="text-xs bg-muted"
                    />
                  ) : participantKind === "person" ? (
                    <Select value={participantId} onValueChange={setParticipantId}>
                      <SelectTrigger id="dist-participant-id" data-testid="select-dist-person">
                        <SelectValue placeholder="Selecione a pessoa..." />
                      </SelectTrigger>
                      <SelectContent>
                        {people.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Select value={participantId} onValueChange={setParticipantId}>
                      <SelectTrigger id="dist-participant-id" data-testid="select-dist-client">
                        <SelectValue placeholder="Selecione o cliente..." />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name || c.id.slice(0, 8)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>

              {/* Allocation Mode and Value */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="dist-alloc-mode" className="text-xs">
                    Modalidade <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={allocationMode}
                    onValueChange={(v) => setAllocationMode(v as any)}
                  >
                    <SelectTrigger id="dist-alloc-mode" data-testid="select-alloc-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fixed">Valor Fixo</SelectItem>
                      <SelectItem value="percentage">Percentual (%)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="dist-alloc-value" className="text-xs">
                    {allocationMode === "fixed" ? "Valor" : "Percentual"} <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="dist-alloc-value"
                    data-testid="input-dist-value"
                    placeholder={allocationMode === "fixed" ? "0.00" : "10.00"}
                    value={allocationValue}
                    onChange={(e) => setAllocationValue(e.target.value)}
                    required
                    className="font-mono text-sm"
                  />
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCreateOpen(false)}
                disabled={createMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={createMutation.isPending}
                data-testid="btn-submit-distribution"
              >
                {createMutation.isPending ? "Gravando..." : "Criar Distribuição"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* CANCEL DISTRIBUTION DIALOG */}
      <Dialog open={Boolean(cancelTarget)} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <form onSubmit={handleSubmitCancel}>
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-destructive flex items-center gap-2">
                <XCircle className="h-5 w-5" />
                Cancelar Distribuição
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                O cancelamento invalida o direito de repasse. Caso já existam obrigações liquidadas vinculadas, o cancelamento será recusado pelo servidor.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-4">
              {cancelTarget && (
                <div className="p-3 bg-muted/50 rounded-md text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Valor Resolvido:</span>
                    <span className="font-mono font-bold">
                      {formatFinanceMoney(cancelTarget.resolvedAmount, cancelTarget.currencyCode)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Participante:</span>
                    <span>{getParticipantLabel(cancelTarget.participant)}</span>
                  </div>
                </div>
              )}

              {cancelError && (
                <div className="p-2 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-md">
                  {cancelError}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="dist-cancel-reason" className="text-xs">
                  Justificativa do Cancelamento <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="dist-cancel-reason"
                  data-testid="input-cancel-distribution-reason"
                  placeholder="Informe o motivo detalhado do cancelamento..."
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  required
                  rows={3}
                  className="text-xs"
                />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCancelTarget(null)}
                disabled={cancelMutation.isPending}
              >
                Voltar
              </Button>
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={cancelMutation.isPending}
                data-testid="btn-confirm-cancel-distribution"
              >
                {cancelMutation.isPending ? "Cancelando..." : "Confirmar Cancelamento"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
