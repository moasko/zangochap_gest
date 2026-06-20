import React from "react";
import { getSession } from "@/modules/auth/actions";
import { redirect } from "next/navigation";
import SettlementsClient from "./SettlementsClient";
import { getSettlementStats } from "@/modules/orders/actions";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

type SettlementsPageProps = {
  searchParams: Promise<{
    from?: string;
    to?: string;
    commercialId?: string;
    method?: string;
  }>;
};

export default async function SettlementsPage({ searchParams }: SettlementsPageProps) {
  const session = await getSession();
  if (!session || !["admin", "developer", "comptable"].includes(session.role)) redirect("/zangochap-manager");

  const resolvedParams = await searchParams;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const from = resolvedParams.from || today;
  const to = resolvedParams.to || today;
  const commercialId = resolvedParams.commercialId;
  const method = resolvedParams.method;
  const stats = await getSettlementStats(from, to, commercialId, method);
  const commercials = await prisma.user.findMany({
    where: { role: "COMMERCIAL" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="admin-page">
      <SettlementsClient
        initialStats={{
          ...stats,
          orders: stats.orders.map((order) => ({
            ...order,
            ref: order.ref || "Sans reference",
          })),
        }}
        initialFrom={from}
        initialTo={to}
        commercials={commercials}
        initialCommercialId={commercialId}
        initialMethod={method}
      />
    </div>
  );
}
