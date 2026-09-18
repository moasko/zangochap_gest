import Topbar from "@/components/Topbar";
import { getSession } from "@/modules/auth/actions";
import { getExchangeRequestsForUi } from "@/modules/orders/actions";
import ExchangeRequestsClient from "@/modules/orders/components/ExchangeRequestsClient";

export const dynamic = "force-dynamic";

export default async function ExchangeRequestsPage() {
  const user = await getSession();
  if (!user || !["admin", "developer", "commercial"].includes(user.role)) {
    return <div className="content"><p>Accès refusé.</p></div>;
  }
  const result = await getExchangeRequestsForUi();
  return <>
    <Topbar title="Demandes d’échange" />
    <ExchangeRequestsClient initialRequests={result.success ? result.requests : []}
      initialInvalidCount={result.success ? result.invalidCount : 0}
      initialError={result.success ? undefined : result.error} canReview={user.role !== "commercial"} />
  </>;
}
