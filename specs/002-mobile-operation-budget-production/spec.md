# Spec 002 — Mobile Operational Flow: Budget → Production (Final Cleanup)

**Status**: Implemented — Pending Independent Re-Review  
**Prioridade**: P1 (Core Operacional)  
**Fase de Engenharia**: R1  
**Data**: 2026-09-16  
**Branch de Trabalho**: `feat/002-mobile-operation-budget-production`  
**Base de Integração**: `develop/operix-core` (Spec 001 integrada)  

---

## 1. Contexto e Problema

O Operix gerencia o ciclo operacional automotivo para técnicos e oficinas de reparação e martelinho de ouro (PDR). A auditoria de segurança e integridade de dados (Fases 2, 4A e 5A) e a revisão técnica revelaram débitos arquiteturais severos:

1. **Orçamento Sem Persistência Canônica ([A4-02](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/docs/audit/stabilization-and-evolution-roadmap.md#L699))**: Os orçamentos vivem exclusivamente no `localStorage` do navegador sob a chave `budgets-local-v1`. Recarregar a página em outro dispositivo ou limpar os dados locais destrói os dados.
2. **Serialização em Texto Puro**: Ao aprovar, o orçamento é copiado como bloco de texto em `ProductionOrder.notes`. O sistema usa regexes frágeis para tentar ler valores e serviços.
3. **Ausência de Versionamento Auditável**: Não há versionamento relacional de orçamentos, o que impede auditoria ou gera risco de sobreposição destrutiva de dados acordados com clientes.
4. **Vulnerabilidades de Isolamento BOLA/IDOR ([S5A-003](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/docs/audit/security-performance-and-technical-debt.md#L44))**: Rotas de ordens de produção (`/api/production-orders`) e fotos (`/api/production-orders/:id/photos`) confiam em `workspace_id` vindo do cliente e não utilizam o `RequestContext`.
5. **Insegurança no Object Storage (MinIO)**: Uploads aceitam caminhos livres enviados pelo cliente, e downloads utilizam tokens JWT expostos na query string (`?token=`), sem validação server-side de pertencimento ao workspace.

---

## 2. Atores do Sistema

1. **Técnico Independente (*Personal Context*)**: Profissional autônomo que realiza inspeções, fotos, orçamentos e reparos diretamente para clientes finais sem intermediação corporativa. Opera em seu *Personal Workspace* canônico ([ADR-002](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/docs/adr/002-personal-workspace-lifecycle.md)).
2. **Técnico Vinculado (*Workspace Context*)**: Prestador ou colaborador de um Workspace corporativo. Possui `membershipRole: "technician"` e política `scope: "own"` — visualiza e executa estritamente suas próprias ordens e orçamentos atribuídos.
3. **Gestor / Administrador do Workspace**: Possui visibilidade operacional sobre todos os técnicos, clientes, orçamentos e ordens do seu tenant.
4. **Cliente Operacional**: Dono do veículo, frotista ou parceiro que solicita o serviço e aprova/assina o orçamento.

---

## 3. Current State vs. Target State

```mermaid
flowchart TD
    subgraph CurrentState["Estado Atual (Frágil)"]
        UI1["BudgetDialog / BudgetPanel"] -->|Grava JSON| LS["localStorage (budgets-local-v1)"]
        UI1 -->|Evento CustomEvent| PB["sendToProductionAsync"]
        PB -->|Dump de texto formatado| PONotes["ProductionOrder.notes\n(delimitadores regex)"]
        PONotes -->|Regex Parsing| WL["WEEKLOG generation"]
        UIPH1["PhotoUploader"] -->|Path livre do client| S3Raw["MinIO /storage/upload\n(Sem auth de tenant)"]
    end

    subgraph TargetState["Estado Alvo (Spec 002 Final)"]
        UI2["BudgetDialog (Mobile-First)"] -->|POST/PUT API| BT["Tabela 'budgets' (PostgreSQL)\ncurrentRevisionId / approvedRevisionId"]
        BT -->|1:N Versionamento| BR["Tabela 'budget_revisions'\n(Status por revisão: draft, approved...)"]
        BT -->|1:N Fotos Iniciais| BPH["Tabela 'budget_photos'\n(Inspection & Danos)"]
        BR -->|Aprovação Formal (1:0..1)| PO["Tabela 'production_orders'\n(budgetId @unique, composite FK)"]
        PO -->|Direct OP Flow| PODirect["ProductionOrder Direta\n(budgetId: null)"]
        UIPH2["PhotoUploader (Câmera)"] -->|Backend controlado| S3Auth["MinIO Storage\n(Keys UUIDs determinísticas / Presigned URLs)"]
        RequestContext["RequestContext Server-Side"] -->|Protege| BT
        RequestContext -->|Protege| PO
        RequestContext -->|Protege| S3Auth
    end
```

---

## 4. Invariantes de Negócio e Segurança

- **INV-001 (RequestContext Mandatório)**: Todos os objetos do fluxo (`Budget`, `BudgetRevision`, `BudgetPhoto`, `ProductionOrder`, `ProductionPhoto`, `Client`) obedecem estritamente a autorização baseada em `RequestContext` e `assertTenantAccess(ctx, resource.workspaceId)`.
- **INV-002 (Visibilidade do Técnico Vinculado)**: Um técnico com `membershipRole: "technician"` só acessa orçamentos e ordens atribuídos a si próprio (`scope = own`).
- **INV-003 (Técnico Independente)**: O técnico independente executa 100% do fluxo em seu Personal Workspace canônico ([ADR-002](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/docs/adr/002-personal-workspace-lifecycle.md)) sem necessitar de oficina intermediária.
- **INV-004 (Fim do `localStorage`)**: Nenhuma regra de negócio, lista de orçamentos, linha de peças ou aprovação depende de `localStorage` como fonte de verdade.
- **INV-005 (Fim das Notas Mágicas)**: Orçamentos não podem existir unicamente serializados como texto dentro de `ProductionOrder.notes`.
- **INV-006 (Imutabilidade da Revisão Aprovada)**: O payload de negócio de uma `BudgetRevision` com status `approved` é definitivamente imutável. Qualquer modificação posterior obrigatoriamente gera uma nova revisão com status `draft` (`revisionNumber + 1`), preservando a revisão aprovada intacta e auditável.
- **INV-007 (Ponteiros de Estado Canônicos)**: O agregador `Budget` aponta para a revisão ativa através de `currentRevisionId` e para a versão aprovada através de `approvedRevisionId`. Não há duplicação de coluna `status` no agregador.
- **INV-008 (Linhagem e Integridade Composta da Ordem)**: Uma `ProductionOrder` originada de orçamento armazena `budgetId` e `budgetRevisionId`. O PostgreSQL garante estruturalmente que `budgetRevisionId` pertença obrigatoriamente ao mesmo `budgetId` da ordem.
- **INV-009 (Ordem de Produção Direta)**: O fluxo de criação de `ProductionOrder` direta (sem orçamento prévio) é suportado com `budgetId = null`.
- **INV-010 (Ownership de Fotos com UUIDs Canônicos)**: As fotos possuem ownership por tenant e entidade no MinIO, com caminhos gerados no servidor baseados em UUIDs (`tenants/{workspaceId}/budgets/{budgetId}/{photoId}.jpg`) e URLs pré-assinadas com TTL de 15 minutos.
- **INV-011 (Resiliência a Recarregamento)**: Recarregar a página (F5), trocar de navegador ou alternar de dispositivo preserva 100% dos dados.
- **INV-012 (Rejeição de IDs Forjados)**: Parâmetros `workspace_id`, `technician_user_id` ou `created_by` enviados pelo cliente nunca constituem autorização e são validados ou rejeitados pelo `RequestContext`.
- **INV-013 (Cardinalidade Budget → ProductionOrder 1:0..1)**: Um `Budget` possui no máximo UMA `ProductionOrder` operacional (`budgetId @unique`). Re-aprovações de novas revisões com a OP aberta mantêm a **mesma** OP, atualizando apenas a whitelist permitida (`budgetRevisionId`, notas, veículo/cliente, plataforma, intervenções, data limite), sem sobrescrever status de execução, apontamento de técnico, prioridade ou fotos existentes.
- **INV-014 (Regra de Atribuição de Técnicos)**: Usuários com papel `technician` só podem atribuir orçamentos ou ordens a si mesmos (`TECH-ASSIGN-01`). Apenas `owner` ou `admin` podem atribuir outros técnicos membros do mesmo workspace (`TECH-ASSIGN-02`).
- **INV-015 (Neutralidade Monetária e Fiscal)**: Valores e alíquotas fiscais são persistidos com precisão decimal exata (`Decimal(12, 2)` e `Decimal(5, 2)`), suportando código de moeda ISO-4217 (`currencyCode: "EUR"`) e campos canônicos `taxPct` e `taxTotal`.

---

## 5. Requisitos Funcionais

### RF-001: Gestão Canônica de Clientes Operacionais em R1
- `GET /api/clients`: lista clientes do workspace ativo com busca textual por nome, telefone ou matrícula.
- `POST /api/clients`: cria cliente operacional associado ao `ctx.activeWorkspaceId`.
- Validação cross-tenant: rejeição estrita (HTTP 403) de vinculação de cliente de outro workspace.

### RF-002: Ciclo de Vida do Orçamento Persistido
- `GET /api/budgets`: lista orçamentos do tenant ativo.
- `POST /api/budgets`: cria um novo agregador `Budget` com código sequencial atômico (`code`, único por workspace via `@@unique([workspaceId, code])`) e sua primeira `BudgetRevision` (`revisionNumber: 1`, `status: "draft"`).
- `GET /api/budgets/:id`: recupera o agregador com a revisão apontada por `currentRevisionId`.
- `GET /api/budgets/:id/revisions`: lista o histórico completo de revisões.

### RF-003: Edição e Versionamento
- `PUT /api/budgets/:id/revisions/:revisionId`:
  - Se a revisão especificada estiver em `draft`, atualiza o rascunho in-place;
  - Se já estiver `approved`, cria uma nova revisão (`revisionNumber: current + 1`, `status: "draft"`), atualizando `Budget.currentRevisionId` sem alterar a revisão aprovada anterior.

### RF-004: Aprovação e Rejeição com `revisionId` Explícito
- `POST /api/budgets/:id/revisions/:revisionId/approve`:
  - Exige `revisionId` explícito na URL/body. Se o estado do registro divergir, retorna **HTTP 409 Conflict**;
  - Executado em `prisma.$transaction`: marca a revisão como `approved`, atualiza `Budget.approvedRevisionId`;
  - **Se a OP não existe**: cria a `ProductionOrder` com `status: "in_production"`, registrando `budgetId` e `budgetRevisionId`;
  - **Se a OP já existe (e está aberta)**: mantém a mesma OP e atualiza estritamente os campos da whitelist (`budgetRevisionId`, `notes`, snapshots veículo/cliente, `platform`, `insurer`, `dueAt`);
  - **Se a OP já estiver finalizada (`delivered`)**: retorna HTTP 422 Unprocessable Entity (fronteira para Retificação na Spec 003).
- `POST /api/budgets/:id/revisions/:revisionId/reject`:
  - Exige `revisionId` explícito;
  - Registra motivo formal (`rejection.reason`), data e usuário, alterando o status da revisão para `rejected`.

### RF-005: Ordem de Produção Direta
- `POST /api/production-orders`: cria ordem sem orçamento (`budgetId: null`), vinculada ao `ctx.activeWorkspaceId`.

### RF-006: Metadados e Upload de Fotos de Orçamento (`BudgetPhoto`)
- `POST /api/budgets/:id/photos`:
  - Salva a foto no MinIO sob o caminho canônico `tenants/{workspaceId}/budgets/{budgetId}/{photoId}.jpg` (usando UUIDs canônicos);
  - Grava metadados na tabela `budget_photos`.
- `GET /api/budgets/:id/photos`: lista fotos do orçamento com presigned URLs temporárias.

### RF-007: Migração Idempotente do LocalStorage
- `POST /api/budgets/sync-local`:
  - Recebe orçamentos locais contendo `legacyLocalId`;
  - A constraint `@@unique([workspaceId, legacyLocalId])` garante que retentativas ou chamadas concorrentes não gerem duplicatas;
  - Retorna o mapa de equivalência `{ [localId]: serverBudgetId }`;
  - A interface arquiva/limpa a chave local apenas após sucesso 200/201.

---

## 6. Requisitos Não-Funcionais

- **RNF-001 (Performance)**: Carregamento de lista e detalhes em menos de 800ms em 4G.
- **RNF-002 (Precisão Monetária Decimal)**: Totais, subtotais e taxas utilizam `Prisma.Decimal` (2 casas decimais), sem IEEE-754.
- **RNF-003 (Responsividade Mobile-First)**: Telas do fluxo utilizáveis a partir de 360px sem overflow horizontal indesejado.
- **RNF-004 (Idempotência e Concorrência)**: Constraint `@@unique([budgetId])` na `ProductionOrder` e transação garantem zero ordens duplicadas.

---

## 7. Modelo Relacional Alvo (Prisma)

```prisma
model Budget {
  id                    String    @id @default(uuid())
  workspaceId           String    @map("workspace_id")
  code                  String
  clientId              String?   @map("client_id")
  clientName            String?   @map("client_name")
  vehiclePlate          String?   @map("vehicle_plate")
  vehicleVin            String?   @map("vehicle_vin")
  vehicleBrand          String?   @map("vehicle_brand")
  vehicleModel          String?   @map("vehicle_model")
  currentRevisionNumber Int       @default(1) @map("current_revision_number")
  currentRevisionId     String?   @map("current_revision_id")
  approvedRevisionId    String?   @map("approved_revision_id")
  technicianUserId      String?   @map("technician_user_id")
  createdById           String    @map("created_by_id")
  legacyLocalId         String?   @map("legacy_local_id")
  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")
  deletedAt             DateTime? @map("deleted_at")

  workspace        Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  client           Client?           @relation(fields: [clientId], references: [id], onDelete: SetNull)
  createdBy        User              @relation("BudgetCreator", fields: [createdById], references: [id])
  technician       User?             @relation("BudgetTechnician", fields: [technicianUserId], references: [id])
  currentRevision  BudgetRevision?   @relation("BudgetCurrentRevision", fields: [currentRevisionId], references: [id], onDelete: SetNull)
  approvedRevision BudgetRevision?   @relation("BudgetApprovedRevision", fields: [approvedRevisionId], references: [id], onDelete: SetNull)
  revisions        BudgetRevision[]  @relation("BudgetRevisions")
  photos           BudgetPhoto[]
  productionOrder  ProductionOrder?

  @@unique([workspaceId, code])
  @@unique([workspaceId, legacyLocalId])
  @@index([workspaceId])
  @@index([vehiclePlate])
  @@index([clientId])
  @@map("budgets")
}

model BudgetRevision {
  id                   String    @id @default(uuid())
  budgetId             String    @map("budget_id")
  revisionNumber       Int       @map("revision_number")
  status               String    @default("draft") // draft | submitted | approved | rejected
  currencyCode         String    @default("EUR") @map("currency_code")
  budgetType           String    @default("pdr") @map("budget_type")
  clientSnapshot       Json      @map("client_snapshot")
  vehicleSnapshot      Json      @map("vehicle_snapshot")
  dossierSnapshot      Json?     @map("dossier_snapshot")
  parts                Json      @default("[]")
  services             Json      @default("[]")
  labor                Json      @default("[]")
  interventionTypes    String[]  @map("intervention_types")
  diagnosis            String?
  technicalDescription String?   @map("technical_description")
  grossTotal           Decimal   @default(0) @db.Decimal(12, 2) @map("gross_total")
  discountPct          Decimal   @default(0) @db.Decimal(5, 2) @map("discount_pct")
  discountTotal        Decimal   @default(0) @db.Decimal(12, 2) @map("discount_total")
  netTotal             Decimal   @default(0) @db.Decimal(12, 2) @map("net_total")
  taxPct               Decimal   @default(0) @db.Decimal(5, 2) @map("tax_pct")
  taxTotal             Decimal   @default(0) @db.Decimal(12, 2) @map("tax_total")
  finalTotal           Decimal   @default(0) @db.Decimal(12, 2) @map("final_total")
  signature            Json?
  rejection            Json?
  approvedAt           DateTime? @map("approved_at")
  approvedById         String?   @map("approved_by_id")
  createdById          String    @map("created_by_id")
  createdAt            DateTime  @default(now()) @map("created_at")

  budget               Budget            @relation("BudgetRevisions", fields: [budgetId], references: [id], onDelete: Cascade)
  asCurrentForBudgets  Budget[]          @relation("BudgetCurrentRevision")
  asApprovedForBudgets Budget[]          @relation("BudgetApprovedRevision")
  productionOrders     ProductionOrder[] @relation("ProductionOrderRevision")

  @@unique([budgetId, revisionNumber])
  @@unique([id, budgetId])
  @@index([budgetId, status])
  @@map("budget_revisions")
}

model BudgetPhoto {
  id          String   @id @default(uuid())
  budgetId    String   @map("budget_id")
  workspaceId String   @map("workspace_id")
  storagePath String   @map("storage_path")
  category    String   // inspection | damage | document
  caption     String?
  sizeBytes   Int?     @map("size_bytes")
  uploadedBy  String   @map("uploaded_by")
  createdAt   DateTime @default(now()) @map("created_at")

  budget    Budget    @relation(fields: [budgetId], references: [id], onDelete: Cascade)
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([budgetId])
  @@index([workspaceId])
  @@map("budget_photos")
}
```

E em `ProductionOrder`:
```prisma
  budgetId         String?         @unique @map("budget_id")
  budgetRevisionId String?         @map("budget_revision_id")

  budget         Budget?         @relation(fields: [budgetId], references: [id], onDelete: SetNull)
  budgetRevision BudgetRevision? @relation("ProductionOrderRevision", fields: [budgetRevisionId, budgetId], references: [id, budgetId], onDelete: SetNull)
```

---

## 8. Tratamento de Erros e Casos de Borda

| Código | Cenário | Ação do Backend / UI |
|---|---|---|
| `400 Bad Request` | Payload de orçamento ou foto inválido (Zod falhou). | Retorna detalhe do campo inválido. |
| `403 Forbidden` | Usuário do Workspace A tenta acessar Budget do Workspace B. | Bloqueio imediato (*deny-by-default*). |
| `403 Forbidden` | Técnico com `role = technician` tenta atribuir ordem a outro técnico. | Retorna erro da regra `TECH-ASSIGN-01`. |
| `403 Forbidden` | Tentativa de associar `clientId` de outro workspace. | Retorna erro de fronteira de tenant. |
| `404 Not Found` | Orçamento, revisão ou foto inexistente. | Retorna mensagem clara de recurso não encontrado. |
| `409 Conflict` | `revisionId` enviado para aprovação/rejeição diverge do estado atual do registro no banco. | Retorna 409 Conflict informando necessidade de recarregar. |
| `422 Unprocessable` | Tentativa de aprovar revisão de orçamento cuja OP já foi finalizada (`delivered`). | Retorna instrução de uso do fluxo de Retificação da Spec 003. |
