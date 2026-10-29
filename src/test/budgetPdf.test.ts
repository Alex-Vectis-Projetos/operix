import { describe, test, expect } from "vitest";
import { buildPrintableBudget, computeTotalsFor, formatBRL } from "@/lib/budgetPdfUtils";
import type { Budget } from "@/components/production/BudgetDialog";

const sampleBudget = {
  id: "test-budget-001",
  created_at: "2026-08-10T10:00:00.000Z",
  updated_at: "2026-08-12T14:30:00.000Z",
  number: "OS-2026-00-007",
  issued_at: "2026-08-12",
  status: "approved",
  budget_type: "insurance",
  client_id: "client-uuid-123",
  client_display_id: "C-00042",
  client_name: "Jean Dupont",
  client_phone: "+33 6 12 34 56 78",
  client_email: "jean.dupont@example.fr",
  client_document: "FR 123 456 789",
  address_street: "12 Rue de la Paix",
  address_number: "12A",
  address_postal: "75002",
  address_city: "Paris",
  address_country: "França",
  vehicle_brand: "Peugeot",
  vehicle_model: "3008 Allure",
  vehicle_plate: "AB-123-CD",
  vehicle_vin: "VF3309NF812345678",
  vehicle_year: "2022",
  vehicle_color: "Cinza Artense",
  vehicle_km: "42850",
  dossier_garage_name: "Garage Central",
  dossier_insurance_company: "AXA Assurance",
  dossier_claim_number: "SIN-2026-88776",
  dossier_expert_number: "EXP-2026-543",
  diagnosis: "Danos na lateral direita: colisão com poste. Amassados profundos.",
  technical_description:
    "Martelinho de ouro + repintura. Substituição fechos + verificação alinhamento.",
  bodywork: true,
  painting: true,
  mechanics: false,
  electrics: false,
  pdr: true,
  detailing: false,
  inspection: true,
  spare_key: false,
  fuel_level: "Meio tanque",
  observations: "Chave e documentos no porta-luvas.",
  parts: [
    { id: "p1", description: "Fecho porta dianteira direita", quantity: 1, unit_price: 85.0 },
    { id: "p2", description: "Guarnição borracha porta TD", quantity: 1, unit_price: 42.5 },
    { id: "p3", description: "Tinta base cinza Artense (litro)", quantity: 2, unit_price: 120.0 },
    { id: "p4", description: "Verniz PU (500ml)", quantity: 1, unit_price: 65.0 },
    { id: "p5", description: "Massa poliéster", quantity: 1, unit_price: 28.0 },
  ],
  services: [],
  labor: [
    { id: "l1", description: "Martelinho porta dianteira direita", hours: 4.5, hourly_rate: 75.0 },
    { id: "l2", description: "Martelinho porta traseira direita", hours: 3.5, hourly_rate: 75.0 },
    { id: "l3", description: "Desmontagem / montagem das portas", hours: 2.0, hourly_rate: 70.0 },
    { id: "l4", description: "Repintura preparação + camadas + verniz", hours: 6.0, hourly_rate: 85.0 },
    { id: "l5", description: "Polimento final e acabamento", hours: 2.0, hourly_rate: 65.0 },
  ],
  discount_pct: 5,
  iva_pct: 23,
  signature: {
    signed: true,
    signerName: "Jean Dupont",
    signerType: "CLIENT",
    signedAt: "2026-08-12T15:12:00.000Z",
    confirmationMethod: "DRAWN_SIGNATURE",
    finalValueAtMoment: 4960.11,
    signatureData: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAiIGhlaWdodD0iOTAiPjxwYXRoIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzExMTgyNyIgc3Ryb2tlLXdpZHRoPSIzIiBkPSJNMTAsNzAgUzUwLDEwIDEwMCw0MCBTMTUwLDgwIDIwMCwzMCBTMjgwLDIwIDMxMCw1MCIvPjwvc3ZnPg==",
  },
  rejection: null,
} as unknown as Budget;

