import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Caçador de Ofertas — rodadas",
  description: "Log de coleta e alertas, uma linha por rodada de cron.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
