import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Paperclip, Trash2, Upload, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import { usePersonDocuments } from "@/hooks/usePeople";
import type { PersonDocumentSummaryItem } from "@/hooks/usePeople";
import { uploadFile, getFileUrl, openSecureStorageFile } from "@/lib/storage";
import { toast } from "@/hooks/use-toast";

const BUCKET = "uploads";

function StatusBadge({ status }: { status: "valid" | "expired" | "pending" }) {
  if (status === "valid") {
    return <Badge className="bg-green-600 hover:bg-green-600"><CheckCircle2 className="mr-1 h-3 w-3" /> Válido</Badge>;
  }
  if (status === "expired") {
    return <Badge variant="destructive"><AlertTriangle className="mr-1 h-3 w-3" /> Vencido</Badge>;
  }
  return <Badge variant="secondary"><Clock className="mr-1 h-3 w-3" /> Pendente</Badge>;
}

interface PersonDocumentsPanelProps {
  personId: string;
  /** Checklist de documentos obrigatórios do país do Local (FR-011), já cruzada com os anexos. */
  documentsSummary: PersonDocumentSummaryItem[];
  countryNotConfigured?: boolean;
}

export function PersonDocumentsPanel({ personId, documentsSummary, countryNotConfigured }: PersonDocumentsPanelProps) {
  const { documents, addDocument, removeDocument } = usePersonDocuments(personId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingRequirementId, setPendingRequirementId] = useState<string | null>(null);
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [uploading, setUploading] = useState(false);

  function triggerUploadFor(requirementId: string | null) {
    setPendingRequirementId(requirementId);
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const path = `people/${personId}/${Date.now()}-${file.name}`;
      const { path: storedPath } = await uploadFile(BUCKET, path, file, file.type);
      await addDocument.mutateAsync({
        name: file.name,
        storage_path: storedPath,
        mime_type: file.type,
        size_bytes: file.size,
        issue_date: issueDate || undefined,
        expiry_date: expiryDate || undefined,
        country_requirement_id: pendingRequirementId ?? undefined,
      });
      setIssueDate("");
      setExpiryDate("");
    } catch (err) {
      toast({ title: "Erro ao enviar arquivo", description: String((err as any)?.message ?? err), variant: "destructive" });
    } finally {
      setUploading(false);
      setPendingRequirementId(null);
    }
  }

  return (
    <div className="space-y-4">
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileSelected} />

      {countryNotConfigured && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
          Não há lista de documentos configurada para o país deste Local. O cadastro não é bloqueado, mas nenhuma
          pendência será calculada automaticamente até a configuração ser feita em "Documentos por País".
        </div>
      )}

      {documentsSummary.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Documentos obrigatórios</Label>
          <div className="space-y-2">
            {documentsSummary.map((item) => (
              <div key={item.requirement_id} className="flex items-center justify-between rounded-md border p-2.5">
                <div className="flex items-center gap-2">
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{item.document_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={item.status} />
                  {item.status === "pending" && (
                    <Button size="sm" variant="outline" disabled={uploading} onClick={() => triggerUploadFor(item.requirement_id)}>
                      {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Todos os documentos anexados</Label>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Emissão</Label>
              <Input type="date" className="h-8 w-[140px]" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground">Validade</Label>
              <Input type="date" className="h-8 w-[140px]" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} />
            </div>
            <Button size="sm" disabled={uploading} onClick={() => triggerUploadFor(null)}>
              {uploading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
              Anexar documento
            </Button>
          </div>
        </div>

        {documents.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Nenhum documento anexado ainda.</p>
        ) : (
          <div className="space-y-1.5">
            {documents.map((doc) => (
              <div key={doc.id} className="flex items-center justify-between rounded-md border p-2.5">
                <a
                  href={getFileUrl(BUCKET, doc.storage_path ?? "")}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    e.preventDefault();
                    void openSecureStorageFile(BUCKET, doc.storage_path ?? "", doc.name);
                  }}
                  className="flex items-center gap-2 text-sm hover:underline cursor-pointer text-foreground"
                >
                  <Paperclip className="h-4 w-4 text-muted-foreground" />
                  {doc.name}
                </a>
                <div className="flex items-center gap-2">
                  <StatusBadge status={doc.status} />
                  <Button size="icon" variant="ghost" onClick={() => removeDocument.mutate(doc.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
