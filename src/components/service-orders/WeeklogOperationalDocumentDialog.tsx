import { useMemo, useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  FileText,
  Calendar as CalendarIcon,
  CheckCheck,
  Car,
  Building2,
  User,
  Hash as HashIcon,
  Wrench,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

export type ServiceOrderLike = {
  id: string;
  workspace_id?: string | null;
  week?: string | null;
  year_reference?: number | null;
  technician_name?: string | null;
  platform?: string | null;
  client_name?: string | null;
  car_name?: string | null;
  license_plate?: string | null;
  service_1_name?: string | null;
  service_1_price?: number | null;
  service_2_name?: string | null;
  service_2_price?: number | null;
  service_3_name?: string | null;
  service_3_price?: number | null;
  service_4_name?: string | null;
  service_4_price?: number | null;
  total?: number | null;
  production_vin?: string | null;
  production_insurer?: string | null;
  production_delivered_at?: string | null;
  production_code?: string | null;
  distribution_snapshot?: any;
  operational_document?: any;
};

type OperationalDocState = {
  week_display: string;
  week_number: number | null;
  year_reference: number | null;
  technician_name: string;
  platform: string;
  date: string;
  brand: string;
  model: string;
  license_plate: string;
  vin: string;
  insurer: string;
  services: { name: string; price: number | null }[];
  valor_final: number | null;
  retificativa: "none" | "partial" | "full";
  retificativa_text: string;
  retificativa_valor: number | null;
  validation: "oui" | "non" | null;
  responsavel_id: string;
  responsavel_nome: string;
  data_validacao: string;
  assinado: boolean;
  historico_validacoes: any[];
};

const INIT: OperationalDocState = {
  week_display: "",
  week_number: null,
  year_reference: null,
  technician_name: "",
  platform: "",
  date: "",
  brand: "",
  model: "",
  license_plate: "",
  vin: "",
  insurer: "",
  services: [],
  valor_final: null,
  retificativa: "none",
  retificativa_text: "",
  retificativa_valor: null,
  validation: null,
  responsavel_id: "",
  responsavel_nome: "",
  data_validacao: "",
  assinado: false,
  historico_validacoes: [],
};

function formatMoney(v: number | null | undefined) {
  if (v === null || v === undefined || isNaN(v as number)) return "";
  return Number(v).toLocaleString("pt-BR", {
    style: "currency",
    currency: "EUR",
  });
}

function toDateInputStr(d: Date) {
  return format(d, "yyyy-MM-dd");
}

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  order: ServiceOrderLike | null;
  currentUserId?: string | null;
  currentUserName?: string | null;
  onSaved?: (latest: ServiceOrderLike) => void;
};

