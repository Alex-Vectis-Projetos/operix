import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import * as apiModule from "@/lib/api";
import { getPaymentListImportPreview } from "@/lib/apiPaymentLists";
import { allowedConfrontationDecisions, isGlobalCommercialTotal } from "@/components/payment-lists/paymentListUi";

const workspaceFile = () => readFileSync(resolve(process.cwd(), "src/components/payment-lists/PaymentListWorkspace.tsx"), "utf8");
const importFile = () => readFileSync(resolve(process.cwd(), "src/components/payment-lists/PaymentListImportDialog.tsx"), "utf8");
const detailFile = () => readFileSync(resolve(process.cwd(), "src/components/payment-lists/PaymentListDetail.tsx"), "utf8");

describe("Spec 004 — T11 canonical PaymentList workspace contracts", () => {
  it("T11-INDEX-CANONICAL-01: the retained route uses the canonical List query, not PaymentOrder data", () => {
    const source = workspaceFile();
    expect(source).toContain("usePaymentLists");
    expect(source).not.toContain("usePaymentOrders");
    expect(source).not.toContain("useReconciliation");
  });

  it("T11-PREVIEW-GOVERNED-01: document previews use the authenticated tenant-scoped storage contract", async () => {
    const request = vi.spyOn(apiModule, "apiRequest").mockResolvedValue({ url: "https://signed.example", expiresInSeconds: 300 } as never);
    await getPaymentListImportPreview("tenants/workspace-alpha/lists/imports/import-1/original.pdf");
    expect(request).toHaveBeenCalledWith("/storage/presigned-download", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ bucket: "uploads", path: "tenants/workspace-alpha/lists/imports/import-1/original.pdf" }),
    }));
  });

  it("T11-IMPORT-TWO-PHASE-01: upload and explicit materialisation remain separate", () => {
    const source = importFile();
    expect(source).toContain("onImportReady((await create.mutateAsync(file)).importId)");
    expect(source).toContain("commit.mutateAsync({ importId: imported.id })");
    expect(source).toContain("Efetivar Lista");
    expect(source).toContain("Salvar revisão");
  });

  it("T11-IMPORT-NO-SILENT-DISCARD-01: closing preserves staged work and discard is an explicit confirmed action", () => {
    const source = importFile();
    expect(source).toContain("onClick={onClose}");
    expect(source).toContain("Descartar esta importação?");
    expect(source).not.toContain(".finally(onClose)");
  });

  it("T11-DECISION-MATRIX-01: the client exposes only server-legal decision paths", () => {
    expect(allowedConfrontationDecisions({ status: "exact_match", paymentListItemId: "item-1", weeklogEntryId: "weeklog-1" })).toEqual([]);
    expect(allowedConfrontationDecisions({ status: "ambiguous_match", paymentListItemId: "item-1", weeklogEntryId: null })).toEqual(["contest", "reject_item"]);
    expect(allowedConfrontationDecisions({ status: "unmatched_weeklog", paymentListItemId: null, weeklogEntryId: "weeklog-1" })).toEqual(["request_rectification"]);
  });

  it("T11-DECISION-RESULT-ID-01: the selected evidence and decision target are separated", () => {
    const source = detailFile();
    expect(source).toContain("const [decisionResult, setDecisionResult]");
    expect(source).toContain("resultId: decisionResult.id");
    expect(source).toContain("setDecisionResult(selected)");
  });

  it("T11-CONFRONT-DETACHED-OPEN-NEW-ROUND-01: detached evidence, open disputes and a new round stay explicit", () => {
    const source = detailFile();
    expect(source).toContain("Execução não localizada");
    expect(source).toContain("Disputa/decisão:");
    expect(source).toContain('execute("new_round")');
    expect(source).toContain("A rodada anterior permanecerá preservada como histórico");
  });

  it("T11-TECHNICIAN-SANITIZATION-01: absent global commercial totals never render as zero", () => {
    expect(isGlobalCommercialTotal("120.00")).toBe(true);
    expect(isGlobalCommercialTotal(null)).toBe(false);
    expect(isGlobalCommercialTotal(undefined)).toBe(false);
    expect(workspaceFile()).toContain('isGlobalCommercialTotal(list.recognizedTotal) ?');
  });

  it("T11-NO-LEGACY-WRITES-01: the canonical UI has no direct Supabase or deprecated finance mutation path", () => {
    const source = [workspaceFile(), importFile(), detailFile()].join("\n");
    expect(source).not.toMatch(/integrations\/supabase|useReconciliation|partialPayment|markPaymentOrderPaid|payment-orders\//);
  });

  it("T11-CONFIDENCE-NO-AUTO-COMMIT-01: extraction confidence is only review guidance", () => {
    const source = importFile();
    expect(source).toContain("confiança baixa");
    expect(source).toContain("revisão humana ainda é obrigatória");
    expect(source).not.toContain("fieldConfidence.*commit");
  });
});
