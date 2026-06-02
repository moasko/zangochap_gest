"use client";

import React, { useState, useTransition, useMemo, useCallback, useEffect, useRef } from "react";
import { AlertTriangle, ArrowLeft, Banknote, CalendarDays, CheckCircle2, ChevronRight, MapPin, Package, Search, SlidersHorizontal, WifiOff, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/components/Toast";

// Components
import RiderGlobalStyles from "./components/RiderGlobalStyles";
import { OrderCard } from "./components/OrderCard";
import { OrderDetailsSheet } from "./components/OrderDetailsSheet";
import { BottomNav } from "./components/BottomNav";
import { WalletView } from "./components/WalletView";
import { ProfileView } from "./components/ProfileView";

// Types & Utils
import { RiderOrder, RiderRevenueDay, RiderStats } from "./types";
import { calculateOrderCollectionTotal, calculatePartialSummary } from "./utils";

// Actions
import { updateOrderStatus, markPartialDelivery } from "@/modules/orders/actions";
import { logoutAction } from "@/modules/auth/actions";

type AppTab = "missions" | "history" | "wallet" | "profile";
type MissionFilter = "pending" | "current";
type HistoryStatusFilter = "all" | "DELIVERED" | "CANCELLED" | "PARTIALLY_DELIVERED" | "RETURNED" | "REPRO_DISPO";
type HistoryDateFilter = "today" | "week" | "month" | "all";
type StatusReasonRequest = {
  orderId: string;
  status: string;
  title: string;
  helper: string;
  reasons: string[];
} | null;

const FAILURE_REASONS = [
  "Client absent",
  "Client injoignable",
  "Adresse introuvable",
  "Client a refusé la commande",
  "Pas de budget / monnaie",
  "Article non conforme",
];

const REPROGRAM_REASONS = [
  "Client demande demain",
  "Client indisponible aujourd'hui",
  "Adresse à confirmer",
  "Pluie / accès difficile",
  "Fin de tournée",
];

const HISTORY_STATUS_OPTIONS: { value: HistoryStatusFilter; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "DELIVERED", label: "Livrées" },
  { value: "PARTIALLY_DELIVERED", label: "Partielles" },
  { value: "RETURNED", label: "Retours" },
  { value: "CANCELLED", label: "Annulées" },
  { value: "REPRO_DISPO", label: "Reprogrammées" },
];

const HISTORY_DATE_OPTIONS: { value: HistoryDateFilter; label: string }[] = [
  { value: "today", label: "Aujourd'hui" },
  { value: "week", label: "7 jours" },
  { value: "month", label: "30 jours" },
  { value: "all", label: "Tout" },
];

function isSameDay(value?: string | Date | null, date = new Date()) {
  if (!value) return false;
  return new Date(value).toDateString() === date.toDateString();
}

function isWithinDays(value: string | Date | null | undefined, days: number) {
  if (!value) return false;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return new Date(value) >= start;
}

function formatCompactPrice(value: number) {
  return `${new Intl.NumberFormat("fr-FR").format(value)} F`;
}

function getRevenueDate(order: RiderOrder) {
  return order.updatedAt || order.deliveryDate || order.createdAt;
}

