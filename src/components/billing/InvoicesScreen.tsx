import React, { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  Search, Plus, Filter, FileText, FileSpreadsheet,
  MoreHorizontal, Eye, Pencil, Trash2, ChevronLeft, ChevronRight,
  X, History, Loader2, ArrowDownToLine, ArrowUpFromLine,
  Printer, FileEdit, FileUp, Send, Save,
} from "lucide-react";
import ImportInvoiceDialog from "./ImportInvoiceDialog";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { BRAND } from "@/config/brand";
import { InvoiceDocumentA4 } from "./InvoiceDocumentA4";
import { getPaymentTermLabel } from "@/i18n/invoices";
import { SendInvoiceDialog } from "./SendInvoiceDialog";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import ExcelJS from "exceljs";
import { toast } from "sonner";
import { PaymentListsSelector } from "@/components/billing/PaymentListsSelector";
import type { BillingPaymentList } from "@/hooks/usePaymentListsConsolidated";
import { BrandLogo } from "@/components/BrandLogo";
import { apiRequest } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs";
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList,
  BreadcrumbPage, BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

// ───────────────────────────── types
type InvoiceStatus = "draft" | "pending" | "partial" | "paid" | "overdue" | "cancelled";
type InvoiceType = "incoming" | "outgoing";

type CustomerSnapshot = {
  billing_client_id: string | null;
  name: string;
  kind?: string | null;
  tax_id?: string | null;
  siren?: string | null;
  siret?: string | null;
  tva_intracom?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  address_complement?: string | null;
  postal_code?: string | null;
  city?: string | null;
  country?: string | null;
  iban?: string | null;
  bic?: string | null;
  language?: string | null;
  currency?: string | null;
  payment_terms?: string | null;
  captured_at: string;
};

type Invoice = {
  id: string;
  invoice_number: string;
  type: InvoiceType;
  supplier_id: string | null;
  billing_client_id: string | null;
  customer_name: string | null;
  customer_snapshot: CustomerSnapshot | null;
  vehicle_id: string | null;
  fleet_id: string | null;
  service_order_id: string | null;
  issue_date: string;
  due_date: string | null;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: InvoiceStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  metadata?: {
    // Canonical link — LISTS consolidate payment_orders for billing purposes.
    linked_list_names?: string[];
    linked_lists_meta?: Array<{
      list_name: string; technician_name: string; assigned_user_id: string | null;
      client_name: string | null; year: number; week: number; total: number; po_count: number;
    }>;
    linked_user_ids?: string[];
    // Underlying PO ids (expanded from selected lists) — required by status-propagation trigger.
    linked_payment_order_ids?: string[];
    linked_payment_orders?: string[]; // legacy alias
    // Legacy (older snapshots) — kept for read fallback only
    linked_payment_orders_meta?: Array<{
      id: string; code: string; assigned_user_id: string | null;
      technician_name: string; week: number; year: number; total: number;
      service_order_id: string | null; list_name: string | null;
    }>;
    linked_list_ids?: string[];
    linked_lists?: Array<{ id: string; user_id: string; technician_name: string; week: number; year: number; os_count: number; total: number }>;
  } | null;
};

type Supplier = { id: string; name: string };
type Client = {
  id: string;
  name: string;
  kind: string | null;
  tax_id: string | null;
  siren: string | null;
  siret: string | null;
  tva_intracom: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  address_complement: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  iban: string | null;
  bic: string | null;
  // Compatibility with previous shape
  contact_email?: string | null;
  contact_phone?: string | null;
  notes?: string | null;
};

function buildSnapshot(c: Client | null): CustomerSnapshot | null {
  if (!c) return null;
  return {
    billing_client_id: c.id,
    name: c.name,
    kind: c.kind ?? null,
    tax_id: c.tax_id ?? null,
    siren: c.siren ?? null,
    siret: c.siret ?? null,
    tva_intracom: c.tva_intracom ?? null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    address: c.address ?? null,
    address_complement: c.address_complement ?? null,
    postal_code: c.postal_code ?? null,
    city: c.city ?? null,
    country: c.country ?? null,
    iban: c.iban ?? null,
    bic: c.bic ?? null,
    language: null,
    currency: "EUR",
    payment_terms: null,
    captured_at: new Date().toISOString(),
  };
}

// Payment terms presets
type PaymentTerm = "on_receipt" | "net_15" | "net_30" | "net_45" | "net_60" | "end_of_month" | "custom";
const PAYMENT_TERMS: { value: PaymentTerm; label: string; days: number | null }[] = [
  { value: "on_receipt",   label: "Após recebimento", days: 0 },
  { value: "net_15",       label: "15 dias",          days: 15 },
  { value: "net_30",       label: "30 dias",          days: 30 },
  { value: "net_45",       label: "45 dias",          days: 45 },
  { value: "net_60",       label: "60 dias",          days: 60 },
  { value: "end_of_month", label: "Final do mês",     days: null },
  { value: "custom",       label: "Data personalizada", days: null },
];

const TAX_RATES = [0, 5.5, 8.5, 10, 20, 21] as const;

type InvoiceItem = {
  id: string;
  designation: string;
  quantity: number;
  unit: string;
  unit_price: number;
  tax_rate: number;
};

const newItem = (): InvoiceItem => ({
  id: crypto.randomUUID(),
  designation: "",
  quantity: 1,
  unit: "un",
  unit_price: 0,
  tax_rate: 20,
});

const STATUS_META: Record<InvoiceStatus, { label: string; cls: string; dot: string }> = {
  draft:     { label: "Rascunho", cls: "bg-muted/40 text-muted-foreground border-border",            dot: "bg-muted-foreground" },
  pending:   { label: "Pendente", cls: "bg-amber-500/10 text-amber-400 border-amber-500/30",         dot: "bg-amber-400" },
  partial:   { label: "Parcial",  cls: "bg-blue-500/10 text-blue-400 border-blue-500/30",            dot: "bg-blue-400" },
  paid:      { label: "Pago",     cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",   dot: "bg-emerald-400" },
  overdue:   { label: "Vencida",  cls: "bg-destructive/15 text-destructive border-destructive/40",   dot: "bg-destructive" },
  cancelled: { label: "Cancelada",cls: "bg-zinc-500/10 text-zinc-400 border-zinc-500/30 line-through", dot: "bg-zinc-400" },
};

const TYPE_META: Record<InvoiceType, { label: string; icon: typeof ArrowDownToLine; cls: string }> = {
  incoming: { label: "Entrada", icon: ArrowDownToLine, cls: "text-emerald-400" },
  outgoing: { label: "Saída",   icon: ArrowUpFromLine, cls: "text-blue-400" },
};

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(n) || 0);

const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  try { return format(parseISO(d), "dd/MM/yyyy"); } catch { return d; }
};

// ───────────────────────────── invoice options panel
type BillingMode = "quick" | "complete" | "electronic";
type InvoiceLang = "pt" | "fr" | "en" | "es" | "de" | "it";
type DiscountType = "percent" | "fixed";

const BILLING_MODES: { value: BillingMode; label: string; hint: string }[] = [
  { value: "quick",       label: "Rápido",     hint: "Apenas o essencial" },
  { value: "complete",    label: "Completo",   hint: "Todos os campos" },
  { value: "electronic",  label: "Eletrônico", hint: "Preparado para emissão fiscal" },
];

const INVOICE_LANGS: { value: InvoiceLang; label: string }[] = [
  { value: "pt", label: "Português" },
  { value: "fr", label: "Francês" },
  { value: "en", label: "Inglês" },
  { value: "es", label: "Espanhol" },
  { value: "de", label: "Alemão" },
  { value: "it", label: "Italiano" },
];

type InvoiceOptions = {
  mode: BillingMode;
  lang: InvoiceLang;
  // Client display
  show_delivery_address: boolean;
  show_tva: boolean;
  show_siret_vat: boolean;
  show_client_reference: boolean;
  client_reference: string;
  // Document sections
  show_bank_details: boolean;
  show_payment_terms: boolean;
  show_doc_title: boolean;
  doc_title: string;
  show_notes: boolean;
  // Global discount
  show_discount: boolean;
  discount_type: DiscountType;
  discount_value: number;
  // Electronic mode (architecture-only)
  electronic_format: "none" | "ubl" | "facturx" | "peppol";
};

const defaultOptions = (): InvoiceOptions => ({
  mode: "complete",
  lang: "pt",
  show_delivery_address: false,
  show_tva: true,
  show_siret_vat: true,
  show_client_reference: false,
  client_reference: "",
  show_bank_details: true,
  show_payment_terms: true,
  show_doc_title: true,
  doc_title: "Fatura",
  show_notes: true,
  show_discount: false,
  discount_type: "percent",
  discount_value: 0,
  electronic_format: "none",
});

// ───────────────────────────── form
type FormState = {
  invoice_number: string;
  type: InvoiceType;
  client_id: string | null;
  issue_date: string;
  due_date: string;
  payment_term: PaymentTerm;
  items: InvoiceItem[];
  notes: string;
  // Bank details (editable, future: come from company profile)
  bank_iban: string;
  bank_bic: string;
  bank_name: string;
  // Legal footer
  legal_text: string;
  // Side panel options
  options: InvoiceOptions;
};

const DEFAULT_LEGAL =
  "Em caso de atraso no pagamento, poderá ser aplicada penalidade conforme legislação vigente.";

