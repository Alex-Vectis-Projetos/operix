// backend/src/services/companyLookupService.ts
// Canonical company identification and enrichment service for Operix.
// Replaces deprecated edge function with native Node/Express architecture.

export type ConfidenceLevel =
  | "validated"
  | "partially_enriched"
  | "fully_enriched"
  | "unverified";

export type DocumentKind =
  | "siren" | "siret" | "vat_eu"
  | "cnpj" | "nif_pt" | "cif_es" | "ein" | "gstin" | "bn_ca" | "rfc_mx" | "corp_jp"
  | "name" | "unknown";

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

export interface ProviderLog {
  provider: string;
  ms: number;
  ok: boolean;
  notes?: string;
}

export type SupportTier = "A" | "B" | "C" | "unknown";

export type LookupStatus =
  | "invalid_document"
  | "provider_unavailable"
  | "valid_no_enrichment"
  | "partial_enrichment"
  | "fully_enriched"
  | "no_match";

export interface CountryCapability {
  iso2: string;
  model: "A" | "B" | "C" | "unknown";
  enrichment: "full" | "partial" | "none";
  validation: boolean;
  provider: "available" | "limited" | "manual";
  searchByName: boolean;
  searchByTaxId: boolean;
  notes?: string;
}

export interface ConfidenceBreakdown {
  format: number;
  provider: number;
  country: number;
  contextual: number;
  field_completeness: number;
  total: number;
  level: ConfidenceLevel;
  auto_apply: boolean;
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
  classification?: { detected_kind: DocumentKind; country: string | null; score: number };
  confidence_breakdown?: ConfidenceBreakdown;
  country_hint?: string;
  support_tier?: SupportTier;
  support_tier_label?: string;
  capability?: CountryCapability | null;
  lookup_status?: LookupStatus;
  lookup_status_label?: string;
}

const TIER_LABEL_PT: Record<SupportTier, string> = {
  A: "Tier A - Enriquecimento completo",
  B: "Tier B - Enriquecimento parcial",
  C: "Tier C - Validação estrutural",
  unknown: "Suporte limitado",
};

const LOOKUP_STATUS_LABEL_PT: Record<LookupStatus, string> = {
  invalid_document: "Documento inválido",
  provider_unavailable: "Provedor indisponível",
  valid_no_enrichment: "Documento válido — sem enriquecimento",
  partial_enrichment: "Enriquecimento parcial",
  fully_enriched: "Totalmente enriquecido",
  no_match: "Sem correspondência",
};

export const AUTO_APPLY_THRESHOLD = 0.85;

