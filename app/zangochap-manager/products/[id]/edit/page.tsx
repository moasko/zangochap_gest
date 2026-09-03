import React from "react";
import { getProductById } from "@/modules/products/actions";
import { getWarehouses } from "@/modules/logistics/warehouses";
import { getCategories, getSuppliers } from "@/modules/settings/actions";
import EditProductClient from "@/modules/products/components/EditProductClient";
import { notFound } from "next/navigation";
import { getSession } from "@/modules/auth/actions";
import prisma from "@/lib/prisma";
import { Role } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ gift?: string }> }) {
  const giftMode = (await searchParams).gift === "1";
  const { id } = await params;
  const product = await getProductById(id);
  
  if (!product) {
    return notFound();
  }

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
    <EditProductClient giftMode={giftMode}
      product={JSON.parse(JSON.stringify(product))}
      warehouses={JSON.parse(JSON.stringify(warehouses))} 
      categories={JSON.parse(JSON.stringify(categories))} 
      suppliers={JSON.parse(JSON.stringify(suppliers))}
      commercials={JSON.parse(JSON.stringify(commercials))}
      user={JSON.parse(JSON.stringify(user))}
    />
  );
}
