// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../backend/src/lib/prisma.js";
import { Prisma, PrismaClient } from "../../backend/node_modules/@prisma/client/index.js";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const WS_A = "50000000-0000-4000-8000-000000000001";
const WS_B = "50000000-0000-4000-8000-000000000002";
const CLIENT_A = "51000000-0000-4000-8000-000000000001";
const CLIENT_B = "51000000-0000-4000-8000-000000000002";
const USER_A = "52000000-0000-4000-8000-000000000001";
const APP_USER_A = "53000000-0000-4000-8000-000000000001";

const PRE_SPEC004_MIGRATIONS = [
  "20260814000000_init_baseline",
  "20260814130000_add_customer_display_id",
  "20260914150000_spec_002_mobile_operation_budget_production",
  "20260917000000_add_weeklog_canonical_domain_and_versioned_rectification",
  "20260917100000_strengthen_spec002_budget_lineage_constraints",
  "20260917110000_spec_003_weeklog_validation_round_lifecycle",
  "20260917120000_fix_legacy_weeklog_validation_semantics",
] as const;

const SPEC004_MIGRATIONS = [
  "20260921120000_spec004_payment_list_domain",
  "20260921130000_spec004_relational_hardening",
] as const;

function deployMigrations(schemaPath: string, databaseUrl: string) {
  const prismaCli = resolve(process.cwd(), "backend/node_modules/prisma/build/index.js");
  return execFileSync(process.execPath, [prismaCli, "migrate", "deploy", "--schema", schemaPath], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test" },
    encoding: "utf8",
    stdio: "pipe",
  });
}

