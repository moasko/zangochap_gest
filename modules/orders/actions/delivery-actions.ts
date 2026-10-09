"use server";

import prisma from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { getSession } from "@/modules/auth/actions";
import { isRole } from "../helpers";
import { decrementStockForOrder } from "./stock";
import { triggerAutomations } from "@/modules/automations/engine";
import {
  DISPATCH_ELIGIBLE_STATUSES,
  getDispatchIneligibility,
  normalizeCommune,
  planDeliveryDispatch,
} from "../helpers/delivery-dispatch";
import { loadDispatchContext, parseDispatchDay } from "./dispatch-context";

const ASSIGNABLE_DELIVERY_STATUSES = ["PENDING", "CONFIRMED", "PARTIAL", "PREPARING", "UNAVAILABLE", "ALTERNATIVE", "PACKED", "ON_DELIVERY", "REPRO_DISPO"] as const;
const READY_FOR_DELIVERY_STATUSES = ["PACKED", "REPRO_DISPO"] as const;

type DeliveryAssignmentOrder = {
  status: string;
  settlementId: string | null;
};

type DeliveryAssignmentOrderWithItems = DeliveryAssignmentOrder & {
  id: string;
  ref: string | null;
  stockDecremented: boolean;
  items: unknown[];
};

function assertCanManageDeliveryAssignment(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session || !isRole(session, "admin", "developer")) {
    throw new Error("Acces refuse");
  }
}

function assertOrderCanBeAssigned(order: DeliveryAssignmentOrder) {
  if (order.settlementId) {
    throw new Error("Impossible de modifier le livreur d'une commande deja rattachee a un reglement.");
  }

  if (!ASSIGNABLE_DELIVERY_STATUSES.includes(order.status as typeof ASSIGNABLE_DELIVERY_STATUSES[number])) {
    throw new Error("Cette commande n'est pas eligible a l'attribution livraison.");
  }
}

function getAssignmentStatusUpdate(order: DeliveryAssignmentOrder, isUnassigning: boolean) {
  if (isUnassigning) return {};
  return READY_FOR_DELIVERY_STATUSES.includes(order.status as typeof READY_FOR_DELIVERY_STATUSES[number])
    ? { status: "ON_DELIVERY" as const }
    : {};
}

async function ensureDeliveryStock(order: DeliveryAssignmentOrderWithItems, session: NonNullable<Awaited<ReturnType<typeof getSession>>>, tx: Prisma.TransactionClient) {
  if (order.stockDecremented) return;
  if (!READY_FOR_DELIVERY_STATUSES.includes(order.status as typeof READY_FOR_DELIVERY_STATUSES[number])) return;
  await decrementStockForOrder(order, session, tx);
}

// L'attribution fait passer la commande en livraison ici (et non via
// updateOrderStatus) : on emet donc l'evenement d'automatisation nous-memes.
// Best-effort : ne doit jamais faire echouer l'attribution.
async function emitOnDeliveryAutomations(orders: DeliveryAssignmentOrderWithItems[]) {
  const transitioned = orders.filter((order) =>
    READY_FOR_DELIVERY_STATUSES.includes(order.status as typeof READY_FOR_DELIVERY_STATUSES[number])
  );
  for (const order of transitioned) {
    const updated = await prisma.order.findUnique({ where: { id: order.id }, include: { items: true } });
    if (updated?.status === "ON_DELIVERY") {
      await triggerAutomations({ type: "order.status_changed", order: updated, fromStatus: order.status, toStatus: "ON_DELIVERY" });
    }
  }
}

function revalidateDeliveryAssignmentPaths() {
  revalidatePath("/zangochap-manager/orders");
  revalidatePath("/zangochap-rider");
  revalidatePath("/zangochap-manager/admin/delivery");
  revalidatePath("/zangochap-manager/admin/delivery/settlement");
  revalidatePath("/zangochap-manager/dashboard");
}

