"use client";

import React from "react";
import Modal from "@/components/Modal";
import { SectionLabel, DetailCard } from "@/components/UI";
import { Check, ArrowLeftRight, Warehouse, Edit2, Loader2 } from "lucide-react";

import { PackingOrder, PackingOrderItem, ProductWithVariants } from "../types";

interface PackingOrderModalProps {
  order: PackingOrder | null | undefined;
  isMobile: boolean;
  isPending: boolean;
  productMap: Map<string, ProductWithVariants>;
  packingNote: string;
  setPackingNote: (note: string) => void;
  onClose: () => void;
  onMarkPacking: (orderId: string, status: string) => void;
  onProposeAlternative: (orderId: string, itemName: string) => void;
  onEditStock: (product: ProductWithVariants) => void;
  canEditStock: boolean;
  onToggleCheckItem: (orderId: string, item: PackingOrderItem) => void;
  onMarkItemNotPacked: (orderId: string, item: PackingOrderItem) => void;
  onPreviewImage: (url: string, name: string, size?: string | null, color?: string | null) => void;
  savingChecks?: Set<string>;
}

export default function PackingOrderModal({
  order,
  isMobile,
  isPending,
  productMap,
  packingNote,
  setPackingNote,
  onClose,
  onMarkPacking,
  onProposeAlternative,
  onEditStock,
  canEditStock,
  onToggleCheckItem,
  onMarkItemNotPacked,
  onPreviewImage,
  savingChecks = new Set()
}: PackingOrderModalProps) {

  if (!order) return null;

  const progress = order.items.filter((i) => i.isVerified).length;
  const total = order.items.length;
  const isComplete = total > 0 && progress === total;
  const isPartial = progress > 0 && progress < total;

  if (isMobile) {
    return (
      <Modal
        isOpen={true}
        onClose={onClose}
        title={`Détails · ${order.ref}`}
        large
        footer={
          <div className="packing-mobile-order-footer">
            {order.status === 'PACKED' ? (
              <>
                <button className="btn-secondary" onClick={onClose}>Fermer</button>
                <button className="btn-secondary" onClick={() => onMarkPacking(order.id, 'CONFIRMED')} disabled={isPending} style={{ color: '#B33A32', borderColor: '#F3C5C1' }}>Annuler l&apos;emballage</button>
              </>
            ) : (
              <>
                <button className="btn-secondary" onClick={() => onMarkPacking(order.id, 'UNAVAILABLE')} disabled={isPending} style={{ color: 'var(--red)', borderColor: '#F3C5C1' }}>Indisponible</button>
                <button className="btn-secondary" onClick={() => onMarkPacking(order.id, 'PARTIAL')} disabled={isPending || !isPartial} style={{ color: '#9A5A00', borderColor: '#F1D49D' }}>Partiel</button>
                <button className="btn-secondary" onClick={onClose}>Fermer</button>
                <button className="btn-orange" onClick={() => onMarkPacking(order.id, 'PACKED')} disabled={isPending || !isComplete} title={!isComplete ? "Vérifiez tous les articles avant de valider" : undefined} style={{ gridColumn: '1 / -1' }}>
                  <Check size={16} /> Emballé
                </button>
              </>
            )}
          </div>
        }
      >
        <div className="packing-modal-progress" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--orange)', fontSize: 18 }}>{order.ref}</div>
            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>{order.customerName}</div>
          </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: '#8E8E93', marginBottom: 2 }}>PROGRESSION</div>
              <div style={{ fontWeight: 900, fontSize: 16 }}>{progress} / {total}</div>
            </div>
          </div>
          <div className="progress-bar-bg" style={{ height: 7, marginTop: -10, marginBottom: 18 }} aria-label={`${progress} articles vérifiés sur ${total}`}>
            <div className="progress-bar-fill" style={{ width: `${total > 0 ? (progress / total) * 100 : 0}%`, background: isComplete ? '#24A967' : '#F15A24' }} />
          </div>

        <SectionLabel spaced>Checklist Articles</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {order.items.map((item, idx: number) => {
            const p = productMap.get(item.productId || "");
            const isChecked = item.isVerified;
            const isSaving = savingChecks.has(item.id);
            const giftBlocked = item.isGift && item.giftApprovalStatus !== 'APPROVED';
            return (
              <DetailCard
                key={idx}
                className={`packing-checklist-card ${isChecked ? 'checked' : ''}`}
                style={{
                  padding: 0,
                  overflow: 'hidden',
                  borderRadius: 14,
                  border: isSaving
                    ? '1.5px solid var(--orange)'
                    : isChecked ? '1.5px solid #34C759' : '1px solid #E5E5EA',
                  background: isChecked ? '#F2FBF4' : 'white',
                  transition: 'all 0.2s ease',
                  opacity: isSaving ? 0.75 : 1,
                  animation: isSaving ? 'pulse-border 1s ease infinite' : 'none',
                  position: 'relative' as const,
                  pointerEvents: isSaving ? 'none' as const : 'auto' as const,
                }}
                onClick={() => { if (!giftBlocked) onToggleCheckItem(order.id, item); }}
              >
                {isSaving && (
                  <div style={{
                    position: 'absolute', top: 0, right: 0,
                    padding: '4px 10px',
                    background: 'var(--orange)',
                    color: 'white',
                    fontSize: 9,
                    fontWeight: 800,
                    borderBottomLeftRadius: 8,
                    zIndex: 2,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    letterSpacing: '0.05em',
                  }}>
                    <Loader2 size={10} style={{ animation: 'spin 0.8s linear infinite' }} />
                    ENREGISTREMENT
                  </div>
                )}
                <div style={{ display: 'flex', minHeight: 90 }}>
                  <div style={{ position: 'relative', width: 90, flexShrink: 0, background: '#F2F2F7', borderRight: '1px solid #E5E5EA' }}>
                    {item.image ? (
                      <img
                        src={item.image}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: isChecked ? 0.3 : 1 }}
                        onClick={(e) => { e.stopPropagation(); onPreviewImage(item.image!, item.name, item.size, item.color); }}
                        alt=""
                      />
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 28 }}>{item.emoji || '📦'}</div>
                    )}
                    {isChecked && !savingChecks.has(item.id) && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(52, 199, 89, 0.1)' }}>
                        <Check size={36} color="#34C759" strokeWidth={5} />
                      </div>
                    )}
                    {savingChecks.has(item.id) && (
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.05)' }}>
                        <Loader2 size={20} color="#8E8E93" style={{ animation: 'spin 0.8s linear infinite' }} />
                      </div>
                    )}
                    <div style={{ position: 'absolute', top: 6, left: 6, width: 20, height: 20, borderRadius: 5, border: '2px solid', borderColor: isChecked ? '#34C759' : '#C7C7CC', background: isChecked ? '#34C759' : 'rgba(255,255,255,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {isChecked && !savingChecks.has(item.id) && <Check size={14} color="white" strokeWidth={4} />}
                      {savingChecks.has(item.id) && <Loader2 size={12} color={isChecked ? 'white' : '#8E8E93'} style={{ animation: 'spin 0.8s linear infinite' }} />}
                    </div>
                  </div>

                  <div style={{ flex: 1, padding: '10px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 2 }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: isChecked ? '#8E8E93' : '#1C1C1E', textDecoration: isChecked ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {item.name}
                        {item.isGift && <span style={{ fontSize: 9, background: 'var(--orange-soft)', color: 'var(--orange)', padding: '1px 6px', borderRadius: 10, fontWeight: 800, textTransform: 'uppercase' }}>Cadeau</span>}
                        {giftBlocked && <span style={{ fontSize: 8, background: '#FEE2E2', color: '#B91C1C', padding: '2px 6px', borderRadius: 8, fontWeight: 900 }}>{item.giftApprovalStatus === 'REJECTED' ? 'REFUSÉ' : 'EN ATTENTE ADMIN'}</span>}
                      </div>
                      <div style={{ fontWeight: 900, fontSize: 16, color: isChecked ? '#8E8E93' : 'var(--orange)', marginLeft: 6 }}>
                        x{item.qty}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                      <span className="size-dot" style={{ background: '#1C1C1E', color: 'white', border: 'none', scale: '0.8' }}>{item.size}</span>
                      <span style={{ fontSize: 11, color: '#8E8E93', fontWeight: 700 }}>{item.color}</span>
                    </div>

                    <div style={{ marginTop: 'auto' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {p?.variants?.find((v) => v.size === item.size && v.color === item.color)?.stockLevels?.map((sl) => (
                          <div key={sl.id} style={{ fontSize: 9, background: '#F2F2F7', padding: '2px 6px', borderRadius: 5, display: 'flex', alignItems: 'center', gap: 3 }}>
                            <Warehouse size={9} color="#FF6B2C" />
                            <span style={{ fontWeight: 700 }}>{sl.position || sl.warehouse.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="packing-mobile-item-actions" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    className={`packing-item-choice packed ${item.packingStatus === 'PACKED' || isChecked ? 'active' : ''}`}
                    disabled={isSaving || giftBlocked}
                    onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (!isChecked) onToggleCheckItem(order.id, item); }}
                  >
                    <Check size={15} /> {isChecked ? 'Emballé ✓' : 'Emballé'}
                  </button>
                  <button
                    type="button"
                          className={`packing-item-choice not-packed ${item.packingStatus === 'NOT_PACKED' ? 'active' : ''}`}
                          aria-pressed={item.packingStatus === 'NOT_PACKED'}
                    disabled={isSaving}
                    onClick={(event) => { event.preventDefault(); event.stopPropagation(); onMarkItemNotPacked(order.id, item); }}
                  >
                          {item.packingStatus === 'NOT_PACKED' ? 'Retirer “Pas emballé”' : 'Pas emballé'}
                  </button>
                  {canEditStock && <button
                    type="button"
                    className="packing-mobile-secondary-action stock"
                    disabled={!p || isSaving}
                    onClick={(event) => { event.preventDefault(); event.stopPropagation(); if (p) onEditStock(p); }}
                  >
                    <Edit2 size={15} /> Modifier stock
                  </button>}
                  <button
                    type="button"
                    className="packing-mobile-secondary-action alternative"
                    disabled={isSaving}
                    onClick={(event) => { event.preventDefault(); event.stopPropagation(); onProposeAlternative(order.id, item.name); }}
                  >
                    <ArrowLeftRight size={15} /> Alternative
                  </button>
                </div>
                {order.history?.filter((h) => h.action.includes(`Alternative proposée pour "${item.name}"`)).map((h, hi: number) => (
                  <div key={hi} style={{ margin: '0 12px 10px', padding: '8px 12px', background: 'var(--orange-soft)', borderLeft: '3px solid var(--orange)', borderRadius: 6, fontSize: 12, fontWeight: 700, color: 'var(--ink)' }}>
                    <div style={{ fontSize: 9, textTransform: 'uppercase', opacity: 0.6, marginBottom: 2 }}>Alternative :</div>
                    {h.action.split(' : ')[1]}
                  </div>
                ))}
              </DetailCard>
            );
          })}
        </div>

        <div style={{ marginTop: 20 }}>
          <SectionLabel spaced>{"Note d'emballage"}</SectionLabel>
          <textarea
            className="mobile-search-input packing-note"
            value={packingNote}
            onChange={e => setPackingNote(e.target.value)}
            placeholder="Note optionnelle..."
            style={{ height: 80, padding: 12, fontSize: 13, background: '#F2F2F7', border: 'none', borderRadius: 12, width: '100%' }}
          />
        </div>
      </Modal>
    );
  }

  // DESKTOP VIEW
  return (
    <Modal isOpen={true} onClose={onClose} title={`Emballage · ${order.ref}`} large
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Fermer</button>
          {order.status === 'PACKED' ? (
            <button className="btn-secondary" onClick={() => onMarkPacking(order.id, 'CONFIRMED')} disabled={isPending} style={{ background: '#FEE2E2', color: '#EF4444', borderColor: '#FCA5A5' }}>
              <ArrowLeftRight size={14} /> Annuler l&apos;emballage
            </button>
          ) : (
            <>
              <button className="btn-secondary" onClick={() => onMarkPacking(order.id, 'UNAVAILABLE')} disabled={isPending} style={{ borderColor: 'var(--red)', color: 'var(--red)' }}>
                Pas en stock
              </button>
              <button className="btn-secondary" onClick={() => onMarkPacking(order.id, 'PARTIAL')} disabled={isPending || !isPartial} title={!isPartial ? "Cochez au moins un article et laissez les articles manquants décochés" : undefined} style={{ borderColor: 'var(--amber)', color: 'var(--amber)' }}>
                Incomplet
              </button>
              <button className="btn-orange" onClick={() => onMarkPacking(order.id, 'PACKED')} disabled={isPending || !isComplete} title={!isComplete ? "Vérifiez tous les articles avant de valider" : undefined}>
                <Check size={14} /> Prêt pour livraison ✓
              </button>
            </>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, color: 'var(--orange)', fontSize: 20 }}>{order.ref}</div>
          <div style={{ fontWeight: 700, marginTop: 4 }}>{order.customerName} · {order.commune}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            {order.commercialName && <span style={{ fontSize: 10, fontWeight: 700, background: '#E8F4FD', color: '#0A84FF', padding: '2px 8px', borderRadius: 6 }}>🛒 {order.commercialName}</span>}
            {order.packedByName && <span style={{ fontSize: 10, fontWeight: 700, background: '#F2FBF4', color: '#34C759', padding: '2px 8px', borderRadius: 6 }}>📦 {order.packedByName}</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--brown-soft)', marginBottom: 4 }}>PROGRESSION</div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{progress} / {total}</div>
        </div>
      </div>

      <SectionLabel>{"Checklist de l'emballeur"}</SectionLabel>
      {order.items.map((item, idx: number) => {
        const p = productMap.get(item.productId || "");
        const isChecked = item.isVerified;
        const isSaving = savingChecks.has(item.id);
        const giftBlocked = item.isGift && item.giftApprovalStatus !== 'APPROVED';
        return (
          <DetailCard
            key={idx}
            className={`packing-checklist-card ${isChecked ? 'checked' : ''}`}
            style={{
              marginBottom: 12,
              border: isSaving ? '1.5px solid var(--orange)' : undefined,
              opacity: isSaving ? 0.75 : 1,
              animation: isSaving ? 'pulse-border 1s ease infinite' : 'none',
              transition: 'all 0.2s ease',
              position: 'relative' as const,
              pointerEvents: isSaving ? 'none' as const : 'auto' as const,
            }}
            onClick={() => { if (!giftBlocked) onToggleCheckItem(order.id, item); }}
          >
            {isSaving && (
              <div style={{
                position: 'absolute', top: 8, right: 10,
                padding: '3px 8px',
                background: 'var(--orange)',
                color: 'white',
                fontSize: 9,
                fontWeight: 800,
                borderRadius: 6,
                zIndex: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                letterSpacing: '0.05em',
              }}>
                <Loader2 size={10} style={{ animation: 'spin 0.8s linear infinite' }} />
                ENREGISTREMENT
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, border: '2px solid', borderColor: isChecked ? 'var(--green)' : 'var(--line)', background: isChecked ? 'var(--green-soft)' : 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 4 }}>
                {savingChecks.has(item.id)
                  ? <Loader2 size={16} color="var(--brown-soft)" style={{ animation: 'spin 0.8s linear infinite' }} />
                  : isChecked && <Check size={18} color="var(--green)" />
                }
              </div>
              <div style={{ width: 60, height: 60, background: 'var(--cream-2)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, flexShrink: 0, overflow: 'hidden', border: '1px solid var(--line)' }}>
                {item.image ? <img src={item.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onClick={(e) => { e.stopPropagation(); onPreviewImage(item.image!, item.name, item.size, item.color); }} /> : (item.emoji || '📦')}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, textDecoration: isChecked ? 'line-through' : 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {item.name}
                      {item.isGift && <span style={{ fontSize: 9, background: 'var(--orange-soft)', color: 'var(--orange)', padding: '1px 6px', borderRadius: 10, fontWeight: 800, textTransform: 'uppercase' }}>Cadeau</span>}
                      {giftBlocked && <span style={{ fontSize: 8, background: '#FEE2E2', color: '#B91C1C', padding: '2px 6px', borderRadius: 8, fontWeight: 900 }}>{item.giftApprovalStatus === 'REJECTED' ? 'REFUSÉ' : 'EN ATTENTE ADMIN'}</span>}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--brown-soft)', marginTop: 4 }}>
                      Taille : {item.size} | Couleur : {item.color} | Qté : x{item.qty}
                    </div>
                    {order.history?.filter((h) => h.action.includes(`Alternative proposée pour "${item.name}"`)).map((h, hi: number) => (
                      <div key={hi} style={{ fontSize: 10, color: 'var(--orange)', background: 'var(--orange-soft)', padding: '1px 6px', borderRadius: 4, fontWeight: 700, marginTop: 4 }}>
                        {h.action.split(' : ')[1]}
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      className={`packing-item-choice packed ${item.packingStatus === 'PACKED' || isChecked ? 'active' : ''}`}
                      disabled={isSaving || giftBlocked}
                      onClick={(event) => { event.stopPropagation(); if (!isChecked) onToggleCheckItem(order.id, item); }}
                    >
                      {isChecked ? 'Emballé ✓' : 'Emballé'}
                    </button>
                    <button
                      type="button"
                    className={`packing-item-choice not-packed ${item.packingStatus === 'NOT_PACKED' ? 'active' : ''}`}
                    aria-pressed={item.packingStatus === 'NOT_PACKED'}
                      disabled={isSaving}
                      onClick={(event) => { event.stopPropagation(); onMarkItemNotPacked(order.id, item); }}
                    >
                    {item.packingStatus === 'NOT_PACKED' ? 'Retirer “Pas emballé”' : 'Pas emballé'}
                    </button>
                    {canEditStock && <button
                      className="action-btn"
                      onClick={(e) => { e.stopPropagation(); if (p) onEditStock(p); }}
                      title="Modifier Stock"
                    >
                      <Edit2 size={14} />
                    </button>}
                    <button className="action-btn" onClick={(e) => { e.stopPropagation(); onProposeAlternative(order.id, item.name); }}><ArrowLeftRight size={14} /></button>
                  </div>
                </div>
              </div>
            </div>
          </DetailCard>
        );
      })}

      <div style={{ marginTop: 20 }}>
        <SectionLabel>{"Note d'emballage"}</SectionLabel>
        <textarea className="field-input packing-note" value={packingNote} onChange={e => setPackingNote(e.target.value)} style={{ minHeight: 80 }} placeholder="Ajoutez une précision utile pour l'équipe…" />
      </div>
    </Modal>
  );
}
