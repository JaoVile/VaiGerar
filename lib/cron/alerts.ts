import type { SupabaseClient } from "@supabase/supabase-js";
import { formatBRL } from "@/lib/bot/format";
import { casa, type Hunt } from "@/lib/hunts/match";
import { escapeHtml, sendMessage } from "@/lib/telegram";

export type AlertPost = {
  rowId: number;
  text: string;
  priceCents: number;
  store: string | null;
  url: string;
  postedAt: string;
};

const MAX_TENTATIVAS = 5;
/** Quantos posts recentes o casamento examina por tick. */
const JANELA_POSTS = 500;
/**
 * Quantos alertas pendentes o tick tenta entregar. Baixo de propósito: cada
 * item é claim + 2 selects + `sendMessage` (timeout 15s) + 2 updates, todos
 * em paralelo — 10 concorrentes mantém o pior caso bem dentro do
 * `maxDuration` de 60s da rota, mesmo com `ingestAll` já tendo gasto parte do
 * orçamento. O que sobrar fica para o próximo tick, 5 minutos depois.
 */
const LOTE_ENVIO = 10;
/**
 * Prazo do lease de claim, em ms. Um tick que reivindica uma linha e morre
 * no meio (crash, timeout de função) libera a linha depois deste prazo, sem
 * precisar de intervenção manual.
 */
const LEASE_MS = 2 * 60 * 1000;

export function formatAlerta(hunt: Hunt, post: AlertPost): string {
  const abaixo = Math.round((1 - post.priceCents / hunt.priceMaxCents) * 100);
  const loja = post.store ? ` · ${escapeHtml(post.store)}` : "";
  const primeira =
    post.text
      .split("\n")
      .find((l) => l.trim().length > 0)
      ?.trim()
      .slice(0, 80) ?? "";
  return [
    `🎯 <b>${escapeHtml(hunt.label)}</b>`,
    `<b>${formatBRL(post.priceCents)}</b> — ${abaixo}% abaixo do teto da sua faixa${loja}`,
    `${escapeHtml(primeira)}`,
    `<a href="${escapeHtml(post.url)}">ver post</a>`,
  ].join("\n");
}

function toHunt(row: Record<string, unknown>): Hunt {
  return {
    id: row.id as string,
    chatId: row.chat_id as number,
    label: row.label as string,
    termsAny: row.terms_any as string[],
    termsNone: row.terms_none as string[],
    priceMinCents: row.price_min_cents as number,
    priceMaxCents: row.price_max_cents as number,
  };
}

