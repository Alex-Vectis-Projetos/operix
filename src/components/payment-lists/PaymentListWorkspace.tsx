import { useState } from "react";
import {
  ClipboardList,
  GitCompare,
  Loader2,
  Upload,
  ChevronRight,
  ChevronDown,
  Receipt,
  FileText,
  Car,
  Wrench,
  CheckCircle2,
} from "lucide-react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { useRole } from "@/hooks/useRole";
import { usePaymentLists } from "@/hooks/usePaymentLists";
import type { PaymentList, PaymentListItem } from "@/lib/apiPaymentLists";
import { PaymentListImportDialog } from "./PaymentListImportDialog";
import { PaymentListStatusBadge } from "./PaymentListStatusBadge";
import { formatPaymentListMoney, isGlobalCommercialTotal } from "./paymentListUi";
import { ConfrontationHub } from "./ConfrontationHub";

function servicesLabel(item: PaymentListItem) {
  if (!Array.isArray(item.servicesSnapshot)) return "Serviços registrados";
  return item.servicesSnapshot
    .map((service) =>
      typeof service === "object" && service !== null && !Array.isArray(service)
        ? String(service.description ?? service.name ?? service.code ?? "Serviço")
        : "Serviço"
    )
    .join(", ");
}

interface AccordionRowProps {
  list: PaymentList;
  isExpanded: boolean;
  onToggle: () => void;
  onGoToConfrontation: () => void;
  canManage: boolean;
}

