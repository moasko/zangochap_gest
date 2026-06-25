import React from "react";
import prisma from "@/lib/prisma";
import { getSession } from "@/modules/auth/actions";
import { redirect } from "next/navigation";
import DeliveryClient from "./DeliveryClient";
import { RiderOrder } from "./types";

export const dynamic = "force-dynamic";

export default async function DeliveryPage() {
  const user = await getSession();
  
  // Security is handled by layout.tsx, but redundant check here for safety
  if (!user) redirect("/zangochap-manager");

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setHours(23, 59, 59, 999);
  const historyStart = new Date(startOfDay);
  historyStart.setDate(historyStart.getDate() - 60);

  const completedStatuses = ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED", "CANCELLED", "REPRO_DISPO"] as const;
  const readyMissionStatuses = ["PACKED", "ON_DELIVERY"] as const;

  const ordersRaw = await prisma.order.findMany({
    where: {
      deletedAt: null,
      OR: [
        {
          // Missions actives du jour uniquement : on borne par la date de
          // livraison planifiee pour eviter d'afficher d'anciennes commandes
          // PACKED/ON_DELIVERY jamais cloturees des jours precedents.
          deliverymanId: user.id,
          status: { in: [...readyMissionStatuses] },
          OR: [
            { deliveryDate: { gte: startOfDay, lte: endOfDay } },
            // Repli : commande sans date de livraison mais touchee aujourd'hui.
            { deliveryDate: null, updatedAt: { gte: startOfDay } },
          ],
        },
        {
          deliverymanId: user.id,
          status: { in: [...completedStatuses] },
          updatedAt: { gte: historyStart },
        },
        {
          lastDeliveryAttemptRiderId: user.id,
          status: { in: ["RETURNED", "CANCELLED", "REPRO_DISPO"] },
          updatedAt: { gte: historyStart },
        },
      ],
    },
    orderBy: [
      { updatedAt: "desc" },
      { status: "asc" },
    ],
    include: { 
      items: true,
      commercial: {
        select: {
          name: true,
          phone: true,
        }
      },
    },
    take: 150,
  });

  // Get all order IDs to fetch collection records
  const orderIds = ordersRaw.map(o => o.id);
  const collectionRecords = await prisma.collectionRecord.findMany({
    where: { orderId: { in: orderIds } },
  });

  // Get unique user IDs for packers and collectors to fetch their phones
  const packerIds = ordersRaw.map(o => o.packedBy).filter(Boolean) as string[];
  const collectorIds = collectionRecords.map(r => r.by);
  const allStaffIds = Array.from(new Set([...packerIds, ...collectorIds]));
  
  const staffUsers = await prisma.user.findMany({
    where: { id: { in: allStaffIds } },
    select: { id: true, name: true, phone: true }
  });

  const staffMap = new Map(staffUsers.map(u => [u.id, u]));

  // Safe serialization for Client Components
  const orders: RiderOrder[] = ordersRaw.map(o => {
    const packerUser = o.packedBy ? staffMap.get(o.packedBy) : null;
    const orderCollections = collectionRecords.filter(r => r.orderId === o.id);
    const collectors = Array.from(new Set(orderCollections.map(r => r.by)))
      .map(id => staffMap.get(id))
      .filter(Boolean) as { name: string; phone: string | null }[];

    return {
      id: o.id,
      ref: o.ref || o.id,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      customerPhone2: o.customerPhone2,
      customerLocation: o.customerLocation,
      commune: o.commune,
      total: Number(o.total),
      deliveryFee: Number(o.deliveryFee),
      amountReceived: o.amountReceived ?? null,
      discount: Number(o.discount || 0),
      deliveryNote: o.deliveryNote,
      notes: o.notes,
      deliveryDate: o.deliveryDate?.toISOString() || null,
      lastDeliveryAttemptAt: o.lastDeliveryAttemptAt?.toISOString() || null,
      lastDeliveryAttemptRiderId: o.lastDeliveryAttemptRiderId,
      lastDeliveryAttemptRiderName: o.lastDeliveryAttemptRiderName,
      lastDeliveryAttemptStatus: o.lastDeliveryAttemptStatus,
      lastDeliveryAttemptReason: o.lastDeliveryAttemptReason,
      status: o.status,
      isCommercialContacted: o.isCommercialContacted,
      returnReason: o.returnReason,
      updatedAt: o.updatedAt.toISOString(),
      createdAt: o.createdAt.toISOString(),
      settlementId: o.settlementId,
      items: o.items.map(i => ({
        id: i.id,
        name: i.name,
        size: i.size,
        color: i.color,
        qty: i.qty,
        price: Number(i.price),
        emoji: i.emoji,
        image: i.image,
        isCustom: i.isCustom,
        isGift: i.isGift,
        isDelivered: i.isDelivered,
        verifiedAt: i.verifiedAt?.toISOString() || null,
      })),
      commercial: o.commercial ? {
        name: o.commercial.name,
        phone: o.commercial.phone,
      } : null,
      packer: packerUser ? {
        name: packerUser.name,
        phone: packerUser.phone,
      } : (o.packedByName ? { name: o.packedByName, phone: null } : null),
      collectors: collectors,
    };
  });

  const serializedUser = JSON.parse(JSON.stringify(user));

  return (
    <DeliveryClient orders={orders} user={serializedUser} />
  );
}
