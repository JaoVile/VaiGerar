import { type NextRequest, NextResponse } from "next/server";
import { COOKIE, verifySession } from "@/lib/auth/session";

/**
 * Protege só o painel. As rotas de cron têm a própria autenticação por
 * `x-cron-secret` (`lib/cron/auth.ts`) e o webhook do Telegram tem a dele —
 * passar essas por aqui só criaria uma segunda porta pra manter.
 */
export const config = {
  matcher: ["/", "/api/runs"],
};

export async function middleware(req: NextRequest) {
  const senha = process.env.DASHBOARD_PASSWORD;

  // Sem senha configurada o painel não sobe em produção. O padrão inseguro
  // aqui seria "abre pra todo mundo", e a variável esquecida é justamente o
  // modo de falha mais provável de um deploy novo.
  if (!senha) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "DASHBOARD_PASSWORD não configurada — painel desativado." },
        { status: 503 },
      );
    }
    return NextResponse.next();
  }

  if (await verifySession(senha, req.cookies.get(COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}
