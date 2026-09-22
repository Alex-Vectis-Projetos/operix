import { ClipboardList, Loader2, Upload } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useRole } from "@/hooks/useRole";
import { usePaymentLists } from "@/hooks/usePaymentLists";
import type { PaymentList } from "@/lib/apiPaymentLists";
import { PaymentListDetail } from "./PaymentListDetail";
import { PaymentListImportDialog } from "./PaymentListImportDialog";
import { PaymentListStatusBadge } from "./PaymentListStatusBadge";
import { formatPaymentListMoney, isGlobalCommercialTotal } from "./paymentListUi";

function ListRow({ list, onOpen }: { list: PaymentList; onOpen: () => void }) {
  return <button type="button" onClick={onOpen} className="w-full border-b text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring last:border-0"><div className="hidden grid-cols-[minmax(8rem,1fr)_minmax(10rem,1.5fr)_9rem_7rem_minmax(8rem,1fr)] items-center gap-3 p-3 text-sm md:grid"><strong>{list.listNumber}</strong><span>{list.clientName}</span><PaymentListStatusBadge status={list.status} /><span>{list.itemCount} item(ns)</span><span className="text-right">{isGlobalCommercialTotal(list.recognizedTotal) ? formatPaymentListMoney(list.recognizedTotal, list.currencyCode) : "—"}</span></div><div className="space-y-2 p-3 text-sm md:hidden"><div className="flex items-center justify-between gap-2"><strong>{list.listNumber}</strong><PaymentListStatusBadge status={list.status} /></div><p>{list.clientName}</p><div className="flex justify-between text-xs text-muted-foreground"><span>{list.itemCount} item(ns)</span><span>{isGlobalCommercialTotal(list.recognizedTotal) ? formatPaymentListMoney(list.recognizedTotal, list.currencyCode) : "—"}</span></div></div></button>;
}

export function PaymentListWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: lists = [], isLoading, error } = usePaymentLists();
  const { isAdmin, isOwner } = useRole();
  const canManage = isAdmin || isOwner;
  const selectedListId = searchParams.get("list");
  const importId = searchParams.get("import");
  const updateRoute = (changes: Record<string, string | null>) => setSearchParams((current) => {
    const next = new URLSearchParams(current);
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    return next;
  });

  if (selectedListId) return <div className="animate-fade-in"><PaymentListDetail paymentListId={selectedListId} canManage={canManage} onBack={() => updateRoute({ list: null })} /></div>;

  return <div className="animate-fade-in space-y-4"><header className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-card p-4"><div className="flex gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10"><ClipboardList className="h-5 w-5 text-primary" /></div><div><h1 className="text-xl font-semibold">Listas de pagamento</h1><p className="text-sm text-muted-foreground">Registro comercial canônico, governado pelo backend.</p></div></div>{canManage && <Button onClick={() => updateRoute({ import: "new" })}><Upload className="mr-2 h-4 w-4" />Importar documento</Button>}</header>
    {isLoading ? <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando Listas…</div> : error ? <p role="alert" className="rounded-md border border-destructive/40 p-4 text-sm text-destructive">Não foi possível carregar as Listas de Pagamento.</p> : lists.length === 0 ? <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">Nenhuma Lista de Pagamento disponível para o seu acesso.</div> : <section className="overflow-hidden rounded-lg border"><div className="hidden grid-cols-[minmax(8rem,1fr)_minmax(10rem,1.5fr)_9rem_7rem_minmax(8rem,1fr)] gap-3 border-b bg-muted/30 p-3 text-xs font-medium uppercase tracking-wide text-muted-foreground md:grid"><span>Lista</span><span>Cliente</span><span>Status</span><span>Itens</span><span className="text-right">Reconhecido</span></div>{lists.map((list) => <ListRow key={list.id} list={list} onOpen={() => updateRoute({ list: list.id, import: null })} />)}</section>}
    {canManage && importId && <PaymentListImportDialog importId={importId === "new" ? null : importId} onImportReady={(id) => updateRoute({ import: id })} onCommitted={(list) => updateRoute({ import: null, list: list.id })} onClose={() => updateRoute({ import: null })} />}
  </div>;
}
