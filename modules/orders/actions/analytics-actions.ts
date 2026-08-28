"use server";

import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";
import { OrderStatus, type Prisma } from "@prisma/client";
import {
  emptySidebarCounts,
  getSidebarCountsForUser,
  type SidebarCountsUser,
} from "@/modules/orders/actions/sidebar-counts";
import { shouldShowInCollectionQueue } from "@/modules/logistics/collection/helpers";

// ============ SIDEBAR COUNTS ============
export async function getSidebarCounts(user?: SidebarCountsUser | string) {
  try {
    return getSidebarCountsForUser(typeof user === "string" ? { id: user } : user);
  } catch {
    return emptySidebarCounts;
  }
}

// ============ DASHBOARD STATS ============
export async function getDashboardStats() {
  const session = await ensureAuth();
  if (!['admin', 'commercial', 'stock', 'packing', 'collection', 'developer'].includes(session.role.toLowerCase())) {
    throw new Error("Accès au tableau de bord restreint.");
  }
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sevenDaysStart = new Date(todayStart);
  sevenDaysStart.setDate(sevenDaysStart.getDate() - 6);
  const previousSevenDaysStart = new Date(sevenDaysStart);
  previousSevenDaysStart.setDate(previousSevenDaysStart.getDate() - 7);
  const publicToProcessWhere = {
    deletedAt: null,
    status: OrderStatus.TO_PROCESS,
    commercialId: null,
    commercialName: 'Site Web',
  };

  // 1. Core Counts
  const [todayOrders, monthOrders, productsCount, toProcessCount, packingQueueCount, readyUnassignedCount] = await Promise.all([
    prisma.order.count({ where: { deletedAt: null, status: { not: OrderStatus.TO_PROCESS }, createdAt: { gte: todayStart } } }),
    prisma.order.count({ where: { deletedAt: null, status: { not: OrderStatus.TO_PROCESS }, createdAt: { gte: monthStart } } }),
    prisma.product.count(),
    prisma.order.count({ where: publicToProcessWhere }),
    prisma.order.count({ where: { deletedAt: null, status: OrderStatus.CONFIRMED } }),
    prisma.order.count({
      where: {
        deletedAt: null,
        deliverymanId: null,
        status: { in: [OrderStatus.PACKED, OrderStatus.REPRO_DISPO] },
      },
    }),
  ]);

  // 2. Revenue (Delivered only)
  const deliveredOrders = await prisma.order.findMany({
    where: { deletedAt: null, status: 'DELIVERED' },
    select: { id: true, total: true, createdAt: true, deliveryDate: true, commune: true, commercialName: true, items: true }
  });

  const totalRevenue = deliveredOrders.reduce((sum, o) => sum + o.total, 0);
  const todayRevenue = deliveredOrders
    .filter(o => new Date(o.deliveryDate || o.createdAt) >= todayStart)
    .reduce((sum, o) => sum + o.total, 0);

  const dashboardPeriodOrders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      status: { not: OrderStatus.TO_PROCESS },
      createdAt: { gte: previousSevenDaysStart < monthStart ? previousSevenDaysStart : monthStart },
    },
    select: {
      id: true,
      status: true,
      type: true,
      total: true,
      createdAt: true,
    },
  });
  const monthSnapshotOrders = dashboardPeriodOrders.filter(order => order.createdAt >= monthStart);
  const deliveryOutcomeStatuses: OrderStatus[] = [
    OrderStatus.DELIVERED,
    OrderStatus.PARTIALLY_DELIVERED,
    OrderStatus.RETURNED,
    OrderStatus.CANCELLED,
    OrderStatus.REPRO_DISPO,
  ];
  const successfulDeliveryStatuses: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.PARTIALLY_DELIVERED];
  const deliveryOutcomes = monthSnapshotOrders.filter(order => deliveryOutcomeStatuses.includes(order.status));
  const successfulDeliveries = deliveryOutcomes.filter(order => successfulDeliveryStatuses.includes(order.status));
  const deliverySuccessRate = deliveryOutcomes.length > 0
    ? Math.round((successfulDeliveries.length / deliveryOutcomes.length) * 100)
    : 0;
  const reproDispoCount = monthSnapshotOrders.filter(order => order.status === OrderStatus.REPRO_DISPO).length;
  const reprogrammedCount = monthSnapshotOrders.filter(order => order.type === 'Reprogrammé').length;
  const deliveredThisMonth = monthSnapshotOrders.filter(order => order.status === OrderStatus.DELIVERED);
  const monthRevenue = deliveredThisMonth.reduce((sum, order) => sum + order.total, 0);
  const averageOrderValue = deliveredThisMonth.length > 0
    ? Math.round(monthRevenue / deliveredThisMonth.length)
    : 0;
  const statusBreakdown = [
    { label: 'Livrées', value: monthSnapshotOrders.filter(order => order.status === OrderStatus.DELIVERED).length, tone: 'green' },
    { label: 'En cours', value: monthSnapshotOrders.filter(order => ([OrderStatus.CONFIRMED, OrderStatus.PREPARING, OrderStatus.PACKED, OrderStatus.ON_DELIVERY] as OrderStatus[]).includes(order.status)).length, tone: 'blue' },
    { label: 'Repro-dispo', value: reproDispoCount, tone: 'amber' },
    { label: 'Retours / annulations', value: monthSnapshotOrders.filter(order => ([OrderStatus.RETURNED, OrderStatus.CANCELLED] as OrderStatus[]).includes(order.status)).length, tone: 'red' },
  ];

  const trendDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sevenDaysStart);
    date.setDate(date.getDate() + index);
    const key = date.toISOString().split('T')[0];
    return {
      key,
      label: new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(date).replace('.', ''),
      dateLabel: new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' }).format(date),
      orders: 0,
      revenue: 0,
    };
  });
  const trendByDay = new Map(trendDays.map(day => [day.key, day]));
  dashboardPeriodOrders.forEach(order => {
    if (order.createdAt < sevenDaysStart) return;
    const day = trendByDay.get(order.createdAt.toISOString().split('T')[0]);
    if (day) day.orders += 1;
  });
  const currentSevenDaysOrders = dashboardPeriodOrders.filter(order => order.createdAt >= sevenDaysStart).length;
  const previousSevenDaysOrders = dashboardPeriodOrders.filter(order => (
    order.createdAt >= previousSevenDaysStart && order.createdAt < sevenDaysStart
  )).length;
  const sevenDayAverage = Math.round((currentSevenDaysOrders / 7) * 10) / 10;
  const sevenDayEvolution = previousSevenDaysOrders > 0
    ? Math.round(((currentSevenDaysOrders - previousSevenDaysOrders) / previousSevenDaysOrders) * 100)
    : currentSevenDaysOrders > 0 ? 100 : 0;
  deliveredOrders.forEach(order => {
    const deliveryDate = new Date(order.deliveryDate || order.createdAt);
    if (deliveryDate < sevenDaysStart) return;
    const day = trendByDay.get(deliveryDate.toISOString().split('T')[0]);
    if (day) day.revenue += order.total;
  });

  const topProductMap = new Map<string, { name: string; emoji: string; quantity: number; revenue: number }>();
  deliveredOrders
    .filter(order => new Date(order.deliveryDate || order.createdAt) >= monthStart)
    .forEach(order => {
      order.items.forEach(item => {
        const key = item.productId || item.name;
        const current = topProductMap.get(key) || {
          name: item.name,
          emoji: item.emoji || 'P',
          quantity: 0,
          revenue: 0,
        };
        current.quantity += item.qty;
        current.revenue += item.price * item.qty;
        topProductMap.set(key, current);
      });
    });
  const topProducts = Array.from(topProductMap.values())
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue)
    .slice(0, 5);

  // 3. Top Communes
  const communeMap: Record<string, number> = {};
  deliveredOrders.forEach(o => {
    if (o.commune) communeMap[o.commune] = (communeMap[o.commune] || 0) + o.total;
  });
  const topCommunes = Object.entries(communeMap)
    .map(([name, revenue]) => ({ name, revenue }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // 4. Commercial Leaderboard
  const commercialMap: Record<string, { revenue: number; count: number }> = {};
  deliveredOrders.forEach(o => {
    const name = o.commercialName || 'Web';
    if (!commercialMap[name]) commercialMap[name] = { revenue: 0, count: 0 };
    commercialMap[name].revenue += o.total;
    commercialMap[name].count += 1;
  });
  const leaderboard = Object.entries(commercialMap)
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

  // 5. Recent Activity
  const recentOrders = await prisma.order.findMany({
    where: { deletedAt: null, status: { not: OrderStatus.TO_PROCESS } },
    orderBy: { createdAt: 'desc' },
    take: 8,
    include: { items: true }
  });

  // 6. Conversions & Trends
  const allOrdersCount = await prisma.order.count({ where: { deletedAt: null } });
  const conversionRate = allOrdersCount > 0 ? Math.round((deliveredOrders.length / allOrdersCount) * 100) : 0;

  const outOfStockCount = await prisma.product.count({
    where: {
      variants: {
        none: {
          stock: { gt: 0 }
        }
      }
    }
  });

  const activeOrders = await prisma.order.findMany({
    where: {
      deletedAt: null,
      status: { in: [OrderStatus.CONFIRMED, OrderStatus.PENDING, OrderStatus.PARTIAL] },
    },
    include: { items: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  const productIds = Array.from(
    new Set(activeOrders.flatMap(order => order.items.map(item => item.productId)).filter(Boolean)),
  ) as string[];

  const productsForCollection = productIds.length
    ? await prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { variants: true },
    })
    : [];
  const productMap = new Map(productsForCollection.map(product => [product.id, product]));

  const collectionQueueCount = activeOrders.reduce((count, order) => {
    return count + order.items.filter(item => {
      if (!item.productId) return true;
      const product = productMap.get(item.productId);
      if (!product) return false;
      return shouldShowInCollectionQueue(order, item, product);
    }).length;
  }, 0);

  return {
    todayOrders,
    todayRevenue,
    totalRevenue,
    monthRevenue,
    averageOrderValue,
    conversionRate,
    deliverySuccessRate,
    reproDispoCount,
    reprogrammedCount,
    readyUnassignedCount,
    outOfStockCount,
    toProcessCount,
    packingQueueCount,
    collectionQueueCount,
    topCommunes,
    leaderboard,
    sevenDayTrend: trendDays,
    sevenDayAverage,
    sevenDayEvolution,
    statusBreakdown,
    topProducts,
    recentOrders,
    monthOrders,
    productsCount
  };
}

// ============ PERFORMANCE STATS ============
const PERFORMANCE_SUCCESS_STATUSES: OrderStatus[] = [OrderStatus.DELIVERED, OrderStatus.PARTIALLY_DELIVERED];
const PERFORMANCE_FAILURE_STATUSES: OrderStatus[] = [OrderStatus.RETURNED, OrderStatus.CANCELLED];

function getPerformanceRange(dateFrom?: string, dateTo?: string) {
  const now = new Date();
  const start = dateFrom
    ? new Date(`${dateFrom}T00:00:00`)
    : new Date(0);
  const endExclusive = dateTo
    ? new Date(`${dateTo}T00:00:00`)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (dateTo) endExclusive.setDate(endExclusive.getDate() + 1);
  if (Number.isNaN(start.getTime()) || Number.isNaN(endExclusive.getTime()) || start >= endExclusive) {
    throw new Error("Periode de performance invalide.");
  }
  return {
    start,
    endExclusive,
    dateFilter: { gte: start, lt: endExclusive } satisfies Prisma.DateTimeFilter,
  };
}

function collectedRevenue(order: { amountReceived: number | null; total: number; deliveryFee: number; discount: number }) {
  return Math.max(0, Number(order.amountReceived ?? (order.total + order.deliveryFee - order.discount)));
}

function deliveryPerformanceDate(order: { deliveredAt: string | null; updatedAt: Date }) {
  const deliveredAt = order.deliveredAt ? new Date(order.deliveredAt) : null;
  return deliveredAt && !Number.isNaN(deliveredAt.getTime()) ? deliveredAt : order.updatedAt;
}

function wasPackedPartially(order: { status: OrderStatus; history: Prisma.JsonValue | null }) {
  if (order.status === OrderStatus.PARTIAL) return true;
  if (!Array.isArray(order.history)) return false;
  return order.history.some((entry) => {
    if (!entry || typeof entry !== "object" || !("action" in entry)) return false;
    return String(entry.action).toLowerCase().includes("emballage partiel");
  });
}

function interventionActorEmail(order: { history: Prisma.JsonValue | null; commercialContactedAt: Date | null }) {
  if (!Array.isArray(order.history)) return null;
  const contactTime = order.commercialContactedAt?.getTime() ?? Number.POSITIVE_INFINITY;
  const candidates = order.history
    .filter((entry): entry is Prisma.JsonObject => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)))
    .filter((entry) => {
      const action = String(entry.action || "").toLowerCase();
      const at = new Date(String(entry.at || "")).getTime();
      return (action.startsWith("retour call center:") || action.startsWith("colis accepte apres intervention commerciale:"))
        && Number.isFinite(at)
        && at <= contactTime + 5000;
    })
    .sort((a, b) => new Date(String(b.at)).getTime() - new Date(String(a.at)).getTime());
  const email = String(candidates[0]?.by || "").trim().toLowerCase();
  return email.includes("@") ? email : null;
}

