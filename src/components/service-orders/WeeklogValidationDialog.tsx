import { useState, useRef, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  WeeklogSignatureCanvas,
  type WeeklogSignatureCanvasRef,
} from "./WeeklogSignatureCanvas";
import {
  useWeeklog,
  useWeeklogEntries,
  useSubmitWeeklog,
  useReviewWeeklogEntry,
  useUploadWeeklogSignature,
  useValidateWeeklog,
  useRectifyWeeklogEntry,
  mapWeeklogError,
  type WeeklogEntry,
  type WeeklogStatus,
} from "@/hooks/useWeeklogs";
import { useAuth } from "@/hooks/useAuth";
import { useRole } from "@/hooks/useRole";
import { toast } from "sonner";
import {
  Calendar,
  Building2,
  MapPin,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Send,
  Lock,
  UserCheck,
  PenTool,
  Loader2,
  Car,
  History,
} from "lucide-react";

interface WeeklogValidationDialogProps {
  weeklogId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getStatusBadge(status: WeeklogStatus) {
  switch (status) {
    case "open":
      return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">Aberto</Badge>;
    case "pending_validation":
      return <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">Aguardando Validação</Badge>;
    case "validated":
      return <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">Validado</Badge>;
    case "rectification_pending":
      return <Badge variant="secondary" className="bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300">Retificação Pendente</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getEntryValidationBadge(status: string) {
  switch (status) {
    case "approved":
      return (
        <Badge className="bg-emerald-600 text-white hover:bg-emerald-700 gap-1 text-[10px]">
          <CheckCircle2 className="h-3 w-3" /> Aprovado
        </Badge>
      );
    case "rejected":
      return (
        <Badge variant="destructive" className="gap-1 text-[10px]">
          <XCircle className="h-3 w-3" /> Rejeitado
        </Badge>
      );
    case "rectification_requested":
      return (
        <Badge variant="secondary" className="bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 gap-1 text-[10px]">
          <RotateCcw className="h-3 w-3" /> Retificação Solicitada
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground gap-1 text-[10px]">
          Pendente
        </Badge>
      );
  }
}

export function WeeklogValidationDialog({
  weeklogId,
  open,
  onOpenChange,
}: WeeklogValidationDialogProps) {
  const { user } = useAuth();
  const { dbRole } = useRole();
  const isClientRole = dbRole === "client";
  const canvasRef = useRef<WeeklogSignatureCanvasRef | null>(null);

  const { data: weeklog, isLoading: isWlLoading } = useWeeklog(weeklogId);
  const { data: entries = [], isLoading: isEntriesLoading } = useWeeklogEntries(weeklogId);

  const submitMutation = useSubmitWeeklog();
  const reviewMutation = useReviewWeeklogEntry();
  const uploadSignatureMutation = useUploadWeeklogSignature();
  const validateMutation = useValidateWeeklog();
  const rectifyMutation = useRectifyWeeklogEntry();

  // State for rejection modal
  const [rejectingEntryId, setRejectingEntryId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  // State for rectification modal
  const [rectifyingEntryId, setRectifyingEntryId] = useState<string | null>(null);
  const [rectificationReason, setRectificationReason] = useState("");

  // Validation method tab
  const [validationMethod, setValidationMethod] = useState<"authenticated_confirmation" | "drawn_signature">(
    "authenticated_confirmation"
  );
  const [isValidating, setIsValidating] = useState(false);

  // Active validation round and coverage snapshot
  const activeRound = useMemo(() => {
    if (!weeklog?.validations) return null;
    return (
      weeklog.validations.find((v) => v.status === "pending") ||
      weeklog.validations[weeklog.validations.length - 1] ||
      null
    );
  }, [weeklog?.validations]);

  const coverageEntryIds = useMemo(() => {
    if (!activeRound || !Array.isArray(activeRound.coverageSnapshot)) return null;
    return new Set(
      activeRound.coverageSnapshot
        .map((item: any) => item.weeklogEntryId || item.id || item.entryId)
        .filter(Boolean)
    );
  }, [activeRound]);

  const coveredEntries = useMemo(() => {
    if (!coverageEntryIds) return entries;
    return entries.filter((e) => coverageEntryIds.has(e.id));
  }, [entries, coverageEntryIds]);

  const unreviewedCount = useMemo(() => {
    return coveredEntries.filter((e) => e.validationStatus === "pending").length;
  }, [coveredEntries]);

  // Check if current user is technician on any entry
  const isTechnicianOnAny = useMemo(() => {
    if (!user?.id) return false;
    return entries.some((e) => e.technicianUserId === user.id);
  }, [entries, user?.id]);

  const isImmutable = weeklog?.status === "validated";

  // Handlers
  const handleSubmitForValidation = async () => {
    if (!weeklogId) return;
    try {
      await submitMutation.mutateAsync(weeklogId);
      toast.success("Lote semanal enviado para validação com sucesso!");
    } catch (err) {
      toast.error(mapWeeklogError(err));
    }
  };

  const handleApproveEntry = async (entry: WeeklogEntry) => {
    if (!weeklogId) return;
    try {
      await reviewMutation.mutateAsync({
        weeklogId,
        entryId: entry.id,
        payload: { outcome: "approved" },
      });
      toast.success("Item aprovado com sucesso.");
    } catch (err) {
      toast.error(mapWeeklogError(err));
    }
  };

  const handleOpenRejectDialog = (entry: WeeklogEntry) => {
    setRejectingEntryId(entry.id);
    setRejectionReason("");
  };

  const handleConfirmRejection = async () => {
    if (!weeklogId || !rejectingEntryId) return;
    const trimmed = rejectionReason.trim();
    if (!trimmed) {
      toast.error("Motivo da rejeição é obrigatório.");
      return;
    }

    try {
      await reviewMutation.mutateAsync({
        weeklogId,
        entryId: rejectingEntryId,
        payload: {
          outcome: "rejected",
          rejectionReason: trimmed,
        },
      });
      toast.success("Item rejeitado formalmente.");
      setRejectingEntryId(null);
      setRejectionReason("");
    } catch (err) {
      toast.error(mapWeeklogError(err));
    }
  };

  const handleOpenRectifyDialog = (entry: WeeklogEntry) => {
    setRectifyingEntryId(entry.id);
    setRectificationReason(entry.rejectionReason || "");
  };

  const handleConfirmRectification = async () => {
    if (!weeklogId || !rectifyingEntryId) return;
    const trimmed = rectificationReason.trim();
    if (!trimmed) {
      toast.error("Motivo da solicitação de retificação é obrigatório.");
      return;
    }

    try {
      await rectifyMutation.mutateAsync({
        weeklogId,
        entryId: rectifyingEntryId,
        payload: {
          reason: trimmed,
        },
      });
      toast.success("Retificação solicitada com sucesso! A ordem de produção foi reaberta.");
      setRectifyingEntryId(null);
      setRectificationReason("");
    } catch (err) {
      toast.error(mapWeeklogError(err));
    }
  };

  const handleValidateBatch = async () => {
    if (!weeklogId) return;

    if (unreviewedCount > 0) {
      toast.error(
        `Existem ${unreviewedCount} item(ns) com revisão pendente. Todos devem ser aprovados ou rejeitados.`
      );
      return;
    }

    setIsValidating(true);
    try {
      if (validationMethod === "authenticated_confirmation") {
        await validateMutation.mutateAsync({
          weeklogId,
          payload: {
            validationMethod: "authenticated_confirmation",
          },
        });
        toast.success("Lote semanal validado com sucesso via Confirmação Autenticada!");
      } else {
        const canvas = canvasRef.current;
        if (!canvas || canvas.isEmpty()) {
          toast.error("Desenhe a assinatura manuscrita antes de validar.");
          setIsValidating(false);
          return;
        }

        const pngBlob = await canvas.getPngBlob();
        if (!pngBlob) {
          toast.error("Falha ao exportar assinatura em PNG (&le; 1 MB).");
          setIsValidating(false);
          return;
        }

        // 1. Upload staging signature
        const uploadResult = await uploadSignatureMutation.mutateAsync({
          weeklogId,
          pngBlob,
        });

        // 2. Complete validation with staging reference
        await validateMutation.mutateAsync({
          weeklogId,
          payload: {
            validationMethod: "drawn_signature",
            signatureStoragePath: uploadResult.signatureStoragePath,
          },
        });

        toast.success("Lote semanal validado com sucesso com assinatura manuscrita!");
        canvas.clear();
      }
    } catch (err) {
      toast.error(mapWeeklogError(err));
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-6 space-y-6">
        <DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold">
                  WEEKLOG · {weeklog?.week ?? `Lote ${weeklog?.id?.slice(0, 8) ?? ""}`}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Validação documental canônica e governança de fechamento semanal
                </DialogDescription>
              </div>
            </div>
            {weeklog && getStatusBadge(weeklog.status)}
          </div>
        </DialogHeader>

        {isWlLoading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando lote semanal...
          </div>
        ) : !weeklog ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            Lote semanal não encontrado.
          </div>
        ) : (
          <div className="space-y-6">
            {/* Meta info band */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 rounded-lg bg-muted/40 text-xs">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <div className="font-medium text-foreground">Início da Semana</div>
                  <div className="text-muted-foreground truncate">{weeklog.startsOn}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <div className="font-medium text-foreground">Cliente</div>
                  <div className="text-muted-foreground truncate">{weeklog.clientId}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <div className="font-medium text-foreground">Local Operacional</div>
                  <div className="text-muted-foreground truncate">{weeklog.siteKey}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground shrink-0" />
                <div>
                  <div className="font-medium text-foreground">Rodada Atual</div>
                  <div className="text-muted-foreground">
                    Seq #{activeRound?.validationSequence ?? 1} ({activeRound?.status ?? "aberta"})
                  </div>
                </div>
              </div>
            </div>

            {/* Immutability Banner */}
            {isImmutable && (
              <div className="flex items-center gap-2.5 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-900 dark:text-emerald-300 text-xs font-medium">
                <Lock className="h-4 w-4 shrink-0" />
                <span>
                  Este lote semanal já foi validado e assinado. Todas as entradas e chancelas são imutáveis.
                </span>
              </div>
            )}

            {/* Self validation warning */}
            {isTechnicianOnAny && weeklog.status === "pending_validation" && (
              <div className="flex items-center gap-2.5 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-950/40 dark:border-amber-900 dark:text-amber-300 text-xs">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  Você participou da execução de serviços deste lote. De acordo com as diretrizes de integridade, auto-validação é estritamente bloqueada pelo servidor.
                </span>
              </div>
            )}

            {/* Entries Section */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Entradas da Execução ({entries.length})
                </h4>
                {coverageEntryIds && (
                  <span className="text-[11px] text-muted-foreground">
                    {coverageEntryIds.size} cobertas na rodada ativa
                  </span>
                )}
              </div>

              {isEntriesLoading ? (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  <Loader2 className="inline mr-1.5 h-4 w-4 animate-spin" /> Carregando itens...
                </div>
              ) : entries.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground border rounded-lg">
                  Nenhuma ordem de produção concluída neste lote até o momento.
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {entries.map((entry) => {
                    const isCovered = coverageEntryIds ? coverageEntryIds.has(entry.id) : true;
                    const isSelf = entry.technicianUserId === user?.id;
                    const canReview =
                      weeklog.status === "pending_validation" &&
                      entry.validationStatus === "pending" &&
                      isCovered &&
                      !isSelf;

                    const canRectify =
                      (weeklog.status === "rectification_pending" || weeklog.status === "validated") &&
                      (entry.validationStatus === "rejected" || entry.validationStatus === "approved");

                    return (
                      <div
                        key={entry.id}
                        className={`p-3 rounded-lg border text-xs flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                          !isCovered ? "bg-muted/20 border-dashed" : "bg-card"
                        }`}
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-foreground">
                              Seq #{entry.executionSequence}
                            </span>
                            <span className="text-muted-foreground truncate">
                              OP: {entry.productionOrderId.slice(0, 8)}
                            </span>
                            {entry.vehicleSnapshot && (
                              <Badge variant="outline" className="gap-1 font-normal text-[10px]">
                                <Car className="h-3 w-3" />
                                {entry.vehicleSnapshot.brand} {entry.vehicleSnapshot.model} (
                                {entry.vehicleSnapshot.licensePlate})
                              </Badge>
                            )}
                            {getEntryValidationBadge(entry.validationStatus)}
                            {!isCovered && (
                              <Badge variant="secondary" className="text-[10px]">
                                Fora da rodada ativa
                              </Badge>
                            )}
                          </div>
                          <div className="text-muted-foreground text-[11px] truncate">
                            Técnico: {entry.technicianName ?? entry.technicianUserId} · Total:{" "}
                            <b>
                              {Number(entry.totalAmount).toLocaleString("pt-BR", {
                                style: "currency",
                                currency: entry.currencyCode || "EUR",
                              })}
                            </b>
                          </div>
                          {entry.rejectionReason && (
                            <div className="text-red-600 dark:text-red-400 text-[11px] font-medium">
                              Motivo da rejeição: {entry.rejectionReason}
                            </div>
                          )}
                          {entry.rectificationReason && (
                            <div className="text-purple-600 dark:text-purple-400 text-[11px]">
                              Retificação: {entry.rectificationReason}
                            </div>
                          )}
                        </div>

                        {/* Actions for Entry */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          {canReview && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                onClick={() => handleApproveEntry(entry)}
                                disabled={reviewMutation.isPending}
                              >
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Aprovar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={() => handleOpenRejectDialog(entry)}
                                disabled={reviewMutation.isPending}
                              >
                                <XCircle className="mr-1 h-3.5 w-3.5" /> Rejeitar
                              </Button>
                            </>
                          )}

                          {canRectify && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                              onClick={() => handleOpenRectifyDialog(entry)}
                              disabled={rectifyMutation.isPending}
                            >
                              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Solicitar Retificação
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Submit Action (Open / Rectification Pending) */}
            {(weeklog.status === "open" || weeklog.status === "rectification_pending") && (
              <div className="p-4 rounded-lg border border-indigo-200 bg-indigo-50/50 dark:border-indigo-900/50 dark:bg-indigo-950/20 flex flex-col md:flex-row items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-foreground">
                    Submissão para Validação
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Congela o snapshot das entradas atuais para chancela formal do cliente.
                  </div>
                </div>
                <Button
                  onClick={handleSubmitForValidation}
                  disabled={submitMutation.isPending || entries.length === 0}
                  className="gap-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {submitMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Enviar para Validação
                </Button>
              </div>
            )}

            {/* Validation Panel (Pending Validation) */}
            {weeklog.status === "pending_validation" && !isImmutable && (
              <div className="p-4 rounded-lg border bg-card space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <h4 className="text-xs font-semibold text-foreground">
                      Conclusão da Rodada de Validação
                    </h4>
                    <p className="text-[11px] text-muted-foreground">
                      {unreviewedCount > 0 ? (
                        <span className="text-amber-600 font-medium">
                          Restam {unreviewedCount} item(ns) pendentes de inspeção.
                        </span>
                      ) : (
                        <span className="text-emerald-600 font-medium">
                          Todos os itens foram inspecionados. Pronto para validação formal.
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                <Tabs
                  value={validationMethod}
                  onValueChange={(v) => setValidationMethod(v as any)}
                  className="w-full"
                >
                  <TabsList className="grid grid-cols-2 w-full max-w-xs">
                    <TabsTrigger value="authenticated_confirmation" className="text-xs gap-1.5">
                      <UserCheck className="h-3.5 w-3.5" /> Autenticada
                    </TabsTrigger>
                    <TabsTrigger value="drawn_signature" className="text-xs gap-1.5">
                      <PenTool className="h-3.5 w-3.5" /> Manuscrita (PNG)
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="authenticated_confirmation" className="mt-3 space-y-3">
                    <div className="p-3 rounded bg-muted/40 text-xs text-muted-foreground leading-relaxed">
                      Ao clicar em confirmar, você declara ter inspecionado e validado formalmente as ordens de produção deste lote semanal com autoridade de representante do cliente.
                    </div>
                  </TabsContent>

                  <TabsContent value="drawn_signature" className="mt-3 space-y-3">
                    <WeeklogSignatureCanvas ref={canvasRef} disabled={unreviewedCount > 0 || isValidating} />
                  </TabsContent>
                </Tabs>

                <div className="flex justify-end pt-2">
                  <Button
                    onClick={handleValidateBatch}
                    disabled={unreviewedCount > 0 || isValidating || isTechnicianOnAny}
                    className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs min-h-[44px]"
                  >
                    {isValidating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Concluir Validação do Lote
                  </Button>
                </div>
              </div>
            )}

            {/* Validation Rounds History */}
            {weeklog.validations && weeklog.validations.length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" /> Histórico de Rodadas ({weeklog.validations.length})
                </h4>
                <div className="space-y-1.5">
                  {weeklog.validations.map((v) => (
                    <div
                      key={v.id}
                      className="flex items-center justify-between p-2.5 rounded border bg-muted/20 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">Rodada #{v.validationSequence}</span>
                        <Badge variant="outline" className="text-[10px]">
                          {v.status === "validated" ? "Validada" : "Pendente"}
                        </Badge>
                        <span className="text-muted-foreground text-[11px]">
                          Método: {v.validationMethod ?? "N/A"}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {v.validatedAt
                          ? `Concluída em ${new Date(v.validatedAt).toLocaleDateString("pt-BR")}`
                          : v.submittedAt
                          ? `Submetida em ${new Date(v.submittedAt).toLocaleDateString("pt-BR")}`
                          : ""}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>

        {/* Rejection Prompt Modal */}
        {rejectingEntryId && (
          <Dialog open={!!rejectingEntryId} onOpenChange={() => setRejectingEntryId(null)}>
            <DialogContent className="max-w-md p-5 space-y-4">
              <DialogHeader>
                <DialogTitle className="text-sm font-semibold text-red-600 flex items-center gap-2">
                  <XCircle className="h-4 w-4" /> Motivo da Rejeição Formal
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Informe o motivo detalhado para justificar a rejeição deste item na chancela semanal.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="rejectionReason" className="text-xs">
                  Justificativa (obrigatória)
                </Label>
                <Textarea
                  id="rejectionReason"
                  placeholder="Ex: Serviço executado incompleto, divergência de peças..."
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="text-xs min-h-[80px]"
                />
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" size="sm" onClick={() => setRejectingEntryId(null)}>
                  Cancelar
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleConfirmRejection}
                  disabled={reviewMutation.isPending || !rejectionReason.trim()}
                >
                  Confirmar Rejeição
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}

        {/* Rectification Prompt Modal */}
        {rectifyingEntryId && (
          <Dialog open={!!rectifyingEntryId} onOpenChange={() => setRectifyingEntryId(null)}>
            <DialogContent className="max-w-md p-5 space-y-4">
              <DialogHeader>
                <DialogTitle className="text-sm font-semibold text-purple-600 flex items-center gap-2">
                  <RotateCcw className="h-4 w-4" /> Solicitação de Retificação
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Ao solicitar retificação, a ordem de produção será reaberta com nova sequência de execução.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="rectificationReason" className="text-xs">
                  Justificativa do Retrabalho (obrigatória)
                </Label>
                <Textarea
                  id="rectificationReason"
                  placeholder="Ex: Corrigir pintura no para-choque traseiro..."
                  value={rectificationReason}
                  onChange={(e) => setRectificationReason(e.target.value)}
                  className="text-xs min-h-[80px]"
                />
              </div>
              <DialogFooter className="gap-2">
                <Button variant="outline" size="sm" onClick={() => setRectifyingEntryId(null)}>
                  Cancelar
                </Button>
                <Button
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                  size="sm"
                  onClick={handleConfirmRectification}
                  disabled={rectifyMutation.isPending || !rectificationReason.trim()}
                >
                  Solicitar Retificação
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
}
