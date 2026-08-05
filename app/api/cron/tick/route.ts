import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { ingestAll, summarize } from "@/lib/cron/ingest";
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

  const reports = await ingestAll(createDb());
  const summary = summarize(reports);

  // Canário: todo canal devolvendo zero post significa que o t.me mudou o HTML.
  // Falhar em silêncio aqui seria meses achando que não teve oferta.
  if (summary.allEmpty) {
    console.error("CANÁRIO: nenhum canal devolveu post", reports);
    return NextResponse.json({ ...summary, reports }, { status: 500 });
  }

  return NextResponse.json({ ...summary, reports });
}
