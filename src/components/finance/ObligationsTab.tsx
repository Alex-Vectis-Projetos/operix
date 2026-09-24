import React, { useState, useMemo } from "react";
import { Plus, CheckCircle, RotateCcw, XCircle, AlertTriangle, Search, Filter, Building, User, Users } from "lucide-react";
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
  useObligations,
  useDistributions,
  useCreateObligation,
  useCancelObligation,
  useSettleObligation,
  useReverseObligationPayment,
  prepareCommand,
  type CreateObligationInput,
  type FinancialObligation,
  type Distribution,
  type DistributionParticipant,
} from "@/hooks/useFinance";
import { usePeople } from "@/hooks/usePeople";
import { useClients } from "@/hooks/useServiceOrders";
import { useWorkspace } from "@/hooks/useWorkspace";
import { formatFinanceMoney, formatFinanceDate } from "@/lib/financeFormatters";

interface ObligationsTabProps {
  canMutate?: boolean;
}

export function ObligationsTab({ canMutate = true }: ObligationsTabProps) {
  const { data: obligationsData, isLoading, error } = useObligations();
  const obligations: FinancialObligation[] = useMemo(() => {
    if (!obligationsData) return [];
    if (Array.isArray(obligationsData)) return obligationsData;
    return (obligationsData as any).items || [];
  }, [obligationsData]);

  const { data: distributionsData } = useDistributions();
  const distributions: Distribution[] = useMemo(() => {
    if (!distributionsData) return [];
    if (Array.isArray(distributionsData)) return distributionsData;
    return (distributionsData as any).items || [];
  }, [distributionsData]);

  const createMutation = useCreateObligation();
  const cancelMutation = useCancelObligation();
  const settleMutation = useSettleObligation();
  const reversePaymentMutation = useReverseObligationPayment();

  const { workspaceName } = useWorkspace();
  const { people = [] } = usePeople();
  const { data: clients = [] } = useClients();

  // Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  // Create Dialog State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedDistributionId, setSelectedDistributionId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  // Settle Dialog State
  const [settleTarget, setSettleTarget] = useState<FinancialObligation | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);

  // Cancel Obligation Dialog State
  const [cancelTarget, setCancelTarget] = useState<FinancialObligation | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Reverse Payment Dialog State
  const [reversePaymentTarget, setReversePaymentTarget] = useState<FinancialObligation | null>(null);
  const [reversePaymentReason, setReversePaymentReason] = useState("");
  const [reversePaymentError, setReversePaymentError] = useState<string | null>(null);

  // Active eligible distributions that do not already have pending or paid obligations
  const eligibleDistributions = useMemo(() => {
    return distributions.filter((d) => d.status === "active");
  }, [distributions]);

  const getParticipant = React.useCallback(
    (ob: FinancialObligation): DistributionParticipant | null => {
      if (ob.distribution?.participant) return ob.distribution.participant;
      const dist = distributions.find((d) => d.id === ob.distributionId);
      return dist?.participant || null;
    },
    [distributions]
  );

  const getParticipantLabel = React.useCallback(
    (participant: DistributionParticipant | null) => {
      if (!participant) return "—";
      if (participant.kind === "workspace") return workspaceName || "Empresa / Workspace";
      if (participant.kind === "person") {
        const p = people.find((item) => item.id === participant.personId);
        return p ? p.full_name : `Pessoa (${participant.personId.slice(0, 8)}...)`;
      }
      if (participant.kind === "client") {
        const c = clients.find((item) => item.id === participant.clientId);
        return c ? c.name : `Cliente (${participant.clientId.slice(0, 8)}...)`;
      }
      return "Desconhecido";
    },
    [workspaceName, people, clients]
  );

  const filteredObligations = useMemo(() => {
    return obligations.filter((o) => {
      const matchStatus = selectedStatus === "all" || o.status === selectedStatus;
      const term = searchTerm.toLowerCase().trim();
      const p = getParticipant(o);
      const pLabel = getParticipantLabel(p).toLowerCase();

      const matchSearch =
        !term ||
        o.id.toLowerCase().includes(term) ||
        o.distributionId.toLowerCase().includes(term) ||
        pLabel.includes(term) ||
        o.amount.includes(term) ||
        o.currencyCode.toLowerCase().includes(term);
      return matchStatus && matchSearch;
    });
  }, [obligations, selectedStatus, searchTerm, getParticipant, getParticipantLabel]);

  const handleOpenCreate = () => {
    setSelectedDistributionId(eligibleDistributions[0]?.id || "");
    setCreateError(null);
    setIsCreateOpen(true);
  };

  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!selectedDistributionId) {
      setCreateError("Selecione uma Distribuição ativa.");
      return;
    }

    const input: CreateObligationInput = {
      distributionId: selectedDistributionId,
    };

    try {
      const envelope = prepareCommand(input);
      await createMutation.mutateAsync(envelope);
      setIsCreateOpen(false);
    } catch (err: any) {
      setCreateError(err.message || "Erro ao gerar a obrigação financeira.");
    }
  };

  const handleOpenSettle = (ob: FinancialObligation) => {
    setSettleTarget(ob);
    setSettleError(null);
  };

  const handleConfirmSettle = async () => {
    if (!settleTarget) return;
    setSettleError(null);

    try {
      await settleMutation.mutateAsync({
        obligationId: settleTarget.id,
      });
      setSettleTarget(null);
    } catch (err: any) {
      setSettleError(err.message || "Erro ao liquidar a obrigação.");
    }
  };

  const handleOpenCancel = (ob: FinancialObligation) => {
    setCancelTarget(ob);
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
        obligationId: cancelTarget.id,
        input: { reason },
      });
      setCancelTarget(null);
    } catch (err: any) {
      setCancelError(err.message || "Erro ao cancelar a obrigação.");
    }
  };

  const handleOpenReversePayment = (ob: FinancialObligation) => {
    setReversePaymentTarget(ob);
    setReversePaymentReason("");
    setReversePaymentError(null);
  };

  const handleSubmitReversePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reversePaymentTarget) return;
    setReversePaymentError(null);

    const paymentId = reversePaymentTarget.payment?.id || "payment-0";
    const reason = reversePaymentReason.trim();
    if (!reason || reason.length < 3) {
      setReversePaymentError("Justificativa obrigatória (mínimo 3 caracteres).");
      return;
    }

    try {
      await reversePaymentMutation.mutateAsync({
        obligationId: reversePaymentTarget.id,
        paymentId,
        input: { reason },
      });
      setReversePaymentTarget(null);
    } catch (err: any) {
      setReversePaymentError(err.message || "Erro ao estornar a liquidação.");
    }
  };

  const selectedDistDetails = distributions.find((d) => d.id === selectedDistributionId);

  return (
    <div className="space-y-4" data-testid="obligations-tab-content">
      {/* Action and Filter Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar obrigações..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 h-9 text-xs"
              data-testid="obligation-search-input"
            />
          </div>

          <Select value={selectedStatus} onValueChange={setSelectedStatus}>
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <Filter className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="pending">Pendentes</SelectItem>
              <SelectItem value="paid">Liquidadas (Pagas)</SelectItem>
              <SelectItem value="reversed">Estornadas</SelectItem>
              <SelectItem value="cancelled">Canceladas</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {canMutate && (
          <Button
            size="sm"
            onClick={handleOpenCreate}
            className="h-9 gap-1.5 shrink-0"
            data-testid="btn-new-obligation"
          >
            <Plus className="h-4 w-4" />
            <span>Nova Obrigação</span>
          </Button>
        )}
      </div>

      {/* Obligations Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      ) : error ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-4 text-sm text-destructive">
            Erro ao carregar obrigações: {(error as Error)?.message}
          </CardContent>
        </Card>
      ) : filteredObligations.length === 0 ? (
        <Card className="border-border/50 bg-muted/20">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <h3 className="text-sm font-semibold text-foreground">Nenhuma obrigação encontrada</h3>
            <p className="text-xs text-muted-foreground max-w-sm mt-1">
              {obligations.length === 0
                ? "Gere obrigações financeiras a partir de distribuições aprovadas para habilitar a liquidação e saída de caixa."
                : "Nenhuma obrigação corresponde aos filtros aplicados."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-md bg-card overflow-x-auto">
          <Table data-testid="obligations-table">
            <TableHeader>
              <TableRow className="bg-muted/40 text-xs">
                <TableHead className="w-[120px]">Distribuição</TableHead>
                <TableHead>Beneficiário</TableHead>
                <TableHead className="w-[110px]">Data Criação</TableHead>
                <TableHead className="text-right w-[130px]">Valor</TableHead>
                <TableHead className="w-[110px] text-center">Status</TableHead>
                <TableHead className="w-[140px]">Liquidação</TableHead>
                {canMutate && <TableHead className="w-[140px] text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredObligations.map((ob) => {
                const isPending = ob.status === "pending";
                const isPaid = ob.status === "paid";
                const isReversed = ob.status === "reversed";
                const isCancelled = ob.status === "cancelled";
                const participant = getParticipant(ob);

                return (
                  <TableRow
                    key={ob.id}
                    className={`text-xs hover:bg-muted/50 ${
                      isCancelled || isReversed ? "opacity-60 bg-muted/20" : ""
                    }`}
                    data-testid={`obligation-row-${ob.id}`}
                  >
                    <TableCell className="font-mono whitespace-nowrap text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {ob.distributionId.slice(0, 8)}...
                      </span>
                    </TableCell>
                    <TableCell className="font-medium whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {participant?.kind === "workspace" && <Building className="h-3.5 w-3.5 text-blue-500" />}
                        {participant?.kind === "person" && <User className="h-3.5 w-3.5 text-emerald-500" />}
                        {participant?.kind === "client" && <Users className="h-3.5 w-3.5 text-indigo-500" />}
                        <span>{getParticipantLabel(participant)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatFinanceDate(ob.createdAt)}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono font-medium whitespace-nowrap ${
                        isCancelled || isReversed ? "line-through text-muted-foreground" : "text-foreground"
                      }`}
                    >
                      {formatFinanceMoney(ob.amount, ob.currencyCode)}
                    </TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      {isPending && (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 text-[10px]">
                          Pendente
                        </Badge>
                      )}
                      {isPaid && (
                        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px]">
                          Liquidada
                        </Badge>
                      )}
                      {isReversed && (
                        <Badge variant="outline" className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 text-[10px]" title={ob.reversalReason || undefined}>
                          Estornada
                        </Badge>
                      )}
                      {isCancelled && (
                        <Badge variant="outline" className="bg-muted text-muted-foreground text-[10px]" title={ob.cancellationReason || undefined}>
                          Cancelada
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-[11px] text-muted-foreground">
                      {isPaid && ob.payment ? (
                        <div>
                          <div className="font-semibold text-emerald-600 dark:text-emerald-400">
                            {formatFinanceDate(ob.payment.paidAt)}
                          </div>
                          <div className="text-[10px]">
                            {formatFinanceMoney(ob.payment.amount, ob.payment.currencyCode)}
                          </div>
                        </div>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    {canMutate && (
                      <TableCell className="text-right whitespace-nowrap">
                        {isPending && (
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => handleOpenSettle(ob)}
                              className="h-7 px-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                              data-testid={`btn-settle-obligation-${ob.id}`}
                            >
                              <CheckCircle className="h-3.5 w-3.5 mr-1" />
                              Liquidar
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleOpenCancel(ob)}
                              className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                              data-testid={`btn-cancel-obligation-${ob.id}`}
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        )}
                        {isPaid && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenReversePayment(ob)}
                            className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                            data-testid={`btn-reverse-payment-${ob.id}`}
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />
                            Estornar Pagamento
                          </Button>
                        )}
                        {isReversed && (
                          <span className="text-xs text-muted-foreground italic pr-2">Estorno definitivo</span>
                        )}
                        {isCancelled && (
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

      {/* CREATE OBLIGATION DIALOG */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <form onSubmit={handleSubmitCreate}>
            <DialogHeader>
              <DialogTitle className="text-base font-semibold">Gerar Obrigação Financeira</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Selecione a distribuição ativa de origem. O valor, moeda e beneficiário são derivados automaticamente.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {createError && (
                <div className="p-3 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-md flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="obligation-dist" className="text-xs">
                  Distribuição de Origem <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={selectedDistributionId}
                  onValueChange={setSelectedDistributionId}
                >
                  <SelectTrigger id="obligation-dist" data-testid="select-obligation-distribution">
                    <SelectValue placeholder="Selecione a distribuição..." />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleDistributions.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {getParticipantLabel(d.participant)} — {d.resolvedAmount} {d.currencyCode} (Lista: {d.paymentListId ? d.paymentListId.slice(0, 6) : "—"})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedDistDetails && (
                <div className="p-3 bg-muted/50 rounded-md text-xs space-y-1.5 border border-border/60">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Beneficiário:</span>
                    <span className="font-semibold">
                      {getParticipantLabel(selectedDistDetails.participant)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Valor a Pagar:</span>
                    <span className="font-mono font-bold text-foreground">
                      {formatFinanceMoney(selectedDistDetails.resolvedAmount, selectedDistDetails.currencyCode)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Lista de Pagamento:</span>
                    <span className="font-mono">{selectedDistDetails.paymentListId}</span>
                  </div>
                </div>
              )}
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
                disabled={createMutation.isPending || !selectedDistributionId}
                data-testid="btn-submit-obligation"
              >
                {createMutation.isPending ? "Gerando..." : "Gerar Obrigação"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* SETTLE OBLIGATION CONFIRMATION DIALOG */}
      <Dialog open={Boolean(settleTarget)} onOpenChange={(open) => !open && setSettleTarget(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
              <CheckCircle className="h-5 w-5" />
              Confirmar Liquidação de Caixa
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              A liquidação confirma a saída efetiva de dinheiro do caixa da empresa para o beneficiário.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-4">
            {settleTarget && (
              <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-md text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Beneficiário:</span>
                  <span className="font-semibold">
                    {getParticipantLabel(getParticipant(settleTarget))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Valor Efetivo a Descontar:</span>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
                    {formatFinanceMoney(settleTarget.amount, settleTarget.currencyCode)}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground border-t pt-1 mt-1">
                  O valor integral da obrigação será liquidado. Liquidações parciais não são permitidas.
                </div>
              </div>
            )}

            {settleError && (
              <div className="p-2 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-md">
                {settleError}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSettleTarget(null)}
              disabled={settleMutation.isPending}
            >
              Voltar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleConfirmSettle}
              disabled={settleMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              data-testid="btn-confirm-settle-obligation"
            >
              {settleMutation.isPending ? "Liquidando..." : "Confirmar Liquidação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CANCEL OBLIGATION DIALOG */}
      <Dialog open={Boolean(cancelTarget)} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <form onSubmit={handleSubmitCancel}>
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-destructive flex items-center gap-2">
                <XCircle className="h-5 w-5" />
                Cancelar Obrigação Financeira
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                O cancelamento invalida esta obrigação pendente sem realizar saídas de caixa.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-4">
              {cancelTarget && (
                <div className="p-3 bg-muted/50 rounded-md text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Valor:</span>
                    <span className="font-mono font-bold">
                      {formatFinanceMoney(cancelTarget.amount, cancelTarget.currencyCode)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Beneficiário:</span>
                    <span>{getParticipantLabel(getParticipant(cancelTarget))}</span>
                  </div>
                </div>
              )}

              {cancelError && (
                <div className="p-2 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-md">
                  {cancelError}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="ob-cancel-reason" className="text-xs">
                  Justificativa do Cancelamento <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="ob-cancel-reason"
                  data-testid="input-cancel-obligation-reason"
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
                data-testid="btn-confirm-cancel-obligation"
              >
                {cancelMutation.isPending ? "Cancelando..." : "Confirmar Cancelamento"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* REVERSE PAYMENT DIALOG */}
      <Dialog open={Boolean(reversePaymentTarget)} onOpenChange={(open) => !open && setReversePaymentTarget(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <form onSubmit={handleSubmitReversePayment}>
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-destructive flex items-center gap-2">
                <RotateCcw className="h-5 w-5" />
                Estornar Liquidação (Pagamento)
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                O estorno anula a liquidação e restaura o saldo de caixa correspondente.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-4">
              {reversePaymentTarget && (
                <div className="p-3 bg-muted/50 rounded-md text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Valor Pago:</span>
                    <span className="font-mono font-bold">
                      {formatFinanceMoney(
                        reversePaymentTarget.payment?.amount || reversePaymentTarget.amount,
                        reversePaymentTarget.payment?.currencyCode || reversePaymentTarget.currencyCode
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Beneficiário:</span>
                    <span>{getParticipantLabel(getParticipant(reversePaymentTarget))}</span>
                  </div>
                </div>
              )}

              {reversePaymentError && (
                <div className="p-2 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-md">
                  {reversePaymentError}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="reverse-payment-reason" className="text-xs">
                  Justificativa do Estorno de Pagamento <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="reverse-payment-reason"
                  data-testid="input-reverse-payment-reason"
                  placeholder="Informe o motivo detalhado do estorno da liquidação..."
                  value={reversePaymentReason}
                  onChange={(e) => setReversePaymentReason(e.target.value)}
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
                onClick={() => setReversePaymentTarget(null)}
                disabled={reversePaymentMutation.isPending}
              >
                Voltar
              </Button>
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={reversePaymentMutation.isPending}
                data-testid="btn-confirm-reverse-payment"
              >
                {reversePaymentMutation.isPending ? "Estornando..." : "Confirmar Estorno"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
