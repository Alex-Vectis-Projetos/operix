# Operix — Regras de Engenharia & Qualidade de Software

Este documento formaliza as práticas mandatórias de desenvolvimento para garantir sustentabilidade, robustez e segurança em todas as fases da engenharia EverGreen no Operix.

---

## 1. Regras Fundamentais de Arquitetura e Código

1. **Raiz Causadora vs. Gambiarras**:
   - Sempre generalize o problema para tratar a causa-raiz no domínio ou no modelo de dados.
   - Proibido aplicar soluções paliativas (*workarounds*, *monkey patching*, flags booleanas de contorno).
2. **Dados e Operações Reais (Zero Mock)**:
   - Proibido implementar CRUDs fictícios, dados mockados ou respostas estáticas em endpoints de negócio. Toda operação deve ser ancorada em persistência relacional verdadeira.
3. **Erradicação do *Silent Failure Antipattern***:
   - Proibido silenciar exceções com blocos `catch` vazios ou façades que retornam `{ data: null, error: null }`.
   - Toda falha deve ser tipada, logada com contexto estruturado e retornada com código HTTP e mensagem semântica ao cliente.
4. **Tipagem Estrita (Zero `any`)**:
   - Proibido introduzir novos tipos `any` no TypeScript. Todo payload de API deve ser inferido a partir de esquemas Zod (`z.infer<typeof schema>`).

---

## 2. Banco de Dados e Ciclo de Vida de Migrações

### Padrão Expand-Contract
Para qualquer modificação destrutiva ou refatoração no schema do PostgreSQL:

```text
FASE 1: EXPAND   ──> Adiciona nova coluna/tabela mantendo a antiga funcional (nullable/default).
FASE 2: MIGRATE  ──> Backfill de dados e atualização dos services da aplicação para ler/gravar na nova estrutura.
FASE 3: CONTRACT ──> Remoção da coluna/tabela legada somente após validação em staging.
```

### Mandamentos de Banco:
- Proibido executar `prisma db push` em bancos compartilhados, staging ou produção;
- Toda alteração estrutural deve ser uma migration versionada (`prisma migrate dev` / `prisma migrate deploy`);
- Migrações que envolvem partição de dados devem incluir scripts de backfill explícitos e idempotentes.

---

## 3. Segurança e Menor Privilégio (OWASP API Top 10 & NIST)

1. **Princípio do Menor Privilégio**:
   - Todo acesso é negado por padrão (*deny-by-default*);
   - Apenas permissões explicitamente concedidas pelo `RequestContext` são aceitas.
2. **Proteção contra BOLA / IDOR**:
   - Toda busca por ID em tabelas tenant-scoped (`ProductionOrder`, `WEEKLOG`, `PaymentList`, `Document`) deve conter a cláusula de restrição de tenant:
     ```typescript
     prisma.productionOrder.findFirstOrThrow({
       where: { id: orderId, workspaceId: ctx.activeWorkspaceId }
     });
     ```
3. **Higiene de Logs**:
   - Proibido registrar no console ou ferramentas de APM: tokens JWT, senhas, chaves de API, dados bancários de técnicos ou payloads integrais de OCR contendo PII (*Personally Identifiable Information*).
4. **Armazenamento Seguro de Sessão**:
   - Os tokens JWT devem possuir tempo de vida curto e algoritmo fixado (`HS256`).

---

## 4. Estratégia de Testes Automatizados

O sistema adota **TDD Orientado a Risco**:

1. **Test-First Obrigatório para**:
   - Cálculos e fórmulas financeiras (WEEKLOG, Lista, Disponível, Despesas);
   - Políticas de isolamento multi-tenant e verificação de escopo (`own` vs `all`);
   - Transições de estado com efeitos colaterais derivados (conclusão de OP $\rightarrow$ criação de WEEKLOG);
   - Chaves de idempotência e retentativas em lote.
2. **Pirâmide Pragmática**:
   - **Unitários**: Regras de negócio puras, policies RBAC e validações de esquema;
   - **Integração**: Rotas Express contra banco PostgreSQL de teste (verificando queries Prisma reais);
   - **Isolamento A/B**: Testes mandatórios provando que o usuário do Workspace A recebe erro 403/404 ao tentar acessar recursos do Workspace B.

---

## 5. Definition of Done (DoD) Canônica

Nenhuma tarefa ou PR pode ser mesclado na branch `main` sem atender integralmente a:

- [ ] A interface consome a API real (zero dependência de noop Supabase na fatia);
- [ ] O schema e inputs são validados com Zod;
- [ ] O `RequestContext` server-side é aplicado na rota;
- [ ] A autorização por objeto (*Object Auth*) foi comprovada;
- [ ] O isolamento de tenant foi verificado (teste A/B);
- [ ] A mutação é persistida no PostgreSQL e sobrevive a recarregamento de página;
- [ ] Efeitos derivados são idempotentes (não geram registros duplicados em caso de retry);
- [ ] Mensagens de erro e estados de loading/empty são explícitos na UI;
- [ ] Nenhum dado confidencial é exposto em logs;
- [ ] Testes unitários e de integração cobrem as novas regras;
- [ ] `npm run typecheck` executa sem erros;
- [ ] `npm run lint` executa sem erros;
- [ ] Documentação e ADRs atualizados (se houver decisão arquitetural).
