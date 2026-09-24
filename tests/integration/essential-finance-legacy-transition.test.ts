// @vitest-environment node
process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://operix_local:operix_local@127.0.0.1:55432/operix_local?schema=public";
process.env.JWT_SECRET ??= "this-is-a-test-secret-with-more-than-32-chars-long";
process.env.MINIO_ROOT_PASSWORD ??= "operix-test-minio-password";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { once } from "node:events";
import { execSync } from "node:child_process";
import path from "node:path";

const express = (await import("../../backend/node_modules/express/index.js")).default;
const { prisma } = await import("../../backend/src/lib/prisma.js");
const { financialRecordsRouter } = await import("../../backend/src/routes/financialRecords.js");
const { financeRouter } = await import("../../backend/src/routes/finance.js");
const { signAccessToken } = await import("../../backend/src/lib/jwt.js");

describe("Spec 005 - T09 Legacy Finance Transition", () => {
  let token: string;
  let workspaceId: string;
  let userId: string;
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    // Setup test workspace and user
    await prisma.user.deleteMany({ where: { email: "t09-legacy-transition@example.com" } });
    const appUserId = "f7200000-0000-4000-8000-000000000099";
    const user = await prisma.user.create({
      data: {
        email: "t09-legacy-transition@example.com",
        fullName: "T09 User",
        role: "admin",
        passwordHash: "dummy",
        appUser: { create: { id: appUserId, email: "t09-legacy-transition@example.com" } },
      },
    });
    userId = user.id;
    const ws = await prisma.workspace.create({
      data: { name: "T09 Legacy Test WS", ownerUserId: appUserId },
    });
    workspaceId = ws.id;
    token = signAccessToken({
      id: userId,
      email: user.email,
      role: "admin",
    });

    const app = express();
    app.use(express.json());
    app.use("/api/financial-records", financialRecordsRouter);
    app.use("/api/finance", financeRouter);

    server = app.listen(0);
    await once(server, "listening");
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    if (server) server.close();
    if (workspaceId) {
      await prisma.financialRecord.deleteMany({ where: { workspaceId } });
      await prisma.workspace.delete({ where: { id: workspaceId } });
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
    }
  });

  describe("Legacy Mutation Retirement", () => {
    it("returns 410 Gone for all legacy FinancialRecord endpoints", async () => {
      const getRes = await fetch(`${baseUrl}/api/financial-records`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(getRes.status).toBe(410);
      const getBody: any = await getRes.json();
      expect(getBody.code).toBe("LEGACY_FINANCE_WRITE_DEPRECATED");

      const postRes = await fetch(`${baseUrl}/api/financial-records`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "expense" }),
      });
      expect(postRes.status).toBe(410);

      const patchRes = await fetch(`${baseUrl}/api/financial-records/123`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 100 }),
      });
      expect(patchRes.status).toBe(410);

      const delRes = await fetch(`${baseUrl}/api/financial-records/123`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(delRes.status).toBe(410);

      const delByRes = await fetch(`${baseUrl}/api/financial-records/delete-by`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ type: "expense" }),
      });
      expect(delByRes.status).toBe(410);
    });

    it("returns 410 Gone for Reconciliation endpoints and performs no destructive operations", async () => {
      const preCount = await prisma.reconciliation.count();

      const getRes = await fetch(`${baseUrl}/api/finance/reconciliations`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(getRes.status).toBe(410);
      const getBody: any = await getRes.json();
      expect(getBody.code).toBe("LEGACY_RECONCILIATION_READ_DEPRECATED");

      const runRes = await fetch(`${baseUrl}/api/finance/reconciliations/run`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(runRes.status).toBe(410);
      const runBody: any = await runRes.json();
      expect(runBody.code).toBe("LEGACY_RECONCILIATION_ENGINE_DEPRECATED");

      const postCount = await prisma.reconciliation.count();
      expect(postCount).toBe(preCount); // DB unchanged
    });

    it("returns 410 Gone for ProfitRule endpoints", async () => {
      const getRes = await fetch(`${baseUrl}/api/finance/profit-rules`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(getRes.status).toBe(410);

      const postRes = await fetch(`${baseUrl}/api/finance/profit-rules`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(postRes.status).toBe(410);

      const delRes = await fetch(`${baseUrl}/api/finance/profit-rules/123`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(delRes.status).toBe(410);
    });

    it("returns 410 Gone for Legacy Finance Summary", async () => {
      const getRes = await fetch(`${baseUrl}/api/finance/summary`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(getRes.status).toBe(410);
    });
  });

  describe("Dry-Run Classification", () => {
    it("runs classification CLI and performs zero writes", async () => {
      const scriptPath = path.resolve(process.cwd(), "backend/scripts/classifyLegacyFinance.ts");

      // Seed a legacy row
      await prisma.financialRecord.create({
        data: { workspaceId, type: "income", amount: 100 },
      });

      const preCount = await prisma.financialRecord.count();

      const output = execSync(`npx tsx "${scriptPath}"`, {
        env: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL || "postgresql://operix_local:operix_local@127.0.0.1:55432/operix_local?schema=public",
        },
      }).toString();
      const reportStart = output.indexOf('{\n  "mode": "dry-run"');
      expect(reportStart).toBeGreaterThanOrEqual(0);
      const report = JSON.parse(output.slice(reportStart));
      expect(report.mode).toBe("dry-run");
      expect(report.totals.financialRecord).toBeGreaterThanOrEqual(1);

      const postCount = await prisma.financialRecord.count();
      expect(postCount).toBe(preCount); // Zero writes
    }, 30000);
  });
});
