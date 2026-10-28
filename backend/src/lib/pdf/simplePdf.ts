/**
 * Operix Canonical PDF Engine
 * Generates valid, self-contained PDF 1.4 documents with WinAnsiEncoding
 * for full support of accented Latin characters (PT, FR, EN) without corruption.
 */

export interface BudgetPdfItem {
  type: "service" | "part" | "labor";
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface BudgetPdfDocument {
  code: string;
  revisionNumber: number;
  status: string;
  date: string;
  client: {
    name: string;
    document?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
  };
  vehicle: {
    brandModel?: string | null;
    plate?: string | null;
    vin?: string | null;
  };
  items: BudgetPdfItem[];
  currency: string;
  grossTotal: number;
  discountPct?: number | null;
  discountTotal?: number | null;
  taxPct?: number | null;
  taxTotal?: number | null;
  finalTotal: number;
  notes?: string | null;
  signature?: {
    signed: boolean;
    signerName?: string | null;
    signedAt?: string | null;
  } | null;
}

const WIN_ANSI_MAP: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87,
  "ˆ": 0x88, "‰": 0x89, "Š": 0x8A, "‹": 0x8B, "Œ": 0x8C, "Ž": 0x8E,
  "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
  "˜": 0x98, "™": 0x99, "š": 0x9A, "›": 0x9B, "œ": 0x9C, "ž": 0x9E, "Ÿ": 0x9F,
  " ": 0xA0, "¡": 0xA1, "¢": 0xA2, "£": 0xA3, "¤": 0xA4, "¥": 0xA5, "¦": 0xA6,
  "§": 0xA7, "¨": 0xA8, "©": 0xA9, "ª": 0xAA, "«": 0xAB, "¬": 0xAC, "­": 0xAD,
  "®": 0xAE, "¯": 0xAF, "°": 0xB0, "±": 0xB1, "²": 0xB2, "³": 0xB3, "´": 0xB4,
  "µ": 0xB5, "¶": 0xB6, "·": 0xB7, "¸": 0xB8, "¹": 0xB9, "º": 0xBA, "»": 0xBB,
  "¼": 0xBC, "½": 0xBD, "¾": 0xBE, "¿": 0xBF, "À": 0xC0, "Á": 0xC1, "Â": 0xC2,
  "Ã": 0xC3, "Ä": 0xC4, "Å": 0xC5, "Æ": 0xC6, "Ç": 0xC7, "È": 0xC8, "É": 0xC9,
  "Ê": 0xCA, "Ë": 0xCB, "Ì": 0xCC, "Í": 0xCD, "Î": 0xCE, "Ï": 0xCF, "Ð": 0xD0,
  "Ñ": 0xD1, "Ò": 0xD2, "Ó": 0xD3, "Ô": 0xD4, "Õ": 0xD5, "Ö": 0xD6, "×": 0xD7,
  "Ø": 0xD8, "Ù": 0xD9, "Ú": 0xDA, "Û": 0xDB, "Ü": 0xDC, "Ý": 0xDD, "Þ": 0xDE,
  "ß": 0xDF, "à": 0xE0, "á": 0xE1, "â": 0xE2, "ã": 0xE3, "ä": 0xE4, "å": 0xE5,
  "æ": 0xE6, "ç": 0xE7, "è": 0xE8, "é": 0xE9, "ê": 0xEA, "ë": 0xEB, "ì": 0xEC,
  "í": 0xED, "î": 0xEE, "ï": 0xEF, "ð": 0xF0, "ñ": 0xF1, "ò": 0xF2, "ó": 0xF3,
  "ô": 0xF4, "õ": 0xF5, "ö": 0xF6, "÷": 0xF7, "ø": 0xF8, "ù": 0xF9, "ú": 0xFA,
  "û": 0xFB, "ü": 0xFC, "ý": 0xFD, "þ": 0xFE, "ÿ": 0xFF
};

export function pdfEscapeWinAnsi(text: string): string {
  if (!text) return "";
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = ch.charCodeAt(0);
    if (ch === "\\") {
      out += "\\\\";
    } else if (ch === "(") {
      out += "\\(";
    } else if (ch === ")") {
      out += "\\)";
    } else if (code >= 32 && code <= 126) {
      out += ch;
    } else if (WIN_ANSI_MAP[ch] != null) {
      const b = WIN_ANSI_MAP[ch];
      out += "\\" + b.toString(8).padStart(3, "0");
    } else if (code >= 0xA0 && code <= 0xFF) {
      out += "\\" + code.toString(8).padStart(3, "0");
    } else {
      // Map other characters by removing diacritics
      const norm = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (norm.length > 0 && norm.charCodeAt(0) >= 32 && norm.charCodeAt(0) <= 126) {
        out += norm;
      } else {
        out += " ";
      }
    }
  }
  return out;
}

