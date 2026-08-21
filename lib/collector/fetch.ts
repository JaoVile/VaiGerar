/**
 * Identificador próprio, com forma de contato.
 *
 * Era uma string de Chrome. Tecnicamente dava no mesmo — `t.me/robots.txt`
 * devolve 404, então não há diretiva sendo desobedecida —, mas fingir ser um
 * navegador tira do outro lado a chance de identificar e falar com quem está
 * lendo. Se um dia o Telegram quiser limitar ou avisar, agora tem como.
 */
const USER_AGENT = "cacador-ofertas/1.0 (+https://github.com/JaoVile/VaiGerar)";
/** Teto por canal. Exportado porque o painel mostra os limites da coleta. */
export const TIMEOUT_MS = 15_000;

export function channelPageUrl(slug: string, before?: number): string {
  const base = `https://t.me/s/${slug}`;
  return before === undefined ? base : `${base}?before=${before}`;
}

export async function fetchChannelPage(
  slug: string,
  before?: number,
  deps: { fetchFn: typeof fetch } = { fetchFn: fetch },
): Promise<string> {
  const response = await deps.fetchFn(channelPageUrl(slug, before), {
    headers: { "user-agent": USER_AGENT, "accept-language": "pt-BR,pt;q=0.9" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Canal ${slug}: HTTP ${response.status}`);
  }
  return response.text();
}
