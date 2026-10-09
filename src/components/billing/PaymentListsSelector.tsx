import { useMemo, useState } from "react";
import { Plus, ChevronDown, X, ListChecks, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiRequest } from "@/lib/api";

export type BillingPaymentList = {
  id: string;
  list_name: string;
  technician_name: string;
  assigned_user_id: string | null;
  client_name: string | null;
  city: string | null;
  year: number;
  week: number;
  total: number;
  po_count: number;
  payment_order_ids: string[];
  user_ids: string[];
};

interface Props {
  /** Selected list ids (Phase 1: strict 1:1, array length <= 1). */
  value: string[];
  onChange: (ids: string[], lists: any[]) => void;
  label?: string;
}

const fmtMoney = (n: number, currency = "EUR") =>
  new Intl.NumberFormat("pt-PT", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);

/**
 * PaymentList selector — Phase 1 strict 1:1 cardinality (PaymentList 1 <-> 1 active Invoice).
 * Source of truth: canonical /api/payment-lists.
 */
export function PaymentListsSelector({ value, onChange, label = "Lista vinculada (1:1)" }: Props) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);

  const { data: rawLists = [], isLoading } = useQuery({
    queryKey: ["canonical-payment-lists-for-invoicing"],
    queryFn: async () => {
      const data = await apiRequest<any[]>("/payment-lists");
      return Array.isArray(data) ? data : [];
    },
  });

  // Map to unified shape for consumer compatibility
  const lists = useMemo(() => {
    return rawLists.map((l: any) => {
      const recognized = Number(l.recognizedTotal ?? l.sourceDocumentTotal ?? 0);
      return {
        id: l.id,
        listNumber: l.listNumber,
        list_name: l.listNumber,
        clientId: l.clientId,
        clientName: l.clientName,
        client_name: l.clientName,
        currencyCode: l.currencyCode || "EUR",
        status: l.status,
        sourceType: l.sourceType,
        invoiceId: l.invoiceId,
        total: recognized,
        technician_name: l.clientName || "—",
        assigned_user_id: null,
        city: null,
        year: l.issueDate ? new Date(l.issueDate).getFullYear() : new Date().getFullYear(),
        week: 0,
        po_count: l.itemCount ?? 0,
        payment_order_ids: [],
        user_ids: [],
      };
    });
  }, [rawLists]);

  const byId = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists]);

  const selectedList = useMemo(() => {
    const firstId = value[0];
    if (!firstId) return null;
    return byId.get(firstId) || lists.find((l) => l.listNumber === firstId) || null;
  }, [value, byId, lists]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lists.filter((l) => {
      // Eligible for billing in Phase 1: ready_for_billing, confronted, or already linked to current selection
      const isEligible =
        l.status === "ready_for_billing" ||
        l.status === "confronted" ||
        (selectedList && selectedList.id === l.id);

      if (!isEligible) return false;

      if (q) {
        const hay = [l.listNumber, l.clientName ?? "", l.status ?? ""].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [lists, search, selectedList]);

  // Phase 1 enforces strict 1:1: selecting replaces, clicking same unselects
  const handleSelect = (l: any) => {
    if (selectedList?.id === l.id) {
      onChange([], []);
    } else {
      onChange([l.id], [l]);
    }
    setOpen(false);
  };

  const handleClear = () => {
    onChange([], []);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium flex items-center gap-1.5">
          <ListChecks className="h-3.5 w-3.5 text-primary" /> {label}
        </span>
        <Badge variant={selectedList ? "default" : "secondary"} className="text-[10px]">
          {selectedList ? "1 lista vinculada (1:1)" : "Nenhuma lista"}
        </Badge>
      </div>

      {selectedList && (
        <div className="flex items-center gap-2 p-2 rounded-md border border-primary/30 bg-primary/5 text-xs">
          <span className="font-mono font-semibold text-primary">{selectedList.listNumber}</span>
          <span className="text-muted-foreground">·</span>
          <span className="font-medium">{selectedList.clientName}</span>
          <span className="text-muted-foreground">·</span>
          <Badge variant="outline" className="text-[10px] capitalize">
            {selectedList.status}
          </Badge>
          <span className="ml-auto font-mono font-medium text-foreground">
            {fmtMoney(selectedList.total, selectedList.currencyCode)}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={handleClear}
            title="Desvincular lista"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" type="button">
            <Plus className="h-3.5 w-3.5" />
            {selectedList ? "Substituir lista vinculada" : "Vincular PaymentList (1:1)"}
            <ChevronDown className="h-3.5 w-3.5 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-[480px] p-2 flex flex-col"
          align="start"
          sideOffset={6}
          collisionPadding={16}
        >
          <div className="space-y-1.5 mb-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por número da lista (L000001) ou cliente..."
                className="h-7 text-xs pl-8"
              />
            </div>
            <p className="text-[10px] text-muted-foreground px-1">
              Fase 1: Cardinalidade estrita 1:1. Apenas listas prontas para faturamento (<span className="font-mono">ready_for_billing</span> / <span className="font-mono">confronted</span>).
            </p>
          </div>

          <div
            className="overflow-y-auto overscroll-contain space-y-1 pr-1"
            style={{ maxHeight: 280, minHeight: 80 }}
          >
            {isLoading && (
              <p className="text-[10px] text-muted-foreground text-center py-4">A carregar listas canónicas…</p>
            )}
            {!isLoading && filtered.length === 0 && (
              <p className="text-[10px] text-muted-foreground text-center py-4">
                Nenhuma PaymentList elegível encontrada
              </p>
            )}
            {filtered.map((l) => {
              const isSelected = selectedList?.id === l.id;
              return (
                <div
                  key={l.id}
                  onClick={() => handleSelect(l)}
                  className={`flex items-center justify-between rounded-md p-2 cursor-pointer transition-colors text-xs border ${
                    isSelected
                      ? "border-primary bg-primary/10 text-primary-foreground"
                      : "border-border/40 hover:bg-muted/50"
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="font-mono font-semibold text-primary">{l.listNumber}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="truncate">{l.clientName}</span>
                    </div>
                    <div className="text-muted-foreground text-[10px] flex items-center gap-1.5 mt-0.5">
                      <span>Status: {l.status}</span>
                      {l.sourceType && <span>· Origem: {l.sourceType}</span>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono font-medium">{fmtMoney(l.total, l.currencyCode)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
