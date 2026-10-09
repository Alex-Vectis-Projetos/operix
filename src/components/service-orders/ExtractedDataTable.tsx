import { useState, useEffect } from "react";
import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Trash2, AlertTriangle, Pencil, CheckCircle2, XCircle, Lock, UserCheck } from "lucide-react";
import type { ExtractedOrder, FieldConfidence } from "@/hooks/useServiceOrders";
import { cn } from "@/lib/utils";
import { formatLicensePlate } from "@/lib/formatPlate";
import { useLanguage } from "@/hooks/useLanguage";
import { ExtractionStages, type Stage } from "./ExtractionStages";
import { BulkEditBanner, type PendingBulkEdit } from "@/components/shared/BulkEditBanner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function cleanText(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  if (s.toLowerCase() === "null" || s.toLowerCase() === "undefined" || s === "-" || s === "--" || s.toLowerCase() === "n/a" || s.toLowerCase() === "none") {
    return "";
  }
  return s;
}

interface TechnicianOption {
  /** auth.users.id — used as the value of the dropdown / `assigned_user_id`. */
  user_id: string;
  name: string;
  display_code?: string | null;
}

interface ExtractedDataTableProps {
  orders: ExtractedOrder[];
  confidence: "high" | "medium" | "low";
  notes?: string;
  onSave: (orders: ExtractedOrder[], opts?: { isPrivate?: boolean }) => void;
  onDiscard: () => void;
  isSaving: boolean;
  technicians?: TechnicianOption[];
  /**
   * Only `technician` role users have the dropdown locked to their own profile.
   * Admin / partner / client must select a technician explicitly.
   */
  isTechnicianRole?: boolean;
  /**
   * Kept for backward compatibility. Treated as "can edit technician".
   * If isTechnicianRole is provided, it takes precedence.
   */
  isAdmin?: boolean;
  myTechnicianName?: string | null;
  /**
   * When true, hide the privacy toggle (user has no workspace context, so
   * everything is inherently private already).
   */
  hidePrivacyToggle?: boolean;
}

const confidenceColors = {
  high: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  low: "bg-red-500/10 text-red-400 border-red-500/30",
};

const fieldConfBorder: Record<FieldConfidence, string> = {
  high: "border-transparent",
  medium: "border-amber-500/50 bg-amber-500/5",
  low: "border-red-500/50 bg-red-500/5",
};

