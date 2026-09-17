import { useState, useEffect, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Save, Trash2, Lock, Minimize2, AlertCircle, CheckCircle2,
  User as UserIcon, Phone, Mail, FileSignature,
  Car, Hash as HashIcon, CalendarDays, CalendarClock,
  Wrench, ClipboardList, Package, Coins, UserCog, FileText, Shield,
  Play, Pause, CheckCheck, Plus as PlusIcon, Clock, History, AlertTriangle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  useProductionOrders, PRODUCTION_STATUSES, PRIORITY_META, isOrderLocked,
  type ProductionOrder, type ProductionStatus, type ProductionPriority,
} from "@/hooks/useProductionOrders";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useAutosave } from "@/hooks/useAutosave";
import { PhotoUploader } from "./PhotoUploader";
import { OrderTimeline } from "./OrderTimeline";
import { FileUploadZone } from "@/components/service-orders/FileUploadZone";
import { useExtractProductionOrder } from "@/hooks/useExtractProductionOrder";
import { formatBRL } from "./BudgetDialog";
import { useBudget, type ApiBudget, type ApiBudgetRevision } from "@/hooks/useBudgets";

interface Props {
  order: ProductionOrder | null;
  onClose: () => void;
}

const BUDGET_NOTES_DELIMITER = "--- DADOS DO ORÇAMENTO (NÃO REMOVER ESTA LINHA) ---";

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseBRFloat(s: string): number {
  if (!s) return 0;
  return Number(s.replace(/\./g, "").replace(",", ".")) || 0;
}

function splitNotes(raw: string | null | undefined): { internal: string; budget: string } {
  if (!raw) return { internal: "", budget: "" };
  const idx = raw.indexOf(BUDGET_NOTES_DELIMITER);
  if (idx < 0) return { internal: raw, budget: "" };
  return {
    internal: raw.slice(0, idx).trimEnd(),
    budget: raw.slice(idx + BUDGET_NOTES_DELIMITER.length).trimStart(),
  };
}

function mergeNotes(internal: string, budgetSerialized: string): string {
  const parts: string[] = [];
  if (internal.trim()) parts.push(internal.trim());
  parts.push(BUDGET_NOTES_DELIMITER);
  if (budgetSerialized.trim()) parts.push(budgetSerialized.trim());
  return parts.join("\n\n");
}

function parseSection(budgetNotes: string, title: string): string {
  if (!budgetNotes) return "";
  const re = new RegExp(`===\\s*${escapeRegex(title)}\\s*===\\s*\\n([\\s\\S]*?)(?=\\n===\\s|$)`);
  const m = budgetNotes.match(re);
  return m ? m[1].trim() : "";
}

interface ParsedBudgetLineParts {
  desc: string; qty: number; unit: number; total: number;
}
interface ParsedBudgetLineLabor {
  desc: string; hours: number; rate: number; total: number;
}
interface ParsedBudgetTotals {
  gross: number; discount: number; net: number; iva: number; total: number;
  discountPct: number; ivaPct: number;
}
interface ParsedBudgetData {
  budgetNumber: string;
  issuedAt: string;
  client: { name: string; phone: string; email: string; document: string };
  vehicle: {
    brand: string; model: string; plate: string; vin: string;
    year: string; color: string; km: string;
  };
  interventionType: string;
  diagnosis: string;
  technicalDescription: string;
  parts: ParsedBudgetLineParts[];
  partsSubtotal: number;
  labor: ParsedBudgetLineLabor[];
  laborSubtotal: number;
  totals: ParsedBudgetTotals;
  origin: string;
}

function parseBudgetSerialized(budgetNotes: string): ParsedBudgetData {
  const header = budgetNotes.split("===")[0] ?? "";
  const budgetNumber = header.match(/Orçamento:\s*([^\n]+)/)?.[1]?.trim() ?? "";
  const issuedAt = header.match(/Data emissão:\s*([^\n]+)/)?.[1]?.trim() ?? "";

  const clienteSec = parseSection(budgetNotes, "CLIENTE");
  const client: ParsedBudgetData["client"] = {
    name: clienteSec.match(/Nome:\s*([^\n]+)/)?.[1]?.trim() ?? "",
    phone: clienteSec.match(/Contacto:\s*([^\n]+)/)?.[1]?.trim()
      ?? clienteSec.match(/Telefone:\s*([^\n]+)/)?.[1]?.trim() ?? "",
    email: clienteSec.match(/E-mail:\s*([^\n]+)/)?.[1]?.trim() ?? "",
    document: clienteSec.match(/Documento:\s*([^\n]+)/)?.[1]?.trim() ?? "",
  };

  const vSec = parseSection(budgetNotes, "VEÍCULO");
  const vehicle: ParsedBudgetData["vehicle"] = {
    brand: vSec.match(/Marca:\s*([^\n]+)/)?.[1]?.trim() ?? "",
    model: vSec.match(/Modelo:\s*([^\n]+)/)?.[1]?.trim() ?? "",
    plate: vSec.match(/Matrícula:\s*([^\n]+)/)?.[1]?.trim()
      ?? vSec.match(/Placa:\s*([^\n]+)/)?.[1]?.trim() ?? "",
    vin: vSec.match(/VIN:\s*([^\n]+)/)?.[1]?.trim() ?? "",
    year: vSec.match(/Ano:\s*([^\n]+)/)?.[1]?.trim() ?? "",
    color: vSec.match(/Cor:\s*([^\n]+)/)?.[1]?.trim() ?? "",
    km: vSec.match(/KM:\s*([^\n]+)/)?.[1]?.trim() ?? "",
  };

  const interventionType = parseSection(budgetNotes, "INTERVENÇÃO").trim()
    || parseSection(budgetNotes, "TIPO DE INTERVENÇÃO").trim();

  const diagnosis = parseSection(budgetNotes, "DIAGNÓSTICO").trim();
  const technicalDescription = parseSection(budgetNotes, "DESCRIÇÃO TÉCNICA").trim();

  const partsSec = parseSection(budgetNotes, "PEÇAS / MATERIAIS");
  const parts: ParsedBudgetLineParts[] = [];
  const partsRe = /^\d+\.\s*(.+?)\s*·\s*Qtd\s*([\d.,]+)\s*×\s*R\$\s*([\d.,]+)\s*=\s*R\$\s*([\d.,]+)/gm;
  let pm: RegExpExecArray | null;
  while ((pm = partsRe.exec(partsSec)) !== null) {
    parts.push({
      desc: pm[1].trim(),
      qty: parseBRFloat(pm[2]),
      unit: parseBRFloat(pm[3]),
      total: parseBRFloat(pm[4]),
    });
  }
  const partsSubtotal = parseBRFloat(
    partsSec.match(/Subtotal Peças:\s*R\$\s*([\d.,]+)/)?.[1] ?? "0",
  );

  const laborSec = parseSection(budgetNotes, "MÃO DE OBRA");
  const labor: ParsedBudgetLineLabor[] = [];
  const laborRe = /^\d+\.\s*(.+?)\s*·\s*([\d.,]+)h\s*×\s*R\$\s*([\d.,]+)\/h\s*=\s*R\$\s*([\d.,]+)/gm;
  let lm: RegExpExecArray | null;
  while ((lm = laborRe.exec(laborSec)) !== null) {
    labor.push({
      desc: lm[1].trim(),
      hours: parseBRFloat(lm[2]),
      rate: parseBRFloat(lm[3]),
      total: parseBRFloat(lm[4]),
    });
  }
  const laborSubtotal = parseBRFloat(
    laborSec.match(/Subtotal Mão de Obra:\s*R\$\s*([\d.,]+)/)?.[1] ?? "0",
  );

  const totSec = parseSection(budgetNotes, "TOTAIS");
  const gross = parseBRFloat(
    totSec.match(/Subtotal \(Peças \+ M\.O\.\):\s*R\$\s*([\d.,]+)/)?.[1] ?? "0",
  );
  const discountPct = parseBRFloat(totSec.match(/Desconto \(([\d.,]+)%\)/)?.[1] ?? "0");
  const discount = parseBRFloat(
    totSec.match(/Desconto \([\d.,]+%\):\s*-\s*R\$\s*([\d.,]+)/)?.[1] ?? "0",
  );
  const net = parseBRFloat(totSec.match(/Base tributável:\s*R\$\s*([\d.,]+)/)?.[1] ?? "0");
  const ivaPct = parseBRFloat(totSec.match(/IVA \(([\d.,]+)%\)/)?.[1] ?? "0");
  const iva = parseBRFloat(
    totSec.match(/IVA \([\d.,]+%\):\s*\+\s*R\$\s*([\d.,]+)/)?.[1] ?? "0",
  );
  const total = parseBRFloat(totSec.match(/TOTAL DO ORÇAMENTO:\s*R\$\s*([\d.,]+)/)?.[1] ?? "0");

  const originM = budgetNotes.match(/Origem:\s*([^\n]+)/);
  const origin = originM ? originM[1].trim() : "";

  return {
    budgetNumber, issuedAt, client, vehicle,
    interventionType, diagnosis, technicalDescription,
    parts, partsSubtotal, labor, laborSubtotal,
    totals: { gross, discount, net, iva, total, discountPct, ivaPct },
    origin,
  };
}

