"use client";

import React from "react";
import { StatusBadge } from "@/components/UI";
import { Eye } from "lucide-react";
import { motion } from "framer-motion";
import { formatDate } from "@/lib/constants";
import { ReminderMotif } from "./ReminderMotif";

type NonPackedItemLine = {
  color?: string | null;
  emoji?: string | null;
  image?: string | null;
  name?: string | null;
  qty?: number | null;
  size?: string | null;
};

type NonPackedOrder = {
  commercialName?: string | null;
  commune?: string | null;
  createdAt: string | Date;
  customerName?: string | null;
  id: string;
  items: NonPackedItemLine[];
  motif?: string | null;
  motifs?: string[] | null;
  ref?: string | null;
  status?: string | null;
};

interface NonPackedItemProps {
  order: NonPackedOrder;
  isMobile: boolean;
  showCommercial?: boolean;
  reminderKind?: "notPacked" | "alternative";
  onSelect: (order: NonPackedOrder) => void;
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
          {o.items.map((item, i) => (
            <div key={i} style={{ flexShrink: 0, width: 40, height: 40, background: '#F2F2F7', borderRadius: 8, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #E5E5EA' }}>
              {item.image ? (
                <img src={item.image} alt={item.name || "Article"} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: 18 }}>{item.emoji || '📦'}</span>
              )}
            </div>
          ))}
        </div>

        <ReminderMotif motif={o.motif} motifs={o.motifs} />

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
          {o.items.map((item, i) => (
            <div key={i} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
              {item.image ? (
                <img src={item.image} alt={item.name || "Article"} style={{ width: 20, height: 20, borderRadius: 4, objectFit: 'cover' }} />
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
        <div style={{ maxWidth: 280 }}>
          {alternativeBadge}
          <ReminderMotif motif={o.motif} motifs={o.motifs} compact />
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

