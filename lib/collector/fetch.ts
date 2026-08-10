const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const TIMEOUT_MS = 15_000;

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
