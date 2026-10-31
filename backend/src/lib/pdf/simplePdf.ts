import { s3 } from "../minio.js";
import { GetObjectCommand } from "@aws-sdk/client-s3";

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

export interface PdfImageObject {
  buffer: Buffer;
  width: number;
  height: number;
  format: "jpeg" | "png";
}

export function parseJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 8 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 8) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const h = buf.readUInt16BE(i + 5);
      const w = buf.readUInt16BE(i + 7);
      return { width: w, height: h };
    }
    const len = buf.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return null;
}

export async function loadWorkspaceLogo(logoUrl: string | null | undefined): Promise<PdfImageObject | null> {
  if (!logoUrl || typeof logoUrl !== "string") return null;
  const trimmed = logoUrl.trim();
  if (!trimmed) return null;

  try {
    let buf: Buffer | null = null;

    // 1. MinIO retrieval if stored in public logos bucket
    if (trimmed.includes("/logos/")) {
      const key = decodeURIComponent(trimmed.split(/\/logos\//)[1]);
      if (key) {
        try {
          const res = await s3.send(new GetObjectCommand({ Bucket: "logos", Key: key }));
          if (res.Body) {
            const chunks: Buffer[] = [];
            for await (const chunk of res.Body as any) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            buf = Buffer.concat(chunks);
          }
        } catch {
          // ignore fallback
        }
      }
    }

    // 2. Data URL
    if (!buf && trimmed.startsWith("data:")) {
      const parts = trimmed.split(",");
      if (parts.length > 1) {
        buf = Buffer.from(parts[1], "base64");
      }
    }

    // 3. HTTP / HTTPS fallback
    if (!buf && (trimmed.startsWith("http://") || trimmed.startsWith("https://"))) {
      const resp = await fetch(trimmed, { signal: AbortSignal.timeout(3000) });
      if (resp.ok) {
        buf = Buffer.from(await resp.arrayBuffer());
      }
    }

    if (!buf || buf.length < 16) return null;

    const jpegDims = parseJpegDimensions(buf);
    if (jpegDims && jpegDims.width > 0 && jpegDims.height > 0) {
      return { buffer: buf, width: jpegDims.width, height: jpegDims.height, format: "jpeg" };
    }

    return null;
  } catch {
    return null;
  }
}

function clipCell(text: string | null | undefined, maxChars: number): string {
  const s = String(text || "-").trim();
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars - 1).trim() + "...";
}

function splitTwoLines(
  text: string | null | undefined,
  maxLine1Chars: number,
  maxLine2Chars: number,
): { line1: string; line2?: string } {
  const raw = String(text || "-").trim();
  if (!raw || raw === "-") return { line1: "-" };
  if (raw.length <= maxLine1Chars) return { line1: raw };

  const words = raw.split(/\s+/);
  let line1 = "";
  let i = 0;
  for (; i < words.length; i++) {
    const candidate = line1 ? `${line1} ${words[i]}` : words[i];
    if (candidate.length <= maxLine1Chars) {
      line1 = candidate;
    } else {
      break;
    }
  }

  if (!line1) {
    line1 = raw.slice(0, maxLine1Chars);
    const rest = raw.slice(maxLine1Chars).trim();
    return {
      line1,
      line2: rest.length > maxLine2Chars ? rest.slice(0, maxLine2Chars - 1).trim() + "..." : rest,
    };
  }

  const remainder = words.slice(i).join(" ");
  if (!remainder) return { line1 };

  const line2 = remainder.length > maxLine2Chars ? remainder.slice(0, maxLine2Chars - 1).trim() + "..." : remainder;

  return { line1, line2 };
}

function assemblePdf(contentStream: string, image?: PdfImageObject | null): Buffer {
  const pageWidth = 595.28;
  const pageHeight = 841.89;

  const parts: (string | Buffer)[] = [];
  let offset = 0;
  const objOffsets: number[] = [0];

  const push = (chunk: string | Buffer, objIndex?: number) => {
    if (typeof objIndex === "number") objOffsets[objIndex] = offset;
    parts.push(chunk);
    offset += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk, "utf8");
  };

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n", 1);
  push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n", 2);

  const xobjectRes = image ? "/XObject << /Im1 7 0 R >>" : "";
  push(
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> ${xobjectRes} >> /Contents 6 0 R >>\nendobj\n`,
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

  let numObjects = 6;
  if (image) {
    numObjects = 7;
    const header = `7 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.buffer.length} >>\nstream\n`;
    const footer = "\nendstream\nendobj\n";
    push(header, 7);
    push(image.buffer);
    push(footer);
  }

  const xrefOffset = offset;
  let xref = `xref\n0 ${numObjects + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= numObjects; i += 1) {
    xref += String(objOffsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  const trailer = `trailer\n<< /Size ${numObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  push(xref);
  push(trailer);

  return Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p, "utf8"))));
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
export function buildBudgetDocumentPdf(doc: BudgetPdfDocument, langRaw: string = "pt"): Buffer {
  const lang = normalizePdfLang(langRaw);
  const content: string[] = [];

  const isApproved = doc.status === "approved";
  const docTitle = lang === "fr" ? "DEVIS" : lang === "en" ? "ESTIMATE" : lang === "es" ? "PRESUPUESTO" : lang === "de" ? "ANGEBOT" : lang === "it" ? "PREVENTIVO" : lang === "pl" ? "KOSZTORYS" : lang === "ru" ? "SMETA" : "ORCAMENTO";
  const systemSubtitle = lang === "fr" ? "Système de Gestion Opérationnelle & Atelier" : lang === "en" ? "Operational Management & Repair System" : lang === "es" ? "Sistema de Gestion Operacional & Taller" : "Sistema de Gestao Operacional & Oficina";
  const revDate = lang === "fr" ? `Révision ${doc.revisionNumber} · Date: ${doc.date}` : lang === "en" ? `Revision ${doc.revisionNumber} · Date: ${doc.date}` : `Revisao ${doc.revisionNumber} · Data: ${doc.date}`;
  const statusLabel = isApproved
    ? (lang === "fr" ? "STATUT : APPROUVÉ (CONFIRMÉ)" : lang === "en" ? "STATUS : APPROVED (CONFIRMED)" : "STATUS : APROVADO (CONFIRMADO)")
    : (lang === "fr" ? "STATUT : BROUILLON / EN COURS" : lang === "en" ? "STATUS : DRAFT / IN PROGRESS" : "STATUS : RASCUNHO / EM ANDAMENTO");

  const clientBoxTitle = lang === "fr" ? "CLIENT / DONNEUR D'ORDRE" : lang === "en" ? "CLIENT / ORDERING PARTY" : lang === "es" ? "CLIENTE / TOMADOR" : "CLIENTE / TOMADOR DO SERVICO";
  const clientDefaultName = lang === "fr" ? "Client particulier" : lang === "en" ? "Private Client" : "Cliente particular";
  const vehicleBoxTitle = lang === "fr" ? "VÉHICULE & DOSSIER" : lang === "en" ? "VEHICLE & CLAIM" : "VEICULO & PROCESSO";
  const vehicleDefault = lang === "fr" ? "Véhicule non spécifié" : lang === "en" ? "Unspecified Vehicle" : "Veiculo nao especificado";
  const lblPlate = lang === "fr" ? "Immatriculation:" : lang === "en" ? "License Plate:" : "Placa / Matricula:";
  const lblVin = lang === "fr" ? "N° de Châssis (VIN):" : lang === "en" ? "VIN / Chassis No.:" : "N' de Chassi (VIN):";
  const lblCurrency = lang === "fr" ? "Devise:" : lang === "en" ? "Currency:" : "Moeda:";

  const colDesc = lang === "fr" ? "DESCRIPTION DES PRESTATIONS / PIÈCES" : lang === "en" ? "DESCRIPTION OF SERVICES & PARTS" : "DESCRICAO DOS SERVICOS / PECAS";
  const colType = lang === "fr" ? "TYPE" : lang === "en" ? "TYPE" : "TIPO";
  const colQty = lang === "fr" ? "QTÉ" : lang === "en" ? "QTY" : "QTD";
  const colPu = lang === "fr" ? "P.U." : lang === "en" ? "UNIT PR." : "P.U.";
  const colTotal = "TOTAL";

  const lblGross = lang === "fr" ? "Total Brut H.T. :" : lang === "en" ? "Gross Subtotal :" : "Subtotal Bruto :";
  const lblDiscount = lang === "fr" ? "Remise" : lang === "en" ? "Discount" : "Desconto";
  const lblTax = lang === "fr" ? "TVA" : lang === "en" ? "VAT / Tax" : "IVA / Impostos";
  const lblFinal = lang === "fr" ? "TOTAL TTC :" : lang === "en" ? "TOTAL INCL. TAX :" : "TOTAL GERAL :";

  const lblClientSign = lang === "fr" ? "Bon pour accord et signature du Client" : lang === "en" ? "Approved and signed by Client" : "De acordo e assinatura do Cliente";
  const lblWorkshopSign = lang === "fr" ? "Pour Operix · Direction d'atelier" : lang === "en" ? "For Operix · Workshop Management" : "Por Operix · Direcao da oficina";
  const lblFooterDoc = lang === "fr" ? "Document officiel généré par Operix Platform. Valable 15 jours à compter de la date d'émission." : lang === "en" ? "Official document generated by Operix Platform. Valid for 15 days from issue date." : "Documento oficial gerado por Operix Platform. Valido por 15 dias a contar da data de emissao.";

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
  content.push(`(${pdfEscapeWinAnsi(systemSubtitle)}) Tj`);
  content.push("ET");

  // Header Right (Document & Code)
  content.push("BT");
  content.push("/F2 13 Tf");
  content.push("1 1 1 rg");
  content.push("380 786 Td");
  content.push(`(${pdfEscapeWinAnsi(`${docTitle} ${doc.code}`)}) Tj`);

  content.push("/F1 9 Tf");
  content.push("0 -12 Td");
  content.push(`(${pdfEscapeWinAnsi(revDate)}) Tj`);
  content.push("ET");

  // Status Badge
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
  content.push(`(${pdfEscapeWinAnsi(statusLabel)}) Tj`);
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
  content.push(`(${pdfEscapeWinAnsi(clientBoxTitle)}) Tj`);
  content.push("/F2 10 Tf");
  content.push("0 -14 Td");
  content.push(`(${pdfEscapeWinAnsi(doc.client.name || clientDefaultName)}) Tj`);
  content.push("/F1 8 Tf");
  content.push("0 -11 Td");
  content.push(`(${pdfEscapeWinAnsi(`Doc/SIREN: ${doc.client.document || "—"}`)}) Tj`);
  content.push("0 -10 Td");
  content.push(`(${pdfEscapeWinAnsi(`Tél: ${doc.client.phone || "—"} | Email: ${doc.client.email || "—"}`)}) Tj`);
  content.push("0 -10 Td");
  content.push(`(${pdfEscapeWinAnsi(`Endereço: ${doc.client.address || "—"}`)}) Tj`);
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
  content.push(`(${pdfEscapeWinAnsi(vehicleBoxTitle)}) Tj`);
  content.push("/F2 10 Tf");
  content.push("0 -14 Td");
  content.push(`(${pdfEscapeWinAnsi(doc.vehicle.brandModel || vehicleDefault)}) Tj`);
  content.push("/F1 8 Tf");
  content.push("0 -11 Td");
  content.push(`(${pdfEscapeWinAnsi(`${lblPlate} ${doc.vehicle.plate || "—"}`)}) Tj`);
  content.push("0 -10 Td");
  content.push(`(${pdfEscapeWinAnsi(`${lblVin} ${doc.vehicle.vin || "—"}`)}) Tj`);
  content.push("0 -10 Td");
  content.push(`(${pdfEscapeWinAnsi(`${lblCurrency} ${doc.currency}`)}) Tj`);
  content.push("ET");

  // 3. Table Header
  content.push("0.15 0.2 0.28 rg");
  content.push("40 615 515 20 re f");

  content.push("BT");
  content.push("/F2 9 Tf");
  content.push("1 1 1 rg");
  content.push("46 621 Td");
  content.push(`(${pdfEscapeWinAnsi(colDesc)}) Tj`);
  content.push("300 0 Td");
  content.push(`(${pdfEscapeWinAnsi(colType)}) Tj`);
  content.push("45 0 Td");
  content.push(`(${pdfEscapeWinAnsi(colQty)}) Tj`);
  content.push("40 0 Td");
  content.push(`(${pdfEscapeWinAnsi(colPu)}) Tj`);
  content.push("50 0 Td");
  content.push(`(${pdfEscapeWinAnsi(colTotal)}) Tj`);
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
  content.push(`(${pdfEscapeWinAnsi(`${lblGross}`)}) Tj`);
  content.push(`140 0 Td (${Number(doc.grossTotal || 0).toFixed(2)} ${currency}) Tj`);

  content.push("-140 -12 Td");
  content.push(`(${pdfEscapeWinAnsi(`${lblDiscount} (${Number(doc.discountPct || 0)}%) :`)}) Tj`);
  content.push(`140 0 Td (-${Number(doc.discountTotal || 0).toFixed(2)} ${currency}) Tj`);

  content.push("-140 -12 Td");
  content.push(`(${pdfEscapeWinAnsi(`${lblTax} (${Number(doc.taxPct || 0)}%) :`)}) Tj`);
  content.push(`140 0 Td (+${Number(doc.taxTotal || 0).toFixed(2)} ${currency}) Tj`);

  content.push("-140 -15 Td");
  content.push("/F2 10 Tf");
  content.push("0.05 0.1 0.2 rg");
  content.push(`(${pdfEscapeWinAnsi(lblFinal)}) Tj`);
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
  content.push(`(${pdfEscapeWinAnsi(lblClientSign)}) Tj`);

  if (doc.signature && doc.signature.signed) {
    content.push("0 -10 Td");
    content.push("/F2 8 Tf");
    content.push("0.08 0.58 0.28 rg");
    content.push(`(${pdfEscapeWinAnsi(`[Signé électr. par ${doc.signature.signerName || "Client"} le ${(doc.signature.signedAt || "").slice(0, 10)}]`)}) Tj`);
  }

  content.push("275 10 Td");
  content.push("0.4 0.45 0.5 rg");
  content.push("/F1 8 Tf");
  content.push(`(${pdfEscapeWinAnsi(lblWorkshopSign)}) Tj`);
  content.push("ET");

  // 7. Footer
  content.push("BT");
  content.push("0.5 0.55 0.6 rg");
  content.push("/F1 7 Tf");
  content.push("40 32 Td");
  content.push(`(${pdfEscapeWinAnsi(lblFooterDoc)}) Tj`);
  content.push("ET");

  return assemblePdf(content.join("\n"));
}


const BACKEND_DENT_SIZE_MULTIPLIERS: Record<string, number> = {
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
  const sizeMult = BACKEND_DENT_SIZE_MULTIPLIERS[String(sizeCode)] ?? 1.0;
  return Math.round(baseUt * sizeMult * 100) / 100;
}

export type SupportedPdfLang = "pt" | "fr" | "en" | "es" | "de" | "it" | "pl" | "ru";

export function normalizePdfLang(raw?: string | null): SupportedPdfLang {
  if (!raw) return "pt";
  const s = String(raw).toLowerCase().trim();
  if (s.startsWith("pt")) return "pt";
  if (s.startsWith("fr")) return "fr";
  if (s.startsWith("en")) return "en";
  if (s.startsWith("es")) return "es";
  if (s.startsWith("de")) return "de";
  if (s.startsWith("it")) return "it";
  if (s.startsWith("pl")) return "pl";
  if (s.startsWith("ru")) return "ru";
  if (s.startsWith("hi") || s.startsWith("in")) return "en";
  return "pt";
}

const BACKEND_PROTOCOLE_I18N: Record<SupportedPdfLang, {
  titleText: string;
  defaultTagline: string;
  noPlate: string;
  lblClient: string;
  lblBrand: string;
  lblPlate: string;
  lblProto: string;
  lblAddr: string;
  lblModel: string;
  lblVin: string;
  lblDateStart: string;
  lblPhone: string;
  lblColor: string;
  lblKm: string;
  lblDateEnd: string;
  colComp: string;
  colDents: string;
  colSize: string;
  colUt: string;
  colGlue: string;
  colSumUt: string;
  colPaint: string;
  colNew: string;
  colPrice: string;
  lblTotalDsp: string;
  footnoteText: string;
  lblPaintTable: string;
  lblPaintComment: string;
  lblPaintHeader: string;
  paintElemHood: string;
  paintElemTrunk: string;
  paintElemRail: string;
  lblSum: string;
  lblPaintBar: string;
  box1Title: string;
  box1L1: string;
  box1L2: string;
  box1L3: string;
  box2Title: string;
  box3Title: string;
  box4Title: string;
  lblSubtotal: string;
  lblAssHeader: string;
  lblBoxAss: string;
  lblBoxSin: string;
  lblBoxExp: string;
  lblBoxSig: string;
}> = {
  pt: {
    titleText: "PROTOCOLO DE REPARACAO",
    defaultTagline: "GESTAO E REPARACAO DE DANOS DE GRANIZO",
    noPlate: "SEM PLACA",
    lblClient: "NOME DO CLIENTE",
    lblBrand: "MARCA",
    lblPlate: "PLACA / MATRICULA",
    lblProto: "N' DE PROTOCOLO",
    lblAddr: "ENDERECO / CIDADE",
    lblModel: "MODELO",
    lblVin: "N' DE CHASSI (VIN)",
    lblDateStart: "DATA INICIO REPARACAO",
    lblPhone: "N' TEL.",
    lblColor: "COR",
    lblKm: "QUILOMETRAGEM",
    lblDateEnd: "DATA FIM REPARACAO",
    colComp: "Componentes",
    colDents: "Nb. mossas",
    colSize: "Tamanho mm",
    colUt: "UT",
    colGlue: "Cola",
    colSumUt: "Soma UT",
    colPaint: "Pint",
    colNew: "Nova",
    colPrice: "Preco EUR",
    lblTotalDsp: "TOTAL PDR / GRANIZO",
    footnoteText: "Opcoes: AR = Anti-ferrugem, BHN = Mossas Fora do Padrao, I = Inducao, VHN = Veiculo Fora do Padrao",
    lblPaintTable: "Elemento",
    lblPaintComment: "Observacao",
    lblPaintHeader: "Pintura 36,00 EUR/h",
    paintElemHood: "Capo",
    paintElemTrunk: "Tampa sup.",
    paintElemRail: "Coluna Esq.",
    lblSum: "Soma",
    lblPaintBar: "Total Pintura / M.O.",
    box1Title: "TARIFAS E PARAMETROS",
    box1L1: "- Aluminio : +25% | Cola : +25%",
    box1L2: "- DAP : -40% sobre a peca",
    box1L3: "- Taxa PDR : 90.00 EUR | 10UT = 1H",
    box2Title: "OPCOES ADICIONAIS",
    box3Title: "DESMONTAGEM / MONTAGEM",
    box4Title: "VALOR TOTAL",
    lblSubtotal: "Subtotal (S/ IVA) : ",
    lblAssHeader: "SEGURO / EXTENSAO DE DANOS",
    lblBoxAss: "SEGURADORA",
    lblBoxSin: "N' SINISTRO",
    lblBoxExp: "PERITO",
    lblBoxSig: "ASSINATURA DO PERITO",
  },
  fr: {
    titleText: "PROTOCOLE DE REPARATION",
    defaultTagline: "GESTION ET REPARATION DES SINISTRES GRELE",
    noPlate: "SANS-PLAQUE",
    lblClient: "NOM CLIENT",
    lblBrand: "MARQUE",
    lblPlate: "PLAQUE D'IMMATRICULATION",
    lblProto: "N' DE PROTOCOLE",
    lblAddr: "ADRESSE / VILLE",
    lblModel: "MODELE",
    lblVin: "N' DE CHASSIS (VIN)",
    lblDateStart: "DATE DEBUT REPARATION",
    lblPhone: "N' TEL.",
    lblColor: "COULEUR",
    lblKm: "KILOMETRAGE",
    lblDateEnd: "DATE FIN REPARATION",
    colComp: "Composants",
    colDents: "Nb. bosses",
    colSize: "Taille mm",
    colUt: "UT",
    colGlue: "Colle",
    colSumUt: "Somme UT",
    colPaint: "Peint",
    colNew: "Nouv",
    colPrice: "Prix EUR",
    lblTotalDsp: "TOTAL DSP",
    footnoteText: "Option : AR = Anti-rouille, BHN = Bosses Hors Norme, I = Induction, VHN = Vehicule Hors Norme",
    lblPaintTable: "Element",
    lblPaintComment: "Commentaire",
    lblPaintHeader: "Peinture 36,00 EUR/h",
    paintElemHood: "Capot",
    paintElemTrunk: "Coffre superieur",
    paintElemRail: "Brancard G",
    lblSum: "Somme",
    lblPaintBar: "Total Peinture / MO",
    box1Title: "TARIFICATION",
    box1L1: "- Aluminium : +25% | Colle : +25%",
    box1L2: "- DAP : -40% sur element",
    box1L3: "- Taux PDR : 90.00 EUR | 10UT = 1H",
    box2Title: "OPTIONS SUPPLEMENTAIRES",
    box3Title: "FORFAIT DEGARNISSAGE",
    box4Title: "PRIX TOTAL",
    lblSubtotal: "Total HT : ",
    lblAssHeader: "ASSURANCE / EXTENSION DES DOMMAGES",
    lblBoxAss: "ASSURANCE",
    lblBoxSin: "N' SINISTRE",
    lblBoxExp: "EXPERT",
    lblBoxSig: "SIGNATURE EXPERT",
  },
  en: {
    titleText: "REPAIR PROTOCOL",
    defaultTagline: "HAIL DAMAGE MANAGEMENT & REPAIR",
    noPlate: "NO PLATE",
    lblClient: "CLIENT NAME",
    lblBrand: "BRAND",
    lblPlate: "LICENSE PLATE",
    lblProto: "PROTOCOL NO.",
    lblAddr: "ADDRESS / CITY",
    lblModel: "MODEL",
    lblVin: "VIN / CHASSIS NO.",
    lblDateStart: "REPAIR START DATE",
    lblPhone: "PHONE NO.",
    lblColor: "COLOR",
    lblKm: "MILEAGE",
    lblDateEnd: "REPAIR END DATE",
    colComp: "Components",
    colDents: "Dent count",
    colSize: "Size mm",
    colUt: "TU",
    colGlue: "Glue",
    colSumUt: "Total TU",
    colPaint: "Paint",
    colNew: "New",
    colPrice: "Price EUR",
    lblTotalDsp: "TOTAL PDR",
    footnoteText: "Option: AR = Anti-rust, BHN = Non-standard Dents, I = Induction, VHN = Non-standard Vehicle",
    lblPaintTable: "Element",
    lblPaintComment: "Comment",
    lblPaintHeader: "Paint 36,00 EUR/h",
    paintElemHood: "Hood",
    paintElemTrunk: "Upper trunk",
    paintElemRail: "Left Rail",
    lblSum: "Sum",
    lblPaintBar: "Total Paint / Labor",
    box1Title: "PRICING & RATES",
    box1L1: "- Aluminum : +25% | Glue : +25%",
    box1L2: "- DAP : -40% on element",
    box1L3: "- PDR Rate : 90.00 EUR | 10TU = 1H",
    box2Title: "ADDITIONAL OPTIONS",
    box3Title: "DISASSEMBLY / ASSEMBLY",
    box4Title: "TOTAL PRICE",
    lblSubtotal: "Total Excl. Tax : ",
    lblAssHeader: "INSURANCE & CLAIM EXTENSION",
    lblBoxAss: "INSURANCE CO.",
    lblBoxSin: "CLAIM NO.",
    lblBoxExp: "SURVEYOR / EXPERT",
    lblBoxSig: "EXPERT SIGNATURE",
  },
  es: {
    titleText: "PROTOCOLO DE REPARACION",
    defaultTagline: "GESTION Y REPARACION DE DANOS POR GRANIZO",
    noPlate: "SIN MATRICULA",
    lblClient: "NOMBRE CLIENTE",
    lblBrand: "MARCA",
    lblPlate: "MATRICULA",
    lblProto: "N' DE PROTOCOLO",
    lblAddr: "DIRECCION / CIUDAD",
    lblModel: "MODELO",
    lblVin: "N' DE BASTIDOR (VIN)",
    lblDateStart: "FECHA INICIO REPARACION",
    lblPhone: "N' TEL.",
    lblColor: "COLOR",
    lblKm: "KILOMETRAJE",
    lblDateEnd: "FECHA FIN REPARACION",
    colComp: "Componentes",
    colDents: "Num. abolladuras",
    colSize: "Tamano mm",
    colUt: "UT",
    colGlue: "Pegamento",
    colSumUt: "Suma UT",
    colPaint: "Pint",
    colNew: "Nueva",
    colPrice: "Precio EUR",
    lblTotalDsp: "TOTAL PDR / GRANIZO",
    footnoteText: "Opciones: AR = Antioxidante, BHN = Abolladuras Fuera de Norma, I = Induccion, VHN = Vehiculo Fuera de Norma",
    lblPaintTable: "Elemento",
    lblPaintComment: "Comentario",
    lblPaintHeader: "Pintura 36,00 EUR/h",
    paintElemHood: "Capo",
    paintElemTrunk: "Maletero sup.",
    paintElemRail: "Larguero Izq.",
    lblSum: "Suma",
    lblPaintBar: "Total Pintura / M.O.",
    box1Title: "TARIFAS Y PARAMETROS",
    box1L1: "- Aluminio : +25% | Pegamento : +25%",
    box1L2: "- DAP : -40% sobre pieza",
    box1L3: "- Tarifa PDR : 90.00 EUR | 10UT = 1H",
    box2Title: "OPCIONES ADICIONALES",
    box3Title: "DESMONTAJE / MONTAJE",
    box4Title: "PRECIO TOTAL",
    lblSubtotal: "Subtotal (sin IVA) : ",
    lblAssHeader: "SEGURO / EXTENSION DE DANOS",
    lblBoxAss: "ASEGURADORA",
    lblBoxSin: "N' SINIESTRO",
    lblBoxExp: "PERITO",
    lblBoxSig: "FIRMA DEL PERITO",
  },
  de: {
    titleText: "REPARATURPROTOKOLL",
    defaultTagline: "HAGELSCHADENMANAGEMENT UND REPARATUR",
    noPlate: "OHNE KENNZEICHEN",
    lblClient: "KUNDENNAME",
    lblBrand: "MARKE",
    lblPlate: "KENNZEICHEN",
    lblProto: "PROTOKOLL-NR.",
    lblAddr: "ADRESSE / STADT",
    lblModel: "MODELL",
    lblVin: "FAHRGESTELL-NR. (VIN)",
    lblDateStart: "REPARATURBEGINN",
    lblPhone: "TEL.-NR.",
    lblColor: "FARBE",
    lblKm: "KILOMETERSTAND",
    lblDateEnd: "REPARATURENDE",
    colComp: "Bauteile",
    colDents: "Anz. Dellen",
    colSize: "Grosse mm",
    colUt: "AW",
    colGlue: "Kleber",
    colSumUt: "Summe AW",
    colPaint: "Lack",
    colNew: "Neu",
    colPrice: "Preis EUR",
    lblTotalDsp: "GESAMT PDR / HAGEL",
    footnoteText: "Optionen: AR = Rostschutz, BHN = Dellen a.d. Norm, I = Induktion, VHN = Fzg. a.d. Norm",
    lblPaintTable: "Element",
    lblPaintComment: "Kommentar",
    lblPaintHeader: "Lackierung 36,00 EUR/h",
    paintElemHood: "Motorhaube",
    paintElemTrunk: "Heckklappe oben",
    paintElemRail: "Dachholm links",
    lblSum: "Summe",
    lblPaintBar: "Gesamt Lackierung / Montage",
    box1Title: "PREISE & PARAMETER",
    box1L1: "- Aluminium : +25% | Kleber : +25%",
    box1L2: "- DAP : -40% auf Bauteil",
    box1L3: "- PDR Satz : 90.00 EUR | 10AW = 1H",
    box2Title: "ZUSATZOPTIONEN",
    box3Title: "MONTAGE / DEMONTAGE",
    box4Title: "GESAMTPREIS",
    lblSubtotal: "Nettobetrag : ",
    lblAssHeader: "VERSICHERUNG / SCHADENSERWEITERUNG",
    lblBoxAss: "VERSICHERUNG",
    lblBoxSin: "SCHADEN-NR.",
    lblBoxExp: "GUTACHTER",
    lblBoxSig: "UNTERSCHRIFT DES GUTACHTERS",
  },
  it: {
    titleText: "PROTOCOLLO DI RIPARAZIONE",
    defaultTagline: "GESTIONE E RIPARAZIONE DANNI DA GRANDINE",
    noPlate: "SENZA TARGA",
    lblClient: "NOME CLIENTE",
    lblBrand: "MARCA",
    lblPlate: "TARGA",
    lblProto: "N' PROTOCOLLO",
    lblAddr: "INDIRIZZO / CITTA",
    lblModel: "MODELLO",
    lblVin: "N' TELAIO (VIN)",
    lblDateStart: "DATA INIZIO RIPARAZIONE",
    lblPhone: "N' TEL.",
    lblColor: "COLORE",
    lblKm: "CHILOMETRAGGIO",
    lblDateEnd: "DATA FINE RIPARAZIONE",
    colComp: "Componenti",
    colDents: "Num. bolli",
    colSize: "Misura mm",
    colUt: "UT",
    colGlue: "Colla",
    colSumUt: "Somma UT",
    colPaint: "Vern",
    colNew: "Nuov",
    colPrice: "Prezzo EUR",
    lblTotalDsp: "TOTALE TIRABOLLI",
    footnoteText: "Opzioni: AR = Antiruggine, BHN = Bolli Fuori Norma, I = Induzione, VHN = Veicolo Fuori Norma",
    lblPaintTable: "Elemento",
    lblPaintComment: "Commento",
    lblPaintHeader: "Verniciatura 36,00 EUR/h",
    paintElemHood: "Cofano",
    paintElemTrunk: "Baule sup.",
    paintElemRail: "Montante Sx",
    lblSum: "Somma",
    lblPaintBar: "Totale Verniciatura / M.O.",
    box1Title: "TARIFFE E PARAMETRI",
    box1L1: "- Alluminio : +25% | Colla : +25%",
    box1L2: "- DAP : -40% su elemento",
    box1L3: "- Tariffa PDR : 90.00 EUR | 10UT = 1H",
    box2Title: "OPZIONI AGGIUNTIVE",
    box3Title: "SMONTAGGIO / RIMONTAGGIO",
    box4Title: "PREZZO TOTALE",
    lblSubtotal: "Totale imponibile : ",
    lblAssHeader: "ASSICURAZIONE / ESTENSIONE DANNI",
    lblBoxAss: "ASSICURAZIONE",
    lblBoxSin: "N' SINISTRO",
    lblBoxExp: "PERITO",
    lblBoxSig: "FIRMA DEL PERITO",
  },
  pl: {
    titleText: "PROTOKOL NAPRAWY",
    defaultTagline: "ZARZADZANIE I NAPRAWA SZKOD GRADOWYCH",
    noPlate: "BRAK TABLICY",
    lblClient: "NAZWISKO KLIENTA",
    lblBrand: "MARKA",
    lblPlate: "NUMER REJESTRACYJNY",
    lblProto: "NR PROTOKOLU",
    lblAddr: "ADRES / MIASTO",
    lblModel: "MODEL",
    lblVin: "NR VIN",
    lblDateStart: "DATA ROZPOCZECIA NAPRAWY",
    lblPhone: "NR TEL.",
    lblColor: "KOLOR",
    lblKm: "PRZEBIEG",
    lblDateEnd: "DATA ZAKONCZENIA NAPRAWY",
    colComp: "Elementy",
    colDents: "Liczba wgniecen",
    colSize: "Rozmiar mm",
    colUt: "UT",
    colGlue: "Klej",
    colSumUt: "Suma UT",
    colPaint: "Lak",
    colNew: "Nowy",
    colPrice: "Cena EUR",
    lblTotalDsp: "LACZNIE PDR",
    footnoteText: "Opcje: AR = Antykorozja, BHN = Wgniecenia Niestandardowe, I = Indukcja, VHN = Pojazd Niestandardowy",
    lblPaintTable: "Element",
    lblPaintComment: "Komentarz",
    lblPaintHeader: "Lakierowanie 36,00 EUR/h",
    paintElemHood: "Maska",
    paintElemTrunk: "Klapa bagaznika gora",
    paintElemRail: "Reling lewy",
    lblSum: "Suma",
    lblPaintBar: "Lacznie Lakierowanie / Montaz",
    box1Title: "CENNIK I PARAMETRY",
    box1L1: "- Aluminium : +25% | Klej : +25%",
    box1L2: "- DAP : -40% na element",
    box1L3: "- Stawka PDR : 90.00 EUR | 10UT = 1H",
    box2Title: "OPCJE DODATKOWE",
    box3Title: "DEMONTAZ / MONTAZ",
    box4Title: "CENA CALKOWITA",
    lblSubtotal: "Netto : ",
    lblAssHeader: "UBEZPIECZENIE / ROZSZERZENIE SZKODY",
    lblBoxAss: "UBEZPIECZYCIEL",
    lblBoxSin: "NR SZKODY",
    lblBoxExp: "RZECZOZNAWCA",
    lblBoxSig: "PODPIS RZECZOZNAWCY",
  },
  ru: {
    titleText: "PROTOKOL REMONTA",
    defaultTagline: "UPRAVLENIE I REMONT POSLE GRADA",
    noPlate: "BEZ NOMERA",
    lblClient: "IMYA KLIENTA",
    lblBrand: "MARKA",
    lblPlate: "GOSNOMER",
    lblProto: "NOMER PROTOKOLA",
    lblAddr: "ADRES / GOROD",
    lblModel: "MODEL",
    lblVin: "NOMER VIN",
    lblDateStart: "DATA NACHALA REMONTA",
    lblPhone: "TEL.",
    lblColor: "CVET",
    lblKm: "PROBEG",
    lblDateEnd: "DATA OKONCHANIYA REMONTA",
    colComp: "Komponenty",
    colDents: "Kol-vo vmyatin",
    colSize: "Razmer mm",
    colUt: "UT",
    colGlue: "Kley",
    colSumUt: "Summa UT",
    colPaint: "Okr",
    colNew: "Nov",
    colPrice: "Cena EUR",
    lblTotalDsp: "ITOGO PDR",
    footnoteText: "Opcionno: AR = Antikor, BHN = Nestandartnye Vmyatiny, I = Indukciya, VHN = Nestandartnoe Avto",
    lblPaintTable: "Element",
    lblPaintComment: "Kommentariy",
    lblPaintHeader: "Pokraska 36,00 EUR/h",
    paintElemHood: "Kapot",
    paintElemTrunk: "Bagazhnik verkh",
    paintElemRail: "Levaja stojka",
    lblSum: "Summa",
    lblPaintBar: "Itogo Pokraska / M.O.",
    box1Title: "TARIFY I PARAMETRY",
    box1L1: "- Alyuminiy : +25% | Kley : +25%",
    box1L2: "- DAP : -40% za element",
    box1L3: "- Stavka PDR : 90.00 EUR | 10UT = 1H",
    box2Title: "DOP. OPCII",
    box3Title: "DEMONTAZH / SBORKA",
    box4Title: "OBSHHAJA STOIMOST",
    lblSubtotal: "Itogo bez NDS : ",
    lblAssHeader: "STRAKHOVANIE / RASSHIRENIE USHHERBA",
    lblBoxAss: "STRAKHOVAJA KOMPANIJA",
    lblBoxSin: "NOMER STRAKHOVOGO SLUCHAJA",
    lblBoxExp: "EKSPERT",
    lblBoxSig: "PODPIS EKSPERTA",
  },
};

const BACKEND_PROTOCOLE_ZONES = [
  {
    key: "horizontaux",
    title: {
      fr: "COMPOSANTS HORIZONTAUX",
      pt: "COMPONENTES HORIZONTAIS",
      en: "HORIZONTAL COMPONENTS",
      es: "COMPONENTES HORIZONTALES",
      de: "HORIZONTALE BAUTEILE",
      it: "COMPONENTI ORIZZONTALI",
      pl: "ELEMENTY POZIOME",
      ru: "GORIZONTALNYE DETALI",
    },
    parts: [
      {
        code: "hood",
        label: {
          fr: "Capot",
          pt: "Capô",
          en: "Hood",
          es: "Capó",
          de: "Motorhaube",
          it: "Cofano",
          pl: "Maska",
          ru: "Kapot",
        },
        match: ["capot", "capô", "capo", "hood", "motorhaube", "maska"],
      },
      {
        code: "roof",
        label: {
          fr: "Pavillon",
          pt: "Teto",
          en: "Roof",
          es: "Techo",
          de: "Dach",
          it: "Tetto",
          pl: "Dach",
          ru: "Krysha",
        },
        match: ["pavillon", "teto", "toit", "roof", "techo", "dach"],
      },
      {
        code: "trunk",
        label: {
          fr: "Coffre superieur",
          pt: "Tampa sup.",
          en: "Upper trunk",
          es: "Maletero sup.",
          de: "Heckklappe oben",
          it: "Baule sup.",
          pl: "Klapa bagaznika gora",
          ru: "Bagazhnik verkh",
        },
        match: ["coffre superieur", "coffre", "malle", "porta-malas", "trunk", "tampa do porta-malas", "tampa sup", "maletero sup"],
      },
      {
        code: "tailgate",
        label: {
          fr: "Coffre inferieur",
          pt: "Tampa inf.",
          en: "Lower tailgate",
          es: "Maletero inf.",
          de: "Heckklappe unten",
          it: "Baule inf.",
          pl: "Klapa bagaznika dol",
          ru: "Bagazhnik niz",
        },
        match: ["coffre inferieur", "coffre inférieur", "tampa inf", "tailgate", "tampa traseira", "maletero inf"],
      },
    ],
  },
  {
    key: "gauche",
    title: {
      fr: "COTE GAUCHE",
      pt: "LADO ESQUERDO",
      en: "LEFT SIDE",
      es: "LADO IZQUIERDO",
      de: "LINKE SEITE",
      it: "LATO SINISTRO",
      pl: "LEWA STRONA",
      ru: "LEVAJA STORONA",
    },
    parts: [
      {
        code: "left_rail",
        label: {
          fr: "Brancard G",
          pt: "Coluna Esq. (Brancard)",
          en: "Left Rail",
          es: "Larguero Izq.",
          de: "Dachholm links",
          it: "Montante Sx",
          pl: "Reling lewy",
          ru: "Levaja stojka",
        },
        match: ["brancard g", "coluna / arco superior esquerdo", "arco superior esquerdo", "coluna esq", "rail g", "left rail", "coluna esquerda", "larguero izq"],
      },
      {
        code: "front_left_fender",
        label: {
          fr: "Aile AVG",
          pt: "Para-lama D.E.",
          en: "Front Left Fender",
          es: "Aleta Del. Izq.",
          de: "Kotflugel vorne links",
          it: "Parafango Ant. Sx",
          pl: "Blotnik przod lewy",
          ru: "Krylo pered. levoe",
        },
        match: ["aile avg", "para-lama dianteiro esquerdo", "paralama dianteiro esquerdo", "para-lama d. e", "aile avant gauche", "front left fender", "aleta del izq"],
      },
      {
        code: "front_left_door",
        label: {
          fr: "Porte AVG",
          pt: "Porta D.E.",
          en: "Front Left Door",
          es: "Puerta Del. Izq.",
          de: "Tur vorne links",
          it: "Portiera Ant. Sx",
          pl: "Drzwi przod lewe",
          ru: "Dver pered. levaja",
        },
        match: ["porte avg", "porta dianteira esquerda", "porta d. e", "porte avant gauche", "front left door", "puerta del izq"],
      },
      {
        code: "rear_left_door",
        label: {
          fr: "Porte ARG",
          pt: "Porta T.E.",
          en: "Rear Left Door",
          es: "Puerta Tras. Izq.",
          de: "Tur hinten links",
          it: "Portiera Post. Sx",
          pl: "Drzwi tyl lewe",
          ru: "Dver zadn. levaja",
        },
        match: ["porte arg", "porta traseira esquerda", "porta t. e", "porte arrière gauche", "rear left door", "puerta tras izq"],
      },
      {
        code: "rear_left_quarter",
        label: {
          fr: "Aile ARG",
          pt: "Lateral T.E.",
          en: "Rear Left Quarter",
          es: "Aleta Tras. Izq.",
          de: "Seitenwand hinten links",
          it: "Fiancata Post. Sx",
          pl: "Bok tyl lewy",
          ru: "Bok zadn. levyj",
        },
        match: ["aile arg", "lateral / para-lama traseiro esquerdo", "lateral traseira esquerda", "lateral t. e", "aile arrière gauche", "rear left quarter", "aleta tras izq"],
      },
    ],
  },
  {
    key: "droit",
    title: {
      fr: "COTE DROIT",
      pt: "LADO DIREITO",
      en: "RIGHT SIDE",
      es: "LADO DERECHO",
      de: "RECHTE SEITE",
      it: "LATO DESTRO",
      pl: "PRAWA STRONA",
      ru: "PRAVAJA STORONA",
    },
    parts: [
      {
        code: "right_rail",
        label: {
          fr: "Brancard D",
          pt: "Coluna Dir. (Brancard)",
          en: "Right Rail",
          es: "Larguero Der.",
          de: "Dachholm rechts",
          it: "Montante Dx",
          pl: "Reling prawy",
          ru: "Pravaja stojka",
        },
        match: ["brancard d", "coluna / arco superior direito", "arco superior direito", "coluna dir", "rail d", "right rail", "coluna direita", "larguero der"],
      },
      {
        code: "front_right_fender",
        label: {
          fr: "Aile AVD",
          pt: "Para-lama D.D.",
          en: "Front Right Fender",
          es: "Aleta Del. Der.",
          de: "Kotflugel vorne rechts",
          it: "Parafango Ant. Dx",
          pl: "Blotnik przod prawy",
          ru: "Krylo pered. pravoe",
        },
        match: ["aile avd", "para-lama dianteiro direito", "paralama dianteiro direito", "para-lama d. d", "aile avant droite", "front right fender", "aleta del der"],
      },
      {
        code: "front_right_door",
        label: {
          fr: "Porte AVD",
          pt: "Porta D.D.",
          en: "Front Right Door",
          es: "Puerta Del. Der.",
          de: "Tur vorne rechts",
          it: "Portiera Ant. Dx",
          pl: "Drzwi przod prawe",
          ru: "Dver pered. pravaja",
        },
        match: ["porte avd", "porta dianteira direita", "porta d. d", "porte avant droite", "front right door", "puerta del der"],
      },
      {
        code: "rear_right_door",
        label: {
          fr: "Porte ARD",
          pt: "Porta T.D.",
          en: "Rear Right Door",
          es: "Puerta Tras. Der.",
          de: "Tur hinten rechts",
          it: "Portiera Post. Dx",
          pl: "Drzwi tyl prawe",
          ru: "Dver zadn. pravaja",
        },
        match: ["porte ard", "porta traseira direita", "porta t. d", "porte arrière droite", "rear right door", "puerta tras der"],
      },
      {
        code: "rear_right_quarter",
        label: {
          fr: "Aile ARD",
          pt: "Lateral T.D.",
          en: "Rear Right Quarter",
          es: "Aleta Tras. Der.",
          de: "Seitenwand hinten rechts",
          it: "Fiancata Post. Dx",
          pl: "Bok tyl prawy",
          ru: "Bok zadn. pravyj",
        },
        match: ["aile ard", "lateral / para-lama traseiro direito", "lateral traseira direita", "lateral t. d", "aile arrière droite", "rear right quarter", "aleta tras der"],
      },
    ],
  },
];

export function buildProtocoleDeReparationPdf(
  budget: any,
  rev: any,
  workspace?: any,
  inspection?: any,
  logoImage?: PdfImageObject | null,
  langRaw: string = "pt",
): Buffer {
  const lang = normalizePdfLang(langRaw);
  const i18n = BACKEND_PROTOCOLE_I18N[lang] || BACKEND_PROTOCOLE_I18N.pt;
  const content: string[] = [];
  const brand = workspace?.brandConfig || {};
  const companyName = brand.legalName || brand.name || workspace?.billingProfile?.companyName || workspace?.billingProfile?.legalName || workspace?.name || "PDR-Team SAS";
  const defaultTagline = i18n.defaultTagline;
  const tagline = brand.tagline || defaultTagline;
  const legalAddress = brand.address || workspace?.billingProfile?.billingAddress || "388 Rue Louis Joseph Gay Lussac";
  const postalCity = [brand.postalCode || workspace?.billingProfile?.postalCode || "26100", brand.city || workspace?.billingProfile?.city || "Romans sur Isere"].filter(Boolean).join(" ");
  const companyPhone = brand.phone || "04 87 20 01 47";
  const tollFree = brand.tollFree || companyPhone;
  const companyEmail = brand.email || workspace?.billingProfile?.billingEmail || "info@pdr-team.fr";
  const companyWebsite = brand.website || "www.pdr-team.fr";

  const clientSnap = (rev?.clientSnapshot as any) || {};
  const vehiclePlate = String(budget.vehiclePlate || i18n.noPlate).toUpperCase();
  const protocolCode = budget.code || "FR-PFAN";

  // 1. TOP HEADER & TITLE (Raised higher with minimal top margin)
  const titleText = i18n.titleText;
  content.push("0.1 0.12 0.16 rg");
  content.push("310 794 245 28 re f");

  content.push("BT");
  content.push("1 1 1 rg");
  content.push("/F2 11.5 Tf");
  content.push("322 804 Td");
  content.push(`(${pdfEscapeWinAnsi(titleText)}) Tj`);
  content.push("ET");

  // Red plate badge (centered text, never overflowing)
  const plateText = vehiclePlate;
  const plateW = plateText.length * 6.2;
  const badgeW = Math.max(96, plateW + 20);
  const badgeX = 555 - badgeW;
  const badgeY = 766;
  const badgeH = 20;

  content.push("0.98 0.94 0.94 rg");
  content.push(`${badgeX.toFixed(1)} ${badgeY} ${badgeW.toFixed(1)} ${badgeH} re f`);
  content.push("0.85 0.15 0.15 RG 1.5 w");
  content.push(`${badgeX.toFixed(1)} ${badgeY} ${badgeW.toFixed(1)} ${badgeH} re s`);

  const textX = badgeX + (badgeW - plateW) / 2;
  content.push("BT");
  content.push("0.75 0.1 0.1 rg");
  content.push("/F2 10 Tf");
  content.push(`${textX.toFixed(1)} ${badgeY + 6} Td`);
  content.push(`(${pdfEscapeWinAnsi(plateText)}) Tj`);
  content.push("ET");

  // Company Brand / Logo on Left (Enlarged up to maxW 260, maxH 70)
  if (logoImage) {
    const maxW = 260;
    const maxH = 70;
    const aspect = (logoImage.width || 1) / (logoImage.height || 1);
    let renderW = maxW;
    let renderH = maxW / aspect;
    if (renderH > maxH) {
      renderH = maxH;
      renderW = maxH * aspect;
    }
    const imgX = 40;
    const imgY = 750 + (maxH - renderH) / 2;

    content.push("q");
    content.push(`${renderW.toFixed(2)} 0 0 ${renderH.toFixed(2)} ${imgX} ${imgY.toFixed(2)} cm`);
    content.push("/Im1 Do");
    content.push("Q");

    // Tagline below logo
    content.push("BT");
    content.push("0.4 0.45 0.5 rg /F2 6 Tf");
    content.push(`40 743 Td (${pdfEscapeWinAnsi(tagline)}) Tj`);
    content.push("ET");
  } else {
    content.push("BT");
    content.push("0.1 0.12 0.16 rg");
    content.push("/F2 17 Tf");
    content.push("40 798 Td");
    content.push(`(${pdfEscapeWinAnsi(companyName)}) Tj`);
    content.push("/F2 7.5 Tf");
    content.push("0.4 0.45 0.5 rg");
    content.push("0 -13 Td");
    content.push(`(${pdfEscapeWinAnsi(tagline)}) Tj`);
    content.push("ET");
  }

  // Divider Line
  content.push("0.1 0.12 0.16 RG 1.5 w");
  content.push("40 740 m 555 740 l S");

  // 2. CLIENT & VEHICLE GRID (Y: 738 -> 678)
  content.push("0.75 0.78 0.82 RG 0.5 w");
  content.push("40 678 515 60 re s");
  content.push("170 678 m 170 738 l S");
  content.push("285 678 m 285 738 l S");
  content.push("415 678 m 415 738 l S");
  content.push("40 718 m 555 718 l S");
  content.push("40 698 m 555 698 l S");

  const lblClient = i18n.lblClient;
  const lblBrand = i18n.lblBrand;
  const lblPlate = i18n.lblPlate;
  const lblProto = i18n.lblProto;
  const lblAddr = i18n.lblAddr;
  const lblModel = i18n.lblModel;
  const lblVin = i18n.lblVin;
  const lblDateStart = i18n.lblDateStart;
  const lblPhone = i18n.lblPhone;
  const lblColor = i18n.lblColor;
  const lblKm = i18n.lblKm;
  const lblDateEnd = i18n.lblDateEnd;

  // Row 1 (Y: 718 -> 738)
  const clientName = budget.clientName || clientSnap.name || "-";
  const nameSplit = splitTwoLines(clientName, 22, 22);
  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 44 731 Td (${pdfEscapeWinAnsi(lblClient)}) Tj ET`);
  if (nameSplit.line2) {
    content.push(`BT 0.1 0.12 0.16 rg /F2 6.5 Tf 44 724 Td (${pdfEscapeWinAnsi(nameSplit.line1)}) Tj ET`);
    content.push(`BT 0.1 0.12 0.16 rg /F2 6 Tf 44 718.5 Td (${pdfEscapeWinAnsi(nameSplit.line2)}) Tj ET`);
  } else {
    content.push(`BT 0.1 0.12 0.16 rg /F2 7.5 Tf 44 722 Td (${pdfEscapeWinAnsi(nameSplit.line1)}) Tj ET`);
  }

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 174 731 Td (${pdfEscapeWinAnsi(lblBrand)}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 7.5 Tf 174 722 Td (${pdfEscapeWinAnsi(clipCell(budget.vehicleBrand, 18))}) Tj ET`);

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 289 731 Td (${pdfEscapeWinAnsi(lblPlate)}) Tj ET`);
  content.push(`BT 0.75 0.1 0.1 rg /F2 7.5 Tf 289 722 Td (${pdfEscapeWinAnsi(clipCell(vehiclePlate, 18))}) Tj ET`);

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 419 731 Td (${pdfEscapeWinAnsi(lblProto)}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 7.5 Tf 419 722 Td (${pdfEscapeWinAnsi(clipCell(protocolCode, 20))}) Tj ET`);

  // Row 2 (Y: 698 -> 718)
  const clientAddr = clientSnap.address?.street
    ? [clientSnap.address.street, clientSnap.address.postal, clientSnap.address.city].filter(Boolean).join(" ")
    : (budget.clientAddress || "-");
  const addrSplit = splitTwoLines(clientAddr, 25, 25);
  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 44 711 Td (${pdfEscapeWinAnsi(lblAddr)}) Tj ET`);
  if (addrSplit.line2) {
    content.push(`BT 0.1 0.12 0.16 rg /F1 6 Tf 44 704 Td (${pdfEscapeWinAnsi(addrSplit.line1)}) Tj ET`);
    content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 44 698.5 Td (${pdfEscapeWinAnsi(addrSplit.line2)}) Tj ET`);
  } else {
    content.push(`BT 0.1 0.12 0.16 rg /F1 7 Tf 44 702 Td (${pdfEscapeWinAnsi(addrSplit.line1)}) Tj ET`);
  }

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 174 711 Td (${pdfEscapeWinAnsi(lblModel)}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 7.5 Tf 174 702 Td (${pdfEscapeWinAnsi(clipCell(budget.vehicleModel, 18))}) Tj ET`);

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 289 711 Td (${pdfEscapeWinAnsi(lblVin)}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 7.5 Tf 289 702 Td (${pdfEscapeWinAnsi(clipCell(budget.vehicleVin, 22))}) Tj ET`);

  const dateDebut = (budget.createdAt || new Date()).toISOString().slice(0, 10);
  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 419 711 Td (${pdfEscapeWinAnsi(lblDateStart)}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 7.5 Tf 419 702 Td (${pdfEscapeWinAnsi(clipCell(dateDebut, 18))}) Tj ET`);

  // Row 3 (Y: 678 -> 698)
  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 44 691 Td (${pdfEscapeWinAnsi(lblPhone)}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 7.5 Tf 44 682 Td (${pdfEscapeWinAnsi(clipCell(budget.clientPhone || clientSnap.phone, 20))}) Tj ET`);

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 174 691 Td (${pdfEscapeWinAnsi(lblColor)}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 7.5 Tf 174 682 Td (${pdfEscapeWinAnsi(clipCell(budget.vehicleColor || "-", 18))}) Tj ET`);

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 289 691 Td (${pdfEscapeWinAnsi(lblKm)}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 7.5 Tf 289 682 Td (${pdfEscapeWinAnsi(clipCell(budget.vehicleKm || "-", 18))}) Tj ET`);

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 419 691 Td (${pdfEscapeWinAnsi(lblDateEnd)}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 7.5 Tf 419 682 Td (-) Tj ET`);

  // 3. TABLE DSP (PDR) HEADER (Y: 670 -> 656)
  content.push("0.22 0.25 0.32 rg");
  content.push("40 656 515 15 re f");

  const colComp = i18n.colComp;
  const colDents = i18n.colDents;
  const colSize = i18n.colSize;
  const colUt = i18n.colUt;
  const colSumUt = i18n.colSumUt;
  const colPaint = i18n.colPaint;
  const colNew = i18n.colNew;
  const colPrice = i18n.colPrice;

  content.push(`BT 1 1 1 rg /F2 7 Tf 44 660 Td (${pdfEscapeWinAnsi(colComp)}) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6.5 Tf 165 660 Td (${pdfEscapeWinAnsi(colDents)}) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6.5 Tf 215 660 Td (${pdfEscapeWinAnsi(colSize)}) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6.5 Tf 265 660 Td (${pdfEscapeWinAnsi(colUt)}) Tj ET`);
  content.push("BT 1 1 1 rg /F2 6.5 Tf 305 660 Td (ALU) Tj ET");
  content.push(`BT 1 1 1 rg /F2 6.5 Tf 330 660 Td (${pdfEscapeWinAnsi(i18n.colGlue)}) Tj ET`);
  content.push("BT 1 1 1 rg /F2 6.5 Tf 360 660 Td (DAP) Tj ET");
  content.push(`BT 1 1 1 rg /F2 6.5 Tf 400 660 Td (${pdfEscapeWinAnsi(colSumUt)}) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6.5 Tf 455 660 Td (${pdfEscapeWinAnsi(colPaint)}) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6.5 Tf 485 660 Td (${pdfEscapeWinAnsi(colNew)}) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6.5 Tf 520 660 Td (${pdfEscapeWinAnsi(colPrice)}) Tj ET`);

  // DSP Rows
  let curY = 644;
  const rowH = 9.5;
  const allServices: any[] = Array.isArray(rev?.services) ? rev?.services : [];
  const damagePoints: any[] = Array.isArray(inspection?.damagePoints) ? inspection?.damagePoints : [];

  let grandUt = 0;
  let grandSommeUt = 0;
  let grandPrixDsp = 0;

  for (const zone of BACKEND_PROTOCOLE_ZONES) {
    const zoneTitle = (zone.title as any)[lang] || (zone.title as any).fr;
    content.push("0.9 0.92 0.95 rg");
    content.push(`40 ${curY} 515 ${rowH} re f`);
    content.push("0.75 0.78 0.82 RG 0.5 w");
    content.push(`40 ${curY} 515 ${rowH} re s`);

    content.push(`BT 0.1 0.12 0.16 rg /F2 6 Tf 44 ${curY + 2.5} Td (${pdfEscapeWinAnsi(zoneTitle)}) Tj ET`);
    curY -= rowH;

    for (const p of zone.parts) {
      const partLabel = (p.label as any)[lang] || (p.label as any).fr;
      const pts = damagePoints.filter((dp) => dp.carPartCode === p.code || p.match.some((m) => String(dp.carPartCode).toLowerCase().includes(m)));
      const svc = allServices.find((s) => p.match.some((m) => String(s.description || "").toLowerCase().includes(m)));

      let dents = pts.reduce((sum, pt) => sum + (Number(pt.dentCount) || 1), 0);
      let isAlu = pts.some((pt) => pt.partMaterial === "aluminum") || String(svc?.description || "").includes("[ALU]");
      let isColle = String(svc?.description || "").toLowerCase().includes("colle") || String(svc?.description || "").toLowerCase().includes("cola");
      let isDap = String(svc?.description || "").toLowerCase().includes("dap");
      let isPaint = pts.some((pt) => pt.damageType === "paint_damage") || String(svc?.description || "").toLowerCase().includes("peint") || String(svc?.description || "").toLowerCase().includes("pintura");
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

      content.push(`BT 0.1 0.12 0.16 rg /F1 6 Tf 44 ${curY + 2.5} Td (${pdfEscapeWinAnsi(partLabel)}) Tj ET`);
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
  const lblTotalDsp = i18n.lblTotalDsp;
  content.push("0.1 0.12 0.16 rg");
  content.push(`40 ${curY} 515 12 re f`);

  content.push(`BT 1 1 1 rg /F2 6.5 Tf 44 ${curY + 3} Td (${pdfEscapeWinAnsi(lblTotalDsp)}) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6.5 Tf 260 ${curY + 3} Td (${grandUt.toFixed(2)}) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6.5 Tf 395 ${curY + 3} Td (${grandSommeUt.toFixed(2)}) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6.5 Tf 505 ${curY + 3} Td (${grandPrixDsp.toFixed(2)} EUR) Tj ET`);
  curY -= 14;

  // Option Legend Line
  const footnoteText = i18n.footnoteText;
  content.push("BT 0.4 0.45 0.5 rg /F1 6 Tf 40 " + curY + " Td (" + pdfEscapeWinAnsi(footnoteText) + ") Tj ET");
  curY -= 12;

  // 4. TABLEAU PEINTURE / MO (MAIN D'OEUVRE)
  const lblPaintTable = i18n.lblPaintTable;
  const lblPaintComment = i18n.lblPaintComment;
  const lblPaintHeader = i18n.lblPaintHeader;
  content.push("0.22 0.25 0.32 rg");
  content.push(`40 ${curY} 515 11 re f`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 44 ${curY + 3} Td (${pdfEscapeWinAnsi(lblPaintTable)}) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 175 ${curY + 3} Td (T1) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 230 ${curY + 3} Td (T2 47,00 EUR/h) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 315 ${curY + 3} Td (${pdfEscapeWinAnsi(lblPaintHeader)}) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 405 ${curY + 3} Td (Ing. N.V. 36,00 EUR/h) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 485 ${curY + 3} Td (${pdfEscapeWinAnsi(lblPaintComment)}) Tj ET`);
  curY -= 10;

  const paintElements = [
    { name: i18n.paintElemHood, t2: "1 H", p: "3 H", ing: "3 H" },
    { name: i18n.paintElemTrunk, t2: "1 H", p: "1 H", ing: "1 H" },
    { name: i18n.paintElemRail, t2: "1 H", p: "1 H", ing: "1 H" },
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
  const lblSum = i18n.lblSum;
  content.push("0.92 0.94 0.96 rg");
  content.push(`40 ${curY} 515 9 re f`);
  content.push("0.75 0.78 0.82 RG 0.4 w");
  content.push(`40 ${curY} 515 9 re s`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 5.5 Tf 44 ${curY + 2.5} Td (${pdfEscapeWinAnsi(lblSum)}) Tj ET`);
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
  const lblPaintBar = i18n.lblPaintBar;
  content.push("0.1 0.12 0.16 rg");
  content.push(`40 ${curY} 515 10 re f`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 44 ${curY + 2.5} Td (${pdfEscapeWinAnsi(lblPaintBar)}) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 485 ${curY + 2.5} Td (501.00 EUR) Tj ET`);
  curY -= 14;

  // 5. SUMMARY 4 BOXES
  const boxW = 125;
  const boxH = 46;
  const bY = curY - boxH;

  // Box 1: Tarification
  const box1Title = i18n.box1Title;
  const box1L1 = i18n.box1L1;
  const box1L2 = i18n.box1L2;
  const box1L3 = i18n.box1L3;

  content.push(`0.96 0.97 0.98 rg 40 ${bY} ${boxW} ${boxH} re f`);
  content.push(`0.75 0.78 0.82 RG 0.5 w 40 ${bY} ${boxW} ${boxH} re s`);
  content.push(`0.22 0.25 0.32 rg 40 ${bY + boxH - 10} ${boxW} 10 re f`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 44 ${bY + boxH - 7} Td (${pdfEscapeWinAnsi(box1Title)}) Tj ET`);
  content.push(`BT 0.2 0.25 0.3 rg /F1 5.5 Tf 44 ${bY + 28} Td (${pdfEscapeWinAnsi(box1L1)}) Tj 0 -7 Td (${pdfEscapeWinAnsi(box1L2)}) Tj 0 -7 Td (${pdfEscapeWinAnsi(box1L3)}) Tj ET`);

  // Box 2: Options
  const box2Title = i18n.box2Title;
  content.push(`0.96 0.97 0.98 rg 170 ${bY} ${boxW} ${boxH} re f`);
  content.push(`0.75 0.78 0.82 RG 0.5 w 170 ${bY} ${boxW} ${boxH} re s`);
  content.push(`0.22 0.25 0.32 rg 170 ${bY + boxH - 10} ${boxW} 10 re f`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 174 ${bY + boxH - 7} Td (${pdfEscapeWinAnsi(box2Title)}) Tj ET`);
  content.push(`BT 0.2 0.25 0.3 rg /F1 6 Tf 174 ${bY + 26} Td (- T2 : 0.00 EUR) Tj 0 -8 Td (- Peinture : 0.00 EUR) Tj ET`);

  // Box 3: Degarnissage
  const box3Title = i18n.box3Title;
  content.push(`0.96 0.97 0.98 rg 300 ${bY} ${boxW} ${boxH} re f`);
  content.push(`0.75 0.78 0.82 RG 0.5 w 300 ${bY} ${boxW} ${boxH} re s`);
  content.push(`0.22 0.25 0.32 rg 300 ${bY + boxH - 10} ${boxW} 10 re f`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 304 ${bY + boxH - 7} Td (${pdfEscapeWinAnsi(box3Title)}) Tj ET`);
  const degarnissageVal = Number(rev?.laborTotal || 0);
  content.push(`BT 0.2 0.25 0.3 rg /F2 6.5 Tf 304 ${bY + 20} Td (TOTAL: ${degarnissageVal.toFixed(2)} EUR) Tj ET`);

  // Box 4: Prix Total
  const box4Title = i18n.box4Title;
  const lblSubtotal = i18n.lblSubtotal;
  content.push(`0.96 0.97 0.98 rg 430 ${bY} ${boxW} ${boxH} re f`);
  content.push(`0.1 0.12 0.16 RG 1 w 430 ${bY} ${boxW} ${boxH} re s`);
  content.push(`0.1 0.12 0.16 rg 430 ${bY + boxH - 10} ${boxW} 10 re f`);
  content.push(`BT 1 1 1 rg /F2 6.5 Tf 434 ${bY + boxH - 7} Td (${pdfEscapeWinAnsi(box4Title)}) Tj ET`);
  const finalTotalVal = Number(rev?.finalTotal || grandPrixDsp);
  const grossVal = Number(rev?.grossTotal || grandPrixDsp);
  const tvaVal = Number(rev?.taxTotal || (finalTotalVal - grossVal));
  content.push(`BT 0.2 0.25 0.3 rg /F1 6 Tf 434 ${bY + 26} Td (${pdfEscapeWinAnsi(lblSubtotal)}${grossVal.toFixed(2)} EUR) Tj 0 -8 Td (TVA (20%) : ${tvaVal.toFixed(2)} EUR) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 8 Tf 434 ${bY + 6} Td (Total : ${finalTotalVal.toFixed(2)} EUR) Tj ET`);

  curY = bY - 10;

  // 5. ASSURANCE & EXPERTISE (Y: curY -> curY - 40)
  const assH = 38;
  const aY = curY - assH;
  const lblAssHeader = i18n.lblAssHeader;
  content.push(`0.22 0.25 0.32 rg 40 ${aY + assH - 10} 515 10 re f`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 44 ${aY + assH - 7} Td (${pdfEscapeWinAnsi(lblAssHeader)}) Tj ET`);
  content.push(`0.75 0.78 0.82 RG 0.5 w 40 ${aY} 515 ${assH} re s`);

  const dossierSnap = (rev?.dossierSnapshot as any) || {};
  const insCompany = dossierSnap.insuranceCompany || budget.dossier_insurance_company || "-";
  const expertName = dossierSnap.expertName || budget.dossier_expert_name || "-";
  const claimNum = dossierSnap.claimNumber || budget.dossier_claim_number || "-";

  const lblBoxAss = i18n.lblBoxAss;
  const lblBoxSin = i18n.lblBoxSin;
  const lblBoxExp = i18n.lblBoxExp;
  const lblBoxSig = i18n.lblBoxSig;

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 44 ${aY + 20} Td (${pdfEscapeWinAnsi(lblBoxAss)}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 7 Tf 44 ${aY + 11} Td (${pdfEscapeWinAnsi(insCompany)}) Tj ET`);

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 170 ${aY + 20} Td (${pdfEscapeWinAnsi(lblBoxSin)}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 7 Tf 170 ${aY + 11} Td (${pdfEscapeWinAnsi(claimNum)}) Tj ET`);

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 290 ${aY + 20} Td (${pdfEscapeWinAnsi(lblBoxExp)}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 7 Tf 290 ${aY + 11} Td (${pdfEscapeWinAnsi(expertName)}) Tj ET`);

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 420 ${aY + 20} Td (${pdfEscapeWinAnsi(lblBoxSig)}) Tj ET`);
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

  return assemblePdf(content.join("\n"), logoImage);
}

export async function generateBudgetPdfBuffer(
  budget: any,
  rev: any,
  workspace?: any,
  inspection?: any,
  langRaw: string = "pt",
): Promise<Buffer> {
  const isPdr =
    rev?.budgetType === "pdr" ||
    budget?.budget_type === "pdr" ||
    (Array.isArray(inspection?.damagePoints) && inspection.damagePoints.length > 0) ||
    (Array.isArray(rev?.services) && rev.services.some((s: any) => {
      const d = String(s.name || s.description || "").toLowerCase();
      return d.includes("dsp") || d.includes("pdr") || d.includes("mossa") || d.includes("bosse") || d.includes("grele") || d.includes("granizo");
    }));

  if (isPdr) {
    const rawLogoUrl = workspace?.logoUrl || (workspace?.brandConfig as any)?.logoUrl;
    const logoImage = await loadWorkspaceLogo(rawLogoUrl);
    return buildProtocoleDeReparationPdf(budget, rev, workspace, inspection, logoImage, langRaw);
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
  }, langRaw);
}