function hasAnyBudgetData(d: ParsedBudgetData): boolean {
  return !!(
    d.budgetNumber || d.client.name || d.vehicle.brand || d.vehicle.model ||
    d.interventionType || d.diagnosis || d.technicalDescription ||
    d.parts.length || d.labor.length || d.totals.total
  );
}

function emptyParsedBudgetData(): ParsedBudgetData {
  return {
    budgetNumber: "",
    issuedAt: "",
    client: { name: "", phone: "", email: "", document: "" },
    vehicle: { brand: "", model: "", plate: "", vin: "", year: "", color: "", km: "" },
    interventionType: "",
    diagnosis: "",
    technicalDescription: "",
    parts: [],
    partsSubtotal: 0,
    labor: [],
    laborSubtotal: 0,
    totals: { gross: 0, discount: 0, net: 0, iva: 0, total: 0, discountPct: 0, ivaPct: 0 },
    origin: "",
  };
}

function mapBudgetRevisionToParsed(
  budget: ApiBudget,
  revision: ApiBudgetRevision,
): ParsedBudgetData {
  const clientSnap = (revision.clientSnapshot ?? revision.client_snapshot ?? {}) as Record<string, any>;
  const vehicleSnap = (revision.vehicleSnapshot ?? revision.vehicle_snapshot ?? {}) as Record<string, any>;

  const clientName = clientSnap.name || clientSnap.client_name || budget.clientName || budget.client_name || "";
  const clientPhone = clientSnap.phone || clientSnap.client_phone || clientSnap.contact || "";
  const clientEmail = clientSnap.email || clientSnap.client_email || "";
  const clientDocument = clientSnap.document || clientSnap.client_document || clientSnap.doc || clientSnap.cpf || clientSnap.cnpj || "";

  const vehicleBrand = vehicleSnap.brand || vehicleSnap.vehicle_brand || budget.vehicleBrand || budget.vehicle_brand || "";
  const vehicleModel = vehicleSnap.model || vehicleSnap.vehicle_model || budget.vehicleModel || budget.vehicle_model || "";
  const vehiclePlate = vehicleSnap.plate || vehicleSnap.vehicle_plate || vehicleSnap.license_plate || budget.vehiclePlate || budget.vehicle_plate || "";
  const vehicleVin = vehicleSnap.vin || vehicleSnap.vehicle_vin || budget.vehicleVin || budget.vehicle_vin || "";
  const vehicleYear = vehicleSnap.year ? String(vehicleSnap.year) : (vehicleSnap.vehicle_year ? String(vehicleSnap.vehicle_year) : "");
  const vehicleColor = vehicleSnap.color || vehicleSnap.vehicle_color || "";
  const vehicleKm = vehicleSnap.km ? String(vehicleSnap.km) : (vehicleSnap.vehicle_km ? String(vehicleSnap.vehicle_km) : "");

  const interventionList = Array.isArray(revision.interventionTypes) && revision.interventionTypes.length > 0
    ? revision.interventionTypes
    : (Array.isArray(revision.intervention_types) && revision.intervention_types.length > 0
        ? revision.intervention_types
        : []);
  const interventionType = interventionList.join(", ") || revision.budgetType || revision.budget_type || "";

  const diagnosis = revision.diagnosis ?? "";
  const technicalDescription = revision.technicalDescription ?? revision.technical_description ?? "";

  const partsRaw = Array.isArray(revision.parts) ? revision.parts : [];
  const servicesRaw = Array.isArray(revision.services) ? revision.services : [];
  const parts: ParsedBudgetLineParts[] = [
    ...partsRaw.map((p: any) => {
      const qty = Number(p.quantity ?? p.qty ?? 1) || 0;
      const unit = Number(p.unit_price ?? p.unitPrice ?? p.unit ?? 0) || 0;
      const total = Number(p.total ?? (qty * unit)) || 0;
      return {
        desc: String(p.description || p.desc || "Peça"),
        qty,
        unit,
        total,
      };
    }),
    ...servicesRaw.map((s: any) => {
      const qty = Number(s.quantity ?? s.qty ?? 1) || 0;
      const unit = Number(s.unit_price ?? s.unitPrice ?? s.unit ?? 0) || 0;
      const total = Number(s.total ?? (qty * unit)) || 0;
      return {
        desc: String(s.description || s.desc || "Serviço"),
        qty,
        unit,
        total,
      };
    }),
  ];
  const partsSubtotal = parts.reduce((acc, curr) => acc + curr.total, 0);

  const laborRaw = Array.isArray(revision.labor) ? revision.labor : [];
  const labor: ParsedBudgetLineLabor[] = laborRaw.map((l: any) => {
    const hours = Number(l.hours ?? 0) || 0;
    const rate = Number(l.hourly_rate ?? l.hourlyRate ?? l.rate ?? 0) || 0;
    const total = Number(l.total ?? (hours * rate)) || 0;
    return {
      desc: String(l.description || l.desc || "Mão de Obra"),
      hours,
      rate,
      total,
    };
  });
  const laborSubtotal = labor.reduce((acc, curr) => acc + curr.total, 0);

  const gross = Number(revision.grossTotal ?? revision.gross_total ?? (partsSubtotal + laborSubtotal)) || 0;
  const discountPct = Number(revision.discountPct ?? revision.discount_pct ?? 0) || 0;
  const discount = Number(revision.discountTotal ?? revision.discount_total ?? 0) || 0;
  const net = Number(revision.netTotal ?? revision.net_total ?? 0) || 0;
  const ivaPct = Number(revision.taxPct ?? revision.tax_pct ?? 0) || 0;
  const iva = Number(revision.taxTotal ?? revision.tax_total ?? 0) || 0;
  const total = Number(revision.finalTotal ?? revision.final_total ?? 0) || 0;

  const revNum = revision.revisionNumber ?? revision.revision_number ?? 1;
  const statusLabel = revision.status === "approved" ? "Aprovada" : revision.status;
  const origin = `Orçamento Oficial: ${budget.code} (Revisão ${revNum} · ${statusLabel})`;

  return {
    budgetNumber: budget.code || "",
    issuedAt: revision.createdAt || revision.created_at || budget.createdAt || budget.created_at || "",
    client: {
      name: clientName,
      phone: clientPhone,
      email: clientEmail,
      document: clientDocument,
    },
    vehicle: {
      brand: vehicleBrand,
      model: vehicleModel,
      plate: vehiclePlate,
      vin: vehicleVin,
      year: vehicleYear,
      color: vehicleColor,
      km: vehicleKm,
    },
    interventionType,
    diagnosis,
    technicalDescription,
    parts,
    partsSubtotal,
    labor,
    laborSubtotal,
    totals: {
      gross,
      discount,
      net,
      iva,
      total,
      discountPct,
      ivaPct,
    },
    origin,
  };
}

function fmtDatePTBR(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function fmtDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 16);
  } catch {
    return "";
  }
}

function BoardStatusDot({ status }: { status: ProductionStatus }) {
  const boardDot: Record<ProductionStatus, string> = {
    new_vehicle: "bg-slate-500",
    triage: "bg-slate-500",
    awaiting_validation: "bg-slate-500",
    in_production: "bg-indigo-500",
    paused: "bg-amber-500",
    finished: "bg-sky-500",
    invoiced: "bg-sky-500",
    delivered: "bg-emerald-500",
  };
  return <span className={`inline-block h-2 w-2 rounded-full ${boardDot[status] ?? "bg-slate-400"}`} />;
}

type StepOperationalStatus = "waiting" | "running" | "paused" | "done";
const STEP_OPERATIONAL_LABEL: Record<StepOperationalStatus, string> = {
  waiting: "Aguardando",
  running: "Em execução",
  paused: "Pausado",
  done: "Concluído",
};
const STEP_OPERATIONAL_TONE: Record<StepOperationalStatus, string> = {
  waiting: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-900/40 dark:text-slate-300 dark:border-slate-700",
  running: "bg-indigo-100 text-indigo-700 border-indigo-300 dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/30",
  paused: "bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
  done: "bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30",
};
const STEP_OPERATIONAL_DOT: Record<StepOperationalStatus, string> = {
  waiting: "bg-slate-500",
  running: "bg-indigo-500",
  paused: "bg-amber-500",
  done: "bg-emerald-500",
};

