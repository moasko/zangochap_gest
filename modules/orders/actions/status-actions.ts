"use server";
/* eslint-disable @typescript-eslint/no-explicit-any */

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { getSession } from "@/modules/auth/actions";
import { checkOrderAccess, generateUniqueRef, isRole } from "../helpers";
import { decrementStockForOrder, restoreStockForOrder, restoreStockForOrderItem } from "./stock";

type UpdateOrderStatusResult = {
  success: true;
  order: any;
};

const CLOSED_DELIVERY_STATUSES = ['DELIVERED', 'PARTIALLY_DELIVERED', 'RETURNED', 'CANCELLED'];

function normalizeAmountReceived(amountReceived?: number | null) {
  if (amountReceived === undefined || amountReceived === null) return undefined;
  const amount = Math.trunc(Number(amountReceived));
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Montant reçu invalide.");
  }
  return amount;
}

// ============ UPDATE ORDER STATUS ============
export async function updateOrderStatus(orderId: string, newStatus: string, note?: string, amountReceived?: number | null, reproDeliveryDate?: string): Promise<UpdateOrderStatusResult> {
  const session = await getSession();
  if (!session) throw new Error("Non authentifié");

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) throw new Error("Commande introuvable");

  if (!checkOrderAccess(order, session)) {
    throw new Error("Accès refusé");
  }

  const statusLabels: Record<string, string> = {
    'PENDING': 'En attente',
    'CONFIRMED': 'Confirmée',
    'PACKED': 'Emballée',
    'ON_DELIVERY': 'En livraison',
    'DELIVERED': 'Livrée',
    'CANCELLED': 'Annulée',
    'RETURNED': 'Retournée',
    'EXCHANGED': 'Echange effectué',
    'REPROGRAMMED': 'Reprogrammée',
    'REPRO_DISPO': 'Repro-dispo',
    'TO_PROCESS': 'À traiter',
    'PARTIALLY_DELIVERED': 'Livrée partiellement',
    'PARTIAL': 'Emballage partiel',
    'UNAVAILABLE': 'Indisponible',
    'ALTERNATIVE': 'Alternative proposée',
    'PREPARING': 'En préparation'
  };

  const normalizedStatus = newStatus.toUpperCase();
  if (normalizedStatus === 'TO_PROCESS') {
    throw new Error("Le statut A traiter est reserve aux commandes du site public.");
  }

  const history = Array.isArray(order.history) ? [...(order.history as any[])] : [];
  history.push({
    at: new Date().toISOString(),
    action: `Statut : ${statusLabels[newStatus.toUpperCase()] || newStatus}`,
    by: session.email,
    byName: session.name,
  });
  if (note) {
    history.push({
      at: new Date().toISOString(),
      action: `Note: ${note}`,
      by: session.email,
      byName: session.name,
    });
  }

  const normalizedAmountReceived = normalizeAmountReceived(amountReceived);
  if (normalizedStatus === 'DELIVERED' && normalizedAmountReceived !== undefined) {
    history.push({
      at: new Date().toISOString(),
      action: `Montant reçu livreur: ${normalizedAmountReceived} F`,
      by: session.email,
      byName: session.name,
    });
  }

  const updateData: any = {
    status: normalizedStatus,
    history,
  };

  if (['RETURNED', 'CANCELLED', 'REPRO_DISPO'].includes(normalizedStatus) && !note?.trim()) {
    throw new Error("Un motif est obligatoire pour clôturer cette livraison.");
  }

  let updatedOrder: any = null;

  await prisma.$transaction(async (tx) => {
    if (['RETURNED', 'CANCELLED', 'REPRO_DISPO'].includes(normalizedStatus)) {
      updateData.lastDeliveryAttemptAt = new Date();
      updateData.lastDeliveryAttemptRiderId = order.deliverymanId;
      updateData.lastDeliveryAttemptRiderName = order.deliverymanName;
      updateData.lastDeliveryAttemptStatus = normalizedStatus;
      updateData.lastDeliveryAttemptReason = note?.trim();
    }

    if (normalizedStatus === 'REPRO_DISPO') {
      const nextDeliveryDate = reproDeliveryDate ? new Date(`${reproDeliveryDate}T00:00:00`) : null;
      if (!nextDeliveryDate || Number.isNaN(nextDeliveryDate.getTime())) {
        throw new Error("Choisissez la nouvelle date de livraison.");
      }
      updateData.deliveryDate = nextDeliveryDate;
      updateData.type = 'Repro-dispo';
      history.push({
        at: new Date().toISOString(),
        action: `Report client au ${reproDeliveryDate}${order.deliverymanName ? ` (Livreur: ${order.deliverymanName})` : ''}`,
        by: session.email,
        byName: session.name,
      });
    }

    if (['PACKED', 'PARTIAL'].includes(normalizedStatus)) {
      updateData.packedBy = session.email;
      updateData.packedByName = session.name;
      updateData.packedAt = new Date();
    }

    if (normalizedStatus === 'CONFIRMED') {
      updateData.confirmedAt = order.confirmedAt || new Date();
      updateData.confirmedByName = session.name;
      if (!order.ref) {
        updateData.ref = await generateUniqueRef(order.commune || undefined, order.type || undefined);
      }
    }

    if (normalizedStatus === 'DELIVERED' && normalizedAmountReceived !== undefined) {
      updateData.amountReceived = normalizedAmountReceived;
    }

    if (normalizedStatus === 'PACKED') {
      await decrementStockForOrder(order, session, tx);
    }

    // Restore stock for non-shipping statuses
    const shippingStatuses = ['PACKED', 'ON_DELIVERY', 'DELIVERED', 'PARTIALLY_DELIVERED', 'REPRO_DISPO'];
    if (!shippingStatuses.includes(normalizedStatus) && order.stockDecremented) {
      const type = normalizedStatus === 'EXCHANGED' ? 'EXCHANGE' : 'RETURN';
      await restoreStockForOrder(order, session, type, tx);
      updateData.stockDecremented = false;
    }

    if (!['PACKED', 'PARTIAL', 'ON_DELIVERY', 'DELIVERED', 'PARTIALLY_DELIVERED', 'REPRO_DISPO'].includes(normalizedStatus)) {
      updateData.packedBy = null;
      updateData.packedByName = null;
      updateData.packedAt = null;
    }

    updatedOrder = await tx.order.update({
      where: { id: orderId },
      data: {
        ...updateData,
        returnReason: ['RETURNED', 'CANCELLED', 'REPRO_DISPO'].includes(normalizedStatus) ? note : undefined
      },
      include: { items: true },
    });
  });

  revalidatePath("/zangochap-manager/orders");
  revalidatePath("/zangochap-manager/logistics");
  revalidatePath("/zangochap-manager/logistics/packing");
  revalidatePath("/zangochap-manager/logistics/collection");
  revalidatePath("/zangochap-manager/logistics/labels");
  revalidatePath("/zangochap-manager/logistics/verification");
  revalidatePath("/zangochap-manager/admin/delivery");
  revalidatePath("/zangochap-manager/admin/delivery/settlement");
  revalidatePath("/zangochap-manager/dashboard");
  revalidatePath("/zangochap-rider");
  if (!updatedOrder) throw new Error("Mise a jour impossible.");
  return { success: true, order: JSON.parse(JSON.stringify(updatedOrder)) };
}

