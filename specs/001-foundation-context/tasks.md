# Tarefas — Spec 001: Foundation Context

Status geral da fatia: `READY FOR RE-REVIEW`

---

## Bloco 1: Fechamento de Brechas Críticas de Autenticação e Papel
- [x] **T01**: Fechar autorregistro público em `backend/src/routes/auth.ts` (remover opção `admin`, forçar `role: "user"`).
- [x] **T02**: Desacoplar alteração de membros em `backend/src/routes/workspaces.ts` (não modificar `user.role` global ao alterar `membership.role`).
- [x] **T03**: Proteger rotas `/api/extract/*` com middleware de autenticação obrigatório.

## Bloco 2: RequestContext e Autorização por Objeto
- [x] **T04**: Criar middleware `requestContext.ts` para resolver tenant, membresia e escopo no servidor.
- [x] **T05**: Criar helper `objectAuth.ts` para impor políticas deny-by-default por recurso.
- [x] **T06**: Aplicar `requestContext` e isolamento mandatória nas rotas de `/api/people` e `/api/locations`.

## Bloco 3: Testes de Isolamento e Quality Gates
- [x] **T07**: Escrever testes automatizados de isolamento de tenant A/B (`tests/integration/tenant-isolation.test.ts`).
- [x] **T08**: Escrever teste automatizado comprovando o bloqueio de autorregistro de admin.
- [x] **T09**: Executar `npm run typecheck`, `npm run lint` e suíte de testes.
- [x] **T10**: Atualizar tasks e produzir walkthrough da fatia.

## Bloco 4: Remediação de Revisão Independente (Review Changes)
- [x] **R01 (SEC-001)**: Substituição de checagens permissivas por `assertTenantAccess` centralizado (deny-by-default) nas rotas de Locations e People.
- [x] **R02 (SEC-002, SEC-003)**: `activeWorkspaceId` obrigatório em `GET` e `POST` (Locations e People), retornando 403 Forbidden sem workspace ativo e eliminando `body.workspace_id` como autoridade.
- [x] **R03 (SEC-004)**: `POST /api/workspaces/:workspaceId/members` forçando `User.role = "user"` e `UserRole.role = "user"`, impedindo escalada de autoridade global a partir de papel local.
- [x] **R04 (SEC-005)**: Remoção de e-mail hardcoded `qwork@qworkgroup.com` de `requestContext.ts`.
- [x] **R05 (SEC-006)**: Validação de chave estrangeira de `Location` contra o `activeWorkspaceId` em `POST /people` e `PATCH /people/:id`.
- [x] **R06 (TEST-001)**: Implementação de suíte de integração comportamental cobrindo itens A a F (Membership decoupling, objeto sem tenant, forged POST, no active workspace, cross-tenant FK, HTTP auth).

