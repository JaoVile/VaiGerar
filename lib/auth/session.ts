/**
 * Sessão do painel: cookie assinado com HMAC-SHA256, sem tabela e sem estado
 * no servidor.
 *
 * O painel mostra dado operacional de um sistema em produção — slug de canal,
 * contagem, e principalmente a mensagem de erro de quando um canal quebra.
 * Mensagem de erro conta como funciona o que está por baixo. O repositório é
 * público e o deploy também seria, então o painel precisa de porta.
 *
 * Web Crypto porque isto roda no middleware (Edge), onde `node:crypto` não
 * existe. Sem dependência nova.
 */

const ENCODER = new TextEncoder();

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    ENCODER.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export const COOKIE = "painel";
export const SESSION_HOURS = 12;

/** `<expiraEmMs>.<assinatura>` */
export async function signSession(secret: string, expiresAt: number): Promise<string> {
  const payload = String(expiresAt);
  const sig = await crypto.subtle.sign("HMAC", await key(secret), ENCODER.encode(payload));
  return `${payload}.${toBase64Url(sig)}`;
}

/**
 * Verifica assinatura e validade. `crypto.subtle.verify` já compara em tempo
 * constante — comparar string de assinatura com `===` vazaria o prefixo
 * correto byte a byte.
 */
export async function verifySession(secret: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const ponto = token.lastIndexOf(".");
  if (ponto <= 0) return false;

  const payload = token.slice(0, ponto);
  const assinatura = token.slice(ponto + 1);

  const expiraEm = Number(payload);
  if (!Number.isFinite(expiraEm) || expiraEm < Date.now()) return false;

  try {
    return await crypto.subtle.verify(
      "HMAC",
      await key(secret),
      fromBase64Url(assinatura) as unknown as ArrayBuffer,
      ENCODER.encode(payload),
    );
  } catch {
    return false;
  }
}

/** Comparação da senha em tempo constante. */
export function senhaConfere(informada: string, esperada: string): boolean {
  if (informada.length !== esperada.length) return false;
  let diff = 0;
  for (let i = 0; i < informada.length; i++) {
    diff |= informada.charCodeAt(i) ^ esperada.charCodeAt(i);
  }
  return diff === 0;
}
