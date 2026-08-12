import type { SupabaseClient } from "@supabase/supabase-js";
import { formatBRL, tituloDoPost } from "@/lib/bot/format";
import { casa, type Hunt } from "@/lib/hunts/match";
import { buscar, MESES_PADRAO } from "@/lib/search/query";
import type { PriceStats } from "@/lib/search/stats";
import { escapeHtml, sendMessage, TelegramRateLimitError } from "@/lib/telegram";

export type AlertPost = {
  rowId: number;
  text: string;
  priceCents: number;
  store: string | null;
  url: string;
  postedAt: string;
};

const MAX_TENTATIVAS = 5;
/** Teto de posts que o casamento examina por tick, dentro da janela de data. */
const JANELA_POSTS = 500;
/**
 * Idade máxima do post que ainda pode virar alerta.
 *
 * Sem esse piso, a janela era "os 500 maiores `id`" — e `id` é `bigserial`,
 * ordem de *gravação*, não de publicação. O backfill grava post de março
 * agora, com id novo, então oferta morta entrava na janela como se fosse
 * recente e o usuário recebia link de promoção encerrada. Dois canais ainda
 * levam dias de backfill (ver `docs/OPERATIONS.md`), então não é hipotético.
 *
 * 48h, e não os 5 min do tick, para dar folga a atraso do agendador, deploy
 * parado ou fila represada — sem ressuscitar arquivo.
 */
const JANELA_HORAS = 48;
/**
 * Quantos alertas pendentes o tick tenta entregar. Baixo de propósito: cada
 * item é claim + 2 selects + `sendMessage` (timeout 15s) + 2 updates — 5
 * concorrentes mantêm o pior caso dentro do `maxDuration` de 60s da rota,
 * mesmo com `ingestAll` já tendo gasto parte do orçamento. O que sobrar fica
 * para o próximo tick, 5 minutos depois.
 *
 * Era 10, mas o paralelismo útil é *entre chats* (ver `filaPorChat`): o
 * sistema é mono-usuário, então os 10 iam todos para o mesmo chat, contra o
 * limite prático de ~1 msg/s por chat do Telegram — ou seja, pedindo 429.
 */
const LOTE_ENVIO = 5;
/**
 * Prazo do lease de claim, em ms. Um tick que reivindica uma linha e morre
 * no meio libera a linha depois deste prazo, sem intervenção manual.
 *
 * O gatilho realista dessa morte é **timeout da função** (o tick faz
 * `ingestAll` e mais até LOTE_ENVIO entregas de 15s de timeout cada, dentro
 * de `maxDuration` de 60s), não crash. E como o lease (2 min) é menor que o
 * intervalo do tick (5 min), a linha órfã sempre volta à fila no tick
 * seguinte — se o envio anterior tinha completado, isso é uma entrega
 * duplicada. É trade-off consciente (repetir alerta é melhor que perder), e
 * está registrado em `docs/FOLLOW-UPS.md`.
 */
const LEASE_MS = 2 * 60 * 1000;

/**
 * Orçamento de tempo, em ms, que `processarAlertas` pode gastar *iniciando*
 * envios antes de parar e deixar o resto pendente para o próximo tick.
 *
 * A conta: `maxDuration` da rota é 60s; o `ingestAll` que roda antes desta
 * função já pode ter consumido até ~15s; e um `sendMessage` individual tem
 * até 15s de timeout (`lib/telegram.ts`). Parar de *iniciar* novo envio ao
 * passar de 35s de processamento (medidos a partir do começo desta função)
 * dá folga pro último envio já iniciado terminar sem estourar o orçamento —
 * na prática o Telegram responde em centenas de ms, então esse teto raramente
 * chega a ser testado. Não é uma garantia matemática dos 60s no pior caso
 * absoluto (ingest e envio no limite ao mesmo tempo), só reduz muito a chance
 * frente ao que havia antes (ver `docs/FOLLOW-UPS.md`).
 *
 * Deliberadamente não é "reduzir o timeout de envio": isso viraria constante
 * mágica que se desatualiza quando `LOTE_ENVIO` ou a contagem de canais
 * mudar, e transformaria resposta lenta-porém-bem-sucedida em falha.
 */
