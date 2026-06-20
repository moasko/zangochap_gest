"use client";

import React from "react";
import { StatusBadge } from "@/components/UI";
import { Eye } from "lucide-react";
import { motion } from "framer-motion";
import { formatDate } from "@/lib/constants";

interface NonPackedItemProps {
  order: any;
  isMobile: boolean;
  showCommercial?: boolean;
  reminderKind?: "notPacked" | "alternative";
  onSelect: (order: any) => void;
  idx?: number;
}

export default function NonPackedItem({
  order: o,
  isMobile,
  showCommercial,
  reminderKind,
  onSelect,
  idx = 0
}: NonPackedItemProps) {
  const isAlternative = reminderKind === "alternative" || o.status === "ALTERNATIVE" || o.motif === "Alternative proposée";
  const alternativeBadge = isAlternative ? (
    <span className="non-packed-alternative-badge">Alternative proposée</span>
  ) : null;
  
  if (isMobile) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: idx * 0.05 }}
        className="mobile-card"
        onClick={() => onSelect(o)}
        style={{
          padding: 14,
          background: 'white',
          borderRadius: 16,
          border: '1px solid #E5E5EA',
          marginBottom: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 10
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 800, fontSize: 13, color: 'var(--orange)' }}>{o.ref}</div>
            <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>{o.customerName}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            {alternativeBadge}
            <StatusBadge status={o.status} size="sm" />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
          {o.items.map((item: any, i: number) => (
            <div key={i} style={{ flexShrink: 0, width: 40, height: 40, background: '#F2F2F7', borderRadius: 8, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #E5E5EA' }}>
              {item.image ? (
                <img src={item.image} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: 18 }}>{item.emoji || '📦'}</span>
              )}
            </div>
          ))}
        </div>

        <div style={{ padding: '8px 12px', background: 'var(--orange-soft)', borderRadius: 8, fontSize: 12 }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--orange)', marginBottom: 2 }}>MOTIF / ÉTAT</div>
          <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{o.motif}</div>
          {o.motifs?.length > 0 && (
            <div style={{ fontWeight: 700, color: 'var(--orange)', marginTop: 6 }}>
              Motif: {o.motifs.join(' | ')}
            </div>
          )}
        </div>

        {showCommercial && (
          <div style={{ fontSize: 11, fontWeight: 700, color: '#8E8E93' }}>
            🛒 Commercial : {o.commercialName}
          </div>
        )}
      </motion.div>
    );
  }

  // DESKTOP ROW
  return (
    <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => onSelect(o)}>
      <td>
        <div className="cell-mono" style={{ color: 'var(--orange)', fontWeight: 700 }}>{o.ref}</div>
        <div style={{ fontSize: 9, color: '#8E8E93', marginTop: 2 }}>{formatDate(o.createdAt)}</div>
      </td>
      <td>
        <div className="cell-strong">{o.customerName}</div>
        <div className="cell-muted" style={{ fontSize: 10 }}>{o.commune}</div>
      </td>
      <td>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {o.items.map((item: any, i: number) => (
            <div key={i} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
              {item.image ? (
                <img src={item.image} style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: 14 }}>{item.emoji || '📦'}</span>
              )}
              <span style={{ fontWeight: 600 }}>{item.name}</span>
              <span className="size-dot" style={{ fontSize: 9 }}>{item.size}</span>
            </div>
          ))}
        </div>
      </td>
      <td>
        <div style={{ 
          fontSize: 11, 
          color: 'var(--ink)', 
          lineHeight: 1.4, 
          fontWeight: 600, 
          background: 'var(--orange-soft)', 
          padding: '6px 10px', 
          borderRadius: 8,
          borderLeft: '3px solid var(--orange)',
          maxWidth: 240
        }}>
          {alternativeBadge}
          {o.motif}
          {o.motifs?.length > 0 && (
            <div style={{ color: 'var(--orange)', marginTop: 6 }}>
              Motif: {o.motifs.join(' | ')}
            </div>
          )}
        </div>
      </td>
      {showCommercial && <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--ink)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 800 }}>
            {o.commercialName?.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <span className="cell-muted" style={{ fontSize: 11, fontWeight: 600 }}>{o.commercialName}</span>
        </div>
      </td>}
      <td><StatusBadge status={o.status} /></td>
      <td>
        <button className="action-btn" onClick={(e) => { e.stopPropagation(); onSelect(o); }}>
          <Eye size={14} />
        </button>
      </td>
    </tr>
  );
}

