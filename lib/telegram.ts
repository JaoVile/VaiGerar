export type InlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

const TIMEOUT_MS = 15_000;

/** Escapa o que o parse_mode HTML do Telegram interpreta. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * HTTP 429 do Telegram — "too many requests", com `retry_after` em segundos.
 * Tem classe própria porque quem chama precisa distinguir *este* erro dos
 * outros: 429 quer dizer "tenta de novo daqui a pouco", não "essa mensagem é
 * ruim". Quem conta tentativa (`lib/cron/alerts.ts`) devolve a linha intacta
 * para a fila em vez de queimar uma das 5 tentativas.
 */
export class TelegramRateLimitError extends Error {
  readonly retryAfterSec: number | null;
  constructor(metodo: string, retryAfterSec: number | null, corpo: string) {
    super(
      `Telegram ${metodo}: HTTP 429 (retry_after=${retryAfterSec ?? "?"}s) ${corpo.slice(0, 200)}`,
    );
    this.name = "TelegramRateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

/** Lê `parameters.retry_after` do corpo de erro do Telegram; null se não vier. */
function lerRetryAfter(corpo: string): number | null {
  try {
    const j = JSON.parse(corpo) as { parameters?: { retry_after?: unknown } };
    const v = j?.parameters?.retry_after;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * O Telegram recusa uma edição que não mudaria nada, com 400 e
 * "message is not modified".
 *
 * Tem tipo próprio porque **não é falha**: significa que o estado desejado já
 * vale. O caso real são dois toques rápidos no botão "mais ofertas" — o
 * segundo pede a mesma página. Sem isso o botão parava de responder e não
 * havia como o usuário saber por quê.
 */
export class TelegramNotModifiedError extends Error {
  constructor(readonly metodo: string) {
    super(`Telegram ${metodo}: mensagem já estava com esse conteúdo`);
    this.name = "TelegramNotModifiedError";
  }
}

async function chamar(token: string, metodo: string, corpo: unknown): Promise<void> {
  const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) {
    const texto = await r.text();
    if (r.status === 429) throw new TelegramRateLimitError(metodo, lerRetryAfter(texto), texto);
    if (r.status === 400 && texto.includes("message is not modified")) {
      throw new TelegramNotModifiedError(metodo);
    }
    throw new Error(`Telegram ${metodo}: HTTP ${r.status} ${texto.slice(0, 200)}`);
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

export async function editMessageText(
  token: string,
  chatId: number,
  messageId: number,
  html: string,
  opts: { keyboard?: InlineKeyboard } = {},
): Promise<void> {
  try {
    await chamar(token, "editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      ...(opts.keyboard ? { reply_markup: opts.keyboard } : {}),
    });
  } catch (e) {
    // Engolido aqui, e não em cada chamador, porque para quem pede uma edição
    // "já está assim" é indistinguível de sucesso. Só a edição tolera isso: em
    // `sendMessage` a mesma resposta seria comportamento inesperado do
    // Telegram, e esconder atrapalharia o diagnóstico.
    if (e instanceof TelegramNotModifiedError) return;
    throw e;
  }
}

export async function answerCallbackQuery(token: string, id: string): Promise<void> {
  await chamar(token, "answerCallbackQuery", { callback_query_id: id });
}
