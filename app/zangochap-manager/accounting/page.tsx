import { redirect } from "next/navigation";
import { getSession } from "@/modules/auth/actions";
import { getAccountingWorkspace } from "@/modules/accounting/actions";
import AccountingClient from "./AccountingClient";

export const dynamic = "force-dynamic";

type AccountingPageProps = {
  searchParams: Promise<{ date?: string }>;
};

export default async function AccountingPage({ searchParams }: AccountingPageProps) {
  const session = await getSession();
  if (!session || !["admin", "developer", "comptable"].includes(String(session.role || "").toLowerCase())) {
    redirect("/zangochap-manager");
  }

  const params = await searchParams;
  const workspace = await getAccountingWorkspace(params.date);

  return <AccountingClient workspace={workspace} />;
}
