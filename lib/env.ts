export type Env = {
  supabaseUrl: string;
  supabaseServiceKey: string;
  cronSecret: string;
};

const REQUIRED = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET"] as const;

export function readEnv(source: Record<string, string | undefined> = process.env): Env {
  const missing = REQUIRED.filter((k) => !source[k]);
  if (missing.length > 0) {
    throw new Error(`Variáveis de ambiente faltando: ${missing.join(", ")}`);
  }
  return {
    supabaseUrl: source.SUPABASE_URL as string,
    supabaseServiceKey: source.SUPABASE_SERVICE_ROLE_KEY as string,
    cronSecret: source.CRON_SECRET as string,
  };
}

export type BotEnv = {
  telegramBotToken: string;
  telegramWebhookSecret: string;
  allowedChatIds: number[];
};

const BOT_REQUIRED = [
  "TELEGRAM_BOT_TOKEN_OFERTAS",
  "TELEGRAM_WEBHOOK_SECRET",
  "ALLOWED_CHAT_IDS",
] as const;

/**
 * Lista separada por vírgula de `chat_id`. Entrada inválida é descartada —
 * mas com barulho: um `ALLOWED_CHAT_IDS` mal digitado (aspas coladas, ponto e
 * vírgula no lugar da vírgula, id com espaço no meio) deixava a allowlist
 * vazia e o bot ignorava todo mundo em silêncio, sem log e sem erro. É o modo
 * de falha mais provável da primeira hora de operação, e o mais difícil de
 * diagnosticar de fora.
 *
 * Lista presente e sem nenhum id válido é erro de configuração, não
 * "ninguém autorizado" — por isso lança em vez de devolver `[]`.
 */
function parseChatIds(raw: string): number[] {
  const partes = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const ids: number[] = [];
  for (const parte of partes) {
    const n = Number(parte);
    // `Number.isInteger` já implica finito: descarta "abc", "12abc", "" e
    // também "1.5", que não é chat_id de coisa nenhuma.
    if (Number.isInteger(n)) ids.push(n);
    else console.warn(`ALLOWED_CHAT_IDS: entrada descartada, não é id numérico: ${parte}`);
  }

  if (ids.length === 0) {
    throw new Error(
      "ALLOWED_CHAT_IDS não tem nenhum chat_id válido — com a allowlist vazia o bot ignora todas as mensagens em silêncio. Confira o formato: números separados por vírgula.",
    );
  }
  return ids;
}

/**
 * Variáveis do bot, lidas à parte de propósito: o coletor roda sem elas.
 * Ver a justificativa no cabeçalho da Task 1 do plano.
 */
export function readBotEnv(source: Record<string, string | undefined> = process.env): BotEnv {
  const missing = BOT_REQUIRED.filter((k) => !source[k]);
  if (missing.length > 0) {
    throw new Error(`Variáveis do bot faltando: ${missing.join(", ")}`);
  }
  return {
    telegramBotToken: source.TELEGRAM_BOT_TOKEN_OFERTAS as string,
    telegramWebhookSecret: source.TELEGRAM_WEBHOOK_SECRET as string,
    allowedChatIds: parseChatIds(source.ALLOWED_CHAT_IDS as string),
  };
}
