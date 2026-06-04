import React from "react";
import prisma from "@/lib/prisma";
import { StatCard, TableCard, StatusBadge, EmptyState } from "@/components/UI";
import { formatPrice, formatDate } from "@/lib/constants";
import Link from "next/link";
import Topbar from "@/components/Topbar";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  PackageCheck,
  PhoneCall,
  ShoppingBag,
  TrendingUp,
  WalletCards,
  XCircle,
} from "lucide-react";
import "./dashboard.css";

type CommercialDashboardUser = {
  id: string;
  name?: string | null;
};

const STATUS_GROUPS = [
  { label: "Livrees", statuses: ["DELIVERED", "PARTIALLY_DELIVERED"], tone: "green" },
  { label: "En cours", statuses: ["PENDING", "CONFIRMED", "PREPARING", "PACKED", "ON_DELIVERY"], tone: "blue" },
  { label: "A reprendre", statuses: ["PARTIAL", "UNAVAILABLE", "ALTERNATIVE", "REPRO_DISPO"], tone: "amber" },
  { label: "Perdues", statuses: ["CANCELLED", "RETURNED"], tone: "red" },
];

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

export default async function CommercialDashboard({ user }: { user: CommercialDashboardUser }) {
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

  const firstName = user?.name?.split(" ")[0] || "Commercial";
  const ownerFilters = [
    { commercialId: user.id },
    ...(user.name ? [{ commercialName: user.name }] : []),
  ];

  const myOrders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      OR: ownerFilters,
    },
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  const monthOrders = myOrders.filter((order) => new Date(order.createdAt) >= monthStart);
  const todayOrders = myOrders.filter((order) => new Date(order.createdAt) >= today);
  const delivered = monthOrders.filter((order) => ["DELIVERED", "PARTIALLY_DELIVERED"].includes(order.status));
  const cancelled = monthOrders.filter((order) => ["CANCELLED", "RETURNED"].includes(order.status));
  const activeOrders = monthOrders.filter((order) => ["PENDING", "CONFIRMED", "PREPARING", "PACKED", "ON_DELIVERY"].includes(order.status));
  const followUpOrders = myOrders.filter((order) => ["PARTIAL", "UNAVAILABLE", "ALTERNATIVE", "REPRO_DISPO"].includes(order.status));
  const readyToPack = myOrders.filter((order) => ["PENDING", "CONFIRMED"].includes(order.status));
  const toProcess = myOrders.filter((order) => order.status === "TO_PROCESS");

  const deliveredRevenue = delivered.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const todayRevenue = todayOrders
    .filter((order) => ["DELIVERED", "PARTIALLY_DELIVERED"].includes(order.status))
    .reduce((sum, order) => sum + Number(order.total || 0), 0);
  const conversionRate = monthOrders.length ? Math.round((delivered.length / monthOrders.length) * 100) : 0;
  const averageBasket = delivered.length ? Math.round(deliveredRevenue / delivered.length) : 0;

  const sevenDayTrend = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sevenDaysAgo);
    date.setDate(sevenDaysAgo.getDate() + index);
    const nextDate = new Date(date);
    nextDate.setDate(date.getDate() + 1);
    const orders = myOrders.filter((order) => {
      const createdAt = new Date(order.createdAt);
      return createdAt >= date && createdAt < nextDate;
    });
    return {
      key: date.toISOString().split("T")[0],
      label: date.toLocaleDateString("fr-FR", { weekday: "short" }).slice(0, 3),
      dateLabel: formatShortDate(date),
      orders: orders.length,
      revenue: orders
        .filter((order) => ["DELIVERED", "PARTIALLY_DELIVERED"].includes(order.status))
        .reduce((sum, order) => sum + Number(order.total || 0), 0),
    };
  });
  const sevenDayAverage = Math.round(sevenDayTrend.reduce((sum, day) => sum + day.orders, 0) / 7);
  const maxSevenDayOrders = Math.max(...sevenDayTrend.map((day) => day.orders), 1);

  const statusBreakdown = STATUS_GROUPS.map((group) => ({
    ...group,
    value: monthOrders.filter((order) => group.statuses.includes(order.status)).length,
  }));

  const productMap = new Map<string, { name: string; emoji: string; qty: number; revenue: number }>();
  delivered.forEach((order) => {
    order.items.forEach((item) => {
      const key = item.name || item.productId || item.id;
      const current = productMap.get(key) || {
        name: item.name || "Article",
        emoji: item.emoji || "",
        qty: 0,
        revenue: 0,
      };
      current.qty += Number(item.qty || 0);
      current.revenue += Number(item.price || 0) * Number(item.qty || 0);
      productMap.set(key, current);
    });
  });
  const topProducts = Array.from(productMap.values())
    .sort((a, b) => b.qty - a.qty || b.revenue - a.revenue)
    .slice(0, 5);

  const communeMap = new Map<string, { name: string; orders: number; revenue: number }>();
  delivered.forEach((order) => {
    const key = order.commune || "Non renseignee";
    const current = communeMap.get(key) || { name: key, orders: 0, revenue: 0 };
    current.orders += 1;
    current.revenue += Number(order.total || 0);
    communeMap.set(key, current);
  });
  const topCommunes = Array.from(communeMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  return (
    <div className="dashboard-root">
      <Topbar title="Bonjour" subtitle={firstName} />

      <div className="dashboard-content animate-fade-in">
        <div className="dashboard-hero">
          <div className="dashboard-hero-copy">
            <span className="dashboard-kicker">Pilotage commercial</span>
            <h2>Votre activite du mois</h2>
            <p>Suivez vos ventes, les commandes a reprendre et les zones qui performent.</p>
          </div>
          <div className="dashboard-hero-actions">
            <div className="dashboard-hero-metric">
              <span>Aujourd&apos;hui</span>
              <strong>{todayOrders.length}</strong>
              <small>{formatPrice(todayRevenue)}</small>
            </div>
            <Link href="/zangochap-manager/orders/new" className="dashboard-primary-action">
              <ShoppingBag size={16} /> Nouvelle commande
            </Link>
          </div>
        </div>

        <div className="dashboard-stats-grid">
          <StatCard
            label="COMMANDES DU JOUR"
            value={todayOrders.length}
            trend={`${monthOrders.length} ce mois`}
            icon={<ShoppingBag size={20} />}
            accent
          />
          <StatCard
            label="CA LIVRE DU MOIS"
            value={formatPrice(deliveredRevenue)}
            trend={`+${formatPrice(todayRevenue)} aujourd'hui`}
            trendDir={todayRevenue > 0 ? "up" : undefined}
            icon={<TrendingUp size={20} />}
            color="var(--orange)"
          />
          <StatCard
            label="TAUX DE CONVERSION"
            value={`${conversionRate}%`}
            trend={`${delivered.length} livree(s) / ${monthOrders.length}`}
            icon={<CheckCircle2 size={20} />}
            color="var(--green)"
          />
          <StatCard
            label="PANIER MOYEN"
            value={formatPrice(averageBasket)}
            trend="Base commandes livrees"
            icon={<WalletCards size={20} />}
            color="var(--orange)"
          />
        </div>

        <div className="dashboard-ops-grid">
          <Link href="/zangochap-manager/orders?scope=mine&status=pending" className="dashboard-op-tile">
            <span className="op-icon amber"><ClipboardList size={18} /></span>
            <span className="op-body">
              <strong>{activeOrders.length}</strong>
              <small>En cours</small>
            </span>
            <ArrowRight size={16} />
          </Link>
          <Link href="/zangochap-manager/orders?scope=mine&status=all" className="dashboard-op-tile">
            <span className="op-icon blue"><CalendarClock size={18} /></span>
            <span className="op-body">
              <strong>{followUpOrders.length}</strong>
              <small>A reprendre</small>
            </span>
            <ArrowRight size={16} />
          </Link>
          <Link href="/zangochap-manager/orders?scope=mine&status=confirmed" className="dashboard-op-tile">
            <span className="op-icon green"><PackageCheck size={18} /></span>
            <span className="op-body">
              <strong>{readyToPack.length}</strong>
              <small>A emballer</small>
            </span>
            <ArrowRight size={16} />
          </Link>
          <Link href="/zangochap-manager/orders?scope=mine&status=cancelled" className="dashboard-op-tile danger">
            <span className="op-icon red"><XCircle size={18} /></span>
            <span className="op-body">
              <strong>{cancelled.length}</strong>
              <small>Perdues</small>
            </span>
            <ArrowRight size={16} />
          </Link>
        </div>

        <div className="dashboard-data-grid">
          <TableCard
            title="Activite sur 7 jours"
            meta={`Moyenne : ${sevenDayAverage} commande(s) / jour`}
            actions={<Link href="/zangochap-manager/orders?scope=mine" className="dashboard-card-link">Voir commandes</Link>}
          >
            <div className="dashboard-trend-chart commercial-trend-chart">
              {sevenDayTrend.map((day) => {
                const height = Math.max(8, Math.round((day.orders / maxSevenDayOrders) * 100));
                const isToday = day.key === today.toISOString().split("T")[0];
                return (
                  <div key={day.key} className={`dashboard-trend-day ${isToday ? "today" : ""}`}>
                    <div className="dashboard-trend-value">{day.orders}</div>
                    <div className="dashboard-trend-track">
                      <div className="dashboard-trend-bar" style={{ height: `${height}%` }} />
                    </div>
                    <strong>{day.label}</strong>
                    <small>{day.dateLabel}</small>
                  </div>
                );
              })}
            </div>
          </TableCard>

          <TableCard title="Statuts du mois" meta={`${monthOrders.length} commande(s)`}>
            <div className="dashboard-status-list">
              {statusBreakdown.map((item) => {
                const pct = monthOrders.length > 0 ? Math.round((item.value / monthOrders.length) * 100) : 0;
                return (
                  <div key={item.label} className="dashboard-status-item">
                    <div className="dashboard-status-head">
                      <span>{item.label}</span>
                      <strong>{item.value} <small>{pct}%</small></strong>
                    </div>
                    <div className="dashboard-status-track">
                      <div className={`dashboard-status-fill ${item.tone}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </TableCard>
        </div>

        <div className="dashboard-main-grid">
          <div className="dashboard-left-col">
            <TableCard
              title="Mes dernieres commandes"
              meta={`${todayOrders.length} aujourd'hui`}
              actions={<Link href="/zangochap-manager/orders?scope=mine" className="dashboard-card-link">Tout voir</Link>}
            >
              {myOrders.length === 0 ? (
                <EmptyState icon="OK" title="Aucune commande" description="Creez votre premiere commande." />
              ) : (
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>Ref.</th>
                      <th>Client</th>
                      <th>Articles</th>
                      <th>Total</th>
                      <th>Statut</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myOrders.slice(0, 8).map((order) => (
                      <tr key={order.id}>
                        <td><span className="cell-mono">{order.ref || "-"}</span></td>
                        <td>
                          <div className="cell-strong">{order.customerName || "Client inconnu"}</div>
                          <div className="cell-muted">{order.customerPhone || "Sans telephone"}</div>
                        </td>
                        <td>
                          {order.items.slice(0, 2).map((item) => (
                            <div key={item.id} className="order-item-mini">
                              <span>{item.emoji || ""}</span>
                              <span>{item.name}</span>
                              <span className="size-dot">{item.size}</span>
                              <strong className="order-item-color">{item.color}</strong>
                              <span>x {item.qty}</span>
                            </div>
                          ))}
                          {order.items.length > 2 && <div className="cell-muted">+{order.items.length - 2} autre(s)</div>}
                        </td>
                        <td><span className="cell-price">{formatPrice(Number(order.total || 0))}</span></td>
                        <td><StatusBadge status={order.status} /></td>
                        <td><span className="cell-muted">{formatDate(order.createdAt)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </TableCard>

            <TableCard title="Commandes a suivre" meta={`${followUpOrders.length} dossier(s)`}>
              {followUpOrders.length === 0 ? (
                <EmptyState icon="OK" title="Rien a relancer" description="Aucune commande sensible dans votre pipeline." />
              ) : (
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>Ref.</th>
                      <th>Client</th>
                      <th>Statut</th>
                      <th>Mis a jour</th>
                    </tr>
                  </thead>
                  <tbody>
                    {followUpOrders.slice(0, 6).map((order) => (
                      <tr key={order.id}>
                        <td><span className="cell-mono">{order.ref || "-"}</span></td>
                        <td>
                          <div className="cell-strong">{order.customerName || "Client inconnu"}</div>
                          <div className="cell-muted">{order.customerPhone || "Sans telephone"}</div>
                        </td>
                        <td><StatusBadge status={order.status} /></td>
                        <td><span className="cell-muted">{formatDate(order.updatedAt)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </TableCard>
          </div>

          <div className="dashboard-right-col">
            <TableCard title="Top articles livres" meta="Quantites du mois">
              <div className="dashboard-product-list">
                {topProducts.map((product, index) => (
                  <div key={`${product.name}-${index}`} className="dashboard-product-item">
                    <span className="dashboard-product-rank">{index + 1}</span>
                    <span className="dashboard-product-emoji">{product.emoji}</span>
                    <span className="dashboard-product-info">
                      <strong>{product.name}</strong>
                      <small>{formatPrice(product.revenue)}</small>
                    </span>
                    <b>{product.qty}</b>
                  </div>
                ))}
                {topProducts.length === 0 && (
                  <div className="cell-muted dashboard-empty-data">Aucun article livre ce mois.</div>
                )}
              </div>
            </TableCard>

            <TableCard title="Zones qui vendent" meta="CA livre du mois">
              <div className="commune-list">
                {topCommunes.map((commune) => {
                  const maxRevenue = topCommunes[0]?.revenue || 1;
                  const pct = Math.max(5, Math.round((commune.revenue / maxRevenue) * 100));
                  return (
                    <div key={commune.name} className="commune-item">
                      <div className="commune-info-row">
                        <span className="commune-name">{commune.name}</span>
                        <span className="commune-revenue">{formatPrice(commune.revenue)}</span>
                      </div>
                      <div className="progress-bg">
                        <div className="progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
                {topCommunes.length === 0 && (
                  <div className="cell-muted dashboard-empty-data">Aucune zone livree ce mois.</div>
                )}
              </div>
            </TableCard>

            <TableCard title="Raccourcis" meta="Actions commerciales">
              <div className="commercial-shortcuts">
                <Link href="/zangochap-manager/orders/new" className="commercial-shortcut">
                  <ShoppingBag size={16} />
                  <span>Nouvelle commande</span>
                </Link>
                <Link href="/zangochap-manager/orders/to-process" className="commercial-shortcut">
                  <PhoneCall size={16} />
                  <span>A traiter ({toProcess.length})</span>
                </Link>
                <Link href="/zangochap-manager/orders?scope=mine" className="commercial-shortcut">
                  <ClipboardList size={16} />
                  <span>Mes commandes</span>
                </Link>
              </div>
            </TableCard>
          </div>
        </div>
      </div>
    </div>
  );
}
