"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getSession } from "@/modules/auth/actions";
import { checkOrderAccess, isRole } from "../helpers";

// ============ ASSIGN TO DELIVERYMAN ============
export async function assignOrderToDeliveryman(orderId: string, deliverymanId: string) {
  const session = await getSession();
  if (!session) throw new Error("Non authentifié");

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("Commande introuvable");

  if (!checkOrderAccess(order, session)) {
    throw new Error("Accès refusé");
  }

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
      ? "Commande désattribuée (remise en attente)"
      : order.status === "REPRO_DISPO"
        ? `Repro-dispo remise en livraison et attribuée à : ${driver?.name}`
        : `Livreur attribué : ${driver?.name}`,
    by: session.email,
    byName: session.name,
  });

  await prisma.order.update({
    where: { id: orderId },
    data: {
      deliverymanId: isUnassigning ? null : deliverymanId,
      deliverymanName: isUnassigning ? null : driver?.name,
      ...(!isUnassigning && order.status === "REPRO_DISPO" ? { status: "ON_DELIVERY" as const } : {}),
      history,
    },
  });

  revalidatePath("/zangochap-manager/orders");
  revalidatePath("/zangochap-rider");
  revalidatePath("/zangochap-manager/admin/delivery");
  revalidatePath("/zangochap-manager/admin/delivery/settlement");
  revalidatePath("/zangochap-manager/dashboard");
  return { success: true };
}

// ============ BULK ASSIGN ============
export async function bulkAssignOrders(orderIds: string[], deliverymanId: string) {
  const session = await getSession();
  if (!session || !isRole(session, 'admin')) throw new Error("Accès refusé");

  const isUnassigning = !deliverymanId || deliverymanId === "unassigned";
  let driver = null;

  if (!isUnassigning) {
    driver = await prisma.user.findUnique({ where: { id: deliverymanId } });
    if (!driver) throw new Error("Livreur introuvable");
    if (driver.role !== "LIVREUR") throw new Error("Le compte choisi n'est pas un livreur.");
  }

  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } }
  });

  await Promise.all(orders.map(order => {
    const history = Array.isArray(order.history) ? [...order.history] : [];
    history.push({
      at: new Date().toISOString(),
      action: isUnassigning
        ? "Désattribution groupée"
        : order.status === "REPRO_DISPO"
          ? `Repro-dispo remise en livraison et attribuée à : ${driver?.name}`
          : `Attribution groupée au livreur : ${driver?.name}`,
      by: session.email,
      byName: session.name,
    });

    return prisma.order.update({
      where: { id: order.id },
      data: {
        deliverymanId: isUnassigning ? null : deliverymanId,
        deliverymanName: isUnassigning ? null : driver?.name,
        ...(!isUnassigning && order.status === "REPRO_DISPO" ? { status: "ON_DELIVERY" as const } : {}),
        history,
      }
    });
  }));

  revalidatePath("/zangochap-manager/admin/delivery");
  revalidatePath("/zangochap-manager/admin/delivery/settlement");
  return { success: true };
}
