import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, X, Trash2, AlertTriangle, CheckCircle2, XCircle, Pencil } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ExtractedPaymentOrder, FieldConfidence } from "@/hooks/usePaymentOrders";
import { cn } from "@/lib/utils";
import { formatLicensePlate } from "@/lib/formatPlate";
import { useLanguage } from "@/hooks/useLanguage";
import { ExtractionStages, type Stage } from "@/components/service-orders/ExtractionStages";
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

const MAX_SERVICES = 4;

interface Props {
  orders: ExtractedPaymentOrder[];
  confidence: "high" | "medium" | "low";
  notes?: string;
  onSave: (orders: ExtractedPaymentOrder[]) => void;
  onDiscard: () => void;
  isSaving?: boolean;
  technicians?: { user_id: string; name: string; display_code?: string | null }[];
  isTechnicianRole?: boolean;
  isAdmin?: boolean;
  myTechnicianName?: string | null;
}

const confidenceColors: Record<string, string> = {
  high: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  low: "bg-red-500/10 text-red-400 border-red-500/30",
};

const fieldConfBorder: Record<FieldConfidence, string> = {
  high: "border-transparent",
  medium: "border-amber-500/50 bg-amber-500/5",
  low: "border-red-500/50 bg-red-500/5",
};

/** Pad services array to exactly MAX_SERVICES entries */
function padServices(services: { name: string; price: number; confidence?: FieldConfidence }[]): { name: string; price: number; confidence?: FieldConfidence }[] {
  const result = services.slice(0, MAX_SERVICES);
  while (result.length < MAX_SERVICES) {
    result.push({ name: "", price: 0 });
  }
  return result;
}

/** Compute total from services */
function computeTotal(services: { name: string; price: number }[]): number {
  return services.reduce((sum, s) => sum + (s.price || 0), 0);
}