// ============ ASSIGN TO DELIVERYMAN ============
export async function assignOrderToDeliveryman(orderId: string, deliverymanId: string) {
  const session = await getSession();
  assertCanManageDeliveryAssignment(session);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) throw new Error("Commande introuvable");

  assertOrderCanBeAssigned(order);

  const isUnassigning = !deliverymanId || deliverymanId === "unassigned";
  let driver = null;

  if (!isUnassigning) {
    driver = await prisma.user.findUnique({ where: { id: deliverymanId } });
    if (!driver) throw new Error("Livreur introuvable");
    if (driver.role !== "LIVREUR") throw new Error("Le compte choisi n'est pas un livreur.");
  }

  const history = Array.isArray(order.history) ? [...order.history] : [];
  history.push({
    at: new Date().toISOString(),
    action: isUnassigning
      ? "Commande desattribuee (remise en attente)"
      : order.status === "REPRO_DISPO"
        ? `Repro-dispo remise en livraison et attribuee a : ${driver?.name}`
        : `Livreur attribue : ${driver?.name}`,
    by: session!.email,
    byName: session!.name,
  });

  await prisma.$transaction(async (tx) => {
    if (!isUnassigning) {
      await ensureDeliveryStock(order, session!, tx);
    }

    await tx.order.update({
      where: { id: orderId },
      data: {
        deliverymanId: isUnassigning ? null : deliverymanId,
        deliverymanName: isUnassigning ? null : driver?.name,
        ...getAssignmentStatusUpdate(order, isUnassigning),
        history,
      },
    });
  });

  if (!isUnassigning) {
    await emitOnDeliveryAutomations([order]);
  }

  revalidateDeliveryAssignmentPaths();
  return { success: true };
}

// ============ BULK ASSIGN ============
// Deplacement / attribution de plusieurs colis : une commande a la fois, avec
// verrou optimiste. Une commande modifiee ou non eligible est ignoree et signalee,
// les autres sont traitees (plus de tout-ou-rien ni d'ecritures paralleles).
export async function bulkAssignOrders(orderIds: string[], deliverymanId: string) {
  const session = await getSession();
  assertCanManageDeliveryAssignment(session);

  const ids = Array.from(new Set((Array.isArray(orderIds) ? orderIds : []).filter(Boolean)));
  if (ids.length === 0) throw new Error("Aucune commande selectionnee.");
  if (ids.length > 500) throw new Error("Trop de commandes en une seule fois.");

  const isUnassigning = !deliverymanId || deliverymanId === "unassigned";
  let driver: { id: string; name: string } | null = null;

  if (!isUnassigning) {
    const found = await prisma.user.findUnique({ where: { id: deliverymanId }, select: { id: true, name: true, role: true } });
    if (!found) throw new Error("Livreur introuvable");
    if (found.role !== "LIVREUR") throw new Error("Le compte choisi n'est pas un livreur.");
    driver = { id: found.id, name: found.name };
  }

  const applied: DeliveryAssignmentOrderWithItems[] = [];
  const skipped: { orderId: string; ref: string; reason: string }[] = [];

  for (const orderId of ids) {
    let ref = orderId;
    try {
      const order = await prisma.$transaction(async (tx) => {
        const current = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
        if (!current || current.deletedAt) throw new Error("Commande introuvable");
        ref = current.ref || current.id;
        assertOrderCanBeAssigned(current);
        if (!isUnassigning && current.deliverymanId === driver!.id && current.status !== "REPRO_DISPO") {
          throw new Error(`Deja chez ${driver!.name}`);
        }

        const history = Array.isArray(current.history) ? [...current.history] : [];
        history.push({
          at: new Date().toISOString(),
          action: isUnassigning
            ? "Desattribution groupee"
            : current.status === "REPRO_DISPO"
              ? `Repro-dispo remise en livraison et attribuee a : ${driver!.name}`
              : current.deliverymanName
                ? `Colis deplace de ${current.deliverymanName} vers ${driver!.name}`
                : `Attribution groupee au livreur : ${driver!.name}`,
          by: session!.email,
          byName: session!.name,
        });

        const updated = await tx.order.updateMany({
          where: {
            id: current.id,
            updatedAt: current.updatedAt,
            status: current.status,
            deliverymanId: current.deliverymanId,
            settlementId: null,
          },
          data: {
            deliverymanId: isUnassigning ? null : driver!.id,
            deliverymanName: isUnassigning ? null : driver!.name,
            ...getAssignmentStatusUpdate(current, isUnassigning),
            history,
          },
        });
        if (updated.count !== 1) throw new Error("Modifiee pendant l'attribution");
        if (!isUnassigning) await ensureDeliveryStock(current, session!, tx);
        return current;
      });
      applied.push(order);
    } catch (error) {
      skipped.push({ orderId, ref, reason: error instanceof Error ? error.message : "Erreur" });
    }
  }

  if (!isUnassigning && applied.length > 0) {
    try {
      await emitOnDeliveryAutomations(applied);
    } catch (error) {
      console.error("[delivery-bulk] automations:", error);
    }
  }

  if (applied.length > 0) revalidateDeliveryAssignmentPaths();
  return { success: true, assignedCount: applied.length, skipped };
}

