"use client";

import { useState } from "react";
import { Banknote, CheckCircle2, ChevronRight, Search } from "lucide-react";
import { formatPrice } from "@/lib/constants";
import { RiderOrder, RiderRevenueDay, RiderStats } from "../types";
import { calculateOrderCollectionTotal } from "../utils";

type WalletViewProps = {
  stats: RiderStats;
  ordersToSettle: RiderOrder[];
  revenueHistory: RiderRevenueDay[];
  onOpen: (order: RiderOrder) => void;
};

export function WalletView({ stats, ordersToSettle, revenueHistory, onOpen }: WalletViewProps) {
  const [period, setPeriod] = useState("today");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(15);
  const today = new Date().toISOString().slice(0, 10);
  const allOrders = Array.from(new Map([...revenueHistory.flatMap(d => d.orders), ...ordersToSettle].map(o => [o.id, o])).values());
  const pendingTotal = ordersToSettle.reduce((sum, o) => sum + calculateOrderCollectionTotal(o), 0);
  const pendingFees = ordersToSettle.reduce((sum, o) => sum + Math.min(Math.max(0, o.deliveryFee), calculateOrderCollectionTotal(o)), 0);
  const query = search.trim().toLocaleLowerCase("fr");
  const filtered = allOrders.filter(o => {
    const date = new Date(o.deliveredAt || o.deliveryDate || o.updatedAt || o.createdAt).toISOString().slice(0, 10);
    return (period === "all" || date === today)
      && (status === "all" || (status === "pending" ? !o.settlementId : Boolean(o.settlementId)))
      && (!query || [o.ref, o.customerName, o.customerPhone, o.commune].some(v => v?.toLocaleLowerCase("fr").includes(query)));
  }).sort((a, b) => new Date(b.deliveredAt || b.deliveryDate || b.updatedAt).getTime() - new Date(a.deliveredAt || a.deliveryDate || a.updatedAt).getTime());
  const filteredTotal = filtered.reduce((sum, o) => sum + calculateOrderCollectionTotal(o), 0);

  return <section className="space-y-3">
    <div className="flex items-center justify-between">
      <h2 className="text-xl font-bold text-slate-900">Ma caisse</h2>
      <Banknote size={20} className="text-slate-500" />
    </div>
    <section className="rounded-lg bg-slate-900 p-4 text-white">
      <p className="text-xs font-semibold text-slate-300">Encaissements à régulariser · toutes dates</p>
      <p className="mt-1 text-3xl font-extrabold tabular-nums">{formatPrice(pendingTotal)}</p>
      <p className="mt-1 text-xs text-slate-300">{ordersToSettle.length} commande(s) sans règlement enregistré</p>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/15 pt-3">
        <div><p className="text-xs text-slate-300">Part articles</p><p className="text-sm font-bold tabular-nums">{formatPrice(pendingTotal - pendingFees)}</p></div>
        <div><p className="text-xs text-slate-300">Dont frais de livraison</p><p className="text-sm font-bold tabular-nums">{formatPrice(pendingFees)}</p></div>
      </div>
    </section>
    <div className="grid grid-cols-2 gap-2">
      <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Encaissé aujourd’hui</p><p className="mt-1 text-lg font-extrabold tabular-nums text-slate-900">{formatPrice(stats.todayCash)}</p></div>
      <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Livraisons du jour</p><p className="mt-1 text-lg font-extrabold text-slate-900">{stats.deliveredToday}<span className="ml-2 text-xs font-normal text-slate-500">dont {stats.partiallyDeliveredToday} partielles</span></p></div>
    </div>
    <div className="space-y-2">
      <div className="flex gap-2">
        {[["today", "Aujourd’hui"], ["all", "Toutes dates"]].map(([value, label]) => <button key={value} aria-pressed={period === value} onClick={() => { setPeriod(value); setLimit(15); }} className={`min-h-11 flex-1 rounded-md border px-3 text-sm font-semibold ${period === value ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"}`}>{label}</button>)}
      </div>
      <label className="relative block"><Search size={16} className="absolute left-3 top-3.5 text-slate-400" /><input aria-label="Rechercher un encaissement" value={search} onChange={e => { setSearch(e.target.value); setLimit(15); }} placeholder="Référence, client, téléphone…" className="h-11 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-base" /></label>
      <select aria-label="État du règlement" value={status} onChange={e => { setStatus(e.target.value); setLimit(15); }} className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-base"><option value="all">Tous les règlements</option><option value="pending">À régulariser</option><option value="settled">Règlement enregistré</option></select>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-slate-500"><span>{filtered.length} commande(s) affichable(s)</span><strong className="text-slate-700">{formatPrice(filteredTotal)} encaissés</strong></div>
    <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
      {filtered.length === 0 ? <div className="p-6 text-center"><CheckCircle2 size={24} className="mx-auto text-slate-400" /><p className="mt-2 text-sm font-semibold">Aucun encaissement pour ces filtres</p><button onClick={() => { setPeriod("all"); setStatus("all"); setSearch(""); setLimit(15); }} className="mt-2 min-h-11 text-sm font-bold text-orange-700">Afficher les commandes disponibles</button></div> :
        filtered.slice(0, limit).map(o => <button key={o.id} type="button" onClick={() => onOpen(o)} className="flex w-full items-center gap-2 p-3 text-left active:bg-slate-50">
          <div className="min-w-0 flex-1"><p className="break-words text-[15px] font-extrabold text-slate-900">#{o.ref}</p><p className="truncate text-xs text-slate-500">{o.customerName}</p><p className="mt-1 text-[11px] text-slate-500">{new Date(o.deliveredAt || o.deliveryDate || o.updatedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Africa/Abidjan" })} · {o.status === "PARTIALLY_DELIVERED" ? "Livraison partielle" : "Livrée"}</p></div>
          <div className="shrink-0 text-right"><p className="text-sm font-extrabold tabular-nums text-slate-900">{formatPrice(calculateOrderCollectionTotal(o))}</p><p className={`mt-1 text-[11px] font-semibold ${o.settlementId ? "text-green-700" : "text-amber-700"}`}>{o.settlementId ? "Règlement enregistré" : "À régulariser"}</p></div><ChevronRight size={16} className="shrink-0 text-slate-400" />
        </button>)}
    </div>
    {filtered.length > limit && <button onClick={() => setLimit(v => v + 15)} className="min-h-11 w-full rounded-md border border-slate-200 bg-white text-sm font-semibold">Voir la suite ({filtered.length - limit})</button>}
    <p className="text-xs leading-relaxed text-slate-500">Les règlements sont validés par le bureau. Tous les encaissements non régularisés sont inclus ; les commandes déjà réglées sont limitées à l’historique récent chargé. Utilisez l’onglet Historique pour rechercher une date ancienne.</p>
  </section>;
}
