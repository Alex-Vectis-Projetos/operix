# Tarefas — Spec 001: Foundation Context

Status geral da fatia: `Planejada / Pronta para Execução`

---

## Bloco 1: Fechamento de Brechas Críticas de Autenticação e Papel
- [ ] **T01**: Fechar autorregistro público em `backend/src/routes/auth.ts` (remover opção `admin`, forçar `role: "user"`).
- [ ] **T02**: Desacoplar alteração de membros em `backend/src/routes/workspaces.ts` (não modificar `user.role` global ao alterar `membership.role`).
- [ ] **T03**: Proteger rotas `/api/extract/*` com middleware de autenticação obrigatório.

## Bloco 2: RequestContext e Autorização por Objeto
- [ ] **T04**: Criar middleware `requestContext.ts` para resolver tenant, membresia e escopo no servidor.
- [ ] **T05**: Criar helper `objectAuth.ts` para impor políticas deny-by-default por recurso.
- [ ] **T06**: Aplicar `requestContext` e isolamento mandatória nas rotas de `/api/people` e `/api/locations`.

## Bloco 3: Testes de Isolamento e Quality Gates
- [ ] **T07**: Escrever testes automatizados de isolamento de tenant A/B (`tests/integration/tenant-isolation.test.ts`).
- [ ] **T08**: Escrever teste automatizado comprovando o bloqueio de autorregistro de admin.
- [ ] **T09**: Executar `npm run typecheck`, `npm run lint` e suíte de testes.
- [ ] **T10**: Atualizar tasks e produzir walkthrough da fatia.
