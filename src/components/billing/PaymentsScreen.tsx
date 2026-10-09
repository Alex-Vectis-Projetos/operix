import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search, Plus, Filter, Download, MoreHorizontal, Eye, Pencil, Trash2,
  ChevronLeft, ChevronRight, Loader2, Upload, FileText, FileSpreadsheet, CreditCard,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
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
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/api";

type PaymentStatus = "pending" | "confirmed" | "failed" | "refunded";
type Attachment = {
  id: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  signed_url: string | null;
};
type Payment = {
  id: string;
  workspace_id: string;
  workspace_name: string | null;
  payment_method_id: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  reference: string | null;
  invoice_id: string | null;
  invoice_number: string | null;
  customer_name: string | null;
  payment_date: string;
  notes: string | null;
  account: string | null;
  proof_path: string | null;
  proof_name: string | null;
  attachments: Attachment[];
  created_at: string;
};
type Method = {
  id: string;
  name: string;
};
type Invoice = {
  id: string;
  invoice_number: string;
  customer_name: string | null;
  total_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: string;
};

const STATUS_STYLES: Record<PaymentStatus, string> = {
  pending: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  confirmed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  refunded: "bg-muted/40 text-muted-foreground border-border",
};

const STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  failed: "Falhado",
  refunded: "Reembolsado",
};

function StatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <Badge variant="outline" className={cn("text-[10px]", STATUS_STYLES[status])}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

