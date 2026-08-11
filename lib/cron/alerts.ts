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

  const { data: pendentes, error: pendErr } = await db
    .from("alerts")
    .select("id,hunt_id,post_row_id,attempts")
    .is("sent_at", null)
    .lt("attempts", MAX_TENTATIVAS)
    .limit(30);
  if (pendErr) throw new Error(`Lendo alertas pendentes: ${pendErr.message}`);

  let enviados = 0;
  let falhos = 0;
  for (const a of pendentes ?? []) {
    // Claim atômico: incrementa attempts condicionando ao valor que acabamos de
    // ler. Se outro tick já pegou esta linha, o filtro não casa, nada volta, e
    // pulamos. Sem isso, dois ticks sobrepostos entregam a MESMA mensagem duas
    // vezes — envio de Telegram não é idempotente, diferente do resto do coletor.
    const { data: claim } = await db
      .from("alerts")
      .update({ attempts: ((a.attempts as number) ?? 0) + 1 })
      .eq("id", a.id)
      .is("sent_at", null)
      .eq("attempts", (a.attempts as number) ?? 0)
      .select("id");
    if (!claim || claim.length === 0) continue;

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
      enviados++;
    } catch (e) {
      falhos++;
      // attempts já foi incrementado no claim; não incrementa de novo.
      console.error("Falha ao entregar alerta:", e instanceof Error ? e.message : e);
    }
  }

  return { casados, enviados, falhos };
}
