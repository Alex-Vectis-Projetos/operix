export const PERSON_TYPES = [
  "technician",
  "dismantler",
  "painter",
  "polisher",
  "appraiser",
  "driver",
  "operations_manager",
  "sales",
  "administrative",
  "provider_operational",
  "provider_administrative",
] as const;

export type PersonType = (typeof PERSON_TYPES)[number];

export function isPersonType(value: unknown): value is PersonType {
  return typeof value === "string" && (PERSON_TYPES as readonly string[]).includes(value);
}

/** Tipos operacionais de pátio que exigem vínculo obrigatório a um Local e compliance documental. */
export const TYPES_REQUIRING_LOCATION: PersonType[] = [
  "technician",
  "dismantler",
  "painter",
  "polisher",
  "appraiser",
  "driver",
  "provider_operational",
];

export interface IdentityDocumentInput {
  document_type?: unknown;
  document_number?: unknown;
}

function isValidIdentityDocument(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return false;
  const d = doc as IdentityDocumentInput;
  return String(d.document_type ?? "").trim().length > 0 && String(d.document_number ?? "").trim().length > 0;
}

interface ValidationInput {
  type: PersonType;
  full_name?: unknown;
  /** Uma Pessoa pode ter mais de um documento de identidade (ex.: CNI + Passaporte). */
  id_documents?: unknown;
  email?: unknown;
  location_id?: unknown;
  tax_id?: unknown;
  address?: unknown;
}

/**
 * Valida campos obrigatórios de uma Pessoa conforme seu tipo.
 * Retorna lista de labels de campos faltantes (vazia se válido).
 */
export function findMissingPersonFields(input: ValidationInput): string[] {
  const missing: string[] = [];
  const has = (v: unknown) => String(v ?? "").trim().length > 0;
  const hasAtLeastOneIdentityDocument = () =>
    Array.isArray(input.id_documents) && input.id_documents.some(isValidIdentityDocument);

  if (!has(input.full_name)) missing.push("Nome completo");

  if (TYPES_REQUIRING_LOCATION.includes(input.type)) {
    // Papéis operacionais de campo/pátio (local vinculado é opcional)
    if (!hasAtLeastOneIdentityDocument()) missing.push("Documento de identidade");
    if (!has(input.email)) missing.push("E-mail");
  } else if (input.type === "provider_administrative") {
    // Prestador PJ externo de apoio
    if (!has(input.tax_id)) missing.push("Número de identificação fiscal");
    if (!has(input.address)) missing.push("Endereço");
  } else {
    // Administrativo, Comercial, Gestão Operacional em nível corporativo
    if (!hasAtLeastOneIdentityDocument()) missing.push("Documento de identidade");
    if (!has(input.email)) missing.push("E-mail");
  }

  return missing;
}