export async function reopenDeliveryOrder(orderId: string, note?: string) {
  const session = await getSession();
  if (!session || !isRole(session, 'admin', 'developer')) {
    throw new Error("Action réservée aux administrateurs.");
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      ref: true,
      status: true,
      history: true,
      settlementId: true,
    },
  });
  if (!order) throw new Error("Commande introuvable.");

  if (!CLOSED_DELIVERY_STATUSES.includes(order.status)) {
    throw new Error("Cette commande n'est pas clôturée côté livraison.");
  }

  if (order.settlementId) {
    throw new Error("Impossible de faire marche arrière : cette commande est déjà rattachée à un règlement livreur.");
  }

  const history = Array.isArray(order.history) ? [...(order.history as any[])] : [];
  history.push({
    at: new Date().toISOString(),
    action: `Correction admin : remise en livraison depuis ${order.status}`,
    by: session.email,
    byName: session.name,
  });
  if (note?.trim()) {
    history.push({
      at: new Date().toISOString(),
      action: `Motif correction admin: ${note.trim()}`,
      by: session.email,
      byName: session.name,
    });
  }

  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: {
      status: 'ON_DELIVERY',
      amountReceived: null,
      returnReason: null,
      isCommercialContacted: false,
      history,
    },
    include: { items: true },
  });

  revalidatePath("/zangochap-manager/admin/delivery");
  revalidatePath("/zangochap-manager/admin/delivery/settlement");
  revalidatePath("/zangochap-manager/orders");
  revalidatePath("/zangochap-rider");

  return { success: true, order: JSON.parse(JSON.stringify(updatedOrder)) };
}

