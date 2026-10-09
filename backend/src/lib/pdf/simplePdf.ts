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

export function generateBudgetPdfBuffer(budget: any, rev: any): Buffer {
  const clientSnap = (rev?.clientSnapshot as any) || {};
  const currency = rev?.currencyCode || "EUR";

  const svcRows = (Array.isArray(rev?.services) ? rev?.services : []) as any[];
  const partRows = (Array.isArray(rev?.parts) ? rev?.parts : []) as any[];
  const laborRows = (Array.isArray(rev?.labor) ? rev?.labor : []) as any[];

  const items: BudgetPdfItem[] = [];
  for (const s of svcRows) {
    const qty = Math.max(1, Number(s.quantity ?? 1) || 1);
    const pu = Number(s.unit_price ?? s.unitPrice ?? s.price ?? 0) || 0;
    const lineTotal = Number(s.total) || (qty * pu);
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
