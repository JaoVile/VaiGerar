"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TICK_INTERVAL_MIN } from "@/lib/painel";

/**
 * Recarrega no ritmo do tick. Desligável porque um refresh no meio de uma
 * rodada aberta fecha o que você estava lendo.
 */
export function AutoRefresh() {
  const router = useRouter();
  const [ligado, setLigado] = useState(true);
  const [restante, setRestante] = useState(60);

  useEffect(() => {
    if (!ligado) return;
    const id = setInterval(() => {
      setRestante((s) => {
        if (s <= 1) {
          router.refresh();
          return 60;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [ligado, router]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button
        type="button"
        className="btn"
        aria-pressed={ligado}
        onClick={() => {
          setLigado((v) => !v);
          setRestante(60);
        }}
      >
        {ligado ? `auto ${restante}s` : "auto off"}
      </button>
      <button type="button" className="btn" onClick={() => router.refresh()}>
        Recarregar
      </button>
      <span className="label">tick a cada {TICK_INTERVAL_MIN} min</span>
    </div>
  );
}
