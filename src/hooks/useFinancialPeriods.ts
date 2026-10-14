import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/hooks/useWorkspace";
import { listExpenses, listTechniciansFinance } from "@/lib/apiFinanceV2";

export function useFinancialYears(techId?: string | null) {
  const { workspaceId } = useWorkspace();

  return useQuery({
    queryKey: ["canonical-financial-years", workspaceId, techId || "all"],
    enabled: !!workspaceId,
    staleTime: 30_000,
    queryFn: async (): Promise<number[]> => {
      const currentYear = new Date().getFullYear();
      const set = new Set<number>([currentYear]);

      try {
        const res = await listExpenses();
        const expenses = res.items || [];
        expenses.forEach((e) => {
          if (techId && e.context?.kind === "technician_person" && e.context?.id !== techId) {
            return;
          }
          const dateStr = e.occurredOn || e.createdAt;
          if (dateStr && dateStr.length >= 4) {
            const yr = parseInt(dateStr.slice(0, 4), 10);
            if (!isNaN(yr) && yr >= 2020 && yr <= 2040) {
              set.add(yr);
            }
          }
        });
      } catch (err) {
        console.warn("Could not fetch expense years, fallback to current year", err);
      }

      return Array.from(set).sort((a, b) => b - a);
    },
  });
}

export function useWorkspaceTechnicians() {
  const { workspaceId } = useWorkspace();

  return useQuery({
    queryKey: ["canonical-workspace-technicians", workspaceId],
    enabled: !!workspaceId,
    staleTime: 30_000,
    queryFn: async () => {
      try {
        const res = await listTechniciansFinance();
        return (res.items || []).map((t) => ({
          id: t.personId,
          name: t.name,
        }));
      } catch (err) {
        console.error("Failed to fetch workspace technicians", err);
        return [];
      }
    },
  });
}

export const MONTH_LABELS = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];
