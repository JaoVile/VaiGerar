import { NextResponse } from "next/server";
import { autorizado, extrairEntrada, tratar, type Update } from "@/lib/bot/router";
import { createDb } from "@/lib/db/client";
import { readBotEnv } from "@/lib/env";

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

  const update = (await req.json()) as Update;
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
  }
  return NextResponse.json({ ok: true });
}
