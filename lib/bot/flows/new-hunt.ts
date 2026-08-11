import { formatBRL } from "@/lib/bot/format";
import { faixaDe } from "@/lib/hunts/match";
import { normalizar } from "@/lib/hunts/terms";
import type { PriceStats } from "@/lib/search/stats";
import type { InlineKeyboard } from "@/lib/telegram";

export type Step = "ask_product" | "ask_price" | "ask_tolerance" | "confirm";
export type FlowData = {
  produto?: string;
  alvoCents?: number;
  tolerancePct?: number;
};
export type FlowOut = {
  texto: string;
  keyboard?: InlineKeyboard;
  proximo: Step | "done" | "cancel";
  data: FlowData;
};

const TOLERANCIAS = [5, 10, 15];

const TEXTO_SESSAO_PERDIDA =
  "Essa conversa expirou ou se perdeu. Manda <b>/cacar</b> de novo pra recomeçar.";

/** "R$ 3.000,50" / "3000" / "3.000,50" → centavos. Null se não for número. */
function lerPreco(entrada: string): number | null {
  const limpo = entrada.replace(/r\$/i, "").replace(/\s/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(limpo)) return null;
  const n = Number(limpo.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

const CONFIRMACOES = new Set([
  "s",
  "sim",
  "ok",
  "isso",
  "confirma",
  "confirmo",
  "pode",
  "claro",
  "positivo",
]);
const NEGACOES = new Set(["nao"]);

/**
 * Confirma só se a primeira palavra estiver no conjunto fechado — e mesmo
 * assim não confirma se a palavra seguinte for uma negação ("isso não,
 * cancela" não pode virar confirmação só porque "isso" bate no conjunto).
 */
function lerConfirmacao(entrada: string): boolean {
  const palavras = normalizar(entrada).match(/[a-z0-9]+/g) ?? [];
  const primeira = palavras[0];
  if (primeira === undefined) return false;
  if (palavras[1] && NEGACOES.has(palavras[1])) return false;
  return CONFIRMACOES.has(primeira);
}

export function iniciar(): FlowOut {
  return {
    texto:
      "Qual <b>produto</b> você quer caçar?\n\n<i>Ex.: s25 plus, air fryer, calça de academia</i>",
    proximo: "ask_product",
    data: {},
  };
}

export function receber(
  step: Step,
  data: FlowData,
  entrada: string,
  stats: PriceStats | null,
): FlowOut {
  const texto = entrada.trim();

  if (step === "ask_product") {
    if (texto.length === 0) {
      return {
        texto: "Preciso do nome do <b>produto</b>. Ex.: <i>s25 plus, air fryer</i>",
        proximo: "ask_product",
        data,
      };
    }
    const contexto = stats
      ? `Achei <b>${stats.count}</b> ofertas nos últimos 6 meses.\nMenor ${formatBRL(stats.minCents)} · mediana <b>${formatBRL(stats.medianCents)}</b>.`
      : "Não achei histórico desse produto ainda — o arquivo cresce todo dia, então isso melhora.";
    return {
      texto: `${contexto}\n\nQuanto você quer pagar?`,
      proximo: "ask_price",
      data: { ...data, produto: texto },
    };
  }

  if (step === "ask_price") {
    const alvo = lerPreco(texto);
    if (alvo === null) {
      return {
        texto: "Não entendi. Manda só o <b>número</b>, ex.: <code>3000</code>",
        proximo: "ask_price",
        data,
      };
    }
    const keyboard: InlineKeyboard = {
      inline_keyboard: [
        TOLERANCIAS.map((pct) => {
          const f = faixaDe(alvo, pct);
          return {
            text: `${pct}% · ${formatBRL(f.minCents)}–${formatBRL(f.maxCents)}`,
            callback_data: `tol:${pct}`,
          };
        }),
      ],
    };
    return {
      texto: "Qual <b>tolerância</b>? Cada opção mostra a faixa que produz:",
      keyboard,
      proximo: "ask_tolerance",
      data: { ...data, alvoCents: alvo },
    };
  }

  if (step === "ask_tolerance") {
    if (data.produto === undefined || data.alvoCents === undefined) {
      return { texto: TEXTO_SESSAO_PERDIDA, proximo: "cancel", data };
    }
    const pct = Number(texto.replace("%", "").trim());
    if (!Number.isFinite(pct) || pct <= 0 || pct > 90) {
      return {
        texto: "Tolerância inválida. Manda um número entre 1 e 90, ex.: <code>10</code>",
        proximo: "ask_tolerance",
        data,
      };
    }
    if (!Number.isInteger(pct)) {
      return {
        texto: "A tolerância precisa ser um número <b>inteiro</b>, ex.: <code>10</code>",
        proximo: "ask_tolerance",
        data,
      };
    }
    const f = faixaDe(data.alvoCents, pct);
    return {
      texto: `Vou caçar <b>${data.produto}</b> entre <b>${formatBRL(f.minCents)}</b> e <b>${formatBRL(f.maxCents)}</b> (±${pct}%).\n\nConfirma? Responda <b>sim</b> ou <b>não</b>.`,
      proximo: "confirm",
      data: { ...data, tolerancePct: pct },
    };
  }

  if (data.produto === undefined || data.alvoCents === undefined) {
    return { texto: TEXTO_SESSAO_PERDIDA, proximo: "cancel", data };
  }

  const sim = lerConfirmacao(texto);
  return {
    texto: sim ? "Caça criada." : "Cancelado.",
    proximo: sim ? "done" : "cancel",
    data,
  };
}
