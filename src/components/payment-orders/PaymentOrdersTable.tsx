import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatLicensePlate } from "@/lib/formatPlate";
import { useLanguage } from "@/hooks/useLanguage";

interface PaymentOrderRow {
  id: string;
  client_name?: string | null;
  platform: string | null;
  list_name: string | null;
  operational_unit?: string | null;
  technician_name?: string | null;
  car_name: string | null;
  license_plate: string | null;
  total: number | null;
  status: string;
  created_at: string;
}

const statusClassName: Record<string, string> = {
  pending: "bg-red-500/10 text-red-400 border-red-500/30",
  partial: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  paid: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
};

function statusLabel(status: string) {
  switch (status) {
    case "paid": return "Pago";
    case "partial": return "Parcial";
    case "pending": return "Pendente";
    default: return status || "—";
  }
}

/**
 * Temporary read-only compatibility surface for the legacy projection.
 * Commercial mutations now belong exclusively to the canonical PaymentList API.
 */
export function PaymentOrdersTable({ orders, isLoading }: { orders: PaymentOrderRow[]; isLoading: boolean }) {
  const { t, formatCurrency } = useLanguage();

  if (isLoading) {
    return <div className="space-y-2">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-10 w-full" />)}</div>;
  }

  if (!orders.length) {
    return (
      <div className="rounded-lg border border-border/50 bg-card p-8 text-center text-sm text-muted-foreground">
        {t("po.subtitle")}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/50 bg-card overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Lista</TableHead>
            <TableHead>Cliente</TableHead>
            <TableHead>Veículo</TableHead>
            <TableHead>Placa</TableHead>
            <TableHead>Técnico</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.id}>
              <TableCell>{order.list_name || "—"}</TableCell>
              <TableCell>{order.client_name || "—"}</TableCell>
              <TableCell>{order.car_name || "—"}</TableCell>
              <TableCell className="font-mono text-xs">{formatLicensePlate(order.license_plate) || "—"}</TableCell>
              <TableCell>{order.technician_name || "—"}</TableCell>
              <TableCell>
                <Badge variant="outline" className={statusClassName[order.status] ?? ""}>
                  {statusLabel(order.status)}
                </Badge>
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatCurrency(order.total ?? 0)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
