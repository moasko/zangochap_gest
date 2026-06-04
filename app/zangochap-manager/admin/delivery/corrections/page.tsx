import React from "react";
import { redirect } from "next/navigation";
import Topbar from "@/components/Topbar";
import prisma from "@/lib/prisma";
import { getSession } from "@/modules/auth/actions";
import DeliveryCorrectionsClient from "./DeliveryCorrectionsClient";

export const dynamic = "force-dynamic";

const CORRECTABLE_DELIVERY_STATUSES = [
  "DELIVERED",
  "PARTIALLY_DELIVERED",
  "RETURNED",
  "CANCELLED",
  "REPRO_DISPO",
] as const;

export default async function DeliveryCorrectionsPage() {
  const user = await getSession();
  if (!user || (user.role !== "admin" && user.role !== "developer")) {
    redirect("/zangochap-manager");
  }

  const [orders, deliverymen] = await Promise.all([
    prisma.order.findMany({
      where: {
        deletedAt: null,
        settlementId: null,
        status: { in: [...CORRECTABLE_DELIVERY_STATUSES] },
      },
      orderBy: { updatedAt: "desc" },
      include: { items: true },
      take: 300,
    }),
    prisma.user.findMany({
      where: { role: "LIVREUR" },
      select: { id: true, name: true, phone: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <Topbar title="Corrections" subtitle="livraison" />
      <DeliveryCorrectionsClient
        orders={JSON.parse(JSON.stringify(orders))}
        deliverymen={deliverymen}
      />
    </>
  );
}
