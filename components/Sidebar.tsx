"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { logoutAction } from "@/modules/auth/actions";
import { ROLE_LABELS } from "@/lib/constants";
import { hasSeenRiderAlert, markRiderAlertSeen, playRiderMessageSound, showBrowserNotification } from "@/lib/client-alerts";
import { useToast } from "@/components/Toast";
import RiderMessageAlertOverlay, { type RiderMessageAlert } from "@/components/RiderMessageAlertOverlay";
import { getLatestUnreadRiderMessage } from "@/modules/chat/actions";
import type { SidebarCounts } from "@/modules/orders/actions/sidebar-counts";

import {
  LayoutDashboard, ShoppingBag, Package, Truck, Box, Users, BarChart3,
  Upload, FileText, LogOut, ClipboardList,
  AlertTriangle, Settings, ChevronRight, ChevronLeft, History, Wallet, Warehouse,
  Image as ImageIcon, Menu, X, Bell, WifiOff,
  CheckCircle, Plus, Tag, MessageCircle, Undo2
} from "lucide-react";

interface SidebarProps {
  user: {
    id?: string;
    name: string;
    email: string;
    role: string;
    initials: string;
  };
  counts?: SidebarCounts;
}

type NavItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: number;
};

type NavSection = {
  title?: string;
  items: NavItem[];
};

