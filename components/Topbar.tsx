"use client";

import { useEffect, useState, useTransition } from "react";
import { PauseCircle, PlayCircle, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { getCurrentCommercialPauseStatus, toggleCommercialPause } from "@/modules/chat/actions";
import "./topbar.css";

interface TopbarProps {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}

export default function Topbar({ title, subtitle, actions }: TopbarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pauseState, setPauseState] = useState({
    canPause: false,
    isPaused: false,
    pauseReason: null as string | null,
  });
  const [pauseReason, setPauseReason] = useState("");

  useEffect(() => {
    getCurrentCommercialPauseStatus()
      .then((status) => {
        setPauseState(status);
        setPauseReason(status.pauseReason || "");
      })
      .catch(() => undefined);
  }, []);

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const q = (e.target as HTMLInputElement).value;
      if (q) router.push(`/orders?q=${encodeURIComponent(q)}`);
    }
  };

  const handlePauseToggle = () => {
    const nextPaused = !pauseState.isPaused;
    startTransition(async () => {
      const result = await toggleCommercialPause(nextPaused, pauseReason);
      setPauseState({
        canPause: true,
        isPaused: result.isPaused,
        pauseReason: result.pauseReason,
      });
      if (!result.isPaused) setPauseReason("");
    });
  };

  return (
    <div className="topbar">
      <h1>
        {title} {subtitle && <em>{subtitle}</em>}
      </h1>
      
      <div className="topbar-spacer" />
      
      <div className="topbar-actions">
        <div className="topbar-search">
          <Search size={16} />
          <input 
            type="text" 
            placeholder="Rechercher partout..." 
            onKeyDown={handleSearch}
          />
        </div>
        {pauseState.canPause && (
          <div className={`topbar-pause ${pauseState.isPaused ? "active" : ""}`}>
            {!pauseState.isPaused && (
              <input
                value={pauseReason}
                onChange={(event) => setPauseReason(event.target.value)}
                placeholder="Motif pause"
                maxLength={160}
              />
            )}
            <button
              type="button"
              onClick={handlePauseToggle}
              disabled={isPending}
              title={pauseState.isPaused ? "Revenir disponible" : "Se mettre en pause"}
            >
              {pauseState.isPaused ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
              <span>{pauseState.isPaused ? "Revenir" : "Pause"}</span>
            </button>
          </div>
        )}
        {actions}
      </div>

      
    </div>
  );
}
