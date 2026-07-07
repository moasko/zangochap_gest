import React from "react";
import { STATUS_LABELS, STATUS_CSS } from "@/lib/constants";
import { getImageUrl } from "@/lib/utils";
import "./ui.css";

export const TableCard = ({ title, meta, children, actions, className }: { 
  title: string, 
  meta?: string, 
  children: React.ReactNode,
  actions?: React.ReactNode,
  className?: string
}) => (
  <div className={`table-card ${className || ''}`}>
    <div className="table-head">
      <div>
        <div className="table-title">{title}</div>
        {meta && <div className="table-meta">{meta}</div>}
      </div>
      {actions && <div>{actions}</div>}
    </div>
    <div className="table-wrap">
      {children}
    </div>
  </div>
);

export const StatusBadge = ({ status, size }: { status?: string | null, size?: 'sm' | 'md' | 'lg' }) => {
  const s = String(status || '').toUpperCase();
  const cssClass = STATUS_CSS[s] || s.toLowerCase() || 'pending';
  const label = STATUS_LABELS[s] || status || 'En attente';

  return (
    <span className={`status ${cssClass} ${size ? `status-${size}` : ''}`}>
      {label}
    </span>
  );
};

export const StatCard = ({ 
  label, value, trend, trendDir, color, accent, dark, compact, icon 
}: { 
  label: string; 
  value: string | number; 
  trend?: string; 
  trendDir?: 'up' | 'down'; 
  color?: string; 
  accent?: boolean;
  dark?: boolean;
  compact?: boolean;
  icon?: React.ReactNode;
}) => (
  <div className={`stat-card ${accent ? 'accent' : ''} ${dark ? 'dark' : ''} ${compact ? 'compact' : ''}`}>
    <div className="stat-head stat-head-row">
      <div className="stat-label">{label}</div>
      {icon && <div className="stat-icon stat-icon-fade">{icon}</div>}
    </div>
    <div className="stat-value" style={color ? { color } : undefined}>{value}</div>
    {trend && (
      <div className={`stat-trend ${trendDir || ''}`}>
        {trendDir === 'up' ? '↑' : trendDir === 'down' ? '↓' : ''} {trend}
      </div>
    )}
  </div>
);

export const EmptyState = ({ icon, title, description }: { icon: React.ReactNode; title: string; description?: string }) => (
  <div className="empty">
    <div className="empty-icon">{icon}</div>
    <h4>{title}</h4>
    {description && <p>{description}</p>}
  </div>
);

export const SectionLabel = ({ children, spaced }: { children: React.ReactNode; spaced?: boolean }) => (
  <div className={`section-label ${spaced ? 'section-label-spaced' : ''}`}>{children}</div>
);

export const DetailCard = ({ label, children, className, style, onClick }: { label?: string; children: React.ReactNode; className?: string; style?: React.CSSProperties; onClick?: () => void }) => (
  <div className={`detail-card ${className || ''}`} style={style} onClick={onClick}>
    {label && <div className="detail-label">{label}</div>}
    {children}
  </div>
);

export const ItemLine = ({ emoji, name, meta, price, image, onImageClick, isGift }: { 
  emoji?: string; 
  name: string; 
  meta?: string; 
  price?: string;
  image?: string | null;
  onImageClick?: (url: string) => void;
  isGift?: boolean;
}) => (
  <div className="item-line">
    <div className={`item-emoji ${image ? 'item-emoji-img' : ''}`} onClick={() => image && onImageClick?.(getImageUrl(image))}>
      {image ? <img src={getImageUrl(image)} className="item-img-full" /> : (emoji || '📦')}
    </div>
    <div className="item-info">
      <div className="item-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {name}
        {isGift && <span style={{ fontSize: 9, background: 'var(--orange-soft)', color: 'var(--orange)', padding: '1px 6px', borderRadius: 10, fontWeight: 800, textTransform: 'uppercase' }}>Cadeau</span>}
      </div>
      {meta && <div className="item-meta">{meta}</div>}
    </div>
    {price && <div className="item-price">{price}</div>}
  </div>
);

export const InfoBanner = ({ variant = 'blue', children }: { variant?: 'blue' | 'amber' | 'green'; children: React.ReactNode }) => (
  <div className={`info-banner ${variant}`}>
    {children}
  </div>
);

import { MapPin } from "lucide-react";

export const LocationBadge = ({ location }: { location?: string | null }) => {
  if (!location || location === '—') return <span className="cell-muted">—</span>;
  
  // Extract zone (first letter)
  const zone = location.charAt(0).toUpperCase();
  const isZoneA = zone === 'A';
  const isZoneB = zone === 'B';
  const isZoneC = zone === 'C';

  return (
    <span className={`location-badge ${isZoneA ? 'zone-a' : isZoneB ? 'zone-b' : isZoneC ? 'zone-c' : ''}`}>
      <MapPin size={10} className="location-icon" />
      {location}
    </span>
  );
};
