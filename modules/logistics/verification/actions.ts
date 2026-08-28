"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getSession } from "@/modules/auth/actions";
import { checkOrderAccess, isRole } from "@/modules/orders/helpers";
import type { Prisma } from "@prisma/client";

const VERIFIABLE_STATUSES = ["CONFIRMED", "PREPARING", "PARTIAL", "UNAVAILABLE", "REPROGRAMMED", "ALTERNATIVE"];

export async function toggleItemVerification(orderItemId: string, isVerified: boolean) {
  const session = await getSession();
  if (!session) throw new Error("Non authentifie");

  const existing = await prisma.orderItem.findUnique({ where: { id: orderItemId }, include: { order: true } });
  if (!existing || existing.order.deletedAt) throw new Error("Article introuvable");
  if (!isRole(session, "admin", "developer", "packing", "stock", "collection") || !checkOrderAccess(existing.order, session)) {
    throw new Error("Accès refusé");
  }
  if (!VERIFIABLE_STATUSES.includes(existing.order.status)) {
    throw new Error("Cette commande ne peut plus être modifiée depuis l'emballage.");
  }
  if (isVerified && existing.isGift && existing.giftApprovalStatus !== "APPROVED") {
    throw new Error(existing.giftApprovalStatus === "REJECTED"
      ? "Ce cadeau a été refusé par l'administrateur."
      : "Ce cadeau attend encore l'autorisation de l'administrateur.");
  }

  await prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.update({
      where: { id: orderItemId },
      data: {
        isVerified,
        verifiedAt: isVerified ? new Date() : null,
        packingStatus: isVerified ? "PACKED" : "PENDING",
      },
    });
    const currentOrder = await tx.order.findUnique({ where: { id: item.orderId }, select: { history: true } });
    const history: Prisma.InputJsonObject[] = Array.isArray(currentOrder?.history)
      ? currentOrder.history.flatMap((entry) => entry && typeof entry === "object" && !Array.isArray(entry)
        ? [entry as Prisma.InputJsonObject]
        : [])
      : [];
    history.push({
      at: new Date().toISOString(),
      action: `Verification : Article "${item.name}" marque comme ${isVerified ? "VERIFIE" : "NON VERIFIE"}`,
      by: session.email,
      byName: session.name,
    });
    await tx.order.update({ where: { id: item.orderId }, data: { history } });
  });

  revalidatePath("/zangochap-manager/logistics/verification");
  revalidatePath("/zangochap-manager/logistics/packing");
  return { success: true };
}

export async function markItemNotPacked(orderItemId: string) {
  const session = await getSession();
  if (!session) throw new Error("Non authentifie");

  const existing = await prisma.orderItem.findUnique({ where: { id: orderItemId }, include: { order: true } });
  if (!existing || existing.order.deletedAt) throw new Error("Article introuvable");
  if (!isRole(session, "admin", "developer", "packing", "stock", "collection") || !checkOrderAccess(existing.order, session)) {
    throw new Error("Accès refusé");
  }
  if (!VERIFIABLE_STATUSES.includes(existing.order.status)) {
    throw new Error("Cette commande ne peut plus être modifiée depuis l'emballage.");
  }

  const nextPackingStatus: "PENDING" | "NOT_PACKED" = existing.packingStatus === "NOT_PACKED" ? "PENDING" : "NOT_PACKED";

  await prisma.$transaction(async (tx) => {
    const item = await tx.orderItem.update({
      where: { id: orderItemId },
      data: { isVerified: false, verifiedAt: null, packingStatus: nextPackingStatus },
    });
    const currentOrder = await tx.order.findUnique({ where: { id: item.orderId }, select: { history: true } });
    const history: Prisma.InputJsonObject[] = Array.isArray(currentOrder?.history)
      ? currentOrder.history.flatMap((entry) => entry && typeof entry === "object" && !Array.isArray(entry)
        ? [entry as Prisma.InputJsonObject]
        : [])
      : [];
    history.push({
      at: new Date().toISOString(),
      action: nextPackingStatus === "NOT_PACKED"
        ? `Emballage : Article "${item.name}" marqué PAS EMBALLÉ`
        : `Emballage : État PAS EMBALLÉ retiré pour l'article "${item.name}"`,
      by: session.email,
      byName: session.name,
    });
    await tx.order.update({ where: { id: item.orderId }, data: { history } });
  });

  revalidatePath("/zangochap-manager/logistics/packing");
  return { success: true, packingStatus: nextPackingStatus };
}
