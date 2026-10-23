import { redirect } from "next/navigation";
import Topbar from "@/components/Topbar";
import { getSession } from "@/modules/auth/actions";
import { getPushConsoleData } from "@/modules/push/actions";
import PushClient from "./PushClient";

export const dynamic = "force-dynamic";

export default async function PushPage() {
  const session = await getSession();
  if (!session || !["admin", "developer"].includes(session.role)) {
    redirect("/zangochap-manager/dashboard");
  }

  const data = await getPushConsoleData();

  return (
    <>
      <Topbar title="Notifications push" subtitle="Campagnes et suivi de commande dans l'application mobile" />
      <PushClient initialData={JSON.parse(JSON.stringify(data))} />
    </>
  );
}
