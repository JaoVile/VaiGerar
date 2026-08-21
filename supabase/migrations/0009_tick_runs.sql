-- Log de execução das rotas de cron.
--
-- Até aqui o relatório do tick só existia em dois lugares efêmeros: o JSON
-- devolvido pro cron-job.org (que ninguém lê) e o `console.error` da Vercel
-- (que expira e não dá pra cruzar entre rodadas). Na prática isso significa
-- que "esse canal está trazendo zero há quantos dias?" não tinha resposta —
-- e essa é exatamente a pergunta que o canário do tick existe pra fazer.
--
-- UMA LINHA POR RODADA, com os relatórios por canal em jsonb. É um log: lido
-- em ordem cronológica e mostrado inteiro. Tabela filha por canal daria
-- ~3.700 linhas/dia (288 ticks × 13 canais) pra responder as mesmas perguntas
-- que `jsonb_to_recordset` responde sobre 288 linhas/dia.

create table tick_runs (
  id           bigserial primary key,
  kind         text not null default 'tick'
                 check (kind in ('tick', 'backfill', 'reprocess', 'purge')),
  started_at   timestamptz not null,
  finished_at  timestamptz not null default now(),
  duration_ms  integer not null,

  -- Coleta.
  channels     integer not null default 0,
  fetched      integer not null default 0,
  saved        integer not null default 0,
  failed       integer not null default 0,
  all_empty    boolean not null default false,

  -- Alertas. Contagens agregadas de propósito: o painel não mostra hunt nem
  -- chat_id, então não há dado de pessoa nenhuma nesta tabela.
  alerts_matched  integer not null default 0,
  alerts_sent     integer not null default 0,
  alerts_failed   integer not null default 0,
  alerts_deferred integer not null default 0,

  -- Erro que derrubou a rodada inteira. Falha de canal isolado vai em `reports`.
  error        text,

  -- [{ slug, fetched, saved, error }]
  reports      jsonb not null default '[]'::jsonb,

  -- Derivado, não informado por quem escreve: o `status` de uma rodada é
  -- função dos números dela. Deixar isso pro código de escrita significaria
  -- duas definições de "degradado" que podem divergir.
  status       text generated always as (
                 case
                   when error is not null then 'error'
                   when all_empty         then 'canary'
                   when failed > 0        then 'degraded'
                   else 'ok'
                 end
               ) stored
);

-- O painel lê sempre "as N mais recentes", quase sempre filtrando por kind.
create index tick_runs_recent_idx on tick_runs (kind, started_at desc);
-- E destaca as rodadas que não foram 'ok' — parcial porque elas são a minoria.
create index tick_runs_problem_idx on tick_runs (started_at desc)
  where status <> 'ok';

-- Saúde por canal a partir das últimas 24h de rodadas de tick.
--
-- `jsonb_to_recordset` desmonta o array de relatórios em linhas; sem isso o
-- painel teria que baixar todas as rodadas e agregar no cliente, que é o tipo
-- de coisa que funciona com 13 canais e para de funcionar sem avisar.
create view channel_health as
select
  r.slug,
  count(*)                                          as runs,
  count(*) filter (where r.error is not null)       as failures,
  coalesce(sum(r.fetched), 0)                       as fetched,
  coalesce(sum(r.saved), 0)                         as saved,
  max(t.started_at) filter (where r.error is null and r.fetched > 0)
                                                    as last_productive_at
from tick_runs t
cross join lateral jsonb_to_recordset(t.reports)
  as r(slug text, fetched integer, saved integer, error text)
where t.kind = 'tick'
  and t.started_at > now() - interval '24 hours'
group by r.slug;
