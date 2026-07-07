"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  History,
  MapPin,
  Package,
  PackageCheck,
  PackagePlus,
  Phone,
  Search,
  Store,
  UserRoundCheck,
  X,
} from "lucide-react";
import { useToast } from "@/components/Toast";
import { formatPrice } from "@/lib/constants";
import { getImageUrl } from "@/lib/utils";
import {
  cancelRelayParcelAction,
  depositRelayParcelAction,
  markRelayParcelPickedUpAction,
} from "@/modules/boutique/relay-actions";
import styles from "./boutique-relay.module.css";

export type RelayOrder = {
  id: string;
  ref: string | null;
  customerName: string;
  customerPhone: string;
  customerPhone2: string | null;
  customerLocation: string | null;
  commune: string | null;
  total: number;
  deliveryFee: number;
  discount: number;
  status: string;
  boutiqueName: string;
  shelfCode: string | null;
  relayNote: string | null;
  returnReason: string | null;
  amountReceived: number | null;
  deliveredAt: string | null;
  lastRelayAction: string | null;
  lastRelayAt: string | null;
  lastRelayBy: string | null;
  history: Array<{
    at: string;
    action: string;
    byName: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: string;
    name: string;
    size: string;
    color: string;
    qty: number;
    price: number;
    image: string | null;
    isGift: boolean;
  }>;
};

type FilterKey = "active" | "completed" | "cancelled" | "all";
type ActivePanel =
  | { kind: "pickup"; order: RelayOrder }
  | { kind: "cancel"; order: RelayOrder }
  | null;

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "active", label: "À gérer" },
  { key: "completed", label: "Recuperes" },
  { key: "cancelled", label: "Annules" },
  { key: "all", label: "Tous" },
];

const CANCEL_OUTCOMES = [
  "Annulé par la boutique",
  "Refus client",
  "Livré autrement",
  "Retour au gestionnaire",
  "Autre issue",
];

function isAvailable(order: RelayOrder) {
  return order.status === "COLLECTED";
}

function isCompleted(order: RelayOrder) {
  return order.status === "DELIVERED";
}

function isCancelled(order: RelayOrder) {
  return order.status === "CANCELLED" || order.status === "RETURNED";
}

function isIncoming(order: RelayOrder) {
  return !isAvailable(order) && !isCompleted(order) && !isCancelled(order);
}

