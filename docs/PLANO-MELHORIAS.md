# Plano de melhorias

Atualizado em 2026-08-11, com o sistema em produção: 13 canais coletando,
~20 mil posts em janela de 3 meses, bot respondendo, 6 caças ativas, 233 testes.

Cada item traz o **problema com evidência medida** (não suposta), a abordagem,
e as decisões a tomar antes de escrever código.

## Ordem

| # | item | tipo | por que nessa posição |
|---|---|---|---|
| **0** | **Título e link do resultado** | **defeito** | está no ar e atrapalha todo uso |
| 1 | Provar o alerta em produção | verificação | o propósito do sistema nunca aconteceu |
| 2 | Guarda de prazo inerte | dívida | risco real de alerta duplicado |
| 3 | Casamento semântico | qualidade | teto de precisão atual |
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

## 1. Provar o alerta em produção

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

## 2. A guarda de prazo é inerte

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

## 3. Casamento semântico

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
