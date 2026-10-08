import type { Prisma, PrismaClient } from "@prisma/client";
import { DELIVERY_PLANNING_KEY, parseDeliveryPlanning, type DeliveryPlanning } from "../types";

type Db = PrismaClient | Prisma.TransactionClient;

/** Lecture serveur du planning (usage interne : repartition, pages). Pas une Server Action. */
export async function loadDeliveryPlanning(db: Db): Promise<DeliveryPlanning> {
  const row = await db.cmsContent.findUnique({ where: { key: DELIVERY_PLANNING_KEY }, select: { data: true } });
  return parseDeliveryPlanning(row?.data);
}
