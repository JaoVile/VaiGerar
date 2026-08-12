-- Marca d'água do casamento de alertas.
--
-- Motivo, medido em 2026-08-12: a consulta de casamento relê a janela inteira
-- de 48h a cada tick. São 378 KB por execução, 288 execuções por dia:
--
--   378 KB x 288 = 106 MB/dia = 3,11 GB/mês
--
-- O free tier do Supabase dá 5 GB/mês de egress. Ou seja, 62% do limite
-- gasto só nessa consulta, antes de coleta, backfill, busca e /cacas — e
-- crescendo junto com o volume de posts. Canal novo empurra pra fora.
--
-- Com a marca d'água o tick lê só o que entrou desde a última execução (mais
-- uma margem de segurança), o que derruba a leitura para dezenas de linhas.
--
-- `default 0` é de propósito: caça nova varre a janela de 48h inteira na
-- primeira vez, que é o comportamento esperado — quem cria uma caça quer
-- saber da oferta que já está de pé, não só das futuras.
alter table hunts
  add column if not exists last_post_row_id bigint not null default 0;

comment on column hunts.last_post_row_id is
  'Maior posts.id já examinado por esta caça. Ver MARGEM_IDS em lib/cron/alerts.ts.';
