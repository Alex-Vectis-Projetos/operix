# Findings — Spec 002: Mobile Operation Flow (Budget → Production) (Remediado)

**Data**: 2026-09-14  
**Status**: Completed Discovery & Remediation  
**Branch**: `feat/002-mobile-operation-budget-production`  
**Base**: `develop/operix-core` (Spec 001 integrada)  

---

## 1. Respostas Obrigatórias às Questões de Descoberta

### 1. Onde Budget vive atualmente?
- **Status**: `CONFIRMED`
- **Arquivo**: [src/components/production/BudgetPanel.tsx:L35](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/production/BudgetPanel.tsx#L35), [L81-L91](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/production/BudgetPanel.tsx#L81-L91)
- **Evidência**:
  ```typescript
  const STORAGE_KEY = "budgets-local-v1";
  const raw = localStorage.getItem(STORAGE_KEY);
  ```
- **Diagnóstico**: O orçamento vive 100% no navegador do usuário via `localStorage`. No banco de dados PostgreSQL (`backend/prisma/schema.prisma`), **não existe nenhuma tabela de orçamento** (`Budget` ou similar).

### 2. Quais dados só existem no browser?
- **Status**: `CONFIRMED`
- **Arquivos**: [src/components/production/BudgetDialog.tsx:L525-L582](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/production/BudgetDialog.tsx#L525-L582), [BudgetPanel.tsx:L36](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/production/BudgetPanel.tsx#L36)
- **Evidência**:
  - Lista completa de orçamentos e suas propriedades: `number`, `issued_at`, `status`, `budget_type`;
  - Detalhamento de peças (`parts: BudgetPartLine[]`), serviços (`services`) e mão de obra (`labor`);
  - Matriz visual de danos no veículo (`vehicle_view_state`, `mechanical_selections`);
  - Assinatura digital do cliente com desenho vetorial base64 (`signature.signatureData`), carimbo de data/hora e tipo de signatário;
  - Dados de rejeição (`rejection: BudgetRejection`);
  - Mapeamento entre ID do orçamento e ID da ordem de produção: `localStorage.getItem("budget-to-production-order-v1")`.

### 3. O que é gravado em `ProductionOrder.notes`?
- **Status**: `CONFIRMED`
- **Arquivos**: [src/components/production/BudgetPanel.tsx:L397-L492](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/production/BudgetPanel.tsx#L397-L492), [src/components/production/OrderDetailDialog.tsx:L47-L100](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/production/OrderDetailDialog.tsx#L47-L100), [backend/src/lib/weekUtils.ts:L142-L180](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/lib/weekUtils.ts#L142-L180)
- **Evidência**: Uma string longa formatada com delimitadores de texto plano (`--- DADOS DO ORÇAMENTO (NÃO REMOVER ESTA LINHA) ---`). `OrderDetailDialog.tsx` e `weekUtils.ts` usam expressões regulares complexas para parsear esses blocos de texto para exibir na UI e para gerar serviços no WEEKLOG. Qualquer edição manual quebra a integridade financeira.

### 4. Existe Vehicle canônico?
- **Status**: `CONFIRMED`
- **Arquivo**: [backend/prisma/schema.prisma:L550-L582](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/prisma/schema.prisma#L550-L582)
- **Evidência**: Não existe tabela `Vehicle` no banco. A entidade `ProductionOrder` armazena dados de veículos em colunas desnormalizadas (`licensePlate`, `vin`, `brand`, `model`, `color`). O veículo opera como um snapshot operacional tipado diretamente nas entidades de produção e orçamento.

### 5. Como Client é associado à OP?
- **Status**: `CONFIRMED`
- **Arquivos**: [backend/prisma/schema.prisma:L554-L555](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/prisma/schema.prisma#L554-L555), [src/components/production/BudgetDialog.tsx:L1197-L1204](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/production/BudgetDialog.tsx#L1197-L1204), [backend/src/routes/billingOperations.ts:L452-L475](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/billingOperations.ts#L452-L475)
- **Evidência**:
  - Em `ProductionOrder`: colunas soltas `clientId` e `clientName` sem chave estrangeira no Prisma;
  - No `BudgetDialog.tsx`: o autocomplete consome `/billing/admin/ops/clients` da tabela `billing_clients` (`BillingClient`). Essa rota exige autorização administrativa de billing (`requireAdmin`), bloqueando técnicos comuns;
  - No schema Prisma já existe o model `Client` (`clients`), com suporte a múltiplos contextos, mas sem endpoints operacionais leves expostos ao módulo de produção.

### 6. Como Technician é associado à OP?
- **Status**: `CONFIRMED`
- **Arquivos**: [backend/prisma/schema.prisma:L556-L557](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/prisma/schema.prisma#L556-L557), [src/hooks/useProductionOrders.ts:L103](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/hooks/useProductionOrders.ts#L103)
- **Evidência**: Em `ProductionOrder`: colunas `technicianUserId String?` e `technicianName String?`. O frontend passa o ID de autenticação (`User.id`). Não há chave estrangeira para `Person` ou `Membership`.

### 7. Quais IDs são usados: User, AppUser, Profile, Person, Membership?
- **Status**: `CONFIRMED`
- **Arquivos**: [backend/prisma/schema.prisma:L10-L105](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/prisma/schema.prisma#L10-L105), [backend/src/middleware/requestContext.ts:L116-L125](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/middleware/requestContext.ts#L116-L125)
- **Evidência**:
  - `User.id`: ID canônico de autenticação no JWT (`sub`), chave primária em `users`;
  - `AppUser.id`: Registro de usuário na aplicação (`app_users`), relação 1:1 `authUserId -> User.id`;
  - `Profile.id`: Registro de perfil (`profiles`), com `id == User.id`;
  - `Person.id`: Cadastro operacional de colaboradores (`people`), com `systemAccessUserId -> User.id` e `type = "technician"`;
  - `Membership.id`: Papel corporativo (`memberships`), conectando `AppUser.id` com `Workspace.id`;
  - `ProductionOrder.technicianUserId`: armazena `User.id`;
  - `ProductionOrder.createdBy`: armazena `User.id`.

### 8. Como ProductionPhoto funciona?
- **Status**: `CONFIRMED`
- **Arquivos**: [src/hooks/useProductionPhotos.ts:L33-L121](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/hooks/useProductionPhotos.ts#L33-L121), [backend/src/routes/productionPhotos.ts:L32-L52](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/productionPhotos.ts#L32-L52)
- **Evidência**: O frontend compacta a foto no browser via Canvas (JPEG 1600px), envia o binário para `POST /api/storage/upload` com caminho no formato `${workspaceId}/${orderId}/${timestamp}_${category}.jpg`, e depois chama `POST /api/production-orders/:orderId/photos` gravando metadados em `production_photos`.

### 9. Há ownership real no MinIO?
- **Status**: `CONFIRMED` (Vulnerabilidade Crítica)
- **Arquivo**: [backend/src/routes/storage.ts:L45-L145](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/storage.ts#L45-L145)
- **Evidência**:
  - `POST /storage/upload` aceita qualquer `bucket` e qualquer `path` do cliente;
  - `GET /storage/file/:bucket/*` permite download passando `?token=` na query string sem checar tenant;
  - `DELETE /storage/files` recebe array de paths e deleta sem verificar se pertencem ao workspace do usuário.

### 10. Quais endpoints confiam em `workspace_id` vindo do cliente?
- **Status**: `CONFIRMED`
- **Arquivos**:
  - `GET /api/production-orders?workspace_id=...` ([productionOrders.ts:L533](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/productionOrders.ts#L533));
  - `POST /api/production-orders` (`b.workspace_id`) ([productionOrders.ts:L550](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/productionOrders.ts#L550));
  - `PATCH /api/production-orders/:id` (sem validação de tenant!) ([productionOrders.ts:L619](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/productionOrders.ts#L619));
  - `DELETE /api/production-orders/:id` (sem validação de tenant!) ([productionOrders.ts:L633](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/productionOrders.ts#L633));
  - `GET /api/production-orders/:orderId/photos` ([productionPhotos.ts:L22](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/productionPhotos.ts#L22));
  - `POST /api/production-orders/:orderId/photos` ([productionPhotos.ts:L36](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/productionPhotos.ts#L36));
  - `DELETE /api/production-orders/:orderId/photos/:photoId` ([productionPhotos.ts:L57](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/productionPhotos.ts#L57));
  - `GET /api/service-orders/clients?workspace_id=...` ([serviceOrders.ts:L560](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/serviceOrders.ts#L560)).

### 11. Quais imports Supabase participam do fluxo?
- **Status**: `CONFIRMED`
- **Evidência**: Zero imports de Supabase no backend e no frontend de produção. Todo o módulo consome Express REST API e MinIO S3 SDK.

### 12. Quais telas mobile podem ser preservadas?
- **Status**: `CONFIRMED`
- **Evidência**:
  - `TechnicianHub.tsx`: Excelente para mobile (cards compactos, botões touch grandes de 48px).
  - `PhotoUploader.tsx`: Suporte nativo à câmera traseira (`capture="environment"`).
  - `BudgetDialog.tsx`: Stepper completo; requer ajuste CSS para 360px (tabelas e canvas).
  - `BudgetPanel.tsx`: Listagem de orçamentos e conversão.

### 13. Como aprovação funciona hoje?
- **Status**: `CONFIRMED`
- **Arquivos**: [BudgetDialog.tsx:L139-L148](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/production/BudgetDialog.tsx#L139-L148), [BudgetPanel.tsx:L203-L222](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/production/BudgetPanel.tsx#L203-L222), [L494-L534](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/production/BudgetPanel.tsx#L494-L534)
- **Evidência**: O usuário coleta assinatura desenhada em canvas, marcando `status: "approved"` no state do React e gravando no `localStorage`. Emite o evento `budget:approved-for-production` que aciona `sendToProductionAsync()`, criando a `ProductionOrder` no backend.

### 14. Como OP direta funciona hoje?
- **Status**: `CONFIRMED`
- **Arquivos**: [ProductionPage.tsx:L31-L34](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/pages/ProductionPage.tsx#L31-L34), [OrderDetailDialog.tsx:L1-L50](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/src/components/production/OrderDetailDialog.tsx#L1-L50)
- **Evidência**: O botão "Nova Ordem" inicializa o diálogo com `orderId: "__new__"`. O usuário preenche os campos do veículo e clica em "Salvar", disparando `createOrder.mutateAsync` diretamente para `POST /api/production-orders` com `budgetId: null`.

### 15. O que quebra após reload?
- **Status**: `CONFIRMED`
- **Evidência**: Troca de navegador ou limpeza de cache apaga 100% dos orçamentos locais (`budgets-local-v1`), destruindo o mapeamento `budget-to-production-order-v1`. As ordens de produção permanecem no PostgreSQL, mas o orçamento original fica degradado a texto não-estruturado em `notes`.

---

## 2. Findings Adicionais Identificados na Revisão

### 16. Histórico de Migrations do Prisma Incompleto
- **Status**: `CONFIRMED`
- **Arquivo**: [backend/prisma/migrations/](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/prisma/migrations/)
- **Evidência**: O repositório contém apenas a pasta `20260814130000_add_customer_display_id`. Não há migration inicial criando as 44 tabelas do `schema.prisma`.
- **Risco**: Rodar `prisma migrate deploy` em um banco de dados novo do zero falha imediatamente.
- **Decisão**: Requer execução obrigatória do gate **T00 — Database Migration Baseline Gate**.

### 17. Ausência de Modelo para Fotos de Vistoria Inicial
- **Status**: `CONFIRMED`
- **Evidência**: As fotos capturadas na inspeção do veículo antes da aprovação do orçamento não possuem modelo de persistência no backend. O model `ProductionPhoto` exige `productionOrderId String`, inviabilizando salvar fotos de orçamentos ainda em rascunho.
- **Decisão**: Criação do model `BudgetPhoto` associado a `Budget` e `Workspace`.

### 18. Ausência de Constraint para Cardinalidade 1:0..1 entre Budget e OP
- **Status**: `CONFIRMED`
- **Evidência**: Na tabela `production_orders`, a coluna `budgetId` não existe atualmente. Se fosse criada como relação N:1 comum, permitiria que aprovações repetidas ou retentativas gerassem múltiplas OPs para o mesmo orçamento.
- **Decisão**: Aplicar `budgetId String? @unique` em `production_orders` e gerenciar re-aprovações de ordens em andamento via atualização transacional de `budgetRevisionId`.
