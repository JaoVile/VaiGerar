import type { SupabaseClient } from "@supabase/supabase-js";
import { iniciar, receber, type Step } from "@/lib/bot/flows/new-hunt";
import {
  type CacaResumo,
  formatAjuda,
  formatCacas,
  formatCupons,
  formatMenorAtual,
  formatTendencia,
  formatSearchPagina,
} from "@/lib/bot/format";
import { criarHunt, desativarHunt, listarHunts } from "@/lib/bot/hunts-repo";
import { menorAtualPorCaca } from "@/lib/hunts/atual";
import { FLOW_BUSCA, FLOW_CACA, lerSessao, limparSessao, salvarSessao } from "@/lib/bot/session";
import { buscarCupons } from "@/lib/search/coupons";
import { buscar } from "@/lib/search/query";
import { tendencia } from "@/lib/search/trend";
import { answerCallbackQuery, editMessageText, sendMessage } from "@/lib/telegram";

export type Update = {
  message?: { chat: { id: number }; text?: string };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number }; message_id?: number };
  };
};

export type Entrada = {
  chatId: number;
  texto: string;
  callbackId?: string;
  messageId?: number;
};

/** Itens por página do `/agora`. Ver `docs/PLANO-MELHORIAS.md` (item 3). */
const POR_PAGINA = 5;
/**
 * Quantas ofertas ficam disponíveis para paginar. `buscar` sempre lê até
 * `TETO_LINHAS = 2000` linhas do banco e calcula sort/stats sobre o conjunto
 * inteiro, não importa este número — `limite` só corta um `.slice` em
 * memória no final (`lib/search/query.ts`), então não há economia de
 * consulta aqui, só controle de quanto fica disponível pro "ver mais". 50 dá
 * 10 páginas de 5: o suficiente pra a navegação ser útil sem virar uma
 * segunda paginação por trás da paginação.
 */
const LIMITE_PAGINACAO = 50;
/** Sessão de busca dura mais que a de `/cacar`: voltar num resultado depois é normal. */
const EXPIRA_BUSCA_MIN = 60;
/**
 * `salvarSessao` sobrescreve qualquer sessão existente (`chat_id` é PK,
 * upsert com `onConflict`). Sem este aviso, `/agora` no meio de um `/cacar`
 * em andamento perderia o progresso da caça em silêncio — perda explícita é
 * aceitável, silenciosa não.
 */
const AVISO_CACA_CANCELADA = "Sua caça em andamento foi cancelada. Use /cacar pra recomeçar.";

/**
 * Clique de botão vira texto: `tol:10` → `10`, `del:<id>` → `del:<id>`,
 * `pag:5` → `pag:5` (mantido intacto — quem trata isso precisa do offset).
 * Interpreta payload de terceiro (o Telegram): qualquer parte que faltar —
 * corpo `null`, `callback_query.message` vazio, `message` sem `chat` — devolve
 * `null` em vez de lançar, independentemente de quem chama estar protegido.
 */
export function extrairEntrada(u: Update): Entrada | null {
  const cb = u?.callback_query;
  const cbChatId = cb?.message?.chat?.id;
  // `data` vem de `req.json() as Update` — um cast sem checagem em runtime.
  // Truthiness não basta: `data` numérico é truthy e não tem `.startsWith`.
  if (cbChatId !== undefined && typeof cb?.data === "string" && cb.data) {
    const texto = cb.data.startsWith("tol:") ? cb.data.slice(4) : cb.data;
    // messageId só existe em clique de botão — é o que permite editar a
    // mesma mensagem em vez de mandar uma nova a cada página.
    return {
      chatId: cbChatId,
      texto,
      callbackId: cb.id,
      messageId: cb.message?.message_id,
    };
  }
  const m = u?.message;
  const mChatId = m?.chat?.id;
  if (mChatId !== undefined && typeof m?.text === "string" && m.text) {
    return {
      chatId: mChatId,
      texto: m.text,
      callbackId: undefined,
      messageId: undefined,
    };
  }
  return null;
}

export function autorizado(chatId: number, permitidos: number[]): boolean {
  return permitidos.includes(chatId);
}

/**
 * Busca, guarda a sessão de paginação (60 min, `flow = FLOW_BUSCA`) e manda a
 * primeira página. Usado tanto por `/agora <termo>` quanto por texto livre
 * sem sessão de caça ativa — os dois caminhos têm que se comportar igual.
 */
