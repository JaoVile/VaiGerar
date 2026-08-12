# Plano de melhorias

Atualizado em 2026-08-12, com o sistema em produção: 25 canais coletando,
~20 mil posts em janela de 3 meses, bot respondendo, 6 caças ativas, 233 testes.

Cada item traz o **problema com evidência medida** (não suposta), a abordagem,
e as decisões a tomar antes de escrever código.

## Ordem

| # | item | tipo | por que nessa posição |
|---|---|---|---|
| ~~0~~ | ~~Título e link do resultado~~ | defeito | **feito em 11/08 e corrigido de novo em 12/08** |
| ~~1~~ | ~~Provar o alerta em produção~~ | verificação | **feito em 12/08 — ver abaixo** |
| ~~2~~ | ~~Guarda de prazo inerte~~ | dívida | **feito em 12/08** |
| ~~3~~ | ~~Casamento semântico~~ | qualidade | **feito em 12/08 no alerta** |
| 4 | Tendência de preço | capacidade nova | dado já pago |
| 5 | Cobertura onde o dado é fino | dado | dobrável e academia sem amostra |

Os itens 0 e 1 são baratos e devem vir juntos. O 2 é dívida com risco. O 3 é a
mudança que mais melhora precisão daqui pra frente.

---

## 0. Resultado sem informação útil — DEFEITO EM PRODUÇÃO

**Medido em 2026-08-11**, buscando `samsung s25 plus` (53 ofertas):
**44 delas (83%) mostram título inútil.**

O que o usuário vê hoje:

```
R$ 3.519,12 · samsung · 2026-08-01
🚨🚨                                ← isto é o link clicável
```

**Causa:** `primeiraLinha` em `lib/bot/format.ts` pega a primeira linha
não-vazia do post. Vários canais (o `ctofertascelulares` sempre) abrem o post
com uma linha só de emoji — `🚨🚨`, `😱😱`, `🔥🔥`. Essa linha vira o texto do
link, e o usuário não faz ideia do que está clicando.

**Segunda camada:** a coluna `product_url` — o link direto da loja — **está
gravada no banco e nunca é usada**. O link exibido aponta para o post do
Telegram; o usuário clica, cai no post, e precisa clicar de novo para chegar
na loja. Em canais que encurtam pelo domínio próprio (`canalte.ch`), são dois
saltos até o produto.

**Abordagem:**

- `primeiraLinha` passa a escolher a primeira linha com **conteúdo de verdade**,
  não a primeira não-vazia. Critério objetivo: pelo menos N caracteres
  alfanuméricos depois de remover emoji e pontuação (o teste que mediu usou
  12 como corte e separou bem os 44 casos ruins). Se nenhuma linha qualificar,
  cair no texto inteiro truncado em vez de mostrar emoji.
- Exibir **os dois links** quando existirem: o do post (contexto, comentários,
  cupom no texto) e o `product_url` (vai direto pra loja). Ou, se preferir uma
  linha só, usar o `product_url` como destino principal e deixar o post como
  secundário.

**Decisões a tomar:**

- **O corte de 12 caracteres é arbitrário.** Medir contra mais termos antes de
  fixar — o número saiu de uma amostra só. Vale testar 8, 12 e 20 sobre vários
  termos e ver qual separa melhor.
