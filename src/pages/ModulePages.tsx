import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { uploadFile as storageUpload, deleteFiles, getFileUrl } from "@/lib/storage";
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
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

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

// ─── DOCUMENTS ───
export function Documents() {
  const { t, formatDate } = useLanguage();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [parentId, setParentId] = useState<string | null>(null);
  const [path, setPath] = useState<{ id: string | null; name: string }[]>([{ id: null, name: t("common.root") }]);
  const [folderName, setFolderName] = useState("");
  const [showFolderDialog, setShowFolderDialog] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [moveTarget, setMoveTarget] = useState<any>(null);
  const [moveDestination, setMoveDestination] = useState<string>("__root__");
  const [newFolderInMove, setNewFolderInMove] = useState("");
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ["documents", parentId],
    queryFn: async () => {
      let q = supabase.from("documents").select("*")
        .eq("module", "global")
        .order("type", { ascending: true }).order("name");
      q = parentId ? q.eq("parent_id", parentId) : q.is("parent_id", null);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  const { data: allFolders = [] } = useQuery({
    queryKey: ["doc-folders-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, name, parent_id")
        .eq("module", "global")
        .eq("type", "folder")
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: showMoveDialog,
  });

  const allSelected = docs.length > 0 && docs.every((d: any) => selectedIds.has(d.id));

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(docs.map((d: any) => d.id)));
  };

  const clearSelection = () => setSelectedIds(new Set());

  const createFolder = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("documents").insert({
        name: folderName, type: "folder", parent_id: parentId, uploaded_by: user?.id, entity_type: "documents", module: "global",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
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
      const { error } = await supabase.from("documents").delete().eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success(t("toast.deleted"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const docsToDelete = docs.filter((d: any) => ids.includes(d.id));
      const storagePaths = docsToDelete.filter((d: any) => d.storage_path).map((d: any) => d.storage_path);
      if (storagePaths.length > 0) await deleteFiles("uploads", storagePaths);
      const { error } = await supabase.from("documents").delete().in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      clearSelection();
      toast.success(t("toast.deleted"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const moveMutation = useMutation({
    mutationFn: async ({ docIds, newParentId }: { docIds: string[]; newParentId: string | null }) => {
      const { error } = await supabase.from("documents").update({ parent_id: newParentId }).in("id", docIds);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      setShowMoveDialog(false);
      setMoveTarget(null);
      clearSelection();
      toast.success(t("toast.updated"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const createFolderInMove = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase.from("documents").insert({
        name, type: "folder", parent_id: null, uploaded_by: user?.id, entity_type: "documents", module: "global",
      }).select("id").single();
      if (error) throw error;
      return data.id;
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
      const { error } = await supabase.from("documents").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      setRenamingId(null);
      toast.success(t("toast.updated"));
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const uploadFile = async (file: File) => {
    try {
      const safeName = (file.name || "document").replace(/[^\w.\-()]+/g, "_").slice(0, 160);
      const storagePath = `documents/${Date.now()}_${safeName}`;
      await withPromiseTimeout<any>(
        storageUpload("uploads", storagePath, file, file.type || undefined),
        10000,
        "documents_global_upload",
      );
      const { error } = await withPromiseTimeout<any>(
        supabase.from("documents").insert({
          name: safeName, type: "file", parent_id: parentId, uploaded_by: user?.id,
          storage_path: storagePath, mime_type: file.type, size_bytes: file.size, entity_type: "documents", module: "global",
        }),
        10000,
        "documents_global_insert",
      );
      if (error) {
        toast.error(error.message);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success(t("docs.fileUploaded"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha no upload.");
    }
  };

  const navigateTo = (id: string | null, name: string) => {
    clearSelection();
    if (id === null) { setParentId(null); setPath([{ id: null, name: t("common.root") }]); return; }
    setParentId(id);
    const idx = path.findIndex(p => p.id === id);
    if (idx >= 0) setPath(path.slice(0, idx + 1));
    else setPath([...path, { id, name }]);
  };

  const handleDownload = (doc: any) => {
    if (!doc.storage_path) return;
    const a = document.createElement("a");
    a.href = getFileUrl("uploads", doc.storage_path);
    a.download = doc.name;
    a.click();
  };

  const handlePreview = (doc: any) => {
    if (!doc.storage_path) return;
    setPreviewDoc({ ...doc, url: getFileUrl("uploads", doc.storage_path) });
  };

  const handlePrint = (doc: any) => {
    if (!doc.storage_path) return;
    const w = window.open(getFileUrl("uploads", doc.storage_path), "_blank");
    w?.addEventListener("load", () => w.print());
  };

  const selectedArray = Array.from(selectedIds);
  const isBulkMode = selectedArray.length > 0;

  const openBulkMove = () => {
    setMoveTarget(null);
    setMoveDestination("__root__");
    setNewFolderInMove("");
    setShowMoveDialog(true);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <FolderOpen className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">{t("docs.title")}</h1>
            <p className="text-xs text-muted-foreground">{t("docs.subtitle")}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Dialog open={showFolderDialog} onOpenChange={setShowFolderDialog}>
            <DialogTrigger asChild><Button variant="outline" size="sm"><FolderPlus className="h-4 w-4 mr-1" />{t("docs.newFolder")}</Button></DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader><DialogTitle>{t("docs.createFolder")}</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-2">
                <Input value={folderName} onChange={e => setFolderName(e.target.value)} placeholder={t("label.name")} />
                <Button className="w-full" onClick={() => createFolder.mutate()} disabled={!folderName.trim()}>{t("action.save")}</Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button size="sm" asChild>
            <label className="cursor-pointer">
              <Upload className="h-4 w-4 mr-1" />{t("action.upload")}
              <input type="file" className="hidden" onChange={e => { if (e.target.files?.[0]) uploadFile(e.target.files[0]); e.target.value = ""; }} />
            </label>
          </Button>
        </div>
      </div>

      {/* Bulk action bar */}
      {isBulkMode && (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <CheckSquare className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium text-foreground">
            {selectedArray.length} {t("fm.selected")}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={openBulkMove}>
              <MoveRight className="h-3 w-3 mr-1" />{t("fm.move")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px] text-destructive border-destructive/30"
              onClick={() => bulkDeleteMutation.mutate(selectedArray)}
            >
              <Trash2 className="h-3 w-3 mr-1" />{t("action.delete")}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={clearSelection}>
              {t("action.cancel")}
            </Button>
          </div>
        </div>
      )}

      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {path.map((p, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3" />}
            <button onClick={() => navigateTo(p.id, p.name)} className="hover:text-foreground">{p.name}</button>
          </span>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : docs.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">{t("docs.emptyFolder")}</div>
      ) : (
        <div className="rounded-lg border border-border/50 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow className="text-[11px]">
                <TableHead className="w-8">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label={t("fm.selectAll")} />
                </TableHead>
                <TableHead>{t("label.name")}</TableHead>
                <TableHead>{t("label.type")}</TableHead>
                <TableHead>{t("docs.size")}</TableHead>
                <TableHead>{t("label.date")}</TableHead>
                <TableHead>{t("label.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map((d: any) => (
                <TableRow key={d.id} className={`text-xs ${selectedIds.has(d.id) ? "bg-primary/5" : ""}`}>
                  <TableCell className="w-8">
                    <Checkbox checked={selectedIds.has(d.id)} onCheckedChange={() => toggleSelect(d.id)} />
                  </TableCell>
                  <TableCell className="font-medium flex items-center gap-2 cursor-pointer" onClick={() => renamingId !== d.id && d.type === "folder" && navigateTo(d.id, d.name)}>
                    {d.type === "folder" ? <FolderOpen className="h-4 w-4 text-primary shrink-0" /> : <FileText className="h-4 w-4 text-muted-foreground shrink-0" />}
                    {renamingId === d.id ? (
                      <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); if (renameValue.trim()) renameMutation.mutate({ id: d.id, name: renameValue.trim() }); }}>
                        <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="h-6 text-xs w-[180px]" autoFocus onKeyDown={(e) => { if (e.key === "Escape") setRenamingId(null); }} />
                        <Button type="submit" variant="ghost" size="icon" className="h-5 w-5" disabled={!renameValue.trim()}><Check className="h-3 w-3 text-primary" /></Button>
                        <Button type="button" variant="ghost" size="icon" className="h-5 w-5" onClick={() => setRenamingId(null)}><X className="h-3 w-3" /></Button>
                      </form>
                    ) : (
                      <span className="truncate max-w-[200px]">{d.name}</span>
                    )}
                  </TableCell>
                  <TableCell><Badge variant="outline">{d.type === "folder" ? t("common.folder") : t("common.file")}</Badge></TableCell>
                  <TableCell>{d.size_bytes ? `${(d.size_bytes / 1024).toFixed(1)} KB` : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(d.created_at)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {d.type === "file" && (
                        <>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handlePreview(d)} title={t("fm.preview")}>
                            <Eye className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDownload(d)} title={t("fm.download")}>
                            <Download className="h-3 w-3" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handlePrint(d)} title={t("fm.print")}>
                            <Printer className="h-3 w-3" />
                          </Button>
                        </>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setRenamingId(d.id); setRenameValue(d.name); }} title={t("fm.rename")}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
                        setMoveTarget(d);
                        setMoveDestination("__root__");
                        setNewFolderInMove("");
                        setShowMoveDialog(true);
                      }} title={t("fm.move")}>
                        <MoveRight className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(d); }}>
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

      {/* Move dialog */}
      <Dialog open={showMoveDialog} onOpenChange={setShowMoveDialog}>
        <DialogContent className="bg-card border-border">
          <DialogHeader><DialogTitle>{t("fm.moveTo")}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">
              {moveTarget
                ? <>{t("fm.moveFile")}: <strong>{moveTarget.name}</strong></>
                : <>{selectedArray.length} {t("fm.selected")}</>
              }
            </p>
            <Select value={moveDestination} onValueChange={setMoveDestination}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder={t("fm.selectFolder")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__root__">{t("common.root")}</SelectItem>
                {allFolders
                  .filter((f: any) => f.id !== moveTarget?.id && !selectedIds.has(f.id))
                  .map((f: any) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
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
                <FolderPlus className="h-3 w-3 mr-1" />{t("action.add")}
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

      {/* Preview dialog */}
      <Dialog open={!!previewDoc} onOpenChange={() => setPreviewDoc(null)}>
        <DialogContent className="bg-card border-border max-w-3xl max-h-[80vh]">
          <DialogHeader><DialogTitle>{previewDoc?.name}</DialogTitle></DialogHeader>
          <div className="overflow-auto max-h-[65vh]">
            {previewDoc?.mime_type?.startsWith("image/") ? (
              <img src={previewDoc.url} alt={previewDoc.name} className="max-w-full rounded" />
            ) : previewDoc?.mime_type === "application/pdf" ? (
              <iframe src={previewDoc.url} className="w-full h-[60vh] rounded" />
            ) : (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <a href={previewDoc?.url} target="_blank" rel="noopener noreferrer" className="text-primary underline">{t("fm.download")}</a>
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
                      <Badge variant="outline" className={u.status === "active" ? "text-[10px] border-emerald-500/30 text-emerald-500" : "text-[10px] border-border text-muted-foreground"}>
                        {u.status === "active" ? "Ativo" : "Inativo"}
                      </Badge>
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
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isOwner = user?.email === "qwork@qworkgroup.com";
  const [resetting, setResetting] = useState(false);

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

      {isOwner && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Zona de Perigo — Desenvolvimento
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-4">
              Reset completo do sistema. Remove todos os usuários, convites e memberships exceto o owner. Esta ação é irreversível.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" disabled={resetting}>
                  {resetting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
                  Reset Sistema
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Tem certeza?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Isso apagará todos os usuários, convites, memberships e dados associados. Apenas o owner (qwork@qworkgroup.com) será mantido. Esta ação é irreversível.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={async () => {
                      setResetting(true);
                      try {
                        const { error } = await supabase.functions.invoke("reset-system");
                        if (error) throw error;
                        toast.success("Sistema resetado com sucesso");
                        queryClient.invalidateQueries();
                      } catch (err: any) {
                        toast.error(err.message || "Erro ao resetar sistema");
                      } finally {
                        setResetting(false);
                      }
                    }}
                  >
                    Sim, resetar tudo
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}

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
