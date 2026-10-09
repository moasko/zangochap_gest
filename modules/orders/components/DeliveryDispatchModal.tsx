"use client";

import React, { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Check, RefreshCw, Users, Zap } from "lucide-react";
import Modal from "@/components/Modal";
import { formatPrice } from "@/lib/constants";
import { applyDeliveryDispatchPlan, getDeliveryDispatchPlan } from "@/modules/orders/actions";
import { reloadOnStaleServerAction } from "@/lib/stale-server-action";
import "./delivery-dispatch.css";

type DispatchPlan = Awaited<ReturnType<typeof getDeliveryDispatchPlan>>;
type DispatchApplyResult = Awaited<ReturnType<typeof applyDeliveryDispatchPlan>>;

/** Actions remplacables pour l'apercu local fictif ; par defaut les Server Actions. */
export type DispatchActions = {
  getPlan: typeof getDeliveryDispatchPlan;
  applyPlan: typeof applyDeliveryDispatchPlan;
};

interface DeliveryDispatchModalProps {
  date: string;
  // Restreint la repartition aux commandes affichees (filtres de l'ecran).
  orderIds?: string[];
  onClose: () => void;
  onApplied: (assignedCount: number) => void;
  // Ouvre le controle de la repartition (correction d'un mauvais partage).
  onOpenAudit?: () => void;
  actions?: Partial<DispatchActions>;
}

const REASON_LABELS: Record<string, string> = {
  repro: "meme livreur (repro)",
  fixed: "commune affectee (alternance)",
  zone: "livreur habituel de la commune (alternance)",
};

