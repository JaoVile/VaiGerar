import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatAjuda } from "@/lib/bot/format";

/**
 * Guarda contra deriva do `/ajuda`.
 *
 * O texto de ajuda é escrito à mão e não tem como envelhecer com barulho: ele
 * ficou dizendo "leio 13 canais" por dois dias depois de o catálogo ir pra 16,
 * e ninguém percebeu. Depois entraram `/cupom` e `/tendencia`, e nada no
 * código obrigava a documentá-los.
 *
 * Este teste lê o **fonte do router** e cobra um comando por vez. Ler fonte
 * num teste é incomum, mas a alternativa — uma lista de comandos exportada —
 * teria o mesmo problema que estamos tentando resolver: dá pra adicionar
 * comando sem mexer na lista. O router é a única fonte de verdade sobre o que
 * o bot aceita.
 */
const ROUTER = readFileSync(join(process.cwd(), "lib/bot/router.ts"), "utf8");

/** Alias que existem só por conveniência e não precisam de seção própria. */
const ALIASES = new Set(["/start", "/cupons", "/tendência"]);

function comandosDoRouter(): string[] {
  const achados = ROUTER.matchAll(/comando === "(\/[^"]+)"/g);
  return [...new Set([...achados].map((m) => m[1]))];
}

describe("/ajuda cobre o que o bot aceita", () => {
  const ajuda = formatAjuda();

  it("o router expõe os comandos que esperamos (senão o resto do teste é cego)", () => {
    // Sem esta asserção, uma mudança no formato do `if` do router faria
    // `comandosDoRouter()` devolver lista vazia e o teste abaixo passaria
    // sem verificar nada — o modo de falha que já apareceu 4x nesta base.
    expect(comandosDoRouter().length).toBeGreaterThanOrEqual(6);
  });

  for (const cmd of comandosDoRouter()) {
    const rotulo = ALIASES.has(cmd) ? `${cmd} (alias)` : cmd;
    it(`documenta ${rotulo}`, () => {
      expect(ajuda).toContain(cmd);
    });
  }

  // Funcionalidades que não são comando e por isso escapam do laço acima. Cada
  // uma foi pedida explicitamente e ficou de fora do /ajuda na primeira versão.
  it("explica o botão de paginação, que não é comando nenhum", () => {
    expect(ajuda).toContain("mais ofertas");
  });

  it("avisa que os botões expiram, senão o usuário acha que quebrou", () => {
    expect(ajuda.toLowerCase()).toContain("1 hora");
  });

  it("diz que o alerta só cobre oferta recente", () => {
    expect(ajuda).toContain("48h");
  });

  it("explica o botão de menor preço agora", () => {
    expect(ajuda).toContain("Menor preço agora");
  });

  it("explica que o resumo do dia usa o histórico do próprio produto", () => {
    expect(ajuda.toLowerCase()).toContain("preço histórico do próprio produto");
  });

  it("diz que dá pra buscar sem digitar comando", () => {
    expect(ajuda.toLowerCase()).toContain("sem comando");
  });
});
