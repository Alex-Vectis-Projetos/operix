import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { AlertCircle, ChevronLeft, FileText, Loader2, RefreshCw, RotateCw, Upload, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useClients } from "@/hooks/useServiceOrders";
import {
  getPaymentListImportPreview,
  type ExternalListImportItem,
  type ExternalListImportServiceReview,
  type JsonValue,
  type PaymentList,
} from "@/lib/apiPaymentLists";
import {
  useCommitPaymentListImport,
  useCreatePaymentListImport,
  useDiscardPaymentListImport,
  usePaymentListImport,
  useRetryPaymentListImportExtraction,
  useUpdatePaymentListImportRows,
} from "@/hooks/usePaymentLists";

type RowDraft = {
  reviewedLicensePlate: string;
  reviewedVin: string;
  reviewedCarName: string;
  reviewedTotal: string;
  reviewedServices: ExternalListImportServiceReview[];
};

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function servicesFrom(value: JsonValue | null): ExternalListImportServiceReview[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((service) => ({
    ...(typeof service.code === "string" ? { code: service.code } : {}),
    ...(typeof service.description === "string" ? { description: service.description } : {}),
    ...(typeof service.quantity === "string" || typeof service.quantity === "number" ? { quantity: service.quantity } : {}),
    ...(typeof service.amount === "string" || typeof service.amount === "number" ? { amount: service.amount } : {}),
    ...(typeof service.unitPrice === "string" || typeof service.unitPrice === "number" ? { unitPrice: service.unitPrice } : {}),
  }));
}

function draftFrom(item: ExternalListImportItem): RowDraft {
  return {
    reviewedLicensePlate: item.reviewedLicensePlate ?? "",
    reviewedVin: item.reviewedVin ?? "",
    reviewedCarName: item.reviewedCarName ?? "",
    reviewedTotal: item.reviewedTotal ?? "",
    reviewedServices: servicesFrom(item.reviewedServices ?? item.rawServices),
  };
}

function confidenceGuidance(value: JsonValue | null) {
  if (!isRecord(value)) return null;
  const levels = Object.values(value).filter((entry): entry is string => typeof entry === "string").map((entry) => entry.toLowerCase());
  if (levels.includes("low")) return "Extração com confiança baixa: revise os campos antes de salvar.";
  if (levels.includes("medium")) return "Extração com confiança média: confira os campos sinalizados.";
  if (levels.includes("high")) return "Extração com confiança alta: a revisão humana ainda é obrigatória.";
  return null;
}

function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = String(error.code);
    if (code === "MISSING_REQUIRED_STAGING_FIELDS") return "Revise cliente, moeda, veículo, serviços e valor antes de efetivar a Lista.";
    if (code === "IMPORT_REVIEW_STATE_INVALID") return "Esta importação não aceita mais revisão.";
    if (code === "REVIEWED_CLIENT_NOT_IN_WORKSPACE") return "O cliente selecionado não pertence ao workspace ativo.";
  }
  return error instanceof Error ? error.message : "Não foi possível concluir esta operação.";
}

function ImportDocumentPreview({ storagePath, mimeType }: { storagePath: string | null; mimeType: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);

  useEffect(() => {
    let active = true;
    if (!storagePath) return undefined;
    setUrl(null);
    setError(null);
    getPaymentListImportPreview(storagePath)
      .then((preview) => { if (active) setUrl(preview.url); })
      .catch((reason: unknown) => { if (active) setError(errorMessage(reason)); });
    return () => { active = false; };
  }, [storagePath]);

  if (!storagePath) return <div className="flex min-h-64 items-center justify-center rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">O documento ainda não possui proveniência disponível para preview.</div>;
  if (error) return <div className="flex min-h-64 items-center justify-center rounded-md border border-destructive/40 p-6 text-center text-sm text-destructive">{error}</div>;
  if (!url) return <div className="flex min-h-64 items-center justify-center rounded-md border p-6 text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando documento protegido…</div>;

  const image = mimeType?.startsWith("image/");
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1" aria-label="Controles do documento">
        <Button type="button" size="icon" variant="outline" aria-label="Diminuir zoom" onClick={() => setZoom((value) => Math.max(50, value - 25))}><ZoomOut className="h-4 w-4" /></Button>
        <Button type="button" size="icon" variant="outline" aria-label="Aumentar zoom" onClick={() => setZoom((value) => Math.min(200, value + 25))}><ZoomIn className="h-4 w-4" /></Button>
        <Button type="button" size="icon" variant="outline" aria-label="Rotacionar documento" onClick={() => setRotation((value) => (value + 90) % 360)}><RotateCw className="h-4 w-4" /></Button>
        <a className="ml-auto text-xs text-primary underline-offset-4 hover:underline" href={url} target="_blank" rel="noreferrer">Abrir documento</a>
      </div>
      <div className="min-h-80 overflow-auto rounded-md border bg-muted/20 p-2">
        {image ? <img src={url} alt="Documento original da Lista" style={{ width: `${zoom}%`, transform: `rotate(${rotation}deg)` }} className="mx-auto origin-center transition-transform" /> : <iframe title="Documento original da Lista" src={url} style={{ width: `${zoom}%`, minWidth: "100%", transform: `rotate(${rotation}deg)` }} className="min-h-[32rem] border-0" />}
      </div>
    </div>
  );
}

