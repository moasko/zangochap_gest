"use client";

import { AlertTriangle, CalendarDays, MapPin, Package, ChevronRight, StickyNote, UserRound } from "lucide-react";
import { motion } from "framer-motion";
import { formatPrice } from "@/lib/constants";
import { StatusBadge } from "./StatusBadge";
import { RiderOrder } from "../types";
import { calculateOrderCollectionTotal } from "../utils";

interface OrderCardProps {
  order: RiderOrder;
  onClick: () => void;
  index?: number;
}

export function OrderCard({ order, onClick, index = 0 }: OrderCardProps) {
  const paid = ["DELIVERED", "PARTIALLY_DELIVERED"].includes(order.status);
  const issue = ["RETURNED", "CANCELLED", "REPRO_DISPO"].includes(order.status);
  const active = ["PACKED", "ON_DELIVERY"].includes(order.status);
  const dateValue = paid ? order.deliveredAt || order.deliveryDate : issue ? order.lastDeliveryAttemptAt || order.deliveryDate : order.deliveryDate;
  const date = dateValue ? new Date(dateValue) : null;
  const dateLabel = date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "Africa/Abidjan" })
    : "Date non précisée";
  const overdue = active && order.deliveryDate && order.deliveryDate.slice(0, 10) < new Date().toISOString().slice(0, 10);
  const quantity = order.items.reduce((sum, item) => sum + item.qty, 0);
  const note = issue ? order.returnReason || "Motif non renseigné" : order.deliveryNote || order.notes;
  const tone = overdue || issue ? "attention" : paid ? "completed" : "active";

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, delay: Math.min(index, 4) * 0.025 }}>
      <button type="button" onClick={onClick} aria-label={`Ouvrir la commande ${order.ref}, ${order.customerName}`} className={`rider-order-card rider-delivery-card ${tone}`}>
        <div className="rider-card-heading">
          <span className="rider-card-reference">#{order.ref}</span>
          <StatusBadge status={order.status} />
        </div>
        <div className="rider-card-address">
          <MapPin size={17} aria-hidden="true" />
          <div>
            <h3>{order.commune || "Commune non renseignée"}</h3>
            <p>{order.customerLocation || "Adresse à préciser"}</p>
          </div>
        </div>
        <div className="rider-card-customer">
          <UserRound size={13} aria-hidden="true" /><span>{order.customerName}</span>
          {overdue && <strong>En retard</strong>}
        </div>
        {note && <div className={`rider-card-note ${issue ? "has-issue" : ""}`}>
          {issue ? <AlertTriangle size={13} aria-hidden="true" /> : <StickyNote size={13} aria-hidden="true" />}
          <span>{note}</span>
        </div>}
        <div className="rider-card-footer">
          <div className="rider-card-meta">
            <span><CalendarDays size={12} aria-hidden="true" />{dateLabel}</span>
            <span><Package size={12} aria-hidden="true" />{quantity} article{quantity > 1 ? "s" : ""}</span>
          </div>
          <div className="rider-card-amount">
            <span>{paid ? "Encaissé" : issue ? "Montant commande" : "À encaisser"}</span>
            <strong>{formatPrice(calculateOrderCollectionTotal(order))}</strong>
          </div>
          <ChevronRight size={17} className="rider-card-chevron" aria-hidden="true" />
        </div>
      </button>
    </motion.div>
  );
}
