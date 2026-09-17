"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getExchangeRequests, reviewOrderExchange } from "@/modules/orders/actions";
import { useToast } from "@/components/Toast";
import { formatPrice } from "@/lib/constants";
import type { ExchangeRequest } from "../types/exchange";
import { ArrowLeftRight, ArrowUpRight, CalendarDays, Check, CheckCircle2, Clock3, Inbox, Package, RefreshCw, Search, ShieldCheck, UserRound, X } from "lucide-react";
import "./exchanges.css";

const labels = { PENDING: "En attente", APPROVED: "Approuvée", REJECTED: "Refusée" };

export default function ExchangeRequestsClient({ initialRequests, canReview }: {
  initialRequests: ExchangeRequest[]; canReview: boolean;
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [filter, setFilter] = useState<"ALL" | ExchangeRequest["status"]>("PENDING");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
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

  const query = search.trim().toLocaleLowerCase("fr");
  const visible = requests.filter(request => (filter === "ALL" || request.status === filter)
    && [request.orderRef, request.commercialName, request.payload.customerName, request.payload.customerPhone, request.payload.exchangeReason].some(value => value.toLocaleLowerCase("fr").includes(query)));
  const date = (value: string, withTime = false) => new Date(value.length === 10 ? `${value}T00:00:00Z` : value).toLocaleString("fr-FR", {
    timeZone: "Africa/Abidjan", day: "2-digit", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
  const tabs = [
    { key: "PENDING", label: "En attente", icon: Clock3 },
    { key: "APPROVED", label: "Approuvées", icon: CheckCircle2 },
    { key: "REJECTED", label: "Refusées", icon: X },
    { key: "ALL", label: "Toutes", icon: ArrowLeftRight },
  ] as const;
  return <div className="content exchange-workspace">
    <div className="exchange-heading"><div><span className="exchange-eyebrow">SUIVI DES ÉCHANGES</span><h1>{canReview ? "Chaque demande, une décision claire." : "Vos demandes d’échange"}</h1><p>{canReview ? "Consultez les propositions des commerciaux et gérez leur validation." : "Retrouvez vos propositions et les réponses de votre administrateur."}</p></div>
      <button className="exchange-button secondary" onClick={refresh} disabled={pending}><RefreshCw size={16} className={pending ? "exchange-spin" : ""} />Actualiser</button>
    </div>
    <div className="exchange-tabs" aria-label="Filtrer les demandes par statut">{tabs.map(tab => <button key={tab.key} aria-pressed={filter === tab.key} onClick={() => setFilter(tab.key)} className={filter === tab.key ? "active" : ""}><tab.icon size={18} /><span>{tab.label}</span><strong>{tab.key === "ALL" ? requests.length : requests.filter(r => r.status === tab.key).length}</strong></button>)}</div>
    <div className="exchange-list-toolbar"><h2>{tabs.find(tab => tab.key === filter)?.label} <span>{visible.length} demande{visible.length > 1 ? "s" : ""}</span></h2><label className="exchange-search"><Search size={17} /><input aria-label="Rechercher une demande d’échange" placeholder="Commande, commercial, client…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
    <div className="exchange-info"><ShieldCheck size={18} /><p>L’original reste inchangé pendant l’attente. Une approbation crée une nouvelle commande d’échange ; un refus ne crée aucune commande.</p></div>
    <div className="exchange-list" aria-busy={pending}>
    {visible.length === 0 && <div className="exchange-empty"><Inbox size={36} /><h3>{query ? "Aucune demande trouvée" : "Aucune demande dans cette catégorie"}</h3><p>{query ? "Essayez une autre recherche ou un autre statut." : "Les demandes correspondantes apparaîtront ici."}</p></div>}
    {visible.map(request => {
      const payload = request.payload;
      const total = payload.total ?? payload.items.reduce((sum, item) => sum + item.qty * item.price, 0);
      return <article key={request.id} className="exchange-card">
        <header className="exchange-card-header"><div className="exchange-reference"><span className="exchange-icon"><ArrowLeftRight size={20} /></span><div><span className="exchange-eyebrow">COMMANDE ORIGINALE</span><h3>{request.orderRef}</h3></div></div><span className={`exchange-status ${request.status.toLowerCase()}`}><span />{labels[request.status]}</span></header>
        <div className="exchange-card-body">
          <div className="exchange-meta"><span><UserRound size={15} /><strong>{request.commercialName}</strong></span><span>Demandée le {date(request.createdAt, true)}</span><Link href={`/zangochap-manager/orders?q=${encodeURIComponent(request.orderRef)}`}>Voir l’original <ArrowUpRight size={14} /></Link></div>
          <div className="exchange-overview"><div className="exchange-reason"><span className="exchange-eyebrow">MOTIF DE L’ÉCHANGE</span><p>{payload.exchangeReason}</p></div><div className="exchange-delivery"><CalendarDays size={19} /><div><span className="exchange-eyebrow">LIVRAISON DEMANDÉE</span><strong>{date(payload.deliveryDate)}</strong><small>À la demande : {request.originalDeliveryDate ? date(request.originalDeliveryDate) : "non renseignée"}</small></div></div></div>
          <details className="exchange-proposal"><summary><span><Package size={17} />Proposition d’échange <span className="exchange-count">{payload.items.length} article{payload.items.length > 1 ? "s" : ""}</span></span><strong>{formatPrice(total)}</strong></summary><div className="exchange-proposal-body">
            <div className="exchange-customer"><strong>{payload.customerName}</strong><span>{payload.customerPhone}</span><span>{payload.customerLocation} · {payload.commune}</span></div>
            <ul className="exchange-items">{payload.items.map((item, index) => <li key={index}><span className="exchange-quantity">{item.qty}×</span><div><strong>{item.name}</strong><small>{item.size} · {item.color}{item.isGift ? " · Cadeau" : ""}</small></div><strong>{formatPrice(item.price * item.qty)}</strong></li>)}</ul>
            <div className="exchange-totals"><span>Articles <strong>{formatPrice(total)}</strong></span><span>Livraison <strong>{formatPrice(payload.deliveryFee)}</strong></span><span>Remise <strong>{formatPrice(payload.discount)}</strong></span></div>
            {payload.notes && <p className="exchange-note"><strong>Notes</strong><br />{payload.notes}</p>}
            {payload.paymentMethod && <p className="exchange-note"><strong>Paiement : {payload.paymentMethod}</strong><br />Payeur : {payload.depositSenderPhone || "Non renseigné"} · Référence : {payload.depositTransactionRef || "Non renseignée"}</p>}
          </div></details>
          {request.newOrderRef && <Link className="exchange-created" href={`/zangochap-manager/orders?q=${encodeURIComponent(request.newOrderRef)}`}><CheckCircle2 size={17} />Échange créé : {request.newOrderRef}<ArrowUpRight size={15} /></Link>}
          {request.reviewedAt && <div className="exchange-decision"><strong>Décision de {request.reviewedByName}</strong><span>{date(request.reviewedAt, true)}</span>{request.reviewNote && <p>{request.reviewNote}</p>}</div>}
        </div>
        {canReview && request.status === "PENDING" && <footer className="exchange-review"><div className="exchange-review-title"><ShieldCheck size={17} /><strong>Votre décision</strong><span>Le commercial sera informé.</span></div><label htmlFor={`review-${request.id}`}>Commentaire <span>— obligatoire pour refuser</span></label><textarea id={`review-${request.id}`} placeholder="Expliquez votre décision au commercial…" maxLength={2000} value={notes[request.id] || ""} onChange={event => setNotes(current => ({ ...current, [request.id]: event.target.value }))} disabled={pending} /><div className="exchange-actions"><small>{!notes[request.id]?.trim() ? "Ajoutez un commentaire pour activer le refus." : "Votre commentaire accompagnera la décision."}</small><div><button className="exchange-button danger" disabled={pending || !notes[request.id]?.trim()} onClick={() => review(request, "REJECTED")}><X size={16} />Refuser</button><button className="exchange-button primary" disabled={pending} onClick={() => review(request, "APPROVED")}><Check size={16} />Approuver et créer l’échange</button></div></div></footer>}
      </article>;
    })}</div>
  </div>;
}