const NAV_FOR_ROLE: Record<string, (counts: SidebarCounts) => NavSection[]> = {
  commercial: (counts) => [
    { items: [{ label: 'Dashboard', href: '/zangochap-manager/dashboard', icon: <LayoutDashboard size={18} /> }, { label: 'Répertoire', href: '/zangochap-manager/directory', icon: <Users size={18} /> }] },
    { title: 'Commandes', items: [{ label: 'Toutes les commandes', href: '/zangochap-manager/orders', icon: <ShoppingBag size={18} />, badge: counts.orders }, { label: 'À traiter (site)', href: '/zangochap-manager/orders/to-process', icon: <AlertTriangle size={18} />, badge: counts.toProcess }, { label: 'Fiche de rappel', href: '/zangochap-manager/orders/non-packed', icon: <Package size={18} /> }, { label: 'Nouvelle commande', href: '/zangochap-manager/orders/new', icon: <ClipboardList size={18} /> }] },
    { title: 'Catalogue', items: [{ label: 'Tous les produits', href: '/zangochap-manager/products', icon: <Box size={18} /> }, { label: 'Ajouter un produit', href: '/zangochap-manager/products/new', icon: <Plus size={18} /> }] },
    { title: 'Clients', items: [{ label: 'CRM Clients', href: '/zangochap-manager/admin/crm', icon: <Users size={18} /> }] },
  ],
  packing: (counts) => [
    { items: [{ label: 'Dashboard', href: '/zangochap-manager/dashboard', icon: <LayoutDashboard size={18} /> }, { label: 'Répertoire', href: '/zangochap-manager/directory', icon: <Users size={18} /> }] },
    { title: 'Commandes', items: [{ label: 'Toutes les commandes', href: '/zangochap-manager/orders', icon: <ShoppingBag size={18} />, badge: counts.orders }] },
    { title: 'Logistique', items: [{ label: 'Emballage', href: '/zangochap-manager/logistics/packing', icon: <Package size={18} />, badge: counts.packing }, { label: 'Fiche vérification', href: '/zangochap-manager/logistics/verification', icon: <FileText size={18} /> }, { label: 'Étiquettes', href: '/zangochap-manager/logistics/labels', icon: <Tag size={18} /> }] },
    { title: 'Catalogue', items: [{ label: 'Tous les produits', href: '/zangochap-manager/products', icon: <Box size={18} /> }, { label: 'Ajouter un produit', href: '/zangochap-manager/products/new', icon: <ClipboardList size={18} /> }] },
  ],
  collection: (counts) => [
    { items: [{ label: 'Dashboard', href: '/zangochap-manager/dashboard', icon: <LayoutDashboard size={18} /> }, { label: 'Répertoire', href: '/zangochap-manager/directory', icon: <Users size={18} /> }] },
    { title: 'Logistique', items: [{ label: 'Collecte', href: '/zangochap-manager/logistics/collection', icon: <Truck size={18} />, badge: counts.collection }] },
  ],
  stock: () => [
    { items: [{ label: 'Dashboard', href: '/zangochap-manager/dashboard', icon: <LayoutDashboard size={18} /> }, { label: 'Répertoire', href: '/zangochap-manager/directory', icon: <Users size={18} /> }] },
    { title: 'Inventaire', items: [{ label: 'Tous les produits', href: '/zangochap-manager/products', icon: <Box size={18} /> }, { label: 'Ruptures de stock', href: '/zangochap-manager/products/shortages', icon: <AlertTriangle size={18} /> }, { label: 'Historique stock', href: '/zangochap-manager/inventory/history', icon: <History size={18} /> }, { label: 'Entrepôts', href: '/zangochap-manager/logistics/warehouses', icon: <Warehouse size={18} /> }] },
  ],
  admin: (counts) => [
    { items: [{ label: 'Dashboard', href: '/zangochap-manager/dashboard', icon: <LayoutDashboard size={18} /> }, { label: 'Répertoire', href: '/zangochap-manager/directory', icon: <Users size={18} /> }] },
    {
      title: 'Commandes', items: [
        { label: 'Toutes les commandes', href: '/zangochap-manager/orders', icon: <ShoppingBag size={18} />, badge: counts.orders },
        { label: 'À traiter (site)', href: '/zangochap-manager/orders/to-process', icon: <AlertTriangle size={18} />, badge: counts.toProcess },
        { label: 'Fiche de rappel', href: '/zangochap-manager/orders/non-packed', icon: <Package size={18} /> },
        { label: 'Nouvelle commande', href: '/zangochap-manager/orders/new', icon: <ClipboardList size={18} /> }
      ]
    },
    {
      title: 'Logistique', items: [
        { label: 'Emballage', href: '/zangochap-manager/logistics/packing', icon: <Package size={18} />, badge: counts.packing },
        { label: 'Collecte', href: '/zangochap-manager/logistics/collection', icon: <Truck size={18} />, badge: counts.collection },
        { label: 'Entrepôts', href: '/zangochap-manager/logistics/warehouses', icon: <Warehouse size={18} /> },
        { label: 'Vérification', href: '/zangochap-manager/logistics/verification', icon: <CheckCircle size={18} /> },
        { label: 'Étiquettes', href: '/zangochap-manager/logistics/labels', icon: <Tag size={18} /> }
      ]
    },
    {
      title: 'Catalogue & Stock', items: [
        { label: 'Produits', href: '/zangochap-manager/products', icon: <Box size={18} /> },
        { label: 'Ruptures', href: '/zangochap-manager/products/shortages', icon: <AlertTriangle size={18} /> },
        { label: 'Répertoire', href: '/zangochap-manager/directory', icon: <Users size={18} /> },
        { label: 'Historique Stock', href: '/zangochap-manager/inventory/history', icon: <History size={18} /> },
        { label: 'CRM Clients', href: '/zangochap-manager/admin/crm', icon: <Users size={18} /> }
      ]
    },
    {
      title: 'Pilotage', items: [
        { label: 'Gestion Livraisons', href: '/zangochap-manager/admin/delivery', icon: <Truck size={18} /> },
        { label: 'Corrections livraison', href: '/zangochap-manager/admin/delivery/corrections', icon: <Undo2 size={18} /> },
        { label: 'Fiche d\'expédition', href: '/zangochap-manager/admin/delivery-sheet', icon: <FileText size={18} /> },
        { label: 'Galerie Media', href: '/zangochap-manager/media', icon: <ImageIcon size={18} /> },
        { label: 'CMS public', href: '/zangochap-manager/admin/cms', icon: <FileText size={18} /> },
        { label: 'Codes promo', href: '/zangochap-manager/admin/promos', icon: <Tag size={18} /> },
        { label: 'Top Produits', href: '/zangochap-manager/admin/top-products', icon: <BarChart3 size={18} /> },
        { label: 'Performance Équipe', href: '/zangochap-manager/admin/performance', icon: <BarChart3 size={18} /> },
        { label: 'Importation', href: '/zangochap-manager/admin/import', icon: <Upload size={18} /> },
        { label: 'Règlements', href: '/zangochap-manager/admin/settlements', icon: <Wallet size={18} /> },
        { label: 'Settings', href: '/zangochap-manager/admin/settings', icon: <Settings size={18} /> }
      ]
    },
  ],
  livreur: (counts) => [
    { items: [{ label: 'Mes Livraisons', href: '/zangochap-rider', icon: <Truck size={18} />, badge: counts.myDeliveries }, { label: 'Répertoire', href: '/zangochap-manager/directory', icon: <Users size={18} /> }] },
  ],
  developer: (counts) => {
    const adminNav = NAV_FOR_ROLE.admin(counts);
    return [
      ...adminNav,
      {
        title: 'Développement',
        items: [
          { label: 'Logs Système', href: '/zangochap-manager/developer/logs', icon: <FileText size={18} /> }
        ]
      }
    ];
  },
};

