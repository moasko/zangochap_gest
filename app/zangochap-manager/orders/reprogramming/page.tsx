import Topbar from "@/components/Topbar";
import { getSession } from "@/modules/auth/actions";
import { getReprogrammingRequests } from "@/modules/orders/actions";
import ReprogrammingRequestsClient from "@/modules/orders/components/ReprogrammingRequestsClient";

export const dynamic = "force-dynamic";

export default async function ReprogrammingRequestsPage() {
  const user = await getSession();
  if (!user || !["admin", "developer", "commercial"].includes(user.role)) {
    return <div className="content"><p>Accès refusé.</p></div>;
  }
  const requests = await getReprogrammingRequests();
  return <>
    <Topbar title="Demandes de reprogrammation" subtitle={user.role === "commercial" ? "Suivi de vos demandes et décisions administrateur" : "Valider ou refuser les demandes des commerciaux"} />
    <ReprogrammingRequestsClient initialRequests={requests} canReview={user.role !== "commercial"} />
  </>;
}
