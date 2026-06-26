"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getSession } from "@/modules/auth/actions";
import { ensureAuth } from "@/lib/auth";
import { isRole } from "../helpers";
import type { Prisma } from "@prisma/client";

type SettlementAmountOrder = {
  total: number | null;
  deliveryFee: number | null;
  discount: number | null;
  amountReceived: number | null;
};

function getOrderSettlementAmounts(order: SettlementAmountOrder) {
  const deliveryFee = Math.max(0, Number(order.deliveryFee || 0));
  const expectedProducts = Math.max(0, Number(order.total || 0) - Number(order.discount || 0));
  const expectedAmount = expectedProducts + deliveryFee;
  const collectedAmount = Math.max(0, Number(order.amountReceived ?? expectedAmount));
  const collectedDeliveryFee = Math.min(deliveryFee, collectedAmount);
  const collectedProducts = Math.max(0, collectedAmount - collectedDeliveryFee);

  return {
    amount: collectedAmount,
    productsAmount: collectedProducts,
    deliveryFeesAmount: collectedDeliveryFee,
  };
}

function getOrdersSettlementTotals(orders: SettlementAmountOrder[]) {
  return orders.reduce(
    (totals, order) => {
      const amounts = getOrderSettlementAmounts(order);
      totals.amount += amounts.amount;
      totals.productsAmount += amounts.productsAmount;
      totals.deliveryFeesAmount += amounts.deliveryFeesAmount;
      return totals;
    },
    { amount: 0, productsAmount: 0, deliveryFeesAmount: 0 },
  );
}

function getDateRange(from?: string, to?: string) {
  const range: { gte?: Date; lte?: Date } = {};

  if (from) {
    range.gte = new Date(`${from}T00:00:00`);
  }

  if (to) {
    range.lte = new Date(`${to}T23:59:59.999`);
  }

  return Object.keys(range).length > 0 ? range : undefined;
}

function getDeliveryIssueDateWhere(range?: { gte?: Date; lte?: Date }): Prisma.OrderWhereInput {
  if (!range) return {};
  return {
    OR: [
      { lastDeliveryAttemptAt: range },
      { lastDeliveryAttemptAt: null, deliveryDate: range },
    ],
  };
}

function getDeliveryIssueRiderWhere(riderId?: string): Prisma.OrderWhereInput {
  if (riderId) {
    return {
      OR: [
        { lastDeliveryAttemptRiderId: riderId },
        { lastDeliveryAttemptRiderId: null, deliverymanId: riderId },
      ],
    };
  }

  return {
    OR: [
      { lastDeliveryAttemptRiderId: { not: null } },
      { lastDeliveryAttemptRiderId: null, deliverymanId: { not: null } },
    ],
  };
}

const deliverySettlementOrderSelect = {
  id: true,
  ref: true,
  total: true,
  deliveryFee: true,
  discount: true,
  amountReceived: true,
  paymentMethod: true,
  customerName: true,
  customerPhone: true,
  customerLocation: true,
  commune: true,
  deliveryDate: true,
  deliveredAt: true,
  updatedAt: true,
  deliverymanId: true,
  deliverymanName: true,
  lastDeliveryAttemptAt: true,
  lastDeliveryAttemptRiderId: true,
  lastDeliveryAttemptRiderName: true,
  lastDeliveryAttemptStatus: true,
  lastDeliveryAttemptReason: true,
  settlementId: true,
  status: true,
  returnReason: true,
  isCommercialContacted: true,
} satisfies Prisma.OrderSelect;

type DeliverySettlementOrder = Prisma.OrderGetPayload<{
  select: typeof deliverySettlementOrderSelect;
}>;

function serializeSettlementOrder(order: DeliverySettlementOrder) {
  const amounts = getOrderSettlementAmounts(order);

  return {
    ...order,
    amountToSettle: amounts.amount,
    productsAmount: amounts.productsAmount,
    deliveryFeesAmount: amounts.deliveryFeesAmount,
  };
}

