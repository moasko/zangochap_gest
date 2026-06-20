"use server";

import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { restockVariant } from "@/modules/orders/actions/stock";
import { buildCollectionItems, getCollectionLabel } from "./helpers";
import { MarkCollectionSchema } from "./types";

type OrderHistoryEntry = {
  at?: string;
  action: string;
  by?: string;
  byName?: string;
};

export async function getCollectionRecords(filters?: { byName?: string }) {
  await ensureAuth(["admin", "collection", "point_relais"]);
  const where: Prisma.CollectionRecordWhereInput = {};
  if (filters?.byName) where.byName = filters.byName;

  return prisma.collectionRecord.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
}

export async function markCollection(input: unknown) {
  const session = await ensureAuth(["admin", "collection", "point_relais"]);

  const parsed = MarkCollectionSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Donnees de collecte invalides.");
  }

  const { orderId, productId, status, orderItemId, note } = parsed.data;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) throw new Error("Commande introuvable");

  const orderItem = orderItemId ? order.items.find((item) => item.id === orderItemId) : null;
  const effectiveProductId = orderItem?.productId || (productId === "CUSTOM" ? null : productId);

  await prisma.$transaction(async (tx) => {
    await tx.collectionRecord.create({
      data: {
        orderId,
        productId,
        status,
        by: session.email,
        byName: session.name,
      },
    });

    let productName = productId;
    if (orderItem) {
      productName = orderItem.name;
    } else if (effectiveProductId) {
      const product = await tx.product.findUnique({ where: { id: effectiveProductId } });
      productName = product?.name || effectiveProductId;
    }

    const history = Array.isArray(order.history) ? [...(order.history as OrderHistoryEntry[])] : [];
    history.push({
      at: new Date().toISOString(),
      action: `${session.name} a ${getCollectionLabel(status, note)} [ITEM_ID:${orderItemId || ""}] : ${productName}`,
      by: session.email,
      byName: session.name,
    });

    await tx.order.update({
      where: { id: orderId },
      data: { history },
    });

    if (status !== "collected" || !effectiveProductId) return;

    const variant = orderItem?.variantId
      ? await tx.productVariant.findUnique({ where: { id: orderItem.variantId } })
      : orderItem
        ? await tx.productVariant.findFirst({
            where: {
              productId: effectiveProductId,
              size: orderItem.size,
              color: orderItem.color,
            },
          })
      : null;

    if (!variant) {
      await tx.product.update({
        where: { id: effectiveProductId },
        data: { stock: { increment: 1 } },
      });
      return;
    }

    const warehouse = await tx.warehouse.upsert({
      where: { name: "Entrepôt Principal" },
      update: {},
      create: { name: "Entrepôt Principal", location: "Siège Zangochap" },
    });
    await restockVariant({
      variantId: variant.id,
      warehouseId: warehouse.id,
      quantity: orderItem?.qty || 1,
      type: "RESTOCK",
      orderId,
      session,
      reason: `Collecte fournisseur: ${orderItem?.name || effectiveProductId}`,
    }, tx as any);
  });

  if (status === "collected" && effectiveProductId) {
    await notifyOrderIfFullyAvailable(orderId);
  }

  revalidateCollectionPaths();
  return { success: true };
}

export async function getItemsToCollect() {
  await ensureAuth(["admin", "collection", "point_relais"]);
  const orders = await prisma.order.findMany({
    where: { status: { notIn: ["CANCELLED", "DELIVERED"] } },
    include: { items: true },
  });

  const productIds = Array.from(
    new Set(orders.flatMap((order) => order.items.map((item) => item.productId)).filter(Boolean)),
  ) as string[];

  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        include: { variants: true },
      })
    : [];

  return buildCollectionItems(orders, products);
}

async function notifyOrderIfFullyAvailable(orderId: string) {
  const updatedOrder = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          product: { include: { variants: true } },
        },
      },
    },
  });

  if (!updatedOrder || updatedOrder.status !== "CONFIRMED") return;

  const allAvailable = updatedOrder.items.every((item) => {
    if (!item.productId) return true;
    const requestedQty = Number(item.qty) || 1;
    const variant = item.variantId
      ? item.product?.variants.find((v: any) => v.id === item.variantId)
      : item.product?.variants.find((v: any) => v.size === item.size && v.color === item.color);
    if (variant) return Number(variant.stock || 0) >= requestedQty;
    return Number(item.product?.stock || 0) >= requestedQty;
  });
  if (!allAvailable) return;

  const history = Array.isArray(updatedOrder.history) ? [...(updatedOrder.history as OrderHistoryEntry[])] : [];
  const alreadyNotified = history.some((entry) => entry.action.includes("disponibles (Auto)"));
  if (alreadyNotified) return;

  history.push({
    at: new Date().toISOString(),
    action: "Systeme : Tous les articles de la commande sont desormais disponibles en stock.",
    by: "system",
    byName: "Systeme Zango",
  });

  await prisma.order.update({
    where: { id: orderId },
    data: { history },
  });
}

function revalidateCollectionPaths() {
  revalidatePath("/zangochap-manager/logistics");
  revalidatePath("/zangochap-manager/logistics/packing");
  revalidatePath("/zangochap-manager/logistics/collection");
  revalidatePath("/zangochap-manager/orders");
  revalidatePath("/zangochap-manager/dashboard");
}
