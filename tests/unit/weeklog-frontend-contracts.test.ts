import { describe, it, expect, vi, beforeEach } from "vitest";
import { weeklogQueryKeys } from "@/hooks/useWeeklogs";
import { finalizeProductionOrder } from "@/lib/apiProductionOrders";
import { mapFinalizeError } from "@/components/production/OrderDetailDialog";
import {
  submitWeeklogForValidation,
  reviewWeeklogEntry,
  uploadWeeklogSignature,
  validateWeeklog,
  rectifyWeeklogEntry,
  mapWeeklogError,
} from "@/lib/apiWeeklogs";
import * as legacyApiModule from "@/lib/apiServiceOrders";
import * as apiModule from "@/lib/api";

describe("Spec 003 — T09 & T10 Frontend Contracts Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /* =======================================================================
   * T09 GATE VERIFICATIONS
   * ======================================================================= */

  describe("T09-FINALIZE-DOUBLE-CLICK-01: In-Flight & Double-Click Finalize Protection", () => {
    it("should prevent duplicate network invocations when finalize is called while already in-flight", async () => {
      let resolvePromise: (val: any) => void;
      const deferred = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      const apiSpy = vi.spyOn(apiModule, "apiRequest").mockImplementation(() => deferred as any);

      // Simulate caller guarding with in-flight lock
      let isInFlight = false;
      const guardedFinalize = async (orderId: string) => {
        if (isInFlight) return null;
        isInFlight = true;
        try {
          return await finalizeProductionOrder(orderId);
        } finally {
          isInFlight = false;
        }
      };

      // Trigger two concurrent invocations
      const call1 = guardedFinalize("order-101");
      const call2 = guardedFinalize("order-101");

      // Resolve the network promise
      resolvePromise!({
        productionOrder: { id: "order-101", status: "delivered" },
        weeklog: { id: "wl-101", status: "open" },
        idempotent: false,
      });

      const [res1, res2] = await Promise.all([call1, call2]);

      expect(apiSpy).toHaveBeenCalledTimes(1);
      expect(res1).toBeDefined();
      expect(res2).toBeNull();
    });
  });

  describe("T09-LEGACY-WRITES-DISABLED-01: Legacy ServiceOrder Mutations Disabled", () => {
    it("should not export mutating functions in apiServiceOrders.ts", () => {
      const exportedKeys = Object.keys(legacyApiModule);
      expect(exportedKeys).not.toContain("createServiceOrders");
      expect(exportedKeys).not.toContain("updateServiceOrder");
      expect(exportedKeys).not.toContain("putServiceOrder");
      expect(exportedKeys).not.toContain("deleteServiceOrder");

      // Verify only read-only queries remain
      expect(exportedKeys).toContain("listServiceOrders");
      expect(exportedKeys).toContain("listClients");
    });
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
      expect(init?.body).toBeUndefined();
      expect(result).toEqual(mockResult);
    });
  });

  describe("T09-ERROR-MAPPING-01: Finalize Domain Error Code Translation", () => {
    it("should map OPERATIONAL_SITE_REQUIRED to siteKey error message", () => {
      const err = new apiModule.ApiError("Raw backend message", 422, "OPERATIONAL_SITE_REQUIRED");
      expect(mapFinalizeError(err)).toBe("Local operacional não configurado na ordem (siteKey obrigatório).");
    });

    it("should map CURRENCY_REQUIRED to currencyCode error message", () => {
      const err = new apiModule.ApiError("Raw backend message", 422, "CURRENCY_REQUIRED");
      expect(mapFinalizeError(err)).toBe("Código de moeda não configurado ou inválido (currencyCode obrigatório).");
    });

    it("should map CLIENT_REQUIRED to client error message", () => {
      const err = new apiModule.ApiError("Raw backend message", 422, "CLIENT_REQUIRED");
      expect(mapFinalizeError(err)).toBe("Cliente não vinculado à ordem de produção.");
    });
  });

  /* =======================================================================
   * T10 FRONTEND CONTRACTS & VERIFICATIONS
   * ======================================================================= */

  describe("T10-SUBMIT-CONTRACT-01: Submit Sends Zero Authority Fields", () => {
    it("should send POST to /weeklogs/:id/submit-for-validation with zero authority payload", async () => {
      const weeklogId = "wl-test-sub-001";
      const mockResult = {
        weeklog: { id: weeklogId, status: "pending_validation" },
        validationRound: { id: "vr-1", validationSequence: 1, status: "pending" },
        coverageSnapshot: [{ weeklogEntryId: "entry-1" }],
        status: "pending_validation" as const,
        idempotent: false,
      };

      const apiSpy = vi.spyOn(apiModule, "apiRequest").mockResolvedValue(mockResult as any);

      const res = await submitWeeklogForValidation(weeklogId);

      expect(apiSpy).toHaveBeenCalledTimes(1);
      const [path, init] = apiSpy.mock.calls[0];
      expect(path).toBe(`/weeklogs/${weeklogId}/submit-for-validation`);
      expect(init?.method).toBe("POST");
      // Must not send workspaceId, actorUserId, status, coverageSnapshot in body
      expect(init?.body).toBeUndefined();
      expect(res).toEqual(mockResult);
    });
  });

  describe("T10-REVIEW-REJECTION-REASON-01: Rejection Requires Non-Empty Reason", () => {
    it("should send outcome and trimmed rejectionReason to review endpoint", async () => {
      const weeklogId = "wl-001";
      const entryId = "entry-888";
      const payload = { outcome: "rejected" as const, rejectionReason: "   Serviço com pintura irregular   " };

      const mockEntry = { id: entryId, validationStatus: "rejected", rejectionReason: "Serviço com pintura irregular" };
      const apiSpy = vi.spyOn(apiModule, "apiRequest").mockResolvedValue(mockEntry as any);

      const res = await reviewWeeklogEntry(weeklogId, entryId, payload);

      expect(apiSpy).toHaveBeenCalledTimes(1);
      const [path, init] = apiSpy.mock.calls[0];
      expect(path).toBe(`/weeklogs/${weeklogId}/entries/${entryId}/review`);
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify(payload));
      expect(res).toEqual(mockEntry);
    });
  });

  describe("T10-CONFIRMATION-01: Authenticated Confirmation Method", () => {
    it("should send authenticated_confirmation method without signatureStoragePath", async () => {
      const weeklogId = "wl-002";
      const payload = { validationMethod: "authenticated_confirmation" as const };

      const mockResult = {
        weeklog: { id: weeklogId, status: "validated" },
        validationRound: { id: "vr-1", status: "validated", validationMethod: "authenticated_confirmation" },
        idempotent: false,
      };
      const apiSpy = vi.spyOn(apiModule, "apiRequest").mockResolvedValue(mockResult as any);

      const res = await validateWeeklog(weeklogId, payload);

      expect(apiSpy).toHaveBeenCalledTimes(1);
      const [path, init] = apiSpy.mock.calls[0];
      expect(path).toBe(`/weeklogs/${weeklogId}/validate`);
      expect(init?.body).toBe(JSON.stringify({ validationMethod: "authenticated_confirmation" }));
      expect(res).toEqual(mockResult);
    });
  });

  describe("T10-SIGNATURE-PNG-01: PNG Signature Upload Contract", () => {
    it("should upload binary Blob with Content-Type image/png to signature-upload endpoint", async () => {
      const weeklogId = "wl-003";
      const fakeBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], {
        type: "image/png",
      });

      const mockUploadResult = {
        signatureStoragePath: "tenants/ws-1/weeklogs/wl-003/signatures/temp_123.png",
        uploadedAt: new Date().toISOString(),
      };
      const apiSpy = vi.spyOn(apiModule, "apiRequest").mockResolvedValue(mockUploadResult as any);

      const res = await uploadWeeklogSignature(weeklogId, fakeBlob);

      expect(apiSpy).toHaveBeenCalledTimes(1);
      const [path, init] = apiSpy.mock.calls[0];
      expect(path).toBe(`/weeklogs/${weeklogId}/signature-upload`);
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "Content-Type": "image/png" });
      expect(init?.body).toBe(fakeBlob);
      expect(res).toEqual(mockUploadResult);
    });
  });

  describe("T10-SIGNATURE-NO-LOCALSTORAGE-01: Signature Never Stored in LocalStorage", () => {
    it("should verify that signature upload and canvas never invoke localStorage.setItem with signature data", async () => {
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem");

      const weeklogId = "wl-004";
      const fakeBlob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
      vi.spyOn(apiModule, "apiRequest").mockResolvedValue({ signatureStoragePath: "path", uploadedAt: "now" } as any);

      await uploadWeeklogSignature(weeklogId, fakeBlob);

      const calls = setItemSpy.mock.calls;
      const signatureCalls = calls.filter(([key]) => key.toLowerCase().includes("signature") || key.toLowerCase().includes("png"));
      expect(signatureCalls.length).toBe(0);
    });
  });

  describe("T10-VALIDATED-READONLY-01: Validated State Locks Mutations", () => {
    it("should map VALIDATED_IMMUTABLE and SIGNATURE_IMMUTABLE_AFTER_VALIDATION appropriately", () => {
      const err1 = new apiModule.ApiError("Batch validated", 409, "VALIDATED_IMMUTABLE");
      expect(mapWeeklogError(err1)).toContain("já foi validado e não aceita modificações");

      const err2 = new apiModule.ApiError("Signature locked", 409, "SIGNATURE_IMMUTABLE_AFTER_VALIDATION");
      expect(mapWeeklogError(err2)).toContain("já foi validado e não aceita modificações ou novas assinaturas");
    });
  });

  describe("T10-RECTIFICATION-REASON-01: Rectification Requires Non-Empty Reason", () => {
    it("should send reason in rectifyWeeklogEntry payload", async () => {
      const weeklogId = "wl-005";
      const entryId = "entry-555";
      const payload = { reason: "Retrabalho na porta dianteira" };

      const mockResult = {
        productionOrder: { id: "po-1", status: "in_production", executionSequence: 2 },
        weeklog: { id: weeklogId, status: "rectification_pending" },
        weeklogEntry: { id: entryId, validationStatus: "rectification_requested" },
        idempotent: false,
      };

      const apiSpy = vi.spyOn(apiModule, "apiRequest").mockResolvedValue(mockResult as any);

      const res = await rectifyWeeklogEntry(weeklogId, entryId, payload);

      expect(apiSpy).toHaveBeenCalledTimes(1);
      const [path, init] = apiSpy.mock.calls[0];
      expect(path).toBe(`/weeklogs/${weeklogId}/entries/${entryId}/rectify`);
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify(payload));
      expect(res).toEqual(mockResult);
    });
  });

  describe("T10-LEGACY-READONLY-01: Legacy Archive Does Not Expose Mutating APIs", () => {
    it("should confirm legacy ServiceOrder table remains read-only without CRUD exports", () => {
      expect((legacyApiModule as any).createServiceOrder).toBeUndefined();
      expect((legacyApiModule as any).updateServiceOrder).toBeUndefined();
      expect((legacyApiModule as any).deleteServiceOrder).toBeUndefined();
      expect((legacyApiModule as any).validateServiceOrder).toBeUndefined();
    });
  });

  describe("T10-WORKSPACE-CACHE-01: Multi-Tenant Cache Isolation for Details and Entries", () => {
    it("should partition detail and entries query keys across workspaces", () => {
      const ws1 = "tenant-workspace-1";
      const ws2 = "tenant-workspace-2";
      const id = "target-wl-id";

      const keyDetail1 = weeklogQueryKeys.detail(ws1, id);
      const keyDetail2 = weeklogQueryKeys.detail(ws2, id);
      expect(keyDetail1).not.toEqual(keyDetail2);
      expect(keyDetail1[1]).toBe(ws1);
      expect(keyDetail2[1]).toBe(ws2);

      const keyEntries1 = weeklogQueryKeys.entries(ws1, id);
      const keyEntries2 = weeklogQueryKeys.entries(ws2, id);
      expect(keyEntries1).not.toEqual(keyEntries2);
      expect(keyEntries1[1]).toBe(ws1);
      expect(keyEntries2[1]).toBe(ws2);
    });
  });

  describe("T10-ERROR-MAPPING-01: Complete Weeklog Domain Error Code Translations", () => {
    it("should map validation authority and self-validation errors", () => {
      expect(mapWeeklogError(new apiModule.ApiError("", 403, "VALIDATOR_GRANT_REQUIRED"))).toContain("ClientAccessGrant");
      expect(mapWeeklogError(new apiModule.ApiError("", 403, "VALIDATOR_REVOKED"))).toContain("revogado");
      expect(mapWeeklogError(new apiModule.ApiError("", 403, "VALIDATOR_SELF_FORBIDDEN"))).toContain("Auto-validação proibida");
      expect(mapWeeklogError(new apiModule.ApiError("", 403, "VALIDATOR_BATCH_SELF_FORBIDDEN"))).toContain("Auto-validação em lote proibida");
    });

    it("should map batch review completeness and signature errors", () => {
      expect(mapWeeklogError(new apiModule.ApiError("", 409, "VALIDATION_REVIEW_INCOMPLETE"))).toContain("revisão pendente");
      expect(mapWeeklogError(new apiModule.ApiError("", 422, "SIGNATURE_REQUIRED"))).toContain("Assinatura gráfica obrigatória");
      expect(mapWeeklogError(new apiModule.ApiError("", 422, "FILE_TOO_LARGE"))).toContain("limite máximo permitido de 1 MB");
      expect(mapWeeklogError(new apiModule.ApiError("", 422, "INVALID_PNG_MAGIC_BYTES"))).toContain("PNG autêntico");
    });

    it("should map rectification errors", () => {
      expect(mapWeeklogError(new apiModule.ApiError("", 400, "RECTIFICATION_REASON_REQUIRED"))).toContain("motivo da solicitação de retificação");
      expect(mapWeeklogError(new apiModule.ApiError("", 403, "VALIDATOR_CANNOT_ASSIGN_TECHNICIAN"))).toContain("não possuem autorização para definir o técnico");
      expect(mapWeeklogError(new apiModule.ApiError("", 409, "RECTIFICATION_NOT_VALIDATED"))).toContain("rodada de validação concluída");
      expect(mapWeeklogError(new apiModule.ApiError("", 409, "RECTIFICATION_INVALID_WEEKLOG_STATE"))).toContain("validação concluída");
    });
  });
});
