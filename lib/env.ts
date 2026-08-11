export type Env = {
	supabaseUrl: string;
	supabaseServiceKey: string;
	cronSecret: string;
};

const REQUIRED = [
	"SUPABASE_URL",
	"SUPABASE_SERVICE_ROLE_KEY",
	"CRON_SECRET",
] as const;

export function readEnv(
	source: Record<string, string | undefined> = process.env,
): Env {
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

function parseChatIds(raw: string): number[] {
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
		.map(Number)
		.filter((n) => Number.isFinite(n));
}

/**
 * Variáveis do bot, lidas à parte de propósito: o coletor roda sem elas.
 * Ver a justificativa no cabeçalho da Task 1 do plano.
 */
export function readBotEnv(
	source: Record<string, string | undefined> = process.env,
): BotEnv {
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