function assemblePdf(contentStream: string): Buffer {
  const pageWidth = 595.28;
  const pageHeight = 841.89;

  const parts: string[] = [];
  let offset = 0;
  const objOffsets: number[] = [0];

  const push = (chunk: string, objIndex?: number) => {
    if (typeof objIndex === "number") objOffsets[objIndex] = offset;
    parts.push(chunk);
    offset += Buffer.byteLength(chunk, "utf8");
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n", 1);
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n", 2);
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>\nendobj\n`,
    3,
  );
  push(
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n",
    4,
  );
  push(
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n",
    5,
  );
  push(
    `6 0 obj\n<< /Length ${Buffer.byteLength(contentStream, "utf8")} >>\nstream\n${contentStream}\nendstream\nendobj\n`,
    6,
  );

  const xrefOffset = offset;
  let xref = "xref\n0 7\n0000000000 65535 f \n";
  for (let i = 1; i <= 6; i += 1) {
    xref += String(objOffsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  const trailer = `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.concat([
    Buffer.from(parts.join(""), "utf8"),
    Buffer.from(xref, "utf8"),
    Buffer.from(trailer, "utf8"),
  ]);
}

/**
 * Builds backward-compatible simple PDF with line arrays
 */
export function buildSimplePdf(params: {
  title: string;
  lines: string[];
  meta?: { author?: string; subject?: string };
}): Buffer {
  const marginLeft = 48;
  const marginTop = 56;
  const lineHeight = 15;

  const content: string[] = [];
  content.push("BT");
  content.push("/F2 16 Tf");
  content.push(`${marginLeft} ${841.89 - marginTop} Td`);
  content.push(`(${pdfEscapeWinAnsi(params.title)}) Tj`);
  content.push("0 -24 Td");
  content.push("/F1 10 Tf");

  for (const raw of params.lines) {
    const t = raw == null ? "" : String(raw);
    const safe = pdfEscapeWinAnsi(t).slice(0, 240);
    content.push(`(${safe}) Tj`);
    content.push(`0 -${lineHeight} Td`);
  }
  content.push("ET");

  return assemblePdf(content.join("\n"));
}

/**
 * Builds canonical polished Operix Budget PDF
 */
export function buildBudgetDocumentPdf(doc: BudgetPdfDocument): Buffer {
  const content: string[] = [];

  // 1. Header background box
  content.push("0.07 0.11 0.18 rg"); // dark slate
  content.push("40 765 515 48 re f");

  // Header Title
  content.push("BT");
  content.push("/F2 18 Tf");
  content.push("1 1 1 rg"); // white
  content.push("55 782 Td");
  content.push("(OPERIX) Tj");

  content.push("/F1 9 Tf");
  content.push("0 -12 Td");
  content.push(`(${pdfEscapeWinAnsi("Système de Gestion Opérationnelle & Atelier")}) Tj`);
  content.push("ET");

  // Header Right (Document & Code)
  content.push("BT");
  content.push("/F2 13 Tf");
  content.push("1 1 1 rg");
  content.push("380 786 Td");
  content.push(`(${pdfEscapeWinAnsi(`DEVIS ${doc.code}`)}) Tj`);

  content.push("/F1 9 Tf");
  content.push("0 -12 Td");
  content.push(`(${pdfEscapeWinAnsi(`Révision ${doc.revisionNumber} · Date: ${doc.date}`)}) Tj`);
  content.push("ET");

  // Status Badge
  const isApproved = doc.status === "approved";
  if (isApproved) {
    content.push("0.08 0.58 0.28 rg"); // green
  } else {
    content.push("0.4 0.45 0.52 rg"); // slate
  }
  content.push("40 740 515 16 re f");
  content.push("BT");
  content.push("/F2 9 Tf");
  content.push("1 1 1 rg");
  content.push("50 744 Td");
  content.push(`(${pdfEscapeWinAnsi(isApproved ? "STATUT : APPROUVÉ (CONFIRMÉ)" : "STATUT : BROUILLON / EN COURS")}) Tj`);
  content.push("ET");

  // 2. Client & Vehicle Metadata Boxes
  // Client Box
  content.push("0.96 0.97 0.98 rg");
  content.push("40 645 250 85 re f");
  content.push("0.8 0.83 0.88 RG 0.5 w");
  content.push("40 645 250 85 re s");

  content.push("BT");
  content.push("0.1 0.15 0.22 rg");
  content.push("/F2 10 Tf");
  content.push("50 715 Td");
  content.push(`(${pdfEscapeWinAnsi("CLIENT / DONNEUR D'ORDRE")}) Tj`);
  content.push("/F2 10 Tf");
  content.push("0 -14 Td");
  content.push(`(${pdfEscapeWinAnsi(doc.client.name || "Client particulier")}) Tj`);
  content.push("/F1 8 Tf");
  content.push("0 -11 Td");
  content.push(`(${pdfEscapeWinAnsi(`Doc/SIREN: ${doc.client.document || "—"}`)}) Tj`);
  content.push("0 -10 Td");
  content.push(`(${pdfEscapeWinAnsi(`Tél: ${doc.client.phone || "—"} | Email: ${doc.client.email || "—"}`)}) Tj`);
  content.push("0 -10 Td");
  content.push(`(${pdfEscapeWinAnsi(`Adresse: ${doc.client.address || "—"}`)}) Tj`);
  content.push("ET");

  // Vehicle Box
  content.push("0.96 0.97 0.98 rg");
  content.push("305 645 250 85 re f");
  content.push("0.8 0.83 0.88 RG 0.5 w");
  content.push("305 645 250 85 re s");

  content.push("BT");
  content.push("0.1 0.15 0.22 rg");
  content.push("/F2 10 Tf");
  content.push("315 715 Td");
  content.push(`(${pdfEscapeWinAnsi("VÉHICULE & DOSSIER")}) Tj`);
  content.push("/F2 10 Tf");
  content.push("0 -14 Td");
  content.push(`(${pdfEscapeWinAnsi(doc.vehicle.brandModel || "Véhicule non spécifié")}) Tj`);
  content.push("/F1 8 Tf");
  content.push("0 -11 Td");
  content.push(`(${pdfEscapeWinAnsi(`Immatriculation: ${doc.vehicle.plate || "—"}`)}) Tj`);
  content.push("0 -10 Td");
  content.push(`(${pdfEscapeWinAnsi(`N° de Châssis (VIN): ${doc.vehicle.vin || "—"}`)}) Tj`);
  content.push("0 -10 Td");
  content.push(`(${pdfEscapeWinAnsi(`Devise: ${doc.currency}`)}) Tj`);
  content.push("ET");

  // 3. Table Header
  content.push("0.15 0.2 0.28 rg");
  content.push("40 615 515 20 re f");

  content.push("BT");
  content.push("/F2 9 Tf");
  content.push("1 1 1 rg");
  content.push("46 621 Td");
  content.push(`(${pdfEscapeWinAnsi("DESCRIPTION DES PRESTATIONS / PIÈCES")}) Tj`);
  content.push("300 0 Td");
  content.push(`(${pdfEscapeWinAnsi("TYPE")}) Tj`);
  content.push("45 0 Td");
  content.push(`(${pdfEscapeWinAnsi("QTÉ")}) Tj`);
  content.push("40 0 Td");
  content.push(`(${pdfEscapeWinAnsi("P.U.")}) Tj`);
  content.push("50 0 Td");
  content.push(`(${pdfEscapeWinAnsi("TOTAL")}) Tj`);
  content.push("ET");

  // 4. Table Rows
  let currentY = 598;
  const rowHeight = 16;
  const currency = doc.currency || "EUR";

  const items = doc.items && doc.items.length > 0 ? doc.items : [
    { type: "service" as const, description: "Prestation générale d'atelier", quantity: 1, unitPrice: doc.grossTotal, total: doc.grossTotal }
  ];

  for (let idx = 0; idx < items.length && currentY > 200; idx++) {
    const item = items[idx];
    const isEven = idx % 2 === 0;
    if (isEven) {
      content.push("0.98 0.98 0.99 rg");
      content.push(`40 ${currentY - 4} 515 ${rowHeight} re f`);
    }
    // Bottom border
    content.push("0.9 0.92 0.94 RG 0.5 w");
    content.push(`40 ${currentY - 4} m 555 ${currentY - 4} l S`);

    const typeLabel = item.type === "part" ? "Pièce" : item.type === "labor" ? "M.O." : "Service";
    const descText = pdfEscapeWinAnsi(item.description).slice(0, 48);
    const qtyText = Number(item.quantity || 1).toString();
    const puText = Number(item.unitPrice || 0).toFixed(2);
    const totText = Number(item.total || 0).toFixed(2);

    content.push("BT");
    content.push("0.1 0.15 0.22 rg");
    content.push("/F1 8 Tf");
    content.push(`46 ${currentY} Td`);
    content.push(`(${descText}) Tj`);
    content.push("300 0 Td");
    content.push(`(${pdfEscapeWinAnsi(typeLabel)}) Tj`);
    content.push("45 0 Td");
    content.push(`(${qtyText}) Tj`);
    content.push("40 0 Td");
    content.push(`(${puText}) Tj`);
    content.push("/F2 8 Tf");
    content.push("50 0 Td");
    content.push(`(${totText}) Tj`);
    content.push("ET");

    currentY -= rowHeight;
  }

  // 5. Summary / Totals Box (Right Aligned)
  const totalsBoxY = Math.max(120, currentY - 75);
  content.push("0.96 0.97 0.99 rg");
  content.push(`330 ${totalsBoxY} 225 65 re f`);
  content.push("0.8 0.83 0.88 RG 0.5 w");
  content.push(`330 ${totalsBoxY} 225 65 re s`);

  content.push("BT");
  content.push("0.15 0.2 0.25 rg");
  content.push("/F1 8 Tf");
  content.push(`340 ${totalsBoxY + 48} Td`);
  content.push(`(${pdfEscapeWinAnsi(`Total Brut H.T. :`)}) Tj`);
  content.push(`140 0 Td (${Number(doc.grossTotal || 0).toFixed(2)} ${currency}) Tj`);

  content.push("-140 -12 Td");
  content.push(`(${pdfEscapeWinAnsi(`Remise (${Number(doc.discountPct || 0)}%) :`)}) Tj`);
  content.push(`140 0 Td (-${Number(doc.discountTotal || 0).toFixed(2)} ${currency}) Tj`);

  content.push("-140 -12 Td");
  content.push(`(${pdfEscapeWinAnsi(`TVA (${Number(doc.taxPct || 0)}%) :`)}) Tj`);
  content.push(`140 0 Td (+${Number(doc.taxTotal || 0).toFixed(2)} ${currency}) Tj`);

  content.push("-140 -15 Td");
  content.push("/F2 10 Tf");
  content.push("0.05 0.1 0.2 rg");
  content.push(`(${pdfEscapeWinAnsi("TOTAL TTC :")}) Tj`);
  content.push(`140 0 Td (${Number(doc.finalTotal || 0).toFixed(2)} ${currency}) Tj`);
  content.push("ET");

  // 6. Signatures Section
  const sigY = Math.max(55, totalsBoxY - 50);
  content.push("0.7 0.7 0.7 RG 0.5 w");
  content.push(`40 ${sigY + 30} m 240 ${sigY + 30} l S`);
  content.push(`315 ${sigY + 30} m 515 ${sigY + 30} l S`);

  content.push("BT");
  content.push("0.4 0.45 0.5 rg");
  content.push("/F1 8 Tf");
  content.push(`40 ${sigY + 18} Td`);
  content.push(`(${pdfEscapeWinAnsi("Bon pour accord et signature du Client")}) Tj`);

  if (doc.signature && doc.signature.signed) {
    content.push("0 -10 Td");
    content.push("/F2 8 Tf");
    content.push("0.08 0.58 0.28 rg");
    content.push(`(${pdfEscapeWinAnsi(`[Signé électr. par ${doc.signature.signerName || "Client"} le ${(doc.signature.signedAt || "").slice(0, 10)}]`)}) Tj`);
  }

  content.push("275 10 Td");
  content.push("0.4 0.45 0.5 rg");
  content.push("/F1 8 Tf");
  content.push(`(${pdfEscapeWinAnsi("Pour Operix · Direction d'atelier")}) Tj`);
  content.push("ET");

  // 7. Footer
  content.push("BT");
  content.push("0.5 0.55 0.6 rg");
  content.push("/F1 7 Tf");
  content.push("40 32 Td");
  content.push(`(${pdfEscapeWinAnsi("Document officiel généré par Operix Platform. Valable 15 jours à compter de la date d'émission.")}) Tj`);
  content.push("ET");

  return assemblePdf(content.join("\n"));
}


function calculateBaremoUTBackend(dents: number, sizeCode = "2"): number {
  if (!dents || dents <= 0) return 0;
  let baseUt = 0;
  if (dents <= 5) baseUt = 6 + (dents - 1) * 1.5;
  else if (dents <= 15) baseUt = 12 + (dents - 5) * 1.0;
  else if (dents <= 30) baseUt = 22 + (dents - 15) * 0.8;
  else if (dents <= 50) baseUt = 34 + (dents - 30) * 0.6;
  else if (dents <= 100) baseUt = 46 + (dents - 50) * 0.5;
  else if (dents <= 200) baseUt = 71 + (dents - 100) * 0.4;
  else baseUt = 111 + (dents - 200) * 0.35;
  const sizeMult = sizeCode === "3" ? 1.25 : sizeCode === "4" ? 1.5 : sizeCode === "5" ? 1.8 : 1.0;
  return Math.round(baseUt * sizeMult * 100) / 100;
}

const BACKEND_PROTOCOLE_ZONES = [
  {
    title: "COMPOSANTS HORIZONTAUX",
    parts: [
      { code: "hood", label: "Capot", match: ["capot", "capo"] },
      { code: "roof", label: "Pavillon", match: ["pavillon", "teto", "toit"] },
      { code: "trunk", label: "Coffre superieur", match: ["coffre", "malle", "porta-malas"] },
      { code: "tailgate", label: "Coffre inferieur", match: ["coffre inferieur", "tampa inf"] },
    ],
  },
  {
    title: "COTE GAUCHE",
    parts: [
      { code: "left_rail", label: "Brancard G", match: ["brancard g", "coluna esq"] },
      { code: "front_left_fender", label: "Aile AVG", match: ["aile avg", "para-lama d. e"] },
      { code: "front_left_door", label: "Porte AVG", match: ["porte avg", "porta d. e"] },
      { code: "rear_left_door", label: "Porte ARG", match: ["porte arg", "porta t. e"] },
      { code: "rear_left_quarter", label: "Aile ARG", match: ["aile arg", "lateral t. e"] },
    ],
  },
  {
    title: "COTE DROIT",
    parts: [
      { code: "right_rail", label: "Brancard D", match: ["brancard d", "coluna dir"] },
      { code: "front_right_fender", label: "Aile AVD", match: ["aile avd", "para-lama d. d"] },
      { code: "front_right_door", label: "Porte AVD", match: ["porte avd", "porta d. d"] },
      { code: "rear_right_quarter", label: "Aile ARD", match: ["aile ard", "lateral t. d"] },
    ],
  },
];

export function buildProtocoleDeReparationPdf(
  budget: any,
  rev: any,
  workspace?: any,
  inspection?: any,
): Buffer {
  const content: string[] = [];
  const brand = workspace?.brandConfig || {};
  const companyName = brand.legalName || brand.name || workspace?.billingProfile?.companyName || workspace?.billingProfile?.legalName || workspace?.name || "PDR-Team SAS";
  const tagline = brand.tagline || "GESTION ET REPARATION DES SINISTRES GRELE";
  const legalAddress = brand.address || workspace?.billingProfile?.billingAddress || "388 Rue Louis Joseph Gay Lussac";
  const postalCity = [brand.postalCode || workspace?.billingProfile?.postalCode || "26100", brand.city || workspace?.billingProfile?.city || "Romans sur Isere"].filter(Boolean).join(" ");
  const companyPhone = brand.phone || "04 87 20 01 47";
  const tollFree = brand.tollFree || companyPhone;
  const companyEmail = brand.email || workspace?.billingProfile?.billingEmail || "info@pdr-team.fr";
  const companyWebsite = brand.website || "www.pdr-team.fr";

  const clientSnap = (rev?.clientSnapshot as any) || {};
  const vehiclePlate = String(budget.vehiclePlate || "SANS-PLAQUE").toUpperCase();
  const protocolCode = budget.code || "FR-PFAN";

  // 1. TOP HEADER & TITLE (Y: 805 -> 765)
  // Dark Banner for Title
  content.push("0.1 0.12 0.16 rg");
  content.push("310 772 245 28 re f");

  content.push("BT");
  content.push("1 1 1 rg");
  content.push("/F2 12 Tf");
  content.push("322 782 Td");
  content.push(`(${pdfEscapeWinAnsi("PROTOCOLE DE REPARATION")}) Tj`);
  content.push("ET");

  // Red plate badge
  content.push("0.98 0.94 0.94 rg");
  content.push("465 748 90 20 re f");
  content.push("0.85 0.15 0.15 RG 1.5 w");
  content.push("465 748 90 20 re s");

  content.push("BT");
  content.push("0.75 0.1 0.1 rg");
  content.push("/F2 11 Tf");
  content.push("475 754 Td");
  content.push(`(${pdfEscapeWinAnsi(vehiclePlate)}) Tj`);
  content.push("ET");

  // Company Brand Left
  content.push("BT");
  content.push("0.1 0.12 0.16 rg");
  content.push("/F2 15 Tf");
  content.push("40 782 Td");
  content.push(`(${pdfEscapeWinAnsi(companyName)}) Tj`);
  content.push("/F2 7.5 Tf");
  content.push("0.4 0.45 0.5 rg");
  content.push("0 -11 Td");
  content.push(`(${pdfEscapeWinAnsi(tagline)}) Tj`);
  content.push("ET");

  // Divider Line
  content.push("0.1 0.12 0.16 RG 1.5 w");
  content.push("40 742 m 555 742 l S");

  // 2. CLIENT & VEHICLE GRID (Y: 736 -> 676)
  content.push("0.75 0.78 0.82 RG 0.5 w");
  content.push("40 676 515 60 re s");
  content.push("170 676 m 170 736 l S");
  content.push("285 676 m 285 736 l S");
  content.push("415 676 m 415 736 l S");
  content.push("40 716 m 555 716 l S");
  content.push("40 696 m 555 696 l S");

  // Row 1
  content.push("BT");
  content.push("0.4 0.45 0.5 rg /F2 6 Tf 44 728 Td (NOM CLIENT) Tj ET");
  content.push("BT 0.1 0.12 0.16 rg /F2 8 Tf 44 720 Td (" + pdfEscapeWinAnsi(budget.clientName || clientSnap.name || "-") + ") Tj ET");

  content.push("BT 0.4 0.45 0.5 rg /F2 6 Tf 174 728 Td (MARQUE) Tj ET");
  content.push("BT 0.1 0.12 0.16 rg /F2 8 Tf 174 720 Td (" + pdfEscapeWinAnsi(budget.vehicleBrand || "-") + ") Tj ET");

  content.push("BT 0.4 0.45 0.5 rg /F2 6 Tf 289 728 Td (PLAQUE D'IMMATRICULATION) Tj ET");
  content.push("BT 0.75 0.1 0.1 rg /F2 8 Tf 289 720 Td (" + pdfEscapeWinAnsi(vehiclePlate) + ") Tj ET");

  content.push("BT 0.4 0.45 0.5 rg /F2 6 Tf 419 728 Td (N' DE PROTOCOLE) Tj ET");
  content.push("BT 0.1 0.12 0.16 rg /F2 8 Tf 419 720 Td (" + pdfEscapeWinAnsi(protocolCode) + ") Tj ET");

  // Row 2
  const clientAddr = clientSnap.address?.street ? [clientSnap.address.street, clientSnap.address.postal, clientSnap.address.city].filter(Boolean).join(" ") : "-";
  content.push("BT 0.4 0.45 0.5 rg /F2 6 Tf 44 708 Td (ADRESSE / CODE POSTAL / VILLE) Tj ET");
  content.push("BT 0.1 0.12 0.16 rg /F1 7.5 Tf 44 700 Td (" + pdfEscapeWinAnsi(clientAddr) + ") Tj ET");

  content.push("BT 0.4 0.45 0.5 rg /F2 6 Tf 174 708 Td (MODELE) Tj ET");
  content.push("BT 0.1 0.12 0.16 rg /F2 8 Tf 174 700 Td (" + pdfEscapeWinAnsi(budget.vehicleModel || "-") + ") Tj ET");

  content.push("BT 0.4 0.45 0.5 rg /F2 6 Tf 289 708 Td (N' DE CHASSIS (VIN)) Tj ET");
  content.push("BT 0.1 0.12 0.16 rg /F1 7.5 Tf 289 700 Td (" + pdfEscapeWinAnsi(budget.vehicleVin || "-") + ") Tj ET");

  content.push("BT 0.4 0.45 0.5 rg /F2 6 Tf 419 708 Td (DATE DEBUT REPARATION) Tj ET");
  content.push("BT 0.1 0.12 0.16 rg /F1 7.5 Tf 419 700 Td (" + pdfEscapeWinAnsi((budget.createdAt || new Date()).toISOString().slice(0, 10)) + ") Tj ET");

  // Row 3
  content.push("BT 0.4 0.45 0.5 rg /F2 6 Tf 44 688 Td (N' TEL.) Tj ET");
  content.push("BT 0.1 0.12 0.16 rg /F2 7.5 Tf 44 680 Td (" + pdfEscapeWinAnsi(budget.clientPhone || clientSnap.phone || "-") + ") Tj ET");

  content.push("BT 0.4 0.45 0.5 rg /F2 6 Tf 174 688 Td (COULEUR) Tj ET");
  content.push("BT 0.1 0.12 0.16 rg /F1 7.5 Tf 174 680 Td (-) Tj ET");

  content.push("BT 0.4 0.45 0.5 rg /F2 6 Tf 289 688 Td (KILOMETRAGE) Tj ET");
  content.push("BT 0.1 0.12 0.16 rg /F1 7.5 Tf 289 680 Td (-) Tj ET");

  content.push("BT 0.4 0.45 0.5 rg /F2 6 Tf 419 688 Td (DATE FIN REPARATION) Tj ET");
  content.push("BT 0.1 0.12 0.16 rg /F1 7.5 Tf 419 680 Td (-) Tj ET");

  // 3. TABLE DSP (PDR) HEADER (Y: 668 -> 654)
  content.push("0.22 0.25 0.32 rg");
  content.push("40 654 515 15 re f");

  content.push("BT 1 1 1 rg /F2 7 Tf 44 658 Td (Composants) Tj ET");
  content.push("BT 1 1 1 rg /F2 6.5 Tf 165 658 Td (Nb. bosses) Tj ET");
  content.push("BT 1 1 1 rg /F2 6.5 Tf 215 658 Td (Taille mm) Tj ET");
  content.push("BT 1 1 1 rg /F2 6.5 Tf 265 658 Td (UT) Tj ET");
  content.push("BT 1 1 1 rg /F2 6.5 Tf 305 658 Td (ALU) Tj ET");
  content.push("BT 1 1 1 rg /F2 6.5 Tf 330 658 Td (Colle) Tj ET");
  content.push("BT 1 1 1 rg /F2 6.5 Tf 360 658 Td (DAP) Tj ET");
  content.push("BT 1 1 1 rg /F2 6.5 Tf 400 658 Td (Somme UT) Tj ET");
  content.push("BT 1 1 1 rg /F2 6.5 Tf 455 658 Td (Peint) Tj ET");
  content.push("BT 1 1 1 rg /F2 6.5 Tf 485 658 Td (Nouv) Tj ET");
  content.push("BT 1 1 1 rg /F2 6.5 Tf 520 658 Td (Prix EUR) Tj ET");

  // DSP Rows
  let curY = 642;
  const rowH = 9.5;
  const allServices: any[] = Array.isArray(rev?.services) ? rev?.services : [];
  const damagePoints: any[] = Array.isArray(inspection?.damagePoints) ? inspection?.damagePoints : [];

  let grandUt = 0;
  let grandSommeUt = 0;
  let grandPrixDsp = 0;

  for (const zone of BACKEND_PROTOCOLE_ZONES) {
    // Zone header
    content.push("0.9 0.92 0.95 rg");
    content.push(`40 ${curY} 515 ${rowH} re f`);
    content.push("0.75 0.78 0.82 RG 0.5 w");
    content.push(`40 ${curY} 515 ${rowH} re s`);

    content.push(`BT 0.1 0.12 0.16 rg /F2 6 Tf 44 ${curY + 2.5} Td (${pdfEscapeWinAnsi(zone.title)}) Tj ET`);
    curY -= rowH;

    for (const p of zone.parts) {
      // Check if point or service exists for this part
      const pts = damagePoints.filter((dp) => dp.carPartCode === p.code || p.match.some((m) => String(dp.carPartCode).toLowerCase().includes(m)));
      const svc = allServices.find((s) => p.match.some((m) => String(s.description || "").toLowerCase().includes(m)));

      let dents = pts.reduce((sum, pt) => sum + (Number(pt.dentCount) || 1), 0);
      let isAlu = pts.some((pt) => pt.partMaterial === "aluminum") || String(svc?.description || "").includes("[ALU]");
      let isColle = String(svc?.description || "").toLowerCase().includes("colle");
      let isDap = String(svc?.description || "").toLowerCase().includes("dap");
      let isPaint = pts.some((pt) => pt.damageType === "paint_damage") || String(svc?.description || "").toLowerCase().includes("peint");
      let isNew = pts.some((pt) => pt.damageType === "replace");

      if (dents === 0 && svc) {
        const m = String(svc.description || "").match(/(\d+)\s*mossa/i);
        if (m) dents = parseInt(m[1], 10);
      }

      let baseUt = 0;
      let sommeUt = 0;
      let linePrix = 0;

      if (dents > 0 || svc) {
        baseUt = calculateBaremoUTBackend(dents || 10, "2");
        const mult = 1.0 + (isAlu ? 0.25 : 0) + (isColle ? 0.25 : 0) - (isDap ? 0.40 : 0);
        sommeUt = Math.round(baseUt * mult * 100) / 100;
        if (svc && Number(svc.unit_price) > 0) {
          linePrix = (svc.pricing_mode === "fixed" || svc.pricingMode === "fixed")
            ? Number(svc.unit_price)
            : Number(svc.quantity || 1) * Number(svc.unit_price);
        } else {
          linePrix = Math.round(sommeUt * 9.0 * 100) / 100;
        }

        grandUt += baseUt;
        grandSommeUt += sommeUt;
        grandPrixDsp += linePrix;
      }

      // Draw row
      content.push("0.85 0.88 0.9 RG 0.3 w");
      content.push(`40 ${curY} 515 ${rowH} re s`);

      content.push(`BT 0.1 0.12 0.16 rg /F1 6 Tf 44 ${curY + 2.5} Td (${pdfEscapeWinAnsi(p.label)}) Tj ET`);
      content.push(`BT 0.1 0.12 0.16 rg /F1 6 Tf 175 ${curY + 2.5} Td (${dents > 0 ? dents : "-"}) Tj ET`);
      content.push(`BT 0.1 0.12 0.16 rg /F1 6 Tf 225 ${curY + 2.5} Td (${dents > 0 ? "20" : "-"}) Tj ET`);
      content.push(`BT 0.1 0.12 0.16 rg /F1 6 Tf 265 ${curY + 2.5} Td (${baseUt > 0 ? baseUt.toFixed(2) : "-"}) Tj ET`);
      content.push(`BT 0.1 0.12 0.16 rg /F2 6 Tf 308 ${curY + 2.5} Td (${isAlu ? "X" : ""}) Tj ET`);
      content.push(`BT 0.1 0.12 0.16 rg /F2 6 Tf 334 ${curY + 2.5} Td (${isColle ? "X" : ""}) Tj ET`);
      content.push(`BT 0.1 0.12 0.16 rg /F2 6 Tf 364 ${curY + 2.5} Td (${isDap ? "X" : ""}) Tj ET`);
      content.push(`BT 0.1 0.12 0.16 rg /F1 6 Tf 405 ${curY + 2.5} Td (${sommeUt > 0 ? sommeUt.toFixed(2) : "-"}) Tj ET`);
      content.push(`BT 0.1 0.12 0.16 rg /F2 6 Tf 460 ${curY + 2.5} Td (${isPaint ? "X" : ""}) Tj ET`);
      content.push(`BT 0.1 0.12 0.16 rg /F2 6 Tf 490 ${curY + 2.5} Td (${isNew ? "X" : ""}) Tj ET`);
      content.push(`BT 0.1 0.12 0.16 rg /F2 6 Tf 520 ${curY + 2.5} Td (${linePrix > 0 ? linePrix.toFixed(2) : "-"}) Tj ET`);

      curY -= rowH;
    }
  }

  // TOTAL DSP ROW
  content.push("0.1 0.12 0.16 rg");
  content.push(`40 ${curY} 515 12 re f`);

  content.push(`BT 1 1 1 rg /F2 6.5 Tf 44 ${curY + 3} Td (TOTAL DSP) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6.5 Tf 260 ${curY + 3} Td (${grandUt.toFixed(2)}) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6.5 Tf 395 ${curY + 3} Td (${grandSommeUt.toFixed(2)}) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6.5 Tf 505 ${curY + 3} Td (${grandPrixDsp.toFixed(2)} EUR) Tj ET`);
  curY -= 14;

  // Option Legend Line
  content.push("BT 0.4 0.45 0.5 rg /F1 6 Tf 40 " + curY + " Td (Option : AR = Anti-rouille, BHN = Bosses Hors Norme, I = Induction, VHN = Vehicule Hors Norme) Tj ET");
  curY -= 12;

  // 4. TABLEAU PEINTURE / MO (MAIN D'OEUVRE)
  content.push("0.22 0.25 0.32 rg");
  content.push(`40 ${curY} 515 11 re f`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 44 ${curY + 3} Td (Element) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 175 ${curY + 3} Td (T1) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 230 ${curY + 3} Td (T2 47,00 EUR/h) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 315 ${curY + 3} Td (Peinture 36,00 EUR/h) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 405 ${curY + 3} Td (Ing. N.V. 36,00 EUR/h) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 485 ${curY + 3} Td (Commentaire) Tj ET`);
  curY -= 10;

  const paintElements = [
    { name: "Capot", t2: "1 H", p: "3 H", ing: "3 H" },
    { name: "Coffre superieur", t2: "1 H", p: "1 H", ing: "1 H" },
    { name: "Brancard G", t2: "1 H", p: "1 H", ing: "1 H" },
  ];
  for (const pe of paintElements) {
    content.push("0.85 0.88 0.9 RG 0.3 w");
    content.push(`40 ${curY} 515 9 re s`);
    content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 44 ${curY + 2.5} Td (${pdfEscapeWinAnsi(pe.name)}) Tj ET`);
    content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 175 ${curY + 2.5} Td (-) Tj ET`);
    content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 240 ${curY + 2.5} Td (${pe.t2}) Tj ET`);
    content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 330 ${curY + 2.5} Td (${pe.p}) Tj ET`);
    content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 420 ${curY + 2.5} Td (${pe.ing}) Tj ET`);
    content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 485 ${curY + 2.5} Td (-) Tj ET`);
    curY -= 9;
  }

  // Somme row
  content.push("0.92 0.94 0.96 rg");
  content.push(`40 ${curY} 515 9 re f`);
  content.push("0.75 0.78 0.82 RG 0.4 w");
  content.push(`40 ${curY} 515 9 re s`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 5.5 Tf 44 ${curY + 2.5} Td (Somme) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 175 ${curY + 2.5} Td (-) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 240 ${curY + 2.5} Td (3 H) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 330 ${curY + 2.5} Td (5 H) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 420 ${curY + 2.5} Td (5 H) Tj ET`);
  curY -= 9;

  // Total row
  content.push("0.88 0.9 0.93 rg");
  content.push(`40 ${curY} 515 9 re f`);
  content.push("0.75 0.78 0.82 RG 0.4 w");
  content.push(`40 ${curY} 515 9 re s`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 5.5 Tf 44 ${curY + 2.5} Td (Total) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 230 ${curY + 2.5} Td (141.00 EUR) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 320 ${curY + 2.5} Td (180.00 EUR) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 410 ${curY + 2.5} Td (180.00 EUR) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 5.5 Tf 485 ${curY + 2.5} Td (501.00 EUR) Tj ET`);
  curY -= 11;

  // Total Peinture/MO Bar
  content.push("0.1 0.12 0.16 rg");
  content.push(`40 ${curY} 515 10 re f`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 44 ${curY + 2.5} Td (Total Peinture/MO) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 485 ${curY + 2.5} Td (501.00 EUR) Tj ET`);
  curY -= 14;

  // 5. SUMMARY 4 BOXES
  const boxW = 125;
  const boxH = 46;
  const bY = curY - boxH;

  // Box 1: Tarification
  content.push(`0.96 0.97 0.98 rg 40 ${bY} ${boxW} ${boxH} re f`);
  content.push(`0.75 0.78 0.82 RG 0.5 w 40 ${bY} ${boxW} ${boxH} re s`);
  content.push(`0.22 0.25 0.32 rg 40 ${bY + boxH - 10} ${boxW} 10 re f`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 44 ${bY + boxH - 7} Td (TARIFICATION) Tj ET`);
  content.push(`BT 0.2 0.25 0.3 rg /F1 5.5 Tf 44 ${bY + 28} Td (- Aluminium : +25% | Colle : +25%) Tj 0 -7 Td (- DAP : -40% sur element) Tj 0 -7 Td (- Taux PDR : 90.00 EUR | 10UT = 1H) Tj ET`);

  // Box 2: Options
  content.push(`0.96 0.97 0.98 rg 170 ${bY} ${boxW} ${boxH} re f`);
  content.push(`0.75 0.78 0.82 RG 0.5 w 170 ${bY} ${boxW} ${boxH} re s`);
  content.push(`0.22 0.25 0.32 rg 170 ${bY + boxH - 10} ${boxW} 10 re f`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 174 ${bY + boxH - 7} Td (OPTIONS SUPPLEMENTAIRES) Tj ET`);
  content.push(`BT 0.2 0.25 0.3 rg /F1 6 Tf 174 ${bY + 26} Td (- T2 : 0.00 EUR) Tj 0 -8 Td (- Peinture : 0.00 EUR) Tj ET`);

  // Box 3: Degarnissage
  content.push(`0.96 0.97 0.98 rg 300 ${bY} ${boxW} ${boxH} re f`);
  content.push(`0.75 0.78 0.82 RG 0.5 w 300 ${bY} ${boxW} ${boxH} re s`);
  content.push(`0.22 0.25 0.32 rg 300 ${bY + boxH - 10} ${boxW} 10 re f`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 304 ${bY + boxH - 7} Td (FORFAIT DEGARNISSAGE) Tj ET`);
  const degarnissageVal = Number(rev?.laborTotal || 0);
  content.push(`BT 0.2 0.25 0.3 rg /F2 6.5 Tf 304 ${bY + 20} Td (TOTAL: ${degarnissageVal.toFixed(2)} EUR) Tj ET`);

  // Box 4: Prix Total
  content.push(`0.96 0.97 0.98 rg 430 ${bY} ${boxW} ${boxH} re f`);
  content.push(`0.1 0.12 0.16 RG 1 w 430 ${bY} ${boxW} ${boxH} re s`);
  content.push(`0.1 0.12 0.16 rg 430 ${bY + boxH - 10} ${boxW} 10 re f`);
  content.push(`BT 1 1 1 rg /F2 6.5 Tf 434 ${bY + boxH - 7} Td (PRIX TOTAL) Tj ET`);
  const finalTotalVal = Number(rev?.finalTotal || grandPrixDsp);
  const grossVal = Number(rev?.grossTotal || grandPrixDsp);
  const tvaVal = Number(rev?.taxTotal || (finalTotalVal - grossVal));
  content.push(`BT 0.2 0.25 0.3 rg /F1 6 Tf 434 ${bY + 26} Td (Total HT : ${grossVal.toFixed(2)} EUR) Tj 0 -8 Td (TVA (20%) : ${tvaVal.toFixed(2)} EUR) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 8 Tf 434 ${bY + 6} Td (Total : ${finalTotalVal.toFixed(2)} EUR) Tj ET`);

  curY = bY - 10;

  // 5. ASSURANCE & EXPERTISE (Y: curY -> curY - 40)
  const assH = 38;
  const aY = curY - assH;
  content.push(`0.22 0.25 0.32 rg 40 ${aY + assH - 10} 515 10 re f`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 44 ${aY + assH - 7} Td (ASSURANCE / EXTENSION DES DOMMAGES) Tj ET`);
  content.push(`0.75 0.78 0.82 RG 0.5 w 40 ${aY} 515 ${assH} re s`);

  const dossierSnap = (rev?.dossierSnapshot as any) || {};
  const insCompany = dossierSnap.insuranceCompany || budget.dossier_insurance_company || "-";
  const expertName = dossierSnap.expertName || budget.dossier_expert_name || "-";
  const claimNum = dossierSnap.claimNumber || budget.dossier_claim_number || "-";

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 44 ${aY + 20} Td (ASSURANCE) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 7 Tf 44 ${aY + 11} Td (${pdfEscapeWinAnsi(insCompany)}) Tj ET`);

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 170 ${aY + 20} Td (N' SINISTRE) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 7 Tf 170 ${aY + 11} Td (${pdfEscapeWinAnsi(claimNum)}) Tj ET`);

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 290 ${aY + 20} Td (EXPERT) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 7 Tf 290 ${aY + 11} Td (${pdfEscapeWinAnsi(expertName)}) Tj ET`);

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 420 ${aY + 20} Td (SIGNATURE EXPERT) Tj ET`);
  content.push(`0.8 0.82 0.86 RG 0.5 w 420 ${aY + 8} 125 10 re s`);

  // 6. MULTI-TENANT WHITELABEL FOOTER (Y: 45 -> 15)
  content.push("0.1 0.12 0.16 RG 1 w");
  content.push("40 45 m 555 45 l S");

  content.push("BT 0.2 0.25 0.3 rg /F2 6 Tf 40 35 Td (" + pdfEscapeWinAnsi(companyName) + ") Tj ET");
  content.push("BT 0.3 0.35 0.4 rg /F1 5.5 Tf 40 27 Td (" + pdfEscapeWinAnsi(legalAddress + " - " + postalCity) + ") Tj ET");

  content.push("BT 0.2 0.25 0.3 rg /F2 6 Tf 230 35 Td (" + pdfEscapeWinAnsi("Tel: " + companyPhone + " | N' Vert: " + tollFree) + ") Tj ET");
  content.push("BT 0.3 0.35 0.4 rg /F1 5.5 Tf 230 27 Td (" + pdfEscapeWinAnsi(companyEmail + " - " + companyWebsite) + ") Tj ET");

  content.push("BT 0.2 0.25 0.3 rg /F2 6 Tf 475 35 Td (Version du:) Tj ET");
  content.push("BT 0.3 0.35 0.4 rg /F1 5.5 Tf 475 27 Td (" + pdfEscapeWinAnsi((new Date()).toISOString().slice(0, 10)) + ") Tj ET");

  return assemblePdf(content.join("\n"));
}

