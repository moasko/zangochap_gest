"use client";

import React, { useState, useMemo, useCallback, useRef, useTransition } from 'react';
import { StatCard, TableCard, StatusBadge } from '@/components/UI';
import Modal from '@/components/Modal';
import { TrendingUp, Truck, ShoppingBag, Target, Package, Eye, Search, Loader2, Award, Phone, Box, CalendarRange, X, RotateCcw } from 'lucide-react';
import { formatPrice, formatDate } from '@/lib/constants';
import { useRouter } from 'next/navigation';
import { getUserPerformanceDetails } from "@/modules/orders/actions";
import "./performance-client.css";

interface PerformanceClientProps {
  initialDateFrom: string;
  initialDateTo: string;
  stats: {
    commercialsStats: CommercialStat[];
    deliveryStats: DeliveryStat[];
    collectorStats: CollectorStat[];
    packingStats: PackingStat[];
    summary: {
      totalRevenue: number;
      totalOrders: number;
      avgOrderValue: number;
      globalSuccessRate: number;
      totalPacked: number;
      totalCollected: number;
      deliveredWithGifts: number;
      deliveredWithoutGifts: number;
    };
  };
}

type BaseMember = { id: string; name: string };
type CommercialStat = BaseMember & { sales: number; delivered: number; deliveredWithGifts: number; deliveredWithoutGifts: number; cancelled: number; interventions: number; interventionsDelivered: number; revenue: number; convRate: number; prime: number };
type DeliveryStat = BaseMember & { total: number; delivered: number; returned: number; revenue: number; successRate: number };
type CollectorStat = BaseMember & { count: number; collected: number; unavailable: number; alternative: number; successRate: number };
type PackingStat = BaseMember & { packed: number; completed: number; partial: number; score: number };
type DetailItem = {
  createdAt?: string | Date | null;
  packedAt?: string | Date | null;
  performanceAt?: string | Date | null;
  ref?: string | null;
  productId?: string | null;
  customerName?: string | null;
  total?: number;
  status?: string | null;
};
type DetailSummaryData = {
  total?: number;
  delivered?: number;
  deliveredWithGifts?: number;
  deliveredWithoutGifts?: number;
  returned?: number;
  collected?: number;
  unavailable?: number;
  completed?: number;
  partial?: number;
  revenue?: number;
  convRate?: number;
  successRate?: number;
  score?: number;
  interventions?: number;
  interventionsDelivered?: number;
};
type MemberDetails = { summary?: DetailSummaryData; orders?: DetailItem[]; records?: DetailItem[] };

// Rank badge component
function RankBadge({ rank }: { rank: number }) {
  const cls = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
  return <div className={`rank-badge ${cls}`}>{rank}</div>;
}

// Progress bar component
function ProgressBar({ value, color }: { value: number; color: string }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    <div className="progress-bar-wrap">
      <div className="progress-bar-bg">
        <div className="progress-bar-fill" style={{ width: `${safeValue}%`, background: color }} />
      </div>
      <span className="progress-bar-label" style={{ color }}>{value}%</span>
    </div>
  );
}

// Color helper for rates
function rateColor(rate: number) {
  if (rate >= 90) return 'var(--green)';
  if (rate >= 70) return 'var(--orange)';
  return 'var(--red)';
}

function localDateValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function PerformanceClient({ stats, initialDateFrom, initialDateTo }: PerformanceClientProps) {
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo);
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [selectedMember, setSelectedMember] = useState<{ id: string; name: string; role: string } | null>(null);
  const [memberDetails, setMemberDetails] = useState<MemberDetails | null>(null);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [isFiltering, startFiltering] = useTransition();
  const detailRequestId = useRef(0);
  const router = useRouter();

  const selectedMonth = useMemo(() => {
    if (!dateFrom || !dateTo || !dateFrom.endsWith('-01')) return '';
    const [year, month] = dateFrom.split('-').map(Number);
    const monthEnd = localDateValue(new Date(year, month, 0));
    const today = localDateValue(new Date());
    return dateTo === monthEnd || (dateTo === today && dateFrom.slice(0, 7) === today.slice(0, 7))
      ? dateFrom.slice(0, 7)
      : '';
  }, [dateFrom, dateTo]);

  const selectMonth = (value: string) => {
    if (!value) {
      setDateFrom('');
      setDateTo('');
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(value)) return;
    const [year, month] = value.split('-').map(Number);
    if (year < 100 || month < 1 || month > 12) return;
    setDateFrom(`${value}-01`);
    setDateTo(localDateValue(new Date(year, month, 0)));
  };

  const setQuickDate = (range: 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'all') => {
    const now = new Date();
    let from = '', to = localDateValue(now);
    if (range === 'today') { from = to; }
    else if (range === 'yesterday') { const y = new Date(); y.setDate(y.getDate() - 1); from = localDateValue(y); to = from; }
    else if (range === 'week') { const w = new Date(); w.setDate(w.getDate() - 6); from = localDateValue(w); }
    else if (range === 'month') { from = localDateValue(new Date(now.getFullYear(), now.getMonth(), 1)); }
    else if (range === 'lastMonth') { from = localDateValue(new Date(now.getFullYear(), now.getMonth() - 1, 1)); to = localDateValue(new Date(now.getFullYear(), now.getMonth(), 0)); }
    else { from = ''; to = ''; }
    setDateFrom(from);
    setDateTo(to);
  };

  React.useEffect(() => {
    if (dateFrom && dateTo && dateFrom > dateTo) return;
    if (dateFrom || dateTo) {
      const params = new URLSearchParams();
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      startFiltering(() => router.replace(`/zangochap-manager/admin/performance?${params.toString()}`));
    } else {
      startFiltering(() => router.replace('/zangochap-manager/admin/performance'));
    }
  }, [dateFrom, dateTo, router]);

  const activeRange = useMemo(() => {
    const now = new Date();
    const today = localDateValue(now);
    const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
    const weekStart = new Date(now); weekStart.setDate(weekStart.getDate() - 6);
    const monthStart = localDateValue(new Date(now.getFullYear(), now.getMonth(), 1));
    const lastMonthStart = localDateValue(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const lastMonthEnd = localDateValue(new Date(now.getFullYear(), now.getMonth(), 0));
    if (!dateFrom && !dateTo) return 'all';
    if (dateFrom === today && dateTo === today) return 'today';
    if (dateFrom === localDateValue(yesterday) && dateTo === localDateValue(yesterday)) return 'yesterday';
    if (dateFrom === localDateValue(weekStart) && dateTo === today) return 'week';
    if (dateFrom === monthStart && (dateTo === today || dateTo === localDateValue(new Date(now.getFullYear(), now.getMonth() + 1, 0)))) return 'month';
    if (dateFrom === lastMonthStart && dateTo === lastMonthEnd) return 'lastMonth';
    return 'custom';
  }, [dateFrom, dateTo]);

  const periodLabel = useMemo(() => {
    if (!dateFrom && !dateTo) return 'Toutes les données';
    if (dateFrom && dateTo && dateFrom > dateTo) return 'Période invalide';
    const label = (value: string) => new Date(`${value}T00:00:00`).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
    if (dateFrom && dateTo && dateFrom === dateTo) return label(dateFrom);
    if (dateFrom && dateTo) return `${label(dateFrom)} au ${label(dateTo)}`;
    if (dateFrom) return `Depuis le ${label(dateFrom)}`;
    return `Jusqu'au ${label(dateTo)}`;
  }, [dateFrom, dateTo]);

  const handleViewDetails = useCallback(async (member: BaseMember, role: string) => {
    const requestId = ++detailRequestId.current;
    setSelectedMember({ ...member, role });
    setMemberDetails(null);
    setIsLoadingDetails(true);
    try {
      const details = await getUserPerformanceDetails(member.id, role, dateFrom, dateTo);
      if (requestId === detailRequestId.current) setMemberDetails(details);
    } catch (error) {
      console.error(error);
      if (requestId === detailRequestId.current) setMemberDetails(null);
    } finally {
      if (requestId === detailRequestId.current) setIsLoadingDetails(false);
    }
  }, [dateFrom, dateTo]);

  const filtered = useMemo(() => {
    const s = searchTerm.toLowerCase();
    return {
      commercials: stats.commercialsStats.filter(c => c.name.toLowerCase().includes(s)).sort((a, b) => b.revenue - a.revenue),
      delivery: stats.deliveryStats.filter(d => d.name.toLowerCase().includes(s)).sort((a, b) => b.successRate - a.successRate),
      collectors: stats.collectorStats.filter(c => c.name.toLowerCase().includes(s)).sort((a, b) => b.count - a.count),
      packing: stats.packingStats.filter(p => p.name.toLowerCase().includes(s)).sort((a, b) => b.packed - a.packed),
    };
  }, [stats, searchTerm]);

  const roles = [
    { key: 'ALL', label: 'Vue globale', count: stats.commercialsStats.length + stats.deliveryStats.length + stats.collectorStats.length + stats.packingStats.length },
    { key: 'COMMERCIAL', label: 'Call Center', count: stats.commercialsStats.length, icon: <Phone size={13} /> },
    { key: 'PACKING', label: 'Emballage', count: stats.packingStats.length, icon: <Package size={13} /> },
    { key: 'COLLECTION', label: 'Collecte', count: stats.collectorStats.length, icon: <Box size={13} /> },
    { key: 'LIVREUR', label: 'Livreurs', count: stats.deliveryStats.length, icon: <Truck size={13} /> },
  ];

  return (
    <div className="content animate-fade-in">
      {/* HEADER */}
      <div className="perf-header">
        <div>
          <div className="perf-title-row">
            <h1>Performance Équipe</h1>
            <span className="period-badge"><CalendarRange size={13} /> {periodLabel}</span>
          </div>
          <p>Analyse détaillée de l&apos;activité par collaborateur et service.</p>
        </div>
        <div className="perf-controls">
          <div className="search-bar perf-search">
            <Search size={15} color="var(--brown-soft)" />
            <input type="text" placeholder="Chercher..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
            {searchTerm && <button type="button" className="clear-search" onClick={() => setSearchTerm('')} aria-label="Effacer la recherche"><X size={14} /></button>}
          </div>
          <div className="perf-filter-panel">
            <div className="perf-shortcuts" aria-label="Périodes rapides">
              <button className={`shortcut-btn ${activeRange === 'all' ? 'active' : ''}`} onClick={() => setQuickDate('all')}>Tout</button>
              <button className={`shortcut-btn ${activeRange === 'today' ? 'active' : ''}`} onClick={() => setQuickDate('today')}>Aujourd&apos;hui</button>
              <button className={`shortcut-btn ${activeRange === 'yesterday' ? 'active' : ''}`} onClick={() => setQuickDate('yesterday')}>Hier</button>
              <button className={`shortcut-btn ${activeRange === 'week' ? 'active' : ''}`} onClick={() => setQuickDate('week')}>7 jours</button>
              <button className={`shortcut-btn ${activeRange === 'month' ? 'active' : ''}`} onClick={() => setQuickDate('month')}>Ce mois</button>
              <button className={`shortcut-btn ${activeRange === 'lastMonth' ? 'active' : ''}`} onClick={() => setQuickDate('lastMonth')}>Mois dernier</button>
            </div>
            <div className="perf-date-range">
              <label><span>Mois</span><input type="month" className="filter-date" aria-label="Filtrer par mois et année" value={selectedMonth} onChange={e => selectMonth(e.target.value)} /></label>
              <label><span>Du</span><input type="date" className="filter-date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} /></label>
              <span style={{ color: 'var(--line)', fontSize: 10 }}>→</span>
              <label><span>Au</span><input type="date" className="filter-date" value={dateTo} onChange={e => setDateTo(e.target.value)} /></label>
              {(dateFrom || dateTo) && <button type="button" className="reset-period" onClick={() => setQuickDate('all')} title="Réinitialiser la période"><RotateCcw size={14} /></button>}
              {isFiltering && <Loader2 className="animate-spin filter-spinner" size={16} />}
            </div>
            {dateFrom && dateTo && dateFrom > dateTo && (
              <span className="filter-error">La date de début doit précéder la date de fin.</span>
            )}
          </div>
        </div>
      </div>

      {/* SUMMARY */}
      <div className="perf-stats">
        <StatCard label="CA Livré" value={formatPrice(stats.summary.totalRevenue)} icon={<TrendingUp size={18} />} accent />
        <StatCard label="Commandes" value={stats.summary.totalOrders} icon={<ShoppingBag size={18} />} />
        <StatCard label="Livrées avec cadeaux" value={stats.summary.deliveredWithGifts} icon={<Package size={18} />} />
        <StatCard label="Livrées sans cadeaux" value={stats.summary.deliveredWithoutGifts} icon={<ShoppingBag size={18} />} />
        <StatCard label="Panier Moyen" value={formatPrice(stats.summary.avgOrderValue)} icon={<Award size={18} />} />
        <StatCard label="Taux Livraison" value={`${stats.summary.globalSuccessRate}%`} icon={<Target size={18} />} />
        <StatCard label="Colis Emballés" value={stats.summary.totalPacked} icon={<Package size={18} />} />
        <StatCard label="Collectes réussies" value={stats.summary.totalCollected} icon={<Box size={18} />} />
      </div>

      {/* ROLE TABS */}
      <p className="text-xs text-[var(--brown-soft)] mb-4">
        Livrées inclut les livraisons partielles. Avec cadeaux = au moins un article marqué cadeau dans la commande, comptée une seule fois.
        Les compteurs globaux suivent la date de livraison ; le tableau commercial suit les commandes créées sur la période.
      </p>
      <div className="perf-tabs">
        {roles.map(r => (
          <button key={r.key} onClick={() => setRoleFilter(r.key)} aria-pressed={roleFilter === r.key} className={`role-btn ${roleFilter === r.key ? 'active' : ''}`}>
            {r.icon} {r.label} <span className="role-count">{r.count}</span>
          </button>
        ))}
      </div>

      {/* SECTIONS */}
      <div className="perf-sections">

        {/* ─── CALL CENTER ─── */}
        {(roleFilter === 'ALL' || roleFilter === 'COMMERCIAL') && (
          <TableCard title="Call Center" meta={`${filtered.commercials.length} commerciaux — Basé sur les commandes créées et livrées`}>
            {filtered.commercials.length === 0 ? (
              <div className="perf-empty"><div className="perf-empty-icon">📞</div><p>Aucun commercial trouvé</p></div>
            ) : (
              <table>
                <thead><tr><th>#</th><th>Commercial</th><th>Total</th><th>Livrées</th><th>Livrées avec cadeaux</th><th>Livrées sans cadeaux</th><th>Annulées</th><th title="Alertes livreur traitées puis commande livrée">Interv. & livré</th><th>CA Livré</th><th>Taux</th><th>Prime 1%</th><th style={{ width: 36 }}></th></tr></thead>
                <tbody>
                  {filtered.commercials.map((c, i) => (
                    <tr key={c.id}>
                      <td><RankBadge rank={i + 1} /></td>
                      <td><span className="cell-strong">{c.name}</span></td>
                      <td>{c.sales}</td>
                      <td><span style={{ color: 'var(--green)', fontWeight: 600 }}>{c.delivered}</span></td>
                      <td>{c.deliveredWithGifts}</td>
                      <td>{c.deliveredWithoutGifts}</td>
                      <td><span style={{ color: c.cancelled > 0 ? 'var(--red)' : 'var(--brown-soft)' }}>{c.cancelled}</span></td>
                      <td title={`${c.interventions || 0} intervention(s) sur alerte livreur, dont ${c.interventionsDelivered || 0} livrée(s)`}>
                        <span style={{ color: 'var(--green)', fontWeight: 600 }}>{c.interventionsDelivered || 0}</span>
                        <span style={{ color: 'var(--brown-soft)', fontSize: 11 }}> / {c.interventions || 0}</span>
                      </td>
                      <td><span className="cell-price">{formatPrice(c.revenue)}</span></td>
                      <td><ProgressBar value={c.convRate} color={rateColor(c.convRate)} /></td>
                      <td><span style={{ color: 'var(--orange)', fontWeight: 700, fontSize: 12 }}>{formatPrice(c.prime)}</span></td>
                      <td><button className="icon-btn-small" onClick={() => handleViewDetails(c, 'COMMERCIAL')} title={`Voir le détail de ${c.name}`} aria-label={`Voir le détail de ${c.name}`}><Eye size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TableCard>
        )}

        {/* ─── EMBALLAGE ─── */}
        {(roleFilter === 'ALL' || roleFilter === 'PACKING') && (
          <TableCard title="Service Emballage" meta={`${filtered.packing.length} emballeurs — Basé sur les colis préparés (packedBy)`}>
            {filtered.packing.length === 0 ? (
              <div className="perf-empty"><div className="perf-empty-icon">📦</div><p>Aucun emballeur trouvé</p></div>
            ) : (
              <table>
                <thead><tr><th>#</th><th>Emballeur</th><th>Colis</th><th>Complets</th><th>Partiels</th><th>Score qualité</th><th style={{ width: 36 }}></th></tr></thead>
                <tbody>
                  {filtered.packing.map((p, i) => (
                    <tr key={p.id}>
                      <td><RankBadge rank={i + 1} /></td>
                      <td><span className="cell-strong">{p.name}</span></td>
                      <td><strong>{p.packed}</strong></td>
                      <td><span style={{ color: 'var(--green)', fontWeight: 600 }}>{p.completed}</span></td>
                      <td><span style={{ color: p.partial > 0 ? 'var(--amber)' : 'var(--brown-soft)' }}>{p.partial}</span></td>
                      <td><ProgressBar value={p.score} color={rateColor(p.score)} /></td>
                      <td><button className="icon-btn-small" onClick={() => handleViewDetails(p, 'PACKING')} title={`Voir le détail de ${p.name}`} aria-label={`Voir le détail de ${p.name}`}><Eye size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TableCard>
        )}

        {/* ─── COLLECTE ─── */}
        {(roleFilter === 'ALL' || roleFilter === 'COLLECTION') && (
          <TableCard title="Service Collecte" meta={`${filtered.collectors.length} collecteurs — Basé sur les CollectionRecord créés`}>
            {filtered.collectors.length === 0 ? (
              <div className="perf-empty"><div className="perf-empty-icon">🚚</div><p>Aucun collecteur trouvé</p></div>
            ) : (
              <table>
                <thead><tr><th>#</th><th>Collecteur</th><th>Total</th><th>Collectés</th><th>Indispos</th><th>Alternatifs</th><th>Taux réussite</th><th style={{ width: 36 }}></th></tr></thead>
                <tbody>
                  {filtered.collectors.map((c, i) => (
                    <tr key={c.id}>
                      <td><RankBadge rank={i + 1} /></td>
                      <td><span className="cell-strong">{c.name}</span></td>
                      <td><strong>{c.count}</strong></td>
                      <td><span style={{ color: 'var(--green)', fontWeight: 600 }}>{c.collected}</span></td>
                      <td><span style={{ color: c.unavailable > 0 ? 'var(--red)' : 'var(--brown-soft)' }}>{c.unavailable}</span></td>
                      <td><span style={{ color: 'var(--blue)' }}>{c.alternative}</span></td>
                      <td><ProgressBar value={c.successRate} color={rateColor(c.successRate)} /></td>
                      <td><button className="icon-btn-small" onClick={() => handleViewDetails(c, 'COLLECTION')} title={`Voir le détail de ${c.name}`} aria-label={`Voir le détail de ${c.name}`}><Eye size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TableCard>
        )}

        {/* ─── LIVREURS ─── */}
        {(roleFilter === 'ALL' || roleFilter === 'LIVREUR') && (
          <TableCard title="Livreurs" meta={`${filtered.delivery.length} livreurs — Basé sur les commandes assignées (deliverymanId)`}>
            {filtered.delivery.length === 0 ? (
              <div className="perf-empty"><div className="perf-empty-icon">🏍️</div><p>Aucun livreur trouvé</p></div>
            ) : (
              <table>
                <thead><tr><th>#</th><th>Livreur</th><th>Sortis</th><th>Livrés</th><th>Retours</th><th>CA Livré</th><th>Taux</th><th style={{ width: 36 }}></th></tr></thead>
                <tbody>
                  {filtered.delivery.map((d, i) => (
                    <tr key={d.id}>
                      <td><RankBadge rank={i + 1} /></td>
                      <td><span className="cell-strong">{d.name}</span></td>
                      <td>{d.total}</td>
                      <td><span style={{ color: 'var(--green)', fontWeight: 600 }}>{d.delivered}</span></td>
                      <td><span style={{ color: d.returned > 0 ? 'var(--red)' : 'var(--brown-soft)' }}>{d.returned}</span></td>
                      <td><span className="cell-price">{formatPrice(d.revenue)}</span></td>
                      <td><ProgressBar value={d.successRate} color={rateColor(d.successRate)} /></td>
                      <td><button className="icon-btn-small" onClick={() => handleViewDetails(d, 'LIVREUR')} title={`Voir le détail de ${d.name}`} aria-label={`Voir le détail de ${d.name}`}><Eye size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TableCard>
        )}
      </div>

      {/* ─── DETAIL MODAL ─── */}
      {selectedMember && (
        <Modal isOpen onClose={() => { setSelectedMember(null); setMemberDetails(null); }} title={`${selectedMember.name} — ${selectedMember.role}`}>
          <div style={{ minHeight: 280 }}>
            {isLoadingDetails ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 280, gap: 12 }}>
                <Loader2 className="animate-spin" size={28} color="var(--orange)" />
                <p style={{ color: 'var(--brown-soft)', fontSize: 13 }}>Chargement...</p>
              </div>
            ) : memberDetails ? (
              <div>
                {/* Summary Cards */}
                {memberDetails.summary && <DetailSummary summary={memberDetails.summary} role={selectedMember.role} />}
                {/* Detail Table */}
                <div className="detail-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Référence</th>
                        {selectedMember.role !== 'COLLECTION' && <th>Client</th>}
                        {(selectedMember.role === 'COMMERCIAL' || selectedMember.role === 'LIVREUR') && <th>Montant</th>}
                        <th>Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(memberDetails.orders || memberDetails.records)?.map((item: DetailItem, i: number) => (
                        <tr key={i}>
                          <td style={{ color: 'var(--brown-soft)', whiteSpace: 'nowrap' }}>{item.performanceAt || item.packedAt || item.createdAt ? formatDate(item.performanceAt || item.packedAt || item.createdAt || '') : '—'}</td>
                          <td><span style={{ fontWeight: 600 }}>{item.ref || item.productId || '—'}</span></td>
                          {selectedMember.role !== 'COLLECTION' && <td style={{ fontSize: 11 }}>{item.customerName || '—'}</td>}
                          {(selectedMember.role === 'COMMERCIAL' || selectedMember.role === 'LIVREUR') && (
                            <td><span className="cell-price">{formatPrice(item.total)}</span></td>
                          )}
                          <td><StatusBadge status={item.status} /></td>
                        </tr>
                      ))}
                      {!(memberDetails.orders || memberDetails.records)?.length && (
                        <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--brown-soft)' }}>Aucune activité sur cette période.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="perf-empty"><p>Aucune donnée disponible.</p></div>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={() => setSelectedMember(null)}>Fermer</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Sub-component for detail modal summary
function DetailSummary({ summary, role }: { summary: DetailSummaryData; role: string }) {
  if (role === 'COMMERCIAL') {
    return (
      <div className="detail-stats-row">
        <div className="detail-stat-box"><div className="detail-stat-label">Commandes</div><div className="detail-stat-value">{summary.total}</div></div>
        <div className="detail-stat-box"><div className="detail-stat-label">Livrées</div><div className="detail-stat-value" style={{ color: 'var(--green)' }}>{summary.delivered}</div></div>
        <div className="detail-stat-box"><div className="detail-stat-label">Livrées avec cadeaux</div><div className="detail-stat-value">{summary.deliveredWithGifts}</div></div>
        <div className="detail-stat-box"><div className="detail-stat-label">Livrées sans cadeaux</div><div className="detail-stat-value">{summary.deliveredWithoutGifts}</div></div>
        <div className="detail-stat-box"><div className="detail-stat-label">Taux</div><div className="detail-stat-value">{summary.convRate}%</div></div>
        <div className="detail-stat-box" title={`${summary.interventions || 0} intervention(s) sur alerte livreur, dont ${summary.interventionsDelivered || 0} livrée(s)`}>
          <div className="detail-stat-label">Interv. & livré</div>
          <div className="detail-stat-value" style={{ color: 'var(--green)' }}>{summary.interventionsDelivered || 0}<span style={{ fontSize: 12, color: 'var(--brown-soft)', fontWeight: 500 }}> / {summary.interventions || 0}</span></div>
        </div>
        <div className="detail-stat-box accent"><div className="detail-stat-label">CA Livré</div><div className="detail-stat-value">{formatPrice(summary.revenue)}</div></div>
      </div>
    );
  }
  if (role === 'LIVREUR') {
    return (
      <div className="detail-stats-row">
        <div className="detail-stat-box"><div className="detail-stat-label">Sorties</div><div className="detail-stat-value">{summary.total}</div></div>
        <div className="detail-stat-box"><div className="detail-stat-label">Livrés</div><div className="detail-stat-value" style={{ color: 'var(--green)' }}>{summary.delivered}</div></div>
        <div className="detail-stat-box"><div className="detail-stat-label">Retours</div><div className="detail-stat-value" style={{ color: 'var(--red)' }}>{summary.returned}</div></div>
        <div className="detail-stat-box accent"><div className="detail-stat-label">Taux réussite</div><div className="detail-stat-value">{summary.successRate}%</div></div>
      </div>
    );
  }
  if (role === 'COLLECTION') {
    return (
      <div className="detail-stats-row">
        <div className="detail-stat-box"><div className="detail-stat-label">Total traité</div><div className="detail-stat-value">{summary.total}</div></div>
        <div className="detail-stat-box"><div className="detail-stat-label">Collectés</div><div className="detail-stat-value" style={{ color: 'var(--green)' }}>{summary.collected}</div></div>
        <div className="detail-stat-box"><div className="detail-stat-label">Indispos</div><div className="detail-stat-value" style={{ color: 'var(--red)' }}>{summary.unavailable}</div></div>
        <div className="detail-stat-box accent"><div className="detail-stat-label">Taux réussite</div><div className="detail-stat-value">{summary.successRate}%</div></div>
      </div>
    );
  }
  if (role === 'PACKING') {
    return (
      <div className="detail-stats-row">
        <div className="detail-stat-box"><div className="detail-stat-label">Total colis</div><div className="detail-stat-value">{summary.total}</div></div>
        <div className="detail-stat-box"><div className="detail-stat-label">Complets</div><div className="detail-stat-value" style={{ color: 'var(--green)' }}>{summary.completed}</div></div>
        <div className="detail-stat-box"><div className="detail-stat-label">Partiels</div><div className="detail-stat-value" style={{ color: 'var(--amber)' }}>{summary.partial}</div></div>
        <div className="detail-stat-box accent"><div className="detail-stat-label">Score qualité</div><div className="detail-stat-value">{summary.score}%</div></div>
      </div>
    );
  }
  return null;
}
