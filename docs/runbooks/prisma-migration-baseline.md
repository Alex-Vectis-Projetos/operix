# Runbook: Prisma Migration Baseline & Dry-Run Gate

## 1. Contexto e Justificativa Teórica

O Operix é um sistema *brownfield* que anteriormente utilizava `prisma db push` em ambientes de desenvolvimento, resultando em bancos de dados que continham tabelas ativas sem o correspondente histórico formal registrado na tabela `_prisma_migrations`.

A tentativa de aplicar migrações incrementais (como a migração `20260814130000_add_customer_display_id`) a partir do zero falhava com erro `P3018 (42P01: relation "billing_clients" does not exist)` porque não havia migração inicial para criar as 44 tabelas fundacionais do sistema.

Para assegurar a conformidade com as Regras Arquiteturais Invioláveis da Operix (*Rule 4: Expand-Contract Database Migrations*) e o *Zero Trust CI/CD*, foi estabelecido um baseline formal reproduzível.

---

## 2. Estrutura do Histórico de Migrações

O diretório `backend/prisma/migrations/` segue uma cadeia estrita e determinística:

1. `20260814000000_init_baseline/migration.sql`:
   - DDL determinístico com as 44 tabelas do sistema, enums, índices e chaves estrangeiras que formam o estado inicial antes da Spec 002.
   - Não contém as colunas comerciais `customer_display_num` e `customer_display_id` na tabela `billing_clients`.

2. `20260814130000_add_customer_display_id/migration.sql`:
   - Migração incremental não-destrutiva que adiciona as colunas `customer_display_num` (INTEGER) e `customer_display_id` (TEXT), acompanhadas de seus respectivos índices únicos.
   - Alinhada com os tipos nativos do PostgreSQL mapeados pelo `schema.prisma`.

---

## 3. Procedimento Operacional

### A. Para Novos Ambientes / CI / Testes Limpos (Do Zero)

Em qualquer ambiente virgem, basta aplicar o histórico via Prisma Migrate:

```powershell
$env:DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/<database>?schema=public"
npx prisma migrate deploy
```

O comando executará as migrações em ordem sequencial e registrará o estado na tabela `_prisma_migrations`.

### B. Para Bancos Existentes (Brownfield sem `_prisma_migrations`)

Se um banco já possui as tabelas criadas previamente via `db push` ou dump:

1. **Resolver as migrações de baseline como aplicadas** (sem re-executar os DDLs existentes):
   ```powershell
   $env:DATABASE_URL="postgresql://<user>:<password>@<host>:<port>/<database>?schema=public"
   npx prisma migrate resolve --applied 20260814000000_init_baseline
   npx prisma migrate resolve --applied 20260814130000_add_customer_display_id
   ```

2. **Verificar a sincronização**:
   ```powershell
   npx prisma migrate status
   # Deve retornar: "Database schema is up to date!"
   ```

---

## 4. Gate de Verificação: Teste contra Banco Descartável (Dry-Run)

Antes de gerar qualquer nova migração no projeto, deve-se obrigatoriamente executar o *Dry-Run Gate*:

1. Criar um banco PostgreSQL descartável temporário:
   ```powershell
   docker exec operix-postgres psql -U operix_local -d postgres -c "DROP DATABASE IF EXISTS operix_disposable_test; CREATE DATABASE operix_disposable_test;"
   ```

2. Aplicar todas as migrações existentes:
   ```powershell
   $env:DATABASE_URL="postgresql://operix_local:U2dkA-cJYnwHuD7hiAY2hPTrkawjg6f8@127.0.0.1:55432/operix_disposable_test?schema=public"
   npx prisma migrate deploy
   ```

3. Verificar se há qualquer drift entre o banco migrado e o datamodel (`schema.prisma`):
   ```powershell
   npx prisma migrate diff `
     --from-url "postgresql://operix_local:U2dkA-cJYnwHuD7hiAY2hPTrkawjg6f8@127.0.0.1:55432/operix_disposable_test?schema=public" `
     --to-schema-datamodel prisma/schema.prisma `
     --exit-code
   # Exit code 0 e mensagem "No difference detected." comprovam que o histórico é 100% fiel ao datamodel.
   ```

4. Descartar o banco temporário após validação:
   ```powershell
   docker exec operix-postgres psql -U operix_local -d postgres -c "DROP DATABASE IF EXISTS operix_disposable_test;"
   ```
