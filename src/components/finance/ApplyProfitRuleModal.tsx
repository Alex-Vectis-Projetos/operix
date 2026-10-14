import React, { useState } from "react";
import { Plus, Users, Percent, ShieldCheck, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useProfitRules,
  useCreateProfitRule,
  useApplyDistributionRule,
  type ProfitDistributionRule,
} from "@/hooks/useFinance";
import { usePaymentLists } from "@/hooks/usePaymentLists";
import { usePeople } from "@/hooks/usePeople";

interface ApplyProfitRuleModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ApplyProfitRuleModal({ isOpen, onClose }: ApplyProfitRuleModalProps) {
  const { data: rulesData, isLoading: loadingRules } = useProfitRules();
  const rules: ProfitDistributionRule[] = rulesData?.items || [];

  const { data: paymentLists = [] } = usePaymentLists();
  const { people = [] } = usePeople();

  const applyMutation = useApplyDistributionRule();
  const createRuleMutation = useCreateProfitRule();

  const [mode, setMode] = useState<"apply" | "create_template">("apply");
  const [selectedListId, setSelectedListId] = useState("");
  const [selectedRuleId, setSelectedRuleId] = useState("");

  // New Template form state
  const [ruleName, setRuleName] = useState("");
  const [techPercentage, setTechPercentage] = useState("60.00");
  const [partnerPercentage, setPartnerPercentage] = useState("10.00");
  const [workspacePercentage, setWorkspacePercentage] = useState("30.00");
  const [selectedPersonId, setSelectedPersonId] = useState("");

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleApply = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!selectedListId) {
      setErrorMsg("Selecione uma lista de pagamento para aplicar o rateio.");
      return;
    }
    if (!selectedRuleId) {
      setErrorMsg("Selecione um modelo de regra de rateio.");
      return;
    }

    try {
      const res = await applyMutation.mutateAsync({
        paymentListId: selectedListId,
        ruleId: selectedRuleId,
      });
      setSuccessMsg(`Sucesso! Foram geradas ${res.distributionsCount} distribuições calculadas sobre o valor HT.`);
      setTimeout(() => {
        onClose();
        setSuccessMsg(null);
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err.message || "Erro ao aplicar regra de rateio.");
    }
  };

  const handleCreateTemplate = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!ruleName.trim()) {
      setErrorMsg("Informe um nome para a regra.");
      return;
    }

    const t = parseFloat(techPercentage) || 0;
    const p = parseFloat(partnerPercentage) || 0;
    const w = parseFloat(workspacePercentage) || 0;

    if (t + p + w !== 100) {
      setErrorMsg(`A soma das porcentagens deve ser exatamente 100% (atual: ${t + p + w}%).`);
      return;
    }

    try {
      const shares: any[] = [
        {
          participantType: "technician",
          percentage: techPercentage,
          personId: selectedPersonId || null,
        },
        {
          participantType: "partner",
          percentage: partnerPercentage,
        },
        {
          participantType: "workspace",
          percentage: workspacePercentage,
        },
      ];

      await createRuleMutation.mutateAsync({
        name: ruleName.trim(),
        shares,
      });

      setSuccessMsg("Modelo de regra criado com sucesso!");
      setMode("apply");
      setRuleName("");
    } catch (err: any) {
      setErrorMsg(err.message || "Erro ao salvar modelo de regra.");
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Percent className="h-5 w-5 text-primary" />
            Rateio em Lote de Produção (Regra Alex)
          </DialogTitle>
          <DialogDescription className="text-xs">
            Calcula os repasses da oficina sobre o valor líquido HT (Hors Taxe) da Lista de Pagamento,
            respeitando cotas parametrizadas (ex: 60% Técnico, 10% Parceiro, 30% Oficina).
          </DialogDescription>
        </DialogHeader>

        {/* Tab switch between applying existing or creating template */}
        <div className="flex border-b border-border/60 pb-2 gap-4 text-xs font-medium">
          <button
            type="button"
            onClick={() => setMode("apply")}
            className={`pb-1 ${mode === "apply" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
          >
            Aplicar Regra à Lista
          </button>
          <button
            type="button"
            onClick={() => setMode("create_template")}
            className={`pb-1 ${mode === "create_template" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
          >
            + Criar Novo Modelo de Rateio
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md text-xs text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-md text-xs text-emerald-600 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {mode === "apply" ? (
          <div className="space-y-4 py-2 text-xs">
            <div className="space-y-1.5">
              <Label className="text-xs">Lista de Pagamento (Base HT)</Label>
              <Select value={selectedListId} onValueChange={setSelectedListId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Selecione a lista..." />
                </SelectTrigger>
                <SelectContent>
                  {paymentLists.map((pl) => (
                    <SelectItem key={pl.id} value={pl.id}>
                      {pl.listNumber} — {pl.clientName} ({pl.currencyCode} {pl.recognizedTotal}) [{pl.status}]
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Regra de Rateio Parametrizada</Label>
              <Select value={selectedRuleId} onValueChange={setSelectedRuleId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Selecione a regra..." />
                </SelectTrigger>
                <SelectContent>
                  {rules.length === 0 ? (
                    <SelectItem value="none" disabled>
                      Nenhum modelo cadastrado. Crie um modelo primeiro.
                    </SelectItem>
                  ) : (
                    rules.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name} ({r.shares.map((s) => `${s.participantType}: ${s.percentage}%`).join(", ")})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg bg-muted/40 p-3 border border-border/50 text-[11px] text-muted-foreground space-y-1">
              <p className="font-semibold text-foreground flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                Regras Contratuais Acordadas com Alex:
              </p>
              <ul className="list-disc pl-4 space-y-0.5">
                <li>Rateio incide exclusivamente sobre a base HT (sem IVA/TVA).</li>
                <li>Despesas do técnico abatem no acerto líquido, não diminuem a produção bruta.</li>
                <li>Gera registros auditados para o Extrato em 3 partes do Técnico.</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2 text-xs">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome do Modelo</Label>
              <Input
                placeholder="Ex: Padrão Granizo 60/10/30 (Peugeot)"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                className="h-8 text-xs"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-[11px]">Técnico (%)</Label>
                <Input
                  type="number"
                  value={techPercentage}
                  onChange={(e) => setTechPercentage(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Parceiro / Oficina (%)</Label>
                <Input
                  type="number"
                  value={partnerPercentage}
                  onChange={(e) => setPartnerPercentage(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[11px]">Empresa Operix (%)</Label>
                <Input
                  type="number"
                  value={workspacePercentage}
                  onChange={(e) => setWorkspacePercentage(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Técnico Principal (Opcional se atribuído na lista)</Label>
              <Select value={selectedPersonId} onValueChange={setSelectedPersonId}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione um técnico padrão..." />
                </SelectTrigger>
                <SelectContent>
                  {people
                    .filter((p) => p.type === "technician")
                    .map((tech) => (
                      <SelectItem key={tech.id} value={tech.id}>
                        {tech.full_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">
            Cancelar
          </Button>
          {mode === "apply" ? (
            <Button
              size="sm"
              onClick={handleApply}
              disabled={applyMutation.isPending || !selectedListId || !selectedRuleId}
              className="h-8 text-xs"
            >
              {applyMutation.isPending ? "Aplicando..." : "Aplicar Rateio"}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleCreateTemplate}
              disabled={createRuleMutation.isPending || !ruleName.trim()}
              className="h-8 text-xs"
            >
              {createRuleMutation.isPending ? "Salvando..." : "Salvar Modelo"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