const ORCAMENTO_ENTREGA_MS = 35_000;

/** Cronômetro real: a cada chamada devolve ms decorridos desde a criação. */
function cronometro(): () => number {
  const inicio = Date.now();
  return () => Date.now() - inicio;
}

/**
 * `stats` é a estatística de mercado da caça (mediana dos últimos
 * `MESES_PADRAO` meses, já com o piso de acessório aplicado por `buscar`) —
 * ou `null` quando a busca falhou ou não há dado suficiente. É enfeite, não
 * requisito: sem ela o alerta ainda sai, só sem a linha de mediana.
 *
 * As duas leituras são informações diferentes: o teto é o que o usuário
 * pediu ("atende seu pedido"); a mediana é o que o mercado cobra ("é bom
 * negócio").
 */
export function formatAlerta(hunt: Hunt, post: AlertPost, stats: PriceStats | null): string {
  const abaixoDaFaixa = Math.round((1 - post.priceCents / hunt.priceMaxCents) * 100);
  const loja = post.store ? ` · ${escapeHtml(post.store)}` : "";
  // Data do post, sempre: o preço sozinho não diz se a oferta ainda está de
  // pé. Mesmo com a janela de 48h, o usuário precisa ver do quando é o que
  // ele vai clicar — mesmo formato de `formatSearch` (AAAA-MM-DD).
  const quando = post.postedAt.slice(0, 10);
  // Mesma escolha de título de `formatSearch`/`formatSearchPagina` — extraída
  // para `tituloDoPost` em vez de duplicada, porque o defeito era o mesmo:
  // pegar a primeira linha do post derruba em cima de emoji de abertura
  // (`🚨🚨`, `😱😱`) em vez do nome do produto.
  const titulo = tituloDoPost(post.text, 80);

  const linhas = [
    `🎯 <b>${escapeHtml(hunt.label)}</b>`,
    `<b>${formatBRL(post.priceCents)}</b>${loja}`,
    `${abaixoDaFaixa}% abaixo do teto da sua faixa`,
  ];

  // A leitura que diz se a oferta é boa de verdade: o teto é escolha do
  // usuário, a mediana é o que o mercado cobra.
  if (stats) {
    const abaixoDoMercado = Math.round((1 - post.priceCents / stats.medianCents) * 100);
    linhas.push(
      `${abaixoDoMercado}% abaixo da mediana de ${MESES_PADRAO} meses (${formatBRL(stats.medianCents)})`,
    );
  }

  linhas.push(
    `postado em ${escapeHtml(quando)}`,
    `${escapeHtml(titulo)}`,
    `<a href="${escapeHtml(post.url)}">ver post</a>`,
  );
  return linhas.join("\n");
}

function toHunt(row: Record<string, unknown>): Hunt {
  return {
    id: row.id as string,
    chatId: row.chat_id as number,
    label: row.label as string,
    query: row.query as string,
    termsAny: row.terms_any as string[],
    termsNone: row.terms_none as string[],
    priceMinCents: row.price_min_cents as number,
    priceMaxCents: row.price_max_cents as number,
  };
}

type Enfileirar = <T>(chatId: number, tarefa: () => Promise<T>) => Promise<T>;

/**
 * Serializa por chat: duas tarefas com o mesmo `chatId` rodam uma depois da
 * outra; chats diferentes seguem em paralelo. O Telegram limita ~1 msg/s por
 * chat, então disparar o lote inteiro de uma vez no mesmo chat só produz 429.
 * Com um único usuário isso vira, na prática, entrega sequencial — que é o
 * comportamento correto aqui.
 *
 * A tarefa anterior é encadeada com `.then(t, t)`: falha de um envio não pode
 * cancelar o envio seguinte da mesma fila.
 */
