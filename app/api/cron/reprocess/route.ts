import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { decideReprocesso } from "@/lib/cron/reprocess";
import { createDb } from "@/lib/db/client";
import { readEnv } from "@/lib/env";
import { parsePrices } from "@/lib/parse/price";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOTE = 500;

export async function POST(req: Request) {
  try {
    assertCronAuth(req, readEnv().cronSecret);
  } catch {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const desde = Number(new URL(req.url).searchParams.get("desde") ?? "0");
  const db = createDb();

  const { data, error } = await db
    .from("posts")
    .select("id,text,price_cents,prices_cents")
    .gt("id", desde)
    .order("id", { ascending: true })
    .limit(LOTE);
  if (error) {
    console.error("Reprocessando preços:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const linhas = data ?? [];
  let mudados = 0;
  let pulados = 0;
  for (const p of linhas) {
    const novo = parsePrices(p.text as string);
    const decisao = decideReprocesso(p.price_cents as number | null, novo);

    if (decisao.action === "manter") continue;
    if (decisao.action === "pular-perderia-preco") {
      // O parser não achou preço num post que antes tinha um valor. Nunca
      // sobrescreve com null em silêncio — conta à parte pra o operador
      // decidir, olhando o post, se é regressão do parser ou lixo de fato.
      pulados++;
      continue;
    }

    const { error: upErr } = await db
      .from("posts")
      .update({
        price_cents: decisao.priceCents,
        prices_cents: decisao.pricesCents,
      })
      .eq("id", p.id);
    if (upErr) {
      console.error(`Reprocessando post ${p.id}:`, upErr.message);
      return NextResponse.json({ error: upErr.message, postId: p.id }, { status: 500 });
    }
    mudados++;
  }

  const ultimo = linhas.length > 0 ? (linhas[linhas.length - 1].id as number) : desde;
  return NextResponse.json({
    lidos: linhas.length,
    mudados,
    pulados,
    proximo: ultimo,
    fim: linhas.length < LOTE,
  });
}
