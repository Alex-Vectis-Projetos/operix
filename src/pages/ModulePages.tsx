import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { uploadFile as storageUpload, deleteFiles, getFileUrl, openSecureStorageFile } from "@/lib/storage";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { useWorkspace } from "@/hooks/useWorkspace";
import { SystemPreferencesCard } from "@/components/settings/SystemPreferencesCard";
import { SecurityCard } from "@/components/settings/SecurityCard";
import { TempCredentialsCard } from "@/components/settings/TempCredentialsCard";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  PieChart as PieChartIcon, BookOpen, Car, FolderOpen, Users, Settings,
  Plus, Save, Trash2, Upload, FolderPlus, ChevronRight, Loader2, Pencil,
  CheckSquare, MoveRight, Eye, Download, Printer, FileText, Check, X, Crown,
  Copy, Link, AlertTriangle, Shield,
  LayoutGrid, List, ArrowLeft, ArrowRight, ArrowUp, RefreshCw, Search,
  HardDrive, FileSpreadsheet, Image as ImageIcon, UploadCloud, Folder, File,
  FileArchive, Globe, Building2, User, FileCheck2, Sparkles,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { usePeople } from "@/hooks/usePeople";
import { useClients } from "@/hooks/useServiceOrders";
import { useCountryDocumentRequirements } from "@/hooks/useCountryDocumentRequirements";

import { Can } from "@/components/Can";
import { getCurrentUserId, logSaveError, logSavePayload } from "@/lib/authUser";
import { SYSTEM_METADATA } from "@/config/system";
import { withPromiseTimeout } from "@/lib/asyncGuard";

// ─── PROFIT DISTRIBUTION ───
// Moved to src/components/profit/ProfitDistribution.tsx
export { ProfitDistribution } from "@/components/profit/ProfitDistribution";

// ─── ACCOUNTING ───
import { AccountingControlCenter } from "@/components/accounting/AccountingControlCenter";

export function Accounting() {
  return <AccountingControlCenter />;
}

