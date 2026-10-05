import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { toast } from "@/hooks/use-toast";

export type PersonType = "administrative" | "technician" | "provider_operational" | "provider_administrative";
export type PersonStatus = "active" | "inactive";
export type PersonDocumentStatus = "valid" | "expired" | "pending";

export interface PersonDocumentSummaryItem {
  requirement_id: string | null;
  document_name: string;
  status: PersonDocumentStatus;
  document_id: string | null;
  expiry_date: string | null;
}

export interface PersonIdentityDocument {
  id?: string;
  document_type: string;
  document_number: string;
  is_primary?: boolean;
}

export interface Person {
  id: string;
  workspace_id: string | null;
  type: PersonType;
  full_name: string;
  /** Uma Pessoa pode ter mais de um documento de identidade (ex.: CNI + Passaporte). */
  id_documents: PersonIdentityDocument[];
  birth_date: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  department: string | null;
  location_id: string | null;
  location_name: string | null;
  system_access_user_id: string | null;
  tax_id: string | null;
  address: string | null;
  fiscal_data: Record<string, unknown> | null;
  source_invoice_document_id: string | null;
  status: PersonStatus;
  notes: string | null;
  documents_pending_count?: number;
  documents_summary?: PersonDocumentSummaryItem[];
  country_not_configured?: boolean;
  warning?: string;
  created_at: string;
  updated_at: string;
}

export type PersonInput = Partial<Omit<Person, "id" | "created_at" | "updated_at">> & {
  type: PersonType;
  full_name: string;
};

export interface PersonDocument {
  id: string;
  name: string;
  display_name: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  issue_date: string | null;
  expiry_date: string | null;
  country_requirement_id: string | null;
  status: "valid" | "expired";
  uploaded_by: string | null;
  created_at: string;
}

const QK = ["people"] as const;

export function usePeople(filters: { type?: PersonType; status?: PersonStatus; location_id?: string; search?: string } = {}) {
  const qc = useQueryClient();
  const queryKey = [...QK, filters];

  const query = useQuery({
    queryKey,
    staleTime: 15_000,
    queryFn: () => {
      const params = new URLSearchParams();
      if (filters.type) params.set("type", filters.type);
      if (filters.status) params.set("status", filters.status);
      if (filters.location_id) params.set("location_id", filters.location_id);
      if (filters.search) params.set("search", filters.search);
      const qs = params.toString();
      return apiRequest<Person[]>(`/people${qs ? `?${qs}` : ""}`, { timeoutMs: 10000 });
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: QK });

  const create = useMutation({
    mutationFn: (input: PersonInput) =>
      apiRequest<Person>("/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        timeoutMs: 10000,
      }),
    onSuccess: (person) => {
      if (!person?.id) {
        toast({ title: "Erro ao criar Pessoa", description: "Resposta inválida do servidor.", variant: "destructive" });
        return;
      }
      invalidate();
      if (person.warning === "tax_id_duplicate") {
        toast({ title: "Pessoa criada com aviso", description: "Já existe outro Prestador com este número de identificação fiscal.", variant: "destructive" });
      } else {
        toast({ title: "Pessoa criada com sucesso." });
      }
    },
    onError: (err) => toast({ title: "Erro ao criar Pessoa", description: String((err as any)?.message ?? err), variant: "destructive" }),
  });

  const update = useMutation({
    mutationFn: ({ id, ...input }: Partial<PersonInput> & { id: string }) =>
      apiRequest<Person>(`/people/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        timeoutMs: 10000,
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Pessoa atualizada." });
    },
    onError: (err) => toast({ title: "Erro ao atualizar Pessoa", description: String((err as any)?.message ?? err), variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiRequest(`/people/${id}`, { method: "DELETE", timeoutMs: 10000 }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Pessoa excluída." });
    },
    onError: (err) => toast({ title: "Erro ao excluir Pessoa", description: String((err as any)?.message ?? err), variant: "destructive" }),
  });

  return { ...query, people: query.data ?? [], create, update, remove };
}

export function usePerson(id: string | null) {
  return useQuery({
    queryKey: ["people", "detail", id],
    enabled: !!id,
    staleTime: 10_000,
    queryFn: () => apiRequest<Person>(`/people/${id}`, { timeoutMs: 10000 }),
  });
}

export function usePersonDocuments(personId: string | null) {
  const qc = useQueryClient();
  const queryKey = ["people", personId, "documents"];

  const query = useQuery({
    queryKey,
    enabled: !!personId,
    staleTime: 10_000,
    queryFn: () => apiRequest<PersonDocument[]>(`/people/${personId}/documents`, { timeoutMs: 10000 }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ["people", "detail", personId] });
    qc.invalidateQueries({ queryKey: QK });
  };

  const addDocument = useMutation({
    mutationFn: (input: {
      name: string;
      storage_path: string;
      mime_type?: string;
      size_bytes?: number;
      issue_date?: string;
      expiry_date?: string;
      country_requirement_id?: string;
    }) =>
      apiRequest<PersonDocument>(`/people/${personId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        timeoutMs: 15000,
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Documento anexado." });
    },
    onError: (err) => toast({ title: "Erro ao anexar documento", description: String((err as any)?.message ?? err), variant: "destructive" }),
  });

  const removeDocument = useMutation({
    mutationFn: (documentId: string) =>
      apiRequest(`/people/${personId}/documents/${documentId}`, { method: "DELETE", timeoutMs: 10000 }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Documento removido." });
    },
    onError: (err) => toast({ title: "Erro ao remover documento", description: String((err as any)?.message ?? err), variant: "destructive" }),
  });

  return { ...query, documents: query.data ?? [], addDocument, removeDocument };
}
