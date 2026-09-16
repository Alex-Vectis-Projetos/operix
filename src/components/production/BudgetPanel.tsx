import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Calculator, Calendar, Car, User, FileText, ArrowRightLeft, AlertTriangle, FileDown } from "lucide-react";
import {
  BudgetDialog,
  emptyBudget,
  formatBRL,
  getBudgetInterventions,
  type Budget,
  type BudgetStatus,
} from "./BudgetDialog";
import { toast } from "sonner";
import {
  useProductionOrders,
  type ProductionOrder,
  type ProductionPriority,
  type ProductionStatus,
} from "@/hooks/useProductionOrders";
import { useLanguage } from "@/hooks/useLanguage";
import {
  openBudgetPreview as sharedOpenBudgetPreview,
  downloadBudgetHtml as sharedDownloadBudgetHtml,
} from "@/lib/budgetPdfUtils";
import { LocalBudgetsSyncBanner } from "./LocalBudgetsSyncBanner";
import { useBudgets } from "@/hooks/useBudgets";
import { apiBudgetToLocalBudget, localBudgetToApiPayload } from "@/lib/apiBudgets";

const STORAGE_KEY = "budgets-local-v1";
const BUDGET_TO_ORDER_MAP_KEY = "budget-to-production-order-v1";

const STATUS_META: Record<BudgetStatus, { label: string; tone: string }> = {
  draft: { label: "Rascunho", tone: "bg-slate-500/10 text-slate-700 dark:text-slate-300" },
  sent: { label: "Rascunho", tone: "bg-slate-500/10 text-slate-700 dark:text-slate-300" },
  approved: {
    label: "Aprovado",
    tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  rejected: {
    label: "Rejeitado",
    tone: "bg-destructive/10 text-destructive",
  },
  correction_needed: {
    label: "Rascunho",
    tone: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  },
};

function visualBudgetStatusLabelAndTone(b: Budget): { label: string; tone: string } {
  switch (b.status) {
    case "approved":
      return STATUS_META.approved;
    case "rejected":
      return STATUS_META.rejected;
    default:
      return STATUS_META.draft;
  }
}

interface Props {
  onOpenOrder?: (order: ProductionOrder) => void;
}

export function BudgetPanel({ onOpenOrder }: Props) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<null | "total" | "draft" | "approved" | "rejected">(null);
  const { data: productionOrders, create: createOrder } = useProductionOrders();
  const { langDisplay } = useLanguage();

  const {
    budgets: apiBudgets,
    create: createBudgetMutation,
    updateRevision: updateRevisionMutation,
    approve: approveBudgetMutation,
    remove: removeBudgetMutation,
  } = useBudgets();

  const items = useMemo<Budget[]>(() => {
    return (apiBudgets || []).map(apiBudgetToLocalBudget);
  }, [apiBudgets]);

  useEffect(() => {
    try {
      const rawMap = localStorage.getItem(BUDGET_TO_ORDER_MAP_KEY);
      if (rawMap) {
        const parsed = JSON.parse(rawMap) as unknown;
        if (parsed && typeof parsed === "object") {
          setMapping(parsed as Record<string, string>);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const handleCorrectionRequest = (ev: Event) => {
      const ce = ev as CustomEvent<{ budgetId: string; reason?: string }>;
      const budgetId = ce.detail?.budgetId;
      if (!budgetId) return;
      setItems((prev) => {
        const next = prev.map((b) => {
          if (b.id !== budgetId) return b;
          const updated: Budget = {
            ...b,
            status: "draft",
            updated_at: new Date().toISOString(),
            signature: b.signature
              ? {
                  ...b.signature,
                  finalValueAtMoment: undefined as any,
                  confirmedAt: undefined as any,
                  signerName: undefined as any,
                  signedAt: undefined as any,
                }
              : b.signature,
            rejection: ce.detail?.reason
              ? {
                  rejected: true,
                  rejectedAt: new Date().toISOString(),
                  rejectedBy: "Produção",
                  reason: `Retornado da Produção: ${ce.detail.reason}`,
                }
              : b.rejection,
          };
          return updated;
        });
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
      setMapping((prev) => {
        if (!prev[budgetId]) return prev;
        const next = { ...prev };
        delete next[budgetId];
        try {
          localStorage.setItem(BUDGET_TO_ORDER_MAP_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
      toast.message(`Orçamento ${budgetId.slice(0, 8)} retornado para Rascunho.`);
    };
    window.addEventListener("budget:correction-requested", handleCorrectionRequest);
    const handleProductionReturnToBudget = (ev: Event) => {
      const ce = ev as CustomEvent<{ productionOrderId: string }>;
      const orderId = ce.detail?.productionOrderId;
      if (!orderId) return;
      setMapping((currentMap) => {
        const budgetId = Object.keys(currentMap).find(
          (k) => currentMap[k] === orderId,
        );
        if (budgetId) {
          setItems((prev) => {
            const next = prev.map((b) => {
              if (b.id !== budgetId) return b;
              return {
                ...b,
                status: "draft",
                updated_at: new Date().toISOString(),
                signature: b.signature
                  ? {
                      ...b.signature,
                      finalValueAtMoment: undefined as any,
                      confirmedAt: undefined as any,
                      signerName: undefined as any,
                      signedAt: undefined as any,
                    }
                  : b.signature,
              };
            });
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch {}
            return next;
          });
          const next = { ...currentMap };
          delete next[budgetId];
          try {
            localStorage.setItem(BUDGET_TO_ORDER_MAP_KEY, JSON.stringify(next));
          } catch {}
          return next;
        }
        return currentMap;
      });
    };
    window.addEventListener(
      "production:return-to-budget",
      handleProductionReturnToBudget,
    );
    const handleBudgetApprovedAutoSendToProduction = (ev: Event) => {
      const ce = ev as CustomEvent<{ budgetId: string }>;
      const budgetId = ce.detail?.budgetId;
      if (!budgetId) return;
      setItems((snapshot) => {
        const b = snapshot.find((x) => x.id === budgetId);
        if (b && isBudgetLocked(b)) {
          setMapping((mp) => {
            if (mp[b.id]) return mp;
            void sendToProductionAsync(b, mp);
            return mp;
          });
        }
        return snapshot;
      });
    };
    window.addEventListener(
      "budget:approved-for-production",
      handleBudgetApprovedAutoSendToProduction,
    );
    return () => {
      window.removeEventListener("budget:correction-requested", handleCorrectionRequest);
      window.removeEventListener(
        "production:return-to-budget",
        handleProductionReturnToBudget,
      );
      window.removeEventListener(
        "budget:approved-for-production",
        handleBudgetApprovedAutoSendToProduction,
      );
    };
  }, []);

  const totals = useMemo(() => {
    return items.reduce(
      (acc, b) => {
        const p = (b.parts || []).reduce(
          (s, x) =>
            s +
            Math.max(0, Number(x?.quantity) || 0) *
              Math.max(0, Number(x?.unit_price) || 0),
          0,
        );
        const sv = Array.isArray((b as any).services)
          ? (b as any).services.reduce(
              (s: number, x: any) =>
                s +
                Math.max(0, Number(x?.quantity) || 0) *
                  Math.max(0, Number(x?.unit_price) || 0),
              0,
            )
          : 0;
        const l = (b.labor || []).reduce(
          (s, x) =>
            s +
            Math.max(0, Number(x?.hours) || 0) *
              Math.max(0, Number(x?.hourly_rate) || 0),
          0,
        );
        const gross = p + sv + l;
        const disc = (gross * Math.max(0, Math.min(100, Number(b.discount_pct) || 0))) / 100;
        const net = Math.max(0, gross - disc);
        const iva = (net * Math.max(0, Number(b.iva_pct) || 0)) / 100;
        const total = net + iva;
        acc.count += 1;
        acc.total += total;
        if (b.status === "approved") acc.approved += 1;
        if (b.status === "draft") acc.drafts += 1;
        if (b.status === "rejected") acc.rejected += 1;
        return acc;
      },
      { count: 0, total: 0, approved: 0, drafts: 0, rejected: 0 },
    );
  }, [items]);

  const persist = (next: Budget[]) => {
    setItems(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // quota excedida etc.
    }
  };

  const persistMapping = (next: Record<string, string>) => {
    setMapping(next);
    try {
      localStorage.setItem(BUDGET_TO_ORDER_MAP_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const handleSave = async (b: Budget) => {
    try {
      const payload = localBudgetToApiPayload(b);
      const existing = (apiBudgets || []).find((x) => x.id === b.id);

      if (existing) {
        const revId =
          existing.currentRevisionId ||
          existing.current_revision_id ||
          existing.currentRevision?.id ||
          existing.current_revision?.id;

        if (!revId) {
          toast.error("Identificador de revisão não localizado para este orçamento.");
          return;
        }

        await updateRevisionMutation.mutateAsync({
          budgetId: b.id,
          revisionId: revId,
          patch: payload,
        });

        if (b.status === "approved" && existing.approvedRevisionId !== revId) {
          await approveBudgetMutation.mutateAsync({
            budgetId: b.id,
            revisionId: revId,
            options: { notes: b.diagnosis || undefined },
          });
        }
      } else {
        await createBudgetMutation.mutateAsync(payload);
      }
      setOpen(false);
      setEditing(null);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao salvar orçamento.");
    }
  };

  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };

  const openEdit = (b: Budget) => {
    setEditing(b);
    setOpen(true);
  };

  const openPreview = (b: Budget) => {
    try {
      sharedOpenBudgetPreview(b, langDisplay);
    } catch {
      toast.error(langDisplay === "fr" ? "Impossible d'ouvrir l'aperçu." : "Não foi possível abrir a visualização.");
    }
  };

  const downloadBudgetFile = (b: Budget) => {
    try {
      sharedDownloadBudgetHtml(b, langDisplay);
    } catch {}
  };

  const removeBudget = async (id: string) => {
    if (!confirm("Remover este orçamento?")) return;
    try {
      await removeBudgetMutation.mutateAsync(id);
      if (mapping[id]) {
        const next = { ...mapping };
        delete next[id];
        persistMapping(next);
      }
    } catch (err: any) {
      toast.error(err?.message || "Erro ao remover orçamento.");
    }
  };

  const computeTotalsFor = (b: Budget) => {
    const p = (b.parts || []).reduce(
      (s, x) =>
        s +
        Math.max(0, Number(x?.quantity) || 0) *
          Math.max(0, Number(x?.unit_price) || 0),
      0,
    );
    const sv = Array.isArray((b as any).services)
      ? (b as any).services.reduce(
          (s: number, x: any) =>
            s +
            Math.max(0, Number(x?.quantity) || 0) *
              Math.max(0, Number(x?.unit_price) || 0),
          0,
        )
      : 0;
    const l = (b.labor || []).reduce(
      (s, x) =>
        s +
        Math.max(0, Number(x?.hours) || 0) *
          Math.max(0, Number(x?.hourly_rate) || 0),
      0,
    );
    const gross = p + sv + l;
    const disc = (gross * Math.max(0, Math.min(100, Number(b.discount_pct) || 0))) / 100;
    const net = Math.max(0, gross - disc);
    const iva = (net * Math.max(0, Number(b.iva_pct) || 0)) / 100;
    return { parts: p, services: sv, labor: l, gross, disc, net, iva, total: net + iva };
  };

  const BUDGET_NOTES_DELIMITER = "--- DADOS DO ORÇAMENTO (NÃO REMOVER ESTA LINHA) ---";

  const buildNotesFromBudget = (b: Budget): string => {
    const t = computeTotalsFor(b);
    const lines: string[] = [];
    lines.push(`Orçamento: ${b.number || "—"}`);
    lines.push(`Data emissão: ${b.issued_at || "—"}`);
    lines.push("");
    lines.push("=== CLIENTE ===");
    lines.push(`Nome: ${b.client_name || "—"}`);
    lines.push(`Contacto: ${b.client_phone || "—"}`);
    lines.push(`E-mail: ${b.client_email || "—"}`);
    lines.push(`Documento: ${b.client_document || "—"}`);
    lines.push("");
    lines.push("=== VEÍCULO ===");
    lines.push(`Marca: ${b.vehicle_brand || "—"}`);
    lines.push(`Modelo: ${b.vehicle_model || "—"}`);
    lines.push(`Matrícula: ${b.vehicle_plate || "—"}`);
    lines.push(`VIN: ${b.vehicle_vin || "—"}`);
    lines.push(`Ano: ${b.vehicle_year || "—"}`);
    lines.push(`Cor: ${b.vehicle_color || "—"}`);
    lines.push(`KM: ${b.vehicle_km || "—"}`);
    lines.push("");
    lines.push("=== INTERVENÇÃO ===");
    const intervs = getBudgetInterventions(b);
    if (intervs.length > 0) {
      intervs.forEach((iv, idx) => lines.push(`${idx + 1}. ${iv}`));
    } else {
      lines.push("—");
    }
    lines.push("");
    lines.push("=== DIAGNÓSTICO ===");
    lines.push(b.diagnosis || "—");
    lines.push("");
    lines.push("=== DESCRIÇÃO TÉCNICA ===");
    lines.push(b.technical_description || "—");
    lines.push("");
    lines.push("=== PEÇAS / MATERIAIS ===");
    if (b.parts && b.parts.length) {
      b.parts.forEach((p, i) => {
        const q = Math.max(0, Number(p.quantity) || 0);
        const u = Math.max(0, Number(p.unit_price) || 0);
        lines.push(
          `${i + 1}. ${p.description || "Peça sem descrição"} · Qtd ${q} × ${formatBRL(u)} = ${formatBRL(q * u)}`,
        );
      });
    } else {
      lines.push("Nenhuma peça lançada.");
    }
    lines.push(`Subtotal Peças: ${formatBRL(t.parts)}`);
    lines.push("");
    lines.push("=== SERVIÇOS ===");
    const servicesArr: Array<{
      description?: string;
      quantity?: number;
      unit_price?: number;
    }> = Array.isArray((b as any).services) ? (b as any).services : [];
    if (servicesArr.length > 0) {
      servicesArr.forEach((s, i) => {
        const q = Math.max(0, Number(s.quantity) || 0);
        const u = Math.max(0, Number(s.unit_price) || 0);
        lines.push(
          `${i + 1}. ${s.description || "Serviço sem descrição"} · Qtd ${q} × ${formatBRL(u)} = ${formatBRL(q * u)}`,
        );
      });
    } else {
      lines.push("Nenhum serviço lançado.");
    }
    lines.push(`Subtotal Serviços: ${formatBRL(t.services)}`);
    lines.push("");
    lines.push("=== MÃO DE OBRA ===");
    if (b.labor && b.labor.length) {
      b.labor.forEach((l, i) => {
        const h = Math.max(0, Number(l.hours) || 0);
        const r = Math.max(0, Number(l.hourly_rate) || 0);
        lines.push(
          `${i + 1}. ${l.description || "Serviço sem descrição"} · ${h}h × ${formatBRL(r)}/h = ${formatBRL(h * r)}`,
        );
      });
    } else {
      lines.push("Nenhum serviço lançado.");
    }
    lines.push(`Subtotal Mão de Obra: ${formatBRL(t.labor)}`);
    lines.push("");
    lines.push("=== TOTAIS ===");
    lines.push(`Subtotal (Peças + Serviços + M.O.): ${formatBRL(t.gross)}`);
    lines.push(`Desconto (${Number(b.discount_pct || 0).toFixed(2)}%): - ${formatBRL(t.disc)}`);
    lines.push(`Base tributável: ${formatBRL(t.net)}`);
    lines.push(`IVA (${Number(b.iva_pct || 0).toFixed(2)}%): + ${formatBRL(t.iva)}`);
    lines.push(`TOTAL DO ORÇAMENTO: ${formatBRL(t.total)}`);
    lines.push("");
    lines.push(
      `Origem: Orçamento Aprovado (ID ${b.id}) convertido em Ordem de Produção. Dados originais preservados no módulo Orçamentos.`,
    );
    return lines.join("\n");
  };

  const sendToProductionAsync = async (b: Budget, mappingSnapshot: Record<string, string>) => {
    try {
      if (b.status !== "approved") return;
      const existingOrderId = mappingSnapshot[b.id];
      if (existingOrderId) return;
      const t = computeTotalsFor(b);
      const payload: Partial<ProductionOrder> & {
        priority?: ProductionPriority;
        status?: ProductionStatus;
      } = {
        client_id: b.client_id?.trim() ? b.client_id : null,
        client_name: b.client_name?.trim() ? b.client_name : null,
        license_plate: b.vehicle_plate?.trim().toUpperCase() || null,
        vin: b.vehicle_vin?.trim().toUpperCase() || null,
        brand: b.vehicle_brand?.trim() || null,
        model: b.vehicle_model?.trim() || null,
        color: b.vehicle_color?.trim() || null,
        platform: `Orçamento ${b.number || "(sem número)"} · Total ${formatBRL(t.total)}`,
        insurer: (() => {
          const list = getBudgetInterventions(b);
          const joined = list.join(", ");
          return list.length > 0 ? (joined.length > 255 ? joined.slice(0, 254) : joined) : null;
        })(),
        notes: `\n${BUDGET_NOTES_DELIMITER}\n\n${buildNotesFromBudget(b)}`,
        status: "in_production",
        priority: "normal",
        due_at: b.issued_at ? new Date(b.issued_at).toISOString() : null,
      };
      const created = await createOrder.mutateAsync(payload);
      const nextMapping = { ...mappingSnapshot, [b.id]: created.id };
      persistMapping(nextMapping);
      toast.success(
        `Orçamento ${b.number || "(sem número)"} aprovado → Produção · OS ${created.code} criada.`,
      );
      onOpenOrder?.(created);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Falha ao enviar orçamento para Produção.",
      );
    }
  };

  const sendToProduction = async (b: Budget) => {
    try {
      if (b.status !== "approved") {
        toast.warning("Orçamento precisa estar Aprovado para enviar à Produção.");
        return;
      }
      const existing = (apiBudgets || []).find((x) => x.id === b.id);
      const revId =
        existing?.approvedRevisionId ||
        existing?.approved_revision_id ||
        existing?.currentRevisionId ||
        existing?.current_revision_id;

      if (!revId) {
        toast.error("Revisão aprovada não localizada.");
        return;
      }

      const res = await approveBudgetMutation.mutateAsync({
        budgetId: b.id,
        revisionId: revId,
      });

      if (res.productionOrder) {
        if (onOpenOrder) onOpenOrder(res.productionOrder);
      }
    } catch (err: any) {
      toast.error(err?.message || "Falha ao enviar orçamento para Produção.");
    }
  };

  const filteredItems = useMemo(() => {
    if (!filter || filter === "total") return items;
    if (filter === "draft") return items.filter((b) => b.status === "draft");
    if (filter === "approved") return items.filter((b) => b.status === "approved");
    if (filter === "rejected") return items.filter((b) => b.status === "rejected");
    return items;
  }, [items, filter]);

  return (
    <div className="space-y-4">
      <LocalBudgetsSyncBanner />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {totals.count > 0 ? (
            <StatBadge
              label="Total orçamentos"
              value={String(totals.count)}
              icon={FileText}
              active={filter === "total" || filter === null}
              onClick={() => setFilter(null)}
            />
          ) : null}
          {totals.drafts > 0 ? (
            <StatBadge
              label="Rascunhos"
              value={String(totals.drafts)}
              tone="bg-slate-500/10 text-slate-700 dark:text-slate-300"
              active={filter === "draft"}
              onClick={() => setFilter(filter === "draft" ? null : "draft")}
            />
          ) : null}
          {totals.approved > 0 ? (
            <StatBadge
              label="Aprovados"
              value={String(totals.approved)}
              tone="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              active={filter === "approved"}
              onClick={() => setFilter(filter === "approved" ? null : "approved")}
            />
          ) : null}
          {totals.rejected > 0 ? (
            <StatBadge
              label="Rejeitados"
              value={String(totals.rejected)}
              tone="bg-destructive/10 text-destructive"
              active={filter === "rejected"}
              onClick={() => setFilter(filter === "rejected" ? null : "rejected")}
            />
          ) : null}
        </div>
        <Button
          onClick={openNew}
          variant="default"
          size="icon"
          aria-label="Novo orçamento"
          className="h-10 w-10"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState onNew={openNew} />
      ) : (
        <Card className="border-border/50">
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[14%]">Nº Orçamento</TableHead>
                  <TableHead className="w-[9%]">Data</TableHead>
                  <TableHead className="w-[21%]">Cliente</TableHead>
                  <TableHead className="w-[21%]">Veículo</TableHead>
                  <TableHead className="w-[10%]">Status</TableHead>
                  <TableHead className="w-[11%] text-right">Total</TableHead>
                  <TableHead className="w-[14%] text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((b) => {
                  const alreadySent = !!mapping[b.id];
                  return (
                    <TableRow key={b.id}>
                      <TableCell
                        className="cursor-pointer font-medium tabular-nums"
                        onClick={() => openPreview(b)}
                      >
                        {b.number}
                      </TableCell>
                      <TableCell
                        className="cursor-pointer text-muted-foreground"
                        onClick={() => openPreview(b)}
                      >
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <Calendar className="h-3 w-3" />
                          {formatDate(b.issued_at)}
                        </span>
                      </TableCell>
                      <TableCell className="cursor-pointer min-w-0" onClick={() => openPreview(b)}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
                            <User className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">
                              {b.client_name || "—"}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {b.client_phone || b.client_email || "Sem contato"}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="cursor-pointer min-w-0" onClick={() => openPreview(b)}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
                            <Car className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">
                              {[b.vehicle_brand, b.vehicle_model].filter(Boolean).join(" ") || "—"}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {b.vehicle_plate
                                ? `${b.vehicle_plate}${b.vehicle_vin ? ` · VIN ${b.vehicle_vin.slice(0, 8)}…` : ""}`
                                : b.vehicle_vin
                                  ? `VIN ${b.vehicle_vin.slice(0, 14)}…`
                                  : "Sem veículo cadastrado"}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="cursor-pointer" onClick={() => openPreview(b)}>
                        <div className="flex items-center gap-1.5">
                          {(() => {
                            const vis = visualBudgetStatusLabelAndTone(b);
                            return (
                              <Badge className={vis.tone} variant="outline">
                                {vis.label}
                              </Badge>
                            );
                          })()}
                        </div>
                      </TableCell>
                      <TableCell
                        className="cursor-pointer text-right tabular-nums font-semibold"
                        onClick={() => openPreview(b)}
                      >
                        {formatBRL(computeTotalsFor(b).total)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button size="sm" variant="ghost" onClick={() => openPreview(b)}>
                            <FileText className="h-3.5 w-3.5 mr-1" />
                            {langDisplay === "fr" ? "Aperçu" : "Visualizar"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => downloadBudgetFile(b)}>
                            <FileDown className="h-3.5 w-3.5 mr-1" />
                            {langDisplay === "fr" ? "Télécharger" : "Baixar"}
                          </Button>
                          {b.status !== "rejected" ? (
                            <Button size="sm" variant="outline" onClick={() => openEdit(b)}>
                              {b.status === "approved" ? "Revisar" : "Editar"}
                            </Button>
                          ) : null}
                          {b.status === "approved" && !(b as any).productionOrder && !(b as any).production_order && !mapping[b.id] ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 text-indigo-700 border-indigo-500/40 hover:bg-indigo-500/10 dark:text-indigo-400"
                              onClick={() => sendToProduction(b)}
                              disabled={approveBudgetMutation.isPending}
                            >
                              <ArrowRightLeft className="h-3.5 w-3.5" />
                              Enviar p/ Produção
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            onClick={() => removeBudget(b.id)}
                          >
                            Apagar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <BudgetDialog
        open={open}
        initial={editing ?? emptyBudget()}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) setEditing(null);
        }}
        onSave={handleSave}
      />
    </div>
  );
}

function formatDate(iso?: string) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleDateString("pt-BR");
  } catch {
    return iso.slice(0, 10);
  }
}

function StatBadge({
  label,
  value,
  icon: Icon,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const clickable = typeof onClick === "function";
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-all ${
        clickable
          ? "cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-slate-400/30 active:scale-[0.98]"
          : ""
      } ${
        active
          ? "border-slate-900/70 ring-2 ring-offset-1 ring-slate-900/20 dark:border-slate-100/50 dark:ring-slate-100/15 shadow-sm"
          : "border-border/60"
      } ${tone || ""}`}
    >
      {Icon ? <Icon className="h-3.5 w-3.5 text-muted-foreground" /> : null}
      <div className="flex flex-col leading-tight">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="font-semibold text-foreground tabular-nums">{value}</span>
      </div>
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 p-8 text-center dark:border-slate-700 dark:bg-slate-900/40">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
        <Calculator className="h-8 w-8" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
        Orçamentos
      </h2>
      <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
        Nenhum orçamento cadastrado. Comece criando um orçamento técnico e envie para aprovação do
        cliente antes de enviar o veículo para <strong>Em Produção</strong>.
      </p>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Button
          onClick={onNew}
          variant="default"
          size="icon"
          aria-label="Novo orçamento"
          className="h-11 w-11"
        >
          <Plus className="h-5 w-5" />
        </Button>
      </div>
      <p className="mt-5 text-[11px] text-muted-foreground/80">
        Nesta primeira versão, orçamentos são armazenados localmente no navegador para fins de
        validação do fluxo. Posteriormente serão persistidos em tabela Budget do banco de dados.
      </p>
    </div>
  );
}
