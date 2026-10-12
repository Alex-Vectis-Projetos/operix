import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

export type LocationStatus = "active" | "inactive";

export interface Location {
  id: string;
  workspace_id: string | null;
  name: string;
  address_street: string;
  address_number: string | null;
  address_neighborhood: string | null;
  address_city: string;
  address_state: string | null;
  address_zip: string | null;
  address_country: string;
  phone: string | null;
  email: string | null;
  manager_name: string;
  manager_phone: string | null;
  manager_email: string | null;
  status: LocationStatus;
  latitude?: number | null;
  longitude?: number | null;
  is_approximate?: boolean;
  created_at: string;
  updated_at: string;
}

export type LocationInput = Omit<Location, "id" | "created_at" | "updated_at" | "workspace_id"> & {
  workspace_id?: string;
};

const QK = ["locations"] as const;

export function useLocations(filters: { status?: LocationStatus; country?: string; search?: string } = {}) {
  const qc = useQueryClient();
  const queryKey = [...QK, filters];

  const query = useQuery({
    queryKey,
    staleTime: 30_000,
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.status) params.set("status", filters.status);
      if (filters.country) params.set("country", filters.country);
      if (filters.search) params.set("search", filters.search);
      const qs = params.toString();
      return apiRequest<Location[]>(`/locations${qs ? `?${qs}` : ""}`, { timeoutMs: 10000 });
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: QK });

  const create = useMutation({
    mutationFn: (input: LocationInput) =>
      apiRequest<Location>("/locations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        timeoutMs: 10000,
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Local criado com sucesso." });
    },
    onError: (err) => toast({ title: "Erro ao criar Local", description: String((err as any)?.message ?? err), variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: ({ id, ...input }: Partial<LocationInput> & { id: string }) =>
      apiRequest<Location>(`/locations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        timeoutMs: 10000,
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Local atualizado." });
    },
    onError: (err) => toast({ title: "Erro ao atualizar Local", description: String((err as any)?.message ?? err), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest(`/locations/${id}`, { method: "DELETE", timeoutMs: 10000 }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Local excluído." });
    },
    onError: (err) => toast({ title: "Erro ao excluir Local", description: String((err as any)?.message ?? err), variant: "destructive" }),
  });

  return { ...query, locations: query.data ?? [], create, update, remove };
}
