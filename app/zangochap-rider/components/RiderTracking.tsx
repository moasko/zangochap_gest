"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LocateFixed } from "lucide-react";
import { distanceMeters } from "@/modules/rider-tracking/validation";

type SentPosition = { latitude: number; longitude: number; sentAt: number };
async function trackingRequest(body: object) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch("/api/rider-tracking", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), keepalive: true, signal: controller.signal,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(response.status === 409 ? "SESSION_STOPPED" : data.error || "Transmission impossible.");
    return data as { accepted?: boolean };
  } finally { window.clearTimeout(timer); }
}
function locate(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
    enableHighAccuracy: true, maximumAge: 0, timeout: 9000,
  }));
}

export function RiderTracking({ riderId }: { riderId: string }) {
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [last, setLast] = useState<{ time: string; accuracy: number } | null>(null);
  const token = useRef<string | null>(null);
  const generation = useRef(0);
  const starting = useRef(false);
  const permissionDenied = useRef(false);
  const paused = useRef(false);
  const pauseKey = "rider-gps-paused:" + riderId;
  const mounted = useRef(false);
  const sampling = useRef(false);
  const sent = useRef<SentPosition | null>(null);
  const pendingStops = useRef(new Set<string>());
  const storageKey = "rider-gps-pending-stop:" + riderId;

  const saveStops = useCallback(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify([...pendingStops.current])); } catch { /* Storage may be disabled. */ }
  }, [storageKey]);

  const flushStops = useCallback(async () => {
    for (const sessionId of [...pendingStops.current]) {
      try {
        await trackingRequest({ action: "stop", sessionId });
        pendingStops.current.delete(sessionId);
        saveStops();
      } catch { /* Retry on reconnect. No coordinates are retained locally. */ }
    }
    if (mounted.current && !pendingStops.current.size && !token.current) setNotice("Suivi arrêté.");
  }, [saveStops]);

  const stop = useCallback(() => {
    generation.current++;
    starting.current = false;
    const sessionId = token.current;
    token.current = null;
    sent.current = null;
    if (mounted.current) {
      setActive(false);
      setBusy(false);
      setNotice(sessionId ? "GPS arrêté sur ce téléphone. Synchronisation de l’arrêt…" : "Suivi arrêté.");
    }
    if (sessionId) {
      pendingStops.current.add(sessionId);
      saveStops();
      void flushStops();
    }
  }, [flushStops, saveStops]);

  useEffect(() => {
    mounted.current = true;
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
      if (Array.isArray(stored)) for (const id of stored) if (typeof id === "string") pendingStops.current.add(id);
    } catch { /* Ignore invalid local state. */ }
    if (pendingStops.current.size) void flushStops();
    const retry = () => { if (pendingStops.current.size) void flushStops(); };
    const timer = window.setInterval(retry, 10000);
    window.addEventListener("online", retry);
    window.addEventListener("pagehide", stop);
    return () => {
      mounted.current = false;
      stop();
      window.clearInterval(timer);
      window.removeEventListener("online", retry);
      window.removeEventListener("pagehide", stop);
    };
  }, [storageKey, stop, flushStops]);

  const upload = useCallback(async (position: GeolocationPosition, sessionId: string) => {
    if (token.current !== sessionId || !mounted.current) return;
    const coords = { latitude: position.coords.latitude, longitude: position.coords.longitude };
    if (sent.current && Date.now() - sent.current.sentAt < 60000 && distanceMeters(sent.current, coords) < 20) return;
    const result = await trackingRequest({
      action: "point", sessionId, id: crypto.randomUUID(), ...coords,
      accuracy: position.coords.accuracy, capturedAt: new Date(position.timestamp).toISOString(),
    });
    if (token.current !== sessionId || !mounted.current) return;
    if (result.accepted) {
      sent.current = { ...coords, sentAt: Date.now() };
      setLast({ time: new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }), accuracy: Math.round(position.coords.accuracy) });
      setNotice("");
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    const tick = async () => {
      const sessionId = token.current;
      if (!sessionId || sampling.current) return;
      if (!navigator.onLine) { setNotice("Hors réseau : aucun envoi. Reprise à la reconnexion."); return; }
      sampling.current = true;
      try { await upload(await locate(), sessionId); }
      catch (error) {
        if (token.current !== sessionId || !mounted.current) return;
        if (error instanceof Error && error.message === "SESSION_STOPPED") {
          paused.current = true; stop(); setNotice("Cette tournée a été arrêtée ou remplacée sur un autre appareil.");
        } else if (typeof error === "object" && error && "code" in error && error.code === 1) {
          permissionDenied.current = true; stop(); setNotice("Autorisation GPS retirée. Suivi arrêté.");
        } else setNotice(error instanceof Error ? error.message : "Position indisponible. Nouvelle tentative dans 10 secondes.");
      } finally { sampling.current = false; }
    };
    const timer = window.setInterval(() => { void tick(); }, 10000);
    return () => window.clearInterval(timer);
  }, [active, upload, stop]);

  const start = useCallback(async () => {
    if (starting.current || token.current) return;
    if (!window.isSecureContext || !navigator.geolocation) { setNotice("Le GPS nécessite HTTPS et un navigateur compatible."); return; }
    if (!navigator.onLine) { setNotice("Connectez-vous au réseau pour démarrer."); return; }
    starting.current = true;
    setBusy(true); setNotice("Autorisez la localisation pour partager votre position pendant la tournée.");
    const version = ++generation.current;
    let newSession: string | null = null;
    try {
      const position = await locate();
      if (!mounted.current || version !== generation.current) return;
      newSession = crypto.randomUUID();
      await trackingRequest({ action: "start", sessionId: newSession });
      if (!mounted.current || version !== generation.current) {
        pendingStops.current.add(newSession); saveStops(); void flushStops(); return;
      }
      token.current = newSession; sent.current = null; setLast(null); setActive(true);
      await upload(position, newSession);
    } catch (error) {
      if (newSession && token.current !== newSession) {
        pendingStops.current.add(newSession); saveStops(); void flushStops();
      }
      if (typeof error === "object" && error && "code" in error && error.code === 1) permissionDenied.current = true;
      if (mounted.current && version === generation.current) setNotice(error instanceof Error ? error.message : "GPS indisponible ou autorisation refusée. Vérifiez les réglages du téléphone.");
    } finally {
      if (version === generation.current) { starting.current = false; if (mounted.current) setBusy(false); }
    }
  }, [flushStops, saveStops, upload]);

  useEffect(() => {
    try { paused.current = sessionStorage.getItem(pauseKey) === "1"; } catch { /* Optional preference storage. */ }
    const autoStart = () => { if (!paused.current && !permissionDenied.current) void start(); };
    // Deferred so Strict Mode's trial mount does not request GPS twice.
    const timer = window.setTimeout(autoStart, 0);
    window.addEventListener("online", autoStart);
    return () => { window.clearTimeout(timer); window.removeEventListener("online", autoStart); };
  }, [pauseKey, start]);

  const toggle = () => {
    paused.current = active || busy;
    try { sessionStorage.setItem(pauseKey, paused.current ? "1" : "0"); } catch { /* Keep the in-memory preference. */ }
    if (paused.current) stop();
    else { permissionDenied.current = false; void start(); }
  };

  return <section className="mb-2 px-1" aria-label="Partage de position">
    <div className="flex min-h-9 items-center gap-2 text-xs">
      <LocateFixed size={14} className={active ? "text-green-700" : "text-slate-400"} />
      <span role="status" className="min-w-0 flex-1 text-slate-500">{active ? "GPS partagé avec le bureau" : busy ? "Connexion GPS…" : "GPS désactivé"}</span>
      <button type="button" onClick={toggle} className="min-h-10 rounded-md px-2 text-xs font-medium text-slate-600 underline underline-offset-2">{active || busy ? "Arrêter" : "Activer"}</button>
    </div>
    <details className="text-[11px] text-slate-500">
      <summary className="w-fit cursor-pointer py-1">{notice && !busy ? "GPS : informations" : "Détails du suivi"}</summary>
      {notice && <p role="status" className="my-1 text-amber-800">{notice}</p>}
      {active && last && <p className="my-1">Dernier envoi {last.time} · précision ±{last.accuracy} m</p>}
      <p className="mt-1">Le suivi démarre à l’ouverture avec l’autorisation GPS du téléphone. Votre position est partagée avec les administrateurs et enregistrée environ toutes les 10 secondes en déplacement, toutes les minutes à l’arrêt. Un arrêt manuel reste mémorisé dans cet onglet jusqu’à réactivation. Gardez cette page ouverte ; le suivi peut être suspendu écran verrouillé.</p>
    </details>
  </section>;
}
