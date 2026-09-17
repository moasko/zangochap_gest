import Topbar from "@/components/Topbar";
import { getSession } from "@/modules/auth/actions";
import { getExchangeRequests } from "@/modules/orders/actions";
import ExchangeRequestsClient from "@/modules/orders/components/ExchangeRequestsClient";

export const dynamic = "force-dynamic";

export default async function ExchangeRequestsPage() {
  const user = await getSession();
  if (!user || !["admin", "developer", "commercial"].includes(user.role)) {
    return <div className="content"><p>Accès refusé.</p></div>;
  }
  const requests = await getExchangeRequests();
  return <>
    <Topbar title="Demandes d’échange" />
    <ExchangeRequestsClient initialRequests={requests} canReview={user.role !== "commercial"} />
  </>;
}
