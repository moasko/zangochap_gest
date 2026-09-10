"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Search, ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { getRiderHistory } from "../history-actions";
import { OrderCard } from "./OrderCard";
import type { RiderOrder } from "../types";

function day(offset = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}
const presets = [{ label: "Aujourd’hui", days: 0 }, { label: "Hier", days: 1 }, { label: "7 jours", days: 6 }, { label: "30 jours", days: 29 }];
export function RiderHistory({ onOpen }: { onOpen: (order: RiderOrder) => void }) {
  const [from, setFrom] = useState(() => day());
  const [to, setTo] = useState(() => day());
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search); setPage(1); }, 350);
    return () => clearTimeout(timer);
  }, [search]);
  const valid = Boolean(from && to && from <= to);
  const result = useQuery({
    queryKey: ["rider-history", from, to, status, query, page],
    queryFn: () => getRiderHistory({ from, to, status, search: query, page }),
    enabled: valid,
    staleTime: 10000,
    refetchOnWindowFocus: true,
  });
  return <section className="space-y-3">
    <div>
      <h2 className="text-xl font-bold text-slate-900">Mon historique</h2>

    </div>
    <div className="rider-history-filters rounded-lg border border-slate-200 bg-white space-y-2">
      <div className="flex gap-2 overflow-x-auto">
        {presets.map(p => <button key={p.label} onClick={() => { setFrom(day(-p.days)); setTo(day(p.days === 1 ? -1 : 0)); setPage(1); }} className="shrink-0 min-h-11 rounded-xl border border-slate-200 px-3 text-sm font-semibold hover:bg-orange-50">{p.label}</button>)}
      </div>
      <label className="relative block"><Search size={18} className="absolute left-3 top-4 text-slate-400" />
        <input aria-label="Rechercher dans l’historique" placeholder="Client, référence, téléphone, lieu…" value={search} onChange={e => setSearch(e.target.value)} className="w-full h-12 rounded-xl border border-slate-200 pl-10 pr-3 text-base" />
      </label>
      <details>
        <summary>Période et statut <span className="text-xs font-normal">{from.split("-").reverse().join("/")} – {to.split("-").reverse().join("/")}{status !== "all" ? " · Statut filtré" : ""}</span></summary>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm font-semibold text-slate-700">Du
          <input aria-label="Date de début" type="date" value={from} max={to || day()} onChange={e => { setFrom(e.target.value); setPage(1); }} className="mt-1 w-full min-w-0 h-12 rounded-xl border border-slate-200 bg-slate-50 px-2 text-base" />
        </label>
        <label className="text-sm font-semibold text-slate-700">Au
          <input aria-label="Date de fin" type="date" value={to} min={from} max={day()} onChange={e => { setTo(e.target.value); setPage(1); }} className="mt-1 w-full min-w-0 h-12 rounded-xl border border-slate-200 bg-slate-50 px-2 text-base" />
        </label>
      </div>
      {!valid && <p role="alert" className="text-sm text-red-700">Choisissez une période valide : le début doit précéder la fin.</p>}
      <p className="text-xs text-slate-500">Pour une date précise, choisissez le même jour dans les deux champs. Dates en heure d’Abidjan.</p>
      <label className="block text-sm font-semibold text-slate-700">Statut
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="mt-1 w-full h-12 rounded-xl border border-slate-200 px-3 text-base">
          <option value="all">Tous les statuts</option><option value="DELIVERED">Livrées</option><option value="PARTIALLY_DELIVERED">Livraisons partielles</option><option value="RETURNED">Retours</option><option value="CANCELLED">Annulées</option><option value="REPRO_DISPO">Reprogrammées</option>
        </select>
      </label>
      </details>
    </div>
    {valid && result.isPending && <p role="status" className="p-6 text-center text-slate-600">Recherche des livraisons…</p>}
    {result.isError && <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800"><p>Impossible de charger l’historique. Vérifiez votre connexion.</p><button onClick={() => result.refetch()} className="mt-2 min-h-11 font-bold">Réessayer</button></div>}
    {valid && result.data && <>
      <div className="flex items-center justify-between text-sm text-slate-600" aria-live="polite">
        <span>{result.data.total} résultat(s) · page {result.data.page}/{result.data.pages}</span>
        <button aria-label="Actualiser l’historique" disabled={result.isFetching} onClick={() => result.refetch()} className="p-3"><RotateCw size={18} className={result.isFetching ? "animate-spin" : ""} /></button>
      </div>
      {result.data.total === 0 ? <div className="rounded-2xl bg-white p-8 text-center border border-slate-200"><CalendarDays className="mx-auto mb-3 text-slate-400" /><h3 className="font-bold">Aucune livraison trouvée</h3><p className="mt-2 text-sm text-slate-500">Essayez une autre période ou effacez la recherche.</p></div> :
        result.data.orders.map(order => <OrderCard key={order.id} order={order} onClick={() => onOpen(order)} />)}
      {result.data.pages > 1 && <div className="flex items-center justify-between gap-3">
        <button disabled={result.data.page <= 1 || result.isFetching} onClick={() => setPage(result.data.page - 1)} className="flex items-center gap-1 min-h-12 rounded-xl border bg-white px-4 disabled:opacity-40"><ChevronLeft size={18} /> Précédent</button>
        <button disabled={result.data.page >= result.data.pages || result.isFetching} onClick={() => setPage(result.data.page + 1)} className="flex items-center gap-1 min-h-12 rounded-xl bg-slate-900 text-white px-4 disabled:opacity-40">Suivant <ChevronRight size={18} /></button>
      </div>}
    </>}
  </section>;
}