function groupOrdersByRider(orders: ReturnType<typeof serializeSettlementOrder>[]) {
  const riderMap = new Map<string, {
    id: string;
    name: string;
    orders: ReturnType<typeof serializeSettlementOrder>[];
    totalDeliveryFees: number;
    totalProducts: number;
    totalGrandTotal: number;
    cashTotal: number;
    orderCount: number;
  }>();

  orders.forEach((order) => {
    const riderId = String(order.deliverymanId || "unknown");
    const rider = riderMap.get(riderId) || {
      id: riderId,
      name: String(order.deliverymanName || "Livreur inconnu"),
      orders: [],
      totalDeliveryFees: 0,
      totalProducts: 0,
      totalGrandTotal: 0,
      cashTotal: 0,
      orderCount: 0,
    };

    rider.orders.push(order);
    rider.totalDeliveryFees += order.deliveryFeesAmount;
    rider.totalProducts += order.productsAmount;
    rider.totalGrandTotal += order.amountToSettle;
    rider.orderCount += 1;

    if (String(order.paymentMethod || "").toLowerCase().includes("cash")) {
      rider.cashTotal += order.amountToSettle;
    }

    riderMap.set(riderId, rider);
  });

  return Array.from(riderMap.values()).sort((a, b) => b.totalGrandTotal - a.totalGrandTotal);
}

function getIssueRiderId(order: ReturnType<typeof serializeSettlementOrder>) {
  return String(order.lastDeliveryAttemptRiderId || order.deliverymanId || "unknown");
}

function getIssueRiderName(order: ReturnType<typeof serializeSettlementOrder>) {
  return String(order.lastDeliveryAttemptRiderName || order.deliverymanName || "Livreur inconnu");
}

function buildSummary(
  collectableOrders: ReturnType<typeof serializeSettlementOrder>[],
  returnOrders: ReturnType<typeof serializeSettlementOrder>[],
  settlements: {
    amount: number;
    productsAmount: number;
    deliveryFeesAmount: number;
    ordersCount: number;
    deliverymanId: string | null;
  }[],
) {
  return {
    toSettleTotal: collectableOrders.reduce((sum, order) => sum + order.amountToSettle, 0),
    productsTotal: collectableOrders.reduce((sum, order) => sum + order.productsAmount, 0),
    deliveryFeesTotal: collectableOrders.reduce((sum, order) => sum + order.deliveryFeesAmount, 0),
    cashTotal: collectableOrders.reduce((sum, order) => (
      String(order.paymentMethod || "").toLowerCase().includes("cash") ? sum + order.amountToSettle : sum
    ), 0),
    collectableOrdersCount: collectableOrders.length,
    returnOrdersCount: returnOrders.length,
    uncontactedReturnsCount: returnOrders.filter((order) => !order.isCommercialContacted).length,
    historyTotal: settlements.reduce((sum, settlement) => sum + Number(settlement.amount || 0), 0),
    historyOrdersCount: settlements.reduce((sum, settlement) => sum + Number(settlement.ordersCount || 0), 0),
    historyRidersCount: new Set(settlements.map((settlement) => settlement.deliverymanId).filter(Boolean)).size,
  };
}

// ============ PENDING SETTLEMENTS ============
export async function getPendingSettlements() {
  await ensureAuth(["admin"]);
  const orders = await prisma.order.findMany({
    where: {
      status: { in: ['DELIVERED', 'PARTIALLY_DELIVERED'] },
      settlementId: null,
      deliverymanId: { not: null }
    },
    include: {
      items: { select: { name: true, qty: true, price: true } },
    },
    orderBy: { createdAt: 'desc' }
  });
  return orders;
}