export function ExtractedDataTable({
  orders: initial,
  confidence,
  notes,
  onSave,
  onDiscard,
  isSaving,
  technicians = [],
  isTechnicianRole,
  isAdmin = false,
  myTechnicianName = null,
  hidePrivacyToggle = false,
}: ExtractedDataTableProps) {
  // Operational ownership: workspace (collective) vs private (individual).
  // Defaults to workspace; user can flip to private before saving.
  const [isPrivate, setIsPrivate] = useState(false);
  // Only lock the technician field for users with the `technician` role.
  // Admin / partner / client must pick from the dropdown.
  const lockTechnician =
    typeof isTechnicianRole === "boolean" ? isTechnicianRole : !isAdmin;
  const canEditTechnician = !lockTechnician;

  // Pre-resolve technician user_id from OCR text by case-insensitive name match.
  // After this, `row.technician` will hold the technicians.user_id whenever a match is found,
  // ensuring the Select component (which stores user_id) shows the correct selection.
  const resolveTechUserIdFromText = (text: string | null): string | null => {
    if (!text) return null;
    const norm = cleanText(text).toLowerCase();
    if (!norm) return null;
    const exact = technicians.find((t) => t.name.toLowerCase() === norm);
    if (exact) return exact.user_id ?? null;
    const partial = technicians.find(
      (t) => t.name.toLowerCase().includes(norm) || norm.includes(t.name.toLowerCase())
    );
    return partial?.user_id ?? null;
  };

  const [rows, setRows] = useState<ExtractedOrder[]>(() => {
    return initial.map((r) => {
      const sanitized: ExtractedOrder = {
        ...r,
        client: cleanText(r.client) || null,
        platform: cleanText(r.platform) || null,
        technician: cleanText(r.technician) || null,
        week: cleanText(r.week) || null,
        car_name: cleanText(r.car_name) || null,
        license_plate: cleanText(r.license_plate) || null,
        service_1_name: cleanText(r.service_1_name) || null,
        service_2_name: cleanText(r.service_2_name) || null,
        service_3_name: cleanText(r.service_3_name) || null,
        service_4_name: cleanText(r.service_4_name) || null,
      };
      if (lockTechnician && myTechnicianName) {
        const myUserId = technicians.find((t) => t.name === myTechnicianName)?.user_id ?? null;
        sanitized.technician = myUserId ?? myTechnicianName;
      } else {
        const resolvedUserId = resolveTechUserIdFromText(sanitized.technician);
        if (resolvedUserId) sanitized.technician = resolvedUserId;
      }
      return sanitized;
    });
  });

  useEffect(() => {
    if (technicians.length === 0) return;
    setRows((prev) =>
      prev.map((r) => {
        if (r.technician && !technicians.some((t) => t.user_id === r.technician)) {
          const resolved = resolveTechUserIdFromText(r.technician);
          if (resolved) return { ...r, technician: resolved };
        }
        if (!r.technician && technicians.length === 1) {
          return { ...r, technician: technicians[0].user_id };
        }
        return r;
      })
    );
  }, [technicians]);

  const [stage, setStage] = useState<Stage>("review");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [errorRows, setErrorRows] = useState<Set<number>>(new Set());
  // Map of `${rowIdx}:${field}` -> inline error message
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [pendingBulk, setPendingBulk] = useState<PendingBulkEdit | null>(null);
  const [lastEditIdx, setLastEditIdx] = useState<number>(-1);
  const [lastEditField, setLastEditField] = useState<string>("");
  const { t, formatCurrency } = useLanguage();

  const fieldLabels: Record<string, string> = {
    client: t("label.client"), platform: t("label.platform"), technician: t("label.technician"),
    week: t("label.week"), car_name: t("label.car"), license_plate: t("label.plate"),
    service_1_name: "Service 1", service_1_price: "Preço 1", service_2_name: "Service 2", service_2_price: "Preço 2",
    service_3_name: "Service 3", service_3_price: "Preço 3", service_4_name: "Service 4", service_4_price: "Preço 4",
  };

  const update = (idx: number, field: keyof ExtractedOrder, value: string | number | null) => {
    // Clear previous validation when user edits — fields always editable
    setValidationErrors([]);
    setValidationWarnings([]);
    setErrorRows(new Set());
    setFieldErrors((prev) => {
      const key = `${idx}:${field as string}`;
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const updated = { ...r, [field]: value };
        // Auto-format license plate
        if (field === "license_plate" && typeof value === "string") {
          updated.license_plate = formatLicensePlate(value);
        }
        const p1 = Number(updated.service_1_price) || 0;
        const p2 = Number(updated.service_2_price) || 0;
        const p3 = Number(updated.service_3_price) || 0;
        const p4 = Number(updated.service_4_price) || 0;
        updated.total = p1 + p2 + p3 + p4;
        if (updated.field_confidence) {
          updated.field_confidence = { ...updated.field_confidence, [field]: "high" };
        }
        updated.total_mismatch = false;
        return updated;
      })
    );
    if (stage !== "review") setStage("review");

    // Offer bulk edit if multiple rows and it's a shared field
    const bulkFields = ["client", "platform", "technician", "week", "car_name", "license_plate",
      "service_1_name", "service_1_price", "service_2_name", "service_2_price",
      "service_3_name", "service_3_price", "service_4_name", "service_4_price"];
    if (rows.length > 1 && bulkFields.includes(field as string)) {
      setLastEditIdx(idx);
      setLastEditField(field as string);
      setPendingBulk({ field: field as string, value, label: fieldLabels[field as string] || (field as string) });
    }
  };

  const applyBulk = () => {
    if (!pendingBulk) return;
    setRows(prev => prev.map((r, i) => {
      if (i === lastEditIdx) return r;
      const updated = { ...r, [pendingBulk.field]: pendingBulk.value };
      return updated;
    }));
    setPendingBulk(null);
  };

  const removeRow = (idx: number) => {
    setRows((prev) => prev.filter((_, i) => i !== idx));
    setValidationErrors([]);
    setValidationWarnings([]);
    setErrorRows(new Set());
    setFieldErrors({});
    if (stage !== "review") setStage("review");
  };

  const runValidation = (): boolean => {
    const blockingErrors: string[] = [];
    const reviewWarnings: string[] = [];
    const badRows = new Set<number>();
    const fErrors: Record<string, string> = {};

    rows.forEach((row, i) => {
      const n = String(i + 1);
      const client = cleanText(row.client);
      const tech = cleanText(row.technician);
      if (!client) {
        blockingErrors.push(t("validate.missingClient").replace("{n}", n));
        badRows.add(i);
        fErrors[`${i}:client`] = "Cliente obrigatório";
      }
      if (!tech) {
        blockingErrors.push(t("validate.missingTechnician").replace("{n}", n));
        badRows.add(i);
        fErrors[`${i}:technician`] = "Selecione um técnico";
      }
      const hasService = cleanText(row.service_1_name) || cleanText(row.service_2_name) || cleanText(row.service_3_name) || cleanText(row.service_4_name);
      if (!hasService) {
        blockingErrors.push(t("validate.missingService").replace("{n}", n));
        badRows.add(i);
      }
      const computed = (Number(row.service_1_price) || 0) + (Number(row.service_2_price) || 0) + (Number(row.service_3_price) || 0) + (Number(row.service_4_price) || 0);
      if (row.total != null && Math.abs(computed - row.total) > 0.01) {
        blockingErrors.push(t("validate.totalMismatch").replace("{n}", n).replace("{expected}", String(computed)).replace("{actual}", String(row.total)));
        badRows.add(i);
      }
      if ((row.total ?? 0) <= 0) {
        blockingErrors.push(t("validate.zeroTotal").replace("{n}", n));
        badRows.add(i);
      }

      // Review warnings: only flag fields that HAVE values with low confidence, or required fields
      const lowFields = Object.entries(row.field_confidence || {})
        .filter(([k, v]) => {
          if (v !== "low") return false;
          // Ignore empty optional fields (like platform or license_plate without value)
          if (["platform", "license_plate"].includes(k) && !cleanText(row[k as keyof ExtractedOrder])) {
            return false;
          }
          return true;
        })
        .map(([k]) => k);

      if (lowFields.length > 0) {
        reviewWarnings.push(t("validate.lowConfidence").replace("{n}", n).replace("{fields}", lowFields.join(", ")));
      }
    });

    setValidationErrors(blockingErrors);
    setValidationWarnings(reviewWarnings);
    setErrorRows(badRows);
    setFieldErrors(fErrors);

    if (blockingErrors.length === 0) {
      setStage("save");
      return true;
    } else {
      setStage("validate");
      return false;
    }
  };

  const handleSave = () => {
    const passed = runValidation();
    if (!passed) {
      // Show override dialog — user can still force save if desired
      setShowOverrideDialog(true);
      return;
    }
    doSave();
  };

  const doSave = () => {
    setShowOverrideDialog(false);
    setStage("save");
    onSave(rows, { isPrivate });
  };

  const hasCorrections = rows.some((r) => r.handwritten_corrections?.length);
  const hasMismatches = rows.some((r) => r.total_mismatch);
  const lowCount = rows.reduce((c, r) => c + Object.values(r.field_confidence || {}).filter(v => v === "low").length, 0);
  const medCount = rows.reduce((c, r) => c + Object.values(r.field_confidence || {}).filter(v => v === "medium").length, 0);
  const uncertainCount = lowCount + medCount;
  const rowsNeedingReview = rows.filter(r => Object.values(r.field_confidence || {}).some(v => v === "low" || v === "medium")).length;

  return (
    <div className="space-y-3">
      <ExtractionStages current={stage} />
      <BulkEditBanner pending={pendingBulk} onApply={applyBulk} onDismiss={() => setPendingBulk(null)} />

      {/* Review summary banner — shown whenever uncertain fields exist */}
      {(uncertainCount > 0 || hasMismatches) && (
        <div className={cn(
          "flex items-start gap-3 rounded-lg border p-3",
          lowCount > 0 ? "border-destructive/30 bg-destructive/5" : "border-amber-500/30 bg-amber-500/5"
        )}>
          <AlertTriangle className={cn("h-5 w-5 shrink-0 mt-0.5", lowCount > 0 ? "text-destructive" : "text-amber-400")} />
          <div className="text-sm space-y-1">
            <p className={cn("font-medium", lowCount > 0 ? "text-destructive" : "text-amber-400")}>
              {uncertainCount} {t("extract.fieldsNeedReview")} · {rowsNeedingReview} {t("extract.rowsToReview")}
            </p>
            <p className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
              {lowCount > 0 && <span className="text-destructive font-medium">● {lowCount} {t("extract.lowConfFields")}</span>}
              {medCount > 0 && <span className="text-amber-400">● {medCount} {t("extract.medConfFields")}</span>}
              {hasMismatches && <span className="text-destructive">● {t("extract.totalMismatch")}</span>}
            </p>
            <p className="text-[11px] text-muted-foreground/70">{t("extract.clickToFix")}</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-sm font-semibold text-foreground">{t("extract.title")}</h3>
          <Badge variant="outline" className={cn("text-xs", confidenceColors[confidence])}>
            {confidence} {t("extract.confidence")}
          </Badge>
          {hasCorrections && (
            <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30">
              <Pencil className="h-3 w-3 mr-1" />
              {t("extract.corrections")}
            </Badge>
          )}
          {/* Editing mode indicator — always active */}
          <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
            <Pencil className="h-3 w-3 mr-1" />
            {t("edit.modeActive")}
          </Badge>
          {/* Responsável indicator for technician users (locked to their identity) */}
          {lockTechnician && myTechnicianName && (
            <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-400 border-blue-500/30">
              <UserCheck className="h-3 w-3 mr-1" />
              Responsável: {myTechnicianName}
              <Lock className="h-3 w-3 ml-1.5 opacity-70" />
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!hidePrivacyToggle && (
            <label
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] cursor-pointer select-none transition-colors",
                isPrivate
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  : "border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground"
              )}
              title={
                isPrivate
                  ? "OS privada — não entra no fluxo coletivo do workspace"
                  : "OS vinculada ao workspace — visível e contabilizada coletivamente"
              }
            >
              <input
                type="checkbox"
                className="h-3 w-3 accent-amber-500"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
              />
              {isPrivate ? "Privada" : "Workspace"}
            </label>
          )}
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={isSaving}>
            <Trash2 className="h-4 w-4 mr-1" /> {t("action.discard")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => runValidation()} disabled={rows.length === 0}>
            <CheckCircle2 className="h-4 w-4 mr-1" /> {t("validate.run")}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving || rows.length === 0}>
            <Save className="h-4 w-4 mr-1" /> {t("extract.saveN").replace("{n}", String(rows.length))}
          </Button>
        </div>
      </div>

      {validationErrors.length > 0 && (
        <div
          role="alert"
          aria-live="assertive"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 space-y-2 shadow-sm"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <XCircle className="h-5 w-5" />
            Corrija os erros antes de salvar
          </div>
          <p className="text-xs text-destructive/80">
            {validationErrors.length} {validationErrors.length === 1 ? "problema obrigatório encontrado" : "problemas obrigatórios encontrados"}. Revise os campos destacados abaixo:
          </p>
          <ul className="list-disc list-inside text-xs text-destructive/90 space-y-0.5">
            {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {validationErrors.length === 0 && validationWarnings.length > 0 && (
        <div
          role="status"
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-1 shadow-sm text-amber-500 dark:text-amber-400"
        >
          <div className="flex items-center gap-2 text-xs font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Revisão recomendada ({validationWarnings.length} {validationWarnings.length === 1 ? "campo" : "campos"} com baixa confiança)
          </div>
          <p className="text-[11px] opacity-90">
            Campos opcionais vazios foram aceitos. Você pode salvar normalmente.
          </p>
        </div>
      )}

      {notes && (
        <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-lg p-2">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>{notes}</span>
        </div>
      )}

      <div className="rounded-lg border border-border/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/30">
              <TableHead className="w-8">#</TableHead>
              <TableHead>{t("label.client")}</TableHead>
              <TableHead>{t("label.platform")}</TableHead>
              <TableHead>{t("label.technician")}</TableHead>
              <TableHead>{t("label.week")}</TableHead>
              <TableHead>{t("label.car")}</TableHead>
              <TableHead>{t("label.plate")}</TableHead>
              <TableHead>Service 1</TableHead>
              <TableHead className="w-20">{t("extract.price")}</TableHead>
              <TableHead>Service 2</TableHead>
              <TableHead className="w-20">{t("extract.price")}</TableHead>
              <TableHead>Service 3</TableHead>
              <TableHead className="w-20">{t("extract.price")}</TableHead>
              <TableHead>Service 4</TableHead>
              <TableHead className="w-20">{t("extract.price")}</TableHead>
              <TableHead className="w-24">{t("label.total")}</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, idx) => {
              const fc = row.field_confidence || {};
              return (
                <TableRow key={idx} className={cn("group", row.total_mismatch && "bg-red-500/5", errorRows.has(idx) && "bg-destructive/10 ring-1 ring-inset ring-destructive/30")}>
                  <TableCell className={cn("text-muted-foreground text-xs", errorRows.has(idx) && "text-destructive font-bold")}>{idx + 1}</TableCell>
                  <ConfidenceCell value={row.client} confidence={fc.client} onChange={(v) => update(idx, "client", v)} />
                  <ConfidenceCell value={row.platform} confidence={fc.platform} onChange={(v) => update(idx, "platform", v)} isOptional />
                  <TechnicianSelectCell value={row.technician} confidence={fc.technician} technicians={technicians} disabled={!canEditTechnician} error={fieldErrors[`${idx}:technician`]} onChange={(v) => update(idx, "technician", v)} />
                  <ConfidenceCell value={row.week} confidence={fc.week} onChange={(v) => update(idx, "week", v)} />
                  <ConfidenceCell value={row.car_name} confidence={fc.car_name} onChange={(v) => update(idx, "car_name", v)} />
                  <ConfidenceCell value={row.license_plate} confidence={fc.license_plate} onChange={(v) => update(idx, "license_plate", v)} isOptional />
                  <ConfidenceCell value={row.service_1_name} confidence={fc.service_1_name} onChange={(v) => update(idx, "service_1_name", v)} />
                  <ConfidenceNumCell value={row.service_1_price} confidence={fc.service_1_price} onChange={(v) => update(idx, "service_1_price", v)} />
                  <ConfidenceCell value={row.service_2_name} confidence={fc.service_2_name} onChange={(v) => update(idx, "service_2_name", v)} isOptional />
                  <ConfidenceNumCell value={row.service_2_price} confidence={fc.service_2_price} onChange={(v) => update(idx, "service_2_price", v)} />
                  <ConfidenceCell value={row.service_3_name} confidence={fc.service_3_name} onChange={(v) => update(idx, "service_3_name", v)} isOptional />
                  <ConfidenceNumCell value={row.service_3_price} confidence={fc.service_3_price} onChange={(v) => update(idx, "service_3_price", v)} />
                  <ConfidenceCell value={row.service_4_name} confidence={fc.service_4_name} onChange={(v) => update(idx, "service_4_name", v)} isOptional />
                  <ConfidenceNumCell value={row.service_4_price} confidence={fc.service_4_price} onChange={(v) => update(idx, "service_4_price", v)} />
                  <TableCell className={cn("font-semibold tabular-nums", row.total_mismatch ? "text-destructive" : "text-primary")}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={cn(row.total_mismatch && "cursor-help underline decoration-dashed")}>
                          {row.total != null ? formatCurrency(row.total) : "—"}
                        </span>
                      </TooltipTrigger>
                      {row.total_mismatch && (
                        <TooltipContent>{t("extract.totalMismatchTip")}</TooltipContent>
                      )}
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => removeRow(idx)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={17} className="text-center text-muted-foreground py-8">
                  {t("extract.noOrders")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={showOverrideDialog} onOpenChange={setShowOverrideDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("validate.inconsistentData")}</AlertDialogTitle>
            <AlertDialogDescription>{t("validate.overrideConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("action.discard")}</AlertDialogCancel>
            <AlertDialogAction onClick={doSave} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t("validate.forceOverride")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ConfidenceCell({
  value,
  confidence,
  onChange,
  isOptional = false,
}: {
  value: string | null;
  confidence?: FieldConfidence;
  onChange: (v: string) => void;
  isOptional?: boolean;
}) {
  const displayVal = cleanText(value);
  const conf = (!displayVal && isOptional) ? "high" : (confidence || "high");
  const borderClass = fieldConfBorder[conf];
  return (
    <TableCell className="p-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Input
            value={displayVal}
            onChange={(e) => onChange(e.target.value)}
            className={cn("h-8 text-xs bg-transparent hover:border-border focus:border-primary", borderClass)}
          />
        </TooltipTrigger>
        {conf !== "high" && displayVal ? (
          <TooltipContent className="text-xs">
            {conf === "low" ? "⚠️ Baixa confiança — favor verificar" : "⚡ Média confiança — revisão recomendada"}
          </TooltipContent>
        ) : null}
      </Tooltip>
    </TableCell>
  );
}

function ConfidenceNumCell({ value, confidence, onChange }: { value: number | null; confidence?: FieldConfidence; onChange: (v: number | null) => void }) {
  const conf = confidence || "high";
  const borderClass = fieldConfBorder[conf];
  return (
    <TableCell className="p-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Input
            type="number"
            step="0.01"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value ? parseFloat(e.target.value) : null)}
            className={cn("h-8 text-xs bg-transparent hover:border-border focus:border-primary tabular-nums w-20", borderClass)}
          />
        </TooltipTrigger>
        {conf !== "high" && value != null && (
          <TooltipContent className="text-xs">
            {conf === "low" ? "⚠️ Baixa confiança — favor verificar" : "⚡ Média confiança — revisão recomendada"}
          </TooltipContent>
        )}
      </Tooltip>
    </TableCell>
  );
}

function TechnicianSelectCell({
  value,
  confidence,
  technicians,
  disabled,
  error,
  onChange,
}: {
  value: string | null;
  confidence?: FieldConfidence;
  technicians: TechnicianOption[];
  disabled: boolean;
  error?: string;
  onChange: (v: string) => void;
}) {
  const byId = technicians.find((t) => t.user_id === value);
  const byName = !byId && value ? technicians.find((t) => t.name.toLowerCase() === cleanText(value).toLowerCase()) : undefined;
  const current = byId?.user_id || byName?.user_id || "";

  useEffect(() => {
    if (byName && byName.user_id !== value) {
      onChange(byName.user_id);
    }
  }, [byName, value, onChange]);

  const conf = confidence || "high";
  const borderClass = fieldConfBorder[conf];
  const isMissing = !current;
  const showError = !!error || (isMissing && !disabled);

  return (
    <TableCell className="p-1 align-top">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="space-y-1">
            <Select
              value={current}
              onValueChange={onChange}
              disabled={disabled}
            >
              <SelectTrigger
                aria-invalid={showError}
                className={cn(
                  "h-8 text-xs bg-transparent hover:border-border",
                  borderClass,
                  showError && "border-destructive bg-destructive/10 ring-1 ring-destructive/40",
                  disabled && "opacity-80 cursor-not-allowed"
                )}
              >
                <SelectValue placeholder="Selecione um técnico" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {technicians.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    Nenhum técnico cadastrado
                  </SelectItem>
                ) : (
                  technicians.map((t) => (
                    <SelectItem key={t.user_id} value={t.user_id}>
                      <span className="font-medium">{t.name}</span>
                      {t.display_code ? (
                        <span className="ml-2 text-[10px] text-muted-foreground">{t.display_code}</span>
                      ) : null}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {error && (
              <p className="text-[10px] font-medium text-destructive flex items-center gap-1 leading-tight">
                <XCircle className="h-3 w-3 shrink-0" />
                {error}
              </p>
            )}
          </div>
        </TooltipTrigger>
        {disabled ? (
          <TooltipContent className="text-xs">
            🔒 Sua conta de técnico já está vinculada — não pode alterar
          </TooltipContent>
        ) : isMissing ? (
          <TooltipContent className="text-xs">
            ⚠️ Selecione um técnico antes de salvar
          </TooltipContent>
        ) : conf !== "high" ? (
          <TooltipContent className="text-xs">
            {conf === "low" ? "⚠️ Baixa confiança — favor verificar" : "⚡ Média confiança — revisão recomendada"}
          </TooltipContent>
        ) : null}
      </Tooltip>
    </TableCell>
  );
}
