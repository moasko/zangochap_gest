"use client";

import React from "react";
import Modal from "@/components/Modal";
import { DetailCard, ItemLine } from "@/components/UI";
import { MessageCircle, Check } from "lucide-react";
import { formatPrice, formatDate } from "@/lib/constants";
import { ReminderMotif } from "./ReminderMotif";

type LogisticsHistoryEntry = {
  at?: string;
  action?: string;
  by?: string;
  byName?: string;
  [key: string]: unknown;
};

type NonPackedOrderItem = {
  color?: string | null;
  emoji?: string | null;
  image?: string | null;
  isGift?: boolean | null;
  name?: string | null;
  price?: number | null;
  qty?: number | null;
  size?: string | null;
};

type NonPackedOrder = {
  commune?: string | null;
  customerLocation?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  deliveryFee?: number | null;
  history?: unknown;
  id: string;
  items: NonPackedOrderItem[];
  motif?: string | null;
  motifs?: string[] | null;
  notes?: string | null;
  ref?: string | null;
  total?: number | null;
};

type NonPackedUser = {
  name?: string | null;
  role?: string | null;
};

interface NonPackedModalProps {
  order: NonPackedOrder | null;
  user: NonPackedUser | null;
  isPending: boolean;
  onClose: () => void;
  onStatusChange: (orderId: string, status: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  PENDING: "En attente",
  CONFIRMED: "Confirmee",
  PACKED: "Emballee",
  ON_DELIVERY: "En livraison",
  DELIVERED: "Livree",
  CANCELLED: "Annulee",
  RETURNED: "Retournee",
  REPROGRAMMED: "Reprogrammee",
  TO_PROCESS: "A traiter",
  REPRO_DISPO: "Reprogramme disponible",
  PARTIALLY_DELIVERED: "Partiellement livree",
  ALTERNATIVE: "Alternative proposee",
};

const DETAIL_LABELS: Record<string, string> = {
  amount: "Montant",
  amountReceived: "Montant recu",
  color: "Couleur",
  deliveryDate: "Date livraison",
  includeDeliveryFee: "Frais livraison",
  itemName: "Article",
  name: "Article",
  newStatus: "Nouveau statut",
  note: "Note",
  price: "Prix",
  productName: "Produit",
  qty: "Quantite",
  quantity: "Quantite",
  reason: "Motif",
  size: "Taille",
  status: "Statut",
  total: "Total",
  warehouseName: "Depot",
};

const COLLECTION_STATUS_LABELS: Record<string, string> = {
  alternative: "Alternative proposee",
  collected: "Collecte effectuee",
  unavailable: "Article indisponible",
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTechnicalKey(key: string) {
  const normalized = key.toLowerCase();
  return normalized === "id" || normalized.endsWith("id") || ["at", "action", "by", "byname"].includes(normalized);
}

function sanitizeHistoryText(value: unknown) {
  return String(value || "")
    .replace(/\b[a-z0-9_-]{20,}\b/gi, "reference interne")
    .trim();
}

function formatHistoryAction(action: unknown) {
  const rawAction = sanitizeHistoryText(action);
  if (!rawAction) return "Evenement logistique";

  const collectionMatch = rawAction.match(/(?:^.+?\s+a\s+)?COLLECTION_STATUS:([a-z_]+)\s+(.+)$/i);
  if (collectionMatch) {
    const status = collectionMatch[1].toLowerCase();
    const readableStatus = COLLECTION_STATUS_LABELS[status] || "Collecte mise a jour";
    const details = collectionMatch[2]
      .replace(/\s*\[ITEM_ID:[^\]]*\]\s*/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    const product = details.split(":").pop()?.trim();
    const noteMatch = details.match(/\(([^)]+)\)/);
    const note = noteMatch?.[1]?.trim();

    return [readableStatus, product && product !== details ? product : null, note && note !== product ? note : null]
      .filter(Boolean)
      .join(" : ");
  }

  const statusMatch = rawAction.match(/Statut\s*(?:->|→)\s*([A-Z_]+)/i);
  if (statusMatch) {
    const status = statusMatch[1].toUpperCase();
    return `Statut mis a jour : ${STATUS_LABELS[status] || status}`;
  }

  return rawAction.replace(/\b([A-Z_]{3,})\b/g, (match) => STATUS_LABELS[match] || match);
}

function formatHistoryActor(entry: LogisticsHistoryEntry) {
  const actor = sanitizeHistoryText(entry.byName);
  if (actor) return actor;

  const by = sanitizeHistoryText(entry.by);
  if (by && !by.includes("@")) return by;

  return "Systeme Zango";
}

function formatHistoryValue(key: string, value: unknown) {
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "number") return ["amount", "amountReceived", "price", "total"].includes(key) ? formatPrice(value) : String(value);

  const text = sanitizeHistoryText(value);
  if (!text) return "";
  if (key === "status" || key === "newStatus") return STATUS_LABELS[text] || text;

  const parsedDate = key.toLowerCase().includes("date") ? new Date(text) : null;
  if (parsedDate && !Number.isNaN(parsedDate.getTime())) return formatDate(text);

  return text;
}

