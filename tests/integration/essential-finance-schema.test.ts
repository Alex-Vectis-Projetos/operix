// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://operix_local:operix_local@127.0.0.1:55432/operix_local?schema=public";
process.env.JWT_SECRET ??= "this-is-a-test-secret-with-more-than-32-chars-long";
process.env.MINIO_ROOT_PASSWORD ??= "operix-test-minio-password";

const { prisma } = await import("../../backend/src/lib/prisma.js");

const WS_A = "e5000000-0000-4000-8000-000000000001";
const WS_B = "e5000000-0000-4000-8000-000000000002";
const USER_A = "e5100000-0000-4000-8000-000000000001";
const APP_USER_A = "e5200000-0000-4000-8000-000000000001";
const CLIENT_A = "e5300000-0000-4000-8000-000000000001";
const CLIENT_B = "e5300000-0000-4000-8000-000000000002";
const LIST_A = "e5400000-0000-4000-8000-000000000001";
const LIST_B = "e5400000-0000-4000-8000-000000000002";
const DISTRIBUTION_A = "e5500000-0000-4000-8000-000000000001";
const OBLIGATION_A = "e5600000-0000-4000-8000-000000000001";

async function cleanup() {
  await prisma.$executeRawUnsafe(`DELETE FROM "finance_idempotency" WHERE "workspace_id" IN ('${WS_A}', '${WS_B}')`);
  await prisma.$executeRawUnsafe(`DELETE FROM "obligation_payments" WHERE "workspace_id" IN ('${WS_A}', '${WS_B}')`);
  await prisma.$executeRawUnsafe(`DELETE FROM "financial_obligations" WHERE "workspace_id" IN ('${WS_A}', '${WS_B}')`);
  await prisma.$executeRawUnsafe(`DELETE FROM "distributions" WHERE "workspace_id" IN ('${WS_A}', '${WS_B}')`);
  await prisma.$executeRawUnsafe(`DELETE FROM "expenses" WHERE "workspace_id" IN ('${WS_A}', '${WS_B}')`);
  await prisma.paymentList.deleteMany({ where: { id: { in: [LIST_A, LIST_B] } } });
  await prisma.client.deleteMany({ where: { id: { in: [CLIENT_A, CLIENT_B] } } });
  await prisma.workspace.deleteMany({ where: { id: { in: [WS_A, WS_B] } } });
  await prisma.appUser.deleteMany({ where: { id: APP_USER_A } });
  await prisma.user.deleteMany({ where: { id: USER_A } });
}

