import { NextResponse } from "next/server";
import { normalizarSlug } from "@/lib/collector/diagnostico";
import { createDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Mesmo tamanho da purga, pelo mesmo motivo: `.in("id", ids)` vai na URL. */
const LOTE = 500;
/** Margem antes do `maxDuration`. A rota devolve o que faltou em vez de ser cortada. */
const ORCAMENTO_MS = 45_000;

function lerSlug(params: { slug: string }): string | null {
  return normalizarSlug(decodeURIComponent(params.slug));
}

/** Liga e desliga a coleta. O arquivo do canal fica intacto. */
export async function PATCH(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const slug = lerSlug(await ctx.params);
  if (slug === null) return NextResponse.json({ error: "Slug inválido." }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { is_active?: boolean };
  if (typeof body.is_active !== "boolean") {
    return NextResponse.json({ error: "Informe is_active." }, { status: 400 });
  }

  const db = createDb();
  const { data, error } = await db
    .from("channels")
    .update({ is_active: body.is_active })
    .eq("slug", slug)
    .select("slug,is_active")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Canal não cadastrado." }, { status: 404 });

  return NextResponse.json(data);
}

/**
 * Remove o canal e o arquivo dele.
 *
 * Em lote, e não num `delete` só, pelo mesmo motivo da purga — e com a mesma
 * armadilha: **o PostgREST ignora `limit` em DELETE** (medido em produção,
 * ver o cabeçalho de `purgarLote`). Por isso o limite é aplicado num SELECT e
 * a exclusão vai por lista de id.
 *
 * Um canal com meses de arquivo pode não caber nos 60s da rota. Quando o
 * orçamento acaba, a resposta traz `fim: false` e quantos ainda restam — a
 * interface chama de novo. O canal só é removido no lote que zera os posts,
 * então uma remoção interrompida no meio deixa o canal cadastrado (e ainda
 * coletando, se estiver ativo), nunca uma linha órfã.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const slug = lerSlug(await ctx.params);
  if (slug === null) return NextResponse.json({ error: "Slug inválido." }, { status: 400 });

  const db = createDb();
  const comecou = Date.now();
  let apagados = 0;

  while (Date.now() - comecou < ORCAMENTO_MS) {
    const { data: candidatos, error: erroSelect } = await db
      .from("posts")
      .select("id")
      .eq("channel_slug", slug)
      .order("id", { ascending: true })
      .limit(LOTE);
    if (erroSelect) {
      return NextResponse.json({ error: erroSelect.message }, { status: 500 });
    }

    const ids = (candidatos ?? []).map((r: { id: number }) => r.id);
    if (ids.length === 0) break;

    const { error: erroDelete } = await db.from("posts").delete().in("id", ids);
    if (erroDelete) return NextResponse.json({ error: erroDelete.message }, { status: 500 });
    apagados += ids.length;
  }

  const { count } = await db
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("channel_slug", slug);

  const restam = count ?? 0;
  if (restam > 0) {
    return NextResponse.json({ slug, apagados, restam, fim: false });
  }

  const { error } = await db.from("channels").delete().eq("slug", slug);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ slug, apagados, restam: 0, fim: true });
}
