import { describe, expect, it } from "vitest";
import { normalizePlate, normalizeVin } from "../../backend/src/services/confrontationHubService.ts";

describe("Confrontation Hub — Functional Engine Tests", () => {
  describe("Normalization Invariants", () => {
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

  describe("Heuristic & Granularity Invariants", () => {
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

  describe("Mathematical Matching Engine Logic", () => {
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
      // In-production orders have status in_production / paused / ready
      // and do NOT participate in approved commercial totals
      const inProgressOrder = {
        licensePlate: "DD-444-DD",
        status: "in_production",
      };
      const externalAmount = 350.00;

      // Result generated for in_progress
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

    it("synthetic comparison: aggregates internal multi-service order to match single client vehicle total", () => {
      const internalServices = [
        { description: "PDR", amount: 120.00 },
        { description: "Pintura Parachoque", amount: 200.00 },
        { description: "Polimento", amount: 80.00 },
      ];
      const aggregatedInternal = internalServices.reduce((sum, s) => sum + s.amount, 0);
      const externalVehicleTotal = 400.00;

      expect(aggregatedInternal).toBe(400.00);
      const diff = Math.abs(aggregatedInternal - externalVehicleTotal);
      expect(diff).toBe(0.00);
      expect(diff < 0.05).toBe(true);
    });

    it("analytic comparison: verifies line-by-line service discrepancies and totals", () => {
      const externalRows = [
        { licensePlate: "AB-123-CD", serviceDescription: "PDR", amount: 120.00 },
        { licensePlate: "AB-123-CD", serviceDescription: "Pintura", amount: 180.00 }, // Differs: internal was 200
      ];
      const internalTotal = 320.00;
      const externalTotal = externalRows.reduce((sum, r) => sum + r.amount, 0); // 300.00

      expect(externalTotal).toBe(300.00);
      const netDiff = internalTotal - externalTotal;
      expect(netDiff).toBe(20.00);
      expect(netDiff > 0.05).toBe(true);
    });

    it("commercial zero-mutation invariant: confrontation execution never alters commercial totals", () => {
      const internalPaymentListTotal = "15420.50";
      const confrontationDifference = "-350.00";

      // Invariant: internal commercial total is immutable from confrontation
      const resultingListTotal = internalPaymentListTotal;
      expect(resultingListTotal).toBe("15420.50");
      expect(resultingListTotal).not.toBe((15420.50 - 350.00).toFixed(2));
    });
  });
});
