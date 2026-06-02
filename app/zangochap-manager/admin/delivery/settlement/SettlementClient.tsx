"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Eye,
  Filter,
  History,
  PhoneCall,
  RotateCcw,
  Search,
  ShoppingBag,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import Modal from "@/components/Modal";
import { EmptyState, StatCard, StatusBadge } from "@/components/UI";
import { useToast } from "@/components/Toast";
import { formatDate, formatPrice } from "@/lib/constants";
import { createSettlement, toggleCommercialContacted } from "@/modules/orders/actions";
import "./settlement-client.css";

type SettlementOrder = {
  id: string;
  ref?: string | null;
  total?: number | null;
  deliveryFee?: number | null;
  discount?: number | null;
  amountReceived?: number | null;
  amountToSettle?: number;
  productsAmount?: number;
  deliveryFeesAmount?: number;
  paymentMethod?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerLocation?: string | null;
  commune?: string | null;
  deliveryDate?: string | Date | null;
  deliveredAt?: string | null;
  updatedAt?: string | Date;
  deliverymanId?: string | null;
  deliverymanName?: string | null;
  status?: string;
  returnReason?: string | null;
  isCommercialContacted?: boolean;
};

type RiderGroup = {
  id: string;
  name: string;
  orders: SettlementOrder[];
  totalDeliveryFees: number;
  totalProducts: number;
  totalGrandTotal: number;
  cashTotal: number;
  orderCount: number;
};

type ReturnRiderGroup = {
  id: string;
  name: string;
  orders: SettlementOrder[];
  uncontactedCount: number;
};

type SettlementHistory = {
  id: string;
  deliverymanId?: string | null;
  amount: number;
  productsAmount: number;
  deliveryFeesAmount: number;
  ordersCount: number;
  status: string;
  notes?: string | null;
  by?: string | null;
  createdAt: string | Date;
  deliveryman?: { name: string | null } | null;
  orders?: SettlementOrder[];
};

type Dashboard = {
  riderOptions: { id: string; name: string }[];
  collectable: { riders: RiderGroup[]; orders: SettlementOrder[] };
  returns: { orders: SettlementOrder[]; byRider: ReturnRiderGroup[] };
  history: SettlementHistory[];
  summary: {
    toSettleTotal: number;
    productsTotal: number;
    deliveryFeesTotal: number;
    cashTotal: number;
    collectableOrdersCount: number;
    returnOrdersCount: number;
    uncontactedReturnsCount: number;
    historyTotal: number;
    historyOrdersCount: number;
    historyRidersCount: number;
  };
};

type ActiveTab = "collectable" | "returns" | "history";
type ReturnFilter = "all" | "uncontacted" | "contacted" | "RETURNED" | "CANCELLED" | "REPRO_DISPO";

interface Props {
  dashboard: Dashboard;
  initialDate?: string;
  initialRiderId?: string;
}

function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function orderRef(order: SettlementOrder) {
  return order.ref?.split("-").pop() || order.ref || "Sans ref";
}

