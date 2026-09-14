# Decisões de Arquitetura — Spec 001: Foundation Context

---

## 1. Separação Estrita: Papel de Plataforma vs. Papel de Workspace

* **Problema**: O sistema misturava a administração técnica da plataforma Operix com a administração corporativa da oficina cliente.
* **Decisão**:
  * `User.role` passa a representar estritamente a autoridade sobre a plataforma:
    * `user` (padrão): usuário comum, sem acesso a painéis de plataforma;
    * `platform_admin`: operador técnico da EverGreen/Operix.
  * `Membership.role` passa a representar a autoridade dentro de uma empresa cliente:
    * `owner`: criador ou responsável legal pelo workspace;
    * `admin`: gestor com poderes administrativos dentro do workspace;
    * `technician`: técnico operacional (com escopo `own`);
    * `partner`: parceiro/sócio da operação;
    * `client`: preposto do cliente contratante.
* **Consequência**: Alterar uma membresia nunca altera a linha em `User.role`.

---

## 2. Resolução do Workspace Ativo no Servidor

* **Problema**: O frontend passava `workspace_id` como parâmetro e o backend confiava cegamente.
* **Decisão**:
  1. O cliente pode sugerir um workspace desejado via cabeçalho HTTP `X-Workspace-Id` ou parâmetro de rota `/api/workspaces/:workspaceId/...`.
  2. O middleware `requestContext` intercepta o ID sugerido e valida obrigatoriamente se o `actorUserId` possui `Membership` ativa naquele workspace:
     ```typescript
     const membership = await prisma.membership.findFirst({
       where: { workspaceId: suggestedWorkspaceId, userId: appUser.id, status: "active" }
     });
     if (!membership) {
       throw new ForbiddenError("Acesso negado ao workspace solicitado.");
     }
     ```
  3. Se nenhum workspace for sugerido, o sistema resolve o workspace padrão ativo do usuário.
* **Consequência**: Nenhuma requisição consegue operar sobre um tenant sem provar filiação ativa prévia.

---

## 3. Autorização de Objeto Deny-by-Default

* **Problema**: Consultas no banco buscavam por `id` direto sem validar `workspaceId`.
* **Decisão**:
  Criar a função helper `assertObjectAccess(ctx, entityTenantId, ownerUserId?)`:
  * Garante que `entityTenantId === ctx.activeWorkspaceId`;
  * Se o usuário tiver papel de técnico (`scope === 'own'`), garante que `ownerUserId === ctx.actorUserId` ou `ctx.technicianPersonId`.
* **Consequência**: Erradicação de BOLA/IDOR na camada de aplicação.
