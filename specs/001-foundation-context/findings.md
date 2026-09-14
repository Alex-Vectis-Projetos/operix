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