function PaymentListAccordionRow({
  list,
  isExpanded,
  onToggle,
  onGoToConfrontation,
  canManage,
}: AccordionRowProps) {
  const navigate = useNavigate();

  return (
    <div className="rounded-lg border bg-card overflow-hidden transition-all shadow-sm">
      {/* Header do Acordeão */}
      <div
        onClick={onToggle}
        className="flex flex-wrap items-center justify-between gap-3 p-3.5 hover:bg-muted/30 cursor-pointer transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 shrink-0 text-muted-foreground"
            aria-label={isExpanded ? "Recolher" : "Expandir"}
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-foreground font-mono">
                {list.listNumber}
              </span>
              <span className="text-muted-foreground text-xs">·</span>
              <span className="font-semibold text-sm text-foreground truncate max-w-[240px]">
                {list.clientName}
              </span>
              <PaymentListStatusBadge status={list.status} />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <span>{list.itemCount || list.items?.length || 0} veículo(s)</span>
              <span>•</span>
              <span>Criada em {new Date(list.createdAt).toLocaleDateString("pt-BR")}</span>
            </div>
          </div>
        </div>

        {/* Lado Direito: Reconhecido e Ações Rápidas */}
        <div className="flex items-center gap-2 ml-auto" onClick={(e) => e.stopPropagation()}>
          <div className="text-right mr-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground block font-medium">
              Reconhecido
            </span>
            <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {isGlobalCommercialTotal(list.recognizedTotal)
                ? formatPaymentListMoney(list.recognizedTotal, list.currencyCode)
                : "—"}
            </span>
          </div>

          {canManage && (
            <>
              {!list.invoiceId &&
                (list.status === "confronted" ||
                  (list.status as string) === "ready_for_billing" ||
                  list.status === "pending") && (
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-medium gap-1.5"
                    onClick={() => navigate(`/billing/faturas?listId=${list.id}`)}
                  >
                    <Receipt className="h-3.5 w-3.5" />
                    Emitir Fatura
                  </Button>
                )}

              {list.invoiceId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10 font-medium gap-1.5"
                  onClick={() => navigate("/billing/faturas")}
                >
                  <FileText className="h-3.5 w-3.5" />
                  Ver Fatura
                </Button>
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs gap-1.5 border-border hover:bg-muted"
                onClick={onGoToConfrontation}
              >
                <GitCompare className="h-3.5 w-3.5 text-indigo-500" />
                Confrontar OS × OP
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Conteúdo Expandido do Acordeão: Tabela de Veículos e Serviços */}
      {isExpanded && (
        <div className="border-t bg-muted/10 p-3">
          {!list.items || list.items.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              Nenhum item/veículo registrado nesta lista de pagamento.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border bg-card">
              <Table className="text-xs">
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead className="w-[20%]">Veículo / Modelo</TableHead>
                    <TableHead className="w-[14%] font-mono">Matrícula / Placa</TableHead>
                    <TableHead className="w-[14%] font-mono">VIN</TableHead>
                    <TableHead className="w-[18%]">Técnico Responsável</TableHead>
                    <TableHead className="w-[22%]">Serviços Realizados</TableHead>
                    <TableHead className="w-[12%] text-right font-medium">Valor Comercial</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.items.map((item) => (
                    <TableRow key={item.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-semibold text-foreground">
                        <div className="flex items-center gap-1.5">
                          <Car className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span>{item.carName || "Veículo não especificado"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono font-medium">
                        {item.licensePlate || "—"}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {item.vin || "—"}
                      </TableCell>
                      <TableCell className="text-foreground">
                        {item.technicianName || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Wrench className="h-3 w-3 shrink-0" />
                          <span className="truncate max-w-[280px]" title={servicesLabel(item)}>
                            {servicesLabel(item)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-semibold text-foreground tabular-nums">
                        {formatPaymentListMoney(item.totalAmount, list.currencyCode)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {list.notes && (
            <p className="mt-2 text-[11px] text-muted-foreground italic pl-1">
              Observações: {list.notes}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function PaymentListWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "lists";
  const { data: lists = [], isLoading, error } = usePaymentLists();
  const { isAdmin, isOwner } = useRole();
  const canManage = isAdmin || isOwner;
  const importId = searchParams.get("import");
  const [expandedListIds, setExpandedListIds] = useState<Set<string>>(new Set());

  const updateRoute = (changes: Record<string, string | null>) =>
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      Object.entries(changes).forEach(([key, value]) =>
        value ? next.set(key, value) : next.delete(key)
      );
      return next;
    });

  const toggleList = (id: string) => {
    setExpandedListIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedListIds(new Set(lists.map((l) => l.id)));
  };

  const collapseAll = () => {
    setExpandedListIds(new Set());
  };

  return (
    <div className="animate-fade-in space-y-4">
      <Tabs
        value={activeTab}
        onValueChange={(val) => updateRoute({ tab: val === "lists" ? null : val })}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <TabsList className="grid grid-cols-2 w-full sm:w-[380px]">
            <TabsTrigger value="lists" className="gap-2">
              <ClipboardList className="h-4 w-4" />
              Listas de Pagamento
            </TabsTrigger>
            <TabsTrigger value="confrontation" className="gap-2">
              <GitCompare className="h-4 w-4" />
              Confronto OS × OP
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="lists" className="space-y-4 mt-0">
          <header className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-card p-4">
            <div className="flex gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                <ClipboardList className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">Listas de pagamento</h1>
                <p className="text-sm text-muted-foreground">
                  Visão consolidada em acordeões por Lista, veículos e serviços (padrão WEEKLOG).
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {lists.length > 0 && (
                <div className="flex items-center gap-1.5 mr-2">
                  <Button variant="ghost" size="sm" onClick={expandAll} className="h-8 text-xs">
                    Expandir tudo
                  </Button>
                  <Button variant="ghost" size="sm" onClick={collapseAll} className="h-8 text-xs">
                    Recolher tudo
                  </Button>
                </div>
              )}
              {canManage && (
                <Button onClick={() => updateRoute({ import: "new" })}>
                  <Upload className="mr-2 h-4 w-4" />
                  Importar documento
                </Button>
              )}
            </div>
          </header>

          {isLoading ? (
            <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando Listas de Pagamento...
            </div>
          ) : error ? (
            <p role="alert" className="rounded-md border border-destructive/40 p-4 text-sm text-destructive">
              Não foi possível carregar as Listas de Pagamento.
            </p>
          ) : lists.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
              Nenhuma Lista de Pagamento disponível para o seu acesso.
            </div>
          ) : (
            <div className="space-y-2.5">
              {lists.map((list) => (
                <PaymentListAccordionRow
                  key={list.id}
                  list={list}
                  isExpanded={expandedListIds.has(list.id)}
                  onToggle={() => toggleList(list.id)}
                  onGoToConfrontation={() =>
                    updateRoute({ tab: "confrontation", list: list.id })
                  }
                  canManage={canManage}
                />
              ))}
            </div>
          )}

          {canManage && importId && (
            <PaymentListImportDialog
              importId={importId === "new" ? null : importId}
              onImportReady={(id) => updateRoute({ import: id })}
              onCommitted={(list) => updateRoute({ import: null, list: list.id })}
              onClose={() => updateRoute({ import: null })}
            />
          )}
        </TabsContent>

        <TabsContent value="confrontation" className="mt-0">
          <ConfrontationHub />
        </TabsContent>
      </Tabs>
    </div>
  );
}
