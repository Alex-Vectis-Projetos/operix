import {
  type Budget,
  type BudgetSignature,
  type BudgetRejection,
  type BudgetType,
  type BudgetSignerType,
  BUDGET_TYPE_LABELS,
  BUDGET_TYPE_SHORT_LABELS,
  SIGNER_TYPE_OPTIONS,
  formatBRL as bdFormatBRL,
  formatDateTime as bdFormatDateTime,
  btLabel as bdBtLabel,
  getBudgetInterventions as bdGetBudgetInterventions,
  signerTypeLabel as bdSignerTypeLabel,
} from "@/components/production/BudgetDialog";

export { formatBRL } from "@/components/production/BudgetDialog";

export type { Budget, BudgetSignature, BudgetRejection, BudgetType };

export type PdfLanguage = "pt" | "fr" | "en";

export function signerTypeLabel(t: BudgetSignerType | string | null | undefined, lang: PdfLanguage = "pt"): string {
  return bdSignerTypeLabel(t, lang === "en" ? "fr" : lang);
}

export function btLabel(t: BudgetType | string | null | undefined, lang: PdfLanguage = "pt"): string {
  return bdBtLabel(t, lang === "en" ? "fr" : lang);
}

export function getBudgetInterventions(b: { intervention_type?: string; intervention_types?: string[] | null }): string[] {
  return bdGetBudgetInterventions(b);
}

export function formatDateTime(iso: string | null | undefined): string {
  return bdFormatDateTime(iso);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch {
    return String(iso ?? "-");
  }
}

export function computeTotalsFor(b: {
  parts?: Array<{ quantity?: number; unit_price?: number; pricing_mode?: string }> | null;
  services?: Array<{ quantity?: number; unit_price?: number; pricing_mode?: string }> | null;
  labor?: Array<{ hours?: number; hourly_rate?: number; pricing_mode?: string }> | null;
  discount_pct?: number | null;
  iva_pct?: number | null;
}) {
  const p = (b.parts || []).reduce(
    (s, x) => {
      const q = Math.max(0, Number(x?.quantity) || 0);
      const u = Math.max(0, Number(x?.unit_price) || 0);
      const isFixed = x?.pricing_mode === "fixed";
      return s + (isFixed ? u : q * u);
    },
    0,
  );
  const sv = Array.isArray(b.services)
    ? (b.services as Array<any>).reduce(
        (s: number, x: any) => {
          const q = Math.max(0, Number(x?.quantity) || 0);
          const u = Math.max(0, Number(x?.unit_price) || 0);
          const isFixed = x?.pricing_mode === "fixed";
          return s + (isFixed ? u : q * u);
        },
        0,
      )
    : 0;
  const l = (b.labor || []).reduce(
    (s, x) => s + Math.max(0, Number(x?.hours) || 0) * Math.max(0, Number(x?.hourly_rate) || 0),
    0,
  );
  const gross = p + sv + l;
  const disc = (gross * Math.max(0, Math.min(100, Number(b.discount_pct) || 0))) / 100;
  const net = Math.max(0, gross - disc);
  const iva = (net * Math.max(0, Math.min(100, Number(b.iva_pct) || 0))) / 100;
  return { parts: p, services: sv, labor: l, gross, disc, net, iva, total: net + iva };
}

const esc = (s: any): string => {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
};

const notEmpty = (v: any) => v != null && String(v).trim().length > 0;

export interface WorkspaceBrandInfo {
  name?: string | null;
  logoUrl?: string | null;
  brandConfig?: {
    legalName?: string;
    tagline?: string;
    address?: string;
    operatingAddress?: string;
    city?: string;
    postalCode?: string;
    phone?: string;
    tollFree?: string;
    email?: string;
    website?: string;
    [key: string]: any;
  } | null;
}

// -------------------------------------------------------------
// BAREMO FRANCÊS DSP / PDR (UT - Unité de Temps)
// -------------------------------------------------------------
export const DENT_SIZE_MULTIPLIERS: Record<string, number> = {
  "1": 0.85,
  "2": 1.0,
  "3": 1.15,
  "4": 1.30,
  "5": 1.50,
  "6": 1.70,
  "7": 1.90,
  "8": 2.15,
  "9": 2.40,
  "10": 2.70,
  "11": 3.00,
  "12": 3.40,
  "13": 3.80,
  "14": 4.30,
  "15": 5.00,
};

export function calculateBaremoUT(dents: number, sizeCode = "2"): number {
  if (!dents || dents <= 0) return 0;
  let baseUt = 0;
  if (dents <= 5) baseUt = 6 + (dents - 1) * 1.5;
  else if (dents <= 15) baseUt = 12 + (dents - 5) * 1.0;
  else if (dents <= 30) baseUt = 22 + (dents - 15) * 0.8;
  else if (dents <= 50) baseUt = 34 + (dents - 30) * 0.6;
  else if (dents <= 100) baseUt = 46 + (dents - 50) * 0.5;
  else if (dents <= 200) baseUt = 71 + (dents - 100) * 0.4;
  else baseUt = 111 + (dents - 200) * 0.35;

  const sizeMult = DENT_SIZE_MULTIPLIERS[String(sizeCode)] ?? 1.0;
  return Math.round(baseUt * sizeMult * 100) / 100;
}

export const PROTOCOLE_ZONES = [
  {
    key: "horizontaux",
    title: "Composants horizontaux",
    parts: [
      { code: "hood", label: "Capot", match: ["capot", "capô", "capo", "hood"] },
      { code: "roof", label: "Pavillon", match: ["pavillon", "teto", "toit", "roof"] },
      { code: "trunk", label: "Coffre supérieur", match: ["coffre", "porta-malas", "malle", "trunk"] },
      { code: "tailgate", label: "Coffre inférieur", match: ["coffre inférieur", "tampa inf", "tailgate"] },
    ],
  },
  {
    key: "gauche",
    title: "Côté gauche",
    parts: [
      { code: "left_rail", label: "Brancard G", match: ["brancard g", "coluna esq", "rail g", "left rail"] },
      { code: "front_left_fender", label: "Aile AVG", match: ["aile avg", "para-lama d. e", "aile avant gauche", "front left fender"] },
      { code: "front_left_door", label: "Porte AVG", match: ["porte avg", "porta d. e", "porte avant gauche", "front left door"] },
      { code: "rear_left_door", label: "Porte ARG", match: ["porte arg", "porta t. e", "porte arrière gauche", "rear left door"] },
      { code: "rear_left_quarter", label: "Aile ARG", match: ["aile arg", "lateral t. e", "aile arrière gauche", "rear left quarter"] },
    ],
  },
  {
    key: "droit",
    title: "Côté droit",
    parts: [
      { code: "right_rail", label: "Brancard D", match: ["brancard d", "coluna dir", "rail d", "right rail"] },
      { code: "front_right_fender", label: "Aile AVD", match: ["aile avd", "para-lama d. d", "aile avant droite", "front right fender"] },
      { code: "front_right_door", label: "Porte AVD", match: ["porte avd", "porta d. d", "porte avant droite", "front right door"] },
      { code: "rear_right_quarter", label: "Aile ARD", match: ["aile ard", "lateral t. d", "aile arrière droite", "rear right quarter"] },
    ],
  },
];

