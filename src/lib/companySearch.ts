import { apiRequest } from "@/lib/api";

export type ConfidenceLevel = "validated" | "partially_enriched" | "fully_enriched" | "unverified";

export type DocumentKind =
  | "siren" | "siret" | "vat_eu"
  | "cnpj" | "ein" | "gstin" | "bn_ca" | "rfc_mx" | "corp_jp"
  | "name" | "unknown";

export type CompanyQueryType = DocumentKind; // backward-compat alias

export interface NormalizedAddress {
  street: string | null;
  street_number: string | null;
  postal_code: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
}

export interface NormalizedCompany {
  country: string | null;
  tax_id: string | null;
  vat_number: string | null;
  company_name: string | null;
  legal_name: string | null;
  company_status: string | null;
  legal_form: string | null;
  creation_date: string | null;
  siren: string | null;
  siret: string | null;
  address: NormalizedAddress;
  address_line: string | null;
  provider: string;
  confidence: ConfidenceLevel;
}

export interface ProviderLog { provider: string; ms: number; ok: boolean; notes?: string }

export interface ClassificationCandidate {
  kind: DocumentKind; country: string | null; score: number; reasons: string[];
}

export interface ConfidenceBreakdown {
  format: number; provider: number; country: number; contextual: number;
  field_completeness: number; total: number; level: ConfidenceLevel; auto_apply: boolean;
}

export const AUTO_APPLY_THRESHOLD = 0.85;

export type SupportTier = "A" | "B" | "C" | "unknown";

export type ResolutionModel = "A" | "B" | "C" | "unknown";

export type LookupStatus =
  | "invalid_document" | "provider_unavailable" | "valid_no_enrichment"
  | "partial_enrichment" | "fully_enriched" | "no_match";

export interface CountryCapability {
  iso2: string;
  model: ResolutionModel;
  enrichment: "full" | "partial" | "none";
  validation: boolean;
  provider: "available" | "limited" | "manual";
  searchByName: boolean;
  searchByTaxId: boolean;
  notes?: string;
}

export interface LookupResponse {
  detected_kind: DocumentKind;
  detected_country: string | null;
  result: NormalizedCompany | null;
  candidates: NormalizedCompany[];
  vies: { valid: boolean; name?: string; address?: string } | null;
  logs: ProviderLog[];
  confidence: ConfidenceLevel;
  message: string;
  total_ms: number;
  provider_available: boolean;
  classification?: { detected_kind: DocumentKind; country: string | null; score: number; candidates: ClassificationCandidate[] };
  confidence_breakdown?: ConfidenceBreakdown;
  country_hint?: string;
  support_tier?: SupportTier;
  support_tier_label?: string;
  capability?: CountryCapability | null;
  lookup_status?: LookupStatus;
  lookup_status_label?: string;
}

export const TIER_LABEL: Record<SupportTier, string> = {
  A: "Enriquecimento completo",
  B: "Enriquecimento parcial",
  C: "Validação estrutural",
  unknown: "Suporte limitado",
};

// ── Identifier detection (mirror of edge core, used by UI hints) ──────────

export function detectQueryType(raw: string): DocumentKind {
  const v = (raw ?? "").trim();
  if (!v) return "unknown";
  const upper = v.toUpperCase();
  const digits = v.replace(/\D/g, "");

  if (/^[A-Z]{2}/.test(upper) && digits.length >= 7) return "vat_eu";
  if (/[\.\/-]/.test(v) && digits.length === 14) return "cnpj";
  if (/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(upper)) return "gstin";
  if (/^\d{2}-\d{7}$/.test(v)) return "ein";
  if (/^\d{9}\s?(RT|RC|RP)?\s?\d{0,4}$/i.test(v)) return "bn_ca";
  if (/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(upper)) return "rfc_mx";
  if (digits.length === 13 && digits === v.replace(/\s/g, "")) return "corp_jp";
  if (digits.length === 9 && digits === v.replace(/\s/g, "")) return "siren";
  if (digits.length === 14 && digits === v.replace(/\s/g, "")) return "siret";
  return "name";
}

// Validators / formatters retained for UI helpers
export function isValidSiren(v: string): boolean {
  const s = v.replace(/\D/g, ""); if (s.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) { let d = parseInt(s[i], 10); if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return sum % 10 === 0;
}
export function isValidSiret(v: string): boolean {
  const s = v.replace(/\D/g, ""); if (s.length !== 14) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) { let d = parseInt(s[i], 10); if (i % 2 === 0) { d *= 2; if (d > 9) d -= 9; } sum += d; }
  return sum % 10 === 0;
}
export function formatSiren(v: string): string { return v.replace(/\D/g, "").slice(0, 9).replace(/(\d{3})(\d{3})(\d{0,3})/, "$1 $2 $3").trim(); }
export function formatSiret(v: string): string { return v.replace(/\D/g, "").slice(0, 14).replace(/(\d{3})(\d{3})(\d{3})(\d{0,5})/, "$1 $2 $3 $4").trim(); }
export function formatVat(v: string): string { return v.replace(/\s/g, "").toUpperCase(); }

// ── Main API ───────────────────────────────────────────────────────────────

export async function lookupCompany(query: string, countryHint: string = "FR"): Promise<LookupResponse> {
  return await apiRequest<LookupResponse>("/company-lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, country_hint: countryHint }),
  });
}

export function debounce<T extends (...args: any[]) => any>(fn: T, ms = 400) {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Maps a normalized record onto the client form, never overwriting
// user-controlled fields (email, phone, IBAN, BIC, contacts).
export function mergeCompanyIntoForm<F extends Record<string, any>>(form: F, c: NormalizedCompany): F {
  const addr = c.address ?? ({} as NormalizedAddress);
  const flatAddress = [addr.street_number, addr.street].filter(Boolean).join(" ").trim()
    || c.address_line || form.address;
  return {
    ...form,
    name: c.company_name || c.legal_name || form.name,
    siren: c.siren || form.siren,
    siret: c.siret || form.siret,
    tva_intracom: c.vat_number || form.tva_intracom,
    tax_id: c.tax_id || form.tax_id,
    address: flatAddress,
    postal_code: addr.postal_code || form.postal_code,
    city: addr.city || form.city,
    country: addr.country || c.country || form.country,
    notes: appendImportNote(form.notes ?? "", c.provider, c.confidence),
  };
}

function appendImportNote(existing: string, provider: string, confidence: ConfidenceLevel): string {
  const stamp = new Date().toLocaleString("pt-PT");
  const note = `[${stamp}] Dados importados do registro empresarial (${provider}, confiança: ${confidence}).`;
  if (existing.includes("Dados importados")) return existing;
  return existing ? `${existing}\n${note}` : note;
}

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  fully_enriched: "Totalmente enriquecido",
  partially_enriched: "Parcialmente enriquecido",
  validated: "Documento validado",
  unverified: "Não verificado",
};

export const LOOKUP_STATUS_LABEL: Record<LookupStatus, string> = {
  invalid_document:     "Documento inválido",
  provider_unavailable: "Provedor indisponível",
  valid_no_enrichment:  "Documento válido — sem enriquecimento",
  partial_enrichment:   "Enriquecimento parcial",
  fully_enriched:       "Enriquecimento completo",
  no_match:             "Sem correspondência",
};
