# Spec 001 — Foundation Context & Server-Side Tenancy Authority

**Status**: Active  
**Prioridade**: P0 (Fundação Crítica de Segurança e Multi-Tenancy)  
**Fase de Engenharia**: R0  
**Data**: 2026-09-13  
**Decisores**: EverGreen Engineering Team  

---

## 1. Contexto e Problema

A auditoria técnica (Fase 5A e 2) comprovou vulnerabilidades graves na camada de entrada, autorização e contexto do sistema:
1. **Autorregistro Público Privilegiado ([S5A-001](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/docs/audit/security-performance-and-technical-debt.md#L42))**: O endpoint `POST /api/auth/register` aceita `role: "admin"` no payload com default para `"admin"`, persistindo o papel na tabela `User` e gerando sessão com privilégios de plataforma para clientes anônimos.
2. **Escalada Local $\rightarrow$ Global de Privilégios ([S5A-002](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/docs/audit/security-performance-and-technical-debt.md#L43))**: Ao alterar o papel de um membro em um Workspace (`PATCH /api/workspaces/:id/members/:memberId`), o backend atualiza simultaneamente a coluna global `User.role` e a tabela `UserRole`.
3. **Ausência de `RequestContext` e BOLA/IDOR Sistêmico ([S5A-003](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/docs/audit/security-performance-and-technical-debt.md#L44))**: O middleware `requireAuth` injeta apenas `{ userId, email, role }`. Rotas como `/api/people`, `/api/locations` e `/api/service-orders` não filtram dados por tenant ou aceitam `workspace_id` enviado pelo cliente na query string/body sem validação de pertencimento no servidor.
4. **Endpoints de IA/OCR Desprotegidos ([S5A-008](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/docs/audit/security-performance-and-technical-debt.md#L49))**: Rotas em `/api/extract/*` realizam processamento de imagens e chamadas a LLMs (OpenAI/Gemini) sem autenticação.

---

## 2. Target State (Estado Alvo)

1. **Cadastro Público Seguro**: `POST /api/auth/register` cria estritamente contas de usuário sem privilégio de plataforma (`role: "user"`). O papel `platform_admin` só pode nascer via bootstrap de uso único out-of-band ou script de seed administrativo.
2. **Desacoplamento de Papéis**: O papel de plataforma (`User.role` = `user` | `platform_admin`) é estritamente separado do papel de workspace (`Membership.role` = `owner` | `admin` | `technician` | `partner` | `client`). Alterações de membership **nunca** afetam a autoridade global do usuário.
3. **`RequestContext` Obrigatório**: Toda requisição autenticada tem sua autoridade e tenant resolvidos exclusivamente no servidor:
   - Identidade do ator (`actorUserId`);
   - Papel de plataforma (`platformRole`);
   - Workspace ativo validado (`activeWorkspaceId`);
   - Papel no workspace (`membershipRole`);
   - Escopo operacional (`workspace` vs `technician_personal`);
   - Vínculo com técnico (`technicianPersonId`, se aplicável).
4. **Autorização por Objeto Deny-by-Default**: Criar helpers e middleware de verificação de permissão e escopo (`own`, `team`, `all`) que impeçam o cruzamento de dados entre empresas (Workspace A $\neq$ Workspace B) ou o acesso de técnicos vinculados ao faturamento global da empresa.
5. **Proteção dos Endpoints de Extração**: Proteger `/api/extract/*` com `requireAuth` e validação estrita de payload.

---

## 3. Invariantes de Negócio e Segurança

- **INVARIANTE 1 (Isolamento de Tenant)**: Uma requisição originada por um usuário do Workspace A nunca pode ler, alterar ou deletar entidades pertencentes ao Workspace B, mesmo forjando IDs na URL ou body.
- **INVARIANTE 2 (Ignorar Tenant do Cliente)**: O backend **nunca** utiliza `req.query.workspace_id` ou `req.body.workspace_id` diretamente como filtro ou autorização sem antes validar que o `actorUserId` é membro ativo daquele workspace.
- **INVARIANTE 3 (Escopo do Técnico Vinculado)**: Um técnico com `membershipRole: "technician"` e política `scope: "own"` só pode consultar ou modificar ordens e registros em que figure como executor atribuído.
- **INVARIANTE 4 (Sem Elevação Anônima)**: Nenhuma chamada anônima consegue emitir token com papel `platform_admin` ou `admin`.

---

## 4. Escopo da Spec

### Em Escopo:
* Fechamento do registro público de admin em `backend/src/routes/auth.ts`;
* Desacoplamento da alteração de membership em `backend/src/routes/workspaces.ts`;
* Criação do middleware `requestContext` e tipos canônicos em `backend/src/middleware/requestContext.ts`;
* Criação do helper de autorização de objetos em `backend/src/lib/objectAuth.ts`;
* Aplicação do `RequestContext` e isolamento nas rotas fundacionais (`/api/workspaces`, `/api/people`, `/api/locations`);
* Proteção com `requireAuth` em `backend/src/routes/extract.ts`;
* Suíte de testes automatizados de isolamento multi-tenant (Workspace A vs Workspace B).

### Fora de Escopo (Fatias Posteriores):
* Refatoração integral do fluxo de Orçamento/Produção (Spec 002);
* Geração atômica de WEEKLOG (Spec 003);
* Gestão de faturamento, listas e reconciliação (Spec 004/005);
* Interface administrativa de suporte/impersonation para equipe Operix.

---

## 5. Critérios de Aceite (DoD desta Spec)

- [ ] `POST /api/auth/register` rejeita tentativa de registrar `role: "admin"` ou força o papel para `user`.
- [ ] `PATCH /api/workspaces/:id/members/:memberId` atualiza `membership.role` sem alterar `user.role` ou `user_roles`.
- [ ] Middleware `requestContext` injeta `req.ctx` tipado e validado contra o banco de dados.
- [ ] Tentativa de acessar recurso do Workspace B usando token do Workspace A retorna 403 Forbidden ou 404 Not Found.
- [ ] `/api/people` e `/api/locations` aplicam filtro mandatória de tenant no Prisma via `req.ctx.activeWorkspaceId`.
- [ ] `/api/extract/*` retorna 401 Unauthorized para chamadas sem token Bearer JWT.
- [ ] Suíte de testes automatizados de isolamento multi-tenant criada e passando 100%.

---

## 6. Plano de Testes Mandatório

1. **Teste de Bloqueio de Registro Admin**: Requisição anônima para `/api/auth/register` com `{ role: "admin" }` cria usuário com `role: "user"`.
2. **Teste de Não-Contaminação de Papel Global**: Promover usuário a `admin` no Workspace A não altera seu papel global `user` nem concede acesso ao Workspace B.
3. **Teste de Isolamento A/B**:
   - Criação de fixture com Workspace A e Workspace B;
   - Requisição autenticada do Usuário A para ler pessoas/locais do Workspace B falha com negação de acesso.
4. **Teste de Injeção de Parâmetro Falso**:
   - Usuário A envia `?workspace_id=<id-do-workspace-b>`;
   - O backend ignora o parâmetro ou rejeita com 403, sem retornar dados de B.
5. **Teste de Proteção de Extração**:
   - Chamada para `/api/extract/production-order` sem header Authorization retorna 401.
