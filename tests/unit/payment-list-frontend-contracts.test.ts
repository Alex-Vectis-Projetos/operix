import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import * as apiModule from "@/lib/api";
import {
  commitPaymentListImport,
  confrontPaymentList,
  createPaymentList,
  createPaymentListImport,
  decideConfrontationResult,
  getPaymentList,
  listPaymentLists,
  transitionPaymentListStatus,
} from "@/lib/apiPaymentLists";
import {
  invalidatePaymentListDetail,
  invalidatePaymentListImportCommit,
  paymentListQueryKeys,
} from "@/hooks/usePaymentLists";

describe("Spec 004 — T10 frontend canonical PaymentList contracts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("T10-PAYMENT-LIST-QUERY-KEY-01: partitions PaymentList caches by workspace", () => {
    const first = paymentListQueryKeys.list("workspace-alpha");
    const second = paymentListQueryKeys.list("workspace-bravo");

    expect(first).not.toEqual(second);
    expect(first[0]).toBe("payment-lists");
    expect(first[1]).toBe("workspace-alpha");
    expect(second[1]).toBe("workspace-bravo");
  });

  it("T10-PAYMENT-LIST-ROUTES-01: uses only canonical list routes and methods", async () => {
    const request = vi.spyOn(apiModule, "apiRequest").mockResolvedValue({} as never);

    await listPaymentLists();
    await getPaymentList("list-1");
    await createPaymentList({ clientId: "client-1", currencyCode: "EUR", entryIds: ["entry-1"] });
    await transitionPaymentListStatus("list-1", { toStatus: "under_review" });

    const calls = request.mock.calls;
    expect(calls.map(([path]) => path)).toEqual([
      "/payment-lists",
      "/payment-lists/list-1",
      "/payment-lists",
      "/payment-lists/list-1/status",
    ]);
    expect(calls[0]?.[1]?.method).toBeUndefined();
    expect(calls[2]?.[1]?.method).toBe("POST");
    expect(calls[3]?.[1]?.method).toBe("PATCH");
  });

  it("T10-CONFRONT-RESULT-ID-01: addresses a decision by confrontation result ID", async () => {
    const request = vi.spyOn(apiModule, "apiRequest").mockResolvedValue({} as never);

    await decideConfrontationResult("list-1", "result-9", { decision: "contest", notes: "Documento divergente" });

    expect(request).toHaveBeenCalledWith(
      "/payment-lists/list-1/confrontation/result-9/decision",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("T10-CONFRONT-MODE-01: forwards only the canonical current/new_round modes", async () => {
    const request = vi.spyOn(apiModule, "apiRequest").mockResolvedValue({} as never);

    await confrontPaymentList("list-1", { mode: "new_round" });

    expect(request).toHaveBeenCalledWith(
      "/payment-lists/list-1/confront",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ mode: "new_round" }) }),
    );
  });

  it("T10-IMPORT-CONTRACT-01: sends the original document as multipart FormData", async () => {
    const request = vi.spyOn(apiModule, "apiRequest").mockResolvedValue({} as never);
    const file = new File(["payment-list"], "recognized-list.pdf", { type: "application/pdf" });

    await createPaymentListImport(file);

    const [path, init] = request.mock.calls[0] ?? [];
    expect(path).toBe("/payment-lists/imports");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get("file")).toBe(file);
    expect(new Headers(init?.headers).has("Content-Type")).toBe(false);
  });

  it("T10-NO-LEGACY-WRITE-01: canonical client never targets deprecated payment-order mutations", async () => {
    const client = readFileSync(resolve(process.cwd(), "src/lib/apiPaymentLists.ts"), "utf8");

    expect(client).not.toMatch(/\/payment-orders/);
    expect(client).not.toMatch(/(?:payPaymentListItem|updatePaymentOrder|setAmountPaid|partialPayment|markPaymentOrderPaid)/);
  });

  it("T10-NO-SUPABASE-PO-WRITE-01: PaymentOrdersTable is compatibility read-only", () => {
    const table = readFileSync(resolve(process.cwd(), "src/components/payment-orders/PaymentOrdersTable.tsx"), "utf8");

    expect(table).not.toMatch(/@\/integrations\/supabase\/client/);
    expect(table).not.toMatch(/(?:insert|update|delete)\s*\(/);
    expect(table).not.toMatch(/payment_orders/);
  });

  it("T10-ERROR-CODE-01: preserves ApiError codes at the client boundary", async () => {
    const failure = new ApiError("Ação não permitida", 409, "LIST_CONFRONTATION_REQUIRED");
    vi.spyOn(apiModule, "apiRequest").mockRejectedValue(failure);

    await expect(getPaymentList("list-1")).rejects.toBe(failure);
    expect(failure.code).toBe("LIST_CONFRONTATION_REQUIRED");
    expect(failure.status).toBe(409);
  });

  it("T10-CACHE-INVALIDATION-01: narrows mutation invalidation to the active workspace and list", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries };

    await invalidatePaymentListDetail(queryClient, "workspace-alpha", "list-1");
    await invalidatePaymentListImportCommit(queryClient, "workspace-alpha", "import-1", "list-1");

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: paymentListQueryKeys.detail("workspace-alpha", "list-1") });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: paymentListQueryKeys.list("workspace-alpha") });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: paymentListQueryKeys.import("workspace-alpha", "import-1") });
    expect(invalidateQueries).not.toHaveBeenCalledWith();
  });

  it("T10-IMPORT-COMMIT-ROUTE-01: materialises a reviewed import only through the governed endpoint", async () => {
    const request = vi.spyOn(apiModule, "apiRequest").mockResolvedValue({} as never);

    await commitPaymentListImport("import-1");

    expect(request).toHaveBeenCalledWith(
      "/payment-lists/imports/import-1/commit",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
