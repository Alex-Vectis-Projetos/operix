// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// @ts-expect-error backend dependency
import express from "../../backend/node_modules/express/index.js";
import { prisma } from "../../backend/src/lib/prisma.js";
import { signAccessToken } from "../../backend/src/lib/jwt.js";
import { ForbiddenError, NotFoundError } from "../../backend/src/lib/objectAuth.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock?schema=public";
process.env.JWT_SECRET = process.env.JWT_SECRET || "this-is-a-test-secret-with-more-than-32-chars-long";

describe("Clients & People CRUD Persistence & Tenant Isolation Suite", () => {
  let app: express.Express;
  let server: any;
  let baseUrl: string;

  beforeEach(async () => {
    app = express();
    app.use(express.json());

    const { operationalBillingRouter } = await import("../../backend/src/routes/billingOperations.js");
    const { peopleRouter } = await import("../../backend/src/routes/people.js");

    app.use("/api/billing", operationalBillingRouter);
    app.use("/api/people", peopleRouter);

    app.use((err: any, _req: any, res: any, _next: any) => {
      const statusCode = err?.statusCode || (err instanceof ForbiddenError ? 403 : err instanceof NotFoundError ? 404 : 500);
      res.status(statusCode).json({ message: err?.message || "Internal error" });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${typeof addr === "object" ? addr?.port : 0}`;
        resolve();
      });
    });
  });

  afterEach(() => {
    if (server) server.close();
    vi.restoreAllMocks();
  });

  function setupAuthMocks(workspaceId = "ws-alpha", role = "admin") {
    const token = signAccessToken({
      id: "user-test-id",
      email: "tester@example.com",
      role: "admin",
    });

    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      id: "user-test-id",
      email: "tester@example.com",
      role: "admin",
      isActive: true,
    } as any);

    vi.spyOn(prisma.appUser, "findUnique").mockResolvedValue({
      id: "app-user-test",
      authUserId: "user-test-id",
      workspaceId,
    } as any);

    vi.spyOn(prisma.membership, "findMany").mockResolvedValue([
      { workspaceId, role } as any,
    ]);

    vi.spyOn(prisma.workspace, "findMany").mockResolvedValue([
      { id: workspaceId, type: "company" } as any,
    ]);

    vi.spyOn(prisma.person, "findFirst").mockResolvedValue(null);

    return token;
  }

  it("1. creates professional client with tenant workspace authority and lists it", async () => {
    const token = setupAuthMocks("ws-homolog-01", "owner");

    let createdClientRow: any = null;
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      const mockTx = {
        billingClient: {
          aggregate: vi.fn().mockResolvedValue({ _max: { customerDisplayNum: 0 } }),
          create: vi.fn().mockImplementation(({ data }: any) => {
            createdClientRow = {
              id: "client-pro-1",
              ...data,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            return createdClientRow;
          }),
        },
        backendEventLog: {
          create: vi.fn().mockResolvedValue({ id: "log-1" }),
        },
      };
      return callback(mockTx);
    });

    // POST create
    const createRes = await fetch(`${baseUrl}/api/billing/admin/ops/clients`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": "ws-homolog-01",
      },
      body: JSON.stringify({
        kind: "professional",
        name: "HOMOLOG-FIX-PRO-001",
        siren: "123456789",
        is_active: true,
      }),
    });

    expect(createRes.status).toBe(201);
    const createJson = await createRes.json();
    expect(createJson.client.name).toBe("HOMOLOG-FIX-PRO-001");
    expect(createJson.client.kind).toBe("professional");
    // Verified tenant authority binding
    expect(createdClientRow.workspaceId).toBe("ws-homolog-01");

    // Mock GET list
    vi.spyOn(prisma.billingClient, "findMany").mockImplementation(async ({ where }: any) => {
      if (where?.customerDisplayNum === null) {
        return [];
      }
      if (where?.workspaceId === "ws-homolog-01") {
        return [createdClientRow];
      }
      return [];
    });
    vi.spyOn(prisma.billingInvoice, "findMany").mockResolvedValue([]);

    const listRes = await fetch(`${baseUrl}/api/billing/admin/ops/clients?active_only=false`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": "ws-homolog-01",
      },
    });

    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.clients.length).toBe(1);
    expect(listJson.clients[0].name).toBe("HOMOLOG-FIX-PRO-001");
  });

  it("2. creates particular client with tenant workspace authority and lists it", async () => {
    const token = setupAuthMocks("ws-homolog-01", "owner");

    let createdClientRow: any = null;
    vi.spyOn(prisma, "$transaction").mockImplementation(async (callback: any) => {
      const mockTx = {
        billingClient: {
          aggregate: vi.fn().mockResolvedValue({ _max: { customerDisplayNum: 1 } }),
          create: vi.fn().mockImplementation(({ data }: any) => {
            createdClientRow = {
              id: "client-particular-1",
              ...data,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            return createdClientRow;
          }),
        },
        backendEventLog: {
          create: vi.fn().mockResolvedValue({ id: "log-2" }),
        },
      };
      return callback(mockTx);
    });

    const createRes = await fetch(`${baseUrl}/api/billing/admin/ops/clients`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": "ws-homolog-01",
      },
      body: JSON.stringify({
        kind: "particular",
        name: "HOMOLOG-FIX-PER-001",
        email: "particular@example.com",
        is_active: true,
      }),
    });

    expect(createRes.status).toBe(201);
    const createJson = await createRes.json();
    expect(createJson.client.name).toBe("HOMOLOG-FIX-PER-001");
    expect(createJson.client.kind).toBe("particular");
    expect(createdClientRow.workspaceId).toBe("ws-homolog-01");
  });

  it("3. creates person/contact and verifies list scoping", async () => {
    const token = setupAuthMocks("ws-homolog-01", "owner");

    let createdPersonRow: any = null;
    vi.spyOn(prisma.person, "create").mockImplementation(async ({ data }: any) => {
      createdPersonRow = {
        id: "person-1",
        workspaceId: data.workspaceId,
        type: data.type,
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        status: data.status,
        createdAt: new Date(),
        updatedAt: new Date(),
        identityDocuments: [],
        location: null,
      };
      return createdPersonRow;
    });

    const createRes = await fetch(`${baseUrl}/api/people`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": "ws-homolog-01",
      },
      body: JSON.stringify({
        type: "administrative",
        full_name: "HOMOLOG-FIX-PERSON-001",
        id_documents: [{ document_type: "Passport", document_number: "P123456" }],
        email: "person@example.com",
        status: "active",
      }),
    });

    expect(createRes.status).toBe(201);
    const createJson = await createRes.json();
    expect(createJson.full_name).toBe("HOMOLOG-FIX-PERSON-001");
    expect(createJson.workspace_id).toBe("ws-homolog-01");

    vi.spyOn(prisma.person, "findMany").mockImplementation(async ({ where }: any) => {
      if (where?.workspaceId === "ws-homolog-01") {
        return [createdPersonRow];
      }
      return [];
    });

    const listRes = await fetch(`${baseUrl}/api/people`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": "ws-homolog-01",
      },
    });

    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.length).toBe(1);
    expect(listJson[0].full_name).toBe("HOMOLOG-FIX-PERSON-001");
  });

  it("4. rejects client creation with cross-tenant workspace_id spoofing", async () => {
    const token = setupAuthMocks("ws-homolog-01", "admin");

    const res = await fetch(`${baseUrl}/api/billing/admin/ops/clients`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": "ws-homolog-01",
      },
      body: JSON.stringify({
        kind: "professional",
        name: "Spoofed Client",
        workspace_id: "ws-victim-99", // Attempting to inject victim workspace
      }),
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.message).toContain("Acesso negado: workspace diferente do ativo.");
  });

  it("5. isolates data between workspaces (tenant boundary)", async () => {
    const tokenA = setupAuthMocks("ws-alpha", "owner");

    vi.spyOn(prisma.billingClient, "findMany").mockImplementation(async ({ where }: any) => {
      if (where?.workspaceId === "ws-beta") {
        return [{ id: "c-beta", name: "Beta Client", workspaceId: "ws-beta" } as any];
      }
      return [];
    });
    vi.spyOn(prisma.billingInvoice, "findMany").mockResolvedValue([]);

    const resA = await fetch(`${baseUrl}/api/billing/admin/ops/clients?active_only=false`, {
      headers: {
        Authorization: `Bearer ${tokenA}`,
        "X-Workspace-Id": "ws-alpha",
      },
    });

    expect(resA.status).toBe(200);
    const jsonA = await resA.json();
    // User in ws-alpha cannot see ws-beta's client
    expect(jsonA.clients).toEqual([]);
  });

  it("6. creation success cannot occur without backend persistence", async () => {
    const token = setupAuthMocks("ws-homolog-01", "owner");

    vi.spyOn(prisma, "$transaction").mockRejectedValue(new Error("Database write failure"));

    const res = await fetch(`${baseUrl}/api/billing/admin/ops/clients`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": "ws-homolog-01",
      },
      body: JSON.stringify({
        kind: "professional",
        name: "Failed Client",
      }),
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.client).toBeUndefined();
  });

  it("7. filtering people by type retains matching records and excludes mismatched", async () => {
    const token = setupAuthMocks("ws-homolog-01", "owner");

    const samplePeople = [
      {
        id: "p-admin",
        fullName: "Admin Person",
        type: "administrative",
        workspaceId: "ws-homolog-01",
        identityDocuments: [],
        location: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: "p-tech",
        fullName: "Tech Person",
        type: "technician",
        workspaceId: "ws-homolog-01",
        identityDocuments: [],
        location: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ];

    vi.spyOn(prisma.person, "findMany").mockImplementation(async ({ where }: any) => {
      return samplePeople.filter((p) => {
        if (p.workspaceId !== where?.workspaceId) return false;
        if (where?.type && p.type !== where.type) return false;
        return true;
      }) as any;
    });

    // Request filtered by technician
    const resTech = await fetch(`${baseUrl}/api/people?type=technician`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": "ws-homolog-01",
      },
    });

    expect(resTech.status).toBe(200);
    const jsonTech = await resTech.json();
    expect(jsonTech.length).toBe(1);
    expect(jsonTech[0].type).toBe("technician");

    // Request without filter
    const resAll = await fetch(`${baseUrl}/api/people`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Workspace-Id": "ws-homolog-01",
      },
    });

    expect(resAll.status).toBe(200);
    const jsonAll = await resAll.json();
    expect(jsonAll.length).toBe(2);
  });
});
