# Evidências de Código — Spec 001: Foundation Context

Este documento registra as linhas exatas do código fonte inspecionadas durante o diagnóstico que comprovam as vulnerabilidades e motivam esta especificação.

---

## 1. Autorregistro Público de Administrador
- **Arquivo**: [backend/src/routes/auth.ts:15-20](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/auth.ts#L15-L20)
  ```typescript
  const registerSchema = z.object({
    email: z.string().email().transform((value: string) => value.trim().toLowerCase()),
    password: z.string().min(8, "A senha deve ter pelo menos 8 caracteres."),
    fullName: z.string().min(2, "Informe o nome completo."),
    role: z.enum(["admin", "technician", "partner", "client"]).default("admin"),
  });
  ```
- **Persistência Privilegiada**: [backend/src/routes/auth.ts:68-108](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/auth.ts#L68-L108)
  Cria o registro em `user`, `profile` e `userRole` atribuindo o papel passado pelo cliente sem validação de bootstrap ou convite.
- **Emissão Imediata de Sessão**: [backend/src/routes/auth.ts:112-120](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/auth.ts#L112-L120)
  Assina e devolve o JWT com `role: "admin"`.

---

## 2. Escalada de Papel Global via Membership
- **Arquivo**: [backend/src/routes/workspaces.ts:603-616](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/workspaces.ts#L603-L616)
  ```typescript
  if (normalizedRole) {
    await tx.user.update({
      where: { id: membership.user.authUserId },
      data: { role: normalizedRole },
    });
    await tx.userRole.upsert({
      where: { userId: membership.user.authUserId },
      update: { role: normalizedRole },
      create: {
        userId: membership.user.authUserId,
        role: normalizedRole,
      },
    });
  }
  ```
- **Impacto**: A promoção de um usuário a "admin" dentro de um workspace específico altera sua autoridade global na tabela `users` do sistema.

---

## 3. Ausência de Filtro de Tenant em Rotas Centrais (BOLA / IDOR)
- **Arquivo**: [backend/src/routes/people.ts:80-103](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/people.ts#L80-L103)
  ```typescript
  peopleRouter.get("/", requireAuth, async (req: AuthenticatedRequest, res: Response) => {
    // ...
    const people = await prisma.person.findMany({
      where: {
        deletedAt: null,
        // NENHUMA cláusula workspaceId ou vinculação com o tenant do usuário!
      },
      // ...
    });
  ```
- **Impacto**: Qualquer usuário autenticado tem visibilidade integral sobre o catálogo de pessoas de todos os clientes cadastrados no banco.

---

## 4. Endpoints de Extração sem Autenticação
- **Arquivo**: [backend/src/routes/extract.ts:6](file:///c:/Users/Gustavo%20Fugulin/Downloads/operix/backend/src/routes/extract.ts#L6)
  ```typescript
  extractRouter.post("/production-order", async (req: Request, res: Response) => {
    // requireAuth AUSENTE!
    const { imageBase64, mimeType, fileName } = req.body;
    // Dispara chamada OpenAI / Gemini sem verificação de identidade
    const aiRes = await fetchAICompletion({ ... });
  ```
- **Impacto**: Consumo indevido de cotas de IA e vulnerabilidade de Denial of Service (DoS) por sobrecarga de base64.

---

## 5. Achados Adicionais e Fora de Escopo

1. **Configuração de Variáveis de Ambiente (`backend/src/config/env.ts`)**:
   - `SMTP_PORT` e `SMTP_SECURE` quando configurados como string vazia `""` no arquivo `.env` causavam falha de validação Zod no startup do backend em ambiente de teste. Foi implementado preprocessador sanitizando strings vazias para `undefined`.
2. **Setup Global de Testes (`src/test/setup.ts`)**:
   - O setup executava `window.matchMedia` incondicionalmente, falhando em suites de integração do backend que rodam em `@vitest-environment node`. Corrigido com guarda defensiva `typeof window !== "undefined"`.
3. **Exceção de Baseline de Linter no Frontend (`npm run lint`)**:
   - Falhas pré-existentes confirmadas no baseline (commit de partida `9238878` / `main`), anteriores à branch `feat/001-foundation-context`:
     - `src/components/production/OrderDetailDialog.tsx:484:18` — `react-hooks/rules-of-hooks` (useMemo condicional)
     - `src/components/production/OrderDetailDialog.tsx:491:43` — `react-hooks/rules-of-hooks` (useMemo condicional)
     - `src/main.tsx:106:18` — `@typescript-eslint/no-require-imports` (require style import)
   - Total de erros pré-existentes: 3. Novos erros introduzidos pela branch: 0.
   - Recomendação formal: Criar task separada de refatoração para R1 Produção (`OrderDetailDialog`) e Shell/Infra (`main.tsx`) para não misturar escopos com a Spec 001.

---

## 6. Remediação da Revisão Independente (Review Remediation)

A revisão independente retornou `REQUEST CHANGES`. Todos os blockers e majors foram remediados:

| Finding | Severidade | Descrição do Problema | Remediação Aplicada |
|---|---|---|---|
| **SEC-001** | BLOCKER | Checagens manuais permissivas em `locations.ts` e `people.ts` permitiam bypass quando `workspaceId: null`. | Substituído por `assertTenantAccess(req.ctx!, entity.workspaceId)` centralizado (deny-by-default). |
| **SEC-002** | BLOCKER | `activeWorkspaceId` opcional em `GET /locations` e `GET /people` permitia fallback para query global. | Exigência mandatória de `req.ctx?.activeWorkspaceId` (403 Forbidden se ausente) e filtro estrito `where: { workspaceId: req.ctx.activeWorkspaceId }`. |
| **SEC-003** | BLOCKER | Criação (`POST /locations`, `POST /people`) aceitava `body.workspace_id` do cliente. | Removido qualquer fallback do client. Persistência vinculada exclusivamente a `req.ctx.activeWorkspaceId`. |
| **SEC-004** | MAJOR | `POST /workspaces/:id/members` criava usuário com `User.role` e `UserRole.role` espelhando o papel local. | Forçado `User.role = "user"` e `UserRole.role = "user"`. Papel local restrito exclusivamente a `Membership.role`. |
| **SEC-005** | MAJOR | E-mail hardcoded `qwork@qworkgroup.com` em `requestContext.ts` promovia automaticamente para `platform_admin`. | Removido o bypass hardcoded. Autoridade de plataforma agora provém exclusivamente de estado autorizado no backend (`User.role`). |
| **SEC-006** | MAJOR | `POST /people` e `PATCH /people/:id` permitiam vincular `location_id` de outro workspace (cross-tenant). | Adicionada validação estrita confirmando existência e pertencimento da Location ao `activeWorkspaceId` (retorna 400 em caso de violação). |
| **TEST-001** | MAJOR | Testes tautológicos / checagem de middleware sem validação de comportamento real de negócio. | Substituído por suíte de integração comportamental completa executando requisições HTTP reais com cobertura A até F. |

Estado após correções: **READY FOR RE-REVIEW**


