import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

export interface CountryDocumentRequirement {
  id: string;
  country: string;
  document_name: string;
  applies_to: "both" | "technician" | "provider_operational";
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

const QK = ["country-document-requirements"] as const;

export function useCountryDocumentRequirements(country?: string, includeInactive = false) {
  const qc = useQueryClient();
  const queryKey = [...QK, country ?? "all", includeInactive];

  const query = useQuery({
    queryKey,
    staleTime: 30_000,
    queryFn: () => {
      const params = new URLSearchParams();
      if (country) params.set("country", country);
      if (includeInactive) params.set("active", "all");
      const qs = params.toString();
      return apiRequest<CountryDocumentRequirement[]>(`/country-document-requirements${qs ? `?${qs}` : ""}`, {
        timeoutMs: 10000,
      });
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: QK });

  const create = useMutation({
    mutationFn: (input: { country: string; document_name: string; applies_to?: string; sort_order?: number }) =>
      apiRequest<CountryDocumentRequirement>("/country-document-requirements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        timeoutMs: 10000,
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Documento adicionado à lista do país." });
    },
    onError: (err) => toast({ title: "Erro ao adicionar documento", description: String((err as any)?.message ?? err), variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: ({ id, ...input }: { id: string; document_name?: string; applies_to?: "both" | "technician" | "provider_operational"; sort_order?: number; active?: boolean }) =>
      apiRequest<CountryDocumentRequirement>(`/country-document-requirements/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        timeoutMs: 10000,
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Configuração atualizada." });
    },
    onError: (err) => toast({ title: "Erro ao atualizar", description: String((err as any)?.message ?? err), variant: "destructive" }),
  });

  const seedDefaults = useMutation({
    mutationFn: (country: string) =>
      apiRequest<CountryDocumentRequirement[]>("/country-document-requirements/seed-defaults", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ country }),
        timeoutMs: 15000,
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Modelo padrão de documentos carregado com sucesso." });
    },
    onError: (err) => toast({ title: "Erro ao carregar modelo padrão", description: String((err as any)?.message ?? err), variant: "destructive" }),
  });

  return { ...query, requirements: query.data ?? [], create, update, seedDefaults };
}

export function useConfiguredCountries() {
  return useQuery({
    queryKey: [...QK, "countries"],
    staleTime: 60_000,
    queryFn: () => apiRequest<string[]>("/country-document-requirements/countries", { timeoutMs: 10000 }),
  });
}
