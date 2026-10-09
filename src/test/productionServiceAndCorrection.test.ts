import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  updateProductionOrderService,
  requestBudgetCorrection,
} from "@/lib/apiProductionOrders";

describe("Phase 1 Manual-QA Fixes: Production Service Completion & Budget Correction", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("A. Service Completion Endpoint", () => {
    it("calls PATCH /api/production-orders/:id/services/:serviceId with completed state", async () => {
      const mockOrder = {
        id: "po-123",
        code: "PO-001",
        performed_services: [
          { id: "svc-1", name: "Débosselage aile avant", completed: true, status: "completed" },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => mockOrder,
      });

      const res = await updateProductionOrderService("po-123", "svc-1", true);
      expect(res).toEqual(mockOrder);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = (global.fetch as any).mock.calls[0];
      expect(calledUrl).toContain("/production-orders/po-123/services/svc-1");
      expect(calledInit.method).toBe("PATCH");
      expect(JSON.parse(calledInit.body)).toEqual({ completed: true });
    });

    it("surfaces backend error when service completion fails", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ message: "Prestation introuvable dans cette commande." }),
      });

      await expect(
        updateProductionOrderService("po-123", "svc-invalid", true)
      ).rejects.toThrow("Prestation introuvable");
    });
  });

  describe("B. Budget Correction Endpoint", () => {
    it("calls POST /api/production-orders/:id/request-budget-correction with reason", async () => {
      const mockResponse = {
        order: { id: "po-123", status: "paused" },
        revision: { id: "rev-2", revisionNumber: 2, status: "draft" },
        notification: { delivered: true, recipient: "responsible@example.com" },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => mockResponse,
      });

      const res = await requestBudgetCorrection("po-123", "Discrepancy found in panel alignment");
      expect(res).toEqual(mockResponse);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [calledUrl, calledInit] = (global.fetch as any).mock.calls[0];
      expect(calledUrl).toContain("/production-orders/po-123/request-budget-correction");
      expect(calledInit.method).toBe("POST");
      expect(JSON.parse(calledInit.body)).toEqual({
        reason: "Discrepancy found in panel alignment",
      });
    });

    it("handles notification delivery status safely without failing transaction", async () => {
      const mockResponse = {
        order: { id: "po-123", status: "paused" },
        revision: { id: "rev-2", revisionNumber: 2, status: "draft" },
        notification: {
          delivered: false,
          recipient: null,
          error: "CONFIGURATION_ERROR: Resend API key or recipient not configured.",
        },
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => mockResponse,
      });

      const res = await requestBudgetCorrection("po-123", "Demande de correction atelier");
      expect(res.order.status).toBe("paused");
      expect(res.revision.status).toBe("draft");
      expect(res.notification.delivered).toBe(false);
      expect(res.notification.error).toContain("CONFIGURATION_ERROR");
    });
  });

  describe("C. Role & Permission Invariants", () => {
    it("rejects forbidden actions with 403 when client attempts operational change", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          message: "CLIENT_ACCESS_DENIED: Clientes não possuem permissão para marcar conclusão de serviços.",
        }),
      });

      await expect(
        updateProductionOrderService("po-123", "svc-1", true)
      ).rejects.toThrow("CLIENT_ACCESS_DENIED");
    });

    it("rejects forbidden actions with 403 when client attempts budget correction", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({
          message: "CLIENT_ACCESS_DENIED: Clientes não possuem permissão para solicitar correção em ordens operacionais.",
        }),
      });

      await expect(
        requestBudgetCorrection("po-123", "Unauthorized request")
      ).rejects.toThrow("CLIENT_ACCESS_DENIED");
    });
  });
});
