import Topbar from "@/components/Topbar";
import { getSession } from "@/modules/auth/actions";
import { redirect } from "next/navigation";
import RiderMapClient from "./RiderMapClient";
export const dynamic = "force-dynamic";
export default async function RiderMapPage() {
  const user = await getSession();
  if (!user || !["admin", "developer"].includes(user.role.toLowerCase())) redirect("/zangochap-manager");
  return <><Topbar title="Carte" subtitle="des livreurs" /><RiderMapClient /></>;
}
