"use client";

import React, { useState, useTransition, useMemo } from "react";
import { TableCard, EmptyState, StatusBadge } from "@/components/UI";
import { useToast } from "@/components/Toast";
import { ChevronDown, Eye, FileText, Filter, Package, RefreshCw, Search, X } from "lucide-react";
import { useIsMobile } from "@/lib/hooks";
import { STATUS_LABELS } from "@/lib/constants";
import { AnimatePresence } from "framer-motion";
import { updateOrderStatus } from "@/modules/orders/actions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import NonPackedModal from "./_components/NonPackedModal";
import NonPackedItem from "./_components/NonPackedItem";
import { ReminderMotif } from "./_components/ReminderMotif";
import "./non-packed-client.css";

type NonPackedPeriod = "today" | "yesterday" | "all";
type ReminderTypeFilter = "all" | "notPacked" | "alternatives";

interface NonPackedClientProps {
  notPacked: any[];
  withAlternatives: any[];
  user: any;
}

const PERIOD_OPTIONS: { value: NonPackedPeriod; label: string }[] = [
  { value: "today", label: "Aujourd'hui" },
  { value: "yesterday", label: "Hier" },
  { value: "all", label: "Tout" },
];

const PERIOD_META: Record<NonPackedPeriod, string> = {
  today: "d'aujourd'hui",
  yesterday: "d'hier",
  all: "de toutes les dates",
};

const TYPE_OPTIONS: { value: ReminderTypeFilter; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "notPacked", label: "Indisponibles" },
  { value: "alternatives", label: "Alternatives" },
];

