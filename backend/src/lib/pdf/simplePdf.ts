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
  const sanitized = String(text)
    .replace(/[\u2014\u2015]/g, " - ") // em dash
    .replace(/[\u2012\u2013]/g, "-")   // en dash, figure dash
    .replace(/[\u2018\u2019]/g, "'")   // curly single quotes
    .replace(/[\u201C\u201D]/g, '"')   // curly double quotes
    .replace(/[\u2022\u25CF]/g, "*")   // bullet
    .replace(/[\u20AC]/g, "EUR");      // euro sign -> EUR

  let out = "";
  for (let i = 0; i < sanitized.length; i++) {
    const ch = sanitized[i];
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

export async function loadPdfImage(imgRef: string | null | undefined): Promise<PdfImageObject | null> {
  if (!imgRef || typeof imgRef !== "string") return null;
  const trimmed = imgRef.trim();
  if (!trimmed) return null;

  try {
    let buf: Buffer | null = null;

    // 1. Data URL (Base64 JPEG do Canvas ou Upload)
    if (trimmed.startsWith("data:")) {
      const parts = trimmed.split(",");
      if (parts.length > 1) {
        buf = Buffer.from(parts[1], "base64");
      }
    }

    // 2. MinIO / S3 retrieval
    if (!buf && (trimmed.includes("/logos/") || trimmed.includes("/production-photos/"))) {
      const bucket = trimmed.includes("/logos/") ? "logos" : "production-photos";
      const marker = trimmed.includes("/logos/") ? "/logos/" : "/production-photos/";
      const key = decodeURIComponent(trimmed.split(marker)[1]);
      if (key) {
        try {
          const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
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

    // 3. HTTP / HTTPS fallback
    if (!buf && (trimmed.startsWith("http://") || trimmed.startsWith("https://"))) {
      const resp = await fetch(trimmed, { signal: AbortSignal.timeout(4000) });
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

export async function loadWorkspaceLogo(logoUrl: string | null | undefined): Promise<PdfImageObject | null> {
  return loadPdfImage(logoUrl);
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

export interface PdfPageDef {
  contentStream: string;
  images?: Record<string, PdfImageObject>;
}

export function assembleMultiPagePdf(pages: PdfPageDef[]): Buffer {
  if (!pages || pages.length === 0) {
    pages = [{ contentStream: "" }];
  }

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

  let nextObjId = 1;
  const catalogId = nextObjId++; // 1
  const pagesRootId = nextObjId++; // 2
  const fontF1Id = nextObjId++; // 3
  const fontF2Id = nextObjId++; // 4

  const pageIds: number[] = [];
  const contentIds: number[] = [];
  const pageImagesMap: Array<Array<{ name: string; objId: number; img: PdfImageObject }>> = [];

  for (let i = 0; i < pages.length; i++) {
    pageIds.push(nextObjId++);
    contentIds.push(nextObjId++);
    const imgs: Array<{ name: string; objId: number; img: PdfImageObject }> = [];
    if (pages[i].images) {
      for (const [name, imgObj] of Object.entries(pages[i].images!)) {
        if (imgObj && imgObj.buffer) {
          const imgId = nextObjId++;
          imgs.push({ name, objId: imgId, img: imgObj });
        }
      }
    }
    pageImagesMap.push(imgs);
  }

  const numObjects = nextObjId - 1;

  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  push(`${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesRootId} 0 R >>\nendobj\n`, catalogId);

  const kidsStr = pageIds.map((id) => `${id} 0 R`).join(" ");
  push(`${pagesRootId} 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${pages.length} >>\nendobj\n`, pagesRootId);

  push(
    `${fontF1Id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n`,
    fontF1Id,
  );
  push(
    `${fontF2Id} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n`,
    fontF2Id,
  );

  for (let i = 0; i < pages.length; i++) {
    const pageId = pageIds[i];
    const contentId = contentIds[i];
    const imgs = pageImagesMap[i];

    let xobjectRes = "";
    if (imgs.length > 0) {
      const xobjEntries = imgs.map((item) => `/${item.name} ${item.objId} 0 R`).join(" ");
      xobjectRes = `/XObject << ${xobjEntries} >>`;
    }

    push(
      `${pageId} 0 obj\n<< /Type /Page /Parent ${pagesRootId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${fontF1Id} 0 R /F2 ${fontF2Id} 0 R >> ${xobjectRes} >> /Contents ${contentId} 0 R >>\nendobj\n`,
      pageId,
    );

    const streamStr = pages[i].contentStream;
    push(
      `${contentId} 0 obj\n<< /Length ${Buffer.byteLength(streamStr, "utf8")} >>\nstream\n${streamStr}\nendstream\nendobj\n`,
      contentId,
    );

    for (const item of imgs) {
      const img = item.img;
      const header = `${item.objId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.buffer.length} >>\nstream\n`;
      const footer = "\nendstream\nendobj\n";
      push(header, item.objId);
      push(img.buffer);
      push(footer);
    }
  }

  const xrefOffset = offset;
  let xref = `xref\n0 ${numObjects + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= numObjects; i += 1) {
    xref += String(objOffsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  const trailer = `trailer\n<< /Size ${numObjects + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  push(xref);
  push(trailer);

  return Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p, "utf8"))));
}

function assemblePdf(contentStream: string, image?: PdfImageObject | null): Buffer {
  return assembleMultiPagePdf([
    {
      contentStream,
      images: image ? { Im1: image } : undefined,
    },
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

const PART_NAME_DICT: Record<string, { pt: string; fr: string }> = {
  // Canonical keys from CAR_PARTS (VehicleBlueprint5Views.tsx)
  hood: { pt: "Capô", fr: "Capot" },
  roof: { pt: "Teto", fr: "Pavillon" },
  trunk: { pt: "Tampa Traseira / Porta-Malas", fr: "Hayon / Coffre" },
  windshield: { pt: "Para-brisa Dianteiro", fr: "Pare-brise avant" },
  rear_glass: { pt: "Vidro Traseiro", fr: "Lunette arrière" },
  front_bumper: { pt: "Para-choque Dianteiro", fr: "Pare-chocs avant" },
  rear_bumper: { pt: "Para-choque Traseiro", fr: "Pare-chocs arrière" },
  front_grille: { pt: "Grade Dianteira", fr: "Calandre avant" },
  left_headlight: { pt: "Farol Dianteiro Esquerdo", fr: "Phare avant gauche" },
  right_headlight: { pt: "Farol Dianteiro Direito", fr: "Phare avant droit" },
  left_taillight: { pt: "Lanterna Traseira Esquerda", fr: "Feu arrière gauche" },
  right_taillight: { pt: "Lanterna Traseira Direita", fr: "Feu arrière droit" },
  front_left_fender: { pt: "Para-lama Dianteiro Esquerdo", fr: "Aile avant gauche" },
  front_right_fender: { pt: "Para-lama Dianteiro Direito", fr: "Aile avant droite" },
  front_left_door: { pt: "Porta Dianteira Esquerda", fr: "Porte avant gauche" },
  front_right_door: { pt: "Porta Dianteira Direita", fr: "Porte avant droite" },
  rear_left_door: { pt: "Porta Traseira Esquerda", fr: "Porte arrière gauche" },
  rear_right_door: { pt: "Porta Traseira Direita", fr: "Porte arrière droite" },
  rear_left_quarter: { pt: "Lateral / Para-lama Traseiro Esquerdo", fr: "Aile arrière gauche" },
  rear_right_quarter: { pt: "Lateral / Para-lama Traseiro Direito", fr: "Aile arrière droite" },
  left_mirror: { pt: "Retrovisor Esquerdo", fr: "Rétroviseur gauche" },
  right_mirror: { pt: "Retrovisor Direito", fr: "Rétroviseur droit" },
  left_rail: { pt: "Coluna / Arco Superior Esquerdo", fr: "Montant / Brancard gauche" },
  right_rail: { pt: "Coluna / Arco Superior Direito", fr: "Montant / Brancard droit" },
  left_sill: { pt: "Soleira Esquerda", fr: "Bas de caisse gauche" },
  right_sill: { pt: "Soleira Direita", fr: "Bas de caisse droit" },
  general: { pt: "Outro Componente Automotivo", fr: "Composant automobile divers" },

  // Blueprint / legacy shorthand aliases
  fender_fl: { pt: "Para-lama Diant. Esq.", fr: "Aile avant gauche" },
  fender_fr: { pt: "Para-lama Diant. Dir.", fr: "Aile avant droite" },
  fender_rl: { pt: "Lateral Tras. Esq.", fr: "Aile arrière gauche" },
  fender_rr: { pt: "Lateral Tras. Dir.", fr: "Aile arrière droite" },
  quarter_rl: { pt: "Lateral Tras. Esq.", fr: "Aile arrière gauche" },
  quarter_rr: { pt: "Lateral Tras. Dir.", fr: "Aile arrière droite" },
  door_fl: { pt: "Porta Diant. Esq.", fr: "Porte avant gauche" },
  door_fr: { pt: "Porta Diant. Dir.", fr: "Porte avant droite" },
  door_rl: { pt: "Porta Tras. Esq.", fr: "Porte arrière gauche" },
  door_rr: { pt: "Porta Tras. Dir.", fr: "Porte arrière droite" },
  bumper_f: { pt: "Para-choque Dianteiro", fr: "Pare-chocs avant" },
  bumper_r: { pt: "Para-choque Traseiro", fr: "Pare-chocs arrière" },
  mirror_l: { pt: "Retrovisor Esq.", fr: "Rétroviseur gauche" },
  mirror_r: { pt: "Retrovisor Dir.", fr: "Rétroviseur droit" },
  headlight_l: { pt: "Farol Dianteiro Esq.", fr: "Phare avant gauche" },
  headlight_r: { pt: "Farol Dianteiro Dir.", fr: "Phare avant droit" },
  taillight_l: { pt: "Lanterna Traseira Esq.", fr: "Feu arrière gauche" },
  taillight_r: { pt: "Lanterna Traseira Dir.", fr: "Feu arrière direito" },
  rocker_l: { pt: "Soleira / Caixa de Ar Esq.", fr: "Bas de caisse gauche" },
  rocker_r: { pt: "Soleira / Caixa de Ar Dir.", fr: "Bas de caisse droit" },
  pillar_a_l: { pt: "Coluna A Esq.", fr: "Montant A gauche" },
  pillar_a_r: { pt: "Coluna A Dir.", fr: "Montant A droit" },
  pillar_b_l: { pt: "Coluna B Esq.", fr: "Montant B gauche" },
  pillar_b_r: { pt: "Coluna B Dir.", fr: "Montant B droit" },
  pillar_c_l: { pt: "Coluna C Esq.", fr: "Montant C gauche" },
  pillar_c_r: { pt: "Coluna C Dir.", fr: "Montant C droit" },
};

const DAMAGE_TYPE_DICT: Record<string, { pt: string; fr: string }> = {
  hail: { pt: "Granizo (PDR)", fr: "Grêle (DSP)" },
  dent: { pt: "Mossa PDR (Martelinho)", fr: "Bosse DSP" },
  dent_small: { pt: "Amassado Leve (< 3cm)", fr: "Bosse légère (< 3cm)" },
  dent_medium: { pt: "Amassado Médio (3-8cm)", fr: "Bosse moyenne (3-8cm)" },
  dent_large: { pt: "Amassado Severo (> 8cm)", fr: "Bosse sévère (> 8cm)" },
  crease: { pt: "Vinco", fr: "Pli / Arête" },
  scratch: { pt: "Risco / Arranhão", fr: "Rayure / Éraflure" },
  paint_damage: { pt: "Dano na Pintura", fr: "Dégât peinture" },
  replace: { pt: "Substituição da Peça", fr: "Remplacement pièce" },
  crack: { pt: "Fissura / Trinca", fr: "Fissure / Cassure" },
};

function formatPartLabel(code: string | null | undefined, isFr: boolean): string {
  if (!code) return isFr ? "Pièce générale" : "Peça geral";
  const entry = PART_NAME_DICT[code.toLowerCase()];
  if (entry) return isFr ? entry.fr : entry.pt;
  return code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDamageTypeLabel(type: string | null | undefined, isFr: boolean): string {
  if (!type) return isFr ? "Avarie" : "Avaria";
  const entry = DAMAGE_TYPE_DICT[type.toLowerCase()];
  if (entry) return isFr ? entry.fr : entry.pt;
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function buildInspectionAnnexPages(
  budget: any,
  rev: any,
  workspace?: any,
  inspection?: any,
  langRaw: string = "pt",
): Promise<PdfPageDef[]> {
  const rawDamagePoints: any[] = Array.isArray(inspection?.damagePoints) ? inspection.damagePoints : [];
  if (rawDamagePoints.length === 0) return [];

  const lang = normalizePdfLang(langRaw);
  const isFr = lang === "fr";

  const brand = workspace?.brandConfig || {};
  const companyName = brand.legalName || brand.name || workspace?.billingProfile?.companyName || workspace?.billingProfile?.legalName || workspace?.name || "Operix Automotive";
  const legalAddress = brand.address || workspace?.billingProfile?.billingAddress || "388 Rue Louis Joseph Gay Lussac";
  const postalCity = [brand.postalCode || workspace?.billingProfile?.postalCode || "26100", brand.city || workspace?.billingProfile?.city || "Romans sur Isere"].filter(Boolean).join(" ");
  const companyPhone = brand.phone || "04 87 20 01 47";
  const tollFree = brand.tollFree || companyPhone;
  const companyEmail = brand.email || workspace?.billingProfile?.billingEmail || "info@pdr-team.fr";
  const companyWebsite = brand.website || "www.pdr-team.fr";

  const vehiclePlate = String(budget.vehiclePlate || (isFr ? "SANS IMMAT" : "SEM PLACA")).toUpperCase();

  // Carrega todas as imagens das avarias em paralelo
  const loadedPoints = await Promise.all(
    rawDamagePoints.map(async (dp, idx) => {
      let img: PdfImageObject | null = null;
      if (dp.photoStoragePath) {
        try {
          img = await loadPdfImage(dp.photoStoragePath);
        } catch {
          // ignore
        }
      }
      return {
        dp,
        img,
        index: idx + 1,
      };
    })
  );

  const countPreExisting = rawDamagePoints.filter((p) => p.contracted === false).length;
  const countContracted = rawDamagePoints.length - countPreExisting;

  // Pagina em blocos de até 6 avarias por página
  const chunks: Array<typeof loadedPoints> = [];
  for (let i = 0; i < loadedPoints.length; i += 6) {
    chunks.push(loadedPoints.slice(i, i + 6));
  }

  const pages: PdfPageDef[] = [];

  for (let pIdx = 0; pIdx < chunks.length; pIdx++) {
    const chunk = chunks[pIdx];
    const isLastPage = pIdx === chunks.length - 1;
    const content: string[] = [];
    const images: Record<string, PdfImageObject> = {};

    // 1. Header da Página de Anexo (Y: 786 -> 814)
    content.push("0.1 0.12 0.16 rg");
    content.push("40 786 515 28 re f");

    const headerTitle = chunks.length > 1
      ? (isFr ? `ANNEXE 1 - CONSTAT PRÉALABLE & ÉVIDENCES (${pIdx + 1}/${chunks.length})` : `ANEXO 1 - CHECKLIST DE ENTRADA & VISTORIA (${pIdx + 1}/${chunks.length})`)
      : (isFr ? "ANNEXE 1 - CONSTAT PRÉALABLE & ÉVIDENCES PHOTOGRAPHIQUES" : "ANEXO 1 - CHECKLIST DE ENTRADA & VISTORIA CAUTELAR");

    content.push("BT");
    content.push("1 1 1 rg");
    content.push("/F2 10 Tf");
    content.push("48 796 Td");
    content.push(`(${pdfEscapeWinAnsi(headerTitle)}) Tj`);
    content.push("ET");

    // Badge com Placa no canto superior direito
    const plateText = vehiclePlate;
    const plateW = Math.max(90, plateText.length * 6 + 18);
    const badgeX = 550 - plateW;
    content.push("0.98 0.94 0.94 rg");
    content.push(`${badgeX} 790 ${plateW} 20 re f`);
    content.push("0.85 0.15 0.15 RG 1 w");
    content.push(`${badgeX} 790 ${plateW} 20 re s`);
    content.push("BT 0.75 0.1 0.1 rg /F2 8 Tf " + (badgeX + 8) + " 796 Td (" + pdfEscapeWinAnsi(plateText) + ") Tj ET");

    // 2. Banner Explicativo de Engenharia de Vistoria (Y: 746 -> 778)
    content.push("0.96 0.97 0.98 rg 40 746 515 32 re f");
    content.push("0.8 0.83 0.88 RG 0.5 w 40 746 515 32 re s");

    const lineExp1 = isFr
      ? "Relevé contradictoire et photographique des dommages constaté lors de la réception du véhicule à l'atelier."
      : "Vistoria cautelar e registro fotográfico de conformidade na entrada do veículo na oficina.";
    const lineExp2 = isFr
      ? "Les dommages identifiés comme préexistants protègent l'atelier contre tout litige ultérieur (aucun frais de réparation appliqué)."
      : "Danos pré-existentes resguardam a oficina contra responsabilidade civil e não geram cobrança no orçamento.";

    content.push(`BT 0.2 0.25 0.3 rg /F2 6.5 Tf 48 764 Td (${pdfEscapeWinAnsi(lineExp1)}) Tj ET`);
    content.push(`BT 0.4 0.45 0.5 rg /F1 6 Tf 48 753 Td (${pdfEscapeWinAnsi(lineExp2)}) Tj ET`);

    // 3. Grid de Cards (2 colunas x até 3 linhas)
    chunk.forEach((item, idxInChunk) => {
      const col = idxInChunk % 2;
      const row = Math.floor(idxInChunk / 2);
      const cardX = col === 0 ? 40 : 305;
      const cardY = 600 - row * 140;
      const cardW = 250;
      const cardH = 130;

      const isPreExisting = item.dp.contracted === false;
      const partName = formatPartLabel(item.dp.carPartCode, isFr);
      const damageType = formatDamageTypeLabel(item.dp.damageType, isFr);
      const dentCount = Number(item.dp.dentCount) || 1;

      // Moldura do Card
      content.push("0.98 0.98 0.99 rg " + cardX + " " + cardY + " " + cardW + " " + cardH + " re f");
      content.push("0.8 0.83 0.88 RG 0.5 w " + cardX + " " + cardY + " " + cardW + " " + cardH + " re s");

      // Barra de cabeçalho do card
      const hdrBg = isPreExisting ? "1 0.95 0.90 rg" : "0.92 0.96 0.98 rg";
      content.push(hdrBg + " " + cardX + " " + (cardY + cardH - 18) + " " + cardW + " 18 re f");
      const cardTitle = "#" + item.index + " - " + clipCell(partName, 22);
      content.push("BT 0.1 0.12 0.16 rg /F2 7 Tf " + (cardX + 6) + " " + (cardY + cardH - 12) + " Td (" + pdfEscapeWinAnsi(cardTitle) + ") Tj ET");

      // Badge no canto direito da barra do card
      const badgeText = isPreExisting
        ? (isFr ? "[PRÉEXISTANT]" : "[PRÉ-EXISTENTE]")
        : (isFr ? "[FACTURÉ / DSP]" : "[ORÇADO]");
      const badgeColor = isPreExisting ? "0.75 0.35 0 rg" : "0.05 0.5 0.5 rg";
      content.push("BT " + badgeColor + " /F2 5.5 Tf " + (cardX + cardW - 75) + " " + (cardY + cardH - 12) + " Td (" + pdfEscapeWinAnsi(badgeText) + ") Tj ET");

      // Se possui foto anexada
      if (item.img) {
        const imgKey = "ImD_" + item.index;
        images[imgKey] = item.img;

        const maxW = 90;
        const maxH = 80;
        const aspect = (item.img.width || 1) / (item.img.height || 1);
        let renderW = maxW;
        let renderH = maxH;
        if (renderW / aspect > maxH) {
          renderW = Math.round(maxH * aspect);
          renderH = maxH;
        } else {
          renderH = Math.round(renderW / aspect);
        }
        const imgX = cardX + 8 + (maxW - renderW) / 2;
        const imgY = cardY + 20 + (maxH - renderH) / 2;

        content.push("q");
        content.push(`${renderW} 0 0 ${renderH} ${imgX.toFixed(1)} ${imgY.toFixed(1)} cm`);
        content.push("/" + imgKey + " Do");
        content.push("Q");

        // Borda suave em volta da foto
        content.push("0.75 0.78 0.82 RG 0.5 w");
        content.push((cardX + 8) + " " + (cardY + 20) + " " + maxW + " " + maxH + " re s");

        // Legenda abaixo da foto
        content.push("BT 0.4 0.45 0.5 rg /F1 5 Tf " + (cardX + 16) + " " + (cardY + 9) + " Td (" + pdfEscapeWinAnsi(isFr ? "Photo de l'avarie" : "Foto da avaria") + ") Tj ET");
      }

      const textX = item.img ? (cardX + 104) : (cardX + 10);
      content.push("BT 0.2 0.25 0.3 rg /F2 6.5 Tf " + textX + " " + (cardY + 92) + " Td (" + pdfEscapeWinAnsi((isFr ? "Avarie: " : "Avaria: ") + damageType) + ") Tj ET");
      content.push("BT 0.35 0.4 0.45 rg /F1 6 Tf " + textX + " " + (cardY + 79) + " Td (" + pdfEscapeWinAnsi((isFr ? "Quantité: " : "Quantidade: ") + dentCount + (dentCount === 1 ? (isFr ? " point" : " ponto") : (isFr ? " points" : " pontos"))) + ") Tj ET");

      const statusDesc = isPreExisting
        ? (isFr ? "Constat (Sans facturation)" : "Checklist (Sem cobrança)")
        : (isFr ? "Prestation à chiffrer" : "Serviço orçado a reparar");
      content.push("BT " + badgeColor + " /F2 6 Tf " + textX + " " + (cardY + 66) + " Td (" + pdfEscapeWinAnsi(statusDesc) + ") Tj ET");

      if (item.dp.notes) {
        const noteSplit = splitTwoLines(item.dp.notes, 28, 28);
        content.push("BT 0.4 0.45 0.5 rg /F1 5.5 Tf " + textX + " " + (cardY + 50) + " Td (Obs.: " + pdfEscapeWinAnsi(noteSplit.line1) + ") Tj ET");
        if (noteSplit.line2) {
          content.push("BT 0.4 0.45 0.5 rg /F1 5.5 Tf " + textX + " " + (cardY + 41) + " Td (" + pdfEscapeWinAnsi(noteSplit.line2) + ") Tj ET");
        }
      }
    });

    // 4. Rodapé / Box de Conformidade e Síntese (Apenas na última página de anexo)
    if (isLastPage) {
      content.push("0.97 0.98 0.99 rg 40 70 515 95 re f");
      content.push("0.75 0.78 0.82 RG 0.5 w 40 70 515 95 re s");

      // Faixa título da síntese
      content.push("0.22 0.25 0.32 rg 40 155 515 10 re f");
      const titleSynth = isFr ? "RÈGLES DE CONFORMITÉ & PROTECTION PERICIALE" : "TERMO DE CONFORMIDADE & RESGUARDO PERICIAL";
      content.push("BT 1 1 1 rg /F2 6 Tf 46 157 Td (" + pdfEscapeWinAnsi(titleSynth) + ") Tj ET");

      const statLine = isFr
        ? `Total d'avaries inspectées: ${rawDamagePoints.length} | Préexistantes (Constat): ${countPreExisting} | Facturées (Devis): ${countContracted}`
        : `Total de avarias vistoriadas: ${rawDamagePoints.length} | Pré-existentes (Checklist): ${countPreExisting} | Orçadas (Reparação): ${countContracted}`;
      content.push("BT 0.2 0.25 0.3 rg /F2 6.5 Tf 48 141 Td (" + pdfEscapeWinAnsi(statLine) + ") Tj ET");

      const legLine1 = isFr
        ? "Le client et l'atelier attestent de l'exactitude des constatations visuelles et photographiques ci-dessus dressées contradictoirement."
        : "O cliente e a oficina atestam a exatidão das constatações visuais e fotográficas registradas na recepção do veículo.";
      const legLine2 = isFr
        ? "Les avaries classées comme préexistantes font l'objet d'un accord contradictoire dégageant l'atelier de toute responsabilité antérieure."
        : "As avarias classificadas como pré-existentes integram o laudo contraditório e isentam a oficina de vícios anteriores.";
      content.push("BT 0.35 0.4 0.45 rg /F1 5.5 Tf 48 128 Td (" + pdfEscapeWinAnsi(legLine1) + ") Tj ET");
      content.push("BT 0.35 0.4 0.45 rg /F1 5.5 Tf 48 118 Td (" + pdfEscapeWinAnsi(legLine2) + ") Tj ET");

      // Status de assinatura / validação
      const sig = rev?.signature;
      if (sig && (sig.signed || sig.signedAt)) {
        const signer = sig.signerName || budget.clientName || "Client";
        const dateStr = (sig.signedAt || "").slice(0, 10);
        const sigTag = isFr ? `[Constat validé et signé par: ${signer} le ${dateStr}]` : `[Vistoria confirmada e assinada por: ${signer} em ${dateStr}]`;
        content.push("BT 0.08 0.55 0.25 rg /F2 6 Tf 48 98 Td (" + pdfEscapeWinAnsi(sigTag) + ") Tj ET");
      } else {
        const pendTag = isFr ? "[Constat contradictoire d'entrée horodaté - Système Operix]" : "[Checklist de entrada registrado no Sistema Operix]";
        content.push("BT 0.4 0.45 0.5 rg /F2 6 Tf 48 98 Td (" + pdfEscapeWinAnsi(pendTag) + ") Tj ET");
      }
    }

    // 5. Linha de Rodapé Institucional (Y: 45 -> 15)
    content.push("0.1 0.12 0.16 RG 1 w");
    content.push("40 45 m 555 45 l S");
    content.push("BT 0.2 0.25 0.3 rg /F2 6 Tf 40 35 Td (" + pdfEscapeWinAnsi(companyName) + ") Tj ET");
    content.push("BT 0.3 0.35 0.4 rg /F1 5.5 Tf 40 27 Td (" + pdfEscapeWinAnsi(legalAddress + " - " + postalCity) + ") Tj ET");
    content.push("BT 0.2 0.25 0.3 rg /F2 6 Tf 230 35 Td (" + pdfEscapeWinAnsi("Tel: " + companyPhone + " | N. Vert: " + tollFree) + ") Tj ET");
    content.push("BT 0.3 0.35 0.4 rg /F1 5.5 Tf 230 27 Td (" + pdfEscapeWinAnsi(companyEmail + " - " + companyWebsite) + ") Tj ET");
    content.push("BT 0.2 0.25 0.3 rg /F2 6 Tf 475 35 Td (" + pdfEscapeWinAnsi(isFr ? "Document émis le:" : "Emitido em:") + ") Tj ET");
    content.push("BT 0.3 0.35 0.4 rg /F1 5.5 Tf 475 27 Td (" + pdfEscapeWinAnsi((new Date()).toISOString().slice(0, 10)) + ") Tj ET");

    pages.push({
      contentStream: content.join("\n"),
      images,
    });
  }

  return pages;
}

export async function buildProtocoleDeReparationPdf(
  budget: any,
  rev: any,
  workspace?: any,
  inspection?: any,
  logoImage?: PdfImageObject | null,
  langRaw: string = "pt",
): Promise<Buffer> {
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
  const allParts: any[] = Array.isArray(rev?.parts) ? rev?.parts : [];
  const allLabor: any[] = Array.isArray(rev?.labor) ? rev?.labor : [];
  const allItems: any[] = [...allServices, ...allParts, ...allLabor];
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
      const svc = allItems.find((s) => p.match.some((m) => String(s.description || "").toLowerCase().includes(m)) || (s.code && s.code === p.code));

      let dents = pts.reduce((sum, pt) => sum + (Number(pt.dentCount) || 1), 0);
      let isAlu = pts.some((pt) => pt.partMaterial === "aluminum") || String(svc?.description || "").includes("[ALU]");
      let isColle = String(svc?.description || "").toLowerCase().includes("colle") || String(svc?.description || "").toLowerCase().includes("cola");
      let isDap = String(svc?.description || "").toLowerCase().includes("dap");
      let isPaint = pts.some((pt) => pt.damageType === "paint_damage") || String(svc?.description || "").toLowerCase().includes("peint") || String(svc?.description || "").toLowerCase().includes("pintura");
      let isNew = pts.some((pt) => pt.damageType === "replace") || String(svc?.description || "").toLowerCase().includes("substitu") || String(svc?.description || "").toLowerCase().includes("remplac");

      if (dents === 0 && svc) {
        const m = String(svc.description || "").match(/(\d+)\s*(?:mossa|mossas|dents|dent|bosse|bosses)/i);
        if (m) {
          dents = parseInt(m[1], 10);
        } else if (Number(svc.quantity) > 1 && !svc.pricing_mode) {
          dents = Number(svc.quantity);
        }
      }

      let baseUt = 0;
      let sommeUt = 0;
      let linePrix = 0;

      // Substituição de peça não gera UT de DSP nem preço de DSP
      if (!isNew && (dents > 0 || svc)) {
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
      content.push(`BT 0.1 0.12 0.16 rg /F1 6 Tf 175 ${curY + 2.5} Td (${dents > 0 ? (isNew ? `(${dents})` : dents) : "-"}) Tj ET`);
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

  const laborRows: { name: string; t1: string; t2: string; p: string; ing: string; comm: string; totalHours: number; totalPrice: number }[] = [];

  for (const l of allLabor) {
    const hours = Number(l.hours || l.quantity || 1);
    const rate = Number(l.hourly_rate || l.unit_price || 47);
    const lineTotal = hours * rate;
    laborRows.push({
      name: clipCell(String(l.description || l.name || "Mão de obra"), 26),
      t1: "-",
      t2: `${hours.toFixed(1)} H`,
      p: "-",
      ing: "-",
      comm: `${lineTotal.toFixed(2)} EUR`,
      totalHours: hours,
      totalPrice: lineTotal,
    });
  }

  if (laborRows.length === 0) {
    const paintServices = allServices.filter(s => String(s.description || "").toLowerCase().includes("pintura") || String(s.description || "").toLowerCase().includes("peint"));
    if (paintServices.length > 0) {
      for (const ps of paintServices) {
        const pr = Number(ps.unit_price || 0);
        laborRows.push({
          name: clipCell(String(ps.description), 26),
          t1: "-",
          t2: "-",
          p: "1 H",
          ing: "-",
          comm: `${pr.toFixed(2)} EUR`,
          totalHours: 1,
          totalPrice: pr,
        });
      }
    } else {
      laborRows.push(
        { name: i18n.paintElemHood, t1: "-", t2: "1 H", p: "3 H", ing: "3 H", comm: "-", totalHours: 7, totalPrice: 141 },
        { name: i18n.paintElemTrunk, t1: "-", t2: "1 H", p: "1 H", ing: "1 H", comm: "-", totalHours: 3, totalPrice: 94 },
        { name: i18n.paintElemRail, t1: "-", t2: "1 H", p: "1 H", ing: "1 H", comm: "-", totalHours: 3, totalPrice: 94 },
      );
    }
  }

  const totalLaborHours = laborRows.reduce((s, r) => s + r.totalHours, 0);
  const totalLaborPrice = laborRows.reduce((s, r) => s + r.totalPrice, 0);

  for (const pe of laborRows.slice(0, 4)) {
    content.push("0.85 0.88 0.9 RG 0.3 w");
    content.push(`40 ${curY} 515 9 re s`);
    content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 44 ${curY + 2.5} Td (${pdfEscapeWinAnsi(pe.name)}) Tj ET`);
    content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 175 ${curY + 2.5} Td (${pe.t1}) Tj ET`);
    content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 240 ${curY + 2.5} Td (${pe.t2}) Tj ET`);
    content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 330 ${curY + 2.5} Td (${pe.p}) Tj ET`);
    content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 420 ${curY + 2.5} Td (${pe.ing}) Tj ET`);
    content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 485 ${curY + 2.5} Td (${pe.comm}) Tj ET`);
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
  content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 240 ${curY + 2.5} Td (${totalLaborHours.toFixed(1)} H) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 330 ${curY + 2.5} Td (-) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 420 ${curY + 2.5} Td (-) Tj ET`);
  curY -= 9;

  // Total row
  content.push("0.88 0.9 0.93 rg");
  content.push(`40 ${curY} 515 9 re f`);
  content.push("0.75 0.78 0.82 RG 0.4 w");
  content.push(`40 ${curY} 515 9 re s`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 5.5 Tf 44 ${curY + 2.5} Td (Total) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 230 ${curY + 2.5} Td (${totalLaborPrice.toFixed(2)} EUR) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 320 ${curY + 2.5} Td (-) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 5.5 Tf 410 ${curY + 2.5} Td (-) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 5.5 Tf 485 ${curY + 2.5} Td (${totalLaborPrice.toFixed(2)} EUR) Tj ET`);
  curY -= 11;

  // Total Peinture/MO Bar
  const lblPaintBar = i18n.lblPaintBar;
  content.push("0.1 0.12 0.16 rg");
  content.push(`40 ${curY} 515 10 re f`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 44 ${curY + 2.5} Td (${pdfEscapeWinAnsi(lblPaintBar)}) Tj ET`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 485 ${curY + 2.5} Td (${totalLaborPrice.toFixed(2)} EUR) Tj ET`);
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
  const sig = rev?.signature;
  if (sig && (sig.signed || sig.signedAt)) {
    const signer = sig.signerName || budget.clientName || clientSnap.name || "Client";
    const dateStr = (sig.signedAt || "").slice(0, 10);
    const method = sig.confirmationMethod === "EXPLICIT_CONFIRMATION" ? (lang === "fr" ? "Valide" : "Aprovado") : (lang === "fr" ? "Signe" : "Assinado");
    content.push(`BT 0.08 0.55 0.25 rg /F2 5.5 Tf 424 ${aY + 10.5} Td (${pdfEscapeWinAnsi(`[${method}: ${clipCell(signer, 14)} ${dateStr}]`)}) Tj ET`);
  }

  // 6. MULTI-TENANT WHITELABEL FOOTER (Y: 45 -> 15)
  content.push("0.1 0.12 0.16 RG 1 w");
  content.push("40 45 m 555 45 l S");

  content.push("BT 0.2 0.25 0.3 rg /F2 6 Tf 40 35 Td (" + pdfEscapeWinAnsi(companyName) + ") Tj ET");
  content.push("BT 0.3 0.35 0.4 rg /F1 5.5 Tf 40 27 Td (" + pdfEscapeWinAnsi(legalAddress + " - " + postalCity) + ") Tj ET");

  content.push("BT 0.2 0.25 0.3 rg /F2 6 Tf 230 35 Td (" + pdfEscapeWinAnsi("Tel: " + companyPhone + " | N' Vert: " + tollFree) + ") Tj ET");
  content.push("BT 0.3 0.35 0.4 rg /F1 5.5 Tf 230 27 Td (" + pdfEscapeWinAnsi(companyEmail + " - " + companyWebsite) + ") Tj ET");

  content.push("BT 0.2 0.25 0.3 rg /F2 6 Tf 475 35 Td (Version du:) Tj ET");
  content.push("BT 0.3 0.35 0.4 rg /F1 5.5 Tf 475 27 Td (" + pdfEscapeWinAnsi((new Date()).toISOString().slice(0, 10)) + ") Tj ET");

  const page1Def: PdfPageDef = {
    contentStream: content.join("\n"),
    images: logoImage ? { Im1: logoImage } : undefined,
  };

  const annexPages = await buildInspectionAnnexPages(budget, rev, workspace, inspection, langRaw);
  return assembleMultiPagePdf([page1Def, ...annexPages]);
}

export async function buildAutomotiveServicePdf(
  budget: any,
  rev: any,
  workspace?: any,
  inspection?: any,
  logoImage?: PdfImageObject | null,
  langRaw: string = "pt",
): Promise<Buffer> {
  const lang = normalizePdfLang(langRaw);
  const isFr = lang === "fr";
  const content: string[] = [];

  const brand = workspace?.brandConfig || {};
  const companyName = brand.legalName || brand.name || workspace?.billingProfile?.companyName || workspace?.billingProfile?.legalName || workspace?.name || "Operix Automotive";
  const defaultTagline = isFr ? "Atelier de réparation & carrosserie automobile de précision" : "Oficina de reparação e serviços automotivos de precisão";
  const tagline = brand.tagline || defaultTagline;
  const legalAddress = brand.address || workspace?.billingProfile?.billingAddress || "388 Rue Louis Joseph Gay Lussac";
  const postalCity = [brand.postalCode || workspace?.billingProfile?.postalCode || "26100", brand.city || workspace?.billingProfile?.city || "Romans sur Isere"].filter(Boolean).join(" ");
  const companyPhone = brand.phone || "04 87 20 01 47";
  const tollFree = brand.tollFree || companyPhone;
  const companyEmail = brand.email || workspace?.billingProfile?.billingEmail || "contact@operix.app";
  const companyWebsite = brand.website || "www.operix.app";

  const clientSnap = (rev?.clientSnapshot as any) || {};
  const vehiclePlate = String(budget.vehiclePlate || (isFr ? "SANS IMMAT" : "SEM PLACA")).toUpperCase();
  const protocolCode = budget.code || "ORC-0000";
  const revDate = (rev?.createdAt ? new Date(rev.createdAt) : budget?.createdAt ? new Date(budget.createdAt) : new Date()).toISOString().slice(0, 10);
  const isApproved = rev?.status === "approved" || budget?.status === "approved";

  // Category Title based on budget type
  const rawType = String(rev?.budgetType || budget?.budget_type || "").toLowerCase();
  let categoryTitle = isFr ? "DEVIS DE RÉPARATION AUTOMOBILE" : "ORÇAMENTO DE REPARAÇÃO AUTOMOTIVA";
  if (rawType === "mechanics") {
    categoryTitle = isFr ? "DEVIS - MÉCANIQUE GÉNÉRALE" : "ORÇAMENTO - MECÂNICA GERAL";
  } else if (rawType === "body_paint") {
    categoryTitle = isFr ? "DEVIS - FUNILARIA & PINTURA" : "ORÇAMENTO - FUNILARIA & PINTURA";
  } else if (rawType === "assembly_disassembly") {
    categoryTitle = isFr ? "DEVIS - MONTAGEM & DESMONTAGEM" : "ORÇAMENTO - MONTAGEM & DESMONTAGEM";
  }

  // 1. TOP HEADER & TITLE
  content.push("0.1 0.12 0.16 rg");
  content.push("300 794 255 28 re f");

  content.push("BT");
  content.push("1 1 1 rg");
  content.push("/F2 10.5 Tf");
  content.push("312 804 Td");
  content.push(`(${pdfEscapeWinAnsi(categoryTitle)}) Tj`);
  content.push("ET");

  // Red plate badge
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

  // Document code & revision date
  const docMeta = `${isFr ? "Devis N°" : "Orçamento N°"}: ${protocolCode} | Rev. ${rev?.revisionNumber || 1} | ${revDate}`;
  content.push("BT 0.3 0.35 0.4 rg /F2 6.5 Tf 305 750 Td (" + pdfEscapeWinAnsi(docMeta) + ") Tj ET");

  // Company Brand / Logo on Left
  if (logoImage) {
    const maxW = 250;
    const maxH = 60;
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

    content.push("BT 0.4 0.45 0.5 rg /F2 6 Tf 40 743 Td (" + pdfEscapeWinAnsi(tagline) + ") Tj ET");
  } else {
    content.push("BT 0.1 0.12 0.16 rg /F2 16 Tf 40 798 Td (" + pdfEscapeWinAnsi(companyName) + ") Tj ET");
    content.push("BT 0.35 0.4 0.45 rg /F1 7 Tf 40 784 Td (" + pdfEscapeWinAnsi(`${legalAddress} - ${postalCity} | Tel: ${companyPhone}`) + ") Tj ET");
    content.push("BT 0.35 0.4 0.45 rg /F1 6.5 Tf 40 772 Td (" + pdfEscapeWinAnsi(`${companyEmail} - ${companyWebsite}`) + ") Tj ET");
    content.push("BT 0.4 0.45 0.5 rg /F2 6 Tf 40 745 Td (" + pdfEscapeWinAnsi(tagline) + ") Tj ET");
  }

  // Divider Line
  content.push("0.1 0.12 0.16 RG 1.5 w");
  content.push("40 738 m 555 738 l S");

  // 2. CLIENT & VEHICLE GRID (Y: 735 -> 675, H: 60)
  content.push("0.75 0.78 0.82 RG 0.5 w");
  content.push("40 675 515 60 re s");
  content.push("170 675 m 170 735 l S");
  content.push("285 675 m 285 735 l S");
  content.push("415 675 m 415 735 l S");
  content.push("40 715 m 555 715 l S");
  content.push("40 695 m 555 695 l S");

  // Col 1: CLIENT
  const cName = budget.clientName || clientSnap.name || (isFr ? "Client particulier" : "Cliente particular");
  const cAddr = clientSnap.address?.street
    ? [clientSnap.address.street, clientSnap.address.postal, clientSnap.address.city].filter(Boolean).join(", ")
    : (typeof clientSnap.address === "string" ? clientSnap.address : "-");
  const cPhone = clientSnap.phone || clientSnap.telephone || "-";

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 44 725 Td (${pdfEscapeWinAnsi(isFr ? "NOM DU CLIENT" : "NOME DO CLIENTE")}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 7 Tf 44 717 Td (${pdfEscapeWinAnsi(clipCell(cName, 22))}) Tj ET`);
  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 44 705 Td (${pdfEscapeWinAnsi(isFr ? "ADRESSE / VILLE" : "ENDEREÇO / CIDADE")}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 6.5 Tf 44 697 Td (${pdfEscapeWinAnsi(clipCell(cAddr, 24))}) Tj ET`);
  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 44 685 Td (${pdfEscapeWinAnsi(isFr ? "N° TÉL." : "N° TEL.")}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 7 Tf 44 677 Td (${pdfEscapeWinAnsi(clipCell(cPhone, 20))}) Tj ET`);

  // Col 2: VEHICLE
  const vBrand = budget.vehicleBrand || "-";
  const vModel = budget.vehicleModel || "-";
  const vColor = budget.vehicleColor || (rev?.vehicleSnapshot as any)?.color || "-";

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 174 725 Td (${pdfEscapeWinAnsi(isFr ? "MARQUE" : "MARCA")}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 7 Tf 174 717 Td (${pdfEscapeWinAnsi(clipCell(vBrand, 16))}) Tj ET`);
  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 174 705 Td (${pdfEscapeWinAnsi(isFr ? "MODÈLE" : "MODELO")}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 7 Tf 174 697 Td (${pdfEscapeWinAnsi(clipCell(vModel, 16))}) Tj ET`);
  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 174 685 Td (${pdfEscapeWinAnsi(isFr ? "COULEUR" : "COR")}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 6.5 Tf 174 677 Td (${pdfEscapeWinAnsi(clipCell(vColor, 16))}) Tj ET`);

  // Col 3: IDENTIFICATION
  const vVin = budget.vehicleVin || "-";
  const vKm = budget.mileage || (rev?.vehicleSnapshot as any)?.mileage || "-";

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 289 725 Td (${pdfEscapeWinAnsi(isFr ? "IMMATRICULATION" : "PLACA / MATRÍCULA")}) Tj ET`);
  content.push(`BT 0.75 0.1 0.1 rg /F2 7.5 Tf 289 717 Td (${pdfEscapeWinAnsi(plateText)}) Tj ET`);
  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 289 705 Td (${pdfEscapeWinAnsi(isFr ? "N° DE CHÂSSIS (VIN)" : "N° DE CHASSI (VIN)")}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 6.5 Tf 289 697 Td (${pdfEscapeWinAnsi(clipCell(vVin, 18))}) Tj ET`);
  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 289 685 Td (${pdfEscapeWinAnsi(isFr ? "KILOMÉTRAGE" : "QUILOMETRAGEM")}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 6.5 Tf 289 677 Td (${pdfEscapeWinAnsi(vKm !== "-" ? `${vKm} km` : "-")}) Tj ET`);

  // Col 4: PROTOCOL
  const validText = isApproved ? (isFr ? "Validé / Approuvé" : "Aprovado / Confirmado") : (isFr ? "Valable 15 jours" : "Válido por 15 dias");

  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 419 725 Td (${pdfEscapeWinAnsi(isFr ? "N° DU DEVIS" : "N° DO ORÇAMENTO")}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 7 Tf 419 717 Td (${pdfEscapeWinAnsi(protocolCode)}) Tj ET`);
  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 419 705 Td (${pdfEscapeWinAnsi(isFr ? "DATE D'ÉMISSION" : "DATA DE EMISSÃO")}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F1 6.5 Tf 419 697 Td (${pdfEscapeWinAnsi(revDate)}) Tj ET`);
  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 419 685 Td (${pdfEscapeWinAnsi(isFr ? "VALIDITÉ / STATUT" : "VALIDADE / STATUS")}) Tj ET`);
  content.push(`BT ${isApproved ? "0.08 0.55 0.25" : "0.3 0.35 0.4"} rg /F2 6.5 Tf 419 677 Td (${pdfEscapeWinAnsi(validText)}) Tj ET`);

  // 3. TABLE ITEMS HEADER (Y: 652 -> 670)
  content.push("0.15 0.20 0.28 rg 40 650 515 18 re f");
  content.push("BT 1 1 1 rg /F2 7 Tf 46 656 Td (" + pdfEscapeWinAnsi(isFr ? "DESCRIPTION DES PRESTATIONS & PIÈCES" : "DESCRIÇÃO DOS SERVIÇOS & PEÇAS") + ") Tj ET");
  content.push("BT 1 1 1 rg /F2 7 Tf 300 656 Td (" + pdfEscapeWinAnsi(isFr ? "CATÉGORIE" : "CATEGORIA") + ") Tj ET");
  content.push("BT 1 1 1 rg /F2 7 Tf 375 656 Td (" + pdfEscapeWinAnsi(isFr ? "QTÉ / H" : "QTD / H") + ") Tj ET");
  content.push("BT 1 1 1 rg /F2 7 Tf 440 656 Td (" + pdfEscapeWinAnsi(isFr ? "UNIT. EUR" : "UNIT. EUR") + ") Tj ET");
  content.push("BT 1 1 1 rg /F2 7 Tf 510 656 Td (" + pdfEscapeWinAnsi(isFr ? "TOTAL EUR" : "TOTAL EUR") + ") Tj ET");

  // 4. ITEMS LISTING
  const svcRows = (Array.isArray(rev?.services) ? rev.services : []) as any[];
  const partRows = (Array.isArray(rev?.parts) ? rev.parts : []) as any[];
  const laborRows = (Array.isArray(rev?.labor) ? rev.labor : []) as any[];

  let curY = 634;
  const rowH = 15;
  const maxY = 255;

  const renderSectionHeader = (title: string) => {
    if (curY < maxY) return;
    content.push(`0.92 0.94 0.97 rg 40 ${curY - 3} 515 14 re f`);
    content.push(`0.8 0.83 0.88 RG 0.5 w 40 ${curY - 3} 515 14 re s`);
    content.push(`BT 0.2 0.25 0.35 rg /F2 6.5 Tf 46 ${curY + 1} Td (${pdfEscapeWinAnsi(title)}) Tj ET`);
    curY -= 15;
  };

  const renderTableRow = (desc: string, cat: string, qty: string, pu: string, tot: string, idx: number) => {
    if (curY < maxY) return;
    if (idx % 2 === 0) {
      content.push(`0.98 0.98 0.99 rg 40 ${curY - 3} 515 ${rowH} re f`);
    }
    content.push(`0.9 0.92 0.94 RG 0.5 w 40 ${curY - 3} m 555 ${curY - 3} l S`);

    content.push(`BT 0.15 0.18 0.22 rg /F1 6.5 Tf 46 ${curY + 2} Td (${pdfEscapeWinAnsi(clipCell(desc, 44))}) Tj ET`);
    content.push(`BT 0.35 0.4 0.45 rg /F1 6.5 Tf 300 ${curY + 2} Td (${pdfEscapeWinAnsi(clipCell(cat, 14))}) Tj ET`);
    content.push(`BT 0.15 0.18 0.22 rg /F1 6.5 Tf 380 ${curY + 2} Td (${pdfEscapeWinAnsi(qty)}) Tj ET`);
    content.push(`BT 0.15 0.18 0.22 rg /F1 6.5 Tf 440 ${curY + 2} Td (${pdfEscapeWinAnsi(pu)}) Tj ET`);
    content.push(`BT 0.1 0.12 0.16 rg /F2 6.5 Tf 510 ${curY + 2} Td (${pdfEscapeWinAnsi(tot)}) Tj ET`);
    curY -= rowH;
  };

  let rowCount = 0;

  // 4.1 Services
  if (svcRows.length > 0) {
    renderSectionHeader(isFr ? `1. PRESTATIONS & SERVICES TECHNIQUES (${svcRows.length})` : `1. PRESTAÇÕES & SERVIÇOS TÉCNICOS (${svcRows.length})`);
    svcRows.forEach((s: any) => {
      const isFixed = s.pricing_mode === "fixed" || s.pricingMode === "fixed";
      const q = Math.max(1, Number(s.quantity ?? 1) || 1);
      const pu = Number(s.unit_price ?? s.unitPrice ?? s.price ?? 0) || 0;
      const tot = Number(s.total) || (isFixed ? pu : q * pu);
      const desc = s.name || s.description || (isFr ? "Prestation d'atelier" : "Serviço de oficina");
      const cat = isFixed ? (isFr ? "Forfait" : "Fixo") : (isFr ? "Service" : "Serviço");
      renderTableRow(desc, cat, String(q), `${pu.toFixed(2)}`, `${tot.toFixed(2)}`, rowCount++);
    });
  }

  // 4.2 Parts
  if (partRows.length > 0) {
    renderSectionHeader(isFr ? `2. PIÈCES & FOURNITURES (${partRows.length})` : `2. PEÇAS & MATERIAIS DE REPOSIÇÃO (${partRows.length})`);
    partRows.forEach((p: any) => {
      const q = Math.max(1, Number(p.quantity ?? 1) || 1);
      const pu = Number(p.unit_price ?? p.unitPrice ?? p.price ?? 0) || 0;
      const tot = Number(p.total) || (q * pu);
      const desc = p.description || p.name || (isFr ? "Pièce détachée" : "Peça de reposição");
      renderTableRow(desc, isFr ? "Pièce" : "Peça", String(q), `${pu.toFixed(2)}`, `${tot.toFixed(2)}`, rowCount++);
    });
  }

  // 4.3 Labor
  if (laborRows.length > 0) {
    renderSectionHeader(isFr ? `3. MAIN-D'ŒUVRE TECHNIQUE (${laborRows.length})` : `3. MÃO DE OBRA & OPERAÇÕES TÉCNICAS (${laborRows.length})`);
    laborRows.forEach((l: any) => {
      const h = Math.max(0.5, Number(l.hours ?? l.quantity ?? 1) || 1);
      const rate = Number(l.hourly_rate ?? l.hourlyRate ?? l.rate ?? l.unitPrice ?? 0) || 0;
      const tot = Number(l.total) || (h * rate);
      const desc = l.description || l.name || (isFr ? "Main d'œuvre" : "Mão de Obra");
      renderTableRow(desc, isFr ? "M.O." : "Mão de Obra", `${h.toFixed(1)} h`, `${rate.toFixed(2)}`, `${tot.toFixed(2)}`, rowCount++);
    });
  }

  // Fallback if no items listed
  if (rowCount === 0) {
    const grossVal = Number(rev?.grossTotal ?? budget?.gross_total ?? 0) || 0;
    renderTableRow(
      isFr ? "Prestation de réparation et remise en état d'atelier" : "Serviço de reparação e manutenção veicular em oficina",
      isFr ? "Général" : "Geral",
      "1",
      grossVal.toFixed(2),
      grossVal.toFixed(2),
      0
    );
  }

  // 5. OBSERVATIONS / TECHNICAL SCOPE (Left Box, Y: 150 -> 245, W: 275)
  const obsY = 150;
  const obsH = 95;
  content.push(`0.98 0.98 0.99 rg 40 ${obsY} 275 ${obsH} re f`);
  content.push(`0.75 0.78 0.82 RG 0.5 w 40 ${obsY} 275 ${obsH} re s`);

  content.push(`0.2 0.25 0.32 rg 40 ${obsY + obsH - 14} 275 14 re f`);
  content.push(`BT 1 1 1 rg /F2 6.5 Tf 46 ${obsY + obsH - 10} Td (${pdfEscapeWinAnsi(isFr ? "AVIS TECHNIQUE & PÉRIMÈTRE D'INTERVENTION" : "PARECER TÉCNICO & ESCOPO DE INTERVENÇÃO")}) Tj ET`);

  const diagText = rev?.diagnosis || rev?.technicalDescription || rev?.notes || (isFr
    ? "Prestations exécutées selon les règles de l'art et les préconisations du constructeur."
    : "Serviços e peças executados conforme normas técnicas e padrões do fabricante.");
  const diagSplit = splitTwoLines(diagText, 44, 44);
  content.push(`BT 0.2 0.25 0.3 rg /F1 6 Tf 46 ${obsY + 64} Td (${pdfEscapeWinAnsi(diagSplit.line1)}) Tj ET`);
  if (diagSplit.line2) {
    content.push(`BT 0.2 0.25 0.3 rg /F1 6 Tf 46 ${obsY + 54} Td (${pdfEscapeWinAnsi(diagSplit.line2)}) Tj ET`);
  }

  const intervList = Array.isArray(rev?.interventionTypes) && rev.interventionTypes.length > 0
    ? rev.interventionTypes.join(", ")
    : null;
  if (intervList) {
    const intSplit = splitTwoLines(`${isFr ? "Interventions: " : "Intervenções: "}${intervList}`, 44, 44);
    content.push(`BT 0.3 0.45 0.6 rg /F2 6 Tf 46 ${obsY + 38} Td (${pdfEscapeWinAnsi(intSplit.line1)}) Tj ET`);
    if (intSplit.line2) {
      content.push(`BT 0.3 0.45 0.6 rg /F2 6 Tf 46 ${obsY + 28} Td (${pdfEscapeWinAnsi(intSplit.line2)}) Tj ET`);
    }
  }

  const legalReassurance = isFr
    ? "Garantie pièces et main-d'œuvre selon les conditions générales de vente de l'atelier."
    : "Garantia de peças e serviços conforme normas vigentes e diretrizes técnicas do fabricante.";
  content.push(`BT 0.45 0.5 0.55 rg /F1 5 Tf 46 ${obsY + 12} Td (${pdfEscapeWinAnsi(legalReassurance)}) Tj ET`);

  // 6. COMMERCIAL TOTALS BOX (Right Box, Y: 150 -> 245, W: 230)
  const totX = 325;
  const totW = 230;
  content.push(`0.97 0.98 0.99 rg ${totX} ${obsY} ${totW} ${obsH} re f`);
  content.push(`0.75 0.78 0.82 RG 0.5 w ${totX} ${obsY} ${totW} ${obsH} re s`);

  const grossTotal = Number(rev?.grossTotal ?? budget?.gross_total ?? 0) || 0;
  const discountTotal = Number(rev?.discountTotal ?? 0) || 0;
  const discountPct = Number(rev?.discountPct ?? 0) || 0;
  const taxPct = Number(rev?.taxPct ?? 20) || 20;
  const taxTotal = Number(rev?.taxTotal ?? ((grossTotal - discountTotal) * (taxPct / 100))) || 0;
  const finalTotal = Number(rev?.finalTotal ?? budget?.final_total ?? (grossTotal - discountTotal + taxTotal)) || 0;

  content.push(`BT 0.35 0.4 0.45 rg /F1 7 Tf ${totX + 8} ${obsY + 76} Td (${pdfEscapeWinAnsi(isFr ? "Sous-total Brut H.T. :" : "Subtotal Bruto H.T. :")}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 7.5 Tf ${totX + 155} ${obsY + 76} Td (${pdfEscapeWinAnsi(`${grossTotal.toFixed(2)} EUR`)}) Tj ET`);

  if (discountTotal > 0 || discountPct > 0) {
    const discLabel = isFr ? `Remise (${discountPct}%) :` : `Desconto (${discountPct}%) :`;
    content.push(`BT 0.8 0.2 0.2 rg /F1 7 Tf ${totX + 8} ${obsY + 61} Td (${pdfEscapeWinAnsi(discLabel)}) Tj ET`);
    content.push(`BT 0.8 0.2 0.2 rg /F2 7.5 Tf ${totX + 150} ${obsY + 61} Td (${pdfEscapeWinAnsi(`- ${discountTotal.toFixed(2)} EUR`)}) Tj ET`);
  }

  const taxLabel = isFr ? `TVA (${taxPct}%) :` : `IVA / Imposto (${taxPct}%) :`;
  content.push(`BT 0.35 0.4 0.45 rg /F1 7 Tf ${totX + 8} ${obsY + 46} Td (${pdfEscapeWinAnsi(taxLabel)}) Tj ET`);
  content.push(`BT 0.1 0.12 0.16 rg /F2 7.5 Tf ${totX + 155} ${obsY + 46} Td (${pdfEscapeWinAnsi(`${taxTotal.toFixed(2)} EUR`)}) Tj ET`);

  // Final Total Bar (Highlight)
  content.push(`0.1 0.12 0.16 rg ${totX} ${obsY} ${totW} 26 re f`);
  content.push(`BT 1 1 1 rg /F2 9.5 Tf ${totX + 8} ${obsY + 9} Td (${pdfEscapeWinAnsi(isFr ? "TOTAL GÉNÉRAL TTC :" : "TOTAL GERAL TTC :")}) Tj ET`);
  content.push(`BT 1 0.85 0.3 rg /F2 10 Tf ${totX + 140} ${obsY + 9} Td (${pdfEscapeWinAnsi(`${finalTotal.toFixed(2)} EUR`)}) Tj ET`);

  // 7. SIGNATURES BLOCK (Y: 60 -> 138, H: 78)
  const sigY = 60;
  const sigH = 78;

  // Box 1: Client Signature
  content.push(`0.98 0.98 0.99 rg 40 ${sigY} 250 ${sigH} re f`);
  content.push(`0.75 0.78 0.82 RG 0.5 w 40 ${sigY} 250 ${sigH} re s`);
  content.push(`0.25 0.3 0.38 rg 40 ${sigY + sigH - 14} 250 14 re f`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 46 ${sigY + sigH - 10} Td (${pdfEscapeWinAnsi(isFr ? "BON POUR ACCORD & SIGNATURE DU CLIENT" : "TERMO DE ACEITE & ASSINATURA DO CLIENTE")}) Tj ET`);

  const sig = rev?.signature;
  if (sig && (sig.signed || sig.signedAt)) {
    const signer = sig.signerName || budget.clientName || clientSnap.name || (isFr ? "Client" : "Cliente");
    const dateStr = (sig.signedAt || "").slice(0, 10);
    content.push(`0.93 0.98 0.94 rg 48 ${sigY + 22} 234 34 re f`);
    content.push(`0.15 0.65 0.3 RG 0.5 w 48 ${sigY + 22} 234 34 re s`);
    content.push(`BT 0.08 0.55 0.25 rg /F2 7 Tf 54 ${sigY + 44} Td (${pdfEscapeWinAnsi(isFr ? "[DEVIS SIGNÉ & APPROUVÉ PAR LE CLIENT]" : "[ORÇAMENTO ASSINADO DIGITALMENTE]")}) Tj ET`);
    content.push(`BT 0.2 0.25 0.3 rg /F1 6.5 Tf 54 ${sigY + 33} Td (${pdfEscapeWinAnsi(`${isFr ? "Signataire:" : "Signatário:"} ${signer}`)}) Tj ET`);
    content.push(`BT 0.4 0.45 0.5 rg /F1 6 Tf 54 ${sigY + 24} Td (${pdfEscapeWinAnsi(`Date: ${dateStr}`)}) Tj ET`);
  } else {
    content.push(`BT 0.4 0.45 0.5 rg /F1 6 Tf 48 ${sigY + 48} Td (${pdfEscapeWinAnsi(isFr ? "Bon pour commande et exécution des travaux chiffrés." : "Autorizo a execução dos serviços e fornecimento de peças.")}) Tj ET`);
    content.push(`BT 0.5 0.55 0.6 rg /F1 6 Tf 48 ${sigY + 28} Td (................................................................................) Tj ET`);
    content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 48 ${sigY + 16} Td (${pdfEscapeWinAnsi(isFr ? "Signature et date du client précédées de « Bon pour accord »" : "Assinatura do Cliente / Data")}) Tj ET`);
  }

  // Box 2: Workshop Technical Manager
  content.push(`0.98 0.98 0.99 rg 305 ${sigY} 250 ${sigH} re f`);
  content.push(`0.75 0.78 0.82 RG 0.5 w 305 ${sigY} 250 ${sigH} re s`);
  content.push(`0.25 0.3 0.38 rg 305 ${sigY + sigH - 14} 250 14 re f`);
  content.push(`BT 1 1 1 rg /F2 6 Tf 311 ${sigY + sigH - 10} Td (${pdfEscapeWinAnsi(isFr ? "DIRECTION TECHNIQUE & ATELIER" : "RESPONSÁVEL TÉCNICO & OFICINA")}) Tj ET`);

  content.push(`BT 0.2 0.25 0.3 rg /F2 7 Tf 313 ${sigY + 48} Td (${pdfEscapeWinAnsi(companyName)}) Tj ET`);
  content.push(`BT 0.4 0.45 0.5 rg /F1 6 Tf 313 ${sigY + 38} Td (${pdfEscapeWinAnsi(isFr ? "Engagement de conformité technique et garantie d'exécution." : "Garantia de conformidade técnica e operacional.")}) Tj ET`);
  content.push(`BT 0.5 0.55 0.6 rg /F1 6 Tf 313 ${sigY + 24} Td (................................................................................) Tj ET`);
  content.push(`BT 0.4 0.45 0.5 rg /F2 5.5 Tf 313 ${sigY + 14} Td (${pdfEscapeWinAnsi(isFr ? "Visa et cachet de l'atelier" : "Visto e carimbo da oficina")}) Tj ET`);

  // 8. MULTI-TENANT FOOTER (Y: 45 -> 15)
  content.push("0.1 0.12 0.16 RG 1 w");
  content.push("40 45 m 555 45 l S");

  content.push("BT 0.2 0.25 0.3 rg /F2 6 Tf 40 35 Td (" + pdfEscapeWinAnsi(companyName) + ") Tj ET");
  content.push("BT 0.3 0.35 0.4 rg /F1 5.5 Tf 40 27 Td (" + pdfEscapeWinAnsi(legalAddress + " - " + postalCity) + ") Tj ET");

  content.push("BT 0.2 0.25 0.3 rg /F2 6 Tf 230 35 Td (" + pdfEscapeWinAnsi("Tel: " + companyPhone + " | N. Vert: " + tollFree) + ") Tj ET");
  content.push("BT 0.3 0.35 0.4 rg /F1 5.5 Tf 230 27 Td (" + pdfEscapeWinAnsi(companyEmail + " - " + companyWebsite) + ") Tj ET");

  content.push("BT 0.2 0.25 0.3 rg /F2 6 Tf 475 35 Td (" + pdfEscapeWinAnsi(isFr ? "Document émis le:" : "Emitido em:") + ") Tj ET");
  content.push("BT 0.3 0.35 0.4 rg /F1 5.5 Tf 475 27 Td (" + pdfEscapeWinAnsi((new Date()).toISOString().slice(0, 10)) + ") Tj ET");

  const page1Def: PdfPageDef = {
    contentStream: content.join("\n"),
    images: logoImage ? { Im1: logoImage } : undefined,
  };

  const annexPages = await buildInspectionAnnexPages(budget, rev, workspace, inspection, langRaw);
  return assembleMultiPagePdf([page1Def, ...annexPages]);
}

export async function generateBudgetPdfBuffer(
  budget: any,
  rev: any,
  workspace?: any,
  inspection?: any,
  langRaw: string = "pt",
): Promise<Buffer> {
  const rawType = String(rev?.budgetType || budget?.budget_type || "").toLowerCase();
  const svcRows = (Array.isArray(rev?.services) ? rev?.services : []) as any[];
  const hasPdrServices = svcRows.some((s: any) => {
    const d = String(s.name || s.description || "").toLowerCase();
    return d.includes("dsp") || d.includes("pdr") || d.includes("martelinho") || d.includes("déchocage") || d.includes("grele") || d.includes("grêle") || d.includes("granizo");
  });
  const isPdr = rawType === "pdr" || (!rawType && hasPdrServices);

  const rawLogoUrl = workspace?.logoUrl || (workspace?.brandConfig as any)?.logoUrl;
  const logoImage = await loadWorkspaceLogo(rawLogoUrl);

  if (isPdr) {
    return await buildProtocoleDeReparationPdf(budget, rev, workspace, inspection, logoImage, langRaw);
  }

  return await buildAutomotiveServicePdf(budget, rev, workspace, inspection, logoImage, langRaw);
}
