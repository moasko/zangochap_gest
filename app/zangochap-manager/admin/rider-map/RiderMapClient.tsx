"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import { MapPin, RefreshCw } from "lucide-react";
import { trackingStatus, type RiderTrackingResponse } from "@/modules/rider-tracking/types";
import { riderColor } from "@/modules/rider-tracking/colors";
import type { MapMarker } from "./TrackingMap";
const TrackingMap = dynamic(() => import("./TrackingMap"), { ssr: false, loading: () => <div className="h-80 animate-pulse rounded-lg bg-slate-100" /> });
const today = () => new Date().toISOString().slice(0, 10);
const formatTime = (value: string) => new Date(value).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
export default function RiderMapClient() {
  const [mode, setMode] = useState<"live" | "history">("live");
  const [riderId, setRiderId] = useState("");
  const [day, setDay] = useState(today);
  const [from, setFrom] = useState("00:00");
  const [to, setTo] = useState("23:59");
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 10000); return () => window.clearInterval(timer); }, []);
  const live = useQuery<RiderTrackingResponse>({ queryKey: ["rider-tracking-live"], queryFn: async ({ signal }) => {
    const response = await fetch("/api/admin/rider-tracking?mode=live", { signal, cache: "no-store" });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Carte indisponible."); return data;
  }, refetchInterval: mode === "live" ? 10000 : false, retry: 1 });
  const validPeriod = Boolean(day && from && to && from <= to);
  const history = useQuery<RiderTrackingResponse>({ queryKey: ["rider-tracking-history", riderId, day, from, to], enabled: mode === "history" && Boolean(riderId) && validPeriod, queryFn: async ({ signal }) => {
    const params = new URLSearchParams({ mode: "history", riderId, day, from, to });
    const response = await fetch("/api/admin/rider-tracking?" + params, { signal, cache: "no-store" });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "Historique indisponible."); return data;
  }, retry: 1 });
  const points = useMemo(() => mode === "history" && riderId && validPeriod ? history.data?.points || [] : [], [mode, riderId, validPeriod, history.data]);
  const states = live.data?.states;
  const riders = live.data?.riders;
  const markers = useMemo<MapMarker[]>(() => mode !== "live" ? [] : (states || []).filter(s => (!riderId || s.riderId === riderId) && s.latitude !== null && s.longitude !== null && s.capturedAt).map(s => ({ id: s.riderId, name: riders?.find(r => r.id === s.riderId)?.name || "Livreur", phone: riders?.find(r => r.id === s.riderId)?.phone || null, latitude: s.latitude!, longitude: s.longitude!, accuracy: s.accuracy || 0, time: s.capturedAt!, status: trackingStatus(s, now) })), [states, riders, mode, riderId, now]);
  useEffect(() => { setCursor(0); setPlaying(false); }, [riderId, day, from, to, mode]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setCursor(index => {
      if (index >= points.length - 1) return index;
      return index + 1;
    }), 500);
    return () => window.clearInterval(timer);
  }, [playing, points.length]);
  useEffect(() => { if (cursor >= points.length - 1) setPlaying(false); }, [cursor, points.length]);
  const selectedPoint = points[Math.min(cursor, Math.max(0, points.length - 1))];
  const error = mode === "live" ? live.error : history.error || live.error;
  const inputStyle = "rounded-md border border-slate-200 bg-white px-3 py-2 text-sm min-w-0";
  return <div className="mx-auto w-full max-w-[1600px] space-y-4 p-4 lg:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="flex items-center gap-2 text-lg font-bold text-slate-900"><MapPin size={20} /> Suivi des livreurs</h1><p className="mt-1 text-xs text-slate-500">Positions partagées par les livreurs · Heures d’Abidjan (UTC)</p></div>
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">{(["live", "history"] as const).map(value => <button key={value} onClick={() => setMode(value)} className={"rounded-md px-3 py-2 text-sm font-semibold " + (mode === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>{value === "live" ? "En direct" : "Historique"}</button>)}</div></div>
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
      <label className="grid gap-1 text-xs font-medium text-slate-600">Livreur<select value={riderId} onChange={e => setRiderId(e.target.value)} className={inputStyle}><option value="">{mode === "live" ? "Tous les livreurs" : "Choisir un livreur"}</option>{riders?.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      {mode === "history" && <><label className="grid gap-1 text-xs font-medium text-slate-600">Jour<input type="date" value={day} max={today()} onChange={e => setDay(e.target.value)} className={inputStyle} /></label><label className="grid gap-1 text-xs font-medium text-slate-600">De<input type="time" value={from} onChange={e => setFrom(e.target.value)} className={inputStyle} /></label><label className="grid gap-1 text-xs font-medium text-slate-600">À<input type="time" value={to} onChange={e => setTo(e.target.value)} className={inputStyle} /></label><button className={inputStyle} onClick={() => { setDay(today()); setFrom("00:00"); setTo("23:59"); }}>Aujourd’hui</button></>}
      <button aria-label="Actualiser les positions" className={inputStyle + " ml-auto"} disabled={mode === "history" && (!riderId || !validPeriod)} onClick={() => { if (mode === "live") void live.refetch(); else void history.refetch(); }}><RefreshCw size={16} /></button>
    </div>
    {mode === "live" && riderId && <button className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold" style={{ color: riderColor(riderId) }} onClick={() => { setDay(today()); setFrom("00:00"); setTo("23:59"); setMode("history"); }}>Voir le tracé du jour</button>}
    {error && <div role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">{error.message} Les positions conservées à l’écran peuvent être anciennes.</div>}
    {mode === "history" && !validPeriod && <p role="alert" className="text-sm text-red-700">Choisissez un jour et une plage horaire valide.</p>}
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="max-h-[35vh] space-y-2 overflow-y-auto lg:max-h-[65vh]">
        {mode === "live" ? <>{live.isPending && <p className="p-3 text-sm text-slate-500">Chargement des livreurs…</p>}{riders?.filter(r => !riderId || r.id === riderId).map(r => { const state = states?.find(s => s.riderId === r.id); const status = trackingStatus(state, now); return <button key={r.id} onClick={() => setRiderId(r.id)} className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left"><span className="flex items-center gap-2 text-sm font-bold text-slate-900"><span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: riderColor(r.id) }} />{r.name}</span><span className={"mt-1 block text-xs font-medium " + (status === "Suivi actif" ? "text-emerald-700" : "text-slate-500")}>{state ? status : "Aucun partage"}</span><span className="mt-2 block text-xs text-slate-500">{state?.capturedAt ? formatTime(state.capturedAt) + " · ±" + Math.round(state.accuracy || 0) + " m" : "Aucune position reçue"}</span></button>; })}{riders?.length === 0 && <p className="p-3 text-sm text-slate-500">Aucun livreur enregistré.</p>}<p className="p-2 text-xs leading-relaxed text-slate-500">Actualisation toutes les 10 s. Chaque livreur garde sa couleur. Les repères en pointillés indiquent un suivi arrêté ou une position ancienne. La précision dépend du téléphone et du signal GPS.</p></> : <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
          <h2 className="font-bold">Parcours du jour</h2>{riderId && <p className="mt-2 flex items-center gap-2 font-semibold"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: riderColor(riderId) }} />{riders?.find(r => r.id === riderId)?.name || "Livreur"}</p>}<p className="mt-2 text-slate-500">{!riderId ? "Choisissez un livreur pour afficher son parcours." : history.isFetching ? "Chargement du parcours…" : points.length ? points.length + " positions affichées" : "Aucune position pour cette période."}</p>
          {history.data?.truncated && <p className="mt-2 text-amber-700">{history.data.total} positions trouvées. Seules les 10 000 premières sont affichées : réduisez la plage horaire.</p>}
          {selectedPoint && <><p className="mt-4 font-semibold">{formatTime(selectedPoint.capturedAt)}</p><p className="mt-1 text-xs text-slate-500">Précision ±{Math.round(selectedPoint.accuracy)} m · Point {cursor + 1}/{points.length}</p><input aria-label="Position dans le parcours" type="range" min={0} max={Math.max(0, points.length - 1)} value={Math.min(cursor, points.length - 1)} onChange={e => { setPlaying(false); setCursor(Number(e.target.value)); }} className="mt-4 w-full" /><button className={inputStyle + " mt-2 w-full"} onClick={() => { if (cursor >= points.length - 1) setCursor(0); setPlaying(!playing); }} disabled={points.length < 2}>{playing ? "Pause" : "Lire le parcours"}</button></>}
          <p className="mt-4 text-xs leading-relaxed text-slate-500">Le tracé relie les positions reçues. Les interruptions de plus de 5 minutes et les changements de session coupent le tracé. La lecture avance point par point.</p>
        </div>}
      </aside>
      <TrackingMap markers={markers} points={points} cursor={cursor} viewKey={[mode, riderId, day, from, to].join("|")} />
    </div>
  </div>;
}
