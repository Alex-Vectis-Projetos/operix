import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "./useWorkspace";
import { toast } from "sonner";
import {
  listBudgets,
  getBudget,
  getBudgetRevisions,
  createBudget,
  updateBudgetRevision,
  approveBudgetRevision,
  rejectBudgetRevision,
  getBudgetPhotos,
  uploadBudgetPhoto,
  deleteBudgetPhoto,
  deleteBudget,
  type ApiBudget,
  type ApiBudgetRevision,
  type ApiBudgetPhoto,
  type BudgetStatus,
  type BudgetType,
  type CreateBudgetInput,
  type UpdateBudgetRevisionInput,
  type ApproveBudgetRevisionOptions,
} from "@/lib/apiBudgets";

export type {
  ApiBudget,
  ApiBudgetRevision,
  ApiBudgetPhoto,
  BudgetStatus,
  BudgetType,
  CreateBudgetInput,
  UpdateBudgetRevisionInput,
  ApproveBudgetRevisionOptions,
};

export interface BudgetFilters {
  q?: string;
  clientId?: string;
  plate?: string;
  status?: BudgetStatus;
}

export function useBudgets(filters?: BudgetFilters) {
  const qc = useQueryClient();
  const { workspaceId } = useWorkspace();

  const query = useQuery({
    queryKey: ["budgets", workspaceId, filters?.q, filters?.clientId, filters?.plate, filters?.status],
    enabled: !!workspaceId,
    queryFn: async () => {
      const res = await listBudgets({
        q: filters?.q,
        clientId: filters?.clientId,
        plate: filters?.plate,
      });

      if (filters?.status) {
        return res.budgets.filter((b) => {
          const currentStatus = b.currentRevision?.status || b.current_revision?.status || "draft";
          return currentStatus === filters.status;
        });
      }

      return res.budgets;
    },
    placeholderData: (previousData) => previousData ?? [],
  });

  const create = useMutation({
    mutationFn: async (payload: CreateBudgetInput) => {
      return createBudget(payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      toast.success("Orçamento criado com sucesso.");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Erro ao criar orçamento.");
    },
  });

  const updateRevision = useMutation({
    mutationFn: async ({
      budgetId,
      revisionId,
      patch,
    }: {
      budgetId: string;
      revisionId: string;
      patch: UpdateBudgetRevisionInput;
    }) => {
      return updateBudgetRevision(budgetId, revisionId, patch);
    },
    onSuccess: (data, variables) => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["budget", variables.budgetId] });
      qc.invalidateQueries({ queryKey: ["budget_revisions", variables.budgetId] });
      if (data.isNewRevision) {
        toast.info("Nova revisão gerada automaticamente (versão anterior preservada).");
      } else {
        toast.success("Orçamento atualizado com sucesso.");
      }
    },
    onError: (err: any) => {
      toast.error(err?.message || "Erro ao atualizar orçamento.");
    },
  });

  const approve = useMutation({
    mutationFn: async ({
      budgetId,
      revisionId,
      options,
    }: {
      budgetId: string;
      revisionId: string;
      options?: ApproveBudgetRevisionOptions;
    }) => {
      return approveBudgetRevision(budgetId, revisionId, options);
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["budget", variables.budgetId] });
      qc.invalidateQueries({ queryKey: ["budget_revisions", variables.budgetId] });
      qc.invalidateQueries({ queryKey: ["production_orders"] });
      toast.success("Orçamento aprovado e enviado para a Produção com sucesso!");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Erro ao aprovar orçamento.");
    },
  });

  const reject = useMutation({
    mutationFn: async ({
      budgetId,
      revisionId,
      reason,
    }: {
      budgetId: string;
      revisionId: string;
      reason: string;
    }) => {
      return rejectBudgetRevision(budgetId, revisionId, reason);
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      qc.invalidateQueries({ queryKey: ["budget", variables.budgetId] });
      qc.invalidateQueries({ queryKey: ["budget_revisions", variables.budgetId] });
      toast.success("Orçamento marcado como rejeitado.");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Erro ao rejeitar orçamento.");
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      return deleteBudget(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budgets"] });
      toast.success("Orçamento excluído com sucesso.");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Erro ao excluir orçamento.");
    },
  });

  return {
    ...query,
    budgets: query.data ?? [],
    create,
    updateRevision,
    approve,
    reject,
    remove,
  };
}

export function useBudget(id?: string | null) {
  return useQuery({
    queryKey: ["budget", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await getBudget(id!);
      return res.budget;
    },
  });
}

export function useBudgetRevisions(id?: string | null) {
  return useQuery({
    queryKey: ["budget_revisions", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await getBudgetRevisions(id!);
      return res.revisions;
    },
  });
}

export function useBudgetPhotos(budgetId?: string | null) {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["budget_photos", budgetId],
    enabled: !!budgetId,
    queryFn: async () => {
      const res = await getBudgetPhotos(budgetId!);
      return res.photos;
    },
  });

  const upload = useMutation({
    mutationFn: async ({
      file,
      meta,
    }: {
      file: File | Blob;
      meta?: { category?: string; caption?: string };
    }) => {
      if (!budgetId) throw new Error("ID do orçamento ausente");
      return uploadBudgetPhoto(budgetId, file, meta);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget_photos", budgetId] });
      toast.success("Foto enviada com sucesso.");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Erro ao enviar foto.");
    },
  });

  const remove = useMutation({
    mutationFn: async (photoId: string) => {
      if (!budgetId) throw new Error("ID do orçamento ausente");
      return deleteBudgetPhoto(budgetId, photoId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["budget_photos", budgetId] });
      toast.success("Foto removida com sucesso.");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Erro ao remover foto.");
    },
  });

  return {
    ...query,
    photos: query.data ?? [],
    upload,
    remove,
  };
}
