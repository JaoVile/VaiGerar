import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { type BackfillReport, backfillOnce, summarizeBackfill } from "@/lib/cron/backfill";
import { createDb } from "@/lib/db/client";
import { readEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    assertCronAuth(req, readEnv().cronSecret);
  } catch {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  let reports: BackfillReport[];
  try {
    reports = await backfillOnce(createDb(), new Date());
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Falha ao rodar o backfill:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const summary = summarizeBackfill(reports);

  // Canário: âncoras na página e nenhum post extraído — o t.me mudou o HTML.
  // 200 aqui faria o scheduler tratar como sucesso enquanto o arquivo histórico
  // para de andar em silêncio.
  if (summary.broken > 0) {
    console.error("CANÁRIO: parser quebrado no backfill", reports);
    return NextResponse.json({ ...summary, reports }, { status: 500 });
  }

  // Nenhum canal processado com sucesso (e havia canais a processar).
  if (summary.noneOk) {
    console.error("Backfill: nenhum canal processado com sucesso", reports);
    return NextResponse.json({ ...summary, reports }, { status: 500 });
  }

  return NextResponse.json({ ...summary, reports });
}
