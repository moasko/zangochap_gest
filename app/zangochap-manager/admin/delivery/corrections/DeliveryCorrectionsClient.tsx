"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Calendar,
  CalendarDays,
  Clock,
  MapPin,
  RotateCcw,
  Search,
  Truck,
  Undo2,
  User,
  X,
} from "lucide-react";
import Modal from "@/components/Modal";
import { EmptyState, StatCard, StatusBadge } from "@/components/UI";
import { useToast } from "@/components/Toast";
import { COMMUNES, formatDate, formatPrice } from "@/lib/constants";
import { reopenDeliveryOrder } from "@/modules/orders/actions";
import "./delivery-corrections.css";

type Deliveryman = {
  id: string;
  name: string;
  phone: string | null;
};

type CorrectionItem = {
  name: string;
  size: string;
  color: string;
  qty: number;
};

type CorrectionOrder = {
  id: string;
  ref: string | null;
  customerName: string;
  customerPhone: string;
  customerLocation?: string | null;
  commune?: string | null;
  total: number;
  discount?: number | null;
  deliveryFee?: number | null;
  deliveryDate?: string | null;
  deliverymanId?: string | null;
  deliverymanName?: string | null;
  status: string;
  returnReason?: string | null;
  amountReceived?: number | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  items?: CorrectionItem[];
};

interface DeliveryCorrectionsClientProps {
  orders: CorrectionOrder[];
  deliverymen: Deliveryman[];
}

const STATUS_FILTERS = [
  { value: "ALL", label: "Tous" },
  { value: "DELIVERED", label: "Livrees" },
  { value: "PARTIALLY_DELIVERED", label: "Partielles" },
  { value: "RETURNED", label: "Retours" },
  { value: "CANCELLED", label: "Annulees" },
  { value: "REPRO_DISPO", label: "Repro-dispo" },
];

const DATE_FILTERS = [
  { value: "ALL", label: "Toutes" },
  { value: "TODAY", label: "Aujourd'hui" },
  { value: "YESTERDAY", label: "Hier" },
  { value: "7_DAYS", label: "7 jours" },
  { value: "30_DAYS", label: "30 jours" },
  { value: "CUSTOM", label: "Avancee" },
] as const;

type DateFilter = typeof DATE_FILTERS[number]["value"];
type DateBasis = "updatedAt" | "deliveryDate";

function getOrderTotal(order: CorrectionOrder) {
  return Number(order.total || 0) + Number(order.deliveryFee || 0) - Number(order.discount || 0);
}

function getUpdatedDate(order: CorrectionOrder) {
  return order.updatedAt || order.createdAt || "";
}

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(date: Date) {
  const next = new Date(date);
  next.setHours(23, 59, 59, 999);
  return next;
}

