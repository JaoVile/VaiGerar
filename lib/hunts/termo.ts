import { normalizar } from "@/lib/hunts/terms";

/**
 * Casamento de termo por token, no lugar de `String.includes`.
 *
 * ## Por que, com número
 *
 * Medido sobre 12.000 posts reais do arquivo em 2026-08-12, contando quantos
 * casamentos por substring estavam **errados**:
 *
 *   modo de erro                                          frequência
 *   modelo base casando o superior (`galaxy s25` -> Ultra)   61% (48 de 79)
 *   termo como modificador ("ventilador **de mesa**")        27% em "mesa",
 *                                                            1-2% em outros
 *   frase de comparação ("concorre com o Z Fold7")           0,20% dos posts
 *   termo colado dentro de palavra maior                     4 a 9 posts
 *
 * O plano original (`docs/PLANO-MELHORIAS.md`, item 3) propunha **limite de
 * palavra** — que resolve só a última linha, a mais rara, e não resolve
 * nenhum dos dois exemplos que o próprio plano cita. Este módulo ataca as
 * duas primeiras, que são as que aparecem nas 6 caças reais.
 *
 * A frase de comparação ficou de fora de propósito: 0,20% não paga uma lista
 * de padrões pra manter. Está registrado em `docs/FOLLOW-UPS.md`.
 */

/**
 * Tokeniza mantendo `+` grudado no token.
 *
 * Isso não é detalhe: `s25+` e `s25` são caças diferentes, com alvos de
 * R$ 3.000 e R$ 2.600. Se o `+` sumisse na tokenização, as duas casariam o
 * mesmo post e cada alerta sairia com o preço-alvo da outra.
 */
function tokens(s: string): string[] {
  return normalizar(s).match(/[a-z0-9]+\+*/g) ?? [];
}

/**
 * Sufixo que indica outra linha do produto. Se o termo casa e logo depois vem
 * um destes, o post é de outro aparelho.
 *
 * "5g", "256gb" e cor **não** entram: são especificação do mesmo aparelho, e
 * incluí-los faria a caça do modelo base parar de casar anúncio nenhum.
 */
const QUALIFICADORES = new Set([
  "plus",
  "ultra",
  "edge",
  "pro",
  "max",
  "fe",
  "lite",
  "mini",
  "neo",
]);

/**
 * Preposição antes do termo indica que ele é modificador, não o produto:
 * "ventilador **de mesa**", "suporte **para mesa**".
 */
const PREPOSICOES = new Set(["de", "da", "do", "para", "pra"]);

export function casaTermo(texto: string, termo: string): boolean {
  const alvo = tokens(termo);
  if (alvo.length === 0) return false;
  const t = tokens(texto);
  if (t.length === 0) return false;

  // O termo já pede uma linha específica ("s24 ultra"): nesse caso o
  // qualificador é parte do pedido e não pode servir de veto.
  const termoTemQualificador = alvo.some((x) => QUALIFICADORES.has(x));

  for (let i = 0; i + alvo.length <= t.length; i++) {
    let bate = true;
    for (let k = 0; k < alvo.length; k++) {
      if (t[i + k] !== alvo[k]) {
        bate = false;
        break;
      }
    }
    if (!bate) continue;

    const anterior = i > 0 ? t[i - 1] : null;
    const seguinte = i + alvo.length < t.length ? t[i + alvo.length] : null;

    if (anterior !== null && PREPOSICOES.has(anterior)) continue;
    if (!termoTemQualificador && seguinte !== null && QUALIFICADORES.has(seguinte)) continue;

    return true;
  }
  return false;
}
