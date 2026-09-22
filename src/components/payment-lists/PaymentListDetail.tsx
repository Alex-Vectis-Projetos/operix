import { useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, CircleHelp, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useConfrontPaymentList, useConfrontationDecision, usePaymentListConfrontation } from "@/hooks/useConfrontation";
import { usePaymentList, useTransitionPaymentListStatus } from "@/hooks/usePaymentLists";
import type { ConfrontationDecisionInput, ConfrontationResult, PaymentListItem } from "@/lib/apiPaymentLists";
import { PaymentListStatusBadge } from "./PaymentListStatusBadge";
import { allowedConfrontationDecisions, formatPaymentListMoney, isGlobalCommercialTotal } from "./paymentListUi";

const resultLabels: Record<ConfrontationResult["status"], string> = {
  not_evaluated: "Não avaliado",
  exact_match: "Correspondência exata",
  value_difference: "Diferença de valor",
  service_discrepancy: "Divergência de serviço",
  vehicle_not_found: "Veículo não localizado",
  unmatched_weeklog: "Execução ausente na Lista",
  ambiguous_match: "Correspondência ambígua",
};

const decisionLabels: Record<ConfrontationDecisionInput, string> = {
  accept_difference: "Aceitar diferença",
  contest: "Contestar",
  request_rectification: "Solicitar retificação",
  reject_item: "Rejeitar item",
};

function servicesLabel(item: PaymentListItem) {
  if (!Array.isArray(item.servicesSnapshot)) return "Serviços registrados";
  return item.servicesSnapshot.map((service) => typeof service === "object" && service !== null && !Array.isArray(service) ? String(service.description ?? service.name ?? service.code ?? "Serviço") : "Serviço").join(", ");
}

function explanation(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    switch (String(error.code)) {
      case "CONFRONTATION_RERUN_HAS_DECISIONS": return "A rodada atual possui decisões humanas e não pode ser recalculada.";
      case "UNRESOLVED_DISPUTES_BLOCK_PENDING": return "Há disputas abertas; a Lista não pode avançar para pendente.";
      case "LIST_CONFRONTATION_REQUIRED": return "Execute e resolva o confronto antes de avançar a Lista.";
      case "EXTERNAL_ENTRY_CANNOT_RECTIFY_PO": return "Uma execução importada externamente não pode reabrir uma ordem de produção.";
      case "FORBIDDEN_ROLE": return "Você não possui autorização para esta ação.";
    }
  }
  return error instanceof Error ? error.message : "Não foi possível concluir a ação.";
}

function DecisionDialog({ result, open, onOpenChange, onSubmit, pending }: { result: ConfrontationResult | null; open: boolean; onOpenChange: (open: boolean) => void; onSubmit: (decision: ConfrontationDecisionInput, notes: string) => void; pending: boolean }) {
  const [decision, setDecision] = useState<ConfrontationDecisionInput | null>(null);
  const [notes, setNotes] = useState("");
  const options = result ? allowedConfrontationDecisions(result) : [];
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Registrar decisão comercial</DialogTitle><DialogDescription>A decisão é gravada na rodada atual e não pode ser alterada diretamente.</DialogDescription></DialogHeader><div className="grid gap-2">{options.map((option) => <Button key={option} type="button" variant={decision === option ? "default" : "outline"} className="justify-start" onClick={() => setDecision(option)}>{decisionLabels[option]}</Button>)}</div><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Justificativa obrigatória" aria-label="Justificativa da decisão" /><DialogFooter><Button disabled={!decision || !notes.trim() || pending} onClick={() => decision && onSubmit(decision, notes.trim())}>{pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Confirmar decisão</Button></DialogFooter></DialogContent></Dialog>;
}

