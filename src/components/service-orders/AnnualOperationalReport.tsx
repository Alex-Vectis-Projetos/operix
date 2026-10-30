import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  FileText,
  Printer,
  Download,
  Calendar,
  Building2,
  Car,
  Euro,
  CheckCircle2,
  Clock,
  ArrowLeft,
  HardHat,
} from "lucide-react";
import type { Weeklog } from "@/lib/apiWeeklogs";
import { formatFinanceMoney } from "@/lib/financeFormatters";

interface AnnualOperationalReportProps {
  year: string;
  weeklogs: Weeklog[];
  orders?: Array<{
    id: string;
    car_name?: string | null;
    license_plate?: string | null;
    total?: number | null;
    client_name?: string | null;
    technician_name?: string | null;
    created_at?: string;
  }>;
  onBack?: () => void;
}

export function AnnualOperationalReport({
  year,
  weeklogs,
  orders = [],
  onBack,
}: AnnualOperationalReportProps) {
  // Filter weeklogs for the selected operational year
  const yearWeeklogs = useMemo(() => {
    return weeklogs.filter((wl) => {
      if (wl.yearReference) return String(wl.yearReference) === year;
      if (wl.startsOn) return wl.startsOn.startsWith(year);
      if (wl.week && wl.week.includes(year)) return true;
      return false;
    });
  }, [weeklogs, year]);

  // Consolidate KPIs
  const stats = useMemo(() => {
    let totalVehicles = 0;
    let totalFinancial = 0;
    let validatedBatches = 0;

    for (const wl of yearWeeklogs) {
      const vCount = wl.entries?.length || 1;
      totalVehicles += vCount;
      if (wl.status === "validated") validatedBatches++;

      if (Array.isArray(wl.entries)) {
        for (const e of wl.entries) {
          totalFinancial += Number(e.totalAmount) || 0;
        }
      }
    }

    return {
      totalBatches: yearWeeklogs.length,
      validatedBatches,
      totalVehicles: Math.max(totalVehicles, yearWeeklogs.length),
      totalFinancial,
    };
  }, [yearWeeklogs]);

  // Group by Commercial Partner / Client
  const clientBreakdown = useMemo(() => {
    const map = new Map<
      string,
      { clientName: string; batches: number; vehicles: number; totalAmount: number; validated: number }
    >();

    for (const wl of yearWeeklogs) {
      const name = wl.clientName || wl.clientId || "Cliente Não Definido";
      const current = map.get(name) || {
        clientName: name,
        batches: 0,
        vehicles: 0,
        totalAmount: 0,
        validated: 0,
      };

      current.batches += 1;
      const vCount = wl.entries?.length || 1;
      current.vehicles += vCount;
      if (wl.status === "validated") current.validated += 1;

      if (Array.isArray(wl.entries)) {
        for (const e of wl.entries) {
          current.totalAmount += Number(e.totalAmount) || 0;
        }
      }

      map.set(name, current);
    }

    return Array.from(map.values()).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [yearWeeklogs]);

  // Export CSV
  const handleExportCsv = () => {
    const headers = ["Semana", "Cliente", "Status", "Qtd Veiculos", "Total"];
    const rows = yearWeeklogs.map((wl) => [
      wl.week || `Semana ${wl.startsOn?.slice(0, 10)}`,
      `"${wl.clientName || wl.clientId}"`,
      wl.status,
      wl.entries?.length || 1,
      wl.entries?.reduce((s, e) => s + (Number(e.totalAmount) || 0), 0) || 0,
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `relatorio_operacional_${year}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack} className="h-8 px-2 gap-1 text-xs">
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </Button>
          )}
          <div>
            <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
              <FileText className="h-5 w-5 text-indigo-600" />
              Relatório Operacional de Conclusão — Ano {year}
            </h2>
            <p className="text-xs text-muted-foreground">
              Consolidação anual de ordens de produção concluídas, lotes validados e volume comercial reconhecido.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCsv} className="h-8 text-xs gap-1.5">
            <Download className="h-3.5 w-3.5" />
            Exportar CSV
          </Button>
          <Button
            size="sm"
            onClick={() => window.print()}
            className="h-8 text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            <Printer className="h-3.5 w-3.5" />
            Imprimir Relatório
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 bg-card/60">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Veículos Concluídos</span>
            <Car className="h-4 w-4 text-primary" />
          </div>
          <div className="text-2xl font-bold mt-2 text-foreground tabular-nums">
            {stats.totalVehicles}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Total transferido e alocado em {year}
          </p>
        </Card>

        <Card className="p-4 bg-card/60">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Lotes Semanais</span>
            <Calendar className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="text-2xl font-bold mt-2 text-foreground tabular-nums">
            {stats.totalBatches}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {stats.validatedBatches} lote(s) com validação concluída
          </p>
        </Card>

        <Card className="p-4 bg-card/60">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Volume Financeiro</span>
            <Euro className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold mt-2 text-emerald-700 dark:text-emerald-400 tabular-nums">
            {formatFinanceMoney(stats.totalFinancial, "EUR")}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Total reconhecido em serviços
          </p>
        </Card>

        <Card className="p-4 bg-card/60">
          <div className="flex items-center justify-between text-muted-foreground text-xs font-medium">
            <span>Taxa de Validação</span>
            <CheckCircle2 className="h-4 w-4 text-teal-500" />
          </div>
          <div className="text-2xl font-bold mt-2 text-foreground tabular-nums">
            {stats.totalBatches > 0
              ? `${Math.round((stats.validatedBatches / stats.totalBatches) * 100)}%`
              : "0%"}
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            Conclusão do ciclo WEEKLOG
          </p>
        </Card>
      </div>

      {/* Breakdown por Empresa Parceira (B2B) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-indigo-500" />
            <CardTitle className="text-sm font-semibold">
              Consolidação por Empresa Parceira / Cliente Comercial
            </CardTitle>
          </div>
          <CardDescription className="text-xs">
            Distribuição de veículos, lotes semanais e faturamento produzido por parceiro B2B em {year}.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="text-xs">
                <TableHead>Empresa Parceira</TableHead>
                <TableHead className="text-center">Lotes no Ano</TableHead>
                <TableHead className="text-center">Veículos Concluídos</TableHead>
                <TableHead className="text-center">Validação</TableHead>
                <TableHead className="text-right">Volume Produzido</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clientBreakdown.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-xs text-muted-foreground">
                    Nenhum lote operacional registrado para o ano {year}.
                  </TableCell>
                </TableRow>
              ) : (
                clientBreakdown.map((row) => (
                  <TableRow key={row.clientName} className="text-xs hover:bg-muted/30">
                    <TableCell className="font-semibold text-foreground">
                      {row.clientName}
                    </TableCell>
                    <TableCell className="text-center font-mono">
                      {row.batches}
                    </TableCell>
                    <TableCell className="text-center font-mono font-medium">
                      {row.vehicles}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="secondary"
                        className={
                          row.validated === row.batches
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                            : "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
                        }
                      >
                        {row.validated}/{row.batches} validados
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold text-foreground tabular-nums">
                      {formatFinanceMoney(row.totalAmount, "EUR")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Tabela de Lotes Semanais do Ano */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-indigo-500" />
            <CardTitle className="text-sm font-semibold">
              Histórico Detalhado de Lotes Semanais ({year})
            </CardTitle>
          </div>
          <CardDescription className="text-xs">
            Lista de todas as semanas operacionais registradas e o status de faturamento / ordens de pagamento.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/40">
              <TableRow className="text-xs">
                <TableHead>Semana / Período</TableHead>
                <TableHead>Empresa Parceira</TableHead>
                <TableHead className="text-center">Veículos</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total Comercial</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {yearWeeklogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-xs text-muted-foreground">
                    Nenhum lote operacional encontrado para este ano.
                  </TableCell>
                </TableRow>
              ) : (
                yearWeeklogs.map((wl) => {
                  const wlTotal =
                    wl.entries?.reduce((s, e) => s + (Number(e.totalAmount) || 0), 0) || 0;

                  return (
                    <TableRow key={wl.id} className="text-xs hover:bg-muted/30">
                      <TableCell className="font-semibold text-foreground">
                        {wl.week || `Semana ${wl.startsOn?.slice(0, 10)}`}
                        <div className="text-[10px] text-muted-foreground font-mono">
                          ID: {wl.id.slice(0, 8)}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {wl.clientName || wl.clientId}
                      </TableCell>
                      <TableCell className="text-center font-mono">
                        {wl.entries?.length || 1}
                      </TableCell>
                      <TableCell>
                        {wl.status === "validated" ? (
                          <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                            Validado (Avançou para OP)
                          </Badge>
                        ) : wl.status === "rectification_pending" ? (
                          <Badge variant="secondary" className="bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300">
                            Retificação Pendente
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                            Aguardando Validação
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-semibold text-foreground tabular-nums">
                        {formatFinanceMoney(wlTotal, "EUR")}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
