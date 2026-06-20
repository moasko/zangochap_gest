import { redirect } from "next/navigation";
import { getSession } from "@/modules/auth/actions";
import { getAccountingSessionIdForDate } from "@/modules/accounting/actions";

export const dynamic = "force-dynamic";

type AccountingSessionByDatePageProps = {
  params: Promise<{ date: string }>;
};

export default async function AccountingSessionByDatePage({ params }: AccountingSessionByDatePageProps) {
  const user = await getSession();
  if (!user || !["admin", "developer", "comptable"].includes(String(user.role || "").toLowerCase())) {
    redirect("/zangochap-manager");
  }

  const { date } = await params;
  const sessionId = await getAccountingSessionIdForDate(date);
  redirect(`/zangochap-manager/accounting/sessions/${sessionId}`);
}
