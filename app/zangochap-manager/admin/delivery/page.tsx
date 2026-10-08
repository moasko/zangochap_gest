import React from "react";
import prisma from "@/lib/prisma";
import Topbar from "@/components/Topbar";
import { getSession } from "@/modules/auth/actions";
import { redirect } from "next/navigation";
import AdminDeliveryClient from "./AdminDeliveryClient";

export const dynamic = "force-dynamic";

const RECENT_ACTIVITY_DAYS = 14;

export default async function AdminDeliveryPage() {
  const user = await getSession();
  if (!user || (user.role !== 'admin' && user.role !== 'developer')) redirect("/zangochap-manager");

  const recentSince = new Date();
  recentSince.setUTCDate(recentSince.getUTCDate() - RECENT_ACTIVITY_DAYS);

  const [activeOrders, archivedOrders, riders, recentActivity] = await Promise.all([
    prisma.order.findMany({
      where: {
        deletedAt: null,
        status: { notIn: ['CANCELLED', 'DELIVERED', 'PARTIALLY_DELIVERED', 'RETURNED'] },
      },
      orderBy: { updatedAt: "desc" },
      include: { items: true },
    }),
    prisma.order.findMany({
      where: {
        deletedAt: null,
        status: { in: ['CANCELLED', 'DELIVERED', 'PARTIALLY_DELIVERED', 'RETURNED'] },
      },
      orderBy: { updatedAt: "desc" },
      include: { items: true },
      take: 250,
    }),
    prisma.user.findMany({
      where: { role: 'LIVREUR' },
      select: {
        id: true,
        name: true,
        phone: true,
      },
      orderBy: { name: "asc" },
    }),
    prisma.order.groupBy({
      by: ["deliverymanId"],
      where: { deletedAt: null, deliverymanId: { not: null }, deliveryDate: { gte: recentSince } },
      _count: { _all: true },
    }),
  ]);

  // Livreurs actifs recemment en premier ; les comptes dormants restent accessibles a part.
  const recentCounts = new Map(recentActivity.map((row) => [row.deliverymanId, row._count._all]));
  const deliverymen = riders
    .map((rider) => ({ ...rider, recentCount: recentCounts.get(rider.id) || 0 }))
    .sort((a, b) => b.recentCount - a.recentCount || a.name.localeCompare(b.name));

  return (
    <>
      <Topbar title="Gestion" subtitle="des livraisons" />
      <AdminDeliveryClient 
        activeOrders={JSON.parse(JSON.stringify(activeOrders))}
        archivedOrders={JSON.parse(JSON.stringify(archivedOrders))}
        deliverymen={deliverymen} 
      />
    </>
  );
}
