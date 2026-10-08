import { redirect } from "next/navigation";
import Topbar from "@/components/Topbar";
import { getSession } from "@/modules/auth/actions";
import { getDeliveryPlanningOverview } from "@/modules/delivery-planning/actions";
import PlanningClient from "@/modules/delivery-planning/components/PlanningClient";

export const dynamic = "force-dynamic";

export default async function DeliveryPlanningPage() {
  const user = await getSession();
  if (!user || (user.role !== "admin" && user.role !== "developer")) redirect("/zangochap-manager");

  const overview = await getDeliveryPlanningOverview();

  return (
    <>
      <Topbar title="Planning" subtitle="des livreurs" />
      <PlanningClient initial={JSON.parse(JSON.stringify(overview))} />
    </>
  );
}
