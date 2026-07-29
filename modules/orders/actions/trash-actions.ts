"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getSession } from "@/modules/auth/actions";
import { recordDeveloperAudit } from "@/modules/developer/audit";

const TRASH_ROLES = ["admin", "developer"];
const DELETED_REF_PREFIX = "[SUPPRIMÉ] ";

async function ensureTrashAccess() {
  const session = await getSession();
  if (!session || !TRASH_ROLES.includes(session.role?.toLowerCase())) {
    throw new Error("Accès refusé");
  }
  return session;
}

export async function getDeletedOrders(q?: string) {
  await ensureTrashAccess();

  const search = q?.trim();
  return prisma.order.findMany({
    where: {
      deletedAt: { not: null },
      ...(search
        ? {
            OR: [
              { ref: { contains: search, mode: "insensitive" } },
              { customerName: { contains: search, mode: "insensitive" } },
              { customerPhone: { contains: search } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      ref: true,
      customerName: true,
      customerPhone: true,
      commune: true,
      total: true,
      deliveryFee: true,
      status: true,
      deletedAt: true,
      createdAt: true,
      history: true,
      _count: { select: { items: true } },
    },
    orderBy: { deletedAt: "desc" },
    take: 200,
  });
}

export async function restoreOrder(orderId: string) {
  const session = await ensureTrashAccess();

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("Commande introuvable");
  if (!order.deletedAt) throw new Error("Cette commande n'est pas dans la corbeille");

  const cleanRef = order.ref?.startsWith(DELETED_REF_PREFIX)
    ? order.ref.slice(DELETED_REF_PREFIX.length)
    : order.ref;

  const history = Array.isArray(order.history) ? [...(order.history as any[])] : [];
  history.push({
    at: new Date().toISOString(),
    action: "Commande RESTAURÉE depuis la corbeille (statut: Annulée)",
    by: session.email,
    byName: session.name,
  });

  let restoredRef = cleanRef;
  try {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        deletedAt: null,
        ...(cleanRef && cleanRef !== order.ref ? { ref: cleanRef } : {}),
        history,
      },
    });
  } catch (e: any) {
    // La ref d'origine a pu être réattribuée à une autre commande entre-temps :
    // on restaure quand même, en conservant la ref préfixée (toujours unique).
    if (e?.code === "P2002") {
      restoredRef = order.ref;
      await prisma.order.update({
        where: { id: orderId },
        data: { deletedAt: null, history },
      });
    } else {
      throw e;
    }
  }

  await recordDeveloperAudit("order.restore", "success", {
    orderId: order.id,
    ref: restoredRef,
    previousRef: order.ref,
    customerName: order.customerName,
  });

  revalidatePath("/zangochap-manager/orders");
  revalidatePath("/zangochap-manager/orders/trash");
  revalidatePath("/zangochap-manager/dashboard");

  return { success: true, ref: restoredRef };
}
