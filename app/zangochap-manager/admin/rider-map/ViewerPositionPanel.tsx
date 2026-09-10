"use client";
import { useEffect, useRef, useState } from "react";
import { distanceMeters } from "@/modules/rider-tracking/validation";
import type { SelectedPosition, ViewerPosition } from "@/modules/rider-tracking/viewer-position";
export default function ViewerPositionPanel({ position, destination, linked, onPosition, onLink }: {
  position: ViewerPosition | null; destination: SelectedPosition | null; linked: boolean;
  onPosition: (point: ViewerPosition | null) => void; onLink: (value: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const locate = async () => {
    const version = ++generation.current;
    setBusy(true); setNotice("");
    try {
      if (!window.isSecureContext || !navigator.geolocation) throw new Error("La localisation nécessite HTTPS et un navigateur compatible.");
      const result = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }));
      if (version !== generation.current) return;
      onPosition({ latitude: result.coords.latitude, longitude: result.coords.longitude, accuracy: result.coords.accuracy, time: new Date(result.timestamp).toISOString() });
    } catch (error) { if (version === generation.current) setNotice(error instanceof Error ? error.message : "Position indisponible ou autorisation refusée. Vérifiez les réglages du navigateur."); }
    finally { if (version === generation.current) setBusy(false); }
  };
  const button = "min-h-10 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50";
  return <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3" aria-label="Ma position et le livreur">
    <div className="flex flex-wrap items-center gap-2">
      <strong className="mr-2 text-sm">Ma position</strong>
      <button className={button} disabled={busy} onClick={() => { void locate(); }}>{busy ? "Localisation…" : position ? "Actualiser ma position" : "Afficher ma position"}</button>
      {(position || busy) && <button className={button} onClick={() => { generation.current++; setBusy(false); onPosition(null); onLink(false); setNotice(""); }}>Masquer / arrêter</button>}
      {position && destination && <button className={button} aria-pressed={linked} onClick={() => onLink(!linked)}>{linked ? "Masquer la liaison" : "Relier au point de " + destination.name}</button>}
    </div>
    {position && <p className="text-xs text-slate-600">Relevée le {new Date(position.time).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" })} (Abidjan) · précision ±{Math.round(position.accuracy)} m. Actualisez après un déplacement.</p>}
    {position && destination && <p className="text-xs text-slate-600">{destination.name} : {(distanceMeters(position, destination) / 1000).toFixed(2)} km à vol d’oiseau. Point du {new Date(destination.time).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" })} (Abidjan).</p>}
    {position && !destination && <p className="text-xs text-slate-500">Sélectionnez un livreur en direct ou un point dans l’historique.</p>}
    {notice && <p role="status" className="text-xs text-amber-800">{notice}</p>}
    <p className="text-[11px] text-slate-500">Le trait en pointillés relie les deux positions ; ce n’est pas un itinéraire routier. Votre position reste dans cette page et n’est pas enregistrée en base.</p>
  </section>;
}
