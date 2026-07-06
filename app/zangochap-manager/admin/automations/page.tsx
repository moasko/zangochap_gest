import { redirect } from "next/navigation";
import Topbar from "@/components/Topbar";
import { getSession } from "@/modules/auth/actions";
import { getAutomationsConsoleData } from "@/modules/automations/actions";
import AutomationsClient from "./AutomationsClient";

export const dynamic = "force-dynamic";

export default async function AutomationsPage() {
  const session = await getSession();
  if (!session || !["admin", "developer"].includes(session.role)) {
    redirect("/zangochap-manager/dashboard");
  }

  const data = await getAutomationsConsoleData();

  return (
    <>
      <Topbar title="Automatisations" subtitle="Déclencheurs, conditions et actions automatiques" />
      <AutomationsClient initialData={JSON.parse(JSON.stringify(data))} />
    </>
  );
}
