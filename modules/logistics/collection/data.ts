import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";
import { buildCollectionItems } from "./helpers";

export async function getCollectionPageData() {
  const user = await ensureAuth(["admin", "collection", "point_relais"]);

  const [categories, warehouses, orders] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.warehouse.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.order.findMany({
      where: {
        deletedAt: null,
        status: { in: ["CONFIRMED", "PENDING", "PARTIAL"] },
      },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
  ]);

  const productIds = Array.from(
    new Set(orders.flatMap((order) => order.items.map((item) => item.productId)).filter(Boolean)),
  ) as string[];

  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        include: {
          variants: {
            include: {
              stockLevels: {
                include: { warehouse: true },
              },
            },
          },
          category: true,
          images: { orderBy: { position: "asc" } },
        },
      })
    : [];

  return JSON.parse(
    JSON.stringify({
      toCollect: buildCollectionItems(orders, products),
      user,
      categories,
      warehouses,
    }),
  );
}