// ============ AUTO DISPATCH ============
// Proposition calculee cote serveur (apercu = resultat), puis application
// commande par commande avec garde de version : une commande modifiee entre
// l'apercu et la validation est ignoree et signalee, jamais ecrasee.

const DISPATCH_CANDIDATE_STATUSES = [...DISPATCH_ELIGIBLE_STATUSES, "PENDING", "CONFIRMED", "PARTIAL", "PREPARING", "UNAVAILABLE", "ALTERNATIVE"] as const;

export type DeliveryDispatchOptions = {
  date: string;
  orderIds?: string[];
  presentRiderIds?: string[];
  capacity?: number;
  // Inclure les colis confirmes / en preparation (pas encore emballes).
  includeUnpacked?: boolean;
};

export type DeliveryDispatchApplyOptions = { includeUnpacked?: boolean };

function orderAmount(order: { total: number; deliveryFee: number; discount: number }) {
  return Number(order.total || 0) + Number(order.deliveryFee || 0) - Number(order.discount || 0);
}

export async function getDeliveryDispatchPlan(options: DeliveryDispatchOptions) {
  const session = await getSession();
  assertCanManageDeliveryAssignment(session);

  const { start, end } = parseDispatchDay(options.date);
  // Plafond general facultatif : vide = aucun plafond (seuls ceux du planning s appliquent).
  const capacity = Number(options.capacity) > 0 ? Math.min(60, Math.floor(Number(options.capacity))) : null;
  const orderIds = options.orderIds ? Array.from(new Set(options.orderIds.filter(Boolean))) : null;

  const [context, candidates] = await Promise.all([
    loadDispatchContext(prisma, options.date),
    prisma.order.findMany({
      where: {
        deletedAt: null,
        deliveryDate: { gte: start, lt: end },
        status: { in: [...DISPATCH_CANDIDATE_STATUSES] },
        OR: [{ deliverymanId: null }, { status: "REPRO_DISPO" }],
        ...(orderIds ? { id: { in: orderIds } } : {}),
      },
      select: {
        id: true, ref: true, status: true, commune: true, customerName: true, customerPhone: true, customerLocation: true,
        deliverymanId: true, deliverymanName: true, settlementId: true, depositVerificationStatus: true,
        total: true, deliveryFee: true, discount: true, updatedAt: true,
      },
      orderBy: { ref: "asc" },
    }),
  ]);
  const { riders, currentLoads, currentCommunes, historyByRider, recentCount, availability, defaultPresent, capacities, fixedCommunes } = context;
  const riderIds = new Set(riders.map((rider) => rider.id));
  const presentRiderIds = options.presentRiderIds
    ? options.presentRiderIds.filter((id) => riderIds.has(id))
    : defaultPresent;

  const plan = planDeliveryDispatch({
    orders: candidates,
    riders,
    presentRiderIds,
    capacity,
    currentLoads,
    currentCommunes,
    history: historyByRider,
    capacities,
    fixedCommunes,
    includeUnpacked: options.includeUnpacked === true,
  });

  const byId = new Map(candidates.map((order) => [order.id, order]));
  const describe = (orderId: string) => {
    const order = byId.get(orderId)!;
    return {
      id: order.id,
      ref: order.ref || order.id,
      status: order.status,
      commune: normalizeCommune(order.commune) || order.commune || "",
      customerName: order.customerName,
      amount: orderAmount(order),
      previousRiderName: order.status === "REPRO_DISPO" ? order.deliverymanName : null,
      // Livrable sans adresse (le livreur appelle), mais signale dans l apercu.
      missingAddress: !order.customerLocation?.trim() && !["Boutique", "Hors Abidjan"].includes(normalizeCommune(order.commune) || ""),
      version: order.updatedAt.toISOString(),
    };
  };

  return {
    date: options.date,
    capacity,
    includeUnpacked: options.includeUnpacked === true,
    riders: riders.map((rider) => {
      const zones = Object.entries(historyByRider[rider.id] || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([commune, count]) => ({ commune, pct: Math.round((100 * count) / (recentCount[rider.id] || 1)) }));
      return {
        id: rider.id,
        name: rider.name,
        present: presentRiderIds.includes(rider.id),
        activeRecently: defaultPresent.includes(rider.id) || availability.get(rider.id)!.recentlyActive,
        presenceReason: availability.get(rider.id)!.reason,
        fromPlanning: availability.get(rider.id)!.source === "planning",
        fixedCommunes: fixedCommunes[rider.id] || [],
        capacity: capacities[rider.id] || null,
        recentCount: recentCount[rider.id] || 0,
        zones,
        before: plan.loads[rider.id]?.before ?? currentLoads[rider.id] ?? 0,
        after: plan.loads[rider.id]?.after ?? currentLoads[rider.id] ?? 0,
      };
    }),
    assignments: plan.assignments.map((assignment) => ({ ...describe(assignment.orderId), riderId: assignment.riderId, reason: assignment.reason })),
    skipped: plan.skipped.map((skip) => ({ ...describe(skip.orderId), reason: skip.reason })),
  };
}

