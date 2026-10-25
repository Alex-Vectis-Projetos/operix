export type PersonDocumentStatus = "valid" | "expired" | "pending";

export interface DocumentLike {
  expiryDate?: Date | string | null;
}

/**
 * Status de um documento já anexado (nunca "pending" aqui — documento sem
 * anexo é tratado à parte, cruzando com CountryDocumentRequirement).
 * Sem expiryDate = documento sem prazo de expiração aplicável (FR-010, edge case).
 */
export function computeDocumentStatus(document: DocumentLike, today: Date = new Date()): "valid" | "expired" {
  if (!document.expiryDate) return "valid";
  const expiry = new Date(document.expiryDate);
  return expiry.getTime() < today.getTime() ? "expired" : "valid";
}

export interface CountryRequirementLike {
  id: string;
  documentName: string;
  templateStoragePath?: string | null;
  templateFileName?: string | null;
}

export interface PersonDocumentSummaryItem {
  requirement_id: string | null;
  document_name: string;
  status: PersonDocumentStatus;
  document_id: string | null;
  expiry_date: string | null;
  template_storage_path?: string | null;
  template_file_name?: string | null;
}

/**
 * Cruza a lista de documentos obrigatórios do país do Local com os documentos
 * já anexados à Pessoa (FR-011). Requisito sem documento correspondente ->
 * "pending". Documento sem countryRequirementId correspondente (anexo avulso,
 * fora da checklist) não aparece aqui — é listado separadamente pelo caller.
 */
export function buildPersonDocumentSummary<D extends DocumentLike & { id: string; countryRequirementId?: string | null }>(
  requirements: CountryRequirementLike[],
  documents: D[],
  today: Date = new Date()
): PersonDocumentSummaryItem[] {
  return requirements.map((req) => {
    const doc = documents.find((d) => d.countryRequirementId === req.id);
    if (!doc) {
      return {
        requirement_id: req.id,
        document_name: req.documentName,
        status: "pending" as const,
        document_id: null,
        expiry_date: null,
        template_storage_path: req.templateStoragePath ?? null,
        template_file_name: req.templateFileName ?? null,
      };
    }
    return {
      requirement_id: req.id,
      document_name: req.documentName,
      status: computeDocumentStatus(doc, today),
      document_id: doc.id,
      expiry_date: doc.expiryDate ? new Date(doc.expiryDate).toISOString() : null,
      template_storage_path: req.templateStoragePath ?? null,
      template_file_name: req.templateFileName ?? null,
    };
  });
}
