"use client";

import React, { useState, useEffect } from "react";
import {
  X, Phone, MessageCircle, Package,
  Check, RotateCcw, ChevronRight, MapPin, Banknote, CheckCircle2,
  AlertCircle, Users, CheckSquare, Square, Send, CalendarClock, StickyNote, Headset
} from "lucide-react";
import { motion } from "framer-motion";
import { formatPrice } from "@/lib/constants";
import { StatusBadge } from "./StatusBadge";
import { RiderOrder, RiderOrderItem } from "../types";
import { calculateOrderCollectionTotal, calculateOrderDueTotal } from "../utils";

// ── Constants ────────────────────────────────────────────────
const QUICK_MESSAGES = [
  "Bonjour, je suis en route pour votre livraison (5-10 min).",
  "Bonjour, je suis arrivé devant chez vous.",
  "Je ne trouve pas votre adresse, pouvez-vous m'aider ?",
  "Votre téléphone ne passe pas, je suis à votre porte.",
];


const PARTIAL_REASONS = [
  "Article manquant",
  "Taille/Couleur incorrecte",
  "Client ne veut plus cet article",
  "Article abîmé",
];

// ── Types ────────────────────────────────────────────────────
const SUPPORT_REASONS = [
  "Client ne repond pas",
  "Adresse confuse",
  "Client demande confirmation",
  "Montant conteste",
  "Besoin d'aide urgent",
  "Autre",
];

interface OrderDetailsSheetProps {
  order: RiderOrder;
  onClose: () => void;
  partialMode: boolean;
  setPartialMode: (v: boolean) => void;
  includeDeliveryFee: boolean;
  setIncludeDeliveryFee: (v: boolean) => void;
  deliveredQuantities: Record<string, number>;
  updateItemQty: (id: string, qty: number) => void;
  returnReasons: Record<string, string>;
  updateReturnReason: (id: string, reason: string) => void;
  partialSummary: { subtotal: number; total: number; fee: number };
  onStatusUpdate: (id: string, status: string, amountReceived?: number) => void;
  onPartialConfirm: (amountReceived?: number) => void;
  onSupportAlert: (orderId: string, reason: string, details?: string) => void;
  isPending: boolean;
}