function ConfrontationPanel({ paymentListId, items, currencyCode = "", canManage }: { paymentListId: string; items: PaymentListItem[]; currencyCode?: string; canManage: boolean }) {
  const confrontation = usePaymentListConfrontation(paymentListId);
  const run = useConfrontPaymentList();
  const decide = useConfrontationDecision();
  const [selected, setSelected] = useState<ConfrontationResult | null>(null);
  const [decisionResult, setDecisionResult] = useState<ConfrontationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = confrontation.data && "runId" in confrontation.data ? confrontation.data : null;
  const results = current?.results ?? confrontation.data?.results ?? [];
  const selectedItem = selected?.paymentListItemId ? items.find((item) => item.id === selected.paymentListItemId) ?? null : null;

  const execute = async (mode: "current" | "new_round") => {
    if (mode === "new_round" && !window.confirm("A rodada anterior permanecerá preservada como histórico. Iniciar uma nova rodada?")) return;
    setError(null);
    try { await run.mutateAsync({ paymentListId, mode }); } catch (reason) { setError(explanation(reason)); }
  };
  const submit = async (decision: ConfrontationDecisionInput, notes: string) => {
    if (!decisionResult) return;
    setError(null);
    try { await decide.mutateAsync({ paymentListId, resultId: decisionResult.id, payload: { decision, notes } }); setDecisionResult(null); } catch (reason) { setError(explanation(reason)); }
  };

  if (confrontation.isLoading) return <div className="p-6 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Carregando confronto…</div>;
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium">Confronto comercial</h3><p className="text-sm text-muted-foreground">O pareamento e os totais reconhecidos são calculados pelo backend.</p></div>{canManage && <div className="flex gap-2"><Button variant="outline" disabled={run.isPending} onClick={() => void execute("current")}><RotateCcw className="mr-1 h-4 w-4" />Executar confronto</Button>{current && <Button variant="outline" disabled={run.isPending} onClick={() => void execute("new_round")}>Nova rodada</Button>}</div>}</div>
    {error && <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"><AlertCircle className="mr-1 inline h-4 w-4" />{error}</p>}
    {!current && <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">O confronto ainda não foi executado.</div>}
    {current && <><div className="rounded-md border bg-muted/20 p-3 text-sm">Rodada {current.sequence} · {current.status} · {current.idempotent ? "resultado corrente" : "resultado atualizado"}</div><div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.8fr)]"><div className="space-y-2">{results.map((result) => <button key={result.id} type="button" className="w-full rounded-md border p-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelected(result)}><div className="flex items-center justify-between gap-2"><strong className="text-sm">{resultLabels[result.status]}</strong>{result.decision !== "none" && <span className="text-xs text-amber-300">{result.decision}</span>}</div><p className="mt-1 text-xs text-muted-foreground">Lista: {result.paymentListItemId ?? "sem item"} · WEEKLOG: {result.weeklogEntryId ?? "sem execução"}</p></button>)}</div><aside className="rounded-md border p-4">{selected ? <><h4 className="font-medium">Evidências da decisão</h4><div className="mt-3 grid gap-3 text-sm"><section><p className="text-xs font-medium text-muted-foreground">CLIENTE / LISTA</p>{selectedItem ? <><p>{selectedItem.carName ?? selectedItem.licensePlate ?? selectedItem.vin ?? "Veículo sem identificação"}</p><p>{servicesLabel(selectedItem)}</p><p>{formatPaymentListMoney(selectedItem.totalAmount, currencyCode)}</p></> : <p>Sem item de Lista associado.</p>}</section><section><p className="text-xs font-medium text-muted-foreground">OPERAÇÃO / WEEKLOG</p><p>{selected.weeklogEntryId ? `Execução ${selected.weeklogEntryId}` : "Execução não localizada"}</p><p>{selected.status === "ambiguous_match" ? "Correspondência ambígua — requer decisão humana." : "A evidência operacional é a retornada pelo backend."}</p></section>{selected.status === "value_difference" && <p>Diferença informada: {formatPaymentListMoney(selected.differenceAmount, currencyCode)}</p>}{selected.decision !== "none" && <p className="rounded bg-amber-500/10 p-2 text-amber-200">Disputa/decisão: {selected.decision}</p>}{canManage && selected.decision === "none" && allowedConfrontationDecisions(selected).length > 0 && <Button onClick={() => setDecisionResult(selected)}>Registrar decisão</Button>}</div></> : <p className="text-sm text-muted-foreground">Selecione um resultado para comparar as evidências disponíveis.</p>}</aside></div><p className="text-xs text-muted-foreground">Histórico de rodadas: o contrato atual expõe somente a rodada mais recente; rodadas anteriores permanecem imutáveis no backend, mas ainda não possuem leitura dedicada para esta tela.</p></>}
    <DecisionDialog result={decisionResult} open={Boolean(decisionResult)} onOpenChange={(open) => { if (!open) setDecisionResult(null); }} pending={decide.isPending} onSubmit={(decision, notes) => void submit(decision, notes)} />
  </div>;
}