export function generateBudgetPdfBuffer(budget: any, rev: any, workspace?: any, inspection?: any): Buffer {
  const isPdr =
    rev?.budgetType === "pdr" ||
    budget?.budget_type === "pdr" ||
    (Array.isArray(inspection?.damagePoints) && inspection.damagePoints.length > 0) ||
    (Array.isArray(rev?.services) && rev.services.some((s: any) => {
      const d = String(s.name || s.description || "").toLowerCase();
      return d.includes("dsp") || d.includes("pdr") || d.includes("mossa") || d.includes("bosse") || d.includes("grele") || d.includes("granizo");
    }));

  if (isPdr) {
    return buildProtocoleDeReparationPdf(budget, rev, workspace, inspection);
  }

  const clientSnap = (rev?.clientSnapshot as any) || {};
  const currency = rev?.currencyCode || "EUR";

  const svcRows = (Array.isArray(rev?.services) ? rev?.services : []) as any[];
  const partRows = (Array.isArray(rev?.parts) ? rev?.parts : []) as any[];
  const laborRows = (Array.isArray(rev?.labor) ? rev?.labor : []) as any[];

  const items: BudgetPdfItem[] = [];
  for (const s of svcRows) {
    const isFixed = s.pricing_mode === "fixed" || s.pricingMode === "fixed";
    const qty = Math.max(1, Number(s.quantity ?? 1) || 1);
    const pu = Number(s.unit_price ?? s.unitPrice ?? s.price ?? 0) || 0;
    const lineTotal = Number(s.total) || (isFixed ? pu : qty * pu);
    items.push({
      type: "service",
      description: s.name || s.description || "Prestation générale",
      quantity: qty,
      unitPrice: pu,
      total: lineTotal,
    });
  }
  for (const p of partRows) {
    const qty = Math.max(1, Number(p.quantity ?? 1) || 1);
    const pu = Number(p.unit_price ?? p.unitPrice ?? p.price ?? 0) || 0;
    const lineTotal = Number(p.total) || (qty * pu);
    items.push({
      type: "part",
      description: p.description || p.name || "Pièce détachée",
      quantity: qty,
      unitPrice: pu,
      total: lineTotal,
    });
  }
  for (const l of laborRows) {
    const hours = Math.max(0.5, Number(l.hours ?? l.quantity ?? 1) || 1);
    const rate = Number(l.hourly_rate ?? l.hourlyRate ?? l.rate ?? l.unitPrice ?? 0) || 0;
    const lineTotal = Number(l.total) || (hours * rate);
    items.push({
      type: "labor",
      description: l.description || l.name || "Main d'œuvre",
      quantity: hours,
      unitPrice: rate,
      total: lineTotal,
    });
  }

  return buildBudgetDocumentPdf({
    code: budget.code,
    revisionNumber: rev?.revisionNumber ?? 1,
    status: rev?.status || budget.status,
    date: (rev?.createdAt ?? budget.createdAt).toISOString().slice(0, 10),
    client: {
      name: budget.clientName || clientSnap.name || "Client particulier",
      document: clientSnap.document || null,
      phone: clientSnap.phone || null,
      email: clientSnap.email || null,
      address: clientSnap.address?.street ? [clientSnap.address.street, clientSnap.address.postal, clientSnap.address.city].filter(Boolean).join(", ") : null,
    },
    vehicle: {
      brandModel: [budget.vehicleBrand, budget.vehicleModel].filter(Boolean).join(" ") || null,
      plate: budget.vehiclePlate || null,
      vin: budget.vehicleVin || null,
    },
    items,
    currency,
    grossTotal: Number(rev?.grossTotal ?? 0),
    discountPct: Number(rev?.discountPct ?? 0),
    discountTotal: Number(rev?.discountTotal ?? 0),
    taxPct: Number(rev?.taxPct ?? 0),
    taxTotal: Number(rev?.taxTotal ?? 0),
    finalTotal: Number(rev?.finalTotal ?? 0),
    signature: rev?.signature ? {
      signed: Boolean((rev.signature as any).signed),
      signerName: (rev.signature as any).signerName,
      signedAt: (rev.signature as any).signedAt,
    } : null,
  });
}