function filaPorChat(): Enfileirar {
  const ultimo = new Map<number, Promise<unknown>>();
  return <T>(chatId: number, tarefa: () => Promise<T>): Promise<T> => {
    const anterior = ultimo.get(chatId) ?? Promise.resolve();
    const atual = anterior.then(tarefa, tarefa);
    // Guarda a versão "domada" na fila pra um erro aqui não virar
    // unhandled rejection quando ninguém mais der await nesta ponta.
    ultimo.set(
      chatId,
      atual.catch(() => undefined),
    );
    return atual;
  };
}

/**
 * Estatística de mercado da caça, com cache por invocação. A mediana é
 * calculada uma vez por caça que tem alerta pendente, não uma vez por
 * alerta — o `tick` tem orçamento apertado (`ORCAMENTO_ENTREGA_MS`) e
 * alertas da mesma caça sempre dariam o mesmo número.
 *
 * O cache guarda a *promise*, não o valor resolvido: `processarUmAlerta`
 * roda em paralelo via `Promise.allSettled`, então duas entregas da mesma
 * caça no mesmo lote podem chegar aqui antes de qualquer uma terminar o
 * `await buscar(...)`. Gravar só depois do `await` deixaria as duas passarem
 * pelo `cache.get()` como "vazio" e disparar duas consultas — exatamente o
 * que o cache existe pra evitar. Gravando a promise antes do `await`, a
 * segunda chamada concorrente reaproveita a mesma promise em vez de
 * disparar outra.
 *
 * É enfeite, não requisito: se `buscar` falhar, a promise resolve em `null`
 * (nunca rejeita) — o alerta sai sem a linha de mercado em vez de não sair.
 */
function statsDaCaca(
  db: SupabaseClient,
  hunt: Hunt,
  cache: Map<string, Promise<PriceStats | null>>,
): Promise<PriceStats | null> {
  const emCache = cache.get(hunt.id);
  if (emCache !== undefined) return emCache;
  const promessa = buscar(db, hunt.query)
    .then(({ stats }) => stats)
    .catch((e: unknown) => {
      console.error("Estatística da caça falhou:", e instanceof Error ? e.message : e);
      return null;
    });
  cache.set(hunt.id, promessa);
  return promessa;
}

