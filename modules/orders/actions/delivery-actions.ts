"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { getSession } from "@/modules/auth/actions";
import { isRole } from "../helpers";
import { decrementStockForOrder } from "./stock";

const ASSIGNABLE_DELIVERY_STATUSES = ["PENDING", "CONFIRMED", "PARTIAL", "PREPARING", "PACKED", "ON_DELIVERY", "REPRO_DISPO"] as const;

type DeliveryAssignmentOrder = {
  status: string;
  settlementId: string | null;
};

type DeliveryAssignmentOrderWithItems = DeliveryAssignmentOrder & {
  id: string;
  ref: string | null;
  stockDecremented: boolean;
  items: unknown[];
};

function assertCanManageDeliveryAssignment(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session || !isRole(session, "admin", "developer")) {
    throw new Error("Acces refuse");
  }
}

function assertOrderCanBeAssigned(order: DeliveryAssignmentOrder) {
  if (order.settlementId) {
    throw new Error("Impossible de modifier le livreur d'une commande deja rattachee a un reglement.");
  }

  if (!ASSIGNABLE_DELIVERY_STATUSES.includes(order.status as typeof ASSIGNABLE_DELIVERY_STATUSES[number])) {
    throw new Error("Cette commande n'est pas eligible a l'attribution livraison.");
  }
}

function getAssignmentStatusUpdate(order: DeliveryAssignmentOrder, isUnassigning: boolean) {
  if (isUnassigning) return {};
  return order.status === "ON_DELIVERY" ? {} : { status: "ON_DELIVERY" as const };
}

async function ensureDeliveryStock(order: DeliveryAssignmentOrderWithItems, session: NonNullable<Awaited<ReturnType<typeof getSession>>>, tx: Prisma.TransactionClient) {
  if (order.status === "ON_DELIVERY" || order.stockDecremented) return;
  await decrementStockForOrder(order, session, tx);
}

function revalidateDeliveryAssignmentPaths() {
  revalidatePath("/zangochap-manager/orders");
  revalidatePath("/zangochap-rider");
  revalidatePath("/zangochap-manager/admin/delivery");
  revalidatePath("/zangochap-manager/admin/delivery/settlement");
  revalidatePath("/zangochap-manager/dashboard");
}

// ============ ASSIGN TO DELIVERYMAN ============
export async function assignOrderToDeliveryman(orderId: string, deliverymanId: string) {
  const session = await getSession();
  assertCanManageDeliveryAssignment(session);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) throw new Error("Commande introuvable");

  assertOrderCanBeAssigned(order);

  const isUnassigning = !deliverymanId || deliverymanId === "unassigned";
  let driver = null;

  if (!isUnassigning) {
    driver = await prisma.user.findUnique({ where: { id: deliverymanId } });
    if (!driver) throw new Error("Livreur introuvable");
    if (driver.role !== "LIVREUR") throw new Error("Le compte choisi n'est pas un livreur.");
  }

  const history = Array.isArray(order.history) ? [...order.history] : [];
  history.push({
    at: new Date().toISOString(),
    action: isUnassigning
      ? "Commande desattribuee (remise en attente)"
      : order.status === "REPRO_DISPO"
        ? `Repro-dispo remise en livraison et attribuee a : ${driver?.name}`
        : `Livreur attribue : ${driver?.name}`,
    by: session!.email,
    byName: session!.name,
  });

  await prisma.$transaction(async (tx) => {
    if (!isUnassigning) {
      await ensureDeliveryStock(order, session!, tx);
    }

    await tx.order.update({
      where: { id: orderId },
      data: {
        deliverymanId: isUnassigning ? null : deliverymanId,
        deliverymanName: isUnassigning ? null : driver?.name,
        ...getAssignmentStatusUpdate(order, isUnassigning),
        history,
      },
    });
  });

  revalidateDeliveryAssignmentPaths();
  return { success: true };
}

