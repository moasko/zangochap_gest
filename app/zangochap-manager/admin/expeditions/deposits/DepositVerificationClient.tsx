"use client";
import { useState, useTransition } from "react";
import { CalendarDays, RefreshCw, Search } from "lucide-react";
import { getDepositAdminData, reviewExpeditionDeposit } from "@/modules/expedition-deposits/actions";
import { useToast } from "@/components/Toast";
import "./deposits.css";

type DepositOrder = { id: string; ref: string | null; customerName: string; customerPhone: string; total: number; deliveryFee: number; discount: number; paymentMethod: string | null; depositSenderPhone: string | null; depositTransactionRef: string | null; depositVerificationStatus: string | null; depositVerificationNote: string | null; depositVerifiedAt: string | null; depositVerifiedByName: string | null; commercialName: string | null; createdAt: string; status: string };
const labels: Record<string, string> = { PENDING: "À vérifier", RECEIVED: "Reçu", NOT_RECEIVED: "Non reçu", CORRECTION_REQUIRED: "À corriger" };
const day = (v: string) => new Date(v).toLocaleDateString("en-CA", { timeZone: "Africa/Abidjan" });
const dateLabel = (v: string) => new Date(`${v}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Abidjan" });
const amount = (o: DepositOrder) => Math.max(0, Number(o.total) + Number(o.deliveryFee || 0) - Number(o.discount || 0));
const money = (n: number) => `${n.toLocaleString("fr-FR")} F CFA`;
const sum = (list: DepositOrder[]) => list.reduce((n, o) => n + amount(o), 0);

export default function DepositVerificationClient({ initialOrders }: { initialOrders: DepositOrder[] }) {
  const [orders, setOrders] = useState(initialOrders);
  const [filter, setFilter] = useState("PENDING");
  const [search, setSearch] = useState("");
  const [commercial, setCommercial] = useState("");
  const [payment, setPayment] = useState("");
  const [dateType, setDateType] = useState("created");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const [page, setPage] = useState(1);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();
  const today = day(new Date().toISOString());
  const active = orders.filter(o => o.status !== "CANCELLED");
  const receivedToday = active.filter(o => o.depositVerificationStatus === "RECEIVED" && o.depositVerifiedAt && day(o.depositVerifiedAt) === today);
  const pending = active.filter(o => o.depositVerificationStatus === "PENDING");
  const issues = active.filter(o => ["NOT_RECEIVED", "CORRECTION_REQUIRED"].includes(o.depositVerificationStatus || ""));
  const invalidDates = Boolean(from && to && from > to);
  const orderDay = (o: DepositOrder) => dateType === "verified" ? (o.depositVerifiedAt ? day(o.depositVerifiedAt) : "") : day(o.createdAt);
  const base = orders.filter(o => {
    const d = orderDay(o);
    return !invalidDates && (includeCancelled || o.status !== "CANCELLED")
      && (!commercial || (o.commercialName || "Non attribué") === commercial)
      && (!payment || (o.paymentMethod || "Non renseigné") === payment)
      && (!from || d >= from) && (!to || (Boolean(d) && d <= to))
      && [o.ref, o.customerName, o.customerPhone, o.depositSenderPhone, o.depositTransactionRef, o.commercialName].some(v => String(v || "").toLowerCase().includes(search.trim().toLowerCase()));
  });
  const visible = base.filter(o => !filter || o.depositVerificationStatus === filter).sort((a, b) => orderDay(b).localeCompare(orderDay(a)) || b.createdAt.localeCompare(a.createdAt));
  const pages = Math.max(1, Math.ceil(visible.length / 20));
  const currentPage = Math.min(page, pages);
  const groups = new Map<string, DepositOrder[]>();
  const dailyTotals = new Map<string, { count: number; amount: number }>();
  for (const o of visible) {
    const key = orderDay(o);
    const totals = dailyTotals.get(key) || { count: 0, amount: 0 };
    dailyTotals.set(key, { count: totals.count + 1, amount: totals.amount + amount(o) });
  }
  for (const o of visible.slice((currentPage - 1) * 20, currentPage * 20)) { const d = orderDay(o); groups.set(d, [...(groups.get(d) || []), o]); }
  const reset = () => { setSearch(""); setCommercial(""); setPayment(""); setFrom(""); setTo(""); setDateType("created"); setFilter("PENDING"); setIncludeCancelled(false); setPage(1); };
  const quick = (offset: number | null) => { const d = offset === null ? "" : day(new Date(Date.now() + offset * 86400000).toISOString()); setFrom(d); setTo(d); setPage(1); };
  const reload = async () => { const data = await getDepositAdminData(); setOrders(JSON.parse(JSON.stringify(data)) as DepositOrder[]); };
  const refresh = () => startTransition(async () => { try { await reload(); } catch { showToast("Actualisation impossible. Les données affichées sont conservées.", "error"); } });
  const decide = (order: DepositOrder, status: string) => {
    const note = (notes[order.id] || "").trim();
    if (status !== "RECEIVED" && !note) { showToast("Indiquez un motif pour le commercial.", "error"); document.getElementById(`note-${order.id}`)?.focus(); return; }
    if (status === "RECEIVED" && !window.confirm(`Confirmer le dépôt de ${order.ref || order.customerName} ? Vérifiez le numéro et la transaction avant de valider.`)) return;
    startTransition(async () => {
      try {
        await reviewExpeditionDeposit(order.id, status, note);
        setOrders(list => list.map(o => o.id === order.id ? { ...o, depositVerificationStatus: status, depositVerificationNote: note || null, depositVerifiedAt: new Date().toISOString() } : o));
        setNotes(current => { const next = { ...current }; delete next[order.id]; return next; });
        showToast(status === "RECEIVED" ? "Dépôt confirmé" : "Alerte envoyée au commercial", "success");
        try { await reload(); } catch { showToast("Décision enregistrée. Actualisez pour récupérer les détails à jour.", "default"); }
      } catch (error) { showToast(error instanceof Error ? error.message : "Action impossible", "error"); }
    });
  };
  return <div className="content deposits-page">
    <header className="dep-heading"><div><h2>Suivi des dépôts</h2><p>Contrôlez les paiements avant l’expédition hors Abidjan.</p></div><button onClick={refresh} disabled={isPending}><RefreshCw size={15} className={isPending ? "animate-spin" : ""} /> Actualiser</button></header>
    <div className="dep-stats">
      <section><span>Reçus aujourd’hui</span><strong>{receivedToday.length} dépôt(s)</strong><small>{money(sum(receivedToday))} de commandes associées</small></section>
      <section><span>Créés aujourd’hui</span><strong>{active.filter(o => day(o.createdAt) === today).length} dossier(s)</strong><small>{dateLabel(today)} · heure d’Abidjan</small></section>
      <section><span>À vérifier · toutes dates</span><strong>{pending.length} dépôt(s)</strong><small>{money(sum(pending))} de commandes associées</small></section>
      <section><span>Non reçus / à corriger</span><strong>{issues.length} dossier(s)</strong><small>Toutes dates · commandes annulées exclues</small></section>
    </div>
    <p className="dep-explanation">Les indicateurs ci-dessus sont indépendants des filtres. Les montants correspondent aux commandes (articles + livraison − remise), pas à un montant déposé saisi. « Reçus aujourd’hui » utilise la date de validation.</p>
    <section className="dep-filters" aria-label="Filtres des dépôts" onChange={() => setPage(1)}>
      <label className="dep-search"><Search size={16} /><input aria-label="Rechercher un dépôt" placeholder="Commande, client, numéro, transaction…" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <label>Commercial<select value={commercial} onChange={e => setCommercial(e.target.value)}><option value="">Tous</option>{[...new Set(orders.map(o => o.commercialName || "Non attribué"))].sort().map(v => <option key={v}>{v}</option>)}</select></label>
      <label>Paiement<select value={payment} onChange={e => setPayment(e.target.value)}><option value="">Tous</option>{[...new Set(orders.map(o => o.paymentMethod || "Non renseigné"))].sort().map(v => <option key={v}>{v}</option>)}</select></label>
      <label>Date de<select value={dateType} onChange={e => setDateType(e.target.value)}><option value="created">Création</option><option value="verified">Vérification</option></select></label>
      <label>Du<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Au<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      <div className="dep-shortcuts"><button onClick={() => quick(0)}>Aujourd’hui</button><button onClick={() => quick(-1)}>Hier</button><button onClick={() => quick(null)}>Toutes dates</button><button onClick={reset}>Réinitialiser</button></div>
      <label className="dep-check"><input type="checkbox" checked={includeCancelled} onChange={e => setIncludeCancelled(e.target.checked)} /> Inclure les commandes annulées</label>
      {invalidDates && <p role="alert" className="dep-error">La date de début doit précéder la date de fin.</p>}
    </section>
    <nav className="dep-tabs" aria-label="État du dépôt">{[["", "Tous"], ...Object.entries(labels)].map(([v, label]) => <button key={v} aria-pressed={filter === v} onClick={() => { setFilter(v); setPage(1); }}>{label} <b>{base.filter(o => !v || o.depositVerificationStatus === v).length}</b></button>)}</nav>
    <div className="dep-results" aria-live="polite"><strong>{visible.length} dépôt(s)</strong><span>Montant des commandes filtrées : {money(sum(visible))}</span></div>
    {visible.length === 0 ? <div className="dep-empty"><Search size={28} /><h3>Aucun dépôt pour ces filtres</h3><p>Essayez une autre période ou un autre état.</p><button onClick={reset}>Réinitialiser</button></div> : [...groups].map(([date, entries]) => <section key={date} className="dep-day"><h3><CalendarDays size={16} /> {date ? dateLabel(date) : "Pas encore vérifiés"}<small>{dailyTotals.get(date)?.count} dépôt(s) · {money(dailyTotals.get(date)?.amount || 0)} de commandes · {entries.length} affiché(s)</small></h3><div className="dep-orders">{entries.map(order => <article key={order.id} className="dep-order">
      <header><div><strong>{order.ref || "Sans référence"}</strong><p>{order.customerName} · {order.customerPhone}</p></div><span className={`dep-badge dep-${order.depositVerificationStatus}`}>{labels[order.depositVerificationStatus || ""] || "Non renseigné"}</span></header>
      {order.status === "CANCELLED" && <p className="dep-error">Commande annulée — consultation uniquement</p>}
      <dl><div><dt>Paiement</dt><dd>{order.paymentMethod || "—"}</dd></div><div><dt>Numéro du déposant</dt><dd>{order.depositSenderPhone || "Non renseigné"}</dd></div><div><dt>Transaction</dt><dd>{order.depositTransactionRef || "Non renseignée"}</dd></div><div><dt>Montant commande</dt><dd>{money(amount(order))}</dd></div></dl>
      <p className="dep-meta">Commercial : <strong>{order.commercialName || "Non attribué"}</strong> · Créée le {dateLabel(day(order.createdAt))}</p>
      {order.depositVerifiedAt && <p className="dep-meta">Vérifié le {new Date(order.depositVerifiedAt).toLocaleString("fr-FR", { timeZone: "Africa/Abidjan" })}{order.depositVerifiedByName ? ` par ${order.depositVerifiedByName}` : ""}</p>}
      {order.depositVerificationNote && <p className="dep-note"><strong>Dernier motif :</strong> {order.depositVerificationNote}</p>}
      {order.depositVerificationStatus !== "RECEIVED" && order.status !== "CANCELLED" && <div className="dep-review"><label htmlFor={`note-${order.id}`}>Motif obligatoire si non reçu ou à corriger</label><textarea id={`note-${order.id}`} value={notes[order.id] || ""} onChange={e => setNotes(current => ({ ...current, [order.id]: e.target.value }))} placeholder="Précisez ce que le commercial doit vérifier…" /><div className="dep-actions"><button className="dep-received" disabled={isPending} onClick={() => decide(order, "RECEIVED")}>Dépôt reçu</button><button className="dep-rejected" disabled={isPending} onClick={() => decide(order, "NOT_RECEIVED")}>Non reçu</button><button disabled={isPending} onClick={() => decide(order, "CORRECTION_REQUIRED")}>À corriger</button></div></div>}
    </article>)}</div></section>)}
    {visible.length > 20 && <nav className="dep-pagination" aria-label="Pagination"><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Précédent</button><span>Page {currentPage} / {pages}</span><button disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Suivant</button></nav>}
  </div>;
}
