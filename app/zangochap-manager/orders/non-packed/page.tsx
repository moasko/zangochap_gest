import React from "react";
import Topbar from "@/components/Topbar";
import { getSession } from "@/modules/auth/actions";
import NonPackedClient from "@/modules/orders/components/NonPackedClient";
import { getNonPackedOrdersData } from "@/modules/orders/actions/queries";

export const dynamic = "force-dynamic";

export default async function NonPackedOrdersPage() {
  const user = await getSession();
  const { notPacked, withAlternatives } = await getNonPackedOrdersData(user, "today");

  return (
    <>
      <Topbar title="Fiche" subtitle="de rappel" />
      <NonPackedClient
        notPacked={JSON.parse(JSON.stringify(notPacked))}
        withAlternatives={JSON.parse(JSON.stringify(withAlternatives))}
        user={user}
      />
    </>
  );
}
