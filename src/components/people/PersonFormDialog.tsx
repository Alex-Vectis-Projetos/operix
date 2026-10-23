import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, UploadCloud, Sparkles } from "lucide-react";
import { apiRequest } from "@/lib/api";
import { fileToBase64, pdfFirstPageToImageBase64 } from "@/lib/pdfUtils";
import { toast } from "@/hooks/use-toast";
import { useLocations } from "@/hooks/useLocations";
import { useAssignableUsers } from "@/hooks/useAssignableUsers";
import type { Person, PersonIdentityDocument, PersonInput, PersonType } from "@/hooks/usePeople";
import { PersonDocumentsPanel } from "@/components/people/PersonDocumentsPanel";

const TYPE_OPTIONS: { value: PersonType; label: string }[] = [
  { value: "technician", label: "Técnico DSP / Martelinho de Ouro" },
  { value: "dismantler", label: "Montador / Desmontador" },
  { value: "painter", label: "Pintor / Funileiro" },
  { value: "polisher", label: "Polidor / Acabador" },
  { value: "appraiser", label: "Perito / Avaliador / Orçamentista" },
  { value: "driver", label: "Motorista / Logística" },
  { value: "operations_manager", label: "Gestor Operacional / Coordenador" },
  { value: "sales", label: "Comercial / Vendas" },
  { value: "administrative", label: "Administrativo" },
  { value: "provider_operational", label: "Prestador de Serviços — Operacional" },
  { value: "provider_administrative", label: "Prestador de Serviços — Administrativo" },
];

const EMPTY_IDENTITY_DOCUMENT: PersonIdentityDocument = { document_type: "", document_number: "" };

const EMPTY_FORM: PersonInput = {
  type: "administrative",
  full_name: "",
  id_documents: [{ ...EMPTY_IDENTITY_DOCUMENT }],
  birth_date: "",
  email: "",
  phone: "",
  role: "",
  department: "",
  location_id: "",
  system_access_user_id: "",
  tax_id: "",
  address: "",
  notes: "",
  status: "active",
};

interface PersonFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Person | null;
  defaultType?: PersonType;
  onSubmit: (input: PersonInput) => Promise<Person>;
  saving: boolean;
}

