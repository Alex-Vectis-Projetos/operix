# ADR-001: RequestContext Mandatório e Isolamento Multi-Tenant Server-Side

**Status**: Accepted  
**Data**: 2026-09-13  
**Decisores**: EverGreen Engineering Team  
**Fatia Afetada**: R0 — Fundação Técnica e Autoridade  

---

## Contexto

A auditoria técnica de segurança identificou que 16 de 20 domínios do Operix sofriam de falhas estruturais de isolamento (*BOLA/IDOR — CWE-639 / OWASP API1*). 

O middleware de autenticação existente (`requireAuth`) injetava apenas os dados brutos do JWT (`userId`, `email`, `role`) sem validar o contexto do tenant. Rotas da API confiavam em parâmetros `workspace_id` passados na query string ou no corpo da requisição pelo cliente, permitindo que um usuário autenticado acessasse ou modificasse recursos de outra empresa simplesmente forjando o identificador.

Além disso, a alteração de papel de um membro dentro de um workspace (`Membership.role`) propagava alterações para o papel global do usuário (`User.role`), quebrando a fronteira de autoridade da plataforma.

---

## Decisão

1. **Separação de Papéis**:
   - `User.role` representa a autoridade perante a plataforma Operix (`user` ou `platform_admin`).
   - `Membership.role` representa o papel corporativo dentro de um workspace (`owner`, `admin`, `technician`, `partner`, `client`).
   - Nenhuma mutação de membresia pode alterar o papel global de um usuário.

2. **Criação do `RequestContext` Server-Side**:
   - Toda requisição autenticada passa por um middleware que constrói um objeto imutável `RequestContext` (`req.ctx`).
   - O `workspaceId` ativo é resolvido no servidor, conferindo a existência de membresia ativa para o usuário.
   - O escopo de execução (`workspace` vs `technician_personal`) é determinado exclusivamente pelas políticas do servidor.

3. **Autorização de Objeto Deny-by-Default**:
   - Proibido executar consultas Prisma que não condicionem a busca ao `ctx.activeWorkspaceId` em entidades dependentes de tenant.
   - Técnicos vinculados recebem projeções restritas à sua própria autoria/atribuição (`scope = own`).

4. **Fechamento do Registro Público**:
   - O endpoint `POST /api/auth/register` deixa de aceitar papéis administrativos do cliente.

---

## Alternativas Consideradas

### Alternativa A: Manter resolução por parâmetro e criar validações manuais em cada controller
- **Por que foi rejeitada**: Frágil e propenso a esquecimentos. Com 189 endpoints, basta um desenvolvedor omitir a checagem manual para reintroduzir uma vulnerabilidade crítica de vazamento de dados.

### Alternativa B: Row-Level Security (RLS) via PostgreSQL Policies
- **Por que foi rejeitada nesta fase**: Como a API conecta via pool único do Prisma sem chave de sessão de banco por transação individual, a gestão de RLS aumentaria a complexidade de conexão e dificultaria testes automatizados locais. O `RequestContext` na camada de aplicação fornece a proteção necessária de forma testável e transparente.

---

## Consequências

### Positivas:
- Erradicação de BOLA/IDOR nas rotas migradas;
- Separação clara entre a empresa cliente (Workspace) e a plataforma Operix;
- Visibilidade garantida de que técnicos só enxergam seus próprios dados;
- Base pronta para testes A/B de isolamento reproduzíveis.

### Negativas / Trade-offs:
- Rotas que consumiam `workspaceId` livremente na query string devem ser adaptadas para respeitar o contexto injetado pelo servidor.
