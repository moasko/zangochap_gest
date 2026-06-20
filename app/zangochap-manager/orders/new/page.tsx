import React from "react";
import { getSession } from "@/modules/auth/actions";
import NewOrderClient from "@/modules/orders/components/NewOrderClient";
import { getNewOrderPageData } from "@/modules/orders/actions/queries";
import { getActiveRelayPoints } from "@/modules/boutique/relay-queries";

export const dynamic = "force-dynamic";

export default async function NewOrderPage() {
  const user = await getSession();
  const [{ products, categories }, relayPoints] = await Promise.all([
    getNewOrderPageData(user?.id),
    getActiveRelayPoints(),
  ]);

  return (
    <NewOrderClient
      products={JSON.parse(JSON.stringify(products))}
      user={user}
      categories={JSON.parse(JSON.stringify(categories))}
      relayPoints={relayPoints}
    />
  );
}
