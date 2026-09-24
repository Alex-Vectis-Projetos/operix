import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import FinancialPage from "@/pages/FinancialPage";
import { FinanceSummaryCards } from "@/components/finance/FinanceSummaryCards";
import { ExpensesTab } from "@/components/finance/ExpensesTab";
import { DistributionsTab } from "@/components/finance/DistributionsTab";
import { ObligationsTab } from "@/components/finance/ObligationsTab";
import * as apiModule from "@/lib/api";
import * as workspaceHooks from "@/hooks/useWorkspace";
import * as roleHooks from "@/hooks/useRole";
import * as authHooks from "@/hooks/useAuth";
import * as paymentListHooks from "@/hooks/usePaymentLists";
import * as peopleHooks from "@/hooks/usePeople";
import * as serviceOrderHooks from "@/hooks/useServiceOrders";
import { formatFinanceMoney } from "@/lib/financeFormatters";

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{ui}</BrowserRouter>
    </QueryClientProvider>
  );
}

describe("Spec 005 — T11 Canonical Finance UI Contracts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();

    // Default authenticated user & workspace
    vi.spyOn(authHooks, "useAuth").mockReturnValue({
      user: { id: "user-owner", email: "owner@example.com" } as any,
      session: {} as any,
      loading: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      changePassword: vi.fn(),
    });

    vi.spyOn(workspaceHooks, "useWorkspace").mockReturnValue({
      workspaceId: "ws-alpha",
      workspaceName: "Workspace Alpha",
      ownerAppUserId: "user-owner",
      availableWorkspaces: [],
      members: [],
      memberAuthIds: [],
      myRole: "admin",
      isAdmin: true,
      isLoading: false,
      switchWorkspace: vi.fn(),
    });

    vi.spyOn(roleHooks, "useRole").mockReturnValue({
      dbRole: "admin",
      role: "admin",
      isAdmin: true,
      isOwner: true,
      isLoading: false,
    });

    vi.spyOn(paymentListHooks, "usePaymentLists").mockReturnValue({
      data: [
        {
          id: "list-1",
          workspaceId: "ws-alpha",
          currencyCode: "EUR",
          totalGrossAmount: "1000.00",
          status: "closed",
          referenceMonth: "2026-03",
        } as any,
      ],
      isLoading: false,
    } as any);

    vi.spyOn(paymentListHooks, "usePaymentList").mockReturnValue({
      data: {
        id: "list-1",
        workspaceId: "ws-alpha",
        currencyCode: "EUR",
        items: [],
      } as any,
      isLoading: false,
    } as any);

    vi.spyOn(peopleHooks, "usePeople").mockReturnValue({
      people: [
        { id: "person-1", full_name: "Carlos Técnico", email: "carlos@example.com" } as any,
      ],
      isLoading: false,
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    });

    vi.spyOn(serviceOrderHooks, "useClients").mockReturnValue({
      data: [{ id: "client-1", company_name: "Cliente Beta" } as any],
      isLoading: false,
    } as any);
  });

  /* -------------------------------------------------------------------------- */
  /* 1. OVERVIEW / SUMMARY: Per-currency, negative available, no grand total   */
  /* -------------------------------------------------------------------------- */
  it("T11-OVERVIEW-01: renders separate currency buckets and displays negative available without clamping or grand total", async () => {
    vi.spyOn(apiModule, "apiRequest").mockImplementation(async (path: string) => {
      if (path === "/finance/v2/summary") {
        return {
          currencies: [
            {
              currencyCode: "EUR",
              expected: "5000.00",
              received: "3000.00",
              expenses: "500.00",
              settledObligationPayments: "1000.00",
              available: "1500.00",
            },
            {
              currencyCode: "USD",
              expected: "2000.00",
              received: "800.00",
              expenses: "1200.00",
              settledObligationPayments: "0.00",
              available: "-400.00", // Negative available
            },
          ],
        } as any;
      }
      return { items: [] } as any;
    });

    renderWithProviders(<FinanceSummaryCards />);

    await waitFor(() => {
      expect(screen.getByTestId("summary-currency-EUR")).toBeInTheDocument();
      expect(screen.getByTestId("summary-currency-USD")).toBeInTheDocument();
    });

    // EUR assertions
    expect(screen.getByTestId("summary-EUR-expected").textContent).toMatch(/5.?000,00/);
    expect(screen.getByTestId("summary-EUR-received").textContent).toMatch(/3.?000,00/);
    expect(screen.getByTestId("summary-EUR-available").textContent).toMatch(/1.?500,00/);

    // USD assertions (negative available is NOT clamped to 0)
    expect(screen.getByTestId("summary-USD-expected").textContent).toMatch(/2.?000,00/);
    expect(screen.getByTestId("summary-USD-available").textContent).toMatch(/-400,00/);

    // No cross-currency grand total (e.g. 1500 + (-400) = 1100 is forbidden)
    expect(screen.queryByText(/Total Geral/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/1.?100,00/)).not.toBeInTheDocument();
  });

  /* -------------------------------------------------------------------------- */
  /* 2. AUTHORIZATION VISIBILITY: Technician Own Scope                         */
  /* -------------------------------------------------------------------------- */
  it("T11-AUTH-TECH-01: linked technician sees only own scope, without summary or expenses queries", async () => {
    vi.spyOn(workspaceHooks, "useWorkspace").mockReturnValue({
      workspaceId: "ws-company",
      workspaceName: "Empresa Grande",
      ownerAppUserId: "user-boss",
      availableWorkspaces: [],
      members: [],
      memberAuthIds: [],
      myRole: "tecnico",
      isAdmin: false,
      isLoading: false,
      switchWorkspace: vi.fn(),
    });

    vi.spyOn(roleHooks, "useRole").mockReturnValue({
      dbRole: "technician",
      role: "tecnico",
      isAdmin: false,
      isOwner: false,
      isLoading: false,
    });

    const apiSpy = vi.spyOn(apiModule, "apiRequest").mockImplementation(async (path: string) => {
      if (path === "/finance/v2/distributions") {
        return {
          items: [
            {
              id: "dist-tech-1",
              paymentListId: "list-1",
              paymentListItemId: null,
              participant: { kind: "person", personId: "person-1" },
              allocation: { mode: "fixed", amount: "250.00" },
              resolvedAmount: "250.00",
              currencyCode: "EUR",
              status: "active",
            },
          ],
        } as any;
      }
      if (path === "/finance/v2/obligations") {
        return {
          items: [
            {
              id: "ob-tech-1",
              distributionId: "dist-tech-1",
              amount: "250.00",
              currencyCode: "EUR",
              status: "pending",
              createdAt: "2026-03-22T10:00:00Z",
              payment: null,
            },
          ],
        } as any;
      }
      return { items: [] } as any;
    });

    renderWithProviders(<FinancialPage />);

    // Technician own-scope container is rendered
    expect(screen.getByTestId("finance-technician-scope")).toBeInTheDocument();
    expect(screen.getByText("Meus Repasses & Pagamentos")).toBeInTheDocument();

    // Summary and Expenses tabs are NOT present
    expect(screen.queryByTestId("tab-finance-overview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-finance-expenses")).not.toBeInTheDocument();

    // Summary or Expenses APIs are NEVER called
    const calledPaths = apiSpy.mock.calls.map(([path]) => path);
    expect(calledPaths).not.toContain("/finance/v2/summary");
    expect(calledPaths).not.toContain("/finance/v2/expenses");

    // Mutation controls (New Distribution / New Obligation) are NOT rendered
    expect(screen.queryByTestId("btn-new-distribution")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-new-obligation")).not.toBeInTheDocument();
  });

  /* -------------------------------------------------------------------------- */
  /* 3. AUTHORIZATION: Personal Workspace Owner (Technician Identity)          */
  /* -------------------------------------------------------------------------- */
  it("T11-AUTH-PERSONAL-OWNER-01: technician-identity owner in personal workspace receives full admin Finance UI", () => {
    vi.spyOn(authHooks, "useAuth").mockReturnValue({
      user: { id: "user-tech-owner", email: "tech@example.com" } as any,
      session: {} as any,
      loading: false,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      changePassword: vi.fn(),
    });

    vi.spyOn(workspaceHooks, "useWorkspace").mockReturnValue({
      workspaceId: "ws-personal",
      workspaceName: "Personal Workspace",
      ownerAppUserId: "user-tech-owner",
      availableWorkspaces: [],
      members: [],
      memberAuthIds: [],
      myRole: "admin",
      isAdmin: true,
      isLoading: false,
      switchWorkspace: vi.fn(),
    });

    vi.spyOn(roleHooks, "useRole").mockReturnValue({
      dbRole: "technician", // Global platform role is technician
      role: "tecnico",
      isAdmin: false,
      isOwner: true, // But is personal workspace owner
      isLoading: false,
    });

    vi.spyOn(apiModule, "apiRequest").mockResolvedValue({ items: [], currencies: [] } as any);

    renderWithProviders(<FinancialPage />);

    // Full admin Finance page is rendered
    expect(screen.getByTestId("canonical-finance-page")).toBeInTheDocument();
    expect(screen.getByTestId("tab-finance-overview")).toBeInTheDocument();
    expect(screen.getByTestId("tab-finance-expenses")).toBeInTheDocument();
    expect(screen.getByTestId("tab-finance-distributions")).toBeInTheDocument();
    expect(screen.getByTestId("tab-finance-obligations")).toBeInTheDocument();
  });

  /* -------------------------------------------------------------------------- */
  /* 4. AUTHORIZATION: Client Access Denied                                    */
  /* -------------------------------------------------------------------------- */
  it("T11-AUTH-CLIENT-01: client receives access denied message and zero data is not faked", () => {
    vi.spyOn(workspaceHooks, "useWorkspace").mockReturnValue({
      workspaceId: "ws-company",
      workspaceName: "Empresa",
      ownerAppUserId: "user-boss",
      availableWorkspaces: [],
      members: [],
      memberAuthIds: [],
      myRole: "cliente",
      isAdmin: false,
      isLoading: false,
      switchWorkspace: vi.fn(),
    });

    vi.spyOn(roleHooks, "useRole").mockReturnValue({
      dbRole: "client",
      role: "cliente",
      isAdmin: false,
      isOwner: false,
      isLoading: false,
    });

    renderWithProviders(<FinancialPage />);

    expect(screen.getByTestId("finance-client-denied")).toBeInTheDocument();
    expect(screen.getByText("Acesso Restrito")).toBeInTheDocument();
    expect(screen.queryByTestId("canonical-finance-page")).not.toBeInTheDocument();
  });

  /* -------------------------------------------------------------------------- */
  /* 5. EXPENSES: String amount preserved, creation & reversal contracts       */
  /* -------------------------------------------------------------------------- */
  it("T11-EXPENSES-01: preserves decimal string amount during creation and enforces reversal with reason", async () => {
    const apiSpy = vi.spyOn(apiModule, "apiRequest").mockImplementation(async (path: string, options?: any) => {
      if (path === "/finance/v2/expenses" && (!options || options.method === undefined)) {
        return {
          items: [
            {
              id: "exp-1",
              amount: "150.00",
              currencyCode: "EUR",
              category: "operational",
              occurredOn: "2026-03-20",
              description: "Combustível",
              status: "effective",
              context: null,
            },
          ],
        } as any;
      }
      if (path === "/finance/v2/expenses" && options?.method === "POST") {
        return {
          id: "exp-new",
          amount: JSON.parse(options.body).amount,
          currencyCode: "EUR",
          category: "operational",
          status: "effective",
        } as any;
      }
      if (path === "/finance/v2/expenses/exp-1/reverse" && options?.method === "POST") {
        return { id: "exp-1", status: "reversed" } as any;
      }
      return { items: [] } as any;
    });

    renderWithProviders(<ExpensesTab canMutate={true} />);

    await waitFor(() => {
      expect(screen.getByTestId("expense-row-exp-1")).toBeInTheDocument();
    });

    // 1. Open create dialog
    fireEvent.click(screen.getByTestId("btn-new-expense"));
    expect(screen.getByText("Registrar Nova Despesa")).toBeInTheDocument();

    // 2. Fill amount "0.10" as string
    fireEvent.change(screen.getByTestId("input-expense-amount"), { target: { value: "0.10" } });
    fireEvent.submit(screen.getByTestId("btn-submit-expense").closest("form")!);

    await waitFor(() => {
      const postCalls = apiSpy.mock.calls.filter(([p, opt]) => p === "/finance/v2/expenses" && opt?.method === "POST");
      expect(postCalls.length).toBeGreaterThan(0);
      const postPayload = JSON.parse(postCalls[0][1].body);
      expect(postPayload.amount).toBe("0.10"); // Strictly preserved as decimal string
      expect(postCalls[0][1].headers?.["Idempotency-Key"]).toBeDefined();
    });

    // 3. Reversal requires reason
    fireEvent.click(screen.getByTestId("btn-reverse-expense-exp-1"));
    expect(screen.getByText("Estornar Despesa")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("input-reverse-reason"), {
      target: { value: "Lançamento duplicado no fechamento" },
    });
    fireEvent.submit(screen.getByTestId("btn-confirm-reverse-expense").closest("form")!);

    await waitFor(() => {
      const reverseCalls = apiSpy.mock.calls.filter(([p]) => p === "/finance/v2/expenses/exp-1/reverse");
      expect(reverseCalls.length).toBeGreaterThan(0);
      const reversePayload = JSON.parse(reverseCalls[0][1].body);
      expect(reversePayload.reason).toBe("Lançamento duplicado no fechamento");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 6. DISTRIBUTIONS: Manual creation (fixed/pct) and zero-cash semantics     */
  /* -------------------------------------------------------------------------- */
  it("T11-DISTRIBUTIONS-01: manual fixed/pct creation and cancellation", async () => {
    const apiSpy = vi.spyOn(apiModule, "apiRequest").mockImplementation(async (path: string, options?: any) => {
      if (path === "/finance/v2/distributions" && (!options || options.method === undefined)) {
        return {
          items: [
            {
              id: "dist-1",
              paymentListId: "list-1",
              paymentListItemId: null,
              participant: { kind: "person", personId: "person-1" },
              allocation: { mode: "fixed", amount: "150.00" },
              resolvedAmount: "150.00",
              currencyCode: "EUR",
              status: "active",
            },
          ],
        } as any;
      }
      if (path === "/finance/v2/distributions" && options?.method === "POST") {
        return {
          id: "dist-new",
          resolvedAmount: "150.00",
          status: "active",
        } as any;
      }
      if (path === "/finance/v2/distributions/dist-1/cancel" && options?.method === "POST") {
        return { id: "dist-1", status: "cancelled" } as any;
      }
      return { items: [] } as any;
    });

    renderWithProviders(<DistributionsTab canMutate={true} />);

    await waitFor(() => {
      expect(screen.getByTestId("distribution-row-dist-1")).toBeInTheDocument();
    });

    // 1. Open create distribution dialog
    fireEvent.click(screen.getByTestId("btn-new-distribution"));
    expect(screen.getByText("Nova Distribuição Manual")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("input-dist-value"), { target: { value: "150.00" } });
    fireEvent.submit(screen.getByTestId("btn-submit-distribution").closest("form")!);

    await waitFor(() => {
      const postCalls = apiSpy.mock.calls.filter(([p, opt]) => p === "/finance/v2/distributions" && opt?.method === "POST");
      expect(postCalls.length).toBeGreaterThan(0);
      const payload = JSON.parse(postCalls[0][1].body);
      expect(payload.allocation).toEqual({ mode: "fixed", amount: "150.00" });
      expect(postCalls[0][1].headers?.["Idempotency-Key"]).toBeDefined();
    });

    // 2. Cancellation
    fireEvent.click(screen.getByTestId("btn-cancel-distribution-dist-1"));
    expect(screen.getByText("Cancelar Distribuição")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("input-cancel-distribution-reason"), {
      target: { value: "Alocação corrigida em nova rodada" },
    });
    fireEvent.submit(screen.getByTestId("btn-confirm-cancel-distribution").closest("form")!);

    await waitFor(() => {
      const cancelCalls = apiSpy.mock.calls.filter(([p]) => p === "/finance/v2/distributions/dist-1/cancel");
      expect(cancelCalls.length).toBeGreaterThan(0);
      const payload = JSON.parse(cancelCalls[0][1].body);
      expect(payload.reason).toBe("Alocação corrigida em nova rodada");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 7. OBLIGATIONS: Settlement & payment reversal lifecycles                  */
  /* -------------------------------------------------------------------------- */
  it("T11-OBLIGATIONS-01: settlement cash-out confirmation and payment reversal", async () => {
    const apiSpy = vi.spyOn(apiModule, "apiRequest").mockImplementation(async (path: string, options?: any) => {
      if (path === "/finance/v2/obligations" && (!options || options.method === undefined)) {
        return {
          items: [
            {
              id: "ob-1",
              distributionId: "dist-1",
              amount: "150.00",
              currencyCode: "EUR",
              status: "pending",
              createdAt: "2026-03-21T00:00:00Z",
              payment: null,
            },
            {
              id: "ob-2",
              distributionId: "dist-2",
              amount: "200.00",
              currencyCode: "EUR",
              status: "paid",
              createdAt: "2026-03-20T00:00:00Z",
              payment: {
                id: "pay-1",
                paidAt: "2026-03-21T12:00:00Z",
                amount: "200.00",
                currencyCode: "EUR",
                status: "effective",
              },
            },
          ],
        } as any;
      }
      if (path === "/finance/v2/distributions" && (!options || options.method === undefined)) {
        return {
          items: [
            {
              id: "dist-1",
              paymentListId: "list-1",
              participant: { kind: "person", personId: "person-1" },
              resolvedAmount: "150.00",
              currencyCode: "EUR",
              status: "active",
            },
            {
              id: "dist-2",
              paymentListId: "list-1",
              participant: { kind: "person", personId: "person-1" },
              resolvedAmount: "200.00",
              currencyCode: "EUR",
              status: "active",
            },
          ],
        } as any;
      }
      if (path === "/finance/v2/obligations/ob-1/settle" && options?.method === "POST") {
        return { id: "ob-1", status: "paid" } as any;
      }
      if (path === "/finance/v2/obligations/ob-2/settlements/pay-1/reverse" && options?.method === "POST") {
        return { id: "ob-2", status: "reversed" } as any;
      }
      return { items: [] } as any;
    });

    renderWithProviders(<ObligationsTab canMutate={true} />);

    await waitFor(() => {
      expect(screen.getByTestId("obligation-row-ob-1")).toBeInTheDocument();
      expect(screen.getByTestId("obligation-row-ob-2")).toBeInTheDocument();
    });

    // 1. Settle Pending obligation
    fireEvent.click(screen.getByTestId("btn-settle-obligation-ob-1"));
    expect(screen.getByText("Confirmar Liquidação de Caixa")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("btn-confirm-settle-obligation"));

    await waitFor(() => {
      const settleCalls = apiSpy.mock.calls.filter(([p]) => p === "/finance/v2/obligations/ob-1/settle");
      expect(settleCalls.length).toBeGreaterThan(0);
      expect(settleCalls[0][1].headers?.["Idempotency-Key"]).toBeDefined();
    });

    // 2. Reverse settled obligation payment
    fireEvent.click(screen.getByTestId("btn-reverse-payment-ob-2"));
    expect(screen.getByText("Estornar Liquidação (Pagamento)")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("input-reverse-payment-reason"), {
      target: { value: "Comprovante de pagamento inválido" },
    });
    fireEvent.submit(screen.getByTestId("btn-confirm-reverse-payment").closest("form")!);

    await waitFor(() => {
      const reverseCalls = apiSpy.mock.calls.filter(([p]) => p === "/finance/v2/obligations/ob-2/settlements/pay-1/reverse");
      expect(reverseCalls.length).toBeGreaterThan(0);
      const payload = JSON.parse(reverseCalls[0][1].body);
      expect(payload.reason).toBe("Comprovante de pagamento inválido");
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 8. DOUBLE SUBMIT PROTECTION: Buttons lock while pending                   */
  /* -------------------------------------------------------------------------- */
  it("T11-MUTATION-LOCK-01: submit button is disabled while mutation is pending", async () => {
    let resolveMutation: () => void = () => {};
    const mutationPromise = new Promise<any>((r) => {
      resolveMutation = () =>
        r({ id: "exp-slow", amount: "10.00", currencyCode: "EUR", category: "operational", status: "effective" });
    });

    vi.spyOn(apiModule, "apiRequest").mockImplementation(async (path: string, options?: any) => {
      if (path === "/finance/v2/expenses" && options?.method === "POST") {
        return mutationPromise;
      }
      return { items: [] } as any;
    });

    renderWithProviders(<ExpensesTab canMutate={true} />);
    fireEvent.click(screen.getByTestId("btn-new-expense"));

    fireEvent.change(screen.getByTestId("input-expense-amount"), { target: { value: "10.00" } });
    fireEvent.submit(screen.getByTestId("btn-submit-expense").closest("form")!);

    // Button should immediately become disabled while mutation is in flight
    await waitFor(() => {
      const submitBtn = screen.getByTestId("btn-submit-expense");
      expect(submitBtn).toBeDisabled();
      expect(submitBtn).toHaveTextContent("Registrando...");
    });

    resolveMutation();
  });

  /* -------------------------------------------------------------------------- */
  /* 9. STATIC SOURCE AUDIT: Active Finance UI has zero legacy authority       */
  /* -------------------------------------------------------------------------- */
  it("T11-SOURCE-AUDIT-01: FinancialPage and canonical finance components contain zero legacy finance authority", () => {
    const pageSource = readFileSync(resolve(process.cwd(), "src/pages/FinancialPage.tsx"), "utf8");
    const summarySource = readFileSync(resolve(process.cwd(), "src/components/finance/FinanceSummaryCards.tsx"), "utf8");
    const expensesSource = readFileSync(resolve(process.cwd(), "src/components/finance/ExpensesTab.tsx"), "utf8");
    const distributionsSource = readFileSync(resolve(process.cwd(), "src/components/finance/DistributionsTab.tsx"), "utf8");
    const obligationsSource = readFileSync(resolve(process.cwd(), "src/components/finance/ObligationsTab.tsx"), "utf8");
    const techViewSource = readFileSync(resolve(process.cwd(), "src/components/finance/TechnicianFinanceView.tsx"), "utf8");

    const fullSource = [pageSource, summarySource, expensesSource, distributionsSource, obligationsSource, techViewSource].join("\n");

    expect(fullSource).not.toContain("apiFinance");
    expect(fullSource).not.toContain("/financial-records");
    expect(fullSource).not.toContain("/finance/reconciliations");
    expect(fullSource).not.toContain("useFinancialAudit");
    expect(fullSource).not.toContain("useReconciliationSummary");
    expect(fullSource).not.toContain("useRunReconciliation");
    expect(fullSource).not.toContain("ProfitRule");
    expect(fullSource).not.toContain("@/integrations/supabase");
  });

  /* -------------------------------------------------------------------------- */
  /* 10. CURRENCY FORMATTER: No hardcoded EUR currency symbol                  */
  /* -------------------------------------------------------------------------- */
  it("T11-CURRENCY-FORMATTER-01: formats money strictly using currencyCode without defaulting to EUR", () => {
    expect(formatFinanceMoney("100.50", "USD")).toContain("100,50");
    expect(formatFinanceMoney("100.50", "BRL")).toContain("100,50");
    expect(formatFinanceMoney("100.50", "EUR")).toContain("100,50");
    expect(formatFinanceMoney(null, "EUR")).toBe("—");
    expect(formatFinanceMoney(undefined, "EUR")).toBe("—");
  });
});