async function buscarEEnviar(
  db: SupabaseClient,
  token: string,
  chatId: number,
  termo: string,
): Promise<void> {
  // `/agora` chega aqui sem passar pela checagem de sessão de `tratar` — se
  // houver uma caça em andamento, `salvarSessao` logo abaixo vai
  // sobrescrevê-la. Avisa antes de fazer isso, em vez de deixar o usuário
  // descobrir sozinho que a caça sumiu.
  const sessaoAnterior = await lerSessao(db, chatId);
  if (sessaoAnterior && sessaoAnterior.flow === FLOW_CACA) {
    await sendMessage(token, chatId, AVISO_CACA_CANCELADA);
  }

  const r = await buscar(db, termo, { limite: LIMITE_PAGINACAO });
  await salvarSessao(db, chatId, FLOW_BUSCA, "resultado", { termo }, new Date(), EXPIRA_BUSCA_MIN);
  const pagina = formatSearchPagina(r, 0, POR_PAGINA);
  await sendMessage(token, chatId, pagina.texto, { keyboard: pagina.keyboard });
}

export async function tratar(db: SupabaseClient, token: string, entrada: Entrada): Promise<void> {
  const { chatId, texto } = entrada;
  if (entrada.callbackId) await answerCallbackQuery(token, entrada.callbackId);

  if (texto.startsWith("del:")) {
    const desativou = await desativarHunt(db, texto.slice(4), chatId);
    await sendMessage(
      token,
      chatId,
      desativou ? "Caça desativada." : "Não achei essa caça — talvez já tenha sido excluída.",
    );
    return;
  }

  if (texto === "min:agora") {
    // Mensagem nova em vez de `editMessageText`: o /cacas de origem tem os
    // botões de excluir, e substituir o texto dele apagaria a única forma de
    // apagar uma caça. Além disso as duas respostas são leituras diferentes e
    // faz sentido poder comparar as duas na tela.
    await sendMessage(token, chatId, formatMenorAtual(await menorAtualPorCaca(db, chatId)));
    return;
  }

  if (texto.startsWith("pag:")) {
    const offsetPedido = Number(texto.slice(4));
    const offset = Number.isFinite(offsetPedido) ? offsetPedido : 0;
    const sessao = await lerSessao(db, chatId);
    const termo = sessao?.flow === FLOW_BUSCA ? sessao.data.termo : undefined;
    if (typeof termo !== "string") {
      await sendMessage(token, chatId, "Essa busca expirou. Manda o termo de novo.");
      return;
    }
    const r = await buscar(db, termo, { limite: LIMITE_PAGINACAO });
    const pagina = formatSearchPagina(r, offset, POR_PAGINA);
    if (entrada.messageId !== undefined) {
      await editMessageText(token, chatId, entrada.messageId, pagina.texto, {
        keyboard: pagina.keyboard,
      });
    } else {
      // Sem messageId não dá pra editar — acontece só se o payload do
      // Telegram vier incompleto. Manda nova em vez de falhar em silêncio.
      await sendMessage(token, chatId, pagina.texto, {
        keyboard: pagina.keyboard,
      });
    }
    return;
  }

  const limpo = texto.trim();
  const comando = limpo.split(/\s+/)[0].toLowerCase();

  if (comando === "/ajuda" || comando === "/start") {
    await limparSessao(db, chatId);
    await sendMessage(token, chatId, formatAjuda());
    return;
  }

  if (comando === "/cacas") {
    const hs = (await listarHunts(db, chatId)).filter((h) => h.isActive);
    if (hs.length === 0) {
      await sendMessage(token, chatId, "Nenhuma caça ativa. Use /cacar para criar.");
      return;
    }
    // Até 6 consultas ao mercado, uma por caça — sob demanda, fora do `tick`.
    // Se uma falhar, `null` nos dois campos em vez de derrubar o /cacas
    // inteiro: o usuário prefere ver 5 caças com dado e uma sem, a não ver nada.
    const itens: CacaResumo[] = await Promise.all(
      hs.map(async (h) => {
        let melhorAtualCents: number | null = null;
        let medianaCents: number | null = null;
        try {
          const r = await buscar(db, h.query, { limite: 1 });
          melhorAtualCents = r.melhores[0]?.priceCents ?? null;
          medianaCents = r.stats?.medianCents ?? null;
        } catch {
          // mantém null nos dois campos — ver comentário acima.
        }
        return {
          label: h.label,
          priceMinCents: h.priceMinCents,
          priceMaxCents: h.priceMaxCents,
          melhorAtualCents,
          medianaCents,
        };
      }),
    );
    await sendMessage(token, chatId, formatCacas(itens), {
      keyboard: {
        inline_keyboard: [
          // Primeira linha: o menor preço que está de pé AGORA, que é outra
          // pergunta da que o corpo do /cacas responde (menor do arquivo de
          // MESES_PADRAO meses, possivelmente encerrado).
          [{ text: "💰 Menor preço agora", callback_data: "min:agora" }],
          ...hs.map((h) => [
            // `label` é texto do usuário: um produto como "tv <50 polegadas" faz o
            // Telegram recusar a mensagem inteira ("can't parse entities") — e como
            // o botão de excluir vive DENTRO desta mensagem, /cacas ficaria travado
            // para sempre, sem jeito de apagar a caça que o trava. O texto do
            // botão fica cru de propósito (não é parseado como HTML).
            { text: `Excluir ${h.label}`, callback_data: `del:${h.id}` },
          ]),
        ],
      },
    });
    return;
  }

  if (comando === "/cacar") {
    const out = iniciar();
    await salvarSessao(db, chatId, FLOW_CACA, "ask_product", out.data, new Date());
    await sendMessage(token, chatId, out.texto);
    return;
  }

  if (comando === "/tendencia" || comando === "/tendência") {
    const termo = limpo.slice(comando.length).trim();
    if (!termo) {
      await sendMessage(
        token,
        chatId,
        [
          "Use assim: <code>/tendencia galaxy s25 plus</code>",
          "",
          'Só funciona com <b>modelo específico</b>. Categoria ("air fryer", "notebook") não tem tendência calculável — o preço mediano sobe e desce porque o mix de anúncios muda, não o mercado.',
        ].join("\n"),
      );
      return;
    }
    await sendMessage(token, chatId, formatTendencia(await tendencia(db, termo)));
    return;
  }

  if (comando === "/cupom" || comando === "/cupons") {
    const loja = limpo.slice(comando.length).trim();
    if (!loja) {
      await sendMessage(
        token,
        chatId,
        [
          "Use assim: <code>/cupom amazon</code>",
          "",
          "Lojas com mais cupom no arquivo: <code>amazon</code>, <code>mercado livre</code>, <code>magalu</code>, <code>shopee</code>, <code>kabum</code>, <code>aliexpress</code>.",
        ].join("\n"),
      );
      return;
    }
    // Sem try/catch aqui de propósito: quem chama esta função já embrulha tudo
    // num try que responde 200, pra o Telegram não reenviar o update em laço.
    const r = await buscarCupons(db, loja);
    await sendMessage(token, chatId, formatCupons(r));
    return;
  }

  if (comando === "/agora") {
    const termo = limpo.slice(comando.length).trim();
    if (!termo) {
      await sendMessage(token, chatId, "Use assim: <code>/agora air fryer</code>");
      return;
    }
    await buscarEEnviar(db, token, chatId, termo);
    return;
  }

  const sessao = await lerSessao(db, chatId);
  if (sessao && sessao.flow === FLOW_CACA) {
    // O passo que pede o produto precisa da estatística para o passo seguinte.
    const stats = sessao.step === "ask_product" ? (await buscar(db, texto)).stats : null;
    const out = receber(sessao.step, sessao.data, texto, stats);

    if (out.proximo === "done") {
      await criarHunt(
        db,
        chatId,
        out.data.produto as string,
        out.data.alvoCents as number,
        out.data.tolerancePct as number,
      );
      await limparSessao(db, chatId);
      await sendMessage(token, chatId, "✅ Caça criada. Te aviso quando aparecer.");
      return;
    }
    if (out.proximo === "cancel") {
      await limparSessao(db, chatId);
      await sendMessage(token, chatId, out.texto);
      return;
    }
    await salvarSessao(db, chatId, FLOW_CACA, out.proximo as Step, out.data, new Date());
    await sendMessage(token, chatId, out.texto, { keyboard: out.keyboard });
    return;
  }

  // Texto livre sem sessão de caça (nenhuma sessão, ou sessão de busca já
  // guardada) = busca nova. Uma sessão de busca ativa NÃO faz o texto virar
  // resposta de fluxo — só `flow === FLOW_CACA` faz isso, ver decisão no brief.
  await buscarEEnviar(db, token, chatId, texto);
}