describe("Spec 004 — T03/T04 Relational Schema & Migration Verification Suite", () => {
  beforeAll(async () => {
    // Limpeza de segurança
    await cleanup();

    // 1. Setup básico de tenant e usuário
    await prisma.user.create({
      data: {
        id: USER_A,
        email: "schema.test@operix.local",
        fullName: "Schema Test User",
        role: "admin",
        passwordHash: "hash-dummy",
        appUser: {
          create: {
            id: APP_USER_A,
            email: "schema.test@operix.local",
            name: "Schema Test User",
          },
        },
      },
    });

    await prisma.workspace.create({
      data: {
        id: WS_A,
        name: "Workspace Schema A",
        type: "company",
        ownerUserId: APP_USER_A,
      },
    });

    await prisma.workspace.create({
      data: {
        id: WS_B,
        name: "Workspace Schema B",
        type: "company",
        ownerUserId: APP_USER_A,
      },
    });

    await prisma.client.create({
      data: {
        id: CLIENT_A,
        workspaceId: WS_A,
        name: "Client Alpha",
      },
    });

    await prisma.client.create({
      data: {
        id: CLIENT_B,
        workspaceId: WS_B,
        name: "Client Bravo",
      },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  async function cleanup() {
    await prisma.$executeRawUnsafe(`DELETE FROM payment_list_confrontation_results WHERE workspace_id IN ('${WS_A}', '${WS_B}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM payment_list_confrontation_runs WHERE workspace_id IN ('${WS_A}', '${WS_B}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM payment_list_entry_claims WHERE workspace_id IN ('${WS_A}', '${WS_B}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM payment_list_items WHERE workspace_id IN ('${WS_A}', '${WS_B}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM external_list_import_items WHERE workspace_id IN ('${WS_A}', '${WS_B}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM external_list_imports WHERE workspace_id IN ('${WS_A}', '${WS_B}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM payment_lists WHERE workspace_id IN ('${WS_A}', '${WS_B}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM weeklog_entries WHERE workspace_id IN ('${WS_A}', '${WS_B}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM external_operational_import_items WHERE workspace_id IN ('${WS_A}', '${WS_B}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM external_operational_imports WHERE workspace_id IN ('${WS_A}', '${WS_B}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM production_orders WHERE workspace_id IN ('${WS_A}', '${WS_B}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM weeklogs WHERE workspace_id IN ('${WS_A}', '${WS_B}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM tenant_sequence_counters WHERE workspace_id IN ('${WS_A}', '${WS_B}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM clients WHERE workspace_id IN ('${WS_A}', '${WS_B}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM workspaces WHERE id IN ('${WS_A}', '${WS_B}')`);
    await prisma.$executeRawUnsafe(`DELETE FROM app_users WHERE id = '${APP_USER_A}'`);
    await prisma.$executeRawUnsafe(`DELETE FROM users WHERE id = '${USER_A}'`);
  }

  it("SCHEMA-PAYMENT-LIST-01: PaymentList com @@unique([workspaceId, listNumber]) e isolamento multitenant", async () => {
    // Cria PaymentList com listNumber L000001 no Workspace A
    const listA1 = await prisma.paymentList.create({
      data: {
        workspaceId: WS_A,
        clientId: CLIENT_A,
        clientName: "Client Alpha",
        listNumber: "L000001",
        currencyCode: "EUR",
        status: "draft",
        sourceDocumentTotal: new Prisma.Decimal("1500.50"),
        recognizedTotal: new Prisma.Decimal("0.00"),
        createdBy: USER_A,
      },
    });
    expect(listA1.id).toBeDefined();
    expect(listA1.listNumber).toBe("L000001");

    // Tentativa de duplicar o mesmo listNumber no mesmo Workspace A deve falhar por @@unique
    await expect(
      prisma.paymentList.create({
        data: {
          workspaceId: WS_A,
          clientId: CLIENT_A,
          clientName: "Client Alpha",
          listNumber: "L000001",
          currencyCode: "EUR",
          createdBy: USER_A,
        },
      })
    ).rejects.toMatchObject({ code: "P2002" });

    // Mesmo listNumber em Workspace B diferente DEVE ser aceito com sucesso
    const listB1 = await prisma.paymentList.create({
      data: {
        workspaceId: WS_B,
        clientId: CLIENT_B,
        clientName: "Client Bravo",
        listNumber: "L000001",
        currencyCode: "USD",
        createdBy: USER_A,
      },
    });
    expect(listB1.id).toBeDefined();
    expect(listB1.workspaceId).toBe(WS_B);
  });

  it("SCHEMA-TENANT-FK-01: Composite Foreign Keys impedem cross-tenant linkage em listas e itens", async () => {
    // 1. Tentar criar PaymentList associando Client de outro workspace (Client B no Workspace A)
    await expect(
      prisma.paymentList.create({
        data: {
          workspaceId: WS_A,
          clientId: CLIENT_B, // Client do Workspace B!
          clientName: "Cross Client",
          listNumber: "L000002",
          currencyCode: "EUR",
          createdBy: USER_A,
        },
      })
    ).rejects.toMatchObject({ code: "P2003" });

    // 2. Criar PaymentList válida no Workspace A
    const validListA = await prisma.paymentList.create({
      data: {
        workspaceId: WS_A,
        clientId: CLIENT_A,
        clientName: "Client Alpha",
        listNumber: "L000003",
        currencyCode: "EUR",
        createdBy: USER_A,
      },
    });

    // 3. Tentar criar PaymentListItem no Workspace B apontando para a lista do Workspace A
    await expect(
      prisma.paymentListItem.create({
        data: {
          workspaceId: WS_B, // Tenant B
          paymentListId: validListA.id, // Lista do Tenant A!
          servicesSnapshot: [],
          totalAmount: new Prisma.Decimal("100.00"),
        },
      })
    ).rejects.toThrow();
  });

  it("SCHEMA-CLAIM-UNIQUE-01: Partial Unique Index impede duplo claim ativo ('reserved' ou 'consumed')", async () => {
    // Criar Weeklog e WeeklogEntry para testar claims
    const weeklog = await prisma.weeklog.create({
      data: {
        workspaceId: WS_A,
        clientId: CLIENT_A,
        startsOn: new Date("2026-09-01T00:00:00Z"),
        endsOn: new Date("2026-09-07T23:59:59Z"),
        siteKey: "site-schema-test",
        week: "W36",
        weekNumber: 36,
        yearReference: 2026,
        status: "validated",
      },
    });

    const po = await prisma.productionOrder.create({
      data: {
        workspaceId: WS_A,
        code: "PO-SCHEMA-001",
        status: "delivered",
        createdBy: USER_A,
      },
    });

    const entry = await prisma.weeklogEntry.create({
      data: {
        workspaceId: WS_A,
        weeklogId: weeklog.id,
        productionOrderId: po.id,
        executionSequence: 1,
        clientId: CLIENT_A,
        technicianUserId: USER_A,
        technicianName: "Tech Test",
        currencyCode: "EUR",
        deliveredAt: new Date(),
        validationStatus: "approved",
      },
    });

    const list1 = await prisma.paymentList.create({
      data: {
        workspaceId: WS_A,
        clientId: CLIENT_A,
        clientName: "Client Alpha",
        listNumber: "L000010",
        currencyCode: "EUR",
        createdBy: USER_A,
      },
    });

    const list2 = await prisma.paymentList.create({
      data: {
        workspaceId: WS_A,
        clientId: CLIENT_A,
        clientName: "Client Alpha",
        listNumber: "L000020",
        currencyCode: "EUR",
        createdBy: USER_A,
      },
    });

    // 1. Claim 1: Reservar a entry na Lista 1 (status = 'reserved')
    const claim1 = await prisma.paymentListEntryClaim.create({
      data: {
        workspaceId: WS_A,
        paymentListId: list1.id,
        weeklogEntryId: entry.id,
        status: "reserved",
      },
    });
    expect(claim1.id).toBeDefined();

    // 2. Tentativa de criar segundo claim com status 'reserved' para a mesma entry deve falhar pelo partial index
    await expect(
      prisma.paymentListEntryClaim.create({
        data: {
          workspaceId: WS_A,
          paymentListId: list2.id,
          weeklogEntryId: entry.id,
          status: "reserved",
        },
      })
    ).rejects.toThrow();

    // 3. Tentativa de criar claim com status 'consumed' também colide no partial index
    await expect(
      prisma.paymentListEntryClaim.create({
        data: {
          workspaceId: WS_A,
          paymentListId: list2.id,
          weeklogEntryId: entry.id,
          status: "consumed",
          consumedAt: new Date(),
        },
      })
    ).rejects.toThrow();

    // 4. Se a claim 1 for liberada ('released'), criar nova claim ativa passa a ser aceito
    await prisma.paymentListEntryClaim.update({
      where: { id: claim1.id },
      data: {
        status: "released",
        releasedAt: new Date(),
        releasedReason: "Liberada para teste",
      },
    });

    const claim2 = await prisma.paymentListEntryClaim.create({
      data: {
        workspaceId: WS_A,
        paymentListId: list2.id,
        weeklogEntryId: entry.id,
        status: "reserved",
      },
    });
    expect(claim2.id).toBeDefined();
    expect(claim2.status).toBe("reserved");
  });

  it("SCHEMA-CLAIM-CHECK-01: CHECK constraints validam status e coerência de ciclo de vida de claim", async () => {
    const list = await prisma.paymentList.findFirstOrThrow({
      where: { workspaceId: WS_A },
    });
    const entry = await prisma.weeklogEntry.findFirstOrThrow({
      where: { workspaceId: WS_A },
    });

    // 1. Status inválido deve falhar por CHECK constraint
    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "payment_list_entry_claims" ("id", "workspace_id", "payment_list_id", "weeklog_entry_id", "status", "claimed_at")
        VALUES (gen_random_uuid()::text, '${WS_A}', '${list.id}', '${entry.id}', 'invalid_status', NOW())
      `)
    ).rejects.toThrow();

    // 2. Status 'reserved' com 'consumed_at' preenchido deve falhar por lifecycle CHECK
    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "payment_list_entry_claims" ("id", "workspace_id", "payment_list_id", "weeklog_entry_id", "status", "claimed_at", "consumed_at")
        VALUES (gen_random_uuid()::text, '${WS_A}', '${list.id}', '${entry.id}', 'reserved', NOW(), NOW())
      `)
    ).rejects.toThrow();
  });

  it("SCHEMA-CLAIM-LIFECYCLE-CHECK-02: claim released rejeita consumed_at simultâneo", async () => {
    const list = await prisma.paymentList.findFirstOrThrow({
      where: { workspaceId: WS_A },
    });
    const entry = await prisma.weeklogEntry.findFirstOrThrow({
      where: { workspaceId: WS_A },
    });

    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "payment_list_entry_claims"
        ("id", "workspace_id", "payment_list_id", "weeklog_entry_id", "status", "claimed_at", "consumed_at", "released_at")
        VALUES (gen_random_uuid()::text, '${WS_A}', '${list.id}', '${entry.id}', 'released', NOW(), NOW(), NOW())
      `)
    ).rejects.toThrow();
  });

  it("SCHEMA-CONFRONT-RUN-UNIQUE-01: @@unique([paymentListId, sequence]) versiona rodadas de confronto", async () => {
    const list = await prisma.paymentList.findFirstOrThrow({
      where: { workspaceId: WS_A },
    });

    // Cria run com sequence 1
    const run1 = await prisma.paymentListConfrontationRun.create({
      data: {
        workspaceId: WS_A,
        paymentListId: list.id,
        sequence: 1,
        status: "started",
      },
    });
    expect(run1.id).toBeDefined();
    expect(run1.sequence).toBe(1);

    // Tentativa de duplicar sequence 1 na mesma lista deve falhar
    await expect(
      prisma.paymentListConfrontationRun.create({
        data: {
          workspaceId: WS_A,
          paymentListId: list.id,
          sequence: 1,
          status: "started",
        },
      })
    ).rejects.toThrow();

    // Sequência 2 deve ser aceita normalmente
    const run2 = await prisma.paymentListConfrontationRun.create({
      data: {
        workspaceId: WS_A,
        paymentListId: list.id,
        sequence: 2,
        status: "started",
      },
    });
    expect(run2.sequence).toBe(2);
  });

  it("SCHEMA-CONFRONT-RUN-TENANT-FK-01: FK composta impede associar run de outra lista/tenant", async () => {
    const listA = await prisma.paymentList.findFirstOrThrow({
      where: { workspaceId: WS_A },
    });
    const runA = await prisma.paymentListConfrontationRun.findFirstOrThrow({
      where: { paymentListId: listA.id },
    });
    const listB = await prisma.paymentList.create({
      data: {
        workspaceId: WS_B,
        clientId: CLIENT_B,
        clientName: "Client Bravo",
        listNumber: "L000030",
        currencyCode: "USD",
        createdBy: USER_A,
      },
    });
    const itemB = await prisma.paymentListItem.create({
      data: {
        workspaceId: WS_B,
        paymentListId: listB.id,
        servicesSnapshot: [],
        totalAmount: new Prisma.Decimal("75.00"),
      },
    });

    await expect(
      prisma.paymentListConfrontationResult.create({
        data: {
          workspaceId: WS_B,
          paymentListId: listB.id,
          runId: runA.id,
          paymentListItemId: itemB.id,
          status: "not_evaluated",
        },
      })
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("SCHEMA-CONFRONT-AMBIGUOUS-STATUS-01: ambiguidade possui estado canônico persistível", async () => {
    const list = await prisma.paymentList.findFirstOrThrow({
      where: { workspaceId: WS_A },
    });
    const run = await prisma.paymentListConfrontationRun.create({
      data: {
        workspaceId: WS_A,
        paymentListId: list.id,
        sequence: 99,
        status: "completed",
      },
    });
    const item = await prisma.paymentListItem.create({
      data: {
        workspaceId: WS_A,
        paymentListId: list.id,
        servicesSnapshot: [{ name: "PDR" }],
        totalAmount: new Prisma.Decimal("120.00"),
      },
    });

    const result = await prisma.paymentListConfrontationResult.create({
      data: {
        workspaceId: WS_A,
        paymentListId: list.id,
        runId: run.id,
        paymentListItemId: item.id,
        status: "ambiguous_match",
      },
    });

    expect(result.status).toBe("ambiguous_match");
  });

  it("SCHEMA-CONFRONT-PAIR-UNIQUE-01: Unicidade de pareamento por run e CHECK de item/entry obrigatório", async () => {
    const list = await prisma.paymentList.findFirstOrThrow({
      where: { workspaceId: WS_A },
    });
    const run = await prisma.paymentListConfrontationRun.findFirstOrThrow({
      where: { paymentListId: list.id },
    });
    const entry = await prisma.weeklogEntry.findFirstOrThrow({
      where: { workspaceId: WS_A },
    });

    const listItem = await prisma.paymentListItem.create({
      data: {
        workspaceId: WS_A,
        paymentListId: list.id,
        servicesSnapshot: [],
        totalAmount: new Prisma.Decimal("250.00"),
      },
    });

    // 1. Inserir resultado com ambos (listItemId e entryId) nulos deve falhar por CHECK constraint
    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "payment_list_confrontation_results" 
        ("id", "workspace_id", "payment_list_id", "run_id", "status", "decision", "difference_amount", "created_at", "updated_at")
        VALUES (gen_random_uuid()::text, '${WS_A}', '${list.id}', '${run.id}', 'not_evaluated', 'none', 0.00, NOW(), NOW())
      `)
    ).rejects.toThrow();

    // 2. Parear listItem com entry na run
    const result1 = await prisma.paymentListConfrontationResult.create({
      data: {
        workspaceId: WS_A,
        paymentListId: list.id,
        runId: run.id,
        paymentListItemId: listItem.id,
        weeklogEntryId: entry.id,
        status: "exact_match",
      },
    });
    expect(result1.id).toBeDefined();

    // 3. Tentar parear o MESMO listItem novamente na MESMA run deve falhar pelo partial index unique_run_payment_list_item
    await expect(
      prisma.paymentListConfrontationResult.create({
        data: {
          workspaceId: WS_A,
          paymentListId: list.id,
          runId: run.id,
          paymentListItemId: listItem.id,
          status: "not_evaluated",
        },
      })
    ).rejects.toThrow();

    // 4. Tentar parear a MESMA entry novamente na MESMA run deve falhar pelo partial index unique_run_weeklog_entry
    await expect(
      prisma.paymentListConfrontationResult.create({
        data: {
          workspaceId: WS_A,
          paymentListId: list.id,
          runId: run.id,
          weeklogEntryId: entry.id,
          status: "not_evaluated",
        },
      })
    ).rejects.toThrow();
  });

  it("SCHEMA-EXTERNAL-WEEKLOG-XOR-01: CHECK XOR exige produção OU importação externa exclusivamente", async () => {
    const weeklog = await prisma.weeklog.findFirstOrThrow({
      where: { workspaceId: WS_A },
    });
    const po = await prisma.productionOrder.findFirstOrThrow({
      where: { workspaceId: WS_A },
    });

    const opImport = await prisma.externalOperationalImport.create({
      data: {
        workspaceId: WS_A,
        fileName: "sheet.xlsx",
        storagePath: "tenants/ws-a/imports/sheet.xlsx",
        fileSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: 1024,
        uploadedBy: USER_A,
      },
    });

    const importItem = await prisma.externalOperationalImportItem.create({
      data: {
        workspaceId: WS_A,
        importId: opImport.id,
        rawCarName: "Toyota Corolla",
        reviewedTotal: new Prisma.Decimal("300.00"),
      },
    });

    // 1. Inválido: sourceType = 'production_order' mas productionOrderId é NULL
    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "weeklog_entries" 
        ("id", "workspace_id", "weeklog_id", "source_type", "production_order_id", "client_id", "technician_user_id", "technician_name", "currency_code", "delivered_at", "services_snapshot", "total_amount", "created_at", "updated_at")
        VALUES (gen_random_uuid()::text, '${WS_A}', '${weeklog.id}', 'production_order', NULL, '${CLIENT_A}', '${USER_A}', 'Tech', 'EUR', NOW(), '[]', 0.00, NOW(), NOW())
      `)
    ).rejects.toThrow();

    // 2. Inválido: sourceType = 'production_order' com external_import_item_id preenchido
    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "weeklog_entries" 
        ("id", "workspace_id", "weeklog_id", "source_type", "production_order_id", "external_import_item_id", "client_id", "technician_user_id", "technician_name", "currency_code", "delivered_at", "services_snapshot", "total_amount", "created_at", "updated_at")
        VALUES (gen_random_uuid()::text, '${WS_A}', '${weeklog.id}', 'production_order', '${po.id}', '${importItem.id}', '${CLIENT_A}', '${USER_A}', 'Tech', 'EUR', NOW(), '[]', 0.00, NOW(), NOW())
      `)
    ).rejects.toThrow();

    // 3. Inválido: sourceType = 'external_import' com production_order_id preenchido
    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "weeklog_entries" 
        ("id", "workspace_id", "weeklog_id", "source_type", "production_order_id", "external_import_item_id", "client_id", "technician_user_id", "technician_name", "currency_code", "delivered_at", "services_snapshot", "total_amount", "created_at", "updated_at")
        VALUES (gen_random_uuid()::text, '${WS_A}', '${weeklog.id}', 'external_import', '${po.id}', '${importItem.id}', '${CLIENT_A}', '${USER_A}', 'Tech', 'EUR', NOW(), '[]', 0.00, NOW(), NOW())
      `)
    ).rejects.toThrow();

    // 4. Válido: sourceType = 'external_import' com production_order_id NULL e external_import_item_id preenchido
    const validExternalEntry = await prisma.weeklogEntry.create({
      data: {
        workspaceId: WS_A,
        weeklogId: weeklog.id,
        sourceType: "external_import",
        productionOrderId: null,
        externalImportItemId: importItem.id,
        clientId: CLIENT_A,
        technicianUserId: USER_A,
        technicianName: "External Tech",
        currencyCode: "EUR",
        deliveredAt: new Date(),
        validationStatus: "approved",
      },
    });
    expect(validExternalEntry.id).toBeDefined();
    expect(validExternalEntry.sourceType).toBe("external_import");
    expect(validExternalEntry.productionOrderId).toBeNull();
    expect(validExternalEntry.externalImportItemId).toBe(importItem.id);
  });

  it("SCHEMA-EXTERNAL-ITEM-UNIQUE-01: unique_external_import_item_entry impede materializar entry duplicada", async () => {
    const weeklog = await prisma.weeklog.findFirstOrThrow({
      where: { workspaceId: WS_A },
    });
    const importItem = await prisma.externalOperationalImportItem.findFirstOrThrow({
      where: { workspaceId: WS_A },
    });

    // importItem já foi materializado no teste anterior. Tentativa de associar a uma segunda entry deve violar a constraint
    await expect(
      prisma.weeklogEntry.create({
        data: {
          workspaceId: WS_A,
          weeklogId: weeklog.id,
          sourceType: "external_import",
          productionOrderId: null,
          externalImportItemId: importItem.id,
          clientId: CLIENT_A,
          technicianUserId: USER_A,
          technicianName: "Second Tech",
          currencyCode: "EUR",
          deliveredAt: new Date(),
        },
      })
    ).rejects.toThrow();
  });

  it("SCHEMA-EXTERNAL-ITEM-TENANT-FK-01: FK composta impede item externo cross-tenant", async () => {
    const operationalImportA = await prisma.externalOperationalImport.findFirstOrThrow({
      where: { workspaceId: WS_A },
    });
    const importItemA = await prisma.externalOperationalImportItem.create({
      data: {
        workspaceId: WS_A,
        importId: operationalImportA.id,
        rawCarName: "Cross Tenant Candidate",
        reviewedTotal: new Prisma.Decimal("90.00"),
      },
    });
    const weeklogB = await prisma.weeklog.create({
      data: {
        workspaceId: WS_B,
        clientId: CLIENT_B,
        startsOn: new Date("2026-10-05T00:00:00Z"),
        endsOn: new Date("2026-10-11T23:59:59Z"),
        siteKey: "site-cross-tenant-external",
        week: "W41",
        weekNumber: 41,
        yearReference: 2026,
        status: "validated",
      },
    });

    await expect(
      prisma.weeklogEntry.create({
        data: {
          workspaceId: WS_B,
          weeklogId: weeklogB.id,
          sourceType: "external_import",
          productionOrderId: null,
          externalImportItemId: importItemA.id,
          clientId: CLIENT_B,
          technicianUserId: USER_A,
          technicianName: "Cross Tenant Tech",
          currencyCode: "USD",
          deliveredAt: new Date(),
        },
      })
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("SCHEMA-MONEY-DECIMAL-01: Campos monetários são Decimal(12,2) e preservam precisão exata", async () => {
    const list = await prisma.paymentList.create({
      data: {
        workspaceId: WS_A,
        clientId: CLIENT_A,
        clientName: "Client Alpha",
        listNumber: "L000099",
        currencyCode: "EUR",
        sourceDocumentTotal: new Prisma.Decimal("123456789.99"),
        recognizedTotal: new Prisma.Decimal("123456789.98"),
        createdBy: USER_A,
      },
    });

    const item = await prisma.paymentListItem.create({
      data: {
        workspaceId: WS_A,
        paymentListId: list.id,
        servicesSnapshot: [],
        totalAmount: new Prisma.Decimal("9876543.21"),
      },
    });

    expect(list.sourceDocumentTotal.toString()).toBe("123456789.99");
    expect(list.recognizedTotal.toString()).toBe("123456789.98");
    expect(item.totalAmount.toString()).toBe("9876543.21");
  });

  it("SCHEMA-SEQUENCE-COUNTER-01: TenantSequenceCounter com @@unique([workspaceId, sequenceType])", async () => {
    const counter = await prisma.tenantSequenceCounter.create({
      data: {
        workspaceId: WS_A,
        sequenceType: "payment_list",
        currentValue: 42,
      },
    });
    expect(counter.currentValue).toBe(42);

    // Duplicar mesmo workspace e sequenceType deve falhar
    await expect(
      prisma.tenantSequenceCounter.create({
        data: {
          workspaceId: WS_A,
          sequenceType: "payment_list",
          currentValue: 43,
        },
      })
    ).rejects.toThrow();

    // Outro sequenceType no mesmo workspace é aceito
    const otherCounter = await prisma.tenantSequenceCounter.create({
      data: {
        workspaceId: WS_A,
        sequenceType: "other_counter",
        currentValue: 1,
      },
    });
    expect(otherCounter.currentValue).toBe(1);
  });

  it("EXTERNAL-WEEKLOG-NO-PO-RECTIFICATION-GUARD-01: retificação mantém guard explícito sem implementar fluxo externo", () => {
    const source = readFileSync(
      resolve(process.cwd(), "backend/src/services/weeklogService.ts"),
      "utf8"
    );
    const rectifySource = source.slice(source.indexOf("export async function rectifyWeeklogEntry"));

    expect(rectifySource).toContain("if (!currentEntry.productionOrderId)");
    expect(rectifySource).toContain(
      'throw new NotFoundError("Entrada não possui ordem de produção vinculada.")'
    );
    expect(rectifySource.indexOf("if (!currentEntry.productionOrderId)")).toBeLessThan(
      rectifySource.indexOf("const currentPo = await tx.productionOrder.findUniqueOrThrow")
    );
    expect(rectifySource).not.toContain("externalOperationalImport.create");
    expect(rectifySource).not.toContain("productionOrder.create");
  });

  it("SCHEMA-EXISTING-WEEKLOG-UPGRADE-01: replay preserva dados Spec003 reais e não vazios", async () => {
    const schemaName = `spec004_upgrade_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const baseDatabaseUrl =
      process.env.DATABASE_URL ??
      "postgresql://operix_local:U2dkA-cJYnwHuD7hiAY2hPTrkawjg6f8@127.0.0.1:55432/operix_local?schema=public";
    const upgradeUrl = new URL(baseDatabaseUrl);
    upgradeUrl.searchParams.set("schema", schemaName);

    const tempRoot = mkdtempSync(join(tmpdir(), "operix-spec004-upgrade-"));
    const tempPrisma = join(tempRoot, "prisma");
    const tempMigrations = join(tempPrisma, "migrations");
    const sourcePrisma = resolve(process.cwd(), "backend/prisma");
    const schemaPath = join(tempPrisma, "schema.prisma");
    let upgrade: PrismaClient | undefined;

    mkdirSync(tempMigrations, { recursive: true });
    cpSync(join(sourcePrisma, "schema.prisma"), schemaPath);
    cpSync(join(sourcePrisma, "migrations", "migration_lock.toml"), join(tempMigrations, "migration_lock.toml"));
    for (const migration of PRE_SPEC004_MIGRATIONS) {
      cpSync(join(sourcePrisma, "migrations", migration), join(tempMigrations, migration), {
        recursive: true,
      });
    }

    await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);

    try {
      deployMigrations(schemaPath, upgradeUrl.toString());
      upgrade = new PrismaClient({
        datasources: { db: { url: upgradeUrl.toString() } },
      });

      const fixture = {
        workspaceId: "61000000-0000-4000-8000-000000000001",
        clientId: "61000000-0000-4000-8000-000000000002",
        userId: "61000000-0000-4000-8000-000000000003",
        appUserId: "61000000-0000-4000-8000-000000000004",
        productionOrderId: "61000000-0000-4000-8000-000000000005",
        weeklogId: "61000000-0000-4000-8000-000000000006",
        entry1Id: "61000000-0000-4000-8000-000000000007",
        entry2Id: "61000000-0000-4000-8000-000000000008",
        validationId: "61000000-0000-4000-8000-000000000009",
      };

      await upgrade.$executeRawUnsafe(`
        INSERT INTO "users" ("id", "email", "password_hash", "full_name", "role", "updated_at")
        VALUES ('${fixture.userId}', 'upgrade.tech@operix.local', 'hash', 'Upgrade Technician', 'technician', NOW())
      `);
      await upgrade.$executeRawUnsafe(`
        INSERT INTO "app_users" ("id", "auth_user_id", "email", "name")
        VALUES ('${fixture.appUserId}', '${fixture.userId}', 'upgrade.tech@operix.local', 'Upgrade Technician')
      `);
      await upgrade.$executeRawUnsafe(`
        INSERT INTO "workspaces" ("id", "name", "owner_user_id", "type", "timezone")
        VALUES ('${fixture.workspaceId}', 'Upgrade Workspace', '${fixture.appUserId}', 'company', 'Europe/Lisbon')
      `);
      await upgrade.$executeRawUnsafe(`
        INSERT INTO "clients" ("id", "workspace_id", "name", "updated_at")
        VALUES ('${fixture.clientId}', '${fixture.workspaceId}', 'Upgrade Client', NOW())
      `);
      await upgrade.$executeRawUnsafe(`
        INSERT INTO "production_orders"
          ("id", "workspace_id", "code", "client_id", "client_name", "technician_user_id", "technician_name",
           "status", "execution_sequence", "currency_code", "performed_services", "delivered_at", "created_by", "updated_at")
        VALUES
          ('${fixture.productionOrderId}', '${fixture.workspaceId}', 'PO-UPGRADE-001', '${fixture.clientId}', 'Upgrade Client',
           '${fixture.userId}', 'Upgrade Technician', 'delivered', 2, 'EUR', '[{"code":"PDR","amount":"150.25"}]'::jsonb,
           '2026-09-16T12:00:00Z', '${fixture.userId}', NOW())
      `);
      await upgrade.$executeRawUnsafe(`
        INSERT INTO "weeklogs"
          ("id", "workspace_id", "starts_on", "ends_on", "client_id", "site_key", "timezone", "week", "week_number", "year_reference", "status", "updated_at")
        VALUES
          ('${fixture.weeklogId}', '${fixture.workspaceId}', '2026-09-14T00:00:00Z', '2026-09-20T23:59:59Z',
           '${fixture.clientId}', 'upgrade-site', 'Europe/Lisbon', 'W38', 38, 2026, 'validated', NOW())
      `);
      await upgrade.$executeRawUnsafe(`
        INSERT INTO "weeklog_entries"
          ("id", "weeklog_id", "workspace_id", "production_order_id", "execution_sequence", "technician_user_id", "technician_name",
           "client_id", "client_name", "license_plate", "services_snapshot", "total_amount", "currency_code", "delivered_at",
           "validation_status", "reviewed_at", "reviewer_user_id", "is_rectification", "updated_at")
        VALUES
          ('${fixture.entry1Id}', '${fixture.weeklogId}', '${fixture.workspaceId}', '${fixture.productionOrderId}', 1,
           '${fixture.userId}', 'Upgrade Technician', '${fixture.clientId}', 'Upgrade Client', 'AA-11-BB',
           '[{"code":"PDR","quantity":1,"unitPrice":"100.10"}]'::jsonb, 100.10, 'EUR', '2026-09-15T12:00:00Z',
           'rectification_requested', '2026-09-16T09:00:00Z', '${fixture.userId}', false, NOW())
      `);
      await upgrade.$executeRawUnsafe(`
        INSERT INTO "weeklog_entries"
          ("id", "weeklog_id", "workspace_id", "production_order_id", "execution_sequence", "technician_user_id", "technician_name",
           "client_id", "client_name", "license_plate", "services_snapshot", "total_amount", "currency_code", "delivered_at",
           "validation_status", "reviewed_at", "reviewer_user_id", "is_rectification", "rectification_origin_entry_id", "updated_at")
        VALUES
          ('${fixture.entry2Id}', '${fixture.weeklogId}', '${fixture.workspaceId}', '${fixture.productionOrderId}', 2,
           '${fixture.userId}', 'Upgrade Technician', '${fixture.clientId}', 'Upgrade Client', 'AA-11-BB',
           '[{"code":"PDR","quantity":1,"unitPrice":"150.25"}]'::jsonb, 150.25, 'EUR', '2026-09-16T12:00:00Z',
           'approved', '2026-09-17T09:00:00Z', '${fixture.userId}', true, '${fixture.entry1Id}', NOW())
      `);
      await upgrade.$executeRawUnsafe(`
        UPDATE "production_orders"
        SET "rectification_origin_id" = '${fixture.entry1Id}'
        WHERE "id" = '${fixture.productionOrderId}'
      `);

      const coverageSnapshot = JSON.stringify([
        {
          weeklogEntryId: fixture.entry1Id,
          productionOrderId: fixture.productionOrderId,
          executionSequence: 1,
          validationStatus: "rectification_requested",
        },
        {
          weeklogEntryId: fixture.entry2Id,
          productionOrderId: fixture.productionOrderId,
          executionSequence: 2,
          validationStatus: "approved",
        },
      ]).replaceAll("'", "''");
      await upgrade.$executeRawUnsafe(`
        INSERT INTO "weeklog_validations"
          ("id", "weeklog_id", "workspace_id", "validation_sequence", "status", "submitted_at", "submitted_by",
           "validator_user_id", "validation_method", "coverage_snapshot", "audit_trail", "validated_at")
        VALUES
          ('${fixture.validationId}', '${fixture.weeklogId}', '${fixture.workspaceId}', 1, 'validated', NULL, NULL,
           '${fixture.userId}', 'manual_signature', '${coverageSnapshot}'::jsonb,
           '[{"action":"validation_completed","actor":"upgrade-fixture"}]'::jsonb, '2026-09-17T09:00:00Z')
      `);

      const beforeCounts = await upgrade.$queryRawUnsafe<Array<{
        productionOrders: number;
        weeklogs: number;
        entries: number;
        validations: number;
      }>>(`
        SELECT
          (SELECT COUNT(*)::int FROM "production_orders") AS "productionOrders",
          (SELECT COUNT(*)::int FROM "weeklogs") AS "weeklogs",
          (SELECT COUNT(*)::int FROM "weeklog_entries") AS "entries",
          (SELECT COUNT(*)::int FROM "weeklog_validations") AS "validations"
      `);
      const beforeEntries = await upgrade.$queryRawUnsafe<Array<Record<string, unknown>>>(`
        SELECT "id", "production_order_id" AS "productionOrderId", "execution_sequence" AS "executionSequence",
               "rectification_origin_entry_id" AS "rectificationOriginEntryId", "validation_status" AS "validationStatus",
               "total_amount"::text AS "totalAmount", "services_snapshot" AS "servicesSnapshot",
               "services_snapshot"::text AS "servicesSnapshotText"
        FROM "weeklog_entries"
        ORDER BY "execution_sequence"
      `);
      const beforeProductionOrder = await upgrade.$queryRawUnsafe<Array<Record<string, unknown>>>(`
        SELECT "id", "workspace_id" AS "workspaceId", "execution_sequence" AS "executionSequence",
               "rectification_origin_id" AS "rectificationOriginEntryId", "performed_services" AS "performedServices",
               "performed_services"::text AS "performedServicesText"
        FROM "production_orders"
        WHERE "id" = '${fixture.productionOrderId}'
      `);
      const beforeValidation = await upgrade.$queryRawUnsafe<Array<Record<string, unknown>>>(`
        SELECT "id", "weeklog_id" AS "weeklogId", "workspace_id" AS "workspaceId", "status",
               "validation_sequence" AS "validationSequence", "submitted_at" AS "submittedAt", "submitted_by" AS "submittedBy",
               "validator_user_id" AS "validatorUserId", "validation_method" AS "validationMethod",
               "signature_storage_path" AS "signatureStoragePath", "coverage_snapshot" AS "coverageSnapshot",
               "coverage_snapshot"::text AS "coverageSnapshotText", "audit_trail" AS "auditTrail", "validated_at" AS "validatedAt"
        FROM "weeklog_validations"
      `);

      expect(beforeCounts[0]).toEqual({
        productionOrders: 1,
        weeklogs: 1,
        entries: 2,
        validations: 1,
      });

      for (const migration of SPEC004_MIGRATIONS) {
        cpSync(join(sourcePrisma, "migrations", migration), join(tempMigrations, migration), {
          recursive: true,
        });
      }
      deployMigrations(schemaPath, upgradeUrl.toString());

      const afterCounts = await upgrade.$queryRawUnsafe<Array<{
        productionOrders: number;
        weeklogs: number;
        entries: number;
        validations: number;
      }>>(`
        SELECT
          (SELECT COUNT(*)::int FROM "production_orders") AS "productionOrders",
          (SELECT COUNT(*)::int FROM "weeklogs") AS "weeklogs",
          (SELECT COUNT(*)::int FROM "weeklog_entries") AS "entries",
          (SELECT COUNT(*)::int FROM "weeklog_validations") AS "validations"
      `);
      const afterEntries = await upgrade.$queryRawUnsafe<Array<Record<string, unknown>>>(`
        SELECT "id", "production_order_id" AS "productionOrderId", "source_type" AS "sourceType",
               "external_import_item_id" AS "externalImportItemId", "execution_sequence" AS "executionSequence",
               "rectification_origin_entry_id" AS "rectificationOriginEntryId", "validation_status" AS "validationStatus",
               "total_amount"::text AS "totalAmount", "services_snapshot" AS "servicesSnapshot",
               "services_snapshot"::text AS "servicesSnapshotText"
        FROM "weeklog_entries"
        ORDER BY "execution_sequence"
      `);
      const afterProductionOrder = await upgrade.$queryRawUnsafe<Array<Record<string, unknown>>>(`
        SELECT "id", "workspace_id" AS "workspaceId", "execution_sequence" AS "executionSequence",
               "rectification_origin_id" AS "rectificationOriginEntryId", "performed_services" AS "performedServices",
               "performed_services"::text AS "performedServicesText"
        FROM "production_orders"
        WHERE "id" = '${fixture.productionOrderId}'
      `);
      const afterValidation = await upgrade.$queryRawUnsafe<Array<Record<string, unknown>>>(`
        SELECT "id", "weeklog_id" AS "weeklogId", "workspace_id" AS "workspaceId", "status",
               "validation_sequence" AS "validationSequence", "submitted_at" AS "submittedAt", "submitted_by" AS "submittedBy",
               "validator_user_id" AS "validatorUserId", "validation_method" AS "validationMethod",
               "signature_storage_path" AS "signatureStoragePath", "coverage_snapshot" AS "coverageSnapshot",
               "coverage_snapshot"::text AS "coverageSnapshotText", "audit_trail" AS "auditTrail", "validated_at" AS "validatedAt"
        FROM "weeklog_validations"
      `);
      const xorAudit = await upgrade.$queryRawUnsafe<Array<{ validRows: number }>>(`
        SELECT COUNT(*)::int AS "validRows"
        FROM "weeklog_entries"
        WHERE
          ("source_type" = 'production_order' AND "production_order_id" IS NOT NULL AND "external_import_item_id" IS NULL)
          OR
          ("source_type" = 'external_import' AND "production_order_id" IS NULL AND "external_import_item_id" IS NOT NULL)
      `);
      const appliedMigrations = await upgrade.$queryRawUnsafe<Array<{ migrationName: string }>>(`
        SELECT "migration_name" AS "migrationName"
        FROM "_prisma_migrations"
        WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
        ORDER BY "migration_name"
      `);

      expect(afterCounts[0]).toEqual(beforeCounts[0]);
      expect(afterEntries.map(({ sourceType: _sourceType, externalImportItemId: _externalImportItemId, ...entry }) => entry))
        .toEqual(beforeEntries);
      expect(afterEntries.every((entry) => entry.sourceType === "production_order")).toBe(true);
      expect(afterEntries.every((entry) => entry.externalImportItemId === null)).toBe(true);
      expect(afterProductionOrder).toEqual(beforeProductionOrder);
      expect(afterValidation).toEqual(beforeValidation);
      expect(xorAudit[0].validRows).toBe(2);
      expect(appliedMigrations.map((migration) => migration.migrationName)).toEqual([
        ...PRE_SPEC004_MIGRATIONS,
        ...SPEC004_MIGRATIONS,
      ]);
    } finally {
      await upgrade?.$disconnect();
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("SCHEMA-LEGACY-PRESERVED-01: Tabelas legadas permanecem preservadas e funcionais", async () => {
    const paymentOrdersCount = await prisma.paymentOrder.count();
    expect(paymentOrdersCount).toBeGreaterThanOrEqual(0);

    const productionListsCount = await prisma.productionList.count();
    expect(productionListsCount).toBeGreaterThanOrEqual(0);

    const reconciliationsCount = await prisma.reconciliation.count();
    expect(reconciliationsCount).toBeGreaterThanOrEqual(0);

    const financialRecordsCount = await prisma.financialRecord.count();
    expect(financialRecordsCount).toBeGreaterThanOrEqual(0);
  });

  it("SCHEMA-MIGRATION-REPLAY-01: Migrations da Spec 004 estão registradas com sucesso no catálogo", async () => {
    const applied: Array<{ migration_name: string; finished_at: Date }> = await prisma.$queryRawUnsafe(`
      SELECT migration_name, finished_at 
      FROM "_prisma_migrations" 
      WHERE migration_name IN (
        '20260921120000_spec004_payment_list_domain',
        '20260921130000_spec004_relational_hardening'
      )
      ORDER BY migration_name
    `);
    expect(applied.map((migration) => migration.migration_name)).toEqual([
      "20260921120000_spec004_payment_list_domain",
      "20260921130000_spec004_relational_hardening",
    ]);
    expect(applied.every((migration) => migration.finished_at !== null)).toBe(true);
  });
});
