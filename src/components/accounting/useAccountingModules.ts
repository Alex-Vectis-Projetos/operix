import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  listExpenses,
  createExpense,
  reverseExpense,
  generateIdempotencyKey,
  type Expense,
} from "@/lib/apiFinanceV2";
import type { ModuleEntry } from "./ModulePanel";

export type ModuleKey =
  | "rentals"
  | "expenses"
  | "fuel"
  | "travel"
  | "purchases"
  | "government"
  | "withdrawals";

export const CATEGORY_MAP: Record<ModuleKey, { primaryCategory: string; matchingCategories: string[] }> = {
  rentals: {
    primaryCategory: "rent",
    matchingCategories: ["rent", "aluguel", "alugueis", "locacao"],
  },
  expenses: {
    primaryCategory: "operational",
    matchingCategories: ["operational", "despesa", "outros", "other"],
  },
  fuel: {
    primaryCategory: "fuel",
    matchingCategories: ["fuel", "combustivel", "gasolina", "diesel"],
  },
  travel: {
    primaryCategory: "travel",
    matchingCategories: ["travel", "viagem", "viagens", "translado", "hotel", "hospedagem"],
  },
  purchases: {
    primaryCategory: "materials",
    matchingCategories: ["materials", "material", "compras", "ferramentas", "equipamentos"],
  },
  government: {
    primaryCategory: "tax",
    matchingCategories: ["tax", "governo", "impostos", "taxas", "visto"],
  },
  withdrawals: {
    primaryCategory: "advance",
    matchingCategories: ["advance", "salary", "retirada", "retiradas", "adiantamento", "vale"],
  },
};

function buildEntriesFromExpenses(expenses: Expense[]): ModuleEntry[] {
  return expenses.map((exp) => ({
    id: exp.id,
    label: exp.description || "Despesa sem descrição",
    amount: parseFloat(exp.amount) || 0,
    notes: exp.context ? `Ref: ${exp.context.kind}` : undefined,
    created_at: exp.occurredOn || exp.createdAt,
    editable: exp.status === "effective",
  }));
}

export function useAccountingModule(
  moduleKey: ModuleKey,
  year?: number,
  techId?: string | null,
  month?: number | null // 1-12
) {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  const config = CATEGORY_MAP[moduleKey] || { primaryCategory: "operational", matchingCategories: [] };

  const selectedYear = year ?? null;
  const selectedMonth = month && month >= 1 && month <= 12 ? month : null;
  const selectedTech = techId || null;

  const query = useQuery({
    queryKey: ["canonical-accounting-expenses", workspaceId, moduleKey, selectedYear, selectedMonth, selectedTech],
    enabled: !!workspaceId,
    queryFn: async () => {
      const res = await listExpenses();
      const allExpenses = res.items || [];

      // Filter only effective expenses
      return allExpenses.filter((e) => {
        if (e.status !== "effective") return false;

        // 1. Category Match
        const cat = (e.category || "").toLowerCase();
        const matchesCategory =
          cat === config.primaryCategory ||
          config.matchingCategories.some((c) => cat.includes(c));
        if (!matchesCategory) return false;

        // 2. Date Filtering (year & month based on occurredOn)
        const dateStr = e.occurredOn || e.createdAt;
        if (selectedYear) {
          if (!dateStr.startsWith(String(selectedYear))) return false;
        }

        if (selectedMonth) {
          const monthPart = dateStr.slice(5, 7);
          const monthNum = parseInt(monthPart, 10);
          if (monthNum !== selectedMonth) return false;
        }

        // 3. Technician Filtering
        // If a technician is selected, show only expenses tied to that technician
        if (selectedTech) {
          const isTied = e.context?.kind === "technician_person" && e.context?.id === selectedTech;
          if (!isTied) return false;
        }

        return true;
      });
    },
  });

  const rawExpenses = query.data || [];
  const entries: ModuleEntry[] = buildEntriesFromExpenses(rawExpenses);
  const total = entries.reduce((acc, curr) => acc + curr.amount, 0);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["canonical-accounting-expenses"] });
    queryClient.invalidateQueries({ queryKey: ["finance", "v2", "expenses"] });
    queryClient.invalidateQueries({ queryKey: ["finance", "v2", "summary"] });
    queryClient.invalidateQueries({ queryKey: ["finance", "v2", "technicians"] });
    queryClient.invalidateQueries({ queryKey: ["finance", "v2", "technicians", "statement"] });
  };

  const addMutation = useMutation({
    mutationFn: async (entry: { label: string; amount: number; notes: string }) => {
      if (!workspaceId) throw new Error("Workspace ativa não encontrada.");

      const yr = selectedYear ?? new Date().getFullYear();
      const mo = selectedMonth ? String(selectedMonth).padStart(2, "0") : String(new Date().getMonth() + 1).padStart(2, "0");
      const occurredOn = `${yr}-${mo}-15`;

      const description = entry.notes?.trim()
        ? `${entry.label.trim()} — ${entry.notes.trim()}`
        : entry.label.trim();

      await createExpense(
        {
          amount: entry.amount.toFixed(2),
          currencyCode: "EUR",
          category: config.primaryCategory,
          occurredOn,
          description,
          context: selectedTech
            ? { kind: "technician_person", id: selectedTech }
            : undefined,
        },
        generateIdempotencyKey()
      );
    },
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (expenseId: string) => {
      await reverseExpense(
        expenseId,
        { reason: "Cancelado via módulo de Contabilidade Operacional" },
        generateIdempotencyKey()
      );
    },
    onSuccess: invalidate,
  });

  return {
    entries,
    total,
    isLoading: query.isLoading,
    add: addMutation.mutateAsync,
    update: async (_id: string, _e: { label: string; amount: number; notes: string }) => {
      // In canonical immutable model, editing an effective entry is done via reverse and re-create
      // To preserve ledger auditability
      throw new Error("Lançamentos canônicos são imutáveis. Cancele e crie um novo para preservar a auditoria.");
    },
    delete: deleteMutation.mutateAsync,
    allowAdd: !!workspaceId,
  };
}
