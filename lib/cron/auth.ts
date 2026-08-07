export function assertCronAuth(req: Request, secret: string): void {
  const provided = req.headers.get("x-cron-secret");
  if (!provided || provided !== secret) {
    throw new Error("Não autorizado");
  }
}