describe("PDF Orçamento — Gerador Compartilhado", () => {
  test("computeTotalsFor: cálculo idêntico ao original BudgetDialog (parts + services + labor - desc + IVA)", () => {
    const t = computeTotalsFor(sampleBudget);
    const expectedParts = 85 + 42.5 + 2 * 120 + 65 + 28;
    const expectedLabor = 4.5 * 75 + 3.5 * 75 + 2 * 70 + 6 * 85 + 2 * 65;
    const expectedGross = expectedParts + expectedLabor;
    const expectedDisc = expectedGross * 0.05;
    const expectedNet = expectedGross - expectedDisc;
    const expectedIva = expectedNet * 0.23;
    const expectedTotal = expectedNet + expectedIva;
    expect(t.parts).toBeCloseTo(expectedParts, 2);
    expect(t.labor).toBeCloseTo(expectedLabor, 2);
    expect(t.gross).toBeCloseTo(expectedGross, 2);
    expect(t.disc).toBeCloseTo(expectedDisc, 2);
    expect(t.net).toBeCloseTo(expectedNet, 2);
    expect(t.iva).toBeCloseTo(expectedIva, 2);
    expect(t.total).toBeCloseTo(expectedTotal, 2);
    expect(formatBRL(t.total)).toMatch(/\d/);
  });

  test("buildPrintableBudget PT: contém todas as seções obrigatórias do modelo PROTOCOLE", () => {
    const html = buildPrintableBudget(sampleBudget, "pt");
    expect(html.length).toBeGreaterThan(10000);
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain("PROTOCOLO DE REPARAÇÃO");
    expect(html).toContain("@page");
    expect(html).toContain("A4");
    expect(html).toContain("OS-2026-00-007");
    expect(html).toContain("Jean Dupont");
    expect(html).toContain("C-00042");
    expect(html).toContain("Peugeot");
    expect(html).toContain("3008");
    expect(html).toContain("AB-123-CD");
    expect(html).toContain("VF3309NF812345678");
    expect(html).toContain("AXA");
    expect(html).toContain("SIN-2026-88776");
    expect(html).toContain("42850");
    // HTML válido: <tr> da grade contém <td>, não <div> dentro de <tr> direto
    expect(html).toContain("<td style=\"padding:4px 6px;border-right:1px");
    // Colunas da grade 4×3 (título seguro)
    expect(html).toMatch(/SEGURO|SEGUROS|ASSURANCE/);
    // TARIFAS / TOTAIS
    expect(html).toMatch(/TARIF|TOTA|VALOR|PRIX/i);
    // Assinatura cliente base64 SVG
    expect(html).toContain("data:image/svg+xml;base64,");
    expect(html).toContain("Jean Dupont");
    // Rodapé de assinaturas 3 colunas
    expect(html).toMatch(/Cliente|Atelier|Expert|Oficina/);
    // Barra print-actions (Visualização / Imprimir / Fechar)
    expect(html).toContain("print-actions");
    expect(html).toMatch(/Imprimir|Imprimer|Fechar|Fermer/);
  });

  test("buildPrintableBudget FR: labels bilíngues funcionam, dados idênticos", () => {
    const html = buildPrintableBudget(sampleBudget, "fr");
    // Em FR o título também é PROTOCOLE DE RÉPARATION (original FR)
    expect(html).toMatch(/PROTOCOLE DE R/);
    expect(html).toContain("ASSURANCE");
    expect(html).toContain("OS-2026-00-007");
    expect(html).toContain("Jean Dupont");
    // Assinatura base64 está lá
    expect(html).toContain("data:image/svg+xml;base64,");
  });

  test("buildPrintableBudget: orçamento SEM assinatura e SEM peças NÃO quebra", () => {
    const empty: Budget = {
      ...sampleBudget,
      parts: [],
      services: [],
      labor: [],
      signature: null,
      rejection: {
        rejected: true,
        rejectedBy: "Seguradora",
        rejectedAt: "2026-08-14T10:00:00.000Z",
        reason: "Valor acima da média de mercado.",
      } as any,
      discount_pct: 0,
      iva_pct: 0,
    };
    const html = buildPrintableBudget(empty, "pt");
    expect(html.length).toBeGreaterThan(5000);
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain("PROTOCOLO DE REPARAÇÃO");
    // Bloco rejeição aparece
    expect(html).toMatch(/Rejei|rejeta|rejeitado|Rejected/i);
    expect(html).toContain("Valor acima da média");
  });
});