export function ExtractedPaymentTable({ orders, confidence, notes, onSave, onDiscard, isSaving, technicians = [], isTechnicianRole, isAdmin = false, myTechnicianName = null }: Props) {
  const lockTechnician = typeof isTechnicianRole === "boolean" ? isTechnicianRole : !isAdmin;
  const resolveTechUserIdFromText = (text: string | null): string | null => {
    if (!text) return null;
    const norm = text.trim().toLowerCase();
    const exact = technicians.find((t) => t.name.toLowerCase() === norm || t.user_id === text);
    if (exact) return exact.user_id;
    const partial = technicians.find((t) => t.name.toLowerCase().includes(norm) || norm.includes(t.name.toLowerCase()));
    return partial?.user_id ?? null;
  };
  const [rows, setRows] = useState<ExtractedPaymentOrder[]>(() => {
    if (lockTechnician && myTechnicianName) {
      const myUserId = technicians.find((t) => t.name === myTechnicianName)?.user_id ?? null;
      return orders.map(o => ({ ...o, technician: myUserId ?? myTechnicianName, services: padServices(o.services || []) }));
    }
    return orders.map(o => ({ ...o, technician: resolveTechUserIdFromText(o.technician) ?? o.technician, services: padServices(o.services || []) }));
  });
  const [stage, setStage] = useState<Stage>("review");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [errorRows, setErrorRows] = useState<Set<number>>(new Set());
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [pendingBulk, setPendingBulk] = useState<PendingBulkEdit | null>(null);
  const [lastEditIdx, setLastEditIdx] = useState<number>(-1);
  const { t, formatCurrency } = useLanguage();

  const fieldLabels: Record<string, string> = {
    client: t("label.client"), platform: t("label.platform"), list_name: t("extract.listName"),
    technician: t("label.technician"), car_name: t("label.car"), license_plate: t("label.plate"),
  };

  const updateField = (idx: number, field: keyof ExtractedPaymentOrder, value: any) => {
    setValidationErrors([]);
    setErrorRows(new Set());
    if (stage !== "review") setStage("review");
    setRows(prev => prev.map((r, i) => {
      if (i !== idx) return r;
      const updated = { ...r, [field]: value };
      if (field === "license_plate" && typeof value === "string") {
        updated.license_plate = formatLicensePlate(value);
      }
      if (updated.field_confidence) {
        updated.field_confidence = { ...updated.field_confidence, [field]: "high" };
      }
      return updated;
    }));

    const bulkFields = ["client", "platform", "list_name", "technician", "car_name", "license_plate"];
    if (rows.length > 1 && bulkFields.includes(field as string)) {
      setLastEditIdx(idx);
      setPendingBulk({ field: field as string, value, label: fieldLabels[field as string] || (field as string) });
    }
  };

  /** Update a single service at a specific index — no cross-contamination */
  const updateService = (rowIdx: number, serviceIdx: number, field: "name" | "price", value: string | number) => {
    setValidationErrors([]);
    setErrorRows(new Set());
    if (stage !== "review") setStage("review");
    setRows(prev => prev.map((r, i) => {
      if (i !== rowIdx) return r;
      const newServices = r.services.map((s, si) => {
        if (si !== serviceIdx) return s;
        return { ...s, [field]: value, confidence: "high" as FieldConfidence };
      });
      const total = computeTotal(newServices);
      return { ...r, services: newServices, total, total_mismatch: false };
    }));

    // Trigger bulk edit banner for service fields
    if (rows.length > 1) {
      setLastEditIdx(rowIdx);
      const label = `${t("label.service")} ${serviceIdx + 1} (${field === "name" ? t("label.service") : t("label.total")})`;
      setPendingBulk({ field: `service_${serviceIdx}_${field}`, value, label, serviceIndex: serviceIdx, serviceField: field });
    }
  };

  const applyBulk = () => {
    if (!pendingBulk) return;

    // Service-specific bulk edit: only update the exact service index + field
    if (pendingBulk.serviceIndex != null && pendingBulk.serviceField) {
      const si = pendingBulk.serviceIndex;
      const sf = pendingBulk.serviceField;
      const val = pendingBulk.value;
      setRows(prev => prev.map((r, i) => {
        if (i === lastEditIdx) return r;
        // Skip rows where service index doesn't exist
        if (!r.services || si >= r.services.length) return r;
        const newServices = r.services.map((s, idx) => {
          if (idx !== si) return s;
          return { ...s, [sf]: val };
        });
        const total = computeTotal(newServices);
        return { ...r, services: newServices, total, total_mismatch: false };
      }));
    } else {
      // Regular field bulk edit
      setRows(prev => prev.map((r, i) => {
        if (i === lastEditIdx) return r;
        return { ...r, [pendingBulk.field]: pendingBulk.value };
      }));
    }
    setPendingBulk(null);
  };

  const removeRow = (idx: number) => {
    setRows(prev => prev.filter((_, i) => i !== idx));
    setValidationErrors([]);
    setErrorRows(new Set());
    if (stage !== "review") setStage("review");
  };

  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);

  const runValidation = (): boolean => {
    const blockingErrors: string[] = [];
    const reviewWarnings: string[] = [];
    const badRows = new Set<number>();

    rows.forEach((row, i) => {
      const n = String(i + 1);
      const client = row.client?.trim();
      const tech = row.technician?.trim();
      if (!client || client.toLowerCase() === "null") {
        blockingErrors.push(t("validate.missingClient").replace("{n}", n));
        badRows.add(i);
      }
      if (!tech || tech.toLowerCase() === "null") {
        blockingErrors.push(t("validate.missingTechnician").replace("{n}", n));
        badRows.add(i);
      }
      const hasService = (row.services || []).some(s => s.name?.trim() && s.name.toLowerCase() !== "null");
      if (!hasService) {
        blockingErrors.push(t("validate.missingService").replace("{n}", n));
        badRows.add(i);
      }
      const computed = computeTotal(row.services || []);
      if (row.total != null && Math.abs(computed - (row.total || 0)) > 0.01) {
        blockingErrors.push(t("validate.totalMismatch").replace("{n}", n).replace("{expected}", String(computed)).replace("{actual}", String(row.total)));
        badRows.add(i);
      }
      if ((row.total ?? 0) <= 0) {
        blockingErrors.push(t("validate.zeroTotal").replace("{n}", n));
        badRows.add(i);
      }

      const lowFields = Object.entries(row.field_confidence || {})
        .filter(([k, v]) => {
          if (v !== "low") return false;
          if (["platform", "license_plate", "list_name"].includes(k) && !row[k as keyof typeof row]) return false;
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
      setShowOverrideDialog(true);
      return;
    }
    doSave();
  };

  const doSave = () => {
    setShowOverrideDialog(false);
    setStage("save");
    // Strip empty services before saving
    const cleaned = rows.map(r => ({
      ...r,
      services: r.services.filter(s => s.name?.trim()),
    }));
    onSave(cleaned);
  };

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-border/50 bg-card p-6 text-center text-muted-foreground text-sm">
        {t("extract.noPayments")}
      </div>
    );
  }

  const hasCorrections = rows.some(r => r.handwritten_corrections?.length);
  const hasMismatches = rows.some(r => r.total_mismatch);
  const lowCount = rows.reduce((c, r) => c + Object.values(r.field_confidence || {}).filter(v => v === "low").length, 0);
  const medCount = rows.reduce((c, r) => c + Object.values(r.field_confidence || {}).filter(v => v === "medium").length, 0);
  const uncertainCount = lowCount + medCount;
  const rowsNeedingReview = rows.filter(r => Object.values(r.field_confidence || {}).some(v => v === "low" || v === "medium")).length;

  return (
    <div className="space-y-3">
      <ExtractionStages current={stage} />
      <BulkEditBanner pending={pendingBulk} onApply={applyBulk} onDismiss={() => setPendingBulk(null)} />

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

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-medium text-foreground">{t("extract.paymentTitle")}</h3>
          <Badge variant="outline" className={confidenceColors[confidence]}>
            {confidence} {t("extract.confidence")}
          </Badge>
          <span className="text-xs text-muted-foreground">{rows.length} {t("extract.entries")}</span>
          {hasCorrections && (
            <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-400 border-amber-500/30">
              <Pencil className="h-3 w-3 mr-1" />
              {t("extract.corrections")}
            </Badge>
          )}
          <Badge variant="outline" className="text-xs bg-primary/10 text-primary border-primary/30">
            <Pencil className="h-3 w-3 mr-1" />
            {t("edit.modeActive")}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onDiscard}><X className="h-4 w-4 mr-1" />{t("action.discard")}</Button>
          <Button size="sm" variant="outline" onClick={() => runValidation()} disabled={rows.length === 0}>
            <CheckCircle2 className="h-4 w-4 mr-1" /> {t("validate.run")}
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving || rows.length === 0}>
            <Save className="h-4 w-4 mr-1" />{isSaving ? t("extract.saving") : t("action.save")}
          </Button>
        </div>
      </div>

      {validationErrors.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <XCircle className="h-4 w-4" />
            {t("validate.failed")}
          </div>
          <ul className="list-disc list-inside text-xs text-destructive/80 space-y-0.5">
            {validationErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {notes && (
        <Alert variant="destructive" className="bg-amber-500/5 border-amber-500/20">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">{notes}</AlertDescription>
        </Alert>
      )}

      <div className="rounded-lg border border-border/50 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow className="text-[11px]">
              <TableHead className="w-8">#</TableHead>
              <TableHead>{t("label.client")}</TableHead>
              <TableHead>{t("label.platform")}</TableHead>
              <TableHead>{t("extract.listName")}</TableHead>
              <TableHead>{t("label.technician")}</TableHead>
              <TableHead>{t("label.car")}</TableHead>
              <TableHead>{t("label.plate")}</TableHead>
              {[1, 2, 3, 4].map(n => (
                <TableHead key={`sh${n}`} colSpan={2} className="text-center">
                  {t("label.service")} {n}
                </TableHead>
              ))}
              <TableHead className="text-right">{t("label.total")}</TableHead>
              <TableHead className="w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, i) => {
              const fc = row.field_confidence || {};
              const services = padServices(row.services || []);
              return (
                <TableRow key={i} className={cn("text-xs", row.total_mismatch && "bg-red-500/5", errorRows.has(i) && "bg-destructive/10 ring-1 ring-inset ring-destructive/30")}>
                  <TableCell className={cn("text-muted-foreground", errorRows.has(i) && "text-destructive font-bold")}>{i + 1}</TableCell>
                  <TableCell><ConfEditCell value={row.client || ""} confidence={fc.client} onChange={v => updateField(i, "client", v)} /></TableCell>
                  <TableCell><ConfEditCell value={row.platform || ""} confidence={fc.platform} onChange={v => updateField(i, "platform", v)} /></TableCell>
                  <TableCell><ConfEditCell value={row.list_name || ""} confidence={fc.list_name} onChange={v => updateField(i, "list_name", v)} /></TableCell>
                  <TableCell>
                    <TechnicianSelectCell
                      value={row.technician || ""}
                      confidence={fc.technician}
                      technicians={technicians}
                      disabled={lockTechnician}
                      onChange={v => updateField(i, "technician", v)}
                    />
                  </TableCell>
                  <TableCell><ConfEditCell value={row.car_name || ""} confidence={fc.car_name} onChange={v => updateField(i, "car_name", v)} /></TableCell>
                  <TableCell><ConfEditCell value={row.license_plate || ""} confidence={fc.license_plate} onChange={v => updateField(i, "license_plate", v)} /></TableCell>
                  {services.map((s, si) => (
                    <ServiceCellPair
                      key={si}
                      service={s}
                      onNameChange={v => updateService(i, si, "name", v)}
                      onPriceChange={v => updateService(i, si, "price", v)}
                    />
                  ))}
                  <TableCell className={cn("text-right font-medium tabular-nums", row.total_mismatch ? "text-destructive" : "")}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={cn(row.total_mismatch && "cursor-help underline decoration-dashed")}>
                          {formatCurrency(row.total || 0)}
                        </span>
                      </TooltipTrigger>
                      {row.total_mismatch && (
                        <TooltipContent>{t("extract.totalMismatchTip")}</TooltipContent>
                      )}
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeRow(i)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
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

/** Renders name + price inputs for a single service slot */
function ServiceCellPair({
  service,
  onNameChange,
  onPriceChange,
}: {
  service: { name: string; price: number; confidence?: FieldConfidence };
  onNameChange: (v: string) => void;
  onPriceChange: (v: number) => void;
}) {
  const conf = service.confidence || "high";
  const borderClass = conf !== "high" ? fieldConfBorder[conf] : "";
  return (
    <>
      <TableCell className="p-1">
        <Input
          className={cn("h-6 text-[11px] px-1 w-20", borderClass)}
          value={service.name}
          placeholder="—"
          onChange={e => onNameChange(e.target.value)}
        />
      </TableCell>
      <TableCell className="p-1">
        <Input
          className={cn("h-6 text-[11px] px-1 w-16 text-right tabular-nums", borderClass)}
          type="number"
          step="0.01"
          value={service.price || ""}
          placeholder="0"
          onChange={e => onPriceChange(parseFloat(e.target.value) || 0)}
        />
      </TableCell>
    </>
  );
}

function ConfEditCell({ value, confidence, onChange }: { value: string; confidence?: FieldConfidence; onChange: (v: string) => void }) {
  const conf = confidence || "high";
  const borderClass = fieldConfBorder[conf];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Input
          className={cn("h-6 text-[11px] px-1 bg-transparent hover:border-border focus:border-border", borderClass)}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
      </TooltipTrigger>
      {conf !== "high" && (
        <TooltipContent className="text-xs">
          {conf === "low" ? "⚠️ Low confidence — please verify" : "⚡ Medium confidence — review recommended"}
        </TooltipContent>
      )}
    </Tooltip>
  );
}

function TechnicianSelectCell({
  value,
  confidence,
  technicians,
  disabled,
  onChange,
}: {
  value: string;
  confidence?: FieldConfidence;
  technicians: { user_id: string; name: string; display_code?: string | null }[];
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const conf = confidence || "high";
  const borderClass = fieldConfBorder[conf];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>
          <Select value={value} onValueChange={onChange} disabled={disabled}>
            <SelectTrigger className={cn("h-6 text-[11px] px-1 bg-transparent hover:border-border", borderClass, disabled && "opacity-80 cursor-not-allowed")}>
              <SelectValue placeholder="Técnico" />
            </SelectTrigger>
            <SelectContent className="max-h-64">
              {technicians.map((t) => (
                <SelectItem key={t.user_id} value={t.user_id}>
                  <span className="font-medium">{t.name}</span>
                  {t.display_code ? <span className="ml-2 text-[10px] text-muted-foreground">{t.display_code}</span> : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </TooltipTrigger>
      {disabled ? (
        <TooltipContent className="text-xs">🔒 Técnico vinculado à própria conta</TooltipContent>
      ) : conf !== "high" ? (
        <TooltipContent className="text-xs">
          {conf === "low" ? "⚠️ Low confidence — please verify" : "⚡ Medium confidence — review recommended"}
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}
