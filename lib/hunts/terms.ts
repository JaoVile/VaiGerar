/** Minúsculas, sem acento, espaços colapsados. */
export function normalizar(s: string): string {
  return (
    s
      .normalize("NFD")
      // Faixa dos diacríticos combinantes, escrita com escape Unicode de propósito:
      // colar os caracteres combinantes literais no fonte é frágil.
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Variações que devem satisfazer a caça. Celular é escrito de dois jeitos
 * ("S25 Plus" e "S25+") e o usuário digita só um deles.
 */
export function variantes(consulta: string): string[] {
  const base = normalizar(consulta);
  const saida = new Set<string>([base]);
  if (base.includes(" plus")) saida.add(base.replace(/ plus/g, "+"));
  if (base.includes("+")) saida.add(base.replace(/\+/g, " plus").replace(/\s+/g, " ").trim());
  return [...saida];
}