export function PersonFormDialog({ open, onOpenChange, editing, defaultType, onSubmit, saving }: PersonFormDialogProps) {
  const [form, setForm] = useState<PersonInput>(EMPTY_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  const [savedPerson, setSavedPerson] = useState<Person | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractingIdDoc, setExtractingIdDoc] = useState(false);

  const { locations } = useLocations({ status: "active" });
  const { data: assignableUsers } = useAssignableUsers();

  useEffect(() => {
    if (open) {
      setForm(
        editing
          ? {
              type: editing.type,
              full_name: editing.full_name,
              id_documents: editing.id_documents.length > 0 ? editing.id_documents : [{ ...EMPTY_IDENTITY_DOCUMENT }],
              birth_date: editing.birth_date ? editing.birth_date.slice(0, 10) : "",
              email: editing.email ?? "",
              phone: editing.phone ?? "",
              role: editing.role ?? "",
              department: editing.department ?? "",
              location_id: editing.location_id ?? "",
              system_access_user_id: editing.system_access_user_id ?? "",
              tax_id: editing.tax_id ?? "",
              address: editing.address ?? "",
              notes: editing.notes ?? "",
              status: editing.status,
            }
          : { ...EMPTY_FORM, id_documents: [{ ...EMPTY_IDENTITY_DOCUMENT }], type: defaultType ?? "administrative" }
      );
      setSavedPerson(editing);
      setErrors([]);
    }
  }, [open, editing, defaultType]);

  const set = <K extends keyof PersonInput>(field: K) => (value: PersonInput[K]) =>
    setForm((f) => ({ ...f, [field]: value }));

  const identityDocuments = form.id_documents ?? [];
  function updateIdentityDocument(index: number, patch: Partial<PersonIdentityDocument>) {
    setForm((f) => ({
      ...f,
      id_documents: (f.id_documents ?? []).map((d, i) => (i === index ? { ...d, ...patch } : d)),
    }));
  }
  function addIdentityDocument() {
    setForm((f) => ({ ...f, id_documents: [...(f.id_documents ?? []), { ...EMPTY_IDENTITY_DOCUMENT }] }));
  }
  function removeIdentityDocument(index: number) {
    setForm((f) => ({ ...f, id_documents: (f.id_documents ?? []).filter((_, i) => i !== index) }));
  }

  const requiresLocation = [
    "technician",
    "dismantler",
    "painter",
    "polisher",
    "appraiser",
    "driver",
    "provider_operational",
  ].includes(form.type);
  const isProviderAdmin = form.type === "provider_administrative";
  const isCorporate = ["administrative", "operations_manager", "sales"].includes(form.type);

  function validate(): boolean {
    const missing: string[] = [];
    if (!form.full_name.trim()) missing.push("Nome completo");
    if (isProviderAdmin) {
      if (!form.tax_id?.trim()) missing.push("Número de identificação fiscal");
      if (!form.address?.trim()) missing.push("Endereço");
    } else {
      const hasValidDocument = identityDocuments.some((d) => d.document_type.trim() && d.document_number.trim());
      if (!hasValidDocument) missing.push("Documento de identidade");
      if (!form.email?.trim()) missing.push("E-mail");
    }
    setErrors(missing);
    return missing.length === 0;
  }

  async function handleSubmit() {
    if (!validate()) return;
    const payload: PersonInput = {
      ...form,
      id_documents: identityDocuments.filter((d) => d.document_type.trim() && d.document_number.trim()),
    };
    try {
      const person = await onSubmit(payload);
      if (person?.id) {
        setSavedPerson(person);
        onOpenChange(false);
      }
    } catch {
      // Handled by mutation onError toast
    }
  }

  async function handleExtractInvoice(file: File) {
    setExtracting(true);
    try {
      let base64: string;
      let mimeType: string;
      if (file.type === "application/pdf") {
        const r = await pdfFirstPageToImageBase64(file, { maxWidth: 1600 });
        base64 = r.base64;
        mimeType = r.mimeType;
      } else {
        base64 = await fileToBase64(file);
        mimeType = file.type;
      }
      const data = await apiRequest<any>("/extract/invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64, mimeType, fileName: file.name }),
        timeoutMs: 20000,
      });
      setForm((f) => ({
        ...f,
        full_name: data?.supplier_name || f.full_name,
        tax_id: data?.supplier_tax_id || f.tax_id,
      }));
      toast({ title: "Dados extraídos da Nota Fiscal.", description: "Confira e complete o endereço/dados fiscais antes de salvar." });
    } catch (err) {
      toast({ title: "Erro ao extrair Nota Fiscal", description: String((err as any)?.message ?? err), variant: "destructive" });
    } finally {
      setExtracting(false);
    }
  }

  async function handleExtractIdentityDocument(file: File) {
    setExtractingIdDoc(true);
    try {
      let base64: string;
      let mimeType: string;
      if (file.type === "application/pdf") {
        const r = await pdfFirstPageToImageBase64(file, { maxWidth: 1600 });
        base64 = r.base64;
        mimeType = r.mimeType;
      } else {
        base64 = await fileToBase64(file);
        mimeType = file.type || "image/jpeg";
      }
      const data = await apiRequest<{
        full_name?: string;
        document_type?: string;
        document_number?: string;
        birth_date?: string;
        tax_id?: string;
      }>("/extract/identity-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64, mimeType, fileName: file.name }),
        timeoutMs: 25000,
      });

      if (!data) {
        throw new Error("Não foi possível identificar informações legíveis no documento.");
      }

      setForm((f) => {
        const updated = { ...f };
        if (data.full_name) {
          updated.full_name = data.full_name;
        }
        if (data.birth_date) {
          updated.birth_date = data.birth_date.slice(0, 10);
        }
        if (data.tax_id && !f.tax_id) {
          updated.tax_id = data.tax_id;
        }

        if (data.document_number) {
          const docType = data.document_type || "Documento";
          const docNum = data.document_number;
          const currentDocs = [...(f.id_documents ?? [])];
          if (currentDocs.length === 1 && !currentDocs[0].document_type && !currentDocs[0].document_number) {
            currentDocs[0] = { document_type: docType, document_number: docNum };
          } else {
            const alreadyExists = currentDocs.some((d) => d.document_number === docNum);
            if (!alreadyExists) {
              currentDocs.push({ document_type: docType, document_number: docNum });
            }
          }
          updated.id_documents = currentDocs;
        }

        return updated;
      });

      toast({
        title: "Documento lido com sucesso!",
        description: `Dados de ${data.full_name ?? "identificação"} extraídos e preenchidos no formulário.`,
      });
    } catch (err) {
      toast({
        title: "Erro ao ler documento",
        description: String((err as any)?.message ?? err),
        variant: "destructive",
      });
    } finally {
      setExtractingIdDoc(false);
    }
  }

  const activeLocations = useMemo(() => locations.filter((l) => l.status === "active"), [locations]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar Pessoa" : "Nova Pessoa"}</DialogTitle>
        </DialogHeader>

        {errors.length > 0 && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Campos obrigatórios pendentes: {errors.join(", ")}.
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tipo *</Label>
            <Select value={form.type} onValueChange={(v) => set("type")(v as PersonType)} disabled={!!editing}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isProviderAdmin && (
            <div className="rounded-md border border-dashed p-3 space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Extrair a partir da Nota Fiscal</Label>
              <Input
                type="file"
                accept="image/*,application/pdf"
                disabled={extracting}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleExtractInvoice(file);
                  e.target.value = "";
                }}
              />
              {extracting && <p className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Extraindo dados...</p>}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label>{isProviderAdmin ? "Nome / Razão social *" : "Nome completo *"}</Label>
              <Input value={form.full_name} onChange={(e) => set("full_name")(e.target.value)} />
            </div>

            {!isProviderAdmin && (
              <>
                <div className="col-span-2 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <Label>Documentos de identidade *</Label>
                      <p className="text-xs text-muted-foreground">Adicione manualmente ou faça o upload para leitura inteligente.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="gap-1.5"
                        disabled={extractingIdDoc}
                        onClick={() => document.getElementById("person-id-doc-upload")?.click()}
                      >
                        {extractingIdDoc ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Lendo documento...
                          </>
                        ) : (
                          <>
                            <Sparkles className="h-3.5 w-3.5 text-primary" /> Ler Documento (OCR)
                          </>
                        )}
                      </Button>
                      <input
                        id="person-id-doc-upload"
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        disabled={extractingIdDoc}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleExtractIdentityDocument(file);
                          e.target.value = "";
                        }}
                      />
                      <Button type="button" size="sm" variant="outline" onClick={addIdentityDocument}>
                        <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar
                      </Button>
                    </div>
                  </div>

                  {extractingIdDoc && (
                    <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs text-primary flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                      <span>A inteligência artificial está analisando o documento para preencher nome, tipo, número e data de nascimento...</span>
                    </div>
                  )}

                  <div className="space-y-2">
                    {identityDocuments.map((doc, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input
                          className="flex-1"
                          placeholder="Tipo (CNI, Passaporte, RG, CNH...)"
                          value={doc.document_type}
                          onChange={(e) => updateIdentityDocument(index, { document_type: e.target.value })}
                        />
                        <Input
                          className="flex-1"
                          placeholder="Número do documento"
                          value={doc.document_number}
                          onChange={(e) => updateIdentityDocument(index, { document_number: e.target.value })}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          disabled={identityDocuments.length === 1}
                          onClick={() => removeIdentityDocument(index)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>E-mail *</Label>
                  <Input type="email" value={form.email ?? ""} onChange={(e) => set("email")(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Telefone / WhatsApp</Label>
                  <Input value={form.phone ?? ""} onChange={(e) => set("phone")(e.target.value)} />
                </div>
              </>
            )}

            {!isProviderAdmin && (
              <div className="space-y-1.5">
                <Label>Data de nascimento</Label>
                <Input type="date" value={form.birth_date ?? ""} onChange={(e) => set("birth_date")(e.target.value)} />
              </div>
            )}

            {isCorporate && (
              <>
                <div className="space-y-1.5">
                  <Label>Cargo / Função</Label>
                  <Input value={form.role ?? ""} onChange={(e) => set("role")(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Setor</Label>
                  <Input value={form.department ?? ""} onChange={(e) => set("department")(e.target.value)} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Acesso ao sistema (usuário)</Label>
                  <Select value={form.system_access_user_id ?? ""} onValueChange={(v) => set("system_access_user_id")(v)}>
                    <SelectTrigger><SelectValue placeholder="Nenhum" /></SelectTrigger>
                    <SelectContent>
                      {assignableUsers.map((u) => (
                        <SelectItem key={u.user_id} value={u.user_id}>{u.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {requiresLocation && (
              <>
                <div className="space-y-1.5">
                  <Label>Função / Especialidade</Label>
                  <Input value={form.role ?? ""} onChange={(e) => set("role")(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Local vinculado</Label>
                  <Select
                    value={form.location_id || "none"}
                    onValueChange={(v) => set("location_id")(v === "none" ? "" : v)}
                  >
                    <SelectTrigger><SelectValue placeholder="Selecione um Local ativo (opcional)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum / Sem local vinculado</SelectItem>
                      {activeLocations.map((l) => (
                        <SelectItem key={l.id} value={l.id}>{l.name} — {l.address_country}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {isProviderAdmin && (
              <>
                <div className="space-y-1.5">
                  <Label>Número de identificação fiscal *</Label>
                  <Input value={form.tax_id ?? ""} onChange={(e) => set("tax_id")(e.target.value)} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Endereço *</Label>
                  <Input value={form.address ?? ""} onChange={(e) => set("address")(e.target.value)} />
                </div>
              </>
            )}

            <div className="col-span-2 space-y-1.5">
              <Label>Informações complementares</Label>
              <Textarea value={form.notes ?? ""} onChange={(e) => set("notes")(e.target.value)} rows={2} />
            </div>

            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set("status")(v as "active" | "inactive")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {requiresLocation && savedPerson && (
            <div className="border-t pt-4 space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Documentos</Label>
              <PersonDocumentsPanel
                personId={savedPerson.id}
                documentsSummary={savedPerson.documents_summary ?? []}
                countryNotConfigured={savedPerson.country_not_configured}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? "Salvar" : "Criar Pessoa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
