import { redirect } from "next/navigation";
import Topbar from "@/components/Topbar";
import { getSession } from "@/modules/auth/actions";
import { getWhatsAppConsoleData } from "@/modules/whatsapp/actions";
import WhatsAppBusinessClient from "./WhatsAppBusinessClient";

export const dynamic = "force-dynamic";

export default async function WhatsAppBusinessPage() {
  const session = await getSession();
  if (!session || !["admin", "developer"].includes(session.role)) {
    redirect("/zangochap-manager/dashboard");
  }

  const data = await getWhatsAppConsoleData();

  return (
    <>
      <Topbar title="WhatsApp Business" subtitle="Jasper's Market" />
      <WhatsAppBusinessClient initialData={JSON.parse(JSON.stringify(data))} />
    </>
  );
}

