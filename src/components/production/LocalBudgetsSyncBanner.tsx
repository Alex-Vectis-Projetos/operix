import { useState, useEffect, useCallback } from "react";
import { CloudUpload, RefreshCw, AlertCircle, CheckCircle2, ShieldCheck, Database } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { syncLocalBudgets } from "@/lib/apiBudgets";
import { toast } from "sonner";

const STORAGE_KEY = "budgets-local-v1";
const BACKUP_PREFIX = "budgets-local-backup";

interface LocalBudgetItem {
  id: string;
  number?: string;
  client_name?: string;
  clientName?: string;
  vehicle_plate?: string;
  vehiclePlate?: string;
  vehicle_brand?: string;
  vehicleBrand?: string;
  vehicle_model?: string;
  vehicleModel?: string;
  gross_total?: number;
  grossTotal?: number;
  parts?: any[];
  services?: any[];
  labor?: any[];
  [key: string]: any;
}

interface Props {
  onSyncSuccess?: (syncedMap: Record<string, string>) => void;
  className?: string;
}

export function LocalBudgetsSyncBanner({ onSyncSuccess, className }: Props) {
  const [localItems, setLocalItems] = useState<LocalBudgetItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const loadLocalBudgets = useCallback(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        setLocalItems([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        setLocalItems(parsed);
      } else {
        setLocalItems([]);
      }
    } catch {
      setLocalItems([]);
    }
  }, []);

  useEffect(() => {
    loadLocalBudgets();
  }, [loadLocalBudgets]);

  if (dismissed || localItems.length === 0) {
    return null;
  }

  const handleConfirmSync = async () => {
    setIsSyncing(true);
    try {
      const payloadItems = localItems.map((item) => ({
        legacyLocalId: String(item.id || item.legacyLocalId || item.legacy_local_id),
        clientName: item.client_name || item.clientName || "Cliente",
        vehiclePlate: item.vehicle_plate || item.vehiclePlate || "",
        vehicleBrand: item.vehicle_brand || item.vehicleBrand || "",
        vehicleModel: item.vehicle_model || item.vehicleModel || "",
        grossTotal: Number(item.gross_total || item.grossTotal || 0),
        parts: item.parts || [],
        services: item.services || [],
        labor: item.labor || [],
        notes: item.notes || "",
        diagnosis: item.diagnosis || "",
      }));

      const res = await syncLocalBudgets(payloadItems);

      // Backup de segurança antes de remover
      try {
        localStorage.setItem(
          `${BACKUP_PREFIX}-${Date.now()}`,
          JSON.stringify(localItems)
        );
      } catch {
        // storage quota fallback
      }

      // Limpeza da chave ativa apenas após resposta 200/201 do servidor
      localStorage.removeItem(STORAGE_KEY);
      setLocalItems([]);
      setIsOpen(false);

      const count = Object.keys(res.synced || {}).length;
      toast.success(
        `${count} orçamento(s) local(is) sincronizado(s) com sucesso no workspace!`
      );

      onSyncSuccess?.(res.synced);
    } catch (err: any) {
      toast.error(
        err?.message || "Falha ao sincronizar orçamentos locais com o servidor."
      );
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <>
      <div
        className={`relative overflow-hidden rounded-xl border border-primary/20 bg-primary/5 p-4 shadow-sm backdrop-blur-sm ${
          className || ""
        }`}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CloudUpload className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-semibold text-foreground">
                  Orçamentos locais pendentes de sincronização
                </h4>
                <Badge variant="secondary" className="font-mono text-xs">
                  {localItems.length}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">
                Foram detectados dados salvos temporariamente na memória deste navegador.
                Sincronize com a nuvem para salvar no PostgreSQL e evitar perda de dados.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDismissed(true)}
              className="text-xs text-muted-foreground"
            >
              Mais tarde
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => setIsOpen(true)}
              className="gap-1.5 text-xs font-medium shadow-sm"
            >
              <Database className="h-3.5 w-3.5" />
              Sincronizar com a Nuvem
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={isOpen} onOpenChange={(open) => !isSyncing && setIsOpen(open)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-2 text-primary">
              <ShieldCheck className="h-5 w-5" />
              <DialogTitle>Migração Assistida para Nuvem</DialogTitle>
            </div>
            <DialogDescription>
              Você está prestes a enviar {localItems.length} orçamento(s) local(is) para o
              banco de dados oficial. A sincronização é idempotente e impede duplicações.
            </DialogDescription>
          </DialogHeader>

          <div className="my-3 max-h-60 space-y-2 overflow-y-auto pr-1">
            {localItems.map((item, index) => {
              const name = item.client_name || item.clientName || "Cliente sem nome";
              const plate = item.vehicle_plate || item.vehiclePlate || "Sem placa";
              const model = item.vehicle_model || item.vehicleModel || item.vehicle_brand || "";
              const total = item.gross_total ?? item.grossTotal ?? 0;

              return (
                <div
                  key={item.id || index}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 p-2.5 text-xs"
                >
                  <div className="min-w-0 pr-2">
                    <div className="truncate font-medium text-foreground">{name}</div>
                    <div className="truncate text-muted-foreground">
                      {plate} {model ? `· ${model}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="font-semibold text-foreground">
                      € {Number(total).toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsOpen(false)}
              disabled={isSyncing}
            >
              Cancelar
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={handleConfirmSync}
              disabled={isSyncing}
              className="gap-1.5"
            >
              {isSyncing ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Sincronizando...
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Confirmar Sincronização
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