// Luhn validation for 9-digit SIREN
export function isValidSiren(v: string): boolean {
  const s = v.replace(/\D/g, "");
  if (s.length !== 9) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = parseInt(s[i], 10);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// Luhn validation for 14-digit SIRET
export function isValidSiret(v: string): boolean {
  const s = v.replace(/\D/g, "");
  if (s.length !== 14) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let d = parseInt(s[i], 10);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function isValidCnpj(v: string): boolean {
  const s = v.replace(/\D/g, "");
  if (s.length !== 14 || /^(\d)\1+$/.test(s)) return false;
  const calc = (base: string) => {
    const w = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += parseInt(base[i], 10) * w[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(s.slice(0, 12));
  const d2 = calc(s.slice(0, 12) + d1);
  return d1 === parseInt(s[12], 10) && d2 === parseInt(s[13], 10);
}

// French VAT formula from SIREN
export function vatFromSiren(siren: string): string {
  try {
    const n = BigInt(siren);
    const key = Number((12n + 3n * (n % 97n)) % 97n);
    return `FR${key.toString().padStart(2, "0")}${siren}`;
  } catch {
    return "";
  }
}

export function joinAddress(a: NormalizedAddress): string | null {
  const line1 = [a.street_number, a.street].filter(Boolean).join(" ");
  const line2 = [a.postal_code, a.city].filter(Boolean).join(" ");
  const tail = [a.state, a.country].filter(Boolean).join(", ");
  const full = [line1, line2, tail].filter(Boolean).join(", ");
  return full || null;
}

export function emptyCompany(provider: string): NormalizedCompany {
  return {
    country: null,
    tax_id: null,
    vat_number: null,
    company_name: null,
    legal_name: null,
    company_status: null,
    legal_form: null,
    creation_date: null,
    siren: null,
    siret: null,
    address: { street: null, street_number: null, postal_code: null, city: null, state: null, country: null },
    address_line: null,
    provider,
    confidence: "unverified",
  };
}

async function fetchWithTimeout(url: string, init?: RequestInit, ms = 7000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const defaultHeaders = {
    "User-Agent": "Operix/1.0 (Business Identification; +https://operix-pro.com)",
    "Accept": "application/json",
  };
  try {
    return await fetch(url, {
      ...init,
      headers: { ...defaultHeaders, ...(init?.headers || {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function formatCnpj(v: string): string {
  const s = v.replace(/\D/g, "").slice(0, 14);
  if (s.length !== 14) return v;
  return s.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

export const EU_COUNTRY_CODES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES",
  "FI", "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV",
  "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "XI"
]);

export const EU_COUNTRY_NAMES: Record<string, string> = {
  AT: "Áustria",
  BE: "Bélgica",
  BG: "Bulgária",
  CY: "Chipre",
  CZ: "Tchéquia",
  DE: "Alemanha",
  DK: "Dinamarca",
  EE: "Estônia",
  EL: "Grécia",
  GR: "Grécia",
  ES: "Espanha",
  FI: "Finlândia",
  FR: "França",
  HR: "Croácia",
  HU: "Hungria",
  IE: "Irlanda",
  IT: "Itália",
  LT: "Lituânia",
  LU: "Luxemburgo",
  LV: "Letônia",
  MT: "Malta",
  NL: "Países Baixos",
  PL: "Polônia",
  PT: "Portugal",
  RO: "Romênia",
  SE: "Suécia",
  SI: "Eslovênia",
  SK: "Eslováquia",
  XI: "Reino Unido (Irlanda do Norte)",
};

export function isValidPortugueseNif(v: string): boolean {
  const s = v.replace(/\D/g, "");
  if (s.length !== 9) return false;
  if (!["1", "2", "3", "5", "6", "8", "9"].includes(s[0])) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += parseInt(s[i], 10) * (9 - i);
  }
  const mod = sum % 11;
  const checkDigit = mod < 2 ? 0 : 11 - mod;
  return checkDigit === parseInt(s[8], 10);
}

export function formatPortugueseNif(v: string): string {
  const s = v.replace(/\D/g, "").slice(0, 9);
  if (s.length !== 9) return v;
  return s.replace(/^(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3");
}

export function isSpanishCif(v: string): boolean {
  const clean = v.replace(/[\s\.-]/g, "").toUpperCase();
  const s = clean.startsWith("ES") ? clean.slice(2) : clean;
  return /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(s);
}

export function parseViesAddress(raw: string | undefined | null, countryCode: string): NormalizedAddress {
  const countryName = EU_COUNTRY_NAMES[countryCode] || countryCode;
  if (!raw || raw.trim() === "---") {
    return { street: null, street_number: null, postal_code: null, city: null, state: null, country: countryName };
  }
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let street: string | null = null;
  let street_number: string | null = null;
  let postal_code: string | null = null;
  let city: string | null = null;

  if (countryCode === "PT") {
    if (lines.length > 0) {
      const line1 = lines[0];
      const numMatch = line1.match(/(?:(?:N|Nº|N\.|NUM|NÚMERO)\s*)?(\d+[\w\/-]*)$/i);
      if (numMatch) {
        street_number = numMatch[1];
        street = line1.slice(0, numMatch.index).replace(/(?:N|Nº|N\.|NUM|NÚMERO)\s*$/i, "").trim() || line1;
      } else {
        street = line1;
      }
    }
    for (let i = 1; i < lines.length; i++) {
      const cpMatch = lines[i].match(/(\d{4}-\d{3})(?:\s+(.+))?/);
      if (cpMatch) {
        postal_code = cpMatch[1];
        if (cpMatch[2]) city = cpMatch[2].trim();
      } else if (!city && i === 1) {
        city = lines[i];
      }
    }
    return { street, street_number, postal_code, city, state: null, country: countryName };
  }

  // Padrão Geral Europeu (FR, ES, DE, IT, etc.)
  for (const line of lines) {
    const cpMatch = line.match(/^(\d{4,5})\s+(.+)$/);
    if (cpMatch && !postal_code) {
      postal_code = cpMatch[1];
      city = cpMatch[2].trim();
      continue;
    }
    if (!street) {
      street = line;
    }
  }

  return { street, street_number, postal_code, city, state: null, country: countryName };
}

// Detection
export function detectDocument(raw: string): { kind: DocumentKind; country: string | null; score: number } {
  const v = (raw ?? "").trim();
  if (!v) return { kind: "unknown", country: null, score: 0 };
  const upper = v.toUpperCase();
  const digits = v.replace(/\D/g, "");
  const cleanAlpha = upper.replace(/[\s\.-]/g, "");

  // Portugal NIF explícito com PT (ex: PT500697256)
  if (/^PT\s*\d{9}$/i.test(cleanAlpha) || (cleanAlpha.startsWith("PT") && digits.length === 9)) {
    return { kind: "nif_pt", country: "PT", score: isValidPortugueseNif(digits) ? 1.0 : 0.85 };
  }

  // Spain CIF explícito (ex: ESB12345678)
  if (/^ES[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/i.test(cleanAlpha)) {
    return { kind: "cif_es", country: "ES", score: 0.95 };
  }
  if (isSpanishCif(cleanAlpha) && cleanAlpha.length === 9) {
    return { kind: "cif_es", country: "ES", score: 0.9 };
  }

  // EU VAT (ex: FR12345678901, DE123456789, IT12345678901, etc.)
  if (/^[A-Z]{2}[0-9A-Z]{2,13}$/.test(cleanAlpha)) {
    const cc = cleanAlpha.slice(0, 2);
    if (EU_COUNTRY_CODES.has(cc) && digits.length >= 7) {
      if (cc === "PT") return { kind: "nif_pt", country: "PT", score: 0.95 };
      if (cc === "ES") return { kind: "cif_es", country: "ES", score: 0.95 };
      return { kind: "vat_eu", country: cc, score: 0.95 };
    }
  }

  // Brazil CNPJ (14 dígitos com máscara ou 14 dígitos válidos no algoritmo módulo 11)
  if (digits.length === 14) {
    if (/[\.\/-]/.test(v) || isValidCnpj(digits)) {
      return { kind: "cnpj", country: "BR", score: isValidCnpj(digits) ? 1.0 : 0.75 };
    }
  }

  // Portugal NIF / France SIREN (9 dígitos puros)
  if (digits.length === 9 && digits === v.replace(/\s/g, "")) {
    // Se começar com 5, 6, 8, 9 e for válido no NIF PT, é pessoa coletiva em Portugal
    if (["5", "6", "8", "9"].includes(digits[0]) && isValidPortugueseNif(digits)) {
      return { kind: "nif_pt", country: "PT", score: 0.95 };
    }
    // SIREN francês com Luhn
    if (isValidSiren(digits)) {
      return { kind: "siren", country: "FR", score: 1.0 };
    }
    // Qualquer NIF PT com dígito verificador válido
    if (isValidPortugueseNif(digits)) {
      return { kind: "nif_pt", country: "PT", score: 0.9 };
    }
    return { kind: "siren", country: "FR", score: 0.8 };
  }

  // France SIRET (14 dígitos puros com algoritmo Luhn)
  if (digits.length === 14 && digits === v.replace(/\s/g, "")) {
    return { kind: "siret", country: "FR", score: isValidSiret(digits) ? 1.0 : 0.8 };
  }

  // US EIN (XX-XXXXXXX)
  if (/^\d{2}-\d{7}$/.test(v)) {
    return { kind: "ein", country: "US", score: 0.95 };
  }

  // India GSTIN
  if (/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(upper)) {
    return { kind: "gstin", country: "IN", score: 0.95 };
  }

  // Canada BN (Business Number)
  if (/^\d{9}\s?(RT|RC|RP)?\s?\d{0,4}$/i.test(v)) {
    return { kind: "bn_ca", country: "CA", score: 0.85 };
  }

  // Mexico RFC
  if (/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(upper)) {
    return { kind: "rfc_mx", country: "MX", score: 0.85 };
  }

  // Japan Corporate Number (13 dígitos)
  if (digits.length === 13 && digits === v.replace(/\s/g, "")) {
    return { kind: "corp_jp", country: "JP", score: 0.9 };
  }

  // Fallback to name search
  return { kind: "name", country: null, score: 0.5 };
}

function normalizeRechercheEntreprise(d: any, targetSiret?: string): NormalizedCompany {
  const c = emptyCompany("france-recherche-entreprises");
  const siege = d?.siege ?? {};
  const siren: string | null = d?.siren ?? null;

  // Se houver matching_etablissements e o usuário pesquisou um SIRET específico, usa a unidade correspondente
  let activeEtablissement = siege;
  if (Array.isArray(d?.matching_etablissements) && d.matching_etablissements.length > 0) {
    if (targetSiret) {
      const match = d.matching_etablissements.find((e: any) => e.siret === targetSiret);
      if (match) activeEtablissement = match;
      else activeEtablissement = d.matching_etablissements[0];
    } else {
      activeEtablissement = d.matching_etablissements[0];
    }
  }

  c.country = "FR";
  c.company_name = d?.nom_complet ?? d?.nom_raison_sociale ?? null;
  c.legal_name = d?.nom_raison_sociale ?? c.company_name;
  c.legal_form = d?.nature_juridique ?? null;
  c.creation_date = activeEtablissement?.date_creation ?? d?.date_creation ?? null;
  c.company_status = d?.etat_administratif === "A" ? "active" : d?.etat_administratif === "C" ? "ceased" : "unknown";
  c.siren = siren;
  c.siret = activeEtablissement?.siret ?? siege?.siret ?? null;
  c.tax_id = c.siren ?? c.siret;
  c.vat_number = (Array.isArray(d?.tva) && d.tva.length > 0) ? d.tva[0] : (siren ? vatFromSiren(siren) : null);

  const street = [activeEtablissement?.numero_voie, activeEtablissement?.type_voie, activeEtablissement?.libelle_voie].filter(Boolean).join(" ").trim()
    || activeEtablissement?.adresse
    || siege?.adresse
    || null;

  c.address = {
    street: street || null,
    street_number: activeEtablissement?.numero_voie ?? siege?.numero_voie ?? null,
    postal_code: activeEtablissement?.code_postal ?? siege?.code_postal ?? null,
    city: activeEtablissement?.libelle_commune ?? siege?.libelle_commune ?? null,
    state: activeEtablissement?.region ?? siege?.region ?? null,
    country: "France",
  };
  c.address_line = joinAddress(c.address);
  c.confidence = "fully_enriched";
  return c;
}

function fieldCompleteness(c: NormalizedCompany): number {
  const fields = [
    c.company_name, c.tax_id || c.siren || c.siret, c.vat_number,
    c.address?.street, c.address?.city, c.address?.postal_code, c.address?.country,
    c.legal_form, c.creation_date,
  ];
  const filled = fields.filter((x) => x != null && String(x).trim() !== "").length;
  return filled / fields.length;
}

export function scoreCompany(opts: {
  company: NormalizedCompany | null;
  formatScore: number;
  countryHint: string | null;
}): ConfidenceBreakdown {
  const { company, formatScore, countryHint } = opts;
  if (!company) {
    return {
      format: formatScore,
      provider: 0,
      country: 0,
      contextual: 0,
      field_completeness: 0,
      total: 0,
      level: "unverified",
      auto_apply: false,
    };
  }

  const providerWeight = 0.95; // recherche-entreprises / official
  const countryWeight = company.country ? 1 : 0.3;
  const contextualWeight = countryHint && company.country === countryHint ? 1 : 0.5;
  const completeness = fieldCompleteness(company);

  const total =
    formatScore * 0.20 +
    providerWeight * 0.30 +
    countryWeight * 0.10 +
    contextualWeight * 0.10 +
    completeness * 0.30;

  const rounded = Math.round(total * 100) / 100;
  let level: ConfidenceLevel = "unverified";
  if (rounded >= 0.85) level = "fully_enriched";
  else if (rounded >= 0.60) level = "partially_enriched";
  else if (rounded >= 0.40) level = "validated";

  return {
    format: formatScore,
    provider: providerWeight,
    country: countryWeight,
    contextual: contextualWeight,
    field_completeness: completeness,
    total: rounded,
    level,
    auto_apply: rounded >= AUTO_APPLY_THRESHOLD,
  };
}

export async function lookupCompanyService(
  queryRaw: string,
  countryHintRaw: string = "FR"
): Promise<LookupResponse> {
  const t0 = Date.now();
  const query = (queryRaw ?? "").trim();
  const countryHint = (countryHintRaw ?? "FR").trim().toUpperCase();
  const logs: ProviderLog[] = [];

  const classification = detectDocument(query);
  let result: NormalizedCompany | null = null;
  let candidates: NormalizedCompany[] = [];
  let vies: any = null;

  const digits = query.replace(/\D/g, "");

function normalizeBrazilianCompany(d: any, provider: string, digits: string): NormalizedCompany {
  const c = emptyCompany(provider);
  c.country = "BR";
  c.tax_id = formatCnpj(digits);
  c.siren = formatCnpj(digits);
  c.siret = digits;
  c.company_name = d?.razao_social || d?.nome_fantasia || null;
  c.legal_name = d?.razao_social || c.company_name;
  const situacao = String(d?.descricao_situacao_cadastral || d?.situacao_cadastral || "").toUpperCase();
  c.company_status = (situacao.includes("ATIVA") || situacao === "2") ? "active" : "ceased";
  c.legal_form = d?.natureza_juridica || (d?.codigo_natureza_juridica ? String(d.codigo_natureza_juridica) : null);
  c.creation_date = d?.data_inicio_atividade || null;

  const logradouro = [d?.descricao_tipo_de_logradouro, d?.logradouro].filter(Boolean).join(" ").trim() || d?.logradouro || null;
  const bairro = d?.bairro ? ` - ${d.bairro}` : "";
  const fullStreet = logradouro ? `${logradouro}${bairro}` : null;

  c.address = {
    street: fullStreet,
    street_number: d?.numero || null,
    postal_code: d?.cep ? String(d.cep).replace(/^(\d{5})(\d{3})$/, "$1-$2") : null,
    city: d?.municipio || null,
    state: d?.uf || null,
    country: "Brasil",
  };
  c.address_line = joinAddress(c.address);
  c.confidence = "fully_enriched";
  return c;
}

  // 1. Brazil CNPJ Lookup (Priority for CNPJ kind or BR country hint)
  if (classification.kind === "cnpj" || (countryHint === "BR" && digits.length === 14)) {
    const fetchT0 = Date.now();
    let found = false;

    // Provider A: BrasilAPI (Oficial / Espelho RFB)
    try {
      const resp = await fetchWithTimeout(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {}, 7000);
      if (resp.ok) {
        const d = await resp.json();
        result = normalizeBrazilianCompany(d, "brasilapi", digits);
        logs.push({ provider: "brazil-brasilapi", ms: Date.now() - fetchT0, ok: true });
        found = true;
      } else {
        logs.push({ provider: "brazil-brasilapi", ms: Date.now() - fetchT0, ok: false, notes: `HTTP ${resp.status}` });
      }
    } catch (err: any) {
      logs.push({ provider: "brazil-brasilapi", ms: Date.now() - fetchT0, ok: false, notes: String(err?.message ?? err) });
    }

    // Provider B: Minha Receita (Fallback aberto de alta disponibilidade da RFB)
    if (!found) {
      const mrT0 = Date.now();
      try {
        const resp = await fetchWithTimeout(`https://minhareceita.org/${digits}`, {}, 7000);
        if (resp.ok) {
          const d = await resp.json();
          result = normalizeBrazilianCompany(d, "minha-receita", digits);
          logs.push({ provider: "minha-receita", ms: Date.now() - mrT0, ok: true });
          found = true;
        } else {
          logs.push({ provider: "minha-receita", ms: Date.now() - mrT0, ok: false, notes: `HTTP ${resp.status}` });
        }
      } catch (err: any) {
        logs.push({ provider: "minha-receita", ms: Date.now() - mrT0, ok: false, notes: String(err?.message ?? err) });
      }
    }

    // Provider C: CNPJ.ws Pública (Segundo Fallback)
    if (!found) {
      const wsT0 = Date.now();
      try {
        const resp = await fetchWithTimeout(`https://publica.cnpj.ws/cnpj/${digits}`, {}, 7000);
        if (resp.ok) {
          const d = await resp.json();
          const estab = d?.estabelecimento || {};
          const c = emptyCompany("cnpj-ws");
          c.country = "BR";
          c.tax_id = formatCnpj(digits);
          c.siren = formatCnpj(digits);
          c.siret = digits;
          c.company_name = d?.razao_social || estab?.nome_fantasia || null;
          c.legal_name = d?.razao_social || c.company_name;
          c.company_status = estab?.situacao_cadastral === "Ativa" ? "active" : "ceased";
          c.legal_form = d?.natureza_juridica?.descricao || null;
          c.creation_date = estab?.data_inicio_atividade || null;
          const logr = [estab?.tipo_logradouro, estab?.logradouro].filter(Boolean).join(" ").trim() || estab?.logradouro || null;
          const b = estab?.bairro ? ` - ${estab.bairro}` : "";
          c.address = {
            street: logr ? `${logr}${b}` : null,
            street_number: estab?.numero || null,
            postal_code: estab?.cep ? String(estab.cep).replace(/^(\d{5})(\d{3})$/, "$1-$2") : null,
            city: estab?.cidade?.nome || null,
            state: estab?.estado?.sigla || null,
            country: "Brasil",
          };
          c.address_line = joinAddress(c.address);
          c.confidence = "fully_enriched";
          result = c;
          logs.push({ provider: "cnpj-ws", ms: Date.now() - wsT0, ok: true });
          found = true;
        } else {
          logs.push({ provider: "cnpj-ws", ms: Date.now() - wsT0, ok: false, notes: `HTTP ${resp.status}` });
        }
      } catch (err: any) {
        logs.push({ provider: "cnpj-ws", ms: Date.now() - wsT0, ok: false, notes: String(err?.message ?? err) });
      }
    }
  }

  // 2. Portugal NIF / NIPC Lookup (VIES Oficial da Comissão Europeia)
  if (!result && (classification.kind === "nif_pt" || (countryHint === "PT" && digits.length === 9))) {
    const ptT0 = Date.now();
    const cleanNif = digits.length === 9 ? digits : query.replace(/\D/g, "").slice(0, 9);
    try {
      const resp = await fetchWithTimeout(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/PT/vat/${cleanNif}`, {}, 7000);
      if (resp.ok) {
        const data = await resp.json();
        vies = data;
        if (data?.isValid) {
          const c = emptyCompany("portugal-vies");
          c.country = "PT";
          c.tax_id = formatPortugueseNif(cleanNif);
          c.siren = cleanNif;
          c.siret = cleanNif;
          c.vat_number = `PT${cleanNif}`;
          c.company_name = data.name && data.name !== "---" ? data.name : null;
          c.legal_name = c.company_name;
          c.company_status = "active";
          c.address = parseViesAddress(data.address, "PT");
          c.address_line = joinAddress(c.address) || (data.address !== "---" ? data.address : null);
          c.confidence = c.company_name ? "fully_enriched" : "validated";
          result = c;
          logs.push({ provider: "portugal-vies", ms: Date.now() - ptT0, ok: true });
        } else {
          logs.push({ provider: "portugal-vies", ms: Date.now() - ptT0, ok: false, notes: data?.userError || "NIF não ativo no VIES" });
        }
      }
    } catch (err: any) {
      logs.push({ provider: "portugal-vies", ms: Date.now() - ptT0, ok: false, notes: String(err?.message ?? err) });
    }
  }

  // 3. EU VAT / TVA Intracomunitária / Espanha CIF
  if (!result && (classification.kind === "vat_eu" || classification.kind === "cif_es")) {
    const cc = (classification.country || (classification.kind === "cif_es" ? "ES" : query.slice(0, 2))).toUpperCase();
    const cleanVat = (classification.kind === "cif_es" && !query.toUpperCase().startsWith("ES"))
      ? query.replace(/[\s\.-]/g, "").toUpperCase()
      : query.slice(2).replace(/[\s\.-]/g, "").toUpperCase();

    // Se for TVA francesa (FR), os 9 dígitos finais são o SIREN!
    if (cc === "FR" && cleanVat.length >= 9) {
      const frenchSiren = cleanVat.slice(-9);
      const frT0 = Date.now();
      try {
        const resp = await fetchWithTimeout(`https://recherche-entreprises.api.gouv.fr/search?q=${frenchSiren}&page=1&per_page=1`, {}, 7000);
        if (resp.ok) {
          const data = await resp.json();
          const results = data?.results ?? [];
          if (results.length > 0) {
            result = normalizeRechercheEntreprise(results[0]);
            result.vat_number = query.toUpperCase();
            logs.push({ provider: "france-recherche-entreprises", ms: Date.now() - frT0, ok: true });
          }
        }
      } catch (err: any) {
        logs.push({ provider: "france-recherche-entreprises", ms: Date.now() - frT0, ok: false, notes: String(err?.message ?? err) });
      }
    }

    // Fallback Oficial: VIES (Comissão Europeia) para todos os países da Europa
    if (!result) {
      const viesT0 = Date.now();
      try {
        const viesUrl = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${cc}/vat/${cleanVat}`;
        const resp = await fetchWithTimeout(viesUrl, {}, 7000);
        if (resp.ok) {
          const data = await resp.json();
          vies = data;
          if (data?.isValid) {
            const c = emptyCompany("eu-vies");
            c.country = cc;
            c.vat_number = `${cc}${cleanVat}`;
            c.tax_id = c.vat_number;
            c.company_name = data.name && data.name !== "---" ? data.name : null;
            c.legal_name = c.company_name;
            c.company_status = "active";
            c.address = parseViesAddress(data.address, cc);
            c.address_line = joinAddress(c.address) || (data.address && data.address !== "---" ? data.address : null);
            c.confidence = c.company_name ? "fully_enriched" : "validated";
            result = c;
            logs.push({ provider: "eu-vies", ms: Date.now() - viesT0, ok: true });
          } else {
            logs.push({ provider: "eu-vies", ms: Date.now() - viesT0, ok: false, notes: data?.userError || "Número de IVA inválido" });
          }
        }
      } catch (err: any) {
        logs.push({ provider: "eu-vies", ms: Date.now() - viesT0, ok: false, notes: String(err?.message ?? err) });
      }
    }
  }

  // 4. FR Primary lookup via Recherche-Entreprises (SIRET / SIREN / Nome / França)
  if (!result && (classification.kind === "siret" || classification.kind === "siren" || (countryHint === "FR" && classification.kind !== "cnpj") || (classification.kind === "name" && countryHint !== "BR" && countryHint !== "PT"))) {
    const fetchT0 = Date.now();
    try {
      const searchUrl = `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(query)}&page=1&per_page=${classification.kind === "name" ? 8 : 1}`;
      const resp = await fetchWithTimeout(searchUrl, {}, 8000);
      if (resp.ok) {
        const data = await resp.json();
        const results = data?.results ?? [];
        if (results.length > 0) {
          result = normalizeRechercheEntreprise(results[0], classification.kind === "siret" ? digits : undefined);
          if (results.length > 1) {
            candidates = results.map((r: any) => normalizeRechercheEntreprise(r));
          }
          logs.push({
            provider: "france-recherche-entreprises",
            ms: Date.now() - fetchT0,
            ok: true,
          });
        } else {
          logs.push({
            provider: "france-recherche-entreprises",
            ms: Date.now() - fetchT0,
            ok: false,
            notes: "Nenhum resultado encontrado na base oficial francesa.",
          });
        }
      } else {
        logs.push({
          provider: "france-recherche-entreprises",
          ms: Date.now() - fetchT0,
          ok: false,
          notes: `HTTP ${resp.status}`,
        });
      }
    } catch (err: any) {
      logs.push({
        provider: "france-recherche-entreprises",
        ms: Date.now() - fetchT0,
        ok: false,
        notes: String(err?.message ?? err),
      });
    }
  }

  // Format boost
  let formatScore = classification.score;
  if (classification.kind === "siren" && isValidSiren(query)) formatScore = 1.0;
  if (classification.kind === "siret" && isValidSiret(query)) formatScore = 1.0;
  if (classification.kind === "cnpj" && isValidCnpj(digits)) formatScore = 1.0;
  if (classification.kind === "nif_pt" && isValidPortugueseNif(digits)) formatScore = 1.0;
  if (classification.kind === "cif_es" && isSpanishCif(query)) formatScore = 1.0;
  if (classification.kind === "vat_eu" && result) formatScore = 1.0;

  const conf = scoreCompany({ company: result, formatScore, countryHint });
  if (result) result.confidence = conf.level;

  const countryCode = result?.country ?? classification.country ?? "FR";
  const tier: SupportTier = (countryCode === "FR" || countryCode === "BR" || countryCode === "PT") ? "A" : "B";
  const capability: CountryCapability = {
    iso2: countryCode,
    model: "A",
    enrichment: "full",
    validation: true,
    provider: "available",
    searchByName: true,
    searchByTaxId: true,
  };

  let lookup_status: LookupStatus = "no_match";
  if (result && conf.level === "fully_enriched") {
    lookup_status = "fully_enriched";
  } else if (result && conf.level === "partially_enriched") {
    lookup_status = "partial_enrichment";
  } else if (!result && candidates.length > 0) {
    lookup_status = "partial_enrichment";
  } else if (formatScore >= 0.8 && !result) {
    lookup_status = "no_match";
  }

  let message = "Sem correspondência confiável. Verifique o identificador.";
  if (result && conf.auto_apply) {
    message = `Empresa identificada com alta confiança (${result.provider}, ${Math.round(conf.total * 100)}%).`;
  } else if (result) {
    message = `Empresa encontrada (${result.provider}) — confirme os dados antes de aplicar.`;
  } else if (candidates.length > 0) {
    message = `${candidates.length} candidatos encontrados — selecione um.`;
  }

  return {
    detected_kind: classification.kind,
    detected_country: result?.country ?? classification.country,
    result,
    candidates,
    vies,
    logs,
    confidence: conf.level,
    message,
    classification: {
      detected_kind: classification.kind,
      country: classification.country,
      score: classification.score,
    },
    confidence_breakdown: conf,
    country_hint: countryHint,
    total_ms: Date.now() - t0,
    provider_available: true,
    support_tier: tier,
    support_tier_label: TIER_LABEL_PT[tier],
    capability,
    lookup_status,
    lookup_status_label: LOOKUP_STATUS_LABEL_PT[lookup_status],
  };
}
