# Critérios de Aceite Comportamentais (BDD) — Spec 002 (Final Cleanup)

**Data**: 2026-09-14  
**Fatia**: R1 — Operação Móvel: Orçamento → Revisões → Aprovação → Produção  

---

## 1. Cardinalidade Budget → ProductionOrder (1:0..1) e Re-Aprovação com Whitelist

### Cenário 1.1: Primeira aprovação com revisionId explícito cria uma nova ProductionOrder
```gherkin
GIVEN que o orçamento com ID "b-uuid-01" possui a Revisão 1 com ID "rev-uuid-01" em estado "draft" no valor de "1200.00 EUR"
AND nenhuma "ProductionOrder" existe ainda para o orçamento "b-uuid-01"
WHEN o cliente assinar e aprovar via "POST /api/budgets/b-uuid-01/revisions/rev-uuid-01/approve"
THEN o backend deve alterar a Revisão 1 para status "approved"
AND deve atualizar "Budget.approvedRevisionId" apontando para "rev-uuid-01"
AND deve criar uma nova "ProductionOrder" com:
  | Campo            | Valor                      |
  | status           | in_production              |
  | budgetId         | b-uuid-01                  |
  | budgetRevisionId | rev-uuid-01                |
```

### Cenário 1.2: Re-aprovação com OP aberta atualiza apenas a whitelist permitida
```gherkin
GIVEN que o orçamento "b-uuid-01" já possui a Revisão 1 aprovada e uma "ProductionOrder" "op-uuid-500" aberta:
  | Campo            | Valor                      |
  | status           | in_production              |
  | technicianUserId | tech-uuid-99               |
  | priority         | urgent                     |
  | startedAt        | 2026-09-14T08:00:00Z       |
AND o técnico criou a Revisão 2 com ID "rev-uuid-02" com serviços adicionais (novo total "1500.00 EUR")
WHEN o cliente aprovar via "POST /api/budgets/b-uuid-01/revisions/rev-uuid-02/approve"
THEN o backend deve marcar a Revisão 2 como status "approved"
AND deve atualizar "Budget.approvedRevisionId" apontando para "rev-uuid-02"
AND NENHUMA segunda "ProductionOrder" deve ser criada no banco de dados
AND a mesma "ProductionOrder" "op-uuid-500" deve ter atualizados os campos da whitelist:
  | Campo            | Valor                      |
  | budgetRevisionId | rev-uuid-02                |
  | platform         | Orçamento ORC-001 · 1500.00 EUR |
AND os campos operacionais de execução devem permanecer intocados:
  | Campo            | Valor Preservado           |
  | status           | in_production              |
  | technicianUserId | tech-uuid-99               |
  | priority         | urgent                     |
  | startedAt        | 2026-09-14T08:00:00Z       |
```

### Cenário 1.3: Bloqueio de aprovação em caso de estado divergente (409 Conflict)
```gherkin
GIVEN que o orçamento "b-uuid-01" possui a Revisão 1 aprovada e a Revisão 2 como rascunho
WHEN o operador enviar uma requisição "POST /api/budgets/b-uuid-01/revisions/rev-uuid-01/approve" tentando aprovar novamente a Revisão 1 já aprovada
THEN o backend deve retornar status HTTP 409 (Conflict)
AND deve informar que a revisão indicada diverge do estado atual do registro no servidor.
```

### Cenário 1.4: Bloqueio de re-aprovação em ordem já entregue/finalizada (422 Unprocessable)
```gherkin
GIVEN que a ordem "op-uuid-500" vinculada a "b-uuid-01" já atingiu o status "delivered"
AND o técnico tenta submeter e aprovar uma nova revisão "rev-uuid-03" para o mesmo orçamento
WHEN for enviada a requisição "POST /api/budgets/b-uuid-01/revisions/rev-uuid-03/approve"
THEN o backend deve retornar status HTTP 422 (Unprocessable Entity)
AND deve informar que alterações pós-entrega exigem o fluxo de Retificação (Spec 003).
```

---

## 2. Imutabilidade e Integridade Estrutural Composta