export async function processarAlertas(
  db: SupabaseClient,
  token: string,
  agora: Date,
): Promise<{ casados: number; enviados: number; falhos: number }> {
  const { data: huntRows, error: huntErr } = await db
    .from("hunts")
    .select("*")
    .eq("is_active", true);
  if (huntErr) throw new Error(`Lendo caças: ${huntErr.message}`);
  const hunts = (huntRows ?? []).map(toHunt);

  let casados = 0;
  if (hunts.length > 0) {
    const { data: postRows, error: postErr } = await db
      .from("posts")
      .select("id,text,price_cents,store,url,posted_at")
      .not("price_cents", "is", null)
      .order("id", { ascending: false })
      .limit(JANELA_POSTS);
    if (postErr) throw new Error(`Lendo posts para alerta: ${postErr.message}`);

    const novos: Array<{ hunt_id: string; post_row_id: number }> = [];
    for (const p of postRows ?? []) {
      for (const h of hunts) {
        if (casa(p.text as string, p.price_cents as number, h)) {
          novos.push({ hunt_id: h.id, post_row_id: p.id as number });
        }
      }
    }
    if (novos.length > 0) {
      // ignoreDuplicates + unique(hunt_id, post_row_id): reprocessar não duplica alerta.
      const { error } = await db.from("alerts").upsert(novos, {
        onConflict: "hunt_id,post_row_id",
        ignoreDuplicates: true,
      });
      if (error) throw new Error(`Gravando alertas: ${error.message}`);
      casados = novos.length;
    }
  }

  // Lease: uma linha só conta como "livre para reivindicar" se nunca foi
  // reivindicada ou se o claim anterior é mais velho que LEASE_MS. Isso é o
  // que falta pro `attempts` sozinho não bastar como trava — dois ticks que
  // leem a mesma linha (attempts=1, sent_at=null) dentro da janela de um
  // `sendMessage` em voo (até 15s) reivindicariam com o mesmo `attempts` e
  // entregariam a mesma mensagem duas vezes.
  const leaseCutoffIso = new Date(agora.getTime() - LEASE_MS).toISOString();
  const livre = `claimed_at.is.null,claimed_at.lt.${leaseCutoffIso}`;

  const { data: pendentes, error: pendErr } = await db
    .from("alerts")
    .select("id,hunt_id,post_row_id,attempts")
    .is("sent_at", null)
    .lt("attempts", MAX_TENTATIVAS)
    .or(livre)
    .limit(LOTE_ENVIO);
  if (pendErr) throw new Error(`Lendo alertas pendentes: ${pendErr.message}`);

  // Cada alerta é independente — paraleliza a entrega (mesmo padrão do
  // `ingestAll`) pra não estourar o `maxDuration` da rota com envios
  // sequenciais. `allSettled` porque um item que rejeitar (em vez de
  // devolver "falho" pelo próprio catch interno) não pode derrubar os outros.
  const resultados = await Promise.allSettled(
    (pendentes ?? []).map((a) => processarUmAlerta(db, token, a, agora, leaseCutoffIso)),
  );

  let enviados = 0;
  let falhos = 0;
  for (const r of resultados) {
    if (r.status === "fulfilled") {
      if (r.value === "enviado") enviados++;
      else if (r.value === "falho") falhos++;
      // "pulado" (não conseguiu o claim) não conta em nenhum dos dois.
    } else {
      falhos++;
      console.error("Falha inesperada ao processar alerta:", r.reason);
    }
  }

  return { casados, enviados, falhos };
}

type ResultadoAlerta = "enviado" | "falho" | "pulado";

async function processarUmAlerta(
  db: SupabaseClient,
  token: string,
  a: {
    id: number;
    hunt_id: string;
    post_row_id: number;
    attempts: number | null;
  },
  agora: Date,
  leaseCutoffIso: string,
): Promise<ResultadoAlerta> {
  // Claim atômico com lease: incrementa attempts e grava claimed_at,
  // condicionado ao attempts que acabamos de ler E à linha estar livre
  // (claimed_at nulo ou vencido). Se outro tick já reivindicou, nenhuma
  // condição casa, nada volta, e pulamos.
  const { data: claim, error: claimErr } = await db
    .from("alerts")
    .update({
      attempts: (a.attempts ?? 0) + 1,
      claimed_at: agora.toISOString(),
    })
    .eq("id", a.id)
    .is("sent_at", null)
    .eq("attempts", a.attempts ?? 0)
    .or(`claimed_at.is.null,claimed_at.lt.${leaseCutoffIso}`)
    .select("id");
  if (claimErr) {
    console.error("Falha ao reivindicar alerta:", claimErr.message);
    return "falho";
  }
  if (!claim || claim.length === 0) return "pulado";

  try {
    const { data: hRow } = await db.from("hunts").select("*").eq("id", a.hunt_id).single();
    const { data: pRow } = await db
      .from("posts")
      .select("id,text,price_cents,store,url,posted_at")
      .eq("id", a.post_row_id)
      .single();
    if (!hRow || !pRow) throw new Error("caça ou post sumiu");

    const hunt = toHunt(hRow);
    await sendMessage(
      token,
      hunt.chatId,
      formatAlerta(hunt, {
        rowId: pRow.id as number,
        text: pRow.text as string,
        priceCents: pRow.price_cents as number,
        store: pRow.store as string | null,
        url: pRow.url as string,
        postedAt: pRow.posted_at as string,
      }),
    );
    await db.from("alerts").update({ sent_at: agora.toISOString() }).eq("id", a.id);
    await db.from("hunts").update({ last_alert_at: agora.toISOString() }).eq("id", hunt.id);
    return "enviado";
  } catch (e) {
    // attempts já foi incrementado no claim; não incrementa de novo.
    console.error("Falha ao entregar alerta:", e instanceof Error ? e.message : e);
    return "falho";
  }
}
