import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  listBudgets,
  getBudget,
  getBudgetRevisions,
  createBudget,
  updateBudgetRevision,
  approveBudgetRevision,
  rejectBudgetRevision,
  uploadBudgetPhoto,
  deleteBudgetPhoto,
} from "@/lib/apiBudgets";

describe("apiBudgets client contract tests (T10)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("listBudgets serializes query parameters correctly", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ budgets: [] }),
    });

    const res = await listBudgets({ q: "ORC-001", clientId: "c-1", plate: "ABC-1234" });
    expect(res).toEqual({ budgets: [] });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const calledUrl = (global.fetch as any).mock.calls[0][0];
    expect(calledUrl).toContain("/budgets?q=ORC-001&clientId=c-1&plate=ABC-1234");
  });

  it("getBudget and getBudgetRevisions query the expected endpoints", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ budget: { id: "b-123", code: "ORC-2026-0001" } }),
    });

    const b = await getBudget("b-123");
    expect(b.budget.id).toBe("b-123");
    expect((global.fetch as any).mock.calls[0][0]).toContain("/budgets/b-123");

    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ revisions: [{ id: "rev-1", revisionNumber: 1 }] }),
    });

    const revs = await getBudgetRevisions("b-123");
    expect(revs.revisions).toHaveLength(1);
    expect((global.fetch as any).mock.calls[1][0]).toContain("/budgets/b-123/revisions");
  });

  it("createBudget sends POST payload with JSON headers", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        budget: { id: "b-new", code: "ORC-2026-0002" },
        revision: { id: "rev-new", revisionNumber: 1, status: "draft" },
      }),
    });

    const res = await createBudget({
      clientName: "Oficina Modelo",
      vehiclePlate: "XYZ-9999",
      grossTotal: 450,
    });

    expect(res.budget.id).toBe("b-new");
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toContain("/budgets");
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({
      clientName: "Oficina Modelo",
      vehiclePlate: "XYZ-9999",
      grossTotal: 450,
    });
  });

  it("updateBudgetRevision targets explicit revisionId and handles fork response", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        budget: { id: "b-1" },
        revision: { id: "rev-2", revisionNumber: 2 },
        isNewRevision: true,
      }),
    });

    const res = await updateBudgetRevision("b-1", "rev-1", { grossTotal: 600 });
    expect(res.isNewRevision).toBe(true);
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toContain("/budgets/b-1/revisions/rev-1");
    expect(options.method).toBe("PUT");
  });

  it("approveBudgetRevision sends explicit revisionId and notes", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        budget: { id: "b-1", approvedRevisionId: "rev-1" },
        revision: { id: "rev-1", status: "approved" },
        productionOrder: { id: "po-1", code: "PO-001" },
      }),
    });

    const res = await approveBudgetRevision("b-1", "rev-1", { notes: "Aprovado pelo cliente via telefone" });
    expect(res.productionOrder.code).toBe("PO-001");
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toContain("/budgets/b-1/revisions/rev-1/approve");
    expect(options.method).toBe("POST");
    const parsedBody = JSON.parse(options.body);
    expect(parsedBody.revisionId).toBe("rev-1");
    expect(parsedBody.notes).toBe("Aprovado pelo cliente via telefone");
  });

  it("rejectBudgetRevision sends explicit revisionId and reason", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        budget: { id: "b-1" },
        revision: { id: "rev-1", status: "rejected" },
      }),
    });

    const res = await rejectBudgetRevision("b-1", "rev-1", "Preço acima do esperado");
    expect(res.revision.status).toBe("rejected");
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toContain("/budgets/b-1/revisions/rev-1/reject");
    expect(options.method).toBe("POST");
    const parsedBody = JSON.parse(options.body);
    expect(parsedBody.revisionId).toBe("rev-1");
    expect(parsedBody.reason).toBe("Preço acima do esperado");
  });

  it("uploadBudgetPhoto sends multipart/form-data with file and metadata", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({
        photo: {
          id: "ph-1",
          budgetId: "b-1",
          category: "damage",
          storagePath: "tenants/ws-1/budgets/b-1/ph-1.jpg",
        },
      }),
    });

    const fakeBlob = new Blob(["fake-image-bytes"], { type: "image/jpeg" });
    const res = await uploadBudgetPhoto("b-1", fakeBlob, { category: "damage", caption: "Lateral amassada" });

    expect(res.photo.id).toBe("ph-1");
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toContain("/budgets/b-1/photos");
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
  });

  it("deleteBudgetPhoto calls DELETE /budgets/:id/photos/:photoId", async () => {
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ deleted: 1, id: "ph-1" }),
    });

    const res = await deleteBudgetPhoto("b-1", "ph-1");
    expect(res.deleted).toBe(1);
    const [url, options] = (global.fetch as any).mock.calls[0];
    expect(url).toContain("/budgets/b-1/photos/ph-1");
    expect(options.method).toBe("DELETE");
  });
});
