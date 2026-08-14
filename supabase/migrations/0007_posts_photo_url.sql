-- Foto do anúncio, para o alerta chegar com imagem.
--
-- A URL é do CDN do Telegram (`cdn*.telesco.pe`), extraída da própria página
-- do canal no momento da coleta. Verificado em 13/08: abre de fora sem
-- autenticação (HTTP 200, image/jpeg, ~88 KB), e é o `sendPhoto` do Telegram
-- que a consome — nenhuma imagem passa por este servidor, então isto não
-- custa banda nem armazenamento além da própria string.
--
-- Medido em 100 posts de 5 canais: **98% têm foto**.
--
-- Posts já arquivados ficam com `null` — a coluna só é preenchida daqui pra
-- frente. Isso não atrapalha o alerta: ele só olha as últimas 48h
-- (`JANELA_HORAS` em `lib/cron/alerts.ts`), então em dois dias a cobertura
-- fica completa sozinha.
alter table posts
  add column if not exists photo_url text;

comment on column posts.photo_url is
  'Foto do anúncio no CDN do Telegram. Consumida pelo sendPhoto; null em post só de texto.';
