import { NextResponse } from "next/server";
import { COOKIE, SESSION_HOURS, senhaConfere, signSession } from "@/lib/auth/session";

export const runtime = "edge";

export async function POST(req: Request) {
  const esperada = process.env.DASHBOARD_PASSWORD;
  if (!esperada) {
    return NextResponse.json({ error: "painel desativado" }, { status: 503 });
  }

  const form = await req.formData();
  const informada = String(form.get("senha") ?? "");

  if (!senhaConfere(informada, esperada)) {
    // Atraso fixo, não proporcional: sinaliza pouco e não vira alavanca de
    // DoS como um backoff crescente viraria.
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.redirect(new URL("/login?erro=1", req.url), 303);
  }

  const expiraEm = Date.now() + SESSION_HOURS * 3600_000;
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(COOKIE, await signSession(esperada, expiraEm), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiraEm),
  });
  return res;
}