export default function NonPackedClient({
  notPacked: initialNotPacked,
  withAlternatives: initialAlternatives,
  user,
}: NonPackedClientProps) {
  const [selectedOrder, setSelectedOrder] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [periodFilter, setPeriodFilter] = useState<NonPackedPeriod>("yesterday");
  const [typeFilter, setTypeFilter] = useState<ReminderTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [commercialFilter, setCommercialFilter] = useState("all");
  const [isPending, startTransition] = useTransition();
  const { showToast } = useToast();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const isAdmin = user?.role?.toLowerCase() === "admin" || user?.role?.toLowerCase() === "developer";
  const nonPackedQueryKey = useMemo(() => ['non-packed-orders', periodFilter] as const, [periodFilter]);

  // React Query — smooth background polling, no page flash
  const { data, isFetching } = useQuery({
    queryKey: nonPackedQueryKey,
    queryFn: async () => {
      const res = await fetch(`/api/orders/non-packed?period=${periodFilter}`);
      if (!res.ok) throw new Error('Erreur');
      return res.json();
    },
    initialData: periodFilter === "yesterday"
      ? {
          notPacked: initialNotPacked,
          withAlternatives: initialAlternatives,
        }
      : undefined,
    refetchInterval: 10_000,
    staleTime: 0,
  });

  const notPacked = useMemo(
    () => data?.notPacked ?? (periodFilter === "yesterday" ? initialNotPacked : []),
    [data?.notPacked, initialNotPacked, periodFilter],
  );
  const withAlternatives = useMemo(
    () => data?.withAlternatives ?? (periodFilter === "yesterday" ? initialAlternatives : []),
    [data?.withAlternatives, initialAlternatives, periodFilter],
  );
  const reminderOrders = useMemo(
    () => [...notPacked, ...withAlternatives],
    [notPacked, withAlternatives],
  );

  const handleStatusChange = (orderId: string, status: string) => {
    // Optimistic Update: Remove from list immediately
    const previousData = queryClient.getQueryData(nonPackedQueryKey);
    queryClient.setQueryData(nonPackedQueryKey, (old: any) => {
      if (!old) return old;
      return {
        ...old,
        notPacked: old.notPacked.filter((o: any) => o.id !== orderId),
        withAlternatives: old.withAlternatives.filter((o: any) => o.id !== orderId),
      };
    });

    startTransition(async () => {
      try {
        const result = await updateOrderStatus(orderId, status);
        if (!result.success) throw new Error(result.error);
        showToast('Statut mis à jour ✓', 'success');
        setSelectedOrder(null);
      } catch (e: any) {
        // Rollback on error
        queryClient.setQueryData(nonPackedQueryKey, previousData);
        showToast(e.message || 'Erreur', 'error');
      } finally {
        // Final sync
        queryClient.invalidateQueries({ queryKey: nonPackedQueryKey });
      }
    });
  };

  const commercialOptions = useMemo<string[]>(() => {
    return Array.from(new Set<string>(
      reminderOrders
        .map((order: any) => order.commercialName)
        .filter((commercial: unknown): commercial is string => typeof commercial === "string" && commercial.length > 0)
    )).sort((a, b) => a.localeCompare(b));
  }, [reminderOrders]);

  const statusOptions = useMemo<string[]>(() => {
    return Array.from(new Set<string>(
      reminderOrders
        .map((order: any) => order.status)
        .filter((status: unknown): status is string => typeof status === "string" && status.length > 0)
    )).sort();
  }, [reminderOrders]);

  const statusCounts = useMemo<Record<string, number>>(() => {
    return reminderOrders.reduce((counts: Record<string, number>, order: any) => {
      if (typeof order.status === "string" && order.status.length > 0) {
        counts[order.status] = (counts[order.status] || 0) + 1;
      }
      return counts;
    }, {});
  }, [reminderOrders]);

  const commercialCounts = useMemo<Record<string, number>>(() => {
    return reminderOrders.reduce((counts: Record<string, number>, order: any) => {
      if (typeof order.commercialName === "string" && order.commercialName.length > 0) {
        counts[order.commercialName] = (counts[order.commercialName] || 0) + 1;
      }
      return counts;
    }, {});
  }, [reminderOrders]);

  const filterReminders = (orders: any[]) => {
    const normalizedSearch = search.trim().toLowerCase();

    return orders.filter((order: any) => {
      const searchableText = [
        order.ref,
        order.customerName,
        order.customerPhone,
        order.commune,
        order.motif,
        ...(order.motifs || []),
        order.commercialName,
        ...(order.items || []).map((item: any) => item.name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch = !normalizedSearch || searchableText.includes(normalizedSearch);
      const matchesStatus = statusFilter === "all" || order.status === statusFilter;
      const matchesCommercial = commercialFilter === "all"
        || order.commercialName === commercialFilter;

      return matchesSearch && matchesStatus && matchesCommercial;
    });
  };

  const filteredNotPacked = typeFilter === "alternatives" ? [] : filterReminders(notPacked);
  const filteredAlternatives = typeFilter === "notPacked" ? [] : filterReminders(withAlternatives);
  const totalCount = filteredNotPacked.length + filteredAlternatives.length;
  const rawTotalCount = notPacked.length + withAlternatives.length;
  const activeFilterCount = [
    search.trim(),
    typeFilter !== "all",
    statusFilter !== "all",
    commercialFilter !== "all",
  ].filter(Boolean).length;

  const handlePeriodChange = (period: NonPackedPeriod) => {
    setPeriodFilter(period);
    setTypeFilter("all");
    setStatusFilter("all");
    setCommercialFilter("all");
  };

  const resetFilters = () => {
    setSearch("");
    setTypeFilter("all");
    setStatusFilter("all");
    setCommercialFilter("all");
  };

  const OrderSection = ({ orders, title, meta, showCommercial = false, grouped = false, reminderKind = "notPacked" }: { orders: any[], title: string, meta: string, showCommercial?: boolean, grouped?: boolean, reminderKind?: "notPacked" | "alternative" }) => {
    const isAlternativeSection = reminderKind === "alternative";
    
    const renderGroupedOrders = () => {
      const byCommercial: Record<string, any[]> = {};
      orders.forEach((o: any) => {
        const c = o.commercialName || 'Inconnu';
        if (!byCommercial[c]) byCommercial[c] = [];
        byCommercial[c].push(o);
      });

      return Object.entries(byCommercial).map(([commName, list]) => (
        <div key={commName} style={{ borderBottom: '1px solid var(--line)', padding: '16px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, padding: '0 16px' }}>
             <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--ink)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800 }}>
                {commName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
             </div>
             <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
               {commName} <span style={{ color: '#8E8E93', fontWeight: 400, fontSize: 12, marginLeft: 6 }}>· {list.length} commande(s)</span>
             </h3>
          </div>
          <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {list.map((o: any) => (
              <div 
                key={o.id} 
                onClick={() => setSelectedOrder(o)}
                style={{ 
                  background: 'var(--cream)', 
                  borderRadius: 10, 
                  padding: '10px 14px', 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center', 
                  gap: 12,
                  cursor: 'pointer',
                  border: '1px solid transparent',
                  transition: 'all 0.2s'
                }}
                className="hover-card"
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="cell-mono" style={{ color: 'var(--orange)', fontWeight: 700, fontSize: 13 }}>{o.ref}</span>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{o.customerName}</span>
                    {isAlternativeSection && <span className="non-packed-alternative-badge">Alternative proposée</span>}
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <ReminderMotif motif={o.motif} motifs={o.motifs} compact />
                  </div>
                </div>
                <StatusBadge status={o.status} size="sm" />
                <button className="action-btn" style={{ background: 'white' }}>
                  <Eye size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ));
    };

    if (isMobile) {
      return (
        <div style={{ marginBottom: 30 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12, padding: '0 4px' }}>
            <h2 style={{ fontSize: 18, fontWeight: 800 }}>{title}</h2>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--orange)' }}>{meta}</span>
          </div>
          {orders.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', background: 'white', borderRadius: 20, border: '1px dashed #E5E5EA' }}>
              <Package size={40} style={{ margin: '0 auto 12px', opacity: 0.2 }} />
              <p style={{ color: '#8E8E93', fontSize: 13 }}>Aucune commande</p>
            </div>
          ) : (
            grouped ? renderGroupedOrders() : 
            orders.map((o: any, i: number) => (
              <NonPackedItem 
                key={o.id} 
                order={o} 
                isMobile={true} 
                idx={i} 
                showCommercial={showCommercial}
                reminderKind={reminderKind}
                onSelect={setSelectedOrder} 
              />
            ))
          )}
        </div>
      );
    }

    return (
      <TableCard title={title} meta={meta}>
        {orders.length === 0 ? (
          <EmptyState icon="✓" title="Tout est emballé" description="Aucune commande dans cette section." />
        ) : grouped ? (
          <div style={{ padding: '0' }}>{renderGroupedOrders()}</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Réf.</th>
                <th>Client</th>
                <th>Articles</th>
                <th style={{ width: 220 }}>Motif / État Logistique</th>
                {showCommercial && <th>Commercial</th>}
                <th>Statut</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order: any) => (
                <NonPackedItem 
                  key={order.id} 
                  order={order} 
                  isMobile={false} 
                  showCommercial={showCommercial}
                  reminderKind={reminderKind}
                  onSelect={setSelectedOrder} 
                />
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    );
  };

  return (
    <div className={`content animate-fade-in ${isMobile ? 'mobile-root' : ''}`} style={{ padding: isMobile ? '16px' : '20px' }}>
      
      {/* HEADER */}
      <div style={{ 
        display: 'flex', 
        flexDirection: isMobile ? 'column' : 'row', 
        justifyContent: 'space-between', 
        alignItems: isMobile ? 'stretch' : 'center', 
        gap: 16, 
        marginBottom: 20 
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FileText size={20} color="var(--orange)" />
            <h1 style={{ fontSize: isMobile ? 22 : 24, fontWeight: 900 }}>Fiche de rappel</h1>
            {isFetching && <RefreshCw size={14} className="animate-spin" style={{ color: 'var(--orange)', opacity: 0.5 }} />}
          </div>
          <p style={{ fontSize: 13, color: '#8E8E93', fontWeight: 500, marginTop: 4 }}>
            Indisponibles et alternatives à rappeler pour les commandes {PERIOD_META[periodFilter]}.
          </p>
        </div>

      </div>

      {/* FILTERS SECTION */}
      <div className="flex flex-col gap-4 mb-6">
        
        {/* Search Bar */}
        <div className="relative">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--brown-soft)]" />
          <input
            type="text"
            className="w-full pl-10 rounded-xl h-[42px] text-[13px] font-medium border border-[var(--line)] bg-[#FCFAF7] outline-none focus:border-[var(--orange)] focus:ring-2 focus:ring-[var(--orange)]/10"
            placeholder="Rechercher par réf, client, téléphone, commune, motif, article..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search.trim() && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-[#DEE2E6] border-none w-[22px] h-[22px] rounded-full flex items-center justify-center cursor-pointer text-[var(--brown-soft)] hover:text-[var(--orange)] transition-colors"
              aria-label="Effacer la recherche"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Filters Grid */}
        <div className="flex flex-col gap-4 bg-white p-4 rounded-xl border border-[var(--line)] shadow-sm">
          
          {/* Header of filters box */}
          <div className="flex justify-between items-center border-b border-[var(--line)] pb-3">
            <div className="flex items-center gap-2">
              <Filter size={16} color="var(--orange)" />
              <span className="text-[13px] font-extrabold text-[var(--ink)]">Filtres</span>
              {activeFilterCount > 0 && (
                <span className="bg-[var(--orange)] text-white text-[11px] font-bold px-1.5 py-0.5 rounded-md">
                  {activeFilterCount} actif{activeFilterCount > 1 ? 's' : ''}
                </span>
              )}
            </div>
            {activeFilterCount > 0 && (
              <button 
                onClick={resetFilters}
                className="text-xs text-[var(--brown-soft)] bg-transparent border-none cursor-pointer flex items-center gap-1 font-semibold hover:text-[var(--orange)] transition-colors"
              >
                <X size={14} /> Effacer
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-5 items-start">
            
            {/* Period Filter (Segmented Control) */}
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-bold text-[var(--brown-soft)] uppercase tracking-wide">Période</span>
              <div className="flex gap-1 bg-[var(--cream-2)] p-1 rounded-lg border border-[var(--line)]">
                {PERIOD_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={`px-3.5 py-1.5 text-xs rounded-md border-none cursor-pointer transition-all duration-200 ${
                      periodFilter === option.value
                        ? "bg-[var(--orange)] text-white shadow-[0_6px_16px_rgba(212,84,28,0.18)] font-bold"
                        : "bg-transparent text-[var(--ink)] font-semibold hover:text-[var(--orange)]"
                    }`}
                    onClick={() => handlePeriodChange(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Type Filter (Chips) */}
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-bold text-[var(--brown-soft)] uppercase tracking-wide">Type de rappel</span>
              <div className="flex gap-2 flex-wrap">
                {TYPE_OPTIONS.map((option) => {
                  const count = option.value === "notPacked" ? notPacked.length : option.value === "alternatives" ? withAlternatives.length : rawTotalCount;
                  const isActive = typeFilter === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => setTypeFilter(option.value)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg font-bold cursor-pointer transition-all duration-200 border ${
                        isActive
                          ? "bg-[var(--ink)] text-white border-[var(--ink)]"
                          : "bg-[var(--cream)] text-[var(--brown)] border-[var(--line)] hover:border-[rgba(212,84,28,0.35)] hover:text-[var(--orange)]"
                      }`}
                    >
                      {option.label}
                      <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-extrabold ${
                        isActive ? "bg-white/20 text-white" : "bg-[rgba(26,20,16,0.08)] text-[var(--brown-soft)]"
                      }`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            
            <div className="flex gap-4 flex-wrap flex-1 min-w-[280px]">
              {/* Status Filter (Select) */}
              <div className="flex flex-col gap-2 flex-1 min-w-[140px]">
                <span className="text-[11px] font-bold text-[var(--brown-soft)] uppercase tracking-wide">Statut</span>
                <div className="relative">
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="w-full pl-3 pr-[30px] py-2 text-xs font-semibold rounded-lg border border-[var(--line)] appearance-none bg-[var(--cream)] text-[var(--ink)] cursor-pointer h-[34px] outline-none focus:border-[var(--orange)] focus:ring-2 focus:ring-[var(--orange)]/10"
                  >
                    <option value="all">Tous les statuts ({rawTotalCount})</option>
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>
                        {STATUS_LABELS[status] || status} ({statusCounts[status] || 0})
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--brown-soft)]" />
                </div>
              </div>

              {/* Commercial Filter (Select) */}
              {isAdmin && (
                <div className="flex flex-col gap-2 flex-1 min-w-[140px]">
                  <span className="text-[11px] font-bold text-[var(--brown-soft)] uppercase tracking-wide">Commercial</span>
                  <div className="relative">
                    <select
                      value={commercialFilter}
                      onChange={(e) => setCommercialFilter(e.target.value)}
                      className="w-full pl-3 pr-[30px] py-2 text-xs font-semibold rounded-lg border border-[var(--line)] appearance-none bg-[var(--cream)] text-[var(--ink)] cursor-pointer h-[34px] outline-none focus:border-[var(--orange)] focus:ring-2 focus:ring-[var(--orange)]/10"
                    >
                      <option value="all">Tous les call centers</option>
                      {commercialOptions.map((commercial) => (
                        <option key={commercial} value={commercial}>
                          {commercial} ({commercialCounts[commercial] || 0})
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--brown-soft)]" />
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      <div className={`info-banner ${totalCount > 0 ? 'amber' : 'green'}`} style={{ marginBottom: 24, borderRadius: 12 }}>
        {totalCount > 0
          ? `${totalCount} rappel(s) pour les commandes ${PERIOD_META[periodFilter]}.`
          : "Aucun rappel ne correspond aux filtres."}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        <OrderSection
          orders={filteredNotPacked}
          title="Indisponibles / sans alternative"
          meta={`${filteredNotPacked.length} rappel(s)`}
          showCommercial={isAdmin}
          grouped={isAdmin && commercialFilter === 'all'}
          reminderKind="notPacked"
        />

        <OrderSection
          orders={filteredAlternatives}
          title="Alternatives proposées"
          meta={`${filteredAlternatives.length} rappel(s)`}
          showCommercial={isAdmin}
          grouped={isAdmin && commercialFilter === 'all'}
          reminderKind="alternative"
        />
      </div>

      <AnimatePresence>
        {selectedOrder && (
          <NonPackedModal
            order={selectedOrder}
            user={user}
            isPending={isPending}
            onClose={() => setSelectedOrder(null)}
            onStatusChange={handleStatusChange}
          />
        )}
      </AnimatePresence>

      
    </div>
  );
}
