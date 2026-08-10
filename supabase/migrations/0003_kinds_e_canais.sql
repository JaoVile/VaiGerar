-- Abre as categorias de canal além de tech/china e cadastra a segunda leva.
--
-- Contexto: os 7 canais iniciais eram todos tech ou importados da China. Para
-- a busca responder coisas como "calça de academia" ou "mesa de cabeceira",
-- o arquivo precisa de canais de moda, casa e geral.

alter table channels drop constraint channels_kind_check;
alter table channels add constraint channels_kind_check
  check (kind in ('tech', 'china', 'moda', 'casa', 'geral'));

-- Canais leves (~220 posts/dia somados): backfill normal de 6 meses.
insert into channels (slug, title, kind) values
  ('promocasinha',     'Promocasinha — casa',        'casa'),
  ('ofertasnasho',     'Ofertas na Sho (Shopee)',    'geral'),
  ('ofertasrelampago', 'Ofertas Relâmpago',          'geral'),
  ('ofertasmachomoda', 'Macho Moda — Ofertas',       'moda')
on conflict (slug) do nothing;

-- Canais pesados: entram com backfill_complete = true, ou seja, só coletam
-- daqui pra frente. Juntos fazem ~780 posts/dia; importar 6 meses deles seria
-- ~140 mil linhas de uma vez, contra um limite de ~367 mil no plano free do
-- Supabase. O histórico acumula a partir de hoje.
insert into channels (slug, title, kind, backfill_complete) values
  ('meunovoape',      'Meu Novo Apê — casa e móveis', 'casa', true),
  ('xetdaspromocoes', 'XET das Promoções — moda',     'moda', true)
on conflict (slug) do nothing;

-- Deliberadamente FORA: 'ofertasdodia' (~1.920 posts/dia). Sozinho seria dois
-- terços de todo o volume do arquivo, sem sinal proporcional — repost e
-- produto irrelevante poluiriam a mediana de preço, que é o que dá sentido
-- à busca histórica.
