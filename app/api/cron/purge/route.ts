import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { purgarLote } from "@/lib/cron/purge";
import { createDb } from "@/lib/db/client";
import { purgarRodadas } from "@/lib/db/runs";
import { readEnv } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    assertCronAuth(req, readEnv().cronSecret);
  } catch {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const db = createDb();
  const agora = new Date();

  try {
    const relatorio = await purgarLote(db, agora);

    // O log de rodadas tem retenção própria, menor que a dos posts, e mora na
    // mesma passada porque é a mesma pergunta: "o que aqui já não serve mais?".
    // Falha aqui não invalida a purga de posts, que é o trabalho principal.
    let rodadas = 0;
    try {
      rodadas = await purgarRodadas(db, agora);
    } catch (e) {
      console.error("Falha ao purgar rodadas:", e instanceof Error ? e.message : e);
    }

    return NextResponse.json({ ...relatorio, rodadas });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Falha ao purgar posts:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
