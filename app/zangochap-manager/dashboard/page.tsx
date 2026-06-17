import React from "react";
import Topbar from "@/components/Topbar";
import AdminDashboard from "./AdminDashboard";
import CommercialDashboard from "./CommercialDashboard";
import PackingDashboard from "./PackingDashboard";
import CollectionDashboard from "./CollectionDashboard";
import StockDashboard from "./StockDashboard";
import { getSession } from "@/modules/auth/actions";

export const dynamic = "force-dynamic";

const GREETINGS: Record<string, string> = {
  commercial: "bord commercial",
  packing: "bord emballage",
  collection: "bord collecte",
  stock: "bord stock",
  admin: "bord admin",
};

export default async function DashboardPage() {
  const user = await getSession();
  const firstName = user?.name?.split(' ')[0] || '';
  const subtitle = GREETINGS[user?.role] || 'bord';

  const dashboards: Record<string, any> = {
    admin: AdminDashboard,
    commercial: CommercialDashboard,
    packing: PackingDashboard,
    collection: CollectionDashboard,
    stock: StockDashboard,
  };

  if (user?.role?.toUpperCase() === 'LIVREUR') {
    const { redirect } = await import("next/navigation");
    redirect("/zangochap-rider");
  }

  if (user?.role?.toUpperCase() === 'COMPTABLE') {
    const { redirect } = await import("next/navigation");
    redirect("/zangochap-manager/accounting");
  }

  const DashboardView = dashboards[user?.role] || AdminDashboard;

  const serializedUser = JSON.parse(JSON.stringify(user));

  return (
    <DashboardView user={serializedUser} />
  );
}