function parseDateInput(value: string, boundary: "start" | "end") {
  if (!value) return null;
  const date = new Date(`${value}T${boundary === "start" ? "00:00:00" : "23:59:59"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getPresetDateRange(filter: DateFilter) {
  const today = startOfDay(new Date());
  const endToday = endOfDay(new Date());

  if (filter === "TODAY") return { from: today, to: endToday };
  if (filter === "YESTERDAY") {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return { from: startOfDay(yesterday), to: endOfDay(yesterday) };
  }
  if (filter === "7_DAYS") {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return { from, to: endToday };
  }
  if (filter === "30_DAYS") {
    const from = new Date(today);
    from.setDate(from.getDate() - 29);
    return { from, to: endToday };
  }

  return { from: null, to: null };
}

function getOrderDateForFilter(order: CorrectionOrder, dateBasis: DateBasis) {
  return dateBasis === "deliveryDate" ? order.deliveryDate : getUpdatedDate(order);
}

export default function DeliveryCorrectionsClient({ orders, deliverymen }: DeliveryCorrectionsClientProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("ALL");
  const [filterDeliveryman, setFilterDeliveryman] = useState("ALL");
  const [filterCommune, setFilterCommune] = useState("ALL");
  const [dateFilter, setDateFilter] = useState<DateFilter>("7_DAYS");
  const [dateBasis, setDateBasis] = useState<DateBasis>("updatedAt");
  const [dateFrom, setDateFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 6);
    return dateInputValue(date);
  });
  const [dateTo, setDateTo] = useState(() => dateInputValue(new Date()));
  const [selectedOrder, setSelectedOrder] = useState<CorrectionOrder | null>(null);
  const [correctionNote, setCorrectionNote] = useState("");
  const [isPending, startTransition] = useTransition();

  const router = useRouter();
  const { showToast } = useToast();

  const filteredOrders = useMemo(() => {
    const safeSearch = searchTerm.trim().toLowerCase();
    const presetRange = getPresetDateRange(dateFilter);
    const fromDate = dateFilter === "CUSTOM" ? parseDateInput(dateFrom, "start") : presetRange.from;
    const toDate = dateFilter === "CUSTOM" ? parseDateInput(dateTo, "end") : presetRange.to;

    return orders.filter((order) => {
      const matchesSearch =
        !safeSearch ||
        String(order.ref || "").toLowerCase().includes(safeSearch) ||
        String(order.customerName || "").toLowerCase().includes(safeSearch) ||
        String(order.customerPhone || "").toLowerCase().includes(safeSearch) ||
        String(order.deliverymanName || "").toLowerCase().includes(safeSearch) ||
        String(order.commune || "").toLowerCase().includes(safeSearch);

      const matchesStatus = filterStatus === "ALL" || order.status === filterStatus;
      const matchesDriver = filterDeliveryman === "ALL" || order.deliverymanId === filterDeliveryman;
      const matchesCommune = filterCommune === "ALL" || order.commune === filterCommune;
      const rawOrderDate = getOrderDateForFilter(order, dateBasis);
      const orderDate = rawOrderDate ? new Date(rawOrderDate) : null;
      const matchesDate =
        dateFilter === "ALL" ||
        (orderDate &&
          !Number.isNaN(orderDate.getTime()) &&
          (!fromDate || orderDate >= fromDate) &&
          (!toDate || orderDate <= toDate));

      return matchesSearch && matchesStatus && matchesDriver && matchesCommune && matchesDate;
    });
  }, [orders, searchTerm, filterStatus, filterDeliveryman, filterCommune, dateFilter, dateBasis, dateFrom, dateTo]);

  const stats = useMemo(() => {
    return {
      total: orders.length,
      visible: filteredOrders.length,
      delivered: orders.filter((order) => order.status === "DELIVERED").length,
      issues: orders.filter((order) => ["RETURNED", "CANCELLED", "REPRO_DISPO"].includes(order.status)).length,
      partial: orders.filter((order) => order.status === "PARTIALLY_DELIVERED").length,
    };
  }, [orders, filteredOrders]);

  const handleResetFilters = () => {
    setSearchTerm("");
    setFilterStatus("ALL");
    setFilterDeliveryman("ALL");
    setFilterCommune("ALL");
    setDateFilter("7_DAYS");
    setDateBasis("updatedAt");
    const date = new Date();
    date.setDate(date.getDate() - 6);
    setDateFrom(dateInputValue(date));
    setDateTo(dateInputValue(new Date()));
  };

  const handleCorrection = () => {
    if (!selectedOrder) return;
    const note = correctionNote.trim();
    if (!note) {
      showToast("Ajoutez un motif de correction.", "error");
      return;
    }

    startTransition(async () => {
      try {
        await reopenDeliveryOrder(selectedOrder.id, note);
        showToast("Commande remise en livraison", "success");
        setSelectedOrder(null);
        setCorrectionNote("");
        router.refresh();
      } catch (error: unknown) {
        showToast(error instanceof Error ? error.message : "Erreur de correction", "error");
      }
    });
  };

  return (
    <div className="content animate-fade-in delivery-corrections">
      <div className="stats-grid">
        <StatCard label="A corriger" value={stats.total} icon={<Undo2 size={20} />} accent />
        <StatCard label="Affichees" value={stats.visible} icon={<Search size={20} />} color="var(--blue)" />
        <StatCard label="Livrees" value={stats.delivered} icon={<Truck size={20} />} color="#166534" />
        <StatCard label="Echecs / repro" value={stats.issues} icon={<AlertTriangle size={20} />} color="var(--orange)" />
      </div>

      <div className="correction-panel">
        <div className="correction-panel-head">
          <div>
            <span className="correction-kicker">Controle admin</span>
            <h2>Commandes modifiables</h2>
            <p>Seules les commandes sans reglement livreur sont affichees.</p>
          </div>
          <div className="correction-head-metrics">
            <span><RotateCcw size={13} /> {stats.partial} partielle(s)</span>
            <button type="button" className="filter-reset" onClick={handleResetFilters}>
              <X size={14} /> Reinitialiser
            </button>
          </div>
        </div>

        <div className="correction-filter-shell">
          <div className="correction-search-row">
            <div className="search-container correction-search">
              <Search size={16} className="filter-icon" />
              <input
                className="field-input search-input"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Reference, client, telephone, livreur..."
              />
            </div>
            <div className="date-basis-toggle" aria-label="Base du filtre date">
              <button
                type="button"
                className={dateBasis === "updatedAt" ? "active" : ""}
                onClick={() => setDateBasis("updatedAt")}
              >
                <Clock size={13} /> Action
              </button>
              <button
                type="button"
                className={dateBasis === "deliveryDate" ? "active" : ""}
                onClick={() => setDateBasis("deliveryDate")}
              >
                <CalendarDays size={13} /> Livraison
              </button>
            </div>
          </div>

          <div className="date-preset-row">
            {DATE_FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={`date-preset ${dateFilter === filter.value ? "active" : ""}`}
                onClick={() => setDateFilter(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {dateFilter === "CUSTOM" && (
            <div className="advanced-date-row">
              <div className="date-field">
                <label htmlFor="correction-date-from">Du</label>
                <input
                  id="correction-date-from"
                  type="date"
                  className="field-input"
                  value={dateFrom}
                  onChange={(event) => setDateFrom(event.target.value)}
                />
              </div>
              <div className="date-field">
                <label htmlFor="correction-date-to">Au</label>
                <input
                  id="correction-date-to"
                  type="date"
                  className="field-input"
                  value={dateTo}
                  onChange={(event) => setDateTo(event.target.value)}
                />
              </div>
            </div>
          )}

          <div className="correction-filters">
            <div className="filter-item">
              <AlertTriangle size={16} className="filter-icon" />
              <select className="field-input filter-select" value={filterStatus} onChange={(event) => setFilterStatus(event.target.value)}>
                {STATUS_FILTERS.map((status) => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </select>
            </div>
            <div className="filter-item">
              <User size={16} className="filter-icon" />
              <select className="field-input filter-select" value={filterDeliveryman} onChange={(event) => setFilterDeliveryman(event.target.value)}>
                <option value="ALL">Tous les livreurs</option>
                {deliverymen.map((deliveryman) => (
                  <option key={deliveryman.id} value={deliveryman.id}>{deliveryman.name}</option>
                ))}
              </select>
            </div>
            <div className="filter-item">
              <MapPin size={16} className="filter-icon" />
              <select className="field-input filter-select" value={filterCommune} onChange={(event) => setFilterCommune(event.target.value)}>
                <option value="ALL">Toutes les communes</option>
                {Object.keys(COMMUNES).map((commune) => (
                  <option key={commune} value={commune}>{commune}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {filteredOrders.length === 0 ? (
          <EmptyState icon="OK" title="Aucune correction" description="Aucune commande ne correspond aux filtres actuels." />
        ) : (
          <div className="correction-list">
            {filteredOrders.map((order) => {
              const isPartial = order.status === "PARTIALLY_DELIVERED";
              return (
                <div key={order.id} className={`correction-row ${isPartial ? "is-partial" : ""}`}>
                  <div className="correction-main">
                    <div className="correction-title-line">
                      <span className="cell-mono">{order.ref || "Sans ref"}</span>
                      <StatusBadge status={order.status} size="sm" />
                      {isPartial && <span className="correction-warning">Quantites modifiees</span>}
                    </div>
                    <h3>{order.customerName}</h3>
                    <div className="correction-meta">
                      <span><MapPin size={12} /> {order.commune || "Commune non definie"}</span>
                      <span><User size={12} /> {order.deliverymanName || "Livreur non defini"}</span>
                      <span><Calendar size={12} /> {getUpdatedDate(order) ? formatDate(getUpdatedDate(order)) : "-"}</span>
                    </div>
                    {order.customerLocation && <p className="correction-address">{order.customerLocation}</p>}
                    {order.returnReason && <p className="correction-reason">Motif: {order.returnReason}</p>}
                  </div>

                  <div className="correction-money">
                    <span>Montant</span>
                    <strong>{formatPrice(getOrderTotal(order))}</strong>
                    {order.amountReceived !== null && order.amountReceived !== undefined && (
                      <small>Recu: {formatPrice(order.amountReceived)}</small>
                    )}
                  </div>

                  <div className="correction-items">
                    {(order.items || []).slice(0, 3).map((item, index) => (
                      <span key={`${item.name}-${index}`}>{item.name} {item.size}/{item.color} x{item.qty}</span>
                    ))}
                    {(order.items || []).length > 3 && <span>+{(order.items || []).length - 3} article(s)</span>}
                  </div>

                  <button
                    type="button"
                    className="correction-action"
                    onClick={() => setSelectedOrder(order)}
                    disabled={isPending}
                    title="Remettre en livraison"
                  >
                    <Undo2 size={16} />
                    Corriger
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selectedOrder && (
        <Modal
          isOpen
          onClose={() => {
            setSelectedOrder(null);
            setCorrectionNote("");
          }}
          title={`Correction ${selectedOrder.ref || ""}`}
          footer={
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setSelectedOrder(null);
                  setCorrectionNote("");
                }}
                disabled={isPending}
              >
                Annuler
              </button>
              <button type="button" className="btn-orange" onClick={handleCorrection} disabled={isPending || !correctionNote.trim()}>
                <Undo2 size={14} /> Remettre en livraison
              </button>
            </>
          }
        >
          <div className="correction-modal">
            <div className="correction-summary">
              <StatusBadge status={selectedOrder.status} size="sm" />
              <strong>{selectedOrder.customerName}</strong>
              <span>{selectedOrder.deliverymanName || "Livreur non defini"}</span>
            </div>
            <p>
              Cette action remet la commande en statut En livraison pour corriger une action faite par erreur.
              Elle restera tracee dans l&apos;historique de la commande.
            </p>
            {selectedOrder.status === "PARTIALLY_DELIVERED" && (
              <div className="partial-alert">
                <AlertTriangle size={16} />
                <span>Livraison partielle : les quantites et le stock deja modifies ne sont pas restaures automatiquement.</span>
              </div>
            )}
            <label className="field-label-sm" htmlFor="correction-note">Motif de correction obligatoire</label>
            <textarea
              id="correction-note"
              className="field-input correction-note"
              value={correctionNote}
              onChange={(event) => setCorrectionNote(event.target.value)}
              placeholder="Ex: le livreur a clique sur retour par erreur, client finalement disponible..."
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