function ReviewRows({ items, drafts, onChange }: { items: ExternalListImportItem[]; drafts: Record<string, RowDraft>; onChange: (id: string, draft: RowDraft) => void }) {
  return <div className="space-y-3">{items.map((item) => {
    const draft = drafts[item.id] ?? draftFrom(item);
    const confidence = confidenceGuidance(item.fieldConfidence);
    return <section key={item.id} className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between gap-2"><strong className="text-sm">Linha extraída</strong><span className="text-xs text-muted-foreground">{item.status}</span></div>
      <p className="mb-3 text-xs text-muted-foreground">Original: {item.rawCarName ?? "veículo não identificado"} · {item.rawLicensePlate ?? item.rawVin ?? "sem placa/VIN"} · {item.rawTotalText ?? "valor não extraído"}</p>
      {confidence && <p className="mb-3 rounded bg-amber-500/10 p-2 text-xs text-amber-200">{confidence}</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        <Input aria-label="Veículo revisado" value={draft.reviewedCarName} placeholder="Veículo" onChange={(event) => onChange(item.id, { ...draft, reviewedCarName: event.target.value })} />
        <Input aria-label="Placa revisada" value={draft.reviewedLicensePlate} placeholder="Placa" onChange={(event) => onChange(item.id, { ...draft, reviewedLicensePlate: event.target.value })} />
        <Input aria-label="VIN revisado" value={draft.reviewedVin} placeholder="VIN" onChange={(event) => onChange(item.id, { ...draft, reviewedVin: event.target.value })} />
        <Input aria-label="Valor revisado" value={draft.reviewedTotal} placeholder="Valor, ex.: 1200,00" onChange={(event) => onChange(item.id, { ...draft, reviewedTotal: event.target.value })} />
      </div>
      <Label className="mt-3 block text-xs">Serviços revisados</Label>
      <div className="mt-1 space-y-2">{draft.reviewedServices.map((service, index) => <div key={index} className="grid gap-2 sm:grid-cols-3">
        <Input aria-label={`Serviço ${index + 1}`} value={service.description ?? service.code ?? ""} placeholder="Serviço" onChange={(event) => {
          const services = draft.reviewedServices.map((current, position) => position === index ? { ...current, description: event.target.value } : current);
          onChange(item.id, { ...draft, reviewedServices: services });
        }} />
        <Input aria-label={`Quantidade ${index + 1}`} value={String(service.quantity ?? "1")} placeholder="Quantidade" onChange={(event) => {
          const services = draft.reviewedServices.map((current, position) => position === index ? { ...current, quantity: event.target.value } : current);
          onChange(item.id, { ...draft, reviewedServices: services });
        }} />
        <Input aria-label={`Valor do serviço ${index + 1}`} value={String(service.amount ?? service.unitPrice ?? "")} placeholder="Valor" onChange={(event) => {
          const services = draft.reviewedServices.map((current, position) => position === index ? { ...current, amount: event.target.value } : current);
          onChange(item.id, { ...draft, reviewedServices: services });
        }} />
      </div>)}</div>
      <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => onChange(item.id, { ...draft, reviewedServices: [...draft.reviewedServices, { description: "", quantity: "1", amount: "" }] })}>Adicionar serviço</Button>
    </section>;
  })}</div>;
}

function ReviewContent({ clients, clientId, currencyCode, setClientId, setCurrencyCode, items, drafts, setDrafts }: { clients: Array<{ id: string; name: string }>; clientId: string; currencyCode: string; setClientId: (value: string) => void; setCurrencyCode: (value: string) => void; items: ExternalListImportItem[]; drafts: Record<string, RowDraft>; setDrafts: Dispatch<SetStateAction<Record<string, RowDraft>>> }) {
  return <div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><div><Label>Cliente revisado</Label><Select value={clientId} onValueChange={setClientId}><SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger><SelectContent>{clients.map((client) => <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Moeda revisada</Label><Input value={currencyCode} maxLength={3} placeholder="EUR" onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())} /></div></div><ReviewRows items={items} drafts={drafts} onChange={(id, draft) => setDrafts((current) => ({ ...current, [id]: draft }))} /></div>;
}