export async function processarAlertas(
  db: SupabaseClient,
  token: string,
  agora: Date,
  /**
   * Ms decorridos desde o início desta chamada. Injetável pra teste não
   * precisar esperar `ORCAMENTO_ENTREGA_MS` de verdade; em produção é sempre
   * o relógio real, criado fresco a cada chamada (o default é reavaliado por
   * invocação, não compartilhado entre ticks).
   */
  decorridoMs: () => number = cronometro(),
): Promise<{
  casados: number;
  enviados: number;
  falhos: number;
  adiados: number;
}> {
  const { data: huntRows, error: huntErr } = await db
    .from("hunts")
    .select("*")
    .eq("is_active", true);
  if (huntErr) throw new Error(`Lendo caças: ${huntErr.message}`);
  const hunts = (huntRows ?? []).map(toHunt);

  let casados = 0;
  if (hunts.length > 0) {
    const desdeIso = new Date(agora.getTime() - JANELA_HORAS * 60 * 60 * 1000).toISOString();
    const { data: postRows, error: postErr } = await db
      .from("posts")
      .select("id,text,price_cents,store,url,posted_at")
      .not("price_cents", "is", null)
      .gte("posted_at", desdeIso)
      .order("id", { ascending: false })
      .limit(JANELA_POSTS);
    if (postErr) throw new Error(`Lendo posts para alerta: ${postErr.message}`);

    const novos: Array<{ hunt_id: string; post_row_id: number }> = [];
    for (const p of postRows ?? []) {
      for (const h of hunts) {
        if (casa(p.text as string, p.price_cents as number, h)) {
          novos.push({ hunt_id: h.id, post_row_id: p.id as number });
        }
      }
    }
    if (novos.length > 0) {
      // ignoreDuplicates + unique(hunt_id, post_row_id): reprocessar não duplica alerta.
      // O `.select("id")` é o que faz `casados` contar o que de fato entrou:
      // com `ON CONFLICT DO NOTHING` o PostgREST devolve só as linhas
      // inseridas, e sem ele o número seria o tamanho da janela casada —
      // constante para sempre, inútil no JSON que o runbook manda olhar.
      const { data: inseridos, error } = await db
        .from("alerts")
        .upsert(novos, {
          onConflict: "hunt_id,post_row_id",
          ignoreDuplicates: true,
        })
        .select("id");
      if (error) throw new Error(`Gravando alertas: ${error.message}`);
      casados = (inseridos ?? []).length;
    }
  }

  // Lease: uma linha só conta como "livre para reivindicar" se nunca foi
  // reivindicada ou se o claim anterior é mais velho que LEASE_MS. Isso é o
  // que falta pro `attempts` sozinho não bastar como trava — dois ticks que
  // leem a mesma linha (attempts=1, sent_at=null) dentro da janela de um
  // `sendMessage` em voo (até 15s) reivindicariam com o mesmo `attempts` e
  // entregariam a mesma mensagem duas vezes.
  const leaseCutoffIso = new Date(agora.getTime() - LEASE_MS).toISOString();
  const livre = `claimed_at.is.null,claimed_at.lt.${leaseCutoffIso}`;

  const { data: pendentes, error: pendErr } = await db
    .from("alerts")
    .select("id,hunt_id,post_row_id,attempts")
    .is("sent_at", null)
    .lt("attempts", MAX_TENTATIVAS)
    .or(livre)
    .limit(LOTE_ENVIO);
  if (pendErr) throw new Error(`Lendo alertas pendentes: ${pendErr.message}`);

  // Estatística de mercado por caça: um `Map` por invocação (nunca global —
  // vazaria entre execuções da função serverless), calculado na primeira vez
  // que a caça aparece no lote e reaproveitado pelos alertas seguintes dela.
  const statsPorHunt = new Map<string, Promise<PriceStats | null>>();

  // Cada alerta é independente — claim e leituras vão em paralelo (mesmo
  // padrão do `ingestAll`) pra não estourar o `maxDuration` da rota. Só o
  // `sendMessage` passa pela fila por chat. `allSettled` porque um item que
  // rejeitar (em vez de devolver "falho" pelo próprio catch interno) não pode
  // derrubar os outros.
  const enfileirar = filaPorChat();
  const resultados = await Promise.allSettled(
    (pendentes ?? []).map((a) =>
      processarUmAlerta(db, token, a, agora, leaseCutoffIso, enfileirar, decorridoMs, statsPorHunt),
    ),
  );

  let enviados = 0;
  let falhos = 0;
  let adiados = 0;
  for (const r of resultados) {
    if (r.status === "fulfilled") {
      if (r.value === "enviado") enviados++;
      else if (r.value === "falho") falhos++;
      else if (r.value === "adiado") adiados++;
      // "pulado" (não conseguiu o claim, ou 429 devolvido à fila) não conta
      // em nenhum dos dois.
    } else {
      falhos++;
      console.error("Falha inesperada ao processar alerta:", r.reason);
    }
  }

  return { casados, enviados, falhos, adiados };
}

type ResultadoAlerta = "enviado" | "falho" | "pulado" | "adiado";

