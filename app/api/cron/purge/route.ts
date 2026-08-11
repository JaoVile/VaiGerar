import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { purgarLote } from "@/lib/cron/purge";
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

  try {
    const relatorio = await purgarLote(createDb(), new Date());
    return NextResponse.json(relatorio);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("Falha ao purgar posts:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
