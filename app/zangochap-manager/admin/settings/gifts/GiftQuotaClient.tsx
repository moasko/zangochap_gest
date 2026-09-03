"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, Gift, X, Plus, Pencil, Search } from "lucide-react";
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

type GiftRow = {
  id: string; name: string; ref: string | null; emoji: string | null;
  stock: number; lowStockThreshold: number; status: string; monthlyQuantity: number;
};
const statusLabels: Record<string, string> = { PUBLISHED: "Publié", DRAFT: "Brouillon", ARCHIVED: "Archivé", OUT_OF_STOCK: "En rupture" };

export default function GiftQuotaClient({ initialData }: { initialData: {
  usage: UsageRow[]; requests: RequestRow[]; gifts: GiftRow[];
  statistics: { month: string; quantity: number; value: number };
} }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [lowStock, setLowStock] = useState(false);
  const [tab, setTab] = useState("catalogue");
  const filtered = initialData.gifts.filter(gift =>
    `${gift.name} ${gift.ref || ""}`.toLocaleLowerCase("fr").includes(search.trim().toLocaleLowerCase("fr")) &&
    (!status || gift.status === status) && (!lowStock || gift.stock <= gift.lowStockThreshold)
  );
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
    const note = prompt(decision === "APPROVED" ? "Commentaire facultatif :" : "Motif du refus (facultatif) :");
    if (note === null) return;
    try {
      await reviewGiftRequest(requestId, decision, note);
      showToast(decision === "APPROVED" ? "Cadeau autorisé" : "Cadeau refusé", "success");
      router.refresh();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Erreur", "error");
    }
  });

  return <div className="content" style={{ display: "grid", gap: 20 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
      <div><h2 style={{ fontSize: 24, fontWeight: 800 }}>Gestion des cadeaux</h2><p className="cell-muted">Catalogue, suivi des cadeaux et autorisations commerciales.</p></div>
      <Link className="btn-orange" href="/zangochap-manager/products/new?gift=1"><Plus size={16} /> Ajouter un cadeau</Link>
    </div>
    <div className="stats-grid" style={{ marginBottom: 0 }}>
      {[
        { label: "Cadeaux au catalogue", value: initialData.gifts.length, detail: `${initialData.gifts.filter(g => g.status === "PUBLISHED").length} publiés` },
        { label: "Unités en stock", value: initialData.gifts.reduce((sum, g) => sum + g.stock, 0), detail: `${initialData.gifts.filter(g => g.stock <= g.lowStockThreshold && g.status !== "ARCHIVED").length} cadeaux à réapprovisionner` },
        { label: "Cadeaux autorisés ce mois", value: initialData.statistics.quantity, detail: initialData.statistics.month },
        { label: "Valeur autorisée ce mois", value: `${initialData.statistics.value.toLocaleString("fr-FR")} F`, detail: "Commandes actives · cadeaux approuvés" },
      ].map(stat => <div className="stat-card" key={stat.label}><div className="stat-label">{stat.label}</div><div className="stat-value">{typeof stat.value === "number" ? stat.value.toLocaleString("fr-FR") : stat.value}</div><div className="cell-muted">{stat.detail}</div></div>)}
    </div>
    <div role="group" aria-label="Sections cadeaux" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {[["catalogue", "Catalogue"], ["quotas", "Quotas mensuels"], ["requests", `Demandes (${initialData.requests.length})`]].map(([id, label]) => <button key={id} className={tab === id ? "btn-orange" : "btn-secondary"} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}
    </div>
    {tab === "catalogue" && <section className="table-card">
      <div className="table-head" style={{ flexWrap: "wrap", gap: 14 }}>
        <div><div className="table-title">Catalogue des cadeaux</div><div className="table-meta">{filtered.length} cadeau(x) affiché(s) sur {initialData.gifts.length}</div></div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}><Search size={16} /><input className="field-input" aria-label="Rechercher un cadeau" placeholder="Nom ou référence…" value={search} onChange={e => setSearch(e.target.value)} /></label>
          <select className="field-input" style={{ width: "auto" }} aria-label="Statut du cadeau" value={status} onChange={e => setStatus(e.target.value)}><option value="">Tous les statuts</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}><input type="checkbox" checked={lowStock} onChange={e => setLowStock(e.target.checked)} /> Stock faible</label>
        </div>
      </div>
      {filtered.length === 0 ? <div className="empty"><Gift size={32} /><h4>{initialData.gifts.length ? "Aucun cadeau ne correspond aux filtres" : "Votre catalogue de cadeaux est vide"}</h4><p>{initialData.gifts.length ? "Modifiez votre recherche ou les filtres." : "Ajoutez votre premier cadeau pour gérer son stock et suivre son utilisation."}</p></div> : <div className="table-wrap"><table><thead><tr><th>Cadeau</th><th>Statut</th><th>Stock</th><th>Autorisés ce mois</th><th>Actions</th></tr></thead><tbody>
        {filtered.map(gift => <tr key={gift.id}><td><strong>{gift.emoji || "🎁"} {gift.name}</strong><div className="cell-muted">{gift.ref || "Sans référence"}</div></td><td>{statusLabels[gift.status] || gift.status}</td><td><strong style={{ color: gift.stock <= gift.lowStockThreshold ? "#B45309" : "inherit" }}>{gift.stock.toLocaleString("fr-FR")}</strong><div className="cell-muted">{gift.stock <= 0 ? "Rupture de stock" : gift.stock <= gift.lowStockThreshold ? "Stock faible" : "Disponible"}</div></td><td>{gift.monthlyQuantity.toLocaleString("fr-FR")}</td><td><Link className="btn-secondary" aria-label={`Modifier ${gift.name}`} href={`/zangochap-manager/products/${gift.id}/edit?gift=1`}><Pencil size={14} /> Modifier</Link></td></tr>)}
      </tbody></table></div>}
      <p className="cell-muted" style={{ padding: "12px 20px" }}>Statistiques du mois : cadeaux approuvés des commandes créées en {initialData.statistics.month}, hors commandes annulées ou supprimées. Les cadeaux personnalisés sont inclus dans les totaux.</p>
    </section>}
    {tab === "quotas" && <>
    <section className="table-card">
      <div className="table-head"><div><div className="table-title">Quotas mensuels</div><div className="table-meta">0 en valeur signifie aucune limite financière supplémentaire.</div></div></div>
      <div className="table-wrap"><table><thead><tr><th>Commercial</th><th>Utilisé</th><th>Valeur offerte</th><th>Quota quantité</th><th>Plafond valeur</th><th></th></tr></thead>
        <tbody>{initialData.usage.length === 0 && <tr><td colSpan={6}>Aucun commercial à configurer.</td></tr>}{initialData.usage.map(row => {
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

    </>}
    {tab === "requests" && <section className="table-card">
      <div className="table-head"><div><div className="table-title">Demandes exceptionnelles</div><div className="table-meta">{initialData.requests.length} demande(s) en attente</div></div></div>
      {initialData.requests.length === 0 ? <div className="empty"><Gift size={32} /><h4>Aucune demande en attente</h4></div> : <div className="table-wrap"><table><thead><tr><th>Commercial</th><th>Commande</th><th>Cadeau</th><th>Motif</th><th>Valeur</th><th>Décision</th></tr></thead><tbody>
        {initialData.requests.map(request => <tr key={request.id}><td><strong>{request.commercialName}</strong></td><td className="cell-mono">{request.orderRef || "—"}</td><td>{request.giftName} × {request.quantity}</td><td style={{ maxWidth: 320 }}>{request.reason}</td><td>{(request.unitValue * request.quantity).toLocaleString("fr-FR")} F</td><td><div style={{ display: "flex", gap: 7 }}><button className="btn-orange" disabled={isPending} onClick={() => decide(request.id, "APPROVED")}><Check size={14} /> Autoriser</button><button className="btn-secondary" disabled={isPending} onClick={() => decide(request.id, "REJECTED")}><X size={14} /> Refuser</button></div></td></tr>)}
      </tbody></table></div>}
    </section>}
  </div>;
}
