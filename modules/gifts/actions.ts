"use server";

import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";
import { revalidatePath } from "next/cache";

function monthBounds(date = new Date()) {
  return {
    start: new Date(date.getFullYear(), date.getMonth(), 1),
    end: new Date(date.getFullYear(), date.getMonth() + 1, 1),
  };
}

export async function getCommercialGiftUsage(commercialId?: string) {
  const session = await ensureAuth();
  const canViewOthers = ["admin", "developer"].includes(session.role.toLowerCase());
  const targetId = commercialId && canViewOthers ? commercialId : session.id;
  if (!targetId) throw new Error("Commercial introuvable.");

  const commercial = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, name: true, role: true, giftMonthlyQuota: true, giftMonthlyValueQuota: true },
  });
  if (!commercial || commercial.role !== "COMMERCIAL") throw new Error("Commercial introuvable.");

  const { start, end } = monthBounds();
  const approvedItems = await prisma.orderItem.findMany({
    where: {
      isGift: true,
      giftCountsTowardQuota: true,
      giftApprovalStatus: "APPROVED",
      order: { commercialId: targetId, deletedAt: null, status: { not: "CANCELLED" }, createdAt: { gte: start, lt: end } },
    },
    select: { qty: true, giftUnitValue: true },
  });
  const pending = await prisma.giftApprovalRequest.count({
    where: { commercialId: targetId, status: "PENDING", createdAt: { gte: start, lt: end } },
  });
  const usedQuantity = approvedItems.reduce((sum, item) => sum + item.qty, 0);
  const usedValue = approvedItems.reduce((sum, item) => sum + item.qty * item.giftUnitValue, 0);

  return {
    commercial,
    usedQuantity,
    usedValue,
    remainingQuantity: Math.max(0, commercial.giftMonthlyQuota - usedQuantity),
    remainingValue: commercial.giftMonthlyValueQuota > 0
      ? Math.max(0, commercial.giftMonthlyValueQuota - usedValue)
      : null,
    pending,
  };
}

export async function getGiftQuotaAdminData() {
  await ensureAuth(["admin"]);
  const commercials = await prisma.user.findMany({
    where: { role: "COMMERCIAL" },
    select: { id: true, name: true, email: true, giftMonthlyQuota: true, giftMonthlyValueQuota: true },
    orderBy: { name: "asc" },
  });
  const usage = await Promise.all(commercials.map(async (commercial) => ({
    commercial,
    usage: await getCommercialGiftUsage(commercial.id),
  })));
  const requests = await prisma.giftApprovalRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });
  return JSON.parse(JSON.stringify({ usage, requests }));
}

export async function updateCommercialGiftQuota(commercialId: string, quantity: number, value: number) {
  await ensureAuth(["admin"]);
  const safeQuantity = Math.max(0, Math.trunc(Number(quantity) || 0));
  const safeValue = Math.max(0, Math.trunc(Number(value) || 0));
  const commercial = await prisma.user.findFirst({ where: { id: commercialId, role: "COMMERCIAL" } });
  if (!commercial) throw new Error("Commercial introuvable.");
  await prisma.user.update({
    where: { id: commercialId },
    data: { giftMonthlyQuota: safeQuantity, giftMonthlyValueQuota: safeValue },
  });
  revalidatePath("/zangochap-manager/admin/settings/gifts");
  return { success: true };
}

export async function reviewGiftRequest(requestId: string, decision: "APPROVED" | "REJECTED", note?: string) {
  const session = await ensureAuth(["admin"]);
  await prisma.$transaction(async (tx) => {
    const request = await tx.giftApprovalRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== "PENDING") throw new Error("Cette demande a déjà été traitée.");
    const order = await tx.order.findUnique({ where: { id: request.orderId } });
    if (!order || order.deletedAt) throw new Error("La commande n'est plus disponible.");

    await tx.giftApprovalRequest.update({
      where: { id: requestId },
      data: {
        status: decision,
        reviewedById: session.id,
        reviewedByName: session.name,
        reviewedAt: new Date(),
        reviewNote: note?.trim() || null,
      },
    });
    await tx.orderItem.update({
      where: { id: request.orderItemId },
      data: { giftApprovalStatus: decision },
    });
    const history = Array.isArray(order.history) ? [...order.history] : [];
    history.push({
      at: new Date().toISOString(),
      action: `Cadeau ${decision === "APPROVED" ? "autorisé" : "refusé"} : ${request.giftName}`,
      by: session.email,
      byName: session.name,
      ...(note?.trim() ? { note: note.trim() } : {}),
    });
    await tx.order.update({ where: { id: order.id }, data: { history } });
  });
  revalidatePath("/zangochap-manager/admin/settings/gifts");
  revalidatePath("/zangochap-manager/logistics/packing");
  revalidatePath("/zangochap-manager/orders");
  return { success: true };
}
