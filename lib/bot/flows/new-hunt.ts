import { formatBRL } from "@/lib/bot/format";
import { faixaDe } from "@/lib/hunts/match";
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

/** "R$ 3.000,50" / "3000" / "3.000,50" → centavos. Null se não for número. */
function lerPreco(entrada: string): number | null {
  const limpo = entrada.replace(/r\$/i, "").replace(/\s/g, "");
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(limpo)) return null;
  const n = Number(limpo.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
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
    const pct = Number(texto.replace("%", "").trim());
    const alvo = data.alvoCents ?? 0;
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
    const f = faixaDe(alvo, pct);
    return {
      texto: `Vou caçar <b>${data.produto}</b> entre <b>${formatBRL(f.minCents)}</b> e <b>${formatBRL(f.maxCents)}</b> (±${pct}%).\n\nConfirma? Responda <b>sim</b> ou <b>não</b>.`,
      proximo: "confirm",
      data: { ...data, tolerancePct: pct },
    };
  }

  const sim = /^(s|sim|ok|isso|confirma)/i.test(texto);
  return {
    texto: sim ? "Caça criada." : "Cancelado.",
    proximo: sim ? "done" : "cancel",
    data,
  };
}
