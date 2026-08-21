import { PURGE_MONTHS } from "@/lib/cron/purge";
import type { StoredRun } from "@/lib/db/runs";

/**
 * Os tetos que o projeto opera contra, e quanto de cada um já foi.
 *
 * Puro de propósito, como `lib/painel.ts`: "cabe mais um canal?" é regra de
 * operação — a resposta errada custa um arquivo que para de gravar no meio de
 * uma semana —, então precisa de teste, não de conferência a olho.
 */

/** Teto de disco do plano free do Supabase. */
export const TETO_DISCO_BYTES = 500 * 1024 * 1024;

/**
 * Onde o painel para de dizer "tem espaço".
 *
 * 60% é o mesmo alvo que a 0006 usou pra decidir a expansão de 16 pra 25
 * canais. A folga não é medo: a purga roda em lote e o `bigserial` nunca
 * reseta, então o platô real fica um pouco acima do projetado.
 */
export const ALVO_OCUPACAO = 0.6;

/** Dias que o arquivo guarda. Espelha `PURGE_MONTHS` — se ela mudar, o platô muda junto. */
export const DIAS_RETENCAO = PURGE_MONTHS * 30;

/** Teto da rota de cron na Vercel (`maxDuration` do tick). */
export const MAX_DURATION_MS = 60_000;

export type ArchiveUsage = {
  posts_total: number;
  bytes_posts: number;
  bytes_db: number;
  posts_por_dia: number;
  post_mais_antigo: string | null;
  canais_ativos: number;
};

/**
 * Custo real de um post no disco, incluindo índice.
 *
 * Medido, não estimado: a 0006 usou 1,4 KB de cabeça e a projeção inteira
 * pendurou nesse número. Arquivo vazio cai no 1,4 KB só porque não há o que
 * medir ainda.
 */
export function bytesPorPost(u: ArchiveUsage): number {
  if (u.posts_total <= 0) return 1400;
  return u.bytes_posts / u.posts_total;
}

/**
 * Tamanho que o arquivo alcança quando a purga passa a apagar tanto quanto a
 * coleta grava. É o número que importa: o disco de hoje não diz se cabe mais
 * canal, o platô diz.
 */
export function projetarPlato(u: ArchiveUsage): number {
  return u.posts_por_dia * DIAS_RETENCAO * bytesPorPost(u);
}

export type Ocupacao = {
  usadoBytes: number;
  usadoPct: number;
  platoBytes: number;
  platoPct: number;
  tom: "ok" | "warn" | "crit";
  detalhe: string;
  /** Quantos posts/dia ainda cabem antes do platô encostar em `ALVO_OCUPACAO`. */
  folgaPostsPorDia: number;
};

export function avaliarDisco(u: ArchiveUsage): Ocupacao {
  const plato = projetarPlato(u);
  const platoPct = plato / TETO_DISCO_BYTES;
  const usadoPct = u.bytes_db / TETO_DISCO_BYTES;

  const porPost = bytesPorPost(u);
  const tetoPostsPorDia = (TETO_DISCO_BYTES * ALVO_OCUPACAO) / (DIAS_RETENCAO * porPost);
  const folga = Math.max(0, tetoPostsPorDia - u.posts_por_dia);

  // O platô manda no tom, não o uso de hoje: um arquivo com 3 dias de vida
  // ocupa pouco e mesmo assim pode estar a caminho de estourar. Foi por isso
  // que a 0006 projetou antes de cadastrar canal, em vez de cadastrar e olhar.
  let tom: Ocupacao["tom"] = "ok";
  let detalhe: string;
  if (platoPct >= 1) {
    tom = "crit";
    detalhe = `No ritmo de agora o arquivo estoura os ${formatarBytes(TETO_DISCO_BYTES)} antes de completar ${DIAS_RETENCAO} dias. Desative canal ou encurte a retenção.`;
  } else if (platoPct >= ALVO_OCUPACAO) {
    tom = "warn";
    detalhe = `O platô projetado passa do alvo de ${Math.round(ALVO_OCUPACAO * 100)}%. Dá pra operar, mas não cabe canal novo sem tirar outro.`;
  } else {
    detalhe = `Cabe cerca de ${Math.round(folga)} posts/dia a mais antes do platô encostar nos ${Math.round(ALVO_OCUPACAO * 100)}% do plano.`;
  }

  return {
    usadoBytes: u.bytes_db,
    usadoPct,
    platoBytes: plato,
    platoPct,
    tom,
    detalhe,
    folgaPostsPorDia: folga,
  };
}

/**
 * Custo diário de um canal candidato, na mesma moeda do painel: quanto do
 * plano ele come no platô. É o que transforma "esse canal posta muito" numa
 * decisão.
 */
export function custoDoCanal(postsPorDia: number, u: ArchiveUsage): number {
  return (postsPorDia * DIAS_RETENCAO * bytesPorPost(u)) / TETO_DISCO_BYTES;
}

export type LimitesDeColeta = {
  duracaoP95Ms: number;
  duracaoMaxMs: number;
  duracaoPct: number;
  maiorLeituraCanal: number;
  canaisNaUltima: number;
  tom: "ok" | "warn" | "crit";
};

/**
 * Quanto da janela de 60s da rota o tick está usando.
 *
 * Dois números, e o alarme sai do **máximo**, não do p95. O p95 diz como é um
 * dia normal; mas com 120 rodadas na janela, a rodada que quase estourou é
 * exatamente a que o p95 descarta por definição — e ela é a que importa: a
 * Vercel corta a requisição no `maxDuration` sem aviso, sem linha no log de
 * rodadas, e o cursor de quem já tinha gravado avança do mesmo jeito. Uma
 * rodada de 55s não é ruído estatístico, é um aviso de que a próxima morre.
 */
export function limitesDeColeta(runs: StoredRun[]): LimitesDeColeta {
  const ticks = runs.filter((r) => r.kind === "tick");
  if (ticks.length === 0) {
    return {
      duracaoP95Ms: 0,
      duracaoMaxMs: 0,
      duracaoPct: 0,
      maiorLeituraCanal: 0,
      canaisNaUltima: 0,
      tom: "ok",
    };
  }

  const duracoes = ticks.map((r) => r.duration_ms).sort((a, b) => a - b);
  const p95 = duracoes[Math.min(duracoes.length - 1, Math.ceil(duracoes.length * 0.95) - 1)];
  const maxMs = duracoes[duracoes.length - 1];
  const maior = Math.max(0, ...ticks.flatMap((r) => r.reports.map((x) => x.fetched)));

  const pct = maxMs / MAX_DURATION_MS;
  const tom = pct >= 0.8 ? "crit" : pct >= 0.5 ? "warn" : "ok";
  return {
    duracaoP95Ms: p95,
    duracaoMaxMs: maxMs,
    duracaoPct: pct,
    maiorLeituraCanal: maior,
    canaisNaUltima: ticks[0].channels,
    tom,
  };
}

export function formatarBytes(b: number): string {
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatarReais(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatarPct(fracao: number): string {
  return `${(fracao * 100).toFixed(fracao < 0.1 ? 1 : 0)}%`;
}
