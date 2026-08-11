import { NextResponse } from "next/server";
import { autorizado, extrairEntrada, tratar, type Update } from "@/lib/bot/router";
import { createDb } from "@/lib/db/client";
import { readBotEnv } from "@/lib/env";
import { sendMessage } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  // readBotEnv() lança se faltar variável na Vercel. Fora de try/catch isso vira
  // 500, e o Telegram reenvia o mesmo update para sempre — laço infinito.
  let env: ReturnType<typeof readBotEnv>;
  try {
    env = readBotEnv();
  } catch (e) {
    console.error("Bot mal configurado:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: true });
  }

  if (req.headers.get("x-telegram-bot-api-secret-token") !== env.telegramWebhookSecret) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  // Invariante da rota: depois do check de secret acima, SEMPRE 200 — não
  // importa o que aconteça no caminho. O Telegram reenfileira em erro, e
  // qualquer coisa que reenviada pra sempre vira laço infinito: corpo
  // malformado, update com formato inesperado, chat fora da allowlist, ou
  // erro de verdade dentro de tratar(). Um único try/catch em volta de tudo
  // — em vez de um por chamada — garante que nada de novo que alguém
  // acrescente aqui nasça desprotegido.
  try {
    const update = (await req.json()) as Update;
    const entrada = extrairEntrada(update);
    if (entrada && autorizado(entrada.chatId, env.allowedChatIds)) {
      try {
        await tratar(createDb(), env.telegramBotToken, entrada);
      } catch (e) {
        console.error("Erro tratando update:", e instanceof Error ? e.message : e);
        // Avisa o usuário em vez de deixá-lo sem resposta nenhuma. Proteção
        // própria: se isso também falhar, engole — a rota tem que responder
        // 200 de qualquer jeito.
        try {
          await sendMessage(
            env.telegramBotToken,
            entrada.chatId,
            "Deu erro aqui do meu lado. Tenta de novo em instantes.",
          );
        } catch (e2) {
          console.error("Falha ao avisar usuário do erro:", e2 instanceof Error ? e2.message : e2);
        }
      }
    }
  } catch (e) {
    console.error("Erro processando update:", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true });
}
