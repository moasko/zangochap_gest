import { redirect } from "next/navigation";
import { getSession } from "@/modules/auth/actions";
import { getAccountingSessionDetail } from "@/modules/accounting/actions";
import AccountingSessionDetailClient from "./AccountingSessionDetailClient";

export const dynamic = "force-dynamic";

type AccountingSessionPageProps = {
  params: Promise<{ id: string }>;
};

export default async function AccountingSessionPage({ params }: AccountingSessionPageProps) {
  const session = await getSession();
  if (!session || !["admin", "developer", "comptable"].includes(String(session.role || "").toLowerCase())) {
    redirect("/zangochap-manager");
  }

  const { id } = await params;
  const workspace = await getAccountingSessionDetail(id);

  return <AccountingSessionDetailClient workspace={workspace} />;
}