// ── Main Component ───────────────────────────────────────────
export function OrderDetailsSheet({
  order,
  onClose,
  partialMode,
  setPartialMode,
  includeDeliveryFee,
  setIncludeDeliveryFee,
  deliveredQuantities,
  updateItemQty,
  returnReasons,
  updateReturnReason,
  partialSummary,
  onStatusUpdate,
  onPartialConfirm,
  onSupportAlert,
  isPending,
}: OrderDetailsSheetProps) {
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportReason, setSupportReason] = useState("");
  const [supportDetails, setSupportDetails] = useState("");
  
  useEffect(() => {
    setCheckedItems({});
  }, [order.id]);

  const collectionTotal = calculateOrderCollectionTotal(order);
  const dueTotal = calculateOrderDueTotal(order);
  const expectedAmount = partialMode ? partialSummary.total : dueTotal;
  const [amountReceived, setAmountReceived] = useState(expectedAmount);
  const normalizedAmountReceived = Math.max(0, Math.trunc(Number(amountReceived) || 0));
  const hasCustomAmount = normalizedAmountReceived !== expectedAmount;

  useEffect(() => {
    setAmountReceived(order.amountReceived ?? expectedAmount);
  }, [order.id, order.amountReceived, expectedAmount]);
  const deliveryDay = order.deliveryDate
    ? new Date(order.deliveryDate).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
    : "Aujourd'hui";
  const hasIssueReason = ["RETURNED", "CANCELLED", "REPRO_DISPO"].includes(order.status) && order.returnReason;
  const isClosed = ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "CANCELLED", "REPRO_DISPO"].includes(order.status);
  const deliveredCount = order.items.reduce(
    (sum, item) => sum + (deliveredQuantities[item.id] || 0),
    0
  );

  const allChecked = order.items.every(item => checkedItems[item.id]);

  const toggleCheck = (id: string) => {
    setCheckedItems(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const openWhatsApp = (msg?: string) => {
    let p = order.customerPhone.replace(/\D/g, "");
    if (p.startsWith("0")) p = "225" + p.slice(1);
    else if (!p.startsWith("225")) p = "225" + p;
    
    const text = msg || `Bonjour ${order.customerName}, votre livreur ZangoChap est en route.`;
    window.open(`https://wa.me/${p}?text=${encodeURIComponent(text)}`, "_blank");
  };

  const handleSupportSubmit = () => {
    if (!supportReason) return;
    onSupportAlert(order.id, supportReason, supportDetails);
    setSupportOpen(false);
    setSupportReason("");
    setSupportDetails("");
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
      />

      {/* Sheet */}
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="relative z-10 w-full max-w-md h-[92dvh] bg-[#F3F4F6] rounded-t-sm flex flex-col overflow-hidden border-t border-[#E5E7EB]"
      >
        {/* ── Header ── */}
        <div className="shrink-0 px-3 pt-2 pb-3 bg-white border-b border-[#F3F4F6]">
          <div className="flex justify-center mb-2">
            <div className="w-10 h-1 rounded-sm bg-[#E5E7EB]" />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="w-9 h-9 flex items-center justify-center rounded-md bg-[#F3F4F6] text-[#111827] active:scale-90 transition-transform"
              >
                <X size={18} />
              </button>
              <div>
                <h2 className="text-[16px] font-bold text-[#111827] leading-none mb-1">
                  Commande #{order.ref}
                </h2>
                <div className="flex items-center gap-1.5">
                  <MapPin size={11} className="text-[#334155]" />
                  <span className="text-[11px] font-bold text-[#334155]">{order.commune} · {deliveryDay}</span>
                </div>
                <p className="mt-1 max-w-[190px] text-[11px] font-semibold leading-snug text-[#64748B] line-clamp-2">
                  {order.customerLocation || "Lieu exact non renseigné"}
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <StatusBadge status={order.status} />
              {order.isCommercialContacted && (
                <span className="flex items-center gap-1 text-[9px] font-bold text-[#166534] uppercase bg-[#166534]/10 px-1.5 py-0.5 rounded border border-[#166534]/10">
                  <CheckCircle2 size={9} /> Contacté
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Scrollable Content ── */}
        <div className="flex-1 overflow-y-auto overscroll-contain pb-32">
          <div className="p-2.5 space-y-2">
            
            {/* Quick Actions Card */}
            <div className="bg-white rounded-sm p-2.5 border border-[#E5E7EB] space-y-2">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <h3 className="text-[16px] font-extrabold text-[#111827] truncate mb-0.5">
                    {order.customerName}
                  </h3>
                  <p className="text-[13px] font-semibold text-[#6B7280]">
                    {order.customerPhone}
                  </p>
                  {order.customerPhone2 && (
                    <p className="text-[11px] font-semibold text-[#94A3B8]">
                      Secondaire: {order.customerPhone2}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <a
                    href={`tel:${order.customerPhone}`}
                    className="w-10 h-10 rounded-md bg-[#F3F4F6] flex items-center justify-center text-[#111827] active:scale-90 transition-transform"
                  >
                    <Phone size={16} strokeWidth={2.5} />
                  </a>
                  <button
                    onClick={() => openWhatsApp()}
                    className="w-10 h-10 rounded-md bg-[#166534]/10 flex items-center justify-center text-[#166534] active:scale-90 transition-transform"
                  >
                    <MessageCircle size={16} strokeWidth={2.5} />
                  </button>
                </div>
              </div>

              {/* Quick WhatsApp Messages */}
              <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                {QUICK_MESSAGES.map((msg, i) => (
                  <button
                    key={i}
                    onClick={() => openWhatsApp(msg)}
                    className="shrink-0 px-3 py-2 bg-[#F3F4F6] rounded-md text-[10px] font-bold text-[#111827] flex items-center gap-2 active:bg-[#E5E7EB] transition-colors"
                  >
                    <Send size={10} className="text-[#9CA3AF]" />
                    {msg.split(",")[1]?.trim() || msg.split(".")[0]}...
                  </button>
                ))}
              </div>

            </div>

            <div className="bg-[#0F172A] rounded-sm p-3 border border-[#1E293B] text-white space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-[#FDBA74]">
                    <Headset size={14} />
                    Call center
                  </div>
                  <p className="mt-1 text-[12px] font-semibold leading-relaxed text-white/70">
                    Alertez le bureau sans appel telephonique.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSupportOpen(true)}
                  disabled={isPending}
                  className="shrink-0 rounded-sm bg-[#FF6B2C] px-3 py-2 text-[12px] font-black text-white active:scale-95 disabled:opacity-50"
                >
                  Alerter
                </button>
              </div>
              {order.commercial && (
                <div className="rounded-sm border border-white/10 bg-white/5 px-2.5 py-2 text-[11px] font-bold text-white/75">
                  Destinataire: {order.commercial.name}
                </div>
              )}
            </div>

            {/* Checklist Info Banner */}
            {!allChecked && !partialMode && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[#B45309]/10 border border-[#B45309]/20 rounded-md p-3 flex items-center gap-3"
              >
                <CheckSquare size={18} className="text-[#B45309] shrink-0" />
                <p className="text-[12px] font-bold text-[#B45309]">
                  Cochez les articles pour activer la livraison.
                </p>
              </motion.div>
            )}

            {/* Notes Section (Moved up for priority) */}
            {(order.deliveryNote || order.notes || hasIssueReason) && (
              <div className="bg-white rounded-sm p-2.5 border border-[#E5E7EB] space-y-2">
                <div className="flex items-center gap-2 px-0.5">
                  <div className="w-7 h-7 rounded bg-[#F8FAFC] flex items-center justify-center text-[#475569] border border-[#E2E8F0]">
                    <StickyNote size={14} />
                  </div>
                  <span className="text-[11px] font-black text-[#111827] uppercase tracking-wider">
                    Notes importantes
                  </span>
                </div>

                <div className="space-y-2.5">
                  {order.deliveryNote && (
                    <NoteRow
                      icon={<AlertCircle size={13} />}
                      label="Note de livraison"
                      value={order.deliveryNote}
                      tone="priority"
                    />
                  )}
                  {order.notes && (
                    <NoteRow
                      icon={<StickyNote size={13} />}
                      label="Note commande"
                      value={order.notes}
                    />
                  )}
                  {hasIssueReason && (
                    <NoteRow
                      icon={<AlertCircle size={13} />}
                      label="Motif enregistré"
                      value={order.returnReason || ""}
                      tone="warning"
                    />
                  )}
                </div>
              </div>
            )}

            {/* Items Section */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <span className="text-[11px] font-black text-[#6B7280] uppercase tracking-[0.1em]">
                  Articles ({order.items.length})
                </span>
                <button
                  onClick={() => setPartialMode(!partialMode)}
                  className={`text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded transition-all border ${
                    partialMode
                      ? "bg-[#B91C1C] text-white border-[#B91C1C] shadow-sm shadow-red-100"
                      : "bg-white text-[#334155] border-[#334155]/30"
                  }`}
                >
                  {partialMode ? "Annuler Partiel" : "Mode Partiel"}
                </button>
              </div>

              {order.items.map((item: RiderOrderItem, idx) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  index={idx}
                  partialMode={partialMode}
                  deliveredQty={deliveredQuantities[item.id] ?? 0}
                  onQtyChange={(qty) => updateItemQty(item.id, qty)}
                  reason={returnReasons[item.id]}
                  onReasonChange={(reason) => updateReturnReason(item.id, reason)}
                  checked={checkedItems[item.id] || false}
                  onCheck={() => toggleCheck(item.id)}
                />
              ))}
            </div>

            {/* Amount Card */}
            <div className="bg-white rounded-sm p-3 border border-[#E5E7EB] relative overflow-hidden">
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold text-[#6B7280] uppercase tracking-[0.1em]">
                    {partialMode ? "Encaissement Partiel" : "Montant à Encaisser"}
                  </span>
                  <div className="flex items-center gap-1.5 text-[#166534] bg-[#166534]/10 px-2.5 py-0.5 rounded border border-[#166534]/10">
                    <Banknote size={12} />
                    <span className="text-[9px] font-black uppercase">Cash</span>
                  </div>
                </div>
                <p className="text-[24px] font-black tracking-tight text-[#111827] tabular-nums leading-none mb-4">
                  {formatPrice(collectionTotal)}
                </p>
                {!isClosed && (
                  <div className="mb-4 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                    <label className="text-[10px] font-black uppercase tracking-wider text-[#6B7280]">
                      Montant reçu du client
                    </label>
                    <div className="mt-2 flex items-center gap-2">
                      <input
                        type="number"
                        min={0}
                        value={amountReceived}
                        onChange={(event) => setAmountReceived(Number(event.target.value))}
                        className="h-10 flex-1 rounded-sm border border-[#E5E7EB] bg-white px-3 text-[16px] font-black text-[#111827] outline-none focus:border-[#166534]"
                      />
                      <span className="text-[12px] font-black text-[#6B7280]">F</span>
                    </div>
                    <p className={`mt-2 text-[10px] font-bold ${hasCustomAmount ? "text-[#B45309]" : "text-[#9CA3AF]"}`}>
                      Attendu : {formatPrice(expectedAmount)}
                    </p>
                  </div>
                )}
                <div className="flex items-center justify-between pt-4 border-t border-[#F3F4F6]">
                  <span className="text-[12px] font-semibold text-[#9CA3AF]">
                    Livraison : {formatPrice(order.deliveryFee)}
                  </span>
                  {partialMode && (
                    <button
                      onClick={() => setIncludeDeliveryFee(!includeDeliveryFee)}
                      className={`text-[9px] font-black uppercase tracking-wider px-2.5 py-1.5 rounded transition-all ${
                        includeDeliveryFee
                          ? "bg-[#166534] text-white shadow-sm"
                          : "bg-[#F3F4F6] text-[#9CA3AF]"
                      }`}
                    >
                      {includeDeliveryFee ? "Livraison Incluse" : "Exclure Frais"}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Preparation Team Section */}
            <div className="bg-white rounded-sm p-2.5 border border-[#E5E7EB] space-y-2">
              <div className="flex items-center gap-2 px-0.5">
                <div className="w-7 h-7 rounded bg-[#EFF6FF] flex items-center justify-center text-[#1E40AF]">
                  <Users size={14} />
                </div>
                <span className="text-[11px] font-black text-[#111827] uppercase tracking-wider">
                  Équipe Préparation
                </span>
              </div>

              <div className="space-y-2.5">
                {order.commercial && (
                  <StaffRow label="Commercial" name={order.commercial.name} phone={order.commercial.phone} />
                )}
                {order.packer && (
                  <StaffRow label="Emballeur" name={order.packer.name} phone={order.packer.phone} />
                )}
                {order.collectors?.map((c, i) => (
                  <StaffRow key={i} label="Collecteur" name={c.name} phone={c.phone} />
                ))}
                {(!order.commercial && !order.packer && (!order.collectors || order.collectors.length === 0)) && (
                  <p className="text-[11px] font-semibold text-[#9CA3AF] italic text-center py-2">
                    Aucune info équipe
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Fixed Action Bar ── */}
        <div
          className="absolute bottom-0 left-0 right-0 p-3 bg-white border-t border-[#F3F4F6]"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 16px) + 8px)" }}
        >
          {isClosed ? (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-[#6B7280]">Mission clôturée</p>
                <div className="mt-1"><StatusBadge status={order.status} /></div>
              </div>
              <button
                onClick={onClose}
                className="h-11 px-4 rounded-sm bg-[#111827] text-white text-[13px] font-black"
              >
                Fermer
              </button>
            </div>
          ) : !partialMode ? (
            <div className="flex gap-3">
              <button
                disabled={isPending || !allChecked}
                onClick={() => onStatusUpdate(order.id, "DELIVERED", normalizedAmountReceived)}
                className="flex-[4] h-12 bg-[#166534] rounded-sm text-white font-black text-[15px] flex items-center justify-center gap-2.5 active:scale-[0.98] transition-all disabled:opacity-40 disabled:grayscale"
              >
                {isPending ? (
                  <div className="w-5 h-5 border-[3px] border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <Check size={20} strokeWidth={3} /> 
                    {!allChecked ? "VÉRIFIEZ LES ARTICLES" : "TOUT LIVRÉ"}
                  </>
                )}
              </button>
              
              <button
                disabled={isPending}
                onClick={() => onStatusUpdate(order.id, "RETURNED")}
                className="flex-1 h-14 bg-[#B91C1C]/10 rounded-md text-[#B91C1C] flex items-center justify-center active:scale-[0.98] transition-all border border-[#B91C1C]/10 disabled:opacity-40"
                title="Retour"
              >
                <RotateCcw size={20} strokeWidth={2.5} />
              </button>
              <button
                disabled={isPending}
                onClick={() => onStatusUpdate(order.id, "REPRO_DISPO")}
                className="flex-1 h-14 bg-[#B45309]/10 rounded-md text-[#B45309] flex items-center justify-center active:scale-[0.98] transition-all border border-[#B45309]/10 disabled:opacity-40"
                title="Repro-dispo demain"
              >
                <CalendarClock size={20} strokeWidth={2.5} />
              </button>
            </div>
          ) : (
            <button
              disabled={isPending || deliveredCount === 0}
              onClick={() => onPartialConfirm(normalizedAmountReceived)}
              className="w-full h-12 bg-[#B45309] rounded-sm text-white font-black text-[15px] flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-40"
            >
              {isPending ? (
                <div className="w-5 h-5 border-[3px] border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  CONFIRMER PARTIEL · {formatPrice(normalizedAmountReceived)}
                  <ChevronRight size={18} strokeWidth={3} />
                </>
              )}
            </button>
          )}
        </div>

        {supportOpen && (
          <div className="absolute inset-0 z-[160] flex items-end justify-center">
            <button
              type="button"
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setSupportOpen(false)}
              aria-label="Fermer"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              className="relative z-10 w-full rounded-t-sm bg-white p-4 border-t border-[#E5E7EB]"
            >
              <div className="mx-auto mb-4 h-1 w-10 rounded-sm bg-[#E5E7EB]" />
              <div className="mb-4 flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm bg-[#0F172A] text-white">
                  <Headset size={19} />
                </div>
                <div>
                  <h3 className="text-[18px] font-black text-[#111827]">Alerter le call center</h3>
                  <p className="mt-1 text-[12px] font-semibold leading-relaxed text-[#64748B]">
                    Le message part dans le chat interne avec les infos de cette commande.
                  </p>
                </div>
              </div>

              <div className="mb-3 grid grid-cols-2 gap-2">
                {SUPPORT_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setSupportReason(reason)}
                    className={`min-h-10 rounded-sm border px-2.5 py-2 text-left text-[11px] font-black transition-colors ${
                      supportReason === reason
                        ? "border-[#0F172A] bg-[#0F172A] text-white"
                        : "border-[#E5E7EB] bg-[#F8FAFC] text-[#334155]"
                    }`}
                  >
                    {reason}
                  </button>
                ))}
              </div>

              <textarea
                value={supportDetails}
                onChange={(event) => setSupportDetails(event.target.value)}
                maxLength={500}
                placeholder="Detail utile pour le bureau..."
                className="min-h-20 w-full resize-none rounded-sm border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 text-[13px] font-semibold text-[#111827] outline-none focus:border-[#334155]"
              />
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setSupportOpen(false)}
                  className="flex-1 rounded-sm bg-[#F3F4F6] py-2.5 text-[13px] font-bold text-[#374151]"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleSupportSubmit}
                  disabled={!supportReason || isPending}
                  className="flex-[1.4] rounded-sm bg-[#FF6B2C] py-2.5 text-[13px] font-black text-white disabled:opacity-50"
                >
                  Envoyer l&apos;alerte
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ── Item Row Sub-component ───────────────────────────────────
function ItemRow({
  item,
  index,
  partialMode,
  deliveredQty,
  onQtyChange,
  reason,
  onReasonChange,
  checked,
  onCheck,
}: {
  item: RiderOrderItem;
  index: number;
  partialMode: boolean;
  deliveredQty: number;
  onQtyChange: (qty: number) => void;
  reason?: string;
  onReasonChange: (reason: string) => void;
  checked: boolean;
  onCheck: () => void;
}) {
  const isExcluded = partialMode && deliveredQty === 0;
  const isPartial = partialMode && deliveredQty < item.qty && deliveredQty > 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`bg-white rounded-sm p-2.5 border transition-all ${
        isExcluded ? "opacity-50 grayscale border-[#E5E7EB]" : "border-[#E5E7EB]"
      } ${isPartial ? "border-[#FDE68A] bg-[#FFFBEB]" : ""} ${checked && !partialMode ? "bg-[#166534]/5 border-[#166534]/20" : ""}`}
    >
      <div className="flex gap-3">
        {!partialMode && (
          <button 
            onClick={onCheck}
            className={`w-10 h-14 rounded-md flex items-center justify-center transition-all ${
              checked ? "bg-[#166534] text-white" : "bg-[#F3F4F6] text-[#9CA3AF] border border-[#E5E7EB]"
            }`}
          >
            {checked ? <CheckSquare size={20} /> : <Square size={20} />}
          </button>
        )}

        <div className="w-14 h-14 rounded-md overflow-hidden bg-[#F3F4F6] shrink-0 flex items-center justify-center border border-[#E5E7EB]">
          {item.image ? (
            <img src={item.image} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <Package size={20} className="text-[#9CA3AF]" />
          )}
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-start justify-between gap-2 mb-0.5">
            <p className={`text-[14px] font-bold truncate ${isExcluded ? "line-through text-[#9CA3AF]" : "text-[#111827]"}`}>
              {item.name}
            </p>
            <p className="text-[13px] font-black text-[#111827] tabular-nums whitespace-nowrap">
              {formatPrice(item.price * (partialMode ? deliveredQty : item.qty))}
            </p>
          </div>
          <p className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-wider">
            {item.size} · {item.color} · ×{item.qty}
          </p>
        </div>
      </div>

      {partialMode && (
        <div className="mt-4 space-y-3.5 pt-3.5 border-t border-[#F3F4F6]">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-[#9CA3AF]">
              Quantité livrée
            </span>
            <div className="flex items-center gap-1 bg-[#F3F4F6] rounded p-1">
              <button
                onClick={() => onQtyChange(Math.max(0, deliveredQty - 1))}
                disabled={deliveredQty === 0}
                className="w-8 h-8 rounded bg-white flex items-center justify-center text-[#111827] text-base font-black shadow-sm disabled:opacity-30 active:scale-90 transition-transform"
              >
                −
              </button>
              <span className="w-8 text-center text-[14px] font-black text-[#111827] tabular-nums">{deliveredQty}</span>
              <button
                onClick={() => onQtyChange(Math.min(item.qty, deliveredQty + 1))}
                disabled={deliveredQty === item.qty}
                className="w-8 h-8 rounded bg-[#334155] flex items-center justify-center text-white text-base font-black shadow-sm disabled:opacity-30 active:scale-90 transition-transform"
              >
                +
              </button>
            </div>
          </div>

          {deliveredQty < item.qty && (
            <div className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-[#9CA3AF] block">
                Motif {deliveredQty === 0 ? "du refus" : "du partiel"}
              </span>
              <div className="flex gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                {PARTIAL_REASONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => onReasonChange(r)}
                    className={`px-3 py-1.5 rounded-md text-[10px] font-bold whitespace-nowrap transition-all border ${
                      reason === r ? "bg-[#111827] text-white border-[#111827]" : "bg-white text-[#6B7280] border-[#E5E7EB]"
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

// ── Staff Row Sub-component ───────────────────────────────────
function NoteRow({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone?: "neutral" | "priority" | "warning";
}) {
  const toneClass = tone === "warning"
    ? "bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]"
    : tone === "priority"
      ? "bg-[#F8FAFC] border-[#CBD5E1] text-[#334155]"
      : "bg-[#F8FAFC] border-[#E2E8F0] text-[#475569]";

  return (
    <div className={`rounded-md border px-3 py-2.5 ${toneClass}`}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[9px] font-black uppercase tracking-[0.1em]">{label}</span>
      </div>
      <p className="text-[13px] font-semibold leading-relaxed text-[#111827]">{value}</p>
    </div>
  );
}

function StaffRow({ label, name, phone }: { label: string; name: string; phone: string | null }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[#F3F4F6] last:border-0">
      <div className="min-w-0">
        <span className="text-[9px] font-black uppercase tracking-wider text-[#9CA3AF] block">{label}</span>
        <p className="text-[13px] font-bold text-[#111827] truncate">{name}</p>
      </div>
      {phone && (
        <a
          href={`tel:${phone}`}
          className="w-8 h-8 rounded bg-[#F3F4F6] flex items-center justify-center text-[#111827] active:scale-90 transition-transform"
        >
          <Phone size={13} strokeWidth={2.5} />
        </a>
      )}
    </div>
  );
}
