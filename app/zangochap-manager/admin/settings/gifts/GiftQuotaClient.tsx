"use client";

import { useState, useTransition } from "react";
import { Check, Gift, X } from "lucide-react";
import { reviewGiftRequest, updateCommercialGiftQuota } from "@/modules/gifts/actions";
import { useToast } from "@/components/Toast";
import { useRouter } from "next/navigation";

type UsageRow = {
  commercial: { id: string; name: string; email: string; giftMonthlyQuota: number; giftMonthlyValueQuota: number };
  usage: { usedQuantity: number; usedValue: number; pending: number };
};
type RequestRow = {
  id: string; commercialName: string; orderRef?: string | null; giftName: string;
  quantity: number; unitValue: number; reason: string; createdAt: string;
};

export default function GiftQuotaClient({ initialData }: { initialData: { usage: UsageRow[]; requests: RequestRow[] } }) {
  const [quotas, setQuotas] = useState(() => new Map(initialData.usage.map(row => [row.commercial.id, {
    quantity: row.commercial.giftMonthlyQuota,
    value: row.commercial.giftMonthlyValueQuota,
  }])));
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();
  const router = useRouter();

  const saveQuota = (commercialId: string) => startTransition(async () => {
    const quota = quotas.get(commercialId);
    if (!quota) return;
    try {
      await updateCommercialGiftQuota(commercialId, quota.quantity, quota.value);
      showToast("Quota mis à jour", "success");
      router.refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Erreur", "error");
    }
  });

  const decide = (requestId: string, decision: "APPROVED" | "REJECTED") => startTransition(async () => {
    const note = prompt(decision === "APPROVED" ? "Commentaire facultatif :" : "Motif du refus (facultatif) :") || undefined;
    try {
      await reviewGiftRequest(requestId, decision, note);
      showToast(decision === "APPROVED" ? "Cadeau autorisé" : "Cadeau refusé", "success");
      router.refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Erreur", "error");
    }
  });

  return <div className="content" style={{ display: "grid", gap: 20 }}>
    <section className="table-card">
      <div className="table-head"><div><div className="table-title">Quotas mensuels</div><div className="table-meta">0 en valeur signifie aucune limite financière supplémentaire.</div></div></div>
      <div className="table-wrap"><table><thead><tr><th>Commercial</th><th>Utilisé</th><th>Valeur offerte</th><th>Quota quantité</th><th>Plafond valeur</th><th></th></tr></thead>
        <tbody>{initialData.usage.map(row => {
          const quota = quotas.get(row.commercial.id)!;
          const percent = quota.quantity > 0 ? Math.min(100, Math.round(row.usage.usedQuantity / quota.quantity * 100)) : 100;
          return <tr key={row.commercial.id}><td><strong>{row.commercial.name}</strong><div className="cell-muted">{row.commercial.email}</div></td>
            <td><strong>{row.usage.usedQuantity} / {quota.quantity}</strong><div style={{ width: 110, height: 5, background: "#EEE", borderRadius: 9, marginTop: 6 }}><div style={{ width: `${percent}%`, height: "100%", borderRadius: 9, background: percent >= 100 ? "#D64545" : percent >= 80 ? "#E79A22" : "#28A66A" }} /></div>{row.usage.pending > 0 && <div className="cell-muted">{row.usage.pending} en attente</div>}</td>
            <td>{row.usage.usedValue.toLocaleString("fr-FR")} F</td>
            <td><input className="field-input" type="number" min="0" value={quota.quantity} onChange={event => setQuotas(previous => new Map(previous).set(row.commercial.id, { ...quota, quantity: Math.max(0, Number(event.target.value)) }))} style={{ width: 100 }} /></td>
            <td><input className="field-input" type="number" min="0" value={quota.value} onChange={event => setQuotas(previous => new Map(previous).set(row.commercial.id, { ...quota, value: Math.max(0, Number(event.target.value)) }))} style={{ width: 130 }} /></td>
            <td><button className="btn-orange" disabled={isPending} onClick={() => saveQuota(row.commercial.id)}>Enregistrer</button></td></tr>;
        })}</tbody></table></div>
    </section>

    <section className="table-card">
      <div className="table-head"><div><div className="table-title">Demandes exceptionnelles</div><div className="table-meta">{initialData.requests.length} demande(s) en attente</div></div></div>
      {initialData.requests.length === 0 ? <div className="empty"><Gift size={32} /><h4>Aucune demande en attente</h4></div> : <div className="table-wrap"><table><thead><tr><th>Commercial</th><th>Commande</th><th>Cadeau</th><th>Motif</th><th>Valeur</th><th>Décision</th></tr></thead><tbody>
        {initialData.requests.map(request => <tr key={request.id}><td><strong>{request.commercialName}</strong></td><td className="cell-mono">{request.orderRef || "—"}</td><td>{request.giftName} × {request.quantity}</td><td style={{ maxWidth: 320 }}>{request.reason}</td><td>{(request.unitValue * request.quantity).toLocaleString("fr-FR")} F</td><td><div style={{ display: "flex", gap: 7 }}><button className="btn-orange" disabled={isPending} onClick={() => decide(request.id, "APPROVED")}><Check size={14} /> Autoriser</button><button className="btn-secondary" disabled={isPending} onClick={() => decide(request.id, "REJECTED")}><X size={14} /> Refuser</button></div></td></tr>)}
      </tbody></table></div>}
    </section>
  </div>;
}
