import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import * as apiModule from "@/lib/api";
import {
  cancelDistribution,
  cancelObligation,
  createDistribution,
  createExpense,
  createObligation,
  generateIdempotencyKey,
  getDistribution,
  getExpense,
  getFinanceSummary,
  getObligation,
  listDistributions,
  listExpenses,
  listObligations,
  prepareCommand,
  reverseExpense,
  reverseObligationPayment,
  settleObligation,
  type CreateDistributionInput,
  type CreateExpenseInput,
  type CreateObligationInput,
  type ReverseExpenseInput,
  type ReverseObligationPaymentInput,
} from "@/lib/apiFinanceV2";
import {
  financeQueryKeys,
  invalidateDistributionDetail,
  invalidateDistributionList,
  invalidateExpenseDetail,
  invalidateExpenseList,
  invalidateFinanceSummary,
  invalidateObligationDetail,
  invalidateObligationList,
} from "@/hooks/useFinance";

describe("Spec 005 — T10 typed canonical Finance v2 client and hook contracts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("T10-FIN-QUERY-KEY-01: strictly partitions all finance query keys by active workspace", () => {
    const wsA = "workspace-alpha";
    const wsB = "workspace-bravo";

    expect(financeQueryKeys.all(wsA)).toEqual(["finance", "workspace-alpha"]);
    expect(financeQueryKeys.summary(wsA)).toEqual(["finance", "workspace-alpha", "summary"]);
    expect(financeQueryKeys.expenseList(wsA)).toEqual(["finance", "workspace-alpha", "expenses", "list"]);
    expect(financeQueryKeys.expenseDetail(wsA, "exp-1")).toEqual(["finance", "workspace-alpha", "expenses", "detail", "exp-1"]);
    expect(financeQueryKeys.distributionList(wsA)).toEqual(["finance", "workspace-alpha", "distributions", "list"]);
    expect(financeQueryKeys.distributionDetail(wsA, "dist-1")).toEqual(["finance", "workspace-alpha", "distributions", "detail", "dist-1"]);
    expect(financeQueryKeys.obligationList(wsA)).toEqual(["finance", "workspace-alpha", "obligations", "list"]);
    expect(financeQueryKeys.obligationDetail(wsA, "obl-1")).toEqual(["finance", "workspace-alpha", "obligations", "detail", "obl-1"]);

    // Workspace switching produces completely disjoint keys
    expect(financeQueryKeys.summary(wsA)).not.toEqual(financeQueryKeys.summary(wsB));
    expect(financeQueryKeys.expenseList(wsA)).not.toEqual(financeQueryKeys.expenseList(wsB));
    expect(financeQueryKeys.distributionList(wsA)).not.toEqual(financeQueryKeys.distributionList(wsB));
    expect(financeQueryKeys.obligationList(wsA)).not.toEqual(financeQueryKeys.obligationList(wsB));
  });

  it("T10-FIN-ROUTES-01: uses exact canonical endpoints and HTTP methods for all finance v2 operations", async () => {
    const request = vi.spyOn(apiModule, "apiRequest").mockResolvedValue({} as never);

    await getFinanceSummary();
    await listExpenses();
    await getExpense("exp-1");
    await createExpense({ amount: "100.00", currencyCode: "EUR", category: "tools", occurredOn: "2026-03-01" }, "idem-1");
    await reverseExpense("exp-1", { reason: "duplicate" }, "idem-2");
    await listDistributions();
    await getDistribution("dist-1");
    await createDistribution(
      {
        paymentListId: "a0000000-0000-0000-0000-000000000001",
        participant: { kind: "person", personId: "b0000000-0000-0000-0000-000000000001" },
        allocation: { mode: "fixed", amount: "50.00" },
      },
      "idem-3"
    );
    await cancelDistribution("dist-1", { reason: "cancelled by admin" }, "idem-4");
    await listObligations();
    await getObligation("obl-1");
    await createObligation({ distributionId: "dist-1" }, "idem-5");
    await cancelObligation("obl-1", { reason: "mistake" }, "idem-6");
    await settleObligation("obl-1", "idem-7");
    await reverseObligationPayment("obl-1", "pmt-1", { reason: "bank bounce" }, "idem-8");

    const calls = request.mock.calls;
    expect(calls.map(([path]) => path)).toEqual([
      "/finance/v2/summary",
      "/finance/v2/expenses",
      "/finance/v2/expenses/exp-1",
      "/finance/v2/expenses",
      "/finance/v2/expenses/exp-1/reverse",
      "/finance/v2/distributions",
      "/finance/v2/distributions/dist-1",
      "/finance/v2/distributions",
      "/finance/v2/distributions/dist-1/cancel",
      "/finance/v2/obligations",
      "/finance/v2/obligations/obl-1",
      "/finance/v2/obligations",
      "/finance/v2/obligations/obl-1/cancel",
      "/finance/v2/obligations/obl-1/settle",
      "/finance/v2/obligations/obl-1/settlements/pmt-1/reverse",
    ]);

    expect(calls[0]?.[1]?.method).toBeUndefined(); // GET
    expect(calls[1]?.[1]?.method).toBeUndefined(); // GET
    expect(calls[2]?.[1]?.method).toBeUndefined(); // GET
    expect(calls[3]?.[1]?.method).toBe("POST");
    expect(calls[4]?.[1]?.method).toBe("POST");
    expect(calls[5]?.[1]?.method).toBeUndefined(); // GET
    expect(calls[6]?.[1]?.method).toBeUndefined(); // GET
    expect(calls[7]?.[1]?.method).toBe("POST");
    expect(calls[8]?.[1]?.method).toBe("POST");
    expect(calls[9]?.[1]?.method).toBeUndefined(); // GET
    expect(calls[10]?.[1]?.method).toBeUndefined(); // GET
    expect(calls[11]?.[1]?.method).toBe("POST");
    expect(calls[12]?.[1]?.method).toBe("POST");
    expect(calls[13]?.[1]?.method).toBe("POST");
    expect(calls[14]?.[1]?.method).toBe("POST");
  });

  it("T10-FIN-NO-LEGACY-01: new client and hook modules contain zero legacy routes or Supabase authority", () => {
    const clientCode = readFileSync(resolve(process.cwd(), "src/lib/apiFinanceV2.ts"), "utf8");
    const hookCode = readFileSync(resolve(process.cwd(), "src/hooks/useFinance.ts"), "utf8");

    for (const code of [clientCode, hookCode]) {
      expect(code).not.toMatch(/\/financial-records/);
      expect(code).not.toMatch(/\/finance\/summary(?!\/v2)/);
      expect(code).not.toMatch(/\/finance\/reconciliations/);
      expect(code).not.toMatch(/\/payment-orders/);
      expect(code).not.toMatch(/@\/integrations\/supabase\/client/);
      expect(code).not.toMatch(/ProfitRule/);
      expect(code).not.toMatch(/ServiceOrderDistribution/);
    }
  });

  it("T10-FIN-MONEY-TRANSPORT-01: preserves exact Decimal strings in request payloads without float conversion", async () => {
    const request = vi.spyOn(apiModule, "apiRequest").mockResolvedValue({} as never);

    const expenseInput: CreateExpenseInput = {
      amount: "0.10",
      currencyCode: "EUR",
      category: "consumables",
      occurredOn: "2026-03-10",
    };
    await createExpense(expenseInput, "key-01");

    const [, init1] = request.mock.calls[0] ?? [];
    expect(init1?.body).toBe(JSON.stringify(expenseInput));
    expect(JSON.parse(init1?.body as string).amount).toBe("0.10");

    const distributionInputFixed: CreateDistributionInput = {
      paymentListId: "a0000000-0000-0000-0000-000000000001",
      participant: { kind: "person", personId: "b0000000-0000-0000-0000-000000000001" },
      allocation: { mode: "fixed", amount: "5000.30" },
    };
    await createDistribution(distributionInputFixed, "key-02");

    const [, init2] = request.mock.calls[1] ?? [];
    expect(JSON.parse(init2?.body as string).allocation.amount).toBe("5000.30");

    const distributionInputPct: CreateDistributionInput = {
      paymentListId: "a0000000-0000-0000-0000-000000000001",
      participant: { kind: "workspace", workspaceId: "c0000000-0000-0000-0000-000000000001" },
      allocation: { mode: "percentage", percentage: "33.33" },
    };
    await createDistribution(distributionInputPct, "key-03");

    const [, init3] = request.mock.calls[2] ?? [];
    expect(JSON.parse(init3?.body as string).allocation.percentage).toBe("33.33");
  });

  it("T10-FIN-IDEMPOTENCY-HEADER-01: sends exact Idempotency-Key header on all state mutations", async () => {
    const request = vi.spyOn(apiModule, "apiRequest").mockResolvedValue({} as never);

    await createExpense({ amount: "10.00", currencyCode: "BRL", category: "fuel", occurredOn: "2026-03-01" }, "idem-exp-create");
    await reverseExpense("exp-1", { reason: "wrong amount" }, "idem-exp-reverse");
    await createDistribution({ paymentListId: "a0000000-0000-0000-0000-000000000001", participant: { kind: "person", personId: "b0000000-0000-0000-0000-000000000001" }, allocation: { mode: "fixed", amount: "10.00" } }, "idem-dist-create");
    await cancelDistribution("dist-1", { reason: "reallocated" }, "idem-dist-cancel");
    await createObligation({ distributionId: "dist-1" }, "idem-obl-create");
    await cancelObligation("obl-1", { reason: "cancelled" }, "idem-obl-cancel");
    await settleObligation("obl-1", "idem-obl-settle");
    await reverseObligationPayment("obl-1", "pmt-1", { reason: "reversed" }, "idem-obl-revpay");

    const expectedKeys = [
      "idem-exp-create",
      "idem-exp-reverse",
      "idem-dist-create",
      "idem-dist-cancel",
      "idem-obl-create",
      "idem-obl-cancel",
      "idem-obl-settle",
      "idem-obl-revpay",
    ];

    expect(request.mock.calls.length).toBe(expectedKeys.length);
    request.mock.calls.forEach((call, index) => {
      const headers = new Headers(call[1]?.headers);
      expect(headers.get("Idempotency-Key")).toBe(expectedKeys[index]);
    });
  });

  it("T10-FIN-IDEMPOTENCY-RETRY-01: command envelope guarantees identical key across logical retries", async () => {
    const request = vi.spyOn(apiModule, "apiRequest").mockResolvedValue({} as never);

    const command = prepareCommand<CreateExpenseInput>({
      amount: "250.00",
      currencyCode: "EUR",
      category: "maintenance",
      occurredOn: "2026-03-05",
    });

    expect(typeof command.idempotencyKey).toBe("string");
    expect(command.idempotencyKey.length).toBeGreaterThan(10);

    // First attempt
    await createExpense(command.input, command.idempotencyKey);
    // Simulated retry with same command envelope
    await createExpense(command.input, command.idempotencyKey);

    expect(request.mock.calls.length).toBe(2);
    const headers1 = new Headers(request.mock.calls[0]?.[1]?.headers);
    const headers2 = new Headers(request.mock.calls[1]?.[1]?.headers);

    expect(headers1.get("Idempotency-Key")).toBe(command.idempotencyKey);
    expect(headers2.get("Idempotency-Key")).toBe(command.idempotencyKey);
    expect(request.mock.calls[0]?.[1]?.body).toBe(request.mock.calls[1]?.[1]?.body);

    // Fresh command gets a distinct key
    const freshCommand = prepareCommand(command.input);
    expect(freshCommand.idempotencyKey).not.toBe(command.idempotencyKey);
  });

  it("T10-FIN-NO-WORKSPACE-AUTHORITY-01: client never sends workspaceId in query params or as tenant authority", async () => {
    const request = vi.spyOn(apiModule, "apiRequest").mockResolvedValue({} as never);

    await getFinanceSummary();
    await listExpenses();
    await listDistributions();
    await listObligations();

    request.mock.calls.forEach(([path, init]) => {
      expect(path).not.toMatch(/workspaceId=/i);
      expect(path).not.toMatch(/workspace_id=/i);
      if (init?.body && typeof init.body === "string") {
        const parsed = JSON.parse(init.body);
        expect(parsed.workspaceId).toBeUndefined();
      }
    });
  });

  it("T10-FIN-CURRENCY-SEPARATION-01: preserves separate currency records without cross-currency reduction", async () => {
    const mockSummary = {
      currencies: [
        {
          currencyCode: "EUR",
          expected: "1000.00",
          received: "800.00",
          expenses: "200.00",
          settledObligationPayments: "100.00",
          available: "500.00",
        },
        {
          currencyCode: "USD",
          expected: "500.00",
          received: "400.00",
          expenses: "50.00",
          settledObligationPayments: "0.00",
          available: "350.00",
        },
      ],
    };

    vi.spyOn(apiModule, "apiRequest").mockResolvedValue(mockSummary);

    const summary = await getFinanceSummary();
    expect(summary.currencies.length).toBe(2);
    expect(summary.currencies[0]?.currencyCode).toBe("EUR");
    expect(summary.currencies[0]?.available).toBe("500.00");
    expect(summary.currencies[1]?.currencyCode).toBe("USD");
    expect(summary.currencies[1]?.available).toBe("350.00");
  });

  it("T10-FIN-ERROR-PRESERVATION-01: strictly propagates 401, 403, 404, 409, 422 errors without fallback", async () => {
    const errorCodes = [
      { status: 401, code: "UNAUTHORIZED", message: "Token inválido" },
      { status: 403, code: "FINANCE_FORBIDDEN", message: "Acesso negado" },
      { status: 404, code: "EXPENSE_NOT_FOUND", message: "Despesa não encontrada" },
      { status: 409, code: "IDEMPOTENCY_KEY_REUSED", message: "Conflito de chave" },
      { status: 422, code: "FINANCE_VALIDATION_INVALID", message: "Valor inválido" },
    ];

    for (const err of errorCodes) {
      const apiErr = new ApiError(err.message, err.status, err.code);
      vi.spyOn(apiModule, "apiRequest").mockRejectedValue(apiErr);

      await expect(getFinanceSummary()).rejects.toBe(apiErr);
      await expect(listExpenses()).rejects.toBe(apiErr);
      await expect(getExpense("exp-x")).rejects.toBe(apiErr);
      await expect(createExpense({ amount: "1", currencyCode: "EUR", category: "c", occurredOn: "2026-01-01" }, "k")).rejects.toBe(apiErr);
      await expect(listDistributions()).rejects.toBe(apiErr);
      await expect(listObligations()).rejects.toBe(apiErr);
    }
  });

  it("T10-FIN-CACHE-INVALIDATION-01: executes targeted workspace invalidations on successful mutations", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries };
    const ws = "workspace-alpha";

    // Summary invalidation
    await invalidateFinanceSummary(queryClient, ws);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: financeQueryKeys.summary(ws) });

    // Expense invalidation
    await invalidateExpenseList(queryClient, ws);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: financeQueryKeys.expenseList(ws) });

    await invalidateExpenseDetail(queryClient, ws, "exp-1");
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: financeQueryKeys.expenseDetail(ws, "exp-1") });

    // Distribution invalidation
    await invalidateDistributionList(queryClient, ws);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: financeQueryKeys.distributionList(ws) });

    await invalidateDistributionDetail(queryClient, ws, "dist-1");
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: financeQueryKeys.distributionDetail(ws, "dist-1") });

    // Obligation invalidation
    await invalidateObligationList(queryClient, ws);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: financeQueryKeys.obligationList(ws) });

    await invalidateObligationDetail(queryClient, ws, "obl-1");
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: financeQueryKeys.obligationDetail(ws, "obl-1") });
  });

  it("T10-FIN-TECHNICIAN-CONTRACT-01: allows independent query execution for technician own scope", async () => {
    const summaryError = new ApiError("Acesso negado", 403, "FINANCE_FORBIDDEN");
    const distributionsData = { items: [{ id: "dist-tech-1", status: "active" as const }] };
    const obligationsData = { items: [{ id: "obl-tech-1", status: "pending" as const }] };

    vi.spyOn(apiModule, "apiRequest").mockImplementation(async (path) => {
      if (path === "/finance/v2/summary") throw summaryError;
      if (path === "/finance/v2/distributions") return distributionsData as never;
      if (path === "/finance/v2/obligations") return obligationsData as never;
      throw new Error(`Unexpected path: ${path}`);
    });

    // Summary query rejects
    await expect(getFinanceSummary()).rejects.toBe(summaryError);

    // Distribution & Obligation queries resolve successfully
    const distResult = await listDistributions();
    expect(distResult.items.length).toBe(1);
    expect(distResult.items[0]?.id).toBe("dist-tech-1");

    const oblResult = await listObligations();
    expect(oblResult.items.length).toBe(1);
    expect(oblResult.items[0]?.id).toBe("obl-tech-1");
  });
});
