-- =====================================================================
--  RESTAURAR UM BACKUP - começo do arquivo 1_dados.sql
--
--  ATENÇÃO: rodar este arquivo APAGA os dados atuais da loja e põe os do
--  backup no lugar. Antes, o banco precisa ter a estrutura: rode o
--  supabase/schema.sql. Passo a passo: README, seção "Backup".
--
--  Gerado pelo .github/workflows/backup.yml (este cabeçalho + pg_dump só
--  dos dados). Testado em tests/db/backup.test.mjs.
-- =====================================================================

-- Gatilhos desligados durante a carga: os dados já vêm calculados (sem
-- isso, cada variação ganharia de novo o movimento de "estoque inicial" e
-- os pedidos recalculariam estoque).
set session_replication_role = replica;

do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('truncate table public.%I cascade', t);
  end loop;
end;
$$;

