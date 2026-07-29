"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getSession } from "@/modules/auth/actions";
import { recordDeveloperAudit } from "@/modules/developer/audit";

export async function getTodayLabels() {
  const session = await getSession();
  if (!session) throw new Error("Non authentifié");

  // Get start of today (00:00:00) and end of today (23:59:59)
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  const orders = await prisma.order.findMany({
    where: {
      createdAt: {
        gte: startOfDay,
        lte: endOfDay,
      },
      status: {
        notIn: ["CANCELLED", "REPRO_DISPO"],
      },
      ref: {
        not: null,
      },
    },
    select: {
      id: true,
      ref: true,
      isLabeled: true,
      labeledAt: true,
      labeledByName: true,
      createdAt: true,
      items: {
        select: {
          id: true,
          name: true,
          qty: true,
          image: true,
          emoji: true,
          size: true,
          color: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return orders;
}

export async function toggleLabelStatus(orderId: string, isLabeled: boolean) {
  const session = await getSession();
  if (!session) throw new Error("Non authentifié");

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { history: true } });
  if (!order) throw new Error("Commande introuvable");

  const history = Array.isArray(order.history) ? [...(order.history as any[])] : [];
  history.push({
    at: new Date().toISOString(),
    action: isLabeled ? "Étiquette marquée comme posée" : "Étiquette décochée",
    by: session.email,
    byName: session.name,
  });

  await prisma.order.update({
    where: { id: orderId },
    data: {
      isLabeled,
      labeledAt: isLabeled ? new Date() : null,
      labeledByName: isLabeled ? session.name : null,
      history,
    },
  });

  revalidatePath("/zangochap-manager/logistics/labels");
  revalidatePath("/zangochap-manager/dashboard");
  revalidatePath("/zangochap-manager/orders");
  return { success: true };
}

export async function checkAllLabels(orderIds: string[], isLabeled: boolean) {
  const session = await getSession();
  if (!session) throw new Error("Non authentifié");

  await prisma.order.updateMany({
    where: { id: { in: orderIds } },
    data: {
      isLabeled,
      labeledAt: isLabeled ? new Date() : null,
      labeledByName: isLabeled ? session.name : null,
    },
  });

  // Action en masse : une seule trace centrale plutôt que N mises à jour d'history.
  await recordDeveloperAudit("orders.labels.bulk", "info", {
    isLabeled,
    count: orderIds.length,
    orderIds: orderIds.slice(0, 100),
  });

  revalidatePath("/zangochap-manager/logistics/labels");
  revalidatePath("/zangochap-manager/dashboard");
  revalidatePath("/zangochap-manager/orders");
  return { success: true };
}