### Cenário 2.1: Edição em orçamento aprovado não sobrescreve a revisão aprovada
```gherkin
GIVEN que o orçamento "b-uuid-02" possui a Revisão 1 com ID "rev-uuid-10" aprovada no valor de "800.00 EUR"
WHEN o operador enviar uma alteração de peças via "PUT /api/budgets/b-uuid-02/revisions/rev-uuid-10"
THEN o backend deve criar a "Revisão 2" com ID "rev-uuid-20" com:
  | Campo           | Valor Esperado       |
  | revisionNumber  | 2                    |
  | status          | draft                |
AND a Revisão 1 "rev-uuid-10" deve permanecer registrada com status "approved" e valor "800.00 EUR"
AND o "Budget.currentRevisionId" deve apontar para "rev-uuid-20"
AND o "Budget.approvedRevisionId" deve continuar apontando para "rev-uuid-10".
```

### Cenário 2.2: Rejeição de revisão pertencente a outro Budget na ProductionOrder
```gherkin
GIVEN que existe o orçamento "Budget A" com revisão "Rev A1" e o orçamento "Budget B" com revisão "Rev B1"
WHEN uma operação de banco tentar gravar na "ProductionOrder" a combinação 'budgetId: Budget A' e 'budgetRevisionId: Rev B1'
THEN a constraint de foreign key composta "production_orders_budget_revision_id_budget_id_fkey" do PostgreSQL deve rejeitar a transação
AND nenhuma ordem com dados cruzados deve ser persistida.
```

---

## 3. Isolamento Multi-Tenant e Associação de Clientes

### Cenário 3.1: Bloqueio de leitura de orçamento entre workspaces distintos
```gherkin
GIVEN que o "Gestor A" está autenticado no "Workspace Alpha"
AND existe um orçamento cadastrado com ID "b-alpha-01" no "Workspace Alpha"
AND o "Gestor B" está autenticado no "Workspace Beta"
WHEN o "Gestor B" tentar consultar "GET /api/budgets/b-alpha-01"
THEN o backend deve retornar status HTTP 403 (Forbidden) ou 404 (Not Found)
AND nenhum dado de cliente, veículo ou valores deve ser retornado.
```

### Cenário 3.2: Rejeição de vinculação de Client de outro workspace
```gherkin
GIVEN que o "Cliente Beta" pertence exclusivamente ao "Workspace Beta"
AND o "Gestor A" está autenticado no "Workspace Alpha"
WHEN o "Gestor A" tentar criar um orçamento em "POST /api/budgets" informando '{"clientId": "id-do-cliente-beta"}'
THEN o backend deve rejeitar a operação com HTTP 403 (Forbidden)
AND nenhum orçamento deve ser criado associando o cliente estrangeiro.
```

---

## 4. Regras de Atribuição de Técnico (Technician Assignment)

### Cenário 4.1: Técnico vinculado só pode auto-atribuir trabalhos (TECH-ASSIGN-01)
```gherkin
GIVEN que o usuário "Técnico João" possui papel "technician" no "Workspace Alpha"
WHEN ele criar um orçamento enviando no corpo '{"technicianUserId": "id-do-tecnico-pedro"}'
THEN o backend deve ignorar o ID enviado ou rejeitar a requisição com HTTP 403
AND deve forçar o "technicianUserId" para o próprio ID do "Técnico João" resolvido no RequestContext.
```

### Cenário 4.2: Administrador pode atribuir técnico válido do mesmo workspace (TECH-ASSIGN-02)
```gherkin
GIVEN que a usuária "Admin Maria" possui papel "admin" no "Workspace Alpha"
AND o usuário "Técnico Pedro" possui membresia ativa no "Workspace Alpha"
WHEN a "Admin Maria" criar um orçamento enviando '{"technicianUserId": "id-do-tecnico-pedro"}'
THEN o backend deve aceitar a atribuição e vincular o orçamento ao "Técnico Pedro".
```

### Cenário 4.3: Rejeição de técnico forjado de outro workspace (FORGED-TECHNICIAN)
```gherkin
GIVEN que o usuário "Técnico Externo" pertence unicamente ao "Workspace Beta"
AND a usuária "Admin Maria" está operando no "Workspace Alpha"
WHEN ela tentar atribuir uma ordem a '{"technicianUserId": "id-do-tecnico-externo"}'
THEN o backend deve retornar HTTP 403 (Forbidden)
AND deve informar que o técnico selecionado não é membro ativo do workspace.
```

---

## 5. Ciclo de Vida do Personal Workspace (ADR-002)

### Cenário 5.1: Provisionamento com ownerUserId AppUser e garantia de unicidade
```gherkin
GIVEN que um profissional autônomo se cadastra na plataforma como técnico independente
WHEN ele concluir o cadastro sem convite para oficina corporativa
THEN o sistema deve provisionar um "Workspace" com "type = personal" e "ownerUserId" vinculado ao seu "AppUser.id"
AND se ocorrer uma segunda chamada de provisioning para o mesmo usuário
THEN a constraint única parcial deve impedir a criação de um segundo personal workspace
AND deve retornar o workspace pessoal já existente de forma idempotente.
```

