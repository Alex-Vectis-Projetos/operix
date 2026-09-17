import { describe, it, expect, vi, beforeEach } from "vitest";
import { weeklogQueryKeys } from "@/hooks/useWeeklogs";
import { finalizeProductionOrder } from "@/lib/apiProductionOrders";
import { mapFinalizeError } from "@/components/production/OrderDetailDialog";
import * as apiModule from "@/lib/api";

describe("Spec 003 — T09 Frontend Contracts Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("T09-CACHE-WORKSPACE-01: Query Key Workspace Isolation", () => {
    it("should partition weeklog list query keys by workspaceId", () => {
      const wsA = "workspace-alpha-111";
      const wsB = "workspace-bravo-222";
      const filters = { status: "open" };

      const keyA = weeklogQueryKeys.list(wsA, filters);
      const keyB = weeklogQueryKeys.list(wsB, filters);

      expect(keyA).not.toEqual(keyB);
      expect(keyA[0]).toBe("weeklogs");
      expect(keyA[1]).toBe(wsA);
      expect(keyB[1]).toBe(wsB);
    });

    it("should partition weeklog detail and entries query keys by workspaceId", () => {
      const wsA = "workspace-alpha-111";
      const wsB = "workspace-bravo-222";
      const weeklogId = "wl-001";

      const detailKeyA = weeklogQueryKeys.detail(wsA, weeklogId);
      const detailKeyB = weeklogQueryKeys.detail(wsB, weeklogId);
      expect(detailKeyA).not.toEqual(detailKeyB);
      expect(detailKeyA[1]).toBe(wsA);
      expect(detailKeyB[1]).toBe(wsB);

      const entriesKeyA = weeklogQueryKeys.entries(wsA, weeklogId);
      const entriesKeyB = weeklogQueryKeys.entries(wsB, weeklogId);
      expect(entriesKeyA).not.toEqual(entriesKeyB);
      expect(entriesKeyA[1]).toBe(wsA);
      expect(entriesKeyB[1]).toBe(wsB);
    });

    it("should fallback to 'none' when workspaceId is missing without colliding with valid workspaces", () => {
      const keyNull = weeklogQueryKeys.list(null);
      const keyUndefined = weeklogQueryKeys.list(undefined);
      const keyValid = weeklogQueryKeys.list("workspace-alpha");

      expect(keyNull[1]).toBe("none");
      expect(keyUndefined[1]).toBe("none");
      expect(keyNull).not.toEqual(keyValid);
    });
  });

  describe("T09-FINALIZE-NO-CLIENT-AUTHORITY-01: Finalize Request Zero Client Authority", () => {
    it("should send POST to /production-orders/:id/finalize with zero body payload", async () => {
      const orderId = "po-target-777";
      const mockResult = {
        productionOrder: { id: orderId, status: "delivered" },
        weeklog: { id: "wl-100", status: "open" },
        weeklogEntry: { id: "wle-100", totalAmount: "150.00" },
        idempotent: false,
      };

      const apiRequestSpy = vi.spyOn(apiModule, "apiRequest").mockResolvedValue(mockResult as any);

      const result = await finalizeProductionOrder(orderId);

      expect(apiRequestSpy).toHaveBeenCalledTimes(1);
      const [path, init] = apiRequestSpy.mock.calls[0];

      expect(path).toBe(`/production-orders/${orderId}/finalize`);
      expect(init?.method).toBe("POST");
      // Must NOT send client-forged workspaceId, deliveredAt, status, or currency in body
      expect(init?.body).toBeUndefined();
      expect(result).toEqual(mockResult);
    });
  });

  describe("T09-ERROR-MAPPING-01: Domain Error Code Translation", () => {
    it("should map OPERATIONAL_SITE_REQUIRED to siteKey error message", () => {
      const err = new apiModule.ApiError("Raw backend message", 422, "OPERATIONAL_SITE_REQUIRED");
      const message = mapFinalizeError(err);
      expect(message).toBe("Local operacional não configurado na ordem (siteKey obrigatório).");
    });

    it("should map CURRENCY_REQUIRED to currencyCode error message", () => {
      const err = new apiModule.ApiError("Raw backend message", 422, "CURRENCY_REQUIRED");
      const message = mapFinalizeError(err);
      expect(message).toBe("Código de moeda não configurado ou inválido (currencyCode obrigatório).");
    });

    it("should map CLIENT_REQUIRED to client error message", () => {
      const err = new apiModule.ApiError("Raw backend message", 422, "CLIENT_REQUIRED");
      const message = mapFinalizeError(err);
      expect(message).toBe("Cliente não vinculado à ordem de produção.");
    });

    it("should map DIRECT_OP_NO_SERVICES to services error message", () => {
      const err = new apiModule.ApiError("Raw backend message", 422, "DIRECT_OP_NO_SERVICES");
      const message = mapFinalizeError(err);
      expect(message).toBe("Ordem direta exige ao menos um serviço estruturado na execução.");
    });

    it("should map DIRECT_OP_SERVICE_TOTAL_MISMATCH to total error message", () => {
      const err = new apiModule.ApiError("Raw backend message", 422, "DIRECT_OP_SERVICE_TOTAL_MISMATCH");
      const message = mapFinalizeError(err);
      expect(message).toBe("Soma dos serviços estruturados difere do valor total da ordem.");
    });

    it("should map UNAPPROVED_BUDGET_REVISION to budget revision error message", () => {
      const err = new apiModule.ApiError("Raw backend message", 422, "UNAPPROVED_BUDGET_REVISION");
      const message = mapFinalizeError(err);
      expect(message).toBe("Apenas ordens com revisão de orçamento aprovada podem ser finalizadas.");
    });

    it("should map CANNOT_FINALIZE_STATUS to status error message", () => {
      const err = new apiModule.ApiError("Raw backend message", 409, "CANNOT_FINALIZE_STATUS");
      const message = mapFinalizeError(err);
      expect(message).toBe("Apenas ordens em produção ou pausadas podem ser finalizadas.");
    });

    it("should map HTTP 403 to permission denied message", () => {
      const err = new apiModule.ApiError("Forbidden", 403);
      const message = mapFinalizeError(err);
      expect(message).toBe("Acesso negado: você não tem permissão para finalizar esta ordem.");
    });

    it("should provide fallback for unknown errors", () => {
      const err = new Error("Network blip");
      const message = mapFinalizeError(err);
      expect(message).toBe("Network blip");
    });
  });
});
