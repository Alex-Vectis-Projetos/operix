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

export function signerTypeLabel(t: BudgetSignerType | string | null | undefined, lang: "pt" | "fr"): string {
  return bdSignerTypeLabel(t, lang);
}

export function btLabel(t: BudgetType | string | null | undefined, lang: "pt" | "fr"): string {
  return bdBtLabel(t, lang);
}

export function getBudgetInterventions(b: { intervention_type?: string; intervention_types?: string[] | null }): string[] {
  return bdGetBudgetInterventions(b);
}

export function formatDateTime(iso: string | null | undefined): string {
  return bdFormatDateTime(iso);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  } catch {
    return String(iso ?? "—");
  }
}

export function computeTotalsFor(b: {
  parts?: Array<{ quantity?: number; unit_price?: number }> | null;
  services?: Array<{ quantity?: number; unit_price?: number }> | null;
  labor?: Array<{ hours?: number; hourly_rate?: number }> | null;
  discount_pct?: number | null;
  iva_pct?: number | null;
}) {
  const p = (b.parts || []).reduce(
    (s, x) => s + Math.max(0, Number(x?.quantity) || 0) * Math.max(0, Number(x?.unit_price) || 0),
    0,
  );
  const sv = Array.isArray(b.services)
    ? (b.services as Array<{ quantity?: number; unit_price?: number }>).reduce(
        (s: number, x: any) => s + Math.max(0, Number(x?.quantity) || 0) * Math.max(0, Number(x?.unit_price) || 0),
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
const line = (label: string, value: string) =>
  `<td style="padding:5px 8px;border-right:1px solid #c7ccd3;border-bottom:1px solid #c7ccd3;vertical-align:top;min-width:0"><div style="font-size:10px;color:#525a64;letter-spacing:0.03em;text-transform:uppercase;margin-bottom:2px">${esc(label)}</div><div style="font-size:12px;color:#111827;font-weight:600;min-height:16px;word-break:break-word;overflow-wrap:anywhere">${esc(value)}</div></td>`;

function lineOrDash(label: string, value: any): string {
  return line(label, notEmpty(value) ? String(value) : "—");
}

const TABLE_CELL = `padding:5px 8px;border:1px solid #c7ccd3;font-size:11px;vertical-align:top;color:#111827`;
const TABLE_HEADER_CELL = `padding:6px 8px;border:1px solid #374151;background:#374151;color:white;font-size:11px;font-weight:600;text-align:left;vertical-align:middle`;
const DARK_HEADER_CELL = `padding:6px 8px;border:1px solid #1f2937;background:#1f2937;color:white;font-size:11px;font-weight:700;text-align:center;vertical-align:middle;text-transform:uppercase;letter-spacing:0.04em`;
const GROUP_HEADER_CELL = `padding:5px 8px;border:1px solid #4b5563;background:#4b5563;color:white;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;vertical-align:middle`;
const SUB_ROW_CELL = `padding:3px 8px;border:1px solid #c7ccd3;font-size:11px;background:#f9fafb;color:#111827`;
const TOTAL_ROW_CELL = `padding:6px 8px;border:1px solid #374151;background:#374151;color:white;font-size:11px;font-weight:700;text-align:right`;

function buildLinesTable(
  title: string,
  lines: any[],
  descKey: string,
  qtyKey: string,
  priceKey: string,
  qtyLabel: string,
  unitLabel: string,
  subtotalLabel: string,
  totalLabel: string,
  lang: "pt" | "fr",
  extra?: { subRowFn?: (x: any) => string | null },
): string {
  const filled = (lines || []).filter(
    (x: any) => notEmpty(x[descKey]) && (Number(x[qtyKey] || 0) > 0 || Number(x[priceKey] || 0) > 0),
  );
  if (filled.length === 0) return "";
  let total = 0;
  const rows = filled
    .map((x: any, i: number) => {
      const qty = Number(x[qtyKey] || 0);
      const price = Number(x[priceKey] || 0);
      const subtotal = qty * price;
      total += subtotal;
      const extraRow = extra?.subRowFn ? extra.subRowFn(x) : null;
      return `<tr>
        <td style="${TABLE_CELL};width:5%;text-align:center">${i + 1}</td>
        <td style="${TABLE_CELL}">${esc(String(x[descKey] || ""))}</td>
        <td style="${TABLE_CELL};width:10%;text-align:right">${qty.toLocaleString("pt-BR")}</td>
        <td style="${TABLE_CELL};width:15%;text-align:right">${bdFormatBRL(price)}</td>
        <td style="${TABLE_CELL};width:17%;text-align:right;font-weight:600">${bdFormatBRL(subtotal)}</td>
      </tr>${extraRow ? `<tr><td style="${SUB_ROW_CELL}"></td><td style="${SUB_ROW_CELL}" colspan="4">${esc(extraRow)}</td></tr>` : ""}`;
    })
    .join("");
  const totalRow = `<tr>
    <td style="${TOTAL_ROW_CELL}" colspan="4">${esc(totalLabel)}:</td>
    <td style="${TOTAL_ROW_CELL};width:17%">${bdFormatBRL(total)}</td>
  </tr>`;
  return `<section style="margin-top:18px">
    <div style="background:#374151;color:white;padding:6px 10px;border:1px solid #374151;border-bottom:none;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em">${esc(title)}</div>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th style="${TABLE_HEADER_CELL};width:5%">#</th>
          <th style="${TABLE_HEADER_CELL}">${lang === "fr" ? "Description" : "Descrição"}</th>
          <th style="${TABLE_HEADER_CELL};width:10%;text-align:right">${esc(qtyLabel)}</th>
          <th style="${TABLE_HEADER_CELL};width:15%;text-align:right">${esc(unitLabel)}</th>
          <th style="${TABLE_HEADER_CELL};width:17%;text-align:right">${esc(subtotalLabel)}</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        ${totalRow}
      </tbody>
    </table>
  </section>`;
}

function buildLaborTable(lines: any[], lang: "pt" | "fr"): string {
  const filled = (lines || []).filter(
    (x: any) => notEmpty(x.description) && (Number(x.hours || 0) > 0 || Number(x.hourly_rate || 0) > 0),
  );
  if (filled.length === 0) return "";
  let total = 0;
  const rows = filled
    .map((x: any, i: number) => {
      const h = Number(x.hours || 0);
      const rate = Number(x.hourly_rate || 0);
      const subtotal = h * rate;
      total += subtotal;
      return `<tr>
        <td style="${TABLE_CELL};width:5%;text-align:center">${i + 1}</td>
        <td style="${TABLE_CELL}">${esc(String(x.description || ""))}</td>
        <td style="${TABLE_CELL};width:10%;text-align:right">${h.toLocaleString("pt-BR")} h</td>
        <td style="${TABLE_CELL};width:15%;text-align:right">${bdFormatBRL(rate)}</td>
        <td style="${TABLE_CELL};width:17%;text-align:right;font-weight:600">${bdFormatBRL(subtotal)}</td>
      </tr>`;
    })
    .join("");
  return `<section style="margin-top:18px">
    <div style="background:#374151;color:white;padding:6px 10px;border:1px solid #374151;border-bottom:none;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em">${lang === "fr" ? "Main d'œuvre" : "Mão de Obra"}</div>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr>
          <th style="${TABLE_HEADER_CELL};width:5%">#</th>
          <th style="${TABLE_HEADER_CELL}">${lang === "fr" ? "Description" : "Descrição"}</th>
          <th style="${TABLE_HEADER_CELL};width:10%;text-align:right">${lang === "fr" ? "Heures" : "Horas"}</th>
          <th style="${TABLE_HEADER_CELL};width:15%;text-align:right">${lang === "fr" ? "Taux horaire" : "Hora"}</th>
          <th style="${TABLE_HEADER_CELL};width:17%;text-align:right">${lang === "fr" ? "Sous-total" : "Subtotal"}</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr>
          <td style="${TOTAL_ROW_CELL}" colspan="4">${lang === "fr" ? "Total Main d'œuvre" : "Total Mão de Obra"}:</td>
          <td style="${TOTAL_ROW_CELL};width:17%">${bdFormatBRL(total)}</td>
        </tr>
      </tbody>
    </table>
  </section>`;
}

export function buildPrintableBudget(b: Budget, lang: "pt" | "fr" = "pt"): string {
  const t = computeTotalsFor(b);
  const sections: string[] = [];

  // 1 — HEADER PROTOCOLE DE RÉPARATION (banda cinza escura, faixa cinza clara)
  const headerTitle = lang === "fr" ? "PROTOCOLE DE RÉPARATION" : "PROTOCOLO DE REPARAÇÃO / ORÇAMENTO";
  sections.push(`<div style="background:#2b2f36;color:white;padding:14px 24px;text-align:center;margin-bottom:6px;border:1px solid #111827">
    <h1 style="margin:0;font-size:20px;font-weight:800;letter-spacing:0.18em;text-transform:uppercase">${esc(headerTitle)}</h1>
  </div>
  <div style="background:#d6d8dc;height:10px;border:1px solid #c2c5cb;border-top:none;margin-bottom:14px"></div>
  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px;padding:0 4px">
    <div>
      <div style="font-size:9px;color:#4b5563;letter-spacing:0.1em;text-transform:uppercase">Operix</div>
      <div style="font-size:12px;font-weight:600;color:#111827">${lang === "fr" ? "Atelier de réparation automobile" : "Oficina de reparação automotiva"}</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:9px;color:#4b5563;letter-spacing:0.1em;text-transform:uppercase">${lang === "fr" ? "N° de Protocole" : "Nº OS / Protocolo"}</div>
      <div style="font-size:16px;font-weight:800;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#111827;letter-spacing:0.05em">${esc(b.number || "(rascunho)")}</div>
      <div style="font-size:10px;color:#4b5563;margin-top:4px">${lang === "fr" ? "Émis le" : "Emissão"}: ${formatDate(b.issued_at || new Date().toISOString())}</div>
    </div>
  </div>`);

  // 2 — Tabela Cliente + Veículo (estilo grade 4x3 exatamente como modelo imagem)
  const clientName =
    notEmpty(b.client_name) || notEmpty(b.client_display_id)
      ? [notEmpty(b.client_display_id) ? `[${String(b.client_display_id)}]` : "", b.client_name || ""]
          .filter(Boolean)
          .join(" ")
          .trim()
      : "";
  const addr1 = [b.address_street, b.address_number].filter(notEmpty).join(", ");
  const addr2 = [b.address_postal, b.address_city, b.address_country].filter(notEmpty).join(" / ");
  const clientAddr = [addr1, addr2].filter(notEmpty).join(" — ");
  const clientPhone = [b.client_phone, b.client_email].filter(notEmpty).join(" · ");
  const vehicleType = isValidBudgetType(b.budget_type) ? bdBtLabel(b.budget_type, lang) : "";
  const dossierInfo = [b.dossier_insurance_company, b.dossier_garage_name].filter(notEmpty).join(" · ");

  sections.push(`<table style="width:100%;border-collapse:collapse;margin-bottom:14px">
    <colgroup>
      <col style="width:26%" /><col style="width:22%" /><col style="width:26%" /><col style="width:26%" />
    </colgroup>
    <tbody>
      <tr>
        ${lineOrDash(lang === "fr" ? "Nom Client" : "Nome Cliente", clientName)}
        ${lineOrDash(lang === "fr" ? "Marque" : "Marca", b.vehicle_brand)}
        ${lineOrDash(lang === "fr" ? "Plaque d'immatriculation" : "Placa / Matrícula", b.vehicle_plate)}
        ${lineOrDash(lang === "fr" ? "N° de Protocole" : "Nº Orçamento", b.number)}
      </tr>
      <tr>
        ${lineOrDash(lang === "fr" ? "Adresse / Code Postal / Ville" : "Endereço / CEP / Cidade", clientAddr)}
        ${lineOrDash(lang === "fr" ? "Modèle" : "Modelo", b.vehicle_model)}
        ${lineOrDash(lang === "fr" ? "N° de Châssis" : "Chassis / VIN", b.vehicle_vin)}
        ${lineOrDash(lang === "fr" ? "Date début réparation" : "Data Início / Emissão", b.issued_at ? formatDate(b.issued_at) : "")}
      </tr>
      <tr>
        ${lineOrDash(lang === "fr" ? "N° Tél. · E-mail" : "Tel · E-mail", clientPhone)}
        ${lineOrDash(lang === "fr" ? "Couleur" : "Cor", b.vehicle_color)}
        ${lineOrDash(lang === "fr" ? "Kilométrage" : "Kilometragem", b.vehicle_km)}
        ${lineOrDash(lang === "fr" ? "Date fin réparation" : "Data Término (prev.)", "")}
      </tr>
      <tr>
        ${lineOrDash(lang === "fr" ? "Document (SIREN/SIRET/NIF)" : "Documento Fiscal", b.client_document)}
        ${lineOrDash(lang === "fr" ? "Type d'intervention" : "Tipo de Orçamento", vehicleType)}
        ${lineOrDash(lang === "fr" ? "Année" : "Ano / Modelo", b.vehicle_year)}
        ${lineOrDash(lang === "fr" ? "Seguradora / Oficina" : "Seguradora / Oficina", dossierInfo)}
      </tr>
    </tbody>
  </table>`);

  // 3 — Sinistro / Perícia (abaixo do cliente/veículo, se houver)
  const dossierHasAny =
    notEmpty(b.dossier_claim_number) ||
    notEmpty(b.dossier_expert_number) ||
    notEmpty(b.dossier_insurance_company) ||
    notEmpty(b.dossier_garage_name);
  if (dossierHasAny) {
    sections.push(`<div style="background:#374151;color:white;padding:6px 10px;border:1px solid #374151;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:1px">${lang === "fr" ? "ASSURANCE / EXTENSION DES DOMMAGES" : "SEGURO / PERÍCIA E COMPLEMENTOS"}</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
      <colgroup>
        <col style="width:26%" /><col style="width:26%" /><col style="width:20%" /><col style="width:28%" />
      </colgroup>
      <tbody>
        <tr>
          ${lineOrDash(lang === "fr" ? "Assurance" : "Seguradora", b.dossier_insurance_company)}
          ${lineOrDash(lang === "fr" ? "N° Sinistre" : "Nº Sinistro", b.dossier_claim_number)}
          ${lineOrDash(lang === "fr" ? "N° Expertise" : "Nº Perícia", b.dossier_expert_number)}
          ${lineOrDash(lang === "fr" ? "Atelier responsable" : "Oficina Responsável", b.dossier_garage_name)}
        </tr>
      </tbody>
    </table>`);
  }

  // 4 — Diagnóstico + Descrição Técnica (caixas escuras como modelo)
  if (notEmpty(b.diagnosis) || notEmpty(b.technical_description)) {
    sections.push(`<div style="margin-top:8px;margin-bottom:4px;display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${
        notEmpty(b.diagnosis)
          ? `<div>
            <div style="background:#374151;color:white;padding:5px 10px;border:1px solid #374151;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">${lang === "fr" ? "Diagnostic initial" : "Diagnóstico Inicial"}</div>
            <div style="padding:8px 10px;border:1px solid #c7ccd3;border-top:none;min-height:48px;font-size:12px;line-height:1.45;color:#111827;white-space:pre-wrap;background:white">${esc(String(b.diagnosis || ""))}</div>
          </div>`
          : ""
      }
      ${
        notEmpty(b.technical_description)
          ? `<div>
            <div style="background:#374151;color:white;padding:5px 10px;border:1px solid #374151;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">${lang === "fr" ? "Description technique" : "Descrição Técnica"}</div>
            <div style="padding:8px 10px;border:1px solid #c7ccd3;border-top:none;min-height:48px;font-size:12px;line-height:1.45;color:#111827;white-space:pre-wrap;background:white">${esc(String(b.technical_description || ""))}</div>
          </div>`
          : ""
      }
    </div>`);
  }

  // 5 — Intervenções selecionadas (lista compacta)
  const intervs = getBudgetInterventions(b);
  if (intervs.length > 0) {
    sections.push(`<section style="margin-top:14px">
      <div style="background:#4b5563;color:white;padding:5px 10px;border:1px solid #4b5563;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:1px">${lang === "fr" ? "Type(s) d'intervention sélectionnée(s)" : "Tipo(s) de Intervenção Selecionado(s)"}</div>
      <div style="padding:8px 12px;border:1px solid #c7ccd3;border-top:none;background:#f9fafb">
        <ul style="margin:0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px 8px">
          ${intervs.map((iv) => `<li style="margin:0;padding:2px 8px;background:#111827;color:white;border-radius:2px;font-size:11px;font-weight:600;letter-spacing:0.02em">${esc(String(iv))}</li>`).join("")}
        </ul>
      </div>
    </section>`);
  }

  // 6 — Tabelas: Peças / Materiais + Serviços + Mão de Obra (estilo "Element | T1 | T2 | Peinture | Commentaire" aproximado)
  sections.push(
    buildLinesTable(
      lang === "fr" ? "Pièces / Matériaux" : "Peças / Materiais",
      b.parts || [],
      "description",
      "quantity",
      "unit_price",
      lang === "fr" ? "Qté" : "Qtd",
      lang === "fr" ? "Prix unit." : "Preço Unit.",
      lang === "fr" ? "Sous-total" : "Subtotal",
      lang === "fr" ? "Total Pièces / Matériaux" : "Total Peças / Materiais",
      lang,
    ),
  );
  sections.push(
    buildLinesTable(
      lang === "fr" ? "Services" : "Serviços",
      Array.isArray((b as any).services) ? (b as any).services : [],
      "description",
      "quantity",
      "unit_price",
      lang === "fr" ? "Qté" : "Qtd",
      lang === "fr" ? "Prix unit." : "Preço Unit.",
      lang === "fr" ? "Sous-total" : "Subtotal",
      lang === "fr" ? "Total Services" : "Total Serviços",
      lang,
    ),
  );
  sections.push(buildLaborTable(b.labor || [], lang));

  // 7 — TARIFATION (modelo imagem: 4 colunas Tarif | Options | Degarnissage | PRIX TOTAL)
  const hasAnyFinancial =
    t.parts > 0 || t.services > 0 || t.labor > 0 || t.disc > 0.0001 || t.iva > 0.0001;
  if (hasAnyFinancial) {
    const tariffRows: string[] = [];
    if (t.labor > 0) {
      tariffRows.push(`<li style="font-size:11px;color:#111827;padding:1px 0">${lang === "fr" ? "Main d'œuvre" : "Mão de Obra"}: <strong>${bdFormatBRL(t.labor)}</strong></li>`);
    }
    if (t.parts > 0) {
      tariffRows.push(`<li style="font-size:11px;color:#111827;padding:1px 0">${lang === "fr" ? "Pièces / Matériaux" : "Peças / Materiais"}: <strong>${bdFormatBRL(t.parts)}</strong></li>`);
    }
    if (t.services > 0) {
      tariffRows.push(`<li style="font-size:11px;color:#111827;padding:1px 0">${lang === "fr" ? "Services" : "Serviços"}: <strong>${bdFormatBRL(t.services)}</strong></li>`);
    }
    const discountPct = Math.max(0, Math.min(100, Number(b.discount_pct) || 0));
    const ivaPct = Math.max(0, Math.min(100, Number(b.iva_pct) || 0));

    sections.push(`<section style="margin-top:18px">
      <table style="width:100%;border-collapse:collapse">
        <colgroup>
          <col style="width:28%" /><col style="width:26%" /><col style="width:22%" /><col style="width:24%" />
        </colgroup>
        <thead>
          <tr>
            <th style="${GROUP_HEADER_CELL}">${lang === "fr" ? "TARIFICATION" : "TARIFAS E COMPOSIÇÃO"}</th>
            <th style="${GROUP_HEADER_CELL}">${lang === "fr" ? "OPTIONS SUPPLÉMENTAIRES" : "OPÇÕES E DESCONTOS"}</th>
            <th style="${GROUP_HEADER_CELL}">${lang === "fr" ? "DÉTAILS IVA / IMPÔTS" : "BASE E IVA"}</th>
            <th style="${DARK_HEADER_CELL}">${lang === "fr" ? "PRIX TOTAL" : "PREÇO TOTAL"}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="border:1px solid #c7ccd3;padding:8px 10px;background:#f9fafb;vertical-align:top;font-size:11px">
              <ul style="margin:0;padding-left:14px;line-height:1.5">
                ${tariffRows.length > 0 ? tariffRows.join("") : `<li style="font-size:11px;color:#4b5563">—</li>`}
                <li style="font-size:11px;color:#111827;padding:1px 0">${lang === "fr" ? "Total brut (HT)" : "Total Bruto"}: <strong>${bdFormatBRL(t.gross)}</strong></li>
              </ul>
            </td>
            <td style="border:1px solid #c7ccd3;padding:8px 10px;background:#f9fafb;vertical-align:top;font-size:11px">
              <ul style="margin:0;padding-left:14px;line-height:1.5">
                ${
                  discountPct > 0.0001
                    ? `<li style="font-size:11px;color:#b91c1c;padding:1px 0">${lang === "fr" ? "Remise" : "Desconto"} (${discountPct.toFixed(2)}%): - <strong>${bdFormatBRL(t.disc)}</strong></li>`
                    : `<li style="font-size:11px;color:#4b5563;padding:1px 0">${lang === "fr" ? "Aucune remise" : "Sem desconto aplicado"}</li>`
                }
                <li style="font-size:11px;color:#111827;padding:1px 0">${lang === "fr" ? "Base nette" : "Base Líquida"}: <strong>${bdFormatBRL(t.net)}</strong></li>
              </ul>
            </td>
            <td style="border:1px solid #c7ccd3;padding:8px 10px;background:#f9fafb;vertical-align:top;font-size:11px">
              <ul style="margin:0;padding-left:14px;line-height:1.5">
                ${
                  ivaPct > 0.0001
                    ? `<li style="font-size:11px;color:#047857;padding:1px 0">${lang === "fr" ? "TVA" : "IVA"} (${ivaPct.toFixed(2)}%): + <strong>${bdFormatBRL(t.iva)}</strong></li>`
                    : `<li style="font-size:11px;color:#4b5563;padding:1px 0">${lang === "fr" ? "Sans TVA / 0%" : "Isento / 0%"}</li>`
                }
                <li style="font-size:11px;color:#111827;padding:1px 0">${lang === "fr" ? "Base imposable" : "Base Cálculo"}: <strong>${bdFormatBRL(t.net)}</strong></li>
              </ul>
            </td>
            <td style="border:1px solid #1f2937;background:#111827;color:white;padding:8px 10px;vertical-align:middle">
              <div style="font-size:9px;letter-spacing:0.1em;text-transform:uppercase;opacity:0.8;margin-bottom:4px;text-align:center">${lang === "fr" ? "Valeur finale TTC" : "Valor Final"}</div>
              <div style="font-size:16px;font-weight:800;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:0.02em">${bdFormatBRL(t.total)}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>`);
  }

  // 8 — Assinatura / Aprovação + Rejeição + Assinaturas Expert (rodapé estilo modelo)
  const signatureBlock = b.signature?.signed
    ? (() => {
        const s = b.signature;
        const rows: string[] = [];
        rows.push(`<div style="font-size:10px;color:#065f46;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;margin-bottom:6px">${lang === "fr" ? "✓ Devis approuvé et signé" : "✓ Orçamento Aprovado e Assinado"}</div>`);
        rows.push(`<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#c7ccd3;border:1px solid #c7ccd3;margin-top:4px">
          <div style="background:white;padding:6px 8px"><div style="font-size:9px;color:#525a64;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:2px">${lang === "fr" ? "Signataire" : "Assinante"}</div><div style="font-size:11px;font-weight:600">${esc(s.signerName || "—")}</div></div>
          <div style="background:white;padding:6px 8px"><div style="font-size:9px;color:#525a64;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:2px">${lang === "fr" ? "Type" : "Tipo"}</div><div style="font-size:11px;font-weight:600">${esc(signerTypeLabel(s.signerType, lang))}</div></div>
          <div style="background:white;padding:6px 8px"><div style="font-size:9px;color:#525a64;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:2px">${lang === "fr" ? "Date et heure" : "Data e Hora"}</div><div style="font-size:11px;font-weight:600">${formatDateTime(s.signedAt)}</div></div>
        </div>`);
        rows.push(`<div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:#c7ccd3;border:1px solid #c7ccd3;border-top:none">
          <div style="background:white;padding:6px 8px"><div style="font-size:9px;color:#525a64;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:2px">${lang === "fr" ? "Méthode de confirmation" : "Método de Confirmação"}</div><div style="font-size:11px;font-weight:600">${esc(
            s.confirmationMethod === "DRAWN_SIGNATURE"
              ? lang === "fr"
                ? "Signature dessinée"
                : "Assinatura Desenhada"
              : lang === "fr"
                ? "Confirmation explicite (sans signature)"
                : "Confirmação Explícita (sem assinatura)",
          )}</div></div>
          <div style="background:white;padding:6px 8px"><div style="font-size:9px;color:#525a64;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:2px">${lang === "fr" ? "Valeur TTC approuvée" : "Valor Final Aprovado"}</div><div style="font-size:11px;font-weight:700">${s.finalValueAtMoment != null ? bdFormatBRL(Number(s.finalValueAtMoment)) : bdFormatBRL(t.total)}</div></div>
        </div>`);
        if (s.signatureData) {
          rows.push(`<div style="margin-top:8px;border:1px solid #c7ccd3;padding:8px;background:white;display:inline-block;border-radius:2px">
            <img src="${esc(s.signatureData)}" alt="${lang === "fr" ? "signature" : "assinatura"}" style="height:96px;max-width:340px;object-fit:contain;display:block" />
          </div>`);
        }
        return `<div style="border:1px solid #6ee7b7;background:#ecfdf5;padding:10px 12px;margin-top:18px">${rows.join("")}</div>`;
      })()
    : "";

  const rejectionBlock = b.rejection?.rejected
    ? (() => {
        const r = b.rejection;
        return `<div style="border:1px solid #fca5a5;background:#fef2f2;padding:10px 12px;margin-top:12px">
          <div style="font-size:10px;color:#991b1b;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;margin-bottom:6px">✗ ${lang === "fr" ? "Devis rejeté" : "Orçamento Rejeitado"}</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#fecaca;border:1px solid #fecaca">
            <div style="background:white;padding:6px 8px"><div style="font-size:9px;color:#525a64;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:2px">${lang === "fr" ? "Rejeté par" : "Rejeitado por"}</div><div style="font-size:11px;font-weight:600">${esc(r.rejectedBy || "—")}</div></div>
            <div style="background:white;padding:6px 8px"><div style="font-size:9px;color:#525a64;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:2px">${lang === "fr" ? "Date" : "Data"}</div><div style="font-size:11px;font-weight:600">${formatDateTime(r.rejectedAt)}</div></div>
            <div style="background:white;padding:6px 8px"><div style="font-size:9px;color:#525a64;letter-spacing:0.05em;text-transform:uppercase;margin-bottom:2px">${lang === "fr" ? "Motif" : "Motivo"}</div><div style="font-size:11px;font-weight:600">${esc(r.reason || "—")}</div></div>
          </div>
        </div>`;
      })()
    : "";

  // Assinaturas rodapé (estilo modelo: Client / Expert / Atelier em 3 colunas, vazias para assinar manualmente)
  sections.push(`<div style="margin-top:24px;padding-top:14px;border-top:1px solid #111827">
    <div style="font-size:9px;color:#4b5563;letter-spacing:0.1em;text-transform:uppercase;text-align:center;margin-bottom:10px">${lang === "fr" ? "Signatures (pour accord écrit)" : "Assinaturas para Aceite Escrito"}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:10px">
      <div style="text-align:center">
        <div style="font-size:10px;color:#111827;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:4px">${lang === "fr" ? "Client / Entreprise" : "Cliente / Empresa"}</div>
        <div style="height:56px;border-bottom:1px solid #111827"></div>
        <div style="font-size:9px;color:#4b5563;margin-top:3px">${esc(b.client_name || "")}</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:10px;color:#111827;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:4px">${lang === "fr" ? "Expert / Assurance" : "Perito / Seguradora"}</div>
        <div style="height:56px;border-bottom:1px solid #111827"></div>
        <div style="font-size:9px;color:#4b5563;margin-top:3px">${esc(b.dossier_insurance_company || "")}</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:10px;color:#111827;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:4px">${lang === "fr" ? "Atelier (Responsable)" : "Oficina (Responsável)"}</div>
        <div style="height:56px;border-bottom:1px solid #111827"></div>
        <div style="font-size:9px;color:#4b5563;margin-top:3px">Operix · ${esc(b.dossier_garage_name || "")}</div>
      </div>
    </div>
  </div>`);

  if (signatureBlock) sections.push(signatureBlock);
  if (rejectionBlock) sections.push(rejectionBlock);

  // Rodapé final
  sections.push(`<div style="margin-top:22px;padding-top:10px;border-top:1px dashed #9ca3af;text-align:center;font-size:9px;color:#6b7280;letter-spacing:0.03em">
    ${lang === "fr" ? "Document généré par Operix · Devis valable 15 jours à compter de l'émission · Merci de votre confiance." : "Documento gerado por Operix · Orçamento válido 15 dias a partir da emissão · Obrigado pela confiança."}
    <br/>
    ${new Date().toLocaleString("pt-BR")}
  </div>`);

  const pageStyle = `@page { size: A4; margin: 12mm; }
    @media print {
      body { max-width: 100% !important; padding: 0 !important; }
      section, table { page-break-inside: avoid; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #111827;
      margin: 0;
      padding: 0;
      background: white;
    }
    * { box-sizing: border-box; }
    table { table-layout: fixed; }
    td, th { word-break: break-word; hyphens: auto; }
    ul { margin: 0; }
    .print-actions { display:none; }
    @media screen {
      .print-actions {
        display:block;
        position:sticky;top:0;z-index:50;
        background:#111827;color:white;
        padding:10px 18px;
        display:flex;align-items:center;justify-content:space-between;gap:12px;
        border-bottom:1px solid #0b1220;
      }
      .print-actions button {
        background:white;color:#111827;border:none;border-radius:3px;
        padding:6px 12px;font-weight:700;font-size:12px;cursor:pointer;letter-spacing:0.02em;
      }
      .print-actions .title { font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase }
    }`;

  const printActions = `<div class="print-actions" aria-hidden="false">
    <div class="title">${lang === "fr" ? "Aperçu du devis · " : "Visualização do Orçamento · "} ${esc(b.number || "(rascunho)")}</div>
    <div style="display:flex;gap:8px">
      <button onclick="window.print()">${lang === "fr" ? "Imprimer / Enregistrer en PDF" : "Imprimir / Salvar como PDF"}</button>
      <button onclick="window.close()" style="background:#4b5563;color:white">${lang === "fr" ? "Fermer l'aperçu" : "Fechar Visualização"}</button>
    </div>
  </div>`;

  return `<!doctype html>
<html lang="${lang === "fr" ? "fr" : "pt"}">
<head>
  <meta charset="utf-8" />
  <title>Orçamento ${esc(b.number || "(rascunho)")} — Operix</title>
  <style>${pageStyle}</style>
</head>
<body>
  <div style="max-width:820px;margin:0 auto;padding:14px 18px 32px;background:white">
    ${printActions}
    ${sections.filter(Boolean).join("")}
  </div>
  <script>
    // Prevent body-print-only quirks: only auto-print when no user interaction (blank window)
    (function(){
      try {
        if (window.name === '' && !window.frameElement) {
          var loaded = false;
          var doIt = function() {
            if (loaded) return;
            loaded = true;
          };
          window.addEventListener('load', doIt, { once: true, passive: true });
        }
      } catch (e) {}
    })();
  </script>
</body>
</html>`;
}

function isValidBudgetType(t: any): t is BudgetType {
  if (!t) return false;
  return typeof t === "string" && Object.prototype.hasOwnProperty.call(BUDGET_TYPE_LABELS, t);
}

// Public helpers para UI de actions: abrir visualização, baixar, imprimir

export function openBudgetPreview(b: Budget, lang: "pt" | "fr" = "pt"): void {
  try {
    const html = buildPrintableBudget(b, lang);
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (!w) {
      // fallback: blob
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
      const html = buildPrintableBudget(b, lang);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch {}; }, 10_000);
    } catch {}
  }
}

export function downloadBudgetHtml(b: Budget, lang: "pt" | "fr" = "pt"): void {
  try {
    const html = buildPrintableBudget(b, lang);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeNumber = (b.number || "rascunho").replace(/[^\w\-]/g, "_");
    a.download = `Orcamento_${safeNumber}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch {}; }, 1500);
  } catch {}
}
