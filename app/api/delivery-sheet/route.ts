import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/modules/auth/actions";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Feuille de livraison : contient les coordonnees clients (nom, telephone,
// adresse). Reservee au staff logistique/commercial ; jamais accessible en anonyme.
const ALLOWED_ROLES = ["admin", "developer", "collection", "commercial", "packing", "stock"];

export async function GET(req: NextRequest) {
  const session = await getSession();
  const role = String(session?.role || "").toLowerCase();
  if (!session || !ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: "Non autorise" }, { status: 401 });
  }

  const date = req.nextUrl.searchParams.get('date');
  if (!date) return NextResponse.json([]);

  const type = req.nextUrl.searchParams.get('type');

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  let dateFilter: Prisma.OrderWhereInput;
  if (type === 'created') {
    dateFilter = { createdAt: { gte: startOfDay, lte: endOfDay } };
  } else {
    dateFilter = {
      OR: [
        { deliveryDate: { gte: startOfDay, lte: endOfDay } },
        { 
          AND: [
            { deliveryDate: null },
            { createdAt: { gte: startOfDay, lte: endOfDay } }
          ]
        }
      ]
    };
  }

  const isVerificationByCreationDate = type === 'created';
  const deliveredItemsFilter = isVerificationByCreationDate ? undefined : { isDelivered: true };

  const orders = await prisma.order.findMany({
    where: {
      status: { notIn: ['CANCELLED', 'PENDING', 'TO_PROCESS', 'REPRO_DISPO'] },
      deletedAt: null,
      items: {
        some: deliveredItemsFilter || {},
      },
      ...dateFilter
    },
    include: { 
      items: {
        ...(deliveredItemsFilter ? { where: deliveredItemsFilter } : {}),
        include: {
          product: {
            include: {
              images: true,
              variants: {
                include: {
                  stockLevels: { include: { warehouse: true } }
                }
              }
            }
          }
        }
      } 
    },
    orderBy: [
      { commune: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
  });

  return NextResponse.json(orders);
}
