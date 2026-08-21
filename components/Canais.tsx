"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Diagnostico, Veredito } from "@/lib/collector/diagnostico";
import { KINDS } from "@/lib/collector/diagnostico";
import type { ChannelFootprint } from "@/lib/db/limites";
import { formatarPct, formatarReais } from "@/lib/limites";

type Preview = {
  slug: string;
  diagnostico: Diagnostico;
  veredito: Veredito;
  custoPct: number | null;
  jaCadastrado: { is_active: boolean } | null;
};

async function pedir(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(corpo.error ?? `HTTP ${res.status}`);
  return corpo;
}

function Amostra({ d }: { d: Diagnostico }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="label" style={{ marginBottom: 6 }}>
        O que o parser leu
      </div>
      {d.amostra.map((a) => (
        <p key={a.texto} className="amostra">
          <span className={a.precoCents === null ? "dim" : "preco"}>
            {a.precoCents === null ? "sem preço" : formatarReais(a.precoCents)}
          </span>
          {a.texto}
        </p>
      ))}
    </div>
  );
}

/**
 * Cadastro e remoção de canal.
 *
 * O fluxo é sempre **preview antes de gravar**, e o preview roda o parser
 * real: a 0006 rejeitou 5 canais de cupom e achou 6 mortos justamente porque
 * alguém olhou os números antes de cadastrar. A tela repete esse trabalho em
 * vez de confiar que o canal é bom porque o link abre.
 */
