# Plano de melhorias — pós-lançamento

Escrito em 2026-08-11, com o sistema já em produção: 13 canais coletando,
~20 mil posts em janela de 3 meses, bot respondendo, 6 caças ativas.

Cada item traz o **problema com evidência real** (medida no arquivo, não
suposta), a abordagem, e as decisões que precisam ser tomadas antes de
escrever código.

## Ordem sugerida, e por quê

| # | item | por que nessa posição |
|---|---|---|
| 1 | Ranquear pela mediana | corrige o defeito mais visível no uso diário |
| 2 | Alerta com contexto de mediana | mesma ideia do 1, aplicada no outro lugar que você olha |
| 3 | Paginação do `/agora` | pedido direto, e depende do ranqueamento do 1 estar bom |
| 4 | Tendência de preço | única que cria capacidade nova; dado já está pago |
| 5 | Segundo bot (China) | separa conversa; schema já aguenta desde o dia 1 |
| 6 | Resumo diário | cortado do escopo original; menor urgência |

Os itens 1, 2 e 3 formam uma rodada coerente — os três mexem em como
resultado de busca é ordenado e apresentado.

---

## 1. Ranquear pela distância da mediana

**Problema, medido:** `/agora air fryer` devolve como primeiro resultado uma
**forma de silicone para** air fryer a R$10,30. `/agora mesa` devolve taça
para mesa posta a R$19,90. O termo casa; o produto não.

A causa é a ordenação: `lib/search/query.ts` ordena por `price_cents` e
`melhores` pega os 5 primeiros. Acessório barato sempre ganha o topo.

**Abordagem:** trocar a ordenação de `melhores` por distância da mediana.
Calcula-se a mediana do conjunto casado (já existe, `priceStats`), e ordena-se
por `|preço − mediana|`, ou por um escore que penalize desvio extremo para
baixo mais que para cima — uma forma de silicone a 96% abaixo da mediana afunda
sozinha, sem lista de palavras proibidas para manter eternamente.

**Decisão a tomar:** ordenar por distância pura trocaria "as 5 mais baratas"
por "as 5 mais típicas", o que não é o que você quer — você quer barato **e**
plausível. Provável saída: filtrar fora o que estiver muito abaixo da mediana
(um piso relativo, ex.: 40% dela) e **dentro do que sobrou** continuar
ordenando por preço crescente. Assim o topo continua sendo o mais barato de
verdade, sem acessório.

**Por que isso importa além da busca:** é o mesmo mecanismo que resolveria
estruturalmente as variantes de cupom (`FOLLOW-UPS.md` registra três já
encontradas). Lista de marcadores é manutenção infinita; piso relativo à
mediana afunda qualquer valor absurdo, inclusive os que ninguém previu.

## 2. Alerta com contexto de mediana

**Problema:** o alerta diz *"12% abaixo do teto da sua faixa"*. O teto foi você
que escolheu, então o número não informa nada sobre a oferta ser boa — só que
ela está dentro do que você pediu.

**Abordagem:** trocar por *"18% abaixo da mediana dos últimos 3 meses"*.
`processarAlertas` já tem o post e a caça; falta consultar a estatística do
termo da caça no momento do alerta.

**Decisão a tomar:** calcular a mediana a cada alerta custa uma consulta a mais
por entrega, dentro de um tick que já tem orçamento apertado
(`ORCAMENTO_ENTREGA_MS = 35s`, ver `FOLLOW-UPS.md`). Alternativa: guardar a
mediana na linha de `hunts`, recalculada uma vez por dia. Decidir antes de
implementar — a segunda é mais barata em tempo de tick e mais complexa em
estado.

**Cuidado:** manter também a informação de faixa. Ideal é a mensagem trazer as
duas leituras — quanto está abaixo da sua meta **e** quanto está abaixo do que
o mercado costuma cobrar.

## 3. Paginação do `/agora` — "ver mais ofertas"

**Pedido:** poder ver todas as ofertas encontradas, não só as 5 primeiras,
clicando num botão.

**A armadilha que decide o desenho:** `callback_data` do Telegram é limitado a
**64 bytes**. Não dá para carregar o termo buscado no botão — `mais:calça de
academia masculina:5` já é arriscado, e termo longo estoura silenciosamente.

**Abordagem:** o botão carrega só o deslocamento (`mais:5`, `mais:10`), e o
**termo vem da última busca guardada** em `bot_sessions` para aquele `chat_id`.
A tabela já existe e já é usada pelo fluxo do `/cacar`; o campo `data` é `jsonb`
e comporta `{ ultimaBusca: "air fryer", offset: 5 }`.

**Decisões a tomar:**

- **Conflito com o `/cacar`.** Hoje `bot_sessions` guarda uma sessão por chat, e
  o roteador decide o que fazer com texto livre olhando se existe sessão ativa.
  Guardar busca ali pode fazer o bot achar que está no meio de um `/cacar`.
  Duas saídas: um campo `flow` distinto (`"busca"` vs `"new_hunt"`) que o
  roteador respeita, ou uma tabela separada. A primeira é mais barata; a
  segunda não mistura conceitos. **Escolher antes de escrever código** — o
  roteador tem lógica de sessão que quebra fácil.