export default function DeliveryDispatchModal({ date, orderIds, onClose, onApplied, onOpenAudit, actions }: DeliveryDispatchModalProps) {
  const getPlan = actions?.getPlan ?? getDeliveryDispatchPlan;
  const applyPlan = actions?.applyPlan ?? applyDeliveryDispatchPlan;
  const [plan, setPlan] = useState<DispatchPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<number | null>(null);
  const [presentIds, setPresentIds] = useState<string[] | null>(null);
  // Colis confirmes / en preparation inclus par defaut (attribues d'avance, visibles du livreur une fois emballes).
  const [includeUnpacked, setIncludeUnpacked] = useState(true);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  // Selection de colis a deplacer avant validation.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState("");
  const [result, setResult] = useState<DispatchApplyResult | null>(null);
  const [showAllRiders, setShowAllRiders] = useState(false);
  const [isLoading, startLoading] = useTransition();
  const [isApplying, startApplying] = useTransition();

  const load = useCallback((options: { capacity?: number | null; presentIds?: string[] | null; includeUnpacked: boolean }) => {
    setError(null);
    startLoading(async () => {
      try {
        const next = await getPlan({
          date,
          orderIds,
          capacity: options.capacity ?? undefined,
          presentRiderIds: options.presentIds ?? undefined,
          includeUnpacked: options.includeUnpacked,
        });
        setPlan(next);
        setCapacity(next.capacity);
        setIncludeUnpacked(next.includeUnpacked);
        setPresentIds(next.riders.filter((rider) => rider.present).map((rider) => rider.id));
        setOverrides({});
        setPicked(new Set());
      } catch (e: unknown) {
        if (reloadOnStaleServerAction(e)) return;
        setError(e instanceof Error ? e.message : "Erreur de calcul");
      }
    });
  }, [date, orderIds, getPlan]);

  useEffect(() => {
    load({ includeUnpacked: true });
  }, [load]);

  const riderById = useMemo(() => new Map((plan?.riders || []).map((rider) => [rider.id, rider])), [plan]);
  const presentRiders = useMemo(
    () => (plan?.riders || []).filter((rider) => presentIds?.includes(rider.id)),
    [plan, presentIds],
  );

  const finalAssignments = useMemo(
    () => (plan?.assignments || []).map((item) => ({ ...item, riderId: overrides[item.id] || item.riderId })),
    [plan, overrides],
  );

  const groups = useMemo(() => {
    const byRider = new Map<string, typeof finalAssignments>();
    for (const item of finalAssignments) {
      if (!byRider.has(item.riderId)) byRider.set(item.riderId, []);
      byRider.get(item.riderId)!.push(item);
    }
    return [...byRider.entries()]
      .map(([riderId, orders]) => ({ rider: riderById.get(riderId), orders }))
      .filter((group) => group.rider)
      .sort((a, b) => b.orders.length - a.orders.length || a.rider!.name.localeCompare(b.rider!.name));
  }, [finalAssignments, riderById]);

  const skippedByReason = useMemo(() => {
    const byReason = new Map<string, NonNullable<DispatchPlan>["skipped"]>();
    for (const item of plan?.skipped || []) {
      if (!byReason.has(item.reason)) byReason.set(item.reason, []);
      byReason.get(item.reason)!.push(item);
    }
    return [...byReason.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [plan]);

  const unpackedCount = finalAssignments.filter((item) => item.status === "CONFIRMED" || item.status === "PREPARING").length;

  const planIsStale = Boolean(plan) && (
    capacity !== plan!.capacity
    || includeUnpacked !== plan!.includeUnpacked
    || JSON.stringify([...(presentIds || [])].sort()) !== JSON.stringify(plan!.riders.filter((r) => r.present).map((r) => r.id).sort())
  );

  const togglePresent = (riderId: string) => {
    setPresentIds((current) => {
      const list = current || [];
      return list.includes(riderId) ? list.filter((id) => id !== riderId) : [...list, riderId];
    });
  };

  const apply = () => {
    if (!plan || finalAssignments.length === 0 || planIsStale) return;
    startApplying(async () => {
      try {
        const applied = await applyPlan(
          finalAssignments.map((item) => ({ orderId: item.id, riderId: item.riderId, version: item.version })),
          { includeUnpacked: plan.includeUnpacked },
        );
        setResult(applied);
        onApplied(applied.assignedCount);
      } catch (e: unknown) {
        if (reloadOnStaleServerAction(e)) return;
        setError(e instanceof Error ? e.message : "Erreur d'application");
      }
    });
  };

  const busy = isLoading || isApplying;

  const togglePicked = (ids: string[], on: boolean) => setPicked((current) => {
    const next = new Set(current);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    return next;
  });
  const movePicked = () => {
    if (!moveTarget || picked.size === 0) return;
    setOverrides((current) => {
      const next = { ...current };
      picked.forEach((id) => { next[id] = moveTarget; });
      return next;
    });
    setPicked(new Set());
    setMoveTarget("");
  };
  const visibleRiders = (plan?.riders || [])
    .filter((rider) => showAllRiders || rider.activeRecently || presentIds?.includes(rider.id))
    .sort((a, b) => Number(b.activeRecently) - Number(a.activeRecently) || b.recentCount - a.recentCount);
  const hiddenRiderCount = (plan?.riders.length || 0) - visibleRiders.length;

  return (
    <Modal
      isOpen
      xl
      onClose={busy ? () => undefined : onClose}
      title={`Repartition automatique du ${date.split("-").reverse().join("/")}`}
      footer={result ? (
        <>
          {onOpenAudit && <button className="btn-secondary" onClick={onOpenAudit}>Controler la repartition</button>}
          <button className="btn-orange" onClick={onClose}>Fermer</button>
        </>
      ) : (
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Annuler</button>
          <button
            className="btn-orange"
            onClick={apply}
            disabled={busy || !plan || finalAssignments.length === 0 || planIsStale}
            title={planIsStale ? "Recalculez apres avoir modifie les parametres" : undefined}
          >
            <Zap size={14} /> {isApplying ? "Attribution..." : `Attribuer ${finalAssignments.length} commande(s)`}
          </button>
        </>
      )}
    >
      <div className="dispatch">
        {error && <div className="dispatch-alert"><AlertTriangle size={14} /> {error}</div>}

        {result ? (
          <div className="dispatch-result">
            <p><Check size={16} /> <strong>{result.assignedCount}</strong> commande(s) attribuee(s).</p>
            {result.skipped.length > 0 && (
              <>
                <p className="dispatch-muted">{result.skipped.length} commande(s) non attribuee(s) au moment de l&apos;ecriture :</p>
                <ul className="dispatch-skip-list">
                  {result.skipped.map((item) => <li key={item.orderId}><strong>{item.ref}</strong> — {item.reason}</li>)}
                </ul>
              </>
            )}
          </div>
        ) : !plan ? (
          <p className="dispatch-muted">{isLoading ? "Calcul de la repartition..." : "Aucune proposition."}</p>
        ) : (
          <>
            <div className="auto-preview-head dispatch-head">
              <div><span className="summary-label">A attribuer</span><strong>{finalAssignments.length}</strong></div>
              <div><span className="summary-label">Livreurs presents</span><strong>{presentRiders.length}</strong></div>
              <div><span className="summary-label">Non reparties</span><strong>{plan.skipped.length}</strong></div>
              <div><span className="summary-label">Dont non emballes</span><strong>{unpackedCount}</strong></div>
            </div>

            <section className="dispatch-settings">
              <div className="dispatch-settings-row">
                <h4>
                  <Users size={14} /> Livreurs presents
                  <Link href="/zangochap-manager/admin/delivery/planning" className="dispatch-planning-link">Modifier le planning</Link>
                </h4>
                <label className="dispatch-capacity">
                  Plafond / livreur
                  <input
                    type="number"
                    min={1}
                    max={60}
                    className="field-input"
                    placeholder="Aucun"
                    value={capacity ?? ""}
                    onChange={(event) => setCapacity(Number(event.target.value) || null)}
                  />
                </label>
                <label className="dispatch-unpacked" title="Colis confirmes ou en preparation : attribues d'avance, le livreur les voit une fois emballes">
                  <input
                    type="checkbox"
                    checked={includeUnpacked}
                    onChange={(event) => setIncludeUnpacked(event.target.checked)}
                  />
                  Inclure les colis non emballes
                </label>
                <button
                  className={planIsStale ? "btn-orange" : "btn-secondary"}
                  onClick={() => load({ capacity, presentIds, includeUnpacked })}
                  disabled={busy || !presentIds?.length}
                >
                  <RefreshCw size={14} /> Recalculer
                </button>
              </div>
              <div className="dispatch-riders">
                {visibleRiders.map((rider) => {
                  const present = presentIds?.includes(rider.id) || false;
                  return (
                    <button
                      key={rider.id}
                      type="button"
                      className={`dispatch-rider${present ? " is-present" : ""}`}
                      onClick={() => togglePresent(rider.id)}
                      aria-pressed={present}
                      title={[
                        rider.presenceReason,
                        rider.fixedCommunes.length ? `Communes affectees : ${rider.fixedCommunes.join(", ")}` : "",
                        rider.capacity ? `Plafond : ${rider.capacity}` : "",
                        rider.zones.map((zone) => `${zone.commune} ${zone.pct}%`).join(", ") || "Pas d'historique recent",
                      ].filter(Boolean).join(" · ")}
                    >
                      <span>{rider.name}</span>
                      <small>
                        {rider.fromPlanning && !rider.present ? `${rider.presenceReason} · ` : ""}
                        {rider.fixedCommunes[0] || rider.zones[0]?.commune || ""}{(rider.fixedCommunes[0] || rider.zones[0]) ? " · " : ""}
                        {rider.recentCount} colis/30j
                      </small>
                    </button>
                  );
                })}
                {hiddenRiderCount > 0 && (
                  <button type="button" className="dispatch-rider is-more" onClick={() => setShowAllRiders(true)}>
                    +{hiddenRiderCount} inactifs
                  </button>
                )}
              </div>
              {planIsStale && <p className="dispatch-hint">Parametres modifies : cliquez sur Recalculer avant d&apos;attribuer.</p>}
            </section>

            {picked.size > 0 && (
              <div className="dispatch-movebar">
                <strong>{picked.size} colis selectionne(s)</strong>
                <select className="field-input" value={moveTarget} onChange={(event) => setMoveTarget(event.target.value)} aria-label="Livreur de destination">
                  <option value="">Deplacer vers...</option>
                  {presentRiders.map((rider) => <option key={rider.id} value={rider.id}>{rider.name}</option>)}
                </select>
                <button type="button" className="btn-orange" onClick={movePicked} disabled={!moveTarget}>Deplacer</button>
                <button type="button" className="btn-secondary" onClick={() => setPicked(new Set())}>Annuler</button>
              </div>
            )}

            <div className="auto-preview-list">
              {groups.map(({ rider, orders }) => {
                const communes = Array.from(new Set(orders.map((order) => order.commune)));
                const cash = orders.reduce((sum, order) => sum + order.amount, 0);
                return (
                  <div key={rider!.id} className="auto-preview-group">
                    <div className="auto-preview-driver">
                      <div className="driver-avatar-small">{rider!.name.charAt(0)}</div>
                      <div>
                        <h4>{rider!.name}</h4>
                        <p>{rider!.before} deja attribue(s), {rider!.before + orders.length} apres · {formatPrice(cash)} a encaisser</p>
                      </div>
                      <strong>+{orders.length}</strong>
                    </div>
                    <div className="auto-preview-communes">
                      {communes.map((commune) => <span key={commune}>{commune}</span>)}
                    </div>
                    <details className="dispatch-orders">
                      <summary>Voir / deplacer les colis</summary>
                      <label className="dispatch-pick-all">
                        <input
                          type="checkbox"
                          checked={orders.every((order) => picked.has(order.id))}
                          onChange={(event) => togglePicked(orders.map((order) => order.id), event.target.checked)}
                        />
                        Tout selectionner ({orders.length})
                      </label>
                      {orders.map((order) => (
                        <div key={order.id} className={`dispatch-order${picked.has(order.id) ? " is-picked" : ""}`}>
                          <label className="dispatch-ref">
                            <input
                              type="checkbox"
                              checked={picked.has(order.id)}
                              onChange={(event) => togglePicked([order.id], event.target.checked)}
                              aria-label={`Selectionner ${order.ref}`}
                            />
                            {order.ref}
                          </label>
                          <span className="dispatch-order-meta">
                            {order.commune} · {order.customerName} · {REASON_LABELS[order.reason] || order.reason}
                            {order.previousRiderName && order.previousRiderName !== rider!.name ? ` · avant : ${order.previousRiderName}` : ""}
                            {order.missingAddress ? " · sans adresse" : ""}
                            {order.status === "CONFIRMED" || order.status === "PREPARING" ? " · pas encore emballe" : ""}
                          </span>
                          <select
                            className="field-input dispatch-move"
                            value={order.riderId}
                            onChange={(event) => setOverrides((current) => ({ ...current, [order.id]: event.target.value }))}
                            aria-label={`Livreur pour ${order.ref}`}
                          >
                            {presentRiders.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                          </select>
                        </div>
                      ))}
                    </details>
                  </div>
                );
              })}
              {groups.length === 0 && <p className="dispatch-muted">Aucune commande a attribuer pour cette date.</p>}
            </div>

            {skippedByReason.length > 0 && (
              <details className="dispatch-skipped">
                <summary><AlertTriangle size={14} /> {plan.skipped.length} commande(s) non reparties — a traiter a la main</summary>
                {skippedByReason.map(([reason, items]) => (
                  <div key={reason} className="dispatch-skip-group">
                    <strong>{reason} ({items.length})</strong>
                    <div className="auto-preview-orders">
                      {items.slice(0, 30).map((item) => <span key={item.id} title={item.customerName}>{item.ref}</span>)}
                      {items.length > 30 && <span>+{items.length - 30}</span>}
                    </div>
                  </div>
                ))}
              </details>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
