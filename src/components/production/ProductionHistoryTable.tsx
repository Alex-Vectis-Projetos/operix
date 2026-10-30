import React, { useMemo, useState } from "react";
import {
  useProductionOrders,
  type ProductionOrder,
} from "@/hooks/useProductionOrders";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Archive,
  Search,
  Car,
  Calendar,
  User,
  Clock,
  ExternalLink,
  CheckCircle2,
  Filter,
} from "lucide-react";
import { formatFinanceMoney } from "@/lib/financeFormatters";

interface ProductionHistoryTableProps {
  onOpenOrder: (order: ProductionOrder) => void;
}

export function ProductionHistoryTable({ onOpenOrder }: ProductionHistoryTableProps) {
  const { data: orders = [], isLoading } = useProductionOrders();
  const [searchQuery, setSearchQuery] = useState("");
  const [showAllFinished, setShowAllFinished] = useState(false);

  // Filtra ordens concluídas
  const finishedOrders = useMemo(() => {
    return orders.filter((o) => {
      const isFinished =
        o.status === "delivered" ||
        o.status === "finished" ||
        (o as any).currentStage === "finished" ||
        (o as any).current_stage === "finished";
      return isFinished;
    });
  }, [orders]);

  // Aplica regra PRD-02: > 7 dias por padrão, ou todos se toggle ativo
  const filteredOrders = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const now = Date.now();
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

    return finishedOrders.filter((o) => {
      const finishedDate =
        o.finished_at ||
        (o as any).finishedAt ||
        o.delivered_at ||
        o.updated_at;
      const ageMs = finishedDate ? now - new Date(finishedDate).getTime() : 0;
      const isOlderThan7Days = ageMs > SEVEN_DAYS_MS;

      if (!showAllFinished && !isOlderThan7Days) {
        return false;
      }

      if (!q) return true;

      const code = (o.code || "").toLowerCase();
      const client = (o.client_name || (o as any).clientName || "").toLowerCase();
      const plate = (o.license_plate || (o as any).licensePlate || o.vin || "").toLowerCase();
      const brand = (o.brand || "").toLowerCase();
      const model = (o.model || "").toLowerCase();

      return (
        code.includes(q) ||
        client.includes(q) ||
        plate.includes(q) ||
        brand.includes(q) ||
        model.includes(q)
      );
    });
  }, [finishedOrders, searchQuery, showAllFinished]);

  return (
    <div className="space-y-4">
      {/* Barra de Controles e Filtros */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 rounded-lg border bg-card">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por código OS, matrícula, cliente ou veículo..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="showAll"
              checked={showAllFinished}
              onCheckedChange={(checked) => setShowAllFinished(Boolean(checked))}
            />
            <Label
              htmlFor="showAll"
              className="text-xs text-muted-foreground cursor-pointer select-none"
            >
              Exibir também finalizados recentes (&le; 7 dias)
            </Label>
          </div>

          <Badge variant="secondary" className="text-xs px-2.5 py-0.5 gap-1.5 h-8">
            <Archive className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{filteredOrders.length} {filteredOrders.length === 1 ? "registro" : "registros"}</span>
          </Badge>
        </div>
      </div>

      {/* Tabela de Ordens Arquivadas */}
      <div className="rounded-xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b bg-muted/40 text-muted-foreground font-medium">
                <th className="p-3">Código OS</th>
                <th className="p-3">Cliente / Proprietário</th>
                <th className="p-3">Veículo / Matrícula</th>
                <th className="p-3">Data de Conclusão</th>
                <th className="p-3">Técnico / Responsável</th>
                <th className="p-3">Valor Total</th>
                <th className="p-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    Carregando histórico de produção...
                  </td>
                </tr>
              ) : filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center space-y-1">
                    <Archive className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
                    <div className="font-semibold text-foreground">Nenhuma ordem arquivada encontrada</div>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                      {showAllFinished
                        ? "Nenhuma ordem finalizada no histórico."
                        : "Ordens concluídas há até 7 dias permanecem visíveis na coluna 'Finalizado' do Kanban ativo."}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => {
                  const finishedDate =
                    order.finished_at ||
                    (order as any).finishedAt ||
                    order.delivered_at ||
                    order.updated_at;
                  const formattedDate = finishedDate
                    ? new Date(finishedDate).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "—";

                  const vehicle = [order.brand, order.model].filter(Boolean).join(" ") || "Veículo";
                  const plate = order.license_plate || (order as any).licensePlate || order.vin || "—";
                  const client = order.client_name || (order as any).clientName || "Cliente";
                  const tech = order.technician_name || (order as any).technicianName || "—";
                  const amount = (order as any).total ?? (order as any).total_amount ?? (order as any).recognized_total ?? 0;
                  const currency = order.currency_code || (order as any).currency || "EUR";

                  return (
                    <tr key={order.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3 font-semibold text-foreground">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                          <span>{order.code}</span>
                        </div>
                      </td>
                      <td className="p-3 text-foreground font-medium max-w-[200px] truncate" title={client}>
                        {client}
                      </td>
                      <td className="p-3">
                        <div className="font-medium text-foreground">{vehicle}</div>
                        <div className="text-[11px] text-muted-foreground font-mono">{plate}</div>
                      </td>
                      <td className="p-3 text-muted-foreground whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Clock className="h-3 w-3" />
                          <span>{formattedDate}</span>
                        </div>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <User className="h-3 w-3" />
                          <span className="truncate max-w-[140px]">{tech}</span>
                        </div>
                      </td>
                      <td className="p-3 font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                        {formatFinanceMoney(amount, currency)}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs gap-1.5"
                          onClick={() => onOpenOrder(order)}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Ver OS
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