interface StepNoteEntry {
  at: string;
  by: string | null;
  text: string;
}
interface ServiceStep {
  id: string;
  description: string;
  responsible_id: string | null;
  responsible_name: string | null;
  operational_status: StepOperationalStatus;
  started_at: string | null;
  finished_at: string | null;
  execution_notes: StepNoteEntry[];
}
interface ServiceExecution {
  service_done: boolean;
  steps: ServiceStep[];
  overall_notes: StepNoteEntry[];
}

const EXECUTION_SECTION_HEADER = "--- EXECUÇÃO DO SERVIÇO (NÃO REMOVER ESTA LINHA) ---";
const EXECUTION_SECTION_FOOTER = "--- FIM EXECUÇÃO DO SERVIÇO ---";

function encodeExecution(ex: ServiceExecution): string {
  const json = JSON.stringify(ex);
  const b64 = typeof window !== "undefined" && typeof window.btoa === "function"
    ? window.btoa(unescape(encodeURIComponent(json)))
    : Buffer.from(json, "utf-8").toString("base64");
  return `${EXECUTION_SECTION_HEADER}\n${b64}\n${EXECUTION_SECTION_FOOTER}`;
}
function tryDecodeExecution(s: string | null | undefined): ServiceExecution | null {
  if (!s) return null;
  const start = s.indexOf(EXECUTION_SECTION_HEADER);
  if (start < 0) return null;
  const slice = s.slice(start + EXECUTION_SECTION_HEADER.length);
  const end = slice.indexOf(EXECUTION_SECTION_FOOTER);
  const payload = (end >= 0 ? slice.slice(0, end) : slice).trim();
  if (!payload) return null;
  try {
    const raw = typeof window !== "undefined" && typeof window.atob === "function"
      ? decodeURIComponent(escape(window.atob(payload)))
      : Buffer.from(payload, "base64").toString("utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    return {
      service_done: !!parsed.service_done,
      steps: steps
        .filter((x) => x && typeof x === "object")
        .map((x) => ({
          id: String(x.id ?? crypto.randomUUID()),
          description: String(x.description ?? "Serviço sem descrição"),
          responsible_id: x.responsible_id ? String(x.responsible_id) : null,
          responsible_name: x.responsible_name ? String(x.responsible_name) : null,
          operational_status: (
            ["waiting", "running", "paused", "done"].includes(String(x.operational_status))
              ? x.operational_status
              : "waiting"
          ) as StepOperationalStatus,
          started_at: x.started_at ? String(x.started_at) : null,
          finished_at: x.finished_at ? String(x.finished_at) : null,
          execution_notes: Array.isArray(x.execution_notes)
            ? x.execution_notes
                .filter((n) => n && typeof n === "object" && typeof n.text === "string")
                .map((n) => ({
                  at: String(n.at ?? new Date().toISOString()),
                  by: n.by ? String(n.by) : null,
                  text: String(n.text),
                }))
            : [],
        })),
      overall_notes: Array.isArray(parsed.overall_notes)
        ? parsed.overall_notes
            .filter((n) => n && typeof n === "object" && typeof n.text === "string")
            .map((n) => ({
              at: String(n.at ?? new Date().toISOString()),
              by: n.by ? String(n.by) : null,
              text: String(n.text),
            }))
        : [],
    };
  } catch {
    return null;
  }
}
function stripExecutionSection(s: string | null | undefined): string {
  if (!s) return "";
  const start = s.indexOf(EXECUTION_SECTION_HEADER);
  if (start < 0) return s;
  const end = s.indexOf(EXECUTION_SECTION_FOOTER, start);
  if (end < 0) return s.slice(0, start).trimEnd();
  return (s.slice(0, start) + s.slice(end + EXECUTION_SECTION_FOOTER.length)).trimEnd();
}
function stripBudgetAndExecutionForInternal(raw: string | null | undefined): string {
  if (!raw) return "";
  const idx = raw.indexOf(BUDGET_NOTES_DELIMITER);
  if (idx < 0) {
    return stripExecutionSection(raw).trimEnd();
  }
  return stripExecutionSection(raw.slice(0, idx)).trimEnd();
}
function rebuildNotesFromParts({
  internal,
  budget,
  execution,
}: {
  internal: string;
  budget: string;
  execution: ServiceExecution | null;
}): string {
  const blocks: string[] = [];
  if (internal.trim()) blocks.push(internal.trim());
  blocks.push(BUDGET_NOTES_DELIMITER);
  if (budget.trim()) blocks.push(budget.trim());
  if (execution) blocks.push(encodeExecution(execution));
  return blocks.join("\n\n");
}

function splitBudgetOnlyAfterExecution(
  raw: string | null | undefined,
): { internal: string; budget: string } {
  if (!raw) return { internal: "", budget: "" };
  const noExec = stripExecutionSection(raw);
  return splitNotes(noExec);
}

function emptyStep(description: string, fallbackResponsibleName: string | null = null): ServiceStep {
  return {
    id: crypto.randomUUID(),
    description,
    responsible_id: null,
    responsible_name: fallbackResponsibleName,
    operational_status: "waiting",
    started_at: null,
    finished_at: null,
    execution_notes: [],
  };
}

export function mapFinalizeError(err: any): string {
  const code = err?.code;
  const status = err?.status;

  if (code === "OPERATIONAL_SITE_REQUIRED") {
    return "Local operacional não configurado na ordem (siteKey obrigatório).";
  }
  if (code === "CURRENCY_REQUIRED") {
    return "Código de moeda não configurado ou inválido (currencyCode obrigatório).";
  }
  if (code === "CLIENT_REQUIRED") {
    return "Cliente não vinculado à ordem de produção.";
  }
  if (code === "DIRECT_OP_NO_SERVICES") {
    return "Ordem direta exige ao menos um serviço estruturado na execução.";
  }
  if (code === "DIRECT_OP_SERVICE_TOTAL_MISMATCH") {
    return "Soma dos serviços estruturados difere do valor total da ordem.";
  }
  if (code === "UNAPPROVED_BUDGET_REVISION") {
    return "Apenas ordens com revisão de orçamento aprovada podem ser finalizadas.";
  }
  if (code === "BUDGET_LINEAGE_INVALID") {
    return "Vínculo de orçamento ou revisão inconsistente.";
  }
  if (code === "CANNOT_FINALIZE_STATUS") {
    return "Apenas ordens em produção ou pausadas podem ser finalizadas.";
  }
  if (status === 403) {
    return "Acesso negado: você não tem permissão para finalizar esta ordem.";
  }
  if (status === 409) {
    return err?.message || "Conflito: o estado atual da ordem não permite finalização.";
  }
  if (status === 422) {
    return err?.message || "Dados inconsistentes para finalização da ordem.";
  }
  return err?.message || "Erro inesperado ao finalizar a ordem de produção.";
}