export async function getPerformanceStats(dateFrom?: string, dateTo?: string) {
  await ensureAuth(["admin"]);
  const { start, endExclusive, dateFilter } = getPerformanceRange(dateFrom, dateTo);
  const startIso = start.toISOString();
  const endIso = endExclusive.toISOString();

  const [commercials, packers, collectors, deliverymen, createdOrders, deliveredOrders, interventionOrders, packedOrders, collectionRecords, successfulDeliveries, failedAttempts, legacyFailures] = await Promise.all([
    prisma.user.findMany({ where: { role: 'COMMERCIAL' }, select: { id: true, name: true, email: true } }),
    prisma.user.findMany({ where: { role: 'PACKING' }, select: { id: true, name: true, email: true } }),
    prisma.user.findMany({ where: { role: 'COLLECTION' }, select: { id: true, name: true, email: true } }),
    prisma.user.findMany({ where: { role: 'LIVREUR' }, select: { id: true, name: true } }),
    prisma.order.findMany({
      where: { deletedAt: null, createdAt: dateFilter },
      select: { commercialId: true, status: true },
    }),
    prisma.order.findMany({
      where: {
        deletedAt: null,
        status: { in: PERFORMANCE_SUCCESS_STATUSES },
        OR: [
          { deliveredAt: { gte: startIso, lt: endIso } },
          { deliveredAt: null, updatedAt: dateFilter },
        ],
      },
      select: { commercialId: true, amountReceived: true, total: true, deliveryFee: true, discount: true },
    }),
    prisma.order.findMany({
      where: {
        deletedAt: null,
        isCommercialContacted: true,
        commercialContactedAt: dateFilter,
        commercialContactedByName: { not: null },
      },
      select: { commercialContactedByName: true, commercialContactedAt: true, history: true, status: true },
    }),
    prisma.order.findMany({
      where: { deletedAt: null, packedBy: { not: null }, packedAt: dateFilter },
      select: { packedBy: true, status: true, history: true },
    }),
    prisma.collectionRecord.findMany({
      where: { createdAt: dateFilter },
      select: { by: true, status: true },
    }),
    prisma.order.findMany({
      where: {
        deletedAt: null,
        deliverymanId: { not: null },
        status: { in: PERFORMANCE_SUCCESS_STATUSES },
        OR: [
          { deliveredAt: { gte: startIso, lt: endIso } },
          { deliveredAt: null, updatedAt: dateFilter },
        ],
      },
      select: { deliverymanId: true, amountReceived: true, total: true, deliveryFee: true, discount: true },
    }),
    prisma.order.findMany({
      where: { deletedAt: null, lastDeliveryAttemptRiderId: { not: null }, lastDeliveryAttemptAt: dateFilter },
      select: { lastDeliveryAttemptRiderId: true, lastDeliveryAttemptStatus: true },
    }),
    prisma.order.findMany({
      where: {
        deletedAt: null,
        deliverymanId: { not: null },
        status: { in: PERFORMANCE_FAILURE_STATUSES },
        lastDeliveryAttemptAt: null,
        updatedAt: dateFilter,
      },
      select: { deliverymanId: true, status: true },
    }),
  ]);

  const interventionsByActor = new Map<string, { total: number; delivered: number }>();
  for (const order of interventionOrders) {
    const key = interventionActorEmail(order) || `name:${String(order.commercialContactedByName).trim().toLowerCase()}`;
    const entry = interventionsByActor.get(key) || { total: 0, delivered: 0 };
    entry.total += 1;
    if (PERFORMANCE_SUCCESS_STATUSES.includes(order.status)) entry.delivered += 1;
    interventionsByActor.set(key, entry);
  }

  const commercialsStats = commercials.map(c => {
    const cohort = createdOrders.filter(o => o.commercialId === c.id);
    const delivered = cohort.filter(o => PERFORMANCE_SUCCESS_STATUSES.includes(o.status));
    const cancelled = cohort.filter(o => PERFORMANCE_FAILURE_STATUSES.includes(o.status));
    const revenue = deliveredOrders
      .filter(o => o.commercialId === c.id)
      .reduce((sum, o) => sum + collectedRevenue(o), 0);
    const convRate = cohort.length > 0 ? Math.round((delivered.length / cohort.length) * 100) : 0;
    const interventions = interventionsByActor.get(c.email.toLowerCase())
      || interventionsByActor.get(`name:${String(c.name || '').trim().toLowerCase()}`)
      || { total: 0, delivered: 0 };
    return {
      id: c.id,
      name: c.name,
      sales: cohort.length,
      delivered: delivered.length,
      cancelled: cancelled.length,
      revenue,
      convRate,
      prime: Math.round(revenue * 0.01),
      interventions: interventions.total,
      interventionsDelivered: interventions.delivered,
    };
  });

  const packingStats = packers.map(p => {
    const orders = packedOrders.filter(o => o.packedBy?.toLowerCase() === p.email.toLowerCase());
    const partialCount = orders.filter(wasPackedPartially).length;
    const completedCount = orders.length - partialCount;
    const score = orders.length > 0 ? Math.round((completedCount / orders.length) * 100) : 0;
    return {
      id: p.id,
      name: p.name,
      packed: orders.length,
      completed: completedCount,
      partial: partialCount,
      score,
    };
  });

  const collectorStats = collectors.map(c => {
    const records = collectionRecords.filter(r => {
      const actor = r.by.toLowerCase();
      return actor === c.email.toLowerCase() || actor === c.id.toLowerCase();
    });
    const collected = records.filter(r => r.status === 'collected').length;
    const unavailable = records.filter(r => r.status === 'unavailable').length;
    const alternative = records.filter(r => r.status === 'alternative').length;
    const successRate = records.length > 0 ? Math.round((collected / records.length) * 100) : 0;
    return {
      id: c.id,
      name: c.name,
      count: records.length,
      collected,
      unavailable,
      alternative,
      successRate,
    };
  });

  const deliveryStats = deliverymen.map(d => {
    const delivered = successfulDeliveries.filter(o => o.deliverymanId === d.id);
    const recentFailures = failedAttempts.filter(o =>
      o.lastDeliveryAttemptRiderId === d.id &&
      PERFORMANCE_FAILURE_STATUSES.includes(o.lastDeliveryAttemptStatus as OrderStatus)
    );
    const oldFailures = legacyFailures.filter(o => o.deliverymanId === d.id);
    const returned = recentFailures.length + oldFailures.length;
    const total = delivered.length + returned;
    const revenue = delivered.reduce((sum, o) => sum + collectedRevenue(o), 0);
    return {
      id: d.id,
      name: d.name,
      total,
      delivered: delivered.length,
      returned,
      revenue,
      successRate: total > 0 ? Math.round((delivered.length / total) * 100) : 0
    };
  });

  // Summary Metrics
  const totalDeliverySorties = deliveryStats.reduce((sum, d) => sum + d.total, 0);
  const totalDelivered = deliveryStats.reduce((sum, d) => sum + d.delivered, 0);
  const totalDeliveredOrders = deliveredOrders.length;
  const totalPackedAll = packingStats.reduce((sum, p) => sum + p.packed, 0);
  const totalCollectedAll = collectorStats.reduce((sum, c) => sum + c.collected, 0);
  const totalRevenue = deliveredOrders.reduce((sum, order) => sum + collectedRevenue(order), 0);

  const summary = {
    totalRevenue,
    totalOrders: createdOrders.length,
    avgOrderValue: totalDeliveredOrders > 0
      ? Math.round(totalRevenue / totalDeliveredOrders)
      : 0,
    globalSuccessRate: totalDeliverySorties > 0
      ? Math.round((totalDelivered / totalDeliverySorties) * 100)
      : 0,
    totalPacked: totalPackedAll,
    totalCollected: totalCollectedAll,
  };

  return { commercialsStats, packingStats, collectorStats, deliveryStats, summary };
}

