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
  | "cnpj" | "ein" | "gstin" | "bn_ca" | "rfc_mx" | "corp_jp"
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
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Detection
export function detectDocument(raw: string): { kind: DocumentKind; country: string | null; score: number } {
  const v = (raw ?? "").trim();
  if (!v) return { kind: "unknown", country: null, score: 0 };
  const upper = v.toUpperCase();
  const digits = v.replace(/\D/g, "");

  // EU VAT
  if (/^[A-Z]{2}/.test(upper) && digits.length >= 7) {
    const cc = upper.slice(0, 2);
    return { kind: "vat_eu", country: cc, score: 0.9 };
  }

  // Brazil CNPJ
  if (/[\.\/-]/.test(v) && digits.length === 14) {
    return { kind: "cnpj", country: "BR", score: isValidCnpj(v) ? 1.0 : 0.7 };
  }

  // France SIREN / SIRET
  if (digits.length === 9 && digits === v.replace(/\s/g, "")) {
    return { kind: "siren", country: "FR", score: isValidSiren(digits) ? 1.0 : 0.8 };
  }
  if (digits.length === 14 && digits === v.replace(/\s/g, "")) {
    return { kind: "siret", country: "FR", score: isValidSiret(digits) ? 1.0 : 0.8 };
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

  // FR Primary lookup via Recherche-Entreprises (API Oficial Francesa - Gratuita e Oficial)
  if (classification.kind === "siret" || classification.kind === "siren" || countryHint === "FR" || classification.kind === "name") {
    const fetchT0 = Date.now();
    try {
      const searchUrl = `https://recherche-entreprises.api.gouv.fr/search?q=${encodeURIComponent(query)}&page=1&per_page=${classification.kind === "name" ? 8 : 1}`;
      const resp = await fetchWithTimeout(searchUrl, { headers: { Accept: "application/json" } }, 8000);
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
            notes: "Nenhum resultado encontrado na base oficial.",
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

  // Brazil CNPJ fallback
  if (!result && (classification.kind === "cnpj" || countryHint === "BR") && digits.length === 14) {
    const fetchT0 = Date.now();
    try {
      const resp = await fetchWithTimeout(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {}, 8000);
      if (resp.ok) {
        const d = await resp.json();
        const c = emptyCompany("brazil-brasilapi");
        c.country = "BR";
        c.tax_id = digits;
        c.company_name = d?.razao_social ?? d?.nome_fantasia ?? null;
        c.legal_name = d?.razao_social ?? null;
        c.company_status = d?.descricao_situacao_cadastral === "ATIVA" ? "active" : "ceased";
        c.legal_form = d?.codigo_natureza_juridica ? String(d.codigo_natureza_juridica) : null;
        c.creation_date = d?.data_inicio_atividade ?? null;
        c.address = {
          street: d?.logradouro ?? null,
          street_number: d?.numero ?? null,
          postal_code: d?.cep ?? null,
          city: d?.municipio ?? null,
          state: d?.uf ?? null,
          country: "Brasil",
        };
        c.address_line = joinAddress(c.address);
        c.confidence = "fully_enriched";
        result = c;
        logs.push({ provider: "brazil-brasilapi", ms: Date.now() - fetchT0, ok: true });
      }
    } catch (err: any) {
      logs.push({ provider: "brazil-brasilapi", ms: Date.now() - fetchT0, ok: false, notes: String(err?.message ?? err) });
    }
  }

  // Format boost
  let formatScore = classification.score;
  if (classification.kind === "siren" && isValidSiren(query)) formatScore = 1.0;
  if (classification.kind === "siret" && isValidSiret(query)) formatScore = 1.0;

  const conf = scoreCompany({ company: result, formatScore, countryHint });
  if (result) result.confidence = conf.level;

  const tier: SupportTier = (result?.country ?? classification.country ?? "FR") === "FR" ? "A" : "B";
  const capability: CountryCapability = {
    iso2: result?.country ?? classification.country ?? "FR",
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
