import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listFinanceTechnicians,
  listFinancialRecords,
  createFinancialRecord,
  deleteFinancialRecordsBy,
} from "@/lib/apiFinance";
import { useLanguage } from "@/hooks/useLanguage";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  ChevronDown, ChevronRight, Plus, TrendingUp, TrendingDown,
  Users, Calendar, Trash2, Building2,
} from "lucide-react";
import { toast } from "sonner";
import ExpenseSpreadsheet, { SpreadsheetData, SpreadsheetRow, getDefaultColumns } from "./ExpenseSpreadsheet";
import FinancialMovements, { FinancialMovement, getYearFromPeriod, normalizePeriod, normalizeMonth } from "./FinancialMovements";
import { useParticipantAggregation, getParticipantYearAgg, type ParticipantAgg } from "@/hooks/useParticipantAggregation";

/* ── hooks ── */
function useTechnicians() {
  return useQuery({
    queryKey: ["tech-detail-list"],
    retry: 0,
    // Source of truth: users with role 'technician' (user_roles + profiles via REST)
    queryFn: () => listFinanceTechnicians(),
  });
}

function useTechFinancials() {
  return useQuery({
    queryKey: ["tech-financials"],
    retry: 0,
    queryFn: () =>
      listFinancialRecords({
        type: ["expense_spreadsheet", "manual_revenue_expected", "manual_revenue_received", "financial_movements"],
      }),
  });
}

function useAddTechnician() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ name }: { name: string }) => {
      // Adding a "technician" here means: create an empty profile placeholder is not possible without auth,
      // so we surface a clear message guiding admins to create a user via the Users module.
      void name;
      throw new Error("Para adicionar um técnico, crie um utilizador com a função 'técnico' no módulo Utilizadores.");
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tech-detail-list"] }); toast.success("Técnico adicionado"); },
    onError: (e) => toast.error("Erro: " + (e as Error).message),
  });
}

function useDeleteTechFinancials() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ techId }: { techId: string }) => {
      // Delete financial records belonging to this technician (by assigned_user_id),
      // plus legacy rows tagged via the notes marker `tech:<id>`.
      await deleteFinancialRecordsBy({ assigned_user_id: techId });
      await deleteFinancialRecordsBy({ notes_like: `tech:${techId}` });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tech-financials"] });
      qc.invalidateQueries({ queryKey: ["tech-detail-list"] });
      toast.success("Análise financeira do técnico apagada");
    },
    onError: (e) => toast.error("Erro: " + (e as Error).message),
  });
}

function useUpsertRevenue() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ techId, techName, type, amount, year }: { techId: string; techName: string; type: string; amount: number; year: string }) => {
      await deleteFinancialRecordsBy({ type, notes_like: `tech:${techId}:${techName}:year:${year}` });
      await createFinancialRecord({
        type, source: "manual",
        label: type === "manual_revenue_expected" ? "Receita esperada" : "Receita recebida",
        amount, status: "confirmed",
        notes: `tech:${techId}:${techName}:year:${year}`,
        assigned_user_id: techId,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tech-financials"] }),
  });
}

function useSaveSpreadsheet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ techId, techName, spreadsheet }: { techId: string; techName: string; spreadsheet: SpreadsheetData }) => {
      await deleteFinancialRecordsBy({ type: "expense_spreadsheet", notes_like: `tech:${techId}` });
      const grandTotal = spreadsheet.rows.reduce((s, r) =>
        s + spreadsheet.columns.reduce((cs, c) => cs + (r.values[c.id] || 0), 0), 0);
      await createFinancialRecord({
        type: "expense_spreadsheet", source: "manual", label: "Despesas (planilha)",
        amount: grandTotal, status: "confirmed",
        notes: `tech:${techId}:${techName}`,
        category: JSON.stringify(spreadsheet),
        assigned_user_id: techId,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tech-financials"] }),
  });
}

function useSaveMovements() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ techId, techName, movements }: { techId: string; techName: string; movements: FinancialMovement[] }) => {
      await deleteFinancialRecordsBy({ type: "financial_movements", notes_like: `tech:${techId}` });
      const totalLoans = movements.filter((m) => m.type === "loan").reduce((s, m) => s + m.amount, 0);
      await createFinancialRecord({
        type: "financial_movements", source: "manual", label: "Movimentações financeiras",
        amount: totalLoans, status: "confirmed",
        notes: `tech:${techId}:${techName}`,
        category: JSON.stringify(movements),
        assigned_user_id: techId,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tech-financials"] }),
  });
}

/* ── helpers ── */
interface TechData {
  id: string;
  name: string;
  spreadsheet: SpreadsheetData;
  movements: FinancialMovement[];
  revenueByYear: Record<string, { expected: number; received: number }>;
}

