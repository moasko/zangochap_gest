// Contexte de repartition pour une date : livreurs, presence, charge du jour,
// historique des zones et reglages du planning. Module interne (pas une Server
// Action) partage par la repartition du soir et l'attribution a la validation,
// pour que les deux appliquent exactement les memes regles.
import type { Prisma, PrismaClient } from "@prisma/client";
import { loadDeliveryPlanning } from "@/modules/delivery-planning/helpers/load";
import { getRiderAvailability, type DeliveryPlanning, type RiderAvailability } from "@/modules/delivery-planning/types";
import { normalizeCommune } from "../helpers/delivery-dispatch";

type Db = PrismaClient | Prisma.TransactionClient;

export const DISPATCH_HISTORY_DAYS = 30;
export const DISPATCH_PRESENCE_DAYS = 7;
// Colis comptes dans la charge d'un livreur pour la date (attribues d'avance compris).
export const DISPATCH_LOAD_STATUSES = ["PENDING", "CONFIRMED", "PARTIAL", "PREPARING", "UNAVAILABLE", "ALTERNATIVE", "PACKED", "ON_DELIVERY"] as const;

export function parseDispatchDay(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) throw new Error("Choisissez une date de livraison.");
  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) throw new Error("Date de livraison invalide.");
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

export type DispatchContext = {
  riders: { id: string; name: string }[];
  planning: DeliveryPlanning;
  currentLoads: Record<string, number>;
  currentCommunes: Record<string, string[]>;
  historyByRider: Record<string, Record<string, number>>;
  recentCount: Record<string, number>;
  availability: Map<string, RiderAvailability & { recentlyActive: boolean }>;
  defaultPresent: string[];
  capacities: Record<string, number>;
  fixedCommunes: Record<string, string[]>;
};

export async function loadDispatchContext(db: Db, date: string): Promise<DispatchContext> {
  const { start, end } = parseDispatchDay(date);
  const historyStart = new Date(start);
  historyStart.setUTCDate(historyStart.getUTCDate() - DISPATCH_HISTORY_DAYS);
  const presenceStart = new Date(start);
  presenceStart.setUTCDate(presenceStart.getUTCDate() - DISPATCH_PRESENCE_DAYS);

  const [riders, dayLoad, history, planning] = await Promise.all([
    db.user.findMany({ where: { role: "LIVREUR" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.order.findMany({
      where: {
        deletedAt: null,
        deliveryDate: { gte: start, lt: end },
        deliverymanId: { not: null },
        status: { in: [...DISPATCH_LOAD_STATUSES] },
      },
      select: { deliverymanId: true, commune: true },
    }),
    db.order.groupBy({
      by: ["deliverymanId", "commune"],
      where: { deletedAt: null, deliverymanId: { not: null }, deliveryDate: { gte: historyStart, lt: start } },
      _count: { _all: true },
      _max: { deliveryDate: true },
    }),
    loadDeliveryPlanning(db),
  ]);

  const currentLoads: Record<string, number> = {};
  const currentCommunes: Record<string, string[]> = {};
  for (const order of dayLoad) {
    const riderId = order.deliverymanId!;
    currentLoads[riderId] = (currentLoads[riderId] || 0) + 1;
    if (order.commune) (currentCommunes[riderId] ||= []).push(order.commune);
  }

  const historyByRider: Record<string, Record<string, number>> = {};
  const recentCount: Record<string, number> = {};
  const lastDelivery: Record<string, number> = {};
  for (const row of history) {
    const riderId = row.deliverymanId!;
    const count = row._count._all;
    recentCount[riderId] = (recentCount[riderId] || 0) + count;
    const last = row._max.deliveryDate?.getTime() || 0;
    if (last > (lastDelivery[riderId] || 0)) lastDelivery[riderId] = last;
    const commune = normalizeCommune(row.commune);
    if (!commune) continue;
    const byCommune = (historyByRider[riderId] ||= {});
    byCommune[commune] = (byCommune[commune] || 0) + count;
  }

  // Presence par defaut : planning enregistre, sinon activite des 7 derniers jours.
  const availability = new Map(riders.map((rider) => {
    const recentlyActive = (lastDelivery[rider.id] || 0) >= presenceStart.getTime() || Boolean(currentLoads[rider.id]);
    return [rider.id, { ...getRiderAvailability(planning.riders[rider.id], date, recentlyActive), recentlyActive }];
  }));
  const defaultPresent = riders.filter((rider) => availability.get(rider.id)!.present).map((rider) => rider.id);

  const capacities: Record<string, number> = {};
  const fixedCommunes: Record<string, string[]> = {};
  for (const [riderId, riderPlanning] of Object.entries(planning.riders)) {
    if (riderPlanning.capacity) capacities[riderId] = riderPlanning.capacity;
    if (riderPlanning.fixedCommunes.length) fixedCommunes[riderId] = riderPlanning.fixedCommunes;
  }

  return { riders, planning, currentLoads, currentCommunes, historyByRider, recentCount, availability, defaultPresent, capacities, fixedCommunes };
}
