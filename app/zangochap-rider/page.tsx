import React from "react";
import { getSession } from "@/modules/auth/actions";
import { redirect } from "next/navigation";
import DeliveryClient from "./DeliveryClient";
import { loadRiderOrders } from "@/modules/rider-app/orders";

export const dynamic = "force-dynamic";

export default async function DeliveryPage() {
  const user = await getSession();
  
  // Security is handled by layout.tsx, but redundant check here for safety
  if (!user) redirect("/zangochap-manager");

  const orders = await loadRiderOrders(user);

  const serializedUser = JSON.parse(JSON.stringify(user));

  return (
    <DeliveryClient orders={orders} user={serializedUser} />
  );
}
