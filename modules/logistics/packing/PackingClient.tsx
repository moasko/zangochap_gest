"use client";

import React, { useState, useMemo, useTransition, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { TableCard } from "@/components/UI";
import { useToast } from "@/components/Toast";
import { addOrderHistoryEntry } from "@/modules/orders/actions";
import { updateOrderStatus } from "@/modules/orders/actions/status-actions";
import { useRouter, useSearchParams } from "next/navigation";
import { Package, X, Search } from "lucide-react";
import { toggleItemVerification } from "@/modules/logistics/verification/actions";
import { useResponsiveMode } from "@/lib/hooks";
import LogisticsMobileStyles from "@/modules/logistics/components/LogisticsMobileStyles";
import { motion, AnimatePresence } from "framer-motion";
import PackingOrderModal from "./components/PackingOrderModal";
import VariantsEditorModal from "./components/VariantsEditorModal";
import PackingItem from "./components/PackingItem";
import { PackingOrder, PackingOrderItem, PackingProductVariant, PackingUser, ProductWithVariants } from "./types";

// --- HOOKS ---
type DatePreset = 'today' | 'yesterday' | 'custom' | 'all';

const STATUS_FILTERS = [
  { key: 'CONFIRMED', label: 'Confirmées' },
  { key: 'PREPARING', label: 'Suivies' },
  { key: 'ALTERNATIVE', label: 'Alternatives' },
  { key: 'PARTIAL', label: 'Part. emballées' },
  { key: 'UNAVAILABLE', label: 'Indisponibles' },
  { key: 'PACKED', label: 'Emballées' },
  { key: 'all', label: 'Toutes' },
] as const;

function toLocalDateInputValue(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Hook pour la gestion du polling stabilisé
 */
function usePackingPolling(initialOrders: PackingOrder[], initialProducts: ProductWithVariants[], savingCount: number) {
  const [orders, setOrders] = useState<PackingOrder[]>(initialOrders);
  const [products, setProducts] = useState<ProductWithVariants[]>(initialProducts);
  const savingCountRef = useRef(savingCount);

  useEffect(() => {
    savingCountRef.current = savingCount;
  }, [savingCount]);

  useEffect(() => {
    if (savingCountRef.current === 0) {
      setOrders(initialOrders);
      setProducts(initialProducts);
    }
  }, [initialOrders, initialProducts]);

  useEffect(() => {
    const controller = new AbortController();

    const poll = async () => {
      try {
        // Ne pas rafraîchir si on est en train de sauvegarder
        if (savingCountRef.current > 0) return;

        const res = await fetch('/api/orders/packing', {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json.orders)) {
            setOrders(json.orders);
          }
          if (Array.isArray(json.products)) {
            setProducts(json.products);
          }
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') return;
      }
    };

    poll();
    const interval = setInterval(poll, 20000);
    return () => {
      clearInterval(interval);
      controller.abort();
    };
  }, []);

  return { orders, setOrders, products };
}

/**
 * Hook pour la gestion des filtres et du tri performant
 */
function usePackingFilters(orders: PackingOrder[], products: ProductWithVariants[], searchParams: URLSearchParams) {
  const [filter, setFilter] = useState(searchParams.get('status') || 'CONFIRMED');
  const [search, setSearch] = useState('');
  const today = toLocalDateInputValue();
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [datePreset, setDatePreset] = useState<DatePreset>('today');

  // Indexation des variantes pour lookup O(1)
  const variantWarehouseMap = useMemo(() => {
    const map = new Map<string, string[]>();
    products.forEach((p) => {
      p.variants?.forEach((v) => {
        const key = `${p.id}_${v.size}_${v.color}`;
        map.set(key, v.stockLevels?.flatMap((sl) => sl.warehouse?.name ? [sl.warehouse.name] : []) || []);
      });
    });
    return map;
  }, [products]);

  // Pré-parsing des dates pour éviter new Date() dans le loop
  const timeRange = useMemo(() => {
    return {
      from: dateFrom ? new Date(dateFrom).getTime() : null,
      to: dateTo ? new Date(dateTo + 'T23:59:59').getTime() : null
    };
  }, [dateFrom, dateTo]);

  const filtered = useMemo(() => {
    const s = search.toLowerCase();

    return orders
      .filter((o) => {
        // Filtre Statut / Alternative
        if (filter === 'ALTERNATIVE') {
          if (o.status !== 'ALTERNATIVE' && !o.history?.some(h => h.action.includes('Alternative proposée'))) return false;
        } else if (filter === 'PREPARING') {
          // Suivies = commandes dont au moins un article a été coché, mais pas encore emballées
          if (o.status === 'PACKED') return false;
          if (!o.items.some(i => i.isVerified)) return false;
        } else if (filter !== 'all' && o.status !== filter) return false;

        // Filtre Recherche
        if (search && !o.ref?.toLowerCase().includes(s) && !o.customerName.toLowerCase().includes(s)) return false;

        // Filtre Date
        const created = new Date(o.createdAt).getTime();
        if (timeRange.from && created < timeRange.from) return false;
        if (timeRange.to && created > timeRange.to) return false;

        // Filtre Entrepôt (Lookup performant)
        if (warehouseFilter !== 'all') {
          const hasWarehouse = o.items.some(item => {
            const key = `${item.productId}_${item.size}_${item.color}`;
            const warehouses = variantWarehouseMap.get(key);
            return warehouses?.includes(warehouseFilter);
          });
          if (!hasWarehouse) return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Priorité aux alternatives, puis LIFO
        const aAlt = a.history?.some(h => h.action.includes('Alternative proposée'));
        const bAlt = b.history?.some(h => h.action.includes('Alternative proposée'));
        if (aAlt && !bAlt) return -1;
        if (!aAlt && bAlt) return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [orders, filter, search, timeRange, warehouseFilter, variantWarehouseMap]);

  return {
    filter, setFilter,
    search, setSearch,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    warehouseFilter, setWarehouseFilter,
    datePreset, setDatePreset,
    filtered
  };
}

export default function PackingClient({ initialOrders, products: initialProducts, user }: { initialOrders: PackingOrder[], products: ProductWithVariants[], user: PackingUser }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isMobile, isReady: isViewportReady } = useResponsiveMode();
  const { showToast } = useToast();
  const [mounted, setMounted] = useState(false);

  // --- STATE ---
  const [savingChecks, setSavingChecks] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [packingNote, setPackingNote] = useState('');
  const [previewItem, setPreviewItem] = useState<{ url: string, name: string, size?: string | null, color?: string | null } | null>(null);
  const [editingVariants, setEditingVariants] = useState<{ product: ProductWithVariants, variants: PackingProductVariant[] } | null>(null);
  const [isPending, startTransition] = useTransition();

  // --- CUSTOM HOOKS ---
  const { orders, setOrders, products } = usePackingPolling(initialOrders, initialProducts, savingChecks.size);
  const {
    filter, setFilter, search, setSearch, dateFrom, setDateFrom, dateTo, setDateTo, warehouseFilter, setWarehouseFilter, datePreset, setDatePreset, filtered
  } = usePackingFilters(orders, products, searchParams);

  // Security for Hydration
  useEffect(() => { setMounted(true); }, []);

  const selectedOrder = useMemo(() => orders.find(o => o.id === selectedOrderId), [orders, selectedOrderId]);

  // Indexation simple des produits pour le modal
  const productMap = useMemo(() => {
    const map = new Map<string, ProductWithVariants>();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const warehouses = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      p.variants?.forEach((v) => {
        v.stockLevels?.forEach((sl) => {
          if (sl.warehouse?.name) set.add(sl.warehouse.name);
        });
      });
    });
    return Array.from(set).sort();
  }, [products]);

  // --- HANDLERS (useCallback to avoid prop drill re-renders) ---
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelectedIds(prev => {
      const visibleIds = filtered.map(order => order.id);
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => prev.has(id));
      const next = new Set(prev);
      visibleIds.forEach(id => allVisibleSelected ? next.delete(id) : next.add(id));
      return next;
    });
  }, [filtered]);

  const toggleCheckItem = useCallback((orderId: string, item: PackingOrderItem) => {
    const newStatus = !item.isVerified;

    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      return {
        ...o,
        items: o.items.map(i => i.id === item.id ? { ...i, isVerified: newStatus } : i)
      };
    }));

    setSavingChecks(prev => {
      const next = new Set(prev);
      next.add(item.id);
      return next;
    });

    toggleItemVerification(item.id, newStatus)
      .catch((error: unknown) => {
        showToast(error instanceof Error ? error.message : "Erreur de sauvegarde", "error");
        setOrders(prev => prev.map(o => {
          if (o.id !== orderId) return o;
          return {
            ...o,
            items: o.items.map(i => i.id === item.id ? { ...i, isVerified: !newStatus } : i)
          };
        }));
      })
      .finally(() => {
        setSavingChecks(prev => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
      });
  }, [setOrders, showToast]);

  const handleMarkPacking = useCallback((orderId: string, status: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order) return;

    if (status === 'PACKED') {
      const unverifiedCount = order.items.filter(i => !i.isVerified).length;
      if (unverifiedCount > 0) {
        showToast(`${unverifiedCount} article(s) doivent encore être vérifiés.`, 'error');
        return;
      }
    }

    let effectiveNote = packingNote.trim();
    if ((status === 'PARTIAL' || status === 'UNAVAILABLE') && !effectiveNote) {
      effectiveNote = prompt(status === 'PARTIAL'
        ? 'Quels articles ou quantités manquent ?'
        : "Pourquoi la commande n'est-elle pas disponible ?")?.trim() || '';
      if (!effectiveNote) return;
    }

    startTransition(async () => {
      try {
        const result = await updateOrderStatus(orderId, status, effectiveNote || undefined);
        if (!result.success) {
          showToast(result.error, 'error');
          return;
        }
        showToast('Statut mis à jour ✓', 'success');
        setOrders(prev => prev.map(o => {
          if (o.id !== orderId) return o;
          return result?.order ? { ...o, ...result.order } : { ...o, status };
        }));
        setSelectedOrderId(null);
        setPackingNote('');
      } catch (error: unknown) {
        showToast(error instanceof Error ? error.message : 'Erreur lors du marquage', 'error');
      }
    });
  }, [orders, packingNote, setOrders, showToast]);

  const handleBulkMark = useCallback((status: string) => {
    if (selectedIds.size === 0) return;
    const selectedOrders = orders.filter(order => selectedIds.has(order.id));
    const eligibleOrders = status === 'PACKED'
      ? selectedOrders.filter(order => order.items.every(item => item.isVerified))
      : selectedOrders;
    const blockedCount = selectedOrders.length - eligibleOrders.length;
    if (eligibleOrders.length === 0) {
      showToast('Aucune commande sélectionnée n’est entièrement vérifiée.', 'error');
      return;
    }
    const warning = blockedCount > 0 ? ` ${blockedCount} commande(s) incomplète(s) seront ignorées.` : '';
    if (!confirm(`Marquer ${eligibleOrders.length} commande(s) comme emballée(s) ?${warning}`)) return;

    startTransition(async () => {
      try {
        const orderIds = eligibleOrders.map(order => order.id);
        const settledResults = await Promise.allSettled(orderIds.map(id => updateOrderStatus(id, status)));
        const successfulResults = settledResults.flatMap(result =>
          result.status === 'fulfilled' && result.value.success ? [result.value] : []
        );
        const failedIds = new Set([
          ...selectedOrders.filter(order => !eligibleOrders.some(eligible => eligible.id === order.id)).map(order => order.id),
          ...orderIds.filter((_, index) => {
            const result = settledResults[index];
            return result.status === 'rejected' || !result.value.success;
          }),
        ]);
        const updatedById = new Map(successfulResults.map(result => [result.order.id, result.order]));
        if (failedIds.size > 0) {
          const firstFailure = settledResults.find(result => result.status === 'rejected' || !result.value.success);
          const failureMessage = firstFailure?.status === 'rejected'
            ? (firstFailure.reason instanceof Error ? firstFailure.reason.message : '')
            : firstFailure && !firstFailure.value.success ? firstFailure.value.error : '';
          showToast(`${successfulResults.length} mise(s) à jour, ${failedIds.size} bloquée(s). ${failureMessage}`, 'error');
        } else {
          showToast(`${eligibleOrders.length} commandes mises à jour ✓`, 'success');
        }
        setOrders(prev => prev.map(o => {
          const updated = updatedById.get(o.id);
          if (updated) return { ...o, ...updated };
          return o;
        }));
        setSelectedIds(failedIds);
      } catch (error: unknown) {
        showToast(error instanceof Error ? error.message : 'Erreur lors du traitement groupé', 'error');
      }
    });
  }, [orders, selectedIds, setOrders, showToast]);

  const handleProposeAlternative = useCallback((orderId: string, itemName: string) => {
    const alt = prompt(`Alternative pour "${itemName}" ?`);
    if (!alt) return;

    startTransition(async () => {
      try {
        await addOrderHistoryEntry(orderId, `Alternative proposée pour "${itemName}" : ${alt}`);
        showToast('Alternative enregistrée ✓', 'success');
        setOrders(prev => prev.map(o => {
          if (o.id !== orderId) return o;
          const history = Array.isArray(o.history) ? [...o.history] : [];
          history.push({
            at: new Date().toISOString(),
            action: `Alternative proposée pour "${itemName}" : ${alt}`,
            byName: "Système"
          });
          return { ...o, history };
        }));
      } catch {
        showToast('Erreur lors de l\'enregistrement', 'error');
      }
    });
  }, [setOrders, showToast]);

  const handleEditStock = useCallback((product: ProductWithVariants) => {
    setEditingVariants({ product, variants: product.variants });
  }, []);

  const applyDatePreset = useCallback((preset: DatePreset) => {
    setDatePreset(preset);
    if (preset === 'custom') return;
    if (preset === 'all') {
      setDateFrom('');
      setDateTo('');
      return;
    }

    const today = new Date();
    const from = new Date(today);
    if (preset === 'yesterday') from.setDate(today.getDate() - 1);

    const to = preset === 'yesterday' ? from : today;
    setDateFrom(toLocalDateInputValue(from));
    setDateTo(toLocalDateInputValue(to));
  }, [setDateFrom, setDatePreset, setDateTo]);

  const handleDateFromChange = useCallback((value: string) => {
    setDatePreset('custom');
    setDateFrom(value);
  }, [setDateFrom, setDatePreset]);

  const handleDateToChange = useCallback((value: string) => {
    setDatePreset('custom');
    setDateTo(value);
  }, [setDateTo, setDatePreset]);

  // --- RENDER ---
  const commonProps = {
    productMap,
    onEditStock: handleEditStock,
    onPreviewImage: (url: string, name: string, size?: string | null, color?: string | null) =>
      setPreviewItem({ url, name, size, color }),
    onToggleCheckItem: toggleCheckItem,
    canEditStock: ['ADMIN', 'DEVELOPER', 'STOCK'].includes(user.role?.toUpperCase()),
  };

  const viewMotion = {
    initial: { opacity: 0, y: 12, scale: 0.985 },
    animate: { opacity: 1, y: 0, scale: 1 },
    transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
  } as const;

  if (isViewportReady && isMobile) {
    return (
      <motion.div key="packing-mobile" className="logistics-mobile-root logistics-view-mobile" {...viewMotion}>
        <LogisticsMobileStyles />
        <div className="logistics-mobile-header">
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800 }}>Emballage</h1>
            <div style={{ position: 'absolute', right: 0, fontSize: 12, fontWeight: 700, color: 'var(--orange)', background: 'var(--orange-soft)', padding: '4px 10px', borderRadius: 20 }}>
              {filtered.length}
            </div>
          </div>

          <div className="mobile-search-bar">
            <Search size={16} style={{ position: 'absolute', left: 12, top: 12, color: '#AEAEB2' }} />
            <input
              type="text"
              placeholder="Réf ou client..."
              className="mobile-search-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="mobile-status-tabs">
            {STATUS_FILTERS.map(f => (
              <button key={f.key} className={`status-tab ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
                {f.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 4, background: '#F2F2F7', padding: '2px', borderRadius: 10, marginBottom: 12 }}>
            {[
              { label: 'Auj.', val: 'today' },
              { label: 'Hier', val: 'yesterday' },
              { label: 'Perso', val: 'custom' },
              { label: 'Tout', val: 'all' }
            ].map(d => (
              <button
                key={d.val}
                onClick={() => applyDatePreset(d.val as DatePreset)}
                style={{
                  flex: 1, fontSize: 10, fontWeight: 800, padding: '6px 0', borderRadius: 8, border: 'none',
                  background: datePreset === d.val ? 'white' : 'transparent',
                  boxShadow: 'none'
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
          {datePreset === 'custom' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <input type="date" className="filter-date" value={dateFrom} onChange={e => handleDateFromChange(e.target.value)} style={{ minWidth: 0, height: 36, borderRadius: 10, border: 'none', background: '#F2F2F7', fontSize: 11 }} />
              <input type="date" className="filter-date" value={dateTo} onChange={e => handleDateToChange(e.target.value)} style={{ minWidth: 0, height: 36, borderRadius: 10, border: 'none', background: '#F2F2F7', fontSize: 11 }} />
            </div>
          )}
        </div>

        <div className="logistics-mobile-content">
          <AnimatePresence mode="popLayout">
            {filtered.length === 0 ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ padding: '40px 0', textAlign: 'center' }}>
                <Package size={48} style={{ margin: '0 auto 12px', opacity: 0.2 }} />
                <p style={{ color: '#8E8E93', fontSize: 14 }}>Aucune commande</p>
              </motion.div>
            ) : (
              filtered.map((o, idx) => (
                <PackingItem
                  key={o.id}
                  order={o}
                  isMobile={true}
                  idx={idx}
                  isSelected={selectedIds.has(o.id)}
                  onToggleSelect={toggleSelect}
                  onSelect={(order) => { setSelectedOrderId(order.id); setPackingNote(''); }}
                  onMarkPacking={handleMarkPacking}
                  savingChecks={savingChecks}
                  {...commonProps}
                />
              ))
            )}
          </AnimatePresence>
        </div>

        <PackingOrderModal
          order={selectedOrder}
          isMobile={true}
          isPending={isPending}
          packingNote={packingNote}
          setPackingNote={setPackingNote}
          onClose={() => setSelectedOrderId(null)}
          onMarkPacking={handleMarkPacking}
          onProposeAlternative={handleProposeAlternative}
          savingChecks={savingChecks}
          {...commonProps}
        />

        {editingVariants && (
          <VariantsEditorModal
            product={editingVariants.product}
            variants={editingVariants.variants}
            onClose={() => setEditingVariants(null)}
            onSave={() => {
              showToast('Stock mis a jour', 'success');
              setEditingVariants(null);
              router.refresh();
            }}
          />
        )}

        {mounted && previewItem !== null && createPortal(
          <div
            className="lightbox-root"
            onClick={() => setPreviewItem(null)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 999999,
              background: 'rgba(0,0,0,0.95)',
              backdropFilter: 'blur(15px)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'zoom-out',
              padding: '20px',
              animation: 'fadeIn 0.2s ease-out'
            }}
          >
            <style>{`
              @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
              @keyframes zoomIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
            `}</style>

            <div style={{ position: 'relative', maxWidth: '98vw', maxHeight: '95vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', animation: 'zoomIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
              <img
                src={previewItem.url}
                alt="Preview"
                style={{
                  display: 'block',
                  maxWidth: '100%',
                  maxHeight: '80vh',
                  borderRadius: 16,
                  border: '2px solid rgba(255,255,255,0.2)',
                  boxShadow: '0 50px 100px rgba(0,0,0,0.8)',
                  objectFit: 'contain'
                }}
              />

              <div style={{ marginTop: 24, textAlign: 'center', color: 'white' }}>
                <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 8, letterSpacing: '-0.02em' }}>{previewItem.name}</h2>
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                  {previewItem.size && <span style={{ background: 'white', color: 'black', padding: '6px 16px', borderRadius: 8, fontWeight: 900, fontSize: 18 }}>Taille {previewItem.size}</span>}
                  {previewItem.color && <span style={{ background: 'rgba(255,255,255,0.2)', color: 'white', padding: '6px 16px', borderRadius: 8, fontWeight: 800, fontSize: 18, border: '1px solid rgba(255,255,255,0.3)' }}>{previewItem.color}</span>}
                </div>
              </div>

              <button
                onClick={(e) => { e.stopPropagation(); setPreviewItem(null); }}
                style={{
                  position: 'fixed', top: 40, right: 40, background: 'white', border: 'none', color: 'black', width: 60, height: 60, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 20px 40px rgba(0,0,0,0.5)', zIndex: 20
                }}
              >
                <X size={36} strokeWidth={3} />
              </button>
            </div>
          </div>,
          document.body
        )}
      </motion.div>
    );
  }

  return (
    <motion.div key="packing-desktop" className="content logistics-view-desktop" {...viewMotion}>
      <div className="filters-bar" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', background: 'white', padding: '12px 16px', borderRadius: 12, marginBottom: 20, border: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {STATUS_FILTERS.map(f => (
            <button key={f.key} className={`filter-chip ${filter === f.key ? 'active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <input type="text" placeholder="Rechercher..." className="field-input" style={{ paddingLeft: 36, height: 36, fontSize: 13 }} value={search} onChange={e => setSearch(e.target.value)} />
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }}><Search size={16} /></span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select className="filter-date" value={warehouseFilter} onChange={e => setWarehouseFilter(e.target.value)}>
            <option value="all">Tous les entrepôts</option>
            {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 4, background: 'var(--cream)', padding: 3, borderRadius: 10, border: '1px solid var(--line)' }}>
            {[
              { label: "Aujourd'hui", val: 'today' },
              { label: 'Hier', val: 'yesterday' },
              { label: 'Perso', val: 'custom' },
              { label: 'Tout', val: 'all' },
            ].map(d => (
              <button key={d.val} className={`shortcut-btn ${datePreset === d.val ? 'active' : ''}`} onClick={() => applyDatePreset(d.val as DatePreset)}>
                {d.label}
              </button>
            ))}
          </div>
          {datePreset === 'custom' && (
            <>
              <input type="date" className="filter-date" value={dateFrom} onChange={e => handleDateFromChange(e.target.value)} />
              <input type="date" className="filter-date" value={dateTo} onChange={e => handleDateToChange(e.target.value)} />
            </>
          )}
        </div>
      </div>

      <TableCard
        title={`${filtered.length} commande(s)`}
        actions={selectedIds.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="cell-muted">{selectedIds.size} sélectionnée(s)</span>
            <button className="btn-orange" onClick={() => handleBulkMark('PACKED')} disabled={isPending}>
              Emballé
            </button>
          </div>
        )}
      >
        <table>
          <thead>
            <tr>
              <th style={{ width: 40 }}><input type="checkbox" checked={filtered.length > 0 && filtered.every(order => selectedIds.has(order.id))} onChange={toggleAll} /></th>
              <th>Référence</th><th>Articles</th><th>Entrepôts</th><th>Statut</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((o) => (
              <PackingItem
                key={o.id}
                order={o}
                isMobile={false}
                isSelected={selectedIds.has(o.id)}
                onToggleSelect={toggleSelect}
                onSelect={(order) => { setSelectedOrderId(order.id); setPackingNote(''); }}
                onMarkPacking={handleMarkPacking}
                savingChecks={savingChecks}
                {...commonProps}
              />
            ))}
          </tbody>
        </table>
      </TableCard>

      <PackingOrderModal
        order={selectedOrder}
        isMobile={false}
        isPending={isPending}
        packingNote={packingNote}
        setPackingNote={setPackingNote}
        onClose={() => setSelectedOrderId(null)}
        onMarkPacking={handleMarkPacking}
        onProposeAlternative={handleProposeAlternative}
        savingChecks={savingChecks}
        {...commonProps}
      />

      {mounted && previewItem !== null && createPortal(
        <div
          className="lightbox-root"
          onClick={() => setPreviewItem(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999999,
            background: 'rgba(0,0,0,0.95)',
            backdropFilter: 'blur(15px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out',
            padding: '20px',
            animation: 'fadeIn 0.2s ease-out'
          }}
        >
          <style>{`
            @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            @keyframes zoomIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
          `}</style>

          <div style={{ position: 'relative', maxWidth: '98vw', maxHeight: '95vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', animation: 'zoomIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}>
            <img
              src={previewItem.url}
              alt="Preview"
              style={{
                display: 'block',
                maxWidth: '100%',
                maxHeight: '80vh',
                borderRadius: 16,
                border: '2px solid rgba(255,255,255,0.2)',
                boxShadow: '0 50px 100px rgba(0,0,0,0.8)',
                objectFit: 'contain'
              }}
            />

            {/* Infos de l'article en grand sous l'image */}
            <div style={{ marginTop: 24, textAlign: 'center', color: 'white' }}>
              <h2 style={{ fontSize: 24, fontWeight: 900, marginBottom: 8, letterSpacing: '-0.02em' }}>{previewItem.name}</h2>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                {previewItem.size && <span style={{ background: 'white', color: 'black', padding: '6px 16px', borderRadius: 8, fontWeight: 900, fontSize: 18 }}>Taille {previewItem.size}</span>}
                {previewItem.color && <span style={{ background: 'rgba(255,255,255,0.2)', color: 'white', padding: '6px 16px', borderRadius: 8, fontWeight: 800, fontSize: 18, border: '1px solid rgba(255,255,255,0.3)' }}>{previewItem.color}</span>}
              </div>
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); setPreviewItem(null); }}
              style={{
                position: 'fixed',
                top: 40,
                right: 40,
                background: 'white',
                border: 'none',
                color: 'black',
                width: 60,
                height: 60,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 20px 40px rgba(0,0,0,0.5)',
                zIndex: 20
              }}
            >
              <X size={36} strokeWidth={3} />
            </button>
          </div>
        </div>,
        document.body
      )}

      {editingVariants && (
        <VariantsEditorModal
          product={editingVariants.product}
          variants={editingVariants.variants}
          onClose={() => setEditingVariants(null)}
          onSave={() => {
            showToast('Stock mis a jour', 'success');
            setEditingVariants(null);
            router.refresh();
          }}
        />
      )}
    </motion.div>
  );
}
