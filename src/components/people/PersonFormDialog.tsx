import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, UploadCloud, Sparkles, CheckCircle2, Paperclip, Shield, KeyRound, Copy, Check, UserPlus, UserX } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import { UserPermissionsDialog } from "@/components/permissions/UserPermissionsDialog";
import { Badge } from "@/components/ui/badge";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api";
import { uploadFile } from "@/lib/storage";
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
  const qc = useQueryClient();
  const [form, setForm] = useState<PersonInput>(EMPTY_FORM);
  const [errors, setErrors] = useState<string[]>([]);
  const [savedPerson, setSavedPerson] = useState<Person | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractingIdDoc, setExtractingIdDoc] = useState(false);
  const [pendingOcrDoc, setPendingOcrDoc] = useState<{ file: File; expiration_date?: string } | null>(null);

  const { locations } = useLocations({ status: "active" });
  const { data: assignableUsers } = useAssignableUsers();
  const { workspaceId, members } = useWorkspace();
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [creatingAccess, setCreatingAccess] = useState(false);
  const [tempCredentials, setTempCredentials] = useState<{ email: string; tempPassword: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedRoleForAccess, setSelectedRoleForAccess] = useState<string>("technician");

  const linkedMember = useMemo(() => {
    if (!form.system_access_user_id || !members) return null;
    return members.find(
      (m) => m.auth_user_id === form.system_access_user_id || m.app_user_id === form.system_access_user_id
    );
  }, [form.system_access_user_id, members]);

  const handleCreateAccess = async () => {
    if (!form.email || !form.full_name) {
      toast({ title: "Nome e E-mail são obrigatórios para criar acesso.", variant: "destructive" });
      return;
    }
    if (!workspaceId) {
      toast({ title: "Workspace ativo não encontrado.", variant: "destructive" });
      return;
    }

    try {
      setCreatingAccess(true);
      const res = await apiRequest<{
        member: { membership_id: string; auth_user_id: string; email: string; name: string };
        temp_password: string;
      }>("/workspaces/" + workspaceId + "/members", {
        method: "POST",
        body: JSON.stringify({
          email: form.email,
          fullName: form.full_name,
          role: selectedRoleForAccess,
        }),
      });

      set("system_access_user_id")(res.member.auth_user_id);
      setTempCredentials({
        email: res.member.email,
        tempPassword: res.temp_password,
      });
      qc.invalidateQueries({ queryKey: ["workspace-members", workspaceId] });
      toast({
        title: "Acesso criado com sucesso",
        description: "Login gerado para " + res.member.email,
      });
    } catch (err: any) {
      toast({
        title: "Erro ao criar acesso",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setCreatingAccess(false);
    }
  };

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
      setPendingOcrDoc(null);
      setTempCredentials(null);
      setPermissionsOpen(false);
      setErrors([]);
      const defaultRole = editing?.type === "administrative" || defaultType === "administrative"
        ? "admin"
        : (editing?.type === "operations_manager" || defaultType === "operations_manager" ? "partner" : "technician");
      setSelectedRoleForAccess(defaultRole);
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

        // Se houver documento pendente de OCR em novo colaborador, faz o upload e anexa agora
        if (pendingOcrDoc?.file) {
          try {
            const path = `people/${person.id}/${Date.now()}-${pendingOcrDoc.file.name}`;
            const { path: storedPath } = await uploadFile("uploads", path, pendingOcrDoc.file, pendingOcrDoc.file.type);
            await apiRequest(`/people/${person.id}/documents`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: pendingOcrDoc.file.name,
                storage_path: storedPath,
                mime_type: pendingOcrDoc.file.type,
                size_bytes: pendingOcrDoc.file.size,
                expiry_date: pendingOcrDoc.expiration_date || undefined,
              }),
              timeoutMs: 15000,
            });
            qc.invalidateQueries({ queryKey: ["people", person.id, "documents"] });
            qc.invalidateQueries({ queryKey: ["people"] });
            setPendingOcrDoc(null);
          } catch (uploadErr) {
            console.error("[attachPendingOcrDocument]", uploadErr);
          }
        }

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
        expiration_date?: string;
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

      const targetPersonId = savedPerson?.id ?? editing?.id;
      if (targetPersonId) {
        try {
          const path = `people/${targetPersonId}/${Date.now()}-${file.name}`;
          const { path: storedPath } = await uploadFile("uploads", path, file, file.type || "application/pdf");
          await apiRequest(`/people/${targetPersonId}/documents`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: file.name,
              storage_path: storedPath,
              mime_type: file.type || "application/pdf",
              size_bytes: file.size,
              expiry_date: data.expiration_date || undefined,
            }),
            timeoutMs: 15000,
          });
          qc.invalidateQueries({ queryKey: ["people", targetPersonId, "documents"] });
          qc.invalidateQueries({ queryKey: ["people", "detail", targetPersonId] });
          qc.invalidateQueries({ queryKey: ["people"] });

          toast({
            title: "Documento lido e anexado com sucesso!",
            description: `Dados de ${data.full_name ?? "identificação"} extraídos e documento anexado aos registros do colaborador.`,
          });
        } catch (uploadErr) {
          console.error("[attachOcrDocExistingPerson]", uploadErr);
          toast({
            title: "Documento lido, mas houve falha ao anexar arquivo",
            description: String((uploadErr as any)?.message ?? uploadErr),
            variant: "destructive",
          });
        }
      } else {
        setPendingOcrDoc({ file, expiration_date: data.expiration_date });
        toast({
          title: "Documento lido com sucesso!",
          description: `Dados de ${data.full_name ?? "identificação"} preenchidos. O arquivo será anexado automaticamente ao salvar o colaborador.`,
        });
      }
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
          <DialogTitle>{editing ? "Editar Colaborador" : "Novo Colaborador"}</DialogTitle>
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

                  {pendingOcrDoc && (
                    <div className="flex items-center justify-between rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-400">
                      <div className="flex items-center gap-2">
                        <Paperclip className="h-4 w-4 shrink-0" />
                        <span>Arquivo <strong>{pendingOcrDoc.file.name}</strong> pronto para ser anexado aos documentos ao salvar o colaborador.</span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-destructive hover:text-destructive"
                        onClick={() => setPendingOcrDoc(null)}
                      >
                        <Trash2 className="h-3 w-3 mr-1" /> Remover
                      </Button>
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
              </>
            )}

            {/* Seção Unificada: Acesso ao Sistema e Credenciais (Para todos os tipos) */}
            <div className="col-span-2 rounded-lg border border-border/80 bg-card/60 p-4 space-y-3.5">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <KeyRound className="h-4 w-4 text-primary" />
                  Acesso ao Sistema (Login)
                </Label>
                {linkedMember ? (
                  <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-500 border-emerald-500/20 font-medium">
                    Usuário Vinculado
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    Sem Acesso Direto
                  </Badge>
                )}
              </div>

              {linkedMember ? (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-md bg-muted/30 border border-border/50">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{linkedMember.name || linkedMember.email}</span>
                      <Badge variant="secondary" className="text-[10px] font-mono">
                        {linkedMember.role_label || linkedMember.role}
                      </Badge>
                      <Badge variant={linkedMember.status === "active" ? "default" : "secondary"} className="text-[10px]">
                        {linkedMember.status === "active" ? "Ativo" : "Inativo"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono">{linkedMember.email}</p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setPermissionsOpen(true)}
                      className="gap-1.5 h-8 text-xs border-primary/30 hover:bg-primary/10"
                    >
                      <Shield className="h-3.5 w-3.5 text-primary" />
                      Permissões
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => set("system_access_user_id")("")}
                      className="gap-1.5 h-8 text-xs text-muted-foreground hover:text-destructive"
                    >
                      <UserX className="h-3.5 w-3.5" />
                      Desvincular
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {tempCredentials ? (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4" /> Credenciais Criadas com Sucesso!
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            const credText = "Login: " + tempCredentials.email + "\nSenha temporaria: " + tempCredentials.tempPassword;
                            navigator.clipboard.writeText(credText);
                            setCopied(true);
                            setTimeout(() => setCopied(false), 2500);
                            toast({ title: "Copiado para a área de transferência" });
                          }}
                          className="h-7 text-xs gap-1 border-emerald-500/30"
                        >
                          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                          {copied ? "Copiado!" : "Copiar Acesso"}
                        </Button>
                      </div>
                      <div className="text-xs space-y-1 font-mono bg-background/80 p-2 rounded border border-emerald-500/20">
                        <p><span className="text-muted-foreground">E-mail:</span> {tempCredentials.email}</p>
                        <p><span className="text-muted-foreground">Senha:</span> <span className="font-bold text-foreground">{tempCredentials.tempPassword}</span></p>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Informe estas credenciais ao colaborador para o primeiro login no sistema ou app.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                      {/* Opção A: Criar Login Imediato */}
                      <div className="p-3 rounded-md border border-border/60 bg-muted/20 space-y-2.5">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <UserPlus className="h-3.5 w-3.5 text-primary" /> Criar Novo Acesso
                        </span>
                        <div className="space-y-1.5">
                          <Label className="text-[11px] text-muted-foreground">Papel no Workspace</Label>
                          <Select value={selectedRoleForAccess} onValueChange={setSelectedRoleForAccess}>
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="technician">Técnico / Operacional</SelectItem>
                              <SelectItem value="partner">Parceiro / Gestor</SelectItem>
                              <SelectItem value="admin">Administrador</SelectItem>
                              <SelectItem value="client">Cliente</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={handleCreateAccess}
                          disabled={creatingAccess || !form.email || !form.full_name}
                          className="w-full h-8 text-xs gap-1.5"
                        >
                          {creatingAccess ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                          Gerar Credenciais
                        </Button>
                        {(!form.email || !form.full_name) && (
                          <p className="text-[10px] text-muted-foreground">
                            * Preencha o Nome e o E-mail acima para gerar credenciais.
                          </p>
                        )}
                      </div>

                      {/* Opção B: Vincular Usuário Existente */}
                      <div className="p-3 rounded-md border border-border/60 bg-muted/20 space-y-2.5">
                        <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                          <Paperclip className="h-3.5 w-3.5 text-muted-foreground" /> Vincular Conta Existente
                        </span>
                        <div className="space-y-1.5">
                          <Label className="text-[11px] text-muted-foreground">Selecionar Usuário</Label>
                          <Select
                            value={form.system_access_user_id || "none"}
                            onValueChange={(v) => set("system_access_user_id")(v === "none" ? "" : v)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Selecione um usuário..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Nenhum / Desvinculado</SelectItem>
                              {assignableUsers.map((u) => (
                                <SelectItem key={u.user_id} value={u.user_id}>
                                  {u.name} ({u.email || "Sem e-mail"})
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          Vincula este colaborador a uma conta de usuário já registrada.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

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
            {editing ? "Salvar" : "Criar Colaborador"}
          </Button>
        </DialogFooter>
      </DialogContent>

      {permissionsOpen && (
        <UserPermissionsDialog
          open={permissionsOpen}
          onOpenChange={setPermissionsOpen}
          userId={form.system_access_user_id}
          membershipId={linkedMember?.membership_id}
          userName={form.full_name}
          userRole={linkedMember?.role}
        />
      )}
    </Dialog>
  );
}