- **`product_url` pode ser encurtador do próprio canal** (`canalte.ch`), que
  não leva direto à loja e ainda passa pelo rastreio do canal. Não é mentira
  chamá-lo de "link da loja"? Talvez o rótulo deva ser neutro ("ir para a
  oferta") em vez de prometer a loja.
- **Emoji no meio do título** é aceitável; o problema é linha *só* de emoji.
  Não remova emoji do texto, só descarte a linha que não tem mais nada.

**Este item afeta também o alerta** (`formatAlerta` em `lib/cron/alerts.ts` usa
a mesma lógica de primeira linha) — corrigir nos dois lugares, ou extrair a
função para um único ponto.

## 1. Provar o alerta em produção — CONCLUÍDO em 2026-08-12

**Resultado.** Caça descartável (`air fryer`, R$150–600, 2 posts casando na
janela de 48h). O tick disparou `casados=1 enviados=1 falhos=0` e a mensagem
chegou. Dois ticks seguintes: `enviados=0`. A tabela `alerts` ficou com uma
linha só, `attempts=1`. Caça e alerta apagados depois.

**O que isso provou de verdade:** `casa()` contra post real, o claim atômico
com `claimed_at`, a entrega, o formato da mensagem, e o `unique(hunt_id,
post_row_id)` impedindo repetição — este último era a metade que só a
realidade provava.

**O que isso encontrou** (o motivo de o item existir): o alerta chegou com
`_*Promoção sujeita a alteração a qualquer momento_` como título. O item 0,
entregue no dia anterior, escolhia a linha mais longa do post — e a linha mais
longa costuma ser o aviso legal. Medido depois em 8.000 posts: **16,2% dos
títulos eram rodapé**, quase a mesma taxa do defeito de emoji que o item 0
tinha ido corrigir. Corrigido junto (ver seção 0). O alerta também não trazia
o `product_url`; agora traz.

**Lição pro próximo item:** a medição de 11/08 classificava título ruim como
"emoji, vazio ou frase genérica". Aviso legal não caía em nenhuma das três, e
por isso a taxa deu 0%. Métrica que não enxerga o defeito dá aprovação falsa —
o teste em produção enxergou em uma mensagem.

---

## 1-bis. Situação original (mantida para histórico)

**Situação:** nenhuma caça disparou desde que o sistema entrou no ar. Matching,
claim atômico, lease, entrega e formato de mensagem foram verificados por
teste — nunca pela realidade. As 6 caças ativas têm alvos 2–7% abaixo do mínimo
histórico, então podem ficar semanas sem disparar. Se algo estiver quebrado, a
descoberta acontece no dia em que uma oferta boa for perdida.

**Abordagem:** criar uma caça descartável com faixa propositalmente larga (ex.:
`fone bluetooth` entre R$50 e R$500, onde o arquivo tem 452 ofertas), esperar o
tick de 5 minutos, confirmar que o alerta chega ao Telegram com o formato certo,
e apagar a caça.

**O que isso prova de uma vez:** `casa()` contra dado real, o claim atômico com
o `claimed_at`, a entrega serializada por chat, a linha de mediana do alerta, e
o `unique(hunt_id, post_row_id)` impedindo repetição no tick seguinte.

**Cuidado:** confirmar que o alerta **não repete** no tick seguinte antes de
apagar a caça — é a metade do comportamento que só a realidade prova.

## 2. A guarda de prazo é inerte — CORRIGIDO em 2026-08-12

**O que mudou.** A guarda passou a ser checada dentro da fila de entrega,
imediatamente antes de cada `sendMessage`, em vez de uma vez só no início de
todas as chamadas. `filaPorChat` serializa por chat, então essa função só roda
quando a entrega anterior terminou — é o único ponto do caminho onde o relógio
já andou. A checagem antiga, antes do claim, continua lá (adia sem sujar a
linha), mas agora está documentada como não sendo a que morde.

Linha adiada dentro da fila volta limpa: mesmo desfazer do 429 (`attempts` ao
valor lido, `claimed_at` nulo). Sem isso o adiamento queimaria uma das
`MAX_TENTATIVAS` sem nunca tentar entregar.

**O teste.** O antigo injetava um `decorridoMs` que contava *chamadas* — ele
passava com a guarda inerte, que era o defeito. Três novos: um com relógio que
só anda dentro do `sendMessage`, um que confere a devolução limpa, e um com
`cronometro()` real e envio lento, como o plano exigia. Todos ficam vermelhos
se a guarda voltar pra "só na largada"; verificado por mutação.

`orcamentoMs` virou parâmetro injetável (default `ORCAMENTO_ENTREGA_MS`) —
sem isso não dá pra testar com relógio real sem esperar 35 s.

---

## 2-bis. Diagnóstico original (mantido para histórico)


**Medido:** `ORCAMENTO_ENTREGA_MS` (35s) deveria parar de iniciar envios perto
do fim do orçamento da função. Não funciona. `Promise.allSettled` invoca as 5
chamadas **sincronamente**, e `decorridoMs()` é a primeira instrução antes de
qualquer `await` — os cinco leem o mesmo instante (`[2,2,2,2,2]` ms numa
execução de 344 ms).

O teste passa porque o `decorridoMs` injetado conta **chamadas**, não tempo —
documenta um mecanismo que o relógio real não produz.

**Por que importa:** essa guarda foi a correção de uma regressão de timeout
(serialização por chat elevou o pior caso do tick de ~32s para ~92s contra 60s
de `maxDuration`). A regressão continua sem defesa efetiva, e estourar o
`maxDuration` é o gatilho realista da entrega duplicada.

**Abordagem:** a guarda precisa ser checada **entre** os envios, não no início
de todos. Duas saídas: serializar o laço de entrega com checagem de prazo a
cada iteração (perde o paralelismo entre chats distintos, que hoje é
irrelevante porque o sistema é mono-usuário), ou manter o paralelismo e checar
o prazo dentro da fila por chat, antes de cada `sendMessage`.

**Decisão a tomar:** o teste precisa usar relógio de verdade (com envios
artificialmente lentos) em vez de contador de chamadas, senão o próximo
mecanismo também vai parecer funcionar sem funcionar.

## 3. Casamento semântico — FEITO no alerta em 2026-08-12

**A medição contradisse este plano.** Contando, em 12.000 posts reais, quantos
casamentos por substring estavam errados:

| modo de erro | frequência |
|---|---:|
| modelo base casando o superior (`galaxy s25` -> Ultra/FE/Plus) | **61%** (48 de 79) |
| termo como modificador ("ventilador **de mesa**") | 27% em "mesa", 1-2% nos outros |
| frase de comparação ("concorre com o Z Fold7") | **0,20%** dos posts |
| termo colado dentro de palavra maior | **4 a 9 posts em 12.000** |

O plano propunha **limite de palavra**, que resolve só a última linha — a mais
rara — e **não resolve nenhum dos dois exemplos que o próprio plano cita**.

`lib/hunts/termo.ts` ataca as duas primeiras: tokeniza preservando o `+`
(`s25+` e `s25` são caças diferentes, com alvos de R$ 3.000 e R$ 2.600),
rejeita quando o token seguinte é qualificador de linha (plus/ultra/edge/fe/
pro/max/lite/mini/neo) e rejeita quando o anterior é preposição. Verificado no
arquivo: de 84 posts com "galaxy s25" e preço, **69 são rejeitados** — S25+,
FE, Ultra e Edge — e os 15 aprovados são todos S25 base.

`termsNone` **continua por substring de propósito**: é lista de veto, onde
rejeitar demais custa muito menos que deixar passar. "capa" pegando "capinha"
é o comportamento desejado.

**Falta:** aplicar o mesmo casamento na busca (`/agora`), que usa full-text do
Postgres e tem o problema do "ventilador de mesa". A frase de comparação
(0,20%) ficou fora — não paga a lista de padrões.

---

## 3-bis. Análise original (mantida para histórico)


**Problema, com dois casos reais:** `casa()` e a busca usam `includes` sobre
texto normalizado. Consequências medidas:

- `/agora mesa` traz **ventilador de mesa** no topo (preço plausível, o piso
  não pega)
- um post do **Huawei Mate X6** casou com uma busca por Z Fold porque o texto
  dizia *"concorre diretamente com o Samsung Galaxy Z Fold7"*

O piso de 25% resolveu preço absurdo. Isto é o outro lado: o termo casa, o
produto não.

**Abordagem:** casamento por limite de palavra em vez de substring.

**A dificuldade real:** `s25+` tem `+`, que não é caractere de palavra; hífen e
acento também quebram `\b` em JS (já mordeu nesta base — em `"só"`, existe
fronteira de palavra depois do `s`). Precisa de tokenização própria, não de
`\b`.

**Decisão a tomar:** limite de palavra sozinho não resolve o caso do Huawei —
lá o termo aparece de verdade, só que numa frase de comparação. Isso exigiria
detectar contexto ("concorre com", "igual ao", "melhor que"), que é lista de
padrões, ou uma camada LLM. Decidir até onde ir antes de começar; a parte de
limite de palavra é barata e cobre a maioria.

## 4. Tendência de preço

**Oportunidade:** o arquivo tem 3 meses de preço por produto e só responde o
agregado. A pergunta que originou o projeto — *comprar agora ou esperar?* — já
tem dado.

```
S25 Plus — últimos 3 meses
mai: R$ 4.190  ▇▇▇▇▇▇▇▇
jun: R$ 4.050  ▇▇▇▇▇▇▇
jul: R$ 3.990  ▇▇▇▇▇▇
ago: R$ 3.968  ▇▇▇▇▇▇
→ caindo ~2%/mês
```

**Limitação medida:** celular de linha S tem 53 a 91 anúncios em 3 meses —
amostra suficiente. Dobrável tem **2**. Para esses, tendência não é calculável
e a mensagem precisa dizer isso em vez de desenhar reta com dois pontos.

**Decisão a tomar:** se tendência virar prioridade, a janela de 3 meses vira o
gargalo. Voltar para 6 meses custa ~102 MB de 500 — folgado. Reavaliar a
escolha feita em 2026-08-10.

## 5. Cobertura onde o dado é fino

**Medido:** dobrável aparece 2 vezes em 3 meses; não existe canal de
fitness/suplemento vivo no cadastro (os que os sites listam estão mortos —
`achadosacademia` parou em dezembro/2024).

**Abordagem:** canais de **loja específica** em vez de agregador — Centauro,
Netshoes, Growth para academia. Verificar cada um com `t.me/s/<slug>` antes de
cadastrar: dos 23 candidatos testados em 2026-08-10, **8 estavam mortos** apesar
de listados como ativos.

**Cuidado com o volume:** canal novo entra em `channels` e passa a contar no
teto do free tier. A purga de 3 meses estabiliza, mas cada canal sobe o platô.

---

## Fora de escopo, e por quê

- **Camada LLM no matcher.** `lib/hunts/` foi isolado para permitir isso sem
  reescrever nada, mas o item 3 deve resolver a maior parte sem custo de API.
  Reavaliar depois dele.
- **Consultar preço direto nas lojas.** Descartado no spec original por
  anti-bot e manutenção alta. Nada mudou.
- **Segundo bot (China) e resumo diário.** Continuam válidos, mas são
  organização e conveniência — os itens acima são correção e precisão.
  Descritos no histórico deste documento e no spec original.