export const PDF_I18N = {
  fr: {
    protocolTitle: "PROTOCOLE DE RÉPARATION",
    defaultTagline: "GESTION ET RÉPARATION DES SINISTRES GRÊLE",
    noPlate: "SANS-PLAQUE",
    clientName: "Nom Client",
    brand: "Marque",
    plate: "Plaque d'immatriculation",
    protocolNo: "N° de Protocole",
    address: "Adresse / Code Postal / Ville",
    model: "Modèle",
    vin: "N° de Châssis (VIN)",
    dateStart: "Date début réparation",
    phone: "N° Tél.",
    color: "Couleur",
    km: "Kilométrage",
    dateEnd: "Date fin réparation",
    zones: {
      horizontaux: "Composants horizontaux",
      gauche: "Côté gauche",
      droit: "Côté droit",
    },
    parts: {
      hood: "Capot",
      roof: "Pavillon",
      trunk: "Coffre supérieur",
      tailgate: "Coffre inférieur",
      left_rail: "Brancard G",
      front_left_fender: "Aile AVG",
      front_left_door: "Porte AVG",
      rear_left_door: "Porte ARG",
      rear_left_quarter: "Aile ARG",
      right_rail: "Brancard D",
      front_right_fender: "Aile AVD",
      front_right_door: "Porte AVD",
      rear_right_quarter: "Aile ARD",
    } as Record<string, string>,
    colComponents: "Composants",
    colDents: "Nb. de bosses",
    colSize: "Taille 10-80 mm",
    colUt: "UT",
    colSupp: "Coût supp.",
    colSuppSub: "ALU | Colle | DAP",
    colSommeUt: "Somme UT",
    colSommeUtSub: "UT | Rés",
    colPeint: "Peint.",
    colNew: "Nouv.",
    colPrice: "Prix",
    totalDsp: "TOTAL DSP",
    optionsFootnote: "Option : AR = Anti-rouille, BHN = Bosses Hors Norme, I = Induction, VHN = Véhicule Hors Norme",
    paintMoTitle: "Total Peinture / MO",
    colElement: "Element",
    colComment: "Commentaire",
    boxTarifTitle: "TARIFICATION",
    boxTarifAlu: "• Aluminium : +25% supplémentaire",
    boxTarifColle: "• Colle : +25% sur élément",
    boxTarifDap: "• DAP : -40% sur élément",
    boxTarifPdrRate: "• Taux horaire PDR : 90.00 EUR",
    boxTarifAssemblyRate: "• Taux horaire montage : 85.00 EUR",
    boxTarifUt: "• Unité de Temps : 10UT = 1H",
    boxOptionsTitle: "OPTIONS SUPPLÉMENTAIRES",
    boxLaborTitle: "FORFAIT DÉGARNISSAGE",
    boxTotalLabor: "TOTAL DÉGARNISSAGE :",
    boxTotalTitle: "PRIX TOTAL",
    totalHt: "Total HT :",
    tva: "TVA (20%) :",
    totalTtc: "Total :",
    insuranceHeader: "ASSURANCE / EXTENSION DES DOMMAGES",
    insurance: "Assurance",
    broker: "Apporteur d'affaires",
    claimDate: "Date Sinistre",
    deductible: "Montant franchise",
    expertSig: "Signature Expert",
    expert: "Expert",
    time: "Heure",
    expertDate: "Date Expertise",
    versionOf: "Version du :",
    rejectedBadge: "DEVIS REJETÉ",
    rejectedReason: "Motif :",
    rejectedAt: "Rejeté le :",
    rejectedBy: "Par :",
  },
  pt: {
    protocolTitle: "PROTOCOLO DE REPARAÇÃO",
    defaultTagline: "GESTÃO E REPARAÇÃO DE DANOS DE GRANIZO",
    noPlate: "SEM PLACA",
    clientName: "Nome do Cliente",
    brand: "Marca",
    plate: "Placa / Matrícula",
    protocolNo: "N° de Protocolo",
    address: "Endereço / Cód. Postal / Cidade",
    model: "Modelo",
    vin: "N° de Chassi (VIN)",
    dateStart: "Data Início Reparação",
    phone: "Telefone",
    color: "Cor",
    km: "Quilometragem",
    dateEnd: "Data Fim Reparação",
    zones: {
      horizontaux: "Componentes Horizontais",
      gauche: "Lado Esquerdo",
      droit: "Lado Direito",
    },
    parts: {
      hood: "Capô",
      roof: "Teto / Pavilhão",
      trunk: "Tampa Traseira Sup.",
      tailgate: "Tampa Traseira Inf.",
      left_rail: "Coluna / Arco Esq. (Brancard G)",
      front_left_fender: "Para-lama Dianteiro Esq.",
      front_left_door: "Porta Dianteira Esq.",
      rear_left_door: "Porta Traseira Esq.",
      rear_left_quarter: "Lateral Traseira Esq.",
      right_rail: "Coluna / Arco Dir. (Brancard D)",
      front_right_fender: "Para-lama Dianteiro Dir.",
      front_right_door: "Porta Dianteira Dir.",
      rear_right_quarter: "Lateral Traseira Dir.",
    } as Record<string, string>,
    colComponents: "Componentes",
    colDents: "Qtd. de Mossas",
    colSize: "Diâmetro 10-80 mm",
    colUt: "UT",
    colSupp: "Custo Adic.",
    colSuppSub: "ALU | Cola | DAP",
    colSommeUt: "Soma UT",
    colSommeUtSub: "UT | Res",
    colPeint: "Pint.",
    colNew: "Nova",
    colPrice: "Preço",
    totalDsp: "TOTAL PDR / GRANIZO",
    optionsFootnote: "Opções: AR = Anti-ferrugem, BHN = Mossas Fora do Padrão, I = Indução, VHN = Veículo Fora do Padrão",
    paintMoTitle: "Total Pintura / M.O.",
    colElement: "Elemento",
    colComment: "Observação",
    boxTarifTitle: "TARIFAS E PARÂMETROS",
    boxTarifAlu: "• Alumínio: +25% adicional",
    boxTarifColle: "• Cola: +25% sobre a peça",
    boxTarifDap: "• DAP: -40% sobre a peça",
    boxTarifPdrRate: "• Taxa horária PDR: 90.00 EUR",
    boxTarifAssemblyRate: "• Taxa horária montagem: 85.00 EUR",
    boxTarifUt: "• Unidade de Tempo: 10UT = 1H",
    boxOptionsTitle: "OPÇÕES ADICIONAIS",
    boxLaborTitle: "DESMONTAGEM E MONTAGEM",
    boxTotalLabor: "TOTAL DESMONTAGEM :",
    boxTotalTitle: "VALOR TOTAL",
    totalHt: "Subtotal (S/ IVA) :",
    tva: "IVA (20%) :",
    totalTtc: "Total Geral :",
    insuranceHeader: "SEGURO / EXTENSÃO DE DANOS",
    insurance: "Seguradora",
    broker: "Intermediário / Garagem",
    claimDate: "Data do Sinistro",
    deductible: "Valor da Franquia",
    expertSig: "Assinatura do Perito",
    expert: "Perito",
    time: "Horário",
    expertDate: "Data da Perícia",
    versionOf: "Versão de :",
    rejectedBadge: "ORÇAMENTO REJEITADO",
    rejectedReason: "Motivo :",
    rejectedAt: "Rejeitado em :",
    rejectedBy: "Por :",
  },
  en: {
    protocolTitle: "REPAIR PROTOCOL",
    defaultTagline: "HAIL DAMAGE MANAGEMENT & REPAIR",
    noPlate: "NO PLATE",
    clientName: "Client Name",
    brand: "Brand",
    plate: "License Plate",
    protocolNo: "Protocol No.",
    address: "Address / Postal Code / City",
    model: "Model",
    vin: "VIN / Chassis No.",
    dateStart: "Repair Start Date",
    phone: "Phone No.",
    color: "Color",
    km: "Mileage",
    dateEnd: "Repair End Date",
    zones: {
      horizontaux: "Horizontal Components",
      gauche: "Left Side",
      droit: "Right Side",
    },
    parts: {
      hood: "Hood",
      roof: "Roof Panel",
      trunk: "Upper Trunk / Tailgate",
      tailgate: "Lower Tailgate",
      left_rail: "Left Roof Rail (Brancard L)",
      front_left_fender: "Front Left Fender",
      front_left_door: "Front Left Door",
      rear_left_door: "Rear Left Door",
      rear_left_quarter: "Rear Left Quarter Panel",
      right_rail: "Right Roof Rail (Brancard R)",
      front_right_fender: "Front Right Fender",
      front_right_door: "Front Right Door",
      rear_right_quarter: "Rear Right Quarter Panel",
    } as Record<string, string>,
    colComponents: "Components",
    colDents: "Dent Count",
    colSize: "Size 10-80 mm",
    colUt: "TU",
    colSupp: "Add. Cost",
    colSuppSub: "ALU | Glue | DAP",
    colSommeUt: "Total TU",
    colSommeUtSub: "TU | Res",
    colPeint: "Paint",
    colNew: "New",
    colPrice: "Price",
    totalDsp: "TOTAL PDR",
    optionsFootnote: "Option: AR = Anti-rust, BHN = Non-standard Dents, I = Induction, VHN = Non-standard Vehicle",
    paintMoTitle: "Total Paint / Labor",
    colElement: "Element",
    colComment: "Comments",
    boxTarifTitle: "PRICING & PARAMETERS",
    boxTarifAlu: "• Aluminum: +25% surcharge",
    boxTarifColle: "• Glue: +25% on element",
    boxTarifDap: "• DAP: -40% on element",
    boxTarifPdrRate: "• Hourly PDR rate: 90.00 EUR",
    boxTarifAssemblyRate: "• Hourly assembly rate: 85.00 EUR",
    boxTarifUt: "• Time Unit: 10TU = 1H",
    boxOptionsTitle: "ADDITIONAL OPTIONS",
    boxLaborTitle: "DISASSEMBLY & ASSEMBLY",
    boxTotalLabor: "TOTAL DISASSEMBLY :",
    boxTotalTitle: "TOTAL PRICE",
    totalHt: "Total Excl. Tax :",
    tva: "VAT (20%) :",
    totalTtc: "Total Incl. Tax :",
    insuranceHeader: "INSURANCE & CLAIM EXTENSION",
    insurance: "Insurance Co.",
    broker: "Broker / Garage",
    claimDate: "Claim Date",
    deductible: "Deductible Amount",
    expertSig: "Expert Signature",
    expert: "Surveyor / Expert",
    time: "Time",
    expertDate: "Inspection Date",
    versionOf: "Version of :",
    rejectedBadge: "QUOTE REJECTED",
    rejectedReason: "Reason :",
    rejectedAt: "Rejected on :",
    rejectedBy: "By :",
  },
};

