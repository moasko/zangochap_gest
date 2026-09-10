"use client";

import React, { useState, useTransition, useMemo, useCallback, useEffect, useRef } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, MessageCircle, Package, Search, WifiOff, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/components/Toast";
import { playRiderMessageSound, showBrowserNotification } from "@/lib/client-alerts";

// Components
import { RiderTracking } from "./components/RiderTracking";
import { RiderHistory } from "./components/RiderHistory";
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
import { sendOrderSupportAlert } from "@/modules/chat/actions";
import { openTeamChat } from "@/components/GlobalChatAccess";

type AppTab = "missions" | "history" | "wallet" | "profile";
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

function isSameDay(value?: string | Date | null, date = new Date()) {
  if (!value) return false;
  return new Date(value).toDateString() === date.toDateString();
}

// Date a laquelle l'action de livraison a reellement eu lieu (et non la date
// planifiee). On classe ainsi l'historique sur "ce que le livreur a fait, le
// jour ou il l'a fait". Pour un echec / une reprogrammation, lastDeliveryAttemptAt
// est pose au moment exact de l'action : on l'utilise pour eviter qu'une commande
// reprogrammee (dont la deliveryDate est repoussee dans le futur) ne remonte en
// tete de l'historique a une date ou rien ne s'est passe.
function getHistoryEventDate(order: RiderOrder) {
  if (
    ["RETURNED", "CANCELLED", "REPRO_DISPO"].includes(order.status)
    && order.lastDeliveryAttemptAt
  ) {
    return order.lastDeliveryAttemptAt;
  }
  if (["DELIVERED", "PARTIALLY_DELIVERED"].includes(order.status) && order.deliveredAt) {
    return order.deliveredAt;
  }
  return order.deliveryDate || order.updatedAt || order.createdAt;
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
  const [gpsSettingsTarget, setGpsSettingsTarget] = useState<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("missions");
  const [localOrders, setLocalOrders] = useState<RiderOrder[]>(orders);
  const [isOffline, setIsOffline] = useState(false);
  const prevOrderCount = useRef(orders.filter(o => ["PACKED", "ON_DELIVERY"].includes(o.status)).length);

  const router = useRouter();
  const { showToast } = useToast();

  // ── PWA / Offline / Notifications ──
  useEffect(() => {
    const handleOnline = () => { setIsOffline(false); router.refresh(); showToast("Connexion rétablie ! Synchronisation...", "success"); };
    const handleOffline = () => { setIsOffline(true); showToast("Connexion absente : les actions sont suspendues.", "error"); };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    setIsOffline(!navigator.onLine);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [showToast, router]);

  useEffect(() => {
    if (orders.filter(o => ["PACKED", "ON_DELIVERY"].includes(o.status)).length > prevOrderCount.current && !isOffline) {
      showToast("Nouvelle mission assignée ! 🚛", "success");
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("ZangoChap Rider", { body: "Vous avez une nouvelle livraison à effectuer.", icon: "/logo.png" });
      }
      const audio = new Audio("https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3");
      audio.volume = 0.5; audio.play().catch(() => { });
    }
    prevOrderCount.current = orders.filter(o => ["PACKED", "ON_DELIVERY"].includes(o.status)).length;
    setLocalOrders(orders);
  }, [orders, showToast, isOffline]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        router.refresh();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [router]);

  useEffect(() => {
    const source = new EventSource("/api/chat/rider-alerts/stream");
    const handleCommercialConfirmation = (event: MessageEvent<string>) => {
      try {
        const alert = JSON.parse(event.data) as { body?: string; senderName?: string };
        if (!alert.body?.includes("[CONFIRMATION COMMERCIALE]")) return;

        showToast("Client disponible: livraison confirmee par le commercial.", "success");
        showBrowserNotification(
          "Livraison confirmee",
          alert.body.replace("[CONFIRMATION COMMERCIALE] ", ""),
        );
        playRiderMessageSound();
        router.refresh();
      } catch {
        // Ignore malformed stream events; the periodic refresh remains active.
      }
    };

    source.addEventListener("rider-alert", handleCommercialConfirmation as EventListener);
    return () => source.close();
  }, [router, showToast]);

  const [selectedOrder, setSelectedOrder] = useState<RiderOrder | null>(null);
  const [partialMode, setPartialMode] = useState(false);
  const [includeDeliveryFee, setIncludeDeliveryFee] = useState(true);
  const [deliveredQuantities, setDeliveredQuantities] = useState<Record<string, number>>({});
  const [returnReasons, setReturnReasons] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [missionFilter, setMissionFilter] = useState("today");
  const [communeFilter, setCommuneFilter] = useState("");
  const [refreshing, refresh] = useTransition();
  const [statusReasonRequest, setStatusReasonRequest] = useState<StatusReasonRequest>(null);
  const [isPending, startTransition] = useTransition();

  // ── Derived Data ──
  const completedStatuses = useMemo(() => ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "CANCELLED", "REPRO_DISPO"], []);
  const activeAssignedOrders = useMemo(() => localOrders.filter((o) => !completedStatuses.includes(o.status)), [localOrders, completedStatuses]);
  const completedTodayOrders = useMemo(
    () => localOrders.filter((o) => completedStatuses.includes(o.status) && isSameDay(getHistoryEventDate(o))),
    [localOrders, completedStatuses],
  );
  const todayOrders = useMemo(() => {
    const byId = new Map<string, RiderOrder>();
    [...activeAssignedOrders, ...completedTodayOrders].forEach((order) => byId.set(order.id, order));
    return Array.from(byId.values());
  }, [activeAssignedOrders, completedTodayOrders]);
  const pending = useMemo(() => activeAssignedOrders, [activeAssignedOrders]);
  const history = useMemo(() => localOrders.filter((o) => completedStatuses.includes(o.status)), [localOrders, completedStatuses]);
  const filterBySearch = useCallback((base: RiderOrder[]) => {
    if (!searchQuery.trim()) return base;
    const q = searchQuery.toLowerCase();
    return base.filter((o) => (
      o.customerName?.toLowerCase().includes(q)
      || o.ref?.toLowerCase().includes(q)
      || o.customerLocation?.toLowerCase().includes(q)
      || o.commune?.toLowerCase().includes(q)
      || o.customerPhone?.toLowerCase().includes(q)
    ));
  }, [searchQuery]);

  const communes = Array.from(new Set(pending.map(o => o.commune).filter(Boolean))) as string[];
  const displayedOrders = useMemo(() => filterBySearch(pending).filter(o => {
    const late = Boolean(o.deliveryDate && new Date(o.deliveryDate).toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10));
    return (!communeFilter || o.commune === communeFilter) && (missionFilter === "all" || (missionFilter === "late" ? late : !late));
  }), [pending, filterBySearch, communeFilter, missionFilter]);

  const paidStatuses = useMemo(() => ["DELIVERED", "PARTIALLY_DELIVERED"], []);
  const deliveredTodayOrders = useMemo(
    () => history.filter((o) => paidStatuses.includes(o.status) && isSameDay(getHistoryEventDate(o))),
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
        const date = new Date(getHistoryEventDate(order));
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
    deliveredToday: deliveredTodayOrders.length,
    partiallyDeliveredToday: deliveredTodayOrders.filter((o) => o.status === "PARTIALLY_DELIVERED").length,
  }), [pending, ordersToSettle, deliveredTodayOrders]);
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

  const handleSupportAlert = useCallback((orderId: string, reason: string, details?: string) => {
    startTransition(async () => {
      try {
        const result = await sendOrderSupportAlert({ orderId, reason, details });
        showToast(`Alerte envoyee a ${result.target}`, "success");
        router.refresh();
      } catch (error: unknown) {
        showToast(error instanceof Error ? error.message : "Alerte impossible", "error");
      }
    });
  }, [router, showToast]);

  return (
    <div className="rider-app h-[100dvh] overflow-hidden flex flex-col">
      <RiderGlobalStyles />
      <div className="rider-shell max-w-md mx-auto relative h-full flex flex-col w-full overflow-hidden">
        {isOffline && (
          <div className="bg-[#B91C1C] text-white text-[10px] font-bold py-1 px-4 flex items-center justify-center gap-2 uppercase tracking-wider shrink-0">
            <WifiOff size={12} /> Hors ligne · actions suspendues
          </div>
        )}

        <header className="rider-topbar">
          <button className="rider-avatar" aria-label="Ouvrir mon compte" onClick={() => setActiveTab("profile")}>{user.name?.[0]?.toUpperCase()}</button>
          <div className="rider-brand">
            <span>ZANGO<span className="rider-brand-accent">CHAP</span> <small>RIDER</small></span>
            <p><i className={isOffline ? "offline" : ""} />{isOffline ? "Hors connexion" : "Bonjour, " + user.name.split(" ")[0]}</p>
          </div>
          <button aria-label="Actualiser" disabled={isOffline || refreshing} onClick={() => refresh(() => router.refresh())} className="rider-icon-button"><RefreshCw size={19} className={refreshing ? "animate-spin" : ""} /></button>
          <button onClick={openTeamChat} aria-label="Contacter le bureau" className="rider-icon-button rider-chat-button"><MessageCircle size={20} /></button>
        </header>

        <main className="rider-content flex-1 overflow-y-auto">
          {user.role?.toUpperCase() === "LIVREUR" && <RiderTracking riderId={user.id} settingsTarget={gpsSettingsTarget} openSettings={() => setActiveTab("profile")} />}
          <div className="rider-tour-summary">{activeTab === "missions" && (
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
                    <div className="h-full bg-[#F97316] rounded-full transition-all duration-500 ease-out" style={{ width: `${routeProgress}%` }} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <RouteStat label="Assignées" value={routeStats.total} tone="dark" />
                  <RouteStat label="Réussies" value={routeStats.completed} tone="green" />
                  <RouteStat label="À suivre" value={routeStats.issues} tone="orange" />
                </div>
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
          )}</div>
          <AnimatePresence mode="wait">
            {activeTab === "missions" && (
              <motion.div key="missions" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                <div className="rider-mission-filters mb-4 space-y-3">
                  <h2 className="text-xl font-bold text-slate-900">Mes missions <span className="text-sm text-slate-500">({displayedOrders.length})</span></h2>
                  <div className="flex gap-2">{[["all", "Toutes"], ["today", "Aujourd’hui"], ["late", "En retard"]].map(([key, label]) => <button key={key} aria-pressed={missionFilter === key} onClick={() => setMissionFilter(key)} className={`min-h-11 rounded-xl px-4 text-sm font-semibold border ${missionFilter === key ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"}`}>{label}</button>)}</div>
                  <select aria-label="Filtrer les missions par commune" value={communeFilter} onChange={e => setCommuneFilter(e.target.value)} className="h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-base"><option value="">Toutes les communes</option>{communes.map(c => <option key={c}>{c}</option>)}</select>
                </div>
                {displayedOrders.length === 0 ? (
                  <div className="rounded-md border border-[#E5E7EB] bg-white px-5 py-10 text-center">
                    <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-md bg-[#F3F4F6] text-[#475569]">
                      <Package size={22} />
                    </div>
                    <p className="text-sm font-black text-[#111827]">Aucune mission à traiter</p>
                    <p className="mx-auto mt-1 max-w-[260px] text-[12px] font-semibold leading-relaxed text-[#6B7280]">
                      Aucune mission ne correspond aux filtres. Les missions du jour et celles en retard apparaissent ici.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">{displayedOrders.map((o) => <OrderCard key={o.id} order={o} onClick={() => handleOpenOrder(o)} />)}</div>
                )}
              </motion.div>
            )}
            {activeTab === "history" && <RiderHistory onOpen={handleOpenOrder} />}
            {activeTab === "wallet" && <WalletView key="wallet" onOpen={handleOpenOrder} stats={stats} ordersToSettle={ordersToSettle} revenueHistory={revenueHistory} />}
            {activeTab === "profile" && <ProfileView key="profile" gpsSettingsRef={setGpsSettingsTarget} user={user} stats={stats} navigate={setActiveTab} logout={() => logoutAction()} />}
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
            onSupportAlert={handleSupportAlert}
            isPending={isPending || isOffline}
          />
        )}
        <StatusReasonModal
          request={statusReasonRequest}
          onClose={() => setStatusReasonRequest(null)}
          onConfirm={(reason, reproDeliveryDate) => {
            if (!statusReasonRequest) return;
            executeStatusUpdate(statusReasonRequest.orderId, statusReasonRequest.status, reason, undefined, reproDeliveryDate);
          }}
          isPending={isPending || isOffline}
        />
      </div>
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