// ── Main Component ───────────────────────────────────────────
export default function DeliveryClient({
  orders,
  user,
}: {
  orders: RiderOrder[];
  user: { id: string; name: string; email: string; role?: string };
}) {
  // ── State ──
  const [activeTab, setActiveTab] = useState<AppTab>("missions");
  const [localOrders, setLocalOrders] = useState<RiderOrder[]>(orders);
  const [isOffline, setIsOffline] = useState(false);
  const prevOrderCount = useRef(orders.length);

  const router = useRouter();
  const { showToast } = useToast();

  // ── PWA / Offline / Notifications ──
  useEffect(() => {
    const handleOnline = () => { setIsOffline(false); showToast("Connexion rétablie ! Synchronisation...", "success"); };
    const handleOffline = () => { setIsOffline(true); showToast("Mode hors-ligne activé. 📡", "error"); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOffline(!navigator.onLine);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [showToast]);

  useEffect(() => {
    if (orders.length > prevOrderCount.current && !isOffline) {
      showToast("Nouvelle mission assignée ! 🚛", "success");
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("ZangoChap Rider", { body: "Vous avez une nouvelle livraison à effectuer.", icon: "/logo.png" });
      }
      const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");
      audio.volume = 0.5; audio.play().catch(() => { });
    }
    prevOrderCount.current = orders.length;
    setLocalOrders(orders);
  }, [orders, showToast, isOffline]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        router.refresh();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [router]);

  const [missionFilter, setMissionFilter] = useState<MissionFilter>("pending");
  const [historyFilter, setHistoryFilter] = useState<HistoryStatusFilter>("all");
  const [historyDateFilter, setHistoryDateFilter] = useState<HistoryDateFilter>("week");
  const [selectedHistoryDate, setSelectedHistoryDate] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<RiderOrder | null>(null);
  const [partialMode, setPartialMode] = useState(false);
  const [includeDeliveryFee, setIncludeDeliveryFee] = useState(true);
  const [deliveredQuantities, setDeliveredQuantities] = useState<Record<string, number>>({});
  const [returnReasons, setReturnReasons] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [statusReasonRequest, setStatusReasonRequest] = useState<StatusReasonRequest>(null);
  const [isPending, startTransition] = useTransition();

  // ── Derived Data ──
  const completedStatuses = useMemo(() => ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "CANCELLED", "REPRO_DISPO"], []);
  const todayOrders = useMemo(() => localOrders.filter((o) => isSameDay(o.deliveryDate || o.createdAt)), [localOrders]);
  const pending = useMemo(() => todayOrders.filter((o) => !completedStatuses.includes(o.status)), [todayOrders, completedStatuses]);
  const inProgress = useMemo(() => todayOrders.filter((o) => o.status === "ON_DELIVERY"), [todayOrders]);
  const history = useMemo(() => localOrders.filter((o) => completedStatuses.includes(o.status)), [localOrders, completedStatuses]);
  const historyStatusCounts = useMemo(() => {
    return history.reduce((counts: Record<string, number>, order) => {
      counts[order.status] = (counts[order.status] || 0) + 1;
      return counts;
    }, {});
  }, [history]);

  const filterBySearch = useCallback((base: RiderOrder[]) => {
    if (!searchQuery.trim()) return base;
    const q = searchQuery.toLowerCase();
    return base.filter((o) => (
      o.customerName?.toLowerCase().includes(q)
      || o.ref?.toLowerCase().includes(q)
      || o.commune?.toLowerCase().includes(q)
      || o.customerPhone?.toLowerCase().includes(q)
    ));
  }, [searchQuery]);

  const displayedOrders = useMemo(() => {
    const base = missionFilter === "pending" ? pending : inProgress;
    return filterBySearch(base);
  }, [missionFilter, pending, inProgress, filterBySearch]);

  const filteredHistory = useMemo(() => {
    let base = history;
    if (historyFilter !== "all") base = base.filter((o) => o.status === historyFilter);
    if (historyDateFilter === "today") {
      base = base.filter((o) => isSameDay(o.deliveryDate || o.updatedAt || o.createdAt));
    } else if (historyDateFilter === "week") {
      base = base.filter((o) => isWithinDays(o.deliveryDate || o.updatedAt || o.createdAt, 7));
    } else if (historyDateFilter === "month") {
      base = base.filter((o) => isWithinDays(o.deliveryDate || o.updatedAt || o.createdAt, 30));
    }
    return filterBySearch(base);
  }, [history, historyFilter, historyDateFilter, filterBySearch]);

  const groupedHistory = useMemo(() => {
    const formatter = new Intl.DateTimeFormat("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    const groups = filteredHistory.reduce<Record<string, { label: string; orders: RiderOrder[]; timestamp: number }>>((acc, order) => {
      const dateValue = order.deliveryDate || order.updatedAt || order.createdAt;
      const date = new Date(dateValue);
      const key = date.toISOString().slice(0, 10);
      if (!acc[key]) {
        acc[key] = {
          label: formatter.format(date),
          orders: [],
          timestamp: date.getTime(),
        };
      }
      acc[key].orders.push(order);
      return acc;
    }, {});

    return Object.entries(groups)
      .sort(([, a], [, b]) => b.timestamp - a.timestamp)
      .map(([key, group]) => {
        const completed = group.orders.filter((order) => ["DELIVERED", "PARTIALLY_DELIVERED"].includes(order.status)).length;
        const issues = group.orders.filter((order) => ["RETURNED", "CANCELLED", "REPRO_DISPO"].includes(order.status)).length;
        const cash = group.orders
          .filter((order) => ["DELIVERED", "PARTIALLY_DELIVERED"].includes(order.status))
          .reduce((total, order) => total + calculateOrderCollectionTotal(order), 0);
        const communes = Array.from(new Set(group.orders.map((order) => order.commune).filter(Boolean) as string[]));

        return {
          key,
          ...group,
          completed,
          issues,
          cash,
          communes,
        };
      });
  }, [filteredHistory]);

  const selectedHistoryGroup = useMemo(
    () => groupedHistory.find((group) => group.key === selectedHistoryDate) || null,
    [groupedHistory, selectedHistoryDate],
  );

  const paidStatuses = useMemo(() => ["DELIVERED", "PARTIALLY_DELIVERED"], []);
  const deliveredTodayOrders = useMemo(
    () => history.filter((o) => paidStatuses.includes(o.status) && isSameDay(getRevenueDate(o))),
    [history, paidStatuses],
  );
  const ordersToSettle = useMemo(() => localOrders.filter(o => paidStatuses.includes(o.status) && !o.settlementId), [localOrders, paidStatuses]);
  const revenueHistory = useMemo<RiderRevenueDay[]>(() => {
    const formatter = new Intl.DateTimeFormat("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    const groups = history
      .filter((order) => paidStatuses.includes(order.status))
      .reduce<Record<string, { date: Date; orders: RiderOrder[] }>>((acc, order) => {
        const date = new Date(getRevenueDate(order));
        const key = date.toISOString().slice(0, 10);
        if (!acc[key]) acc[key] = { date, orders: [] };
        acc[key].orders.push(order);
        return acc;
      }, {});

    return Object.entries(groups)
      .sort(([, a], [, b]) => b.date.getTime() - a.date.getTime())
      .map(([key, group]) => {
        const total = group.orders.reduce((sum, order) => sum + calculateOrderCollectionTotal(order), 0);
        const pending = group.orders
          .filter((order) => !order.settlementId)
          .reduce((sum, order) => sum + calculateOrderCollectionTotal(order), 0);

        return {
          key,
          label: formatter.format(group.date),
          orders: group.orders,
          delivered: group.orders.filter((order) => order.status === "DELIVERED").length,
          partial: group.orders.filter((order) => order.status === "PARTIALLY_DELIVERED").length,
          settled: total - pending,
          pending,
          total,
        };
      });
  }, [history, paidStatuses]);
  const stats = useMemo<RiderStats>(() => ({
    cash: ordersToSettle.reduce((acc, o) => acc + calculateOrderCollectionTotal(o), 0),
    amountToSettle: ordersToSettle.reduce((acc, o) => acc + calculateOrderCollectionTotal(o), 0),
    todayCash: deliveredTodayOrders.reduce((acc, o) => acc + calculateOrderCollectionTotal(o), 0),
    count: pending.length,
    inProgressCount: inProgress.length,
    deliveredToday: deliveredTodayOrders.length,
    partiallyDeliveredToday: deliveredTodayOrders.filter((o) => o.status === "PARTIALLY_DELIVERED").length,
  }), [pending, inProgress, ordersToSettle, deliveredTodayOrders]);
  const routeStats = useMemo(() => ({
    total: todayOrders.length,
    completed: todayOrders.filter((o) => ["DELIVERED", "PARTIALLY_DELIVERED"].includes(o.status)).length,
    issues: todayOrders.filter((o) => ["RETURNED", "CANCELLED", "REPRO_DISPO"].includes(o.status)).length,
  }), [todayOrders]);
  const routeProgress = routeStats.total > 0 ? Math.round((routeStats.completed / routeStats.total) * 100) : 0;
  const partialSummary = useMemo(() => {
    if (!selectedOrder) return { subtotal: 0, total: 0, fee: 0 };
    return calculatePartialSummary(selectedOrder, deliveredQuantities, includeDeliveryFee);
  }, [selectedOrder, deliveredQuantities, includeDeliveryFee]);

  useEffect(() => {
    setSelectedHistoryDate(null);
  }, [historyFilter, historyDateFilter, searchQuery]);

  // Handlers
  const handleOpenOrder = useCallback((order: RiderOrder) => {
    setSelectedOrder(order); setPartialMode(false); setIncludeDeliveryFee(true); setReturnReasons({});
    const initialQty: Record<string, number> = {}; order.items.forEach((i) => (initialQty[i.id] = i.qty)); setDeliveredQuantities(initialQty);
  }, []);

  const handleUpdateItemQty = useCallback((id: string, qty: number) => { setDeliveredQuantities((prev) => ({ ...prev, [id]: qty })); }, []);
  const handleUpdateReturnReason = useCallback((id: string, reason: string) => { setReturnReasons((prev) => ({ ...prev, [id]: reason })); }, []);

  const executeStatusUpdate = useCallback((id: string, status: string, reason?: string, amountReceived?: number, reproDeliveryDate?: string) => {
    const normalizedStatus = status.toUpperCase();
    if (["RETURNED", "CANCELLED", "REPRO_DISPO"].includes(normalizedStatus) && !reason?.trim()) {
      setStatusReasonRequest({
        orderId: id,
        status,
        title: normalizedStatus === "REPRO_DISPO" ? "Motif de reprogrammation" : "Motif d'échec",
        helper: normalizedStatus === "REPRO_DISPO"
          ? "Indiquez pourquoi le client reporte la livraison et choisissez la nouvelle date."
          : "Indiquez pourquoi la livraison n'a pas abouti. Ce motif sera visible au bureau.",
        reasons: normalizedStatus === "REPRO_DISPO" ? REPROGRAM_REASONS : FAILURE_REASONS,
      });
      return;
    }

    if (normalizedStatus === "REPRO_DISPO" && !reproDeliveryDate) {
      showToast("Choisissez la nouvelle date de livraison.", "error");
      return;
    }

    setLocalOrders(prev => prev.map(o => o.id === id ? {
      ...o,
      status: status as RiderOrder["status"],
      amountReceived: normalizedStatus === "DELIVERED" && amountReceived !== undefined ? amountReceived : o.amountReceived,
      deliveryDate: normalizedStatus === "REPRO_DISPO" ? reproDeliveryDate : o.deliveryDate,
      returnReason: reason || o.returnReason,
      updatedAt: new Date().toISOString()
    } : o));
    startTransition(async () => {
      try {
        await updateOrderStatus(id, status, reason, amountReceived, reproDeliveryDate);
        showToast("Statut mis à jour ✓", "success");
        setStatusReasonRequest(null);
        setSelectedOrder(null);
        router.refresh();
      } catch (e: unknown) {
        setLocalOrders(orders); showToast(e instanceof Error ? e.message : "Erreur", "error");
      }
    });
  }, [router, showToast, orders]);

  const todayLabel = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  const handlePartialConfirm = useCallback((amountReceived?: number) => {
    if (!selectedOrder) return;
    const hasItems = Object.values(deliveredQuantities).some((qty) => qty > 0);
    if (!hasItems) return showToast("Sélectionnez au moins un article", "error");

    const missingReason = selectedOrder.items.some((item) => {
      const dQty = deliveredQuantities[item.id] || 0;
      return dQty < item.qty && !returnReasons[item.id];
    });
    if (missingReason) return showToast("Ajoutez un motif pour chaque article non livré", "error");

    const noteParts: string[] = [];
    selectedOrder.items.forEach((item) => {
      const dQty = deliveredQuantities[item.id] || 0;
      if (dQty < item.qty) {
        const reason = returnReasons[item.id];
        if (reason) noteParts.push(`${item.name} (${item.qty - dQty}x): ${reason}`);
      }
    });
    const aggregatedNote = noteParts.length > 0 ? "Motifs spécifiques : " + noteParts.join(" | ") : undefined;

    setLocalOrders(prev => prev.map(o => o.id === selectedOrder.id ? {
      ...o,
      status: 'PARTIALLY_DELIVERED',
      amountReceived: amountReceived ?? o.amountReceived,
      updatedAt: new Date().toISOString()
    } : o));
    startTransition(async () => {
      try {
        await markPartialDelivery(selectedOrder.id, deliveredQuantities, aggregatedNote, includeDeliveryFee, amountReceived);
        showToast("Livraison partielle enregistrée", "success");
        setSelectedOrder(null); router.refresh();
      } catch (e: unknown) {
        setLocalOrders(orders); showToast(e instanceof Error ? e.message : "Erreur", "error");
      }
    });
  }, [selectedOrder, deliveredQuantities, returnReasons, includeDeliveryFee, router, showToast, orders]);

  return (
    <div className="h-[100dvh] overflow-hidden flex flex-col">
      <RiderGlobalStyles />
      <div className="max-w-md mx-auto relative h-full flex flex-col w-full overflow-hidden bg-[#F3F4F6]">
        {isOffline && (
          <div className="bg-[#B91C1C] text-white text-[10px] font-bold py-1 px-4 flex items-center justify-center gap-2 uppercase tracking-wider shrink-0">
            <WifiOff size={12} /> Mode hors-ligne
          </div>
        )}

        <header className="shrink-0 px-3 pt-3 pb-3 bg-[#0F172A] text-white border-b border-black/10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-sm bg-[#1E293B] border border-white/10 flex items-center justify-center text-sm font-bold text-white shadow-none">{user?.name?.[0]?.toUpperCase()}</div>
              <div>
                <h1 className="text-[16px] font-black leading-none mb-1">{user?.name?.split(" ")[0]}</h1>
                <div className="flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${isOffline ? 'bg-[#B91C1C]' : 'bg-[#166534]'}`} />
                  <span className="text-[10px] font-bold text-white/60 uppercase tracking-tight">{isOffline ? 'Déconnecté' : 'En tournée'}</span>
                </div>
              </div>
            </div>
            {activeTab === "missions" && (
              <div className="flex items-center gap-2">
                <div className="px-2 py-1 bg-white/10 rounded-sm flex items-center gap-1.5 border border-white/10">
                  <span className="text-[11px] font-black text-white">{new Intl.NumberFormat("fr-FR").format(stats.cash)} F</span>
                </div>
              </div>
            )}
          </div>
          {activeTab === "missions" && (
            <div className="space-y-3">
              <div className="rounded-sm bg-white text-[#111827] p-3 border border-[#E5E7EB]">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-[#111827]">
                    <CalendarDays size={14} className="text-[#64748B]" />
                    {todayLabel}
                  </div>
                  <div className="text-[10px] font-black uppercase tracking-wider text-[#64748B]">
                    {routeProgress}%
                  </div>
                </div>
                <div className="mb-4">
                  <div className="h-1.5 bg-[#F3F4F6] rounded-full overflow-hidden">
                    <div className="h-full bg-[#111827] rounded-full transition-all duration-500 ease-out" style={{ width: `${routeProgress}%` }} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <RouteStat label="Assignées" value={routeStats.total} tone="dark" />
                  <RouteStat label="Réussies" value={routeStats.completed} tone="green" />
                  <RouteStat label="À suivre" value={routeStats.issues} tone="orange" />
                </div>
              </div>
              <div className="flex p-1 bg-[#F3F4F6] rounded-sm border border-[#E5E7EB]">
                {[
                  { id: "pending", label: "À traiter", count: stats.count },
                  { id: "current", label: "En route", count: stats.inProgressCount },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setMissionFilter(t.id as MissionFilter)}
                    className={`flex-1 py-1.5 rounded text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 ${
                      missionFilter === t.id
                        ? "bg-white text-[#111827] border border-[#E5E7EB]"
                        : "text-[#6B7280] active:scale-95"
                    }`}
                  >
                    {t.label}
                    {t.count !== undefined && t.count > 0 && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-black leading-none ${
                          missionFilter === t.id
                            ? "bg-[#111827] text-white"
                            : "bg-[#E5E7EB] text-[#6B7280]"
                        }`}
                      >
                        {t.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="relative group mt-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] group-focus-within:text-[#111827] transition-colors" />
                <input type="text" placeholder="Rechercher client, réf, lieu..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full h-11 bg-white border border-[#E5E7EB] focus:border-[#475569] focus:ring-1 focus:ring-[#CBD5E1] rounded-md pl-9 pr-4 text-[13px] outline-none transition-all placeholder:text-[#9CA3AF] text-[#111827]" />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-[#F3F4F6] text-[#6B7280] active:scale-90 transition-transform">
                    <span className="text-[14px] leading-none mb-0.5">×</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-4 pb-24">
          <AnimatePresence mode="wait">
            {activeTab === "missions" && (
              <motion.div key="missions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                {displayedOrders.length === 0 ? (
                  <div className="rounded-md border border-[#E5E7EB] bg-white px-5 py-10 text-center">
                    <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-md bg-[#F3F4F6] text-[#475569]">
                      <Package size={22} />
                    </div>
                    <p className="text-sm font-black text-[#111827]">Aucune mission dans cette section</p>
                    <p className="mx-auto mt-1 max-w-[260px] text-[12px] font-semibold leading-relaxed text-[#6B7280]">
                      Les livraisons assignées pour aujourd&apos;hui apparaissent ici.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">{displayedOrders.map((o) => <OrderCard key={o.id} order={o} onClick={() => handleOpenOrder(o)} />)}</div>
                )}
              </motion.div>
            )}
            {activeTab === "history" && (
              <motion.div key="history" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-3">
                <div className="rounded-md bg-white border border-[#E5E7EB] p-3 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-[#111827]">
                        <SlidersHorizontal size={14} className="text-[#64748B]" />
                        Historique de livraisons
                      </div>
                      <p className="mt-0.5 text-[10px] font-bold text-[#64748B]">
                        {filteredHistory.length} livraison(s) groupée(s) par date
                      </p>
                    </div>
                    {(historyFilter !== "all" || historyDateFilter !== "week" || searchQuery) && (
                      <button
                        onClick={() => {
                          setHistoryFilter("all");
                          setHistoryDateFilter("week");
                          setSearchQuery("");
                        }}
                        className="flex items-center gap-1 rounded-sm border border-[#E5E7EB] bg-[#F8FAFC] px-2 py-1 text-[10px] font-black text-[#475569]"
                      >
                        <X size={12} />
                        Reset
                      </button>
                    )}
                  </div>

                  <div className="relative group">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] group-focus-within:text-[#111827] transition-colors" />
                    <input
                      type="text"
                      placeholder="Rechercher client, réf, lieu..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full h-10 bg-[#F8FAFC] border border-[#E5E7EB] focus:border-[#475569] focus:ring-1 focus:ring-[#CBD5E1] rounded-md pl-9 pr-9 text-[13px] outline-none transition-all placeholder:text-[#9CA3AF] text-[#111827]"
                    />
                    {searchQuery && (
                      <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-white text-[#6B7280] active:scale-90 transition-transform">
                        <X size={12} />
                      </button>
                    )}
                  </div>

                  <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
                    {HISTORY_DATE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setHistoryDateFilter(option.value)}
                        className={`shrink-0 rounded-sm border px-2.5 py-1.5 text-[10px] font-black transition-colors ${
                          historyDateFilter === option.value
                            ? "border-[#475569] bg-[#475569] text-white"
                            : "border-[#E5E7EB] bg-[#F8FAFC] text-[#475569]"
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-hide">
                    {HISTORY_STATUS_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => setHistoryFilter(option.value)}
                        className={`shrink-0 rounded-sm border px-2.5 py-1.5 text-[10px] font-black transition-colors flex items-center gap-1.5 ${
                          historyFilter === option.value
                            ? "border-[#334155] bg-[#334155] text-white"
                            : "border-[#E5E7EB] bg-[#F8FAFC] text-[#475569]"
                        }`}
                      >
                        {option.label}
                        <span className={`rounded-sm px-1.5 py-0.5 text-[9px] leading-none ${
                          historyFilter === option.value ? "bg-white/20 text-white" : "bg-[#E5E7EB] text-[#64748B]"
                        }`}>
                          {option.value === "all" ? history.length : historyStatusCounts[option.value] || 0}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {selectedHistoryGroup ? (
                  <div className="space-y-3">
                    <button
                      onClick={() => setSelectedHistoryDate(null)}
                      className="flex items-center gap-2 text-[12px] font-black text-[#334155]"
                    >
                      <span className="flex h-8 w-8 items-center justify-center rounded-sm border border-[#E5E7EB] bg-white">
                        <ArrowLeft size={15} />
                      </span>
                      Retour aux dates
                    </button>

                    <div className="rounded-md border border-[#E5E7EB] bg-white p-3">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 text-[#111827]">
                            <CalendarDays size={16} className="text-[#64748B]" />
                            <h2 className="text-[16px] font-black capitalize">{selectedHistoryGroup.label}</h2>
                          </div>
                          <p className="mt-1 text-[11px] font-bold text-[#64748B]">
                            Point de livraison de la date
                          </p>
                        </div>
                        <span className="rounded-sm bg-[#F8FAFC] px-2 py-1 text-[10px] font-black text-[#475569] border border-[#E5E7EB]">
                          {selectedHistoryGroup.orders.length} livraison(s)
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <HistoryPointCard icon={<Banknote size={13} />} label="Encaissement" value={formatCompactPrice(selectedHistoryGroup.cash)} />
                        <HistoryPointCard icon={<CheckCircle2 size={13} />} label="Réussies" value={selectedHistoryGroup.completed} />
                        <HistoryPointCard icon={<AlertTriangle size={13} />} label="À suivre" value={selectedHistoryGroup.issues} />
                        <HistoryPointCard icon={<MapPin size={13} />} label="Communes" value={selectedHistoryGroup.communes.length || 0} />
                      </div>

                      {selectedHistoryGroup.communes.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {selectedHistoryGroup.communes.slice(0, 8).map((commune) => (
                            <span key={commune} className="rounded-sm border border-[#E5E7EB] bg-[#F8FAFC] px-2 py-1 text-[10px] font-bold text-[#475569]">
                              {commune}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      {selectedHistoryGroup.orders.map((order, index) => (
                        <OrderCard key={order.id} order={order} index={index} onClick={() => handleOpenOrder(order)} />
                      ))}
                    </div>
                  </div>
                ) : groupedHistory.length === 0 ? (
                  <div className="rounded-md border border-[#E5E7EB] bg-white px-5 py-10 text-center">
                    <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-md bg-[#F3F4F6] text-[#475569]">
                      <Package size={22} />
                    </div>
                    <p className="text-sm font-black text-[#111827]">Aucune livraison dans l&apos;historique</p>
                    <p className="mx-auto mt-1 max-w-[260px] text-[12px] font-semibold leading-relaxed text-[#6B7280]">
                      Modifiez les filtres pour retrouver une livraison clôturée.
                    </p>
                  </div>
                ) : (
                  groupedHistory.map((group) => (
                    <button
                      key={group.key}
                      onClick={() => setSelectedHistoryDate(group.key)}
                      className="w-full rounded-md border border-[#E5E7EB] bg-white p-3 text-left active:scale-[0.99] transition-transform"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-[#111827]">
                            <CalendarDays size={15} className="text-[#64748B] shrink-0" />
                            <h2 className="truncate text-[14px] font-black capitalize">{group.label}</h2>
                          </div>
                          <div className="mt-2 grid grid-cols-3 gap-1.5">
                            <div className="rounded-sm bg-[#F8FAFC] px-2 py-1">
                              <p className="text-[9px] font-black uppercase text-[#94A3B8]">Livraisons</p>
                              <p className="text-[13px] font-black text-[#111827]">{group.orders.length}</p>
                            </div>
                            <div className="rounded-sm bg-[#F8FAFC] px-2 py-1">
                              <p className="text-[9px] font-black uppercase text-[#64748B]">Réussies</p>
                              <p className="text-[13px] font-black text-[#334155]">{group.completed}</p>
                            </div>
                            <div className="rounded-sm bg-[#F8FAFC] px-2 py-1">
                              <p className="text-[9px] font-black uppercase text-[#64748B]">Point</p>
                              <p className="text-[13px] font-black text-[#334155]">{formatCompactPrice(group.cash)}</p>
                            </div>
                          </div>
                          {group.communes.length > 0 && (
                            <p className="mt-2 line-clamp-1 text-[11px] font-bold text-[#64748B]">
                              {group.communes.slice(0, 4).join(" · ")}
                            </p>
                          )}
                        </div>
                        <ChevronRight size={17} className="mt-1 shrink-0 text-[#94A3B8]" />
                      </div>
                    </button>
                  ))
                )}
              </motion.div>
            )}
            {activeTab === "wallet" && <WalletView key="wallet" stats={stats} ordersToSettle={ordersToSettle} revenueHistory={revenueHistory} />}
            {activeTab === "profile" && <ProfileView key="profile" user={user} logout={() => logoutAction()} />}
          </AnimatePresence>
        </main>

        <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} pendingCount={stats.count} historyCount={history.length} />

        {selectedOrder && (
          <OrderDetailsSheet
            order={selectedOrder}
            onClose={() => setSelectedOrder(null)}
            partialMode={partialMode}
            setPartialMode={setPartialMode}
            includeDeliveryFee={includeDeliveryFee}
            setIncludeDeliveryFee={setIncludeDeliveryFee}
            deliveredQuantities={deliveredQuantities}
            updateItemQty={handleUpdateItemQty}
            returnReasons={returnReasons}
            updateReturnReason={handleUpdateReturnReason}
            partialSummary={partialSummary}
            onStatusUpdate={(id, status, amountReceived) => executeStatusUpdate(id, status, undefined, amountReceived)}
            onPartialConfirm={handlePartialConfirm}
            isPending={isPending}
          />
        )}
        <StatusReasonModal
          request={statusReasonRequest}
          onClose={() => setStatusReasonRequest(null)}
          onConfirm={(reason, reproDeliveryDate) => {
            if (!statusReasonRequest) return;
            executeStatusUpdate(statusReasonRequest.orderId, statusReasonRequest.status, reason, undefined, reproDeliveryDate);
          }}
          isPending={isPending}
        />
      </div>
    </div>
  );
}

function HistoryPointCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="rounded-sm bg-[#F8FAFC] px-2.5 py-2 border border-[#E5E7EB]">
      <div className="mb-1 flex items-center gap-1 text-[#64748B]">
        {icon}
        <span className="text-[9px] font-black uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-[15px] font-black text-[#111827] tabular-nums">{value}</p>
    </div>
  );
}

function RouteStat({ label, value, tone }: { label: string; value: number; tone: "dark" | "green" | "orange" }) {
  const toneClass = tone === "green" ? "text-[#16A34A]" : tone === "orange" ? "text-[#334155]" : "text-[#111827]";
  const Icon = tone === "green" ? CheckCircle2 : tone === "orange" ? AlertTriangle : Package;
  return (
    <div className="rounded-sm bg-[#F3F4F6] px-2 py-1.5">
      <div className={`flex items-center gap-1 ${toneClass}`}>
        <Icon size={12} />
        <span className="text-[15px] font-black tabular-nums">{value}</span>
      </div>
      <p className="text-[9px] font-black uppercase tracking-wider text-[#6B7280] mt-0.5">{label}</p>
    </div>
  );
}

function StatusReasonModal({
  request,
  onClose,
  onConfirm,
  isPending,
}: {
  request: StatusReasonRequest;
  onClose: () => void;
  onConfirm: (reason: string, reproDeliveryDate?: string) => void;
  isPending: boolean;
}) {
  const [selected, setSelected] = useState("");
  const [details, setDetails] = useState("");
  const [reproDeliveryDate, setReproDeliveryDate] = useState("");

  useEffect(() => {
    setSelected("");
    setDetails("");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setReproDeliveryDate(tomorrow.toISOString().split("T")[0]);
  }, [request?.orderId, request?.status]);

  if (!request) return null;

  const reason = [selected, details.trim()].filter(Boolean).join(" - ");

  return (
    <div className="fixed inset-0 z-[220] flex items-end justify-center">
      <button className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} aria-label="Fermer" />
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        className="relative z-10 w-full max-w-md bg-white rounded-t-sm p-4 border-t border-[#E5E7EB]"
      >
        <div className="w-10 h-1 rounded-sm bg-[#E5E7EB] mx-auto mb-4" />
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-sm bg-[#334155]/10 text-[#334155] flex items-center justify-center shrink-0">
            <AlertTriangle size={20} />
          </div>
          <div>
            <h3 className="text-[18px] font-black text-[#111827]">{request.title}</h3>
            <p className="text-[12px] font-semibold text-[#6B7280] leading-relaxed mt-1">{request.helper}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          {request.reasons.map((reasonOption) => (
            <button
              key={reasonOption}
              onClick={() => setSelected(reasonOption)}
              className={`min-h-9 px-2.5 py-1.5 rounded-sm text-[11px] font-black text-left border transition-all ${
                selected === reasonOption ? "bg-[#111827] text-white border-[#111827]" : "bg-[#F3F4F6] text-[#374151] border-[#E5E7EB]"
              }`}
            >
              {reasonOption}
            </button>
          ))}
        </div>
        <textarea
          value={details}
          onChange={(event) => setDetails(event.target.value)}
          placeholder="Détail utile pour le bureau..."
          className="w-full min-h-20 rounded-[4px] bg-[#F9FAFB] border border-[#E5E7EB] px-3 py-3 text-[13px] font-semibold outline-none resize-none"
        />
        {request.status === "REPRO_DISPO" && (
          <label className="mt-3 block text-[11px] font-black uppercase tracking-wide text-[#475569]">
            Nouvelle date de livraison
            <input
              type="date"
              value={reproDeliveryDate}
              onChange={(event) => setReproDeliveryDate(event.target.value)}
              className="mt-1.5 h-11 w-full rounded-[4px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 text-[13px] font-semibold outline-none"
            />
          </label>
        )}
        <div className="flex gap-2 mt-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-sm bg-[#F3F4F6] text-[#374151] font-bold text-[13px]">Annuler</button>
          <button onClick={() => onConfirm(reason, reproDeliveryDate)} disabled={!reason || (request.status === "REPRO_DISPO" && !reproDeliveryDate) || isPending} className="flex-[1.4] py-2.5 rounded-sm bg-[#111827] text-white font-bold text-[13px] disabled:opacity-50 flex justify-center items-center gap-2">
            {isPending && <div className="w-4 h-4 rounded-full border-2 border-white/20 border-t-white animate-spin" />} Confirmer
          </button>
        </div>
      </motion.div>
    </div>
  );
}

