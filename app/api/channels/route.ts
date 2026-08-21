import { NextResponse } from "next/server";
import { diagnosticar, ehKind, normalizarSlug, veredito } from "@/lib/collector/diagnostico";
import { fetchChannelPage } from "@/lib/collector/fetch";
import { createDb } from "@/lib/db/client";
import { readArchiveUsage, readChannelFootprint } from "@/lib/db/limites";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  const db = createDb();
  const [canais, uso] = await Promise.all([readChannelFootprint(db), readArchiveUsage(db)]);
  return NextResponse.json({ canais, uso });
}

/**
 * Cadastra o canal.
 *
 * O diagnóstico roda **de novo aqui**, mesmo tendo rodado no preview: o
 * cliente manda slug e categoria, não veredito. Confiar no "pode" que voltou
 * pela rede seria deixar a única defesa contra canal de cupom (0006) do lado
 * de fora do servidor.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    slug?: string;
    kind?: string;
    title?: string;
    backfill_complete?: boolean;
    forcar?: boolean;
  };

  const slug = normalizarSlug(body.slug ?? "");
  if (slug === null) {
    return NextResponse.json({ error: "Slug inválido." }, { status: 400 });
  }
  if (!ehKind(body.kind)) {
    return NextResponse.json({ error: "Categoria inválida." }, { status: 400 });
  }

  let html: string;
  try {
    html = await fetchChannelPage(slug);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }

  const d = diagnosticar(html, slug);
  const v = veredito(d);

  // "Sem preview" e "sem post" não têm como ser forçados: o coletor
  // simplesmente não consegue ler o canal, e cadastrar criaria uma linha que
  // falha em toda rodada. Já o cheiro de cupom é julgamento — o operador pode
  // conhecer o canal melhor que a heurística —, então esse aceita `forcar`.
  if (!v.pode && (d.indisponivel !== null || !body.forcar)) {
    return NextResponse.json(
      { error: v.texto, diagnostico: d, forcavel: d.indisponivel === null },
      { status: 422 },
    );
  }

  const db = createDb();
  const { error } = await db.from("channels").upsert(
    {
      slug,
      title: body.title?.trim() || d.titulo || slug,
      kind: body.kind,
      is_active: true,
      // Canal pesado entra sem backfill: importar 6 meses de um canal de 400
      // posts/dia são ~72 mil linhas de uma vez. Mesma decisão da 0003.
      backfill_complete: body.backfill_complete ?? false,
    },
    { onConflict: "slug" },
  );
  if (error) {
    return NextResponse.json({ error: `Gravando canal: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({ slug, diagnostico: d, veredito: v });
}
