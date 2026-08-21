-- Duas vistas de leitura para o painel. Nenhuma tabela muda aqui: cadastrar
-- canal pela interface é `insert into channels`, que já existe desde 0001.
--
-- ## 1. Quanto do plano free já foi
--
-- O limite que decide "cabe mais canal?" é DISCO, não egress — a marca d'água
-- (0005) tornou o custo de leitura fixo por rodada, então cada canal novo só
-- pesa no que ele grava. A conta que a 0006 fez à mão (posts/dia x 90 x 1,4 KB)
-- virou estimativa parada num comentário; aqui ela passa a ser medida.
--
-- `pg_total_relation_size` inclui índice e TOAST, que é o que o Supabase
-- cobra. `posts_search_idx` (gin) sozinho é uma fatia grande, e uma projeção
-- que só contasse a linha de texto erraria pra menos justamente onde importa.
create view archive_usage as
select
  (select count(*) from posts)                                   as posts_total,
  pg_total_relation_size('public.posts')                         as bytes_posts,
  pg_database_size(current_database())                           as bytes_db,
  -- Média dos últimos 7 dias, não do arquivo inteiro: canal entra e sai, e o
  -- que projeta o platô é o ritmo de agora.
  (select count(*) from posts
    where posted_at > now() - interval '7 days')::numeric / 7.0  as posts_por_dia,
  (select min(posted_at) from posts)                             as post_mais_antigo,
  (select count(*) from channels where is_active)                as canais_ativos;

-- ## 2. Por que a caça não dispara
--
-- A 0009 registrou que `tick_runs` não guarda hunt nem chat_id de propósito.
-- Esta vista mostra caça, mas **sem `chat_id`**: o painel responde "a faixa
-- está onde eu pensei?", que é pergunta de configuração, não de pessoa. Quem
-- pediu a caça continua fora do que a interface enxerga.
create view hunt_faixas as
select
  h.id,
  h.label,
  h.query,
  h.terms_any,
  h.terms_none,
  h.target_cents,
  h.tolerance_pct,
  h.price_min_cents,
  h.price_max_cents,
  h.last_alert_at,
  h.created_at,
  (select count(*) from alerts a where a.hunt_id = h.id and a.sent_at is not null) as alertas_enviados
from hunts h
where h.is_active;

-- ## 3. Remover canal pela interface
--
-- `posts.channel_slug` apontava pra `channels(slug)` sem ação de exclusão, e
-- com isso "remover canal" era impossível sem apagar o arquivo dele antes —
-- na prática o cadastro era só de ida. A rota de remoção apaga os posts em
-- lote (mesmo motivo da purga: `maxDuration` de 60s), mas o CASCADE fica como
-- rede: sem ele, um lote que erra por pouco deixa o canal preso pra sempre.
alter table posts drop constraint posts_channel_slug_fkey;
alter table posts
  add constraint posts_channel_slug_fkey
  foreign key (channel_slug) references channels(slug) on delete cascade;

-- Quantos posts cada canal tem no arquivo agora. A interface mostra isso antes
-- de confirmar a remoção: "apagar o canal X" e "apagar 12.400 posts" são
-- decisões diferentes, e só a segunda é irreversível de verdade.
create view channel_footprint as
select
  c.slug,
  c.title,
  c.kind,
  c.is_active,
  c.backfill_complete,
  c.created_at,
  coalesce(p.posts, 0)  as posts,
  p.ultimo_post_em
from channels c
left join (
  select channel_slug, count(*) as posts, max(posted_at) as ultimo_post_em
  from posts group by channel_slug
) p on p.channel_slug = c.slug;