// -------------------------------------------------------------
// RENDERIZADOR OFICIAL: PROTOCOLE DE RÉPARATION (DSP / GRÊLE)
// -------------------------------------------------------------
export function buildProtocoleDeReparationHtml(
  b: Budget,
  workspaceInfo?: WorkspaceBrandInfo,
  lang: PdfLanguage = "fr",
): string {
  const i18n = PDF_I18N[lang] || PDF_I18N.fr;
  const brand = workspaceInfo?.brandConfig || {};
  const companyName = brand.legalName || brand.name || workspaceInfo?.name || "PDR-Team SAS";
  const tagline = brand.tagline || i18n.defaultTagline;
  const legalAddress = brand.address || "388 Rue Louis Joseph Gay Lussac";
  const postalCity = [brand.postalCode || "26100", brand.city || "Romans sur Isère"].filter(Boolean).join(" ");
  const companyPhone = brand.phone || "04 87 20 01 47";
  const tollFree = brand.tollFree || "04 87 20 01 47";
  const companyEmail = brand.email || "info@pdr-team.fr";
  const companyWebsite = brand.website || "www.pdr-team.fr";
  const logoUrl = workspaceInfo?.logoUrl || null;

  const t = computeTotalsFor(b);

  // Mapeamento dos serviços existentes para casar com as peças da tabela pericial
  const allServices: any[] = Array.isArray((b as any).services) ? (b as any).services : [];
  const allParts: any[] = Array.isArray(b.parts) ? b.parts : [];

  let grandTotalUt = 0;
  let grandSommeUt = 0;
  let grandTotalPrixDsp = 0;

  // Renderiza as 3 seções do Baremo DSP
  const dspTablesHtml = PROTOCOLE_ZONES.map((zone) => {
    const zoneTitle = (i18n.zones as any)[zone.key] || zone.title;
    const rowsHtml = zone.parts.map((pDef) => {
      // Procura linha correspondente no orçamento
      const matchedSvc = allServices.find((s) => {
        const desc = (s.description || "").toLowerCase();
        return pDef.match.some((m) => desc.includes(m.toLowerCase()));
      });

      const matchedPart = allParts.find((p) => {
        const desc = (p.description || "").toLowerCase();
        return pDef.match.some((m) => desc.includes(m.toLowerCase()));
      });

      let dents = 0;
      const sizeMm = 20;
      let isAlu = false;
      let isColle = false;
      let isDap = false;
      let isPaint = false;
      let isNew = false;
      let customPrice: number | null = null;

      if (matchedSvc) {
        const desc = matchedSvc.description || "";
        const mCount = desc.match(/(\d+)\s*mossa/i);
        if (mCount) dents = parseInt(mCount[1], 10);
        else dents = Number(matchedSvc.quantity) || 0;

        if (desc.includes("[ALU]") || desc.toLowerCase().includes("alu") || desc.toLowerCase().includes("aluminium")) isAlu = true;
        if (desc.toLowerCase().includes("colle") || desc.toLowerCase().includes("cola")) isColle = true;
        if (desc.toLowerCase().includes("dap")) isDap = true;
        if (desc.toLowerCase().includes("pintura") || desc.toLowerCase().includes("peint")) isPaint = true;

        if (Number(matchedSvc.unit_price) > 0) {
          customPrice = (matchedSvc.pricing_mode === "fixed" || matchedSvc.pricingMode === "fixed")
            ? Number(matchedSvc.unit_price)
            : Number(matchedSvc.quantity || 1) * Number(matchedSvc.unit_price);
        }
      }

      if (matchedPart) {
        isNew = true;
        if (!customPrice && Number(matchedPart.unit_price) > 0) {
          customPrice = Number(matchedPart.unit_price);
        }
      }

      const hasDamage = dents > 0 || customPrice != null || isPaint || isNew;
      let baseUt = 0;
      let sommeUt = 0;
      let finalPrice = 0;

      if (hasDamage) {
        baseUt = calculateBaremoUT(dents || 10, "2");
        const mult = 1.0 + (isAlu ? 0.25 : 0) + (isColle ? 0.25 : 0) - (isDap ? 0.40 : 0);
        sommeUt = Math.round(baseUt * mult * 100) / 100;
        finalPrice = customPrice != null ? customPrice : Math.round(sommeUt * 9.0 * 100) / 100;

        grandTotalUt += baseUt;
        grandSommeUt += sommeUt;
        grandTotalPrixDsp += finalPrice;
      }

      const displayPartLabel = i18n.parts[pDef.code] || pDef.label;

      return `<tr style="border-bottom:1px solid #d1d5db;height:20px">
        <td style="padding:3px 6px;border-right:1px solid #d1d5db;font-weight:600">${esc(displayPartLabel)}</td>
        <td style="padding:3px 4px;border-right:1px solid #d1d5db;text-align:center">${hasDamage && dents > 0 ? dents : "-"}</td>
        <td style="padding:3px 4px;border-right:1px solid #d1d5db;text-align:center">${hasDamage ? sizeMm : "-"}</td>
        <td style="padding:3px 4px;border-right:1px solid #d1d5db;text-align:right">${hasDamage ? baseUt.toFixed(2) : "-"}</td>
        <td style="padding:3px 2px;border-right:1px solid #d1d5db;text-align:center">${isAlu ? "✓" : ""}</td>
        <td style="padding:3px 2px;border-right:1px solid #d1d5db;text-align:center">${isColle ? "✓" : ""}</td>
        <td style="padding:3px 2px;border-right:1px solid #d1d5db;text-align:center">${isDap ? "✓" : ""}</td>
        <td style="padding:3px 2px;border-right:1px solid #d1d5db;text-align:center">-</td>
        <td style="padding:3px 4px;border-right:1px solid #d1d5db;text-align:right">${hasDamage ? sommeUt.toFixed(2) : "-"}</td>
        <td style="padding:3px 2px;border-right:1px solid #d1d5db;text-align:center">${isPaint ? "✓" : ""}</td>
        <td style="padding:3px 2px;border-right:1px solid #d1d5db;text-align:center">${isNew ? "✓" : ""}</td>
        <td style="padding:3px 6px;text-align:right;font-weight:600">${hasDamage ? `${finalPrice.toFixed(2)} EUR` : "-"}</td>
      </tr>`;
    }).join("");

    return `<tbody>
      <tr style="background:#e5e7eb;font-weight:bold;border-bottom:1px solid #9ca3af">
        <td colspan="12" style="padding:3px 6px;text-transform:uppercase;font-size:9px;letter-spacing:0.04em">${esc(zoneTitle)}</td>
      </tr>
      ${rowsHtml}
    </tbody>`;
  }).join("");

  // Tabela Peinture / MO
  const paintRowsHtml = allServices
    .filter((s) => (s.description || "").toLowerCase().includes("peint") || (s.description || "").toLowerCase().includes("pintura"))
    .map((s) => {
      const lineVal = (s.pricing_mode === "fixed" || s.pricingMode === "fixed") ? Number(s.unit_price) : Number(s.quantity || 1) * Number(s.unit_price);
      return `<tr style="border-bottom:1px solid #d1d5db">
        <td style="padding:3px 6px;border-right:1px solid #d1d5db;font-weight:600">${esc(s.description)}</td>
        <td style="padding:3px 4px;border-right:1px solid #d1d5db;text-align:center">-</td>
        <td style="padding:3px 4px;border-right:1px solid #d1d5db;text-align:center">1 H</td>
        <td style="padding:3px 4px;border-right:1px solid #d1d5db;text-align:center">3 H</td>
        <td style="padding:3px 4px;border-right:1px solid #d1d5db;text-align:center">-</td>
        <td style="padding:3px 6px;text-align:right;font-weight:600">${lineVal.toFixed(2)} EUR</td>
      </tr>`;
    }).join("");

  const totalPaintVal = allServices
    .filter((s) => (s.description || "").toLowerCase().includes("peint") || (s.description || "").toLowerCase().includes("pintura"))
    .reduce((sum, s) => sum + ((s.pricing_mode === "fixed" || s.pricingMode === "fixed") ? Number(s.unit_price) : Number(s.quantity || 1) * Number(s.unit_price)), 0);

  const clientAddress = [b.address_street, b.address_number, b.address_postal, b.address_city, b.address_country]
    .filter(notEmpty)
    .join(" ");

  const totalHt = t.gross;
  const tvaVal = t.iva;
  const totalTtc = t.total;

  const isRejected = Boolean((b as any).rejection?.rejected || b.status === "rejected");
  const sig = (b as any).signature;
  const sigImg = sig?.signatureData || sig?.signature_data || sig?.dataUrl || sig?.data_url || (typeof sig === "string" ? sig : null);
  const sigName = sig?.signerName || sig?.signer_name || b.client_name;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8" />
  <title>${esc(i18n.protocolTitle)} - ${esc(b.number || b.code || "Devis")}</title>
  <style>
    @page { size: A4 portrait; margin: 4mm 8mm 6mm 8mm; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 10px;
      color: #111827;
      margin: 0;
      padding: 0;
      background: white;
      line-height: 1.25;
    }
    * { box-sizing: border-box; }
    table { width: 100%; border-collapse: collapse; }
    .bold { font-weight: bold; }
    .border-all { border: 1px solid #9ca3af; }
    .cell-label { font-size: 8px; color: #4b5563; text-transform: uppercase; font-weight: bold; margin-bottom: 2px; }
    .cell-val { font-size: 9.5px; font-weight: bold; color: #111827; min-height: 13px; word-break: break-word; overflow: hidden; text-overflow: ellipsis; line-height: 1.2; }
    @media print {
      .no-print { display: none !important; }
      body { padding: 0 !important; }
    }
    .print-bar {
      background: #111827;
      color: white;
      padding: 8px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
  </style>
</head>
<body>
  <div class="print-bar print-actions no-print">
    <div style="font-weight:bold;font-size:12px">Operix Engine — ${esc(i18n.protocolTitle)}</div>
    <div style="display:flex;gap:8px">
      <button onclick="window.print()" style="background:#0284c7;color:white;border:none;padding:5px 12px;border-radius:3px;font-weight:bold;cursor:pointer">Imprimir / PDF</button>
      <button onclick="window.close()" style="background:#4b5563;color:white;border:none;padding:5px 12px;border-radius:3px;cursor:pointer">Fermer</button>
    </div>
  </div>

  ${isRejected ? `
  <div style="background:#fef2f2;border:1px solid #dc2626;padding:6px 10px;margin-bottom:10px;border-radius:2px;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="font-weight:900;color:#991b1b;font-size:10px;text-transform:uppercase">
        ${esc(i18n.rejectedBadge)}
      </div>
      <div style="color:#7f1d1d;font-size:8.5px;margin-top:2px">
        ${(b as any).rejection?.reason ? `<strong>${esc(i18n.rejectedReason)}</strong> ${esc((b as any).rejection.reason)}` : "Orçamento recusado."}
      </div>
    </div>
    ${(b as any).rejection?.rejectedAt ? `
      <div style="color:#991b1b;font-size:8px;text-align:right">
        ${esc(i18n.rejectedAt)} ${formatDateTime((b as any).rejection.rejectedAt)}<br/>
        ${(b as any).rejection?.rejectedBy ? `${esc(i18n.rejectedBy)} ${esc((b as any).rejection.rejectedBy)}` : ""}
      </div>
    ` : ""}
  </div>
  ` : ""}

  <!-- 1. EN-TÊTE OFFICIEL & WHITELABEL (LOGO AMPLIADO & FAIXA ELEVADA) -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111827;padding-bottom:6px;margin-bottom:10px">
    <div style="display:flex;align-items:center;gap:12px">
      ${logoUrl ? `
        <div>
          <img src="${esc(logoUrl)}" alt="Logo" style="height:72px;max-height:80px;max-width:260px;object-fit:contain;display:block" />
          <div style="font-size:7.5px;font-weight:bold;color:#4b5563;letter-spacing:0.06em;text-transform:uppercase;margin-top:3px">${esc(tagline)}</div>
        </div>
      ` : `
        <div>
          <div style="font-size:22px;font-weight:900;letter-spacing:0.04em;color:#111827">${esc(companyName)}</div>
          <div style="font-size:8px;font-weight:bold;color:#4b5563;letter-spacing:0.06em;text-transform:uppercase;margin-top:2px">${esc(tagline)}</div>
        </div>
      `}
    </div>
    <div style="text-align:right">
      <div style="background:#111827;color:white;padding:7px 18px;border-radius:2px;font-size:14.5px;font-weight:900;letter-spacing:0.12em;display:inline-block;text-transform:uppercase">
        ${esc(i18n.protocolTitle)}
      </div>
      <div style="margin-top:5px;margin-bottom:2px">
        <span style="font-family:ui-monospace,Menlo,monospace;font-size:12px;font-weight:900;color:#b91c1c;border:1.5px solid #dc2626;background:#fef2f2;padding:2px 14px;border-radius:3px;display:inline-block;white-space:nowrap">
          ${esc(b.vehicle_plate || i18n.noPlate)}
        </span>
      </div>
    </div>
  </div>

  <!-- 2. FICHE CLIENT & VÉHICULE (GRILLE PERICIALE 4x3) -->
  <table class="border-all" style="margin-bottom:12px;font-size:9.5px;table-layout:fixed;width:100%">
    <colgroup>
      <col style="width:28%" /><col style="width:22%" /><col style="width:25%" /><col style="width:25%" />
    </colgroup>
    <tbody>
      <tr>
        <td style="padding:4px 6px;border-right:1px solid #9ca3af;border-bottom:1px solid #9ca3af">
          <div class="cell-label">${esc(i18n.clientName)}</div>
          <div class="cell-val">${esc(b.client_name || "-")}${b.client_display_id ? ` <span style="font-size:8px;color:#4b5563;font-weight:normal">(${esc(b.client_display_id)})</span>` : ""}</div>
        </td>
        <td style="padding:4px 6px;border-right:1px solid #9ca3af;border-bottom:1px solid #9ca3af">
          <div class="cell-label">${esc(i18n.brand)}</div>
          <div class="cell-val">${esc(b.vehicle_brand || "-")}</div>
        </td>
        <td style="padding:4px 6px;border-right:1px solid #9ca3af;border-bottom:1px solid #9ca3af">
          <div class="cell-label">${esc(i18n.plate)}</div>
          <div class="cell-val" style="color:#b91c1c">${esc(b.vehicle_plate || "-")}</div>
        </td>
        <td style="padding:4px 6px;border-bottom:1px solid #9ca3af">
          <div class="cell-label">${esc(i18n.protocolNo)}</div>
          <div class="cell-val">${esc(b.number || b.code || "-")}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:4px 6px;border-right:1px solid #9ca3af;border-bottom:1px solid #9ca3af">
          <div class="cell-label">${esc(i18n.address)}</div>
          <div class="cell-val">${esc(clientAddress || "-")}</div>
        </td>
        <td style="padding:4px 6px;border-right:1px solid #9ca3af;border-bottom:1px solid #9ca3af">
          <div class="cell-label">${esc(i18n.model)}</div>
          <div class="cell-val">${esc(b.vehicle_model || "-")}</div>
        </td>
        <td style="padding:4px 6px;border-right:1px solid #9ca3af;border-bottom:1px solid #9ca3af">
          <div class="cell-label">${esc(i18n.vin)}</div>
          <div class="cell-val" style="font-family:monospace">${esc(b.vehicle_vin || "-")}</div>
        </td>
        <td style="padding:4px 6px;border-bottom:1px solid #9ca3af">
          <div class="cell-label">${esc(i18n.dateStart)}</div>
          <div class="cell-val">${formatDate(b.issued_at || b.created_at)}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:4px 6px;border-right:1px solid #9ca3af">
          <div class="cell-label">${esc(i18n.phone)}</div>
          <div class="cell-val">${esc(b.client_phone || "-")}</div>
        </td>
        <td style="padding:4px 6px;border-right:1px solid #9ca3af">
          <div class="cell-label">${esc(i18n.color)}</div>
          <div class="cell-val">${esc(b.vehicle_color || "-")}</div>
        </td>
        <td style="padding:4px 6px;border-right:1px solid #9ca3af">
          <div class="cell-label">${esc(i18n.km)}</div>
          <div class="cell-val">${esc(b.vehicle_km || "-")}</div>
        </td>
        <td style="padding:4px 6px">
          <div class="cell-label">${esc(i18n.dateEnd)}</div>
          <div class="cell-val">-</div>
        </td>
      </tr>
    </tbody>
  </table>

  <!-- 3. TABLEAU PERICIAL DSP (GRILLE OFFICIELLE 3 ZONES) -->
  <table style="border:1px solid #4b5563;margin-bottom:4px">
    <thead>
      <tr style="background:#374151;color:white;font-weight:bold;text-align:center;font-size:9px">
        <th style="padding:4px 6px;text-align:left;width:24%;border-right:1px solid #4b5563">${esc(i18n.colComponents)}</th>
        <th style="padding:4px 3px;width:9%;border-right:1px solid #4b5563">${esc(i18n.colDents)}</th>
        <th style="padding:4px 3px;width:9%;border-right:1px solid #4b5563">${esc(i18n.colSize)}</th>
        <th style="padding:4px 3px;width:7%;border-right:1px solid #4b5563">${esc(i18n.colUt)}</th>
        <th style="padding:2px 2px;width:12%;border-right:1px solid #4b5563" colspan="3">
          ${esc(i18n.colSupp)}<br/>
          <span style="font-size:7.5px;font-weight:normal">${esc(i18n.colSuppSub)}</span>
        </th>
        <th style="padding:2px 2px;width:12%;border-right:1px solid #4b5563" colspan="2">
          ${esc(i18n.colSommeUt)}<br/>
          <span style="font-size:7.5px;font-weight:normal">${esc(i18n.colSommeUtSub)}</span>
        </th>
        <th style="padding:4px 2px;width:5%;border-right:1px solid #4b5563">${esc(i18n.colPeint)}</th>
        <th style="padding:4px 2px;width:5%;border-right:1px solid #4b5563">${esc(i18n.colNew)}</th>
        <th style="padding:4px 6px;text-align:right;width:15%">${esc(i18n.colPrice)}</th>
      </tr>
    </thead>
    ${dspTablesHtml}
    <tfoot>
      <tr style="background:#1f2937;color:white;font-weight:bold;height:22px">
        <td style="padding:4px 6px;text-transform:uppercase;letter-spacing:0.05em">${esc(i18n.totalDsp)}</td>
        <td colspan="2"></td>
        <td style="padding:4px 4px;text-align:right">${grandTotalUt.toFixed(2)}</td>
        <td colspan="3"></td>
        <td colspan="2" style="padding:4px 4px;text-align:right">${grandSommeUt.toFixed(2)}</td>
        <td colspan="2"></td>
        <td style="padding:4px 6px;text-align:right">${grandTotalPrixDsp.toFixed(2)} EUR</td>
      </tr>
    </tfoot>
  </table>
  <div style="font-size:7.5px;color:#4b5563;margin-bottom:8px;font-style:italic">
    ${esc(i18n.optionsFootnote)}
  </div>

  <!-- 4. TABLEAU PEINTURE / MO (MAIN D'OEUVRE) -->
  ${paintRowsHtml ? `
  <table style="border:1px solid #4b5563;margin-bottom:8px;font-size:9.5px">
    <thead>
      <tr style="background:#374151;color:white;font-weight:bold;text-align:center;font-size:9px">
        <th style="padding:4px 6px;text-align:left;width:30%;border-right:1px solid #4b5563">${esc(i18n.colElement)}</th>
        <th style="padding:4px 4px;width:10%;border-right:1px solid #4b5563">T1</th>
        <th style="padding:4px 4px;width:15%;border-right:1px solid #4b5563">T2 (47,00 EUR/h)</th>
        <th style="padding:4px 4px;width:15%;border-right:1px solid #4b5563">Peinture (36,00 EUR/h)</th>
        <th style="padding:4px 4px;width:15%;border-right:1px solid #4b5563">Ing. (N.V.) (36,00 EUR/h)</th>
        <th style="padding:4px 6px;text-align:right;width:15%">${esc(i18n.colComment)}</th>
      </tr>
    </thead>
    <tbody>
      ${paintRowsHtml}
    </tbody>
    <tfoot>
      <tr style="background:#1f2937;color:white;font-weight:bold">
        <td style="padding:4px 6px">${esc(i18n.paintMoTitle)}</td>
        <td colspan="4"></td>
        <td style="padding:4px 6px;text-align:right">${totalPaintVal.toFixed(2)} EUR</td>
      </tr>
    </tfoot>
  </table>` : ""}

  <!-- 5. QUADRO RESUMO (4 CAIXAS PERICIAIS SIDE-BY-SIDE) -->
  <table style="border:1px solid #4b5563;margin-bottom:8px">
    <colgroup>
      <col style="width:28%" /><col style="width:24%" /><col style="width:24%" /><col style="width:24%" />
    </colgroup>
    <thead>
      <tr style="background:#374151;color:white;font-weight:bold;font-size:9px">
        <th style="padding:4px 6px;text-align:left;border-right:1px solid #4b5563">${esc(i18n.boxTarifTitle)}</th>
        <th style="padding:4px 6px;text-align:left;border-right:1px solid #4b5563">${esc(i18n.boxOptionsTitle)}</th>
        <th style="padding:4px 6px;text-align:left;border-right:1px solid #4b5563">${esc(i18n.boxLaborTitle)}</th>
        <th style="padding:4px 6px;text-align:right;background:#111827">${esc(i18n.boxTotalTitle)}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <!-- Caixa 1: Tarification -->
        <td style="padding:6px;border-right:1px solid #d1d5db;vertical-align:top;font-size:8.5px;line-height:1.4">
          ${esc(i18n.boxTarifAlu)}<br/>
          ${esc(i18n.boxTarifColle)}<br/>
          ${esc(i18n.boxTarifDap)}<br/>
          ${esc(i18n.boxTarifPdrRate)}<br/>
          ${esc(i18n.boxTarifAssemblyRate)}<br/>
          ${esc(i18n.boxTarifUt)}
        </td>
        <!-- Caixa 2: Options -->
        <td style="padding:6px;border-right:1px solid #d1d5db;vertical-align:top;font-size:8.5px;line-height:1.4">
          • Ing. (N.V.) : 0.00 EUR<br/>
          • T2 : 0.00 EUR<br/>
          • Peinture : ${totalPaintVal.toFixed(2)} EUR
        </td>
        <!-- Caixa 3: Dégarnissage -->
        <td style="padding:6px;border-right:1px solid #d1d5db;vertical-align:top;font-size:8.5px;line-height:1.4">
          ${esc(i18n.boxTotalLabor)}<br/>
          <strong>${t.labor > 0 ? `${t.labor.toFixed(2)} EUR` : "0.00 EUR"}</strong>
        </td>
        <!-- Caixa 4: Prix Total -->
        <td style="padding:6px;vertical-align:top;background:#f9fafb;font-size:9px;line-height:1.5;text-align:right">
          ${esc(i18n.totalHt)} <strong>${totalHt.toFixed(2)} EUR</strong><br/>
          ${esc(i18n.tva)} <strong>${tvaVal.toFixed(2)} EUR</strong><br/>
          <div style="font-size:12px;font-weight:900;color:#111827;border-top:1px solid #9ca3af;padding-top:3px;margin-top:3px">
            ${esc(i18n.totalTtc)} ${totalTtc.toFixed(2)} EUR
          </div>
        </td>
      </tr>
    </tbody>
  </table>

  <!-- 6. ASSURANCE / EXTENSION DES DOMMAGES -->
  <table style="border:1px solid #4b5563;margin-bottom:8px;font-size:9px">
    <thead>
      <tr style="background:#4b5563;color:white;font-weight:bold;text-align:center">
        <th colspan="5" style="padding:3px 6px;text-transform:uppercase;letter-spacing:0.06em">${esc(i18n.insuranceHeader)}</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td style="padding:4px 6px;border-right:1px solid #d1d5db;border-bottom:1px solid #d1d5db;width:22%">
          <div class="cell-label">${esc(i18n.insurance)}</div>
          <div class="cell-val">${esc(b.dossier_insurance_company || "-")}${b.dossier_claim_number ? ` (${esc(b.dossier_claim_number)})` : ""}</div>
        </td>
        <td style="padding:4px 6px;border-right:1px solid #d1d5db;border-bottom:1px solid #d1d5db;width:24%">
          <div class="cell-label">${esc(i18n.broker)}</div>
          <div class="cell-val">${esc(b.dossier_broker_name || b.dossier_garage_name || "-")}</div>
        </td>
        <td style="padding:4px 6px;border-right:1px solid #d1d5db;border-bottom:1px solid #d1d5db;width:20%">
          <div class="cell-label">${esc(i18n.claimDate)}</div>
          <div class="cell-val">${formatDate(b.dossier_claim_date)}</div>
        </td>
        <td style="padding:4px 6px;border-right:1px solid #d1d5db;border-bottom:1px solid #d1d5db;width:16%">
          <div class="cell-label">${esc(i18n.deductible)}</div>
          <div class="cell-val">${b.dossier_franchise_amount ? `${Number(b.dossier_franchise_amount).toFixed(2)} EUR` : "- EUR"}</div>
        </td>
        <td style="padding:4px 6px;width:18%;text-align:center;vertical-align:bottom" rowspan="2">
          <div class="cell-label">${esc(sigName ? `Signature (${sigName})` : i18n.expertSig)}</div>
          ${sigImg ? `<img src="${esc(sigImg)}" style="max-height:36px;max-width:100%;object-fit:contain" alt="Signature" />` : `<div style="height:32px;border-bottom:1px dashed #9ca3af;margin-top:4px"></div>`}
        </td>
      </tr>
      <tr>
        <td style="padding:4px 6px;border-right:1px solid #d1d5db">
          <div class="cell-label">${esc(i18n.expert)}</div>
          <div class="cell-val">${esc(b.dossier_expert_name || "-")}</div>
        </td>
        <td style="padding:4px 6px;border-right:1px solid #d1d5db">
          <div class="cell-label">${esc(i18n.phone)}</div>
          <div class="cell-val">${esc(b.dossier_expert_phone || "-")}</div>
        </td>
        <td style="padding:4px 6px;border-right:1px solid #d1d5db">
          <div class="cell-label">${esc(i18n.time)}</div>
          <div class="cell-val">${esc(b.dossier_expert_time || "-")}</div>
        </td>
        <td style="padding:4px 6px;border-right:1px solid #d1d5db">
          <div class="cell-label">${esc(i18n.expertDate)}</div>
          <div class="cell-val">${formatDate(b.dossier_expert_date)}</div>
        </td>
      </tr>
    </tbody>
  </table>

  <!-- 7. PIED DE PAGE MULTI-EMPRESA (WHITELABEL 4 COLUNAS) -->
  <table style="border:1px solid #111827;font-size:8px;color:#374151;margin-top:6px">
    <tbody>
      <tr>
        <td style="padding:4px 6px;border-right:1px solid #d1d5db;width:28%;vertical-align:top">
          <strong>${esc(companyName)}</strong><br/>
          ${esc(legalAddress)}<br/>
          ${esc(postalCity)}
        </td>
        <td style="padding:4px 6px;border-right:1px solid #d1d5db;width:28%;vertical-align:top">
          <strong>${esc(companyName)}</strong><br/>
          ${esc(brand.operatingAddress || legalAddress)}
        </td>
        <td style="padding:4px 6px;border-right:1px solid #d1d5db;width:30%;vertical-align:top">
          Tél.: ${esc(companyPhone)}<br/>
          N° Vert: ${esc(tollFree)}<br/>
          ${esc(companyEmail)} - ${esc(companyWebsite)}
        </td>
        <td style="padding:4px 6px;width:14%;vertical-align:top;text-align:right">
          ${esc(i18n.versionOf)}<br/>
          <strong>${formatDate(b.updated_at || b.created_at || new Date().toISOString())}</strong>
        </td>
      </tr>
    </tbody>
  </table>
</body>
</html>`;
}

// -------------------------------------------------------------
// BUILDER TRADICIONAL & DISPATCHER
// -------------------------------------------------------------
export function buildPrintableBudget(
  b: Budget,
  lang: PdfLanguage = "pt",
  workspaceInfo?: WorkspaceBrandInfo,
): string {
  // Se for do tipo PDR / Granizo, renderiza com exclusividade o Protocole de Réparation pericial
  if (b.budget_type === "pdr") {
    return buildProtocoleDeReparationHtml(b, workspaceInfo, lang);
  }

  // Layout Tradicional para Mecânica / Colisão
  const t = computeTotalsFor(b);
  const sections: string[] = [];
  const headerTitle = lang === "fr" ? "DEVIS DE RÉPARATION" : lang === "en" ? "REPAIR ESTIMATE" : "ORÇAMENTO DE SERVIÇOS";
  const brand = workspaceInfo?.brandConfig || {};
  const companyName = brand.legalName || workspaceInfo?.name || "Operix";

  sections.push(`<div style="background:#2b2f36;color:white;padding:14px 24px;text-align:center;margin-bottom:6px;border:1px solid #111827">
    <h1 style="margin:0;font-size:20px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase">${esc(headerTitle)}</h1>
  </div>
  <div style="background:#d6d8dc;height:10px;border:1px solid #c2c5cb;border-top:none;margin-bottom:14px"></div>
  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px;padding:0 4px">
    <div>
      <div style="font-size:14px;font-weight:800;color:#111827">${esc(companyName)}</div>
      <div style="font-size:11px;font-weight:600;color:#4b5563">${lang === "fr" ? "Atelier de réparation automobile" : lang === "en" ? "Automotive Repair Center" : "Oficina de reparação automotiva"}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:9px;color:#4b5563;letter-spacing:0.1em;text-transform:uppercase">${lang === "fr" ? "N° de Devis" : lang === "en" ? "Quote No." : "N° Orçamento"}</div>
      <div style="font-size:16px;font-weight:800;font-family:ui-monospace,Menlo,monospace;color:#111827">${esc(b.number || b.code || "(rascunho)")}</div>
      <div style="font-size:10px;color:#4b5563;margin-top:4px">${lang === "fr" ? "Émis le" : lang === "en" ? "Issued on" : "Emissão"}: ${formatDate(b.issued_at || b.created_at || new Date().toISOString())}</div>
    </div>
  </div>`);

  return buildProtocoleDeReparationHtml(b, workspaceInfo, lang);
}

export function openBudgetPreview(
  b: Budget,
  lang: PdfLanguage = "pt",
  workspaceInfo?: WorkspaceBrandInfo,
): void {
  try {
    const html = buildPrintableBudget(b, lang, workspaceInfo);
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) {
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch {}; }, 10_000);
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  } catch (e) {
    try {
      const html = buildPrintableBudget(b, lang, workspaceInfo);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch {}; }, 10_000);
    } catch {}
  }
}

export function downloadBudgetHtml(
  b: Budget,
  lang: PdfLanguage = "pt",
  workspaceInfo?: WorkspaceBrandInfo,
): void {
  try {
    const html = buildPrintableBudget(b, lang, workspaceInfo);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeNumber = (b.number || b.code || "rascunho").replace(/[^\w\-]/g, "_");
    a.download = `Protocole_${safeNumber}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch {}; }, 1500);
  } catch {}
}
