"use client";
import { useCallback, useEffect, useState } from "react";
export function useScreenAwake(active: boolean, riderId: string) {
  const [enabled, setEnabled] = useState(false);
  const [status, setStatus] = useState("");
  const key = "rider-screen-awake:" + riderId;
  useEffect(() => { try { setEnabled(localStorage.getItem(key) === "1"); } catch { /* Optional preference. */ } }, [key]);
  const toggle = useCallback(() => {
    const value = !enabled;
    setEnabled(value);
    try { localStorage.setItem(key, value ? "1" : "0"); } catch { /* In-memory preference still works. */ }
  }, [enabled, key]);
  useEffect(() => {
    if (!enabled) { setStatus("Désactivé"); return; }
    if (!active) { setStatus("En attente du suivi GPS"); return; }
    if (!("wakeLock" in navigator)) { setStatus("Non pris en charge par ce navigateur"); return; }
    let disposed = false;
    let pending = false;
    let lock: WakeLockSentinel | null = null;
    const request = async () => {
      if (disposed || pending || lock && !lock.released) return;
      if (document.visibilityState !== "visible") { setStatus("Suspendu : application en arrière-plan"); return; }
      pending = true;
      try {
        const acquired = await navigator.wakeLock.request("screen");
        if (disposed || document.visibilityState !== "visible") { await acquired.release(); return; }
        lock = acquired; setStatus("Écran maintenu allumé");
        acquired.addEventListener("release", () => {
          if (lock === acquired) lock = null;
          if (!disposed) setStatus("Suspendu par le téléphone");
        });
      } catch { if (!disposed) setStatus("Indisponible : vérifiez le mode économie d’énergie"); }
      finally { pending = false; }
    };
    const visibility = () => {
      if (document.visibilityState === "visible") void request();
      else {
        setStatus("Suspendu : application en arrière-plan");
        if (lock) { const current = lock; lock = null; void current.release().catch(() => {}); }
      }
    };
    void request();
    document.addEventListener("visibilitychange", visibility);
    return () => { disposed = true; document.removeEventListener("visibilitychange", visibility); if (lock) void lock.release().catch(() => {}); };
  }, [active, enabled]);
  return { enabled, status, toggle };
}
