"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, Check, Phone, X } from "lucide-react";
import { acknowledgeDepositAlert, correctExpeditionDeposit } from "@/modules/expedition-deposits/actions";
import { playRiderMessageSound, showBrowserNotification } from "@/lib/client-alerts";
import { useToast } from "@/components/Toast";

type AlertOrder = { id: string; ref: string | null; customerName: string; customerPhone: string; paymentMethod: string | null; depositSenderPhone: string | null; depositTransactionRef: string | null; depositVerificationNote: string | null };

export default function GlobalDepositAlert() {
  const [alerts, setAlerts] = useState<AlertOrder[]>([]);
  const [phone, setPhone] = useState("");
  const [reference, setReference] = useState("");
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();
  const active = alerts[0];

  useEffect(() => {
    let initialized = false;
    let previous = new Set<string>();
    const load = async () => {
      const response = await fetch("/api/expedition-deposit-alerts", { cache: "no-store" });
      if (!response.ok) return;
      const next = await response.json() as AlertOrder[];
      const hasNew = next.some(item => !previous.has(item.id));
      if (hasNew && (initialized || next.some(item => !sessionStorage.getItem(`deposit-alert-sounded:${item.id}`)))) {
        playRiderMessageSound();
        showBrowserNotification("Dépôt expédition non validé", "Une commande hors Abidjan doit être corrigée avant expédition.");
        next.forEach(item => sessionStorage.setItem(`deposit-alert-sounded:${item.id}`, "1"));
      }
      initialized = true;
      previous = new Set(next.map(item => item.id));
      setAlerts(next);
    };
    void load();
    const timer = window.setInterval(load, 8_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!active) return;
    setPhone(active.depositSenderPhone || "");
    setReference(active.depositTransactionRef || "");
  }, [active]);

  if (!active) return null;
  const close = () => startTransition(async () => { await acknowledgeDepositAlert(active.id); setAlerts(current => current.slice(1)); });
  const correct = () => startTransition(async () => {
    try {
      await correctExpeditionDeposit(active.id, phone, reference);
      showToast("Correction envoyée à l'administrateur", "success");
      setAlerts(current => current.slice(1));
    } catch (error) { showToast(error instanceof Error ? error.message : "Correction impossible", "error"); }
  });

  return <div className="fixed inset-0 z-[12000] bg-black/55 flex items-center justify-center p-4" role="alertdialog" aria-modal="true">
    <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl overflow-hidden">
      <div className="bg-red-600 text-white p-4 flex gap-3"><AlertTriangle size={28} /><div><strong className="block text-lg">Dépôt non validé</strong><span className="text-sm opacity-90">Commande {active.ref || "sans référence"}</span></div></div>
      <div className="p-5 space-y-4 text-[#1C1C1E]">
        <p className="font-semibold">Appelez le client et corrigez les informations avant l’expédition.</p>
        <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm"><strong>Motif administrateur :</strong><br />{active.depositVerificationNote || "Dépôt non retrouvé."}</div>
        <div className="text-sm"><strong>{active.customerName}</strong> · <a className="text-blue-700" href={`tel:${active.customerPhone}`}><Phone size={13} className="inline" /> {active.customerPhone}</a><br />Paiement : {active.paymentMethod || "Non renseigné"}</div>
        <label className="block text-xs font-bold">NUMÉRO AYANT EFFECTUÉ LE DÉPÔT<input className="mt-1 w-full rounded-lg border p-3 text-base" value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ""))} inputMode="numeric" /></label>
        <label className="block text-xs font-bold">RÉFÉRENCE (FACULTATIF)<input className="mt-1 w-full rounded-lg border p-3 text-base" value={reference} onChange={e => setReference(e.target.value)} /></label>
        <button disabled={isPending || !phone} onClick={correct} className="w-full rounded-xl bg-green-600 text-white p-3 font-bold disabled:opacity-50"><Check size={18} className="inline mr-2" />Envoyer la correction</button>
        <button disabled={isPending} onClick={close} className="w-full text-sm text-gray-600 p-2"><X size={15} className="inline mr-1" />Fermer, j’ai pris connaissance</button>
        {alerts.length > 1 && <p className="text-center text-xs text-red-700">{alerts.length - 1} autre(s) alerte(s) en attente</p>}
      </div>
    </div>
  </div>;
}