export function AccountingLegacy() {
  const { t, formatCurrency, formatDate } = useLanguage();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ type: "expense", category: "other", amount: "", label: "", notes: "", status: "confirmed" });

  // Filters
  const [filterType, setFilterType] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");

  const categories = [
    { value: "labor", label: "acc.catLabor" },
    { value: "material", label: "acc.catMaterial" },
    { value: "fuel", label: "acc.catFuel" },
    { value: "tax", label: "acc.catTax" },
    { value: "salary", label: "acc.catSalary" },
    { value: "services", label: "acc.catServices" },
    { value: "other", label: "acc.catOther" },
  ];

  const { data: records = [], isLoading } = useQuery({
    queryKey: ["financial_records"],
    queryFn: async () => {
      const { data, error } = await supabase.from("financial_records").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Filter records
  const filtered = records.filter((r: any) => {
    if (filterType !== "all" && r.type !== filterType) return false;
    if (filterCategory !== "all" && (r.category || "other") !== filterCategory) return false;
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    if (search) {
      const s = search.toLowerCase();
      const match = [r.notes, r.source, r.label, r.category].some(v => v && String(v).toLowerCase().includes(s));
      if (!match) return false;
    }
    return true;
  });

  // Summary calculations
  const totalIncome = filtered.filter((r: any) => r.type === "revenue").reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
  const totalExpenses = filtered.filter((r: any) => r.type === "expense").reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
  const netResult = totalIncome - totalExpenses;

  // Monthly data for chart
  const monthlyData = (() => {
    const months: Record<string, { month: string; revenue: number; expense: number }> = {};
    records.forEach((r: any) => {
      const d = new Date(r.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!months[key]) months[key] = { month: key, revenue: 0, expense: 0 };
      if (r.type === "revenue") months[key].revenue += Number(r.amount || 0);
      else months[key].expense += Number(r.amount || 0);
    });
    return Object.values(months).sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
  })();

  const addMutation = useMutation({
    mutationFn: async () => {
      const currentUserId = await getCurrentUserId();
      const payload: any = {
        type: form.type,
        source: form.label ? "manual" : "manual",
        category: form.category,
        label: form.label || null,
        amount: parseFloat(form.amount) || 0,
        notes: form.notes || null,
        status: form.status,
      };
      logSavePayload(editId ? "FinancialRecords:update" : "FinancialRecords:insert", currentUserId, payload);
      if (editId) {
        const { error } = await (supabase as any).from("financial_records").update(payload).eq("id", editId);
        if (error) {
          logSaveError("FinancialRecords:update", error);
          throw error;
        }
      } else {
        const { error } = await (supabase as any).from("financial_records").insert(payload);
        if (error) {
          logSaveError("FinancialRecords:insert", error);
          throw error;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financial_records"] });
      queryClient.invalidateQueries({ queryKey: ["financial-summary"] });
      setOpen(false);
      setEditId(null);
      setForm({ type: "expense", category: "other", amount: "", label: "", notes: "", status: "confirmed" });
      toast.success(editId ? t("toast.updated") : t("acc.entryAdded"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("financial_records").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["financial_records"] });
      toast.success(t("toast.deleted"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const startEdit = (r: any) => {
    setEditId(r.id);
    setForm({
      type: r.type,
      category: r.category || "other",
      amount: String(r.amount),
      label: r.label || "",
      notes: r.notes || "",
      status: r.status || "confirmed",
    });
    setOpen(true);
  };

  const maxBar = Math.max(...monthlyData.map(m => Math.max(m.revenue, m.expense)), 1);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <BookOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">{t("acc.title")}</h1>
            <p className="text-xs text-muted-foreground">{t("acc.subtitle")}</p>
          </div>
        </div>
        <Can permission="accounting.create">
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditId(null); }}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" />{t("acc.addEntry")}</Button>
            </DialogTrigger>
          <DialogContent className="bg-card border-border">
            <DialogHeader><DialogTitle>{editId ? t("action.edit") : t("acc.newEntry")}</DialogTitle></DialogHeader>
            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">{t("label.type")}</Label>
                  <Select value={form.type} onValueChange={v => setForm(p => ({ ...p, type: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="expense">{t("acc.expense")}</SelectItem>
                      <SelectItem value="revenue">{t("acc.revenue")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("label.category")}</Label>
                  <Select value={form.category} onValueChange={v => setForm(p => ({ ...p, category: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {categories.map(c => <SelectItem key={c.value} value={c.value}>{t(c.label)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">{t("label.amount")} (€)</Label>
                  <Input type="number" step="0.01" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("label.status")}</Label>
                  <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="confirmed">{t("status.confirmed")}</SelectItem>
                      <SelectItem value="pending">{t("status.pending")}</SelectItem>
                      <SelectItem value="paid">{t("status.paid")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("acc.label")}</Label>
                <Input value={form.label} onChange={e => setForm(p => ({ ...p, label: e.target.value }))} placeholder="ex: Facture #123" className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("label.notes")}</Label>
                <Input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className="h-9" />
              </div>
              <Button className="w-full" onClick={() => addMutation.mutate()} disabled={addMutation.isPending || !form.amount}>
                {addMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                {t("action.save")}
              </Button>
            </div>
          </DialogContent>
          </Dialog>
        </Can>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3">
            <p className="text-[11px] text-muted-foreground mb-1">{t("acc.totalIncome")}</p>
            <p className="text-xl font-bold text-emerald-500 tabular-nums">{formatCurrency(totalIncome)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3">
            <p className="text-[11px] text-muted-foreground mb-1">{t("acc.totalExpenses")}</p>
            <p className="text-xl font-bold text-destructive tabular-nums">{formatCurrency(totalExpenses)}</p>
          </CardContent>
        </Card>
        <Card className={`border-border/50 ${netResult >= 0 ? "bg-emerald-500/5" : "bg-destructive/5"}`}>
          <CardContent className="pt-4 pb-3">
            <p className="text-[11px] text-muted-foreground mb-1">{t("acc.netResult")}</p>
            <p className={`text-xl font-bold tabular-nums ${netResult >= 0 ? "text-emerald-500" : "text-destructive"}`}>
              {netResult >= 0 ? "+" : ""}{formatCurrency(netResult)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Monthly chart */}
      {monthlyData.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t("acc.monthlyChart")}</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-end gap-2 h-32">
              {monthlyData.map(m => (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex gap-0.5 items-end" style={{ height: "100px" }}>
                    <div className="flex-1 bg-emerald-500/80 rounded-t" style={{ height: `${(m.revenue / maxBar) * 100}px` }} title={formatCurrency(m.revenue)} />
                    <div className="flex-1 bg-destructive/80 rounded-t" style={{ height: `${(m.expense / maxBar) * 100}px` }} title={formatCurrency(m.expense)} />
                  </div>
                  <span className="text-[9px] text-muted-foreground">{m.month.slice(5)}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-4 mt-2 justify-center">
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><span className="w-2 h-2 rounded-sm bg-emerald-500/80" />{t("acc.revenue")}</span>
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground"><span className="w-2 h-2 rounded-sm bg-destructive/80" />{t("acc.expense")}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder={t("action.search")} className="h-8 w-48 text-xs" />
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("acc.allTypes")}</SelectItem>
            <SelectItem value="revenue">{t("acc.revenue")}</SelectItem>
            <SelectItem value="expense">{t("acc.expense")}</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("acc.allCategories")}</SelectItem>
            {categories.map(c => <SelectItem key={c.value} value={c.value}>{t(c.label)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("acc.allStatuses")}</SelectItem>
            <SelectItem value="confirmed">{t("status.confirmed")}</SelectItem>
            <SelectItem value="pending">{t("status.pending")}</SelectItem>
            <SelectItem value="paid">{t("status.paid")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">{t("acc.noEntries")}</div>
      ) : (
        <div className="rounded-lg border border-border/50 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="text-[11px]">
                <TableHead>{t("label.type")}</TableHead>
                <TableHead>{t("label.category")}</TableHead>
                <TableHead>{t("acc.label")}</TableHead>
                <TableHead className="text-right">{t("label.amount")}</TableHead>
                <TableHead>{t("label.status")}</TableHead>
                <TableHead>{t("acc.source")}</TableHead>
                <TableHead>{t("label.notes")}</TableHead>
                <TableHead>{t("label.date")}</TableHead>
                <TableHead>{t("label.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r: any) => {
                const catKey = categories.find(c => c.value === (r.category || "other"));
                return (
                  <TableRow key={r.id} className="text-xs">
                    <TableCell>
                      <Badge variant="outline" className={r.type === "revenue" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-destructive/10 text-destructive border-destructive/30"}>
                        {r.type === "revenue" ? t("acc.revenue") : t("acc.expense")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="text-[10px]">
                        {catKey ? t(catKey.label) : (r.category || r.source || "—")}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium">{r.label || "—"}</TableCell>
                    <TableCell className={`text-right font-medium tabular-nums ${r.type === "revenue" ? "text-emerald-500" : "text-destructive"}`}>
                      {r.type === "revenue" ? "+" : "-"}{formatCurrency(r.amount)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={
                        r.status === "paid" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                          : r.status === "pending" ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/30"
                          : ""
                      }>
                        {t(`status.${r.status}`, r.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-[10px]">{r.source || "manual"}</TableCell>
                    <TableCell className="max-w-[150px] truncate text-muted-foreground">{r.notes || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(r.created_at)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Can permission="accounting.edit">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(r)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </Can>
                        <Can permission="accounting.delete">
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(r.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </Can>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
// ─── FLEET ───
export function Fleet() {
  const { t, formatDate, formatCurrency } = useLanguage();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", license_plate: "", brand: "", model: "", year: "" });
  const [logOpen, setLogOpen] = useState(false);
  const [logVehicleId, setLogVehicleId] = useState<string | null>(null);
  const [logForm, setLogForm] = useState({ start_km: "", end_km: "", fuel_litres: "", fuel_cost: "", notes: "" });

  const { data: vehicles = [], isLoading } = useQuery({
    queryKey: ["vehicles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("vehicles").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: mileageLogs = [] } = useQuery({
    queryKey: ["mileage_logs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("mileage_logs").select("*, vehicles(name, license_plate)").order("date", { ascending: false }).limit(100);
      if (error) throw error;
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name,
        license_plate: form.license_plate,
        brand: form.brand || null,
        model: form.model || null,
        year: form.year ? parseInt(form.year) : null,
      };
      if (editId) {
        const { error } = await supabase.from("vehicles").update(payload).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("vehicles").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      setOpen(false);
      setEditId(null);
      setForm({ name: "", license_plate: "", brand: "", model: "", year: "" });
      toast.success(editId ? t("toast.updated") : t("fleet.vehicleAdded"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("vehicles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      toast.success(t("toast.deleted"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const logMutation = useMutation({
    mutationFn: async () => {
      if (!logVehicleId) throw new Error("No vehicle selected");
      const currentUserId = await getCurrentUserId();
      const startKm = parseFloat(logForm.start_km) || 0;
      const endKm = parseFloat(logForm.end_km) || 0;
      const fuelCost = parseFloat(logForm.fuel_cost) || 0;
      const fuelLitres = parseFloat(logForm.fuel_litres) || 0;

      const { error } = await supabase.from("mileage_logs").insert({
        vehicle_id: logVehicleId,
        start_km: startKm,
        end_km: endKm,
        fuel_litres: fuelLitres || null,
        fuel_cost: fuelCost || null,
        notes: logForm.notes || null,
      });
      if (error) throw error;

      // Auto-create fuel expense in accounting
      if (fuelCost > 0) {
        const vehicle = vehicles.find((v: any) => v.id === logVehicleId);
        const payload = {
          type: "expense",
          source: "fleet",
          category: "fuel",
          amount: fuelCost,
          label: `${t("fleet.fuel")} — ${vehicle?.name || vehicle?.license_plate || ""}`,
          notes: `${endKm - startKm} km, ${fuelLitres}L`,
          status: "confirmed",
        };
        logSavePayload("FleetFinancialRecord:insert", currentUserId, payload);
        const { error: financialError } = await (supabase as any).from("financial_records").insert(payload);
        if (financialError) {
          logSaveError("FleetFinancialRecord:insert", financialError);
          throw financialError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mileage_logs"] });
      queryClient.invalidateQueries({ queryKey: ["financial_records"] });
      queryClient.invalidateQueries({ queryKey: ["reconciliation-summary"] });
      setLogOpen(false);
      setLogVehicleId(null);
      setLogForm({ start_km: "", end_km: "", fuel_litres: "", fuel_cost: "", notes: "" });
      toast.success(t("fleet.logAdded"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const startEdit = (v: any) => {
    setEditId(v.id);
    setForm({ name: v.name, license_plate: v.license_plate, brand: v.brand || "", model: v.model || "", year: v.year ? String(v.year) : "" });
    setOpen(true);
  };

  const openLogFor = (vehicleId: string) => {
    setLogVehicleId(vehicleId);
    setLogOpen(true);
  };

  // Fleet KPIs
  const totalDistance = mileageLogs.reduce((s: number, l: any) => s + Math.max(0, Number(l.end_km || 0) - Number(l.start_km || 0)), 0);
  const totalFuelCost = mileageLogs.reduce((s: number, l: any) => s + Number(l.fuel_cost || 0), 0);
  const totalFuelLitres = mileageLogs.reduce((s: number, l: any) => s + Number(l.fuel_litres || 0), 0);
  const costPerKm = totalDistance > 0 ? totalFuelCost / totalDistance : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Car className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">{t("fleet.title")}</h1>
            <p className="text-xs text-muted-foreground">{t("fleet.subtitle")}</p>
          </div>
        </div>
        <Can permission="fleet.create">
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditId(null); }}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" />{t("fleet.addVehicle")}</Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader><DialogTitle>{editId ? t("action.edit") : t("fleet.newVehicle")}</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="space-y-2"><Label className="text-xs">{t("label.name")}</Label><Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder={t("placeholder.vehicleName")} /></div>
                <div className="space-y-2"><Label className="text-xs">{t("label.plate")}</Label><Input value={form.license_plate} onChange={e => setForm(p => ({ ...p, license_plate: e.target.value }))} placeholder="AB-123-CD" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2"><Label className="text-xs">{t("fleet.brand")}</Label><Input value={form.brand} onChange={e => setForm(p => ({ ...p, brand: e.target.value }))} /></div>
                  <div className="space-y-2"><Label className="text-xs">{t("fleet.model")}</Label><Input value={form.model} onChange={e => setForm(p => ({ ...p, model: e.target.value }))} /></div>
                </div>
                <div className="space-y-2"><Label className="text-xs">{t("fleet.year")}</Label><Input type="number" value={form.year} onChange={e => setForm(p => ({ ...p, year: e.target.value }))} /></div>
                <Button className="w-full" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !form.name || !form.license_plate}>
                  {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}{t("action.save")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </Can>
      </div>

      {/* Fleet KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3">
            <p className="text-[11px] text-muted-foreground mb-1">{t("fleet.totalVehicles")}</p>
            <p className="text-xl font-bold text-foreground tabular-nums">{vehicles.length}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3">
            <p className="text-[11px] text-muted-foreground mb-1">{t("fleet.totalKm")}</p>
            <p className="text-xl font-bold text-foreground tabular-nums">{totalDistance.toLocaleString()} km</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3">
            <p className="text-[11px] text-muted-foreground mb-1">{t("fleet.fuelCost")}</p>
            <p className="text-xl font-bold text-destructive tabular-nums">{formatCurrency(totalFuelCost)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/50">
          <CardContent className="pt-4 pb-3">
            <p className="text-[11px] text-muted-foreground mb-1">{t("fleet.costPerKm")}</p>
            <p className="text-xl font-bold text-foreground tabular-nums">{formatCurrency(costPerKm)}/km</p>
          </CardContent>
        </Card>
      </div>

      {/* Vehicles table */}
      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : vehicles.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">{t("fleet.noVehicles")}</div>
      ) : (
        <div className="rounded-lg border border-border/50 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="text-[11px]">
                <TableHead>{t("label.name")}</TableHead>
                <TableHead>{t("label.plate")}</TableHead>
                <TableHead>{t("fleet.brand")}</TableHead>
                <TableHead>{t("fleet.model")}</TableHead>
                <TableHead>{t("fleet.year")}</TableHead>
                <TableHead>{t("fleet.assignedTo")}</TableHead>
                <TableHead>{t("label.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vehicles.map((v: any) => (
                <TableRow key={v.id} className="text-xs">
                  <TableCell className="font-medium">{v.name}</TableCell>
                  <TableCell className="font-mono">{v.license_plate}</TableCell>
                  <TableCell>{v.brand || "—"}</TableCell>
                  <TableCell>{v.model || "—"}</TableCell>
                  <TableCell>{v.year || "—"}</TableCell>
                  <TableCell>{v.technicians?.name || "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openLogFor(v.id)} title={t("fleet.addLog")}>
                        <Plus className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(v)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(v.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Mileage log dialog */}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle>{t("fleet.newLog")}</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("fleet.startKm")}</Label>
                <Input type="number" value={logForm.start_km} onChange={e => setLogForm(p => ({ ...p, start_km: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("fleet.endKm")}</Label>
                <Input type="number" value={logForm.end_km} onChange={e => setLogForm(p => ({ ...p, end_km: e.target.value }))} className="h-9" />
              </div>
            </div>
            {logForm.start_km && logForm.end_km && (
              <p className="text-xs text-muted-foreground">
                {t("fleet.distance")}: <span className="font-medium text-foreground">{Math.max(0, parseFloat(logForm.end_km) - parseFloat(logForm.start_km))} km</span>
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("fleet.fuelLitres")}</Label>
                <Input type="number" step="0.1" value={logForm.fuel_litres} onChange={e => setLogForm(p => ({ ...p, fuel_litres: e.target.value }))} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("fleet.fuelCost")} (€)</Label>
                <Input type="number" step="0.01" value={logForm.fuel_cost} onChange={e => setLogForm(p => ({ ...p, fuel_cost: e.target.value }))} className="h-9" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("label.notes")}</Label>
              <Input value={logForm.notes} onChange={e => setLogForm(p => ({ ...p, notes: e.target.value }))} className="h-9" />
            </div>
            <Button className="w-full" onClick={() => logMutation.mutate()} disabled={logMutation.isPending || !logForm.start_km || !logForm.end_km}>
              {logMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}{t("action.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Mileage logs table */}
      {mileageLogs.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-2"><CardTitle className="text-sm">{t("fleet.mileageLogs")}</CardTitle></CardHeader>
          <CardContent>
            <div className="rounded-lg border border-border/50 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-[11px]">
                    <TableHead>{t("label.date")}</TableHead>
                    <TableHead>{t("label.car")}</TableHead>
                    <TableHead className="text-right">{t("fleet.startKm")}</TableHead>
                    <TableHead className="text-right">{t("fleet.endKm")}</TableHead>
                    <TableHead className="text-right">{t("fleet.distance")}</TableHead>
                    <TableHead className="text-right">{t("fleet.fuelLitres")}</TableHead>
                    <TableHead className="text-right">{t("fleet.fuelCost")}</TableHead>
                    <TableHead>{t("label.notes")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mileageLogs.slice(0, 20).map((l: any) => (
                    <TableRow key={l.id} className="text-xs">
                      <TableCell>{formatDate(l.date)}</TableCell>
                      <TableCell>{l.vehicles?.name || l.vehicles?.license_plate || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(l.start_km).toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(l.end_km).toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{Math.max(0, Number(l.end_km) - Number(l.start_km)).toLocaleString()} km</TableCell>
                      <TableCell className="text-right tabular-nums">{l.fuel_litres ? `${l.fuel_litres}L` : "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{l.fuel_cost ? formatCurrency(Number(l.fuel_cost)) : "—"}</TableCell>
                      <TableCell className="max-w-[100px] truncate text-muted-foreground">{l.notes || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── DOCUMENTS (WINDOWS FILE EXPLORER EXPERIENCE) ───

function cleanDisplayName(name: string, displayName?: string | null): string {
  // If name was updated to a human-friendly name (not a UUID), use name!
  if (name && !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}/.test(name)) {
    let cleaned = name.replace(/^\d{10,14}[-_]/, "");
    cleaned = cleaned.replace(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[-_]?/, "");
    return cleaned || name;
  }

  // Fallback to displayName if available and not a raw hash
  const raw = displayName && displayName.trim() ? displayName.trim() : (name || "Documento");
  let cleaned = raw.replace(/^\d{10,14}[-_]/, "");
  cleaned = cleaned.replace(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}[-_]?/, "");

  if (/^[0-9a-fA-F-]{20,}/.test(cleaned) || /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}/.test(cleaned)) {
    const ext = cleaned.includes(".") ? cleaned.slice(cleaned.lastIndexOf(".")) : "";
    return `Doc_${cleaned.slice(0, 8)}${ext}`;
  }

  return cleaned || raw;
}

function getFileExtension(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

function formatFileSize(bytes?: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderItemIcon(type: string, mime?: string | null, name: string = "", isGrid: boolean = false) {
  const sizeClass = isGrid ? "h-12 w-12" : "h-4 w-4";
  if (type === "folder") {
    return <Folder className={`${sizeClass} text-amber-500 fill-amber-500/20 shrink-0`} />;
  }
  const ext = getFileExtension(name);
  if (mime?.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif", "svg"].includes(ext)) {
    return <ImageIcon className={`${sizeClass} text-sky-500 shrink-0`} />;
  }
  if (mime === "application/pdf" || ext === "pdf") {
    return <FileText className={`${sizeClass} text-rose-500 shrink-0`} />;
  }
  if (["xls", "xlsx", "csv"].includes(ext)) {
    return <FileSpreadsheet className={`${sizeClass} text-emerald-500 shrink-0`} />;
  }
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
    return <FileArchive className={`${sizeClass} text-amber-600 shrink-0`} />;
  }
  return <File className={`${sizeClass} text-muted-foreground shrink-0`} />;
}

export function Documents() {
  const { t, formatDate } = useLanguage();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { workspaceName } = useWorkspace();
  const [parentId, setParentId] = useState<string | null>(null);
  const [path, setPath] = useState<{ id: string | null; name: string }[]>([{ id: null, name: t("common.root") }]);
  const [history, setHistory] = useState<{ id: string | null; name: string }[]>([{ id: null, name: t("common.root") }]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const [viewMode, setViewMode] = useState<"grid" | "details">(() => {
    try {
      return (localStorage.getItem("operix_doc_view_mode") as "grid" | "details") || "grid";
    } catch {
      return "grid";
    }
  });

  const [searchTerm, setSearchTerm] = useState("");
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const navigate = useNavigate();
  const { people = [] } = usePeople();
  const { data: clients = [] } = useClients();

  const [folderName, setFolderName] = useState("");
  const [showFolderDialog, setShowFolderDialog] = useState(false);
  const [folderDialogTab, setFolderDialogTab] = useState<"normal" | "country">("normal");
  const [selectedCountry, setSelectedCountry] = useState<string>("Bélgica");
  const [countryTargetType, setCountryTargetType] = useState<"person" | "client">("person");
  const [selectedPersonId, setSelectedPersonId] = useState<string>("");
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [countryFolderName, setCountryFolderName] = useState<string>("");
  const [isCreatingCountryFolder, setIsCreatingCountryFolder] = useState<boolean>(false);

  const { requirements: countryReqs = [] } = useCountryDocumentRequirements(selectedCountry);

  const DEFAULT_REQUIREMENTS: Record<string, string[]> = {
    "Bélgica": [
      "Documento de Identidade Oficial / Passaporte",
      "Declaração Limosa / Documento A1 (Destacamento)",
      "Registo Empresarial / Número de IVA (BCE / KBO)",
      "Seguro de Responsabilidade Civil Profissional",
      "Certificação Técnica PDR",
      "Carta de Condução",
    ],
    "França": [
      "Pièce d'Identité / Titre de Séjour / Passeport",
      "Extrait Kbis / Attestation URSSAF / SIRET",
      "Assurance Responsabilité Civile Professionnelle (RC Pro)",
      "Attestation A1 (si détachement européen)",
      "Certificação Técnica PDR",
      "Permis de Conduire",
    ],
    "Espanha": [
      "Documento de Identidade (DNI / NIE / Passaporte)",
      "Certificado de Alta no RETA / IAE / CIF",
      "Seguro de Responsabilidade Civil",
      "Certificado de Estar al Corriente con Seguridad Social",
      "Certificação Técnica PDR / Automóvel",
      "Carta de Condução",
    ],
    "Portugal": [
      "Documento de Identificação (CC / Passaporte)",
      "Comprovativo de Início de Atividade / Certidão Permanente",
      "Seguro de Acidentes de Trabalho / RC",
      "Comprovativo de Morada / Domicílio Fiscal",
      "Certificação Técnica PDR / Automóvel",
      "Carta de Condução",
    ],
    "Alemanha": [
      "Personalausweis / Reisepass (Identificação Oficial)",
      "Gewerbeanmeldung (Registo Comercial)",
      "Betriebshaftpflichtversicherung (Seguro RC)",
      "Freistellungsbescheinigung (Certificado Fiscal)",
      "Certificação Técnica PDR",
      "Führerschein (Carta de Condução)",
    ],
    "Brasil": [
      "Documento de Identidade Oficial (RG / CNH) e CPF",
      "Comprovante de CNPJ / MEI / Contrato Social",
      "Comprovante de Residência Atualizado",
      "Certificado de Formação / Qualificação Técnica PDR",
      "Carteira Nacional de Habilitação (CNH)",
    ],
    "Luxemburgo": [
      "Document d'Identité / Passeport",
      "Autorisation d'Établissement / TVA",
      "Assurance Responsabilité Civile",
      "Certificat A1 / Détachement",
    ],
    "default": [
      "Documento Oficial de Identificação / Passaporte",
      "Comprovativo de Registo Fiscal e Empresarial",
      "Seguro de Responsabilidade Civil Profissional",
      "Comprovativo de Morada / Domicílio",
      "Certificação Técnica / Qualificação PDR",
      "Carta / Licença de Condução",
    ],
  };

  const activeDocReqs: { id: string | null; name: string }[] = useMemo(() => {
    if (countryReqs && countryReqs.length > 0) {
      return countryReqs.filter((r: any) => r.active).map((r: any) => ({ id: r.id, name: r.document_name }));
    }
    const fallback = DEFAULT_REQUIREMENTS[selectedCountry] || DEFAULT_REQUIREMENTS["default"];
    return fallback.map((name) => ({ id: null, name }));
  }, [countryReqs, selectedCountry]);

  const updateSuggestedCountryFolderName = (country: string, type: "person" | "client", personId: string, clientId: string) => {
    let targetName = "";
    if (type === "person" && personId) {
      const p = people.find((x: any) => x.id === personId);
      if (p) targetName = p.full_name;
    } else if (type === "client" && clientId) {
      const c = clients.find((x: any) => x.id === clientId);
      if (c) targetName = c.name || (c as any).trade_name || "";
    }
    if (targetName) {
      setCountryFolderName(`${country} - ${targetName}`);
    } else {
      setCountryFolderName(country);
    }
  };

  const handleCountryChange = (c: string) => {
    setSelectedCountry(c);
    updateSuggestedCountryFolderName(c, countryTargetType, selectedPersonId, selectedClientId);
  };

  const handleTargetTypeChange = (type: "person" | "client") => {
    setCountryTargetType(type);
    setSelectedPersonId("");
    setSelectedClientId("");
    updateSuggestedCountryFolderName(selectedCountry, type, "", "");
  };

  const handlePersonSelect = (pId: string) => {
    setSelectedPersonId(pId);
    updateSuggestedCountryFolderName(selectedCountry, "person", pId, "");
  };

  const handleClientSelect = (cId: string) => {
    setSelectedClientId(cId);
    updateSuggestedCountryFolderName(selectedCountry, "client", "", cId);
  };

  const handleCreateCountryFolder = async () => {
    if (!countryFolderName.trim()) return;
    setIsCreatingCountryFolder(true);
    try {
      const parentDoc = await apiRequest<{ id: string }>("/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: countryFolderName.trim(),
          type: "folder",
          parent_id: parentId,
          entity_type: "documents",
          module: "global",
        }),
      });

      for (const req of activeDocReqs) {
        await apiRequest("/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: req.name,
            type: "folder",
            parent_id: parentDoc.id,
            country_requirement_id: req.id || null,
            entity_type: "documents",
            module: "global",
          }),
        });
      }

      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["doc-folders-all"] });
      setShowFolderDialog(false);
      setFolderName("");
      setCountryFolderName("");
      setSelectedPersonId("");
      setSelectedClientId("");
      toast.success(`Pasta criada com ${activeDocReqs.length} requisitos de compliance!`);
      navigateTo(parentDoc.id, countryFolderName.trim());
    } catch (err: any) {
      console.error(err);
      toast.error(err?.message || "Erro ao criar pasta de documentos por país.");
    } finally {
      setIsCreatingCountryFolder(false);
    }
  };

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [moveTarget, setMoveTarget] = useState<any>(null);
  const [moveDestination, setMoveDestination] = useState<string>("__root__");
  const [newFolderInMove, setNewFolderInMove] = useState("");
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const { data: docs = [], isLoading, isRefetching } = useQuery({
    queryKey: ["documents", parentId],
    queryFn: async () => {
      const url = `/documents?entity_type=documents&module=global${parentId ? `&parent_id=${parentId}` : "&parent_id=null"}`;
      return await apiRequest<any[]>(url);
    },
  });

  const { data: allFolders = [] } = useQuery({
    queryKey: ["doc-folders-all"],
    queryFn: async () => {
      return await apiRequest<any[]>("/documents/folders?entity_type=documents");
    },
  });

  const changeViewMode = (mode: "grid" | "details") => {
    setViewMode(mode);
    try {
      localStorage.setItem("operix_doc_view_mode", mode);
    } catch {}
  };

  const filteredDocs = docs.filter((d: any) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    const friendly = cleanDisplayName(d.name, d.display_name).toLowerCase();
    const raw = (d.name || "").toLowerCase();
    return friendly.includes(term) || raw.includes(term);
  });

  const allSelected = filteredDocs.length > 0 && filteredDocs.every((d: any) => selectedIds.has(d.id));

  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredDocs.map((d: any) => d.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const navigateTo = (id: string | null, name: string, pushToHistory = true) => {
    clearSelection();
    setParentId(id);

    if (id === null) {
      setPath([{ id: null, name: t("common.root") }]);
    } else {
      const idx = path.findIndex((p) => p.id === id);
      if (idx >= 0) {
        setPath(path.slice(0, idx + 1));
      } else {
        setPath([...path, { id, name }]);
      }
    }

    if (pushToHistory) {
      const newHist = history.slice(0, historyIndex + 1);
      newHist.push({ id, name });
      setHistory(newHist);
      setHistoryIndex(newHist.length - 1);
    }
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const nextIdx = historyIndex - 1;
      const target = history[nextIdx];
      setHistoryIndex(nextIdx);
      navigateTo(target.id, target.name, false);
    }
  };

  const goForward = () => {
    if (historyIndex < history.length - 1) {
      const nextIdx = historyIndex + 1;
      const target = history[nextIdx];
      setHistoryIndex(nextIdx);
      navigateTo(target.id, target.name, false);
    }
  };

  const goUp = () => {
    if (path.length > 1) {
      const target = path[path.length - 2];
      navigateTo(target.id, target.name);
    } else if (parentId !== null) {
      navigateTo(null, t("common.root"));
    }
  };

  const refreshCurrent = () => {
    queryClient.invalidateQueries({ queryKey: ["documents", parentId] });
    queryClient.invalidateQueries({ queryKey: ["doc-folders-all"] });
    toast.success("Pasta atualizada");
  };

  const createFolder = useMutation({
    mutationFn: async () => {
      await apiRequest("/documents", {
        method: "POST",
        body: JSON.stringify({
          name: folderName,
          type: "folder",
          parent_id: parentId,
          entity_type: "documents",
          module: "global",
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["doc-folders-all"] });
      setShowFolderDialog(false);
      setFolderName("");
      toast.success(t("docs.folderCreated"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (doc: any) => {
      if (doc.storage_path) {
        await deleteFiles("uploads", [doc.storage_path]);
      }
      await apiRequest(`/documents/${doc.id}`, { method: "DELETE" });
    },
    onSuccess: (_, doc) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["doc-folders-all"] });
      if (parentId === doc?.id) {
        navigateTo(null, t("common.root"));
      }
      toast.success(t("toast.deleted"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const docsToDelete = docs.filter((d: any) => ids.includes(d.id));
      const storagePaths = docsToDelete.filter((d: any) => d.storage_path).map((d: any) => d.storage_path);
      if (storagePaths.length > 0) await deleteFiles("uploads", storagePaths);
      await apiRequest("/documents/batch", {
        method: "DELETE",
        body: JSON.stringify({ ids }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["doc-folders-all"] });
      clearSelection();
      toast.success(t("toast.deleted"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const moveMutation = useMutation({
    mutationFn: async ({ docIds, newParentId }: { docIds: string[]; newParentId: string | null }) => {
      await Promise.all(
        docIds.map((id) =>
          apiRequest(`/documents/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ parent_id: newParentId }),
          }),
        ),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["doc-folders-all"] });
      setShowMoveDialog(false);
      setMoveTarget(null);
      clearSelection();
      toast.success(t("toast.updated"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const createFolderInMove = useMutation({
    mutationFn: async (name: string) => {
      const created = await apiRequest<{ id: string }>("/documents", {
        method: "POST",
        body: JSON.stringify({
          name,
          type: "folder",
          parent_id: null,
          entity_type: "documents",
          module: "global",
        }),
      });
      return created.id;
    },
    onSuccess: (id) => {
      queryClient.invalidateQueries({ queryKey: ["doc-folders-all"] });
      setMoveDestination(id);
      setNewFolderInMove("");
      toast.success(t("docs.folderCreated"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      await apiRequest(`/documents/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, display_name: name }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["doc-folders-all"] });
      setRenamingId(null);
      toast.success(t("toast.updated"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const uploadFile = async (file: File) => {
    setIsUploading(true);
    try {
      const safeName = (file.name || "document").replace(/[^\w.\-()]+/g, "_").slice(0, 160);
      const storagePath = `documents/${Date.now()}_${safeName}`;
      await withPromiseTimeout<any>(
        storageUpload("uploads", storagePath, file, file.type || undefined),
        30000,
        "documents_global_upload",
      );
      await apiRequest("/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: safeName,
          type: "file",
          parent_id: parentId,
          storage_path: storagePath,
          mime_type: file.type,
          size_bytes: file.size,
          entity_type: "documents",
          module: "global",
        }),
      });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success(t("docs.fileUploaded"));
    } catch (err) {
      console.error("[uploadFile]", err);
      toast.error(err instanceof Error ? err.message : "Falha no upload.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownload = (doc: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!doc.storage_path) return;
    void openSecureStorageFile("uploads", doc.storage_path, doc.name);
  };

  const handlePreview = (doc: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!doc.storage_path) return;
    void openSecureStorageFile("uploads", doc.storage_path, doc.name);
  };

  const handlePrint = (doc: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!doc.storage_path) return;
    const w = window.open(getFileUrl("uploads", doc.storage_path), "_blank");
    w?.addEventListener("load", () => w.print());
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;

    toast.info(`Fazendo upload de ${files.length} arquivo(s)...`);
    for (const file of files) {
      await uploadFile(file);
    }
  };

  const selectedArray = Array.from(selectedIds);
  const isBulkMode = selectedArray.length > 0;
  const totalSelectedBytes = docs
    .filter((d: any) => selectedIds.has(d.id) && d.size_bytes)
    .reduce((acc: number, cur: any) => acc + (cur.size_bytes || 0), 0);

  const openBulkMove = () => {
    setMoveTarget(null);
    setMoveDestination("__root__");
    setNewFolderInMove("");
    setShowMoveDialog(true);
  };

  return (
    <div className="space-y-4 animate-fade-in flex flex-col h-[calc(100vh-8.5rem)] min-h-[580px]">
      {/* ─── WINDOWS EXPLORER TOP COMMAND BAR ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20">
            <FolderOpen className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-foreground tracking-tight flex items-center gap-2">
              {t("docs.title")}
              <Badge variant="outline" className="text-[10px] font-normal uppercase py-0 px-1.5 h-4 text-muted-foreground border-border/60">
                Explorer
              </Badge>
            </h1>
            <p className="text-[11px] text-muted-foreground leading-none">{t("docs.subtitle")}</p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1.5 ml-auto">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs font-medium gap-1.5 border-border/80 shadow-xs hidden sm:flex text-muted-foreground hover:text-foreground"
            onClick={() => navigate("/country-document-requirements")}
            title="Configurar Exigências de Documentos por País"
          >
            <FileCheck2 className="h-3.5 w-3.5 text-blue-500" />
            <span className="hidden md:inline">Exigências por País</span>
          </Button>

          <Dialog open={showFolderDialog} onOpenChange={setShowFolderDialog}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 text-xs font-medium gap-1.5 border-border/80 shadow-xs">
                <FolderPlus className="h-3.5 w-3.5 text-amber-500" />
                {t("docs.newFolder")}
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border sm:max-w-lg">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
                  <FolderPlus className="h-4 w-4 text-primary" />
                  {t("docs.createFolder")}
                </DialogTitle>
              </DialogHeader>

              <Tabs value={folderDialogTab} onValueChange={(v) => setFolderDialogTab(v as "normal" | "country")} className="pt-1">
                <TabsList className="grid grid-cols-2 mb-3 h-8 bg-muted/60 p-0.5">
                  <TabsTrigger value="normal" className="flex items-center gap-1.5 text-xs py-1">
                    <Folder className="h-3.5 w-3.5 text-amber-500" />
                    Pasta Normal
                  </TabsTrigger>
                  <TabsTrigger value="country" className="flex items-center gap-1.5 text-xs py-1">
                    <Globe className="h-3.5 w-3.5 text-blue-500" />
                    Documento por País
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="normal" className="space-y-4 pt-1">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t("label.name")}</Label>
                    <Input
                      value={folderName}
                      onChange={(e) => setFolderName(e.target.value)}
                      placeholder="Ex: Contratos, Relatórios Gerais..."
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && folderName.trim()) createFolder.mutate();
                      }}
                    />
                  </div>
                  <Button className="w-full" onClick={() => createFolder.mutate()} disabled={!folderName.trim() || createFolder.isPending}>
                    {createFolder.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : t("action.save")}
                  </Button>
                </TabsContent>

                <TabsContent value="country" className="space-y-3.5 pt-1">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {/* Seleção do País */}
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">País de Atuação</Label>
                      <Select value={selectedCountry} onValueChange={handleCountryChange}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Selecione o país..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Bélgica">🇧🇪 Bélgica</SelectItem>
                          <SelectItem value="França">🇫🇷 França</SelectItem>
                          <SelectItem value="Espanha">🇪🇸 Espanha</SelectItem>
                          <SelectItem value="Portugal">🇵🇹 Portugal</SelectItem>
                          <SelectItem value="Alemanha">🇩🇪 Alemanha</SelectItem>
                          <SelectItem value="Brasil">🇧🇷 Brasil</SelectItem>
                          <SelectItem value="Luxemburgo">🇱🇺 Luxemburgo</SelectItem>
                          <SelectItem value="Holanda">🇳🇱 Holanda</SelectItem>
                          <SelectItem value="Itália">🇮🇹 Itália</SelectItem>
                          <SelectItem value="Suíça">🇨🇭 Suíça</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Vínculo (Colaborador ou Cliente) */}
                    <div className="space-y-1">
                      <Label className="text-xs font-medium">Vincular a</Label>
                      <Select value={countryTargetType} onValueChange={(v: "person" | "client") => handleTargetTypeChange(v)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="person">
                            <span className="flex items-center gap-1.5">
                              <User className="h-3 w-3 text-primary" /> Colaborador
                            </span>
                          </SelectItem>
                          <SelectItem value="client">
                            <span className="flex items-center gap-1.5">
                              <Building2 className="h-3 w-3 text-emerald-500" /> Cliente
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Seleção da Entidade */}
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">
                      {countryTargetType === "person" ? "Colaborador Cadastrado" : "Cliente Cadastrado"}
                    </Label>
                    {countryTargetType === "person" ? (
                      <Select value={selectedPersonId} onValueChange={handlePersonSelect}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Selecione o colaborador..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-56">
                          {people.map((p: any) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.full_name} {p.person_type ? `(${p.person_type})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Select value={selectedClientId} onValueChange={handleClientSelect}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Selecione o cliente..." />
                        </SelectTrigger>
                        <SelectContent className="max-h-56">
                          {clients.map((c: any) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name || c.trade_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {/* Nome da Pasta Principal */}
                  <div className="space-y-1">
                    <Label className="text-xs font-medium">Nome da Pasta</Label>
                    <Input
                      value={countryFolderName}
                      onChange={(e) => setCountryFolderName(e.target.value)}
                      placeholder={`Ex: ${selectedCountry} - Nome`}
                      className="h-8 text-xs font-medium"
                    />
                  </div>

                  {/* Subpastas que serão criadas */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] font-medium text-muted-foreground">
                        Subpastas de Compliance para Upload ({activeDocReqs.length})
                      </Label>
                      <span className="text-[10px] text-primary font-medium">Geração Automática</span>
                    </div>
                    <div className="rounded-md border border-border/70 bg-muted/20 p-2 max-h-32 overflow-y-auto space-y-1 text-xs">
                      {activeDocReqs.map((req, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-foreground/80 py-0.5">
                          <Folder className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                          <span className="truncate">{req.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Button
                    className="w-full gap-2"
                    disabled={!countryFolderName.trim() || isCreatingCountryFolder}
                    onClick={handleCreateCountryFolder}
                  >
                    {isCreatingCountryFolder ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4 text-amber-300" />
                    )}
                    Criar Pasta e Estrutura de Documentos
                  </Button>
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>

          <Button size="sm" className="h-8 text-xs font-medium gap-1.5 shadow-xs" disabled={isUploading} asChild>
            <label className="cursor-pointer">
              {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {isUploading ? "Enviando..." : t("action.upload")}
              <input
                type="file"
                multiple
                className="hidden"
                onChange={async (e) => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = "";
                  for (const f of files) await uploadFile(f);
                }}
              />
            </label>
          </Button>

          {/* View Mode Switcher */}
          <div className="flex items-center rounded-md border border-border/70 p-0.5 bg-muted/40 ml-1">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7 rounded-sm"
              onClick={() => changeViewMode("grid")}
              title="Ícones Grandes (Grade)"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={viewMode === "details" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7 rounded-sm"
              onClick={() => changeViewMode("details")}
              title="Detalhes (Lista)"
            >
              <List className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* ─── WINDOWS EXPLORER NAVIGATION & ADDRESS BAR ─── */}
      <div className="flex flex-wrap items-center gap-2 bg-card/60 border border-border/70 rounded-md p-1.5 shadow-xs">
        {/* Navigation Buttons (Back / Forward / Up / Refresh) */}
        <div className="flex items-center gap-0.5 border-r border-border/60 pr-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-30"
            disabled={historyIndex <= 0}
            onClick={goBack}
            title="Voltar (Alt + Esquerda)"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-30"
            disabled={historyIndex >= history.length - 1}
            onClick={goForward}
            title="Avançar (Alt + Direita)"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-30"
            disabled={parentId === null}
            onClick={goUp}
            title="Subir um nível (Alt + Cima)"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-sm text-muted-foreground hover:text-foreground"
            onClick={refreshCurrent}
            title="Atualizar (F5)"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin text-primary" : ""}`} />
          </Button>
        </div>

        {/* Address Bar (Breadcrumb) */}
        <div className="flex-1 min-w-[220px] flex items-center gap-1 px-2.5 py-1 bg-background/80 border border-border/70 rounded text-xs text-muted-foreground overflow-x-auto scrollbar-none">
          <HardDrive className="h-3.5 w-3.5 text-primary shrink-0 mr-1" />
          {path.map((p, i) => (
            <span key={i} className="flex items-center gap-1 shrink-0">
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/60 shrink-0" />}
              <button
                onClick={() => navigateTo(p.id, p.name)}
                className={`px-1.5 py-0.5 rounded hover:bg-muted/60 transition-colors font-medium truncate max-w-[160px] ${
                  i === path.length - 1 ? "text-foreground bg-primary/10" : "hover:text-foreground"
                }`}
              >
                {p.name}
              </button>
            </span>
          ))}
        </div>

        {/* Search Bar */}
        <div className="relative w-full sm:w-64">
          <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={`Pesquisar em ${path[path.length - 1]?.name || "Documentos"}...`}
            className="h-7 text-xs pl-8 pr-7 bg-background/80 border-border/70 focus-visible:ring-1"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* ─── BULK SELECTION ACTION BAR ─── */}
      {isBulkMode && (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs animate-in fade-in slide-in-from-top-1">
          <CheckSquare className="h-4 w-4 text-primary shrink-0" />
          <span className="font-semibold text-foreground">
            {selectedArray.length} {t("fm.selected")}
          </span>
          <span className="text-muted-foreground text-[11px]">({formatFileSize(totalSelectedBytes)})</span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1 bg-card/80" onClick={openBulkMove}>
              <MoveRight className="h-3 w-3" />
              {t("fm.move")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] text-destructive border-destructive/40 bg-card/80 hover:bg-destructive/10"
              onClick={() => bulkDeleteMutation.mutate(selectedArray)}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              {t("action.delete")}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={clearSelection}>
              {t("action.cancel")}
            </Button>
          </div>
        </div>
      )}

      {/* ─── MAIN EXPLORER WORKSPACE (SIDEBAR + CONTENT) ─── */}
      <div className="flex-1 flex gap-3 min-h-0 overflow-hidden">
        {/* Left Navigation Pane (Windows Explorer Acesso Rápido) */}
        <aside className="hidden md:flex flex-col w-52 shrink-0 border border-border/60 bg-card/40 rounded-lg p-2.5 text-xs overflow-y-auto">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 px-2 mb-1.5">
            Acesso Rápido
          </div>
          <button
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("application/operix-doc")) {
                e.preventDefault();
                e.stopPropagation();
                setDragOverFolderId("__root__");
              }
            }}
            onDragLeave={(e) => {
              e.stopPropagation();
              if (dragOverFolderId === "__root__") setDragOverFolderId(null);
            }}
            onDrop={(e) => {
              if (e.dataTransfer.types.includes("application/operix-doc")) {
                e.preventDefault();
                e.stopPropagation();
                setDragOverFolderId(null);
                try {
                  const payload = JSON.parse(e.dataTransfer.getData("application/operix-doc"));
                  if (payload?.id && parentId !== null) {
                    moveMutation.mutate({ docIds: [payload.id], newParentId: null });
                  }
                } catch (err) {
                  console.error(err);
                }
              }
            }}
            onClick={() => navigateTo(null, t("common.root"))}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-all font-medium ${
              dragOverFolderId === "__root__"
                ? "ring-2 ring-primary bg-primary/25 text-primary scale-[1.02]"
                : parentId === null
                ? "bg-primary/15 text-primary"
                : "text-foreground/80 hover:bg-muted/50"
            }`}
          >
            <HardDrive className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="truncate">{workspaceName || "Este Workspace"}</span>
          </button>

          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 px-2 mt-4 mb-1.5">
            Pastas Principais
          </div>
          <div className="space-y-0.5">
            {allFolders
              .filter((f: any) => !f.parent_id)
              .map((f: any) => (
                <div
                  key={f.id}
                  onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("application/operix-doc")) {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverFolderId(f.id);
                    }
                  }}
                  onDragLeave={(e) => {
                    e.stopPropagation();
                    if (dragOverFolderId === f.id) setDragOverFolderId(null);
                  }}
                  onDrop={(e) => {
                    if (e.dataTransfer.types.includes("application/operix-doc")) {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverFolderId(null);
                      try {
                        const payload = JSON.parse(e.dataTransfer.getData("application/operix-doc"));
                        if (payload?.id && payload.id !== f.id) {
                          moveMutation.mutate({ docIds: [payload.id], newParentId: f.id });
                        }
                      } catch (err) {
                        console.error(err);
                      }
                    }
                  }}
                  className={`group flex items-center justify-between px-2 py-1.5 rounded-md text-left transition-all ${
                    dragOverFolderId === f.id
                      ? "ring-2 ring-primary bg-primary/25 text-primary scale-[1.02]"
                      : parentId === f.id
                      ? "bg-primary/15 text-primary font-medium"
                      : "text-foreground/80 hover:bg-muted/50"
                  }`}
                >
                  <button
                    onClick={() => navigateTo(f.id, f.name)}
                    className="flex items-center gap-2 flex-1 min-w-0"
                  >
                    <Folder className="h-3.5 w-3.5 text-amber-500 fill-amber-500/20 shrink-0" />
                    <span className="truncate">{cleanDisplayName(f.name, f.display_name)}</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMutation.mutate(f);
                    }}
                    title={t("action.delete")}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            {allFolders.filter((f: any) => !f.parent_id).length === 0 && (
              <p className="px-2 py-1 text-[11px] text-muted-foreground italic">Nenhuma subpasta</p>
            )}
          </div>
        </aside>

        {/* Right Main Container (Drag & Drop Zone + Views) */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!isDraggingOver) setIsDraggingOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDraggingOver(false);
          }}
          onDrop={handleDrop}
          className={`flex-1 flex flex-col rounded-lg border border-border/60 bg-card/20 relative overflow-hidden transition-all ${
            isDraggingOver ? "border-primary ring-2 ring-primary/20 bg-primary/5" : ""
          }`}
        >
          {/* Drag Overlay */}
          {isDraggingOver && (
            <div className="absolute inset-0 z-50 bg-background/85 backdrop-blur-xs flex flex-col items-center justify-center gap-2 border-2 border-dashed border-primary rounded-lg pointer-events-none">
              <UploadCloud className="h-12 w-12 text-primary animate-bounce" />
              <p className="text-sm font-semibold text-primary">Solte os arquivos aqui para fazer upload</p>
              <p className="text-xs text-muted-foreground">Destino: {path[path.length - 1]?.name || "Raiz"}</p>
            </div>
          )}

          {/* Content Area */}
          <div className="flex-1 overflow-auto p-3">
            {isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <Skeleton key={i} className="h-28 w-full rounded-lg" />
                ))}
              </div>
            ) : filteredDocs.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                <FolderOpen className="h-12 w-12 text-muted-foreground/30 mb-3" />
                <p className="text-sm font-medium text-foreground">Esta pasta está vazia</p>
                <p className="text-xs mt-1 max-w-sm">
                  {searchTerm ? "Nenhum documento encontrado com o filtro atual." : "Arraste e solte arquivos aqui direto do seu computador ou use o botão 'Enviar'."}
                </p>
              </div>
            ) : viewMode === "grid" ? (
              /* ─── GRID VIEW (WINDOWS TILES / ICONS) ─── */
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 gap-2.5">
                {filteredDocs.map((d: any) => {
                  const isSelected = selectedIds.has(d.id);
                  const friendly = cleanDisplayName(d.name, d.display_name);
                  const isFolder = d.type === "folder";

                  return (
                    <div
                      key={d.id}
                      draggable={renamingId !== d.id}
                      onDragStart={(e) => {
                        e.dataTransfer.setData("application/operix-doc", JSON.stringify({ id: d.id, name: d.name, type: d.type }));
                      }}
                      onDragOver={(e) => {
                        if (isFolder && e.dataTransfer.types.includes("application/operix-doc")) {
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOverFolderId(d.id);
                        }
                      }}
                      onDragLeave={(e) => {
                        e.stopPropagation();
                        if (dragOverFolderId === d.id) setDragOverFolderId(null);
                      }}
                      onDrop={(e) => {
                        if (isFolder && e.dataTransfer.types.includes("application/operix-doc")) {
                          e.preventDefault();
                          e.stopPropagation();
                          setDragOverFolderId(null);
                          try {
                            const payload = JSON.parse(e.dataTransfer.getData("application/operix-doc"));
                            if (payload?.id && payload.id !== d.id) {
                              moveMutation.mutate({ docIds: [payload.id], newParentId: d.id });
                            }
                          } catch (err) {
                            console.error(err);
                          }
                        }
                      }}
                      onClick={(e) => toggleSelect(d.id, e)}
                      onDoubleClick={() => {
                        if (isFolder) navigateTo(d.id, d.name);
                        else handlePreview(d);
                      }}
                      className={`group relative flex flex-col items-center justify-between p-2.5 rounded-lg border text-center transition-all cursor-pointer select-none ${
                        dragOverFolderId === d.id
                          ? "ring-2 ring-primary bg-primary/20 scale-105 border-primary shadow-md"
                          : isSelected
                          ? "bg-primary/10 border-primary shadow-xs ring-1 ring-primary/40"
                          : "border-border/60 hover:bg-muted/40 hover:border-border"
                      }`}
                    >
                      {/* Checkbox (visible on hover or when selected) */}
                      <div
                        className={`absolute top-1.5 left-1.5 transition-opacity ${
                          isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        }`}
                        onClick={(e) => toggleSelect(d.id, e)}
                      >
                        <Checkbox checked={isSelected} />
                      </div>

                      {/* Icon or Thumbnail */}
                      <div className="w-full h-16 flex items-center justify-center my-1">
                        {renderItemIcon(d.type, d.mime_type, d.name, true)}
                      </div>

                      {/* Title & Info */}
                      <div className="w-full space-y-0.5 mt-1">
                        {renamingId === d.id ? (
                          <form
                            className="flex items-center gap-1"
                            onClick={(e) => e.stopPropagation()}
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (renameValue.trim()) renameMutation.mutate({ id: d.id, name: renameValue.trim() });
                            }}
                          >
                            <Input
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              className="h-6 text-xs text-center"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                            />
                            <Button type="submit" variant="ghost" size="icon" className="h-5 w-5 shrink-0" disabled={!renameValue.trim()}>
                              <Check className="h-3 w-3 text-primary" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => setRenamingId(null)}>
                              <X className="h-3 w-3" />
                            </Button>
                          </form>
                        ) : (
                          <p
                            className="text-xs font-medium text-foreground truncate px-1"
                            title={`${friendly} (${d.name})`}
                          >
                            {friendly}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          {isFolder ? t("common.folder") : formatFileSize(d.size_bytes)}
                        </p>
                      </div>

                      {/* Actions Quickbar */}
                      <div
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-0.5 pt-1.5 mt-1 border-t border-border/40 w-full"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {!isFolder && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-foreground"
                              onClick={(e) => handlePreview(d, e)}
                              title={t("fm.preview")}
                            >
                              <Eye className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-muted-foreground hover:text-foreground"
                              onClick={(e) => handleDownload(d, e)}
                              title={t("fm.download")}
                            >
                              <Download className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMoveTarget(d);
                            setMoveDestination("__root__");
                            setShowMoveDialog(true);
                          }}
                          title={t("fm.move")}
                        >
                          <MoveRight className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingId(d.id);
                            setRenameValue(cleanDisplayName(d.name, d.display_name));
                          }}
                          title={t("fm.rename")}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteMutation.mutate(d);
                          }}
                          title={t("action.delete")}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* ─── DETAILS VIEW (WINDOWS LIST / TABLE) ─── */
              <div className="rounded-md border border-border/60 overflow-hidden bg-card/40">
                <Table>
                  <TableHeader>
                    <TableRow className="text-[11px] bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-8 pl-3">
                        <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label={t("fm.selectAll")} />
                      </TableHead>
                      <TableHead>{t("label.name")}</TableHead>
                      <TableHead className="w-28">{t("label.type")}</TableHead>
                      <TableHead className="w-24">{t("docs.size")}</TableHead>
                      <TableHead className="w-32">{t("label.date")}</TableHead>
                      <TableHead className="w-32 text-right pr-3">{t("label.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredDocs.map((d: any) => {
                      const isSelected = selectedIds.has(d.id);
                      const friendly = cleanDisplayName(d.name, d.display_name);
                      const isFolder = d.type === "folder";

                      return (
                        <TableRow
                          key={d.id}
                          onClick={() => toggleSelect(d.id)}
                          onDoubleClick={() => {
                            if (isFolder) navigateTo(d.id, d.name);
                            else handlePreview(d);
                          }}
                          className={`text-xs cursor-pointer select-none transition-colors ${
                            isSelected ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-muted/30"
                          }`}
                        >
                          <TableCell className="w-8 pl-3" onClick={(e) => toggleSelect(d.id, e)}>
                            <Checkbox checked={isSelected} />
                          </TableCell>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              {renderItemIcon(d.type, d.mime_type, d.name, false)}
                              {renamingId === d.id ? (
                                <form
                                  className="flex items-center gap-1"
                                  onClick={(e) => e.stopPropagation()}
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    if (renameValue.trim()) renameMutation.mutate({ id: d.id, name: renameValue.trim() });
                                  }}
                                >
                                  <Input
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    className="h-6 text-xs w-[200px]"
                                    autoFocus
                                    onKeyDown={(e) => {
                                      if (e.key === "Escape") setRenamingId(null);
                                    }}
                                  />
                                  <Button type="submit" variant="ghost" size="icon" className="h-5 w-5" disabled={!renameValue.trim()}>
                                    <Check className="h-3 w-3 text-primary" />
                                  </Button>
                                  <Button type="button" variant="ghost" size="icon" className="h-5 w-5" onClick={() => setRenamingId(null)}>
                                    <X className="h-3 w-3" />
                                  </Button>
                                </form>
                              ) : (
                                <span className="truncate max-w-[280px]" title={`${friendly} (${d.name})`}>
                                  {friendly}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px] font-normal py-0">
                              {isFolder ? t("common.folder") : getFileExtension(d.name).toUpperCase() || t("common.file")}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">{isFolder ? "—" : formatFileSize(d.size_bytes)}</TableCell>
                          <TableCell className="text-muted-foreground">{formatDate(d.created_at)}</TableCell>
                          <TableCell className="pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              {!isFolder && (
                                <>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => handlePreview(d, e)} title={t("fm.preview")}>
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => handleDownload(d, e)} title={t("fm.download")}>
                                    <Download className="h-3.5 w-3.5" />
                                  </Button>
                                </>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMoveTarget(d);
                                  setMoveDestination("__root__");
                                  setShowMoveDialog(true);
                                }}
                                title={t("fm.move")}
                              >
                                <MoveRight className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRenamingId(d.id);
                                  setRenameValue(cleanDisplayName(d.name, d.display_name));
                                }}
                                title={t("fm.rename")}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteMutation.mutate(d);
                                }}
                                title={t("action.delete")}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* ─── WINDOWS EXPLORER STATUS BAR (FOOTER) ─── */}
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-border/60 bg-muted/20 text-[11px] text-muted-foreground select-none">
            <div className="flex items-center gap-2">
              <span>{filteredDocs.length} {filteredDocs.length === 1 ? "item" : "itens"}</span>
              {selectedArray.length > 0 && (
                <>
                  <span className="text-border">|</span>
                  <span className="text-primary font-medium">
                    {selectedArray.length} {selectedArray.length === 1 ? "selecionado" : "selecionados"}
                    {totalSelectedBytes > 0 && ` (${formatFileSize(totalSelectedBytes)})`}
                  </span>
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider">{viewMode === "grid" ? "Grade" : "Lista Detalhada"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── MOVE DIALOG ─── */}
      <Dialog open={showMoveDialog} onOpenChange={setShowMoveDialog}>
        <DialogContent className="bg-card border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <MoveRight className="h-4 w-4 text-primary" />
              {t("fm.moveTo")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">
              {moveTarget ? (
                <>
                  {t("fm.moveFile")}: <strong>{cleanDisplayName(moveTarget.name, moveTarget.display_name)}</strong>
                </>
              ) : (
                <>{selectedArray.length} {t("fm.selected")}</>
              )}
            </p>
            <Select value={moveDestination} onValueChange={setMoveDestination}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder={t("fm.selectFolder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__root__">{t("common.root")}</SelectItem>
                {allFolders
                  .filter((f: any) => f.id !== moveTarget?.id && !selectedIds.has(f.id))
                  .map((f: any) => (
                    <SelectItem key={f.id} value={f.id}>
                      {cleanDisplayName(f.name, f.display_name)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Input
                value={newFolderInMove}
                onChange={(e) => setNewFolderInMove(e.target.value)}
                placeholder={t("fm.newFolderName")}
                className="h-8 text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs shrink-0"
                disabled={!newFolderInMove.trim()}
                onClick={() => createFolderInMove.mutate(newFolderInMove.trim())}
              >
                <FolderPlus className="h-3 w-3 mr-1" />
                {t("action.add")}
              </Button>
            </div>
            <Button
              className="w-full"
              onClick={() => {
                const ids = moveTarget ? [moveTarget.id] : selectedArray;
                const dest = moveDestination === "__root__" ? null : moveDestination;
                moveMutation.mutate({ docIds: ids, newParentId: dest });
              }}
            >
              {t("fm.move")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── PREVIEW DIALOG ─── */}
      <Dialog open={!!previewDoc} onOpenChange={() => setPreviewDoc(null)}>
        <DialogContent className="bg-card border-border max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="truncate text-sm font-semibold">
              {previewDoc ? cleanDisplayName(previewDoc.name, previewDoc.display_name) : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-auto max-h-[65vh]">
            {previewDoc?.mime_type?.startsWith("image/") ? (
              <img src={previewDoc.url} alt={previewDoc.name} className="max-w-full rounded mx-auto" />
            ) : previewDoc?.mime_type === "application/pdf" ? (
              <iframe src={previewDoc.url} className="w-full h-[60vh] rounded" />
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <a href={previewDoc?.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                  {t("fm.download")}
                </a>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── USERS ───
import { useRole } from "@/hooks/useRole";
import { AddExistingUserPanel } from "@/components/users/AddExistingUserPanel";

export function UsersPage() {
  const { t, formatDate } = useLanguage();
  const { user } = useAuth();
  const { workspaceId, workspaceName } = useWorkspace();
  const queryClient = useQueryClient();
  const { isAdmin, isOwner } = useRole();
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ email: "", full_name: "", role: "technician" });
  const [creating, setCreating] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const roleLabels: Record<string, string> = {
    owner: "Owner",
    admin: t("role.admin", "Admin"),
    technician: "Technicien",
    client: "Client",
    partner: "Associe",
  };

  const { data, isLoading } = useQuery({
    queryKey: ["workspace-users-page", workspaceId],
    enabled: !!workspaceId,
    retry: 0,
    staleTime: 60_000,
    placeholderData: (previousData) => previousData ?? { members: [] as any[] },
    queryFn: async () => {
      if (!workspaceId) {
        return { members: [] as any[] };
      }
      return apiRequest<{ members: any[] }>(`/workspaces/${workspaceId}/members`, { timeoutMs: 10000 });
    },
  });
  const users = data?.members ?? [];

  const updateRoleMutation = useMutation({
    mutationFn: async ({ membershipId, newRole }: { membershipId: string; newRole: string }) => {
      if (!workspaceId) throw new Error("Workspace não selecionado.");
      return apiRequest(`/workspaces/${workspaceId}/members/${membershipId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: newRole }),
        timeoutMs: 10000,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-users-page"] });
      queryClient.invalidateQueries({ queryKey: ["workspace-members"] });
      queryClient.invalidateQueries({ queryKey: ["my-role"] });
      queryClient.invalidateQueries({ queryKey: ["my-permissions"] });
      toast.success(t("toast.updated"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ membershipId, newStatus }: { membershipId: string; newStatus: "active" | "inactive" }) => {
      if (!workspaceId) throw new Error("Workspace não selecionado.");
      return apiRequest(`/workspaces/${workspaceId}/members/${membershipId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: newStatus }),
        timeoutMs: 10000,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspace-users-page"] });
      queryClient.invalidateQueries({ queryKey: ["workspace-members"] });
      toast.success(t("toast.updated"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const handleCreateUser = async () => {
    if (!workspaceId || !createForm.email || !createForm.full_name) return;
    setCreating(true);
    try {
      const data = await apiRequest<{ temp_password: string }>(`/workspaces/${workspaceId}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: createForm.email,
          fullName: createForm.full_name,
          role: createForm.role,
        }),
        timeoutMs: 12000,
      });
      setTempPassword(data.temp_password);
      queryClient.invalidateQueries({ queryKey: ["workspace-users-page"] });
      queryClient.invalidateQueries({ queryKey: ["workspace-members"] });
      queryClient.invalidateQueries({ queryKey: ["my-workspace"] });
      toast.success("Membro criado com sucesso");
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar membro");
    } finally {
      setCreating(false);
    }
  };

  const closeCreateDialog = () => {
    setShowCreate(false);
    setCreateForm({ email: "", full_name: "", role: "technician" });
    setTempPassword(null);
  };

  const formatLastAccess = (value: string | null) => {
    if (!value) return "Nunca";
    return formatDate(value);
  };

  if (!workspaceId) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">{t("users.title")}</h1>
            <p className="text-xs text-muted-foreground">Esta conta ainda não pertence a um workspace.</p>
          </div>
        </div>
        <Card className="border-border/50">
          <CardContent className="py-8 text-sm text-muted-foreground">
            Utilize convites para entrar num workspace existente ou conclua a criação da sua empresa para começar a gerir membros.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">{t("users.title")}</h1>
            <p className="text-xs text-muted-foreground">
              Membros do workspace atual{workspaceName ? ` · ${workspaceName}` : ""}.
            </p>
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 px-3 text-xs font-medium">
                  <Link className="h-3.5 w-3.5 mr-1" />
                  Adicionar existente
                </Button>
              </DialogTrigger>
              <DialogContent className="glass-panel border-border/60 max-w-2xl max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 text-base">
                    <Link className="h-4 w-4 text-primary" />
                    Adicionar usuário existente
                  </DialogTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    Convide uma identidade já existente para entrar neste workspace sem criar outra empresa paralela.
                  </p>
                </DialogHeader>
                <div className="pt-2">
                  <AddExistingUserPanel />
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={showCreate} onOpenChange={(v) => { if (!v) closeCreateDialog(); else setShowCreate(true); }}>
              <DialogTrigger asChild>
                <Button size="sm" className="h-8 px-3 text-xs font-medium">
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Novo membro
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-card border-border">
                <DialogHeader><DialogTitle>Criar membro do workspace</DialogTitle></DialogHeader>
                {tempPassword ? (
                  <div className="space-y-4 pt-2">
                    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
                      <div className="flex items-center gap-2 text-emerald-500">
                        <Check className="h-5 w-5" />
                        <span className="font-medium text-sm">Membro criado com sucesso</span>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Workspace:</p>
                        <code className="text-xs bg-muted/50 px-2 py-1 rounded block">{workspaceName || "Workspace atual"}</code>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Email:</p>
                        <code className="text-xs bg-muted/50 px-2 py-1 rounded block">{createForm.email}</code>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Senha temporária:</p>
                        <div className="flex items-center gap-2">
                          <code className="text-sm bg-muted/50 px-3 py-2 rounded block flex-1 font-mono font-bold">{tempPassword}</code>
                          <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => {
                            navigator.clipboard.writeText(tempPassword);
                            toast.success("Senha copiada!");
                          }}>
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <p className="text-[11px] text-amber-500 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Esta conta nasceu dentro do workspace atual e não recebeu workspace próprio.
                      </p>
                    </div>
                    <Button className="w-full" onClick={closeCreateDialog}>Fechar</Button>
                  </div>
                ) : (
                  <div className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <Label className="text-xs">Email *</Label>
                      <Input
                        type="email"
                        value={createForm.email}
                        onChange={(e) => setCreateForm((p) => ({ ...p, email: e.target.value }))}
                        placeholder="utilisateur@entreprise.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Nome completo *</Label>
                      <Input
                        value={createForm.full_name}
                        onChange={(e) => setCreateForm((p) => ({ ...p, full_name: e.target.value }))}
                        placeholder="Jean Dupont"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">Função *</Label>
                      <Select value={createForm.role} onValueChange={(v) => setCreateForm((p) => ({ ...p, role: v }))}>
                        <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="partner">Associe</SelectItem>
                          <SelectItem value="technician">Technicien</SelectItem>
                          <SelectItem value="client">Client</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button className="w-full" onClick={handleCreateUser} disabled={creating || !createForm.email || !createForm.full_name}>
                      {creating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
                      Criar membro
                    </Button>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : users.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">{t("users.noUsers")}</div>
      ) : (
        <div className="rounded-lg border border-border/50 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="text-[11px]">
                <TableHead>{t("label.name")}</TableHead>
                <TableHead>{t("label.email")}</TableHead>
                <TableHead>{t("label.role")}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Último acesso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u: any) => {
                const initials = (u.name || u.email || "?")
                  .split(" ")
                  .map((part: string) => part[0] || "")
                  .join("")
                  .toUpperCase()
                  .slice(0, 2);
                return (
                  <TableRow key={u.membership_id} className="text-xs">
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 overflow-hidden rounded-full bg-primary/10 text-[10px] font-semibold text-primary flex items-center justify-center">
                          {u.avatar_url ? (
                            <img src={u.avatar_url} alt={u.name || u.email} className="h-full w-full object-cover" />
                          ) : (
                            <span>{initials}</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-medium">
                            <span className="truncate">{u.name || "—"}</span>
                            {u.is_workspace_owner && <Crown className="h-3.5 w-3.5 text-amber-500/70" />}
                          </div>
                          <span className="text-[10px] text-muted-foreground">
                            {u.has_own_workspace ? "Possui workspace próprio" : "Sem workspace próprio"}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{u.email || "—"}</TableCell>
                    <TableCell>
                      {u.is_workspace_owner ? (
                        <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">Owner</Badge>
                      ) : isAdmin && u.auth_user_id !== user?.id ? (
                        <Select value={u.role} onValueChange={(v) => updateRoleMutation.mutate({ membershipId: u.membership_id, newRole: v })}>
                          <SelectTrigger className="h-7 w-[120px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="partner">Associe</SelectItem>
                            <SelectItem value="technician">Technicien</SelectItem>
                            <SelectItem value="client">Client</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">{u.role_label || roleLabels[u.role] || u.role}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {isAdmin && !u.is_workspace_owner && u.auth_user_id !== user?.id ? (
                        <Select
                          value={u.status}
                          onValueChange={(v) =>
                            updateStatusMutation.mutate({
                              membershipId: u.membership_id,
                              newStatus: v as "active" | "inactive",
                            })
                          }
                        >
                          <SelectTrigger className="h-7 w-[95px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Ativo</SelectItem>
                            <SelectItem value="inactive">Inativo</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline" className={u.status === "active" ? "text-[10px] border-emerald-500/30 text-emerald-500" : "text-[10px] border-border text-muted-foreground"}>
                          {u.status === "active" ? "Ativo" : "Inativo"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatLastAccess(u.last_access_at)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ─── SETTINGS ───
export function SettingsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <Settings className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Configurações</h1>
          <p className="text-xs text-muted-foreground">Preferências do sistema, segurança e credenciais</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SystemPreferencesCard />
        <SecurityCard />
      </div>

      <TempCredentialsCard />

      <Card className="border-border/40 bg-card/40">
        <CardHeader>
          <CardTitle className="text-sm text-muted-foreground">Sobre o Sistema</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p className="text-sm font-medium text-foreground">{SYSTEM_METADATA.trademark}</p>
          <p>{SYSTEM_METADATA.description}</p>
          <div className="pt-2">
            <p className="text-[11px] uppercase tracking-wider opacity-70">Arquitetura e direção de produto</p>
            <p className="text-foreground/90">{SYSTEM_METADATA.system_architect}</p>
          </div>
          <p className="pt-2 text-[11px] opacity-70">© {SYSTEM_METADATA.year} · {SYSTEM_METADATA.proprietary_notice}.</p>
        </CardContent>
      </Card>
    </div>
  );
}
