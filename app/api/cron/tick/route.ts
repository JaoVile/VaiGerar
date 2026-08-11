import { NextResponse } from "next/server";
import { processarAlertas } from "@/lib/cron/alerts";
import { assertCronAuth } from "@/lib/cron/auth";
import { type IngestReport, ingestAll, summarize } from "@/lib/cron/ingest";
import { createDb } from "@/lib/db/client";
import { readBotEnv, readEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    assertCronAuth(req, readEnv().cronSecret);
  } catch {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  let reports: IngestReport[];
  try {
    reports = await ingestAll(createDb());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Falha ao coletar canais:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const summary = summarize(reports);

  // Falha parcial: 6 de 7 canais quebrados com um funcionando ainda devolve 200
  // (o scheduler não deve tratar a rodada como perdida), mas não pode passar em
  // silêncio — sem este log, canal morto some do radar por semanas.
  if (summary.failed > 0) {
    const falhos = reports.filter((r) => r.error !== null).map((r) => `${r.slug}: ${r.error}`);
    console.error(
      `Tick: ${summary.failed} de ${reports.length} canais falharam —`,
      falhos.join(" | "),
    );
  }

  // Canário: todo canal devolvendo zero post significa que o t.me mudou o HTML.
  // Falhar em silêncio aqui seria meses achando que não teve oferta.
  if (summary.allEmpty) {
    console.error("CANÁRIO: nenhum canal devolveu post", reports);
    return NextResponse.json({ ...summary, reports }, { status: 500 });
  }

  let alertas = { casados: 0, enviados: 0, falhos: 0 };
  try {
    alertas = await processarAlertas(createDb(), readBotEnv().telegramBotToken, new Date());
  } catch (e) {
    console.error("Falha ao processar alertas:", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({ ...summary, reports, alertas });
}