async function processarUmAlerta(
  db: SupabaseClient,
  token: string,
  a: {
    id: number;
    hunt_id: string;
    post_row_id: number;
    attempts: number | null;
  },
  agora: Date,
  leaseCutoffIso: string,
  enfileirar: Enfileirar,
  decorridoMs: () => number,
  statsPorHunt: Map<string, Promise<PriceStats | null>>,
): Promise<ResultadoAlerta> {
  // Guarda de prazo, checada *antes* do claim de propósito: uma linha
  // adiada aqui não pode ganhar `attempts` nem `claimed_at` — ela tem que
  // voltar limpa pra fila. Checar antes evita ter que reverter o claim
  // (como o 429 faz mais abaixo) pra desfazer algo que nem precisava
  // acontecer. E só vale pra *iniciar* o envio: um que já começou termina
  // (ou estoura o próprio timeout de 15s do `sendMessage`), não é abortado
  // no meio.
  if (decorridoMs() > ORCAMENTO_ENTREGA_MS) return "adiado";

  // Claim atômico com lease: incrementa attempts e grava claimed_at,
  // condicionado ao attempts que acabamos de ler E à linha estar livre
  // (claimed_at nulo ou vencido). Se outro tick já reivindicou, nenhuma
  // condição casa, nada volta, e pulamos.
  const tentativasAntes = a.attempts ?? 0;
  const { data: claim, error: claimErr } = await db
    .from("alerts")
    .update({
      attempts: tentativasAntes + 1,
      claimed_at: agora.toISOString(),
    })
    .eq("id", a.id)
    .is("sent_at", null)
    .eq("attempts", tentativasAntes)
    .or(`claimed_at.is.null,claimed_at.lt.${leaseCutoffIso}`)
    .select("id");
  if (claimErr) {
    console.error("Falha ao reivindicar alerta:", claimErr.message);
    return "falho";
  }
  if (!claim || claim.length === 0) return "pulado";

  try {
    const { data: hRow } = await db.from("hunts").select("*").eq("id", a.hunt_id).single();
    const { data: pRow } = await db
      .from("posts")
      .select("id,text,price_cents,store,url,posted_at")
      .eq("id", a.post_row_id)
      .single();
    if (!hRow || !pRow) throw new Error("caça ou post sumiu");

    const hunt = toHunt(hRow);
    const stats = await statsDaCaca(db, hunt, statsPorHunt);
    const texto = formatAlerta(
      hunt,
      {
        rowId: pRow.id as number,
        text: pRow.text as string,
        priceCents: pRow.price_cents as number,
        store: pRow.store as string | null,
        url: pRow.url as string,
        postedAt: pRow.posted_at as string,
      },
      stats,
    );
    await enfileirar(hunt.chatId, () => sendMessage(token, hunt.chatId, texto));
    await db.from("alerts").update({ sent_at: agora.toISOString() }).eq("id", a.id);
    await db.from("hunts").update({ last_alert_at: agora.toISOString() }).eq("id", hunt.id);
    return "enviado";
  } catch (e) {
    if (e instanceof TelegramRateLimitError) {
      // 429 não é culpa desta linha — é ritmo. Desfaz o claim (attempts de
      // volta ao valor lido, claimed_at limpo) pra a linha voltar intacta à
      // fila no próximo tick. Sem isso, uma rajada de 429 queimaria as 5
      // tentativas e o alerta seria descartado em silêncio.
      console.warn(
        `429 do Telegram no alerta ${a.id}; devolvendo à fila`,
        e.retryAfterSec !== null ? `(retry_after=${e.retryAfterSec}s)` : "",
      );
      const { error: revErr } = await db
        .from("alerts")
        .update({ attempts: tentativasAntes, claimed_at: null })
        .eq("id", a.id);
      if (revErr) {
        // Não conseguiu reverter: a linha continua reivindicada até o lease
        // vencer (2 min) e com uma tentativa a mais. Degrada, não perde.
        console.error("Falha ao devolver alerta à fila após 429:", revErr.message);
      }
      return "pulado";
    }
    // attempts já foi incrementado no claim; não incrementa de novo.
    console.error("Falha ao entregar alerta:", e instanceof Error ? e.message : e);
    return "falho";
  }
}
