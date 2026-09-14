# Tarefas — Spec 001: Foundation Context

Status geral da fatia: `Concluída / Pronta para Revisão`

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
