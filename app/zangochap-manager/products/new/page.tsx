import React from "react";
import { getWarehouses } from "@/modules/logistics/warehouses";
import { getCategories, getSuppliers } from "@/modules/settings/actions";
import NewProductClient from "@/modules/products/components/NewProductClient";
import { getSession } from "@/modules/auth/actions";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ gift?: string }> }) {
  const giftMode = (await searchParams).gift === "1";
  const user = await getSession();
  const [warehouses, categories, suppliers, commercials] = await Promise.all([
    getWarehouses(),
    getCategories(),
    getSuppliers(),
    prisma.user.findMany({
      where: { role: { in: [Role.ADMIN, Role.COMMERCIAL] } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    }),
  ]);
  
  return (
    <NewProductClient giftMode={giftMode}
      warehouses={JSON.parse(JSON.stringify(warehouses))} 
      categories={JSON.parse(JSON.stringify(categories))} 
      suppliers={JSON.parse(JSON.stringify(suppliers))}
      commercials={JSON.parse(JSON.stringify(commercials))}
      user={JSON.parse(JSON.stringify(user))}
    />
  );
}