function buildTechData(tech: { id: string; name: string }, records: any[]): TechData {
  const mine = records.filter((r) => (r.notes || "").includes(`tech:${tech.id}`));

  const revenueByYear: Record<string, { expected: number; received: number }> = {};
  mine.filter((r) => r.type === "manual_revenue_expected" || r.type === "manual_revenue_received").forEach((r) => {
    const yearMatch = (r.notes || "").match(/year:(\d{4})/);
    const year = yearMatch ? yearMatch[1] : "unknown";
    if (!revenueByYear[year]) revenueByYear[year] = { expected: 0, received: 0 };
    if (r.type === "manual_revenue_expected") revenueByYear[year].expected = r.amount;
    else revenueByYear[year].received = r.amount;
  });

  mine.filter((r) => (r.type === "manual_revenue_expected" || r.type === "manual_revenue_received") && !(r.notes || "").includes("year:")).forEach((r) => {
    const year = String(new Date().getFullYear());
    if (!revenueByYear[year]) revenueByYear[year] = { expected: 0, received: 0 };
    if (r.type === "manual_revenue_expected") revenueByYear[year].expected = r.amount;
    else revenueByYear[year].received = r.amount;
  });

  const ssRecord = mine.find((r) => r.type === "expense_spreadsheet");
  let spreadsheet: SpreadsheetData = { columns: getDefaultColumns(), rows: [] };
  if (ssRecord?.category) {
    try { const parsed = JSON.parse(ssRecord.category); if (parsed.columns && parsed.rows) spreadsheet = parsed; } catch { /* default */ }
  }

  const movRecord = mine.find((r) => r.type === "financial_movements");
  let movements: FinancialMovement[] = [];
  if (movRecord?.category) {
    try {
      const parsed = JSON.parse(movRecord.category);
      if (Array.isArray(parsed)) movements = parsed.map((m: any) => ({ ...m, paidAmount: m.paidAmount || 0 }));
    } catch { /* default */ }
  }

  return { id: tech.id, name: tech.name, spreadsheet, movements, revenueByYear };
}

/* ── year data helper ──
   Three independent financial dimensions per year:
   - CASH = received + incoming loans − paid expenses
   - OBLIGATIONS = sum of unpaid loan portions (breakdown by origin)
   - TECHNICIAN RESULT = expected − expenses (NO loans mixed in)
*/
interface ObligationItem { origin: string; remaining: number; }
interface PaymentItem { entity: string; amount: number; }

interface YearBlockData {
  year: string;
  revenueExpected: number;
  revenueReceived: number;
  expenseRows: SpreadsheetRow[];
  totalExpenses: number;
  yearMovements: FinancialMovement[];
  // Cash flow components
  loansIncoming: number;          // total loans received this year (cash inflow)
  loansRepaid: number;            // total amount already repaid to partners (cash outflow)
  techPaymentsMade: number;       // total cash paid to the technician this year
  // Obligations
  obligations: ObligationItem[];  // per-origin remaining debt to partners
  obligationsTotal: number;
  // Pagamentos realizados (cumulative, grouped by entity)
  paymentsByEntity: PaymentItem[];
}

function getYearBlocks(data: TechData, columns: { id: string }[]): YearBlockData[] {
  const years = new Set<string>();
  data.spreadsheet.rows.forEach((r) => { const y = getYearFromPeriod(r.period); if (y) years.add(y); });
  data.movements.forEach((m) => { const y = getYearFromPeriod(m.period); if (y) years.add(y); });
  Object.keys(data.revenueByYear).forEach((y) => {
    if (y !== "unknown") {
      const rev = data.revenueByYear[y];
      if (rev.expected !== 0 || rev.received !== 0) years.add(y);
    }
  });

  return Array.from(years).sort().map((year) => {
    const yy = year.slice(2);
    const rev = data.revenueByYear[year] || { expected: 0, received: 0 };
    const expenseRows = data.spreadsheet.rows.filter((r) => r.period.endsWith(`/${yy}`));
    const totalExpenses = expenseRows.reduce((s, r) =>
      columns.reduce((cs, c) => cs + (r.values[c.id] || 0), s), 0);
    const yearMovements = data.movements.filter((m) => getYearFromPeriod(m.period) === year);
    const loans = yearMovements.filter((m) => m.type === "loan");
    const techPayments = yearMovements.filter((m) => m.type === "payment");
    const loansIncoming = loans.reduce((s, m) => s + (m.amount || 0), 0);
    const loansRepaid = loans.reduce((s, m) => s + (m.paidAmount || 0), 0);
    const techPaymentsMade = techPayments.reduce((s, m) => s + (m.amount || 0), 0);

    // Group remaining debt by origin (partners: Sanchez, etc.)
    const map = new Map<string, number>();
    for (const m of loans) {
      const remaining = Math.max(0, (m.amount || 0) - (m.paidAmount || 0));
      if (remaining <= 0) continue;
      const key = (m.origin || "—").trim() || "—";
      map.set(key, (map.get(key) || 0) + remaining);
    }
    const obligations: ObligationItem[] = Array.from(map.entries())
      .map(([origin, remaining]) => ({ origin, remaining }))
      .sort((a, b) => b.remaining - a.remaining);
    const obligationsTotal = obligations.reduce((s, o) => s + o.remaining, 0);

    // Pagamentos realizados grouped by entity
    const payMap = new Map<string, number>();
    for (const m of loans) {
      if ((m.paidAmount || 0) <= 0) continue;
      const key = (m.origin || "—").trim() || "—";
      payMap.set(key, (payMap.get(key) || 0) + (m.paidAmount || 0));
    }
    for (const m of techPayments) {
      if ((m.amount || 0) <= 0) continue;
      const key = (m.origin || "—").trim() || "—";
      payMap.set(key, (payMap.get(key) || 0) + (m.amount || 0));
    }
    const paymentsByEntity: PaymentItem[] = Array.from(payMap.entries())
      .map(([entity, amount]) => ({ entity, amount }))
      .sort((a, b) => b.amount - a.amount);

    return {
      year,
      revenueExpected: rev.expected,
      revenueReceived: rev.received,
      expenseRows,
      totalExpenses,
      yearMovements,
      loansIncoming,
      loansRepaid,
      techPaymentsMade,
      obligations,
      obligationsTotal,
      paymentsByEntity,
    };
  });
}

