"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getExchangeRequests, reviewOrderExchange } from "@/modules/orders/actions";
import { useToast } from "@/components/Toast";
import { formatPrice } from "@/lib/constants";
import type { ExchangeRequest } from "../types/exchange";
import "./reprogramming.css";

const labels = { PENDING: "En attente", APPROVED: "Approuvée", REJECTED: "Refusée" };

export default function ExchangeRequestsClient({ initialRequests, canReview }: {
  initialRequests: ExchangeRequest[]; canReview: boolean;
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [filter, setFilter] = useState<"ALL" | ExchangeRequest["status"]>("PENDING");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const { showToast } = useToast();
  const router = useRouter();

  function refresh() {
    startTransition(async () => {
      try { setRequests(await getExchangeRequests()); }
      catch (error) { showToast(error instanceof Error ? error.message : "Erreur de chargement", "error"); }
    });
  }

  function review(request: ExchangeRequest, decision: "APPROVED" | "REJECTED") {
    startTransition(async () => {
      try {
        const result = await reviewOrderExchange(request.id, decision, notes[request.id] || "");
        setRequests(current => current.map(item => item.id === result.id ? result : item));
        showToast(decision === "APPROVED" ? "Échange approuvé et créé" : "Demande refusée", "success");
        router.refresh();
      } catch (error) { showToast(error instanceof Error ? error.message : "Impossible de traiter la demande", "error"); }
    });
  }

  const visible = requests.filter(request => filter === "ALL" || request.status === filter);
  return <div className="content reprogramming-workspace">
    <div className="reprogramming-toolbar">
      <label>Afficher <select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}>
        <option value="PENDING">En attente ({requests.filter(r => r.status === "PENDING").length})</option>
        <option value="APPROVED">Approuvées</option><option value="REJECTED">Refusées</option><option value="ALL">Toutes</option>
      </select></label>
      <button className="btn-secondary" onClick={refresh} disabled={pending}>Actualiser</button>
    </div>
    <p>La commande reste inchangée tant que la demande est en attente. Une demande refusée ne crée aucune commande.</p>
    {visible.length === 0 && <p className="reprogramming-empty">Aucune demande dans cette catégorie.</p>}
    {visible.map(request => <article key={request.id} className="reprogramming-request">
      <header><h3>Commande {request.orderRef}</h3><span className={`reprogramming-status ${request.status.toLowerCase()}`}>{labels[request.status]}</span></header>
      <p>Demandée par <strong>{request.commercialName}</strong> le {new Date(request.createdAt).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" })}</p>
      <dl>
        <div><dt>Parcours</dt><dd>{"Nouvelle commande d’échange"}</dd></div>
        <div><dt>Date demandée</dt><dd>{request.payload.deliveryDate}</dd></div>
        <div><dt>Date actuelle à la demande</dt><dd>{request.originalDeliveryDate ? new Date(request.originalDeliveryDate).toLocaleDateString("fr-FR", { timeZone: "Africa/Abidjan" }) : "Non renseignée"}</dd></div>
        <div><dt>Motif du commercial</dt><dd>{request.payload.exchangeReason}</dd></div>
      </dl>
      {"items" in request.payload && <details>
        <summary>Voir le contenu proposé ({request.payload.items.length} article(s))</summary>
        <p>{request.payload.customerName} · {request.payload.customerPhone}<br />{request.payload.customerLocation} · {request.payload.commune}</p>
        <ul>{request.payload.items.map((item, index) => <li key={index}>{item.qty} × {item.name} ({item.size}, {item.color}) — {formatPrice(item.price)}{item.isGift ? " · Cadeau" : ""}</li>)}</ul>
        <p>Total articles proposé : {formatPrice(request.payload.total ?? request.payload.items.reduce((sum, item) => sum + item.qty * item.price, 0))}<br />Frais : {formatPrice(request.payload.deliveryFee)} · Remise : {formatPrice(request.payload.discount)}</p>
        {request.payload.notes && <p>Notes : {request.payload.notes}</p>}
        {request.payload.paymentMethod && <p>Paiement : {request.payload.paymentMethod} · Expéditeur : {request.payload.depositSenderPhone || "Non renseigné"} · Référence : {request.payload.depositTransactionRef || "Non renseignée"}</p>}
      </details>}
      <Link href={`/zangochap-manager/orders?q=${encodeURIComponent(request.orderRef)}`}>Consulter la commande originale</Link>
      {request.newOrderRef && <p>Nouvelle commande : <Link href={`/zangochap-manager/orders?q=${encodeURIComponent(request.newOrderRef)}`}>{request.newOrderRef}</Link></p>}
      {request.reviewedAt && <p>Décision de {request.reviewedByName} le {new Date(request.reviewedAt).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" })}{request.reviewNote ? ` — ${request.reviewNote}` : ""}</p>}
      {canReview && request.status === "PENDING" && <div className="reprogramming-review">
        <label htmlFor={`review-${request.id}`}>Commentaire administrateur (obligatoire en cas de refus)</label>
        <textarea id={`review-${request.id}`} maxLength={2000} value={notes[request.id] || ""} onChange={event => setNotes(current => ({ ...current, [request.id]: event.target.value }))} disabled={pending} />
        <div><button className="btn-orange" disabled={pending} onClick={() => review(request, "APPROVED")}>Approuver et créer l’échange</button>
          <button className="btn-secondary" disabled={pending || !notes[request.id]?.trim()} onClick={() => review(request, "REJECTED")}>Refuser</button></div>
      </div>}
    </article>)}
  </div>;
}
