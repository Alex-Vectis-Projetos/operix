import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RotateCcw, ChevronDown, ChevronRight, Shield, ShieldCheck, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/api";
import { useWorkspace } from "@/hooks/useWorkspace";

export interface UserPermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  membershipId?: string | null;
  workspaceId?: string | null;
  userName?: string;
  userRole?: string;
}

interface PermissionGroup {
  key: string;
  label: string;
  description: string;
  items: Array<{
    key: string;
    label: string;
    description?: string;
  }>;
}

const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: "service_orders",
    label: "Ordens de Serviço & Orçamentos",
    description: "Controle de visualização, criação e modificação de OS e orçamentos comerciais.",
    items: [
      { key: "service_orders.view", label: "Visualizar Orçamentos e Ordens de Serviço" },
      { key: "service_orders.create", label: "Criar Novos Orçamentos" },
      { key: "service_orders.edit", label: "Editar Orçamentos e Itens de Serviço" },
      { key: "service_orders.delete", label: "Excluir Orçamentos" },
      { key: "service_orders.export_pdf", label: "Visualizar e Baixar PDF" },
      { key: "service_orders.scan_document", label: "Escanear / Digitalizar Documentos" },
      { key: "service_orders.upload_document", label: "Carregar Fotos e Anexos" },
      { key: "service_orders.validate_data", label: "Aprovar e Validar Orçamento" },
      { key: "service_orders.assign_technician", label: "Atribuir Técnico Responsável" },
    ],
  },
  {
    key: "production_workflow",
    label: "Produção & Pipeline Operacional",
    description: "Acompanhamento e movimentação de veículos no fluxo de trabalho.",
    items: [
      { key: "production_workflow.view", label: "Acessar Pipeline de Produção" },
      { key: "production_workflow.move", label: "Movimentar Fases de Produção" },
    ],
  },
  {
    key: "payment_orders",
    label: "Ordens de Pagamento (WEEKLOG)",
    description: "Acesso à validação comercial e listas de pagamento semanal.",
    items: [
      { key: "payment_orders.view", label: "Visualizar Ordens de Pagamento" },
      { key: "payment_orders.create", label: "Criar Ordens de Pagamento" },
      { key: "payment_orders.edit", label: "Editar e Ajustar Valores" },
      { key: "payment_orders.delete", label: "Excluir Ordens de Pagamento" },
      { key: "payment_orders.export_pdf", label: "Exportar Relatórios PDF" },
    ],
  },
  {
    key: "financial",
    label: "Financeiro & Faturamento",
    description: "Acesso a métricas de receita, conciliação e dados de rentabilidade.",
    items: [
      { key: "financial.view", label: "Visualizar Módulo Financeiro" },
      { key: "financial.edit", label: "Registrar e Editar Transações" },
      { key: "financial.view_reports", label: "Visualizar Relatórios Financeiros" },
      { key: "financial.export_reports", label: "Exportar Relatórios Financeiros" },
      { key: "accounting.view", label: "Visualizar Contabilidade e Faturamento" },
      { key: "accounting.create", label: "Criar Faturas e Fechamentos" },
      { key: "profit.view", label: "Visualizar Margens de Lucro e Rentabilidade" },
    ],
  },
  {
    key: "people_locations",
    label: "Cadastros (Colaboradores & Locais)",
    description: "Gestão do time operacional e locais de trabalho.",
    items: [
      { key: "people.view", label: "Visualizar Colaboradores" },
      { key: "people.create", label: "Cadastrar Novos Colaboradores" },
      { key: "people.edit", label: "Editar Dados de Colaboradores" },
      { key: "people.delete", label: "Inativar ou Excluir Colaboradores" },
      { key: "people.upload_document", label: "Enviar Documentos de Colaboradores" },
      { key: "locations.view", label: "Visualizar Locais de Atendimento" },
      { key: "locations.create", label: "Cadastrar Novos Locais" },
      { key: "locations.edit", label: "Editar Informações de Locais" },
    ],
  },
  {
    key: "fleet_docs",
    label: "Frota & Documentos",
    description: "Gestão de veículos da empresa e repositório documental.",
    items: [
      { key: "fleet.view", label: "Visualizar Frota" },
      { key: "fleet.create", label: "Cadastrar Veículo na Frota" },
      { key: "fleet.edit", label: "Editar Dados da Frota" },
      { key: "fleet.delete", label: "Excluir Veículo da Frota" },
      { key: "documents.view", label: "Visualizar Repositório de Documentos" },
      { key: "documents.upload", label: "Enviar Arquivos e Documentos" },
      { key: "documents.edit", label: "Editar Metadados de Documentos" },
      { key: "documents.delete", label: "Excluir Documentos" },
    ],
  },
  {
    key: "users_admin",
    label: "Usuários & Permissões",
    description: "Administração de contas de acesso ao workspace.",
    items: [
      { key: "users.view", label: "Visualizar Lista de Usuários" },
      { key: "users.create", label: "Criar Novos Acessos de Login" },
      { key: "users.edit", label: "Editar Dados de Usuários" },
      { key: "users.delete", label: "Revogar Acessos de Usuários" },
      { key: "users.manage_permissions", label: "Gerenciar Permissões Granulares" },
    ],
  },
  {
    key: "dashboard",
    label: "Painel & Visão Geral",
    description: "Acesso à página inicial e widgets operacionais.",
    items: [
      { key: "dashboard.view", label: "Acessar Painel Principal" },
      { key: "dashboard.view_dashboard", label: "Visualizar Estatísticas Globais" },
      { key: "dashboard.report_hail", label: "Cadastrar Alerta de Granizo" },
      { key: "dashboard.edit", label: "Personalizar Painel" },
    ],
  },
];

