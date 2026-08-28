"use client";

import React from "react";
import { StatusBadge } from "@/components/UI";
import { formatDay } from "@/lib/constants";
import { Check, Edit2, Eye, Warehouse, Loader2 } from "lucide-react";
import { motion } from "framer-motion";

import { PackingOrder, PackingOrderItem, ProductWithVariants } from "../types";

interface PackingItemProps {
  order: PackingOrder;
  isMobile: boolean;
  productMap: Map<string, ProductWithVariants>;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onSelect: (order: PackingOrder) => void;
  onEditStock: (product: ProductWithVariants) => void;
  canEditStock: boolean;
  onMarkPacking: (orderId: string, status: string) => void;
  onPreviewImage: (url: string, name: string, size?: string | null, color?: string | null) => void;
  onToggleCheckItem: (orderId: string, item: PackingOrderItem) => void;
  onMarkItemNotPacked: (orderId: string, item: PackingOrderItem) => void;
  savingChecks?: Set<string>;
  idx?: number;
}

const PackingItem = React.memo(({
  order: o,
  isMobile,
  productMap,
  isSelected,
  onToggleSelect,
  onSelect,
  onEditStock,
  canEditStock,
  onMarkPacking,
  onPreviewImage,
  onToggleCheckItem,
  onMarkItemNotPacked,
  savingChecks = new Set(),
  idx = 0
}: PackingItemProps) => {
  
  const totalItems = o.items.length;
  const checkedCount = o.items.filter((i: PackingOrderItem) => i.isVerified).length;
  const progress = totalItems > 0 ? (checkedCount / totalItems) * 100 : 0;

  if (isMobile) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: idx * 0.05 }}
        className="mobile-card packing-order-card"
        onClick={() => onSelect(o)}
        style={{
          padding: 0,
          overflow: 'hidden',
          borderLeft: o.status === 'PREPARING' ? '4px solid #FB7185' : '1px solid #E5E5EA',
          background: 'white',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <div className="packing-order-main" style={{ display: 'flex', padding: '12px', gap: 14 }}>
          {/* IMAGE LEFT */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div
              onClick={(e) => {
                const img = o.items[0]?.image;
                if (img) {
                  e.stopPropagation();
                  onPreviewImage(img, o.items[0].name, o.items[0].size, o.items[0].color);
                }
              }}
              className="packing-order-image"
              style={{
                width: 100,
                height: 100,
                background: '#F2F2F7',
                borderRadius: 14,
                overflow: 'hidden',
                border: '1.5px solid #E5E5EA',
                boxShadow: '0 4px 10px rgba(0,0,0,0.05)'
              }}
            >
              {o.items[0]?.image ? (
                <img 
                  src={o.items[0].image} 
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                  alt="" 
                  onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                    const target = e.currentTarget;
                    target.onerror = null;
                    target.style.display = 'none';
                    if (target.parentElement) {
                      target.parentElement.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:32px;">📦</div>';
                    }
                  }}
                />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 32 }}>{o.items[0]?.emoji || '📦'}</div>
              )}
            </div>
            {totalItems > 1 && (
              <div style={{ position: 'absolute', bottom: -6, right: -6, background: '#1C1C1E', color: 'white', fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 10, border: '2px solid white' }}>
                +{totalItems - 1}
              </div>
            )}
          </div>

          {/* INFO RIGHT */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
              <div className="packing-order-ref" style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 14, color: '#1C1C1E' }}>{o.ref}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <StatusBadge status={o.status} size="sm" />
                <button
                  type="button"
                  className={`packing-select-btn ${isSelected ? 'selected' : ''}`}
                  aria-label={isSelected ? `Désélectionner ${o.ref}` : `Sélectionner ${o.ref}`}
                  onClick={(event) => { event.stopPropagation(); onToggleSelect(o.id); }}
                >
                  {isSelected && <Check size={15} strokeWidth={3} />}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div>
                <div className="packing-order-customer" style={{ fontSize: 12, fontWeight: 700, color: '#1C1C1E', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {o.customerName}
                  {o.items.some((i: PackingOrderItem) => i.isGift) && <span style={{ fontSize: 8, background: 'var(--orange-soft)', color: 'var(--orange)', padding: '1px 5px', borderRadius: 4, fontWeight: 800 }}>CADEAU</span>}
                </div>
                <div className="packing-order-meta" style={{ fontSize: 10, color: '#8E8E93', fontWeight: 600 }}>{o.commune || 'Abidjan'} • {formatDay(o.createdAt)}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                  {o.commercialName && <span style={{ fontSize: 9, fontWeight: 700, background: '#E8F4FD', color: '#0A84FF', padding: '2px 6px', borderRadius: 6 }}>🛒 {o.commercialName}</span>}
                  {o.packedByName && <span style={{ fontSize: 9, fontWeight: 700, background: '#F2FBF4', color: '#34C759', padding: '2px 6px', borderRadius: 6 }}>📦 {o.packedByName}</span>}
                </div>
              </div>
              {canEditStock && <button
                onClick={(e) => {
                  e.stopPropagation();
                  const productId = o.items[0]?.productId;
                  if (productId) {
                    const p = productMap.get(productId);
                    if (p) onEditStock(p);
                  }
                }}
                style={{
                  background: 'var(--cream)',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 800,
                  color: 'var(--brown-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <Edit2 size={14} /> Stock
              </button>}
            </div>

            <div className="packing-order-progress" style={{ background: '#F2F2F7', padding: '8px', borderRadius: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontWeight: 800, color: '#8E8E93', marginBottom: 4 }}>
                <span>PROGRESSION</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {o.items.some(i => savingChecks.has(i.id)) && <Loader2 size={10} className="animate-spin" color="var(--orange)" />}
                  <span style={{ color: progress === 100 ? '#34C759' : '#1C1C1E' }}>{checkedCount}/{totalItems}</span>
                </div>
              </div>
              <div className="progress-bar-bg" style={{ height: 4 }}>
                <div className="progress-bar-fill" style={{ width: `${progress}%`, background: progress === 100 ? '#34C759' : '#FF6B2C' }} />
              </div>
            </div>
          </div>
        </div>

        {/* ACTIONS BOTTOM */}
        <div className="packing-card-actions" style={{ display: 'flex', borderTop: '1px solid #E5E5EA' }}>
          <button
            className="packing-card-action primary"
             onClick={(e) => { e.stopPropagation(); onMarkPacking(o.id, 'PACKED'); }}
             disabled={progress < 100}
            style={{ flex: 1.5, height: 44, background: progress === 100 ? '#34C759' : '#C7C7CC', color: 'white', border: 'none', fontWeight: 800, fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: progress === 100 ? 'pointer' : 'not-allowed' }}
          >
            <Check size={16} strokeWidth={3} /> PACKER
          </button>
          <button
            className="packing-card-action partial"
            onClick={(e) => { e.stopPropagation(); onMarkPacking(o.id, 'PARTIAL'); }}
            style={{ flex: 1, height: 44, background: '#FF9500', color: 'white', border: 'none', fontWeight: 800, fontSize: 12, borderLeft: '1px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            PARTIEL
          </button>
          <button
            className="packing-card-action unavailable"
            onClick={(e) => { e.stopPropagation(); onMarkPacking(o.id, 'UNAVAILABLE'); }}
            style={{ flex: 1, height: 44, background: '#FF3B30', color: 'white', border: 'none', fontWeight: 800, fontSize: 12, borderLeft: '1px solid rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            STOCK
          </button>
        </div>
      </motion.div>
    );
  }

  // DESKTOP ROW
  return (
    <tr
      style={{
        background: o.status === 'PREPARING' ? '#FFF1F2' : isSelected ? 'var(--cream-2)' : '',
        borderLeft: o.status === 'PREPARING' ? '4px solid #FB7185' : ''
      }}
    >
      <td><input type="checkbox" checked={isSelected} onChange={() => onToggleSelect(o.id)} /></td>
      <td>
        <span className="cell-mono" style={{ fontWeight: 800 }}>{o.ref}</span>
        <div className="cell-muted">{formatDay(o.createdAt)}</div>
      </td>
      <td>
        {o.items.map((i: PackingOrderItem, idx: number) => {
          const isChecked = i.isVerified;
          const imageUrl = i.image;
          const isSaving = savingChecks.has(i.id);
          const giftBlocked = i.isGift && i.giftApprovalStatus !== 'APPROVED';
          
          return (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, margin: '2px 0', opacity: isChecked ? 0.4 : 1, transition: 'opacity 0.2s', pointerEvents: isSaving ? 'none' : 'auto' }}>
              <div
                onClick={(e) => { e.stopPropagation(); if (!giftBlocked) onToggleCheckItem(o.id, i); }}
                title={giftBlocked ? "Autorisation administrateur requise" : undefined}
                style={{ width: 16, height: 16, borderRadius: 4, border: '1px solid var(--line)', background: isChecked ? 'var(--green)' : giftBlocked ? '#FEE2E2' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: giftBlocked ? 'not-allowed' : 'pointer' }}
              >
                {isSaving ? (
                  <Loader2 size={10} className="animate-spin" color={isChecked ? "white" : "var(--orange)"} />
                ) : (
                  isChecked && <Check size={10} color="white" />
                )}
              </div>
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt=""
                  style={{ width: 22, height: 22, borderRadius: 4, objectFit: 'cover', cursor: 'zoom-in' }}
                  onClick={(e) => { e.stopPropagation(); onPreviewImage(imageUrl, i.name, i.size, i.color); }}
                  onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                    const target = e.currentTarget;
                    target.onerror = null;
                    target.style.display = 'none';
                    const span = document.createElement('span');
                    span.innerText = i.emoji || '📦';
                    target.parentElement?.appendChild(span);
                  }}
                />
              ) : (
                <span>{i.emoji || '📦'}</span>
              )}
              <span style={{ fontWeight: 600, textDecoration: isChecked ? 'line-through' : 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                {i.name}
                {i.isGift && <span style={{ fontSize: 8, background: 'var(--orange-soft)', color: 'var(--orange)', padding: '0 4px', borderRadius: 4, fontWeight: 800 }}>CADEAU</span>}
                {giftBlocked && <span style={{ fontSize: 8, background: '#FEE2E2', color: '#B91C1C', padding: '1px 4px', borderRadius: 4, fontWeight: 900 }}>{i.giftApprovalStatus === 'REJECTED' ? 'REFUSÉ' : 'ATTENTE ADMIN'}</span>}
              </span>
              <span className="size-dot">{i.size}</span>
              <strong style={{ fontSize: 11 }}>{i.color}</strong>
              <button
                type="button"
                className={`packing-item-state-btn ${i.packingStatus === 'NOT_PACKED' ? 'active' : ''}`}
                aria-pressed={i.packingStatus === 'NOT_PACKED'}
                disabled={isSaving}
                onClick={(event) => { event.stopPropagation(); onMarkItemNotPacked(o.id, i); }}
              >
                {i.packingStatus === 'NOT_PACKED' ? 'Retirer “Pas emballé”' : 'Pas emballé'}
              </button>

              {o.history?.filter((h) => h.action.includes(`Alternative proposée pour "${i.name}"`)).map((h, hi: number) => (
                <div key={hi} style={{ fontSize: 10, color: 'var(--orange)', background: 'var(--orange-soft)', padding: '1px 6px', borderRadius: 4, fontWeight: 700, marginTop: 2 }}>
                  {h.action.split(' : ')[1]}
                </div>
              ))}
            </div>
          );
        })}
      </td>
      <td>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {o.items.map((item: PackingOrderItem, idx: number) => {
            const productId = item.productId;
            if (!productId) return null;
            const p = productMap.get(productId);
            if (!p) return null;
            const variant = p.variants.find((v) => v.size === item.size && v.color === item.color);
            return (
              <div key={idx} style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {variant?.stockLevels?.map((sl) => (
                  <div key={sl.id} style={{ fontSize: 9, background: 'var(--cream-2)', padding: '1px 5px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
                    <Warehouse size={8} className="text-orange" />
                    <span>{sl.warehouse.name}</span>
                    {sl.position && <span style={{ fontWeight: 800 }}>• {sl.position}</span>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </td>
      <td>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {o.commercialName && <span style={{ fontSize: 10, fontWeight: 700 }}>🛒 {o.commercialName}</span>}
          {o.packedByName && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--green)' }}>📦 {o.packedByName}</span>}
          {!o.commercialName && !o.packedByName && <span className="cell-muted">—</span>}
        </div>
      </td>
      <td><StatusBadge status={o.status} /></td>
      <td>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="action-btn" title="Détail emballage" onClick={() => onSelect(o)}>
            <Eye size={14} />
          </button>
        </div>
      </td>
    </tr>
  );
});

PackingItem.displayName = "PackingItem";

export default PackingItem;