export type DeliveryDispatchAssignmentInput = { orderId: string; riderId: string; version: string };

export async function applyDeliveryDispatchPlan(input: DeliveryDispatchAssignmentInput[], options: DeliveryDispatchApplyOptions = {}) {
  const includeUnpacked = options?.includeUnpacked === true;
  const session = await getSession();
  assertCanManageDeliveryAssignment(session);

  const seen = new Set<string>();
  const assignments = (Array.isArray(input) ? input : []).filter((item) => {
    if (!item?.orderId || !item.riderId || !item.version || seen.has(item.orderId)) return false;
    seen.add(item.orderId);
    return true;
  });
  if (assignments.length === 0) throw new Error("Aucune attribution a appliquer.");
  if (assignments.length > 500) throw new Error("Trop de commandes en une seule repartition.");

  const riders = await prisma.user.findMany({
    where: { id: { in: Array.from(new Set(assignments.map((item) => item.riderId))) }, role: "LIVREUR" },
    select: { id: true, name: true },
  });
  const riderById = new Map(riders.map((rider) => [rider.id, rider]));

  const applied: DeliveryAssignmentOrderWithItems[] = [];
  const skipped: { orderId: string; ref: string; reason: string }[] = [];

  // Sequentiel : une transaction a la fois pour menager le pool (10 connexions)
  // et obtenir un bilan exact par commande.
  for (const item of assignments) {
    const rider = riderById.get(item.riderId);
    let ref = item.orderId;
    try {
      if (!rider) throw new Error("Livreur introuvable ou n'est plus livreur");
      const order = await prisma.$transaction(async (tx) => {
        const current = await tx.order.findUnique({ where: { id: item.orderId }, include: { items: true } });
        if (!current || current.deletedAt) throw new Error("Commande introuvable");
        ref = current.ref || current.id;
        if (current.updatedAt.toISOString() !== item.version) throw new Error("Modifiee depuis l'apercu");
        const ineligible = getDispatchIneligibility(current, { includeUnpacked });
        if (ineligible) throw new Error(ineligible);

        const history = Array.isArray(current.history) ? [...current.history] : [];
        history.push({
          at: new Date().toISOString(),
          action: current.status === "REPRO_DISPO"
            ? `Repro-dispo remise en livraison (repartition automatique) : ${rider.name}`
            : `Repartition automatique au livreur : ${rider.name}`,
          by: session!.email,
          byName: session!.name,
        });

        // Verrou optimiste : la ligne n'est ecrite que si rien n'a change depuis la lecture.
        const updated = await tx.order.updateMany({
          where: {
            id: current.id,
            updatedAt: current.updatedAt,
            status: current.status,
            deliverymanId: current.deliverymanId,
            settlementId: null,
          },
          data: {
            deliverymanId: rider.id,
            deliverymanName: rider.name,
            ...getAssignmentStatusUpdate(current, false),
            history,
          },
        });
        if (updated.count !== 1) throw new Error("Modifiee pendant l'attribution");
        await ensureDeliveryStock(current, session!, tx);
        return current;
      });
      applied.push(order);
    } catch (error) {
      skipped.push({ orderId: item.orderId, ref, reason: error instanceof Error ? error.message : "Erreur" });
    }
  }

  if (applied.length > 0) {
    try {
      await emitOnDeliveryAutomations(applied);
    } catch (error) {
      console.error("[delivery-dispatch] automations:", error);
    }
    revalidateDeliveryAssignmentPaths();
  }

  return { success: true, assignedCount: applied.length, skipped };
}

// Compatibilite : ancienne signature, desormais basee sur le meme moteur.
export async function autoAssignDeliveryOrders(orderIds: string[], date?: string) {
  const day = date || new Date().toISOString().slice(0, 10);
  const plan = await getDeliveryDispatchPlan({ date: day, orderIds });
  if (plan.assignments.length === 0) {
    return { success: true, assignedCount: 0, skippedCount: plan.skipped.length };
  }
  const result = await applyDeliveryDispatchPlan(
    plan.assignments.map((item) => ({ orderId: item.id, riderId: item.riderId, version: item.version })),
  );
  return { success: true, assignedCount: result.assignedCount, skippedCount: plan.skipped.length + result.skipped.length };
}