export function PaymentListImportDialog({ importId, onImportReady, onCommitted, onClose }: { importId: string | null; onImportReady: (id: string) => void; onCommitted: (list: PaymentList) => void; onClose: () => void }) {
  const { data } = usePaymentListImport(importId);
  const imported = data?.import;
  const { data: clients = [] } = useClients();
  const create = useCreatePaymentListImport();
  const retry = useRetryPaymentListImportExtraction();
  const saveReview = useUpdatePaymentListImportRows();
  const commit = useCommitPaymentListImport();
  const discard = useDiscardPaymentListImport();
  const [clientId, setClientId] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!imported) return;
    setClientId(imported.reviewedClientId ?? "");
    setCurrencyCode(imported.reviewedCurrencyCode ?? "");
    setDrafts(Object.fromEntries(imported.items.map((item) => [item.id, draftFrom(item)])));
  }, [imported]);

  const canReview = imported?.status === "extracted" || imported?.status === "under_review" || imported?.status === "reviewed";
  const commitSummary = useMemo(() => ({ rows: imported?.items.length ?? 0, client: clients.find((client) => client.id === clientId)?.name ?? "Cliente não selecionado", currency: currencyCode || "Moeda não selecionada" }), [clients, clientId, currencyCode, imported?.items.length]);

  const upload = async (file: File) => {
    setError(null);
    try { onImportReady((await create.mutateAsync(file)).importId); } catch (reason) { setError(errorMessage(reason)); }
  };
  const save = async () => {
    if (!imported) return;
    setError(null);
    try {
      await saveReview.mutateAsync({ importId: imported.id, payload: { header: { reviewedClientId: clientId || null, reviewedCurrencyCode: currencyCode || null }, rows: imported.items.map((item) => {
        const draft = drafts[item.id] ?? draftFrom(item);
        return { id: item.id, patch: { reviewedCarName: draft.reviewedCarName || null, reviewedLicensePlate: draft.reviewedLicensePlate || null, reviewedVin: draft.reviewedVin || null, reviewedTotal: draft.reviewedTotal || null, reviewedServices: draft.reviewedServices.length ? draft.reviewedServices : null } };
      }) } });
    } catch (reason) { setError(errorMessage(reason)); }
  };
  const materialize = async () => { if (!imported || !window.confirm(`Efetivar ${commitSummary.rows} linha(s) para ${commitSummary.client} em ${commitSummary.currency}?`)) return; try { onCommitted(await commit.mutateAsync({ importId: imported.id })); } catch (reason) { setError(errorMessage(reason)); } };

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-w-6xl"><DialogHeader><DialogTitle>Importar Lista de Pagamento</DialogTitle><DialogDescription>Upload, revisão humana e efetivação são etapas separadas.</DialogDescription></DialogHeader>
    {!imported ? <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-md border border-dashed p-6 text-center"><Upload className="mb-2 h-6 w-6" /><span>Selecionar PDF, PNG ou JPEG</span><input className="sr-only" type="file" accept="application/pdf,image/png,image/jpeg" disabled={create.isPending} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} />{create.isPending && <Loader2 className="mt-3 h-4 w-4 animate-spin" />}</label> : <>
      <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 p-3 text-sm"><FileText className="h-4 w-4" /><span>{imported.fileName}</span><span className="text-muted-foreground">{imported.status}</span>{imported.fileSha256 && <span className="ml-auto text-xs text-muted-foreground">SHA-256: {imported.fileSha256.slice(0, 12)}…</span>}</div>
      {imported.status === "failed" && <div className="flex items-center gap-2 rounded-md border border-destructive/40 p-3 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{imported.errorMessage ?? "Falha na extração."}<Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => void retry.mutateAsync(imported.id).catch((reason) => setError(errorMessage(reason)))}><RefreshCw className="mr-1 h-3 w-3" />Tentar novamente</Button></div>}
      {canReview && <>
        <div className="hidden gap-4 lg:grid lg:grid-cols-2"><ImportDocumentPreview storagePath={imported.storagePath} mimeType={imported.mimeType} /><ReviewContent clients={clients} clientId={clientId} currencyCode={currencyCode} setClientId={setClientId} setCurrencyCode={setCurrencyCode} items={imported.items} drafts={drafts} setDrafts={setDrafts} /></div>
        <div className="lg:hidden"><Tabs defaultValue="dados"><TabsList><TabsTrigger value="documento">Documento</TabsTrigger><TabsTrigger value="dados">Dados extraídos</TabsTrigger></TabsList><TabsContent value="documento"><ImportDocumentPreview storagePath={imported.storagePath} mimeType={imported.mimeType} /></TabsContent><TabsContent value="dados"><ReviewContent clients={clients} clientId={clientId} currencyCode={currencyCode} setClientId={setClientId} setCurrencyCode={setCurrencyCode} items={imported.items} drafts={drafts} setDrafts={setDrafts} /></TabsContent></Tabs></div>
      </>}
      {imported.status === "reviewed" && <p className="text-sm text-emerald-400">Revisão completa. A Lista ainda não foi efetivada.</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-between gap-2"><div className="flex gap-2"><Button variant="ghost" onClick={onClose}><ChevronLeft className="mr-1 h-4 w-4" />Fechar</Button>{imported.status !== "committed" && <Button variant="outline" disabled={discard.isPending} onClick={() => { if (window.confirm("Descartar esta importação? As revisões salvas serão perdidas.")) void discard.mutateAsync(imported.id).then(onClose).catch((reason) => setError(errorMessage(reason))); }}>Descartar importação</Button>}</div><div className="flex gap-2">{canReview && <Button variant="outline" disabled={saveReview.isPending} onClick={() => void save()}>{saveReview.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Salvar revisão</Button>}<Button disabled={imported.status !== "reviewed" || commit.isPending} onClick={() => void materialize()}>{commit.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Efetivar Lista</Button></div></div>
    </>}</DialogContent></Dialog>;
}