const emptyForm = (): FormState => ({
  invoice_number: "",
  type: "outgoing",
  client_id: null,
  issue_date: new Date().toISOString().slice(0, 10),
  due_date: "",
  payment_term: "net_30",
  items: [newItem()],
  notes: "",
  bank_iban: "",
  bank_bic: "",
  bank_name: "",
  legal_text: DEFAULT_LEGAL,
  options: defaultOptions(),
});

// Compute due_date from issue_date + payment term
function computeDueDate(issue: string, term: PaymentTerm, current: string): string {
  if (term === "custom") return current;
  if (!issue) return current;
  const d = new Date(issue + "T00:00:00");
  const preset = PAYMENT_TERMS.find((p) => p.value === term);
  if (term === "end_of_month") {
    const eom = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return eom.toISOString().slice(0, 10);
  }
  if (preset?.days != null) {
    d.setDate(d.getDate() + preset.days);
    return d.toISOString().slice(0, 10);
  }
  return current;
}

// ───────────────────────────── component
export default function InvoicesScreen() {
  const qc = useQueryClient();

  // filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 12;

  // selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // dialogs
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Invoice | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  // Vinculação a LISTAS consolidadas (financeiro trabalha por lista, nunca por OP)
  const [formListIds, setFormListIds] = useState<string[]>([]);
  const [formLists, setFormLists] = useState<BillingPaymentList[]>([]);

  const [detail, setDetail] = useState<Invoice | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Invoice | null>(null);
  const [confirmDraft, setConfirmDraft] = useState(false);
  const [sendingInvoice, setSendingInvoice] = useState<Invoice | null>(null);
  const [reminderInvoice, setReminderInvoice] = useState<Invoice | null>(null);

  // ── data
  const invoicesQ = useQuery({
    queryKey: ["ops-billing-invoices"],
    queryFn: async () => {
      const data = await apiRequest<{ invoices: Invoice[] }>("/billing/admin/ops/invoices");
      const today = new Date().toISOString().slice(0, 10);
      return (data.invoices ?? []).map((r: Invoice): Invoice => {
        if ((r.status === "pending" || r.status === "partial") && r.due_date && r.due_date < today) {
          return { ...r, status: "overdue" as InvoiceStatus };
        }
        return r;
      });
    },
  });

  const suppliersQ = useQuery({
    queryKey: ["ops-billing-suppliers-lite"],
    queryFn: async () => {
      const data = await apiRequest<{ suppliers: Supplier[] }>("/billing/admin/ops/suppliers");
      return data.suppliers ?? [];
    },
  });

  const clientsQ = useQuery({
    queryKey: ["ops-billing-clients-lite-for-invoices"],
    queryFn: async () => {
      const data = await apiRequest<{ clients: Client[] }>("/billing/admin/ops/clients");
      const list = data.clients ?? [];
      // Normalize legacy shape
      return list.map((c) => ({
        ...c,
        contact_email: c.email,
        contact_phone: c.phone,
      }));
    },
  });

  const supplierMap = useMemo(() => {
    const m = new Map<string, string>();
    (suppliersQ.data ?? []).forEach((s) => m.set(s.id, s.name));
    return m;
  }, [suppliersQ.data]);

  // ── filtering
  const filtered = useMemo(() => {
    const list = invoicesQ.data ?? [];
    const s = search.trim().toLowerCase();
    return list.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      if (dateFrom && r.issue_date < dateFrom) return false;
      if (dateTo && r.issue_date > dateTo) return false;
      if (s) {
        const hay = [
          r.invoice_number,
          r.customer_name ?? "",
          r.notes ?? "",
          supplierMap.get(r.supplier_id ?? "") ?? "",
        ].join(" ").toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [invoicesQ.data, search, statusFilter, typeFilter, dateFrom, dateTo, supplierMap]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = page > totalPages ? 1 : page;
  const pageData = filtered.slice((current - 1) * pageSize, current * pageSize);

  useEffect(() => { setSelected(new Set()); }, [statusFilter, typeFilter, dateFrom, dateTo, search]);

  // ── KPIs
  const kpi = useMemo(() => {
    const total = filtered.reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const paid = filtered.reduce((s, r) => s + Number(r.paid_amount || 0), 0);
    return {
      count: filtered.length,
      total,
      paid,
      remaining: total - paid,
      pending: filtered.filter((r) => r.status === "pending").length,
      overdue: filtered.filter((r) => r.status === "overdue").length,
    };
  }, [filtered]);

  // ── mutations
  const upsertMut = useMutation({
    mutationFn: async (payload: Partial<Invoice> & { id?: string }) => {
      const { id, ...rest } = payload;
      if (id) {
        await apiRequest(`/billing/admin/ops/invoices/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rest),
        });
        return id;
      }
      const data = await apiRequest<{ invoice: Invoice }>("/billing/admin/ops/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rest),
      });
      return data.invoice.id;
    },
    onSuccess: (_id, vars) => {
      qc.invalidateQueries({ queryKey: ["ops-billing-invoices"] });
      toast.success(vars.id ? "Fatura atualizada" : "Fatura criada");
      setFormOpen(false);
      setEditing(null);
      setForm(emptyForm());
      setFormListIds([]);
      setFormLists([]);
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao gravar fatura"),
  });

  const deleteMut = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => apiRequest(`/billing/admin/ops/invoices/${id}`, {
        method: "DELETE",
      })));
    },
    onSuccess: (_, ids) => {
      qc.invalidateQueries({ queryKey: ["ops-billing-invoices"] });
      toast.success(`${ids.length} fatura(s) eliminada(s)`);
      setSelected(new Set());
      setConfirmDelete(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao eliminar"),
  });

  // ── actions
  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setFormListIds([]);
    setFormLists([]);
    setFormOpen(true);
  };
  const openEdit = (inv: Invoice) => {
    setEditing(inv);
    const total = Number(inv.total_amount ?? 0);
    setForm({
      invoice_number: inv.invoice_number,
      type: inv.type,
      client_id: inv.billing_client_id ?? inv.customer_snapshot?.billing_client_id ?? null,
      issue_date: inv.issue_date,
      due_date: inv.due_date ?? "",
      payment_term: "custom",
      items: [{
        id: crypto.randomUUID(),
        designation: inv.notes?.split("\n")[0]?.slice(0, 80) || "Fatura",
        quantity: 1,
        unit: "un",
        unit_price: total,
        tax_rate: 0,
      }],
      notes: inv.notes ?? "",
      bank_iban: "",
      bank_bic: "",
      bank_name: "",
      legal_text: DEFAULT_LEGAL,
      options: defaultOptions(),
    });
    // Seed linked LISTS from metadata snapshot. Falls back to deriving list_names from legacy PO meta.
    const listsMeta = inv.metadata?.linked_lists_meta ?? [];
    const legacyPoMeta = inv.metadata?.linked_payment_orders_meta ?? [];
    const derivedNames = inv.metadata?.linked_list_names
      ?? Array.from(new Set(legacyPoMeta.map((m) => m.list_name).filter(Boolean) as string[]));
    setFormListIds(derivedNames);
    setFormLists(
      listsMeta.length > 0
        ? listsMeta.map((m) => ({
            id: m.list_name, list_name: m.list_name, technician_name: m.technician_name,
            assigned_user_id: m.assigned_user_id, client_name: m.client_name, city: null,
            year: m.year, week: m.week, total: m.total, po_count: m.po_count,
            payment_order_ids: [], user_ids: m.assigned_user_id ? [m.assigned_user_id] : [],
          }))
        : derivedNames.map((ln) => {
            const sample = legacyPoMeta.find((m) => m.list_name === ln);
            return {
              id: ln, list_name: ln,
              technician_name: sample?.technician_name ?? "—",
              assigned_user_id: sample?.assigned_user_id ?? null,
              client_name: null, city: null,
              year: sample?.year ?? new Date().getUTCFullYear(),
              week: sample?.week ?? 0,
              total: legacyPoMeta.filter((m) => m.list_name === ln).reduce((s, m) => s + (m.total || 0), 0),
              po_count: legacyPoMeta.filter((m) => m.list_name === ln).length,
              payment_order_ids: legacyPoMeta.filter((m) => m.list_name === ln).map((m) => m.id),
              user_ids: sample?.assigned_user_id ? [sample.assigned_user_id] : [],
            };
          })
    );
    setFormOpen(true);
  };

  // ── side options panel & view mode
  const [optionsPanelOpen, setOptionsPanelOpen] = useState(true);
  const [viewMode, setViewMode] = useState<"edit" | "preview">("edit");
  const [invoicePrintMode, setInvoicePrintMode] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    document.body.classList.toggle("invoice-print-mode", invoicePrintMode);
    root.classList.toggle("invoice-print-mode", invoicePrintMode);
    return () => {
      document.body.classList.remove("invoice-print-mode");
      root.classList.remove("invoice-print-mode");
    };
  }, [invoicePrintMode]);

  useEffect(() => {
    const enableBeforePrint = () => {
      if (formOpen && viewMode === "preview") {
        document.documentElement.classList.add("invoice-print-mode");
        document.body.classList.add("invoice-print-mode");
        setInvoicePrintMode(true);
      }
    };
    const disableAfterPrint = () => {
      document.documentElement.classList.remove("invoice-print-mode");
      document.body.classList.remove("invoice-print-mode");
      setInvoicePrintMode(false);
    };
    window.addEventListener("beforeprint", enableBeforePrint);
    window.addEventListener("afterprint", disableAfterPrint);
    return () => {
      window.removeEventListener("beforeprint", enableBeforePrint);
      window.removeEventListener("afterprint", disableAfterPrint);
    };
  }, [formOpen, viewMode]);

  const waitForInvoicePrintAssets = async () => {
    await document.fonts?.ready.catch(() => undefined);
    const images = Array.from(document.querySelectorAll<HTMLImageElement>(".invoice-print-area img"));
    await Promise.all(images.map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = () => resolve();
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
      });
    }));
  };

  const printCurrentInvoice = () => {
    setViewMode("preview");
    setInvoicePrintMode(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void waitForInvoicePrintAssets().finally(() => {
          window.print();
          window.setTimeout(() => setInvoicePrintMode(false), 800);
        });
      });
    });
  };

  const { settings: companySettings, saveMutation: saveSettingsMut } = useCompanySettings();

  // Seed invoice options from saved template when settings load and form is new
  useEffect(() => {
    if (companySettings?.invoice_template && !editing) {
      setForm((prev) => ({
        ...prev,
        options: { ...defaultOptions(), ...(companySettings.invoice_template as Partial<InvoiceOptions>) },
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companySettings?.invoice_template]);

  const handleSaveTemplate = () => {
    saveSettingsMut.mutate({ invoice_template: form.options });
  };

  // ── totals (applies global discount proportionally before tax)
  const totals = useMemo(() => {
    const subtotal = form.items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0);
    const opt = form.options;
    let discount = 0;
    if (opt.show_discount && subtotal > 0) {
      discount = opt.discount_type === "percent"
        ? subtotal * ((Number(opt.discount_value) || 0) / 100)
        : Math.min(Number(opt.discount_value) || 0, subtotal);
    }
    const netSubtotal = Math.max(0, subtotal - discount);
    const ratio = subtotal > 0 ? netSubtotal / subtotal : 1;
    const tax = form.items.reduce((s, it) => {
      const line = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0) * ratio;
      return s + line * ((Number(it.tax_rate) || 0) / 100);
    }, 0);
    return { subtotal, discount, netSubtotal, tax, total: netSubtotal + tax };
  }, [form.items, form.options]);

  // Build invoice metadata from the linked LISTS selection.
  // Underlying PO ids are expanded for trigger propagation (status sync).
  const buildLinkedMetadata = () => {
    const linked_list_names = Array.from(new Set(formListIds));
    const linked_lists_meta = formLists.map((l) => ({
      list_name: l.list_name, technician_name: l.technician_name,
      assigned_user_id: l.assigned_user_id, client_name: l.client_name,
      year: l.year, week: l.week, total: l.total, po_count: l.po_count,
    }));
    const linked_user_ids = Array.from(
      new Set(formLists.flatMap((l) => l.user_ids).filter(Boolean) as string[])
    );
    const linked_payment_order_ids = Array.from(
      new Set(formLists.flatMap((l) => l.payment_order_ids))
    );
    return {
      ...(editing?.metadata ?? {}),
      linked_list_names,
      linked_lists_meta,
      linked_user_ids,
      linked_payment_order_ids,
      linked_payment_orders: linked_payment_order_ids, // legacy alias
    };
  };

  const submitForm = () => {
    if (!form.invoice_number.trim()) {
      toast.error("Número da fatura é obrigatório");
      return;
    }
    if (!editing && !form.client_id) {
      toast.error("Selecione um cliente");
      return;
    }
    const client = (clientsQ.data ?? []).find((c) => c.id === form.client_id) || null;
    const snapshot = client ? buildSnapshot(client) : (editing?.customer_snapshot ?? null);
    upsertMut.mutate({
      id: editing?.id,
      invoice_number: form.invoice_number.trim(),
      type: form.type,
      supplier_id: editing?.supplier_id ?? null,
      billing_client_id: client?.id ?? editing?.billing_client_id ?? null,
      customer_name: client?.name ?? editing?.customer_name ?? null,
      customer_snapshot: snapshot as any,
      issue_date: form.issue_date,
      due_date: form.due_date || null,
      total_amount: totals.total,
      paid_amount: editing?.paid_amount ?? 0,
      status: editing?.status ?? "pending",
      notes: form.notes.trim() || null,
      metadata: buildLinkedMetadata() as any,
    } as any);
  };

  // Save current form as draft (no validation beyond minimum)
  const saveDraft = () => {
    const number = form.invoice_number.trim() || `RASCUNHO-${Date.now().toString().slice(-6)}`;
    const client = (clientsQ.data ?? []).find((c) => c.id === form.client_id) || null;
    const snapshot = client ? buildSnapshot(client) : (editing?.customer_snapshot ?? null);
    upsertMut.mutate({
      id: editing?.id,
      invoice_number: number,
      type: form.type,
      supplier_id: editing?.supplier_id ?? null,
      billing_client_id: client?.id ?? editing?.billing_client_id ?? null,
      customer_name: client?.name ?? editing?.customer_name ?? null,
      customer_snapshot: snapshot as any,
      issue_date: form.issue_date,
      due_date: form.due_date || null,
      total_amount: totals.total,
      paid_amount: editing?.paid_amount ?? 0,
      status: "draft",
      notes: form.notes.trim() || null,
      metadata: buildLinkedMetadata() as any,
    } as any);
  };

  // Detect if user has entered anything worth saving
  const isDirty = () => {
    if (editing) return false; // edits already persist via explicit Save
    if (form.invoice_number.trim()) return true;
    if (form.client_id) return true;
    if (form.notes.trim()) return true;
    if (form.items.some((it) => it.designation.trim() || it.unit_price > 0)) return true;
    return false;
  };

  const requestCloseForm = (open: boolean) => {
    if (open) { setFormOpen(true); return; }
    if (isDirty()) { setConfirmDraft(true); return; }
    setFormOpen(false);
  };

  // ── export
  const exportRows = () => (selected.size > 0
    ? filtered.filter((r) => selected.has(r.id))
    : filtered);

  const exportExcel = async () => {
    const rows = exportRows().map((r) => ({
      Número: r.invoice_number,
      Tipo: TYPE_META[r.type].label,
      Cliente_Fornecedor: r.customer_name ?? supplierMap.get(r.supplier_id ?? "") ?? "",
      "Valor total": Number(r.total_amount),
      "Valor pago": Number(r.paid_amount),
      "Saldo restante": Number(r.remaining_amount),
      Emissão: fmtDate(r.issue_date),
      Vencimento: fmtDate(r.due_date),
      Estado: STATUS_META[r.status].label,
    }));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Faturas");
    if (rows.length > 0) {
      ws.columns = Object.keys(rows[0]).map((key) => ({ header: key, key }));
      ws.addRows(rows);
    }
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `faturas_${format(new Date(), "yyyyMMdd_HHmm")}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Excel exportado");
  };

  const exportPDF = () => {
    const rows = exportRows();
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(14);
    doc.text("Faturas", 14, 14);
    doc.setFontSize(9);
    doc.text(`Gerado em ${format(new Date(), "dd/MM/yyyy HH:mm")} · ${rows.length} registros`, 14, 20);
    autoTable(doc, {
      startY: 26,
      head: [["Número", "Tipo", "Cliente/Fornecedor", "Total", "Pago", "Saldo", "Emissão", "Vencimento", "Estado"]],
      body: rows.map((r) => [
        r.invoice_number,
        TYPE_META[r.type].label,
        r.customer_name ?? supplierMap.get(r.supplier_id ?? "") ?? "",
        fmtMoney(Number(r.total_amount)),
        fmtMoney(Number(r.paid_amount)),
        fmtMoney(Number(r.remaining_amount)),
        fmtDate(r.issue_date),
        fmtDate(r.due_date),
        STATUS_META[r.status].label,
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 30, 35] },
    });
    doc.save(`faturas_${format(new Date(), "yyyyMMdd_HHmm")}.pdf`);
    toast.success("PDF exportado");
  };

  // ── selection helpers
  const allOnPageSelected = pageData.length > 0 && pageData.every((r) => selected.has(r.id));
  const toggleAllOnPage = () => {
    const next = new Set(selected);
    if (allOnPageSelected) pageData.forEach((r) => next.delete(r.id));
    else pageData.forEach((r) => next.add(r.id));
    setSelected(next);
  };

  // ───────────────────────────── render
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Breadcrumbs */}
      <Breadcrumb>
        <BreadcrumbList className="text-xs">
          <BreadcrumbItem><BreadcrumbLink href="/billing/faturas">Faturamento</BreadcrumbLink></BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>Faturas</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Faturas</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Gestão completa de faturas — entrada, saída, pagamentos e estado.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8" onClick={() => setImportOpen(true)}>
            <FileUp className="h-3.5 w-3.5 mr-1.5" />
            Adicionar fatura
          </Button>
          <Button size="sm" className="h-8" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Nova fatura
          </Button>
        </div>
      </div>

      {/* KPI band */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total" value={String(kpi.count)} />
        <KpiCard label="Montante" value={fmtMoney(kpi.total)} accent="text-primary" />
        <KpiCard label="Pago" value={fmtMoney(kpi.paid)} accent="text-emerald-400" />
        <KpiCard label="Saldo restante" value={fmtMoney(kpi.remaining)} accent="text-amber-400" />
      </div>

      {/* Filters */}
      <Card className="border-border/50">
        <CardContent className="pt-4 pb-3 grid grid-cols-1 md:grid-cols-12 gap-2">
          <div className="relative md:col-span-4">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Pesquisar nº, cliente, fornecedor, notas..."
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="h-8 text-xs md:col-span-2"><Filter className="h-3 w-3 mr-1.5" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os estados</SelectItem>
              {Object.entries(STATUS_META).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(1); }}>
            <SelectTrigger className="h-8 text-xs md:col-span-2"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              <SelectItem value="incoming">Entrada</SelectItem>
              <SelectItem value="outgoing">Saída</SelectItem>
            </SelectContent>
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} className="h-8 text-xs md:col-span-2" />
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} className="h-8 text-xs md:col-span-2" />
        </CardContent>
      </Card>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs animate-fade-in">
          <span className="text-primary font-medium">{selected.size} selecionada(s)</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7" onClick={exportExcel}>
              <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" /> Excel
            </Button>
            <Button size="sm" variant="outline" className="h-7" onClick={exportPDF}>
              <FileText className="h-3.5 w-3.5 mr-1.5" /> PDF
            </Button>
            <Button
              size="sm" variant="destructive" className="h-7"
              onClick={() => {
                const list = filtered.filter((r) => selected.has(r.id));
                setConfirmDelete({ ...list[0], invoice_number: `${list.length} fatura(s)` } as any);
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Eliminar
            </Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setSelected(new Set())}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <Card className="border-border/50 overflow-hidden">
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="text-[10px] uppercase tracking-wider">
                <TableHead className="w-[36px]">
                  <Checkbox
                    checked={allOnPageSelected}
                    onCheckedChange={toggleAllOnPage}
                    aria-label="Selecionar tudo"
                  />
                </TableHead>
                <TableHead className="w-[140px]">Número</TableHead>
                <TableHead>Cliente / Fornecedor</TableHead>
                <TableHead className="w-[200px]">Lista</TableHead>
                <TableHead className="w-[90px]">Tipo</TableHead>
                <TableHead className="text-right w-[110px]">Valor total</TableHead>
                <TableHead className="text-right w-[110px]">Pago</TableHead>
                <TableHead className="text-right w-[110px]">Saldo</TableHead>
                <TableHead className="w-[110px]">Emissão</TableHead>
                <TableHead className="w-[110px]">Vencimento</TableHead>
                <TableHead className="w-[110px]">Estado</TableHead>
                <TableHead className="w-[60px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoicesQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-12">
                    <Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : pageData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-12 text-xs text-muted-foreground">
                    Nenhuma fatura encontrada.
                  </TableCell>
                </TableRow>
              ) : pageData.map((r) => {
                const TypeIcon = TYPE_META[r.type].icon;
                const partyName = r.customer_name ?? supplierMap.get(r.supplier_id ?? "") ?? "—";
                const isSel = selected.has(r.id);
                return (
                  <TableRow
                    key={r.id}
                    className={cn("text-xs cursor-pointer hover:bg-accent/30 transition-colors", isSel && "bg-primary/5")}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("[data-stop]")) return;
                      setDetail(r);
                    }}
                  >
                    <TableCell data-stop>
                      <Checkbox
                        checked={isSel}
                        onCheckedChange={(c) => {
                          const next = new Set(selected);
                          if (c) next.add(r.id);
                          else next.delete(r.id);
                          setSelected(next);
                        }}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-primary">
                      <div className="flex items-center gap-1.5">
                        <span>{r.invoice_number}</span>
                        {(r as any).source === "imported" && (
                          <Badge variant="outline" className="h-4 px-1 text-[8px] gap-0.5 border-amber-500/40 text-amber-500">
                            <FileUp className="h-2.5 w-2.5" /> IMP
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{partyName}</TableCell>
                    <TableCell>
                      {(() => {
                        // Financial layer: show ONLY consolidated list codes.
                        // Operational data (technician, week, OS refs) intentionally hidden.
                        const listsMeta = r.metadata?.linked_lists_meta ?? [];
                        const listNames = r.metadata?.linked_list_names ?? [];
                        const legacyPoMeta = r.metadata?.linked_payment_orders_meta ?? [];

                        const names = new Set<string>();
                        listsMeta.forEach((m) => m.list_name && names.add(m.list_name));
                        listNames.forEach((n) => n && names.add(n));
                        if (names.size === 0) {
                          legacyPoMeta.forEach((m) => m.list_name && names.add(m.list_name));
                        }
                        const codes = Array.from(names);

                        if (codes.length === 0) {
                          return <span className="text-[10px] text-muted-foreground italic">—</span>;
                        }
                        if (codes.length === 1) {
                          return (
                            <Badge variant="outline" className="text-[10px] font-mono font-semibold text-primary">
                              {codes[0]}
                            </Badge>
                          );
                        }
                        return (
                          <div className="flex flex-wrap gap-1 items-center">
                            <Badge variant="outline" className="text-[10px] font-mono font-semibold text-primary">
                              {codes[0]}
                            </Badge>
                            <span className="text-[10px] text-muted-foreground">+{codes.length - 1}</span>
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <span className={cn("inline-flex items-center gap-1.5", TYPE_META[r.type].cls)}>
                        <TypeIcon className="h-3 w-3" />
                        {TYPE_META[r.type].label}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{fmtMoney(Number(r.total_amount))}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-400">{fmtMoney(Number(r.paid_amount))}</TableCell>
                    <TableCell className="text-right tabular-nums text-amber-400">{fmtMoney(Number(r.remaining_amount))}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(r.issue_date)}</TableCell>
                    <TableCell className="text-muted-foreground">{fmtDate(r.due_date)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn("text-[10px] gap-1.5", STATUS_META[r.status].cls)}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_META[r.status].dot)} />
                        {STATUS_META[r.status].label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right" data-stop>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="text-xs">
                          <DropdownMenuItem onClick={() => setDetail(r)}>
                            <Eye className="h-3.5 w-3.5 mr-2" /> Ver detalhes
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openEdit(r)}>
                            <Pencil className="h-3.5 w-3.5 mr-2" /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setSendingInvoice(r)}>
                            <Send className="h-3.5 w-3.5 mr-2" /> Enviar por email
                          </DropdownMenuItem>
                          {r.status === "overdue" && (
                            <DropdownMenuItem
                              onClick={() => setReminderInvoice(r)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Send className="h-3.5 w-3.5 mr-2" /> Enviar cobrança
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => setConfirmDelete(r)}>
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Eliminar
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

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-border/50 px-4 py-2.5 text-xs text-muted-foreground">
          <span>Página {current} de {totalPages} · {filtered.length} registros</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 px-2" disabled={current <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm" className="h-7 px-2" disabled={current >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </Card>

      {/* ─── Form dialog */}
      <Dialog open={formOpen} onOpenChange={requestCloseForm}>
        <DialogContent className="invoice-print-dialog-content max-w-6xl w-[96vw] max-h-[94vh] p-0 gap-0 flex flex-col overflow-hidden">
          <DialogHeader className="no-print px-6 pt-5 pb-4 border-b border-border/50 bg-background z-10 flex-row items-center justify-between space-y-0">
            <div>
              <DialogTitle className="text-base font-semibold">
                {editing
                  ? "Editar fatura"
                  : (form.options.show_doc_title ? form.options.doc_title : "Nova fatura")}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                Modo: <span className="font-medium text-foreground">{BILLING_MODES.find(m => m.value === form.options.mode)?.label}</span>
                {" · "}Idioma: <span className="font-medium text-foreground uppercase">{form.options.lang}</span>
              </p>
            </div>
            <div className="flex items-center gap-2 mr-8">
              <div className="inline-flex rounded-md border border-border/60 bg-muted/30 p-0.5">
                <button
                  type="button"
                  onClick={() => setViewMode("edit")}
                  className={cn(
                    "h-7 px-3 rounded text-xs font-medium inline-flex items-center gap-1.5 transition-colors",
                    viewMode === "edit" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <FileEdit className="h-3.5 w-3.5" /> Editar
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("preview")}
                  className={cn(
                    "h-7 px-3 rounded text-xs font-medium inline-flex items-center gap-1.5 transition-colors",
                    viewMode === "preview" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Eye className="h-3.5 w-3.5" /> Pré-visualizar
                </button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 no-print"
                onClick={printCurrentInvoice}
                title="Visualizar e imprimir em A4"
              >
                <Printer className="h-3.5 w-3.5 mr-1.5" /> Visualizar impressão
              </Button>
              
              {viewMode === "edit" && (
                <Button
                  variant="outline" size="sm" className="h-8 no-print"
                  onClick={() => setOptionsPanelOpen(o => !o)}
                >
                  <Filter className="h-3.5 w-3.5 mr-1.5" />
                  {optionsPanelOpen ? "Ocultar opções" : "Opções da fatura"}
                </Button>
              )}
            </div>
          </DialogHeader>

          <div className="invoice-print-dialog-body flex-1 flex min-h-0 overflow-hidden">
            <div className="invoice-print-scroll-container flex-1 overflow-y-auto">

          {viewMode === "preview" ? (
            <div className={cn("bg-muted/30 print:bg-white invoice-print-area", invoicePrintMode && "invoice-print-mode")}>
              <InvoiceA4PreviewFrame>
                <InvoiceDocumentA4
                  form={{
                    ...form,
                    payment_term_label: getPaymentTermLabel(form.payment_term, form.options.lang),
                  }}
                  totals={totals}
                  client={(clientsQ.data ?? []).find((c) => c.id === form.client_id) || null}
                  company={companySettings}
                  brandName={BRAND.name}
                  brandLogo={BRAND.logo}
                  lang={form.options.lang}
                  docType={form.type}
                  mode={form.options.mode}
                  electronicFormat={form.options.electronic_format}
                />
              </InvoiceA4PreviewFrame>
            </div>
          ) : (
          <div className="px-6 py-5 space-y-6 text-xs">
            {/* SECTION 1 — Identification */}
            <FormSection title="Identificação" subtitle="Dados gerais da fatura">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Número *">
                  <Input
                    value={form.invoice_number}
                    onChange={(e) => setForm({ ...form, invoice_number: e.target.value })}
                    placeholder="Ex: FAT-2026-0001"
                    className="h-9"
                  />
                </Field>
                <Field label="Tipo">
                  <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as InvoiceType })}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="incoming">Entrada</SelectItem>
                      <SelectItem value="outgoing">Saída</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Data emissão">
                  <Input
                    type="date"
                    value={form.issue_date}
                    onChange={(e) => {
                      const issue = e.target.value;
                      setForm({
                        ...form,
                        issue_date: issue,
                        due_date: computeDueDate(issue, form.payment_term, form.due_date),
                      });
                    }}
                    className="h-9"
                  />
                </Field>
              </div>
            </FormSection>

            {/* SECTION 1.5 — Vinculação a LISTAS consolidadas (entidade financeira) */}
            <FormSection
              title="Listas vinculadas"
              subtitle="O faturamento trabalha por LISTAS consolidadas (ex.: L012483), nunca por OP individual. Origem: payment-orders."
            >
              <PaymentListsSelector
                value={formListIds}
                onChange={(ids, lists) => { setFormListIds(ids); setFormLists(lists); }}
              />
              {formListIds.length > 0 && (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  {formListIds.length} lista{formListIds.length !== 1 ? "s" : ""} vinculada{formListIds.length !== 1 ? "s" : ""}.
                  O estado da fatura propaga automaticamente para as OPs internas.
                </p>
              )}
            </FormSection>

            {/* SECTION 2 — Client (source of truth) */}
            <FormSection
              title="Cliente"
              subtitle="Os dados fiscais são carregados automaticamente do cadastro do cliente"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Cliente *">
                  <Select
                    value={form.client_id ?? ""}
                    onValueChange={(v) => setForm({ ...form, client_id: v || null })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Selecionar cliente..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(clientsQ.data ?? []).length === 0 ? (
                        <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum cliente cadastrado</div>
                      ) : (
                        (clientsQ.data ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </Field>
                <ClientPreview client={(clientsQ.data ?? []).find((c) => c.id === form.client_id) || null} />
              </div>

              {/* Read-only fiscal block (source of truth) */}
              <ClientFiscalReadonly
                client={(clientsQ.data ?? []).find((c) => c.id === form.client_id) || null}
              />
            </FormSection>

            {/* SECTION 3 — Payment terms */}
            {form.options.show_payment_terms && (
            <FormSection title="Condições de pagamento" subtitle="Defina prazos e vencimento">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="Condição de pagamento">
                  <Select
                    value={form.payment_term}
                    onValueChange={(v) => {
                      const term = v as PaymentTerm;
                      setForm({
                        ...form,
                        payment_term: term,
                        due_date: computeDueDate(form.issue_date, term, form.due_date),
                      });
                    }}
                  >
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {PAYMENT_TERMS.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Data de vencimento">
                  <Input
                    type="date"
                    value={form.due_date}
                    onChange={(e) => setForm({ ...form, due_date: e.target.value, payment_term: "custom" })}
                    className="h-9"
                  />
                </Field>
              </div>
            </FormSection>
            )}

            {/* SECTION 4 — Items */}
            <FormSection title="Itens da fatura" subtitle="Designações, quantidades e impostos">
              <div className="rounded-md border border-border/60 overflow-hidden">
                <div className="grid grid-cols-[1fr_70px_70px_110px_110px_120px_36px] gap-2 px-3 py-2 bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <div>Designação</div>
                  <div className="text-right">Qtd</div>
                  <div>Unid</div>
                  <div className="text-right">Preço unit.</div>
                  <div>Imposto</div>
                  <div className="text-right">Total s/ imp.</div>
                  <div></div>
                </div>
                <div className="divide-y divide-border/50">
                  {form.items.map((it, idx) => {
                    const lineNet = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
                    return (
                      <div key={it.id} className="grid grid-cols-[1fr_70px_70px_110px_110px_120px_36px] gap-2 px-3 py-2 items-center">
                        <Input
                          value={it.designation}
                          onChange={(e) => {
                            const items = [...form.items];
                            items[idx] = { ...it, designation: e.target.value };
                            setForm({ ...form, items });
                          }}
                          placeholder="Descrição do item / serviço"
                          className="h-8 text-xs"
                        />
                        <Input
                          type="number" step="0.01" value={it.quantity}
                          onChange={(e) => {
                            const items = [...form.items];
                            items[idx] = { ...it, quantity: Number(e.target.value) || 0 };
                            setForm({ ...form, items });
                          }}
                          className="h-8 text-xs text-right tabular-nums"
                        />
                        <Input
                          value={it.unit}
                          onChange={(e) => {
                            const items = [...form.items];
                            items[idx] = { ...it, unit: e.target.value };
                            setForm({ ...form, items });
                          }}
                          className="h-8 text-xs"
                        />
                        <Input
                          type="number" step="0.01" value={it.unit_price}
                          onChange={(e) => {
                            const items = [...form.items];
                            items[idx] = { ...it, unit_price: Number(e.target.value) || 0 };
                            setForm({ ...form, items });
                          }}
                          className="h-8 text-xs text-right tabular-nums"
                        />
                        <Select
                          value={String(it.tax_rate)}
                          onValueChange={(v) => {
                            const items = [...form.items];
                            items[idx] = { ...it, tax_rate: Number(v) };
                            setForm({ ...form, items });
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {TAX_RATES.map((r) => (
                              <SelectItem key={r} value={String(r)}>{r}%</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="text-right tabular-nums text-xs font-medium">
                          {fmtMoney(lineNet)}
                        </div>
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7"
                          disabled={form.items.length <= 1}
                          onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
                <div className="px-3 py-2 border-t border-border/50 bg-muted/10">
                  <Button
                    variant="ghost" size="sm" className="h-7 text-xs"
                    onClick={() => setForm({ ...form, items: [...form.items, newItem()] })}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Adicionar linha
                  </Button>
                </div>
              </div>

              {/* Totals */}
              <div className="mt-4 flex justify-end">
                <div className="w-full md:w-80 rounded-md border border-border/60 divide-y divide-border/50 text-xs">
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="tabular-nums">{fmtMoney(totals.subtotal)}</span>
                  </div>
                  {form.options.show_discount && totals.discount > 0 && (
                    <div className="flex justify-between px-3 py-2 text-rose-400">
                      <span>
                        Desconto{" "}
                        {form.options.discount_type === "percent"
                          ? `(${form.options.discount_value || 0}%)`
                          : ""}
                      </span>
                      <span className="tabular-nums">- {fmtMoney(totals.discount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-muted-foreground">Total sem imposto</span>
                    <span className="tabular-nums">{fmtMoney(totals.netSubtotal)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2">
                    <span className="text-muted-foreground">Total imposto</span>
                    <span className="tabular-nums">{fmtMoney(totals.tax)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2 bg-primary/5">
                    <span className="font-semibold">Total final</span>
                    <span className="tabular-nums font-semibold text-primary">{fmtMoney(totals.total)}</span>
                  </div>
                </div>
              </div>
            </FormSection>

            {/* SECTION 5 — Bank details */}
            {form.options.show_bank_details && (
            <FormSection title="Dados bancários" subtitle="Vindos do perfil da empresa (somente leitura)">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Field label="IBAN">
                  <Input value={(companySettings as any)?.iban ?? form.bank_iban} readOnly disabled className="h-9 bg-muted/30" placeholder="Configurar no perfil da empresa" />
                </Field>
                <Field label="BIC / SWIFT">
                  <Input value={(companySettings as any)?.swift_bic ?? form.bank_bic} readOnly disabled className="h-9 bg-muted/30" placeholder="Configurar no perfil da empresa" />
                </Field>
                <Field label="Banco">
                  <Input value={(companySettings as any)?.bank_name ?? form.bank_name} readOnly disabled className="h-9 bg-muted/30" placeholder="Configurar no perfil da empresa" />
                </Field>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">
                Para alterar, edite o perfil da empresa em Configurações.
              </p>
            </FormSection>
            )}

            {/* SECTION 6 — Notes & Legal */}
            {form.options.show_notes && (
            <FormSection title="Observações e nota legal" subtitle="Informações adicionais ao cliente">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Observações">
                  <Textarea
                    rows={4}
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    className="text-xs"
                    placeholder="Notas internas ou para o cliente..."
                  />
                </Field>
                <Field label="Texto legal (rodapé)">
                  <Textarea
                    rows={4}
                    value={form.legal_text}
                    onChange={(e) => setForm({ ...form, legal_text: e.target.value })}
                    className="text-xs"
                  />
                </Field>
              </div>
            </FormSection>
            )}
              </div>
          )}
            </div>

            {/* ─── Right side options panel */}
            {viewMode === "edit" && optionsPanelOpen && (
              <aside className="hidden md:flex w-72 lg:w-80 shrink-0 flex-col border-l border-border/50 bg-muted/10 overflow-y-auto">
                <InvoiceOptionsPanel
                  options={form.options}
                  onChange={(next) => setForm({ ...form, options: next })}
                  onSaveTemplate={handleSaveTemplate}
                />
              </aside>
            )}
          </div>

          <DialogFooter className="no-print px-6 py-4 border-t border-border/50 bg-background">
            <div className="flex-1 text-xs text-muted-foreground">
              {!editing && "Estado inicial: "}
              {!editing && <Badge variant="outline" className={cn("text-[10px] gap-1.5", STATUS_META["pending"].cls)}>
                <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_META["pending"].dot)} /> Pendente
              </Badge>}
            </div>
            <Button variant="outline" onClick={() => requestCloseForm(false)}>Cancelar</Button>
            <Button onClick={submitForm} disabled={upsertMut.isPending}>
              {upsertMut.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {editing ? "Atualizar fatura" : "Emitir fatura"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* ─── Delete confirm */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar fatura?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é definitiva. {confirmDelete?.invoice_number ? `(${confirmDelete.invoice_number})` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const ids = selected.size > 0
                  ? Array.from(selected)
                  : confirmDelete ? [confirmDelete.id] : [];
                if (ids.length) deleteMut.mutate(ids);
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Side detail panel */}
      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {detail && (
            <DetailContent
              invoice={detail}
              supplierName={supplierMap.get(detail.supplier_id ?? "") ?? null}
              onEdit={() => { openEdit(detail); setDetail(null); }}
              onDelete={() => { setConfirmDelete(detail); setDetail(null); }}
              onSend={() => { setSendingInvoice(detail); }}
            />
          )}
        </SheetContent>
      </Sheet>

      <ImportInvoiceDialog open={importOpen} onOpenChange={setImportOpen} />

      <SendInvoiceDialog
        open={!!sendingInvoice}
        onOpenChange={(o) => !o && setSendingInvoice(null)}
        invoice={sendingInvoice}
        companyName={(companySettings as any)?.legal_name ?? (companySettings as any)?.name ?? BRAND.name}
      />

      <SendInvoiceDialog
        open={!!reminderInvoice}
        onOpenChange={(o) => !o && setReminderInvoice(null)}
        invoice={reminderInvoice}
        companyName={(companySettings as any)?.legal_name ?? (companySettings as any)?.name ?? BRAND.name}
        mode="reminder"
      />

      {/* ─── Save draft confirmation */}
      <AlertDialog open={confirmDraft} onOpenChange={setConfirmDraft}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Salvar rascunho?</AlertDialogTitle>
            <AlertDialogDescription>
              Há dados não gravados. Deseja salvar como rascunho para continuar mais tarde?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmDraft(false);
                setFormOpen(false);
                setForm(emptyForm());
                setEditing(null);
              }}
            >
              Descartar
            </Button>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDraft(false);
                saveDraft();
              }}
            >
              Salvar rascunho
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ───────────────────────────── small bits
function KpiCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <Card className="border-border/50">
      <CardContent className="pt-4 pb-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={cn("text-lg font-semibold tabular-nums", accent)}>{value}</p>
      </CardContent>
    </Card>
  );
}

function InvoiceOptionsPanel({
  options, onChange, onSaveTemplate,
}: { options: InvoiceOptions; onChange: (o: InvoiceOptions) => void; onSaveTemplate?: () => void }) {
  const set = <K extends keyof InvoiceOptions>(k: K, v: InvoiceOptions[K]) =>
    onChange({ ...options, [k]: v });

  // When mode changes, pre-toggle relevant sections (user can override after).
  const setMode = (mode: BillingMode) => {
    if (mode === "quick") {
      onChange({
        ...options, mode,
        show_bank_details: false,
        show_payment_terms: false,
        show_notes: false,
        show_doc_title: true,
        show_discount: false,
        electronic_format: "none",
      });
    } else if (mode === "complete") {
      onChange({
        ...options, mode,
        show_bank_details: true,
        show_payment_terms: true,
        show_notes: true,
        show_doc_title: true,
        electronic_format: "none",
      });
    } else {
      onChange({
        ...options, mode,
        show_bank_details: true,
        show_payment_terms: true,
        show_notes: true,
        show_doc_title: true,
        electronic_format: options.electronic_format === "none" ? "facturx" : options.electronic_format,
      });
    }
  };

  return (
    <div className="p-4 space-y-5 text-xs">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wider">Opções da fatura</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Personalize layout, secções e idioma.
        </p>
      </div>

      {/* Billing mode */}
      <PanelBlock title="Tipo de faturamento">
        <div className="grid grid-cols-1 gap-1.5">
          {BILLING_MODES.map((m) => {
            const active = options.mode === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                className={cn(
                  "text-left rounded-md border px-2.5 py-1.5 transition-colors",
                  active
                    ? "border-primary/60 bg-primary/10 text-foreground"
                    : "border-border/60 hover:bg-accent/40 text-muted-foreground"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{m.label}</span>
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{m.hint}</p>
              </button>
            );
          })}
        </div>
      </PanelBlock>

      {/* Language */}
      <PanelBlock title="Idioma da fatura">
        <Select value={options.lang} onValueChange={(v) => set("lang", v as InvoiceLang)}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {INVOICE_LANGS.map((l) => (
              <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PanelBlock>

      {/* Client display options */}
      <PanelBlock title="Configurações do cliente">
        <CheckRow label="Endereço de entrega"
          checked={options.show_delivery_address}
          onChange={(v) => set("show_delivery_address", v)} />
        <CheckRow label="Número TVA / IVA"
          checked={options.show_tva}
          onChange={(v) => set("show_tva", v)} />
        <CheckRow label="SIRET / VAT"
          checked={options.show_siret_vat}
          onChange={(v) => set("show_siret_vat", v)} />
        <CheckRow label="Referência do cliente"
          checked={options.show_client_reference}
          onChange={(v) => set("show_client_reference", v)} />
        {options.show_client_reference && (
          <Input
            value={options.client_reference}
            onChange={(e) => set("client_reference", e.target.value)}
            placeholder="Referência..."
            className="h-7 text-xs mt-1"
          />
        )}
      </PanelBlock>

      {/* Document sections */}
      <PanelBlock title="Informações adicionais">
        <CheckRow label="Dados bancários"
          checked={options.show_bank_details}
          onChange={(v) => set("show_bank_details", v)} />
        <CheckRow label="Condição de pagamento"
          checked={options.show_payment_terms}
          onChange={(v) => set("show_payment_terms", v)} />
        <CheckRow label="Título do documento"
          checked={options.show_doc_title}
          onChange={(v) => set("show_doc_title", v)} />
        {options.show_doc_title && (
          <Input
            value={options.doc_title}
            onChange={(e) => set("doc_title", e.target.value)}
            className="h-7 text-xs mt-1"
          />
        )}
        <CheckRow label="Campo de observações"
          checked={options.show_notes}
          onChange={(v) => set("show_notes", v)} />
        <CheckRow label="Desconto global"
          checked={options.show_discount}
          onChange={(v) => set("show_discount", v)} />
      </PanelBlock>

      {/* Discount */}
      {options.show_discount && (
        <PanelBlock title="Desconto global">
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => set("discount_type", "percent")}
              className={cn("rounded-md border px-2 py-1 text-[11px]",
                options.discount_type === "percent" ? "border-primary/60 bg-primary/10" : "border-border/60")}
            >Percentual %</button>
            <button
              type="button"
              onClick={() => set("discount_type", "fixed")}
              className={cn("rounded-md border px-2 py-1 text-[11px]",
                options.discount_type === "fixed" ? "border-primary/60 bg-primary/10" : "border-border/60")}
            >Valor fixo €</button>
          </div>
          <Input
            type="number" step="0.01" min={0}
            value={options.discount_value}
            onChange={(e) => set("discount_value", Number(e.target.value) || 0)}
            className="h-7 text-xs mt-2 tabular-nums"
            placeholder={options.discount_type === "percent" ? "0%" : "0,00 €"}
          />
        </PanelBlock>
      )}

      {/* Electronic mode */}
      {options.mode === "electronic" && (
        <PanelBlock title="Modo eletrônico" hint="Estrutura preparada — emissão fiscal não ativa.">
          <Select
            value={options.electronic_format}
            onValueChange={(v) => set("electronic_format", v as InvoiceOptions["electronic_format"])}
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="facturx">Factur-X (FR/DE)</SelectItem>
              <SelectItem value="ubl">UBL 2.1</SelectItem>
              <SelectItem value="peppol">PEPPOL BIS</SelectItem>
              <SelectItem value="none">Nenhum</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
            Será usado quando o motor fiscal eletrônico for ativado.
          </p>
        </PanelBlock>
      )}

      {/* Save as default template */}
      <div className="pt-2 border-t border-border/40">
        <Button
          size="sm"
          variant="outline"
          className="w-full h-8 text-[11px]"
          onClick={onSaveTemplate}
          type="button"
        >
          <Save className="h-3 w-3 mr-1" /> Salvar como padrão
        </Button>
      </div>
    </div>
  );
}

function PanelBlock({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div>
        <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">{title}</p>
        {hint && <p className="text-[10px] text-muted-foreground/80 mt-0.5">{hint}</p>}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 py-0.5 cursor-pointer hover:text-foreground text-muted-foreground transition-colors">
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(!!c)} className="h-3.5 w-3.5" />
      <span className="text-xs">{label}</span>
    </label>
  );
}

function FormSection({
  title, subtitle, children,
}: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between border-b border-border/40 pb-1.5">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">{title}</h3>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

function ClientPreview({ client }: { client: Client | null }) {
  if (!client) {
    return (
      <div className="rounded-md border border-dashed border-border/60 px-3 py-2.5 text-[11px] text-muted-foreground flex items-center">
        Selecione um cliente para carregar dados fiscais, endereço e contactos.
      </div>
    );
  }
  const fiscal = client.tva_intracom || client.siret || client.siren || client.tax_id || "—";
  const fullAddr = [
    client.address,
    client.address_complement,
    [client.postal_code, client.city].filter(Boolean).join(" "),
    client.country,
  ].filter(Boolean).join(" · ");
  return (
    <div className="rounded-md border border-border/60 bg-muted/10 px-3 py-2.5 text-[11px] space-y-1">
      <p className="font-medium text-foreground text-xs">{client.name}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
        {client.email && <span>{client.email}</span>}
        {client.phone && <span>{client.phone}</span>}
      </div>
      <div className="pt-1 border-t border-border/40 mt-1 space-y-0.5">
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground/80">Identificação fiscal</span>
          <span className="text-foreground/90 font-mono truncate">{fiscal}</span>
        </div>
        {fullAddr && (
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground/80">Endereço</span>
            <span className="text-foreground/90 truncate text-right">{fullAddr}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ClientFiscalReadonly({ client }: { client: Client | null }) {
  if (!client) return null;
  const F = ({ label, value }: { label: string; value?: string | null }) => (
    <Field label={label}>
      <Input value={value ?? ""} readOnly disabled className="h-9 bg-muted/30" placeholder="—" />
    </Field>
  );
  return (
    <div className="mt-3 rounded-md border border-border/60 bg-muted/5 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
          Bloco fiscal (somente leitura)
        </p>
        <span className="text-[10px] text-muted-foreground">Fonte: cadastro do cliente</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <F label="Razão social" value={client.name} />
        <F label="SIREN" value={client.siren} />
        <F label="SIRET" value={client.siret} />
        <F label="TVA / VAT" value={client.tva_intracom} />
        <F label="Identificação fiscal" value={client.tax_id} />
        <F label="País" value={client.country} />
        <F label="Endereço" value={client.address} />
        <F label="Complemento" value={client.address_complement} />
        <F label="Código postal · Cidade" value={[client.postal_code, client.city].filter(Boolean).join(" · ")} />
        <F label="Email" value={client.email} />
        <F label="Telefone" value={client.phone} />
        <F label="IBAN" value={client.iban} />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Para alterar estes dados, edite a ficha do cliente em Faturamento › Clientes.
      </p>
    </div>
  );
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={cn("space-y-1", full && "sm:col-span-2")}>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

// ───────────────────────────── side panel content
function DetailContent({
  invoice, supplierName, onEdit, onDelete, onSend,
}: {
  invoice: Invoice;
  supplierName: string | null;
  onEdit: () => void;
  onDelete: () => void;
  onSend: () => void;
}) {
  const auditQ = useQuery({
    queryKey: ["ops-invoice-audit", invoice.id],
    queryFn: async () => {
      const data = await apiRequest<{ logs: Array<{ id: string; action: string; created_at: string; payload: any; actor_user_id: string | null }> }>(
        `/billing/admin/ops/invoices/${invoice.id}/audit`,
      );
      return data.logs ?? [];
    },
  });

  return (
    <>
      <SheetHeader className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={cn("text-[10px] gap-1.5", STATUS_META[invoice.status].cls)}>
            <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_META[invoice.status].dot)} />
            {STATUS_META[invoice.status].label}
          </Badge>
          <Badge variant="outline" className="text-[10px]">{TYPE_META[invoice.type].label}</Badge>
        </div>
        <SheetTitle className="font-mono text-base">{invoice.invoice_number}</SheetTitle>
        <p className="text-xs text-muted-foreground">
          {invoice.customer_name ?? supplierName ?? "—"}
        </p>
      </SheetHeader>

      <div className="mt-5 grid grid-cols-3 gap-2 text-xs">
        <MiniKpi label="Total" value={fmtMoney(Number(invoice.total_amount))} />
        <MiniKpi label="Pago"  value={fmtMoney(Number(invoice.paid_amount))} accent="text-emerald-400" />
        <MiniKpi label="Saldo" value={fmtMoney(Number(invoice.remaining_amount))} accent="text-amber-400" />
      </div>

      <Tabs defaultValue="info" className="mt-5">
        <TabsList className="grid grid-cols-2 w-full h-8">
          <TabsTrigger value="info" className="text-xs">Detalhes</TabsTrigger>
          <TabsTrigger value="history" className="text-xs">
            <History className="h-3 w-3 mr-1" /> Histórico
          </TabsTrigger>
        </TabsList>

        <TabsContent value="info" className="space-y-3 mt-3 text-xs">
          <Row k="Tipo"           v={TYPE_META[invoice.type].label} />
          <Row k="Fornecedor"     v={supplierName ?? "—"} />
          <Row k="Cliente"        v={invoice.customer_name ?? "—"} />
          <Row k="Data emissão"   v={fmtDate(invoice.issue_date)} />
          <Row k="Vencimento"     v={fmtDate(invoice.due_date)} />
          <Row k="Criada em"      v={fmtDate(invoice.created_at)} />
          <Row k="Atualizada em"  v={fmtDate(invoice.updated_at)} />
          {invoice.notes && (
            <div className="pt-2 border-t border-border/50">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Observações</p>
              <p className="text-xs whitespace-pre-wrap">{invoice.notes}</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-3">
          {auditQ.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (auditQ.data ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">Sem histórico registado.</p>
          ) : (
            <ul className="space-y-2">
              {(auditQ.data ?? []).map((e: any) => (
                <li key={e.id} className="rounded-md border border-border/50 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{e.action}</span>
                    <span className="text-muted-foreground">{format(parseISO(e.created_at), "dd/MM HH:mm")}</span>
                  </div>
                  {e.actor_user_id && (
                    <p className="text-[10px] text-muted-foreground font-mono mt-0.5 truncate">
                      {e.actor_user_id}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <div className="mt-6 flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 flex-1" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5 mr-1.5" /> Editar
        </Button>
        <Button variant="default" size="sm" className="h-8" onClick={onSend}>
          <Send className="h-3.5 w-3.5 mr-1.5" /> Enviar
        </Button>
        <Button variant="destructive" size="sm" className="h-8" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Eliminar
        </Button>
      </div>
    </>
  );
}

function MiniKpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-card/40 px-2 py-2">
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("text-xs font-semibold tabular-nums", accent)}>{value}</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 border-b border-border/30 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium text-right">{v}</span>
    </div>
  );
}

// ───────────────────────────── Invoice Preview (professional document)
function InvoicePreview({
  form, totals, client, company,
}: {
  form: FormState;
  totals: { subtotal: number; discount: number; netSubtotal: number; tax: number; total: number };
  client: Client | null;
  company: any;
}) {
  const opt = form.options;
  const companyName = company?.company_name || BRAND.name;
  const companyAddr = company?.address || "";
  const companySiret = company?.siret || "";
  const companyTva = company?.tva_number || "";
  const docTitle = opt.show_doc_title ? (opt.doc_title || "Fatura") : "Fatura";
  const paymentLabel = PAYMENT_TERMS.find((p) => p.value === form.payment_term)?.label ?? "—";

  // Group items by tax rate for VAT summary
  const taxBuckets = new Map<number, number>();
  const ratio = totals.subtotal > 0 ? totals.netSubtotal / totals.subtotal : 1;
  form.items.forEach((it) => {
    const net = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0) * ratio;
    const t = Number(it.tax_rate) || 0;
    taxBuckets.set(t, (taxBuckets.get(t) || 0) + net * (t / 100));
  });

  return (
    <div
      className="mx-auto bg-white text-zinc-900 shadow-2xl print:shadow-none"
      style={{ width: "210mm", minHeight: "297mm", padding: "18mm 16mm" }}
    >
      {/* HEADER */}
      <header className="flex items-start justify-between gap-8 pb-6 border-b-2 border-zinc-900">
        {/* Company - left */}
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <BrandLogo size={56} nameOverride={companyName} disableGlow />
          <div className="min-w-0">
            <p className="text-lg font-bold tracking-tight text-zinc-900">{companyName}</p>
            {companyAddr && (
              <p className="text-[11px] text-zinc-600 leading-snug whitespace-pre-line mt-1">{companyAddr}</p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[10px] text-zinc-500 mt-1.5">
              {companySiret && <span>SIRET {companySiret}</span>}
              {companyTva && <span>TVA {companyTva}</span>}
            </div>
          </div>
        </div>

        {/* Document title + numbers - right */}
        <div className="text-right shrink-0">
          <p className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-medium">{docTitle}</p>
          <p className="text-2xl font-bold font-mono text-zinc-900 mt-1 leading-none">
            {form.invoice_number || "—"}
          </p>
          <div className="mt-3 text-[11px] text-zinc-700 space-y-0.5">
            <div className="flex justify-end gap-2">
              <span className="text-zinc-500">Emissão:</span>
              <span className="font-medium tabular-nums">{fmtDate(form.issue_date)}</span>
            </div>
            <div className="flex justify-end gap-2">
              <span className="text-zinc-500">Vencimento:</span>
              <span className="font-medium tabular-nums">{fmtDate(form.due_date)}</span>
            </div>
            {opt.show_payment_terms && (
              <div className="flex justify-end gap-2">
                <span className="text-zinc-500">Condição:</span>
                <span className="font-medium">{paymentLabel}</span>
              </div>
            )}
            {opt.show_client_reference && opt.client_reference && (
              <div className="flex justify-end gap-2">
                <span className="text-zinc-500">Ref. cliente:</span>
                <span className="font-medium">{opt.client_reference}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* BILL TO */}
      <section className="mt-6 grid grid-cols-2 gap-6">
        <div>
          <p className="text-[9px] uppercase tracking-[0.18em] text-zinc-400 font-semibold">Faturado a</p>
          <div className="mt-2">
            {client ? (
              <>
                <p className="text-sm font-semibold text-zinc-900">{client.name}</p>
                {(client.address || client.address_complement || client.postal_code || client.city || client.country) && (
                  <p className="text-[11px] text-zinc-600 leading-snug mt-0.5">
                    {[
                      client.address,
                      client.address_complement,
                      [client.postal_code, client.city].filter(Boolean).join(" "),
                      client.country,
                    ].filter(Boolean).join(", ")}
                  </p>
                )}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-500 mt-1">
                  {(client.email || client.contact_email) && <span>{client.email ?? client.contact_email}</span>}
                  {(client.phone || client.contact_phone) && <span>{client.phone ?? client.contact_phone}</span>}
                </div>
                {(opt.show_tva || opt.show_siret_vat) && (
                  <div className="mt-2 text-[10px] text-zinc-500 space-y-0.5">
                    {opt.show_tva && (
                      <p>TVA / IVA: <span className="text-zinc-700">{client.tva_intracom || "—"}</span></p>
                    )}
                    {opt.show_siret_vat && (
                      <p>SIRET / VAT: <span className="text-zinc-700">{client.siret || client.siren || client.tax_id || "—"}</span></p>
                    )}
                  </div>
                )}
              </>
            ) : (
              <p className="text-[11px] text-zinc-400 italic">Cliente não selecionado</p>
            )}
          </div>
        </div>

        {opt.show_delivery_address && (
          <div>
            <p className="text-[9px] uppercase tracking-[0.18em] text-zinc-400 font-semibold">Endereço de entrega</p>
            <p className="text-[11px] text-zinc-500 italic mt-2">A definir</p>
          </div>
        )}
      </section>

      {/* ITEMS TABLE */}
      <section className="mt-8">
        <table className="w-full text-[11px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr className="bg-zinc-900 text-white">
              <th className="text-left py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider">Designação</th>
              <th className="text-right py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider w-16">Qtd</th>
              <th className="text-right py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider w-24">Preço unit.</th>
              <th className="text-right py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider w-16">Imp.</th>
              <th className="text-right py-2.5 px-3 font-semibold uppercase text-[10px] tracking-wider w-28">Total</th>
            </tr>
          </thead>
          <tbody>
            {form.items.map((it, i) => {
              const lineNet = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
              return (
                <tr key={it.id} className={i % 2 === 0 ? "bg-white" : "bg-zinc-50"}>
                  <td className="py-2.5 px-3 align-top text-zinc-800">
                    {it.designation || <span className="text-zinc-400 italic">Sem descrição</span>}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-zinc-700">
                    {Number(it.quantity) || 0} <span className="text-zinc-400 text-[9px]">{it.unit}</span>
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-zinc-700">{fmtMoney(Number(it.unit_price) || 0)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-zinc-500">{Number(it.tax_rate) || 0}%</td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-medium text-zinc-900">{fmtMoney(lineNet)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* TOTALS */}
      <section className="mt-6 flex justify-end avoid-break">
        <div className="w-72">
          <div className="flex justify-between py-1.5 text-[11px]">
            <span className="text-zinc-500">Subtotal</span>
            <span className="tabular-nums text-zinc-800">{fmtMoney(totals.subtotal)}</span>
          </div>
          {opt.show_discount && totals.discount > 0 && (
            <div className="flex justify-between py-1.5 text-[11px] text-rose-600">
              <span>
                Desconto {opt.discount_type === "percent" ? `(${opt.discount_value || 0}%)` : ""}
              </span>
              <span className="tabular-nums">- {fmtMoney(totals.discount)}</span>
            </div>
          )}
          <div className="flex justify-between py-1.5 text-[11px] border-t border-zinc-200">
            <span className="text-zinc-500">Total sem imposto</span>
            <span className="tabular-nums text-zinc-800">{fmtMoney(totals.netSubtotal)}</span>
          </div>
          {Array.from(taxBuckets.entries()).filter(([, v]) => v > 0).map(([rate, val]) => (
            <div key={rate} className="flex justify-between py-1 text-[11px] text-zinc-500">
              <span>Imposto ({rate}%)</span>
              <span className="tabular-nums">{fmtMoney(val)}</span>
            </div>
          ))}
          <div className="flex justify-between py-1.5 text-[11px] border-t border-zinc-200">
            <span className="text-zinc-500">Total imposto</span>
            <span className="tabular-nums text-zinc-800">{fmtMoney(totals.tax)}</span>
          </div>
          <div className="flex justify-between mt-2 py-3 px-3 bg-zinc-900 text-white rounded-sm">
            <span className="text-[11px] uppercase tracking-wider font-semibold">Total a pagar</span>
            <span className="tabular-nums text-base font-bold">{fmtMoney(totals.total)}</span>
          </div>
        </div>
      </section>

      {/* BANK DETAILS */}
      {opt.show_bank_details && (form.bank_iban || form.bank_bic || form.bank_name) && (
        <section className="mt-8 rounded-sm border border-zinc-200 bg-zinc-50/60 p-4 avoid-break">
          <p className="text-[9px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">Dados bancários</p>
          <div className="grid grid-cols-3 gap-4 mt-2 text-[11px]">
            {form.bank_name && (
              <div>
                <p className="text-zinc-400 text-[9px] uppercase">Banco</p>
                <p className="text-zinc-800 font-medium">{form.bank_name}</p>
              </div>
            )}
            {form.bank_iban && (
              <div>
                <p className="text-zinc-400 text-[9px] uppercase">IBAN</p>
                <p className="text-zinc-800 font-mono tracking-wide">{form.bank_iban}</p>
              </div>
            )}
            {form.bank_bic && (
              <div>
                <p className="text-zinc-400 text-[9px] uppercase">BIC / SWIFT</p>
                <p className="text-zinc-800 font-mono tracking-wide">{form.bank_bic}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* NOTES */}
      {opt.show_notes && form.notes && (
        <section className="mt-6">
          <p className="text-[9px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">Observações</p>
          <p className="text-[11px] text-zinc-700 whitespace-pre-wrap mt-2 leading-relaxed">{form.notes}</p>
        </section>
      )}

      {/* LEGAL FOOTER */}
      <footer className="mt-12 pt-4 border-t border-zinc-200 text-[9px] text-zinc-500 leading-relaxed avoid-break">
        {form.legal_text && <p className="mb-2 italic">{form.legal_text}</p>}
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-0.5">
          <span className="font-medium text-zinc-700">{companyName}</span>
          {companyAddr && <span>· {companyAddr.split("\n")[0]}</span>}
          {companySiret && <span>· SIRET {companySiret}</span>}
          {companyTva && <span>· TVA {companyTva}</span>}
        </div>
        <p className="text-center mt-1 text-zinc-400">Documento gerado eletronicamente — válido sem assinatura.</p>
      </footer>
    </div>
  );
}

// ───────────────────────────── A4 Preview Frame
// Encolhe proporcionalmente o documento A4 (210mm) para caber na largura disponível,
// preservando a aparência idêntica à impressão real (zoom proporcional, sem distorção).
function InvoiceA4PreviewFrame({ children }: { children: React.ReactNode }) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const innerRef = React.useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = React.useState(1);
  const [innerH, setInnerH] = React.useState(0);

  React.useEffect(() => {
    const recompute = () => {
      const wrap = wrapRef.current;
      const inner = innerRef.current;
      if (!wrap || !inner) return;
      const A4_PX = 793.7; // 210mm @ 96dpi
      const padded = wrap.clientWidth - 32;
      const s = Math.min(1, padded / A4_PX);
      setScale(s);
      setInnerH(inner.scrollHeight * s);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    if (wrapRef.current) ro.observe(wrapRef.current);
    if (innerRef.current) ro.observe(innerRef.current);
    window.addEventListener("resize", recompute);
    return () => { ro.disconnect(); window.removeEventListener("resize", recompute); };
  }, []);

  return (
    <div
      ref={wrapRef}
      className="invoice-a4-frame w-full flex justify-center print:p-0 print:bg-white"
      style={{ padding: "20px 16px 32px", overflow: "auto" }}
    >
      <div
        style={{ width: `${793.7 * scale}px`, height: innerH || undefined }}
        className="print:!w-auto print:!h-auto"
      >
        <div
          ref={innerRef}
          style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "793.7px" }}
          className="print:!transform-none print:!w-auto"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
