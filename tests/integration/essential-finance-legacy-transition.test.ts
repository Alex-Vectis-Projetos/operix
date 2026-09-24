import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../../backend/src/app.js"; // Assuming this is how it's exported
import { prisma } from "../../backend/src/lib/prisma.js";
import { execSync } from "child_process";
import path from "path";

// Helper to get auth token (mocked/test token based on your setup)
// Since this is a brownfield project, I'll assume we can create a user and generate a token
import { sign } from "jsonwebtoken";

const createTestToken = (userId: string, role = "admin") => {
  return sign({ sub: userId, role }, process.env.JWT_SECRET || "test-secret", { expiresIn: "1h" });
};

describe("Spec 005 - T09 Legacy Finance Transition", () => {
  let token: string;
  let workspaceId: string;
  let userId: string;

  beforeAll(async () => {
    // Setup test workspace and user
    const user = await prisma.user.create({
      data: { email: "t09-test@example.com", passwordHash: "dummy" }
    });
    userId = user.id;
    const ws = await prisma.workspace.create({
      data: { name: "T09 Legacy Test WS", slug: "t09-legacy-ws" }
    });
    workspaceId = ws.id;
    token = createTestToken(userId);
  });

  afterAll(async () => {
    // Cleanup
    await prisma.financialRecord.deleteMany({ where: { workspaceId } });
    await prisma.workspace.delete({ where: { id: workspaceId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  describe("Legacy Mutation Retirement", () => {
    it("returns 410 Gone for all legacy FinancialRecord endpoints", async () => {
      const getRes = await request(app).get("/api/financial-records").set("Authorization", `Bearer ${token}`);
      expect(getRes.status).toBe(410);
      expect(getRes.body.code).toBe("LEGACY_FINANCE_WRITE_DEPRECATED");

      const postRes = await request(app).post("/api/financial-records").set("Authorization", `Bearer ${token}`).send({ type: "expense" });
      expect(postRes.status).toBe(410);
      
      const patchRes = await request(app).patch("/api/financial-records/123").set("Authorization", `Bearer ${token}`).send({ amount: 100 });
      expect(patchRes.status).toBe(410);
      
      const delRes = await request(app).delete("/api/financial-records/123").set("Authorization", `Bearer ${token}`);
      expect(delRes.status).toBe(410);
      
      const delByRes = await request(app).post("/api/financial-records/delete-by").set("Authorization", `Bearer ${token}`).send({ type: "expense" });
      expect(delByRes.status).toBe(410);
    });

    it("returns 410 Gone for Reconciliation endpoints and performs no destructive operations", async () => {
      const preCount = await prisma.reconciliation.count();
      
      const getRes = await request(app).get("/api/finance/reconciliations").set("Authorization", `Bearer ${token}`);
      expect(getRes.status).toBe(410);
      expect(getRes.body.code).toBe("LEGACY_RECONCILIATION_READ_DEPRECATED");

      const runRes = await request(app).post("/api/finance/reconciliations/run").set("Authorization", `Bearer ${token}`);
      expect(runRes.status).toBe(410);
      expect(runRes.body.code).toBe("LEGACY_RECONCILIATION_ENGINE_DEPRECATED");
      
      const postCount = await prisma.reconciliation.count();
      expect(postCount).toBe(preCount); // DB unchanged
    });

    it("returns 410 Gone for ProfitRule endpoints", async () => {
      const getRes = await request(app).get("/api/finance/profit-rules").set("Authorization", `Bearer ${token}`);
      expect(getRes.status).toBe(410);

      const postRes = await request(app).post("/api/finance/profit-rules").set("Authorization", `Bearer ${token}`).send({});
      expect(postRes.status).toBe(410);

      const delRes = await request(app).delete("/api/finance/profit-rules/123").set("Authorization", `Bearer ${token}`);
      expect(delRes.status).toBe(410);
    });

    it("returns 410 Gone for Legacy Finance Summary", async () => {
      const getRes = await request(app).get("/api/finance/summary").set("Authorization", `Bearer ${token}`);
      expect(getRes.status).toBe(410);
    });
  });

  describe("Dry-Run Classification", () => {
    it("runs classification CLI and performs zero writes", async () => {
      const scriptPath = path.resolve(__dirname, "../../backend/scripts/classifyLegacyFinance.ts");
      
      // Seed a legacy row
      const fr = await prisma.financialRecord.create({
        data: { workspaceId, type: "income", amount: 100 }
      });
      
      const preCount = await prisma.financialRecord.count();
      
      const output = execSync(`npx tsx ${scriptPath}`).toString();
      const reportStr = output.split('\n').find(l => l.includes('"totals"'));
      expect(reportStr).toBeTruthy();
      
      if (reportStr) {
        const report = JSON.parse(reportStr);
        expect(report.mode).toBe("dry-run");
        expect(report.totals.financialRecord).toBeGreaterThanOrEqual(1);
      }
      
      const postCount = await prisma.financialRecord.count();
      expect(postCount).toBe(preCount); // Zero writes
    });
  });
});
