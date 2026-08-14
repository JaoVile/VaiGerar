-- Duas mudanças no motor de alerta, medidas em 2026-08-13.
--
-- ## 1. O piso da faixa parou de acompanhar a tolerância
--
-- `price_min_cents` era `alvo * (100 - tolerância) / 100`. Isso fazia a faixa
-- rejeitar oferta BOA DEMAIS: um Galaxy S26 5G 256GB real saiu por R$ 2.579 em
-- 25/05 e foi descartado porque o piso da caça era R$ 2.610 — R$ 31 acima. O
-- usuário tinha pedido R$ 2.900; a oferta era R$ 321 mais barata e o sistema
-- ficou calado.
--
-- A tolerância diz quanto ACIMA do alvo o usuário aceita. Abaixo do alvo é
-- sempre melhor. O piso só existe pra barrar lixo (capa de R$ 29 numa caça de
-- R$ 3.000), e pra isso metade do alvo basta.
--
-- Medido nas 6 caças ativas, 3 meses: +2 alertas ganhos, 0 lixo passando. O
-- que continua barrado são erros de leitura de preço (R$ 4,14 num S24 Ultra).
alter table hunts drop column price_min_cents;
alter table hunts
  add column price_min_cents integer
  generated always as (round(target_cents * 0.5)::integer) stored;

-- ## 2. Aviso de aproximação
--
-- As caças do usuário têm alvo 2% a 7% abaixo do que o mercado já praticou, e
-- por isso nunca dispararam em 3 meses. `kind` separa o alerta de faixa
-- ("caiu no que você pediu") do aviso de aproximação ("chegou perto"), que sai
-- quando o preço fica até MARGEM_AVISO acima do teto.
--
-- Medido com dedup em 3 meses: a 8% são 4,3 avisos/mês nas 6 caças e 2,7 nas
-- três que o usuário disputa. A 10% dobra; a 15% vira 27/mês, ruído diário.
alter table alerts
  add column if not exists kind text not null default 'faixa'
  check (kind in ('faixa', 'perto'));

comment on column alerts.kind is
  'faixa = caiu no que o usuario pediu; perto = ficou ate MARGEM_AVISO acima do teto.';