// ============ BULK ASSIGN ============
export async function bulkAssignOrders(orderIds: string[], deliverymanId: string) {
  const session = await getSession();
  assertCanManageDeliveryAssignment(session);

  if (orderIds.length === 0) throw new Error("Aucune commande selectionnee.");

  const isUnassigning = !deliverymanId || deliverymanId === "unassigned";
  let driver = null;

  if (!isUnassigning) {
    driver = await prisma.user.findUnique({ where: { id: deliverymanId } });
    if (!driver) throw new Error("Livreur introuvable");
    if (driver.role !== "LIVREUR") throw new Error("Le compte choisi n'est pas un livreur.");
  }

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    include: { items: true },
  });

  if (orders.length !== orderIds.length) {
    throw new Error("Certaines commandes sont introuvables.");
  }

  orders.forEach(assertOrderCanBeAssigned);

  await Promise.all(orders.map((order) => {
    const history = Array.isArray(order.history) ? [...order.history] : [];
    history.push({
      at: new Date().toISOString(),
      action: isUnassigning
        ? "Desattribution groupee"
        : order.status === "REPRO_DISPO"
          ? `Repro-dispo remise en livraison et attribuee a : ${driver?.name}`
          : `Attribution groupee au livreur : ${driver?.name}`,
      by: session!.email,
      byName: session!.name,
    });

    return prisma.$transaction(async (tx) => {
      if (!isUnassigning) {
        await ensureDeliveryStock(order, session!, tx);
      }

      return tx.order.update({
        where: { id: order.id },
        data: {
          deliverymanId: isUnassigning ? null : deliverymanId,
          deliverymanName: isUnassigning ? null : driver?.name,
          ...getAssignmentStatusUpdate(order, isUnassigning),
          history,
        },
      });
    });
  }));

  revalidateDeliveryAssignmentPaths();
  return { success: true };
}

// ============ AUTO ASSIGN ============
export async function autoAssignDeliveryOrders(orderIds: string[]) {
  const session = await getSession();
  assertCanManageDeliveryAssignment(session);

  const uniqueIds = Array.from(new Set(orderIds.filter(Boolean)));
  if (uniqueIds.length === 0) throw new Error("Aucune commande eligible a repartir.");

  const [orders, drivers, activeLoads] = await Promise.all([
    prisma.order.findMany({
      where: { id: { in: uniqueIds } },
      orderBy: [{ commune: "asc" }, { updatedAt: "asc" }],
      include: { items: true },
    }),
    prisma.user.findMany({
      where: { role: "LIVREUR" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.order.groupBy({
      by: ["deliverymanId"],
      where: {
        deletedAt: null,
        deliverymanId: { not: null },
        status: { in: [...ASSIGNABLE_DELIVERY_STATUSES] },
      },
      _count: { _all: true },
    }),
  ]);

  if (orders.length !== uniqueIds.length) {
    throw new Error("Certaines commandes sont introuvables.");
  }

  if (drivers.length === 0) {
    throw new Error("Aucun livreur actif disponible pour la repartition.");
  }

  orders.forEach(assertOrderCanBeAssigned);

  const unassignedOrders = orders.filter((order) => !order.deliverymanId);
  if (unassignedOrders.length === 0) {
    return { success: true, assignedCount: 0, skippedCount: orders.length };
  }

  const loads = new Map(drivers.map((driver) => [driver.id, 0]));
  activeLoads.forEach((load) => {
    if (load.deliverymanId) loads.set(load.deliverymanId, load._count._all);
  });

  const communeDriver = new Map<string, string>();

  await Promise.all(unassignedOrders.map((order) => {
    const sortedDrivers = [...drivers].sort((a, b) => {
      const loadDiff = (loads.get(a.id) || 0) - (loads.get(b.id) || 0);
      return loadDiff || a.name.localeCompare(b.name);
    });

    const lightest = sortedDrivers[0];
    const existingDriverId = order.commune ? communeDriver.get(order.commune) : null;
    const existingDriver = existingDriverId ? drivers.find((driver) => driver.id === existingDriverId) : null;
    const selectedDriver = existingDriver && (loads.get(existingDriver.id) || 0) <= (loads.get(lightest.id) || 0) + 2
      ? existingDriver
      : lightest;

    if (order.commune && !communeDriver.has(order.commune)) {
      communeDriver.set(order.commune, selectedDriver.id);
    }

    loads.set(selectedDriver.id, (loads.get(selectedDriver.id) || 0) + 1);

    const history = Array.isArray(order.history) ? [...order.history] : [];
    history.push({
      at: new Date().toISOString(),
      action: `Repartition automatique au livreur : ${selectedDriver.name}`,
      by: session!.email,
      byName: session!.name,
    });

    return prisma.$transaction(async (tx) => {
      await ensureDeliveryStock(order, session!, tx);

      return tx.order.update({
        where: { id: order.id },
        data: {
          deliverymanId: selectedDriver.id,
          deliverymanName: selectedDriver.name,
          ...getAssignmentStatusUpdate(order, false),
          history,
        },
      });
    });
  }));

  revalidateDeliveryAssignmentPaths();
  return {
    success: true,
    assignedCount: unassignedOrders.length,
    skippedCount: orders.length - unassignedOrders.length,
  };
}
