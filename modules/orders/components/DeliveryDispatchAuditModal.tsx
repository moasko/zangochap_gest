"use client";

import React, { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Check, RefreshCw, ShieldCheck } from "lucide-react";
import Modal from "@/components/Modal";
import { applyDeliveryDispatchCorrections, getDeliveryDispatchAudit } from "@/modules/orders/actions";
import { reloadOnStaleServerAction } from "@/lib/stale-server-action";
import "./delivery-dispatch.css";

type DispatchAudit = Awaited<ReturnType<typeof getDeliveryDispatchAudit>>;
type CorrectionResult = Awaited<ReturnType<typeof applyDeliveryDispatchCorrections>>;
type Correction = DispatchAudit["corrections"][number];

/** Actions remplacables pour l'apercu local fictif ; par defaut les Server Actions. */
export type DispatchAuditActions = {
  getAudit: typeof getDeliveryDispatchAudit;
  applyCorrections: typeof applyDeliveryDispatchCorrections;
};

interface DeliveryDispatchAuditModalProps {
  date: string;
  onClose: () => void;
  onApplied: (correctedCount: number) => void;
  actions?: Partial<DispatchAuditActions>;
}

const PROBLEMS: { key: Correction["problem"]; title: string; hint: string }[] = [
  { key: "absent", title: "Livreur absent", hint: "Le livreur n'est pas present ce jour d'apres le planning." },
  { key: "hors_zone", title: "Hors zone", hint: "Le colis est chez un livreur qui ne livre pas cette commune." },
  { key: "plafond", title: "Au-dessus du plafond", hint: "Le livreur a plus de colis que son plafond." },
  { key: "alternance", title: "Alternance desequilibree", hint: "Dans la commune, un livreur a 2 colis ou plus que l'autre." },
];

// Valeur du select pour « retirer le livreur » (colis remis sans livreur).
const UNASSIGN = "__unassign__";

