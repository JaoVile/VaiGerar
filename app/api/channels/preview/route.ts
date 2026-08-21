import { NextResponse } from "next/server";
import { diagnosticar, normalizarSlug, veredito } from "@/lib/collector/diagnostico";
import { fetchChannelPage } from "@/lib/collector/fetch";
import { createDb } from "@/lib/db/client";
import { readArchiveUsage } from "@/lib/db/limites";
import { custoDoCanal } from "@/lib/limites";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Lê o canal candidato e devolve o que ele faria com o arquivo, sem gravar
 * nada. Rota separada do cadastro de propósito: a decisão de cadastrar é do
 * operador olhando os números, não um efeito colateral de digitar o slug.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { slug?: string };
  const slug = normalizarSlug(body.slug ?? "");
  if (slug === null) {
    return NextResponse.json(
      { error: "Slug inválido. Cole o link do canal (t.me/nome) ou o @nome." },
      { status: 400 },
    );
  }

  const db = createDb();

  const { data: existente } = await db
    .from("channels")
    .select("slug,is_active")
    .eq("slug", slug)
    .maybeSingle();

  let html: string;
  try {
    html = await fetchChannelPage(slug);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e), slug },
      { status: 502 },
    );
  }

  const d = diagnosticar(html, slug);
  const v = veredito(d);

  // O custo em disco só faz sentido contra o arquivo real. Se a leitura do uso
  // falhar, o preview ainda vale — o veredito não depende dela.
  let custoPct: number | null = null;
  try {
    custoPct = custoDoCanal(d.postsPorDia, await readArchiveUsage(db));
  } catch {
    custoPct = null;
  }

  return NextResponse.json({
    slug,
    diagnostico: d,
    veredito: v,
    custoPct,
    jaCadastrado: existente ? { is_active: existente.is_active as boolean } : null,
  });
}
