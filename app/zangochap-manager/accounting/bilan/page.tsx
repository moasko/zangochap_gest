import { redirect } from "next/navigation";
import { getSession } from "@/modules/auth/actions";
import { getAccountingBilan } from "@/modules/accounting/actions";
import BilanClient from "./BilanClient";

export const dynamic = "force-dynamic";

function fmt(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export default async function BilanPage() {
  const session = await getSession();
  if (!session || !["admin", "developer", "comptable"].includes(String(session.role || "").toLowerCase())) {
    redirect("/zangochap-manager");
  }

  // Periode par defaut : le mois en cours.
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const defaultRange = { from: fmt(from), to: fmt(to) };

  const initial = await getAccountingBilan({ dateFrom: defaultRange.from, dateTo: defaultRange.to, scope: "BOTH" });

  return <BilanClient initial={initial} defaultRange={defaultRange} defaultPreset="month" />;
}