export function PaymentListDetail({ paymentListId, canManage, onBack }: { paymentListId: string; canManage: boolean; onBack: () => void }) {
  const { data: list, isLoading, error } = usePaymentList(paymentListId);
  const transition = useTransitionPaymentListStatus();
  const [message, setMessage] = useState<string | null>(null);
  const actions = useMemo(() => {
    if (!list || !canManage) return [] as Array<{ label: string; toStatus: "under_review" | "pending" | "paid" | "cancelled"; confirm: string }>;
    if (list.status === "draft") return [{ label: "Enviar para revisão", toStatus: "under_review", confirm: "Enviar esta Lista para revisão?" }, { label: "Cancelar Lista", toStatus: "cancelled", confirm: "Cancelar esta Lista e liberar claims reservadas?" }];
    if (list.status === "under_review") return [{ label: "Cancelar Lista", toStatus: "cancelled", confirm: "Cancelar esta Lista e liberar claims reservadas?" }];
    if (list.status === "confronted") return [{ label: "Avançar para pendente", toStatus: "pending", confirm: "Avançar a Lista para pendente de recebimento?" }];
    if (list.status === "pending") return [{ label: "Marcar como recebida", toStatus: "paid", confirm: "Registrar o recebimento desta Lista? Isto não realiza conciliação bancária nem repasses." }];
    return [];
  }, [list, canManage]);

  if (isLoading) return <div className="p-8 text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Carregando Lista…</div>;
  if (!list) return <div className="p-8 text-sm text-destructive">{explanation(error)}</div>;
  return <div className="space-y-4"><Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-1 h-4 w-4" />Voltar para Listas</Button><header className="rounded-lg border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-muted-foreground">Lista de Pagamento</p><h2 className="text-xl font-semibold">{list.listNumber}</h2><p>{list.clientName}</p></div><PaymentListStatusBadge status={list.status} /></div><div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><span className="text-muted-foreground">Moeda</span><p>{list.currencyCode}</p></div><div><span className="text-muted-foreground">Itens</span><p>{list.itemCount}</p></div>{isGlobalCommercialTotal(list.sourceDocumentTotal) && <div><span className="text-muted-foreground">Documento</span><p>{formatPaymentListMoney(list.sourceDocumentTotal, list.currencyCode)}</p></div>}{isGlobalCommercialTotal(list.recognizedTotal) && <div><span className="text-muted-foreground">Reconhecido</span><p>{formatPaymentListMoney(list.recognizedTotal, list.currencyCode)}</p></div>}</div>{canManage && <div className="mt-4 flex flex-wrap gap-2">{actions.map((action) => <Button key={action.toStatus} variant={action.toStatus === "cancelled" ? "outline" : "default"} disabled={transition.isPending} onClick={() => { if (!window.confirm(action.confirm)) return; void transition.mutateAsync({ paymentListId: list.id, payload: { toStatus: action.toStatus } }).catch((reason) => setMessage(explanation(reason))); }}>{action.label}</Button>)}</div>}{message && <p role="alert" className="mt-3 text-sm text-destructive">{message}</p>}</header><Tabs defaultValue="summary"><TabsList><TabsTrigger value="summary">Resumo</TabsTrigger><TabsTrigger value="items">Itens</TabsTrigger><TabsTrigger value="confrontation">Confronto</TabsTrigger><TabsTrigger value="history">Histórico</TabsTrigger></TabsList><TabsContent value="summary" className="rounded-md border p-4 text-sm">{list.notes || "Sem observações registradas."}{list.paidAt && <p className="mt-2">Recebida em {new Date(list.paidAt).toLocaleDateString("pt-BR")}.</p>}</TabsContent><TabsContent value="items"><div className="overflow-x-auto rounded-md border"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-3">Veículo</th><th className="p-3">Serviços</th><th className="p-3">Técnico</th><th className="p-3 text-right">Valor</th></tr></thead><tbody>{list.items.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="p-3">{item.carName ?? item.licensePlate ?? item.vin ?? "—"}</td><td className="p-3">{servicesLabel(item)}</td><td className="p-3">{item.technicianName ?? "—"}</td><td className="p-3 text-right">{formatPaymentListMoney(item.totalAmount, list.currencyCode)}</td></tr>)}</tbody></table></div></TabsContent><TabsContent value="confrontation"><ConfrontationPanel paymentListId={list.id} items={list.items} canManage={canManage} /></TabsContent><TabsContent value="history" className="rounded-md border p-4 text-sm text-muted-foreground"><CircleHelp className="mr-1 inline h-4 w-4" />A leitura de rodadas históricas ainda não é exposta pelo contrato atual. As rodadas existentes permanecem imutáveis no backend.</TabsContent></Tabs></div>;
}
