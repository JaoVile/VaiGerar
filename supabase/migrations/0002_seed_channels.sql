insert into channels (slug, title, kind) values
  ('ctofertascelulares',            'CT Ofertas | Celulares',   'tech'),
  ('TudoPromo',                     'TudoPromo (TudoCelular)',  'tech'),
  ('jgtechofertas',                 'JG Ofertas',               'tech'),
  ('gtOFERTAS',                     'gt.OFERTAS',               'tech'),
  ('Chinacuponsbr',                 'China Cupons BR',          'china'),
  ('CuponsAliExpressChinaCuponsBR', 'Cupons AliExpress',        'china'),
  ('AliexpresspromocoesecuponsBR',  'AliExpress Promoções BR',  'china')
on conflict (slug) do nothing;
