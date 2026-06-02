"use client";

import React, { useState, useTransition, useMemo, useCallback } from "react";
import {
  Phone, MessageCircle, Check, MapPin, Clock, Search, Navigation,
  X, ArrowRight, Package, AlertCircle, User, FileText, Tag,
  ChevronRight, TrendingUp, Banknote, CheckCircle2, AlertTriangle,
  RotateCcw, History, LayoutDashboard, CalendarClock
} from "lucide-react";
import { formatPrice, formatDate } from "@/lib/constants";
import { updateOrderStatus, markPartialDelivery } from "@/modules/orders/actions";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { motion, AnimatePresence } from "framer-motion";

// ─── Constants ────────────────────────────────────────────────────────
const ACCENT_COLOR = "#FF6B00";
const NEON_GREEN = "#00FF94";
const OBSIDIAN = "#0A0A0B";
const CARD_BG = "#141416";
const SLATE = {
  50: "#1A1A1E",
  100: "#242429",
  200: "#2F2F37",
  300: "#40404C",
  400: "#71717A",
  500: "#A1A1AA",
  600: "#D4D4D8",
  700: "#E4E4E7",
  800: "#F4F4F5",
  900: "#FFFFFF",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; dot: string; pulse?: boolean }> = {
  DELIVERED: { label: "Livré", color: NEON_GREEN, bg: "rgba(0, 255, 148, 0.1)", border: "rgba(0, 255, 148, 0.2)", dot: NEON_GREEN },
  RETURNED: { label: "Retour", color: "#FF4D4D", bg: "rgba(255, 77, 77, 0.1)", border: "rgba(255, 77, 77, 0.2)", dot: "#FF4D4D" },
  CANCELLED: { label: "Annulé", color: "#FF4D4D", bg: "rgba(255, 77, 77, 0.1)", border: "rgba(255, 77, 77, 0.2)", dot: "#FF4D4D" },
  PENDING: { label: "En cours", color: "#FACC15", bg: "rgba(250, 204, 21, 0.1)", border: "rgba(250, 204, 21, 0.2)", dot: "#FACC15", pulse: true },
  IN_TRANSIT: { label: "En route", color: "#38BDF8", bg: "rgba(56, 189, 248, 0.1)", border: "rgba(56, 189, 248, 0.2)", dot: "#38BDF8", pulse: true },
  REPRO_DISPO: { label: "Repro-dispo", color: "#FACC15", bg: "rgba(250, 204, 21, 0.1)", border: "rgba(250, 204, 21, 0.2)", dot: "#FACC15" },
  PARTIALLY_DELIVERED: { label: "Partiel", color: "#2DD4BF", bg: "rgba(45, 212, 191, 0.1)", border: "rgba(45, 212, 191, 0.2)", dot: "#2DD4BF" },
};

const PREDEFINED_MESSAGES = [
  "Bonjour, c'est votre livreur. Je suis en route avec votre commande.",
  "Je suis arrivé à votre adresse de livraison.",
  "Je n'arrive pas à vous joindre par appel, merci de me recontacter.",
];

// ─── Sub-components ──────────────────────────────────────────────────────────

const StatusBadge = React.memo(({ status }: { status: string }) => {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.PENDING;
  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-xl text-[11px] font-extrabold uppercase tracking-wide"
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }}>
      <motion.span
        animate={cfg.pulse ? { opacity: [1, 0.4, 1], scale: [1, 1.2, 1] } : {}}
        transition={{ duration: 2, repeat: Infinity }}
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: cfg.dot, boxShadow: `0 0 8px ${cfg.color}` }}
      />
      {cfg.label}
    </div>
  );
});
StatusBadge.displayName = "StatusBadge";