export function WeeklogOperationalDocumentDialog({
  open,
  onOpenChange,
  order,
  currentUserId,
  currentUserName,
  onSaved,
}: Props) {
  const [state, setState] = useState<OperationalDocState>(INIT);
  const [saving, setSaving] = useState(false);

  // Parse inicial (monta o estado a partir do service order + operational_document salvo)
  useEffect(() => {
    if (!order || !open) {
      setState(INIT);
      return;
    }
    const op =
      (order.operational_document && typeof order.operational_document === "object"
        ? order.operational_document
        : null) ||
      (order.distribution_snapshot && typeof order.distribution_snapshot === "object"
        ? (order.distribution_snapshot as any)?.operational_document || null
        : null) ||
      {};
    const base = op.base ? op.base : {};
    const valid = op.validation ? op.validation : {};
    const rect = op.retificativa ? op.retificativa : {};

    // Montar lista de serviços (somente os cadastrados)
    const services: { name: string; price: number | null }[] = [];
    [
      [order.service_1_name, order.service_1_price],
      [order.service_2_name, order.service_2_price],
      [order.service_3_name, order.service_3_price],
      [order.service_4_name, order.service_4_price],
    ].forEach(([n, p]) => {
      if (n && String(n).trim()) {
        services.push({
          name: String(n),
          price: typeof p === "number" && isFinite(p) ? p : null,
        });
      }
    });

    const valor_automatico =
      typeof order.total === "number" && isFinite(order.total) ? order.total : null;

    // Extrair marca/modelo do car_name (se não tiver separado em base.brand/base.model)
    const carParts = String(order.car_name || "").split(/\s+/).filter(Boolean);
    const brand =
      String(base.brand || (order.car_name ? carParts[0] || "" : "")).trim();
    const model =
      String(
        base.model || (order.car_name ? carParts.slice(1).join(" ") || "" : ""),
      ).trim();

    const today = toDateInputStr(new Date());
    // Data do documento: data de entrega > hoje
    const deliveredDate: string = order.production_delivered_at
      ? String(order.production_delivered_at).slice(0, 10)
      : today;

    // Parse week_number
    let week_number: number | null = null;
    const m = /(\d+)/.exec(String(order.week || base.week_display || base.week_number || ""));
    if (m) week_number = parseInt(m[1], 10);

    const responsavel_id = valid.responsavel_id ?? currentUserId ?? "";
    const responsavel_nome =
      valid.responsavel_nome ??
      currentUserName ??
      "";

    const valor_final =
      typeof valid.valor_final === "number"
        ? valid.valor_final
        : valor_automatico;

    setState({
      week_display: String(base.week_display || order.week || ""),
      week_number: week_number,
      year_reference: order.year_reference ?? base.year_reference ?? null,
      technician_name: String(order.technician_name ?? ""),
      platform: String(order.platform ?? base.platform ?? ""),
      date: valid.date ? String(valid.date).slice(0, 10) : deliveredDate,
      brand,
      model,
      license_plate: String(order.license_plate ?? ""),
      vin: String(order.production_vin ?? base.vin ?? ""),
      insurer: String(order.production_insurer ?? base.insurer ?? ""),
      services,
      valor_final,
      retificativa: rect.type ?? "none",
      retificativa_text: rect.text ?? "",
      retificativa_valor:
        typeof rect.value === "number" ? rect.value : null,
      validation: valid.validation ?? null,
      responsavel_id,
      responsavel_nome,
      data_validacao: valid.data_validacao ? String(valid.data_validacao).slice(0, 10) : "",
      assinado: !!valid.assinado,
      historico_validacoes: Array.isArray(valid.historico) ? valid.historico : [],
    });
  }, [order, open, currentUserId, currentUserName]);

  const total_servicos = useMemo(
    () =>
      state.services.reduce(
        (a, s) => a + (typeof s.price === "number" && isFinite(s.price) ? s.price : 0),
        0,
      ),
    [state.services],
  );

  const canSave = useMemo(() => {
    return true; // Nunca bloquear para salvar rascunho
  }, []);

  async function handleSave(registrar_validacao: boolean) {
    if (!order) return;
    try {
      setSaving(true);

      // Montar chave operational_document a salvar (dist_snapshot.operational_document)
      // Se registrar_validacao=true → confirmar que tem nome responsável, data_validacao e valor_final
      let validationPayload = {
        ...(order.operational_document?.validation ||
          order.distribution_snapshot?.operational_document?.validation ||
          {}),
        date: state.date || null,
        valor_final:
          typeof state.valor_final === "number" && isFinite(state.valor_final)
            ? state.valor_final
            : null,
      } as any;

      if (registrar_validacao) {
        if (!state.responsavel_nome.trim()) {
          toast.error("Informe o nome do responsável antes de validar.");
          setSaving(false);
          return;
        }
        if (!state.validation) {
          toast.error("Selecione VALIDAÇÃO SIM ou NÃO.");
          setSaving(false);
          return;
        }
        if (!state.data_validacao) {
          toast.error("Informe a data de validação.");
          setSaving(false);
          return;
        }
        if (!state.assinado) {
          toast.error("Confirme a assinatura antes de validar.");
          setSaving(false);
          return;
        }
        validationPayload = {
          ...validationPayload,
          situation: state.validation,           // chave situation explícita (oui/non)
          validation_sit: state.validation,      // chave compatibilidade anterior
          validation: state.validation,          // mantida para UI reabrir
          responsavel_id: state.responsavel_id || currentUserId || null,
          responsavel_nome: state.responsavel_nome.trim(),
          data_validacao: state.data_validacao,
          assinado: true,
          // Registra carimbo no histórico
          historico: [
            ...state.historico_validacoes,
            {
              at: new Date().toISOString(),
              responsavel_id: state.responsavel_id || currentUserId || null,
              responsavel_nome: state.responsavel_nome.trim(),
              data_validacao: state.data_validacao,
              validation: state.validation,
              assinado: true,
              valor_final:
                typeof state.valor_final === "number" && isFinite(state.valor_final)
                  ? state.valor_final
                  : null,
              retificativa: state.retificativa,
              retificativa_valor: state.retificativa_valor ?? null,
              observacao: state.retificativa_text.trim() || null,
            },
          ],
        };
      }
      toast.error(
        "A alteração via Documento Operacional legado foi descontinuada (T08). O fluxo canônico de validação e retificação será disponibilizado no T10.",
        { duration: 8000 }
      );
      return;
    } finally {
      setSaving(false);
    }
  }

  if (!order) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[1200px] w-[96vw] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300">
            <FileText className="h-5 w-5" />
            Documento Operacional · WEEKLOG
            {state.week_display ? (
              <span className="ml-auto text-sm font-normal text-muted-foreground">
                {state.week_display}
                {state.year_reference ? ` · ${state.year_reference}` : ""}
              </span>
            ) : null}
          </DialogTitle>
          <DialogDescription className="text-[11px] text-muted-foreground">
            Dados preenchidos automaticamente da Produção / Orçamento / WEEKLOG.
            Ajuste valor, data, responsável, validação e retificativa antes de confirmar.
          </DialogDescription>
        </DialogHeader>

        {/* ====== CABEÇALHO (modelo folha) ====== */}
        <section className="grid grid-cols-12 gap-3 p-3 rounded-lg border bg-slate-50 dark:bg-slate-900/40 text-xs">
          <div className="col-span-4 md:col-span-2 space-y-1">
            <Label className="text-[10px] uppercase tracking-wide">Semana</Label>
            <div className="flex items-center gap-2">
              <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={state.week_display}
                onChange={(e) =>
                  setState((p) => ({ ...p, week_display: e.target.value }))
                }
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div className="col-span-4 md:col-span-2 space-y-1">
            <Label className="text-[10px] uppercase tracking-wide">Ano</Label>
            <Input
              type="number"
              value={state.year_reference ?? ""}
              onChange={(e) =>
                setState((p) => ({
                  ...p,
                  year_reference: e.target.value
                    ? parseInt(e.target.value, 10)
                    : null,
                }))
              }
              className="h-8 text-sm"
            />
          </div>
          <div className="col-span-12 md:col-span-4 space-y-1">
            <Label className="text-[10px] uppercase tracking-wide">
              Técnico / Equipe
            </Label>
            <div className="flex items-center gap-2">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={state.technician_name}
                onChange={(e) =>
                  setState((p) => ({ ...p, technician_name: e.target.value }))
                }
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div className="col-span-12 md:col-span-4 space-y-1">
            <Label className="text-[10px] uppercase tracking-wide">
              Oficina / Site
            </Label>
            <div className="flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={state.platform}
                onChange={(e) =>
                  setState((p) => ({ ...p, platform: e.target.value }))
                }
                className="h-8 text-sm"
              />
            </div>
          </div>

          {/* Data interativa com calendário */}
          <div className="col-span-12 md:col-span-3 space-y-1">
            <Label className="text-[10px] uppercase tracking-wide">
              Data do documento
            </Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-8 justify-start text-left text-sm font-normal flex gap-2"
                >
                  <CalendarIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  <span>
                    {state.date
                      ? format(new Date(state.date + "T00:00:00"), "dd/MM/yyyy", {
                          locale: ptBR,
                        })
                      : "Selecionar data…"}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={state.date ? new Date(state.date + "T00:00:00") : undefined}
                  onSelect={(d) =>
                    setState((p) => ({
                      ...p,
                      date: d ? toDateInputStr(d) : "",
                    }))
                  }
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="col-span-12 md:col-span-3 space-y-1">
            <Label className="text-[10px] uppercase tracking-wide">
              Marca / Modelo
            </Label>
            <div className="flex items-center gap-2">
              <Car className="h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={[state.brand, state.model].filter(Boolean).join(" ")}
                onChange={(e) => {
                  const [b, ...m] = e.target.value.split(/\s+/);
                  setState((p) => ({
                    ...p,
                    brand: b ?? "",
                    model: m.join(" "),
                  }));
                }}
                className="h-8 text-sm"
              />
            </div>
          </div>
          <div className="col-span-12 md:col-span-3 space-y-1">
            <Label className="text-[10px] uppercase tracking-wide">
              Matrícula / Placa
            </Label>
            <Input
              value={state.license_plate}
              onChange={(e) =>
                setState((p) => ({ ...p, license_plate: e.target.value }))
              }
              className="h-8 text-sm tracking-widest uppercase"
            />
          </div>
          <div className="col-span-12 md:col-span-3 space-y-1">
            <Label className="text-[10px] uppercase tracking-wide">
              Nº Chassi / VIN
            </Label>
            <div className="flex items-center gap-2">
              <HashIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={state.vin}
                onChange={(e) => setState((p) => ({ ...p, vin: e.target.value }))}
                className="h-8 text-sm font-mono tracking-wide uppercase"
              />
            </div>
          </div>
          {state.insurer ? (
            <div className="col-span-12 md:col-span-3 space-y-1">
              <Label className="text-[10px] uppercase tracking-wide">
                Seguradora / Insurance
              </Label>
              <Input
                value={state.insurer}
                onChange={(e) =>
                  setState((p) => ({ ...p, insurer: e.target.value }))
                }
                className="h-8 text-sm"
              />
            </div>
          ) : null}
          <div className="col-span-12 md:col-span-3 space-y-1">
            <Label className="text-[10px] uppercase tracking-wide">Cliente</Label>
            <Input value={order.client_name ?? ""} disabled className="h-8 text-sm bg-muted/40" />
          </div>
        </section>

        {/* ====== TABELA SERVIÇOS / VALORES ====== */}
        <section className="mt-4 rounded-lg border overflow-hidden text-xs">
          <div className="grid grid-cols-12 bg-slate-800 text-slate-50 font-semibold uppercase tracking-wider text-[10px]">
            <div className="col-span-7 p-2">Serviços realizados</div>
            <div className="col-span-2 p-2 text-right">DSP</div>
            <div className="col-span-2 p-2 text-right">Montagem</div>
            <div className="col-span-1 p-2 text-right">Total</div>
          </div>
          <div className="divide-y">
            {state.services.length === 0 && (
              <div className="p-4 text-center text-muted-foreground italic text-xs">
                Nenhum serviço importado automaticamente.
              </div>
            )}
            {state.services.map((s, idx) => (
              <div
                key={idx}
                className="grid grid-cols-12 items-center p-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <div className="col-span-7 px-1 truncate flex items-center gap-1.5">
                  <Wrench className="h-3 w-3 text-indigo-500 shrink-0" />
                  <span className="truncate">{s.name}</span>
                </div>
                <div className="col-span-2 text-right px-2 text-muted-foreground italic">
                  —
                </div>
                <div className="col-span-2 text-right px-2 tabular-nums">
                  {typeof s.price === "number" ? formatMoney(s.price) : "—"}
                </div>
                <div className="col-span-1 text-right px-2 tabular-nums text-slate-600 dark:text-slate-300 font-medium">
                  {typeof s.price === "number" ? formatMoney(s.price) : "—"}
                </div>
              </div>
            ))}
            {/* Retificativa (dinâmica) */}
            {(state.retificativa === "partial" || state.retificativa === "full") && (
              <div className="grid grid-cols-12 items-center p-1.5 bg-orange-50 dark:bg-orange-500/5">
                <div className="col-span-7 px-1 truncate flex items-center gap-1.5 text-orange-700 dark:text-orange-300">
                  <ShieldCheck className="h-3 w-3 shrink-0" />
                  Retificativa{" "}
                  <span className="font-semibold">
                    {state.retificativa.toUpperCase()}
                  </span>
                  {state.retificativa_text ? (
                    <span className="text-muted-foreground italic ml-1 truncate">
                      — {state.retificativa_text}
                    </span>
                  ) : null}
                </div>
                <div className="col-span-4 text-right px-2 text-orange-700 dark:text-orange-300 tabular-nums font-semibold">
                  {typeof state.retificativa_valor === "number"
                    ? formatMoney(state.retificativa_valor)
                    : "Ajustar"}
                </div>
                <div className="col-span-1 text-right px-2 text-orange-700 dark:text-orange-300 tabular-nums font-semibold">
                  {typeof state.retificativa_valor === "number"
                    ? formatMoney(state.retificativa_valor)
                    : "—"}
                </div>
              </div>
            )}
          </div>

          {/* Sub-total serviços + TOTAL EDITÁVEL (valor final) */}
          <div className="grid grid-cols-12 bg-slate-50 dark:bg-slate-900/40 text-xs border-t">
            <div className="col-span-8 md:col-span-9 p-2 font-semibold text-right uppercase tracking-wider text-[10px] text-slate-500">
              Sub-total serviços
            </div>
            <div className="col-span-4 md:col-span-3 p-2 text-right tabular-nums">
              {formatMoney(total_servicos || null)}
            </div>
          </div>
          <div className="grid grid-cols-12 p-2 gap-2 items-end bg-emerald-50 dark:bg-emerald-500/5 border-t">
            <div className="col-span-12 md:col-span-5">
              <Label className="text-[10px] uppercase tracking-wide text-emerald-700 dark:text-emerald-300 font-semibold">
                Valor FINAL (editável antes da validação)
              </Label>
              <Input
                type="number"
                step="0.01"
                value={
                  typeof state.valor_final === "number" && isFinite(state.valor_final)
                    ? state.valor_final
                    : ""
                }
                onChange={(e) =>
                  setState((p) => ({
                    ...p,
                    valor_final: e.target.value
                      ? Number(parseFloat(e.target.value))
                      : null,
                  }))
                }
                className="h-9 text-base font-semibold tabular-nums"
                placeholder="0.00"
              />
            </div>
            <div className="col-span-12 md:col-span-4">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Retificativa (tipo)
              </Label>
              <RadioGroup
                value={state.retificativa}
                onValueChange={(v) =>
                  setState((p) => ({
                    ...p,
                    retificativa: v as "none" | "partial" | "full",
                  }))
                }
                className="flex flex-row flex-wrap gap-x-3 gap-y-1 pt-1"
              >
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="none" id="rect-none" />
                  <Label htmlFor="rect-none" className="text-xs normal-case">
                    Nenhuma
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="partial" id="rect-partial" />
                  <Label htmlFor="rect-partial" className="text-xs normal-case">
                    Parcial
                  </Label>
                </div>
                <div className="flex items-center gap-1.5">
                  <RadioGroupItem value="full" id="rect-full" />
                  <Label htmlFor="rect-full" className="text-xs normal-case">
                    Completa
                  </Label>
                </div>
              </RadioGroup>
            </div>
            <div className="col-span-6 md:col-span-3">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Valor retificativa
              </Label>
              <Input
                type="number"
                step="0.01"
                disabled={state.retificativa === "none"}
                value={
                  typeof state.retificativa_valor === "number" &&
                  isFinite(state.retificativa_valor)
                    ? state.retificativa_valor
                    : ""
                }
                onChange={(e) =>
                  setState((p) => ({
                    ...p,
                    retificativa_valor: e.target.value
                      ? Number(parseFloat(e.target.value))
                      : null,
                  }))
                }
                className="h-9 tabular-nums"
              />
            </div>
            <div className="col-span-6 md:col-span-12 md:col-span-12">
              <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Observação retificativa
              </Label>
              <Input
                disabled={state.retificativa === "none"}
                value={state.retificativa_text}
                onChange={(e) =>
                  setState((p) => ({ ...p, retificativa_text: e.target.value }))
                }
                placeholder="Ex: ajuste de mão-de-obra adicional / peça sobressalente"
                className="h-9 text-sm"
              />
            </div>
          </div>
        </section>

        {/* ====== VALIDAÇÃO ====== */}
        <section className="mt-4 grid grid-cols-12 gap-3 rounded-lg border p-3 text-xs">
          <div className="col-span-12 md:col-span-3 space-y-1">
            <Label className="text-[10px] uppercase tracking-wide">Validação</Label>
            <RadioGroup
              value={state.validation ?? ""}
              onValueChange={(v) =>
                setState((p) => ({
                  ...p,
                  validation: ((v || "").toString().toLowerCase() as "oui" | "non") || null,
                }))
              }
              className="flex gap-4 pt-1"
            >
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="oui" id="v-oui" className="border-emerald-500 text-emerald-600" />
                <Label htmlFor="v-oui" className="text-sm normal-case font-semibold text-emerald-700 dark:text-emerald-300">
                  OUI · SIM
                </Label>
              </div>
              <div className="flex items-center gap-1.5">
                <RadioGroupItem value="non" id="v-non" className="border-rose-500 text-rose-600" />
                <Label htmlFor="v-non" className="text-sm normal-case font-semibold text-rose-700 dark:text-rose-300">
                  NON · NÃO
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="col-span-12 md:col-span-3 space-y-1">
            <Label className="text-[10px] uppercase tracking-wide">Responsável (Nome)</Label>
            <Input
              value={state.responsavel_nome}
              onChange={(e) =>
                setState((p) => ({ ...p, responsavel_nome: e.target.value }))
              }
              placeholder="Nome do responsável pela validação"
              className="h-9 text-sm"
            />
          </div>

          <div className="col-span-12 md:col-span-3 space-y-1">
            <Label className="text-[10px] uppercase tracking-wide">Data validação</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-9 w-full justify-start text-left text-sm font-normal flex gap-2"
                >
                  <CalendarIcon className="h-3.5 w-3.5 shrink-0 opacity-70" />
                  <span>
                    {state.data_validacao
                      ? format(new Date(state.data_validacao + "T00:00:00"), "dd/MM/yyyy", {
                          locale: ptBR,
                        })
                      : "Selecionar data…"}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={
                    state.data_validacao
                      ? new Date(state.data_validacao + "T00:00:00")
                      : undefined
                  }
                  onSelect={(d) =>
                    setState((p) => ({
                      ...p,
                      data_validacao: d ? toDateInputStr(d) : "",
                    }))
                  }
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="col-span-12 md:col-span-3 flex items-end">
            <label className="flex items-start gap-2 rounded-md border p-2.5 h-full w-full cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40">
              <Checkbox
                checked={state.assinado}
                onCheckedChange={(c) =>
                  setState((p) => ({ ...p, assinado: !!c }))
                }
                className="mt-0.5"
              />
              <span className="text-[11px] leading-tight">
                <span className="font-semibold">Assinado / Confirmado</span>
                <span className="block text-muted-foreground mt-0.5">
                  Check simples de confirmação eletrônica.
                </span>
              </span>
              <CheckCheck className="ml-auto h-5 w-5 text-emerald-500 opacity-70 shrink-0" />
            </label>
          </div>

          {state.historico_validacoes?.length > 0 ? (
            <div className="col-span-12">
              <Label className="text-[10px] uppercase tracking-wide text-slate-500">
                Histórico de validações ({state.historico_validacoes.length})
              </Label>
              <ul className="mt-1 space-y-0.5 text-[10.5px] text-muted-foreground pl-2 border-l-2 border-slate-200 dark:border-slate-700">
                {state.historico_validacoes.map((h: any, i) => (
                  <li key={i} className="pl-2">
                    [{h.at ? h.at.slice(0, 16).replace("T", " ") : "—"}]{" "}
                    <b>{h.responsavel_nome ?? "—"}</b> validou{" "}
                    <code
                      className={`rounded px-1 ${
                        h.validation === "oui"
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "bg-rose-500/10 text-rose-700 dark:text-rose-300"
                      }`}
                    >
                      {h.validation}
                    </code>{" "}
                    em {h.data_validacao} · valor final {formatMoney(h.valor_final)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <DialogFooter className="mt-4 flex items-center justify-between">
          <span className="text-xs text-muted-foreground italic">
            Visualização somente leitura · Validação e retificação canônica disponíveis no T10
          </span>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
