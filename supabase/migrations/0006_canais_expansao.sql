-- Expansão do catálogo, 2026-08-12: de 16 para 25 canais.
--
-- Contexto: com a marca d'água (0005) o egress deixou de crescer com o número
-- de canais — o tick lê "novos desde a última execução + 100 de margem", que é
-- custo fixo. O limite passou a ser disco: platô = posts/dia x 90 x 1,4 KB.
-- Alvo de 60% dos 500 MB = ~2.400 posts/dia. Antes desta migration: 491/dia.
--
-- Todos verificados em 12/08 por `t.me/s/<slug>` E pelo parser real do
-- projeto. Dos 24 candidatos testados, 6 estavam MORTOS apesar de listados
-- como ativos (hilarioimports, XiaomiBR20, itechsul, aliexpressbroficial,
-- abarateou, gtofertas_import) e 5 foram REJEITADOS por serem canais de
-- cupom, onde o parser lê o valor do cupom como preço do produto e contamina
-- a mediana — o mesmo motivo pelo qual o `mmpromo` ficou de fora em 11/08:
--
--   ImportaHardwareCanal  "10% de desconto em R$0 (Limite de R$10)" -> R$10,00
--   FonesSpeakerCupons    "20% de desconto em R$39 (Limite de R$50)" -> R$50,00
--   PromoTVsCCBR          "R$15 de desconto em R$75" -> R$15,00
--   SoCuponsCCBR          idem, e é o mesmo conteúdo do PromoTVsCCBR
--   ofertanasho           "Sempre cliquem no link antes de comprar" -> R$10,00
--
-- Fonte dos candidatos: metade veio de busca na web, metade de minerar
-- menções a `t.me/<slug>` nos posts que o arquivo já tinha — este segundo
-- método é bem mais eficiente, achou o huskypromocoes com 131 menções.
insert into channels (slug, title, kind) values
  ('nerdofertas',           'Nerd Ofertas',                'geral'),
  ('pechinchou',            'Pechinchou',                  'geral'),
  ('TJGOFERTASs',           'TJ Gaming Ofertas',           'tech'),
  ('cuponsjersu',           'Jersu Indica (YouTuber)',     'tech'),
  ('ofertasmundoconectado', 'Mundo Conectado',             'tech'),
  ('ofertasgirouchegou',    'Girou Chegou Tech (YouTuber)','geral'),
  ('cupons_desconto',       'Promobit',                    'geral'),
  ('huskypromocoes',        'Husky Promoções',             'geral'),
  ('promoimporta',          'Promo Importa (AliExpress)',  'china')
on conflict (slug) do nothing;
