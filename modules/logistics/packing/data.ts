import { OrderStatus } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/modules/auth/actions";
import type { PackingOrder } from "./types";

const PACKING_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.CONFIRMED,
  OrderStatus.PREPARING,
  OrderStatus.PARTIAL,
  OrderStatus.UNAVAILABLE,
  OrderStatus.PACKED,
  OrderStatus.REPROGRAMMED,
  OrderStatus.ALTERNATIVE,
];

const PACKING_ROLES = new Set(["ADMIN", "DEVELOPER", "PACKING", "STOCK", "COLLECTION"]);

export function assertPackingAccess(user: Awaited<ReturnType<typeof getSession>>) {
  if (!user || !PACKING_ROLES.has(user.role?.toUpperCase())) {
    throw new Error("Accès réservé au service logistique.");
  }
}

export async function getPackingOrders(): Promise<PackingOrder[]> {
  return prisma.order.findMany({
    where: {
      deletedAt: null,
      status: { in: PACKING_ORDER_STATUSES },
    },
    include: {
      items: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  }) as Promise<PackingOrder[]>;
}

export async function getPackingProducts(orders: PackingOrder[]) {
  const productIds = Array.from(
    new Set(orders.flatMap((order) => order.items.map((item) => item.productId)).filter(Boolean)),
  ) as string[];

  return productIds.length
    ? prisma.product.findMany({
        where: { id: { in: productIds } },
        include: {
          variants: {
            include: {
              stockLevels: {
                include: { warehouse: true },
              },
            },
          },
        },
        orderBy: { name: "asc" },
      })
    : [];
}

export async function getPackingPageData() {
  const user = await getSession();
  assertPackingAccess(user);
  const orders = await getPackingOrders();
  const products = await getPackingProducts(orders);

  return JSON.parse(
    JSON.stringify({
      orders,
      products,
      user,
    }),
  );
}