function getHistoryDetails(entry: LogisticsHistoryEntry) {
  return Object.entries(entry).flatMap(([key, value]) => {
    if (isTechnicalKey(key) || value === null || value === undefined || value === "") return [];
    if (Array.isArray(value)) {
      return value.length > 0 ? [{ label: DETAIL_LABELS[key] || key, value: `${value.length} element(s)` }] : [];
    }
    if (isPlainRecord(value)) return [];

    const formattedValue = formatHistoryValue(key, value);
    return formattedValue ? [{ label: DETAIL_LABELS[key] || key, value: formattedValue }] : [];
  });
}

export default function NonPackedModal({
  order,
  user,
  isPending,
  onClose,
  onStatusChange
}: NonPackedModalProps) {
  if (!order) return null;

  const isAdmin = user?.role?.toLowerCase() === "admin" || user?.role?.toLowerCase() === "developer";
  const logisticsHistory: LogisticsHistoryEntry[] = Array.isArray(order.history) ? order.history : [];
  const orderMotifs = order.motifs || [];

  const handleWhatsApp = () => {
    const phone = (order.customerPhone || '').replace(/[^0-9]/g, '');
    const formattedPhone = phone.startsWith('0') ? '225' + phone.substring(1) : (phone.startsWith('225') ? phone : '225' + phone);
    
    const itemsText = order.items.map((i) => {
      const qty = i.qty || 0;
      const price = i.price || 0;
      return `• *${i.name || "Article"}*\n   Taille : ${i.size || "-"} | Couleur : ${i.color || "-"}\n   Quantité : ${qty} — ${formatPrice(price * qty)}`;
    }).join('\n\n');

    const totalPayer = (order.total || 0) + (order.deliveryFee || 0);

    const msg = `🛍️ *ZANGOCHAP — Suivi Commande*\n\n` +
      `Bonjour *${order.customerName}*,\n\n` +
      `Je reviens vers vous concernant votre commande *${order.ref}*. Voici le récapitulatif actuel :\n\n` +
      `━━━━━━━━━━━━━━━━━━\n` +
      `*ARTICLES*\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `${itemsText}\n\n` +
      `💰 *Total à payer :* ${formatPrice(totalPayer)}\n` +
      `━━━━━━━━━━━━━━━━━━\n\n` +
      `⚠️ *Note :* ${order.motif || 'En cours de traitement'}\n\n` +
      `Merci pour votre confiance ! 🧡\n\n` +
      `_${user?.name || 'L\'équipe'} — Zangochap_`;

    window.open(`https://wa.me/${formattedPhone}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  return (
    <Modal
      isOpen={true}
      onClose={onClose}
      title={`Détail · ${order.ref}`}
      large
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Fermer</button>
          <button 
            className="btn-whatsapp" 
            onClick={handleWhatsApp}
            style={{ 
              background: '#25D366', 
              color: 'white', 
              border: 'none', 
              padding: '10px 20px', 
              borderRadius: 12, 
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}
          >
            <MessageCircle size={16} /> Relance WhatsApp
          </button>
          {isAdmin && (
            <button className="btn-orange" onClick={() => onStatusChange(order.id, 'CONFIRMED')} disabled={isPending}>
              <Check size={16} /> Marquer Traitée
            </button>
          )}
        </>
      }
    >
      <div className="order-detail-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
        <div>
          <DetailCard label="Client">
            <div style={{ fontWeight: 600, fontSize: 15 }}>{order.customerName}</div>
            <div className="cell-muted" style={{ marginTop: 4 }}>{order.customerPhone}</div>
            <div className="cell-muted" style={{ marginTop: 4 }}>{order.customerLocation} ({order.commune})</div>
          </DetailCard>

          <div style={{ marginTop: 14 }}>
            <DetailCard label="Articles">
              {order.items.map((item, i) => (
                <ItemLine
                  key={i}
                  emoji={item.emoji || undefined}
                  image={item.image || undefined}
                  name={item.name || "Article"}
                  meta={`Taille ${item.size || "-"} · ${item.color || "-"} · Qté ${item.qty || 0}`}
                  price={formatPrice((item.price || 0) * (item.qty || 0))}
                  isGift={Boolean(item.isGift)}
                />
              ))}
            </DetailCard>
          </div>
        </div>

        <div>
          <DetailCard label="Historique Logistique">
            <div className="non-packed-history-list">
              {logisticsHistory.length === 0 ? (
                <div className="non-packed-history-empty">Aucun evenement logistique enregistre.</div>
              ) : logisticsHistory.slice().reverse().map((h, i) => {
                const details = getHistoryDetails(h);
                return (
                  <div key={`${h.at || "history"}-${i}`} className="non-packed-history-entry">
                    <div className="non-packed-history-dot" />
                    <div className="non-packed-history-content">
                      <div className="non-packed-history-action">{formatHistoryAction(h.action)}</div>
                      <div className="non-packed-history-meta">
                        <span>{formatHistoryActor(h)}</span>
                        <span>{h.at ? formatDate(h.at) : "Date non renseignee"}</span>
                      </div>
                      {details.length > 0 && (
                        <div className="non-packed-history-details">
                          {details.map((detail) => (
                            <span key={`${detail.label}-${detail.value}`}>
                              <strong>{detail.label}</strong>
                              {detail.value}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </DetailCard>
          
          {order.notes && (
            <div style={{ marginTop: 14 }}>
              <DetailCard label="Notes">
                <div style={{ fontSize: 12 }}>{order.notes}</div>
              </DetailCard>
            </div>
          )}
          
          {order.motif && (
            <div style={{ marginTop: 14 }}>
              <ReminderMotif motif={order.motif} motifs={orderMotifs} />
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