// ============ SETTLEMENT HISTORY ============
export async function getSettlementHistory() {
  await ensureAuth(["admin"]);
  const settlements = await prisma.settlement.findMany({
    where: { status: 'COMPLETED' },
    select: {
      id: true,
      deliverymanId: true,
      amount: true,
      productsAmount: true,
      deliveryFeesAmount: true,
      ordersCount: true,
      status: true,
      notes: true,
      by: true,
      createdAt: true,
      deliveryman: { select: { name: true } },
      orders: { select: { id: true, ref: true, customerName: true, total: true, deliveryFee: true, discount: true, amountReceived: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return settlements.map((settlement) => {
    const totals = getOrdersSettlementTotals(settlement.orders);
    return {
      ...settlement,
      amount: totals.amount,
      productsAmount: totals.productsAmount,
      deliveryFeesAmount: totals.deliveryFeesAmount,
    };
  });
}

// ============ CREATE SETTLEMENT ============
export async function createSettlement(deliverymanId: string, orderIds: string[], amount: number, notes?: string) {
  const session = await getSession();
  if (!session || !isRole(session, 'admin')) throw new Error("Accès refusé");

  if (!deliverymanId || orderIds.length === 0) throw new Error("Aucune commande à régler.");

  const orders = await prisma.order.findMany({
    where: {
      id: { in: orderIds },
      deliverymanId,
      settlementId: null,
      status: { in: ['DELIVERED', 'PARTIALLY_DELIVERED'] },
    }
  });
  if (orders.length !== orderIds.length) {
    throw new Error("Certaines commandes sont déjà réglées ou ne sont pas éligibles.");
  }

  const {
    amount: computedAmount,
    productsAmount,
    deliveryFeesAmount,
  } = getOrdersSettlementTotals(orders);

  const settlement = await prisma.settlement.create({
    data: {
      deliverymanId,
      amount: computedAmount,
      productsAmount,
      deliveryFeesAmount,
      ordersCount: orderIds.length,
      notes: notes || (amount !== computedAmount ? `Montant recalculé côté serveur: ${computedAmount}` : undefined),
      by: session.name,
      status: 'COMPLETED',
      orders: {
        connect: orderIds.map(id => ({ id })),
      },
    },
  });

  revalidatePath("/zangochap-manager/admin/delivery");
  revalidatePath("/zangochap-manager/admin/delivery/settlement");
  revalidatePath("/zangochap-manager/admin/settlements");
  return settlement;
}

// ============ SETTLEMENT STATS BY PAYMENT METHOD ============
export async function getSettlementStats(from?: string, to?: string, commercialId?: string, method?: string) {
  const session = await getSession();
  if (session && isRole(session, 'comptable')) {
    // Comptable can inspect payment-method settlements without admin account-management access.
  } else
  if (!session || !isRole(session, 'admin')) throw new Error("Accès refusé");

  const where: Prisma.OrderWhereInput = {
    deletedAt: null,
    paymentMethod: method ? method : { not: null },
  };

  if (commercialId) where.commercialId = commercialId;

  // Parsing en heure locale via le helper partage (coherent avec la comptabilite).
  const deliveryRange = getDateRange(from, to);
  if (deliveryRange) where.deliveryDate = deliveryRange;

  const orders = await prisma.order.findMany({
    where,
    select: {
      id: true,
      ref: true,
      total: true,
      deliveryFee: true,
      discount: true,
      amountReceived: true,
      paymentMethod: true,
      customerName: true,
      createdAt: true,
      commercialName: true,
      status: true,
    },
    orderBy: { createdAt: 'desc' }
  });

  const stats: Record<string, { count: number, total: number }> = {};

  orders.forEach((o) => {
    const method = String(o.paymentMethod || 'Inconnu');
    if (!stats[method]) stats[method] = { count: 0, total: 0 };
    stats[method].count += 1;
    stats[method].total += (Number(o.total || 0) + Number(o.deliveryFee || 0) - Number(o.discount || 0));
  });

  const methods = Object.entries(stats).map(([method, data]) => ({
    method,
    count: data.count,
    total: data.total
  })).sort((a, b) => b.total - a.total);

  return { methods, orders };
}

export async function getDeliverySettlementDashboard(from?: string, to?: string, riderId?: string) {
  const session = await getSession();
  if (!session || !isRole(session, 'admin', 'comptable')) throw new Error("AccÃ¨s refusÃ©");

  const deliveryDateRange = getDateRange(from, to);
  const riderFilter: Prisma.OrderWhereInput = riderId ? { deliverymanId: riderId } : { deliverymanId: { not: null } };
  const issueRiderFilter = getDeliveryIssueRiderWhere(riderId);
  const settlementRiderFilter: Prisma.SettlementWhereInput = riderId ? { deliverymanId: riderId } : {};

  const [collectableRawOrders, returnRawOrders, settlements, deliverymen] = await Promise.all([
    prisma.order.findMany({
      where: {
        deletedAt: null,
        ...riderFilter,
        status: { in: ['DELIVERED', 'PARTIALLY_DELIVERED'] },
        settlementId: null,
        ...(deliveryDateRange ? { deliveryDate: deliveryDateRange } : {}),
      },
      select: deliverySettlementOrderSelect,
      orderBy: [{ deliverymanName: 'asc' }, { updatedAt: 'desc' }],
    }),
    prisma.order.findMany({
      where: {
        deletedAt: null,
        status: { in: ['RETURNED', 'CANCELLED', 'REPRO_DISPO'] },
        AND: [
          issueRiderFilter,
          getDeliveryIssueDateWhere(deliveryDateRange),
        ],
      },
      select: deliverySettlementOrderSelect,
      orderBy: [{ isCommercialContacted: 'asc' }, { updatedAt: 'desc' }],
    }),
    prisma.settlement.findMany({
      where: {
        status: 'COMPLETED',
        ...settlementRiderFilter,
        ...(deliveryDateRange ? { orders: { some: { deliveryDate: deliveryDateRange } } } : {}),
      },
      select: {
        id: true,
        deliverymanId: true,
        amount: true,
        productsAmount: true,
        deliveryFeesAmount: true,
        ordersCount: true,
        status: true,
        notes: true,
        by: true,
        createdAt: true,
        deliveryman: { select: { name: true } },
        orders: {
          ...(deliveryDateRange ? { where: { deliveryDate: deliveryDateRange } } : {}),
          select: {
            id: true,
            ref: true,
            customerName: true,
            status: true,
            total: true,
            deliveryFee: true,
            discount: true,
            amountReceived: true,
            paymentMethod: true,
            deliveryDate: true,
          },
          orderBy: { updatedAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    prisma.user.findMany({
      where: { role: 'LIVREUR' },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const collectableOrders = collectableRawOrders.map(serializeSettlementOrder);
  const returnOrders = returnRawOrders.map(serializeSettlementOrder);
  const riders = groupOrdersByRider(collectableOrders);

  const deliveryDateHistory = settlements.map((settlement) => {
    const totals = getOrdersSettlementTotals(settlement.orders);
    return {
      ...settlement,
      amount: totals.amount,
      productsAmount: totals.productsAmount,
      deliveryFeesAmount: totals.deliveryFeesAmount,
      ordersCount: settlement.orders.length,
    };
  });

  return {
    filters: { from: from || "", to: to || "", riderId: riderId || "" },
    riderOptions: deliverymen,
    collectable: {
      riders,
      orders: collectableOrders,
    },
    returns: {
      orders: returnOrders,
      byRider: Object.values(returnOrders.reduce<Record<string, {
        id: string;
        name: string;
        orders: typeof returnOrders;
        uncontactedCount: number;
      }>>((acc, order) => {
        const id = getIssueRiderId(order);
        if (!acc[id]) {
          acc[id] = {
            id,
            name: getIssueRiderName(order),
            orders: [],
            uncontactedCount: 0,
          };
        }
        acc[id].orders.push(order);
        if (!order.isCommercialContacted) acc[id].uncontactedCount += 1;
        return acc;
      }, {})).sort((a, b) => b.uncontactedCount - a.uncontactedCount || a.name.localeCompare(b.name)),
    },
    history: deliveryDateHistory,
    summary: buildSummary(collectableOrders, returnOrders, deliveryDateHistory),
  };
}

// ============ RIDER SETTLEMENT STATS ============
export async function getRiderSettlementStats(from?: string, to?: string, riderId?: string) {
  const session = await getSession();
  if (!session || !isRole(session, 'admin')) throw new Error("Accès refusé");

  const where: Prisma.OrderWhereInput = { deletedAt: null };
  where.OR = [
    {
      ...(riderId ? { deliverymanId: riderId } : { deliverymanId: { not: null } }),
      status: { in: ['DELIVERED', 'PARTIALLY_DELIVERED'] },
      settlementId: null,
    },
    {
      ...getDeliveryIssueRiderWhere(riderId),
      status: { in: ['RETURNED', 'CANCELLED', 'REPRO_DISPO'] },
    },
  ];

  if (from || to) {
    const deliveryDateRange = getDateRange(from, to);
    where.AND = [
      {
        OR: [
          { status: { in: ['DELIVERED', 'PARTIALLY_DELIVERED'] }, deliveryDate: deliveryDateRange },
          { status: { in: ['RETURNED', 'CANCELLED', 'REPRO_DISPO'] }, ...getDeliveryIssueDateWhere(deliveryDateRange) },
        ],
      },
    ];
  }

  const orders = await prisma.order.findMany({
    where,
    select: {
      id: true,
      ref: true,
      total: true,
      deliveryFee: true,
      discount: true,
      amountReceived: true,
      paymentMethod: true,
      customerName: true,
      updatedAt: true,
      deliverymanId: true,
      deliverymanName: true,
      lastDeliveryAttemptAt: true,
      lastDeliveryAttemptRiderId: true,
      lastDeliveryAttemptRiderName: true,
      lastDeliveryAttemptStatus: true,
      lastDeliveryAttemptReason: true,
      settlementId: true,
      status: true,
      returnReason: true,
      isCommercialContacted: true,
    },
    orderBy: { updatedAt: 'desc' }
  });

  type RiderSettlementOrder = (typeof orders)[number];

  const riderMap: Record<string, {
    id: string,
    name: string,
    orders: RiderSettlementOrder[],
    totalDeliveryFees: number,
    totalProducts: number,
    totalGrandTotal: number,
    totalCashToCollect: number,
    returnedCount: number
  }> = {};

  orders.forEach((o) => {
    const isIssue = ['RETURNED', 'CANCELLED', 'REPRO_DISPO'].includes(o.status);
    const rId = isIssue ? String(o.lastDeliveryAttemptRiderId || o.deliverymanId || 'unknown') : String(o.deliverymanId || 'unknown');
    if (!riderMap[rId]) {
      riderMap[rId] = {
        id: rId,
        name: isIssue ? String(o.lastDeliveryAttemptRiderName || o.deliverymanName || 'Inconnu') : String(o.deliverymanName || 'Inconnu'),
        orders: [],
        totalDeliveryFees: 0,
        totalProducts: 0,
        totalGrandTotal: 0,
        totalCashToCollect: 0,
        returnedCount: 0
      };
    }

    const rider = riderMap[rId];
    rider.orders.push(o);

    if (['DELIVERED', 'PARTIALLY_DELIVERED'].includes(o.status)) {
      const {
        amount: collectedTotal,
        productsAmount,
        deliveryFeesAmount,
      } = getOrderSettlementAmounts(o);

      rider.totalProducts += productsAmount;
      rider.totalDeliveryFees += deliveryFeesAmount;
      rider.totalGrandTotal += collectedTotal;

      if (o.paymentMethod?.toLowerCase().includes('cash')) {
        rider.totalCashToCollect += collectedTotal;
      }
    } else if (['RETURNED', 'CANCELLED', 'REPRO_DISPO'].includes(o.status)) {
      rider.returnedCount += 1;
    }
  });

  const riders = Object.values(riderMap).sort((a, b) => b.totalGrandTotal - a.totalGrandTotal);

  return { riders, orders };
}

// ============ TOGGLE COMMERCIAL CONTACTED ============
export async function toggleCommercialContacted(orderId: string, value: boolean) {
  const session = await getSession();
  if (!session || !isRole(session, 'admin', 'commercial')) {
    throw new Error("Accès refusé");
  }

  await prisma.order.update({
    where: { id: orderId },
    data: { isCommercialContacted: value }
  });

  revalidatePath("/zangochap-manager/admin/settlements");
  revalidatePath("/zangochap-rider");
  return { success: true };
}