export default function Sidebar({ user, counts: initialCounts }: SidebarProps) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [hasNewNotifications, setHasNewNotifications] = useState(false);
  const [isNarrowDesktop, setIsNarrowDesktop] = useState(false);
  const [riderAlert, setRiderAlert] = useState<RiderMessageAlert | null>(null);
  const { showToast } = useToast();

  const defaultCounts: SidebarCounts = { orders: 0, packing: 0, collection: 0, toProcess: 0, myDeliveries: 0, chatUnread: 0, riderChatUnread: 0 };

  // Fetch counts via a lightweight API. The API derives the user from the session.
  const { data: counts = defaultCounts } = useQuery<SidebarCounts>({
    queryKey: ['sidebar-counts'],
    queryFn: async () => {
      const res = await fetch('/api/sidebar-counts');
      if (!res.ok) return defaultCounts;
      return (await res.json()) as SidebarCounts;
    },
    initialData: initialCounts || defaultCounts,
    refetchInterval: 8_000,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  const roleKey = user.role?.toLowerCase() || 'admin';
  const sections = useMemo(() => (NAV_FOR_ROLE[roleKey] || NAV_FOR_ROLE.admin)(counts), [roleKey, counts]);
  const roleLabel = ROLE_LABELS[user.role] || user.role;
  const effectiveCollapsed = isCollapsed || isNarrowDesktop;
  const showRiderAlert = useCallback((alert: RiderMessageAlert) => {
    if (hasSeenRiderAlert(alert.id)) return;

    markRiderAlertSeen(alert.id);
    setHasNewNotifications(true);
    playRiderMessageSound();
    showToast("Nouveau message d'un livreur", "success");
    showBrowserNotification("Message livreur ZangoChap", `${alert.senderName}: ${alert.body.slice(0, 140)}`);
    setRiderAlert(alert);
  }, [showToast]);

  // Track Online/Offline Status
  useEffect(() => {
    setMounted(true);
    setIsOffline(!navigator.onLine);
    const narrowDesktopQuery = window.matchMedia("(min-width: 1024px) and (max-width: 1180px)");
    const handleNarrowDesktopChange = () => setIsNarrowDesktop(narrowDesktopQuery.matches);

    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    handleNarrowDesktopChange();
    narrowDesktopQuery.addEventListener('change', handleNarrowDesktopChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      narrowDesktopQuery.removeEventListener('change', handleNarrowDesktopChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/chat/rider-alerts/stream");

    source.addEventListener("rider-alert", (event) => {
      try {
        showRiderAlert(JSON.parse((event as MessageEvent).data) as RiderMessageAlert);
      } catch {
        // Keep the fallback polling path alive if an event is malformed.
      }
    });

    return () => source.close();
  }, [showRiderAlert]);

  // Counts tracking
  const prevCounts = useRef<SidebarCounts | null>(null);
  const prevRiderAlertCount = useRef<number | null>(null);
  useEffect(() => {
    if (!prevCounts.current) {
      prevCounts.current = counts;
      return;
    }

    const newPacking = (counts.packing || 0) > (prevCounts.current.packing || 0);
    const newOrders = (counts.orders || 0) > (prevCounts.current.orders || 0);
    const newRiderMessage = (counts.riderChatUnread || 0) > (prevCounts.current.riderChatUnread || 0);

    if (newPacking || newOrders || newRiderMessage) setHasNewNotifications(true);
    if (newRiderMessage && pathname === "__polling_rider_alert_disabled__") {
      playRiderMessageSound();
      showToast("Nouveau message d'un livreur", "success");
      showBrowserNotification("Message livreur ZangoChap", "Un livreur a envoyé une alerte dans le chat interne.");
    }

    prevCounts.current = counts;
  }, [counts, pathname, showToast]);

  useEffect(() => {
    if (pathname === "/zangochap-manager/chat") {
      prevRiderAlertCount.current = counts.riderChatUnread || 0;
      return;
    }

    if (prevRiderAlertCount.current === null) {
      prevRiderAlertCount.current = counts.riderChatUnread || 0;
      return;
    }

    const hasNewRiderAlert = (counts.riderChatUnread || 0) > prevRiderAlertCount.current;
    prevRiderAlertCount.current = counts.riderChatUnread || 0;
    if (!hasNewRiderAlert) return;

    getLatestUnreadRiderMessage()
      .then((message) => {
        showRiderAlert(message || {
          id: `rider-alert-${Date.now()}`,
          senderName: "Livreur",
          body: "Un livreur a envoye une alerte dans le chat interne.",
        });
      })
      .catch(() => {
        showRiderAlert({
          id: `rider-alert-${Date.now()}`,
          senderName: "Livreur",
          body: "Un livreur a envoye une alerte dans le chat interne.",
        });
      });
  }, [counts.riderChatUnread, pathname, showRiderAlert]);

  useEffect(() => {
    setIsMobileOpen(false);
    setShowNotifications(false);
  }, [pathname]);

  return (
    <>
      <AnimatePresence>
        {riderAlert && (
          <RiderMessageAlertOverlay
            alert={riderAlert}
            onClose={() => setRiderAlert(null)}
          />
        )}
      </AnimatePresence>

      {/* MOBILE TOP BAR */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-[60px] bg-white border-b border-[#E5E5EA] flex items-center justify-between px-4 z-[9999] text-[#1C1C1E]">
        <button className="bg-transparent border-none p-2 relative" onClick={() => setIsMobileOpen(true)}><Menu size={24} /></button>
        <div className="flex items-center">
          <img src="/logo.png" alt="Logo" width="100" height="30" className="h-auto block object-contain" />
          {mounted && isOffline && <WifiOff size={14} color="#FF3B30" className="ml-2" />}
        </div>
        <button className="bg-transparent border-none p-2 relative" onClick={() => setShowNotifications(!showNotifications)}>
          <Bell size={22} color={mounted && hasNewNotifications ? 'var(--orange)' : '#8E8E93'} />
          {mounted && hasNewNotifications && <span className="absolute top-2 right-2 w-2 h-2 bg-[#FF3B30] rounded-full border-2 border-white" />}
        </button>
      </div>

      {/* OVERLAY */}
      <AnimatePresence>
        {isMobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsMobileOpen(false)}
            className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[10000] lg:hidden"
          />
        )}
      </AnimatePresence>

      <aside
        className={`
          fixed inset-y-0 left-0 z-[99999] w-[280px] bg-[#0F1115] text-white flex flex-col border-r border-white/5 transition-all duration-300 ease-in-out
          ${isMobileOpen ? 'translate-x-0 shadow-[20px_0_50px_rgba(0,0,0,0.5)]' : '-translate-x-full'}
          lg:translate-x-0 lg:static lg:h-screen lg:z-10
          ${effectiveCollapsed ? 'lg:w-[76px]' : 'lg:w-[260px]'}
        `}
      >
        <div className="p-5 flex justify-between items-center">
          <div className="flex items-center">
            <Link href="/zangochap-manager/dashboard" className="flex items-center">
              {!effectiveCollapsed ? (
                <img src="/logo.png" alt="ZANGOCHAP" width="140" height="40" className="h-auto block" />
              ) : (
                <div className="w-10 h-10 bg-[#FF6B2C] rounded-xl flex items-center justify-center font-black text-[22px] text-white">Z</div>
              )}
            </Link>
          </div>

          <div className="flex gap-2 items-center">
            {mounted && isOffline && (
              <div className="bg-red-500/10 text-red-500 w-8 h-8 rounded-[10px] flex items-center justify-center" title="Mode hors-ligne">
                <WifiOff size={16} />
              </div>
            )}
            <button
              className={`
                bg-white/5 border-none text-white/40 w-9 h-9 rounded-[10px] flex items-center justify-center relative cursor-pointer transition-all duration-200
                hover:bg-white/10 hover:text-white
                ${hasNewNotifications ? 'text-[#FF6B2C] bg-white/10' : ''}
              `}
              onClick={() => { setShowNotifications(!showNotifications); setHasNewNotifications(false); }}
            >
              <Bell size={20} />
              {mounted && hasNewNotifications && (
                <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-[#FF3B30] rounded-full border-2 border-[#0F1115]" />
              )}
            </button>
            <button className="lg:hidden flex bg-white/5 border-none text-white w-8 h-8 rounded-lg items-center justify-center" onClick={() => setIsMobileOpen(false)}><X size={20} /></button>
          </div>
        </div>

        {/* OFFLINE STATUS BANNER */}
        {mounted && isOffline && (
          <div className="bg-[#FF3B30] text-white text-[10px] font-extrabold uppercase p-1.5 flex items-center justify-center gap-1.5 tracking-wider">
            <WifiOff size={12} />
            <span>Mode hors-ligne</span>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-3.5 py-2 scrollbar-hide">
          <div className="flex flex-col gap-6">
            {sections.map((section, sIdx) => (
              <div key={sIdx}>
                {section.title && !effectiveCollapsed && (
                  <div className="text-[10px] font-extrabold uppercase text-white/25 px-3 mb-3 tracking-wider">
                    {section.title}
                  </div>
                )}
                <div className="flex flex-col gap-0.5">
                  {section.items.map((item) => {
                    const isActive = pathname === item.href || (item.href !== '/zangochap-manager/dashboard' && pathname.startsWith(item.href));
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`
                          flex items-center justify-between p-[11px_12px] rounded-xl text-[13px] font-semibold transition-all duration-200 no-underline mb-0.5
                          ${isActive ? 'bg-[#FF6B2C]/10 text-[#FF6B2C] font-bold' : 'text-white/40 hover:bg-white/[0.03] hover:text-white'}
                        `}
                      >
                        <div className="flex items-center gap-3">
                          <span className={`flex items-center ${isActive ? 'opacity-100 text-[#FF6B2C]' : 'opacity-60'}`}>{item.icon}</span>
                          {!effectiveCollapsed && <span>{item.label}</span>}
                        </div>
                        {mounted && typeof item.badge === "number" && item.badge > 0 && (
                          <span className="bg-[#FF6B2C] text-white text-[10px] font-black px-1.5 py-0.5 rounded-md">
                            {item.badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <div className="p-4 flex flex-col gap-3">
          <Link
            href="/zangochap-manager/chat"
            className={`
              flex items-center justify-between p-[11px_12px] rounded-xl text-[13px] font-semibold transition-all duration-200 no-underline
              ${pathname === "/zangochap-manager/chat" ? "bg-[#FF6B2C]/10 text-[#FF6B2C] font-bold" : "bg-white/[0.03] text-white/55 hover:bg-white/[0.06] hover:text-white"}
            `}
          >
            <div className="flex items-center gap-3">
              <MessageCircle size={18} />
              {!effectiveCollapsed && <span>Chat equipe</span>}
            </div>
            {mounted && !effectiveCollapsed && counts.chatUnread > 0 && (
              <span className="bg-[#FF6B2C] text-white text-[10px] font-black px-1.5 py-0.5 rounded-md">
                {counts.chatUnread}
              </span>
            )}
          </Link>
          <div className="flex items-center gap-3 bg-white/[0.03] border border-white/[0.06] p-2.5 rounded-2xl">
            <div className="flex items-center gap-2.5 flex-1 min-w-0">
              <div className="w-[38px] h-[38px] bg-[#FF6B2C] rounded-[10px] flex items-center justify-center font-extrabold text-[13px] text-white">
                {user.initials}
              </div>
              {!effectiveCollapsed && (
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-white whitespace-nowrap overflow-hidden text-ellipsis">
                    {user.name}
                  </div>
                  <div className="text-[#FF6B2C] text-[9px] font-extrabold uppercase">
                    {roleLabel}
                  </div>
                </div>
              )}
            </div>
            {!effectiveCollapsed && (
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="w-8 h-8 flex items-center justify-center rounded-[10px] bg-white/5 text-white/30 border-none cursor-pointer transition-colors hover:bg-red-500 hover:text-white"
                >
                  <LogOut size={14} />
                </button>
              </form>
            )}
          </div>
          <button
            className="hidden lg:flex bg-transparent border-none text-white/20 text-[11px] font-bold p-[8px_12px] cursor-pointer items-center gap-2"
            onClick={() => setIsCollapsed(!isCollapsed)}
          >
            {effectiveCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            {!effectiveCollapsed && <span>Réduire</span>}
          </button>
        </div>
      </aside>


    </>
  );
}
