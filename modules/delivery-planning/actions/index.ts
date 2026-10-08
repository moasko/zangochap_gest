"use server";

import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import prisma from "@/lib/prisma";
import { ensureAuth } from "@/lib/auth";
import { loadDeliveryPlanning } from "../helpers/load";
import {
  DELIVERY_PLANNING_KEY,
  RiderPlanningSchema,
  getRiderAvailability,
  parseDeliveryPlanning,
  type DeliveryPlanning,
  type RiderPlanning,
} from "../types";

const PLANNING_PATH = "/zangochap-manager/admin/delivery/planning";
const RECENT_DAYS = 14;
const PRESENCE_DAYS = 7;

function dayKey(offsetDays: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export async function getDeliveryPlanningOverview() {
  await ensureAuth(["admin"]);

  const recentStart = new Date(`${dayKey(-RECENT_DAYS)}T00:00:00.000Z`);
  const presenceStart = new Date(`${dayKey(-PRESENCE_DAYS)}T00:00:00.000Z`);
  const [riders, activity, planning] = await Promise.all([
    prisma.user.findMany({ where: { role: "LIVREUR" }, select: { id: true, name: true, phone: true }, orderBy: { name: "asc" } }),
    prisma.order.groupBy({
      by: ["deliverymanId"],
      where: { deletedAt: null, deliverymanId: { not: null }, deliveryDate: { gte: recentStart } },
      _count: { _all: true },
      _max: { deliveryDate: true },
    }),
    loadDeliveryPlanning(prisma),
  ]);

  const activityById = new Map(activity.map((row) => [row.deliverymanId, row]));
  const today = dayKey(0);
  const tomorrow = dayKey(1);

  return {
    today,
    tomorrow,
    autoAssignOnConfirm: planning.settings.autoAssignOnConfirm,
    riders: riders
      .map((rider) => {
        const row = activityById.get(rider.id);
        const lastDelivery = row?._max.deliveryDate || null;
        const recentlyActive = Boolean(lastDelivery && lastDelivery >= presenceStart);
        const riderPlanning: RiderPlanning | null = planning.riders[rider.id] ?? null;
        return {
          ...rider,
          recentCount: row?._count._all || 0,
          lastDelivery: lastDelivery ? lastDelivery.toISOString().slice(0, 10) : null,
          recentlyActive,
          planning: riderPlanning as RiderPlanning | null,
          today: getRiderAvailability(riderPlanning || undefined, today, recentlyActive),
          tomorrow: getRiderAvailability(riderPlanning || undefined, tomorrow, recentlyActive),
        };
      })
      .sort((a, b) => Number(Boolean(b.planning) || b.recentlyActive) - Number(Boolean(a.planning) || a.recentlyActive)
        || b.recentCount - a.recentCount || a.name.localeCompare(b.name)),
  };
}

function validationMessage(error: unknown) {
  if (error instanceof ZodError) return error.issues[0]?.message || "Donnees invalides";
  return error instanceof Error ? error.message : "Erreur";
}

async function updatePlanning(updatedBy: string, change: (planning: DeliveryPlanning) => void) {
  await prisma.$transaction(async (tx) => {
    // Verrou de ligne : deux administrateurs ne s'ecrasent pas mutuellement.
    await tx.$queryRaw`SELECT key FROM "CmsContent" WHERE key = ${DELIVERY_PLANNING_KEY} FOR UPDATE`;
    const row = await tx.cmsContent.findUnique({ where: { key: DELIVERY_PLANNING_KEY }, select: { data: true } });
    const planning = parseDeliveryPlanning(row?.data);
    change(planning);
    const data = { version: 1, riders: planning.riders, settings: planning.settings };
    await tx.cmsContent.upsert({
      where: { key: DELIVERY_PLANNING_KEY },
      create: { key: DELIVERY_PLANNING_KEY, data, updatedBy },
      update: { data, updatedBy },
    });
  });
}

async function writeRiderPlanning(riderId: string, next: RiderPlanning | null, updatedBy: string) {
  await updatePlanning(updatedBy, (planning) => {
    if (next) planning.riders[riderId] = next;
    else delete planning.riders[riderId];
  });
}

/** Active / desactive l'attribution automatique a la validation call center. */
export async function setAutoAssignOnConfirm(enabled: boolean) {
  try {
    const session = await ensureAuth(["admin"]);
    await updatePlanning(session.email, (planning) => {
      planning.settings.autoAssignOnConfirm = enabled === true;
    });
    revalidatePath(PLANNING_PATH);
    return { success: true as const, enabled: enabled === true };
  } catch (error) {
    return { success: false as const, error: validationMessage(error) };
  }
}

/** Enregistre le planning d'un livreur. Retourne une enveloppe pour afficher l'erreur sans exception. */
export async function saveRiderPlanning(riderId: string, input: unknown) {
  try {
    const session = await ensureAuth(["admin"]);
    const rider = await prisma.user.findUnique({ where: { id: String(riderId || "") }, select: { id: true, role: true } });
    if (!rider || rider.role !== "LIVREUR") throw new Error("Livreur introuvable");
    const planning = RiderPlanningSchema.parse(input);
    await writeRiderPlanning(rider.id, planning, session.email);
    revalidatePath(PLANNING_PATH);
    return { success: true as const, planning };
  } catch (error) {
    return { success: false as const, error: validationMessage(error) };
  }
}

/** Supprime le planning : le livreur repasse en presence automatique (activite recente). */
export async function resetRiderPlanning(riderId: string) {
  try {
    const session = await ensureAuth(["admin"]);
    await writeRiderPlanning(String(riderId || ""), null, session.email);
    revalidatePath(PLANNING_PATH);
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: validationMessage(error) };
  }
}
