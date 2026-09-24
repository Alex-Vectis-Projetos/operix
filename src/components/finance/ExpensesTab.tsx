import React, { useState, useMemo } from "react";
import { Plus, RotateCcw, AlertTriangle, Search, Filter, Receipt } from "lucide-react";
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
  useExpenses,
  useCreateExpense,
  useReverseExpense,
  prepareCommand,
  type CreateExpenseInput,
  type Expense,
  type ExpenseContext,
  type ExpenseContextKind,
} from "@/hooks/useFinance";
import { usePaymentLists } from "@/hooks/usePaymentLists";
import { usePeople } from "@/hooks/usePeople";
import { useClients } from "@/hooks/useServiceOrders";
import { formatFinanceMoney, formatFinanceDate } from "@/lib/financeFormatters";

interface ExpensesTabProps {
  canMutate?: boolean;
}

const CATEGORY_LABELS: Record<string, string> = {
  operational: "Operacional",
  administrative: "Administrativo",
  tax: "Impostos & Taxas",
  software: "Software & TI",
  travel: "Deslocamento & Viagem",
  materials: "Materiais & Equipamentos",
  other: "Outros",
};

export function ExpensesTab({ canMutate = true }: ExpensesTabProps) {
  const { data: expensesData, isLoading, error } = useExpenses();
  const expenses: Expense[] = useMemo(() => {
    if (!expensesData) return [];
    if (Array.isArray(expensesData)) return expensesData;
    return (expensesData as any).items || [];
  }, [expensesData]);

  const createMutation = useCreateExpense();
  const reverseMutation = useReverseExpense();

  const { data: paymentLists = [] } = usePaymentLists();
  const { people = [] } = usePeople();
  const { data: clients = [] } = useClients();

  // Filter state
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Create Dialog State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [currencyCode, setCurrencyCode] = useState("EUR");
  const [category, setCategory] = useState("operational");
  const [occurredOn, setOccurredOn] = useState(new Date().toISOString().split("T")[0]);
  const [description, setDescription] = useState("");
  const [contextKind, setContextKind] = useState<ExpenseContextKind | "none">("none");
  const [contextId, setContextId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  // Reverse Dialog State
  const [reverseTarget, setReverseTarget] = useState<Expense | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseError, setReverseError] = useState<string | null>(null);

  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      const matchCategory = selectedCategory === "all" || e.category === selectedCategory;
      const term = searchTerm.toLowerCase().trim();
      const matchSearch =
        !term ||
        e.description?.toLowerCase().includes(term) ||
        e.category.toLowerCase().includes(term) ||
        e.amount.includes(term) ||
        e.currencyCode.toLowerCase().includes(term);
      return matchCategory && matchSearch;
    });
  }, [expenses, selectedCategory, searchTerm]);

  const handleOpenCreate = () => {
    setAmount("");
    setCurrencyCode("EUR");
    setCategory("operational");
    setOccurredOn(new Date().toISOString().split("T")[0]);
    setDescription("");
    setContextKind("none");
    setContextId("");
    setCreateError(null);
    setIsCreateOpen(true);
  };

  const handleSubmitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    const cleanAmount = amount.trim();
    if (!cleanAmount || cleanAmount === "0" || cleanAmount.startsWith("-")) {
      setCreateError("Informe um valor monetário positivo válido (ex: 50.00).");
      return;
    }

    let context: ExpenseContext | undefined = undefined;
    if (contextKind !== "none" && contextId) {
      context = { kind: contextKind, id: contextId } as ExpenseContext;
    }

    const input: CreateExpenseInput = {
      amount: cleanAmount,
      currencyCode: currencyCode.trim().toUpperCase(),
      category,
      occurredOn: occurredOn || new Date().toISOString().split("T")[0],
      description: description.trim() || undefined,
      context,
    };

    try {
      const envelope = prepareCommand(input);
      await createMutation.mutateAsync(envelope);
      setIsCreateOpen(false);
    } catch (err: any) {
      setCreateError(err.message || "Erro ao registrar a despesa.");
    }
  };

  const handleOpenReverse = (expense: Expense) => {
    setReverseTarget(expense);
    setReverseReason("");
    setReverseError(null);
  };

  const handleSubmitReverse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reverseTarget) return;
    setReverseError(null);

    const reason = reverseReason.trim();
    if (!reason || reason.length < 3) {
      setReverseError("Justificativa obrigatória (mínimo 3 caracteres).");
      return;
    }

    try {
      await reverseMutation.mutateAsync({
        expenseId: reverseTarget.id,
        input: { reason },
      });
      setReverseTarget(null);
    } catch (err: any) {
      setReverseError(err.message || "Erro ao estornar a despesa.");
    }
  };

  return (
    <div className="space-y-4" data-testid="expenses-tab-content">
      {/* Action and Filter Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar despesas..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 h-9 text-xs"
              data-testid="expense-search-input"
            />
          </div>

          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="h-9 w-[160px] text-xs">
              <Filter className="h-3.5 w-3.5 mr-1 text-muted-foreground" />
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as categorias</SelectItem>
              {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {canMutate && (
          <Button
            size="sm"
            onClick={handleOpenCreate}
            className="h-9 gap-1.5 shrink-0"
            data-testid="btn-new-expense"
          >
            <Plus className="h-4 w-4" />
            <span>Nova Despesa</span>
          </Button>
        )}
      </div>

      {/* Expenses Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      ) : error ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-4 text-sm text-destructive">
            Erro ao carregar despesas: {(error as Error)?.message}
          </CardContent>
        </Card>
      ) : filteredExpenses.length === 0 ? (
        <Card className="border-border/50 bg-muted/20">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Receipt className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <h3 className="text-sm font-semibold text-foreground">Nenhuma despesa encontrada</h3>
            <p className="text-xs text-muted-foreground max-w-sm mt-1">
              {expenses.length === 0
                ? "Registre despesas operacionais ou administrativas para manter o caixa atualizado."
                : "Nenhuma despesa corresponde aos filtros aplicados."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-md bg-card overflow-x-auto">
          <Table data-testid="expenses-table">
            <TableHeader>
              <TableRow className="bg-muted/40 text-xs">
                <TableHead className="w-[110px]">Data</TableHead>
                <TableHead className="w-[140px]">Categoria</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="w-[150px]">Contexto</TableHead>
                <TableHead className="text-right w-[130px]">Valor</TableHead>
                <TableHead className="w-[100px] text-center">Status</TableHead>
                {canMutate && <TableHead className="w-[100px] text-right">Ações</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredExpenses.map((exp) => {
                const isEffective = exp.status === "effective";
                const isReversed = exp.status === "reversed";

                return (
                  <TableRow
                    key={exp.id}
                    className={`text-xs hover:bg-muted/50 ${isReversed ? "opacity-60 bg-muted/20" : ""}`}
                    data-testid={`expense-row-${exp.id}`}
                  >
                    <TableCell className="font-medium whitespace-nowrap">
                      {formatFinanceDate(exp.occurredOn)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[11px] font-normal">
                        {CATEGORY_LABELS[exp.category] || exp.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate" title={exp.description || undefined}>
                      {exp.description || <span className="text-muted-foreground italic">Sem descrição</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground text-[11px]">
                      {exp.context ? (
                        <span>
                          <span className="font-semibold">{exp.context.kind}</span>
                          {exp.context.id ? `: ${exp.context.id.slice(0, 8)}...` : ""}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono font-medium whitespace-nowrap ${
                        isReversed ? "line-through text-muted-foreground" : "text-foreground"
                      }`}
                    >
                      {formatFinanceMoney(exp.amount, exp.currencyCode)}
                    </TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      {isEffective && (
                        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-[10px]">
                          Efetiva
                        </Badge>
                      )}
                      {isReversed && (
                        <Badge variant="outline" className="bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 text-[10px]" title={exp.reversalReason || undefined}>
                          Estornada
                        </Badge>
                      )}
                    </TableCell>
                    {canMutate && (
                      <TableCell className="text-right whitespace-nowrap">
                        {isEffective ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenReverse(exp)}
                            className="h-7 px-2 text-xs text-destructive hover:bg-destructive/10"
                            data-testid={`btn-reverse-expense-${exp.id}`}
                          >
                            <RotateCcw className="h-3.5 w-3.5 mr-1" />
                            Estornar
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground italic pr-2">Estornada</span>
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

      {/* CREATE EXPENSE DIALOG */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <form onSubmit={handleSubmitCreate}>
            <DialogHeader>
              <DialogTitle className="text-base font-semibold">Registrar Nova Despesa</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Despesas registradas afetam diretamente o caixa disponível na moeda correspondente.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {createError && (
                <div className="p-3 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-md flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              {/* Amount and Currency */}
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="expense-amount" className="text-xs">
                    Valor <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="expense-amount"
                    data-testid="input-expense-amount"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    required
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="expense-currency" className="text-xs">
                    Moeda <span className="text-destructive">*</span>
                  </Label>
                  <Select value={currencyCode} onValueChange={setCurrencyCode}>
                    <SelectTrigger id="expense-currency" data-testid="select-expense-currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="EUR">EUR (€)</SelectItem>
                      <SelectItem value="USD">USD ($)</SelectItem>
                      <SelectItem value="BRL">BRL (R$)</SelectItem>
                      <SelectItem value="GBP">GBP (£)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Category and Date */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="expense-category" className="text-xs">
                    Categoria <span className="text-destructive">*</span>
                  </Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger id="expense-category" data-testid="select-expense-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
                        <SelectItem key={k} value={k}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="expense-occurred-on" className="text-xs">
                    Data de Ocorrência <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="expense-occurred-on"
                    data-testid="input-expense-date"
                    type="date"
                    value={occurredOn}
                    onChange={(e) => setOccurredOn(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Description */}
              <div className="space-y-1.5">
                <Label htmlFor="expense-description" className="text-xs">
                  Descrição / Finalidade
                </Label>
                <Textarea
                  id="expense-description"
                  data-testid="input-expense-description"
                  placeholder="Ex: Pagamento de licença de software de gestão..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="text-xs"
                />
              </div>

              {/* Context Selector */}
              <div className="space-y-2 border-t pt-3">
                <Label className="text-xs text-muted-foreground font-semibold">
                  Vínculo Opcional (Contexto)
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="context-type" className="text-[11px] text-muted-foreground">
                      Tipo de Vínculo
                    </Label>
                    <Select
                      value={contextKind}
                      onValueChange={(v) => {
                        setContextKind(v as any);
                        setContextId("");
                      }}
                    >
                      <SelectTrigger id="context-type" data-testid="select-context-type" className="text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhum vínculo</SelectItem>
                        <SelectItem value="payment_list">Lista de Pagamento</SelectItem>
                        <SelectItem value="production_order">Ordem de Produção</SelectItem>
                        <SelectItem value="technician_person">Técnico / Pessoa</SelectItem>
                        <SelectItem value="client">Cliente</SelectItem>
                        <SelectItem value="document">Documento</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="context-id" className="text-[11px] text-muted-foreground">
                      Selecionar Registro
                    </Label>
                    {contextKind === "payment_list" ? (
                      <Select value={contextId} onValueChange={setContextId}>
                        <SelectTrigger id="context-id" className="text-xs">
                          <SelectValue placeholder="Escolha a Lista..." />
                        </SelectTrigger>
                        <SelectContent>
                          {paymentLists.map((pl) => (
                            <SelectItem key={pl.id} value={pl.id}>
                              {pl.listNumber || pl.id.slice(0, 8)} ({pl.currencyCode})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : contextKind === "technician_person" ? (
                      <Select value={contextId} onValueChange={setContextId}>
                        <SelectTrigger id="context-id" className="text-xs">
                          <SelectValue placeholder="Escolha a Pessoa..." />
                        </SelectTrigger>
                        <SelectContent>
                          {people.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.full_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : contextKind === "client" ? (
                      <Select value={contextId} onValueChange={setContextId}>
                        <SelectTrigger id="context-id" className="text-xs">
                          <SelectValue placeholder="Escolha o Cliente..." />
                        </SelectTrigger>
                        <SelectContent>
                          {clients.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name || c.id.slice(0, 8)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        id="context-id"
                        placeholder={contextKind === "none" ? "—" : "ID do contexto..."}
                        value={contextId}
                        onChange={(e) => setContextId(e.target.value)}
                        disabled={contextKind === "none"}
                        className="text-xs"
                      />
                    )}
                  </div>
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
                data-testid="btn-submit-expense"
              >
                {createMutation.isPending ? "Registrando..." : "Registrar Despesa"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* REVERSE EXPENSE DIALOG */}
      <Dialog open={Boolean(reverseTarget)} onOpenChange={(open) => !open && setReverseTarget(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <form onSubmit={handleSubmitReverse}>
            <DialogHeader>
              <DialogTitle className="text-base font-semibold text-destructive flex items-center gap-2">
                <RotateCcw className="h-5 w-5" />
                Estornar Despesa
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                O estorno anula o efeito desta despesa no caixa. Registros financeiros são imutáveis e não podem ser excluídos diretamente.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-4">
              {reverseTarget && (
                <div className="p-3 bg-muted/50 rounded-md text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Valor:</span>
                    <span className="font-mono font-bold">
                      {formatFinanceMoney(reverseTarget.amount, reverseTarget.currencyCode)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Categoria:</span>
                    <span>{CATEGORY_LABELS[reverseTarget.category] || reverseTarget.category}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Data:</span>
                    <span>{formatFinanceDate(reverseTarget.occurredOn)}</span>
                  </div>
                </div>
              )}

              {reverseError && (
                <div className="p-2 text-xs bg-destructive/10 border border-destructive/20 text-destructive rounded-md">
                  {reverseError}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="reverse-reason" className="text-xs">
                  Justificativa do Estorno <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="reverse-reason"
                  data-testid="input-reverse-reason"
                  placeholder="Informe o motivo detalhado do estorno..."
                  value={reverseReason}
                  onChange={(e) => setReverseReason(e.target.value)}
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
                onClick={() => setReverseTarget(null)}
                disabled={reverseMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={reverseMutation.isPending}
                data-testid="btn-confirm-reverse-expense"
              >
                {reverseMutation.isPending ? "Estornando..." : "Confirmar Estorno"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
