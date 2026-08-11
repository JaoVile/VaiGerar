import type { SupabaseClient } from "@supabase/supabase-js";
import { iniciar, receber, type Step } from "@/lib/bot/flows/new-hunt";
import { formatAjuda, formatBRL, formatSearch } from "@/lib/bot/format";
import { criarHunt, desativarHunt, listarHunts } from "@/lib/bot/hunts-repo";
import { lerSessao, limparSessao, salvarSessao } from "@/lib/bot/session";
import { buscar } from "@/lib/search/query";
import { answerCallbackQuery, sendMessage } from "@/lib/telegram";

export type Update = {
  message?: { chat: { id: number }; text?: string };
  callback_query?: {
    id: string;
    data?: string;
    message?: { chat: { id: number } };
  };
};

export type Entrada = { chatId: number; texto: string; callbackId?: string };

/**
 * Clique de botão vira texto: `tol:10` → `10`, `del:<id>` → `del:<id>`.
 * Interpreta payload de terceiro (o Telegram): qualquer parte que faltar —
 * corpo `null`, `callback_query.message` vazio, `message` sem `chat` — devolve
 * `null` em vez de lançar, independentemente de quem chama estar protegido.
 */
export function extrairEntrada(u: Update): Entrada | null {
  const cb = u?.callback_query;
  const cbChatId = cb?.message?.chat?.id;
  if (cbChatId !== undefined && cb?.data) {
    const texto = cb.data.startsWith("tol:") ? cb.data.slice(4) : cb.data;
    return { chatId: cbChatId, texto, callbackId: cb.id };
  }
  const m = u?.message;
  const mChatId = m?.chat?.id;
  if (mChatId !== undefined && m?.text) {
    return { chatId: mChatId, texto: m.text, callbackId: undefined };
  }
  return null;
}

export function autorizado(chatId: number, permitidos: number[]): boolean {
  return permitidos.includes(chatId);
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
    const linhas = hs.map(
      (h) => `• <b>${h.label}</b> — ${formatBRL(h.priceMinCents)} a ${formatBRL(h.priceMaxCents)}`,
    );
    await sendMessage(token, chatId, linhas.join("\n"), {
      keyboard: {
        inline_keyboard: hs.map((h) => [
          { text: `Excluir ${h.label}`, callback_data: `del:${h.id}` },
        ]),
      },
    });
    return;
  }

  if (comando === "/cacar") {
    const out = iniciar();
    await salvarSessao(db, chatId, "ask_product", out.data, new Date());
    await sendMessage(token, chatId, out.texto);
    return;
  }

  if (comando === "/agora") {
    const termo = limpo.slice(comando.length).trim();
    if (!termo) {
      await sendMessage(token, chatId, "Use assim: <code>/agora air fryer</code>");
      return;
    }
    await sendMessage(token, chatId, formatSearch(await buscar(db, termo)));
    return;
  }

  const sessao = await lerSessao(db, chatId);
  if (sessao) {
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
    await salvarSessao(db, chatId, out.proximo as Step, out.data, new Date());
    await sendMessage(token, chatId, out.texto, { keyboard: out.keyboard });
    return;
  }

  // Texto livre sem sessão = busca.
  await sendMessage(token, chatId, formatSearch(await buscar(db, texto)));
}