function initials(name: string) {
  return name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function normalize(value?: string | null) {
  return String(value || "").toLowerCase();
}

function methodKey(method?: string | null) {
  return String(method || "Inconnu");
}

function groupHistoryByDate(history: SettlementHistory[]) {
  const formatter = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const groups = history.reduce<Record<string, {
    label: string;
    timestamp: number;
    rows: SettlementHistory[];
    total: number;
    products: number;
    fees: number;
    ordersCount: number;
  }>>((acc, settlement) => {
    const firstDeliveryDate = settlement.orders?.find((order) => order.deliveryDate)?.deliveryDate;
    const date = new Date(firstDeliveryDate || settlement.createdAt);
    const key = date.toISOString().slice(0, 10);
    if (!acc[key]) {
      acc[key] = {
        label: formatter.format(date),
        timestamp: date.getTime(),
        rows: [],
        total: 0,
        products: 0,
        fees: 0,
        ordersCount: 0,
      };
    }

    acc[key].rows.push(settlement);
    acc[key].total += Number(settlement.amount || 0);
    acc[key].products += Number(settlement.productsAmount || 0);
    acc[key].fees += Number(settlement.deliveryFeesAmount || 0);
    acc[key].ordersCount += Number(settlement.ordersCount || 0);
    return acc;
  }, {});

  return Object.entries(groups)
    .sort(([, a], [, b]) => b.timestamp - a.timestamp)
    .map(([key, group]) => ({ key, ...group }));
}

export default function SettlementClient({
  dashboard,
  initialDate,
  initialRiderId,
}: Props) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("collectable");
  const [search, setSearch] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(initialDate || "");
  const [riderId, setRiderId] = useState(initialRiderId || "");
  const [methodFilter, setMethodFilter] = useState("");
  const [returnFilter, setReturnFilter] = useState<ReturnFilter>("all");
  const [selectedRider, setSelectedRider] = useState<RiderGroup | null>(null);
  const [selectedReturnRider, setSelectedReturnRider] = useState<ReturnRiderGroup | null>(null);
  const [contactOverrides, setContactOverrides] = useState<Record<string, boolean>>({});
  const [isPending, startTransition] = useTransition();

  const router = useRouter();
  const searchParams = useSearchParams();
  const { showToast } = useToast();

  const today = localDateInputValue();

  const updateFilters = (next: { date?: string; riderId?: string }) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("from");
    params.delete("to");
    const nextDate = next.date ?? deliveryDate;
    const nextRiderId = next.riderId ?? riderId;

    if (nextDate) params.set("date", nextDate); else params.delete("date");
    if (nextRiderId) params.set("riderId", nextRiderId); else params.delete("riderId");

    router.push(`?${params.toString()}`);
  };

  const applyDateFilter = () => updateFilters({ date: deliveryDate });

  const setToday = () => {
    setDeliveryDate(today);
    updateFilters({ date: today });
  };

  const clearFilters = () => {
    setDeliveryDate("");
    setRiderId("");
    setSearch("");
    setMethodFilter("");
    setReturnFilter("all");
    router.push("?");
  };

  const paymentMethods = useMemo(() => {
    return Array.from(new Set(dashboard.collectable.orders.map((order) => methodKey(order.paymentMethod))))
      .sort((a, b) => a.localeCompare(b));
  }, [dashboard.collectable.orders]);

  const collectableRiders = useMemo(() => {
    const query = normalize(search);
    return dashboard.collectable.riders
      .map((rider) => {
        const orders = rider.orders.filter((order) => {
          const matchesMethod = !methodFilter || methodKey(order.paymentMethod) === methodFilter;
          const text = [
            rider.name,
            order.ref,
            order.customerName,
            order.customerPhone,
            order.customerLocation,
            order.commune,
            order.paymentMethod,
            order.status,
          ].join(" ");
          return matchesMethod && (!query || normalize(text).includes(query));
        });

        return {
          ...rider,
          orders,
          totalDeliveryFees: orders.reduce((sum, order) => sum + Number(order.deliveryFeesAmount || 0), 0),
          totalProducts: orders.reduce((sum, order) => sum + Number(order.productsAmount || 0), 0),
          totalGrandTotal: orders.reduce((sum, order) => sum + Number(order.amountToSettle || 0), 0),
          cashTotal: orders.reduce((sum, order) => (
            normalize(order.paymentMethod).includes("cash") ? sum + Number(order.amountToSettle || 0) : sum
          ), 0),
          orderCount: orders.length,
        };
      })
      .filter((rider) => rider.orders.length > 0)
      .sort((a, b) => b.totalGrandTotal - a.totalGrandTotal);
  }, [dashboard.collectable.riders, methodFilter, search]);

  const returnRiders = useMemo(() => {
    const query = normalize(search);
    return dashboard.returns.byRider
      .map((rider) => {
        const orders = rider.orders
          .map((order) => ({
            ...order,
            isCommercialContacted: contactOverrides[order.id] ?? order.isCommercialContacted,
          }))
          .filter((order) => {
            const contacted = Boolean(order.isCommercialContacted);
            const matchesReturnFilter =
              returnFilter === "all" ||
              (returnFilter === "uncontacted" && !contacted) ||
              (returnFilter === "contacted" && contacted) ||
              order.status === returnFilter;
            const text = [
              rider.name,
              order.ref,
              order.customerName,
              order.customerPhone,
              order.returnReason,
              order.status,
            ].join(" ");
            return matchesReturnFilter && (!query || normalize(text).includes(query));
          });

        return {
          ...rider,
          orders,
          uncontactedCount: orders.filter((order) => !order.isCommercialContacted).length,
        };
      })
      .filter((rider) => rider.orders.length > 0)
      .sort((a, b) => b.uncontactedCount - a.uncontactedCount || a.name.localeCompare(b.name));
  }, [dashboard.returns.byRider, contactOverrides, returnFilter, search]);

  const filteredHistory = useMemo(() => {
    const query = normalize(search);
    return dashboard.history.filter((settlement) => {
      const text = [
        settlement.deliveryman?.name,
        settlement.by,
        settlement.notes,
        ...(settlement.orders || []).flatMap((order) => [
          order.ref,
          order.customerName,
          order.paymentMethod,
          order.status,
        ]),
      ].join(" ");
      return !query || normalize(text).includes(query);
    });
  }, [dashboard.history, search]);

  const historyGroups = useMemo(() => groupHistoryByDate(filteredHistory), [filteredHistory]);

  const visibleTotals = useMemo(() => {
    if (activeTab === "history") {
      return {
        total: filteredHistory.reduce((sum, settlement) => sum + Number(settlement.amount || 0), 0),
        products: filteredHistory.reduce((sum, settlement) => sum + Number(settlement.productsAmount || 0), 0),
        fees: filteredHistory.reduce((sum, settlement) => sum + Number(settlement.deliveryFeesAmount || 0), 0),
        count: filteredHistory.reduce((sum, settlement) => sum + Number(settlement.ordersCount || 0), 0),
      };
    }

    const riders = activeTab === "collectable" ? collectableRiders : [];
    return {
      total: riders.reduce((sum, rider) => sum + rider.totalGrandTotal, 0),
      products: riders.reduce((sum, rider) => sum + rider.totalProducts, 0),
      fees: riders.reduce((sum, rider) => sum + rider.totalDeliveryFees, 0),
      count: activeTab === "returns"
        ? returnRiders.reduce((sum, rider) => sum + rider.orders.length, 0)
        : riders.reduce((sum, rider) => sum + rider.orders.length, 0),
    };
  }, [activeTab, collectableRiders, filteredHistory, returnRiders]);

  const settleRider = (rider: RiderGroup) => {
    if (rider.orders.length === 0 || rider.totalGrandTotal <= 0) {
      showToast("Aucune commande a encaisser pour ce livreur.", "default");
      return;
    }

    if (!confirm(`Valider ${formatPrice(rider.totalGrandTotal)} pour ${rider.name} ?`)) return;

    startTransition(async () => {
      try {
        await createSettlement(rider.id, rider.orders.map((order) => order.id), rider.totalGrandTotal);
        showToast(`Reglement de ${rider.name} valide`, "success");
        setSelectedRider(null);
        router.refresh();
      } catch (error: unknown) {
        showToast(error instanceof Error ? error.message : "Erreur pendant le reglement", "error");
      }
    });
  };

  const toggleContacted = (order: SettlementOrder) => {
    const nextValue = !Boolean(contactOverrides[order.id] ?? order.isCommercialContacted);

    startTransition(async () => {
      try {
        await toggleCommercialContacted(order.id, nextValue);
        setContactOverrides((current) => ({ ...current, [order.id]: nextValue }));
        showToast("Retour mis a jour", "success");
        router.refresh();
      } catch (error: unknown) {
        showToast(error instanceof Error ? error.message : "Erreur", "error");
      }
    });
  };

  const activeSearchPlaceholder = activeTab === "history"
    ? "Rechercher un reglement, livreur, commande..."
    : activeTab === "returns"
      ? "Rechercher un retour, client, motif..."
      : "Rechercher un livreur, client, reference...";

  return (
    <div className="content animate-fade-in settlement-page">
      <div className="stats-grid">
        <StatCard label="A encaisser" value={formatPrice(dashboard.summary.toSettleTotal)} icon={<Wallet size={20} />} accent />
        <StatCard label="Produits" value={formatPrice(dashboard.summary.productsTotal)} icon={<ShoppingBag size={20} />} color="var(--orange)" />
        <StatCard label="Livraison" value={formatPrice(dashboard.summary.deliveryFeesTotal)} icon={<Truck size={20} />} color="var(--blue)" />
        <StatCard label="Retours ouverts" value={dashboard.summary.uncontactedReturnsCount} icon={<AlertTriangle size={20} />} color="#B91C1C" />
      </div>

      <div className="settlement-filter-panel">
        <div className="settlement-filter-head">
          <div>
            <div className="settlement-filter-title"><Filter size={15} /> Reglements livreurs</div>
            <p>
              {dashboard.summary.collectableOrdersCount} commande(s) a encaisser,
              {" "}{dashboard.summary.returnOrdersCount} retour(s),
              {" "}{dashboard.history.length} reglement(s) sur la periode.
            </p>
          </div>
          <button type="button" className="settlement-reset-btn" onClick={clearFilters}>
            <X size={14} /> Reinitialiser
          </button>
        </div>

        <div className="settlement-tabs">
          <button className={`filter-chip ${activeTab === "collectable" ? "active" : ""}`} onClick={() => setActiveTab("collectable")}>
            <Banknote size={14} /> A encaisser
          </button>
          <button className={`filter-chip ${activeTab === "returns" ? "active" : ""}`} onClick={() => setActiveTab("returns")}>
            <RotateCcw size={14} /> Retours
            {dashboard.summary.uncontactedReturnsCount > 0 && <span className="chip-count">{dashboard.summary.uncontactedReturnsCount}</span>}
          </button>
          <button className={`filter-chip ${activeTab === "history" ? "active" : ""}`} onClick={() => setActiveTab("history")}>
            <History size={14} /> Historique
          </button>
        </div>

        <div className="settlement-filter-grid">
          <label className="settlement-search">
            <Search size={15} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={activeSearchPlaceholder} />
            {search && (
              <button type="button" onClick={() => setSearch("")}>
                <X size={13} />
              </button>
            )}
          </label>

          <label className="settlement-select">
            <Truck size={15} />
            <select
              value={riderId}
              onChange={(event) => {
                setRiderId(event.target.value);
                updateFilters({ riderId: event.target.value });
              }}
            >
              <option value="">Tous les livreurs</option>
              {dashboard.riderOptions.map((rider) => (
                <option key={rider.id} value={rider.id}>{rider.name}</option>
              ))}
            </select>
            <ChevronDown size={14} />
          </label>

          {activeTab === "collectable" && (
            <label className="settlement-select">
              <Banknote size={15} />
              <select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}>
                <option value="">Tous paiements</option>
                {paymentMethods.map((method) => (
                  <option key={method} value={method}>{method}</option>
                ))}
              </select>
              <ChevronDown size={14} />
            </label>
          )}

          {activeTab === "returns" && (
            <label className="settlement-select">
              <PhoneCall size={15} />
              <select value={returnFilter} onChange={(event) => setReturnFilter(event.target.value as ReturnFilter)}>
                <option value="all">Tous les retours</option>
                <option value="uncontacted">Non contactes</option>
                <option value="contacted">Contactes</option>
                <option value="RETURNED">Retours</option>
                <option value="CANCELLED">Annules</option>
                <option value="REPRO_DISPO">Repro-dispo</option>
              </select>
              <ChevronDown size={14} />
            </label>
          )}
        </div>

        <div className="date-filters">
          <button type="button" className={`filter-chip today-chip ${deliveryDate === today ? "active" : ""}`} onClick={setToday}>
            Aujourd&apos;hui
          </button>
          <label className="date-input-group">
            <Calendar size={14} />
            <span>Date livraison</span>
            <input type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} />
          </label>
          <button className="apply-btn-sm" onClick={applyDateFilter} title="Appliquer la date de livraison">
            <Filter size={14} />
          </button>
        </div>

        <div className="settlement-visible-summary">
          <div><span>Total affiche</span><strong>{formatPrice(visibleTotals.total)}</strong></div>
          <div><span>Produits</span><strong>{formatPrice(visibleTotals.products)}</strong></div>
          <div><span>Livraison</span><strong>{formatPrice(visibleTotals.fees)}</strong></div>
          <div><span>Lignes</span><strong>{visibleTotals.count}</strong></div>
        </div>
      </div>

      {activeTab === "collectable" && (
        <div className="settle-grid">
          {collectableRiders.length === 0 ? (
            <div className="settlement-empty-wide">
              <EmptyState icon="OK" title="Aucun encaissement" description="Aucune commande livree non reglee ne correspond aux filtres." />
            </div>
          ) : collectableRiders.map((rider) => (
            <article key={rider.id} className="settle-card-simple">
              <div className="settle-card-top">
                <div className="settle-avatar">{initials(rider.name)}</div>
                <div className="settle-info">
                  <div className="cell-strong">{rider.name}</div>
                  <div className="cell-muted">{rider.orderCount} commande(s) a encaisser</div>
                </div>
                <button className="btn-icon-only" onClick={() => setSelectedRider(rider)} aria-label={`Voir ${rider.name}`}>
                  <Eye size={18} />
                </button>
              </div>

              <div className="settle-amounts-row-simple">
                <div className="simple-amount strong">
                  <span className="label">Global</span>
                  <span className="val">{formatPrice(rider.totalGrandTotal)}</span>
                </div>
                <div className="simple-amount">
                  <span className="label">Produits</span>
                  <span className="val">{formatPrice(rider.totalProducts)}</span>
                </div>
                <div className="simple-amount">
                  <span className="label">Livraison</span>
                  <span className="val blue">{formatPrice(rider.totalDeliveryFees)}</span>
                </div>
                <div className="simple-amount">
                  <span className="label">Cash</span>
                  <span className="val">{formatPrice(rider.cashTotal)}</span>
                </div>
              </div>

              <div className="settle-order-preview">
                {rider.orders.slice(0, 3).map((order) => (
                  <span key={order.id}>#{orderRef(order)} · {formatPrice(Number(order.amountToSettle || 0))}</span>
                ))}
                {rider.orders.length > 3 && <span>+{rider.orders.length - 3} autre(s)</span>}
              </div>

              <button className="btn-orange settle-action" onClick={() => settleRider(rider)} disabled={isPending}>
                Valider le reglement <ArrowUpRight size={16} />
              </button>
            </article>
          ))}
        </div>
      )}

      {activeTab === "returns" && (
        <div className="settle-grid">
          {returnRiders.length === 0 ? (
            <div className="settlement-empty-wide">
              <EmptyState icon="OK" title="Aucun retour" description="Aucun retour ne correspond aux filtres." />
            </div>
          ) : returnRiders.map((rider) => (
            <article key={rider.id} className={`settle-card-simple ${rider.uncontactedCount > 0 ? "has-warning" : ""}`}>
              {rider.uncontactedCount > 0 && (
                <div className="warning-banner">
                  <PhoneCall size={12} /> {rider.uncontactedCount} a contacter
                </div>
              )}
              <div className="settle-card-top">
                <div className="settle-avatar warning">{initials(rider.name)}</div>
                <div className="settle-info">
                  <div className="cell-strong">{rider.name}</div>
                  <div className="cell-muted">{rider.orders.length} retour(s)</div>
                </div>
                <button className="btn-icon-only" onClick={() => setSelectedReturnRider(rider)} aria-label={`Voir retours ${rider.name}`}>
                  <Eye size={18} />
                </button>
              </div>

              <div className="return-list-preview">
                {rider.orders.slice(0, 4).map((order) => (
                  <div key={order.id} className="return-preview-row">
                    <span>#{orderRef(order)}</span>
                    <StatusBadge status={order.status} size="sm" />
                    <strong>{order.isCommercialContacted ? "Contacte" : "A appeler"}</strong>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}

      {activeTab === "history" && (
        <div className="settlement-history">
          {historyGroups.length === 0 ? (
            <div className="settlement-empty">
              <EmptyState icon="DOC" title="Aucun historique" description="Aucun reglement valide ne correspond aux filtres." />
            </div>
          ) : historyGroups.map((group) => (
            <section key={group.key} className="history-day-group">
              <div className="history-day-head">
                <div>
                  <div className="history-day-title"><Calendar size={15} /> {group.label}</div>
                  <p>{group.rows.length} reglement(s), {group.ordersCount} commande(s)</p>
                </div>
                <div className="history-day-total">
                  <span>Total</span>
                  <strong>{formatPrice(group.total)}</strong>
                </div>
              </div>
              <div className="history-day-metrics">
                <div><span>Produits</span><strong>{formatPrice(group.products)}</strong></div>
                <div><span>Livraison</span><strong>{formatPrice(group.fees)}</strong></div>
                <div><span>Livreurs</span><strong>{new Set(group.rows.map((row) => row.deliverymanId).filter(Boolean)).size}</strong></div>
              </div>
              <div className="history-list">
                {group.rows.map((settlement) => (
                  <article key={settlement.id} className="history-settlement-card">
                    <div className="history-settlement-main">
                      <div className="history-rider-avatar">{initials(settlement.deliveryman?.name || "Livreur")}</div>
                      <div>
                        <div className="cell-strong">{settlement.deliveryman?.name || "Livreur inconnu"}</div>
                        <div className="cell-muted">
                          {settlement.ordersCount} commande(s) · valide par {settlement.by || "-"} · {formatDate(settlement.createdAt)}
                        </div>
                      </div>
                    </div>
                    <div className="history-money-grid">
                      <div><span>Global</span><strong>{formatPrice(settlement.amount)}</strong></div>
                      <div><span>Produits</span><strong>{formatPrice(settlement.productsAmount)}</strong></div>
                      <div><span>Livraison</span><strong>{formatPrice(settlement.deliveryFeesAmount)}</strong></div>
                    </div>
                    {(settlement.orders || []).length > 0 && (
                      <div className="history-order-strip">
                        {(settlement.orders || []).slice(0, 6).map((order) => (
                          <span key={order.id}>#{orderRef(order)} · {order.customerName}</span>
                        ))}
                        {(settlement.orders || []).length > 6 && <span>+{(settlement.orders || []).length - 6} autre(s)</span>}
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Modal
        isOpen={!!selectedRider}
        onClose={() => setSelectedRider(null)}
        title={`Encaissement : ${selectedRider?.name || ""}`}
        large
      >
        {selectedRider && (
          <div className="modal-rider-details">
            <div className="modal-summary-grid">
              <div className="modal-summary-card"><span className="label">Global</span><span className="value">{formatPrice(selectedRider.totalGrandTotal)}</span></div>
              <div className="modal-summary-card"><span className="label">Produits</span><span className="value">{formatPrice(selectedRider.totalProducts)}</span></div>
              <div className="modal-summary-card"><span className="label">Livraison</span><span className="value">{formatPrice(selectedRider.totalDeliveryFees)}</span></div>
            </div>
            <div className="modal-order-list">
              {selectedRider.orders.map((order) => (
                <div key={order.id} className="modal-order-row">
                  <div className="order-info">
                    <span className="ref">#{orderRef(order)}</span>
                    <span className="cust">{order.customerName || "Client inconnu"}</span>
                    <div className="meta">{order.paymentMethod || "Mode inconnu"} · {order.commune || order.customerLocation || "Zone inconnue"}</div>
                  </div>
                  <div className="order-price">
                    <div className="total">{formatPrice(Number(order.amountToSettle || 0))}</div>
                    <div className="prod">Prod {formatPrice(Number(order.productsAmount || 0))} · Liv {formatPrice(Number(order.deliveryFeesAmount || 0))}</div>
                  </div>
                </div>
              ))}
            </div>
            <button className="btn-orange modal-main-action" onClick={() => settleRider(selectedRider)} disabled={isPending}>
              Valider ce reglement <ArrowUpRight size={16} />
            </button>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!selectedReturnRider}
        onClose={() => setSelectedReturnRider(null)}
        title={`Retours : ${selectedReturnRider?.name || ""}`}
        large
      >
        {selectedReturnRider && (
          <div className="modal-rider-details">
            <div className="modal-returned-list">
              {selectedReturnRider.orders.map((order) => {
                const contacted = Boolean(contactOverrides[order.id] ?? order.isCommercialContacted);
                return (
                  <div key={order.id} className="modal-returned-card">
                    <div className="card-header">
                      <div>
                        <span className="ref">#{orderRef(order)}</span>
                        <div className="cell-muted">{order.customerName || "Client inconnu"} · {order.customerPhone || "Sans telephone"}</div>
                      </div>
                      <StatusBadge status={order.status} size="sm" />
                    </div>
                    <div className="card-reason">
                      <AlertTriangle size={13} />
                      <span>{order.returnReason || "Motif non renseigne"}</span>
                    </div>
                    <button className={`contact-toggle ${contacted ? "active" : ""}`} onClick={() => toggleContacted(order)} disabled={isPending}>
                      {contacted ? <CheckCircle2 size={13} /> : <PhoneCall size={13} />}
                      {contacted ? "Commercial contacte" : "Marquer contacte"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
