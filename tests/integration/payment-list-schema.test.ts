// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "../../backend/src/lib/prisma.js";
import { Prisma } from "../../backend/node_modules/@prisma/client/index.js";

const WS_A = "50000000-0000-4000-8000-000000000001";
const WS_B = "50000000-0000-4000-8000-000000000002";
const CLIENT_A = "51000000-0000-4000-8000-000000000001";
const CLIENT_B = "51000000-0000-4000-8000-000000000002";
const USER_A = "52000000-0000-4000-8000-000000000001";
const APP_USER_A = "53000000-0000-4000-8000-000000000001";

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
    ).rejects.toThrow();

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
    ).rejects.toThrow();

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

  it("SCHEMA-MIGRATION-REPLAY-01: Migration de Spec 004 está registrada com sucesso no catálogo de migrações", async () => {
    const applied: Array<{ migration_name: string; finished_at: Date }> = await prisma.$queryRawUnsafe(`
      SELECT migration_name, finished_at 
      FROM "_prisma_migrations" 
      WHERE migration_name LIKE '%spec004_payment_list_domain%'
    `);
    expect(applied.length).toBe(1);
    expect(applied[0].migration_name).toContain("spec004_payment_list_domain");
    expect(applied[0].finished_at).not.toBeNull();
  });
});