export function OrderDetailDialog({ order, onClose }: Props) {
  const { update, remove, create, finalize } = useProductionOrders();
  const [isFinalizing, setIsFinalizing] = useState(false);
  const { members: membersRaw } = useWorkspace();
  const members = Array.isArray(membersRaw) ? membersRaw : [];
  const [form, setForm] = useState<Partial<ProductionOrder>>({});
  const [internalNotes, setInternalNotes] = useState("");
  const [activeTab, setActiveTab] = useState("ficha");
  const [promotedId, setPromotedId] = useState<string | null>(null);
  const isNew = order?.id === "__new__" && !promotedId;
  const effectiveOrderId = promotedId ?? (isNew ? null : order?.id ?? null);
  const locked = !isNew && !promotedId && isOrderLocked(order?.status);
  const { extract, isExtracting } = useExtractProductionOrder();
  const [ocrStatus, setOcrStatus] = useState<{ type: "error" | "success"; message: string } | null>(null);

  const sessionDraftId = useRef(crypto.randomUUID());
  const resolvedDraftId = sessionDraftId.current;

  const draftKey = useMemo(
    () => isNew ? `production-draft-new-${resolvedDraftId}` : `production-draft-${order?.id ?? "noop"}`,
    [isNew, order?.id, resolvedDraftId],
  );

  const { clear: clearDraft } = useAutosave<Partial<ProductionOrder>>(
    draftKey,
    form,
    setForm,
    600,
  );

  const activeBudgetId = order?.budgetId ?? order?.budget_id ?? null;
  const { data: budgetData } = useBudget(activeBudgetId);

  const activeRevision = useMemo(() => {
    if (!budgetData) return null;
    const targetRevId = order?.budgetRevisionId ?? order?.budget_revision_id ?? null;
    if (targetRevId && Array.isArray(budgetData.revisions)) {
      const found = budgetData.revisions.find((r) => r.id === targetRevId);
      if (found) return found;
    }
    return (
      budgetData.approvedRevision ??
      budgetData.approved_revision ??
      budgetData.currentRevision ??
      budgetData.current_revision ??
      null
    );
  }, [budgetData, order?.budgetRevisionId, order?.budget_revision_id]);

  const initialParsedBudget = useMemo(() => {
    if (budgetData && activeRevision) {
      return mapBudgetRevisionToParsed(budgetData, activeRevision);
    }
    if (!order?.notes) return null;
    const { budget } = splitBudgetOnlyAfterExecution(order.notes);
    if (!budget) return null;
    return parseBudgetSerialized(budget);
  }, [budgetData, activeRevision, order?.notes]);

  const [execution, setExecution] = useState<ServiceExecution | null>(() => {
    if (!order?.notes) return null;
    return tryDecodeExecution(order.notes);
  });

  useEffect(() => {
    if (!order) return;
    const internal = stripBudgetAndExecutionForInternal(order.notes ?? "");
    setInternalNotes(internal);
    setForm(order);
    setActiveTab("ficha");
    setPromotedId(null);
    const decoded = tryDecodeExecution(order.notes);
    if (decoded) {
      setExecution(decoded);
    } else {
      const budgetP = splitBudgetOnlyAfterExecution(order.notes).budget;
      const data = budgetP ? parseBudgetSerialized(budgetP) : null;
      const fallbackTech = order.technician_name ?? null;
      const initial: ServiceExecution = {
        service_done: false,
        steps: (data?.labor?.length ?? 0) > 0
          ? data!.labor.map((l) => emptyStep(
              l.desc?.trim() || "Serviço sem descrição",
              fallbackTech,
            ))
          : [],
        overall_notes: [],
      };
      setExecution(
        initial.steps.length ? initial : (order.notes ? null : { service_done: false, steps: [], overall_notes: [] }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id]);

  const parsed = useMemo(() => {
    if (budgetData && activeRevision) {
      return mapBudgetRevisionToParsed(budgetData, activeRevision);
    }
    if (order?.notes) {
      const { budget } = splitBudgetOnlyAfterExecution(order.notes);
      if (budget) {
        return parseBudgetSerialized(budget);
      }
    }
    return emptyParsedBudgetData();
  }, [budgetData, activeRevision, order?.notes]);

  const executionSafe: ServiceExecution = useMemo(() => {
    if (execution) return execution;
    const fallbackTech = (form.technician_name ?? order?.technician_name ?? null);
    const parsedBudget = initialParsedBudget ?? parsed;
    const derivedSteps =
      parsedBudget?.labor?.length
        ? parsedBudget.labor.map((l) =>
            emptyStep(l.desc?.trim() || "Serviço sem descrição", fallbackTech),
          )
        : [];
    return {
      service_done: false,
      steps: derivedSteps,
      overall_notes: [],
    };
  }, [execution, form.technician_name, order?.technician_name, initialParsedBudget, parsed]);

  if (!order) return null;

  const budgetHydrated = hasAnyBudgetData(parsed);
  const serviceDoneLocked = executionSafe.service_done;

  const displayClientName =
    parsed.client.name?.trim() || form.client_name || order.client_name || "—";
  const displayClientPhone = parsed.client.phone?.trim() || "—";
  const displayClientEmail = parsed.client.email?.trim() || "—";
  const displayClientDoc = parsed.client.document?.trim() || "—";

  const displayBrand = parsed.vehicle.brand?.trim() || form.brand || order.brand || "—";
  const displayModel = parsed.vehicle.model?.trim() || form.model || order.model || "—";
  const displayPlate = parsed.vehicle.plate?.trim() || form.license_plate || order.license_plate || "—";
  const displayVin = parsed.vehicle.vin?.trim() || form.vin || order.vin || "—";
  const displayYear = parsed.vehicle.year?.trim() || "—";
  const displayColor = parsed.vehicle.color?.trim() || form.color || order.color || "—";
  const displayKm = parsed.vehicle.km?.trim() || "—";

  const displayIntervention =
    parsed.interventionType?.trim() || form.insurer || order.insurer || "—";
  const displayDiagnosis = parsed.diagnosis?.trim() || "—";
  const displayTechnical = parsed.technicalDescription?.trim() || "—";
  const displayBudgetNumber = parsed.budgetNumber?.trim()
    || order.code || "(sem orçamento atrelado)";
  const displayOSNumber = order.code || order.id.slice(0, 8).toUpperCase();

  const set = <K extends keyof ProductionOrder>(k: K, v: ProductionOrder[K]) => {
    if (locked) return;
    setForm(f => ({ ...f, [k]: v }));
  };

  const updateStep = (id: string, patch: Partial<ServiceStep>) => {
    if (locked || serviceDoneLocked) return;
    setExecution((e) => {
      const base = e ?? executionSafe;
      return {
        ...base,
        steps: base.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      };
    });
  };
  const addStep = () => {
    if (locked || serviceDoneLocked) return;
    const fallbackTech = (form.technician_name ?? order.technician_name ?? null);
    const s = emptyStep("Novo serviço", fallbackTech);
    setExecution((e) => {
      const base = e ?? executionSafe;
      return { ...base, steps: [...base.steps, s] };
    });
  };
  const removeStep = (id: string) => {
    if (locked || serviceDoneLocked) return;
    if (!confirm("Remover este serviço da execução?")) return;
    setExecution((e) => {
      const base = e ?? executionSafe;
      return { ...base, steps: base.steps.filter((s) => s.id !== id) };
    });
  };
  const appendStepNote = (id: string, text: string, authorName: string | null) => {
    if (locked || serviceDoneLocked) return;
    if (!text.trim()) return;
    const entry: StepNoteEntry = { at: new Date().toISOString(), by: authorName, text: text.trim() };
    setExecution((e) => {
      const base = e ?? executionSafe;
      return {
        ...base,
        steps: base.steps.map((s) =>
          s.id === id ? { ...s, execution_notes: [...s.execution_notes, entry] } : s,
        ),
      };
    });
  };
  const appendOverallNote = (text: string, authorName: string | null) => {
    if (locked || serviceDoneLocked) return;
    if (!text.trim()) return;
    const entry: StepNoteEntry = { at: new Date().toISOString(), by: authorName, text: text.trim() };
    setExecution((e) => {
      const base = e ?? executionSafe;
      return { ...base, overall_notes: [...base.overall_notes, entry] };
    });
  };
  const setStepStatus = (id: string, next: StepOperationalStatus) => {
    if (locked || serviceDoneLocked) return;
    const now = new Date().toISOString();
    const patch: Partial<ServiceStep> = { operational_status: next };
    const currentStep = executionSafe.steps.find((s) => s.id === id);
    if (!currentStep) return;
    if (next === "running" && !currentStep.started_at) patch.started_at = now;
    if (next === "paused" && !currentStep.started_at) patch.started_at = now;
    if (next === "done") {
      if (!currentStep.started_at) patch.started_at = now;
      patch.finished_at = now;
    }
    updateStep(id, patch);
  };
  const toggleServiceDone = (next: boolean) => {
    if (locked) return;
    if (next && executionSafe.steps.length > 0 && !executionSafe.steps.every((s) => s.operational_status === "done")) {
      if (!confirm("Há serviços que não foram marcados como Concluído. Deseja marcar a OS como concluída mesmo assim?")) return;
    }
    setExecution((e) => {
      const base = e ?? executionSafe;
      return { ...base, service_done: next };
    });
  };
  const progressPct = (() => {
    const steps = executionSafe.steps;
    if (!steps.length) return 0;
    const done = steps.filter((s) => s.operational_status === "done").length;
    return Math.round((done / steps.length) * 100);
  })();
  const runningCount = executionSafe.steps.filter((s) => s.operational_status === "running").length;
  const pausedCount = executionSafe.steps.filter((s) => s.operational_status === "paused").length;
  const waitingCount = executionSafe.steps.filter((s) => s.operational_status === "waiting").length;
  const doneCount = executionSafe.steps.filter((s) => s.operational_status === "done").length;
  const overallExecutionStatus: StepOperationalStatus = (() => {
    if (!executionSafe.steps.length) return "waiting";
    if (executionSafe.service_done) return "done";
    if (executionSafe.steps.every((s) => s.operational_status === "done")) return "done";
    if (runningCount > 0) return "running";
    if (pausedCount > 0) return "paused";
    return "waiting";
  })();
  const overallStarted = executionSafe.steps.reduce<string | null>((acc, s) => {
    if (!s.started_at) return acc;
    return !acc || s.started_at < acc ? s.started_at : acc;
  }, null);
  const overallFinished = executionSafe.steps.reduce<string | null>((acc, s) => {
    if (!s.finished_at) return acc;
    return !acc || s.finished_at > acc ? s.finished_at : acc;
  }, null);

  const authorNameForNotes = (form.technician_name ?? order.technician_name ?? null);

  const save = async () => {
    try {
      const { budget } = splitBudgetOnlyAfterExecution(order?.notes);
      const executionToWrite: ServiceExecution | null = (executionSafe.steps.length || executionSafe.overall_notes.length || executionSafe.service_done)
        ? executionSafe
        : null;
      const finalNotes = rebuildNotesFromParts({
        internal: internalNotes,
        budget,
        execution: executionToWrite,
      });
      const payload: Partial<ProductionOrder> = { ...form, notes: finalNotes };

      if (promotedId) {
        await update.mutateAsync({ id: promotedId, ...payload });
      } else if (isNew) {
        await create.mutateAsync(payload);
      } else {
        await update.mutateAsync({ id: order.id, ...payload });
      }
      clearDraft();
      toast.success("Ordem de produção salva.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar.");
    }
  };

  const handleTabChange = async (tab: string) => {
    if ((tab === "photos" || tab === "timeline") && order?.id === "__new__" && !promotedId) {
      try {
        const { budget } = splitBudgetOnlyAfterExecution(order?.notes);
        const executionToWrite: ServiceExecution | null = (executionSafe.steps.length || executionSafe.overall_notes.length || executionSafe.service_done)
          ? executionSafe
          : null;
        const finalNotes = rebuildNotesFromParts({
          internal: internalNotes,
          budget,
          execution: executionToWrite,
        });
        const created = await create.mutateAsync({ ...form, notes: finalNotes });
        setPromotedId(created.id);
        clearDraft();
        setActiveTab(tab);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Salve a ordem antes de adicionar fotos.");
      }
      return;
    }
    setActiveTab(tab);
  };

  const applyOcr = async (files: File[]) => {
    if (!files.length) return;
    setOcrStatus(null);
    try {
      const res = await extract(files[0]);
      const next: Partial<ProductionOrder> = {};
      const o = res.order;
      if (o.client && !form.client_name) next.client_name = o.client;
      if (o.platform && !form.platform) next.platform = o.platform;
      if (o.license_plate && !form.license_plate) next.license_plate = o.license_plate.toUpperCase();
      if (o.vin && !form.vin) next.vin = o.vin;
      if (o.brand && !form.brand) next.brand = o.brand;
      if (o.model && !form.model) next.model = o.model;
      if (o.color && !form.color) next.color = o.color;
      if (o.insurer && !form.insurer) next.insurer = o.insurer;
      if (o.vehicle_notes && !form.notes) next.notes = o.vehicle_notes;
      setForm((f) => ({ ...f, ...next }));
      const msg = res.confidence === "low"
        ? "Dados extraídos com baixa confiança — revise os campos antes de salvar."
        : "Dados extraídos com sucesso. Revise antes de salvar.";
      setOcrStatus({ type: "success", message: msg });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Falha no OCR.";
      setOcrStatus({ type: "error", message: msg });
    }
  };

  const minimize = () => {
    toast.success(isNew ? "Rascunho guardado · continua disponível" : "Ordem minimizada · continua ativa");
    onClose();
  };

  const handleRequestBudgetCorrection = async () => {
    if (!order?.id) return;
    if (!budgetHydrated) {
      toast.warning("Esta Ordem de Serviço não tem orçamento atrelado.");
      return;
    }
    if (locked) {
      toast.warning("Ordem bloqueada — não é possível solicitar correção.");
      return;
    }
    const reason = window.prompt(
      "Informe o motivo da correção (será enviado para o responsável pelo orçamento):",
    );
    if (reason == null) return;
    if (!reason.trim()) {
      toast.error("Motivo da correção é obrigatório.");
      return;
    }
    if (!window.confirm("Confirmar solicitação de correção? O orçamento será retornado para ajustes.")) {
      return;
    }
    try {
      let budgetId: string | null = order.budgetId || order.budget_id || null;
      if (!budgetId) {
        try {
          const rawMap = localStorage.getItem("budget-to-production-order-v1");
          if (rawMap) {
            const parsedMap = JSON.parse(rawMap) as unknown;
            if (parsedMap && typeof parsedMap === "object") {
              for (const [bid, oid] of Object.entries(parsedMap as Record<string, string>)) {
                if (oid === order.id) {
                  budgetId = bid;
                  break;
                }
              }
            }
          }
        } catch {}
      }
      if (!budgetId) {
        toast.error("Vínculo orçamento ↔ OS não encontrado. Não foi possível solicitar correção.");
        return;
      }
      const timestamp = new Date().toISOString();
      const appendNote = `\n\n==== SOLICITAÇÃO DE CORREÇÃO ====\nData: ${timestamp}\nMotivo: ${reason.trim()}\nOrçamento retornado para ajustes.\n`;
      const { budget, internal } = splitBudgetOnlyAfterExecution(order?.notes);
      const internalWithNote = (internal || "") + appendNote;
      const finalNotes = rebuildNotesFromParts({
        internal: internalWithNote,
        budget,
        execution: executionSafe,
      });
      await update.mutateAsync({ id: order.id, notes: finalNotes });
      setInternalNotes(internalWithNote);
      window.dispatchEvent(
        new CustomEvent("budget:correction-requested", {
          detail: { budgetId, reason: reason.trim() },
        }),
      );
      toast.success("Correção solicitada · orçamento retornado para ajustes.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao solicitar correção.");
    }
  };

  const discardDraft = () => {
    clearDraft();
    setForm({});
    setInternalNotes("");
    setExecution(null);
    toast.message("Rascunho descartado");
    onClose();
  };

  const currentStatus = (form.status ?? order.status ?? "new_vehicle") as ProductionStatus;
  const currentPriority = (form.priority ?? order.priority ?? "normal") as ProductionPriority;

  const canFinalizeStatus = !isNew && !locked && (currentStatus === "in_production" || currentStatus === "paused");
  const preflightMissingClient = !order?.client_id && !form.client_id && !budgetHydrated;
  const preflightMissingSite = !order?.platform && !form.platform;
  const preflightMissingServices = !budgetHydrated && executionSafe.steps.length === 0;

  const handleFinalize = async () => {
    if (!order?.id || isFinalizing || finalize.isPending) return;

    if (preflightMissingClient) {
      toast.warning("Aviso: Ordem sem cliente vinculado. O servidor pode rejeitar a finalização.");
    }
    if (preflightMissingSite) {
      toast.warning("Aviso: Ordem sem local operacional / plataforma. O servidor pode rejeitar a finalização.");
    }
    if (preflightMissingServices) {
      toast.warning("Aviso: Ordem direta sem serviços na execução. O servidor exige serviços estruturados.");
    }

    setIsFinalizing(true);
    try {
      await finalize.mutateAsync(order.id);
      clearDraft();
      onClose();
    } catch (err: any) {
      toast.error(mapFinalizeError(err));
    } finally {
      setIsFinalizing(false);
    }
  };

  const executionFieldsetDisabled = locked || serviceDoneLocked;

  return (
    <Dialog open={!!order} onOpenChange={(o) => { if (!o) minimize(); }}>
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader className="space-y-2">
          <DialogTitle className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-indigo-500" />
              <span>OS {displayOSNumber}</span>
            </span>
            {budgetHydrated && (
              <Badge variant="outline" className="gap-1 text-indigo-600 border-indigo-500/30 bg-indigo-500/5">
                <ClipboardList className="h-3 w-3" /> Orçamento {displayBudgetNumber}
              </Badge>
            )}
            <Badge variant="outline" className={PRIORITY_META[currentPriority].tone}>
              {PRIORITY_META[currentPriority].label}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <BoardStatusDot status={currentStatus} />
              {PRODUCTION_STATUSES.find(s => s.value === currentStatus)?.label ?? currentStatus}
            </Badge>
            {locked && (
              <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-500/30 bg-emerald-500/5">
                <Lock className="h-3 w-3" /> Finalizado · somente leitura
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Ficha operacional completa da Ordem de Produção, com dados do orçamento e área operacional.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="ficha" className="gap-2">
              <FileText className="h-4 w-4" /> Ficha Operacional
            </TabsTrigger>
            <TabsTrigger value="photos" className="gap-2">
              <Car className="h-4 w-4" /> Fotos
            </TabsTrigger>
            <TabsTrigger value="timeline" className="gap-2">
              <CalendarClock className="h-4 w-4" /> Histórico
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ficha" className="space-y-5 pt-4">
            {isNew && !locked && (
              <div className="rounded-lg border border-border/50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">OCR: importar ordem</div>
                    <div className="text-xs text-muted-foreground">
                      Envie uma foto/PDF de uma ordem existente para pré-preencher os campos.
                    </div>
                  </div>
                </div>
                <div className="mt-3">
                  <FileUploadZone onFilesSelected={applyOcr} isProcessing={isExtracting} compact />
                </div>
                {ocrStatus && (
                  <div className={`mt-2 flex items-start gap-2 rounded-md px-3 py-2 text-xs ${
                    ocrStatus.type === "error"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  }`}>
                    {ocrStatus.type === "error"
                      ? <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                    <span>{ocrStatus.message}</span>
                  </div>
                )}
              </div>
            )}

            <fieldset disabled={locked} className="space-y-5 disabled:opacity-80">

              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <UserIcon className="h-4 w-4 text-indigo-500" /> Cliente e Contacto
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <DataLine icon={UserIcon} label="Cliente" value={displayClientName} />
                    <DataLine icon={Phone} label="Contacto" value={displayClientPhone} />
                    <DataLine icon={Mail} label="E-mail" value={displayClientEmail} />
                    <DataLine icon={FileSignature} label="Documento" value={displayClientDoc} />
                    {!budgetHydrated && (
                      <div className="grid grid-cols-1 gap-3 pt-2">
                        <Field label="Nome (edição)">
                          <Input
                            value={form.client_name ?? ""}
                            onChange={e => set("client_name", e.target.value)}
                          />
                        </Field>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Car className="h-4 w-4 text-indigo-500" /> Veículo
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      <DataLine icon={Car} label="Marca" value={displayBrand} />
                      <DataLine icon={Car} label="Modelo" value={displayModel} />
                      <DataLine icon={HashIcon} label="Matrícula" value={displayPlate} mono />
                      <DataLine icon={Shield} label="VIN" value={displayVin} mono />
                      <DataLine icon={CalendarDays} label="Ano" value={displayYear} />
                      <DataLine icon={Car} label="Cor" value={displayColor} />
                      <DataLine icon={Car} label="KM" value={displayKm !== "—" ? `${displayKm} km` : "—"} />
                    </div>
                    {!budgetHydrated && (
                      <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border/50">
                        <Field label="Marca">
                          <Input value={form.brand ?? ""} onChange={e => set("brand", e.target.value)} />
                        </Field>
                        <Field label="Modelo">
                          <Input value={form.model ?? ""} onChange={e => set("model", e.target.value)} />
                        </Field>
                        <Field label="Placa">
                          <Input
                            value={form.license_plate ?? ""}
                            onChange={e => set("license_plate", e.target.value.toUpperCase())}
                          />
                        </Field>
                        <Field label="VIN">
                          <Input value={form.vin ?? ""} onChange={e => set("vin", e.target.value)} />
                        </Field>
                        <Field label="Cor">
                          <Input value={form.color ?? ""} onChange={e => set("color", e.target.value)} />
                        </Field>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Wrench className="h-4 w-4 text-indigo-500" /> Intervenção
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 text-sm">
                  <div className="grid gap-4 md:grid-cols-3">
                    <DataLine icon={Wrench} label="Tipo de intervenção" value={displayIntervention} />
                    <DataLine
                      icon={CalendarDays}
                      label="Emissão orçamento"
                      value={parsed.issuedAt ? new Date(parsed.issuedAt).toLocaleDateString("pt-BR") : "—"}
                    />
                    <DataLine
                      icon={FileText}
                      label="Nº orçamento"
                      value={displayBudgetNumber}
                      mono
                    />
                  </div>
                  <div className="space-y-1.5 rounded-lg bg-slate-50 p-3 dark:bg-slate-900/40">
                    <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                      <ClipboardList className="h-3.5 w-3.5" /> Diagnóstico
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {displayDiagnosis}
                    </p>
                  </div>
                  <div className="space-y-1.5 rounded-lg bg-indigo-50 p-3 dark:bg-indigo-500/5">
                    <div className="flex items-center gap-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                      <Wrench className="h-3.5 w-3.5" /> Descrição técnica
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {displayTechnical}
                    </p>
                  </div>
                  {!budgetHydrated && (
                    <div className="grid grid-cols-1 gap-3 pt-2 border-t border-border/50">
                      <Field label="Tipo (edição, fallback)">
                        <Input value={form.insurer ?? ""} onChange={e => set("insurer", e.target.value)} />
                      </Field>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="grid gap-4 xl:grid-cols-2">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Package className="h-4 w-4 text-indigo-500" /> Peças / Materiais
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 sm:p-6 sm:pt-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[44%]">Item</TableHead>
                          <TableHead className="text-right">Qtd</TableHead>
                          <TableHead className="text-right">Unitário</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parsed.parts.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="h-24 text-center text-xs text-muted-foreground">
                              Nenhuma peça lançada neste orçamento.
                            </TableCell>
                          </TableRow>
                        ) : (
                          parsed.parts.map((p, i) => (
                            <TableRow key={i}>
                              <TableCell className="align-top">{p.desc}</TableCell>
                              <TableCell className="text-right tabular-nums align-top">{p.qty}</TableCell>
                              <TableCell className="text-right tabular-nums align-top">{formatBRL(p.unit)}</TableCell>
                              <TableCell className="text-right tabular-nums align-top">{formatBRL(p.total)}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                      <TableFooter>
                        <TableRow>
                          <TableCell colSpan={3}>Subtotal Peças</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            {formatBRL(parsed.partsSubtotal)}
                          </TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <Wrench className="h-4 w-4 text-indigo-500" /> Mão de Obra
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0 sm:p-6 sm:pt-2">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[44%]">Serviço</TableHead>
                          <TableHead className="text-right">Horas</TableHead>
                          <TableHead className="text-right">Hora</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parsed.labor.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="h-24 text-center text-xs text-muted-foreground">
                              Nenhuma mão de obra lançada neste orçamento.
                            </TableCell>
                          </TableRow>
                        ) : (
                          parsed.labor.map((l, i) => (
                            <TableRow key={i}>
                              <TableCell className="align-top">{l.desc}</TableCell>
                              <TableCell className="text-right tabular-nums align-top">{l.hours}</TableCell>
                              <TableCell className="text-right tabular-nums align-top">{formatBRL(l.rate)}</TableCell>
                              <TableCell className="text-right tabular-nums align-top">{formatBRL(l.total)}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                      <TableFooter>
                        <TableRow>
                          <TableCell colSpan={3}>Subtotal M.O.</TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            {formatBRL(parsed.laborSubtotal)}
                          </TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>
                  </CardContent>
                </Card>
              </div>

              <Card className="border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/5">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                    <Coins className="h-4 w-4" /> Valor Total do Orçamento
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 md:grid-cols-5">
                    <TotalCell label="Subtotal" value={formatBRL(parsed.totals.gross)} />
                    <TotalCell
                      label={`Desconto (${parsed.totals.discountPct.toFixed(2)}%)`}
                      value={`- ${formatBRL(parsed.totals.discount)}`}
                      tone="text-amber-600"
                    />
                    <TotalCell label="Base tributável" value={formatBRL(parsed.totals.net)} />
                    <TotalCell
                      label={`IVA (${parsed.totals.ivaPct.toFixed(2)}%)`}
                      value={`+ ${formatBRL(parsed.totals.iva)}`}
                      tone="text-sky-600"
                    />
                    <TotalCell
                      label="TOTAL"
                      value={formatBRL(parsed.totals.total)}
                      big
                      tone="text-emerald-700 dark:text-emerald-300"
                    />
                  </div>
                  {parsed.origin && (
                    <p className="mt-3 text-[11px] text-muted-foreground border-t border-emerald-500/20 pt-2">
                      {parsed.origin}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card className="border-indigo-500/30">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <UserCog className="h-4 w-4 text-indigo-500" /> Área Operacional
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <Field label="Status atual">
                      <Select
                        value={currentStatus}
                        onValueChange={(v) => {
                          const next = v as ProductionStatus;
                          if (next === "paused" && order && !isNew) {
                            try {
                              window.dispatchEvent(
                                new CustomEvent("production:order-change-status-requested", {
                                  detail: { order, status: next },
                                }),
                              );
                            } catch {}
                            return;
                          }
                          set("status", next);
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRODUCTION_STATUSES.map(s => (
                            <SelectItem key={s.value} value={s.value}>
                              <span className="flex items-center gap-2">
                                <BoardStatusDot status={s.value} />
                                {s.label}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field label="Prioridade">
                      <Select
                        value={currentPriority}
                        onValueChange={(v) => set("priority", v as ProductionPriority)}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.entries(PRIORITY_META).map(([k, m]) => (
                            <SelectItem key={k} value={k}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field label="Responsável">
                      <Select
                        value={form.technician_user_id ?? order.technician_user_id ?? "__none__"}
                        onValueChange={(v) => {
                          if (v === "__none__") {
                            set("technician_user_id", null);
                            set("technician_name", null);
                          } else {
                            const member = members.find((m) => m.auth_user_id === v);
                            set("technician_user_id", v);
                            set("technician_name", member?.name ?? member?.email ?? null);
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Selecione um técnico" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— Nenhum —</SelectItem>
                          {members.map((m) => (
                            <SelectItem key={m.auth_user_id} value={m.auth_user_id}>
                              {m.name ?? m.email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {(form.technician_name ?? order.technician_name) && (
                        <p className="text-[11px] text-muted-foreground pt-1">
                          Atual: {form.technician_name ?? order.technician_name}
                        </p>
                      )}
                    </Field>

                    <Field label="Plataforma / observação rápida">
                      <Input
                        value={form.platform ?? order.platform ?? ""}
                        onChange={e => set("platform", e.target.value)}
                      />
                    </Field>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Data de entrada">
                      <div className="rounded-md border border-border/70 px-3 py-2 text-sm bg-slate-50 dark:bg-slate-900/40">
                        <span className="text-muted-foreground">
                          {fmtDatePTBR(form.created_at ?? order.created_at)}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground pt-1">
                        Data de criação da ordem — não editável.
                      </p>
                    </Field>

                    <Field label="Previsão de conclusão">
                      <Input
                        type="datetime-local"
                        value={fmtDateInput(form.due_at ?? order.due_at)}
                        onChange={e => set(
                          "due_at",
                          e.target.value ? new Date(e.target.value).toISOString() : null,
                        )}
                      />
                    </Field>
                  </div>

                  <Field label="Observações internas">
                    <Textarea
                      value={internalNotes}
                      onChange={e => setInternalNotes(e.target.value)}
                      rows={4}
                      placeholder="Anotações operacionais, conversas com cliente, lembretes…"
                    />
                    <p className="text-[11px] text-muted-foreground pt-1">
                      Campo livre — suas anotações ficam separadas dos dados do orçamento original.
                    </p>
                  </Field>
                </CardContent>
              </Card>

              <fieldset disabled={executionFieldsetDisabled} className="space-y-5 disabled:opacity-90">
                <Card className="border-indigo-500/40 bg-indigo-500/[0.03] dark:bg-indigo-500/[0.04]">
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <Wrench className="h-4 w-4 text-indigo-500" /> Execução do Serviço
                      </CardTitle>
                      <div className="flex flex-wrap items-center gap-2">
                        <div
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium ${STEP_OPERATIONAL_TONE[overallExecutionStatus]}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${STEP_OPERATIONAL_DOT[overallExecutionStatus]}`} />
                          {STEP_OPERATIONAL_LABEL[overallExecutionStatus]}
                        </div>
                        <Badge variant="outline" className="gap-1 border-slate-300 bg-white dark:bg-slate-900/60 text-[11px]">
                          <History className="h-3 w-3" /> {waitingCount} aguardando
                        </Badge>
                        <Badge variant="outline" className="gap-1 border-indigo-300 bg-white dark:bg-slate-900/60 text-[11px]">
                          <Play className="h-3 w-3" /> {runningCount} em execução
                        </Badge>
                        <Badge variant="outline" className="gap-1 border-amber-300 bg-white dark:bg-slate-900/60 text-[11px]">
                          <Pause className="h-3 w-3" /> {pausedCount} pausado
                        </Badge>
                        <Badge variant="outline" className="gap-1 border-emerald-300 bg-white dark:bg-slate-900/60 text-[11px]">
                          <CheckCheck className="h-3 w-3" /> {doneCount} concluído
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />
                          <span>Progresso da OS</span>
                        </div>
                        <div className="tabular-nums font-semibold">{progressPct}%</div>
                      </div>
                      <Progress value={progressPct} className="h-2.5" />
                      <div className="grid gap-3 pt-1 text-[11px] md:grid-cols-3">
                        <div className="rounded-md border border-border/60 bg-white p-2.5 dark:bg-slate-900/50">
                          <div className="text-muted-foreground">Início</div>
                          <div className="font-medium">
                            {overallStarted ? fmtDatePTBR(overallStarted) : "—"}
                          </div>
                        </div>
                        <div className="rounded-md border border-border/60 bg-white p-2.5 dark:bg-slate-900/50">
                          <div className="text-muted-foreground">Previsão conclusão</div>
                          <div className="font-medium">
                            {fmtDatePTBR(form.due_at ?? order.due_at)}
                          </div>
                        </div>
                        <div className="rounded-md border border-border/60 bg-white p-2.5 dark:bg-slate-900/50">
                          <div className="text-muted-foreground">Concluído em</div>
                          <div className="font-medium">
                            {overallFinished ? fmtDatePTBR(overallFinished) : "—"}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between pb-2">
                        <div className="text-sm font-semibold text-foreground">Serviço a executar</div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={addStep}
                          className="h-7 gap-1 px-2.5 text-[11px]"
                        >
                          <PlusIcon className="h-3.5 w-3.5" /> Novo serviço
                        </Button>
                      </div>

                      <div className="overflow-hidden rounded-xl border border-border/70 bg-white dark:bg-slate-950/40">
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader className="bg-slate-50 dark:bg-slate-900/70">
                              <TableRow>
                                <TableHead className="w-[32%] text-[11px]">Serviço</TableHead>
                                <TableHead className="text-[11px]">Status</TableHead>
                                <TableHead className="text-[11px]">Responsável</TableHead>
                                <TableHead className="text-[11px]">Início</TableHead>
                                <TableHead className="text-[11px]">Conclusão</TableHead>
                                <TableHead className="text-[11px]">Observações execução</TableHead>
                                <TableHead className="text-right text-[11px]">Ações</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {executionSafe.steps.length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={7} className="h-28 text-center text-xs text-muted-foreground">
                                    Não há serviços para executar. Use "Novo serviço" para adicionar manualmente, ou vincule um orçamento com mão de obra.
                                  </TableCell>
                                </TableRow>
                              ) : (
                                executionSafe.steps.map((step) => (
                                  <StepRow
                                    key={step.id}
                                    step={step}
                                    members={members}
                                    onChangeStatus={(next) => setStepStatus(step.id, next)}
                                    onChangeResponsible={(user_id, label) => updateStep(step.id, {
                                      responsible_id: user_id, responsible_name: label,
                                    })}
                                    onChangeDescription={(desc) => updateStep(step.id, { description: desc })}
                                    onRemove={() => removeStep(step.id)}
                                    onAppendNote={(text) => appendStepNote(step.id, text, authorNameForNotes)}
                                  />
                                ))
                              )}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2 rounded-lg border border-border/60 bg-white p-3 dark:bg-slate-950/40">
                      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                        <History className="h-3.5 w-3.5" /> Observações gerais da execução
                      </div>
                      <AppendNoteBox
                        onAppend={(text) => appendOverallNote(text, authorNameForNotes)}
                        entries={executionSafe.overall_notes}
                        placeholder="Anotações gerais da execução da OS, ordem de serviços, instruções para a equipe…"
                        disabled={!!executionFieldsetDisabled}
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 dark:bg-emerald-500/[0.04]">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                          <CheckCheck className="h-4 w-4" /> Serviço concluído
                        </div>
                        <p className="text-[11px] text-muted-foreground max-w-xl">
                          Marque quando todos os serviços da OS forem finalizados. Esta ação bloqueia alterações nos passos e indica que o veículo está pronto para Controle Final / Entrega.
                        </p>
                      </div>
                      <div className="flex items-center gap-2.5 rounded-lg border border-emerald-500/30 bg-white px-3 py-2 dark:bg-slate-900/70">
                        <Checkbox
                          id="service_done_toggle"
                          checked={executionSafe.service_done}
                          onCheckedChange={(v) => toggleServiceDone(Boolean(v))}
                        />
                        <Label htmlFor="service_done_toggle" className="text-sm font-medium cursor-pointer pl-0.5">
                          {executionSafe.service_done ? "Serviço marcado como concluído." : "Marcar serviço como concluído."}
                        </Label>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </fieldset>

            </fieldset>

            <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-border/50">
              <div className="flex gap-2">
                {!isNew && budgetHydrated && !locked && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-amber-700 border-amber-500/40 hover:bg-amber-500/10 dark:text-amber-400"
                    onClick={handleRequestBudgetCorrection}
                    disabled={update.isPending || create.isPending}
                  >
                    <AlertTriangle className="h-4 w-4" /> Solicitar correção do orçamento
                  </Button>
                )}
                {!isNew && !locked && (
                  <Button variant="destructive" size="sm"
                    onClick={async () => {
                      if (confirm("Remover esta ordem?")) {
                        await remove.mutateAsync(order.id);
                        clearDraft();
                        onClose();
                      }
                    }}>
                    <Trash2 className="h-4 w-4 mr-2" /> Excluir
                  </Button>
                )}
                {isNew && (
                  <Button variant="ghost" size="sm" onClick={discardDraft}>
                    Descartar rascunho
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                {!locked && (
                  <Button variant="outline" onClick={minimize} disabled={isFinalizing || finalize.isPending}>
                    <Minimize2 className="h-4 w-4 mr-2" /> Minimizar
                  </Button>
                )}
                {canFinalizeStatus && (
                  <Button
                    type="button"
                    variant="default"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                    onClick={handleFinalize}
                    disabled={isFinalizing || finalize.isPending || update.isPending || create.isPending}
                  >
                    {isFinalizing || finalize.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Finalizando…
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4 mr-2" /> Finalizar Ordem
                      </>
                    )}
                  </Button>
                )}
                {locked ? (
                  <Button variant="outline" onClick={onClose}>Fechar</Button>
                ) : (
                  <Button onClick={save} disabled={update.isPending || create.isPending || isFinalizing || finalize.isPending}>
                    <Save className="h-4 w-4 mr-2" /> Salvar
                  </Button>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="photos" className="pt-4 space-y-6">
            {effectiveOrderId ? (
              <>
                <section className="space-y-2">
                  <h4 className="text-sm font-semibold text-foreground">Veículo na entrada</h4>
                  <p className="text-xs text-muted-foreground">Fotos obrigatórias do estado inicial.</p>
                  <PhotoUploader orderId={effectiveOrderId} fixedCategory="before" hideOthers readOnly={locked} />
                </section>
                <div className="h-px bg-border/60" />
                <section className="space-y-2">
                  <h4 className="text-sm font-semibold text-foreground">Durante o serviço</h4>
                  <p className="text-xs text-muted-foreground">Registo do andamento e etapas intermediárias.</p>
                  <PhotoUploader orderId={effectiveOrderId} fixedCategory="during" hideOthers readOnly={locked} />
                </section>
                <div className="h-px bg-border/60" />
                <section className="space-y-2">
                  <h4 className="text-sm font-semibold text-foreground">Veículo finalizado</h4>
                  <p className="text-xs text-muted-foreground">Registro do resultado final após o serviço.</p>
                  <PhotoUploader orderId={effectiveOrderId} fixedCategory="after" hideOthers readOnly={locked} />
                </section>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Salvando ordem…</p>
            )}
          </TabsContent>
          <TabsContent value="timeline" className="pt-4">
            <OrderTimeline orderId={effectiveOrderId ?? order.id} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function DataLine({
  icon: Icon, label, value, mono,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 min-w-0">
      <div className="mt-0.5 shrink-0 text-muted-foreground/80">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-muted-foreground leading-tight">{label}</div>
        <div className={`text-sm leading-tight truncate ${mono ? "font-mono tracking-tight" : ""}`}>
          {value || "—"}
        </div>
      </div>
    </div>
  );
}

function TotalCell({
  label, value, tone, big,
}: { label: string; value: string; tone?: string; big?: boolean }) {
  return (
    <div className="rounded-lg border bg-white p-3 dark:bg-slate-900">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={`${big ? "text-2xl" : "text-base"} font-semibold tabular-nums ${tone ?? ""}`}>
        {value}
      </div>
    </div>
  );
}

function StepRow({
  step,
  members,
  onChangeStatus,
  onChangeResponsible,
  onChangeDescription,
  onRemove,
  onAppendNote,
}: {
  step: ServiceStep;
  members: { auth_user_id: string; name?: string | null; email?: string | null }[];
  onChangeStatus: (next: StepOperationalStatus) => void;
  onChangeResponsible: (userId: string | null, name: string | null) => void;
  onChangeDescription: (desc: string) => void;
  onRemove: () => void;
  onAppendNote: (text: string) => void;
}) {
  const [noteDraft, setNoteDraft] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <>
      <TableRow className="align-top">
        <TableCell className="max-w-sm align-top py-3">
          <div className="space-y-1.5">
            <Input
              value={step.description}
              onChange={(e) => onChangeDescription(e.target.value)}
              className="text-sm h-9 bg-slate-50 border-border/70 dark:bg-slate-950/40"
            />
          </div>
        </TableCell>
        <TableCell className="align-top py-3">
          <div className="space-y-2 max-w-[220px]">
            <div className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-medium ${STEP_OPERATIONAL_TONE[step.operational_status]}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${STEP_OPERATIONAL_DOT[step.operational_status]}`} />
              {STEP_OPERATIONAL_LABEL[step.operational_status]}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                type="button"
                variant={step.operational_status === "waiting" ? "default" : "secondary"}
                size="sm"
                className="h-7 px-2 text-[11px]"
                onClick={() => onChangeStatus("waiting")}
              >
                Aguardando
              </Button>
              <Button
                type="button"
                variant={step.operational_status === "running" ? "default" : "secondary"}
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={() => onChangeStatus("running")}
              >
                <Play className="h-3 w-3" /> Iniciar
              </Button>
              <Button
                type="button"
                variant={step.operational_status === "paused" ? "default" : "secondary"}
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={() => onChangeStatus("paused")}
              >
                <Pause className="h-3 w-3" /> Pausar
              </Button>
              <Button
                type="button"
                variant={step.operational_status === "done" ? "default" : "secondary"}
                size="sm"
                className="h-7 gap-1 px-2 text-[11px]"
                onClick={() => onChangeStatus("done")}
              >
                <CheckCheck className="h-3 w-3" /> Concluir
              </Button>
            </div>
          </div>
        </TableCell>
        <TableCell className="align-top py-3 max-w-[200px]">
          <div className="space-y-1.5">
            <Select
              value={step.responsible_id ?? "__none__"}
              onValueChange={(v) => {
                if (v === "__none__") {
                  onChangeResponsible(null, null);
                } else {
                  const member = members.find((m) => m.auth_user_id === v);
                  onChangeResponsible(v, member?.name ?? member?.email ?? null);
                }
              }}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Nenhum —</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.auth_user_id} value={m.auth_user_id}>
                    {m.name ?? m.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {step.responsible_name && (
              <p className="text-[11px] text-muted-foreground truncate">
                {step.responsible_name}
              </p>
            )}
          </div>
        </TableCell>
        <TableCell className="align-top py-3 text-[11px] tabular-nums">
          <div className="text-muted-foreground">
            {step.started_at ? fmtDatePTBR(step.started_at) : "—"}
          </div>
        </TableCell>
        <TableCell className="align-top py-3 text-[11px] tabular-nums">
          <div className="text-muted-foreground">
            {step.finished_at ? fmtDatePTBR(step.finished_at) : "—"}
          </div>
        </TableCell>
        <TableCell className="align-top py-3 max-w-[320px]">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-muted-foreground truncate">
                {step.execution_notes.length
                  ? `${step.execution_notes.length} observaç${step.execution_notes.length === 1 ? "ão" : "ões"}`
                  : "Sem observações"}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                onClick={() => setOpen((v) => !v)}
                disabled={!step.execution_notes.length && !step.description}
              >
                {open ? "Recolher" : "Abrir observações"}
              </Button>
            </div>
            <div className="flex gap-1.5">
              <Input
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Adicionar observação (salva automaticamente no passo)"
                className="h-8 text-xs flex-1 bg-slate-50 border-border/70 dark:bg-slate-950/40"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onAppendNote(noteDraft);
                    setNoteDraft("");
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2 text-[11px]"
                onClick={() => {
                  onAppendNote(noteDraft);
                  setNoteDraft("");
                }}
                disabled={!noteDraft.trim()}
              >
                Adicionar
              </Button>
            </div>
            {open && step.execution_notes.length > 0 && (
              <ol className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
                {step.execution_notes.map((n, i) => (
                  <li key={i} className="space-y-0.5">
                    <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                      <span>{n.by ?? "Responsável não atribuído"}</span>
                      <span className="tabular-nums">{fmtDatePTBR(n.at)}</span>
                    </div>
                    <p className="text-xs leading-relaxed whitespace-pre-wrap bg-slate-50 p-2 rounded-md dark:bg-slate-950/40 border border-border/50">
                      {n.text}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </TableCell>
        <TableCell className="text-right align-top py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] text-destructive hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </TableCell>
      </TableRow>
    </>
  );
}

function AppendNoteBox({
  entries, onAppend, placeholder, disabled,
}: {
  entries: StepNoteEntry[];
  onAppend: (text: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder={placeholder ?? "Adicionar observação…"}
          className="text-xs bg-slate-50 border-border/70 dark:bg-slate-950/40 min-h-[64px]"
          disabled={disabled}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onAppend(draft);
              setDraft("");
            }
          }}
        />
        <div className="flex flex-col items-end justify-between">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 px-2 text-[11px]"
            onClick={() => {
              onAppend(draft);
              setDraft("");
            }}
            disabled={disabled || !draft.trim()}
          >
            <PlusIcon className="h-3.5 w-3.5 mr-1" /> Adicionar
          </Button>
          <p className="text-[10px] text-muted-foreground text-right">
            ⌘/Ctrl + Enter para salvar
          </p>
        </div>
      </div>
      {entries.length > 0 && (
        <ol className="space-y-2 border-t border-border/50 pt-2 max-h-64 overflow-y-auto">
          {entries.slice().reverse().map((n, i) => (
            <li key={i} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                <span>{n.by ?? "Responsável não atribuído"}</span>
                <span className="tabular-nums">{fmtDatePTBR(n.at)}</span>
              </div>
              <p className="text-xs leading-relaxed whitespace-pre-wrap bg-slate-50 p-2 rounded-md dark:bg-slate-950/40 border border-border/50">
                {n.text}
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