export default function DeliveryDispatchAuditModal({ date, onClose, onApplied, actions }: DeliveryDispatchAuditModalProps) {
  const getAudit = actions?.getAudit ?? getDeliveryDispatchAudit;
  const applyCorrections = actions?.applyCorrections ?? applyDeliveryDispatchCorrections;
  const [audit, setAudit] = useState<DispatchAudit | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Cible choisie par colis ("" = pas de cible proposee) et colis coches.
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<CorrectionResult | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isApplying, startApplying] = useTransition();

  const load = useCallback(() => {
    setError(null);
    startLoading(async () => {
      try {
        const next = await getAudit({ date });
        setAudit(next);
        setTargets(Object.fromEntries(next.corrections.map((item) => [item.orderId, item.toRiderId || ""])));
        // Coche par defaut uniquement quand un livreur de la zone est propose.
        setPicked(new Set(next.corrections.filter((item) => item.toRiderId).map((item) => item.orderId)));
      } catch (e: unknown) {
        if (reloadOnStaleServerAction(e)) return;
        setError(e instanceof Error ? e.message : "Erreur de controle");
      }
    });
  }, [date, getAudit]);

  useEffect(() => {
    load();
  }, [load]);

  const riderName = useMemo(() => new Map((audit?.riders || []).map((rider) => [rider.id, rider.name])), [audit]);
  const presentRiders = useMemo(() => (audit?.riders || []).filter((rider) => rider.present), [audit]);
  const sections = useMemo(() => PROBLEMS
    .map((problem) => ({ ...problem, items: (audit?.corrections || []).filter((item) => item.problem === problem.key) }))
    .filter((section) => section.items.length > 0), [audit]);

  const ready = (audit?.corrections || []).filter((item) => picked.has(item.orderId) && targets[item.orderId]);

  const togglePicked = (ids: string[], on: boolean) => setPicked((current) => {
    const next = new Set(current);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    return next;
  });

  const apply = () => {
    if (ready.length === 0) return;
    startApplying(async () => {
      try {
        const applied = await applyCorrections(ready.map((item) => ({
          orderId: item.orderId,
          fromRiderId: item.fromRiderId,
          toRiderId: targets[item.orderId] === UNASSIGN ? null : targets[item.orderId],
          version: item.version,
        })));
        setResult(applied);
        onApplied(applied.correctedCount);
      } catch (e: unknown) {
        if (reloadOnStaleServerAction(e)) return;
        setError(e instanceof Error ? e.message : "Erreur de correction");
      }
    });
  };

  const busy = isLoading || isApplying;

  return (
    <Modal
      isOpen
      xl
      onClose={busy ? () => undefined : onClose}
      title={`Controle de la repartition du ${date.split("-").reverse().join("/")}`}
      footer={result ? (
        <>
          <button className="btn-secondary" onClick={() => { setResult(null); load(); }}>Controler a nouveau</button>
          <button className="btn-orange" onClick={onClose}>Fermer</button>
        </>
      ) : (
        <>
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Fermer</button>
          <button className="btn-orange" onClick={apply} disabled={busy || ready.length === 0}>
            <Check size={14} /> {isApplying ? "Correction..." : `Corriger ${ready.length} colis`}
          </button>
        </>
      )}
    >
      <div className="dispatch">
        {error && <div className="dispatch-alert"><AlertTriangle size={14} /> {error}</div>}

        {result ? (
          <div className="dispatch-result">
            <p><Check size={16} /> <strong>{result.correctedCount}</strong> colis corrige(s).</p>
            {result.skipped.length > 0 && (
              <>
                <p className="dispatch-muted">{result.skipped.length} colis non corrige(s) :</p>
                <ul className="dispatch-skip-list">
                  {result.skipped.map((item) => <li key={item.orderId}><strong>{item.ref}</strong> — {item.reason}</li>)}
                </ul>
              </>
            )}
          </div>
        ) : !audit ? (
          <p className="dispatch-muted">{isLoading ? "Controle en cours..." : "Aucun resultat."}</p>
        ) : (
          <>
            <div className="auto-preview-head dispatch-head">
              <div><span className="summary-label">Colis controles</span><strong>{audit.checkedCount}</strong></div>
              <div><span className="summary-label">A corriger</span><strong>{audit.corrections.length}</strong></div>
              <div><span className="summary-label">Selectionnes</span><strong>{ready.length}</strong></div>
              <div><span className="summary-label">Livreurs presents</span><strong>{presentRiders.length}</strong></div>
            </div>

            <div className="dispatch-settings-row audit-toolbar">
              <p className="dispatch-muted">
                Meme regle que la repartition : livreurs de la commune (planning, sinon habituels), en alternance.
                A faire de preference avant le depart des livreurs.
              </p>
              <Link href="/zangochap-manager/admin/delivery/planning" className="dispatch-planning-link">Modifier le planning</Link>
              <button className="btn-secondary" onClick={load} disabled={busy}><RefreshCw size={14} /> Actualiser</button>
            </div>

            {sections.length === 0 && (
              <div className="audit-ok"><ShieldCheck size={18} /> Repartition conforme : aucun colis a corriger.</div>
            )}

            {sections.map((section) => (
              <section key={section.key} className={`audit-section is-${section.key}`}>
                <div className="audit-section-head">
                  <label className="dispatch-pick-all">
                    <input
                      type="checkbox"
                      checked={section.items.every((item) => picked.has(item.orderId))}
                      onChange={(event) => togglePicked(section.items.map((item) => item.orderId), event.target.checked)}
                    />
                    <strong>{section.title} ({section.items.length})</strong>
                  </label>
                  <span className="dispatch-muted">{section.hint}</span>
                </div>
                {section.items.map((item) => (
                  <div key={item.orderId} className={`dispatch-order audit-order${picked.has(item.orderId) ? " is-picked" : ""}`}>
                    <label className="dispatch-ref">
                      <input
                        type="checkbox"
                        checked={picked.has(item.orderId)}
                        onChange={(event) => togglePicked([item.orderId], event.target.checked)}
                        aria-label={`Corriger ${item.ref}`}
                      />
                      {item.ref}
                    </label>
                    <span className="dispatch-order-meta" title={item.detail}>
                      {item.commune} · {item.customerName} · chez <strong>{riderName.get(item.fromRiderId) || "?"}</strong> · {item.detail}
                    </span>
                    <select
                      className="field-input dispatch-move"
                      value={targets[item.orderId] || ""}
                      onChange={(event) => {
                        const value = event.target.value;
                        setTargets((current) => ({ ...current, [item.orderId]: value }));
                        if (value) togglePicked([item.orderId], true);
                      }}
                      aria-label={`Nouveau livreur pour ${item.ref}`}
                    >
                      <option value="">Choisir...</option>
                      {presentRiders.filter((rider) => rider.id !== item.fromRiderId).map((rider) => (
                        <option key={rider.id} value={rider.id}>
                          {rider.name}{rider.id === item.toRiderId ? " (propose)" : ""}
                        </option>
                      ))}
                      <option value={UNASSIGN}>Retirer le livreur</option>
                    </select>
                  </div>
                ))}
              </section>
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
