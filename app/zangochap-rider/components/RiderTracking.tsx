"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useScreenAwake } from "./use-screen-awake";
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

export function RiderTracking({ riderId, settingsTarget, openSettings }: { riderId: string; settingsTarget: HTMLDivElement | null; openSettings: () => void }) {
  const [active, setActive] = useState(false);
  const screenAwake = useScreenAwake(active, riderId);
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
    if (sent.current && Date.now() - sent.current.sentAt < 10000) return;
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
    const watcherSession = token.current;
    let latest: GeolocationPosition | null = null;
    let disposed = false;
    const handleError = (error: unknown) => {
      if (disposed || !mounted.current || token.current !== watcherSession) return;
      if (error instanceof Error && error.message === "SESSION_STOPPED") {
        paused.current = true; stop(); setNotice("Cette tournée a été arrêtée ou remplacée sur un autre appareil.");
      } else if (typeof error === "object" && error && "code" in error && error.code === 1) {
        permissionDenied.current = true; stop(); setNotice("Autorisation GPS retirée. Suivi arrêté.");
      } else setNotice(error instanceof Error ? error.message : "GPS temporairement indisponible. En attente d’une nouvelle position.");
    };
    const transmit = async () => {
      const sessionId = token.current;
      if (disposed || !sessionId || sampling.current || !latest) return;
      if (!navigator.onLine) { setNotice("Hors réseau : aucun envoi. Reprise à la reconnexion."); return; }
      sampling.current = true;
      try {
        // watchPosition may remain quiet while stationary: acquire a fresh heartbeat.
        if (Date.now() - latest.timestamp > 50000) latest = await locate();
        await upload(latest, sessionId);
      }
      catch (error) { if (token.current === sessionId) handleError(error); }
      finally { sampling.current = false; }
    };
    const watch = navigator.geolocation.watchPosition(position => {
      latest = position; void transmit();
    }, handleError, { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    const timer = window.setInterval(() => { void transmit(); }, 10000);
    const online = () => { void transmit(); };
    window.addEventListener("online", online);
    return () => { disposed = true; navigator.geolocation.clearWatch(watch); window.clearInterval(timer); window.removeEventListener("online", online); };
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
      <button type="button" onClick={openSettings} className="min-h-10 rounded-md px-2 text-xs font-medium text-slate-500">Paramètres</button>
    </div>
    {settingsTarget && createPortal(<section className="rounded-lg border border-slate-200 bg-white p-3" aria-label="Paramètres GPS">
      <h3 className="text-sm font-bold text-slate-900">Paramètres · Localisation</h3>
      <div className="mt-2 flex items-center gap-3">
        <span className="flex-1 text-sm text-slate-600">{active ? "GPS partagé avec le bureau" : busy ? "Connexion GPS…" : "GPS désactivé"}</span>
        <button type="button" onClick={toggle} className="min-h-11 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-700">{active || busy ? "Désactiver le GPS" : "Activer le GPS"}</button>
      </div>
      <div className="mt-3 border-t border-slate-100 pt-3">
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm text-slate-700">
          Garder l’écran allumé
          <input type="checkbox" checked={screenAwake.enabled} onChange={screenAwake.toggle} className="h-5 w-5 accent-orange-600" />
        </label>
        <p role="status" className="text-xs text-slate-500">{screenAwake.status}</p>
        <p className="mt-1 text-xs text-slate-500">Pendant le suivi, tant que cette page reste visible. Consomme davantage de batterie.</p>
      </div>
      <div className="mt-2 text-xs leading-relaxed text-slate-500">
      {notice && <p role="status" className="my-1 text-amber-800">{notice}</p>}
      {active && last && <p className="my-1">Dernier envoi {last.time} · précision ±{last.accuracy} m</p>}
      <p className="mt-1">Le suivi démarre à l’ouverture avec l’autorisation GPS du téléphone. Votre position est partagée avec les administrateurs et enregistrée environ toutes les 10 secondes en déplacement, toutes les minutes à l’arrêt. Un arrêt manuel reste mémorisé dans cet onglet jusqu’à réactivation. Gardez cette page ouverte ; le suivi peut être suspendu écran verrouillé.</p>
      </div>
    </section>, settingsTarget)}
  </section>;
}
