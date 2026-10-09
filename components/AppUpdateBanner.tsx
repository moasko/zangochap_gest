"use client";

// Bandeau non bloquant : l'onglet tourne sur une ancienne version apres un deploiement
// (ses actions serveur ne sont plus reconnues). On propose de recharger plutot que de
// le faire de force, pour ne jamais perdre une saisie en cours.
import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { APP_OUTDATED_EVENT } from "@/lib/stale-server-action";

export default function AppUpdateBanner() {
  const [outdated, setOutdated] = useState(false);

  useEffect(() => {
    const show = () => setOutdated(true);
    window.addEventListener(APP_OUTDATED_EVENT, show);
    return () => window.removeEventListener(APP_OUTDATED_EVENT, show);
  }, []);

  if (!outdated) return null;

  return (
    <div
      role="status"
      style={{
        position: "fixed", left: "50%", bottom: 20, transform: "translateX(-50%)", zIndex: 9999,
        display: "flex", alignItems: "center", gap: 12, padding: "10px 12px 10px 16px", borderRadius: 999,
        background: "#1A1410", color: "#FAF6F1", boxShadow: "0 12px 32px rgba(26,20,16,.25)",
        fontSize: 13, fontWeight: 700, maxWidth: "calc(100vw - 32px)",
      }}
    >
      <span>Nouvelle version de l&apos;application disponible.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", border: "none", borderRadius: 999,
          background: "#D4541C", color: "#FAF6F1", fontWeight: 800, fontSize: 13, cursor: "pointer",
        }}
      >
        <RefreshCw size={14} /> Recharger
      </button>
    </div>
  );
}
