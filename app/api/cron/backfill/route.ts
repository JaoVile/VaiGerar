import { NextResponse } from "next/server";
import { assertCronAuth } from "@/lib/cron/auth";
import { backfillOnce } from "@/lib/cron/backfill";
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

	const log = await backfillOnce(createDb(), new Date());
	return NextResponse.json({ log });
}
