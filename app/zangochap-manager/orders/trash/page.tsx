import React from "react";
import Topbar from "@/components/Topbar";
import { getSession } from "@/modules/auth/actions";
import { redirect } from "next/navigation";
import { getDeletedOrders } from "@/modules/orders/actions/trash-actions";
import TrashClient from "./TrashClient";

export const dynamic = "force-dynamic";

export default async function OrdersTrashPage() {
  const session = await getSession();
  if (!session || !["admin", "developer"].includes(session.role?.toLowerCase())) {
    redirect("/zangochap-manager/dashboard");
  }

  const orders = await getDeletedOrders();

  return (
    <>
      <Topbar title="Corbeille" subtitle="commandes supprimées" />
      <TrashClient initialOrders={JSON.parse(JSON.stringify(orders))} />
    </>
  );
}
