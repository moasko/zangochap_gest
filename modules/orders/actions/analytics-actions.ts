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
export async function getPerformanceStats(dateFrom?: string, dateTo?: string) {
  await ensureAuth(["admin"]);
  const now = new Date();
  const start = dateFrom ? new Date(dateFrom) : new Date(now.getFullYear(), now.getMonth(), 1);
  const end = dateTo ? new Date(dateTo + 'T23:59:59') : new Date();

  const whereDate: Prisma.DateTimeFilter = { gte: start, lte: end };

  // 1. COMMERCIALS — Based on orders they created
  const commercials = await prisma.user.findMany({
    where: { role: 'COMMERCIAL' },
    select: {
      id: true,
      name: true,
      orders: {
        where: { deletedAt: null, createdAt: whereDate },
        select: { total: true, status: true },
      },
    },
  });
  const commercialsStats = commercials.map(c => {
    const delivered = c.orders.filter(o => o.status === 'DELIVERED');
    const cancelled = c.orders.filter(o => o.status === 'CANCELLED' || o.status === 'RETURNED');
    const revenue = delivered.reduce((sum, o) => sum + o.total, 0);
    const convRate = c.orders.length > 0 ? Math.round((delivered.length / c.orders.length) * 100) : 0;
    return {
      id: c.id,
      name: c.name,
      sales: c.orders.length,
      delivered: delivered.length,
      cancelled: cancelled.length,
      revenue,
      convRate,
      prime: Math.round(revenue * 0.01),
    };
  });

  // 2. PACKING — Based on packedBy field
  const packers = await prisma.user.findMany({
    where: { role: 'PACKING' },
    select: { id: true, name: true, email: true }
  });

  const packingStats = await Promise.all(packers.map(async p => {
    const orders = await prisma.order.findMany({
      where: { deletedAt: null, packedBy: p.email, packedAt: whereDate },
      select: { status: true }
    });
    const partialCount = orders.filter(o => o.status === 'PARTIAL').length;
    const completedCount = orders.length - partialCount;
    const score = orders.length > 0 ? Math.round((completedCount / orders.length) * 100) : 100;
    return {
      id: p.id,
      name: p.name,
      packed: orders.length,
      completed: completedCount,
      partial: partialCount,
      score,
    };
  }));

  // 3. COLLECTION — Based on CollectionRecord
  const collectors = await prisma.user.findMany({
    where: { role: 'COLLECTION' },
    select: { id: true, name: true }
  });

  const collectorStats = await Promise.all(collectors.map(async c => {
    const records = await prisma.collectionRecord.findMany({
      where: { by: c.id, createdAt: whereDate },
      select: { status: true }
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
  }));

  // 4. DELIVERY — Based on deliverymanId
  const deliverymen = await prisma.user.findMany({
    where: { role: 'LIVREUR' },
    select: { id: true, name: true }
  });
  const deliveryStats = await Promise.all(deliverymen.map(async d => {
    const orders = await prisma.order.findMany({
      where: { deletedAt: null, deliverymanId: d.id, createdAt: whereDate },
      select: { status: true, total: true }
    });
    const delivered = orders.filter(o => o.status === 'DELIVERED');
    const returned = orders.filter(o => o.status === 'RETURNED' || o.status === 'CANCELLED');
    const revenue = delivered.reduce((sum, o) => sum + o.total, 0);
    return {
      id: d.id,
      name: d.name,
      total: orders.length,
      delivered: delivered.length,
      returned: returned.length,
      revenue,
      successRate: orders.length > 0 ? Math.round((delivered.length / orders.length) * 100) : 0
    };
  }));

  // Summary Metrics
  const totalDeliverySorties = deliveryStats.reduce((sum, d) => sum + d.total, 0);
  const totalDelivered = deliveryStats.reduce((sum, d) => sum + d.delivered, 0);
  const totalPackedAll = packingStats.reduce((sum, p) => sum + p.packed, 0);
  const totalCollectedAll = collectorStats.reduce((sum, c) => sum + c.count, 0);

  const summary = {
    totalRevenue: commercialsStats.reduce((sum, c) => sum + c.revenue, 0),
    totalOrders: commercialsStats.reduce((sum, c) => sum + c.sales, 0),
    avgOrderValue: totalDelivered > 0
      ? Math.round(commercialsStats.reduce((sum, c) => sum + c.revenue, 0) / totalDelivered)
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
  const start = dateFrom ? new Date(dateFrom) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const end = dateTo ? new Date(dateTo + 'T23:59:59') : new Date();
  const whereDate: Prisma.DateTimeFilter = { gte: start, lte: end };

  if (role === 'COMMERCIAL') {
    const orders = await prisma.order.findMany({
      where: { deletedAt: null, commercialId: userId, createdAt: whereDate },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        ref: true,
        customerName: true,
        total: true,
        status: true,
        createdAt: true,
        commune: true,
      }
    });
    const delivered = orders.filter(o => o.status === 'DELIVERED');
    const revenue = delivered.reduce((sum, o) => sum + o.total, 0);
    return {
      orders,
      summary: {
        total: orders.length,
        delivered: delivered.length,
        revenue,
        convRate: orders.length > 0 ? Math.round((delivered.length / orders.length) * 100) : 0,
      }
    };
  }

  if (role === 'LIVREUR') {
    const orders = await prisma.order.findMany({
      where: { deletedAt: null, deliverymanId: userId, createdAt: whereDate },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        ref: true,
        customerName: true,
        total: true,
        status: true,
        createdAt: true,
        commune: true,
        deliveredAt: true,
      }
    });
    const delivered = orders.filter(o => o.status === 'DELIVERED');
    const returned = orders.filter(o => o.status === 'RETURNED' || o.status === 'CANCELLED');
    return {
      orders,
      summary: {
        total: orders.length,
        delivered: delivered.length,
        returned: returned.length,
        revenue: delivered.reduce((sum, o) => sum + o.total, 0),
        successRate: orders.length > 0 ? Math.round((delivered.length / orders.length) * 100) : 0,
      }
    };
  }

  if (role === 'COLLECTION') {
    const records = await prisma.collectionRecord.findMany({
      where: { by: userId, createdAt: whereDate },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    const collected = records.filter(r => r.status === 'collected').length;
    const unavailable = records.filter(r => r.status === 'unavailable').length;
    return {
      records,
      summary: {
        total: records.length,
        collected,
        unavailable,
        successRate: records.length > 0 ? Math.round((collected / records.length) * 100) : 0,
      }
    };
  }

  if (role === 'PACKING') {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { orders: [], summary: { total: 0, completed: 0, partial: 0, score: 100 } };
    const orders = await prisma.order.findMany({
      where: { deletedAt: null, packedBy: user.email, packedAt: whereDate },
      orderBy: { packedAt: 'desc' },
      take: 50,
      select: {
        ref: true,
        customerName: true,
        status: true,
        packedAt: true,
        createdAt: true,
      }
    });
    const partialCount = orders.filter(o => o.status === 'PARTIAL').length;
    const completedCount = orders.length - partialCount;
    return {
      orders,
      summary: {
        total: orders.length,
        completed: completedCount,
        partial: partialCount,
        score: orders.length > 0 ? Math.round((completedCount / orders.length) * 100) : 100,
      }
    };
  }

  return { data: [] };
}