- **Expiração.** Sessão de `/cacar` expira em 10 min. Busca guardada com a
  mesma regra significa que clicar "ver mais" 15 minutos depois falha. Melhor
  um prazo maior para busca, ou uma mensagem clara de "essa busca expirou,
  manda de novo".
- **Quantas por página.** Hoje são 5. Telegram tem limite de ~4096 caracteres
  por mensagem, e cada oferta ocupa 2 linhas com link. 5 por página é
  conservador; 10 provavelmente cabe. Medir antes de escolher.
- **Editar ou mandar nova mensagem.** `editMessageText` mantém o chat limpo
  (uma mensagem que muda de conteúdo); mandar nova preserva o histórico das
  páginas já vistas. Preferir editar, com botões "◀ anterior" e "próxima ▶".

**Limite do teto de leitura:** `buscar` lê no máximo `TETO_LINHAS = 2000`. Para
termo com mais resultados que isso, "ver todas" é na verdade "ver as 2000
lidas". Documentar isso na mensagem quando o teto for atingido, em vez de
mentir que são todas.

## 4. Tendência de preço — "vale esperar?"

**Oportunidade:** o arquivo tem 3 meses de preço por produto e a busca só olha
o agregado. A pergunta que está por trás do projeto inteiro — *vale comprar
agora ou esperar?* — já tem dado para ser respondida.

**Abordagem:** agrupar os resultados casados por semana (ou quinzena) e mostrar
a mediana de cada período:

```
S25 Plus — últimos 3 meses
mai: R$ 4.190  ▇▇▇▇▇▇▇▇
jun: R$ 4.050  ▇▇▇▇▇▇▇
jul: R$ 3.990  ▇▇▇▇▇▇
ago: R$ 3.968  ▇▇▇▇▇▇
→ caindo ~2%/mês
```

Isso muda decisão de compra mais que saber o mínimo histórico.

**Limitação honesta, medida:** a janela de 3 meses dá amostra para celular de
linha S (62 a 91 anúncios) mas não para produto de baixo volume — dobrável
aparece **2 vezes** no período inteiro. Para esses, tendência não é calculável
e a mensagem precisa dizer isso em vez de desenhar uma linha com dois pontos.

**Decisão a tomar:** se tendência virar prioridade real, a janela de 3 meses
vira o gargalo. Voltar para 6 meses custa espaço (~75 mil posts, ~102 MB de
500 MB) — ainda folgado. Reavaliar a escolha feita em 2026-08-10.

## 5. Segundo bot — separar importados

**Situação:** o schema tem `channels.kind` (`tech`, `china`, `moda`, `casa`,
`geral`) e `hunts.bot_key` desde a primeira migration. Nunca foram usados.
Hoje AliExpress e Shopee se misturam com Amazon na mesma conversa.

**Abordagem:** criar o segundo bot no BotFather, acrescentar
`TELEGRAM_BOT_TOKEN_CHINA` ao `readBotEnv`, e rotear a entrega pelo `bot_key`
da caça. A rota de webhook já é `[bot]` — foi desenhada para dois desde o
início.

**Decisão a tomar:** o que define o `bot_key` de uma caça nova? Duas opções:
o bot em que o `/cacar` foi digitado (implícito, sem pergunta a mais), ou uma
pergunta explícita no fluxo. A primeira é mais natural e não alonga a conversa.

**Cuidado:** `ALLOWED_CHAT_IDS` é global hoje. Com dois bots, avaliar se a
allowlist deve ser por bot — provavelmente não, já que é o mesmo dono.

## 6. Resumo diário

**Foi cortado do escopo da Etapa C de propósito**, junto com `/resumo` e
`/config`, porque comando que configura funcionalidade inexistente é ruído.
O desenho está no spec original (§5 e §6 de
`docs/superpowers/specs/2026-08-05-cacador-ofertas-design.md`), incluindo o
schema já pronto em `user_settings` (`digest_enabled`, `digest_hour`,
`digest_sent_on`).

**O que ele responde que o alerta avulso não responde:** *"o S25 Plus apareceu
em 3 lojas hoje; mais barato R$3.519 na Amazon, mais caro R$3.899 no Magalu"* —
comparação entre lojas no mesmo dia.

**Decisão a tomar:** o alerta imediato já avisa. O resumo só se justifica se
agrupar de fato — se na maioria dos dias tiver uma linha só, vira ruído
diário. Medir quantos alertas por dia o sistema gera **depois** de as caças
começarem a disparar, antes de construir.

---

## Fora de escopo, e por quê

- **Camada LLM no matcher.** `lib/hunts/` foi isolado desde o começo para
  permitir isso sem reescrever nada, mas os itens 1 e 2 devem resolver a maior
  parte do problema de acessório sem custo de API nem dependência externa.
  Reavaliar só se sobrarem falsos positivos depois deles.
- **Consultar preço direto nas lojas.** Descartado no spec original por
  anti-bot e manutenção alta. Nada mudou.
- **Resolver encurtador de link por HTTP.** Uma requisição extra por post na
  ingestão, milhares por dia, para melhorar a detecção de loja em um canal.
  Só valeria restrito aos posts que viram alerta.
