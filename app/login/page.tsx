export const dynamic = "force-dynamic";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>;
}) {
  const { erro } = await searchParams;
  return (
    <main className="login">
      <form method="post" action="/api/login">
        <div className="label">Caçador de Ofertas</div>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>Painel de rodadas</h1>
        <input
          type="password"
          name="senha"
          placeholder="senha"
          autoComplete="current-password"
          // biome-ignore lint/a11y/noAutofocus: página de campo único, é o único destino possível
          autoFocus
          required
        />
        {erro && (
          <p className="err" style={{ marginBottom: 12 }}>
            Senha incorreta.
          </p>
        )}
        <button type="submit" className="btn">
          Entrar
        </button>
      </form>
    </main>
  );
}
