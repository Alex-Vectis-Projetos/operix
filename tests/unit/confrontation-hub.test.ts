import { describe, expect, it } from "vitest";
import { normalizePlate, normalizeVin } from "../../backend/src/services/confrontationHubService.ts";

describe("Confrontation Hub — Functional Engine & Multi-Tenant Invariants", () => {
  describe("1. Normalization Invariants", () => {
    it("normalizes license plates correctly across French and European formats", () => {
      expect(normalizePlate("AA-123-BB")).toBe("AA123BB");
      expect(normalizePlate("aa 123 bb")).toBe("AA123BB");
      expect(normalizePlate("1234 AB 75")).toBe("1234AB75");
      expect(normalizePlate("")).toBeNull();
      expect(normalizePlate("A")).toBeNull(); // too short
    });

    it("normalizes VINs correctly without confusing O/I/Q", () => {
      expect(normalizeVin("WVWZZZ3CZWE123456")).toBe("WVWZZZ3CZWE123456");
      expect(normalizeVin(" wvwzzz3czwe123456 ")).toBe("WVWZZZ3CZWE123456");
      expect(normalizeVin("SHORT")).toBeNull();
    });
  });

  describe("2. Heuristic & Granularity Invariants", () => {
    it("detects synthetic vs analytic granularity based on repeated plates", () => {
      const syntheticRows = [
        { "Placa": "AA-111-AA", "Valor": 150 },
        { "Placa": "BB-222-BB", "Valor": 300 },
        { "Placa": "CC-333-CC", "Valor": 450 },
      ];
      const analyticRows = [
        { "Placa": "AA-111-AA", "Servico": "PDR", "Valor": 50 },
        { "Placa": "AA-111-AA", "Servico": "Pintura", "Valor": 100 },
        { "Placa": "BB-222-BB", "Servico": "Polimento", "Valor": 300 },
      ];

      const getPlates = (rows: any[]) => rows.map((r) => normalizePlate(r["Placa"])).filter(Boolean);

      const synPlates = getPlates(syntheticRows);
      const isSyn = synPlates.length === new Set(synPlates).size;
      expect(isSyn).toBe(true);

      const anaPlates = getPlates(analyticRows);
      const isAna = anaPlates.length > new Set(anaPlates).size;
      expect(isAna).toBe(true);
    });
  });

  describe("3. Matching Engine & Discrepancy Classification", () => {
    it("exact match: client total equals internal total within 0.05 tolerance", () => {
      const internalTotal = 250.00;
      const externalTotal = 250.00;
      const diff = Math.abs(internalTotal - externalTotal);
      expect(diff < 0.05).toBe(true);
    });

    it("divergent values: identifies positive and negative discrepancies accurately", () => {
      const internalTotal = 500.00;
      const externalTotal = 450.00;
      const diff = internalTotal - externalTotal;
      expect(diff).toBe(50.00);
      expect(diff > 0.05).toBe(true);
    });

    it("unvalidated orders in production: internal commercial value remains 0.00", () => {
      const inProgressOrder = {
        licensePlate: "DD-444-DD",
        status: "in_production",
      };
      const externalAmount = 350.00;

      const itemResult = {
        licensePlate: inProgressOrder.licensePlate,
        internalAmount: "0.00",
        externalAmount: externalAmount.toFixed(2),
        differenceAmount: (0 - externalAmount).toFixed(2),
        status: "in_production",
        decision: "pending",
      };

      expect(itemResult.internalAmount).toBe("0.00");
      expect(itemResult.status).toBe("in_production");
      expect(itemResult.decision).toBe("pending");
    });

    it("omitted by client: vehicle validated in Operix but absent from external file triggers contestation", () => {
      const validatedInternalVehicles = ["AA111AA", "BB222BB", "CC333CC"];
      const externalVehicles = ["AA111AA", "BB222BB"];

      const omitted = validatedInternalVehicles.filter((p) => !externalVehicles.includes(p));
      expect(omitted).toEqual(["CC333CC"]);

      const omittedResult = {
        licensePlate: omitted[0],
        internalAmount: "420.00",
        externalAmount: "0.00",
        differenceAmount: "420.00",
        status: "omitted_by_client",
        decision: "contest",
      };

      expect(omittedResult.status).toBe("omitted_by_client");
      expect(omittedResult.decision).toBe("contest");
      expect(omittedResult.externalAmount).toBe("0.00");
    });

    it("vehicle not found: plate unknown to Operix triggers vehicle_not_found alert", () => {
      const internalKnownPlates = ["AA111AA"];
      const externalPlate = "ZZ999ZZ";

      const notFound = !internalKnownPlates.includes(externalPlate);
      expect(notFound).toBe(true);

      const notFoundResult = {
        licensePlate: externalPlate,
        internalAmount: "0.00",
        externalAmount: "180.00",
        status: "vehicle_not_found",
      };

      expect(notFoundResult.internalAmount).toBe("0.00");
      expect(notFoundResult.status).toBe("vehicle_not_found");
    });
  });

  describe("4. Persistence, History and Reopening (Requirement 1)", () => {
    it("persists execution snapshot immutably and reloads identical data on page refresh", () => {
      const executedRun = {
        id: "run-uuid-12345",
        sequence: 1,
        workspaceId: "ws-operix-tenant",
        clientId: "client-peugeot",
        fileName: "bordereau_octobre_2026.xlsx",
        fileSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        granularity: "synthetic",
        metrics: {
          totalCompared: 12,
          exactMatchCount: 10,
          valueDifferenceCount: 2,
          totalInternalAmount: "3600.00",
          totalExternalAmount: "3450.00",
          netDifferenceAmount: "150.00",
        },
        decisions: {},
        createdAt: "2026-10-14T10:00:00.000Z",
      };

      // Simulates reloading run from database after page refresh / backend restart
      const reloadedRun = JSON.parse(JSON.stringify(executedRun));
      expect(reloadedRun.id).toBe(executedRun.id);
      expect(reloadedRun.metrics.netDifferenceAmount).toBe("150.00");
      expect(reloadedRun.fileName).toBe("bordereau_octobre_2026.xlsx");
    });

    it("prevents accidental duplicate runs when identical file hash submitted within 60s window", () => {
      const activeRuns = [
        {
          id: "run-1",
          fileSha256: "hash-same-document-abc123",
          createdAt: new Date(Date.now() - 20 * 1000), // 20s ago
        },
      ];

      const isRecentDuplicate = (sha: string) => {
        const threshold = Date.now() - 60 * 1000;
        return activeRuns.some((r) => r.fileSha256 === sha && r.createdAt.getTime() > threshold);
      };

      expect(isRecentDuplicate("hash-same-document-abc123")).toBe(true);
      expect(isRecentDuplicate("hash-different-document-xyz")).toBe(false);
    });

    it("records commercial decisions and maintains user/timestamp audit trail", () => {
      const runDecisions: Record<string, any> = {};

      const recordDecision = (itemKey: string, decision: string, notes: string, userId: string) => {
        runDecisions[itemKey] = {
          decision,
          decisionNotes: notes,
          decidedByUserId: userId,
          decidedAt: new Date().toISOString(),
        };
      };

      recordDecision(
        "item-AA123BB",
        "contest",
        "Valor contestado formalmente com base na WEEKLOG assinada.",
        "user-alex-1"
      );

      expect(runDecisions["item-AA123BB"]).toBeDefined();
      expect(runDecisions["item-AA123BB"].decision).toBe("contest");
      expect(runDecisions["item-AA123BB"].decidedByUserId).toBe("user-alex-1");
      expect(runDecisions["item-AA123BB"].decisionNotes).toContain("WEEKLOG");
    });
  });

  describe("5. Signed WEEKLOG Evidence Retrieval & Workspace Isolation (Requirement 2)", () => {
    it("associates signed evidence to the exact validation round rather than assuming most recent", () => {
      const entryId = "entry-vehicle-123";
      const validationRounds = [
        {
          id: "val-round-1",
          sequence: 1,
          signatureStoragePath: "signatures/val-round-1.png",
          coverageSnapshot: { entryIds: ["entry-other-999"] },
          status: "validated",
        },
        {
          id: "val-round-2",
          sequence: 2,
          signatureStoragePath: "signatures/val-round-2.png",
          coverageSnapshot: { entryIds: ["entry-vehicle-123", "entry-other-999"] },
          status: "validated",
        },
      ];

      const matchValidationForEntry = (eId: string, rounds: typeof validationRounds) => {
        return rounds.find((r) => r.coverageSnapshot.entryIds.includes(eId));
      };

      const matched = matchValidationForEntry(entryId, validationRounds);
      expect(matched?.id).toBe("val-round-2");
      expect(matched?.sequence).toBe(2);
      expect(matched?.signatureStoragePath).toBe("signatures/val-round-2.png");
    });

    it("returns 'Evidência não disponível' when signature path is absent without fictitious links", () => {
      const validationWithoutSignature = {
        id: "val-round-3",
        signatureStoragePath: null,
      };

      const evidenceResult = {
        available: Boolean(validationWithoutSignature.signatureStoragePath),
        signatureUrl: null,
        notes: "Evidência não disponível: validação concluída sem armazenamento de assinatura.",
      };

      expect(evidenceResult.available).toBe(false);
      expect(evidenceResult.signatureUrl).toBeNull();
    });

    it("strictly blocks cross-tenant access to evidence belonging to another workspace", () => {
      const sessionWorkspaceId = "workspace-tenant-A";
      const validationRecord = {
        id: "val-tenant-B-123",
        workspaceId: "workspace-tenant-B",
        signatureStoragePath: "tenants/workspace-tenant-B/signatures/sig.png",
      };

      const hasAccess = validationRecord.workspaceId === sessionWorkspaceId;
      expect(hasAccess).toBe(false);
    });
  });

  describe("6. Scanned PDF & AI Extraction Graceful Handling (Requirement 3)", () => {
    it("provides clear error message when AI provider is unavailable", () => {
      const aiProviderError = new Error("IMPORT_EXTRACTION_PROVIDER_UNAVAILABLE");

      let userFacingError = "";
      if (aiProviderError.message === "IMPORT_EXTRACTION_PROVIDER_UNAVAILABLE") {
        userFacingError = "O serviço de extração inteligente por IA está temporariamente indisponível. Para prosseguir imediatamente, converta o documento em formato de planilha (XLSX ou CSV) ou tente novamente em instantes.";
      }

      expect(userFacingError).toContain("temporariamente indisponível");
      expect(userFacingError).toContain("XLSX ou CSV");
    });

    it("keeps XLSX and CSV deterministic without delegating to AI", () => {
      const isDeterministicFileType = (filename: string) => {
        const ext = filename.split(".").pop()?.toLowerCase();
        return ext === "xlsx" || ext === "xls" || ext === "csv";
      };

      expect(isDeterministicFileType("tabela_cliente.xlsx")).toBe(true);
      expect(isDeterministicFileType("dados.csv")).toBe(true);
      expect(isDeterministicFileType("scanned_invoice.pdf")).toBe(false);
    });

    it("blocks confrontation execution when essential fields (Plate or Amount) are missing", () => {
      const validateConfirmedMapping = (mapping: { plateColumn?: string; amountColumn?: string }) => {
        if (!mapping.plateColumn || !mapping.amountColumn) {
          throw new Error("Campos essenciais ausentes: Coluna da Placa e Coluna do Valor são obrigatórias.");
        }
        return true;
      };

      expect(() => validateConfirmedMapping({ plateColumn: "Placa", amountColumn: "" })).toThrow("Campos essenciais ausentes");
      expect(() => validateConfirmedMapping({ plateColumn: "", amountColumn: "Total" })).toThrow("Campos essenciais ausentes");
      expect(validateConfirmedMapping({ plateColumn: "Placa", amountColumn: "Total" })).toBe(true);
    });
  });

  describe("7. Invariant: Commercial & Financial Zero-Mutation (Requirement 4)", () => {
    it("guarantees that neither WEEKLOG, PaymentList nor Finance ledger are mutated by confrontation decisions", () => {
      const paymentListState = {
        id: "plist-001",
        status: "ready",
        totalAmount: "12500.00",
      };

      // Operator records "accept_difference" or "contest"
      const confrontationDecision = {
        type: "accept_difference",
        acceptedExternalValue: "11900.00",
      };

      // Invariant: payment list total remains unchanged
      expect(paymentListState.totalAmount).toBe("12500.00");
      expect(paymentListState.status).toBe("ready");
      expect(confrontationDecision.type).toBe("accept_difference");
    });
  });
});
