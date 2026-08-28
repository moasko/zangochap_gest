"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Search, XCircle } from "lucide-react";
import { reviewExpeditionDeposit } from "@/modules/expedition-deposits/actions";
import { useToast } from "@/components/Toast";

type DepositOrder = { id: string; ref: string | null; customerName: string; customerPhone: string; total: number; deliveryFee: number; paymentMethod: string | null; depositSenderPhone: string | null; depositTransactionRef: string | null; depositVerificationStatus: string | null; depositVerificationNote: string | null; depositVerifiedAt: string | null; depositVerifiedByName: string | null; commercialName: string | null; createdAt: string; status: string };
const labels: Record<string, string> = { PENDING: "À vérifier", RECEIVED: "Reçu", NOT_RECEIVED: "Non reçu", CORRECTION_REQUIRED: "À corriger" };

export default function DepositVerificationClient({ initialOrders }: { initialOrders: DepositOrder[] }) {
  const [orders, setOrders] = useState(initialOrders);
  const [filter, setFilter] = useState("PENDING");
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();
  const visible = useMemo(() => orders.filter(order => (!filter || order.depositVerificationStatus === filter) && [order.ref, order.customerName, order.customerPhone, order.depositSenderPhone, order.depositTransactionRef, order.commercialName].some(value => String(value || "").toLowerCase().includes(search.toLowerCase()))), [orders, filter, search]);
  const decide = (order: DepositOrder, status: string) => startTransition(async () => {
    try {
      await reviewExpeditionDeposit(order.id, status, notes[order.id]);
      setOrders(current => current.map(item => item.id === order.id ? { ...item, depositVerificationStatus: status, depositVerificationNote: notes[order.id] || null, depositVerifiedAt: new Date().toISOString() } : item));
      showToast(status === "RECEIVED" ? "Dépôt confirmé" : "Alerte envoyée au commercial", "success");
    } catch (error) { showToast(error instanceof Error ? error.message : "Action impossible", "error"); }
  });

  return <div className="content">
    <div className="flex flex-wrap gap-2 mb-4">
      {[["PENDING", "À vérifier", Clock3], ["NOT_RECEIVED", "Non reçus", XCircle], ["CORRECTION_REQUIRED", "À corriger", AlertTriangle], ["RECEIVED", "Reçus", CheckCircle2], ["", "Tous", Search]].map(([value, label, Icon]) => <button key={String(value)} onClick={() => setFilter(String(value))} className={`px-3 py-2 rounded-xl border font-bold text-sm flex items-center gap-2 ${filter === value ? "bg-orange-500 text-white border-orange-500" : "bg-white"}`}><Icon size={16} />{String(label)} ({value ? orders.filter(o => o.depositVerificationStatus === value).length : orders.length})</button>)}
    </div>
    <div className="bg-white border rounded-xl p-3 mb-4 flex items-center gap-2"><Search size={18} className="text-gray-400" /><input className="w-full outline-none" value={search} onChange={e => setSearch(e.target.value)} placeholder="Commande, client, numéro du dépôt, référence…" /></div>
    {visible.length === 0 ? <div className="empty"><h4>Aucun dépôt dans cette liste</h4></div> : <div className="grid gap-3">
      {visible.map(order => <article key={order.id} className="bg-white border rounded-2xl p-4 shadow-sm">
        <div className="flex flex-wrap justify-between gap-2 mb-3"><div><strong className="text-lg">{order.ref || "Sans référence"}</strong><div className="text-sm text-gray-600">{order.customerName} · {order.customerPhone}</div></div><span className="h-fit px-3 py-1 rounded-full bg-orange-50 text-orange-800 font-bold text-xs">{labels[order.depositVerificationStatus || ""] || order.depositVerificationStatus}</span></div>
        <div className="grid sm:grid-cols-4 gap-3 bg-gray-50 rounded-xl p-3 text-sm">
          <div><small className="block text-gray-500">Moyen</small><strong>{order.paymentMethod || "—"}</strong></div><div><small className="block text-gray-500">Numéro du déposant</small><strong>{order.depositSenderPhone || "—"}</strong></div><div><small className="block text-gray-500">Référence</small><strong>{order.depositTransactionRef || "—"}</strong></div><div><small className="block text-gray-500">Montant commande</small><strong>{(order.total + order.deliveryFee).toLocaleString("fr-FR")} F</strong></div>
        </div>
        <div className="mt-3 text-sm">Commercial : <strong>{order.commercialName || "Non attribué"}</strong>{order.depositVerifiedByName && <span className="text-gray-500"> · Vérifié par {order.depositVerifiedByName}</span>}</div>
        {order.depositVerificationStatus !== "RECEIVED" && <><textarea value={notes[order.id] || ""} onChange={e => setNotes(current => ({ ...current, [order.id]: e.target.value }))} className="mt-3 w-full border rounded-xl p-3 text-sm" placeholder="Motif pour le commercial (obligatoire si non reçu ou à corriger)" /><div className="mt-2 grid sm:grid-cols-3 gap-2"><button disabled={isPending} onClick={() => decide(order, "RECEIVED")} className="rounded-xl bg-green-600 text-white p-3 font-bold">Dépôt reçu</button><button disabled={isPending} onClick={() => decide(order, "NOT_RECEIVED")} className="rounded-xl bg-red-600 text-white p-3 font-bold">Non reçu</button><button disabled={isPending} onClick={() => decide(order, "CORRECTION_REQUIRED")} className="rounded-xl bg-amber-500 text-white p-3 font-bold">À corriger</button></div></>}
      </article>)}
    </div>}
  </div>;
}
