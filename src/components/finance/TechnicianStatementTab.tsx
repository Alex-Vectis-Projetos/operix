import React, { useState } from "react";
import {
  Users,
  Search,
  Eye,
  CheckCircle,
  AlertCircle,
  FileText,
  DollarSign,
  TrendingUp,
  Receipt,
  ArrowRight,
  ShieldAlert,
  Loader2,
  Calendar,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  useTechniciansFinance,
  useTechnicianStatement,
  useSettleTechnicianBalance,
  type TechnicianFinanceSummary,
} from "@/hooks/useFinance";
import { formatFinanceMoney, formatFinanceDate } from "@/lib/financeFormatters";

interface TechnicianStatementTabProps {
  canMutate?: boolean;
}

export function TechnicianStatementTab({ canMutate = true }: TechnicianStatementTabProps) {
  const { data: techData, isLoading, error } = useTechniciansFinance();
  const technicians: TechnicianFinanceSummary[] = techData?.items || [];

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);

  // Statement modal query
  const { data: statement, isLoading: loadingStatement } = useTechnicianStatement(selectedPersonId);

  // Settle mutation
  const settleMutation = useSettleTechnicianBalance();
  const [isSettleConfirmOpen, setIsSettleConfirmOpen] = useState(false);
  const [settleAmountInput, setSettleAmountInput] = useState("");
  const [settleFeedback, setSettleFeedback] = useState<string | null>(null);

  const filteredTechnicians = technicians.filter((t) => {
    const term = searchTerm.toLowerCase().trim();
    if (!term) return true;
    return (
      t.name.toLowerCase().includes(term) ||
      (t.email && t.email.toLowerCase().includes(term)) ||
      t.availableBalance.includes(term)
    );
  });

  const handleOpenStatement = (personId: string) => {
    setSelectedPersonId(personId);
    setSettleFeedback(null);
  };

  const handleCloseStatement = () => {
    setSelectedPersonId(null);
    setSettleFeedback(null);
  };

  const handleOpenSettle = () => {
    if (!statement) return;
    setSettleAmountInput(statement.summary.availableBalance);
    setIsSettleConfirmOpen(true);
  };

  const handleConfirmSettle = async () => {
    if (!selectedPersonId) return;
    try {
      const res = await settleMutation.mutateAsync({
        personId: selectedPersonId,
        amount: settleAmountInput || undefined,
      });
      setIsSettleConfirmOpen(false);
      setSettleFeedback(`Liquidação de ${statement?.summary.currencyCode} ${res.settledAmount} realizada com sucesso!`);
    } catch (err: any) {
      setSettleFeedback(`Erro ao liquidar: ${err.message}`);
    }
  };

  return (
    <div className="space-y-4" data-testid="technician-statement-tab-content">
      {/* Banner Alex Rule Alignment */}
      <div className="p-3 bg-muted/30 border border-border/60 rounded-lg text-xs text-muted-foreground flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary shrink-0" />
          <span>
            <strong>Acerto de Contas & Extrato em 3 Partes:</strong> Visão consolidada da produção, despesas e
            saldo líquido individual dos técnicos conforme alinhado nas reuniões com Alex Souza.
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar técnico por nome..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 h-9 text-xs"
          />
        </div>
      </div>

      {/* Technicians Summary Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      ) : error ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-4 text-sm text-destructive">
            Erro ao carregar técnicos: {(error as Error)?.message}
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border border-border/60 overflow-hidden bg-card">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="text-xs">Técnico</TableHead>
                <TableHead className="text-xs text-right">Previsto (Pendente)</TableHead>
                <TableHead className="text-xs text-right">Produção Faturada</TableHead>
                <TableHead className="text-xs text-right">Despesas Vinculadas</TableHead>
                <TableHead className="text-xs text-right">Total Já Pago</TableHead>
                <TableHead className="text-xs text-right">Saldo Líquido Disponível</TableHead>
                <TableHead className="text-xs text-center w-28">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTechnicians.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-xs text-muted-foreground">
                    Nenhum técnico encontrado no workspace.
                  </TableCell>
                </TableRow>
              ) : (
                filteredTechnicians.map((t) => {
                  const bal = parseFloat(t.availableBalance) || 0;
                  const isPositive = bal > 0;
                  const isNegative = bal < 0;

                  return (
                    <TableRow key={t.personId} className="hover:bg-muted/20">
                      <TableCell className="text-xs font-medium">
                        <div>{t.name}</div>
                        {t.email && <div className="text-[11px] text-muted-foreground">{t.email}</div>}
                      </TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">
                        {t.currencyCode} {formatFinanceMoney(t.expectedGross)}
                      </TableCell>
                      <TableCell className="text-xs text-right text-foreground font-medium">
                        {t.currencyCode} {formatFinanceMoney(t.receivedGross)}
                      </TableCell>
                      <TableCell className="text-xs text-right text-rose-600 font-medium">
                        - {t.currencyCode} {formatFinanceMoney(t.totalExpenses)}
                      </TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground">
                        {t.currencyCode} {formatFinanceMoney(t.settledPayments)}
                      </TableCell>
                      <TableCell className="text-xs text-right font-semibold">
                        <Badge
                          variant={isPositive ? "default" : isNegative ? "destructive" : "secondary"}
                          className="font-mono text-xs"
                        >
                          {t.currencyCode} {formatFinanceMoney(t.availableBalance)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleOpenStatement(t.personId)}
                          className="h-8 gap-1 text-xs"
                          title="Abrir Extrato Completo"
                        >
                          <Eye className="h-3.5 w-3.5 text-primary" />
                          <span>Extrato</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* 3-Part Detailed Statement Modal */}
      <Dialog open={Boolean(selectedPersonId)} onOpenChange={(open) => !open && handleCloseStatement()}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              <FileText className="h-5 w-5 text-primary" />
              Extrato Financeiro do Técnico (3 Partes)
            </DialogTitle>
            <DialogDescription className="text-xs">
              Detalhamento de Entradas/Previsões, Despesas Operacionais e Acerto de Contas.
            </DialogDescription>
          </DialogHeader>

          {loadingStatement || !statement ? (
            <div className="space-y-4 py-8">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : (
            <div className="space-y-6 py-2 text-xs">
              {/* Feedback Alert */}
              {settleFeedback && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-md text-xs text-emerald-600 font-medium">
                  {settleFeedback}
                </div>
              )}

              {/* Technician Header & Balances */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <Card className="bg-muted/30 border-border/60 p-3">
                  <div className="text-[11px] text-muted-foreground">Técnico</div>
                  <div className="text-sm font-semibold text-foreground mt-0.5">{statement.technician.name}</div>
                  <div className="text-[10px] text-muted-foreground">{statement.technician.email || "Sem e-mail"}</div>
                </Card>

                <Card className="bg-muted/30 border-border/60 p-3">
                  <div className="text-[11px] text-muted-foreground">Parte 1: Produção Líquida HT</div>
                  <div className="text-sm font-semibold text-foreground mt-0.5">
                    {statement.summary.currencyCode} {formatFinanceMoney(statement.summary.receivedGross)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Previsto: {statement.summary.currencyCode} {formatFinanceMoney(statement.summary.expectedGross)}
                  </div>
                </Card>

                <Card className="bg-muted/30 border-border/60 p-3">
                  <div className="text-[11px] text-muted-foreground">Parte 2: Despesas & Vales</div>
                  <div className="text-sm font-semibold text-rose-600 mt-0.5">
                    - {statement.summary.currencyCode} {formatFinanceMoney(statement.summary.totalExpenses)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {statement.part2_expenses.length} lançamentos vinculados
                  </div>
                </Card>

                <Card className="bg-primary/5 border-primary/20 p-3">
                  <div className="text-[11px] text-primary font-medium">Parte 3: Saldo Disponível</div>
                  <div className="text-sm font-bold text-foreground mt-0.5 font-mono">
                    {statement.summary.currencyCode} {formatFinanceMoney(statement.summary.availableBalance)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Já liquidado: {statement.summary.currencyCode} {formatFinanceMoney(statement.summary.settledPayments)}
                  </div>
                </Card>
              </div>

              {/* Action: Settle Balance if Positive */}
              {canMutate && parseFloat(statement.summary.availableBalance) > 0 && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex items-center justify-between">
                  <div className="text-xs text-emerald-800 dark:text-emerald-300">
                    <strong>Saldo Disponível para Pagamento:</strong> O técnico possui valor líquido liberado para repasse.
                  </div>
                  <Button
                    size="sm"
                    onClick={handleOpenSettle}
                    className="h-8 gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <DollarSign className="h-3.5 w-3.5" />
                    Liquidar Repasse
                  </Button>
                </div>
              )}

              {/* Negative Warning (Carryover) */}
              {parseFloat(statement.summary.availableBalance) < 0 && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-center gap-2 text-rose-700 dark:text-rose-400 text-xs">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  <span>
                    <strong>Conta-Corrente Devedora (Carryover):</strong> As despesas e adiantamentos superam a produção recebida. O saldo negativo transita automaticamente para os próximos fechamentos.
                  </span>
                </div>
              )}

              {/* Tab 1: Produção / Repasses */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5 text-primary" />
                  Parte 1: Entradas e Produção (Repasses da Oficina)
                </h4>
                <div className="rounded border border-border/60 overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="text-[11px]">Data</TableHead>
                        <TableHead className="text-[11px]">Origem</TableHead>
                        <TableHead className="text-[11px]">Status Lista</TableHead>
                        <TableHead className="text-[11px] text-right">Valor Cota</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {statement.part1_earnings.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-4 text-[11px] text-muted-foreground">
                            Nenhum repasse registrado.
                          </TableCell>
                        </TableRow>
                      ) : (
                        statement.part1_earnings.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="text-[11px]">{formatFinanceDate(item.date)}</TableCell>
                            <TableCell className="text-[11px] font-medium">{item.description}</TableCell>
                            <TableCell className="text-[11px]">
                              <Badge
                                variant={item.status === "paid" ? "default" : "outline"}
                                className="text-[10px]"
                              >
                                {item.status === "paid" ? "Faturada / Recebida" : "Pendente"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-[11px] text-right font-medium">
                              {item.currencyCode} {formatFinanceMoney(item.amount)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Tab 2: Despesas */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Receipt className="h-3.5 w-3.5 text-rose-600" />
                  Parte 2: Despesas e Adiantamentos (Deduções da Conta)
                </h4>
                <div className="rounded border border-border/60 overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="text-[11px]">Data</TableHead>
                        <TableHead className="text-[11px]">Categoria</TableHead>
                        <TableHead className="text-[11px]">Descrição</TableHead>
                        <TableHead className="text-[11px] text-right">Valor Debitado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {statement.part2_expenses.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-4 text-[11px] text-muted-foreground">
                            Nenhuma despesa ou adiantamento vinculado a este técnico.
                          </TableCell>
                        </TableRow>
                      ) : (
                        statement.part2_expenses.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="text-[11px]">{formatFinanceDate(item.date)}</TableCell>
                            <TableCell className="text-[11px]">
                              <Badge variant="outline" className="text-[10px]">
                                {item.category || "Despesa"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-[11px]">{item.description}</TableCell>
                            <TableCell className="text-[11px] text-right text-rose-600 font-medium">
                              - {item.currencyCode} {formatFinanceMoney(item.amount)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* Tab 3: Acertos e Liquidações */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <DollarSign className="h-3.5 w-3.5 text-emerald-600" />
                  Parte 3: Histórico de Liquidações Realizadas
                </h4>
                <div className="rounded border border-border/60 overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="text-[11px]">Data</TableHead>
                        <TableHead className="text-[11px]">Histórico</TableHead>
                        <TableHead className="text-[11px]">Status</TableHead>
                        <TableHead className="text-[11px] text-right">Valor Pago</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {statement.part3_settlements.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-4 text-[11px] text-muted-foreground">
                            Nenhuma liquidação financeira realizada até o momento.
                          </TableCell>
                        </TableRow>
                      ) : (
                        statement.part3_settlements.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="text-[11px]">{formatFinanceDate(item.date)}</TableCell>
                            <TableCell className="text-[11px]">{item.description}</TableCell>
                            <TableCell className="text-[11px]">
                              <Badge variant="secondary" className="text-[10px]">
                                {item.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-[11px] text-right font-medium text-emerald-600">
                              {item.currencyCode} {formatFinanceMoney(item.amount)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={handleCloseStatement} className="h-8 text-xs">
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settle Confirmation Modal */}
      <Dialog open={isSettleConfirmOpen} onOpenChange={setIsSettleConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">Confirmar Liquidação de Repasse</DialogTitle>
            <DialogDescription className="text-xs">
              Será emitido o registro de pagamento em dinheiro/transferência para liquidar o saldo do técnico.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1">
              <label className="text-xs font-medium">Valor a Liquidar ({statement?.summary.currencyCode})</label>
              <Input
                type="number"
                value={settleAmountInput}
                onChange={(e) => setSettleAmountInput(e.target.value)}
                className="h-8 text-xs font-mono"
              />
              <span className="text-[10px] text-muted-foreground">
                Saldo total disponível: {statement?.summary.currencyCode} {statement?.summary.availableBalance}
              </span>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSettleConfirmOpen(false)}
              className="h-8 text-xs"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleConfirmSettle}
              disabled={settleMutation.isPending || !settleAmountInput}
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {settleMutation.isPending ? "Processando..." : "Confirmar Pagamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
