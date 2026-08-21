import type { StoredRun } from "@/lib/db/runs";

/**
 * Derivações puras que o painel usa. Ficam aqui, fora do componente, porque
 * "quanto tempo desde a última rodada" e "esse tick atrasou" são regras de
 * operação — o tipo de coisa que precisa de teste, não de inspeção visual.
 */

/** Cadência esperada do tick. Precisa bater com o agendamento no cron-job.org. */
export const TICK_INTERVAL_MIN = 5;

/**
 * Tolerância antes de chamar de atraso. Duas rodadas perdidas, não uma: o
 * cron externo tem jitter, e alarme que dispara com jitter normal é alarme
 * que o operador aprende a ignorar.
 */
export const ATRASO_MIN = TICK_INTERVAL_MIN * 2 + 1;

export function minutosDesde(quando: string, agora: Date): number {
  return (agora.getTime() - new Date(quando).getTime()) / 60_000;
}

export type Saude = {
  status: "sem-dados" | "ok" | "degradado" | "parado" | "quebrado";
  detalhe: string;
};

/**
 * Estado geral do coletor. "Parado" tem precedência sobre qualquer estado da
 * última rodada: uma rodada verde de três horas atrás não é uma boa notícia,
 * é a última coisa que funcionou antes do cron parar. Esse é o modo de falha
 * silencioso que o painel existe pra pegar.
 */
export function avaliarSaude(runs: StoredRun[], agora: Date): Saude {
  const ticks = runs.filter((r) => r.kind === "tick");
  if (ticks.length === 0) {
    return { status: "sem-dados", detalhe: "Nenhuma rodada registrada ainda." };
  }

  const ultima = ticks[0];
  const minutos = minutosDesde(ultima.started_at, agora);

  if (minutos > ATRASO_MIN) {
    return {
      status: "parado",
      detalhe: `Última rodada há ${Math.round(minutos)} min — esperado a cada ${TICK_INTERVAL_MIN} min. O agendador externo pode ter parado.`,
    };
  }

  if (ultima.status === "canary") {
    return {
      status: "quebrado",
      detalhe: "Canário: nenhum canal devolveu post. Provável mudança no HTML do t.me.",
    };
  }
  if (ultima.status === "error") {
    return { status: "quebrado", detalhe: ultima.error ?? "A rodada falhou inteira." };
  }
  if (ultima.status === "degraded") {
    const falhos = ultima.reports.filter((r) => r.error !== null).map((r) => r.slug);
    return {
      status: "degradado",
      detalhe: `${ultima.failed} de ${ultima.channels} canais falharam: ${falhos.join(", ")}.`,
    };
  }

  return { status: "ok", detalhe: `Coletando normalmente há ${ticks.length} rodadas.` };
}

/** Somas da janela carregada. */
export function totais(runs: StoredRun[]) {
  const ticks = runs.filter((r) => r.kind === "tick");
  const somar = (f: (r: StoredRun) => number) => ticks.reduce((n, r) => n + f(r), 0);
  return {
    rodadas: ticks.length,
    fetched: somar((r) => r.fetched),
    saved: somar((r) => r.saved),
    alertas: somar((r) => r.alerts_sent),
    falhas: ticks.filter((r) => r.status !== "ok").length,
    duracaoMedia: ticks.length ? Math.round(somar((r) => r.duration_ms) / ticks.length) : 0,
  };
}

/**
 * Altura da barra na faixa, 0..1, proporcional ao maior valor da janela.
 * Rodada que salvou zero ainda desenha um traço: some da faixa seria a mesma
 * coisa que não ter acontecido, e ela aconteceu.
 */
export function alturaBarra(saved: number, maximo: number): number {
  if (maximo <= 0) return 0.04;
  return Math.max(0.04, saved / maximo);
}

export function formatarHora(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Recife",
  }).format(new Date(iso));
}

export function formatarDataHora(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Recife",
  }).format(new Date(iso));
}

export function formatarDuracao(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}