// ============ PARTIAL DELIVERY ============
export async function markPartialDelivery(orderId: string, deliveredQuantities: Record<string, number>, note?: string, includeDeliveryFee: boolean = true, amountReceived?: number | null) {
  const session = await getSession();
  if (!session) throw new Error("Non authentifié");

  if (session.role.toUpperCase() === 'COMMERCIAL') {
    throw new Error("Action réservée aux livreurs et administrateurs.");
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) throw new Error("Commande introuvable");
  if (!checkOrderAccess(order, session)) throw new Error("Accès refusé");
  if (['DELIVERED', 'PARTIALLY_DELIVERED'].includes(order.status)) {
    throw new Error("Cette commande a déjà été livrée.");
  }

  const normalizedQuantities = new Map<string, number>();
  let deliveredItemsCount = 0;
  for (const item of order.items) {
    const qty = Math.trunc(Number(deliveredQuantities[item.id] ?? 0));
    if (!Number.isFinite(qty) || qty < 0 || qty > item.qty) {
      throw new Error(`Quantité invalide pour ${item.name}.`);
    }
    normalizedQuantities.set(item.id, qty);
    if (qty > 0) deliveredItemsCount += 1;
  }
  if (deliveredItemsCount === 0) {
    throw new Error("Sélectionnez au moins un article livré.");
  }
  const hasReturnedItems = order.items.some((item) => (normalizedQuantities.get(item.id) || 0) < item.qty);
  if (hasReturnedItems && !note?.trim()) {
    throw new Error("Un motif est obligatoire pour les articles non livrés.");
  }

  const history = Array.isArray(order.history) ? [...(order.history as any[])] : [];
  const normalizedAmountReceived = normalizeAmountReceived(amountReceived);

  // Log original quantities for audit trail before any modification
  const originalQties = order.items.map((item) => `${item.name}(${item.size}/${item.color}): ${item.qty}`).join(', ');
  history.push({
    at: new Date().toISOString(),
    action: `Livraison partielle effectuée. Qté originales: [${originalQties}]. Frais de livraison: ${includeDeliveryFee ? 'Maintenus' : 'Annulés'}`,
    by: session.email,
    byName: session.name,
  });

  if (note) {
    history.push({
      at: new Date().toISOString(),
      action: `Note de retour partiel: ${note}`,
      by: session.email,
      byName: session.name,
    });
  }

  let newSubtotal = 0;

  for (const item of order.items) {
    const dQty = normalizedQuantities.get(item.id) || 0;
    const returnedQty = item.qty - dQty;

    if (dQty === 0) {
      await prisma.orderItem.update({
        where: { id: item.id },
        data: { isDelivered: false }
      });
    } else if (dQty === item.qty) {
      await prisma.orderItem.update({
        where: { id: item.id },
        data: { isDelivered: true }
      });
      newSubtotal += (item.price * item.qty);
    } else if (dQty > 0 && dQty < item.qty) {
      await prisma.orderItem.update({
        where: { id: item.id },
        data: {
          qty: dQty,
          isDelivered: true,
          notes: `[Livré partiellement: ${dQty}/${item.qty} — original: ${item.qty}]${item.notes ? ' ' + item.notes : ''}`
        }
      });
      newSubtotal += (item.price * dQty);

      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          name: item.name,
          size: item.size,
          color: item.color,
          qty: returnedQty,
          price: item.price,
          emoji: item.emoji,
          image: item.image,
          productId: item.productId,
          variantId: item.variantId,
          isCustom: item.isCustom,
          isGift: item.isGift,
          isDelivered: false,
          notes: `[Retour: ${returnedQty}/${item.qty} — original: ${item.qty}]`
        }
      });
    }

    // Restore stock for returned items
    if (returnedQty > 0 && order.stockDecremented && item.productId) {
      await restoreStockForOrderItem({
        order,
        item,
        quantity: returnedQty,
        session,
        type: "RESTOCK",
        reason: `Retour suite à livraison partielle (Qté: ${returnedQty})`,
      });
    }
  }

  const finalDeliveryFee = includeDeliveryFee ? order.deliveryFee : 0;
  const expectedAmount = Math.max(0, newSubtotal + finalDeliveryFee - (order.discount || 0));
  const finalAmountReceived = normalizedAmountReceived ?? expectedAmount;
  history.push({
    at: new Date().toISOString(),
    action: `Montant reçu livreur: ${finalAmountReceived} F`,
    by: session.email,
    byName: session.name,
  });

  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: 'PARTIALLY_DELIVERED',
      total: newSubtotal,
      deliveryFee: finalDeliveryFee,
      amountReceived: finalAmountReceived,
      history,
    }
  });

  revalidatePath("/zangochap-manager/orders");
  revalidatePath("/zangochap-manager/dashboard");
  revalidatePath("/zangochap-rider");
  revalidatePath("/zangochap-manager/admin/delivery");
  return { success: true };
}