const fmt = (n: number | null | undefined) =>
  `€ ${(Number(n) || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface FormState {
  invoice_id: string;
  payment_method_id: string;
  amount: string;
  payment_date: string;
  reference: string;
  notes: string;
  status: PaymentStatus;
  account: string;
}

const blankForm = (): FormState => ({
  invoice_id: "",
  payment_method_id: "",
  amount: "",
  payment_date: new Date().toISOString().slice(0, 10),
  reference: "",
  notes: "",
  status: "confirmed",
  account: "",
});

export default function PaymentsScreen() {
  const qc = useQueryClient();

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | PaymentStatus>("all");
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 12;

  // Dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Payment | null>(null);
  const [form, setForm] = useState<FormState>(blankForm());
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [paymentMode, setPaymentMode] = useState<"total" | "partial">("total");

  // Detail panel
  const [detailId, setDetailId] = useState<string | null>(null);

  // Delete
  const [toDelete, setToDelete] = useState<Payment | null>(null);

  // Queries
  const { data: payments = [], isLoading } = useQuery({
    queryKey: ["admin-payments-ledger"],
    queryFn: async () => {
      const data = await apiRequest<{ payments: Payment[] }>("/billing/admin/payments");
      return data.payments ?? [];
    },
  });

  const { data: methods = [] } = useQuery({
    queryKey: ["admin-payment-methods"],
    queryFn: async () => {
      const data = await apiRequest<{ methods: Method[] }>("/billing/admin/payment-methods");
      return data.methods ?? [];
    },
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["admin-invoices-for-payments"],
    queryFn: async () => {
      const data = await apiRequest<{ invoices: Invoice[] }>("/billing/admin/ops/invoices");
      return data.invoices ?? [];
    },
  });

  const methodMap = useMemo(() => Object.fromEntries(methods.map((m) => [m.id, m])), [methods]);
  const invoiceMap = useMemo(() => Object.fromEntries(invoices.map((i) => [i.id, i])), [invoices]);
  const attachmentsByPayment = useMemo(() => {
    const m: Record<string, Attachment[]> = {};
    for (const payment of payments) {
      for (const attachment of payment.attachments ?? []) {
        (m[payment.id] ||= []).push(attachment);
      }
    }
    return m;
  }, [payments]);

  const filtered = useMemo(() => {
    return payments.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (methodFilter !== "all" && p.payment_method_id !== methodFilter) return false;
      if (!search) return true;
      const s = search.toLowerCase();
      const inv = p.invoice_id ? invoiceMap[p.invoice_id] : null;
      return [
        p.reference, p.notes, inv?.invoice_number, inv?.customer_name,
      ].filter(Boolean).some((v) => String(v).toLowerCase().includes(s));
    });
  }, [payments, statusFilter, methodFilter, search, invoiceMap]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = page > totalPages ? 1 : page;
  const pageData = filtered.slice((current - 1) * pageSize, current * pageSize);

  const totalAmount = filtered.reduce((s, p) => s + Number(p.amount || 0), 0);
  const completedCount = filtered.filter((p) => p.status === "confirmed").length;
  const pendingCount = filtered.filter((p) => p.status === "pending").length;

  // Open form
  const openCreate = () => {
    setEditing(null);
    setForm(blankForm());
    setReceiptFile(null);
    setPaymentMode("total");
    setFormOpen(true);
  };

  const openEdit = (p: Payment) => {
    setEditing(p);
    setForm({
      invoice_id: p.invoice_id,
      payment_method_id: p.payment_method_id ?? "",
      amount: String(p.amount ?? ""),
      payment_date: p.payment_date,
      reference: p.reference ?? "",
      notes: p.notes ?? "",
      status: p.status,
      account: "",
    });
    setReceiptFile(null);
    setPaymentMode("partial");
    setFormOpen(true);
  };

  // When invoice + mode change, auto-fill amount
  useEffect(() => {
    if (!form.invoice_id || editing) return;
    const inv = invoiceMap[form.invoice_id];
    if (!inv) return;
    if (paymentMode === "total") {
      const remaining = Number(inv.remaining_amount ?? Number(inv.total_amount) - Number(inv.paid_amount));
      setForm((f) => ({ ...f, amount: remaining > 0 ? remaining.toFixed(2) : "0.00" }));
    }
  }, [form.invoice_id, paymentMode, invoiceMap, editing]);

  // Save
  const handleSave = async () => {
    if (!form.invoice_id) return toast({ title: "Selecione uma fatura", variant: "destructive" });
    const amt = Number(form.amount);
    if (!amt || amt <= 0) return toast({ title: "Valor inválido", variant: "destructive" });

    setSaving(true);
    try {
      let proofPath: string | null = null;
      let proofName: string | null = null;
      if (receiptFile) {
        proofName = receiptFile.name;
        proofPath = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === "string") resolve(reader.result);
            else reject(new Error("Falha ao ler comprovante"));
          };
          reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler comprovante"));
          reader.readAsDataURL(receiptFile);
        });
      }
      const payload = {
        invoice_id: form.invoice_id,
        payment_method_id: form.payment_method_id || null,
        amount: amt,
        payment_date: form.payment_date,
        reference: form.reference || null,
        notes: form.notes || null,
        status: form.status,
        account: form.account || null,
        proof_path: proofPath,
        proof_name: proofName,
      };

      if (editing) {
        await apiRequest(`/billing/admin/payments/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await apiRequest("/billing/admin/payments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      toast({ title: editing ? "Pagamento atualizado" : "Pagamento registado" });
      setFormOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-payments-ledger"] });
      qc.invalidateQueries({ queryKey: ["admin-invoices-for-payments"] });
      qc.invalidateQueries({ queryKey: ["platform-payments"] });
      qc.invalidateQueries({ queryKey: ["platform-invoices"] });
      qc.invalidateQueries({ queryKey: ["billing-invoices-upcoming"] });
    } catch (e: any) {
      toast({ title: "Erro ao guardar", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    try {
      await apiRequest(`/billing/admin/payments/${toDelete.id}`, {
        method: "DELETE",
      });
      toast({ title: "Pagamento eliminado" });
      qc.invalidateQueries({ queryKey: ["admin-payments-ledger"] });
      qc.invalidateQueries({ queryKey: ["admin-invoices-for-payments"] });
      qc.invalidateQueries({ queryKey: ["platform-payments"] });
      qc.invalidateQueries({ queryKey: ["platform-invoices"] });
      qc.invalidateQueries({ queryKey: ["billing-invoices-upcoming"] });
    } catch (e: any) {
      toast({ title: "Erro ao eliminar", description: e.message, variant: "destructive" });
    } finally {
      setToDelete(null);
    }
  };

  const openReceipt = async (att: Attachment) => {
    if (!att.signed_url) {
      toast({ title: "Não foi possível abrir comprovante", variant: "destructive" });
      return;
    }
    window.open(att.signed_url, "_blank");
  };

  // Export CSV
  const exportCSV = () => {
    if (!filtered.length) {
      toast({ title: "Nenhum pagamento para exportar", description: "A lista de pagamentos está vazia com os filtros atuais." });
      return;
    }
    const rows = [
      ["Data do Pagamento", "Referência", "Nº da Fatura", "Cliente", "Método", "Valor (€)", "Estado", "Conta Bancária", "Notas"],
      ...filtered.map((p) => {
        const inv = p.invoice_id ? invoiceMap[p.invoice_id] : null;
        return [
          p.payment_date,
          p.reference ?? "",
          inv?.invoice_number ?? p.invoice_number ?? "",
          inv?.customer_name ?? p.customer_name ?? "",
          p.payment_method_id ? methodMap[p.payment_method_id]?.name ?? p.payment_method_id : "Transferência",
          (Number(p.amount) || 0).toLocaleString("pt-PT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          STATUS_LABEL[p.status] || p.status,
          p.account ?? "",
          (p.notes ?? "").replace(/\r?\n/g, " "),
        ];
      }),
    ];
    const csv = "\uFEFF" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pagamentos_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast({ title: "CSV de pagamentos exportado com sucesso" });
  };

  // Export PDF
  const exportPDF = () => {
    if (!filtered.length) {
      toast({ title: "Nenhum pagamento para exportar", description: "A lista de pagamentos está vazia com os filtros atuais." });
      return;
    }
    try {
      const doc = new jsPDF({ orientation: "landscape" });
      const nowFormatted = format(new Date(), "dd/MM/yyyy HH:mm");

      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, 297, 24, "F");

      doc.setTextColor(255, 255, 255);
      doc.setFontSize(13);
      doc.setFont("helvetica", "bold");
      doc.text("OPERIX — RELATÓRIO DE PAGAMENTOS", 14, 11);

      doc.setFontSize(8.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(148, 163, 184);
      doc.text(`Total de registros: ${filtered.length}  ·  Gerado em: ${nowFormatted}`, 14, 18);

      const totalAmount = filtered.reduce((s, p) => s + (Number(p.amount) || 0), 0);

      autoTable(doc, {
        startY: 30,
        head: [["Data", "Referência", "Fatura", "Cliente", "Método", "Valor", "Estado", "Notas"]],
        body: filtered.map((p) => {
          const inv = p.invoice_id ? invoiceMap[p.invoice_id] : null;
          return [
            p.payment_date,
            p.reference ?? "—",
            inv?.invoice_number ?? p.invoice_number ?? "—",
            inv?.customer_name ?? p.customer_name ?? "—",
            p.payment_method_id ? methodMap[p.payment_method_id]?.name ?? p.payment_method_id : "Transferência",
            fmt(p.amount),
            STATUS_LABEL[p.status] || p.status,
            (p.notes ?? "").replace(/\r?\n/g, " "),
          ];
        }),
        foot: [["Total Consolidado", "", "", "", "", fmt(totalAmount), "", ""]],
        styles: { fontSize: 8, cellPadding: 2.2 },
        headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: "bold" },
        footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: "bold" },
      });

      const totalPages = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        doc.text(
          `Operix ERP · Página ${i} de ${totalPages}`,
          14,
          doc.internal.pageSize.height - 6
        );
      }

      doc.save(`pagamentos_${format(new Date(), "yyyyMMdd_HHmm")}.pdf`);
      toast({ title: "PDF de pagamentos exportado com sucesso" });
    } catch (e: any) {
      toast({ title: "Erro ao gerar PDF", description: e?.message ?? "Falha desconhecida", variant: "destructive" });
    }
  };

  const detailPayment = detailId ? payments.find((p) => p.id === detailId) : null;
  const detailInvoice = detailPayment?.invoice_id ? invoiceMap[detailPayment.invoice_id] : null;
  const detailAttachments = detailPayment ? attachmentsByPayment[detailPayment.id] ?? [] : [];

  const formInvoice = form.invoice_id ? invoiceMap[form.invoice_id] : null;
  const formInvoiceRemaining = formInvoice
    ? Number(formInvoice.remaining_amount ?? Number(formInvoice.total_amount) - Number(formInvoice.paid_amount))
    : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Breadcrumbs */}
      <Breadcrumb>
        <BreadcrumbList className="text-xs">
          <BreadcrumbItem>
            <BreadcrumbLink href="/billing/faturas">Faturamento</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Pagamentos</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pagamentos</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Histórico financeiro, comprovantes e vinculação automática às faturas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={exportCSV}>
            <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />
            CSV
          </Button>
          <Button variant="outline" size="sm" className="h-8" onClick={exportPDF}>
            <FileText className="h-3.5 w-3.5 mr-1.5" />
            PDF
          </Button>
          <Button size="sm" className="h-8" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Registar pagamento
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</p>
            <p className="text-lg font-semibold tabular-nums">{filtered.length}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Montante</p>
            <p className="text-lg font-semibold text-primary tabular-nums">{fmt(totalAmount)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Confirmados</p>
            <p className="text-lg font-semibold text-emerald-400 tabular-nums">{completedCount}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Pendentes</p>
            <p className="text-lg font-semibold text-amber-400 tabular-nums">{pendingCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="border-border/50">
        <CardContent className="pt-4 pb-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Pesquisar por fatura, cliente, referência..."
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Select value={statusFilter} onValueChange={(v: any) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <Filter className="h-3 w-3 mr-1.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os estados</SelectItem>
              <SelectItem value="confirmed">Confirmado</SelectItem>
              <SelectItem value="pending">Pendente</SelectItem>
              <SelectItem value="failed">Falhado</SelectItem>
              <SelectItem value="refunded">Reembolsado</SelectItem>
            </SelectContent>
          </Select>
          <Select value={methodFilter} onValueChange={(v) => { setMethodFilter(v); setPage(1); }}>
            <SelectTrigger className="h-8 w-[180px] text-xs">
              <CreditCard className="h-3 w-3 mr-1.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os métodos</SelectItem>
              {methods.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
              ))}
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
                <TableHead className="w-[100px]">Data</TableHead>
                <TableHead>Fatura</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Método</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-center w-[60px]">Comp.</TableHead>
                <TableHead className="w-[60px] text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12">
                    <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                    <span className="text-xs text-muted-foreground">A carregar...</span>
                  </TableCell>
                </TableRow>
              ) : pageData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-xs text-muted-foreground">
                    Nenhum pagamento encontrado.
                  </TableCell>
                </TableRow>
              ) : (
                pageData.map((p) => {
                  const inv = p.invoice_id ? invoiceMap[p.invoice_id] : null;
                  const att = attachmentsByPayment[p.id] ?? [];
                  return (
                    <TableRow key={p.id} className="text-xs animate-fade-in cursor-pointer" onClick={() => setDetailId(p.id)}>
                      <TableCell className="text-muted-foreground">{p.payment_date}</TableCell>
                      <TableCell className="font-mono text-[11px] text-primary">
                        {inv?.invoice_number ?? "—"}
                      </TableCell>
                      <TableCell className="font-medium">{inv?.customer_name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {p.payment_method_id ? methodMap[p.payment_method_id]?.name ?? "—" : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{fmt(p.amount)}</TableCell>
                      <TableCell><StatusBadge status={p.status} /></TableCell>
                      <TableCell className="text-center">
                        {att.length > 0 ? (
                          <FileText className="h-3.5 w-3.5 text-primary inline" />
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="text-xs">
                            <DropdownMenuItem onClick={() => setDetailId(p.id)}>
                              <Eye className="h-3.5 w-3.5 mr-2" />Detalhes
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openEdit(p)}>
                              <Pencil className="h-3.5 w-3.5 mr-2" />Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => setToDelete(p)}>
                              <Trash2 className="h-3.5 w-3.5 mr-2" />Eliminar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-border/50 px-4 py-2.5 text-xs text-muted-foreground">
          <span>Página {current} de {totalPages} · {filtered.length} registros</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 px-2" disabled={current <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm" className="h-7 px-2" disabled={current >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </Card>

      {/* Form dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar pagamento" : "Registar pagamento"}</DialogTitle>
            <DialogDescription className="text-xs">
              O saldo da fatura é atualizado automaticamente.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-3 py-2">
            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Fatura *</Label>
              <Select value={form.invoice_id} onValueChange={(v) => setForm((f) => ({ ...f, invoice_id: v }))}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Selecionar fatura..." />
                </SelectTrigger>
                <SelectContent>
                  {invoices.map((i) => (
                    <SelectItem key={i.id} value={i.id} className="text-xs">
                      {i.invoice_number} — {i.customer_name ?? "s/cliente"} · saldo {fmt(i.remaining_amount ?? Number(i.total_amount) - Number(i.paid_amount))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formInvoice && (
                <p className="text-[10px] text-muted-foreground">
                  Total {fmt(formInvoice.total_amount)} · Pago {fmt(formInvoice.paid_amount)} · <span className="text-primary">Saldo {fmt(formInvoiceRemaining)}</span>
                </p>
              )}
            </div>

            {!editing && (
              <div className="col-span-2 flex gap-2">
                <Button
                  type="button" size="sm" variant={paymentMode === "total" ? "default" : "outline"}
                  className="h-8 text-xs flex-1" onClick={() => setPaymentMode("total")}
                >
                  Pagamento total
                </Button>
                <Button
                  type="button" size="sm" variant={paymentMode === "partial" ? "default" : "outline"}
                  className="h-8 text-xs flex-1" onClick={() => setPaymentMode("partial")}
                >
                  Pagamento parcial
                </Button>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Valor *</Label>
              <Input type="number" step="0.01" min="0" className="h-9 text-xs"
                value={form.amount}
                disabled={!editing && paymentMode === "total"}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Data *</Label>
              <Input type="date" className="h-9 text-xs" value={form.payment_date}
                onChange={(e) => setForm((f) => ({ ...f, payment_date: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Método</Label>
              <Select value={form.payment_method_id} onValueChange={(v) => setForm((f) => ({ ...f, payment_method_id: v }))}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Selecionar..." />
                </SelectTrigger>
                <SelectContent>
                  {methods.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Estado</Label>
              <Select value={form.status} onValueChange={(v: PaymentStatus) => setForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="confirmed">Confirmado</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="failed">Falhado</SelectItem>
                  <SelectItem value="refunded">Reembolsado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Conta bancária</Label>
              <Input className="h-9 text-xs" value={form.account}
                placeholder="IBAN / referência da conta"
                onChange={(e) => setForm((f) => ({ ...f, account: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Referência</Label>
              <Input className="h-9 text-xs" value={form.reference}
                placeholder="Nº transação..."
                onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
              />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs">Observação</Label>
              <Textarea rows={2} className="text-xs" value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>

            <div className="col-span-2 space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Upload className="h-3.5 w-3.5" /> Comprovante (PDF / imagem)
              </Label>
              <Input type="file" accept="image/*,application/pdf" className="h-9 text-xs"
                onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
              />
              {receiptFile && (
                <p className="text-[10px] text-muted-foreground">
                  {receiptFile.name} · {(receiptFile.size / 1024).toFixed(1)} KB
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {editing ? "Guardar" : "Registar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail sheet */}
      <Sheet open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base">Pagamento</SheetTitle>
            <SheetDescription className="text-xs">
              {detailPayment?.payment_date}
            </SheetDescription>
          </SheetHeader>
          {detailPayment && (
            <div className="mt-4 space-y-4">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Card className="border-border/50"><CardContent className="pt-3 pb-2">
                  <p className="text-[10px] uppercase text-muted-foreground">Valor</p>
                  <p className="text-base font-semibold text-primary">{fmt(detailPayment.amount)}</p>
                </CardContent></Card>
                <Card className="border-border/50"><CardContent className="pt-3 pb-2">
                  <p className="text-[10px] uppercase text-muted-foreground">Estado</p>
                  <div className="mt-1"><StatusBadge status={detailPayment.status} /></div>
                </CardContent></Card>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="text-muted-foreground">Fatura</span>
                  <span className="font-mono text-primary">{detailInvoice?.invoice_number ?? "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Cliente</span>
                  <span>{detailInvoice?.customer_name ?? "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Método</span>
                  <span>{detailPayment.payment_method_id ? methodMap[detailPayment.payment_method_id]?.name ?? "—" : "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Referência</span>
                  <span>{detailPayment.reference ?? "—"}</span></div>
                {detailPayment.notes && (
                  <div className="pt-2 border-t border-border/50">
                    <p className="text-muted-foreground mb-1">Observação</p>
                    <p>{detailPayment.notes}</p>
                  </div>
                )}
              </div>

              {detailInvoice && (
                <Card className="border-border/50">
                  <CardContent className="pt-3 pb-3 space-y-1 text-xs">
                    <p className="text-[10px] uppercase text-muted-foreground mb-1">Saldo da fatura</p>
                    <div className="flex justify-between"><span>Total</span><span className="tabular-nums">{fmt(detailInvoice.total_amount)}</span></div>
                    <div className="flex justify-between"><span>Pago</span><span className="tabular-nums text-emerald-400">{fmt(detailInvoice.paid_amount)}</span></div>
                    <div className="flex justify-between font-semibold"><span>Restante</span>
                      <span className="tabular-nums text-primary">
                        {fmt(detailInvoice.remaining_amount ?? Number(detailInvoice.total_amount) - Number(detailInvoice.paid_amount))}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div>
                <p className="text-[10px] uppercase text-muted-foreground mb-2">Comprovantes</p>
                {detailAttachments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum comprovante anexado.</p>
                ) : (
                  <div className="space-y-1.5">
                    {detailAttachments.map((a) => (
                      <button key={a.id}
                        onClick={() => openReceipt(a)}
                        className="w-full text-left text-xs px-2 py-1.5 rounded border border-border/50 hover:bg-accent/50 flex items-center gap-2 transition"
                      >
                        <FileText className="h-3.5 w-3.5 text-primary" />
                        <span className="flex-1 truncate">{a.file_name}</span>
                        <span className="text-muted-foreground text-[10px]">
                          {a.size_bytes ? `${(a.size_bytes / 1024).toFixed(0)} KB` : ""}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Delete dialog */}
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar pagamento?</AlertDialogTitle>
            <AlertDialogDescription>
              O saldo da fatura será recalculado automaticamente. Esta ação é irreversível.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Eliminar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
