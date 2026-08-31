"use client";

import React, { useState, useMemo } from "react";
import { Printer, Search, Loader2 } from "lucide-react";
import { EmptyState, StatCard } from "@/components/UI";
import { formatDay } from "@/lib/constants";
import { useVerificationData } from "./hooks";
import OrderCard from "./OrderCard";
import ImageLightbox from "./ImageLightbox";
import type { PreviewItemData } from "./types";

export default function VerificationClient() {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [previewItem, setPreviewItem] = useState<PreviewItemData | null>(null);
  const [search, setSearch] = useState("");
  const [verificationFilter, setVerificationFilter] = useState("all");
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");

  const { orders, isLoading, verifyingOrderId, verifyingItemIds, toggleItem, toggleAllOrderItems } =
    useVerificationData(date);

  // ── Date shortcuts ──
  const setToday = () => setDate(new Date().toISOString().split("T")[0]);
  const setYesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    setDate(d.toISOString().split("T")[0]);
  };
  const setTomorrow = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    setDate(d.toISOString().split("T")[0]);
  };

  // ── Filters ──
  const visibleOrders = useMemo(() => orders.filter(order => (order.items?.length || 0) > 0), [orders]);

  const filteredOrders = useMemo(() => {
    const q = search.toLowerCase();
    return visibleOrders.filter(order => {
      const matchesSearch =
        !q ||
        (order.ref || "").toLowerCase().includes(q) ||
        (order.customerName || "").toLowerCase().includes(q) ||
        (order.customerPhone || "").toLowerCase().includes(q) ||
        order.items?.some(item => (item.name || "").toLowerCase().includes(q));

      const matchesStatus = orderStatusFilter === "all" || order.status === orderStatusFilter;

      const hasUnchecked = order.items?.some(item => !item.isVerified);
      const matchesVerification =
        verificationFilter === "all" ||
        (verificationFilter === "checked" && !hasUnchecked) ||
        (verificationFilter === "unchecked" && hasUnchecked);

      return matchesSearch && matchesStatus && matchesVerification;
    });
  }, [visibleOrders, search, orderStatusFilter, verificationFilter]);

  // ── Stats ──
  const totalOrders = visibleOrders.length;
  const totalItems = useMemo(
    () => visibleOrders.reduce((s, o) => s + (o.items?.reduce((itemSum, item) => itemSum + (item.qty || 0), 0) || 0), 0),
    [visibleOrders]
  );
  const checkedItemsCount = useMemo(
    () =>
      visibleOrders.reduce(
        (s, o) => s + (o.items?.reduce((itemSum, item) => itemSum + (item.isVerified ? item.qty || 0 : 0), 0) || 0),
        0
      ),
    [visibleOrders]
  );
  const progress = totalItems > 0 ? (checkedItemsCount / totalItems) * 100 : 0;

  // ── Date button helper ──
  const isDateActive = (offset: number) =>
    date === new Date(Date.now() + offset * 86400000).toISOString().split("T")[0];
  const dateBtnClass = (active: boolean) =>
    `px-2.5 py-1 rounded text-xs font-bold transition-all ${active ? "bg-orange-500 text-white" : "text-gray-600 hover:bg-white hover:text-gray-900"}`;
  const filterBtnClass = (active: boolean) =>
    `px-2.5 py-1 rounded text-xs font-bold transition-all ${active ? "bg-orange-500 text-white" : "text-gray-600 hover:bg-white hover:text-gray-900"}`;

  return (
    <div className="w-full p-5 animate-fade-in print:bg-white print:p-0">
      <p className="mb-3 text-sm text-gray-600 print:hidden">La vérification est un contrôle distinct : cocher un article ici ne modifie pas son emballage.</p>
      {/* CONTROLS */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 md:p-4 rounded-md mb-6 border border-gray-200 print:hidden">
        <div className="flex items-center gap-2.5">
          <div className="flex gap-1 bg-gray-100 p-1 rounded-md border border-gray-200">
            <button className={dateBtnClass(isDateActive(0))} onClick={setToday}>Auj.</button>
            <button className={dateBtnClass(isDateActive(-1))} onClick={setYesterday}>Hier</button>
            <button className={dateBtnClass(isDateActive(1))} onClick={setTomorrow}>Dem.</button>
          </div>
          <input
            type="date"
            className="px-2.5 py-1 rounded-md border border-orange-200 text-sm font-bold text-gray-800 bg-orange-50/30 focus:border-orange-500 focus:bg-white focus:outline-none transition-colors"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
          {isLoading && <Loader2 size={16} className="animate-spin text-orange-500" />}
        </div>

        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher une réf, un client ou un produit..."
            className="w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-md text-sm font-medium text-gray-800 placeholder-gray-400 focus:bg-white focus:border-orange-500 focus:outline-none transition-colors"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2.5">
          <select
            className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-md text-sm font-bold text-gray-800 focus:bg-white focus:border-orange-500 focus:outline-none transition-colors"
            value={orderStatusFilter}
            onChange={e => setOrderStatusFilter(e.target.value)}
          >
            <option value="all">Tous les états</option>
            <option value="CONFIRMED">Confirmées</option>
            <option value="PACKED">Emballées</option>
            <option value="ON_DELIVERY">En livraison</option>
            <option value="DELIVERED">Livrées</option>
          </select>
        </div>

        <div className="flex gap-1 bg-gray-100 p-1 rounded-md border border-gray-200">
          <button className={filterBtnClass(verificationFilter === "all")} onClick={() => setVerificationFilter("all")}>Tous</button>
          <button className={filterBtnClass(verificationFilter === "unchecked")} onClick={() => setVerificationFilter("unchecked")}>À vérifier</button>
          <button className={filterBtnClass(verificationFilter === "checked")} onClick={() => setVerificationFilter("checked")}>Vérifiés</button>
        </div>

        {visibleOrders.length > 0 && (
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-md text-sm font-bold transition-colors cursor-pointer"
            onClick={() => window.open(`/zangochap-manager/logistics/verification/print?date=${date}&type=created&autoprint=true`, '_blank')}
          >
            <Printer size={15} /> Imprimer Fiche
          </button>
        )}
      </div>

      {/* STATS */}
      {visibleOrders.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6 print:hidden">
          <StatCard label="Colis du jour" value={totalOrders} accent />
          <StatCard label="Articles du jour" value={totalItems} />
          <div className="bg-white rounded-md p-3 md:p-4 border border-gray-200 flex flex-col justify-center">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs font-semibold text-gray-500">Vérification terminée</span>
              <span className="text-xs font-extrabold text-orange-500">{checkedItemsCount} / {totalItems}</span>
            </div>
            <div className="h-1 bg-gray-100 rounded overflow-hidden">
              <div className="h-full bg-orange-500 transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* PRINT STYLES */}
      <style>{`
        @media print {
          /* FORCE EVERY PARENT TO EXPAND */
          html, body, #__next, [data-nextjs-scroll-focus-boundary], .app-container, .main-content, .main-scroll-area, main, div {
            height: auto !important;
            min-height: auto !important;
            overflow: visible !important;
            display: block !important;
            position: static !important;
          }

          /* Reset sidebar */
          .sidebar, .sidebar-root, aside, nav, .topbar {
            display: none !important;
          }

          /* Hide UI elements */
          .print-hidden, button:not(.print-show), .controls-bar {
            display: none !important;
          }

          /* Reset body and background */
          body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Card optimizations for high-density printing */
          .animate-fade-in {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
          }

          /* Ensure cards don't split mid-content */
          .print\\:break-inside-avoid {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
            margin-bottom: 20px !important;
            display: block !important;
          }

          /* Fix table headers and rows */
          thead { display: table-header-group !important; }
          tr { break-inside: avoid !important; }

          /* Strong borders for print */
          .border, .border-b, .border-t, .border-l, .border-r {
            border-color: #000 !important;
            border-style: solid !important;
            border-width: 1px !important;
          }
          table {
            border-collapse: collapse !important;
          }
          th, td {
            border: 1px solid #000 !important;
          }

          /* Clean references: Bold, no background */
          .font-mono {
            background: transparent !important;
            border: none !important;
            font-weight: 900 !important;
            color: #000 !important;
            font-size: 18px !important;
            padding: 0 !important;
            letter-spacing: -0.5px !important;
          }
        }
      `}</style>

      {/* PRINT HEADER */}
      <div className="hidden print:block mb-6">
        <div className="flex justify-between items-end mb-4">
          <div>
            <h1 className="text-3xl font-black text-black m-0 tracking-tight">ZANGOCHAP</h1>
            <p className="text-sm text-gray-600 mt-1">Logistique & Vérification · Fiche de sortie du {formatDay(date)}</p>
          </div>
          <div className="text-right">
            <div className="text-xs font-semibold text-gray-600">{totalOrders} colis · {totalItems} articles du jour</div>
          </div>
        </div>
        <div className="h-0.5 bg-black w-full mb-6" />
      </div>

      {/* ORDERS LIST */}
      <div className="w-full space-y-4 print:space-y-4">
        {visibleOrders.length === 0 ? (
          <EmptyState
            icon="📋"
            title={isLoading ? "Chargement..." : "Aucune donnée"}
            description={isLoading ? "Veuillez patienter..." : "Sélectionnez une date et chargez les commandes."}
          />
        ) : filteredOrders.length === 0 ? (
          <EmptyState icon="🔍" title="Aucun résultat" description="Aucune commande ne correspond à votre recherche ou filtre." />
        ) : (
          filteredOrders.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              verifyingOrderId={verifyingOrderId}
              verifyingItemIds={verifyingItemIds}
              onToggleItem={toggleItem}
              onToggleAll={toggleAllOrderItems}
              onPreview={setPreviewItem}
            />
          ))
        )}
      </div>

      {/* LIGHTBOX */}
      {previewItem && <ImageLightbox item={previewItem} onClose={() => setPreviewItem(null)} />}
    </div>
  );
}
