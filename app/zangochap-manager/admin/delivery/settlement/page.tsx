import React from "react";
import Link from "next/link";
import { CreditCard, Truck } from "lucide-react";
import Topbar from "@/components/Topbar";
import { getDeliverySettlementDashboard } from "@/modules/orders/actions";
import SettlementClient from "./SettlementClient";

export const metadata = {
  title: "Reglement Livreurs - Zangochap Manager",
};

export const dynamic = "force-dynamic";

type SettlementPageProps = {
  searchParams: Promise<{
    date?: string;
    from?: string;
    to?: string;
    riderId?: string;
  }>;
};

export default async function SettlementPage({ searchParams }: SettlementPageProps) {
  const resolvedParams = await searchParams;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  
  const deliveryDate = resolvedParams.date || resolvedParams.from || today;
  const riderId = resolvedParams.riderId;

  const dashboard = await getDeliverySettlementDashboard(deliveryDate, deliveryDate, riderId);

  return (
    <>
      <Topbar title="Reglement" subtitle="livreurs" />
      <div className="content pb-0">
        <div className="mb-5 flex flex-col gap-3 border-b border-[#E8DED4] pb-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-[11px] font-black uppercase text-[#D4541C]">Reglements</div>
            <div className="mt-1 text-[13px] font-bold text-[#806A58]">
              Suivi livreurs et bascule rapide vers les comptes operateurs.
            </div>
          </div>

          <div className="inline-flex w-fit rounded-lg border border-[#E8DED4] bg-white p-1 shadow-sm">
            <Link
              href="/zangochap-manager/admin/settlements"
              className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-[12px] font-black text-[#6B4F3B] no-underline transition hover:bg-[#FAF6F1]"
            >
              <CreditCard size={15} /> Operateurs
            </Link>
            <span className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1A1410] px-3 text-[12px] font-black text-white">
              <Truck size={15} /> Livreurs
            </span>
          </div>
        </div>
      </div>
      <SettlementClient
        dashboard={dashboard}
        initialDate={deliveryDate}
        initialRiderId={riderId}
      />
    </>
  );
}
