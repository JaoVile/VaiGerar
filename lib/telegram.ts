export type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

const TIMEOUT_MS = 15_000;

/** Escapa o que o parse_mode HTML do Telegram interpreta. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function chamar(token: string, metodo: string, corpo: unknown): Promise<void> {
  const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) {
    throw new Error(`Telegram ${metodo}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
}

export async function sendMessage(
  token: string,
  chatId: number,
  html: string,
  opts: { keyboard?: InlineKeyboard } = {},
): Promise<void> {
  await chamar(token, "sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(opts.keyboard ? { reply_markup: opts.keyboard } : {}),
  });
}

export async function answerCallbackQuery(token: string, id: string): Promise<void> {
  await chamar(token, "answerCallbackQuery", { callback_query_id: id });
}
