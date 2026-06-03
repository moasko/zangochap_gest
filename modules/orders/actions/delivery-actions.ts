"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getSession } from "@/modules/auth/actions";
import { isRole } from "../helpers";

const ASSIGNABLE_DELIVERY_STATUSES = ["CONFIRMED", "PACKED", "ON_DELIVERY", "REPRO_DISPO"] as const;

type DeliveryAssignmentOrder = {
  status: string;
  settlementId: string | null;
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
  return ["PACKED", "REPRO_DISPO"].includes(order.status)
    ? { status: "ON_DELIVERY" as const }
    : {};
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

  const order = await prisma.order.findUnique({ where: { id: orderId } });
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

  await prisma.order.update({
    where: { id: orderId },
    data: {
      deliverymanId: isUnassigning ? null : deliverymanId,
      deliverymanName: isUnassigning ? null : driver?.name,
      ...getAssignmentStatusUpdate(order, isUnassigning),
      history,
    },
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

    return prisma.order.update({
      where: { id: order.id },
      data: {
        deliverymanId: isUnassigning ? null : deliverymanId,
        deliverymanName: isUnassigning ? null : driver?.name,
        ...getAssignmentStatusUpdate(order, isUnassigning),
        history,
      },
    });
  }));

  revalidateDeliveryAssignmentPaths();
  return { success: true };
}