/* ── main component ── */
export default function TechnicianDetailTab({ showAddModal, onShowAddModal }: { showAddModal?: boolean; onShowAddModal?: (v: boolean) => void }) {
  const { data: technicians = [], isLoading: loadingTech } = useTechnicians();
  const { data: records = [], isLoading: loadingFin } = useTechFinancials();
  const { formatCurrency } = useLanguage();
  const [localShowAdd, setLocalShowAdd] = useState(false);

  const showAdd = showAddModal ?? localShowAdd;
  const setShowAdd = onShowAddModal ?? setLocalShowAdd;

  if (loadingTech || loadingFin) {
    return <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-14 bg-muted/30 rounded-lg animate-pulse" />)}</div>;
  }

  const techDataList = technicians.map((t) => buildTechData(t, records));

  // Company total = sum of cash across all technicians (real money owned).
  const companyTotal = techDataList.reduce((sum, td) => {
    const blocks = getYearBlocks(td, td.spreadsheet.columns);
    return sum + blocks.reduce((s, yb) => {
      const cash = yb.revenueReceived + yb.loansIncoming - yb.totalExpenses - yb.loansRepaid - yb.techPaymentsMade;
      return s + cash;
    }, 0);
  }, 0);

  return (
    <div className="space-y-6">
      {techDataList.length === 0 && (
        <Card className="border-border/50 bg-muted/30">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">Nenhum técnico registado</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-4">
              Adicione técnicos para iniciar a análise financeira.
            </p>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="icon" onClick={() => setShowAdd(true)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Adicionar técnico</TooltipContent>
            </Tooltip>
          </CardContent>
        </Card>
      )}

      {/* Technician list */}
      {techDataList.length > 0 && (
        <div className="space-y-1.5">
          {techDataList.map((td) => (
            <TechnicianRow key={td.id} data={td} formatCurrency={formatCurrency} />
          ))}
        </div>
      )}

      {/* Company balance — structured card */}
      {techDataList.length > 0 && (
        <Card className={`border-border/50 bg-muted/20 ${companyTotal > 0 ? "shadow-[0_0_20px_-4px_hsl(var(--success)/0.15)]" : companyTotal < 0 ? "shadow-[0_0_20px_-4px_hsl(var(--destructive)/0.15)]" : ""}`}>
          <CardContent className="flex items-center justify-between py-4 px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                <Building2 className="h-4 w-4 text-primary" />
              </div>
              <span className="text-sm font-semibold text-foreground">Balanço da empresa</span>
            </div>
            <span className={`text-lg font-bold tabular-nums ${companyTotal >= 0 ? "text-emerald-400" : "text-destructive"}`}>
              {companyTotal < 0 ? "- " : ""}{formatCurrency(Math.abs(companyTotal))}
            </span>
          </CardContent>
        </Card>
      )}

      <AddTechnicianModal open={showAdd} onOpenChange={setShowAdd} />
    </div>
  );
}

/* ── Add modal (simplified) ── */
function AddTechnicianModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [name, setName] = useState("");
  const addTech = useAddTechnician();
  const handleSubmit = () => {
    if (!name.trim()) return;
    addTech.mutate({ name: name.trim() }, { onSuccess: () => { setName(""); onOpenChange(false); } });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Adicionar</DialogTitle></DialogHeader>
        <div className="py-2">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input placeholder="Digite o nome" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSubmit()} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!name.trim() || addTech.isPending}>{addTech.isPending ? "Salvando..." : "Adicionar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Technician row ── */
function TechnicianRow({ data, formatCurrency }: { data: TechData; formatCurrency: (v: number) => string }) {
  const [open, setOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [localSpreadsheet, setLocalSpreadsheet] = useState<SpreadsheetData>(data.spreadsheet);
  const [localMovements, setLocalMovements] = useState<FinancialMovement[]>(data.movements);
  const saveSpreadsheet = useSaveSpreadsheet();
  const saveMovements = useSaveMovements();
  const upsertRevenue = useUpsertRevenue();
  const deleteTechFin = useDeleteTechFinancials();
  const { data: aggregation } = useParticipantAggregation();

  const yearBlocks = useMemo(() => getYearBlocks(
    { ...data, spreadsheet: localSpreadsheet, movements: localMovements },
    localSpreadsheet.columns
  ), [data, localSpreadsheet, localMovements]);

  // Header rollup uses CASH (real money owned) — sum across all years for this tech.
  const globalResult = yearBlocks.reduce((s, yb) => {
    const cash = yb.revenueReceived + yb.loansIncoming - yb.totalExpenses - yb.loansRepaid - yb.techPaymentsMade;
    return s + cash;
  }, 0);
  const isPositive = globalResult >= 0;

  const handleSpreadsheetChange = useCallback((newData: SpreadsheetData) => {
    setLocalSpreadsheet(newData);
    saveSpreadsheet.mutate({ techId: data.id, techName: data.name, spreadsheet: newData });
  }, [data.id, data.name, saveSpreadsheet]);

  const handleMovementsChange = useCallback((newData: FinancialMovement[]) => {
    setLocalMovements(newData);
    saveMovements.mutate({ techId: data.id, techName: data.name, movements: newData });
  }, [data.id, data.name, saveMovements]);

  const handleRevenueSave = useCallback((year: string, type: string, amount: number) => {
    if (isNaN(amount)) return;
    upsertRevenue.mutate({ techId: data.id, techName: data.name, type, amount, year });
  }, [data.id, data.name, upsertRevenue]);

  const handleDeleteYear = useCallback((year: string) => {
    const yy = year.slice(2);
    const newRows = localSpreadsheet.rows.filter((r) => !r.period.endsWith(`/${yy}`));
    const newSS = { ...localSpreadsheet, rows: newRows };
    setLocalSpreadsheet(newSS);
    saveSpreadsheet.mutate({ techId: data.id, techName: data.name, spreadsheet: newSS });

    const newMovements = localMovements.filter((m) => getYearFromPeriod(m.period) !== year);
    setLocalMovements(newMovements);
    saveMovements.mutate({ techId: data.id, techName: data.name, movements: newMovements });

    // Delete revenue for that year
    upsertRevenue.mutate({ techId: data.id, techName: data.name, type: "manual_revenue_expected", amount: 0, year });
    upsertRevenue.mutate({ techId: data.id, techName: data.name, type: "manual_revenue_received", amount: 0, year });
    toast.success(`Período ${year} removido`);
  }, [data.id, data.name, localSpreadsheet, localMovements, saveSpreadsheet, saveMovements, upsertRevenue]);

  const handleAddPeriod = useCallback((rawInput: string, constrainYear?: string) => {
    // Accept month-only input, auto-link to year
    const month = normalizeMonth(rawInput);
    if (!month) {
      // Fallback: try full period format
      const normalized = normalizePeriod(rawInput);
      if (!normalized) {
        toast.error("Mês inválido. Use: Jan, Fev, 01, etc.");
        return;
      }
      // Force year suffix
      const yy = constrainYear ? constrainYear.slice(2) : normalized.split("/")[1];
      const monthPart = normalized.split("/")[0];
      const finalPeriod = `${monthPart}/${yy}`;
      if (localSpreadsheet.rows.some((r) => r.period === finalPeriod)) {
        toast.error("Período já existe");
        return;
      }
      const newRow: import("./ExpenseSpreadsheet").SpreadsheetRow = { id: `row_${Date.now()}`, period: finalPeriod, values: {} };
      const newSS = { ...localSpreadsheet, rows: [...localSpreadsheet.rows, newRow] };
      setLocalSpreadsheet(newSS);
      saveSpreadsheet.mutate({ techId: data.id, techName: data.name, spreadsheet: newSS });
      toast.success(`Período ${finalPeriod} criado`);
      return;
    }
    const yy = constrainYear ? constrainYear.slice(2) : String(new Date().getFullYear()).slice(2);
    const finalPeriod = `${month}/${yy}`;
    if (localSpreadsheet.rows.some((r) => r.period === finalPeriod)) {
      toast.error("Período já existe");
      return;
    }
    const newRow: import("./ExpenseSpreadsheet").SpreadsheetRow = { id: `row_${Date.now()}`, period: finalPeriod, values: {} };
    const newSS = { ...localSpreadsheet, rows: [...localSpreadsheet.rows, newRow] };
    setLocalSpreadsheet(newSS);
    saveSpreadsheet.mutate({ techId: data.id, techName: data.name, spreadsheet: newSS });
    toast.success(`Período ${finalPeriod} criado`);
  }, [localSpreadsheet, data.id, data.name, saveSpreadsheet]);

  const handleAddYear = useCallback((targetYear?: number) => {
    const existingYears = yearBlocks.map((yb) => parseInt(yb.year)).filter((y) => !isNaN(y));
    const nextYear = typeof targetYear === "number" && !isNaN(targetYear)
      ? targetYear
      : (existingYears.length > 0 ? Math.max(...existingYears) + 1 : new Date().getFullYear());
    if (nextYear < 1900 || nextYear > 2999) {
      toast.error("Ano inválido");
      return;
    }
    const yy = String(nextYear).slice(2);
    const firstPeriod = `Jan/${yy}`;
    if (localSpreadsheet.rows.some((r) => r.period === firstPeriod)) {
      toast.error(`Período ${firstPeriod} já existe`);
      return;
    }
    const newRow: import("./ExpenseSpreadsheet").SpreadsheetRow = { id: `row_${Date.now()}`, period: firstPeriod, values: {} };
    const newSS = { ...localSpreadsheet, rows: [...localSpreadsheet.rows, newRow] };
    setLocalSpreadsheet(newSS);
    saveSpreadsheet.mutate({ techId: data.id, techName: data.name, spreadsheet: newSS });
    upsertRevenue.mutate({ techId: data.id, techName: data.name, type: "manual_revenue_expected", amount: 0, year: String(nextYear) });
    upsertRevenue.mutate({ techId: data.id, techName: data.name, type: "manual_revenue_received", amount: 0, year: String(nextYear) });
    toast.success(`Ano ${nextYear} criado`);
  }, [yearBlocks, localSpreadsheet, data.id, data.name, saveSpreadsheet, upsertRevenue]);

  const handleRenameYear = useCallback((oldYear: string, newYear: string) => {
    if (oldYear === newYear) return;
    const oldYY = oldYear.slice(2);
    const newYY = newYear.slice(2);
    const newRows = localSpreadsheet.rows.map((r) =>
      r.period.endsWith(`/${oldYY}`) ? { ...r, period: r.period.replace(`/${oldYY}`, `/${newYY}`) } : r
    );
    const newSS = { ...localSpreadsheet, rows: newRows };
    setLocalSpreadsheet(newSS);
    saveSpreadsheet.mutate({ techId: data.id, techName: data.name, spreadsheet: newSS });

    const newMovements = localMovements.map((m) => {
      const y = getYearFromPeriod(m.period);
      if (y === oldYear) return { ...m, period: m.period.replace(`/${oldYY}`, `/${newYY}`) };
      return m;
    });
    setLocalMovements(newMovements);
    saveMovements.mutate({ techId: data.id, techName: data.name, movements: newMovements });

    upsertRevenue.mutate({ techId: data.id, techName: data.name, type: "manual_revenue_expected", amount: data.revenueByYear[oldYear]?.expected || 0, year: newYear });
    upsertRevenue.mutate({ techId: data.id, techName: data.name, type: "manual_revenue_received", amount: data.revenueByYear[oldYear]?.received || 0, year: newYear });
    upsertRevenue.mutate({ techId: data.id, techName: data.name, type: "manual_revenue_expected", amount: 0, year: oldYear });
    upsertRevenue.mutate({ techId: data.id, techName: data.name, type: "manual_revenue_received", amount: 0, year: oldYear });
    toast.success(`Período renomeado para ${newYear}`);
  }, [localSpreadsheet, localMovements, data, saveSpreadsheet, saveMovements, upsertRevenue]);

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <div className="group grid grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-4 py-3 rounded-lg border border-border/40 cursor-pointer hover:border-primary/30 hover:bg-muted/20 transition-all">
            <div className="flex items-center gap-3 min-w-0">
              <span className={`h-2 w-2 rounded-full shrink-0 ${isPositive ? "bg-emerald-400" : "bg-destructive"}`} />
              <span className="text-sm font-medium text-foreground truncate">{data.name}</span>
            </div>
            <span className={`text-sm font-semibold tabular-nums justify-self-end ${isPositive ? "text-emerald-400" : "text-destructive"}`}>
              {globalResult < 0 ? "- " : ""}{formatCurrency(Math.abs(globalResult))}
            </span>
            <div className="col-span-2 md:col-span-1 flex flex-wrap items-center justify-end gap-2 shrink-0 md:ml-1">
              <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
                <AddPeriodInline
                  compact
                  existingYears={yearBlocks.map((yb) => yb.year)}
                  onAddYear={handleAddYear}
                />
              </div>
              <button
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10"
                onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(true); }}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive transition-colors" />
              </button>
              {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 ml-2 space-y-4">
            {yearBlocks.length === 0 && (
              <EmptyTechDetail techId={data.id} techName={data.name} onAddPeriod={handleAddPeriod} onRevenueSave={handleRevenueSave} />
            )}
             {yearBlocks.map((yb) => (
              <YearBlock
                key={yb.year}
                techName={data.name}
                block={yb}
                columns={localSpreadsheet.columns}
                allSpreadsheet={localSpreadsheet}
                allMovements={localMovements}
                onSpreadsheetChange={handleSpreadsheetChange}
                onMovementsChange={handleMovementsChange}
                onRevenueSave={handleRevenueSave}
                formatCurrency={formatCurrency}
                onDeleteYear={handleDeleteYear}
                onAddPeriod={handleAddPeriod}
                onRenameYear={handleRenameYear}
                derivedAgg={getParticipantYearAgg(aggregation, data.name, yb.year)}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza que deseja apagar esta análise?</AlertDialogTitle>
            <AlertDialogDescription>
              Todos os dados financeiros de <strong>{data.name}</strong> (receitas, despesas e movimentações) serão apagados permanentemente. O técnico será removido da lista.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTechFin.mutate({ techId: data.id })}
            >
              Apagar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ── Empty tech detail — shows when no year blocks exist ── */
function EmptyTechDetail({ techId, techName, onAddPeriod, onRevenueSave }: {
  techId: string; techName: string;
  onAddPeriod: (period: string, constrainYear?: string) => void;
  onRevenueSave: (year: string, type: string, amount: number) => void;
}) {
  const [yearInput, setYearInput] = useState("");

  const handleCreateYear = (year: string) => {
    const y = year.trim();
    if (!/^\d{4}$/.test(y)) {
      toast.error("Ano inválido. Use formato: 2025");
      return;
    }
    onAddPeriod(`Jan/${y.slice(2)}`, y);
    onRevenueSave(y, "manual_revenue_expected", 0);
    onRevenueSave(y, "manual_revenue_received", 0);
    setYearInput("");
  };

  return (
    <Card className="border-border/50 bg-muted/20">
      <CardContent className="flex flex-col items-center justify-center py-8 text-center space-y-3">
        <Calendar className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Nenhum período registado para <strong>{techName}</strong>.</p>
        <div className="flex items-center gap-2">
          <Input
            className="h-8 w-24 text-xs text-center"
            placeholder="Ex: 2025"
            value={yearInput}
            onChange={(e) => setYearInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && yearInput.trim()) handleCreateYear(yearInput); }}
          />
          {yearInput.trim() && (
            <button className="p-1 rounded hover:bg-primary/10 text-primary" onClick={() => handleCreateYear(yearInput)}>
              <Plus className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Year Block ── */
function YearBlock({ techName, block, columns, allSpreadsheet, allMovements, onSpreadsheetChange, onMovementsChange, onRevenueSave, formatCurrency, onDeleteYear, onAddPeriod, onRenameYear, derivedAgg }: {
  techName: string;
  block: YearBlockData;
  columns: { id: string; label: string; type: string }[];
  allSpreadsheet: SpreadsheetData;
  allMovements: FinancialMovement[];
  onSpreadsheetChange: (d: SpreadsheetData) => void;
  onMovementsChange: (d: FinancialMovement[]) => void;
  onRevenueSave: (year: string, type: string, amount: number) => void;
  formatCurrency: (v: number) => string;
  onDeleteYear: (year: string) => void;
  onAddPeriod: (period: string, constrainYear?: string) => void;
  onRenameYear: (oldYear: string, newYear: string) => void;
  derivedAgg?: ParticipantAgg;
}) {
  const [open, setOpen] = useState(true);
  const [showDeleteYear, setShowDeleteYear] = useState(false);
  const [showDeleteMovements, setShowDeleteMovements] = useState(false);
  const [editingYear, setEditingYear] = useState(false);
  const [yearDraft, setYearDraft] = useState(block.year);
  const [newPeriodInput, setNewPeriodInput] = useState("");
  const [showTechPay, setShowTechPay] = useState(false);
  const [techPayInput, setTechPayInput] = useState("");
  const yearSuffix = block.year.slice(2);

  // EFFECTIVE values: derivedAgg (real PO data) takes priority over manual entries.
  const effectiveReceived = derivedAgg && derivedAgg.received > 0 ? derivedAgg.received : block.revenueReceived;

  // CASH = received + loansIncoming − expenses − loansRepaid − techPaymentsMade
  const effectiveCash =
    effectiveReceived + block.loansIncoming - block.totalExpenses - block.loansRepaid - block.techPaymentsMade;

  // PAYABLE TO TECHNICIAN: positive operational result owed to the tech (net of payments already made)
  const payableToTechnician = Math.max(
    0,
    effectiveReceived - block.totalExpenses - block.techPaymentsMade
  );

  // OBLIGATIONS LOGIC (dynamic):
  //  - If there are active partner debts (loans pending) → show partner obligations
  //  - Else if cash > 0 and tech has positive operational result → obligation = technician
  const hasPartnerDebts = block.obligationsTotal > 0;
  const showTechObligation = !hasPartnerDebts && effectiveCash > 0 && payableToTechnician > 0;
  const totalObligations = hasPartnerDebts ? block.obligationsTotal : (showTechObligation ? payableToTechnician : 0);

  const handleYearMovementsChange = useCallback((yearMovements: FinancialMovement[]) => {
    const otherMovements = allMovements.filter((m) => getYearFromPeriod(m.period) !== block.year);
    onMovementsChange([...otherMovements, ...yearMovements]);
  }, [allMovements, block.year, onMovementsChange]);

  // Register a payment to the technician — creates a "payment" movement
  // and validates against available cash (block "paid" if cash < amount).
  const handleTechPayment = useCallback(() => {
    const raw = parseFloat(techPayInput.replace(",", "."));
    if (!raw || raw <= 0) {
      toast.error("Valor inválido");
      return;
    }
    if (raw > effectiveCash) {
      toast.error("Caixa insuficiente para este pagamento");
      return;
    }
    const newMov: FinancialMovement = {
      id: `mov_${Date.now()}`,
      period: `Jan/${yearSuffix}`,
      type: "payment",
      origin: techName,
      reason: "Pagamento ao técnico",
      amount: raw,
      paidAmount: raw,
      status: "paid",
    };
    handleYearMovementsChange([...block.yearMovements, newMov]);
    toast.success(`Pagamento de ${raw.toFixed(2)} registado`);
    setTechPayInput("");
    setShowTechPay(false);
  }, [techPayInput, effectiveCash, yearSuffix, techName, block.yearMovements, handleYearMovementsChange]);

  const handleDeleteAllMovements = () => {
    const otherMovements = allMovements.filter((m) => getYearFromPeriod(m.period) !== block.year);
    onMovementsChange(otherMovements);
    setShowDeleteMovements(false);
    toast.success("Movimentações removidas");
  };

  return (
    <Card className="border-border/50 overflow-hidden">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="py-3 px-4 cursor-pointer hover:bg-muted/30 transition-colors group">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                <Calendar className="h-4 w-4 text-primary" />
                {editingYear ? (
                  <Input
                    className="h-6 w-20 text-sm font-semibold text-center"
                    value={yearDraft}
                    autoFocus
                    onChange={(e) => setYearDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => { onRenameYear(block.year, yearDraft.trim()); setEditingYear(false); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { onRenameYear(block.year, yearDraft.trim()); setEditingYear(false); }
                      if (e.key === "Escape") { setYearDraft(block.year); setEditingYear(false); }
                    }}
                  />
                ) : (
                  <CardTitle className="text-sm font-semibold cursor-text" onClick={(e) => { e.stopPropagation(); setYearDraft(block.year); setEditingYear(true); }}>{block.year}</CardTitle>
                )}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button className="p-1 rounded hover:bg-destructive/10" onClick={(e) => { e.stopPropagation(); setShowDeleteYear(true); }}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive transition-colors" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Excluir período</TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {effectiveCash >= 0 ? <TrendingUp className="h-4 w-4 text-emerald-400" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
                <span className={`text-sm font-bold tabular-nums ${effectiveCash >= 0 ? "text-emerald-400" : "text-destructive"}`}>
                  {effectiveCash < 0 ? "- " : ""}{formatCurrency(Math.abs(effectiveCash))}
                </span>
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="px-4 pb-4 space-y-5">
            <YearRevenueSection year={block.year} expected={block.revenueExpected} received={block.revenueReceived} onSave={onRevenueSave} formatCurrency={formatCurrency} derivedAgg={derivedAgg} />

            <div className="space-y-2">
              <div className="flex items-center gap-2 group/movheader">
                <h4 className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Movimentações</h4>
                <div className="flex items-center gap-1 opacity-0 group-hover/movheader:opacity-100 transition-opacity">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button className="p-0.5 rounded hover:bg-primary/10" onClick={() => {
                        const newMov: FinancialMovement = {
                          id: `mov_${Date.now()}`, period: `Jan/${yearSuffix}`, type: "loan",
                          origin: "", amount: 0, paidAmount: 0, status: "pending",
                        };
                        handleYearMovementsChange([...block.yearMovements, newMov]);
                      }}>
                        <Plus className="h-3.5 w-3.5 text-primary" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Adicionar movimentação</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button className="p-0.5 rounded hover:bg-destructive/10" onClick={() => setShowDeleteMovements(true)}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive transition-colors" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Excluir movimentações</TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <FinancialMovements movements={block.yearMovements} onChange={handleYearMovementsChange} formatCurrency={formatCurrency} constrainToYear={block.year} availableCash={effectiveCash} />
            </div>

            <div className="space-y-2">
              <h4 className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Despesas</h4>
              <div className="flex items-center gap-2">
                <Input
                  className="h-7 w-20 text-xs"
                  placeholder="Ex: Jan"
                  value={newPeriodInput}
                  onChange={(e) => setNewPeriodInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newPeriodInput.trim()) {
                      onAddPeriod(newPeriodInput.trim(), block.year);
                      setNewPeriodInput("");
                    }
                  }}
                />
                {newPeriodInput.trim() && (
                  <button
                    className="p-1 rounded hover:bg-primary/10 text-primary"
                    onClick={() => { onAddPeriod(newPeriodInput.trim(), block.year); setNewPeriodInput(""); }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <ExpenseSpreadsheet data={allSpreadsheet} onChange={onSpreadsheetChange} formatCurrency={formatCurrency} filterYear={yearSuffix} />
            </div>

            {/* ── Resumo financeiro ── Cash centered, dynamic obligations, payments by entity */}
            <div className="space-y-3 pt-1">
              <h4 className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                Resumo financeiro {block.year}
              </h4>

              {/* A) CASH — clean centered display, value only */}
              <div className={`rounded-lg border px-6 py-5 flex flex-col items-center justify-center ${
                effectiveCash >= 0
                  ? "border-emerald-400/20 bg-emerald-400/5"
                  : "border-destructive/20 bg-destructive/5"
              }`}>
                <div className="flex items-center gap-2 mb-1">
                  <Building2 className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                    Caixa disponível
                  </span>
                </div>
                <div className={`text-2xl font-bold tabular-nums ${
                  effectiveCash >= 0 ? "text-emerald-400" : "text-destructive"
                }`}>
                  {effectiveCash < 0 ? "- " : ""}{formatCurrency(Math.abs(effectiveCash))}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* B) OBLIGATIONS — dynamic */}
                <div className={`rounded-lg border px-4 py-3 ${
                  totalObligations > 0
                    ? "border-amber-500/30 bg-amber-500/5"
                    : "border-border/40 bg-muted/20"
                }`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <TrendingDown className="h-3.5 w-3.5 text-amber-400" />
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                        Obrigações
                      </span>
                    </div>
                    {/* Subtle payment button — only when obligation = technician */}
                    {showTechObligation && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            className="p-1 rounded-full hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
                            onClick={() => { setTechPayInput(String(payableToTechnician)); setShowTechPay(true); }}
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Pagar técnico</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <div className={`text-base font-bold tabular-nums ${
                    totalObligations > 0 ? "text-amber-400" : "text-muted-foreground"
                  }`}>
                    {formatCurrency(totalObligations)}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
                    {totalObligations === 0 ? (
                      <div className="italic">Sem dívidas pendentes</div>
                    ) : hasPartnerDebts ? (
                      block.obligations.map((o) => (
                        <div key={o.origin} className="flex justify-between">
                          <span className="truncate">{o.origin}</span>
                          <span className="tabular-nums">{formatCurrency(o.remaining)}</span>
                        </div>
                      ))
                    ) : (
                      <div className="flex justify-between">
                        <span className="truncate">{techName}</span>
                        <span className="tabular-nums">{formatCurrency(payableToTechnician)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* C) PAGAMENTOS REALIZADOS — cumulative, grouped by entity */}
                <div className="rounded-lg border border-border/40 bg-muted/20 px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                      Pagamentos realizados
                    </span>
                  </div>
                  <div className="text-base font-bold tabular-nums text-foreground">
                    {formatCurrency(block.paymentsByEntity.reduce((s, p) => s + p.amount, 0))}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
                    {block.paymentsByEntity.length === 0 ? (
                      <div className="italic">Nenhum pagamento registado</div>
                    ) : (
                      block.paymentsByEntity.map((p) => (
                        <div key={p.entity} className="flex justify-between">
                          <span className="truncate">{p.entity}</span>
                          <span className="tabular-nums">{formatCurrency(p.amount)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Technician payment dialog */}
            <Dialog open={showTechPay} onOpenChange={setShowTechPay}>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>Pagar {techName}</DialogTitle>
                </DialogHeader>
                <div className="py-2 space-y-3">
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div className="flex justify-between"><span>Caixa disponível</span><span className="tabular-nums">{formatCurrency(effectiveCash)}</span></div>
                    <div className="flex justify-between"><span>A pagar (sugerido)</span><span className="tabular-nums">{formatCurrency(payableToTechnician)}</span></div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Valor</Label>
                    <Input
                      type="number"
                      step="0.01"
                      autoFocus
                      value={techPayInput}
                      onChange={(e) => setTechPayInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleTechPayment(); }}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowTechPay(false)}>Cancelar</Button>
                  <Button onClick={handleTechPayment}>Confirmar</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>

      {/* Delete year confirm */}
      <AlertDialog open={showDeleteYear} onOpenChange={setShowDeleteYear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza que deseja excluir?</AlertDialogTitle>
            <AlertDialogDescription>
              Todos os dados do período <strong>{block.year}</strong> (receitas, despesas e movimentações) serão removidos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => onDeleteYear(block.year)}>
              Sim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete movements confirm */}
      <AlertDialog open={showDeleteMovements} onOpenChange={setShowDeleteMovements}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tem certeza que deseja excluir?</AlertDialogTitle>
            <AlertDialogDescription>
              Todas as movimentações de <strong>{block.year}</strong> serão removidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Não</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDeleteAllMovements}>
              Sim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/* ── Year Revenue Section ──
   Reads ONLY from the canonical aggregation (single source of truth).
   No manual Expected/Received/Difference inputs — those caused 1¢ drift. */
function YearRevenueSection({ year, expected, received, onSave, formatCurrency, derivedAgg }: {
  year: string; expected: number; received: number;
  onSave: (year: string, type: string, amount: number) => void;
  formatCurrency: (v: number) => string;
  derivedAgg?: ParticipantAgg;
}) {
  const exp = derivedAgg?.expected ?? 0;
  const rec = derivedAgg?.received ?? 0;
  const diff = derivedAgg?.difference ?? 0;
  const diffTone =
    diff > 0 ? "text-destructive"
    : diff < 0 ? "text-emerald-400"
    : "text-foreground";

  return (
    <div className="space-y-2">
      <h4 className="text-xs text-muted-foreground uppercase tracking-wider font-medium flex items-center gap-1">
        <TrendingUp className="h-3 w-3" /> Receitas
      </h4>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Esperada</span>
          <div className="h-8 flex items-center justify-end px-3 text-sm font-medium tabular-nums rounded-md border border-border/50 bg-muted/30 text-foreground">
            {formatCurrency(exp)}
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Recebida</span>
          <div className="h-8 flex items-center justify-end px-3 text-sm font-medium tabular-nums rounded-md border border-border/50 bg-muted/30 text-foreground">
            {formatCurrency(rec)}
          </div>
        </div>
        <div className="space-y-1">
          <span className="text-xs text-muted-foreground">Diferença</span>
          <div className={`h-8 flex items-center justify-end px-3 text-sm font-medium tabular-nums rounded-md border border-border/50 bg-muted/30 ${diffTone}`}>
            {diff > 0 ? "-" : diff < 0 ? "+" : ""}{formatCurrency(Math.abs(diff))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DerivedCell({ label, value, formatCurrency, tone = "neutral" }: {
  label: string; value: number; formatCurrency: (v: number) => string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const color = tone === "positive" ? "text-emerald-400" : tone === "negative" ? "text-destructive" : "text-muted-foreground";
  return (
    <div className="space-y-0.5">
      <span className="text-[10px] text-muted-foreground/70 uppercase tracking-wider">{label}</span>
      <div className={`h-7 flex items-center justify-end px-3 text-xs font-medium tabular-nums rounded-md bg-muted/20 ${color}`}>
        {formatCurrency(Math.abs(value))}
      </div>
    </div>
  );
}

/* ── Phase 5C refinement: minimalist hover-only "+" matching trash icon style ── */
function AddPeriodInline({
  compact = false,
  existingYears,
  onAddYear,
}: {
  compact?: boolean;
  existingYears: string[];
  onAddYear: (year?: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [yearInput, setYearInput] = useState("");
  const currentYear = new Date().getFullYear();
  void compact;
  const suggestions = useMemo(() => {
    const set = new Set<number>();
    set.add(currentYear - 1);
    set.add(currentYear);
    set.add(currentYear + 1);
    existingYears.forEach((y) => { const n = parseInt(y); if (!isNaN(n)) set.add(n); });
    return Array.from(set).sort((a, b) => a - b);
  }, [existingYears, currentYear]);

  const submit = () => {
    const n = parseInt(yearInput.trim());
    if (isNaN(n) || n < 1900 || n > 2999) {
      toast.error("Ano inválido — use 4 dígitos (ex.: 2025)");
      return;
    }
    onAddYear(n);
    setYearInput("");
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setYearInput(""); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Novo período"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 data-[state=open]:opacity-100 transition-opacity p-1 rounded hover:bg-primary/10"
          onClick={(e) => e.stopPropagation()}
        >
          <Plus className="h-3.5 w-3.5 text-muted-foreground hover:text-primary transition-colors" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        collisionPadding={12}
        className="w-auto max-w-[calc(100vw-24px)] p-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            autoFocus
            className="h-7 w-24 text-xs"
            placeholder="Ano (2025)"
            value={yearInput}
            onChange={(e) => setYearInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") { setOpen(false); setYearInput(""); }
            }}
          />
          <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={submit}>
            Criar
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1 mt-2">
          {suggestions.map((y) => (
            <button
              key={y}
              type="button"
              className="text-[10px] px-1.5 py-0.5 rounded bg-muted/40 hover:bg-primary/15 text-muted-foreground hover:text-primary transition-colors"
              onClick={() => setYearInput(String(y))}
            >
              {y}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
