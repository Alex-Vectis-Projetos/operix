import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search, Plus, Filter, MoreHorizontal, Pencil, Trash2, Loader2,
  Users, Building2, User as UserIcon, Mail, Phone, MapPin,
  Receipt, CreditCard, Paperclip, Upload, FileText, X, Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/api";
import { toast } from "sonner";
import {
  lookupCompany, detectQueryType, mergeCompanyIntoForm, AUTO_APPLY_THRESHOLD,
  TIER_LABEL, LOOKUP_STATUS_LABEL,
  type NormalizedCompany, type CompanyQueryType, type ConfidenceBreakdown,
  type SupportTier, type CountryCapability, type LookupStatus,
} from "@/lib/companySearch";
import {
  AlertCircle, ShieldCheck, ShieldAlert, CheckCircle2, ArrowRight,
  ChevronDown, ChevronUp, Info, Lock,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type ClientKind = "professional" | "particular";

type Contact = {
  first_name: string;
  last_name: string;
  role: string;
  email: string;
  phone: string;
};

type Client = {
  id: string;
  kind: ClientKind;
  name: string;
  customer_display_num: number | null;
  customer_display_id: string | null;
  siren: string | null;
  siret: string | null;
  tva_intracom: string | null;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  address_complement: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  iban: string | null;
  bic: string | null;
  contacts: Contact[];
  notes: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ClientListResponse = {
  clients: Client[];
  balances: Record<string, number>;
};

type ClientInvoice = {
  id: string;
  invoice_number: string;
  issue_date: string | null;
  due_date: string | null;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: string;
};

type ClientPayment = {
  id: string;
  amount: number;
  payment_date: string | null;
  reference: string | null;
};

type ClientAttachment = {
  id: string;
  file_name: string;
  storage_path: string;
  signed_url?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  created_at: string;
};

type ClientDetailResponse = {
  client: Client;
  invoices: ClientInvoice[];
  payments: ClientPayment[];
  attachments: ClientAttachment[];
  totals: {
    total: number;
    paid: number;
    remaining: number;
  };
};

const fmt = (v: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(v || 0);
const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString("pt-PT", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const emptyContact: Contact = { first_name: "", last_name: "", role: "", email: "", phone: "" };

const emptyForm = {
  kind: "professional" as ClientKind,
  name: "",
  siren: "",
  siret: "",
  tva_intracom: "",
  tax_id: "",
  email: "",
  phone: "",
  address: "",
  address_complement: "",
  postal_code: "",
  city: "",
  country: "France",
  iban: "",
  bic: "",
  contacts: [] as Contact[],
  notes: "",
  is_active: true,
};

const normalizeClient = (client: Client): Client => ({
  ...client,
  contacts: Array.isArray(client.contacts) ? client.contacts : [],
});

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Falha ao ler ficheiro"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler ficheiro"));
    reader.readAsDataURL(file);
  });

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────
export default function ClientsScreen() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | ClientKind>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Client | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Client | null>(null);
  const [detail, setDetail] = useState<Client | null>(null);

  const { data: listData, isLoading, refetch } = useQuery({
    queryKey: ["ops-billing-clients"],
    queryFn: async () => {
      const data = await apiRequest<ClientListResponse>("/billing/admin/ops/clients?active_only=false");
      return {
        clients: (data.clients ?? []).map(normalizeClient),
        balances: data.balances ?? {},
      };
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const clientsRaw = listData?.clients;
  const balancesRaw = listData?.balances;
  const clients = useMemo(() => clientsRaw ?? [], [clientsRaw]);
  const balances = useMemo(() => balancesRaw ?? {}, [balancesRaw]);

  const filtered = useMemo(() => {
    return clients.filter((c) => {
      if (kindFilter !== "all" && c.kind !== kindFilter) return false;
      if (statusFilter === "active" && !c.is_active) return false;
      if (statusFilter === "inactive" && c.is_active) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return [c.name, c.email, c.phone, c.siren, c.siret, c.tva_intracom, c.tax_id, c.city]
        .some((v) => (v ?? "").toLowerCase().includes(q));
    });
  }, [clients, search, kindFilter, statusFilter]);

  const counts = useMemo(() => ({
    all: clients.length,
    professional: clients.filter((c) => c.kind === "professional").length,
    particular: clients.filter((c) => c.kind === "particular").length,
  }), [clients]);

  const openCreate = () => { setForm(emptyForm); setEditing(null); setCreating(true); };
  const openEdit = (c: Client) => {
    setForm({
      kind: c.kind,
      name: c.name ?? "",
      siren: c.siren ?? "",
      siret: c.siret ?? "",
      tva_intracom: c.tva_intracom ?? "",
      tax_id: c.tax_id ?? "",
      email: c.email ?? "",
      phone: c.phone ?? "",
      address: c.address ?? "",
      address_complement: c.address_complement ?? "",
      postal_code: c.postal_code ?? "",
      city: c.city ?? "",
      country: c.country ?? "France",
      iban: c.iban ?? "",
      bic: c.bic ?? "",
      contacts: c.contacts ?? [],
      notes: c.notes ?? "",
      is_active: c.is_active,
    });
    setEditing(c);
    setCreating(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Nome do cliente é obrigatório");
      return;
    }
    setSaving(true);
    try {
      // Filtra contatos totalmente em branco
      const cleanContacts = (form.contacts ?? []).filter(
        (c) =>
          (c.first_name || "").trim() ||
          (c.last_name || "").trim() ||
          (c.email || "").trim() ||
          (c.phone || "").trim() ||
          (c.role || "").trim()
      );

      const payload: any = {
        kind: form.kind,
        name: form.name.trim(),
        siren: form.kind === "professional" ? (form.siren || null) : null,
        siret: form.kind === "professional" ? (form.siret || null) : null,
        tva_intracom: form.kind === "professional" ? (form.tva_intracom || null) : null,
        tax_id: form.tax_id || null,
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
        address_complement: form.address_complement || null,
        postal_code: form.postal_code || null,
        city: form.city || null,
        country: form.country || null,
        iban: form.iban || null,
        bic: form.bic || null,
        contacts: cleanContacts,
        notes: form.notes || null,
        is_active: form.is_active,
      };

      let savedClient: Client | null = null;

      if (editing) {
        const res = await apiRequest<{ client?: Client; id?: string }>(`/billing/admin/ops/clients/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res) throw new Error("Servidor não confirmou atualização do cliente.");
        savedClient = res.client ? normalizeClient(res.client) : null;
        toast.success("Cliente atualizado com sucesso!");
      } else {
        const res = await apiRequest<{ client?: Client; id?: string }>("/billing/admin/ops/clients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res || (!res.client && !res.id)) {
          throw new Error("Servidor não confirmou persistência do cliente.");
        }
        savedClient = res.client ? normalizeClient(res.client) : null;
        toast.success("Cliente criado com sucesso!");
      }

      // Fecha o modal e limpa os campos
      setCreating(false);
      setEditing(null);
      setForm(emptyForm);

      // ATUALIZAÇÃO INSTANTÂNEA REATIVA NO CACHE DO REACT QUERY (SEM PRECISAR DE F5)
      if (savedClient) {
        qc.setQueriesData({ queryKey: ["ops-billing-clients"] }, (old: any) => {
          if (!old || !Array.isArray(old.clients)) {
            return { clients: savedClient ? [savedClient] : [], balances: old?.balances ?? {} };
          }
          if (editing) {
            return {
              ...old,
              clients: old.clients.map((c: Client) => (c.id === savedClient!.id ? savedClient : c)),
            };
          } else {
            const withoutNew = old.clients.filter((c: Client) => c.id !== savedClient!.id);
            return {
              ...old,
              clients: [savedClient, ...withoutNew],
            };
          }
        });
      }

      // Sincroniza em background
      await qc.invalidateQueries({ queryKey: ["ops-billing-clients"] });
      await qc.invalidateQueries({ queryKey: ["ops-billing-clients-lite-for-invoices"] });
      await refetch();

      if (editing?.id) {
        await qc.invalidateQueries({ queryKey: ["ops-billing-client-detail", editing.id] });
      }
    } catch (e: any) {
      toast.error(`Erro ao guardar cliente: ${e?.message || "Tente novamente"}`);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      const deletedId = toDelete.id;
      await apiRequest(`/billing/admin/ops/clients/${deletedId}`, {
        method: "DELETE",
      });
      toast.success("Cliente removido com sucesso!");
      setToDelete(null);

      // ATUALIZAÇÃO INSTANTÂNEA NO CACHE PARA EXCLUSÃO (SEM PRECISAR DE F5)
      qc.setQueriesData({ queryKey: ["ops-billing-clients"] }, (old: any) => {
        if (!old || !Array.isArray(old.clients)) return old;
        return {
          ...old,
          clients: old.clients.filter((c: Client) => c.id !== deletedId),
        };
      });

      await qc.invalidateQueries({ queryKey: ["ops-billing-clients"] });
      await qc.invalidateQueries({ queryKey: ["ops-billing-clients-lite-for-invoices"] });
      await refetch();
      qc.removeQueries({ queryKey: ["ops-billing-client-detail", deletedId] });
      if (detail?.id === deletedId) {
        setDetail(null);
      }
    } catch (e: any) {
      toast.error(`Erro ao remover cliente: ${e?.message || "Tente novamente"}`);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <Breadcrumb>
        <BreadcrumbList className="text-xs">
          <BreadcrumbItem><BreadcrumbLink href="/billing/faturas">Faturamento</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Clientes</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Clientes</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Cadastro geral de clientes empresariais e particulares
          </p>
        </div>
        <Button size="sm" className="h-8" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Novo cliente
        </Button>
      </div>

      {/* Kind chips */}
      <div className="flex flex-wrap gap-2">
        <ChipBtn active={kindFilter === "all"} onClick={() => setKindFilter("all")} icon={Users} label="Todos" count={counts.all} />
        <ChipBtn active={kindFilter === "professional"} onClick={() => setKindFilter("professional")} icon={Building2} label="Profissional" count={counts.professional} tone="text-primary border-primary/40 bg-primary/10" />
        <ChipBtn active={kindFilter === "particular"} onClick={() => setKindFilter("particular")} icon={UserIcon} label="Particular" count={counts.particular} tone="text-cyan-400 border-cyan-500/40 bg-cyan-500/10" />
      </div>

      {/* Filters */}
      <Card className="border-border/50">
        <CardContent className="pt-4 pb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar por nome, email, telefone, SIREN, SIRET ou documento fiscal"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-[140px] text-xs">
              <Filter className="h-3 w-3 mr-1.5" /><SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="inactive">Inativos</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-border/50 overflow-hidden">
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="text-[10px] uppercase tracking-wider">
                <TableHead>ID</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Contato</TableHead>
                <TableHead>Documento Fiscal</TableHead>
                <TableHead>Cidade</TableHead>
                <TableHead className="text-right">Saldo em aberto</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[60px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-12">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
                </TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-12 text-xs text-muted-foreground">
                  Nenhum cliente encontrado.
                </TableCell></TableRow>
              ) : filtered.map((c) => {
                const isPro = c.kind === "professional";
                const Icon = isPro ? Building2 : UserIcon;
                const fiscal = c.siret || c.siren || c.tva_intracom || c.tax_id || "—";
                const open = balances[c.id] ?? 0;
                return (
                  <TableRow
                    key={c.id} className="text-xs cursor-pointer animate-fade-in"
                    onClick={() => setDetail(c)}
                  >
                    <TableCell className="font-mono text-[11px] font-semibold text-primary w-[140px] truncate" title={c.id}>
                      {c.customer_display_id ?? <span className="text-muted-foreground/60 font-normal">—</span>}
                    </TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(
                        "text-[10px]",
                        isPro
                          ? "text-primary border-primary/40 bg-primary/10"
                          : "text-cyan-400 border-cyan-500/40 bg-cyan-500/10"
                      )}>
                        <Icon className="h-2.5 w-2.5 mr-1" />
                        {isPro ? "Profissional" : "Particular"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <div>{c.email ?? "—"}</div>
                      <div className="text-[10px]">{c.phone ?? ""}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-[10px]">{fiscal}</TableCell>
                    <TableCell className="text-muted-foreground">{c.city ?? "—"}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      <span className={cn(open > 0 ? "text-amber-400" : "text-muted-foreground")}>
                        {fmt(open)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn(
                        "text-[10px]",
                        c.is_active
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : "bg-muted/40 text-muted-foreground border-border"
                      )}>
                        {c.is_active ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="text-xs">
                          <DropdownMenuItem onClick={() => setDetail(c)}>
                            <Receipt className="h-3.5 w-3.5 mr-2" />Ver histórico
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEdit(c)}>
                            <Pencil className="h-3.5 w-3.5 mr-2" />Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => setToDelete(c)}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" />Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Create/Edit Dialog */}
      <ClientFormDialog
        open={creating}
        editing={editing}
        form={form}
        setForm={setForm}
        saving={saving}
        onClose={() => setCreating(false)}
        onSave={save}
      />

      {/* Delete confirm */}
      <AlertDialog open={!!toDelete} onOpenChange={(o: boolean) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover cliente?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. Faturas vinculadas permanecem mas perdem a referência.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive hover:bg-destructive/90">
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Details panel */}
      <ClientDetail
        client={detail}
        open={!!detail}
        onClose={() => setDetail(null)}
        onEdit={(c) => { setDetail(null); openEdit(c); }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Company Lookup Bar — SIREN / SIRET / TVA / nome
// ─────────────────────────────────────────────────────────────
function CompanyLookupBar({ onApply }: { onApply: (c: NormalizedCompany) => void }) {
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<CompanyQueryType>("name");
  const [result, setResult] = useState<NormalizedCompany | null>(null);
  const [candidates, setCandidates] = useState<NormalizedCompany[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [providerAvailable, setProviderAvailable] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<ConfidenceBreakdown | null>(null);
  const [detectedCountry, setDetectedCountry] = useState<string | null>(null);
  const [supportTier, setSupportTier] = useState<SupportTier | null>(null);
  const [capability, setCapability] = useState<CountryCapability | null>(null);
  const [lookupStatus, setLookupStatus] = useState<LookupStatus | null>(null);
  const [confirmLow, setConfirmLow] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [totalMs, setTotalMs] = useState<number | null>(null);

  const labelByType: Partial<Record<CompanyQueryType, string>> = {
    siren: "SIREN (FR)", siret: "SIRET (FR)", vat_eu: "TVA / VAT EU",
    cnpj: "CNPJ (BR)", ein: "EIN (US)", gstin: "GSTIN (IN)",
    bn_ca: "BN (CA)", rfc_mx: "RFC (MX)", corp_jp: "法人番号 (JP)",
    name: "Buscar por nome", unknown: "—",
  };

  const run = async () => {
    if (!q.trim()) return;
    setLoading(true); setError(null); setResult(null); setCandidates([]);
    setMessage(null); setBreakdown(null); setConfirmLow(false);
    setSupportTier(null); setCapability(null); setLookupStatus(null);
    setTotalMs(null);
    try {
      const r = await lookupCompany(q.trim(), "FR");
      if (!r) throw new Error("Sem resposta do serviço de identificação");
      setProviderAvailable(r.provider_available ?? true);
      setMessage(r.message ?? null);
      setBreakdown(r.confidence_breakdown ?? null);
      setDetectedCountry(r.detected_country ?? null);
      setSupportTier((r.support_tier as SupportTier) ?? null);
      setCapability(r.capability ?? null);
      setLookupStatus((r.lookup_status as LookupStatus) ?? null);
      setTotalMs(r.total_ms ?? null);
      if (r.result) setResult(r.result);
      else if (r.candidates?.length) setCandidates(r.candidates);
      else setError(r.message || "Sem correspondência");
    } catch (e: any) {
      setError(e?.message ?? "Erro na busca");
    } finally {
      setLoading(false);
    }
  };

  const canAutoApply = breakdown?.auto_apply ?? false;
  const totalPct = breakdown ? Math.round(breakdown.total * 100) : 0;

  return (
    <div className="rounded-xl border border-border/60 p-4 space-y-3 bg-muted/15 shadow-inner">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5 font-medium text-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          Identificação inteligente — SIREN, SIRET, TVA, CNPJ, EIN, GSTIN ou nome
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[11px]">
          <span>{labelByType[type]}</span>
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          value={q}
          onChange={(e) => { setQ(e.target.value); setType(detectQueryType(e.target.value)); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); run(); } }}
          placeholder="Ex: 30134058407355, 301340584 ou nome da empresa"
          className="h-10 text-xs font-mono bg-background/80"
        />
        <Button
          type="button"
          size="sm"
          className="h-10 px-5 font-medium"
          onClick={run}
          disabled={loading || !q.trim()}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
        </Button>
      </div>

      {/* Badges bar */}
      {(lookupStatus || supportTier || detectedCountry) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {type && type !== "unknown" && (
            <span className="px-2 py-0.5 rounded-md border border-border/80 bg-background/80 text-[10px] font-mono uppercase tracking-wider text-foreground">
              {type.toUpperCase()}
            </span>
          )}
          {detectedCountry && (
            <span className="px-2 py-0.5 rounded-md border border-border/80 bg-background/80 text-[10px] font-mono uppercase tracking-wider text-foreground">
              {detectedCountry}
            </span>
          )}
          {supportTier && (
            <span className="px-2 py-0.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-[10px] font-medium text-emerald-400">
              Tier {supportTier} - {TIER_LABEL[supportTier]}
            </span>
          )}
          {lookupStatus && (
            <span className="px-2 py-0.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-[10px] font-medium text-emerald-400">
              {LOOKUP_STATUS_LABEL[lookupStatus]}
            </span>
          )}
        </div>
      )}

      {/* Info message */}
      {message && (
        <div className="flex items-center justify-between text-xs text-muted-foreground bg-background/40 px-3 py-2 rounded-lg border border-border/40">
          <div className="flex items-center gap-2">
            <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span>{message}</span>
          </div>
          {typeof totalMs === "number" && (
            <span className="font-mono text-[10px] text-muted-foreground/70 shrink-0">{totalMs} ms</span>
          )}
        </div>
      )}

      {!providerAvailable && (
        <div className="text-xs text-amber-400 flex items-center gap-1.5 p-2 bg-amber-500/10 rounded-lg border border-amber-500/20">
          <AlertCircle className="h-3.5 w-3.5" />
          Provedor não configurado — verifique a conectividade de rede.
        </div>
      )}

      {error && (
        <div className="text-xs text-destructive flex items-center gap-1.5 p-2 bg-destructive/10 rounded-lg border border-destructive/20">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </div>
      )}

      {/* Result Card — Full Enrichment */}
      {result && (
        <div className="rounded-xl border border-border/60 bg-card/60 backdrop-blur p-4 space-y-4 shadow-md">
          {/* Header of Result */}
          <div className="flex items-center justify-between gap-3 border-b border-border/40 pb-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                <CheckCircle2 className="h-3.5 w-3.5" /> Totalmente enriquecido
              </span>
              <span className="text-xs text-muted-foreground font-mono">score {totalPct}%</span>
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground font-mono">
                <Lock className="h-3 w-3" /> {result.provider}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1"
                onClick={() => setShowDetails(!showDetails)}
              >
                {showDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                Detalhes
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  onApply(result);
                  toast.success(`Informações de ${result.company_name} foram aplicadas ao formulário.`);
                }}
                className="bg-amber-500 hover:bg-amber-400 text-black font-semibold h-8 px-4 text-xs gap-1.5 shadow-sm"
              >
                Aplicar <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* 12-field grid like reference system */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 text-xs">
            <div className="rounded-lg bg-background/70 border border-border/40 p-2.5">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground/80 tracking-wider">Razão Social</div>
              <div className="font-semibold text-foreground mt-0.5 truncate" title={result.company_name ?? ""}>
                {result.company_name || "—"}
              </div>
            </div>

            <div className="rounded-lg bg-background/70 border border-border/40 p-2.5">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground/80 tracking-wider">Identificador Fiscal</div>
              <div className="font-mono text-foreground mt-0.5 truncate">{result.tax_id || result.siren || "—"}</div>
            </div>

            <div className="rounded-lg bg-background/70 border border-border/40 p-2.5">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground/80 tracking-wider">IVA Intracomunitário</div>
              <div className="font-mono text-foreground mt-0.5 truncate">{result.vat_number || "—"}</div>
            </div>

            <div className="rounded-lg bg-background/70 border border-border/40 p-2.5">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground/80 tracking-wider">SIREN</div>
              <div className="font-mono text-foreground mt-0.5 truncate">{result.siren || "—"}</div>
            </div>

            <div className="rounded-lg bg-background/70 border border-border/40 p-2.5">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground/80 tracking-wider">SIRET</div>
              <div className="font-mono text-foreground mt-0.5 truncate">{result.siret || "—"}</div>
            </div>

            <div className="rounded-lg bg-background/70 border border-border/40 p-2.5">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground/80 tracking-wider">Forma Jurídica</div>
              <div className="font-mono text-foreground mt-0.5 truncate">{result.legal_form || "—"}</div>
            </div>

            <div className="rounded-lg bg-background/70 border border-border/40 p-2.5 sm:col-span-2 md:col-span-1">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground/80 tracking-wider">Endereço</div>
              <div className="text-foreground mt-0.5 truncate" title={result.address_line ?? ""}>
                {result.address_line || [result.address?.street_number, result.address?.street].filter(Boolean).join(" ") || "—"}
              </div>
            </div>

            <div className="rounded-lg bg-background/70 border border-border/40 p-2.5">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground/80 tracking-wider">Código Postal / CEP</div>
              <div className="font-mono text-foreground mt-0.5 truncate">{result.address?.postal_code || "—"}</div>
            </div>

            <div className="rounded-lg bg-background/70 border border-border/40 p-2.5">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground/80 tracking-wider">Cidade</div>
              <div className="text-foreground mt-0.5 truncate">{result.address?.city || "—"}</div>
            </div>

            <div className="rounded-lg bg-background/70 border border-border/40 p-2.5">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground/80 tracking-wider">País</div>
              <div className="font-mono text-foreground mt-0.5 truncate">{result.address?.country || result.country || "FR"}</div>
            </div>

            <div className="rounded-lg bg-background/70 border border-border/40 p-2.5">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground/80 tracking-wider">Data de Criação</div>
              <div className="font-mono text-foreground mt-0.5 truncate">{result.creation_date || "—"}</div>
            </div>

            <div className="rounded-lg bg-background/70 border border-border/40 p-2.5">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground/80 tracking-wider">Status</div>
              <div className="font-mono text-emerald-400 mt-0.5 truncate capitalize">{result.company_status || "active"}</div>
            </div>
          </div>

          {/* Details breakdown dropdown */}
          {showDetails && breakdown && (
            <div className="rounded-lg bg-background/40 border border-border/40 p-3 space-y-2 text-[11px] font-mono">
              <div className="text-xs font-semibold text-foreground mb-1">Detalhamento dos Scores de Confiança:</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-2 rounded bg-muted/30 border border-border/40">
                  <div className="text-muted-foreground text-[10px]">Formato</div>
                  <div className="font-bold text-foreground">{(breakdown.format * 100).toFixed(0)}%</div>
                </div>
                <div className="p-2 rounded bg-muted/30 border border-border/40">
                  <div className="text-muted-foreground text-[10px]">Provedor</div>
                  <div className="font-bold text-foreground">{(breakdown.provider * 100).toFixed(0)}%</div>
                </div>
                <div className="p-2 rounded bg-muted/30 border border-border/40">
                  <div className="text-muted-foreground text-[10px]">Contexto / País</div>
                  <div className="font-bold text-foreground">{(breakdown.contextual * 100).toFixed(0)}%</div>
                </div>
                <div className="p-2 rounded bg-muted/30 border border-border/40">
                  <div className="text-muted-foreground text-[10px]">Completude</div>
                  <div className="font-bold text-foreground">{(breakdown.field_completeness * 100).toFixed(0)}%</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Multiple candidates fallback */}
      {candidates.length > 0 && (
        <div className="space-y-1.5 max-h-56 overflow-y-auto">
          <div className="text-xs text-muted-foreground font-medium">
            {candidates.length} empresas encontradas — selecione uma para aplicar:
          </div>
          {candidates.map((c, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                onApply(c);
                toast({
                  title: "Dados aplicados",
                  description: `Informações de ${c.company_name} foram aplicadas ao formulário.`,
                });
                setCandidates([]);
                setQ("");
              }}
              className="w-full text-left rounded-lg border border-border/60 hover:border-primary/50 hover:bg-primary/5 p-3 transition-all"
            >
              <div className="text-xs font-semibold text-foreground">{c.company_name}</div>
              <div className="text-[11px] text-muted-foreground font-mono mt-0.5">
                {[c.tax_id ?? c.siren, c.address?.city, c.country, c.legal_form].filter(Boolean).join(" · ")}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
function ChipBtn({
  active, onClick, icon: Icon, label, count, tone,
}: { active: boolean; onClick: () => void; icon: any; label: string; count: number; tone?: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs border transition-all",
        active
          ? (tone ?? "bg-primary/15 text-primary border-primary/40")
          : "border-border/50 text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      <Badge variant="outline" className="ml-1 text-[10px] h-4 px-1">{count}</Badge>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Form Dialog with tabs
// ─────────────────────────────────────────────────────────────
function ClientFormDialog({
  open, editing, form, setForm, saving, onClose, onSave,
}: {
  open: boolean;
  editing: Client | null;
  form: typeof emptyForm;
  setForm: (f: typeof emptyForm) => void;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const [tab, setTab] = useState("info");

  const updateContact = (i: number, patch: Partial<Contact>) => {
    const next = [...form.contacts];
    next[i] = { ...next[i], ...patch };
    setForm({ ...form, contacts: next });
  };
  const addContact = () => setForm({ ...form, contacts: [...form.contacts, { ...emptyContact }] });
  const removeContact = (i: number) =>
    setForm({ ...form, contacts: form.contacts.filter((_, idx) => idx !== i) });

  const isPro = form.kind === "professional";

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar cliente" : "Novo cliente"}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid grid-cols-3 h-9">
            <TabsTrigger value="info" className="text-xs">Informações</TabsTrigger>
            <TabsTrigger value="contacts" className="text-xs">
              Contatos
              {form.contacts.length > 0 && (
                <Badge variant="outline" className="ml-2 text-[10px] h-4 px-1">{form.contacts.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="notes" className="text-xs">Notas</TabsTrigger>
          </TabsList>

          {/* INFO TAB */}
          <TabsContent value="info" className="mt-4 space-y-4">
            {/* Kind toggle */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setForm({ ...form, kind: "professional" })}
                className={cn(
                  "flex items-center gap-2 p-3 rounded-md border text-xs transition-all",
                  isPro
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border/50 hover:border-border"
                )}
              >
                <Building2 className="h-4 w-4" />
                <div className="text-left">
                  <div className="font-medium">Profissional</div>
                  <div className="text-[10px] text-muted-foreground">Empresa, autônomo, sociedade</div>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, kind: "particular" })}
                className={cn(
                  "flex items-center gap-2 p-3 rounded-md border text-xs transition-all",
                  !isPro
                    ? "border-cyan-500/50 bg-cyan-500/10 text-cyan-400"
                    : "border-border/50 hover:border-border"
                )}
              >
                <UserIcon className="h-4 w-4" />
                <div className="text-left">
                  <div className="font-medium">Particular</div>
                  <div className="text-[10px] text-muted-foreground">Pessoa física</div>
                </div>
              </button>
            </div>

            {isPro && (
              <CompanyLookupBar
                onApply={(c) => setForm(mergeCompanyIntoForm(form, c))}
              />
            )}

            {/* Identity */}
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Label className="text-[10px] uppercase tracking-wider">
                  {isPro ? "Nome empresa *" : "Nome *"}
                </Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  maxLength={160} className="h-8 text-xs" />
              </div>

              {isPro && (
                <>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider">SIREN</Label>
                    <Input value={form.siren} onChange={(e) => setForm({ ...form, siren: e.target.value })}
                      maxLength={9} className="h-8 text-xs font-mono" placeholder="123456789" />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider">SIRET</Label>
                    <Input value={form.siret} onChange={(e) => setForm({ ...form, siret: e.target.value })}
                      maxLength={14} className="h-8 text-xs font-mono" placeholder="12345678900012" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px] uppercase tracking-wider">TVA intracom</Label>
                    <Input value={form.tva_intracom} onChange={(e) => setForm({ ...form, tva_intracom: e.target.value })}
                      maxLength={20} className="h-8 text-xs font-mono" placeholder="FRXX999999999" />
                  </div>
                </>
              )}

              <div>
                <Label className="text-[10px] uppercase tracking-wider"><Mail className="inline h-3 w-3 mr-1" />Email</Label>
                <Input type="email" value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  maxLength={160} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider"><Phone className="inline h-3 w-3 mr-1" />Telefone</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  maxLength={40} className="h-8 text-xs" />
              </div>

              {/* Address */}
              <div className="col-span-2">
                <Label className="text-[10px] uppercase tracking-wider"><MapPin className="inline h-3 w-3 mr-1" />Endereço</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })}
                  maxLength={200} className="h-8 text-xs" />
              </div>
              <div className="col-span-2">
                <Label className="text-[10px] uppercase tracking-wider">Complemento</Label>
                <Input value={form.address_complement}
                  onChange={(e) => setForm({ ...form, address_complement: e.target.value })}
                  maxLength={200} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider">Código postal</Label>
                <Input value={form.postal_code}
                  onChange={(e) => setForm({ ...form, postal_code: e.target.value })}
                  maxLength={20} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider">Cidade</Label>
                <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}
                  maxLength={120} className="h-8 text-xs" />
              </div>
              <div className="col-span-2">
                <Label className="text-[10px] uppercase tracking-wider">País</Label>
                <Input value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })}
                  maxLength={80} className="h-8 text-xs" />
              </div>

              {/* Bank */}
              <div>
                <Label className="text-[10px] uppercase tracking-wider">IBAN</Label>
                <Input value={form.iban} onChange={(e) => setForm({ ...form, iban: e.target.value })}
                  maxLength={40} className="h-8 text-xs font-mono" placeholder="FR76..." />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider">BIC</Label>
                <Input value={form.bic} onChange={(e) => setForm({ ...form, bic: e.target.value })}
                  maxLength={20} className="h-8 text-xs font-mono" />
              </div>
            </div>
          </TabsContent>

          {/* CONTACTS TAB */}
          <TabsContent value="contacts" className="mt-4 space-y-3">
            {form.contacts.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">
                Nenhum contato adicionado.
              </p>
            )}
            {form.contacts.map((ct, i) => (
              <Card key={i} className="border-border/50">
                <CardContent className="pt-3 pb-3 grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider">Nome</Label>
                    <Input value={ct.first_name} onChange={(e) => updateContact(i, { first_name: e.target.value })}
                      className="h-8 text-xs" />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider">Sobrenome</Label>
                    <Input value={ct.last_name} onChange={(e) => updateContact(i, { last_name: e.target.value })}
                      className="h-8 text-xs" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px] uppercase tracking-wider">Função</Label>
                    <Input value={ct.role} onChange={(e) => updateContact(i, { role: e.target.value })}
                      className="h-8 text-xs" placeholder="Ex.: Gerente, Comprador, Diretor" />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider">Email</Label>
                    <Input type="email" value={ct.email} onChange={(e) => updateContact(i, { email: e.target.value })}
                      className="h-8 text-xs" />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider">Telefone</Label>
                    <Input value={ct.phone} onChange={(e) => updateContact(i, { phone: e.target.value })}
                      className="h-8 text-xs" />
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <Button type="button" variant="ghost" size="sm" className="h-7 text-destructive"
                      onClick={() => removeContact(i)}>
                      <Trash2 className="h-3 w-3 mr-1" />Remover contato
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            <Button type="button" variant="outline" size="sm" className="w-full h-8" onClick={addContact}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />Adicionar contato
            </Button>
          </TabsContent>

          {/* NOTES TAB */}
          <TabsContent value="notes" className="mt-4">
            <Label className="text-[10px] uppercase tracking-wider">Observações internas</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              maxLength={2000} rows={10} className="text-xs"
              placeholder="Notas internas sobre o cliente, condições especiais, histórico, etc." />
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button size="sm" onClick={onSave} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            {editing ? "Atualizar" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────
// Detail panel
// ─────────────────────────────────────────────────────────────
function ClientDetail({
  client, open, onClose, onEdit,
}: {
  client: Client | null; open: boolean; onClose: () => void; onEdit: (c: Client) => void;
}) {
  const qc = useQueryClient();
  const id = client?.id;

  const { data: detailData } = useQuery({
    queryKey: ["ops-billing-client-detail", id],
    enabled: !!id && open,
    queryFn: async () => {
      const data = await apiRequest<ClientDetailResponse>(`/billing/admin/ops/clients/${id}`);
      return {
        ...data,
        client: normalizeClient(data.client),
        invoices: data.invoices ?? [],
        payments: data.payments ?? [],
        attachments: data.attachments ?? [],
        totals: data.totals ?? { total: 0, paid: 0, remaining: 0 },
      };
    },
  });
  const activeClient = detailData?.client ?? client;
  const invoices = useMemo(() => detailData?.invoices ?? [], [detailData?.invoices]);
  const payments = useMemo(() => detailData?.payments ?? [], [detailData?.payments]);
  const attachments = useMemo(() => detailData?.attachments ?? [], [detailData?.attachments]);

  const totals = useMemo(() => {
    if (detailData?.totals) return detailData.totals;
    const total = invoices.reduce((s: number, i: any) => s + Number(i.total_amount ?? 0), 0);
    const paid = invoices.reduce((s: number, i: any) => s + Number(i.paid_amount ?? 0), 0);
    return { total, paid, remaining: total - paid };
  }, [detailData?.totals, invoices]);

  const handleUpload = async (file: File) => {
    if (!id) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      await apiRequest(`/billing/admin/ops/clients/${id}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_name: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
          data_url: dataUrl,
        }),
      });
      toast.success("Anexo adicionado com sucesso!");
      qc.invalidateQueries({ queryKey: ["ops-billing-client-detail", id] });
    } catch (e: any) {
      toast.error(`Erro ao anexar documento: ${e?.message || "Tente novamente"}`);
    }
  };

  const removeAttachment = async (a: ClientAttachment) => {
    try {
      await apiRequest(`/billing/admin/ops/clients/${id}/attachments/${a.id}`, {
        method: "DELETE",
      });
      toast.success("Anexo removido com sucesso!");
      qc.invalidateQueries({ queryKey: ["ops-billing-client-detail", id] });
    } catch (e: any) {
      toast.error(`Erro ao remover anexo: ${e?.message || "Tente novamente"}`);
    }
  };

  const openAttachment = async (a: ClientAttachment) => {
    const target = a.signed_url || a.storage_path;
    if (target) window.open(target, "_blank", "noopener,noreferrer");
  };

  if (!activeClient) return null;
  const isPro = activeClient.kind === "professional";
  const Icon = isPro ? Building2 : UserIcon;

  return (
    <Dialog open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <DialogContent className="w-full sm:max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className={cn("h-4 w-4", isPro ? "text-primary" : "text-cyan-400")} />
            {activeClient.name}
            <Badge variant="outline" className="ml-auto text-[10px]">
              {isPro ? "Profissional" : "Particular"}
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <Card className="border-border/50"><CardContent className="pt-3 pb-2">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Total faturado</p>
              <p className="text-sm font-semibold tabular-nums">{fmt(totals.total)}</p>
            </CardContent></Card>
            <Card className="border-border/50"><CardContent className="pt-3 pb-2">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Pago</p>
              <p className="text-sm font-semibold text-emerald-400 tabular-nums">{fmt(totals.paid)}</p>
            </CardContent></Card>
            <Card className="border-border/50"><CardContent className="pt-3 pb-2">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">Em aberto</p>
              <p className="text-sm font-semibold text-amber-400 tabular-nums">{fmt(totals.remaining)}</p>
            </CardContent></Card>
          </div>

          <Card className="border-border/50">
            <CardContent className="pt-3 pb-3 text-xs space-y-1.5">
              {isPro && <Row k="SIREN" v={activeClient.siren} mono />}
              {isPro && <Row k="SIRET" v={activeClient.siret} mono />}
              {isPro && <Row k="TVA" v={activeClient.tva_intracom} mono />}
              <Row k="Email" v={activeClient.email} />
              <Row k="Telefone" v={activeClient.phone} />
              <Row k="Endereço" v={[activeClient.address, activeClient.address_complement].filter(Boolean).join(", ") || null} />
              <Row k="Cidade" v={[activeClient.postal_code, activeClient.city, activeClient.country].filter(Boolean).join(" · ") || null} />
              <Row k="IBAN" v={activeClient.iban} mono />
              <Row k="BIC" v={activeClient.bic} mono />
              {activeClient.notes && (
                <div className="pt-2 mt-2 border-t border-border/50">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Notas</p>
                  <p className="mt-1 whitespace-pre-wrap">{activeClient.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {activeClient.contacts.length > 0 && (
            <Card className="border-border/50">
              <CardContent className="pt-3 pb-3 space-y-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Contatos ({activeClient.contacts.length})</p>
                {activeClient.contacts.map((c, i) => (
                  <div key={i} className="text-xs border-l-2 border-primary/40 pl-2">
                    <div className="font-medium">{c.first_name} {c.last_name} {c.role && <span className="text-muted-foreground font-normal">· {c.role}</span>}</div>
                    <div className="text-[10px] text-muted-foreground">{c.email} {c.phone && `· ${c.phone}`}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="invoices">
            <TabsList className="grid grid-cols-3 h-8">
              <TabsTrigger value="invoices" className="text-xs"><Receipt className="h-3 w-3 mr-1" />Faturas</TabsTrigger>
              <TabsTrigger value="payments" className="text-xs"><CreditCard className="h-3 w-3 mr-1" />Pagamentos</TabsTrigger>
              <TabsTrigger value="attachments" className="text-xs"><Paperclip className="h-3 w-3 mr-1" />Anexos</TabsTrigger>
            </TabsList>

            <TabsContent value="invoices" className="mt-3 space-y-1.5">
              {invoices.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">Sem faturas registadas.</p>
              ) : invoices.map((i) => (
                <div key={i.id} className="flex items-center justify-between p-2 rounded-md border border-border/50 text-xs">
                  <div>
                    <p className="font-mono text-primary">{i.invoice_number}</p>
                    <p className="text-[10px] text-muted-foreground">
                      Emit. {fmtDate(i.issue_date)} · Venc. {fmtDate(i.due_date)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular-nums">{fmt(Number(i.total_amount))}</p>
                    <Badge variant="outline" className="text-[9px] mt-0.5">{i.status}</Badge>
                  </div>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="payments" className="mt-3 space-y-1.5">
              {payments.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">Sem pagamentos.</p>
              ) : payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-2 rounded-md border border-border/50 text-xs">
                  <div>
                    <p>{fmtDate(p.payment_date)}</p>
                    <p className="text-[10px] text-muted-foreground font-mono">{p.reference ?? "—"}</p>
                  </div>
                  <p className="font-semibold tabular-nums text-emerald-400">{fmt(Number(p.amount))}</p>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="attachments" className="mt-3 space-y-2">
              <label className="flex items-center justify-center gap-2 p-3 border-2 border-dashed border-border/50 rounded-md cursor-pointer hover:border-primary/40 transition-colors text-xs text-muted-foreground">
                <Upload className="h-3.5 w-3.5" />
                Carregar documento
                <input type="file" className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} />
              </label>
              {attachments.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">Sem anexos.</p>
              ) : attachments.map((a) => (
                <div key={a.id} className="flex items-center justify-between p-2 rounded-md border border-border/50 text-xs">
                  <button onClick={() => openAttachment(a)} className="flex items-center gap-2 min-w-0 flex-1 text-left hover:text-primary">
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{a.file_name}</span>
                  </button>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeAttachment(a)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={() => onEdit(activeClient)}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />Editar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ k, v, mono }: { k: string; v?: string | null; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground text-[10px] uppercase tracking-wider shrink-0">{k}</span>
      <span className={cn("text-right truncate", mono && "font-mono text-[11px]")}>{v ?? "—"}</span>
    </div>
  );
}