export function UserPermissionsDialog({
  open,
  onOpenChange,
  userId,
  membershipId,
  workspaceId: propWorkspaceId,
  userName,
  userRole,
}: UserPermissionsDialogProps) {
  const qc = useQueryClient();
  const { workspaceId: activeWsId, members } = useWorkspace();
  const effectiveWorkspaceId = propWorkspaceId || activeWsId;

  // Resolve target membership
  const member = useMemo(() => {
    if (!members || (!userId && !membershipId)) return null;
    return members.find(
      (m) =>
        (membershipId && m.membership_id === membershipId) ||
        (userId && (m.auth_user_id === userId || m.app_user_id === userId))
    );
  }, [members, userId, membershipId]);

  const targetMembershipId = membershipId || member?.membership_id;
  const targetUserId = userId || member?.auth_user_id;
  const displayName = userName || member?.name || member?.email || "Colaborador";
  const displayRole = userRole || member?.role_label || member?.role || "Membro";

  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    service_orders: true,
    production_workflow: true,
    financial: true,
  });

  // Fetch current permissions & overrides from REST API
  const { data: permsData, isLoading, refetch } = useQuery({
    queryKey: ["account-permissions-dialog", targetUserId, effectiveWorkspaceId],
    enabled: open && !!targetUserId && !!effectiveWorkspaceId,
    queryFn: async () => {
      const res = await apiRequest<{
        admin: boolean;
        role: string;
        map: Record<string, { allowed: boolean; scope: string | null; source: string }>;
        permissions_overrides?: Record<string, boolean> | null;
      }>(`/account/permissions?userId=${targetUserId}&workspaceId=${effectiveWorkspaceId}`, {
        timeoutMs: 8000,
      });
      return res;
    },
  });

  const isFullAdmin = permsData?.admin || member?.role === "owner" || member?.role === "admin";
  const overrides: Record<string, boolean> = permsData?.permissions_overrides ?? (member?.permissions_overrides as Record<string, boolean>) ?? {};

  // Mutation to persist overrides via PATCH /workspaces/:workspaceId/members/:membershipId
  const saveOverridesMutation = useMutation({
    mutationFn: async (nextOverrides: Record<string, boolean> | null) => {
      if (!effectiveWorkspaceId || !targetMembershipId) {
        throw new Error("Não foi possível identificar o vínculo do membro no workspace.");
      }
      return apiRequest(`/workspaces/${effectiveWorkspaceId}/members/${targetMembershipId}`, {
        method: "PATCH",
        body: JSON.stringify({
          permissions_overrides: nextOverrides,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account-permissions-dialog", targetUserId, effectiveWorkspaceId] });
      qc.invalidateQueries({ queryKey: ["workspace-members", effectiveWorkspaceId] });
      qc.invalidateQueries({ queryKey: ["my-permissions"] });
      refetch();
      toast({
        title: "Permissões atualizadas",
        description: "As alterações foram gravadas com sucesso.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Erro ao salvar",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const handleToggle = (key: string, currentAllowed: boolean) => {
    if (isFullAdmin) {
      toast({
        title: "Acesso total de Administrador",
        description: "Usuários com perfil de Administrador / Owner possuem acesso irrestrito.",
      });
      return;
    }

    const nextOverrides = { ...overrides };
    // Invert the current allowed status
    nextOverrides[key] = !currentAllowed;
    saveOverridesMutation.mutate(nextOverrides);
  };

  const handleResetDefaults = () => {
    if (isFullAdmin) return;
    saveOverridesMutation.mutate(null);
  };

  const toggleGroup = (key: string) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const activeOverridesCount = Object.keys(overrides).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden bg-background">
        <DialogHeader className="p-6 pb-4 border-b">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                <DialogTitle className="text-xl">Permissões de Acesso</DialogTitle>
                <Badge variant="outline" className="text-xs capitalize font-medium">
                  {displayRole}
                </Badge>
                {activeOverridesCount > 0 && (
                  <Badge variant="secondary" className="text-xs bg-amber-500/10 text-amber-500 border-amber-500/20">
                    {activeOverridesCount} {activeOverridesCount === 1 ? "exceção ativa" : "exceções ativas"}
                  </Badge>
                )}
              </div>
              <DialogDescription>
                Ajuste os privilégios operacionais de <strong>{displayName}</strong>. As regras são aplicadas imediatamente.
              </DialogDescription>
            </div>

            {!isFullAdmin && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleResetDefaults}
                disabled={saveOverridesMutation.isPending || activeOverridesCount === 0}
                className="gap-1.5 shrink-0"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Restaurar Padrão do Cargo
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {isFullAdmin && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
              <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold text-foreground">Acesso Total (Administrador / Proprietário)</p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  Este usuário possui controle administrativo total sobre o workspace. As permissões individuais não podem ser restringidas para manter a autoridade do sistema.
                </p>
              </div>
            </div>
          )}

          {isLoading ? (
            <div className="space-y-3 py-4">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : (
            PERMISSION_GROUPS.map((group) => {
              const isExpanded = !!expanded[group.key];
              const groupKeys = group.items.map((i) => i.key);
              const allowedCount = groupKeys.filter((k) => {
                if (isFullAdmin) return true;
                if (overrides[k] !== undefined) return overrides[k];
                return permsData?.map?.[k]?.allowed ?? false;
              }).length;

              return (
                <div key={group.key} className="rounded-lg border border-border/60 bg-card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.key)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-muted/40 transition-colors"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm">{group.label}</span>
                        <span className="text-xs text-muted-foreground">
                          ({allowedCount}/{group.items.length} liberadas)
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">{group.description}</p>
                    </div>
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="border-t border-border/50 divide-y divide-border/30 bg-muted/10 px-4 py-2">
                      {group.items.map((item) => {
                        const isOverridden = overrides[item.key] !== undefined;
                        const isAllowed = isFullAdmin
                          ? true
                          : isOverridden
                          ? overrides[item.key]
                          : permsData?.map?.[item.key]?.allowed ?? false;

                        return (
                          <div key={item.key} className="flex items-center justify-between py-2.5 gap-4">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">{item.label}</span>
                                {isOverridden && (
                                  <Badge
                                    variant="outline"
                                    className="text-[10px] px-1.5 py-0 border-amber-500/30 text-amber-500 bg-amber-500/5"
                                  >
                                    Personalizado
                                  </Badge>
                                )}
                              </div>
                              <code className="text-[10px] text-muted-foreground font-mono">{item.key}</code>
                            </div>

                            <Switch
                              checked={isAllowed}
                              disabled={isFullAdmin || saveOverridesMutation.isPending}
                              onCheckedChange={() => handleToggle(item.key, isAllowed)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <DialogFooter className="p-4 border-t bg-muted/20 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {saveOverridesMutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span>Gravando alterações...</span>
              </>
            ) : (
              <span>Alterações salvas de forma persistente no workspace.</span>
            )}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Concluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
