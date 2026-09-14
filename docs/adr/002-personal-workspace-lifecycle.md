# ADR-002: Ciclo de Vida do Personal Workspace para Técnicos Independentes

**Status**: Accepted  
**Data**: 2026-09-14  
**Decisores**: EverGreen Engineering Team & Operix Core Architecture  
**Fatia Afetada**: R0/R1 — Autoridade, Tenancy e Operação Móvel  

---

## Contexto

O Operix precisa suportar dois perfis de técnicos operacionais:
1. **Técnico Vinculado (*Workspace Context*)**: Atua como membro de uma oficina/empresa (`Membership.role = "technician"`). Enxerga exclusivamente as suas ordens atribuídas (`scope = own`), enquanto o faturamento total da empresa permanece restrito aos administradores e owners.
2. **Técnico Independente (*Personal Context*)**: Profissional autônomo de martelinho de ouro (PDR) e funilaria móvel que atende clientes diretamente, sem intermediação de uma oficina física.

A auditoria e a revisão arquitetural identificaram o risco de adotar chaves duplas opcionais nos modelos (`workspaceId?` | `technicianOwnerId?`), o que multiplicaria cláusulas `OR`, criaria branches condicionais em 100% dos controllers e aumentaria expressivamente o risco de vazamento de dados (*CWE-639 / BOLA*).

---

## Decisão

### 1. Modelo de Personal Workspace Canônico
Todo técnico independente opera dentro de um `Workspace` pessoal dedicado onde ele é o único proprietário (`owner`).
- O modelo `Workspace` recebe uma coluna de categorização: `type String @default("company")` (`"company"` | `"personal"`).
- O campo `Workspace.ownerUserId` aponta estritamente para `AppUser.id` (chave estrangeira para `app_users.id`, em conformidade com o schema Prisma existente).
- Uma linha correspondente em `Membership` é criada vinculando o `AppUser.id` como `role: "owner"`, `status: "active"`.
- **Constraint Estrutural de Unicidade**: Para garantir que cada técnico possua no máximo um personal workspace, é criado um índice único parcial no PostgreSQL:
  ```sql
  CREATE UNIQUE INDEX "workspaces_owner_user_id_personal_key" 
  ON "workspaces"("owner_user_id") 
  WHERE "type" = 'personal';
  ```

### 2. Momento Exato e Idempotência de Provisionamento
- **Novos Cadastros**: Durante o cadastro/onboarding, se o usuário declarar atuação autônoma/independente (ou não possuir convite prévio para um workspace corporativo), o sistema provisiona automaticamente:
  1. `Workspace` com nome `"Oficina Pessoal - [Nome do Técnico]"`, `type: "personal"` e `ownerUserId = appUser.id`;
  2. `Membership` vinculando o `AppUser.id` como `role: "owner"`.
- **Técnicos Existentes (Migração/Baseline)**: Se um usuário autenticado com perfil de técnico acessar o sistema sem nenhuma membresia ativa (`memberships.length === 0`), o middleware `requestContext` aciona rotina de *lazy-provisioning* transacional e idempotente.
- **Idempotência**: A criação do personal workspace é protegida pela constraint `workspaces_owner_user_id_personal_key`. Tentativas simultâneas ou repetidas de provisioning retornam o workspace pessoal já existente sem falha ou duplicação.
- **Técnico Vinculado Não Recebe Personal Workspace**: Um colaborador convidado diretamente para uma empresa nasce exclusivamente com sua membresia corporativa, sem provisionamento de workspace pessoal.

### 3. Resolução Server-Side e Cabeçalho `X-Workspace-Id` Não-Confiável
- O cabeçalho HTTP `X-Workspace-Id` é tratado pelo backend como um **seletor de intenção não-confiável**.
- O middleware `resolveActiveWorkspace` **nunca confia** no valor do cabeçalho sem validação no banco:
  - Consulta obrigatoriamente a tabela `memberships` verificando se o `appUser.id` possui registro ativo (`status = "active"`) naquele workspace específico;
  - Se o usuário não for membro ativo do workspace solicitado, a requisição é sumariamente rejeitada com HTTP 403 Forbidden.
- Se nenhum cabeçalho for fornecido e o usuário possuir um workspace pessoal (`type === "personal"`), este é selecionado automaticamente como padrão.

### 4. Ingresso Posterior em Workspace Corporativo e Troca de Contexto (*Switching*)
- Caso um técnico independente seja convidado para prestar serviços a uma empresa:
  1. Ele aceita o convite e recebe uma nova `Membership` no workspace da empresa com `role: "technician"`;
  2. Seu workspace pessoal permanece intacto e acessível;
  3. A alternância entre contextos é feita via cabeçalho HTTP `X-Workspace-Id` validado pelo servidor:
     - Ao selecionar o **Workspace Pessoal**: o usuário opera com `membershipRole: "owner"`, gerindo seus trabalhos autônomos.
     - Ao selecionar o **Workspace Corporativo**: o usuário opera com `membershipRole: "technician"`, restrito a `scope: "own"` na empresa contratante.

---

## Consequências

### Positivas:
- `ownerUserId` padronizado apontando para `AppUser.id`, mantendo integridade com as relações do Prisma;
- Impossibilidade estrutural de técnicos acumularem múltiplos personal workspaces;
- Zero confiança em identificadores do cliente (CWE-639 / BOLA mitigado no servidor);
- Uniformidade relacional em 100% das tabelas que consom `workspaceId`.