### Cenário 5.2: Cabeçalho X-Workspace-Id é validado server-side e nunca confiado cegamente
```gherkin
GIVEN que o usuário "Lucas" possui seu "Personal Workspace" e NÃO é membro da "Oficina Forjada"
WHEN ele enviar uma requisição com o cabeçalho "X-Workspace-Id: id-da-oficina-forjada"
THEN o middleware resolveActiveWorkspace deve consultar a tabela "memberships"
AND ao constatar ausência de membresia ativa, deve rejeitar com HTTP 403 Forbidden.
```

---

## 6. Sincronização Idempotente do LocalStorage (`legacyLocalId` Único)

### Cenário 6.1: Chamadas concorrentes ou retentativas não duplicam registros
```gherkin
GIVEN que o navegador do usuário envia simultaneamente duas requisições idênticas para "POST /api/budgets/sync-local" com um orçamento de "legacyLocalId: local-123"
WHEN ambas as requisições forem processadas pelo servidor
THEN a constraint "@@unique([workspaceId, legacyLocalId])" deve garantir que apenas um orçamento seja inserido
AND ambas as requisições devem retornar HTTP 200/201 referenciando o mesmo ID de orçamento do servidor
AND a interface do usuário arquiva a chave local sem duplicação.
```

---

## 7. Metadados e Governança de Fotos com UUIDs Canônicos

### Cenário 7.1: Upload com caminhos baseados em UUIDs no MinIO
```gherkin
GIVEN que o técnico tira uma foto para o orçamento "b-uuid-01"
WHEN a foto for enviada para "POST /api/budgets/b-uuid-01/photos"
THEN o arquivo deve ser gravado no MinIO sob o caminho:
  "tenants/{workspaceId}/budgets/b-uuid-01/{photoId}.jpg"
AND não deve utilizar códigos de exibição humanos no path do storage
AND um registro correspondente deve ser criado na tabela "budget_photos".
```

### Cenário 7.2: Bloqueio de download ou exclusão cross-tenant
```gherkin
GIVEN que a foto pertence a um orçamento do "Workspace Alpha"
WHEN um usuário autenticado no "Workspace Beta" tentar baixar ou deletar essa foto
THEN o backend deve rejeitar imediatamente com HTTP 403 (Forbidden).
```

---

## 8. Ciclo de Rejeição com `revisionId` Explícito

### Cenário 8.1: Rejeição formal de revisão submetida
```gherkin
GIVEN que a Revisão 1 com ID "rev-uuid-30" do orçamento "b-uuid-03" foi submetida ao cliente
WHEN o cliente reprovar via "POST /api/budgets/b-uuid-03/revisions/rev-uuid-30/reject" com motivo "Preço das peças elevado"
THEN a Revisão 1 deve ter seu status alterado para "rejected" e o motivo registrado
AND quando o técnico criar a Revisão 2 com ID "rev-uuid-31" aplicando desconto
WHEN o cliente aprovar via "POST /api/budgets/b-uuid-03/revisions/rev-uuid-31/approve"
THEN a Revisão 2 passa para status "approved"
AND a "ProductionOrder" é gerada vinculada à Revisão 2.
```

---

## 9. Neutralidade Monetária e Precisão Decimal

### Cenário 9.1: Cálculo monetário em EUR com Decimal
```gherkin
GIVEN um orçamento com itens e taxas calculadas em "EUR"
WHEN o orçamento for processado pelo backend
THEN todos os valores em "budget_revisions" devem ser calculados com "Prisma.Decimal"
AND o campo "currencyCode" deve ser registrado como "EUR"
AND nenhum cálculo monetário deve sofrer imprecisão de ponto flutuante IEEE-754.
```

---

## 10. Concorrência Simultânea na Aprovação

### Cenário 10.1: Duplo clique simultâneo com constraint única
```gherkin
GIVEN que duas requisições idênticas "POST /api/budgets/b-uuid-04/revisions/rev-uuid-40/approve" atingem o servidor simultaneamente
WHEN ambas forem executadas concorrentemente
THEN a transação com lock e a constraint "@@unique([budgetId])" na "ProductionOrder" devem garantir que exatamente UMA ordem seja criada
AND ambas as requisições devem responder com sucesso informando o mesmo ID de ordem de produção.
```