// ============ USER PERFORMANCE DETAILS ============
export async function getUserPerformanceDetails(userId: string, role: string, dateFrom?: string, dateTo?: string) {
  await ensureAuth(["admin"]);
  const { start, endExclusive, dateFilter } = getPerformanceRange(dateFrom, dateTo);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, role: true } });
  if (!user || user.role !== role) throw new Error("Collaborateur introuvable pour ce service.");

  if (role === 'COMMERCIAL') {
    const orders = await prisma.order.findMany({
      where: { deletedAt: null, commercialId: userId, createdAt: dateFilter },
      orderBy: { createdAt: 'desc' },
      select: {
        ref: true,
        customerName: true,
        total: true,
        status: true,
        createdAt: true,
        commune: true,
      }
    });
    const delivered = orders.filter(o => PERFORMANCE_SUCCESS_STATUSES.includes(o.status));
    const deliveredInPeriod = await prisma.order.findMany({
      where: {
        deletedAt: null,
        commercialId: userId,
        status: { in: PERFORMANCE_SUCCESS_STATUSES },
        OR: [
          { deliveredAt: { gte: start.toISOString(), lt: endExclusive.toISOString() } },
          { deliveredAt: null, updatedAt: dateFilter },
        ],
      },
      select: { amountReceived: true, total: true, deliveryFee: true, discount: true },
    });
    const revenue = deliveredInPeriod.reduce((sum, o) => sum + collectedRevenue(o), 0);

    // Interventions sur alerte livreur, attribuees par commercialContactedByName.
    const allInterventionOrders = user.name
      ? await prisma.order.findMany({
        where: {
          deletedAt: null,
          isCommercialContacted: true,
          commercialContactedAt: dateFilter,
        },
        select: { commercialContactedByName: true, commercialContactedAt: true, history: true, status: true },
      })
      : [];
    const interventionOrders = allInterventionOrders.filter(order => {
      const actorEmail = interventionActorEmail(order);
      return actorEmail
        ? actorEmail === user.email.toLowerCase()
        : String(order.commercialContactedByName || '').trim().toLowerCase() === user.name.trim().toLowerCase();
    });

    return {
      orders: orders.slice(0, 50),
      summary: {
        total: orders.length,
        delivered: delivered.length,
        revenue,
        convRate: orders.length > 0 ? Math.round((delivered.length / orders.length) * 100) : 0,
        interventions: interventionOrders.length,
        interventionsDelivered: interventionOrders.filter(o => PERFORMANCE_SUCCESS_STATUSES.includes(o.status)).length,
      }
    };
  }

  if (role === 'LIVREUR') {
    const successful = await prisma.order.findMany({
      where: {
        deletedAt: null,
        deliverymanId: userId,
        status: { in: PERFORMANCE_SUCCESS_STATUSES },
        OR: [
          { deliveredAt: { gte: start.toISOString(), lt: endExclusive.toISOString() } },
          { deliveredAt: null, updatedAt: dateFilter },
        ],
      },
      select: {
        ref: true,
        customerName: true,
        total: true,
        status: true,
        createdAt: true,
        commune: true,
        deliveredAt: true,
        updatedAt: true,
        amountReceived: true,
        deliveryFee: true,
        discount: true,
      }
    });
    const attempts = await prisma.order.findMany({
      where: { deletedAt: null, lastDeliveryAttemptRiderId: userId, lastDeliveryAttemptAt: dateFilter },
      select: { ref: true, customerName: true, total: true, status: true, createdAt: true, commune: true, lastDeliveryAttemptAt: true, lastDeliveryAttemptStatus: true },
    });
    const failures = attempts.filter(o => PERFORMANCE_FAILURE_STATUSES.includes(o.lastDeliveryAttemptStatus as OrderStatus));
    const legacyFailures = await prisma.order.findMany({
      where: { deletedAt: null, deliverymanId: userId, status: { in: PERFORMANCE_FAILURE_STATUSES }, lastDeliveryAttemptAt: null, updatedAt: dateFilter },
      select: { ref: true, customerName: true, total: true, status: true, createdAt: true, commune: true, updatedAt: true },
    });
    const detailOrders = [
      ...successful.map(o => ({ ...o, performanceAt: deliveryPerformanceDate(o) })),
      ...failures.map(o => ({ ...o, status: o.lastDeliveryAttemptStatus || o.status, performanceAt: o.lastDeliveryAttemptAt })),
      ...legacyFailures.map(o => ({ ...o, performanceAt: o.updatedAt })),
    ].sort((a, b) => new Date(b.performanceAt || b.createdAt).getTime() - new Date(a.performanceAt || a.createdAt).getTime());
    const returned = failures.length + legacyFailures.length;
    const total = successful.length + returned;
    return {
      orders: detailOrders.slice(0, 50),
      summary: {
        total,
        delivered: successful.length,
        returned,
        revenue: successful.reduce((sum, o) => sum + collectedRevenue(o), 0),
        successRate: total > 0 ? Math.round((successful.length / total) * 100) : 0,
      }
    };
  }

  if (role === 'COLLECTION') {
    const records = await prisma.collectionRecord.findMany({
      where: { by: { in: [user.email, user.id] }, createdAt: dateFilter },
      orderBy: { createdAt: 'desc' },
    });
    const collected = records.filter(r => r.status === 'collected').length;
    const unavailable = records.filter(r => r.status === 'unavailable').length;
    return {
      records: records.slice(0, 50),
      summary: {
        total: records.length,
        collected,
        unavailable,
        successRate: records.length > 0 ? Math.round((collected / records.length) * 100) : 0,
      }
    };
  }

  if (role === 'PACKING') {
    const orders = await prisma.order.findMany({
      where: { deletedAt: null, packedBy: user.email, packedAt: dateFilter },
      orderBy: { packedAt: 'desc' },
      select: {
        ref: true,
        customerName: true,
        status: true,
        packedAt: true,
        createdAt: true,
        history: true,
      }
    });
    const partialCount = orders.filter(wasPackedPartially).length;
    const completedCount = orders.length - partialCount;
    return {
      orders: orders.slice(0, 50),
      summary: {
        total: orders.length,
        completed: completedCount,
        partial: partialCount,
        score: orders.length > 0 ? Math.round((completedCount / orders.length) * 100) : 0,
      }
    };
  }

  return { data: [] };
}