const SectionHeader = React.memo(({ icon, title }: { icon: React.ReactNode; title: string }) => (
  <div className="flex items-center gap-3 mb-4">
    <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-[#242429] text-[#71717A] border border-[#2F2F37]">
      {icon}
    </div>
    <span className="text-[11px] font-extrabold tracking-[0.15em] text-[#71717A] uppercase">
      {title}
    </span>
  </div>
));
SectionHeader.displayName = "SectionHeader";

const InfoCard = React.memo(({ children }: { children: React.ReactNode }) => (
  <div className="bg-[#141416] rounded-xl border border-[#1A1A1E] overflow-hidden mb-4 shadow-lg">
    {children}
  </div>
));
InfoCard.displayName = "InfoCard";

const InfoRow = React.memo(({ label, value, last, icon }: { label: string; value: React.ReactNode; last?: boolean; icon?: React.ReactNode }) => (
  <div className={`flex justify-between items-center px-4 py-3 ${!last && 'border-b border-[#1A1A1E]'}`}>
    <div className="flex items-center gap-2">
      {icon && <span className="text-[#71717A]">{icon}</span>}
      <span className="text-[12px] font-bold text-[#71717A]">{label}</span>
    </div>
    <div className="text-[13px] font-extrabold text-white text-right max-w-[60%]">
      {value}
    </div>
  </div>
));
InfoRow.displayName = "InfoRow";

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DeliveryClient({ orders, user }: { orders: any[]; user: any }) {
  const [activeTab, setActiveTab] = useState<"pending" | "history">("pending");
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [partialMode, setPartialMode] = useState(false);
  const [deliveredItemIds, setDeliveredItemIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const pendingOrders = useMemo(() =>
    orders.filter(o => !["DELIVERED", "RETURNED", "CANCELLED"].includes(o.status)), [orders]);

  const historyOrders = useMemo(() =>
    orders.filter(o => ["DELIVERED", "RETURNED", "CANCELLED"].includes(o.status)), [orders]);

  const currentList = useMemo(() =>
    (activeTab === "pending" ? pendingOrders : historyOrders).filter(o =>
      o.customerName?.toLowerCase().includes(search.toLowerCase()) ||
      o.ref?.toLowerCase().includes(search.toLowerCase()) ||
      o.commune?.toLowerCase().includes(search.toLowerCase())
    ), [activeTab, pendingOrders, historyOrders, search]);

  const stats = useMemo(() => ({
    totalToCollect: pendingOrders.reduce((sum, o) => sum + (o.total + o.deliveryFee - (o.discount || 0)), 0),
    count: pendingOrders.length,
    deliveredToday: historyOrders.filter(o => {
      const d = new Date(o.createdAt);
      const today = new Date();
      return d.getDate() === today.getDate() && o.status === "DELIVERED";
    }).length,
  }), [pendingOrders, historyOrders]);

  const handleStatusChange = useCallback((orderId: string, status: string) => {
    if (user?.role?.toUpperCase() === 'COMMERCIAL') {
      showToast("Accès refusé : Action réservée aux livreurs", "error");
      return;
    }
    const statusMessages: Record<string, { label: string; confirm: string }> = {
      DELIVERED: { label: "Livraison confirmée", confirm: "LIVRÉE" },
      RETURNED: { label: "Retour enregistré", confirm: "RETOURNÉE" },
      REPRO_DISPO: { label: "Commande mise en repro-dispo", confirm: "REPRO-DISPO" },
    };
    const message = statusMessages[status] || statusMessages.RETURNED;
    if (!confirm(`Souhaitez-vous marquer cette commande comme ${message.confirm} ?`)) return;
    const reason = ["RETURNED", "CANCELLED", "REPRO_DISPO"].includes(status)
      ? prompt(status === "REPRO_DISPO" ? "Motif du report client :" : "Motif de l'échec :")?.trim()
      : undefined;
    if (["RETURNED", "CANCELLED", "REPRO_DISPO"].includes(status) && !reason) return;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const reproDeliveryDate = status === "REPRO_DISPO"
      ? prompt("Nouvelle date de livraison (AAAA-MM-JJ) :", tomorrow.toISOString().split("T")[0])?.trim()
      : undefined;
    if (status === "REPRO_DISPO" && !reproDeliveryDate) return;

    startTransition(async () => {
      try {
        await updateOrderStatus(orderId, status, reason, undefined, reproDeliveryDate);
        showToast(message.label, "success");
        setSelectedOrder(null);
        router.refresh();
      } catch (e: any) {
        showToast(e.message || "Erreur lors de la mise à jour", "error");
      }
    });
  }, [router, showToast, user?.role]);

  const onOrderSelect = (order: any) => {
    setSelectedOrder(order);
    setPartialMode(false);
    setDeliveredItemIds(order.items.map((i: any) => i.id));
  };

  const handlePartialDelivery = () => {
    if (user?.role?.toUpperCase() === 'COMMERCIAL') {
      showToast("Accès refusé : Action réservée aux livreurs", "error");
      return;
    }
    if (deliveredItemIds.length === 0) {
      showToast("Sélectionnez au moins un article", "error");
      return;
    }

    if (!confirm(`Confirmer la livraison partielle de ${deliveredItemIds.length} article(s) ?`)) return;

    startTransition(async () => {
      try {
        const deliveredMap: Record<string, number> = {};
        deliveredItemIds.forEach(id => {
          const item = selectedOrder.items.find((i: any) => i.id === id);
          if (item) deliveredMap[id] = item.qty;
        });

        await markPartialDelivery(selectedOrder.id, deliveredMap);
        showToast("Livraison partielle validée ✓", "success");
        setSelectedOrder(null);
        router.refresh();
      } catch (e: any) {
        showToast(e.message || "Erreur", "error");
      }
    });
  };

  const toggleItem = (id: string) => {
    setDeliveredItemIds(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleWhatsApp = useCallback((order: any, message: string) => {
    let phone = order.customerPhone.replace(/[^0-9]/g, "");
    if (phone.startsWith("0")) phone = "225" + phone.substring(1);
    else if (!phone.startsWith("225")) phone = "225" + phone;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank");
  }, []);

  const initials = useMemo(() =>
    user?.name?.split(" ").map((n: string) => n[0]).slice(0, 2).join("").toUpperCase() ?? "L",
    [user]);

  return (
    <div className="min-h-screen bg-[#0A0A0B] font-['Outfit'] text-white pb-10 overflow-x-hidden">
      {/* Sticky Header */}
      <header className="sticky top-0 z-50 bg-[#0A0A0B]/80 backdrop-blur-xl border-b border-[#1A1A1E] px-5 pt-5 pb-0">
        <div className="flex justify-between items-center mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[9px] font-black text-[#FF6B00] tracking-[0.15em] uppercase">
                Zangochap
              </span>
              <motion.div
                animate={{ scale: [1, 1.5, 1], opacity: [1, 0.5, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="w-1.5 h-1.5 rounded-full bg-[#00FF94] shadow-[0_0_10px_#00FF94]"
              />
            </div>
            <h1 className="text-2xl font-black tracking-tight text-white m-0">
              {user?.name?.split(" ")[0]}
            </h1>
          </div>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF6B00] to-[#EA6C07] flex items-center justify-center text-sm font-black text-white shadow-lg border-2 border-white/20">
            {initials}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-gradient-to-br from-[#1A1A1E] to-[#141416] rounded-2xl p-4 border border-[#1A1A1E] relative overflow-hidden">
            <div className="absolute -top-2 -right-2 opacity-5 text-[#FF6B00]">
              <TrendingUp size={60} />
            </div>
            <div className="flex items-center gap-2 mb-2 text-[#FF6B00]">
              <TrendingUp size={12} strokeWidth={3} />
              <span className="text-[9px] font-black tracking-[0.1em] uppercase text-[#71717A]">
                À collecter
              </span>
            </div>
            <div className="text-xl font-black tracking-tight text-white">
              {formatPrice(stats.totalToCollect)}
            </div>
          </div>
          <div className="bg-gradient-to-br from-[#1A1A1E] to-[#141416] rounded-2xl p-4 border border-[#1A1A1E] relative overflow-hidden">
            <div className="absolute -top-2 -right-2 opacity-5 text-[#00FF94]">
              <CheckCircle2 size={60} />
            </div>
            <div className="flex items-center gap-2 mb-2 text-[#00FF94]">
              <CheckCircle2 size={12} strokeWidth={3} />
              <span className="text-[9px] font-black tracking-[0.1em] uppercase text-[#71717A]">
                Livrées
              </span>
            </div>
            <div className="text-xl font-black tracking-tight text-white">
              {stats.deliveredToday}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-t border-[#1A1A1E]">
          {(["pending", "history"] as const).map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`flex-1 bg-transparent border-none py-4 text-xs font-bold relative cursor-pointer flex items-center justify-center gap-2 transition-colors ${isActive ? 'text-[#FF6B00]' : 'text-[#71717A]'}`}>
                {tab === "pending" ? <LayoutDashboard size={14} /> : <History size={14} />}
                {tab === "pending" ? "Missions" : "Historique"}
                <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-extrabold ${isActive ? 'bg-[#FF6B00]/20 text-[#FF6B00]' : 'bg-[#1A1A1E] text-[#71717A]'}`}>
                  {tab === "pending" ? stats.count : historyOrders.length}
                </span>
                {isActive && (
                  <motion.div layoutId="active-tab" className="absolute bottom-0 left-5 right-5 h-1 bg-[#FF6B00] rounded-t-md shadow-[0_0_15px_#FF6B00]" />
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* Search Bar */}
      <div className="px-5 pt-6 pb-3">
        <div className="relative">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#71717A]" />
          <input
            type="text"
            placeholder="Rechercher par nom, référence, ville..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[#141416] border border-[#1A1A1E] rounded-2xl py-3 px-4 pl-11 text-sm text-white font-bold outline-none transition-all shadow-lg"
          />
        </div>
      </div>

      {/* Orders List */}
      <div className="px-5 py-3 flex flex-col gap-3">
        <AnimatePresence mode="popLayout">
          {currentList.length === 0 ? (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              className="text-center py-20 px-5">
              <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center mx-auto mb-5 shadow-md">
                <Package size={24} strokeWidth={1.5} className="text-[#2F2F37]" />
              </div>
              <h3 className="text-base font-extrabold text-[#E4E4E7] m-0 mb-2">Aucune mission</h3>
              <p className="text-xs font-semibold text-[#71717A] m-0">
                Vos missions apparaîtront ici
              </p>
            </motion.div>
          ) : currentList.map((order, idx) => (
            <OrderCard
              key={order.id}
              order={order}
              idx={idx}
              onClick={() => onOrderSelect(order)}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Modal Bottom Sheet */}
      <AnimatePresence>
        {selectedOrder && (
          <div className="fixed inset-0 z-[100] flex items-end justify-center">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSelectedOrder(null)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <motion.div
              drag="y"
              dragConstraints={{ top: 0 }}
              dragElastic={0.1}
              onDragEnd={(e, info) => { if (info.offset.y > 100) setSelectedOrder(null); }}
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="relative z-[101] w-full max-w-[540px] h-[85vh] bg-white rounded-2xl rounded-b-none flex flex-col overflow-hidden shadow-2xl"
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-2 shrink-0">
                <div className="w-10 h-1 rounded-full bg-[#E4E4E7]" />
              </div>

              {/* Modal Header */}
              <div className="bg-gradient-to-br from-[#FF6B00] to-[#EA6C07] px-5 py-4 flex justify-between items-center shrink-0">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[10px] font-extrabold text-white/80 bg-white/20 px-1.5 py-0.5 rounded">
                      #{selectedOrder.ref?.split("-").pop()}
                    </span>
                    <div className="w-1 h-1 rounded-full bg-white" />
                    <span className="text-[10px] font-extrabold text-white uppercase">
                      {STATUS_CONFIG[selectedOrder.status]?.label ?? "En cours"}
                    </span>
                  </div>
                  <h2 className="text-2xl font-black tracking-tight text-white m-0">
                    {formatPrice(selectedOrder.total + selectedOrder.deliveryFee - (selectedOrder.discount || 0))}
                  </h2>
                </div>
                <div className="text-right">
                  <p className="text-[9px] font-extrabold text-white/60 tracking-[0.05em] uppercase m-0">
                    Client
                  </p>
                  <p className="text-sm font-extrabold text-white m-0">
                    {selectedOrder.customerName}
                  </p>
                </div>
              </div>

              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto p-5 bg-[#0A0A0B] pb-28">
                {/* Action Buttons */}
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <button
                    onClick={() => window.location.href = `tel:${selectedOrder.customerPhone}`}
                    className="flex items-center justify-center gap-3 py-4 rounded-xl border-2 border-[#38BDF8]/20 bg-[#38BDF8]/5 text-[#38BDF8] font-extrabold text-sm cursor-pointer transition-all"
                  >
                    <Phone size={16} strokeWidth={2.5} />
                    Appeler
                  </button>
                  <button
                    onClick={() => handleWhatsApp(selectedOrder, PREDEFINED_MESSAGES[0])}
                    className="flex items-center justify-center gap-3 py-4 rounded-xl border-2 border-[#00FF94]/20 bg-[#00FF94]/5 text-[#00FF94] font-extrabold text-sm cursor-pointer transition-all"
                  >
                    <MessageCircle size={16} strokeWidth={2.5} />
                    WhatsApp
                  </button>
                </div>

                {/* Destination */}
                <SectionHeader icon={<Navigation size={12} />} title="Destination" />
                <InfoCard>
                  <div className="p-4">
                    <div className="text-base font-black text-white mb-1">
                      {selectedOrder.commune}
                    </div>
                    <div className="text-[12px] font-bold text-[#71717A] leading-relaxed">
                      {selectedOrder.customerLocation}
                    </div>
                    {selectedOrder.deliveryNote && (
                      <div className="flex gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-[11px] font-bold mt-3">
                        <AlertCircle size={14} className="shrink-0 mt-0.5 text-[#FF6B00]" />
                        <span>{selectedOrder.deliveryNote}</span>
                      </div>
                    )}
                  </div>
                </InfoCard>

                {/* Items */}
                <SectionHeader icon={<Package size={12} />} title={`Contenu (${selectedOrder.items?.length || 0})`} />
                <InfoCard>
                  {selectedOrder.items?.map((item: any, i: number) => (
                    <div
                      key={i}
                      onClick={() => partialMode && toggleItem(item.id)}
                      className={`flex items-center gap-3 px-4 py-3 ${i < selectedOrder.items.length - 1 && 'border-b border-[#1A1A1E]'} ${partialMode ? 'cursor-pointer' : 'cursor-default'} ${partialMode && !deliveredItemIds.includes(item.id) ? 'bg-red-50 opacity-60' : 'bg-transparent'} transition-all`}
                    >
                      {partialMode && (
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${deliveredItemIds.includes(item.id) ? 'border-[#FF6B00] bg-[#FF6B00]' : 'border-[#A1A1AA] bg-transparent'}`}>
                          {deliveredItemIds.includes(item.id) && <Check size={12} strokeWidth={3} className="text-white" />}
                        </div>
                      )}
                      <div className="w-9 h-9 rounded-lg bg-[#1A1A1E] border border-[#2F2F37] flex items-center justify-center text-xs font-black text-white shrink-0">
                        {item.qty}
                      </div>
                      <div className="flex-1">
                        <div className="text-[13px] font-extrabold text-white mb-0.5 flex items-center gap-2">
                          {item.name}
                          {item.isGift && <span className="text-[8px] bg-[#FF6B00] text-white px-1.5 py-0.5 rounded font-black uppercase">Cadeau</span>}
                        </div>
                        <div className="text-[10px] font-bold text-[#71717A]">
                          {[item.size, item.color].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                    </div>
                  ))}
                </InfoCard>

                {/* Financial Summary */}
                <SectionHeader icon={<Banknote size={12} />} title="Règlement" />
                <InfoCard>
                  <InfoRow label="Sous-total" value={formatPrice(selectedOrder.total)} />
                  <InfoRow label="Livraison" value={formatPrice(selectedOrder.deliveryFee)} />
                  {selectedOrder.discount > 0 && (
                    <InfoRow label="Remise" value={<span className="text-green-600">−{formatPrice(selectedOrder.discount)}</span>} />
                  )}
                  <div className="px-4 py-3 bg-gradient-to-r from-white to-orange-50 border-t border-dashed border-[#2F2F37] flex justify-between items-center">
                    <span className="text-[10px] font-black text-[#71717A] uppercase">Total net</span>
                    <span className="text-xl font-black text-[#FF6B00] tracking-tight">
                      {formatPrice(selectedOrder.total + selectedOrder.deliveryFee - (selectedOrder.discount || 0))}
                    </span>
                  </div>
                </InfoCard>

                {/* Sale Info */}
                <SectionHeader icon={<User size={12} />} title="Vente" />
                <InfoCard>
                  <InfoRow label="Commercial" value={selectedOrder.commercialName || "—"} icon={<User size={12} />} />
                  <InfoRow label="Prise en charge" value={formatDate(selectedOrder.createdAt)} icon={<Clock size={12} />} last />
                </InfoCard>

                {partialMode && (
                  <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 flex gap-2 items-start">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <p className="text-[11px] font-bold m-0 leading-tight">
                      Mode partiel : Décochez les articles non livrés. Le total sera ajusté.
                    </p>
                  </div>
                )}
              </div>

              {/* Sticky Footer Actions */}
              {activeTab === "pending" && (
                <div className="absolute bottom-0 left-0 right-0 p-5 pb-6 bg-[#0A0A0B]/90 backdrop-blur-xl border-t border-[#1A1A1E] shadow-2xl">
                  <div className="flex flex-col gap-3">
                    <div className={`grid ${partialMode ? 'grid-cols-1' : 'grid-cols-1 gap-3'}`}>
                      {!partialMode ? (
                        <div className="flex gap-3">
                          <button
                            disabled={isPending}
                            onClick={() => handleStatusChange(selectedOrder.id, "RETURNED")}
                            className="flex-1 flex items-center justify-center gap-2 h-14 rounded-xl border-2 border-red-500/30 bg-red-500/5 text-red-500 text-sm font-extrabold cursor-pointer transition-all"
                          >
                            <RotateCcw size={18} strokeWidth={3} />
                            ÉCHEC
                          </button>
                          <button
                            disabled={isPending}
                            onClick={() => handleStatusChange(selectedOrder.id, "REPRO_DISPO")}
                            className="flex-1 flex items-center justify-center gap-2 h-14 rounded-xl border-2 border-yellow-500/30 bg-yellow-500/5 text-yellow-400 text-sm font-extrabold cursor-pointer transition-all"
                          >
                            <CalendarClock size={18} strokeWidth={3} />
                            REPRO
                          </button>
                          <button
                            disabled={isPending}
                            onClick={() => handleStatusChange(selectedOrder.id, "DELIVERED")}
                            className="flex-1 flex items-center justify-center gap-2 h-14 rounded-xl border-none bg-gradient-to-r from-[#FF6B00] to-[#FF8C00] text-white text-base font-black cursor-pointer shadow-lg"
                          >
                            <CheckCircle2 size={20} strokeWidth={3} />
                            LIVRÉ
                          </button>
                        </div>
                      ) : (
                        <button
                          disabled={isPending}
                          onClick={handlePartialDelivery}
                          className="flex items-center justify-center gap-2 h-14 rounded-xl border-none bg-gradient-to-r from-[#00FF94] to-[#059669] text-white text-base font-black cursor-pointer shadow-lg"
                        >
                          <CheckCircle2 size={20} strokeWidth={3} />
                          VALIDER LA PARTIELLE
                        </button>
                      )}
                    </div>

                    {!partialMode ? (
                      <button
                        onClick={() => setPartialMode(true)}
                        className="w-full py-3 rounded-xl bg-[#1A1A1E] border-none text-white text-xs font-extrabold cursor-pointer flex items-center justify-center gap-2 tracking-wide uppercase"
                      >
                        <Package size={14} strokeWidth={2.5} />
                        Livraison partielle
                      </button>
                    ) : (
                      <button
                        onClick={() => setPartialMode(false)}
                        className="w-full py-3 rounded-xl bg-transparent border-2 border-[#2F2F37] text-[#71717A] text-xs font-extrabold cursor-pointer flex items-center justify-center gap-2"
                      >
                        Annuler la sélection
                      </button>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── OrderCard Component ─────────────────────────────────────────────────────

const OrderCard = React.memo(({ order, idx, onClick }: { order: any; idx: number; onClick: () => void }) => {
  const amountDue = order.total + order.deliveryFee - (order.discount || 0);
  const isPending = !["DELIVERED", "RETURNED", "CANCELLED"].includes(order.status);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ delay: idx * 0.04 }}
      onClick={onClick}
      whileTap={{ scale: 0.99 }}
      className="bg-[#141416] rounded-2xl border border-[#1A1A1E] overflow-hidden cursor-pointer shadow-xl relative"
    >
      <div className="flex justify-between items-center px-4 py-3 border-b border-[#1A1A1E]">
        <span className="font-mono text-[10px] font-black text-[#71717A] tracking-wide">
          #{order.ref?.split("-").pop()}
        </span>
        <StatusBadge status={order.status} />
      </div>

      <div className="p-4">
        <div className="text-base font-black text-white mb-3 tracking-tight">
          {order.customerName}
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-1.5 text-[11px] text-[#71717A] font-extrabold">
            <MapPin size={14} className="text-[#FF6B00]" /> {order.commune}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-[#71717A] font-extrabold">
            <Package size={14} className="text-[#00FF94]" /> {order.items?.length || 0} ITEMS
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center px-4 py-3 bg-white/5 border-t border-[#1A1A1E]">
        <div className="flex-1">
          <div className="text-[9px] font-black text-[#71717A] uppercase tracking-wide mb-1">
            {isPending ? "À COLLECTER" : "TOTAL"}
          </div>
          <div className={`text-xl font-black tracking-tight ${isPending ? 'text-[#FF6B00]' : 'text-white'}`}>
            {formatPrice(amountDue)}
          </div>
        </div>
        <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-white border border-white/10">
          <ChevronRight size={20} strokeWidth={3} />
        </div>
      </div>
    </motion.div>
  );
});

OrderCard.displayName = "OrderCard";