export function Canais({ canais }: { canais: ChannelFootprint[] }) {
  const router = useRouter();
  const [entrada, setEntrada] = useState("");
  const [kind, setKind] = useState<string>("geral");
  const [semBackfill, setSemBackfill] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<string | null>(null);

  async function verificar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setPreview(null);
    setOcupado("preview");
    try {
      const p = (await pedir("/api/channels/preview", {
        method: "POST",
        body: JSON.stringify({ slug: entrada }),
      })) as Preview;
      setPreview(p);
      // Canal pesado entra sem backfill por padrão — importar 6 meses de um
      // canal de 400 posts/dia são dezenas de milhares de linhas de uma vez.
      setSemBackfill(p.diagnostico.postsPorDia > 150);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  async function cadastrar(forcar: boolean) {
    if (!preview) return;
    setErro(null);
    setOcupado("cadastrar");
    try {
      await pedir("/api/channels", {
        method: "POST",
        body: JSON.stringify({
          slug: preview.slug,
          kind,
          backfill_complete: semBackfill,
          forcar,
        }),
      });
      setPreview(null);
      setEntrada("");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  async function alternar(c: ChannelFootprint) {
    setErro(null);
    setOcupado(c.slug);
    try {
      await pedir(`/api/channels/${c.slug}`, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !c.is_active }),
      });
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(null);
    }
  }

  /**
   * Remoção em lote: a rota apaga o que couber nos 60s e devolve `fim: false`
   * com o que sobrou. Um canal com meses de arquivo precisa de várias
   * chamadas, e é a tela que insiste — parar no meio deixaria o canal
   * cadastrado e ainda coletando.
   */
  async function remover(c: ChannelFootprint) {
    setErro(null);
    setOcupado(c.slug);
    setConfirmar(null);
    try {
      for (let volta = 0; volta < 50; volta++) {
        const r = (await pedir(`/api/channels/${c.slug}`, { method: "DELETE" })) as {
          restam: number;
          fim: boolean;
        };
        if (r.fim) break;
        setProgresso(`${c.slug}: faltam ${r.restam.toLocaleString("pt-BR")} posts…`);
      }
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setProgresso(null);
      setOcupado(null);
    }
  }

  const d = preview?.diagnostico;
  const v = preview?.veredito;

  return (
    <section className="panel">
      <header>
        <span className="dot dot-ok" aria-hidden />
        <span className="label">Canais</span>
        <span className="label" style={{ marginLeft: "auto" }}>
          {canais.filter((c) => c.is_active).length} ativos de {canais.length}
        </span>
      </header>
      <div className="body">
        <form onSubmit={verificar} className="linha">
          <input
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            placeholder="t.me/nomedocanal, @nomedocanal ou o slug"
            aria-label="Canal do Telegram"
            className="campo"
          />
          <button
            type="submit"
            className="btn"
            disabled={ocupado !== null || entrada.trim() === ""}
          >
            {ocupado === "preview" ? "lendo…" : "verificar"}
          </button>
        </form>
        <p className="empty" style={{ marginTop: 8 }}>
          O coletor lê a página pública <code>t.me/s/&lt;slug&gt;</code>, sem login. Canal privado,
          grupo ou canal só por convite não dá pra puxar.
        </p>

        {erro && <p className="err">{erro}</p>}
        {progresso && <p className="empty">{progresso}</p>}

        {d && v && (
          <div className="preview">
            <div className="linha" style={{ alignItems: "baseline" }}>
              <span
                className={`dot ${v.tom === "ok" ? "dot-ok" : v.tom === "warn" ? "dot-degraded" : "dot-error"}`}
                aria-hidden
              />
              <strong>{d.titulo ?? d.slug}</strong>
              <span className="mono dim" style={{ fontSize: 12 }}>
                {d.slug}
                {d.inscritos && ` · ${d.inscritos} inscritos`}
              </span>
            </div>
            <p style={{ marginTop: 8, fontSize: 14 }}>{v.texto}</p>

            {preview.jaCadastrado && (
              <p className="empty">
                Já cadastrado ({preview.jaCadastrado.is_active ? "ativo" : "desativado"}) — gravar
                de novo atualiza título e categoria.
              </p>
            )}

            {d.indisponivel === null && (
              <>
                <div className="figures" style={{ marginTop: 14 }}>
                  <div className="figure">
                    <div className="v">{Math.round(d.postsPorDia)}</div>
                    <div className="k label">Posts/dia estimado</div>
                  </div>
                  <div className="figure">
                    <div
                      className={`v ${preview.custoPct !== null && preview.custoPct > 0.1 ? "warn" : ""}`}
                    >
                      {preview.custoPct === null ? "—" : formatarPct(preview.custoPct)}
                    </div>
                    <div className="k label">Do plano free, no platô</div>
                  </div>
                  <div className="figure">
                    <div className="v">
                      {d.comPreco}
                      <small>/{d.postsNaPagina}</small>
                    </div>
                    <div className="k label">Com preço legível</div>
                  </div>
                  <div className="figure">
                    <div className="v">
                      {d.precoMedianaCents === null ? "—" : formatarReais(d.precoMedianaCents)}
                    </div>
                    <div className="k label">Mediana lida</div>
                  </div>
                </div>

                <Amostra d={d} />

                <div className="linha" style={{ marginTop: 16, flexWrap: "wrap" }}>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                    aria-label="Categoria"
                    className="campo"
                    style={{ maxWidth: 140 }}
                  >
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={semBackfill}
                      onChange={(e) => setSemBackfill(e.target.checked)}
                    />
                    só daqui pra frente (sem backfill)
                  </label>
                  <button
                    type="button"
                    className="btn"
                    disabled={ocupado !== null}
                    onClick={() => cadastrar(!v.pode)}
                  >
                    {v.pode ? "cadastrar" : "cadastrar mesmo assim"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <div className="scroll-x" style={{ marginTop: 22 }}>
          <table>
            <thead>
              <tr>
                <th>Canal</th>
                <th>Categoria</th>
                <th>Posts</th>
                <th>Situação</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {canais.map((c) => (
                <tr key={c.slug}>
                  <td className="mono" style={{ fontSize: 12.5 }}>
                    <span
                      className={`dot ${c.is_active ? "dot-ok" : "dot-idle"}`}
                      style={{ marginRight: 8 }}
                      aria-hidden
                    />
                    {c.slug}
                    {c.title && <div className="dim">{c.title}</div>}
                  </td>
                  <td className="dim">{c.kind}</td>
                  <td className="num dim">{c.posts.toLocaleString("pt-BR")}</td>
                  <td className="dim">{c.is_active ? "coletando" : "desativado"}</td>
                  <td>
                    <div className="linha">
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={ocupado !== null}
                        onClick={() => alternar(c)}
                      >
                        {c.is_active ? "desativar" : "ativar"}
                      </button>
                      {confirmar === c.slug ? (
                        <button
                          type="button"
                          className="btn perigo"
                          disabled={ocupado !== null}
                          onClick={() => remover(c)}
                        >
                          apagar {c.posts.toLocaleString("pt-BR")} posts
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn ghost"
                          disabled={ocupado !== null}
                          onClick={() => setConfirmar(c.slug)}
                        >
                          remover
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="empty" style={{ marginTop: 10 }}>
          Desativar para a coleta e mantém o arquivo. Remover apaga o canal <em>e</em> todos os
          posts dele — inclusive o histórico que a busca e a mediana usam.
        </p>
      </div>
    </section>
  );
}
