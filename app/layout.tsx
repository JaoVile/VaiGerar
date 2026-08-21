import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Caçador de Ofertas — rodadas",
  description: "Log de coleta e alertas, uma linha por rodada de cron.",
  robots: { index: false, follow: false },
  // Sem `icons` aqui de propósito: `app/icon.svg` é convenção de arquivo do
  // App Router e o Next já emite o <link> com hash de cache. Declarar o
  // caminho à mão sobrescreveria isso por uma URL sem versão.
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