describe("Spec 005 — T03/T04 canonical finance schema", () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.user.create({
      data: {
        id: USER_A, email: "spec005-schema@operix.local", fullName: "Spec 005 schema user", role: "admin", passwordHash: "test-hash",
        appUser: { create: { id: APP_USER_A, email: "spec005-schema@operix.local", name: "Spec 005 schema user" } },
      },
    });
    await prisma.workspace.create({ data: { id: WS_A, name: "Spec 005 schema A", type: "company", ownerUserId: APP_USER_A } });
    await prisma.workspace.create({ data: { id: WS_B, name: "Spec 005 schema B", type: "company", ownerUserId: APP_USER_A } });
    await prisma.client.create({ data: { id: CLIENT_A, workspaceId: WS_A, name: "Client A" } });
    await prisma.client.create({ data: { id: CLIENT_B, workspaceId: WS_B, name: "Client B" } });
    await prisma.paymentList.create({ data: { id: LIST_A, workspaceId: WS_A, clientId: CLIENT_A, clientName: "Client A", listNumber: "SPEC005-A", currencyCode: "EUR", createdBy: USER_A } });
    await prisma.paymentList.create({ data: { id: LIST_B, workspaceId: WS_B, clientId: CLIENT_B, clientName: "Client B", listNumber: "SPEC005-B", currencyCode: "EUR", createdBy: USER_A } });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("SCHEMA-FIN-OBJECTS-01: deploys all canonical tables, enums, and migration record", async () => {
    const objects = await prisma.$queryRawUnsafe<Array<{ name: string }>>(`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('expenses', 'distributions', 'financial_obligations', 'obligation_payments', 'finance_idempotency')
      ORDER BY table_name
    `);
    const migration = await prisma.$queryRawUnsafe<Array<{ migration_name: string }>>(`
      SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = '20260923140000_spec005_essential_finance_domain' AND finished_at IS NOT NULL
    `);
    expect(objects.map((object) => object.name)).toEqual(["distributions", "expenses", "finance_idempotency", "financial_obligations", "obligation_payments"]);
    expect(migration).toHaveLength(1);
  });

  it("SCHEMA-FIN-COLUMNS-01: persists non-null tenant IDs and Decimal(12,2) money", async () => {
    const columns = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string; is_nullable: string; data_type: string; numeric_precision: number | null; numeric_scale: number | null }>>(`
      SELECT table_name, column_name, is_nullable, data_type, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name IN ('expenses', 'financial_obligations', 'obligation_payments') AND column_name = 'amount')
          OR (table_name = 'distributions' AND column_name IN ('fixed_amount', 'resolved_amount'))
          OR (table_name IN ('expenses', 'distributions', 'financial_obligations', 'obligation_payments', 'finance_idempotency') AND column_name = 'workspace_id'))
    `);
    const workspaceColumns = columns.filter((column) => column.column_name === "workspace_id");
    const moneyColumns = columns.filter((column) => column.column_name !== "workspace_id");
    expect(workspaceColumns).toHaveLength(5);
    expect(workspaceColumns.every((column) => column.is_nullable === "NO")).toBe(true);
    expect(moneyColumns.every((column) => column.data_type === "numeric" && column.numeric_precision === 12 && column.numeric_scale === 2)).toBe(true);
  });

  it("SCHEMA-EXPENSE-01: rejects non-positive money, invalid currency, and incoherent polymorphic context", async () => {
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "expenses" ("id", "workspace_id", "amount", "currency_code", "category", "occurred_on", "created_by_user_id") VALUES ('e5700000-0000-4000-8000-000000000001', '${WS_A}', 0, 'EUR', 'fuel', CURRENT_DATE, '${USER_A}')`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "expenses" ("id", "workspace_id", "amount", "currency_code", "category", "occurred_on", "created_by_user_id") VALUES ('e5700000-0000-4000-8000-000000000002', '${WS_A}', 1, 'eur', 'fuel', CURRENT_DATE, '${USER_A}')`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "expenses" ("id", "workspace_id", "amount", "currency_code", "category", "occurred_on", "context_kind", "payment_list_id", "client_id", "created_by_user_id") VALUES ('e5700000-0000-4000-8000-000000000003', '${WS_A}', 1, 'EUR', 'fuel', CURRENT_DATE, 'payment_list', '${LIST_A}', '${CLIENT_A}', '${USER_A}')`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "expenses" ("id", "workspace_id", "amount", "currency_code", "category", "occurred_on", "status", "created_by_user_id") VALUES ('e5700000-0000-4000-8000-000000000005', '${WS_A}', 1, 'EUR', 'fuel', CURRENT_DATE, 'reversed', '${USER_A}')`)).rejects.toThrow();
  });

  it("SCHEMA-EXPENSE-TENANT-01: composite context FKs reject cross-tenant payment-list linkage", async () => {
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "expenses" ("id", "workspace_id", "amount", "currency_code", "category", "occurred_on", "context_kind", "payment_list_id", "created_by_user_id") VALUES ('e5700000-0000-4000-8000-000000000004', '${WS_A}', 1, 'EUR', 'fuel', CURRENT_DATE, 'payment_list', '${LIST_B}', '${USER_A}')`)).rejects.toThrow();
  });

  it("SCHEMA-DISTRIBUTION-01: enforces participant/allocation XOR and tenant-scoped source", async () => {
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "distributions" ("id", "workspace_id", "payment_list_id", "participant_kind", "participant_client_id", "allocation_mode", "fixed_amount", "percentage", "resolved_amount", "currency_code", "created_by_user_id") VALUES ('e5800000-0000-4000-8000-000000000001', '${WS_A}', '${LIST_A}', 'client', '${CLIENT_A}', 'fixed', 10, 20, 10, 'EUR', '${USER_A}')`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "distributions" ("id", "workspace_id", "payment_list_id", "participant_kind", "participant_person_id", "participant_client_id", "allocation_mode", "fixed_amount", "resolved_amount", "currency_code", "created_by_user_id") VALUES ('e5800000-0000-4000-8000-000000000003', '${WS_A}', '${LIST_A}', 'client', 'missing-person', '${CLIENT_A}', 'fixed', 10, 10, 'EUR', '${USER_A}')`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "distributions" ("id", "workspace_id", "payment_list_id", "participant_kind", "participant_client_id", "allocation_mode", "percentage", "resolved_amount", "currency_code", "created_by_user_id") VALUES ('e5800000-0000-4000-8000-000000000004', '${WS_A}', '${LIST_A}', 'client', '${CLIENT_A}', 'percentage', 100.01, 10, 'EUR', '${USER_A}')`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "distributions" ("id", "workspace_id", "payment_list_id", "participant_kind", "participant_client_id", "allocation_mode", "percentage", "resolved_amount", "currency_code", "created_by_user_id") VALUES ('e5800000-0000-4000-8000-000000000002', '${WS_A}', '${LIST_B}', 'client', '${CLIENT_A}', 'percentage', 10, 10, 'EUR', '${USER_A}')`)).rejects.toThrow();
    await prisma.$executeRawUnsafe(`INSERT INTO "distributions" ("id", "workspace_id", "payment_list_id", "participant_kind", "participant_client_id", "allocation_mode", "fixed_amount", "resolved_amount", "currency_code", "created_by_user_id") VALUES ('${DISTRIBUTION_A}', '${WS_A}', '${LIST_A}', 'client', '${CLIENT_A}', 'fixed', 100, 100, 'EUR', '${USER_A}')`);
  });

  it("SCHEMA-OBLIGATION-01: enforces one obligation/payment and tenant-scoped settlement lineage", async () => {
    await prisma.$executeRawUnsafe(`INSERT INTO "financial_obligations" ("id", "workspace_id", "distribution_id", "amount", "currency_code", "created_by_user_id") VALUES ('${OBLIGATION_A}', '${WS_A}', '${DISTRIBUTION_A}', 100, 'EUR', '${USER_A}')`);
    await expect(prisma.$executeRawUnsafe(`UPDATE "financial_obligations" SET "status" = 'paid' WHERE "id" = '${OBLIGATION_A}'`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "financial_obligations" ("id", "workspace_id", "distribution_id", "amount", "currency_code", "created_by_user_id") VALUES ('e5900000-0000-4000-8000-000000000001', '${WS_A}', '${DISTRIBUTION_A}', 100, 'EUR', '${USER_A}')`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "obligation_payments" ("id", "workspace_id", "obligation_id", "amount", "currency_code", "paid_at", "paid_by_user_id") VALUES ('e5900000-0000-4000-8000-000000000002', '${WS_B}', '${OBLIGATION_A}', 100, 'EUR', NOW(), '${USER_A}')`)).rejects.toThrow();
    await prisma.$executeRawUnsafe(`INSERT INTO "obligation_payments" ("id", "workspace_id", "obligation_id", "amount", "currency_code", "paid_at", "paid_by_user_id") VALUES ('e5900000-0000-4000-8000-000000000003', '${WS_A}', '${OBLIGATION_A}', 100, 'EUR', NOW(), '${USER_A}')`);
    await expect(prisma.$executeRawUnsafe(`INSERT INTO "obligation_payments" ("id", "workspace_id", "obligation_id", "amount", "currency_code", "paid_at", "paid_by_user_id") VALUES ('e5900000-0000-4000-8000-000000000004', '${WS_A}', '${OBLIGATION_A}', 100, 'EUR', NOW(), '${USER_A}')`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE "obligation_payments" SET "status" = 'reversed' WHERE "id" = 'e5900000-0000-4000-8000-000000000003'`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "payment_lists" WHERE "id" = '${LIST_A}'`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "users" WHERE "id" = '${USER_A}'`)).rejects.toThrow();
  });

  it("SCHEMA-IDEMPOTENCY-01: makes a client key unique within actor/action/workspace scope", async () => {
    const insert = (id: string, workspaceId: string, actorId: string, key: string) => prisma.$executeRawUnsafe(`INSERT INTO "finance_idempotency" ("id", "workspace_id", "actor_user_id", "action_namespace", "idempotency_key", "request_hash", "resource_type", "resource_id") VALUES ('${id}', '${workspaceId}', '${actorId}', 'obligation.settle', '${key}', 'sha256:test', 'obligation', '${OBLIGATION_A}')`);
    await insert("e6000000-0000-4000-8000-000000000001", WS_A, USER_A, "key-1");
    await expect(insert("e6000000-0000-4000-8000-000000000002", WS_A, USER_A, "key-1")).rejects.toThrow();
    await insert("e6000000-0000-4000-8000-000000000003", WS_B, USER_A, "key-1");
  });
});