function statusLabel(order: RelayOrder) {
  if (isAvailable(order)) return "Disponible boutique";
  if (isIncoming(order)) return "Attribuée - dépôt attendu";
  if (isCompleted(order)) return "Recupere client";
  if (isCancelled(order)) return "Sorti avec motif";
  return order.status;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function BoutiqueRelayClient({
  initialOrders,
  relayPoints,
  user,
}: {
  initialOrders: RelayOrder[];
  relayPoints: string[];
  user: { name: string; role: string; relayName: string | null };
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("active");
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [historyOrder, setHistoryOrder] = useState<RelayOrder | null>(null);
  const [depositRef, setDepositRef] = useState("");
  const [depositBoutique, setDepositBoutique] = useState(relayPoints[0] || "");
  const [depositShelf, setDepositShelf] = useState("");
  const [depositNote, setDepositNote] = useState("");
  const [pickupReceiver, setPickupReceiver] = useState("");
  const [pickupAmount, setPickupAmount] = useState("");
  const [pickupNote, setPickupNote] = useState("");
  const [cancelOutcome, setCancelOutcome] = useState(CANCEL_OUTCOMES[0]);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelAmount, setCancelAmount] = useState("0");
  const canDeposit = ["admin", "developer", "collection"].includes(user.role);
  // Les actions de sortie (recuperation / cloture) sont reservees au gerant et aux admins :
  // les memes roles que cote serveur, pour ne pas afficher de boutons voues a l'echec.
  const canManageParcel = ["admin", "developer", "point_relais"].includes(user.role);

  const counts = useMemo(() => {
    return {
      active: initialOrders.filter((order) => isIncoming(order) || isAvailable(order)).length,
      available: initialOrders.filter(isAvailable).length,
      completed: initialOrders.filter(isCompleted).length,
      cancelled: initialOrders.filter(isCancelled).length,
      all: initialOrders.length,
    };
  }, [initialOrders]);

  const visibleOrders = useMemo(() => {
    const cleanQuery = query.trim().toLowerCase();
    return initialOrders
      .filter((order) => {
        if (filter === "active") return isIncoming(order) || isAvailable(order);
        if (filter === "completed") return isCompleted(order);
        if (filter === "cancelled") return isCancelled(order);
        return true;
      })
      .filter((order) => {
        if (!cleanQuery) return true;
        return [
          order.ref,
          order.customerName,
          order.customerPhone,
          order.customerPhone2,
          order.commune,
          order.boutiqueName,
          order.shelfCode,
        ]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(cleanQuery));
      });
  }, [filter, initialOrders, query]);

  const submitDeposit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    startTransition(async () => {
      const res = await depositRelayParcelAction({
        orderRef: depositRef,
        boutiqueName: depositBoutique,
        shelfCode: depositShelf,
        note: depositNote,
      });
      if (res.success) {
        showToast(res.message || "Colis depose en boutique.", "success");
        setDepositRef("");
        setDepositShelf("");
        setDepositNote("");
        setDepositOpen(false);
        router.refresh();
      } else {
        showToast(res.error || "Depot impossible.", "error");
      }
    });
  };

  const submitPickup = () => {
    if (!activePanel || activePanel.kind !== "pickup") return;
    startTransition(async () => {
      const res = await markRelayParcelPickedUpAction({
        orderId: activePanel.order.id,
        receiverName: pickupReceiver,
        amountReceived: pickupAmount,
        note: pickupNote,
      });
      if (res.success) {
        showToast(res.message || "Recuperation confirmee.", "success");
        closePanel();
        router.refresh();
      } else {
        showToast(res.error || "Action impossible.", "error");
      }
    });
  };

  const submitCancel = () => {
    if (!activePanel || activePanel.kind !== "cancel") return;
    startTransition(async () => {
      const res = await cancelRelayParcelAction({
        orderId: activePanel.order.id,
        outcome: cancelOutcome,
        reason: cancelReason,
        amountReceived: cancelOutcome === "Livré autrement" ? cancelAmount : undefined,
      });
      if (res.success) {
        showToast(res.message || "Colis annule.", "success");
        closePanel();
        router.refresh();
      } else {
        showToast(res.error || "Annulation impossible.", "error");
      }
    });
  };

  const openPickup = (order: RelayOrder) => {
    setPickupReceiver(order.customerName);
    setPickupAmount(String(Math.max(0, order.total + order.deliveryFee - (order.discount || 0))));
    setPickupNote("");
    setActivePanel({ kind: "pickup", order });
  };

  const openCancel = (order: RelayOrder) => {
    setCancelOutcome(CANCEL_OUTCOMES[0]);
    setCancelReason("");
    setCancelAmount("0");
    setActivePanel({ kind: "cancel", order });
  };

  const closePanel = () => {
    setActivePanel(null);
    setPickupReceiver("");
    setPickupAmount("");
    setPickupNote("");
    setCancelReason("");
    setCancelAmount("0");
  };

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Espace gérant</p>
          <h1>{user.relayName || "Point relais"}</h1>
          <p className={styles.subtitle}>{user.name} · Gestion des colis</p>
        </div>
        <div className={styles.headerActions}>
          {canDeposit && (
            <button type="button" className={styles.depositTrigger} onClick={() => setDepositOpen(true)}>
              <PackagePlus size={17} />
              <span>Nouveau depot</span>
              <small>Gestion livraison</small>
            </button>
          )}
          <div className={styles.headerIcon}>
            <Store size={24} />
          </div>
        </div>
      </header>

      <section className={styles.metrics}>
        <Metric icon={<PackageCheck size={17} />} label="Disponibles" value={counts.available} tone="green" />
        <Metric icon={<UserRoundCheck size={17} />} label="Recuperes" value={counts.completed} tone="blue" />
        <Metric icon={<AlertTriangle size={17} />} label="Annules" value={counts.cancelled} tone="red" />
      </section>

      <section className={styles.toolbar}>
        <div className={styles.toolbarTop}>
          <div>
            <strong>Suivi des colis</strong>
            <span>{visibleOrders.length} resultat(s)</span>
          </div>
          {canDeposit && (
            <button type="button" className={styles.mobileDepositTrigger} onClick={() => setDepositOpen(true)} aria-label="Nouveau depot">
              <PackagePlus size={18} />
            </button>
          )}
        </div>
        <div className={styles.searchBox}>
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Client, telephone, reference, casier..." />
        </div>
        <div className={styles.filters}>
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={filter === item.key ? styles.activeFilter : ""}
            >
              {item.label}
              <span>{counts[item.key]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.list}>
        {visibleOrders.map((order) => (
          <article key={order.id} className={styles.orderCard} data-status={isIncoming(order) ? "incoming" : isAvailable(order) ? "available" : isCompleted(order) ? "completed" : "cancelled"}>
            <div className={styles.orderTop}>
              <div>
                <span className={styles.ref}>{order.ref || order.id.slice(0, 8)}</span>
                <h2>{order.customerName}</h2>
              </div>
              <span className={styles.statusPill}>{statusLabel(order)}</span>
            </div>

            <div className={styles.infoGrid}>
              <Info icon={<Phone size={14} />} label="Telephone" value={[order.customerPhone, order.customerPhone2].filter(Boolean).join(" / ")} />
              <Info icon={<MapPin size={14} />} label="Adresse" value={[order.commune, order.customerLocation].filter(Boolean).join(" · ") || "-"} />
              <Info icon={<Store size={14} />} label="Boutique" value={`${order.boutiqueName}${order.shelfCode ? ` · ${order.shelfCode}` : ""}`} />
              <Info icon={<Clock3 size={14} />} label="Mouvement" value={formatDate(order.lastRelayAt || order.updatedAt)} />
            </div>

            <div className={styles.items}>
              {order.items.slice(0, 3).map((item) => (
                <div key={item.id} className={styles.itemRow}>
                  <div className={styles.productImage}>
                    {item.image ? (
                      <Image src={getImageUrl(item.image)} alt={item.name} fill sizes="64px" unoptimized />
                    ) : (
                      <Package size={20} />
                    )}
                  </div>
                  <div className={styles.productDetails}>
                    <strong>{item.name}</strong>
                    <em>{item.size} · {item.color}</em>
                  </div>
                  <span>{item.qty}x</span>
                </div>
              ))}
              {order.items.length > 3 && <div className={styles.moreItems}>+{order.items.length - 3} autre(s) article(s)</div>}
            </div>

            <div className={styles.cardFooter}>
              <div>
                <span>Total</span>
                <strong>{formatPrice(Math.max(0, order.total + order.deliveryFee - (order.discount || 0)))}</strong>
              </div>
              {(isAvailable(order) || isIncoming(order)) && canManageParcel ? (
                <div className={styles.actions}>
                  <button type="button" className={styles.historyButton} onClick={() => setHistoryOrder(order)}>
                    <History size={16} />
                    <span>Historique</span>
                  </button>
                  <button type="button" className={styles.secondaryButton} onClick={() => openCancel(order)}>
                    <AlertTriangle size={16} />
                    <span>Autre issue</span>
                  </button>
                  <button type="button" className={styles.primaryButton} onClick={() => openPickup(order)}>
                    <CheckCircle2 size={16} />
                    <span>Récupéré OK</span>
                  </button>
                </div>
              ) : isAvailable(order) || isIncoming(order) ? (
                <div className={styles.inactiveActions}>
                  <p className={styles.closedReason}>Sortie gérée par le gérant de la boutique</p>
                  <button type="button" className={styles.historyButton} onClick={() => setHistoryOrder(order)}>
                    <History size={16} />
                    <span>Historique</span>
                  </button>
                </div>
              ) : (
                <div className={styles.inactiveActions}>
                  <p className={styles.closedReason}>{order.returnReason || order.lastRelayAction || "Dossier clôturé"}</p>
                  <button type="button" className={styles.historyButton} onClick={() => setHistoryOrder(order)}>
                    <History size={16} />
                    <span>Historique</span>
                  </button>
                </div>
              )}
            </div>
          </article>
        ))}

        {visibleOrders.length === 0 && (
          <div className={styles.emptyState}>
            <Store size={26} />
            <h2>Aucun colis dans cette vue</h2>
            <p>Scannez ou saisissez une reference pour deposer un colis en boutique.</p>
          </div>
        )}
      </section>

      {depositOpen && canDeposit && (
        <div className={styles.sheetOverlay} role="dialog" aria-modal="true">
          <div className={styles.sheet}>
            <div className={styles.sheetHeader}>
              <div>
                <span>Gestionnaire de livraison</span>
                <h2>Deposer un colis au point relais</h2>
              </div>
              <button type="button" onClick={() => setDepositOpen(false)} aria-label="Fermer"><X size={18} /></button>
            </div>
            <form onSubmit={submitDeposit} className={styles.sheetBody}>
              <label>
                <span>Reference colis</span>
                <input autoFocus value={depositRef} onChange={(event) => setDepositRef(event.target.value)} placeholder="Ex: ABJ-2406-001" />
              </label>
              <div className={styles.formRow}>
                <label>
                  <span>Boutique</span>
                  <select value={depositBoutique} onChange={(event) => setDepositBoutique(event.target.value)} required>
                    <option value="">Choisir un point relais...</option>
                    {relayPoints.map((relayPoint) => (
                      <option key={relayPoint} value={relayPoint}>{relayPoint}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Casier ou emplacement</span>
                  <input value={depositShelf} onChange={(event) => setDepositShelf(event.target.value)} placeholder="Ex: B-12" />
                </label>
              </div>
              <label>
                <span>Consigne boutique</span>
                <textarea value={depositNote} onChange={(event) => setDepositNote(event.target.value)} placeholder="Etat du paquet, consigne client..." />
              </label>
              <button type="submit" className={styles.confirmButton} disabled={isPending || !depositRef.trim() || !depositBoutique.trim()}>
                <PackageCheck size={17} />
                {isPending ? "Depot en cours..." : "Confirmer le depot"}
              </button>
            </form>
          </div>
        </div>
      )}

      {activePanel && (
        <div className={styles.sheetOverlay} role="dialog" aria-modal="true">
          <div className={styles.sheet}>
            <div className={styles.sheetHeader}>
              <div>
                <span>{activePanel.order.ref || activePanel.order.id.slice(0, 8)}</span>
                <h2>{activePanel.kind === "pickup" ? "Confirmer la récupération" : "Signaler une autre issue"}</h2>
              </div>
              <button type="button" onClick={closePanel} aria-label="Fermer"><X size={18} /></button>
            </div>

            {activePanel.kind === "pickup" ? (
              <div className={styles.sheetBody}>
                <label>
                  <span>Personne qui récupère</span>
                  <input value={pickupReceiver} onChange={(event) => setPickupReceiver(event.target.value)} />
                </label>
                <label>
                  <span>Montant reçu</span>
                  <input inputMode="numeric" value={pickupAmount} onChange={(event) => setPickupAmount(event.target.value)} />
                </label>
                <label>
                  <span>Note</span>
                  <textarea value={pickupNote} onChange={(event) => setPickupNote(event.target.value)} placeholder="Pièce vérifiée, paiement, remarque..." />
                </label>
                <button type="button" disabled={isPending} onClick={submitPickup} className={styles.confirmButton}>
                  <CheckCircle2 size={17} />
                  Confirmer : colis récupéré
                </button>
              </div>
            ) : (
              <div className={styles.sheetBody}>
                <label>
                  <span>Issue du colis</span>
                  <select value={cancelOutcome} onChange={(event) => setCancelOutcome(event.target.value)}>
                    {CANCEL_OUTCOMES.map((outcome) => (
                      <option key={outcome} value={outcome}>{outcome}</option>
                    ))}
                  </select>
                </label>
                {cancelOutcome === "Livré autrement" && (
                  <label>
                    <span>Montant reçu en boutique</span>
                    <input inputMode="numeric" value={cancelAmount} onChange={(event) => setCancelAmount(event.target.value)} placeholder="0 si l'argent n'est pas passé par la boutique" />
                  </label>
                )}
                <label>
                  <span>Précision obligatoire</span>
                  <textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Expliquez clairement la situation et la destination du colis..." />
                </label>
                <button type="button" disabled={isPending || !cancelReason.trim()} onClick={submitCancel} className={cancelOutcome === "Livré autrement" ? styles.confirmButton : styles.dangerButton}>
                  {cancelOutcome === "Livré autrement" ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
                  Confirmer cette issue
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {historyOrder && (
        <div className={styles.sheetOverlay} role="dialog" aria-modal="true" aria-label="Historique du colis">
          <div className={`${styles.sheet} ${styles.historySheet}`}>
            <div className={styles.sheetHeader}>
              <div>
                <span>{historyOrder.ref || historyOrder.id.slice(0, 8)}</span>
                <h2>Historique du colis</h2>
              </div>
              <button type="button" onClick={() => setHistoryOrder(null)} aria-label="Fermer"><X size={18} /></button>
            </div>
            <div className={styles.historySummary}>
              <strong>{historyOrder.customerName}</strong>
              <span>{statusLabel(historyOrder)}</span>
            </div>
            <div className={styles.timeline}>
              {historyOrder.history.length > 0 ? historyOrder.history.map((entry, index) => (
                <div className={styles.timelineItem} key={`${entry.at}-${index}`}>
                  <div className={styles.timelineDot}><History size={13} /></div>
                  <div>
                    <strong>{entry.action}</strong>
                    <span>{formatDate(entry.at)}{entry.byName ? ` · ${entry.byName}` : ""}</span>
                  </div>
                </div>
              )) : (
                <div className={styles.timelineEmpty}>Aucun mouvement enregistré.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: number; tone: "green" | "blue" | "red" }) {
  return (
    <div className={styles.metric} data-tone={tone}>
      <div>{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className={styles.infoItem}>
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
      </div>
    </div>
  );
}
