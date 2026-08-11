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

  // Corpo malformado lança em req.json(). Fora de try/catch isso vira 500 pelo
  // mesmo motivo do readBotEnv() acima — e não é nem update de verdade, então
  // reenvio não ajudaria.
  let update: Update;
  try {
    update = (await req.json()) as Update;
  } catch (e) {
    console.error("Corpo do webhook inválido:", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: true });
  }

  const entrada = extrairEntrada(update);
  // Sempre 200: o Telegram reenfileira em erro, e update que não sabemos tratar
  // reenviado para sempre vira laço infinito.
  if (!entrada || !autorizado(entrada.chatId, env.allowedChatIds)) {
    return NextResponse.json({ ok: true });
  }

  try {
    await tratar(createDb(), env.telegramBotToken, entrada);
  } catch (e) {
    console.error("Erro tratando update:", e instanceof Error ? e.message : e);
    // Avisa o usuário em vez de deixá-lo sem resposta nenhuma. Proteção própria:
    // se isso também falhar, engole — a rota tem que responder 200 de qualquer jeito.
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
  return NextResponse.json({ ok: true });
}
