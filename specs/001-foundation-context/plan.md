# Plano de Implementação Técnica — Spec 001: Foundation Context

---

## 1. Arquivos a Modificar / Criar

### Backend:
1. **[NEW] `backend/src/middleware/requestContext.ts`**:
   - Criação do tipo `RequestContext`;
   - Resolução de `actorUserId`, `platformRole`, `activeWorkspaceId`, `membershipRole`, `technicianPersonId` e `scope`;
   - Extensão do `Request` do Express (`req.ctx`).
2. **[NEW] `backend/src/lib/objectAuth.ts`**:
   - Helper `assertTenantAccess(ctx, targetWorkspaceId)`;
   - Helper `assertObjectAccess(ctx, resource)`;
   - Filtro Prisma automático para escopo `own`.
3. **[MODIFY] `backend/src/routes/auth.ts`**:
   - Remover `"admin"` do enum público de `registerSchema`;
   - Fixar `role: "user"` na criação de `User`;
   - Proteger criação de `platform_admin`.
4. **[MODIFY] `backend/src/routes/workspaces.ts`**:
   - Remover os blocos de atualização em `tx.user.update` e `tx.userRole.upsert` na rota `PATCH /:workspaceId/members/:membershipId`;
   - Garantir que apenas `membership.role` seja atualizado.
5. **[MODIFY] `backend/src/routes/people.ts`**:
   - Aplicar `requestContext` e filtrar consultas com `where: { workspaceId: ctx.activeWorkspaceId }`;
   - Aplicar autorização de objeto deny-by-default.
6. **[MODIFY] `backend/src/routes/extract.ts`**:
   - Adicionar middleware `requireAuth` e `requestContext` em todas as rotas de extração de IA (`/production-order`, `/service-order`, etc.).

### Testes:
7. **[NEW] `tests/integration/tenant-isolation.test.ts`**:
   - Teste A/B com dois workspaces distintos;
   - Teste de tentativa de BOLA/IDOR via query string;
   - Teste de bloqueio de registro admin público;
   - Teste de isolamento de membership vs global role.

---

## 2. Estratégia de Migração e Compatibilidade

* **Retrocompatibilidade de Usuários Existentes**: Usuários que já possuem `role: "admin"` no banco permanecem funcionais, mas novos cadastros são restritos.
* **Transição sem Quebra de Frontend**: O endpoint de login continua retornando os dados esperados pelo frontend (`user`, `token`), adicionando `workspaceId` e contexto enriquecido.

---

## 3. Estratégia de Rollback

Se algum endpoint apresentar regressão:
1. O commit conterá apenas a fatia 001;
2. `git revert` do commit da Spec 001 sem impacto em dados existentes (nenhuma exclusão de colunas no banco nesta fatia).
